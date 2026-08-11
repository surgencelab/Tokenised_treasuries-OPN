"""Backfill + incremental ERC-20 transfer ingestion into raw.erc20_transfers.

Two paths writing identical rows:
  - alchemy_getAssetTransfers where available (timestamps included)
  - generic eth_getLogs + block-timestamp lookups (mantle)

Idempotent: upserts on (chain, tx_hash, log_index); incremental runs rewind the
cursor by the chain's confirmation depth.

Usage: python backfill.py [product_id ...]   (no args = all products)
"""

import sys
import time
from datetime import datetime, timezone
from decimal import Decimal

import psycopg

from config import (
    CONFIRMATIONS, DATABASE_URL, GETLOGS_MAX_SPAN, GETLOGS_RPC, GETLOGS_TS_RPC,
    TRANSFER_TOPIC, TRANSFERS_API, ZERO_ADDRESS, rpc_url,
)
from rpc import RpcError, head_block, rpc, rpc_batch

UPSERT = """
insert into raw.erc20_transfers
  (chain, contract_address, block_number, block_time, tx_hash, log_index,
   from_address, to_address, amount_raw, amount)
values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
on conflict (chain, tx_hash, log_index) do nothing
"""


def save(conn, rows):
    if rows:
        with conn.cursor() as cur:
            cur.executemany(UPSERT, rows)
    conn.commit()


def set_cursor(conn, chain, addr, block):
    conn.execute(
        """insert into raw.ingest_cursor (chain, contract_address, last_block)
           values (%s,%s,%s)
           on conflict (chain, contract_address)
           do update set last_block = excluded.last_block, updated_at = now()""",
        (chain, addr, block),
    )
    conn.commit()


def get_cursor(conn, chain, addr):
    row = conn.execute(
        "select last_block from raw.ingest_cursor where chain=%s and contract_address=%s",
        (chain, addr),
    ).fetchone()
    return row[0] if row else None


def creation_block(url, addr, head):
    lo, hi = 0, head
    while lo < hi:
        mid = (lo + hi) // 2
        code = rpc(url, "eth_getCode", [addr, hex(mid)])
        if code and code != "0x":
            hi = mid
        else:
            lo = mid + 1
    return lo


def block_time(url, block_number, cache):
    if block_number not in cache:
        blk = rpc(url, "eth_getBlockByNumber", [hex(block_number), False])
        cache[block_number] = datetime.fromtimestamp(
            int(blk["timestamp"], 16), tz=timezone.utc
        )
    return cache[block_number]


def via_transfers_api(conn, url, chain, addr, decimals, from_block, head):
    scale = Decimal(10) ** decimals
    page_key, total = None, 0
    ts_cache = {}  # some networks (avalanche) return metadata: null
    while True:
        params = {
            "fromBlock": hex(from_block),
            "toBlock": hex(head),
            "contractAddresses": [addr],
            "category": ["erc20"],
            "withMetadata": True,
            "maxCount": "0x3e8",
            "order": "asc",
        }
        if page_key:
            params["pageKey"] = page_key
        result = rpc(url, "alchemy_getAssetTransfers", [params])
        rows = []
        for t in result.get("transfers", []):
            raw_val = (t.get("rawContract") or {}).get("value") or "0x0"
            amount_raw = int(raw_val, 16)
            block_num = int(t["blockNum"], 16)
            ts = (t.get("metadata") or {}).get("blockTimestamp") \
                or block_time(url, block_num, ts_cache)
            rows.append((
                chain, addr, block_num,
                ts, t["hash"],
                int(t["uniqueId"].rsplit(":", 1)[-1]),
                (t["from"] or ZERO_ADDRESS).lower(),
                (t["to"] or ZERO_ADDRESS).lower(),
                Decimal(amount_raw), Decimal(amount_raw) / scale,
            ))
        save(conn, rows)
        total += len(rows)
        page_key = result.get("pageKey")
        if not page_key:
            return total
        time.sleep(0.2)


def via_getlogs(conn, url, chain, addr, decimals, from_block, head):
    """Range-scan Transfer logs. Alchemy free tier caps getLogs at a 10-block
    range on these networks, so logs come from the chain's public RPC
    (GETLOGS_RPC) with threaded range fetches; timestamps come from Alchemy in
    batches. Cursor is saved per chunk so a killed run resumes, not restarts."""
    from concurrent.futures import ThreadPoolExecutor

    logs_urls = GETLOGS_RPC.get(chain, url)
    if isinstance(logs_urls, str):
        logs_urls = [logs_urls]
    ts_url = GETLOGS_TS_RPC.get(chain, logs_urls[0])
    span = GETLOGS_MAX_SPAN.get(chain, 500_000)
    scale = Decimal(10) ** decimals
    ts_cache, total = {}, 0

    ranges = [(b, min(b + span - 1, head)) for b in range(from_block, head + 1, span)]

    def fetch(rng):
        time.sleep(0.15)
        start = (rng[0] // span) % len(logs_urls)
        last_exc = None
        for k in range(len(logs_urls)):  # fall through providers on failure
            provider = logs_urls[(start + k) % len(logs_urls)]
            try:
                return rpc(provider, "eth_getLogs", [{
                    "address": addr,
                    "topics": [TRANSFER_TOPIC],
                    "fromBlock": hex(rng[0]),
                    "toBlock": hex(rng[1]),
                }], retries=3)
            except Exception as exc:
                last_exc = exc
        raise last_exc

    from config import GETLOGS_TS_INTERPOLATE

    def anchor_ts(block_number):
        blk = rpc(ts_url, "eth_getBlockByNumber", [hex(block_number), False])
        return int(blk["timestamp"], 16)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for rng, logs in zip(ranges, pool.map(fetch, ranges)):
            missing = sorted(
                {int(lg["blockNumber"], 16) for lg in logs} - ts_cache.keys()
            )
            if missing and chain in GETLOGS_TS_INTERPOLATE:
                # two real anchors per chunk; linear in between. Error is
                # minutes on fixed-cadence chains — fine for daily marts.
                lo, hi = rng
                t_lo, t_hi = anchor_ts(lo), anchor_ts(min(hi, head))
                for b in missing:
                    frac = (b - lo) / max(hi - lo, 1)
                    ts_cache[b] = datetime.fromtimestamp(
                        t_lo + frac * (t_hi - t_lo), tz=timezone.utc
                    )
            else:
                for i in range(0, len(missing), 40):
                    chunk = missing[i : i + 40]
                    try:
                        blocks = rpc_batch(
                            ts_url,
                            [("eth_getBlockByNumber", [hex(b), False])
                             for b in chunk],
                        )
                    except Exception:  # provider rejects batches -> singles
                        blocks = [
                            rpc(ts_url, "eth_getBlockByNumber", [hex(b), False])
                            for b in chunk
                        ]
                    for b, blk in zip(chunk, blocks):
                        ts_cache[b] = datetime.fromtimestamp(
                            int(blk["timestamp"], 16), tz=timezone.utc
                        )
            rows = []
            for lg in logs:
                bn = int(lg["blockNumber"], 16)
                amount_raw = int(lg["data"], 16)
                rows.append((
                    chain, addr, bn, ts_cache[bn],
                    lg["transactionHash"], int(lg["logIndex"], 16),
                    "0x" + lg["topics"][1][-40:], "0x" + lg["topics"][2][-40:],
                    Decimal(amount_raw), Decimal(amount_raw) / scale,
                ))
            save(conn, rows)
            total += len(rows)
            set_cursor(conn, chain, addr, rng[1])
            if logs:
                print(f"  ...{total} transfers through block {rng[1]}", flush=True)
    return total


def run(product_ids=None):
    with psycopg.connect(DATABASE_URL) as conn:
        query = ("select product_id, chain, contract_address, decimals "
                 "from ref.products where data_mode = 'events' and in_scope")
        params = ()
        if product_ids:
            query += " and product_id = any(%s)"
            params = (list(product_ids),)
        products = conn.execute(query + " order by product_id", params).fetchall()
        if not products:
            sys.exit("No matching products in ref.products; run load_registry.py first.")

        for product_id, chain, addr, decimals in products:
            url = rpc_url(chain)
            head = head_block(url) - 2  # avoid the very tip
            cursor = get_cursor(conn, chain, addr)
            if cursor is None:
                start = creation_block(url, addr, head)
                print(f"{product_id}: full backfill from creation block {start}")
            else:
                start = max(0, cursor - CONFIRMATIONS[chain] + 1)
                print(f"{product_id}: incremental from block {start}")

            fn = via_transfers_api if TRANSFERS_API[chain] else via_getlogs
            t0 = time.time()
            try:
                n = fn(conn, url, chain, addr, decimals, start, head)
            except Exception as exc:
                conn.rollback()
                print(f"{product_id}: FAILED ({exc}); continuing with next product",
                      flush=True)
                continue
            set_cursor(conn, chain, addr, head)
            print(f"{product_id}: {n} transfers upserted in {time.time()-t0:.1f}s "
                  f"(cursor -> {head})", flush=True)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
