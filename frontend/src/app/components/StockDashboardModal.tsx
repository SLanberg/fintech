"use client";

import React, { useState, useId, useEffect, useMemo, useRef } from "react";
import styles from "./StockDashboardModal.module.css";
import StockIcon from "./StockIcons";
import { StockQuote } from "./Watchlist";

interface StockDashboardModalProps {
  quote: StockQuote;
  companyName: string;
  onClose: () => void;
}

const STOCK_EXTRA_METRICS: Record<
  string,
  { exchange: string; marketCap: string; peRatio: string; volume: string; low52: number; high52: number }
> = {
  AAPL: { exchange: "NASDAQ", marketCap: "$3.42T", peRatio: "34.2", volume: "48.2M", low52: 164.08, high52: 342.1 },
  MSFT: { exchange: "NASDAQ", marketCap: "$3.12T", peRatio: "36.1", volume: "21.6M", low52: 388.0, high52: 520.4 },
  NVDA: { exchange: "NASDAQ", marketCap: "$2.85T", peRatio: "62.4", volume: "64.1M", low52: 75.6, high52: 230.2 },
  TSLA: { exchange: "NASDAQ", marketCap: "$785.4B", peRatio: "68.5", volume: "56.8M", low52: 138.8, high52: 395.0 },
  GOOGL: { exchange: "NASDAQ", marketCap: "$2.15T", peRatio: "24.8", volume: "27.4M", low52: 130.2, high52: 350.5 },
};

export default function StockDashboardModal({
  quote,
  companyName,
  onClose,
}: StockDashboardModalProps) {
  const gradientId = useId().replace(/:/g, "_");
  const [timeframe, setTimeframe] = useState<"1D" | "1W" | "1M" | "1Y">("1D");
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const metrics = STOCK_EXTRA_METRICS[quote.symbol.toUpperCase()] || {
    exchange: "NASDAQ",
    marketCap: "$1.2T",
    peRatio: "28.5",
    volume: "30.0M",
    low52: quote.c * 0.75,
    high52: quote.c * 1.25,
  };

  const isPositive = quote.dp !== null ? quote.dp >= 0 : true;
  const strokeColor = isPositive ? "#10b981" : "#ef4444";
  const stopColor = isPositive ? "rgba(16, 185, 129, 0.28)" : "rgba(239, 68, 68, 0.28)";

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Generate 24 chart points based on timeframe and real quote values
  const chartPoints = useMemo(() => {
    const pointsCount = 24;
    const baseOpen = quote.o || quote.pc || quote.c * (isPositive ? 0.98 : 1.02);
    const dayHigh = quote.h || Math.max(quote.c, baseOpen) * 1.01;
    const dayLow = quote.l || Math.min(quote.c, baseOpen) * 0.99;
    const dayClose = quote.c;

    // Adjust variance based on selected timeframe
    const varianceMultipliers = { "1D": 0.4, "1W": 1.2, "1M": 2.5, "1Y": 4.5 };
    const mult = varianceMultipliers[timeframe];
    const spread = (dayHigh - dayLow) * mult;

    let seed = quote.symbol.split("").reduce((acc, c) => acc + c.charCodeAt(0), 101);
    const nextRand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const pts: { time: string; price: number }[] = [];
    const startTimeHour = 9.5; // 9:30 AM
    const endTimeHour = 16.0; // 4:00 PM

    for (let i = 0; i < pointsCount; i++) {
      const progress = i / (pointsCount - 1);
      const trend = baseOpen + (dayClose - baseOpen) * progress;
      const noise = (nextRand() - 0.5) * spread;
      const price = Math.max(dayLow * 0.95, trend + noise);

      // Label
      let timeLabel = "";
      if (timeframe === "1D") {
        const h = Math.floor(startTimeHour + progress * (endTimeHour - startTimeHour));
        const m = Math.floor(((startTimeHour + progress * (endTimeHour - startTimeHour)) % 1) * 60);
        timeLabel = `${h > 12 ? h - 12 : h}:${m < 10 ? "0" : ""}${m} ${h >= 12 ? "PM" : "AM"}`;
      } else if (timeframe === "1W") {
        const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
        timeLabel = days[Math.floor(progress * (days.length - 0.01))];
      } else if (timeframe === "1M") {
        timeLabel = `Day ${Math.floor(progress * 29) + 1}`;
      } else {
        const months = ["Jan", "Mar", "May", "Jul", "Sep", "Nov"];
        timeLabel = months[Math.floor(progress * (months.length - 0.01))];
      }

      pts.push({
        time: timeLabel,
        price: Number((i === pointsCount - 1 ? dayClose : price).toFixed(2)),
      });
    }

    return pts;
  }, [quote, timeframe, isPositive]);

  // Map to SVG coordinates (width 500, height 170)
  const svgData = useMemo(() => {
    const width = 500;
    const height = 170;
    const padY = 16;
    const padX = 8;

    const prices = chartPoints.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const diff = max - min || 1;

    const coords = chartPoints.map((p, i) => {
      const x = padX + (i / (chartPoints.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.price - min) / diff) * (height - padY * 2);
      return { x, y, price: p.price, time: p.time };
    });

    let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX = (curr.x + next.x) / 2;
      linePath += ` C ${cpX.toFixed(1)} ${curr.y.toFixed(1)}, ${cpX.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }

    const first = coords[0];
    const last = coords[coords.length - 1];
    const areaPath = `${linePath} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;

    return { coords, linePath, areaPath, width, height, min, max };
  }, [chartPoints]);

  const activeCoord = scrubIndex !== null ? svgData.coords[scrubIndex] : null;
  const displayPrice = activeCoord ? activeCoord.price : quote.c;
  const displayTime = activeCoord ? activeCoord.time : "Real-time Finnhub";

  // Mouse scrubbing handler
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const idx = Math.round(ratio * (chartPoints.length - 1));
    setScrubIndex(idx);
  };

  const handleMouseLeave = () => {
    setScrubIndex(null);
  };

  // Day Range position
  const dayLow = quote.l || quote.c * 0.98;
  const dayHigh = quote.h || quote.c * 1.02;
  const rangeSpan = dayHigh - dayLow || 1;
  const currentRatio = Math.max(0, Math.min(1, (quote.c - dayLow) / rangeSpan)) * 100;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.brandGroup}>
            <StockIcon symbol={quote.symbol} size={48} />
            <div className={styles.titleArea}>
              <div className={styles.symbolRow}>
                <span className={styles.symbol}>{quote.symbol}</span>
                <span className={styles.exchangeBadge}>{metrics.exchange}</span>
              </div>
              <span className={styles.companyName}>{companyName}</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close stock dashboard"
          >
            ✕
          </button>
        </div>

        {/* Current Price Hero */}
        <div className={styles.priceSection}>
          <div className={styles.priceRow}>
            <span className={styles.price}>
              ${displayPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={styles.currency}>USD</span>
          </div>

          <div className={styles.changeRow}>
            <span
              className={`${styles.changeBadge} ${
                isPositive ? styles.changeBadgePositive : styles.changeBadgeNegative
              }`}
            >
              <span>{isPositive ? "↗" : "↘"}</span>
              {quote.d !== null && (
                <span>{quote.d >= 0 ? `+$${quote.d.toFixed(2)}` : `-$${Math.abs(quote.d).toFixed(2)}`}</span>
              )}
              {quote.dp !== null && (
                <span>({quote.dp >= 0 ? "+" : ""}{quote.dp.toFixed(2)}%)</span>
              )}
            </span>
            <span className={styles.marketTime}>• {displayTime}</span>
          </div>
        </div>

        {/* Minimalistic Interactive Graph */}
        <div className={styles.chartContainer}>
          <div className={styles.chartHeader}>
            <div className={styles.timeframeTabs}>
              {(["1D", "1W", "1M", "1Y"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.timeframeBtn} ${
                    timeframe === t ? styles.timeframeBtnActive : ""
                  }`}
                  onClick={() => {
                    setTimeframe(t);
                    setScrubIndex(null);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {activeCoord && (
              <div className={styles.chartScrubTooltip}>
                <span>${activeCoord.price.toFixed(2)}</span>
                <span style={{ color: "#71717a", fontWeight: 400 }}>({activeCoord.time})</span>
              </div>
            )}
          </div>

          <div className={styles.chartSvgWrapper}>
            <svg
              ref={svgRef}
              className={styles.chartSvg}
              viewBox={`0 0 ${svgData.width} ${svgData.height}`}
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stopColor} />
                  <stop offset="100%" stopColor={stopColor} stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Area Under Curve */}
              <path d={svgData.areaPath} fill={`url(#${gradientId})`} />

              {/* Curve Line */}
              <path
                d={svgData.linePath}
                stroke={strokeColor}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Crosshair indicator on hover */}
              {activeCoord && (
                <>
                  <line
                    x1={activeCoord.x}
                    y1={0}
                    x2={activeCoord.x}
                    y2={svgData.height}
                    stroke="#71717a"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.6"
                  />
                  <circle
                    cx={activeCoord.x}
                    cy={activeCoord.y}
                    r="5"
                    fill={strokeColor}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* Financial Statistics Dashboard */}
        <div className={styles.statsSection}>
          <h3 className={styles.statsSectionTitle}>Key Statistics</h3>

          {/* Day Range Progress Bar */}
          <div className={styles.rangeBarWrapper}>
            <div className={styles.rangeBarHeader}>
              <span>Day's Range</span>
              <span>
                ${dayLow.toFixed(2)} - ${dayHigh.toFixed(2)}
              </span>
            </div>
            <div className={styles.rangeBarTrack}>
              <div
                className={styles.rangeBarFill}
                style={{ width: `${currentRatio}%` }}
              />
            </div>
          </div>

          {/* Stats Grid */}
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Open</span>
              <span className={styles.statValue}>
                ${(quote.o || quote.c).toFixed(2)}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Previous Close</span>
              <span className={styles.statValue}>
                ${(quote.pc || quote.c).toFixed(2)}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Day High</span>
              <span className={styles.statValue}>${dayHigh.toFixed(2)}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Day Low</span>
              <span className={styles.statValue}>${dayLow.toFixed(2)}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Volume</span>
              <span className={styles.statValue}>{metrics.volume}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Market Cap</span>
              <span className={styles.statValue}>{metrics.marketCap}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>P/E Ratio</span>
              <span className={styles.statValue}>{metrics.peRatio}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>52-Week Range</span>
              <span className={styles.statValue}>
                ${metrics.low52.toFixed(1)} - ${metrics.high52.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.tradeBtn}
            onClick={() =>
              alert(`Simulated order: Buy order placed for ${quote.symbol} at $${quote.c.toFixed(2)}!`)
            }
          >
            <span>Trade {quote.symbol}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.alertBtn}
            onClick={() => alert(`Price alert set for ${quote.symbol} at $${quote.c.toFixed(2)}!`)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            Alert
          </button>
        </div>
      </div>
    </div>
  );
}
