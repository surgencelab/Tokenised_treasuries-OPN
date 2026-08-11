# Tokenized Treasuries: Self-Hosting Guide (IOPn)

What you are deploying, in three pieces:

1. **Dashboard**: a Next.js 15 app (Node 20). Reads Postgres, serves the UI,
   the report page, and a JSON API. Stateless.
2. **Postgres database**: all the data (transfer events, snapshots, history
   series, registry, marts views). Restore it from the dump in this pack.
3. **Data pipeline**: Python 3.11+ scripts that refresh the data. Hourly
   incremental run plus a daily full run. Scheduled with systemd timers
   (recommended) or the Docker compose pipeline service.

Everything below assumes the repo lives at `/opt/tokenized-treasuries` and
your domain is `treasuries.iopn.network`. Adjust freely.

---

## 1. Database

Create a database and restore the dump (any Postgres 16+; managed or your own):

```bash
createdb tokenized_treasuries
pg_restore --no-owner --no-acl -d tokenized_treasuries tokenized_treasuries_<date>.dump
```

A warning like `unrecognized configuration parameter "transaction_timeout"`
during restore is harmless (a newer-Postgres setting in the dump header;
pg_restore skips it).

Sanity check:

```bash
psql -d tokenized_treasuries -c "select count(*) from raw.erc20_transfers"
psql -d tokenized_treasuries -c "select round(sum(aum_usd)/1e9,2) as aum_bn from marts.fct_current_positions"
```

Note: the database is a convenience, not a dependency. Every number is
reproducible from the chains themselves by running the pipeline's backfill
from scratch (takes a few hours under free-tier rate limits).

## 2. Environment

Two env files:

`/opt/tokenized-treasuries/.env` (pipeline):
```
DATABASE_URL=postgresql://USER:PASS@HOST:5432/tokenized_treasuries
ALCHEMY_API_KEY=<create your own at alchemy.com; free tier is sufficient>
```

`/opt/tokenized-treasuries/dashboard/.env.local` (app):
```
TREASURIES_DATABASE_URL=postgresql://USER:PASS@HOST:5432/tokenized_treasuries
# optional, for Setnel alerting:
# SETNEL_HUB_URL=  SETNEL_SECRET=  SETNEL_CRON_SECRET=
```

Add `?sslmode=require` to the URLs if your Postgres requires TLS.

## 3. Dashboard app

**Docker (recommended):**
```bash
cd /opt/tokenized-treasuries
docker compose up -d app        # builds dashboard/Dockerfile, serves :3000
```

**Bare Node alternative:**
```bash
cd dashboard && npm ci && npm run build && PORT=3000 npm start
```

## 4. Reverse proxy + TLS

Point DNS (A/AAAA record) for `treasuries.iopn.network` at the server, then
terminate TLS with whatever you already use. Caddy example (auto-TLS):

```
treasuries.iopn.network {
    reverse_proxy localhost:3000
}
```

Nginx equivalent: proxy_pass to `http://127.0.0.1:3000` and use certbot.

## 5. Pipeline schedule

```bash
cd /opt/tokenized-treasuries
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
sudo useradd -r treasuries && sudo chown -R treasuries: /opt/tokenized-treasuries
sudo cp handover/systemd/*.service handover/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now treasuries-refresh.timer treasuries-refresh-full.timer
```

- Hourly (:15): incremental chain ingest + supply snapshots + the supply gate.
- Daily (06:45): adds reconstructed history series and Stellar holder lists.
- A nonzero exit means the supply gate failed (computed supply != on-chain
  totalSupply). That is the signal to investigate before trusting new data;
  the dashboard keeps serving the last good state either way.

Optional daily monitoring ping (replaces the old Vercel cron):
```
30 7 * * * curl -s -H "Authorization: Bearer $SETNEL_CRON_SECRET" https://treasuries.iopn.network/api/setnel/cron
```

## 6. Verify

- `https://treasuries.iopn.network` renders with current data
- `/report` serves the research report
- `/api/summary` returns JSON with today's `asOf`
- After the first timer run: `logs/refresh.log` ends with
  "All products pass the supply gate."

## 7. Cutover checklist (coordinate with Datum Labs)

- [ ] IOPn DNS live, site verified on the new domain
- [ ] IOPn timers running with IOPn's own Alchemy key
- [ ] Datum Labs disables its refresh jobs (single-writer rule)
- [ ] Vercel deployment taken down or repointed as a redirect
- [ ] Old database credentials rotated/retired

## Architecture notes for the team

- Supply is rebuilt from on-chain mint/burn events per contract and must
  reconcile exactly with `totalSupply()` per deployment on every refresh.
- Non-EVM chains (Stellar, Solana, Aptos, XRPL, Sui, Noble, Sei, Plume) are
  read from each chain's own public API; no keys needed.
- Accruing products use dated reference NAVs stored in `ref.nav_reference`;
  update them periodically (see README "Non-negotiables").
- Marts are plain SQL views (`db/migrations/`), so any BI tool can sit on the
  same database.
