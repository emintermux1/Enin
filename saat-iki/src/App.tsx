import { useMemo, useState } from "react";
import { AgeGate } from "./components/AgeGate";
import { Cast } from "./components/Cast";
import { Chat } from "./components/Chat";
import { NameGate } from "./components/NameGate";
import { DEFAULT_COMPANION, getCharacter } from "./data/characters";
import { locationForHeat, nextReply, openingChoices } from "./engine/reply";
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
  const [waiting, setWaiting] = useState(false);

  const character = useMemo(
    () => (characterId ? getCharacter(characterId) : null),
    [characterId],
  );

  function startWith(id: CharacterId, name = playerName) {
    const person = getCharacter(id);
    const startHeat = id === "leyla" ? 46 : 22;
    const opening = person.opening.map((line) =>
      createMessage("them", personalize(line, name)),
    );
    setCharacterId(id);
    setHeat(startHeat);
    setLocation(locationForHeat(startHeat));
    setMessages(opening);
    setChoices(openingChoices(id, startHeat));
    setWaiting(false);
    setScreen("chat");
  }

  function handleSend(text: string) {
    if (!characterId || waiting) {
      return;
    }
    const you = createMessage("you", text);
    const history = [...messages, you];
    setMessages(history);
    setWaiting(true);
    const result = nextReply(characterId, text, heat, history, playerName);
    const nextHeat = Math.min(100, heat + result.heatDelta);
    const incoming = [
      ...(result.beat ? [createMessage("beat", result.beat)] : []),
      ...result.bubbles.map((line) => createMessage("them", personalize(line, playerName))),
    ];
    let delay = 480;
    incoming.forEach((item, index) => {
      window.setTimeout(() => {
        setMessages((current) => [...current, item]);
        if (index === incoming.length - 1) {
          setHeat(nextHeat);
          setLocation(result.location);
          setChoices(result.choices);
          setWaiting(false);
        }
      }, delay);
      delay += 380;
    });
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
              startWith(DEFAULT_COMPANION, name);
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
            waiting={waiting}
            onSend={handleSend}
            onBack={() => {
              setCharacterId(null);
              setWaiting(false);
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
