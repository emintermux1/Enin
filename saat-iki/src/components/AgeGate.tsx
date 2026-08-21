import { Atmosphere } from "./Atmosphere";

type AgeGateProps = {
  onEnter: () => void;
};

export function AgeGate({ onEnter }: AgeGateProps) {
  return (
    <section className="lock">
      <Atmosphere kind="lock" />
      <p className="lock-clock">02:14</p>
      <p className="lock-date">Cuma gecesi · çarşaf hâlâ ılık</p>
      <h1>18+ değilse girme.</h1>
      <p className="lede">
        Sen erkeksin. Karşında Asya var: seksi, flörtöz, istekli. Azgınlıktan delirtecek. 18+.
      </p>
      <div className="gate-actions">
        <button type="button" className="btn-primary" onClick={onEnter}>
          18’den büyüğüm
        </button>
        <a className="btn-ghost" href="https://www.google.com">
          Değilim
        </a>
      </div>
    </section>
  );
}
