import { STARTER_CASH, levelFromXp } from "@viceblock/shared";
import { PLAYER_CONFIG } from "./config";

/** What the county charges to put you back together. Priced with the rest of the player's tuning. */
export const HOSPITAL_FEE = PLAYER_CONFIG.respawnMedicalFee;
export const AMMO_PRICE = 25;
export const REPAIR_PER_HP = 2;

export function startingCash(): number {
  return STARTER_CASH;
}

export function applyReward(
  cash: number,
  xp: number,
  streetRep: number,
  reward: { cash: number; xp: number; streetRep: number },
): { cash: number; xp: number; streetRep: number; level: number } {
  const nextCash = Math.max(0, cash + Math.floor(reward.cash));
  const nextXp = Math.max(0, xp + Math.max(0, Math.floor(reward.xp)));
  const nextRep = Math.max(0, streetRep + Math.max(0, Math.floor(reward.streetRep)));
  return {
    cash: nextCash,
    xp: nextXp,
    streetRep: nextRep,
    level: levelFromXp(nextXp),
  };
}

export function canAfford(cash: number, price: number): boolean {
  return cash >= price && price >= 0;
}

export function spend(cash: number, price: number): number | null {
  if (!canAfford(cash, price)) return null;
  return cash - price;
}

/** Server-side: reject duplicate mission claims. */
export function claimMission(
  completed: string[],
  missionId: string,
): { ok: true; completed: string[] } | { ok: false; reason: "already_claimed" } {
  if (completed.includes(missionId)) return { ok: false, reason: "already_claimed" };
  return { ok: true, completed: [...completed, missionId] };
}
