# Polymarket Whale Bot

Standalone TypeScript Telegram bot for tracking large Polymarket whale and insider trades, generating polished alert cards, and posting premium compact alerts to a Telegram channel.

## Setup

```bash
cd /home/Enin/polymarket-whale-bot
cp .env.example .env
npm install
npm run dev
```

## Environment

- `TELEGRAM_BOT_TOKEN`: required, keep only in local `.env`
- `TELEGRAM_CHANNEL_ID`: defaults to `-1003756373077`
- `ALERT_MODE`: `compact`, `image`, or `hybrid`
- `POLYGONSCAN_API_KEY`: optional, enables fresh USDC capital inflow detection

The project ignores `.env` so real bot tokens are not committed.

## Persistence

- SQLite data is stored at `data/whale-bot.db`
- `better-sqlite3` compiles a native addon during `npm install`; on Ubuntu 24.04/VPS this should build automatically with standard build tools installed

## Sample outputs

Startup smoke test writes:

- `sample-compact-alert.png`
- `sample-premium-alert.png`
- `sample-alert.txt`

## Run

```bash
npm run dev
```
