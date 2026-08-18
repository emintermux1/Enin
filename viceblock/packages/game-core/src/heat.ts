import type { HeatLevel } from "@viceblock/shared";

export interface HeatState {
  level: HeatLevel;
  seenTimer: number;
  hiddenTimer: number;
  reportTimer: number;
  lastKnownX: number;
  lastKnownY: number;
  hasLastKnown: boolean;
}

export function createHeatState(): HeatState {
  return {
    level: 0,
    seenTimer: 0,
    hiddenTimer: 0,
    reportTimer: 0,
    lastKnownX: 0,
    lastKnownY: 0,
    hasLastKnown: false,
  };
}

/** Easy-mode pursuit: cops forget fast, escalate slowly. */
export function tickHeat(
  state: HeatState,
  dt: number,
  seenByCop: boolean,
  playerX: number,
  playerY: number,
  crimeJustCommitted: number,
): HeatState {
  const next = { ...state };
  if (crimeJustCommitted > 0) {
    next.level = clampHeat(next.level + crimeJustCommitted);
    next.seenTimer = 2.4;
    next.hiddenTimer = 0;
    next.hasLastKnown = true;
    next.lastKnownX = playerX;
    next.lastKnownY = playerY;
  }

  if (seenByCop) {
    next.seenTimer += dt;
    next.hiddenTimer = 0;
    next.hasLastKnown = true;
    next.lastKnownX = playerX;
    next.lastKnownY = playerY;
    if (next.level >= 1 && next.seenTimer > 14 && next.level < 3) {
      next.level = clampHeat(next.level + 1);
      next.seenTimer = 0;
    }
  } else if (next.level > 0) {
    next.hiddenTimer += dt;
    next.seenTimer = 0;
    const loseAfter = next.level <= 2 ? 3.2 : next.level === 3 ? 5.5 : 8;
    if (next.hiddenTimer >= loseAfter) {
      next.level = clampHeat(next.level - 1);
      next.hiddenTimer = 0;
      if (next.level === 0) next.hasLastKnown = false;
    }
  }
  return next;
}

export function clampHeat(n: number): HeatLevel {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return v as HeatLevel;
}

export function copCountForHeat(level: HeatLevel): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    case 4:
      return 4;
    case 5:
      return 5;
    default: {
      const _never: never = level;
      return _never;
    }
  }
}

export function copSpeedForHeat(level: HeatLevel, onFoot: boolean): number {
  const foot = [0, 78, 86, 94, 102, 110][level] ?? 80;
  const car = [0, 145, 165, 185, 200, 215][level] ?? 150;
  return onFoot ? foot : car;
}

export function assistHint(level: HeatLevel, hiddenTimer: number, nearHide: boolean): string {
  if (level === 0) return "";
  if (nearHide) return "AI ASSIST  ·  duck into the alley / garage — they lose you faster";
  if (hiddenTimer > 1.2) return "AI ASSIST  ·  stay dark  ·  heat dropping";
  if (level <= 2) return "AI ASSIST  ·  break line of sight, then change cars";
  if (level === 3) return "AI ASSIST  ·  cut alleys, they hesitate at corners";
  return "AI ASSIST  ·  hide, swap clothes later  ·  do not fight the whole city";
}
