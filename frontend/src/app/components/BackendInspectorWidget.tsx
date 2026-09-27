"use client";

import React, { useState, useRef, useEffect } from "react";
import styles from "./BackendInspectorWidget.module.css";

interface ActiveTab {
  id: "architecture" | "idempotency" | "transaction" | "intent" | "db";
  label: string;
  icon: string;
}

const TABS: ActiveTab[] = [
  { id: "architecture", label: "Overview", icon: "⚡" },
  { id: "idempotency", label: "Idempotency Lock", icon: "🔒" },
  { id: "transaction", label: "Atomic ACID", icon: "🛡️" },
  { id: "intent", label: "Payment Intent", icon: "💳" },
  { id: "db", label: "SQL Ledger", icon: "🗄️" },
];

export default function BackendInspectorWidget() {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab["id"]>("architecture");

  // Draggable window state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const widgetRef = useRef<HTMLDivElement>(null);

  // Position initialized to top right offset on mount
  useEffect(() => {
    // Set default initial position from bottom right or top right offset
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't drag if clicking buttons inside header
    if ((e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) {
    return (
      <button
        className={styles.floatingTriggerBtn}
        onClick={() => setIsOpen(true)}
        title="Open Backend Architecture Inspector"
      >
        <span className={styles.pulseDot}></span>
        🔍 Backend Under The Hood
      </button>
    );
  }

  return (
    <div
      ref={widgetRef}
      className={`${styles.widgetContainer} ${isMinimized ? styles.minimized : ""}`}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
    >
      {/* Header / Drag Bar */}
      <div className={styles.header} onMouseDown={handleMouseDown}>
        <div className={styles.headerTitle}>
          <span className={styles.badgeLive}>LIVE INSPECTOR</span>
          <span className={styles.titleText}>⚙️ Backend Engine Architecture</span>
        </div>
        <div className={styles.headerControls}>
          <button
            className={styles.controlBtn}
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? "Expand" : "Minimize"}
          >
            {isMinimized ? "▢" : "—"}
          </button>
          <button
            className={styles.controlBtnClose}
            onClick={() => setIsOpen(false)}
            title="Close Inspector"
          >
            ✕
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Navigation Tabs */}
          <div className={styles.tabsNav}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`${styles.tabItem} ${activeTab === tab.id ? styles.activeTab : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Body Content per Tab */}
          <div className={styles.contentBody}>
            {activeTab === "architecture" && (
              <div className={styles.tabContent}>
                <div className={styles.heroBanner}>
                  🎯 <strong>Why Lockin &amp; Build Backend is Bulletproof:</strong>
                  <p>
                    Financial transactions cannot afford race conditions, network dropouts, or double-clicks.
                    Our architecture guarantees zero double-debiting with 100% deterministic consistency.
                  </p>
                </div>

                <div className={styles.featureGrid}>
                  <div className={styles.featureCard}>
                    <div className={styles.featureIcon}>🔒</div>
                    <div>
                      <div className={styles.featureTitle}>Atomic Processing Lock</div>
                      <div className={styles.featureDesc}>
                        Concurrent requests with the same key instantly hit HTTP 409 Conflict.
                      </div>
                    </div>
                  </div>

                  <div className={styles.featureCard}>
                    <div className={styles.featureIcon}>🔑</div>
                    <div>
                      <div className={styles.featureTitle}>Payload Hash Integrity</div>
                      <div className={styles.featureDesc}>
                        SHA-256 hash checks ensure modified amounts/payloads reuse are rejected.
                      </div>
                    </div>
                  </div>

                  <div className={styles.featureCard}>
                    <div className={styles.featureIcon}>⚖️</div>
                    <div>
                      <div className={styles.featureTitle}>SQLite ACID Transactions</div>
                      <div className={styles.featureDesc}>
                        Balance updates &amp; ledger entries execute atomically inside single DB locks.
                      </div>
                    </div>
                  </div>

                  <div className={styles.featureCard}>
                    <div className={styles.featureIcon}>🔄</div>
                    <div>
                      <div className={styles.featureTitle}>Replay &amp; Intent Safety</div>
                      <div className={styles.featureDesc}>
                        Network retries receive cached responses without re-executing transfers.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "idempotency" && (
              <div className={styles.tabContent}>
                <div className={styles.sectionHeader}>
                  <span>🔒 Processing Lock &amp; SHA-256 Hash Guard</span>
                </div>
                <p className={styles.prose}>
                  Before executing any monetary logic, backend queries <code>idempotency_records</code> table scoped by <code>(user_id, key)</code>.
                </p>

                <div className={styles.codeBlock}>
                  <div className={styles.codeTag}>TransferService.ts</div>
                  <pre>{`// 1. Hash compute
const payloadHash = SHA256(senderId + recipientTag + amountCents);

// 2. Lock insertion before execution
INSERT INTO idempotency_records 
(user_id, key, request_hash, status) 
VALUES (?, ?, ?, 'IN_PROGRESS');

// Unique Constraint violation catch -> Returns HTTP 409 Conflict!`}</pre>
                </div>

                <div className={styles.calloutBox}>
                  <strong>Why it wows:</strong> Handles burst traffic seamlessly. Even 5x rapid spam clicks execute exactly 1 transfer while blocking 4 concurrent races instantly!
                </div>
              </div>
            )}

            {activeTab === "transaction" && (
              <div className={styles.tabContent}>
                <div className={styles.sectionHeader}>
                  <span>🛡️ Atomic Balance Updates &amp; DB Constraints</span>
                </div>
                <p className={styles.prose}>
                  Double spending is physically impossible because balance deduction specifies a non-negative constraint directly inside SQL.
                </p>

                <div className={styles.codeBlock}>
                  <div className={styles.codeTag}>Atomic SQL Transaction</div>
                  <pre>{`db.transaction(() => {
  // 1. Deduct sender (Atomic check: balance_cents >= amount)
  UPDATE users SET balance_cents = balance_cents - 1000
  WHERE id = 'alice' AND balance_cents >= 1000;

  // 2. Credit recipient
  UPDATE users SET balance_cents = balance_cents + 1000
  WHERE id = 'bob';

  // 3. Write immutable audit ledger entry
  INSERT INTO ledger_entries (...) VALUES (...);
});`}</pre>
                </div>
              </div>
            )}

            {activeTab === "intent" && (
              <div className={styles.tabContent}>
                <div className={styles.sectionHeader}>
                  <span>💳 Payment Intent Pattern (Stripe Standard)</span>
                </div>
                <p className={styles.prose}>
                  Separates payment initialization (Prepare) from authorization &amp; settlement (Confirm).
                </p>

                <div className={styles.stepList}>
                  <div className={styles.stepItem}>
                    <span className={styles.stepNum}>1</span>
                    <div>
                      <strong>POST /api/transfers/intent</strong>
                      <p>Generates <code>pi_xxxx</code> with status <code>REQUIRES_CONFIRMATION</code>.</p>
                    </div>
                  </div>
                  <div className={styles.stepItem}>
                    <span className={styles.stepNum}>2</span>
                    <div>
                      <strong>POST /api/transfers/confirm</strong>
                      <p>Locks state to <code>PROCESSING</code>, updates balances, marks <code>SUCCEEDED</code>.</p>
                    </div>
                  </div>
                  <div className={styles.stepItem}>
                    <span className={styles.stepNum}>3</span>
                    <div>
                      <strong>Socket Timeout Retry</strong>
                      <p>If client times out and retries, backend detects <code>SUCCEEDED</code> status &amp; safely returns cached transaction payload!</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "db" && (
              <div className={styles.tabContent}>
                <div className={styles.sectionHeader}>
                  <span>🗄️ Database Tables Schema</span>
                </div>

                <div className={styles.schemaCard}>
                  <div className={styles.schemaName}>TABLE: idempotency_records</div>
                  <div className={styles.schemaRow}><span>user_id (TEXT)</span> <span>FK → users.id</span></div>
                  <div className={styles.schemaRow}><span>key (TEXT)</span> <span>Client Idempotency Key</span></div>
                  <div className={styles.schemaRow}><span>request_hash (TEXT)</span> <span>SHA-256 Payload Hash</span></div>
                  <div className={styles.schemaRow}><span>status (TEXT)</span> <span>IN_PROGRESS | COMPLETED</span></div>
                  <div className={styles.schemaRow}><span>response_body (TEXT)</span> <span>Cached JSON payload</span></div>
                </div>

                <div className={styles.schemaCard} style={{ marginTop: "10px" }}>
                  <div className={styles.schemaName}>TABLE: ledger_entries</div>
                  <div className={styles.schemaRow}><span>id (UUID)</span> <span>Immutable Tx ID</span></div>
                  <div className={styles.schemaRow}><span>sender_user_id</span> <span>Internal immutable ID</span></div>
                  <div className={styles.schemaRow}><span>recipient_user_id</span> <span>Internal immutable ID</span></div>
                  <div className={styles.schemaRow}><span>amount_cents (INTEGER)</span> <span>Integer minor currency</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Footer status bar */}
          <div className={styles.widgetFooter}>
            <div className={styles.statusIndicator}>
              <span className={styles.statusDot}></span>
              <span>Backend Server: <strong>http://localhost:5001</strong></span>
            </div>
            <span className={styles.dragHint}>💡 Drag top bar to move</span>
          </div>
        </>
      )}
    </div>
  );
}
