"""Post-generation integrity checks. Every check must pass or generate.py exits non-zero."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
from schwifty import IBAN

from .catalog import TRADEMARK_BLOCKLIST
from .merchants import is_blocked

EFFECTIVE = {"booked", "pending"}
TRANSFER_TYPES = {"sepa_credit_transfer", "sepa_instant", "sepa_direct_debit", "domestic_transfer",
                  "domestic_instant", "domestic_direct_debit", "internal"}


def run_checks(frames: dict[str, pd.DataFrame], cfg: dict) -> list[tuple[str, bool, str]]:
    cust, acc, mer, tx = frames["customers"], frames["accounts"], frames["merchants"], frames["transactions"]
    out = []

    def check(name, ok, detail=""):
        out.append((name, bool(ok), detail))

    # identifiers
    for name, df in (("customers", cust), ("accounts", acc), ("merchants", mer), ("transactions", tx)):
        check(f"unique ids: {name}", df["id"].is_unique, f"{len(df)} rows")
    check("accounts -> customers FK", acc.customer_id.isin(cust.id).all())
    check("transactions -> accounts FK", tx.account_id.isin(acc.id).all())
    card = tx[tx.type == "card"]
    check("card transactions have merchant_id", card.merchant_id.notna().all() and card.merchant_id.isin(mer.id).all(),
          f"{len(card)} card rows")

    # IBANs
    bad = []
    for iban, bic in zip(acc.iban, acc.bic):
        try:
            obj = IBAN(iban, validate_bban=True)
            if obj.bic is not None and str(obj.bic)[:8] != bic[:8]:
                bad.append(f"{iban} bic {bic}!={obj.bic}")
        except Exception as e:  # noqa: BLE001
            bad.append(f"{iban}: {e}")
    check("account IBANs valid (incl. national check digits) and BIC matches", not bad, "; ".join(bad[:3]))
    cp = tx.counterparty_iban.dropna().unique()
    bad = [i for i in cp if not IBAN(i, allow_invalid=True).is_valid]
    check("counterparty IBANs valid", not bad, f"{len(cp)} distinct; bad: {bad[:3]}")
    xfer = tx[tx.type.isin(TRANSFER_TYPES)]
    check("transfers carry counterparty IBAN", xfer.counterparty_iban.notna().all(), f"{len(xfer)} rows")

    # currencies
    ccy = acc.set_index("id").currency
    check("transaction currency == account currency", (tx.currency.values == ccy.loc[tx.account_id].values).all())
    fx = tx[tx.original_currency.notna()]
    check("FX rows have original amount + rate", fx.original_amount.notna().all() and fx.fx_rate.notna().all()
          and (fx.original_currency != fx.currency).all(), f"{len(fx)} rows")

    # balances: opening + sequential effects == balance_after; last == account balance
    eff = np.where(tx.status.isin(EFFECTIVE), np.where(tx.direction == "credit", 1, -1), 0) * np.round(tx.amount * 100)
    tx2 = tx.assign(_eff=eff.astype(np.int64), _bal=np.round(tx.balance_after * 100).astype(np.int64))
    opening = (acc.set_index("id").opening_balance * 100).round().astype(np.int64)
    tx2["_expected"] = tx2.groupby("account_id")["_eff"].cumsum() + opening.loc[tx2.account_id].values
    mism = tx2[tx2._expected != tx2._bal]
    check("balance_after is sequentially consistent", mism.empty, f"{len(mism)} mismatches")
    last = tx2.groupby("account_id")["_bal"].last()
    final = (acc.set_index("id").balance * 100).round().astype(np.int64)
    no_tx = final[~final.index.isin(last.index)]
    check("account.balance == last balance_after",
          (last == final.loc[last.index]).all() and (no_tx == opening.loc[no_tx.index]).all())
    od = (acc.set_index("id").overdraft_limit * 100).round().astype(np.int64)
    below = tx2[tx2._bal < -od.loc[tx2.account_id].values]
    check("no balance below overdraft limit (0 without overdraft)", below.empty, f"{len(below)} rows")
    neg_no_od = tx2[(tx2._bal < 0) & (od.loc[tx2.account_id].values == 0)]
    check("no negative balances on accounts without overdraft", neg_no_od.empty)

    # two-leg transfers mirrored
    legs = tx[tx.counterparty_account_id.notna() & tx.status.isin(EFFECTIVE)]
    deb = legs[legs.direction == "debit"].set_index(["account_id", "counterparty_account_id", "timestamp"]).index
    cre = legs[legs.direction == "credit"].set_index(["counterparty_account_id", "account_id", "timestamp"]).index
    check("internal/P2P transfers have both legs", deb.sort_values().equals(cre.sort_values()), f"{len(deb)} pairs")

    # period & opening dates
    start, end = str(cfg["_start"]), str(cfg["_end"])
    check("timestamps inside period", tx.timestamp.min() >= str(cfg["_start"] - dt.timedelta(days=1))
          and tx.timestamp.max() <= end + "T23:59:59Z", f"{tx.timestamp.min()} .. {tx.timestamp.max()}")
    closed = acc[acc.closed_at.notna()].set_index("id").closed_at
    after = tx[tx.account_id.isin(closed.index)]
    after = after[after.timestamp.str[:10] > closed.loc[after.account_id].values]
    check("no activity after account closure", after.empty)
    check("closed accounts have zero balance", (acc[acc.status == "closed"].balance.abs() < 0.005).all())

    # statuses & amounts
    check("valid statuses", tx.status.isin({"booked", "pending", "failed", "reversed"}).all(),
          tx.status.value_counts().to_dict().__repr__())
    check("amounts strictly positive", (tx.amount > 0).all())
    check("pending only in the last days", tx[tx.status == "pending"].timestamp.min() >= start if
          (tx.status == "pending").any() else True)

    # names
    blocked = [n for n in mer.name if is_blocked(n)]
    check("no blocklisted trademarks in merchant names", not blocked, str(blocked[:5]))
    check("trademark blocklist non-empty", len(TRADEMARK_BLOCKLIST) > 10)
    check("emails use configured domains", cust[cust.type == "individual"].email.str.split("@").str[1].isin(
        cfg["email_domains"]).all())
    return out
