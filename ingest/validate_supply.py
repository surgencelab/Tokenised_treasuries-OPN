"""Sanity gate: per product, sum(mints) - sum(burns) must equal on-chain
totalSupply() within rounding. A mismatch means the backfill has a hole.

Usage: python validate_supply.py [product_id ...]
"""

import sys
from decimal import Decimal

import psycopg

from config import DATABASE_URL, ZERO_ADDRESS, rpc_url
from rpc import eth_call

SEL_TOTAL_SUPPLY = "0x18160ddd"
TOLERANCE = Decimal("0.000001")  # relative


def main(product_ids=None):
    failures = 0
    with psycopg.connect(DATABASE_URL) as conn:
        query = ("select product_id, chain, contract_address, decimals "
                 "from ref.products where in_scope and data_mode = 'events'")
        params = ()
        if product_ids:
            query += " and product_id = any(%s)"
            params = (list(product_ids),)
        for product_id, chain, addr, decimals in conn.execute(
            query + " order by product_id", params
        ).fetchall():
            row = conn.execute(
                """select coalesce(sum(case when from_address=%s then amount end),0)
                        - coalesce(sum(case when to_address=%s then amount end),0)
                   from raw.erc20_transfers
                   where chain=%s and contract_address=%s""",
                (ZERO_ADDRESS, ZERO_ADDRESS, chain, addr),
            ).fetchone()
            computed = row[0]  # mints (from zero) minus burns (to zero)
            onchain = Decimal(int(eth_call(rpc_url(chain), addr, SEL_TOTAL_SUPPLY), 16)) \
                / Decimal(10) ** decimals
            if onchain == 0:
                ok = abs(computed) < Decimal("0.01")  # raw-event dust on dead deployments
            else:
                ok = abs(computed - onchain) / onchain <= TOLERANCE
            status = "OK  " if ok else "FAIL"
            if not ok:
                failures += 1
            print(f"{status} {product_id:20} computed={computed:>18,.2f}  "
                  f"onchain={onchain:>18,.2f}")
    if failures:
        sys.exit(f"{failures} product(s) failed the supply gate.")
    print("\nAll products pass the supply gate.")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
