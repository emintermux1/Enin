import { useMemo, useState } from "react";
import { AgeGate } from "./components/AgeGate";
import { Cast } from "./components/Cast";
import { Chat } from "./components/Chat";
import { NameGate } from "./components/NameGate";
import { getCharacter } from "./data/characters";
import { nextReply, openingChoices } from "./engine/reply";
import type { CharacterId, Choice, LocationId, Message, Screen } from "./types";

let messageSerial = 0;

function createMessage(role: Message["role"], text: string): Message {
  messageSerial += 1;
  return { id: `m-${messageSerial}`, role, text };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("gate");
  const [playerName, setPlayerName] = useState("");
  const [characterId, setCharacterId] = useState<CharacterId | null>(null);
  const [heat, setHeat] = useState(8);
  const [location, setLocation] = useState<LocationId>("bar");
  const [messages, setMessages] = useState<Message[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);

  const character = useMemo(
    () => (characterId ? getCharacter(characterId) : null),
    [characterId],
  );

  function startWith(id: CharacterId) {
    const person = getCharacter(id);
    const opening = person.opening.map((line) =>
      createMessage("them", personalize(line, playerName)),
    );
    setCharacterId(id);
    setHeat(12);
    setLocation("bar");
    setMessages(opening);
    setChoices(openingChoices(id));
    setScreen("chat");
  }

  function handleSend(text: string) {
    if (!characterId) {
      return;
    }
    const you = createMessage("you", text);
    const result = nextReply(characterId, text, heat, messages);
    const nextHeat = Math.min(100, heat + result.heatDelta);
    const nextMessages = [
      ...messages,
      you,
      ...(result.beat ? [createMessage("beat", result.beat)] : []),
      createMessage("them", personalize(result.reply, playerName)),
    ];
    setMessages(nextMessages);
    setHeat(nextHeat);
    setLocation(result.location);
    setChoices(result.choices);
  }

  switch (screen) {
    case "gate":
      return (
        <main className="app">
          <AgeGate onEnter={() => setScreen("name")} />
        </main>
      );
    case "name":
      return (
        <main className="app">
          <NameGate
            onSubmit={(name) => {
              setPlayerName(name);
              setScreen("cast");
            }}
          />
        </main>
      );
    case "cast":
      return (
        <main className="app wide">
          <Cast playerName={playerName} onPick={startWith} />
        </main>
      );
    case "chat":
      if (!character) {
        return (
          <main className="app">
            <Cast playerName={playerName} onPick={startWith} />
          </main>
        );
      }
      return (
        <main className="app chat-app">
          <Chat
            character={character}
            playerName={playerName}
            heat={heat}
            location={location}
            messages={messages}
            choices={choices}
            onSend={handleSend}
            onBack={() => {
              setCharacterId(null);
              setScreen("cast");
            }}
          />
        </main>
      );
    default: {
      const _exhaustive: never = screen;
      return _exhaustive;
    }
  }
}

function personalize(text: string, name: string): string {
  return text.replaceAll("{name}", name);
}
