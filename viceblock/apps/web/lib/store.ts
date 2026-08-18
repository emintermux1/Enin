import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, STARTER_CASH, type PlayerSave, type PresencePlayer, type WalletNonce } from "@viceblock/shared";

interface Db {
  players: Record<string, PlayerSave>;
  sessions: Record<string, { playerId: string; createdAt: number }>;
  nonces: Record<string, WalletNonce>;
  presence: Record<string, PresencePlayer>;
  claimed: Record<string, string[]>;
}

const dir = join(process.cwd(), "../../data");
const file = join(dir, "viceblock.json");

function empty(): Db {
  return { players: {}, sessions: {}, nonces: {}, presence: {}, claimed: {} };
}

let mem: Db | null = null;

function load(): Db {
  if (mem) return mem;
  try {
    if (existsSync(file)) mem = JSON.parse(readFileSync(file, "utf8")) as Db;
  } catch {
    mem = empty();
  }
  mem ??= empty();
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

export function applyAuthoritativeReward(playerId: string, cash: number, xp: number, streetRep: number): PlayerSave | null {
  const db = load();
  const p = db.players[playerId];
  if (!p) return null;
  p.cash += Math.max(0, Math.floor(cash));
  p.xp += Math.max(0, Math.floor(xp));
  p.streetRep += Math.max(0, Math.floor(streetRep));
  persist();
  return p;
}

export function adminSnapshot(): { players: number; sessions: number; cash: number } {
  const db = load();
  const players = Object.values(db.players);
  return {
    players: players.length,
    sessions: Object.keys(db.sessions).length,
    cash: players.reduce((s, p) => s + p.cash, 0),
  };
}
