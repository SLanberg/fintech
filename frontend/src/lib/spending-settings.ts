import { DEFAULT_SAFETY_BUFFER } from './safe-to-spend';
import { spendingScenario } from './mock-spending';
import { CATEGORY_LABELS, DEFAULT_DISCRETIONARY, ESSENTIAL_CATEGORIES } from './purchase-nudge';
import type { MerchantCategory, CompletedPurchase, WaitingPurchase } from './purchase-nudge';
import type { SavingsGoal } from './safe-to-spend';

export interface SpendingSettings {
  goals: SavingsGoal[];
  buffer: number;
  dailyLimit: number | null;
  netMonthlyIncome: number;
  weeklyHours: number;
  manualHourlyRate: number | null;
  workHoursThreshold: number;
  discretionaryCategories: MerchantCategory[];
}
export interface SpendingState {
  settings: SpendingSettings;
  purchases: CompletedPurchase[];
  waiting: WaitingPurchase[];
  lastNudgeAt: number | null;
  clockOffset: number;
}
export function defaultSpendingState(): SpendingState {
  return {
    settings: {
      goals: spendingScenario.goals.map(goal => ({ ...goal })), buffer: DEFAULT_SAFETY_BUFFER,
      dailyLimit: null, netMonthlyIncome: spendingScenario.recurring.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
      weeklyHours: 40, manualHourlyRate: null, workHoursThreshold: 3,
      discretionaryCategories: [...DEFAULT_DISCRETIONARY],
    },
    purchases: [], waiting: [], lastNudgeAt: null, clockOffset: 0,
  };
}

const finite = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const validPurchase = (value: unknown) => object(value) && typeof value.id === 'string' && typeof value.merchantId === 'string' && typeof value.merchantName === 'string' && typeof value.mcc === 'string' && /^\d{4}$/.test(value.mcc) && finite(value.amount) && typeof value.cardNotPresent === 'boolean';

/** Validate saved data before it can reach financial calculations. */
export function restoreSpendingState(raw: string | null): SpendingState {
  const fallback = defaultSpendingState();
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || !object(value.settings)) return fallback;
    const s = value.settings;
    if (!Array.isArray(s.goals) || !s.goals.every(goal => object(goal) && typeof goal.id === 'string' && typeof goal.name === 'string' && goal.name.trim() && finite(goal.monthlyReservation) && finite(goal.targetAmount, 0.01)) ||
      !finite(s.buffer) || !(s.dailyLimit === null || finite(s.dailyLimit)) || !finite(s.netMonthlyIncome, 0.01) || !finite(s.weeklyHours, 0.01) ||
      !(s.manualHourlyRate === null || finite(s.manualHourlyRate, 0.01)) || !finite(s.workHoursThreshold, 0.01) || !Array.isArray(s.discretionaryCategories) ||
      !s.discretionaryCategories.every(category => typeof category === 'string' && category in CATEGORY_LABELS) ||
      !Array.isArray(value.purchases) || !value.purchases.every(purchase => validPurchase(purchase) && object(purchase) && finite(purchase.timestamp) && typeof purchase.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(purchase.localDate)) ||
      !Array.isArray(value.waiting) || !value.waiting.every(purchase => validPurchase(purchase) && object(purchase) && finite(purchase.remindAt)) ||
      !(value.lastNudgeAt === null || finite(value.lastNudgeAt)) || !finite(value.clockOffset)) return fallback;
    const restored = value as unknown as SpendingState;
    restored.settings.discretionaryCategories = restored.settings.discretionaryCategories.filter(category => !ESSENTIAL_CATEGORIES.includes(category));
    return restored;
  } catch { return fallback; }
}
