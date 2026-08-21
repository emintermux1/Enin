import { useEffect, useRef, useState, type FormEvent } from "react";
import { locationLabel } from "../engine/reply";
import type { Character, Choice, LocationId, Message } from "../types";
import { Portrait } from "./Portrait";

type ChatProps = {
  character: Character;
  playerName: string;
  heat: number;
  location: LocationId;
  messages: Message[];
  choices: Choice[];
  onSend: (text: string) => void;
  onBack: () => void;
};

export function Chat({
  character,
  playerName,
  heat,
  location,
  messages,
  choices,
  onSend,
  onBack,
}: ChatProps) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setDraft("");
  }

  return (
    <section className={`chat-shell loc-${location} tone-${character.id}`}>
      <header className="chat-top">
        <button type="button" className="back" onClick={onBack}>
          Başka
        </button>
        <div className="who">
          <Portrait id={character.id} />
          <div>
            <p className="who-name">{character.name}</p>
            <p className="who-sub">
              {character.title} · {locationLabel(location)} · seninle
            </p>
          </div>
        </div>
        <div className="heat" aria-label={`Yakınlık ${heat}`}>
          <span>Yakınlık</span>
          <b>{heat}</b>
        </div>
      </header>

      <div className="heat-track" aria-hidden="true">
        <i style={{ width: `${heat}%` }} />
      </div>

      <div className="stage">
        <Portrait id={character.id} large />
        <p className="stage-line">{character.hook}</p>
      </div>

      <div className="thread" ref={scroller}>
        {messages.map((item) => (
          <article key={item.id} className={`bubble ${item.role}`}>
            {item.role === "beat" ? (
              <p>{item.text}</p>
            ) : (
              <>
                <span>{item.role === "you" ? playerName : character.name}</span>
                <p>{item.text}</p>
              </>
            )}
          </article>
        ))}
      </div>

      <div className="composer">
        <div className="choices">
          {choices.map((choice) => (
            <button key={choice.label} type="button" onClick={() => onSend(choice.text)}>
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
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ona yaz. Ne istediğini söyle."
            maxLength={280}
          />
          <button type="submit" className="btn-primary" disabled={!draft.trim()}>
            Gönder
          </button>
        </form>
      </div>
    </section>
  );
}
