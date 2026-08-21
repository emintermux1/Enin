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
  asya: {
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
    endings: ["istiyorum onu", "yazdım bak"],
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
    endings: ["söyledim", "şimdi"],
    moan: ["mm"],
  },
};

export function voiceOf(id: CharacterId): Voice {
  return VOICES[id];
}

function swapForVoice(line: string, id: CharacterId): string {
  switch (id) {
    case "asya":
      return line;
    case "elif":
      return line.replaceAll("yaaa", "hadi").replaceAll("lütfen", "hadi").replaceAll("anlarsın ya", "geç kalma");
    case "defne":
      return line
        .replaceAll("yapıyom bak", "istiyorum bak")
        .replaceAll("anlarsın ya", "isteklerim bu");
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

export function applyVoice(
  lines: string[],
  id: CharacterId,
  salt: number,
  name: string,
): string[] {
  const voice = VOICES[id];
  const person = getCharacter(id);
  let next = lines.map((line) =>
    swapForVoice(line, id).replaceAll("{name}", name).replaceAll("asya", person.name.toLocaleLowerCase("tr-TR")),
  );
  if (next.length > voice.maxBubbles) {
    next = next.slice(0, voice.maxBubbles);
  }
  return humanize(next, salt, voice.stretch);
}

export function voiceMoan(id: CharacterId, salt: number): string {
  const voice = VOICES[id];
  return voice.moan[Math.abs(salt) % voice.moan.length] ?? "offf";
}
