"""Demo scenarios: dedicated customers engineered to exhibit a specific story.

Each configured scenario creates its own extra customer (so adding/removing a scenario never
reshuffles the base population). After the run, `scenario_index` returns rows telling the
presenter which customer/account/transactions to open. A few "showcase" rows point at organic
examples (cross-border commuter, employee paid by a dataset business, closed savings account, ...).
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np

from .catalog import CATEGORIES, round_price
from .locale_text import text
from .personas import Individual, next_bday

SCENARIO_IDX_BASE = 900_000


def _month_start(cfg_month: str | None, world, default_back: int) -> dt.date:
    if cfg_month:
        y, m = map(int, str(cfg_month).split("-")[:2])
        d = dt.date(y, m, 1)
    else:
        e = world.end
        y, m = e.year, e.month - default_back
        while m <= 0:
            m, y = m + 12, y - 1
        d = dt.date(y, m, 1)
    if not (world.start <= d <= world.end):
        raise ValueError(f"scenario month {d:%Y-%m} is outside the generated period {world.start}..{world.end}")
    return d


def build_scenarios(world, businesses_by_cc) -> list:
    specs = world.cfg.get("scenarios") or []
    personas = []
    for i, spec in enumerate(specs):
        kind = spec["type"]
        cc = spec.get("country") or world.cfg["countries"][0]
        if cc not in world.countries:
            raise ValueError(f"scenario {kind}: country {cc} not in configured countries")
        profile = spec.get("profile", "salaried")
        is_new = kind == "new_customer"
        p = Individual(world, SCENARIO_IDX_BASE + i, cc, profile, is_new)
        p.scenario = dict(spec, index=i)
        p.opts = {}
        if kind == "new_customer":
            days_ago = int(spec.get("days_ago", 10))
            p.created = world.end - dt.timedelta(days=days_ago)
            p.active_from = p.created
            p.cust["created_at"] = world.ts(p.created, "anytime", p.tz, p.rng)
        elif kind == "failed_payments":
            p.opts.update(no_savings=True, no_overdraft=True, bill_days=(6, 24), min_bills=int(spec.get("count", 3)),
                          opening_factor=0.3, car=True)
        elif kind == "overdraft_user":
            p.opts.update(no_savings=True, overdraft_factor=float(spec.get("limit_x_income", 1.2)),
                          opening_factor=0.1, rate_scale=float(spec.get("overspend", 1.35)))
        elif kind == "subscription_creep":
            p.tags.append("subscription_creep")
        elif kind == "fraud_burst":
            p.opts.update(opening_factor=1.5)
        elif kind != "new_customer":
            raise ValueError(f"unknown scenario type: {kind}")
        p.setup(businesses_by_cc)
        _post_setup(world, p, spec)
        personas.append(p)
    return personas


def _post_setup(world, p, spec):
    kind = spec["type"]
    if kind == "failed_payments":
        month = _month_start(spec.get("month"), world, 4)
        drain_day = next_bday(month + dt.timedelta(days=3))  # after rent, before the bills
        mids = world.brand_merchants.get((p.cc, "car_repair"), [])
        mid = mids[0] if mids else None
        m = world.merchant_by_id.get(mid) if mid else None
        remainder = int(round_price(12 * world.static_rate(p.ccy), "free", p.ccy, p.rng))

        repair_budget = int(round_price(float(p.rng.uniform(1400, 2800)) * world.static_rate(p.ccy), "free", p.ccy,
                                        p.rng))
        own_iban = world.new_iban(p.cc, p.rng)

        def park_surplus(d):  # earlier surplus moved to the customer's own account elsewhere (e.g. a broker)
            p.emit(d, p.primary, "debit", None, "sct", "anytime", cp_name=p.cust["name"], cp_iban=own_iban,
                   category="transfer", reference=text(p.lang, "own_transfer"), tag="scenario:failed_payments",
                   dyn=lambda a: max(0, a.balance - repair_budget - remainder))

        def drain(d):
            p.emit(d, p.primary, "debit", None, "card", "business", merchant_id=mid, category="car_repair",
                   cp_name=m["name"] if m else "Auto service", reference=p.card_descriptor(m, p.city.name) if m else "",
                   tag="scenario:failed_payments",
                   dyn=lambda a: max(0, a.balance - remainder) if a.balance - remainder > 15000 else 0)
        world.schedule(drain_day - dt.timedelta(days=2), park_surplus)
        world.schedule(drain_day, drain)
        p.scenario["_window"] = (month, _next_month(month))
    elif kind == "fraud_burst":
        day = dt.date.fromisoformat(str(spec["date"])) if spec.get("date") else world.end - dt.timedelta(days=20)
        count = int(spec.get("count", 8))
        world.schedule(day, lambda d: _fraud(world, p, d, count))
        p.scenario["_window"] = (day, day + dt.timedelta(days=14))
    elif kind == "overdraft_user":
        p.scenario["_window"] = (world.start, world.end + dt.timedelta(1))
    elif kind in ("subscription_creep", "new_customer"):
        p.scenario["_window"] = (world.start, world.end + dt.timedelta(1))


def _next_month(d):
    return dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def _fraud(world, p, d, count):
    """Two card-testing micro-charges, then larger purchases at foreign merchants in the middle of the
    night; the card is blocked after the 5th attempt; booked ones are charged back 6-10 days later."""
    rng = p.rng
    foreign = [c for c in world.countries if c != p.cc] or [p.cc]
    fcc = foreign[int(rng.integers(0, len(foreign)))]
    fcountry = world.countries[fcc]
    tz = p.tz
    t0 = world.ts(d, "batch", tz, rng, hms=(2, int(rng.integers(0, 50)), int(rng.integers(0, 60))))
    evs = []
    for k in range(count):
        if k < 2:
            cat = "gaming"
            mid = world.online_merchants["gaming"][0]
            price = int(rng.integers(100, 250))
            m_ccy = p.ccy
        else:
            cat = "electronics" if k % 2 else "clothing"
            pool = world.brand_merchants.get((fcc, cat)) or world.local_merchants.get((fcc, cat))
            mid = pool[int(rng.integers(0, len(pool)))]
            m_ccy = fcountry.currency
            eur = float(rng.lognormal(math.log(180), 0.5))
            price = round_price(eur * world.static_rate(m_ccy), "charm", m_ccy, rng)
        m = world.merchant_by_id[mid]
        amt, fx, orig = price, None, None
        if m_ccy != p.primary.currency:
            amt, fx = world.fx_convert(price, m_ccy, p.primary.currency, d, world.fx_markup)
            orig = price
        ts = t0 + dt.timedelta(minutes=int(k * rng.integers(2, 7)), seconds=int(rng.integers(0, 60)))
        force = ("failed", "card_blocked") if k >= 5 else None
        ev = world.event(ts=ts, acct=p.primary, direction="debit", amount=amt, ttype="card", merchant_id=mid,
                         category=cat, cp_name=m["name"], reference=p.card_descriptor(m, fcountry.cities[0].name),
                         orig_amount=orig, orig_ccy=m_ccy if orig else None, fx_rate=fx, force=force,
                         tag="scenario:fraud_burst")
        evs.append((ev, m))
    for ev, m in evs:
        later = d + dt.timedelta(days=int(rng.integers(6, 11)))
        world.event(ts=world.ts(later, "business", tz, rng), acct=p.primary, direction="credit", amount=None,
                    ttype="card", merchant_id=ev.merchant_id, category=ev.category, cp_name=m["name"],
                    reference=f"CHARGEBACK {ev.reference}", tag="scenario:fraud_burst",
                    dyn=lambda a, o=ev: o.amount if getattr(o, "status", None) in ("booked", "pending") else 0)


DESCRIPTIONS = {
    "failed_payments": "Large unplanned card payment drains the account; the month's direct debits then bounce "
                       "(status=failed, status_reason=insufficient_funds) until the next salary.",
    "fraud_burst": "Night-time card-testing micro-charges followed by foreign purchases; card blocked after the "
                   "5th attempt (card_blocked); booked ones charged back ~a week later. Rows tagged scenario:fraud_burst.",
    "overdraft_user": "Salaried customer with an arranged overdraft who overspends and lives below zero most months.",
    "subscription_creep": "Customer who signed up to many digital subscriptions over the last few months.",
    "new_customer": "Recently onboarded customer with only a few days/weeks of history.",
}


def scenario_index(world, scenario_personas, df_tx) -> list[dict]:
    rows = []
    for p in scenario_personas:
        spec = p.scenario
        kind = spec["type"]
        acct = p.primary
        w0, w1 = spec.get("_window", (world.start, world.end + dt.timedelta(1)))
        tx = df_tx[df_tx.account_id == acct.id]
        tx_w = tx[(tx.timestamp >= str(w0)) & (tx.timestamp < str(w1))]
        detail = ""
        ids = []
        if kind == "failed_payments":
            failed = tx_w[tx_w.status == "failed"]
            ids = failed.id.tolist()
            dd = failed[failed.type.str.contains("direct_debit|transfer")]
            detail = f"{len(failed)} failed payments in {w0:%Y-%m} ({len(dd)} direct debits/transfers)"
            if len(dd) < int(spec.get("count", 3)):
                detail += f" - WARNING: fewer than requested {spec.get('count', 3)}"
        elif kind == "fraud_burst":
            f = tx[tx.scenario_tag == "scenario:fraud_burst"]
            ids = f.id.tolist()
            detail = f"{(f.direction == 'debit').sum()} fraudulent attempts, {(f.status == 'failed').sum()} blocked, " \
                     f"{(f.direction == 'credit').sum()} chargebacks"
        elif kind == "overdraft_user":
            neg = (tx.balance_after < 0).mean() if len(tx) else 0
            detail = f"overdraft limit {acct.overdraft / 100:.2f} {acct.currency}; {neg:.0%} of rows end below zero; " \
                     f"min balance {tx.balance_after.min() if len(tx) else 0:.2f}"
        elif kind == "subscription_creep":
            s = tx[tx.category == "subscription"]
            detail = f"{s.merchant_id.nunique()} distinct subscriptions"
        elif kind == "new_customer":
            detail = f"onboarded {p.created}, {len(tx)} transactions"
        rows.append(dict(scenario=spec.get("name", kind), type=kind, description=DESCRIPTIONS[kind],
                         customer_id=p.cust["id"], customer_name=p.cust["name"], account_id=acct.id,
                         iban=acct.iban, detail=detail, transaction_ids=";".join(ids)))
    return rows


def showcase_index(world) -> list[dict]:
    rows = []

    def add(kind, desc, p, acct=None, detail=""):
        rows.append(dict(scenario=f"showcase:{kind}", type="showcase", description=desc, customer_id=p.cust["id"],
                         customer_name=p.cust["name"], account_id=(acct or p.primary).id, iban=(acct or p.primary).iban,
                         detail=detail, transaction_ids=""))

    ind = [p for p in world.personas if p.kind == "individual" and not hasattr(p, "scenario")]
    biz = [p for p in world.personas if p.kind == "business"]
    p = next((p for p in ind if "cross_border_salary" in p.tags), None)
    if p:
        add("cross_border_salary", "Salary paid in EUR from an employer in another country; for non-euro "
            "customers most of it is converted into the home-currency account.", p, p.eur_acct or p.primary,
            detail=f"lives in {p.cc}, employer IBAN from another country")
    p = next((p for p in ind if p.employer is not None), None)
    if p:
        add("linked_employer", "Employee whose salary comes from a business customer in this dataset "
            "(both legs present, counterparty_account_id links them).", p,
            detail=f"employer {p.employer.cust['id']} {p.employer.cust['name']}")
    p = next((p for p in ind if p.savings is not None and p.savings.closed), None)
    if p:
        add("closed_savings", "Savings account closed during the period; balance swept to the current account.",
            p, p.savings, detail=f"closed {p.savings.closed}")
    p = next((p for p in ind if p.eur_acct is not None and p.trips), None)
    if p:
        add("multi_currency_traveller", "Non-euro customer with a EUR account topped up before trips; card spend "
            "abroad shows original_amount/original_currency/fx_rate.", p, p.eur_acct,
            detail=f"{len({v[0] for v in p.trips.values()})} destination(s), {len(p.trips)} days abroad")
    if biz:
        b = max(biz, key=lambda b: len(b.linked))
        add("business_with_staff", f"{b.sector} business paying payroll, suppliers, VAT and rent", b,
            detail=f"{b.n_employees} employees ({len(b.linked)} are customers in this dataset)")
    return rows
