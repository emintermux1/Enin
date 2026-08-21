import { useEffect, useRef, useState, type FormEvent } from "react";
import { FANTASIES, fantasyLabel } from "../data/fantasies";
import { nightPhase, phaseLabel } from "../engine/night";
import { nightClock } from "../engine/reply";
import type { Character, Choice, FantasyId, LocationId, Message } from "../types";
import { Atmosphere } from "./Atmosphere";
import { Portrait } from "./Portrait";

type ChatProps = {
  character: Character;
  playerName: string;
  heat: number;
  location: LocationId;
  fantasy: FantasyId;
  climaxCount: number;
  messages: Message[];
  choices: Choice[];
  waiting: boolean;
  onSend: (text: string) => void;
  onFantasy: (id: FantasyId) => void;
  onBack: () => void;
};

export function Chat({
  character,
  playerName,
  heat,
  location,
  fantasy,
  climaxCount,
  messages,
  choices,
  waiting,
  onSend,
  onFantasy,
  onBack,
}: ChatProps) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const phase = nightPhase(heat, climaxCount);

  useEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages, waiting]);

  useEffect(() => {
    if (!waiting) {
      input.current?.focus();
    }
  }, [waiting]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || waiting) {
      return;
    }
    onSend(trimmed);
    setDraft("");
  }

  const status = waiting
    ? "yazıyor…"
    : `çevrimiçi · ${phaseLabel(phase)}${fantasy === "free" ? "" : ` · ${fantasyLabel(fantasy)}`}`;

  return (
    <section
      className={`chat-shell loc-${location} tone-${character.id} phase-${phase} fan-${fantasy}`}
      style={{ ["--heat" as string]: String(heat / 100) }}
    >
      <Atmosphere kind="chat" />
      <p className="phone-bar">
        <time>{nightClock(heat)}</time>
        <span>LTE</span>
      </p>
      <header className="chat-top">
        <button type="button" className="back" onClick={onBack}>
          Başka
        </button>
        <div className="who">
          <Portrait id={character.id} />
          <div>
            <p className="who-name">
              <i className={`live-dot${waiting ? " is-type" : ""}`} />
              {character.name}
            </p>
            <p className="who-sub">{status}</p>
          </div>
        </div>
        <div className="heat" aria-label={`Yakınlık ${heat}`}>
          <span>ateş</span>
          <b>{heat}</b>
        </div>
      </header>

      <div className="heat-track" aria-hidden="true">
        <i style={{ width: `${heat}%` }} />
      </div>

      <div className="thread" ref={scroller}>
        {messages.map((item, index) => {
          const prev = messages[index - 1];
          const stacked = Boolean(prev && prev.role === item.role && item.role !== "beat");
          return (
            <article
              key={item.id}
              className={`bubble ${item.role}${stacked ? " stacked" : ""}`}
            >
              {item.role === "beat" ? (
                <p>{item.text}</p>
              ) : (
                <>
                  {stacked ? null : (
                    <span>{item.role === "you" ? playerName : character.name}</span>
                  )}
                  <p>{item.text}</p>
                </>
              )}
            </article>
          );
        })}
        {waiting ? (
          <article className="bubble them typing" aria-live="polite">
            <span>{character.name}</span>
            <p>
              <i />
              <i />
              <i />
            </p>
          </article>
        ) : null}
      </div>

      <div className="composer">
        <div className="chips" role="group" aria-label="Fantezi">
          {FANTASIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip${fantasy === item.id ? " is-on" : ""}`}
              disabled={waiting}
              onClick={() => onFantasy(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="choices">
          {choices.map((choice) => (
            <button
              key={`${choice.label}-${choice.text}`}
              type="button"
              disabled={waiting}
              onClick={() => onSend(choice.text)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="draft">
            Mesaj
          </label>
          <input
            id="draft"
            ref={input}
            autoFocus
            disabled={waiting}
            value={draft}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={waiting ? `${character.name} yazıyor…` : "yaz, gönder"}
            maxLength={280}
          />
          <button type="submit" className="btn-primary" disabled={!draft.trim() || waiting}>
            Gönder
          </button>
        </form>
      </div>
    </section>
  );
}
