import type { Message } from "../types";

export type Act =
  | "complaint"
  | "oralHer"
  | "oralHim"
  | "sex"
  | "kiss"
  | "body"
  | "ask"
  | "talk";

const ACT_PATTERNS: Array<{ act: Act; pattern: RegExp }> = [
  {
    act: "complaint",
    pattern: /aynı|ayni|berbat|yapay|tekrar|sıkıldım|bozma|hep aynı|hep ayni/i,
  },
  {
    act: "oralHer",
    pattern: /am(ı|i|ini|ını)?\s*yi|yala|amcık|amini|amını|amın|yiyim|yiyeyim/i,
  },
  {
    act: "oralHim",
    pattern: /ağzına\s*al|agzina\s*al|sakso|em(e|eyim)|sikini|aletini|boğaz|bogaz|yut/i,
  },
  {
    act: "sex",
    pattern: /sik|sok|içine|icine|içinde|icinde|sikiş|sikis|boşal|bosal|sert|göt|got/i,
  },
  {
    act: "kiss",
    pattern: /öp|dudak|boyn/i,
  },
  {
    act: "body",
    pattern: /göğüs|gogus|meme|kalça|kalca|bacak|belin|götün|gotun/i,
  },
  {
    act: "ask",
    pattern:
      /\?|ne giy|neredesin|nerdesin|napıyon|napion|nasılsın|nasilsin|adın ne|adin ne|kaç yaş|kimsin|ıslak|islak/i,
  },
];

/** WhatsApp-style lines, based on how people actually sext in TR: short, spoken, no novel. */
const SCENES: Record<Exclude<Act, "ask" | "complaint">, string[][]> = {
  oralHer: [
    ["yala o zaman", "bacaklarımı açtım. ıslandım zaten"],
    ["dilini koy kaçırma", "parmak da sok. ikisini birden istiyom"],
    ["yüzüme oturtcam seni az daha", "durma ya offf"],
    ["boşalıcam nerdeyse", "çekme dilini"],
  ],
  oralHim: [
    ["alıyom", "dizlerimin üstündeyim bakıyorum sana"],
    ["daha derine çekiyom", "tükürük aktı salmıycam"],
    ["saçımı tut", "boğazıma kadar ver"],
    ["yutcam söylecen mi", "hâlâ ağzımdayım kalkmıycam"],
  ],
  sex: [
    ["sok", "ıslağım zaten kaycak. içime gir"],
    ["içindesin", "belimi tut daha sert çıkarma"],
    ["üstüne geçtim", "dibine kadar alıyom seni"],
    ["arkadan istiyosan çevir", "saçımı çek vur"],
    ["boşalma içimde", "sıkıyom bırakmıycam"],
  ],
  kiss: [
    ["gel öpeyim", "dudağını çekiyom dilini ver"],
    ["boynuna indim", "dişledim iz bırakıyom"],
  ],
  body: [
    ["memelerimi sık", "askı kaydı zaten"],
    ["kalçamı tut çek", "aşağı in ıslaklığımı bul"],
  ],
  talk: [
    ["yatağımdayım çıplağım", "ellerim kendi üstümde senin yüzünden"],
    ["yanımda olsan şuan ne yapacağını biliyon", "gel buraya"],
    ["çok azgınım ya", "yazma da yap"],
  ],
};

const COMPLAINTS: string[][] = [
  ["tmm susuyom", "ağzıma alıyom şuan. saçımı tut"],
  ["yapay konuşmicam", "dilini koy ya da sok. ikisinden biri"],
];

const ANSWERS: Array<{ pattern: RegExp; lines: string[] }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, lines: ["üstümde bişi yok", "çarşaf belimde o kadar"] },
  { pattern: /neredesin|nerdesin/, lines: ["yataktayım", "yanım boş senin yerin"] },
  { pattern: /nasılsın|napıyon|napion|naber/, lines: ["azgınım", "sen napıyon elin nerde"] },
  { pattern: /adın ne|adin ne|kimsin/, lines: ["leyla", "27. yataktayım yaz ne yapıcaz"] },
  { pattern: /kaç yaş|kac yas/, lines: ["27", "yeter yaş konuşmak"] },
  { pattern: /ıslak|islak|azgın|azgin/, lines: ["ıslandım ya", "parmaklarım kayıyo kontrol et"] },
];

export function detectAct(input: string): Act {
  for (const item of ACT_PATTERNS) {
    if (item.pattern.test(input)) {
      return item.act;
    }
  }
  return "talk";
}

export function sceneCount(history: Message[], act: Act): number {
  return history.filter((item) => item.role === "you" && detectAct(item.text) === act).length;
}

function unusedPair(pairs: string[][], history: Message[]): string[] {
  const used = new Set(history.filter((item) => item.role === "them").map((item) => item.text));
  const fresh = pairs.find((pair) => pair.every((line) => !used.has(line)));
  return fresh ?? pairs[pairs.length - 1] ?? ["gel"];
}

export function playScene(input: string, history: Message[]): string[] {
  const act = detectAct(input);
  if (act === "complaint") {
    return unusedPair(COMPLAINTS, history);
  }
  if (act === "ask") {
    const hit = ANSWERS.find((item) => item.pattern.test(input));
    if (hit && !history.some((item) => item.role === "them" && item.text === hit.lines[0])) {
      return hit.lines;
    }
  }
  const key: Exclude<Act, "ask" | "complaint"> = act === "ask" ? "talk" : act;
  const count = sceneCount(history, act === "ask" ? "talk" : act);
  const pairs = SCENES[key];
  const stage = Math.min(pairs.length - 1, Math.max(0, count - 1));
  const preferred = pairs[stage];
  const used = new Set(history.filter((item) => item.role === "them").map((item) => item.text));
  if (preferred && preferred.every((line) => !used.has(line))) {
    return preferred;
  }
  return unusedPair(pairs, history);
}
