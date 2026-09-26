"use client";

import { useState } from "react";
import { calculateSafeToSpend, forecastBalance, DEFAULT_SAFETY_BUFFER, ALLOWANCE_THRESHOLDS } from "../../lib/safe-to-spend";
import { spendingScenario } from "../../lib/mock-spending";
import styles from "./SafeToSpend.module.css";

const eur = (value: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(value);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const stateFor = (allowance: number) => allowance < ALLOWANCE_THRESHOLDS.red ? "red" : allowance >= ALLOWANCE_THRESHOLDS.green ? "green" : "amber";

export default function SafeToSpend({ balance, today, visible = true }: { balance: number; today: string; visible?: boolean }) {
  const [bufferInput, setBufferInput] = useState(String(DEFAULT_SAFETY_BUFFER));
  const [purchase, setPurchase] = useState("");
  const validBuffer = bufferInput.trim() !== "" && Number.isFinite(Number(bufferInput)) && Number(bufferInput) >= 0;
  const buffer = validBuffer ? Number(bufferInput) : DEFAULT_SAFETY_BUFFER;
  const result = calculateSafeToSpend(balance, spendingScenario.recurring, spendingScenario.goals, buffer, today);
  const forecast = forecastBalance(balance, spendingScenario.recurring, result.dailyAllowance, today);
  const validPurchase = purchase.trim() !== "" && Number.isFinite(Number(purchase)) && Number(purchase) >= 0;
  const preview = validPurchase ? calculateSafeToSpend(balance - Number(purchase), spendingScenario.recurring, spendingScenario.goals, buffer, today) : null;
  const state = stateFor(result.dailyAllowance);
  const min = Math.min(0, ...forecast.points.map(point => point.balance));
  const max = Math.max(1, ...forecast.points.map(point => point.balance));
  const x = (index: number) => 68 + index / (forecast.points.length - 1) * 444;
  const y = (value: number) => 174 - (value - min) / (max - min) * 144;
  const path = forecast.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.balance)}`).join(" ");
  const low = forecast.lowestPoint;

  return (
    <section className={`${styles.card} ${styles[state]}`} aria-labelledby="safe-title">
      <div className={styles.heading}>
        <h1 id="safe-title">Safe to Spend</h1>
        <span className={styles.badge}>{state === "red" ? "Budget shortfall" : state === "amber" ? "Keep an eye on spending" : "Room to breathe"}</span>
      </div>
      <div className={styles.amount}>{visible ? eur(result.safeToSpend) : "••••••"}</div>
      <p className={styles.allowance}>{visible ? eur(result.dailyAllowance) : "••••"} per day <span>·</span> {result.daysUntilIncome === 0 ? "Payday is today" : `${result.daysUntilIncome} days until payday`}</p>
      <p className={styles.caption}>After upcoming bills, savings and your safety buffer. Next income: {dateLabel(result.nextIncomeDate)}.</p>
      {result.daysUntilIncome === 0 && <p className={styles.caption}>Payday allowance uses one day. Today’s pending income is included in the forecast.</p>}
      {visible && <>
        <details className={styles.breakdown}>
          <summary>How it’s calculated</summary>
          <dl>
            <div><dt>Current balance</dt><dd>{eur(balance)}</dd></div>
            {result.breakdown.map(item => <div key={`${item.id}-${item.dueDate}`}><dt>{item.name}<small>{item.type === "bill" ? `Due ${dateLabel(item.dueDate)}` : item.type === "goal" ? `Monthly reservation · ${dateLabel(item.dueDate)}` : `Reserved · ${dateLabel(item.dueDate)}`}</small></dt><dd>−{eur(item.amount)}</dd></div>)}
            <div className={styles.total}><dt>Safe to Spend</dt><dd>{eur(result.safeToSpend)}</dd></div>
          </dl>
          <p className={styles.caption}>Only bills due before payday are deducted. Savings and buffer stay reserved in your account.</p>
        </details>
        <label className={styles.buffer}>Safety buffer <span>EUR <input type="number" min="0" step="0.01" value={bufferInput} onChange={event => setBufferInput(event.target.value)} aria-invalid={!validBuffer} /></span></label>
        {!validBuffer && <p className={styles.error} role="alert">Enter a non-negative buffer. Using the default €100 until corrected.</p>}
        <div className={styles.forecast}>
          <h2>Next 30 days</h2>
          <p className={styles.caption}>Estimated balance after bills and {eur(Math.max(0, result.dailyAllowance))}/day spending. Savings and buffer remain in the balance.</p>
          <svg viewBox="0 0 540 208" role="img" aria-labelledby="forecast-title forecast-description" className={styles.chart}>
            <title id="forecast-title">30-day balance forecast</title>
            <desc id="forecast-description">Opening balance {eur(balance)}. Lowest balance {eur(low.balance)} on {dateLabel(low.date)}. Final balance {eur(forecast.points.at(-1)!.balance)}.</desc>
            {[min, (max + min) / 2, max].map((value, index) => <g key={index}><line x1="68" x2="512" y1={y(value)} y2={y(value)} stroke="#e4e4e7" strokeDasharray="3 5" /><text x="58" y={y(value) + 4} textAnchor="end" className={styles.axis}>{Math.round(value)} €</text></g>)}
            <path d={`${path} L512,174 L68,174 Z`} fill="currentColor" opacity="0.07" />
            <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            <line x1={x(forecast.lowestIndex)} x2={x(forecast.lowestIndex)} y1="24" y2="174" stroke="currentColor" opacity="0.3" strokeDasharray="3 4" />
            <circle cx={x(forecast.lowestIndex)} cy={y(low.balance)} r="5" fill="currentColor" stroke="white" strokeWidth="2" />
            <text x="68" y="199" className={styles.axis}>{dateLabel(today)}</text>
            <text x="512" y="199" textAnchor="end" className={styles.axis}>{dateLabel(forecast.points.at(-1)!.date)}</text>
          </svg>
          <p className={styles.lowest}>Lowest point: <strong>{eur(low.balance)}</strong> on {dateLabel(low.date)}{low.opening ? " (opening balance)" : ""}</p>
          {result.dailyAllowance < 0 && <p className={styles.caption}>A negative allowance means a shortfall. The forecast assumes no discretionary spending.</p>}
          <details className={styles.forecastTable}><summary>View daily forecast</summary><table><thead><tr><th>Date</th><th>Recurring events</th><th>Balance</th></tr></thead><tbody>{forecast.points.map((point, index) => <tr key={index}><td>{dateLabel(point.date)}{point.opening ? " · Opening" : ""}</td><td>{point.events.join(", ") || "—"}</td><td>{eur(point.balance)}{index === forecast.lowestIndex ? " · Lowest" : ""}</td></tr>)}</tbody></table></details>
        </div>
        <div className={styles.afford}>
          <label htmlFor="purchase-amount">Can I afford it?</label>
          <p className={styles.caption}>Preview a purchase without spending any money.</p>
          <div className={styles.purchaseInput}><span>€</span><input id="purchase-amount" type="number" min="0" step="0.01" placeholder="Enter an amount" value={purchase} onChange={event => setPurchase(event.target.value)} aria-invalid={purchase !== "" && !validPurchase} /></div>
          <div aria-live="polite">{preview ? <p className={`${styles.preview} ${styles[stateFor(preview.dailyAllowance)]}`}>After spending {eur(Number(purchase))}: <strong>{eur(preview.safeToSpend)}</strong> Safe to Spend · <strong>{eur(preview.dailyAllowance)}/day</strong>{preview.safeToSpend < 0 ? ". This exceeds your available budget." : ". This fits your available budget."}</p> : purchase !== "" ? <p className={styles.error}>Enter a valid non-negative amount.</p> : null}</div>
        </div>
      </>}
    </section>
  );
}
