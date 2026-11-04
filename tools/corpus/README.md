# Corpus CLI (E13-01)

Batch-parse a folder of replays, analyse each one, and write one JSON object per replay
(NDJSON). Calibration and benchmarks (#62, #69, #70, #98, #124) read this file, not the
replays.

## Run

```bash
pnpm corpus <folder> --out results.ndjson   # write to a file
pnpm corpus <folder>                        # NDJSON to stdout, logs stay on stderr
```

`<folder>` is walked recursively. Accepted files: `.wotreplay`, `.mtreplay` (TS parser) and
`.timeline.json` (validated, no parsing). Hidden files and directories are skipped. Files are
processed in sorted order, so output is deterministic for the same folder.

Failures are skipped, never fatal: each prints `FAIL <file> [<stage>] <error>` to stderr, and
the run ends with `<ok> ok, <failed> failed` on stderr. Stages are `read` (could not read the
file), `parse` (replay did not parse, or the timeline JSON is invalid) and `analyse`
(analysis threw). Exit code is 0 when at least one replay succeeded, 1 otherwise (including
bad arguments, an unreadable folder, and no replay files found).

## Record schema: `wotrep.corpus/1`

One line per replay:

| Field | Meaning |
|---|---|
| `schema` | Always `wotrep.corpus/1`. |
| `file` | Base name of the input file. |
| `arena` | `map`, `mapDisplayName`, `durationS` (null when unfinished), `winnerTeam` (0 = draw, null = unfinished), `battleType`. |
| `recorder` | The replay owner's `vid`, `name`, `team`. |
| `coverage` | How complete the replay data is (see METRICS §3.14): `damage`, `shots`, `ownSeen`, `enemySeen`, `killsDerived`, `level` (`good` / `partial` / `low`). |
| `players` | One row per vehicle in the battle: `vid`, `name`, `team`, official results (`damage`, `kills`, `assist`, `blocked`, `received`) and computed numbers (`dpm`, `share`, `accuracy`, `penRate`, `lifeS`, `impactPts`, `threatWeighted`). Any field is `null` when its input is missing (e.g. no results block) — rows are never dropped. |
| `findings` | Every detector finding, **unranked** (calibration needs the full set, not the report's top 5 + 3): `detector`, `vid`, `kind`, `tStart`, `tEnd`, `cost`, `confidence`. |
| `wp` | Win probability for the recorder's team: `{t, wp}` every 30 s plus the final second. `wp` is 0–1, rounded to 3 decimals. |

## Notes

- Numbers for non-recorder players carry the usual caveats: damage taken is partly unseen and
  positions are the recorder's view (see COACHING.md §5). `coverage` says how much of each
  replay was actually seen — filter on it before calibrating.
- New runtime dependency: `tsx` runs the TypeScript CLI without a build step. Everything else
  is a workspace package.
