const LETTER = "a-zA-ZçğıöşüÇĞİÖŞÜâîûÂÎÛ";
const VOWELS = "aeıioöuüAEIİOÖUÜâîûÂÎÛ";
const VOWEL_TAIL = new RegExp(`([${VOWELS}])([^${VOWELS}\\s]*)$`, "u");
const CONSONANT_TAIL = /([nmkryğNMKRYĞ])$/u;
const WORD_EDGE = `[^${LETTER}]`;

const WORD_SLANG: Array<{ word: string; forms: string[] }> = [
  { word: "ya", forms: ["yaaa", "yaaaa"] },
  { word: "of", forms: ["offf", "offfff"] },
  { word: "off", forms: ["offf", "offfff"] },
  { word: "yok", forms: ["yoook", "yokkk"] },
  { word: "bak", forms: ["bakkk", "baaak"] },
  { word: "durma", forms: ["durmaaa", "durmaaaa"] },
  { word: "lütfen", forms: ["lütfeeen", "lütfeeenn"] },
  { word: "şimdi", forms: ["şimdiii", "şimdiiii"] },
  { word: "mm", forms: ["mmmm", "mmmmm"] },
  { word: "tmm", forms: ["tmmm", "tmmmm"] },
];

const TAILS = [" yaaa", " offff", " bakkk"];

export function normalizeSlang(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/([aeıioöuüâîû])\1+/g, "$1")
    .replace(/([bcçdfgğhjklmnprsştvyzf])\1+/g, "$1");
}

function skipLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 2 || /^\d+$/.test(trimmed)) {
    return true;
  }
  return !/\s/.test(trimmed) && trimmed.length <= 5 && !/^(ya|of+|yok|bak|tmm|mm)$/i.test(trimmed);
}

function alreadyLong(text: string): boolean {
  return /([aeıioöuüâîû])\1{2,}|([bcçdfgğhjklmnprsştvyzf])\2{2,}/i.test(text);
}

function lastWord(text: string): string {
  const parts = text.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function stretchVowelTail(text: string, extra: number): string {
  return text.replace(VOWEL_TAIL, (_all, vowel: string, rest: string) => {
    return `${vowel}${vowel.repeat(extra)}${rest}`;
  });
}

function stretchConsonantTail(text: string, extra: number): string {
  const word = lastWord(text);
  if (word.length < 2 || word.length > 7 || !CONSONANT_TAIL.test(word)) {
    return stretchVowelTail(text, extra);
  }
  return text.replace(CONSONANT_TAIL, (letter) => `${letter}${letter.repeat(extra)}`);
}

function wordPattern(word: string): RegExp {
  return new RegExp(`(^|${WORD_EDGE})(${word})(?=${WORD_EDGE}|$)`, "gi");
}

function swapSlangWords(text: string, salt: number): string {
  let next = text;
  for (const item of WORD_SLANG) {
    const pattern = wordPattern(item.word);
    if (!pattern.test(next)) {
      continue;
    }
    const form = item.forms[Math.abs(salt) % item.forms.length] ?? item.forms[0];
    next = next.replace(wordPattern(item.word), (_all, edge: string) => `${edge}${form}`);
  }
  return next;
}

export function slangify(text: string, salt: number, index: number, total: number): string {
  if (skipLine(text)) {
    return text;
  }

  const last = index === total - 1;
  const roll = Math.abs(salt * 17 + index * 31 + text.length * 13) % 10;

  if (!last && roll >= 4) {
    return text;
  }
  if (last && roll >= 8) {
    return text;
  }

  const swapped = swapSlangWords(text, salt + index);
  if (swapped !== text && (roll <= 4 || alreadyLong(swapped))) {
    return swapped;
  }

  let next = swapped;
  if (alreadyLong(next)) {
    return next;
  }

  const word = lastWord(next);
  const named =
    word.length >= 3 && word[0] === word[0]?.toLocaleUpperCase("tr-TR") && /[a-zçğıöşü]/i.test(word);
  if (named) {
    return next;
  }
  if (
    last &&
    roll <= 2 &&
    /\s/.test(next) &&
    word.length >= 4 &&
    !/(ya+|of+)$/i.test(word)
  ) {
    return `${next}${TAILS[Math.abs(salt + index) % TAILS.length]}`;
  }

  const extra = 2 + ((salt + index) % 2);
  if (roll % 2 === 0 || word.length > 7) {
    return stretchVowelTail(next, extra);
  }
  return stretchConsonantTail(next, extra);
}

export function humanize(
  lines: string[],
  salt: number,
  stretch: "heavy" | "mid" | "light" | "none" = "heavy",
): string[] {
  if (stretch === "none") {
    return lines;
  }
  return lines.map((line, index) => {
    if (stretch === "light" && index !== lines.length - 1) {
      return line;
    }
    if (stretch === "mid" && index !== lines.length - 1 && salt % 2 === 0) {
      return line;
    }
    return slangify(line, salt, index, lines.length);
  });
}
