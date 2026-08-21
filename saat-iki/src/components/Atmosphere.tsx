type AtmosphereProps = {
  kind: "lock" | "chat";
};

export function Atmosphere({ kind }: AtmosphereProps) {
  return (
    <div className={`atmosphere atmosphere-${kind}`} aria-hidden="true">
      <div className="atm-wash" />
      <div className="atm-lamp" />
      <div className="atm-haze" />
      <div className="atm-silk" />
      <i className="atm-spark s1" />
      <i className="atm-spark s2" />
      <i className="atm-spark s3" />
    </div>
  );
}
