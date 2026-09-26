import express, { Request, Response } from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory data store for demonstration
let accountData = {
  user: {
    name: "Tyler Durden",
    accountType: "Personal Account",
    avatarUrl: "/Tyler.jpg",
  },
  balance: 12450.80,
  currency: "EUR",
  monthlyIncome: 3450.00,
  monthlyExpenses: 1275.50,
};

let transactions = [
  { id: 1, name: "Apple Store", category: "Purchase", date: "Today, 14:20", amount: "- €199.00", isIncome: false, icon: "" },
  { id: 2, name: "Transfer from Alexander B.", category: "Deposit", date: "Yesterday, 18:45", amount: "+ €1,200.00", isIncome: true, icon: "↓" },
  { id: 3, name: "Coffee & Bakery", category: "Food & Drinks", date: "Sep 24, 09:15", amount: "- €14.50", isIncome: false, icon: "☕" },
  { id: 4, name: "Digital Ocean", category: "Services", date: "Sep 22, 11:30", amount: "- €48.00", isIncome: false, icon: "☁" },
];

// Routes
app.get("/api/account", (req: Request, res: Response) => {
  res.json({
    user: accountData.user,
    balance: accountData.balance,
    currency: accountData.currency,
    stats: {
      monthlyIncome: accountData.monthlyIncome,
      monthlyExpenses: accountData.monthlyExpenses,
    },
  });
});

app.get("/api/transactions", (req: Request, res: Response) => {
  res.json(transactions);
});

app.post("/api/transactions", (req: Request, res: Response) => {
  const { name, category, amount, isIncome, icon } = req.body;

  if (!name || amount === undefined) {
    return res.status(400).json({ error: "Name and amount are required." });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) {
    return res.status(400).json({ error: "Invalid amount format." });
  }

  const newTransaction = {
    id: Date.now(),
    name,
    category: category || (isIncome ? "Deposit" : "Transfer"),
    date: "Just now",
    amount: `${isIncome ? "+" : "-"} €${Math.abs(numAmount).toFixed(2)}`,
    isIncome: Boolean(isIncome),
    icon: icon || (isIncome ? "↓" : "↑"),
  };

  transactions.unshift(newTransaction);

  if (isIncome) {
    accountData.balance += Math.abs(numAmount);
    accountData.monthlyIncome += Math.abs(numAmount);
  } else {
    accountData.balance -= Math.abs(numAmount);
    accountData.monthlyExpenses += Math.abs(numAmount);
  }

  res.status(201).json({
    message: "Transaction processed successfully",
    transaction: newTransaction,
    newBalance: accountData.balance,
  });
});

app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server is running on http://localhost:${PORT}`);
});
