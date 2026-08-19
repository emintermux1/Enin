import { SolanaRpc } from '../chain/solana-rpc';
import { getUnexpandedFomoMints, markFomoMintExpanded } from '../db/fomo-mint-repo';
import { TraderCandidate } from '../types';
import { short } from './router-discovery';

/**
 * Tokens launched through fomo carry a vanity mint suffix, so a mint ending in
 * `fomo` is direct on-chain evidence of the app. Their holders are fomo users,
 * which gives a discovery path that needs no router address.
 */
export const FOMO_MINT_SUFFIX = 'fomo';

export function isFomoLaunchedMint(mint: string): boolean {
  return mint.endsWith(FOMO_MINT_SUFFIX);
}

export function extractFomoMints(mints: string[]): string[] {
  return mints.filter(isFomoLaunchedMint);
}

/**
 * Expands the candidate pool from known fomo-launched tokens to their largest
 * holders. Each newly screened wallet surfaces further fomo mints, so the pool
 * snowballs from a single starting point.
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
    try {
      const tokenAccounts = await rpc.getTokenLargestAccounts(mint);
      const owners = await rpc.getTokenAccountOwners(tokenAccounts);

      for (const owner of owners) {
        if (!discovered.has(owner)) {
          discovered.set(owner, { wallet: owner, source: 'fomo_token', discoveredAt: Date.now() });
        }
      }

      markFomoMintExpanded(mint);
      console.log(`[fomo-token] ${short(mint)}: ${owners.length} holders`);
    } catch (err) {
      console.warn(
        `[fomo-token] ${short(mint)} expansion failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return [...discovered.values()];
}
