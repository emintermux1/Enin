import path from 'node:path';
import dotenv from 'dotenv';
import { AlertMode, AppConfig } from './types';

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

function readAlertMode(name: string, fallback: AlertMode): AlertMode {
  const raw = readString(name, fallback);
  if (raw === 'compact' || raw === 'image' || raw === 'hybrid') {
    return raw;
  }
  return fallback;
}

export const config: AppConfig = {
  telegram: {
    botToken: readString('TELEGRAM_BOT_TOKEN'),
    channelId: readString('TELEGRAM_CHANNEL_ID', '-1003756373077'),
    referralUrl: readString('REFERRAL_URL', 'https://t.me/PolytechTradeBot?start=ref_cococooker'),
    referralButtonText: readString('REFERRAL_BUTTON_TEXT', '⚡ Trade on Polytech'),
    alertMode: readAlertMode('ALERT_MODE', 'hybrid'),
  },
  tracking: {
    minTradeSize: readNumber('MIN_TRADE_SIZE', 10_000),
    pollIntervalMs: readNumber('POLL_INTERVAL_MS', 15_000),
    maxTrackedWallets: readNumber('MAX_TRACKED_WALLETS', 200),
    leaderboardRefreshHours: readNumber('LEADERBOARD_REFRESH_HOURS', 6),
    walletBatchSize: 20,
  },
  api: {
    gammaApiUrl: readString('GAMMA_API_URL', 'https://gamma-api.polymarket.com'),
    dataApiUrl: readString('DATA_API_URL', 'https://data-api.polymarket.com'),
    timeoutMs: 15_000,
    retryCount: 3,
    minRequestSpacingMs: 40,
  },
  runtime: {
    sampleCompactCardPath: path.resolve(process.cwd(), 'sample-compact-alert.png'),
    samplePosterCardPath: path.resolve(process.cwd(), 'sample-premium-alert.png'),
    sampleAlertPath: path.resolve(process.cwd(), 'sample-alert.txt'),
  },
};

if (!config.telegram.botToken) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
}
