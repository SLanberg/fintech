"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./Watchlist.module.css";
import StockIcon from "./StockIcons";
import StockSparkline from "./StockSparkline";
import StockDashboardModal from "./StockDashboardModal";

export interface StockQuote {
  symbol: string;
  c: number;
  d: number | null;
  dp: number | null;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  t?: number;
}

interface WatchlistProps {
  apiBase?: string;
}

const WATCHLIST_SYMBOLS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "TSLA", name: "Tesla, Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
];

export default function Watchlist({
  apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api",
}: WatchlistProps) {
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Selected stock for dashboard modal
  const [selectedStock, setSelectedStock] = useState<{ quote: StockQuote; name: string } | null>(null);

  const fetchQuotes = useCallback(
    async (isManual = false) => {
      if (isManual) {
        setRefreshing(true);
      }
      setError(null);

      try {
        const fetchPromises = WATCHLIST_SYMBOLS.map(async ({ symbol }) => {
          const res = await fetch(`${apiBase}/quote/${symbol}`);
          if (!res.ok) {
            throw new Error(`Failed to load quote for ${symbol} (status ${res.status})`);
          }
          const data: StockQuote = await res.json();
          return data;
        });

        const results = await Promise.all(fetchPromises);
        const nextMap: Record<string, StockQuote> = {};
        for (const item of results) {
          nextMap[item.symbol.toUpperCase()] = item;
        }

        setQuotes(nextMap);
        setLastUpdated(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      } catch (err: any) {
        console.error("Watchlist fetch error:", err);
        setError(err.message || "Failed to fetch stock quotes");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase]
  );

  useEffect(() => {
    fetchQuotes();

    // Auto-refresh every 60 seconds
    const intervalId = setInterval(() => {
      fetchQuotes();
    }, 60000);

    return () => clearInterval(intervalId);
  }, [fetchQuotes]);

  return (
    <>
      <section className={styles.watchlistSection} aria-label="Market Watchlist">
        <div className={styles.headerRow}>
          <div className={styles.titleArea}>
            <h2 className={styles.sectionTitle}>Market Watchlist</h2>
            <span className={styles.liveBadge} title="Real-time Finnhub stock quotes">
              <span className={styles.liveDot} />
              60s Live
            </span>
          </div>

          <div className={styles.refreshControls}>
            {lastUpdated && !loading && (
              <span className={styles.lastUpdated}>Updated {lastUpdated}</span>
            )}
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => fetchQuotes(true)}
              disabled={loading || refreshing}
              aria-label="Refresh stock quotes"
              title="Refresh now"
            >
              {refreshing ? "⟳ Refreshing..." : "⟳ Refresh"}
            </button>
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading && Object.keys(quotes).length === 0 && (
          <div className={styles.grid}>
            {WATCHLIST_SYMBOLS.map((item) => (
              <div key={item.symbol} className={styles.skeletonCard}>
                <div className={styles.stockLeft}>
                  <div className={styles.skeletonIcon} />
                  <div className={styles.skeletonTextGroup}>
                    <div className={styles.skeletonBarLong} />
                    <div className={styles.skeletonBarShort} />
                  </div>
                </div>
                <div className={styles.skeletonSparkline} />
                <div className={styles.stockRight}>
                  <div className={styles.skeletonBarPrice} />
                  <div className={styles.skeletonBarBadge} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error Banner with Retry */}
        {error && (
          <div className={styles.errorContainer}>
            <p className={styles.errorMessage}>⚠️ {error}</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => fetchQuotes(true)}
            >
              Retry Quotes
            </button>
          </div>
        )}

        {/* Quotes Cards Grid */}
        {(!loading || Object.keys(quotes).length > 0) && (
          <div className={styles.grid}>
            {WATCHLIST_SYMBOLS.map(({ symbol, name }) => {
              const quote = quotes[symbol];
              if (!quote) return null;

              const price = typeof quote.c === "number" ? quote.c : 0;
              const dp = typeof quote.dp === "number" ? quote.dp : null;
              const isPositive = dp !== null && dp > 0;
              const isNegative = dp !== null && dp < 0;

              const badgeClass = isPositive
                ? styles.badgePositive
                : isNegative
                ? styles.badgeNegative
                : styles.badgeNeutral;

              const formattedPrice = `$${price.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;

              const formattedChange =
                dp !== null
                  ? `${isPositive ? "+" : ""}${dp.toFixed(2)}%`
                  : "0.00%";

              const arrow = isPositive ? "↗" : isNegative ? "↘" : "•";

              return (
                <div
                  key={symbol}
                  className={styles.card}
                  onClick={() => setSelectedStock({ quote, name })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedStock({ quote, name });
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${name} (${symbol}) stock dashboard`}
                >
                  <div className={styles.stockLeft}>
                    <StockIcon symbol={symbol} size={38} />
                    <div className={styles.stockMeta}>
                      <span className={styles.ticker}>{symbol}</span>
                      <span className={styles.companyName}>{name}</span>
                    </div>
                  </div>

                  {/* Inline Minimalistic Graph / Sparkline */}
                  <div className={styles.sparklineCol}>
                    <StockSparkline
                      symbol={symbol}
                      c={price}
                      dp={dp}
                      o={quote.o}
                      h={quote.h}
                      l={quote.l}
                      pc={quote.pc}
                      width={80}
                      height={32}
                    />
                  </div>

                  <div className={styles.stockRight}>
                    <div className={styles.priceGroup}>
                      <span className={styles.price}>{formattedPrice}</span>
                      <span className={`${styles.badge} ${badgeClass}`}>
                        <span>{arrow}</span>
                        {formattedChange}
                      </span>
                    </div>
                    <svg
                      className={styles.chevron}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Interactive Stock Dashboard Modal */}
      {selectedStock && (
        <StockDashboardModal
          quote={selectedStock.quote}
          companyName={selectedStock.name}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </>
  );
}
