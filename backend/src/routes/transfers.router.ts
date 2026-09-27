import { Router, Request, Response } from "express";
import crypto from "crypto";
import { UserRepository } from "../repositories/user.repository";
import { TransferService } from "../services/transfer.service";

export const transfersRouter = Router();

/**
 * GET /api/transfers
 *
 * Returns the history of outbound transfers sent by the primary user (Tyler Durden).
 * Only entries where Tyler is the sender are included (deposits are excluded).
 *
 * @returns {200} Array of outbound transfer records
 * @returns {500} Internal server error
 */
transfersRouter.get("/", (req: Request, res: Response) => {
  try {
    const tyler = UserRepository.getPrimaryUser();
    const ledger = TransferService.getAuditLedgerForUser(tyler.id);

    const transfers = (ledger as any[])
      .filter((entry) => entry.sender_user_id === tyler.id)
      .map((entry) => ({
        id: entry.id,
        to_user_id: entry.recipient_tag,
        to_display_name: entry.recipient_display_name,
        amount: entry.amount_cents / 100,
        amount_cents: entry.amount_cents,
        currency: entry.currency,
        description: entry.description,
        status: entry.status,
        date: new Date(entry.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        created_at: entry.created_at,
      }));

    res.json(transfers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transfers
 *
 * Sends money from the primary user (Tyler Durden) to another user by their public tag.
 * Atomic, idempotent transfer backed by SQLite transaction with double-spend protection.
 *
 * @body  {string} to_user_id - Public tag of the recipient (e.g. "marla"). Required.
 * @body  {number} amount     - Amount in major currency units (e.g. 10 for €10.00). Required.
 * @body  {string} currency   - Currency code (e.g. "EUR"). Optional, informational only.
 * @body  {string} description - Optional memo / note for the transfer.
 *
 * @header {string} Idempotency-Key - Optional idempotency key to prevent duplicate transfers.
 *
 * @returns {201} TransferResult — completed transfer details including new balance
 * @returns {400} Validation error (missing to_user_id, invalid amount, insufficient funds)
 * @returns {404} Recipient not found
 * @returns {409} Idempotency key conflict (same key, different payload)
 * @returns {500} Internal server error
 */
transfersRouter.post("/", (req: Request, res: Response) => {
  const idempotencyKey =
    (req.headers["idempotency-key"] as string) || req.body.idempotency_key || crypto.randomUUID();

  // Accept new MVP contract (to_user_id) and legacy fields (recipient_tag / tag)
  const recipientTag = req.body.to_user_id || req.body.recipient_tag || req.body.tag;

  if (!recipientTag) {
    return res.status(400).json({ error: "to_user_id is required." });
  }

  const amountCents =
    req.body.amount_cents !== undefined
      ? req.body.amount_cents
      : req.body.amount !== undefined
      ? Math.round(parseFloat(req.body.amount) * 100)
      : 0;

  if (amountCents <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const startTime = Date.now();
  console.log(`\n[TRANSFER REQ] ${new Date().toISOString()} | Key: ${idempotencyKey.slice(0, 18)}... | Recipient: @${recipientTag} | Amount: €${(amountCents / 100).toFixed(2)}`);

  const result = TransferService.executeTransfer({
    idempotency_key: idempotencyKey,
    sender_tag: req.body.sender_tag, // optional, defaults to tyler
    recipient_tag: recipientTag,
    amount_cents: amountCents,
    description: req.body.description,
  });

  const duration = Date.now() - startTime;
  if (result.statusCode === 201) {
    console.log(`[TRANSFER RES] 201 CREATED (${duration}ms) | Tx ID: ${result.body.transaction_id} | Status: ACCEPTED & EXECUTED`);
  } else if (result.statusCode === 409) {
    console.log(`[TRANSFER RES] 409 CONFLICT (${duration}ms) | Idempotency Key: ${idempotencyKey.slice(0, 18)}... | Status: ✕ DUPLICATE BLOCKED`);
  } else {
    console.log(`[TRANSFER RES] ${result.statusCode} (${duration}ms) | Error: ${result.body.error}`);
  }

  return res.status(result.statusCode).json(result.body);
});

/**
 * POST /api/transfers/intent
 *
 * Step 1 (Prepare): Creates a draft payment intent in 'REQUIRES_CONFIRMATION' status.
 * Returns intent_id (e.g., pi_98765...).
 */
transfersRouter.post("/intent", (req: Request, res: Response) => {
  const recipientTag = req.body.to_user_id || req.body.recipient_tag || req.body.tag;
  if (!recipientTag) {
    return res.status(400).json({ error: "to_user_id or recipient_tag is required." });
  }

  const amountCents =
    req.body.amount_cents !== undefined
      ? req.body.amount_cents
      : req.body.amount !== undefined
      ? Math.round(parseFloat(req.body.amount) * 100)
      : 0;

  if (amountCents <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const result = TransferService.createPaymentIntent({
    sender_tag: req.body.sender_tag,
    recipient_tag: recipientTag,
    amount_cents: amountCents,
    description: req.body.description,
  });

  return res.status(result.statusCode).json(result.body);
});

/**
 * POST /api/transfers/confirm
 *
 * Step 2 (Confirm): Confirms and executes the transaction using intent_id.
 * Safe against socket timeouts & retries (atomic check on intent status).
 */
transfersRouter.post("/confirm", (req: Request, res: Response) => {
  const { intent_id } = req.body;
  if (!intent_id) {
    return res.status(400).json({ error: "intent_id is required." });
  }

  const result = TransferService.confirmPaymentIntent(intent_id);
  return res.status(result.statusCode).json(result.body);
});

