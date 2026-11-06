import { ApiError } from '../../../src/lib/http';
import { describe, expect, it } from 'vitest';

import { sessionHistoryFailure } from '../../../src/features/sessions/use-sessions';

describe('会话历史读取失败分类', () => {
  it('把不可回放、会话不存在、网络失败与其它错误分开', () => {
    expect(
      sessionHistoryFailure(
        new ApiError(501, 'Antigravity 的会话历史以私有轨迹格式保存在本机，当前无法读取；可以继续对话。', {
          code: 'session_not_replayable',
        }),
      ),
    ).toMatchObject({ kind: 'not-replayable' });
    expect(sessionHistoryFailure(new ApiError(404, '没有这个会话', { code: 'session_missing' }))).toMatchObject({
      kind: 'missing',
    });
    expect(sessionHistoryFailure(new TypeError('fetch failed'))).toMatchObject({ kind: 'network' });
    expect(sessionHistoryFailure(new ApiError(500, '原生读取失败'))).toMatchObject({ kind: 'failed' });
  });
});
