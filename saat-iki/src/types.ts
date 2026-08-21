export type Screen = "gate" | "resume" | "name" | "cast" | "chat";

export type FantasyId =
  | "free"
  | "window"
  | "shower"
  | "morning"
  | "car"
  | "jealous"
  | "slow"
  | "face"
  | "inside"
  | "hall"
  | "public";

export type NightPhase = "tease" | "wet" | "peak" | "after";

export type StretchMode = "heavy" | "mid" | "light" | "none";

export type CharacterId = "asya" | "kim" | "elif" | "defne" | "yasemin" | "melis";

export type HeatTier = 0 | 1 | 2 | 3;

export type Intent =
  | "greet"
  | "compliment"
  | "question"
  | "kiss"
  | "dirty"
  | "invite"
  | "soft"
  | "tease"
  | "body"
  | "night"
  | "generic";

export type LocationId = "bar" | "taxi" | "suite" | "yatak";

export type MessageRole = "them" | "you" | "beat";

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
};

export type Choice = {
  label: string;
  text: string;
};

export type Character = {
  id: CharacterId;
  name: string;
  age: number;
  title: string;
  city: string;
  scent: string;
  hook: string;
  bio: string;
  opening: string[];
  accent: string;
};

export type EngineResult = {
  bubbles: string[];
  heatDelta: number;
  beat: string | null;
  location: LocationId;
  choices: Choice[];
  climax: boolean;
  fantasy: FantasyId;
};

export type SavedNight = {
  version: 1;
  playerName: string;
  characterId: CharacterId;
  heat: number;
  location: LocationId;
  fantasy: FantasyId;
  climaxCount: number;
  moves: string[];
  messages: Message[];
};

export type PlayOpts = {
  heat: number;
  name: string;
  characterId: CharacterId;
  fantasy: FantasyId;
  climaxCount: number;
  recentMoves: string[];
};
