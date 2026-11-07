# The Outpost: squads, cover, morale

`src/enemies/outpost/`. The human faction of sections 14 to 16. It runs when `ACTIVE.def.ai === 'outpost'`: `?contract=outpost`, or
`?map=killhouse`, which now resolves to that contract. For the swarm on that map use `?contract=crucible&map=killhouse`.

On every other contract `EnemyManager.outpost` is null and none of this runs. The swarm's only cost is a null check at seven hooks,
and `Postures.step` returning at once.

## Public API

```ts
const o = ctx.enemies.outpost;          // EnemyManager; null off the contract
o.wounds;                               // src/enemies/wounds, see docs/notes/wounds.md
o.soldierOf(enemy);                     // Soldier: morale, state, fate, squad, role...
o.doctrine;                             // The Commander's lever, see below
o.dread.value;                          // 0..100
o.hostile; o.prisoners;
```

Events, typed in `events.ts`: `comms:line`, `enemy:broken`, `enemy:surrendered`, `enemy:executed`, `enemy:backshot`, `enemy:escaped`,
`squad:broken`, `dread:spike`, `squad:drill`, `prisoner:grabbed`, `prisoner:questioned`, `prisoner:freed`, `prisoner:refused`, `prisoner:rearmed`.

```ts
o.captives;                             // Prisoners: .held, .signs(s), .freed
o.suppression;                          // .level 0..1, .blind, .cracks
o.track; o.stillFor;                    // the player's motion as the men read it, and seconds in one place
squad.goal; squad.drill; squad.grade;   // what it wants, what it is doing, what it is
squad.lieStill(); squad.stopLying();    // a mission's 'hold'
squad.obey(drill, seconds);             // the Commander. False if the squad cannot do it, and then nothing changed
```

| Listener | Event |
|---|---|
| `progression/` | `enemy:executed` for the Geneva Suggestion |
| `contracts/rewards.ts` | `enemy:backshot`, which pays the bonus as a second hit |
| `ui/Hud.ts` | `comms:line` for the feed. The kinds are what a voice bank will key on (section 19) |

## How it fits together

| File | Job |
|---|---|
| `index.ts` | The `Outpost` controller. Roster, orders, radio, fear events, hooks for EnemyManager |
| `doctrine.ts` | Numbers, roles, squad templates, wave strength, `Doctrine` |
| `morale.ts` | Morale states and Dread, as plain arithmetic |
| `perception.ts` | Sight, hearing, `Intel`: the shared picture and the view fan |
| `cover.ts` | Cover spots from physics rays at load, and choosing one |
| `routes.ts` | A* over the nav nodes, with a cost for ground the threat can see |
| `planner.ts` | Facts, drills, goals, and a search for the cheapest chain. No game state |
| `squad.ts` | The squad's brain: reads the facts, picks a goal, runs one drill at a time |
| `behaviours.ts` | What a man does with his legs: hold, move, flee, surrender, held, aid, downed |
| `weapons.ts` | Loadouts, suppressive fire, grenades |
| `aim.ts` | How a man hits something that moves |
| `rank.ts` | Conscript, regular, veteran, elite, as a table |
| `suppression.ts` | What being shot at, and a flashbang, do to the player |
| `prisoners.ts` | The signs, giving up, what a kneeling man does, and the E key |
| `waves.ts` | The wave loop. `createWaves` hands this to the game on a squads contract |
| `comms.ts`, `dropped.ts`, `soldier.ts` | Radio lines, guns on the floor, one man's state |
| `src/characters/animation/postures.ts` | Crouch, cover, lean, hands up, kneel, cower, drag, revive |

The squad thinks twice a second and gives orders. Men carry them out alone, so all tactics live in `squad.ts` as a choice of where
to send whom. Morale outranks orders: `collapse` takes a man out of the squad.

## The squad's mind (F.E.A.R.)

A squad holds facts as bits, wants a goal, and `makePlan` searches 12 drills for the cheapest chain. Nothing is scripted, so the same drills come out differently:

| What the player does | What the planner gets to |
|---|---|
| Nothing seen yet | `search`, both teams, sprinting if the trail is fresh, aiming ahead of a runner |
| Fights in the open | `baseOfFire`, `flank`, `rush` |
| Another squad already has it pinned | `flank`, `rush`: the fire is shared, so a fresh squad goes straight round |
| Sits still 4 s | `frag` or `flash`, `rush`, because the moment prices them at about 1 |
| Runs | `cutOff`, for the door it is heading to, then `rush` if anyone gets eyes on |
| Goes through a door and out of sight | `breach`: stack, bang, enter |
| Reloads, gets blinded, or drops under 40% | The whole side gets OPENING, and that squad replans to `rush` at once |
| Holds a prisoner | `flank` costs almost nothing and `frag` is forbidden |

Goals are `destroy`, `survive`, `recover`, `waylay`. A drill that fails is off the table for 9 s. Facts that change in the squad's favour (`REACT_TO`) throw the plan away. Prices get 12% jitter.

**Narration.** Each drill announces itself as it starts, and every new kind of line is in `comms.ts`. A player credits only what they hear, and a line such as "It's running! Cut it off!" is also the warning.

**Ambush.** One squad at most, only if another is pushing and the threat is heading for a door near it, or after a retreat. "On the door. Not a sound." goes out, then every man is `silent`: no fire, no voice. It springs at 15 m, on 2.2 s of being stared at, or on being shot at, and everyone opens up on the same frame. A mission's `orders: 'hold'` is this with no time limit, and `host.ts` calls `lieStill`.

**Towers and lanes** come from the map, with no hand-placed data. Cover spots already exist on every floor. Base men score height, `climb()` looks on other floors, and `holdsHeight` keeps a gun up there instead of walking it down to search. Guns work the lane when they lose sight. Blind fire stops 7 s after the last sighting, because a belt on an empty lane is a wasted belt.

## Decisions worth knowing

- **Under fire only one team moves.** A flank, a cut-off and a retreat each send one team while the other covers. A `search` sends both a beat apart, because waiting for turns on the way to a fight was 40% of why men sat idle. Team 0 holds the heavy weapons, so a machine gun is never sent round the side.
- **Routes are not the flow field.** The flow field leads to the player, and a flank is exactly the route that does not. `RouteFinder`
  rebuilds walk links from the nav grid's public arrays. Soldiers do not use pads or jump links.
- **The view fan makes hidden routes cheap.** `Intel` sweeps 72 rays round the threat at most once a second, so "can it see that?" is
  a lookup during A*. Smoothing has to respect it too: straightening a route used to undo the detour. A test covers this.
- **Nobody gets the position for free.** A man needs a clear line, the right facing and time to be sure. A man with his head down
  sees nothing. Gunfire carries 42 m, with an error of 18% of the distance. A sighting goes round the squad at once, and to other squads
  1.2 s later.
- **Command's fix stops hiders winning.** After 6 s of nobody knowing, `Outpost.fix` passes on a position within 5 m. It also gives
  squads their first objective, including in a mission, where no wave ever starts.
- **`movement.ts` assumes the swarm**, and soldiers work round three things in it. `e.flowUntil` is cleared every frame, or a stalled
  point move would walk a retreating man to the player. `e.probeAt` is Infinity, because routes are checked when made. `e.footbound`
  stops `tryJumpUp`, because a body blocked at a door jamb leapt onto the catwalk 4.5 m up.
- **`Soldier.downed` is not `Enemy.downed`.** The Enemy flag means gore has the body for a knockdown. The Soldier flag is the wounded state.
- **Prisoners stay in `alive`** because they can still be shot, and `hostile` and `remaining` subtract them. After 45 s, or past 8 held,
  they walk to a gate with their hands up. Killing one on the way is still an execution. A round or grenade from his own side is not.
- **A refusal is read a frame late.** A shotgun shell is eight hits, and all eight have to land on a man with his hands up, or the first one
  gets him off his knees and the other seven find the plate.
- **Orders never lie.** `squad.obey` plans first, and the Commander only speaks if the drill is really in the plan.
- **A squad breaks at 60% lost inside 7 s.** That is 3 of 4 and 4 of 6, the "one or two survivors" of section 14.3. At half, an SMG
  broke every squad on first contact.
- **Soldier state lives in a WeakMap**, not on `Enemy`, because only this contract needs it. A soldier leaves the roster a frame late,
  because `enemy:killed` still reads him, and the pool can hand his body to a new man first. `flushLeaving` checks for that.

## Hooks for later work

**Wounds.** Built: see `docs/notes/wounds.md`. `outpost.setDowned` is now the wounds' own call. Calling it from outside puts a man on the floor with no clock, so go through
damage or `wounds` instead. `assignAid` still sends the nearest medic or squadmate, who drags him out of the threat's view if he is exposed.

**The Commander.** `outpost.doctrine` is the lever: `surrender` for "nobody surrenders any more", `spacing` against explosives,
`grenades`, `flankAngle`, `fixAfter`, `fixError`. It resets each run. Add a field where an answer needs a new rule. `SQUAD_TEMPLATES` is
who turns up. The Commander reads the player from events, none of which it needs added.

## Lethality

The swarm's `aimAtPlayer` makes speed armour, and that is why humans could not touch a runner. `aim.ts` solves the intercept. Error comes from range, rank and nerve, and speed is only a 30% tax. What the eye cannot read is a turn: `TargetTrack` lags the real velocity by about 0.2 s, so **the counter is a change of direction, not speed.**

Hit rate at 25 m, one aimed round, from `aim.test.ts`'s model:

| Rank | Still | 6 m/s | 12 m/s |
|---|---|---|---|
| Regular | 90% | 41% | 30% |
| Veteran | 100% | 64% | 54% |
| Elite | 100% | 91% | 82% |

A machine gun fires 34-round bursts and swings at 1.15 rad/s, so it walks across the ground and getting out of the lane is the answer. Snipers lead with the laser, and a target still for 1 s takes 85 and not 58. Grenades are cooked by rank: an elite's lands with 0.45 s left.

**Suppression.** Every round calls `suppression.round`. Closeness adds level, and a round with no clear run at the player adds 40%. It shakes the camera, jolts the real aim, tears the image, ducks the music and blurs the whole picture, the crosshair area included (`post.setSuppression`, `uSoft` in `Composite.ts`). It never takes health.

**Flashbang.** White for over half of about 5 s, the HUD fades out with it (`hud.dazzle`), `ear_ring` plays and the music drops. Only a wall stops it. Facing away still costs 42%. Men within 5 m are dazed too, and being blinded gives the squads an opening.

## Rank

A squad has a grade from `rollGrade(level)`, its leader sits a step above, and belts and long rifles are never conscripts. It shows as `Pvt`, `Cpl`, `Sgt`, `Lt` on the feed. An elite wears a visor. `RANKS` sets aim, lead, sight, fear, toughness, what pins him, how long his gun stays up, surrender, rearming, talking, cook time and how long he holds fire on a hostage.

## Surrender and prisoners

A man weighs five signs: squad half gone, nobody within 14 m, the side down to a third of its recent peak, out of ammunition, badly hurt. He needs 2, 3, 4 or 5 by rank, then rolls `gives`. Steady men never look, and nobody decides within 2.5 s of being hit. Broken men get one sign's grace. Otherwise they run.

| What happens | Result |
|---|---|
| Shot on his knees | Plates ignored, damage x5, a fatal hit is death. A shotgun shell kills |
| Shot and lives | `refused`: gets up and runs for a gate, and will not surrender again. Witnesses are frightened |
| Friends firing within 24 m | After 4 s kneeling, goes for his gun if it is within 7 m (55%), otherwise bolts. Not with the player within 4 m |
| Unwatched 6 s, player over 12 m away | Rolls `rearms`, again every 15 s. If it hits he goes for his gun, rejoins the nearest squad and fights |
| Tap E | Questioned, once. `talks` says whether it is true. True: every squad marked and shown through walls for 9 s, and he names the worst of it, an ambush first. A lie: a marker on empty ground |
| Tap E again | Let go. He walks out, and each man freed adds 6% to the next man's odds, up to 24%, never for elites |
| Hold E | Held in front, 5.5 m/s at most, 14 s until he twists free. Bullets from a 130 degree arc in front hit him, his plates included. Friends in that arc hold fire for `hesitates` seconds, and conscripts never fire. Flanks get a clean shot, so squads flank |
| Tap E while holding | Let go |

## Tuning knobs

| Where | What |
|---|---|
| `rank.ts` `RANKS` | Everything that makes a veteran a veteran |
| `aim.ts` | `MISS_*`, `SPEED_TAX`, `EYE_RATE` |
| `planner.ts` `ACTIONS` | What each drill needs, gives and costs |
| `suppression.ts` | `PER_ROUND`, `FADE`, `JOLT`, `BLUR`, `BLIND_*` |
| `prisoners.ts` | The signs, `HIT_GRACE`, `HOLD_*`, `RESCUE_RANGE`, `SAFE_*` |
| `doctrine.ts` `ROLES` | Range band, magazine, reload, starting morale, fires on the move, base of fire |
| `doctrine.ts` | `SQUAD_TEMPLATES`, `MAX_HOSTILE`, `waveStrength`, `fireRules`, `defaultDoctrine` |
| `morale.ts` | State bars, `DREAD_LIFT`, `FEAR`, `DREAD_SPIKES`, `AIM_BY_STATE`, `PEEK_WAIT_BY_STATE`, `RAPID_*` |
| `perception.ts` | `VIEW_COS`, `NOTICE_*`, `HEARING_ERROR` |
| `squad.ts` | `BOUND_RANGE`, `BOUND_LENGTH`, `MAX_MANOEUVRE`, `AMBUSH_*`, `RUSH_*`, `STACK_*`, `GRENADE_*`, `FALLBACK_*`, `PLAN_LIFE` |
| `weapons.ts` | Every gun's numbers, `SUPPRESS_SCATTER`, `FRAG_*`, `SNIPE_*` |
| `postures.ts` | `SHAPES`: one row per posture |

## Testing

```
nice -n 19 npx tsx tools/scripts/human-bench.ts runner 120 3 1  # real Player and ballistics. runner strafe fighter duelist camper. seconds seed wave
nice -n 19 npx tsx tools/scripts/human-cases.ts all 7           # every surrender and prisoner rule on the real systems
HUMAN_MAP=outpost nice -n 19 npx tsx tools/scripts/human-cases.ts tower,climb,sniper 7
HUMAN_CASES=suppress,flash node tools/shot.mjs --url "/?contract=outpost&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/humans-live.mjs --out tools/out/humans.png --wait 500 --timeout 170
nice -n 19 npx tsx tools/scripts/outpost-sim.ts hold 120 7      # about 3 s, no browser. camp, hold, hunter, spree, rescue, tour
python3 tools/scripts/outpost-plot.py tools/out/outpost-hold.json 3
node tools/shot.mjs --url "/?contract=outpost&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/outpost-trails.mjs --out tools/out/outpost-live.png --wait 500 --timeout 175
node tools/shot.mjs --url "/?contract=outpost&autostart=1" --script tools/scripts/outpost-poses.mjs --out tools/out/outpost-poses.png --wait 500 --timeout 120
```

`outpost-sim.ts` is the real EnemyManager, squads, Rapier and nav on the real Kill House, with rendering, gore and bullets stood in for.
It proves movement and decisions and nothing about looks or feel. `outpost-plot.py` reads either JSON and prints the numbers below.

## Measured

**Damage to a player who moves.** `human-bench.ts`, wave 1, 120 s. Real Player on real Rapier, every round flown and swept against the player's capsule. Damage per minute, with deaths in brackets on the real 100 health and regen. The "before" column is the code as it stood when the owner played it.

| Bot | Before | After |
|---|---|---|
| Runner, full speed, never fires (seed 3 / 11) | 20 / 26 | 168 / 169 |
| Fighter, runs the map and shoots (3 / 11) | 18 / 11 | 85 / 73 |
| Strafe, sidesteps in the open, never fires (3) | 87 | 836 (16) |
| Camper, stands still (3) | 453 (8) | 1307 (24) |
| Duelist, stands, sidesteps, shoots back (3 / 11) | not run | 48 / 140 (1) |

Runner at wave 5: 302 per minute, 4 deaths in 150 s. Strafe seed 3 before and after:

| | Before | After |
|---|---|---|
| Share of rifle rounds that hit the runner | 12% | 19% |
| Man-time idle, runner | 33% | 28% |
| Man-time idle, strafe | 33% | 13% |
| Man-time firing, strafe | 28% | 43% |
| Under fire, strafe | 62% | 82% |

**Real bullets in Chrome.** 16 men at a strafing player, no stand-ins: 1680 per minute over 46 s, 105 per man. The bench's strafe is 104 per man, so its numbers can be trusted.

**Sniper,** veteran on Tower Two at 49 m, 40 s: standing 7 of 7 hits for 595, running straight 6 of 8, jinking 1 of 7.

**Drills.** Commander's orders carried out, of those given: 9/9, 8/8, 8/8 on three bots. Flanks that got round: 8 of 10 strafing, 16 of 20 camping. Damage from outside the view of a strafer who always faces the nearest man: 33.5%, and it was 32%, so **the flank's effect on a watching player is not proven by that number.**

**Surrender,** `human-cases.ts`. One man of a healthy squad shot once, 60 squads: nobody gave up. The last man alive, alone, hurt and dry: conscript 83%, regular 55%, veteran 37%, elite 12% within 6 s. A shotgun shell on a kneeling man: 12 of 12 dead. Friends firing: 15 rejoined, 15 fled, 0 stayed.

**Outpost map.** A gun and a marksman on Tower Two stayed up and fired 145 rounds and 5 sniper shots in 25 s at a player 49 m down the East lane.

**Cost.** The blur is free: median 16.7 ms with it forced off and full on, 8 men, 2880x1800, at a load average of 20. `stats.fps` reads low after a screenshot, so it is not evidence of anything.

**The older numbers below** are from the old brain, and no longer describe a run. They are kept for the method.

**Trails.** 12 headless runs of 120 s: camp, hold, hunter and tour, on seeds 3, 11 and 23.

| What | Result |
|---|---|
| Bounding: of the time a squad is moving by bounds, one team alone moving | 94% of 358 s |
| Fallback: the same | 90% of 51 s |
| Fire and manoeuvre: the same | 74% of 589 s. The rest is mostly men without a spot finding one |
| Door stacks | 36%, by design: the whole squad gathers and goes in together |
| Flank: furthest a squad's two teams got apart around the player | Median 106 degrees, best 180. 23 of 27 squads passed 60 |
| Crossfire: furthest two squads got apart around the player | Median 153 degrees per run, worst run 20 |
| Fallback: mean range to the player, start to end | Median 15.8 m to 26.2 m. 7 of 9 opened the range by over 2 m |
| Men holding who had a cover spot | 75% |
| Speed while moving | Median 3.3 m/s, p95 5.2, top 6.4. That top is the 6 m/s sprint plus the 7% spread between men |
| Longest stall while under orders to move | 2.25 s |
| First contact | Median 20.5 s after the run starts |
| Leaps cancelled by the old `stayGrounded`, now stopped at the source by `footbound` | 35 across the 12 runs |

**Waves.** Spree bot, 420 s: six waves, the most alive 13 (cap 18), Dread up to 89, every wave cleared with prisoners still kneeling.
A forced wave 7 reached exactly 18 alive and held there.

**Dread.** Berserk fired mid-fight, 8 men: Dread 0 to 44, and within a second 7 were panicked, 1 shaken and both squads falling back.

**Rescue.** A man down in the open: a squadmate reached him in 0.5 s, dragged him, revived him 14 s after he fell, and he rejoined the fight.

**Roles.** A sniper squad and a riot squad against a player in the yard: the sniper held a spot and fired, riot men stayed in the open
with no spot at all and used pistol and bash, and the gunner closed in.

**Real Chrome**, 1440x900 at 2x, on the shared machine. Bot aiming perfectly: 0 console errors, 60 fps, 16.7 ms median and 16.8 ms p95
frames, 177 draw calls, 612k triangles, 4.3 to 8.8 ms CPU. Wave 3 in 73 s. Surrender, flight and execution all fired, and the Geneva
Suggestion and comms feed answered.

The same with the bot holding fire, so that fights last, on one run: flanks to 170 and 158 degrees, crossfire to 143, 80% of holding men
with a spot, top speed 6.3 m/s, 0 console errors, 60 fps. That matches the headless numbers. It took 256 damage standing still in a hall, about
7 per second across the fight, though the script moves the camera to take its pictures, so treat that as rough.

**The swarm.** `/?autostart=1`: `enemies.outpost` null, `Waves` untouched, wave 1 at 24 husks and troopers on their usual behaviours, 0 console errors.

## Known limitations

- **Nobody has played this.** Everything above is bots and stills. Whether it feels like hunting frightened soldiers needs the owner.
- **Bounding needs a fight that lasts.** A bot with perfect aim breaks squads before they get through a cycle, so the live trails show
  far less manoeuvre than the headless ones. A strong player may see more breaking than flanking. That may be right, and it may not.
- **Men step off the open side of a ramp**, a drop of about 1.2 m. Harmless, and it reads as a hop down.
- **A panicked man's aim offset still reads the real player** in `EnemyManager.animate` while he fires blind, so his arms can point truer
  than his bullets.
- **Squads do not throw smoke on their own.** The Commander's `smoke` answer does.
- **Nothing here has been felt.** Blur strength, the 5 s blind, how fast suppression builds and whether 836 damage a minute is fair all need the owner. The numbers say a careless player dies. They cannot say it is fun.
- **The Commander's orders are text until recorded.** 13 new lines, 8 takes each, are in the voice script.
- **Let go with no questions asked takes two presses,** hold then tap, because one key has only two gestures. If the owner wants it direct it needs its own gesture.
- **Towers have no walk route,** so men reach them only by being placed there, as the mission does. A climbing gunner stays on the ground if no route ends at the height.
- **Sniper lines are few on the Kill House.** He fires from the yard, and often never gets a line at a player inside a room.
- **The cover shot shows nothing.** The man is behind the wall, which is the point. Crouched cover is proved by the pose sheet and the trails, and leaning by `outpost-live-peek.png`.
- **Drag and revive have only been seen as stills and numbers.** A rescuer and casualty jostle a little, because crowd separation still
  pushes them apart at 1.1 m.
