import { SolanaRpc } from '../chain/solana-rpc';
import { config } from '../config';
import { getUnexpandedFomoMints, markFomoMintExpanded } from '../db/fomo-mint-repo';
import { ParsedTransaction, TraderCandidate } from '../types';
import { isSharedInfra } from './known-programs';
import { short } from './router-discovery';

/**
 * Tokens launched through fomo carry a vanity mint suffix, so a mint ending in
 * `fomo` is direct on-chain evidence of the app. The wallets trading them are
 * fomo users, which gives a discovery path that needs no router address.
 */
export const FOMO_MINT_SUFFIX = 'fomo';

export function isFomoLaunchedMint(mint: string): boolean {
  return mint.endsWith(FOMO_MINT_SUFFIX);
}

export function extractFomoMints(mints: string[]): string[] {
  return mints.filter(isFomoLaunchedMint);
}

/**
 * Expands the candidate pool from known fomo-launched tokens to the wallets
 * trading them. Each newly screened wallet surfaces further fomo mints, so the
 * pool snowballs from a single starting point.
 */
export async function expandFromFomoMints(
  rpc: SolanaRpc,
  mintLimit: number
): Promise<TraderCandidate[]> {
  const mints = getUnexpandedFomoMints(mintLimit);
  if (mints.length === 0) {
    return [];
  }

  const discovered = new Map<string, TraderCandidate>();

  for (const mint of mints) {
    const wallets = new Set<string>();

    for (const wallet of await tradersFromMintHistory(rpc, mint)) {
      wallets.add(wallet);
    }
    for (const wallet of await topHoldersOfMint(rpc, mint)) {
      wallets.add(wallet);
    }

    if (wallets.size === 0) {
      console.warn(`[fomo-token] ${short(mint)}: no wallets resolved, leaving for a later pass`);
      continue;
    }

    for (const wallet of wallets) {
      if (!discovered.has(wallet)) {
        discovered.set(wallet, { wallet, source: 'fomo_token', discoveredAt: Date.now() });
      }
    }

    markFomoMintExpanded(mint);
    console.log(`[fomo-token] ${short(mint)}: ${wallets.size} wallets`);
  }

  return [...discovered.values()];
}

/**
 * Primary path. Recent transactions referencing the mint reveal who is actually
 * trading it, which suits an "active traders" watchlist better than a holder
 * snapshot, and relies only on RPC methods that free endpoints keep enabled.
 */
async function tradersFromMintHistory(rpc: SolanaRpc, mint: string): Promise<string[]> {
  try {
    const signatures = await rpc.getSignaturesPaged(mint, config.discovery.signaturesPerFomoMint);
    const successful = signatures.filter((entry) => !entry.err).map((entry) => entry.signature);
    const transactions = await rpc.getTransactions(successful);

    const owners = new Set<string>();
    for (const tx of transactions.values()) {
      for (const owner of ownersOfMint(tx, mint)) {
        owners.add(owner);
      }
    }
    return [...owners];
  } catch (err) {
    console.warn(
      `[fomo-token] ${short(mint)} history scan failed:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/**
 * Supplementary path. `getTokenLargestAccounts` is rate limited or disabled on
 * some free endpoints, so failure here is expected and not reported loudly.
 */
async function topHoldersOfMint(rpc: SolanaRpc, mint: string): Promise<string[]> {
  try {
    const tokenAccounts = await rpc.getTokenLargestAccounts(mint);
    const owners = await rpc.getTokenAccountOwners(tokenAccounts);
    return owners.filter((owner) => !isSharedInfra(owner));
  } catch {
    return [];
  }
}

function ownersOfMint(tx: ParsedTransaction, mint: string): string[] {
  const balances = [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])];

  const owners = new Set<string>();
  for (const balance of balances) {
    if (balance.mint !== mint) {
      continue;
    }
    const owner = balance.owner;
    if (!owner || owner === mint || isSharedInfra(owner)) {
      continue;
    }
    owners.add(owner);
  }
  return [...owners];
}
