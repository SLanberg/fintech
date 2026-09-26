Safe to Spend demo
==================

Home starts with the local EUR fixture in `safe-to-spend.json`. It uses 5 June
2026, four days after rent, a €840 opening balance, 60 calendar days of history,
salary on the 25th, rent/utilities and 23 named subscriptions. The history’s
opening balance plus signed transactions reconciles to the current balance.
Regenerate it with `node mock/generate-spending.mjs`.

The home account toggle retains the existing live backend account. Live mode
uses the sample recurring plan/goals and clearly labels them as demo data.
Demo deposits/transfers only change React state and reset when reloading or
switching accounts. The purchase preview does not change account state.

Reusable calculation and forecast: `frontend/src/lib/safe-to-spend.ts`.
Calculation uses rounded EUR cents and calendar dates, avoiding DST drift.
Dates on the 31st move to the last day of shorter months. Pending bills today
count, while bills on/after payday do not. Income today yields zero days until
income and a one-day allowance divisor; income is not added to Safe to Spend
until it is part of the current balance. Missing income throws an explicit error.
Savings and buffer are earmarked today, with that reservation date in the
breakdown. The default buffer is €100 and can be configured in the card.

Forecast shows the opening point and 30 end-of-day balances, starting today.
It applies recurring income/outflows before daily estimated spending and holds
today’s daily allowance fixed over the horizon. Negative allowances remain
negative in the main card and purchase preview; the forecast uses zero
discretionary spending in that case to avoid inventing income. Goals/buffer
remain in the bank balance rather than being debited a second time.

Allowance colors are constants: green >= €20, amber >= €0 and < €20, red < €0.
The forecast has an accessible description and an expandable daily table.
No new dependencies. Tests use Node’s built-in runner and TypeScript stripping
(Node 22.18+ or 24): `npm test --prefix frontend`.
