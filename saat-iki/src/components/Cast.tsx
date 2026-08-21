import { CHARACTERS } from "../data/characters";
import type { CharacterId } from "../types";
import { Portrait } from "./Portrait";

type CastProps = {
  playerName: string;
  onPick: (id: CharacterId) => void;
  onReturn?: () => void;
};

export function Cast({ playerName, onPick, onReturn }: CastProps) {
  return (
    <section className="cast">
      <header className="cast-head">
        <p className="eyebrow">{playerName}, seç</p>
        <h1>Başka hatun?</h1>
        <p className="lede">Leyla bekliyor. İstersen başka ağızla yazış. Her biri ayrı konuşur.</p>
        {onReturn ? (
          <button type="button" className="btn-ghost" onClick={onReturn}>
            Bu geceye dön
          </button>
        ) : null}
      </header>
      <ul className="cast-grid">
        {CHARACTERS.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className={`cast-card tone-${person.id}`}
              onClick={() => onPick(person.id)}
            >
              <Portrait id={person.id} />
              <div className="cast-copy">
                <p className="cast-meta">
                  {person.age} · {person.city}
                </p>
                <h2>{person.name}</h2>
                <p className="cast-hook">{person.hook}</p>
                <p className="cast-bio">{person.bio}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
