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
- **Use the machine, within its limits** (32 cores, 62 GB, RTX 4090). The rules that spared the old 8 GB Mac are void: run the
  whole suite when landing, no 15 fps caps unless the test is about low frame rate, 3 and 4 player proofs are fine. But thirteen
  agents share the box, and 25 browser runs at once filled the memory and the swap (2026-11-18). So: `tools/shot.mjs` takes one
  of 8 machine-wide browser slots and waits if none is free (never bypass it); keep **at most two** runs alive in your lane;
  after every run kill what you started and no longer need (hung `shot.mjs`, leftover headless Chrome, spare Vite servers, stray
  vitest or node watchers, extra worktrees), matching on your ports and your worktree path only. A timing or a failure measured
  while the box is overloaded (`uptime` load far above 32) proves nothing: measure again.
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

Status: `todo`, `doing` (agent named), `done` (commit). Phase 0 first; the phase 1 lanes run in parallel; phase 2 after them.
Finding ids (P1, V1, S1, D1…) are from the two fresh audits, now in the repo: `docs/notes/coop-audit-play.md` (what a guest gets,
system by system) and `docs/notes/coop-audit-life.md` (the life of a session and its edge cases). A1-A5, B, C, E1-E13 are from
`docs/notes/coop-audit.md`. Each lane fixes **every** finding listed for it and reads the "correct today, do not break" sections.

### Phase 0

| Lane | What | Status |
|---|---|---|
| rig | Kit fixed for a fresh profile, headless GPU, offline loopback transport, network simulator, unreliable lane in the transport, metrics, kit API, baseline | doing (first step landed `6ea699b`) |
| split | `src/net/world.ts` split into `src/net/world/*` modules behind an event router, no behaviour change | done (`729bb74`) |
| audits | `coop-audit-play.md`, `coop-audit-life.md` | done |

### Phase 1 (parallel lanes)

| Lane | Ports | Owns (files) | Fixes |
|---|---|---|---|
| session | 5300-5309 | `src/net/lobby.ts`, `session.ts`, `index.ts`, `trystero.ts`, `core/Game.ts` boot, `ui/screens/coop.ts`, `core/oneTab.ts` | Load barrier and deploy gate (A1/E1, S1, S2); real error text; reconnect grace instead of instant "host left" (M1); reload rejoins the match (S4); match id in hello, start/end during a load (S3, S5, S6, L6); other peers' errors never close a joiner, trystero cap, double submit (L2, S8, L1); host loss ends with the board and regroups everyone on the same code (H1, H2); stall-proof heartbeat (M6); stable seats, callsign clashes (L3, L4, P3); doubled feed lines (L7); L5, L8-L12, S7, S9, M7, M8 polish |
| team | 5310-5319 | `src/net/team.ts`, `coopHud.ts`, `ui/Hud.ts` endings, `ui/screens/pause.ts`, `contracts/shop/index.ts` break rules, `ui/screens/procurement.ts` clock, `ui/hud/minimap.ts` | Endings always through the team board, Endless Humans and missions can be won (V1/D1, D2); dead and downed come back at wave clear so all shop (D3); team break: ready vote on the next-wave key, honest clock (W1, W2, E4); rejoin gives the whole kit back (M2/E3, M3); late-join wave sync (M4); pause menu items (M9); kill credit and rewards to the right player (E1, E2); host rules and cheats announced (W5, C1); teammates on the minimap, kill feed, a ping marker (co-op UI section); D4-D6, D9, M10, M11, T3 |
| enemy-motion | 5320-5329 | `src/net/world/replicas.ts`, `snapshot.ts`, `worldProtocol.ts`, the replica path in `enemies/EnemyManager.ts` | Snapshots on the unreliable lane with host time, 150 ms interpolation buffer with short extrapolation, steady send clock, 20/5 Hz tiers, chunking under the safe size (C1, C2, C4, E4, E7); reliable move events for clips that are not caused by a visible hit (get-up, crawl, knockdown from blasts, boss entries), yaw smoothing; frozen/burning state on replicas (P5 replica fields); soldier identity sent once (E13); vehicles and allies interpolation fixed (C2); late spawn/despawn handling; `dead` set bounded |
| enemy-attacks | 5330-5339 | `src/net/world/enemyFire.ts`, `targeting.ts`, `enemies/attacks.ts`, `enemies/bosses.ts`, `enemies/outpost/weapons.ts`, `ui/commander/`, new `src/net/world/attacks.ts` | Enemy attacks on guests: telegraph, glint, sniper laser, muzzle flash, gunshot and swing sounds, voices (E5, B); enemy rockets and grenades as cosmetic flights (B4); hazards that hurt only the host: Burner flames, rams, wreck fire, crush (E9); boss slam for every player (E8); warning rings (V3); the villain's words and UI for guests (V2); Ghost power-up (E6); dodge grace for guests (research 5.5); per-flame `ray` spam (wire note) |
| gore | 5340-5349 | `src/net/world/hits.ts` (receiving side: `hitfx`, `sever`, `kill`), `enemies/damage.ts` cosmetic path, `weapons/Combat.ts` hit feedback, `gore/`, `fx/` blood recipes, `audio/reactions.ts` | Guests run the full cosmetic damage model on replicas (E3, A2); own hits predicted at once, host answer adds only the rest, matched by shot id; **blood puff on flesh hits, single player too** (owner decision 1); shooter-eye gore choices; real severity; sever through the full path with `updateMaim`; kill blast roll and shatter; "killed" answer, kill marker, hit-confirm audio and `enemy:hit` on the shooter's screen (P10, P11); gore budgets equal for host and guest |
| claims | 5350-5359 | `src/net/authority.ts`, new `src/net/world/claims.ts` (the sending and validating side, extracted from `hits.ts` in its first commit), `enemies/EnemyManager.ts` status entry points | Honest shots are never dropped: token-bucket rate check on the shooter's own shot clock, bursts, the Judge (P1, P2, M5); line of sight for piercing guns, ricochets, corners (P3); clamp instead of reject, AC-130 bomb (P4); status effects by claim: burn, freeze, stuck bolt (P5); damage kinds that are not gun shots, no made-up `fire` (P6); Lance beam limits (P7); P8, P9; guest bullets versus vehicles (audit D) |
| weapons-fx | 5360-5369 | `src/net/world/remoteFire.ts`, `net/remote.ts`, pose bits in `net/pose.ts`, the emitting side in `weapons/` (lance, Flames, Melee, projectiles, loads) | Remote FX table per weapon (E6, A3, all of table B "Weapons"): Lance rail, charged beam and balls; per-pellet tracers with impacts and decals; projectiles as cosmetic flights; flechette, API, Raufoss, flak; melee swings and slashes; Kiln hose; casings; akimbo muzzles; reload, stim and weapon-light pose bits; rocket laser; thrown grenades; the re-sent `fire` heard as rail shots (P7 note) |
| call-ins | 5370-5379 | `src/net/world/callins.ts`, `booms.ts`, `progression/callins/*`, `src/frame/` puppet, sentries, `enemies/outpost/airlift.ts` | Every aircraft, beam, round in flight, the orbital column and the nuke on every screen from the caller's targeting result and a seed (E10); AC-130 blasts mirrored (W3); the mech and its shells; sentries; the skyhook; streaks and call-ins earned and used by every player and seen by all; the villain's anti-air versus guests' aircraft |
| world-a | 5380-5389 | `src/progression/pickups/*`, `src/net/world/guns.ts`, `weapons/dropped.ts`, `world/breakables.ts`, barrels | One shared supply pod and shared caches at the same spot for everyone, pod race fixed (A5/E2, E5); dropped weapons: catch-up for late and loading guests, a visible marker, refusals (A4/E11, W2); destructibles and barrels host-authoritative by id (E12, W1, E7); world-object blasts visible; decide pickups (see decisions) |
| world-b | 5390-5399 | `src/contracts/defense/*`, `world/structures.ts`, `enemies/commander/barricades.ts`, `devices.ts`, `src/net/world/capture.ts`, `vehicles.ts` | Outpost Defense shared: walls, gates, breaches, shops, preview; guests repair and hire (M1); the villain's shutters, mines, wires, claymores, snares, smoke on guests (V2 props); capture for guests as designed: 0.4 s hold, tap to question, shield (V4); vehicle puppets with wheels, guns, flashes, wrecks (B) |
| time | 5400-5409 | `src/net/world/clock.ts`, `contracts/chips.ts` Focus, `core/time.ts`, slow-mo perks | One player slows everyone with a "NAME used X" notice on every screen (owner decision 3); Focus enabled in co-op; host owns the scale and broadcasts it; guests slow the world clock and their cosmetics, never `playerDt`; blend-out; T1 host below 20 fps must not slow the world; T2 |
| missions | 5410-5419 | `src/net/mission.ts`, `campaign/host.ts`, `campaign/` runner ops | Everything a mission does is mirrored (M2): sky shut to call-ins, lights, the Thermal chip hand-out, courier set piece, checkpoint notice; triggers count any player's action; checkpoint restart resets every screen; W6; the Frame in missions with the call-ins lane's puppet |

Shared files and contracts between lanes:
- `src/net/world/hits.ts`: **claims** extracts the claim-building and host-validation code into `claims.ts` first and lands it early;
  **gore** owns what a guest does when `hitfx`/`sever`/`kill` arrive and the prediction at the hit site. Each keeps out of the other's half.
- **The shot id** (claims, landed): every `hit` claim carries `shot` (the shooter's own count of shots, swings and bursts, from 1,
  never reused in a match) and `at` (the shooter's clock, ms). On the **guest**, `ctx.coop.world.shot` is the id the claim just
  sent carried: read it right after `applyDamage` returns to tag a predicted hit. On the **host**, while a guest's claim is
  being applied (inside `enemy:hit`, `enemy:severed`, `enemy:killed`), `ctx.coop.world.applying` is that guest's lobby id and
  `ctx.coop.world.applyingShot` its `shot`: **gore** stamps them on `hitfx`, `sever` and `kill` so the shooter can match the answer
  to what it predicted. Both read `null` / `0` for the host's own damage. The id moves on every `weapon:fired`, and on a claim
  made more than 100 ms after the last move (a round landing, a beam still on). It is not `fire.shot`: **weapons-fx** may send
  `ctx.coop.world.shot` as `fire.shot` if it wants the two equal (claims.ts hears `weapon:fired` first).
- **Status effects** (claims, landed): fire, frost and the live bolt go through `ctx.enemies.afflict(enemy, 'burn' | 'freeze' |
  'bolt', seconds)`, never a direct write to `enemy.burning` / `frozen` / `bolted`. It writes the local copy as before and, on a
  guest, tells the host (`status`). New effects of this kind call it too.
- Reactions on replicas: **gore** starts stagger, flinch and knockdown locally from the cosmetic damage model (own hits and
  `hitfx`). **enemy-motion**'s move events cover clips with no hit behind them and must not restart a clip of the same kind that
  began in the last 400 ms. Attack clips, telegraphs and sounds belong to **enemy-attacks**.
- `src/net/world/booms.ts` is **call-ins**'; other lanes that need a visible blast call its API.
- Adding an event: declare it in your own module and add one line to the union, as the split's "Code layout" note in
  `docs/notes/coop.md` describes. Never renumber or rename another lane's wire fields.
- `enemies/EnemyManager.ts`, `core/Game.ts`, `ui/Hud.ts` are touched by several lanes: keep edits small and local, rebase often.

### Phase 2

| Lane | What | Status |
|---|---|---|
| wire | Compact binary events, per-frame batching, no per-message UUID, backpressure on slow guests, host per-frame cost flat in players (E8, E9, C5, C7, P2 mesh) | todo |
| verify | Whole-diff review by fresh agents; soak proofs at 2, 3 and 4 players under bad network in every mode; edge-case hunt; fixes; docs; push the branch | todo |

## Decisions the lead made (owner may overrule; none changes single player)

- **Dead and downed players come back at wave clear**, so everyone shops (the docs already said so; the code did not).
- **Team break:** 45 s (60 s before a boss wave), ending early when every player has pressed the next-wave key (a ready vote, shown
  on the HUD). The shop screen shows the real clock.
- **Host loss:** no host migration (the world lives only on the host). Guests get the team board, then regroup automatically in a
  new lobby on the same code with the next player as host.
- **No scaling of waves or pay for 3-4 players** for now (keeps balance as designed); owner question.
- **Pods and caches:** the same pod at the same spot on every screen; each player shops there with their own purse; a cache gives
  each player their own share (no stealing). Dropped weapons are the way to share guns. Ordinary pickups stay per player.
- **Perks are still lost on going down.** A player who turns cheats on is announced to the team.

## Log

- 2026-11-18: plan written; branch `coop-overhaul` cut from `dev` at `a5e0d38`.
- 2026-11-18: both audits in (`coop-audit-play.md`, `coop-audit-life.md`); phase 1 split into 12 lanes with their findings; lead's default decisions recorded.
- 2026-11-18, split: landed (`729bb74`). `CoopWorld` is now a 139-line facade over 14 feature modules in `src/net/world/`, with an
  event router (`router.ts`) and a shared context (`context.ts`). Same messages, same order, same timing; `world.test.ts` passes
  unedited; `coop-stage3.mjs` and `coop-drops.mjs` pass in the browser at 60 fps. Each module and how to add an event:
  `docs/notes/coop.md`, "Code layout". Line numbers in `coop-audit.md` that point into `world.ts` are from before the split: find the
  code by function name under `src/net/world/`. Decisions: `kata` went with `remoteFire.ts` (it opens the host's fire-rate check);
  the feed lines are three small modules (`callins.ts`, `sonar.ts`, `chatter.ts`) because different lanes will grow them; the binary
  snapshot codec moved to `world/snapshot.ts` and `worldProtocol.ts` re-exports it; the host's delayed work (`Later`) sits on the
  context, not in `booms.ts`, because targeting queues it and booms depends on targeting.
- 2026-11-18: all twelve phase 1 lanes launched as T3 delegates (worktrees under `~/.t3/worktrees/overpowered2/`, branches `coop/<lane>`). If a lane stopped at the usage cap, its unlanded work is in its worktree: resume it there with a fresh agent told to read its branch's diff first.
- 2026-11-18: the box ran out of memory under 25 simultaneous browser runs; `tools/shot.mjs` now queues runs on 8 machine-wide slots and the rules cap each lane at two runs.
