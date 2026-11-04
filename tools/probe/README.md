# tools/probe — reference decoder (Python, not production)

A throwaway-quality but **working** decoder written while analysing the first replay.
Production parsing lives in `packages/parser` (TypeScript). Use this probe as an oracle:
when your TS parser disagrees with it, one of the two is wrong — find out which, don't guess.

```bash
pip install cryptography
python3 -I tools/probe/wotrep_probe.py fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay /tmp/out
```

Outputs `meta.json`, `histogram.json`, `timeline.json`, `expected.json`.
`fixtures/expected/*.expected.json` are produced by this script. Never hand-edit them.

`tracer_audit.py` (issue #31) reuses this probe's packet walk to audit tracer accounting:
per-shooter `showTracer` counts vs distinct `shotId`s vs results `shots`, duplicate shows,
`stopTracer`/`explodeProjectile` coverage, and `showShooting` burst counts. It asserts the
fixture's headline numbers (recorder: 61 shows, 59 distinct shots, 59 results shots) and
exits nonzero if they do not reproduce:

```bash
python3 tools/probe/tracer_audit.py fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json
```

Security: replay pickles are decoded with a restricted unpickler that never instantiates classes.
Any production unpickler (TS) must follow the same rule — see docs/REPLAY_FORMAT.md §7.
