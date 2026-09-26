interface SparklineProps {
  symbol: string;
  c: number;
  dp: number | null;
  o?: number;
  h?: number;
  l?: number;
  pc?: number;
  prices?: number[];
  width?: number;
  height?: number;
}

export default function StockSparkline({
  symbol,
  c,
  dp,
  o,
  h,
  l,
  pc,
  prices = [],
  width = 76,
  height = 32,
}: SparklineProps) {
  const referencePrice = pc && pc > 0 ? pc : o && o > 0 ? o : c;
  const series = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (series.length === 0 || series[series.length - 1] !== c) series.push(c);
  if (series.length === 1) series.unshift(referencePrice);
  const firstPrice = series[0];
  const lastPrice = series[series.length - 1];
  const displayColor = lastPrice > firstPrice
    ? "#10b981"
    : lastPrice < firstPrice
      ? "#ef4444"
      : "#a1a1aa";

  const minPrice = Math.min(...series);
  const maxPrice = Math.max(...series);
  const priceRange = maxPrice - minPrice || Math.max(Math.abs(c) * 0.01, 0.01);
  const yForPrice = (price: number) =>
    height - 4 - ((price - minPrice) / priceRange) * (height - 8);
  const startX = 3;
  const endX = width - 3;
  const points = series.map((price, index) => {
    const x = startX + (index / (series.length - 1)) * (endX - startX);
    return { x, y: yForPrice(price) };
  });
  const path = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const start = points[0];
  const end = points[points.length - 1];

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
      }}
      title={`${symbol}: previous close $${referencePrice.toFixed(2)}, open $${(o ?? c).toFixed(2)}, high $${(h ?? c).toFixed(2)}, low $${(l ?? c).toFixed(2)}, current $${c.toFixed(2)}${dp === null ? "" : ` (${dp >= 0 ? "+" : ""}${dp.toFixed(2)}%)`}`}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        style={{ overflow: "visible" }}
        role="img"
        aria-label={`${symbol}: price history from $${series[0].toFixed(2)} to $${c.toFixed(2)}`}
      >
        <path
          d={path}
          stroke={displayColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={start.x} cy={start.y} r="2" fill="#a1a1aa" />
        <circle cx={end.x} cy={end.y} r="2.5" fill={displayColor} />
      </svg>
    </div>
  );
}
