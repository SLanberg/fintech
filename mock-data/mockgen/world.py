"""World state + ledger engine.

Events are generated per customer per local day and pushed on a global heap keyed by UTC
timestamp. After each simulated day, all events older than the earliest possible next-day local
midnight are applied in strict (timestamp, seq) order, so balances are computed sequentially
and consistently across all accounts, including two-leg transfers between dataset customers.
Amounts are integer minor units (cents) throughout.
"""
from __future__ import annotations

import datetime as dt
import heapq
import re
import unicodedata
from zoneinfo import ZoneInfo

import numpy as np
from faker import Faker

from . import geo
from .banking import IbanFactory, make_id
from .catalog import pick_hour
from .locale_text import BUSINESS_SUFFIX, SECTOR_WORDS

UTC = dt.timezone.utc
SEPA_TYPES = {"sct": "sepa_credit_transfer", "inst": "sepa_instant", "dd": "sepa_direct_debit"}
DOMESTIC_TYPES = {"sct": "domestic_transfer", "inst": "domestic_instant", "dd": "domestic_direct_debit"}
DEBIT_FAILABLE = {"sepa_direct_debit", "domestic_direct_debit", "sepa_credit_transfer", "sepa_instant",
                  "domestic_transfer", "domestic_instant", "card", "atm", "internal"}

SECTOR_WORDS.setdefault("property", {"de": "Immobilien", "fr": "Immobilier", "nl": "Vastgoed", "es": "Inmobiliaria",
                                     "it": "Immobiliare", "pl": "Nieruchomości", "et": "Kinnisvara",
                                     "lv": "Nekustamie īpašumi", "lt": "Nekilnojamasis turtas", "fi": "Kiinteistöt",
                                     "sv": "Fastigheter", "cs": "Reality", "pt": "Imobiliária", "en": "Properties"})
SECTOR_WORDS.setdefault("wholesale", {"de": "Großhandel", "fr": "Distribution", "nl": "Groothandel",
                                      "es": "Distribuciones", "it": "Forniture", "pl": "Hurtownia", "et": "Hulgimüük",
                                      "lv": "Vairumtirdzniecība", "lt": "Didmena", "fi": "Tukku", "sv": "Grossist",
                                      "cs": "Velkoobchod", "pt": "Distribuição", "en": "Wholesale"})
SECTOR_WORDS.setdefault("tech", {"de": "Systems", "fr": "Technologies", "nl": "Solutions", "es": "Tecnología",
                                 "it": "Tecnologie", "pl": "Systemy", "et": "Tehnoloogia", "lv": "Tehnoloģijas",
                                 "lt": "Technologijos", "fi": "Teknologia", "sv": "Teknik", "cs": "Technologie",
                                 "pt": "Tecnologia", "en": "Technologies"})
SYLL_A = ["Kel", "Vor", "Mar", "Lin", "Tar", "Sol", "Ner", "Ard", "Bel", "Cor", "Dal", "Fen", "Gal", "Hal", "Ist",
          "Jor", "Kas", "Lum", "Mon", "Nov", "Or", "Pel", "Quin", "Ros", "Sil", "Tev", "Ul", "Ven", "Wes", "Zer"]
SYLL_B = ["ora", "ina", "ex", "via", "ant", "ence", "ix", "ano", "ium", "enta", "ido", "ara", "etta", "on", "is"]


def ascii_fold(s: str) -> str:
    s = s.replace("ł", "l").replace("Ł", "L").replace("ß", "ss").replace("ø", "o").replace("æ", "ae")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]", "", s).lower()


def lt_female(surname: str) -> str:
    for end in ("as", "is", "ys", "us"):
        if surname.endswith(end):
            return surname[:-2] + "ienė"
    return surname


class Account:
    __slots__ = ("id", "customer_id", "owner_name", "iban", "bic", "bank_name", "currency", "kind", "balance",
                 "opening_balance", "overdraft", "opened", "closed", "status", "country", "tz", "persona")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


class Event:
    __slots__ = ("ts", "seq", "acct", "direction", "amount", "dyn", "ttype", "category", "merchant_id", "cp_name",
                 "cp_iban", "cp_acct", "mirror_amount", "reference", "orig_amount", "orig_ccy", "fx_rate", "force",
                 "tag", "on_fail", "status")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


class World:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.seed = int(cfg["seed"])
        self.start: dt.date = cfg["_start"]
        self.end: dt.date = cfg["_end"]
        self.days = [self.start + dt.timedelta(n) for n in range((self.end - self.start).days + 1)]
        self.countries = {c: geo.COUNTRIES[c] for c in cfg["countries"]}
        self.rng = np.random.default_rng([self.seed, 0])
        self.engine_rng = np.random.default_rng([self.seed, 1])
        self._fakers: dict[str, Faker] = {}
        self._tz: dict[str, ZoneInfo] = {}
        self.iban = IbanFactory(list(self.countries))
        self._cp_cache: dict[str, tuple[str, str]] = {}
        self.accounts: dict[str, Account] = {}
        self.customers: list[dict] = []
        self.merchants: list[dict] = []
        self.merchant_by_id: dict[str, dict] = {}
        self.local_merchants: dict[tuple[str, str], list[str]] = {}  # (country, category) -> ids
        self.brand_merchants: dict[tuple[str, str], list[str]] = {}
        self.online_merchants: dict[str, list[str]] = {}
        self.personas: list = []
        self.calendar: dict[dt.date, list] = {}
        self.heap: list = []
        self.rows: list[tuple] = []
        self.scenario_log: list[dict] = []
        self._seq = 0
        self._txn_n = 0
        self._build_fx()
        b = cfg["behaviour"]
        self.decline_rate = b["card_decline_rate"]
        self.reversal_rate = b["card_reversal_rate"]
        self.tech_fail_rate = b["technical_fail_rate"]
        self.fx_markup = b["card_fx_markup"]
        end_local = dt.datetime.combine(self.end + dt.timedelta(1), dt.time(0), tzinfo=UTC)
        self.end_utc = end_local
        self.pending_cutoff = end_local - dt.timedelta(days=b["pending_days"])

    # ---------- helpers ----------
    def faker(self, locale: str, rng) -> Faker:
        f = self._fakers.get(locale)
        if f is None:
            f = self._fakers[locale] = Faker(locale)
        f.seed_instance(int(rng.integers(0, 2**31 - 1)))
        return f

    def tz(self, name: str) -> ZoneInfo:
        z = self._tz.get(name)
        if z is None:
            z = self._tz[name] = ZoneInfo(name)
        return z

    def ts(self, d: dt.date, hours: str, tzname: str, rng, hms=None) -> dt.datetime:
        h, m, s = hms if hms else pick_hour(hours, rng)
        local = dt.datetime(d.year, d.month, d.day, h, m, s, tzinfo=self.tz(tzname))
        return local.astimezone(UTC)

    def ttype(self, currency: str, kind: str) -> str:
        return (SEPA_TYPES if currency == "EUR" else DOMESTIC_TYPES)[kind]

    def _build_fx(self):
        self.fx: dict[dt.date, dict[str, float]] = {}
        state = {c: np.log(v) for c, v in geo.FX_BASE.items()}
        for d in self.days:
            for c in state:
                if c == "EUR":
                    continue
                base = np.log(geo.FX_BASE[c])
                state[c] += 0.03 * (base - state[c]) + self.rng.normal(0, 0.003)
            self.fx[d] = {c: (1.0 if c == "EUR" else float(np.exp(v))) for c, v in state.items()}

    def static_rate(self, ccy: str) -> float:
        return geo.FX_BASE[ccy]

    def fx_convert(self, amount_minor: int, from_ccy: str, to_ccy: str, d: dt.date, markup: float) -> tuple[int, float]:
        """Return (converted minor units, rate to_ccy per 1 from_ccy incl. markup)."""
        r = self.fx[d]
        rate = r[to_ccy] / r[from_ccy] * (1 + markup)
        return max(1, int(round(amount_minor * rate))), round(rate, 6)

    def person_name(self, cc: str, lang: str, rng, gender: str | None = None) -> tuple[str, str, str]:
        country = self.countries.get(cc) or geo.COUNTRIES[cc]
        f = self.faker(geo.locale_for(country, lang), rng)
        gender = gender or ("F" if rng.random() < 0.5 else "M")
        if gender == "F":
            first = f.first_name_female()
            last = lt_female(f.last_name_male()) if lang == "lt" else _try(f, "last_name_female", "last_name")
        else:
            first = f.first_name_male()
            last = _try(f, "last_name_male", "last_name")
        return first, last, gender

    def surname(self, cc: str, lang: str, rng) -> str:
        return self.person_name(cc, lang, rng, "M")[1]

    def company_name(self, cc: str, lang: str, rng, sector: str | None = None) -> str:
        suffix = BUSINESS_SUFFIX[cc][int(rng.integers(0, len(BUSINESS_SUFFIX[cc])))]
        word = SECTOR_WORDS.get(sector or "tech", SECTOR_WORDS["tech"])[lang]
        r = rng.random()
        if r < 0.45:
            core = f"{self.surname(cc, lang, rng)} {word}"
        elif r < 0.65:
            core = f"{self.surname(cc, lang, rng)} & {self.surname(cc, lang, rng)}"
        else:
            core = SYLL_A[int(rng.integers(0, len(SYLL_A)))] + SYLL_B[int(rng.integers(0, len(SYLL_B)))]
            core = f"{core} {word}"
        return f"{core} {suffix}"

    def new_iban(self, cc: str, rng) -> str:
        return self.iban.generate(cc, rng)[0]

    def shared_counterparty(self, key: str, cc: str, name: str) -> tuple[str, str]:
        """Stable (name, IBAN) for billers, authorities, acquirers, keyed per country."""
        k = f"{key}:{cc}"
        if k not in self._cp_cache:
            rng = np.random.default_rng([self.seed, 7, abs(hash_str(k)) % (2**31)])
            self._cp_cache[k] = (name, self.new_iban(cc, rng))
        return self._cp_cache[k]

    def schedule(self, d: dt.date, fn):
        if self.start <= d <= self.end:
            self.calendar.setdefault(d, []).append(fn)

    # ---------- events ----------
    def push(self, ev: Event):
        if ev.ts >= self.end_utc:
            return
        self._seq += 1
        ev.seq = self._seq
        heapq.heappush(self.heap, (ev.ts, ev.seq, ev))

    def event(self, **kw) -> Event:
        ev = Event(**kw)
        self.push(ev)
        return ev

    def run(self, progress=None):
        for i, d in enumerate(self.days):
            for fn in self.calendar.pop(d, ()):
                fn(d)
            for p in self.personas:
                if p.active_from <= d:
                    p.daily(d)
            # earliest possible local midnight of the next day across Europe is UTC+3
            horizon = dt.datetime.combine(d + dt.timedelta(1), dt.time(0), tzinfo=UTC) - dt.timedelta(hours=3)
            self._apply_until(horizon)
            if progress and i % 30 == 0:
                progress(d)
        self._apply_until(self.end_utc)

    def _apply_until(self, horizon: dt.datetime):
        heap = self.heap
        while heap and heap[0][0] < horizon:
            _, _, ev = heapq.heappop(heap)
            self._apply(ev)

    def _apply(self, ev: Event):
        acct: Account = ev.acct
        amount = ev.dyn(acct) if ev.dyn else ev.amount
        if amount is None or amount <= 0:
            return
        day = ev.ts.astimezone(self.tz(acct.tz)).date()
        if (acct.closed and day > acct.closed) or day < acct.opened:
            return
        status, reason = "booked", None
        r = self.engine_rng.random()
        cp_closed = ev.cp_acct is not None and (
            (ev.cp_acct.closed and day > ev.cp_acct.closed) or day < ev.cp_acct.opened)
        if ev.force:
            status, reason = ev.force
        elif ev.direction == "debit":
            if cp_closed:
                status, reason = "failed", "beneficiary_account_closed"
            elif amount > acct.balance + acct.overdraft:
                status, reason = "failed", "insufficient_funds"
            elif ev.ttype == "card":
                if r < self.decline_rate:
                    status, reason = "failed", ("card_declined" if r < self.decline_rate * 0.6 else "technical_error")
                elif r < self.decline_rate + self.reversal_rate:
                    status, reason = "reversed", "authorization_reversed"
            elif ev.ttype in ("sepa_direct_debit", "domestic_direct_debit") and r < self.tech_fail_rate:
                status, reason = "failed", "technical_error"
        if status == "booked" and ev.ts >= self.pending_cutoff and (
                ev.ttype == "card" or (ev.direction == "debit" and ev.ttype in ("sepa_credit_transfer",
                                                                                "domestic_transfer"))):
            status = "pending"
        effect = 0
        if status in ("booked", "pending"):
            effect = amount if ev.direction == "credit" else -amount
            acct.balance += effect
        ev.status = status
        self._row(ev, acct, amount, status, reason)
        if status in ("booked", "pending") and ev.cp_acct is not None:
            # two-leg transfers are always created as the payer's debit; mirror is the payee's credit
            assert ev.direction == "debit", "two-leg events must be created on the paying account"
            cp: Account = ev.cp_acct
            m_amount = ev.mirror_amount or amount
            cp.balance += m_amount
            mirror = Event(ts=ev.ts, acct=cp, direction="credit",
                           ttype=ev.ttype, category=ev.category, cp_name=acct.owner_name, cp_iban=acct.iban,
                           cp_acct=acct, reference=ev.reference, tag=ev.tag,
                           orig_amount=amount if cp.currency != acct.currency else None,
                           orig_ccy=acct.currency if cp.currency != acct.currency else None,
                           fx_rate=round(m_amount / amount, 6) if cp.currency != acct.currency else None)
            self._row(mirror, cp, m_amount, status, None)
        elif status == "failed" and ev.on_fail:
            ev.on_fail(ev)

    def _row(self, ev: Event, acct: Account, amount: int, status: str, reason):
        self._txn_n += 1
        tid = make_id("txn", self.seed, self._txn_n, 16)
        self.rows.append((
            tid, acct.id, acct.customer_id, ev.ts, amount, acct.currency, ev.direction, ev.ttype, ev.category,
            ev.merchant_id, ev.cp_name, ev.cp_iban, ev.cp_acct.id if ev.cp_acct is not None else None,
            ev.reference, status, reason, acct.balance, ev.orig_amount, ev.orig_ccy, ev.fx_rate, acct.tz, ev.tag,
            self._txn_n,
        ))


def _try(f, *names):
    for n in names:
        fn = getattr(f, n, None)
        if fn:
            try:
                return fn()
            except (AttributeError, TypeError):
                continue
    return f.last_name()


def hash_str(s: str) -> int:
    import hashlib
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=6).digest(), "big")
