export interface PolymarketTrade {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: 'BUY' | 'SELL';
  outcomeIndex: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  name: string;
  pseudonym: string;
  bio: string;
  profileImage: string;
}

export interface TraderStats {
  totalPositionsValue: number;
  closedPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  winRateLabel: string;
  totalRealizedPnl: number;
  portfolioValue: number;
  bestWinAmount: number | null;
  bestWinStreak: number | null;
  currentStreak: number | null;
  activeSince: string | null;
  observedTradeCount: number;
}

export interface MarketInfo {
  id: string;
  question: string;
  image: string;
  endDate: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  liquidity: number;
  tags: string[];
  eventSlug: string;
  slug: string;
}

export interface HolderStats {
  topHoldersOnSide: number;
  totalTopHolders: number;
  side: string;
  whalesInMarket: number;
  insidersInMarket: number;
  traderIsTopHolder: boolean;
}

export type TraderType = 'WHALE' | 'INSIDER' | 'TOP_HOLDER' | 'CONVICTION_BUILD';

export interface RiskLevel {
  level: string;
  emoji: string;
  color: string;
}

export interface EnrichedTrade {
  trade: PolymarketTrade;
  traderStats: TraderStats;
  marketInfo: MarketInfo;
  holderStats: HolderStats;
  xUsername?: string;
  traderTypes: TraderType[];
  primaryType: TraderType;
  risk: RiskLevel;
  potentialWin: number;
  multiplier: number;
  isFreshWallet: boolean;
  topCategory: string | null;
  freshWalletsInMarket: number;
  hashdiveProfile?: {
    resolvedWinRate: number;
    resolvedWins: number;
    resolvedLosses: number;
    totalTrades: number;
    totalVolumeUsd: number;
    topCategory: string | null;
  };
  insiderScore?: {
    score: number;
    signals: string[];
    isInsider: boolean;
  };
  unusualScore?: {
    score: number;
    signals: string[];
    isUnusual: boolean;
  };
  coordinationSignal?: {
    walletsOnSameSide: number;
    totalAmount: number;
    timeWindowMinutes: number;
    isCoordinated: boolean;
  };
  pressureSignal?: {
    whalesOnSide: number;
    totalTopHolders: number;
    side: string;
    dominancePercent: number;
    isHighPressure: boolean;
    label: string;
  };
}

export interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
  profileImage: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

export interface LeaderboardQuery {
  category: 'OVERALL' | 'POLITICS' | 'SPORTS' | 'CRYPTO' | 'CULTURE' | 'ECONOMICS' | 'TECH' | 'FINANCE';
  timePeriod: 'DAY' | 'WEEK' | 'MONTH' | 'ALL';
  orderBy: 'PNL' | 'VOL';
  limit: number;
  label: string;
}

export interface TrackedWallet {
  proxyWallet: string;
  userName: string;
  xUsername?: string;
  profileImage?: string;
  verifiedBadge?: boolean;
  pnl: number;
  vol: number;
  allTimeTop50: boolean;
  sources: string[];
  bestPnlRank?: number;
  bestVolRank?: number;
  overallPnlRank?: number;
  overallVolRank?: number;
}

export interface DataPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
}

export interface ClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  icon: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  timestamp: number;
}

export interface HolderEntry {
  proxyWallet: string;
  name?: string;
  amount: number;
  outcomeIndex: number;
  profileImage?: string;
}

export interface HolderGroup {
  token: string;
  holders: HolderEntry[];
}

export interface TelegramConfig {
  botToken: string;
  channelId: string;
  referralUrl: string;
  referralButtonText: string;
}

export interface TrackingConfig {
  minTradeSize: number;
  pollIntervalMs: number;
  hashdivePollIntervalMs: number;
  maxTrackedWallets: number;
  leaderboardRefreshHours: number;
  walletBatchSize: number;
}

export interface ApiConfig {
  gammaApiUrl: string;
  dataApiUrl: string;
  timeoutMs: number;
  retryCount: number;
  minRequestSpacingMs: number;
  hashdiveApiKey?: string;
}

export interface AppConfig {
  telegram: TelegramConfig;
  tracking: TrackingConfig;
  api: ApiConfig;
  runtime: {
    sampleCardPath: string;
    sampleCaptionPath: string;
  };
}
