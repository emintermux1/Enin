import { LRUCache } from 'lru-cache';

export class DedupCache {
  private readonly cache = new LRUCache<string, true>({
    max: 10_000,
    ttl: 1000 * 60 * 60 * 24,
  });

  has(transactionHash: string): boolean {
    return this.cache.has(transactionHash.toLowerCase());
  }

  add(transactionHash: string): void {
    this.cache.set(transactionHash.toLowerCase(), true);
  }

  addIfNew(transactionHash: string): boolean {
    const key = transactionHash.toLowerCase();
    if (this.cache.has(key)) {
      return false;
    }
    this.cache.set(key, true);
    return true;
  }
}
