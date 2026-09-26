import express, { Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import { initDatabase } from "./db/database";
import { UserRepository } from "./repositories/user.repository";
import { TransferService } from "./services/transfer.service";

// Initialize SQLite Database and seed primary User Entity (Tyler Durden, 1964)
initDatabase();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

/**
 * Health check endpoint
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/account
 * Public identity endpoint for the primary account holder.
 * Strictly NEVER exposes internal immutable UUIDs.
 */
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

/**
 * GET /api/users/tag/:tag
 * Optimized public tag lookup (uses database unique index idx_users_tag).
 * Resolves public tag to public user profile without exposing internal UUID.
 */
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

/**
 * GET /api/user/entity
 * Entity inspection endpoint demonstrating complete Entity User representation
 * including immutable internal UUID, public tag, display name, email, birth date, account status, and timestamps.
 */
app.get("/api/user/entity", (req: Request, res: Response) => {
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

/**
 * POST /api/transfers
 * Idempotent, atomic money transfer endpoint using public recipient tag.
 * Supports Idempotency-Key header or idempotency_key body parameter.
 */
app.post("/api/transfers", (req: Request, res: Response) => {
  const idempotencyKey =
    (req.headers["idempotency-key"] as string) || req.body.idempotency_key || crypto.randomUUID();

  const recipientTag = req.body.recipient_tag || req.body.tag;
  const amountCents =
    req.body.amount_cents !== undefined
      ? req.body.amount_cents
      : req.body.amount !== undefined
      ? Math.round(parseFloat(req.body.amount) * 100)
      : 0;

  const result = TransferService.executeTransfer({
    idempotency_key: idempotencyKey,
    sender_tag: req.body.sender_tag, // optional, defaults to tyler
    recipient_tag: recipientTag,
    amount_cents: amountCents,
    description: req.body.description,
  });

  return res.status(result.statusCode).json(result.body);
});

/**
 * GET /api/transactions
 * Returns immutable audit ledger transactions.
 */
app.get("/api/transactions", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    const ledger = TransferService.getAuditLedgerForUser(tyler.id);

    const formattedTransactions = (ledger as any[]).map((entry) => {
      const isIncome = entry.recipient_user_id === tyler.id;
      const otherUser = isIncome ? entry.sender_display_name : entry.recipient_display_name;

      return {
        id: entry.id,
        idempotency_key: entry.idempotency_key,
        name: entry.description || (isIncome ? `From ${otherUser}` : `To ${otherUser}`),
        category: isIncome ? "Deposit" : "Transfer",
        date: new Date(entry.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        amount: `${isIncome ? "+" : "-"} €${(entry.amount_cents / 100).toFixed(2)}`,
        amount_cents: entry.amount_cents,
        isIncome,
        icon: isIncome ? "↓" : "↑",
      };
    });

    res.json(formattedTransactions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transactions (Legacy Quick Action Compatibility)
 * Maps legacy UI quick action deposits/transfers to atomic SQLite ledger operations.
 */
app.post("/api/transactions", (req: Request, res: Response) => {
  const { name, category, amount, isIncome, recipient_tag } = req.body;

  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: "Valid amount is required." });
  }

  const amountCents = Math.round(Math.abs(parseFloat(amount)) * 100);
  const idempotencyKey = (req.headers["idempotency-key"] as string) || crypto.randomUUID();

  if (isIncome) {
    // Deposit / Top-up simulation (atomic balance update)
    try {
      const tyler = UserRepository.getPrimaryUser();
      const transferRes = TransferService.executeTransfer({
        idempotency_key: idempotencyKey,
        sender_tag: "alexander", // From Alexander B. to Tyler
        recipient_tag: "tyler",
        amount_cents: amountCents,
        description: name || "Top Up Deposit",
      });
      return res.status(transferRes.statusCode).json(transferRes.body);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  } else {
    // Transfer out to recipient (defaults to @alexander if tag not specified)
    const targetTag = recipient_tag || "alexander";
    const transferRes = TransferService.executeTransfer({
      idempotency_key: idempotencyKey,
      sender_tag: "tyler",
      recipient_tag: targetTag,
      amount_cents: amountCents,
      description: name || `Transfer to @${targetTag}`,
    });

    return res.status(transferRes.statusCode).json(transferRes.body);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 SQLite-backed Backend server is running on http://localhost:${PORT}`);
});
