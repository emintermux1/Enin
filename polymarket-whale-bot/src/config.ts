import path from 'node:path';
import dotenv from 'dotenv';
import { AppConfig } from './types';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw?.trim() || fallback;
}

export const config: AppConfig = {
  telegram: {
    botToken: readString('TELEGRAM_BOT_TOKEN'),
    channelId: readString('TELEGRAM_CHANNEL_ID'),
    referralUrl: readString('REFERRAL_URL', 'https://t.me/predictr_trade_bot?start=ref_Hadeshacks'),
    referralButtonText: readString('REFERRAL_BUTTON_TEXT', '⚡ Trade on Predictr'),
  },
  tracking: {
    minTradeSize: readNumber('MIN_TRADE_SIZE', 10_000),
    maxAlertsPerWalletPerMarket: readNumber('MAX_ALERTS_PER_WALLET_MARKET', 5),
    pollIntervalMs: readNumber('POLL_INTERVAL_MS', 15_000),
    firehosePollIntervalMs: readNumber('FIREHOSE_POLL_INTERVAL_MS', 5_000),
    hashdivePollIntervalMs: readNumber('HASHDIVE_POLL_INTERVAL_MS', 120_000),
    leaderboardRefreshHours: readNumber('LEADERBOARD_REFRESH_HOURS', 6),
    walletBatchSize: 20,
  },
  scraping: {
    enabled: true,
    pollIntervalMs: readNumber('SCRAPE_POLL_INTERVAL_MS', 60_000),
    channels: ['polymarket_whale', 'polymarket_whales', 'polycop_signal'],
  },
  api: {
    gammaApiUrl: readString('GAMMA_API_URL', 'https://gamma-api.polymarket.com'),
    dataApiUrl: readString('DATA_API_URL', 'https://data-api.polymarket.com'),
    timeoutMs: 15_000,
    retryCount: 3,
    minRequestSpacingMs: 40,
    hashdiveApiKey: readString('HASHDIVE_API_KEY', ''),
  },
  struct: {
    apiKey: readString('STRUCT_API_KEY', ''),
    enabled: Boolean(readString('STRUCT_API_KEY', '')),
  },
  polynter: {
    enabled: readNumber('POLYNTER_ENABLED', 1) === 1,
  },
  polygonscan: {
    apiKey: readString('POLYGONSCAN_API_KEY', ''),
    enabled: Boolean(readString('POLYGONSCAN_API_KEY', '')),
  },
  runtime: {
    sampleCardPath: path.resolve(process.cwd(), 'sample-card.png'),
    sampleCaptionPath: path.resolve(process.cwd(), 'sample-caption.txt'),
  },
};

if (!config.telegram.botToken) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
}

if (!config.telegram.channelId) {
  throw new Error('Missing TELEGRAM_CHANNEL_ID in .env');
}
