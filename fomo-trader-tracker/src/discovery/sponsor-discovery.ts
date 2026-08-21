import { SolanaRpc } from '../chain/solana-rpc';
import { config } from '../config';
import { ParsedTransaction, TraderCandidate } from '../types';
import { isSharedInfra } from './known-programs';
import { short } from './router-discovery';

/**
 * Pulls trader wallets out of a gas sponsor's transaction history.
 *
 * A gasless trading app pays the network fee for its users, so the sponsor is
 * the fee payer while the user is a second signer on the same transaction. That
 * makes the sponsor's history a dense stream of app traders: one new wallet per
 * transaction, all of them currently trading. It is the highest-yield discovery
 * path in this tool, because fomo runs no on-chain router to walk instead.
 *
 * The sponsor is shared with other apps on the same aggregator, so this stage
 * only proposes candidates; the portfolio filter decides who is worth tracking.
 */
export async function discoverTradersFromSponsors(
  rpc: SolanaRpc,
  sponsorAccounts: string[]
): Promise<TraderCandidate[]> {
  if (sponsorAccounts.length === 0) {
    return [];
  }

  const sponsorSet = new Set(sponsorAccounts);
  const discovered = new Map<string, TraderCandidate>();

  for (const sponsor of sponsorAccounts) {
    let transactions: Map<string, ParsedTransaction>;
    try {
      const signatures = await rpc.getSignaturesPaged(
        sponsor,
        config.discovery.signaturesPerSponsorScan
      );
      const successful = signatures.filter((entry) => !entry.err).map((entry) => entry.signature);
      transactions = await rpc.getTransactions(successful);
    } catch (err) {
      console.warn(
        `[sponsor] ${short(sponsor)} failed:`,
        err instanceof Error ? err.message : String(err)
      );
      continue;
    }

    let found = 0;
    for (const tx of transactions.values()) {
      for (const wallet of sponsoredSigners(tx, sponsorSet)) {
        if (discovered.has(wallet)) {
          continue;
        }
        discovered.set(wallet, { wallet, source: 'sponsor', discoveredAt: Date.now() });
        found += 1;
        if (discovered.size >= config.discovery.maxCandidatesPerCycle) {
          console.log(`[sponsor] ${short(sponsor)}: ${found} traders (cycle cap reached)`);
          return [...discovered.values()];
        }
      }
    }

    console.log(
      `[sponsor] ${short(sponsor)}: ${transactions.size} transactions -> ${found} trader wallets`
    );
  }

  return [...discovered.values()];
}

/**
 * The sponsored user is a signer that is neither the fee payer nor shared
 * infrastructure. Signers are used rather than token balance owners because a
 * sponsored transaction names the user directly, while token balances also
 * include pool vaults on the other side of the swap.
 */
function sponsoredSigners(tx: ParsedTransaction, sponsorAccounts: Set<string>): string[] {
  const wallets: string[] = [];

  for (const key of tx.transaction.message.accountKeys) {
    if (!key.signer || sponsorAccounts.has(key.pubkey) || isSharedInfra(key.pubkey)) {
      continue;
    }
    wallets.push(key.pubkey);
  }

  return wallets;
}
