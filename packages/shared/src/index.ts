// 兼容根出口；新调用方按领域子路径导入。
export * from './conversation';
export * from './projects';
export * from './settings';
export * from './plugins';
export * from './ssh';
export { legacySessionCapabilities as nativeSessionCapabilities } from './conversation/legacy-session-capabilities';
