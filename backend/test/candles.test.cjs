const assert = require("node:assert/strict");
const test = require("node:test");
const { QuoteService } = require("../dist/services/quote.service.js");

test("returns normalized historical candles from Finnhub", async () => {
  process.env.FINNHUB_KEY = "test-key";
  delete process.env.QUOTES_MOCK;
  QuoteService.clearCache();

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /stock\/candle/);
    assert.match(String(url), /resolution=D/);
    assert.match(String(url), /token=test-key/);
    return {
      ok: true,
      json: async () => ({
        s: "ok",
        t: [1727376000, 1727376300],
        o: [100, 101],
        h: [102, 103],
        l: [99, 100],
        c: [101, 102],
        v: [1000, 1200],
      }),
    };
  };

  try {
    const history = await QuoteService.getCandles("AAPL", "1Y");
    assert.equal(history.source, "finnhub");
    assert.deepEqual(history.candles, [
      { time: 1727376000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { time: 1727376300, open: 101, high: 103, low: 100, close: 102, volume: 1200 },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("provides labeled one-year demo history for all chart ranges", async () => {
  process.env.QUOTES_MOCK = "true";
  QuoteService.clearCache();

  const ranges = ["1M", "3M", "6M", "1Y"];
  const histories = await Promise.all(
    ranges.map((range) => QuoteService.getCandles("AAPL", range))
  );

  for (const [index, history] of histories.entries()) {
    assert.equal(history.source, "demo");
    assert.ok(history.candles.length > 0);
    assert.ok(history.candles.length <= (index === 0 ? 24 : index === 1 ? 68 : index === 2 ? 136 : 253));
    assert.equal(history.candles.at(-1).close, 228.45);
    assert.ok(history.candles.every((candle) =>
      candle.low <= candle.open &&
      candle.low <= candle.close &&
      candle.high >= candle.open &&
      candle.high >= candle.close
    ));
    assert.ok(history.candles.every((candle, candleIndex, candles) =>
      candleIndex === 0 || candle.time > candles[candleIndex - 1].time
    ));
  }

  delete process.env.QUOTES_MOCK;
  delete process.env.FINNHUB_KEY;
});
