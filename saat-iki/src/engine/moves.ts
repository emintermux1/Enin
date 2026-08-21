import type { Choice, Message } from "../types";
import { pickUnused } from "./pool";

export type MoveId =
  | "finger"
  | "ride"
  | "behind"
  | "faster"
  | "stay"
  | "cum"
  | "hair"
  | "swallow"
  | "deeper"
  | "breast"
  | "ass"
  | "neck"
  | "want"
  | "come"
  | "sit";

type Move = {
  id: MoveId;
  pattern: RegExp;
  lines: string[][];
  choices: Choice[];
};

const MOVES: Move[] = [
  {
    id: "finger",
    pattern: /parmak/,
    lines: [
      ["parmağın girdi of", "bacaklarım açıldı bak", "bir tane daha"],
      ["kayıyo içeri ya", "kalçam oynuyo durduramıycam", "eğilme durma"],
      ["ıslaklığımı sen buldun", "parmakların orda iyi duruyo", "dilini de koy"],
    ],
    choices: [
      { label: "Daha derine", text: "parmağını daha derine sok" },
      { label: "Yala da", text: "yala da durma" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "ride",
    pattern: /üstüm|üstüne geç|üstüne bin|bin üst/,
    lines: [
      ["üstüne geçiyom bak", "dibine oturdum ya", "ellerin belimde olsun"],
      ["titriyom üstünde", "kalçam dönüyo of", "meme ucumu ağzına al"],
      ["kendi tempom ya", "seni içimde eziyom", "tut kalçamı {name}"],
    ],
    choices: [
      { label: "Daha hızlı", text: "daha hızlı" },
      { label: "Memelerini em", text: "memelerini em" },
      { label: "Boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "behind",
    pattern: /arkadan|arkamı|dogg/,
    lines: [
      ["arkamı çevirdim ya", "yüzümü yastığa gömdüm", "tut saçımı"],
      ["arkadan girdin of", "sesim yastığa gidiyo", "daha vur"],
      ["belimi kırıyosun", "kalçam sende kaldı", "çekme {name}"],
    ],
    choices: [
      { label: "Saçını çek", text: "saçını çek" },
      { label: "Daha sert", text: "daha sert vur" },
      { label: "Boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "faster",
    pattern: /hızlı|sert\b|vur/,
    lines: [
      ["daha hızlı of", "yatak ses yapıyo bak", "kendimi tutamıyom"],
      ["öyle vur yaa", "bacaklarım kilitlendi", "adımı söyleme de böyle kal"],
      ["sertleştin içimde", "her vuruşta sesim çıkıyo", "durma lütfen"],
    ],
    choices: [
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Arkadan", text: "arkadan çevir" },
      { label: "Boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "stay",
    pattern: /içinde kal|çıkarma|çıkma/,
    lines: [
      ["içimde kal ya", "kıpırdama böyle", "doluyum seninle"],
      ["çıkarma lütfen", "nabzını içimde hissediyom", "biraz öyle dur"],
    ],
    choices: [
      { label: "Daha vur", text: "daha vur" },
      { label: "Boşal", text: "içinde boşal" },
      { label: "Bir daha", text: "bir daha içine sok" },
    ],
  },
  {
    id: "cum",
    pattern: /boşal|bosal|içine bırak|üstüne boşal/,
    lines: [
      ["içimde bırak ya", "hepsini istiyom", "sıkıyom seni"],
      ["boşal {name}", "ben de geldim nerdeyse", "çıkarma bu sefer"],
      ["üstüme de olur içime de", "sadece durma", "bakıyom yüzüne"],
    ],
    choices: [
      { label: "Bir daha", text: "bir daha içine sok" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
  },
  {
    id: "hair",
    pattern: /saç(ını|imi)?\s*(tut|çek)/,
    lines: [
      ["saçımı çektin of", "başım geri gitti", "daha sık"],
      ["ellerin saçımda iyi duruyo", "ağzım açıldı ya", "böyle tut"],
    ],
    choices: [
      { label: "Daha derine", text: "daha derine al" },
      { label: "Boğazına", text: "boğazına kadar al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "swallow",
    pattern: /\byut\b/,
    lines: [
      ["yutuyom bak", "boğazımdan kaydı", "hiçbirini kaçırmıycam"],
      ["ağzımda patladı ya", "yuttum {name}", "dilimle temizlerim"],
    ],
    choices: [
      { label: "Bir daha", text: "ağzına al bir daha" },
      { label: "Sok", text: "içine sok" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "deeper",
    pattern: /derine|boğaz|bogaz/,
    lines: [
      ["daha derine kaçtı ya", "gözlerim doldu salmıycam", "boğazım zonkluyo"],
      ["nefesim kesildi", "ellerin saçımda", "çıkarma böyle kal"],
    ],
    choices: [
      { label: "Saçını tut", text: "saçını tut" },
      { label: "Yut", text: "yut" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "breast",
    pattern: /meme|göğüs|gogus|göğs/,
    lines: [
      ["memelerim keskinleşti ya", "ağzın orda dursun", "dilini gezdir"],
      ["ellerin göğsümde of", "askı zaten durmuyodu", "sık biraz"],
    ],
    choices: [
      { label: "Sık", text: "memelerini sık" },
      { label: "Aşağı in", text: "aşağı in" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "ass",
    pattern: /kalça|kalca|götün|gotun|götünü|popo/,
    lines: [
      ["kalçamı sıktın mı aklım gidiyo", "ellerin orda kalsın", "aşağı inersen söylemem"],
      ["tokatla istersen", "titredi ya", "ıslaklığımı sen bul"],
    ],
    choices: [
      { label: "Sık", text: "kalçasını sık" },
      { label: "Arkadan", text: "arkadan" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "neck",
    pattern: /boyn|ısır/,
    lines: [
      ["boynuma geldin ya", "dişin değdi of", "orada iz bırak"],
      ["kulağıma nefesin değdi", "bacaklarım çözüldü", "aşağı kay"],
    ],
    choices: [
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "sit",
    pattern: /yüzüne otur|yuzune otur/,
    lines: [
      ["yüzüne oturdum ya", "dilini kaydır", "ellerin belimde"],
      ["bacaklarım omzunda", "nefesin orda of", "çekme"],
    ],
    choices: [
      { label: "Yala", text: "durma yala" },
      { label: "Parmak da", text: "parmak da sok" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "want",
    pattern: /istiyorum|istiyom|özledim|kaçır|sikicem|sikecem/,
    lines: [
      ["ben de istiyom ya", "ellerim kayıyo haberin yok", "gel burda ol"],
      ["özletme {name}", "çıplağım şuan", "yazma da durma"],
    ],
    choices: [
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "come",
    pattern: /\bgel\b|buraya|yanına|yatağa/,
    lines: [
      ["gelsene ya", "yanım boş bak", "kapıyı açık bırakırım"],
      ["burda olsan ne yapardın biliyon mu", "söyleme göster", "ellerin nerde olsun"],
    ],
    choices: [
      { label: "Öp", text: "öp beni" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Sok", text: "içine sok" },
    ],
  },
];

export function detectMove(input: string): Move | null {
  for (const item of MOVES) {
    if (item.pattern.test(input)) {
      return item;
    }
  }
  return null;
}

export function playMove(input: string, history: Message[], salt: number): string[] | null {
  const move = detectMove(input);
  if (!move) {
    return null;
  }
  return pickUnused(move.lines, history, salt);
}

export function choicesForMove(input: string): Choice[] | null {
  return detectMove(input)?.choices ?? null;
}
