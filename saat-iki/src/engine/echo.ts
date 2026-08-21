import type { Message } from "../types";
import { dropRepeats, fillName } from "./pool";

const ACK: Array<{ pattern: RegExp; lines: string[][] }> = [
  {
    pattern: /yata[gğ]|yataga|yatak/i,
    lines: [
      ["yatağa çekiyom seni", "yastığım sırılsıklam ya", "üstüme gel hayvan gibi"],
      ["yatağa geçtik", "yüzümü yastığa gömdüm", "sok artık durma"],
      ["yatakta devam ya", "bacaklarım omuzunda", "oda burası duş değil"],
    ],
  },
  {
    pattern: /sonra|devam/i,
    lines: [
      ["şimdi devam", "çekmedim bak", "daha derine gel"],
      ["bekletmem", "amım hala açık", "üstüne geç fışkırt"],
    ],
  },
  {
    pattern: /üstün|bin/,
    lines: [
      ["üstüne oturdum", "sikine binmeyi bayılıyorum", "kalçamı tut"],
      ["biniyom bak", "hepsi içimde", "tempo bende inmicem"],
    ],
  },
  {
    pattern: /yala|yiyim|amini/,
    lines: [
      ["dilin amımda", "bacaklarım titriyo", "fışkırt beni durma"],
      ["yüzün orda", "ıslandım çekme", "daha bas {name}"],
    ],
  },
  {
    pattern: /ağzına|agzina|yut|sakso/,
    lines: [
      ["ağzıma aldım", "boğazıma kadar kullan", "saçımı tut"],
      ["yutuyom bak", "çıkarmıyom", "orospu gibi alıyom ya"],
    ],
  },
  {
    pattern: /parmak/,
    lines: [
      ["parmağın girdi", "kayıyo içeri offf", "bir tane daha kıvır"],
    ],
  },
  {
    pattern: /arkadan/,
    lines: [
      ["arkamı çevirdim", "yüzüm yastıkta", "tokatla vur"],
    ],
  },
  {
    pattern: /boşal|bosal/,
    lines: [
      ["içime bırak", "sıkıyom seni", "çıkarma hepsini istiyom"],
    ],
  },
  {
    pattern: /duş|dus/,
    lines: [
      ["duşa çekiyom", "su üstümüzde", "duvara yapış sik"],
    ],
  },
  {
    pattern: /araba|koltuk/,
    lines: [
      ["koltuğa oturdum üstüne", "etek kaydı", "salla beni"],
    ],
  },
  {
    pattern: /koridor|duvara/,
    lines: [
      ["duvara yapıştır beni", "kontrolümü kaybedeyim", "herkes duysun"],
    ],
  },
  {
    pattern: /fışkır|fiskir/,
    lines: [
      ["fışkırt beni offf", "yatağı ıslatayım", "çekme {name}"],
    ],
  },
  {
    pattern: /herkes|duysun/,
    lines: [
      ["sesimi kesme", "herkes duysun istiyom", "daha sert"],
    ],
  },
  {
    pattern: /yastık|yastik|sürtün/,
    lines: [
      ["yastığım yapış yapış", "sürtünüyom ya", "gel sen bitir"],
    ],
  },
  {
    pattern: /hayvan|orospu/,
    lines: [
      ["hayvan gibi sik", "beni kullan {name}", "utanmıcam"],
    ],
  },
];

export function echoReply(input: string, name: string, history: Message[], salt: number): string[] {
  const hit = ACK.find((item) => item.pattern.test(input));
  if (hit) {
    const fresh = hit.lines.filter((pair) => dropRepeats(pair, history).length === pair.length);
    const pair = (fresh.length > 0 ? fresh : hit.lines)[Math.abs(salt) % (fresh.length || hit.lines.length)];
    if (pair) {
      const clean = dropRepeats(fillName(pair, name), history);
      if (clean.length > 0) {
        return clean;
      }
    }
  }
  const clip = input.trim().toLocaleLowerCase("tr-TR").slice(0, 32);
  const woven = dropRepeats(
    fillName(
      [
        clip.length > 2 ? `öyle ${clip} de bana` : "duydum ya",
        "tam onu istiyom bak",
        "yap {name} çekme",
      ],
      name,
    ),
    history,
  );
  return woven.length > 0 ? woven : ["duydum", "istiyom onu yap"];
}
