# Mech parts: the Distraint Frame's first real catalogue

Status: **plan, approved by the owner (2026-11-22), to be built in one go by a lead agent and parallel lane agents.**
All parts are **free** for now (no shop prices; a shop comes later). Every number below is a starting point for balance,
chosen by the lead; the owner tunes after playing.

The loadout system already exists (`src/frame/loadout.ts`, the "Frame" screen in the main menu, the pause menu and
Procurement). Today it holds only the parts the game always had. This update fills it.

---

## 1. Read first (every agent)

1. `CLAUDE.md` (repo root): **every rule there applies.** The ones agents break most are repeated in section 7.
2. `docs/notes/frame.md`: how the Frame is built, the loadout, and "how to add a part".
3. The code you will touch, in this order:
   - `src/frame/loadout.ts`: parts, slots, stats, wire ids.
   - `src/frame/weapons.ts`: today's guns and clocks.
   - `src/frame/seat.ts`: controls; the header lists every key.
   - `src/frame/controller.ts`: the walker.
   - `src/frame/arms.ts`, `cockpit.ts`, `puppet.ts`: the models, first-person and as other players see it.
   - `src/frame/data.ts`: the numbers.
   - `src/frame/parts.ts`: hull, legs, canopy damage.
4. Systems to reuse, not rewrite:

   | What | Where |
   |---|---|
   | Painting marks and steering missiles | `src/weapons/swarm.ts` (the Quiver; also the pod) |
   | Aimbot lock rules | `src/weapons/smartaim.ts` |
   | Proximity fuze with a standoff | `src/weapons/flak.ts`, `src/progression/callins/ac130Rounds.ts` (`fuze`, `flakCone`) |
   | Charged beam that vaporizes | `src/weapons/lance.ts`, `Gore.vaporize` |
   | Steer a rocket to the crosshair | `src/weapons/laser.ts` (`ROCKET_LASER`) + `Projectiles.ts` `wired` |
   | Burning patches that set walkers on fire | `src/weapons/Flames.ts` (the Kiln's napalm patches); `src/gore/fire.ts` (the look) |
   | The three 40 mm rounds HE/AP/flak | `Round40`, `Magazine` in `src/progression/callins/ac130Guns.ts`; `ROUNDS` in `src/frame/weapons.ts` |
   | Heat (spin, overheat, vent) | `Heat` in `src/vehicles/emplacement.ts` |
   | Three thick barrels in a rounded triangle | the Trommel's 12 mm rechamber (`trommel12`), `src/weapons/viewmodels/models/trommel.ts` from line ~184 |
   | Big explosions, shock, screen effects | `src/progression/callins/nuke.ts` (the shock front), `src/fx/recipes/`, `Combat.explode` |
   | Seeing enemies through walls | the Thermal / Sonar brain chips, `src/contracts/chips.ts` |

## 2. The parts

Part ids are **appended** to `FRAME_PART_ORDER` in exactly this order. The order is the co-op wire format, so never
insert, reorder or remove. Arm weapons get a left and a right id like today's (`xxxL`, `xxxR`).

In-game names below are working names in the game's voice. **Do not use names from other games or brands:** no "Spartan",
"kamehameha", "MOAB", "SPAS", "Javelin", "Armored Core". The owner used those words only to describe the feel.

### 2.1 Arm weapons (either side; left arm on LMB, right arm on RMB)

| Id | Name | What it does | Starting numbers |
|---|---|---|---|
| `vulcan30L/R` | **30 mm Rotary Cannon** | The 40 mm cannon's explosive shells from a rotary gun, very fast. Same three rounds, cycled with R, the same key as the 40 mm (HE, AP, flak), each a smaller cousin of the 40 mm's. | 3 barrels; spin-up 0.35 s; 14 rounds/s; Heat: overheats after ~5 s of fire, 2.5 s vent. Per shell: HE 60% of the 40 mm's blast radius and 45% of its damage; AP goes through 1 body; flak bursts like the 40 mm flak but with 60% of the pellets. |
| `beamL/R` | **Red Beam** (working name; owner's "red charged mega-laser") | Hold to charge, release to fire a thick red beam for a full second. It vaporizes whatever it touches and sets fire to what survives at the edge. Same family as the Lance's full charge, but much bigger and red. | Charge 1.6 s, with a visible red glow building at the muzzle, a hum, and the mech's walk slowed to 60%. Release early: nothing fires and half the charge is kept for 2 s. Beam 1.0 s, 1.4 m thick, 180 m, through up to 3 walls. Vaporizes everything (bosses take 900 a hit, via `bossHit`). 9 s cooldown. |
| `clusterL/R` | **Bomblet Cannon** | A heavy single-shot shell with a standoff fuze like the flak shell. Instead of shrapnel, it throws a fan of bomblets ahead that carpet the surface in front of it: a sheet of small blasts over a whole area. Crowd control. | 1 shell, reload 3.6 s. Fuze: bursts 7 m short of the first body or surface on its line. 28 bomblets land over a ~14 m × 9 m patch ahead and go off in a ripple over 0.7 s: each 2.4 m radius, 70 damage, strong ragdoll push. Bomblets bounce once off walls. |
| `shotgunL/R` | **Mech Shotgun** | A mech-sized semi-auto combat shotgun (the owner's reference look: a SPAS-12-style pump-and-semi combat shotgun, big tube magazine, ventilated heat shield, folding stock stub). A wall of heavy pellets. | 6-shell tube; semi-auto, 0.42 s between shots; 26 heavy pellets per shell. **It keeps pellet spread** (CLAUDE.md: shotguns always keep spread), a cone of about 5.5°. 85 damage a pellet up close, falling off after 25 m. Huge push: bodies fly. Reload is shell by shell, 0.45 s each, and firing interrupts it. |

### 2.2 Shoulder weapons (how many fit is set by the cockpit)

| Id | Name | What it does | Starting numbers |
|---|---|---|---|
| `stormPod` | **Metal Storm Pod** (the game already has a Metal Storm hand gun; same family) | **Lock and charge:** hold the shoulder key with the crosshair on an enemy; it locks, charges, then dumps a wall of bullets into him. **Multi-paint sweep:** keep holding and sweep the crosshair over more enemies to paint them (up to 8). On release the pod fires one long burst that snaps from target to target like an aimbot, shredding each painted enemy in the order painted. | Lock 0.5 s per target (painting uses `Painter`), charge 0.7 s after the first lock (a rising whine, barrels glowing). The burst: 0.25 s of fire on each target, 120 rounds each, 30 damage a round. 7.5 s reload. It needs line of sight at the moment it fires; any painted target out of sight is skipped. |
| `mirv` | **MIRV Launcher** | Hold the shoulder key: a marker shows where you are aiming on the ground. Release: the missile launches straight up, climbs high, then dives at the marker in a top-attack arc. About 25 m above the ground it splits into homing missiles, which pick out every enemy under it. | Climb to 70 m, dive. Split at 25 m: 8 sub-missiles; each takes a different enemy within 22 m of the marker (two per enemy if fewer than 8 enemies). With no enemies they land in a ring around the marker. Each sub-missile: 5 m blast, 220 damage. Reload 11 s. Marker range 200 m. |
| `wireBomb` | **Guided Heavy Missile** ("fly-by-wire"; working name) | One fat, slow missile that follows your crosshair the whole flight, steered like the Rocket's laser (`laser.ts`). When it hits: the biggest non-nuke explosion in the game, with a **new, unique explosion effect** (section 3). | 16 m/s, turns hard enough to round a corner. The mech can still walk while you steer. **Kill radius 26 m, shockwave 70 m**: it knocks down and ragdolls everything, flattens breakables, and throws bodies and gibs hard. Reload 28 s. The Frame takes damage inside 26 m, like other explosives. Co-op follows the howitzer's rule for teammates. |
| `mortarRack` | **Mortar Rack** | An indirect-fire mortar battery. Hold the shoulder key to show a landing circle (high arc over cover); release fires. A key cycles its **three rounds**: (1) **HE**; (2) **White Phosphorus**: lands and leaves a burning patch for a long time, and anything that walks through it catches fire (area denial; zombies keep coming while they burn, human morale breaks faster under fire, as the gore update made fire work); (3) **Cluster**: bursts high over the circle and showers bomblets, the same bomblet carpet as the Bomblet Cannon but bigger and from above. | 6 rounds in the rack, 0.5 s apart while held, reload 6.5 s. Range 25–180 m. HE: 6 m blast, 260 damage. WP: 9 m patch burning 14 s plus a white smoke plume; use the Kiln's patches (`Flames.ts`), white-hot. Cluster: 32 bomblets over an 18 m circle. Flight time scales with range: about 2.5 s at 100 m. |
| `fpvHive` | **FPV Drone Hive** | Releases kamikaze drones. They fly out, find enemies on their own, pick different targets, dive in and explode. | Press: launch 4 drones, 0.15 s apart. Hold: drones prefer enemies nearest the crosshair. Each drone flies 28 m/s and searches 60 m; each takes a different enemy, does a 4 m blast for 200 damage, and can be shot down (20 HP). The hive rebuilds one drone every 4 s, 4 at most. Whining propeller sound, small and fast. |
| `pointDefence` | **Point Defence** | An active protection turret (like a tank's hard-kill system). It shoots down incoming rockets, grenades and mortar shells by itself, and clips infantry who get too close. No key: always on. | Engages projectiles aimed at or landing within 15 m of the Frame. 6 charges, one intercept every 0.6 s, a charge back every 3 s. A short tracer burst and a puff where it kills the shot. Infantry within 6 m take 12 damage, 3 times a second. Shown as a small dome turret with a radar panel. |
| `flareRack` | **Countermeasure Rack** | A heavier version of the smoke and flares every Frame already has on Q (`FRAME.smoke`). **Q stays on every Frame**, so the default build is unchanged; this rack doubles it, and pops flares by itself when a missile locks on. The choice the owner wants: a second weapon, or defence. | Q charges 6 instead of 3; refill 7 s instead of 14. A 50% wider and longer smoke wall. Auto flares: when an enemy missile is fired at the Frame, the rack pops flares (no charge spent) once every 5 s. |

The existing **Six-tube Missile Pod** (`pod6`) stays as it is.

### 2.3 Legs (how it walks; `LegStats` in `loadout.ts`)

| Id | Name | What it does | Starting numbers (× the Standard Legs') |
|---|---|---|---|
| `legsSprinter` | **Sprinter Legs** | Light reverse-jointed legs: fast, jumps very high. | Walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7. |
| `legsHeavy` | **Pile-Driver Legs** | Heavy, slow legs with a devastating stomp. Nothing knocks it back. | Walk ×0.75, jet launch ×0.5, stomp ring ×1.5 with damage and push ×2.2, leg armour ×1.6, immune to knockback. |
| `legsTreads` | **Treads** | A tank base. No hop (the jets lift only with a flying engine), quick on the flat, crushes what it drives over, shoots steady on the move. | Top speed ×1.25 on flat ground, ×0.6 up slopes and over rubble. Turns at ×0.5 (the hull turns slowly; the top still aims freely). No stomp: drives over enemies for 300 damage. No aim sway from moving. Hull armour ×1.2. |
| `legsSpider` | **Spider Legs** | Four legs: climbs steep slopes and ledges, strafes fast, a steady gun platform. | Walk ×1.0, strafe ×1.4, climbs 45° slopes and 2.2 m ledges, no recoil kick on the view (the howitzer and Red Beam fire steady). No stomp: a leg sweep instead, a 360° 5 m knockdown. |

### 2.4 Cockpits (how many shoulder slots; `CockpitStats`)

`MAX_SHOULDERS` goes from 2 to **3**. Phase 0 changes the wire for that (see section 4).

| Id | Name | Shoulder slots | What it does / the catch |
|---|---|---|---|
| `cockpitTwin` | **Twin-Mount Cockpit** | 2 | Two shoulder weapons. Thinner canopy: it cracks at 0.7× of today's damage. |
| `cockpitOpen` | **Open Frame** | 3 | Three shoulder weapons, and no canopy at all. The pilot is exposed: a hit on the seat area hurts the player directly, as on foot. Hull ×0.9. |
| `cockpitSensor` | **Sensor Cockpit** | 1 | Shows every enemy within 70 m through walls, with the Thermal brain chip's outline. In co-op, teammates see your marks too. Hull ×0.9. |

### 2.5 Engines (how it travels; `EngineStats`)

The standard engine: 7 m/s walk, a hop of 7 m with up to 1.5 s of hover, 2.3 s of fuel, and a charge (Shift) at 18 m/s for 0.75 s with 2 charges refilling in 3.5 s.

| Id | Name | Drive | What it does | Starting numbers |
|---|---|---|---|---|
| `engineJet` | **Jump-Jet Engine** | `flight` | True flight in bursts. Higher base speed. Shift is a jet blast. It runs out of fuel fast. | Walk ×1.2. Holding Space climbs freely with no ceiling but the map's. Air speed 14 m/s. Shift: jet blast at 32 m/s for 0.6 s, any direction including up. Fuel 4 s; a blast costs 1 s; refill starts 1.2 s after the last use, full in 3 s. |
| `engineRotor` | **Rotor Engine** | `hover` | A helicopter: hover as long as you like, strafe in the air, slow. | Walk ×0.9. Holding Space climbs to at most 14 m over the ground and stays up with no fuel cost. Air speed 9 m/s, strafing included. No charge. The hull takes ×1.25 damage while airborne (an easy target up there). |
| `engineAfterburner` | **Afterburner** | `flight` (jet mode) | Fighter-jet style: Shift in the air folds the legs and goes into jet mode, very fast forward flight with the arms firing straight ahead. It can't hover. | Walk ×1.0, normal hop. Jet mode: 48 m/s forward, turns at most 70°/s, climbs and dives with the mouse; 7 s of fuel; arms locked forward; stomp from jet mode = a dive bomb with ×1.5 stomp. Leaves jet mode when you release Shift or the fuel runs out, and drops to a hover-fall. |
| `engineOvercharge` | **Overcharge Engine** | `jets` | The fast ground build: very quick on its feet, more and faster charges, a weak hop. | Walk ×1.45. Charge 26 m/s for 0.7 s, 3 charges, each back in 2.5 s. Jet fuel ×0.5, so it barely hops. |
| `engineDiesel` | **Long-Haul Engine** | `jets` | The tank engine: not fast, but it never runs out. Shift is a long, steady run instead of a burst. | Walk ×0.95. Hold Shift: 11 m/s for up to 12 s, and it tramples small enemies on the way. The run refills fully in 4 s. Normal hop, fuel ×1.3. |

The standard legs, cockpit and engine stay as they are. **The default loadout must still build exactly today's Frame.**

## 3. The new explosion (for the Guided Heavy Missile)

The owner wants a **unique, massive** explosion: "a massive shockwave that's insanely powerful". It must read as bigger
than the howitzer and different from the nuke. The nuke is a whole-map white-out with a mushroom; this one is a local
blast you watch from 60–150 m. In order:

1. A flash, with no white-out: one frame of bloom and a hard point light that lights the whole area.
2. **A visible pressure wave**: a sharp-edged spherical shock (a condensation dome) that expands fast to 70 m. It is drawn as
   a thin bright shell with screen-space distortion behind it. Dust and debris lift off the ground as its edge passes,
   so the ring is seen racing outward along the floor.
3. A ground-hugging dust and debris ring rolling outward after the shock.
4. A short, fat fireball column that rises and collapses into a dirty dark cloud. No stem, no mushroom: that is the nuke's.
5. Timed to the wave's arrival, not the blast: the shake and a ragdoll push on every body by its distance. Bodies in the
   kill radius are thrown (or vaporized at the core), glass and breakables shatter in a ring, and lights flicker.
6. Sound: a deep delayed boom (sound arrives later at distance), then debris rain. Use existing catalog sounds where they
   fit; the owner says gore and explosion sounds are fine for now. Any new sound id goes in `src/audio/catalog.ts` and
   `docs/notes/audio.md`.

It must be cheap enough for co-op and the owner's Mac: pooled, capped, no allocation per frame. Expose it as one call
(`megaBlast(at, scale)`, or whatever phase 0 names it) so other weapons can use it later. Make a motion contact sheet
(`tools/sheet.mjs`) and a video, and look at them.

## 4. How the work is split

### Phase 0: the frame for everything (ONE agent, serial, before anything else)

Today all guns live in one 1,150-line `src/frame/weapons.ts`, the walker in one `controller.ts`, and the models in
`cockpit.ts`. Ten agents editing those at once would wreck each other. Phase 0 makes a place for each part, so lane agents
only add new files.

1. **Part registry.**
   - Append every id from section 2 to `FRAME_PART_ORDER` with its slot, name, `does`, `lore` and stats.
   - New parts with no behaviour yet build as a **placeholder** that works: an arm placeholder fires the 40 mm's HE, a
     shoulder placeholder does nothing and says "not fitted", and legs and engines use the standard numbers.
   - Raise `MAX_SHOULDERS` to 3 and keep the co-op `kitIds` correct (a test that old loadouts and old wire lists still decode).
2. **Arm weapon interface.**
   - Move each existing arm gun into its own file `src/frame/arms/<kind>.ts` behind one `FrameArmGun` interface (fire,
     hold, release, reload, HUD row, the remote note that draws its shots on other screens), and make `ArmMount` use a registry.
   - Same for arm **models**: `src/frame/models/<kind>.ts` (move `ROTARY_ARM`, `CANNON_ARM`, `HOWITZER_ARM` out of `cockpit.ts`).
   - **Behaviour must not change:** run the existing frame tests and `tools/solo-parity.mjs` for the mech scenarios.
3. **Shoulder weapon interface.**
   - Same pattern, in `src/frame/shoulders/<kind>.ts` and `src/frame/models/shoulder-<kind>.ts`.
   - Move the six-tube pod into it; up to 3 mounts on the hull (left, right, top), and the model knows where each sits.
4. **Movement hooks.**
   - Split the walker so the legs' gait and the engine's drive are plug-ins: `src/frame/move/gait/<gait>.ts` and
     `src/frame/move/drive/<drive>.ts`, with the standard walker and jets as the first ones.
   - `frameStats` already carries the numbers; wire `stomp` and `dash`, which are not read today.
5. **Keys.**
   - Pick free keys for shoulder 2 and 3 and for "cycle this shoulder's round" (the mortar). Today: G is the pod, Q smoke,
     F melee, E exit, R the cannon's round, hold 1 the rotary's round, Space jets, crouch stomp, Shift charge.
   - Write the table into `seat.ts`'s header and `docs/notes/frame.md`, and show the keys on the loadout screen.
6. **Co-op plumbing.**
   - Every new weapon's shots must be drawn on teammates' screens (CLAUDE.md, "Weapons on other screens"). Add the note
     kinds now (one per weapon, as `FireNote` kinds or the frame's own lane), so lane agents only fill the drawing.
   - Movement modes (flying, jet mode, treads) must show on the puppet (`puppet.ts`): add the pose fields to the wire now.
7. **Explosion entry point.** The stub `megaBlast(at, scale)` that does a plain big `Combat.explode` for now.
8. **Bomblet carpet entry point.** Stub `bombletCarpet(origin, dir, spec)`, used by both the Bomblet Cannon and the mortar's cluster round.
9. Land it on the integration branch (section 6), with tests and the whole suite passing. **Every lane starts from this commit.**

### Phase 1: parallel lanes (each in its own worktree, each owning only its own files)

| Lane | Builds | Owns (new files unless said) | Notes |
|---|---|---|---|
| **A** | 30 mm Rotary Cannon | `frame/arms/vulcan30.ts`, `frame/models/vulcan30.ts`, its tests | Model: three thick barrels in a rounded triangle after the Trommel's `trommel12`, scaled to the mech arm, with a fat shell feed. Reuse `Round40` shells at the smaller numbers. |
| **B** | Red Beam | `frame/arms/beam.ts`, `frame/models/beam.ts`, a red beam fx in `src/fx/recipes/` (new file) | Reuse the Lance's charge rules and beam vaporize path; red, thicker, with a building glow. Visual: a heavy emitter with cooling fins and an inset red line, not a toy. |
| **C** | Bomblet Cannon + Mortar Rack (3 rounds) | `frame/arms/cluster.ts`, `frame/shoulders/mortar.ts`, their models, the real `bombletCarpet` | Both share the bomblet carpet, so one lane. WP uses the Kiln's burning patches, white-hot, with a white plume. |
| **D** | Mech Shotgun | `frame/arms/shotgun.ts`, `frame/models/shotgun.ts` | Pellets through `Combat.fireRay` like any shotgun, so co-op claims work. **Keep spread.** |
| **E** | Metal Storm Pod | `frame/shoulders/storm.ts`, its model | `Painter` (swarm.ts) for paint, `smartaim.ts` rules for the snapping sweep. Many rounds: pool tracers, cap draws. |
| **F** | MIRV + Guided Heavy Missile | `frame/shoulders/mirv.ts`, `frame/shoulders/wire.ts`, their models | Missiles through `Combat.spawnProjectile`. MIRV top-attack arc then split; wire missile steers to the crosshair. Calls `megaBlast`. |
| **G** | The new explosion | the real `megaBlast`, new files in `src/fx/recipes/` and shaders | Section 3. A look lane: contact sheets and video at dpr 2, 1440×900. |
| **H** | FPV Drone Hive + Point Defence + Countermeasure Rack | `frame/shoulders/fpv.ts`, `pointdef.ts`, `flares.ts`, their models | Drones are small and pooled (cap 4 per mech, 16 in co-op). Point Defence needs a hook to see enemy projectiles in `Projectiles.ts` (one small hook, coordinate with phase 0). |
| **I** | 4 legs | `frame/move/gait/*.ts`, `frame/models/legs-*.ts` | Treads and spider are new movement, not stat tweaks. Treads crush; spider climbs. The leg models replace the standard legs on the hull and on the puppet. |
| **J** | 5 engines | `frame/move/drive/*.ts`, engine visuals (exhausts, rotors, wings folding in jet mode) | Flight, hover, jet mode, overcharge, long-haul. The camera must stay readable in jet mode at 48 m/s. |
| **K** | 3 cockpits + the loadout screen | `frame/models/cockpit-*.ts`, Sensor outlines, the Open Frame's exposed seat, the loadout screen | Add a **3D preview of the whole mech** to the loadout screen (missing today), turning slowly, built from the loadout. Show every part's numbers. |

Lanes must not edit another lane's files. If you need something from a shared file (`loadout.ts`, `seat.ts`, `weapons.ts`,
`controller.ts`, `puppet.ts`, `Projectiles.ts`), ask the lead; the lead makes small shared edits one at a time and tells the
lanes to rebase.

### Phase 2: fit and verify (lead plus one checking agent)

- Land all lanes, then play every part on every slot in the Test Range (`/?map=range`) and in Crucible.
- Fight with these builds, and leave each one's contact sheet:

  | Build | Legs | Engine | Cockpit | Shoulders | Arms |
  |---|---|---|---|---|---|
  | **Artillery tank** | Treads | Long-Haul | Open Frame | Mortar Rack, MIRV, Point Defence | 105 mm, Bomblet Cannon |
  | **Gunship** | Standard | Rotor | Twin-Mount | FPV Drone Hive, Metal Storm Pod | 30 mm Rotary Cannon on both arms |
  | **Fighter jet** | Sprinter | Afterburner | Standard | Guided Heavy Missile | Red Beam, 30 mm |
  | **Brawler** | Pile-Driver | Overcharge | Twin-Mount | Countermeasure Rack, Point Defence | Mech Shotgun on both arms |
  | **Climber** | Spider | Jump-Jet | Sensor | Six-tube Missile Pod | 105 mm, Red Beam |

- Co-op: run `node tools/scripts/coop-all.mjs` with the frame lanes; add a proof that a guest's custom mech, its shots and its
  flight are seen by the host and the other way round.
- `node tools/solo-parity.mjs`: the **default** Frame and everything outside the Frame must be unchanged.
- Performance: the heap fight plus the Guided Heavy Missile plus 16 drones must stay within today's frame budget on the
  "half-speed CPU" estimate (`docs/notes/gore.md` has the method).

## 5. What "done" means for each part

1. It is in the loadout screen with its name, plain "does" text and a lore line in the Office's voice.
2. It works in the Test Range, in a mission's mech, and in Crucible, with HUD rows (ammo, heat, charge, fuel) that make sense.
3. It has **its own model** (quality bar below), first-person where the pilot sees it and on the mech as others see it.
4. Other co-op players see it, its shots and its effects.
5. A Vitest test next to the code (its clock or rules, pure), and the whole suite still passes.
6. A dpr 2, 1440×900 screenshot, plus a contact sheet if it moves, in `tools/out/mech-parts/<lane>/`, and the agent has looked at them.
7. `docs/notes/frame.md` updated with the part, its numbers and its keys.

**Model quality bar** (CLAUDE.md): real form, never boxes. Use bevelled 2D profiles (the house mesher, or `THREE.Shape` +
`ExtrudeGeometry` with bevel), chamfers, cut-outs, and 2–3 contrasting materials, with glow only as thin inset lines.
No logos. Cold blue world; warm colour only for what the player does (the Red Beam is allowed to be red). Match the
Frame's existing metal and paint.

## 6. Git and landing

- **Integration branch:** `mech-parts`, cut from local `dev`. Phase 0 lands there first.
- Each lane: its own worktree on branch `mech-parts-<lane letter>`, from the phase 0 commit.
- Land a lane in four steps:
  1. Rebase on the current `mech-parts`.
  2. `npx tsc --noEmit` and the whole suite.
  3. Fast-forward only: `git push . HEAD:refs/heads/mech-parts`.
  4. If it fails because a peer moved the branch, rebase and repeat.
- **Never** `git add -A`, `git add .` or `git commit -a`. Stage your own files by name.
- Never push to `origin`, and never touch `dev`. The owner merges and says "push" himself.
- Commit messages: one plain sentence, then the trailer naming the model that did the work.

## 7. Machine rules (the dev machine is shared; break these and the owner's dad shuts it down)

- **Node 22 via nvm:** start every shell with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null`, then `npm ci` in your worktree.
- **Port 5173 is the owner's.** Never start, stop or reload it. Each lane gets its own Vite port (A 5301, B 5302 … K 5311,
  phase 0 and lead 5300, checker 5312), run as `OP2_NO_HMR=1 npx vite --port <p> --strictPort`.
- **Restart your Vite after editing `src`, before any browser check**, because file watching is exhausted on this machine
  and Vite serves stale code otherwise.
- **Stopping processes:** kill only what you started, by the pid listening on your port (`ss -ltnp`). Never `pkill -f` (it kills your own shell).
- **Browser runs:** go through `tools/shot.mjs`, which queues on the machine-wide slots. Don't start one if free memory is under 10 GB.
  At most **10 lane agents at once**. Close browsers and Vite when done.
- **Chromium:** Playwright `channel: 'chromium'` only, never the owner's Chrome.
- **The test suite has 6 known failures today**, not yours: the audio catalogue, the heavy table (2), the ADS list, aim-spoil
  timing, and credit rules for Mission 4. Don't fix them in a lane, and don't count them against a lane.
- **Game facts:** bullets have no spread, shotguns keep spread, and there is no sprint for the player (Shift = dash; the
  mech's Shift is its charge). Write "brain chip", never "chip". Original content only.

## 8. Report to the owner at the end (plain words, short)

- The commit hash of `mech-parts`.
- Every part: done, or what is missing, with its numbers.
- The five builds' contact sheets and the explosion video, by path.
- Test counts; co-op proof results; the parity result for the default Frame; frame time for the stress fight.
- What wasn't checked, and the balance calls made, so he knows what to tune.

## 9. Parked (proposed, not chosen yet)

Arm ideas the owner didn't pick this round: Breaching Fist (melee punch arm), Incinerator (flamethrower arm), Riot Plate
(shield arm), Arc Projector (chain lightning), Harpoon (reel enemies in or pull the mech up), Coil Rifle (piercing charged slug).
A shop for parts (prices, unlocks by round) comes after the owner has played this.
