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

function readList(name: string): string[] {
  const raw = readString(name);
  if (!raw) {
    return [];
  }
  return [...new Set(raw.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

const botToken = readString('TELEGRAM_BOT_TOKEN');
const chatId = readString('TELEGRAM_CHAT_ID');

const DEFAULT_RPC_URLS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];

/**
 * The DFlow gasless relayer, found by tracing a known fomo wallet's swaps. It
 * pays the fee on hundreds of trades per minute for wallets that hold no SOL,
 * which is the app-trader population fomo trades through. Not fomo-exclusive:
 * other DFlow-integrated apps share it, so the filter stage still decides.
 */
const DEFAULT_SPONSOR_ACCOUNTS = ['AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51'];

/**
 * Free endpoints throttle in different ways — some answer 429, others simply
 * stop responding — so several are kept and rotated. A single paid endpoint in
 * SOLANA_RPC_URL is the better setup and takes precedence.
 */
function resolveRpcUrls(): string[] {
  const list = readList('SOLANA_RPC_URLS');
  const single = readString('SOLANA_RPC_URL');
  const configured = [...new Set([...(single ? [single] : []), ...list])];
  return configured.length > 0 ? configured : DEFAULT_RPC_URLS;
}

function resolveSponsorAccounts(): string[] {
  const configured = readList('FOMO_SPONSOR_ACCOUNTS');
  if (configured.length === 1 && configured[0]?.toLowerCase() === 'none') {
    return [];
  }
  return configured.length > 0 ? configured : DEFAULT_SPONSOR_ACCOUNTS;
}

export const config: AppConfig = {
  solana: {
    rpcUrls: resolveRpcUrls(),
    minRequestSpacingMs: readNumber('RPC_MIN_SPACING_MS', 120),
    maxConcurrency: readNumber('RPC_MAX_CONCURRENCY', 4),
    retryCount: readNumber('RPC_RETRY_COUNT', 3),
    timeoutMs: readNumber('RPC_TIMEOUT_MS', 30_000),
  },
  discovery: {
    routerAccounts: readList('FOMO_ROUTER_ACCOUNTS'),
    seedWallets: readList('FOMO_SEED_WALLETS'),
    manualWallets: readList('FOMO_MANUAL_WALLETS'),
    seedMints: readList('FOMO_SEED_MINTS'),
    sponsorAccounts: resolveSponsorAccounts(),
    signaturesPerRouterScan: readNumber('SIGNATURES_PER_ROUTER_SCAN', 300),
    maxCandidatesPerCycle: readNumber('MAX_CANDIDATES_PER_CYCLE', 400),
    fomoMintsPerCycle: readNumber('FOMO_MINTS_PER_CYCLE', 15),
    signaturesPerFomoMint: readNumber('SIGNATURES_PER_FOMO_MINT', 100),
    signaturesPerSponsorScan: readNumber('SIGNATURES_PER_SPONSOR_SCAN', 500),
  },
  scan: {
    concurrency: readNumber('SCAN_CONCURRENCY', 6),
  },
  filter: {
    minPortfolioUsd: readNumber('MIN_PORTFOLIO_USD', 3_000),
    minMemecoins: readNumber('MIN_MEMECOINS', 5),
    maxMemecoins: readNumber('MAX_MEMECOINS', 500),
    minTradesInWindow: readNumber('MIN_TRADES_IN_WINDOW', 5),
    activityWindowDays: readNumber('ACTIVITY_WINDOW_DAYS', 7),
    dustThresholdUsd: readNumber('DUST_THRESHOLD_USD', 25),
    minPositionShare: readNumber('MIN_POSITION_SHARE', 0.01),
  },
  monitor: {
    discoveryIntervalMs: readNumber('DISCOVERY_INTERVAL_MS', 3_600_000),
    refreshIntervalMs: readNumber('REFRESH_INTERVAL_MS', 3_600_000),
    activityPollIntervalMs: readNumber('ACTIVITY_POLL_INTERVAL_MS', 300_000),
    maxWatchlistSize: readNumber('MAX_WATCHLIST_SIZE', 1_000),
    minTradeAlertUsd: readNumber('MIN_TRADE_ALERT_USD', 500),
  },
  telegram: {
    botToken,
    chatId,
    enabled: Boolean(botToken && chatId),
  },
  db: {
    path: readString('DB_PATH', path.resolve(process.cwd(), 'data/fomo-tracker.db')),
  },
};

export function describeConfig(): string {
  const { filter, discovery, monitor } = config;
  return [
    `portfolio >= $${filter.minPortfolioUsd.toLocaleString()}`,
    `memecoins ${filter.minMemecoins}-${filter.maxMemecoins}`,
    `>= ${filter.minTradesInWindow} trades / ${filter.activityWindowDays}d`,
    `watchlist cap ${monitor.maxWatchlistSize}`,
    `sponsor accounts ${discovery.sponsorAccounts.length}`,
    `router accounts ${discovery.routerAccounts.length}`,
    `seed wallets ${discovery.seedWallets.length}`,
    `rpc endpoints ${config.solana.rpcUrls.length}`,
  ].join(' | ');
}
