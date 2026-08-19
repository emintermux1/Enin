import { rpc } from '../chain/solana-rpc';
import { config } from '../config';
import { getDb } from '../db/database';
import { saveRouterAccounts } from '../db/trader-repo';
import { deriveRouterAccounts } from '../discovery/router-discovery';

/**
 * Prints the accounts that recur across the supplied fomo wallets. The ones
 * hit by every seed are fomo's router, gas sponsor and fee recipient; put them
 * in FOMO_ROUTER_ACCOUNTS to enumerate the whole trader population from them.
 */
async function main(): Promise<void> {
  const seeds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : config.discovery.seedWallets;

  if (seeds.length === 0) {
    console.error(
      'Usage: npm run discover-router -- <fomoWallet1> <fomoWallet2> [...]\n' +
        'Or set FOMO_SEED_WALLETS in .env. Two or more wallets give a far cleaner result.'
    );
    process.exit(1);
  }

  getDb();
  console.log(`Deriving fomo accounts from ${seeds.length} seed wallet(s)\n`);

  const candidates = await deriveRouterAccounts(rpc, seeds);
  if (candidates.length === 0) {
    console.log('No candidate accounts found. Are these wallets active on fomo?');
    return;
  }

  saveRouterAccounts(candidates);

  const shown = candidates.slice(0, 25);
  console.log(`\n${'account'.padEnd(46)} seeds  hits`);
  for (const candidate of shown) {
    console.log(
      `${candidate.account.padEnd(46)} ${String(candidate.seedHitCount).padStart(5)}  ${String(
        candidate.totalOccurrences
      ).padStart(4)}`
    );
  }

  const confident = candidates.filter((candidate) => candidate.seedHitCount === seeds.length);
  if (confident.length > 0) {
    console.log(
      `\nPresent in all ${seeds.length} seeds — these are the fomo-specific accounts:\n` +
        `FOMO_ROUTER_ACCOUNTS=${confident.slice(0, 5).map((entry) => entry.account).join(',')}`
    );
  } else {
    console.log('\nNo account was present in every seed. Try more seed wallets or a wider scan.');
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
