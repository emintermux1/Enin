import type { HeatLevel } from "@viceblock/shared";
import { POLICE_CONFIG } from "./config";

export interface HeatState {
  level: HeatLevel;
  seenTimer: number;
  hiddenTimer: number;
  lastKnownX: number;
  lastKnownY: number;
  hasLastKnown: boolean;
  /**
   * Suspect description: what the police believe the player is driving
   * (vehicle def id, or "" when the suspect was last seen on foot).
   * Switching rides shrinks recognition range until re-spotted up close.
   */
  knownVehicle: string;
  /** Radius of the active search zone around lastKnown (world units). */
  searchRadius: number;
}

export function createHeatState(): HeatState {
  return {
    level: 0,
    seenTimer: 0,
    hiddenTimer: 0,
    lastKnownX: 0,
    lastKnownY: 0,
    hasLastKnown: false,
    knownVehicle: "",
    searchRadius: 0,
  };
}

/**
 * Cop sight range against the player. If the player's current transport does
 * not match the suspect description, cops need to get much closer to make
 * the ID — switching cars is a real escape tool.
 */
export function recognitionRange(state: HeatState, currentVehicle: string, baseRange: number): number {
  if (state.level === 0) return baseRange;
  return state.knownVehicle === currentVehicle ? baseRange : baseRange * 0.42;
}

/** Easy-mode pursuit: cops forget fast, escalate slowly. */
export function tickHeat(
  state: HeatState,
  dt: number,
  seenByCop: boolean,
  playerX: number,
  playerY: number,
  crimeJustCommitted: number,
  currentVehicle = "",
  /**
   * Whether the player is actually running from the police. Standing in the
   * street being looked at used to climb the wanted level to three on its own,
   * which turned one minor star into a growing escort that never left.
   */
  resisting = true,
): HeatState {
  const next = { ...state };
  if (crimeJustCommitted > 0) {
    next.level = clampHeat(next.level + crimeJustCommitted);
    // A head start on the escalation clock, for pulling something where a cop
    // can see it. It only survives when `seenByCop` is set in this same call:
    // do it out of sight and the branch below zeroes it, which is the point.
    next.seenTimer = 2.4;
    next.hiddenTimer = 0;
    next.hasLastKnown = true;
    next.lastKnownX = playerX;
    next.lastKnownY = playerY;
    next.knownVehicle = currentVehicle;
    next.searchRadius = 90;
  }

  if (seenByCop) {
    next.seenTimer += dt;
    next.hiddenTimer = 0;
    next.hasLastKnown = true;
    next.lastKnownX = playerX;
    next.lastKnownY = playerY;
    next.knownVehicle = currentVehicle;
    next.searchRadius = 90;
    if (
      resisting &&
      next.level >= 1 &&
      next.seenTimer > POLICE_CONFIG.escalateAfterSeenSeconds &&
      next.level < POLICE_CONFIG.maxAutoEscalateLevel
    ) {
      next.level = clampHeat(next.level + 1);
      next.seenTimer = 0;
    }
  } else if (next.level > 0) {
    next.hiddenTimer += dt;
    next.seenTimer = 0;
    // The search zone widens while cops sweep, then the whole thing cools off.
    next.searchRadius = Math.min(240, next.searchRadius + dt * 14);
    const loseAfter = POLICE_CONFIG.loseSightSeconds[next.level] ?? 8;
    if (next.hiddenTimer >= loseAfter) {
      next.level = clampHeat(next.level - 1);
      next.hiddenTimer = 0;
      if (next.level === 0) {
        next.hasLastKnown = false;
        next.knownVehicle = "";
        next.searchRadius = 0;
      }
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

export function assistHint(level: HeatLevel, hiddenTimer: number, nearHide: boolean): string {
  if (level === 0) return "";
  if (nearHide) return "AI ASSIST  ·  duck into the alley / garage — they lose you faster";
  if (hiddenTimer > 1.2) return "AI ASSIST  ·  stay dark  ·  heat dropping";
  if (level <= 2) return "AI ASSIST  ·  break line of sight, then change cars";
  if (level === 3) return "AI ASSIST  ·  cut alleys, they hesitate at corners";
  return "AI ASSIST  ·  hide, swap clothes later  ·  do not fight the whole city";
}
