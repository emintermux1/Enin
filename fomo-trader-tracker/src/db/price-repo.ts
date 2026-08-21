import { getDb } from './database';
import { TokenPrice } from '../types';

const PRICE_TTL_MS = 5 * 60_000;
/**
 * Most token accounts in an active memecoin wallet are worthless airdrop spam
 * that no price source covers. Remembering those misses for a week keeps the
 * price API out of the hot path on later scans.
 */
const UNPRICED_TTL_MS = 7 * 24 * 3600_000;

interface PriceRow {
  mint: string;
  usd_price: number;
  decimals: number;
  liquidity: number;
  price_change_24h: number;
}

/** Active memecoin wallets can hold thousands of mints, well past SQLite's bound-parameter limit. */
const SQL_CHUNK_SIZE = 400;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function readCachedPrices(mints: string[]): {
  prices: Map<string, TokenPrice>;
  unpriced: Set<string>;
} {
  const prices = new Map<string, TokenPrice>();
  const unpriced = new Set<string>();

  if (mints.length === 0) {
    return { prices, unpriced };
  }

  const db = getDb();
  const now = Date.now();

  for (const group of chunk(mints, SQL_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');

    const priceRows = db
      .prepare(
        `SELECT mint, usd_price, decimals, liquidity, price_change_24h
         FROM mint_prices
         WHERE mint IN (${placeholders}) AND updated_at > ?`
      )
      .all(...group, now - PRICE_TTL_MS) as PriceRow[];

    for (const row of priceRows) {
      prices.set(row.mint, {
        mint: row.mint,
        usdPrice: row.usd_price,
        decimals: row.decimals,
        liquidity: row.liquidity,
        priceChange24h: row.price_change_24h,
      });
    }

    const unpricedRows = db
      .prepare(`SELECT mint FROM mint_unpriced WHERE mint IN (${placeholders}) AND checked_at > ?`)
      .all(...group, now - UNPRICED_TTL_MS) as Array<{ mint: string }>;

    for (const row of unpricedRows) {
      unpriced.add(row.mint);
    }
  }

  return { prices, unpriced };
}

export function writePrices(prices: TokenPrice[]): void {
  if (prices.length === 0) {
    return;
  }
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO mint_prices (mint, usd_price, decimals, liquidity, price_change_24h, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(mint) DO UPDATE SET
       usd_price = excluded.usd_price,
       decimals = excluded.decimals,
       liquidity = excluded.liquidity,
       price_change_24h = excluded.price_change_24h,
       updated_at = excluded.updated_at`
  );

  const run = db.transaction((rows: TokenPrice[]) => {
    for (const row of rows) {
      statement.run(row.mint, row.usdPrice, row.decimals, row.liquidity, row.priceChange24h, Date.now());
    }
  });
  run(prices);
}

export function writeUnpriced(mints: string[]): void {
  if (mints.length === 0) {
    return;
  }
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO mint_unpriced (mint, checked_at)
     VALUES (?, ?)
     ON CONFLICT(mint) DO UPDATE SET checked_at = excluded.checked_at`
  );

  const run = db.transaction((rows: string[]) => {
    for (const mint of rows) {
      statement.run(mint, Date.now());
    }
  });
  run(mints);
}
