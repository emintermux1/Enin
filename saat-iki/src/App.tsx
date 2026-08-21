import { useEffect, useMemo, useState } from "react";
import { AgeGate } from "./components/AgeGate";
import { Cast } from "./components/Cast";
import { Chat } from "./components/Chat";
import { NameGate } from "./components/NameGate";
import { Resume } from "./components/Resume";
import { DEFAULT_COMPANION, getCharacter } from "./data/characters";
import { getFantasy } from "./data/fantasies";
import { locationForHeat, nextChoices, nextReply, openingChoices } from "./engine/reply";
import { clearNight, loadNight, saveNight } from "./engine/save";
import type {
  CharacterId,
  Choice,
  FantasyId,
  LocationId,
  Message,
  SavedNight,
  Screen,
} from "./types";

let messageSerial = 0;

function createMessage(role: Message["role"], text: string): Message {
  messageSerial += 1;
  return { id: `m-${messageSerial}`, role, text };
}

function syncSerial(items: Message[]) {
  let max = 0;
  for (const item of items) {
    const value = Number(item.id.replace(/\D/g, ""));
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  messageSerial = max;
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
  const [fantasy, setFantasy] = useState<FantasyId>("free");
  const [climaxCount, setClimaxCount] = useState(0);
  const [saved, setSaved] = useState<SavedNight | null>(null);

  const character = useMemo(
    () => (characterId ? getCharacter(characterId) : null),
    [characterId],
  );

  useEffect(() => {
    if (!characterId || !playerName || messages.length === 0) {
      return;
    }
    saveNight({
      version: 1,
      playerName,
      characterId,
      heat,
      location,
      fantasy,
      climaxCount,
      moves: [],
      messages,
    });
  }, [characterId, playerName, heat, location, fantasy, climaxCount, messages]);

  function restore(night: SavedNight) {
    syncSerial(night.messages);
    setPlayerName(night.playerName);
    setCharacterId(night.characterId);
    setHeat(night.heat);
    setLocation(night.location);
    setFantasy(night.fantasy);
    setClimaxCount(night.climaxCount);
    setMessages(night.messages);
    const lastYou = [...night.messages].reverse().find((item) => item.role === "you");
    setChoices(lastYou ? nextChoices(lastYou.text, night.messages) : openingChoices());
    setWaiting(false);
    setScreen("chat");
  }

  function startWith(id: CharacterId, name = playerName) {
    const person = getCharacter(id);
    const startHeat = id === "asya" ? 46 : 28;
    messageSerial = 0;
    const opening = person.opening.map((line) =>
      createMessage("them", personalize(line, name)),
    );
    setCharacterId(id);
    setHeat(startHeat);
    setLocation(locationForHeat(startHeat));
    setMessages(opening);
    setChoices(openingChoices(id, startHeat));
    setFantasy("free");
    setClimaxCount(0);
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
    const result = nextReply({
      characterId,
      input: text,
      heat,
      history,
      playerName,
      fantasy,
      climaxCount,
    });
    const nextHeat = Math.min(100, heat + result.heatDelta);
    setFantasy(result.fantasy);
    if (result.climax) {
      setClimaxCount((count) => count + 1);
    }
    const incoming = [
      ...(result.beat ? [createMessage("beat", result.beat)] : []),
      ...result.bubbles.map((line) => createMessage("them", personalize(line, playerName))),
    ];
    if (incoming.length === 0) {
      setChoices(result.choices);
      setHeat(nextHeat);
      setLocation(result.location);
      setWaiting(false);
      return;
    }
    let delay = 0;
    incoming.forEach((item, index) => {
      delay += bubbleWait(item.text, index);
      window.setTimeout(() => {
        setMessages((current) => [...current, item]);
        if (index === incoming.length - 1) {
          setHeat(nextHeat);
          setLocation(result.location);
          setChoices(result.choices);
          setWaiting(false);
        }
      }, delay);
    });
  }

  function handleFantasy(id: FantasyId) {
    if (waiting) {
      return;
    }
    setFantasy(id);
    handleSend(getFantasy(id).prompt);
  }

  switch (screen) {
    case "gate":
      return (
        <main className="app">
          <AgeGate
            onEnter={() => {
              const night = loadNight();
              if (night) {
                setSaved(night);
                setScreen("resume");
                return;
              }
              setScreen("name");
            }}
          />
        </main>
      );
    case "resume":
      if (!saved) {
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
      }
      return (
        <main className="app">
          <Resume
            night={saved}
            onContinue={() => restore(saved)}
            onFresh={() => {
              clearNight();
              setSaved(null);
              setPlayerName(saved.playerName);
              setScreen("name");
            }}
          />
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
          <Cast
            playerName={playerName}
            onPick={startWith}
            onReturn={
              characterId && messages.length > 0
                ? () => setScreen("chat")
                : undefined
            }
          />
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
            fantasy={fantasy}
            climaxCount={climaxCount}
            messages={messages}
            choices={choices}
            waiting={waiting}
            onSend={handleSend}
            onFantasy={handleFantasy}
            onBack={() => {
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

function bubbleWait(text: string, index: number): number {
  const start = index === 0 ? 260 : 300;
  return start + Math.min(380, text.length * 14);
}
