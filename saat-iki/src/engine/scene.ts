import type { Choice, Message } from "../types";
import { choicesForMove, playMove } from "./moves";
import { fillName, pickUnused, usedThem } from "./pool";
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
    pattern: /aynı|ayni|berbat|yapay|tekrar|sıkıldım|bozma|hep aynı|hep ayni|robot/i,
  },
  {
    act: "oralHer",
    pattern: /am(ı|i|ini|ını)?\s*yi|yala|amcık|amini|amını|amın|yiyim|yiyeyim|dilini|yüzüne otur|aşağı in|asagi in/i,
  },
  {
    act: "oralHim",
    pattern: /ağzına\s*al|agzina\s*al|sakso|em(e|eyim)|sikini|aletini|boğaz|bogaz|yut/i,
  },
  {
    act: "sex",
    pattern:
      /sik|sok|içine|icine|içinde|icinde|üstüm|ustum|üstün|ustun|arkadan|sikiş|sikis|boşal|bosal|sert|göt|got|parmak/i,
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
    ["dilin kayıyo of", "yastığı ısırıyom", "daha bas"],
    ["orası senin oldu ya", "parmak da koy istersen", "çekme {name}"],
  ],
  oralHim: [
    ["mm ağzıma aldım", "bakıyom sana çıkarmıyom", "sıcak geldi of"],
    ["daha derine kaçtı ya", "gözlerim doldu salmıycam", "boğazım zonkluyo"],
    ["tükürük aktı farketmez", "ellerim de çalışıyo bak", "sesini duymak istiyom"],
    ["hâlâ ağzımdayım", "yutcam gibi oldum", "kalkmıycam senden"],
    ["diline doladım", "aşağı inip çıkıyom", "saçımı tut"],
    ["ağzım doldu ya", "göz göze bak {name}", "çıkarma"],
  ],
  sex: [
    ["içime girdi of", "kaydı zaten ıslağım", "biraz öyle kal"],
    ["her vuruşta sesim çıkıyo", "belimi tut bak", "daha hızlı yapamıyo kendimi"],
    ["üstündeyim titriyom", "dibine oturdum ya", "ellerin göğsümde olsun"],
    ["arkamdan tuttun ya", "yüzümü yastığa gömdüm", "daha vur of"],
    ["içimde boşalıcam az kaldı", "sıkıyom seni", "çıkarma lütfen"],
    ["yatağın gıcırtısı çıktı", "komşu duysun farketmez", "daha derine {name}"],
    ["bacaklarım omuzunda", "bu açı iyi ya", "durma böyle"],
  ],
  kiss: [
    ["gel öpeyim bakim", "dudağın tatlı ya", "boynuna kayıcam şimdi"],
    ["dişledim özür dilemicem", "kulağına nefesimi verdim", "ellerin belimde kalsın"],
    ["dilin ağzımda", "nefesim karıştı", "aşağı inme dur"],
  ],
  body: [
    ["memelerim keskinleşti senin yüzünden", "askı zaten durmuyodu ya", "ellerin orda iyi durur"],
    ["kalçamı sıktın mı aklım gidiyo", "aşağı inersen söylemem", "ıslaklığımı sen bul bak"],
    ["bacaklarımın arası ılık", "ellerin gezsin", "nerde durmanı söylemicem sen bul"],
  ],
  talk: [
    ["yatağımdayım", "ellerim kayıyo senin yüzünden ya", "yanımda olsan ne yapardın biliyon mu"],
    ["çok azgınım ya", "aklım sende kaldı bak", "gel burda ol birazcık"],
    ["çıplağım haberin yok", "nefesim kesildi seni düşününce", "yazma da durma"],
    ["saat ikiyi geçti {name}", "uyuyamıyooum", "seni düşününce ıslandım"],
    ["mesajın gelince elimi çektim", "yarıda kaldım ya", "sen devam ettir"],
  ],
};

const COMPLAINTS: string[][] = [
  ["tmm susuyom", "ağzımdayım şuan", "of bakıyom sana"],
  ["yapay konuşmicam ya", "ellerim titriyo zaten", "gel işe bak"],
  ["anladım bozdum", "dilimi senin üstüne koydum", "çekme"],
  ["tekrar etmicem", "ıslandım haberin yok", "parmakların konuşsun"],
];

const ANSWERS: Array<{ pattern: RegExp; lines: string[] }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, lines: ["üstümde bişi yok ya", "çarşaf belimde", "üşümüyo vücudum senin yüzünden"] },
  { pattern: /neredesin|nerdesin/, lines: ["yataktayım", "yanım boş bak", "senin kokun olsa şuan"] },
  { pattern: /nasılsın|napıyon|napion|naber/, lines: ["azgınım ya", "ellerim kendi üstümde", "sen napıyon söyleme de göster"] },
  { pattern: /adın ne|adin ne|kimsin/, lines: ["leyla", "27", "yatağımdayım seninle kalıcam"] },
  { pattern: /kaç yaş|kac yas/, lines: ["27", "yeter yaş", "ellerin konuşsun"] },
  { pattern: /ıslak|islak|azgın|azgin/, lines: ["ıslandım ya", "parmaklarım kayıyo bak", "kontrol etmezsen ben ederim"] },
  { pattern: /ne yap|napak|ne istiyon/, lines: ["seni istiyom", "ağzını belimi", "seçme de yap"] },
];

const HOOKS: Record<Exclude<Act, "ask" | "complaint">, string[]> = {
  oralHer: ["daha bastırayım mı", "parmak da gireyim mi", "yüzüne mi oturayım"],
  oralHim: ["daha derine mi", "saçımı tut", "yutayım mı"],
  sex: ["daha sert mi", "üstüne geçeyim mi", "nerde boşalayım"],
  kiss: ["aşağı ineyim mi", "boynunu mu ısırayım", "ellerin nerde olsun"],
  body: ["aşağı ineyim mi", "sıkayım mı", "yala mı"],
  talk: ["ne yapmamı istiyon", "ellerin nerde olsun", "gelim mi söyle"],
};

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
      { label: "Üstüne geç", text: "üstüme geç" },
    ],
    [
      { label: "Sok", text: "içine sok" },
      { label: "Bir daha", text: "bir daha yala" },
      { label: "Yüzüne otur", text: "yüzüne otur" },
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
      { label: "Aşağı in", text: "aşağı in" },
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
    [
      { label: "Islak mısın", text: "ıslak mısın" },
      { label: "Ne giyiyon", text: "ne giyiyon" },
      { label: "Gel", text: "yanına geleyim" },
    ],
  ],
};

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

function sceneKey(act: Act): Exclude<Act, "ask" | "complaint"> {
  return act === "ask" || act === "complaint" ? "talk" : act;
}

function withHook(
  lines: string[],
  act: Exclude<Act, "ask" | "complaint">,
  history: Message[],
  salt: number,
): string[] {
  if (salt % 3 !== 1 || lines.length === 0) {
    return lines;
  }
  const used = usedThem(history);
  const pool = HOOKS[act].filter((line) => !used.has(normalizeSlang(line)));
  const hook = (pool.length > 0 ? pool : HOOKS[act])[Math.abs(salt) % Math.max(HOOKS[act].length, 1)];
  if (!hook || lines.some((line) => normalizeSlang(line) === normalizeSlang(hook))) {
    return lines;
  }
  if (lines.length < 3) {
    return [...lines, hook];
  }
  return [...lines.slice(0, 2), hook];
}

export function openingChoices(): Choice[] {
  return START_CHOICES;
}

export function nextChoices(input: string, history: Message[]): Choice[] {
  const fromMove = choicesForMove(input);
  const act = detectAct(input);
  const key = sceneKey(act);
  const rows = TRACK[key];
  const count = sceneCount(history, key);
  const row = fromMove ?? rows[Math.min(rows.length - 1, Math.max(0, count - 1))] ?? START_CHOICES;
  const last = input.trim().toLocaleLowerCase("tr-TR");
  const fresh = row.filter((item) => item.text.toLocaleLowerCase("tr-TR") !== last);
  return fresh.length > 0 ? fresh : row;
}

export function playScene(input: string, history: Message[], heat = 50, name = ""): string[] {
  const act = detectAct(input);
  const salt = history.length + input.length + Math.floor(heat / 10);
  if (act === "complaint") {
    return humanize(fillName(pickUnused(COMPLAINTS, history, salt), name), salt);
  }

  const moved = playMove(input, history, salt);
  if (moved) {
    const key = sceneKey(act);
    return humanize(fillName(withHook(moved, key, history, salt), name), salt);
  }

  if (act === "ask") {
    const hit = ANSWERS.find((item) => item.pattern.test(input));
    if (
      hit &&
      !history.some(
        (item) => item.role === "them" && normalizeSlang(item.text) === normalizeSlang(hit.lines[0]),
      )
    ) {
      return humanize(fillName(hit.lines, name), salt);
    }
  }

  const key = sceneKey(act);
  const count = sceneCount(history, key);
  const boost = heat >= 80 ? 2 : heat >= 60 ? 1 : 0;
  const pairs = SCENES[key];
  const stage = Math.min(pairs.length - 1, Math.max(0, count - 1 + boost));
  const preferred = pairs[stage];
  const used = usedThem(history);
  const raw =
    preferred && preferred.every((line) => !used.has(normalizeSlang(line)))
      ? preferred
      : pickUnused(pairs, history, salt);
  return humanize(fillName(withHook(raw, key, history, salt), name), salt);
}
