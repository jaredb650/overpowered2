# The hive mission: the build plan

Written 2026-11-10 by the mission study, which was read-only: nothing under `src/` was changed. The inputs were the owner's words, two proposals (one led by spectacle, one led by systems), the manuals in `docs/notes/`, `docs/campaign/MISSION.md`, and the code as it stood at commit `f5f2ee9` with other agents' uncommitted work in the tree. I checked the code wherever a proposal's claim mattered. Section 2 lists what that check changed. One cost probe was run in Chrome, and its numbers are in fact 30. Nothing here has been built or played.

The owner asked for a second campaign mission, against the zombies:

- the Council sends you to reinforce a unit of friendlies on an infested planet, where everything comes out of a hole in the ground that is a factory or refinery;
- you fly in on the door gun over a giant war: men, tanks and carriers on the ground, a friendly attack helicopter, the gunship, Warthog runs and airstrikes that call themselves in, and that you have to dodge;
- you fight into the cave with the friendlies, who die off until you are alone. Horror. The lights go out and the ninja types attack. Every enemy the campaign has not shown gets an introduction. Snipers, maybe;
- friendlies look nothing like the current humans, and the crosshair turns green over them. No dialogue lines for them, and no ElevenLabs credits;
- the boss order: an ordinary Juggernaut, then the Commander back as a brand-new boss, later the Titan as a mini boss, and last a second brand-new boss, the sentient hive mind that has been talking to you all mission.

## 1. The verdict

Scores run from 1 to 5, and 5 is best.

| | Spectacle-led ("The Sump") | Systems-led ("The Tallow Works") |
|---|---|---|
| Does what the owner asked, beat for beat | **5** | **5** |
| Stands on what the engine does today | **2**. It needs the human squad brain running beside the swarm and ten friendlies it does not know about, a new "claim" rule for melee, a cable system, and a cave 52 m down | **4**. Swarm rules only, one new behaviour for melee, vehicles and strikes reused as they are. Its cave is still 46 m down, which the nav does not reach (fact 21) |
| Frame cost on the 8 GB M1 | **3**. 36 skinned bodies near the player and 400 far | **4**. 30 near, 240 far, and a measurement behind it |
| Risk in each stage | **2**. The Commander's second phase and the green-crosshair betrayal both rest on things nobody has run | **4** |
| Set pieces | **5**. The dead man's recordings, the Lid finale | **4** |
| **Total** | **17** | **21** |

**The spine is the systems-led plan.** The plan below is its order, with the best of the other grafted on:

| Taken from | What |
|---|---|
| Spectacle | The Commander's own recorded takes, replayed, so the mission has a voice with nothing recorded. The Juggernaut in his cap. The Commander as a puppet on cables. LEDGER's rules as numbers, and learning once. The finale: you open the Lid and call three strikes onto the floor you are fighting on. Plates: what it eats is the armour you shoot through later. Friendlies the player cannot kill, as the default. Far kills pay 10 points and no combo. The war bench before any art |
| Systems | Three tiers of war. A swarm-only page. Prey for melee. Every beat a checkpoint that re-forms the squad. The squad cannot do parkour, and that is how it thins. Intakes that eat corpses. The crosshair never lies |
| This study | Depth limits per map (fact 21). Strike damage as the code really deals it (fact 16). Bailiffs whose own fire, and whose friendly-fire rule, never touch `Combat` (facts 10, 11). Lanes during the ride (fact 15). Spawn points by area (fact 25). The cast rule kept (fact 8) |

### Names

- **The mission:** The Sump. Contract, mission and map id `sump`. Form 7743-R, Notice of Recovery.
- **The place:** the planet Tallow, where the Council ships settled accounts to be rendered into product. The Tallow Rendering Works. The hole is **the Sump**, an open pit 110 m across. In its floor is **the Bore**, a shaft 34 m across, capped by **the Lid**.
- **Your side:** the Bailiffs, 14th Recoveries. Their strike controller, **LEDGER**, exists only as stamps on the HUD. Tanks are **Levy** (callsigns TALLY 1 and 2), carriers are **Docket**. In the air: the Packmule (your ride), SPECTRE (the existing AC-130), WARRANT 2-1 (the existing attack helicopter airframe, renamed because "Harrow" is now also a rifle) and AUDIT flight (the Warthog).
- **The bosses:** a Juggernaut, **the Commander, Reissued**, the Titan, and **the Remainder**: what is left of everyone you were paid to remove, grown in the vats. It learned to speak from Council paperwork and from the Commander. It calls you "Supplier".

### The shape

Given everything, then it is taken away one light at a time, then given back for one minute. About 30 minutes on a first play and about 22 for a strong player. Intensity is out of 10.

x runs east, z runs south, y is up, the surface is y 0, north is -z. The coordinates here are a first layout, drawn to show that the pieces fit. Stages 5 and 8 set the real ones in the map's `plan.ts` and in `sump.places.ts`, and those files are then the truth.

| # | Beat | Starts | Runs | Place | What happens | Near the player (real) | Far (tokens) | Int. |
|---|---|---|---|---|---|---|---|---|
| 1 | `briefing` | 0:00 | 1:00 | Film over Tallow | The Council reads Form 7743-R: the product has stopped being inert, this is a warranty matter, the 14th Recoveries are leased. Last frame, text from an unregistered sender: "Supplier." | none | 200 hostile, 40 friendly | 2 |
| 2 | `flyin` | 1:00 | 2:15 | Left door of the Packmule, anticlockwise: east along the Line, north up the east rim, west across the north rim, south to the pad at (0, 0, 88) | The tide from the air. First rounds fired play the dead Commander's "Good afternoon". His "All squads, get under something" plays and the tide scatters into the spoil. Six drones rise out of the Sump at your door. WARRANT flies alongside, a Warthog passes under the skids, the gunship's rounds fall past the door. You land among friends | 12 husks in the door's arc, 6 drones | 200, 40 | 7 |
| 3 | `line` | 3:15 | 2:15 | Line One, trench and parapet at z 60, x -80..80 | Eight Bailiffs fall in. First hover: green crosshair. Hold the parapet. The first husk you meet up close has no legs and is still coming. Three bombers sprint at a Docket: shoot the tank. One marked gun run and one marked airstrike, both well ahead, so the marks are learned before they matter. A heavy weapon is on the rack at (40, 0, 68) | 20 hostile, 8 Bailiffs, 2 Levy, 3 Docket | 200, 40 | 6 |
| 4 | `push` | 5:30 | 2:45 | The Spoil, z 20..58, to the Lip at z 15 | The Line advances behind the tanks. A marked strike every 20 to 30 s lands between you and the Lip, so the advance is reading the ground. Skitters pour out of a drain grating under TALLY 2 and burn it. Drones mob WARRANT: shoot them off it or lose it. The rocket launcher is on a burnt-out Docket at (-22, 0, 34) | 20, 8 | 200, 40 | 7 |
| 5 | `juggernaut` | 8:15 | 1:15 | The Lip | "Right. I've had this sent up from stores." A Juggernaut in the Commander's cap comes up the haul ramp and charges TALLY 1. Everything on the field shoots it. It dies, a husk falls out of the suit, the cap rolls. "That was the suit. We needed what was in it." | boss + 10, 8 | 120, halted | 9 |
| 6 | `ramp` | 9:30 | 1:00 | Haul ramp, down the south wall of the Sump to the Gate at y -12 | Downhill under your own guns, the last of the air. Overwatch signs off. Leapers go up the rim as shapes. "Close the gate." It shuts behind you and eight Bailiffs. "We take deliveries now." | 8, 8 | 60 on the terraces | 4 |
| 7 | `reissue` | 10:30 | 3:15 | Receiving Hall, 56 x 30 x 8 m, floor y -12 | The dead on parade in three ranks. "Let him come in. Let him sit down." Then "Now." **Boss 2, the Commander, Reissued.** He ends on his knees and you kill him | boss + 18 in ranks (12 awake at most), 8 falling to 6 | 36 on parade | 10 |
| 8 | `count` | 13:45 | 0:40 | The hall, quiet | Health, armour, ammunition. The box's tag changes to THE REMAINDER, and it reads your real numbers back | 0, 6 | none | 2 |
| 9 | `drop` | 14:25 | 2:15 | The Drop, a service shaft 22 m across, y -12 to -30 | Pink points of light climb the far wall, then leapers arrive. Red lasers cross the shaft: the hive's eyes. The ramp is broken for 18 m. You dash it, the squad takes the stair. One is pulled off the ramp, and his beacon falls and keeps falling: that is how you learn how deep it is | 6 leapers at once, 2 snipers, 6 falling to 5 | 48 climbing lights | 6 |
| 10 | `flare` | 16:40 | 2:00 | The Flare Line, a pipe gallery 70 x 6 m, y -30 | A pilot light turns the far corner. A burner lights the whole tunnel and a dozen husks walk at you as black shapes against the flame. A spill cuts off two Bailiffs. The Kiln is on the dead flare crew | 16 with 3 burners, 5 falling to 3 | none | 7 |
| 11 | `lights` | 18:40 | 2:30 | The Tallow Line, 64 x 12 x 9 m, y -34, carcasses on an overhead line | "You brought light into the works. We do not use it." Then his recorded "Lights." Black. Three beacons. One goes out. One is pulled upward. The third man fires wild and his muzzle flash shows four stalkers standing among the hung bodies. Then they come | 4 stalkers at once, 6 in all, 3 falling to 0 | none | 9 |
| 12 | `alone` | 21:10 | 0:35 | The Cage | Nobody. The autocannon and the Lance. The Remainder says nothing, for the first time | 0, 0 | none | 1 |
| 13 | `titan` | 21:45 | 2:00 | The Press Hall, 60 x 44 m, floor y -40, ceiling 18 m | **Boss 3.** A Titan hangs from the rendering line with its gun arm already gone. The hive drops it. 60% health. Its beam is the only light in the room | boss + 8 husks at most | none | 8 |
| 14 | `throat` | 23:45 | 0:45 | The decline to the Kettle | Two Bailiffs stand either side with their beacons out. The crosshair on them is red. "Stay. We would keep you whole." | 2 | none | 3 |
| 15 | `kettle` | 24:30 | 4:15 | The Kettle, 64 m across, floor y -46, under the Bore | **Boss 4, the Remainder.** It eats the dead. You open the Lid and call three strikes onto the floor you are fighting on | 14 | 150 still, in its body | 10 |
| 16 | `ending` | 28:45 | 1:00 | Up the Bore | Every husk drops. The Packmule comes down the shaft. The Council lists the deductions, one regiment among them. Last text: "Supplier. We will be received elsewhere." | none | none | 1 |

The rule from the Outpost's plan holds: never two 8s without a breath. `push` builds to the Juggernaut, which is the one peak of the outside, and `ramp` is its breath.

**The squad** that goes on with you: 8 into the hall, 6 out of it, 5 after the Drop, 3 after the Flare Line, none after the lights. Each loss is shown once.

**Finds:** you start with the SMG, shotgun, sword and 3 grenades. Then the heavy weapon at the Line (the weapons agent's heavy machine gun if it has landed, else the Buzzsaw), the rocket launcher in `push`, the Stakegun on a ledge in the Drop that only a wall run reaches, the Kiln in `flare`, the autocannon and the Lance in the Cage. Every checkpoint promises what the next fight needs.

**Voice:** nothing is recorded. 23 existing takes are replayed where they now mean something else (fact 28). Everything new is text with a stable id.

**The introductions.** One new type at a time, each seen before it is fought up close.

| Never shown in the campaign | Beat | The image |
|---|---|---|
| Husk | `flyin`, `line` | The tide from the air. Then one with no legs, still coming over the parapet |
| Drone | `flyin` | A flock rising out of the Sump at your door. Each one shot falls on the tide like a bomb |
| Bomber | `line` | Three sprinting at a Docket with their tanks lit |
| Skitter | `push` | A drain grating lifts under a tank and they pour up its hull |
| Juggernaut | `juggernaut` | Up the ramp in the dead man's cap |
| Leaper | `ramp`, `drop` | Shapes going up the rim. Then pink lights climbing a dark shaft |
| Sniper, as the hive's eyes | `drop` | Red lasers through fog, one beat after your own overwatch signed off |
| Burner | `flare` | A pilot light turns the corner, and the tunnel is lit by its flame |
| Stalker | `lights` | A muzzle flash shows four of them standing among the hung bodies |
| Titan | `titan` | Hung on the rendering line in pieces, and dropped |

### The four bosses

1. **Juggernaut** (`juggernaut`, 1:15). The existing row, unchanged. Short because tank shells and the gunship's Hellfire each take the capped 5% a hit. A charge that ends on a hull or a wreck stuns it for 2.6 s, which is today's wall rule.
2. **The Commander, Reissued** (`reissue`, 3:15). New body, new fight. He hangs from three nerve cables that run to winches on the hall's crane rails. He does not run and does not dodge: the cables sling him. He points, and the dead act. Emptying his health only drops him like a puppet with cut strings. While he is down the nearest winch opens, and breaking it costs him one gift. With all three gone he is a frightened man with a pistol. Stage 9.
3. **Titan** (`titan`, 2:00). The existing row at 60% health with no barrage, in one hall it cannot leave.
4. **The Remainder** (`kettle`, 4:15). Not a body. A render column of fused dead, 5 m thick and 20 m tall, with three intakes, three arms and a speaker. It eats corpses, and what it eats becomes plate. Stage 12.

### The stages

| # | Stage | What the owner gets | Depends on |
|---|---|---|---|
| 1 | The war bench and the far battle | A battle of 240 at 0.3 ms, and proof of what the machine holds | none |
| 2 | Friendly soldiers | Bailiffs who fight beside you, and a green crosshair | none |
| 3 | The air wing and LEDGER | Strikes that call themselves and miss you unless you walk into them | 1, 2 |
| 4 | Friendly armour | Tanks and carriers on your side | 1, 2 |
| 5 | The map outside | The site from the pad to the Gate | none |
| 6 | The mission's plumbing | Sixteen empty beats that run, and a panel to jump between them | none |
| 7 | The fly-in and the battle outside | Minutes 0 to 9:30, with the Juggernaut | 1 to 6 |
| 8 | The map inside, and the dark | The Works, a lamp, and real darkness | 5 |
| 9 | The Commander, Reissued | Minutes 9:30 to 14:25 | 1, 2, 6, 8 |
| 10 | The descent | Minutes 14:25 to 18:40, the squad thinning | 1, 2, 6, 8 |
| 11 | Lights out, and the Titan | Minutes 18:40 to 24:30 | 6, 8, 10 |
| 12 | The Remainder | Minutes 24:30 to 28:45 | 1, 3, 6, 8, 9 |
| 13 | The mission whole | The menu entry, the ending, one run from start to end | all |

That is one more than the dozen asked for. The plumbing is its own stage so that four agents can start at once (1, 2, 5 and 6) and so that stages 9 to 12 do not wait on stage 7, which is the largest. If stage 7 runs long, `push` and `juggernaut` go to a second agent after `line` is committed.

## 2. Facts checked in the code, and what each changed

Line numbers are today's and will drift while other agents work. The names will not.

**The mission system**

1. **A mission is plain data played through one host.** `src/campaign/types.ts` has the steps and triggers, `runner.ts` touches only `MissionHost`, `validate.ts` finds dangling names, `?beat=<id>` starts anywhere. So the mission is rows, every new step is an addition, and `outpost.test.ts` and `runner.test.ts` must pass unchanged at every stage.
2. **A mission can run on swarm rules, and should.** `host.ts` `spawnNext` forms an Outpost squad only when `manager.outpost` exists, and `src/enemies/index.ts` swaps the wave loop for `MissionWaves` on any mission id. With `ai: 'outpost'` the host calls `formSquad` for every arrival, husks included, and holds arrivals to `MAX_HOSTILE` (18). So the contract row is `ai: 'swarm'`, `waves: 'swarm'`, `wounds: 'limbs'`. No human squad brain runs on this page. The spectacle plan's garrison of dead soldiers is dropped. The one soldier kept is the sniper, which has a swarm row.
3. **Only human squads can hold.** `orders: 'hold'` and `'ambush'` call `squad.lieStill`. A swarm body has no dormant state, but `src/lab/spawn.ts` shows one: no behaviours, no attacks, `mode = 'hold'`, `dummy`. The host gains that for swarm bodies, and `release` wakes them. That is the dead on parade.
4. **The `boss` step is the Outpost's Commander and nothing else** (`host.boss` calls `commander.person.stage`). It gains `kind`, `health` (a share) and `without` (regions already gone), and keeps its meaning with none given.
5. **Two systems cannot both provide `call`.** `campaign.provide` is `Object.assign(host, parts)`, so a second `{ call }` replaces the first. A registry of names is needed. `host.call` already handles `lights` with the `blackout` grade, though `docs/notes/world.md` still says nothing provides it.

**Enemies**

6. **The campaign has shown seven types.** `missions/outpost.ts` names trooper 64 times, gunner 25, brute 11, rocketeer 4, riot 4, warden 3, sniper 2, and nothing else. Never shown: husk, stalker, leaper, bomber, burner, skitter, drone, a plain Juggernaut and the Titan. So there are nine introductions, one image each.
7. **There are no friendly NPCs.** `Team` is `'player' | 'enemy'` and only labels shots and blasts. The nearest things are prisoners (enemies on their knees), the Sentinels (player-team hitscan) and `FriendlyAircraft`. The friendlies are a new system.
8. **Enemy AI knows one target, but a body's behaviours are a list.** `aiWorld.ts` holds one `PlayerSense`, about 58 lines across `attacks.ts`, `behaviours.ts`, `bosses.ts`, `movement.ts`, `roles.ts` and `contact.ts` read it, `thinkAttacks` gates on `e.dist` to the player, `meleeConnect` only hits the player, and the nav has one flow field. But `EnemyManager.spawn` sets `e.behaviours = def.behaviours`, and the lab already swaps that list. So **prey** is one behaviour the friendlies' system adds to a melee body's list (as a new array, the row's own is shared): it walks to a Bailiff in `point` mode and swings on its own clock. No enemy file is edited. Ranged enemies never choose a Bailiff, so deaths to burners, snipers and stalkers are scripted. The header of `enemies/data.ts` also says only the Stalker may be quick and evasive, so the Commander does not dodge: his cables move him.
9. **Gore takes any character.** `knockdown`, `downed`, `ragdoll`, `sever` and `raycastCharacter` all take a `CharacterInstance`. So Bailiffs get knocked down, get up, die as ragdolls and lose limbs with no change to gore, inside the shared caps of 14 ragdolls, 12 knockdowns and 40 corpses.
10. **Every player-team ray ticks the hit marker, and every kill pays.** `Combat.ts` calls `hud.hitMarker` and hit-stop for any player-team hit, and `progression/index.ts` `onKill` pays score for any source: `ASSIST_SOURCES` only slows the combo. So Bailiff fire does not go through `combat.fireRay`. It calls `enemies.raycast` and `enemies.applyDamage` itself with an `ally_` source, and progression gains `ALLY_SOURCES`, which pay nothing and move no combo.
11. **A living body that is not an enemy is invisible to `Combat`,** which tests enemies, vehicles, corpses and the world. `weapon:fired` carries the line of each of the player's shots, and `physics.radialListeners` hears every blast. So the default rule costs nothing in the weapons agent's files: your rounds pass through a Bailiff, the friendlies' system tests the line itself for a green spark, a flinch and CHECK FIRE, and blasts knock him down. Real friendly fire needs a hook in `Combat.ts` and `Projectiles.ts`. It is question 1.
12. **The crosshair already reddens.** `ui/hud/crosshair.ts` `aimCheck` runs `enemies.raycast` 12 times a second, then a wall test, and sets `hostile`, which `hud.css` fills with `--blood`. It is hidden while scoped or targeting, and the gunner's seat draws its own reticle and enemy tags (`src/vehicles/hud.ts`). So `friendly` is a second class on both, and the nearer of the two rays wins.
13. **Green is already taken twice.** The husk's accent is lime (`0xa8ff3c`, `archetypes.ts`), and the Warthog's ground strip is drawn in its call-in colour, `#00ff00` (`progression/data.ts`). So nothing on a Bailiff's body is green: pale armour, a square outline and a cold white beacon carry it, and green is for the HUD. A strike LEDGER calls is marked in hazard amber, never in the Warthog's green.

**The air**

14. **The door gun tells nobody what it shot.** `DoorGunner.round` calls `combat.fireRay` 60 times a second and raises no `weapon:fired`. `ShotResult.end` says where each ray stopped. So `round` reports each ray to the far battle with one call, once the weapons agent's door-gun work has landed.
15. **During a ride the swarm hunts the parked body.** `PlayerSense` and the flow field follow `player.position`, which is the body parked at the flight's last mark. Real husks would run through the friendly line for the pad. So a body made real while the player is parked walks the far battle's lanes on a lane behaviour and never the flow field.
16. **The proposals had the strike damage wrong.**
    - Airstrike rockets pass `selfDamage: 0.5`, but kind `rocket` caps the player's share at 16 a rocket (`EXPLOSIONS.rocket.selfCap`, `weapons/data.ts`). Rockets fall uniformly in radius over 12 m with a 6 m blast, so about half of the 15 reach a player at the centre: up to about 120, which kills from full health with no armour. At the ring's edge it is one or two rockets. The finale only throws (`finalePlayerPush: 22`). This is computed from the numbers, not measured. It stays as it is.
    - Warthog shells pass `selfDamage: 0`, and kind `shell` has `selfCap: 0`, so a share passed in the spec would still be cut to nothing. The damage of a tasked gun run is therefore dealt by the tasker: 9 a shell within 5 m of where it lands, 45 a run at most. No change to `Combat.ts`.
17. **`dangerClose` is only the player's own targeting preview** (`targeting.ts`, read through `progression.dangerClose`). A tasked strike drives the same HUD element from its own flag.
18. **The gunship fits.** One rig. `holdSeconds: 120` sits in the plan object, which the Door Gunner already copies to change. The ring's centre is `path.center`. Every blast is `selfDamage: 0, playerPush: 0`, the 105 holds fire within 9 m of the player, the Hellfire takes bosses first. A two-minute siege cost all of progression 0.1 ms at the median. So station mode is the same class with a hold time, a centre that follows the front and one fixed phase. The 49 degrees stay.
19. **One of each airframe.** `CallInManager` builds one jet, one attack helicopter ride and one Packmule, and `launch` is private and reads one shared order. So progression gains a public way to launch a strike nobody owns, the tasker waits its turn for the jet, and the player's own Attack Chopper call is held while WARRANT flies. "Harrow" is now both the attack helicopter (`progression.md`) and a rifle (`WeaponId`), hence WARRANT.
20. **Vehicles are cheap and all aim at the player.** Kinematic chassis, a collider and a pool per part, 8 live and 14 wrecks. `ground.ts` reads `ctx.player` in `look`, `leadOn`, the firing shake and `bump`. `spawnRider` spawns a `trooper` enemy. Roof guns fire enemy-team rays through combat. `VehicleDef.armoured: false` makes bullets count. So a side flag swaps the player for a target the far battle provides, friendly roof guns are remote turrets with no rider, and the player's fire does nothing to a friendly hull. The same `Vehicle` base carries the Commander's winches and the Remainder's parts as soft, static structures, so every weapon works on them through `enemies.vehicles` with no new plumbing in `Combat`.

**The place**

21. **Nothing walks below y -19.** `world/nav.ts` casts its rays from `TOP_Y` 118 over `TOP_Y - BOTTOM_Y`, and `BOTTOM_Y` is -19. `enemies/movement.ts` treats a body below `FELL_OUT_Y` (-40) as fallen out of the map. Both proposals put the lower half of their caves under both lines: no enemy and no friendly could have stood there. The light volume is at most 200 x 48 x 200 cells (`LightVolume.ts`), sized per axis. `nav.ts` joins floors two cells apart with a drop link and no wall test (`world.md`), and `MAX_DROP` is 17. So:
    - both limits come from the map's `bounds.min.y`, with a test that the other three maps build the same node counts;
    - the lowest floor is y -46 and the highest structure y +14, so 62 m of height gives light cells 1.3 m tall;
    - the route spirals round the Bore, so no room sits on top of another with less than 10 m of rock between;
    - two floors of different heights behind a thin wall are kept more than two cells apart.
22. **The minimap is one image from above** (`world/minimap.ts`). The map has rooms under the battlefield, so it charts two, split at y -6, and shows the one the player is in.
23. **Darkness has almost no support.** `DynamicLights` has only `flash`, 8 lights are live at once, chosen by brightness. The baked volume cannot switch. `blackout` is a grade at exposure 0.2. Characters have a fill floor (`uFill` 0.75) so they never go black. So stage 8 builds the dark: held lights with reserved slots, one gain on the baked volume and its fog, a `pitch` grade, and the fill following the gain.
24. **Every page loads every body.** `Game.ts` calls `characters.load()` with no list. A body is about 2.2 MB on disk and, by arithmetic, about 11 MB on the GPU (two 1024 atlases with mips). `enemies/commander/props.ts` `Props` fits small models on bones at run time and stands alone. So there are three new baked bodies and no more (`bailiff`, `bailiffHeavy`, `reissued`), the sergeant and the beacons are props, and a row can name the maps it loads on.
25. **The Titan and the spawner assume the wave game.** `bosses.ts` `onLimbLost` calls `reinforce(pick(['husk', 'trooper']), 4)` through map-wide spawn points, and a stranded body re-enters through any of them. So the reinforcement list becomes something a mission sets, and the mission tells the spawner which area's points are live. Otherwise a rescued husk comes back on the surface after the Gate has shut.
26. **The boss bar reads the first live enemy flagged a boss** (`ui/hud/boss.ts`), named from `ENEMY_NAMES`, with limb pips only for the Titan. The Reissued is an enemy row, so the bar finds him. The pips become general. The Remainder feeds the bar through a small source.
27. **Gore keeps its dead in a list nobody else can read.** `Gore.bodies`, `sinkBody`, stakes and the burn all exist. The public contract has `raycastCorpses`, `damageCorpse` and `pin`, and no way to list corpses or take one. The kill event carries `gibbed`, `sliced` and the damage type. So the Remainder needs two small gore calls, and falls back to the kill event if they slip.

**Words and menus**

28. **A clip plays by its line's id.** `Voice.say([line.id])` looks the id up in `public/audio/voice/manifest.json`: 999 clips, of which 75 are the Outpost mission's (50 Commander, 20 Council, 5 pilot). The text shown is whatever the row says. `Speaker` has four members and `campaign/hud.ts` `WHO` is one table for every mission. So a row imported from `outpost.lines.ts` plays its old take, its words cannot drift, and the speaker table becomes per mission. The 23 takes this plan uses were each checked in the folder. Their ids all begin `mission.`, left off here and below: `cmd.in.hello`, `in.door`, `in.talk`, `lz.gate`, `lz.trucks`, `boss.stores`, `mess.hold`, `mess.now`, `bar.lights`, `stack.pension`, `plate.report`, `redeploy.another`, `redeploy.told`; `council.brief.line`, `brief.thanks`, `soft.receipts`, `arm.take`, `wreck.balance`, `turn.fine`, `boss.hours`, `redeploy.fee`, `redeploy.keep`; `radio.end.walk`.
29. **A society is a row, and one flag opens the locked ones.** `contracts/data.ts` (`ContractId`, `mission`, `locked`), `select.ts` (`MAP_IDS` fails the typecheck until the map is added), `maps.ts`. `op2_campaign_beaten` is set when a mission with `unlocks` is won from its first beat. The dev server is always open.
30. **Measured today,** Test Range, 1440x900 at 2x through `tools/shot.mjs`, other agents working. 22 husks fighting an invulnerable player, 8 idle troopers standing in for friendlies, a 150-damage blast into the pack every 4 s, the pack topped up, 14 s:

    | Run | Load average | Frame, median / p95 | CPU, median / p95 | Draws | Triangles |
    |---|---|---|---|---|---|
    | Empty range | 9 | 16.7 / 24.3 ms | 6.6 / 12.9 ms | 53 | 68k |
    | Empty range | 36 | 16.7 / 20.2 ms | 4.8 / 6.9 ms | 52 | 68k |
    | 22 + 8 | 5 to 7 | 16.7 / 24.6 ms | 10.4 / 18.6 ms | 240 | 1.19M |
    | 16 + 6 | 30 | 24.4 / 41 ms | 22 / 35 ms | 232 | 1.31M |
    | 26 + 10 | 38 | 25.1 / 42 ms | 21.8 / 37 ms | 261 | 1.34M |

    What it says: thirty bodies in a blast fight cost about 4 to 6 ms of CPU over an empty map, and hold a 16.7 ms median when the machine is not swamped. The p95 and the physics peak (7 to 40 ms, the empty runs included) are the load and prove nothing. At load 30 and over, 22 bodies and 36 read the same, so those two rows say nothing about 36. Triangles do not depend on load, and 22 to 36 bodies inside 20 m, with their corpses and limbs, peaked at 1.2 to 1.3M of the 1.5M budget, on a map of 68k. **Triangles are the budget that binds.** So the near caps are 20 and 8, not 26 and 10, most real bodies are kept past 26 m where they draw at 42%, and a bench run only counts with its empty twin beside it.
31. **The dev panel has nothing for missions.** `?beat=` and `runner.start(beatId)` exist. So the panel gains a Mission section.
32. **Anything that flies needs `Skyline`** (`progression.md`: a helicopter flew 22 m into the Crucible without it). The pit is a hole in its height grid, so the map stage proves the flight and WARRANT's circle against it.
33. **A charging Juggernaut stops on any world collider** (`bosses.ts` `charge` probes `physics.raycast`, whose default mask is `CG.World`), and vehicle parts are world boxes (`addStaticBox`). So a hull or a wreck should stun it with no new code. Read, not run: stage 4 runs it.
34. **The last contractor is on the Outpost's wreck with bare feet** (`world/map/outpost/apron.ts` `contractor`). The Remainder's speaker is that figure, built the same way.

## 3. Rules for every stage

- **One agent per stage.** Touch only the files the stage lists. Edit shared files with exact replacements. If tsc or a test fails in a file you did not touch, wait two minutes and run again. Never stash, reset, clean or check out files. Commit your own files by path. Never push: a push republishes the public site.
- **Other agents' work lands first.** This plan assumes the weapon families, the reworked minigun and door gun, the heavy machine gun, the parkour animations, the ragdoll stages, weapon gore, executions and prisoner questioning are in before the stage that leans on them. The edits that sit in their files are few, and each waits for its owner to finish: `ui/hud/crosshair.ts` and `progression/data.ts` (stage 2), `enemies/movement.ts` and `enemies/spawner.ts` (stage 5), `progression/callins/doorGunner.ts` (stage 7), `enemies/bosses.ts` and `enemies/data.ts` (stages 9 and 11), `gore/index.ts` and `audio/synth/recipes` (stage 12). Weapon ids and where each is found get one pass in stage 13.
- **Shell.** `export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:/opt/homebrew/bin:$PATH`.
- **Tests.** One file at a time: `nice npx vitest run <file> --testTimeout=60000`. Type check: `nice npx tsc --noEmit`.
- **Browser.** Only `node tools/shot.mjs ... --dpr 2 --w 1440 --h 900`. One browser at a time: wait for the lock. Scratch files and screenshots go in `tools/out`.
- **The frame budget.** 60 fps, under 450 draw calls, under 1.4M triangles, 12 ms of CPU, physics step inside today's. Caps for this mission: 20 real hostiles and 8 real Bailiffs outside, 16 and 6 inside, 240 tokens, 5 live vehicles, 4 aircraft. The game's own caps stay: 48 enemies, 14 ragdolls, 40 corpses.
- **How it is measured.** `tools/scripts/war-chaos.mjs`, built in stage 1, at the caps above with a blast every 4 s.

  ```
  node tools/shot.mjs --url "/?map=range&war=1" --script tools/scripts/war-chaos.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 150 --quiet --out tools/out/war.png
  ```

  It runs the empty map first and the war second in one page, and prints the load average. Gates: draws under 450 and triangles under 1.4M always. CPU median no more than 7 ms over the empty run. Frame median 16.7 ms when the load average is under 8. A run at a load average over 12 proves nothing and is run again. From stage 7 on, the same script takes `WAR_BEAT=<id>` and measures that beat on the real map. If a gate fails, the counts come down, not the frame rate.
- **The governor.** `src/war/governor.ts`. When the median of the last 3 s of CPU passes 13 ms it sheds in this order: tokens 240, 160, 100. Real hostiles 20, 16, 12. Real Bailiffs 8, 6. It steps back after 10 clean seconds. `?governor=0` turns it off, and every bench runs with it off.
- **Jumping to a beat.** Three ways, built in stage 6 and kept working by every stage that fills a beat:
  - the dev panel (F1 or backquote) gains a **Mission** section listing every beat of the running mission. A click restarts the run at that beat with its checkpoint's kit, in place, through a new `campaign.jump(id)`;
  - `/?contract=sump&autostart=1&beat=<id>`. Until stage 7 adds the contract's row, the same page is `/?mission=sump&map=sump&contract=crucible&autostart=1&beat=<id>`;
  - `window.__op2.campaign.jump('<id>')` for bots.

  A win reached by a jump beats nothing, as today.
- **Every beat is a checkpoint,** and states everything it needs at its top: the roster, the far battle, the air plan, the doors, the kit. A death rebuilds the run from nothing, so a system that is not told again is not there.
- **Tests.** Each stage adds its own file and keeps these passing unchanged: `src/campaign/runner.test.ts`, `src/campaign/missions/outpost.test.ts`, `src/contracts/contracts.test.ts`, `src/contracts/crucible.test.ts`. From stage 6 on, `src/campaign/missions/sump.test.ts` holds what the Outpost's holds: no dangling names, playable from the first beat to the last, finishable after a death in every beat, startable from any beat.
- **Manuals.** New: `docs/notes/allies.md`, `docs/notes/war.md`, `docs/campaign/SUMP.md`. Each stage updates the manual of every system it changed, and says what it could not verify.
- **No new voice.** Nothing calls ElevenLabs or any other service. No sample is downloaded. New sounds are synth recipes. Every new line is a row with a stable id, `mission.sump.<who>.<key>`, so a take can be dropped in later with no other change. Bailiffs have no lines at all. What they would say is raised as typed events (`ally:contact`, `ally:down`, `ally:moving`, `ally:lastMan`) for a voice bank to key on later.
- **Friendlies are never mistaken for enemies.**
  - Pale against a dark cast, a square pack frame and aerial, a cold white beacon over the head. No green on the body.
  - The crosshair is green over any Bailiff, Levy or Docket, real or token, on foot and in a seat, and never through a wall.
  - **The crosshair never lies.** A body the hive has turned reads red. Nothing hostile ever reads green.
  - Stage 2 ships an identification sheet, and every later stage that adds a body or a light reruns it.
- **What has to stay true.**
  - The Outpost plays exactly as it does. The Crucible's row means what it meant.
  - Every hit the player takes has a tell: a mark on the ground, a lane, a zone, a glint, a laser.
  - LEDGER never stamps a strike that does not land. When the Commander's recording tells the tide to do something, the tide does it.
  - The gunship never harms the player.
  - Only the Stalker is quick and evasive.
  - No allocation in hot paths, every pool capped, only `ctx.time` for clocks.
- **Hand-off.** Each stage ends with a URL the owner can play. The owner judges by playing and listening. An agent verifies by measurement, tests and screenshots, and says plainly what it could not verify.

---

## 4. The stages, in build order

Each stage says what the player gets, what to build and where, targets that can be measured, a URL to try it at, and what it depends on.

## Stage 1. The war bench and the far battle

**What the player gets.** A battle too big to simulate, at almost no cost: hundreds of figures streaming out of the ground toward a line of men who are shooting them. The ones that come close are real.

**Build.**
- `src/war/index.ts`: `createWar(ctx)`, on `ctx.war`. Idle on every page that does not ask for it. Two lines in `src/core/Game.ts`: built after `enemies`, updated after `enemies`.
- `src/war/tide.ts`: the far battle. Two `InstancedMesh`es, hostile and friendly, of a figure built from primitives at about 150 triangles (`bakePose` only gives LOD 0, so nothing is baked). The stride is in the vertex shader from a phase per instance. No skinning, no shadows, no AI, no physics. A third mesh holds the fallen, 60 at most, oldest out.
- `src/war/lanes.ts`: lanes as lists of marks, a front (the z where hostile tokens stop and die) and a kill rate per lane. `scatter(seconds)` sends hostile tokens to the nearest cover mark and back.
- Promotion and demotion in `tide.ts`:
  - a hostile token within 50 m of a player on foot becomes a real husk at the same spot, if the real count is under the cap and the spot is outside the view or past 45 m;
  - a real, unhurt husk more than 70 m away and out of view becomes a token again;
  - while `player.parked`, promotion happens only inside the seat's view within 90 m, to a cap of 12, and the husk carries `laneWalk`, a behaviour exported here that outranks its own and walks the lane in `point` mode (fact 15).
- Deaths: `physics.radialListeners` for blasts, `weapon:fired` for the player's own guns, and a public `tide.ray(origin, dir, range)` for anything else. A uniform grid makes each a few cells. A token kill pays 10 points through `score:gain` and no combo.
- `tide.knot(out)`: the middle of the thickest group of tokens and real husks together, for stages 3 and 4. `tide.friendlyUnder(origin, dir)` for the crosshair.
- `src/war/governor.ts`, as in the rules.
- `tools/scripts/war-chaos.mjs`, with idle troopers standing in for Bailiffs until stage 2. On the range, `?war=1` lays six lanes down its length.
- `src/war/war.test.ts`. `docs/notes/war.md`.

**Targets.**
- 240 tokens: `tide.update` under 0.3 ms at the median, 3 draw calls, under 45k triangles.
- Standing still for 60 s: the real count never passes its cap. No promotion in view within 30 m. At least 90% happen out of view or past 45 m.
- Walk 100 m away: every unhurt real husk past 70 m and out of view is a token again within 3 s.
- Unit tests: a blast kills every token inside it and none outside. A ray through three in a line kills the first. `scatter` empties the open ground within 4 s. The governor steps down in 3 s on a fake clock and back after 10.
- The bench passes its gates at 20 + 8 + 240. The numbers go in `war.md` beside fact 30's.
- A sheet of four screenshots at the moment of a promotion, at 45, 50, 55 and 60 m, in `tools/out/war/`.

**Try it.** `/?map=range&war=1`. Stand, shoot into the distance, throw a grenade long, walk toward them.

**Depends on.** Nothing.

**Risks.** A promotion in view may pop. The sheet is the check, and fog on the real map hides more than the range does. Token kills paying less than body kills may read oddly from the door gun.

---

## Stage 2. Friendly soldiers

**What the player gets.** Eight Bailiffs who hold a line, follow, shoot what you are not shooting, get mauled, get knocked over and get up. The crosshair turns green over them.

**Build.**
- **The look.** Two baked bodies on the shared rig: `bailiff` (rifle) and `bailiffHeavy` (broad, belt gun, drum). Rows in `src/characters/archetypes.ts`, builders in `tools/bake/archetypes/bailiffs.ts`, lines in `animation/styles.ts` (upright, against the husk's hunch). Bone-white hard shell over navy, squared shoulders, a flat-topped sealed helmet with one visor bar, a tabard to the knee. `src/allies/props.ts` fits the tall pack frame, the whip aerial and the cold white beacon (`0xdfefff`) at run time, the way `commander/props.ts` does. A sergeant is a `bailiff` with two beacons and one pauldron.
- **Loading.** `ArchetypeDef` gains `maps?: readonly MapId[]`. `Game.ts` passes `characters.load` the rows with no `maps` plus the rows that name this page's map. The new rows name `sump` and `range`. The lab's spawn list shows only what is loaded.
- **The system.** `src/allies/`, on `ctx.allies`, idle elsewhere. Two lines in `Game.ts`, after `enemies`.
  - `data.ts`: health 160, bursts of three at 26 a round, sight 45 m.
  - `ally.ts`: one man. A pooled character and a point on the nav, like an enemy.
  - `orders.ts`: `hold` (a post from an authored list, kneeling when enemies are near, through `anim.setPosture`), `advance` (to the next line of posts, half moving while half fire), `follow` (down `nav.flowDirection` to a slot 4 to 9 m behind the player, never across a jump or pad link, never standing in a doorway the player is within 3 m of, stepping aside when walked into). Posts are reached with the Outpost's `RouteFinder`.
  - `fire.ts`: a target is the nearest enemy in sight that is not within 12 degrees of the player's aim, so they leave your kills alone. Rays through `enemies.raycast` and `applyDamage`, source `ally_rifle` or `ally_belt` (fact 10). Tracers and muzzle flashes through `fx`. The gun's sound is an existing id.
  - `prey.ts`: every half second each ally is given at most two husks, leapers or bombers that are nearer to it than to the player and within 12 m, 10 engaged at most. `maul` is the behaviour from fact 8: walk to the man, play the swing, hurt him on the hit frame.
  - `roster.ts`: `strength` and `floor` for the beat. A man who would die at the floor is knocked down instead and gets up at 40%. `lose(how, at)` kills a named man for the script, with a real ragdoll. When a beat opens with more men than its `strength`, the extra stay behind to hold the last room, so the count going on is always the script's. Reinforcements come from a token or a Docket.
  - `fire-rules.ts`: the friendly-fire table. `none` is the default: the player's rounds pass through, `weapon:fired` lines are tested for a green spark, a flinch and CHECK FIRE (once every 3 s), and a player or air blast over a threshold knocks a man down. He takes no damage from your side.
  - `events.ts`: `ally:contact`, `ally:down`, `ally:moving`, `ally:lastMan`.
- **Score.** `ALLY_SOURCES = /^(ally|ledger|tide)/` in `src/progression/data.ts`. `onKill` returns before the combo and the score for those.
- **HUD.**
  - `crosshair.ts`: a second ray against `allies.raycast`, class `friendly`, fill `--friend` (`#3dff7a`), nearest wins. The same class on `gn-ret` in `src/vehicles/hud.ts`, with a green bracket on each real Bailiff from a seat. The far battle's `tide.friendlyUnder` joins the same check, wired by whichever of stages 1 and 2 lands second.
  - `src/ui/hud/roster.ts`: "BAILIFFS 8" outside. Underground, one pip a man, and a pip goes dark when he dies.
  - Green chevrons on the minimap. Green silhouettes on the sonar.
- `tools/scripts/allies-live.mjs`, `src/allies/allies.test.ts`, `docs/notes/allies.md`.

**Targets.**
- Node tests: the floor holds. Prey is never more than two a man or ten in all, and never a husk nearer the player. `follow` never crosses a jump link. Rule `none` deals 0. A target inside the player's cone is never chosen.
- Range, 8 Bailiffs and 20 husks kept topped up, player passive, 90 s: 12 to 20 kills a minute by Bailiffs. Every man knocked down gets up. Nobody dies under the floor. No console errors. Allies cost under 0.5 ms at the median.
- With a bot that shoots: Bailiffs take 25 to 40% of the kills within 25 m.
- 30 kills by Bailiffs: score and combo unchanged.
- Crosshair at 5, 25 and 60 m: `friendly` within 0.1 s and not `hostile`. Behind a wall, neither. A husk in front of a Bailiff reads `hostile`.
- **The identification sheet,** `tools/out/allies/id.png`: a Bailiff beside a husk, a leaper and a stalker at 10, 25 and 50 m, in the range's light and in the dark. Measured from the picture: the Bailiff's body is at least 2.5 times as bright as the husk's at 25 m, and the beacon is at least 3 pixels at 50 m.
- Each new body under 2.5 MB. `/` requests no `bailiff.bin`.

**Try it.** `/?map=range&allies=8`, then spawn husks with O. Shoot at a Bailiff. Throw a grenade at his feet. Walk through a doorway with them behind you.

**Depends on.** Nothing. Use stage 1's bench again with real Bailiffs once both are in.

**Risks.** Bailiffs are points with no capsule, so they clip door jambs as enemies do. Prey only covers melee. A man who cannot die at the floor may look staged: the fights are tuned so the floor is rarely met.

---

## Stage 3. The air wing and LEDGER

**What the player gets.** A gunship that stays, a helicopter working the far side of the fight, and gun runs and airstrikes that mark the ground, count down and land. They never pick a spot you are on. They land on you if you run into one.

**Build.**
- `src/progression/callins/manager.ts`: `strikeAt(id, point, heading, options)` for `airstrike` and `warthog`. No ownership, no cooldown, `options.color` for the mark, `options.source`. It queues behind a strike of the same airframe. Exposed on `ProgressionSystem`. Also `holdCallIns(reason)` and `freeCallIns()`, which grey the chips and stamp NO SKY: used underground.
- `ac130.ts`: `Ac130` takes `{ holdSeconds, phase, center }`. `progression.station(center)` puts SPECTRE up with no ring and no countdown, held on its third stage, ONE-OH-FIVE UP (25, 40, 105 and Hellfire), and returns a handle with `move(point)` and `leave()`. The player's own AC-130 call while it is up moves it to their mark on its last stage, ALL GUNS, for 60 s.
- `src/progression/callins/wingman.ts`: WARRANT. The `Autopilot`, the attack airframe and the chin gun with no seat. It circles `tide.knot` 60 to 120 m from the player, a rocket salvo every 9 s, a gun burst between. Ally sources. `lose()` sends it off smoking. `mob(n)` hangs n drones on it, and `mobbed` reads how many are left. While it flies, the player's Attack Chopper call is held.
- `src/war/ledger.ts`: the tasker.
  1. **Where.** The thickest knot that is clear. A gun run's corridor (60 x 13 m) has no part within 14 m of the player, now or where their velocity puts them in 4 s. An airstrike's centre is at least 34 m from both. Nothing within 12 m of a live Levy or Docket, or 10 m of a real Bailiff. If no knot passes, the sortie waits.
  2. **Marked.** The existing projected strip or ring, true to the footprint from the first second, in hazard amber. A stamp with a countdown in `src/ui/hud/strikes.ts` ("AUDIT 1 / GUN RUN / EAST OF THE WRECK / 4"). The existing radio and incoming sounds. A hatch on the minimap. DANGER CLOSE while the player stands in a live mark (fact 17).
  3. **Committed.** Once marked it lands: 4 s for a gun run, 7.1 s for an airstrike.
  4. **It hurts.** The airstrike as it is today (fact 16). A tasked gun run: the tasker tests the player against each shell as it lands, 9 within 5 m, 45 a run at most.
  5. **Spaced.** At least 8 s between two marks within 60 m of the player, so two blasts' ragdolls never share a second.
  6. **It learns once.** After the player is hit, the next two marks add 8 m to every margin.
  7. **Plans.** `gentle`: a lane every 35 to 50 s and a ring every 50 to 70 s, all past 45 m. `push`: one mark every 20 to 30 s. `hold`: nothing. `free`: stage 12's.
- Bailiffs under a mark go prone and take nothing.
- `tools/scripts/ledger-live.mjs`, `src/war/ledger.test.ts`.

**Targets.**
- The rule in step 1 as a pure function, 10,000 random cases: no accepted mark breaks a margin.
- The range, a bot running random lines at 12.5 m/s among 20 husks and the tokens, 5 minutes on `push`: at least 8 marks. None contained the player when it was laid.
- A bot that keeps running whatever is marked takes more than 0 from tasked strikes over 5 minutes. A bot that leaves every mark takes 0.
- A bot stood at the centre of a marked ring one second after the mark: 80 to 130 damage. In a strip: 9 to 45.
- SPECTRE on station 8 minutes with a mortal player under it: no damage event from it. Progression under 0.3 ms at the median.
- WARRANT, 3 minutes: at least 10 m over everything on the map's `Skyline`. 4 to 8 salvoes a minute. Nothing fired within 15 m of the player or 10 m of a Bailiff.
- The player calls their own Warthog during a tasked run: one jet in the sky, the tasked run after it.
- `/?sandbox=progression` still 116 of 116.

**Try it.** `/?map=range&war=1&air=push&allies=8`. Run about. Then stand in a ring.

**Depends on.** Stage 1 for the knot, stage 2 to keep clear of Bailiffs.

**Risks.** Dying to your own side may read as unfair, even marked for 4 to 7 s: question 2. The amber marks and the player's own orange airstrike ring are close in colour.

---

## Stage 4. Friendly armour

**What the player gets.** Two tanks hull down, laying their guns on the tide and firing over your head, and three carriers that bring men up and hand out ammunition.

**Build.**
- `src/enemies/vehicles/ground.ts`, `mount.ts`, `index.ts`: `GroundOrder.side: 'enemy' | 'friendly'`. A friendly vehicle:
  - takes its target from a provider, which this mission sets to `tide.knot`. The laid gun keeps its rhythm: traverse, a visible line for a second, fire;
  - never fires within 20 m of the player or 10 m of a Bailiff;
  - fires as an ally (fact 10) with blasts at `selfDamage: 0, playerPush: 0`;
  - takes nothing from the player or the air wing, and full damage from enemy blasts and from `vehicle.take` called by a script;
  - does not ram the player, and shows green under the crosshair.
- `data.ts`, `models.ts`: `levy` (the tank's hull with a new turret) and `docket` (a new eight-wheeled hull with a remote roof gun and a ramp), both bone-white and navy. `VehicleKind` gains both.
- A Docket's ramp is an ammunition point: one ammo pickup every 30 s while it lives. That is why the player protects carriers. `allies.reinforce` walks four men out of it.
- The mission's `vehicle` step gains `side`.
- `vehicles.test.ts`, `vehicles-live.mjs` with `VEHICLES_STEP=friendly`, `docs/notes/vehicles.md`.

**Targets.**
- Tests: a friendly tank never selects the player. Player damage to it is 0. An enemy blast counts.
- Range, 2 Levy and 3 Docket, 3 minutes with the far battle on: a shell every 5 to 7 s from each tank. The nearest any landed to the player is over 20 m, to a Bailiff over 10 m.
- A Juggernaut charging a hull is stunned, 3 of 3 (fact 33).
- Five friendly vehicles add under 0.4 ms of CPU at the median and under 40 draws.
- The Outpost's `VEHICLES_STEP=soft,heavy,turn` runs as before.

**Try it.** `/?map=range&war=1&armour=1&dev=1`. Shoot one. Spawn a Juggernaut and bait it into a hull.

**Depends on.** Stages 1 and 2.

---

## Stage 5. The map outside

**What the player gets.** The site: a yard and a pad, a trench line, 40 m of spoil heaps, the rim of a pit 110 m across with bodies coming over it, and a road down to a gate.

**Build.** `src/world/map/sump/`: `plan.ts` (every number), `index.ts`, `surface.ts`, `pit.ts`, `proof.ts`, `sump-map.test.ts`, built with the Outpost's `Site` helper. A row in `maps.ts`, `MapId` and `MAP_IDS`. The contract's row waits for stage 7, which is the first stage to have both the map and the mission.

| Place | Where (x, z) | What it is for |
|---|---|---|
| Yard and pad | z 76..104, pad at (0, 88) | The landing. Rack at (40, 68). The overwatch mast at (-44, 80), 14 m |
| Line One | z 60, x -80..80 | Trench and parapet. Tank scrapes at x -40 and 40. Dockets behind at (-70, 70), (0, 72), (70, 70) |
| The Spoil | z 20..58 | Heaps 3 to 4 m high, staggered so no line runs straight north. Three old wrecks. Two roads north at x -40 and 40. A drain grating at (40, 30). The burnt Docket at (-22, 34) |
| The Lip | z 15 | Rim road. Line Two, a pipe trench, at z 22 |
| The Sump | centre (0, -40), radius 55 | Three terraces of 6 m down to a floor at y -18. The Lid, 34 m across, in the floor |
| Haul ramp | from (30, 0, 12) to the Gate at (-24, -12, 2) | 14 m wide, down the south wall. The Gate is a `split` door, 10 m wide |

- Bounds x and z -110..110, y -50..70. Light bounds y -48..14.
- **The depth limits** (fact 21): in `src/world/nav.ts` the lowest ray end comes from `bounds.min.y - 1` in place of `BOTTOM_Y`. In `src/enemies/movement.ts` the fall-out line is `min(-40, bounds.min.y - 4)`. Both after the enemies agent has landed.
- `spec.roads` for the tanks. Tide lanes and cover marks, the flight's marks and every post, in `src/campaign/missions/sump.places.ts`, which this stage creates and stage 8 adds to.
- `spec.spawns` authored by area, each tagged with its zone. `src/enemies/spawner.ts` gains `only(zones)`, which the mission calls (fact 25).
- `Site.barrier` keeps the player off the terraces and out of the pit: the only way down is the ramp.
- Views for every place, as the Outpost's `index.ts` has.
- `tools/scripts/sump-map-headless.ts`, modelled on the Outpost's. `docs/notes/world.md`.

**Targets.**
- Static, outside only: under 200k triangles, under 350 colliders, all boxes and arcs from the kit, under 70 baked lights.
- The other maps build what they built: Crucible 148k nav nodes, Kill House 4507, Outpost 37.7k.
- Every mark on the graph and on a floor. A tank's width swept along both roads: nothing in the way. Every lane walkable end to end.
- The flight's route and WARRANT's circle clear `Skyline` by 12 m everywhere.
- No ray leaves the site at 8 heights. Random hands for 300 s from 10 places: no falls, no escapes, nobody on a terrace.
- Page load to playing within 2 s of the Outpost's in the same session (`killhouse-boot.mjs`).
- Draws under 220 and triangles under 600k at the widest view with nobody on it.

**Try it.** `/?map=sump&contract=crucible&autostart=1&dev=1`, and `/?sandbox=map&map=sump`.

**Depends on.** Nothing.

**Risks.** The pit is the largest curved thing any map has built. A site 220 m across with a cave to come will push boot time on 8 GB.

---

## Stage 6. The mission's plumbing

**What the player gets.** Nothing to play yet: sixteen empty beats that run in order, a panel to jump between the beats of any mission, the Outpost's included, and a radio box that can be the Remainder. It is what lets stages 7 and 9 to 12 be built apart.

**Build.** All of it is additive, and none of it reaches for a system that may not be there yet: steps that belong to another system go through the registry by name, and warn when nothing answers.
- `src/campaign/index.ts`, `events.ts`: a call registry, `campaign.calls.set(name, fn)`, asked before the host's own `switch` (fact 5). `campaign.jump(id)`: the run is rebuilt and opens at that beat.
- **Who registers.** Each system registers its own calls in its `init`: `allies:*` in `src/allies/index.ts`, `tide:set` in `src/war/index.ts`, `air:plan` in `src/war/ledger.ts`. For a system that landed before this stage, this stage adds those few lines. For one that lands after, its own stage does. So a later stage can script a call whose system is not in yet: it warns, and takes effect the day that system lands.
- `src/lab/panel.ts`, `index.ts`: the **Mission** section. One button a beat, the running one marked. `window.__lab.beat(id)` for bots.
- `src/campaign/types.ts`, `runner.ts`, `host.ts`, `validate.ts`, `testkit.ts`:
  - steps `ally` (tag, kinds, mark, order), `roster` (strength, floor), `lose` (how, mark), `tide` (lanes, front, counts), `air` (plan). Each is checked for its marks by `validate.ts` and handed to `calls` as `allies:form`, `allies:roster`, `allies:lose`, `tide:set`, `air:plan`;
  - `pour` (tag, id, from, total, alive, every): the host spawns `id` at a mark while fewer than `alive` of the tag live, until `total` have come;
  - `squad` with `orders: 'hold'` makes swarm bodies dormant, and `release` wakes them (fact 3);
  - `boss` with `kind`, `health`, `without` (fact 4);
  - `Mission.speakers`, a per-mission `WHO`, and a `retag` step that changes one speaker's name and tag from then on.
- **Speakers.** `Speaker` (`enemies/commander/lines.ts`) gains `remainder` and `ledger`. `Portrait` draws a carrier wave for the Remainder. The Commander's portrait gains a `closed` tone: grey, unblinking, the mouth a beat late.
- `src/campaign/missions/sump.ts`: the sixteen beats of section 1 by id and title, each a checkpoint, each ending after 5 s for now. Its sixteen checkpoint marks are a small table in the file itself, from this plan's first layout, until stage 7 swaps them for stage 5's `sump.places.ts`. `sump.lines.ts` with the 23 reused rows imported from `outpost.lines.ts` by id (fact 28) and the first new ones. `sump.test.ts`. A row in `missions/index.ts`.
- `docs/campaign/SUMP.md`, begun: the shape and the beat table. `docs/notes/lab.md`.

**Targets.**
- `runner.test.ts` and `outpost.test.ts` pass unchanged, and the Outpost plays: `OP2_BEAT=breach` on `outpost-map-live.mjs` as before.
- `sump.test.ts`: no dangling names. Playable from the first beat to the last. Finishable after a death in every beat. Startable from every beat.
- New runner tests on the fake host: a dormant squad does nothing until `release`. `pour` never has more than `alive` out and stops at `total`. `retag` changes the next line's tag and no earlier one. A step whose call nobody registered warns once and does not hold the script.
- In Chrome, on the stub mission: the panel lists its beats, a click on each lands in it within 2 s with no page load, and no console errors.
- A reused row plays its take: `voice.test.ts`'s method, with `mission.cmd.bar.lights`.

**Try it.** `/?mission=stub&map=killhouse&autostart=1&dev=1`: open the panel and jump between the stub's beats. Once stage 5's map is in, the Sump's own sixteen: `/?mission=sump&map=sump&contract=crucible&autostart=1&dev=1`.

**Depends on.** Nothing.

---

## Stage 7. The fly-in and the battle outside

**What the player gets.** Minutes 0 to 9:30: the film, the door gun over the whole war, the landing, the line, the push to the rim, and the Juggernaut.

**Build.**
- A contract row in `src/contracts/data.ts`: id `sump`, map `sump`, `ai: 'swarm'`, `waves: 'swarm'`, `wounds: 'limbs'`, `mission: 'sump'`, `locked: true`, and the Council's notice for Form 7743-R. `ContractId` gains it.
- `sump.ts` takes its marks from `sump.places.ts`. A test that every call these five beats make has something registered for it.
- **The beats,** in `sump.ts`:
  - `briefing`: five shots on the existing cutscene player. `council.brief.line` (recorded), then new text. The last frame is the unregistered sender's one word. Council: "That sender is not on the register. Do not reply. Replies are billable."
  - `flyin`: a `ride` on a route of marks. `DoorGunner.round` reports each ray to `tide.ray` (fact 14), and the far battle raises the signal `seat:fired` on the first one. `council.brief.thanks` (recorded) at the door. On `seat:fired`, `cmd.in.hello` (recorded), then the Council in text: "Please disregard. That account is closed." At the east rim `cmd.in.door` (recorded) and `tide.scatter(6)`. At the north rim six drones under `squad`, with `laneWalk` to the door. No mark has `hit`: you land.
  - `line`: `ally` and `roster 8, 8`. `air gentle`. Three bombers on a route to the middle Docket, and a hint: "SHOOT THE TANK". Overwatch from the mast: when a husk winds up on the player from outside their view within 6 m and the mast has a line, a glint, a beam (`fx` beam `sniper` in white) and it drops, at most once every 6 to 9 s. The rack.
  - `push`: `tide` front to z 22, `ally advance`, `air push`, the tanks on their roads. Twelve skitters `pour` from the grating under TALLY 2 with 40 tokens round them, and `vehicle.take` burns it. `wingman.mob(6)` with six drones: all shot off inside 25 s keeps WARRANT, else `lose()`. The launcher, and `council.wreck.balance` (recorded) on taking it.
  - `juggernaut`: `tide` halted. `cmd.lz.trucks` then `cmd.boss.stores` (both recorded). `boss` with `kind: 'juggernaut'` at the head of the ramp, wearing the cap through `Props.fit` (fact 24). Its first target is TALLY 1, killed by script when it closes to 7 m. `council.turn.fine` (recorded) on the wreck. On the kill a husk ragdoll leaves the suit, the unregistered sender speaks, and the Council follows with `council.soft.receipts` (recorded).
- `docs/campaign/SUMP.md`: the site, and these five beats.
- `tools/scripts/sump-play.mjs`, a bot that plays from any beat, modelled on `mission-play.mjs`.

**Targets.**
- `sump.test.ts` still passes with these five beats filled.
- The ride: no damage event on the parked body in 10 runs. A bot holding the trigger on the tide kills at least 150 tokens and 6 of 6 drones. The combo at landing is printed, and if it is over 12 the ride's kills stop counting toward it.
- `line`: with a bot that shoots the tanks, the Docket lives 5 of 5. With one that does not, it is lost.
- `juggernaut`: dead in 60 to 100 s with a bot using the launcher. Left to the army alone, it has more than 40% of its health after 90 s, so the player matters.
- The bot plays `flyin` to the end of `juggernaut` in 7:30 to 10:00 with no console errors.
- `WAR_BEAT=flyin`, `line`, `push`, `juggernaut` each pass the bench gates.
- The Outpost's tests pass unchanged.

**Try it.** `/?contract=sump&autostart=1`, or `&beat=line`, `&beat=push`, `&beat=juggernaut`.

**Depends on.** Stages 1 to 6.

**Risks.** This is the stage where everything is on at once, and no bot can say whether a war this size reads as a war. The Commander's recorded lines name Outpost things ("this outpost", "the wire", "the trucks"). They were chosen to read as a dead man repeating himself: question 3.

---

## Stage 8. The map inside, and the dark

**What the player gets.** The Works: a bright hall, a shaft, a pipe gallery, a line of hung carcasses, a press hall and the chamber under the Bore. A lamp on your helmet, beacons on your men, and darkness that is dark.

**Build.**
- `src/world/map/sump/works.ts`, `deep.ts`, `kettle.ts`, and their numbers in `plan.ts`. The route spirals clockwise round the Bore and down.

  | Room | Where | Floor | Size and notes |
  |---|---|---|---|
  | Receiving Hall | south, x -28..28, z 6..36 | -12 | 8 m ceiling, with 4 m of ground over it. Two conveyor lines and a sorting pit as cover loops. Crane rails at y -5 with three winch housings. The last bright room |
  | The Drop | west, centre (-52, -40) | -12 to -30 | 22 m across, and a well that goes on down to y -46 below the route's door. A ramp round the wall, broken for `PARKOUR.dash.gap` (18 m). A service stair behind a door. Two sniper ledges. One ledge only a wall run reaches |
  | The Flare Line | north, x -35..35, z -84..-78 | -30 | 4.5 m ceiling. Pipe runs, two side rooms, a crew room |
  | The Tallow Line | east, x 46..58, z -72..-8 | -34 | 9 m ceiling. An overhead line of carcasses, eight lamps |
  | The Cage | (40, 6) | -34 | 10 x 8 m |
  | The Press Hall | south, x -30..30, z 0..44 | -40 | 18 m ceiling, shut doors, the rendering line 16 m up, spawn points of its own |
  | The Throat | a curved decline, 30 m | -40 to -46 | |
  | The Kettle | centre (0, -40), 64 m across | -46 | A terrace ring at y -40 with stairs and a wall-run line. The roof at y -28, the Bore rising through it to the Lid. Four chutes. Two brake housings on the ring |

- Slots in the Flare Line and the Tallow Line look into the Kettle, so the player keeps seeing the one warm light they are circling down to.
- Every scripted door takes its hole from the mission's `doors`, as the Outpost's do.
- Nav with no `levels`, `mutual: true`. Spawn points by area.
- Two minimap charts, split at y -6 (`src/world/minimap.ts`, `src/ui/hud/minimap.ts`).
- **The dark,** in `src/render/`:
  - `DynamicLights.hold(id, position, color, intensity, radius)` and `release(id)`: a light that stays, in one of 4 reserved slots of the 8;
  - `render.setVolumeGain(value, seconds)`: one uniform scaling the baked volume and the fog's share of it;
  - a `pitch` grade for the seconds of black, beside `blackout`;
  - `characters` scales `uFill` with the gain, down to 0.15, so a body in the dark is dark and a body in the lamp is seen;
  - work lamps are emissive meshes on one material the mission can switch.
- The helmet lamp: a held light 0.4 m ahead of the eye, radius 14 m, on when the gain is under 0.5. Each Bailiff's beacon becomes a held light for the three nearest.
- `host.call('lights', ...)` moves to this kit through the registry, and the Outpost's `emergency` keeps doing what it does.
- `sump-map.test.ts` and the headless sheet grow. `docs/notes/world.md`, `render.md`, `characters.md`.

**Targets.**
- The whole map: under 320k static triangles, under 600 colliders, under 150 baked lights with small radii underground. Light cells 1.3 m tall or less.
- Swarm reach, the test in `enemies.md`: husks from every chute and spawn point to 12 player spots, one in each room: no stalls, and no body routed through a wall by a drop link.
- `RouteFinder` legs for the Bailiffs from each room's entry to its posts and to its rejoin door.
- The Drop's break: crossed 10 of 10 by double jump and dash, and by wall run. 0 of 10 by a run and by a double jump.
- Four held lights cost under 0.2 ms. With the gain at 0 in the Tallow Line, the frame's mean brightness is under 3% of its lit value, and a Bailiff 6 m away in the lamp is at least 10 times brighter than the wall behind him.
- The Outpost's barracks look as they did: a screenshot before and after.
- Boot within 3 s of the Outpost's in the same session.

**Try it.** `/?map=sump&contract=crucible&autostart=1&dev=1`, then the panel's views. `/?mission=sump&map=sump&contract=crucible&autostart=1&beat=drop&dev=1` once stage 6 is in. `&dark=0` puts the gain back to 1 anywhere.

**Depends on.** Stage 5, in the same folder, so after it and not beside it.

**Risks.** Whether the dark frightens or only annoys is beyond any bot, and so is how it looks on the owner's Retina screen. The lamp's strength and the fill's floor are the first two numbers to try. Soft light and some leaks are expected at 1.3 m cells.

---

## Stage 9. The Commander, Reissued

**What the player gets.** Minutes 9:30 to 14:25: the run down the ramp, the gate shutting, the dead on parade, and the Commander back as something that is neither a Juggernaut nor a Titan.

**The boss.**
- **Why he is back.** His body came to Tallow with the Outpost's dead. The hive is a tide that never knew how to stand in a line, so it read him and reissued him as its officer. He believes he has been reinstated. It lets him.
- **Look.** A new baked body, `reissued`: 2.4 m tall and starved thin, long arms, the opposite of the suit that was too big for him. A dress greatcoat grown into the body, the cap grown into the skull. A pistol in the left hand. The right arm is a graft, a long bone glaive. Three violet nerve cables run from his back to three winches on the crane rails. His feet brush the floor.
- **How he moves.** The cables sling him between marks along the rails, with a lane on the floor for 0.9 s before each swing. Off the cables he walks at 3 m/s. He never sidesteps a crosshair (fact 8).
- **What he does.**
  - *Orders.* "By ranks. Advance." wakes one rank of six from the parade. He points at a Bailiff, a violet line runs to the man for a second, and the three nearest husks take that man as prey.
  - *The glaive.* A swing off the cable along the lane, 34 damage. A sweep on a 5 m zone, 1 s of warning.
  - *The pistol.* A laser on you for 1.2 s, then one round of 30, if you stood still for it.
  - If the player is out of his sight for 6 s he goes and kills a Bailiff, twice at most. That is how 8 become 6.
- **How he dies.** No hit takes more than 4% of an issue. At 0 he drops in a heap, through `gore.knockdown`, and the cables go slack. For 5 s the shutter of the nearest winch is open: 700 health, soft, about two rockets or a long burst. Then the cables haul him upright, and he is whole again.

  | Winch | His gift while it stands | When it breaks |
  |---|---|---|
  | RANKS | He wakes the parade, a rank at a time | Every husk of the ranks still standing drops. `cmd.plate.report` (recorded): "Second Platoon? Second Platoon, report. Anybody." |
  | STORES | Each reissue gives back his health and every limb you took | He comes back with what you left him |
  | LEASH | The cables sling him | He is on foot |

  With all three gone he cannot be reissued. At 12% he kneels with his hands up, in the existing posture. "I filed to stay dead. Somebody lost the form." You kill him.
- The player chooses the order by where they drop him. The boss bar shows three pips.

**Build.**
- `tools/bake/archetypes/reissued.ts`, a row in `archetypes.ts` naming `sump` and `range`, a style line.
- `src/enemies/reissued.ts`: behaviours, attacks, and a `BossController` whose `filter` holds his health at 1 while a winch stands and starts the drop. A reissue with STORES standing swaps the body for a fresh one of the same row under the flash of the haul. A row in `enemies/data.ts`. `EnemyId` and `ENEMY_NAMES` gain `reissued`.
- `src/enemies/vehicles/structure.ts`: `Structure`, a `Vehicle` that does not move, with a shutter that makes its part soft (fact 20). Kind `winch`. Stage 12 reuses it.
- `src/ui/hud/boss.ts`: pips from the boss, not from the word `titan`.
- Cables: one instanced mesh of links along a hanging curve from each winch to his back, about 40 instances.
- The beats `ramp`, `reissue` and `count` in `sump.ts`:
  - `ramp`: `air hold` at the first turn, the overwatch signs off, `sweep` and `spawner.only(['works'])` as the Gate shuts. `cmd.lz.gate` (recorded), then text: "We take deliveries now."
  - `reissue`: 18 husks under `squad` with `orders: 'hold'` in three ranks, 36 tokens behind. `roster 8, 6`, the Bailiffs on a kneeling line at the south end. `cmd.mess.hold` (recorded) as the player walks in among them. `cmd.mess.now` (recorded), and the fight starts. `cmd.stack.pension` (recorded) at his second reissue. After the first reissue the Council, in text: "The asset is being reissued from three points of supply. Please close them."
  - `count`: `retag` to THE REMAINDER. Its first full box reads the run's real numbers from `progression`: "{kills} today. {limbs} in pieces. You leave so little, Supplier." Council: "Reissued personnel are not eligible for a second pension."
- `tools/scripts/sump-boss.mjs` with `BOSS=reissued`. `docs/notes/enemies.md`, `vehicles.md`, `SUMP.md`.

**Targets.**
- A bot that never shoots a winch does not win in 4 minutes. A bot that shoots the open winch wins in 2:30 to 3:45.
- Every attack's warning is at least 0.6 s, asserted from the data. Off the cable he never passes 4.5 m/s.
- 18 dormant husks cost under 0.3 ms of enemy AI.
- 10 runs: 6 Bailiffs leave the hall every time.
- He kneels at 12% and dies to one more hit.
- `WAR_BEAT=reissue` passes the gates.
- The body is under 2.5 MB.

**Try it.** `/?map=range&dev=1` and spawn him from the panel with three winches. `/?contract=sump&autostart=1&beat=reissue`.

**Depends on.** Stage 1 for the parade's tokens, stage 2 for the Bailiffs and prey, stage 6 for the steps, stage 8 for the hall. The `ramp` beat's `air hold` and the overwatch signing off are calls into stages 3 and 7, and take effect when those are in.

**Cut if needed.** Two winches. No body swap: STORES only refills his health.

---

## Stage 10. The descent

**What the player gets.** Minutes 14:25 to 18:40. A dark shaft with things climbing it, lasers across it, and a gap your squad cannot cross. A tunnel lit by one flamethrower. Six men become three.

**Build.**
- `drop` in `sump.ts`:
  - `setVolumeGain(0.25)` from here on. `roster 6, 5`, `ally follow`.
  - 48 tokens as pink points climbing the far wall (the tide's hostile mesh on a wall lane, with the leaper's accent).
  - Ten leapers through `pour`, six alive at most, from the wall spawn points. Their wall cling and pounce are the existing role.
  - Two snipers on the ledges at `threat` 3: the existing swarm row, laser and all. They are the dead security marksmen nobody relieved.
  - At the break the Bailiffs take the stair. `lose('pulled', mark)`: a leaper's pounce on the sixth man, his ragdoll goes over the edge and his beacon stays lit all the way down. The shaft is a well that goes on to y -46 below the route's door, so he falls about 26 m, a second and a half at a ragdoll's gravity.
  - The squad re-forms at the stair's foot at 5. On the feed, from the Remainder: "Received."
  - A `rack` with `optional` for the Stakegun.
- `flare` in `sump.ts`:
  - `roster 5, 3`. A burner on a route round the far corner, lit before it is seen. Twelve husks ahead of it. Two more burners in the side rooms. 16 alive at most.
  - A scripted spill: a pipe bursts and a 6 m stretch of floor burns for 40 s, with two Bailiffs on the far side. The fire is built the way a wreck's is in `enemies/vehicles/wreck.ts`: the `burning` emitter and a damage tick on anyone in reach. `lose('cut off', mark)` twice: they walk away round the side passage and are not seen alive again. "Received." twice.
  - The Kiln on the dead crew, on the path. The Council, in text: "Item recovered. The flare crew's lease has lapsed." A hint: "FIRE IS LIGHT".
- The Remainder's lines for both beats, short, in `sump.lines.ts`: "They are leased to you. We are buying out the lease."
- `SUMP.md`, `sump.test.ts`.

**Targets.**
- The bot plays `drop` and `flare` in 3:30 to 5:00.
- 10 runs: the roster reads 5 at the end of `drop` and 3 at the end of `flare`, whatever the bot did.
- Never more than 6 leapers or 16 bodies alive. Both gates of `WAR_BEAT=drop` and `flare`.
- A screenshot sequence of the fall shows the beacon for at least 1.3 s.
- No leaper or husk stalls in the shaft over 5 runs (the reach test, live).
- A checkpoint at each beat promises the Kiln from `flare` on.

**Try it.** `/?contract=sump&autostart=1&beat=drop`, `&beat=flare`.

**Depends on.** Stages 1, 2, 6 and 8.

**Risks.** Sniper relocation has never been seen running (`enemies.md`, known limitations), and leapers have only been run in the wave game. Burners never choose a Bailiff, so the fire that takes two of them is the script's.

---

## Stage 11. Lights out, and the Titan

**What the player gets.** Minutes 18:40 to 24:30. The lights go out and the ninjas come. Then nobody. Then a Titan in the dark.

**Build.**
- `lights` in `sump.ts`:
  - The checkpoint is before the room, never inside it.
  - Three Bailiffs follow. Halfway down the line, the Remainder in text: "You brought light into the works. We do not use it."
  - `cmd.bar.lights` (recorded): "Lights." The eight lamps go from the far end toward the player, one every 0.35 s, the last over their head. The helmet lamp flickers out. `pitch` for two seconds. The music stops.
  - `cmd.in.talk` (recorded): "There. Now we can talk properly."
  - Three beacons are all there is. `lose('out', mark)`: one goes out. `lose('up', mark)`: one is pulled upward, its light rising to the carcass line. The third man fires a burst, and its flash shows four stalkers standing still among the hung bodies, placed there dormant at the beat's start. `lose('last', mark)`.
  - The lamp comes back at 40%. Four stalkers wake, and two more follow: four at once at most, six in all. Every attack keeps its existing tell, the blade sound and the purple glint. The sonar lights them for 4 s. A burning stalker is a torch.
  - When the last dies, emergency red comes up: gain 0.2 and the `blackout` grade.
- `alone`: nothing spawns. Racks for the autocannon and the Lance in the Cage. `council.arm.take` (recorded). The Council in text: "The 14th Recoveries have been written off. Their deposit is forfeit." The Remainder has no line here, on purpose.
- `titan`:
  - `boss` with `kind: 'titan'`, `health: 0.6`, `without: ['armR', 'forearmR']`, hung on the rendering line 16 m up as a body with no brain until the doors shut, then dropped: its own `onLand` is the entrance.
  - `enemies.reinforcements = ['husk']` for the mission (fact 25), `spawner.only(['press'])`, 8 husks alive at most.
  - The Remainder: "It was delivered in pieces. We have most of it."
  - Its beam is the room's only light besides the lamp. Gain 0.1.
- `throat`:
  - Two bodies of a new row, `turned`: the husk's numbers in the `bailiff` body, beacon out, dormant. `EnemyDef` gains `model`, so a row can wear another row's body. They read red. They wake if shot or passed within 2 m.
  - The offer: "Every one of us came from your hand. Stay. We would not render you. We would keep you whole."
  - Health, armour, ammunition.
- `BOSS=titan` in `sump-boss.mjs`. `SUMP.md`, `enemies.md`.

**Targets.**
- For the 2 s after the last lamp, the frame's mean brightness is under 3% of the lit room's.
- Never more than 4 stalkers awake. Each attack's glint and sound fire, checked from events over 20 attacks.
- 10 runs: the roster reads 0 at the end of `lights` and 3 at its start, however the bot played `flare`.
- A bot with god mode off that pings the sonar and backs away with the shotgun survives `lights` at least 6 times in 10.
- The Titan dies in 90 to 150 s to a bot with the autocannon, legs then chest. Only husks join it, 8 at most. No bone of it is ever above the ceiling. No body leaves the hall.
- The crosshair over a `turned` body is `hostile` and never `friendly`.
- `WAR_BEAT=lights` and `titan` pass the gates.

**Try it.** `/?contract=sump&autostart=1&beat=lights`, `&beat=titan`, `&beat=throat`.

**Depends on.** Stages 6, 8 and 10.

**Cut if needed.** The `turned` pair first: the Throat is then an empty decline with the offer.

**Risks.** The Outpost's own lights moment was never judged by a person. A Titan indoors has never been run, and bodies clip big geometry.

---

## Stage 12. The Remainder

**What the player gets.** Minutes 24:30 to 28:45: the thing that has been talking, and a fight where a kill is not simply good.

**The boss.**
- **What it is.** The Works' render column come alive: a vat 14 m across with a column of fused dead rising 20 m out of it into the Bore. Steel vat rings from the kit, and between them about 150 of the far battle's tokens pressed together and slowly moving, so it is made of the game's own bodies. Three intakes at the vat's rim. Three arms, each a rope of bodies 18 m long in three segments. Nine metres up, set into the mass, the **speaker**: a pale figure in a contractor's suit, bootless (fact 34). The vat under it is the mission's one warm light.
- **How it talks.** Text only, in the mission's box under THE REMAINDER, with one-word receipts on the comms feed. It borrows the Council's words and gets them intimately wrong. It reads your real numbers. In the fight its lines are 8 words or fewer. At the end it drops the "we": "I had a contract once. I had a number. Do you still have yours?" Last words: "Sign for us."
- **Phase 1, Receiving** (about 1:30). Husks pour from four chutes, 14 alive at most, one in six a bomber.
  - Every 6 s an intake sends a tendril to the nearest whole corpse within 18 m and drags it in by the feet over 2 s.
  - The intake is armoured, except for the 2.5 s it is open to swallow. Shoot into it then: 500 health.
  - Or feed it a bomb. A bomber killed by the head has its tank intact, and it goes off inside for 400.
  - Or leave it nothing. A gibbed body, a charred one (the Kiln) and a staked one are refused: "Ash is not received."
  - Each body swallowed ticks RECEIVED on the HUD and adds a plate, 8 at most.
  - The Council's hint, in text: "The facility accepts deliveries at three intakes. It does not inspect them."
  - Three intakes destroyed ends the phase.
- **Phase 2, Arrears** (about 1:15). It tears loose and the arms fight.
  - Slam: a 9 m zone, 1.2 s, a shockwave of 30 that only hits a player on the ground. Jump it.
  - Sweep: a lane 14 m long, 1 s.
  - Throw: a body lands on a marked circle, 1.5 s.
  - Each segment has 350 health. A broken one sheds 4 husks and shortens the reach. Plates take the first hits: 150 each. That is what phase 1 was for.
  - Two arms destroyed ends the phase.
- **Phase 3, Open the Lid** (about 1:30). The last arm goes up to hold the Lid shut. "We are all coming now." Every chute opens.
  - Climb to the ring, by wall run and mantle or by the stairs, and break the two brake housings, 300 each. The Lid parts, and moonlight comes down the Bore: the only bright light underground.
  - LEDGER: "EYES ON. ALL CALLS FREE." `air free`: an airstrike is granted, and again 12 s after each lands.
  - Each strike whose finale lands within 12 m of the column takes a third of the core. Three end it. The column stands in the middle of the floor you are fighting on, and the finale's ring is 20 m, so each one is marked and then run from: up onto the terrace ring, or out past 20 m. `council.boss.hours` (recorded): "Contractor. Please conclude."
  - The arm that shields the speaker from the sky opens it from the side. An aimed shell on the speaker does five times, the rule the enemy helicopter's cockpit has, so a perfect autocannon round can stand in for the last strike.
  - It falls: a 22 m zone, 3 s of warning. Every husk alive drops.

**Build.**
- `src/enemies/remainder/`: `index.ts` (phases, the boss bar's source, signals to the mission), `intakes.ts`, `arms.ts`, `data.ts`. Parts are `Structure`s from stage 9. The body is one instanced mesh of tokens, and the arms are instanced links along a solved curve, about 70 instances.
- `src/gore/index.ts`, after the gore agent has landed: `corpsesNear(center, radius, out)`, each with `whole`, `charred` and `pinned`, and `take(handle)`, which hands the body over to be dragged and sinks it. Two entries in `GoreSystem`. If they slip, intakes run off `enemy:killed` alone: a kill within 18 m that is not gibbed, sliced or by fire feeds the nearest intake after 2 s.
- `src/ui/hud/boss.ts`: a `BossSource` (name, health, armour, pips) that a structure can provide. `src/ui/hud/received.ts`, the counter.
- `src/war/ledger.ts`: the `free` plan. `progression.freeCallIns()`.
- The speaker's figure, in the map's kit.
- Sounds, as synth recipes in `src/audio/synth/recipes`, after the weapons agent has landed: a many-voiced drone under its text, the intake's swallow, an arm's slam, the Lid's brakes.
- `kettle` in `sump.ts`. `BOSS=remainder` in `sump-boss.mjs`. `docs/notes/gore.md`, `enemies.md`, `SUMP.md`.

**Targets.**
- A bot with rockets and the Kiln wins in 3:30 to 5:00. A bot that never denies it a body and never feeds it a bomb still wins, in under 7:00: a sloppy player fights longer but never meets a wall.
- Every arm attack warns for at least 1 s, asserted from the data.
- Exactly three strikes within 12 m end it. A bot at 12.5 m/s that marks the floor 8 m from the column, from beside it, and runs is clear of the finale's 20 m ring with at least 2 s to spare. One that stays takes the rockets and is thrown.
- A gibbed, a charred and a staked body are each refused, 10 of 10.
- 14 real bodies and 150 still tokens: `WAR_BEAT=kettle` passes the gates, and the arms and tendrils cost under 0.4 ms.
- `enemies.killAll` at its death leaves nothing alive, and the mission moves on.

**Try it.** `/?contract=sump&autostart=1&beat=kettle`. `&phase=3` starts at the Lid.

**Depends on.** Stage 1 for the tokens its body is made of, stage 3 for the strikes, stage 6 for the steps, stage 8 for the Kettle, stage 9 for `Structure`.

**Cut if needed.** Arms as plain booms from the kit with a few tokens on them. Two intakes. One brake housing. The speaker's shell rule.

**Risks.** It is the largest new piece and a new kind of body. Whether feeding and starving it is fun or fiddly at speed is something only the owner's hands can say. Its lines are read during a fight, which is why they are short.

---

## Stage 13. The mission whole

**What the player gets.** The Sump on the menu, playable from the notice to the last line of text, with an ending.

**Build.**
- `ending` in `sump.ts`: a film up the Bore on the cutscene player. The Council reads the Notice of Recovery and its deductions in text. `radio.end.walk` (recorded). The last line on the feed.
- Redeploy lines: `council.redeploy.fee`, `cmd.redeploy.another` and `cmd.redeploy.told` (all recorded) until he is dead, then `council.redeploy.keep` (recorded) and the Remainder in text.
- The menu: the contract's tab and notice, shut until `op2_campaign_beaten`, with a line saying what opens it. The mission complete screen.
- `docs/campaign/SUMP.md` finished, in the form of `MISSION.md`: the shape, the site, every beat, every line in its place. A test, as the Outpost has, that the plan says exactly what the game says.
- `tools/scripts/voice-script.ts` writes `docs/voice/sump-script.md` and `.csv`, so the new lines are ready to record whenever the owner chooses. Nothing is generated.
- A pacing pass with the bot's times against section 1's table. A budget pass: `WAR_BEAT` for all 16 beats, in one table in `SUMP.md`.
- Every manual named in the rules, read once more against the code.

**Targets.**
- The bot plays from `briefing` to `ending` in 24 to 32 minutes with no console errors, and again dying once in every beat.
- `sump.test.ts` in full, and the four tests the rules name, unchanged.
- From a fresh profile on a production build: The Sump is shut. After the Outpost is won from its first beat, it is open.
- No file under `public/audio/voice` is new. `git status` on that folder is clean.
- Every beat's row in the budget table is inside the gates, or says by how much it is not and what was shed.
- Page load to playing under 15 s on a quiet machine.

**Try it.** `/?contract=sump`, from the menu, start to end.

**Depends on.** Everything.

---

## 5. Left out on purpose

- **Zombies that hunt friendlies freely.** It means retargeting about 58 lines of AI and a second flow field, in files another agent owns. Prey covers melee, and the script covers the rest.
- **Human soldiers on this mission,** and the Commander hopping from body to body among them. It needs the squad brain beside the swarm and beside friendlies it cannot see (fact 2).
- **A green crosshair that lies.** The spectacle plan had dead Bailiffs read green and then turn. The owner asked for the crosshair so that nobody is confused, so it is never spent on a trick.
- **Real friendly fire,** until the owner answers question 1. It needs a hook in `Combat.ts` and `Projectiles.ts`.
- **Any new recording, any generated audio, and any line for a Bailiff.**
- **Bailiffs who do parkour.** That they cannot is how the squad thins.
- **Bodies for the overwatch.** It is a mast, a glint and a beam.
- **Men on friendly vehicles, vehicles the player drives, and the player flying WARRANT.**
- **Enemy vehicles.** Nothing on Tallow drives.
- **A cave deeper than y -46, and rooms stacked on rooms.** The light volume has 48 cells of height.
- **A Titan that walks the tunnels,** or is heard for minutes before it is seen. Bodies clip big geometry, so it hangs in one hall.
- **A second lights-out in the last fight, and the hive rewriting the HUD.** One blackout is the owner's moment. A second spends it.
- **Baked low-detail bodies for the far battle.** The baker only gives LOD 0 to a pose, and primitives in fog are enough.
- **Wound anatomy for Bailiffs.** They are knocked down, lose limbs and die. They do not bleed out in stages.
- **Saving a mission between sessions.** The Outpost has the same gap. At 30 minutes it matters more, and it is its own piece of work.
- **New music.** The three states that exist are used.
- **Any change to the Outpost mission or to The Crucible.**

## 6. Questions only the owner can answer

Each has the default the build will use, so nothing waits.

1. **Can you hurt your own side?** Default: no. Your rounds pass through a Bailiff with a green spark and CHECK FIRE, your blasts knock him over, and only the Works and the script kill him. The other answer is real friendly fire, forgiving and billed by the Council, which costs a hook in the weapons code and means a squad you can wipe out yourself.
2. **May your own side's strikes kill you?** Default: yes, as the engine stands. The middle of an airstrike kills from full health, a gun run takes 45 at most, the gunship never hurts. All are marked for 4 to 7 s. If it stings, the gun run goes back to harmless and only the airstrike is dangerous.
3. **The dead Commander speaking in his old recordings?** Default: yes, 13 of his takes and 10 of the Council's and the pilot's, replayed where they now mean something else, with nothing recorded. If they sound cheap and not chilling, they become text and the mission has no voice at all until takes are made.
4. **Four bosses and nine introductions in about 30 minutes?** Default: keep it. If it runs long, the cuts are, in order: the `turned` pair, the fire wall in `flare`, a minute of `line`, the Commander's body swap. The breaths are never cut.
5. **The look of the friendlies.** Default: bone-white and navy, a square pack and aerial, a cold white beacon, and no green on the body, because lime is the husk's colour. Green is the crosshair, the minimap and the roster. The owner sees the identification sheet at the end of stage 2.
6. **Is the finale's exam right?** Default: you end the Remainder by calling three airstrikes onto the floor you are standing on and running, or by one perfect shell. If that reads as a gimmick, the strikes only strip its last arm and the gun finishes it.
7. **The Commander's end.** Default: off the books he kneels with his hands up, and you kill him. If he should be more monster than man, his last phase becomes a fight to the death and nothing else changes.
8. **The names.** Default: Tallow, the Sump, the Bailiffs, LEDGER, the Commander Reissued, the Remainder, and "Supplier" for you. Each is one row to change.
9. **Is The Sump shut until the Outpost is beaten?** Default: yes on the public site, open on the dev server, as Endless Humans is.
