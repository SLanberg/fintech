import { Router, Request, Response } from "express";
import { QuoteService, StockTimeframe } from "../services/quote.service";

const router = Router();
const STOCK_TIMEFRAMES = new Set<StockTimeframe>(["1M", "3M", "6M", "1Y"]);

/**
 * GET /api/candles/:symbol?timeframe=1M|3M|6M|1Y
 * Returns real or labeled demo OHLC candles without exposing the Finnhub API key.
 */
router.get("/candles/:symbol", async (req: Request, res: Response) => {
  const { timeframe } = req.query;
  if (typeof timeframe !== "string" || !STOCK_TIMEFRAMES.has(timeframe as StockTimeframe)) {
    return res.status(400).json({ error: "A valid timeframe is required." });
  }

  try {
    const symbol = req.params.symbol;
    const ticker = typeof symbol === "string" ? symbol : symbol[0];
    const candles = await QuoteService.getCandles(
      ticker,
      timeframe as StockTimeframe
    );
    return res.json(candles);
  } catch (err: any) {
    return res.status(502).json({ error: err.message || "Failed to fetch historical prices." });
  }
});

/**
 * GET /api/quote/:symbol
 * Fetches real-time stock quote from Finnhub API with 60-second in-memory cache
 * and automatic fallback to mock/quotes.json.
 * Strictly never exposes FINNHUB_KEY to the client.
 */
router.get("/quote/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol;
    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ error: "Symbol parameter is required." });
    }
    const quote = await QuoteService.getQuote(symbol);
    return res.json(quote);
  } catch (err: any) {
    return res.status(404).json({ error: err.message || "Failed to fetch stock quote." });
  }
});

export default router;
