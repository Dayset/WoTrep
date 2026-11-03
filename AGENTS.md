# AGENTS.md — how agents work on WoTrep together

Many agents work on this repo at the same time. These rules keep you from colliding, keep the contracts stable,
and make every PR easy to merge. Follow them literally. If a rule blocks you, say so in the issue — don't work around it.

## 0. Read first (in this order)

1. `README.md` — what we build.
2. `docs/DESIGN.md` — architecture, package layout, dependency direction.
3. The contract(s) your issue touches: `docs/contracts/battle-timeline.md`, `findings.md`, `commander.md`.
4. Your issue, its epic, and every issue it says **Blocked by**.
5. Topic docs as needed: `REPLAY_FORMAT.md`, `METRICS.md`, `COACHING.md`, `COMMANDER.md`, `UX.md`, `GUIDES.md`.

## 1. How work is organised

- **Epic** issues (label `epic`, title `[E4] …`) describe a whole area and list their tasks as a checklist.
- **Task** issues (title `[E4-03] …`) are one PR each. They say: Goal, Scope, Out of scope, **Owns**, Interfaces,
  Acceptance criteria, How to verify, Blocked by.
- **Milestones** M0–M5 (see `docs/ROADMAP.md`) set the order. Prefer the lowest open milestone.
- Labels: `area:*` (which package), `type:*`, `size:S|M|L` (S ≈ < 200 lines, M ≈ < 600, L = may need splitting),
  `prio:P0|P1|P2`, `junior-agent` (self-contained, good for smaller agents), `needs-owner` (a human decision or
  file is needed), `contract-change`, `status:claimed`, `status:blocked`, `status:review`.

## 2. Claiming a task (prevents two agents doing the same work)

1. Pick an open task with no assignee and no `status:claimed` label, whose **Blocked by** issues are closed
   (or whose blockers you can stub — see §5).
2. Comment exactly: `claim: <your-agent-name> — plan: <one line>` and add the label `status:claimed`.
   If two claims land, the **earlier comment wins**; the later agent un-claims and picks something else.
3. Create branch `e<epic>-<nn>-<short-slug>` (e.g. `e4-03-units-layer`) from the latest `main`.
4. Push at least once every 24 h while working. A claim with no pushed commit for **48 h** may be taken over:
   comment `takeover: <name>` and continue from the branch if it exists.
5. If you stop before finishing, comment a **handoff note**: what is done, what is left, where the branch is,
   and remove `status:claimed`.

## 3. File ownership (prevents merge conflicts)

- Your issue's **Owns** list is the set of paths you may create or change. Everything else is read-only for you.
- Allowed outside your list without asking: adding a dependency to *your own* package's `package.json`, adding
  i18n keys to `apps/web/src/i18n/*.json` (append-only, keep keys sorted inside your feature's block), adding a
  fixture file under `fixtures/` with a new name.
- Root files (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/*`, eslint config)
  belong to `area:infra` issues. Need a change? Open a small `area:infra` issue and link it.
- **Lockfile conflicts:** never hand-merge `pnpm-lock.yaml`. Rebase on `main`, run `pnpm install`, commit the result.
- Need a change in another package's public API? Open an issue in that area, describe the need, and code against a
  local adapter until it lands. Do not edit their files.

## 4. Contracts (the shapes everyone shares)

| Contract | Doc | Code | Owner |
|---|---|---|---|
| BattleTimeline v1 | `docs/contracts/battle-timeline.md` | `packages/model/src/timeline.ts` | E2 |
| Finding v1 | `docs/contracts/findings.md` | `packages/coach/src/finding.ts` | E7 |
| CommanderCall v1 | `docs/contracts/commander.md` | `packages/commander/src/call.ts` | E8 |
| Version manifest | `docs/REPLAY_FORMAT.md` §6 | `packages/defs/src/manifest.ts` | E1 |

Changing a contract: open an issue labelled `contract-change` with the proposed diff, the reason and the list of
consumers affected; add an ADR in `docs/adr/`; wait for owner approval; then **one** PR changes the doc, the types,
the fixtures and every consumer together. Adding an **optional** field is the only change allowed without this,
and still needs the doc updated in the same PR.

## 5. Working in parallel with stubs

- `fixtures/timelines/*.json` are valid `BattleTimeline v1` files (built from the Python probe by E0-04). UI, analysis,
  coach and commander agents use them **before the TS parser exists**.
- `packages/gamedata/stub/` holds hand-written vehicle/map data for the fixture tanks and map (E3 replaces it).
  Code must read gamedata through `packages/gamedata`'s API, never from a hard-coded table in your package.
- If a blocker is open but its interface is in a contract, you may start; note "built against contract, not
  implementation" in the PR.

## 6. Branches, commits, PRs

- One task = one branch = one PR. Title: `[E4-03] Units layer with fog ghosts`. Body: `Closes #<n>`, what changed,
  how you verified it, screenshots or a short GIF for any UI change.
- Keep PRs small (aim < 400 changed lines excluding fixtures). Split larger work and say so in the issue.
- Rebase on `main` before asking for review; CI must be green. Squash-merge.
- Commit messages: imperative, short (`parser: decode updateArena kills`).
- Merging: the owner or a designated reviewer agent merges. Label the PR `status:review` when ready.

## 7. Definition of done (every task)

- [ ] Acceptance criteria in the issue all met, ticked in the PR body.
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` pass locally and in CI.
- [ ] Tests cover the new behaviour; fixture-based where possible.
- [ ] No string literals in UI (i18n keys, `en` + `ru`; mark untranslated RU with `"// TODO ru"` in the PR, not in JSON).
- [ ] Docs updated if behaviour or a number changed (the doc next to the code or in `docs/`).
- [ ] Any new number shown to players has a glossary entry: how we get it and what it means (`docs/METRICS.md` §3.8, `gl.<key>.how/.mean` in en + ru, `METRIC_KEYS`).
- [ ] Performance budgets from `docs/DESIGN.md` §4 still hold for your step.
- [ ] Nothing in `realName`/anonymized account ids leaves the parser worker.

## 8. Code rules

- TypeScript `strict`, ESM, no `any` in exported APIs. Python only in `tools/`.
- Analysis, coach and commander code is **pure**: no I/O, no `Date.now()`, no randomness. Same input → same output.
- **Every threshold lives in a config file with provenance** (`value`, `why`, `n`, `date`). "Initial guess" is a valid
  `why` until E13 recalibrates it. No magic numbers inside logic.
- Replay data is untrusted: bound every length, never `eval`, the pickle decoder is whitelist-only.
- No new runtime dependency without one line in the PR explaining why; prefer small, maintained, MIT/Apache.
- Respect the dependency direction in `docs/DESIGN.md` §3 (lint enforces it).

## 9. Product rules (wording and fairness)

- Exact numbers, never letter grades. Short text: title + ≤ 2 lines + one fix.
- Never write "cheater", "noob" or similar. Impossible numbers → "flagged: impossible stats".
- Judge decisions only on what the recorder could know at that second (fog-of-war fair).
- Separate luck from mistakes (`Finding.luck`).
- Show the in-battle name only; respect the anonymizer everywhere (REPLAY_FORMAT §8).
- Flat UI, sharp square corners, tables with pinned header and first column, collapsible blocks, phone-friendly.

## 10. Golden fixtures

- `fixtures/expected/*.json` are produced by tools (the probe, snapshot tests). **Never hand-edit them to make a test
  pass.** If an expected value changes, regenerate it and explain in the PR why the old value was wrong.
- New replay fixtures: name `<realm>-<version>-<map>-<tank>.<ext>`, add a line to `fixtures/README.md` (what is special
  about it: death, platoon, unfinished, encounter mode…).

## 11. When you find something

- New work outside your scope → open an issue (task template), link the epic, don't grow your PR.
- A decision only a human can make (legal, money, API keys, game files, priorities) → label `needs-owner`, state the
  options and your recommendation in 3 lines, and continue with the parts that don't depend on it.
- Something in the docs is wrong → fix the doc in your PR if it's in your area, otherwise open a `type:docs` issue.

## 12. Smaller (junior) agents

Tasks labelled `junior-agent` are self-contained: everything you need is in the issue and the files it links.
If you find it is not, comment what is missing instead of guessing, and pick another task.
