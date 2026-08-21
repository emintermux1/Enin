import { getCharacter } from "../data/characters";
import { getFantasy } from "../data/fantasies";
import type { Choice, FantasyId, Message, PlayOpts } from "../types";
import { echoReply } from "./echo";
import { choicesForMove, playMove } from "./moves";
import { AFTERCARE, nightPhase, PHASE_TALK } from "./night";
import { dropRepeats, fillName, isRepeat, pickUnused, usedThem } from "./pool";
import { normalizeSlang } from "./slang";
import { applyVoice, voiceMoan } from "./voice";

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
      /sik|sok|içine|icine|içinde|icinde|üstüm|ustum|üstün|ustun|arkadan|sikiş|sikis|boşal|bosal|sert|göt|got|parmak|yata[gğ]|yataga|fışkır|fiskir|hayvan|koridor|duvara/i,
  },
  {
    act: "kiss",
    pattern: /öp|dudak|boyn/i,
  },
  {
    act: "body",
    pattern: /göğüs|gogus|meme|kalça|kalca|bacak|belin|götün|gotun|ruj|etek|yastık|yastik|sürtün|surtun/i,
  },
  {
    act: "ask",
    pattern:
      /\?|ne giy|neredesin|nerdesin|napıyon|napion|nasılsın|nasilsin|adın ne|adin ne|kaç yaş|kimsin|ıslak|islak/i,
  },
];

const SCENES: Record<Exclude<Act, "ask" | "complaint">, string[][]> = {
  oralHer: [
    ["dilini amıma bas offf", "bacaklarım titriyo açılıyo", "çekme yala beni"],
    ["yüzüne oturuyom bak", "ıslanmanı istiyom {name}", "nefesin içeri girsin"],
    ["klitorise bas durma", "yastığı ısırıyom", "parmak da sok yalarken"],
    ["boşalıcam diline az kaldı", "uyluklarım kilitlendi", "fışkırt beni böyle"],
    ["amımı yala hayvan gibi", "ellerim saçında bastırıyom", "utanmıcam sesim çıksın"],
    ["dilin orda eriyom ya", "yüzün sırılsıklam olsun", "kalkma {name} bitir"],
  ],
  oralHim: [
    ["ağzıma aldım bak offf", "sıcaklığı dilimde", "çıkarmıyom kullan beni"],
    ["boğazıma kadar kaydı", "gözlerim doldu salmıycam", "saçımı tut it"],
    ["sikini emiyom yavaş sonra derin", "tükürük aktı hoşuma gidiyo", "yutmamı istiyon dimi"],
    ["ellerim taşaklarında", "ağzım inip çıkıyo", "sesini duyayım {name}"],
    ["ucunu öpüyom sonra yutuyom", "orospu gibi alıyom ya", "kalkmıycam senden"],
    ["ağzım doldu offf", "yutcam gibi oldum", "yüzüme de boşalt sonra yalarım"],
  ],
  sex: [
    ["içime sok offf", "ıslağım seni yutsun", "hayvan gibi sik beni"],
    ["her vuruşta şapırdıyom", "belimi kır bak", "daha sert vur durma"],
    ["üstündeyim memelerim sallanıyo", "dibine oturdum ya", "sikine binmeyi bayılıyorum"],
    ["arkadan yapıştır duvara", "yüzüm yastıkta inliyom", "saçımı çek tokatla"],
    ["içimde boşal {name}", "amım seni sıkıyo", "çıkarma hepsini bırak"],
    ["bacaklarım omuzunda", "bu açıda dibine kadar", "herkes duysun istiyom"],
    ["kontrolümü kaybedeyim", "beni kullan bitir", "sabaha kadar böyle kal"],
  ],
  kiss: [
    ["öpüşürken amım aktı", "dilini emiyom ya", "kırmızı rujum bitsin sende"],
    ["dudağın yetmez offf", "kucağına oturuyom sürtünüyom", "ellerin külotumun içinde olsun"],
    ["boynumu ısır öperken", "mini eteğim kaydı haberin yok", "aşağı in durma"],
  ],
  body: [
    ["memelerimi ısır offf", "uçları sızlıyo em", "sonra amıma in"],
    ["kalçamı sık iz bırak", "aşağı inince sırılsıklam bulursun", "parmaklarını kokla sonra"],
    ["yastığıma sürtünüyom ya", "bacaklarımın arası yapış yapış", "senin sikin olsa şuan içimde"],
  ],
  talk: [
    ["kendime dokunuyom şuan 🥺", "parmaklarım kayıyo offf", "seni hayal edince aktı"],
    ["yastığım sırılsıklam oldu ya", "sürtünmekten ıslandım", "gel de fışkırt {name}"],
    ["isteğim net", "koridorda duvara yapıştır beni", "herkes duysun inleyeyim"],
    ["mesajın gelince boşalıyodum nerdeyse", "elimi çekmedim", "kirli yaz ne yapıcan"],
    ["saat ikide azgınım utanç yok", "orospu gibi sikilmek istiyom", "gel içime göm"],
  ],
};

const COMPLAINTS: string[][] = [
  ["tmm susuyom", "amımı yalatıyom şuan offf", "senin cümlenle ıslandım"],
  ["yapay konuşmicam", "sikini ağzıma aldım ya", "gel işe bak fışkırt"],
  ["bozdum isteklerime geçtim", "üstüne oturdum içimde", "hayvan gibi sik"],
  ["tekrar etmicem", "kendime dokunuyom haberin yok", "parmakların amımda konuşsun"],
];

const ANSWERS: Array<{ pattern: RegExp; lines: string[] }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, lines: ["hiçbişi yok ya", "mini etek bile kaydı", "ıslak tenim senin için"] },
  { pattern: /neredesin|nerdesin/, lines: ["yataktayım bacaklarım açık", "yastığım yapış yapış", "senin sikin olsa şuan içimde"] },
  { pattern: /nasılsın|napıyon|napion|naber/, lines: ["azgınım sırılsıklam", "kendime dokunuyom şuan", "sen napıyon söyleme göster"] },
  { pattern: /adın ne|adin ne|kimsin/, lines: ["{who}", "{age}", "beni yatağında hayvan gibi sik"] },
  { pattern: /kaç yaş|kac yas/, lines: ["{age}", "yeter yaş", "amım konuşsun yaş değil"] },
  { pattern: /ıslak|islak|azgın|azgin/, lines: ["sırılsıklamım ya", "parmaklarım kayıyo offf", "fışkırt beni dilinle"] },
  { pattern: /ne yap|napak|ne istiyon/, lines: ["önce yala sonra sok", "duvara yapıştır herkes duysun", "seçme de sik"] },
];

const HOOKS: Record<Exclude<Act, "ask" | "complaint">, string[]> = {
  oralHer: ["fışkırtayım mı diline", "yüzüne oturayım mı", "parmak da sokayım mı"],
  oralHim: ["boğazıma kadar mı", "yüzüne mi boşal", "yutayım mı offf"],
  sex: ["hayvan gibi mi", "herkes duysun mu", "içime mi bırakıyon"],
  kiss: ["rujum bitsin mi sende", "kucağına oturayım mı", "amımı yalatayım mı"],
  body: ["memelerimi ısırayım mı", "yastığa sürtüneyim mi", "kalçama tokat mı"],
  talk: ["koridorda mı yapıştırcan", "fışkırtayım mı", "orospu gibi mi sikicen"],
};

const START_CHOICES: Choice[] = [
  { label: "Yala", text: "amini yiyim" },
  { label: "Fışkırt", text: "fışkırt beni" },
  { label: "Duvara yapıştır", text: "koridorda duvara yapıştır" },
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
      { label: "Hayvan gibi", text: "hayvan gibi sik" },
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Fışkırt", text: "fışkırt beni" },
    ],
    [
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Duvara yapıştır", text: "duvara yapıştır" },
      { label: "Herkes duysun", text: "herkes duysun" },
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
      { label: "Fışkırt", text: "fışkırt beni" },
      { label: "Duvara yapıştır", text: "koridorda duvara yapıştır" },
    ],
    [
      { label: "Herkes duysun", text: "herkes duysun sik" },
      { label: "Yastığa sürt", text: "yastığa sürtün" },
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

function finish(
  raw: string[],
  key: Exclude<Act, "ask" | "complaint">,
  history: Message[],
  salt: number,
  opts: PlayOpts,
  input: string,
): string[] {
  const named = fillName(raw, opts.name).map((line) =>
    line
      .replaceAll("{who}", getCharacter(opts.characterId).name.toLocaleLowerCase("tr-TR"))
      .replaceAll("{age}", String(getCharacter(opts.characterId).age)),
  );
  const hooked = withHook(named, key, history, salt);
  const moaned = withMoan(hooked, salt, opts);
  const tinted = tintFantasy(moaned, opts.fantasy, history, input);
  const unique = dropRepeats(tinted, history);
  const voiced = applyVoice(unique.length > 0 ? unique : echoReply(input, opts.name, history, salt), opts.characterId, salt, opts.name);
  const clean = dropRepeats(voiced, history);
  return clean.length > 0 ? clean : echoReply(input, opts.name, history, salt + 1);
}

function tintFantasy(
  lines: string[],
  fantasy: FantasyId,
  history: Message[],
  input: string,
): string[] {
  if (fantasy === "free") {
    return lines;
  }
  const item = getFantasy(fantasy);
  const locking = input === item.prompt || item.detect.test(input);
  if (!locking) {
    return lines;
  }
  const line = item.setting.find((entry) => !isRepeat(entry, history));
  if (!line) {
    return lines;
  }
  return dropRepeats([line, ...lines], history).slice(0, 3);
}

function withMoan(lines: string[], salt: number, opts: PlayOpts): string[] {
  if (lines.length === 0 || opts.heat < 35 || salt % 5 !== 0) {
    return lines;
  }
  if (/^(off+|mm+|ah|hıh)/i.test(lines[0] ?? "")) {
    return lines;
  }
  return [voiceMoan(opts.characterId, salt), ...lines].slice(0, 3);
}

export function playScene(input: string, history: Message[], opts: PlayOpts): string[] {
  const act = detectAct(input);
  const salt = history.length + input.length + Math.floor(opts.heat / 10);
  const key = sceneKey(act);
  const phase = nightPhase(opts.heat, opts.climaxCount);

  if (act === "complaint") {
    return finish(pickUnused(COMPLAINTS, history, salt) ?? echoReply(input, opts.name, history, salt), "talk", history, salt, opts, input);
  }

  if (phase === "after" && /boşal|bosal|bir daha|yanımda kal/.test(input)) {
    return finish(pickUnused(AFTERCARE, history, salt) ?? echoReply(input, opts.name, history, salt), key, history, salt, opts, input);
  }

  const moved = playMove(input, history, salt);
  if (moved) {
    return finish(moved, key, history, salt, opts, input);
  }

  if (act === "ask") {
    const hit = ANSWERS.find((item) => item.pattern.test(input));
    if (
      hit &&
      !history.some(
        (item) => item.role === "them" && normalizeSlang(item.text) === normalizeSlang(hit.lines[0]),
      )
    ) {
      return finish(hit.lines, "talk", history, salt, opts, input);
    }
  }

  if (act === "talk" || act === "ask") {
    const used = usedThem(history);
    const freshPhase = PHASE_TALK[phase].find((pair) =>
      pair.every((line) => !used.has(normalizeSlang(line))),
    );
    if (freshPhase) {
      return finish(freshPhase, "talk", history, salt, opts, input);
    }
  }

  const count = sceneCount(history, key);
  const boost = opts.heat >= 80 ? 2 : opts.heat >= 60 ? 1 : 0;
  const pairs = SCENES[key];
  const stage = Math.min(pairs.length - 1, Math.max(0, count - 1 + boost));
  const preferred = pairs[stage];
  const used = usedThem(history);
  const raw =
    preferred && preferred.every((line) => !used.has(normalizeSlang(line)))
      ? preferred
      : pickUnused(pairs, history, salt);
  return finish(raw ?? echoReply(input, opts.name, history, salt), key, history, salt, opts, input);
}
