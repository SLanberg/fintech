# Lockin & Build (Monorepo Architecture)

The application is split into **Backend** (Express.js + TypeScript) and **Frontend** (Next.js 16 + React 19).

## Project Structure

```
/
├── backend/                # Express.js REST API server (port 5001)
│   ├── src/
│   │   └── server.ts       # /api/account, /api/transactions endpoints
│   ├── package.json
│   └── tsconfig.json
├── frontend/               # Next.js application frontend (port 3000)
│   ├── src/
│   │   └── app/            # Pages and components
│   ├── public/             # Static assets (avatars, icons)
│   ├── package.json
│   └── tsconfig.json
├── package.json            # Root workspace config for concurrent execution
└── README.md
```

## Running the Application

### 1. Concurrent Frontend & Backend Startup (Recommended)
In the root directory, run:
```bash
npm run dev
```
This will launch:
- **Backend API:** `http://localhost:5001`
- **Frontend App:** `http://localhost:3000`

### 2. Individual Startup

#### Backend Only:
```bash
npm run dev:backend
# or: cd backend && npm run dev
```

#### Frontend Only:
```bash
npm run dev:frontend
# or: cd frontend && npm run dev
```

## Backend API Endpoints (`http://localhost:5001/api`)

- `GET /api/account` - Retrieve user profile, current balance, and income/expense statistics.
- `GET /api/transactions` - Retrieve full transactions list.
- `POST /api/transactions` - Perform deposit / top-up (dynamically updates balance).
- `GET /api/health` - Server health check.

