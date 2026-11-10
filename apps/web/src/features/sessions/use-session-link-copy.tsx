import { useEffect, useRef, useState } from 'react';
import { formatSessionReference, type SessionRef } from '@agentdeck/shared/conversation';
import { inputClass } from '../../ui/styles';

export function useSessionLinkCopy(workspaceId: string) {
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const clear = () => {
    generation.current++;
    setNotice('');
    setLink('');
  };
  const copy = async (session: SessionRef, kind: 'link' | 'id' = 'link') => {
    clear();
    const token = generation.current;
    const value =
      kind === 'id'
        ? session.sessionId
        : formatSessionReference({ workspaceId, agent: session.agent, sessionId: session.sessionId });
    try {
      await navigator.clipboard.writeText(value);
      if (token === generation.current)
        setNotice(kind === 'id' ? '会话 ID 已复制' : '会话链接已复制，可粘贴给 Agent 阅读');
    } catch {
      if (token !== generation.current) return;
      setLink(value);
      setNotice('浏览器未允许写入剪贴板，请手动复制下方内容');
    }
  };
  return { notice, link, clear, copy };
}

export function SessionLinkNotice({ notice, link }: { notice: string; link: string }) {
  return (
    <div className="w-full min-w-0 px-4 text-xs leading-5 text-muted-foreground">
      <p role="status">{notice}</p>
      {link && (
        <label className="block py-2">
          手动复制会话引用
          <input
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className={`${inputClass} mt-1`}
          />
        </label>
      )}
    </div>
  );
}
