import { FANTASIES } from "../data/fantasies";
import { getCharacter } from "../data/characters";
import type { SavedNight } from "../types";
import { Atmosphere } from "./Atmosphere";

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
      <Atmosphere kind="lock" />
      <p className="eyebrow">çarşaf hâlâ dağınık</p>
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
