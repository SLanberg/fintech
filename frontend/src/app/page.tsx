"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import styles from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

interface UserInfo {
  name: string;
  tag?: string;
  email?: string;
  birthDate?: string;
  accountType: string;
  avatarUrl: string;
}

interface Transaction {
  id: number;
  name: string;
  category: string;
  date: string;
  amount: string;
  isIncome: boolean;
  icon: string;
}

interface AccountState {
  user: UserInfo;
  balance: number;
  currency: string;
  stats: {
    monthlyIncome: number;
    monthlyExpenses: number;
  };
}

export default function Home() {
  const [showBalance, setShowBalance] = useState(true);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick action modal / state
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [accRes, txRes] = await Promise.all([
        fetch(`${API_BASE}/account`),
        fetch(`${API_BASE}/transactions`),
      ]);

      if (!accRes.ok || !txRes.ok) {
        throw new Error("Failed to fetch data from backend server.");
      }

      const accData = await accRes.json();
      const txData = await txRes.json();

      setAccount(accData);
      setTransactions(txData);
    } catch (err: any) {
      console.error("Error fetching data:", err);
      setError(err.message || "Cannot connect to backend server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleQuickAction = async (type: "deposit" | "transfer") => {
    const amountStr = prompt(
      type === "deposit"
        ? "Enter deposit amount (EUR):"
        : "Enter transfer amount (EUR):"
    );
    if (!amountStr) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid positive number.");
      return;
    }

    try {
      setActionLoading(true);
      const isIncome = type === "deposit";
      const name = isIncome ? "Top Up Deposit" : "Bank Transfer";
      const category = isIncome ? "Deposit" : "Transfer";

      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          amount,
          isIncome,
          icon: isIncome ? "↓" : "↑",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit transaction.");
      }

      await fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to complete transaction.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !account) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <span>Loading account data...</span>
        </div>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div className={styles.container}>
        <div style={{ padding: "40px", textAlign: "center", color: "#e53e3e" }}>
          <p>⚠️ {error}</p>
          <p style={{ fontSize: "14px", color: "#666", marginTop: "8px" }}>
            Make sure Express backend server is running on http://localhost:5001
          </p>
          <button
            onClick={fetchData}
            style={{
              marginTop: "16px",
              padding: "8px 16px",
              borderRadius: "8px",
              background: "#111",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const user = account?.user || {
    name: "Tyler Durden",
    accountType: "Personal Account",
    avatarUrl: "/Tyler.jpg",
  };

  const balance = account?.balance ?? 0;
  const currency = account?.currency || "EUR";
  const monthlyIncome = account?.stats.monthlyIncome ?? 0;
  const monthlyExpenses = account?.stats.monthlyExpenses ?? 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>Balance</div>
        <div className={styles.userBadge}>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user.name}</span>
            <span className={styles.accountType}>{user.accountType}</span>
          </div>
          <Image
            src={user.avatarUrl}
            alt="Tyler Avatar"
            width={36}
            height={36}
            className={styles.avatar}
          />
        </div>
      </header>

      <main className={styles.main}>
        {/* Balance Card */}
        <section className={styles.balanceCard}>
          <div className={styles.balanceHeader}>
            <span className={styles.balanceLabel}>Total Balance</span>
            <button
              onClick={() => setShowBalance(!showBalance)}
              className={styles.hideToggle}
              type="button"
            >
              {showBalance ? "Hide" : "Show"}
            </button>
          </div>

          <div className={styles.balanceAmountRow}>
            <span className={styles.balanceAmount}>
              {showBalance
                ? balance.toLocaleString("de-DE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "••••••••"}
            </span>
            <span className={styles.currency}>{currency}</span>
          </div>

          <div className={styles.actionGrid}>
            <button
              className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
              onClick={() => handleQuickAction("deposit")}
              disabled={actionLoading}
              type="button"
            >
              <span>+</span> Deposit
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => handleQuickAction("transfer")}
              disabled={actionLoading}
              type="button"
            >
              <span>↑</span> Transfer
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => alert("Exchange feature coming soon!")}
              type="button"
            >
              <span>⇄</span> Exchange
            </button>
          </div>
        </section>

        {/* Quick Stats */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <span className={styles.statTitle}>Monthly Income</span>
            <span className={`${styles.statValue} ${styles.positive}`}>
              +€{monthlyIncome.toLocaleString("de-DE", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statTitle}>Monthly Expenses</span>
            <span className={styles.statValue}>
              -€{monthlyExpenses.toLocaleString("de-DE", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Recent Transactions */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent Transactions</h2>
            <span className={styles.viewAll}>View All</span>
          </div>

          <div className={styles.transactionList}>
            {transactions.map((t) => (
              <div key={t.id} className={styles.transactionItem}>
                <div className={styles.transactionLeft}>
                  <div className={styles.iconCircle}>{t.icon}</div>
                  <div className={styles.transactionDetails}>
                    <span className={styles.transactionName}>{t.name}</span>
                    <span className={styles.transactionDate}>
                      {t.date} • {t.category}
                    </span>
                  </div>
                </div>
                <span
                  className={`${styles.transactionAmount} ${
                    t.isIncome ? styles.incomeAmount : ""
                  }`}
                >
                  {t.amount}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
