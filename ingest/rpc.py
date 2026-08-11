import time

import requests

_session = requests.Session()


class RpcError(Exception):
    def __init__(self, error):
        self.code = error.get("code")
        self.message = error.get("message", "")
        super().__init__(f"RPC error {self.code}: {self.message}")


def rpc(url: str, method: str, params: list, retries: int = 6):
    last = None
    for attempt in range(retries):
        try:
            resp = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=90,
            )
        except requests.RequestException as exc:
            last = exc
            time.sleep(min(2**attempt, 30))
            continue
        if resp.status_code == 200:
            body = resp.json()
            if "error" in body:
                err = body["error"]
                # rate limits arrive as JSON-RPC errors with HTTP 200
                msg = str(err.get("message", "")).lower()
                if err.get("code") in (429, -32005, -32016) or "capacity" in msg \
                        or "rate limit" in msg:
                    last = RpcError(err)
                    time.sleep(min(2**attempt, 30))
                    continue
                raise RpcError(err)
            return body["result"]
        if resp.status_code in (408, 429, 500, 502, 503, 504):
            last = Exception(f"HTTP {resp.status_code}")
            time.sleep(min(2**attempt, 30))
            continue
        raise Exception(f"HTTP {resp.status_code}: {resp.text[:300]}")
    raise Exception(f"RPC failed after {retries} retries: {last}")


def rpc_batch(url: str, calls: list, retries: int = 6):
    """calls: list of (method, params). Returns results in order."""
    payload = [
        {"jsonrpc": "2.0", "id": i, "method": m, "params": p}
        for i, (m, p) in enumerate(calls)
    ]
    for attempt in range(retries):
        try:
            resp = _session.post(url, json=payload, timeout=120)
        except requests.RequestException:
            time.sleep(min(2**attempt, 30))
            continue
        if resp.status_code == 200:
            body = resp.json()
            if isinstance(body, dict) and "error" in body:  # whole-batch error
                time.sleep(min(2**attempt, 30))
                continue
            by_id = {item["id"]: item for item in body}
            out, rate_limited = [], False
            for i in range(len(calls)):
                item = by_id[i]
                if "error" in item:
                    err = item["error"]
                    if err.get("code") in (429, -32005) or "capacity" in str(
                        err.get("message", "")
                    ):
                        rate_limited = True
                        break
                    raise RpcError(err)
                out.append(item["result"])
            if rate_limited:
                time.sleep(min(2**attempt, 30))
                continue
            return out
        time.sleep(min(2**attempt, 30))
    raise Exception(f"Batch RPC failed after {retries} retries")


def eth_call(url: str, to: str, data: str, block: str = "latest"):
    return rpc(url, "eth_call", [{"to": to, "data": data}, block])


def head_block(url: str) -> int:
    return int(rpc(url, "eth_blockNumber", []), 16)
