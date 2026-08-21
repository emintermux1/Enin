import type { Message } from "../types";
import { normalizeSlang } from "./slang";

const REPEAT_STEMS = [
  "buğu",
  "bugu",
  "sansür",
  "cam açık",
  "şehir ışığı",
  "koltuk yatık",
  "su akıyo",
  "kirli kal",
  "itaat",
];

export function usedThem(history: Message[]): Set<string> {
  return new Set(
    history.filter((item) => item.role === "them").map((item) => normalizeSlang(item.text)),
  );
}

export function usedHaystack(history: Message[]): string {
  return history
    .filter((item) => item.role === "them")
    .map((item) => normalizeSlang(item.text))
    .join(" · ");
}

export function isRepeat(line: string, history: Message[]): boolean {
  const normalized = normalizeSlang(line);
  if (usedThem(history).has(normalized)) {
    return true;
  }
  const hay = usedHaystack(history);
  return REPEAT_STEMS.some((stem) => normalized.includes(stem) && hay.includes(stem));
}

export function pickUnused(pairs: string[][], history: Message[], salt: number): string[] | null {
  const fresh = pairs.filter((pair) => pair.every((line) => !isRepeat(line, history)));
  if (fresh.length === 0) {
    return null;
  }
  return fresh[Math.abs(salt) % fresh.length] ?? fresh[0] ?? null;
}

export function dropRepeats(lines: string[], history: Message[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const normalized = normalizeSlang(line);
    if (seen.has(normalized) || isRepeat(line, history)) {
      continue;
    }
    seen.add(normalized);
    out.push(line);
  }
  return out;
}

export function fillName(lines: string[], name: string): string[] {
  const safe = name.trim() || "sen";
  return lines.map((line) => line.replaceAll("{name}", safe));
}
