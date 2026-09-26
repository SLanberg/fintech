// Deterministic 60-day EUR fixture. Run: node mock/generate-spending.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const categoryMapping = JSON.parse(readFileSync(new URL('./mcc-categories.json', import.meta.url), 'utf8'));

const asOfDate = '2026-06-05';
const recurring = [
  ['salary', 'Salary', 2600, 25, 'income'],
  ['rent', 'Rent', 850, 1, 'outflow'],
  ['electricity', 'Electricity', 78, 12, 'outflow'],
  ['phone', 'Phone', 19, 10, 'outflow'],
  ['internet', 'Internet', 29, 15, 'outflow'],
  ['netflix', 'Netflix', 13.99, 7, 'outflow'],
  ['gym', 'Gym', 29, 9, 'outflow'],
  ['icloud', 'iCloud storage', 2.99, 11, 'outflow'],
  ['spotify', 'Spotify', 10.99, 13, 'outflow'],
  ['youtube', 'YouTube Premium', 12.99, 16, 'outflow'],
  ['prime', 'Prime Video', 5.99, 18, 'outflow'],
  ['disney', 'Disney+', 8.99, 20, 'outflow'],
  ['dropbox', 'Dropbox', 9.99, 21, 'outflow'],
  ['notion', 'Notion', 8, 22, 'outflow'],
  ['todoist', 'Todoist', 4, 23, 'outflow'],
  ['headspace', 'Headspace', 5.99, 24, 'outflow'],
  ['strava', 'Strava', 5, 26, 'outflow'],
  ['audible', 'Audible', 7.99, 27, 'outflow'],
  ['kindle', 'Kindle Unlimited', 9.99, 28, 'outflow'],
  ['apple', 'Apple TV+', 6.99, 31, 'outflow'],
  ['google', 'Google One', 1.99, 6, 'outflow'],
  ['adobe', 'Adobe Photography', 11.99, 8, 'outflow'],
  ['patreon', 'Patreon', 3, 14, 'outflow'],
  ['newspaper', 'Digital newspaper', 4.99, 17, 'outflow'],
  ['language', 'Language learning', 5.99, 19, 'outflow'],
  ['passwords', 'Password manager', 2.99, 4, 'outflow'],
  ['vpn', 'VPN', 3.49, 3, 'outflow'],
  ['gaming', 'Gaming subscription', 8.99, 2, 'outflow'],
].map(([id, name, amount, dayOfMonth, type]) => ({ id, name, amount, dayOfMonth, type }));
const transactions = [];
const oneOffs = [
  ['2026-04-13', 'Annual home insurance', 155, 'Insurance'],
  ['2026-05-26', 'Replacement fridge', 880, 'Home'],
  ['2026-05-07', 'Dentist appointment', 180, 'Health'],
  ['2026-05-16', 'Summer holiday booking deposit', 280, 'Travel'],
  ['2026-05-20', 'Bicycle repair', 95, 'Transport'],
  ['2026-05-29', 'Train tickets', 59.90, 'Travel'],
  ['2026-06-02', 'Clothing & shoes', 68, 'Shopping'],
];
const anchor = new Date(`${asOfDate}T00:00:00Z`);
for (let offset = 59; offset >= 0; offset--) {
  const date = new Date(anchor.getTime() - offset * 86400000);
  const key = date.toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  // Today is an opening balance, so its scheduled items are still pending.
  if (offset > 0) for (const item of recurring) {
    if (Math.min(item.dayOfMonth, lastDay) === date.getUTCDate()) {
      transactions.push({ id: `${key}-${item.id}`, name: item.name, category: item.type === 'income' ? 'Salary' : 'Recurring', date: key, amount: item.amount, isIncome: item.type === 'income', currency: 'EUR' });
    }
  }
  if (offset > 0) transactions.push({ id: `${key}-everyday`, name: offset % 3 === 0 ? 'Rimi groceries' : offset % 3 === 1 ? 'Lunch & coffee' : 'Public transport & essentials', category: 'Everyday', date: key, amount: [27.8, 18.4, 11.2, 24.9, 16.5][offset % 5], isIncome: false, currency: 'EUR' });
  for (const [purchaseDate, name, amount, category] of oneOffs) {
    if (key === purchaseDate) transactions.push({ id: `${key}-one-off`, name, amount, category, date: key, isIncome: false, currency: 'EUR' });
  }
}
const balance = 840;
const merchants = [
  ['clothes-online', 'Norra Wear Online', '5651'], ['electronics-online', 'Voltara Electronics', '5732'],
  ['mobile-game', 'Pocket Quest Gems', '5816'], ['casino-online', 'Demo Online Casino', '7801'],
  ['groceries-online', 'Rimi Online Groceries', '5411'], ['restaurant', 'Pastaria Restaurant', '5812'],
  ['cinema', 'CineAstra Tickets', '7832'], ['utility', 'City Energy', '4900'],
  ['transport', 'City Transit', '4111'], ['pharmacy', 'Salvia Pharmacy', '5912'],
  ['housing', 'Paper Street Rentals', '6513'], ['insurance', 'Home Insurance', '6300'],
  ['dentist', 'City Dental', '8021'], ['travel', 'Stayvia Travel', '4722'],
  ['home', 'Nestwise Home', '5200'], ['services', 'Web Services', '7372'], ['books', 'Leafline Books', '5942'],
].map(([id, name, mcc]) => ({ id, name, mcc, category: categoryMapping.mccToCategory[mcc], cardNotPresent: true }));
const recurringMcc = {
  rent: '6513', electricity: '4900', phone: '4814', internet: '4816', gym: '7997',
  netflix: '4899', disney: '4899', prime: '4899', youtube: '4899', apple: '4899', spotify: '4899',
  audible: '5815', kindle: '5815', newspaper: '5815', gaming: '5816',
  adobe: '5734', notion: '5734', todoist: '5734', dropbox: '5734',
};
for (const tx of transactions) {
  const scheduled = recurring.find(item => tx.id.endsWith(`-${item.id}`));
  // Payroll is a bank transfer: it has the MCC field, but no merchant MCC.
  tx.mcc = tx.isIncome ? null : scheduled ? (recurringMcc[scheduled.id] ?? '5817') :
    ({ Insurance: '6300', Home: '5722', Health: '8021', Travel: tx.name === 'Train tickets' ? '4112' : '4722', Transport: '7699', Shopping: '5651' }[tx.category] ??
      (tx.name.includes('groceries') ? '5411' : tx.name.includes('coffee') ? '5812' : '4111'));
  tx.cardNotPresent = !!scheduled && !tx.isIncome;
  tx.timestamp = `${tx.date}T12:00:00+03:00`;
  tx.merchantId = tx.isIncome ? null : `history-${tx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (tx.merchantId && !merchants.some(merchant => merchant.id === tx.merchantId)) {
    merchants.push({ id: tx.merchantId, name: tx.name, mcc: tx.mcc, category: categoryMapping.mccToCategory[tx.mcc], cardNotPresent: tx.cardNotPresent });
  }
}
const net = transactions.reduce((sum, tx) => sum + (tx.isIncome ? tx.amount : -tx.amount), 0);
writeFileSync(new URL('./safe-to-spend.json', import.meta.url), JSON.stringify({
  asOfDate, historyStartDate: new Date(anchor.getTime() - 59 * 86400000).toISOString().slice(0, 10),
  currency: 'EUR', balance, openingHistoryBalance: Math.round((balance - net) * 100) / 100,
  note: 'Demo: four days after rent, with a moderately tight budget. Today uses the opening balance.',
  recurring, goals: [{ id: 'holiday', name: 'Summer holiday', targetAmount: 1200, monthlyReservation: 120 }],
  merchants,
  purchaseScenarios: [
    { id: 'late-clothing', name: 'Late-night clothing', merchantId: 'clothes-online', amount: 67.50, localHour: 23.5 },
    { id: 'day-groceries', name: 'Daytime groceries', merchantId: 'groceries-online', amount: 35, localHour: 14 },
    { id: 'electronics', name: 'Electronics', merchantId: 'electronics-online', amount: 180, localHour: 14 },
    { id: 'game', name: 'Mobile game purchase', merchantId: 'mobile-game', amount: 49.99, localHour: 14 },
    { id: 'casino', name: 'Online casino', merchantId: 'casino-online', amount: 10, localHour: 14 },
    { id: 'restaurant', name: 'Restaurant delivery', merchantId: 'restaurant', amount: 28, localHour: 19 },
  ],
  transactions: transactions.reverse(),
}, null, 2) + '\n');
