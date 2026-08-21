/**
 * Shared Solana infrastructure that appears in almost every swap. These are
 * filtered out when looking for fomo-specific accounts, otherwise Jupiter and
 * the AMMs would dominate the ranking.
 */
export const SHARED_INFRA_ACCOUNTS = new Set<string>([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'AddressLookupTab1e1111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'Vote111111111111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  // Seen in the swaps of a known fomo wallet. fomo routes through these rather
  // than a program of its own, so none of them identify fomo.
  'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH',
  '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
  'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
  'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi',
  'DeJBGdMFa1uynnnKiwrVioatTuHmNLpyFKnmB5kaFdzQ',
]);

export function isSharedInfra(account: string): boolean {
  return SHARED_INFRA_ACCOUNTS.has(account) || account.startsWith('Sysvar');
}
