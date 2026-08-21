import type { CharacterId, StretchMode } from "../types";
import { getCharacter } from "../data/characters";
import { humanize } from "./slang";

type Voice = {
  stretch: StretchMode;
  maxBubbles: 2 | 3;
  endings: string[];
  moan: string[];
};

const VOICES: Record<CharacterId, Voice> = {
  leyla: {
    stretch: "heavy",
    maxBubbles: 3,
    endings: ["anlarsın ya", "offf"],
    moan: ["offf", "mm offf", "ah yaa"],
  },
  elif: {
    stretch: "light",
    maxBubbles: 2,
    endings: ["hadi", "geç kalma"],
    moan: ["of", "hıh"],
  },
  defne: {
    stretch: "mid",
    maxBubbles: 3,
    endings: ["kirli kal", "sansür yok"],
    moan: ["mm", "ah"],
  },
  yasemin: {
    stretch: "light",
    maxBubbles: 2,
    endings: ["konuşma", "hemen"],
    moan: ["off", "ah"],
  },
  melis: {
    stretch: "none",
    maxBubbles: 3,
    endings: ["söyledim", "itaat et"],
    moan: ["mm"],
  },
};

export function voiceOf(id: CharacterId): Voice {
  return VOICES[id];
}

function swapForVoice(line: string, id: CharacterId): string {
  switch (id) {
    case "leyla":
      return line;
    case "elif":
      return line.replaceAll("yaaa", "hadi").replaceAll("lütfen", "hadi").replaceAll("anlarsın ya", "geç kalma");
    case "defne":
      return line;
    case "yasemin":
      return line.replaceAll("lütfen", "hemen").replaceAll("anlarsın ya", "konuşma");
    case "melis":
      return line.replaceAll("lütfen", "şimdi").replaceAll("durma", "emrettim").replaceAll("yaaa", "");
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

const STAMP: Record<CharacterId, string[]> = {
  leyla: [],
  elif: ["hadi dilini çekme", "geç kalma of"],
  defne: ["bu sahneyi kirli yazıyom", "sansürsüz kal"],
  yasemin: ["konuşma hemen", "terim soğumasın"],
  melis: ["emrettim çekme", "itaat güzel duruyo"],
};

export function applyVoice(
  lines: string[],
  id: CharacterId,
  salt: number,
  name: string,
): string[] {
  const voice = VOICES[id];
  const person = getCharacter(id);
  let next = lines.map((line) =>
    swapForVoice(line, id).replaceAll("{name}", name).replaceAll("leyla", person.name.toLocaleLowerCase("tr-TR")),
  );
  const stamps = STAMP[id];
  if (stamps.length > 0 && salt % 2 === 0) {
    const stamp = stamps[Math.abs(salt) % stamps.length] ?? stamps[0];
    if (stamp) {
      next = [...next.slice(0, Math.max(0, voice.maxBubbles - 1)), stamp];
    }
  }
  if (next.length > voice.maxBubbles) {
    next = next.slice(0, voice.maxBubbles);
  }
  const last = next[next.length - 1] ?? "";
  const ending = voice.endings[Math.abs(salt) % voice.endings.length];
  if (id !== "leyla" && ending && last && !last.includes(ending)) {
    next[next.length - 1] = `${last} ${ending}`;
  }
  return humanize(next, salt, voice.stretch);
}

export function voiceMoan(id: CharacterId, salt: number): string {
  const voice = VOICES[id];
  return voice.moan[Math.abs(salt) % voice.moan.length] ?? "offf";
}
