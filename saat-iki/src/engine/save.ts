import type { SavedNight } from "../types";

const KEY = "saat-iki-night-v1";

function canStore(): boolean {
  return typeof localStorage !== "undefined";
}

export function loadNight(): SavedNight | null {
  if (!canStore()) {
    return null;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Omit<SavedNight, "characterId"> & { characterId: string };
    if (parsed.version !== 1 || !parsed.playerName || !parsed.characterId || !parsed.messages?.length) {
      return null;
    }
    const characterId = parsed.characterId === "leyla" ? "asya" : parsed.characterId;
    return { ...parsed, characterId } as SavedNight;
  } catch {
    return null;
  }
}

export function saveNight(night: SavedNight): void {
  if (!canStore()) {
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(night));
  } catch {
    // private mode / quota — gece uçmasın diye yut
  }
}

export function clearNight(): void {
  if (!canStore()) {
    return;
  }
  localStorage.removeItem(KEY);
}
