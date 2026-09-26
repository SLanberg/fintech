"""Config loading: YAML merged over defaults, dates resolved."""
from __future__ import annotations

import calendar
import copy
import datetime as dt
from pathlib import Path

import yaml

DEFAULTS: dict = {
    "seed": 42,
    "period": {"end_date": "today", "months": 12},
    "countries": ["DE", "FR", "NL", "ES", "IT", "PL", "EE", "LV", "LT", "FI", "IE", "AT", "BE", "PT", "SE", "CZ"],
    "country_weights": {"DE": 16, "FR": 13, "IT": 11, "ES": 10, "PL": 9, "NL": 7, "BE": 5, "SE": 5, "CZ": 5,
                        "PT": 5, "AT": 4, "FI": 3, "IE": 3, "LT": 2, "LV": 1.5, "EE": 1.5},
    "scale": {"customers": 300, "business_share": 0.15, "local_merchants_per_country": 90},
    "profiles": {"student": 0.14, "salaried": 0.52, "freelancer": 0.12, "retiree": 0.22},
    "business_sectors": {"cafe": 0.25, "retail": 0.2, "consulting": 0.25, "construction": 0.15, "design": 0.15},
    "accounts": {
        "savings_share": 0.35,
        "eur_account_share_non_euro": 0.4,
        "overdraft_share": 0.2,
        "new_customer_share": 0.07,
        "closed_savings_share": 0.05,
    },
    "behaviour": {
        "card_decline_rate": 0.004,
        "card_reversal_rate": 0.004,
        "refund_rate": 0.05,
        "technical_fail_rate": 0.002,
        "pending_days": 2,
        "card_fx_markup": 0.0125,
        "cross_border_employer_share": 0.12,
        "linked_employer_share": 0.3,
        "trips_per_year": {"student": 1.0, "salaried": 1.6, "freelancer": 2.0, "retiree": 1.3},
        "p2p_per_month": 1.3,
    },
    "email_domains": ["example.com", "example.net", "example.org"],
    "output": {"dir": "out", "formats": ["csv"]},
    "scenarios": [],
    "demo": {"product": "", "extra_entities": []},
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k not in ("country_weights", "profiles",
                                                                             "business_sectors"):
            out[k] = _merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_config(path: str | Path | None, overrides: dict | None = None) -> dict:
    user = {}
    if path:
        with open(path, encoding="utf-8") as fh:
            user = yaml.safe_load(fh) or {}
    cfg = _merge(DEFAULTS, user)
    if overrides:
        cfg = _merge(cfg, overrides)

    end = cfg["period"]["end_date"]
    if end in (None, "today"):
        end_date = dt.date.today()
    elif isinstance(end, dt.date):
        end_date = end
    else:
        end_date = dt.date.fromisoformat(str(end))
    months = int(cfg["period"]["months"])
    y, m = end_date.year, end_date.month - months
    while m <= 0:
        m += 12
        y -= 1
    day = min(end_date.day, calendar.monthrange(y, m)[1])
    start_date = dt.date(y, m, day) + dt.timedelta(days=1)
    cfg["_start"] = start_date
    cfg["_end"] = end_date

    unknown = [c for c in cfg["countries"] if c not in cfg["country_weights"]]
    for c in unknown:
        cfg["country_weights"][c] = 1.0
    return cfg
