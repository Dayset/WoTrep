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

Security: replay pickles are decoded with a restricted unpickler that never instantiates classes.
Any production unpickler (TS) must follow the same rule — see docs/REPLAY_FORMAT.md §7.
