import { handle, type Env } from "./handler";
export { handle } from "./handler";
export type { Env } from "./handler";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await handle(req, env); } catch { return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: { "content-type": "application/json" } }); }
  },
};
