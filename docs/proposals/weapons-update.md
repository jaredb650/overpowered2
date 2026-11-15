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
- **Rocket**: no ADS. Alt fire switches on a laser sight; the rocket follows wherever the crosshair points, like the AC-130's
  glide bomb.
- **Quiver**: alt fire is dumb fire: all four rockets at once, flying straight in a 2 by 2 square. No lock in this mode.
- **Stakegun**: alt fire switches to exploding bolts. A bolt sticks where it hits for about a second, then explodes. It sticks in
  enemies too, so a stuck man who runs back to his friends takes them with him.
- **Piledriver**: alt fire switches to **Raufoss** rounds. Each one bursts small where it hits, then throws a cone of 3 to 4
  pellets out the far side: through cover, or through the man it hit into the men behind him.

## 5. The Judge's fanning
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

## 7. The Kiln: napalm
Not a puff of fire: an arcing hose of burning liquid, like a real M2 flamethrower. The stream arcs, splashes, sticks to the
surfaces it hits and keeps burning there.
Built 2026-11-15: an arcing hose of burning globs, splashes into pooled patches on floors and walls that burn 7 s and light anyone in them; see `docs/notes/weapons.md`.

## 8. New weapons
- **Double-barrel shotgun** (key 2): a super shotgun. Fire shoots one barrel, alt fire both at once.
- **Ultramag** (key 6): a heavy semi-auto pistol, the hardest-hitting pistol in the game, with big knockback on targets. It
  looks like a futuristic take on a long-slide magnum pistol, with the slide visibly cycling on every shot. ADS, no special alt
  fire.

## 9. Prisoners and the drone
A surrendered enemy can be captured: his hands are cuffed behind his back, and a quadcopter drone flies over, lowers a hook on a
rope, picks him up and flies off with him. In modes with credits it pays: "BOUNTY SECURED".

## 10. The Crucible shop
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
