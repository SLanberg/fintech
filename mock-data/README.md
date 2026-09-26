# fintech-mockdata

Reproducible, realistic-looking mock banking data for a European fintech prototype. It covers
customers, accounts, merchants and 12 months of transactions across 16 countries, plus
demo scenarios you can point at during a live demo.

```bash
python -m venv .venv && .venv/Scripts/activate          # Windows (use bin/activate on macOS/Linux)
pip install -r requirements.txt
python generate.py --config config.yaml                  # ~10 s for the default 300 customers
python -m pytest -q                                      # determinism + integrity tests
```

Overrides: `--seed 7`, `--customers 50`, `--end-date 2026-09-26`, `--out out/small`, `--no-validate`.

**Reproducibility:** the same seed and the same config (including `end_date`) produce byte-identical
files. `manifest.json` records SHA-256 hashes so you can confirm this. `end_date: today` rolls daily,
so pin a date before the demo. Package versions are pinned in `requirements.txt` because a Faker or
NumPy upgrade changes the output.

## Output (`out/`)

| file | what |
|---|---|
| `customers.csv` | id, type (individual/business), name, first/last name, trading_name, country, city, postcode, address, email, phone, date_of_birth *or* registration_number, created_at (UTC), timezone, language, segment (student/salaried/freelancer/retiree/small_business), sector |
| `accounts.csv` | id, customer_id, iban, bic, bank_name, currency, account_type (current/savings/business), balance, opening_balance, overdraft_limit, has_overdraft, opened_at, closed_at, status (active/closed) |
| `merchants.csv` | id, name, country, city, mcc, category, category_label, merchant_type (local/chain/online), owner_customer_id (café/retail customers are also merchants) |
| `transactions.csv` | id, account_id, customer_id, timestamp (UTC, `Z`), amount (>0), currency, direction (debit/credit), type, category, merchant_id (card), counterparty_name, counterparty_iban (transfers), counterparty_account_id (when the other side is in the dataset), reference, status (booked/pending/failed/reversed), status_reason, balance_after, original_amount / original_currency / fx_rate (foreign-currency card use), timezone (customer's IANA zone), scenario_tag |
| `scenarios.csv` | where to find each demo story: customer, account, IBAN, one-line detail, transaction ids |
| `manifest.json` | seed, period, row counts, file hashes, library versions, `demo` block from config |

`type` values: `card`, `atm`, `internal`, `sepa_credit_transfer`, `sepa_instant`, `sepa_direct_debit` for EUR
accounts, and `domestic_transfer`, `domestic_instant`, `domestic_direct_debit` for PLN/SEK/CZK accounts,
because those move on domestic rails, not SEPA.

**Balance semantics:** amounts are exact cents, and `balance_after` is computed sequentially per
account. Booked and pending rows move the balance. Failed and reversed rows don't, and they repeat
the previous balance. For every account, `opening_balance + Σ effects = balance`. A balance only goes
negative within an arranged `overdraft_limit`.

## What makes it look real

- **Geography:** Faker locale per country (with gendered surnames for CZ/PL/LV/LT), real city names
  with plausible postcodes, local street names and national mobile formats. BE is split into
  Dutch- and French-speaking cities. Currency is EUR in the eurozone and PLN/SEK/CZK in PL/SE/CZ, and
  40% of those customers also hold a EUR account.
- **IBANs:** country-correct structure with valid ISO 7064 check digits *and* national BBAN check
  digits (FR RIB key, ES, IT CIN, BE, EE, FI, PL, CZ, …), re-validated with schwifty. Bank codes and
  BICs belong to real mainstream banks (Sparkasse, ING, BNP, PKO, Swedbank, …) so BIC lookup works.
  Branch and account numbers are random.
- **Profiles:** students (parental allowance plus optional part-time job), salaried, freelancers
  (client invoices paid 14–45 days late, quarterly tax prepayments, SaaS, coworking), retirees
  (pension from the national pension body; weekly in IE), and small businesses (café/retail card
  settlements, invoice-driven consulting/construction/design, payroll, supplier invoices, VAT,
  corporate tax, rent).
- **Rhythm:** salaries on the 23rd–1st, moved to the previous business day. There are national
  13th/14th salaries (AT, ES, PT, IT, NL holiday pay, DE Christmas bonus) and raises in Jan/Apr/Jul.
  Rent goes out on the 1st–3rd by standing order. Utilities, telecom, insurance and gym are direct
  debits on fixed days, electricity has an annual settlement, and subscriptions charge on the day
  you signed up. Groceries happen 2–4×/week and nearly vanish on Sundays in DE/AT/PL. Bars and
  restaurants spike on Friday/Saturday, retail peaks in December, travel peaks in July/August.
- **Amounts:** log-normal per category, scaled by country price level and income, with realistic
  endings: 9.99/4.49 charm pricing, café prices to 10 cents, whole SEK/CZK, ATM notes. Each
  customer's spending rates are calibrated so outflow is about 90–99% of income. A balance-aware
  governor makes people spend less when they're broke, and most don't try a card payment they can't
  cover (15% try anyway and get declined).
- **Remittance texts** are in the local language: "Miete Mai 2026", "Loyer octobre 2025", "Czynsz za
  październik 2025", "Nájemné za říjen 2025", "Vuokra 10/2025", "Abschlag Strom Mai 2026 Kd-Nr. …".
- **Cross-border and multi-currency:** trips abroad (flights, booking platforms, hotels, local spend
  in the local currency with FX and a 1.25% markup), EUR top-ups before eurozone trips, and
  commuters with an employer abroad whose EUR salary is partly converted home.
- **Linked data:** about 30% of salaried customers work for a business customer in the dataset, so
  payroll debit and salary credit are both present. Freelancers and businesses also invoice each
  other, and customers send each other P2P payments. `counterparty_account_id` links the two legs.
- **Noise:** card declines and technical errors, authorization reversals, refunds 3–20 days later,
  pending card payments in the last 2 days, closed savings accounts, customers onboarded mid-year.

## Demo scenarios

Each scenario in `config.yaml` creates a *dedicated* customer, so adding or removing one never
changes the rest of the population. After generation, `scenarios.csv` lists them. It also lists
a few "showcase" rows pointing at naturally occurring examples: cross-border salary, an employee of a
dataset business, a closed savings account, a multi-currency traveller, and the business with the
most staff.

| type | options | story |
|---|---|---|
| `failed_payments` | country, profile, `month: YYYY-MM`, count | Salary and rent go out, surplus is moved away, then a €1.4–2.8k car repair empties the account, so direct debits and card payments fail (`insufficient_funds`) until the next salary |
| `fraud_burst` | country, `date: YYYY-MM-DD`, count | 2 a.m. card-testing micro-charges, then purchases in another country; the card is blocked after the 5th attempt (`card_blocked`) and the booked ones are charged back about a week later |
| `overdraft_user` | country, limit_x_income, overspend | Arranged overdraft; below zero most of the time |
| `subscription_creep` | country, profile | Nine digital subscriptions started over the last few months |
| `new_customer` | country, days_ago | Onboarded N days before `end_date` |

Leave `month`/`date` out and the scenario is placed relative to `end_date`, so it stays valid when
the period rolls.

## Adapting it

- **Product context:** fill in `demo.product` / `demo.extra_entities` in `config.yaml` (it's copied
  into the manifest).
- **Adding a scenario type:** add a branch in `mockgen/scenarios.py` (`build_scenarios` sets persona
  options before setup, `_post_setup` schedules the events) and a line in `scenario_index`.
- **Adding an entity** (for example invoices or loans): the simulation already produces the
  underlying flows (freelancer and business invoices, mortgage debits). Record them in a list on
  `World` where they're created in `mockgen/personas.py`, then emit a frame in `pipeline.to_frames`.
- **Brands:** `merchants.extra_brands: {category: [names]}` in config adds your own fictional chains.

Layout: `geo.py` (countries), `locale_text.py` (texts per language), `catalog.py` (categories, MCC,
brands, price rounding), `banking.py` (IBAN/BIC, registration numbers), `personas.py` (behaviour),
`world.py` (event heap and ledger), `scenarios.py`, `validate.py`, `output.py`.

## Privacy and legal notes

- **People are fictional:** names are Faker combinations of common first names and surnames. Emails
  use reserved `example.*` domains.
- **Accounts are random:** the account part of every IBAN is random, but it sits on a real bank code
  and passes validation. A random draw could in theory match an existing account. **Never send test
  payments to these IBANs.**
- **Brands are invented:** merchant, biller, employer and acquirer names are made up and checked
  against a blocklist of major real brands, but they were **not trademark-searched**.
- **Some names are real:** tax and pension payers use the real public authorities' names
  ("Finanzamt Köln", "ZUS", "Skatteverket"). Change them in `catalog.py` if you'd rather not.
- **Phones may be real:** phone numbers follow national mobile formats and may coincide with real
  numbers. Don't call or text them.
- **Simplifications:** no public holidays (weekends only), approximate FX rates, and payday/pension
  conventions are plausible rather than authoritative.
