export function OverviewRing({
  value,
  total,
  label,
  text,
}: {
  value: number;
  total: number;
  label: string;
  text: string;
}) {
  return (
    <div className="b-ring">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label}: ${text}`}>
        <circle
          cx="50"
          cy="50"
          r="43"
          fill="none"
          stroke="var(--rule)"
          strokeWidth="5"
        />
        <circle
          cx="50"
          cy="50"
          r="43"
          fill="none"
          stroke="var(--hue)"
          opacity={value > 0 && total > 0 ? 1 : 0}
          strokeWidth="5"
          pathLength="100"
          strokeDasharray={`${total ? Math.min(100, (value / total) * 100) : 0} 100`}
          transform="rotate(-90 50 50)"
          strokeLinecap="round"
        />
      </svg>
      <strong>{text}</strong>
    </div>
  );
}
