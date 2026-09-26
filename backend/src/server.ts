import express, { Request, Response } from "express";
import cors from "cors";
import { initDatabase } from "./db/database";
import { UserRepository } from "./repositories/user.repository";
import { TransferService } from "./services/transfer.service";
import { transactionsRouter } from "./routes/transactions.router";
import { transfersRouter } from "./routes/transfers.router";

// Initialize SQLite Database and seed primary User Entity (Tyler Durden, 1964)
initDatabase();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// Mount API routers
// ─────────────────────────────────────────────
app.use("/api/transactions", transactionsRouter);
app.use("/api/transfers", transfersRouter);

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// GET /api/account
// Public identity endpoint for the primary account holder.
// Strictly NEVER exposes internal immutable UUIDs.
// ─────────────────────────────────────────────
app.get("/api/account", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    const publicProfile = UserRepository.toPublicProfile(tyler);

    // Calculate monthly stats from ledger
    const ledger = TransferService.getAuditLedgerForUser(tyler.id);
    let monthlyIncomeCents = 0;
    let monthlyExpensesCents = 0;

    for (const entry of ledger as any[]) {
      if (entry.recipient_user_id === tyler.id) {
        monthlyIncomeCents += entry.amount_cents;
      } else if (entry.sender_user_id === tyler.id) {
        monthlyExpensesCents += entry.amount_cents;
      }
    }

    res.json({
      user: {
        name: publicProfile.display_name,
        tag: publicProfile.tag,
        email: publicProfile.email,
        birthDate: publicProfile.birth_date,
        birth_date: publicProfile.birth_date,
        status: publicProfile.status,
        accountType: "Personal Account",
        avatarUrl: "/Tyler.jpg",
      },
      balance: tyler.balance_cents / 100, // Formatted float for frontend view
      balance_cents: tyler.balance_cents, // Exact integer minor units
      currency: "EUR",
      stats: {
        monthlyIncome: monthlyIncomeCents / 100,
        monthlyExpenses: monthlyExpensesCents / 100,
        monthlyIncome_cents: monthlyIncomeCents,
        monthlyExpenses_cents: monthlyExpensesCents,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/tag/:tag
// Optimized public tag lookup (uses database unique index idx_users_tag).
// Resolves public tag to public user profile without exposing internal UUID.
// ─────────────────────────────────────────────
app.get("/api/users/tag/:tag", (req: Request, res: Response) => {
  const tag = req.params.tag as string;
  const user = UserRepository.findByTag(tag);

  if (!user) {
    return res.status(404).json({ error: `User with tag '${tag}' not found.` });
  }

  return res.json({
    user: UserRepository.toPublicProfile(user),
  });
});

// ─────────────────────────────────────────────
// GET /api/user/entity
// Entity inspection endpoint — complete internal User entity (debug only).
// ─────────────────────────────────────────────
app.get("/api/user/entity", (_req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    res.json({
      entity: "User",
      description: "Primary user entity in SQLite database",
      data: {
        id: tyler.id, // Internal immutable UUID
        tag: tyler.tag, // Unique public tag
        display_name: tyler.display_name, // Presentation display name
        email: tyler.email, // Email
        birth_date: tyler.birth_date, // Date of birth (1964-06-18)
        status: tyler.status, // Account status
        balance_cents: tyler.balance_cents, // Monetary balance in exact integer minor units
        created_at: tyler.created_at,
        updated_at: tyler.updated_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SQLite-backed Backend server is running on http://localhost:${PORT}`);
});
