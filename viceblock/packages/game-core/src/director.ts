/**
 * World event director: keeps Nova City unpredictable without repeating
 * itself. Weighted picks, anti-repetition history, some events rare.
 */
export type WorldEventId = "armored-truck" | "rare-car" | "blackout" | "storm" | "police-crackdown" | "street-race";

export interface WorldEventDef {
  id: WorldEventId;
  weight: number;
  /** Seconds the event stays active. */
  duration: number;
  headline: string;
}

export const WORLD_EVENTS: WorldEventDef[] = [
  { id: "armored-truck", weight: 24, duration: 120, headline: "Armored truck spotted rolling through Southside." },
  { id: "rare-car", weight: 16, duration: 180, headline: "Word on the street: a rare Mirage was left unattended." },
  { id: "blackout", weight: 6, duration: 45, headline: "CITY BLACKOUT — Southside grid is down." },
  { id: "storm", weight: 14, duration: 90, headline: "Storm front over Nova City — roads are slick." },
  { id: "police-crackdown", weight: 12, duration: 75, headline: "NCPD announces a Southside crackdown. Patrols doubled." },
  { id: "street-race", weight: 20, duration: 120, headline: "Illegal street race forming. Checkpoint course active." },
];

export interface DirectorState {
  /** Recent event ids, newest last. */
  history: WorldEventId[];
  cooldown: number;
  active: WorldEventId | null;
  activeLeft: number;
}

export function createDirector(): DirectorState {
  return { history: [], cooldown: 45, active: null, activeLeft: 0 };
}

/** Events fired within the last `historyBlock` picks cannot repeat. */
const HISTORY_BLOCK = 3;

export function pickEvent(history: WorldEventId[], roll: number): WorldEventDef | null {
  const blocked = new Set(history.slice(-HISTORY_BLOCK));
  const pool = WORLD_EVENTS.filter((e) => !blocked.has(e.id));
  if (pool.length === 0) return null;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let target = roll * total;
  for (const e of pool) {
    target -= e.weight;
    if (target <= 0) return e;
  }
  return pool[pool.length - 1];
}

export function tickDirector(state: DirectorState, dt: number, roll = Math.random()): { state: DirectorState; fired: WorldEventDef | null } {
  const next = { ...state, history: [...state.history] };
  if (next.active) {
    next.activeLeft -= dt;
    if (next.activeLeft <= 0) {
      next.active = null;
      next.activeLeft = 0;
      next.cooldown = 60 + roll * 90;
    }
    return { state: next, fired: null };
  }
  next.cooldown -= dt;
  if (next.cooldown > 0) return { state: next, fired: null };
  const event = pickEvent(next.history, roll);
  if (!event) {
    next.cooldown = 30;
    return { state: next, fired: null };
  }
  next.active = event.id;
  next.activeLeft = event.duration;
  next.history.push(event.id);
  if (next.history.length > 12) next.history.shift();
  return { state: next, fired: event };
}
