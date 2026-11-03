/** Optional cloud features. Everything here must fail soft: the app is fully usable with the Worker down or unset. */
const base = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export const cloudConfigured = base !== "";

let probe: Promise<boolean> | null = null;
/** True only if the Worker answers /health with storage attached, within 2.5 s. Cached for the page's life. */
export function cloudAvailable(): Promise<boolean> {
  if (!cloudConfigured) return Promise.resolve(false);
  probe ??= fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) })
    .then((r) => (r.ok ? (r.json() as Promise<{ db?: boolean }>) : { db: false }))
    .then((j) => j.db === true).catch(() => false);
  return probe;
}

export async function sendFeedback(votes: Record<string, 1 | -1>, version?: string): Promise<boolean> {
  if (!(await cloudAvailable()) || Object.keys(votes).length === 0) return false;
  try {
    const r = await fetch(`${base}/v1/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "wotrep", v: 1, version, votes }), signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}
