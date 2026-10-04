// 合成指标经过真实SSH通道，用于可重复的网页故障/空值验收。
import type { FixtureExec } from './terminal-fixture';

export const resourceSection = (name: string, text: string) => `\x1e${name}\x1f\n${text}\n`;
export function resourceFixtureOutput(frame: number): string {
  return [
    resourceSection('host', 'fixture-node'),
    resourceSection('cpu', `cpu ${100 + frame * 10} 0 100 ${800 + frame * 10} 0 0 0 0 0 0`),
    resourceSection('load', '1.20 0.80 0.50 1/10 123'),
    resourceSection('memory', 'MemTotal: 8388608 kB\nMemAvailable: 4194304 kB'),
    resourceSection('gpu', '3, GPU-demo, "Fixture, GPU", 42, 1024, 8192, N/A, 120.5'),
    resourceSection('gpuprocess', '123, GPU-demo, 512'),
    resourceSection('gpustatus', '0'),
    resourceSection('process', '123 12.5 65536 python\n456 0.0 1024 sleep'),
    resourceSection('done', ''),
  ].join('');
}
export function createResourceFixture() {
  const state = { hostSamples: 0, diskSamples: 0, failure: false };
  const exec: FixtureExec = (command) => {
    if (command.includes('/proc/stat')) {
      state.hostSamples++;
      return { stdout: state.failure ? '' : resourceFixtureOutput(state.hostSamples), exitCode: state.failure ? 1 : 0 };
    }
    if (command.includes('df -Pk')) {
      state.diskSamples++;
      return { stdout: state.failure ? '' : '/dev/demo 10000 4000 6000 40% /demo\n', exitCode: state.failure ? 1 : 0 };
    }
  };
  return { state, exec };
}
