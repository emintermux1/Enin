import type { Choice, Message } from "../types";

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
    pattern:
      /sik|sok|içine|icine|içinde|icinde|üstüm|ustum|üstün|ustun|arkadan|sikiş|sikis|boşal|bosal|sert|göt|got/i,
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

const START_CHOICES: Choice[] = [
  { label: "Öp", text: "öp beni" },
  { label: "Yala", text: "amini yiyim" },
  { label: "Ağzına al", text: "ağzına al" },
];

const TRACK: Record<Exclude<Act, "ask" | "complaint">, Choice[][]> = {
  oralHer: [
    [
      { label: "Daha derin", text: "daha derin yala durma" },
      { label: "Parmak da", text: "parmak da sok yala" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Yüzüne otur", text: "yüzüme otur yala" },
      { label: "Boşal", text: "boşalana kadar yala" },
      { label: "Sok artık", text: "içine sok" },
    ],
    [
      { label: "Çekme", text: "dilini çekme boşalıcam" },
      { label: "Sok", text: "içine sok" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Sok", text: "içine sok sert" },
      { label: "Bir daha yala", text: "bir daha yala" },
      { label: "Üstüne geç", text: "üstüme geç" },
    ],
  ],
  oralHim: [
    [
      { label: "Daha derine", text: "daha derine al" },
      { label: "Saçını tut", text: "saçını tut boğazına kadar" },
      { label: "Yala beni", text: "amini yiyim" },
    ],
    [
      { label: "Boğazına", text: "boğazına kadar al" },
      { label: "Yut", text: "ağzına al yut" },
      { label: "Sok", text: "içine sok" },
    ],
    [
      { label: "Yut", text: "yut" },
      { label: "İçine gir", text: "içine sok" },
      { label: "Tekrar al", text: "ağzına al durma" },
    ],
    [
      { label: "Sok", text: "içine sok" },
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Bir daha al", text: "ağzına al bir daha" },
    ],
  ],
  sex: [
    [
      { label: "Daha sert", text: "daha sert sik çıkarma" },
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Üstüne geç", text: "üstüme geç al" },
      { label: "Arkadan", text: "arkadan sik" },
      { label: "İçinde kal", text: "içinde kal çıkarma" },
    ],
    [
      { label: "Arkadan", text: "arkadan çevir sik" },
      { label: "Saçını çek", text: "saçını çek vur" },
      { label: "Boşal", text: "içinde boşal" },
    ],
    [
      { label: "Boşal içimde", text: "içinde boşal" },
      { label: "Bir daha", text: "bir daha sik" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Bir daha", text: "bir daha içine sok" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
  ],
  kiss: [
    [
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Boynunu ısır", text: "boynunu ısır" },
    ],
    [
      { label: "Yala", text: "amini yiyim" },
      { label: "Sok", text: "içine sok" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
  ],
  body: [
    [
      { label: "Yala", text: "amini yiyim" },
      { label: "Sık", text: "memelerini sık" },
      { label: "Aşağı in", text: "aşağı in yala" },
    ],
    [
      { label: "Yala", text: "amini yiyim" },
      { label: "Sok", text: "içine sok" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
  ],
  talk: [
    [
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  ],
};

export function openingChoices(): Choice[] {
  return START_CHOICES;
}

export function nextChoices(input: string, history: Message[]): Choice[] {
  const act = detectAct(input);
  const key: Exclude<Act, "ask" | "complaint"> =
    act === "ask" || act === "complaint" ? "talk" : act;
  const rows = TRACK[key];
  const count = sceneCount(history, act === "ask" || act === "complaint" ? "talk" : act);
  const row = rows[Math.min(rows.length - 1, Math.max(0, count - 1))] ?? START_CHOICES;
  const last = input.trim().toLocaleLowerCase("tr-TR");
  const fresh = row.filter((item) => item.text.toLocaleLowerCase("tr-TR") !== last);
  return fresh.length > 0 ? fresh : row;
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
