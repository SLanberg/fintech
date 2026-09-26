export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  dayOfMonth: number;
  type: "income" | "outflow";
}

export interface SavingsGoal {
  id: string;
  name: string;
  monthlyReservation: number;
  targetAmount?: number;
}

export interface Deduction {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  type: "bill" | "goal" | "buffer";
}

export const DEFAULT_SAFETY_BUFFER = 100;
export const ALLOWANCE_THRESHOLDS = { green: 20, red: 0 } as const;
const DAY_MS = 86_400_000;
const cents = (amount: number) => Math.round(amount * 100);
const money = (amount: number) => cents(amount) / 100;

/** Calendar dates use UTC internally to avoid DST changing the number of days. */
export function calendarDate(value: Date | string): Date {
  const date = typeof value === "string"
    ? new Date(`${value}T00:00:00Z`)
    : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (!Number.isFinite(date.getTime()) || (typeof value === "string" && date.toISOString().slice(0, 10) !== value)) {
    throw new RangeError("Use a valid calendar date (YYYY-MM-DD).");
  }
  return date;
}

export const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function recurringDate(year: number, month: number, day: number): Date {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError("Recurring day must be 1–31.");
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function nextOccurrence(item: RecurringItem, today: Date): Date {
  const date = recurringDate(today.getUTCFullYear(), today.getUTCMonth(), item.dayOfMonth);
  return date < today
    ? recurringDate(today.getUTCFullYear(), today.getUTCMonth() + 1, item.dayOfMonth)
    : date;
}

function validateAmount(value: number, label: string, signed = false) {
  if (!Number.isFinite(value) || (!signed && value < 0)) throw new RangeError(`${label} must be a finite ${signed ? "" : "non-negative "}amount.`);
}

/**
 * Pure EUR calculation. Balance is the opening balance for today; today's pending
 * bills count. Payday bills do not count because the cutoff is strictly before
 * income. Reservations and buffer are earmarked today, not extra bank debits.
 * On payday, daysUntilIncome is 0 and the daily divisor is 1 (never Infinity).
 * No income schedule is an explicit error rather than an invented payday.
 */
export function calculateSafeToSpend(
  balance: number,
  recurring: readonly RecurringItem[],
  goals: readonly SavingsGoal[],
  buffer: number = DEFAULT_SAFETY_BUFFER,
  todaysDate: Date | string,
) {
  validateAmount(balance, "Balance", true);
  validateAmount(buffer, "Buffer");
  const today = calendarDate(todaysDate);
  recurring.forEach(item => {
    validateAmount(item.amount, item.name);
    recurringDate(today.getUTCFullYear(), today.getUTCMonth(), item.dayOfMonth);
  });
  goals.forEach(goal => validateAmount(goal.monthlyReservation, goal.name));
  const incomes = recurring.filter(item => item.type === "income").map(item => nextOccurrence(item, today));
  if (!incomes.length) throw new RangeError("At least one recurring income is required.");
  const nextIncome = new Date(Math.min(...incomes.map(date => date.getTime())));
  const daysUntilIncome = Math.round((nextIncome.getTime() - today.getTime()) / DAY_MS);
  const breakdown: Deduction[] = recurring.filter(item => item.type === "outflow")
    .map(item => ({ id: item.id, name: item.name, amount: money(item.amount), dueDate: dateKey(nextOccurrence(item, today)), type: "bill" as const }))
    .filter(item => item.dueDate < dateKey(nextIncome))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  breakdown.push(...goals.map(goal => ({ id: goal.id, name: goal.name, amount: money(goal.monthlyReservation), dueDate: dateKey(today), type: "goal" as const })));
  breakdown.push({ id: "safety-buffer", name: "Safety buffer", amount: money(buffer), dueDate: dateKey(today), type: "buffer" });
  const safeToSpend = (cents(balance) - breakdown.reduce((sum, item) => sum + cents(item.amount), 0)) / 100;
  return { safeToSpend, dailyAllowance: safeToSpend / Math.max(1, daysUntilIncome), daysUntilIncome, nextIncomeDate: dateKey(nextIncome), breakdown };
}

export interface ForecastPoint { date: string; balance: number; events: string[]; opening?: boolean }

/** Opening point plus 30 closing balances, starting today. Fixed allowance is
 * held across the horizon. A negative allowance is a budget shortfall, so the
 * spending estimate is zero rather than fictitious discretionary income.
 * Goals/buffer remain in the account and are therefore not debited again. */
export function forecastBalance(balance: number, recurring: readonly RecurringItem[], dailyAllowance: number, todaysDate: Date | string) {
  validateAmount(balance, "Balance", true);
  validateAmount(dailyAllowance, "Allowance", true);
  const today = calendarDate(todaysDate);
  recurring.forEach(item => {
    validateAmount(item.amount, item.name);
    recurringDate(today.getUTCFullYear(), today.getUTCMonth(), item.dayOfMonth);
  });
  let running = cents(balance);
  const spending = Math.max(0, dailyAllowance) * 100;
  const points: ForecastPoint[] = [{ date: dateKey(today), balance: running / 100, events: [], opening: true }];
  for (let offset = 0; offset < 30; offset++) {
    const date = new Date(today.getTime() + offset * DAY_MS);
    const events = recurring.filter(item => dateKey(recurringDate(date.getUTCFullYear(), date.getUTCMonth(), item.dayOfMonth)) === dateKey(date));
    running += events.reduce((sum, item) => sum + cents(item.amount) * (item.type === "income" ? 1 : -1), 0);
    running -= spending;
    points.push({ date: dateKey(date), balance: Math.round(running) / 100, events: events.map(item => item.name) });
  }
  const lowestIndex = points.reduce((lowest, point, index) => point.balance < points[lowest].balance ? index : lowest, 0);
  return { points, lowestIndex, lowestPoint: points[lowestIndex] };
}
