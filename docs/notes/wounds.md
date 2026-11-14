# Wounds: what a hit does to a person

`src/enemies/wounds/`. Sections 14.1 and 14.6, for the human faction. It runs when `ACTIVE.def.wounds === 'anatomy'` and the body is a soldier, so
`?contract=outpost` or `?map=killhouse`. A husk spawned on the Outpost is still a husk, and on the swarm's contract none of this exists.

`/?map=range` alone resolves to the swarm's contract. **Use `/?map=range&contract=outpost`** to shoot a man on the Test Range.

## Public API

```ts
const wounds = ctx.enemies.outpost?.wounds;   // null off the contract
wounds.bodyOf(enemy);                         // Injuries, or null for a body with no anatomy
const s = ctx.enemies.outpost.soldierOf(enemy);
s.injuries.condition;                         // 'healthy' | 'wounded' | 'mortal' | 'downed'
s.weapon;                                     // 'primary' | 'sidearm' | 'none'
```

| Event | When |
|---|---|
| `enemy:wounded` | A hit found a named part, once per man per zone. Carries `zone`, `label`, `bonus`, `damage` |
| `enemy:condition` | He moved between conditions. Death is `enemy:killed` |
| `comms:line` | New kinds: `hit dying beg scream rescue lastStand`. A man with a lung or throat wound says nothing |

**Wound points are banked** by `progression/index.ts`, which listens to `enemy:wounded`. Strike and call-in hits pay nothing.

## How it fits together

| File | Job |
|---|---|
| `rules.ts` | The table: `ZONES`, `WoundTuning`, `CHARACTER` (weapon character), `bursts`. No game state |
| `zones.ts` | A hit's bone, entry point and direction, in bone space, to a zone |
| `injuries.ts` | One man's wounds and clocks as plain numbers. Lives on `Soldier.injuries` |
| `index.ts` | `WoundSystem`: `take` answers each hit, `update` runs everything on his own time |
| `crawl.ts`, `trail.ts`, `sidearm.ts`, `armour.ts` | Dragging himself away, blood on the floor, the pistol, the plates |

`FACTIONS` in `src/contracts/data.ts` is what can break a body, per faction. `DamageModel.rules(e)` picks the row per body.

The order of a hit is in `damage.ts`. `read` finds the zone before the plates, `priced` corrects what the region table charged, and `take` runs where the old code
said `if (health <= 0) die`. It returns true for dead. Otherwise he lives, however bad it is. Then limb pools, then `react`, where `mustFall` overrules the reaction if the wound
put him down. The swarm never reaches `take`, because `bodyOf` is null.

**A man on his knees.** `kneeling(e)` is true for a surrendered man nobody is holding. The damage model then skips his plates and `priced` multiplies the hit by `WoundTuning.kneeling`, and a fatal hit on a surrendered man is death with no clock, crawl or last stand. What survives it is in `docs/notes/outpost.md`.

## Conditions

| Condition | How he gets there | What happens |
|---|---|---|
| Wounded | Any hit over `graze` (9% of health) | Limps, clutches, bleeds. `e.bleed` is the sum of his wounds, and `e.speedMul` carries the slowest |
| Mortal | Health gone from a hit, or a lung | 3.2 to 5.8 s on his feet. `aimNow` climbs to 5x, stumbles get closer together, speed falls by nearly half. Then 40% dies through `gore.collapse`, 60% goes down |
| Downed | `floors` zones, a destroyed or severed leg, a blast that takes all his health, bleeding out | `maim.legs` is 0, posture `downed`. 10 to 20 s clock, 60% of that if he was mortal first, capped by the wound (`gone`). Crawls to cover or an ally |
| Dead | The rules below, or a clock | On the floor a clock ends in a ragdoll. On his feet, a collapse. Twitch 1 for sudden deaths, 0.45 for slow |

**Instant death:** a direct head hit, heart, decapitation (head pool gone), a trunk hit of 1.6x his health or more, mortal or downed hits arriving faster than they fade (`piledOn`: three SMG rounds at wave 1), a killing sword cut, any killing hit on a man already on the floor. Limb hits are never instant: a Judge round in the thigh leaves a man crawling.

## Zones

Position alone cannot find a heart from behind, so `zones.ts` tests the round's path. Heart is a sphere in the chest bone, spine and femoral artery are tubes along a bone.

| Zone | Bleed /s | Speed | Aim | What it does |
|---|---|---|---|---|
| Thigh, knee, shin | 0.4% | 0.62 | 1.25 | KNEECAPPED. Limp. `legGives` of wear destroys the leg: three SMG rounds, or one heavy |
| Inner thigh | 14% | 0.5 | 1.5 | FEMORAL. Hand on it, jets, down in about 8.7 s |
| Hand | 0.3% | 1 | 1.3 | DISARMED. Gun drops. Half go after it, half draw |
| Arm, shoulder | 0.6%, 1% | 0.95, 0.9 | 1.7 | ARM SHOT. `fracture(.., 'limp')`, so it really hangs |
| Lung | 2% | 0.6 | 2.2 | LUNG SHOT. Mortal at once. Coughs blood, no sprint, no voice |
| Heart | | | | HEART SHOT. Dead |
| Gut | 1.2% | 0.42 | 2.4 | GUT SHOT. Posture `hunched`, screams every 4 s |
| Carotid | 30% | | | CAROTID. Down at once, jets, no voice, gone in 3 s |
| Spine | 1.2% | | | SPINED. From behind only. Legs fail, arms only, never stands |
| Pelvis | 2% | | | PELVIS. Legs fail, drags, never stands |
| Head | | | | Dead. A glancing hit (the outer fifth) is RINGING: 2.4 s stunned, no orders. A shotgun or a heavy round he lives through knocks him down, helmet or not |

Wounds stack: `Injuries.add` deepens a wound in the same place and adds a new one anywhere else. Speed takes the worst, aim multiplies, bleed sums.

## Section 14.6's rules

| Rule | Where | State |
|---|---|---|
| Wound hold | `holdWorst`, `anim.holdWound` | Done. Pressure takes 40% off, aim worse by 1.3. It also runs while crawling. No free hand, no hold |
| Weapon character | `CHARACTER`, `HEAVY_ROUND` | Done for bleed and limb wear. Fire cauterises. Cannons burst a man, which is `bursts` |
| Armour | `armour.ts`, `onPlate` | Done. Front plate and helmet, real meshes: the helmet plate is the helmet he wears (`HELMET.worn`), so shooting it off bares his hooded head. Stops small arms outright with a blunt stagger, hangs off below 55% (the helmet tips forward over his eyes), comes off. Nothing on the back |
| Blast concussion | `concuss` | Done. Dazed 3 to 6 s, deaf, aim 3.5x, takes no orders. A plate does not stop it |
| Fire | `panic`, `rollAt` | Partly. Runs in circles, and after 1.5 to 3 s throws himself down, which puts it out. He writhes. There is no real roll |
| Self-aid | `selfAid` in `behaviours.ts` | Done. 2.6 to 4.2 s kneeling, stops the worst wound. A hit interrupts it |
| Buddy aid | `assignAid`, `aid`, `revive` | Done. Existing rescue. The clock stops under hands. A man who cannot stand gets 12 s more and stays down |
| Last stand | `rollLastStand`, `dropGrenade` | Done. 45% of mortal or downed men. Sidearm from the floor, or a grenade that rolls free when he dies |
| Screams | `voice` | Done. Frighten anyone within 13 m |
| Bait | `assignAid`, `sendEscort` | Done. A man who called in the last 7 s is heard at 42 m, and up to two more go with the rescuer |
| Blood trails | `trail.ts` | Done. Drops, pools, and a continuous drag behind a crawler |

## Decisions worth knowing

- **A downed man is `maim.legs === 0`.** Everything that reads `legs` already knows what that means: no fall, no get-up, low centre. `updateMaim` keeps it true.
- **Gore stays the only thing that puts a body on the floor.** A wound sets `floored`, and `DamageModel.drop` or `mustFall` starts a real fall. `gore.knockdown` can refuse past its budget, and then the posture alone takes him down.
- **`Reflex.pickGetUp` asks `anim.prone`.** That is how a man lands and stays down whichever way up. The posture has to be set before gore starts, which is `stayDown`. Get this wrong and he jerks up to his knees as gore hands him back.
- **Crawling drives the body, not a behaviour,** so a body with its AI off crawls like one in a fight. `downed` in `behaviours.ts` only keeps other behaviours out.
- **`pose()` in `soldier.ts` is the one way to set a posture.** It lets a wound overrule whatever a behaviour asks for.
- **A blast's ring goes before `take`.** `rollBlast` settles what comes off his health, so `takeArea` only sees what is left, and a ring that spared him stays spared. A plate is taken off first, then the roll, so a plated man in the middle ring ends up nearly dead instead of dead: over 54 bodies, 17 died, 37 were left on 35% of their health or less, and none were healthier.
- **Plates are real, and the front only.** Round to the back and there is nothing there. That is what makes flanking and spine shots worth it.
- **The rifle drops when he goes down.** Nobody crawls with one. If he is stood back up he goes for it, or draws, or runs.
- **Humans keep their heads to light rounds.** `gore.headshot` pops a head off under 40 damage, which on every SMG headshot was exactly "like clay". They get a ragdoll with twitch instead.
- **Decals must sit on the floor.** They test against the depth buffer with a 3 cm tolerance. Lifted 2 cm, most of a trail did not draw.

## Outside `src/enemies/wounds`

Needed for the crawl, and all additive. `HumanoidAnimator.ts`: `prone` forces the crawl plan, `clutch` split out of `protect` so a hand holds a wound while crawling, `rearm`. `postures.ts`: `hunched`, `pistol`, `leftOnly`. `getUp.ts`: optional `prone`. `gore/reflex.ts`: one condition. `EnemyManager.ts`: `model` and `fitPlates` no longer private. `Enemy.ts`, `movement.ts`: `footbound`. `tools/scripts/outpost-sim.ts`: real waves, and a `wounds` scenario.

## Tuning

| Where | What |
|---|---|
| `rules.ts` `ZONES` | Label, bonus, bleed, speed, aim, and the flags per zone |
| `rules.ts` `WoundTuning` | Every clock, chance and threshold above |
| `rules.ts` `CHARACTER` | Weapon character |
| `contracts/data.ts` `FACTIONS` | `blastLimb`, `limbWear` |
| `enemies/blast.ts` | What a blast does to any body, by ring. See `docs/notes/enemies.md` |
| `armour.ts` | Who wears what, plate strength, `CRACKED` |
| `crawl.ts` | `CRAWL_SPEED`, reach, `RESCUER_CLOSE` |
| `doctrine.ts` `ROLES` | `twoHanded`, `sidearm` |

## Testing

```
nice -n 19 npx vitest run src/enemies
nice -n 19 npx tsx tools/scripts/outpost-sim.ts wounds 110 3     # one zone at a time on a live squad, log in tools/out/outpost-wounds.json
WOUND=carotid,gut WOUND_ZOOM=1.4 node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/wounds-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/wounds.png
node tools/shot.mjs --url "/?map=killhouse&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/wounds-live.mjs --out tools/out/wounds-live.png --wait 500 --timeout 165
node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/wounds-swarm.mjs --wait 500 --timeout 90 --out tools/out/wounds-swarm.png
```

`wounds-seq` fires real rays at real capsules, on world frames, and writes `tools/out/wound-<case>.png`. Cases: `thigh thigh3 femoral hand arm shoulder botharms lung heart gut gutwalk carotid spine pelvis head glance blast rocket concuss burst plate fire collapse revive scramble crawl`. `WOUND_AI=on` spawns with the brain running, which `scramble` needs. Arms get in the way of the chest from the front, as they do in a real fight, so some cases shoot from behind.

## Measured

**Real AI, Kill House, 1440x900 at 2x**, bot putting one SMG round at a time into what it could see, 100 s of one wave: 0 console errors, frames median 16.7 ms and p95 16.8 ms, 147 to 189 draw calls, 4 to 8 ms CPU. 8 men wounded, 3 mortal, 6 downed, 6 dead, 3 broken. An earlier 80 s run cleared the wave with no help, which is the gap a downed man used to hold open.

**Frame sequences read one by one:** thigh, femoral, hand, arm, lung, heart, gut, carotid, spine, pelvis, head, glance, blast, concussion, burst, plate, fire, collapse, revive, scramble, crawl. Femoral went down at 8.7 s, carotid dead at 3.0 s, lung walked on for 4.3 s, then crawled.

**Swarm**, `/?autostart=1`: `outpost` null, `Waves` class, wave 1 of 24, a shot leg bleeds nothing, a thigh pool goes in the same three hits and bleeds 1.1 from the stump, a rocket gibs, no wound events.

## Known limitations

- **Nobody has played this.** Everything above is bots and stills, and nobody has listened to it. Whether it feels like hurting people needs the owner.
- **The score is not paid.** See Public API.
- **No drag has been looked at frame by frame.** A rescuer dragged a man in two live runs, by the numbers, and revive was read on the Test Range, where there is no cover to drag him to.
- **Bait has not been measured as a lure.** The rescue lines fire and the code path ran. Nobody has counted men drawn out of cover by one screaming man.
- **Burn panic is written but not seen.** On the range with AI off he stands and burns, and I have no sequence with the brain on.
- **A paralysed man's legs still stir** in gore's lying phase, because `Reflex` knows nothing of wounds.
- **A prone man firing a sidearm** uses the crawl's arm pose: the pistol is at the end of a hand on the floor. It fires true to the numbers and looks wrong.
- **Chest plates are `plateGeometry` slabs** in the suit's colours; the helmet is the baked helmet prop. I judged them only at the range the sheets show.
- **`stragglers.ts` marks prisoners too.** The reveal now works, but with three or more prisoners the markers can all go to them and miss the last hostile.
- **Some downed men barely crawl**, because a hidden cover spot is often within a metre. In one run two moved under half a metre.
- **Wave pacing has not been retuned.** Plates and mortal time make men last longer, and nobody has compared that to section 14.2.
