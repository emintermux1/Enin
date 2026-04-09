# Polymarket Whale & Insider Tracker

Real-time Telegram bot that detects, enriches, and broadcasts large Polymarket trades from whales, insiders, and fresh wallets.

## Features

- 🔥 **Trade Firehose** — Polls ALL Polymarket trades every 5s, catches any $10K+ trade from any wallet
- 🐋 **Leaderboard Tracking** — Monitors 240+ top PnL/Volume wallets across all categories
- 🕵️ **Insider Detection** — Scores trades 0-100 based on win rate, fresh wallet, price extremes, streaks
- 📊 **Hashdive Enrichment** — Resolved win rates and volume from Hashdive API (when available)
- 📰 **News Correlation** — Google News RSS matching to detect trades near breaking news
- 💸 **Capital Inflow Detection** — Polygonscan USDC transfer monitoring for fresh capital alerts
- 🧠 **Multi-Wallet Coordination** — Detects multiple wallets entering same position within 30min
- 🎴 **Rich Alert Cards** — Canvas-generated images with market thumbnail, trade details, risk badge
- 📡 **Telegram Channel Scraping** — Monitors competitor channels for additional trade signals
- 🗄️ **SQLite Persistence** — Trade history, wallet patterns, repeat trader detection

## Architecture

```text
Detection Sources:
├── Trade Firehose (primary) — data-api.polymarket.com/trades (every 5s)
├── Wallet Polling — data-api.polymarket.com/activity (top 240+ wallets, batched)
├── Hashdive Discovery — hashdive.com/api (every 2min, optional)
└── Telegram Scraper — t.me/s/polymarket_whale + polymarket_whales (every 60s)

Enrichment Pipeline:
├── Trader Stats (positions, win rate, P&L, portfolio)
├── Market Info (volume, liquidity, end date, outcomes)
├── Holder Analysis (top holders, trader rank, side distribution)
├── Hashdive Profile (resolved wins/losses, volume, top category)
├── Polygonscan Inflow (USDC transfers in last 24h)
├── News Correlation (Google News RSS keyword matching)
├── Price Momentum (1h price change tracking)
└── Wallet Patterns (repeat trader, high-risk preference)

Classification:
├── Trader Type: WHALE | INSIDER | TOP_HOLDER | CONVICTION_BUILD
├── Risk Level: 🔴 HIGH (3-30¢) | 🟡 MED (30-60¢) | 🟢 LOW (60-93¢)
├── Insider Score: 0-100 (win rate, fresh wallet, streaks, price)
└── Unusual Score: 0-100 (volume ratio, liquidity impact)

Output:
├── Canvas card image (1280x720, market thumbnail + trade overlay)
├── Enriched caption with premium Telegram emojis
├── Intelligence signals (top 2 priority-sorted)
└── Inline buttons (Trade on Polytech + View Polymarket)
```

## Source structure

```text
src/
├── index.ts                    # Entry point, wires all systems
├── config.ts                   # Environment-based configuration
├── types.ts                    # Core interfaces
├── api/
│   ├── data-api.ts             # Polymarket Data API (trades, positions, leaderboard)
│   ├── gamma-api.ts            # Polymarket Gamma API (markets, events)
│   ├── hashdive-api.ts         # Hashdive enrichment API
│   ├── polygonscan-api.ts      # Polygonscan USDC transfer detection
│   ├── news-api.ts             # Google News RSS feed
│   └── http-client.ts          # Shared HTTP client with retry/rate-limit
├── tracker/
│   ├── whale-tracker.ts        # Main orchestrator (all detection streams)
│   ├── trade-firehose.ts       # Primary: polls ALL trades every 5s
│   ├── wallet-manager.ts       # Leaderboard wallet tracking
│   ├── hashdive-discovery.ts   # Hashdive whale trade polling
│   ├── telegram-channel-scraper.ts  # Competitor channel monitoring
│   ├── trade-enricher.ts       # Parallel enrichment pipeline
│   ├── price-history.ts        # 1h price momentum tracking
│   └── dedup-cache.ts          # LRU deduplication (txHash + source keys)
├── classifier/
│   ├── trader-classifier.ts    # WHALE/INSIDER/TOP_HOLDER/CONVICTION_BUILD
│   ├── insider-scorer.ts       # 0-100 insider probability score
│   ├── unusual-scorer.ts       # 0-100 unusual trade score
│   ├── risk-classifier.ts      # Price-based risk level
│   ├── coordination-detector.ts # Multi-wallet same-side detection
│   ├── pressure-detector.ts    # Buy/sell pressure from top holders
│   └── news-correlator.ts      # Trade-news timing correlation
├── telegram/
│   ├── channel-poster.ts       # Telegram output (caption builder, card posting)
│   └── premium-emojis.ts       # Custom emoji ID mappings
├── image/
│   └── card-generator.ts       # Canvas card generation (1280x720)
├── db/
│   ├── database.ts             # SQLite initialization
│   └── wallet-trade-repo.ts    # Trade persistence + pattern analysis
└── utils/
    ├── logger.ts
    └── formatter.ts
```

## Setup

```bash
cd polymarket-whale-bot
cp .env.example .env
# Fill in your credentials in .env
npm install
npm run dev          # Development with hot-reload
npm run start        # Production
npm run typecheck    # Type validation
```

## Deployment (VPS)

```bash
# Install Node.js 20+, pm2, tsx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
npm install -g pm2 tsx

# Clone and setup
git clone -b canary https://github.com/emintermux1/Enin.git
cd Enin/polymarket-whale-bot
cp .env.example .env
# Edit .env with real credentials
npm install

# Start with pm2
pm2 start "npx tsx src/index.ts" --name whale-bot
pm2 save && pm2 startup

# Update
cd ~/Enin && git checkout -- . && git pull origin canary && cd polymarket-whale-bot && npm install && pm2 restart whale-bot
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | - | Bot token from @BotFather |
| `TELEGRAM_CHANNEL_ID` | ✅ | - | Target channel ID (negative number) |
| `REFERRAL_URL` | ❌ | `https://t.me/PolytechTradeBot?start=ref_cococooker` | Referral link for Trade button |
| `REFERRAL_BUTTON_TEXT` | ❌ | `⚡ Trade on Polytech` | Button label |
| `MIN_TRADE_SIZE` | ❌ | `10000` | Minimum trade USD to alert |
| `POLL_INTERVAL_MS` | ❌ | `15000` | Wallet polling interval |
| `FIREHOSE_POLL_INTERVAL_MS` | ❌ | `5000` | Trade firehose interval |
| `HASHDIVE_API_KEY` | ❌ | - | Hashdive API key for enrichment |
| `HASHDIVE_POLL_INTERVAL_MS` | ❌ | `120000` | Hashdive polling interval |
| `POLYGONSCAN_API_KEY` | ❌ | - | Polygonscan API for inflow detection |
| `SCRAPE_POLL_INTERVAL_MS` | ❌ | `60000` | Telegram channel scraping interval |
| `LEADERBOARD_REFRESH_HOURS` | ❌ | `6` | How often tracked leaderboard wallets are rebuilt |
| `GAMMA_API_URL` | ❌ | `https://gamma-api.polymarket.com` | Override Polymarket Gamma API base URL |
| `DATA_API_URL` | ❌ | `https://data-api.polymarket.com` | Override Polymarket Data API base URL |
| `TELEGRAM_DRY_RUN` | ❌ | `0` | Set to `1` to skip live Telegram sends while still generating startup artifacts |

## Notes

- SQLite state is stored locally and powers wallet pattern analysis plus repeat-trader detection.
- On startup the bot runs a smoke test, writes a sample caption, and attempts to generate a sample card before launching live monitoring.
- If native Canvas support is unavailable, the bot continues in text-only mode instead of failing hard.
