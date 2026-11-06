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
`squad:broken`, `dread:spike`.

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
| `squad.ts` | The squad's brain: who goes where |
| `behaviours.ts` | What a man does with his legs: hold, move, flee, surrender, aid, downed |
| `weapons.ts` | Loadouts, suppressive fire, grenades |
| `waves.ts` | The wave loop. `createWaves` hands this to the game on a squads contract |
| `comms.ts`, `dropped.ts`, `soldier.ts` | Radio lines, guns on the floor, one man's state |
| `src/characters/animation/postures.ts` | Crouch, cover, lean, hands up, kneel, cower, drag, revive |

The squad thinks about once a second and gives orders. Men carry them out alone, so all tactics live in `squad.ts` as a choice of where
to send whom. Morale outranks orders: `collapse` takes a man out of the squad.

## Decisions worth knowing

- **Only one fire team moves.** Every tactic is the same step: pick a team, send it, the other covers, swap. Bounding goes forward,
  a flank goes round, a fallback goes back. Team 0 holds the heavy weapons, so a machine gun is never sent round the side.
- **Routes are not the flow field.** The flow field leads to the player, and a flank is exactly the route that does not. `RouteFinder`
  rebuilds walk links from the nav grid's public arrays. Soldiers do not use pads or jump links.
- **The view fan makes hidden routes cheap.** `Intel` sweeps 72 rays round the threat at most once a second, so "can it see that?" is
  a lookup during A*. Smoothing has to respect it too: straightening a route used to undo the detour. A test covers this.
- **Nobody gets the position for free.** A man needs a clear line, the right facing and time to be sure. A man with his head down
  sees nothing. Gunfire carries 42 m, with an error of 18% of the distance. A sighting goes round the squad at once, and to other squads
  1.2 s later.
- **Command's fix stops hiders winning.** After 12 s of nobody knowing, `Outpost.fix` passes on a position within 7 m. It also gives
  squads their first objective.
- **`movement.ts` assumes the swarm**, and soldiers work round three things in it. `e.flowUntil` is cleared every frame, or a stalled
  point move would walk a retreating man to the player. `e.probeAt` is Infinity, because routes are checked when made. `e.footbound`
  stops `tryJumpUp`, because a body blocked at a door jamb leapt onto the catwalk 4.5 m up.
- **`Soldier.downed` is not `Enemy.downed`.** The Enemy flag means gore has the body for a knockdown. The Soldier flag is the wounded state.
- **Prisoners stay in `alive`** because they can still be shot, and `hostile` and `remaining` subtract them. After 45 s, or past 8 held,
  they walk to a gate with their hands up. Killing one on the way is still an execution.
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

## Tuning knobs

| Where | What |
|---|---|
| `doctrine.ts` `ROLES` | Range band, magazine, reload, starting morale, fires on the move, base of fire |
| `doctrine.ts` | `SQUAD_TEMPLATES`, `MAX_HOSTILE`, `waveStrength`, `fireRules`, `defaultDoctrine` |
| `morale.ts` | State bars, `DREAD_LIFT`, `FEAR`, `DREAD_SPIKES`, `AIM_BY_STATE`, `PEEK_WAIT_BY_STATE`, `RAPID_*` |
| `perception.ts` | `VIEW_COS`, `NOTICE_*`, `HEARING_ERROR` |
| `squad.ts` | `BOUND_RANGE`, `BOUND_LENGTH`, `MAX_MANOEUVRE`, `MANOEUVRE_REST`, `STACK_*`, `GRENADE_*`, `FALLBACK_*` |
| `weapons.ts` | Every gun's numbers, `SUPPRESS_SCATTER`, `FRAG_*` |
| `postures.ts` | `SHAPES`: one row per posture |

## Testing

```
nice -n 19 npx tsx tools/scripts/outpost-sim.ts hold 120 7      # about 3 s, no browser. camp, hold, hunter, spree, rescue, tour
python3 tools/scripts/outpost-plot.py tools/out/outpost-hold.json 3
node tools/shot.mjs --url "/?contract=outpost&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/outpost-trails.mjs --out tools/out/outpost-live.png --wait 500 --timeout 175
node tools/shot.mjs --url "/?contract=outpost&autostart=1" --script tools/scripts/outpost-poses.mjs --out tools/out/outpost-poses.png --wait 500 --timeout 120
```

`outpost-sim.ts` is the real EnemyManager, squads, Rapier and nav on the real Kill House, with rendering, gore and bullets stood in for.
It proves movement and decisions and nothing about looks or feel. `outpost-plot.py` reads either JSON and prints the numbers below.

## Measured

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
- **No smoke.** Section 16.1 lists it, this task did not. Flashbangs blind by screen flash only.
- **Sniper lines are few on the Kill House.** He fires from the yard, and often never gets a line at a player inside a room.
- **The cover shot shows nothing.** The man is behind the wall, which is the point. Crouched cover is proved by the pose sheet and the trails, and leaning by `outpost-live-peek.png`.
- **Drag and revive have only been seen as stills and numbers.** A rescuer and casualty jostle a little, because crowd separation still
  pushes them apart at 1.1 m.
