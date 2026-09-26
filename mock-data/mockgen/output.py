"""Write frames to disk (CSV / Parquet / JSONL) plus a manifest with row counts and hashes."""
from __future__ import annotations

import hashlib
import json
import platform
from importlib import metadata
from pathlib import Path

import pandas as pd

MONEY = {"amount", "balance_after", "original_amount", "balance", "opening_balance", "overdraft_limit"}


def _csv_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in df.columns:
        if c in MONEY:
            df[c] = df[c].map(lambda v: "" if pd.isna(v) else f"{v:.2f}")
        elif c == "fx_rate":
            df[c] = df[c].map(lambda v: "" if pd.isna(v) else f"{v:.6f}")
    return df


def write_all(frames: dict[str, pd.DataFrame], cfg: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    formats = cfg["output"]["formats"]
    files = {}
    for name, df in frames.items():
        if name == "transactions":
            df = df.drop(columns=["seq"])
        if "csv" in formats:
            p = out_dir / f"{name}.csv"
            _csv_frame(df).to_csv(p, index=False, encoding="utf-8", lineterminator="\n")
            files[p.name] = p
        if "jsonl" in formats:
            p = out_dir / f"{name}.jsonl"
            df.to_json(p, orient="records", lines=True, force_ascii=False, date_format="iso")
            files[p.name] = p
        if "parquet" in formats:
            p = out_dir / f"{name}.parquet"
            df.to_parquet(p, index=False)
            files[p.name] = p
    manifest = {
        "seed": cfg["seed"],
        "period": {"start": str(cfg["_start"]), "end": str(cfg["_end"])},
        "rows": {k: int(len(v)) for k, v in frames.items()},
        "sha256": {k: hashlib.sha256(p.read_bytes()).hexdigest() for k, p in sorted(files.items())},
        "versions": {"python": platform.python_version(),
                     **{pkg: _ver(pkg) for pkg in ("faker", "schwifty", "numpy", "pandas")}},
        "demo": cfg.get("demo", {}),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def _ver(pkg):
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return None
