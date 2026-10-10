import { useEffect, useRef, useState } from 'react';
import type { SessionRef } from '@ssh-server/shared';
import { inputClass } from '../../ui/styles';
import { sessionLink } from './session-links';

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
  const copy = async (session: SessionRef) => {
    clear();
    const token = generation.current;
    const value = sessionLink(
      { workspaceId, agent: session.agent, sessionId: session.sessionId },
      window.location.href,
    );
    try {
      await navigator.clipboard.writeText(value);
      if (token === generation.current) setNotice('会话链接已复制');
    } catch {
      if (token !== generation.current) return;
      setLink(value);
      setNotice('浏览器未允许写入剪贴板，请手动复制下方链接');
    }
  };
  return { notice, link, clear, copy };
}

export function SessionLinkNotice({ notice, link }: { notice: string; link: string }) {
  return (
    <div className="px-4 text-xs leading-5 text-muted-foreground">
      <p role="status">{notice}</p>
      {link && (
        <label className="block py-2">
          手动复制会话链接
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
