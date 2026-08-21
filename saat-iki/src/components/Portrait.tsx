import type { CharacterId } from "../types";

type PortraitProps = {
  id: CharacterId;
  large?: boolean;
};

export function Portrait({ id, large = false }: PortraitProps) {
  return (
    <div className={`portrait ${large ? "portrait-large" : ""} tone-${id}`} aria-hidden="true">
      <div className="portrait-room" />
      <div className="portrait-glow" />
      <div className="hair" />
      <div className="face">
        <div className="brow left" />
        <div className="brow right" />
        <div className="eye left" />
        <div className="eye right" />
        <div className="mouth" />
      </div>
      <div className="neck" />
      <div className="collar" />
      <div className="jewel" />
      <div className="lash left" />
      <div className="lash right" />
    </div>
  );
}
