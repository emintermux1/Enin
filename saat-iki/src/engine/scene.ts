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
    pattern: /aynı|ayni|berbat|tekrar|sıkıldım|sikildim|bozma|kes sesini|hep aynı|hep ayni/i,
  },
  {
    act: "oralHer",
    pattern: /am(ı|i|ini|ını)?\s*yi|yala|amcık|amini|amını|amın|klitor|dil(in)?i\s*(sok|koy)|yiyim|yiyeyim/i,
  },
  {
    act: "oralHim",
    pattern: /ağzına\s*al|agzina\s*al|sakso|em(e|eyim|iyor)|sikini\s*al|aletini|boğaz|bogaz/i,
  },
  {
    act: "sex",
    pattern: /sik|sok|içine|icine|içinde|icinde|sikiş|sikis|boşal|bosal|orgazm|sert|göt|got/i,
  },
  {
    act: "kiss",
    pattern: /öp|opüc|dudak|dilini\s*ver|boyn/i,
  },
  {
    act: "body",
    pattern: /göğüs|gogus|kalça|kalca|bacak|belin|memel|götün|gotun/i,
  },
  {
    act: "ask",
    pattern:
      /\?|ne giy|neredesin|nerdesin|napıyon|napion|nasılsın|nasilsin|adın ne|adin ne|kaç yaş|kac yas|kimsin|ıslak|islak/i,
  },
];

const SCENES: Record<Exclude<Act, "ask" | "complaint">, string[]> = {
  oralHer: [
    "Dizlerimi açıyorum. Dilini amıma bas, ılık. İlk yalamada belim kalktı, nefesim kesildi.",
    "Klitorisimi em. İki parmağını da kaydır, kıvır. Islak ses geliyor, saklamıyorum.",
    "Bacaklarımı omuzlarına alıyorum. Daha derin yala, kaçırma. Kalçam titriyor.",
    "Yüzüne oturdum. Dilini çıkarayım diye değil, daha çok isteyeyim diye. Bırakma.",
    "Parmakların içimde, dilin dışarıda. İkisini birden yap. Boşalmak üzereyim, durma.",
    "Orgaza yaklaştım. Dilini çekme. Adımı söyleme, yala. Bittiğinde de bir tur daha.",
  ],
  oralHim: [
    "Dizlerimin üstüne indim. Sikinin başını ağzıma alıyorum, dilimi yavaşça çevirerek, sana bakarak.",
    "Daha derine. Tükürük aktı, salmıyorum. Boğazıma kadar, gözlerim dolu, bırakmıyorum.",
    "Saçımı tut. Ritmi sen ver. Dilimi damarına sürüp tekrar yutuyorum.",
    "İki elimi de kullanıyorum. Ağzım dolu, ses çıkarıyorum bilerek. Sertleşmeni hissediyorum.",
    "Çıkarıp başını yalıyorum, sonra tekrar boğazıma. Kesme. Boşalacaksan söyle, yutacağım.",
    "Hâlâ ağzımdayım. Daha yavaş değil. Daha ıslak. Bitene kadar kalkmıyorum.",
  ],
  sex: [
    "Sırtüstü uzandım, bacaklarım açık. Ucun ıslaklığıma değdi. Kaydır, sok, acele etme — sonra boz.",
    "İçimdeyim. İlk harekette sesim çıktı. Kalçamı tut, daha sert. Çıkarma.",
    "Tempo tuttun. Her girişte isminle değil, nefessimle cevap veriyorum. Daha derine.",
    "Üstüne geçtim. Sikini dibine kadar alıyorum, yavaş değil. Göğüslerim yüzünde.",
    "Arkadan. Belimi kır, saçımı çek. İçimde vur, bırakma. Yatak sesi karıştı.",
    "Boşalma. Sıkıyorum, bırakmıyorum. Bitince de içinde kal, bir tur daha var.",
  ],
  kiss: [
    "Öpüyorum. Alt dudağını çekiyorum, dilimi veriyorum. Acele yok, bırakmak da yok.",
    "Boynuna indim. Dişledim. İz bırakıyorum, sonra kulağına nefes.",
    "Ağzın benim. Öpücük ısınma bitti. Dilin başka yere de gidecek, durmuyorum.",
  ],
  body: [
    "Göğsümü avuçla. Sık, başparmağın uçta. İnce kumaş zaten durmuyordu, ben de durmuyorum.",
    "Kalçamı iki elinle çek. Sıkı. Oradan aşağı kay, ıslaklığımı bul, söyleme — yap.",
    "Bacağımı omzuna aldım. Dizimin içi senin. Öp, yala, yukarı çık.",
  ],
  talk: [
    "Gel buraya. Ellerim belinde, ağzım kulağında. Konuşmayı kesip işe geçiyorum.",
    "Seni yatağa çekiyorum. Üstümdesin. Ne istediğini biliyorum, uyguluyorum.",
    "Telefonu bırakma. Bir elimi içeri aldım, diğerini ağzına. Devam.",
  ],
};

const COMPLAINTS = [
  "Tamam. Soru yok. Ağzına alıyorum — sıcak, ıslak, bakarak. Saçımı tut.",
  "Kesiyorum o lafları. Dilimi amıma değil, sikine veriyorum. Derine. Şimdi.",
  "Anlaşıldı. Tekrar etmiyorum. Üstüne geçip içime alıyorum. Tut belimi.",
];

const ANSWERS: Array<{ pattern: RegExp; line: string }> = [
  { pattern: /ne giy|giyiyon|üzerinde/, line: "Üstümde bir şey yok. Çarşaf belimde. Göğsüm açık, bacaklarım aralık." },
  { pattern: /neredesin|nerdesin|nerdeysin/, line: "Yatağımdayım. Loş. Telefon yüzümde, diğer elimi kullanıyorum." },
  { pattern: /nasılsın|napıyon|napion|naber/, line: "Islağım. Konuşacak halim yok, yapacak halim var. Gel." },
  { pattern: /adın ne|adin ne|kimsin/, line: "Leyla. 27. Seninle yatağa girmek için açıldım, sohbet için değil." },
  { pattern: /kaç yaş|kac yas/, line: "27. Yetişkin. Konu bu değil. Ellerini koy." },
  { pattern: /ıslak|islak|azgın|azgin/, line: "Parmaklarım kayıyor. Islak ses var. Gel, kontrol et." },
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

function pickLine(lines: string[], history: Message[], stage: number): string {
  const used = new Set(history.filter((item) => item.role === "them").map((item) => item.text));
  const preferred = lines[stage];
  if (preferred && !used.has(preferred)) {
    return preferred;
  }
  return lines.find((line) => !used.has(line)) ?? preferred ?? lines[0] ?? "";
}

export function playScene(input: string, history: Message[], name: string): string[] {
  const act = detectAct(input);
  if (act === "complaint") {
    return [pickLine(COMPLAINTS, history, 0).replaceAll("{name}", name)];
  }
  if (act === "ask") {
    const hit = ANSWERS.find((item) => item.pattern.test(input));
    if (hit && !history.some((item) => item.role === "them" && item.text === hit.line)) {
      return [hit.line];
    }
  }
  const key: Exclude<Act, "ask" | "complaint"> = act === "ask" ? "talk" : act;
  const lines = SCENES[key];
  const count = sceneCount(history, act === "ask" ? "talk" : act);
  const stage = Math.min(lines.length - 1, Math.max(0, count - 1));
  return [pickLine(lines, history, stage).replaceAll("{name}", name)];
}
