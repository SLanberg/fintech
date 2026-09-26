import fs from "fs";
import path from "path";

export interface QuoteResponse {
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

export type StockTimeframe = "1M" | "3M" | "6M" | "1Y";
export type CandleSource = "finnhub" | "demo";

export interface StockCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockHistory {
  source: CandleSource;
  candles: StockCandle[];
}

interface CacheEntry {
  data: QuoteResponse;
  timestamp: number;
}

interface CandleCacheEntry {
  data: StockHistory;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const cache = new Map<string, CacheEntry>();
const candleCache = new Map<string, CandleCacheEntry>();
const CANDLE_RANGES: Record<StockTimeframe, number> = {
  "1M": 30 * 24 * 60 * 60,
  "3M": 90 * 24 * 60 * 60,
  "6M": 180 * 24 * 60 * 60,
  "1Y": 365 * 24 * 60 * 60,
};
const DEMO_TRADING_DAYS = 252;

/**
 * Loads .env configuration from candidate directories into process.env
 * without requiring external dependencies.
 */
export function loadEnvFiles(): void {
  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../.env"),
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const eqIdx = trimmed.indexOf("=");
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        console.warn(`Failed reading env from ${envPath}:`, err);
      }
    }
  }
}

/**
 * Locates and loads mock quotes from mock/quotes.json
 */
function loadMockQuotes(): Record<string, any> {
  const candidatePaths = [
    path.resolve(process.cwd(), "mock/quotes.json"),
    path.resolve(process.cwd(), "backend/mock/quotes.json"),
    path.resolve(__dirname, "../../mock/quotes.json"),
    path.resolve(__dirname, "../../../mock/quotes.json"),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`Failed parsing mock quotes from ${p}:`, err);
      }
    }
  }
  return {};
}

function getMockQuote(symbol: string): QuoteResponse | null {
  const quotes = loadMockQuotes();
  const mock = quotes[symbol];
  if (mock) {
    return {
      symbol,
      c: mock.c,
      d: mock.d !== undefined ? mock.d : null,
      dp: mock.dp !== undefined ? mock.dp : null,
      h: mock.h,
      l: mock.l,
      o: mock.o,
      pc: mock.pc,
      t: mock.t,
    };
  }
  return null;
}

function createDemoHistory(
  symbol: string,
  currentPrice: number,
  timeframe: StockTimeframe
): StockHistory {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { source: "demo", candles: [] };
  }

  let seed = symbol.split("").reduce((value, character) => value + character.charCodeAt(0), 0);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const dates: number[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (dates.length < DEMO_TRADING_DAYS) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      dates.unshift(Math.floor(cursor.getTime() / 1000));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const closes = new Array<number>(dates.length);
  closes[closes.length - 1] = currentPrice;
  for (let index = closes.length - 1; index > 0; index--) {
    const dailyChange = (random() - 0.5) * 0.04;
    closes[index - 1] = closes[index] / (1 + dailyChange);
  }

  const allCandles = dates.map((time, index): StockCandle => {
    const open = index === 0 ? closes[index] : closes[index - 1];
    const close = closes[index];
    const wick = 0.002 + random() * 0.01;
    return {
      time,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume: Math.round(10_000_000 + random() * 40_000_000),
    };
  });

  const now = Math.floor(Date.now() / 1000);
  const from = now - CANDLE_RANGES[timeframe];
  return {
    source: "demo",
    candles: allCandles.filter((candle) => candle.time >= from && candle.time <= now),
  };
}

function isEmptyOrError(data: any): boolean {
  if (!data || typeof data !== "object") return true;
  if (data.error) return true;
  if (typeof data.c !== "number") return true;
  // Finnhub signature for empty / invalid ticker
  if (data.c === 0 && data.dp === null && data.d === null) return true;
  // Empty data / all zeros
  if (data.c === 0 && data.h === 0 && data.l === 0 && data.pc === 0) return true;
  return false;
}

export class QuoteService {
  /**
   * Fetches quote for the given ticker symbol.
   * - In-memory cache for 60 seconds per ticker
   * - If QUOTES_MOCK=true, returns mock data from mock/quotes.json
   * - If Finnhub returns an error or empty response, falls back to mock data
   */
  public static async getQuote(symbol: string): Promise<QuoteResponse> {
    const ticker = symbol.trim().toUpperCase();

    // 1. In-memory cache check (60 seconds)
    const cached = cache.get(ticker);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // 2. If QUOTES_MOCK=true or no key provided, return mock data
    const isMock = process.env.QUOTES_MOCK === "true";
    const apiKey = process.env.FINNHUB_KEY;

    if (isMock || !apiKey) {
      const mockQuote = getMockQuote(ticker);
      if (mockQuote) {
        cache.set(ticker, { data: mockQuote, timestamp: Date.now() });
        return mockQuote;
      }
      throw new Error(`Mock quote for symbol '${ticker}' not found.`);
    }

    // 3. Fetch from Finnhub API
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`Finnhub returned HTTP ${response.status} for ${ticker}. Falling back to mock.`);
        return QuoteService.fallback(ticker);
      }

      const data = (await response.json()) as any;

      if (isEmptyOrError(data)) {
        console.warn(`Finnhub returned empty/error payload for ${ticker}. Falling back to mock.`);
        return QuoteService.fallback(ticker);
      }

      const quote: QuoteResponse = {
        symbol: ticker,
        c: data.c,
        d: data.d !== undefined ? data.d : null,
        dp: data.dp !== undefined ? data.dp : null,
        h: data.h,
        l: data.l,
        o: data.o,
        pc: data.pc,
        t: data.t,
      };

      cache.set(ticker, { data: quote, timestamp: Date.now() });
      return quote;
    } catch (err: any) {
      console.warn(`Error fetching Finnhub quote for ${ticker}: ${err.message}. Falling back to mock.`);
      return QuoteService.fallback(ticker);
    }
  }

  public static async getCandles(
    symbol: string,
    timeframe: StockTimeframe
  ): Promise<StockHistory> {
    const ticker = symbol.trim().toUpperCase();
    const cacheKey = `${ticker}:${timeframe}`;
    const cached = candleCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const apiKey = process.env.FINNHUB_KEY;
    if (process.env.QUOTES_MOCK === "true" || !apiKey) {
      const quote = getMockQuote(ticker);
      const history = quote
        ? createDemoHistory(ticker, quote.c, timeframe)
        : { source: "demo" as const, candles: [] };
      candleCache.set(cacheKey, { data: history, timestamp: Date.now() });
      return history;
    }

    const to = Math.floor(Date.now() / 1000);
    const from = to - CANDLE_RANGES[timeframe];
    const url = new URL("https://finnhub.io/api/v1/stock/candle");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("resolution", "D");
    url.searchParams.set("from", String(from));
    url.searchParams.set("to", String(to));
    url.searchParams.set("token", apiKey);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Finnhub returned HTTP ${response.status} for ${ticker} candles.`);
        throw new Error(`Finnhub returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        s?: string;
        t?: number[];
        o?: number[];
        h?: number[];
        l?: number[];
        c?: number[];
        v?: number[];
      };

      if (
        data.s !== "ok" ||
        !Array.isArray(data.t) ||
        !Array.isArray(data.o) ||
        !Array.isArray(data.h) ||
        !Array.isArray(data.l) ||
        !Array.isArray(data.c)
      ) {
        throw new Error("Finnhub returned no historical candles.");
      }

      const candles = data.t.flatMap((time, index): StockCandle[] => {
        const values = [time, data.o![index], data.h![index], data.l![index], data.c![index]];
        if (!values.every((value) => Number.isFinite(value))) {
          return [];
        }

        return [{
          time,
          open: data.o![index],
          high: data.h![index],
          low: data.l![index],
          close: data.c![index],
          volume: Number.isFinite(data.v?.[index]) ? data.v![index] : 0,
        }];
      }).sort((first, second) => first.time - second.time);

      const history: StockHistory = candles.length
        ? { source: "finnhub", candles }
        : this.getDemoHistory(ticker, timeframe);
      candleCache.set(cacheKey, { data: history, timestamp: Date.now() });
      return history;
    } catch (err: any) {
      console.warn(`Error fetching Finnhub candles for ${ticker}: ${err.message}`);
      const history = this.getDemoHistory(ticker, timeframe);
      candleCache.set(cacheKey, { data: history, timestamp: Date.now() });
      return history;
    }
  }

  private static getDemoHistory(ticker: string, timeframe: StockTimeframe): StockHistory {
    const quote = getMockQuote(ticker);
    return quote
      ? createDemoHistory(ticker, quote.c, timeframe)
      : { source: "demo", candles: [] };
  }

  private static fallback(ticker: string): QuoteResponse {
    const mockQuote = getMockQuote(ticker);
    if (mockQuote) {
      cache.set(ticker, { data: mockQuote, timestamp: Date.now() });
      return mockQuote;
    }
    throw new Error(`Quote not available for symbol '${ticker}'.`);
  }

  /**
   * Helper to inspect cache status (useful for testing)
   */
  public static getCacheStatus(ticker: string): { cached: boolean; ageMs?: number } {
    const cached = cache.get(ticker.toUpperCase());
    if (cached) {
      return { cached: true, ageMs: Date.now() - cached.timestamp };
    }
    return { cached: false };
  }

  /**
   * Clear cache (useful for testing)
   */
  public static clearCache(): void {
    cache.clear();
    candleCache.clear();
  }
}
