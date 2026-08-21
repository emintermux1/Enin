export type Screen = "gate" | "name" | "cast" | "chat";

export type CharacterId = "elif" | "defne" | "yasemin" | "melis";

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
  reply: string;
  heatDelta: number;
  beat: string | null;
  location: LocationId;
  choices: Choice[];
};
