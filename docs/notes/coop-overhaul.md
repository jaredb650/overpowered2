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
  of 3 machine-wide browser slots and waits if none is free (never bypass it); keep **at most two** runs alive in your lane;
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
| rig | Kit fixed for a fresh profile, headless GPU, offline loopback transport, network simulator, unreliable lane in the transport, metrics, kit API, baseline | done (`6ea699b` kit and GPU, `d9ecffb` transport, then the kit, baseline and notes commit after it) |
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
| call-ins (landed, see log) | 5370-5379 | `src/net/world/callins.ts`, `booms.ts`, `progression/callins/*`, `src/frame/` puppet, sentries, `enemies/outpost/airlift.ts` | Every aircraft, beam, round in flight, the orbital column and the nuke on every screen from the caller's targeting result and a seed (E10); AC-130 blasts mirrored (W3); the mech and its shells; sentries; the skyhook; streaks and call-ins earned and used by every player and seen by all; the villain's anti-air versus guests' aircraft |
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
- **Enemy attacks** (enemy-attacks, landed): attack clips, telegraphs and sounds on a guest's copy come from the attack's own
  code run there (`net/world/attacks.ts`), never from a move event or the snapshot. Code that runs inside an `AttackDef` must not
  decide an outcome when `w.cosmetic` is set (a guest's copy), and anything only the host may do belongs behind `w.enemies` /
  `ctx.combat` / `ctx.player`, which are stand-ins there.
- **Every player as a target** (enemy-attacks, landed): `ctx.coop.world.hostPlayers()` is every player as the game's own player
  type, the host's first (null on a guest and in single player). A danger that used to read `ctx.player` loops over it; a
  guest's `takeDamage` becomes `hurt` and its `launch`/`push` a `shove`. **world-b**: test device trips against it, and pass
  the victim to `Commander.hurt(amount, from, cause, victim)`.
- **Harmless projectile copies** (enemy-attacks, landed): `ProjectileSpec.cosmetic` flies and draws and hurts nothing;
  `Combat.spawnCopy(spec, netId)` and `dropProjectileCopy(netId)` add and remove one. **weapons-fx** can use the same for players'
  rockets and grenades on other screens.
- **Enemy flashes, sounds and warnings outside an attack** (enemy-attacks, landed): `Combat.enemyMuzzle` and
  `ctx.coop.world.enemySound(id, at, volume, pitch)` reach every guest, as do `Telegraphs.zone/glint` and its lasers. A new
  vehicle gun or device needs only those calls. Vehicle turret poses are **world-b**'s.
- **A line only the host works out** goes through `shout()` (`enemies/attacks.ts`), not `say()`. Pain, sever and death cries
  stay `say()`: **gore**'s local damage model makes them on each screen.
- **Missions** (missions, landed): which mission operation goes where is one table, `src/campaign/coop.ts`, printed in
  `docs/notes/coop.md`, "Missions". What the other lanes need from it:
  - **A checkpoint restart is `run:start` on every screen, mid-match.** The host's `campaign.restart()` (the team's wipe and the
    pause menu's item both call it) sends `reset`; each guest then runs the same `Game.newRun()` the host does. A module that
    holds copies of the host's world must drop them on `run:start` (`CoopWorld` does it for the enemy and vehicle copies);
    anything both sides rebuild the same way from a new run needs nothing sent. `ctx.coop.world.mission.restart()` is the
    same call for a caller that has no campaign in hand.
  - **team:** `ctx.coop.world.mission.result` (`MissionResult`: title, seconds, replacements, vehicles) is set on every screen
    before your `over` goes out, for the board. `team.respawnAll(at?, yaw?)` took two optional arguments (the mission's leading
    player); nothing else in `team.ts` changed.
  - **session:** `mission.catchUp(id)` brings one arriving player to where the mission is (place, section, doors, objectives,
    music, sky, lights, kit, chips, racks, pickups, the film part way or the ride). It is safe to call again for a player who
    never left (a reconnect inside the grace): a film or ride already running is kept.
  - **call-ins:** `progression.leaveSeat()` (two lines in `progression/index.ts` and `callins/manager.ts`) takes a player out of
    a seat when the host's mission ride ends. The missions' `frame` steps are still the game's stand-in banner, alone and in
    co-op; when a real Frame is provided for them, the rule is one Frame, piloted by the first player to reach it.
  - **world-b:** a mission's scenery vehicles (`state: 'parked' | 'wrecked'`, the tank jammed in the Outpost's gate), the
    Outpost's enemy chopper and the kill marks on vehicles (`call mark`) are not drawn on guests by `vehicles.ts` today.
    Holdfast's wall breach is a structure stage on the host: it needs your structure sync to reach guests.
  - **enemy-attacks:** the Commander's box between rounds in a mission (`adapt`) and `commander:done` are the host's; `quiet`
    (`commander:quiet`) is emitted on every screen, ready for your villain mirror.
- `src/net/world/booms.ts` is **call-ins**'; other lanes that need a visible blast call its API.
- **Clocks (from the time lane, landed).** `ctx.time.dt` is the world clock on every screen, and on a guest it now follows the
  team's slow-mo: use it for everything cosmetic that must slow with the world (replica animation, enemy projectiles in flight,
  gore, ragdolls, particles, blood). `ctx.time.playerDt` is the player's own clock and never slows (their body, guns, viewmodel).
  `ctx.time.realDt` is for UI and for other players' bodies, which move at full speed. No new clocks. **Snapshots
  (enemy-motion):** the header needs nothing from time. The shared scale travels as `slowstate` on the reliable lane (on change,
  4 Hz while slow, every 2 s otherwise). Stamp snapshots with the host's wall clock (`performance.now()`), never
  `ctx.time.elapsed` (it is scaled, and on a slow host it advances in several steps a frame); interpolate on the wall clock; give
  replica animation `ctx.time.dt`. **Never call `ctx.time.share` or set `ctx.time.gate`** (they are the clock module's);
  `pushScale`/`popScale`/`hitStop` stay what the game calls, and in co-op only Focus, SLOWMO, Time Warp and a boss's death get
  through. **Host frames:** below 20 fps the host runs `Game.frame` several times a frame (`ctx.time.split`), so anything in a
  module's `update` must be safe to run two to five times in one animation frame (rate-limit by `performance.now()`, as the
  snapshot does). **Team timers (team):** bleed-out, revive hold and the end board stay on real time by decision (players act
  at full speed in slow-mo, so a stretched bleed-out would be a free extension); waves and breaks are the world's and stretch.
- **A guest that arrives late** (world-a, landed): `CoopWorld.catchUp(id)` runs when a guest's world comes up, from the guest's own
  `worldsync` and from `team.onArrived`, possibly twice. A lane with one-shot world state adds its own catch-up there (or beside
  it, as `villain.catchUp` is) and makes it safe to receive twice.
- **Barrels, tanks and props** (world-a, landed): the host decides, by number. Code that damages them calls
  `ctx.world.objects.damageExplosive` / `damageExplosivesInRadius` as before, on host and guest alike: the guest's call is
  forwarded to the host by itself. On a guest a barrel is only drawn and felt: never rely on `world:explosion` being raised
  there. A blast that only the local player should feel is `ExplosionSpec.playerOnly` (Combat skips enemies, vehicles, the world).
  Walls, gates and shacks are **world-b**'s: a guest's blast is NOT forwarded to `walls` by this lane.
- **Pods** (world-a, landed): a guest's `DropPods.call()` does nothing; the host's reaches it as `pod`. A mission that calls a cache
  need only do it on the host (the mirrored op on a guest is a no-op).
- Adding an event: declare it in your own module and add one line to the union, as the split's "Code layout" note in
  `docs/notes/coop.md` describes. Never renumber or rename another lane's wire fields.
- `enemies/EnemyManager.ts`, `core/Game.ts`, `ui/Hud.ts` are touched by several lanes: keep edits small and local, rebase often.

### Phase 2

| Lane | What | Status |
|---|---|---|
| wire | Compact binary events, per-frame batching, no per-message UUID, backpressure on slow guests, host per-frame cost flat in players (E8, E9, C5, C7, P2 mesh) | done (2026-11-19, see the log) |
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
- 2026-11-18, rig: done. **Transport:** one `LaneRoom` (`src/net/lanes.ts`) over two wires. Real WebRTC gets an unreliable,
  unordered second data channel per peer (`src/net/fast.ts`, negotiated id 100, made only once the connection is up, silent
  fallback to the reliable path until both ends have heard each other); loopback (`src/net/loopback.ts`, `?net=loop`, dev pages or
  localhost only) links windows of one browser profile with no WebRTC and no relays. Player poses are on the unreliable lane;
  snapshots are not moved (enemy-motion's job: `lobby.gameplay('world', fn, { unreliable: true, latest: true })`, messages under
  1,100 bytes). **Simulator** in the game (`?netsim=lag:80,jitter:30,loss:0.03`, `__op2.net.sim.set`), **metrics** on
  `__op2.net.snapshot()`. **Kit:** `startParty` (2 to 4 pages, loopback by default, every mode), `live`, `measure`, `shootLoop`;
  headless Chromium is on the GPU on Linux (60 frames a second a page; it was 1 in software). Baseline numbers and how to use all
  of it: `docs/notes/coop.md`, "Transport" and "Testing". Decisions: loopback pages are separate **windows** (a background tab of
  one window stops drawing, so `context.newPage()` cannot be used for game pages); the one-tab rule is skipped on loopback pages
  (one line in `main.ts`); proofs fire through `fireAt`/`shootLoop`, not the mouse; `publishNet` only attaches to the game's own
  `window.__op2`. Not done: a hook inside `src/net/world/*` (none was needed: per-lane arrival gaps are counted in the transport);
  the five oldest self-contained proofs (`coop-stage1/2`, `coop-lobby`, `coop-picker`, `coop-dad`) only got the fresh-profile line
  and `coop-lobby` is stale against today's invite page; the baseline was taken on a busy machine and wants one quiet re-run.
- 2026-11-18, time: landed. One shared time scale owned by the host (`world/slow.ts` rules, `world/clock.ts`, `world/slowNotice.ts`);
  Focus works in co-op; every screen shows "NAME used Focus / earned SLOWMO / took Time Warp / killed the JUGGERNAUT" with the
  world's speed and a bar to its end. Decisions: the deeper scale wins and both are named; asking again resets, never adds; caps
  4.5 s Focus, 5.5 s perks, 9 s boss; a downed or dead player is refused; the team's budget is 12 s in a row, refilling 1 s per
  second at full speed, with 3 s to be back before a new one; a boss's death is never refused and costs nothing; hit-stop, the
  Judge's fan and the death beat stay off in co-op; a teammate's slow-mo plays `time_warp_in`/`out`. The scale is a periodic
  `slowstate`, not a snapshot field. T1: the host cuts a frame over 1/20 s into world steps (`GameTime.split`), single player and
  guests unchanged. T2: an enemy's blast on a remote player burns on the world clock. T3: bleed-out stays on real time (decision
  above). Details: `docs/notes/coop.md`, "Time: the team's slow motion".
- 2026-11-18, enemy-motion: landed. Enemy snapshots are chunks of at most 1,100 bytes on the unreliable lane, stamped with the
  host's clock, on a steady 20 Hz tick with near (20 Hz) and far (5 Hz) tiers per guest and backpressure; a guest draws each
  enemy from a buffer about one send interval plus the measured jitter in the past, carries it on for 100 ms when the buffer runs
  dry and eases every correction. Moves no hit explains (`move`: stagger, stumble, daze, roar, land, leap, block, living
  knockdowns as the guest's own ragdolls, get-ups), soldier identity (`who`), frozen and burning as real replica state, aim at the
  right player, vehicles and the garrison through the same buffer. Details and numbers: `docs/notes/coop.md`, "Enemy motion".
  Decisions: (1) two record sizes, 27 motion bytes and 44 full, a full one on change and once a second, so a tick costs what the
  old 10 Hz lane cost at twice the rate; (2) the delay is per enemy (its own send interval), so far enemies sit further in the
  past instead of extrapolating; (3) a living knockdown is replayed by the guest's own gore from the host's push, not streamed;
  (4) the host listens for moves at the animator and at `gore.knockdown` rather than editing every call site. For other lanes:
  `Replicas.whenSeen(uid, run)` keeps an event for an enemy not drawn yet; `replica.to.target` is the slot the enemy is after;
  attack clips are not sent as moves and nothing is started from the coarse animation bits any more (attacks.ts plays attacks); a move never
  restarts a stagger or knockdown begun in the last 400 ms on the copy. Touched outside the lane, small: `gore/index.ts`
  (`rouse`), `world/hits.ts` (`whenSeen` in `hitfxIn`/`severIn`), `world/targeting.ts` (`targetOf`), `world/context.ts` (the lane's
  options), `world.ts` (construction), `world/vehicles.ts` and `allies.ts` (the buffer). Not done: the full 12-case measurement
  table (the box was overloaded; one clean paired run is in the note).
- 2026-11-18, enemy-attacks: landed (`4614d64` and the commits after it). A guest plays every enemy attack with the attack's own
  code against a world that cannot hurt, from three host events (`atk`, `atkf`, `atke`); enemy projectiles fly as harmless
  copies; slams, beams, swings, Burner flames, rams and wreck fire test every player (`hostPlayers()`), a guest can jump a slam
  and is thrown, and a guest clearly out of reach on their own screen is spared a swing; rings, shells, shocks, flashbangs and
  the lasers of tanks and spotters show everywhere; the Commander's words reach guests; Ghost works; soldiers fire real bullets
  at guests (they fired instant rays) and a rocket at a guest no longer explodes twice; enemy vehicles go for the nearest
  player. Details, the wire and the proofs: `docs/notes/coop.md`, "Enemy attacks on guests". Decisions: no seed is sent (each
  random outcome is sent as the outcome); a ground ring is always the host's word; a wind-up starts on arrival and is shortened
  by how late its event was, never delayed by the interpolation buffer. Touched outside the lane, small: `enemies/brain.ts`
  (the host hooks), `aiWorld.ts` (`cosmetic`), `EnemyManager.ts` (guest path ticks warnings and suppression, `aiWorld`, bark and
  strike), `telegraph.ts`, `weapons/Projectiles.ts`, `Combat.ts`, `Flames.ts` (`lickPlayer`), `enemies/vehicles/*` (rams, wreck
  fire, gun flashes and sounds, `quarry`), `commander/index.ts` (`hurt`), `commander/mortars.ts`, `outpost/index.ts` (flashbang),
  `net/pose.ts` (`latest`), and `shout()` at nine voice call sites. Proofs: `tools/scripts/coop-attacks-*.mjs`, results in the
  note. The machine was overloaded all day, so the timing figures there come from the few runs whose pages ran at speed; the
  full table under bad network, four players and real WebRTC are not proven (phase 2 "verify").
- 2026-11-18, session lane (`coop/session`): the load barrier and deploy gate, seats by browser id with stable slots, the match
  id in hello, reconnect grace on both sides, reloads that rejoin (a host's reload restarts the match for all), other peers'
  errors, start acks, the stall-proof heartbeat, host loss ending in the board and an automatic regroup on the same code, one
  source for join and leave lines, real error text. Details, numbers, hooks and proofs: `docs/notes/coop.md`, "The life of a
  session". Decisions: (1) players who are in **walk the map while the world waits** (the click is the gate; the wave clock, the
  directors and a mission's runner are what is held); (2) `away` now covers loading and lost seats too, with `state` saying
  which, so every existing `!p.away` filter stays right; (3) a **host's page reload restarts the match** of the same mode for the
  same players rather than ending it; (4) in the lobby as in a match a dropped guest keeps a seat for 60 s; (5) the barrier
  applies only on a match's own map page, so page-less test lobbies behave as before. For other lanes: `CoopSession.onArrived /
  onLost / onGone` (with the stable `seat`), `holding`, `lobby.live`; `coop-kit.mjs` `inMatch` now presses the deploy gate
  (`deploy(page)`), and a proof that waits for a world must go through it. Touched outside the lane, small: `ui/screens/Screens.ts`
  (`coopRegroup`, the played match to `adopt`), `tools/scripts/coop-kit.mjs` (`deploy`, `inMatch`), `src/net/trystero.ts` (the
  cap). Open for the owner: see the lane's report.
- 2026-11-18, world-a: landed (`e2775a3`, follow-ups after it). **Pods:** one supply pod or weapon cache for everyone, called by the
  host, flown by every screen at the same spot on the wall clock; each player's own shop and own share of a cache; the race of
  audit A5 fixed at both ends (the directors enter the break before announcing it, and the `wave` event carries the phase).
  **Dropped guns:** settle on the ground, a light column and ring, E only in co-op, a guest's drop shows at once and returns to
  the hands if refused or unanswered, every gun re-sent with its age to a guest whose world comes up. **Destructibles:** barrels,
  tanks and props break once, by number, on the host's word; guests guess at their own hits; a barrel counts once, on the host,
  for the player who set it off, and every player in reach feels it on their own screen; chairs, respawns, the reactor and the
  timed machinery follow the host; a late guest gets the world as broken as it is. Decisions: (1) co-op takes a gun only with E
  (walking over one takes it only solo), so nobody hoovers up a gift; (2) ordinary pickups stay each player's own, nothing found
  visibly wrong; (3) barrel and prop blasts are drawn from the `break` event by number on each screen, not through `booms.ts`
  (the same pieces, the same instant, and no second explosion from the wire); (4) a barrel hurts every player in reach, as the
  world's own hazard, the shooter and teammates alike: **owner question**, since it is the one place a player can hurt a friend;
  (5) a guest's blast is not forwarded to walls (world-b's). Found on the way: a Vite server left running across a rebase serves
  modules from before it, so restart it after every rebase. Proofs and numbers: `docs/notes/coop.md`, "The shared world".
- 2026-11-18, team lane (`coop/team`): landed (`3e4f41f` and the commits after it). **Endings:** a co-op run ends only through
  `team.finish(how)` and the team board on every screen (a wipe, Endless Humans won, a mission won), with buttons (Back to lobby
  for anyone; the host's Back to lobby (everyone) and Start again), the host's world still running under it, and no solo
  game-over or "complete" screen anywhere. **Lives:** the dead and the downed get up at wave clear, and again at wave start; a
  stalled host or a dropped line costs nobody their bleed-out seconds. **Break:** 45 s, 60 s before a boss wave; the next-wave
  key is a vote of the living players, shown on the HUD and in the shop, whose clock is now the real one; the solo shortcuts
  that ended a break for everyone are off in co-op. **Seats:** the host keeps each guest's purse, kit (guns, mods, rounds,
  grenades, stims, implants, brain chips, call-ins, combo) and whether they left alive, under the session's seat id; a new
  page gets it all back and is never a free revive. **Late join:** `sync` (wave, break clock, vote, custom rules). **Credit:**
  `world/credit.ts` decides whose kill (claimant, then the owner of a queued blast, then nobody for an ally, then the last
  player to hurt it within 30 s for a bleed or burn, then the host), and a guest's wound bonus, execution and BACK SHOT label go
  to that guest (`award`). **Told to the team:** cheats, the host's custom rules, who is in a menu. **HUD:** teammates on the
  minimap, a kill feed, a ping (middle mouse or P). **Pause menu:** End match asks first; a guest has no checkpoint item.
  Details and numbers: `docs/notes/coop.md`, "The team's rules". Decisions: (1) only players whose world is up count for a wipe
  and a vote; (2) the dead never hold a vote up, and a player in the shop votes from the shop; (3) someone who left dead and
  sat out the team's respawn comes back alive; (4) a connection that drops and returns on the same page keeps what that page
  holds (the host's copy is older) and its life as it stood; (5) the board returns everyone to the lobby after 20 s (was 15);
  (6) the kill feed is derived on each screen from the `kill` event already sent, so it adds nothing to the wire; (7) skipping
  the Commander's briefing no longer shortens the break in co-op. Touched outside the lane, small: `net/lobby.ts`
  (`browserOf`), `net/index.ts` (`playAgain`, the ending passed to the board), `net/remote.ts` (`color` made public),
  `net/world.ts` and `world/hits.ts` (kill credit moved to `credit.ts`; one `coop:kill` emit in `killIn`), `world/claims.ts`
  (`onStatus`), `world/capture.ts` (the bounty's payee), `weapons/Combat.ts` (a queued blast remembers whose it is),
  `progression/index.ts` and `contracts/rewards.ts` (not-mine guards), `contracts/defense/index.ts` and
  `enemies/commander/index.ts` (the two solo break shortcuts), `core/contracts.ts`, `input/bindings.ts`, `ui/data.ts` (the
  `ping` action), `ui/hud/shop.ts` and `defense.ts` (the "START NOW" hint), `world/pods.test.ts` (the break is now 45 s).
  Proved: `src/net/team.test.ts` (31 tests) and five browser proofs `tools/scripts/coop-team-*.mjs` (endings, break, rejoin, ui,
  solo), at 2, 3 and 4 players, on a clean network and under `lag:120,jitter:40,loss:0.05`, on loopback and (rejoin, ui) on real
  WebRTC: the table of runs is in `docs/notes/coop.md`, "The team's rules", Proofs. Not done: the same section, "Not done".
  **`coop-stage3.mjs` failing at "The guest shops while the world runs on" (from about 22:55) was the proof, not the game:** it
  makes up a `wave:start` and then opens the shop by a debug event, and a shop open while the guest believes a wave is running
  shuts itself (the new rule). It had passed only because shutting a menu took 1.7 s in headless Chromium; the kit's pretend
  pointer lock made that instant. The proof now opens the shop once the guest is back in the break, and the rule itself waits
  for 0.75 s of a running wave before it shuts the shop. 12 of 12 again.
- 2026-11-18, late: usage cap about to hit (owner has reset tokens). State for whoever resumes: landed so far = rig (done, reported), split (done), enemy-motion main (`970157c`; its 12-case measurement table is still to run on a quiet machine with `coop-motion-*.mjs`), enemy-attacks (two steps), time, claims (core + vehicles), team (endings, respawn), pod race, blood puff. Not yet landed, work sits in each lane's worktree and branch `coop/<lane>` (see `git worktree list`, `git log coop-overhaul..coop/<lane>`, `git -C <worktree> status`): session, gore (client-side model), weapons-fx (all written, 48-case proof running), call-ins, world-a (pods, drops, destructibles written), world-b (Defense in progress), missions, team follow-ups, devtools (dev-only tools), proof-speed (fast proof mode). No lane except rig and split has sent its final report. To resume a lane: a fresh agent in the SAME worktree (or a new worktree on that branch), told to read the lane's row here, its branch's commits and uncommitted diff, then finish, prove and land. After the lanes: phase 2 (wire, verify). Known flaky tests under load, not from this work: `gore/knockdown.test.ts`, `gore/strength.test.ts`, `weapons/viewmodels/hands.test.ts`.
- 2026-11-18, gore: the blood puff landed first (`421ecce`), then the gore itself. `DamageModel` runs with the facts on (solo, host)
  or off (a guest): `predict` draws a guest's own hit on the frame of the shot, `show`/`severShown`/`killShown` draw what the host
  decided, all through the same lines, so the screens cannot drift. Hits cross the wire as `hitfx` (about 108 bytes, was 330) and
  the shooter gets an `ack` (66 bytes) instead of its own picture; `sever` is one event a cut, `kill` carries the blast's roll, the
  frozen bit and the killing round's wound. Decisions: the body dies on the host's word, never on a guess, and the shooter's kill
  feedback goes by the guess (`killSoon`); a guest's own hit is matched to the host's answer by a number of its own on the damage
  (`DamageInfo.claim`), finer than the shot id (six pellets are six answers); knockdowns are guessed too and put right by the
  answer; a copy on the floor lies until the host's body is up. Edits outside the lane, all small: `EnemyManager` (the guest entry
  points and the top of `placeReplica`), `Enemy.ts` (four fields), `Projectiles.ts` and `Melee.ts` (the late pin and fling, and
  `toldKill`), `Flames.ts` (one marker), `ui/runreport.ts` (two `notMine` guards), `outpost/index.ts` (its hit rules stay off a
  guest's own events), and every mocked manager in the co-op tests (`goreDoubles()`). With enemy-motion's landing: a copy's own
  ragdoll is waited out by their `replicas.ts`, and their `down` move skips a copy gore already knocked down. Open for
  enemy-motion: a state's sever bits still cut at once (they should wait for the `sever` event). Details: `docs/notes/coop.md`,
  "Gore on every screen".
- 2026-11-18, weapons-fx: a friend's weapons are drawn by the shooter's own code run again from the friend's body. Decisions:
  (1) one switch, `Combat.watching`, makes every FX path harmless (strike and explode do nothing, no corpse, map object, vehicle or
  blood), and `ProjectileSpec.cosmetic` does the same for rounds in flight, so nothing was rewritten as a look-alike and a new
  gun comes along for free; (2) the remote FX table is `REMOTE_FX` and `REMOTE_MODS` in `src/weapons/watch.ts`, `Record`s over
  every weapon and mod id, so `tsc` refuses a new one without its row; (3) `fire` is now only for the eye and the ear (claims
  carry their own shot ids since the claims lane landed), so it lost its shot number and its silent re-sends, which is what made a
  held beam sound like rail shots; (4) loops (the beam, the Kiln) are a start event, the pose's aim, and a stop event or their own
  clock, never a stream; (5) what a player is doing between shots (reload, stim, laser, charge) is one byte of bits in the pose
  (format version 2), states that cannot stick; (6) a scatter gun's pellets come from a seed in co-op only, single player keeps
  `Math.random`; (7) my event for the gun in hand is `held`, because the team lane took `kit`; (8) three spotlights for friends'
  weapon lights are made with the session, before the first frame, since adding a light later recompiles every shader. Touched
  outside the lane, each a few lines: `core/math.ts` (`randomInCone` takes a number source), `core/gameplay.ts` (`FireNote`,
  `MeleeFx`, two events, three `ProjectileSpec` fields), `fx/layers/hose.ts` (the ribbon takes 148 points, was 74), `net/index.ts`
  (seat, torch pool, pose flags), `net/world.ts` (four pass-through methods), and the stand-ins in `world.test.ts`,
  `session.test.ts`, `router.test.ts`. Details: `docs/notes/coop.md`, "Weapons on other screens".
- 2026-11-18, devtools (not a co-op lane; the dev-only finds of `docs/research/dev-tools.md`): `tools/diff.mjs` (picture
  difference), `tools/sheet.mjs` (motion contact sheet, frozen clock by default), `tools/scripts/lib/steady.mjs` (frozen time and
  seeded `Math.random`: two runs pixel-identical), `fast-check` property tests for `pose.ts`, `world/router.ts` and `world/wire.ts`
  (how to add one for the lanes' files: `docs/notes/coop.md`, "Property tests"), `tools/scripts/soak-memory.mjs` (GPU memory per
  wave: no leak found, real-wave growth is pools and per-kind caches) and `tools/scripts/perf-trace.mjs`. `tools/shot.mjs` changed
  in one way: a script may export `before(page)`, run before the page loads. Everything in `docs/notes/devtools.md`.
- 2026-11-18, world-b, steps 1 and 2 landed: **Outpost Defense is one fort** (`src/net/world/fort.ts`: walls, gates and shacks by
  index with exact health, a guest's blasts and rounds forwarded, gates for any player, guests board up by hand and are paid by the
  host's answer, the Barracks' hires, crews, mortar teams, gun upgrades and rebuilds paid by the buyer and carried out on the host
  with a refund on refusal, shop health, the wave preview, carriers, jump pads, sandbags, mortar rounds, the garrison's callouts,
  late join) and **the villain's props** (`src/net/world/villainProps.ts`: devices numbered by the host, tripped and shot by any player,
  shutters as real colliders, smoke, late join). Decisions: a guest's blast reaches the host's walls, sandbags, shutters and
  devices through one message (`wallblast`, then the host's `coop:blast` game event), so no other lane should feed a guest's `boom`
  into the host's blast listeners; the attackers go for the deepest defender and each squad fights the nearest player it can reach;
  the Defense radio's box lines ride the enemy-attacks lane's `cmd` bark, only the garrison's squad-feed callouts are the fort's.
  Still to do in this lane: prisoners for guests, vehicle puppets, mounted-gun seats, flyable vehicles and allies from a guest's seat.
- 2026-11-18, enemy-motion, measurement: **the 12-case smoothness table is not made, and is the verify phase's to make.** The box
  stayed at load 50 to 100 all day and test pages were starved (0.1 to 30 fps), so by the lead's order the matrix stopped after two
  tries a case: 1 of 7 cases tried got a clean run. Measured so far, 20 enemies on a clean network only: error p50 2.2 to 0.4 cm
  and stalled frames 38 to 1 against the old lane, same bytes (the rows are in `docs/notes/coop.md`, "Enemy motion", Measured).
  Not measured in the browser: 48 enemies, a 20 fps host, either bad network. One command makes the table on a quiet machine,
  unattended: `node tools/scripts/coop-motion-matrix.mjs --baseline d9ecffb` (sets up the old build and both servers itself, one
  run at a time through `shot.mjs`, throws away any run whose pages got under 40 fps and writes that case as not measured, saves
  `motion-results.json` and `motion-table.md`, exit 3 if a case is missing). Also seen: `gore/knockdown.test.ts` "goes down on its
  muscles, heading 0,1" fails about one run in four on `d9ecffb` too (a flaky test, not from any lane's change).
  The gore lane's open item is closed: a limb the state's sever bits have off now waits 800 ms for its `sever` event before it
  drops (`replicas.ts`, `SEVER_WAIT_MS`).
- 2026-11-18, damage-research: docs only, no code. `docs/research/damage-response-research.md` (what a hit, a gib, blood, fire
  and a corpse do today, read from the code and looked at in 26 frame sequences on the Test Range, with how other games do each)
  and `docs/proposals/damage-response-update.md` (the plan the owner reads: a hit-response gradient, and steps ordered by feel
  per unit of work). Found, with numbers: a hit short of a stagger is a 3 to 10 degree spring flinch along the player's line
  of sight (1.5 degrees on a struck arm) and a Trooper is dead 0.15 s after the first SMG round; a rocket's force (84 at most)
  can never reach the 420 that cracks a trunk, so every rocket gib is the two-piece version with no ribcage; the fireball hides
  the gib for 13 frames; a flamethrower kill leaves an unburnt body and fire stops at death; the decal ring is full at the
  28th kill; a body at rest has no collider, so bodies never stack (46 kills on one spot lay one body deep); a corpse costs
  about 7 draw calls and 56,000 triangles. Nothing was timed (load 65 to 70). For the co-op lanes: every step in the plan is
  drawn by each screen from the hit and kill events it already gets, except one optional rule (a hit spoils an enemy's aim),
  which would be the host's to decide.

## Queued for after the co-op work (owner's calls, 2026-11-18)

- **Rapier SIMD build: pinned.** The owner: the current physics build works well and is fundamental to the feel. Do not measure
  or swap it until he raises it again.
- **Linter, minimal form: yes, after co-op lands.** `oxlint` or Biome with two or three "ban this name / ban this import" rules
  for the mechanical house rules, no style rules, run on demand, not a gate. The first run's existing breaks are listed for a ruling.
- **Also after co-op:** Chrome's built-in packet loss for WebRTC as a second network simulator; a one-off dead-code report
  (`knip`); Rapier `debugRender()` drawn in the lab; a trial of `threejs-devtools-mcp` on one real visual bug.
- **Far enemies stay at 5 Hz** (drawn about 240 ms back) until the owner has played it; `FAR_EVERY` in `src/net/world/snapshot.ts`.
- **Damage response update** (`docs/proposals/damage-response-update.md`): **the owner has said go (2026-11-18): start it once
  co-op is done and every current agent has finished, not before.** His answers are in section 10a of that file. Start with
  batch 1, on its own branch off the finished co-op work, behind switches where the plan says so, then batches 2 and 3. Use the
  cheap test methods built during this job: contact sheets (`tools/sheet.mjs`), picture difference (`tools/diff.mjs`), the
  frozen clock (`tools/scripts/lib/steady.mjs`), the kit's fast mode, and the browser slot queue; the machine is shared, so
  few agents at a time (the gore files overlap anyway), tests at low priority, and look-checks for the owner at dpr 2.
- **Owner's answers, 2026-11-18 evening:** soldiers keep the **simple aim model against guests** for now (fixed bullet speed,
  half lead); the **dodge grace (150 ms, 0.5 m) stays** and is tuned after the owner plays co-op; **barrels hurt every player in
  reach, friends included** (team kills by barrel are wanted: do not make them shooter-only).
- **Owner questions still open from the lanes:** a friend's gun report plays at 0.65 volume (louder?); real reload and stim clips
  and an energy blade model for the friend's body (character work).
- 2026-11-18, evening: the machine is shared with another person, who reports it is swamped by the testing. Browser slots cut to 4; every lane must rebase so the queue applies, keep one run at a time, and use a small viewport at dpr 1 for functional proofs.
- 2026-11-18, proof-speed: browser proofs made cheaper. **What changed for every lane, with nothing to do but rebase:**
  (1) **Fast mode is the kit's default.** Pages opened by `startParty`/`startPair`/`openGuest` simulate every frame as before
  but draw no frame until a picture is asked for, and their Web Audio stays suspended. Every screenshot draws fresh frames
  first, so pictures are as they were; a frame rate the kit reports is now the loop's (frames simulated a second), and
  `measure(party, s, { draw: 'all' })` draws every frame for one window. **Opt out**
  with `look: true` in `startParty`, or `COOP_LOOK=1` on the command line: do that for look-checks, videos, and any proof
  about smoothness, the cost of drawing, or sound really playing (`draw: 'all' | n` and `audio: true` singly; `COOP_DRAW`,
  `COOP_AUDIO=1`). The game-side switch (`src/core/proofmode.ts`, `Renderer.settle()`, three lines in `Game.frame`) works only
  on a dev build or localhost and only when the kit asks. (2) **`tools/shot.mjs`** serves waiting runs in order of arrival and
  starts no run while less than 20 GB of memory is available; 3 slots (the lead's cut, kept: by the memory and CPU arithmetic in
  the note 3 fits and 4 only while runs are short, and fast mode does not buy another).
  (3) **`node tools/proof-cost.mjs -- node tools/shot.mjs ...`** prints what any run cost (wall time, wait, peak memory by
  process, CPU by process and thread). (4) Guests of a 3 or 4 player party boot side by side. Why, with the numbers:
  `docs/notes/coop.md`, "What a proof costs, and fast mode": one game page is 1.25 GB whatever the window size; the page's audio
  thread was the largest single cost of a proof (0.8 of a core per page) and drawing the second. **Measured gain: a fifth to a
  quarter less CPU per proof** (`coop-stage3` 334 to 265 CPU seconds with the same 12 checks, `coop-drops` 954 to 815 with the
  same 8, `coop-smoke` 186 to 144-164 with the same 5) and steadier pages (three pages at about 38 frames a second against
  about 5); **not wall time and not memory**: a proof is mostly its four boots and its own waits. `clock: 60` (opt-in) steps a
  page's loop on a timer instead of animation frames. **Then the big one, also on by default and in look mode too: a pretend pointer lock on every kit page**
  (`realLock: true` or `COOP_REAL_LOCK=1` opts out). Headless Chromium's real lock runs away in guest windows: tens of
  thousands of pointer updates a second, the browser process at 1.2 cores and growing to 3 GB, the guest's view turning by
  itself. That was the guest page at 0 to 1 frame a second. With the pretend lock `coop-drops` went from 815 CPU seconds, 9.4 GB
  and 8 of 12 checks to 148 CPU seconds, 3.2 GB and 12 of 12. **If a proof of yours was flaky or slow on the guest, run it again
  after rebasing.** A kit of your own that opens pages itself passes `party.draw` and `party.audio` to
  the kit's exported `prepare()`. Found on the way, not mine to fix: `coop-robust.mjs` waits 40 s for a dropped guest to leave
  the player list and failed there in fast mode; the session lane now keeps the seat 60 s, so it very likely fails in today's
  mode too (not run). And `coop-stage3.mjs` fails since a change landed around 22:55 at "The guest shops while the world runs
  on" (the guest's `shop:open` leaves it `playing`), with the real lock and today's defaults as well: the shop or break
  rules' lane should look. Also written down: what a co-op
  test without a browser would take (`docs/notes/coop.md`, "Co-op tests without a browser"). Touched outside my files, small:
  `src/core/Game.ts` (the draw gate), `src/core/contracts.ts` (`settle?()`), `src/render/Renderer.ts` (`settle()`).
- 2026-11-18, world-b, step 3 landed: **prisoners for guests as designed** (`src/net/world/capture.ts`): tap questions, a second tap
  releases, a 0.4 s hold captures, the exact prompt and the ring, the reveal for the whole team, the bounty to the captor, two
  players on one man settled by the host, late join. Decision: the human shield is off in the single-player game
  (`HOSTAGES.on = false`, owner 2026-11-15), so it is off in co-op too; the guest's side of it is built and proven with the switch
  on, so turning it back on needs no co-op work. The skyhook stays the call-ins lane's (it hooks the host's `Airlift`).
- 2026-11-18, world-b, step 4 landed: **enemy vehicles are working machines on a guest** (`src/net/world/vehicles.ts`: wheels,
  steering, tracks, springs, barrel, roof gun, thrown tracks, engine and fuel fires, engine sound, from `GroundVehicle.wire()`;
  the same wreck on its own colliders with the tank's turret thrown the same way; late join), **mounted guns have one gunner
  on every screen** (`gunseat`, `fortstate.guns`, `Emplacement.remote`), and guests see and hear the garrison fire (10 shots a
  second at most, through the enemy-attacks lane's flash and sound relays). Decisions: a guest's copy of a wreck is the real
  `Wreck` class as a `ghost` (no damage, no cook-off blast of its own); vehicle guns' flashes and sounds stay the enemy-attacks
  lane's. Not done: the enemy attack helicopter is still not drawn on guests; the mounted-gun seats have a unit test and no
  browser proof yet.

## The owner is away: standing orders (2026-11-18, night)

The owner left to run errands and will not answer questions. The lead decides, using his feedback so far, and writes each
decision in the log. Order of work:

1. **The remaining co-op lanes finish and report.**
2. **Last pass: do the pieces fit, and is the upgrade truly complete?** The wire pass, a whole-diff review by fresh agents,
   every lane's proof re-run on the final tip (clean, bad network, real WebRTC, 2 to 4 players, every mode), the smoothness table
   on a quiet machine, every "not done / not proven" item from the lane reports chased down, and fixes. Then typecheck, the
   whole suite, a production build, and the branch pushed.
3. **A report on the whole co-op update:** what was done to make it good, and an honest statement of confidence that
   multiplayer is good and complete, with what is still unproven.
3a. **Merge into `dev` when it is stable (owner, 2026-11-19): "merge a stable version with the updated net code into the dev".**
   Stable means: the last pass is green (the single-player regression in `Combat.ts` fixed, the proof sweep passing on the
   final tip, typecheck, suite and production build clean). Then fast-forward local `dev` to that commit. **Do not push `dev`**
   (that deploys the public site) until the owner says "push"; when he does, follow the push procedure in `CLAUDE.md`.
4. **Then the damage response update starts** (`docs/proposals/damage-response-update.md`, the owner's answers in 10a) and runs
   **to the end without stopping to ask**. The two goals in his words: (a) gibbing must never feel like body parts
   disappear: what a destruction spawns should roughly match the size of what was destroyed, a body breaking apart, not being
   erased; (b) ragdolls should feel like Red Dead, a state-of-the-art responsiveness gradient, with no on/off switch. Risky
   steps go behind switches so he can compare when he is back; taste calls are made from his answers and recorded.

Keep the machine modest throughout: it is shared, and the other person may shut the agents down if it is swamped (3 browser
slots, tests at low priority, few agents at once).
- 2026-11-18, time: three fixes from the browser proofs landed after the first step: a guest that keeps re-asking lets go when the
  host ends it; in co-op the blends run on wall time, so a screen with long frames is back at full speed with the others; a lost
  "I let go" is said again. Proofs on the landed code: two pages 91 checks clean and 91 under `lag:120,jitter:40,loss:0.05`, three
  pages 87, the slow host 11 (10 fps host: world at 1.00, 0.50 with the fix off), single player 11. Numbers in `coop.md`.
- 2026-11-18, world-b, step 5 landed: **the enemy attack helicopter flies on guests** (the vehicle system's own airframe from
  `EnemyChopper.wire()`: rotors, chin gun, tail and rotor shot off, fire and smoke as it falls, engine sound, hit boxes) and comes
  down as the same wreck. Proofs at this point, all on the loopback transport, clean and under `lag:120,jitter:40,loss:0.05`:
  Defense 64 checks (two pages and a late joiner) and 71 (three pages), props 40 (three pages) and 33 (bad network, with a late
  joiner), prisoners 34, vehicles 27. Note for every lane: commit `4b36599` (enemy-attacks step 3) reverted this lane's whole
  step 3 at the tip (capture.ts, prisoners.ts, the test, the proof, the notes); it was restored in `c29e2ef`. Rebase, never copy
  files over a newer tip.
- 2026-11-18, call-ins: every call-in, the Frame, the sentry, the skyhook and the streak perks' effects play on every screen.
  **How:** the caller sends an order (`cin`: id, its own number, the mark, one angle, a seed) and news of what the order cannot say
  (`cnews`); every other screen runs the *same strike class* on a context that cannot hurt (`progression/callins/ghost.ts`,
  `mirror.ts`), so the aircraft, path, guns, rounds in flight, beams, blasts and sounds are the caller's own code. The table per
  call-in, the wire and the numbers: `docs/notes/coop.md`, "Call-ins on every screen". Decisions: a copy starts when its order
  arrives (one network delay behind the caller, in step with the kills and booms on the same ordered lane) rather than on a shared
  clock; a copy draws its own blasts (`mirrored` on the caller's, so no `boom`), which is why a gunship run costs no booms; the
  blast budget is two buckets (24 a second of anything, 12 more for large or near), one pair per sender on the host; the AA sentry's
  copy tracks and fires by itself at the same drones (its shots are not sent); the nuke's countdown banner, the shove of its front
  and the Black Sun's tug reach every player; the host's copy of a guest's Black Sun drags the real enemies (the world is the
  host's). **For other lanes:**
  - **claims:** call-in damage arrives as claims from these sources, all from the caller's own game: `airstrike` (rockets, and the
    instakill finale as blast kind `hellfire`), `warthog`, `orbital` (fire ticks plus one `plasma` blast; its burn goes through
    `enemies.afflict`), `black_sun` (crush ticks, then the instakill `finisher`), `nuke` (type `true`, 999999), `sentry` (rays),
    `drop_pod` (the sentry's and the Frame's landing), `ac130_25mm`, `ac130_40mm`, `ac130_40mm_ap`, `ac130_flak` (blast and
    pellets), `ac130_105mm`, `ac130_wp` (blast; the cloud burns through `afflict`), `ac130_bomb` (instakill `finisher`),
    `ac130_crash`, `chopper_cannon`, `chopper_rocket`, `chopper_crash`, `door_gun` (rays and bursts), `door_gun_crash`, and the
    Frame's `frame_rotary`, `frame_40mm`, `frame_40mm_ap`, `frame_flak`, `frame_pod` and its blows. A watcher's copy claims
    nothing. The host notes a call on `cin` as well as on `callin` (`validator.callIn`).
  - **missions:** the Frame needs nothing from you: any player in a Frame, however boarded (`progression.frame.board(...)`), is a
    puppet on the other screens (`docs/notes/frame.md`, "Co-op"). `flyFlight` (the courier) is announced too and its shoot-down
    reaches every screen. `boardFlight` rides are still one copy per player and are not mirrored. `callins(held)` is yours.
  - **enemy-motion:** one line in `Replicas.animate`: a replica with `carried` set is skipped (the skyhook's copy places him).
    Keep it, or give the skyhook another way to hold a replica.
  - **weapons-fx:** `RemotePlayer.hidden` (one field, one line in `update`) hides a friend's body while they are in a Frame.
    `ProjectileSpec.ghost` is the call-ins' harmless round that bursts by itself; `cosmetic` (enemy-attacks') stays the copy that
    waits for its owner. `ExplosionSpec.cosmetic` is a blast that hurts nothing and is never sent on.
  - **world-a:** `ctx.coop.world.boom(center, kind, radius, scale?)` shows a blast combat did not make (a barrel) on the others.
  - **enemies:** new game event `callin:teammate` (host only: a guest called one in); the Commander's MANPADS and the Outpost's
    dread hear it. A guest's aircraft is brought down by `aadown` to that guest.
  Not done: the missile a Rocketeer or boss fires at an aircraft is not drawn for watchers; enemy helicopters do not fight a
  guest's helicopter; a call-in already running when a player joins late is not caught up; a guest is never held by the uplink
  jammer (the radio men are the host's).

## Last pass checklist (the lead's list, from every lane's "not done or not proven")

Work through all of it; write the outcome beside each item in the log (fixed with commit / proven with proof / left, and why).

**A. The pieces fit**
1. **Accidental reverts.** Lanes rebased onto each other all day and at least one landing (`4b36599`) silently reverted another
   lane's files (restored in `c29e2ef`). For every commit on `coop-overhaul` since `958212f`, check that what it added is still
   at the tip or was removed on purpose by a later commit that says so. Restore anything lost.
2. **Whole-diff review** by fresh eyes: event flows across lanes, order of handlers, catch-up for late joiners and reconnects
   for every one-shot fact, double handling (world-b's `wallblast` against any other path that feeds a guest's blast to the
   host's walls, shutters and sandbags), growth without bound, allocations in hot paths, and every place single player could
   have changed.
3. **Single player is unchanged** apart from the blood puff and the dropped gun that settles on the ground: play single-player
   Crucible, Endless Humans and the start of a mission in the browser on `dev` and on the tip and compare behaviour, frame
   time and memory. This is the owner's first rule.
4. **Typecheck, whole suite, production build.** In the built site the test-only switches (`?net=loop`, proof mode, the pretend
   pointer lock) must be unreachable; `?netsim` is allowed. Fix the stale `devflags` test (update its expectation) and make
   the three load-flaky tests deterministic or explain them (`gore/knockdown`, `gore/strength`, `weapons/viewmodels/hands`).

**B. Proofs on the final tip** (fast mode, 3 browser slots; `look: true` only for look-checks)
5. Every lane's proofs again on the final tip, clean and under `lag:120,jitter:40,loss:0.05`: session (all nine), team (endings,
   break, rejoin, ui), gore, weapons-fx matrix (its bad-network re-run never completed), call-ins matrix, world-a, world-b,
   time, enemy-attacks (the full bad-network table never completed), enemy-motion moves, claims matrix, missions; and the old
   proofs (`coop-smoke` in all seven modes, `coop-stage3`, `coop-drops`, `coop-robust`, `coop-modes`, `coop-mission`;
   `coop-lobby` waits for a splash that is gone: fix or retire it; `coop-stage1/2`, `coop-picker`, `coop-dad` unrun).
6. **Real WebRTC:** each lane's main proof once over `rtc`. **Four players:** each lane's main proof once.
7. **Every mode from a guest's seat:** Crucible, Endless Humans (and the Office map), Outpost Defense, The Outpost, Foreclosure:
   a scripted fight with enemy attacks, kills by host and guest, a break with the shared pod, an ending.
8. **Smoothness table on a quiet machine:** `node tools/scripts/coop-motion-matrix.mjs --baseline d9ecffb` (12 cases). Also
   vehicles and garrison on the buffer in the browser.
   **Done 2026-11-19 (verify-motion): the table is made, 24 of 24 runs counted, and two faults it showed are fixed.**
   The tables and what they mean are in `docs/notes/coop.md`, "Enemy motion", Measured; the outcome is in the log below.

**C. Known gaps to close or decide**
9. A guest's Warthog once dealt no damage and the host recorded no claims (call-ins report, not diagnosed). Also: claims,
   `fire`, `capture` from a guest whose body has no pose yet are dropped silently (split report, bug 5). No honest claim may be lost.
10. Outpost Defense on a rejoin: the loadout screen opens again and replaces the restored kit.
11. A reconnect on the same page after a long drop gets no team `restore`/`sync` (wave banner, pod call); use `session.onArrived`
    with `rejoin`. A reload on the lobby page drops out of the room. A host reload longer than the guests' grace leaves two hosts.
12. A claim the host refuses leaves the guest's drawn wound: add a small "refused" answer or show why it is harmless.
13. Kill feel for a guest: try dropping the body on the frame of the shot when the guest's own numbers say it is clearly dead;
    a wrong guess must play as a knockdown and get-up, never a corpse standing up. Keep it only if it looks right; behind a switch.
14. Endless Humans: a guest's killing headshot plays the non-kill crack first; the Lance's kill stop and cleave count read the
    host-only `killed`; stake pins and melee flings on a guest are unit-tested only.
15. Watchers: a teammate's rounds into a corpse; stakes that stop in a body; the Trommel's spin-up whine; perk tracer colours;
    Gun Kata, the Judge fan, smart aim, the Quiver salvo and the four non-katana melee weapons proven in the browser.
16. Call-ins: the uplink jammer holds a guest's call-ins as it holds the host's (lead's decision); a call-in running when
    someone joins late; the missile an enemy fires at an aircraft; copies on a slow watcher re-sync (only the gunship does);
    the skyhook in the browser (Endless Humans).
17. The villain learns from every player's shots, pickups, sonar and call-ins, not only the host's; the sonar jammer's false
    men on guests; a guest can order squad allies and revive a downed ally with a stim.
18. Skipping the Commander's briefing counts as the host's ready vote (lead's decision). The slow-mo notice must not sit on
    the wave banner. The lobby tags a player with cheats on. Pods and dropped guns age on the wall clock: check that this
    reads right under slow-mo.
19. The kit: `openGuest` cannot join a running match; move world-a's `lateGuest` into the kit.
20. The wire pass (stage "wire"): batching per frame, no per-message match UUID, no double stringify for stats, backpressure,
    host per-frame cost flat in players, binary for the hot events only if the numbers ask for it.
21. Worth a look if cheap: Web Audio's thread costs 0.8 of a core per page (real players too?); a 353 ms shader link one second
    into play; JS heap growth over fixed rounds.

**D. Finish**
22. `docs/notes/coop.md` reads as one document; `docs/HANDOFF.md` and `CLAUDE.md` say what is true now; the audits are marked
    with what was fixed. Push `coop-overhaul`. The lead writes the report for the owner.
- 2026-11-18/19, claims: landed (`f20155d` the split of `claims.ts` out of `hits.ts`, `2b7a8e4` the new check, `1043123` vehicles,
  then the proof and what it found). The host favours the shooter: per-gun token buckets on the shooter's clock built from the
  weapon table, clamp instead of reject, sight only for a straight shot from a gun that cannot pass walls, claim classes, `status`
  and `vhit` claims. Proofs: `claims.matrix.test.ts` (604 cases, 1.2 million claims, none refused or cut) and
  `tools/scripts/coop-claims-matrix.mjs` (63 rows as host and as guest: 63 of 63 on a clean link, under
  `lag:120,jitter:40,loss:0.05`, and with the host at 15 fps with stalls; 7,202 guest claims, 0 rejected, 0 cut). Decisions: a claim's
  shot id is the claims module's own count, not `fire.shot`; call-in damage needs no announced call-in except for the instakills
  (10 minutes); a blocked straight shot passes on a small allowance before it is refused; a guest's vehicles are solid (they have
  the real hit boxes); `booms.ts` no longer carries vehicle damage; the hit point is not checked against an enemy that is down on
  the host (each screen has its own ragdoll). What each check is: `docs/notes/coop.md`, "Claims". For whoever runs proofs: restart
  your Vite after editing `src/` (the machine is out of file-watch handles, so a running server keeps serving old code), and
  `page.bringToFront()` the page that must run at full frame rate.
- 2026-11-19, missions: landed. Every mission operation is classed in one table (`src/campaign/coop.ts`, printed in
  `docs/notes/coop.md`, "Missions") with tests that fail on an unclassed one. Newly on every screen: the sky shut to call-ins, the
  lights, a brain chip the mission hands out, the courier and its flak, the wreck's smoke, the checkpoint notice, the war's
  call-outs, the breaching charge's countdown, the sniper's round, the Frame's stand-in. Any player's shot, zone, rack take or
  low rockets counts; a wall gun turns on any player. Decisions: a film is skipped when every player has pressed skip; a gun on a
  rack is the team's (first to reach it, everyone is issued one); a section ended by a zone moves on with the first player and
  the others have 10 s to get into it before being put on that player's spot (a closing door: 5 s, 30 m); a ride ends for all
  with the host's; a checkpoint restart is the same new run on every screen; each player keeps their own starter gun. The
  missions' Frame beats are still the game's stand-in, alone too, so nothing to pilot yet: when a real one is provided, first
  to reach it pilots. Both missions played start to end on 2 and 3 pages, clean and under `lag:120,jitter:40,loss:0.05`, with a
  restart and a rejoin, and a stretch on real WebRTC (table in the notes). Found on the way and fixed: a hidden co-op tab froze
  on a slow machine (`Game.ts`: one step per queued worker tick, without end). For every lane: **a dev server started with
  `OP2_NO_HMR=1` served stale files after edits on this machine** (its watcher missed them while many servers ran): restart
  it before a proof. Not done: a guest ordering or reviving the host's Bailiffs; the Outpost's chopper, scenery vehicles and
  vehicle kill marks on guests (world-b's vehicles); the Commander's box between rounds in a mission (enemy-attacks).
  Under `lag:120,loss:0.05` the kit's own Start can be pressed before the host has the guests' "ready" and is then refused
  (my proof waits for "Everyone is ready" first).
- 2026-11-19: the owner said push, to demo co-op from the public site. `dev` and the site are at `1aee89b` (typecheck clean, production build boots with no errors, dist audit clean, `coop-smoke` over real WebRTC 5 of 5; the suite's two failures were the stale `devflags` test and `gore/stand.test.ts`, which passes 3 of 3 alone). The last pass was still running, so later fixes on `coop-overhaul` are NOT on the site: push again, with the owner's word, when the last pass is green.
- 2026-11-19: the owner got 'The lobby servers could not be reached' on the public site. From the dev machine all but one of the 8 relays answered and a lobby opened on the live site, so it was his link (slow or mobile). Hardened anyway and pushed: `RELAY_WAIT_MS` 10 s to 25 s, relays 8 to 12 (the first 8 unchanged; one was dead). `dev` and the site are at `e62bd0e` (the demo build `1aee89b` plus that one commit); merged into this branch.
- 2026-11-19, fix-session (the session, team, call-in and mission fixes of the network review; checklist C10, C11, C16, the lobby
  part of C18). Landed in steps up to `a47cff6`; the full account is in `docs/notes/coop.md` ("Hooks for the other lanes", "What a
  late or returning player is caught up on", "Host loss", "Reloads", "Call-ins on every screen", "Vehicles and the garrison").
  **For verify-motion:** the vehicles' and the garrison's 5 Hz state now rides the **unreliable `world` lane** as side packets
  (`world/sideList.ts`, `context.ts` `sendSide`); only the sending and the gathering of parts changed, the drawing and its
  buffer are untouched, but a lost packet now costs that list (200 ms) instead of arriving late in a burst. **For fix-hits:**
  nothing in how a caller's own call-in is told from a watcher's copy was changed (`mirror.ts` still builds copies on the ghost
  context only; `callins.ts` gained an `age` on `cin` and two news kinds). **For wire:** `lobby.ts` `hello` gained `n`, `set`
  gained `cheats`; `context.ts` routes the `world` lane through `worldIn`.
  - **Review major 3 (the seat hooks had no listener):** `CoopWorld` is the one listener (`src/net/seats.ts`). Arrived: any way
    in gets the team's word and every catch-up; the same page back after a drop gets the wave event it missed, with the clock of
    now, and a quiet `sync`. Lost: slow-mo, Ghost, mounted gun, held man and call-in copies are let go at once, on every
    screen. Forget: every map kept by connection id is pruned (review minor 8 with it). The catch-up table is in the note.
  - **Review major 2 (a guest's one-shot words dropped while away):** "I am down" is said again every second until the host's
    card agrees (and a guest the host has moved on from stands up); Ghost, the kit, the gun in hand, a cache share, a mission's
    round counts and running call-ins are said again on the host's `sync` (`WorldModule.resay`). Left as they are, with why, in
    the note's second table: a vote, a revive and a prisoner key (the player sees the host's word and presses again), a fort
    purchase (refunded after its own timeout), hit claims (C9, C12: fix-hits).
  - **Review minor 5 (`worldsync`):** sent after `loaded`, and again every second until the seat is settled; the host arrives an
    unknown page on it and sends a lost seat again. It is now a real spare.
  - **Review major 4 (the last one standing losing their link):** a lost seat that was up counts as up for 10 s
    (`LOST_UP_MS`), and gets at least 5 s more once its line answers again. A deliberate leave is not a lost seat.
  - **C10, C11:** Outpost Defense opens no loadout for a returning player and the restored kit wins; a reload on the lobby page
    walks back into the room (guest and host; seats and slots kept); two hosts on one code are settled by one rule
    (`Lobby.otherHost`: the one with nobody connected gives way to the one with players, of two with nobody the newer goes, each
    says its count again every heartbeat), so a host back after its guests regrouped joins their lobby as a guest and nobody is
    stranded; the unit test of the host-lost board is back (`session.test.ts`). A reconnecting guest takes back only the host it
    knew, by browser id (review minor 9, second half).
  - **C16:** the jammer holds a guest's call-ins as the host's; a call-in already running is shown to a late or returning
    player from where it is; every copy keeps the wall clock (a slow watcher catches up, the skipped stretch silent); an
    enemy's missile at an aircraft is flown on the watchers' screens; the skyhook tells an arriving player of a drone on its way.
  - **A mission won in co-op** is recorded on each guest's own save. **Decision:** a co-op run still writes nobody's solo high
    score, host or guest (the rule from before the overhaul, `progression/score.ts`); lead or owner to say if co-op should
    keep high scores of its own.
  - **C18 (lobby):** a player with cheats on is tagged in the lobby list.
  - **Review minor 7:** vehicles and garrison off the reliable lane (above).
  - Found by the browser proofs and fixed: the wipe grace ended as a returning seat passed through `loading` (bad network
    only); two guests swapped slots when a host reloaded on the lobby page (slots are now kept by seat).
  - Decisions the lead may overrule: the same page back is replayed only the **last** wave event it missed (a player away for
    a whole wave misses that wave's pay, as before); a returning host **always** joins a regrouped lobby that has players, and
    takes its guests back only while they are still waiting on it or their new lobby is still empty and newer; a call-in that
    cannot be run forward blind is not shown part-way to a late joiner at all.
  - New for proofs: `window.__op2.net.sim.cut(true)` is a dead line (nothing leaves or arrives, reliable lanes included) on
    either transport: the way to make a guest act behind a dropped connection while both pages run.
  - Proofs and their results: see the table under this entry's last line in `docs/notes/coop.md`, "The life of a session",
    Proofs, and the lane's report. Unit: 2,713 tests pass (the one known `devflags` failure aside).

## Last pass: verify-proofs (checklist B5, B6, B7, C19) — running log

How to carry on if this agent stops: everything is in the runner. `node tools/scripts/coop-all.mjs --port <5480-5489> --suite
clean,bad,rtc,four,guest,legacy --out /home/jared/jared/overpowered2/tools/out/coop/verify-proofs/all` skips what already passed
on the same game and carries on; `results.md` there is the table so far. Sweeps run from a second checkout pinned at a commit of
`coop-overhaul` (a rebase in the working checkout changes the source under a running Vite), on port 5481.

- 2026-11-19 01:30, verify-proofs: **the runner landed** (`0d24813`, `92b73a0`): `tools/scripts/coop-all.mjs`, 59 runs in the clean
  suite, 142 with bad network, real WebRTC, four players and the guest's seat; documented in `coop.md` "Testing" and `CLAUDE.md`
  "Tools". **C19 done:** the kit has `lateGuest(party, name)`; world-a's `lateGuest` and world-b's `lateJoin` are now that (their
  late pages used to be the one page of a proof on the real pointer lock, drawing every frame).
- 01:45, verify-proofs: `tools/scripts/coop-guest-seat.mjs` (B7) plays one session per mode from a guest's seat: a fight, kills
  and credit, gore, slow-mo with its notice, a guest's call-in seen by the host, a shared gun, down and revive, the break with
  the shared pod and every player shopping, a reload that rejoins with the kit, the team board. **The Crucible, three players,
  loopback, clean: 72 of 72 checks** once the proof read the notice rightly (it stays up through the blend back to full speed
  with "WORLD BACK TO FULL SPEED"; `coop-time-team.mjs`'s check that the notice outlasts the slow-mo cannot fail as written:
  it only notes the notice gone after the world is at full speed).
- 02:50, verify-proofs: the guest's seat in all six mode and map choices, three players, loopback, clean (pictures looked at:
  the fight, the notice, the call-in, the dropped gun's column, the downed screen, the shared pod with the ready vote and the
  Commander's box on a guest all read right). Crucible 72 of 72, Endless Humans on the Office 74 of 74, Endless Humans 72 of 74
  on the run before two proof fixes (a revived guest was shot down again before the check; a man who took cover was shot at for
  30 s), Outpost Defense 67 of 70 (finding 2 below), both missions 64 of 66 before the fix of finding 1 and 23 of 23 on its
  steps after. **One real bug found and fixed, one known gap confirmed with evidence:** see "Last pass findings".

- 04:40, verify-proofs: **the clean sweep on `0303bad`: 56 of 60 runs passed** (every lane's proofs, loopback, two or three
  players). The four that failed were the proofs, each fixed: `coop-lobby` (rewritten on the kit in this pass; it read the
  wrong line for the host's guide), `coop-robust` (waited 40 s for a dropped seat to be freed; a seat is kept 60 s now, so it
  reads the seat as lost), `coop-attacks-shots` (a look-check that freezes on a drawn frame; fast mode draws none, so it now
  asks for `look`), and `coop-callins-matrix` (no level ground found for its mark on that run; run again on the tip).
- 04:50, verify-proofs: on the lead's word the sweeps restarted once more on `e0334ec` (the fix agents and the wire pass are
  in), four runs at a time, in this order: guest's seat, clean, bad network, real WebRTC, four players, the four oldest. From
  here a proof is run again on a newer commit only if the commit touched its area (`--any-commit`, then `--force --lane`).
  **Guest's seat on `e0334ec`, three players, loopback, clean: Endless Humans 74 of 74, the Office 74 of 74, Outpost Defense
  all passed (the reload keeps its kit now: fix-session's C10 confirmed), The Outpost 66 of 66, Foreclosure 66 of 66; the
  Crucible 72 of 74**, the two failures the proof's (it stood the third player inside a wall beside a pod that landed by one;
  fixed, to be run again). The runner also lists the fix agents' and the wire's proofs now (72 runs in the clean suite). The
  ledger is `docs/notes/coop.md`, "What is proven", written from the runner's results as they come.

## Last pass findings

Each: what fails, where, how many players, which network, the evidence, the cause. For the fix agents.

1. **FIXED (verify-proofs). In a mission, a guest who reloads loses every gun the mission did not hand out** (a gun a friend
   dropped for them, their share of a weapon cache). Both missions, any player count, any network. Evidence:
   `coop-guest-seat.mjs` with `COOP_MODE=campaign` and `foreclosure`, step `rejoin`: before `deuce, judge, smg, sword`, after
   `smg, sword`. Cause: two lanes met. The team's seat gave the kit back (`team.ts` `restored`), then the mission's catch-up for
   the same arrival sent `deploy [null, kit]` and the guest ran `weapons.setLoadout` with the mission's kit, which replaces.
   The same happened to a player whose connection dropped and came back on the same page (`net/index.ts` calls
   `team.onArrived` for a rejoin, so the mission caught them up again). Fix: on a guest, a catch-up `deploy` (no mark) for a
   player who holds a kit of their own (the seat has just given it back, `Team.takeKitBack()`, or this page was deployed
   before in this run) adds the mission's guns they lack and takes nothing away. A marked deploy (the start, a checkpoint
   restart) and a brand-new late joiner replace as before. Tests: `mission.test.ts` "catches up a player who holds a kit of
   their own by adding to it", `team.test.ts` (the flag is set once by a restored kit). Proven in the browser in both missions.
2. **Known as C10; fixed by fix-session while this was being written (`a47cff6`), to be confirmed by this proof on the new
   tip. Outpost Defense: a guest who reloads loses its kit and credits.** Three players, loopback, clean, at `92b73a0`.
   Evidence: `coop-guest-seat.mjs` `COOP_MODE=defense`, step `rejoin`: guns `deuce, harrow, rivet, smg, sword` became
   `harrow, rivet, sword`, credits 2345 became 300; the loadout screen was up on the returning page. Cause: every new page
   starts with `needLoadout` set (`src/contracts/defense/index.ts`), and its `deploy()` replaced what the seat's `restore`
   had just put back.
3. Proof, not game: `coop-time-team.mjs` noted the notice as gone only after the world was back at full speed, so "the notice
   stays until the world is at full speed" could not fail. It now notes it whenever it goes, and adds "no screen was slow at
   any moment with no notice up" (the notice counts as up while it says WORLD BACK TO FULL SPEED, which it does through the
   0.45 s blend back; the words are a little early, the notice is there).
4. Seen in a picture, small: two teammates in the same direction overlap their name tags on the HUD (Office, guest's view:
   "HOST-ONE 38m" printed over "GUEST-THREE"). Not fixed.
- 2026-11-19, 03:20: with fast mode and the pretend pointer lock a proof costs a fraction of what it did (three runs: load 5, 37 GB free), and the queue was the bottleneck (6 runs waiting). Browser slots raised from 3 to 6; the memory floor in `tools/shot.mjs` (no run starts under 10 GB available, the owner's figure; it was 20) still protects the other person. Every agent: rebase to pick it up.
- 2026-11-19, fix-session, the browser proofs on the landed code (`tools/scripts/coop-fixsession-return.mjs`, `-reload.mjs`,
  `-callins.mjs`; evidence in `tools/out/coop/fix-session/`, not kept in the repo). Loopback, clean: return 26 of 26 (3
  players) and 28 of 28 (4 players); reload lobby 19, defense 6, host late 8; call-ins 24; `coop-worldb-vehicles` 27 on the
  new lane. Loopback under `lag:120,jitter:40,loss:0.05`: return 26, reload lobby 19, call-ins 24. **Real WebRTC:** return 23
  of 23 (2 players; lost after 20.6 s, back 1.6 s, wipe 10.04 s after the loss) and host late 8 of 8. The first WebRTC run of
  host late failed: the host that gave way connected to both teammates as a guest and never heard the new host's hello, so
  it ended on "lobby not found". Fixed in `69792f0` (a host answers a guest's hello with its own) and passed on the re-run;
  there the old host was in its team's lobby 227 s after its page went away (regroup at 41 s; the rest is its own page
  loading and connecting on a loaded machine, not measured apart). Not run: host late and the reload cases under the bad
  network over WebRTC, the call-ins proof over WebRTC, the Defense rejoin at 3 players.
- 2026-11-19, fix-game (the game-side review `tools/out/coop/review-game.md`; checklist C17 and the game half of C18): landed.
  - **Review 1, the single-player blocker:** fixed (`Combat.strike` reads `quiet` before the damage again; `strikefeedback.test.ts`).
    A round that sets off a tank keeps its body sound, blood, marker, headshot sounds and hit-stop. The same mistake once more,
    co-op only: a tank going up inside a hit overwrote the damage model's `found` facts, so a host sent the bystander's findings
    for the Bomber's own hit and kill; `blowTank` now keeps and restores them. Seen and left (older than the branch): a blast
    that catches more than 16 bodies can wrap the damage model's ring of results under the round that set it off.
  - **Review 2, the key list:** "Next wave now (Defense, Crucible shop; co-op: ready up)", "Co-op only: mark a spot for the
    team"; the ping takes only the default keys a saved map does not already use; P pauses the Test Range again.
  - **Review 3, draws and allocations alone:** a pod's facing is drawn as it starts to fall and a call-in's scatter comes from
    `Math.random` with no seed drawn (the seed is drawn only with other players to tell); the mortar aim, kill sounds, the
    mission's crowd checks and the prisoner check allocate nothing alone. **Decision:** the seeded path is kept for co-op only.
  - **Review 5, the host's animation level:** confirmed (it went by the distance to the enemy's quarry) and fixed: the host
    draws and animates by its own eye (`EnemyManager.drawnLod`), the AI keeps its number; a guest already used its own.
  - **Review 6 / C17, every player is a player:** done, with the table in `docs/notes/coop.md`, "The enemy side and every
    player". `EnemyManager.focus` runs each mechanic about the player it concerns; a notebook a player
    (`commander/books.ts`); a guest's `note` to the host for what the host cannot see; the jammer's word to guests (`jam`);
    a guest's E key on the squad allies and its stim into a downed one (`aorder`, `arefund`).
    **Decisions:** a habit is one player's and never a sum; routes are everyone's and are summed; the box quotes the round
    of the player whose habit he answers, unnamed (its lines say "you"); the fix on a hidden team picks a living player at
    random; an opening (a reload, low health) is taken only by the squads fighting that player; a man told to follow a
    guest stops following the host. **Not done:** one shared picture of where "the player" is (`Outpost.intel`) is now fed by
    every player and moves between them rather than tracking each; flashbang openings are the host's eyes.
  - **Review 7:** Focus is refused in a lobby walk ("NO FOCUS BRAIN CHIP IN THE LOBBY").
  - **Review 8 / C18, pods and dropped guns under slow-mo: checked, and left on the wall clock, on purpose.** Alone they are
    stepped on the real clock (`pods.update(realDt)`, `dropped.update(realDt)`, as on `dev` before the overhaul), so a pod has
    never fallen slowly in slow-mo. The wall clock is that same real time. Making them follow the world clock would make co-op
    the one place they slow down (owner decision 5). Pinned by a test. **The lead or the owner may overrule: it is a look call.**
  - **Review 9, 10:** the `[coop gun]` and `[coop pod]` logs only on a dev page; `isGuest` (`core/coop.ts`) for the six copies
    and their inline twins; one `parkDrone`; `callAt` exists only on a page the proofs may drive (`proofPage`); the indent.
  - **C18:** pressing through the Commander's briefing is that player's ready vote (`TeamBreak.readyUp`; a guest's too). The
    slow-mo notice did sit on the wave banner (28 px at 1440x900): top centre is now stacked (strip, ready chip, notice,
    banner), each making room for the one above.
  - **Proofs.** `coop-fixgame-villain.mjs` (Endless Humans): 2 players clean 29 of 29, 2 players under
    `lag:120,jitter:40,loss:0.05` 29 of 29, 3 players clean 30 of 30. `coop-fixgame-notice.mjs` (dpr 2, 1440x900): 37 box
    checks on both screens. **Single player, in the browser:**
    `tools/scripts/solo-fixgame.mjs` (frozen clock, seeded `Math.random`, sound silenced so only the game throws the dice)
    run on `dev` as it was before the overhaul (`a5e0d38`), on the tip before this lane (`b6ddad8`) and on this branch, and
    compared with `solo-fixgame-compare.mjs`. This branch is **the same as the old `dev` in every part**: 38 s of Endless
    Humans with the player running and never firing (12 samples: 14,784 random draws, every enemy's place and health, the
    noises heard, the notebook, the stillness clock, the intel), the supply pod's facing and the frame it is drawn on, every
    Airstrike rocket and Warthog shell, the Sentry's facing, and the sounds and markers of a Bomber shot dead beside a
    bystander. Two runs of this branch are identical. The tip before this lane differed from the old `dev` in the pod, the
    three call-ins and the Bomber's feedback (the review's findings 1 and 3) and in nothing else recorded.
  - Seen in passing, not mine: with music on (localhost), the "now playing" tag is drawn over the co-op teammates strip
    for the few seconds it shows.
- 2026-11-19, fix-hits (checklist C9, C12, C13, C14, C15, review-net M1, m2, m3, m4, m9, and the lead's "a guest's gun does less
  work"). Landed on `coop-overhaul` in steps; details in `docs/notes/coop.md` ("Kill credit and rewards", "Claims", "The same
  work for a guest's gun", "Gore on every screen", "Weapons on other screens", "Enemy motion"). Outcome, item by item:
  - **M1, burn kills went to the host: fixed.** The burn tick's source is `burn`; the table matched a made-up `fire`. Credit
    now goes by one table of every damage source (`creditRule`), a test reads the game's code and fails on a source with no
    rule, and the tests kill with the real status tick. Decisions: a fall, a hazard, another enemy's blast, a drone's crash
    and a boss's death go to whoever hurt the enemy in the last 30 s, else the host (as a solo run counts them); fire that
    spreads keeps its owner; the host's own fire is noted as the host's.
  - **C9, no honest claim lost: fixed, and the Warthog explained.** (a) **The Warthog that dealt no damage was the proof, not
    the game:** its mark stood on a walkway 2 m wide over a drop, the targets floated over the pit, and the shells landed 5.9
    to 7.9 m under them on every screen unless one happened to land on the walkway (caught with the new books: the caller
    sent 0 claims, the host refused none). No race in the copies was found or needed. The proof now takes the most level
    open spot. (b) A `hit`, `status` or `vhit` from a guest with no pose yet is applied at once; `fire`, `round`, `loop`,
    `mfx` and a prisoner's key wait for the body, in order, up to 2 s (`world/late.ts`). (c) Every refusal is counted, kept
    with its reason and written to the console (`world.claimBooks`); the claims matrix, the call-ins matrix and the new
    proofs assert it stays 0. **Count from the long scripted fights: 0 refused of 605 hits (noisy), 0 of 305 (clean), 0 in
    the claims rows** (394 and 106 of those were for an enemy already dead on the host, which is not a refusal). Not fixed
    here: an event from a guest the host has marked away is still dropped in `lobby.ts` (M2, the session fix lane's).
  - **C12, a refused claim: fixed.** The host answers `nack` (the hit's number, why); the guest at once stops counting the
    hit against the enemy, gives back the limb pool it wore, takes back a kill it was told on its strength, and gets a
    floored body up. Proved in the browser: a hit refused for `eye` was drawn at once (reckoned 340 of 400) and put back to
    400 by the host's "no" 20 ms later on a clean link, 416 and 645 ms under `lag:150,jitter:60,loss:0.08`. Also: while a
    guest's own hits are unanswered an enemy's health comes from the host's answers, never from a state that may count a hit
    twice.
  - **C13, kill feel for a guest: built behind a switch** (`?predictKills=0|1`, `setPredictKills`, `world.feel`).
    A guest's own hit that its numbers call clearly a kill drops the body limp on the frame of the shot, as a knockdown the
    host's `kill` turns into the corpse where it lies and a wrong guess into a get-up; beyond doubt (three times what is
    left, half its health to spare) the whole death is played at once and the score waits for the host's word. Never for a
    boss, a man with anatomy, a machine, armour, a shield, a ward, frost, or a blast. **Decision: on by default**, by the
    rule the lead set. The proof (`coop-fixhits-predict.mjs`: three pages, one guest predicting and one not in the same
    fight, both shooting the same enemies, six guns in turn, `lag:150,jitter:60,loss:0.08`, 180 enemies): **no wrong
    resurrection** (0 whole deaths wrong of 9, no enemy seen alive after dying on either guest); **0 of 64 bodies dropped
    for dead got up again**; the body leaves its feet at a median of 0 ms after the shot that killed it against 479 ms
    without (71 of 121 kills within 50 ms against 7 of 138). The run before it, with blasts still predicted, had 6 of 53
    get up again (5 of 39 on a clean link): the host rolls a blast's ring and the roll sets its damage, so blasts were
    taken out. On a clean link (120 enemies): 17 whole deaths, 17 right, no resurrection. A kill the guess does not call
    (a blast, armour, a close call) still waits for the host as before.
  - **C14: fixed and proven.** A guest's hit crosses in the struck bone's own axes and the host puts it back on the same spot
    of its own body, so a man's wounds read what the shooter saw; a guest then calls a killing headshot on a man with
    anatomy at the shot (the kill sound, not the crack first). A shot's kill count goes by the guest's guess, so the Lance
    splits and stops on a guest (proved: 0.114 s asked for three kills, 0.06 before). Stake pins and melee flings on a guest
    are proven in the browser (`coop-fixhits-pins.mjs`, 13 checks, prediction off and on).
  - **C15, watchers: fixed and proven.** A friend's rounds mark this screen's corpses; a friend's stake flies on and ends
    where the shooter says theirs stopped; the rotary cannon's spin-up and run-down and a perk's tracer colour reach the
    others; a friend's shot is drawn out to the hit claim's own allowance (16 m at no ping, was a flat 7 m); launches (80 a
    second), landings (240), loop ends (30) and swing effects (60) each have their own count. `coop-fx-matrix.mjs` gained
    the knife, crowbar, shovel, baton, the Judge's fan, the smart aim, Gun Kata, the Quiver's painted salvo, a stake in a
    body, the whine and a perk tracer: 511 checks, host firing and guest firing, clean link. Not proven in the browser:
    rounds into a corpse (unit test only: a corpse in the line of fire is hard to stage).
  - **m4, m9, hardening: fixed**, with property tests (`hardening.property.test.ts`). One state record with a number no enemy
    can have is passed over alone and the writer sends none; a claim's damage is rebuilt field by field from what a claim
    may say.
  - **The replay guard is back** in a form that cannot refuse an honest shot: the very same hit (its own number and the
    shooter's clock) is applied once. The "call-in only if called lately" rule is not back for ordinary call-in damage (a
    lost announcement would lose honest damage); it stands for the instakills.
  - **A guest's gun did less work a shot (the lead's item): found and fixed.** Not hit detection, akimbo, cadence or pierce
    (rows where nobody falls matched hit for hit). A copy's limb pools were sized for the guest's own idea of the enemy's
    health and read against the host's, so a copy of an enemy with more health had every limb part gone: it could not catch
    its balance or push itself up, lay about 2 s longer after every fall, and was out of the line of fire that long.
    Extreme in the proof (10,000,000-health targets), smaller and real in play past a 1.8 times difference (deep waves, the
    host's "Enemy health" rule). Fixed (`fitReplicaHealth`); also the same reaction rolls on both machines for a guest's
    own hit, and a `rise` move so a copy starts up with the host's body. After: Ultramag 9 and 9 hits (was 9 and 6),
    Ultramag akimbo 21 and 21 (was 21 and 11), SMG with AP 60 and 60 (was 60 and 46), the same under
    `lag:120,jitter:40,loss:0.05`. The melee rows' spread is the proof's own (the host's baton: 2 of 12 in one run, 12 of
    12 in another).
  - Seen on the way, not mine: on the tip of 2026-11-19 04:00 the **host's** copy of a guest's airstrike fired 10 and then 8
    of its 15 rockets in two runs of two (the other guest's copy fired 15 both times; three runs on the tip of 01:35 had 15
    and 15), so the call-ins matrix fails "the blasts arrive on host" there. The strike itself was whole on the caller's
    screen and killed 6 of 6. The copy ends when its finale lands (`Airstrike.update` returns `landed`), so a copy whose
    rockets are behind its finale loses the rest. Call-ins, checklist 16.
- 2026-11-19, wire (checklist C20: **done**, measured and proven; the mesh for poses described, not built). **What changed for
  every lane, with nothing to do but rebase:** every reliable event a page sends in a frame leaves as one message per peer
  (`src/net/batch.ts`: a 4-byte match tag, then each event as a record), flushed when that frame's script ends
  (`lobby.batching(queueMicrotask)`, turned on by `CoopSession`), and every event is a packed tree (`tree.ts`,
  `world/pack.ts`) that reads back as exactly what JSON would have carried, so no module's events changed. `w.send` and
  `w.relay` are as they were. **New duty when you add an event:** class it in your module's `…_WIRE` table (`fact`,
  `cosmetic` or `latest`); the build fails without it. **In a test,** read the action lane with `eventOf` / `unbatch` and
  inject with `batchOf` (`src/net/world/pack.ts`); a test `Lobby` sends each event at once, a batch of one.
  **Backpressure** (`pressure.ts`): a guest with 16 KB queued gets facts only; at 128 KB, or slow for 10 s, or when the
  transport loses a message to it, it is cut as a lost seat and comes back with the whole catch-up once its queue has
  drained. **Host cost:** the player list once a frame, the target pick with no allocation. Numbers, heaviest fight, three
  guests: host events 77.6 to 19.2 KB/s and 435 to 151 messages a second on loopback; on real WebRTC the reliable channel
  109 to 30 KB/s and 507 to 160 messages a second by the browser's own count, both channels 204 to 122 KB/s; a guest's
  upload 5.6 to 2.3 KB/s; co-op on the host 1.06 to 0.90 ms a frame (1.48 to 1.17 on WebRTC at the same load). Tables,
  the rule and the proofs: `docs/notes/coop.md`, "The wire". Decisions: (1) a 32-bit hash of the match id per message
  rather than a handshake per connection (nothing to get wrong on a reconnect); (2) flush by microtask, so nothing waits
  longer than the task that sent it and nothing needs an urgent path; (3) one packed form for every event rather than a
  hand-packed form for the hot ones: after it no type is over about 1.5 KB/s a guest, and `hits.ts`, `claims.ts` and
  `remoteFire.ts` were being changed by other lanes; (4) old and new forms never meet, because the lobby refuses another
  build; (5) a guest is never cut from its own side. Found on the way: trystero drops a reliable message after ten seconds
  of a data channel that will not drain, silently (now counted, and it cuts the guest so it is resynchronised); the
  simulator let a message sent after it was switched off overtake the ones it had delayed (fixed in `netsim.ts`);
  `coop-motion-moves` looked for the guest's copies to be gone 700 ms after a clear that takes up to 750 by design (it
  waits now). Touched outside the lane, small: every module's file (its class table, appended), the test kits and tests
  that read or injected the old envelope, `tools/scripts/coop-motion-moves.mjs`. Not done: the enemy snapshots are now
  71% of the host's upload and were not touched; poses direct between guests; a stall on a real data channel (simulator
  and unit tests only). Proofs and what they showed: the same section. One proof did not come out clean: the call-ins
  subset passed 85 checks and failed one ("host-airstrike: the blasts arrive on guest1", 12 of 16), a check that also
  failed in six of eleven runs other lanes made before this pass; it wants the call-ins proof's owner or the verify pass.
- 2026-11-19, verify-motion (checklist B8): **the smoothness table is made.** 12 cases on the old lane (`d9ecffb`) and the
  new, 30 s each, pages drawn: all 24 counted on the first try (guest 60 fps in every run, host 56.5 to 58.7 or 20 with its
  cap, machine load 4.6 to 11.7). Both lanes are now measured on **one yardstick taken from the recordings alone** (how old
  the picture really is, how far the copy is off the host's path, frames it stood still while the host's moved, frames it
  darted), with enemies on the guest's screen, near, far and knocked down told apart; the proof's guest now stays in the
  fight and looks about, and its pages draw (fast mode would have measured nothing a player sees, and the old build cannot
  be told not to draw). **On the guest's screen:** a clean network, the picture is 78 to 80 ms old against the old lane's 109
  to 115 and within 0.8 cm of the host's path against 3.5; a 20 fps host, 0.08% of moving frames stood still against 13.5%;
  `lag:80,jitter:30,loss:0.03`, 0.01 to 0.08% against 14 to 27% (and 0 to 0.3 darts a minute per enemy against 110 to 210);
  `lag:150,jitter:60,loss:0.08`, 0 to 0.13% against 29 to 37%, the picture 285 ms old against 315 to 330 with a tail to 600.
  48 enemies are as smooth as 20. The new lane costs more bytes with the guest in the fight, not the same: 26.6 KB/s of
  snapshots at 48 enemies against 19.9 (11.2 against 8.3 at 20). **Two faults found and fixed:** (1) a knocked-down enemy
  getting up on a guest was drawn for one frame at the host's place and then back where it lay, a pop of 0.9 to 1.3 m there
  and back on every get-up; (2) every change from the near tier to the far one ran the guest's buffer dry (the enemy slowed
  to a stop until its next state), and enemies at the edge of the cone flipped between the tiers: one that stops being near
  is now sent every tick for a second more, its last 12 ticks marked "far", so the guest has fallen back before the states
  thin (about 1 KB/s). A third, vehicles and the garrison stalling behind a lost packet on the reliable lane, I had fixed
  by sizing their delay from their own lane; the fix-session lane moved them to the unreliable lane meanwhile, which is the
  better cure, so mine was dropped at the rebase. **Vehicles and the garrison in the browser** (`coop-motion-vehicles.mjs`,
  new), run on the tip with that change: 20 of 20 checks clean and under `lag:120,jitter:40,loss:0.05`; no copy darts, the
  vehicles never stall and a garrison man slows for at most 116 ms about once in 5 s on the bad link, all within 4 to 7 cm
  of the host's path 95% of the time, and at rest within 0.6 cm and 0.2 degrees of the host's. **Far
  enemies at 5 Hz** are about 150 ms staler than near ones (225 ms against 77 on a clean link) and 4 to 7 cm off at the 95th
  percentile, with no stalls or jumps; they are off the screen or over 70 m away at the default field of view. 10 Hz would
  cost 135 bytes a second per far enemy (0.8 KB/s in the fight measured, 6.5 at the most); `FAR_EVERY` is unchanged, the
  owner's call after he has played it. For him to know: a field of view above 90 shows far enemies in a strip at each edge
  of the screen (the cone is 60 degrees either side). Not measured: real WebRTC, more than one guest, human squads and
  bosses, a guest page that itself runs slowly, the far tier at 10 Hz, the helicopter on the buffer. Outside my files, one
  line: the kit's `deploy` works on a build from before the load barrier (the baseline). Landed at `d082879`; the table's
  runs were made before the wire pass landed, so one case was run again on the landed tip (48 enemies, the worst network)
  and agrees with its row.
5. **FIXED (verify-proofs). With kill prediction on, a guest's kill that is played whole ahead of the host (a one-shot
   headshot, any `sure: 'kill'`) was never scored, paid or counted on the guest's own screen, and had no kill sound.** Any
   mode, any network; found by `coop-gore-shots.mjs` case `headshotKill` on `e0334ec` ("the same shooter's sounds": the host
   hears `hit_marker_kill`, the guest does not; the guest's own `enemy:killed` count was 0) with this in the guest's console:
   `[coop] Dropped an event that could not be applied kill TypeError: Cannot read properties of undefined (reading 'height')
   at FrostNova.onKill`. Cause: two lanes met. For a foretold death the host's `kill` is told to the guest's game with a
   stand-in enemy (`hits.ts` `standIn`), a bare object of a dozen fields; the frost perk's kill listener
   (`progression/frost.ts` `onKill`) reads `enemy.frozen` and `enemy.char.rig.height`, threw, and the router dropped the whole
   event, so no later listener ran either. It passed before `f16721f` only because prediction was off by default. Fix: the
   stand-in is a whole enemy: it stands on the pooled object the body was (every field is there, whoever it is by now) with
   what the kill is about set over it as it stood at its death (id, definition, health, where, frozen, burning, the limbs
   off). Test: `world.test.ts`, "a whole death played ahead of the host" reads the enemy the kill is told about.
