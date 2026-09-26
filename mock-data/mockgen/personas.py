"""Customers, accounts and behavioural profiles (student, salaried, freelancer, retiree, small business).

Each persona schedules its recurring flows (salary, rent, bills, subscriptions, taxes, invoices) on
the world calendar at setup and generates stochastic card/ATM/P2P activity day by day. Spending
rates are calibrated so expected monthly outflow ~= 90-99% of income, and a balance-aware
governor damps discretionary spending when money is short.
"""
from __future__ import annotations

import calendar
import datetime as dt
import math

import numpy as np

from . import geo
from .banking import make_id, registration_number
from .catalog import (ACQUIRER, BILLERS, CATEGORIES, PENSION_PAYER, SAAS, SEASON, SUBSCRIPTIONS, TAX_AUTHORITY, WD,
                      round_price)
from .locale_text import BUSINESS_SUFFIX, LOCAL_MERCHANT_TPL, T, text
from .merchants import add_business_merchant
from .world import Account, ascii_fold

CATS = ["groceries", "bakery", "cafe", "fast_food", "restaurant", "bar", "fuel", "public_transport", "taxi",
        "pharmacy", "clothing", "electronics", "home_diy", "books", "marketplace", "food_delivery", "cinema",
        "hair_beauty", "parking", "charity", "gaming", "attractions", "office_supplies", "atm", "p2p"]
CI = {c: i for i, c in enumerate(CATS)}
ESSENTIAL = np.array([c in ("groceries", "bakery", "pharmacy", "public_transport", "fuel") for c in CATS])
SHOP_CATS = np.array([c in ("groceries", "clothing", "electronics", "home_diy", "books", "pharmacy") for c in CATS])


def _wd(c):
    key = CATEGORIES[c].weekday if c in CATEGORIES else "flat"
    v = np.array(WD[key], dtype=float)
    return v / v.mean()


def _season(c):
    key = CATEGORIES[c].season if c in CATEGORIES else "flat"
    return np.array(SEASON[key], dtype=float)


WDM = np.stack([_wd(c) for c in CATS])        # [cat, dow]
SEAS = np.stack([_season(c) for c in CATS])   # [cat, month]

BASE_RATES = {  # events per month
    "salaried": dict(groceries=11, bakery=5, cafe=6, fast_food=3.5, restaurant=2.5, bar=1.8, fuel=3.5,
                     public_transport=6, taxi=0.7, pharmacy=1.5, clothing=1.1, electronics=0.3, home_diy=0.8, books=0.4,
                     marketplace=2.5, food_delivery=1.4, cinema=0.5, hair_beauty=0.7, parking=1.5, charity=0.1,
                     gaming=0.2, attractions=0.2, atm=1.0, p2p=1.3),
    "student": dict(groceries=9, bakery=3, cafe=7, fast_food=6, restaurant=1, bar=3.5, fuel=0.5, public_transport=8,
                    taxi=0.5, pharmacy=0.8, clothing=0.9, electronics=0.2, home_diy=0.2, books=0.7, marketplace=2,
                    food_delivery=2.8, cinema=0.8, hair_beauty=0.3, parking=0.1, charity=0.02, gaming=0.6,
                    attractions=0.2, atm=0.8, p2p=2.5),
    "freelancer": dict(groceries=10, bakery=5, cafe=9, fast_food=3, restaurant=3, bar=1.8, fuel=3, public_transport=6,
                       taxi=1.1, pharmacy=1.3, clothing=1.0, electronics=0.4, home_diy=0.7, books=0.6, marketplace=3,
                       food_delivery=2, cinema=0.6, hair_beauty=0.6, parking=1.5, charity=0.1, gaming=0.2,
                       attractions=0.2, office_supplies=0.6, atm=0.8, p2p=1.3),
    "retiree": dict(groceries=15, bakery=9, cafe=3, fast_food=0.8, restaurant=2, bar=0.5, fuel=2, public_transport=3,
                    taxi=0.5, pharmacy=4, clothing=0.8, electronics=0.15, home_diy=1.1, books=0.8, marketplace=0.8,
                    food_delivery=0.2, cinema=0.3, hair_beauty=1.0, parking=0.8, charity=0.4, attractions=0.3,
                    atm=1.4, p2p=0.6),
}
AMOUNT_MULT = {"student": 0.7, "salaried": 1.0, "freelancer": 1.0, "retiree": 0.85}
HOME_KEEP = np.array([{"groceries": .1, "bakery": .05, "electronics": .3, "books": .3, "marketplace": .5,
                       "charity": 1, "gaming": 1, "p2p": .5}.get(c, 0.0) for c in CATS])
TRAVEL_VEC = np.array([{"restaurant": 1.1, "cafe": 1.0, "bar": .5, "attractions": .5, "groceries": .35,
                        "public_transport": .9, "taxi": .3, "fast_food": .4, "clothing": .12, "pharmacy": .05,
                        "bakery": .3, "atm": .08}.get(c, 0.0) for c in CATS])
REFUNDABLE = {"clothing", "electronics", "marketplace", "home_diy"}
ATM_NOTES = {"EUR": [20, 50, 50, 100, 100, 150, 200, 250, 300], "PLN": [50, 100, 100, 200, 200, 300, 500],
             "SEK": [200, 300, 500, 500, 1000], "CZK": [300, 500, 1000, 1000, 2000, 3000, 5000]}
PAYDAY = {"NL": [25], "SE": [25], "DE": ["last", 28, 30], "AT": ["last", 28], "FR": ["last", 28],
          "BE": ["last", 28], "ES": ["last", 30, 28], "PT": ["last", 28, 25], "IT": [27, 27, 28],
          "IE": [25, "last", 28], "FI": ["last", 28], "PL": ["last", 28, "next1", "next1"],
          "CZ": ["next1", "last", 25], "EE": ["next1", "last", 25], "LV": ["next1", "last", 25],
          "LT": ["last", 25, "next1"]}
BONUS_MONTHS = {"AT": {6: 1.0, 11: 1.0}, "ES": {6: 1.0, 12: 1.0}, "PT": {6: 1.0, 11: 1.0}, "IT": {12: 1.0},
                "DE": {11: 0.6}, "BE": {12: 0.9}, "NL": {5: 0.96}, "FR": {12: 0.5}, "IE": {12: 0.3}}
PENSION_DAY = {"DE": "last", "AT": 1, "FR": 9, "NL": 23, "ES": 25, "IT": 1, "PL": [1, 5, 10, 15, 20, 25], "EE": 5,
               "LV": 8, "LT": 15, "FI": 7, "IE": "weekly", "BE": "last", "PT": 8, "SE": 18,
               "CZ": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]}


# ----------------------------------------------------------------- date helpers
def months_in(start: dt.date, end: dt.date):
    y, m = start.year, start.month
    out = []
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def day_of(y, m, spec):
    last = calendar.monthrange(y, m)[1]
    if spec == "last":
        return dt.date(y, m, last)
    if spec == "next1":  # paid on the 1st of the following month
        return dt.date(y + (m == 12), m % 12 + 1, 1)
    return dt.date(y, m, min(int(spec), last))


def prev_bday(d):
    while d.weekday() >= 5:
        d -= dt.timedelta(1)
    return d


def next_bday(d):
    while d.weekday() >= 5:
        d += dt.timedelta(1)
    return d


def minor(x: float) -> int:
    return int(round(x * 100))


# ----------------------------------------------------------------- base
class Persona:
    kind = "individual"

    def __init__(self, world, idx: int, cc: str, is_new: bool):
        self.world = world
        self.idx = idx
        self.rng = np.random.default_rng([world.seed, 100, idx])
        self.country = world.countries[cc]
        self.cc = cc
        self.city = geo.pick_city(self.country, self.rng)
        self.lang = geo.city_lang(self.country, self.city)
        self.tz = self.country.tz
        self.ccy = self.country.currency
        self.pl = self.country.price_level
        self.is_new = is_new
        self.tags: list[str] = []
        self.accounts: list[Account] = []
        self.primary: Account | None = None
        self.savings: Account | None = None
        self.eur_acct: Account | None = None
        self.tax_monthly = 0  # minor units, primary ccy, for calibration
        self._bank = None
        s, e = world.start, world.end
        if is_new:
            self.created = s + dt.timedelta(int(self.rng.integers(20, max(21, (e - s).days - 7))))
        else:
            self.created = s - dt.timedelta(int(self.rng.integers(30, 6 * 365)))
        self.active_from = max(self.created, s)
        self.months = months_in(s, e)

    # --- utilities
    def ttype(self, acct, kind):
        return self.world.ttype(acct.currency, kind) if kind in ("sct", "inst", "dd") else kind

    def local_amount(self, eur: float, ccy: str | None = None) -> float:
        return eur * self.world.static_rate(ccy or self.ccy)

    def emit(self, d, acct, direction, amount, kind, hours="batch", tz=None, **kw):
        ts = self.world.ts(d, hours, tz or acct.tz, self.rng)
        return self.world.event(ts=ts, acct=acct, direction=direction, amount=amount, ttype=self.ttype(acct, kind), **kw)

    def open_account(self, kind, ccy, opened, opening_eur, overdraft_minor=0) -> Account:
        w = self.world
        if self._bank is None:  # all of a customer's accounts sit at the same bank
            self._bank = w.iban.pick_bank(self.cc, self.rng)
        iban, bic, bank = w.iban.generate(self.cc, self.rng, bank=self._bank)
        acct = Account(id=make_id("acc", w.seed, len(w.accounts) + 1, 12), customer_id=self.cust["id"],
                       owner_name=self.cust["name"], iban=iban, bic=bic, bank_name=bank, currency=ccy, kind=kind,
                       balance=0, opening_balance=0, overdraft=overdraft_minor, opened=opened, closed=None,
                       status="active", country=self.cc, tz=self.tz, persona=self)
        opening_minor = minor(self.local_amount(opening_eur, ccy))
        if opened < w.start:
            acct.balance = acct.opening_balance = opening_minor
        else:
            self._initial_funding(acct, opened, opening_minor)
        w.accounts[acct.id] = acct
        self.accounts.append(acct)
        return acct

    def _initial_funding(self, acct, opened, amount):
        w = self.world
        if acct.kind == "current" or acct.kind == "business" or self.primary is None:
            own_iban = w.new_iban(self.cc, self.rng)
            w.schedule(opened, lambda d, a=acct, amt=amount, ib=own_iban: self.emit(
                d, a, "credit", amt, "sct", "day", cp_name=self.cust["name"], cp_iban=ib, category="transfer",
                reference=text(self.lang, "initial")))
        else:  # savings / EUR account funded from primary
            src = self.primary
            def fund(d, a=acct, amt=amount):
                if src.currency == a.currency:
                    self.emit(d, src, "debit", None, "internal", "anytime", cp_acct=a, cp_name=self.cust["name"],
                              cp_iban=a.iban, category="transfer", reference=text(self.lang, "own_transfer"),
                              dyn=lambda acc, amt=amt: min(amt, max(0, acc.balance // 3)))
                else:
                    self.fx_transfer(d, src, a, amt)
            w.schedule(opened, fund)

    def fx_transfer(self, d, src: Account, dst: Account, dst_amount: int, key="fx"):
        """Internal currency exchange between own accounts (0.5% spread)."""
        w = self.world
        rate_src_per_dst = w.fx[d][src.currency] / w.fx[d][dst.currency] * 1.005
        src_amount = int(round(dst_amount * rate_src_per_dst))
        self.emit(d, src, "debit", src_amount, "internal", "anytime", cp_acct=dst, mirror_amount=dst_amount,
                  cp_name=self.cust["name"], cp_iban=dst.iban, category="transfer",
                  reference=text(self.lang, key, cur=f"{src.currency}/{dst.currency}"),
                  fx_rate=round(dst_amount / src_amount, 6))

    def schedule_monthly(self, spec, fn, adjust="after", start_after=None):
        for (y, m) in self.months:
            d = day_of(y, m, spec)
            d = next_bday(d) if adjust == "after" else prev_bday(d) if adjust == "before" else d
            if d >= (start_after or self.active_from):
                self.world.schedule(d, lambda day, ref=dt.date(y, m, 1): fn(day, ref))

    def biller(self, kind: str, brand: str):
        suffix = BUSINESS_SUFFIX[self.cc][0]
        return self.world.shared_counterparty(f"{kind}:{brand}", self.cc, f"{brand} {suffix}")

    def bill(self, key, kind, amount_minor, day, brand, acct=None, months=None):
        """Recurring bill paid by direct debit (or by transfer in PL)."""
        acct = acct or self.primary
        name, iban = self.biller(kind, brand)
        cust_no = str(int(self.rng.integers(10**6, 10**9)))
        self._bill_refs = getattr(self, "_bill_refs", {})
        self._bill_refs.setdefault(key, cust_no)
        pay_kind = "sct" if self.cc == "PL" else "dd"
        hours = "anytime" if pay_kind == "sct" else "batch"

        def fn(d, ref, acct=acct):
            if months and ref.month not in months:
                return
            if acct.opened > d:
                return
            self.emit(d, acct, "debit", amount_minor, pay_kind, hours, cp_name=name, cp_iban=iban, category=kind,
                      reference=text(self.lang, key, ref, cust=cust_no))
        self.schedule_monthly(day, fn, "after", start_after=acct.opened if acct.opened > self.active_from else None)
        return amount_minor if not months else amount_minor * len(months) // 12

    def card_descriptor(self, m, city):
        if m["merchant_type"] == "online":
            code = "".join("ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[int(i)] for i in self.rng.integers(0, 32, 6))
            return f"{m['name'].upper()}*{code}"
        return f"{m['name'].upper()} {(m['city'] or city).upper()}"[:34]


# ----------------------------------------------------------------- individuals
class Individual(Persona):
    def __init__(self, world, idx, cc, profile, is_new):
        super().__init__(world, idx, cc, is_new)
        self.profile = profile
        rng = self.rng
        first, last, gender = world.person_name(cc, self.lang, rng)
        self.first, self.last, self.gender = first, last, gender
        age = {"student": (18, 27), "salaried": (23, 64), "freelancer": (24, 62), "retiree": (65, 88)}[profile]
        dob = world.end - dt.timedelta(days=int(rng.integers(age[0] * 365, age[1] * 365 + 364)))
        domain = world.cfg["email_domains"][int(rng.integers(0, len(world.cfg["email_domains"])))]
        sep = [".", "_", ""][int(rng.integers(0, 3))]
        suffix = str(int(rng.integers(1, 99))) if rng.random() < 0.5 else (str(dob.year)[2:] if rng.random() < .5 else "")
        email = f"{ascii_fold(first)}{sep}{ascii_fold(last)}{suffix}@{domain}"
        postcode = geo.fill_pattern(self.city.postcode, rng)
        created_ts = world.ts(self.created, "anytime", self.tz, rng)
        self.cust = dict(id=make_id("cus", world.seed, idx, 12), type="individual", name=f"{first} {last}",
                         first_name=first, last_name=last, country=cc, city=self.city.name, postcode=postcode,
                         address=geo.make_address(self.country, self.city, rng), email=email,
                         phone=geo.make_phone(self.country, rng), date_of_birth=dob.isoformat(),
                         registration_number=None, created_at=created_ts, timezone=self.tz, language=self.lang,
                         segment=profile, sector=None)
        # income (EUR equivalent, monthly net)
        med = self.country.net_salary_eur
        if profile == "salaried":
            self.income = med * float(rng.lognormal(0, 0.35))
        elif profile == "freelancer":
            self.income = med * 1.2 * float(rng.lognormal(0, 0.45))
        elif profile == "retiree":
            self.income = med * 0.62 * float(rng.lognormal(0, 0.3))
        else:
            self.income = 0.0  # computed from allowance/job below
        self.car = rng.random() < {"student": 0.15, "salaried": 0.65, "freelancer": 0.55, "retiree": 0.5}[profile]
        self.household = 1 if profile == "student" else int(rng.choice([1, 2, 2, 3, 4]))
        self.friends: list = []
        self.trips: dict[dt.date, tuple] = {}
        self.overdraft_flag = False
        self.employer = None
        self.opts: dict = {}  # scenario overrides

    # --------------------------------------------------------------- setup
    def setup(self, businesses_by_cc):
        w, rng, cfg = self.world, self.rng, self.world.cfg
        acfg, bcfg = cfg["accounts"], cfg["behaviour"]
        prof = self.profile
        if prof == "student":
            allowance = float(rng.uniform(250, 600)) * self.pl
            job = float(rng.uniform(350, 850)) * self.pl if rng.random() < 0.5 else 0.0
            self.income = allowance + job
            self._allowance, self._job = allowance, job
        opts = self.opts
        if opts.get("car"):
            self.car = True
        od = 0
        od_factor = opts.get("overdraft_factor")
        if od_factor is None and prof in ("salaried", "freelancer") and not opts.get("no_overdraft")                 and rng.random() < acfg["overdraft_share"]:
            od_factor = float(rng.uniform(0.5, 1.5))
        if od_factor:
            od = minor(round(self.local_amount(self.income * od_factor), -2))
            self.overdraft_flag = True
        opening = self.income * {"student": rng.uniform(.3, 2), "salaried": rng.uniform(.5, 3),
                                 "freelancer": rng.uniform(1, 4), "retiree": rng.uniform(2, 8)}[prof]
        if "opening_factor" in opts:
            opening = self.income * opts["opening_factor"]
        self.primary = self.open_account("current", self.ccy, self.created, float(opening), od)
        if not opts.get("no_savings") and rng.random() < acfg["savings_share"] * (0.4 if prof == "student" else 1.0):
            opened = self._later_open()
            self.savings = self.open_account("savings", self.ccy, opened, self.income * float(rng.uniform(1, 12)))
            if rng.random() < acfg["closed_savings_share"] and opened < w.end - dt.timedelta(60):
                self._close_savings_later()
        if self.ccy != "EUR" and rng.random() < acfg["eur_account_share_non_euro"]:
            self.eur_acct = self.open_account("current", "EUR", self._later_open(), float(rng.uniform(50, 1500)))

        self._setup_income(businesses_by_cc, bcfg)
        fixed = self._setup_housing()
        fixed += self._setup_bills()
        fixed += self._setup_subscriptions()
        fixed += self._setup_savings()
        travel = self._setup_trips(bcfg)
        self._setup_rates(fixed, travel)

    def _later_open(self):
        rng, w = self.rng, self.world
        if rng.random() < 0.8 and not self.is_new:
            span = max(1, (w.start - self.created).days)
            return self.created + dt.timedelta(int(rng.integers(0, span)))
        lo = max(self.active_from, w.start)
        return lo + dt.timedelta(int(rng.integers(0, max(1, (w.end - lo).days - 30))))

    def _close_savings_later(self):
        w, acct = self.world, self.savings
        lo = max(acct.opened, w.start) + dt.timedelta(30)
        close = lo + dt.timedelta(int(self.rng.integers(0, max(1, (w.end - lo).days - 5))))

        def close_fn(d, a=acct):
            self.emit(d, a, "debit", None, "internal", "day", cp_acct=self.primary, cp_name=self.cust["name"],
                      cp_iban=self.primary.iban, category="transfer", reference=text(self.lang, "own_transfer"),
                      dyn=lambda acc: acc.balance if acc.balance > 0 else 0)
            a.closed = d  # takes effect for events after today
            a.status = "closed"
        w.schedule(close, close_fn)

    # income ---------------------------------------------------------
    def _setup_income(self, businesses_by_cc, bcfg):
        rng, w = self.rng, self.world
        prof = self.profile
        if prof in ("salaried",) or (prof == "student" and self._job):
            net = self.income if prof == "salaried" else self._job
            dest = self.primary
            employer_cc = self.cc
            if prof == "salaried" and rng.random() < bcfg["cross_border_employer_share"] and self.cc in (
                    "AT", "BE", "NL", "FR", "CZ", "PL", "EE", "LV", "LT"):
                employer_cc = {"AT": "DE", "BE": "NL", "NL": "DE", "FR": "BE", "CZ": "DE", "PL": "DE", "EE": "FI",
                               "LV": "EE", "LT": "LV"}[self.cc]
                if employer_cc not in w.countries:
                    employer_cc = self.cc
                if self.ccy != "EUR":
                    if self.eur_acct is None:
                        self.eur_acct = self.open_account("current", "EUR", self.primary.opened, 200.0)
                    dest = self.eur_acct
                self.tags.append("cross_border_salary")
            linked = None
            if prof == "salaried" and employer_cc == self.cc and rng.random() < bcfg["linked_employer_share"]:
                cands = [b for b in businesses_by_cc.get(self.cc, []) if b.primary.currency == dest.currency
                         and len(b.linked) < b.n_employees]
                if cands:
                    linked = cands[int(rng.integers(0, len(cands)))]
            if linked is not None:  # wage set by the employer's pay scale
                net = self.income = linked.avg_net_eur * float(rng.lognormal(0, 0.15))
            pay_ccy = dest.currency
            amount = minor(self.local_amount(net, pay_ccy)) + int(rng.integers(0, 100))
            if linked is not None:
                linked.linked.append(self)
                self.employer = linked
                pay_spec = linked.pay_spec
                name = linked.cust["name"]
            else:
                sector = "tech" if rng.random() < 0.5 else ["consulting", "retail", "construction", "wholesale"][
                    int(rng.integers(0, 4))]
                lang = w.countries[employer_cc].lang
                name = w.company_name(employer_cc, lang, rng, sector)
                iban = w.new_iban(employer_cc, rng)
                opts = PAYDAY.get(employer_cc, [25, "last"])
                pay_spec = opts[int(rng.integers(0, len(opts)))]
            raise_month = int(rng.choice([1, 4, 7])) if rng.random() < 0.7 else None
            raise_pct = float(rng.uniform(0.015, 0.06))
            bonus = BONUS_MONTHS.get(employer_cc, {}) if rng.random() < 0.75 else {}
            self.monthly_income_minor = int(amount * (1 + sum(bonus.values()) / 12))
            state = {"amount": amount}

            def pay(d, ref, dest=dest):
                if d < dest.opened:
                    return
                if raise_month and ref.month == raise_month and ref > self.world.start:
                    state["amount"] = int(state["amount"] * (1 + raise_pct))
                amt = int(state["amount"] * (1 + bonus.get(ref.month, 0)))
                reference = text(self.lang if employer_cc == self.cc else w.countries[employer_cc].lang, "salary", ref)
                if linked is not None:
                    linked.pay_employee(d, self, amt, reference)
                else:
                    self.emit(d, dest, "credit", amt, "sct", "batch", cp_name=name, cp_iban=iban, category="salary",
                              reference=reference)
                    if dest is not self.primary:  # move most of the EUR salary into the home-currency account
                        conv = int(amt * float(self.rng.uniform(0.6, 0.9)))
                        rate = w.fx[d][self.primary.currency]
                        w.schedule(d + dt.timedelta(int(self.rng.integers(1, 4))), lambda dd, a=conv: self.fx_transfer(
                            dd, dest, self.primary, int(a * rate)))
            self.schedule_monthly(pay_spec, pay, "before")
        if prof == "student":
            parent_first, _, _ = w.person_name(self.cc, self.lang, rng)
            parent_iban = w.new_iban(self.cc, rng)
            amt = round(self.local_amount(self._allowance) / 10) * 10 * 100
            day = int(rng.integers(1, 4))
            self.schedule_monthly(day, lambda d, ref: self.emit(
                d, self.primary, "credit", amt, "sct", "batch", cp_name=f"{parent_first} {self.last}",
                cp_iban=parent_iban, category="allowance", reference=text(self.lang, "allowance", ref)))
            self.monthly_income_minor = amt + minor(self.local_amount(self._job))
        if prof == "retiree":
            name, iban = w.shared_counterparty("pension", self.cc, PENSION_PAYER[self.cc])
            amt = minor(self.local_amount(self.income)) + int(rng.integers(0, 100))
            self.monthly_income_minor = amt
            spec = PENSION_DAY.get(self.cc, 1)
            if spec == "weekly":
                wk = int(amt * 12 / 52)
                d = self.active_from
                while d <= w.end:
                    if d.weekday() == 3:
                        w.schedule(d, lambda day, a=wk: self.emit(day, self.primary, "credit", a, "sct", "batch",
                                                                   cp_name=name, cp_iban=iban, category="pension",
                                                                   reference=text(self.lang, "pension", day)))
                    d += dt.timedelta(1)
            else:
                if isinstance(spec, list):
                    spec = spec[int(rng.integers(0, len(spec)))]
                self.schedule_monthly(spec, lambda d, ref: self.emit(
                    d, self.primary, "credit", amt, "sct", "batch", cp_name=name, cp_iban=iban, category="pension",
                    reference=text(self.lang, "pension", ref)), "before")
        if prof == "freelancer":
            self._setup_freelance(businesses_by_cc)

    def _setup_freelance(self, businesses_by_cc):
        w, rng = self.world, self.rng
        n_clients = int(rng.integers(1, 5))
        total = minor(self.local_amount(self.income * 1.3))  # gross before tax prepayments
        shares = rng.dirichlet(np.ones(n_clients))
        clients = []
        for i in range(n_clients):
            linked = None
            cands = [b for b in businesses_by_cc.get(self.cc, []) if b.primary.currency == self.ccy]
            if cands and rng.random() < 0.2:
                linked = cands[int(rng.integers(0, len(cands)))]
                clients.append((linked.cust["name"], linked.primary.iban, linked))
            else:
                clients.append((w.company_name(self.cc, self.lang, rng), w.new_iban(self.cc, rng), None))
        self.monthly_income_minor = int(total * 0.85)
        inv_no = [int(rng.integers(1, 40))]
        for (y, m) in months_in(w.start - dt.timedelta(days=31), w.end):
            issue = prev_bday(day_of(y, m, "last"))
            for (cname, ciban, link), share in zip(clients, shares):
                if rng.random() > 0.85:
                    continue
                amt = int(total * share * float(rng.lognormal(0, 0.25)))
                amt = (amt // 5000) * 5000 + (0 if rng.random() < 0.7 else int(rng.integers(0, 5000)))
                inv_no[0] += 1
                ref = text(self.lang, "invoice", inv=f"{y}-{inv_no[0]:03d}")
                pay_d = next_bday(issue + dt.timedelta(int(rng.choice([14, 14, 30, 30, 45])) +
                                                       int(rng.exponential(4))))
                if pay_d < self.active_from:
                    continue
                if link is not None:
                    w.schedule(pay_d, lambda d, b=link, a=amt, r=ref: b.pay_supplier_linked(d, self.primary, a, r))
                else:
                    w.schedule(pay_d, lambda d, a=amt, r=ref, n=cname, ib=ciban: self.emit(
                        d, self.primary, "credit", a, "sct", "business", cp_name=n, cp_iban=ib, category="invoice",
                        reference=r))
        # quarterly tax prepayments
        tax_name, tax_iban = w.shared_counterparty("tax", self.cc, TAX_AUTHORITY[self.cc].format(c=self.city.name))
        prepay = int(total * 0.13 * 3 / 100) * 100
        for (y, m) in self.months:
            if m in (3, 6, 9, 12):
                d = next_bday(dt.date(y, m, 10))
                if d >= self.active_from:
                    w.schedule(d, lambda day, a=prepay: self.emit(
                        day, self.primary, "debit", a, "sct", "business", cp_name=tax_name, cp_iban=tax_iban,
                        category="tax", reference=text(self.lang, "tax_income", day)))
        self.tax_monthly = prepay // 3

    # housing & bills ---------------------------------------------------
    def _setup_housing(self):
        rng, w = self.rng, self.world
        p = self.profile
        r = rng.random()
        if p == "student":
            tenure = "parents" if r < 0.3 else "rent"
        elif p == "retiree":
            tenure = "own" if r < 0.65 else "rent"
        else:
            tenure = "rent" if r < 0.55 else ("mortgage" if r < 0.85 else "own")
        self.tenure = tenure
        income_local = self.monthly_income_minor / 100
        if tenure == "rent":
            share = rng.uniform(0.35, 0.5) if p == "student" else rng.uniform(0.25, 0.37)
            rent = income_local * share
            step = 10 if self.ccy in ("EUR", "PLN") else 100
            rent_minor = int(round(rent / step) * step * 100)
            if rng.random() < 0.6:
                f, l, _ = w.person_name(self.cc, self.lang, rng)
                landlord = f"{f} {l}"
            else:
                landlord = w.company_name(self.cc, self.lang, rng, "property")
            liban = w.new_iban(self.cc, rng)
            day = int(rng.integers(1, 4))
            self.schedule_monthly(day, lambda d, ref: self.emit(
                d, self.primary, "debit", rent_minor, "sct", "batch", cp_name=landlord, cp_iban=liban, category="rent",
                reference=text(self.lang, "rent", ref)))
            return rent_minor
        if tenure == "mortgage":
            amt = int(income_local * float(rng.uniform(0.2, 0.32)) * 100)
            name, iban = w.shared_counterparty(f"loan:{self.primary.bic[:4]}", self.cc, self.primary.bank_name)
            contract = str(int(rng.integers(10**7, 10**9)))
            day = int(rng.choice([1, 1, 5, 15, 30]))
            self.schedule_monthly(day, lambda d, ref: self.emit(
                d, self.primary, "debit", amt, "dd", "batch", cp_name=name, cp_iban=iban, category="loan",
                reference=text(self.lang, "loan", ref, cust=contract)))
            return amt
        return 0

    def _setup_bills(self):
        rng = self.rng
        p = self.profile
        total = 0
        lo, hi = self.opts.get("bill_days", (1, 28))
        n_bills = 0

        def bday():
            nonlocal n_bills
            n_bills += 1
            return int(rng.integers(lo, hi + 1))
        if self.tenure != "parents":
            elec = minor(round(self.local_amount(float(rng.uniform(40, 110)) * self.pl * (0.8 + 0.2 * self.household))))
            brand = BILLERS["electricity"][int(rng.integers(0, 3))]
            total += self.bill("electricity", "electricity", elec, bday(), brand)
            self._annual_settlement(brand, elec)
            net = round_price(self.local_amount(float(rng.uniform(25, 50)) * self.pl), "charm", self.ccy, rng)
            total += self.bill("internet", "telecom", net, bday(),
                               BILLERS["telecom"][int(rng.integers(0, 3))])
        mob = round_price(self.local_amount(float(rng.uniform(8, 35)) * self.pl), "charm", self.ccy, rng)
        total += self.bill("mobile", "telecom", mob, bday(), BILLERS["telecom"][int(rng.integers(0, 3))])
        for _ in range(int(rng.integers(0, 3)) if p != "student" else int(rng.random() < 0.3)):
            ins = minor(float(rng.uniform(8, 65)) * self.pl * self.world.static_rate(self.ccy))
            total += self.bill("insurance", "insurance", ins, bday(),
                               BILLERS["insurance"][int(rng.integers(0, 3))])
        while n_bills < self.opts.get("min_bills", 0):
            ins = minor(float(rng.uniform(15, 60)) * self.pl * self.world.static_rate(self.ccy))
            total += self.bill("insurance", "insurance", ins, bday(), BILLERS["insurance"][int(rng.integers(0, 3))])
        if self.car:  # annual car insurance
            ins = minor(round(float(rng.uniform(250, 900)) * self.pl * self.world.static_rate(self.ccy)))
            total += self.bill("insurance", "insurance", ins, int(rng.integers(1, 29)),
                               BILLERS["insurance"][int(rng.integers(0, 3))], months=[int(rng.integers(1, 13))])
        if rng.random() < {"student": .25, "salaried": .35, "freelancer": .35, "retiree": .1}[p]:
            gym = round_price(self.local_amount(float(rng.uniform(19, 50)) * self.pl), "tenth", self.ccy, rng)
            total += self.bill("gym", "gym", gym, bday(), BILLERS["gym"][int(rng.integers(0, 2))])
        return total

    def _annual_settlement(self, brand, monthly):
        rng, w = self.rng, self.world
        d = next_bday(w.start + dt.timedelta(int(rng.integers(20, 360))))
        if d < self.active_from or d > w.end:
            return
        name, iban = self.biller("electricity", brand)
        if rng.random() < 0.6:
            amt, direction = int(monthly * float(rng.uniform(0.5, 2.5))), "debit"
        else:
            amt, direction = int(monthly * float(rng.uniform(0.3, 1.5))), "credit"
        kind = "sct" if (direction == "credit" or self.cc == "PL") else "dd"
        w.schedule(d, lambda day: self.emit(day, self.primary, direction, amt, kind, "batch", cp_name=name,
                                            cp_iban=iban, category="electricity",
                                            reference=text(self.lang, "elec_settlement", day,
                                                           cust=self._bill_refs.get("electricity", "0"))))

    def _setup_subscriptions(self):
        rng, w = self.rng, self.world
        n = int(rng.integers(*{"student": (1, 4), "salaried": (1, 5), "freelancer": (2, 5), "retiree": (0, 2)}[self.profile]))
        if "subscription_creep" in self.tags:
            n = len(SUBSCRIPTIONS)
        idx = rng.permutation(len(SUBSCRIPTIONS))[:n]
        total = 0
        items = [SUBSCRIPTIONS[i] for i in idx]
        if self.profile == "freelancer":
            items += [SAAS[i] for i in rng.permutation(len(SAAS))[:int(rng.integers(1, 4))]]
        for name, eur in items:
            is_saas = (name, eur) in SAAS
            ccy = self.ccy
            if ccy == "EUR":
                price = minor(eur)
            else:
                price = round_price(eur * w.static_rate(ccy) * (0.75 + 0.25 * self.pl), "charm", ccy, rng)
            mid = next((m for m in w.online_merchants.get("software" if is_saas else "subscription", [])
                        if w.merchant_by_id[m]["name"] == name), None)
            if mid is None:
                continue
            day = int(rng.integers(1, 29))
            start = self.active_from
            end = w.end
            if "subscription_creep" in self.tags:
                start = max(start, w.end - dt.timedelta(int(rng.integers(20, 150))))
            elif rng.random() < 0.25:  # joined during the period
                start = max(start, w.start + dt.timedelta(int(rng.integers(0, 300))))
            elif rng.random() < 0.15:  # cancelled during the period
                end = w.start + dt.timedelta(int(rng.integers(60, 360)))
            desc = f"{name.upper()} SUBSCRIPTION"

            def charge(d, ref, mid=mid, price=price, desc=desc, s=start, e=end, saas=is_saas):
                if s <= d <= e:
                    self.emit(d, self.primary, "debit", price, "card", "batch", merchant_id=mid,
                              category="software" if saas else "subscription", cp_name=w.merchant_by_id[mid]["name"],
                              reference=desc)
            self.schedule_monthly(day, charge, adjust="none")
            total += price
        if self.profile == "freelancer" and rng.random() < 0.35:
            mid = w.brand_merchants.get((self.cc, "coworking"), [None])[0]
            if mid:
                price = minor(round(self.local_amount(float(rng.uniform(120, 320)) * self.pl) / 10) * 10)
                self.schedule_monthly(1, lambda d, ref, mid=mid, p=price: self.emit(
                    d, self.primary, "debit", p, "card", "business", merchant_id=mid, category="coworking",
                    cp_name=w.merchant_by_id[mid]["name"], reference=self.card_descriptor(w.merchant_by_id[mid],
                                                                                           self.city.name)))
                total += price
        return total

    def _setup_savings(self):
        rng = self.rng
        if not self.savings:
            return 0
        step = 25 if self.ccy == "EUR" else 100
        amt = int(round(self.monthly_income_minor / 100 * float(rng.uniform(0.05, 0.15)) / step) * step * 100)
        if amt <= 0:
            return 0
        day = int(rng.integers(1, 6))
        sav = self.savings
        self.schedule_monthly(day, lambda d, ref: self.emit(
            d, self.primary, "debit", amt, "internal", "batch", cp_acct=sav, cp_name=self.cust["name"], cp_iban=sav.iban,
            category="savings", reference=text(self.lang, "savings", ref)) if d >= sav.opened and not sav.closed
            else None, start_after=max(sav.opened, self.active_from))
        return amt

    # travel ------------------------------------------------------------
    def _setup_trips(self, bcfg):
        rng, w = self.rng, self.world
        afford = float(np.clip(self.income / 2200, 0.25, 1.3))
        n = rng.poisson(bcfg["trips_per_year"][self.profile] * afford * len(self.months) / 12)
        cap = 0.2 * self.monthly_income_minor * len(self.months)
        month_w = np.array([0.5, 0.6, 0.8, 1.3, 1.1, 1.3, 2.4, 2.6, 1.2, 1.0, 0.6, 1.2])
        dests = [c for c in w.countries if c != self.cc]
        dw = np.array([geo.TRAVEL_WEIGHTS.get(c, 1) for c in dests], dtype=float)
        cost_total = 0
        for _ in range(n):
            if not dests:
                break
            mon = int(rng.choice(12, p=month_w / month_w.sum())) + 1
            cands = [d for d in w.days if d.month == mon and d >= self.active_from + dt.timedelta(10)]
            if not cands:
                continue
            start = cands[int(rng.integers(0, len(cands)))]
            nights = int(rng.integers(3, 15 if self.profile == "retiree" else 11))
            days = [start + dt.timedelta(i) for i in range(nights + 1)]
            if any(d in self.trips for d in days):
                continue
            dest = dests[int(rng.choice(len(dests), p=dw / dw.sum()))]
            people = int(rng.choice([1, 2, 3, 4], p=[.45, .35, .13, .07]))
            dpl = w.countries[dest].price_level
            est = minor(self.local_amount(((nights + 1) * 205 * dpl + 105) * (0.6 + 0.4 * people)))
            if cost_total + est > cap:
                continue
            for d in days:
                self.trips[d] = (dest, people)
            cost_total += self._book_trip(start, days[-1], nights, dest, people)
        return cost_total / max(1, len(self.months))

    def _book_trip(self, start, last, nights, dest, people):
        rng, w = self.rng, self.world
        dcountry = w.countries[dest]
        booking = start - dt.timedelta(int(rng.integers(14, 70)))
        cost = 0
        flight = rng.random() < 0.75
        if flight and booking >= self.active_from:
            mid = w.online_merchants["airline"][int(rng.integers(0, len(w.online_merchants["airline"])))]
            eur = float(rng.lognormal(math.log(140), 0.5)) * (0.6 + 0.4 * people)
            amt = round_price(self.local_amount(eur), "charm", self.ccy, rng)
            m = w.merchant_by_id[mid]
            w.schedule(booking, lambda d, amt=amt, mid=mid, m=m: self.emit(
                d, self.primary, "debit", amt, "card", "anytime", merchant_id=mid, category="airline",
                cp_name=m["name"], reference=self.card_descriptor(m, "")))
            cost += amt
        hotel_eur = nights * 95 * dcountry.price_level * (0.7 + 0.3 * people) * float(rng.lognormal(0, 0.3))
        platforms = w.online_merchants.get("travel_booking", [])
        if rng.random() < 0.55 and booking >= self.active_from and platforms:
            hmid = platforms[int(rng.integers(0, len(platforms)))]
            hamt = round_price(self.local_amount(hotel_eur), "whole", self.ccy, rng)
            hm = w.merchant_by_id[hmid]
            w.schedule(booking + dt.timedelta(int(rng.integers(0, 3))), lambda d, amt=hamt, mid=hmid, m=hm: self.emit(
                d, self.primary, "debit", amt, "card", "anytime", merchant_id=mid, category="travel_booking",
                cp_name=m["name"], reference=self.card_descriptor(m, "")))
            cost += hamt
        else:
            self._pay_hotel_at = getattr(self, "_pay_hotel_at", {})
            self._pay_hotel_at[last] = hotel_eur
            cost += minor(self.local_amount(hotel_eur))
        # non-euro customers with a EUR account top it up before a eurozone trip
        if self.eur_acct and dcountry.currency == "EUR":
            top = start - dt.timedelta(int(rng.integers(1, 7)))
            if top >= max(self.eur_acct.opened, self.active_from):
                eur_amt = int(round(nights * 70 * dcountry.price_level * (0.6 + 0.4 * people) / 50) * 50 * 100)
                w.schedule(top, lambda d, a=eur_amt: self.fx_transfer(d, self.primary, self.eur_acct, a, "topup"))
        daily_eur = 110 * dcountry.price_level * (0.6 + 0.4 * people)
        cost += minor(self.local_amount(daily_eur * (nights + 1)))
        return cost

    # calibration ---------------------------------------------------------
    def _setup_rates(self, fixed_minor, travel_minor):
        rng, w = self.rng, self.world
        base = dict(BASE_RATES[self.profile])
        if not self.car:
            base["public_transport"] = base.get("public_transport", 0) * 1.5
            base["fuel"] = 0
            base["parking"] = 0
        base["atm"] = base.get("atm", 1) * self.country.cash_use / 1.5
        rates = np.array([base.get(c, 0.0) for c in CATS]) * rng.lognormal(0, 0.25, len(CATS))
        inc_factor = (self.income / self.country.net_salary_eur) ** 0.35 if self.income else 0.7
        self.amount_mult = AMOUNT_MULT[self.profile] * inc_factor
        # expected spend per event (primary ccy, major units)
        self.mean_amt = np.zeros(len(CATS))
        rate = w.static_rate(self.ccy)
        for i, c in enumerate(CATS):
            if c in CATEGORIES:
                cat = CATEGORIES[c]
                hh = (0.6 + 0.4 * self.household) if c in ("groceries",) else 1.0
                self.mean_amt[i] = cat.median * self.pl * self.amount_mult * hh * math.exp(cat.sigma ** 2 / 2) * rate
            elif c == "atm":
                self.mean_amt[i] = float(np.mean(ATM_NOTES[self.ccy]))
            elif c == "p2p":
                self.mean_amt[i] = 25 * self.pl * rate * 0.5  # partially offset by incoming
        disc = float((rates * self.mean_amt).sum()) * 100
        income = self.monthly_income_minor
        target = income * float(rng.uniform(0.9, 0.99)) - fixed_minor - travel_minor - self.tax_monthly
        scale = float(np.clip(target / disc, 0.25, 2.0)) if disc > 0 else 1
        self.rates = rates * scale * self.opts.get("rate_scale", 1.0)
        self.budget_minor = max(1.0, disc * scale)
        # favourite merchants per category at home
        self.favs = {}
        for c in CATS:
            if c not in CATEGORIES or CATEGORIES[c].online:
                continue
            local = [m for m in w.local_merchants.get((self.cc, c), [])
                     if w.merchant_by_id[m]["city"] == self.city.name]
            chains = w.brand_merchants.get((self.cc, c), [])
            pool = list(local) + list(chains) or list(w.local_merchants.get((self.cc, c), []))
            if pool:
                k = min(len(pool), int(rng.integers(1, 4)))
                self.favs[c] = [pool[int(j)] for j in rng.choice(len(pool), k, replace=False)]
        self.fav_online = {c: (w.online_merchants[c][int(rng.integers(0, len(w.online_merchants[c])))]
                               if w.online_merchants.get(c) else None) for c in ("marketplace", "food_delivery")}

    # --------------------------------------------------------------- daily
    def daily(self, d):
        acct = self.primary
        if d < acct.opened:
            return
        dow, mon = d.weekday(), d.month
        lam = self.rates * WDM[:, dow] * SEAS[:, mon - 1] / 30.4
        if self.country.sunday_shops_closed and dow == 6:
            lam = np.where(SHOP_CATS, lam * 0.05, lam)
        avail = acct.balance + acct.overdraft
        g = float(np.clip(avail / (0.5 * self.budget_minor), 0.08, 1.0))
        lam = lam * np.where(ESSENTIAL, max(g, 0.6), g)
        trip = self.trips.get(d)
        if trip:
            lam = lam * HOME_KEEP + TRAVEL_VEC * (0.7 + 0.3 * trip[1]) ** 0.5
        counts = self.rng.poisson(lam)
        for i in np.flatnonzero(counts):
            for _ in range(int(counts[i])):
                self.spend(CATS[i], d, trip)
        hotel = getattr(self, "_pay_hotel_at", {}).get(d)
        if hotel and trip:
            self.card_purchase("hotel", d, trip, eur_override=hotel)
        # pull from savings when the current account runs low (weekly check)
        if dow == 0 and self.savings and not self.savings.closed and self.savings.opened <= d \
                and acct.balance < 0.15 * self.budget_minor and self.savings.balance > 0:
            want = int(round(self.budget_minor * 0.5 / 5000) * 5000) or 5000
            sav = self.savings
            self.emit(d, sav, "debit", None, "internal", "anytime", cp_acct=acct, cp_name=self.cust["name"],
                      cp_iban=acct.iban, category="transfer", reference=text(self.lang, "own_transfer"),
                      dyn=lambda a, want=want: min(want, max(0, a.balance)))

    def can_try(self, acct, amount) -> bool:
        """Customers roughly know their balance: most skip a purchase they can't cover, some try anyway."""
        return amount <= acct.balance + acct.overdraft or self.rng.random() < 0.15

    def spend(self, cat, d, trip):
        if cat == "atm":
            return self.atm(d, trip)
        if cat == "p2p":
            return self.p2p(d)
        self.card_purchase(cat, d, trip)

    def pay_account(self, merchant_ccy):
        if merchant_ccy == "EUR" and self.eur_acct is not None and self.ccy != "EUR" \
                and self.eur_acct.balance > 0:
            return self.eur_acct
        return self.primary

    def card_purchase(self, cat, d, trip, eur_override=None, merchant_id=None, hours=None, force=None, tag=None,
                      amount_minor=None):
        w, rng = self.world, self.rng
        c = CATEGORIES[cat]
        here_cc = trip[0] if trip else self.cc
        here = w.countries[here_cc]
        if merchant_id:
            mid = merchant_id
        elif c.online:
            mid = self.fav_online.get(cat) if rng.random() < 0.7 else None
            if not mid:
                pool = w.online_merchants.get(cat, [])
                if not pool:
                    return
                mid = pool[int(rng.integers(0, len(pool)))]
        else:
            favs = self.favs.get(cat) if not trip else None
            if favs and rng.random() < 0.75:
                mid = favs[int(rng.integers(0, len(favs)))]
            else:
                pool = w.local_merchants.get((here_cc, cat), []) + w.brand_merchants.get((here_cc, cat), [])
                if not trip:
                    same = [x for x in pool if w.merchant_by_id[x]["city"] in (None, self.city.name)]
                    pool = same if same and rng.random() < 0.9 else pool
                if not pool:
                    return
                mid = pool[int(rng.integers(0, len(pool)))]
        m = w.merchant_by_id[mid]
        m_ccy = self.ccy if c.online else w.countries[m["country"]].currency
        acct = self.pay_account(m_ccy)
        if amount_minor is not None:
            price = amount_minor
        else:
            if eur_override is not None:
                eur = eur_override
            else:
                hh = (0.6 + 0.4 * self.household) if cat == "groceries" and not trip else 1.0
                pp = (0.6 + 0.4 * trip[1]) if trip and cat in ("restaurant", "cafe", "attractions") else 1.0
                pl = here.price_level if not c.online else self.pl
                eur = float(rng.lognormal(math.log(c.median * pl * self.amount_mult * hh * pp), c.sigma))
            price = round_price(eur * w.static_rate(m_ccy), c.rounding, m_ccy, rng)
        orig = fx = None
        amt = price
        if m_ccy != acct.currency:
            amt, fx = w.fx_convert(price, m_ccy, acct.currency, d, w.fx_markup)
            orig = price
        if force is None and not self.can_try(acct, amt):
            return None
        tz = here.tz
        city = self.city.name if not trip else (m["city"] or here.cities[0].name)
        ev = self.emit(d, acct, "debit", amt, "card", hours or c.hours, tz=tz, merchant_id=mid, category=cat,
                       cp_name=m["name"], reference=self.card_descriptor(m, city), orig_amount=orig,
                       orig_ccy=m_ccy if orig else None, fx_rate=fx, force=force, tag=tag)
        if cat in REFUNDABLE and rng.random() < w.cfg["behaviour"]["refund_rate"] and force is None:
            later = d + dt.timedelta(int(rng.integers(3, 21)))
            refund_amt = amt if rng.random() < 0.8 else max(1, int(amt * float(rng.uniform(0.2, 0.7))))
            ts = w.ts(later, "business", tz, rng)
            w.event(ts=ts, acct=acct, direction="credit", amount=None, ttype="card", merchant_id=mid, category=cat,
                    cp_name=m["name"], reference=f"{text(self.lang, 'refund')} {self.card_descriptor(m, city)}",
                    orig_amount=None, dyn=lambda a, o=ev, r=refund_amt: r if getattr(o, "status", None) == "booked"
                    else 0)
        return ev

    def atm(self, d, trip):
        w, rng = self.world, self.rng
        here_cc = trip[0] if trip else self.cc
        here = w.countries[here_cc]
        ccy = here.currency
        acct = self.pay_account(ccy)
        notes = ATM_NOTES[ccy]
        cash = notes[int(rng.integers(0, len(notes)))] * 100
        amt, fx, orig = cash, None, None
        if ccy != acct.currency:
            amt, fx = w.fx_convert(cash, ccy, acct.currency, d, w.fx_markup)
            orig = cash
        if not self.can_try(acct, amt):
            return
        bank = w.iban.pick_bank(here_cc, rng)
        city = self.city.name if not trip else here.cities[0].name
        self.emit(d, acct, "debit", amt, "atm", "day", tz=here.tz, category="cash", cp_name=bank.name,
                  reference=f"{text(self.lang, 'atm')} {city}", orig_amount=orig, orig_ccy=ccy if orig else None,
                  fx_rate=fx)

    def p2p(self, d):
        w, rng = self.world, self.rng
        if not self.friends:
            return
        f = self.friends[int(rng.integers(0, len(self.friends)))]
        eur = float(rng.lognormal(math.log(22 * self.pl), 0.7))
        amt = round_price(eur * w.static_rate(self.ccy), "half" if rng.random() < 0.6 else "whole", self.ccy, rng)
        refs = T[self.lang]["p2p"]
        ref = refs[int(rng.integers(0, len(refs)))]
        kind = "inst" if rng.random() < 0.75 else "sct"
        if not self.can_try(self.primary, amt):
            return
        if isinstance(f, Individual):
            if f.primary.currency != self.ccy or f.primary.opened > d:
                return
            self.emit(d, self.primary, "debit", amt, kind, "anytime", cp_acct=f.primary, cp_name=f.cust["name"],
                      cp_iban=f.primary.iban, category="p2p", reference=ref)
        else:
            name, iban = f
            direction = "debit" if rng.random() < 0.65 else "credit"
            self.emit(d, self.primary, direction, amt, kind, "anytime", cp_name=name, cp_iban=iban, category="p2p",
                      reference=ref)


# ----------------------------------------------------------------- businesses
SECTOR = {  # median monthly revenue EUR @ price level 1, payroll share, supplier share, merchant category
    "cafe": (26000, 0.34, 0.30, "cafe"), "retail": (38000, 0.22, 0.48, "clothing"),
    "consulting": (30000, 0.55, 0.2, None), "construction": (52000, 0.38, 0.30, None),
    "design": (17000, 0.50, 0.18, None),
}
BIZ_RATES = {
    "cafe": dict(groceries=6, office_supplies=0.5, marketplace=1, electronics=0.1, home_diy=0.5),
    "retail": dict(office_supplies=1, marketplace=2, electronics=0.2, home_diy=0.5, fuel=1),
    "consulting": dict(office_supplies=0.8, restaurant=2, taxi=1.5, marketplace=1, electronics=0.3, fuel=1.5,
                       parking=1),
    "construction": dict(fuel=7, home_diy=8, office_supplies=0.3, restaurant=1, parking=2, electronics=0.2),
    "design": dict(office_supplies=0.8, restaurant=1, marketplace=1.5, electronics=0.4, cafe=3),
}


class Business(Persona):
    kind = "business"

    def __init__(self, world, idx, cc, sector, is_new):
        super().__init__(world, idx, cc, is_new)
        rng = self.rng
        self.sector = sector
        self.profile = "small_business"
        legal = world.company_name(cc, self.lang, rng, sector)
        trading = legal
        if SECTOR[sector][3]:
            _, s, _ = world.person_name(cc, self.lang, rng)
            tpl = LOCAL_MERCHANT_TPL[self.lang][SECTOR[sector][3]]
            trading = tpl[int(rng.integers(0, len(tpl)))].format(s=s, f=s, c=self.city.name)
        slug = ascii_fold(legal.split(" ")[0]) or "company"
        self.cust = dict(id=make_id("cus", world.seed, idx, 12), type="business", name=legal, first_name=None,
                         last_name=None, country=cc, city=self.city.name,
                         postcode=geo.fill_pattern(self.city.postcode, rng),
                         address=geo.make_address(self.country, self.city, rng),
                         email=f"{['info', 'office', 'kontakt' if self.lang == 'de' else 'hello'][int(rng.integers(0, 3))]}"
                               f"@{slug}.example", phone=geo.make_phone(self.country, rng), date_of_birth=None,
                         registration_number=registration_number(cc, rng, self.city.name),
                         created_at=world.ts(self.created, "business", self.tz, rng), timezone=self.tz,
                         language=self.lang, segment="small_business", sector=sector, trading_name=trading)
        self.n_employees = int(rng.integers(*{"cafe": (3, 9), "retail": (2, 7), "consulting": (1, 5),
                                              "construction": (3, 11), "design": (1, 4)}[sector]))
        self.linked: list[Individual] = []
        opts = PAYDAY.get(cc, [25, "last"])
        self.pay_spec = opts[int(rng.integers(0, len(opts)))]
        self.merchant_id = None

    def setup(self, businesses_by_cc):
        w, rng = self.world, self.rng
        med, pay_share, sup_share, mcat = SECTOR[self.sector]
        avg_net = self.country.net_salary_eur * float(rng.uniform(0.75, 1.1))
        payroll_eur = self.n_employees * avg_net * 1.55
        self.revenue_eur = max(payroll_eur / pay_share, med * self.pl * 0.4) * float(rng.lognormal(0, 0.15))
        R = self.revenue_eur
        self.avg_net_eur = avg_net
        credit_line = minor(round(self.local_amount(R * 0.4), -3)) if rng.random() < 0.6 else 0
        self.primary = self.open_account("business", self.ccy, self.created, R * float(rng.uniform(1.0, 2.5)),
                                         credit_line)
        if rng.random() < 0.3:
            self.savings = self.open_account("savings", self.ccy, self._later_open(), R * float(rng.uniform(0.3, 1.5)))
        if mcat:
            self.merchant_id = add_business_merchant(w, self.cust, mcat)
        self.avg_net_minor = minor(self.local_amount(avg_net))
        self._setup_payroll()
        self._setup_costs(sup_share * 0.8)
        self._setup_revenue(businesses_by_cc)
        base = BIZ_RATES[self.sector]
        self.rates = np.array([base.get(c, 0.0) for c in CATS]) * (R / (med * self.pl)) ** 0.5
        self.budget_minor = minor(self.local_amount(R * 0.05))
        self.favs = {}
        for c in CATS:
            pool = w.brand_merchants.get((self.cc, c), []) + w.local_merchants.get((self.cc, c), [])
            if pool:
                self.favs[c] = [pool[int(j)] for j in rng.choice(len(pool), min(2, len(pool)), replace=False)]

    def _later_open(self):
        return Individual._later_open(self)

    def _setup_payroll(self):
        w, rng = self.world, self.rng
        employees = []
        for _ in range(self.n_employees):
            f, l, _ = w.person_name(self.cc, self.lang, rng)
            employees.append((f"{f} {l}", w.new_iban(self.cc, rng),
                              int(self.avg_net_minor * float(rng.lognormal(0, 0.2))) + int(rng.integers(0, 100))))
        self._employees = employees
        bonus = BONUS_MONTHS.get(self.cc, {})
        tax_name, tax_iban = w.shared_counterparty("tax", self.cc, TAX_AUTHORITY[self.cc].format(c=self.city.name))

        def payroll(d, ref):
            n_ext = max(0, self.n_employees - len(self.linked))
            total = sum(e[2] for e in employees[:n_ext])
            for name, iban, amt in employees[:n_ext]:
                a = int(amt * (1 + bonus.get(ref.month, 0)))
                self.emit(d, self.primary, "debit", a, "sct", "batch", cp_name=name, cp_iban=iban, category="salary",
                          reference=text(self.lang, "salary", ref))
            total += sum(getattr(p, "monthly_income_minor", self.avg_net_minor) for p in self.linked)
            tax_day = next_bday(dt.date(d.year + (d.month == 12), d.month % 12 + 1, 15))
            w.schedule(tax_day, lambda dd, t=int(total * 0.55): self.emit(
                dd, self.primary, "debit", t, "sct", "business", cp_name=tax_name, cp_iban=tax_iban, category="tax",
                reference=text(self.lang, "payroll_tax", ref)))
        self.schedule_monthly(self.pay_spec, payroll, "before")

    def pay_employee(self, d, person, amount, reference):
        self.emit(d, self.primary, "debit", amount, "sct", "batch", cp_acct=person.primary, cp_name=person.cust["name"],
                  cp_iban=person.primary.iban, category="salary", reference=reference)

    def pay_supplier_linked(self, d, payee_acct, amount, reference):
        self.emit(d, self.primary, "debit", amount, "sct", "business", cp_acct=payee_acct,
                  cp_name=payee_acct.owner_name, cp_iban=payee_acct.iban, category="invoice", reference=reference)

    def _setup_costs(self, sup_share):
        w, rng = self.world, self.rng
        R_minor = minor(self.local_amount(self.revenue_eur))
        # rent
        landlord = w.company_name(self.cc, self.lang, rng, "property")
        liban = w.new_iban(self.cc, rng)
        rent = int(round(R_minor * float(rng.uniform(0.05, 0.1)) / 10000) * 10000)
        self.schedule_monthly(int(rng.integers(1, 4)), lambda d, ref: self.emit(
            d, self.primary, "debit", rent, "sct", "batch", cp_name=landlord, cp_iban=liban, category="rent",
            reference=text(self.lang, "rent", ref)))
        # bills
        self.bill("electricity", "electricity", int(R_minor * 0.012), int(rng.integers(1, 29)),
                  BILLERS["electricity"][int(rng.integers(0, 3))])
        self.bill("internet", "telecom", round_price(self.local_amount(float(rng.uniform(40, 90))), "charm",
                                                     self.ccy, rng), int(rng.integers(1, 29)),
                  BILLERS["telecom"][int(rng.integers(0, 3))])
        self.bill("insurance", "insurance", int(R_minor * 0.01), int(rng.integers(1, 29)),
                  BILLERS["insurance"][int(rng.integers(0, 3))])
        # suppliers
        n_sup = int(rng.integers(2, 7))
        sups = [(w.company_name(self.cc, self.lang, rng, "wholesale"), w.new_iban(self.cc, rng),
                 "".join("ABCDEFGHKLMNPRSTVZ"[int(i)] for i in rng.integers(0, 18, 2))) for _ in range(n_sup)]
        monthly_sup = R_minor * sup_share
        counters = [int(rng.integers(100, 900)) for _ in sups]
        for (y, m) in self.months:
            k = max(1, rng.poisson(n_sup * 1.2))
            parts = rng.dirichlet(np.ones(k)) * monthly_sup * float(rng.lognormal(0, 0.1))
            for part in parts:
                j = int(rng.integers(0, n_sup))
                counters[j] += 1
                name, iban, pfx = sups[j]
                d = next_bday(dt.date(y, m, int(rng.integers(1, calendar.monthrange(y, m)[1] + 1))))
                if d < self.active_from:
                    continue
                ref = text(self.lang, "invoice", inv=f"{pfx}-{y}-{counters[j]:04d}")
                w.schedule(d, lambda day, a=int(part), n=name, ib=iban, r=ref: self.emit(
                    day, self.primary, "debit", a, "sct", "business", cp_name=n, cp_iban=ib, category="supplier",
                    reference=r))
        # taxes
        tax_name, tax_iban = w.shared_counterparty("tax", self.cc, TAX_AUTHORITY[self.cc].format(c=self.city.name))
        for (y, m) in self.months:
            if m in (1, 4, 7, 10):
                d = next_bday(dt.date(y, m, int(rng.integers(10, 21))))
                ref_q = dt.date(y - (m == 1), 12 if m == 1 else m - 3, 1)
                vat = int(R_minor * 3 * 0.055 * float(rng.lognormal(0, 0.15)))
                cit = int(R_minor * 3 * 0.02 / 100) * 100
                if d >= self.active_from:
                    w.schedule(d, lambda day, a=vat, r=ref_q: self.emit(
                        day, self.primary, "debit", a, "sct", "business", cp_name=tax_name, cp_iban=tax_iban,
                        category="tax", reference=text(self.lang, "tax_vat", r)))
                    w.schedule(d, lambda day, a=cit, r=ref_q: self.emit(
                        day, self.primary, "debit", a, "sct", "business", cp_name=tax_name, cp_iban=tax_iban,
                        category="tax", reference=text(self.lang, "tax_corp", r)))
        # SaaS
        for i in rng.permutation(len(SAAS))[:int(rng.integers(1, 4))]:
            name, eur = SAAS[i]
            mid = next((m for m in w.online_merchants.get("software", []) if w.merchant_by_id[m]["name"] == name), None)
            if not mid:
                continue
            price = minor(eur * (1 + int(rng.integers(0, 5)))) if self.ccy == "EUR" else round_price(
                self.local_amount(eur * (1 + int(rng.integers(0, 5)))), "charm", self.ccy, rng)
            self.schedule_monthly(int(rng.integers(1, 29)), lambda d, ref, mid=mid, p=price: self.emit(
                d, self.primary, "debit", p, "card", "batch", merchant_id=mid, category="software",
                cp_name=w.merchant_by_id[mid]["name"], reference=f"{w.merchant_by_id[mid]['name'].upper()} SUBSCRIPTION"),
                adjust="none")
        if self.savings:
            sav = self.savings
            amt = int(round(R_minor * 0.04 / 10000) * 10000)
            self.schedule_monthly(20, lambda d, ref: self.emit(
                d, self.primary, "debit", amt, "internal", "business", cp_acct=sav, cp_name=self.cust["name"],
                cp_iban=sav.iban, category="savings", reference=text(self.lang, "savings", ref))
                if d >= sav.opened else None)

    def _setup_revenue(self, businesses_by_cc):
        w, rng = self.world, self.rng
        R_minor = minor(self.local_amount(self.revenue_eur))
        if self.sector in ("cafe", "retail"):
            acq_name, acq_iban = w.shared_counterparty("acquirer", "IE" if "IE" in w.countries else self.cc, ACQUIRER)
            mid_no = str(int(rng.integers(10**8, 10**9)))
            wk = np.array([0.9, 0.9, 1.0, 1.05, 1.25, 1.35, 0.55 if self.sector == "cafe" else 0.2])
            daily_base = R_minor * 0.88 / 30.4 / wk.mean()
            pending = {"amt": 0, "since": None}

            def settle(d):
                if d < self.active_from:
                    return
                season = SEASON["retail" if self.sector == "retail" else "leisure"][d.month - 1]
                sales = int(daily_base * wk[d.weekday()] * season * float(rng.lognormal(0, 0.18)))
                if self.country.sunday_shops_closed and d.weekday() == 6:
                    sales = 0
                if d.weekday() < 5 and pending["amt"] > 0:
                    net = int(pending["amt"] * 0.988)
                    self.emit(d, self.primary, "credit", net, "sct", "batch", cp_name=acq_name, cp_iban=acq_iban,
                              category="card_settlement",
                              reference=f"SETTLEMENT {pending['since'].isoformat()} MID {mid_no}")
                    pending["amt"], pending["since"] = 0, None
                pending["amt"] += sales
                pending["since"] = pending["since"] or d
            for d in w.days:
                w.schedule(d, settle)
            return
        # invoice-driven sectors
        n_clients = int(rng.integers(3, 9))
        shares = rng.dirichlet(np.ones(n_clients) * 1.5)
        clients = []
        for _ in range(n_clients):
            cands = [b for b in businesses_by_cc.get(self.cc, []) if b is not self and b.primary.currency == self.ccy]
            if cands and rng.random() < 0.15:
                b = cands[int(rng.integers(0, len(cands)))]
                clients.append((b.cust["name"], b.primary.iban, b))
            else:
                clients.append((w.company_name(self.cc, self.lang, rng), w.new_iban(self.cc, rng), None))
        inv = int(rng.integers(10, 200))
        for (y, m) in months_in(self.world.start - dt.timedelta(days=31), self.world.end):
            for (cname, ciban, link), share in zip(clients, shares):
                if rng.random() > 0.8:
                    continue
                amt = int(R_minor * share / 0.8 * float(rng.lognormal(0, 0.3)))
                amt = amt // 100 * 100 if rng.random() < 0.6 else amt
                inv += 1
                ref = text(self.lang, "invoice", inv=f"{y}-{inv:04d}")
                issue = prev_bday(day_of(y, m, "last"))
                pay_d = next_bday(issue + dt.timedelta(int(rng.choice([14, 30, 30, 45])) + int(rng.exponential(6))))
                if pay_d < self.active_from:
                    continue
                if link is not None:
                    w.schedule(pay_d, lambda d, b=link, a=amt, r=ref: b.pay_supplier_linked(d, self.primary, a, r))
                else:
                    kind = "inst" if rng.random() < 0.2 else "sct"
                    w.schedule(pay_d, lambda d, a=amt, r=ref, n=cname, ib=ciban, k=kind: self.emit(
                        d, self.primary, "credit", a, k, "business", cp_name=n, cp_iban=ib, category="invoice",
                        reference=r))

    def daily(self, d):
        acct = self.primary
        if d < acct.opened:
            return
        lam = self.rates * WDM[:, d.weekday()] / 30.4
        g = float(np.clip((acct.balance + acct.overdraft) / max(1, 4 * self.budget_minor), 0.1, 1.0))
        counts = self.rng.poisson(lam * g)
        for i in np.flatnonzero(counts):
            c = CATS[i]
            for _ in range(int(counts[i])):
                favs = self.favs.get(c)
                if not favs:
                    continue
                m = self.world.merchant_by_id[favs[int(self.rng.integers(0, len(favs)))]]
                cat = CATEGORIES[c]
                mult = 3.0 if c in ("home_diy", "office_supplies", "groceries") else 1.2
                eur = float(self.rng.lognormal(math.log(cat.median * self.pl * mult), cat.sigma))
                price = round_price(eur * self.world.static_rate(self.ccy), cat.rounding, self.ccy, self.rng)
                self.emit(d, acct, "debit", price, "card", "business", merchant_id=m["id"], category=c,
                          cp_name=m["name"], reference=self.card_descriptor(m, self.city.name))
