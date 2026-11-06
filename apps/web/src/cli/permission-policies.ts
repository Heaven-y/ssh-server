import { claudePermissions } from './claude/permission-policy';
import { codexPermissions } from './codex/permission-policy';
import { antigravityPermissions } from './antigravity/permission-policy';

export const permissionChoices = {
  claude: claudePermissions,
  codex: codexPermissions,
  antigravity: antigravityPermissions,
};
