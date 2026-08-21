import type {
  CharacterId,
  Choice,
  EngineResult,
  HeatTier,
  Intent,
  LocationId,
  Message,
} from "../types";
import { detectAct, nextChoices, openingChoices as sceneOpening, playScene } from "./scene";

const INTENT_PATTERNS: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: "greet",
    pattern:
      /\b(merhaba|selam|slm|mrb|hey|naber|napıyon|napion|napıyorsun|napyorsun|nasılsın|nasilsin|iyi akşamlar|iyi aksamlar|gece)\b/i,
  },
  {
    intent: "kiss",
    pattern: /\b(öp|op|öpücük|opucuk|dudak|dil|boynun|boynu|kulağın|kulagin)\b/i,
  },
  {
    intent: "invite",
    pattern:
      /\b(gel|geliyorum|evine|evime|yatak|otele|odana|buluş|bulus|kaçır|kacir)\b/i,
  },
  {
    intent: "dirty",
    pattern:
      /\b(sik|sikiş|sikis|sakso|yala|yiyim|amini|amını|emil|çıplak|ciplak|azgın|azgin|sert|içine|icine|boşal|bosal|orgazm|ağzına|agzina)\b/i,
  },
  {
    intent: "body",
    pattern:
      /\b(göğüs|gogus|göğsün|bacak|kalça|kalca|belin|belini|saç|sac|ellerin|ellerini|tenin|tenini|ağzın|agzin)\b/i,
  },
  {
    intent: "tease",
    pattern: /\b(yok|yapmam|bekle|sabret|kızdır|kizdir|alay|kışkırt|kiskirt)\b/i,
  },
  {
    intent: "compliment",
    pattern:
      /\b(güzelsin|guzelsin|seksisin|tatlısın|tatlisin|çok iyisin|cok iyisin|hoşuma|hosuma|bayıldım|bayildim)\b/i,
  },
  {
    intent: "soft",
    pattern:
      /\b(sarıl|saril|yavaş|yavas|nazik|kal|yanımda|yanimda|nefesi|nefesin)\b/i,
  },
  {
    intent: "night",
    pattern: /\b(gece|yalnız|yalniz|uyku|yatağın|yatagin|karanlık|karanlik)\b/i,
  },
  {
    intent: "question",
    pattern:
      /\?|(ne yapıyorsun|ne yapiyorsun|neredesin|nerdeysin|ne giyiyorsun|ne giyiyon|ne istiyorsun|kaç yaş|kac yas|adın ne|adin ne)/i,
  },
];

export function detectIntent(input: string): Intent {
  for (const item of INTENT_PATTERNS) {
    if (item.pattern.test(input)) {
      return item.intent;
    }
  }
  return "generic";
}

export function heatTier(heat: number): HeatTier {
  if (heat < 25) return 0;
  if (heat < 50) return 1;
  if (heat < 75) return 2;
  return 3;
}

export function locationForHeat(heat: number): LocationId {
  if (heat < 28) return "bar";
  if (heat < 52) return "taxi";
  if (heat < 78) return "suite";
  return "yatak";
}

export function locationLabel(location: LocationId): string {
  switch (location) {
    case "bar":
      return "İlk masa";
    case "taxi":
      return "Yol";
    case "suite":
      return "Oda";
    case "yatak":
      return "Yatak";
    default: {
      const _exhaustive: never = location;
      return _exhaustive;
    }
  }
}

export function nextReply(
  _characterId: CharacterId,
  input: string,
  heat: number,
  history: Message[],
  _playerName: string,
): EngineResult {
  const act = detectAct(input);
  const nextHeat = Math.min(100, heat + (act === "talk" || act === "ask" ? 8 : 16));
  const nextLocation = locationForHeat(nextHeat);
  return {
    bubbles: playScene(input, history),
    heatDelta: nextHeat - heat,
    beat: null,
    location: nextLocation,
    choices: nextChoices(input, history),
  };
}

export function openingChoices(_characterId?: CharacterId, _heat = 0): Choice[] {
  return sceneOpening();
}
