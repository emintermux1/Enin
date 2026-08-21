import { FANTASIES } from "../data/fantasies";
import { getCharacter } from "../data/characters";
import type { SavedNight } from "../types";

type ResumeProps = {
  night: SavedNight;
  onContinue: () => void;
  onFresh: () => void;
};

export function Resume({ night, onContinue, onFresh }: ResumeProps) {
  const person = getCharacter(night.characterId);
  const fantasy = FANTASIES.find((item) => item.id === night.fantasy);
  return (
    <section className="lock">
      <p className="eyebrow">gece yarım kaldı</p>
      <h1>{person.name} hâlâ çevrimiçi.</h1>
      <p className="lede">
        {night.playerName}, ateş {night.heat}. {fantasy && fantasy.id !== "free" ? `${fantasy.label} kilitli.` : "Fantezi serbest."}{" "}
        Kaldığın yerden yazış ya da geceyi sıfırla.
      </p>
      <div className="gate-actions">
        <button type="button" className="btn-primary" onClick={onContinue}>
          Kaldığın yerden
        </button>
        <button type="button" className="btn-ghost" onClick={onFresh}>
          Yeni gece
        </button>
      </div>
    </section>
  );
}
