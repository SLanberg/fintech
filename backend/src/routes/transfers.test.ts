import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { initDatabase } from "../db/database";
import { transfersRouter } from "./transfers.router";

// Bootstrap isolated test app
const app = express();
app.use(express.json());
app.use("/api/transfers", transfersRouter);

beforeAll(() => {
  initDatabase();
});

// ─────────────────────────────────────────────
// GET /api/transfers
// ─────────────────────────────────────────────
describe("GET /api/transfers", () => {
  it("returns 200 with an array", async () => {
    const res = await request(app).get("/api/transfers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("each entry has the expected fields", async () => {
    // Seed at least one transfer so we can inspect the shape
    await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", `test-shape-check-${Date.now()}`)
      .send({ to_user_id: "marla", amount: 1, currency: "EUR" });

    const res = await request(app).get("/api/transfers");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const entry = res.body[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("to_user_id");
    expect(entry).toHaveProperty("to_display_name");
    expect(entry).toHaveProperty("amount");
    expect(entry).toHaveProperty("amount_cents");
    expect(entry).toHaveProperty("currency");
    expect(entry).toHaveProperty("status");
    expect(entry).toHaveProperty("created_at");
  });

  it("only includes outbound transfers (not deposits)", async () => {
    const res = await request(app).get("/api/transfers");
    expect(res.status).toBe(200);
    // All returned entries should have amount > 0 (no negative outbound records)
    for (const entry of res.body) {
      expect(entry.amount).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────
// POST /api/transfers
// ─────────────────────────────────────────────
describe("POST /api/transfers", () => {
  it("returns 201 on a valid transfer", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", `test-transfer-${Date.now()}`)
      .send({ to_user_id: "marla", amount: 1, currency: "EUR" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("transaction_id");
    expect(res.body).toHaveProperty("status", "COMPLETED");
    expect(res.body).toHaveProperty("recipient_tag", "@marla");
  });

  it("returns 400 when to_user_id is missing", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .send({ amount: 5, currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .send({ to_user_id: "marla", amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .send({ to_user_id: "marla", amount: -10 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when recipient tag does not exist", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", `test-unknown-${Date.now()}`)
      .send({ to_user_id: "unknown_user_xyz", amount: 1, currency: "EUR" });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when trying to transfer to yourself (tyler → tyler)", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", `test-self-${Date.now()}`)
      .send({ to_user_id: "tyler", amount: 1, currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns same response for duplicate Idempotency-Key (idempotent)", async () => {
    const key = `idempotent-transfer-${Date.now()}`;
    const payload = { to_user_id: "edward", amount: 1, currency: "EUR" };

    const first = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", key)
      .send(payload);

    const second = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", key)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.transaction_id).toBe(second.body.transaction_id);
  });

  it("accepts legacy recipient_tag field as fallback", async () => {
    const res = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", `test-legacy-${Date.now()}`)
      .send({ recipient_tag: "jack", amount: 1, currency: "EUR" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("recipient_tag", "@jack");
  });

  it("scopes idempotency keys per sender user (different senders can reuse key)", async () => {
    const sharedKey = `shared-user-key-${Date.now()}`;

    // First transfer from tyler (default sender)
    const resTyler = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", sharedKey)
      .send({ to_user_id: "marla", amount: 1, currency: "EUR" });

    // Second transfer from marla with SAME key to edward
    const resMarla = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", sharedKey)
      .send({ sender_tag: "marla", to_user_id: "edward", amount: 1, currency: "EUR" });

    expect(resTyler.status).toBe(201);
    expect(resMarla.status).toBe(201);
    expect(resTyler.body.transaction_id).not.toBe(resMarla.body.transaction_id);
  });

  it("purges idempotency records older than 2 years during maintenance cleanup", async () => {
    const { default: db, purgeExpiredIdempotencyRecords } = await import("../db/database");
    
    // Insert an old idempotency record created 3 years ago
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const oldKey = `expired-key-${Date.now()}`;

    db.prepare(`
      INSERT INTO idempotency_records (user_id, key, request_hash, response_code, response_body, created_at)
      VALUES ('test-user-id', ?, 'test-hash', 201, '{"status":"ok"}', ?)
    `).run(oldKey, threeYearsAgo.toISOString());

    // Verify record exists before purge
    const beforeCount = db.prepare("SELECT COUNT(*) as count FROM idempotency_records WHERE key = ?").get(oldKey) as { count: number };
    expect(beforeCount.count).toBe(1);

    // Execute 2-year purge
    const purged = purgeExpiredIdempotencyRecords(2);
    expect(purged).toBeGreaterThanOrEqual(1);

    // Verify expired record is deleted
    const afterCount = db.prepare("SELECT COUNT(*) as count FROM idempotency_records WHERE key = ?").get(oldKey) as { count: number };
    expect(afterCount.count).toBe(0);
  });

  it("returns 409 Conflict when a request arrives while IN_PROGRESS", async () => {
    const { default: db } = await import("../db/database");
    const lockKey = `lock-in-progress-key-${Date.now()}`;
    const tyler = (await import("../repositories/user.repository")).UserRepository.getPrimaryUser();

    // Manually insert an IN_PROGRESS lock record
    db.prepare(`
      INSERT INTO idempotency_records (user_id, key, request_hash, response_code, response_body, status, created_at)
      VALUES (?, ?, 'dummy-hash', 0, '', 'IN_PROGRESS', ?)
    `).run(tyler.id, lockKey, new Date().toISOString());

    const res = await request(app)
      .post("/api/transfers")
      .set("Idempotency-Key", lockKey)
      .send({ to_user_id: "marla", amount: 1, currency: "EUR" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Request currently being processed/i);
    expect(res.body.status).toBe("IN_PROGRESS");

    // Clean up test lock record
    db.prepare("DELETE FROM idempotency_records WHERE user_id = ? AND key = ?").run(tyler.id, lockKey);
  });

  it("handles concurrent requests with same Idempotency-Key gracefully returning 201 or 409 IN_PROGRESS", async () => {
    const key = `race-condition-key-${Date.now()}`;
    const payload = { to_user_id: "marla", amount: 1, currency: "EUR" };

    // Fire 5 concurrent requests with identical key and payload
    const results = await Promise.all([
      request(app).post("/api/transfers").set("Idempotency-Key", key).send(payload),
      request(app).post("/api/transfers").set("Idempotency-Key", key).send(payload),
      request(app).post("/api/transfers").set("Idempotency-Key", key).send(payload),
      request(app).post("/api/transfers").set("Idempotency-Key", key).send(payload),
      request(app).post("/api/transfers").set("Idempotency-Key", key).send(payload),
    ]);

    // Responses should be either 201 Created (completed) or 409 Conflict ("Request currently being processed")
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);

    const completedRes = results.filter((r) => r.status === 201);
    const inProgressRes = results.filter((r) => r.status === 409);

    expect(completedRes.length + inProgressRes.length).toBe(5);
    if (inProgressRes.length > 0) {
      expect(inProgressRes[0].body.error).toMatch(/Request currently being processed/i);
    }
  });

  // ─────────────────────────────────────────────
  // Payment Intent Pattern (Prepare & Confirm)
  // ─────────────────────────────────────────────
  describe("Payment Intent Pattern (POST /api/transfers/intent & /confirm)", () => {
    it("creates an intent on POST /api/transfers/intent and confirms on /confirm", async () => {
      // Step 1: Prepare
      const intentRes = await request(app)
        .post("/api/transfers/intent")
        .send({ to_user_id: "marla", amount: 15, currency: "EUR" });

      expect(intentRes.status).toBe(201);
      expect(intentRes.body).toHaveProperty("intent_id");
      expect(intentRes.body.intent_id).toMatch(/^pi_/);
      expect(intentRes.body.status).toBe("REQUIRES_CONFIRMATION");

      const intentId = intentRes.body.intent_id;

      // Step 2: Confirm
      const confirmRes = await request(app)
        .post("/api/transfers/confirm")
        .send({ intent_id: intentId });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body).toHaveProperty("status", "SUCCEEDED");
      expect(confirmRes.body).toHaveProperty("intent_id", intentId);
      expect(confirmRes.body).toHaveProperty("transaction_id");
    });

    it("returns previous result without duplicate debit when retry confirmation happens (socket timeout simulation)", async () => {
      // Step 1: Prepare
      const intentRes = await request(app)
        .post("/api/transfers/intent")
        .send({ to_user_id: "edward", amount: 10, currency: "EUR" });

      const intentId = intentRes.body.intent_id;

      // Step 2: First Confirm
      const confirmFirst = await request(app)
        .post("/api/transfers/confirm")
        .send({ intent_id: intentId });

      // Step 3: Retried Confirm (simulating socket timeout / retry)
      const confirmSecond = await request(app)
        .post("/api/transfers/confirm")
        .send({ intent_id: intentId });

      expect(confirmFirst.status).toBe(200);
      expect(confirmSecond.status).toBe(200);
      expect(confirmFirst.body.transaction_id).toBe(confirmSecond.body.transaction_id);
      expect(confirmSecond.body.status).toBe("SUCCEEDED");
    });
  });
});

