# 💳 Lockin & Build

Lockin & Build is a modern FinTech dashboard application built with Next.js 16 (React 19) and Express.js REST API backed by SQLite.

---

## ⚡ Quick Start (1-Click Launcher)

The fastest way to start working on the project:

### macOS
Double-click `start.command` or run:
```bash
chmod +x start.command
./start.command
```

### Windows
Double-click `start.bat` or run:
```cmd
start.bat
```

> **What this does:** Automatically verifies workspace dependencies, initializes the local SQLite database automatically on backend launch if missing, launches both Backend (port 5001) and Frontend (port 3000) dev servers concurrently, and opens `http://localhost:3000` in your browser.

---

## 🛠 Manual Setup for Developers

If you prefer to run commands manually in your terminal:

### 1. Prerequisites
- **Node.js**: `v20` or higher
- **npm**: `v10` or higher

### 2. Installation
Clone the repository and install all workspace dependencies:

```bash
npm run install:all
npm install
```

### 3. Database Setup (Zero Config - SQLite)
The database is SQLite (`backend/lockin.db`) and initializes automatically on first backend startup.
If no database file is present, the server auto-creates the schema and populates starter seed data (Tyler Durden account & contacts).

To re-initialize or inspect the database:
- Simply delete `backend/lockin.db*` files and restart the backend server (`npm run dev:backend`).

### 4. Start Development Server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🗄 Project Scripts & Commands

Run commands from the workspace root:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launch both Frontend (3000) and Backend (5001) concurrently |
| `npm run dev:frontend` | Launch Next.js frontend only |
| `npm run dev:backend` | Launch Express.js backend with SQLite auto-init |
| `npm run install:all` | Install node modules for both `frontend` and `backend` |
| `npm run build` | Build production bundles for both services |

---

## 📁 Project Structure

```
fintech/
├── start.command      # macOS 1-click startup script
├── start.bat          # Windows 1-click startup script
├── backend/           # Express.js REST API Server
│   ├── src/
│   │   ├── db/        # SQLite connection & schema initialization
│   │   ├── routes/    # API endpoints (/api/account, /api/transactions)
│   │   └── server.ts
│   └── package.json
├── frontend/          # Next.js 16 Web Application
│   ├── src/
│   │   └── app/       # App router pages & components
│   └── package.json
```

---

## 🏛 Architecture & Idempotency Policies

### 1. Data Retention & TTL Policy
- **Idempotency Records**: Records in `idempotency_records` are configured with a **2-year retention policy (TTL)**.
- **Maintenance Routines**: Expired records (`created_at < 2 years ago`) are automatically purged on database initialization and via background periodic cleanup (every 24h). An index on `idempotency_records(created_at)` ensures efficient range queries and zero impact on transaction latency.

### 2. Concurrency & Horizontal Scaling
- **Single-Node Execution**: Atomic transfers currently enforce double-spending prevention using SQLite `BEGIN IMMEDIATE` file locks.
- **Horizontal Scaling Recommendation**: When deploying across multiple container instances or serverless nodes, replace process/file locks with a distributed lock manager (e.g., **Redis with Redlock algorithm** or **PostgreSQL `SELECT ... FOR UPDATE`** row-level locking).


