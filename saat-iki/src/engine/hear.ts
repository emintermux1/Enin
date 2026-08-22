import { getCharacter } from "../data/characters";
import type { Character, CharacterId, PlayOpts } from "../types";
import { normalizeSlang } from "./slang";

const NAME_ASK =
  /ism(in|i)|ismin|adın|adin|adın ne|adin ne|kimsin|sen kim|adın ney|ismi ne|ismin ne/i;
const AGE_ASK = /kaç yaş|kac yas|yaşın|yasin|yaşın kaç/i;
const WHERE_ASK = /neredesin|nerdesin|nerdeysin|nerde sin/i;
const WEAR_ASK = /ne giy|giyiyon|üzerinde|üstünde ne|ne var üst/i;
const HOW_ASK = /nasılsın|nasilsin|napıyon|napion|naber|ne yapıyosun|ne yapiyosun/i;

function aliasesOf(person: Character): string[] {
  const bits = [person.name, person.id, ...person.name.split(/\s+/)];
  return bits.map((bit) => normalizeSlang(bit)).filter((bit) => bit.length >= 3);
}

function calledByName(input: string, person: Character): boolean {
  const n = normalizeSlang(input.trim().replace(/[?!.,]/g, ""));
  return aliasesOf(person).some((alias) => n === alias);
}

function nameCloser(id: CharacterId): string {
  switch (id) {
    case "asya":
      return "asya benim {name} gel içime hayvan gibi";
    case "kim":
      return "cutie kim benim utansam da ıslanıyom";
    case "elif":
      return "lila benim geç kalma";
    case "defne":
      return "sera benim isteğimi dinle";
    case "yasemin":
      return "duru benim konuşma gel";
    case "melis":
      return "vera benim şimdi dinle";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function hearReply(input: string, opts: PlayOpts): string[] | null {
  const person = getCharacter(opts.characterId);
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  if (NAME_ASK.test(raw) || NAME_ASK.test(normalizeSlang(raw))) {
    return [
      `${person.name.toLocaleLowerCase("tr-TR")} ${person.age}`,
      nameCloser(opts.characterId),
    ];
  }

  if (calledByName(raw, person)) {
    return [
      `${aliasesOf(person)[0] ?? person.name.toLocaleLowerCase("tr-TR")} evet ben`,
      `duydum {name} söyle ne istiyon`,
    ];
  }

  if (AGE_ASK.test(raw)) {
    return [String(person.age), nameCloser(opts.characterId)];
  }

  if (WHERE_ASK.test(raw)) {
    return [
      opts.characterId === "kim" ? "yatağımdayım kamera kapalı" : "yataktayım bacaklarım açık",
      "yanım boş {name}",
      "sen olsan şuan içimde",
    ];
  }

  if (WEAR_ASK.test(raw)) {
    return [
      opts.characterId === "kim" ? "tişört var külot yok" : "hiçbişi yok ya",
      "ıslak tenim senin için",
    ];
  }

  if (HOW_ASK.test(raw)) {
    return [
      opts.characterId === "kim" ? "ıslandım utandım 🥺" : "azgınım sırılsıklam",
      "sen yazınca daha bozuluyom {name}",
    ];
  }

  return null;
}
