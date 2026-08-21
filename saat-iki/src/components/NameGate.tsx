import { useState, type FormEvent } from "react";
import { Atmosphere } from "./Atmosphere";

type NameGateProps = {
  onSubmit: (name: string) => void;
};

export function NameGate({ onSubmit }: NameGateProps) {
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <section className="lock name-gate">
      <Atmosphere kind="lock" />
      <p className="eyebrow">kulağına fısıldasın</p>
      <h1>Adın ne?</h1>
      <p className="lede">Erkek adı yaz. Islanırken, yalvarırken öyle seslenecek.</p>
      <form className="name-form" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="player-name">
          Adın
        </label>
        <input
          id="player-name"
          autoComplete="nickname"
          autoFocus
          maxLength={24}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Adın"
        />
        <button type="submit" className="btn-primary" disabled={name.trim().length < 2}>
          Yazışmaya geç
        </button>
      </form>
    </section>
  );
}
