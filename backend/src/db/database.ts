import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";

const dbPath = path.join(__dirname, "../../lockin.db");
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
  key: string;
  request_hash: string;
  response_code: number;
  response_body: string;
  created_at: string;
}

export function initDatabase() {
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
      idempotency_key TEXT UNIQUE,
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

    -- Idempotency tracking table
    CREATE TABLE IF NOT EXISTS idempotency_records (
      key TEXT PRIMARY KEY NOT NULL,
      request_hash TEXT NOT NULL,
      response_code INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedInitialData();
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
      0, // €0.00
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
}

export default db;
