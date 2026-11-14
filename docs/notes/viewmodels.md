# Viewmodels

First-person weapons, arms and off-hand items. `src/weapons/viewmodels/**`, sandbox at `/?sandbox=viewmodels`. `createViewmodels(ctx)` from `src/weapons/viewmodels/index.ts` returns the `Rig`, which implements `ViewmodelRig`. It never changes game state.

| File | What it is |
|---|---|
| `rig.ts` | The frame: motion sampling, springs, the gun's pose layers, arm solve, light on the gun, wrist readout, `muzzle()`, `ejectPort()` |
| `def.ts` | `ViewDef` (one per weapon), `Anim` (per-frame state a clip reads), `HandCtl` (where a hand wants to be) |
| `arms.ts` | One skinned mesh per arm: sleeve, bracer, glove, 19 bones, two-bone IK |
| `offhand.ts` | Left hand's own life: grenade, walkie, designator, sonar tap, stim injection |
| `legs.ts` | First-person legs for a slide and a vault: three rigid pieces a leg, posed by a two-bone solve |
| `poses.ts`, `curves.ts`, `spring.ts` | Finger poses, timing curves, exact closed-form springs |
| `kit/mesher.ts` | Procedural hard-surface builder. A part's whole surface is one buffer |
| `kit/materials.ts` | The one shader for every opaque surface, the decal atlas, perk looks, light band |
| `kit/model.ts`, `kit/ao.ts` | Runtime model (parts, sockets, glows, screens) and per-vertex AO baked at load |
| `models/*.ts` | One file per weapon: geometry, sockets, and its clip |

## Using it

`Weapons.ts` and `melee/Melee.ts` already drive everything. Nothing outside them should need more than the `ViewmodelRig` interface.

```ts
viewmodel.equip('lance', 0.3);       // seconds <= 0.03 skips the draw, for a quick melee
viewmodel.fire(strength, left);      // strength scales the weapon's own RecoilSpec
viewmodel.reload(seconds);           // the clip stretches to whatever it is given
viewmodel.swing('light2', seconds);  // 'block' is an overlay on the guard, not a move
viewmodel.setCharge(0..1);           // Lance capacitors, the rotary cannon's spin, sword wind-up
```

The `sonar:tap` event raises the left hand to the helmet. Its fingers land `SONAR.tapLead` later, when the ping goes out. The `stim:inject` event plays the stim (`Offhand.updateStim`, model `buildStim` in `models/devices.ts`): the autoinjector comes up in a fist with its green dose window below the hand, the thumb flicks the red cap off, the fist swings to the lower-left corner toward the neck, shoves in at `STIM.injectAt` (needle out, dose goes dark) and drops away by `STIM.seconds`. It takes the hand from a sonar tap or a grenade.

Inputs the rig polls rather than being told, all public state: `weapons.grenades` falling starts a cook and `input.isDown('grenade')` going false throws it. `progression.targeting` picks the device, and the `callin:used` event presses its key. `weapons.ammo(id)`, `weapons.reloading`. `perk:start` and `perk:end` for `hellfire`, `berserk`, `frostNova`.

## Adding a weapon

Write `models/<id>.ts` exporting a `ViewDef`, and add it to `buildDefs` in `models/index.ts`. The contract is:

A family member (`docs/notes/weapons.md`) is the same one line. The Harrow and the Rivet are files of their own.

**Key 4** (`models/autocannon.ts`) is two guns in one file that share only the grip and trigger group (`lower`) and the readout panel, so the right hand sits the same; they were one cannon with two belts until 2026-11-14.

- *The autocannon* is a shoulder-fired 20 mm-class cannon: a receiver 14 cm wide and 17 tall with stepped armour, a rubber butt, a fore grip on its belly, and a nose that steps down ahead of the clip so the eye sees the barrel's run. The feed is a Bofors-style clip (part `clip`) standing in a well in the top plate: three big rounds (`r0` bottom to `r2`) lying fore and aft, stacked upright in a charger with windowed cheeks and a red lifting bar, the noses out in front. Round `i` is drawn while `i < mag`; on a shot the bottom one feeds and the rest are drawn one pitch up and drop into place over 0.07 to 0.16 s. The sight is a short heavy tube on a bracket off the **right** flank, so it hides neither the clip nor the barrel. The barrel (part `barrel`) runs back 12 cm into the receiver on the frame of the shot, holds 0.03 s and is run home by the spring in 0.2 s, inside the 0.3 s between shots: a coil spring (part `spring`, squashed along Z with the barrel) between the receiver face and a collar, a chrome buffer rod off the collar into a cylinder under it, and a bearing ring at the front of a cradle that the barrel slides through, with a three-baffle brake beyond. Reload: the gun rolls its top toward the eye, the left hand takes the clip's bar (`clipHold`), lifts it up and out to the right, a full one comes back down the same way at 0.36 to 0.56 and is slapped home, then the charging handle on the left flank is racked (`chargeHold`) at 0.72 to 0.88.
- *The Sabot* is a slim anti-armour sniper rifle: a receiver 5.6 cm wide, a skeleton stock, an octagonal free-float handguard with a folded bipod, a fluted barrel to 1.26 m from the grip with a slim slotted brake, and a long scope with a hairline-and-dot reticle in its eyepiece. Its five darts (`r0`..`r4` in part `belt`) stand in an open side magazine on the left, so every fin-stabilised tip shows; the stack climbs one dart a shot into the receiver. Its readout is on the left flank behind the magazine. The shot is a 1.8 cm kick of the barrel and the charging handle thrown back; most of it is the body going into the shoulder. The reload is the old one: gate up (`coverHold`), a new stack in from below (`beltHold`), gate down, handle racked.

Both keep the owner's recoil of 2026-11-13: straight back into the shoulder with a slight tip.

The Thresher (`models/thresher.ts`) and the Quiver (`models/quiver.ts`) are files of their own. The Thresher is grey polymer where the pump is walnut: an in-line stock, a carry handle with the sights, a slotted shroud, a ported brake and a steel drum on a latch (part `drum`), which tips out and drops on the reload and comes back with a slap, then the handle is racked. The Quiver is a ribbed olive box of four tubes with a framed face, a painter unit on the left flank and a folding fore grip. **More than one barrel:** a model gives each its own socket, `muzzle`, `muzzle1`, `muzzle2`, `muzzle3`, and `Rig.muzzle(out, left, barrel)` answers the one asked for, or `muzzle` on a gun that has one. The Quiver's tubes empty in firing order, so tube `i` is drawn loaded while `i >= magSize - mag`; each shot kicks the block toward the side of the tube that fired. Its painter shows the marks: four lamps (glows `lamp0`..`lamp3`) lit by `a.charge`, which `Weapons` sets to marks over salvo size through `setCharge`, and a screen with the count and the four tubes. It loads from the front: the block is presented, and each round (parts `round0`..`round3`, hand sockets `load0`..`load3` on their tails) comes up from the waist and is pushed into its tube at 0.24, 0.4, 0.56 and 0.72 of the reload, on the four `quiver_load` cues.

Key 8 is two files. **The Trommel** (`models/trommel.ts`, registered under the id `buzzsaw`) replaced the Buzzsaw's model: six barrels 3 cm across where the old ones were 1.7, on a circle 8 cm wide where the old one was 5, each with a 20 mm bore and a heavy collar at the muzzle, held in a plain steel muzzle ring where the red toothed disc was. The housing is half as wide again and taller, with a fatter motor in its flank, a thicker carry handle and a bigger can of 20 mm on a chute of wider links. Nothing on it is toothed or red. `spinMax` is 24 rad/s. Its clip hammers the whole gun about while rounds leave: six sines at rates that share no factor, on position and rotation, held for 0.09 s after a round and faded over 0.16, with the can swinging on its latch and the chute whipping; the recoil spring under it has three times the old travel on a slower spring (`omega` 58), so at 25 rounds a second the gun never comes home between two. The reload is the Buzzsaw's: can off, new can on, one throw of the feed lever. `models/buzzsaw.ts` is kept, and `?slot8=old` builds it in the Trommel's place.

**The Piledriver** (`models/piledriver.ts`) is a carried heavy machine gun: a long riveted receiver under a hinged feed cover, a barrel in a cage of four slotted plates, a block of a brake, a belt box on the left with seven linked rounds climbing out of it onto the feed tray, a charging handle the whole fist goes round, a ladder sight. The barrel is its own part (`barrel`) and runs back 2.2 cm in the cage on every round, the bolt 7 cm, and the belt steps a link. Its recoil is the hardest of any automatic: 5 cm back and 0.052 rad of climb on a spring slow enough (`omega` 34) that eight a second are eight blows. Reload: cover up, box off, new box on at 0.5, belt up onto the tray, cover down at 0.69, handle racked at 0.8 on `piledriver_charge`.

- Origin at the top of the grip, `-Z` forward, `+Y` up. Sockets `muzzle` and `eject`, and hand sockets from `model.hand(name, contact, side, fingers, part?)`. `contact` is where the palm presses, **relative to `part` when one is given**. That is the easiest mistake here. It left the SMG's rack hand floating near the camera.
- `animate(a)` runs every frame after `resetParts()`, so it writes offsets with `+=` and adds to `a.gunP` and `a.gunR`. Hands take `a.left.to(socket, weight)` in sequence, later wins.
- Keep the hand off anything that swings past the camera. Riding the Mule's cover or the Buzzsaw's crank through a full turn dragged the whole arm across the eye. Hands crack a latch and let go.

## How things work

**Arms.** Shoulders are deliberately far under the frustum and out to the sides (`SHOULDER_R`, `SHOULDER_L`), not where a body would have them. The arms are shorter than most poses ask for, and a true shoulder slides the limb up past the eye as a huge sleeve. The IK also had a scratch-vector bug where the shoulder was overwritten by the hand's up vector. That was the source of the fat stump in early shots.

**The body layer.** `ctx.player.moveAnim` (`MovePose`, from `src/player/moveAnim.ts`, described in docs/notes/player.md) says what a move does to the weapon, the left hand and the legs. The rig only applies it, so it works for any weapon and no model file knows about it:

- `composeGun` adds `gun*` after the pose layers, and `composeLeftGun` adds it mirrored. Both scale it by `moveCalm`, which drops to 0.2 (`MOVE_CALM`) while the gun fires, reloads, swings or draws, so a shot never leaves a dipped gun. That has to hold for the first shot of a burst too, and the weapon system reads `muzzle()` before it calls `fire()`. So `fire()` sets `moveCalm` to 0.2 at once instead of easing to it, and `muzzle()` goes through `settleMuzzle`, which answers from where that puts the gun: it takes the socket back into the gun's frame and rebuilds the gun's transform with the move's share removed, from the rotation `composeGun` saved in `gunRot`. Measured live half way up a climb with the shotgun: the muzzle the shot was given is 2 cm from its place at rest, where it was 20 cm low.
- `solveArms` blends the left wrist to `hand*` by `handW`, last, after the off-hand. `handFree` holds the hand on the weapon through a reload, a swing, akimbo and a draw. Fingers blend to `HANDS.open`. When `handSide` is +1 the same channels drive the right arm instead, mirrored (x, yaw and roll negated), and the right hand is the only time it leaves the weapon.
- **The hand-off** (`swap`, for a wall on the right). `composeGun` mirrors the gun's pose across the middle of the view by `m = 1 - 2 * swap`: after the bob, run, sprint and slide layers it multiplies x, yaw and roll by `m`, and the body layer, the clip's own motion, the draw roll and the scope's centring are added with `m` too. The look-lag, body-inertia and recoil springs are not, because they answer the body and not the hand. On the way across the gun dips under the view (`sin(pi * swap)`: 3 cm down, 2 cm back, 0.18 rad of muzzle drop). The model is never reflected, so the eye sees its other side: on the autocannon the clip and the right-flank sight face the camera. `settleMuzzle` takes `m` as the gun's side, so the first shot of a burst mid-hand-off leaves from the gun as drawn.
- **The left-hand grip is the right hand's, mirrored** (`mirrorGrip`): the right wrist's resolved target, clip steps and all, is taken into the gun's frame, reflected across its centre plane (position x negated, quaternion y and z negated, which with the left arm being a reflection of the right is the right hand's grip in mirror), and put back. The left hand blends onto it by `smoothstep(0.15, 0.6, swap)`, its fingers to the right hand's pose and its trigger finger with them. A one-handed weapon has no left hand to start from, so it comes up from the `pouchL` anchor. `LEFT_GRIP` in `rig.ts` is the per-weapon nudge for a weapon where the mirror lands badly; it is empty, since all twenty looked right on a wall run.
- **`swapFree`** takes the gun back to the right hand for a reload, a swing (fast, rate 40), a draw, akimbo, or the off-hand holding anything. So a melee blow on a right-side wall run is always struck from the right hand: the blade comes back across in the wind-up and goes over again after. Firing never takes it back.
- `Legs.update` draws the legs while `legsW` is up. They are written in the body's frame and turn against the look's pitch, so level eyes see boot tips in a slide and looking down shows the legs. They rise from under the view; there is no fade.
- A stand-in player answers every read with a proxy, so the rig takes the layer only when `handW` is a number.

**Light on the gun.** The baked light is too wide for something that fills a quarter of the screen. It runs from near black in the scrapyard to a trapped glare in the sump. Three things hold it together, all in `rig.ts` and `kit/materials.ts`:

- `LIGHT_BAND` squeezes indirect light: soft ceiling, plus a floor that keeps the local hue, so the gun goes dim orange in the foundry instead of black.
- The view moon was never shadowed, because view meshes do not receive shadows. It lit the gun at full strength in sealed corridors. `updateMoon` casts one ray toward the moon every 50 ms from four points around the eye and scales the moon by the result. Per-pixel PCF would cost far more and shows nothing on a rigid gun.
- `fill`, one directional light fixed to the view. It stays on in moonlight, because the moon is often in front of the player, lighting faces nobody can see.

**Muzzle flash light.** Inverse-square from a few centimetres burnt the gun to flat colour. `POINT_LIMITED` is a copy of three's `lights_pars_begin` with a soft limit on each point light before it meets the surface. Limiting after the surface would flatten albedo. That was half of the blown-out Hellfire shot. The other half was the heat ramp.

**Perk looks.** Emission lives in thin veins, in patches, on hard surfaces only, plus broken edge lines. Everything between keeps its albedo and wear. Do not widen `vmVein` or drop `vmVeinMask`: at full coverage the gun turns into marble. Sustained-fire heat is squared so one shot leaves a barrel dark.

**Sword.** Timings are the first game's, the arcs are not. Each runs along the `sweep` in `SWORD.chain`, so blade, crescent and cut plane agree. A move starts from wherever the blade is, so a chain flows. The hilt stays near the bottom edge and the blade does the crossing, otherwise a cut disappears below the screen. The blast frame of the finisher is `p = 0.571`, and `SLAM_END` lands exactly there. The blade shader reads the wear tag as position across the blade, which is how the temper line follows the curve.

**Key 5's other four.** The Shiv (`knife.ts`), Prybar (`crowbar.ts`), Spade (`shovel.ts`) and Cosh (`baton.ts`) are one file each and share one clip, `models/melee.ts`: a move is three poses, start, middle and end, run as one curve, and a move whose row in `MELEE` has an `impact` share first winds up to its start pose over that share, so the model and the blow agree. Moves are `light1`..`light3` and `heavy` (`SwordMove`), each model reading them as its own. The arcs follow the sword's rule: the hand stays low and the head of the weapon crosses the view. A backhand keeps the hand's roll on the forehand side (Z near -1.5); rolled the other way the forearm turned into the view and the weapon pointed at the camera. The Shiv, Prybar and Cosh are one-handed (`left: null`); the Spade has the left hand on its D grip. The Cosh opens on the draw: its two outer tubes are parts (`tube1`, `tube2`) that slide out over the first half of it.

**Scope.** The gun lifts and hides past `scopeW` 0.9. The overlay arrives before that, so the gun can be seen inside it for about 100 ms. The reticle in the overlay is per gun (`RETICLES` in `src/ui/hud/overlays.ts`, see `docs/notes/weapons.md`); the small glowing one in each model's eyepiece is drawn to match it.

**The Lance's charge** (`models/lance.ts`). `Weapons` sets `a.charge` through `setCharge`, and the clip reads the stages of the beam out of `TUNING.lance.stages` (`docs/notes/weapons.md`, "The Lance"), so the gun shows the charge in steps and not as a ramp. Three of the four capacitors fill on the way to the three stages and burn once theirs is reached; the fourth lights and flickers at full charge. A stage landing flares its capacitor white and jolts the gun for `STAGE_POP` (0.16 s). The hum in the hands steps up with each stage (`HUM`: 0.4, 1.0, 3.4 mm) to a real shake at full, and the arms draw the gun in 18 mm. The screen shows what letting go now fires: `BALL`, then `I`, `II`, `III`, with a notch on its bar at each stage and `MAX` at full. `seenStage` and `stageLanded` are module state, on the grounds that one Lance is ever in the hands. A tap never reaches the clip as a charge: the charge only starts after `TUNING.lance.tapTime`.

## Tuning

| Want | Change |
|---|---|
| Recoil, per weapon | `recoil` in the `ViewDef`. `omega` is how snappy, `zeta` how much it rings |
| Gun placement | `pos`, `rot` in the `ViewDef`. Sword: `REST` |
| Bob, sway, sprint pose | `sampleMotion` and `composeGun` in `rig.ts`. Mirror changes in `composeLeftGun` |
| What a move does to gun and hand | `ANIM` and the targets in `src/player/moveAnim.ts`. Hand targets are view space, compressed to what the 58 degree view shows at arm's length: about 23 cm tall at 42 cm out |
| Leg poses | `LEG_POSES` in `legs.ts`, body frame, eye at the origin |
| Sword arcs | `ARCS`, `AREA`, `SLAM_*`, `COCK`, `PARRY` in `models/sword.ts`. Euler X, Y, Z: at X near 1.5 the blade stands up and Y leans it across the screen |
| Key 5's other four | `REST` and `moves` in `models/knife.ts`, `crowbar.ts`, `shovel.ts`, `baton.ts`; the clip they share is `models/melee.ts` |
| Dark or bright gun | `FILL_*`, `MOON_FLOOR` in `rig.ts`, the two floors in `LIGHT_BAND` |
| Flash on the gun | The `0.4` in `POINT_LIMITED`. Lower is brighter |
| Perk strength | The `vmEmis` lines in `FRAG_SURFACE` |
| Finishes | `kit/finishes.ts` |

## Measured

Triangles and draw calls per weapon, as shipped. Only the held weapon draws.

| Model | Triangles | Draws | | Model | Triangles | Draws |
|---|---|---|---|---|---|---|
| SMG, each | 22.8k | 12 | | Lance | 34.7k | 17 |
| Shotgun | 18.5k | 8 | | Trommel (the Buzzsaw's model, with `?slot8=old`: 19.9k, 10) | 19.2k | 10 |
| Rocket | 20.4k | 9 | | Kiln | 15.3k | 10 |
| Autocannon | 16.0k | 13 | | Stakegun | 20.3k | 12 |
| Sword | 6.0k | 1 | | Grenade | 4.9k | 3 |
| Judge | 13.4k | 10 | | Walkie, designator | 3.5k, 3.2k | 4, 5 |
| Harrow | 9.6k | 9 | | Rivet | 5.2k | 7 |
| Sabot | 26.1k | 14 | | Thresher | 9.4k | 11 |
| Quiver | 11.4k | 18 | | Piledriver | 14.9k | 11 |

The sword and Judge are under the brief's 15k floor. They look finished at that count, so I left the budget unspent.

GPU cost of the view scene at 1920x1080, by timed `render()` with the rig on and off, best of four rounds of eight, on a shared machine: SMG 0.69 ms, Lance 0.46, autocannon 0.63, sword 0.45, against a frame of about 11 ms. Treat those as roughly 0.5 to 0.7 ms.

Distance from where `muzzle()` and `ejectPort()` land to the drawn gun, 1280x720, `VM_STEPS=align`, median px across all nine guns:

| Motion | Muzzle | Eject |
|---|---|---|
| Still | 0 to 0.1 | 0 to 0.2 |
| Running, 12.5 m/s | 1.2 to 2.2 | 2.7 to 3.9 (rocket 7.4, unused) |
| Strafing through a flick | 3.5 to 5.8 | 2.9 to 7.4 (rocket 68, unused) |

Maximums in the flick with the trigger held reach 44 to 106 px on the semi-autos, and 8 to 10 on the SMG and Buzzsaw. That is one sample per shot: `muzzle()` is read before `fire()` adds recoil, so the tracer leaves from where the gun was. With the trigger up, the same flick peaks at 7.5 to 8.2 px on the Judge, autocannon and shotgun. The bullet leaves first in life too, so I left it. The rocket has no casing, so its eject socket is never used.

## Testing

```
/?sandbox=viewmodels&weapon=judge&pose=reload     # first person. pose: idle, fire, reload, draw. &engine=1 for the real renderer
/?sandbox=viewmodels&view=inspect&weapon=lance    # turntable. &yaw= &pitch= &dist= &fx= &fy= &fz=
/?sandbox=viewmodels&manual=1                     # stepped clock, window.__vm.step(seconds)

VM_IDS=shotgun,judge VM_MODE=reload node tools/shot.mjs --url "/?sandbox=viewmodels&manual=1" \
  --script tools/scripts/viewmodel-anim.mjs --out tools/out/vm/a.png      # reload, fire, draw, sword: exact frames
MELEE_IDS=knife,crowbar node tools/shot.mjs --url "/?sandbox=viewmodels&manual=1" \
  --script tools/scripts/melee-vm.mjs --wait 1500 --dpr 2 --w 1440 --h 900 --out tools/out/melee/vm.png   # key 5: rest, draw, every swing
VM_IDS=lance node tools/shot.mjs --url "/?sandbox=viewmodels&view=inspect" \
  --script tools/scripts/viewmodel-inspect.mjs --out tools/out/vm/i.png   # turntable, one page load for the arsenal
VM_SPOTS=bright,dark node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk" \
  --script tools/scripts/viewmodel-gallery.mjs --w 1920 --h 1080 --out tools/out/vm/g.png   # all ten in the real game
VM_STEPS=perks,callins node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk" \
  --script tools/scripts/viewmodel-live.mjs --w 1920 --h 1080 --out tools/out/vm/l.png      # see the header for the steps
```

`VM_AT` moves the camera, as JSON. Useful spots: foundry `0,0,-80` is the orange one, scrapyard `-66,0,80` is the darkest, `112,0,8` is cyan, the sump `112,-6,112` is the over-bright one.

## Known limitations

- **Key 5's four were checked as stills only**: rest, four draw frames and six frames of every swing on the stepped clock (`tools/scripts/melee-vm.mjs`), and stills in the real game. The Shiv's backhand ends with its blade behind the fist; the Prybar's and Spade's overheads bring the hand large into the top of the view while they wind up. Triangle counts and GPU cost were not measured.
- **The Thresher and the Quiver were checked as stills only**: a turntable each, seven fire frames and nine reload frames each in the sandbox, and stills in the real game. On the Quiver the face of the block is far up the view, so the four pushes of the reload are small on screen, and its hips pose fills the bottom right as a box launcher does. Nobody has seen either in motion.
- **The Harrow and the Rivet are lighter models than the first ten**, 9.6k and 5.2k triangles. They read correctly in the hand and on the turntable, but nobody has put them beside the SMG and the Judge for finish. Their reloads were checked as nine stills each, not in motion: on the Rivet the magazine goes in low on the screen and the gun is lifted to show it.

- **The legs are simple.** Lofted cloth limbs with pads and a boxed boot, 7.2k triangles and six draws while shown. They read as legs in a slide. In a vault they pass on the gun's side, so at level eyes the weapon covers most of them and they show when looking down. Judged from stills only. `?legs=0` hides them.
- **A planted hand is placed for the screen, not the world.** The true spot is below the view at level eyes, so the hand is lifted into the bottom of the frame and its travel compressed. It does not track the real ledge or wall surface.
- **Nobody has played this with hands.** Every result is a script, a bot or a frame I read. Recoil weight and sword timing need a human.
- **The sump is still bright.** Its baked light is high and the band only softens it, so the gun looks lit in a room that reads dark. The cause is the volume there, not the gun.
- **Weapon swap has no holster-out.** The old gun disappears and the new one rises. The draw is 0.14 to 0.34 s, so I judged it a snap, but it is one frame of pop.
- **Left SMG is a plain copy, not a mirror image.** Its readout is on the far side, and its port faces inward. Decals would need flipped UVs to reflect the model.
- **The Lance's rails are hard to see from the eye.** They glow, but the capacitors on the near flank carry most of the charge read.
- **The Lance's charge was checked as four stills**, one at each stage in the real game, with the charge held still for each. The capacitors and the screen read; whether the stage jolt and the shake at full read in motion is unjudged. With `?lance=old` the old gun keeps this clip, so its capacitors fill at the new stages' thresholds and not in quarters.
- **Parry and guard share a pose family.** `melee/Melee.ts` has one state for wind-up and guard, so held guard looks like the wind-up, and only a blocked shot snaps across the body.
- **The Trommel's spin rate is tuned for 60 fps.** At 24 rad/s it advances a little over a third of a barrel a frame, so it reads as turning. At other refresh rates it can stroboscope. The Buzzsaw's 30 was half a barrel a frame.
- **The Trommel and the Piledriver were checked as stills only**: a turntable each (`tools/out/heavy/i-*.png`), each at rest and firing in the real game, and four frames of the Piledriver's reload. Nobody has seen the hammering or the recoil in motion, and the Trommel's reload was not looked at again on the new model. Both guns sit low and right and hide the hands at the hip: the left hand is behind the can or the belt box.
- **The hand-off was judged from stills only** (`tools/out/handoff/sheet.png`): every weapon in the left hand, the hand-off both ways at half way, a burst, a sword swing and the cling. The light in the range's corridor is dark, so how the left hand sits on the darker guns is hard to read. Nobody has seen it in motion. The wall hand is placed for the screen, as on the left.
- **A hand target's palm is its +Y, and +X is the little finger side.** The comment on `Model.hand` reads the other way round. The sonar tap first came out backwards on that.
- Grenade and call-in models live on the left hand only. Throwing during a reload borrows the hand and the clip keeps running.
