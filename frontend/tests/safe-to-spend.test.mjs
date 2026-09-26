import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateSafeToSpend, forecastBalance } from '../src/lib/safe-to-spend.ts';

const salary = { id: 'salary', name: 'Salary', amount: 2500, dayOfMonth: 25, type: 'income' };
const bill = (dayOfMonth, amount = 50, id = 'bill') => ({ id, name: id, amount, dayOfMonth, type: 'outflow' });
const calculate = (date, items = [salary], balance = 500, goals = [], buffer = 100) => calculateSafeToSpend(balance, items, goals, buffer, date);

test('deducts each pending bill, goals and buffer in cents, preserving input data', () => {
  const items = Object.freeze([Object.freeze(salary), Object.freeze(bill(12, 50.25))]);
  const goals = Object.freeze([Object.freeze({ id: 'goal', name: 'Holiday', monthlyReservation: 75.10 })]);
  const result = calculate('2026-06-05', items, 500, goals);
  assert.equal(result.safeToSpend, 274.65);
  assert.equal(result.dailyAllowance, 274.65 / 20);
  assert.equal(result.daysUntilIncome, 20);
  assert.equal(result.nextIncomeDate, '2026-06-25');
  assert.deepEqual(result.breakdown.map(item => [item.type, item.dueDate]), [['bill', '2026-06-12'], ['goal', '2026-06-05'], ['buffer', '2026-06-05']]);
  assert.deepEqual(calculate('2026-06-05', items, 500, goals), result);
});

test('income today reports zero days and a finite one-day allowance', () => {
  const result = calculate('2026-06-25', [salary, bill(25), bill(26)]);
  assert.equal(result.daysUntilIncome, 0);
  assert.equal(result.nextIncomeDate, '2026-06-25');
  assert.equal(result.safeToSpend, 400);
  assert.equal(result.dailyAllowance, 400);
  assert.equal(result.breakdown.filter(item => item.type === 'bill').length, 0);
});

test('income in next month includes next-month bills before payday', () => {
  const result = calculate('2026-06-26', [salary, bill(1, 100), bill(30, 50)]);
  assert.equal(result.nextIncomeDate, '2026-07-25');
  assert.equal(result.daysUntilIncome, 29);
  assert.equal(result.safeToSpend, 250);
  assert.deepEqual(result.breakdown.filter(item => item.type === 'bill').map(item => item.dueDate), ['2026-06-30', '2026-07-01']);
});

test('excludes bills after or on payday, includes bills today', () => {
  const result = calculate('2026-06-05', [salary, bill(5, 25, 'today'), bill(25, 75, 'payday'), bill(27, 100, 'later')]);
  assert.equal(result.safeToSpend, 375);
  assert.deepEqual(result.breakdown.filter(item => item.type === 'bill').map(item => item.id), ['today']);
});

test('moves the 31st to the 30th in a short month', () => {
  const result = calculate('2026-04-26', [salary, bill(31, 50)]);
  assert.equal(result.breakdown[0].dueDate, '2026-04-30');
});

test('clamps income on the 31st to month end without overflowing', () => {
  const monthEndSalary = { ...salary, dayOfMonth: 31 };
  assert.equal(calculate('2026-04-29', [monthEndSalary]).nextIncomeDate, '2026-04-30');
  assert.equal(calculate('2026-04-30', [monthEndSalary]).daysUntilIncome, 0);
  assert.equal(calculate('2026-02-27', [monthEndSalary]).nextIncomeDate, '2026-02-28');
  assert.equal(calculate('2028-02-28', [monthEndSalary]).nextIncomeDate, '2028-02-29');
});

test('handles year rollover and picks the earliest of multiple incomes', () => {
  const extraIncome = { ...salary, id: 'extra', dayOfMonth: 5 };
  const result = calculate('2026-12-26', [salary, extraIncome]);
  assert.equal(result.nextIncomeDate, '2027-01-05');
  assert.equal(result.daysUntilIncome, 10);
});

test('preserves negative safe spending and allowance; default buffer is 100', () => {
  const result = calculateSafeToSpend(50, [salary, bill(12, 60)], [], undefined, '2026-06-05');
  assert.equal(result.safeToSpend, -110);
  assert.equal(result.dailyAllowance, -5.5);
});

test('calendar day counts survive DST and Date arguments are not mutated', () => {
  const date = new Date(2026, 2, 20, 18, 30);
  const original = date.getTime();
  assert.equal(calculateSafeToSpend(500, [salary], [], 100, date).daysUntilIncome, 5);
  assert.equal(date.getTime(), original);
});

test('invalid data and missing income fail explicitly', () => {
  assert.throws(() => calculate('2026-06-05', []), /income/);
  assert.throws(() => calculate('2026-02-30'), /calendar date/);
  assert.throws(() => calculate('2026-06-05', [salary, bill(32)]), /Recurring day/);
  assert.throws(() => calculate('2026-06-05', [salary], NaN), /Balance/);
  assert.throws(() => calculate('2026-06-05', [salary], 500, [], -10), /Buffer/);
});

test('forecast applies current-day income and bills, then allowance, with lowest point', () => {
  const forecast = forecastBalance(100, [salary, bill(26, 200)], 10, '2026-06-25');
  assert.equal(forecast.points.length, 31);
  assert.equal(forecast.points[0].balance, 100);
  assert.equal(forecast.points[1].balance, 2590);
  assert.equal(forecast.points[2].balance, 2380);
  assert.equal(forecast.points.at(-1).date, '2026-07-24');
  assert.equal(forecast.points.at(-1).balance, 2100);
  assert.equal(forecast.lowestIndex, 0);
});

test('forecast finds a later negative trough and does not add money for negative allowance', () => {
  const forecast = forecastBalance(50, [salary, bill(31, 100)], -5, '2026-04-29');
  assert.equal(forecast.lowestPoint.date, '2026-04-30');
  assert.equal(forecast.lowestPoint.balance, -50);
  assert.equal(forecast.points[1].balance, 50);
  assert.equal(forecast.points.find(point => point.date === '2026-05-25').balance, 2450);
});

test('fractional allowance accumulates without rounding drift; preview leaves original unchanged', () => {
  assert.equal(forecastBalance(100, [], 1 / 3, '2026-06-05').points.at(-1).balance, 90);
  const before = calculate('2026-06-05');
  const preview = calculate('2026-06-05', [salary], 500 - 450);
  assert.equal(preview.safeToSpend, before.safeToSpend - 450);
  assert.equal(preview.dailyAllowance, -2.5);
  assert.equal(before.safeToSpend, 400);
});

test('demo covers 60 calendar days, 23 subscriptions and a reconciled EUR balance', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../mock/safe-to-spend.json', import.meta.url), 'utf8'));
  assert.equal((new Date(fixture.asOfDate) - new Date(fixture.historyStartDate)) / 86400000 + 1, 60);
  assert.equal(fixture.recurring.length - 5, 23);
  assert.ok(fixture.transactions.every(tx => tx.currency === 'EUR' && tx.date >= fixture.historyStartDate && tx.date <= fixture.asOfDate));
  const net = fixture.transactions.reduce((sum, tx) => sum + Math.round(tx.amount * 100) * (tx.isIncome ? 1 : -1), 0);
  assert.equal(Math.round(fixture.openingHistoryBalance * 100) + net, Math.round(fixture.balance * 100));
  let historicalBalance = Math.round(fixture.openingHistoryBalance * 100);
  for (const tx of [...fixture.transactions].reverse()) {
    historicalBalance += Math.round(tx.amount * 100) * (tx.isIncome ? 1 : -1);
    assert.ok(historicalBalance >= 0, `History should not rely on an unexplained overdraft: ${tx.date}, ${historicalBalance / 100}`);
  }
  const result = calculateSafeToSpend(fixture.balance, fixture.recurring, fixture.goals, 100, fixture.asOfDate);
  assert.ok(result.dailyAllowance > 0 && result.dailyAllowance < 20);
});
