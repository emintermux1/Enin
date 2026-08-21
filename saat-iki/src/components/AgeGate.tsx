type AgeGateProps = {
  onEnter: () => void;
};

export function AgeGate({ onEnter }: AgeGateProps) {
  return (
    <section className="panel gate">
      <p className="eyebrow">Saat ikiyi geçti</p>
      <h1>Bu gece 18 yaşından küçüklere kapalı.</h1>
      <p className="lede">
        Saat İki: sen erkeksin, karşında yetişkin bir AI hatun var. Türkçe, azgın,
        senin yazdığına cevap veren sohbet. Porno videosu yok; konuşma var, istek var.
      </p>
      <div className="gate-actions">
        <button type="button" className="btn-primary" onClick={onEnter}>
          18 yaşından büyüğüm, içeri al
        </button>
        <a className="btn-ghost" href="https://www.google.com">
          Değilim
        </a>
      </div>
    </section>
  );
}
