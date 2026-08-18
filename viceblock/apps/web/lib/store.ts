import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, STARTER_CASH, type PlayerSave, type PresencePlayer, type WalletNonce } from "@viceblock/shared";

export interface AuditEntry {
  ts: number;
  playerId: string;
  kind: string;
  amount: number;
  reason: string;
  ref: string;
}

interface ActiveContract {
  id: string;
  seed: number;
  reward: number;
  xp: number;
  rep: number;
  issuedAt: number;
}

interface Db {
  players: Record<string, PlayerSave>;
  sessions: Record<string, { playerId: string; createdAt: number }>;
  nonces: Record<string, WalletNonce>;
  presence: Record<string, PresencePlayer>;
  claimed: Record<string, string[]>;
  contracts: Record<string, ActiveContract>;
  contractsDone: Record<string, string[]>;
  audit: AuditEntry[];
}

const dir = join(process.cwd(), "../../data");
const file = join(dir, "viceblock.json");

function empty(): Db {
  return { players: {}, sessions: {}, nonces: {}, presence: {}, claimed: {}, contracts: {}, contractsDone: {}, audit: [] };
}

let mem: Db | null = null;

/** Drops the in-memory cache so tests can simulate a server restart. */
export function resetStoreForTests(): void {
  mem = null;
}

function load(): Db {
  if (mem) return mem;
  try {
    if (existsSync(file)) mem = JSON.parse(readFileSync(file, "utf8")) as Db;
  } catch {
    mem = empty();
  }
  mem ??= empty();
  // Older data files predate the contract/audit fields.
  mem.contracts ??= {};
  mem.contractsDone ??= {};
  mem.audit ??= [];
  return mem;
}

function persist(): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(mem ?? empty()));
  } catch {
    /* file store is best-effort in serverless */
  }
}

export function createGuest(username: string): { token: string; player: PlayerSave } {
  const db = load();
  const id = `guest-${randomBytes(8).toString("hex")}`;
  const player: PlayerSave = {
    id,
    username,
    guest: true,
    cash: STARTER_CASH,
    bank: 0,
    xp: 0,
    level: 1,
    streetRep: 0,
    heat: 0,
    health: 100,
    armor: 0,
    x: 16 * 32 + 16,
    y: 63 * 32 + 8,
    heading: 0,
    inventory: [],
    ownedVehicleIds: [],
    apartmentId: "apartment",
    missionsCompleted: [],
    activeMissionId: "fresh-off-the-bus",
    collectibles: [],
    achievements: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: Date.now(),
  };
  db.players[id] = player;
  const token = randomBytes(24).toString("hex");
  db.sessions[token] = { playerId: id, createdAt: Date.now() };
  persist();
  return { token, player };
}

export function sessionPlayer(token: string): PlayerSave | null {
  const db = load();
  const s = db.sessions[token];
  if (!s) return null;
  return db.players[s.playerId] ?? null;
}

export function putSave(token: string, patch: Partial<PlayerSave>): PlayerSave | null {
  const db = load();
  const s = db.sessions[token];
  if (!s) return null;
  const cur = db.players[s.playerId];
  if (!cur) return null;
  const next: PlayerSave = {
    ...cur,
    ...patch,
    id: cur.id,
    cash: cur.cash,
    xp: cur.xp,
    streetRep: cur.streetRep,
    missionsCompleted: cur.missionsCompleted,
    updatedAt: Date.now(),
  };
  db.players[s.playerId] = next;
  persist();
  return next;
}

export function issueNonce(address: string): WalletNonce {
  const db = load();
  const nonce = `VICEBLOCK login ${randomBytes(16).toString("hex")}`;
  const rec: WalletNonce = { address, nonce, expiresAt: Date.now() + 120_000, used: false };
  db.nonces[address] = rec;
  persist();
  return rec;
}

export function consumeNonce(address: string, expected: string): boolean {
  const db = load();
  const rec = db.nonces[address];
  if (!rec || rec.used) return false;
  if (rec.nonce !== expected) return false;
  if (rec.expiresAt < Date.now()) return false;
  rec.used = true;
  persist();
  return true;
}

export function bindWallet(token: string, address: string): PlayerSave | null {
  const db = load();
  const s = db.sessions[token];
  if (!s) return null;
  const cur = db.players[s.playerId];
  if (!cur) return null;
  cur.wallet = address;
  cur.guest = false;
  persist();
  return cur;
}

export function touchPresence(token: string, p: Omit<PresencePlayer, "id" | "updatedAt">): PresencePlayer[] {
  const db = load();
  const s = db.sessions[token];
  if (!s) return [];
  db.presence[s.playerId] = { ...p, id: s.playerId, updatedAt: Date.now() };
  const now = Date.now();
  return Object.values(db.presence).filter((x) => now - x.updatedAt < 8000);
}

export function claimServerMission(playerId: string, missionId: string): boolean {
  const db = load();
  const have = db.claimed[playerId] ?? [];
  if (have.includes(missionId)) return false;
  db.claimed[playerId] = [...have, missionId];
  const player = db.players[playerId];
  if (player && !player.missionsCompleted.includes(missionId)) {
    player.missionsCompleted = [...player.missionsCompleted, missionId];
  }
  persist();
  return true;
}

export function applyAuthoritativeReward(
  playerId: string,
  cash: number,
  xp: number,
  streetRep: number,
  reason = "mission",
  ref = "",
): PlayerSave | null {
  const db = load();
  const p = db.players[playerId];
  if (!p) return null;
  const amount = Math.max(0, Math.floor(cash));
  p.cash += amount;
  p.xp += Math.max(0, Math.floor(xp));
  p.streetRep += Math.max(0, Math.floor(streetRep));
  db.audit.push({ ts: Date.now(), playerId, kind: "reward", amount, reason, ref });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
  persist();
  return p;
}

/**
 * Issues (or returns the still-active) contract for a player. One active
 * contract at a time; the server owns the seed so rewards can't be forged.
 */
export function issueContract(playerId: string): ActiveContract | null {
  const db = load();
  if (!db.players[playerId]) return null;
  const existing = db.contracts[playerId];
  if (existing && Date.now() - existing.issuedAt < 15 * 60_000) return existing;
  const seed = Math.random();
  const c: ActiveContract = {
    id: `ct-${Math.floor(seed * 1e9).toString(36)}`,
    seed,
    reward: 0,
    xp: 0,
    rep: 0,
    issuedAt: Date.now(),
  };
  db.contracts[playerId] = c;
  persist();
  return c;
}

/**
 * Completes the player's active contract exactly once. The contract id acts
 * as the idempotency key: replays and double-submits return false.
 */
export function completeContract(playerId: string, contractId: string, reward: number, xp: number, rep: number): boolean {
  const db = load();
  const active = db.contracts[playerId];
  if (!active || active.id !== contractId) return false;
  const done = db.contractsDone[playerId] ?? [];
  if (done.includes(contractId)) return false;
  db.contractsDone[playerId] = [...done, contractId];
  delete db.contracts[playerId];
  persist();
  applyAuthoritativeReward(playerId, reward, xp, rep, "contract", contractId);
  return true;
}

export function activeContractSeed(playerId: string): { id: string; seed: number } | null {
  const db = load();
  const c = db.contracts[playerId];
  return c ? { id: c.id, seed: c.seed } : null;
}

export function auditTail(limit = 50): AuditEntry[] {
  const db = load();
  return db.audit.slice(-limit);
}

export function adminSnapshot(): { players: number; sessions: number; cash: number; auditEntries: number } {
  const db = load();
  const players = Object.values(db.players);
  return {
    players: players.length,
    sessions: Object.keys(db.sessions).length,
    cash: players.reduce((s, p) => s + p.cash, 0),
    auditEntries: db.audit.length,
  };
}
