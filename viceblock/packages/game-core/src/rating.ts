/**
 * Post-mission rating. Encourages replay: fast, clean, low-heat runs rank S.
 */
export type MissionRank = "S" | "A" | "B" | "C";

export function missionRating(seconds: number, parSeconds: number, damageTaken: number, maxHeat: number): MissionRank {
  let score = 0;
  if (seconds <= parSeconds) score += 2;
  else if (seconds <= parSeconds * 1.5) score += 1;
  if (damageTaken <= 0) score += 2;
  else if (damageTaken < 30) score += 1;
  if (maxHeat <= 1) score += 2;
  else if (maxHeat <= 2) score += 1;
  if (score >= 6) return "S";
  if (score >= 4) return "A";
  if (score >= 2) return "B";
  return "C";
}

/** Repeatable street race payout and rank from finish time. */
export function raceResult(seconds: number): { rank: MissionRank; cash: number } {
  if (seconds < 60) return { rank: "S", cash: 180 };
  if (seconds < 78) return { rank: "A", cash: 130 };
  if (seconds < 100) return { rank: "B", cash: 90 };
  return { rank: "C", cash: 50 };
}
