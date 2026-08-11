"""Phase 2B: reconstruct daily supply history for snapshot-mode chains.

Sources (no API keys required):
  - stellar: stellar.expert stats-history (daily supply + trustlines)
  - aptos:   indexer fungible_asset_activities, deposits-withdrawals cumsum
  - solana:  signatures on the MINT account (only supply-changing txs touch
             the mint) -> token-balance deltas per tx -> cumsum

Each series is gated: the final point must match the latest verified snapshot
within 0.5% or the product is reported as FAILED.

Usage: python history_nonevm.py [product_id ...]
"""

import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal

import psycopg
import requests

from config import ALCHEMY_API_KEY, DATABASE_URL

s = requests.Session()
SOLANA_RPC = f"https://solana-mainnet.g.alchemy.com/v2/{ALCHEMY_API_KEY}"
APTOS_GQL = "https://api.mainnet.aptoslabs.com/v1/graphql"


def http(method, url, retries=6, **kw):
    for attempt in range(retries):
        try:
            r = s.request(method, url, timeout=60, **kw)
        except requests.RequestException:
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 200:
            body = r.json()
            if isinstance(body, dict) and body.get("error"):
                err = str(body["error"])
                if "429" in err or "capacity" in err or "Too many" in err:
                    time.sleep(2 ** attempt)
                    continue
            return body
        if r.status_code in (408, 429, 500, 502, 503, 504):
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
    raise Exception(f"{method} {url}: retries exhausted")


# ---- stellar ---------------------------------------------------------------

def hist_stellar(identifier):
    code, issuer = identifier.split(":")
    rows = http(
        "GET",
        f"https://api.stellar.expert/explorer/public/asset/{code}-{issuer}/stats-history",
    )
    out = {}
    for r in rows:
        day = datetime.fromtimestamp(r["ts"], tz=timezone.utc).date()
        # stellar amounts are 7-decimal fixed point
        supply = Decimal(r["supply"]) / Decimal(10) ** 7
        holders = r["trustlines"][0] if r.get("trustlines") else None
        out[day] = (supply, holders)
    return out, "stellar.expert stats-history"


# ---- aptos -----------------------------------------------------------------

APTOS_PAGE = """
query($t: String!, $limit: Int!, $offset: Int!) {
  fungible_asset_activities(
    where: {asset_type: {_eq: $t}, is_transaction_success: {_eq: true}},
    order_by: {transaction_version: asc, event_index: asc},
    limit: $limit, offset: $offset
  ) { type amount transaction_timestamp }
}
"""


def hist_aptos(identifier):
    decimals = http("POST", APTOS_GQL, json={
        "query": """query($t: String!) {
          fungible_asset_metadata(where: {asset_type: {_eq: $t}}) { decimals }
        }""",
        "variables": {"t": identifier},
    })["data"]["fungible_asset_metadata"][0]["decimals"]
    scale = Decimal(10) ** decimals

    per_day = defaultdict(Decimal)
    offset, limit = 0, 100  # server hard-caps pages at 100 rows
    while True:
        body = http("POST", APTOS_GQL, json={
            "query": APTOS_PAGE,
            "variables": {"t": identifier, "limit": limit, "offset": offset},
        })
        if "errors" in body:
            msg = str(body["errors"])
            if "rate limit" in msg.lower():
                time.sleep(65)  # anonymous window is 5 min; wait it out
                continue
            raise Exception(f"aptos graphql: {msg[:200]}")
        acts = body["data"]["fungible_asset_activities"]
        for a in acts:
            t = a["type"].lower()
            amt = Decimal(a["amount"] or 0) / scale
            day = datetime.fromisoformat(a["transaction_timestamp"]).date()
            if "deposit" in t:
                per_day[day] += amt
            elif "withdraw" in t:
                per_day[day] -= amt
        if len(acts) < limit:
            break
        offset += len(acts)
        time.sleep(0.4)

    out, running = {}, Decimal(0)
    for day in sorted(per_day):
        running += per_day[day]
        out[day] = (running, None)
    return out, "aptos indexer activities cumsum"


# ---- solana ----------------------------------------------------------------

def sol_rpc(method, params):
    body = http("POST", SOLANA_RPC,
                json={"jsonrpc": "2.0", "id": 1, "method": method,
                      "params": params})
    if "error" in body:
        raise Exception(f"solana rpc {method}: {body['error']}")
    return body["result"]


def hist_solana(identifier):
    """Every mint/burn references the mint account, so its signature list is
    the complete supply-change history. Deltas persist per signature in
    raw.solana_mint_txs so interrupted runs resume instead of restarting."""
    with psycopg.connect(DATABASE_URL) as conn:
        conn.execute("""create table if not exists raw.solana_mint_txs (
            mint text not null, signature text not null,
            day date, delta numeric,
            primary key (mint, signature))""")
        conn.commit()

        sigs, before = [], None
        while True:
            opts = {"limit": 1000}
            if before:
                opts["before"] = before
            page = sol_rpc("getSignaturesForAddress", [identifier, opts])
            sigs.extend(x["signature"] for x in page if not x.get("err"))
            if len(page) < 1000:
                break
            before = page[-1]["signature"]
            time.sleep(0.3)

        done = {r[0] for r in conn.execute(
            "select signature from raw.solana_mint_txs where mint=%s",
            (identifier,)).fetchall()}
        todo = [g for g in sigs if g not in done]
        if todo:
            print(f"     solana {identifier[:8]}…: {len(sigs)} sigs, "
                  f"{len(todo)} to fetch", flush=True)
        for i, sig in enumerate(todo):
            tx = sol_rpc("getTransaction", [sig, {
                "encoding": "jsonParsed",
                "maxSupportedTransactionVersion": 0,
            }])
            day, delta = None, Decimal(0)
            if tx and tx.get("blockTime"):
                meta = tx.get("meta") or {}
                pre = {b["accountIndex"]: b
                       for b in meta.get("preTokenBalances", [])
                       if b.get("mint") == identifier}
                post = {b["accountIndex"]: b
                        for b in meta.get("postTokenBalances", [])
                        if b.get("mint") == identifier}
                for idx in set(pre) | set(post):
                    a = Decimal((post.get(idx) or {}).get("uiTokenAmount", {}).get("amount", 0) or 0)
                    b = Decimal((pre.get(idx) or {}).get("uiTokenAmount", {}).get("amount", 0) or 0)
                    delta += a - b
                if delta != 0:
                    dec = next(iter(post.values() or pre.values()))["uiTokenAmount"]["decimals"]
                    delta = delta / Decimal(10) ** dec
                    day = datetime.fromtimestamp(
                        tx["blockTime"], tz=timezone.utc).date()
            conn.execute(
                """insert into raw.solana_mint_txs (mint, signature, day, delta)
                   values (%s,%s,%s,%s) on conflict do nothing""",
                (identifier, sig, day, delta if day else None),
            )
            if i % 50 == 49:
                conn.commit()
            time.sleep(0.3)
        conn.commit()

        per_day = defaultdict(Decimal)
        for day, delta in conn.execute(
            """select day, sum(delta) from raw.solana_mint_txs
               where mint=%s and day is not null group by 1 order by 1""",
            (identifier,)).fetchall():
            per_day[day] = Decimal(delta)

    out, running = {}, Decimal(0)
    for day in sorted(per_day):
        running += per_day[day]
        out[day] = (running, None)
    return out, "solana mint-account signatures cumsum"


# ---- xrpl ------------------------------------------------------------------

RIPPLE_EPOCH = 946684800  # 2000-01-01 in unix seconds


def hist_xrpl(identifier):
    """Issuer obligations change only when tokens move from/to the issuer:
    payments FROM the issuer mint supply, payments TO it redeem."""
    currency, issuer = identifier.split(".")
    per_day = defaultdict(Decimal)
    marker = None
    while True:
        params = {"account": issuer, "forward": True, "limit": 400}
        if marker:
            params["marker"] = marker
        body = http("POST", "https://s1.ripple.com:51234/",
                    json={"method": "account_tx", "params": [params]})
        result = body["result"]
        for item in result.get("transactions", []):
            tx, meta = item.get("tx", {}), item.get("meta", {})
            if tx.get("TransactionType") != "Payment":
                continue
            if not isinstance(meta.get("delivered_amount"), dict):
                continue
            amt = meta["delivered_amount"]
            if amt.get("currency") != currency or amt.get("issuer") != issuer:
                continue
            value = Decimal(amt["value"])
            day = datetime.fromtimestamp(
                tx["date"] + RIPPLE_EPOCH, tz=timezone.utc).date()
            if tx.get("Account") == issuer:
                per_day[day] += value      # issuance
            elif tx.get("Destination") == issuer:
                per_day[day] -= value      # redemption
        marker = result.get("marker")
        if not marker:
            break
        time.sleep(0.3)

    out, running = {}, Decimal(0)
    for day in sorted(per_day):
        running += per_day[day]
        out[day] = (running, None)
    return out, "xrpl issuer account_tx cumsum"


HISTORIANS = {
    "stellar": hist_stellar,
    "aptos": hist_aptos,
    "solana": hist_solana,
    "xrpl": hist_xrpl,
}

# transferChecked references the mint, so active tokens have millions of
# mint signatures — unviable on free RPC. History for these needs Helius.
HISTORY_EXCLUDE = {"usdy-solana", "usdy-aptos"}  # usdy-aptos: 1.17 tokens, not worth the rate budget
TOLERANCE = Decimal("0.005")


def main(product_ids=None):
    failures = 0
    with psycopg.connect(DATABASE_URL) as conn:
        products = conn.execute(
            """select product_id, chain, contract_address from ref.products
               where data_mode = 'snapshot' and in_scope
                 and chain = any(%s) order by product_id""",
            (list(HISTORIANS),),
        ).fetchall()
        if product_ids:
            products = [p for p in products if p[0] in product_ids]
        else:
            products = [p for p in products if p[0] not in HISTORY_EXCLUDE]

        for product_id, chain, identifier in products:
            try:
                series, source = HISTORIANS[chain](identifier)
            except Exception as exc:
                failures += 1
                print(f"FAIL {product_id:18} history fetch: {exc}")
                continue
            if not series:
                print(f"skip {product_id:18} no history (empty deployment)")
                continue

            # gate: last point vs latest verified snapshot
            snap = conn.execute(
                """select supply from raw.supply_snapshots
                   where chain=%s and contract_address=%s
                   order by snapshot_time desc limit 1""",
                (chain, identifier),
            ).fetchone()
            last_supply = series[max(series)][0]
            if snap and snap[0] > 0:
                drift = abs(last_supply - snap[0]) / snap[0]
                gate = "ok  " if drift <= TOLERANCE else "FAIL"
                if gate == "FAIL":
                    failures += 1
                    print(f"FAIL {product_id:18} series end {last_supply:,.2f} "
                          f"vs snapshot {snap[0]:,.2f} ({drift:.2%} drift) — not stored")
                    continue
            with conn.cursor() as cur:
                cur.executemany(
                    """insert into raw.nonevm_supply_daily
                         (chain, contract_address, day, supply, holders, source)
                       values (%s,%s,%s,%s,%s,%s)
                       on conflict (chain, contract_address, day) do update
                         set supply = excluded.supply,
                             holders = excluded.holders""",
                    [(chain, identifier, day, sup, hold, source)
                     for day, (sup, hold) in series.items()],
                )
            conn.commit()
            print(f"ok   {product_id:18} {len(series):>5} days, "
                  f"ends {max(series)} at {last_supply:,.2f}")
    if failures:
        sys.exit(f"{failures} series failed")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
