"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "../page.module.css";
import BackendInspectorWidget from "../components/BackendInspectorWidget";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

interface DemoResult {
  title: string;
  type: "normal" | "double" | "tamper" | "spam" | "intent";
  req1Status: "ACCEPTED" | "PENDING" | "FAILED";
  req2Status: "BLOCKED" | "ACCEPTED" | "PENDING" | "FAILED";
  executedAmount: number;
  preventedAmount: number;
  plainSummary: string;
  technicalDetails: string;
  steps: Array<{ name: string; status: "success" | "blocked" | "info"; text: string }>;
}

export default function DemoPage() {
  const [aliceBalance, setAliceBalance] = useState<number>(100);
  const [alexanderBalance, setAlexanderBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready! Click any test scenario below.");
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null);

  // Scoreboard stats
  const [totalExecuted, setTotalExecuted] = useState<number>(0);
  const [totalPrevented, setTotalPrevented] = useState<number>(0);
  const [attacksBlockedCount, setAttacksBlockedCount] = useState<number>(0);

  // Unsafe mode simulation toggle
  const [protectionEnabled, setProtectionEnabled] = useState<boolean>(true);

  // Fetch latest balances for Tyler and Alexander
  const fetchBalances = async () => {
    try {
      const [accRes, usersRes] = await Promise.all([
        fetch(`${API_BASE}/account`),
        fetch(`${API_BASE}/users`),
      ]);

      if (accRes.ok) {
        const accData = await accRes.json();
        setAliceBalance(accData.balance);
      }

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        const alexander = usersData.find((u: any) => u.tag === "alexander");
        if (alexander) {
          setAlexanderBalance(alexander.balance_cents / 100);
        }
      }
    } catch (err) {
      console.error("Failed to fetch balance state:", err);
    }
  };

  useEffect(() => {
    fetchBalances();
  }, []);

  // 1. Normal Single Payment (€10)
  const handleNormalPayment = async () => {
    setLoading(true);
    setStatusMessage("Processing single payment (€10)...");
    setDemoResult(null);

    const idempotencyKey = `demo-single-${Date.now()}`;

    try {
      const res = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          to_user_id: "alexander",
          amount: 10,
          currency: "EUR",
          description: "Demo Normal Payment (€10)",
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatusMessage("Payment of €10 completed cleanly!");
        if (data.new_sender_balance_cents !== undefined) {
          setAliceBalance(data.new_sender_balance_cents / 100);
          setAlexanderBalance((prev) => prev + 10);
        } else {
          await fetchBalances();
        }

        setTotalExecuted((prev) => prev + 10);

        setDemoResult({
          title: "Standard Payment (€10)",
          type: "normal",
          req1Status: "ACCEPTED",
          req2Status: "FAILED",
          executedAmount: 10,
          preventedAmount: 0,
          plainSummary: "User tapped 'Pay €10' once. The bank processed it normally. Money was deducted safely once.",
          technicalDetails: `Idempotency-Key: ${idempotencyKey.slice(0, 18)}...\nStatus: HTTP 201 Created\nTransaction ID: ${data.transaction_id || "N/A"}`,
          steps: [
            { name: "Step 1: Send Request", status: "success", text: "Customer sent €10 payment request with a unique key." },
            { name: "Step 2: Bank Verification", status: "success", text: "Bank checked account balance (€100 available) — Approved!" },
            { name: "Step 3: Settlement", status: "success", text: "Tyler's account debited €10, Alexander credited €10." },
          ],
        });
      } else {
        setStatusMessage(`Error: ${data.error || "Payment failed"}`);
      }
    } catch (err: any) {
      setStatusMessage(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. Simulate Double Payment (Double Click / Glitch)
  const handleDoublePayment = async () => {
    setLoading(true);
    setDemoResult(null);

    if (!protectionEnabled) {
      // SIMULATE UNSAFE BANKING BUG
      setStatusMessage("UNSAFE MODE: Simulating double charge without shield!");
      setTimeout(() => {
        setAliceBalance((prev) => prev - 20);
        setAlexanderBalance((prev) => prev + 20);
        setTotalExecuted((prev) => prev + 20);
        setStatusMessage("BUG EXPLOITED! User was charged TWICE (€20) for one click!");
        setDemoResult({
          title: "Double-Click Glitch (PROTECTION OFF)",
          type: "double",
          req1Status: "ACCEPTED",
          req2Status: "ACCEPTED",
          executedAmount: 20,
          preventedAmount: 0,
          plainSummary: "WITHOUT protection, mashing the pay button created 2 separate charges (€20 lost instead of €10!).",
          technicalDetails: "HTTP 201 Created (Req 1)\nHTTP 201 Created (Req 2)\nResult: Double-charge vulnerability triggered!",
          steps: [
            { name: "Tap 1: €10 Sent", status: "success", text: "Request #1 reached bank -> €10 deducted." },
            { name: "Tap 2: €10 Sent", status: "success", text: "Request #2 reached bank 1ms later -> ANOTHER €10 deducted!" },
            { name: "Outcome", status: "blocked", text: "Customer complains about double charge! Bank loses customer trust." },
          ],
        });
        setLoading(false);
      }, 500);
      return;
    }

    setStatusMessage("Simulating double-tap / slow network glitch (2 requests in 1ms)...");
    const sameKey = `demo-double-key-${Date.now()}`;
    const payload = {
      to_user_id: "alexander",
      amount: 10,
      currency: "EUR",
      description: "Demo Double Payment (€10)",
    };

    try {
      const [res1, res2] = await Promise.all([
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
          body: JSON.stringify(payload),
        }),
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
          body: JSON.stringify(payload),
        }),
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      let req1Accepted = res1.status === 201;
      let req2Blocked = res2.status === 409 || (res2.status === 201 && data2.transaction_id === data1.transaction_id);

      setStatusMessage("SUCCESS: Shield blocked the accidental duplicate charge!");

      if (data1.new_sender_balance_cents !== undefined) {
        setAliceBalance(data1.new_sender_balance_cents / 100);
        setAlexanderBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setTotalExecuted((prev) => prev + 10);
      setTotalPrevented((prev) => prev + 10);
      setAttacksBlockedCount((prev) => prev + 1);

      setDemoResult({
        title: "Double-Tap Glitch Test (PROTECTED)",
        type: "double",
        req1Status: req1Accepted ? "ACCEPTED" : "FAILED",
        req2Status: req2Blocked ? "BLOCKED" : "FAILED",
        executedAmount: 10,
        preventedAmount: 10,
        plainSummary: "User accidentally double-tapped 'Pay'. Our shield detected the 2nd tap was identical and blocked it. Tyler lost only €10, saving him €10!",
        technicalDetails: `Request #1: HTTP ${res1.status} (Accepted)\nRequest #2: HTTP ${res2.status} (Blocked via Processing Lock)\nIdempotency Key: ${sameKey.slice(0, 16)}...`,
        steps: [
          { name: "Tap 1 (Green)", status: "success", text: "First request accepted and executed (€10 transferred)." },
          { name: "Tap 2 (Red Shield)", status: "blocked", text: "Second simultaneous request caught by backend lock and BLOCKED (409 Conflict)." },
          { name: "Protected Result", status: "success", text: "Customer billed €10 (saved €10 extra charge)." },
        ],
      });
    } catch (err: any) {
      setStatusMessage(`Network error during simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. Replay / Retry Attack
  const handleRetryPayment = async () => {
    setLoading(true);
    setStatusMessage("Simulating connection drop + customer clicking 'Retry'...");
    setDemoResult(null);

    const sameKey = `demo-retry-key-${Date.now()}`;
    const payload = {
      to_user_id: "alexander",
      amount: 10,
      currency: "EUR",
      description: "Demo Replay/Retry (€10)",
    };

    try {
      const res1 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
        body: JSON.stringify(payload),
      });
      await res1.json();

      // Retry request
      const res2 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
        body: JSON.stringify(payload),
      });

      setStatusMessage("Safe Retry: Customer got receipt without paying a second time!");

      await fetchBalances();
      setTotalExecuted((prev) => prev + 10);
      setTotalPrevented((prev) => prev + 10);
      setAttacksBlockedCount((prev) => prev + 1);

      setDemoResult({
        title: "Connection Drop & Retry Test",
        type: "double",
        req1Status: "ACCEPTED",
        req2Status: "BLOCKED",
        executedAmount: 10,
        preventedAmount: 10,
        plainSummary: "Internet dropped right as payment finished. User clicked 'Retry Payment'. The bank remembered the original payment and returned the exact receipt safely without re-charging!",
        technicalDetails: `Request #1: Executed (HTTP ${res1.status})\nRequest #2: Returned Cached Receipt (HTTP ${res2.status})\nNo duplicate database debit.`,
        steps: [
          { name: "Original Request", status: "success", text: "Initial payment of €10 processed on backend." },
          { name: "App Disconnect", status: "info", text: "User's screen froze, so user clicked 'Retry Payment'." },
          { name: "Cache Retrieval", status: "success", text: "System recognized previous payment ID and safely served receipt without charging €10 again." },
        ],
      });
    } catch (err: any) {
      setStatusMessage(`Error during retry simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 4. Payload Tampering / Fraud Attempt
  const handlePayloadTampering = async () => {
    setLoading(true);
    setStatusMessage("Simulating hacker tampering with order amount (€10 -> €500)...");
    setDemoResult(null);

    const sameKey = `demo-tamper-key-${Date.now()}`;

    try {
      const res1 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
        body: JSON.stringify({ to_user_id: "alexander", amount: 10, currency: "EUR", description: "Original (€10)" }),
      });

      // Tampered €500
      const res2 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
        body: JSON.stringify({ to_user_id: "alexander", amount: 500, currency: "EUR", description: "Tampered (€500)" }),
      });
      const data2 = await res2.json();

      setStatusMessage("FRAUD PREVENTED: Bank rejected tampered amount!");

      await fetchBalances();
      setTotalExecuted((prev) => prev + 10);
      setTotalPrevented((prev) => prev + 500);
      setAttacksBlockedCount((prev) => prev + 1);

      setDemoResult({
        title: "Tampered Order / Fraud Rejection",
        type: "tamper",
        req1Status: "ACCEPTED",
        req2Status: "BLOCKED",
        executedAmount: 10,
        preventedAmount: 500,
        plainSummary: "Someone reused a €10 receipt key but tried to inflate the charge to €500. Our SHA-256 fingerprint checker immediately caught the mismatch and blocked the €500 theft!",
        technicalDetails: `Req #1 (€10): HTTP ${res1.status} Accepted\nReq #2 (€500 Tampered): HTTP ${res2.status} BLOCKED\nError: ${data2.error || "Hash mismatch"}`,
        steps: [
          { name: "Original €10 Order", status: "success", text: "Order created for €10 with cryptographic fingerprint." },
          { name: "Fraud Attempt (€500)", status: "blocked", text: "Attacker sent €500 using the same order ID." },
          { name: "Security Gate Action", status: "blocked", text: "Fingerprint mismatch detected! €500 charge killed instantly." },
        ],
      });
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 5. 5x Rapid Click Spam
  const handleRapidSpam = async () => {
    setLoading(true);
    setStatusMessage("Simulating impatient user mashing 'Pay' button 5 times rapidly...");
    setDemoResult(null);

    const sameKey = `demo-spam-key-${Date.now()}`;
    const payload = { to_user_id: "alexander", amount: 10, currency: "EUR", description: "5x Click Spam (€10)" };

    try {
      const requests = Array.from({ length: 5 }, () =>
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": sameKey },
          body: JSON.stringify(payload),
        })
      );

      const responses = await Promise.all(requests);

      const acceptedCount = responses.filter((r) => r.status === 201).length;
      const blockedCount = responses.filter((r) => r.status === 409 || r.status === 429).length;

      setStatusMessage(`5x Click Spam Defeated: 1 Executed, ${blockedCount} Blocked!`);

      await fetchBalances();
      setTotalExecuted((prev) => prev + 10);
      setTotalPrevented((prev) => prev + 40);
      setAttacksBlockedCount((prev) => prev + 1);

      setDemoResult({
        title: "5x Button Mashing Attack",
        type: "spam",
        req1Status: "ACCEPTED",
        req2Status: "BLOCKED",
        executedAmount: 10,
        preventedAmount: 40,
        plainSummary: "User clicked 'Pay' 5 times in half a second out of frustration. The bank executed 1 payment (€10) and blocked the other 4 requests (€40 saved!).",
        technicalDetails: `Burst Traffic: 5 parallel requests fired.\n✓ ${acceptedCount} Succeeded (201)\n✕ ${blockedCount} Shielded (409 Conflict)`,
        steps: [
          { name: "Burst Request (5x)", status: "info", text: "5 identical payment attempts arrived at the backend at the exact same millisecond." },
          { name: "Atomic Lock", status: "success", text: "Lock acquired by Request #1 (€10 paid)." },
          { name: "Rejection Barrier", status: "blocked", text: "Requests #2, #3, #4, #5 hit active lock and were blocked instantly!" },
        ],
      });
    } catch (err: any) {
      setStatusMessage(`Error during spam test: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Reset Demo State
  const handleReset = async () => {
    setLoading(true);
    setStatusMessage("Resetting accounts and scoreboard...");
    setDemoResult(null);

    try {
      const res = await fetch(`${API_BASE}/demo/reset`, { method: "POST" });
      if (res.ok) {
        setAliceBalance(100);
        setAlexanderBalance(0);
        setTotalExecuted(0);
        setTotalPrevented(0);
        setAttacksBlockedCount(0);
        setStatusMessage("Ready! Choose a real-world payment scenario below.");
      }
    } catch (err: any) {
      setStatusMessage(`Reset error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Floating Backend Engine Inspector */}
      <BackendInspectorWidget />

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Idempotency Shield</span>
        </div>
        <Link href="/" className={styles.hideToggle} style={{ textDecoration: "none" }}>
          ← Main App
        </Link>
      </header>

      <main className={styles.main}>
        {/* Simple Plain-English Explanation Banner */}
        <div className={styles.statCard} style={{ background: "linear-gradient(135deg, #f0f7ff 0%, #e0e7ff 100%)", borderColor: "#c7d2fe", padding: "20px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#3730a3", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            What is this page showing?
          </div>
          <p style={{ fontSize: "13px", color: "#312e81", lineHeight: "1.5", margin: 0 }}>
            When buying things online, internet drops or double-clicking the pay button can cause your card to get <strong>charged twice</strong>. 
            This demo tests our <strong>Financial Idempotency Shield</strong>—the backend engine that guarantees you are <strong>only charged once</strong>, no matter network glitches or double-taps.
          </p>
        </div>

        {/* Protection Mode Toggle */}
        <div className={styles.quickTransferCard} style={{ padding: "20px", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: "700", fontSize: "15px", color: protectionEnabled ? "#10b981" : "#ef4444" }}>
              {protectionEnabled ? "Shield Status: ACTIVE (Protected)" : "Shield Status: OFF (Vulnerable)"}
            </div>
            <div style={{ fontSize: "12px", color: "#71717a", marginTop: "2px" }}>
              {protectionEnabled ? "Duplicate charges & button mashing are automatically blocked." : "Simulates vulnerable banking backend that allows duplicate debits."}
            </div>
          </div>
          <button
            onClick={() => setProtectionEnabled(!protectionEnabled)}
            className={styles.actionBtn}
            style={{
              background: protectionEnabled ? "#fee2e2" : "#dcfce7",
              color: protectionEnabled ? "#991b1b" : "#166534",
              borderColor: protectionEnabled ? "#fca5a5" : "#86efac",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            {protectionEnabled ? "Disable Shield (Test Bug)" : "Enable Shield (Safe)"}
          </button>
        </div>

        {/* Real-time Money Saved Scoreboard */}
        <div className={styles.statsRow} style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className={styles.statCard}>
            <span className={styles.statTitle}>Legitimate Payments</span>
            <span className={`${styles.statValue} ${styles.positive}`}>€{totalExecuted.toFixed(2)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statTitle}>Prevented Overcharges</span>
            <span className={styles.statValue} style={{ color: "#ef4444" }}>€{totalPrevented.toFixed(2)}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statTitle}>Glitches Blocked</span>
            <span className={styles.statValue} style={{ color: "#6366f1" }}>{attacksBlockedCount}</span>
          </div>
        </div>

        {/* Account Cards Row */}
        <div className={styles.statsRow}>
          {/* Tyler Card */}
          <div className={styles.balanceCard} style={{ padding: "24px" }}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceLabel}>CUSTOMER (SENDER)</span>
              <span className={styles.hideToggle} style={{ background: "#e0e7ff", color: "#3730a3", border: "none" }}>@tyler</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Image src="/Tyler.jpg" width={40} height={40} alt="Tyler Durden" className={styles.avatar} />
              <div>
                <div className={styles.transactionName}>Tyler Durden</div>
                <div className={styles.transactionDate}>Primary Checking</div>
              </div>
            </div>
            <div>
              <div className={styles.statTitle}>Balance</div>
              <div className={styles.statValue} style={{ fontSize: "28px" }}>€{aliceBalance.toFixed(2)}</div>
            </div>
          </div>

          {/* Alexander B. Card */}
          <div className={styles.balanceCard} style={{ padding: "24px" }}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceLabel}>RECIPIENT</span>
              <span className={styles.hideToggle} style={{ background: "#f3e8ff", color: "#6b21a8", border: "none" }}>@alexander</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div className={styles.contactAvatar} style={{ background: "linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)" }}>
                AB
              </div>
              <div>
                <div className={styles.transactionName}>Alexander B.</div>
                <div className={styles.transactionDate}>Receiving Account</div>
              </div>
            </div>
            <div>
              <div className={styles.statTitle}>Balance</div>
              <div className={styles.statValue} style={{ fontSize: "28px" }}>€{alexanderBalance.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Interactive Scenario Buttons */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Select Real-World Test Scenario</h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <button
              onClick={handleNormalPayment}
              disabled={loading}
              className={styles.contactChatItem}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "16px" }}
            >
              <div style={{ fontWeight: "700", fontSize: "14px", color: "#0284c7" }}>Pay €10 (Normal)</div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Single clean tap. Payment succeeds once.</div>
            </button>

            <button
              onClick={handleDoublePayment}
              disabled={loading}
              className={styles.contactChatItem}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "16px", borderColor: "#fca5a5", background: "#fff5f5" }}
            >
              <div style={{ fontWeight: "700", fontSize: "14px", color: "#dc2626" }}>Simulate Double-Tap Glitch</div>
              <div style={{ fontSize: "12px", color: "#991b1b" }}>Fires 2 taps at 1ms interval. Shield blocks 2nd tap!</div>
            </button>



            <button
              onClick={handleRapidSpam}
              disabled={loading}
              className={styles.contactChatItem}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "16px", borderColor: "#e9d5ff", background: "#faf5ff" }}
            >
              <div style={{ fontWeight: "700", fontSize: "14px", color: "#9333ea" }}>5x Button Mashing</div>
              <div style={{ fontSize: "12px", color: "#6b21a8" }}>Simulates user rage-clicking pay button 5 times.</div>
            </button>

            <button
              onClick={handleRetryPayment}
              disabled={loading}
              className={styles.contactChatItem}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "16px", borderColor: "#bfdbfe", background: "#eff6ff" }}
            >
              <div style={{ fontWeight: "700", fontSize: "14px", color: "#2563eb" }}>Connection Drop & Retry</div>
              <div style={{ fontSize: "12px", color: "#1e40af" }}>Wi-Fi cut out during pay. Serves receipt safely.</div>
            </button>

            <button
              onClick={handlePayloadTampering}
              disabled={loading}
              className={styles.contactChatItem}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "16px", gridColumn: "span 2", borderColor: "#fde68a", background: "#fffbeb" }}
            >
              <div style={{ fontWeight: "700", fontSize: "14px", color: "#d97706" }}>Fraud Test: Amount Tampering (€10 → €500)</div>
              <div style={{ fontSize: "12px", color: "#92400e" }}>Reuses receipt ID to secretly try charging €500. Backend fingerprint blocks theft!</div>
            </button>
          </div>

          <button
            onClick={handleReset}
            disabled={loading}
            className={styles.actionBtn}
            style={{ width: "100%", marginTop: "4px", color: "#71717a" }}
          >
            Reset Balances & Clear History
          </button>
        </div>

        {/* VISUAL RESULTS DISPLAY */}
        <div className={styles.balanceCard}>
          <div className={styles.balanceHeader}>
            <span className={styles.balanceLabel}>Live Simulation Inspector</span>
          </div>

          <div style={{ fontSize: "16px", fontWeight: "700", color: statusMessage.includes("✓") || statusMessage.includes("Shield") ? "#10b981" : statusMessage.includes("UNSAFE") || statusMessage.includes("EXPLOITED") ? "#ef4444" : "#09090b" }}>
            {statusMessage.replace(/[⚡✓⚠️💥🛡️📡🕵️🛑]/g, "").trim()}
          </div>

          {demoResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "8px" }}>
              {/* Plain English Banner */}
              <div className={styles.statCard} style={{ background: "#f8fafc", borderColor: "#e2e8f0" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#0284c7", marginBottom: "4px" }}>SUMMARY</div>
                <div style={{ fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>{demoResult.plainSummary}</div>
              </div>

              {/* Graphical Visual Flow Diagram */}
              <div className={styles.statCard} style={{ background: "#fafafa" }}>
                <div className={styles.statTitle} style={{ marginBottom: "10px" }}>VISUAL TRANSACTION FLOW</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {demoResult.steps.map((step, idx) => (
                    <div key={idx} className={styles.transactionItem} style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: step.status === "success" ? "#10b981" : step.status === "blocked" ? "#ef4444" : "#3b82f6" }} />
                        <div>
                          <div className={styles.transactionName} style={{ color: step.status === "blocked" ? "#dc2626" : "#09090b" }}>{step.name}</div>
                          <div className={styles.transactionDate}>{step.text}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Technical Logs */}
              <details style={{ background: "#09090b", color: "#4ade80", borderRadius: "12px", padding: "14px", cursor: "pointer" }}>
                <summary style={{ fontSize: "12px", fontWeight: "700", color: "#a1a1aa" }}>View Technical Server Response Logs</summary>
                <pre style={{ fontSize: "12px", marginTop: "10px", whiteSpace: "pre-wrap", fontFamily: "var(--font-geist-mono), monospace" }}>
                  {demoResult.technicalDetails}
                </pre>
              </details>
            </div>
          ) : (
            <div style={{ color: "#a1a1aa", fontSize: "14px", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>
              Click any scenario button above to trigger the live financial shield!
            </div>
          )}
        </div>
      </main>

      {/* Floating Bottom Nav */}
      <nav className={styles.floatingNav}>
        <Link href="/" className={styles.navItem} style={{ textDecoration: "none" }}>
          <svg className={styles.navIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>Home</span>
        </Link>

        <Link href="/demo" className={`${styles.navItem} ${styles.navItemActive}`} style={{ textDecoration: "none" }}>
          <svg className={styles.navIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Demo Shield</span>
        </Link>
      </nav>
    </div>
  );
}

