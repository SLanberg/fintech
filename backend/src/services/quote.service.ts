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

interface CacheEntry {
  data: QuoteResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const cache = new Map<string, CacheEntry>();

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
  }
}
