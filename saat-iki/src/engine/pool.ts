import type { Message } from "../types";
import { normalizeSlang } from "./slang";

export function usedThem(history: Message[]): Set<string> {
  return new Set(
    history.filter((item) => item.role === "them").map((item) => normalizeSlang(item.text)),
  );
}

export function pickUnused(pairs: string[][], history: Message[], salt: number): string[] {
  const used = usedThem(history);
  const fresh = pairs.filter((pair) => pair.every((line) => !used.has(normalizeSlang(line))));
  const pool = fresh.length > 0 ? fresh : pairs;
  return pool[Math.abs(salt) % pool.length] ?? ["gel ya"];
}

export function fillName(lines: string[], name: string): string[] {
  const safe = name.trim() || "sen";
  return lines.map((line) => line.replaceAll("{name}", safe));
}
