# Co-op overhaul: plan, rules and progress (started 2026-11-18)

The owner's order: co-op must feel like a finished game, almost as smooth as single player, with single-player gameplay kept as it
is. Everything that happens on one screen happens on the others. This file is the plan and the running log. **Whoever resumes this
work reads this file first, then `docs/notes/coop-audit.md` (what is wrong today) and `docs/research/coop-netcode.md` section 5 (the
target design).** Keep the status table and the log at the bottom current.

## Owner decisions (final, do not re-ask)

1. **Blood on your own hits is instant** on a guest's screen: predicted, never waiting for the host. Add a **blood puff** on every
   bullet hit on flesh, in single player too: today enemies only spurt, and the owner wants a puff that sells the impact.
2. **Gore is computed on each client.** Never stream the host's gore. Corpses, gibs and ragdolls may land differently per screen.
3. **Slow-mo in co-op: one player slows everyone**, and everyone gets a notice saying who and what ("NAME used Focus"). No slow-mo
   may start on a screen without that notice. The Focus brain chip is enabled in co-op under this rule.
4. **Everything is shared and global:** dropped weapons (seen and picked up by anyone, so guns can be shared), the same supply
   drop for everyone, streaks and call-ins for everyone (any player calls them, every screen sees the aircraft, beams and effects),
   weapon effects such as the Lance beam on every screen. If something draws on one screen only, make it draw on all.
5. **Preserve the game.** No change to single-player feel, balance or mechanics. Co-op adapts to the game, not the reverse.
6. **Fable 5.2 for every agent.** Ignore time estimates in older docs.
7. Work happens on branch **`coop-overhaul`**. The owner pulls it, plays on localhost, and merges to `dev` if good. **Never push to
   `dev`** (that deploys the public site).

Ask the owner only for a real design compromise. Otherwise decide, write the decision in the log, and go on.

## Rules for every agent on this job

Read `CLAUDE.md` first; it still applies except where this section differs.

- **Your checkout** is a private git worktree. Start: `git rev-parse HEAD coop-overhaul` (they should match; if not,
  `git checkout -B coop/<your-name> coop-overhaul`). Create your own branch `coop/<your-name>` and commit there normally
  (`git add <paths>`, `git commit`): the private-index dance in `CLAUDE.md` is for a shared checkout and is not needed in a worktree.
  Never `git add -A`.
- **Node:** every shell needs `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null` first. In a new worktree
  run `npm ci` once (do not symlink `node_modules`: Vite's cache would be shared between agents).
- **Landing your work:** when done and green, `git rebase coop-overhaul`, re-run `npx tsc --noEmit` and the whole suite
  (`npx vitest run --testTimeout=60000`, about 20 s), then `git push . HEAD:refs/heads/coop-overhaul`. That push only succeeds as a
  fast-forward; if a peer landed first, rebase again, fix conflicts, re-test, push again. Never force. Never push to `origin`.
  Land in small steps as soon as a piece is complete and green; do not sit on a huge diff.
- **Known failing test** before this work: `src/core/devflags.test.ts` ("starts every cheat off…", stale expectation). Everything
  else must stay green. Add tests next to what you build.
- **Ports and browsers:** use only the Vite port your brief gives you, with `OP2_NO_HMR=1`, and stop it when done. Port 5173 is
  never touched.
- **Use the machine** (owner's order): 32 cores, 62 GB, RTX 4090. Every rule that existed to spare the old 8 GB Mac is void: no
  one-browser rule, no waiting on other agents' browsers, no 15 fps caps (unless the test is about low frame rate), no
  one-test-file-at-a-time. Run the whole suite freely, run proofs in parallel, run 3 and 4 player proofs, use more Vite ports from
  your block if it helps (your port to your port + 4 are yours). Speed of development matters more than compute.
  Screenshots and probe output go to `tools/out/coop/<your-name>/` in the **main checkout**
  (`/home/jared/jared/overpowered2/tools/out/coop/<your-name>/`) so the lead can see them.
- **Stay in your lane.** Your brief lists the files you own. If you must change a file outside it, keep the change minimal and say
  so in your report. Other agents are working in parallel on the neighbouring lanes.
- **Prove it in the browser.** Unit tests are not enough for co-op: each stage ends with a two-page proof script in
  `tools/scripts/coop-*.mjs` that asserts the behaviour on the *guest* (and the host where it matters), run under simulated lag
  and loss. Keep the script; it becomes the regression test.
- **No gameplay drift.** Single-player behaviour stays byte-for-byte unless your brief says otherwise. Game facts in `CLAUDE.md`
  ("never get these wrong") hold. Hot paths stay allocation-free; pools have hard caps.
- **Docs:** update `docs/notes/coop.md` for what you built (protocol, numbers, files), and add a line to the log below.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- **Report** (your final message): commits, what changed with numbers, tests and proofs run with results, screenshot paths,
  anything not done or not checked, and any design question you settled or want the owner to settle. Plain words.

## Design: what "state of the art" means here

Host-authoritative for facts, client-side for feel (the Killing Floor 2 / Source model; details in the research doc).

- **Facts on the host:** health, armour, death and its kind, sever mask, status effects, waves and spawns, AI and targeting, score
  and credits, pickups and pods, prisoners, vehicles, the shared time scale, hit acceptance (claims stay claims).
- **Feel on every client:** the full cosmetic damage model on its own replicas (wounds with real severity, reactions, severs,
  ragdolls, gibs, blood), driven by small events. Own hits are predicted at once; the host's answer adds only what was not
  predicted. Gore choices use the **shooter's** position.
- **Enemies:** snapshots on an **unreliable, unordered lane**, stamped with host time, rendered from a **150 ms interpolation
  buffer** with short extrapolation; steady send clock; near enemies at 20 Hz, far at 5 Hz; attacks, staggers and knockdowns as
  reliable **move events** so replicas animate, telegraph, flash and sound like the host's.
- **Other players:** a **remote FX table** per weapon (bullets, pellets, beams, flames, melee, projectiles as cosmetic flights),
  impacts and decals at the end points, casings, reload/stim/light pose bits. Call-ins, the mech, sentries and the skyhook fly a
  cosmetic copy on every screen from the caller's targeting result and a seed; damage stays the caller's claims.
- **World state:** load barrier before the world starts; late-join and reconnect catch-up for every one-shot fact; pods, drops,
  destructibles and pickups host-authoritative by id.
- **Wire:** compact binary events, batched per frame, no per-message UUID; backpressure on slow guests; host per-frame cost flat
  in players.
- **Time:** the host owns the scale and broadcasts it with who caused it; guests slow the world clock, never `playerDt`.

## Stages

Status: `todo`, `doing` (agent named), `done` (commit). Phase 0 runs first; phase 1 lanes run in parallel after it lands.

| # | Lane | What | Status |
|---|---|---|---|
| 0a | rig | Fix `coop-kit.mjs` `startPair`; offline loopback transport for tests; network simulator (lag, jitter, loss, stalls); unreliable lane in the transport (real WebRTC + loopback) with fallback; metrics; headless GPU; baseline numbers | todo |
| 0b | split | Split `src/net/world.ts` into modules by feature with no behaviour change, so lanes do not collide | todo |
| 0c | audit | Fresh audits: session lifecycle and edge cases; gameplay parity per mode and system | todo |
| 1 | session | Load barrier, real error messages, timers while loading, late join and reconnect catch-up, leave/host-loss handling, pause rules | todo |
| 2 | enemies | Snapshot lane: host time, interpolation buffer, steady clock, rate tiers, move events, enemy attack sights and sounds, enemy projectiles, soldier identity | todo |
| 3 | gore | Client-side cosmetic damage on guests, predicted own hits, blood puff (single player too), shooter-eye choices, kill blast roll | todo |
| 4 | weapons fx | Remote FX table: Lance, pellets, impacts and decals, projectiles, melee, Kiln, loads, casings, reload/stim/light | todo |
| 5 | call-ins | Aircraft, orbital, nuke, mech, sentries, skyhook on every screen; streaks and call-ins for every player | todo |
| 6 | world state | Supply pod race, shared pods, dropped weapons (catch-up, marker), destructibles, pickups, shop and economy checks, Defense for guests, guest vs vehicles, prisoners | todo |
| 7 | time | Shared slow-mo with "NAME used X" notice; Focus enabled in co-op; cosmetic clock on guests | todo |
| 8 | wire | Binary events, batching, backpressure, host per-frame cost | todo |
| 9 | verify | Whole-diff review, soak tests at 2-4 players under bad network, edge-case hunt, fixes; docs; push the branch | todo |

## Log

- 2026-11-18: plan written; branch `coop-overhaul` cut from `dev` at `a5e0d38`.
