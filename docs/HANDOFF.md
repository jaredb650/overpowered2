# Handoff: where things stand (2026-11-19)

Written when development moved from the owner's 8 GB M1 Mac to a remote machine. Rules and how to work: `CLAUDE.md` at the repo root.
Update this file when the state below changes.

## Live vs local

- **Public site** (https://jaredb650.github.io/overpowered2/): `origin/dev` at **`5cadcb2`** (2026-11-21): the finished co-op
  overhaul (on the site since `d2e2f8a`, 2026-11-19) and the gore update on top of it, pushed on the owner's "push" after tsc,
  build, the whole suite (3,114 passed) and the `dist/` audit in a clean worktree. Nobody has played either yet.
  What co-op is now, what is proven and what is not: `docs/notes/coop.md` ("What is proven") and `docs/notes/coop-overhaul.md`.
- **The gore update (damage response update), live since `5cadcb2`**; the branch `gore-update` is the same commit and can be
  deleted. Every hit shows and the struck part swings, gibs add up to the
  body destroyed, free guts and organs that burst, fire that chars and eats skin, bodies and blood that stay and heap (a "Mess"
  setting), a redrawn decal sheet with big stains, readable limb wear, blood on the weapon. Rules, switches and log:
  `docs/notes/gore-update.md`; what it costs and what is proven: `docs/notes/gore.md`; the owner's pictures and videos:
  `tools/out/gore-update/LOOK.md` on the dev machine (not in git). Open for the owner: "a hit spoils his aim" has almost no
  effect as tuned (0.35 s against a 0.8 s burst gap); the one-step physics change is off by default (`?onestep=1`); a tie-break
  fix in `src/player/collide.ts` (the Office start no longer hangs in the desk); GPU memory is up about 150 MB.
- **Local on `dev`, NOT pushed:** Campaign Mission 2 (**Foreclosure**, `/?contract=foreclosure`) is now complete nose-to-tail
  across all 16 sections (Stages 4, 5, 8, 10, 11): upgraded Distraint Frame (bevelled hull/cockpit, 3-stage canopy cracks,
  locational `FrameParts` + HUD diagram, destructible stalls, wreck tossing, vehicle stagger, `kneel`/`board`/`eject`, leg
  sappers, anti-air top-attack lock/smoke, standing dread), breakable 4-gun `FlakTower`, 3-phase 30 m `OldMother` salt crawler
  boss fight with walkable Rapier stern deck & Stern Engine, `Foreclosure` mission director (Slip wreck + door gun + Bureau
  T&C boot HUD, red-goggles wanted posters, Boss Integrity HUD, Harbourmaster PA squelch and cuff/kill finale). Verified with
  `tsc`, production build, full Vitest suite (3,125 passed, 0 failed), and two live Playwright visual passes (1440×900 @ 2×).
  Details: `docs/campaign/FORECLOSURE.md` and `docs/notes/frame.md`.
- **Only on the owner's Mac, not in any clone:**
  - Uncommitted leftovers (19 lines, owner hasn't decided): `docs/notes/viewmodels.md` (a rewritten Ultramag description and an
    exposed-action reload write-up), `docs/notes/weapons.md` (Harrow 50/100 → 60/120 in the text), `src/core/gameplay.ts` and
    `src/weapons/mods.ts` (ModId lines reordered), `src/weapons/Weapons.ts` (an import moved). Never stage these on that machine.
  - An old stash, `stash@{0}` on `48260a8` (Foreclosure stage 9 era): small edits to `src/core/contracts.ts`,
    `src/player/CameraRig.ts`, `src/weapons/viewmodels/rig.ts` (8 lines). Unknown purpose; leave it unless the owner asks.
  - The commercial placeholder music (`public/audio/music/`) and the ElevenLabs key (kept outside the repo). Neither ever goes in git.

## Built recently (all live at `da2ff4c`)

- Co-op: lobby/join fixes, invite link straight to the password, ready-up, Force start, SMG default; error reports (human-readable
  errors, chunk-load retry); one game tab per browser; shared sonar in co-op (thermal stays personal); bosses take a guest's
  instakill as the same 900 hit a host gets.
- Settings and UX: cheats password, sensitivity up to 10, "Press [Q] to heal", hold rings for capture and revive, ADS focus zoom
  (Shift while aiming, 3.5 s cap + cooldown).
- Economy: supply pods sell ammo/heal/armour; Endless Humans economy (poor early, buy anything late; capture pays ~300); sell
  weapons; drop weapon (U).
- Weapons and mods: shotguns +10–15% and a new double-barrel sound (staggered double play); Ultramag earlier unlock, compensator,
  laser locked to the crosshair; weapon light mod; SMG kit (starts with a light, 50-round "Mag Tape", stock lengthens focus); akimbo
  mod (SMG + pistols; Autoraffica akimbo keeps dual smart mode with two crosshairs); flechette ammo for all shotguns; Harrow API;
  Raufoss visuals; autocannon flak airburst; Lance beam ("Kamehameha"); HMG red dot/ACOG; Awl extended barrel + greased bolt;
  energy-blade katana; **Flail** LMG (100/200 box, red dot/ACOG, API).
- Brain chip **Gun Kata** (hold to charge, targets glow red). Implant **Jump Jet**.
- Enemies: flee rework (cornered enemies surrender, fight, fake-surrender with a grenade, cower, taunt, rarely suicide; nobody despawns).
- **Retraining** tutorial (~10 min): first launch goes into it, except `?join=` invite links; the "EXIT · VOLUNTARY" door is the
  skip; finale is a town of prisoners and a nuke. Everyone else reaches it from Play > Training. Design: `docs/design/tutorial.md`.

## Pending work and open owner questions

### 1. Co-op fix plan — waiting for "go"
Owner, after a playtest: "don't fix now, just note." Read `docs/notes/coop-audit.md` (section E is the fix list) and
`docs/research/coop-netcode.md` (sections 5–6). The owner's reports and causes:
- Guest gets kicked while the host loads first: no load barrier; the guest's 20 s / 30 s timers (`SILENCE_MS`, `HOST_WAIT_MS` in
  `src/net/lobby.ts`) trip.
- Guest gore stripped and laggy: fixed 0.6 severity, one round trip late, no interpolation buffer, enemy fire FX missing.
- Third-person weapon FX missing: the Lance beam is invisible to others; every gun shows one generic tracer.
- Dropped weapons not seen by the guest: not reproduced; likely events dropped while loading.
- Only the host sees the supply pod in Endless Humans: confirmed race at `src/progression/pickups/pods.ts:201` (the guest replays
  "wave cleared" before the break phase, so its pod retires at once).

Batches:
- **Batch 1** (~4–5 agent-days): load barrier (host waits in an empty map, "Waiting for X", real errors), pod race fix, full guest
  gore (real severity + seed + shooter distance, instant predicted blood puff), per-weapon third-person FX (Lance first), resend
  drops to late joiners, fix `tools/scripts/coop-kit.mjs` `startPair`.
- **Batch 2:** 150 ms snapshot interpolation buffer, steady send clock, unreliable channel, compact encoding, host per-frame waste.
- **Batch 3:** enemy attack visuals for guests, call-ins and the mech visible to all, shared destructibles, KF-style co-op slow-mo.
- **Open questions:** start batch 1? Want the instant blood puff on your own hits? OK that corpses land slightly differently on each screen?

### 2. Gore and ragdolls — waiting for the owner
`docs/proposals/gore-ragdoll-proposals.md`. Recommended first batch: pre-warm the first gib (42–72 ms stall today); measure the
ragdoll budget on the M1 and try SIMD Rapier (`@dimforge/rapier3d-simd-compat` 0.21.0 exists; API match unverified); sword cuts
near a joint use the sever path (limp halves; today waist-cut legs stay standing); corpses sink only out of view; loose limbs can
be cut again. **Taste questions open:** sword cut style, hit-stop on severs/gibs, red flash on big kills, corpse count / clear at
wave break, wall pins for heavy rounds, throwable heads, more gore.

### 3. Offered to the owner, no answer yet
- Polish the Flail's shop-studio stock and box.
- Weapon light lags one frame (the laser had the same bug and was fixed).
- Drop the Council box subtitle "Office of Societal Compliance" (`src/ui/commander/index.ts`).
- Energy-blade cut cleanup.
- Remove plain AP ammo from the Flail.
- FPS counter / frame limit setting (the main loop is uncapped `requestAnimationFrame`, `src/core/Game.ts` ~line 194; the menu
  renders every 2nd/4th frame).
- "Team Focus" = co-op slow-mo option A (`docs/research/coop-slowmo.md`): **decided and built on `coop-overhaul`** (one player
  slows everyone, with a notice; `docs/notes/coop.md`, "Time: the team's slow motion"). Not on `dev` until the owner merges.

### 4. Owner's own to-dos
- Deploy the Cloudflare Worker in `tools/turn-worker/` (TURN relay + error log in D1) and give its URL; until then
  `WORKER_URL` in `src/net/turn.ts` is empty (STUN only), and error reports have nowhere to go.
- Rotate the ElevenLabs key.

### 5. Weapon ideas backlog (stowed, not scheduled)
`docs/proposals/weapon-ideas-backlog.md`: riot shield pistol mod, microwave emitter (the owner's favourite), Stakegun hold-R ammo
cycling (tether bolt, sticky charge), shiv → throwing knives. Rejected: saw blades, arc gun.

## Known broken or unclear

- `tools/scripts/coop-kit.mjs` `startPair` fails on a fresh browser profile: first launch goes into Retraining. Fix is in co-op batch 1.
- The five co-op reports above (load kick, guest gore, third-person FX, guest drops, Endless Humans pod).
- Retraining: some drills were passed by the test bot cheating, so they're not proven by a real run; the energy-blade cut-in-half
  frames were unclear in 1 fps captures.
- Gore: waist-cut legs stay standing; first gib stalls 42–72 ms; dead bodies end in a few stock poses (knee fold; Brutes freeze knees-up); loose limbs
  can't be cut again (details in the gore audit).
- The gore audit's screenshots (`tools/out/gore-audit/`, cited in the gore docs) exist only on the owner's Mac, and its capture script was not kept.
