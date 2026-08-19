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

## Does fomo have a router address?

Short answer: **no, and this was verified on-chain rather than assumed.** Tracing the swaps of a wallet documented as a fomo wallet shows the trades are executed by shared third-party infrastructure:

| Program | What it is |
| --- | --- |
| `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | DFlow, swap aggregator |
| `9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp` | HumidiFi, private AMM |
| `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | PumpSwap |
| `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | pump.fun fee program |
| `DeJBGdMFa1uynnnKiwrVioatTuHmNLpyFKnmB5kaFdzQ` | Phantom's Assert Owner program |
| `JUP6Lkb…`, `cpamdpZ…` | Jupiter, Meteora |

Not one fomo-deployed program among them, which matches how fomo describes itself: a conduit to third-party infrastructure that does not process transactions itself. There is nothing labelled "fomo router" for an explorer to show, and no analytics platform publishes one. The widely shared guide to finding fomo traders uses GMGN to match a *wallet* against a fomo profile by comparing positions, which is wallet identification, not router discovery.

What *does* exist is a gas sponsor, and that is the useful part.

## How discovery works

Three paths, strongest first.

**1. The gasless relayer (default, no configuration needed).** fomo trades are gasless, so someone else pays the network fee while the trader signs as a second signer. Following the fee payer of a known fomo swap leads to `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51`: a plain system account holding ~1,100 SOL that pays fees at roughly **700 transactions per minute**, routing through DFlow, one distinct co-signer per transaction. Those co-signers hold almost no SOL and small USDC balances, the signature of app-managed wallets trading gaslessly.

Walking that account's history therefore yields active app traders at close to one per transaction, the highest yield of any path here. Caveat worth keeping in mind: the relayer belongs to the aggregator layer and is shared with other DFlow-integrated apps, so it is a superset of fomo's traffic rather than fomo alone. Community labels for it are contradictory and none are reliable. Since the filter stage judges wallets on portfolio and activity regardless of which app they use, a superset is an acceptable input; if you want to narrow or replace it, set `FOMO_SPONSOR_ACCOUNTS`, or `none` to disable the path.

**2. fomo-launched tokens.** Tokens created through fomo carry a vanity mint suffix ending in `fomo`, for example `5rYd8uAReEfsoqe4kAxnXar9158CK2Ri6FzD1H7sfomo`. The suffix identifies the token reliably, but **not its holders**: after a token graduates it trades on open DEXs, and sampling holders of such mints turned up wallets trading through Axiom and FlashX. Treat this as a broad lead on memecoin traders rather than proof of app usage. The tracker still crawls it, learning further fomo mints from each wallet it screens.

**3. Derived accounts from seed wallets.** If you have two or three wallets you know are fomo users, the tracker can intersect their transaction histories and rank the accounts common to all of them, after removing shared infrastructure:

```bash
npm run discover-router -- <fomoWallet1> <fomoWallet2> <fomoWallet3>
```

Given the finding above, expect this to surface sponsors and aggregators rather than a fomo program. Pick seeds carefully: inbound spam airdrops also show a third-party fee payer, so a wallet whose fees are paid by someone else is not automatically an app user.

Screening then prices each candidate's holdings via Jupiter, counts significant memecoin positions, measures recent activity, and promotes matches to the watchlist.

## Setup

```bash
cd fomo-trader-tracker
npm install
cp .env.example .env
```

It runs with no configuration at all, because the relayer path is on by default. Optional extra starting points:

```bash
FOMO_SPONSOR_ACCOUNTS=<gas sponsor>   # override the default relayer, or "none"
FOMO_SEED_MINTS=<a mint address ending in "fomo">
FOMO_SEED_WALLETS=<known fomo wallet>,<another>
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

**Screening is the bottleneck, not discovery.** The relayer supplies candidates far faster than they can be screened: a live run produced 60 distinct trader wallets from 60 transactions in 18 seconds, while screening costs roughly 14 seconds per wallet on public RPC. Most sponsored wallets are small retail accounts that fail the $3,000 test, so reaching a full watchlist means screening a lot of them. This is the concrete reason a paid RPC key matters here — raise `RPC_MAX_CONCURRENCY` and lower `RPC_MIN_SPACING_MS` and throughput scales with the endpoint.

Wallets are never rejected on incomplete data. If the pricing cap leaves mints unresolved the wallet is deferred, not dropped, and the cached misses let the next pass finish the job. RPC failures likewise defer rather than reject, so a flaky endpoint cannot quietly discard qualifying traders.

Prices and unpriced-mint misses are cached in SQLite, so repeat scans are much cheaper than the first. Watchlist wallets get a warm-up poll that records recent history without alerting, so restarting does not replay old trades.

State lives in `data/fomo-tracker.db` (`DB_PATH`).
