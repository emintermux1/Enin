export interface AppConfig {
  solana: {
    rpcUrls: string[];
    minRequestSpacingMs: number;
    maxConcurrency: number;
    retryCount: number;
    timeoutMs: number;
  };
  discovery: {
    /**
     * fomo-specific accounts that every fomo trade touches (router program,
     * gas sponsor, fee recipient). Traders are enumerated from these.
     */
    routerAccounts: string[];
    /** Known fomo wallets used to derive routerAccounts via intersection. */
    seedWallets: string[];
    /** Explicit wallets to track regardless of discovery. */
    manualWallets: string[];
    /** fomo-launched token mints used to bootstrap holder discovery. */
    seedMints: string[];
    /**
     * Gas-sponsoring relayers that pay fees on behalf of app traders. Their
     * co-signers are the trader population and are the most reliable source we
     * have, since fomo itself runs no on-chain router. See README.
     */
    sponsorAccounts: string[];
    signaturesPerRouterScan: number;
    maxCandidatesPerCycle: number;
    /** fomo-launched mints expanded to their traders per discovery cycle. */
    fomoMintsPerCycle: number;
    signaturesPerFomoMint: number;
    signaturesPerSponsorScan: number;
  };
  filter: {
    minPortfolioUsd: number;
    minMemecoins: number;
    maxMemecoins: number;
    minTradesInWindow: number;
    activityWindowDays: number;
    /** Absolute floor for counting a position as a real memecoin holding. */
    dustThresholdUsd: number;
    /** Portfolio-relative floor, applied alongside dustThresholdUsd. */
    minPositionShare: number;
  };
  monitor: {
    discoveryIntervalMs: number;
    refreshIntervalMs: number;
    activityPollIntervalMs: number;
    maxWatchlistSize: number;
    minTradeAlertUsd: number;
  };
  telegram: {
    botToken: string;
    chatId: string;
    enabled: boolean;
  };
  db: {
    path: string;
  };
}

export interface TokenPrice {
  mint: string;
  usdPrice: number;
  decimals: number;
  liquidity: number;
  priceChange24h: number;
}

export interface TokenHolding {
  mint: string;
  uiAmount: number;
  decimals: number;
  usdValue: number;
}

export type TokenClass = 'stable' | 'major' | 'memecoin' | 'dust' | 'unpriced';

export interface ClassifiedHolding extends TokenHolding {
  tokenClass: TokenClass;
}

export interface Portfolio {
  wallet: string;
  solUsdValue: number;
  cashUsdValue: number;
  memecoinUsdValue: number;
  totalUsdValue: number;
  memecoinCount: number;
  /** Minimum position value counted as a real memecoin holding. */
  positionFloorUsd: number;
  /** False when the per-wallet pricing cap left mints unresolved. */
  pricingComplete: boolean;
  mintCount: number;
  holdings: ClassifiedHolding[];
  fetchedAt: number;
}

export interface WalletActivity {
  wallet: string;
  tradeCount: number;
  lastTradeAt: number | null;
  windowDays: number;
}

export interface TraderCandidate {
  wallet: string;
  source: TraderSource;
  discoveredAt: number;
}

export type TraderSource = 'router' | 'seed' | 'manual' | 'fomo_token' | 'sponsor';

export interface QualifiedTrader {
  wallet: string;
  source: TraderSource;
  portfolioUsd: number;
  cashUsd: number;
  memecoinUsd: number;
  memecoinCount: number;
  tradeCount: number;
  lastTradeAt: number | null;
  score: number;
  qualifiedAt: number;
}

export type RejectReason =
  | 'below_min_portfolio'
  | 'too_few_memecoins'
  | 'too_many_memecoins'
  | 'inactive';

export interface FilterResult {
  wallet: string;
  qualified: boolean;
  reason: RejectReason | null;
  trader: QualifiedTrader | null;
}

export interface SignatureEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export interface ParsedInstruction {
  programId?: string;
  parsed?: unknown;
}

export interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
  };
}

export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
      instructions: ParsedInstruction[];
    };
  };
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalanceEntry[];
    postTokenBalances?: TokenBalanceEntry[];
    innerInstructions?: Array<{ index: number; instructions: ParsedInstruction[] }>;
  } | null;
}

export type TradeSide = 'buy' | 'sell';

export interface DetectedTrade {
  wallet: string;
  signature: string;
  mint: string;
  side: TradeSide;
  uiAmount: number;
  usdValue: number;
  blockTime: number;
}

export interface RouterCandidate {
  account: string;
  seedHitCount: number;
  totalOccurrences: number;
}
