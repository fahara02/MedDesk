interface SparklineProps {
  values: number[];
}

export function Sparkline({ values }: SparklineProps) {
  if (!values.length) return null;
  const usableValues = values.length > 1 ? values : [values[0], values[0]];
  const minimum = Math.min(...usableValues) - 5;
  const maximum = Math.max(...usableValues) + 5;
  const range = Math.max(maximum - minimum, 1);
  const points = usableValues
    .map((value, index) => {
      const x = (index / (usableValues.length - 1)) * 100;
      const y = 44 - ((value - minimum) / range) * 36;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 100 48" preserveAspectRatio="none" aria-label="Recent heart rate trend">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#de5d51" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#de5d51" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,48 ${points} 100,48`} fill="url(#chartFill)" />
      <polyline points={points} fill="none" stroke="#de5d51" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
