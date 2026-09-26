# API Reference — LockinAndBuild Backend

Base URL: `http://localhost:5001`

All endpoints are prefixed with `/api`.  
All monetary values are returned **both** in major units (e.g. `amount: 10.50`) and in integer minor units (e.g. `amount_cents: 1050`) for precision.

---

## Authentication

> **MVP / Hackathon note:** No authentication is required. All requests operate on the primary account holder — **Tyler Durden** (`@tyler`).

---

## Idempotency

`POST` endpoints support the `Idempotency-Key` request header.  
Sending the same key with the same payload returns the **original cached response** — no duplicate operation is performed.  
Sending the same key with a **different payload** returns `409 Conflict`.

```
Idempotency-Key: <your-unique-uuid>
```

---

## Endpoints

### Transactions

> Transactions represent the full history of all money movements — both top-ups (incoming) and outbound transfers.

---

#### `GET /api/transactions`

Returns the full immutable audit ledger for the primary user.

**Response `200 OK`**

```json
[
  {
    "id": "uuid",
    "idempotency_key": "uuid | null",
    "name": "Top-Up (EUR 100.00)",
    "category": "Deposit",
    "date": "Sep 26, 03:08 PM",
    "amount": "+ €100.00",
    "amount_cents": 10000,
    "isIncome": true,
    "icon": "↓",
    "created_at": "2026-09-26T12:08:00.000Z"
  }
]
```

| Field          | Type      | Description                                  |
|----------------|-----------|----------------------------------------------|
| `id`           | `string`  | Unique ledger entry UUID                     |
| `name`         | `string`  | Human-readable description                   |
| `category`     | `string`  | `"Deposit"` or `"Transfer"`                  |
| `date`         | `string`  | Formatted local date string                  |
| `amount`       | `string`  | Formatted amount with sign (e.g. `+ €10.00`) |
| `amount_cents` | `number`  | Exact integer minor units                    |
| `isIncome`     | `boolean` | `true` if money came in, `false` if sent out |
| `icon`         | `string`  | `↓` for income, `↑` for outbound             |
| `created_at`   | `string`  | ISO 8601 timestamp                           |

---

#### `POST /api/transactions`

Add money to the primary user's account (top-up / deposit).

**Request Body**

```json
{
  "amount": 100,
  "currency": "EUR"
}
```

| Field      | Type     | Required | Description                              |
|------------|----------|----------|------------------------------------------|
| `amount`   | `number` | YES      | Amount in major units (e.g. `100` = EUR 100) |
| `currency` | `string` | NO       | Currency code. Informational. Defaults to `"EUR"` |
| `name`     | `string` | NO       | Optional description label               |

**Request Headers**

| Header            | Description                        |
|-------------------|------------------------------------|
| `Idempotency-Key` | Optional UUID to prevent duplicates |

**Response `201 Created`**

```json
{
  "transaction_id": "uuid",
  "idempotency_key": "uuid",
  "sender_tag": "@alexander",
  "recipient_tag": "@tyler",
  "recipient_display_name": "Tyler Durden",
  "amount_cents": 10000,
  "formatted_amount": "+ €100.00",
  "currency": "EUR",
  "new_sender_balance_cents": 49000000,
  "formatted_new_balance": "€490000.00",
  "timestamp": "2026-09-26T12:08:00.000Z",
  "status": "COMPLETED"
}
```

**Error Responses**

| Status | Condition                              |
|--------|----------------------------------------|
| `400`  | `amount` is missing, zero, or negative |
| `500`  | Internal server error                  |

---

### Transfers

> Transfers represent outbound money movements — money sent from Tyler to another user.

---

#### `GET /api/transfers`

Returns the history of outbound transfers sent by the primary user.

**Response `200 OK`**

```json
[
  {
    "id": "uuid",
    "to_user_id": "marla",
    "to_display_name": "Marla Singer",
    "amount": 10.00,
    "amount_cents": 1000,
    "currency": "EUR",
    "description": "Transfer to @marla",
    "status": "COMPLETED",
    "date": "Sep 26, 03:10 PM",
    "created_at": "2026-09-26T12:10:00.000Z"
  }
]
```

| Field             | Type     | Description                       |
|-------------------|----------|-----------------------------------|
| `id`              | `string` | Unique ledger entry UUID          |
| `to_user_id`      | `string` | Recipient's public tag            |
| `to_display_name` | `string` | Recipient's display name          |
| `amount`          | `number` | Amount in major units             |
| `amount_cents`    | `number` | Exact integer minor units         |
| `currency`        | `string` | Currency code (e.g. `"EUR"`)      |
| `description`     | `string` | Transfer memo                     |
| `status`          | `string` | Always `"COMPLETED"`              |
| `date`            | `string` | Formatted local date string       |
| `created_at`      | `string` | ISO 8601 timestamp                |

---

#### `POST /api/transfers`

Send money from the primary user to another user by their public tag.

**Request Body**

```json
{
  "to_user_id": "marla",
  "amount": 10,
  "currency": "EUR"
}
```

| Field         | Type     | Required | Description                                 |
|---------------|----------|----------|---------------------------------------------|
| `to_user_id`  | `string` | YES      | Public tag of the recipient (e.g. `"marla"`) |
| `amount`      | `number` | YES      | Amount in major units (e.g. `10` = EUR 10)  |
| `currency`    | `string` | NO       | Currency code. Informational. Defaults to `"EUR"` |
| `description` | `string` | NO       | Optional memo / note                         |

**Request Headers**

| Header            | Description                         |
|-------------------|-------------------------------------|
| `Idempotency-Key` | Optional UUID to prevent duplicates  |

**Response `201 Created`**

```json
{
  "transaction_id": "uuid",
  "idempotency_key": "uuid",
  "sender_tag": "@tyler",
  "recipient_tag": "@marla",
  "recipient_display_name": "Marla Singer",
  "amount_cents": 1000,
  "formatted_amount": "- €10.00",
  "currency": "EUR",
  "new_sender_balance_cents": 9000,
  "formatted_new_balance": "€90.00",
  "timestamp": "2026-09-26T12:10:00.000Z",
  "status": "COMPLETED"
}
```

**Error Responses**

| Status | Condition                                          |
|--------|----------------------------------------------------|
| `400`  | `to_user_id` missing, amount invalid or zero       |
| `400`  | Insufficient funds                                  |
| `400`  | Self-transfer (cannot send money to yourself)       |
| `404`  | Recipient `to_user_id` not found                   |
| `409`  | Idempotency key reused with different payload       |
| `500`  | Internal server error                              |

---

## Known Contacts (Seed Data)

| Tag         | Display Name   |
|-------------|----------------|
| `tyler`     | Tyler Durden   |
| `alexander` | Alexander B.   |
| `marla`     | Marla Singer   |
| `edward`    | Edward Norton  |
| `jack`      | Jack Durden    |

---

## Other Endpoints

| Method | Path                  | Description                            |
|--------|-----------------------|----------------------------------------|
| `GET`  | `/api/health`         | Health check (`{ status: "ok" }`)      |
| `GET`  | `/api/account`        | Primary user profile + balance + stats |
| `GET`  | `/api/users/tag/:tag` | Lookup user by public tag              |
| `GET`  | `/api/user/entity`    | Full internal entity (debug only)      |
