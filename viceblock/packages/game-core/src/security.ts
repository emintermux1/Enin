/**
 * Vehicle security tiers + skill-based lockpick minigame (pure logic).
 * Tier "none"  — door is open, instant steal.
 * Tier "lock"  — quick lockpick (wide sweet zone).
 * Tier "immobilizer" — hard lockpick (narrow zone, alarm on fail).
 * Tier "gps"   — hard lockpick AND the car reports itself: heat while driving it.
 */
export type SecurityTier = "none" | "lock" | "immobilizer" | "gps";

export interface LockpickState {
  /** Marker position 0..1, oscillating as a triangle wave. */
  pos: number;
  dir: 1 | -1;
  speed: number;
  zoneStart: number;
  zoneEnd: number;
  /** Attempts left before the pick snaps. */
  picksLeft: number;
  done: boolean;
  success: boolean;
  alarmed: boolean;
}

export function lockpickDifficulty(tier: SecurityTier): { speed: number; zone: number; picks: number } {
  switch (tier) {
    case "none":
      return { speed: 0, zone: 1, picks: 99 };
    case "lock":
      return { speed: 0.9, zone: 0.22, picks: 3 };
    case "immobilizer":
      return { speed: 1.35, zone: 0.13, picks: 2 };
    case "gps":
      return { speed: 1.6, zone: 0.11, picks: 2 };
    default: {
      const _never: never = tier;
      return _never;
    }
  }
}

export function createLockpick(tier: SecurityTier, seed = Math.random()): LockpickState {
  const d = lockpickDifficulty(tier);
  const zoneStart = 0.12 + seed * (0.88 - d.zone - 0.12);
  return {
    pos: 0,
    dir: 1,
    speed: d.speed,
    zoneStart,
    zoneEnd: zoneStart + d.zone,
    picksLeft: d.picks,
    done: false,
    success: false,
    alarmed: false,
  };
}

export function tickLockpick(s: LockpickState, dt: number): LockpickState {
  if (s.done) return s;
  let pos = s.pos + s.dir * s.speed * dt;
  let dir = s.dir;
  if (pos > 1) {
    pos = 2 - pos;
    dir = -1;
  } else if (pos < 0) {
    pos = -pos;
    dir = 1;
  }
  return { ...s, pos, dir };
}

export function attemptPick(s: LockpickState, alarmOnFail: boolean): LockpickState {
  if (s.done) return s;
  const inside = s.pos >= s.zoneStart && s.pos <= s.zoneEnd;
  if (inside) return { ...s, done: true, success: true };
  const picksLeft = s.picksLeft - 1;
  if (picksLeft <= 0) {
    return { ...s, picksLeft: 0, done: true, success: false, alarmed: alarmOnFail };
  }
  return { ...s, picksLeft };
}
