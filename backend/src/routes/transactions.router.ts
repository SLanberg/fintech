import { Router, Request, Response } from "express";
import crypto from "crypto";
import { UserRepository } from "../repositories/user.repository";
import { TransferService } from "../services/transfer.service";

export const transactionsRouter = Router();

/**
 * GET /api/transactions
 *
 * Returns the full immutable audit ledger for the primary user (Tyler Durden).
 * Each entry includes direction (income / outbound), formatted amount, and date.
 *
 * @returns {200} Array of formatted ledger entries
 * @returns {500} Internal server error
 */
transactionsRouter.get("/", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    const ledger = TransferService.getAuditLedgerForUser(tyler.id);

    const formattedTransactions = (ledger as any[]).map((entry) => {
      const isIncome = entry.recipient_user_id === tyler.id;
      const otherUser = isIncome ? entry.sender_display_name : entry.recipient_display_name;
      const otherTag = isIncome ? entry.sender_tag : entry.recipient_tag;

      return {
        id: entry.id,
        idempotency_key: entry.idempotency_key,
        name: entry.description || (isIncome ? `From ${otherUser}` : `To ${otherUser}`),
        description: entry.description || "",
        other_user_name: otherUser,
        other_tag: otherTag,
        sender_tag: entry.sender_tag,
        recipient_tag: entry.recipient_tag,
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
        status: entry.status || "COMPLETED",
        created_at: entry.created_at,
      };
    });

    res.json(formattedTransactions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transactions
 *
 * Top-up (add money) to the primary user's account.
 * Simulated as an incoming transfer from the system contact @alexander.
 *
 * @body  {number} amount   - Amount in major currency units (e.g. 100 for €100.00). Required.
 * @body  {string} currency - Currency code (e.g. "EUR"). Optional, defaults to "EUR".
 * @body  {string} name     - Optional description label for the deposit.
 *
 * @header {string} Idempotency-Key - Optional idempotency key to prevent duplicate top-ups.
 *
 * @returns {201} TransferResult — completed top-up details
 * @returns {400} Validation error (missing or invalid amount)
 * @returns {500} Internal server error
 */
transactionsRouter.post("/", (req: Request, res: Response) => {
  const { amount, currency, name } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: "amount is required and must be a valid number." });
  }

  if (parseFloat(amount) <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const amountCents = Math.round(Math.abs(parseFloat(amount)) * 100);
  const idempotencyKey = (req.headers["idempotency-key"] as string) || crypto.randomUUID();

  try {
    const transferRes = TransferService.executeTransfer({
      idempotency_key: idempotencyKey,
      sender_tag: "alexander", // Top-up simulated as incoming from Alexander B.
      recipient_tag: "tyler",
      amount_cents: amountCents,
      description: name || `Top-Up (${currency || "EUR"} ${parseFloat(amount).toFixed(2)})`,
    });
    return res.status(transferRes.statusCode).json(transferRes.body);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
