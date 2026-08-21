type AgeGateProps = {
  onEnter: () => void;
};

export function AgeGate({ onEnter }: AgeGateProps) {
  return (
    <section className="lock">
      <p className="lock-clock">02:14</p>
      <p className="lock-date">Cuma gecesi</p>
      <h1>18+ değilse girme.</h1>
      <p className="lede">
        Sen erkeksin. Karşında yetişkin bir hatun var. Yazarsın, o azgın cevap verir.
        Video yok. Sohbet var.
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
