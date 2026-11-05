import { useRef, useState } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { parseFile } from "../../lib/parseClient";
import { t } from "../../i18n";
import { diagnosticsFor, stageLabel, type UploadErrorInfo } from "./progress";

export function Upload({ onDone }: { onDone: (tl: BattleTimeline) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [over, setOver] = useState(false);
  const [stage, setStage] = useState<string | null>(null), [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<UploadErrorInfo | null>(null);
  const run = (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null); setStage(null); setPct(null);
    parseFile(f, (s, p) => { if (s !== "done") { setStage(s); setPct(p); } }).promise.then(onDone)
      .catch((e: Error & { stage?: string; code?: string; fileName?: string; fileSize?: number; workerStarted?: boolean; lastProgressStage?: string; workerUrl?: string }) =>
        setErr({ stage: e.stage ?? "?", code: e.code, message: e.message, fileName: e.fileName, fileSize: e.fileSize, workerStarted: e.workerStarted, lastProgressStage: e.lastProgressStage, workerUrl: e.workerUrl }))
      .finally(() => setBusy(false));
  };
  const sendDiagnostics = () => {
    if (!err) return;
    const blob = new Blob([JSON.stringify(diagnosticsFor(err), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "wotrep-diagnostics.json"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0} data-testid="drop"
        onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); run(e.dataTransfer.files[0]); }}>
        <div className="drop-plus" aria-hidden="true">+</div>
        {busy ? t("upload.parsing") : t("upload.drop")}
        <small>{t("upload.local")}</small>
        <input ref={input} type="file" accept=".wotreplay,.mtreplay" hidden data-testid="file" onChange={(e) => { run(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {busy && stage !== null && pct !== null && <div role="status">{stageLabel(stage, t("upload.stageParse"))} {pct}%</div>}
      {err && <div className="err" role="alert">{t("upload.error", { stage: err.stage, message: err.code === "WorkerLoadFailed" ? t("upload.workerLoadFailed") : err.message })} <button type="button" onClick={sendDiagnostics}>{t("upload.sendDiagnostics")}</button></div>}
    </div>
  );
}
