import { getDb } from './database';

export function recordFomoMints(mints: string[]): number {
  if (mints.length === 0) {
    return 0;
  }
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO fomo_mints (mint, discovered_at) VALUES (?, ?) ON CONFLICT(mint) DO NOTHING`
  );

  let inserted = 0;
  const run = db.transaction((rows: string[]) => {
    for (const mint of rows) {
      inserted += statement.run(mint, Date.now()).changes;
    }
  });
  run(mints);

  return inserted;
}

export function getUnexpandedFomoMints(limit: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT mint FROM fomo_mints WHERE expanded_at IS NULL ORDER BY discovered_at ASC LIMIT ?`
    )
    .all(limit) as Array<{ mint: string }>;

  return rows.map((row) => row.mint);
}

export function markFomoMintExpanded(mint: string): void {
  getDb().prepare(`UPDATE fomo_mints SET expanded_at = ? WHERE mint = ?`).run(Date.now(), mint);
}

export function countFomoMints(): { total: number; pending: number } {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM fomo_mints`).get() as { n: number };
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM fomo_mints WHERE expanded_at IS NULL`).get() as {
    n: number;
  };
  return { total: total.n, pending: pending.n };
}
