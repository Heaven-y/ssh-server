const tokenMultiplier = (suffix = '') => ({ k: 1000n, m: 1000000n })[suffix.toLowerCase()] ?? 1n;

export function modelContextWindow(value: string | null | undefined, label = '上下文窗口'): number | null {
  if (!value?.trim()) return null;
  const invalid = () => new Error(`${label}必须是正整数（tokens），支持 128K、1.5M 等写法。`);
  const match = /^(\d+)(?:\.(\d+))?\s*([km])?$/i.exec(value.trim());
  if (!match) throw invalid();
  const fraction = match[2] ?? '';
  const multiplier = tokenMultiplier(match[3]);
  // 十进制精确换算，避免 1.001K 的浮点乘法误差或超大值被静默取整。
  const numerator = BigInt(match[1]! + fraction) * multiplier;
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator % denominator !== 0n) throw invalid();
  const tokens = numerator / denominator;
  if (tokens < 1n || tokens > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  return Number(tokens);
}
