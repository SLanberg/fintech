import mapping from '../../../mock/mcc-categories.json' with { type: 'json' };

export type MerchantCategory = keyof typeof mapping.categories;
export const CATEGORY_LABELS = mapping.categories;
export const ESSENTIAL_CATEGORIES: readonly MerchantCategory[] = ['groceries', 'utilities', 'transport', 'pharmacy'];
export const DEFAULT_DISCRETIONARY: MerchantCategory[] = ['clothing', 'electronics', 'digital_goods', 'gambling'];
export const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
export const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;
export const REASON_TEXT = {
  daily_limit: 'This purchase would take today’s spending above your personal daily limit.',
  work_hours: 'This purchase costs more than your chosen number of working hours.',
  late_night: 'It is between 23:00 and 05:00. A fresh look tomorrow may help.',
  purchase_burst: 'This would be your third or later discretionary purchase within 60 minutes.',
  gambling: 'Online gambling purchases always receive a pause when gambling is selected as discretionary.',
} as const;
export type NudgeReason = keyof typeof REASON_TEXT;
export const categoryForMcc = (mcc: string | null): MerchantCategory =>
  (mapping.mccToCategory as Record<string, MerchantCategory>)[mcc ?? ''] ?? 'other';

export const isDiscretionary = (mcc: string | null, selected: readonly MerchantCategory[]) => {
  const category = categoryForMcc(mcc);
  return !ESSENTIAL_CATEGORIES.includes(category) && selected.includes(category);
};

export interface Purchase {
  id: string;
  merchantId: string;
  merchantName: string;
  mcc: string;
  amount: number;
  cardNotPresent: boolean;
}
export interface CompletedPurchase extends Purchase { timestamp: number; localDate: string }
export interface WaitingPurchase extends Purchase { remindAt: number }
export interface NudgeSettings {
  dailyLimit: number | null;
  hourlyRate: number;
  workHoursThreshold: number;
  discretionaryCategories: readonly MerchantCategory[];
}

/** Uses supplied time and completed history only, never reads the clock.
 * Online + discretionary gates apply to ALL categories. Eligible gambling
 * always nudges, bypassing the ordinary triggers and cooldown. Current attempt
 * counts as the third purchase in a burst; cancelled/deferred attempts do not.
 * 23:00 inclusive / 05:00 exclusive. Cooldown expires at exactly 30 minutes.
 */
export function evaluatePurchaseNudge({ purchase, settings, history, now, localHour, localDate, lastNudgeAt = null }: {
  purchase: Purchase; settings: NudgeSettings; history: readonly CompletedPurchase[];
  now: number; localHour: number; localDate: string; lastNudgeAt?: number | null;
}): { shouldNudge: boolean; reasons: NudgeReason[] } {
  for (const [label, value] of Object.entries({ amount: purchase.amount, dailyLimit: settings.dailyLimit ?? 0, hourlyRate: settings.hourlyRate, workHoursThreshold: settings.workHoursThreshold })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative and finite.`);
  }
  if (settings.hourlyRate === 0) throw new RangeError('Hourly rate must be positive.');
  if (!Number.isFinite(now) || !Number.isFinite(localHour) || localHour < 0 || localHour >= 24) throw new RangeError('Invalid time.');
  if (!purchase.cardNotPresent || !isDiscretionary(purchase.mcc, settings.discretionaryCategories)) return { shouldNudge: false, reasons: [] };
  const prior = history.filter(item => item.id !== purchase.id && item.timestamp <= now);
  const todaySpending = prior.filter(item => item.localDate === localDate).reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  const reasons: NudgeReason[] = [];
  if (settings.dailyLimit !== null && todaySpending + Math.round(purchase.amount * 100) > Math.round(settings.dailyLimit * 100)) reasons.push('daily_limit');
  if (purchase.amount / settings.hourlyRate > settings.workHoursThreshold) reasons.push('work_hours');
  if (localHour >= 23 || localHour < 5) reasons.push('late_night');
  if (prior.filter(item => now - item.timestamp <= 60 * 60 * 1000 && isDiscretionary(item.mcc, settings.discretionaryCategories)).length + 1 >= 3) reasons.push('purchase_burst');
  if (categoryForMcc(purchase.mcc) === 'gambling') return { shouldNudge: true, reasons: [...reasons, 'gambling'] };
  if (lastNudgeAt !== null && now - lastNudgeAt < NUDGE_COOLDOWN_MS) return { shouldNudge: false, reasons: [] };
  return { shouldNudge: reasons.length > 0, reasons };
}

export function calculateHourlyRate(netMonthlyIncome: number, weeklyHours = 40, manualRate: number | null = null) {
  if (!Number.isFinite(netMonthlyIncome) || netMonthlyIncome <= 0 || !Number.isFinite(weeklyHours) || weeklyHours <= 0 || (manualRate !== null && (!Number.isFinite(manualRate) || manualRate <= 0))) throw new RangeError('Income, working hours and manual rate must be positive.');
  return manualRate ?? netMonthlyIncome / (weeklyHours * 52 / 12);
}

export const canBuyWaitingPurchase = (purchase: WaitingPurchase, now: number) => now >= purchase.remindAt;
