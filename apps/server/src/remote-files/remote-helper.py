"""在服务器现有 Python 环境运行的固定文件处理器，不接收 shell 命令。"""
import base64
import ctypes
import errno
import hashlib
import json
import os
import stat
import sys
import time

MAX_ENTRIES = 50000
MAX_DEPTH = 64
SCAN_SECONDS = 30
DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)


class Refusal(Exception):
    def __init__(self, code):
        self.code = code


def emit(event, **values):
    print(json.dumps(dict(event=event, **values), ensure_ascii=True), flush=True)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def facts(value):
    # 纳秒时间与 inode 可能超过 JS 安全整数，用字符串往返以免预检失真。
    return [str(item) for item in (value.st_dev, value.st_ino, value.st_mode, value.st_size,
                                  value.st_mtime_ns, value.st_ctime_ns)]


def node_kind(value):
    if stat.S_ISLNK(value.st_mode):
        return "link"
    if stat.S_ISDIR(value.st_mode):
        return "directory"
    if stat.S_ISREG(value.st_mode):
        return "file"
    raise Refusal("unsupported_file")


def absolute(value):
    if not isinstance(value, str) or not value.startswith("/") or "\0" in value or len(value) > 4096:
        raise Refusal("invalid_path")
    return os.path.normpath(value)


def inside(root, value):
    return os.path.commonpath([root, value]) == root


def parent_of(value):
    """逐段以 O_NOFOLLOW 打开父目录，后续操作均绑定描述符。"""
    parts = absolute(value).split("/")
    fd = os.open("/", DIRECTORY_FLAGS)
    try:
        for part in parts[1:-1]:
            if not part:
                continue
            following = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = following
        if os.readlink("/proc/self/fd/" + str(fd)) != os.path.dirname(value):
            raise Refusal("stale_preflight")
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def lstat(fd, name):
    try:
        return os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


class ScanBudget:
    def __init__(self):
        self.count = 0
        self.deadline = time.monotonic() + SCAN_SECONDS

    def check(self, depth=0, entry=False):
        if depth > MAX_DEPTH or time.monotonic() > self.deadline:
            raise Refusal("scan_incomplete")
        if entry:
            self.count += 1
            if self.count > MAX_ENTRIES:
                raise Refusal("scan_incomplete")

    def hash(self, fd, name):
        # 正文哈希由操作总超时约束，不占用元数据遍历的 30 秒预算。
        started = time.monotonic()
        try:
            return hash_file(fd, name)
        finally:
            self.deadline += time.monotonic() - started


def children(fd, budget):
    # scandir 按需读取，不能先 listdir 整个大目录再应用上限。
    count = 0
    with os.scandir(fd) as iterator:
        for item in iterator:
            count += 1
            budget.check()
            if count > MAX_ENTRIES:
                raise Refusal("scan_incomplete")
            yield item.name


def snapshot(fd, name):
    rows = []
    budget = ScanBudget()

    def visit(parent, child, relative, depth):
        budget.check(depth, entry=True)
        value = lstat(parent, child)
        if value is None:
            raise Refusal("stale_preflight")
        kind = node_kind(value)
        extra = os.readlink(child, dir_fd=parent) if kind == "link" else None
        rows.append([relative, facts(value), kind, extra])
        if kind != "directory":
            return
        opened = os.open(child, DIRECTORY_FLAGS, dir_fd=parent)
        try:
            if facts(os.fstat(opened)) != facts(value):
                raise Refusal("stale_preflight")
            for item in children(opened, budget):
                visit(opened, item, relative + "/" + item, depth + 1)
            if facts(os.fstat(opened)) != facts(value):
                raise Refusal("stale_preflight")
        finally:
            os.close(opened)

    visit(fd, name, "", 0)
    rows.sort(key=lambda row: row[0])
    return rows


def capabilities():
    if sys.platform != "linux" or not hasattr(os, "O_NOFOLLOW") or os.open not in os.supports_dir_fd:
        raise Refusal("operation_unavailable")
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise Refusal("operation_unavailable")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    # 空路径只探测系统调用，不创建或修改文件。
    rename(-1, b"", -1, b"", 1)
    if ctypes.get_errno() == errno.ENOSYS:
        raise Refusal("operation_unavailable")
    return rename


def roots_of(request):
    roots = [os.path.realpath(absolute(item)) for item in request.get("roots", [])]
    for root in roots:
        if not stat.S_ISDIR(os.stat(root).st_mode):
            raise Refusal("protected_root")
    # 与后端固定顺序的工作区一一对应，重复根也不能丢失归属。
    return roots


def protect(request, roots):
    kind = request["kind"]
    source = request.get("source")
    destination = request.get("destination")
    if source == "/" or destination == "/":
        raise Refusal("protected_root")
    if source and destination and inside(source, destination):
        raise Refusal("invalid_destination")
    protected = roots + [absolute(item) for item in request.get("roots", [])]
    if source and kind in ("move", "rename", "delete") and any(inside(source, root) for root in protected):
        raise Refusal("protected_root")


def plan(request):
    capabilities()
    kind = request.get("kind")
    if kind not in ("mkdir", "rename", "move", "copy", "delete"):
        raise Refusal("invalid_request")
    source = request.get("source")
    destination = request.get("destination")
    if (kind != "mkdir") != bool(source) or (kind != "delete") != bool(destination):
        raise Refusal("invalid_request")
    roots = roots_of(request)
    protect(request, roots)
    result = dict(kind=kind, roots=roots, source=source, destination=destination, entries=0, files=0, bytes=0)
    if source:
        fd, name = parent_of(absolute(source))
        try:
            value = lstat(fd, name)
            if value is None:
                raise Refusal("not_found")
            rows = snapshot(fd, name)
            result.update(sourceType=node_kind(value), sourceFacts=facts(value), sourceDigest=digest(rows),
                          sourceParent=list(facts(os.fstat(fd))[:3]), entries=len(rows),
                          files=sum(row[2] == "file" for row in rows),
                          bytes=sum(int(row[1][3]) for row in rows if row[2] == "file"))
        finally:
            os.close(fd)
    if destination:
        fd, name = parent_of(absolute(destination))
        try:
            if lstat(fd, name) is not None:
                raise Refusal("destination_exists")
            result["destinationParent"] = list(facts(os.fstat(fd))[:3])
        finally:
            os.close(fd)
    result["crossFilesystem"] = bool(source and destination and
                                    result["sourceFacts"][0] != result["destinationParent"][0])
    if kind == "rename" and result["crossFilesystem"]:
        raise Refusal("invalid_destination")
    return result


def check_file(fd, name, expected):
    value = lstat(fd, name)
    if value is None or facts(value) != expected:
        raise Refusal("stale_preflight")
    return value


def hash_file(fd, name):
    opened = os.open(name, FILE_FLAGS, dir_fd=fd)
    try:
        before = facts(os.fstat(opened))
        hashed = hashlib.sha256()
        while True:
            chunk = os.read(opened, 1024 * 1024)
            if not chunk:
                break
            hashed.update(chunk)
        if facts(os.fstat(opened)) != before:
            raise Refusal("stale_preflight")
        return hashed.hexdigest()
    finally:
        os.close(opened)


def copy_file(source_fd, source, target_fd, target, expected):
    value = check_file(source_fd, source, expected)
    opened = os.open(source, FILE_FLAGS, dir_fd=source_fd)
    try:
        if facts(os.fstat(opened)) != expected:
            raise Refusal("stale_preflight")
        created = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=target_fd)
        hashed = hashlib.sha256()
        with os.fdopen(created, "wb") as output:
            while True:
                chunk = os.read(opened, 1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                hashed.update(chunk)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), stat.S_IMODE(value.st_mode) & 0o777)
        if facts(os.fstat(opened)) != expected or hash_file(target_fd, target) != hashed.hexdigest():
            raise Refusal("verification_failed")
        return hashed.hexdigest()
    finally:
        os.close(opened)


def copy_entry(source_fd, source, target_fd, target, rows, proof, budget, relative="", depth=0):
    budget.check(depth, entry=True)
    if relative not in rows:
        raise Refusal("stale_preflight")
    expected, kind, link = rows[relative]
    value = check_file(source_fd, source, expected)
    if kind == "file":
        started = time.monotonic()
        try:
            proof.append([relative, kind, copy_file(source_fd, source, target_fd, target, expected)])
        finally:
            budget.deadline += time.monotonic() - started
        return
    if kind == "link":
        if os.readlink(source, dir_fd=source_fd) != link:
            raise Refusal("stale_preflight")
        os.symlink(link, target, dir_fd=target_fd)
        proof.append([relative, kind, link])
        return
    proof.append([relative, kind, None])
    os.mkdir(target, 0o700, dir_fd=target_fd)
    opened_source = os.open(source, DIRECTORY_FLAGS, dir_fd=source_fd)
    try:
        if facts(os.fstat(opened_source)) != expected:
            raise Refusal("stale_preflight")
        opened_target = os.open(target, DIRECTORY_FLAGS, dir_fd=target_fd)
        try:
            for name in children(opened_source, budget):
                copy_entry(opened_source, name, opened_target, name, rows, proof, budget,
                           relative + "/" + name, depth + 1)
            os.fchmod(opened_target, stat.S_IMODE(value.st_mode) & 0o777)
        finally:
            os.close(opened_target)
    finally:
        os.close(opened_source)


def remove_entry(fd, name, rows, budget, relative="", depth=0, ctimes=None):
    if ctimes is None:
        ctimes = {}
    budget.check(depth, entry=True)
    if relative not in rows:
        raise Refusal("stale_preflight")
    expected, kind, _link = rows[relative]
    expected = list(expected)
    inode = tuple(expected[:2])
    if inode in ctimes:
        expected[5] = ctimes[inode]
    check_file(fd, name, expected)
    if kind != "directory":
        # 同 inode 的其他硬链接会因本次 unlink 改变 ctime，只更新自己的已知副作用。
        opened = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=fd)
        try:
            if facts(os.fstat(opened)) != expected:
                raise Refusal("stale_preflight")
            os.unlink(name, dir_fd=fd)
            after = facts(os.fstat(opened))
            if after[:5] != expected[:5]:
                raise Refusal("stale_preflight")
            ctimes[inode] = after[5]
        finally:
            os.close(opened)
        return
    opened = os.open(name, DIRECTORY_FLAGS, dir_fd=fd)
    try:
        if facts(os.fstat(opened)) != expected:
            raise Refusal("stale_preflight")
        for child in children(opened, budget):
            remove_entry(opened, child, rows, budget, relative + "/" + child, depth + 1, ctimes)
    finally:
        os.close(opened)
    os.rmdir(name, dir_fd=fd)


def content_snapshot(fd, name):
    rows = []
    budget = ScanBudget()

    def visit(parent, child, relative, depth):
        budget.check(depth, entry=True)
        value = lstat(parent, child)
        if value is None:
            raise Refusal("verification_failed")
        kind = node_kind(value)
        extra = budget.hash(parent, child) if kind == "file" else (
            os.readlink(child, dir_fd=parent) if kind == "link" else None)
        rows.append([relative, kind, extra])
        if kind != "directory":
            return
        opened = os.open(child, DIRECTORY_FLAGS, dir_fd=parent)
        try:
            if facts(os.fstat(opened)) != facts(value):
                raise Refusal("stale_preflight")
            for item in children(opened, budget):
                visit(opened, item, relative + "/" + item, depth + 1)
            if facts(os.fstat(opened)) != facts(value):
                raise Refusal("stale_preflight")
        finally:
            os.close(opened)

    visit(fd, name, "", 0)
    rows.sort(key=lambda row: row[0])
    return rows


def source_unchanged(fd, current):
    if list(facts(os.fstat(fd))[:3]) != current["sourceParent"]:
        raise Refusal("stale_preflight")


def execute(request):
    current = plan(request)
    if current != request.get("expected"):
        raise Refusal("stale_preflight")
    kind = current["kind"]
    if kind == "mkdir":
        target_fd, target = parent_of(current["destination"])
        try:
            if list(facts(os.fstat(target_fd))[:3]) != current["destinationParent"]:
                raise Refusal("stale_preflight")
            emit("phase", phase="creating")
            os.mkdir(target, 0o755, dir_fd=target_fd)
        finally:
            os.close(target_fd)
        return
    source_fd, source = parent_of(current["source"])
    try:
        source_unchanged(source_fd, current)
        scanned = snapshot(source_fd, source)
        if digest(scanned) != current["sourceDigest"]:
            raise Refusal("stale_preflight")
        rows = {row[0]: row[1:] for row in scanned}
        if kind == "delete":
            emit("phase", phase="removing_source")
            remove_entry(source_fd, source, rows, ScanBudget())
            return
        target_fd, target = parent_of(current["destination"])
        try:
            if list(facts(os.fstat(target_fd))[:3]) != current["destinationParent"]:
                raise Refusal("stale_preflight")
            if kind in ("rename", "move"):
                check_file(source_fd, source, current["sourceFacts"])
                emit("phase", phase="renaming")
                renamed = capabilities()(source_fd, os.fsencode(source), target_fd, os.fsencode(target), 1)
                if renamed == 0:
                    return
                failure = ctypes.get_errno()
                if failure != errno.EXDEV:
                    raise OSError(failure, os.strerror(failure))
                if kind == "rename":
                    raise Refusal("invalid_destination")
            emit("phase", phase="copying")
            proof = []
            copy_entry(source_fd, source, target_fd, target, rows, proof, ScanBudget())
            emit("phase", phase="verifying")
            proof.sort(key=lambda row: row[0])
            verified = digest(proof)
            if digest(content_snapshot(target_fd, target)) != verified:
                raise Refusal("verification_failed")
            if digest(snapshot(source_fd, source)) != current["sourceDigest"]:
                raise Refusal("stale_preflight")
            emit("phase", phase="verifying", verified=verified)
            if kind == "move":
                emit("phase", phase="removing_source")
                remove_entry(source_fd, source, rows, ScanBudget())
        finally:
            os.close(target_fd)
    finally:
        os.close(source_fd)


def inspect_result(request):
    result = {}
    for key in ("source", "destination"):
        value = request.get(key)
        if not value:
            continue
        try:
            fd, name = parent_of(absolute(value))
        except FileNotFoundError:
            result[key] = dict(exists=False)
            continue
        try:
            node = lstat(fd, name)
            result[key] = dict(exists=node is not None)
            if node is not None:
                result[key].update(type=node_kind(node), facts=facts(node), treeDigest=digest(snapshot(fd, name)))
                if request.get("verifyContent"):
                    result[key]["contentDigest"] = digest(content_snapshot(fd, name))
        finally:
            os.close(fd)
    return result


def main():
    request = json.loads(base64.b64decode(sys.argv[1]))
    action = request.get("action")
    if action == "plan":
        emit("result", result=plan(request))
    elif action == "execute":
        execute(request)
        emit("result", result=dict(completed=True))
    elif action == "check":
        emit("result", result=inspect_result(request))
    else:
        raise Refusal("invalid_request")


try:
    main()
except Refusal as error:
    emit("error", code=error.code)
    sys.exit(1)
except OSError as error:
    codes = {errno.EEXIST: "destination_exists", errno.ENOENT: "not_found", errno.EACCES: "permission_denied",
             errno.EPERM: "permission_denied", errno.ELOOP: "linked_parent", errno.ENOTDIR: "linked_parent",
             errno.ENOSYS: "operation_unavailable", errno.EOPNOTSUPP: "operation_unavailable"}
    emit("error", code=codes.get(error.errno, "operation_failed"))
    sys.exit(1)
except Exception:
    # 内部异常不把服务器路径、traceback 或正文发送给网页。
    emit("error", code="operation_failed")
    sys.exit(1)
