import { validateTimeline, type BattleTimeline, type VehicleInfo } from "@wotrep/model";
import { fingerprintManifest, resolveManifest, type Manifest } from "@wotrep/defs";
import { readContainer } from "./container";
import { ParseError } from "./errors";
import { walkPackets } from "./packets";
import { dispatchCalls, findAvatar } from "./entities";
import { buildTracks } from "./positions";
import { decodeCamera, decodeChat, decodeEvents, findBattleStart, updateArena } from "./events";
import { anonymizedVids } from "./privacy";
import { killsFromResults, normalizeResults } from "./results";
import { killsFromPackets } from "./wgkill";

const KNOWN = new Set([0x00, 0x01, 0x02, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x0d, 0x0f, 0x11, 0x12, 0x15, 0x16, 0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x1d, 0x1f, 0x20, 0x22, 0x23, 0x24, 0x26, 0x28, 0x2b, 0x2d, 0x2e, 0x30, 0x31, 0x32, 0x35, 0x36, 0x37, 0x3d, 0xffffffff]);

async function sha256(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as unknown as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Replay bytes → BattleTimeline v1, or a typed ParseError. Pure: runs in a Worker or Node.
 *  `opts.manifests` replaces the built-in manifest set (empty = none: the fingerprint fallback
 *  applies). Absent, resolution is exactly as before. */
export async function parseReplay(bytes: Uint8Array, fileName?: string, opts?: { manifests?: Manifest[] }): Promise<BattleTimeline> {
  const { blocks, packets: raw } = readContainer(bytes);
  const b0 = blocks[0] as any, b1 = blocks[1];
  if (!b0?.vehicles) throw new ParseError("BadBlock", "container", "block 0 has no vehicles");
  const realm: "wg" | "lesta" = /\.mtreplay$/i.test(fileName ?? "") || /Мир танков/.test(b0.clientVersionFromXml ?? "") ? "lesta" : "wg";
  const version: string = b0.clientVersionFromExe ?? "";
  const res = resolveManifest(realm, version, [], opts?.manifests !== undefined ? { builtIns: opts.manifests } : {});
  const warnings: string[] = [];
  const walk = walkPackets(raw); warnings.push(...walk.warnings);
  const unknown: Record<string, number> = {};
  for (const p of walk.packets) if (!KNOWN.has(p.type)) { const k = `0x${p.type.toString(16)}`; unknown[k] = (unknown[k] ?? 0) + 1; }
  const vehicleIds = new Set(Object.keys(b0.vehicles).map(Number));
  const av = findAvatar(walk.packets, vehicleIds);
  if (!av) throw new ParseError("BadBlock", "entities", "recorder avatar not found");
  const nr = normalizeResults(b1);
  let manifest = res.manifest;
  if (!res.manifest) {
    // No manifest: guess the three basic methods from payload shapes (E1-14). The probe pass
    // uses a throwaway unknown-counter so unnamed calls don't pollute diagnostics.
    const unnamed = dispatchCalls(walk.packets, { ...av, vehicleIds }, null, {});
    const fp = fingerprintManifest(unnamed, {
      vehicleIds, recorderVid: av.recorderVid,
      recorderDamageDealt: nr?.results.players[av.recorderVid]?.damageDealt ?? 0,
      realm, version,
    }, updateArena);
    if (fp) { manifest = fp.manifest; warnings.push(`no manifest for ${realm} ${version}; using fingerprint draft (partial support)`); }
    else warnings.push(res.reason);
  }
  const calls = manifest ? dispatchCalls(walk.packets, { ...av, vehicleIds }, manifest, unknown) : [];
  const t0 = manifest ? findBattleStart(calls, manifest) : null;
  if (t0 == null) warnings.push("battle start (arena period 3) not found; using clock 0");
  const T0 = t0 ?? 0;
  const anon = anonymizedVids(Array.isArray(b1) ? b1[0] : undefined);
  const vehicles: VehicleInfo[] = Object.entries<any>(b0.vehicles).map(([k, v]) => {
    const vid = Number(k), a = anon.has(vid);
    return { vid, team: v.team, name: v.name, anonymized: a, ...(!a && v.clanAbbrev ? { clan: v.clanAbbrev } : {}),
      ...(!a && nr?.accountOf[vid] ? { accountId: nr.accountOf[vid] } : {}), vehicleType: v.vehicleType, maxHealth: v.maxHealth, isRecorder: vid === av.recorderVid };
  });
  const events = [...(manifest ? decodeEvents(calls, manifest, T0) : []), ...decodeChat(walk.packets, T0)].sort((a, b) => a.t - b.t);
  if (nr && t0 != null && !events.some((e) => e.k === "kill")) {
    // No kill message decoded for this client version: rebuild kills from the results block (see killsFromResults).
    const fromPk = killsFromPackets(walk.packets, vehicleIds, T0), have = new Set(fromPk.map((e) => (e.k === "kill" ? e.victim : -1)));
    const derived = killsFromResults(nr.results).filter((e) => e.k === "kill" && !have.has(e.victim));
    if (fromPk.length) warnings.push(`kills read from 0x37 packets: ${fromPk.length}`);
    if (derived.length) warnings.push(`kills derived from battle results (time within +-0.5 s): ${derived.length}`);
    if (fromPk.length || derived.length) { events.push(...fromPk, ...derived); events.sort((a, b) => a.t - b.t); }
  }
  const rec = vehicles.find((v) => v.isRecorder)!;
  const tracks = buildTracks(walk.packets, vehicleIds, T0);
  // No results block (some replays end without one): estimate the length from the last recorded event or position.
  let durationS: number | null = nr?.common.duration ?? null;
  if (durationS == null) {
    const lastEvent = events.reduce((m, e) => Math.max(m, e.t), 0);
    const lastTrack = Object.values(tracks).reduce((m, tr) => Math.max(m, tr.t.at(-1) ?? 0), 0);
    durationS = Math.max(lastEvent, lastTrack);
    if (durationS > 0) warnings.push(`duration estimated from the last recorded sample: ${Math.round(durationS)} s`);
    else durationS = null;
  }
  const tl: BattleTimeline = {
    schema: "wotrep.timeline/1",
    source: { realm, regionCode: b0.regionCode, server: b0.serverName, clientVersion: version,
      manifest: { id: manifest?.id ?? "none", confidence: !manifest ? "none" : manifest.confidence === "defs" ? "defs" : "fingerprint" },
      ...(fileName ? { fileName } : {}), hasMods: !!b0.hasMods, sha256: await sha256(bytes) },
    arena: { arenaUniqueId: String(b0.arenaUniqueID), map: b0.mapName, mapDisplayName: b0.mapDisplayName, gameplay: b0.gameplayID, battleType: b0.battleType,
      startedAt: b0.dateTime, durationS, winnerTeam: nr?.common.winnerTeam ?? null, finishReason: nr?.common.finishReason ?? null, battleStartClock: T0 },
    recorder: { vid: av.recorderVid, team: rec.team, name: b0.playerName },
    vehicles, tracks, events, camera: decodeCamera(walk.packets, T0),
    ...(nr ? { results: nr.results } : {}),
    diagnostics: { unknownPacketTypes: unknown, warnings },
  };
  const v = validateTimeline(tl);
  if (!v.ok) throw new ParseError("BadBlock", "events", `timeline failed validation: ${v.errors.slice(0, 3).join("; ")}`);
  return tl;
}
