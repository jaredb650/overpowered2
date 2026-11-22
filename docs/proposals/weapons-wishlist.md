# Weapons wishlist (2026-11-22)

Status: **the owner's dictated list, written down, plus suggestions. Nothing here is built.**
The owner reads this and picks. Sections 1 to 3 are the owner's own asks. Section 4 is suggestions only.
Section 5 is the open questions. Section 6 is the build order.

**Who builds it.** Owner decision, 2026-11-22, passed on by the coordinating agent: "Neon" (the owner's name for Google's
Gemini model) builds this whole plan end to end, visuals included. The rule "visual work only by Claude agents" is lifted
**for this plan only**. `CLAUDE.md` still carries the old rule for everything else until the owner changes it there.

How to read it:

- **Asked** is what the owner said, in plain words. It is not watered down.
- **Maps to** is where it lands in the game: the weapon id, the slot, the existing mod to copy, and any clash with a rule.
- **Starting numbers are mine, not the owner's**, unless the line says "owner". They are a first guess for the builder.
- Shop waves are the Crucible's. Endless Humans halves them and caps them at break 9 (`lockWave` in
  `src/contracts/shop/data.ts`), so everything here unlocks before round 10. The Endless Humans break is in brackets.
- This supersedes nothing. `docs/proposals/weapon-ideas-backlog.md` (2026-11-17) already holds the riot shield, the
  microwave gun and the Stakegun ammo ideas. This file adds the owner's new detail to them.

Every new mod, weapon or chip needs the six things in `CLAUDE.md` ("Adding a weapon mod / weapon / brain chip / implant"):
shop row, cheat-panel row, test, first-person model **and** shop studio model, notes, and the co-op rows.

Game rules that shape this list:

- Bullet weapons have no spread. No item here uses spread as a lever on a bullet gun.
- Shotguns keep their spread. The three shotgun spread changes below (sawed-off, Deuce long barrel, slugs) are
  **owner-asked**.
- Bullets are instant in this game (no flight time). So "faster bullets" on a rifle shows as longer reach, more
  penetration and a longer tracer. Rockets, shells and grenades do fly, so "faster" is real for them.
- Mods are fitted in the shop. Two mods in the same slot exclude each other. Different slots stack.

---

## 1. The owner's list, by weapon

### Key 1: the rifles

#### Gimlet (`gimlet`) — 9 mods today
ACOG and suppressor (both issued fitted), red dot, grenade launcher, short barrel, AP, HP, +P, weapon light.

**Long barrel**
- **Asked:** very slightly slower fire rate, more damage, more armour penetration (faster bullets). With AP rounds it
  should absolutely shred armour. The model is not just a longer pencil barrel: the handguard gets longer too, like an
  AR-15 with a long handguard.
- **Maps to:** `barrel` slot, so it swaps with the existing Short barrel (`gimletShort`). Copy the Awl's Extended barrel
  (`awlBarrel` in `src/weapons/mods.ts`): that one already has the rule "with AP fitted, the round goes through plates as
  if they were not there". Starting numbers: 800 to 760 rounds a minute, damage 40 to 48, one more body or sheet of cover
  (+0.4 m), full damage out to 90 m instead of 60. Plain rounds break a plate the way the Harrow's do. With AP
  (`gimletAp`), plates do not count at all. The suppressor must still screw on, and the launcher must still hang under
  the longer handguard.

#### Harrow (`harrow`) — 7 mods today
Red dot, ACOG, AP, HP, +P, API, weapon light. It has no barrel, muzzle or magazine mod yet.

**Short barrel**
- **Asked:** higher fire rate.
- **Maps to:** `barrel` slot. Copy the Gimlet's Short barrel (+15%). 600 to 690 rounds a minute.

**Muzzle brake**
- **Asked:** very slightly higher fire rate.
- **Maps to:** `muzzle` slot, so it stacks with the short barrel. Copy the Sabot's brake (`sabotBrake`), much smaller:
  +5%, 600 to 630. Both together: about 725 a minute.

**Extended magazine, 40 rounds** (owner's number)
- **Maps to:** `mag` slot. Copy the SMG's (`smgMag`): more rounds and nothing else. 24 to 40.

#### Flared magwell — Harrow, Gimlet, Ultramag (and the Rivet, see section 2)
- **Asked:** slightly faster reload.
- **Maps to:** `loader` slot, the slot the SMG's Mag tape uses (that one is 30% faster). Starting number: 15% faster.
  Harrow 1.35 to 1.15 s, Gimlet 1.02 to 0.87 s, Ultramag 1.3 to 1.1 s. Build it once as a list of guns, the way the
  weapon light is (`LIGHT_GUNS`), so another gun joins by adding its name. It must be worked out last (`adjust`), so it
  stacks with extended magazines and with akimbo's doubled reload. Look: a funnel at the bottom of the grip or the
  magazine well, in a second material.

#### Flail (`flail`) — 7 mods today
Red dot, ACOG, large box (200), AP, HP, +P, API.

**Heavy barrel**
- **Asked:** replaces the fore-end with a chunkier one, a futuristic mix of the M60 and the MG42. It must look badass and
  insane. Higher fire rate, damage and armour piercing.
- **Maps to:** `barrel` slot (new for the Flail). Starting numbers: 800 to 880 rounds a minute, damage 36 to 44, goes
  through as much cover as the Harrow (0.2 to 0.5 m), and breaks plates the way the Harrow does. The model swaps the whole
  front of the gun (`src/weapons/viewmodels/models/flail.ts`): a square slotted shroud with a heavy fluted barrel showing
  through it, a folded bipod, a carry handle, a big flash hider. Inspired by those two guns, not a copy of either. The
  shop studio model must swap too. If it is too strong once played, the levers are draw time, aim time and climb.

**Enhanced stock**
- **Asked:** the same effect the SMG's stock has.
- **Maps to:** the SMG's Stock (`smgStock`) makes the held-breath focus zoom (Shift while aiming) last 60% longer, 3.5 to
  5.6 s, and cool down 30% sooner, 2.5 to 1.75 s. Same patch on the Flail. No slot, as on the SMG.

### Key 2: the shotguns

#### Pump shotgun (`shotgun`) — 3 mods today
Choke, weapon light, flechettes.

**Sawed-off barrel**
- **Asked:** magazine down to 4, wider spread, more damage per pellet. Nasty up close, wimpy far away.
- **Maps to:** `barrel` slot (new for the pump). Starting numbers: 6 shells to 4 (owner's number), spread 0.05 to 0.085,
  pellet damage 26 to 34, and damage falls off from 9 m to 30% at 26 m (the Deuce's rule). The Choke narrows the cone, so
  the two should exclude each other: a sawn barrel has nothing to screw a choke into. Owner-asked spread change.

**Greased bolt**
- **Asked:** faster rack.
- **Maps to:** copy the Awl's Greased bolt (`awlBolt`, the `GREASE` number): the whole pump cycle, its sounds and the
  model's pump at 75%. 0.55 s a shell to 0.41 s. Do not go under 0.4: the owner found 0.3 "near semi-auto" on 2026-11-15.

#### Thresher (`thresher`) — 2 mods today
Weapon light, flechettes.

**Dragon's breath**
- **Asked:** sets enemies on fire, sprays sparks everywhere, should look like real dragon's breath.
- **Maps to:** `ammo` slot, so it swaps with flechettes. A new kind of round beside `flechette` and `api` in `AMMO`
  (`src/weapons/data.ts`). A pellet that reaches flesh sets the man alight (API rounds do it one time in eight; this
  should be nearly every time, burning about 4 s). Burning already chars skin and breaks human morale (gore update).
  Look: a long tongue of fire and a wide shower of burning sparks out to about 20 m, sparks that bounce and lie
  glowing, scorch marks, and the flash lights the room. It needs its own tracer and a co-op row so teammates see the
  fire. The same mod is on the new shotgun in section 3. See Q9 for the other shotguns.

#### Deuce (`deuce`) — 4 mods today
Quad barrels, speed loader, weapon light, flechettes.

**Long barrel**
- **Asked:** tightens the spread. Must change the look of both the dual-barrel and the quad-barrel setups.
- **Maps to:** the Quad barrels already sit in the Deuce's `barrel` slot, and this has to stack with them, so it needs a
  slot of its own (a new `length` slot) or no slot. Starting numbers: spread 0.075 to 0.05 (the pump's), and damage holds
  to 14 m instead of 9. Two models: long double and long quad, in first person and in the shop studio
  (`src/weapons/viewmodels/models/deuce.ts`). Owner-asked spread change.

### Key 3: the launchers

#### Rocket launcher (`rocket`) — 0 mods today

**Longer tube**
- **Asked:** faster rockets, more damage.
- **Maps to:** `barrel` slot. Rocket speed is one shared number today (`TUNING.rocket.speed`, 40 m/s), so the mod needs
  a per-gun field, as the MGL has for its grenade. Starting numbers: 40 to 56 m/s, damage 100 to 130. The laser guidance
  turn rate should rise with the speed so steering feels the same.

**White phosphorus rockets**
- **Asked:** once fitted, hold R to switch to WP rockets. On explosion they leave a white phosphorus cloud that burns
  enemies walking through it.
- **Maps to:** the hold-R ammo switch already exists (`altAmmo` with `hold`): the MGL's Sticky Bomb and the Piledriver's
  Raufoss use it, and a tap of R still reloads. Right click stays the laser. The mech's Mortar Rack already has a WP
  round (`src/frame/shoulders/mortar.ts`): a white-hot burning patch built on the Kiln's fire (`src/weapons/Flames.ts`)
  with a white smoke plume. Reuse that. The difference is that the owner asks for a **cloud**, not a patch on the floor:
  it should catch men at chest height and on stairs, so it needs a check in the air, not only on the ground. Starting
  numbers: a small blast, then a cloud 6 m across for 12 s; anyone inside catches fire.

#### MGL (`mgl`, shop name "MILKOR MGL") — 1 mod today
Sticky Bomb.

**Long barrel**
- **Asked:** faster projectiles, more direct-hit damage.
- **Maps to:** `barrel` slot. Grenade speed 52 to 70 m/s (a flatter arc), direct hit 70 to 105. The blast stays as it is.

**Enhanced trigger**
- **Asked:** faster fire rate.
- **Maps to:** a new `trigger` slot or no slot. 0.36 s between shots to 0.27 s.

#### Howitzer (`howitzer`) — 0 mods today

**Cluster shell**
- **Asked:** the shell bursts at a standoff distance from a surface and throws a cone of bomblets that carpet an area
  with small explosions. Crowd control. Reuse the mech's cluster bomb launcher.
- **Maps to:** the mech's Bomblet Cannon is built (`src/frame/arms/cluster.ts`), and its carpet is one shared function,
  `bombletCarpet` in `src/frame/bomblets.ts`. The mech's numbers: bursts 7 m short, 28 bomblets over 14 m by 9 m, each a
  2.4 m blast for 70, going off in a ripple over 0.7 s. The howitzer calls the same function with a smaller sheet (start
  at 18 bomblets over 10 m by 7 m). The standoff fuze is the autocannon flak shell's (`src/weapons/flak.ts`). Whether
  every shell is a cluster shell or hold R switches is Q4.

### Key 4

#### Autocannon (`autocannon`) — 1 mod today
Flak shells.

**Longer barrel**
- **Asked:** faster projectile, more direct-hit damage.
- **Maps to:** `barrel` slot. Shell speed 200 to 280 m/s. **Clash:** a direct hit already kills any normal enemy outright
  (damage 99999). More direct damage can only show on bosses, vehicles and the mech, where a hit counts as 900
  (`bossHit`). Starting number: 900 to 1150 there. With flak shells fitted there is no direct hit at all, so the barrel
  would only add speed. See Q5.

### Key 6

#### Revolver = the Judge (`judge`) — 7 mods today
Extended hammer, comfort grip, AP, HP, +P, weapon light, akimbo.

**Extended barrel**
- **Asked:** more damage.
- **Maps to:** `barrel` slot. 120 to 150.

**Compensator**
- **Asked:** speeds up the fan charge.
- **Maps to:** `muzzle` slot. The fan fills one bar every 0.4 s today, and the Extended hammer already makes that 0.28 s.
  The compensator stacks on top: 20% faster again, so 0.32 s alone and 0.22 s with the hammer. Akimbo takes the fan
  away, so with akimbo the compensator does nothing. Suggestion: also give it a little less muzzle flip, as the
  Ultramag's has, so it is never dead weight.

### Summary of the new mods

| Mod | Gun | Slot | Starting numbers | Price, wave (EH break) |
|---|---|---|---|---|
| Long barrel | Gimlet | barrel | 760 rpm, 48 damage, AP ignores plates | 900, wave 5 (3) |
| Short barrel | Harrow | barrel | 690 rpm | 850, wave 4 (2) |
| Muzzle brake | Harrow | muzzle | 630 rpm | 500, wave 3 (2) |
| Extended magazine | Harrow | mag | 40 rounds | 450, wave 3 (2) |
| Flared magwell | Harrow, Gimlet, Ultramag, Rivet | loader | reload 15% faster | 300, wave 2 (1) |
| Heavy barrel | Flail | barrel | 880 rpm, 44 damage, Harrow's penetration | 1400, wave 10 (5) |
| Enhanced stock | Flail | none | focus 5.6 s, cooldown 1.75 s | 400, wave 7 (4) |
| Sawed-off barrel | Pump | barrel | 4 shells, wide cone, 34 a pellet, short reach | 500, wave 2 (1) |
| Greased bolt | Pump | none | 0.41 s a shell | 500, wave 3 (2) |
| Dragon's breath | Thresher | ammo | sets men alight | 1000, wave 5 (3) |
| Long barrel | Deuce | new slot | tighter cone, longer reach | 700, wave 7 (4) |
| Longer tube | Rocket | barrel | 56 m/s, 130 damage | 900, wave 6 (3) |
| WP rockets | Rocket | none (hold R) | burning cloud, 6 m, 12 s | 1600, wave 9 (5) |
| Long barrel | MGL | barrel | 70 m/s, 105 direct | 800, wave 8 (4) |
| Enhanced trigger | MGL | trigger | 0.27 s a shot | 700, wave 7 (4) |
| Cluster shell | Howitzer | none | bomblet carpet | 2000, wave 11 (6) |
| Longer barrel | Autocannon | barrel | 280 m/s, 1150 on bosses | 1200, wave 7 (4) |
| Extended barrel | Judge | barrel | 150 damage | 700, wave 4 (2) |
| Compensator | Judge | muzzle | fan 20% faster | 700, wave 5 (3) |

Twenty-two new mod ids here (the magwell is four, the Rivet's among them). The Rivet's other four in section 2 make 26.

### Progression: missions beaten twice

- **Asked:** once a mission has been beaten twice, the player may still only pick the SMG, Gimlet or Harrow as primary,
  but can configure its mods freely, with no point limit.
- **Today:** before a mission the menu shows three cards, SMG, Gimlet or Harrow (`src/contracts/starter.ts`,
  `src/ui/screens/starter.ts`). There is no mod choice and **no point system anywhere on that screen**. A mission gives
  only the issued mods (the Gimlet's ACOG and suppressor, the SMG's light), or a fixed kit the mission sets
  (`Loadout.mods` in `src/campaign/types.ts`; the stealth mission does this). Missions have no shop. The only budget
  screen in the game is Outpost Defense's (`src/ui/screens/loadout.ts`).
- **Today, wins:** the game saves one flag, "the campaign was beaten" (`op2_campaign_beaten` in
  `src/contracts/unlocks.ts`), set by The Outpost only. It does not count wins and does not know which mission.
- **The change:** count wins for each mission (a new saved number per mission, added to the reset list in
  `src/contracts/firstLaunch.ts`). After the second win of a mission, its starter screen gets a second step for the
  picked gun: every mod that gun has, free, fit any that do not share a slot, no cap. The choice is saved per gun. It is
  handed to the mission at the start and at every checkpoint (`missionWithStarter` in `src/campaign/starter.ts` already
  rewrites the kit for each checkpoint). In co-op each player chooses their own, and teammates must see the fitted mods.
- See Q6: the words "no point limit" can be read two ways.

---

## 2. Fixes and look changes

### Rocket launcher: the laser sight is glitchy when walking
- **Asked:** replace it with a copy of the Ultramag's laser pointer, which is subtler and consistent.
- **Maps to:** the Rocket's laser is a world effect drawn from the muzzle during the weapons update
  (`Weapons.updateLaser`, `fx.beam(..., 'laser')`), before the camera has moved for that frame. That is the likely cause
  of the wobble (not measured). The Ultramag's laser (`src/weapons/viewmodels/lam.ts`) is placed as the frame is drawn
  and never leaves the centre pixel. Fix: draw the Rocket's line and dot with the same code. Keep the guidance
  (`ROCKET_LASER`) as it is. The Ultramag's laser only reaches 40 m; the Rocket's guides out to 400 m, so its dot needs
  the longer reach. Right click still toggles it.

### MGL: the reload animation is broken and looks bad
- **Asked:** fix it.
- **Maps to:** `clip()` in `src/weapons/viewmodels/models/mgl.ts`. I have not seen it in motion; the builder should take
  a motion sheet first (`tools/sheet.mjs`). Two things stand out in the code. The reload rolls the gun about 20 degrees,
  and the house rule is "no rolling or twisting in gun animations". And the sound plays three shell clicks for six
  shells while the rounds simply vanish and come back as a group. A fix should open the drum, drop the empties, and
  seat shells the hand actually carries, with no roll.

### Ultramag: the reflex sight is too chunky and blocks the view when aiming
- **Asked:** lower profile, but still a realistic sight, not just thinner.
- **Maps to:** `reflex()` in `src/weapons/viewmodels/models/ultramag.ts` (mod `ultramagDot`). Its own comment calls it
  "a chunky reflex sight", and it sits 14 cm from the eye. Rebuild it as a real low-deck open reflex sight: a thin
  frame, a short hood, the deck sunk into the slide, the same window width. It rides both slides in akimbo. The Rivet's
  new sight (below) should share the part.

### Awl: the crosshair
- **Asked:** replace the white crosshair with a dot by a fine, simple black crosshair, like Counter-Strike scopes.
- **Maps to:** `RETICLES.awl` in `src/ui/hud/overlays.ts`, colour in `src/ui/css/overlays.css` (`#e0e6cb` today). New:
  thin black lines, thick black posts at the rim, no dot, no range ticks. One thing to check on dark maps: black on a
  dark wall can vanish. Check it on the darkest map before calling it done.

### Howitzer: the standard shell's explosion needs more fire
- **Asked:** it already feels powerful but looks like dust. It needs more fire.
- **Maps to:** the howitzer uses the `finisher` explosion look (`src/fx/recipes/explosions.ts`): white fire, dust on, no
  embers, a cold blue light. The Black Sun, the sword wave and aircraft crashes use the same look, so **do not change
  `finisher`**. Give the howitzer its own explosion kind: a rolling orange fireball, burning debris, embers, flames that
  linger a moment, with the dust behind it. The mech's 105 mm arm (`src/frame/arms/shared.ts`) should take the same new
  look. Keep it clearly smaller than the mech missile's big blast (`megaBlast`).

### Rivet: remodel (proposal) and five new mods
- **Asked:** make it look like a Beretta 92FS / M9: slimmer, less blocky, sleek, some swagger. Give it all the Ultramag's
  mods: compensator, suppressor, red dot, flared magwell, laser, weapon light.
- **Maps to:** `src/weapons/viewmodels/models/rivet.ts` (a blocky polymer service pistol today, a light model at
  5.2k triangles). The look to aim for: an open-top slide with the barrel showing, a ring hammer, a slim
  curved grip, a rounded trigger guard. See Q1 for how close a real gun may be copied.
- The Rivet has 6 mods today: extended magazine, AP, HP, +P, weapon light, akimbo. It already has the light. **New:**
  compensator and suppressor (both `muzzle`, so one or the other), reflex sight, flared magwell, laser. Copy each from
  the Ultramag's (`ultramagComp`, `ultramagCan`, `ultramagDot`, `ultramagLam`): the compensator is 15% faster with under
  half the muzzle flip, the suppressor is a quieter report (it needs a suppressed Rivet sound), the reflex sight is the
  look, and the laser module fires 25% faster. The laser's beam is `lam.ts`.
- The film gun behind the Autoraffica was built on a pistol of this same family. So build this pistol once, and the Auto
  Raffica below can share its back half.

### Autoraffica (`autoraffica`): remodel
- **Asked:** the current one looks alien and too swoopy. It should look as much like the original RoboCop gun as
  possible, ideally in black. The owner: "We should have tried having Neon model the Auto Raffica."
- **Who builds it:** Neon (Google's Gemini model), by the owner's decision above.
- **Maps to:** `src/weapons/viewmodels/models/autoraffica.ts`. It was restyled twice on 2026-11-16 (commits `aecc3d53`
  and `d79356c3`, "the full Auto 9 treatment"): today it is bright brushed steel over a black frame. The ask now is black
  all over and closer to the film gun's shape: a long squared barrel shroud with big ports, a deep finned block under it,
  tall sights. Keep the smart-aim sensor eye, the slide cycle and the pistol hand grip (`model.pistolSupport`). See Q1.
- **Reference photos:** not found. I searched the repo, `docs/`, the git log and this machine. The two earlier restyles
  left stills in `tools/out/autoraffica2/` and `tools/out/autoraffica3/`, which are not in git and exist only on the
  owner's Mac. No photo of the real prop was ever committed. See Q2.

### Autoraffica: smart-gun rework (it is too strong)
- **Asked:** click and hold. Each head inside the circle gets "painted" after a tiny charge-up, with a beep per mark.
  Once no new head is detected in the circle, it locks onto each painted target in sequence and full-auto drills their
  heads, snapping to the next, until out of ammo or all dead. One target: beep, then it shoots him in the head. More
  targets: a longer paint time. You must keep heads in the circle while painting.
- **Akimbo:** the second crosshair is hidden in the middle until marking starts. Then it appears and hovers over the
  heads. It is visible only while marking or shooting.
- **Today:** hold R switches smart aim on. The nearest head in the circle is locked at once, with no wait, and a held
  trigger is full auto into it, handing on to the next head as each man dies (`src/weapons/smartaim.ts`,
  `Weapons.updateSmartFire`). There is no paint time, so a room dies for free. That is the "too strong".
- **Maps to:** this is the Judge's fan (paint heads while holding, `src/weapons/fan.ts`) joined to the mech's Metal Storm
  Pod, which already paints several targets and then snaps a burst from one to the next
  (`src/frame/shoulders/storm.ts`, `Painter` in `src/weapons/swarm.ts`). The lock brackets on heads exist
  (`src/ui/hud/locks.ts`). Rounds to a head are `Combat.fireAtHead`.
  - Paint: one head at a time, the one nearest the crosshair first. Starting number 0.25 s a head. A head that leaves
    the circle or goes out of sight while charging loses its charge. A beep a mark, a step higher each time.
  - Fire: when every head in the circle is marked, it fires by itself: full auto at 800 a minute into head one until he
    is dead, a short snap to head two, and on, until all are dead or the magazine is empty.
  - Levers for balance (none is spread): the paint time, the circle's size (8 degrees today), the range (70 m), the most
    marks at once, and the snap time between heads.
  - Akimbo: the left gun's crosshair is `updateTwin` in `src/ui/hud/crosshair.ts`. Today it shows all the time smart aim
    is on. Hide it until marking starts. The two guns take marks in turn and fire at their own heads together.
- The tests are `src/weapons/autoraffica.test.ts` and `akimbo.test.ts`; both need rewriting to the new rules. The shop
  line ("Hold R and it finds the head for you") changes with it. See Q3.

---

## 3. New weapons

Names are proposals in the catalogue's own style (farm and workshop tools: Harrow, Thresher, Flail, Awl, Gimlet, Kiln).
No real name or trademark is used in the game. See Q10.

### "BILLHOOK": the semi-auto combat shotgun (SPAS-12 inspired)
- **Asked:** the pump action, but semi-auto (no rack), with the real SPAS-12 tube capacity and the pump's damage. A
  strict upgrade. Mods: reflex sight, laser sight, weapon light, extended tube, dragon's breath, flechette, slugs (one
  pellet, huge damage).
- **Maps to:** a new member of the key 2 family (`base: 'shotgun'`). The pump's shell exactly: 6 pellets of 26, the
  pump's cone (0.05), so nothing about shotgun spread changes. Semi-auto, about 0.26 s between shots where the pump
  needs 0.55. The real gun's full-length tube holds **8**, so 8 shells, loaded one at a time. Price above every other
  shotgun, since it is a strict upgrade: about 1800 at wave 9 (Endless Humans break 5).
- The name: a billhook is a hooked farm blade, and the real gun is known for the hook on its folding stock. Other
  options: MATTOCK, WINNOW. The model is our own: a heat shield with slots over the barrel, a fat tube under it, a
  folding stock with a hook. The mech already carries a shotgun in this style (`src/frame/models/shotgun.ts`), useful as
  a look reference, not as a part.
- Mods:

| Mod | Slot | What it does |
|---|---|---|
| Reflex sight | sight | The look, and a clear dot when aimed |
| Laser sight | none | The Ultramag's laser code (`lam.ts`). What it adds beyond the dot is the builder's first guess: a quicker aim time |
| Weapon light | none | Joins `LIGHT_GUNS` |
| Extended tube | mag | 8 to 11 shells |
| Dragon's breath | ammo | Same round as the Thresher's |
| Flechettes | ammo | Joins `FLECHETTE_GUNS` |
| Slugs | ammo | One projectile for about 200 (the six pellets together are 156), breaks plates as the Judge does. One projectile, so it flies true like every bullet. Owner-asked |

### "BODKIN": the flechette rifle (Steyr ACR inspired)
- **Asked:** a new weapon for the assault-rifle slot, inspired by the Steyr ACR. 24-round magazine, semi-auto plus
  3-round burst, the burst at about 1200 rounds a minute. The owner: "we have enough assault rifles", so this is the only
  new rifle in this plan.
- **The real gun:** an Austrian prototype from 1987, tested in the US Army's Advanced Combat Rifle trials of 1989 and
  1990. A bullpup with a rounded plastic body, the barrel covered almost to the muzzle, and an optic as standard on a
  tall rib. A 24-round see-through plastic magazine. It fired a steel dart in a plastic case: the dart 0.66 g, 1.6 mm
  thick and 41 mm long, leaving at about 1,450 m/s, half as fast again as a normal rifle bullet. Semi-auto and a
  three-round burst at 1,200 a minute. 3.2 kg empty, 78 cm long. The chamber slid up and down instead of a bolt, and the
  empty case was pushed out of a port in front of the magazine. No rifle in the trials beat the M16 by enough to win.
- **Maps to:** a new member of the key 1 family (`base: 'smg'`), placed after the Harrow. A bodkin is a needle, and also
  the old armour-piercing arrowhead. Starting numbers:

| | Bodkin | For scale |
|---|---|---|
| Magazine | 24 (owner, and the real gun's) | Harrow 24 |
| Fire | Three-round burst, or one a pull. Hold R switches, as on the Gimlet (`select`) | |
| Burst rate | 1,200 a minute (owner, and the real gun's): three darts in a tenth of a second | Gimlet 800 |
| Between bursts | 0.25 s | |
| Damage | 38 a dart, 114 a burst | Gimlet 40, Harrow 60 |
| Armour | Plates and riot shields do not stop it, like the Sabot's dart | Harrow breaks plates |
| Goes through | About four men in a line, or an inner wall (1.6 m) | Harrow 0.5 m |
| Range | Full damage at any range | Gimlet fades past 60 m |
| Bleed | A dart in flesh bleeds, as the shotgun flechettes do | |
| Limbs | Takes none off. Almost no shove, so a hit does not stagger | Harrow takes limbs |
| Reload | 1.2 s | Harrow 1.35 s |

- **How it fits:** it is the armour and long-range specialist of key 1. Against a bare crowd it is the weakest rifle:
  about 325 damage a second held on the trigger, where the Gimlet does 530 and the Harrow 600. Against plates, shields,
  men standing in a line and anything far away it is the best, because none of those cost it anything. One burst kills
  an armoured Gunner. It has no full auto and only eight bursts a magazine, so it rewards aim, not holding the trigger.
  The burst goes exactly where the crosshair is: no spread.
- **Look:** our own bullpup. A smooth rounded shell in pale polymer with a darker frame, a tall rib along the top with a
  low-power sight built in, a clear magazine behind the grip where the darts can be seen counting down, and spent
  plastic cases dropping out of the bottom ahead of the magazine. A thin needle tracer (the `flechette` tracer exists).
- **Suggested mods:** a 4x optic in place of the built-in sight (`sight`); extended magazine, 24 to 36 (`mag`);
  five-round burst (burst of five at the same rate, a longer wait after); tungsten darts (`ammo`: twice the wall
  penetration and more against bosses and vehicles); weapon light; flared magwell. It takes no AP, HP or +P: it is
  already the AP gun.
- **Shop:** about 1500 at wave 8 (Endless Humans break 4). It is not one of the three starter guns.
- Sources for the real gun: [Wikipedia, Steyr ACR](https://en.wikipedia.org/wiki/Steyr_ACR),
  [The Firearm Blog](https://www.thefirearmblog.com/blog/2016/06/10/steyrs-acr-80s-era-teutonic-wonderwaffe-havent-heard),
  [Forgotten Weapons](https://www.forgottenweapons.com/steyr-acr-a-polymer-flechette-firing-bullpup-from-the-90s/).
  Sources disagree on the weight (3.2 to 3.9 kg) and on the sight's power.

### "AUTOCLAVE": the microwave gun
- **Asked:** an invisible microwave pulse that boils enemies from inside until they explode. An energy weapon. It sits
  under the Lance.
- **Already noted** in the backlog as the owner's favourite: enemies stagger, scream, swell, then pop; slow and
  horrible; its own gore (burns, steam, boiling, a pop).
- **Maps to:** I read "under the Lance" as: on key 7 beside the Lance, cheaper and earlier. A held stream like the Kiln's
  (`mode: 'stream'`). Each man in the cone has his own heat. It rises while he is in the cone and falls when he is not.
  At a third he staggers and steams; at two thirds he drops his gun, screams and swells; at full he bursts
  (`Gore.gib`, and the organs that burst from the gore update). Microwaves go through plates, so armour does not help
  him: it is the slow answer to armoured men and useless for a quick kill in a crowd. The gun itself shows nothing but a
  heat shimmer (the shimmer layer exists, `src/fx/layers/shimmer.ts`) and a rising hum. The show is on the target. See
  Q8. An autoclave is the pressure steamer that sterilises instruments. About 3400 at wave 14 (Endless Humans break 7);
  the Lance is 4500 at wave 18.

### Riot shield: a mod for pistols
- **Asked:** the shield blocks most of the view, with a tiny viewing hole. You can still shoot. It protects from
  incoming fire. It has an arm-fatigue meter: taking lots of fire fills it, and when it is full you drop the shield, the
  way players can shred enemy riot shields.
- **Already noted** in the backlog: one mod that fits any pistol, you lose aim-down-sights, it excludes akimbo, a shield
  bash is possible.
- **Maps to:** one mod built as a list of guns (Rivet, Ultramag, Judge, Autoraffica), like akimbo (`AKIMBO_GUNS`). It
  takes the `sight` slot, as akimbo does, which is what makes the two exclude each other. The shield fills most of the
  screen with one small armoured window, and the pistol fires round its edge. Fire from the front is stopped and fills
  the meter instead of hurting. Blasts, flanks and anything from behind are not stopped. When the meter is full the arm
  gives out: the shield drops and comes back after a cooldown. The enemy Riot's shield works differently (it goes when
  his shield arm comes off, and armour-piercing rounds pass through it, `src/enemies/damage.ts`); the player's version
  can copy the second part, so snipers and rockets stay dangerous. In co-op teammates must see the shield, and it should
  stop bullets for a teammate standing behind it. See Q7.

### "GAFF": the harpoon cannon
- **Asked:** shoulder-fired, huge damage, no explosion. It pins enemies to walls and skewers several in a line. It has a
  rope: retract it to use it as a grapple hook to swing.
- **How it differs from the Stakegun:** the Stakegun is a quick crossbow: five stakes, 140 damage, one body pinned a
  shot, exploding bolts on right click. The harpoon is one huge shot with a slow reload. It goes through a whole line of
  men and carries them all to the wall on one shaft. And it stays tied to the gun by the rope.
- **Maps to:** a new member of the Stakegun's key (key 0, `base: 'stakegun'`), reusing the stake's flight and the wall
  pin (`gore.pin`, `Projectiles.nail`). Starting numbers: about 550 damage (the Sabot's dart is 600), one harpoon out at
  a time. The rope: hold right click to reel. Stuck in a wall, it pulls you to it and you keep your speed, so it swings
  and slings (`src/player/`, beside the wall run and Jump Jet). Stuck in a man, it pulls him to you. A tap cuts the rope
  and loads the next harpoon. A gaff is the hooked pole used to land big fish. About 2600 at wave 13 (Endless Humans
  break 7).
- **Overlap:** the backlog gives the Stakegun a tether bolt that reels the player in. That is the same movement tool.
  See Q11.

---

## 4. Suggestions

Nothing in this section was asked for. Pick what you like.

### Mods on every weapon today

89 mods exist. "After" adds the owner's list from sections 1 and 2.

| Key | Weapon | Mods today | After | What it has today |
|---|---|---|---|---|
| 1 | SMG | 9 | 9 | suppressor, extended mag, mag tape, stock, AP, HP, +P, light, akimbo |
| 1 | Gimlet | 9 | 11 | ACOG, red dot, suppressor, launcher, short barrel, AP, HP, +P, light |
| 1 | Harrow | 7 | 11 | red dot, ACOG, AP, HP, +P, API, light |
| 1 | Flail | 7 | 9 | red dot, ACOG, large box, AP, HP, +P, API |
| 2 | Pump shotgun | 3 | 5 | choke, light, flechettes |
| 2 | Thresher | 2 | 3 | light, flechettes |
| 2 | Deuce | 4 | 5 | quad barrels, speed loader, light, flechettes |
| 3 | Rocket | **0** | 2 | (right click laser is built in) |
| 3 | Quiver | **0** | **0** | |
| 3 | MGL | 1 | 3 | sticky bomb |
| 3 | Satchel charge | **0** | **0** | |
| 3 | Howitzer | **0** | 1 | |
| 4 | Sabot | 2 | 2 | Raufoss rounds, muzzle brake |
| 4 | Awl | 9 | 9 | ACOG, suppressor, AP, HP, +P, extended barrel, greased bolt, .50 conversion, light |
| 4 | Autocannon | 1 | 2 | flak shells |
| 5 | Katana | 1 | 1 | energy blade |
| 5 | Shiv, Cosh, Prybar, Spade | **0** | **0** | (only in play with `?melee=four`) |
| 6 | Judge | 7 | 9 | extended hammer, comfort grip, AP, HP, +P, light, akimbo |
| 6 | Rivet | 6 | 11 | extended mag, AP, HP, +P, light, akimbo |
| 6 | Ultramag | 10 | 11 | suppressor, reflex, laser, extended mag, compensator, AP, HP, +P, light, akimbo |
| 6 | Autoraffica | 6 | 6 | extended mag, AP, HP, +P, light, akimbo |
| 7 | Lance | **0** | **0** | |
| 8 | Trommel | 1 | 1 | 12 mm rechamber |
| 8 | Piledriver | 3 | 3 | extended box, red dot, ACOG (Raufoss on hold R is built in) |
| 8 | Metal Storm | 1 | 1 | 40 mm FireStorm |
| 9 | Kiln | **0** | **0** | |
| 0 | Stakegun | **0** | **0** | (exploding bolts on right click are built in) |

**Little love, even after your list:** Quiver, Satchel, Lance, Kiln, Stakegun (none at all); Trommel, Metal Storm,
Howitzer, katana (one each); Sabot and Autocannon (two each); Thresher (three). Keys 7, 9 and 0 each hold one gun with
no mods: the whole late game has nothing to buy for them.

### Attachment ideas for the ones with little love

| Gun | Idea | What it does | What it looks like |
|---|---|---|---|
| **Sabot** | Thermal scope | The scope shows warm bodies through walls thin enough for the dart to pass (it already goes through 5 m). The wall-shot rifle finally sees what it shoots. Reuses the Thermal brain chip's outline, in the scope only | A boxy cooled imager on top of the scope with a short cable |
| Sabot | Extended magazine | 5 to 8 darts | A longer box under the receiver |
| **Quiver** | Top-attack fuze | Missiles climb, then dive on their marks: they reach men behind cover and hit vehicles from above. A little slower to land | Small fold-out fins at each tube mouth, a radar puck on the side |
| Quiver | Six-pack | Six tubes and six marks for four; reload 2.8 to 3.6 s | A block of two by three |
| **Satchel** | Proximity fuze | A planted charge goes off by itself when an enemy walks within 3 m. Charges become mines; right click still blows them all | A sensor puck with one amber eye taped to the pack |
| Satchel | Shaped charge | The blast goes one way, out from the surface it is stuck to: twice the reach in that direction, through the wall it is on, half elsewhere | A copper cone plate strapped to the face |
| **Kiln** | Long nozzle | The stream leaves a third faster and reaches about 16 m flat for 11; burns fuel 20% faster | A longer lance with a flared tip and a pressure gauge |
| Kiln | Thickened fuel | Burning patches last 14 s for 7 and grow bigger: real area denial | A second tank, dull green with a hazard stripe |
| **Stakegun** | The backlog's three | Hold R cycles ammo; tether bolt; sticky charge. Still the best ideas for it (`weapon-ideas-backlog.md`, item 3) | |
| Stakegun | Geared lever | 0.55 s between stakes to 0.4; reload 1.6 to 1.2 s | A cocking lever with a brass gear wheel |
| **Lance** | Prism | A tap in beam mode splits into three rail shots in a flat fan: it cuts a crowd, for one cell more | A three-faced crystal ahead of the muzzle |
| Lance | Capacitor bank | Full charge in 1.0 s for 1.3 | Three more rings round the barrel that light in turn |
| Lance | Extended cell | 12 charges to 18 | A longer cell with a window showing the glow |
| **Trommel** | Booster motor | Spin-up 0.7 s to 0.4 | A second motor housing with cooling fins |
| Trommel | Belt pack | 120 rounds to 300, with a longer reload | A feed chute running down out of view |
| **Metal Storm** | Deep stack | Seven rounds a barrel for five: 180 to 252 | A longer barrel block |
| **Howitzer** | Rangefinder | A mark under the crosshair shows where the shell will land at the range you are looking at | A boxy laser rangefinder beside the optic |
| **Autocannon** | Five-shell clip | 3 to 5 | A taller clip standing out of the top |
| **Rocket** | Tandem warhead | A direct hit on armour, a vehicle or a boss counts three times instead of twice; smaller splash | A probe on the rocket's nose, seen at the tube mouth |
| **MGL** | Airburst fuze | A grenade bursts in the air over the first enemy it passes, so it reaches men behind low cover | A fuze ring and a small counter on the sight |
| **Thresher** | Twin drum | Two drums clipped together: the first reload is a quick flip, under a second | Two drums side by side |
| Thresher | Muzzle brake | Half the climb. (Climb is not spread: the pellets' cone stays as it is) | A big slotted brake |
| **Cosh** | Stun cell | A hit floors the man twitching for a few seconds: the capture tool gets better at its job | Two prongs and a coiled wire, a thin inset line of glow |
| **Autoraffica** | (wait) | It is too strong today. Add nothing until the smart-gun rework has been played. The flared magwell can join later by the list | |

**My top five:** the Sabot's thermal scope, the Quiver's top-attack fuze, the Satchel's proximity fuze, the Lance's
prism, and the Kiln's thickened fuel. Each changes what the gun is for, not only a number.

Dragon's breath and slugs could reach every shotgun the way flechettes do, by a list of guns. That is Q9.

### Energy weapon ideas

The bar is the Lance: a gun that changes how you play, not a number. No plain pulse rifle. Left out on purpose: the
saw-blade launcher and the arc gun (both rejected on 2026-11-17), anything like the Black Sun or Frost Nova that the
game already has as a power, and anything with slow motion (the co-op rule on slow-mo notices would apply). Prices sit
between the microwave gun and the Lance. All are on waves 10 to 18, so Endless Humans breaks 5 to 9.

**1. RED TAPE: strung cutting wire** (key 0, beside the Stakegun)
Fire one anchor into a wall, then a second anywhere in sight of it. A taut line of hot red light stretches between the
two for ten seconds, and whatever runs through it is cut at that height, with the real slicing the katana uses. Up to
three lines at once.
*Changes play:* you stop shooting at enemies and start shooting at the room. String a doorway at neck height, a corridor
at the knees, then make noise and let them come. Fire one anchor, dash across the gap, fire the second: the movement is
part of the aim. Human squads that see a line should refuse it and go round, which herds them.
*Cost:* about 3000 at wave 12 (break 6). Four pairs of anchors a cell.

**2. THE LIEN: a claim on anything not nailed down** (key 7)
A beam that takes hold of one thing: a man, a corpse, a severed head, a barrel, a grenade in the air, a Riot's shield.
Hold to carry it at the crosshair as a live ragdoll. Right click throws it hard enough to kill what it hits. "Grav gun"
came up on 2026-11-17 with no decision; this is the version I would build, because the ragdolls are real.
*Changes play:* the crowd becomes your ammunition and the most dangerous man in the room is taken out of the fight
while you hold him. Catch a rocket and send it back. Hold a man in front of you and his friends hold fire, as they do
for the human shield. It burns charge by the second, so you cannot hide behind it.
*Cost:* about 3600 at wave 14 (break 7).

**3. COUNTERCLAIM: catch their fire, hand it back** (key 7)
Right click holds a flat pane of light in front of you. It eats bullets, rockets and flame, and a meter fills with what
it caught. Left click spends the meter as one blast down the crosshair, as big as what was absorbed. It makes no damage
of its own: a full Gunner's belt comes back as a beam through the wall he was behind.
*Changes play:* you walk into fire on purpose. The more they shoot, the harder you hit, so Endless Humans' worst moments
become its best. The pane only covers the front and only holds a few seconds, so being flanked is death. The katana's
guard parries one hit at a time; this stores a whole squad's volley.
*Cost:* about 3200 at wave 13 (break 7). The cell pays for the seconds the pane is up.

**4. TRANSFER ORDER: you are needed elsewhere** (key 7)
Left click fires a slow glowing marker that sticks to a wall, a floor or a man. Right click moves you to it at once,
with the speed you had when you left. Anything standing where you arrive is burst. One marker at a time.
*Changes play:* it is a movement tool that kills. Mark the catwalk, fight on the floor, leave when it gets bad. Stick
it on a running Brute and arrive inside him. Fire it ahead mid-jump and chain the momentum. In co-op, stick it to a
teammate's wall for a rescue.
*Cost:* about 3400 at wave 15 (break 8). One cell a jump.

**5. MILEAGE: paid by the metre** (key 7)
A capacitor gun with no ammunition at all. It charges from your own speed: dashing, sliding, wall running and hopping
fill it, and standing still drains it. A tap spends a tenth as a hard bolt. A held trigger spends everything as one
beam, and above a full charge that beam goes through walls.
*Changes play:* it pays for exactly what this game is about. A player who never stops has a gun that never runs dry and
hits like the Lance; a player in cover has a toy. No reserve to buy, no pickups to chase.
*Cost:* about 3800 at wave 16 (break 8).

**6. SECONDMENT: temporary reassignment** (key 7)
A slow, narrow beam held on one head for about a second. That enemy now works for the Council: he turns and fights his
own side for fifteen seconds, then his head bursts. Two at most. Bosses only stagger.
*Changes play:* you choose who to convert instead of who to kill. Turn the Rocketeer on his own squad, turn the Riot so
his shield faces them, turn the Brute and follow him in. Human squads already have morale; seeing one of their own
turn should shake it. Enemies can already target non-players (the squad allies), so the fight itself needs no new rule.
*Cost:* about 4000 at wave 17 (break 9). One cell a man.

**7. CARBON COPY: filed in duplicate** (key 7)
Throws a projector that stands up a copy of you in hard light. Enemies shoot at the nearer of you and it. Right click,
or enough damage, and it goes off in a plasma burst. Two at once.
*Changes play:* flanking becomes something you can set up alone. Put the copy in the doorway, go round, and shoot the
squad in the back while it fires at a picture of you (Endless Humans pays 1.5 for back shots). It is also bait for a
Red Tape line or a satchel.
*Cost:* about 2800 at wave 11 (break 6). The cheapest of the set.

**8. HIRING FREEZE: the cold hose** (key 9, the Kiln's opposite)
A beam of cold. On a man it freezes him from the feet up: first he is stuck where he stands, then solid, and solid
bodies shatter under any hit (Frost Nova's rule, already in the game). On the floor it lays a sheet of ice: you slide
faster and further on it, enemies slip and fall.
*Changes play:* it stops a charge and it builds roads. Freeze a corridor, slide it at twice the speed, and shatter the
statues on the way with the shotgun. Frozen men are also cover.
*Cost:* about 3000 at wave 12 (break 6). **One clash:** the art rule is a cold blue world with warm colour for what the
player does. An ice gun is the player doing something blue. Frost Nova already breaks that rule; this would break it
more often.

**My order:** Red Tape, Mileage and the Lien first. They lean on what this game already does better than others:
slicing, momentum and ragdolls. Then Counterclaim and Transfer Order. Secondment and Carbon Copy are the most new AI
work. Hiring Freeze last, because of the colour.

---

## 5. Open questions for the owner

Only where two readings lead to different work. Each has the reading the builder takes if there is no answer.

1. **How close to the real guns?** You asked for the Rivet to look like a Beretta 92FS and the Autoraffica "as much
   like the original RoboCop gun as possible". The game's own rule says original content, real guns as inspiration
   only, no logos or brands. *Default:* the same shapes and proportions as closely as we can, in black, with no name,
   logo, marking or text from the maker or the film, and our own shop names. Is that the line you want?
2. **Reference photos.** None are in the repo or on this machine. Please send the photos of the film gun and of the
   92FS again. They would be kept in the repo this time (for example `docs/reference/`).
3. **Smart gun, letting go.** (a) If you let go while it is still painting: does it cancel, or fire at what it has
   painted so far? *Default:* cancel. (b) Once it is firing, does letting go stop it? *Default:* yes. (c) Does hold R
   still switch between the plain three-round burst and the smart mode? *Default:* yes, as today.
4. **Howitzer cluster shell.** Is every shell a cluster shell once fitted (like the autocannon's flak), or does hold R
   switch between the standard shell and cluster (like the WP rockets)? *Default:* hold R.
5. **Autocannon long barrel.** A direct hit already kills anything normal in one shot. The "more direct-hit damage" can
   only show on bosses, vehicles and the mech. Is that what you meant, or should the barrel do something else for the
   common case (for example a bigger blast)? *Default:* bosses, vehicles and the mech only.
6. **Missions beaten twice.** (a) There is no point limit on mission loadouts today, because there is no mod choice at
   all. Did you mean a first stage with a point budget (say after the first win) and no budget after the second? Or
   simply: after two wins, every mod is free? *Default:* the simple one. (b) Twice per mission, or any two mission wins?
   *Default:* per mission. (c) Are all of that gun's mods open, or only ones the player has bought somewhere before?
   *Default:* all of them.
7. **Riot shield.** Is the shield always up while that pistol is out, or raised with right click? *Default:* always up,
   and right click is the shield bash.
8. **Microwave gun.** Truly invisible, or a faint heat shimmer so you can see where it points? *Default:* shimmer only,
   no beam and no light. And is it a narrow beam on one man or a cone on several? *Default:* a narrow cone, two or
   three men.
9. **Shotgun rounds.** Dragon's breath on the Thresher and the new shotgun only, as you said, or on the pump and the
   Deuce too? Slugs on the new shotgun only, or on all of them? *Default:* exactly as you said.
10. **Names.** Billhook, Bodkin, Autoclave and Gaff: yes, or your own? Also, two names in today's shop are real company
    names: "MILKOR MGL" and "METAL STORM". Rename them to match the rule, or leave them?
11. **Harpoon rope and the Stakegun's tether bolt** are the same movement tool. Both, or does the harpoon take it and
    the Stakegun keep only the sticky charge? *Default:* the harpoon takes it.

---

## 6. Build order for Neon

Sections 1, 2 and 3 are the build. Section 4 is built only for the items the owner picks. A lane whose item has an open
question takes the default written in section 5 and says so in its report.

### Rules that stay in force

Everything in `CLAUDE.md` applies. The ones that matter most here:

- **Git:** several agents share one checkout. Commit on `dev` through a **private index** and `update-ref`
  compare-and-swap, exactly as `CLAUDE.md` shows. Never `git add -A`, `git add .`, `git commit -a` or `git stash`. Stage
  only your own lines. Never stage a file you did not write.
- **No pushing.** Only the owner says "push".
- **Port 5173 is the owner's.** Never start, stop or reload anything on it. Run your own Vite on your own port with
  `OP2_NO_HMR=1`, restart it after editing `src/` and before a browser proof, and stop it when done. Always pass
  `--port` to `tools/shot.mjs`. Playwright `channel: 'chromium'` only.
- **Game facts:** no spread on bullet weapons; never touch a shotgun spread value except the three owner-asked ones in
  this plan; Shift is dash and there is no sprint; no aim sway; mods are fitted in the shop; "brain chip", never "chip";
  every shop item unlocks before round 10 of Endless Humans; original content, no logos or brand names.
- **Models:** real form, never boxes; bevels, chamfers, cut-outs, two or three materials, glow only as thin inset
  lines; no rolling or twisting in gun animations; hand grips correct; look-checks at dpr 2, 1440x900. Anything that
  moves is checked with `tools/sheet.mjs`, not one screenshot.
- **Reports** to the owner: plain words, short, the commit hash, what changed with numbers, test results, screenshot
  paths, and what was not done or not checked.

### Effort for each sub-agent

**Do not run every small task at the top effort.** Most of this plan is small.

| Effort | Use it for |
|---|---|
| **Low** | Stat-only mods and data rows: a patch in `mods.ts`, a shop row, a co-op row, a test. Reticle and text changes |
| **Medium** | An ordinary mod with a model part; an animation fix; an effect recipe; a menu screen |
| **High** | Only these: the Autoraffica smart-gun rework, the harpoon grapple, the white phosphorus cloud, the cluster shell, the riot shield, the microwave gun, and every new or rebuilt weapon model (Rivet, Autoraffica, Billhook, Bodkin, Gaff, Autoclave) |

### The shared files

Almost every mod touches the same five files, and `tsc` refuses to build until an id is in all of them:

- `src/core/gameplay.ts` (`ModId`, `WeaponId`)
- `src/weapons/mods.ts` (`MODS`, `MOD_ORDER`, the gun lists)
- `src/contracts/shop/data.ts` (the shop row; a `Record` over every id)
- `src/weapons/watch.ts` (`REMOTE_MODS`, `REMOTE_FX`; a `Record` over every id)
- `src/lab/mods.ts` and its test (the cheat-panel rows come from `MOD_ORDER`)

A new weapon also touches `src/weapons/data.ts`, `src/ui/icons.ts`, `src/ui/data.ts`, `src/ui/hud/crosshair.ts`,
`src/enemies/outpost/acoustics.ts`, `src/contracts/defense/data.ts`, `src/weapons/viewmodels/models/index.ts` and
`src/ui/backdrop/gunstage.ts`.

Three more files are hot because behaviour lives in them: `src/weapons/Weapons.ts`, `src/weapons/viewmodels/rig.ts` and
`src/weapons/data.ts` (the `WeaponDef` type).

**How lanes share them:**

1. **Phase 0 goes first, alone.** One lead agent adds every id in this plan to the shared files in one commit, with the
   real numbers for stat-only mods and a plain stub for the rest, so the game builds and every lane starts from the same
   rows. This is how the mech parts update was done (commit `b1936829`).
2. **After Phase 0, a lane changes only its own rows** in the shared files, in small commits through the private index.
   If the compare-and-swap fails, redo it on the new head; do not force it.
3. **New behaviour goes in a new file of its own** (as `flak.ts`, `fan.ts` and `smartaim.ts` are), with one small hook in
   `Weapons.ts`. **Only one lane edits `Weapons.ts`, `rig.ts` or the `WeaponDef` type at a time.** A lane asks the lead
   for the turn, makes its hook, commits, and hands the turn back.
4. **Each lane writes its own test file.** Do not add cases to another lane's test file.
5. **Notes:** each lane adds its own paragraph to `docs/notes/weapons.md` and `docs/notes/viewmodels.md`, committed the
   same way. New sounds go in `src/audio/catalog.ts` and `docs/notes/audio.md`.

### What "done" means, for every lane

- The numbers are in the row and a Vitest test next to the code proves them.
- The shop row exists, with a catalogue line in the Council's voice, and its Endless Humans lock is at break 9 or sooner.
- The cheat panel lists it and can fit it.
- The part shows on the first-person model **and** on the shop studio turntable, checked in close-up at dpr 2.
- Co-op: the `REMOTE_MODS` or `REMOTE_FX` row is true to what teammates see and hear, a case is added to
  `tools/scripts/coop-fx-matrix.mjs`, and its screenshot pair has been looked at. Anything that is not a plain ray or
  projectile (fire cloud, bomblets, rope, shield) has its own `FireNote` kind and `Watcher` branch.
- `npx tsc --noEmit` and the whole Vitest suite pass. `tools/solo-parity.mjs` shows nothing else in single player moved.
- The notes are updated. The report says what was not checked.

### Phase 0 (lead, medium effort)

Every id, shop row, co-op row and cheat row in the plan. The new slots (`trigger`, the Deuce's `length`). The gun lists
(`MAGWELL_GUNS`). The per-gun rocket speed field. The win counter's saved key. All stat-only patches, finished and
tested here: Harrow short barrel, brake and magazine; flared magwell; Flail stock; Judge barrel and compensator; MGL
barrel and trigger; Gimlet long barrel; Rocket tube; Autocannon barrel; pump greased bolt. Their model parts come in
the lanes.

### The lanes (after Phase 0, in parallel)

| Lane | Work | Files it owns | Effort |
|---|---|---|---|
| **A. Rifles** | Models for: Gimlet long barrel and handguard; Harrow short barrel, brake, 40-round magazine; flared magwells on Harrow and Gimlet; Flail heavy barrel (the one look-critical part: "badass and insane") and stock | `viewmodels/models/gimlet.ts`, `harrow.ts`, `flail.ts` | Medium |
| **B. Shotguns** | Pump sawed-off and the faster pump animation; Deuce long barrels, double and quad; dragon's breath (new round, fire, sparks, co-op). Then the Billhook: model, row, seven mods, slugs | `models/shotgun.ts`, `deuce.ts`, `thresher.ts`, new `models/billhook.ts`, new `weapons/dragon.ts`, `fx/recipes/` (own recipe file) | Medium; **High** for the Billhook model |
| **C. Launchers** | Rocket tube model and the laser fix; MGL barrel and trigger parts and the reload animation fix; howitzer's own fiery explosion. Then the two hard ones: WP rockets and the cluster shell | `models/rocket.ts`, `mgl.ts`, `howitzer.ts`, `viewmodels/lam.ts`, new `weapons/wp.ts`, new explosion kind in `fx/recipes/explosions.ts`; calls `frame/bomblets.ts` and `Flames.ts` without changing them | Medium; **High** for WP and cluster |
| **D. Pistols, part 1** | Rivet remodel and its five mods; Ultramag low-profile reflex sight and magwell; Judge barrel and compensator parts | `models/rivet.ts`, `ultramag.ts`, `judge.ts`, `optics.ts` | **High** for the Rivet model; Medium for the rest |
| **E. Autoraffica** | The remodel, then the smart-gun rework and the akimbo crosshair | `models/autoraffica.ts`, `weapons/smartaim.ts`, `ui/hud/crosshair.ts` (the smart and twin parts), `autoraffica.test.ts`, `akimbo.test.ts` | **High** |
| **F. Riot shield** | Starts only when D and E are done: it adds a part to all four pistol models | The four pistol model files, new `weapons/shield.ts`, a HUD meter, player damage hook | **High** |
| **G. Key 4 and small fixes** | Autocannon barrel part; Awl black crosshair | `models/autocannon.ts`, `ui/hud/overlays.ts`, `ui/css/overlays.css` | Medium for the barrel; Low for the crosshair |
| **H. Bodkin** | The flechette rifle: model, row, mods | new `models/bodkin.ts`; its rows | **High** (new model) |
| **I. Autoclave** | The microwave gun: model, heat rule, the swell-and-burst gore | new `models/autoclave.ts`, new `weapons/microwave.ts`, a gore hook agreed with the lead | **High** |
| **J. Gaff** | The harpoon cannon: model, skewer and pin, rope, grapple | new `models/gaff.ts`, new `weapons/harpoon.ts`, a hook in `src/player/` agreed with the lead | **High** |
| **K. Missions beaten twice** | Win counter, the mod step on the starter screen, the kit handed to the mission, co-op roster | `contracts/unlocks.ts`, `contracts/starter.ts`, `ui/screens/starter.ts`, `campaign/starter.ts` | Medium |

Lanes A, B, C, D, E, G, H, I, J and K touch different files and can all run at once. F waits for D and E. Inside a lane
the work is in the order written. Lanes that need a turn on `Weapons.ts` (B for dragon's breath and slugs, C for WP and
cluster, E, F, H for the burst, I, J) queue for it through the lead, one at a time.

Suggested order if they cannot all run at once: Phase 0; then A, D, G and K (small, and the owner sees results soon);
then B, C and E; then H, I and J; F last.
