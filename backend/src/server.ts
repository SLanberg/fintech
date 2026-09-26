import express, { Request, Response } from "express";
import cors from "cors";
import { initDatabase } from "./db/database";
import { loadEnvFiles } from "./services/quote.service";
import usersRouter from "./routes/users.router";
import marketRouter from "./routes/market.router";
import { transactionsRouter } from "./routes/transactions.router";
import { transfersRouter } from "./routes/transfers.router";

loadEnvFiles();
initDatabase();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.use("/api/transactions", transactionsRouter);
app.use("/api/transfers", transfersRouter);
app.use("/api", usersRouter);
app.use("/api", marketRouter);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`SQLite-backed Backend server is running on http://localhost:${PORT}`);
});
