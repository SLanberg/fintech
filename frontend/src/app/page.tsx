"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import styles from "./page.module.css";
import { AnimatedBalance } from "@/components/AnimatedBalance";

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
  description?: string;
  other_user_name?: string;
  other_tag?: string;
  sender_tag?: string;
  recipient_tag?: string;
  category: string;
  date: string;
  amount: string;
  amount_cents?: number;
  isIncome: boolean;
  icon?: string;
  status?: string;
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

  // Tab navigation state
  const [activeTab, setActiveTab] = useState<"home" | "invest" | "payments">("home");
  const [paymentViewFilter, setPaymentViewFilter] = useState<"all" | "contacts">("all");
  const [txVisibleCount, setTxVisibleCount] = useState(10);

  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferRecipientTag, setTransferRecipientTag] = useState("alexander");
  const [transferAmountInput, setTransferAmountInput] = useState("");
  const [transferDescInput, setTransferDescInput] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccessData, setTransferSuccessData] = useState<{ amount: number; recipient: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getContactSummary = (tag: string) => {
    const clean = tag.toLowerCase().replace(/^@/, "");
    const tx = transactions.find(
      (t) =>
        t.other_tag?.toLowerCase() === clean ||
        t.recipient_tag?.toLowerCase() === clean ||
        t.sender_tag?.toLowerCase() === clean ||
        t.name.toLowerCase().includes(`@${clean}`)
    );
    return tx ? tx.amount : "€0.00";
  };

  const getContactInfo = (tx: Transaction) => {
    const cleanOtherTag = (tx.other_tag || tx.recipient_tag || tx.sender_tag || "").toLowerCase().replace(/^@/, "");
    const found = REVOLUT_CONTACTS.find((c) => c.tag.toLowerCase() === cleanOtherTag);
    if (found) return found;

    let initials = tx.isIncome ? "TD" : "TX";
    if (tx.other_user_name) {
      const parts = tx.other_user_name.trim().split(" ");
      initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    }

    return {
      initials,
      name: tx.other_user_name || tx.name,
      tag: cleanOtherTag || (tx.isIncome ? "deposit" : "transfer"),
      digits: tx.amount,
      gradient: tx.isIncome
        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
        : "linear-gradient(135deg, #64748b 0%, #475569 100%)",
    };
  };

  const openTransferModal = (tag?: string) => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    if (tag) {
      setTransferRecipientTag(tag.replace(/^@/, ""));
    }
    setTransferAmountInput("");
    setTransferDescInput("");
    setTransferError(null);
    setTransferSuccessData(null);
    setIsTransferModalOpen(true);
  };

  const closeTransferModal = () => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    setIsTransferModalOpen(false);
    setTransferSuccessData(null);
    setTransferError(null);
  };

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
    if (type === "transfer") {
      openTransferModal();
      return;
    }

    const amountStr = prompt("Enter deposit amount (EUR):");
    if (!amountStr) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid positive number.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Top Up Deposit",
          category: "Deposit",
          amount,
          isIncome: true,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit deposit.");
      }

      await fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to complete deposit.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);

    const amount = parseFloat(transferAmountInput);
    if (isNaN(amount) || amount <= 0) {
      setTransferError("Please enter a valid amount greater than €0.00.");
      return;
    }

    const currentBalance = account?.balance ?? 0;
    if (amount > currentBalance) {
      setTransferError(`Insufficient funds. Available balance: €${currentBalance.toFixed(2)}.`);
      return;
    }

    const cleanTag = transferRecipientTag.trim().replace(/^@/, "");
    if (!cleanTag) {
      setTransferError("Please enter a recipient tag (e.g. alexander).");
      return;
    }

    try {
      setActionLoading(true);
      const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}`;
      const res = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          recipient_tag: cleanTag,
          amount,
          description: transferDescInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to execute money transfer.");
      }

      setTransferSuccessData({ amount, recipient: cleanTag });
      setTransferAmountInput("");
      setTransferDescInput("");
      await fetchData();

      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => {
        setIsTransferModalOpen(false);
        setTransferSuccessData(null);
      }, 2600);
    } catch (err: any) {
      setTransferError(err.message || "Transfer failed. Please check recipient tag.");
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
        <div style={{ display: activeTab === "home" ? "contents" : "none" }}>
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
                <AnimatedBalance
                  value={balance}
                  show={showBalance}
                  className={styles.balanceAmount}
                />
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
                {transactions.length === 0 ? (
                  <div className={styles.emptyTransactions}>No recent transactions</div>
                ) : (
                  transactions.slice(0, 5).map((t) => (
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
                  ))
                )}
              </div>
            </section>
        </div>

        <div style={{ display: activeTab === "invest" ? "contents" : "none" }}>
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
          </section>
        </div>

        <div style={{ display: activeTab === "payments" ? "contents" : "none" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

              {/* Instant Transfer Box - Revolut Chat Style */}
              <div className={styles.quickTransferCard}>
                <div className={styles.quickTransferHeader}>
                  <div>
                    <span className={styles.quickTransferTitle}>Transactions & Instant Transfers</span>
                    <div className={styles.quickTransferSubtitle}>Live transaction ledger • Tap to repeat transfer</div>
                  </div>
                  <div className={styles.filterPills}>
                    <button
                      type="button"
                      className={`${styles.filterPill} ${paymentViewFilter === "all" ? styles.filterPillActive : ""}`}
                      onClick={() => { setPaymentViewFilter("all"); setTxVisibleCount(10); }}
                    >
                      All ({transactions.length})
                    </button>
                    <button
                      type="button"
                      className={`${styles.filterPill} ${paymentViewFilter === "contacts" ? styles.filterPillActive : ""}`}
                      onClick={() => setPaymentViewFilter("contacts")}
                    >
                      Contacts ({REVOLUT_CONTACTS.length})
                    </button>
                  </div>
                </div>

                {/* Quick-send contacts strip */}
                <div className={styles.quickContactsStrip}>
                  <span className={styles.quickContactsLabel}>Quick send</span>
                  <div className={styles.quickContactsList}>
                    {REVOLUT_CONTACTS.map((c) => (
                      <button
                        key={c.tag}
                        type="button"
                        className={styles.quickContactBtn}
                        onClick={() => openTransferModal(c.tag)}
                        title={`Send money to ${c.name} (@${c.tag})`}
                      >
                        <div className={styles.quickContactAvatarBubble} style={{ background: c.gradient }}>
                          {c.initials}
                        </div>
                        <div className={styles.quickContactMeta}>
                          <span className={styles.quickContactName}>{c.name.split(" ")[0]}</span>
                          <span className={styles.quickContactTag}>@{c.tag}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Transaction history list or Contacts list depending on filter */}
                <div className={styles.contactsChatList}>
                  {paymentViewFilter === "contacts"
                    ? REVOLUT_CONTACTS.map((c) => (
                        <button
                          key={c.tag}
                          type="button"
                          className={styles.contactChatItem}
                          onClick={() => openTransferModal(c.tag)}
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
                      ))
                    : transactions.length === 0
                    ? (
                        <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-secondary, #6b7280)", fontSize: "14px" }}>
                          No transactions yet
                        </div>
                      )
                    : transactions.slice(0, txVisibleCount).map((t) => {
                        const info = getContactInfo(t);
                        const senderTag = t.sender_tag || (t.isIncome ? info.tag : "tyler");
                        const recipientTag = t.recipient_tag || (t.isIncome ? "tyler" : info.tag);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={styles.contactChatItem}
                            onClick={() => !t.isIncome && openTransferModal(info.tag)}
                            style={{ cursor: t.isIncome ? "default" : "pointer" }}
                          >
                            <div className={styles.contactLeft}>
                              <div
                                className={styles.contactAvatar}
                                style={{ background: info.gradient }}
                              >
                                {info.initials}
                              </div>
                              <div className={styles.contactDetails}>
                                <span className={styles.contactName}>{info.name}</span>
                                <span className={styles.contactTag}>
                                  @{senderTag} → @{recipientTag} · {t.date}
                                </span>
                              </div>
                            </div>
                            <div
                              className={styles.contactDigits}
                              style={{ color: t.isIncome ? "#10b981" : undefined }}
                            >
                              <span>{t.amount}</span>
                              {t.isIncome ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                                  <line x1="17" y1="7" x2="7" y2="17" />
                                  <polyline points="17 17 7 17 7 7" />
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <line x1="7" y1="17" x2="17" y2="7" />
                                  <polyline points="7 7 17 7 17 17" />
                                </svg>
                              )}
                            </div>
                          </button>
                        );
                      })
                  }
                </div>

                {/* Load more button */}
                {paymentViewFilter === "all" && txVisibleCount < transactions.length && (
                  <button
                    type="button"
                    onClick={() => setTxVisibleCount((n) => n + 10)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      width: "100%",
                      marginTop: "8px",
                      padding: "10px 0",
                      background: "none",
                      border: "1px solid rgba(99,102,241,0.25)",
                      borderRadius: "10px",
                      color: "#6366f1",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    Load more ({transactions.length - txVisibleCount} remaining)
                  </button>
                )}


              </div>


          </div>
        </div>
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
      </nav>

      {/* ── Transfer Modal ── */}
      {isTransferModalOpen && (
        <div className={styles.modalOverlay} onClick={closeTransferModal}>
          {transferSuccessData ? (
            <div className={styles.successModalContainer} onClick={(e) => e.stopPropagation()}>
              <div className={styles.successIconWrapper}>
                <div className={styles.successPulseRing} />
                <div className={styles.successCheckCircle}>
                  <svg className={styles.successCheckSvg} viewBox="0 0 52 52">
                    <path
                      className={styles.successCheckmarkPath}
                      fill="none"
                      d="M14.1 27.2l7.1 7.2 16.7-16.8"
                    />
                  </svg>
                </div>
              </div>

              <div className={styles.successContent}>
                <h3 className={styles.successTitle}>Transfer Successful!</h3>
                <div className={styles.successAmount}>
                  -€{transferSuccessData.amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className={styles.successRecipient}>
                  Sent to <strong>@{transferSuccessData.recipient}</strong>
                </p>
              </div>

              <button
                type="button"
                className={styles.successDoneBtn}
                onClick={closeTransferModal}
              >
                Done
              </button>
            </div>
          ) : (
            <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className={styles.modalHeader}>
                <div>
                  <h2 className={styles.modalTitle}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="7" y1="17" x2="17" y2="7" />
                      <polyline points="7 7 17 7 17 17" />
                    </svg>
                    Send Money
                  </h2>
                  <p className={styles.modalSubtitle}>Transfer funds instantly by @tag</p>
                </div>
                <button
                  className={styles.closeBtn}
                  onClick={closeTransferModal}
                  type="button"
                  aria-label="Close transfer modal"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Quick-select contacts */}
              <div className={styles.quickContactRow}>
                {REVOLUT_CONTACTS.map((c) => {
                  const isActive = transferRecipientTag.toLowerCase() === c.tag.toLowerCase();
                  return (
                    <button
                      key={c.tag}
                      type="button"
                      className={`${styles.quickContactChip} ${isActive ? styles.quickContactChipActive : styles.quickContactChipHover}`}
                      onClick={() => setTransferRecipientTag(c.tag)}
                    >
                      <div
                        className={styles.quickContactAvatar}
                        style={{ background: isActive ? "rgba(255,255,255,0.25)" : c.gradient }}
                      >
                        {c.initials}
                      </div>
                      <span className={styles.quickContactName}>{c.name.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>

              {/* Form */}
              <form onSubmit={handleTransferSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

                {/* Recipient tag */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="transfer-tag">
                    Recipient @tag
                  </label>
                  <div className={styles.inputWithPrefix}>
                    <span className={styles.prefix}>@</span>
                    <input
                      id="transfer-tag"
                      className={styles.prefixInput}
                      type="text"
                      placeholder="username"
                      value={transferRecipientTag}
                      onChange={(e) => setTransferRecipientTag(e.target.value.replace(/^@/, ""))}
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>

                {/* Amount */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="transfer-amount">
                    Amount
                    <span className={styles.balanceHint}>
                      Available: €{(account?.balance ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2 })}
                    </span>
                  </label>
                  <div className={styles.inputWithPrefix}>
                    <span className={styles.prefix}>€</span>
                    <input
                      id="transfer-amount"
                      className={styles.prefixInput}
                      type="number"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={transferAmountInput}
                      onChange={(e) => setTransferAmountInput(e.target.value)}
                      required
                    />
                  </div>
                  {/* Quick amount chips */}
                  <div className={styles.amountChips}>
                    {[10, 25, 50, 100].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className={styles.amountChip}
                        onClick={() => setTransferAmountInput(String(amt))}
                      >
                        €{amt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Note (optional) */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="transfer-desc">Note (optional)</label>
                  <div className={styles.inputWithPrefix}>
                    <input
                      id="transfer-desc"
                      className={styles.prefixInput}
                      type="text"
                      placeholder="What's it for?"
                      value={transferDescInput}
                      onChange={(e) => setTransferDescInput(e.target.value)}
                      maxLength={120}
                    />
                  </div>
                </div>

                {/* Feedback */}
                {transferError && (
                  <div className={styles.errorBox}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {transferError}
                  </div>
                )}

                <button
                  type="submit"
                  className={styles.primarySubmitBtn}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    "Sending…"
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                      Send Money
                    </>
                  )}
                </button>
              </form>

            </div>
          )}
        </div>
      )}
    </div>
  );
}

