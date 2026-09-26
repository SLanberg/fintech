"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";
import Watchlist from "./components/Watchlist";
import SafeToSpend from "./components/SafeToSpend";
import { spendingScenario } from "../lib/mock-spending";
import { calendarDate, dateKey } from "../lib/safe-to-spend";
import SpendingSettings from "./components/SpendingSettings";
import PurchaseSimulator from "./components/PurchaseSimulator";
import { useSpendingState } from "../lib/use-spending-state";
import { categoryForMcc, CATEGORY_LABELS } from "../lib/purchase-nudge";
import type { SpendingSettings as SpendingPreferences } from "../lib/spending-settings";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

const REVOLUT_CONTACTS = [
  { initials: "AB", name: "Alexander B.", tag: "alexander", digits: "€50.00", gradient: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" },
  { initials: "MS", name: "Marla Singer", tag: "marla", digits: "€120.00", gradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)" },
  { initials: "EN", name: "Edward Norton", tag: "edward", digits: "€35.00", gradient: "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)" },
  { initials: "JD", name: "Jack Durden", tag: "jack", digits: "€15.00", gradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)" },
];

interface UserInfo {
  name: string;
  tag?: string;
  email?: string;
  birthDate?: string;
  accountType: string;
  avatarUrl: string;
}

interface Transaction {
  id: number | string;
  name: string;
  category: string;
  date: string;
  amount: string;
  isIncome: boolean;
  icon?: string;
  mcc?: string | null;
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

const monthTransactions = spendingScenario.transactions.filter(tx => tx.date.startsWith(spendingScenario.asOfDate.slice(0, 7)));
const DEMO_ACCOUNT: AccountState = {
  user: { name: "Tyler Durden", accountType: "EUR demo account", avatarUrl: "/Tyler.jpg" },
  balance: spendingScenario.balance,
  currency: spendingScenario.currency,
  stats: {
    monthlyIncome: monthTransactions.filter(tx => tx.isIncome).reduce((sum, tx) => sum + tx.amount, 0),
    monthlyExpenses: monthTransactions.filter(tx => !tx.isIncome).reduce((sum, tx) => sum + tx.amount, 0),
  },
};
const DEMO_TRANSACTIONS: Transaction[] = spendingScenario.transactions.map(tx => ({ ...tx, amount: `${tx.isIncome ? "+" : "−"} €${tx.amount.toFixed(2)}` }));

export default function Home() {
  const { state: spendingState, setState: setSpendingState, ready: settingsReady, storageUnavailable } = useSpendingState();
  const changeSpendingSettings = (settings: SpendingPreferences) => setSpendingState(current => ({ ...current, settings }));
  const [isDemo, setIsDemo] = useState(true);
  const [showBalance, setShowBalance] = useState(true);
  const [account, setAccount] = useState<AccountState | null>(DEMO_ACCOUNT);
  const [transactions, setTransactions] = useState<Transaction[]>(DEMO_TRANSACTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab navigation state
  const [activeTab, setActiveTab] = useState<"home" | "invest" | "payments" | "settings">("home");

  // Direct transfer state for Payments tab
  const [recipientTag, setRecipientTag] = useState("alexander");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDesc, setTransferDesc] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async (demo = isDemo) => {
    try {
      setLoading(true);
      setError(null);

      if (demo) {
        setAccount(DEMO_ACCOUNT);
        setTransactions(DEMO_TRANSACTIONS);
        return;
      }

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
    } catch (err: unknown) {
      console.error("Error fetching data:", err);
      setError(err instanceof Error ? err.message : "Cannot connect to backend server");
    } finally {
      setLoading(false);
    }
  };

  const recordDemoTransaction = (amount: number, isIncome: boolean, name: string, category: string) => {
    setAccount(current => current ? {
      ...current,
      balance: Math.round((current.balance + (isIncome ? amount : -amount)) * 100) / 100,
      stats: {
        monthlyIncome: current.stats.monthlyIncome + (isIncome ? amount : 0),
        monthlyExpenses: current.stats.monthlyExpenses + (isIncome ? 0 : amount),
      },
    } : current);
    setTransactions(current => [{ id: `demo-${Date.now()}`, name, category, mcc: null, date: spendingScenario.asOfDate, amount: `${isIncome ? "+" : "−"} €${amount.toFixed(2)}`, isIncome }, ...current]);
  };

  const handleQuickAction = async (type: "deposit" | "transfer") => {
    const amountStr = prompt(
      type === "deposit"
        ? "Enter deposit amount (EUR):"
        : "Enter transfer amount (EUR):"
    );
    if (!amountStr) return;

    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Please enter a valid positive number.");
      return;
    }

    if (isDemo) {
      recordDemoTransaction(amount, type === "deposit", type === "deposit" ? "Top Up Deposit" : "Transfer to @alexander", type === "deposit" ? "Deposit" : "Transfer");
      return;
    }

    try {
      setActionLoading(true);
      const isIncome = type === "deposit";
      const name = isIncome ? "Top Up Deposit" : "Bank Transfer to @alexander";
      const category = isIncome ? "Deposit" : "Transfer";

      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          amount,
          isIncome,
          recipient_tag: "alexander",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit transaction.");
      }

      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to complete transaction.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDirectTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    const cleanTag = recipientTag.replace("@", "").trim();
    if (!cleanTag) {
      alert("Please enter a recipient tag.");
      return;
    }

    if (isDemo) {
      recordDemoTransaction(amount, false, transferDesc.trim() || `Transfer to @${cleanTag}`, "Transfer");
      setTransferAmount("");
      setTransferDesc("");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_tag: cleanTag,
          amount,
          description: transferDesc.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to execute transfer.");
      }

      setTransferAmount("");
      setTransferDesc("");
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to complete transfer.");
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
        <div style={{ padding: "40px", textAlign: "center", color: "#ef4444" }}>
          <div className={styles.errorMessage}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
          <p style={{ fontSize: "14px", color: "#666", marginTop: "12px" }}>
            Make sure Express backend server is running on http://localhost:5001
          </p>
          <button
            onClick={() => void fetchData()}
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
          <button type="button" className={styles.actionBtn} style={{ margin: "16px auto" }} onClick={() => { setIsDemo(true); void fetchData(true); }}>Use demo account</button>
        </div>
      </div>
    );
  }

  const user = account?.user || {
    name: "Tyler Durden",
    accountType: "Personal Account",
    avatarUrl: "/Tyler.jpg",
  };

  const simulatedSpending = isDemo ? spendingState.purchases.reduce((sum, purchase) => sum + Math.round(purchase.amount * 100), 0) / 100 : 0;
  const balance = Math.round(((account?.balance ?? 0) - simulatedSpending) * 100) / 100;
  const displayTransactions: Transaction[] = isDemo ? [
    ...[...spendingState.purchases].reverse().map(purchase => ({ id: purchase.id, name: purchase.merchantName, category: CATEGORY_LABELS[categoryForMcc(purchase.mcc)], mcc: purchase.mcc, date: purchase.localDate, amount: `− €${purchase.amount.toFixed(2)}`, isIncome: false })),
    ...transactions,
  ] : transactions;
  const currency = account?.currency || "EUR";
  const monthlyIncome = account?.stats.monthlyIncome ?? 0;
  const monthlyExpenses = (account?.stats.monthlyExpenses ?? 0) + simulatedSpending;

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
        {storageUnavailable && <p role="status" className={styles.storageNote}>Device storage is unavailable. Your settings and waiting list will last for this visit only.</p>}
        {activeTab === "home" && (
          <>
            <div className={styles.demoControls}>
              <p>{isDemo ? `Demo · ${spendingScenario.asOfDate} · Four days after rent` : "Live balance · Demo recurring plan and savings goal"}</p>
              <button type="button" onClick={() => { setAccount(null); setIsDemo(!isDemo); void fetchData(!isDemo); }}>
                {isDemo ? "Use live account" : "Use demo account"}
              </button>
            </div>
            {settingsReady ? <>
              <SafeToSpend balance={balance} today={isDemo ? spendingScenario.asOfDate : dateKey(calendarDate(new Date()))} visible={showBalance} settings={spendingState.settings} onSettingsChange={changeSpendingSettings} onOpenSettings={() => setActiveTab('settings')} />
              {isDemo && <PurchaseSimulator state={spendingState} setState={setSpendingState} balance={balance} today={spendingScenario.asOfDate} visible={showBalance} />}
            </> : <p className={styles.storageNote}>Loading your spending settings…</p>}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Deposit
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleQuickAction("transfer")}
                  disabled={actionLoading}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="7" y1="17" x2="17" y2="7" />
                    <polyline points="7 7 17 7 17 17" />
                  </svg>
                  Transfer
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => alert("Exchange feature coming soon!")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m16 3 4 4-4 4" />
                    <path d="M20 7H4" />
                    <path d="m8 21-4-4 4-4" />
                    <path d="M4 17h16" />
                  </svg>
                  Exchange
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => alert("Account details coming soon!")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="20" height="14" x="2" y="5" rx="2" />
                    <line x1="2" x2="22" y1="10" y2="10" />
                  </svg>
                  Details
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
                <span className={styles.viewAll} onClick={() => setActiveTab("payments")}>
                  View All
                </span>
              </div>

              <div className={styles.transactionList}>
                {displayTransactions.length === 0 ? (
                  <div className={styles.emptyTransactions}>No recent transactions</div>
                ) : (
                  displayTransactions.slice(0, 5).map((t) => (
                    <div key={t.id} className={styles.transactionItem}>
                      <div className={styles.transactionLeft}>
                        <div className={styles.iconCircle}>
                          {t.isIncome ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                              <line x1="17" y1="7" x2="7" y2="17" />
                              <polyline points="17 17 7 17 7 7" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5">
                              <line x1="7" y1="17" x2="17" y2="7" />
                              <polyline points="7 7 17 7 17 17" />
                            </svg>
                          )}
                        </div>
                        <div className={styles.transactionDetails}>
                          <span className={styles.transactionName}>{t.name}</span>
                          <span className={styles.transactionDate}>
                            {t.date} • {t.mcc ? CATEGORY_LABELS[categoryForMcc(t.mcc)] : t.category}
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
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === "settings" && settingsReady && <SpendingSettings settings={spendingState.settings} onChange={changeSpendingSettings} onBack={() => setActiveTab('home')} />}
        {activeTab === "invest" && (
          <section className={styles.section}>
            <div className={styles.balanceCard}>
              <div className={styles.balanceHeader}>
                <span className={styles.balanceLabel}>Investment Portfolio</span>
                <span className={styles.positive} style={{ fontSize: "14px", fontWeight: 600 }}>
                  +14.2% total return
                </span>
              </div>
              <div className={styles.balanceAmountRow}>
                <span className={styles.balanceAmount}>€12,450.00</span>
                <span className={styles.currency}>EUR</span>
              </div>
            </div>

            <div className={styles.sectionHeader} style={{ marginTop: "16px" }}>
              <h2 className={styles.sectionTitle}>Featured Assets</h2>
            </div>
            <div className={styles.transactionList}>
              <div className={styles.transactionItem}>
                <div className={styles.transactionLeft}>
                  <div className={styles.iconCircle}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                      <polyline points="16 7 22 7 22 13" />
                    </svg>
                  </div>
                  <div className={styles.transactionDetails}>
                    <span className={styles.transactionName}>S&P 500 Index Fund</span>
                    <span className={styles.transactionDate}>US Stocks • ETF</span>
                  </div>
                </div>
                <span className={`${styles.transactionAmount} ${styles.incomeAmount}`}>+8.4%</span>
              </div>
              <div className={styles.transactionItem}>
                <div className={styles.transactionLeft}>
                  <div className={styles.iconCircle}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div className={styles.transactionDetails}>
                    <span className={styles.transactionName}>Tech Leaders Basket</span>
                    <span className={styles.transactionDate}>Technology • Stocks</span>
                  </div>
                </div>
                <span className={`${styles.transactionAmount} ${styles.incomeAmount}`}>+18.9%</span>
              </div>
            </div>

            {/* Real-time Finnhub Market Watchlist on Invest Tab */}
            <Watchlist apiBase={API_BASE} />
          </section>
        )}

        {activeTab === "payments" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* TOP PANEL: Quick Actions & Instant Money Transfer */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Quick Payments & Actions</h2>
              </div>
              
              <div className={styles.actionGrid}>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                  onClick={() => setRecipientTag("alexander")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="7" y1="17" x2="17" y2="7" />
                    <polyline points="7 7 17 7 17 17" />
                  </svg>
                  Send Money
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => alert("Request payment feature coming soon!")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="17" y1="7" x2="7" y2="17" />
                    <polyline points="17 17 7 17 7 7" />
                  </svg>
                  Request
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => alert("Pay bills coming soon!")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  Pay Bills
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => alert("QR payment coming soon!")}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  Scan QR
                </button>
              </div>

              {/* Instant Transfer Box - Revolut Chat Style */}
              <div className={styles.quickTransferCard}>
                <div className={styles.quickTransferHeader}>
                  <div>
                    <span className={styles.quickTransferTitle}>Quick Transfer & Chat</span>
                    <div className={styles.quickTransferSubtitle}>Send money instantly like a chat message</div>
                  </div>
                </div>

                {/* Revolut Contacts Chat List: 2-letter Avatar on left, Name/Tag in middle, Digits on right */}
                <div className={styles.contactsChatList}>
                  {REVOLUT_CONTACTS.map((c) => {
                    const isSelected = recipientTag.toLowerCase() === c.tag.toLowerCase();
                    return (
                      <button
                        key={c.tag}
                        type="button"
                        className={`${styles.contactChatItem} ${isSelected ? styles.contactChatItemActive : ""}`}
                        onClick={() => setRecipientTag(c.tag)}
                      >
                        <div className={styles.contactLeft}>
                          <div className={styles.contactAvatar} style={{ background: c.gradient }}>
                            {c.initials}
                          </div>
                          <div className={styles.contactDetails}>
                            <span className={styles.contactName}>{c.name}</span>
                            <span className={styles.contactTag}>@{c.tag}</span>
                          </div>
                        </div>
                        <div className={styles.contactDigits}>
                          <span>{c.digits}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Direct Money Transfer Form */}
                <form
                  onSubmit={handleDirectTransfer}
                  className={styles.transferInputForm}
                  style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #f4f4f5" }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#71717a", marginBottom: "4px" }}>
                    Send to <span style={{ color: "#09090b" }}>@{recipientTag}</span>
                  </div>
                  <div className={styles.transferInputRow}>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Amount (€)"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      className={styles.inputField}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Note / Description (optional)"
                      value={transferDesc}
                      onChange={(e) => setTransferDesc(e.target.value)}
                      className={styles.inputField}
                    />
                    <button
                      type="submit"
                      className={styles.transferSubmitBtn}
                      disabled={actionLoading}
                    >
                      {actionLoading ? "Sending..." : "Send"}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                    </button>
                  </div>
                </form>
              </div>
            </section>


          </div>
        )}
      </main>

      {/* Floating Bottom Menu */}
      <nav className={styles.floatingNav}>
        <button
          className={`${styles.navItem} ${activeTab === "home" ? styles.navItemActive : ""}`}
          onClick={() => setActiveTab("home")}
          type="button"
        >
          <svg
            className={styles.navIcon}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>Home</span>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "invest" ? styles.navItemActive : ""}`}
          onClick={() => setActiveTab("invest")}
          type="button"
        >
          <svg
            className={styles.navIcon}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          <span>Invest</span>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "payments" ? styles.navItemActive : ""}`}
          onClick={() => setActiveTab("payments")}
          type="button"
        >
          <svg
            className={styles.navIcon}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="20" height="14" x="2" y="5" rx="2" />
            <line x1="2" x2="22" y1="10" y2="10" />
          </svg>
          <span>Payments</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'settings' ? styles.navItemActive : ''}`} type="button" onClick={() => setActiveTab('settings')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/></svg><span>Settings</span>
        </button>
      </nav>
    </div>
  );
}

