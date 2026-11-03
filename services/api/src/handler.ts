import { z } from "zod";

/** Minimal slice of Cloudflare's D1 + Workers types, so this file runs under plain Node in tests. */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown>; all<T = unknown>(): Promise<{ results: T[] }> } };
  batch(stmts: unknown[]): Promise<unknown>;
}
export interface Env {
  DB?: D1Like;
  /** comma-separated list of allowed browser origins, e.g. "https://dayset.github.io" */
  ALLOWED_ORIGINS?: string;
  /** optional Workers Rate Limiting binding; absent in tests and local dev */
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export const MAX_BODY = 4096;
const MetricId = z.string().regex(/^(card|chart)\.[a-z]{2,24}$/);
const FeedbackBody = z.object({
  app: z.literal("wotrep"), v: z.literal(1),
  version: z.string().max(40).optional(),
  votes: z.record(MetricId, z.union([z.literal(1), z.literal(-1)])).refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 40),
}).strict();

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });

function corsFor(req: Request, env: Env): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const ok = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ok.includes(origin)) return null;
  return { "access-control-allow-origin": origin, vary: "origin", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
}

/** The whole API. Pure request → response so it can be tested without a Workers runtime. */
export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsFor(req, env);
  if (cors === null) return json({ error: "origin_not_allowed" }, 403, {});
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/health" && req.method === "GET") return json({ ok: true, service: "wotrep-api", db: !!env.DB }, 200, cors);

  if (url.pathname === "/v1/feedback" && req.method === "POST") {
    if (!env.DB) return json({ error: "storage_unavailable" }, 503, cors);
    if (env.LIMITER) {
      const key = req.headers.get("cf-connecting-ip") ?? "anon";
      if (!(await env.LIMITER.limit({ key })).success) return json({ error: "rate_limited" }, 429, cors);
    }
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "too_large" }, 413, cors);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, cors); }
    const p = FeedbackBody.safeParse(raw);
    if (!p.success) return json({ error: "invalid_body" }, 400, cors);
    const ts = Math.floor(Date.now() / 1000), version = p.data.version ?? "";
    // One row per vote; no account, name, replay or IP is stored.
    await env.DB.batch(Object.entries(p.data.votes).map(([metric, vote]) =>
      env.DB!.prepare("INSERT INTO feedback (ts, version, metric, vote) VALUES (?, ?, ?, ?)").bind(ts, version, metric, vote)));
    return json({ ok: true, stored: Object.keys(p.data.votes).length }, 201, cors);
  }

  if (url.pathname === "/v1/feedback/summary" && req.method === "GET") {
    if (!env.DB) return json({ error: "storage_unavailable" }, 503, cors);
    const { results } = await env.DB.prepare("SELECT metric, SUM(vote = 1) AS up, SUM(vote = -1) AS down FROM feedback WHERE ts > ? GROUP BY metric ORDER BY metric").bind(0).all<{ metric: string; up: number; down: number }>();
    return json({ metrics: results }, 200, cors);
  }

  return json({ error: "not_found" }, 404, cors);
}
