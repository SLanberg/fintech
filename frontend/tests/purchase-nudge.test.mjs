import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePurchaseNudge, calculateHourlyRate, categoryForMcc, isDiscretionary, DEFAULT_DISCRETIONARY, NUDGE_COOLDOWN_MS, REMINDER_DELAY_MS, canBuyWaitingPurchase } from '../src/lib/purchase-nudge.ts';

const now = Date.parse('2026-06-05T12:00:00Z');
const purchase = Object.freeze({ id: 'new', merchantId: 'clothing', merchantName: 'Clothing store', mcc: '5651', amount: 10, cardNotPresent: true });
const settings = Object.freeze({ dailyLimit: 100, hourlyRate: 15, workHoursThreshold: 3, discretionaryCategories: Object.freeze([...DEFAULT_DISCRETIONARY]) });
const base = { purchase, settings, history: [], now, localHour: 14, localDate: '2026-06-05', lastNudgeAt: null };
const evaluate = (overrides = {}) => evaluatePurchaseNudge({ ...base, ...overrides });
const prior = (id, minutes, mcc = '5651', amount = 10, localDate = base.localDate) => ({ ...purchase, id, mcc, amount, timestamp: now - minutes * 60000, localDate });

test('a daytime purchase under every threshold has no nudge', () => {
  assert.deepEqual(evaluate(), { shouldNudge: false, reasons: [] });
});
test('card-present purchases never nudge, including gambling', () => {
  assert.equal(evaluate({ purchase: { ...purchase, amount: 1000, cardNotPresent: false }, localHour: 23 }).shouldNudge, false);
  assert.equal(evaluate({ purchase: { ...purchase, mcc: '7995', cardNotPresent: false } }).shouldNudge, false);
});
test('categories not selected as discretionary are excluded', () => {
  assert.equal(evaluate({ settings: { ...settings, discretionaryCategories: [] }, localHour: 23 }).shouldNudge, false);
  assert.equal(evaluate({ purchase: { ...purchase, mcc: '5812', amount: 1000 }, localHour: 23 }).shouldNudge, false);
});
test('groceries, utilities, transport and pharmacy remain essential even if selected', () => {
  for (const [mcc, category] of [['5411', 'groceries'], ['4900', 'utilities'], ['4814', 'utilities'], ['4111', 'transport'], ['5912', 'pharmacy']]) {
    assert.equal(isDiscretionary(mcc, [category]), false);
    assert.deepEqual(evaluate({ purchase: { ...purchase, mcc, amount: 1000 }, settings: { ...settings, discretionaryCategories: [category] }, localHour: 23, history: [prior('a', 1), prior('b', 2)] }), { shouldNudge: false, reasons: [] });
  }
});
test('daily limit is cumulative across all completed purchases today', () => {
  const result = evaluate({ history: [prior('grocery', 20, '5411', 95)] });
  assert.deepEqual(result, { shouldNudge: true, reasons: ['daily_limit'] });
  assert.equal(evaluate({ history: [prior('yesterday', 20, '5411', 95, '2026-06-04')] }).shouldNudge, false);
});
test('daily limit is strict, cent-based, and can be unset', () => {
  assert.equal(evaluate({ settings: { ...settings, dailyLimit: 10 } }).shouldNudge, false);
  assert.equal(evaluate({ settings: { ...settings, dailyLimit: 9.99 } }).shouldNudge, true);
  assert.equal(evaluate({ settings: { ...settings, dailyLimit: null }, purchase: { ...purchase, amount: 44 } }).shouldNudge, false);
});
test('work-hour threshold is configurable and uses more-than, not equal-to', () => {
  assert.equal(evaluate({ purchase: { ...purchase, amount: 45 } }).shouldNudge, false);
  assert.deepEqual(evaluate({ purchase: { ...purchase, amount: 45.01 } }).reasons, ['work_hours']);
  assert.equal(evaluate({ purchase: { ...purchase, amount: 45.01 }, settings: { ...settings, workHoursThreshold: 4 } }).shouldNudge, false);
});
test('late-night includes 23:00 and excludes 05:00', () => {
  for (const localHour of [23, 23.99, 0, 4.99]) assert.deepEqual(evaluate({ localHour }).reasons, ['late_night']);
  for (const localHour of [5, 22.99]) assert.equal(evaluate({ localHour }).shouldNudge, false);
});
test('the pending purchase is the third in a discretionary burst', () => {
  assert.deepEqual(evaluate({ history: [prior('a', 60), prior('b', 10)] }).reasons, ['purchase_burst']);
  assert.equal(evaluate({ history: [prior('a', 60.001), prior('b', 10)] }).shouldNudge, false);
  assert.equal(evaluate({ history: [prior('a', 20), prior('b', 10, '5411')] }).shouldNudge, false);
  assert.equal(evaluate({ history: [prior('a', 20), prior('future', -1)] }).shouldNudge, false);
});
test('current purchase is not counted twice if present in history', () => {
  assert.equal(evaluate({ history: [prior('new', 0), prior('a', 10)] }).shouldNudge, false);
});
test('all applicable reasons are returned in predictable order', () => {
  assert.deepEqual(evaluate({ purchase: { ...purchase, amount: 150 }, localHour: 23, history: [prior('a', 5), prior('b', 10)] }).reasons, ['daily_limit', 'work_hours', 'late_night', 'purchase_burst']);
});
test('frequency cap suppresses nudge until exactly 30 minutes', () => {
  assert.deepEqual(evaluate({ localHour: 23, lastNudgeAt: now - NUDGE_COOLDOWN_MS + 1 }), { shouldNudge: false, reasons: [] });
  assert.equal(evaluate({ localHour: 23, lastNudgeAt: now }).shouldNudge, false);
  assert.equal(evaluate({ localHour: 23, lastNudgeAt: now - NUDGE_COOLDOWN_MS }).shouldNudge, true);
  assert.equal(evaluate({ localHour: 23, lastNudgeAt: now + 60000 }).shouldNudge, false);
});
test('online gambling always nudges despite cap and ordinary thresholds', () => {
  for (const mcc of ['7995', '7801', '7800', '7802']) assert.deepEqual(evaluate({ purchase: { ...purchase, mcc, amount: 1 }, lastNudgeAt: now }), { shouldNudge: true, reasons: ['gambling'] });
});
test('gambling still requires online and discretionary eligibility', () => {
  assert.equal(evaluate({ purchase: { ...purchase, mcc: '7801' }, settings: { ...settings, discretionaryCategories: ['clothing'] } }).shouldNudge, false);
});
test('hourly rate uses annualized weekly hours or a manual override', () => {
  assert.equal(calculateHourlyRate(2600), 15);
  assert.equal(calculateHourlyRate(2600, 20), 30);
  assert.equal(calculateHourlyRate(2600, 40, 18), 18);
  assert.throws(() => calculateHourlyRate(2600, 0), /positive/);
  assert.throws(() => calculateHourlyRate(2600, 40, -1), /positive/);
});
test('24-hour reminder unlocks at the exact deadline', () => {
  const waiting = { ...purchase, remindAt: now + REMINDER_DELAY_MS };
  assert.equal(canBuyWaitingPurchase(waiting, waiting.remindAt - 1), false);
  assert.equal(canBuyWaitingPurchase(waiting, waiting.remindAt), true);
});
test('nudge calculation is deterministic, does not mutate inputs and rejects invalid numbers', () => {
  const input = Object.freeze({ ...base, history: Object.freeze([Object.freeze(prior('a', 5))]) });
  assert.deepEqual(evaluatePurchaseNudge(input), evaluatePurchaseNudge(input));
  assert.throws(() => evaluate({ purchase: { ...purchase, amount: NaN } }), /amount/);
  assert.throws(() => evaluate({ settings: { ...settings, hourlyRate: 0 } }), /positive/);
  assert.throws(() => evaluate({ localHour: 24 }), /time/);
});
test('fixture has real MCCs for every merchant and merchant transaction, with both required demos', () => {
  const f = JSON.parse(readFileSync(new URL('../../mock/safe-to-spend.json', import.meta.url), 'utf8'));
  const merchants = new Map(f.merchants.map(merchant => [merchant.id, merchant]));
  assert.ok(f.merchants.every(merchant => /^\d{4}$/.test(merchant.mcc) && categoryForMcc(merchant.mcc) === merchant.category));
  assert.ok(f.transactions.every(tx => 'mcc' in tx && (tx.isIncome ? tx.mcc === null : merchants.get(tx.merchantId)?.mcc === tx.mcc)));
  const scenarios = f.purchaseScenarios.slice(0, 2).map(scenario => {
    const merchant = merchants.get(scenario.merchantId);
    return evaluate({ purchase: { ...purchase, merchantId: merchant.id, merchantName: merchant.name, mcc: merchant.mcc, amount: scenario.amount }, localHour: scenario.localHour });
  });
  assert.equal(scenarios[0].shouldNudge, true);
  assert.ok(scenarios[0].reasons.includes('late_night'));
  assert.equal(scenarios[1].shouldNudge, false);
});
