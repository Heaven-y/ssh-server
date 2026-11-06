import './resources.css';

/** 缺失值不画零进度，0% 仍是有效采样；仪表仅辅助可见数值。 */
export function ResourceMeter({
  label,
  value,
  tone = 'cpu',
}: {
  label: string;
  value: number | null;
  tone?: 'cpu' | 'gpu' | 'memory';
}) {
  if (value === null || !Number.isFinite(value))
    return <span className="resource-meter resource-meter-unavailable" aria-hidden />;
  const percent = Math.max(0, Math.min(100, value));
  return (
    <span
      className={`resource-meter resource-tone-${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${value.toFixed(1)}%`}
    >
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}
export function capacityPercent(used: number | null, total: number | null): number | null {
  return used !== null && total !== null && total > 0 ? (used / total) * 100 : null;
}
