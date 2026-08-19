import { config } from '../config';
import { TokenClass, TokenPrice } from '../types';
import { WRAPPED_SOL_MINT } from './solana-rpc';

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const STABLE_MINTS = new Set<string>([
  USDC_MINT,
  USDT_MINT,
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
]);

/**
 * Liquid non-memecoin assets. A wallet holding only these is a saver rather
 * than the active memecoin trader we want, so they are excluded from the
 * memecoin count while still counting toward portfolio value.
 *
 * Deliberately excludes BONK, WIF and similar: those are memecoins for our
 * purposes. Extend with MAJOR_MINTS_EXTRA when a token should not count.
 */
const MAJOR_MINTS = new Set<string>([
  WRAPPED_SOL_MINT,
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
]);

for (const mint of splitEnvList('STABLE_MINTS_EXTRA')) {
  STABLE_MINTS.add(mint);
}
for (const mint of splitEnvList('MAJOR_MINTS_EXTRA')) {
  MAJOR_MINTS.add(mint);
}

function splitEnvList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) {
    return [];
  }
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

/**
 * `positionFloorUsd` separates a real memecoin position from the long tail of
 * airdrop spam and sell leftovers that active wallets accumulate. Without it a
 * wallet with 6 real positions and 200 dust entries never matches a "5-10
 * memecoins" filter.
 */
export function classifyToken(
  mint: string,
  usdValue: number,
  price: TokenPrice | undefined,
  positionFloorUsd: number
): TokenClass {
  if (STABLE_MINTS.has(mint)) {
    return 'stable';
  }
  if (MAJOR_MINTS.has(mint)) {
    return 'major';
  }
  if (!price) {
    return 'unpriced';
  }
  if (usdValue < positionFloorUsd) {
    return 'dust';
  }
  return 'memecoin';
}

/** Scales the floor with portfolio size so it works for $3K and $300K wallets alike. */
export function positionFloorFor(totalUsdValue: number): number {
  return Math.max(config.filter.dustThresholdUsd, totalUsdValue * config.filter.minPositionShare);
}

export function isCashLike(mint: string): boolean {
  return STABLE_MINTS.has(mint);
}

export function isMajor(mint: string): boolean {
  return MAJOR_MINTS.has(mint);
}
