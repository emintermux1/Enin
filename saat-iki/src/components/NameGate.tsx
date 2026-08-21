import { useState, type FormEvent } from "react";

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
    <section className="panel name-gate">
      <p className="eyebrow">Önce sen</p>
      <h1>Kadınlar sana nasıl seslensin?</h1>
      <p className="lede">
        Erkek adı yaz. Gece uzayınca o isim kulağa, sonra ağza, sonra yastığa düşecek.
      </p>
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
          Geceye geç
        </button>
      </form>
    </section>
  );
}
