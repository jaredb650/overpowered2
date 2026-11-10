# The Commander

`src/enemies/commander/` and `src/ui/commander/`. Sections 16, 18 and 19 of DESIGN.md. It lives on the Outpost, so it exists only when `ACTIVE.def.ai === 'outpost'`. On the swarm `enemies.outpost` is null, the HUD builds no box, and nothing here runs.

## Public API

```ts
const c = ctx.enemies.outpost.commander;
c.fielded;                 // answers in play, in order. Nothing leaves this list during a run
c.has('mortars');          // also hasTrick('deadMan')
c.adopt('jammers');        // puts an answer into play now. Tests and dev flags use this
c.tracker.habits();        // 0..1 per habit, c.tracker.round is this wave's counts
c.describe();              // one read of everything in play, for bots
c.callInDelay;             // above 0 while a radio operator lives. Progression reads it
```

Events, typed in `events.ts`: `commander:briefing`, `commander:skipped`, `commander:status`, `commander:bark`, `commander:person`, `commander:gift`, `commander:fulfilled`.

## Dev flags

Need `?dev=1`. `/?map=killhouse&autostart=1&dev=1&cmd=mortars,jammers&cmdwave=6` fields those answers and starts on wave 6. Ids are the rows of `ADAPTATIONS`. Tricks follow the wave.

## How it fits together

| File | Job |
|---|---|
| `adaptations.ts` | Every answer and trick with its tell and counterplay, and the arc of a run. Data |
| `tracker.ts` | What the player did, as counts. Touches nothing, so tests feed it a play style |
| `director.ts` | Which answer comes next, who turns up for it |
| `units.ts` | Men with a job and a post. A `directed` squad skips its own brain |
| `posts.ts` | Where they stand |
| `mortars.ts` | Fire missions |
| `devices.ts` | Mines, wires, claymores, cables, beacons, charges, tubes |
| `traps.ts` | What gets laid where as a wave starts. Dead man's switch, rigged rooms, false chatter |
| `jam.ts` | What the sonar and the minimap are allowed to say |
| `smoke.ts`, `barricades.ts`, `props.ts`, `behaviours.ts` | The rest of the kit |
| `person.ts` | The end of a run |
| `orders.ts` | On the radio mid-fight, in endless |
| `lines.ts` | Every word |
| `src/ui/commander/pick.ts` | What gets said about a round. No DOM |
| `src/ui/commander/index.ts` | The box, the chips, the boss name |
| `src/ui/commander/portrait.ts`, `voice.ts` | The face and the recordings |

A run: `Outpost` calls `compose` as a wave is built, `onSquadFormed` as each squad opens, `onWaveStart` once the banner is up (traps go down here), and `intermission` when it clears. `intermission` closes the tracker's books, picks one answer and raises `commander:briefing`. The box spends up to 14 s on it and never stops the game. E finishes a line, then moves on, and skipping the last page brings the wave forward to 3 s.

## The table

Priority order as given. "Chrome" means it ran in the real game with a screenshot read. "Headless" means `commander-sim.ts` on the real map with real squads and physics, and stand-ins for bullets and blasts.

| Answer | Built | Proved |
|---|---|---|
| Mortars, spotter, smoke, tube | Yes | Chrome: line, PAINTED, red smoke, rings, shells. Spotter killed: no new mission. Blast on the tube: headless |
| Snipers | Yes | Chrome: laser from a perch. Repositioning: headless |
| Sonar jammer | Yes | Chrome: 4 men on the map read as 9 blips, back to truth once he died |
| Decoy beacons | Yes | Chrome: ghost figures that flicker. Shot dead: headless |
| Foil hiders | Yes | Chrome: off the radar at 44 m, on it at 9 m, sprung at 6 m |
| Mines | Yes | Chrome: trigger and blast. Shot: headless |
| Tripwires | Yes | Walked through: headless. Seen: Chrome |
| False surrender | Yes | Chrome: hands up with the gun kept, pin at 6 m, grenade out |
| Rigged pickups | Yes | Chrome: lit on lift, 39 damage |
| Bait pickup | Yes | Chrome: lasers crossing on it |
| Spread | Yes | Doctrine only. Not looked at in a fight |
| Shotgun pairs, flamer, backing off | Yes | Pairs: test. Backing off: not watched |
| Claymores | Yes | Laid and chain-detonated. The fan trigger has not fired on its own |
| Crossfire | Yes | Chrome: lasers. Men firing on the door: not watched |
| Cable snares | Yes | Headless at a walk: alarm. At a run: not run |
| Smoke | Yes | Chrome: the cloud. Soldiers losing sight through it: not measured |
| Anti-air | Yes | Chrome through real keys: AA LOCK, Warthog cut off. Seated call-ins eject by the same path, not run |
| Call-in radio jammer | Yes | Chrome through real keys: call held, went the moment he died |
| Heavier helmets | Yes | Chrome: visor, head plate 21 to 63 |
| Nobody surrenders | Yes | Doctrine, one flag |
| Rigged casualties | Yes | Chrome: goes when the player closes |
| Radio silence, false chatter | Yes | Headless: `Alpha-7` naming a wired room |

Tricks, all built. Playing dead: Chrome, gets up behind the player and fires. Sacrificial squad, danger close, dead man's switch, rigged room: headless. Barricades: headless, the ray stops at the shutter and two blasts clear it, and a test proves men go round. Rigged corpses: laid headless, trigger not run.

Answers fielded first by bots, 150 s, seeds 3, 11, 23: camper `mortars, snipers` every time, sonar `jammers, decoys` every time, route `mines` first every time, then `tripwires` or `mortars`.

## Decisions worth knowing

- **Habit first, then table order.** A camper meets the mortars before the sniper because the row is first, and each answer already given to a habit costs it 28%. A player showing nothing gets `STANDING_ORDERS`, which are doctrine and are not being read.
- **A device is a point, not a collider.** `weapon:fired` gives the line of a shot and `physics.radialListeners` hears every blast, so nothing here needs a hook in combat. Swords and rockets are left out of the line test: a sword reaches nothing, a rocket arrives as a blast.
- **`render.highlight` is wrapped, the way the lab wraps `hud.pause`.** `contracts/sonar.ts` was out of bounds. A one-line filter there would be cleaner.
- **The minimap draws every body it is handed.** It has never hidden anyone, which would have undone hiders and jammers, so `Hud.ts` swaps `s.enemies` for `jam.radar()` around that one call.
- **The jammer shows through any wall in cyan.** He is a transmitter, and that is his tell. The thing wrecking the sonar is the one thing it can still find.
- **Squads stop being directed when the regulars are gone.** Men with posts abandon them, so a wave never stalls on a tube in the yard.
- **The men still see, hear, bleed and break.** A job is only a post and a prop. A spotter is killed the way anyone is.
- **Doors are indexed by `c.doorList`.** `outpost.doors` shrinks when a shutter drops, and the tracker's numbers point into the full list.
- **The Commander in person is a Juggernaut with a cap**, spawned by `spawnBoss`. He is not a soldier, so the wounds rules cannot one-shot him through the heart. The boss bar is renamed from `Hud.ts`.
- **A blast rarely kills a man now.** He goes down and bleeds, so a gift can land seconds after the shell. The source carries through the bleed.
- **Lines take their ids from a key beside them**, so moving a line keeps its audio. Changing the words needs a new take.
- **The box prints the true number and the take says the band.** 212 shots is a take of two hundred. A line with two different slots stays text.
- **A weapon is said by a word, never by its id.** `WEAPON_WORDS` has the word for each, and `weaponWord` says a gun with no entry by its name with a capital. The Harrow, the Rivet and the Sabot have words and no takes: the box prints their lines and plays nothing, because `voice.ts` only queues clips the manifest lists. `voice-script.ts` will ask for their takes the next time it is run; `docs/voice` has not been regenerated for them.

## Orders on the radio

Section 22: in endless he is always there, directing the men, and they obey. Every 12 to 18 s `RadioOrders` picks the squad doing least, chooses from what the player is doing (still: frag, flash; running: cut-off; holding a prisoner: flank; few men left: rush), and asks `squad.obey`. That prices the drill at nothing and replans. If the plan does not contain the drill he tries his next choice, so **he is never heard ordering something his men cannot do.** The line goes through `commander:bark`, the squad's leader answers on the feed when it starts, and `commander:order` and `commander:obeyed` say so. `{squad}` is a new slot, and `cmd.order.<drill>.<key>` the new lines. A mission writes his words itself, so none of this runs under `MISSION_ID`. Radio silence stops it too.

## Voice

`nice -n 19 npx tsx tools/scripts/voice-script.ts` writes `docs/voice/commander-script.csv` and `.md`. 413 lines, 375 recorded, 924 takes: 850 Commander, 30 intercept, 44 Council. The rest is radio and stays text. Slots multiply a line, and that is where most of the takes come from: cut `NAMES`, `ROOM_WORDS` or a band in `COUNT_BANDS` to shorten the session.

Audio goes in `public/audio/voice/<file>.mp3`, and its name goes in `public/audio/voice/manifest.json` under `clips`. That file ships empty. A clip not listed stays as text, and a variant never falls back to another variant, because a voice saying the wrong number is worse than no voice.

## Tuning knobs

| Want | Where |
|---|---|
| Arc, which wave is what | `phaseOf`, `FINAL_WAVE`, `TRICKS[].from` in `adaptations.ts` |
| What counts as a habit | `habits()` and the top of `tracker.ts` |
| Who turns up | `plansFor`, `OVER_STRENGTH` in `index.ts` |
| Mortar warning, damage, rate | Top of `mortars.ts` |
| Trap reach, fuse, damage | Top of `devices.ts` |
| How many get laid | Top of `traps.ts` |
| Sonar clear ranges | `JAM_CLEAR`, `HIDER_CLEAR` in `jam.ts` |
| Ambush, possum, casualty, feign ranges | Top of `units.ts` |
| Box length | `readingSeconds`, `BRIEFING_SECONDS`, `AFTER_SKIP` |
| How often the Council replies | `COUNCIL_CHANCE`, `TOPIC_CHANCE` in `pick.ts` |
| Gift score | `STYLE.gift`, `GIFT_SOURCES` in `progression/data.ts` |

## Testing

```
nice -n 19 npx vitest run src/enemies/commander
nice -n 19 npx tsx tools/scripts/commander-sim.ts camper 150 3            # camper sonar route idle. Writes tools/out/commander-<bot>.json
nice -n 19 npx tsx tools/scripts/commander-sim.ts camper 26 3 bench=kit kill=0   # benches: dangerClose deadMan possum room bait shutter kit
CMD_CASES=box,mortar node tools/shot.mjs --url "/?map=killhouse&autostart=1" --w 1920 --h 1080 --script tools/scripts/commander-live.mjs --out tools/out/cmd.png --wait 500 --timeout 165
```

Live cases: `box campBot mortar sniper jammer mines surrender bodies tricks rest lanes air gift voice person finale stress swarm`. `swarm` wants `/?autostart=1`. `stress` wants `cmd=` and `cmdwave=` on the URL. Five or six cases fill a 165 s run.

## Measured

| Thing | Result |
|---|---|
| Real waves, camper bot, Chrome | Wave 1 clear, box quoted the round, `mortars` fielded, wave 2 brought crew and spotter, spotter on post and lasing 13 s in. Another run took over 45 s, depending on the post |
| Forced wave 6, nine answers, 1440x900 at 2x | 58 to 60 fps, 5.7 ms CPU at worst, 218 draw calls, 417k triangles, 15 men, 0 console errors |
| Swarm, `/?autostart=1` | `outpost` null, `Waves`, wave 1 at 24, no box, no HUD object, 0 console errors |
| `outpost-sim.ts` | Still runs |
| Unit tests | 30 here, 434 across the repo, all passing |
| Screens | Box and tells at 1920x1080 and 1280x720, box at 1440x900 at 2x, all read. Files are `tools/out/cmd-*.png`, `cmd720-*.png`, `cmd2x-*.png` |
| Voice | Stubbed manifest and a WAV served as `.mp3`: only the listed clip was fetched, and the page held for it |

## Known limitations

- **Nobody has played this.** Every number is a guess: 55 a shell, 15 s between missions, the fuses, how often traps come. Whether it reads as being learned or as being picked on needs a person.
- **Nothing has been listened to.** All sound is existing ids reused, with no mortar whistle of its own. The mine's click is `grenade_pin`.
- **A real recording has never played.** Only the stub above.
- **The rows marked not watched in the table.** They run without error, and nobody has confirmed they look right in a fight.
- **The final fight was only scripted.** He was summoned and killed by a test, and the mortar calls on himself ran headless. A real ten-wave run has not been played in Chrome.
- **A rigged charge beside a big pickup is small.** It ticks, but the halo draws the eye away from it.
- **A false surrender cannot be pinned on the grenade.** The gloat fires when the grenade is dropped, hit or not, because a projectile's damage does not carry a cause.
- **Blasts that chain lose their cause.** `combat.explode` queues a blast set off by another, and the damage then lands after `boom` has cleared it, so that hit is not gloated about.
- **Tricks and answers can both start on one wave.** Section 16.5 says one new adaptation at a time. Answers keep to that, and tricks arrive on their own clock. Wave 6 brings two.
- **Spotters often settle closer than the band.** The Kill House kills sightlines by design, so `CLOSEST_LINE` of 10 m is common, and that is well inside rifle range.
- **Possums are found by aiming at them.** The crosshair goes red over a living man, which is a tell nobody designed.
- **The dev hint** `Click for the mouse` sits on the box with `?dev=1`. It is the lab's, and absent otherwise.
