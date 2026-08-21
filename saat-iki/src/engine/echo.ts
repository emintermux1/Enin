import type { Message } from "../types";
import { dropRepeats, fillName } from "./pool";

const ACK: Array<{ pattern: RegExp; lines: string[][] }> = [
  {
    pattern: /yata[gğ]|yataga|yatak/i,
    lines: [
      ["yatağa çekiyom seni", "çarşafı boynuma doladım", "üstüme gel"],
      ["yatağa geçtik", "yastığa yüzümü gömdüm", "sok artık"],
      ["yatakta devam ya", "bacaklarım omuzunda", "oda burası duş değil"],
    ],
  },
  {
    pattern: /sonra|devam/i,
    lines: [
      ["şimdi devam", "çekmedim bak", "daha derine gel"],
      ["bekletmem", "amım hala açık", "üstüne geç"],
    ],
  },
  {
    pattern: /üstün|bin/,
    lines: [
      ["üstüne oturdum", "dibine kadar aldım", "kalçamı tut"],
      ["biniyom bak", "hepsi içimde", "tempo bende"],
    ],
  },
  {
    pattern: /yala|yiyim|amini/,
    lines: [
      ["dilin amımda", "bacaklarım titriyo", "çekme"],
      ["yüzün orda", "ıslandım durma", "daha bas"],
    ],
  },
  {
    pattern: /ağzına|agzina|yut|sakso/,
    lines: [
      ["ağzıma aldım", "boğazıma kadar", "saçımı tut"],
      ["yutuyom bak", "çıkarmıyom", "sesini duyayım"],
    ],
  },
  {
    pattern: /parmak/,
    lines: [
      ["parmağın girdi", "kayıyo içeri", "bir tane daha"],
    ],
  },
  {
    pattern: /arkadan/,
    lines: [
      ["arkamı çevirdim", "yüzüm yastıkta", "vur"],
    ],
  },
  {
    pattern: /boşal|bosal/,
    lines: [
      ["içime bırak", "sıkıyom seni", "çıkarma"],
    ],
  },
  {
    pattern: /duş|dus/,
    lines: [
      ["duşa çekiyom", "su üstümüzde", "duvara yapış"],
    ],
  },
  {
    pattern: /araba|koltuk/,
    lines: [
      ["koltuğa oturdum üstüne", "kemer sende", "salla beni"],
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
        clip.length > 2 ? `öyle ${clip} diyosun` : "duydum ya",
        "tam onu yapıyom bak",
        "çekmiyorum {name}",
      ],
      name,
    ),
    history,
  );
  return woven.length > 0 ? woven : ["duydum", "devam ediyom"];
}
