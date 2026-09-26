"""Reproducible mock-data generator for a European fintech prototype.

    python generate.py --config config.yaml
    python generate.py --config config.yaml --seed 7 --customers 50 --out out/small
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from mockgen.config import load_config
from mockgen.output import write_all
from mockgen.pipeline import build_world, to_frames
from mockgen.validate import run_checks


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--seed", type=int, help="override config seed")
    ap.add_argument("--customers", type=int, help="override scale.customers")
    ap.add_argument("--end-date", help="override period.end_date (YYYY-MM-DD or 'today')")
    ap.add_argument("--out", help="override output.dir")
    ap.add_argument("--no-validate", action="store_true", help="skip integrity checks")
    args = ap.parse_args(argv)

    over: dict = {}
    if args.seed is not None:
        over["seed"] = args.seed
    if args.customers is not None:
        over.setdefault("scale", {})["customers"] = args.customers
    if args.end_date:
        over.setdefault("period", {})["end_date"] = args.end_date
    if args.out:
        over.setdefault("output", {})["dir"] = args.out
    cfg = load_config(args.config, over)

    t0 = time.time()
    print(f"seed={cfg['seed']} period={cfg['_start']}..{cfg['_end']} customers={cfg['scale']['customers']} "
          f"countries={','.join(cfg['countries'])}")
    world = build_world(cfg)
    world.run(progress=lambda d: print(f"  simulating {d:%Y-%m}", end="\r", flush=True))
    print(" " * 40, end="\r")
    frames = to_frames(world)
    tx = frames["transactions"]
    print(f"  generated {len(frames['customers'])} customers, {len(frames['accounts'])} accounts, "
          f"{len(frames['merchants'])} merchants, {len(tx)} transactions in {time.time() - t0:.1f}s")

    ok = True
    if not args.no_validate:
        for name, passed, detail in run_checks(frames, cfg):
            ok &= passed
            if not passed:
                print(f"  FAIL  {name}  {detail}")
        print("  validation: " + ("all checks passed" if ok else "FAILED"))

    out = Path(cfg["output"]["dir"])
    manifest = write_all(frames, cfg, out)
    print(f"  wrote {', '.join(f'{k}={v}' for k, v in manifest['rows'].items())} -> {out.resolve()}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
