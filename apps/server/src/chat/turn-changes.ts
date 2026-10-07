import {
  SyncSettingsSchema,
  type AgentKind,
  type TurnChangesRecord,
  type TurnDiff,
  type Workspace,
} from '@ssh-server/shared';
import { VersionError } from '../vcs/errors';
import { sha256 } from '../vcs/repository';
import type { VersionsService } from '../vcs/service';
import { SessionError } from './sessions';
import { createTurnChangesStore, type StoredTurn } from './turn-changes-store';

export type TurnIdentity = { agent: AgentKind; sessionId?: string };
type Deps = {
  configDir: string;
  versions: Pick<VersionsService, 'turnScope' | 'captureTurn' | 'diffTurn' | 'releaseTurn'>;
};
const binding = (ws: Workspace) =>
  sha256(JSON.stringify([ws.id, ws.localDir, ws.sshHost, ws.remoteDir, SyncSettingsSchema.parse(ws.sync ?? {})]));
const unavailable = (error: unknown) =>
  error instanceof VersionError ? error.message : '本轮文件快照不可用，请检查本地版本记录';
function publicRecord(record: StoredTurn): TurnChangesRecord {
  const { binding: _binding, base: _base, result: _result, ...value } = record;
  return value;
}
const owns = (record: StoredTurn, target: TurnIdentity) =>
  record.agent === target.agent && record.sessionId === target.sessionId;

export function createTurnChanges(deps: Deps) {
  const store = createTurnChangesStore(deps.configDir);
  const terminalFailures = new Map<string, Set<string>>();

  async function recoverTerminal(ws: Workspace, records: StoredTurn[]): Promise<StoredTurn[]> {
    const failed = terminalFailures.get(ws.id);
    if (!failed?.size) return records;
    const repaired = records.map((record): StoredTurn =>
      failed.has(record.turnId) && record.phase === 'running'
        ? {
            ...record,
            phase: 'incomplete',
            completedAt: Date.now(),
            message: '采集记录保存失败；已结束采集，未重跑Agent或同步',
          }
        : record,
    );
    await store.persist(ws.id, repaired);
    terminalFailures.delete(ws.id);
    return repaired;
  }

  async function persistCaptured(
    ws: Workspace,
    records: StoredTurn[],
    turnId: string,
    captured?: StoredTurn['base'],
  ): Promise<void> {
    try {
      await store.persist(ws.id, records);
    } catch (error) {
      const failed = terminalFailures.get(ws.id) ?? new Set<string>();
      failed.add(turnId);
      terminalFailures.set(ws.id, failed);
      // 仅清理本次尚未写入元数据的新引用，保留既有轮次的基线。
      if (captured) await deps.versions.releaseTurn(ws, [captured]).catch(() => undefined);
      throw error;
    }
  }

  async function removeOldest(ws: Workspace, records: StoredTurn[]): Promise<StoredTurn[]> {
    if (records.length < 20) return records;
    const oldest = records.find((record) => record.phase !== 'running');
    if (!oldest) throw new SessionError(409, 'changes_capacity', '已有20轮正在采集，本轮不再创建文件快照');
    const kept = records.filter((record) => record.turnId !== oldest.turnId);
    await store.persist(ws.id, kept);
    // 先移除元数据再清理引用；崩溃最多留下拥有的引用，不留下指向已删除树的记录。
    await deps.versions
      .releaseTurn(
        ws,
        [oldest.base, oldest.result].filter((value) => value !== undefined),
      )
      .catch(() => undefined);
    return kept;
  }

  function readRecord(ws: Workspace, records: StoredTurn[], turnId: string, target: TurnIdentity) {
    const record = records.find(
      (value) => value.turnId === turnId && value.binding === binding(ws) && owns(value, target),
    );
    if (!record) throw new SessionError(404, 'changes_missing', '当前工作区和会话没有此轮改动记录');
    if (!record.base || !record.result)
      throw new SessionError(409, 'changes_unavailable', record.message ?? '本轮快照尚未完成');
    return record;
  }

  return {
    begin(ws: Workspace, turnId: string, target: TurnIdentity): Promise<void> {
      return store.serial(ws.id, async (previous) => {
        const records = await recoverTerminal(ws, previous);
        if (records.some((record) => record.turnId === turnId))
          throw new SessionError(409, 'changes_duplicate', '本轮已经开始采集');
        const kept = await removeOldest(ws, records);
        const record: StoredTurn = {
          turnId,
          ...target,
          binding: binding(ws),
          startedAt: Date.now(),
          phase: 'running',
          changes: [],
        };
        await store.persist(ws.id, [...kept, record]);
        try {
          record.base = await deps.versions.captureTurn(ws, turnId, 'base');
        } catch (error) {
          record.phase = 'unavailable';
          record.message = unavailable(error);
        }
        await persistCaptured(ws, [...kept, record], turnId, record.base);
      });
    },
    finish(
      ws: Workspace,
      turnId: string,
      input: { sessionId?: string; interrupted: boolean },
    ): Promise<TurnChangesRecord | undefined> {
      return store.serial(ws.id, async (previous) => {
        const records = await recoverTerminal(ws, previous);
        const index = records.findIndex((record) => record.turnId === turnId);
        if (index < 0) return undefined;
        const record: StoredTurn = { ...records[index]!, sessionId: input.sessionId, completedAt: Date.now() };
        try {
          if (record.binding !== binding(ws)) throw new VersionError('stale_revision');
          if (record.base) {
            record.result = await deps.versions.captureTurn(ws, turnId, 'result');
            const diff = await deps.versions.diffTurn(ws, record.base, record.result);
            record.changes = diff.changes;
            record.excluded = diff.excluded;
            record.phase = input.interrupted ? 'incomplete' : 'complete';
            record.message = input.interrupted ? '本轮已中断；显示采集期间实际本地净差异' : undefined;
          } else {
            record.phase = 'unavailable';
            record.message ??= '未能保存本轮基线，文件快照不可用';
          }
        } catch (error) {
          record.phase = 'unavailable';
          record.message = unavailable(error);
          record.changes = [];
        }
        await persistCaptured(
          ws,
          records.map((value, at) => (at === index ? record : value)),
          turnId,
          record.result,
        );
        return publicRecord(record);
      });
    },
    list(ws: Workspace, target: TurnIdentity): Promise<TurnChangesRecord[]> {
      return store.serial(ws.id, async (previous) => {
        const records = await recoverTerminal(ws, previous);
        if (!target.sessionId) return [];
        const current = await deps.versions.turnScope(ws).catch(() => undefined);
        return records
          .filter(
            (record) =>
              record.binding === binding(ws) &&
              owns(record, target) &&
              (!record.base || record.base.scope === current?.scope),
          )
          .map(publicRecord)
          .reverse();
      });
    },
    diff(ws: Workspace, turnId: string, target: TurnIdentity, path?: string): Promise<TurnDiff> {
      return store.serial(ws.id, async (previous) => {
        const records = await recoverTerminal(ws, previous);
        const record = readRecord(ws, records, turnId, target);
        return deps.versions.diffTurn(ws, record.base!, record.result!, path);
      });
    },
  };
}
export type TurnChanges = ReturnType<typeof createTurnChanges>;
