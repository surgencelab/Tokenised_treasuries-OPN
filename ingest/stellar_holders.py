"""Stellar holder-balance snapshots via stellar.expert /holders (paged).

Writes raw.holder_snapshots so Stellar deployments get the same concentration
metrics (top-10 share, HHI, median) as EVM chains. Run with the snapshots.
"""

import sys
import time
from datetime import datetime, timezone
from decimal import Decimal

import psycopg
import requests

from config import DATABASE_URL

BASE = "https://api.stellar.expert"
NOW = datetime.now(timezone.utc)
s = requests.Session()
s.headers["User-Agent"] = "datum-labs-research/1.0"


def get(path, retries=5):
    for attempt in range(retries):
        r = s.get(BASE + path, timeout=30)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (408, 429, 500, 502, 503):
            time.sleep(3 * (attempt + 1))
            continue
        r.raise_for_status()
    raise Exception(f"GET {path}: retries exhausted")


def holders(code, issuer):
    path = f"/explorer/public/asset/{code}-{issuer}/holders?order=desc&limit=200"
    out = []
    while path:
        j = get(path)
        records = j["_embedded"]["records"]
        for r in records:
            bal = Decimal(r["balance"]) / Decimal(10) ** 7
            if bal > Decimal("0.000001"):
                out.append((r["address"], bal))
        nxt = j["_links"].get("next", {}).get("href")
        # stellar.expert keeps returning the cursor after the last page
        path = nxt if records and nxt else None
        time.sleep(0.4)
    return out


def main(product_ids=None):
    with psycopg.connect(DATABASE_URL) as conn:
        products = conn.execute(
            """select product_id, contract_address from ref.products
               where chain = 'stellar' and in_scope order by product_id"""
        ).fetchall()
        if product_ids:
            products = [p for p in products if p[0] in product_ids]
        for product_id, identifier in products:
            code, issuer = identifier.split(":")
            rows = holders(code, issuer)
            with conn.cursor() as cur:
                cur.executemany(
                    """insert into raw.holder_snapshots
                         (chain, contract_address, snapshot_time,
                          holder_address, balance)
                       values ('stellar', %s, %s, %s, %s)
                       on conflict do nothing""",
                    [(identifier, NOW, addr, bal) for addr, bal in rows],
                )
            conn.commit()
            total = sum(b for _, b in rows)
            print(f"ok   {product_id:18} {len(rows):>5} holders, "
                  f"sum {total:,.2f}")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
