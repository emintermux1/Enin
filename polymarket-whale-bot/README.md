# Polymarket Whale Bot

Standalone TypeScript Telegram bot for tracking large Polymarket whale and insider trades, generating rich alert cards, and posting them to a Telegram channel.

## Setup

```bash
cd /home/Enin/polymarket-whale-bot
npm install
npm run dev
```

Set `TELEGRAM_CHANNEL_ID` in `.env` before production use and make the bot an admin of the destination channel.
