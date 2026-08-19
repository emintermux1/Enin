import { SolanaRpc } from '../chain/solana-rpc';
import { config } from '../config';
import { ParsedTransaction, TraderCandidate } from '../types';
import { isSharedInfra } from './known-programs';
import { short } from './router-discovery';

/**
 * Walks the transaction history of fomo's own accounts and pulls out the
 * wallets on the other side of each trade. Those wallets are the fomo trader
 * population, which the filter stage then narrows down.
 */
export async function discoverTraders(
  rpc: SolanaRpc,
  routerAccounts: string[]
): Promise<TraderCandidate[]> {
  if (routerAccounts.length === 0) {
    return [];
  }

  const routerSet = new Set(routerAccounts);
  const discovered = new Map<string, TraderCandidate>();

  for (const router of routerAccounts) {
    let transactions: Map<string, ParsedTransaction>;
    try {
      const signatures = await rpc.getSignaturesPaged(router, config.discovery.signaturesPerRouterScan);
      const successful = signatures.filter((entry) => !entry.err).map((entry) => entry.signature);
      transactions = await rpc.getTransactions(successful);
    } catch (err) {
      console.warn(`[discovery] router ${short(router)} failed:`, err instanceof Error ? err.message : String(err));
      continue;
    }

    console.log(
      `[discovery] router ${short(router)}: ${transactions.size} transactions -> extracting traders`
    );

    for (const tx of transactions.values()) {
      for (const wallet of extractTraderWallets(tx, routerSet)) {
        if (discovered.has(wallet)) {
          continue;
        }
        discovered.set(wallet, { wallet, source: 'router', discoveredAt: Date.now() });
        if (discovered.size >= config.discovery.maxCandidatesPerCycle) {
          return [...discovered.values()];
        }
      }
    }
  }

  return [...discovered.values()];
}

/**
 * A trader is the owner of the token accounts that changed hands. Using token
 * balance owners rather than the fee payer matters here because fomo sponsors
 * gas, so the fee payer is usually fomo itself, not the trader.
 */
function extractTraderWallets(tx: ParsedTransaction, routerAccounts: Set<string>): string[] {
  const owners = new Set<string>();

  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    const owner = balance.owner;
    if (!owner) {
      continue;
    }
    if (routerAccounts.has(owner) || isSharedInfra(owner)) {
      continue;
    }
    owners.add(owner);
  }

  // Fall back to signers when a transaction carries no token balance data.
  if (owners.size === 0) {
    for (const key of tx.transaction.message.accountKeys) {
      if (key.signer && !routerAccounts.has(key.pubkey) && !isSharedInfra(key.pubkey)) {
        owners.add(key.pubkey);
      }
    }
  }

  return [...owners];
}
