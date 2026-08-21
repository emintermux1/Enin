import { CHARACTERS } from "../data/characters";
import type { CharacterId } from "../types";
import { Portrait } from "./Portrait";

type CastProps = {
  playerName: string;
  onPick: (id: CharacterId) => void;
};

export function Cast({ playerName, onPick }: CastProps) {
  return (
    <section className="cast">
      <header className="cast-head">
        <p className="eyebrow">{playerName}, seç</p>
        <h1>Başka hatun?</h1>
        <p className="lede">
          Leyla seni bekliyor. İstersen başka yetişkin bir kadınla da konuşursun.
          Hepsi seninle, bir erkekle, açık ve azgın konuşur.
        </p>
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
                <p className="cast-title">{person.title}</p>
                <p className="cast-hook">{person.hook}</p>
                <p className="cast-bio">{person.bio}</p>
                <p className="cast-scent">{person.scent}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
