import type { AgentKind, SessionSummary } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { useSessionPages } from '../sessions/use-session-pages';
export type SessionListFailure = { agent: AgentKind; message: string };

export function useProjectSessions(projects: Workspace[] | undefined, search = '') {
  const page = useSessionPages({ search, enabled: !!projects?.length });
  const sessionsByProject: Record<string, SessionSummary[]> = {};
  const errorsByProject: Record<string, SessionListFailure[]> = {};
  for (const project of projects ?? []) {
    sessionsByProject[project.id] = page.sessions.filter((session) => session.projectId === project.id);
    errorsByProject[project.id] = page.errors;
  }
  return { ...page, sessionsByProject, errorsByProject, retryProject: page.retry };
}

export function useOtherSessions(enabled: boolean, search = '') {
  const page = useSessionPages({ scope: 'unassigned', enabled, search });
  return { ...page, error: page.errors.map((error) => error.message).join('；') || undefined };
}
