"""Build the population, run the simulation, assemble DataFrames."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from .merchants import build_merchants
from .personas import Business, Individual
from .scenarios import build_scenarios, scenario_index, showcase_index
from .world import World

TX_COLUMNS = ["id", "account_id", "customer_id", "timestamp", "amount", "currency", "direction", "type", "category",
              "merchant_id", "counterparty_name", "counterparty_iban", "counterparty_account_id", "reference", "status",
              "status_reason", "balance_after", "original_amount", "original_currency", "fx_rate", "timezone",
              "scenario_tag", "seq"]


def _pick(rng, weights: dict):
    keys = sorted(weights)
    w = np.array([weights[k] for k in keys], dtype=float)
    return keys[int(rng.choice(len(keys), p=w / w.sum()))]


def build_world(cfg, log=print) -> World:
    world = World(cfg)
    build_merchants(world)
    rng = np.random.default_rng([world.seed, 3])
    n = int(cfg["scale"]["customers"])
    n_biz = int(round(n * cfg["scale"]["business_share"]))
    cw = {c: cfg["country_weights"][c] for c in cfg["countries"]}
    new_share = cfg["accounts"]["new_customer_share"]

    businesses = []
    for i in range(n_biz):
        cc = _pick(rng, cw)
        sector = _pick(rng, cfg["business_sectors"])
        businesses.append(Business(world, i + 1, cc, sector, rng.random() < new_share * 0.5))
    by_cc: dict[str, list] = {}
    for b in businesses:
        b.setup(by_cc)
        by_cc.setdefault(b.cc, []).append(b)

    individuals = []
    for i in range(n - n_biz):
        cc = _pick(rng, cw)
        prof = _pick(rng, cfg["profiles"])
        p = Individual(world, n_biz + i + 1, cc, prof, rng.random() < new_share)
        p.setup(by_cc)
        individuals.append(p)
    log(f"  population: {len(individuals)} individuals, {len(businesses)} businesses")

    scen = build_scenarios(world, by_cc)
    everyone = individuals + scen
    # friendship graph for P2P: mostly same-country dataset customers, some external people
    by_country: dict[str, list] = {}
    for p in everyone:
        by_country.setdefault(p.cc, []).append(p)
    frng = np.random.default_rng([world.seed, 4])
    for p in everyone:
        peers = [q for q in by_country[p.cc] if q is not p]
        k = min(len(peers), int(frng.integers(1, 5)))
        p.friends = [peers[int(j)] for j in frng.choice(len(peers), k, replace=False)] if k else []
        for _ in range(int(frng.integers(1, 4))):
            f, l, _ = world.person_name(p.cc, p.lang, frng)
            p.friends.append((f"{f} {l}", world.new_iban(p.cc, frng)))

    world.personas = businesses + individuals + scen
    world.scenario_personas = scen
    world.customers = [p.cust for p in world.personas]
    return world


def to_frames(world: World) -> dict[str, pd.DataFrame]:
    cust = pd.DataFrame(world.customers)
    cust["created_at"] = cust["created_at"].map(lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ"))
    cols = ["id", "type", "name", "first_name", "last_name", "trading_name", "country", "city", "postcode", "address",
            "email", "phone", "date_of_birth", "registration_number", "created_at", "timezone", "language", "segment",
            "sector"]
    if "trading_name" not in cust:
        cust["trading_name"] = None
    cust = cust[cols]

    accts = pd.DataFrame([dict(
        id=a.id, customer_id=a.customer_id, iban=a.iban, bic=a.bic, bank_name=a.bank_name, currency=a.currency,
        account_type=a.kind, balance=a.balance / 100, opening_balance=a.opening_balance / 100,
        overdraft_limit=a.overdraft / 100, has_overdraft=a.overdraft > 0, opened_at=a.opened.isoformat(),
        closed_at=a.closed.isoformat() if a.closed else None, status=a.status) for a in world.accounts.values()])

    merch = pd.DataFrame(world.merchants)

    tx = pd.DataFrame(world.rows, columns=TX_COLUMNS)
    tx["timestamp"] = tx["timestamp"].map(lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ"))
    for c in ("amount", "balance_after"):
        tx[c] = tx[c] / 100
    tx["original_amount"] = tx["original_amount"].map(lambda v: None if pd.isna(v) else v / 100)
    tx = tx.sort_values("seq", kind="stable").reset_index(drop=True)

    scen = pd.DataFrame(scenario_index(world, world.scenario_personas, tx) + showcase_index(world),
                        columns=["scenario", "type", "description", "customer_id", "customer_name", "account_id",
                                 "iban", "detail", "transaction_ids"])
    return dict(customers=cust, accounts=accts, merchants=merch, transactions=tx, scenarios=scen)
