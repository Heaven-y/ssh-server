import { describe, expect, it } from 'vitest';
import { checkCommand } from './policy';

const ctx = { remoteRoot: '~/projects/demo' };

describe('checkCommand 拒绝危险命令', () => {
  const cases: Array<[string, string]> = [
    ['sudo ls', 'privilege'],
    ['FOO=1 sudo ls', 'privilege'],
    ['nohup sudo ls', 'privilege'],
    ['su -', 'privilege'],
    ['doas id', 'privilege'],
    ['bash -c "sudo ls"', 'privilege'],
    ['echo $(sudo whoami)', 'privilege'],
    ['rm -rf /', 'rm-dangerous'],
    ['rm -fr ~', 'rm-dangerous'],
    ['rm -r -f $HOME', 'rm-dangerous'],
    ['rm --recursive --force ~/*', 'rm-dangerous'],
    ['rm -rf .', 'rm-dangerous'],
    ['rm -rf *', 'rm-dangerous'],
    ['rm -rf ..', 'rm-dangerous'],
    ['rm -r ~', 'rm-dangerous'],
    ['rm -rf ~/projects/demo', 'rm-dangerous'],
    ['rm -rf ~/projects/demo/', 'rm-dangerous'],
    ['cd x && rm -rf ~', 'rm-dangerous'],
    ['bash -c "rm -rf /"', 'rm-dangerous'],
    ['mkfs.ext4 /dev/sdb1', 'mkfs'],
    ['dd if=/dev/zero of=/dev/sda', 'dd-device'],
    ['shutdown -h now', 'power'],
    ['reboot', 'power'],
    ['kill -9 -1', 'kill-all'],
    ['pkill -9 -1', 'kill-all'],
    ['chmod -R 777 .', 'chmod-777-recursive'],
    ['echo k >> ~/.ssh/authorized_keys', 'authorized-keys'],
    ['rm ~/.ssh/authorized_keys', 'authorized-keys'],
    [':(){ :|:& };:', 'fork-bomb'],
    ['crontab -r', 'crontab-remove'],
    // 包装命令带选项、带值时仍能找到真正执行的程序
    ['nice -n 10 sudo ls', 'privilege'],
    ['timeout -s KILL 30 sudo ls', 'privilege'],
    ['timeout 5 rm -rf /', 'rm-dangerous'],
    ['env -i PATH=/bin sudo ls', 'privilege'],
    ['/usr/bin/nohup /usr/bin/sudo ls', 'privilege'],
    ['nohup nice -n 5 sudo ls', 'privilege'],
    // 续行、换行、嵌套与 eval
    ['rm -rf \\\n/', 'rm-dangerous'],
    ['echo ok\nsudo ls', 'privilege'],
    ['eval sudo ls', 'privilege'],
    ['bash -c "bash -c \\"sudo ls\\""', 'privilege'],
    ['echo `sudo whoami`', 'privilege'],
  ];

  it.each(cases)('%s → %s', (command, ruleId) => {
    const r = checkCommand(command, ctx);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.ruleId).toBe(ruleId);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('checkCommand 放行正常命令', () => {
  const allowed = [
    'ls -la',
    'python train.py --lr 1e-4',
    'rm -rf build/',
    'rm -rf ./outputs/tmp',
    'rm -rf ~/projects/demo/outputs',
    'echo "sudo rm -rf /"',
    'grep -r "rm -rf /" .',
    'kill -9 12345',
    'kill -1 12345',
    'git status',
    'conda activate env && python a.py',
    'cat ~/.ssh/authorized_keys',
    'dd if=a.img of=/dev/null',
  ];

  it.each(allowed)('%s', (command) => {
    expect(checkCommand(command, ctx)).toEqual({ allowed: true });
  });
});

describe('checkCommand 停用规则', () => {
  it('停用 privilege 后放行 sudo', () => {
    expect(checkCommand('sudo ls', { remoteRoot: '~', disabledRules: ['privilege'] })).toEqual({ allowed: true });
  });

  it('只停用指定规则，其他规则仍生效', () => {
    const r = checkCommand('rm -rf ~', { remoteRoot: '~', disabledRules: ['privilege'] });
    expect(r.allowed).toBe(false);
  });
});
