import db, { LedgerEntryEntity, IdempotencyRecordEntity } from "../db/database";
import { UserRepository } from "../repositories/user.repository";
import crypto from "crypto";

export interface TransferRequest {
  idempotency_key: string;
  sender_tag?: string; // If omitted, defaults to primary user (tyler)
  recipient_tag: string; // Public tag used to resolve recipient
  amount_cents: number; // Integer minor units (e.g., 1450 for €14.50)
  description?: string;
}

export interface TransferResult {
  transaction_id: string;
  idempotency_key: string;
  sender_tag: string;
  recipient_tag: string;
  recipient_display_name: string;
  amount_cents: number;
  formatted_amount: string;
  currency: string;
  new_sender_balance_cents: number;
  formatted_new_balance: string;
  timestamp: string;
  status: "COMPLETED";
}

export class TransferService {
  /**
   * Compute deterministic SHA256 payload hash for idempotency checking.
   */
  private static computePayloadHash(senderId: string, recipientTag: string, amountCents: number, description?: string): string {
    const raw = `${senderId}:${recipientTag.trim().toLowerCase()}:${amountCents}:${description || ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Execute an atomic, idempotent money transfer between users via tag resolution.
   */
  static executeTransfer(req: TransferRequest): { statusCode: number; body: any } {
    const { idempotency_key, recipient_tag, amount_cents, description } = req;

    // Validate inputs
    if (!idempotency_key || typeof idempotency_key !== "string" || idempotency_key.trim() === "") {
      return { statusCode: 400, body: { error: "An idempotency_key string is required for money transfers." } };
    }

    if (!recipient_tag || typeof recipient_tag !== "string" || recipient_tag.trim() === "") {
      return { statusCode: 400, body: { error: "Recipient tag is required." } };
    }

    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return { statusCode: 400, body: { error: "Amount must be a positive integer in minor units (cents)." } };
    }

    // 1. Resolve Sender
    const sender = req.sender_tag ? UserRepository.findByTag(req.sender_tag) : UserRepository.getPrimaryUser();
    if (!sender) {
      return { statusCode: 404, body: { error: "Sender user account not found." } };
    }

    if (sender.status !== "ACTIVE") {
      return { statusCode: 403, body: { error: "Sender account is not active." } };
    }

    // 2. Resolve Recipient using indexed tag lookup
    const recipient = UserRepository.findByTag(recipient_tag);
    if (!recipient) {
      return { statusCode: 404, body: { error: `Recipient with public tag '${recipient_tag}' not found.` } };
    }

    if (recipient.status !== "ACTIVE") {
      return { statusCode: 403, body: { error: "Recipient account is not active." } };
    }

    if (sender.id === recipient.id) {
      return { statusCode: 400, body: { error: "Cannot transfer money to yourself." } };
    }

    // Compute request payload hash (using internal immutable IDs and payload parameters)
    const payloadHash = this.computePayloadHash(sender.id, recipient.tag, amount_cents, description);

    // 3. Idempotency & Processing Lock Check (Scoped to sender user_id with 2-Year Retention TTL enforcement)
    const retentionYears = 2;
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);
    const cutoffIso = cutoffDate.toISOString();

    const existingRecord = db
      .prepare("SELECT * FROM idempotency_records WHERE user_id = ? AND key = ? AND created_at >= ?")
      .get(sender.id, idempotency_key, cutoffIso) as IdempotencyRecordEntity | undefined;

    if (existingRecord) {
      if (existingRecord.status === "IN_PROGRESS") {
        return {
          statusCode: 409,
          body: {
            error: "Conflict: Request currently being processed.",
            idempotency_key,
            status: "IN_PROGRESS",
          },
        };
      }

      if (existingRecord.request_hash !== payloadHash) {
        // Reusing idempotency key with different payload MUST be rejected
        return {
          statusCode: 409,
          body: {
            error: "Conflict: Idempotency key has already been used with a different request payload.",
            idempotency_key,
          },
        };
      }
      // Return original cached result
      return {
        statusCode: existingRecord.response_code,
        body: JSON.parse(existingRecord.response_body),
      };
    }

    // Insert processing lock record prior to transaction execution
    const nowLock = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO idempotency_records (user_id, key, request_hash, response_code, response_body, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?)
      `).run(sender.id, idempotency_key, payloadHash, 0, "", nowLock);
    } catch (lockErr: any) {
      if (
        (lockErr.code && typeof lockErr.code === "string" && lockErr.code.startsWith("SQLITE_CONSTRAINT")) ||
        (lockErr.message && typeof lockErr.message === "string" && lockErr.message.includes("UNIQUE constraint failed"))
      ) {
        const racedRecord = db
          .prepare("SELECT * FROM idempotency_records WHERE user_id = ? AND key = ?")
          .get(sender.id, idempotency_key) as IdempotencyRecordEntity | undefined;

        if (racedRecord) {
          if (racedRecord.status === "IN_PROGRESS") {
            return {
              statusCode: 409,
              body: {
                error: "Conflict: Request currently being processed.",
                idempotency_key,
                status: "IN_PROGRESS",
              },
            };
          }

          if (racedRecord.request_hash !== payloadHash) {
            return {
              statusCode: 409,
              body: {
                error: "Conflict: Idempotency key has already been used with a different request payload.",
                idempotency_key,
              },
            };
          }
          return {
            statusCode: racedRecord.response_code,
            body: JSON.parse(racedRecord.response_body),
          };
        }
      }
      console.error("Failed to insert processing lock:", lockErr);
      return { statusCode: 500, body: { error: "Failed to initialize request processing lock." } };
    }

    // 4. Atomic Financial Transaction Execution
    const transferTransaction = db.transaction(() => {
      const now = new Date().toISOString();
      const transactionId = crypto.randomUUID();

      // Enforce Double Spending Protection at database level:
      // Sender balance check & atomic update
      const updateSender = db.prepare(`
        UPDATE users 
        SET balance_cents = balance_cents - ?, updated_at = ? 
        WHERE id = ? AND balance_cents >= ? AND status = 'ACTIVE'
      `);

      const senderResult = updateSender.run(amount_cents, now, sender.id, amount_cents);

      if (senderResult.changes === 0) {
        throw new Error("INSUFFICIENT_FUNDS");
      }

      // Update Recipient balance
      const updateRecipient = db.prepare(`
        UPDATE users 
        SET balance_cents = balance_cents + ?, updated_at = ? 
        WHERE id = ? AND status = 'ACTIVE'
      `);

      const recipientResult = updateRecipient.run(amount_cents, now, recipient.id);

      if (recipientResult.changes === 0) {
        throw new Error("RECIPIENT_UPDATE_FAILED");
      }

      // Record immutable audit ledger entry referencing immutable internal IDs (never public tags)
      const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (
          id, idempotency_key, sender_user_id, recipient_user_id, amount_cents, currency, description, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'EUR', ?, 'COMPLETED', ?)
      `);

      const transferDesc = description || `Transfer to @${recipient.tag}`;
      insertLedger.run(transactionId, idempotency_key, sender.id, recipient.id, amount_cents, transferDesc, now);

      // Get updated sender balance
      const updatedSender = db.prepare("SELECT balance_cents FROM users WHERE id = ?").get(sender.id) as { balance_cents: number };

      const responseBody: TransferResult = {
        transaction_id: transactionId,
        idempotency_key,
        sender_tag: `@${sender.tag}`,
        recipient_tag: `@${recipient.tag}`,
        recipient_display_name: recipient.display_name,
        amount_cents,
        formatted_amount: `- €${(amount_cents / 100).toFixed(2)}`,
        currency: "EUR",
        new_sender_balance_cents: updatedSender.balance_cents,
        formatted_new_balance: `€${(updatedSender.balance_cents / 100).toFixed(2)}`,
        timestamp: now,
        status: "COMPLETED",
      };

      // Update the processing lock record to COMPLETED status with final response
      const updateIdempotency = db.prepare(`
        UPDATE idempotency_records 
        SET status = 'COMPLETED', response_code = ?, response_body = ?, created_at = ?
        WHERE user_id = ? AND key = ?
      `);

      updateIdempotency.run(201, JSON.stringify(responseBody), now, sender.id, idempotency_key);

      return responseBody;
    });

    try {
      const result = transferTransaction();
      return { statusCode: 201, body: result };
    } catch (err: any) {
      // Remove or clean up processing lock record on transaction failure to allow retry if needed
      db.prepare("DELETE FROM idempotency_records WHERE user_id = ? AND key = ? AND status = 'IN_PROGRESS'").run(sender.id, idempotency_key);

      if (err.message === "INSUFFICIENT_FUNDS") {
        return { statusCode: 400, body: { error: "Insufficient funds for transfer." } };
      }
      if (err.message === "RECIPIENT_UPDATE_FAILED") {
        return { statusCode: 400, body: { error: "Failed to update recipient balance." } };
      }

      console.error("Transfer transaction error:", err);
      return { statusCode: 500, body: { error: "Financial transaction failed during execution." } };
    }
  }

  /**
   * Retrieve audit ledger for a user by internal ID.
   */
  static getAuditLedgerForUser(internalUserId: string) {
    const stmt = db.prepare(`
      SELECT 
        l.id,
        l.idempotency_key,
        l.amount_cents,
        l.currency,
        l.description,
        l.status,
        l.created_at,
        l.sender_user_id,
        l.recipient_user_id,
        s.tag as sender_tag,
        s.display_name as sender_display_name,
        r.tag as recipient_tag,
        r.display_name as recipient_display_name
      FROM ledger_entries l
      JOIN users s ON l.sender_user_id = s.id
      JOIN users r ON l.recipient_user_id = r.id
      WHERE l.sender_user_id = ? OR l.recipient_user_id = ?
      ORDER BY l.created_at DESC
    `);

    return stmt.all(internalUserId, internalUserId);
  }
}
