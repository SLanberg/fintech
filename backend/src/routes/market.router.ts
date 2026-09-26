import { Router, Request, Response } from "express";
import { QuoteService } from "../services/quote.service";

const router = Router();

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
