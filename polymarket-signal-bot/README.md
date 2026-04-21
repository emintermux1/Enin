# Polymarket Signal Bot

Production-ready Telegram bot for detecting, enriching, and publishing high-signal Polymarket trades from whales, insiders, smart-money wallets, and external signal channels.

This repository is designed to run as an owned media asset: connect your own Telegram bot, channel, referral link, and optional API keys, then operate it from a VPS with minimal manual intervention.

## Features

### Detection
- **Trade Firehose** — Polls all public Polymarket trades every 5s to catch large activity across the full market.
- **Leaderboard Tracking** — Monitors 240+ top PnL and volume wallets across categories.
- **Struct WebSocket** — Real-time whale trade alerts via Struct.to WebSocket with lower latency than polling. Free tier available with 5000 credits/month.
- **Hashdive Discovery** — Optional whale discovery stream from Hashdive.
- **PolyCop Signal Scraping** — Monitors `@PolyCop_Signal` alongside other public Telegram channels for additional whale and smart-money signals.
- **Capital Inflow Detection** — Watches Polygon USDC transfers to highlight fresh capital entering tracked wallets.
- **Multi-Wallet Coordination** — Detects multiple wallets building into the same market in a short window.

### Intelligence
- **Insider Detection** — Scores trades from 0-100 using win rate, wallet freshness, entry location, streaks, and behavioral signals.
- **Polynter API** — Free market enrichment layer that adds APY, volume, liquidity, tags, and direct Polymarket URLs.
- **Smart Score** — Composite trader quality score combining win rate, volume, and consistency.
- **Price Momentum** — Tracks 1h market price change and directional movement.
- **News Correlation** — Matches trades against Google News RSS timing to surface event-driven behavior.
- **Trader Performance Simulation** — Tracks recent trades per wallet and simulates a `$100/trade` backtest with PnL, wins, losses, and win rate.
- **Resolution Checker** — Monitors resolved markets and posts PnL cards for profitable calls above `+$50K`.

### Output & Operations
- **Rich Alert Cards** — Generates premium `1280x720` canvas cards with market thumbnail, trade overlay, and badges.
- **Telegram Admin Panel** — Full private command-based administration through Telegram with no direct server edits required for day-to-day control.
- **Runtime Config** — JSON-persisted runtime settings that survive restarts and can be hot-reloaded via admin commands.
- **Alert Throttle** — Prevents spam with a configurable max alerts per wallet per market per day.
- **Market Heatmap** — Auto-posts a premium market heatmap card every 12 hours showing the top 5 markets by whale volume.
- **Daily Leaderboard** — Auto-posts every 6 hours with top winners and losers at `±$100K` daily PnL, pinned and updated in place.
- **Trader Backtest Summaries** — Publishes wallet backtest summaries after enough resolved trades accumulate.
- **Performance Alerts** — Emits follow-up alerts when tracked traders cross profitable, losing, or elite thresholds.
- **SQLite Persistence** — Stores trade history, state, trader evidence, and message metadata locally.

## Architecture

```text
Detection Sources:
├── Trade Firehose (primary) — data-api.polymarket.com/trades (every 5s)
├── Wallet Polling — data-api.polymarket.com/activity (top 240+ wallets, batched)
├── Hashdive Discovery — hashdive.com/api (every 2min, optional)
├── Struct WebSocket — struct.to real-time alerts (optional)
└── Telegram Scraper — t.me/s/polymarket_whale + polymarket_whales + polycop_signal (every 60s)

Enrichment Pipeline:
├── Trader Stats (positions, win rate, P&L, portfolio)
├── Market Info (volume, liquidity, end date, outcomes)
├── Holder Analysis (top holders, trader rank, side distribution)
├── Hashdive Profile (resolved wins/losses, volume, top category)
├── Polynter Data (APY, volume, liquidity, tags, market URL)
├── Polygonscan Inflow (USDC transfers in last 24h)
├── News Correlation (Google News RSS keyword matching)
├── Price Momentum (1h price change tracking)
├── Smart Score (composite trader quality metric)
└── Wallet Patterns (repeat trader, high-risk preference)

Classification:
├── Trader Type: WHALE | INSIDER | TOP_HOLDER | CONVICTION_BUILD | SMART_MONEY
├── Risk Level: 🔴 HIGH (3-30¢) | 🟡 MED (30-60¢) | 🟢 LOW (60-93¢)
├── Insider Score: 0-100 (win rate, fresh wallet, streaks, price)
└── Unusual Score: 0-100 (volume ratio, liquidity impact)

Output:
├── Canvas card image (1280x720, market thumbnail + trade overlay)
├── Enriched caption with premium Telegram emojis
├── Intelligence signals (top 2 priority-sorted)
├── Inline buttons (Referral + View Polymarket)
├── Market Heatmap card (every 12h)
├── Daily Leaderboard (every 6h, pinned)
├── Resolution PnL cards (profitable calls)
├── Trader Backtest summaries
└── Performance alerts (thresholds crossed)
```

## Source structure

```text
src/
├── index.ts                         # Entry point, wires all systems
├── config.ts                        # Environment-based configuration
├── types.ts                         # Core interfaces
├── admin/
│   ├── admin-panel.ts               # Telegram admin commands (12 commands)
│   └── runtime-config.ts            # JSON-persisted runtime settings
├── api/
│   ├── data-api.ts                  # Polymarket Data API (trades, positions, leaderboard)
│   ├── gamma-api.ts                 # Polymarket Gamma API (markets, events)
│   ├── hashdive-api.ts              # Hashdive enrichment API
│   ├── news-api.ts                  # Google News RSS feed
│   ├── polynter-api.ts              # Polynter market enrichment (free)
│   ├── polygonscan-api.ts           # Polygonscan USDC transfer detection
│   ├── struct-api.ts                # Struct WebSocket client
│   └── http-client.ts               # Shared HTTP client with retry/rate-limit
├── tracker/
│   ├── whale-tracker.ts             # Main orchestrator (all detection streams)
│   ├── trade-firehose.ts            # Primary: polls all trades every 5s
│   ├── wallet-manager.ts            # Leaderboard wallet tracking
│   ├── hashdive-discovery.ts        # Hashdive whale trade polling
│   ├── struct-discovery.ts          # Struct real-time whale detection
│   ├── telegram-channel-scraper.ts  # Public Telegram signal scraping
│   ├── trade-enricher.ts            # Parallel enrichment pipeline
│   ├── price-history.ts             # 1h price momentum tracking
│   ├── alert-throttle.ts            # Per-wallet per-market daily throttle
│   ├── daily-leaderboard.ts         # Auto-posted leaderboard (6h)
│   ├── market-heatmap.ts            # Market heatmap card (12h)
│   ├── resolution-checker.ts        # Resolved market PnL tracking
│   └── dedup-cache.ts               # LRU deduplication (txHash + source keys)
├── classifier/
│   ├── trader-classifier.ts         # WHALE/INSIDER/TOP_HOLDER/CONVICTION_BUILD
│   ├── insider-scorer.ts            # 0-100 insider probability score
│   ├── unusual-scorer.ts            # 0-100 unusual trade score
│   ├── risk-classifier.ts           # Price-based risk level
│   ├── coordination-detector.ts     # Multi-wallet same-side detection
│   ├── pressure-detector.ts         # Buy/sell pressure from top holders
│   └── news-correlator.ts           # Trade-news timing correlation
├── telegram/
│   ├── channel-poster.ts            # Telegram output (cards, captions, buttons, updates)
│   └── premium-emojis.ts            # Custom emoji ID mappings
├── image/
│   └── card-generator.ts            # Canvas card generation (1280x720)
├── db/
│   ├── database.ts                  # SQLite initialization
│   ├── wallet-trade-repo.ts         # Trade persistence + pattern analysis
│   ├── trader-performance-repo.ts   # Backtest simulation & tracking
│   └── insider-tracker.ts           # Cumulative insider evidence
└── utils/
    ├── logger.ts
    └── formatter.ts
```

## Setup

```bash
cd polymarket-signal-bot
cp .env.example .env
# Fill in your credentials in .env
npm install
npm run dev
npm run start
npm run typecheck
```

Minimum required configuration:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHANNEL_ID=-100your_channel_id
REFERRAL_URL=https://t.me/PolytechTradeBot?start=ref_frederickbased
REFERRAL_BUTTON_TEXT=⚡ Trade on Polytech
```

Optional but recommended:

```env
ADMIN_USER_ID=your_telegram_user_id
STRUCT_API_KEY=your_struct_key
HASHDIVE_API_KEY=your_hashdive_key
POLYGONSCAN_API_KEY=your_polygonscan_key
POLYNTER_ENABLED=1
MAX_ALERTS_PER_WALLET_MARKET=5
```

## Admin Panel

The bot includes a built-in Telegram admin panel. Set your `ADMIN_USER_ID` in `.env`, then message the bot directly.

### Commands

| Command | Description |
|---|---|
| `/start` | Welcome message & command list |
| `/status` | Bot uptime, state, active sources |
| `/config` | View all current settings |
| `/setmin <amount>` | Set minimum trade size (e.g. `/setmin 5000`) |
| `/setmax <amount>` | Set max alerts per wallet/market/day |
| `/sources` | View data source status (on/off) |
| `/toggle <source>` | Toggle a source (firehose/hashdive/struct/scraper/polynter) |
| `/pause` | Pause all tracking |
| `/resume` | Resume tracking |
| `/stats` | Bot statistics from database |
| `/referral <url>` | Update referral link and button text |
| `/help` | Show all commands |

Settings changed via admin commands are persisted to `data/admin-config.json` and survive restarts.

## Deployment (VPS)

```bash
# Install Node.js 20+, pm2, tsx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
npm install -g pm2 tsx

# Clone and setup
git clone -b canary https://github.com/emintermux1/Enin.git
cd Enin/polymarket-signal-bot
cp .env.example .env
# Edit .env with real credentials
npm install

# Start with pm2
pm2 start "npx tsx src/index.ts" --name signal-bot

# Set your admin user ID
echo "ADMIN_USER_ID=your_telegram_id" >> .env
pm2 restart signal-bot
pm2 save && pm2 startup

# Update
cd ~/Enin && git checkout -- . && git pull origin canary && cd polymarket-signal-bot && npm install && pm2 restart signal-bot
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | - | Bot token from @BotFather |
| `TELEGRAM_CHANNEL_ID` | ✅ | - | Target Telegram channel ID (negative number) |
| `REFERRAL_URL` | ❌ | `https://t.me/PolytechTradeBot?start=ref_frederickbased` | Referral link for Trade button |
| `REFERRAL_BUTTON_TEXT` | ❌ | `⚡ Trade on Polytech` | Trade button label |
| `ADMIN_USER_ID` | ❌ | `0` | Your Telegram user ID for admin panel (get from @userinfobot) |
| `MIN_TRADE_SIZE` | ❌ | `10000` | Minimum trade USD required before an alert is posted |
| `MAX_ALERTS_PER_WALLET_MARKET` | ❌ | `5` | Max alerts per wallet per market per day |
| `POLL_INTERVAL_MS` | ❌ | `15000` | Leaderboard wallet polling interval |
| `FIREHOSE_POLL_INTERVAL_MS` | ❌ | `5000` | Trade firehose polling interval |
| `HASHDIVE_API_KEY` | ❌ | - | Hashdive API key for optional resolved-trader enrichment |
| `HASHDIVE_POLL_INTERVAL_MS` | ❌ | `120000` | Hashdive discovery polling interval |
| `STRUCT_API_KEY` | ❌ | - | Struct.to API key for real-time WebSocket alerts |
| `POLYGONSCAN_API_KEY` | ❌ | - | Polygonscan API key for recent USDC inflow detection |
| `SCRAPE_POLL_INTERVAL_MS` | ❌ | `60000` | Telegram channel scraping interval |
| `LEADERBOARD_REFRESH_HOURS` | ❌ | `6` | How often tracked leaderboard wallets are rebuilt |
| `POLYNTER_ENABLED` | ❌ | `1` | Enable/disable Polynter market enrichment |
| `GAMMA_API_URL` | ❌ | `https://gamma-api.polymarket.com` | Override Polymarket Gamma API base URL |
| `DATA_API_URL` | ❌ | `https://data-api.polymarket.com` | Override Polymarket Data API base URL |
| `TELEGRAM_DRY_RUN` | ❌ | `0` | Set to `1` to skip live Telegram sends while still generating startup artifacts |

## Operations

### Recommended launch flow

```bash
npm install
npm run typecheck
npm run start
```

### Production process management

```bash
pm2 logs signal-bot
pm2 restart signal-bot
pm2 status signal-bot
```

### Runtime control without restart
Use the admin panel to change:

- minimum trade size
- max alerts per wallet/market/day
- referral URL and button text
- enabled data sources
- pause/resume state

These changes are written to `data/admin-config.json` and reapplied automatically on restart.

## Notes

- Admin commands work only in private chat with the bot and require the configured `ADMIN_USER_ID`.
- Runtime settings (min trade size, max alerts, referral, data sources, pause state) can be changed without restart via the admin panel.
- The bot posts market heatmaps every 12h, daily leaderboards every 6h, and resolution PnL cards automatically.
- Struct WebSocket provides real-time alerts but requires an API key (free tier available at `struct.to`).
- Polynter enrichment is free and enabled by default — no API key needed.
- SQLite state is stored locally and powers trade history, throttling, trader evidence, leaderboard message state, and backtest tracking.
- On startup the bot runs a smoke test, writes a sample caption, and attempts to generate a sample card before launching live monitoring.
- If native Canvas support is unavailable, the bot continues in text-only mode instead of failing hard.
