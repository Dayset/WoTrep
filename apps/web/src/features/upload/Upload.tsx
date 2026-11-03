import { useRef, useState } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { parseFile } from "../../lib/parseClient";
import { t } from "../../i18n";

export function Upload({ onDone }: { onDone: (tl: BattleTimeline) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [over, setOver] = useState(false), [err, setErr] = useState<string | null>(null);
  const run = (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null);
    parseFile(f).promise.then(onDone).catch((e: Error & { stage?: string }) => setErr(t("upload.error", { stage: e.stage ?? "?", message: e.message }))).finally(() => setBusy(false));
  };
  return (
    <div>
      <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0} data-testid="drop"
        onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); run(e.dataTransfer.files[0]); }}>
        {busy ? t("upload.parsing") : t("upload.drop")}
        <small>{t("upload.local")}</small>
        <input ref={input} type="file" accept=".wotreplay,.mtreplay" hidden data-testid="file" onChange={(e) => run(e.target.files?.[0])} />
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
