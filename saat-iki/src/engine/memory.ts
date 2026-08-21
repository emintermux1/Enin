import type { Message } from "../types";
import { detectMove, type MoveId } from "./moves";

const RECALL: Partial<Record<MoveId, string>> = {
  hair: "saçımı yine çek {name}",
  finger: "parmakların yine orda olsun",
  ride: "üstüne yine binicem",
  behind: "arkadan yine vur",
  swallow: "yine yutayım mı",
  breast: "memelerimi unutma",
  sit: "yüzüne yine otururum",
  cum: "içime yine bırak",
  faster: "o sertliğe geri dön",
  shower: "duşa yine çek",
  hall: "koridorda yine yapıştır",
  squirt: "yine fışkırt beni",
  public: "herkes yine duysun",
  pillow: "yastığa yine sürtüneyim",
  rough: "hayvan gibi yine",
  touch: "yine kendime dokunuyom",
};

export function recentMoveIds(history: Message[]): MoveId[] {
  const found: MoveId[] = [];
  for (const item of history) {
    if (item.role !== "you") {
      continue;
    }
    const move = detectMove(item.text);
    if (move) {
      found.push(move.id);
    }
  }
  return found.slice(-8);
}

export function memoryLine(moves: string[], salt: number): string | null {
  if (moves.length < 2 || salt % 4 !== 2) {
    return null;
  }
  const prior = moves[moves.length - 2];
  if (!prior) {
    return null;
  }
  return RECALL[prior as MoveId] ?? null;
}

export function isClimax(input: string): boolean {
  const move = detectMove(input);
  return move?.id === "cum" || /boşal|bosal/.test(input);
}
