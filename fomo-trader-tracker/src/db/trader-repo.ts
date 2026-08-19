import { getDb } from './database';
import { DetectedTrade, QualifiedTrader, RouterCandidate, TraderCandidate, TraderSource } from '../types';

interface TraderRow {
  wallet: string;
  source: string;
  portfolio_usd: number;
  cash_usd: number;
  memecoin_usd: number;
  memecoin_count: number;
  trade_count: number;
  last_trade_at: number | null;
  score: number;
  qualified_at: number;
}

interface CandidateRow {
  wallet: string;
  source: string;
  discovered_at: number;
}

function toSource(raw: string): TraderSource {
  switch (raw) {
    case 'router':
    case 'seed':
    case 'manual':
    case 'fomo_token':
      return raw;
    default:
      return 'router';
  }
}

export function upsertCandidates(candidates: TraderCandidate[]): number {
  if (candidates.length === 0) {
    return 0;
  }
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO candidates (wallet, source, discovered_at)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet) DO NOTHING`
  );

  let inserted = 0;
  const run = db.transaction((rows: TraderCandidate[]) => {
    for (const row of rows) {
      inserted += statement.run(row.wallet, row.source, row.discoveredAt).changes;
    }
  });
  run(candidates);

  return inserted;
}

export function getCandidatesToCheck(limit: number, staleBeforeMs: number): TraderCandidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT wallet, source, discovered_at
       FROM candidates
       WHERE last_checked_at IS NULL OR last_checked_at < ?
       ORDER BY last_checked_at IS NOT NULL, discovered_at ASC
       LIMIT ?`
    )
    .all(staleBeforeMs, limit) as CandidateRow[];

  return rows.map((row) => ({
    wallet: row.wallet,
    source: toSource(row.source),
    discoveredAt: row.discovered_at,
  }));
}

export function markCandidateChecked(wallet: string, rejectReason: string | null): void {
  getDb()
    .prepare(`UPDATE candidates SET last_checked_at = ?, last_reject_reason = ? WHERE wallet = ?`)
    .run(Date.now(), rejectReason, wallet);
}

export function upsertTrader(trader: QualifiedTrader): boolean {
  const db = getDb();
  const existing = db.prepare(`SELECT wallet FROM traders WHERE wallet = ?`).get(trader.wallet);

  db.prepare(
    `INSERT INTO traders (
       wallet, source, portfolio_usd, cash_usd, memecoin_usd, memecoin_count,
       trade_count, last_trade_at, score, qualified_at, updated_at, active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(wallet) DO UPDATE SET
       portfolio_usd = excluded.portfolio_usd,
       cash_usd = excluded.cash_usd,
       memecoin_usd = excluded.memecoin_usd,
       memecoin_count = excluded.memecoin_count,
       trade_count = excluded.trade_count,
       last_trade_at = excluded.last_trade_at,
       score = excluded.score,
       updated_at = excluded.updated_at,
       active = 1`
  ).run(
    trader.wallet,
    trader.source,
    trader.portfolioUsd,
    trader.cashUsd,
    trader.memecoinUsd,
    trader.memecoinCount,
    trader.tradeCount,
    trader.lastTradeAt,
    trader.score,
    trader.qualifiedAt,
    Date.now()
  );

  return !existing;
}

export function deactivateTrader(wallet: string): void {
  getDb().prepare(`UPDATE traders SET active = 0, updated_at = ? WHERE wallet = ?`).run(Date.now(), wallet);
}

export function getWatchlist(limit: number): QualifiedTrader[] {
  const rows = getDb()
    .prepare(
      `SELECT wallet, source, portfolio_usd, cash_usd, memecoin_usd, memecoin_count,
              trade_count, last_trade_at, score, qualified_at
       FROM traders
       WHERE active = 1
       ORDER BY score DESC
       LIMIT ?`
    )
    .all(limit) as TraderRow[];

  return rows.map((row) => ({
    wallet: row.wallet,
    source: toSource(row.source),
    portfolioUsd: row.portfolio_usd,
    cashUsd: row.cash_usd,
    memecoinUsd: row.memecoin_usd,
    memecoinCount: row.memecoin_count,
    tradeCount: row.trade_count,
    lastTradeAt: row.last_trade_at,
    score: row.score,
    qualifiedAt: row.qualified_at,
  }));
}

export function countTraders(): { active: number; candidates: number } {
  const db = getDb();
  const active = db.prepare(`SELECT COUNT(*) AS n FROM traders WHERE active = 1`).get() as { n: number };
  const candidates = db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get() as { n: number };
  return { active: active.n, candidates: candidates.n };
}

export function saveRouterAccounts(candidates: RouterCandidate[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO router_accounts (account, seed_hit_count, total_occurrences, derived_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account) DO UPDATE SET
       seed_hit_count = excluded.seed_hit_count,
       total_occurrences = excluded.total_occurrences,
       derived_at = excluded.derived_at`
  );

  const run = db.transaction((rows: RouterCandidate[]) => {
    for (const row of rows) {
      statement.run(row.account, row.seedHitCount, row.totalOccurrences, Date.now());
    }
  });
  run(candidates);
}

/** Returns true when the signature had not been recorded for this wallet yet. */
export function markSignatureSeen(wallet: string, signature: string): boolean {
  const changes = getDb()
    .prepare(
      `INSERT INTO seen_signatures (signature, wallet, seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(signature) DO NOTHING`
    )
    .run(signature, wallet, Date.now()).changes;

  return changes > 0;
}

export function recordTrade(trade: DetectedTrade): void {
  getDb()
    .prepare(
      `INSERT INTO trades (signature, wallet, mint, side, ui_amount, usd_value, block_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(signature, wallet, mint, side) DO NOTHING`
    )
    .run(
      trade.signature,
      trade.wallet,
      trade.mint,
      trade.side,
      trade.uiAmount,
      trade.usdValue,
      trade.blockTime
    );
}
