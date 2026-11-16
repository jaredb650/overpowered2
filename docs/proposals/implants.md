# Proposal: cyber implants (a loadout of streak power-ups)

Status: approved with every default, 2026-11-15, and built the same day (see "Built" at the end). Every number about today's game is read from the code named next to it. Timings for
how fast a player gets there are worked out from the thresholds and wave sizes, not measured in a browser.

## Summary

**How many are there?** 12 power-ups that you earn by killing. 11 of them can fire in normal play; Sentinels were taken off the ladder on
2026-11-13. On top of those, 10 capsule power-ups (Quad, Haste, Frost Nova and the rest) spawn on a timer and you walk to them. All 22
run on the same code and stack with each other.

| Group | Count | What they are |
|---|---|---|
| Kill-streak perks | 12 (11 live) | Blood Thirst, Hellfire, Adrenaline, Berserk, SLOWMO, Sentinels (parked), Chain Storm, Butcher, Skyfall, Chain Reaction, Overdrive, Geneva Suggestion |
| Capsule power-ups | 10 | Quad Damage, Haste, Vampire, Ricochet, Shock Rounds, Ghost, Magnet, Regen, Frost Nova, Time Warp |
| Not in scope | 8 call-ins, and stims | The call-ins (Airstrike to Nuke) sit on the same combo ladder, but they are a separate system and Outpost Defense already sells them. Stims are a healing kit, not a reward (`src/progression/stims.ts`). |

**The recommendation, short:**

1. **Always on (core), never equipped:** SLOWMO, Adrenaline, Geneva Suggestion. They are cheap, tied to a basic skill (headshots, the
   sword, prisoners), and add no shots or explosions.
2. **Three implant slots, one per class:** Gun, Kill, Move. You start with one slot open and buy the other two. You can never equip two
   Gun implants, so Blood Thirst, Hellfire and Berserk can never run together again. That one rule removes today's worst stack.
3. **Berserk stays one implant, toned down.** It keeps "you cannot die", dual SMGs and bottomless magazines. It loses the 5x damage and
   the 3x pellets. Fire rate goes from 3x to 1.5x and speed from 2x to 1.4x. Hellfire was never part of Berserk in the code (see
   section 4). It becomes its own Gun implant, so the two can't be worn together.
4. **Caps, so it can't lag:** one capsule effect at a time; damage capped at 6x, fire rate at 2x and pellets at 2x in total; at most 6
   exploding-bullet blasts per frame; and a 30 s cooldown after any implant's effect ends.
5. **A new player's loadout:** the core plus Blood Thirst, which is issued free in the Gun slot.

## 1. Every streak power-up today

All durations, thresholds and stacking rules are in `src/progression/data.ts` (`EFFECTS`, `WINDOWS`, `COMBO_PERKS`, `STACK`). The
triggers live in `src/progression/index.ts` (`onKill`, `feedWindows`, `noteHeadshot`, `onSevered`, `onExecuted`). Every effect's numbers
are written each frame by `PerkRunner.applyModifiers` in `src/progression/perks.ts`.

"Retrigger" is what a second trigger does while the effect is already running: *ignore* does nothing, *refresh* resets the timer, and
*stack* adds a stack and resets the timer.

### 1.1 Kill-streak perks (earned by killing)

| # | Perk | Trigger | What it does | Time | Retrigger |
|---|---|---|---|---|---|
| 1 | **Blood Thirst** | 4 kills in 5 s (window, not cleared) | 2x damage, bottomless magazine, 2x shotgun pellets, refills magazines on start | 10 s | ignore |
| 2 | **Hellfire** | 10 kills in 10 s (window, not cleared) | Every bullet explodes (2 m blast, 1.25x damage); rocket blasts 2.5x wider (20 m) and instant kills | 5 s | ignore |
| 3 | **Adrenaline** | 3 sword or melee kills in 3 s | +15% speed per stack, up to 3 stacks | 5 s | stack (3) |
| 4 | **Berserk** | Combo 15, then every 15 more | Invulnerable, 5x damage, 3x fire rate, 3x shotgun pellets, bottomless magazine, dual SMGs (akimbo), 2x speed | 10 s | ignore |
| 5 | **SLOWMO** | 3 headshots on different heads in 3 s | World at 0.25x speed, the player at full speed | 5 s | ignore |
| 6 | **Sentinels** | Off the ladder since 2026-11-13 (owner: they blocked the view and stole kills). Lab and sandbox only | 3 drones, each firing 6 shots a second at 30 damage, out to 55 m (`src/progression/sentinels.ts`) | 20 s | refresh |
| 7 | **Chain Storm** | Combo 30, then every 30 more | Every kill throws 3 lightning arcs at 80 damage, 3 hops deep (`src/progression/chains.ts`) | 12 s | refresh |
| 8 | **Butcher** | Limbs shot off 5 different enemies in 4 s (style perk) | Every hit severs a limb | 8 s | ignore |
| 9 | **Skyfall** | 4 kills in 6 s while off the ground at least 0.35 s (style perk) | Unlimited air dash; a ground slam explodes (7 to 16 m, 220 damage) | 8 s | ignore |
| 10 | **Chain Reaction** | 4 kills from one explosion, not counting Hellfire's (style perk) | Every corpse explodes (7 m, 150 damage) | 6 s | ignore |
| 11 | **Overdrive** | 5 kills in 10 s while moving faster than 18 m/s on your own speed (style perk) | Damage climbs from 1x at 12.5 m/s to 3x at 27 m/s | 10 s | ignore |
| 12 | **Geneva Suggestion** | Each prisoner executed (Endless Humans, Outpost Defense) | +20% damage and +12% fire rate per stack, up to 5 stacks | 6 s | stack (5) |

The four style perks (Butcher, Skyfall, Chain Reaction, Overdrive) are already rationed by `STYLE_GATE`: after one starts, no other
style perk can start for 20 s, and each has a 30 s cooldown after it ends. Nothing rations the other perks.

### 1.2 Capsule power-ups (on a timer, not earned by kills)

The first capsule spawns 25 s into a run, then one every 32 to 48 s, at most 3 on the map at once, at least 35 m away from you. They come
out of a shuffled bag, so you see all ten before any repeats (`CAPSULE` in data.ts, `schedule` and `nextPowerup` in
`src/progression/pickups/pickups.ts`). They spawn in every mode except the campaign missions.

| # | Capsule | What it does | Time |
|---|---|---|---|
| 13 | Quad Damage | 4x damage | 15 s |
| 14 | Haste | 1.5x fire rate and 1.5x speed | 15 s |
| 15 | Vampire | Each kill heals 12 HP | 15 s |
| 16 | Ricochet | Bullets bounce 3 times | 15 s |
| 17 | Shock Rounds | Each hit arcs to 3 more enemies for 40% damage (`SHOCK` in `src/weapons/Combat.ts`) | 15 s |
| 18 | Ghost | Enemies lose you past 15 m | 15 s |
| 19 | Magnet | Pickups fly to you from 45 m | 15 s |
| 20 | Regen | 14 HP a second, plus ammo | 15 s |
| 21 | Frost Nova | Freezes every enemy within 34 m for 7 s; frozen enemies take 3x damage and shatter (`src/progression/frost.ts`) | one shot |
| 22 | Time Warp | Same as SLOWMO | 5 s |

All capsules refresh their timer if you pick up a second one of the same kind.

### 1.3 How they stack

The rule, from the comment on `STACK`: *"Damage and speed multiply across effects, which is what lets a good run feel like cheating."*

- **Damage multiplies:** Blood Thirst 2 x Berserk 5 x Quad 4 x Overdrive 3 = **120x**. Geneva's 5 stacks double that again (240x), and
  Hellfire's rounds add another 1.25x.
- **Fire rate multiplies:** Berserk 3 x Haste 1.5 = 4.5x. Akimbo then halves the SMG's interval again (`updateAuto` in
  `src/weapons/Weapons.ts`), so the SMG reaches **9x**, about 120 rounds a second. Five Geneva stacks would push it higher.
- **Pellets multiply:** Blood Thirst 2 x Berserk 3 = **6x** on every shotgun (`fillShot` and the pellet count in `Weapons.ts`).
- **Speed** is the only total with a ceiling: 3.5x (`STACK.maxSpeed`).
- **Explosive rounds turn on with Hellfire alone,** but they apply to every pellet and every bullet that the other perks multiplied.
- Only one colour grade shows at a time (`GRADE_RANK`), but every effect's flash, banner and sound still plays.

## 2. Why it gets out of hand

### 2.1 The perks come back by themselves

These are the root cause. They are more important than any single number.

- **Blood Thirst and Hellfire never clear their kill windows** (`clears: false` in `WINDOWS`). Their retrigger is *ignore*, so they can't
  extend while running. But the moment one ends, your next kill re-arms it if you still have 4 kills in the last 5 s (or 10 in the last
  10 s). In a swarm, with 2x to 120x damage, you always do. Both are effectively always on.
- **Berserk does the same through the combo.** It fires at combo 15 and sets the next rung at 30. If the combo passes 30 while Berserk is
  still running, nothing fires, and the rung stays at 30. Then the very next kill after it ends starts Berserk again
  (`onKill`, the `COMBO_PERKS` loop). You are invulnerable while it runs, so the combo doesn't break from damage. Wave breaks also pause
  the combo timer (`update`). So one Berserk in wave 1 can mean Berserk with one-kill gaps for the rest of the run.
- Chain Storm works the same way at combo 30.

### 2.2 The worst combination, and how fast you reach it in the Crucible

**Worst stack:** Berserk + Blood Thirst + Hellfire, holding a shotgun. Add Haste or Quad from a capsule, and Chain Reaction or Chain Storm
on top.

| | Today |
|---|---|
| Damage | 2 x 5 x 1.25 = 12.5x, or 50x with Quad |
| Issued pump shotgun | 6 pellets x 6 = 36 exploding pellets a pull, about 5.5 pulls a second: **about 200 blasts a second** |
| Issued Thresher (auto) | 4 x 6 = 24 a pull, 15 pulls a second: **about 360 blasts a second** |
| Deuce (bought from wave 6), both barrels | 8 x 2 x 6 = **96 blasts in one frame**, up to 10 times a second |
| SMG | 80 rounds a second with akimbo (120 with Haste), each one a blast |
| You | Cannot die, run at 2x speed, never reload |

**How fast:** a standard Crucible wave holds (10 + 2 x wave) x 2 enemies, so 24 in wave 1 and 40 in wave 5 (`composeWave` in
`src/enemies/waves.ts`). Blood Thirst needs 4 kills in 5 s, Hellfire 10 kills in 10 s, and Berserk combo 15. All three fit inside wave 1.
A decent player has the full stack within the first 15 to 20 kills, which is likely under a minute of fighting (estimate). Section 2.1
then keeps it running.

### 2.3 What probably causes the lag

This is read from the code. Nothing was profiled.

**1. Exploding bullets, multiplied. This is the main suspect.** Every Hellfire bullet or pellet that hits anything, enemy or wall, calls
`bulletBlast` and then `Combat.explode` (`src/weapons/Combat.ts`). Each of those blasts runs the whole explosion, at once, inside the shot
(the 48-blast queue only holds chain explosions, not these):
- the FX recipe `hellfireBullet` (`src/fx/recipes/explosions.ts`): 20 chips, 8 sparks, 3 debris chips and about 4 debris streaks, a
  smoke puff, a fireball, 2 flash stars, 2 embers, a light request and a scorch decal;
- a positioned sound;
- an enemy query and damage for each enemy in range;
- a physics push (`radialImpulse`) that wakes nearby corpses and ragdolls;
- checks against projectiles, vehicles and map explosives, and camera shake.

200 to 960 of these a second is far beyond anything else in the game. Each kill they cause also brings gore: ragdolls, gibs and blood.

**2. Kill-triggered blasts and arcs.** Chain Reaction adds a 7 m blast for every kill, capped at 12 waiting (`CHAIN_REACTION.maxPending`).
Chain Storm adds up to 3 arcs, 3 hops deep, each with sparks and a sound, capped at 24 waiting. Under Hellfire, kills come in dozens a
second, so both queues stay full.

**3. Shot count.** Akimbo plus 3x fire rate means a muzzle flash, a light request, a shell casing and the per-perk shot sounds
(`SHOT_LAYERS`: one each for Blood Thirst, Hellfire and Berserk, on every trigger pull) up to 120 times a second.

**4. Rocket blasts at 20 m that instantly kill.** Hellfire makes one rocket kill a whole crowd at once, so a lot of ragdolls and gibs
appear in the same frame.

**Probably not the cause:**
- **Lights.** The pool is a fixed 8 real lights fed from at most 64 requests (`src/render/DynamicLightPool.ts`).
- **Particle buffers.** These are fixed-size rings (`src/fx/core.ts`), so the GPU work is bounded. The CPU work per blast is not.
- **Sentinels.** They are off the ladder.

## 3. The proposal

### 3.1 Always on (core)

| Kept as it is | Why it stays |
|---|---|
| **SLOWMO** (3 headshots) | The owner's call. It is the game's signature, it rewards aim, and it spawns nothing |
| **Adrenaline** (3 sword kills) | A small speed buff for melee. Without it, the sword has no reward of its own |
| **Geneva Suggestion** (executions) | Belongs to the prisoner mechanic in Endless Humans and Outpost Defense. It is small and capped at 5 stacks |

The core is not shown in the slots. The Implants page lists it as "Standard issue, always on" and you can't select it.

### 3.2 Slots and classes

Each implant belongs to one class. A loadout holds **at most one implant of each class**, and has as many slots as you have opened.

| Class | Implants | Why they are grouped |
|---|---|---|
| **Gun** | Blood Thirst, Hellfire, Berserk | These change every shot. Today they multiply each other, and that is the lag |
| **Kill** | Butcher, Chain Reaction, Chain Storm | These do something when you hit or kill |
| **Move** | Skyfall, Overdrive | These reward how you move |

| Slot | How you get it | Price | Wave lock |
|---|---|---|---|
| 1 | Open from the start | free | none |
| 2 | Bought | 1,500 | after wave 5 |
| 3 | Bought | 3,000 | after wave 12 |

The slots don't belong to a class. The first one can hold Skyfall if you want it to. The rule is only "never two of the same class", so
three slots means one of each class at most.

**Why three slots and not one:** with one slot, the late game has nothing left to buy, and the style perks would rarely be picked over a
Gun implant. Three slots with the class rule can't rebuild today's stack, and more slots give players something to buy later in a run.
**If the owner wants it tighter:** one slot all run, with nothing else changed, also works.

### 3.3 Implants, prices and wave locks

Pay for comparison: Crucible kills pay 10 credits, plus 5 for a headshot and 300 for a boss; a wave pays 125 + 25 x wave
(`src/contracts/defense/data.ts`). That works out to about 430 credits after wave 1, about 2,100 after wave 4 and about 2,800 after wave 5.
Weapons cost 250 to 4,500 (`WEAPON_WARES` in `src/contracts/shop/data.ts`). The prices below are meant to compete with the guns.

| Implant | Class | Price | Wave lock | Trigger | Changes from today |
|---|---|---|---|---|---|
| Blood Thirst | Gun | issued (0) | none | 4 kills in 5 s | Window clears when it fires; 30 s cooldown after it ends |
| Butcher | Kill | 600 | after wave 1 | as today | none |
| Skyfall | Move | 800 | after wave 2 | as today | none |
| Overdrive | Move | 1,000 | after wave 3 | as today | none |
| Chain Reaction | Kill | 1,200 | after wave 3 | as today | none |
| Hellfire | Gun | 1,600 | after wave 4 | 10 kills in 10 s | Window clears when it fires; 30 s cooldown; the blast budget (section 5) |
| Berserk | Gun | 2,400 | after wave 6 | Combo 15, then every 15 | Toned down (section 4); 30 s cooldown; the combo rung moves on even if it was running |
| Chain Storm | Kill | 2,800 | after wave 10 | Combo 30, then every 30 | 30 s cooldown; the same rung fix |
| Sentinels | (not sold) | | | | Stays parked, as the owner decided on 2026-11-13 |

Hellfire at wave 4 sits against the Autocannon (1,800, wave 4). Berserk at wave 6 sits against the Deuce (1,400, wave 6). That is the
choice the shop should ask the player to make.

The style gate stays as it is: 20 s between style perks and 30 s cooldown on each. It now applies only to the style implants you have
equipped.

### 3.4 Equipping in the shop

This follows the mods' pattern exactly: *bought once, then fitted or taken off here, free, in any break* (`MOD_WARES` in
`src/contracts/shop/data.ts`).

- **Procurement gets a third tab, Implants,** next to Weapons and Mods (`src/ui/screens/procurement.ts`). It is reached the same way, by
  pressing E at the supply pod in a break. There is no other way in.
- At the top of the page are the three slots, shown as boxes: open, for sale with a price, or locked with "Released after wave N". Below
  them are the implants, grouped by class. Each card shows the name, the class, the trigger, what it does, and a line of deadpan lore.
- **Enter on a row** buys the implant and fits it into a free slot, or fits or removes one you already own, free. If its class is already
  in the loadout, the row says *"Replaces Blood Thirst"*, and Enter swaps them.
- **When the menu closes,** an effect you removed ends silently. A new implant arms at once, with its kill window empty.
- **The rules** go in `src/contracts/shop/rules.ts` as `implantOffers(view)`, next to `weaponOffers` and `modOffers`. The view gets
  `implants`, `fitted` and `slots`, and purchases go through the same `buy(act)` with `kind: 'implant'` and `kind: 'slot'`.
  Progression reads the fitted set and only grants a perk that is core or fitted.
- **The HUD's combo ladder** (`LADDER` in `src/ui/data.ts`) shows Berserk and Chain Storm only when they are fitted.
- **Purchases last for one run,** like guns and mods, because credits reset each run. Every new run starts with the default loadout.

Another agent is changing the shop code right now. Whoever builds this should start from that work once it lands.

### 3.5 Modes without the supply-pod shop

| Mode | Shop? | Loadout |
|---|---|---|
| The Crucible, Endless Humans | Supply pod (`SHOP_CONTRACTS`) | As above |
| Outpost Defense | Its own shops and loadout screen (`src/ui/screens/loadout.ts`) | The same Implants section in its loadout screen and its shops, at the same prices and wave locks |
| The Outpost, Foreclosure (campaign) | None | **Each mission sets its own loadout in its mission data.** The default is the core plus Blood Thirst. A mission can hand out more where the script wants a power moment, in the same way missions already decide what they hand out, with no capsules |
| Test Range, sandbox, lab | None | The core plus Blood Thirst. The cheat panel can still grant anything, ignoring slots, for testing |
| `?shop=0` (caches back) | None | The core plus Blood Thirst |
| `?implants=0` (new, dev only) | | Today's behaviour, everything on, for comparing |

### 3.6 Default loadout for a new player

The core (SLOWMO, Adrenaline, Geneva) and **Blood Thirst in slot 1.** It is the first perk most players will trigger, it plays like
today's first minute, and it needs no shop visit. Slots 2 and 3 start closed.

## 4. Berserk

**What Berserk actually is in the code.** It has no Hellfire and no exploding bullets. Those come from the separate Hellfire perk, which
usually starts within the same few seconds and so feels like part of Berserk. Berserk's own parts are listed in `applyModifiers`
(`src/progression/perks.ts`) and `STACK`.

**The recommendation: keep it as one implant and tone each part down.** Its identity is "BERSERK! YOU CANNOT DIE", 10 seconds of being
unkillable with two guns. Splitting it into four or five small implants would lose that, and would add more rows to the shop than it
needs. Hellfire becomes its own Gun implant (it already is its own perk), and the class rule keeps the two apart.

| Part | Today | Proposed | Why |
|---|---|---|---|
| Invulnerable | yes | **yes** | This is the perk |
| Damage | 5x | **2x** | 5x on top of everything else is where the "too easy" comes from |
| Fire rate | 3x | **1.5x** | With akimbo, the SMG goes from 6x to 3x |
| Dual-wield (SMG) | yes, doubles the SMG's rate | **yes** | It is the look of Berserk. It is counted in the fire-rate cap |
| Extra pellets | 3x | **none** | Pellets are the biggest multiplier on blast count |
| Infinite ammo | yes | **yes** | Costs nothing to run, and it's fun |
| Speed | 2x | **1.4x** | 2x plus Haste hit the 3.5x ceiling |
| Hellfire / exploding bullets | not part of it, but it comes along | **not part of it, and can't be equipped with it** | Same Gun class |
| Duration | 10 s | 10 s | |
| Re-arm | the next kill after it ends | **30 s cooldown, and the rung moves on** | Ends the near-permanent Berserk |

If the owner would rather split it, this is the split: **Berserk** (invulnerable, 2x damage, bottomless) as a Gun implant, and
**Akimbo** (dual SMGs, 1.5x fire rate) as a Kill implant. It gives the same totals, but you get both only by spending two slots.

## 5. A cap on simultaneous effects

The class rule limits which effects can be combined. These caps limit how many can run at once and how much load they create.

| Cap | Value | Where it would go |
|---|---|---|
| **Effects running at once** | The core + your fitted implants (3 at most) + **1 capsule.** Picking up a new capsule replaces the running one. The old one ends silently, and the new one shows its banner | `PerkRunner.grant` (`src/progression/perks.ts`) |
| **Damage, all effects multiplied** | **6x** | `applyModifiers`, next to `STACK.maxSpeed` |
| **Fire rate, all effects multiplied, akimbo counted as 2x** | **2x** | `applyModifiers` and `updateAuto` |
| **Pellet multiplier** | **2x** | `applyModifiers` |
| **Exploding-bullet blasts per frame** | **6.** After that, a pellet or bullet hits as a plain round at 1.25x damage, with no blast. Chain Reaction's and Chain Storm's own caps (12 and 24 waiting) stay | `Combat.bulletBlast` (`src/weapons/Combat.ts`). Precedent: `LIGHT_EVERY` in `src/fx/recipes/cannon.ts` already rations a busy effect |
| **Re-arm** | 30 s after any implant's effect ends, the same as `STYLE_GATE.rearm`. Kill windows clear when the effect fires | `src/progression/index.ts` |

The worst case after these changes: Hellfire, Chain Reaction, Overdrive and Quad. Damage is held at 6x. A Deuce both-barrels pull makes 16
pellets, and only 6 of them blast. Chain Reaction stays under its 12-blast cap. The 6-per-frame figure is a starting guess, to be set from
the owner's own playtest on the 8 GB M1.

## 6. Questions for the owner

Each question has the answer I'll build with if you don't say otherwise.

| # | Question | Default |
|---|---|---|
| 1 | Three slots, one per class (Gun, Kill, Move), with one open and two bought? Or a single slot? | **Three**, slot 2 at 1,500 after wave 5 and slot 3 at 3,000 after wave 12 |
| 2 | Is the core SLOWMO, Adrenaline and Geneva Suggestion? | **Yes** |
| 3 | Keep Berserk as one toned-down implant (invulnerable, 2x damage, 1.5x fire rate, dual SMGs, bottomless, 1.4x speed, no extra pellets)? | **Yes, one implant.** The split (Berserk plus Akimbo) is the fallback |
| 4 | Hellfire as its own Gun implant (1,600, wave 4), unable to run with Berserk or Blood Thirst? | **Yes** |
| 5 | Capsules: keep them as map pickups, but only one at a time, with a new one replacing the old? | **Yes.** They stay outside the implant system |
| 6 | Caps: damage 6x, fire rate 2x, pellets 2x, 6 bullet blasts a frame, 30 s re-arm? | **Yes.** Tune after a playtest |
| 7 | Do call-ins stay on the combo ladder in the Crucible and Endless Humans, as they are today? | **Yes, unchanged.** They are a separate pass if they need one |
| 8 | Do Sentinels stay parked, not sold? | **Yes** |
| 9 | Campaign: does each mission set its own loadout, defaulting to the core plus Blood Thirst? | **Yes** |
| 10 | Does Outpost Defense sell implants in its loadout screen and shops too? | **Yes,** at the same prices and wave locks |
| 11 | Every new run starts on the default loadout, since purchases don't carry over? | **Yes** |
| 12 | Crucible high scores were set under the old stacking, and runs will now score lower. Keep the old records, or start a new table? | **Keep them.** Say so in the patch notes |

## 7. How they look (owner, 2026-11-15)

"I want the implants to change your character's look... That is the implant, and it should show your char model with the implants in
the menu." So each implant is a piece of hardware on the contractor, on the part of him its class is about. Code:
`src/characters/implants.ts`.

| Class | Region | Why |
|---|---|---|
| Gun | **Left forearm** (and, for Berserk, the hand and shoulder) | The guns' implants are in the arm that holds the gun. The left, because it is the forearm the first-person view shows on every two-handed gun; the right is off the bottom of the screen |
| Kill | **Head: a visor** over his smoked one | How he sees what to kill |
| Move | **Both shins** | How he moves |
| Core | **A spine down his back** | Always there, so small: six vertebra plates over a red line, and a port at the neck |

| Implant | Part | Look |
|---|---|---|
| Blood Thirst | Haemal Feed forearm | Two glass lines of blood (crimson glow) from wrist to elbow on a carbon spine, a vial in a steel cage on the back of the wrist, a band at each end |
| Hellfire | Kiln forearm with heat vents | A sleeve of seven dark radiator fins over an orange glow that shows between them, two exhaust pipes down the sides |
| Berserk | Rampart heavy forearm | A thick armoured sleeve with rounded plates layered over it, two red seams, a lit red core on the back plate, a knuckle plate on the hand and stacked plates over the shoulder |
| Butcher | Cleaver slit visor | A black visor band with one narrow pink-red slit across it, and a blade crest fore and aft over the crown, its edge lit |
| Chain Reaction | Cascade lens visor | A visor band with five round amber lenses in a row (the middle one larger) and a fuse can at the temple |
| Chain Storm | Tempest crown visor | A visor with a violet glow bar, and a coil at each temple: a rod with four brass rings and a lit tip |
| Skyfall | Calf thrusters | A pod on the outside of each calf: domed top, lit strip and vents, a steel bell nozzle with the burner lit inside and a short blue flame, and a lit stabiliser ring at the ankle |
| Overdrive | Sprinter blades | A carbon blade behind each calf from the back of the knee round under the heel, a yellow line down both faces, and an actuator drum on the outside of the knee with its rim lit |

**Built the way the game builds things:** three.js primitives merged into three meshes a part (lit metal, lit painted plate, unlit
HDR glow in the perk's colour that the bloom picks up), so a part is three draw calls at most. Nothing is baked.

**How they attach.** Parts mount on bones, never into a model:
- *The baked contractor* (main menu, shop studio): `dressBody(body, worn)` builds every part once per body and mounts it on its bone as
  a prop until reset (`Character.attachProp`), then only shows and hides. A part is designed in a canonical frame (forearm: wrist at
  the origin, +Y to the elbow, +Z the back of the arm) and placed by a matrix worked out from the model's bind positions, so it follows
  the bone however he is posed. `undressBody` frees the geometry when the menu or the studio gives the model back.
- *First person:* `wearOnViewmodel(ctx, gun)` builds the three Gun forearms once on the viewmodel's left arm (`armL`, read past the
  interface as the shop's gun studio reads `allDefs`): on the forearm's twist bone, starting past the wrist computer so its readout
  stays in sight, facing the side the camera sees; Berserk's knuckle plate on the hand bone. The materials go through the renderer's
  patch, as the viewmodel's own do. Progression calls it whenever the loadout changes. Nothing in `src/weapons/viewmodels/` changed.
- *Where he is seen:* the shop's Implants page (`BodyStage`, `ui/backdrop/bodystage.ts`: the lit studio the Weapons page uses, him
  turning, the row in focus put on him and the camera closing on its region), the first-person left arm, and the main menu's
  contractor, who wears the last run's loadout (`lastWorn()`, kept in localStorage).

## Built

2026-11-15. Everything outside the shop's files:
- **Loadout and rules:** `src/progression/implants.ts` (classes, prices, wave locks, lore, slots, `Loadout`, `CAPS`). Progression
  grants only core or fitted perks; every run starts on the default.
- **Rearm and the windows:** 30 s rearm on every implant; Blood Thirst's and Hellfire's windows clear when they fire; Berserk's and
  Chain Storm's rungs move on while they run.
- **Berserk** toned as section 4. **Caps** as section 5: damage 6x, fire rate 2x with akimbo counted, pellets 2x, one capsule at a
  time, 6 bullet blasts a frame.
- **The combo ladder** on the HUD shows Berserk and Chain Storm only when fitted.
- **The parts, the studio, the menu and the first-person arm** as section 7.
- **Lab rows:** IMPLANTS, a row each: grant, and fit or remove.
- **`?implants=0`** as section 3.5.
- **Campaign:** the default loadout (core and Blood Thirst). No mission sets its own yet.
- Old high scores are kept.

- **The shop's Implants tab** (`src/ui/screens/procurement.ts`): the third page beside Weapons and Mods. Three slot boxes and the
  core line over the rows; the two slots for sale, then the implants by class, each with its class in its colour, its price, its lock,
  "Fitted", or "Replaces Blood Thirst". The contractor stands in the studio (`BodyStage`) wearing the loadout, the row in focus put on
  him and the camera closing on its region; the card gives the part, the trigger, what it does and the rearm. Enter buys and fits,
  refits free, takes off, or opens the next slot. Rules: `implantOffers` in `contracts/shop/rules.ts`; `CrucibleShop.buy` takes
  `kind: 'implant'` and `kind: 'slot'`.
- **Outpost Defense** sells them at the Infirmary, at the same prices and wave locks (`implants` in `contracts/defense/economy.ts`,
  built on `implantOffers`), refitted free in a break. Its pre-wave loadout screen has no implant section: before wave 1 there is
  nothing to buy, and Blood Thirst is already fitted.

Not built: a mission setting its own loadout (every mission runs the default), and the Infirmary's rows do not show the contractor.
