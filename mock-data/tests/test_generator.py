"""Run with: python -m pytest -q"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest
from schwifty import IBAN

from generate import main
from mockgen.catalog import round_price
from mockgen.config import load_config
from mockgen.output import write_all
from mockgen.pipeline import build_world, to_frames
from mockgen.validate import run_checks

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config.yaml"
SMALL = {"scale": {"customers": 40}, "period": {"end_date": "2026-09-26"}}


def _generate(tmp: Path, **over):
    cfg = load_config(CONFIG, {**SMALL, **over, "output": {"dir": str(tmp), "formats": ["csv"]}})
    world = build_world(cfg, log=lambda *a: None)
    world.run()
    frames = to_frames(world)
    manifest = write_all(frames, cfg, tmp)
    return cfg, frames, manifest


@pytest.fixture(scope="module")
def run_a(tmp_path_factory):
    return _generate(tmp_path_factory.mktemp("a"))


def test_same_seed_same_bytes(run_a, tmp_path):
    _, _, m2 = _generate(tmp_path)
    assert run_a[2]["sha256"] == m2["sha256"]


def test_different_seed_differs(run_a, tmp_path):
    _, _, m2 = _generate(tmp_path, seed=7)
    assert run_a[2]["sha256"]["transactions.csv"] != m2["sha256"]["transactions.csv"]


def test_all_integrity_checks_pass(run_a):
    cfg, frames, _ = run_a
    failed = [(n, d) for n, ok, d in run_checks(frames, cfg) if not ok]
    assert not failed, failed


def test_ibans_country_correct(run_a):
    _, frames, _ = run_a
    acc = frames["accounts"].merge(frames["customers"][["id", "country"]], left_on="customer_id", right_on="id")
    for iban, country in zip(acc.iban, acc.country):
        assert IBAN(iban, validate_bban=True).country_code == country


def test_currency_rules(run_a):
    _, frames, _ = run_a
    acc = frames["accounts"].merge(frames["customers"][["id", "country"]], left_on="customer_id", right_on="id")
    home = {"PL": "PLN", "SE": "SEK", "CZ": "CZK"}
    for ccy, country in zip(acc.currency, acc.country):
        assert ccy in ("EUR", home.get(country, "EUR"))


def test_scenarios_materialise(run_a):
    _, frames, _ = run_a
    s = frames["scenarios"].set_index("type")
    assert "WARNING" not in s.loc["failed_payments", "detail"]
    assert s.loc["fraud_burst", "transaction_ids"].count(";") >= 7
    tx = frames["transactions"]
    od = tx[tx.account_id == s.loc["overdraft_user", "account_id"]]
    assert (od.balance_after < 0).mean() > 0.3


def test_price_rounding_looks_like_prices():
    import numpy as np
    rng = np.random.default_rng(0)
    charm = [round_price(x, "charm", "EUR", rng) % 100 for x in np.linspace(3, 90, 200)]
    assert set(charm) <= {99, 49, 95, 0}
    assert all(round_price(x, "charm", "CZK", rng) % 100 == 0 for x in np.linspace(30, 3000, 50))


def test_cli_smoke(tmp_path):
    rc = main(["--config", str(CONFIG), "--customers", "12", "--end-date", "2026-06-30", "--out", str(tmp_path)])
    assert rc == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["period"] == {"start": "2025-07-01", "end": "2026-06-30"}
    tx = pd.read_csv(tmp_path / "transactions.csv")
    assert tx.timestamp.str.endswith("Z").all()
    assert hashlib.sha256((tmp_path / "transactions.csv").read_bytes()).hexdigest() == \
        manifest["sha256"]["transactions.csv"]
