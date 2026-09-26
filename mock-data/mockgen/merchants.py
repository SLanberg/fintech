"""Merchant generation: local shops per country/city, fictional chains, online brands."""
from __future__ import annotations

import re

import numpy as np

from . import geo
from .banking import make_id
from .catalog import CATEGORIES, SUBSCRIPTIONS, TRADEMARK_BLOCKLIST
from .locale_text import LOCAL_MERCHANT_TPL

LOCAL_MIX = {"groceries": 5, "bakery": 5, "restaurant": 10, "cafe": 6, "bar": 6, "pharmacy": 4, "hair_beauty": 3,
             "clothing": 3, "hotel": 3}
ONLINE_HQ = ["IE", "NL", "DE", "EE", "LT", "FI", "SE", "FR"]
_BLOCK_RE = re.compile(r"\b(" + "|".join(re.escape(b) for b in sorted(TRADEMARK_BLOCKLIST)) + r")\b", re.I)


def is_blocked(name: str) -> bool:
    return bool(_BLOCK_RE.search(name))


def build_merchants(world) -> None:
    rng = np.random.default_rng([world.seed, 2])
    n = 0
    per_country = world.cfg["scale"]["local_merchants_per_country"]
    base_total = sum(LOCAL_MIX.values())
    extra_brands = world.cfg.get("merchants", {}).get("extra_brands", {}) if world.cfg.get("merchants") else {}

    def add(name, cc, city, cat, kind, owner=None):
        nonlocal n
        n += 1
        c = CATEGORIES[cat]
        m = dict(id=make_id("mer", world.seed, n, 12), name=name, country=cc, city=city, mcc=c.mcc, category=cat,
                 category_label=c.label, merchant_type=kind, owner_customer_id=owner)
        world.merchants.append(m)
        world.merchant_by_id[m["id"]] = m
        return m

    for cc, country in world.countries.items():
        seen = set()
        for cat, weight in LOCAL_MIX.items():
            count = max(2, round(per_country * weight / base_total))
            for _ in range(count):
                for _attempt in range(20):
                    city = geo.pick_city(country, rng)
                    lang = geo.city_lang(country, city)
                    first, last, _ = world.person_name(cc, lang, rng)
                    tpls = LOCAL_MERCHANT_TPL[lang][cat]
                    name = tpls[int(rng.integers(0, len(tpls)))].format(s=last, f=first, c=city.name)
                    if name not in seen and not is_blocked(name):
                        break
                seen.add(name)
                m = add(name, cc, city.name, cat, "local")
                world.local_merchants.setdefault((cc, cat), []).append(m["id"])
        # chains: each fictional brand operates in a subset of countries
        for cat, c in CATEGORIES.items():
            brands = list(c.brands) + list(extra_brands.get(cat, []))
            if c.online or not brands:
                continue
            present = [b for b in brands if rng.random() < 0.7] or [brands[int(rng.integers(0, len(brands)))]]
            for b in present:
                m = add(b, cc, None, cat, "chain")
                world.brand_merchants.setdefault((cc, cat), []).append(m["id"])

    for cat, c in CATEGORIES.items():
        if not c.online:
            continue
        brands = list(c.brands) + list(extra_brands.get(cat, []))
        if cat == "subscription":
            brands += [name for name, _ in SUBSCRIPTIONS]
        for b in brands:
            hq = ONLINE_HQ[int(rng.integers(0, len(ONLINE_HQ)))]
            m = add(b, hq, None, cat, "online")
            world.online_merchants.setdefault(cat, []).append(m["id"])


def add_business_merchant(world, cust: dict, cat: str) -> str:
    """Café/retail business customers also appear as merchants other customers can pay by card."""
    c = CATEGORIES[cat]
    mid = make_id("mer", world.seed, 100000 + len(world.merchants), 12)
    m = dict(id=mid, name=cust["trading_name"], country=cust["country"], city=cust["city"], mcc=c.mcc, category=cat,
             category_label=c.label, merchant_type="local", owner_customer_id=cust["id"])
    world.merchants.append(m)
    world.merchant_by_id[mid] = m
    world.local_merchants.setdefault((cust["country"], cat), []).append(mid)
    return mid
