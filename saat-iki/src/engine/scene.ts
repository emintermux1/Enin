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
      /sik|sok|içine|icine|içinde|icinde|üstüm|ustum|üstün|ustun|arkadan|sikiş|sikis|boşal|bosal|sert|göt|got|parmak|yata[gğ]|yataga/i,
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
    ["offf dilin amıma değdi", "bacaklarım titriyo açılıyo", "ıslandım durma yala"],
    ["mm orasıı", "ellerim saçında seni bastırıyom", "sesim çıkıyo utanmıcam"],
    ["yüzün bacaklarımın arasında", "kalçam oynuyo diline", "çekme offf"],
    ["boşalıcam diline nerdeyse", "uyluklarım kilitlendi", "biraz daha {name}"],
    ["klitorise bas offf", "yastığı ısırıyom", "parmak da sok yalarken"],
    ["amım senin dilinde eriyo", "fantezim buydu ya", "yüzüne otururum izin ver"],
  ],
  oralHim: [
    ["mm ağzıma aldım offf", "sıcaklığı dilimde eridi", "çıkarmıyom bakıyom sana"],
    ["boğazıma kadar kaydı", "gözlerim doldu salmıycam", "tükürük aktı hoşuma gidiyo"],
    ["ellerim taşaklarında", "ağzım inip çıkıyo", "sesini duyayım {name}"],
    ["diline doladım ucunu", "emiyorum yavaş sonra derin", "saçımı tut kullan"],
    ["ağzım doldu ya", "yutcam gibi oldum offf", "kalkmıycam senden"],
    ["sikini öpüyom önce", "sonra boğazıma alıyom", "yutmamı istiyon dimi"],
  ],
  sex: [
    ["içime girdi offf", "ıslağım seni yuttu", "biraz öyle kal dolu olayım"],
    ["her vuruşta amım şapırdıyo", "belimi kır bak", "daha sert sik beni"],
    ["üstündeyim memelerim sallanıyo", "dibine oturdum ya", "kalçamla ezicem seni"],
    ["arkadan derin offf", "yüzüm yastıkta inliyom", "saçımı çek vur"],
    ["içimde boşalıcam az kaldı", "amım seni sıkıyo", "çıkarma {name} bırak içime"],
    ["bacaklarım omuzunda", "bu açıda dibine kadar", "cam açık komşu duysun"],
    ["fantezi gibi ya", "sen sikince aklım gidiyo", "sabaha kadar böyle kal"],
  ],
  kiss: [
    ["öpüşürken amım ıslandı", "dilini emiyom ya", "boynuna kayıcam ısırarak"],
    ["dudağın tatlı offf", "kulağına fısıldıyom ne istiyooum", "ellerin külotumun içinde olsun"],
    ["öpücük yetmez", "dilin ağzımda sikin bende olsun", "aşağı in durma"],
  ],
  body: [
    ["memelerim keskin senin yüzünden", "uçları sızlıyo offf", "ağzını koy em"],
    ["kalçamı gezdir ellerinle", "aşağı inince ıslak bulursun", "parmaklarını kokla sonra"],
    ["bacaklarımın arası sırılsıklam", "uyluğuma iz bırak", "amımı sen aç"],
  ],
  talk: [
    ["yatağımdayım çıplağım", "parmaklarım amımda offf", "seni hayal edince aktı"],
    ["külotum bir yana kaydı ya", "ıslak izi bacaklarımda", "ne yapardın şuan söyle kirli"],
    ["fantezi kuruyom {name}", "sen otelde camın önünde arkadasın", "ben inliyom şehre bakarak"],
    ["mesajın gelince boşalıyodum nerdeyse", "elimi çekmedim", "sen devam ettir ağzınla"],
    ["saat ikide azgınım utanç yok", "memelerim açık sızlıyo", "gel de içime göm"],
  ],
};

const COMPLAINTS: string[][] = [
  ["tmm susuyom", "amını yalıyorum şuan offf", "bakıyom sana çıkarmıyom"],
  ["yapay konuşmicam", "sikini ağzıma aldım ya", "gel işe bak"],
  ["bozdum fanteziye geçtim", "üstüne oturdum içimde", "çekme sik"],
  ["tekrar etmicem", "ıslandım haberin yok", "parmakların amımda konuşsun"],
];

const ANSWERS: Array<{ pattern: RegExp; lines: string[] }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, lines: ["hiçbişi yok ya", "külot bile kaydı", "ıslak tenim senin için"] },
  { pattern: /neredesin|nerdesin/, lines: ["yataktayım bacaklarım açık", "yanım boş offf", "senin sikin olsa şuan içimde"] },
  { pattern: /nasılsın|napıyon|napion|naber/, lines: ["azgınım sırılsıklam", "parmaklarım amımda", "sen napıyon söyleme göster"] },
  { pattern: /adın ne|adin ne|kimsin/, lines: ["{who}", "{age}", "seni yatağımda siktirmek istiyom"] },
  { pattern: /kaç yaş|kac yas/, lines: ["{age}", "yeter yaş", "amım konuşsun yaş değil"] },
  { pattern: /ıslak|islak|azgın|azgin/, lines: ["sırılsıklamım ya", "parmaklarım kayıyo offf", "dilini koysan akar"] },
  { pattern: /ne yap|napak|ne istiyon/, lines: ["önce yala sonra sok", "fantezim kirli", "seçme de sik"] },
];

const HOOKS: Record<Exclude<Act, "ask" | "complaint">, string[]> = {
  oralHer: ["yüzüme oturayım mı", "parmak da sokayım mı", "boşalayım diline mi"],
  oralHim: ["boğazıma kadar mı", "yüzüne mi boşal", "yutayım mı offf"],
  sex: ["içime mi bırakıyon", "daha sert mi", "üstüne binip ezeyim mi"],
  kiss: ["külotumu kaydırayım mı", "amımı yalatayım mı", "boynuna mı iz bırakayım"],
  body: ["memelerimi emeyim mi", "amımı göstereyim mi", "kalçama tokat mı"],
  talk: ["kirli fantezi mi kuralım", "amımı mı yalatayım", "içine mi alayım seni"],
};

const START_CHOICES: Choice[] = [
  { label: "Yala", text: "amini yiyim" },
  { label: "Ağzına al", text: "ağzına al" },
  { label: "Fantezi", text: "kirli fantezi kur" },
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
      { label: "Fantezi", text: "kirli fantezi kur" },
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
