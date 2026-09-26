"use client";
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SavingsGoal } from '../../lib/safe-to-spend';
import type { SpendingSettings as Settings } from '../../lib/spending-settings';
import { CATEGORY_LABELS, ESSENTIAL_CATEGORIES, calculateHourlyRate } from '../../lib/purchase-nudge';
import type { MerchantCategory } from '../../lib/purchase-nudge';
import styles from './SpendingSettings.module.css';

function GoalForm({ goal, onSave, onDelete }: { goal?: SavingsGoal; onSave: (goal: SavingsGoal) => void; onDelete?: () => void }) {
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    const targetAmount = Number(data.get('target'));
    const monthlyReservation = Number(data.get('reservation'));
    if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0 || !Number.isFinite(monthlyReservation) || monthlyReservation < 0) return;
    onSave({ id: goal?.id ?? crypto.randomUUID(), name, targetAmount, monthlyReservation });
    if (!goal) form.reset();
    setSaved(true);
  };
  return <form onSubmit={submit} className={styles.goal}>
    <label>Goal name<input name="name" required maxLength={80} defaultValue={goal?.name ?? ''} /></label>
    <div className={styles.row}>
      <label>Target (EUR)<input name="target" type="number" min="0.01" step="0.01" required defaultValue={goal?.targetAmount ?? ''} /></label>
      <label>Monthly reservation (EUR)<input name="reservation" type="number" min="0" step="0.01" required defaultValue={goal?.monthlyReservation ?? ''} /></label>
    </div>
    <div className={styles.actions}><button type="submit">{goal ? 'Save goal' : 'Create goal'}</button>{onDelete && <button type="button" onClick={onDelete}>Delete goal</button>}</div>
    {saved && <span role="status" className={styles.note}>Goal saved.</span>}
  </form>;
}

export default function SpendingSettings({ settings, onChange, onBack }: { settings: Settings; onChange: (value: Settings) => void; onBack: () => void }) {
  const [income, setIncome] = useState(String(settings.netMonthlyIncome));
  const [hours, setHours] = useState(String(settings.weeklyHours));
  const [manual, setManual] = useState(settings.manualHourlyRate === null ? '' : String(settings.manualHourlyRate));
  const [daily, setDaily] = useState(settings.dailyLimit === null ? '' : String(settings.dailyLimit));
  const [threshold, setThreshold] = useState(String(settings.workHoursThreshold));
  const [saved, setSaved] = useState(false);
  let hourlyRate: number | null = null;
  try { hourlyRate = calculateHourlyRate(Number(income), Number(hours), manual.trim() ? Number(manual) : null); } catch { /* Invalid draft stays in the form. */ }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hourlyRate === null || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0 || (daily.trim() && (!Number.isFinite(Number(daily)) || Number(daily) < 0))) return;
    onChange({ ...settings, netMonthlyIncome: Number(income), weeklyHours: Number(hours), manualHourlyRate: manual.trim() ? Number(manual) : null, dailyLimit: daily.trim() ? Number(daily) : null, workHoursThreshold: Number(threshold) });
    setSaved(true);
  };
  const saveGoal = (goal: SavingsGoal) => onChange({ ...settings, goals: settings.goals.some(item => item.id === goal.id) ? settings.goals.map(item => item.id === goal.id ? goal : item) : [...settings.goals, goal] });
  return <section className={styles.screen} aria-labelledby="settings-title">
    <div className={styles.heading}><h1 id="settings-title">Spending settings</h1><button type="button" onClick={onBack}>Back to Home</button></div>
    <p className={styles.note}>Saved on this device. Changes update Safe to Spend immediately after saving.</p>
    <form onSubmit={save} className={styles.panel}>
      <h2>Your spending pace</h2>
      <label>Personal daily spending limit (EUR)<input type="number" min="0" step="0.01" placeholder="Choose your limit" value={daily} onChange={event => { setDaily(event.target.value); setSaved(false); }} /></label>
      <label>Net monthly income (EUR)<input type="number" min="0.01" step="0.01" required value={income} onChange={event => { setIncome(event.target.value); setSaved(false); }} /></label>
      <p className={styles.note}>Income is used to value your working time. Your recurring salary schedule determines payday.</p>
      <div className={styles.row}>
        <label>Working hours per week<input type="number" min="0.01" step="0.01" required value={hours} onChange={event => { setHours(event.target.value); setSaved(false); }} /></label>
        <label>Manual hourly rate (EUR)<input type="number" min="0.01" step="0.01" placeholder="Use calculated rate" value={manual} onChange={event => { setManual(event.target.value); setSaved(false); }} /></label>
      </div>
      <p className={styles.note}>{hourlyRate === null ? 'Enter positive income and working hours.' : `Hourly rate: €${hourlyRate.toFixed(2)} · ${manual.trim() ? 'Manual override' : 'Net income ÷ (weekly hours × 52 ÷ 12)'}`}</p>
      <label>Nudge when a purchase costs more than this many work hours<input type="number" min="0.01" step="0.01" required value={threshold} onChange={event => { setThreshold(event.target.value); setSaved(false); }} /></label>
      <button type="submit">Save spending settings</button>{saved && <p className={styles.note} role="status">Spending settings saved.</p>}
    </form>
    <section className={styles.panel}><h2>Savings goals</h2><p className={styles.note}>Every monthly reservation is deducted from Safe to Spend.</p>
      {settings.goals.length === 0 && <p className={styles.note}>No savings goals yet.</p>}
      {settings.goals.map(goal => <GoalForm key={goal.id} goal={goal} onSave={saveGoal} onDelete={() => onChange({ ...settings, goals: settings.goals.filter(item => item.id !== goal.id) })} />)}
      <h3>Add a goal</h3><GoalForm onSave={saveGoal} />
    </section>
    <section className={styles.panel}><h2>What feels discretionary?</h2><p className={styles.note}>Selected categories can trigger an online purchase nudge. Essential categories are always excluded.</p>
      {(Object.entries(CATEGORY_LABELS) as [MerchantCategory, string][]).map(([category, label]) => {
        const essential = ESSENTIAL_CATEGORIES.includes(category);
        return <label key={category} className={styles.toggle}><input type="checkbox" disabled={essential} checked={!essential && settings.discretionaryCategories.includes(category)} onChange={event => onChange({ ...settings, discretionaryCategories: event.target.checked ? [...settings.discretionaryCategories, category] : settings.discretionaryCategories.filter(item => item !== category) })} /><span>{label}{essential ? ' · Always essential' : ''}</span></label>;
      })}
    </section>
  </section>;
}
