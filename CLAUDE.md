# OVERPOWERED 2 — agent guide

Read this first, then `docs/HANDOFF.md` (current state, pending work, open questions). `docs/DESIGN.md` is the source of truth for
what the game is; `docs/notes/<area>.md` documents each system as built.

## What it is

OVERPOWERED 2: OVERDRIVE is a fast browser FPS, a ground-up sequel to the owner's first game. Momentum movement (dash, slide, wall
run, bunny hop), dismemberment and real ragdolls, escalating streaks and call-ins (airstrike, Warthog, AC-130, nuke), a shop
("Procurement") with weapons, mods, implants and brain chips. Modes are "contracts" (`src/contracts/data.ts`): campaign missions
(The Outpost, Foreclosure), The Crucible (zombies, truly endless), Endless Humans (id `outpost`, ends at round 10), Outpost
Defense, and Retraining (the tutorial; first launch goes there). Co-op for up to 4 over WebRTC. Everything is procedural: no
third-party art. A deadpan bureaucratic voice ("Galactic Council / Office of Societal Compliance") runs through the UI copy.

**Stack:** TypeScript (tsc 7), Vite 8, three.js r187 (WebGL2), Rapier 3D compat 0.21, trystero 0.27 (WebRTC over Nostr), Vitest 5,
playwright-core (screenshots). No other runtime deps without a strong reason.

## Setup on a fresh machine

- **Node 22** (the Pages CI uses 22). `npm ci`.
- Dev server: `npm run dev` (Vite, 127.0.0.1, port 5173, `strictPort: false`). Agents use their own port, see Safety.
- Build: `npm run build` (= `tsc --noEmit && vite build`). Typecheck alone: `npx tsc --noEmit`.
- Tests: **one file at a time**, never the whole suite (too heavy for the owner's 8 GB machine, and slow anywhere):
  `nice npx vitest run src/weapons/flail.test.ts --testTimeout=60000`. Judge a failure in a clean worktree
  (`git worktree add <scratch>/wt-x HEAD`, symlink `node_modules`, apply your diff) before blaming your change.
- Screenshots: `npx playwright-core install chromium` once, then `tools/shot.mjs` (see Tools).
- **Music:** `public/audio/music/` (the owner's placeholder songs, commercial releases, ~360 MB) is git-ignored and absent in a
  clone. Only its `manifest.json` is tracked. The game runs fine without it. **Never commit or ship those files.** The game's own
  tracks live in `public/audio/ost/` (tracked). The public site plays no music at all: `.github/workflows/pages.yml` empties both
  manifests before building. See `docs/notes/audio.md`, "Music".
- URLs: `/` is the game; `/?sandbox=<name>` loads `src/sandbox/<name>.ts` (one isolated test page per system).

## The owner

- The game's designer (GitHub `jaredb650`, repo `overpowered2`, branch `dev`). Tests by playing.
  **Trust their playtest reports.**
- Talks by **voice dictation**: expect typos and misheard words ("core system" = gore system, "cat" = capture). Read intent, not
  letters; ask only if two readings lead to different work.
- Wants **plain words, short reports, no jargon**. Report: commit hash, what changed with numbers, test results, screenshot paths,
  anything not done or not checked. Never say something is done when only part is built.
- **Orchestrator mode:** the main agent does not do the work itself, not even one-liners, unless the owner asks it to. Every request
  goes to a background agent with a tight brief (files it may touch, these rules); the main agent briefs, reviews diffs, tests and
  screenshots, then reports. The owner fires off small tweaks mid-play; never make a new request wait on a long job. Don't run
  two agents on the same files at once: queue, or route the request to the agent already working there.
- **Strongest agents only** ("don't pass it to shittier agents"): Opus, high effort, for every agent. Usage is not a concern.
  If the host offers another provider (e.g. Codex via `delegate_task`), it is fine for research, specs, reviews, networking and
  logic, but **never visual work** (gun models, hand poses): it was rejected twice.
- Missions: the owner loved mission 1 and hated Foreclosure v1 ("incoherent"). Wants a villain who controls the level and reacts,
  set pieces that force a way of playing, clear dialogue, a clear gated route through distinct places, enough enemies for the big
  tools. Write scripts plainly, villain-first; get the owner's OK on a script before building. Say "sections", not "beats".

### Pushing (deploys the public site)

**Push only when the owner says "push".** Every push to `dev` rebuilds and publishes the friends' site
https://jaredb650.github.io/overpowered2/ (GitHub Pages, `.github/workflows/pages.yml`). Commit locally otherwise. Procedure:
1. Pin the exact SHA to push; check it fast-forwards `origin/dev` (`git merge-base --is-ancestor origin/dev <sha>`).
2. In a clean worktree at that SHA: `npx tsc --noEmit`, `npm run build`, and the relevant Vitest files one at a time.
3. Audit `dist/`: under `audio/music` only `manifest.json`; no secrets or keys; no file over 5 MB.
4. `git push origin <sha>:dev`; wait for the Pages run to finish (`gh run list --workflow pages.yml`).
5. Grep the live JS chunk for a string from the change to prove it shipped.

## Game facts — never get these wrong

- **There is no sprint. Shift = DASH.** There is **no ADS sway**. Holding Shift while aiming down sights = "focus" zoom only,
  capped at 3.5 s with a cooldown (hold-breath style; `src/weapons/adsZoom.ts`).
- **Bullet weapons have no spread** (owner's design; bullets go where the crosshair is). Never add spread or use it as a balance lever.
- **Shotguns are the exception: they keep pellet spread** (pump, Thresher, Deuce, any pellet gun). Never zero, flatten or "fix"
  shotgun spread, and never touch a shotgun spread value unless asked. The Thresher's slightly tightened spread stays.
- **Endless Humans is not endless: it ends at round 10** (`FINAL_WAVE = 10`, `src/enemies/commander/adaptations.ts`). Every unlock
  there must land by the break after wave 9: `lockWave()` in `src/contracts/shop/data.ts` maps a ware's wave to
  `min(FINAL_WAVE - 1, ceil(wave / 2))` for contract `outpost`. Crucible ("Crucible mode" in UI) is truly endless with slower unlocks.
- **Prisoner capture stays as designed:** 0.4 s hold to capture, released by a second tap. Prompt: "Tap [E] to question · Hold [E]
  to capture" with a fill ring. Questioning reveals nearby enemies. Capture pays about 300 in Endless Humans.
- Player text says **"brain chip"**, never just "chip". Brain chips (key T): Sonar, Thermal, Focus, Gun Kata (`src/contracts/chips.ts`).
- **Enemies never despawn** (flee rework: cornered enemies surrender, fight, fake-surrender with a grenade, cower, taunt, rarely
  suicide). Released prisoners may walk off and vanish; that's fine.
- **Slow-mo in co-op is parked.** Focus is disabled in co-op ("NO FOCUS BRAIN CHIP IN CO-OP"); keep it so until the owner picks a
  design. Research and options: `docs/research/coop-slowmo.md` (recommended "Team Focus").
- Mods are bought and fitted in the shop, never swapped mid-fight. Same-slot mods exclude each other; different slots stack.
- Original content only: no recreations of existing games, characters or levels; no real-world logos or brands. Real guns and
  other games are inspiration only.

## Hard safety rules

- **Music:** never commit, stage or ship anything under `public/audio/music/` except `manifest.json` (`src/audio/music.test.ts`
  checks git). Never `git add -A` (see Git).
- **Secrets:** the ElevenLabs voice key is kept outside the repo on the owner's Mac. Never print, log, copy or commit any key. No
  voice generation without the owner's approval. `.env*` is git-ignored; keep it that way.
- Never put the owner's email or personal details into any external service, request or commit body.
- **Port 5173 is the owner's dev server.** Never start, stop or reload anything on it. Run your own Vite on your own port with
  `OP2_NO_HMR=1` (turns HMR off so you never reload the owner's game), e.g. `OP2_NO_HMR=1 npx vite --port 5270 --strictPort`,
  and stop it when done. Kill only processes you started.
- **Browser:** one browser at a time (the owner's machine is an 8 GB M1; keep the habit). Before `tools/shot.mjs` run
  `pgrep -fl "^node tools/shot.mjs"` and wait if one runs. Never drive the owner's Google Chrome app: Playwright
  `channel: 'chromium'` only (shot.mjs does this). If a headless Chrome ever hijacks the owner's Chrome, kill only processes whose
  command line has `--headless`. Render at **dpr 2, 1440x900** (the owner's Retina screen).
- Screenshots and probe output go to `tools/out/<your-folder>/` (git-ignored, not linkable from the repo).

## Git: several agents share one checkout

- Commit on `dev` directly. **Never** `git add -A`, `git add .`, `git commit -a`, `git stash`, `git checkout -- <file>` on shared
  files, or anything that rewrites others' uncommitted work.
- Other agents' uncommitted edits sit in the same files. Stage only your own hunks through a **private index**:
  ```sh
  export GIT_INDEX_FILE=<scratch>/idx-<you>       # a scratch folder outside the repo
  OLD=$(git rev-parse refs/heads/dev)              # the HEAD you build on
  git read-tree "$OLD"                             # right before staging, never earlier
  git apply --cached my-hunks.patch                # or: git update-index --add <your new file>
  git diff --cached "$OLD" --name-only             # must list ONLY your files
  git diff --cached "$OLD"                         # must show ONLY your lines
  TREE=$(git write-tree)
  [ "$TREE" = "$(git rev-parse "$OLD^{tree}")" ] && { echo "empty commit, stop"; exit 1; }
  NEW=$(git commit-tree "$TREE" -p "$OLD" -F msg.txt)
  git update-ref refs/heads/dev "$NEW" "$OLD"      # compare-and-swap: fails if a peer moved dev
  unset GIT_INDEX_FILE; git reset -q -- <your paths>   # resync the shared index
  ```
  Plain `git commit` with a stale index can silently revert a peer's commit; it has happened more than once. If `update-ref` fails,
  redo from `OLD=` on the new HEAD.
- zsh does not word-split unquoted `$FILES`: pass paths as separate words or an array, and keep the empty-tree guard above.
- **Leftovers on the owner's Mac** (not in a clone): uncommitted edits in `docs/notes/viewmodels.md`, `docs/notes/weapons.md`,
  `src/core/gameplay.ts`, `src/weapons/Weapons.ts`, `src/weapons/mods.ts` and an old stash. The owner hasn't decided; never stage them.
- Commit message: one plain sentence of what changed and why, then the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use the model that actually did the work). Do not push (see Pushing).

## Codebase map

Systems talk through `Ctx` (`src/core/contracts.ts`) and events; only `core/Game.ts` and sandboxes import concrete classes.
Clocks: `ctx.time` only (`dt` world, `playerDt` player and weapons, `realDt` UI); no `performance.now()`/`setTimeout` in gameplay.
No allocation in hot paths; pool everything with hard caps. Frame order and budgets: `docs/DESIGN.md` section 4.

| Path | What | Notes |
|---|---|---|
| `src/main.ts` | Entry: error capture, chunk-load retry, one-tab lock, sandbox routing, boot | `docs/notes/ui.md` |
| `src/core/` | `Game.ts` composition root and uncapped rAF loop; `contracts.ts` (Ctx); `gameplay.ts` (WeaponId, ModId); `cheats.ts`; `errors.ts`/`report.ts` (error reports); `oneTab.ts` (`claimTab`) | `docs/DESIGN.md` |
| `src/player/` | Movement (dash, slide, wall run, climb, vault, jump jet), camera rig, `tuning.ts` | `docs/notes/player.md` |
| `src/input/` | Bindings, input | `docs/notes/player.md` |
| `src/weapons/` | `data.ts` (TUNING, `bossHit`), `Weapons.ts`, `mods.ts`, one file per special (lance, kata, flak, helix, raufoss, smartaim...), `melee/`, `viewmodels/` (`models/<gun>.ts`, `kit/model.ts`, `poses.ts`, `rig.ts`) | `docs/notes/weapons.md`, `docs/notes/viewmodels.md`, `docs/proposals/weapons-update.md` |
| `src/enemies/` | Enemy data, AI, damage, armour, waves, bosses; `outpost/` human soldiers (squads, cover, morale, capture, prisoners); `commander/` the villain director (`FINAL_WAVE`); `vehicles/` | `docs/notes/enemies.md`, `outpost.md`, `commander.md`, `vehicles.md` |
| `src/characters/` | SDF-baked models, rig, animation, anatomy, implants on the body | `docs/notes/characters.md` |
| `src/gore/` | Ragdolls (Rapier), severing, slicing, gibs, blood, wounds, muscles | `docs/notes/gore.md`, `wounds.md`, `docs/proposals/gore-ragdoll-proposals.md` |
| `src/fx/` | GPU particles, layers, recipes, stains | `docs/notes/fx.md` |
| `src/render/` | Renderer, post, materials, light volume, decals, dynamic lights, quality | `docs/notes/render.md` |
| `src/world/` | Maps (`map/`: `annex/` = Retraining, `fort/` = Defense, Holdfast = Foreclosure), kit, nav, breakables | `docs/notes/world.md`, `holdfast.md` |
| `src/contracts/` | Modes (`data.ts`), `shop/` (Procurement: `data.ts` wares, `lockWave`), `chips.ts` brain chips, loadouts, starters, `firstLaunch.ts`, `defense/` (Outpost Defense) | `docs/notes/contracts.md`, `fort.md` (Defense map) |
| `src/progression/` | Streaks, perks, `implants.ts`, stims, score, `callins/` (airstrike, Warthog, AC-130, choppers, nuke), `pickups/` (`pods.ts` supply pods) | `docs/notes/progression.md`, `docs/proposals/implants.md`, `air-support.md` |
| `src/campaign/` | Mission runner, cutscenes, parkour, `missions/` (outpost, foreclosure, retraining + `.lines.ts` dialogue) | `docs/campaign/*.md`, `docs/design/tutorial.md` |
| `src/allies/`, `src/frame/`, `src/vehicles/` | Squad allies; the Distraint Frame (mech); flyable/gunner vehicles | `docs/notes/allies.md`, `frame.md`, `vehicles.md` |
| `src/net/` | Co-op: lobby, session, `authority.ts` (host validates guest hit claims), `world.ts`/`worldProtocol.ts` (snapshots), `pose.ts`, `turn.ts` (TURN relay URL, empty) | `docs/notes/coop.md`, `coop-audit.md`, `docs/research/coop-netcode.md` |
| `src/audio/` | Engine, `catalog.ts` (every sound id), music playlist, synth, voices | `docs/notes/audio.md`, `docs/CREDITS.md` |
| `src/ui/` | HUD, menus (DOM + CSS), settings, `backdrop/gunstage.ts` (shop studio turntable), commander UI, error report | `docs/notes/ui.md` |
| `src/lab/` | Test Range and dev/cheat panel (`/?map=range`, `?dev=1`): mod rows (`mods.ts`), implants, spawn, settings; flags in `src/core/devflags.ts` | `docs/notes/lab.md` |
| `src/sandbox/` | `/?sandbox=<name>` test pages | |
| `tools/shot.mjs` | Headless screenshot harness (Playwright chromium) | header comment lists options |
| `tools/scripts/` | ~160 probe/bot scripts for shot.mjs; `coop-kit.mjs` (`startPair`, two-page co-op proofs) | |
| `tools/bake/` | Offline character model bake (`npm run bake`) → `public/assets/` | `docs/notes/characters.md` |
| `tools/music/`, `tools/turn-worker/` | Soundtrack renderer; Cloudflare Worker for TURN relay + error log (not deployed) | `docs/notes/audio.md`, `docs/notes/coop.md` |
| `docs/` | `DESIGN.md`, `NEXT.md` (older playtest brain dump), `HANDOFF.md`, `notes/`, `proposals/`, `research/`, `campaign/`, `original/` (spec of game 1), `voice/` | |

Global co-op model: host-authoritative. Guests send hit claims; the host validates (`src/net/authority.ts`) and sends hit/sever/kill
events; guests run their own cosmetic gore. World snapshots every 100 ms (frame-gated, so fewer at low host fps), poses 20 Hz.
`bossHit()` turns an instakill (≥ 9999) on a boss into a 900 hit, for host and guest alike. Same-Wi-Fi routers can block peers; the
game tells the player. One game tab per browser (`claimTab`).

## Conventions

**Cheats:** open with the password `imalittlecheater` (`src/core/cheats.ts`; case, spaces and apostrophes ignored).

**Adding a weapon mod / weapon / brain chip / implant** — every one needs all of:
1. A shop row in `src/contracts/shop/data.ts` (price, wave lock, a deadpan catalogue line in the existing voice). Check the lock
   via `lockWave`: it must unlock **before round 10 in Endless Humans** (incl. the Office variant). Crucible may be slower.
2. A cheat-panel (lab) row (`src/lab/mods.ts`, `src/lab/implants.ts`, or the matching panel list).
3. A Vitest test next to the code (see `src/weapons/*mods.test.ts`, `src/contracts/chips.test.ts`, `src/progression/implants.test.ts`).
4. Visuals on the first-person viewmodel **and** the shop studio model (`src/ui/backdrop/gunstage.ts` shows the same model parts).
5. Notes updated in `docs/notes/weapons.md` / `viewmodels.md` / `progression.md`.
6. Co-op: if others should see it (third-person FX, beams, call-ins), say whether it replicates; most effects are shooter-only today.

**Model quality bar (any geometry):** real form, never boxes. Bevelled 2D profiles (house mesher or `THREE.Shape` +
`ExtrudeGeometry` with bevel), chamfers, cut-outs, 2–3 contrasting materials, glow only as thin inset lines. No real logos.
No rolling or twisting in gun animations. Keep hand grips correct (`model.hand`, `model.pistolSupport` in
`src/weapons/viewmodels/kit/model.ts`); check close-ups at dpr 2. Art direction: cold blue world, warm colour only for what the
player does; blood saturated red (`docs/DESIGN.md` section 3).

**Sounds:** every catalog id is listed in `docs/notes/audio.md`. Owner-supplied files are **copied, never moved** from their
Downloads; they may be WAV inside `.mp3`. Trim the lead-in, level by measured loudness, credit in `docs/CREDITS.md`, re-render the
audio report if the catalog changes, run `src/audio/audio.test.ts`.

**Docs:** each system's note in `docs/notes/` is kept current with what was built (numbers, file names). Proposals go in
`docs/proposals/`, outside research in `docs/research/`. Never link scratch paths or `tools/out/` from docs as if they persist.

## Tools

- `node tools/shot.mjs --port <your port> --url "/?sandbox=gore" --out tools/out/<you>/x.png --dpr 2 --w 1440 --h 900 [--script tools/scripts/foo.mjs] [--eval "<js>"]`.
  **Always pass `--port`:** the default is 5173 (the owner's). If nothing answers on the port, it starts a private Vite on 5199
  with HMR off and closes it after.
- `tools/scripts/coop-kit.mjs` `startPair`: two pages in one browser, real WebRTC. **Broken on a fresh profile** (first launch goes
  into Retraining); fixing it is in co-op batch 1.
- Page hooks: `window.__op2.game` (state, setState) for scripts.

## Current state

See `docs/HANDOFF.md`: what's live vs local-only, pending batches, open owner questions, known broken things.
