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

Settings and online payment nudges
---------------------------------

The Settings screen lets the user create/edit/delete savings goals (name,
target and monthly reservation), choose their own daily limit, and configure
net monthly income, weekly working hours (default 40), an optional manual
hourly rate and a work-hour threshold (default 3). Hourly rate is net monthly
income divided by weekly hours × 52 / 12. Income settings value working time;
the existing recurring income schedule continues to determine payday.
The personal limit starts unset and is shown beside the calculated allowance.
An unaffordable limit generates a warning. The buffer control is preserved.

`frontend/src/lib/purchase-nudge.ts` contains the pure nudge rules. Category
mapping lives in `mcc-categories.json`; codes are based on Visa’s Merchant Data
Standards Manual:
https://usa.visa.com/dam/VCOM/download/merchants/visa-merchant-data-standards-manual.pdf
Every fixture merchant has an MCC, and every transaction has the MCC field.
Payroll/bank transfers use null because no merchant is involved. The Python
generator also exports merchant MCCs on transactions; merchants already had MCCs.

Online and discretionary eligibility are mandatory. Groceries, utilities,
transport and pharmacy cannot be marked discretionary, including by malformed
saved settings. Defaults are clothing, electronics, digital goods and gambling.
Ordinary nudges require exceeding the cumulative daily limit, exceeding the
work-hour threshold, local time >=23:00 or <05:00, or a third discretionary
purchase within 60 minutes (including the current attempt). History consists
of confirmed purchases; cancelled/deferred attempts do not count. The daily
limit includes all confirmed purchases that day, even essential purchases.
Eligible online gambling always nudges and bypasses the 30-minute cap. Gambling
still obeys online/discretionary eligibility. Every displayed nudge updates the
cap, even when cancelled or deferred. Cooldown expires exactly at 30 minutes.

In `next dev`, Home’s Demo controls simulate the 3-D Secure confirmation flow.
Late-night clothing (23:30, €67.50 = 4.5 work hours at the default rate) prompts;
daytime groceries do not. Electronics, a mobile game, casino and restaurant
scenarios are included. The native modal shows merchant, amount, work hours,
plain-language reasons and current Safe to Spend before/after the purchase.
Buy records a local demo transaction and debits the demo balance once. Cancel
does not spend money. Remind moves the purchase to Home’s Waiting list without
reserving funds. Buy is disabled until the full 24 hours have elapsed; an
unlocked purchase goes through a new confirmation using current settings.
Dismiss removes the entry. A development-only clock advance demonstrates expiry.

Preferences, goals, waiting purchases, confirmed demo purchases and last nudge
time are saved in localStorage on this device (`fintech.safe-spend.v2`). Restored
values are validated. If storage is unavailable, the app continues with a
visible session-only notice. Saved purchases reconcile the persisted demo debit
after reload. Demo controls never send real card payments and are hidden in
production. The fixture’s budget date stays fixed; demo payment time and reminder
deadlines use the browser clock, with scenario-specific local hours for nudges.
