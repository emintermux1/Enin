import { alertNewTrader } from '../alerts/telegram';
import { rpc } from '../chain/solana-rpc';
import { config } from '../config';
import {
  getCandidatesToCheck,
  markCandidateChecked,
  countTraders,
  deactivateTrader,
  upsertCandidates,
  upsertTrader,
} from '../db/trader-repo';
import { countFomoMints, recordFomoMints } from '../db/fomo-mint-repo';
import { expandFromFomoMints, extractFomoMints } from '../discovery/fomo-token-discovery';
import { deriveRouterAccounts, short } from '../discovery/router-discovery';
import { discoverTradersFromSponsors } from '../discovery/sponsor-discovery';
import { discoverTraders } from '../discovery/trader-discovery';
import { measureActivity } from '../enrich/activity';
import { buildPortfolio } from '../enrich/portfolio';
import { describeReason, evaluateTrader } from '../filter/trader-filter';
import { TraderCandidate } from '../types';
import { runPool } from '../util/pool';

export interface ScanSummary {
  checked: number;
  qualified: number;
  dropped: number;
  deferred: number;
  watchlistSize: number;
  candidates: number;
}

/**
 * Seeds the candidate pool from fomo's own accounts plus any manually supplied
 * wallets. Router accounts come from config when known, otherwise they are
 * derived from the seed wallets.
 */
export async function runDiscovery(): Promise<number> {
  const manual: TraderCandidate[] = config.discovery.manualWallets.map((wallet) => ({
    wallet,
    source: 'manual',
    discoveredAt: Date.now(),
  }));
  const seeds: TraderCandidate[] = config.discovery.seedWallets.map((wallet) => ({
    wallet,
    source: 'seed',
    discoveredAt: Date.now(),
  }));

  let inserted = upsertCandidates([...manual, ...seeds]);
  recordFomoMints(config.discovery.seedMints);

  // Gas sponsors are the primary path: one sponsored signer per transaction,
  // every one of them an app trader who is active right now.
  const fromSponsors = await discoverTradersFromSponsors(rpc, config.discovery.sponsorAccounts);
  inserted += upsertCandidates(fromSponsors);

  // Traders of fomo-launched tokens. A weaker signal than the sponsor path,
  // since these tokens keep trading on open DEXs after they graduate.
  const fromFomoTokens = await expandFromFomoMints(rpc, config.discovery.fomoMintsPerCycle);
  inserted += upsertCandidates(fromFomoTokens);

  const routerAccounts = await resolveRouterAccounts();
  if (routerAccounts.length > 0) {
    const discovered = await discoverTraders(rpc, routerAccounts);
    inserted += upsertCandidates(discovered);
    console.log(`[discovery] router pass: ${discovered.length} candidates seen`);
  }

  const mintCounts = countFomoMints();
  if (
    config.discovery.sponsorAccounts.length === 0 &&
    routerAccounts.length === 0 &&
    mintCounts.total === 0
  ) {
    console.warn(
      '[discovery] no sponsor accounts, no router accounts and no fomo-launched ' +
        'tokens known yet; only manual and seed wallets are tracked'
    );
  }
  console.log(
    `[discovery] ${inserted} new candidates | fomo tokens known ${mintCounts.total} ` +
      `(${mintCounts.pending} not yet expanded)`
  );

  return inserted;
}

async function resolveRouterAccounts(): Promise<string[]> {
  if (config.discovery.routerAccounts.length > 0) {
    return config.discovery.routerAccounts;
  }
  if (config.discovery.seedWallets.length === 0) {
    return [];
  }

  console.log('[discovery] no router accounts configured, deriving from seed wallets');
  const derived = await deriveRouterAccounts(rpc, config.discovery.seedWallets);
  const confident = derived.filter(
    (candidate) => candidate.seedHitCount >= Math.min(2, config.discovery.seedWallets.length)
  );

  if (confident.length === 0) {
    return [];
  }

  const top = confident.slice(0, 5);
  console.log(
    `[discovery] derived router candidates: ${top
      .map((candidate) => `${short(candidate.account)}(${candidate.seedHitCount})`)
      .join(', ')}`
  );
  return top.map((candidate) => candidate.account);
}

/**
 * Prices and screens candidate wallets, promoting the ones that match the
 * criteria onto the watchlist and dropping ones that no longer do.
 */
export async function runScan(batchSize: number): Promise<ScanSummary> {
  const staleBefore = Date.now() - config.monitor.refreshIntervalMs;
  const candidates = getCandidatesToCheck(batchSize, staleBefore);

  let qualified = 0;
  let dropped = 0;
  let deferred = 0;

  // Screening a wallet is mostly waiting on RPC and price responses, so wallets
  // are screened in parallel to fill capacity the sequential version left idle.
  await runPool(candidates, config.scan.concurrency, async (candidate) => {
    const outcome = await screenCandidate(candidate);
    switch (outcome) {
      case 'qualified':
        qualified += 1;
        break;
      case 'dropped':
        dropped += 1;
        break;
      case 'deferred':
        deferred += 1;
        break;
      case 'refreshed':
      case 'failed':
        break;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unhandled scan outcome: ${String(exhaustive)}`);
      }
    }
  });

  const counts = countTraders();

  return {
    checked: candidates.length,
    qualified,
    dropped,
    deferred,
    watchlistSize: counts.active,
    candidates: counts.candidates,
  };
}

/** `refreshed` is a wallet that still qualifies and was already on the watchlist. */
type ScanOutcome = 'qualified' | 'refreshed' | 'dropped' | 'deferred' | 'failed';

async function screenCandidate(candidate: TraderCandidate): Promise<ScanOutcome> {
  try {
    const portfolio = await buildPortfolio(rpc, candidate.wallet);

    // Every wallet screened teaches us about more fomo-launched tokens, whose
    // holders become the next round of candidates.
    recordFomoMints(extractFomoMints(portfolio.holdings.map((holding) => holding.mint)));

    // Judging a wallet on partial pricing produces false rejections. The
    // misses are cached, so the next pass resolves the remaining mints.
    if (!portfolio.pricingComplete) {
      console.log(
        `[scan] ${short(candidate.wallet)} deferred: ${portfolio.mintCount} mints, pricing incomplete`
      );
      return 'deferred';
    }

    const activity = await measureActivity(rpc, candidate.wallet);
    const result = evaluateTrader(portfolio, activity, candidate.source);

    markCandidateChecked(candidate.wallet, result.reason);

    if (result.qualified && result.trader) {
      const isNew = upsertTrader(result.trader);
      console.log(
        `[scan] ${short(candidate.wallet)} qualified: $${Math.round(portfolio.totalUsdValue)}, ` +
          `${portfolio.memecoinCount} memecoins above $${Math.round(portfolio.positionFloorUsd)}, ` +
          `${activity.tradeCount} trades`
      );
      if (!isNew) {
        return 'refreshed';
      }
      await alertNewTrader(result.trader);
      return 'qualified';
    }

    deactivateTrader(candidate.wallet);
    console.log(`[scan] ${short(candidate.wallet)} rejected: ${describeReason(result.reason)}`);
    return 'dropped';
  } catch (err) {
    console.warn(
      `[scan] ${short(candidate.wallet)} failed:`,
      err instanceof Error ? err.message : String(err)
    );
    return 'failed';
  }
}
