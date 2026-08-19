import { SolanaRpc } from '../chain/solana-rpc';
import { isMajor, isCashLike } from '../chain/token-registry';
import { ParsedTransaction, RouterCandidate } from '../types';
import { isSharedInfra } from './known-programs';

function readSignaturesPerSeed(): number {
  const raw = Number(process.env['SIGNATURES_PER_SEED']);
  return Number.isFinite(raw) && raw > 0 ? raw : 40;
}

/**
 * fomo sponsors gas and takes a fee on every trade, so each fomo trade touches
 * a small set of fomo-controlled accounts. Those accounts are the same for
 * every fomo user, while everything else in a swap differs per trade.
 *
 * Given a handful of known fomo wallets, the accounts common to all of them —
 * minus shared Solana infrastructure, mints and the wallets themselves — are
 * fomo's own router, gas sponsor and fee recipient.
 */
export async function deriveRouterAccounts(
  rpc: SolanaRpc,
  seedWallets: string[]
): Promise<RouterCandidate[]> {
  if (seedWallets.length === 0) {
    return [];
  }

  const seedSet = new Set(seedWallets);
  const occurrences = new Map<string, number>();
  const seedHits = new Map<string, Set<string>>();
  const signaturesPerSeed = readSignaturesPerSeed();

  for (const seed of seedWallets) {
    let transactions: Map<string, ParsedTransaction>;
    try {
      const signatures = await rpc.getSignaturesPaged(seed, signaturesPerSeed);
      const successful = signatures.filter((entry) => !entry.err).map((entry) => entry.signature);
      transactions = await rpc.getTransactions(successful);
    } catch (err) {
      console.warn(`[router] seed ${short(seed)} failed:`, err instanceof Error ? err.message : String(err));
      continue;
    }

    console.log(`[router] seed ${short(seed)}: inspected ${transactions.size} transactions`);

    for (const tx of transactions.values()) {
      for (const account of collectCandidateAccounts(tx, seedSet)) {
        occurrences.set(account, (occurrences.get(account) ?? 0) + 1);
        const hits = seedHits.get(account) ?? new Set<string>();
        hits.add(seed);
        seedHits.set(account, hits);
      }
    }
  }

  const candidates: RouterCandidate[] = [...occurrences.entries()].map(([account, totalOccurrences]) => ({
    account,
    seedHitCount: seedHits.get(account)?.size ?? 0,
    totalOccurrences,
  }));

  candidates.sort(
    (a, b) => b.seedHitCount - a.seedHitCount || b.totalOccurrences - a.totalOccurrences
  );

  return candidates;
}

/**
 * Accounts worth considering: programs invoked and writable accounts, excluding
 * mints, token accounts of the seed itself and shared infrastructure.
 */
function collectCandidateAccounts(tx: ParsedTransaction, seeds: Set<string>): Set<string> {
  const accounts = new Set<string>();
  const mints = new Set<string>();

  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    mints.add(balance.mint);
  }

  const programIds = new Set<string>();
  for (const instruction of tx.transaction.message.instructions) {
    if (instruction.programId) {
      programIds.add(instruction.programId);
    }
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      if (instruction.programId) {
        programIds.add(instruction.programId);
      }
    }
  }

  for (const key of tx.transaction.message.accountKeys) {
    if (!key.signer && !programIds.has(key.pubkey)) {
      continue;
    }
    accounts.add(key.pubkey);
  }
  for (const programId of programIds) {
    accounts.add(programId);
  }

  const filtered = new Set<string>();
  for (const account of accounts) {
    if (seeds.has(account) || mints.has(account)) {
      continue;
    }
    if (isSharedInfra(account) || isMajor(account) || isCashLike(account)) {
      continue;
    }
    filtered.add(account);
  }

  return filtered;
}

export function short(address: string): string {
  return `${address.slice(0, 4)}..${address.slice(-4)}`;
}
