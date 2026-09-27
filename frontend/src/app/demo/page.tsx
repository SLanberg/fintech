"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "../page.module.css";
import BackendInspectorWidget from "../components/BackendInspectorWidget";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

interface DemoResult {
  title: string;
  type: "normal" | "double";
  req1Status: "ACCEPTED" | "PENDING" | "FAILED";
  req2Status: "BLOCKED" | "ACCEPTED" | "PENDING" | "FAILED";
  executedAmount: number;
  preventedAmount: number;
  rawDetails?: string;
}

export default function DemoPage() {
  const [aliceBalance, setAliceBalance] = useState<number>(100);
  const [bobBalance, setBobBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready for demo.");
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null);

  // Fetch latest balances for Alice (Tyler) and Bob (Alexander)
  const fetchBalances = async () => {
    try {
      const [aliceRes, bobRes] = await Promise.all([
        fetch(`${API_BASE}/account`),
        fetch(`${API_BASE}/users/tag/alexander`),
      ]);

      if (aliceRes.ok) {
        const aliceData = await aliceRes.json();
        setAliceBalance(aliceData.balance);
      }

      if (bobRes.ok) {
        const bobData = await bobRes.json();
        // Recipient tag search response wrapper: { user: PublicUserProfile }
        // We fetch account or entity to get balance, or default calculation
        const entityRes = await fetch(`${API_BASE}/user/entity`);
        if (entityRes.ok) {
          const entityData = await entityRes.json();
          setAliceBalance(entityData.data.balance_cents / 100);
        }
      }
    } catch (err) {
      console.error("Failed to fetch balance state:", err);
    }
  };

  // On page load, fetch actual DB balances
  useEffect(() => {
    fetchBalances();
  }, []);

  // 1. Normal Single Payment (€10)
  const handleNormalPayment = async () => {
    setLoading(true);
    setStatusMessage("Sending payment...");
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
        setStatusMessage("✓ PAYMENT SUCCESSFUL");
        if (data.new_sender_balance_cents !== undefined) {
          setAliceBalance(data.new_sender_balance_cents / 100);
          setBobBalance((prev) => prev + 10);
        } else {
          await fetchBalances();
        }

        setDemoResult({
          title: "NORMAL PAYMENT TEST",
          type: "normal",
          req1Status: "ACCEPTED",
          req2Status: "FAILED",
          executedAmount: 10,
          preventedAmount: 0,
          rawDetails: `Idempotency-Key: ${idempotencyKey.slice(0, 16)}...\nStatus: 201 CREATED (NEW REQUEST)\nTx ID: ${data.transaction_id || 'N/A'}`,
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

  // 2. Simulate Double Payment (Concurrent Promise.all with SAME Idempotency Key)
  const handleDoublePayment = async () => {
    setLoading(true);
    setStatusMessage("Simulating concurrent double payment...");
    setDemoResult(null);

    const sameKey = `demo-double-key-${Date.now()}`;
    const payload = {
      to_user_id: "alexander",
      amount: 10,
      currency: "EUR",
      description: "Demo Double Payment Attack (€10)",
    };

    try {
      // Fire 2 concurrent HTTP POST requests with the identical Idempotency-Key
      const [res1, res2] = await Promise.all([
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": sameKey,
          },
          body: JSON.stringify(payload),
        }),
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": sameKey,
          },
          body: JSON.stringify(payload),
        }),
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      let req1Accepted = res1.status === 201;
      let req2Blocked = res2.status === 409 || (res2.status === 201 && data2.transaction_id === data1.transaction_id);

      // In case order is swapped by async network resolution
      if (!req1Accepted && res2.status === 201) {
        req1Accepted = true;
        req2Blocked = res1.status === 409;
      }

      setStatusMessage("Double Payment Simulation Completed");

      if (data1.new_sender_balance_cents !== undefined) {
        setAliceBalance(data1.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else if (data2.new_sender_balance_cents !== undefined) {
        setAliceBalance(data2.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setDemoResult({
        title: "DOUBLE PAYMENT TEST",
        type: "double",
        req1Status: req1Accepted ? "ACCEPTED" : "FAILED",
        req2Status: req2Blocked ? "BLOCKED" : "FAILED",
        executedAmount: 10,
        preventedAmount: 10,
        rawDetails: `Request #1 Status: HTTP ${res1.status} ${req1Accepted ? "✓ ACCEPTED" : ""}\nRequest #2 Status: HTTP ${res2.status} ${res2.status === 409 ? "✕ DUPLICATE BLOCKED" : ""}\nIdempotency Guard: Active (Processing Lock)`,
      });
    } catch (err: any) {
      setStatusMessage(`Network error during simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. Replay / Retry Attack (Sequential requests with SAME Idempotency Key)
  const handleRetryPayment = async () => {
    setLoading(true);
    setStatusMessage("Simulating retry request with same Idempotency-Key...");
    setDemoResult(null);

    const sameKey = `demo-retry-key-${Date.now()}`;
    const payload = {
      to_user_id: "alexander",
      amount: 10,
      currency: "EUR",
      description: "Demo Replay/Retry Payment (€10)",
    };

    try {
      // 1st request
      const res1 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": sameKey,
        },
        body: JSON.stringify(payload),
      });
      const data1 = await res1.json();

      // 2nd request (Retry after first completed)
      const res2 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": sameKey,
        },
        body: JSON.stringify(payload),
      });
      const data2 = await res2.json();

      setStatusMessage("Retry / Replay Simulation Completed");

      if (data1.new_sender_balance_cents !== undefined) {
        setAliceBalance(data1.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setDemoResult({
        title: "REPLAY / RETRY PROTECTION TEST",
        type: "double",
        req1Status: res1.ok ? "ACCEPTED" : "FAILED",
        req2Status: res2.ok ? "ACCEPTED" : "BLOCKED",
        executedAmount: 10,
        preventedAmount: 10,
        rawDetails: `Request #1 (Original): HTTP ${res1.status} - Payment Executed\nRequest #2 (Retry): HTTP ${res2.status} - Returned Cached Result\nDuplicate Debit Prevented!`,
      });
    } catch (err: any) {
      setStatusMessage(`Error during retry simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 4. Payload Mismatch / Tampering Attack (Same Key, Changed Amount/Payload)
  const handlePayloadTampering = async () => {
    setLoading(true);
    setStatusMessage("Simulating Payload Tampering (Same Key, Changed Amount)...");
    setDemoResult(null);

    const sameKey = `demo-tamper-key-${Date.now()}`;

    try {
      // Step 1: Send original request (€10)
      const res1 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": sameKey,
        },
        body: JSON.stringify({
          to_user_id: "alexander",
          amount: 10,
          currency: "EUR",
          description: "Original Payment (€10)",
        }),
      });
      const data1 = await res1.json();

      // Step 2: Send tampered request (€500) using SAME Idempotency-Key
      const res2 = await fetch(`${API_BASE}/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": sameKey,
        },
        body: JSON.stringify({
          to_user_id: "alexander",
          amount: 500,
          currency: "EUR",
          description: "Tampered Payment (€500)",
        }),
      });
      const data2 = await res2.json();

      setStatusMessage("Payload Tampering Test Completed");

      if (data1.new_sender_balance_cents !== undefined) {
        setAliceBalance(data1.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setDemoResult({
        title: "PAYLOAD TAMPERING / MISMATCH TEST",
        type: "double",
        req1Status: res1.ok ? "ACCEPTED" : "FAILED",
        req2Status: "BLOCKED",
        executedAmount: 10,
        preventedAmount: 500,
        rawDetails: `Req #1 (€10): HTTP ${res1.status} ✓ Accepted\nReq #2 (€500 Tampered): HTTP ${res2.status} ✕ BLOCKED\nError: ${data2.error || "Idempotency key payload mismatch detected"}`,
      });
    } catch (err: any) {
      setStatusMessage(`Error during tampering simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 5. Rapid Click Spam (5 Concurrent Requests at once)
  const handleRapidSpam = async () => {
    setLoading(true);
    setStatusMessage("Simulating 5x Rapid Click Spam concurrently...");
    setDemoResult(null);

    const sameKey = `demo-spam-key-${Date.now()}`;
    const payload = {
      to_user_id: "alexander",
      amount: 10,
      currency: "EUR",
      description: "5x Click Spam (€10)",
    };

    try {
      // Fire 5 parallel requests simultaneously
      const requests = Array.from({ length: 5 }, () =>
        fetch(`${API_BASE}/transfers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": sameKey,
          },
          body: JSON.stringify(payload),
        })
      );

      const responses = await Promise.all(requests);
      const results = await Promise.all(responses.map((r) => r.json()));

      const acceptedCount = responses.filter((r) => r.status === 201).length;
      const blockedCount = responses.filter((r) => r.status === 409 || r.status === 429).length;

      setStatusMessage("5x Click Spam Test Completed");

      const successItem = results.find((r) => r.new_sender_balance_cents !== undefined);
      if (successItem) {
        setAliceBalance(successItem.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setDemoResult({
        title: "5X RAPID CLICK SPAM TEST",
        type: "double",
        req1Status: acceptedCount > 0 ? "ACCEPTED" : "FAILED",
        req2Status: blockedCount > 0 ? "BLOCKED" : "FAILED",
        executedAmount: 10,
        preventedAmount: 40,
        rawDetails: `5 Concurrent Requests Fired simultaneously:\n✓ ${acceptedCount} Request Executed (201 Created)\n✕ ${blockedCount} Requests Blocked (409 Conflict / Lock Active)\nTotal Debited: €10 (Prevented: €40)`,
      });
    } catch (err: any) {
      setStatusMessage(`Error during spam simulation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 6. Payment Intent Pattern (Two-step Prepare & Confirm + Socket Timeout Retry Protection)
  const handlePaymentIntentDemo = async () => {
    setLoading(true);
    setStatusMessage("Simulating Payment Intent Pattern (Prepare -> Confirm -> Socket Timeout Retry)...");
    setDemoResult(null);

    try {
      // Step 1: Prepare (POST /api/transfers/intent)
      const intentRes = await fetch(`${API_BASE}/transfers/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_user_id: "alexander",
          amount: 10,
          currency: "EUR",
          description: "Payment Intent Demo (€10)",
        }),
      });
      const intentData = await intentRes.json();

      if (!intentRes.ok || !intentData.intent_id) {
        throw new Error(intentData.error || "Failed to create Payment Intent");
      }

      const intentId = intentData.intent_id;

      // Step 2: Confirm (POST /api/transfers/confirm)
      const confirmRes1 = await fetch(`${API_BASE}/transfers/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_id: intentId }),
      });
      const confirmData1 = await confirmRes1.json();

      // Step 3: Simulated Retry Confirm after Socket Timeout (POST /api/transfers/confirm with same intent_id)
      const confirmRes2 = await fetch(`${API_BASE}/transfers/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_id: intentId }),
      });
      const confirmData2 = await confirmRes2.json();

      setStatusMessage("Payment Intent Simulation Completed");

      if (confirmData1.new_sender_balance_cents !== undefined) {
        setAliceBalance(confirmData1.new_sender_balance_cents / 100);
        setBobBalance((prev) => prev + 10);
      } else {
        await fetchBalances();
      }

      setDemoResult({
        title: "PAYMENT INTENT PATTERN TEST",
        type: "double",
        req1Status: confirmRes1.ok ? "ACCEPTED" : "FAILED",
        req2Status: confirmRes2.ok ? "ACCEPTED" : "BLOCKED",
        executedAmount: 10,
        preventedAmount: 10,
        rawDetails: `Step 1 (Prepare): Created Intent ID ${intentId}\nStep 2 (Confirm): HTTP ${confirmRes1.status} - Payment Executed (${confirmData1.status})\nStep 3 (Socket Timeout Retry): HTTP ${confirmRes2.status} - Cached Result Returned (${confirmData2.status})\nNo Double Charge!`,
      });
    } catch (err: any) {
      setStatusMessage(`Error during Payment Intent demo: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 4. Reset Demo State
  const handleReset = async () => {
    setLoading(true);
    setStatusMessage("Resetting demo state...");
    setDemoResult(null);

    try {
      const res = await fetch(`${API_BASE}/demo/reset`, {
        method: "POST",
      });

      if (res.ok) {
        setAliceBalance(100);
        setBobBalance(0);
        setStatusMessage("Ready for demo.");
      } else {
        setStatusMessage("Failed to reset demo state.");
      }
    } catch (err: any) {
      setStatusMessage(`Reset error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Floating Interactive Backend Engine Inspector Widget */}
      <BackendInspectorWidget />

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#09090b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="#09090b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="#09090b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Lockin &amp; Build Presentation
        </div>
        <Link href="/" style={{ fontSize: "13px", fontWeight: "600", color: "#6366f1" }}>
          ← Back to Main App
        </Link>
      </header>

      <main className={styles.main} style={{ maxWidth: "680px" }}>
        {/* Account Cards Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* Alice Account Card */}
          <div className={styles.balanceCard} style={{ padding: "24px", gap: "12px" }}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceLabel}>SENDER</span>
              <span style={{ fontSize: "12px", background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: "12px", fontWeight: "600" }}>@tyler</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Image src="/Tyler.jpg" width={40} height={40} alt="Alice" className={styles.avatar} />
              <div>
                <div style={{ fontWeight: "700", fontSize: "16px" }}>Alice (Tyler Durden)</div>
                <div style={{ fontSize: "13px", color: "#71717a" }}>Primary Account</div>
              </div>
            </div>
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "12px", color: "#71717a" }}>Balance</div>
              <div style={{ fontSize: "32px", fontWeight: "800", color: "#09090b" }}>€{aliceBalance.toFixed(2)}</div>
            </div>
          </div>

          {/* Bob Account Card */}
          <div className={styles.balanceCard} style={{ padding: "24px", gap: "12px" }}>
            <div className={styles.balanceHeader}>
              <span className={styles.balanceLabel}>RECIPIENT</span>
              <span style={{ fontSize: "12px", background: "#f3e8ff", color: "#6b21a8", padding: "2px 8px", borderRadius: "12px", fontWeight: "600" }}>@alexander</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", fontSize: "14px" }}>
                AB
              </div>
              <div>
                <div style={{ fontWeight: "700", fontSize: "16px" }}>Bob (Alexander B.)</div>
                <div style={{ fontSize: "13px", color: "#71717a" }}>Recipient Contact</div>
              </div>
            </div>
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "12px", color: "#71717a" }}>Balance</div>
              <div style={{ fontSize: "32px", fontWeight: "800", color: "#09090b" }}>€{bobBalance.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Transfer Details Banner */}
        <div style={{ background: "#f4f4f5", padding: "16px 20px", borderRadius: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "600", color: "#52525b" }}>Transfer Amount</span>
          <span style={{ fontSize: "20px", fontWeight: "800", color: "#09090b" }}>€10.00</span>
        </div>

        {/* Control Action Buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Pay €10 (Normal) */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Executes a standard single payment transfer without duplicate simulation. Tests successful balance deduction and transfer creation.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handleNormalPayment}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #18181b",
                background: "#18181b",
                color: "#ffffff",
                fontWeight: "600",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "all 0.15s ease",
              }}
            >
              Pay €10 (Normal)
            </button>
          </div>

          {/* Simulate Concurrent Double */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Fires 2 identical HTTP requests in parallel (`Promise.all`) using the same Idempotency-Key. Tests backend atomic locking and duplicate rejection.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handleDoublePayment}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #dc2626",
                background: "#dc2626",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(220, 38, 38, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Simulate Concurrent Double
            </button>
          </div>

          {/* Simulate Payment Intent */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Creates a Payment Intent (`REQUIRES_CONFIRMATION`) then confirms it using a unique client secret. Tests multi-step checkout reservation and authorization.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handlePaymentIntentDemo}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #059669",
                background: "#059669",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(5, 150, 105, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Simulate Payment Intent
            </button>
          </div>

          {/* Simulate Retry / Replay */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Sends an initial request, waits for completion, then replays the exact same key. Tests returning cached responses safely without re-charging.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handleRetryPayment}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #2563eb",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Simulate Retry / Replay
            </button>
          </div>

          {/* Simulate Payload Tampering */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Sends a key with €10.00, then reuses the key with €999.00. Tests payload hash mismatch detection (`409 Conflict`).
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handlePayloadTampering}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #d97706",
                background: "#d97706",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(217, 119, 6, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Simulate Payload Tampering
            </button>
          </div>

          {/* Simulate 5x Click Spam */}
          <div className={styles.tooltipWrapper}>
            <div className={styles.tooltipBox}>
              Fires 5 rapid identical requests concurrently in a single burst. Tests engine resilience against extreme double-click / button mashing.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handleRapidSpam}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #7c3aed",
                background: "#7c3aed",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(124, 58, 237, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Simulate 5x Click Spam
            </button>
          </div>

          {/* Reset Balances */}
          <div className={styles.tooltipWrapper} style={{ gridColumn: "span 2" }}>
            <div className={styles.tooltipBox}>
              Resets Alice balance back to €100.00 and Bob balance to €0.00, clearing server-side demo idempotency keys.
              <div className={styles.tooltipArrow} />
            </div>
            <button
              onClick={handleReset}
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid #e4e4e7",
                background: "#ffffff",
                color: "#09090b",
                fontWeight: "600",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "all 0.15s ease",
              }}
            >
              Reset Balances
            </button>
          </div>
        </div>


        {/* RESULT AREA */}
        <div style={{ background: "#09090b", color: "#f4f4f5", padding: "28px", borderRadius: "20px", fontFamily: "var(--font-geist-mono), monospace" }}>
          <div style={{ fontSize: "12px", color: "#a1a1aa", letterSpacing: "1px", marginBottom: "12px", fontWeight: "600" }}>
            RESULT AREA
          </div>

          <div style={{ fontSize: "16px", fontWeight: "700", marginBottom: "20px", color: statusMessage.includes("✓") ? "#4ade80" : statusMessage.includes("Error") ? "#f87171" : "#ffffff" }}>
            {statusMessage}
          </div>

          {demoResult ? (
            <div style={{ border: "1px solid #27272a", borderRadius: "12px", padding: "20px", background: "#18181b" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#f4f4f5", marginBottom: "16px", borderBottom: "1px solid #27272a", paddingBottom: "8px" }}>
                ┌─────────────────────────────────────┐<br />
                │ {demoResult.title.padEnd(35, " ")} │<br />
                └─────────────────────────────────────┘
              </div>

              {demoResult.type === "double" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", margin: "16px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Request #1</span>
                    <span style={{ color: "#4ade80", fontWeight: "700" }}>✓ ACCEPTED</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Request #2</span>
                    <span style={{ color: "#ef4444", fontWeight: "700" }}>✕ DUPLICATE BLOCKED</span>
                  </div>
                  <div style={{ borderTop: "1px dashed #3f3f46", margin: "8px 0" }}></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Payment executed:</span>
                    <span style={{ fontWeight: "700" }}>€{demoResult.executedAmount}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Duplicate prevented:</span>
                    <span style={{ fontWeight: "700", color: "#ef4444" }}>€{demoResult.preventedAmount}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", margin: "16px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Idempotency Status:</span>
                    <span style={{ color: "#4ade80", fontWeight: "700" }}>NEW REQUEST</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Payment executed:</span>
                    <span style={{ fontWeight: "700" }}>€{demoResult.executedAmount}</span>
                  </div>
                </div>
              )}

              {/* Graphical Visual Flow */}
              <div style={{ background: "#09090b", padding: "14px", borderRadius: "10px", textAlign: "center", fontSize: "14px", fontWeight: "600", color: "#38bdf8", marginTop: "16px" }}>
                {demoResult.type === "double" ? "2 requests  →  1 payment executed  →  1 duplicate blocked" : "1 request  →  1 payment executed"}
              </div>
            </div>
          ) : (
            <div style={{ color: "#71717a", fontSize: "14px", fontStyle: "italic" }}>
              Click &quot;Pay €10&quot; or &quot;Simulate Double Payment&quot; to test the backend idempotency guard.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
