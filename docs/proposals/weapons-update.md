# Plan: the weapons update

Status: being built, 2026-11-15, from the owner's notes after playing. Open details take the default written here; the owner can
overrule any of them. Names: the railgun is the **Lance** (key 7), the pump shotgun the **Shotgun** and the auto one the
**Thresher** (key 2), the rocket launcher **Rocket** and the lock-on one **Quiver** (key 3), the minigun the **Trommel** and the
HMG the **Piledriver** (key 8), the flamethrower the **Kiln** (key 9), the spear gun the **Stakegun** (key 0), the revolver the
**Judge** and the pistol the **Rivet** (key 6), the katana the **Sword** (key 5).

## 1. The Lance (railgun): a massive buff
**Built 2026-11-15.** Beam and ball modes on right click, the sustained beam, the giant ball, vaporized deaths, a 1.3 s charge with energy pulled in; see docs/notes/weapons.md, The Lance.
- **Tap** fires what today's full charge fires.
- **Full charge** is a 1 s sustained beam, like the Orbital Lance: it vaporizes and burns everything it touches.
- **Vaporized deaths**: the body goes limp, floats up off the ground and dissolves into glowing ash (the feel of a body hit by an
  energy ball in Half-Life 2, built our own way).
- **Alt fire toggles the mode.** Beam mode glows the default blue. Energy-ball mode glows green: tap fires today's tap ball;
  a full charge fires a giant slow ball that ends in a massive plasma explosion on whatever it hits.
- **Charge** is slightly slower than today, to pay for all this.
- **The charge-up** is dramatic: energy pulled into the gun from around it, the gun shaking harder and harder.

## 2. Aiming and tuning
**Built 2026-11-15.** ADS zoom about 1.5x the magnification (zoom 0.34 to 0.42, scope 20 degrees); SMG dot 0.76 mm, no ticks; pump 0.85 s and 23 a pellet; Sabot 30/60, autocannon 42/84; autocannon slam, shake 0.06 and a 7 m/s push (0.6 of it along the floor); Trommel barrels 0.74 m; Piledriver straight back; melee four off (`?melee=four`); Rivet right click bursts three (no ADS); Judge `headHops` off.

- **ADS** on every weapon that has it: narrower field of view and more zoom, so it is good for precise shots.
- **SMG sight**: a much smaller dot.
- **Shotgun (pump)**: slower fire rate, slightly more damage. Today it fires almost semi-auto.
- **Sabot and autocannon**: bigger ammo reserves.
- **Autocannon recoil**: a more dramatic barrel recoil, more screen shake, and a push back on the player, in the air too, so the
  recoil can steer movement.
- **Trommel**: longer barrels, a big gatling cannon.
- **Piledriver**: recoils straight back when firing, not tilting up.
- **Melee**: every melee weapon except the katana is switched off.
- **Rivet alt fire**: a three-round burst.
- **Judge**: the headshot ricochet is switched off (the fanning in section 5 replaces it).

## 3. Picking up a weapon gives that weapon only
**Built 2026-11-15.** `Weapons.own()` no longer adds `membersOf(base)`; the start names its members, and the Rivet and Piledriver got caches of their own.

Today a pickup unlocks its whole number key: the pump shotgun also gives the Thresher, the rocket launcher also gives the Quiver.
Every weapon is its own unlock.

## 4. New alt fires
**Rocket and Quiver built 2026-11-15.** The Rocket has no ADS: right click toggles a laser sight and rockets in flight turn toward the crosshair at 2.4 rad/s; the Quiver's right click fires all four at once, straight, in a 0.6 m square opening 0.012 rad a tube; see docs/notes/weapons.md, The Rocket's laser and The Quiver.
- **Rocket**: no ADS. Alt fire switches on a laser sight; the rocket follows wherever the crosshair points, like the AC-130's
  glide bomb.
- **Quiver**: alt fire is dumb fire: all four rockets at once, flying straight in a 2 by 2 square. No lock in this mode.
- **Stakegun**: alt fire switches to exploding bolts. A bolt sticks where it hits for about a second, then explodes. It sticks in
  enemies too, so a stuck man who runs back to his friends takes them with him.
- **Piledriver**: alt fire switches to **Raufoss** rounds. Each one bursts small where it hits, then throws a cone of 3 to 4
  pellets out the far side: through cover, or through the man it hit into the men behind him.
**Stakegun and Piledriver built 2026-11-15.** Right click on either loads the other round and back (a click, the name called out and worn on the gun's), never fires, and takes the place of their ADS. Exploding bolts stick in a wall, the floor or a man and ride him alive or dead, beep four times quickening and go off 1.1 s after, a 5.5 m, 170 grenade blast; a man with one in him runs to his nearest friend. Raufoss rounds stop on what they strike for 1.25 times the round, burst small (1.3 m) and throw four pellets of 0.4 of the round in a 0.09 rad cone out of the far side of cover up to 1.2 m thick or of the man; a reusable `Raufoss.fire` for the Sabot's mod. See docs/notes/weapons.md, Exploding bolts and Raufoss rounds.

## 5. The Judge's fanning
**Built 2026-11-15, redesigned by the owner the same day.** Right click replaces the Judge's ADS: bars of 0.4 s up to three and the rounds loaded, heads painted while it is held (0.35 s more on a man stacks another lock on him), and on release a shot a bar 0.1 s apart, locks into their heads (cover in the line takes it), the rest down the crosshair, the world at half speed if anyone was painted; see docs/notes/weapons.md, The Judge's fanning.
Hold alt fire to charge a small bar, up to three times; each charge is one bullet. On release the bar drains over about 1.5 s,
and while it drains the player paints locks on enemies' heads by looking at them. When it runs out, the Judge fans off a headshot
at every locked enemy in quick succession. Three charges, three locks at most.

## 6. The katana, a small fighting game
- **Alt fire is a thrust**: no charge, narrow, reaches further than a slash.
- **Thrust in a combo**: an enemy just out of slash range gets a short dashing stab that locks onto him, so stabs extend combos.
- **The slam is removed.**
- **Combo moves** from chains of slashes and stabs, for example: slash, slash, stab is a downward cleave; other chains give a
  tornado slash and a flying energy slash that cuts everything along its line and bursts on a wall. Default: four or five moves,
  each with a clear input and a clear look.
Built 2026-11-15, the katana: right click stabs (and dashes at a body just out of reach in a chain), the slam is gone, combos CLEAVE, TORNADO, FLYING SLASH, FLURRY; see `docs/notes/weapons.md`.

## 7. The Kiln: napalm
Not a puff of fire: an arcing hose of burning liquid, like a real M2 flamethrower. The stream arcs, splashes, sticks to the
surfaces it hits and keeps burning there.
Built 2026-11-15: an arcing hose of burning globs, splashes into pooled patches on floors and walls that burn 7 s and light anyone in them; see `docs/notes/weapons.md`.

## 8. New weapons
**Built 2026-11-15.** The **Deuce** (key 2, after the Thresher) and the **Ultramag** (key 6, after the Rivet), each its own unlock from its own cache (third and seventh); the owner's two shots wired, both barrels heard twice 22 ms apart.

- **Double-barrel shotgun** (key 2): a super shotgun. Fire shoots one barrel, alt fire both at once.
- **Ultramag** (key 6): a heavy semi-auto pistol, the hardest-hitting pistol in the game, with big knockback on targets. It
  looks like a futuristic take on a long-slide magnum pistol, with the slide visibly cycling on every shot. ADS, no special alt
  fire.

## 9. Prisoners and the drone
**Built 2026-11-15, reworked (owner):** tap E questions, hold E cuffs (the human-shield grab is off, `HOSTAGES`); 1.5 s later a drone dives past and snatches him on the line without stopping, a living ragdoll flailing under it as it climbs away (under a roof he is dragged out to the nearest clear floor first); 40/60/90/150 credits by rank into `ctx.contracts.wallet`, the feed line elsewhere; see `docs/notes/outpost.md`, Captured.
A surrendered enemy can be captured: his hands are cuffed behind his back, and a quadcopter drone flies over, lowers a hook on a
rope, picks him up and flies off with him. In modes with credits it pays: "BOUNTY SECURED".

## 10. The Crucible shop
**Built 2026-11-15.** Each break drops a supply pod (the caches' pods, 25 to 110 m off, a beacon over it, gone with the break, which is 25 s); E at it opens Procurement over the paused run, the only way in (owner, after play): kills pay Outpost Defense's rates, the caches' guns are sold from their waves (Deuce 6, Ultramag 14, Lance 18), the gun turns in a lit studio with a catalogue line; the suppressor, red dot and Sabot Raufoss mods, and lab rows for each; see `docs/notes/contracts.md`, The Crucible's shop.
- **Weapon caches stop being pickups** in the Crucible and become a shop. Kills pay credits.
- Credits buy new weapons and weapon mods. Some weapons need a minimum wave before they can be bought, like Killing Floor.
- The menu looks good: each weapon turns as a 3D model, with a short lore-style description in a deadpan, bleak, funny voice.
- **Mods** are bought and fitted in the shop, never switched in a fight:
  - SMG suppressor: +100 rpm, slightly more damage, and its own suppressed shot sound (the owner's `suppressor (1).mp3`).
  - Harrow red dot sight.
  - Sabot Raufoss rounds (as on the Piledriver; not an alt fire, because the Sabot's alt fire is its scope).
- Default: the shop is Outpost Defense's economy and shop code reused where it fits, not a second system.
- **The cheat panel** (owner, 2026-11-15) gets a row per mod to grant it and fit or remove it, so mods can be tested without the
  shop. Everything the "all weapons + infinite ammo" cheat does not hand out gets a way in from the panel.

## 11. The Gimlet, a carbine
**Built 2026-11-15.** Owner: a starter weapon between the SMG and the Harrow, good at range (the Outpost's men far off are hard to see
and hit, and the sniper costs too much) and still good up close; 800 to 900 a minute, 30 rounds, more damage than the SMG and a little
less than the Harrow; an ACOG and a suppressor by default, swappable in the shop; an M203-style launcher as a mod; the Harrow gets the
ACOG as a mod. Names offered: **Gimlet** (the tool that bores a small hole, and "gimlet-eyed": sharp-sighted), Tine, Awl.

Defaults chosen: key 1 between the SMG and the Harrow; 40 damage at 800 a minute, 30 rounds, 1.2 s reload, `falloff` 60 to 140 m to
0.75 (the SMG halves from 35 to 80), no penetration, a light climb. The ACOG is 4x the hip view (ADS zoom 0.69: 90 to 28 degrees; the
red dot is 2x, the Sabot's scope 5.7x), a sight picture in the view: the eyepiece frames the zoomed world with the world seen round
it, no black overlay. Hold R (0.3 s): bursts of three or full auto, or with the launcher fitted the launcher up or down; a tap reloads
what is in use; the mode is called under the crosshair. The launcher: one 40 mm round, 6 spare, 55 m/s with gravity, 5.5 m and 170 on
contact, 1.6 s reload. Shops: the Crucible's 450 after wave 1, Outpost Defense's 650 (primary); mods in the Crucible: Gimlet red dot
250, launcher 1,200 after wave 4, Harrow ACOG 700 after wave 2; the Gimlet's ACOG and can are issued (listed at 0, fitted, free to
take off). Not in a weapon cache (`CACHE_ORDER`): the shops are where it comes from. The owner's `m4Shot` and `suppressedM4Shot`
are its two shots and `glShot` its launcher's; the selector click is a synthesized stand-in. See docs/notes/weapons.md, The Gimlet.

## 12. AP and HP rounds, and Raufoss on a plate
**Built 2026-11-15.** Owner: AP and HP ammo mods for the SMG, the Gimlet, the Harrow, the Rivet, the Ultramag and the Judge; AP gets
through armour and plates for less on flesh, HP is devastating on flesh and very poor on armour; ball stays the default; one ammo slot
a gun beside the optic and the muzzle; bought and fitted in the shop, never in a fight; a lab row each, a catalogue line each; the
round on the HUD's name and a tint on the tracer. And a Raufoss round that strikes a man's plate bursts just behind it, inside him,
not on his far side.

Defaults chosen (every number `AMMO` in `src/weapons/data.ts`): AP 0.8 of the round, 0.75 of that through any plate (which it wears as
a heavy round does), 0.4 m more penetration (one more body). HP 1.5 of the round, stopped by any plate, wearing it by 0.15 of itself,
no penetration. A Riot's shield stops both and bosses take both as ball. The mod's `slot: 'ammo'` takes the other off its gun. Tracers
`ap` (cold blue-white) and `hp` (short dull red). Prices: SMG 400, Gimlet 500, Harrow 600, Rivet 300, Ultramag 700, Judge 600, each kind;
HP from the start, AP after wave 2. HUD: `GIMLET · AP`, `GIMLET · HP · BURST`. Raufoss: the pellets are struck into the man where
the round hit, through his plate, when his armour took the round and he lived. See docs/notes/weapons.md, Weapon mods and Raufoss
rounds.

## 13. The Awl scout and the Quiver's helix

**Built.** The Awl is an original bolt-action scout inspired by the Steyr Scout's forward long-eye-relief scope, slim synthetic
stock, integral folded bipod and short fluted barrel. No copied branding. Alternate names: **Tine**, **Rook**. It is on key 4
beside the Sabot, but an independent unlock: its own cache (eleventh), a Procurement row at 950 after wave 2 and an Outpost
Defense primary at 950. Catalogue: “Five rounds and a bolt you operate yourself. The Council has identified the missing
automation as a saving.”

180 damage, 3x headshots, five-round magazine, 50 spare, 0.8 m penetration, medium armour class, no armour bypass, no falloff,
0.95 s hand cycle and 1.65 s reload. Below the Sabot's 600 damage/5 m penetration/armour bypass. The right hand visibly lifts,
pulls, pushes and locks the bolt; the spent case ejects on the 0.30 s pull cue, not at the shot or lift. Fire-rate boosts
cannot skip the cycle, nor can a reload. Its circular scope is 32-degree FOV (3.5x at 90 degrees) versus the Sabot's 20.

Four mods, in both Procurement and the cheat panel: reusable ACOG (600), suppressor (500), AP/HP (450 each), all wave 2.
AP/HP integrate the shared API landed in `9345e6c`: mutually exclusive, 0.8x/1.5x flesh damage, AP's additional body budget
and plate rules, HP's plate stop and no penetration. Suppressed and unsuppressed shot/bolt samples are explicit stand-ins;
see audio notes. Ball uses the Sabot vapor recipe parameterized down to 28% width with fewer wisps and no shock puff.

The Quiver's simultaneous right-click salvo now braids four physical paths around one flight line: 0.7 m radius, 15 m pitch,
Validation on 2026-11-16: `npx tsc --noEmit` passes in the shared tree and isolated checkout. Ten focused files, run one at a
time, pass 145 tests: Awl 9, its model 3, helix 6, families 22, swarm 32, mods 10, ADS 11, heavy 34, vapor budget 2, shop 16.
One initial ADS hook hit the default 10-second timeout while other jobs were running; it passes with `--hookTimeout=60000`.

starting at the tube square and closing over the last 12 m to one fixed aim point. Smoke is sampled every 0.4 m, at most eight
puffs per rocket per frame, so the braid stays legible at lower frame rates. The collision/fuse/damage/blast pipeline
is unchanged. Focused tests cover bolt timing and fire-rate floor, stats, optics/mods, independent unlock, helix geometry,
swept wall impacts and projectile reuse. Captures: `tools/out/scout/`, DPR 2 at 1440×900; scripted stills only.

## Sounds

New sounds use a synthesized or existing stand-in until the owner supplies real ones. Every stand-in is listed in
`docs/notes/audio.md` so it can be swapped. Needed: Lance beam and giant ball, vaporize, double-barrel shots, Ultramag shot and
slide, Raufoss burst, sticky bolt beep and blast, napalm hose, Judge fanning, katana moves, the drone and the cuffs.

**The owner's sounds, supplied 2026-11-15** in `~/Downloads` (copy, never move; they may be WAV inside; trim lead-in silence,
set by measured loudness, credit in `docs/CREDITS.md`). Whoever builds the weapon wires its sounds:

| File | Use |
|---|---|
| `dbShotgunBlast.mp3` | Double-barrel shot. Alt fire (both barrels) plays it twice, a few ms apart, so it sounds like two triggers pulled at once |
| `ultraMagShot.mp3` | Ultramag shot |
| `stakeGunShot.mp3` | Stakegun shot (replaces today's) |
| `stakeGunStringStretchBack.mp3` | Stakegun re-cocking: the string drawn back after each shot / on reload |
| `stakeBombBeep.mp3` | A stuck explosive stake's countdown: 2 to 4 beeps, quickening, before it detonates |
| `raufossDetonation.mp3` | A Raufoss round bursting on a surface or a body (Piledriver alt fire, Sabot mod) |
| `suppressor (1).mp3` | The SMG with the suppressor mod |

## Build order
| Wave | Pieces |
|---|---|
| 1 | 1 (Lance), 2 and 3 (tuning, pickups), 6 (katana), 7 (Kiln) |
| 2 | 4 (alt fires), 5 (Judge), 8 (new weapons), 9 (prisoners) |
| 3 | 10 (the shop), which sells the new weapons and the Raufoss built in wave 2 |
