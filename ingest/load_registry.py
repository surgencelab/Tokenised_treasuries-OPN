"""Load seeds/products.csv into ref.products, verifying each contract on-chain.

For every row: call decimals() and symbol() on the contract. A dead address or a
symbol that doesn't match the registry gets flagged loudly; decimals become the
canonical scaling factor for ingestion.
"""

import csv
import sys
from pathlib import Path

import psycopg

from config import DATABASE_URL, rpc_url
from rpc import RpcError, eth_call

SEED = Path(__file__).resolve().parent.parent / "seeds" / "products.csv"

SEL_DECIMALS = "0x313ce567"
SEL_SYMBOL = "0x95d89b41"


def decode_string(hexdata: str) -> str:
    raw = bytes.fromhex(hexdata[2:])
    if len(raw) >= 64:  # standard ABI string: offset, length, data
        length = int.from_bytes(raw[32:64], "big")
        return raw[64 : 64 + length].decode("utf-8", errors="replace")
    return raw.rstrip(b"\x00").decode("utf-8", errors="replace")  # bytes32 style


def main():
    rows = list(csv.DictReader(open(SEED)))
    failures = []
    with psycopg.connect(DATABASE_URL) as conn:
        for row in rows:
            chain = row["chain"]
            addr = row["contract_address"].lower()
            url = rpc_url(chain)
            try:
                decimals = int(eth_call(url, addr, SEL_DECIMALS), 16)
                onchain_symbol = decode_string(eth_call(url, addr, SEL_SYMBOL))
            except (RpcError, ValueError) as exc:
                failures.append((row["product_id"], str(exc)))
                print(f"FAIL  {row['product_id']:18} {chain:10} {addr}  {exc}")
                continue

            match = onchain_symbol.strip().upper().startswith(
                row["symbol"].replace("-I", "").upper()
            ) or row["symbol"].upper().startswith(onchain_symbol.strip().upper())
            flag = "ok" if match else "SYMBOL MISMATCH"
            print(
                f"{flag:16} {row['product_id']:18} {chain:10} "
                f"decimals={decimals:2}  onchain_symbol={onchain_symbol!r}"
            )
            conn.execute(
                """
                insert into ref.products
                  (product_id, symbol, fund_name, issuer, chain, contract_address,
                   nav_model, decimals, onchain_symbol, verified_at, notes)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s)
                on conflict (product_id) do update set
                  decimals = excluded.decimals,
                  onchain_symbol = excluded.onchain_symbol,
                  verified_at = now(),
                  notes = excluded.notes
                """,
                (
                    row["product_id"], row["symbol"], row["fund_name"], row["issuer"],
                    chain, addr, row["nav_model"], decimals, onchain_symbol,
                    row["notes"] or None,
                ),
            )
        conn.commit()

    if failures:
        print(f"\n{len(failures)} contract(s) failed verification; not loaded.")
        sys.exit(1)
    print(f"\nLoaded {len(rows)} products into ref.products.")


if __name__ == "__main__":
    main()
