import type { BuiltinPluginRegistration } from '../features/plugins/builtin-contracts';
import { sshConsoleRegistration } from './ssh-console/registration';
/** 内置业务只有这里集中注册；外部静态插件仍由宿主按清单加载。 */
export const builtinPlugins: Readonly<Record<string, BuiltinPluginRegistration>> = {
  [sshConsoleRegistration.id]: sshConsoleRegistration,
};
