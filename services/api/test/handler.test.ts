import { describe, expect, it } from "vitest";
import { handle, type D1Like, type Env } from "../src/handler";

function fakeDb() {
  const rows: { ts: number; version: string; metric: string; vote: number }[] = [];
  const db: D1Like = {
    prepare: (sql: string) => ({ bind: (...v: unknown[]) => ({
      run: async () => { rows.push({ ts: v[0] as number, version: v[1] as string, metric: v[2] as string, vote: v[3] as number }); },
      all: async <T,>() => {
        const m = new Map<string, { metric: string; up: number; down: number }>();
        for (const r of rows) { const c = m.get(r.metric) ?? { metric: r.metric, up: 0, down: 0 }; if (r.vote === 1) c.up++; else c.down++; m.set(r.metric, c); }
        void sql; return { results: [...m.values()] as unknown as T[] };
      },
      sql, v,
    }) }),
    batch: async (stmts) => { for (const s of stmts as { run(): Promise<unknown> }[]) await s.run(); },
  };
  return { db, rows };
}
const ORIGIN = "https://dayset.github.io";
const env = (db?: D1Like): Env => ({ DB: db, ALLOWED_ORIGINS: ORIGIN });
const post = (body: unknown, origin: string | null = ORIGIN) => new Request("https://api.test/v1/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: origin ? { origin } : {} });
const good = { app: "wotrep", v: 1, votes: { "card.impact": 1, "chart.wp": -1 } };

describe("wotrep-api", () => {
  it("health works without a database and reports it", async () => {
    const r = await handle(new Request("https://api.test/health", { headers: { origin: ORIGIN } }), env());
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ ok: true, db: false });
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
  it("stores one row per vote and summarises", async () => {
    const { db, rows } = fakeDb();
    const r = await handle(post(good), env(db));
    expect(r.status).toBe(201); expect(rows.map((x) => [x.metric, x.vote])).toEqual([["card.impact", 1], ["chart.wp", -1]]);
    const s = await handle(new Request("https://api.test/v1/feedback/summary"), env(db));
    expect((await s.json() as { metrics: unknown[] }).metrics).toHaveLength(2);
  });
  it("rejects bad shapes, bad ids, bad votes, huge bodies and non-JSON", async () => {
    const { db } = fakeDb(); const e = env(db);
    for (const b of [{ ...good, extra: 1 }, { ...good, votes: {} }, { ...good, votes: { "../x": 1 } }, { ...good, votes: { "card.dpm": 5 } }, { ...good, app: "other" }]) expect((await handle(post(b), e)).status).toBe(400);
    expect((await handle(post("nope"), e)).status).toBe(400);
    expect((await handle(post("x".repeat(5000)), e)).status).toBe(413);
  });
  it("blocks other browser origins and answers preflight for ours", async () => {
    const { db } = fakeDb();
    expect((await handle(post(good, "https://evil.example"), env(db))).status).toBe(403);
    const pf = await handle(new Request("https://api.test/v1/feedback", { method: "OPTIONS", headers: { origin: ORIGIN } }), env(db));
    expect(pf.status).toBe(204); expect(pf.headers.get("access-control-allow-methods")).toContain("POST");
  });
  it("503 when storage is missing, 429 when rate limited, 404 for unknown routes", async () => {
    expect((await handle(post(good), env())).status).toBe(503);
    const { db } = fakeDb();
    expect((await handle(post(good), { ...env(db), LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
    expect((await handle(new Request("https://api.test/nope"), env(db))).status).toBe(404);
  });
});
