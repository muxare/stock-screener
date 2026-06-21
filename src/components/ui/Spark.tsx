/**
 * Sparkline — port of the POC's `spark(arr, color)` helper. Renders a tiny
 * polyline; defaults to green when the series ends up, red when it ends down.
 */
export function Spark({
  values,
  color,
  width = 84,
  height = 24,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rng = (max - min) || 1;
  const up = values[values.length - 1] >= values[0];
  const pts = values
    .map((v, i) =>
      `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / rng) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color || (up ? '#06a96b' : '#e23d3d')}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
