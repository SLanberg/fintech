import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { initDatabase } from "../db/database";
import { transactionsRouter } from "./transactions.router";

// Bootstrap isolated test app
const app = express();
app.use(express.json());
app.use("/api/transactions", transactionsRouter);

beforeAll(() => {
  initDatabase();
});

// ─────────────────────────────────────────────
// GET /api/transactions
// ─────────────────────────────────────────────
describe("GET /api/transactions", () => {
  it("returns 200 with an array", async () => {
    const res = await request(app).get("/api/transactions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("each entry has the expected fields", async () => {
    const res = await request(app).get("/api/transactions");
    expect(res.status).toBe(200);

    if (res.body.length > 0) {
      const entry = res.body[0];
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("category");
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("amount");
      expect(entry).toHaveProperty("amount_cents");
      expect(entry).toHaveProperty("isIncome");
    }
  });
});

// ─────────────────────────────────────────────
// POST /api/transactions
// ─────────────────────────────────────────────
describe("POST /api/transactions", () => {
  it("returns 201 on a valid top-up", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .set("Idempotency-Key", `test-topup-${Date.now()}`)
      .send({ amount: 5, currency: "EUR" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("transaction_id");
    expect(res.body).toHaveProperty("status", "COMPLETED");
  });

  it("returns 400 when amount is missing", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .send({ currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .send({ amount: 0, currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .send({ amount: -50, currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when amount is not a number", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .send({ amount: "abc", currency: "EUR" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns same response for duplicate Idempotency-Key (idempotent)", async () => {
    const key = `idempotent-topup-${Date.now()}`;
    const payload = { amount: 1, currency: "EUR" };

    const first = await request(app)
      .post("/api/transactions")
      .set("Idempotency-Key", key)
      .send(payload);

    const second = await request(app)
      .post("/api/transactions")
      .set("Idempotency-Key", key)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.transaction_id).toBe(second.body.transaction_id);
  });
});
