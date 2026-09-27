import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "../../lockin.db");
const db = new Database(dbPath);

// Enable Foreign Keys & WAL mode for concurrency
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export interface UserEntity {
  id: string; // Cryptographically secure immutable internal UUID (never exposed publicly)
  tag: string; // Unique public tag for lookup and initiating transfers
  display_name: string; // Presentation display name
  email: string; // User email
  birth_date: string; // Date of birth (YYYY-MM-DD)
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  balance_cents: number; // Monetary values stored strictly as integer minor units
  created_at: string;
  updated_at: string;
}

export interface PublicUserProfile {
  tag: string;
  display_name: string;
  email: string;
  birth_date: string;
  status: string;
  created_at: string;
}

export interface LedgerEntryEntity {
  id: string;
  idempotency_key: string | null;
  sender_user_id: string;
  recipient_user_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  status: string;
  created_at: string;
}

export interface IdempotencyRecordEntity {
  user_id: string;
  key: string;
  request_hash: string;
  response_code: number;
  response_body: string;
  status: "IN_PROGRESS" | "COMPLETED";
  created_at: string;
}

export interface PaymentIntentEntity {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  amount_cents: number;
  currency: string;
  description: string | null;
  status: "REQUIRES_CONFIRMATION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  created_at: string;
  updated_at: string;
}

export function initDatabase() {
  // Migrate idempotency_records if existing table lacks user_id or status column
  const tableInfo = db.prepare("PRAGMA table_info(idempotency_records)").all() as Array<{ name: string }>;
  if (tableInfo.length > 0 && (!tableInfo.some((col) => col.name === "user_id") || !tableInfo.some((col) => col.name === "status"))) {
    db.exec("DROP TABLE idempotency_records;");
  }

  // Migrate ledger_entries if it contains legacy UNIQUE constraint on idempotency_key
  const ledgerSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_entries'").get() as { sql?: string } | undefined)?.sql;
  if (ledgerSql && ledgerSql.includes("idempotency_key TEXT UNIQUE")) {
    db.exec("DROP TABLE ledger_entries;");
  }

  db.exec(`
    -- Users table with PRIMARY KEY constraint on internal UUID
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      tag TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      birth_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Unique index on user public tag for fast lookup & transfers
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tag ON users(tag);

    -- Immutable, auditable ledger records
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT,
      sender_user_id TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_at TEXT NOT NULL,
      FOREIGN KEY (sender_user_id) REFERENCES users(id),
      FOREIGN KEY (recipient_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_sender ON ledger_entries(sender_user_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_recipient ON ledger_entries(recipient_user_id);

    -- Idempotency tracking table (scoped to user_id) with Processing Lock status
    CREATE TABLE IF NOT EXISTS idempotency_records (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_code INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    -- Unique index on idempotency_records(user_id, key) to guarantee DB level uniqueness under high concurrency
    CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_user_key ON idempotency_records(user_id, key);

    -- Index for fast range queries and TTL cleanup policies
    CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_records(created_at);

    -- Payment Intents table (Stripe/Adyen Intent Pattern)
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY NOT NULL,
      sender_user_id TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'REQUIRES_CONFIRMATION',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (sender_user_id) REFERENCES users(id),
      FOREIGN KEY (recipient_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_intents_sender ON payment_intents(sender_user_id);
  `);

  // Purge idempotency records older than 2 years on startup & scheduled maintenance
  purgeExpiredIdempotencyRecords(2);
  scheduleIdempotencyCleanup(2);

  seedInitialData();
}

/**
 * Purges idempotency records older than the specified retention period (default: 2 years).
 * Resolves Infinite Data Retention issue (TTL/Expiration policy).
 */
export function purgeExpiredIdempotencyRecords(retentionYears: number = 2): number {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);
  const cutoffIso = cutoffDate.toISOString();

  const result = db.prepare("DELETE FROM idempotency_records WHERE created_at < ?").run(cutoffIso);
  if (result.changes > 0) {
    console.log(`[Database Maintenance] Purged ${result.changes} expired idempotency record(s) older than ${retentionYears} year(s).`);
  }
  return result.changes;
}

let cleanupTimer: NodeJS.Timeout | null = null;

function scheduleIdempotencyCleanup(retentionYears: number = 2) {
  if (cleanupTimer) return;
  // Run cleanup once every 24 hours
  cleanupTimer = setInterval(() => {
    try {
      purgeExpiredIdempotencyRecords(retentionYears);
    } catch (err) {
      console.error("[Database Maintenance] Error during periodic idempotency cleanup:", err);
    }
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref(); // Do not block process exit
}

function seedInitialData() {
  const userCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;

  const now = new Date().toISOString();

  if (userCount === 0) {
    console.log("Seeding database with primary user Tyler Durden...");
    const tylerId = crypto.randomUUID();
    const insertUser = db.prepare(`
      INSERT INTO users (id, tag, display_name, email, birth_date, status, balance_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      tylerId,
      "tyler",
      "Tyler Durden",
      "tyler.durden@paperstreet.com",
      "1964-06-18",
      "ACTIVE",
      10000, // €100.00
      now,
      now
    );
  }

  // Guarantee recipient contacts exist
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO users (id, tag, display_name, email, birth_date, status, balance_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
  `);

  const contacts = [
    { tag: "alexander", name: "Alexander B.", email: "alexander.b@bank.com", birth: "1988-03-25", balance: 500000 },
    { tag: "marla", name: "Marla Singer", email: "marla.singer@paperstreet.com", birth: "1966-08-13", balance: 120000 },
    { tag: "edward", name: "Edward Norton", email: "edward.norton@bank.com", birth: "1969-08-18", balance: 350000 },
    { tag: "jack", name: "Jack Durden", email: "jack.durden@paperstreet.com", birth: "1970-01-01", balance: 150000 },
  ];

  for (const c of contacts) {
    insertContact.run(
      crypto.randomUUID(),
      c.tag,
      c.name,
      c.email,
      c.birth,
      c.balance,
      now,
      now
    );
  }

  // Ensure Tyler has initial deposit in audit ledger
  const tylerUser = db.prepare("SELECT * FROM users WHERE tag = 'tyler'").get() as any;
  if (tylerUser) {
    const hasTopup = db.prepare("SELECT COUNT(*) as count FROM ledger_entries WHERE recipient_user_id = ?").get(tylerUser.id) as { count: number };
    if (hasTopup.count === 0) {
      const alexander = db.prepare("SELECT * FROM users WHERE tag = 'alexander'").get() as any;
      const senderId = alexander ? alexander.id : tylerUser.id;
      db.prepare(`
        INSERT INTO ledger_entries (id, idempotency_key, sender_user_id, recipient_user_id, amount_cents, currency, description, status, created_at)
        VALUES (?, ?, ?, ?, 10000, 'EUR', 'Account Initial Top-Up (€100.00)', 'COMPLETED', ?)
      `).run(crypto.randomUUID(), 'seed-topup-tyler-100', senderId, tylerUser.id, now);
    }
  }
}

export default db;
