# Effects (`src/fx`)

`createFx(ctx)` from `src/fx/index.ts`. Everything visible that is not a mesh or a decal goes through it.

## How it works

**Particles live on the GPU.** Emission writes one spawn record into a ring buffer and uploads just that range. The vertex shader works out where the particle is from (record, time), so a particle costs CPU exactly once, when it is born. Slow-mo, hit-stop and pause come from `ctx.time.elapsed` with no extra code.

| Class | Draw calls | Cap | What it is |
|---|---|---|---|
| `chips` | 6, one per shape | 15,500 | Opaque faceted chips. Exact ballistics with up to 4 floor bounces |
| `blood` | 1 | 1,200 | Lit strands and mist. One record is a whole curved strand, not a droplet. See Blood below |
| `streaks` | 1 | 5,000 | Sparks, debris streaks, embers. Screen-aligned slivers along the velocity |
| `smoke` | 1 | 2,000 | Smoke, dust, mist, fire. Premultiplied, so fire and smoke share a draw call |
| `puffs` | 1 | 1,500 | The original's dotted trail: unrotated translucent cubes |

That is 25,200, inside the 30k budget. Each ring evicts oldest-out by overwriting. Idle rings hide their mesh, so an idle frame costs a few comparisons and zero draw calls. All layers together are at most 20 draw calls.

Short-lived shapes have their own small rings: `flashes`, `muzzle`, `muzzleView`, `trailRings`, `waves`, `shock`, `lines` (tracers and beams), `arcs`, `slashes`, `shimmer`, `lens`.

## What is kept from the first game, on purpose

- Spawn at full size and full colour. `core.birth` pre-rolls one frame, so frame one is an open burst and not a dot.
- Chips are opaque, leave by shrinking, and a burst's life is fixed, so it ends on one frame.
- 4-segment gems, unrotated cubes. Exact counts and colours per explosion, in the table at the top of `recipes/explosions.ts`.
- Colour is per particle. A fireball is three flat-coloured layers from one origin. The cel bands inside a lobe are spatial, not colour over life.
- Gravity -20, life ladder 0.07 / 0.25 / 1 / 1-2 s, wireframe shock sphere at about 75% of blast radius.
- Trail beats in `emitters.ts` run on `realDt`, so SLOWMO packs them 4x denser and rings coil.

## Things that differ, and why

- **HDR is mostly not on the chip body.** This is a deliberate step back from the brief's "HDR values above 1". Khronos Neutral mixes toward white as peak rises, and after sRGB a 10% mix turns red to salmon. So flat colours sit at 1.15 and land on screen as the original hex, and only the facet facing the eye rises, to about 1.4. At 1.95 big close chips went visibly salmon. Fire has a yellow-white core band, and flashes and cores go far higher. `palette.ts` explains this. Do not raise chip gains.
- **Chips draw in the transparent pass** (with depth writes), after the smoke and fog. Fire does not write depth, so this is what keeps chips visible on top of the fireball. They lose MSAA.
- **Velocity dome** rejects the corners of the original's box. With big Hellfire chips the raw box is a visible rectangle.
- **Blast warp** (`uEject`): chip flight time runs ahead for the first few frames, so chips leave the origin faster than they travel later. Closed-form, so bounces still work.
- **Numbers that moved from the spec.** Counts and colours of chips are exact. These are not: explosion chip speed is 1.3x, non-Hellfire explosion chips are 1.5x size. Both were tuned by eye against the renderer. Revert in the recipes if the owner prefers the exact originals. Blood no longer follows the spec at all, see below.
- **Smoke does not fade.** It erodes: a rising threshold eats the sprite from the outline inward, the same "exit by shrinking" as chips.
- **Fire is cel-painted.** Each lobe is a torn outline with flat bands stepping toward yellow at its core. It came out of the same rule as the chips, and it reads as hot at any distance without going soft.

## Blood (the owner's taste overrides the first game here)

Faceted chips stay for explosions and the 20 yellow headshot chips. Blood left that language: on the night map, a chunky opaque red chip at 1.08 reads as confetti and glows.

- **A record is a strand.** The vertex shader walks a ribbon back along the drop's own path, head at `age`, tail `trail` seconds behind, so one instance is a curved arc that gravity bends. The fragment shader rounds the head, tapers the tail and pinches it into beads. Detail comes from the shader and the stains, not from count.
- **Lit by the scene.** `layers/blood.ts` is a patched `MeshStandardMaterial`, so it gets the light volume, moon shadow, dynamic lights and fog. Red under this map's cyan light would be black, so strands and blood decals take their brightness from the light and keep their own hue (`uLift`, and `opTint` in `Decals.ts`). Blood still goes dark in the dark and lights up in a flash. Output is capped at 0.5 because the bloom's soft knee starts at 0.55.
- **Heavy, not floaty.** Linear drag, closed form, gravity -14. Fine strands stall and drop, fat drops carry. `bloodJet` is one push of the heart in a single call: pulses with later birth times, each weaker, then two fat drops. `intensity` is pressure, not count, because gore fires three `bloodJet(.., 2)` on every gib.
- **Tight, not a burst.** Speed varies along the axis, about 5:1 against sideways jitter. Every other strand breaks off as a stretched drop, or a burst reads as a fan of needles.
- **Landing is exact.** `BloodLayer.add` solves when a strand reaches the floor or the wall ahead (one `floorAt` and one `wallAlong` ray per burst) and `StainQueue` books a `decals.splat` for that moment, with the real velocity. What you see land is what leaves the mark. The head sticks and the rest of the strand runs into it.
- **Its own clock.** `core.bloodNow` is world time without hit-stop. See Measured.
- **Mist** is a mode of the same layer: a short puff of fine grain, thinning over 0.2-0.5 s, gone inside 0.7 m of the camera, and growing with distance so a hit still reads at 15 m where the strands fall under a pixel.
- **Decals.** `decals.splat(position, normal, size, velocity)` is added by module augmentation in `render/Decals.ts`. Length over width is one over the sine of the impact angle, capped at 4.5. The blot sits back, a tail draws out ahead and side spatter bends forward. All blood cells get a per-decal warp so the few atlas shapes never match, the regrade to deep red, and dry over about a minute. The old emissive floor is gone: blood must not glow.
- Gore's `meat`, `viscera`, `bone`, `skull` and `brain` are real bodies, so `gibBurst` and `headBurst` no longer throw FX giblets or chunks.

| Strands and puffs per effect | Before | After |
|---|---|---|
| `bloodHit` | 28 | 9 |
| `bloodJet` at intensity 1 | 35 | 13 |
| `bloodJet` at intensity 0.5 | 18 | 10 |
| `bloodMist` | 8 | 3 |
| `stumpSpray`, per beat | 10-20 | 3-5 |
| `stumpSpray`, dribble | 16 per second | 6 per second |
| `bloodTrail` | 2-3 every 0.03-0.09 s | 1 every 0.05-0.13 s |
| `headBurst`, blood only, plus 20 yellow chips | 58 | 19 |
| `gibBurst` | 197-201 | 23 |
| Full gib as gore fires it, with its three jets | 407-411 | 62 |
| `lensBlood` | 10-36 drops | 4-16 drops |

## API

The contract is in `src/core/contracts.ts`. Additions on top of the original interface:

```ts
fx.chips(pos, color, count, hellfire?)       // the original createExplosion
fx.beam(from, to, 'rail'|'lance'|'laser'|'sniper'|'heal', width?, seconds?)
fx.arc(from, to, color?, seconds?, width?)
fx.slash(center, normal, startDir, arc, radius, 'light'|'heavy'|'sweep'|'finisher')
fx.flame(pos, dir, intensity?)               // call every frame while firing
fx.frostShatter(pos, dir, scale?)
fx.embers(pos, count, spread?)
fx.dust(pos, normal, scale?)
fx.slam(pos, impact)
fx.dashStreaks(pos, dir)
fx.jumpPad(pos, normal, color?)
fx.pickupSparkle(pos, color?)
fx.spawnIn(pos, color?, height?)
fx.wallSparks(pos, normal, along)
fx.lensBlood(amount)                         // also fires itself on gibs and head bursts within 3 m
fx.heatShimmer(pos, radius, seconds)
fx.muzzleFlash(pos, dir, kind, view?)
```

Also added: `ExplosionKind 'finisher'`, `ExplosionOptions.normal`, `BeamKind`, `SlashKind`, `EmitterPreset` (adds `shellTrail`, `hellfireTrail`, `airstrikeTrail`, `burning`), and the `fx:casing` event.

`createFx` returns the concrete class, which also has `stats()` for the debug overlay. It scans the rings, so do not call it per frame in a hot path.

### Using it

```ts
ctx.fx.explosion(point, { radius: 8, kind: 'rocket', normal: hit.normal });
ctx.fx.impact(hit.point, hit.normal, hit.surface);     // adds the bullet decal itself
ctx.fx.tracer(muzzle, hit.point, 'bullet');
const trail = ctx.fx.attachEmitter(rocket, 'rocketTrail');
trail.stop();
```

- `ring(pos, dir, color, size)`: `size` is the final **diameter in meters**. Anything up to about 2 m is the original's shell pulse, an accelerating octagon that pops in 0.1 s. Bigger is a round shock front on a slower clock. `dir` need not be normalised.
- `muzzleFlash` works out by itself that a flash within 3 m of the camera belongs to the player's own gun, and redraws it in the view scene so the viewmodel cannot hide it.
- `stumpSpray` sprays along `offset` when one is given, otherwise along the target's local +Y.
- `fireTrail` on something barely moving burns like `burning`.
- An emitter stops itself when a parented target loses its parent.
- `fx.impact` adds a `bullet` decal. `fx.explosion` adds a `scorch` decal. Blood decals come from two places: `src/gore/blood.ts` for wounds and pools, and the stain queue here for drops FX can see land.
- `fx.smoke` is a cube dot up to 1.2 m, the original's look. Bigger sizes become a soft billow, because a translucent box several meters across looks wrong.
- `src/player/feedback.ts` calls `dust`, `dashStreaks` (with the eye position), `slam` and `wallSparks`. The jump-pad burst needs no call: FX listens for `world:pad`.
- `fx:casing` fires on each casing bounce. Its payload object is reused. There is no tinkle sample in `public/audio/sfx`, so audio has to pick something.

Camera shake and hit-stop are not done here. Callers own those. Explosions do fire `post.chromatic` and `post.radialBlur`, scaled by distance.

## Tuning

| Where | What |
|---|---|
| `palette.ts` | All colours and gains. `BLOOD` is albedo, `BLOOD_TONE` where a burst sits between venous and arterial |
| `recipes/blood.ts` | Strand counts, speed, width, trail, drag per effect. `emitters.ts` for stumps and trails |
| `layers/blood.ts` | `uLift` (how bright blood reads), `uMinPx` (thinnest strand before it pales), the 0.5 cap |
| `stains.ts` `STAIN_SCALE` | Stain size against strand width |
| `recipes/explosions.ts` `RECIPES` | Counts, reach, shock, smoke, light per kind |
| `recipes/impacts.ts` `SURFACES` | Per-surface chips, dust, sparks, pop |
| `recipes/muzzle.ts` `MUZZLES`, `TRACERS` | Star shape, size, life, light. Tracer width, speed, length. `carbine`, `pistol` and `sabot` are the Harrow, Rivet and Sabot's own (`docs/notes/weapons.md`), and `quiver` one tube of the Quiver lighting, smaller than the rocket's and over in 40 ms so four in 0.3 s read as four (the Thresher uses `shotgun`): the sabot tracer is 0.11 m wide at 1400 m/s, so the pieces of it either side of a wall are on screen together |
| `recipes/misc.ts` `BEAMS`, `SLASHES` | Beam and slash looks |
| `layers/chips.ts` | `uGlint`, `uGlintGain` (hot facet), `uFacet` (per-facet shading), `uEject` (blast warp), `uMinPx` (pixel floor at range) |
| `layers/chips.ts` `CAPS` and the other constructors | Budget. Keep the sum at or under 30k |
| `layers/shared.ts` | Fog on FX: `uFogDensity`, `uFogAmount`, `uFogColor` |

## Testing

`tools/scripts/blood-shots.mjs` writes frame sequences of blood from the real game on a fixed 1/60 clock, one contact sheet per spot and distance, with `wall` and `floor` rows for stains. `tools/scripts/blood-bench.mjs` records a per-frame timeline around each event, with GPU sync, ablations, CPU profile and trace modes. Both headers have the commands.

`/?sandbox=fx&effect=<name>` repeats one effect, `&cycle=1` walks the whole gallery, `&list=1` logs the names. `&sheet=1` steps the clock by hand and shows frames 1, 3, 6, 15, 40, 90 as a contact sheet; `&effects=a,b,c` gives one row per effect, `&frames=` picks frames, `&dist=`, `&h=`, `&look=`, `&yaw=` place the camera. In the page, `__fx.fire(name)`, `__fx.step(n)` and `__fx.capture(effects, frames)` do the same by hand.

## Measured

`__fx.bench`, quality 1, 1280x720, on the shared 8 GB M1 with the harness capped at 60 Hz. Treat these as relative.

| | Idle | 3 Hellfires + 20 stump emitters |
|---|---|---|
| `fx.update` CPU per frame | 0.02 ms | 0.08 ms |
| `render.render()` CPU per frame | 0.62 ms | 1.66 ms |
| Frame time | 16.6 ms | 17.4 ms |
| Peak particles | 0 | 2,347 |
| Draw calls | 45 | 47 |

Emitting all of it on one frame cost 4.2 ms. GPU time was not measured directly: frame time above is capped by the harness, so it can hide GPU headroom or a small overrun. Overdraw from a fireball filling the screen is the case to watch at default quality.

Cap behaviour, from a browser run: 12,000 chips in one call clamps to 9,000 live, then drains to 0. 90 Hellfires on one frame leaves 18,500 live with no errors. Pause freezes particles. All 92 gallery entries fire clean.

## Measured: blood and dropped frames

`tools/scripts/blood-bench.mjs` in the real game at `--dpr 2 --w 1440 --h 900`, which `MAX_PIXELS` caps to 1920x1200 at quality 2. Other agents held the load average at 20 to 50 and the browser runs at nice 19, so these are upper bounds, and runs disagree by more than most of the differences. Dynamic resolution is off under automation, so none of this includes it.

| Suspect | What the timeline showed | Verdict |
|---|---|---|
| GPU with no blood at all | 20-24 ms a frame on the quietest run, GPU-synced. Frame interval 33 ms or worse before any event | No headroom at 60 Hz. Anything extra misses a frame |
| First draw of a program | three's `getProgramInfoLog` blocks on a full GPU queue drain, even for a program linked at load: 320 ms on the first hit, 70-130 ms later ones. Each new kind of blood finds new programs, so it keeps happening for the first minutes | Real. Fixed for everything compiled at load |
| Programs not compiled at load | `ChunkField.ensure()` builds its materials on the first gib or headshot: 2-3 links in the frame, 190-650 ms | Real, gore's |
| Hit-stop | World clock at 3-5% for 28-50 ms on headshots, severs and heavy kills. That is 2-3 frames at 60 Hz, on exactly the frames a spurt starts | Looks identical to dropped frames. Blood now flies through it. The world still stops |
| Gore on the event frame | Sever 3-7 ms, gib 6-13 ms in gore. The physics step spikes to 10-20 ms on a frame or two and sits 1-5 ms higher for a while after a gib. 230-630 rays over the next 40 frames | Real, gore's |
| Emission and uploads | 0.2-1.3 ms an event before, 0.1-2.2 after, under heavier load. About 50 KB uploaded | Not the cause |
| Overdraw, decals, lens | At 1.2 m the GPU frame rose 0-2 ms. Hiding smoke, chips, decals, or all of it, changed nothing beyond noise | Not the cause |
| GC | 94 scavenges in 50 s, 458 ms in all, longest 19 ms. Up to 25 ms in the half second after a sever, 0 after most events | Minor |

| Same scenario, 1.5 m | Before | After |
|---|---|---|
| First bullet hit: render on that frame | 203 ms | 10 ms |
| First bullet hit: worst frame interval | 217 ms | 100 ms |
| FX and decal programs first used in play | 3 or more | 0 |
| Programs still first used in play | | 2 at the first husk (characters), 2 at the first headshot (gore) |
| Steady interval around any blood event | 33-67 ms | 33-67 ms, no measurable change |
| Particles in a full gib | 407-411 | 62 |

`FxCore.warm` asks about every program the renderer has on the first frame after load, then draws each empty layer once, so the stall lands on the menu.

**For gore:** call `ChunkField.ensure()` at init and do the same for `sliced.ts`, so the chunk programs exist before `bakeLightVolume`. Send stains through `decals.splat(point, normal, size, velocity)`: on droplets in `updateDroplets`, and in the queue with `q.dx`, `q.dy`, `q.dz` as the direction. `atan2(vx, vz)` is only right on floors, and the queue's rotation is random.

## Known limitations

- **Floor only.** Particles collide with one floor height sampled at the burst origin. They pass through walls, where depth hides them, and a chip that flies off a ledge stops in mid-air at the origin's floor height, or sinks into a ramp that rises away from the origin.
- **Smoke is not depth sorted.** Spawn order is the sort order. Overlapping puffs from different bursts can layer wrongly, which is hard to see with thin smoke.
- **Fire is opaque.** That is the punch, but a blast within about 6 m fills the view for roughly 0.25 s. Smoke behind it is thin, and the view is clear by about 1 s.
- **Chips have no MSAA**, because they draw in the transparent pass.
- **The cel-painted fire is a style call** that goes beyond the brief, and it sits against a PBR world. It is the biggest single look decision here, so the owner should see it. To soften it, raise the `soft` argument in `fireball()` and drop the band code in `layers/smoke.ts`.
- **Casing tinkles are silent** until something subscribes to `fx:casing`. Nothing did when this was written, and `public/audio/sfx` has no tinkle sample. The event itself is tested: one casing reports 3 bounces of falling strength.
- **Not visually verified:** the shock-front distortion on its own (it runs inside explosions, heat shimmer was checked), `muzzle-flame`, and dash streaks from a first-person view. The sandbox camera is 9 m away, and the streaks are built around the eye.
- **`sparkTrail` is subtle** past about 10 m.
- **The shock sphere is louder than the original.** Against the dark map it reads as a clear white dome for its 0.1-0.15 s, not the spec's subliminal 25%, even after being cut from 0.55 to 0.22. Lower `shockColor` in `core.ts` or `uLinePx` in `layers/shock.ts` to taste.
- **A world-space flash near a viewmodel** relies on the 3 m rule in `recipes/muzzle.ts`. An enemy firing from under 3 m away has its flash drawn in the view scene, which looks right but ignores world depth.
- **A strand can stop in mid-air** when the wall ahead of a jet is narrower than the jet, because the landing test uses that wall's plane. The stain then fails the decal depth test and nothing is left behind. Rare, and it was never worth a second ray.
- **Blood in near-total darkness is hard to see,** on purpose. So is everything else there.
- **Gore's stains are not directional yet.** They use `decals.add`. Only drops that come through FX are elongated. See the gore change in Measured.
- **Not verified on the owner's screen.** Everything here ran headless on a loaded machine with dynamic resolution off. Blood flying through hit-stop is correct by construction but has not been judged in motion.
