import { useEffect, useMemo, useRef } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

const mmss = (s: number) => `${s < 0 ? "−" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, "0")}`;

/** In-battle chat, as the replay recorded it (packet 0x23, docs/REPLAY_FORMAT.md).
 *  Renders nothing when the replay carries no chat messages. Like DamageLog,
 *  the row at the playhead is highlighted and a row click jumps 3 s before it.
 *  The sender string is the packet text ("Name[CLAN] (Tank)"); the side colour
 *  comes from matching its bare name against the vehicle list, and is left
 *  uncoloured when no vehicle matches. */
export function ChatLog({ tl, now, onSeek }: { tl: BattleTimeline; now: number; onSeek: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const vehicle = useMemo(() => new Map(tl.vehicles.map((v) => [v.vid, v])), [tl]);
  const rows = useMemo(() => tl.events.flatMap((e) => (e.k === "chat" ? [e] : [])).sort((a, b) => a.t - b.t), [tl]);
  const cur = rows.reduce((a, r, i) => (r.t <= now ? i : a), -1);
  useEffect(() => { const el = box.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`); if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2; }, [cur]);
  if (rows.length === 0) return null;
  const side = (sender: string | undefined) => {
    if (!sender) return "";
    const bare = sender.split("[")[0]!.split(" (")[0]!.trim();
    const v = [...vehicle.values()].find((x) => x.name === bare);
    return v ? (v.team === tl.recorder.team ? "ally" : "enemy") : "";
  };
  return (
    <div className="dlog chatlog" data-testid="chatlog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dlogbar"><b>{t("chat.title")}</b></div>
      <div className="dlogrows" ref={box}>
        {rows.map((r, i) => (
          <button type="button" key={i} data-i={i} className={`dlogrow${i === cur ? " cur" : ""}${r.t > now ? " future" : ""}`} onClick={() => onSeek(Math.max(0, r.t - 3))}>
            <span className="dt">{mmss(r.t)}</span>
            <span className="cmsg">{r.sender ? <><span className={side(r.sender)}>{r.sender}</span>: </> : null}{r.text}</span>
          </button>
        ))}
      </div>
      <p className="muted dlognote">{t("chat.note")}</p>
    </div>
  );
}
