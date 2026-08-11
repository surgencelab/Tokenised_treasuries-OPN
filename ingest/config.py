import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

ALCHEMY_API_KEY = os.environ["ALCHEMY_API_KEY"]
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://localhost:5432/tokenized_treasuries"
)

ALCHEMY_SUBDOMAIN = {
    "ethereum": "eth-mainnet",
    "optimism": "opt-mainnet",
    "arbitrum": "arb-mainnet",
    "polygon": "polygon-mainnet",
    "base": "base-mainnet",
    "avalanche": "avax-mainnet",
    "mantle": "mantle-mainnet",
    "bnb": "bnb-mainnet",
}

# alchemy_getAssetTransfers availability, tested 2026-07-15.
# Mantle answers standard JSON-RPC but not the Transfers API.
TRANSFERS_API = {
    "ethereum": True,
    "optimism": True,
    "arbitrum": True,
    "polygon": True,
    "base": True,
    "avalanche": True,
    "mantle": False,
    "bnb": True,
    "plume": False,
    "sei": False,
}

# Incremental re-scan depth. Rollups/avalanche finalize fast; belt and braces.
CONFIRMATIONS = {
    "ethereum": 12,
    "optimism": 15,
    "arbitrum": 15,
    "polygon": 60,
    "base": 15,
    "avalanche": 15,
    "mantle": 15,
    "bnb": 15,
    "plume": 15,
    "sei": 60,
}

# Chains without the Transfers API scan via eth_getLogs. Alchemy's free tier
# caps getLogs at a 10-block range on these networks, so logs come from the
# chain's public RPC (10k-block ranges); timestamps still come from Alchemy.
# providers that ERROR on oversized results (tenderly silently truncates!)
GETLOGS_RPC = {
    "mantle": ["https://mantle.drpc.org", "https://rpc.mantle.xyz"],
    "plume": ["https://rpc.plume.org"],
    "sei": ["https://sei.drpc.org"],
}
GETLOGS_TS_RPC = {
    "mantle": "https://mantle.gateway.tenderly.co",
    "plume": "https://rpc.plume.org",
    "sei": "https://sei.drpc.org",
}
GETLOGS_MAX_SPAN = {"mantle": 10_000, "plume": 900_000, "sei": 10_000}
# timestamps interpolated between chunk-boundary anchors (near-constant cadence)
GETLOGS_TS_INTERPOLATE = {"mantle", "sei"}

TRANSFER_TOPIC = (
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
)
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


# EVM chains served by public RPCs instead of Alchemy
PUBLIC_EVM_RPC = {
    "plume": "https://rpc.plume.org",
    "sei": "https://sei.drpc.org",
}


def rpc_url(chain: str) -> str:
    if chain in ALCHEMY_SUBDOMAIN:
        return f"https://{ALCHEMY_SUBDOMAIN[chain]}.g.alchemy.com/v2/{ALCHEMY_API_KEY}"
    return PUBLIC_EVM_RPC[chain]
