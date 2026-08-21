import type { FantasyId } from "../types";

export type Fantasy = {
  id: FantasyId;
  label: string;
  prompt: string;
  detect: RegExp;
  setting: string[];
};

export const FANTASIES: Fantasy[] = [
  {
    id: "free",
    label: "Serbest",
    prompt: "serbest kalalım",
    detect: /serbest/,
    setting: [],
  },
  {
    id: "window",
    label: "Cam",
    prompt: "camın önünde arkadan",
    detect: /camın|camda|pencere|balkon/,
    setting: ["perdeyi çekmedim ya", "karşı görsün umurumda değil"],
  },
  {
    id: "shower",
    label: "Duş",
    prompt: "duşta duvara yapıştır",
    detect: /duş|dus|küvet/,
    setting: ["su üstümüzde sırılsıklamız", "duvar soğuk sırtım sıcak"],
  },
  {
    id: "morning",
    label: "Sabah",
    prompt: "sabah uyanır uyanmaz",
    detect: /sabah|uyan/,
    setting: ["gözlerim daha açılmadı", "sikin sürtünsün uyanayım"],
  },
  {
    id: "car",
    label: "Araba",
    prompt: "arabada üstüne geçeyim",
    detect: /araba|koltuk|otopark/,
    setting: ["koltuk yatık ya", "kemer sende ben üstündeyim"],
  },
  {
    id: "jealous",
    label: "Kıskanç",
    prompt: "kıskandır beni sahiplen",
    detect: /kıskan|kiskan|sahiplen|benimsin/,
    setting: ["başkası yazmasın", "sadece senin olayım bu gece"],
  },
  {
    id: "slow",
    label: "Yavaş",
    prompt: "yavaş beklet",
    detect: /yavaş|beklet|oyal/,
    setting: ["acele yok ucundan", "yalvarırsan sokarım"],
  },
  {
    id: "face",
    label: "Yüz",
    prompt: "yüzüne oturayım",
    detect: /yüzüne otur|yuzune/,
    setting: ["dilini göm", "nefesin amımda"],
  },
  {
    id: "inside",
    label: "İçine",
    prompt: "içinde boşal",
    detect: /içine bırak|içinde boşal|icine birak/,
    setting: ["hepsini içimde bırak", "çıkarma bu gece"],
  },
  {
    id: "hall",
    label: "Koridor",
    prompt: "koridorda duvara yapıştır",
    detect: /koridor|duvara yapış|holde|asansör|asansor/,
    setting: ["koridordayız kapı aralık", "duvara yapıştır kontrolümü kaybedeyim"],
  },
  {
    id: "public",
    label: "Herkes",
    prompt: "herkes duysun sik",
    detect: /herkes|duysun|sokakta|plaj|denizde|umuma/,
    setting: ["sesimi kesmicekler ya", "herkes duysun istiyom"],
  },
];

export function getFantasy(id: FantasyId): Fantasy {
  const found = FANTASIES.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown fantasy: ${id}`);
  }
  return found;
}

export function fantasyLabel(id: FantasyId): string {
  return getFantasy(id).label;
}

export function detectFantasy(input: string): FantasyId | null {
  for (const item of FANTASIES) {
    if (item.id === "free") {
      continue;
    }
    if (item.detect.test(input)) {
      return item.id;
    }
  }
  if (/serbest/.test(input)) {
    return "free";
  }
  return null;
}
