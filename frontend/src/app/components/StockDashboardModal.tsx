"use client";

import {
  ColorType,
  createChart,
  CrosshairMode,
  LineStyle,
  LineSeries,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import React, { useState, useEffect, useRef } from "react";
import styles from "./StockDashboardModal.module.css";
import StockIcon from "./StockIcons";
import { StockQuote } from "./Watchlist";

type ChartTimeframe = "1M" | "3M" | "6M" | "1Y";
type ChartStatus = "loading" | "ready" | "empty" | "error";
type CandleSource = "finnhub" | "demo";

interface HistoricalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface HistoricalResponse {
  source: CandleSource;
  candles: HistoricalCandle[];
}

interface StockDashboardModalProps {
  quote: StockQuote;
  companyName: string;
  onClose: () => void;
}

function formatCandleTime(time: Time, timeframe: ChartTimeframe): string {
  if (typeof time === "string") return time;

  const date = typeof time === "number"
    ? new Date(time * 1000)
    : new Date(Date.UTC(time.year, time.month - 1, time.day));

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(timeframe === "1Y" ? { year: "numeric" } : {}),
  });
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
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1M");
  const [prices, setPrices] = useState<LineData<Time>[]>([]);
  const [chartStatus, setChartStatus] = useState<ChartStatus>("loading");
  const [historySource, setHistorySource] = useState<CandleSource | null>(null);
  const [activePrice, setActivePrice] = useState<LineData<Time> | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

  const metrics = STOCK_EXTRA_METRICS[quote.symbol.toUpperCase()] || {
    exchange: "NASDAQ",
    marketCap: "$1.2T",
    peRatio: "28.5",
    volume: "30.0M",
    low52: quote.c * 0.75,
    high52: quote.c * 1.25,
  };

  const isPositive = quote.dp !== null ? quote.dp >= 0 : true;
  const isChartPositive = prices.length > 0
    ? prices[prices.length - 1].value >= prices[0].value
    : isPositive;

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();

    const loadCandles = async () => {
      try {
        const response = await fetch(
          `${apiBase}/candles/${encodeURIComponent(quote.symbol)}?timeframe=${timeframe}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Historical prices request failed.");

        const payload = (await response.json()) as HistoricalResponse;
        if (
          !Array.isArray(payload.candles) ||
          (payload.source !== "demo" && payload.source !== "finnhub")
        ) {
          throw new Error("Invalid historical prices response.");
        }

        const chartPrices = payload.candles.flatMap((candle) => {
          const values = [candle.time, candle.close];
          if (!values.every(Number.isFinite)) return [];

          return [{ time: candle.time as UTCTimestamp, value: candle.close }];
        });

        setPrices(chartPrices);
        setHistorySource(payload.source);
        setChartStatus(chartPrices.length ? "ready" : "empty");
      } catch {
        if (!controller.signal.aborted) setChartStatus("error");
      }
    };

    void loadCandles();
    return () => controller.abort();
  }, [apiBase, quote.symbol, timeframe]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || chartStatus !== "ready") return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#fafafa" },
        textColor: "#71717a",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#f4f4f5" },
        horzLines: { color: "#e4e4e7" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Magnet },
      localization: { priceFormatter: (price: number) => `$${price.toFixed(2)}` },
    });
    const series = chart.addSeries(LineSeries, {
      color: isChartPositive ? "#059669" : "#dc2626",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      lastValueVisible: false,
    });
    series.setData(prices);
    series.createPriceLine({
      price: quote.c,
      color: isChartPositive ? "#059669" : "#dc2626",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Latest",
    });
    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(series);
      setActivePrice(point && "value" in point ? point : null);
    });
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [prices, chartStatus, isChartPositive, quote.c, timeframe]);

  const displayPrice = activePrice ? activePrice.value : quote.c;
  const displayTime = activePrice
    ? formatCandleTime(activePrice.time, timeframe)
    : "Latest quote";

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
            <div className={styles.chartControls}>
              <div className={styles.timeframeTabs}>
                {(["1M", "3M", "6M", "1Y"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.timeframeBtn} ${
                      timeframe === t ? styles.timeframeBtnActive : ""
                    }`}
                    onClick={() => {
                      setTimeframe(t);
                      setChartStatus("loading");
                      setHistorySource(null);
                      setActivePrice(null);
                    }}
                    aria-pressed={timeframe === t}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {historySource && (
                <span className={styles.chartSource}>
                  {historySource === "demo" ? "Demo history" : "Finnhub history"}
                </span>
              )}
            </div>

            {activePrice && (
              <div className={styles.chartScrubTooltip}>
                <span>{displayTime}</span>
                <span>${activePrice.value.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className={styles.chartSvgWrapper}>
            <div
              ref={chartContainerRef}
              className={styles.chartCanvas}
              role="img"
              aria-label={`${quote.symbol} historical price chart`}
            />
            {chartStatus !== "ready" && (
              <div className={styles.chartStatus} role="status">
                {chartStatus === "loading" && "Loading historical prices..."}
                {chartStatus === "empty" && "Historical price data is unavailable."}
                {chartStatus === "error" && "Could not load historical prices."}
              </div>
            )}
          </div>
        </div>

        {/* Financial Statistics Dashboard */}
        <div className={styles.statsSection}>
          <h3 className={styles.statsSectionTitle}>Key Statistics</h3>

          {/* Day Range Progress Bar */}
          <div className={styles.rangeBarWrapper}>
            <div className={styles.rangeBarHeader}>
                <span>Day&apos;s Range</span>
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
