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
});
