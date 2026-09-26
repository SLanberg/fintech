"use client";
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { spendingScenario } from '../../lib/mock-spending';
import { calculateSafeToSpend } from '../../lib/safe-to-spend';
import { calculateHourlyRate, categoryForMcc, CATEGORY_LABELS, evaluatePurchaseNudge, REASON_TEXT, REMINDER_DELAY_MS, canBuyWaitingPurchase } from '../../lib/purchase-nudge';
import type { Purchase, NudgeReason } from '../../lib/purchase-nudge';
import type { SpendingState } from '../../lib/spending-settings';
import styles from './PurchaseSimulator.module.css';

const eur = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
const localDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const countdown = (remaining: number) => {
  const seconds = Math.ceil(Math.max(0, remaining) / 1000);
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
};
interface Confirmation { purchase: Purchase; reasons: NudgeReason[]; localHour: number }

function PaymentConfirmation({ active, hourlyRate, before, after, onBuy, onCancel, onRemind }: {
  active: Confirmation; hourlyRate: number; before: number; after: number;
  onBuy: () => void; onCancel: () => void; onRemind: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const time = `${String(Math.floor(active.localHour)).padStart(2, '0')}:${String(Math.round((active.localHour % 1) * 60)).padStart(2, '0')}`;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <p className={styles.eyebrow}>Balance · 3-D Secure demo</p><h2 id="confirmation-title">Confirm online payment</h2>
    <p className={styles.note}>Simulated card confirmation. No real payment will be sent.</p>
    <div className={styles.merchant}><strong>{active.purchase.merchantName}</strong><span>{eur(active.purchase.amount)}</span></div>
    <p className={styles.note}>{CATEGORY_LABELS[categoryForMcc(active.purchase.mcc)]} · MCC {active.purchase.mcc} · {active.purchase.cardNotPresent ? 'Online / card not present' : 'Card present'} · Local time {time}</p>
    <p className={styles.work}>This is {(active.purchase.amount / hourlyRate).toFixed(1)} hours of your work</p>
    {active.reasons.length > 0 ? <section className={styles.nudge} aria-label="Purchase nudge"><h3>A moment to think</h3><ul>{active.reasons.map(reason => <li key={reason}>{REASON_TEXT[reason]}</li>)}</ul></section> : <p className={styles.note}>Standard confirmation — no purchase nudge triggered.</p>}
    <div className={styles.impact}><span>Today’s Safe to Spend</span><strong>{eur(before)} → {eur(after)}</strong></div>
    {after < 0 && <p className={styles.warning}>This purchase would leave a negative Safe to Spend balance.</p>}
    <div className={styles.buttons}><button type="button" onClick={onBuy}>Buy</button><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onRemind}>Remind me in 24 hours</button></div>
  </dialog>;
}

export default function PurchaseSimulator({ state, setState, balance, today, visible }: {
  state: SpendingState; setState: Dispatch<SetStateAction<SpendingState>>; balance: number; today: string; visible: boolean;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const [active, setActive] = useState<Confirmation | null>(null);
  const [scenarioId, setScenarioId] = useState(spendingScenario.purchaseScenarios[0].id);
  const [amountInput, setAmountInput] = useState(String(spendingScenario.purchaseScenarios[0].amount));
  const [message, setMessage] = useState('');
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const now = clock + state.clockOffset;
  const hourlyRate = calculateHourlyRate(state.settings.netMonthlyIncome, state.settings.weeklyHours, state.settings.manualHourlyRate);
  const before = calculateSafeToSpend(balance, spendingScenario.recurring, state.settings.goals, state.settings.buffer, today).safeToSpend;
  const after = active ? calculateSafeToSpend(balance - active.purchase.amount, spendingScenario.recurring, state.settings.goals, state.settings.buffer, today).safeToSpend : before;
  const demoControls = process.env.NODE_ENV === 'development';
  const begin = (purchase: Purchase, localHour: number) => {
    const currentTime = Date.now() + state.clockOffset;
    const result = evaluatePurchaseNudge({ purchase, settings: { ...state.settings, hourlyRate }, history: state.purchases, now: currentTime, localHour, localDate: localDate(currentTime), lastNudgeAt: state.lastNudgeAt });
    setActive({ purchase, reasons: result.reasons, localHour });
    // Record shown nudges, including cancelled or deferred confirmations.
    if (result.shouldNudge) setState(current => ({ ...current, lastNudgeAt: currentTime }));
    setMessage('');
  };
  const simulate = () => {
    const scenario = spendingScenario.purchaseScenarios.find(item => item.id === scenarioId)!;
    const merchant = spendingScenario.merchants.find(item => item.id === scenario.merchantId)!;
    const amount = Number(amountInput);
    if (!amountInput.trim() || !Number.isFinite(amount) || amount <= 0) { setMessage('Enter a positive purchase amount.'); return; }
    begin({ id: crypto.randomUUID(), merchantId: merchant.id, merchantName: merchant.name, mcc: merchant.mcc!, cardNotPresent: true, amount }, scenario.localHour);
  };
  const buy = () => {
    if (!active) return;
    const timestamp = Date.now() + state.clockOffset;
    const purchase = active.purchase;
    setState(current => current.purchases.some(item => item.id === purchase.id) ? current : {
      ...current, purchases: [...current.purchases, { ...purchase, timestamp, localDate: localDate(timestamp) }], waiting: current.waiting.filter(item => item.id !== purchase.id),
    });
    setActive(null);
    setMessage(`Demo payment confirmed: ${purchase.merchantName}. Safe to Spend has been updated.`);
  };
  const remind = () => {
    if (!active) return;
    const purchase = { ...active.purchase, remindAt: Date.now() + state.clockOffset + REMINDER_DELAY_MS };
    setState(current => ({ ...current, waiting: [...current.waiting.filter(item => item.id !== purchase.id), purchase] }));
    setActive(null);
    setMessage('Added to your waiting list. No money has been spent.');
  };
  return <section className={styles.section} aria-label="Online payment demo and waiting list">
    {demoControls && <details className={styles.demo}><summary>Demo controls · Simulate incoming payment</summary>
      <p className={styles.note}>Choose a mock merchant. Scenario times are simulated; the nudge cooldown and waiting countdown use elapsed time.</p>
      <label>Purchase scenario<select value={scenarioId} onChange={event => { setScenarioId(event.target.value); setAmountInput(String(spendingScenario.purchaseScenarios.find(item => item.id === event.target.value)!.amount)); }}>{spendingScenario.purchaseScenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Amount (EUR)<input type="number" min="0.01" step="0.01" value={amountInput} onChange={event => setAmountInput(event.target.value)} /></label>
      <button type="button" disabled={!visible || active !== null} onClick={simulate}>Simulate online payment</button>
      <button type="button" onClick={() => { setState(current => ({ ...current, purchases: [], waiting: [], lastNudgeAt: null, clockOffset: 0 })); setMessage('Demo payments and clock reset. Your settings are preserved.'); }}>Reset demo payments</button>
      {state.waiting.length > 0 && <button type="button" onClick={() => setState(current => ({ ...current, clockOffset: current.clockOffset + REMINDER_DELAY_MS }))}>Demo: advance 24 hours</button>}
    </details>}
    <p role="status" className={styles.note}>{message}</p>
    <div className={styles.waiting}><h2>Waiting list</h2><p className={styles.note}>Deferred purchases stay here for 24 hours. They do not reserve money.</p>
      {state.waiting.length === 0 ? <p className={styles.note}>Nothing waiting. A little breathing room.</p> : state.waiting.map(purchase => {
        const ready = canBuyWaitingPurchase(purchase, now);
        return <div key={purchase.id} className={styles.waitingItem}><strong>{purchase.merchantName}</strong><span>{visible ? eur(purchase.amount) : '••••'} · {ready ? 'Ready to reconsider' : countdown(purchase.remindAt - now)}</span><div className={styles.buttons}><button type="button" disabled={!ready || !visible} onClick={() => {
          const currentTime = Date.now() + state.clockOffset;
          if (canBuyWaitingPurchase(purchase, currentTime)) begin(purchase, new Date(currentTime).getHours() + new Date(currentTime).getMinutes() / 60);
        }}>Buy</button><button type="button" onClick={() => setState(current => ({ ...current, waiting: current.waiting.filter(item => item.id !== purchase.id) }))}>Dismiss</button></div></div>;
      })}
    </div>
    {active && <PaymentConfirmation active={active} hourlyRate={hourlyRate} before={before} after={after} onBuy={buy} onCancel={() => { setActive(null); setMessage('Payment cancelled. No money has been spent.'); }} onRemind={remind} />}
  </section>;
}
