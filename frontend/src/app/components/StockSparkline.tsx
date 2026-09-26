import React, { useId } from "react";

interface SparklineProps {
  symbol: string;
  c: number;
  dp: number | null;
  o?: number;
  h?: number;
  l?: number;
  pc?: number;
  width?: number;
  height?: number;
}

/**
 * Generates deterministic, aesthetically pleasing sparkline data points
 * anchored to the real quotes metrics (open, low, high, close).
 */
function generatePoints(
  symbol: string,
  c: number,
  dp: number | null,
  o?: number,
  h?: number,
  l?: number,
  width: number = 80,
  height: number = 32
): { linePath: string; areaPath: string; lastPoint: { x: number; y: number } } {
  const isPositive = dp !== null && dp >= 0;
  const count = 10;
  const paddingY = 4;

  const openVal = o && o > 0 ? o : isPositive ? c * 0.985 : c * 1.015;
  const highVal = h && h > 0 ? Math.max(h, c, openVal) : Math.max(c, openVal) * 1.008;
  const lowVal = l && l > 0 ? Math.min(l, c, openVal) : Math.min(c, openVal) * 0.992;
  const closeVal = c;

  const range = highVal - lowVal || 1;

  // Simple deterministic pseudo-random hash based on symbol characters
  let seed = symbol.split("").reduce((acc, char) => acc + char.charCodeAt(0), 42);
  const nextPseudo = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const values: number[] = [openVal];

  for (let i = 1; i < count - 1; i++) {
    const progress = i / (count - 1);
    const trend = openVal + (closeVal - openVal) * progress;
    // Add small realistic wave variation bounded by high and low
    const wave = (nextPseudo() - 0.5) * range * 0.45;
    const val = Math.min(highVal, Math.max(lowVal, trend + wave));
    values.push(val);
  }
  values.push(closeVal);

  // Map values to SVG coordinates (x, y)
  const coords = values.map((val, i) => {
    const x = (i / (count - 1)) * (width - 6) + 3;
    const norm = (val - lowVal) / range;
    // Invert Y for SVG coordinates
    const y = height - paddingY - norm * (height - paddingY * 2);
    return { x, y };
  });

  // Build smooth bezier curve
  let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const curr = coords[i];
    const next = coords[i + 1];
    const cpX = (curr.x + next.x) / 2;
    linePath += ` C ${cpX.toFixed(1)} ${curr.y.toFixed(1)}, ${cpX.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }

  const lastCoord = coords[coords.length - 1];
  const firstCoord = coords[0];
  const areaPath = `${linePath} L ${lastCoord.x.toFixed(1)} ${height} L ${firstCoord.x.toFixed(1)} ${height} Z`;

  return { linePath, areaPath, lastPoint: lastCoord };
}

export default function StockSparkline({
  symbol,
  c,
  dp,
  o,
  h,
  l,
  width = 76,
  height = 32,
}: SparklineProps) {
  const gradientId = useId().replace(/:/g, "_");
  const isPositive = dp !== null && dp >= 0;

  const strokeColor = isPositive ? "#10b981" : "#ef4444";
  const stopColor = isPositive ? "rgba(16, 185, 129, 0.22)" : "rgba(239, 68, 68, 0.22)";

  const { linePath, areaPath, lastPoint } = generatePoints(symbol, c, dp, o, h, l, width, height);

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
      title={`${symbol} Intraday Trend`}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stopColor} />
            <stop offset="100%" stopColor={stopColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gradient Area Fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Clean Line Path */}
        <path
          d={linePath}
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Pulsing End Dot */}
        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.5" fill={strokeColor} />
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="4.5"
          fill={strokeColor}
          opacity="0.3"
        />
      </svg>
    </div>
  );
}
