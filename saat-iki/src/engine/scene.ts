import type { Choice, Message } from "../types";
import { humanize, normalizeSlang } from "./slang";

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

const SCENES: Record<Exclude<Act, "ask" | "complaint">, string[][]> = {
  oralHer: [
    ["off dilin değdi ya", "bacaklarım titriyo bak", "ıslandım durma"],
    ["mm orası", "ellerim saçında sıkıyom", "sesim çıkıyo yaa daha böyle"],
    ["yüzün orda iyi duruyo", "kalçam oynuyo durduramıycam", "çekme of"],
    ["boşalıcam nerdeyse", "bacaklarım kilitlendi bak", "biraz daha lütfen"],
  ],
  oralHim: [
    ["mm ağzıma aldım", "bakıyom sana çıkarmıyom", "sıcak geldi of"],
    ["daha derine kaçtı ya", "gözlerim doldu salmıycam", "boğazım zonkluyo"],
    ["tükürük aktı farketmez", "ellerim de çalışıyo bak", "sesini duymak istiyom"],
    ["hâlâ ağzımdayım", "yutcam gibi oldum", "kalkmıycam senden"],
  ],
  sex: [
    ["içime girdi of", "kaydı zaten ıslağım", "biraz öyle kal"],
    ["her vuruşta sesim çıkıyo", "belimi tut bak", "daha hızlı yapamıyo kendimi"],
    ["üstündeyim titriyom", "dibine oturdum ya", "ellerin göğsümde olsun"],
    ["arkamdan tuttun ya", "yüzümü yastığa gömdüm", "daha vur of"],
    ["içimde boşalıcam az kaldı", "sıkıyom seni", "çıkarma lütfen"],
  ],
  kiss: [
    ["gel öpeyim bakim", "dudağın tatlı ya", "boynuna kayıcam şimdi"],
    ["dişledim özür dilemicem", "kulağına nefesimi verdim", "ellerin belimde kalsın"],
  ],
  body: [
    ["memelerim keskinleşti senin yüzünden", "askı zaten durmuyodu ya", "ellerin orda iyi durur"],
    ["kalçamı sıktın mı aklım gidiyo", "aşağı inersen söylemem", "ıslaklığımı sen bul bak"],
  ],
  talk: [
    ["yatağımdayım", "ellerim kayıyo senin yüzünden ya", "yanımda olsan ne yapardın biliyon mu"],
    ["çok azgınım ya", "aklım sende kaldı bak", "gel burda ol birazcık"],
    ["çıplağım haberin yok", "nefesim kesildi seni düşününce", "yazma da durma"],
  ],
};

const COMPLAINTS: string[][] = [
  ["tmm susuyom", "ağzımdayım şuan", "of bakıyom sana"],
  ["yapay konuşmicam ya", "ellerim titriyo zaten", "gel işe bak"],
];

const ANSWERS: Array<{ pattern: RegExp; lines: string[] }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, lines: ["üstümde bişi yok ya", "çarşaf belimde", "üşümüyo vücudum senin yüzünden"] },
  { pattern: /neredesin|nerdesin/, lines: ["yataktayım", "yanım boş bak", "senin kokun olsa şuan"] },
  { pattern: /nasılsın|napıyon|napion|naber/, lines: ["azgınım ya", "ellerim kendi üstümde", "sen napıyon söyleme de göster"] },
  { pattern: /adın ne|adin ne|kimsin/, lines: ["leyla", "27", "yatağımdayım seninle kalıcam"] },
  { pattern: /kaç yaş|kac yas/, lines: ["27", "yeter yaş", "ellerin konuşsun"] },
  { pattern: /ıslak|islak|azgın|azgin/, lines: ["ıslandım ya", "parmaklarım kayıyo bak", "kontrol etmezsen ben ederim"] },
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
  const used = new Set(
    history.filter((item) => item.role === "them").map((item) => normalizeSlang(item.text)),
  );
  const fresh = pairs.find((pair) => pair.every((line) => !used.has(normalizeSlang(line))));
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
      { label: "Daha böyle", text: "daha böyle yala durma" },
      { label: "Parmak da", text: "parmak da sok" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Durma", text: "durma yala" },
      { label: "Boşal", text: "boşalana kadar yala" },
      { label: "Sok", text: "içine sok" },
    ],
    [
      { label: "Çekme", text: "dilini çekme" },
      { label: "Sok", text: "içine sok" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Sok", text: "içine sok" },
      { label: "Bir daha", text: "bir daha yala" },
      { label: "Üstüne geç", text: "üstüme geç" },
    ],
  ],
  oralHim: [
    [
      { label: "Daha derine", text: "daha derine al" },
      { label: "Saçını tut", text: "saçını tut" },
      { label: "Yala beni", text: "amini yiyim" },
    ],
    [
      { label: "Boğazına", text: "boğazına kadar al" },
      { label: "Yut", text: "yut" },
      { label: "Sok", text: "içine sok" },
    ],
    [
      { label: "Yut", text: "yut" },
      { label: "İçine gir", text: "içine sok" },
      { label: "Durma", text: "ağzına al durma" },
    ],
    [
      { label: "Sok", text: "içine sok" },
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Bir daha", text: "ağzına al bir daha" },
    ],
  ],
  sex: [
    [
      { label: "Daha hızlı", text: "daha hızlı" },
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
    [
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Arkadan", text: "arkadan" },
      { label: "İçinde kal", text: "içinde kal" },
    ],
    [
      { label: "Arkadan", text: "arkadan çevir" },
      { label: "Saçını çek", text: "saçını çek" },
      { label: "Boşal", text: "içinde boşal" },
    ],
    [
      { label: "Boşal", text: "içinde boşal" },
      { label: "Bir daha", text: "bir daha" },
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
      { label: "Aşağı in", text: "aşağı in" },
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
  const salt = history.length;
  if (act === "complaint") {
    return humanize(unusedPair(COMPLAINTS, history), salt);
  }
  if (act === "ask") {
    const hit = ANSWERS.find((item) => item.pattern.test(input));
    if (
      hit &&
      !history.some(
        (item) => item.role === "them" && normalizeSlang(item.text) === normalizeSlang(hit.lines[0]),
      )
    ) {
      return humanize(hit.lines, salt);
    }
  }
  const key: Exclude<Act, "ask" | "complaint"> = act === "ask" ? "talk" : act;
  const count = sceneCount(history, act === "ask" ? "talk" : act);
  const pairs = SCENES[key];
  const stage = Math.min(pairs.length - 1, Math.max(0, count - 1));
  const preferred = pairs[stage];
  const used = new Set(
    history.filter((item) => item.role === "them").map((item) => normalizeSlang(item.text)),
  );
  const raw =
    preferred && preferred.every((line) => !used.has(normalizeSlang(line)))
      ? preferred
      : unusedPair(pairs, history);
  return humanize(raw, salt);
}
