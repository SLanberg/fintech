import { Router, Request, Response } from "express";
import db from "../db/database";
import { UserRepository } from "../repositories/user.repository";
import { TransferService } from "../services/transfer.service";

const router = Router();

/**
 * GET /api/account
 * Public identity endpoint for the primary account holder.
 * Strictly NEVER exposes internal immutable UUIDs.
 */
router.get("/account", (req: Request, res: Response) => {
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
router.get("/users/tag/:tag", (req: Request, res: Response) => {
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
router.get("/user/entity", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    res.json({
      entity: "User",
      description: "Primary user entity in SQLite database",
      data: {
        id: tyler.id,              // Internal immutable UUID
        tag: tyler.tag,            // Unique public tag
        display_name: tyler.display_name, // Presentation display name
        email: tyler.email,        // Email
        birth_date: tyler.birth_date, // Date of birth (1964-06-18)
        status: tyler.status,      // Account status
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
 * POST /api/demo/reset
 * Resets demo accounts (Tyler/Alice to €100.00, Bob/Alexander to €0.00)
 * and purges idempotency & ledger records created during testing.
 */
router.post("/demo/reset", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    const bob = UserRepository.findByTag("alexander");

    const now = new Date().toISOString();

    // Reset Tyler (Alice) balance to 10000 cents (€100.00)
    db.prepare("UPDATE users SET balance_cents = 10000, updated_at = ? WHERE id = ?").run(now, tyler.id);

    // Reset Bob (Alexander) balance to 0 cents (€0.00) if found
    if (bob) {
      db.prepare("UPDATE users SET balance_cents = 0, updated_at = ? WHERE id = ?").run(now, bob.id);
    }

    // Clear ledger entries and idempotency records for clean presentation state
    db.prepare("DELETE FROM ledger_entries WHERE sender_user_id = ? OR recipient_user_id = ?").run(tyler.id, tyler.id);
    db.prepare("DELETE FROM idempotency_records WHERE user_id = ?").run(tyler.id);

    console.log("[DEMO RESET] Reset demo balances: Alice = €100.00, Bob = €0.00. Cleared ledger & idempotency locks.");

    return res.json({
      message: "Demo state successfully reset.",
      alice_balance_cents: 10000,
      bob_balance_cents: 0,
    });
  } catch (err: any) {
    console.error("Error resetting demo state:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
