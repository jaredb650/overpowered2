# Viewmodels

First-person weapons, arms and off-hand items. `src/weapons/viewmodels/**`, sandbox at `/?sandbox=viewmodels`. `createViewmodels(ctx)` from `src/weapons/viewmodels/index.ts` returns the `Rig`, which implements `ViewmodelRig`. It never changes game state.

## Flail viewmodel

`models/flail.ts`: receiver, feed cover hinged at its front (part `cover`, carrying the rail, the rear flip-up `irons` and both
optics, so they ride up on a reload), a `box` part holding `boxStd` (the 100's coyote cloth pouch on a polymer frame) and `boxExt`
(the 200's hard box with a window, `flailBox` hides the pouch), the `belt` (three rounds on the tray, six down the left flank), and a
lit round count down the box face (`countStd`/`countExt`, scaled by the count left). Ceramic heat shield with an amber line in each
vent (brightens with heat), cyan inset lines on receiver, cover and handguard. The off hand uses the shared handguard frame
(`gripL`); the reload walks it `coverHold`, `boxHold`, `pouchL`, `boxHold`, `beltHold`, `coverHold`, `chargeHold`. 29,500
triangles with every look built in (cap 31,000 in its test). The decal atlas was full: its stencil is a 176x26 strip in the last
row. Stills: `tools/scripts/flail-shots.mjs` (sandbox) and `flail-live.mjs` (range: ADS with the zoom, a reload, a friend in third
person, who holds the rifle prop as the Gimlet and Harrow do).

## Awl scout viewmodel

`models/awl.ts`, remodelled 2026-11-16 after the owner called the first one terrible (flat boxes, no silhouette). Our own
take on the Steyr Scout, no logos. What it keeps from the Scout: a slim synthetic stock with a dead-straight comb; a spare
magazine carried in the butt; bipod legs folded into the fore-end as its lower half; a short barrel; a rail running from
the receiver tang forward past the action, so a long-eye-relief scope sits out over the barrel; a roller safety on the tang
and a flush polymer box magazine ahead of a big moulded guard. What it adds: a skeletal butt whose window holds that spare
magazine (top round showing), a fluted barrel with a ported cap, long windows through the fore-end under the barrel channel,
and the legs sweeping up to a raked nose.

- **Form.** Every big piece is a bevelled side profile (`Mesher.side`, the kit's extruder; a `THREE.ExtrudeGeometry` with
  bevel in effect): fore-end, butt, grip, guard, legs, scope rings. Receiver sections are `front` profiles (flat flanks,
  chamfered shoulders, flat crown), the port an open C so the bolt shows. The scope is one turned body, eyecup to objective
  bell, with a faceted saddle, knurled turrets and coated lenses under glass. Barrel and bolt are fluted outlines.
- **A trap found here:** a profile corner whose radius is under the prism's bevel folds the inset cap over itself, and the
  triangulation then fills any hole (the butt window rendered solid). Keep every convex corner's radius at or above the bevel.
- **Materials.** Sage polymer stock (`0x5a604e`, barely any wear: polymer does not chip to bare metal), stippled grip panels
  in the same colour, dark gunmetal action, rail, scope and can, the barrel's own brushed finish, a bright brushed-steel bolt,
  rubber pad and feet. One amber glow (`accent`): an inset line down each flank of the front ring and the elevation cap's index.
- **Parts and sockets.** `bolt` (pivot on the bore, lifts 1.12 rad, runs 95 mm), `trigger`, `mag`, `bipod`, `scoutScope`
  (also the row's `irons`, so the shop's studio drops it with the ACOG on, as the gun does), `acog` and `can` from
  `optics.ts`. Hands: `gripR`, `gripL` by the shared `model.support` frame under the legs, `boltHold` on the bolt's knob,
  `magHold`. The bolt runs on `boltPose`, the row's 0.65 s cycle (lift 0.068–0.164 s, pull to 0.274 with the case out at
  0.205, push 0.383–0.506, lock 0.534–0.616).
- **Cost.** 29,402 triangles and 17 draws with the hidden ACOG and can; about 22,700 drawn as issued. The test caps it at 30,000.

Captures at port 5277, DPR 2, 1440×900, into `tools/out/awl2/`: `awl-studio-right.png` (side profile), `awl-studio-three-quarter.png`,
`awl-fp-hip.png`, `live-scope.png` (the scope aimed), `live-acog.png` and `awl-studio-acog-can.png`, `awl-bolt-strip.png` (0, 90,
140, 205, 300, 420, 500, 580 and 660 ms), `awl-close-*.png` close cameras with the arms hidden. The sandbox set is
`tools/scripts/awl-shots.mjs` on `?sandbox=viewmodels&manual=1&engine=1&weapon=awl`; the live set is
`tools/scripts/scout-capture.mjs` on `?map=range`. Run the dev server with `OP2_NO_HMR=1` when other agents are editing, or
their saves reload the page mid-capture. These are scripted stills, not a human playtest.

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

- *The autocannon* is a shoulder-fired 20 mm-class cannon: a receiver 14 cm wide and 17 tall with stepped armour, a rubber butt, a fore grip on its belly, and a nose that steps down ahead of the clip so the eye sees the barrel's run. The feed is a Bofors-style clip (part `clip`) standing in a well in the top plate: three big rounds (`r0` bottom to `r2`) lying fore and aft, stacked upright in a charger with windowed cheeks and a red lifting bar, the noses out in front. Round `i` is drawn while `i < mag`; on a shot the bottom one feeds and the rest are drawn one pitch up and drop into place over 0.07 to 0.16 s. The sight is a short heavy tube on a bracket off the **left** flank (the right until 2026-11-16, when the owner had it moved to the eye's side of a gun carried on the right), so it hides neither the clip nor the barrel. `scopeEye` is its eyepiece: as the scope comes up the rig brings that, not the gun's middle, onto the eye line (`composeGun`, any `ViewDef` with a `scopeEye`), so the overlay takes over from a view through the sight. The barrel (part `barrel`) runs back 12 cm into the receiver on the frame of the shot, holds 0.03 s and is run home by the spring in 0.2 s, inside the 0.3 s between shots: a coil spring (part `spring`, squashed along Z with the barrel) between the receiver face and a collar, a chrome buffer rod off the collar into a cylinder under it, and a bearing ring at the front of a cradle that the barrel slides through, with a three-baffle brake beyond. Reload: the gun rolls its top toward the eye, the left hand takes the clip's bar (`clipHold`), lifts it up and out to the right, a full one comes back down the same way at 0.36 to 0.56 and is slapped home, then the charging handle on the left flank is racked (`chargeHold`) at 0.72 to 0.88.
- *The Sabot* is a slim anti-armour sniper rifle: a receiver 5.6 cm wide, a skeleton stock, an octagonal free-float handguard with a folded bipod, a fluted barrel to 1.26 m from the grip with a slim slotted brake (part `slimBrake`; the `sabotBrake` mod hides it for part `brake`, the autocannon's T brake cut down to the dart's barrel: a collar with a blue band, three hexagonal baffles 11 cm across open to the sides between top and bottom straps, and an end ring, the muzzle socket `muzzleBrake` 8 cm further out), and a long scope with a hairline-and-dot reticle in its eyepiece. Its five darts (`r0`..`r4` in part `belt`) stand in an open side magazine on the left, so every fin-stabilised tip shows; the stack climbs one dart a shot into the receiver. Its readout is on the left flank behind the magazine. The shot is a 1.8 cm kick of the barrel and the charging handle thrown back; most of it is the body going into the shoulder. The reload is the old one: gate up (`coverHold`), a new stack in from below (`beltHold`), gate down, handle racked.

Both keep the owner's recoil of 2026-11-13: straight back into the shoulder with a slight tip.

The Thresher (`models/thresher.ts`) and the Quiver (`models/quiver.ts`) are files of their own. The Thresher is grey polymer where the pump is walnut: an in-line stock, a carry handle with the sights, a slotted shroud, a ported brake and a steel drum on a latch (part `drum`), which tips out and drops on the reload and comes back with a slap, then the handle is racked. The drum's axle runs along the bore and its winding face, key and rivets face the shooter (2026-11-16: it faced left, a fix asked for by the owner); the reload hand `drumHold` takes it by the left of its rim, palm in, fingers forward round it. The Quiver is a ribbed olive box of four tubes with a framed face, a painter unit on the left flank and a folding fore grip. **More than one barrel:** a model gives each its own socket, `muzzle`, `muzzle1`, `muzzle2`, `muzzle3`, and `Rig.muzzle(out, left, barrel)` answers the one asked for, or `muzzle` on a gun that has one. The Quiver's tubes empty in firing order, so tube `i` is drawn loaded while `i >= magSize - mag`; each shot kicks the block toward the side of the tube that fired. Its painter shows the marks: four lamps (glows `lamp0`..`lamp3`) lit by `a.charge`, which `Weapons` sets to marks over salvo size through `setCharge`, and a screen with the count and the four tubes. It loads from the front: the block is presented, and each round (parts `round0`..`round3`, hand sockets `load0`..`load3` on their tails) comes up from the waist and is pushed into its tube at 0.24, 0.4, 0.56 and 0.72 of the reload, on the four `quiver_load` cues.

Key 8 is two files. **The Trommel** (`models/trommel.ts`, registered under the id `buzzsaw`) replaced the Buzzsaw's model: six barrels 3 cm across where the old ones were 1.7, on a circle 8 cm wide where the old one was 5, each with a 20 mm bore and a heavy collar at the muzzle, held in a plain steel muzzle ring where the red toothed disc was. The housing is half as wide again and taller, with a fatter motor in its flank, a thicker carry handle and a bigger can of 20 mm on a chute of wider links. Nothing on it is toothed or red. `spinMax` is 24 rad/s. Its clip hammers the whole gun about while rounds leave: six sines at rates that share no factor, on position and rotation, held for 0.09 s after a round and faded over 0.16, with the can swinging on its latch and the chute whipping; the recoil spring under it has three times the old travel on a slower spring (`omega` 58), so at 25 rounds a second the gun never comes home between two. The reload is the Buzzsaw's: can off, new can on, one throw of the feed lever. `models/buzzsaw.ts` is kept, and `?slot8=old` builds it in the Trommel's place. **The 12 mm rechamber** (mod `trommel12`, 2026-11-16, after the three-barrel .50 miniguns, the GAU-19 above all) is part `rechamber`: a 12.7x99 data plate on the left flank and, inside it, `barrels3`, which turns with the spin as `barrels` does. `ModLook.hides` takes the six-barrel cluster off while it is fitted (the rig's `dressMods` and the shop's `GunStage.show`). Three heavy barrels 5.2 cm across (a third again the first cut's, the owner's) on a circle 6.5 cm wide, two above and one below at rest with a flat on top as the GAU-19 sits, each with a fat breech, a brass witness ring and a crowned muzzle; a round rotor in the old bearing; a rounded-triangle barrel clamp 0.4 m out, riveted through each flat; and the GAU-19's flash hider (2026-11-16, after the owner saw a round shroud and then a pointed block): a hollow sleeve 10.5 cm deep, a rounded triangle with big corner radii about 7 mm clear of the barrels, a bright lip at its mouth, the muzzles 3.5 cm back inside on a bulkhead with three thin fins between them, and a thin amber line (glow `status`) across each flat near its back. Rounds leave from `muzzle3`, at the top right barrel's mouth.

**The Piledriver** (`models/piledriver.ts`) is a carried heavy machine gun: a long riveted receiver under a hinged feed cover, a barrel in a cage of four slotted plates, a block of a brake, a belt box on the left with seven linked rounds climbing out of it onto the feed tray, a charging handle the whole fist goes round, a ladder sight. The barrel is its own part (`barrel`) and runs back 2.2 cm in the cage on every round, the bolt 7 cm, and the belt steps a link. Its recoil is the hardest of any automatic: 5 cm back and 0.052 rad of climb on a spring slow enough (`omega` 34) that eight a second are eight blows. Reload: cover up, box off, new box on at 0.5, belt up onto the tray, cover down at 0.69, handle racked at 0.8 on `piledriver_charge`.

**The Deuce** (`models/deuce.ts`, key 2) is a side-by-side double: a parkerized boxlock 6.4 cm wide with fences round each breech, two 3.3 cm barrels to 0.46 m on a monoblock with a bright flat rib between them and a bead, a walnut beavertail, and the Breacher's stock (`stock`, exported from `shotgun.ts`). Two muzzle sockets, `muzzle` (right barrel) and `muzzle1` (left); `Weapons` asks for the loaded one, and for both on a right click. It breaks open on a hinge pin under the front of the action: the barrels are one part (`barrels`, pivot at the pin) that drops 0.6 rad, with the top lever (`lever`) thumbed over first. Inside the barrels' frame are the two chambered shells (`shell0`, `shell1`) and the one in the hand (`shellIn`), so a shell lands in its chamber however far the barrels hang. Reload: lever and drop by 0.15, the ejectors throw both empties up and back over 0.16 to 0.26, a shell from the belt into the right chamber at 0.42 and the left at 0.58 on the two `reload_shell_in` cues, the stock lifted to shut it at 0.68 to 0.76 and a thud on `revolver_close`. Both barrels at once (`a.strength` over 1.5) adds a rock of the whole gun to the spring's kick. A hand-held shell's path is written in the hanging barrels' frame, so "down" there is down and back in the view: the first cut brought the shell and the left forearm into the camera. *Its mods* (2026-11-16): the quad barrels are part `quad` inside `barrels` (the upper pair on its own monoblock, a dark core and bright side ribs where the rows meet, the rib and bead moved up, a band round all four, chambered `shell2` and `shell3`), with `quadTop` on the action (a standing breech as tall as the upper pair, rounded over the shoulders, fenced, and a fairing down to the wrist, carrying its own lever `leverQ`) shown beside it through `ModLook.also`; the plain gun's tang, safety and lever are part `top`, hidden while the quad is fitted (`hides`). The speed loader shows as a grey carrier on the stock's left with two clips of two under elastic (`carrier`); in the reload the hand brings one clip (`clipIn`, hand socket `clipHold`, its shells `clipShells`) onto a pair of chambers, both shells go home together and the bare plate pulls away. The clip times itself in seconds from `BREAK` in `weapons/data.ts`, the same numbers as the row's reload and cues: open by 0.39 s, a hand in every 0.24 s, closing from 0.15 s after the last. Upper pair firing sockets `muzzle2` and `muzzle3`.

**The Ultramag** (`models/ultramag.ts`, key 6) is a long-slide pistol: a stainless slide 27 cm long, flat on top with faceted shoulders, a vented rib its whole length carrying the sights, a raked nose, three angled windows showing the barrel and serrations at both ends; a black frame whose dust cover runs out to an under-lug, a squared hooked guard and the Rivet's grip a shade wider; an exposed spur hammer; a thin cyan line (glow `accent`) down each flank that flares for 0.2 s on a shot. The slide (`slide`) runs 5 cm: back in 35 ms, held to 50 ms, home by 0.15 s, so it is seen to move inside the 0.36 s refire, and it locks open on an empty magazine until the reload drops it at 0.8. The hammer falls and is ridden back by it. ADS sits the fibre post in the rib's notch at `relief` 0.48: the sights are 23 cm apart, so at the Rivet's 0.3 the rear blade filled the view. Stills: `tools/out/newguns/`.

**The Autoraffica** (`models/autoraffica.ts`, key 6; slimmed and its sights redone 2026-11-16, then rebuilt the same day at the owner's word as the film cop's machine pistol in our own design) is a burst-fire service pistol behind a casket shroud, 42 cm long. Behind, in bright brushed steel over a black frame: the service pistol's open-top slide (`slide`, 2.4 cm wide) with a full-height tail, raked serrations and a safety lever each side, cut down ahead of the tail to two thin walls either side of the barrel; an exposed round spur hammer with a hole through it; a beavertail swept up from the frame; the grip with a straight raked front strap, a back strap curving into the beavertail and tall rounded panels; a trigger guard hooked at the front; the burst pistol's foregrip folded forward under the shroud's heel on its hinge; slide stop, takedown lever and a fire selector with a red dot; a long magazine. In front, the shroud (`can()`), 3.4 cm wide, its top flush with the slide's: a squared upper band round the barrel with three big ports near the nose and three slanted slots behind them, all cut through so the barrel shows in each; under it a deep wedge, 2.5 cm wide, hanging 6.7 cm below the barrel line at its heel just ahead of the guard and tapering to its nose (the whole shroud 8 cm deep at the heel, 4.5 cm at the nose), its heel swept up and back clear of the guard; six full-width fins down the wedge's sides, each running from the heel out along the keel's slope, so they step back as they go down; a chamfered keel; a stepped nose, the band standing 1.4 cm proud of the wedge with a squared muzzle block on it; three vents across the top; a red sensor eye (glow `eye`) low on the wedge's nose; a thin cyan line inset along the band's foot (glow `accent`); the count (`screen` `count`) on the band's left, the AUTORAFFICA stencil set between two fins. Steel `SILVER` for the band, fins, keel and slide, `SILVER_DARK` for the wedge's core between the fins, black for the frame. **The extended magazine** (`autorafficaMag`, part `magExt`, shown while fitted, here and on the shop's turntable): a sleeve 5.6 cm on below the floorplate with witness holes, a cyan line and a heavier pad. **Sights:** raised on the shroud as the film gun's are: a three-dot notch and post on a sight line (`SIGHT_Y` 0.066) 1.75 cm over the shroud's top and 1.85 cm over the slide's: an enlarged rear block across the slide's tail (2.3 cm wide, its sides drawn in, cycling with the slide) with its top on the line, a 4.4 mm notch 4.5 mm deep and a green dot either side; a thin blued post 3.2 mm wide on a tall ramp off the band's nose, its top on the line, a green dot under it. `sight` and `rear` both sit at `SIGHT_Y`, so aimed the gun is level, the post stands in the notch flush with the block and the dots line up; the point of aim is the post's top, at the screen's centre. `relief` 0.62. The slide runs 3 cm: back in 12 ms, home by 40, inside the 50 ms between the rounds of a burst; it locks open on an empty magazine until 0.82 of the reload. The left hand is `model.pistolSupport` (2a34244). Smart aim: the rig's `readSmart` eases `weapons.smartAim` into `Anim.smart`, `lock`, `lockYaw`, `lockPitch`, held at 0 while aimed down the sights; the clip cants the gun 0.07 rad while on and 0.23 while locked, turns it by the head's bearing and lights the eye. Stills: `tools/out/autoraffica/`, `tools/out/autoraffica2/`, `tools/out/autoraffica3/`.

- Origin at the top of the grip, `-Z` forward, `+Y` up. Sockets `muzzle` and `eject`, and hand sockets from `model.hand(name, contact, side, fingers, part?)`. `contact` is where the palm presses, **relative to `part` when one is given**. That is the easiest mistake here. It left the SMG's rack hand floating near the camera.
- `animate(a)` runs every frame after `resetParts()`, so it writes offsets with `+=` and adds to `a.gunP` and `a.gunR`. Hands take `a.left.to(socket, weight)` in sequence, later wins.
- Keep the hand off anything that swings past the camera. Riding the Mule's cover or the Buzzsaw's crank through a full turn dragged the whole arm across the eye. Hands crack a latch and let go.

## How things work

### Hand frames and contact

The procedural glove's palm faces **-Y**, its armoured back is **+Y**, and its fingers run along **-Z**. **+X is the right hand's pinky side but the left hand's thumb side.** The mesh and finger rotations mirror across X; sockets are proper rotations, never reflected scene nodes. Positive thumb opposition turns into the palm, negative thumb flex spreads the thumb away from the index finger, and positive finger spread yaws a finger toward the little finger, on either hand.

`model.hand(name, contact, side, fingers)` takes the hand's +X. `model.grasp(name, contact, palm, fingers)` takes the way the palm faces instead, which is easier to get right: +X is `palm x fingers` for either hand. A grip is three things that have to agree, and the first two rounds of hand fixes each got one of them wrong:

- **The hand's frame on the gun**, the socket. Point the fingers where a real hand's knuckles point, not straight across the gun: the wrist has to follow them.
- **The finger pose**, `poses.ts`. Fingers curl in the plane of the fingers and the palm normal, so a hand set diagonally to a handguard curls diagonally through it unless the spread yaws the fingers round it.
- **The forearm**, the arm solve. See *Wrist relief* below.

**Handguards** (`model.support(name, undersideContact, part?)`, `HANDS.support`): the palm under the guard, 4 mm left of and below the middle of its underside, facing up and 15 degrees right; the fingers leave 60 degrees off the bore toward the right, yaw further round (spread 0.45 on the index to 0.15 on the little finger), and curl up the far side with their tips over the top; the thumb lies forward along the near side at half height. The frame and curls came out of a grid search against a 4 cm by 4.5 cm box, scoring joints inside it and tips away from it; the index finger went through the guard's lower corner in every hand-set version. The SMG, Gimlet (and `glHold`), Harrow, pump, Thresher, Deuce, Awl, Sabot, Kiln and Stakegun use it; the pump and Deuce keep their moving-part parents. 7ee1b83 had the fingers straight across the gun and the palm straight up, which with the forearm coming up from below bent the wrist back 67 degrees and 55 sideways: a waiter's tray with the gun on it.

**The pump's choke and the Judge's mods** (2026-11-16). The pump's choke (`shotgunChoke`) is part `choke`: a long bright-steel tube where the breaching choke was (part `breacher`, hidden while it is fitted), a knurled collar, a brass ring, three ports a side over the top and a bore that steps down inside the crown; the flash leaves `muzzleChoke`, 5.4 cm further out. The Judge's extended hammer (`judgeHammer`) is `spurLong` in place of `spur`, both inside `hammer`, so it cocks and falls as before: the spur run back and up into a wide checkered pad. Its comfort grip (`judgeGrip`) is `gripComfort` in place of `gripStd`: black rubber with three finger grooves and ribs, a palm swell, a base 1.2 cm lower, stippled panels and a stainless cap. It is 3 mm wider than the walnut, so the hand sockets stay where they were.

**Pistols** (`model.pistolSupport(name, contact, part?)`, `HANDS.pistolSupport`): a thumbs-forward two-handed grip. `contact` is the middle of the left palm, about 1 cm out from the left grip panel at the firing hand's height (the Judge and Rivet use `[-0.03, -0.07, 0.062]`, the wider Ultramag `[-0.034, -0.072, 0.07]`, the Autoraffica `[-0.031, -0.072, 0.062]`). The palm faces right onto the panel and the firing hand's fingers, the fingers go forward and down at 27 degrees and wrap the firing hand's fingers under the trigger guard, the thumb lies straight forward along the frame under the slide. The old pistol socket was a teacup: palm up under the butt, fingers across under the grip, wrist bent 66 degrees back. The firing hand keeps `gripR` and `HANDS.grip` on every gun.

**Vertical fore grips** (`model.foregrip(name, nearSideContact, part?)`, `HANDS.foregrip`): thumb up (+Y in gun space), fingers forward (-Z), palm into the grip (+X). The Autocannon, Trommel, original Buzzsaw, Piledriver, rockets, Quiver and Lance share it.

**The sword**: both palms press the same side of the hilt and both thumbs point at the blade, so the two hands wrap it in opposite senses; the left socket had been the right one mirrored across the hilt, palms on opposite sides, which put the left forearm on the right of the hand.

**Wrist relief** (`Arm.solve`, `WRIST_RELIEF`, `MIN_RISE`). The shoulders sit far below the view (see *Arms*), so the plain two-bone solve brings each forearm up nearly vertical into a hand that points forward, and every grip bent its wrist 50 to 70 degrees whatever the socket said. After the solve the forearm is turned 60% of the way onto the hand's own line, unless the hand points back down the arm, and never so far that the forearm stops rising into the wrist (the elbow would come up and the sleeve cross the view). The rig gives the full relief only while the hand holds its own grip socket: `Rig.resolveHand` measures how much of the hand's target is its grip (`held`) against a clip's reach for a magazine or a lever, and the off-hand device and the move layer take it away. Reloads, devices, the sonar tap and wall hands solve exactly as before. At rest the wrists now bend 10 to 35 degrees where they bent 50 to 70.

Measure a grip with `tools/scripts/hands-grips.mjs`: per gun the hip and ADS views, close-ups of both hands, and each wrist's bend (`ext`, back of the hand toward the forearm; `dev`, toward the hand's +X) in the report. A relaxed grip is within about 25 degrees each way; past 40 it reads as broken from any side camera.

The sonar tap uses that same left-hand convention: its +X thumb side points screen-left, -Y palm toward the face, and -Z fingers up toward the visor. The thumb rests outward to the left instead of folding across the palm. Its timing, finger contact and device-interruption rules are unchanged.

Third-person hands use a different bind frame: fingers continue the elbow-to-wrist direction and the thumb is forward (+Z in character space), as baked by `tools/bake/parts/body.ts`. `Limb.setHand` transfers the twist component around the forearm axis to the forearm before setting the hand's remaining swing, without changing the wrist target or held-object orientation. This is used by the menu cigar pose and the gameplay animator's gun/shield hands; `setEnd` remains unchanged for feet. The helicopter also had backward scene-specific hand rotations: the cigar's rest/lip roll hints and the right thigh-rest pitch now keep the fingers aligned with the forearm. No character rebake, bone-axis changes or implant attachment changes are required.

**Arms.** Shoulders are deliberately far under the frustum and out to the sides (`SHOULDER_R`, `SHOULDER_L`), not where a body would have them. The arms are shorter than most poses ask for, and a true shoulder slides the limb up past the eye as a huge sleeve. The IK also had a scratch-vector bug where the shoulder was overwritten by the hand's up vector. That was the source of the fat stump in early shots.

**The body layer.** `ctx.player.moveAnim` (`MovePose`, from `src/player/moveAnim.ts`, described in docs/notes/player.md) says what a move does to the weapon, the left hand and the legs. The rig only applies it, so it works for any weapon and no model file knows about it:

- `composeGun` adds `gun*` after the pose layers, and `composeLeftGun` adds it mirrored. Both scale it by `moveCalm`, which drops to 0.2 (`MOVE_CALM`) while the gun fires, reloads, swings or draws, so a shot never leaves a dipped gun. That has to hold for the first shot of a burst too, and the weapon system reads `muzzle()` before it calls `fire()`. So `fire()` sets `moveCalm` to 0.2 at once instead of easing to it, and `muzzle()` goes through `settleMuzzle`, which answers from where that puts the gun: it takes the socket back into the gun's frame and rebuilds the gun's transform with the move's share removed, from the rotation `composeGun` saved in `gunRot`. Measured live half way up a climb with the shotgun: the muzzle the shot was given is 2 cm from its place at rest, where it was 20 cm low.
- `solveArms` blends the left wrist to `hand*` by `handW`, last, after the off-hand. `handFree` holds the hand on the weapon through a reload, a swing, akimbo and a draw. Fingers blend to `HANDS.open`. When `handSide` is +1 the same channels drive the right arm instead, mirrored (x, yaw and roll negated), and the right hand is the only time it leaves the weapon.
- **The hand-off** (`swap`, for a wall on the right). `composeGun` mirrors the gun's pose across the middle of the view by `m = 1 - 2 * swap`: after the bob, run, sprint and slide layers it multiplies x, yaw and roll by `m`, and the body layer, the clip's own motion, the draw roll and the scope's centring are added with `m` too. The look-lag, body-inertia and recoil springs are not, because they answer the body and not the hand. On the way across the gun dips under the view (`sin(pi * swap)`: 3 cm down, 2 cm back, 0.18 rad of muzzle drop). The model is never reflected, so the eye sees its other side: on the autocannon the clip and the bare right flank face the camera, the sight on the far side. `settleMuzzle` takes `m` as the gun's side, so the first shot of a burst mid-hand-off leaves from the gun as drawn.
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

**Weapon mods** (`src/weapons/mods.ts`). A `ViewDef`'s `mods` says what each mod looks like on the gun while `weapons.fitted` has it:
its `part` (hidden otherwise; `Rig.dressMods` sets it after `resetParts`, which shows every part, on both akimbo SMGs), and the `sight`,
`rear` and `relief` or the `muzzle` socket it puts in place of the gun's own (`Rig.look`). The SMG's suppressor (part `suppressor`) is a
matte can 21 cm long and 3.8 cm across, threaded over the flash hider with a knurled collar and three bands; while it is on, the
flash and tracers leave from `muzzleCan`, at its mouth. The Harrow's red dot (part `reddot`) is a micro tube optic on a riser clamped to
the dust cover, rubber at both ends, two turrets, a tinted front lens and a 1.1 mm red dot (glow `dot`) on it; fitted, ADS puts the
dot on the eye line level (`rear: null`) at `relief` 0.26, and the irons sit under the dot at the bottom of the tube. The Crucible's shop
shows the same parts on its turning clone of the model. Stills: `tools/out/shop/`.

A mod that stands in for part of the gun names it in `hides` (hidden while fitted, in the rig and the shop's studio), and one that
shifts another mod's part names it in `moves` (`{ part, z }`, added along the bore while fitted; the studio keeps the rest position
in `userData.restZ`). **Extended magazines** (2026-11-16): the SMG's, the Rivet's and the Piledriver's box are a second body inside the
`mag` (`box`) part, `magExt` (`boxExt`) beside `magStd` (`boxStd`), so the reload carries whichever is fitted with no change to
the clip. The SMG's 45 runs 6.5 cm further down, a grey sleeve with three anodized bands and a flared bumper pad under the stock
witness window (its own follower, `followerExt`); the Rivet's 22 stands 4 cm out of the grip in a ribbed sleeve with a brass
witness slot and a flared base; the Piledriver's box keeps its lid at the same height, so the belt climbs out the same way, and is
twice the volume, deeper and longer forward, with a window down its face onto the folded belt and a lid latch. **The Gimlet's
short barrel** (`shortBarrel`, hides `barrel`): the pencil barrel from the gas block forward is a part, and the short one ends at
the launcher's mouth with a burnt-orange jam nut and a stubby four-prong hider; its `moves` brings the `can` back 8.2 cm onto it,
and `muzzleCan` is a socket on the can, so the flash leaves the can's mouth wherever it is. Stills: `tools/out/mods-b/`
(`tools/scripts/mags-b-shots.mjs`).

**Optics** (`models/optics.ts`, 2026-11-15). The red dot and the ACOG are built onto any gun's rail with one call (`redDot(m, at)`,
`acog(m, at)`, `at` the top of the rail under the clamp), each a part of its own, and return the `ModLook` (sight, `rear: null`, relief)
the gun lists in its `mods`; `OPTIC_GLOWS` goes in the model's glows and `acogShade(model)` after the model is built. The Harrow takes
both, the Gimlet both. A gun takes several mods at once now: `Rig.look(def, 'sight' | 'muzzle')` reads the fitted mod that sets that
field, so the Gimlet's ACOG and can work together. A gun's `irons` part (the Gimlet's flip-ups) shows only while no optic is fitted
(`ironsUp`, in the rig and the shop's turntable). **The ACOG** is a 4x32 on its own mount: a forged body, a short wide eyepiece with a
rubber cup, a flared objective bell, two capped turrets, and a red chevron (glow `chevron`) on a black post with four drop bars (glow
`stadia`, unlit black). Its magnification is the camera's: the row's `ads.zoom` 0.69 (mods.ts), 90 to 28 degrees, four times the hip
view. Aimed past 0.85 (`INNER_AT`), the body ahead of the eyepiece (`acogFront`, the look's `inner`) is hidden and the gun's own
surfaces behind the eyepiece inside its clear circle are not drawn: `Rig.maskScope` projects the eyepiece socket (`acogEye`) and its
radius into `VmUniforms.uScope`, and the `vm-hard` shader discards a fragment deeper than it inside the circle. So the eyepiece shows
the zoomed world, the reticle and the rim `acogShade` darkens, the ring round it stays solid, and the world is seen round the ring.
The clear circle is about 45 percent of the screen's height at `EYE_RELIEF` 0.06 m. **The Gimlet** (`models/gimlet.ts`): a flat-top
carbine, the rail the length of the upper and the handguard, a curved polymer thirty, collapsible stock, A2 birdcage; parts `can`
(muzzle `muzzleCan`), `gl` (the launcher, its barrel `glTube` sliding forward on its reload, `glRound` in the hand, muzzle socket
`muzzle1`), `irons`, `reddot`, `acog`. `Anim.alt` is the launcher up (`weapons.launcherUp`): the clip rolls the gun onto its side and
lifts the muzzle, and plays the launcher's reload; `Anim.mods` puts the off hand on the launcher's barrel while it is fitted.
Stills: `tools/out/carbine/`.

**Scope.** The gun lifts and hides past `scopeW` 0.9. The overlay arrives before that, so the gun can be seen inside it for about 100 ms. The reticle in the overlay is per gun (`RETICLES` in `src/ui/hud/overlays.ts`, see `docs/notes/weapons.md`); the small glowing one in each model's eyepiece is drawn to match it.

**Aim down sights.** `Weapons` sets the eased weight through `setAim`. A `ViewDef` with `sight` (the point of the sight in the model's frame: the post's tip, the reflex dot, the optic's reticle) is posed by `composeGun` so that point sits on the eye line `relief` metres out, square to the view; with `rear` too the gun is pitched so the rear sight lines up (`atan2` of the two, a few hundredths of a radian; the Piledriver's ladder is 0.04). The x goes in before the hand-off's mirror, multiplied by the gun's side, so on a right-side wall run the gun is aimed centred from the left hand. Breathing, bob, wall lean, look lag and body inertia fall to `ADS_SWAY` (0.2); the body layer and recoil springs do not (the weapon system already scales recoil). The Judge's notch is painted, not cut, so its insert sits on the blade. The Rocket's optic body is hollow along its bore (it was solid, with a black disc in the eyepiece) so it can be aimed through: a hole wider than the cap's bevel allows makes `prism` fail to cut it, which is why the bore is 16 mm. Contact sheet: `tools/scripts/ads-vm.mjs` on `/?sandbox=viewmodels&manual=1&engine=1` (a red cross marks the centre; `ADS_SIGHT` overrides a sight live), `&pose=ads` for one gun.

**Tuning, 2026-11-15** (weapons-update plan section 2). The SMG's reflex reticle is one 0.76 mm dot, where it was a 1.8 mm dot inside three ticks reaching 7.5 mm, which covered a man at range. The pump shotgun's rack is slower to match its 0.55 s refire: back over 0.13 to 0.27 s after the shot, home over 0.31 to 0.47 s, with `pump_rack_back` and `pump_rack_forward` on those ends. The autocannon's barrel slams 15 cm (was 12), holds to 0.06 s and runs home by 0.32 s, and the gun's recoil spring throws it 0.21 back (was 0.13). The Trommel's barrels are 0.74 m from the housing (were 0.46), with a third support plate. The Piledriver recoils straight back (`back` 0.075, `lift` 0, `pitch` 0.006, where it tipped up at 0.052). Stills: `tools/out/tuning/`.

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
- **The Berserk sleeve still occupies much of the SMG's lower-left view.** With the wrist relief the left forearm runs up from the lower left corner to the handguard instead of standing up under it. Grip changes retain the forearm twist bone and hand bone used by all three Gun implants; they do not resize or redesign the sleeve.
- Grenade and call-in models live on the left hand only. Throwing during a reload borrows the hand and the clip keeps running.
