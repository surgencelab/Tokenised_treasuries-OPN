"""Current-state supply snapshots for non-EVM deployments (Phase 2A).

Each chain's own public API is the source; no keys required. Rows land in
raw.supply_snapshots (decimal-adjusted), registry rows in ref.products with
data_mode='snapshot'. Run on the same cadence as refresh.sh.
"""

import csv
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg
import requests

from config import DATABASE_URL

SEED = Path(__file__).resolve().parent.parent / "seeds" / "products_nonevm.csv"
NOW = datetime.now(timezone.utc)

s = requests.Session()


def get(url, **kw):
    r = s.get(url, timeout=30, **kw)
    r.raise_for_status()
    return r.json()


def post(url, payload, retries=5):
    for attempt in range(retries):
        r = s.post(url, json=payload, timeout=30)
        if r.status_code == 200:
            body = r.json()
            err = body.get("error") if isinstance(body, dict) else None
            if err and ("429" in str(err) or "Too many" in str(err)):
                time.sleep(3 * (attempt + 1))
                continue
            return body
        if r.status_code in (429, 500, 502, 503):
            time.sleep(3 * (attempt + 1))
            continue
        r.raise_for_status()
    raise Exception(f"POST {url} failed after {retries} tries")


def snap_stellar(identifier):
    code, issuer = identifier.split(":")
    j = get(
        "https://horizon.stellar.org/assets",
        params={"asset_code": code, "asset_issuer": issuer},
    )
    rec = j["_embedded"]["records"][0]
    b = rec["balances"]
    # total issued: account trustlines (all auth states) + claimable balances
    # + AMM pools + Soroban contract holdings
    supply = (
        Decimal(b["authorized"])
        + Decimal(b["authorized_to_maintain_liabilities"])
        + Decimal(b["unauthorized"])
        + Decimal(rec.get("claimable_balances_amount", 0))
        + Decimal(rec.get("liquidity_pools_amount", 0))
        + Decimal(rec.get("contracts_amount", 0))
    )
    return (
        supply,
        rec["accounts"]["authorized"],
        "horizon.stellar.org /assets (total issued)",
    )


def snap_aptos(identifier):
    q = """query($t: String!) {
      fungible_asset_metadata(where: {asset_type: {_eq: $t}}) {
        decimals supply_v2
      }
    }"""
    j = post(
        "https://api.mainnet.aptoslabs.com/v1/graphql",
        {"query": q, "variables": {"t": identifier}},
    )
    m = j["data"]["fungible_asset_metadata"][0]
    if m["supply_v2"] is not None:
        return (
            Decimal(m["supply_v2"]) / Decimal(10) ** m["decimals"],
            None,
            "aptos indexer fungible_asset_metadata",
        )
    # legacy coin standard: supply lives in the issuer's CoinInfo resource
    account = identifier.split("::")[0]
    res = get(
        f"https://api.mainnet.aptoslabs.com/v1/accounts/{account}"
        f"/resource/0x1::coin::CoinInfo<{identifier}>"
    )
    supply = Decimal(res["data"]["supply"]["vec"][0]["integer"]["vec"][0]["value"])
    return (
        supply / Decimal(10) ** m["decimals"],
        None,
        "aptos REST CoinInfo supply",
    )


def snap_solana(identifier):
    time.sleep(2)  # public RPC is strict about getTokenSupply rates
    j = post(
        "https://api.mainnet-beta.solana.com",
        {"jsonrpc": "2.0", "id": 1, "method": "getTokenSupply",
         "params": [identifier]},
    )
    v = j["result"]["value"]
    return Decimal(v["uiAmountString"]), None, "solana getTokenSupply"


def snap_sui(identifier):
    j = post(
        "https://fullnode.mainnet.sui.io",
        {"jsonrpc": "2.0", "id": 1, "method": "suix_getTotalSupply",
         "params": [identifier]},
    )
    raw = Decimal(j["result"]["value"])
    meta = post(
        "https://fullnode.mainnet.sui.io",
        {"jsonrpc": "2.0", "id": 1, "method": "suix_getCoinMetadata",
         "params": [identifier]},
    )
    return (
        raw / Decimal(10) ** meta["result"]["decimals"],
        None,
        "sui suix_getTotalSupply",
    )


def snap_noble(identifier):
    j = get(
        "https://noble-api.polkachu.com/cosmos/bank/v1beta1/supply/by_denom",
        params={"denom": identifier},
    )
    # ausdy is atto-USDY (18 decimals)
    return (
        Decimal(j["amount"]["amount"]) / Decimal(10) ** 18,
        None,
        "noble LCD supply/by_denom",
    )


def snap_xrpl(identifier):
    currency, issuer = identifier.split(".")
    j = post(
        "https://s1.ripple.com:51234/",
        {"method": "gateway_balances",
         "params": [{"account": issuer, "ledger_index": "validated"}]},
    )
    amount = j["result"]["obligations"][currency]
    return Decimal(amount), None, "xrpl gateway_balances"


EVM_RPC = {
    "plume": "https://rpc.plume.org",
    "sei": "https://evm-rpc.sei-apis.com",
}


def snap_evm_public(chain):
    def _snap(identifier):
        url = EVM_RPC[chain]
        supply = int(post(url, {
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": identifier, "data": "0x18160ddd"}, "latest"],
        })["result"], 16)
        decimals = int(post(url, {
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": identifier, "data": "0x313ce567"}, "latest"],
        })["result"], 16)
        return (
            Decimal(supply) / Decimal(10) ** decimals,
            None,
            f"{chain} public RPC totalSupply",
        )
    return _snap


SNAPPERS = {
    "stellar": snap_stellar,
    "aptos": snap_aptos,
    "solana": snap_solana,
    "sui": snap_sui,
    "noble": snap_noble,
    "xrpl": snap_xrpl,
    "plume": snap_evm_public("plume"),
    "sei": snap_evm_public("sei"),
}


def main(product_ids=None):
    rows = list(csv.DictReader(open(SEED)))
    if product_ids:
        rows = [r for r in rows if r["product_id"] in product_ids]
    failures = 0
    with psycopg.connect(DATABASE_URL) as conn:
        for row in rows:
            conn.execute(
                """insert into ref.products
                     (product_id, symbol, fund_name, issuer, chain,
                      contract_address, nav_model, decimals, data_mode,
                      verified_at, notes)
                   values (%s,%s,%s,%s,%s,%s,%s,0,'snapshot',now(),%s)
                   on conflict (product_id) do update set
                     notes = excluded.notes, verified_at = now()""",
                (row["product_id"], row["symbol"], row["fund_name"],
                 row["issuer"], row["chain"], row["identifier"],
                 row["nav_model"], row["notes"] or None),
            )
            try:
                supply, holders, source = SNAPPERS[row["chain"]](row["identifier"])
            except Exception as exc:
                failures += 1
                print(f"FAIL {row['product_id']:18} {exc}")
                continue
            conn.execute(
                """insert into raw.supply_snapshots
                     (chain, contract_address, snapshot_time, supply, holders, source)
                   values (%s,%s,%s,%s,%s,%s)
                   on conflict (chain, contract_address, snapshot_time) do update
                     set supply = excluded.supply, holders = excluded.holders""",
                (row["chain"], row["identifier"], NOW, supply, holders, source),
            )
            print(f"ok   {row['product_id']:18} supply={supply:>20,.2f} "
                  f"holders={holders if holders is not None else '-'}")
        conn.commit()
    if failures:
        sys.exit(f"{failures} snapshot(s) failed")
    print(f"\n{len(rows)} snapshots stored at {NOW.isoformat()}")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
