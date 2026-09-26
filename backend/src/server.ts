import express, { Request, Response } from "express";
import cors from "cors";
import { initDatabase } from "./db/database";
import { loadEnvFiles } from "./services/quote.service";

// ── Routers ──────────────────────────────────────────────────────────────────
import usersRouter from "./routes/users.router";
import financeRouter from "./routes/finance.router";
import marketRouter from "./routes/market.router";

// Load environment variables (.env)
loadEnvFiles();

// Initialize SQLite Database and seed primary User Entity (Tyler Durden, 1964)
initDatabase();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Users & Account ───────────────────────────────────────────────────────────
// GET  /api/account
// GET  /api/users/tag/:tag
// GET  /api/user/entity
app.use("/api", usersRouter);

// ── Finance: Transfers & Transactions ─────────────────────────────────────────
// POST /api/transfers
// GET  /api/transactions
// POST /api/transactions
app.use("/api", financeRouter);

// ── Market: Stock Quotes ──────────────────────────────────────────────────────
// GET  /api/quote/:symbol
app.use("/api", marketRouter);

app.listen(PORT, () => {
  console.log(`SQLite-backed Backend server is running on http://localhost:${PORT}`);
});
