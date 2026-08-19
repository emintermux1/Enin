import axios, { AxiosInstance } from 'axios';
import { readCachedPrices, writePrices, writeUnpriced } from '../db/price-repo';
import { TokenPrice } from '../types';

const PRICE_API = 'https://lite-api.jup.ag/price/v3';
const MAX_IDS_PER_REQUEST = 50;
const MAX_RETRIES = 3;

interface JupiterPriceEntry {
  usdPrice?: number;
  decimals?: number;
  liquidity?: number;
  priceChange24h?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Jupiter is the pricing source because it covers freshly launched memecoins
 * that majors-oriented feeds omit. The free endpoint allows roughly one request
 * per second, so batches are spaced and backed off rather than fired in bursts.
 */
export class JupiterPrice {
  private readonly http: AxiosInstance;
  private readonly spacingMs: number;
  private readonly maxMintsPerWallet: number;
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private throttleWarned = false;

  constructor() {
    this.http = axios.create({ timeout: 20_000 });
    this.spacingMs = readNumberEnv('PRICE_MIN_SPACING_MS', 1_500);
    this.maxMintsPerWallet = readNumberEnv('MAX_MINTS_PRICED_PER_WALLET', 400);
  }

  /**
   * `skipped` reports mints left unresolved because the per-call cap was hit.
   * Callers use it to avoid judging a wallet on partial pricing; the misses are
   * cached, so a later pass covers the remainder.
   */
  async getPrices(mints: string[]): Promise<{ prices: Map<string, TokenPrice>; skipped: number }> {
    const unique = [...new Set(mints)];
    const { prices, unpriced } = readCachedPrices(unique);

    const pending = unique.filter((mint) => !prices.has(mint) && !unpriced.has(mint));
    const toFetch = pending.slice(0, this.maxMintsPerWallet);
    const skipped = pending.length - toFetch.length;

    if (skipped > 0) {
      console.warn(
        `[price] ${pending.length} uncached mints, pricing first ${toFetch.length} ` +
          `(raise MAX_MINTS_PRICED_PER_WALLET to cover more)`
      );
    }

    const fetchedPrices: TokenPrice[] = [];
    const misses: string[] = [];

    for (let i = 0; i < toFetch.length; i += MAX_IDS_PER_REQUEST) {
      const batch = toFetch.slice(i, i + MAX_IDS_PER_REQUEST);
      const found = await this.fetchBatch(batch);

      for (const mint of batch) {
        const price = found.get(mint);
        if (price) {
          fetchedPrices.push(price);
          prices.set(mint, price);
        } else {
          misses.push(mint);
        }
      }
    }

    writePrices(fetchedPrices);
    writeUnpriced(misses);

    return { prices, skipped };
  }

  private async fetchBatch(mints: string[]): Promise<Map<string, TokenPrice>> {
    const found = new Map<string, TokenPrice>();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.waitForSlot();

      try {
        const response = await this.http.get<Record<string, JupiterPriceEntry>>(PRICE_API, {
          params: { ids: mints.join(',') },
        });

        for (const [mint, entry] of Object.entries(response.data ?? {})) {
          if (typeof entry?.usdPrice !== 'number') {
            continue;
          }
          found.set(mint, {
            mint,
            usdPrice: entry.usdPrice,
            decimals: entry.decimals ?? 0,
            liquidity: entry.liquidity ?? 0,
            priceChange24h: entry.priceChange24h ?? 0,
          });
        }
        return found;
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const isRateLimit = status === 429;

        if (isRateLimit && !this.throttleWarned) {
          console.warn('[price] rate limited by Jupiter, backing off (set PRICE_MIN_SPACING_MS higher)');
          this.throttleWarned = true;
        }

        if (attempt === MAX_RETRIES) {
          console.warn(`[price] batch of ${mints.length} failed: ${status ?? 'network'}`);
          return found;
        }

        await sleep(isRateLimit ? 2_000 * 2 ** attempt : 500 * 2 ** attempt);
      }
    }

    return found;
  }

  /**
   * Reserves the next request slot. Callers are chained through a queue rather
   * than each comparing against `lastRequestAt`, because wallets are screened in
   * parallel and concurrent readers of a shared timestamp would all consider the
   * same slot free and fire together, which is what triggers the 429s.
   */
  private waitForSlot(): Promise<void> {
    const reserved = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.spacingMs - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastRequestAt = Date.now();
    });
    this.queue = reserved.catch(() => undefined);
    return reserved;
  }
}

export const jupiterPrice = new JupiterPrice();
