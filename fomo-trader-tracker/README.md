# fomo Trader Tracker

Finds and monitors [fomo.family](https://fomo.family) traders that match a capital and portfolio profile, using **public Solana on-chain data only**.

Default profile, all configurable:

- portfolio worth **$3,000 or more**
- **at least 5 memecoin positions** (up to 500) above a scaled significance floor
- **active**: at least 5 successful transactions in the last 7 days

Output is a ranked watchlist plus Telegram alerts when those wallets buy or sell. Follow whoever you want from that list inside the fomo app.

## Scope and limits

This tool reads the blockchain. It does **not** log into fomo, does not use fomo's private app API, and does not automate follows, trades or any other account action. There is no public fomo API — `docs.fomo.com` belongs to an unrelated marketing product, and fomo.family directs technical requests to `support@fomo.family`. Bulk automated follows would also risk your account, so that is deliberately out of scope.

Everything here works on addresses, not identities. Mapping a wallet to a fomo username requires the app and is not attempted.

Solana only for now. fomo also trades on Base, BNB Chain and Monad, and bridges via [Relay](https://relay.link); those chains would need a separate adapter.

## How discovery works

Two independent paths, either is enough to start.

**1. fomo-launched tokens (no configuration needed).** Tokens created through fomo carry a vanity mint suffix ending in `fomo`, for example `5rYd8uAReEfsoqe4kAxnXar9158CK2Ri6FzD1H7sfomo`. Holding one is direct on-chain evidence of the app. The tracker takes the largest holders of a known fomo mint, screens those wallets, learns the other fomo mints they hold, and repeats. One token address bootstraps the whole crawl.

**2. fomo's own accounts.** Every fomo trade touches the same small set of fomo-controlled accounts, because fomo sponsors gas and takes a 0.5% fee. Enumerating the transaction history of those accounts yields the fomo trader population directly. Put them in `FOMO_ROUTER_ACCOUNTS` if you know them, or let the tracker derive them:

```bash
npm run discover-router -- <fomoWallet1> <fomoWallet2> <fomoWallet3>
```

That inspects each wallet's recent transactions and ranks the accounts common to all of them, after removing shared Solana infrastructure (Jupiter, Meteora, Raydium, token programs, mints). Accounts hit by every seed are fomo's own. Two or more seed wallets give a far cleaner result than one.

Screening then prices each candidate's holdings via Jupiter, counts significant memecoin positions, measures recent activity, and promotes matches to the watchlist.

## Setup

```bash
cd fomo-trader-tracker
npm install
cp .env.example .env
```

Set at least one starting point in `.env`:

```bash
FOMO_SEED_MINTS=<a mint address ending in "fomo">
# or
FOMO_SEED_WALLETS=<known fomo wallet>,<another>
# or
FOMO_ROUTER_ACCOUNTS=<fomo router/sponsor/fee accounts>
# or
FOMO_MANUAL_WALLETS=<wallets to always track>
```

**Use a real RPC endpoint.** This matters more than any other setting. Public endpoints throttle hard, disable methods (`getMultipleAccounts` returns 403 on some), and return `INTERNAL_ERROR` on wallets with thousands of token accounts — which are exactly the wallets you care about. A free Helius or QuickNode key removes all three problems:

```bash
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
RPC_MIN_SPACING_MS=40
RPC_MAX_CONCURRENCY=10
```

Without a key, several endpoints can be rotated instead. Each is put on a 60-second cooldown when it answers 429 or stalls, and requests move to the next one:

```bash
SOLANA_RPC_URLS=https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com
```

Expect this to be slow and to hit method-level limits regardless; it is a fallback, not a setup to run at scale.

Telegram is optional. Without `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, alerts print to stdout instead.

## Commands

```bash
npm start                    # continuous: discovery, screening, trade alerts
npm run scan [batchSize]     # one-shot discovery + screening pass
npm run monitor              # one polling pass for trade alerts
npm run monitor -- --warm    # record current history without alerting
npm run list [limit]         # print the current watchlist
npm run discover-router -- <wallet>...   # derive fomo's own accounts
npx tsx src/cli/inspect.ts <wallet>      # explain one wallet's verdict
npm run typecheck
```

`npm start` runs everything on a loop. For cron-style operation use `scan` and `monitor` separately; run `monitor -- --warm` once first so existing history is not replayed as alerts.

`inspect` is the tool to reach for when the filter behaves unexpectedly:

```
wallet 5fkAwNVpT8A1UHEnY62VEFpqgagdoP8FYrv5ideiQp5c
  total:          $3,154.49
  cash:           $1.43
  sol:            $36.61
  memecoins:      $2,104.85 across 14 positions
  position floor: $31.54
  token accounts: 304 (pricing complete: true)
  trades/7d:      21
  verdict:        QUALIFIED
```

It also lists the counted positions and the largest holdings that fell below the floor, which is what you need to decide whether the floor is set sensibly.

## Tuning the filter

The counting rule matters more than it looks, because it decides what "5 memecoins" means. Active wallets accumulate hundreds of near-worthless airdrops and sell leftovers, and a wallet holding 300 dust entries is not a wallet with 300 positions. A position is therefore only counted when it is worth at least

```
max(DUST_THRESHOLD_USD, portfolio_total * MIN_POSITION_SHARE)
```

which is $25 or 1% of the portfolio by default. The wallet above illustrates it: 304 token accounts, but only 14 positions above a $31.54 floor.

Raise `MIN_POSITION_SHARE` to demand conviction positions, lower it to count the tail. `MIN_MEMECOINS` is the setting that actually gates matches; `MAX_MEMECOINS` defaults to 500, high enough that it only excludes wallets that are really airdrop farms rather than traders.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MIN_PORTFOLIO_USD` | 3000 | Minimum total portfolio value |
| `MIN_MEMECOINS` / `MAX_MEMECOINS` | 5 / 500 | Significant memecoin position range |
| `MIN_TRADES_IN_WINDOW` | 5 | Successful transactions required |
| `ACTIVITY_WINDOW_DAYS` | 7 | Activity window |
| `DUST_THRESHOLD_USD` | 25 | Absolute significance floor |
| `MIN_POSITION_SHARE` | 0.01 | Portfolio-relative significance floor |
| `MAX_WATCHLIST_SIZE` | 1000 | Watchlist cap, ranked by score |
| `MIN_TRADE_ALERT_USD` | 500 | Minimum trade size to alert on |

## Operation notes

Wallets are never rejected on incomplete data. If the pricing cap leaves mints unresolved the wallet is deferred, not dropped, and the cached misses let the next pass finish the job. RPC failures likewise defer rather than reject, so a flaky endpoint cannot quietly discard qualifying traders.

Prices and unpriced-mint misses are cached in SQLite, so repeat scans are much cheaper than the first. Watchlist wallets get a warm-up poll that records recent history without alerting, so restarting does not replay old trades.

State lives in `data/fomo-tracker.db` (`DB_PATH`).
