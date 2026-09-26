"""IBAN/BIC generation and business registration numbers.

Bank codes and BICs are taken from schwifty's bundled registry (real institutions, so the BIC
lookup and national check digits work). Branch and account parts are random, and each IBAN is
re-validated with national BBAN checks (``validate_bban=True``); invalid draws are retried.
"""
from __future__ import annotations

import hashlib
import base64

from schwifty import IBAN, registry
from schwifty.domain import Component
from schwifty.exceptions import SchwiftyException

# Mainstream retail banks per country, by BIC institution prefix (first 4 chars).
RETAIL_BIC_PREFIXES = {
    "DE": ["DEUT", "COBA", "INGD", "PBNK", "HYVE", "NTSB", "GENO", "BYLA", "WELA", "HASP"],
    "FR": ["BNPA", "SOGE", "CRLY", "AGRI", "CMCI", "CCBP", "PSST", "CEPA", "BOUS"],
    "NL": ["INGB", "ABNA", "RABO", "SNSB", "TRIO", "BUNQ", "ASNB"],
    "ES": ["CAIX", "BBVA", "BSCH", "BSAB", "BKBK", "INGD", "UCJA", "CAGL"],
    "IT": ["BCIT", "UNCR", "BAPP", "PASC", "BNLI", "FEBI", "CRPP"],
    "PL": ["BPKO", "PKOP", "INGB", "BREX", "WBKP", "ALBP", "BIGB"],
    "EE": ["HABA", "EEUH", "LHVB", "RIKO", "EKRD"],
    "LV": ["HABA", "UNLA", "RIKO", "PARX"],
    "LT": ["HABA", "CBVI", "AGBL", "CBSB"],
    "FI": ["NDEA", "OKOY", "HELS", "DABA", "SBAN", "HAND"],
    "IE": ["AIBK", "BOFI", "IPBS"],
    "AT": ["BKAU", "GIBA", "RZBA", "RZOO", "BAWA", "OBKL", "VBOE"],
    "BE": ["GEBA", "BBRU", "KRED", "GKCC", "ARSP"],
    "PT": ["CGDI", "BCOM", "TOTA", "BESC", "BBPI", "ACTV"],
    "SE": ["SWED", "ESSE", "HAND", "NDEA"],
    "CZ": ["KOMB", "CEKO", "GIBA", "RZBC", "AIRA", "BREX", "FIOB"],
}
# Plausible sort-code prefixes for Irish banks (IBAN branch component)
IE_SORT_PREFIX = {"AIBK": "93", "BOFI": "90", "IPBS": "99"}


class IbanFactory:
    def __init__(self, countries):
        self._banks = {}
        for cc in countries:
            all_banks = [b for b in registry.get_banks_by_country(cc) if b.bic]
            groups: dict[str, list] = {}
            for b in all_banks:
                p = b.bic[:4]
                if p in RETAIL_BIC_PREFIXES.get(cc, []):
                    groups.setdefault(p, []).append(b)
            for p, bs in groups.items():
                prim = [b for b in bs if b.primary]
                groups[p] = sorted(prim or bs, key=lambda b: (b.bank_code, b.bic))
            if not groups:  # fallback: any primary bank
                prim = sorted([b for b in all_banks if b.primary] or all_banks, key=lambda b: (b.bank_code, b.bic))
                groups = {"*": prim[:30]}
            self._banks[cc] = [groups[k] for k in sorted(groups)]
        self._spec = {cc: registry.get_iban_spec(cc) for cc in countries}
        self._bad: set[tuple[str, str]] = set()

    def generate(self, cc: str, rng, bank=None) -> tuple[str, str, str]:
        """Return (IBAN compact, BIC, bank name) with valid IBAN and national check digits."""
        spec = self._spec[cc]
        pos = spec.positions
        bank_len = pos[Component.BANK_CODE].length
        branch_len = pos[Component.BRANCH_CODE].length
        acct_len = pos[Component.ACCOUNT_CODE].length
        if bank is None or (cc, bank.bank_code) in self._bad:
            bank = self.pick_bank(cc, rng)
        for attempt in range(600):
            if attempt and attempt % 150 == 0:  # bank-specific check algorithm keeps rejecting: switch bank
                self._bad.add((cc, bank.bank_code))
                bank = self.pick_bank(cc, rng)
            code = bank.bank_code
            branch = ""
            if branch_len and len(code) <= bank_len:
                if cc == "IE":
                    branch = IE_SORT_PREFIX.get(bank.bic[:4], "9" + str(int(rng.integers(0, 10)))) + \
                        "".join(str(int(d)) for d in rng.integers(0, 10, 4))
                elif cc == "CZ":  # "branch" is the account-number prefix, usually 000000
                    branch = "000000" if rng.random() < 0.9 else f"{int(rng.integers(1, 99)):06d}"
                else:
                    branch = "".join(str(int(d)) for d in rng.integers(0, 10, branch_len))
            digits = rng.integers(0, 10, acct_len)
            acct = "".join(str(int(d)) for d in digits)
            if acct.lstrip("0") == "":
                continue
            try:
                iban = IBAN.generate(cc, bank_code=code, branch_code=branch, account_code=acct)
                IBAN(iban.compact, validate_bban=True)
            except SchwiftyException:
                continue
            bic = iban.bic
            return iban.compact, (str(bic) if bic else bank.bic), (iban.bank_name or bank.name)
        raise RuntimeError(f"could not generate valid IBAN for {cc} bank {bank.bank_code}")

    def pick_bank(self, cc: str, rng):
        for _ in range(50):
            group = self._banks[cc][int(rng.integers(0, len(self._banks[cc])))]
            bank = group[int(rng.integers(0, len(group)))]
            if (cc, bank.bank_code) not in self._bad:
                return bank
        return bank


def fmt_iban(compact: str) -> str:
    return " ".join(compact[i:i + 4] for i in range(0, len(compact), 4))


def make_id(prefix: str, seed: int, n: int, length: int = 14) -> str:
    h = hashlib.blake2b(f"{seed}:{prefix}:{n}".encode(), digest_size=10).digest()
    return prefix + "_" + base64.b32encode(h).decode().lower().rstrip("=")[:length]


# --- business registration numbers (format-correct, check digits where the scheme is simple) ---

def _digits(rng, n, first_nonzero=False):
    d = [int(x) for x in rng.integers(0, 10, n)]
    if first_nonzero and d[0] == 0:
        d[0] = int(rng.integers(1, 10))
    return d


def _luhn_check(digits):
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def registration_number(cc: str, rng, city: str = "") -> str:
    if cc == "DE":
        return f"HRB {int(rng.integers(10000, 250000))} (Amtsgericht {city})"
    if cc == "AT":
        return f"FN {int(rng.integers(100000, 600000))}{'abcdfghikmpstvwxyz'[int(rng.integers(0, 18))]}"
    if cc == "FR":  # SIREN, Luhn
        d = _digits(rng, 8, True)
        d.append(_luhn_check(d))
        s = "".join(map(str, d))
        return f"{s[:3]} {s[3:6]} {s[6:]}"
    if cc == "NL":
        return "".join(map(str, _digits(rng, 8, True)))  # KvK
    if cc == "ES":  # CIF B + 7 digits + control digit
        d = _digits(rng, 7)
        a = sum(d[i] for i in (1, 3, 5))
        b = sum(sum(divmod(d[i] * 2, 10)) for i in (0, 2, 4, 6))
        c = (10 - (a + b) % 10) % 10
        return "B" + "".join(map(str, d)) + str(c)
    if cc == "IT":  # Partita IVA, Luhn variant
        d = _digits(rng, 10, True)
        d.append(_luhn_check(d))
        return "IT" + "".join(map(str, d))
    if cc == "PL":  # KRS
        return "KRS 0000" + "".join(map(str, _digits(rng, 6)))
    if cc == "EE":  # registry code 1xxxxxxx with 7-3-1 style mod-11 check
        d = [1] + _digits(rng, 6)
        w1 = [1, 2, 3, 4, 5, 6, 7]
        c = sum(a * b for a, b in zip(d, w1)) % 11
        if c == 10:
            c = sum(a * b for a, b in zip(d, [3, 4, 5, 6, 7, 8, 9])) % 11 % 10
        return "".join(map(str, d + [c]))
    if cc == "LV":
        return "4000" + "".join(map(str, _digits(rng, 7)))
    if cc == "LT":
        return "30" + "".join(map(str, _digits(rng, 7)))
    if cc == "FI":  # Y-tunnus
        while True:
            d = _digits(rng, 7)
            r = sum(a * b for a, b in zip(d, [7, 9, 10, 5, 8, 4, 2])) % 11
            if r != 1:
                return "".join(map(str, d)) + "-" + str(0 if r == 0 else 11 - r)
    if cc == "IE":
        return "CRO " + str(int(rng.integers(500000, 780000)))
    if cc == "BE":  # enterprise number 0xxx.xxx.xxx, mod 97
        base = int("0" + "".join(map(str, _digits(rng, 7, True))))
        base = base if base >= 2000000 else base + 2000000
        chk = 97 - (base % 97)
        s = f"{base:08d}{chk:02d}"
        return f"{s[:4]}.{s[4:7]}.{s[7:]}"
    if cc == "PT":  # NIPC 5xxxxxxxC mod 11
        d = [5] + _digits(rng, 7)
        r = sum(a * b for a, b in zip(d, range(9, 1, -1))) % 11
        return "".join(map(str, d)) + str(0 if r < 2 else 11 - r)
    if cc == "SE":  # organisationsnummer 55xxxx-xxxC, Luhn
        d = [5, 5] + _digits(rng, 7)
        d.append(_luhn_check(d))
        s = "".join(map(str, d))
        return f"{s[:6]}-{s[6:]}"
    if cc == "CZ":  # IČO mod 11
        d = _digits(rng, 7, True)
        r = sum(a * b for a, b in zip(d, range(8, 1, -1))) % 11
        c = (11 - r) % 10
        return "".join(map(str, d)) + str(c)
    return "".join(map(str, _digits(rng, 9, True)))
