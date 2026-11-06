# Effects (`src/fx`)

`createFx(ctx)` from `src/fx/index.ts`. Everything visible that is not a mesh or a decal goes through it.

## How it works

**Particles live on the GPU.** Emission writes one spawn record into a ring buffer and uploads just that range. The vertex shader works out where the particle is from (record, time), so a particle costs CPU exactly once, when it is born. Slow-mo, hit-stop and pause come from `ctx.time.elapsed` with no extra code.

| Class | Draw calls | Cap | What it is |
|---|---|---|---|
| `chips` | 7, one per shape | 21,500 | Opaque faceted chips and stretched droplets. Exact ballistics with up to 4 floor bounces |
| `streaks` | 1 | 5,000 | Sparks, debris streaks, embers. Screen-aligned slivers along the velocity |
| `smoke` | 1 | 2,000 | Smoke, dust, mist, fire. Premultiplied, so fire and smoke share a draw call |
| `puffs` | 1 | 1,500 | The original's dotted trail: unrotated translucent cubes |

That is the 30k budget exactly. Each ring evicts oldest-out by overwriting. Idle rings hide their mesh, so an idle frame costs a few comparisons and zero draw calls. All layers together are at most 20 draw calls.

Short-lived shapes have their own small rings: `flashes`, `muzzle`, `muzzleView`, `trailRings`, `waves`, `shock`, `lines` (tracers and beams), `arcs`, `slashes`, `shimmer`, `lens`.

## What is kept from the first game, on purpose

- Spawn at full size and full colour. `core.birth` pre-rolls one frame, so frame one is an open burst and not a dot.
- Chips are opaque, leave by shrinking, and a burst's life is fixed, so it ends on one frame.
- 4-segment gems, unrotated cubes. Exact counts and colours per explosion, in the table at the top of `recipes/explosions.ts`.
- Colour is per particle. A fireball is three flat-coloured layers from one origin. The cel bands inside a lobe are spatial, not colour over life.
- Gravity -20, life ladder 0.07 / 0.25 / 1 / 1-2 s, blood at 5:1 speed to jitter, wireframe shock sphere at about 75% of blast radius.
- Trail beats in `emitters.ts` run on `realDt`, so SLOWMO packs them 4x denser and rings coil.

## Things that differ, and why

- **HDR is mostly not on the chip body.** This is a deliberate step back from the brief's "HDR values above 1". Khronos Neutral mixes toward white as peak rises, and after sRGB a 10% mix turns red to salmon. So flat colours sit at 1.15 and land on screen as the original hex, and only the facet facing the eye rises, to about 1.4. At 1.95 big close chips went visibly salmon. Fire has a yellow-white core band, and flashes and cores go far higher. `palette.ts` explains this. Do not raise chip gains.
- **Chips draw in the transparent pass** (with depth writes), after the smoke and fog. Fire does not write depth, so this is what keeps chips visible on top of the fireball. They lose MSAA.
- **Velocity dome** rejects the corners of the original's box. With big Hellfire chips the raw box is a visible rectangle.
- **Blast warp** (`uEject`): chip flight time runs ahead for the first few frames, so chips leave the origin faster than they travel later. Closed-form, so bounces still work.
- **Blood jet speed** spreads along the axis (6-17, the spec has a fixed 15), which turns one burst into a visible stream. Lateral jitter is unchanged; upward jitter is 0-3.5, down from 0-5.
- **Numbers that moved from the spec.** Counts and colours of chips are exact. These are not: explosion chip speed is 1.3x, non-Hellfire explosion chips are 1.5x size, droplet radii are about 0.4x because stretching adds length, mist counts are lower (jet 10 to 5, gib 10 to 7), head chunks are about 0.65x. All were tuned by eye against the renderer. Revert in the recipes if the owner prefers the exact originals.
- **Smoke does not fade.** It erodes: a rising threshold eats the sprite from the outline inward, the same "exit by shrinking" as chips.
- **Fire is cel-painted.** Each lobe is a torn outline with flat bands stepping toward yellow at its core. It came out of the same rule as the chips, and it reads as hot at any distance without going soft.

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
- `fx.impact` adds a `bullet` decal. `fx.explosion` adds a `scorch` decal. Blood decals are `src/gore/blood.ts`.
- `fx.smoke` is a cube dot up to 1.2 m, the original's look. Bigger sizes become a soft billow, because a translucent box several meters across looks wrong.
- `src/player/feedback.ts` calls `dust`, `dashStreaks` (with the eye position), `slam` and `wallSparks`. The jump-pad burst needs no call: FX listens for `world:pad`.
- `fx:casing` fires on each casing bounce. Its payload object is reused. There is no tinkle sample in `public/audio/sfx`, so audio has to pick something.

Camera shake and hit-stop are not done here. Callers own those. Explosions do fire `post.chromatic` and `post.radialBlur`, scaled by distance.

## Tuning

| Where | What |
|---|---|
| `palette.ts` | All colours and gains |
| `recipes/explosions.ts` `RECIPES` | Counts, reach, shock, smoke, light per kind |
| `recipes/impacts.ts` `SURFACES` | Per-surface chips, dust, sparks, pop |
| `recipes/muzzle.ts` `MUZZLES`, `TRACERS` | Star shape, size, life, light. Tracer width, speed, length |
| `recipes/misc.ts` `BEAMS`, `SLASHES` | Beam and slash looks |
| `layers/chips.ts` | `uGlint`, `uGlintGain` (hot facet), `uFacet` (per-facet shading), `uEject` (blast warp), `uMinPx` (pixel floor at range) |
| `layers/chips.ts` `CAPS` and the other constructors | Budget. Keep the sum at 30k |
| `layers/shared.ts` | Fog on FX: `uFogDensity`, `uFogAmount`, `uFogColor` |

## Testing

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

## Known limitations

- **Floor only.** Particles collide with one floor height sampled at the burst origin. They pass through walls, where depth hides them, and a chip that flies off a ledge stops in mid-air at the origin's floor height, or sinks into a ramp that rises away from the origin.
- **Smoke is not depth sorted.** Spawn order is the sort order. Overlapping puffs from different bursts can layer wrongly, which is hard to see with thin smoke.
- **Fire is opaque.** That is the punch, but a blast within about 6 m fills the view for roughly 0.25 s. Smoke behind it is thin, and the view is clear by about 1 s.
- **Chips have no MSAA**, because they draw in the transparent pass.
- **The cel-painted fire is a style call** that goes beyond the brief, and it sits against a PBR world. It is the biggest single look decision here, so the owner should see it. To soften it, raise the `soft` argument in `fireball()` and drop the band code in `layers/smoke.ts`.
- **Casing tinkles are silent** until something subscribes to `fx:casing`. Nothing did when this was written, and `public/audio/sfx` has no tinkle sample. The event itself is tested: one casing reports 3 bounces of falling strength.
- **`lensBlood` only fires from `gibBurst` and `headBurst` within 3 m.** Nothing calls it directly.
- **Not visually verified:** the shock-front distortion on its own (it runs inside explosions, heat shimmer was checked), `muzzle-flame`, and dash streaks from a first-person view. The sandbox camera is 9 m away, and the streaks are built around the eye.
- **`sparkTrail` is subtle** past about 10 m.
- **The shock sphere is louder than the original.** Against the dark map it reads as a clear white dome for its 0.1-0.15 s, not the spec's subliminal 25%, even after being cut from 0.55 to 0.22. Lower `shockColor` in `core.ts` or `uLinePx` in `layers/shock.ts` to taste.
- **A world-space flash near a viewmodel** relies on the 3 m rule in `recipes/muzzle.ts`. An enemy firing from under 3 m away has its flash drawn in the view scene, which looks right but ignores world depth.
- **First decal of a session gives one dark, moire frame.** Seen in the sandbox on the first decal of every page load, and not on any later one. Effects without decals are clean, and lights alone do not trigger it. This looks like first use of the decal material in the renderer, but the cause inside the renderer is not established and it has not been reproduced in the full game.
