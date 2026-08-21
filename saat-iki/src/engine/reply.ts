import type {
  CharacterId,
  Choice,
  EngineResult,
  HeatTier,
  Intent,
  LocationId,
  Message,
} from "../types";
import { detectAct, playScene } from "./scene";

const INTENT_PATTERNS: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: "greet",
    pattern:
      /\b(merhaba|selam|slm|mrb|hey|naber|napıyon|napion|napıyorsun|napyorsun|nasılsın|nasilsin|iyi akşamlar|iyi aksamlar|gece)\b/i,
  },
  {
    intent: "kiss",
    pattern: /\b(öp|op|öpücük|opucuk|dudak|dil|boynun|boynu|kulağın|kulagin)\b/i,
  },
  {
    intent: "invite",
    pattern:
      /\b(gel|geliyorum|evine|evime|yatak|otele|odana|buluş|bulus|kaçır|kacir)\b/i,
  },
  {
    intent: "dirty",
    pattern:
      /\b(sik|sikiş|sikis|sakso|yala|yiyim|amini|amını|emil|çıplak|ciplak|azgın|azgin|sert|içine|icine|boşal|bosal|orgazm|ağzına|agzina)\b/i,
  },
  {
    intent: "body",
    pattern:
      /\b(göğüs|gogus|göğsün|bacak|kalça|kalca|belin|belini|saç|sac|ellerin|ellerini|tenin|tenini|ağzın|agzin)\b/i,
  },
  {
    intent: "tease",
    pattern: /\b(yok|yapmam|bekle|sabret|kızdır|kizdir|alay|kışkırt|kiskirt)\b/i,
  },
  {
    intent: "compliment",
    pattern:
      /\b(güzelsin|guzelsin|seksisin|tatlısın|tatlisin|çok iyisin|cok iyisin|hoşuma|hosuma|bayıldım|bayildim)\b/i,
  },
  {
    intent: "soft",
    pattern:
      /\b(sarıl|saril|yavaş|yavas|nazik|kal|yanımda|yanimda|nefesi|nefesin)\b/i,
  },
  {
    intent: "night",
    pattern: /\b(gece|yalnız|yalniz|uyku|yatağın|yatagin|karanlık|karanlik)\b/i,
  },
  {
    intent: "question",
    pattern:
      /\?|(ne yapıyorsun|ne yapiyorsun|neredesin|nerdeysin|ne giyiyorsun|ne giyiyon|ne istiyorsun|kaç yaş|kac yas|adın ne|adin ne)/i,
  },
];

const CHOICES: Record<CharacterId, [Choice[], Choice[], Choice[], Choice[]]> = {
  leyla: [
    [
      { label: "Öp", text: "Öp beni, dilini de ver." },
      { label: "Yala", text: "Amini yiyim." },
      { label: "Ağzına al", text: "Ağzına al." },
    ],
    [
      { label: "Yala", text: "Amini yiyim, durma." },
      { label: "Ağzına al", text: "Ağzına al, bakarak." },
      { label: "Sok", text: "İçine sok, yavaş değil." },
    ],
    [
      { label: "Daha derin", text: "Daha derin yala." },
      { label: "Boğazına", text: "Ağzına al, boğazına kadar." },
      { label: "Sert sik", text: "Sert sik, bırakma." },
    ],
    [
      { label: "Yut", text: "Ağzına al, yut." },
      { label: "İçinde kal", text: "İçinde kal, bir daha." },
      { label: "Üstüne geç", text: "Üstüme geç, al." },
    ],
  ],
  elif: [
    [
      { label: "Geç kaldım", text: "Geç kaldım. Bırakma, geceyi uzatalım." },
      { label: "Ne giyiyorsun?", text: "Ne giyiyorsun şu an? Yalan söyleme." },
      { label: "Sesi kıs", text: "Sesi kıs. Sadece ikimiz kalalım." },
    ],
    [
      { label: "Tezgâha gel", text: "Tezgâhın kenarına gel. Öpeceğim, acele etmeden." },
      { label: "Anlat", text: "Ellerini nereye koyacağını anlat. Detaylı." },
      { label: "Aşağı inelim", text: "Aşağı inelim. Taksi çağır, dizini bana ver." },
    ],
    [
      { label: "Arka oda", text: "Arka odaya geç. Kapıyı kilitle, önlüğünü çöz." },
      { label: "Diz çök", text: "Dizlerinin üstüne çökmeni istiyorum. Bakarak." },
      { label: "Sert konuş", text: "Sert konuş. Ne yapacağını saklama." },
    ],
    [
      { label: "Yatağa", text: "Yatağa geç. Üstümde kal, bırakma." },
      { label: "Ağzın", text: "Ağzını kullan. Yavaş başla, bırakma." },
      { label: "İçinde", text: "İçinde kalmak istiyorum. Söyle, nasıl." },
    ],
  ],
  defne: [
    [
      { label: "Kirli cümle", text: "Kirli bir cümle istiyorsun: seni masada hayal ettim." },
      { label: "Pencere", text: "Pencerenin önünde ne giyiyorsun?" },
      { label: "Oku", text: "Bana yazdığın sahneyi oku. Sansürsüz." },
    ],
    [
      { label: "Öp", text: "Öpücüğü tasvir etme, gel öp. Dilini de getir." },
      { label: "Gömlek", text: "Gömleğinin düğmesini ben seçeceğim. Hangisini koparayım?" },
      { label: "Yanına", text: "Yanına geliyorum. Kapı açık kalsın." },
    ],
    [
      { label: "Masadan kalk", text: "Masadan kalk. Seni yatağa taşıyacağım." },
      { label: "Ağzınla yaz", text: "Cümleyi ağzınla bitir. Nerede olduğunu söyle." },
      { label: "Islak sayfa", text: "Sayfa ıslanacaksa ıslansın. Üstüne yat." },
    ],
    [
      { label: "Paragraf", text: "Uzun yaz. İçine girişi bir paragraf yap, nefes alma." },
      { label: "Sus", text: "Sus. Ben anlatayım, sen uygulayacaksın." },
      { label: "Kal", text: "Sabaha kadar kal. Kitabı kapat, beni aç." },
    ],
  ],
  yasemin: [
    [
      { label: "Öp", text: "Öp beni." },
      { label: "Yala", text: "Amini yiyim." },
      { label: "Ağzına al", text: "Ağzına al." },
    ],
    [
      { label: "Yala", text: "Amini yiyim, durma." },
      { label: "Ağzına al", text: "Ağzına al." },
      { label: "Sok", text: "İçine sok." },
    ],
    [
      { label: "Daha derin", text: "Daha derin yala." },
      { label: "Boğazına", text: "Ağzına al, boğazına kadar." },
      { label: "Sert", text: "Sert sik." },
    ],
    [
      { label: "Yut", text: "Ağzına al, yut." },
      { label: "İçinde kal", text: "İçinde kal." },
      { label: "Üstüne geç", text: "Üstüme geç." },
    ],
  ],
  melis: [
    [
      { label: "İzin", text: "İzin istiyorum. Bu gece seninle kalmak için." },
      { label: "Kural", text: "İlk kuralın ne? Uyacağım." },
      { label: "Öv", text: "Güzelsin. Bunu dizlerimin üstünde de söyleyeceğim." },
    ],
    [
      { label: "Öpeyim mi", text: "Öpeyim mi? İzin verirsen acele etmem." },
      { label: "Kanepe", text: "Kanepene gelmek istiyorum. Çağır." },
      { label: "Emret", text: "Emret. Ne yapacağımı söyle." },
    ],
    [
      { label: "Teslim", text: "Teslimim. Ritmi sen ver, ben uyacağım." },
      { label: "Cezam", text: "Cezam ne? Erken yazdım, geç kalmadım." },
      { label: "Ağzım", text: "Ağzımı nasıl kullanacağımı söyle. Madde madde." },
    ],
    [
      { label: "Yalvarıyorum", text: "Yalvarıyorum. İçinde kal, bırakma." },
      { label: "Say", text: "Say. Ne kadar daha, sen bitir." },
      { label: "Sabah", text: "Sabah da kalacağım. Kapıyı sen açarsın." },
    ],
  ],
};

export function detectIntent(input: string): Intent {
  for (const item of INTENT_PATTERNS) {
    if (item.pattern.test(input)) {
      return item.intent;
    }
  }
  return "generic";
}

export function heatTier(heat: number): HeatTier {
  if (heat < 25) return 0;
  if (heat < 50) return 1;
  if (heat < 75) return 2;
  return 3;
}

export function locationForHeat(heat: number): LocationId {
  if (heat < 28) return "bar";
  if (heat < 52) return "taxi";
  if (heat < 78) return "suite";
  return "yatak";
}

export function locationLabel(location: LocationId): string {
  switch (location) {
    case "bar":
      return "İlk masa";
    case "taxi":
      return "Yol";
    case "suite":
      return "Oda";
    case "yatak":
      return "Yatak";
    default: {
      const _exhaustive: never = location;
      return _exhaustive;
    }
  }
}

export function nextReply(
  characterId: CharacterId,
  input: string,
  heat: number,
  history: Message[],
  playerName: string,
): EngineResult {
  const act = detectAct(input);
  const nextHeat = Math.min(100, heat + (act === "talk" || act === "ask" ? 8 : 16));
  const nextLocation = locationForHeat(nextHeat);
  return {
    bubbles: playScene(input, history, playerName),
    heatDelta: nextHeat - heat,
    beat: null,
    location: nextLocation,
    choices: CHOICES[characterId][heatTier(nextHeat)],
  };
}

export function openingChoices(characterId: CharacterId, heat = 0): Choice[] {
  return CHOICES[characterId][heatTier(heat)];
}
