import { Router, Request, Response } from "express";
import crypto from "crypto";
import { UserRepository } from "../repositories/user.repository";
import { TransferService } from "../services/transfer.service";

const router = Router();

/**
 * POST /api/transfers
 * Idempotent, atomic money transfer endpoint using public recipient tag.
 * Supports Idempotency-Key header or idempotency_key body parameter.
 */
router.post("/transfers", (req: Request, res: Response) => {
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
router.get("/transactions", (req: Request, res: Response) => {
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
router.post("/transactions", (req: Request, res: Response) => {
  const { name, category, amount, isIncome, recipient_tag } = req.body;

  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: "Valid amount is required." });
  }

  const amountCents = Math.round(Math.abs(parseFloat(amount)) * 100);
  const idempotencyKey = (req.headers["idempotency-key"] as string) || crypto.randomUUID();

  if (isIncome) {
    // Deposit / Top-up simulation (atomic balance update)
    try {
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

export default router;
