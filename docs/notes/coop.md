# Co-op

The plan is `docs/proposals/coop.md`. All five stages are built: the lobby (0), walking together (1), host-authoritative combat (2),
the Crucible fully playable (3), Endless Humans and Outpost Defense on any map, the Office included (4), and the campaign's two missions,
The Outpost and Foreclosure (5). Stage 1 and 2 sections further down are the history of how the base was laid; where they and this top
part disagree (respawn timers, free roam, the pose and snapshot formats), this top part is current.

## Playing with friends

1. Play > Multiplayer > Host a lobby. Pick a password. Send your friends the invite link (Copy link) and tell them the password.
2. Each friend opens the link **on a computer** (phones and touch-only tablets are told the game needs keyboard and mouse, and cannot
   join). The link skips the splash and opens on "Joining lobby CODE" with the password field focused: type it, Join lobby. Up to
   four of you. Everyone can set a callsign; the mode's starter gun (SMG, or the Harrow in Endless Humans) is already picked.
3. A guest sees "1. Pick your weapon (optional) → 2. Press READY → 3. The host starts the match"; a pick points a callout at READY.
   The host picks a mode (Crucible mode, Endless Humans mode, Outpost Defense mode, either of the first two on the Office, or mission
   1 or 2), which guests see, and presses Start: dimmed and refused, with "Waiting for X to ready up", until every friend is ready.
   A five-second countdown runs on every screen; Start again cancels it, and so does a friend going unready or joining. While
   someone is not ready the host also has **Force start** (press twice): it starts at once, each guest on their pick or the mode's gun.
4. Play. Tab shows the team board, Enter opens chat, E beside a downed friend revives them, the middle mouse button (or P) pings
   the spot you are looking at for everyone. Between waves L readies you up: the break ends early once everyone alive is ready.
   Esc opens a menu over the live game.
5. When everyone is down, or the run is won (the Commander dead in Endless Humans, a mission finished), the team board shows on
   every screen with its buttons: **Back to lobby** for anyone, and for the host **Back to lobby (everyone)** and **Start again**.
   Left alone it takes everyone back to the lobby after 20 s. The host's "End match (all to lobby)" in the Esc menu does the same
   at any time (it asks first); a friend's "Leave match (to lobby)" steps out while the others play on, and "Rejoin match" takes
   them back with their kit.

If a friend cannot connect at all, set up TURN once (below).

## Files

| File | What |
|---|---|
| `src/net/room.ts` | The seam: `NetRoom` (named channels of two kinds, peer join and leave, errors, backpressure) and `LobbyRooms`. Tests pass a fake |
| `src/net/lanes.ts` | `LaneRoom`: the `NetRoom` both transports share. Reliable and unreliable lanes, the fallback, the simulator and the counters hooked in, a malformed message never throws into the game |
| `src/net/trystero.ts`, `src/net/fast.ts` | The real transport: trystero (8 Nostr relays, TURN when configured) for the reliable path, and a second, unreliable data channel per peer (`fast.ts`). `openLobby` is the one way in |
| `src/net/loopback.ts`, `src/net/mode.ts` | The loopback test transport (`?net=loop`, dev pages only) and the switch that picks it |
| `src/net/netsim.ts` | The network simulator: lag, jitter, loss, resend stalls, a slow link (`?netsim=`) |
| `src/net/metrics.ts`, `src/net/debug.ts` | Counters per lane and peer, round trips, named series and timers; `window.__op2.net` for scripts |
| `src/net/turn.ts` | **The TURN config slot** (`WORKER_URL`), fetching and cleaning the Worker's credentials, never hanging (4 s cap) |
| `tools/turn-worker/worker.js` | The Cloudflare Worker that mints TURN credentials. Setup below |
| `src/net/lobby.ts` | `Lobby`: players, ready, chat, ping, heartbeat, countdown, full lobby, code clash, end match and away/rejoin, every check on what peers send |
| `src/ui/screens/coop.ts`, `src/ui/css/coop.css` | Play > Multiplayer: start, host, join and lobby pages; the in-match co-op HUD styles |
| `src/net/session.ts` | Tab-local match handoff (kept for the match's life, with the roster), early room reconnect across the map page load, reloads |
| `src/net/sessionHud.ts`, `src/ui/css/coopsession.css` | The deploy gate, the waiting and reconnecting line, the host-lost board |
| `src/net/lobbyText.ts` | Every reason a room closes, in words |
| `src/net/fakeHub.ts` | The lobby tests' in-memory transport (mute, sever and mend a link) |
| `src/net/index.ts` | `CoopSession`: the game-facing session, remote bodies, poses, chat lines in the feed, leaving to the lobby, the co-op cost meter |
| `src/net/remote.ts` | A friend's body: the Bailiff with the nearest third-person prop to their gun, posture, tag |
| `src/net/pose.ts` | Binary pose codec and arrival-time interpolation buffer |
| `src/net/world.ts`, `src/net/world/*.ts`, `src/net/worldProtocol.ts`, `src/net/authority.ts` | The host's world: enemy snapshots, hit claims and their checks, kill attribution, explosions, call-ins, slow-mo, prisoners, vehicles, the garrison. One module per feature: see "Code layout" below |
| `src/net/team.ts` | The team's rules: down, revive, bleed-out, spectate, respawn at wave clear, endings (`finish`), cards, seats (a returning player's purse, kit and life), the late joiner's `sync`. See "The team's rules" |
| `src/net/teamBreak.ts`, `kit.ts`, `marks.ts` | The break's length and ready vote; a player's kit read, cleaned and put back; pings |
| `src/net/world/credit.ts` | Whose kill, whose reward (`notMine`, `award`), and the kill feed's news (`coop:kill`) |
| `src/net/mission.ts`, `src/campaign/coop.ts` | Campaign co-op: the host's mission played on every screen, every player's actions counted, regrouping, film votes, checkpoint restarts, late-joiner catch-up. See "Missions" |
| `src/net/coopHud.ts` | Teammates strip, the break's clock and vote, the kill feed, Tab board, Enter chat, the end-of-run board and its buttons |
| `src/net/*.test.ts`, `src/core/coop.test.ts`, `src/campaign/crowd.test.ts` | Unit tests over the mocked transport |
| `tools/scripts/coop-kit.mjs` | The test kit every multi-page proof shares: `startParty`, `live`, `measure` and the rest (see Testing) |
| `tools/scripts/coop-smoke.mjs`, `coop-baseline.mjs` | The rig's own proofs: any mode with 2 to 4 players reaches a fight; the baseline numbers |
| `tools/scripts/coop-stage3.mjs`, `coop-modes.mjs`, `coop-mission.mjs`, `coop-robust.mjs` | The two-page proofs (below) |
| `tools/scripts/coop-all.mjs` | Runs every co-op proof with its parameters and writes one results table: the regression suite. See "Testing" |
| `tools/scripts/coop-guest-seat.mjs` | One scripted session per mode from a guest's seat: a fight, kills and credit, slow-mo, a call-in, a shared gun, a revive, the break, a rejoin, the ending |
| `tools/scripts/coop-missions-play.mjs` | Plays either mission from the first line to the team board on 2 or 3 pages and checks every guest's screen at every section. See "Missions", "Proofs" |

Small hooks outside `src/net`, each marked with a co-op comment: `Game.ts` (which systems run where, the shared slow-mo clock, the hidden
tab's worker tick), `Player.ts` (`downed` and its crawl), `time.ts` (`gate`, `share`, `hostSteps`: see "Time: the team's slow motion"), `Hud.ts` (shops and loadout over the live world in
co-op, `mount`, quitting to the lobby), `Screens.ts`/`pause.ts` (lobby return, labels), `progression/index.ts`, `contracts/shop/index.ts`,
`contracts/defense/index.ts`, `Weapons.ts`, `runreport.ts` (a teammate's kill is not yours), `progression/score.ts` (no solo record from
a co-op run), `EnemyManager.placeReplica` (posture), `allies/fire.ts` (garrison tracers), `campaign/index.ts`, `watch.ts`, `types.ts`.

## Code layout

The co-op world was one class in `src/net/world.ts`. Since the overhaul's stage 0b it is split by feature, with no change in what it
does or sends. Older sections below that say "`world.ts`" mean the module named here.

`CoopWorld` (`src/net/world.ts`) is what the rest of the game calls, as `ctx.coop.world`. It keeps no feature state. It builds the
modules, runs them every frame and passes calls on (`claim`, `notMine`, `select`, `steer`, `enemyRay`, `blast`, `clock`, and so on:
the names the game used before).

| File | Owns | Events on the wire |
|---|---|---|
| `world/context.ts` | `WorldContext`, handed to every module: the game `ctx`, the session, `send` (the reliable `action` lane), the snapshot lane, the router, `listen` (game events), the stats, the claim validator, `ready`, and the shared lookups `sender`, `playerOf`, `relay`, `visible`, `life`. Also `Later` (the host's delayed work) and `unpackDamage` | |
| `world/router.ts` | `Router`: which handler gets an arriving event, by type and by side (host or guest) | |
| `world/wire.ts` | `Vec`, `validVec`, `WireDamage`, `packDamage`, `ENEMY_IDS`, `REGIONS` | |
| `world/snapshot.ts` | The enemy snapshot's bytes, version 4: chunks (`ChunkWriter`, `ChunkReader`), the rate tiers (`tierOf`, `dueOn`), `POSTURES`, the flag bits. See "Enemy motion" | (the `world` lane, unreliable) |
| `world/motion.ts` | No game imports: `HostClock` (the host's clock from its stamps, and the jitter), `MotionBuffer` (one thing's last states, its playhead, interpolation, short extrapolation, easing), `SendClock` (the host's steady tick) | |
| `world/replicas.ts` | Host: the 20-a-second tick, tiers and chunks per guest, backpressure, the roster. Guest: the enemy copies, their buffers and playheads (`animate`), their own ragdolls, the bounded `dead` set, `whenSeen` (something for an enemy not drawn yet waits for it) | (the `world` lane, unreliable) |
| `world/moves.ts` | Enemy moves no hit explains: stagger, stumble, daze, roar, land, leap, block, a living knockdown (`down`) and `getUp`. The host listens at the animator and at gore; a guest plays each when the copy's playhead reaches it | `move` |
| `world/identity.ts` | Each soldier's names, rank, seat, voice and squad, told once per guest | `who` |
| `world/targeting.ts` | Host: every player as a target (`players()`, and `hostPlayers()` as the game's own player type for dangers that test them all), `select`, line of sight, `steer` and its routes, `targetPlayer`, sending `hurt` and `shove`, a guest's dodge grace (`dodged`), who holds Ghost. Guest: taking `hurt` (a sword block still works) and `shove`, `allowsLocalDamage`, telling the host about Ghost | `hurt`, `shove`, `ghost` |
| `world/claims.ts` | A guest's damage as claims: `claim` (a `hit`, with its shot id, the shooter's clock and the guess at the result), `status` (fire, frost, a live bolt), `vehicleHit` / `vehicleBlast`; the host's check and apply for each; whose claim is being applied (`applying`, `applyingShot`) and who last hit an enemy (`lastHit`). See "Claims" below | `hit`, `status`, `vhit` |
| `world/vehicleHits.ts` | Guest: the hit boxes of the host's trucks, humvees and tanks, moved with their drawings, and what a round on one becomes (owned and run by `Claims`) | |
| `world/hits.ts` | What the host's damage did, as every other screen shows it: the host's `hitfx`, `ack`, `sever` and `kill`; a guest drawing its own hit at once (`stamp`, `predict`), putting right what it guessed wrong (`ackIn`) and showing the hits, cuts and deaths the host decided; `whenKilled`; `selfDestruct`. See "Gore on every screen" | `hitfx`, `ack`, `kill`, `sever` |
| `world/hitWire.ts` | The round and the host's findings as ids and whole numbers: `packHit`/`unpackHit`, `packFacts`/`unpackFacts`, `packKill`/`unpackKill` | |
| `world/credit.ts` | Whose kill and whose hit (`notMine`, `crediting`, `creditAs` for work put off to a later frame); rewards sent to the guest who earned them; `coop:kill` on every screen | `award` |
| `world/remoteFire.ts` | A player's weapons on other screens: what is sent of a shot, a projectile, a swing and the gun in hand, the host's check and relay, and handing each to that friend's `Watcher` (`src/weapons/watch.ts`), which draws it. See "Weapons on other screens". Gun Kata's notice | `fire`, `round`, `loop`, `held`, `mfx`, `kata` |
| `world/enemyFire.ts` | Host: enemy rays against remote players (`enemyRay`), every enemy projectile described once as it leaves (`projectile`), flashes and sounds of things that are not an enemy's attack, the scope and shot recorder attacks.ts uses. Guest: tracers with the near-miss crack, harmless projectile copies, removing one at the host's word, asking the host to blow up one it shot | `ray`, `proj`, `projx`, `projhit`, `efx` |
| `world/attacks.ts` | Enemy attacks on every screen: the host's three events per attack, and the guest running the same `AttackDef` on its copy against a world that cannot hurt. Also a line said outside an attack and a boss's phase effects | `atk`, `atkf`, `atke`, `say`, `bossfx` |
| `world/warnings.ts` | Ground rings, falling shells, ground shocks, flashbangs, and the stars and lasers of things that are not an enemy's attack | `zone`, `strike`, `shock`, `bang`, `glint`, `laser` |
| `world/villain.ts` | The Commander's briefing, barks, warning chips, arrival and last words raised on guests as the same game events | `cmd` |
| `world/hostTime.ts` | `HostTime`: how much later than usual a host-stamped event arrived, so a late wind-up starts that far in | |
| `world/booms.ts` | `blast`: explosions sent to other screens on a two-bucket budget (24 a second of anything, 12 more for large or near ones), an enemy blast's damage on remote players, a guest's blast on the host's vehicles. `show` (`CoopWorld.boom`) is the API for a blast combat did not make. It carries no damage: a guest's blast on the host's vehicles is a `vhit` claim (claims.ts) | `boom` |
| `world/callins.ts` | Call-ins, the Frame and streak-perk effects on every screen: the order, the news, the pose, the checks and the relay; the host's note that lets the caller's call-in damage pass. See "Call-ins on every screen" | `callin`, `cin`, `cnews`, `mech`, `aadown`, `pfx` |
| `world/airlift.ts` | The capture skyhook: the host says when a drone is sent for a cuffed man, every guest flies the same pass | `airlift` |
| `world/sonar.ts` | The shared Sonar ping | `sonar` |
| `world/chatter.ts` | The soldiers' lines on every screen | `chatter`, `chatcut` |
| `world/slow.ts` | The team's slow-mo rules with no game in them: the kinds, their scales and caps, the host's list and the team's budget (`SlowBoard`), the notice's words | |
| `world/clock.ts` | The clock's gate (`ctx.time.gate`): every slow-mo request the game makes, on host and guest; the host's answer; `clock()` applies the list to this screen's clock; the host's long-frame steps | `slow`, `slowstate`, `slowno` |
| `world/slowNotice.ts` | The notice every screen shows while the world is slow (its own element in the HUD root, `ui/css/cooptime.css`) | |
| `world/capture.ts` | Prisoners for every player: a guest's tap (question, release) and 0.4 s hold (capture) carried out by the host, the reveal for the team, the bounty to the captor, the shield (off in the game). See "Prisoners for every player" | `capture`, `credit`, `prisoner` |
| `world/guns.ts` | Carries the news of dropped guns for `weapons/dropped.ts` | `gun` |
| `world/pods.ts` | Carries the news of the drop pods for `progression/pickups/pods.ts` | `pod` |
| `world/props.ts` | Barrels, tanks and props: a guest's hits, the host's breaks, chairs, the late guest's state, the machinery clock | `prop` |
| `world/vehicles.ts` | The host's ground vehicles drawn on guests, 5 Hz, stamped with the host's clock and drawn through a `MotionBuffer`; their working parts (wheels, tracks, springs, guns, fires, engine) and their wrecks. See "Enemy vehicles on a guest are working machines" | `vehicles`, `wreck` |
| `world/villainProps.ts` | The villain's devices, shutters and smoke on every screen; a guest's round on a device; a snare on a guest. See "The villain's props on every screen" | `dev`, `devshot`, `snared`, `shutter`, `smoke` |
| `world/fort.ts` | Outpost Defense's fort for the whole team: walls, gates and shacks by index, the fort's facts, a guest's blasts, boarding up and Barracks purchases, mortar rounds, the Defense radio. See "Outpost Defense: one fort" | `fort`, `fortstate`, `wallblast`, `wallhit`, `repair`, `repaired`, `fortbuy`, `fortsold`, `shell`, `fortsay`, `fortradio`, `gunseat` |
| `world/allies.ts` | The host's garrison drawn on guests, 5 Hz, the same way, and its tracers (30 a second) | `allies`, `ashot` |
| `team.ts` | The team's rules ("The team's rules" below); registers its own events with the router (`plug`) | `life`, `card`, `team`, `revive`, `up`, `wave`, `over`, `restore`, `kit`, `ready`, `vote`, `sync`, `mark` |
| `mission.ts` | The campaign's mirror (see "Missions"); registers its own events with the router (`plug`). `mission` goes both ways: an operation to play from the host, a report (`did`, `took`, `skip`, `rounds`) from a guest | `mission`, `gather` |
| `worldProtocol.ts` | For code outside `world/`: re-exports `wire.ts` and `snapshot.ts`, and defines `WorldEvent` as the union of every module's event types | |

Rules that keep it working:

- **A module keeps its own state.** It reaches another module only through that module's public methods, and gets it as a constructor
  argument in `world.ts` (for example `Claims` is given `Replicas`, `Targeting` and `Vehicles`). Nothing reaches into another module's
  private fields.
- **Order.** Modules add their game listeners (`w.listen`) as they are built. Listeners on one game event run in the order added, and
  the world is built before any system's `init`, so `Hits` hears `enemy:killed` before every system (who killed it is known first).
  Each frame `CoopWorld.update` runs the team, the mission, then its `modules` list in order: capture, vehicles, allies, targeting,
  hits, the delayed work, and last the snapshot. After a snapshot goes out the `snapshotSent` hooks run (per-enemy state of dead
  enemies is forgotten).
- **Nothing arrives before `begin()`.** Events are dropped until `ready`; the latest snapshot is kept and taken at `begin()`.
- **A handler that throws drops that one event** with a console warning (`WorldContext.receive`); junk from a peer never stops the game.

**To add an event:**

1. Declare its shape in your module's file, as an exported type with a `t` name no other event uses.
2. Add that type to the `WorldEvent` union in `src/net/worldProtocol.ts` (one line).
3. In your module's constructor register who hears it: `w.router.host('name', handler)` for what a guest sends the host,
   `w.router.guest('name', handler)` for what the host sends guests, `w.router.both(...)` for either. A handler gets
   `(event, from, now)`: the sender's lobby id and `performance.now()`. Check every field: it came from another browser. A second
   handler for the same event and side throws when the world is built.
4. Send it with `w.send(event)` (a guest's goes to the host, the host's to every guest) or `w.send(event, id)` (the host, to one
   guest). The host passes a guest's event on to the others with `w.relay(event, from)`.

**To add a module:** a class in `src/net/world/` that takes `WorldContext` (and the modules it needs), built in `CoopWorld`'s
constructor. If it needs a frame tick or cleanup, give it `update(now)` / `dispose()` and add it to the `modules` list. If the game
must call it, add a method on `CoopWorld` that passes the call on.

## Enemy motion (overhaul lane "enemy-motion", 2026-11-18)

What a guest sees of the host's enemies. It replaces the stage 2 lane described in "Stage 2 (history)" further down: that one sent
the whole crowd in one reliable message about nine times a second and slid each enemy from wherever it was drawn to the newest
position, so enemies stepped, stopped between messages and froze together whenever a packet was resent.

### What the host sends

- **A steady tick, 20 a second** (`SendClock`, `TICK_MS` 50). The next tick is counted from the last tick's own time, never from the
  frame that noticed it, so a 60 fps host ticks 20 times a second (the old lane managed 9.2 of its 10). After a stall it catches up
  by one tick and drops the rest. A host slower than 20 fps ticks every frame and says so in the header (`tickMs`).
- **Rate tiers, per guest** (`tierOf`). An enemy is *near* for a guest if it is within 25 m of them, or inside the cone 60 degrees
  either side of where they look out to 70 m, or a boss, or one of the last 4 alive. Near enemies go every tick (20 Hz). The rest
  are *far* and go every fourth tick (5 Hz), taking turns by uid so every tick carries about the same load. A new enemy goes to
  everyone on its first two ticks. If a guest's snapshot bytes pass 64,000 a second the far tier thins to 2 Hz (it cannot happen
  at the 48-enemy cap; it is the research doc's ceiling).
- **Chunks, each one packet.** A tick's enemies for one guest are cut into chunks of at most `UNRELIABLE_SAFE_BYTES` (1,100).
  Every chunk stands alone: a 16-byte header (format `0xc204`, kind, count, **the host's clock in ms**, tick, wave, phase, seconds
  to the next wave, enemies alive, the host's real tick length) and then records. A lost chunk costs the enemies in it one update.
  Nothing waits for it.
- **Two record sizes.** Every record has the 27 **motion** bytes: uid, bits (full, tier, legs it can stand on, getting up, aiming),
  the flag byte (airborne, downed, frozen, burning, shield, ward, boss entry, can be cuffed), the coarse animation and the slot of
  the player it is after, position (3 x f32), yaw (i16), velocity (3 x i16 cm/s). A **full** record adds 17: archetype, plates,
  posture, severed regions, health, max health, armour. An enemy sends full records when it is new, for 8 ticks after anything in
  them changes, and once a second regardless; a guest can only make an enemy from a full record. The byte layout is the comment
  at the top of `snapshot.ts`.
- **A roster twice a second:** the uid of everyone alive (also sent 4 times a second while nobody is alive, so the wave clock
  still arrives).
- **Backpressure.** The lane is `{ unreliable: true, latest: true }`, and the host asks `lobby.behind(id)` before building a
  guest's tick: a guest whose connection is behind gets nothing this tick instead of stale data queued behind more stale data.
- **Moves and identities** go on the reliable lane (below).

Sizes: 48 new enemies are 2 chunks, 2,144 bytes, once. After that, with nothing changing, a tick of 48 near enemies is 2 chunks
of 27-byte records. Budgets from the unit test (`replicas.test.ts`): 20 near and 28 far, the split the research doc budgets at
25 KB/s, costs under 17 KB/s; all 48 next to the guest, the worst case, under 30 KB/s. Measured figures are in the table below.

### What a guest does with it

- **The host's clock** (`HostClock`). A chunk stamped `host` arriving at local `now` says the clocks differ by at least `host - now`.
  The largest such figure over the last few seconds (the fastest packet) is the offset; how late every other packet runs against
  it gives the **jitter** (mean plus twice the mean deviation). Two 2.5 s windows, so a route that got slower is followed.
- **A buffer and a playhead per enemy** (`MotionBuffer`): its last 8 states, sorted by host time whatever order they came in, a
  repeat dropped. The enemy is drawn at its playhead, between the two states either side: position, yaw (the short way round) and
  velocity (which drives its gait, as the host's does). The playhead aims at `host now - delay`, where
  `delay = that enemy's send interval + jitter + 20 ms`, kept between 50 and 450 ms: about **70 ms behind on a clean link for a
  near enemy at 20 Hz, 120 to 150 at 10 Hz, 220 for a far one at 5 Hz**, and more by exactly the measured jitter on a bad link.
  It closes on that by running up to 25% fast or slow, so a change of tier or of jitter never shows as a jump.
- **When the buffer runs dry** (a lost packet, a stalled host) the enemy goes on along its last velocity for 100 ms at full speed,
  then slows to a stop over about 150 ms more: it never freezes mid-step and never runs off. When the next state lands, the gap
  between where it was drawn and where the states now put it is carried as an offset and eased away (90 ms, and never faster
  than 4 m/s): no snap. The same easing takes in a state that arrives late and fills a hole.
- **A real teleport** (the host re-entering a stranded enemy through a spawn point: over 6 m in a step no speed explains) is drawn
  as a cut at its own moment, not a slide across the map. A tab that slept is put on the present, not played through.
- **The body's state takes effect when the playhead reaches it:** airborne, posture, frozen, burning. Health, armour and
  plates apply the moment a newer state arrives. A limb the state has off and the copy still has waits 800 ms for its `sever`
  event (the real cut: the round, the way the limb flew), which a lost packet can hold up on the reliable lane; only if the
  event never comes does the limb simply drop.
- **Frozen and burning are the copy's own state** (`EnemyManager.placeReplica`, `replicaStatus`): `enemy.frozen` and
  `enemy.burning` are held above zero while the host's flag is on, so a kill on a frozen copy is a shatter on the guest too, and a
  burning copy carries the same flames, sizzle and charring skin as the host's (`burnLook`, shared with single player's
  `updateBurn`), hurting nothing. What the guest's own weapon just put on a copy (`afflict`, ahead of the host's answer) runs out
  by itself unless the host confirms it.
- **It aims at who it is after.** The record says which player's slot the enemy has picked and whether it is aiming; the copy's
  aim offsets point at that player (this one, or a friend's body). Before, a copy never aimed at all.
- **Spawning and leaving.** A copy is made from the first full record seen. A copy the roster no longer names waits 500 ms for its
  `kill`, then is withdrawn; a late state older than that roster cannot bring it back. A killed uid is remembered in `dead`, now
  bounded at 1,024 (`RecentSet`): only the newest kills can still have a chunk in the air.
- **Something for an enemy not drawn yet** (`Replicas.whenSeen(uid, run)`): events are reliable and states are not, so a `hitfx`,
  `sever`, `move` or `who` can arrive before the enemy's first state. It is kept up to 1.5 s and runs when the copy appears, instead
  of being dropped. `hits.ts` uses it for `hitfx` and `sever`; any module may.
- Chunks that arrive while the map loads are kept (64) and taken at `begin()`, each at its own arrival time.

### Moves (`world/moves.ts`, event `move`)

Positions cannot say that a boss roared or that a man was knocked off his feet. Those are facts, so they go once on the reliable
lane: `{ t: 'move', uid, at, m, a }`, `at` the host's clock, `a` the move's numbers.

| Move | From | On the guest |
|---|---|---|
| `stagger`, `stumble`, `daze` | A shove, an electric floor, a blast that left it standing, a wound | The same clip, or `stumble` with the host's direction, strength and bone |
| `roar`, `land`, `leap`, `block` | A boss arriving and changing phase, a leaper, a drop-in, a guard | `anim.play` at the host's speed |
| `down` | Any living knockdown (`gore.knockdown`): a slide, a blast, a wound, a fall after a stagger | The copy is knocked down by the guest's own gore with the host's push: velocity, impact, topple, lie and rise times, the wound. A real ragdoll, landing where the guest's physics puts it (owner decision 2). A body a blast threw is thrown the way the host's went, read from its next states |
| `getUp` | Gore handing the host's body back, or a medic's hand | A copy in its own ragdoll is told to rise (`gore.rouse`); one that never fell plays the get-up clip |

- **The host changes no enemy code for this.** While a match is hosted the module wraps each enemy's `play`, `stumble`, `daze` and
  `getUp`, and gore's `knockdown`, and puts them back when the match ends. The attack clips (`attackMelee`, `attackHeavy`, `shoot`,
  `throw`) are deliberately not sent: `world/attacks.ts` runs the attack itself on the copy. Nothing is started from the
  snapshot's coarse animation bits any more (they are still carried).
- **A move plays when the copy's playhead reaches its stamp** (so it starts where the motion shows it starting), at the latest
  700 ms after it came.
- **The contract with the gore lane:** a guest's gore starts staggers and knockdowns itself from the hits it sees. A move never
  restarts a clip of the same kind (`stagger`/`stumble`, or `down`) that began on that copy in the last 400 ms (`SAME_KIND_MS`),
  whoever began it: the module listens at the copy's animator and at gore on the guest too.
- **A copy in its own ragdoll** is gore's until gore hands it back: `Replicas.ragdoll` neither places nor animates it. It lies
  2.5 s longer than the host said, so only the host's `getUp` gets it up; if that word is missed it is roused 600 ms after the
  host's enemy is seen standing. When it gets up it is where its own physics left it, and the buffer eases it to the host's place
  (measured: 0 cm apart 2.5 s after getting up). If gore has no room for another body it lies in the `downed` posture as before.
- At most 90 moves a second from the host, and the same move for the same enemy not twice in 120 ms.

### Who each soldier is (`world/identity.ts`, event `who`)

A copy is made by the same outpost code as the host's man, which deals names and ranks at random. The host now tells each guest
once per man (batches of 16, five times a second, so a late joiner hears about everyone): surname, designation, nickname, rank,
seat, voice, whether he is known by name, leads his squad and talks big, and the squad's name. The copy takes them, so
`Sgt Alpha-1` is `Sgt Alpha-1` on every screen.

### Vehicles and the garrison

Both go 5 times a second as JSON with the host's clock (`at`). **Since 2026-11-19 (lane "fix-session") they ride the
unreliable `world` lane, not the reliable one**, where under loss they queued behind the stall, arrived in a burst and held real
events behind them (review minor 7). They are "side packets" beside the enemies' snapshot chunks (`context.ts` `sendSide`: two
bytes `05 c2`, a kind byte, then the JSON; a snapshot chunk has its own magic), cut into parts of at most `PART_BYTES` = 900
so each fits a packet under the safe unreliable size (`world/sideList.ts`: `{ at, i, n, list }`). A guest draws a list when it
has every part of one stamp and drops a part older than the stamp it is on, so a lost packet costs only that list (the next is
200 ms later) and none is ever resent. The lane's own rule (`latest`) skips a guest that is behind. Only the sending and the
gathering changed: the drawing and its buffer below are as they were. On a guest each has a
`MotionBuffer` (`place`: velocity worked out from its last two places), so they are drawn between two states about 220 ms back
and carried on when one is late. A vehicle's attitude rides in the buffer's four spare numbers and is slerped between the same
two states; its turret is the buffer's yaw. The old per-frame `slerp(0.25)` turned faster at higher frame rates; this does not
(`puppets.test.ts`: the same at 30 and 120 fps). An ally's gait comes from that velocity, not from the frame's step.

### Proofs

- Unit: `world/motion.test.ts` (the clock, the buffer, loss, outage, easing, tier change, the send clock), `worldProtocol.test.ts`
  (the bytes, chunk sizes, malformed input, the tiers), `world/replicas.test.ts` (the host's tick, budgets, backpressure, a guest
  under loss and reordering, the roster, `dead`, `whenSeen`), `world/moves.test.ts` (moves and identity), `world/puppets.test.ts`.
- `tools/scripts/coop-motion-measure.mjs`: two pages and a crowd that never stops moving (both players run in circles). Every
  frame the guest records where it drew each enemy and the host where each really was; each drawn position is then compared with
  where the host had that enemy at the moment being drawn. It also records what the game says a frame costs on each page.
  `MOTION_STRICT=1` makes one run fail outside its limits, or if a page was starved.
- `tools/scripts/coop-motion-matrix.mjs`: the whole table from one command, unattended:
  `node tools/scripts/coop-motion-matrix.mjs --baseline d9ecffb`. It starts a Vite for this checkout if none answers on 5320,
  makes a worktree of the baseline commit in the temp folder with its own Vite on 5321, runs the 12 cases on both, one run at a
  time through `tools/shot.mjs` (it waits for a browser slot like any proof), and takes down what it started. **A case only
  counts if its pages really ran:** under 40 frames a second (the host: under 80% of its cap) the page was starved by the
  machine and its numbers are the machine's, so the run is thrown away and tried again (`--tries`, default 3); a case with no
  clean run is written as "not measured", never as numbers. It writes `motion-results.json` and `motion-table.md` in `--out`
  and exits 3 if any case was not measured. `--only 48e`, `--budget <minutes>`, `--seconds`, `--keep` as its header says.
- `tools/scripts/coop-motion-moves.mjs`: on the guest, a knocked-down enemy is a ragdoll of the guest's own and gets up with the
  host's, ending where the host's stands; a roar and a hitless stagger play; attack clips are not sent; frozen and burning are
  the copy's state and end with the host's; a withdrawn enemy leaves, a killed one stays dead; the lane is unreliable.
  `MOVES_MODE=outpost`: every soldier has the host's name, rank, squad and voice.

### Measured

`coop-motion-measure.mjs`, loopback transport, the Crucible, both players running in circles so the crowd (husks, troopers,
stalkers) never stops. "Error" is the distance between where the guest draws an enemy and where the host had it at the moment
being drawn (for the old lane, which has no such moment, at the one delay that fits the whole run best). A "stall" is a frame an
enemy stood still on the guest while its host twin moved faster than 0.5 m/s.

**Only 20 enemies on a clean network has been measured.** The table the brief asked for (20 and 48 enemies; host uncapped and at
20 fps; clean, `lag:80,jitter:30,loss:0.03` and `lag:150,jitter:60,loss:0.08`; old and new) could not be made on 2026-11-18:
thirteen agents shared the machine, the load average stood between 50 and 100 on 32 cores, and test pages got anywhere from
0.1 to 30 frames a second. A starved page measures the machine, so those runs were thrown away, not reported. The runner now
refuses them itself. To make the table on a quiet machine: `node tools/scripts/coop-motion-matrix.mjs --baseline d9ecffb`.

What did get a clean run (pages at 40 fps or more), 20 enemies, clean network:

| Run | Pages, fps (host / guest) | Drawn behind, ms | Error p50 / p95 / p99, cm | Yaw error p50 / p95, deg | Stalled frames | Stalls a minute per enemy | Snapshot B/s |
|---|---|---:|---|---|---:|---:|---:|
| Old lane (`d9ecffb`), side by side with the next row | 55.5 / 53.3 | 116 | 2.2 / 20.6 / 50.7 | 0.2 / 3.9 | 38 (0.24%) | 7.69 | 8,328 |
| New lane, before the other lanes merged | 57.7 / 57.4 | 95 (p95 237) | 0.4 / 7.6 / 22.2 | 0.1 / 1.8 | 1 (0.01%) | 0.2 | 8,250 |
| New lane, merged | 55.3 / 48.5 | 118 (p95 259) | 0.5 / 7.4 / 28.9 | 0.1 / 1.8 | 13 (0.09%) | 1.61 | 8,797 |
| New lane, merged, on a busier machine | 42.6 / 45.2 | 126 (p95 285) | 1.3 / 17.0 / 60.5 | 0.1 / 2.2 | 9 (0.05%) | 0.89 | 7,774 |

Reading it: on the one pair measured under the same conditions, the new lane draws enemies about five times closer to where the
host had them at the median (0.4 against 2.2 cm) and nearly three times closer at the 95th percentile, with one stalled frame
against 38, for the same bytes.

**The two lanes are not measured with the same yardstick, and the difference matters.** The old lane draws every enemy the same
distance in the past, so its error is taken at the one delay that fits best (116 ms). The new lane draws each enemy at its own
playhead and says where that is, so its error is taken there. Put the new lane on the old yardstick, one delay for the whole
crowd, and it reads worse than the old one (8.5 cm at the median, 94 cm at the 95th percentile, against 2.2 and 20.6): not because
enemies jitter, but because far enemies are deliberately drawn further back than near ones. That is the cost of the far tier: an
enemy more than 25 m away and out of the guest's view is shown about 240 ms in the past instead of about 115. Its motion is as
smooth as a near one's; it is staler. If playtests show that hurts (a far sniper, a boss seen across the map; bosses are always
near), raise the far tier's rate in `snapshot.ts` (`FAR_EVERY`): bytes are the only price. The last two rows are the same code with the pages running worse (a guest that hitches draws
late whatever the netcode does); they are here so nobody takes the best row for the whole truth. The first three rows counted a
stall as under half a millimetre of movement in a frame; the last counts by speed (under 0.03 m/s), which is the rule the
script now uses. "p95 behind" is the far tier: enemies far from the guest and out of its view sit about 220 ms further back.

Not measured, so not claimed: 48 enemies, a host at 20 fps, and both bad networks, in the browser. What stands behind those
today is the unit tests: one packet in five lost without a jump or a step back and within 2 cm; half a second of nothing ridden
out without a jump; chunks out of order, doubled and one in six lost drawing the same walk; one chunk in ten lost between a real
host tick and a real guest with 30 enemies within 5 cm; a 12 fps host ticking every frame; and the byte budgets (under 17 KB/s
at 20 near and 28 far, under 30 KB/s with all 48 near, against the research doc's 25 KB/s target and 64 KB/s ceiling).

## Enemy attacks on guests (overhaul lane "enemy-attacks")

Before this, everything an enemy did existed only on the host: a guest fought silent enemies with no wind-up, flash, laser or
sound, and several dangers hurt only the host. Now an enemy attacks the same way on every screen and every player is in the same danger.

**How an attack reaches a guest.** An attack is data the enemy's brain runs (`AttackDef`, `src/enemies/brain.ts`): `begin` (pose,
voice, muzzle star, laser), `windupTick` (the laser following its target), `fire` (swing, flash, shot, sound), `activeTick`, `end`.
The host runs it for real and sends three small events on the reliable lane (`src/net/world/attacks.ts`):

| Event | Fields | When |
|---|---|---|
| `atk` | enemy `uid`, attack name `a`, wind-up seconds `w`, target player slot `to`, host time `ht`, and the point (`ap`) and direction (`ad`) the attack locked, if any | `a.begin` has run |
| `atkf` | `uid`, `a`, shot number `n`, `to`, the shots it made (`sh`), `ap`, `ad` | each `a.fire` |
| `atke` | `uid`, `i` if it was cut short | the attack stopped |

A guest runs **the very same `AttackDef`** on its copy of the enemy, on the same timeline, against a world marked `cosmetic`
(`AiWorld.cosmetic`): the player it senses is the one the host named (the local player or a friend's body), `ctx.player.takeDamage`,
`launch` and `push` do nothing, `ctx.combat.spawnProjectile` becomes a harmless copy of the host's projectile, `fireRay` a tracer to
the host's end point, and every call only the host may make (`strike`, `selfDestruct`, `trample`, `reinforce`, a ground ring) is a
no-op. So the wind-up clip, voice, star, laser, flash and sounds are made by the code single player uses, and a new attack needs
nothing extra. No random seed is sent: every outcome that matters (each projectile's velocity, each ray's end, each grenade's fuse,
each locked aim point) is sent as the outcome.

- **Timing.** A wind-up starts when its event arrives, never delayed by the enemies' interpolation buffer. `HostTime` measures how
  much later than usual an event came (against the smallest delay seen lately, so the two clocks need not agree) and the wind-up
  starts that far in (at most 0.4 s), so the shot lands when the host's `hurt` does. The shot itself is the host's call: a copy
  whose wind-up is over waits for `atkf` (laser still tracking), and gives the attack up after 1.2 s of silence.
- **A shot that beats the wind-up.** If `atkf` arrives while the copy is still winding up (its start was late, or this page's
  game clock ran slower than the host's), the wind-up is run to its end first, so what it leads to (a laser going solid, a lane
  locking) has happened before the shot.
- **An enemy not drawn yet.** A start that arrives before its enemy's first snapshot is kept for 0.6 s and begun that far in. A
  shot whose start was lost joins the attack at that shot.
- **Streams for show.** A Burner's flame (`AttackDef.local`) sends only its first shot; every screen makes the rest of the globs
  from the timeline. This replaced one `ray` event and one physics raycast on the host per glob (about 12 a second per Burner).
- **What is recorded per shot.** While `a.fire` runs on the host, `enemyFire.ts` gathers what it spawns (at most 16 a shot, a
  shotgun's pellets) instead of sending each: a projectile as `{ o, v, k, id?, tr?, g?, l?, fu?, tl?, sz?, x? }` (origin, velocity,
  kind, number if it explodes, tracer, gravity, lifetime, fuse, trail, size, carries a blast), a ray as `{ o, e, tr?, wz? }`.
- **Soldiers.** A guest's copy of a soldier has no squad mind behind it, so before a shot the copy's magazine is topped up and
  its line of sight to the local player is checked once (for the suppression a near miss causes). The guest's `Suppression` ticks,
  so rounds cracking past a guest blur and jolt the view as they do in single player.
- **A soldier's round at a guest** is the same slow bullet the host's own player gets (85 m/s, half led, scattered by the gun's
  miss), so a guest sees it coming and can dodge it. Until now a soldier shot a guest with an instant ray, the stand-in meant
  for allied soldiers (`Foe.shotAt` in `targeting.ts`), and a rocket at a guest exploded twice (`Foe.blast`, now nothing: the
  real rocket's blast already reaches every player).
- **The old animation byte.** The snapshot's coarse `animation` byte no longer plays `attackMelee` or `shoot` on a copy
  (`replicas.ts`): attack clips come from the attack itself. Its value 3 (stagger) is still played until lane "enemy-motion"
  replaces it.

**Projectiles.** Every enemy bullet, rocket, grenade and shell flies as a harmless copy on every guest
(`ProjectileSpec.cosmetic`, `Projectiles.spawn(spec, netId)`, `Combat.spawnCopy`): it draws and collides with the world, stops at
the local player without hurting, and never explodes. It leaves the guest's own copy of the gun and slides onto the host's line
(`visualFrom`). One that explodes carries a number: when the host's ends (`projx`) the copy goes too, and a guest who shoots the
copy out of the air (`Projectiles.detonate`) sends `projhit` and the host blows the real one up. The blast is still the host's
`boom`. A projectile that no attack event carries (a tank's shell, a helicopter's rocket, a grenade a dying man dropped, the
Commander's smoke) goes out alone as `proj`, 60 a second at most.

**Dangers that test every player** (host: `CoopWorld.hostPlayers()`, the host's own first, then a stand-in per guest whose
`takeDamage` is `hurt` and whose `launch` and `push` are `shove`):

| Danger | Where | Before |
|---|---|---|
| A boss's ground slam, stomp and landing (`shockwave`) | `enemies/bosses.ts` | Only its target, who could not jump it and was never thrown |
| The Titan's beam | `enemies/bosses.ts` | Only its target |
| Melee swings, lunges, the Titan's sweep, the Juggernaut's charge (`meleeConnect`) | `enemies/attacks.ts` | Only its target |
| Burner flames (`Flames.lickPlayer`) | `weapons/Flames.ts` | Only the host |
| Vehicle rams | `enemies/vehicles/ground.ts` | Only the host |
| Wreck fire | `enemies/vehicles/wreck.ts` | Only the host |

A guest's stand-in reads `grounded` from their newest pose (`airborne`, `jet`, `wallrun`, `wallrunR`, `mantle` are off the
ground), so a guest can jump a slam. Enemy vehicles look for the nearest living player on foot (`VehicleSystem.quarry`), not only
the host's. `Commander.hurt` takes the victim as a fourth argument, for lane "world-b"'s devices.

**Dodge grace.** The host draws a guest 100 ms behind their poses. A melee swing spares a guest whose newest pose, no older than
150 ms (`DODGE_FRESH_MS`), is more than 0.5 m (`DODGE_MARGIN`) outside its reach (`Targeting.dodged`, counted in `dodges`).

**Warnings** (`src/net/world/warnings.ts`). A ground ring is always the host's word: `Telegraphs.zone` sends `zone` with the host
time and a guest draws it with the seconds it has left. `strike` is the shell that comes down in a ring (the Titan's barrage, the
Commander's mortars), `shock` a ground shock's ring, dust, crack and sound (`shockFx`), `bang` a flashbang: it goes off on every
screen and each player's own eyes decide how blind they go. Stars and lasers inside an attack are that attack's own on every
screen; outside one (a tank laying its gun, a mortar spotter, a fumbling fake surrender) they are sent, a laser's two ends at 10 Hz
and glided between.

**Voices.** A line inside an attack is said by each screen's copy of the attack. A line only the host works out (a bark, a taunt
on a dodge, a burning man's scream, a choke) goes through `shout()` (`enemies/attacks.ts`) and is heard everywhere (`say`, 20 a
second at most). Pain, sever and death cries stay with each screen's own damage model (lane "gore").

**Bosses.** What a phase change looks and sounds like is separate from what it does (`BOSS_FX` in `bosses.ts`: landing, armour
break, limb lost, the Titan's fall, the Juggernaut's wall stun). The host runs one as it happens and every guest runs the same one
(`bossfx`). A guest's own copy of a boss never decides anything: its controller's callbacks return at once on a guest, and a
Titan's death no longer clears the field locally (the host's `kill`s do).

**The Commander** (`src/net/world/villain.ts`). `commander:briefing`, `bark`, `status`, `person`, `fulfilled` and `quiet` go to
guests as `cmd` and are raised there as the same game events, so the guest's own box and chips (`ui/commander`) show them. A late
guest is told which chips are up. A briefing is checked field by field (`cleanBriefing`).

**Ghost.** A guest tells the host when its Ghost power-up goes on or off (`ghost`); `Targeting.select` sets `sense.ghost` for the
host's own from its perks and for a guest from that word (it used to force it off for everyone).

**A guest's sword.** A bullet the host says hit a guest is still theirs to block or send back (`hurtIn` asks `Combat.guard`).

**Proofs** (`tools/scripts/`, each through `shot.mjs`, evidence JSON beside the screenshots; `COOP_SIM`, `COOP_PLAYERS` and
`ATTACKS`/`PARTS`/`SHOTS` narrow or stress a run). Unit tests: `src/net/world/attacks.test.ts` (17).

| Script | What it proves on the guest's page |
|---|---|
| `coop-attacks-kit.mjs` | The recorder the others use: every sound, flash, tracer, star, laser, ring, projectile copy, `hurt` and throw a page shows, with the wall clock, so a guest's times can be set against the host's |
| `coop-attacks-crucible.mjs` | One row per Crucible attack, 29 of them, each staged alone at the guest: the wind-up's clip, voice, star, laser or ring; the shot's flash, sound and projectile bodies; the host's damage and throw; each step's delay behind the host |
| `coop-attacks-humans.mjs` | A real Endless Humans wave (every attack the host's men start is played on the guest); each of the 10 soldier weapons forced once; a tank's laser, cannon, shell and blast; a ram; a burning wreck; the Commander's chip, bark and briefing in the guest's own box |
| `coop-attacks-hazards.mjs` | Three players: a slam hurts and throws both guests in the ring; a guest who jumps it takes nothing; a last-moment step out of a swing is spared; Ghost; a guest shoots an enemy rocket down; a guest who is not the target sees the laser sit on the friend it is aimed at |
| `coop-attacks-shots.mjs` | Four pictures from the guest's eyes at 1440x900, dpr 2, each of one exact frame |

**Measured** (2026-11-18, loopback transport, one machine). The machine was shared with eleven other lanes' browser runs for the
whole day (load average 45 to 100, swap full), which starves a test page of frames. A row's timing is only judged when every
page ran at 40 frames a second or more; on a starved page a start and its shot arrive in one late lump, and that measures the
machine. Re-measure on a quiet machine before quoting the tail figures.

| Run | Result |
|---|---|
| Crucible table, 2 players, clean line, pages at 60 fps | 29 of 29 attacks whole on the guest. Each start 1 to 55 ms behind the host's (most 6 to 13), each first shot 4 to 47 ms behind; the guest's wind-up within 33 ms of the host's length. Two rows needed a second go for a stall (121 and 301 ms), then 6 to 12 ms |
| Crucible table, 2 players, `lag:120,jitter:40,loss:0.05`, 12 attacks, pages starved (1 to 14 fps) | Every wind-up, shot, projectile body, `hurt` and throw arrived. Starts 139 to 769 ms behind, shots 159 to 898 ms; the one row at speed 279 and 168 ms (the simulator's own delay is 120 to 160 ms) |
| Crucible table, 3 players, clean line, pages starved | The 11 attacks that ran inside the time limit (claw, burst, shotgun, minigun, rocket, sniper, pounce, fuse, flame, slam, stomp) were all whole on the guest; timings not judged |
| Endless Humans, a real wave, 28 s | 32 of 32 attacks the host's men started were played on the guest; median 12 ms behind, 95th percentile 455 ms (stalls); 123 flashes, 87 bullet bodies, 22 `hurt`s; no attack code threw on a copy |
| Endless Humans, each weapon forced | 10 of 10: rifle, shotgun (8 pellet bodies a blast), machine gun, rocket, marksman's rifle, pistol, carbine, grenade (with its ring and blast), rifle butt, shield bash (both throw the guest) |
| Vehicles | Tank: the laser lays on the guest, the lay tone, the cannon's sound and flash, the shell's body, the blast. Scout car: 35 damage and a throw from the ram, the clang heard, its gun heard. Wreck: two burns in 400 ms |
| The Commander | PAINTED chip up and "There are mines in it now." typed in the guest's box; then the briefing typed and the chip down |
| Slam, 3 players | Both guests in the ring hurt (21.4 and 20.4) and thrown (9.8 m/s up). The guest who jumped 640 ms into the wind-up took nothing; the one on the ground took it |
| Dodge grace, 2 players | A step 6 m back 430 and 460 ms into a 500 ms swing: the host still drew the guest in reach (2.0 m) and spared them, their newest pose being 7.5 m clear and 2 to 19 ms old. Earlier steps (300, 380 ms) were out of reach by the ordinary test |
| Ghost, rocket, watcher, 3 players | The host listed the guest's Ghost and its enemy sensed them hidden. A guest shot the rocket's copy 191 ms into its flight: the host's real one blew up there and the copy went. The third player saw the laser, flash and tracer, the laser 0.00 m from the friend and 3.0 m from themselves |

Not proven: four players; real WebRTC (`COOP_NET=rtc`); the full Crucible table under bad network at speed; Outpost Defense and the
two missions (they use the same enemies and the same code, and were not run); the helicopter's rockets; the Commander's mortars
on a guest in a real round; a flashbang's blinding on a guest.

## The life of a session (overhaul lane "session", 2026-11-18)

From the moment a lobby opens to the moment everyone is back in it: `src/net/lobby.ts` (the rules), `session.ts` (the handoff
between pages), `index.ts` (`CoopSession`: the gate, the hold, the hooks), `sessionHud.ts` (what it draws), `lobbyText.ts` (every
closing reason in words), `ui/screens/coop.ts` (the lobby page, regrouping). Findings fixed are those of
`docs/notes/coop-audit-life.md` listed for this lane in `coop-overhaul.md`.

### Seats

- A **seat** is one player in a room: `LobbyPlayer.seat` (`s1`, `s2`…), given by the host to a browser the first time it says
  hello and kept for the room's whole life, across the host's own page loads (the handoff carries the table). The browser's id
  is the one in localStorage (`op2_browser`; per tab on the loopback transport). **Slot** (colour, tag, spawn, side-step) stays
  with the seat: the same in the lobby, in the match, after a reload, in the next match.
- `LobbyPlayer.id` is only the seat's **current connection** (the transport's peer id). It changes on every page load. Keep
  nothing by it that must outlive a reload; key by `seat` (or on the host `lobby.browserOf(id)`, which the team's purses and kits use).
- `away` now means **not in the match's world right now**: nothing of the game is sent to or taken from that player, no body is
  drawn, nothing targets them, no wipe waits on them. `state` says why: `'loading'` (their map page is booting, or they have not
  connected yet), `'ready'` (booted, at "Click to deploy"), `'lost'` (connection dropped, seat kept). `away` with no `state` is
  the old meaning: on the lobby page by choice. Code that filters on `!p.away` is right for all four.
- Callsigns are unique in a room: the second `VIPER-27` is `VIPER-27 (2)` (host, on hello and on every rename).

### Which page is talking (the match id in hello)

A match is played on a fresh page per player. `hello` carries `page` (the match this page was built for, null on a lobby
page) and, from a host, `match` (the match it is running or starting). A host whose `page` is not its `match` is on its way
out to a new page: a guest already on a map page ignores it and waits for its successor, and such a host ignores guests arriving
for its next page. `Lobby.page` is reset to null when a match ends or is left, so the rule holds for the second and third match
in a room (the old one-time `deployed` flag did not). The lobby list carries `on` (the running match's id or null), so a page
that missed an `end` while loading still learns its match is over.

### Start, the load barrier and the deploy gate

1. The host's Start (or Force start) first asks `canStart` (tab storage writable), then sends `start`. Guests acknowledge and
   change page. The host waits for the acknowledgements at most `START_ACK_MS` = 5 s (the lobby status reads "Starting ·
   waiting for NAME"), then changes page too; a guest that was slow gets `start` again when its page says hello.
2. The handoff (sessionStorage `op2_coop_match`) carries the **roster** (browser, seat, name, slot, starter) to the host's map
   page, whose lobby pre-seats everyone as `'loading'` before they connect.
3. Every map page boots, then stops at **"Click to deploy"** (`CoopSession.gate`, drawn by `sessionHud.ts`): the map behind,
   the list of players with "loading the map / at the deploy screen / in". The click is that page's first gesture: it takes the
   mouse, unlocks the sound and starts the local run (`hud.startRun`), so nobody starts in the pause menu. The page tells the
   host `loaded` twice: booted (`click: false`), then in (`click: true`).
4. **The host's world is held** until the barrier lifts: `CoopSession.holding` keeps `Game.newRun` from calling `waves.start()`
   (all three wave directors, and with them the Commander and the Defense director) and skips the host's campaign update (a
   mission's runner opens on its first update). Players who are in walk the map meanwhile, with one line on every screen:
   "Waiting for NAME · starting without them in 54 s".
5. The barrier lifts (`Lobby.live`, `onGo`) when every seat is in, or when the wait has run out for each missing one:
   `LOAD_WAIT_MS` = 90 s from the host's own deploy click for a player still loading, `CLICK_WAIT_MS` = 20 s for one sitting
   at the deploy screen, nothing for a lost seat. A lobby line names who it started without. They join later as late joiners:
   their `loaded` makes them present, and the team's first-card catch-up hands them the rest.
6. Liveness while loading: a guest's map page waits `MATCH_HOST_WAIT_MS` = 120 s for its host (a lobby page 30 s), judges no
   silence until it has booted, and forgives a host whose own row still says loading; the host applies no silence rule to a
   loading seat (the barrier bounds it; an unconnected seat is dropped after `LOADING_SEAT_MS` = 3 min).
7. The barrier exists only on the map page of its own match (`Lobby.barrier`). A lobby that plays a match without a page of its
   own (every unit test) admits a mid-match newcomer directly, as before.

### A blip is not the end

| Side | What happens | Numbers |
|---|---|---|
| Guest, host silent | "Reconnecting to host… 30" (red line), the room stays open, poses stop. Anything heard from the host ends it | silent `QUIET_MS` = 6 s, then `RECONNECT_MS` = 30 s |
| Guest, host's connection closed | The same line. A hello from the host (the same page reconnected by trystero, or its reloaded page) ends it | 30 s |
| Guest, grace over | The room closes with `lost` or `host-left`; see "Host loss" | |
| Host, guest silent | The seat goes `'lost'` ("NAME lost connection."), body out of the world, slot and everything kept by seat stay | `SILENCE_MS` = 20 s |
| Host, guest's connection closed | The same at once | |
| Host, the guest is back | Same browser id (or the same connection answering again): seat back, `'loading'` until its page says where it is, then "NAME is back." | within `SEAT_GRACE_MS` = 60 s |
| Host, grace over | "NAME left.", seat and slot freed | 60 s |
| Either, a deliberate quit | `leave()` sends `bye`: "NAME left." at once, no grace; a host's `bye` closes guests at once. The room stays up `BYE_FLUSH_MS` after it, so the word gets out on a slow link | 600 ms |
| Either, its own page stalled | A heartbeat that last ran more than `STALL_MS` = 5 s ago restarts every peer's silence from now | |

A guest's page always reconciles with the host's list: if the list has it as loading or lost while it is in the world, it says
`loaded` again (once a second). So a lost message or a host that gave the seat up too early heals itself.

A full lobby never turns a live player away for a ghost: a fifth hello evicts the seat lost longest. The transport's own cap
(`TRANSPORT_MAX_USERS` = 12, trystero's `maxUsers` and the loopback's alike) is far above four, because around a match start
every player has two pages in the room: only the lobby's own check says "full".

### Reloads

The handoff stays in sessionStorage for as long as the match does (only `clearSession` removes it: leaving, or the match ending).

- **A guest reloads** (F5, the error panel's Reload): the new page rejoins the same match, takes its seat back, stops at the
  gate ("already running") and is announced "lost connection" then "is back". It is never a solo run. What the player gets back
  (purse, kit, life) is the team lane's restore, keyed by browser.
- **The host reloads:** its page was the world, which cannot be picked up again. The new page opens a **new match of the same
  mode** for the same roster; the guests, who were on "Reconnecting to host", get `start` for a match that is not theirs and
  follow it to a fresh page (`Lobby.onMatch`), through the gate again. Everyone restarts from the beginning, in the same room.
- A match that ends, or changes, while a page is still loading it: the page lands on the lobby page with "The match ended while
  you were loading", or goes to the new match.
- Closing or reloading a tab mid-match asks first (`beforeunload`), except for the game's own page changes.
- **A reload on the lobby page, between matches,** walks back into the room. The tab keeps a second note beside the match
  handoff (`op2_coop_room`: code, password, callsign, hosting, and for a host every seat it has given out), written whenever a
  lobby is attached to the lobby page and removed by Leave or when the room closes for good (`session.ts` `rememberRoom`,
  `roomToRejoin`, `forgetRoom`). The boot finds it once the match handoff has been tried and opens Multiplayer on the room
  (`CoopScreen.rejoin`): a guest joins again and the host gives the same browser its seat and slot back ("lost connection",
  "reconnected"); a host opens its lobby again on the same code with the same seat table, and its guests, who were on
  "Reconnecting to host… 30", take it back and are listed in the seats they had. An invite link in the address wins over the note.

### Host loss

No host migration: the world lives only on the host's page. When the host is gone for good (grace over, or it quit):

1. Mid-match, guests get the team board "HOST LOST" with each player's kills, score and credits for `LOST_BOARD_MS` = 10 s.
2. Then everyone **regroups on the same code and password** (`CoopScreen.regroup`): the survivors in slot order as the host
   last listed them (`Lobby.successors`), the first hosts a new lobby, the others join it under the callsigns they had. Each
   joiner waits 14 s times its place in the line, then takes over if nobody ahead showed up; a host that finds the code
   already hosted joins instead. Players on the lobby page when the host goes regroup the same way, without the board.
3. The old host can come back with the invite link and joins as a guest.

**One room, one host.** Two hosts can meet on one code: a regroup where two took over at once, and a host whose page reloaded
for longer than its guests waited, coming back (as the host of a new match on its map page, or on its lobby page) to find them
regrouped. `Lobby.otherHost` settles it from the two hellos (each host's carries `born` and `n`, the guests connected to it,
and is said again on every heartbeat so the count acted on is current):

| This host | The other | Who gives way |
|---|---|---|
| nobody connected | has players | this one |
| nobody connected | nobody connected | the newer (`born`) |
| has players | anything | not this one (two hosts that both have players stay: rooms are not merged) |

The one that gives way closes with `code-taken` and remembers the other's callsign (`yieldedTo`); its page then joins that lobby
as a guest: the lobby page through `CoopScreen.ended`, a map page through `CoopSession.roomClosed`, which hands the screen a
regroup plan ("Your team regrouped while this page was away. NAME is hosting now; you have joined their lobby."). A host's own
other page (same browser id) and a host on its way out to a map page are never rivals. So a returning host never strands a
player: if its guests are under a new host it joins them, and if the new lobby is still empty and newer, that lobby's player
joins the old host's new match instead.

**A guest takes back only the host it knew.** While "Reconnecting", a guest accepts a host's hello from a new connection only
when it carries the browser id of the host it had (`hostBrowser`): its own host's new page or remade connection. Anyone else who
says "host" on the code is ignored (it used to be taken as the host). The regroup's elected host needs no exception: by then the
guest has closed its old lobby and joins the new one on purpose.

Measured on the loopback transport: tab closed to everyone in the new lobby, 41 s (30 s grace, 10 s board, about 1 s to meet).

### Joining

- Another peer's failed connection or wrong password never closes a joiner. Errors are kept per peer; the door tells a joiner
  which peer the host is (`{ t: 'host' }`), and only the host's own failure closes the join at once. With nobody at the door
  and nothing else in progress the join gives its only reason after `PENDING_ERROR_MS` = 8 s.
- A host that connects but never says hello (frozen, still loading) reads "its host is not answering" (`no-answer`).
- Join and Open lobby are one lobby however many presses (`busy`); the invite code stays in the address until the lobby is joined.
- Every close writes its reason to the console (`[coop] The room closed: lost (guest, joined, match crucible).`) and every
  screen shows `errorText()` (`lobbyText.ts`): the join page, the lobby page and a running match alike.
- Join and leave lines have one source, the lobby's own (`post`): "X joined.", "X is joining…" then "X joined." for a late
  joiner, "X lost connection.", "X is back.", "X reconnected." (back in the room but on the lobby page), "X left.", "X went
  back to the lobby.". The session's roster diff says nothing more.

### Standing still, and the other tab

- **In a menu, tabbed out.** A player whose Esc menu, shop or loadout is open, or whose tab is hidden, stands still under fire
  by design. The session tells the room (`LobbyPlayer.idle`: `'menu'` or `'hidden'`, sent with the player's `set`), and the tag
  over their body reads "NAME · in a menu" or "NAME · tabbed out" (one call site in `team.ts` `markers`).
- **"Play here instead" in another tab** makes the running tab reload (`core/oneTab.ts`). If that tab is in a co-op match, the
  waiting tab's notice now says so first: "A co-op match is being hosted in that tab. Playing here instead ends it for
  everyone in it." (or, for a guest, "takes you out of it"). The running tab answers the waiting tab's question over the same
  BroadcastChannel (`tabBusy`).

### Hooks for the other lanes (`CoopSession`)

| Hook | When |
|---|---|
| `onArrived.add((id, { seat, slot, name, rejoin, same }) => …)` | Host: a player is in the world. `rejoin` when that seat has been in this match before (reload, reconnect, back from the lobby page); `same` when it is also the same page as before (its connection dropped and came back), which still holds its own kit, purse and world |
| `onLost.add((id, seat) => …)` | Host: a player's connection dropped while they were in the world; the seat is kept 60 s |
| `onGone.add(seat => …)` | Host: a seat is given up for good |
| `onForget.add(id => …)` | Host: a connection id that will never be heard again: a seat's old page once it is back on a new one, or a seat gone |
| `holding` | True until the barrier lifts. Host-side timers that must not run before every player is in can read it |
| `lobby.live`, `lobby.waitingFor`, `lobby.holdLeft` | The barrier, who it waits for, seconds until it starts regardless |
| `lobby.reconnecting`, `lobby.reconnectIn` | Guest: the link to the host is in trouble |
| `deploy()` | Presses "Click to deploy" from a script (`coop-kit.mjs` `deploy`, used by `inMatch`) |

The hooks live in `src/net/seats.ts` (`SeatHooks`, fed by `Lobby.onSeat`) and have **one listener: `CoopWorld`** (`world.ts`,
`arrived` / `lost` / `forget`). Nothing else should subscribe; a module with a duty on one of them implements the matching
method of `WorldModule` (`world/context.ts`) and the world calls it:

| Moment | What the world does |
|---|---|
| **Arrived** (any way in) | `team.arrive(id, same)`: a new connection has its seat settled (`restore`: purse, kit, life), always, once; the same page back gets the last `wave` event it missed with the clock as it stands; everyone gets `sync` (wave, phase, break clock, vote, custom rules; `back` for the same page, which then shows no "joined late" banner), the board if the run is over, and then every catch-up (`team.onArrived`: mission, pods, guns, props, fort, villain's props, prisoners, vehicles, the Commander, friends' guns, call-ins). An arrival said before the host's own world is up is kept and run as it begins |
| **Lost** (`lostSeat(id, slot)`) | What the player held in the world is let go at once: their slow-mo (`clock.ts`), their Ghost flag (`targeting.ts`), their mounted gun (`fort.ts`, `Defense.leftSeats`), the man in their hands (`capture.ts`); the team starts the wipe grace (below). Their call-in copies and Frame puppet go on every screen, guests too, because `callins.ts` counts only players who are in the world; their vote stops counting with them (`teamBreak.ts`) |
| **Forget** (`forgetPeer(id)`) | Everything kept by connection id is dropped: stand-ins, Ghost and claim history (`targeting.ts`), the gun last told and budgets (`remoteFire.ts`), relay budgets (`booms.ts`), rates (`callins.ts`, `fort.ts`, `props.ts`, `capture.ts`). The lobby drops the id's ping and the lane layer its frame count when the peer leaves |

A lobby with no load barrier (every unit test's) says a seat's return only for the same connection coming back; a new page
there is known by its first card or its `worldsync`, which is also the spare in a real match:

**`worldsync`.** A guest says it as its world begins, after `loaded` (it used to be sent before, so the host, which still had
the guest as loading, always dropped it), and again every second until the host's `restore` has reached it (`ASK_MS`). The host
answers a page it does not know by arriving it (`team.asked`), and a page it knows but that is still not settled by sending the
seat again, at most once a second. So a host that was still booting when the session's own word came, or a `restore` that was
lost, heals itself.

### What a late or returning player is caught up on

Every fact that is said once, who hands it to a player who arrives late, reloads, or comes back on the same page after a drop,
and what proves it. "Arrive" is `team.arrive` and the catch-ups it runs.

| Fact | Who catches them up | Proven by |
|---|---|---|
| The seat: credits, score, kills, kit, life (`restore`) | Arrive, for a new connection; sent again if the page asks (`worldsync`) | `team.test.ts` (seats, "asks again"), `coop-team-rejoin`, `coop-fixsession-reload` defense |
| Where the waves stand: wave, phase, break clock, vote, custom rules (`sync`) | Arrive, every time | `team.test.ts` (late joiner, same page back), `coop-fixsession-return` |
| A wave event sent while their line was down (`wave`) | Arrive, same page: the last one, replayed with the clock of now (its pay, shop and banner follow) | `team.test.ts`, `coop-fixsession-return` part 1 |
| The run is over (`over`) | Arrive | `team.test.ts`, `coop-fixsession-return` part 3 |
| A respawn or revive that happened while away (`up`) | `team.update` (`rose`), as they come back; and a guest whose host has moved on to a later life stands up by itself after 2 s (`insist`) | `team.test.ts` |
| Lives, bleed, cards | Repeat 4 times a second | `team.test.ts` |
| The team's slow-mo (`slowstate`) | Repeats (4 a second while slow, every 2 s otherwise) | `clock.test.ts` (late joiner), `coop-time-team` |
| Enemies: place, health, plates, limbs, status | The full record once a second on the snapshot lane; `who` is told again after an absence | `replicas.test.ts`, `coop-session-late` |
| Vehicles, garrison, wrecks | Repeat 5 times a second; wrecks in `vehicles.catchUp` | `vehicleParts.test.ts`, `coop-worldb-vehicles` |
| Supply pods and caches | `pods.catchUp`, with their age | `pods.test.ts`, `coop-world-pods` |
| Dropped guns | `guns.catchUp`, with their age | `coop-drops` |
| Barrels, tanks, props, chairs | `props.catchUp` | `props.test.ts` |
| The fort: walls, gates, shacks, shops, guns, hires | `fort.catchUp`, then `fortstate` repeats | `fort.test.ts`, `coop-worldb-defense` |
| The villain's devices, shutters, smoke | `villainProps.catchUp` | `villainProps.test.ts` |
| Prisoners: questioned, held, cuffed | `capture.catchUp` | `capture.test.ts` |
| The Commander's briefing and warning chips | `villain.catchUp` | `attacks.test.ts` |
| The gun each friend holds (`held`) | `shots.catchUp` | `remoteFire.test.ts` |
| A mission: place, section, doors, objectives, music, sky, lights, kit, chips, racks, the film or ride | `mission.catchUp` | `mission.test.ts`, `coop-missions-play` |
| Call-ins in flight, a friend's Frame | `calls.catchUp` (each running order with its age); Frame poses repeat 10 a second | `callins.test.ts`, `coop-fixsession-callins` |
| The skyhook on its way to a prisoner | `hook.catchUp` (the lift with the seconds left) | `callins.test.ts`, `coop-fixsession-callins` |
| Pings, feed lines, tracers, blasts, attack clips, sounds | Nobody, by design: they pass | |

And the other way, what a **guest** says once to the host, which the host drops while it has that guest marked away:

| Word | How it gets there anyway | Proven by |
|---|---|---|
| "I am down" (`life`) | Said again every second while the guest is down and the host's card says up on the same life (`team.insist`, `DISPUTE_MS`) | `team.test.ts`, `coop-fixsession-return` |
| Ghost on or off (`ghost`) | The host forgets it when the line drops; the guest says its state again on the host's `sync` (`resay`) | `seatHooks.test.ts`, `coop-fixsession-return` |
| The kit (`kit`) | Sent again on `sync`, whatever was sent before | `team.test.ts`, `coop-fixsession-return` |
| The gun in hand (`held`) | Said again on `sync` | `seatHooks.test.ts`, `coop-fixsession-return` |
| A cache share taken (`pod took`), a mission's round counts (`rounds`) | Said again on `sync` | by reading; no proof of their own |
| Call-ins still running (`cin`) | Said again on `sync` with their age (`Callins.resay`) | `callins.test.ts` |
| A slow-mo let go (`slow` off) | Said again while the host still lists it (`clock.ts`) | `clock.test.ts` |
| A vote, a revive, a prisoner key, a mission's skip | Press again: every one shows the host's word, not the guest's guess | |
| A fort purchase (`fortbuy`) | Refunded after `ASK_SECONDS` with "No answer from the host" | `fort.test.ts` |
| Hit claims, `fire`, pings | Not said again (claims: checklist C9 and C12) | |

`resay` is one method on `WorldModule`: the guest's world calls it on every module when the host's `sync` arrives, because that
is the host saying it has this player in the world.

### Proofs (`tools/scripts/coop-session-*.mjs`, helpers in `coop-session-kit.mjs`)

Each asserts on every page and runs on the loopback transport; `COOP_SIM='lag:120,jitter:40,loss:0.05'` reruns it on a bad network.

| Script | What it proves |
|---|---|
| `coop-session-start` | 3 players (`COOP_PLAYERS=4` for four; both run), one held back 25 s: real clicks on the gate, nobody in the pause menu, the host's world held with "Waiting for GUEST-THREE" on both screens, slots are the lobby's, no join/leave lines, wave 1 only when all are in |
| `coop-session-noshow` | A guest that never arrives: the countdown, the host starting alone after 90 s and naming them, the guest joining the running wave later, announced once |
| `coop-session-blip` | The link silent for 8 s (the guest shows "Reconnecting to host…", nobody dropped, credits and gun unchanged), then the guest's page frozen 22 s (still in the match, never "left"), then the "in a menu" tag |
| `coop-session-reload` | A guest reloads mid-wave and is back in its seat, never playing without a session; the host reloads and all three are in a new match with their seats |
| `coop-session-late` | A late joiner by invite ("is joining…", "joined.", the wave and its enemies); a match ended while a slow page loads lands that page in the lobby with the reason |
| `coop-session-hostquit` | The host's tab closes: "Reconnecting", the HOST LOST board, both guests in one new lobby on the same code with the lowest slot hosting, and a new match from there |
| `coop-session-three` | Three matches in one room with a 3 s hitch on one guest at every start: everyone in every match, seats kept, the host's mode pick remembered |
| `coop-session-password` | Someone typing the wrong password does not disturb a friend joining; "Wrong password" for the one, a double press is one lobby |
| `coop-session-modes` | Every co-op mode in turn in one room: world held while waiting (no wave running, mission not begun), started when the guest clicks |

| `coop-session-drop` (`COOP_NET=rtc` only) | A live WebRTC connection cut under the guest: "Reconnecting", the seat kept, trystero finds the peer again, the same page back in its seat with credits and gun |

Results, 2026-11-18. Clean network, loopback: all nine pass. `lag:120,jitter:40,loss:0.05`, loopback: all nine pass (that run
found one bug, fixed: a goodbye cut off by the room closing behind it, so a Leave read as "lost connection"). Real WebRTC
(three browser profiles, the public relays): `start`, `hostquit` and `drop` pass; regrouped 42 s after the host's tab closed
(41 s on loopback), and after a cut connection the host noticed in 0.06 s and the guest was back in the world in 1.3 s. A
later run of `three` failed once on the loopback's own four-page cap (a new map page refused while old pages were still in the
room, finding S8): both transports now share the raised cap. The
other six were not run over real WebRTC. Evidence JSON and screenshots: `tools/out/coop/session/` (not kept in the repo).
Screenshots of guest pages on loopback show stale tiles in the lower third (the kit's popup windows are shorter than their
viewport); the host's are clean.

Unit tests: `src/net/session.test.ts` (the gate, the hold, real reasons, the hooks, the host-lost board, a host that gave way),
`src/net/lobbyLife.test.ts` (each timer rule and each case above over the fake transport, `fakeHub.ts`; one room one host; the
lobby-page reload), `src/net/seatHooks.test.ts` (what a lost player lets go of, what is forgotten, what a guest says again),
`src/net/roomNote.test.ts` (the room a tab remembers).

**The fix pass (lane "fix-session", 2026-11-19)** added two proofs, results in the plan's log:

| Script | What it proves |
|---|---|
| `coop-fixsession-return` | A guest's line dead for 20 s and more while every page runs (`sim.cut`), then back on the same page: the seat kept, its slow-mo let go, the wave event it missed replayed with the host's clock, the vote, no second seat; "I am down", Ghost, the kit and the gun in hand said again and in force on the host. The last one standing losing their link: no wipe for 10 s, none if back in time, the wipe at 10 s if not, and the board for the page that was away |
| `coop-fixsession-reload` | `FIX_CASE=lobby`: a guest, then the host, reload on the lobby page and are back in the same room in the same seats, and a match starts from it. `defense`: a reload mid-match in Outpost Defense gives the kit back and opens no loadout screen. `hostlate`: a host whose page comes back after its guests regrouped gives way and joins their lobby; one room, one host, a match from it |

### Not done

- The one-tab takeover warning (above) is not proven in a browser: the loopback proofs switch the one-tab rule off.
- Two hosts that both have players on one code stay two rooms (it needs both to have gathered players apart; there is no merge).

## Gore on every screen

The owner's rule: the gore is computed on each client, never streamed from the host, and a guest's own hits are instant. Bodies are
this game's toy, so a guest must get all of it. How it works since the overhaul (lane "gore"):

**One damage model, with the facts on or off.** `DamageModel` (`src/enemies/damage.ts`) is the only code that marks, moves or
kills an enemy. It runs the same lines in four ways:

| Call | Who | What it does |
|---|---|---|
| `apply` | Solo, and the host (its own hits, a guest's claims) | Everything: decides and draws. Writes what it found to `found` (`HitFacts`) and, for a death, `foundKill` |
| `predict` | A guest, for its own hit, on the frame of the shot | Draws all of it and decides nothing: the wound at its real size (`amount / maxHealth`), exit wound, gut spill, head pellets, blood puff, spray, wet skin and drips, plate wear and a plate shot off, flinch, stagger, fall or knockdown, the pain voice, `updateMaim`. No health, armour, limb, status or death. `killSoon` on the result is its guess at the kill |
| `show` | A guest, for a hit the host decided (a teammate's, the host's own, the world's) | The same drawing from the host's findings instead of its own sums: the host's amount, what stopped the round, the plate and whether it broke, the headshot verdict, what the body did (reaction level and strength), the blast's roll |
| `severShown`, `killShown` | A guest, for a cut or a death the host decided | The model's own `sever` (limb, `limb_sever`, the scream, `updateMaim`: a body short of its legs crawls) and its one kill flow, with what only the host knows: the blast's roll (a waist cut is a waist cut), that it was frozen (it shatters), a bursting head, the killing round's wound |

While the facts are off (`facts === false`) nothing the host owns is touched, and nothing is cut or killed that the host has not
said. A guest keeps its own count of limb pools and plate wear on its copy, as a guess; the snapshot's plate mask and the host's
events are the truth. Ragdolls, gibs, severed limbs and corpses are each machine's own simulation and may land differently.

**The shooter's eye.** What gore sizes by range (a point-blank blowout, a gut shot, a pellet's wound) goes by where the shooter
stood, not the watcher: `DamageInfo.from`, set by the model from `DamageModel.shooter` (the host applying a guest's claim, a guest
shown a teammate's hit: the teammate's body plus 1.6 m). The local player's own hits carry none and read the local eye, as solo.

**A guest's own hit** (`CoopWorld.claim`): `Hits.stamp` numbers it (`DamageInfo.claim`, 1 to 65535), claims.ts sends the claim
with that number in its damage, and `Hits.predict` draws it now and keeps it in a ring of 256 (`Pending`: the enemy, what the guest
reckoned it took, whether armour stopped it, what the body did). `Enemy.owed` adds up the health its unanswered hits should take,
so the guess at a kill is "health last heard, less what I still have in the air". Unanswered after 2.5 s (the host dropped the
claim), a hit is forgotten.

**The host's answer.** For a guest's claim the host sends the shooter an `ack` and **no picture** (`hitOut`): the claim's number,
the enemy's health and armour after, and the host's findings. `ackIn` then puts right only what was drawn wrong:

| The guest drew | The host found | Then |
|---|---|---|
| blood | armour stopped it | the sparks and the ring of armour, late; the blood stays |
| sparks | it went in | the whole hit is shown now (`show`) |
| the body stayed up | it went down | it goes down now, with no second wound (`reactShown`) |
| the body went down | it only flinched | it is roused and gets up (`rouseReplica`; enemy-motion's wait would rouse it a moment later anyway) |
| a plain blast | the ring laid the body open | it is opened now |

Everyone else gets `hitfx` (host's own hits: every guest; a guest's claim: the other guests) and runs `show`. The host's own
screen, which a guest's gun never drew on, gets the round's landing from `Combat.remoteHit`: blood or sparks and its sound there.

**Kills.** The body dies on the host's word (`kill`), never on a guess. What tells the shooter of a kill goes by `killSoon`, at
once: the kill marker, `headshot` and not `headshot_crack`, the red mist, hit-stop (`toldKill()` in `core/gameplay.ts`, read by
Combat, Melee, the Kiln and explosions). A later round into a body already told dead is `doomed`: it marks the body and tells
the shooter nothing, as a round into a corpse does in single player. A kill the guess missed (a man's wounds decide it on the
host, or the host knew better) is announced when `kill` arrives (`Combat.killConfirm`). What needs the corpse waits for the
host's word through `CoopWorld.whenKilled`: a stake nails the body to the wall (`Projectiles.nailLate`), a blade flings it; both
within 1.5 s or not at all. The guest's own `enemy:killed` is emitted then, as before.

**Whose news it is.** A guest emits `enemy:hit` and `enemy:severed` for its own hits only (its own guess), so its hit-confirm
audio, headshot-hit score, Butcher, BACK SHOT and run report work as solo. On the host, audio's and the run report's listeners
skip a teammate's hit, cut or kill (`notMine`): the host no longer hears a guest's hit markers. What a death or a cut sounds like
where it happened (`limb_rip`, a gib's splatter, a head's pop) plays on every screen.

**Knockdowns on a copy.** A guest's gore knocks its copy down from its own hit, at once, or from a hit it is shown. From there
the body is enemy-motion's to wait out (`replicas.ts` `ragdoll`, `moves.ts`): gore has it, nothing places or poses it, it lies
until the host's body is up (the `getUp` move, or the host seen standing for a moment) and is then roused (`gore.rouse`) and
eased back under the host's position. The host also sends every knockdown of its own as a `down` move; a copy that began one
of its own in the last 400 ms ignores it. In its own model a guest's copy lies for `REPLICA_LIE` (20 s) at most, as a backstop.
`placeReplica` begins with gore's small part: a copy's shock fades as the host's does, a stagger that turns into a fall comes
due (`fallIn`), and what its hits pushed it by is dropped each frame, because the host's position is where it stands.

**Budgets.** Corpses, ragdolls, limbs, decals and blood are capped by `GoreTuning`, `BloodTuning` and the decal and particle
rings, set from the local quality setting alone. Nothing in `src/gore`, `src/fx` or `src/render` reads whether this machine hosts.

### The events

| `t` | Fields | From, to |
|---|---|---|
| `hitfx` | `u` uid, `by` shooter's slot, `h` `a` health and armour after (tenths), `f` findings, `d` the round | Host to every guest but the shooter |
| `ack` | `c` the claim's number, `u`, `h`, `a`, `f`, `k` it killed | Host to the shooter |
| `sever` | `uid`, `region` where the cut was made (one event a cut), `by`, `d` | Host to guests |
| `kill` | `uid`, `id`, `at`, `yaw`, `gib`, `by`, `head`, `k` the death's findings, `d` | Host to guests |

`d` (`packHit`): `[type, bone, region, x, y, z (mm), dx, dy, dz (127ths), amount (tenths), force (tenths), bits, source, load]`
plus a cut's plane. `bits`: gib, pierces, armour-piercing, vaporize, spill, the trunk's break (2 bits), slice. Millimetres because
gore seeds a broken trunk's pieces from the point (`planGib`), so every screen breaks it the same way. `f` (`packFacts`): `[amount
(tenths), bits, plate index, strength (hundredths)]`; bits: what stopped it (3), the armour outcome (2), broke, headshot, reaction
level (3), knockout, tripped, blast roll (4). `k` (`packKill`): blast roll, frozen, heavy head, and the killing hit's amount.

Sizes as JSON, before the match wrapper every message on the reliable lane carries today (58 bytes, the wire lane's to
remove): `hitfx` about 115 bytes, `ack` about 65; the old `hitfx` was about 330 and went to the shooter too
(`hitWire.test.ts` holds them under 120 and 70 for a sample). Measured in the browser, a guest emptying a gun into sixteen
bodies for six seconds at 60 fps on a clean link (`tools/scripts/coop-gore-bytes.mjs`, 2026-11-18):

| Gun | Shots a second | Hits a second | To each watching guest (`hitfx`) | To the shooter (`ack`) |
|---|---:|---:|---:|---:|
| Buzzsaw (the minigun; a round goes through more than one body) | 24.8 | 36.3 | 4,152 B/s (6,255 with the wrapper) | 2,360 B/s (4,463) |
| Pump shotgun | 1.8 | 9.1 | 1,058 B/s (1,588) | 610 B/s (1,141) |

No picture of its own hits went to the shooter in either. The wire lane will make these binary and batch a frame's worth.

### Contracts with the other lanes

- **claims:** the claim's damage carries `claim`; the validator must keep it (it copies the whole damage). The host reads it back
  off the damage in `enemy:hit`. `Hits.stamp` and claims.ts's `claim` must agree on what is the world's own and never claimed
  (an enemy's blast, `bleed`, `hazard`, `trample`, `coop`).
- **enemy-motion:** gore starts flinch, stagger and knockdown on a copy from its hits; a move never restarts one of the same
  kind begun in the last 400 ms (`SAME_KIND_MS`), and a copy's own ragdoll is waited out in `replicas.ts`. `placeReplica` begins
  with gore's part (shock, `fallIn`, the dropped push). The states' sever bits still cut at once with a made-up hit
  (`replicas.ts`): they should wait about 300 ms for the `sever` event, which carries the real round; when a state wins the race
  the limb drops without its sound, its scream or its flight. `hitfx` and `sever` for an enemy not drawn yet wait for it
  (`Replicas.whenSeen`).
- **wire:** keep `claim` in the claim's damage, and millimetre points in `kill`.
- **Mocked managers in tests** need the gore entry points: spread `goreDoubles()` (`src/net/world/goreDoubles.ts`) into them.

### Proofs

`src/enemies/damage.coop.test.ts` (the real manager and model, facts off), `src/net/world/hitWire.test.ts`, `src/net/world.test.ts`
(a hit, a cut and a death shown once; a guest's own hit drawn at once and answered without a picture; the four corrections; a
dropped claim forgotten; a late kill announced once and what waited on the body run).

`tools/scripts/coop-gore-shots.mjs`: three pages (host, a guest who shoots, a guest who watches). Seven shots, each fired once by
the host and once by the guest: pistol, rifle, shotgun point-blank, rocket, sword, a shotgun to the leg, a headshot kill. It reads
from every page what its gore, effects, sound and HUD were asked to do and checks: the guest's first blood is on the frame its gun
fired; the host answered; every screen wounds as often and as deep as the host decided, throws the puffs, cuts the same limbs off
the living body, leaves the body in the same state or kills it the same kind of way; nobody but the shooter gets a marker or a
hit sound; the shooter gets the same markers and sounds as host and as guest. `COOP_SIM=lag:120,jitter:40,loss:0.05` runs it on
a bad network. Results on 2026-11-18, loopback transport, the dev box under heavy load from the other lanes: 267 checks pass on
a clean link (the host's answers took 55 ms on average, 114 at most) and 267 under lag 120, jitter 40, loss 5% (640 ms on
average, 1,020 at most: two simulated legs, a resend stall and slow frames); the first blood was on the frame of the shot in
every case, and no claim was rejected (two were answered `gone`: the rest of a blast into a body already dead on the host).
`tools/scripts/coop-gore-bytes.mjs` is the table above.

What a later pellet of the shooter's own blast does to the fresh corpse (a limb off the dead) is that screen's own gore: other
screens are not shown a teammate's rounds into corpses.

## Weapons on other screens (the remote FX table)

The owner's rule: everything that happens on one player's screen happens on the others'. Until the overhaul a friend's gun, whatever
it was, was one bullet tracer, a muzzle flash and a sound. Now a friend's shot is **the shooter's own FX code run again on this
screen, from the friend's body**, with two switches that make it harmless:

- **`Combat.watching`** (a counter, `src/weapons/Combat.ts`). While it is above 0, `strike` and `explode` do nothing, corpses, map
  objects and vehicles are not touched, and no blood is drawn. Everything else in `fireRay` runs: tracers, wall impacts and bullet
  holes, flechette needles, API sparks, a 20 mm round's burst, exits through cover, ricochets, shock arcs. `Raufoss.fire`,
  `flakBurst` and the `Lance` run under it unchanged.
- **`ProjectileSpec.cosmetic`** (`src/weapons/Projectiles.ts`). A friend's rocket, shell, launcher grenade, thrown grenade, stake,
  exploding bolt, plasma ball or Quiver missile is a real entry in the projectile pool with this flag: it flies, trails, steers
  (a missile for the same enemy by uid, a wired rocket for the friend's own laser dot, a helix salvo by its six numbers), bounces,
  sticks, beeps and bursts as the shooter's does, stepped under `Combat.watching`. Its blast is not drawn by the copy: it arrives
  from the shooter's game as `boom`. An explosive round carries a number (`ProjectileSpec.tag`), and when the shooter's own goes
  off it says so (`loop`, kind `proj`, with where): the copy ends there and then, wherever it had got to on this screen (the body
  it met may stand somewhere else here), and a flak shell bursts at the shooter's own burst point.

The damage is always the shooter's own game's, as claims the host checks. The blood, the wound and the kill reach other screens by
`hitfx`, `sever` and `kill`. Nothing a watcher draws can hurt, burn, break or move anything that matters.

| Piece | File | What |
|---|---|---|
| The table | `src/weapons/watch.ts` `REMOTE_FX`, `REMOTE_MODS` | One row a weapon (`rounds`, `pellets`, `projectile`, `lance`, `hose`, `melee`) and one a mod, each with what a watcher sees in plain words. They are `Record`s over every `WeaponId` and `ModId`, so `tsc` refuses a new weapon or mod without its row, and `watch.test.ts` holds each row to what the weapon's own row fires |
| The dispatcher | `src/weapons/watch.ts` `Watcher` | One a friend. `fire` (a shot), `launch` (a projectile), `loop` (a beam, giant ball or stream ended), `meleeFx` (a slash in the air), `hold` (their gun and mods), `doing` (their pose's bits), `update` |
| The friend's body | `src/net/remote.ts` | `Shooter`: their eye and aim from the pose (20 Hz, interpolated), their third-person muzzle (the left gun's for akimbo), a gesture on the body, their seat (1 to 3) and their weapon light |
| The wire | `src/net/world/remoteFire.ts` | Below |
| The shooter's note | `FireNote` on `weapon:fired` (`src/core/gameplay.ts`), filled in `Weapons.ts`, `lance.ts`, `melee/Melee.ts` | Kind, hand, barrel, rounds, cone, seed, second load, locked head, swing |

**Events** (reliable lane, JSON for now; the wire lane will pack them). A guest's go to the host, which checks them (the sender's
body is in the world and not down, the origin is within 7 m of it, `acceptFire`'s token bucket for `fire`, 40 a second for the
rest), draws them and passes them on with the sender's slot.

| Event | When | Fields | Bytes |
|---|---|---|---:|
| `fire` | Every pull, swing, Lance shot; a held Kiln every 120 ms | `weapon`, `origin` (mm), `dir` (1e-4), and only when needed: `k` kind (`rail`, `beam`, `ball`, `giant`, `hose`, `swing`), `f` flags (left hand, second load, barrel; or heavy, energy for a swing), `n` rounds, `c` cone and `s` seed for a scatter, `snd` and `p` for a swing | 80 to 110 |
| `round` | A gun's round or a thrown grenade leaves (`Combat.spawnProjectile`) | `k` kind, `src`, `o`, `v`, and when set: gravity, life, fuse, trail, size, tint, explodes, wired, flak, the target's uid, the missile's five flight numbers, a helix salvo's six | 90 to 190 |
| `loop` | The beam ends, the giant ball goes off (`at`, `n`), the Kiln stops, or the sender's own explosive round `i` went off at `at` (`k: 'proj'`) | `k` | 30 to 70 |
| `held` | The gun in hand or its fitted mods change (looked at every 0.4 s); the host repeats everyone's to a guest who arrives later | `weapon`, `mods` | 40 to 90 |
| `mfx` | A swing draws in the air: a slash, a ring, dash streaks, a cleave's slam, a sound heard from the swinger | world-space vectors and two numbers | 60 to 110 |

**Pellets come from a seed.** In co-op a scatter gun draws its spread from `SeededRandom` (`src/core/math.ts`) seeded per pull, and
sends the count, the cone it used (choke and ADS included) and the seed; the watcher draws the same directions with the same
generator. Single player still uses `Math.random` and is untouched. One round off the aim (the Trommel's wobble) is sent as its own
direction, and a locked shot (smart aim, a fanned shot, Gun Kata) as the direction to the head.

**Loops follow the pose.** The Lance's sustained beam and the Kiln's stream are not streamed. A `fire` starts them, the friend's
pose (eye and aim, already 20 a second on the unreliable lane) aims them, and a `loop` event or their own clock ends them: the beam
after its one second, the stream 0.45 s after the last `fire` that says it is still on. So a lost or late event can never leave one
stuck on.

**What a player is doing between shots rides in the pose** as one byte (`Pose.flags`, `DOING` in `src/net/pose.ts`, format version
2, 41-byte header): reloading, injecting a stim, the rocket's laser sight up, a Lance charge under way and its mode. States, not
events, so a lost pose costs nothing. The watcher turns a rising bit into a gesture and its sounds (a reload plays the gun's own
`reloadFoley` cues from the friend), draws the laser while its bit is up and steers that friend's wired rockets for its dot, and
pulls a charge's slivers into their muzzle with the hum.

**The Lance** for a watcher is the same `Lance` class with a `LanceHolder` (the friend's eye, aim and muzzle): `replay('rail' |
'beam' | 'ball' | 'giant')`, `stop()`, `land(at, normal)`. Everything of the one who pulled the trigger is behind `self`: the cell,
the kick, the shove, hit-stop, hit markers and every screen effect (flash, chromatic, radial blur, FOV, trauma). The beam's two
loops and every other sound are placed at the friend's muzzle. A friend's giant ball does not decide what it touches: it flies its
line, waits up to 0.6 s at a wall, and goes off where the shooter's game says.

**The Kiln** for a watcher is the shooter's napalm (`Flames.friendGlob`): globs at 15 a second (the shooter's own are 30) from the
friend's nozzle down their aim, each friend their own strand of the one hose ribbon (the layer takes 148 points now, was 74),
splashing and feeding burning patches marked `cosmetic`, which set nobody alight (who burns is the host's word).

**Weapon lights.** Three spotlights are made with the session, before the first frame, and kept in the scene dark
(`friendTorches`, `src/net/remote.ts`): adding a light later recompiles every lit shader. A friend's is lit while the gun in their
hand has its `<gun>Light` mod, from their muzzle down their aim, with the viewmodel torch's own numbers.

**Sounds** are placed at the friend's muzzle and fade with distance as any world sound. A friend's gun report plays at 0.65 of its
level (`REPORT`). The rotary cannon has no report a round: its barrage loop runs from the friend's gun while rounds keep coming.

**Known limits.** The Bailiff body has no reload or stim clip: a short brace of the arms (`block`) stands in for both. The energy
blade is its hum, its zap, its light on what is near and its slashes; the blade model on the body is still the steel one. The
Trommel's spin-up whine before it fires is not sent. A friend's perk looks (a perk's tracer colour, its extra sound layer) are
not sent. A friend's muzzle flash within 3 m of the camera is lifted into the view scene, as an enemy's is (`docs/notes/fx.md`).
A stake or a bullet-kind round that stopped in a body on the shooter's screen flies on to the wall behind on a screen where
that body stands elsewhere (only explosive rounds are ended by number).

**Measured** (the events' own JSON, before the transport's envelope of about 30 bytes; `coop-fx-matrix.mjs` records it a case):

| Weapon | An event | A second, held |
|---|---:|---:|
| SMG | 78 B a round | 1.0 KB/s at 800 a minute |
| Pump shotgun | 112 B a pull (count, cone, seed) | 0.2 KB/s |
| Thresher | 122 B a shell | 0.6 KB/s at 5 a second |
| Deuce, both barrels or all four | 112 B | one event a pull |
| Trommel | 89 B a round | 2.2 KB/s at 25 a second |
| Lance rail | 96 B | |
| **Lance beam, held its whole second** | 101 B to start, 22 B to end | **0.12 KB for the beam** (its aim is the pose, which is sent anyway) |
| Lance ball, giant ball | 218 B, 176 B (start and end) | |
| Kiln | 88 B every 120 ms | 0.7 KB/s (was a `fire` a glob: 30 a second) |
| Rocket | 215 B (`fire` and `round`), and 58 B when it goes off | |
| Quiver salvo of four | 1.1 KB | |
| A sword swing | 127 B with its slash | |

**Proofs.** `src/weapons/watch.test.ts` (the table; pellets from the seed landing on the shooter's spots; flechettes; a suppressor
by kit; a round through cover; Raufoss; the rail, the beam, the giant ball; rockets and stakes; the Kiln; swings; the pose's
bits), `src/net/world/remoteFire.test.ts` (the wire, the host's checks, sizes), and the three-page browser proof
`tools/scripts/coop-fx-matrix.mjs`: one player fires every weapon, load and special while a second stands beside them and a third
watches from across the room; on both watchers it compares the fx, decal, light and sound calls with the shooter's own, and where
things ended. Host firing, then a guest firing. 46 cases: the Lance's four shots and its charge; SMG plain, suppressed, akimbo and
with its light; Gimlet and its launcher; Harrow and API; Flail; pump, flechettes, choke; Thresher; Deuce one barrel, both, and the
quad's four; Rocket with and without its laser; a Quiver salvo; Sabot and Raufoss; Awl; autocannon and flak; katana, energy
blade, stab; Judge, Rivet, Ultramag suppressed, Autoraffica; Trommel and its 12 mm; Piledriver and Raufoss; Kiln; stakes and an
exploding bolt; a thrown grenade; a reload; a stim.

Run on 2026-11-18 (loopback transport, three pages; the machine was overloaded by other lanes' runs, so the pages made 1 to 12
frames a second: these runs prove what is drawn and where, not how smooth it is). Clean network: 90 of the 92 case-rounds passed
with every check (1,581 checks); the two that did not were the Trommel's barrage sound restarting when the shooter's page
hitched, fixed with the `spin` stop and passed on a re-run. `lag:120,jitter:40,loss:0.05`: 88 of 92; the four misses were a late
watcher having less of something that ends on the shooter's clock (a flak shell's trail rings, a bolt's beeps, a beam not yet
begun 350 ms in), which is what lag does; those checks now allow for it, but that re-run was not completed (the pages fell to
2 frames a second and a guest dropped). After the rebase onto the other lanes' work: 43 of 44 case-rounds of a 22-case subset,
the one miss a fixed spark count that a 2 fps page could not reach (now relative to the shooter's). Not run: four players,
real WebRTC (`COOP_NET=rtc`), and any mode but the Crucible.

## The shared world: pods, dropped guns, things that break (overhaul lane "world-a", 2026-11-18)

Owner decision 4: everything is shared. One supply pod, guns on the ground that anyone can take, and one set of barrels, windows
and props. The host decides each of them; every screen draws its own copy.

| File | What |
|---|---|
| `src/progression/pickups/pods.ts` | The pods and every rule about them, solo and co-op |
| `src/net/world/pods.ts` | Carries the pods' news (`pod`) |
| `src/weapons/dropped.ts` | Guns on the ground and every rule about them |
| `src/net/world/guns.ts` | Carries their news (`gun`) |
| `src/world/objects.ts`, `src/world/breakables.ts` | Barrels, tanks and props; `PropLink` is what they need of the wire |
| `src/net/world/props.ts` | That wire (`prop`): hits, breaks, chairs, the late guest's state, the machinery clock |
| `src/net/world.ts` | `catchUp(id)`: pods, guns and props for a guest whose world has just come up; `worldsync` |
| `src/net/world/sharedkit.ts` | Test kit: a host and guests over a mocked relay, on stub games or real ones (`makeRange`) |
| `tools/scripts/coop-world-pods.mjs`, `coop-world-drops.mjs`, `coop-world-props.mjs` | The browser proofs |

### A guest that arrives late

"Late" is any guest whose world comes up after something happened: it was still loading the map, it joined mid-match, or it
came back. Events are dropped until a guest's world has begun, so each of those would miss a pod, a gun or a broken window.
(2026-11-19: the triggers are now the session's arrival word and, as its spare, `worldsync`; see "Hooks for the other lanes".)
Two triggers cover it, on purpose both: the guest sends `{ t: 'worldsync' }` the moment its world begins, and the host also runs the
same catch-up on that guest's first card (`team.onArrived`). The catch-up sends every pod out (with its age), every gun lying
(with its age), and the world's broken state. Everything is keyed by a number and applied once, so being told twice is harmless.
Each of the three parts runs on its own: one that throws does not cost the guest the others.

### Supply pods and weapon caches

- **One pod.** The host calls it (`DropPods.call`) and sends `{ t: 'pod', op: 'call', id, at, yaw, age, supply }`. A guest never calls
  its own (`onWaveClear` and `call` do nothing on a guest; a mission's mirrored cache op is a no-op there too) and flies the
  host's from the same spot, turned the same way. The spot is picked from the middle of every player in the world, 25 to 110 m
  out, so it is a fair run for all.
- **One clock.** In co-op the pods run on the wall clock: the game's `realDt` is capped at 50 ms a frame, and a page that hitched
  would fly its pod late for good. A guest's pod is behind the host's only by the message's delay.
- **One blast.** The pod lands once, on the host. A guest skips `combat.explode` in `land()`: its own would hit the enemies again and
  be mirrored back to everyone (the "three unexplained blasts" of the audit). The host's landing reaches a guest as the usual
  explosion (`boom`) at the moment its own copy touches down.
- **Each player's own shop.** E at the open pod opens that player's own Procurement: own credits, own unlocks, own purchases.
- **Ends on the host's word.** The host retires the pod when its break ends and sends `gone`. A guest's own copy of the waves cannot
  end it (that was the race of audit A5); only if the host's word never comes does a guest drop it, 10 s after its own break ended.
- **The race (audit A5), fixed twice over.** Both wave directors (`enemies/waves.ts`, `enemies/outpost/waves.ts`) enter the break before
  they announce `wave:clear`. The `wave` event carries `phase` and `next`, and `Team.followPhase` sets them on the guest before
  replaying the event; a clear is always the break, whatever the director said (Outpost Defense's still announces first).
- **Weapon caches** (missions, and `?shop=0`): the same shared pod. Each player who walks in gets their own share once: the next gun
  their own arsenal is due, or the full resupply. The pod stays for the others, unmarked for whoever has taken, until every
  player in the match has had theirs or its 90 s run out; the host says when (`took` from a guest, `gone` to all). Nobody can take
  another's share.
- **Ordinary pickups stay each player's own** (ammo, stims, armour, the mega items, power-up capsules, kill drops), as the lead
  decided. Checked for anything visibly wrong in co-op: each browser lays out and marks only its own, a pickup one player
  takes was never on another's screen, and a mission's handed-out pickups are mirrored to every player as their own copy. Nothing
  was changed.

### Dropped guns

A drop is how players share guns. It carries the gun's mods (held and fitted), its magazine and its reserve.

- **Where it lies.** `settle()`: 1.3 m ahead of the feet, stopped 0.4 m short of a wall in the way, then down to the floor under that
  point (up to 80 m: off a ledge it falls and lies below). The fall is drawn (`fall` metres, the same gravity as the old 0.35 s
  throw). On level open ground a solo drop is exactly where and how it was.
- **Seen.** In co-op every drop has a 7 m column of light and a ring on the ground once it has landed, and the feed says "NAME
  dropped a GUN". The prompt reads "[E] Take GUN (from NAME)".
- **Taken on purpose.** In co-op a gun is taken only with E. Walking over one takes it only solo, as before. (Decision: a gun on
  the ground may be a gift for someone else; with auto-take the nearest player hoovers it up.)
- **Two players at once.** The host gives it to the first `take` it hears (`give` to them, `gone` to all with the taker's name). The
  other's screen says "NAME got to the GUN first". The host's own E is settled on the host's frame like anyone's.
- **A guest's drop is never lost** (audit-play W2). It lies on the guest's own screen at once, unnumbered, and goes to the host with a
  request number (`drop`, `q`). The host numbers it and tells everyone (`add` with `q` and the dropper's `slot`); the guest's own
  drop takes the number. If the host refuses it (`back`), or says nothing for 4 s, the gun returns to the guest's hands with a
  feed line. A number that arrives after that is withdrawn (`void`), so there is never a second gun.
- **Whose drop** is by roster slot, not by callsign.
- **Host's checks:** a real gun with only its own mods and rounds it could carry (`cleanKit`); the resting spot within 8 m of the
  guest's body on the host's screen, else its feet; a take within 10.2 m; at most 24 guns lying (the oldest goes).
- **Logged.** Every gun message is `console.info`'d on both sides as `[coop gun] ...` (audit E11).
- 150 s on the ground, on the host's clock; a late guest gets each gun with its age.

### Barrels, tanks and props

- **By number.** The map is built from one seed, so `explosives[i]` and `props[i]` are the same thing on every screen (the proofs
  compare the lists). `set` is `'x'` (explosive) or `'b'` (breakable prop).
- **A guest's hit** goes to the host: `hit` (added up per target and gun, one message a frame) and `blast` (its own explosions).
  What its own hit breaks, it breaks at once on its own screen: a guess. The host applies the same damage to its own copy and
  sends `break`, which every other screen draws with the same pieces and which confirms the guess. A guess not confirmed in
  2.5 s asks for the host's state (`ask`), which stands the thing up again.
- **A barrel goes off once.** On a guest a barrel or an exploding prop is only drawn: no `world:explosion`, so no damage to enemies
  from there (that was audit-play W1, the barrel used twice), no chain, no wear on walls. The host's copy does all of that, as the
  doing of the guest who set it off (`credit.as`, carried down the chain), so kills go to the right player.
- **Everyone in reach feels it** (audit-play E7). Each player's own game works out what a world blast does to that player from
  where they really stand: damage, push and shake, through a blast marked `playerOnly` (`Combat` skips enemies, vehicles and the
  world for it). That includes the player who shot the barrel, and teammates standing beside it: a barrel is the world's, not a
  player's weapon. (Decision; see the owner question in the overhaul log.)
- **Chairs** fly on the host and every guest is told (`knock`, 90 a second at most), then where each came to rest (`rest`), so they
  end in the same place. A guest never throws one by itself.
- **Barrels come back** on the host's clock only (`restore`), and never within 20 m of any player.
- **A late guest** gets `state`: explosives gone, props broken, moved chairs, applied without a sound.
- **The map's machinery.** Crushers, live plates and gantries are a function of the world clock; a guest adds `clockSkew` so they are
  in the host's phase (`clock`, every 2 s; eased, or snapped past 0.75 s). The reactor's state is set by the host's waves and
  rides the same message.
- **Host's checks:** a living sender whose body is in the world, a target within 450 m, an amount capped at 5,000, 300 hits and 40
  blasts a second per guest.
- **Not this lane's:** walls, gates and shacks (`world/structures.ts`) are lane world-b's. A guest's blast is applied on the host to
  barrels and props only.

Checked and left alone in `src/world/`: mission doors (mirrored by `mission.ts`), jump pads and launch ramps (each player's own
trigger), hazards (each player's own damage), nav blocks (the host's AI only).

### Verification

Unit: `src/net/world/pods.test.ts` (9), `src/weapons/dropped.test.ts` (9), `src/net/world/props.test.ts` (10), and the older
`handover.test.ts` and `progression/pickups/pods.test.ts` unchanged.

Browser, each asserting on every page (`node tools/shot.mjs --port <port> --script tools/scripts/<name>.mjs ...`, options in each
file's header): `coop-world-pods.mjs`, `coop-world-drops.mjs`, `coop-world-props.mjs`, `coop-world-cache.mjs`.

Runs of 2026-11-18, loopback transport, on a machine loaded by eleven other agents (load average 60 to 90, so frame rates and
waits are worse than a quiet machine's). "Bad network" is the game's simulator at `lag:120,jitter:40,loss:0.05` on every page.
"+ late" is a third page that joins mid-match.

| Proof | Mode and map | Pages | Network | Checks passed |
|---|---|---|---|---|
| pods | Crucible | 2 + late | clean | 16 of 16 |
| pods | Crucible | 3 | clean | 14 of 14 |
| pods | Crucible | 2 + late | bad | 16 of 16 |
| pods | Endless Humans, Office | 2 + late | clean | 16 of 16 |
| pods | Endless Humans, Office | 3 | bad | 14 of 14 |
| cache | Mission 1 | 2 | clean | 9 of 9 |
| props (barrels) | Crucible | 2 + late | clean | 14 of 14 |
| props (barrels) | Crucible | 2 + late | bad | 14 of 14 |
| props (windows, monitors, the tank) | Crucible, Office | 2 + late | clean | 16 of 16 |
| props (windows, monitors, the tank) | Crucible, Office | 2 + late | bad | 16 of 16 |
| drops | Crucible | 3 | clean | 17 of 17 (before the last steps were added to the script) |
| drops | Crucible | 2 + a guest still loading | clean | 21 of 21 |
| drops | Crucible | 3 | bad | 18 of 18 |

Numbers from those runs. Pods: each page's pod within 26 to 52 ms of the true clock since its call; the pages' pods began to fall,
landed and opened 12 to 46 ms apart on a clean network and 242 to 280 ms apart on the bad one (the simulated delay itself).
Windows: the shooter's own screen broke the pane 42 to 164 ms after the first round was fired (its own guess); the other pages
within about 115 ms of that. Barrels: one explosion drawn per barrel that went off on every page, `world:explosion` raised on
the host only (3, 0 and 2, 0 in the two-page runs), the guest's game sent 0 damage claims, the guest who shot from 5 m lost
health and the host 22 m away lost none. Host refused 0 of the guests' hits.

Not run: four pages and real WebRTC (`COOP_NET=rtc`), under the lead's limit of three pages and one browser a lane.

## The team's rules (overhaul lane "team", 2026-11-18)

What it means to play as a team: how a run ends, who gets up when, the break between waves, what a player keeps across a drop,
who is paid for what, and the HUD that says so. Co-op only: single player's endings, break and shop are untouched. Code:
`src/net/team.ts` (lives, endings, seats), `teamBreak.ts`, `kit.ts`, `marks.ts`, `world/credit.ts`, `coopHud.ts`.

### Endings

A co-op run ends in exactly one way: the host calls `team.finish(how)`, which sends `over { how, cards, wave }`, and every screen
puts up the team board. No page ever shows the solo "Run over" or "Mission complete" screen, and the host's game never enters the
`gameover` state, so the host's world keeps running under the board.

| Ending | What triggers it on the host | Headline |
|---|---|---|
| `wipe` | Nobody who is in the world is up (and, in a mission, there is no checkpoint to go back to) | TEAM WIPED |
| `fulfilled` | Endless Humans: the Commander is dead. `Hud.fulfilled()` calls it once his last words are read; if they never finish, the team calls it itself after 25 s | CONTRACT FULFILLED |
| `mission` | `campaign:complete` | MISSION COMPLETE |

- **The board** (`coopHud.showEnd`) sits over everything (`Hud.teamBoard`): the co-op "paused" state lets the mouse go and never
  stops the clock. Buttons: a guest has **Back to lobby** (steps out alone); the host has **Back to lobby (everyone)** and **Start
  again** (`CoopSession.playAgain`: everyone lands on the lobby page and the same mode starts at once, each on their gun). Arrow
  keys pick, Enter presses. After `END_SECONDS` = 20 s the host's page takes everyone back to the lobby.
- Only players **whose world is up** count for the wipe (`present()`): not someone still loading or on the lobby page. A guest
  who arrives after the run ended is sent the board at once.
- **A dropped connection is not a wipe on that frame.** A player who was on their feet when their line dropped still counts as
  up for `LOST_UP_MS` = 10 s (the session keeps the seat 60 s and they are usually back in a few); once their line answers again
  they get at least `LOST_BACK_MS` = 5 s more to arrive. Not back by then, the wipe rules apply. Someone who was already down
  holds nothing off, and a deliberate leave is not a lost seat. (Before, the last one standing losing their link for a second
  ended the run.)
- A host that is gone for good is the session's own board ("The life of a session", Host loss).

### Lives

- Down at 0 health, 30 s to bleed out (`BLEED_MS`), revived by a teammate's held E: as stage 3.
- **Everyone dead or down gets up when the wave is cleared**, before the wave's pay and pod go out, and again as the next wave
  starts (for someone who fell during the break). In a mission the dead wait for a checkpoint, and are told so ("back at the
  checkpoint", never "next wave").
- The bleed clock never counts a stalled host: a host frame longer than 250 ms gives the excess back to every downed player. A
  player whose connection has dropped does not bleed at all until they are back.
- Perks are still lost on going down (lead's decision).

### The break and the ready vote (`teamBreak.ts`)

- **45 s** after a cleared wave (`TEAM_BREAK`), **60 s** before a boss wave (`BOSS_BREAK`: the Crucible's boss waves by the host's
  rules, Endless Humans' wave 10). The host sets it as the break begins, so the clock that goes out with the wave's news is the
  team's. The first countdown of a run is not a break.
- **The next-wave key (L) is a vote.** A guest's key sends `ready`; the host's own key is a vote like anyone's. When **every living
  player in the world** has voted the break drops to its last 3 s (`CUT_TO`). One player alone never cuts another's shopping; the
  dead never hold the team up; a player in the shop can vote from the shop screen; a voter who leaves stops counting.
- Every screen is told with `vote { ready: slots, need, by }`: the chip under the teammates strip reads `NEXT WAVE IN 36 s · 1/2
  READY · [L] READY UP` (or `YOU ARE READY`), teammates who are ready carry READY on the strip, and the feed says who ("GUEST-TWO is
  ready (1/2)", then "EVERYONE READY · next wave in 3").
- **The shop screen tells the truth** in co-op: "Break. Wave 6 in 12 s. The clock is running: 1/2 ready. L: ready up." It counts
  down live, and when the wave starts it says so and shuts itself, once a wave has been running under it for 0.75 s (`SHUT_AFTER`:
  a guest hears of the waves from the wave's own event and from snapshots, and the two may disagree for a moment). Single player
  still reads "when you leave", because there the run does wait.
- In co-op the solo shortcuts that ended a break for everyone are off: the Crucible shop's and Outpost Defense's L, and skipping
  the Commander's briefing (which now only shuts him up).

### Seats: dropping out and coming back

The host keeps, for every guest, under the lobby's **seat** (one per browser, the same through reloads and reconnects):

| Kept | From | Given back |
|---|---|---|
| The purse: credits, score, kills (and health and armour) | The guest's 4 Hz card, once that guest says its seat is settled (`ok`) | `restore` on arrival |
| The kit (`kit.ts`): every gun with its mods and rounds, the gun in hand, grenades, stims, implants and slots, brain chips and slots, call-ins held, the combo, headshots | `kit`, sent by the guest when it has changed, at most every 2 s (`KIT_MS`) | `restore { kit }`, put back through the game's own calls (`applyKit`) |
| Whether they left dead or down | The host's own life for them | `restore { dead }` |

- A guest's world coming up (its first card) always gets one `restore`, empty for a new player. Until it has applied it, the guest's
  cards do not say `ok` and its kit is not sent, so a fresh page's zeros can never overwrite what the host is keeping.
- **A rejoin is not a free revive.** Someone who left dead or down comes back dead and gets up at the team's next respawn. If the
  team respawned while they were away, they come back alive.
- The kit is cleaned on the host (`cleanKit`: known guns, mods, implants, chips and call-ins only, every number bounded) and again
  on the guest before it is applied.
- **Money owed follows the seat** (`team.payee`): a prisoner's bounty for a captor who reloaded goes to their new page; for one who
  is out, it waits in their purse.
- **A late joiner** (and every arrival) gets `sync { wave, phase, left, rest, custom, ready, need, back? }`: the banner the others had
  ("WAVE 4 · in progress · you joined late", or the break's "WAVE 4 CLEAR · wave 5 in 31 s"), the break's clock and the vote as
  they stand, and the custom-rules line. The break's pod reaches them through the shared world's own catch-up (`world/pods.ts`).

### Kill credit and rewards (`world/credit.ts`)

The host decides who did each piece of damage. A kill belongs to, in order: the guest whose claim is being applied; the player
whose delayed work is running (a chain blast queued by their hit: `Combat`'s queue notes `crediting` and runs under `creditAs`);
nobody, for a garrison ally's; the last player to hurt that enemy within 30 s (`LINGER_MS`) when only a bleed or a burn killed it
(a guest's burn or freeze by status claim counts as their touch); the host otherwise. The host's own hits are remembered as a
guest's are, so a guest's one hit minutes ago never takes the host's airstrike kill.

- Each player's own browser pays, scores and grants only what they did (`notMine`), as before.
- Rewards the host's world raises for a guest's doing are not paid on the host and go to that guest as `award`: a wound's bonus
  (`score`), an execution (`executed`: the guest's own browser scores it and grants Geneva), a BACK SHOT label (`label`).
- Every kill is announced on every screen as the game event `coop:kill { by, id, boss, head }`: the host's from its own
  `enemy:killed`, a guest's from the `kill` it already receives. Nothing new on the wire for the kill feed.

### Told to the team

- **Cheats:** a player's card carries `cheats`. The first card that says so puts "NAME has cheats on · unranked" in every feed and
  the lobby chat, and CHEATS on the strip and both boards. In the lobby, before a match, the list tags them too ("Cheats on ·
  unranked": `LobbyPlayer.cheats`, sent with the player's `set`; `CoopScreen` tells the lobby from `core/cheats.ts`).
- **Custom rules:** when the host plays the Crucible on its own saved rules every player gets "HOST'S CUSTOM RULES APPLY · unranked"
  as they arrive, and a boss wave's banner names the host's boss (`wave { titan }`), not what the guest's own saved rules say.
- **In a menu:** a player standing in the Esc menu, a shop or the loadout shows IN A MENU on the strip, SHOPPING during a break.
- **Pause menu:** the host's "End match (all to lobby)" asks first (a second press within 4 s). In a mission a guest has no
  checkpoint item; the host's reads "Checkpoint (whole team)" and takes everyone back with a line in every feed.

### Co-op HUD

- **Minimap:** each teammate is a round dot in the colour of their tag with a tick the way they face, held on the rim when off the
  map; a downed one pulses red; the dead are not drawn.
- **Kill feed** (left, mid-height, five lines, 4.5 s each): who killed what, in the killer's colour ("YOU" for your own). One
  player's kills of one kind within 2.5 s share a line ("HUSK ×3"); a headshot adds "· HEAD". A boss is also named in the main feed
  ("VIPER killed the Juggernaut").
- **Ping** (`marks.ts`, action `ping`: middle mouse or P, rebindable in Settings): a marker where the player is looking (300 m; a
  ping at nothing lands on the ground 40 m ahead), "PING · NAME" in their colour, on every screen and the minimap for 6 s. The
  pinger's own is instant; the host stamps whose it is and passes it on. Two markers a player at most, one every 350 ms.
  For a player whose saved keys already use the middle button or P, the ping takes only the one that is free (neither: it starts
  unbound, and they pick a key in Settings), so no saved map ends up with two actions on a key (`loadBindings`). In the dev
  panel P still pauses the Test Range: the panel's keys are off in co-op and the ping does nothing alone.

### Proofs (`tools/scripts/coop-team-*.mjs`, helpers in `coop-team-kit.mjs`)

Unit: `src/net/team.test.ts` (31 tests, two to four players over the mocked transport).

| Script | What it asserts on every page |
|---|---|
| `coop-team-endings.mjs` | `TEAM_CASE=wipe`: the board, no solo screen, the host's clock and the guests' snapshots still running under it, Start again, a guest's own Back to lobby, the host's Enter. `humans`: wave 10 by the dev hooks, a guest kills the Commander, CONTRACT FULFILLED, the kill is the guest's. `mission`: a guest's pause menu has no checkpoint item, End match asks first, MISSION COMPLETE, the board's own clock takes everyone back |
| `coop-team-break.mjs` | The dead player is up at wave clear; 45 s on every page; the HUD chip; the shop's clock running; one vote does not cut the break; a dead player's key is not a vote; the last living player votes from the shop and the break drops to 3 s; the shop shuts itself; the vote is cleared |
| `coop-team-rejoin.mjs` | A guest's page dies and the same browser comes back: fifteen parts of the kit and purse are equal before and after; the seat is the same under a new connection; after bleeding out the rejoin is dead on both sides and gets up at wave clear |
| `coop-team-ui.mjs` | Ping (instant, same spot, name and colour, gone after 6 s); the kill feed's line on every page; three guest kills pay the guest and not the host; a boss kill named in every feed; IN A MENU and CHEATS on the strip and the Tab board |

| `coop-team-solo.mjs` | One page, no lobby: the solo break is still 25 s with "L: START NOW", the shop still says "when you leave" and the run is paused under it, L alone still calls the next wave in, and there is no co-op HUD |

`TEAM_PLAYERS=2|3|4`, `TEAM_NET=bad` (the simulator at `lag:120,jitter:40,loss:0.05`), `COOP_NET=rtc` for real WebRTC. One run
at a time (the machine is shared); each writes its evidence JSON and screenshots beside `--out`.

Runs on 2026-11-18, all on a heavily loaded machine (pages at 2 to 15 frames a second), every check passing:

| Proof | Players | Network | Transport | Checks |
|---|---|---|---|---:|
| endings, wipe (with Start again) | 2 | clean | loopback | 32 |
| endings, wipe | 4 | lag 120, jitter 40, loss 5% | loopback | 60 |
| endings, Endless Humans won | 2 | lag 120, jitter 40, loss 5% | loopback | 18 |
| endings, mission won (and the pause menu) | 2 | lag 120, jitter 40, loss 5% | loopback | 20 |
| break and vote | 3 | clean, then lag 120, jitter 40, loss 5% | loopback | 27, 27 |
| break and vote | 4 | clean | loopback | 30 |
| rejoin with the kit | 2 | lag 120, jitter 40, loss 5% | loopback | 25 |
| rejoin with the kit | 2 | clean | real WebRTC | 25 |
| ping, kill feed, credit, strip | 3 | clean, then lag 120, jitter 40, loss 5% | loopback | 19, 19 |
| ping, kill feed, credit, strip | 2 | clean | real WebRTC | 17 |
| single player untouched | 1 | | | 6 |

The three endings also passed over real WebRTC with two players before the session lane's deploy gate landed (32, 18 and 16
checks); they have not been run on WebRTC since.

### Not done

- (Fixed, 2026-11-19.) Outpost Defense on a rejoin: a guest's loadout screen now waits for the host's word on the seat
  (`team.seated`), and a player who came back with a kit is not asked at all (`Defense.resumed`): the restored kit wins.
- **A lost player's body:** while a connection is down the host still shows nothing of that player, and whether enemies should
  keep hunting the spot is the targeting module's (not checked here).
- **The kill feed for a garrison ally's kill** shows nothing (it is nobody's kill); a line for it would be easy to add.
- **Three- and four-player runs over real WebRTC**, and any run on an idle machine: every timing above was taken under load.
- **Perks and a call-in seat lost on going down** stay lost (lead's decision D4); **waves and pay do not scale** with players (P4).

## Claims: what the host does with a guest's damage

Rule: **favour the shooter.** This is a game among friends. An honest player never loses a hit, on any weapon, with any perk, mod
or implant, on a bad connection; the checks only stop the absurd. Code: `src/net/authority.ts` (`ClaimValidator`),
`src/net/world/claims.ts`. Tests: `authority.test.ts`, `claims.matrix.test.ts` (604 weapon/mod/perk cases on three kinds of link, 1.2
million claims, none refused or cut), `world.test.ts`; browser proof `tools/scripts/coop-claims-matrix.mjs`.

**The three claims** (guest to host, reliable lane):

| Event | Fields | Host applies |
|---|---|---|
| `hit` | `shot`, `at`, `target` (enemy uid), `weapon` (in hand, not relied on), `origin` (the shooter's eye), `damage` (the whole `DamageInfo`), `hop?` | `applyDamage` as that guest, after `bossHit` |
| `status` | `uid`, `kind` (`burn`, `freeze`, `bolt`), `s` seconds, `at` | `EnemyManager.afflict`: the same write the weapon makes alone |
| `vhit` | `id` (the vehicle, as the `vehicles` event numbers it), `part`, `point` (in the vehicle's own frame), `amount`, `source`, `kind?` (a rocket or shell landing on it); or with `radius`: a blast at world `point`, `inst?` an instakill | `VehicleSystem.claimed` (as `shot` / `direct`, no host hit marker), or `blast` |

- **Shot id and clock.** `shot` is the shooter's own count of shots, swings and bursts (it moves on every `weapon:fired`, and on a
  claim made more than 100 ms after it last moved: a stake landing, a beam still on). `at` is the shooter's `performance.now()`.
  No claim ever sends a made-up `fire`. `ctx.coop.world.shot` (guest) and `.applying` / `.applyingShot` (host, during the apply) are
  how other code reads them.
- **`hop`.** Set by the guest when a gun's round did not come straight from the eye: its direction is more than 12 degrees off the
  eye line (a ricochet, a hop off a body, an arc, a fragment) or the guest's own world has a wall on that line (a round that
  passes walls). The host then has no straight line to test.

**What made the damage decides the check** (`claimClass`, by `damage.source` and `type`):

| Class | Sources | Rate | Sight | Needs the shooter up |
|---|---|---|---|---|
| gun | a weapon id, not explosive | shots, per gun | a straight shot only, see below | yes |
| melee | a melee weapon id, `sword…` | swings, per weapon | none | yes |
| blast | anything `explosive` not below | 400 hits/s, 800 at once | none | no |
| callin | `airstrike`, `warthog`, `chopper…`, `door_gun`, `gunship…`, `orbital`, `ac130…`, `black_sun`, `nuke`, `sentry`, `drop_pod`, `frame…`, `mech`, `harrow_…`, `attack…` | 600 / 1200 | none | no |
| perk | `chain…`, `skyfall`, `frost`, `rigged`, `deadman` | 200 / 400 | none | no |
| mounted | `emplacement` | 200 / 400 | straight shot, from the claim's origin | yes |
| body | `slam`, `sword_deflect`, `gib` | 100 / 200 | none | yes |
| world | `mortar`, `mine`, `tripwire`, `claymore`, `barrel` | 200 / 400 | none | no |
| other | anything else: never refused for being unknown | 200 / 400 | straight shot | no |

- **Rate.** A hit belongs to a shot; once a shot is in, all its hits are (up to `max(256, pellets x 64)`, far more than a shot lands).
  Shots are counted per guest and gun in a token bucket that fills on the **shooter's** clock, so bunching from lag, a resend or a
  host hitch costs nothing. The bucket fills at `RATE_ROOM` (8) times the gun's fastest cadence and holds 1.5 s of that (12 at
  least). The fastest cadence comes from the weapon table (`limitsOf`): the shortest interval over the bare row, each mod and all
  mods together, the smart aim's and the Judge fan's gap, halved for a gun that takes akimbo and never slower than Gun Kata's
  85 ms; a melee swing over the energy blade's speed. 8 covers every fire-rate perk at once (capped at 2 with implants, 7.2 with
  implants off). The shooter's clock may lag as it likes but not run more than 4 s ahead of where it stood when first heard; a
  reloaded page's new clock is followed. `kata` and `fire.ak` are no longer needed by the check.
- **Amount: cut, never dropped.** Cap: a gun's round times 64 (2000 at least); 20000 for the other classes; 4000 mounted. A claim
  over it is cut to it. Kept whole as kills: a gun whose row is an instakill (the autocannon's shell, direct or splash), a Hellfire
  rocket's blast, and, with a call-in announced in the last 10 minutes, the airstrike's finale, Black Sun, the **AC-130's bomb**
  and the nuke. `bossHit` then turns 9999 or more on a boss into 900, for host and guest alike.
- **Where.** The claim's eye within `7 + 26 x (0.35 + ping)` m of the host's copy of the shooter (16 m at no ping, 24 m at
  300 ms: a 26 m/s dash; 80 m for a mounted gun; not checked for blasts, call-ins, perks). Range from the eye: 850 m for guns
  (Combat's own is 800), 60 melee, anywhere for call-ins and perks. The hit point within `10 + the enemy's height + its speed x
  the delay` of the enemy on the host, **or** of the upright body over its root (what a guest draws),  **or** of anywhere its centre or root has been in the last 6 s (the host notes them every 100 ms: a man
  the last shot threw across the room is still where he stood on the shooter's screen, seconds longer on a bad link), **or** the enemy that near the line from the
  eye to the point (the Lance beam names its far end, up to 400 m out). **Not checked while the enemy is down on the host:** a
  knocked-down man is each screen's own ragdoll, fallen its own way, and the two lie metres apart by design.
- **Sight.** Tested only for a straight shot (no `hop`) from a gun whose row does not pass walls on its own, without an AP or
  API load, not a flame, from more than 6 m. From the claim's eye to the hit point, the last metre not looked at; failing that
  from the host's copy of the eye, and to the enemy's centre and head as the host has it. If all fail, the hit still passes on an
  allowance (8 at once, one more a second: corners, cover, worlds that differ); past that it is refused.
- **Down.** A downed or dead shooter's gun, blade, body and mounted gun are refused; what was already in the air (a grenade, a
  rocket) and what stands by itself (a sentry, an aircraft, burning ground) still counts.
- **Never counted as lost:** a claim on an enemy the host had already killed (`refused.gone`).
- **Counters** for proofs: `world.stats.accepted / rejected`, `world.validator.refused` (by reason: `shape`, `down`, `eye`, `range`,
  `point`, `rate`, `hits`, `flood`, `sight`, `gone`), `validator.clamped`, `validator.doubted`, and on a guest `world.claims.sent`.

**Status effects.** Fire, frost and the exploding bolt's panic go through `ctx.enemies.afflict(enemy, kind, seconds)` from the
Kiln's stream and napalm, the Lance beam, the AC-130's white phosphorus, the orbital beam, Frost Nova and the stuck bolt. Alone and
on the host it is the write the weapon used to make. On a guest it also sends `status` (one that is renewed every frame goes out
four times a second and once more when it stops); the host caps it at 30 s of fire, 20 s of frost, 12 s of bolt. Stagger, flinch
and knockdown need no claim: the host's damage model works them out from each `hit`. A guest's copy shows burning and frost from
the snapshot's flags.

**Vehicles.** On a guest each drawn truck, humvee and tank has the real one's boxes in the physics world, so a guest's round
stops on the hull, sparks there, and a vehicle is cover and solid, as on the host. The hit names the part and the point in the
vehicle's own frame, so a hit on the hatch on the shooter's screen is a hit on the hatch. The host's enemy helicopter is not drawn
on guests and has no boxes; a guest's blast still reaches it.

## How it works

- **trystero 0.27.0, pinned**, with its default strategy, Nostr: peers meet through public Nostr relays, then talk browser to browser
  over WebRTC. `appId` is `overpowered-2-coop`, the room id is the code, and `identity: 'none'` stores nothing and makes each tab its own
  player. trystero's own `maxUsers` is 12, so the lobby's check is the only cap of four. **Relays:** 12 of trystero's 30 public relays (`RELAY_REDUNDANCY`); trystero picks the same 12 for everyone from
  the app id, so all players share them, and one answering is enough. If none answers, the lobby stops with a plain "could not reach any of
  the matchmaking relays" instead of waiting.
- **Code and password.** The host picks the password, and the game picks a 6 character code (no 0, O, 1, I or L). The password is
  trystero's room `password`: it encrypts the handshake, so the relays only ever carry hashed topics and encrypted offers.
  Passwords stay in the handshake and tab-local storage; they never enter the game messages or invite URL.
- **Invite link:** `<page>?join=CODE`. The splash click goes straight to the join page with the code filled in.
- **Host-authoritative.** The host keeps the player list and sends it to each guest, with that guest's own id. Guests only send to the
  host. Names are 16 characters and chat lines are 160, with control characters stripped.
- **Build check.** Every peer says `hello` with `BUILD` on connect. A guest that meets a host on another build stops with "your friend
  has a different version (theirs X, yours Y), both reload".
- **Wrong password:** told on both ends, through the **door** room when trystero only tells the host (stage 0 notes below).
- **Ping and heartbeat.** The host pings every guest every 2 s; the round trip shows in the lobby, on the teammates strip and on the Tab
  board. A peer silent for 20 s is gone even if WebRTC has not noticed (a closed lid, dropped Wi-Fi): the host drops the guest, a guest
  stops with "Lost the connection to the host".
- **Start.** The host's Start counts down 5 s for everyone (`countdown`); Start again cancels. It waits for every guest to be ready, and a
  guest going unready or a new guest stops the count (`holdCount`). The match handoff takes each player's own starter pick (`Lobby.starter`),
  so a pick made as the count ran out is the gun they get even if the host's list had not caught up. `forceStart` skips the ready
  check (a lobby line names who was not ready) and goes through the same `startMatch`. The host's mode pick rides on the lobby list
  (`pick`), so a guest's untouched starter shows the gun `startMatch` will give it.
- **Sonar is shared.** A player's `sonar:ping` goes out as `{ t: 'sonar', at }` (the host relays a guest's to the others); every other
  player runs the same ring and reveal from that point (`Sonar.share`, their own cooldown untouched) with "<callsign> used sonar" in the
  feed. Thermal is never sent. Focus slows the world for everyone (below, "Time: the team's slow motion").
- **Joining, in stages.** A guest's status line reads Contacting lobby servers… (no Nostr relay socket open yet), Looking for lobby…,
  Connecting to host… (an offer or answer came back: WebRTC/ICE under way), Checking version…, then Connected. No relay in 10 s stops
  with 'relays'; at 30 s the stage that stalled names the error ('connect' when a host was found but never connected, else 'no-host').
  Every peer connection logs `[coop] Peer connection connected|failed. Our candidates: host n, srflx n, prflx n, relay n. Theirs: ...`
  to the console: no srflx means STUN failed; srflx on both sides and still failed means a NAT only TURN gets through. The host's line
  shows "Waiting for players…", "n trying to connect" and "n not ready", and a lobby line "A player failed to connect (network)".
- **Relays and STUN (checked 2026-11-16).** trystero 0.27 picks 8 of its 30 public Nostr relays from the app id; 7 of ours answered,
  `nostr.chaima.info` returns 404. One dead relay blocks nothing: every peer announces and listens on all 8, and any one shared relay
  that works is enough. STUN is trystero's default, three Google servers and Cloudflare's: two independent providers, enough, since
  more STUN servers do not get through a NAT that STUN cannot; that needs TURN.
- **Callsign** is stored in `localStorage` under `op2_coop_name`. The first default is a random `VIPER-27`.

## Transport: two lanes, loopback, the network simulator, metrics

Built in the overhaul's stage 0a. Everything the game sends goes through `NetRoom` (`src/net/room.ts`). Two transports sit behind
it, and both are a thin `Wire` under one shared class, `LaneRoom` (`src/net/lanes.ts`), so lanes, the simulator and the counters
behave the same on both.

### Two kinds of lane

`room.channel(name, options)`, or in a match `lobby.gameplay(name, receive, options)`:

| | Reliable (default) | Unreliable (`{ unreliable: true }`) |
|---|---|---|
| Arrives | Always, in order | Once or never, in any order |
| A lost packet | Is sent again; everything behind it to that peer waits | Is gone; nothing waits |
| For | Facts: events, the lobby, chat | Latest-wins data that is sent again anyway: poses, snapshots |
| Carries | Objects (as JSON) or bytes | Bytes only (`ArrayBuffer`/`Uint8Array`), to one peer at a time |

- **Fallback, silent:** an unreliable channel uses the reliable path of the same name whenever the fast path to that peer is not up,
  the message is not bytes, or it is over 16,000 bytes. The receiver's handler hears it either way, so a broken fast path leaves co-op
  exactly as it was before the lane existed. `room.fast(peerId)` says which path is live.
- **Safe size: 1,100 bytes** (`UNRELIABLE_SAFE_BYTES`). One message then fits one packet. WebRTC cuts a larger message into packets
  of about 1,200 bytes, and with no resend one lost packet loses the whole message, so a 2-packet message is lost about twice as
  often. A snapshot of 48 enemies is 2,172 bytes today: the enemy lane should send it in chunks under the safe size.
- **Backpressure:** `room.buffered(peerId, unreliable)` is the bytes handed over that the network has not taken yet
  (`RTCDataChannel.bufferedAmount`, plus the simulator's slow link). Over 8,192 (`BEHIND_BYTES`) the peer is behind:
  `lobby.behind(playerId)` says so, and a channel opened with `{ latest: true }` skips that peer by itself and counts the skip.
- **On the wire**, an unreliable message is one frame: `[name length u8][lane name, ASCII][sequence u16 LE][payload]`, 7 bytes over
  the payload for `pose`. The sequence number is per lane and peer and exists for the loss count.
- **Today:** only the 20 Hz player poses are on the unreliable lane (`{ unreliable: true, latest: true }`). Enemy snapshots (`world`)
  and events (`action`) are reliable still; the enemy lane moves snapshots.

**Real WebRTC** (`src/net/fast.ts`, `trystero.ts`): trystero 0.27 has one reliable, ordered data channel per peer and no option for
another. Once a peer connection is connected, both ends open a second channel on it with the same number (`negotiated`, id 100,
label `op2-fast`, `ordered: false, maxRetransmits: 0`). It is made only after the connection is up, because a channel made earlier
makes trystero's answering side start an offer of its own. A link counts as up only after this end has heard the far end on it (each
end sends a 2-byte probe four times a second until then, at most 10 s); until then, and after the channel closes, sends fall back.

### Loopback: co-op with no network (`?net=loop`)

`src/net/loopback.ts`. Pages of one browser profile talk through a `BroadcastChannel`: no WebRTC, no Nostr relays, a lobby in under
a second, and runs that never meet each other. The real Lobby and game run on top, with the same codes and passwords, joins and leaves,
four players, both lane kinds. It is a test transport.

- **On only when both are true:** `?net=loop` is in the address, and the page is a dev build or served from this computer
  (localhost). The public site ignores the word, so no link can put a player on a transport that reaches nobody. The console says
  `[coop] LOOPBACK transport` when it is on. The invite link of a loopback lobby carries `&net=loop`, and the match page keeps it.
- **By hand:** open `http://127.0.0.1:<port>/?net=loop` in two **windows** of the same browser (not two tabs of one window: a tab
  in the background stops drawing). Host in one, open the invite link in the other. The one-tab rule is off for these pages, and each
  tab is its own player to the host (the browser id is kept per tab).
- What it copies from the real transport: a peer id per page, objects as JSON and bytes as `Uint8Array`, a wrong password told only
  to the peer already in the room (the guest hears through the door), a fifth player refused, and a page that closes or reloads
  leaving at once (a Web Lock the others wait on). It never loses or delays anything by itself: that is the simulator's job.

### The network simulator (`?netsim=`)

`src/net/netsim.ts`. It is inside the game, so it works in a normal browser on localhost and on both transports. Each page delays
or drops **what it sends**; to feel 80 ms each way, set it on both pages.

```
http://127.0.0.1:5173/?netsim=lag:80,jitter:30,loss:0.03        read as the page loads; kept from the lobby into the match
window.__op2.net.sim.set('lag:150,loss:0.1')                    while playing, in the console (merges with what is set)
window.__op2.net.sim.set('off')                                 back to normal
```

| Word | Meaning |
|---|---|
| `lag` | ms added to every message this page sends |
| `jitter` | up to this many more ms, at random per message |
| `loss` | share of packets lost, 0 to 1 (a number over 1 is read as a percentage) |
| `stall` | ms a reliable lane takes to resend a lost packet (default 300) |
| `kbps` | this page's upload speed to each peer; what does not fit queues, and the peer reads as behind |

The two lane kinds suffer differently, as for real. On a **reliable** lane nothing is lost or reordered: a lost packet costs `stall`
more ms and every later reliable message to that peer waits behind it. On an **unreliable** lane a lost message is really gone, and
jitter lets a later one overtake an earlier one. Off unless asked for; a friend joining by the invite link is not affected by the
host's setting. A guest adds `&netsim=...` to their own link.

### Metrics (`window.__op2.net`)

`src/net/metrics.ts` counts, per lane and per peer, bytes and packets both ways, the gap between arrivals, loss and late packets on
unreliable lanes, and the round trip to each peer once a second on both paths (lanes `net` and `netu`, 9 bytes each).
`window.__op2.net.snapshot()` returns it all as plain JSON, with the simulator's settings, which peers have the fast path up, what is
queued for each, and co-op's own frame cost (`CoopSession.cpuMs`, which is unchanged). `window.__op2.net.metrics.reset()` starts a
measuring window. Object messages are sized by their JSON text, near enough to the wire.

Later lanes can feed their own numbers, all allocation-free once a name exists:

```ts
import { metrics } from './metrics';
metrics.gap('snapshot');                 // time since the last call with this name
metrics.sample('snapshot.enemies', 31);  // any value
metrics.start('shot', id); /* ... */ metrics.stop('shot', id);   // a named timer, e.g. shot to the host's answer
```

Each shows up under `series` in the snapshot as `{ n, mean, p50, p90, p99, max, last }`.

## Testing

Unit tests: `src/net/lanes.test.ts`, `fast.test.ts` (the fallback), `loopback.test.ts` (the real Lobby over it), `netsim.test.ts`,
`metrics.test.ts`, beside the older ones.

### Every proof, one command (`tools/scripts/coop-all.mjs`)

The regression suite for co-op. It knows every browser proof with its parameters (players, mode, map, transport, network), runs
them through `tools/shot.mjs` (so the machine's browser slots are honoured), one at a time unless `--jobs 2`, each under its own
time limit, and writes one table. **Run this, not the proofs one by one, after any change to co-op.**

```sh
node tools/scripts/coop-all.mjs --port <your port> --list                      # what it would run
node tools/scripts/coop-all.mjs --port <your port>                             # every proof, loopback, clean network
node tools/scripts/coop-all.mjs --port <your port> --suite clean,bad --jobs 2  # and under lag:120,jitter:40,loss:0.05
node tools/scripts/coop-all.mjs --port <your port> --suite rtc                 # each lane's main proof over real WebRTC
node tools/scripts/coop-all.mjs --port <your port> --lane team,session         # some lanes;  --only <text or /regex/>  some runs
```

- **Suites:** `clean` (every proof, loopback), `bad` (the same under `lag:120,jitter:40,loss:0.05`, for proofs that take a
  network), `rtc` (each lane's main proof over real WebRTC and the public relays: never two at once, 45 s apart), `four` (each
  lane's main proof with four pages), `guest` (every mode from a guest's seat, `coop-guest-seat.mjs`, with pictures at 1440x900
  dpr 2), `all`.
- **The server:** it starts its own Vite on `--port` (HMR off) and stops it at the end, so it never serves modules from before
  an edit or a rebase. Never port 5173.
- **Results:** `results.json` and `results.md` in `--out` (default `tools/out/coop/all/`): proof, players, mode, transport,
  network, pass or FAIL, checks passed / failed, seconds, the commit, the first failing check, and the run's folder. Each run's
  folder holds the proof's own evidence JSON and screenshots, `report.json` (shot.mjs's), `log.txt` and `cost.json`
  (`tools/proof-cost.mjs`: wall time, the wait for a slot, CPU, peak memory, the machine's load).
- **Resumable:** a run that passed on the same game (the tree of `src/` at HEAD plus uncommitted changes to it) with the same
  proof text is skipped, so stop it and start it again at will. `--force` runs everything again; `--any-commit` accepts an old
  pass. A commit that touches only docs or tools does not make the game new.
- **Retries:** a failed run is run once more only when it failed for a harness reason: it hit its time limit, a page was
  starved, the browser died, the machine's load was over 1.5 times `--max-load` (default 16: it also waits for the load to be
  under that before each run), or on `rtc` the lobby or the match never formed (the relays). A run that passes the second
  time reads `pass (2nd try)` with the first try's reason. `--retry all` retries any failure once; `--retry none` none.
- **Starved or broken:** the kit samples every page's loop rate every 3 s while it plays into `out.frames` (`{ n, mean, min,
  low }` per page, `low` = samples under 20 a second). A failed proof with a page under 20 in over 40% of its samples was
  starved. Proofs that slow, stall or hide a page on purpose are marked `slow` in the list and are not judged by it.
- **Adding a proof:** one line in `PROOFS` at the top of the file (`sim` and `count` name the environment variables the proof
  reads for the network and the player count; `rtc: true` / `four: true` put it in those suites). `tools/lib/coop-all.test.ts`
  checks that every listed script exists and that ids are unique.
- **A match that is already running** is joined with the kit's `lateGuest(party, name)` (then `inMatch([page], contract)`): a
  kit page like the others. World-a's and world-b's own copies of it are gone (their late joiners used to be the one page of a
  proof with the real pointer lock, drawing every frame).
- `COOP_SIM=lag:120,jitter:40,loss:0.05` is now the network of any kit proof that names none itself.

Browser proofs run through `tools/shot.mjs` with the kit, `tools/scripts/coop-kit.mjs` (its header lists every helper). Your own Vite
with HMR off, never port 5173:

```sh
OP2_NO_HMR=1 npx vite --port <port> --strictPort
node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 300 --script tools/scripts/coop-smoke.mjs --out tools/out/coop/<you>/smoke.png
```

```js
import { kit, live, measure, startParty, shootLoop, setNet } from './coop-kit.mjs';
export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'mine', out, sleep);
  const party = await startParty(host, { transport: 'loop', players: 2, mode: 'crucible', net: 'lag:80,jitter:30,loss:0.03', out, progress, sleep });
  await live(party, { enemies: 6 });          // a running wave on every screen
  await shootLoop(party.guest);               // a scripted guest shooting
  const numbers = await measure(party, 10);   // { host, guests: [...] } with lanes, gaps, round trips, fps
  check(numbers.guests[0].lanes.world.in.packets > 0, 'the guest gets snapshots');
}
```

- `startParty(host, { transport: 'loop' | 'rtc', players: 2..4, mode, map, net, fps })`. Modes: `crucible`, `outpost` (Endless
  Humans), `defense`, `campaign`, `foreclosure`, and `map: 'office'` for the first two. `startPair` is two players. `openGuest(party,
  { late: true })` joins or rejoins a running match.
- **Loopback is the default** (`COOP_NET=rtc` or `transport: 'rtc'` for real WebRTC over the public relays). Each loopback page is
  its own window of one profile; a second tab of one window would stop drawing.
- `live(party)` gets to a fight fast: skips the first break in the survival modes, presses Deploy in Outpost Defense, and in the
  missions puts husks in front of the host instead of waiting out the briefing (`natural: true` waits for the mission's own).
- `give`, `spawn`, `dummy`, `calm`, `teleport`, `aimAt`, `fireAt`, `shootLoop`/`stopShooting`, `state`, `netStats`, `resetNet`,
  `setNet`, `measure`, `rtcChannels`. Fire through `fireAt`/`shootLoop`, not the mouse: under pointer lock a mouse press in a
  loopback page's window also turns the view.
- **Frame rate:** no cap by default (60 a page). `fps: 15` or `COOP_FPS=15` for a proof about a slow host; the old kit always capped
  at 15 for the 8 GB Mac. `COOP_FPS=30` halves what a page's simulation costs (about 0.15 of a core per page in a fight) and
  is safe for a proof with no bound that depends on the frame rate; it is not the default because three proofs loosen or skip a
  check below 40 frames a second (`coop-time-solo`, `coop-time-team`, `coop-attacks-humans`).
- **Fast mode, on by default:** every page of a kit proof simulates every frame as a visible, focused page, but **draws no
  frame until a picture is asked for** (`draw: 0`) and **keeps its Web Audio suspended** (`audio: false`). Drawing was most of
  a page's main thread and its only dependence on a GPU that every run shares; the audio thread alone was 0.8 of a core per
  page. Nothing else changes: the loop runs on animation frames at 60, the window keeps the size you asked for, sounds are still
  asked for. Every screenshot (`page.screenshot`, the kit's `shot`, shot.mjs's `shot`) draws fresh frames first, so pictures are
  as before. A frame rate the kit reports (`measure`, `netStats`) is the loop's: frames simulated a second, drawn or not;
  `measure(party, s, { draw: 'all' })` draws every frame for one window. **Opt out:** `look: true` in
  `startParty` (or `draw: 'all'`, `audio: true` singly), or `COOP_LOOK=1` on the command line (`COOP_DRAW=all|<n>`,
  `COOP_AUDIO=1`), for look-checks, videos, and anything about smoothness, the cost of drawing, or sound really playing.
  `setDraw(pages, 'all' | n)` changes the rate mid-run; `fresh(page)` draws now. A kit of your own that opens pages itself
  passes `party.draw` and `party.audio` to the kit's `prepare(page, { fps, out, tag, draw, audio })`; pages it opens any other
  way are today's pages. Details and numbers: "What a proof costs" below.
- **A pretend pointer lock, on every kit page, in look mode too** (`fakeLock` in the kit; `realLock: true` or
  `COOP_REAL_LOCK=1` takes the browser's own). Headless Chromium's real pointer lock runs away in a window opened by a page,
  which every loopback guest is: 9,000 to 34,000 raw pointer updates a second with nobody touching the mouse, the browser
  process at 1.2 cores and growing to gigabytes, the guest's own process at twice the host's, and a mouse move every frame
  that turned the guest's view. **This was the guest page at 0 to 1 frame a second, and most of what a long proof cost.** The
  page now gets what a granted lock looks like (`document.pointerLockElement`, `pointerlockchange`, `exitPointerLock`, Esc
  ending it with the keydown swallowed, as Chrome does) and nothing is locked. A proof's own mouse moves arrive as before.
- **A dead line:** `page.evaluate(() => window.__op2.net.sim.cut(true))` drops everything that page sends and everything that
  arrives, reliable lanes included, and tells neither end, while both pages keep running; `cut(false)` brings the line back and
  what was said meanwhile is gone for good. It is how a proof makes a guest act behind a dropped connection on either transport
  (the host gives the seat up after `SILENCE_MS` = 20 s). Not a simulator setting: it is never carried to the next page.
- **What a run costs:** `node tools/proof-cost.mjs -- node tools/shot.mjs ...` runs any proof and prints its wall time, the wait for
  a slot, peak Chrome memory by process type and CPU seconds. `tools/scripts/page-cost.mjs` under it measures one page (boot stages,
  frame cost, memory split).
- **Slots:** `tools/shot.mjs` runs 3 at once on the machine, first come first served, and starts no run while less than 20 GB of
  memory is available (`OP2_SHOT_SLOTS`, `OP2_SHOT_FREE_GB`).
- **Headless GPU:** on Linux `tools/shot.mjs` asks ANGLE for the machine's OpenGL driver (`--use-angle=gl-egl`). Without it headless
  Chromium renders in software: measured 1 frame a second per page at 1440x900 dpr 2 in a two-page match, against 60 on the RTX
  4090. `OP2_ANGLE=vulkan|swiftshader` picks another back end (Vulkan also reaches the card but lost its WebGL context in one run of
  three). macOS keeps `--use-angle=metal` exactly as before.
- The evidence JSON of a kit proof has `console`: each page's warnings, errors, `[coop]` lines and every address it loaded.
- Proofs that passed on loopback with this kit: `coop-smoke.mjs` in all seven mode and map choices and with 4 players, `coop-stage3.mjs`
  (12 checks, also on real WebRTC), `coop-robust.mjs` (7), `coop-modes.mjs` (humans, defense, office), `coop-mission.mjs`,
  `coop-drops.mjs`, `coop-baseline.mjs`.

### Property tests (fast-check)

`fast-check` (dev-only) states a rule once and tries it on thousands of random cases, then shrinks a failure to the smallest
one. In place today: `src/net/pose.property.test.ts` (pose codec and buffer) and `src/net/world/wire.property.test.ts` (event
router, `validVec`, `packDamage`). **Not yet covered, on purpose:** `world/snapshot.ts`, `replicas.ts`, `hits.ts`, `claims.ts`
were being rewritten when these were written. Whoever finishes them, or the verification pass, adds theirs like this:

```ts
import fc from 'fast-check';
// 1. An arbitrary that builds only values the wire accepts (ranges from the codec's own limits). `enemy` is one more record.
const frame = fc.record({ seq: fc.integer({ min: 0, max: 0xffffffff }), wave: fc.integer({ min: 0, max: 65535 }), enemies: fc.array(enemy, { maxLength: 48 }) });
// 2. The rule, in a normal vitest `it`. `encode`, `decode` and `quantized` stand for your codec and its rounding.
it('decode(encode(frame)) is the frame, to the precision the wire keeps', () => {
  fc.assert(fc.property(frame, f => { expect(decode(encode(f))).toEqual(quantized(f)); }));
});
```

Rules worth stating for this protocol: a round trip equals the input at the wire's precision (write the rounding down as a
function, as the pose test does with `Math.fround`); junk, truncated and damaged bytes never throw and are either refused or a
valid value (`fc.uint8Array`, or overwrite random bytes of a valid packet); applying a delta to the old state gives the new
state; packets delivered twice or out of order leave the same state as once in order (generate an order with
`fc.array(fc.integer(...))`, keep a small model of what should be accepted, compare); a rate bucket never goes negative; a
clamp never raises a value. Keep each file under a few hundred milliseconds (the default 100 cases a rule is enough; raise
`numRuns` only for a rule that has failed before). A failure prints a seed and the shrunk case: paste the case into an
ordinary test so it stays fixed.

### What a proof costs, and fast mode (lane "proof-speed", 2026-11-18)

Measured with `tools/proof-cost.mjs` (every process under a run, once a second, from `/proc`) and `tools/scripts/page-cost.mjs`
(one page: boot stages, frame cost, Chrome's own memory account). The machine was busy throughout (1-minute load 44 to 75 on 32
cores, other agents' proofs), so times are loose and memory and CPU seconds are firm.

**Memory: 1.6 GB for Chrome with one game page, and nothing a proof can turn off changes it.**

| | MB |
|---|---:|
| Chrome with an empty page (browser 42, GPU process 71, utility 24, two small renderers 51, zygote 14) | 203 |
| Chrome with one game page in a Crucible fight | 1,530 to 1,680 |
| ... of which the page's own process | 1,155 to 1,260 |
| ... the GPU process | 190 to 250 |
| ... utility (network, audio, storage), browser, zygote | 95 + 85 + 14 |
| A two-page proof at its peak | 3,000 to 3,400 |

- The page's own process, by kind of memory: 456 MB in V8's cage, of which **JavaScript objects are only 35 to 58 MB** and
  **ArrayBuffers 400 to 409 MB** (typed arrays kept on the CPU side: geometry, the baked light, the nav mesh, the character
  models, the physics engine's wasm memory); **530 MB in Chrome's own allocator** (not split further: decoded images, WebGL's
  client-side state and copies); 23 MB of code. `performance.memory.usedJSHeapSize` reads 374 to 481 MB because it counts the
  ArrayBuffers. A forced collection frees nothing (39 to 35 MB).
- It does not depend on the window: 1,602 MB at 1440x900 dpr 2 against 1,547 MB at 640x360 dpr 1. The kit's pages run at
  quality Low, which caps the canvas (854x480 in a 1280x720 window, 960x600 at 1440x900 dpr 2), so a small window saves nothing.
- It does not depend on the server (dev 1,606, production build 1,559), on drawing (1,633 with no frame drawn), or on audio
  (1,645 with no sound file decoded).
- Pages grow in long runs: other agents' three and four minute runs had single pages at 2.4 to 4.3 GB (RSS).

**Boot: 8 s of one core on a quiet machine, 15 to 25 s under load, and a two-page proof boots four times** (each page loads the
game for the lobby, then again for the match). Stages of one boot on the production build, ms from the page's start: engine 100,
materials 400 to 1,600, audio 300, armoury 200, systems 1,300, the map 2,800 (of which the nav mesh 1,900), the light bake 1,000
(a worker), characters and gore warm-up 1,000. No one stage dominates and none is waiting on the network: it is the game's
own work, so only a cache inside the game could shorten it (not built). In `coop-smoke` the boots are 64 to 76 s of the run.

**A frame: drawing is most of the main thread, and the audio thread is a second core.**

| Per game page, steady fight | Cost |
|---|---:|
| Main thread, a frame with drawing (`stats().cpuMs`) | 13.6 ms at 640x360, 19 to 22 ms at 854x480 and 960x600 |
| Main thread, a frame with the scene matrices brought up to date and nothing drawn | 7 ms (busy machine) |
| Main thread, a frame with no drawing at all | 2.5 to 6 ms |
| The page's Web Audio thread (`AudioOutputDevice`) | 0.8 of a core, all the time, drawing or not |
| The run's GPU process, every frame drawn / none | 0.5 to 0.7 / 0.04 to 0.28 of a core |

- In one whole two-page run the audio threads took 92 CPU seconds, the pages' main threads 79 (four boots and the fight), Chrome's
  thread pool 25, the bake workers 19, the GPU process 24. **The audio thread was the largest single cost of a proof.** It is the
  game's live audio graph mixing for nobody; it may be worth a look for real players too (not investigated).
- Drawing ties a page to the GPU, which every run on the machine shares. In one probe, with other runs busy, a guest page drawing
  4 frames a second got 0 to 9 animation frames a second and, drawing every frame, 0 to 58; the same page seconds later drawing
  nothing held 43 to 60. That is the "guest at 1 frame a second" other lanes reported. A page that sends nothing to the GPU
  cannot be held up by it.

**What fast mode is** (`tools/scripts/coop-kit.mjs`, `src/core/proofmode.ts`):

- `draw` (default 0): the kit's init script puts `window.__op2Proof = { draw }` on the page before the game loads. The game reads
  it **only on a dev build or a page served from this computer** (the loopback transport's gate; the public site ignores it,
  `proofmode.test.ts`). `Game.frame` then asks a `DrawGate` whether this frame is drawn; a frame that is not calls
  `Renderer.settle()` instead of `render()`: the scenes' world matrices, the live lights' lifetimes and the post effects' pulses
  are brought up to date exactly as `render()` does first (33 files of game code read `matrixWorld`), and nothing goes to the
  GPU. `window.__op2.proof` is the gate: `show(n)` draws the next n frames, `rate(hz)` changes the rate, `drawn`/`skipped` count.
- `audio` (default false): the kit's init script wraps `AudioContext` so each one is suspended as it is made and `resume()`
  does nothing; `window.__coopAudio(true)` lets them run. No game code: it is the state the game puts itself in when its tab is
  hidden. Sounds started while suspended never end, so the voice pool fills and later ones are refused, as in a hidden tab.
- `clock` (default 0, off; `clock: 60` to try it): the game's loop steps on a worker's timer at that rate instead of on
  animation frames (`tickOnProofClock` in `Game.ts`, same gate), so a busy GPU process cannot hand a guest window its frames
  late. Off by default because a proof that caps or counts frames through `requestAnimationFrame` itself (`coop-time-slowhost`,
  `coop-motion-measure`, `coop-claims-matrix`) would no longer be in step with the game, and its gain was not separated from the
  two above. A hidden tab is still stepped by the game's own hidden-tab worker.
- The guests of a three or four player party boot side by side instead of one after another.
- Not changed: the window size (it costs nothing), the frame-rate cap (none), the dev server (see "Not done").
- **Page frame rates, three pages in a live fight, both modes at the same moment** (load 70): fast mode 13 to 54 loop frames a
  second on every page, about 38 on average; today's mode 0 to 20, about 5 on average (that fast run also had `clock: 60`).
  Two-page smoke runs without the clock: host 47 to 56 and guest 8 to 28 in fast mode; host 24 to 32 and guest 0 to 26 in
  today's mode. All of these were taken with the real pointer lock, whose runaway (below) is what held the guests down.

**Before and after, the same proof in both modes at the same moment** (so the same machine load):

| Proof (two pages, dev server, 1280x720) | Mode | Checks passed | Seconds running (after the wait for a slot) | Chrome CPU seconds | of which audio threads | Peak Chrome memory |
|---|---|---:|---:|---:|---:|---:|
| `coop-smoke` (load 75) | today's (`COOP_LOOK=1`) | 5 of 5 | 81 | 186 | (not split in that run) | 3.0 GB |
| `coop-smoke` (load 72 to 75, two runs) | fast | 5 of 5 | 68 and 70 | 144 and 164 | 0 | 3.0 and 3.1 GB |
| `coop-stage3` (same moment, load 73) | today's | 12 of 12 | 123 | 334 | 75 | 3.4 GB |
| `coop-stage3` | fast | 12 of 12 | 126 | 265 | 0 | 3.3 GB |
| `coop-drops` (same moment, load 60 to 77) | today's | 8, the same 8 | 366 | 954 | 128 | 11.1 GB |
| `coop-drops` | fast | 8, the same 8 | 357 | 815 | 0 | 9.4 GB |

- **What it buys: CPU, a fifth to a quarter less per proof on these three, all of it the audio threads and the drawing; not
  wall time and not memory.** A proof's length is its own waits, its screenshots and its four boots (about 30 CPU seconds
  each: 12 on the page's thread, 7 in Chrome's pool, 5 in the bake worker, 6 in the GPU process), which fast mode does not touch.
- **The pages run steadier** (the frame rates above), which is what makes a proof's waits end on time when the machine is busy.
- An earlier smoke pair, taken while the first version of fast mode still drew every frame inside `measure()`, is not in the
  table: its guest page starved in both modes (0 frames a second) and both runs took over two minutes.
- `coop-robust` fails in fast mode at "the guest's tab dies; the host is alone within 40 s". Not run in today's mode, so not
  compared: the session lane now keeps a dropped guest's seat for 60 s, which would fail that wait in either mode.
- `coop-session-start` and a 4-page run were queued and cut when the machine had to be relieved: not run.
- In `coop-drops` the browser process itself took 225 to 236 CPU seconds on its main thread and grew to 2.3 to 3.1 GB, and the
  pages' compositor threads took 154 to 159 more, in both modes; the proof also stopped at 8 of its 12 checks. That was the
  runaway pointer lock, found next.

**The runaway pointer lock (found second, the biggest single fix).** A probe counting events on each page of a live two-page
fight: the host got no pointer events; the guest, a window opened by `window.open`, got 9,000 to 34,000 `pointerrawupdate` a
second and a `mousemove` every frame while under pointer lock, with the browser process at 1.2 cores and the guest's process at
1.93 (the host's 0.79). With the kit's pretend lock: no events, the browser process under 0.02 cores, both pages' processes at
0.8, both at 60 frames a second. Same proofs, fast mode, before and after the pretend lock:

| Proof | Lock | Checks | Seconds running | Chrome CPU seconds | Browser process CPU / peak | Peak Chrome memory |
|---|---|---:|---:|---:|---:|---:|
| `coop-drops` (load 60 to 77) | real | 8 of 12 | 357 | 815 | 292 s / 2.3 GB | 9.4 GB |
| `coop-drops` (load 14 to 26) | pretend | **12 of 12** | **57** | **148** | 6 s / 0.15 GB | 3.2 GB |
| `coop-stage3` (same moment, load 30) | real | fails at check 8 (see below) | 75 | 226 | 40 s | 3.1 GB |
| `coop-stage3` | pretend | fails at the same check 8 | 75 | 180 | 8 s | 3.1 GB |
| `coop-smoke` (load 72 to 75) | real | 5 of 5 | 68 and 70 | 144 and 164 | 17 and 18 s | 3.0 GB |
| `coop-smoke` (load about 20) | pretend | 5 of 5 | 45 | 122 | 5 s | 3.0 GB |

In that last smoke run both pages measured 60 frames a second (host and guest), and the fight began 38 s after the start.

The drops rows were not taken at the same load (the slots were cut between them), so the seconds flatter the pretend lock; the
CPU seconds and the memory do not depend on load. Against today's mode with the real lock (954 CPU seconds, 11.1 GB, 8 checks),
`coop-drops` now costs **a sixth of the CPU and under a third of the memory, and passes**.

- `coop-stage3` passed 12 of 12 in both modes before my rebase at 22:55 and fails since at "The guest shops while the world
  runs on" (the guest's `shop:open` leaves it `playing`), with the real lock as with the pretend one: a change another lane
  landed (the shop or the break rules), not this work. It needs that lane's eye.

**Slots.** `tools/shot.mjs` keeps **3** runs at once (the lead's cut, kept). The machine is shared: of 32 cores and 62 GB, 8
cores and 16 GB are another person's and the agents' own compilers, test runs and servers take about 8 cores and 13 GB, which
leaves the proofs 16 cores and 33 GB. Memory: a run is 3.0 to 3.4 GB with two pages and 6 to 7 GB with four, and runs grow when
they are long (`coop-drops` above reached 11 GB), so three runs are 9 to 21 GB at their peaks and 33 at the worst seen: three
fits, four only while runs are short. CPU: a two-page run averages 2.1 to 2.7 cores over its life, a four-page run about twice
that, so three runs are 6 to 16 cores: three fits, four four-page runs (22 cores) do not. Fast mode's fifth to a quarter less
CPU does not buy another slot, and it frees no memory. Two rules were added to the slots: a run does not start while less than
20 GB is available (the other person's 16 and the run's own; `OP2_SHOT_FREE_GB`; it waits at most 10 minutes), and waiting runs
are served in order of arrival (a run of mine waited 12 minutes while later ones went in). While the numbers above were taken
the machine had 4.5 GB available at one point with eight runs alive, and the swap was full.

**Not done.** Serving proofs from a production build: memory is the same and one paired boot comparison was not conclusive on a
busy machine; a run would need a build step and a static server per worktree. A boot cache (nav mesh, light bake) inside the
game. Booting only once per page (opening straight into a match) would halve a short proof but skips the lobby the proofs are
also about. The 530 MB in Chrome's allocator is not attributed. `coop-team-kit.mjs` opens its third and fourth pages itself, so
those two draw and play audio as before.

### Co-op tests without a browser (written down, not built)

Most rules and protocol proofs do not need Chrome: they need two or more worlds, a transport between them and a clock.

**What exists.**
- `src/net/world.test.ts`: `pair()` joins a host and a guest `CoopWorld` (the real one, with every module under
  `src/net/world/`) through the real `Lobby` over a 30-line in-memory `Relay`, each side on a hand-made `Ctx` of mocks
  (`context()`: a real `EventBus` and real `Enemy` objects, everything else `vi.fn()`). 30 tests run on it in under a second.
- `src/net/fakeHub.ts` (`Hub`, `FakeRoom`): an in-memory relay with passwords and links that can be muted, cut and mended;
  the lobby and session tests use it with fake timers.
- `src/net/loopback.test.ts` and `netsim.test.ts`: the real `LaneRoom` with both lane kinds, and the simulator's lag, jitter and
  loss, over an in-memory `BroadcastChannel`.
- `src/core/stubs.ts` `noop()`: a stand-in for a whole system. Real systems that already run under Vitest in Node: Rapier
  physics, the enemy manager, gore ragdolls, structures (see `gore/ragdoll.test.ts`, `world/structures.test.ts`).

**What is missing.**
- A real `Ctx` outside the browser. `createCtx` needs a canvas, WebGL, an `AudioContext` and the DOM HUD. A headless one needs
  the real time, events, physics, player, weapons and combat, enemies, waves, progression and contracts, with `noop()` for render
  (a `THREE.Scene` needs no GPU), fx, audio, hud and viewmodels, and characters either read from `public/assets/characters/` off
  disk or replaced by a bare rig with the same bone names.
- A map without the browser: the map build and nav mesh run in Node in principle; the light bake (a worker and textures) must
  be skipped.
- A loop that is not `requestAnimationFrame`: `Game.frame` is private. It needs one exported `step(dt)` that N worlds call in
  turn under fake timers (the net code stamps and interpolates on `performance.now()`, which Vitest's fake timers move).
- `CoopSession` outside the browser: it reads `document.hidden`, the session storage handoff and builds remote players' bodies.
- One shared helper for the transport: today each test file has its own relay.

**First step.** Move `Relay`, `context()` and `pair()` out of `world.test.ts` into `src/net/testing/party.ts` as
`party(n, { net })`: N worlds on the real `LaneRoom` over the in-memory channel with the simulator, under fake timers. Then
replace one mock at a time with the real system, starting with physics and the real `EnemyManager` on a flat test floor, so one
test can run "a guest's claim, the host's damage, the kill event, the guest's copy dying" through real code at 3% loss. The
team, claims, time and session-timer proofs can then move to Vitest; the browser keeps the look-checks, real WebRTC, and one
smoke per lane.

### Baseline (stage 0a, 2026-11-18)

`tools/scripts/coop-baseline.mjs`: a pair in a live Crucible wave, the guest shooting an SMG by script, 20 s on a clean network and
20 s with `lag:80,jitter:30,loss:0.03` on both pages, 1280x720, no frame cap, RTX 4090. Full JSON: `baseline-loop.json` and
`baseline-rtc.json` in the rig's output folder; `summary` in each is this table. **The machine was busy with a dozen other agents
when these were taken** (1-minute load 47 to 92 on 32 cores), which lowers the frame rates and stretches every p90 and max; the
rates and sizes per lane are not affected. Re-measure on a quiet machine before comparing a p90.

| | Loopback, clean | Loopback, bad | WebRTC, clean | WebRTC, bad |
|---|---:|---:|---:|---:|
| Machine load (1 min) | 50 | 47 | 92 | 88 |
| Frames a second, host / guest (mean) | 56 / 41 | 47 / 30 | 18 / 14 | 27 / 22 |
| Enemies alive (mean) | 7 | 20 | 13 | 16 |
| **Enemy snapshot gap at the guest, ms: p50 / p90 / max** | **112 / 131 / 174** | **109 / 160 / 688** | **121 / 247 / 635** | **119 / 257 / 589** |
| Snapshots a second at the guest | 9.1 | 8.9 | 6.9 | 7.3 |
| Pose gap at the guest, ms: p50 / p90 / max | 50 / 75 / 174 | 52 / 97 / 197 | 65 / 168 / 635 | 52 / 145 / 449 |
| Host sends, bytes a second: `world` (snapshots) | 2,851 | 8,043 | 4,159 | 5,252 |
| Host sends: `action` (events) | 2,994 | 3,168 | 2,860 | 2,790 |
| Host sends: `pose` (unreliable) | 858 | 857 | 546 | 660 |
| Host sends: `lobby` + round-trip pings | 192 | 190 | 196 | 188 |
| Host total | 6,896 | 12,259 | 7,760 | 8,891 |
| Guest sends: `action` (claims, fire) | 4,313 | 5,277 | 2,937 | 4,997 |
| Guest sends: `pose` | 794 | 747 | 450 | 622 |
| Guest total | 5,161 | 6,077 | 3,441 | 5,671 |
| Round trip from the guest, unreliable path, ms: p50 / p90 | 26 / 63 | 247 / 302 | 80 / 209 | 286 / 389 |
| Round trip from the guest, reliable path, ms: p50 / p90 | 26 / 63 | 288 / 443 | 80 / 208 | 297 / 463 |
| Poses lost on the way (host's / guest's) | 0% / 0% | 3.6% / 4.4% | 0% / 0% | 2.9% / 2.2% |
| Poses that fell back to the reliable path | 0 | 0 | 0 | 0 |
| Guest kills in 20 s; host accepted / rejected claims | 20; 40 / 0 | 18; 49 / 0 | 23; 38 / 0 | 15; 51 / 0 |
| Co-op's own cost a frame, host / guest, ms | 0.15 / 0.10 | 0.17 / 0.29 | 0.76 / 0.47 | 0.28 / 0.45 |

What it shows:

- The snapshot lane runs at 7 to 9 a second, not 10: the send is gated on the host's frame (audit C1). The gap's p50 is 109-121 ms
  on every network, and one lost packet on the reliable lane stretches the max to 590-690 ms. That is the stall the enemy lane
  removes by moving snapshots to the unreliable lane with a buffer.
- On the bad network the reliable path's round trip p90 (443-463 ms) is well above the unreliable path's (302-389 ms): resends and
  the queue behind them. The unreliable path loses about the asked 3% each way and never waits.
- On real WebRTC the browser's own counts (`RTCPeerConnection.getStats`) show the `op2-fast` data channel open and carrying the
  traffic both ways (guest: 894 messages sent, 1,104 received over the run) beside trystero's `data` channel.
- A two-page loopback match on a machine with nothing else running holds 60 frames a second on both pages (the smoke proof, 4 pages
  too) with a round trip of 0.2 to 1.4 ms.
- Before the GPU flags the same headless pair ran at 1 frame a second per page (software rendering, 1440x900 dpr 2).

## Cloudflare worker: relay + error log (TURN setup, once by the owner)

Most pairs of home connections link directly. Strict routers, mobile data, some offices and some university networks do not; for those
the browsers need a relay, TURN. Cloudflare's is free for the first 1,000 GB a month (shared with its SFU), then $0.05/GB; a 3-hour
evening with three friends through it is about 1.5 GB at the measured rates. Its credentials must be minted with a secret key, so a tiny
Cloudflare Worker does that and the page only knows the Worker's address.

1. Sign up or log in at dash.cloudflare.com (free plan).
2. In the left menu open **Realtime** and choose **TURN Server** (if the menu has moved, search the dashboard for "TURN"). Click
   **Create** (or "Create TURN app"), name it `op2-turn`, create it. The page shows a **Turn Token ID** and an **API Token**. Copy both
   somewhere safe now: the API Token is shown once.
3. In the left menu open **Workers & Pages** > **Create** > **Create Worker** (the "Hello World" starter is fine). Name it `op2-turn`
   and click **Deploy**.
4. Click **Edit code**. Delete everything in `worker.js`, paste the whole of `tools/turn-worker/worker.js` from this repo, click **Deploy**.
5. Back on the Worker, open **Settings** > **Variables and Secrets** > **Add**:
   - Type **Secret**, name `TURN_KEY_ID`, value: the Turn Token ID from step 2.
   - Type **Secret**, name `TURN_KEY_API_TOKEN`, value: the API Token from step 2.
   - Type **Secret**, name `LOG_READ_KEY`: generate a fresh random key (at least 32 random bytes) in your password manager. Keep it
     there; the local reading tool uses the same value. Never paste it into this repo, a URL, or any `VITE_` variable.
   - Type **Text**, name `ALLOWED_ORIGINS`, value: your game's **origin**, e.g. `https://jaredb650.github.io` (no project path).
     If omitted it defaults to `https://jaredb650.github.io`. Local `http://localhost` and `http://127.0.0.1` on any port also work.
   Click **Deploy** (or **Save and deploy**).
6. Copy the Worker's address from its overview, e.g. `https://op2-turn.yourname.workers.dev`. Open it in a browser tab: you should see
   JSON starting `{"iceServers":[`. If it says a variable is not set, recheck step 5.
7. Put that address in the game: in `src/net/turn.ts` set `const WORKER_URL = 'https://op2-turn.yourname.workers.dev';`, commit and
   push. That is the only config slot; the address is not a secret (the key stays in the Worker). A build can also set `VITE_TURN_URL`.
8. In Cloudflare's left menu open **Storage & databases** > **D1 SQL Database** > **Create database**, name it `op2-logs`, and create
   it on the free plan. Open that database's **Console**, paste the contents of `tools/turn-worker/schema.sql`, and click **Execute**.
   If the console accepts only one statement at a time, execute the `CREATE TABLE` first and then the `CREATE INDEX`.
9. Return to **Workers & Pages** > `op2-turn` > **Bindings** > **Add binding** > **D1 database**. Variable name: **`LOG_DB`**.
   Select **`op2-logs`**, click **Add binding**, and deploy the Worker again.
10. Worker > **Settings** > **Triggers** > **Cron Triggers** > **Add**. Use **`0 * * * *`** (hourly) and save. The scheduled handler
    deletes reports older than 30 days; writes also delete expired rows, and reads always exclude them. With no traffic, physical
    deletion can lag expiry by up to an hour. D1 backups may follow Cloudflare's separate recovery window.
11. On the owner's computer, create `~/.config/op2/` and save **only** the `LOG_READ_KEY` value in `~/.config/op2/errlog.key` using
    a local editor. Make the directory private (`chmod 700 ~/.config/op2`) and the file private (`chmod 600 ~/.config/op2/errlog.key`).
    The file is outside the checkout. Do not send its contents to players or put it in build/deploy settings.
12. After the configured game is deployed, load it once and run from the repository: `node tools/scripts/errlog.mjs`. It reads the
    public Worker address from `src/net/turn.ts` and the private local key, then lists code counts, likely fault category, platform
    families and the three latest examples per code. `--since 2026-11-17T00:00:00Z --limit 1000` selects a window (maximum 1000 rows).
    `--raw` prints JSON. A full limit means the summary is truncated; narrow the time window. Read access is read-only and uses an
    Authorization header; the tool never prints the key. `VITE_TURN_URL` can override the address for a local configured build.

### Anonymous diagnostics and limits

The same public Worker address enables `POST /log` and key-protected `GET /logs`. Until it is filled in, reporting is a no-op.
The client queues up to 150 events per page session, deduplicates repeated errors for a minute, and sends at most five per batch every
five seconds or on exit. Each connection attempt resets deduplication so retrying is recorded. Delivery is best effort: closing or
crashing the browser, an offline connection, an opt-out or a blocked Worker can prevent delivery. It cannot guarantee every crash.
The last 50 reports are kept in localStorage for **Copy error report**, across reloads; this browser-local history does not expire on
its own. **Settings > Privacy > Anonymous error reports > Off** stops collection and sending and clears this history and the
pending queue immediately. Local copy still includes the current displayed technical error when reporting is off.

Reports contain a random session id, build commit, contract, host/guest/solo role, SHA-256 lobby digest, coarse browser/OS and memory
bucket, catalog code/message, trimmed stack frames and technical stage/candidate counts. No callsigns, chat, passwords, raw lobby
codes, full user agents, GPU model or ICE addresses are sent. A lobby digest pairs host and guest; it is pseudonymous, not a strong
secret (invite codes have a small search space). The Worker never stores IPs: it uses only ephemeral minute-window SHA-256 IP counters
in isolate memory, capped at 30 write requests per minute per IP and 4096 counters; this is a best-effort abuse guard per isolate,
not a global quota. `POST /log` caps streamed request bytes at 8192, accepts 1–5 strictly shaped events, and bounds field lengths.
D1 retains reports for 30 days. Anonymous submissions are untrusted evidence; a fault tag is a triage hint, not proof of cause.
Keep Cloudflare Worker **Observability > Logs** disabled if you do not want Cloudflare request diagnostics retained separately.

The game isolates throwing frame systems and reports each system's first failure; remaining systems and future frames keep ticking.
Boot failures and lost WebGL contexts show a friendly catalog message, Reload, and a Details disclosure with Copy error report.
Join failures use the same panel and preserve the more specific ICE guidance under Details. Kick and desync codes are available in the
catalog, but the current lobby protocol has no kick action or authoritative desync detector; those future call sites must use them.

The game asks the Worker once before joining (4 s at most; it never blocks a lobby if the Worker is down), caches the answer for an hour
in the tab, drops the port-53 entries that hang browsers, and passes the rest to trystero as `turnConfig`. The lobby's notes change to
say the relay is on.

**Without TURN** a pair that cannot link directly gets, after trystero gives up on the connection: "Found the lobby, but your networks
can't connect directly. Set up TURN (docs/notes/coop.md) or try a different network." A guest that never even finds the host gets the
30-second "No lobby answered" with the same advice. **Free public TURN:** none was found that is both genuinely free and reputable
without an account: the anonymous "Open Relay" credentials Metered used to publish are gone (it now needs a signup and a key in the
page), and the others are trials. Cloudflare's free tier is the free option, so there is no anonymous fallback built in.

## Stage 3: the Crucible together

- **Down, revive, bleed-out.** At 0 health a player is DOWN, not dead: `Player.downed` lets them look around and crawl (1.3 m/s) but
  not shoot. A teammate holding E within 2.4 m for `ALLY.revive` seconds (the allies' hold, `OrderKey`; no stim spent) gets them up at
  40 health where they lay; the host checks the two bodies really were within 4.5 m. After 30 s (`BLEED_MS`) down they are DEAD.
- **Spectate.** The dead ride over a living teammate's shoulder (`camera.setSeat`, gun hidden); Fire cycles teammates.
- **Respawn.** The dead and anyone still down come back at the spawn **when the wave is cleared**, so everyone shops; a second
  pass runs as the next wave starts. (Before the overhaul: only the dead, only at wave start.)
- **Wipe.** Nobody up: the run is over for everyone. The final board (kills, score, credits, downs, revives, ping) shows on every
  screen with its buttons; 20 s later (or the host's button or Enter) everyone is back in the same lobby. A co-op run never writes
  a solo high score. Every other ending goes through the same board: see "The team's rules".
- **Economy: each player's own purse.** Every browser runs its own Crucible shop and credits. The host attributes every kill
  (`world/credit.ts`, rules in "The team's rules").
  A teammate's kill skips the host's score, combo, perks, kill pay, sword ammo and run report (`CoopWorld.notMine`). A guest replays its
  own kills (the host's `kill` event carries the killer's slot and the headshot) as local `enemy:killed`, so its score, combo, perks,
  call-in offers and kill pay work as solo. **Shared wave bonus: every player, alive, down or dead, is paid the full wave-clear pay**,
  because the host's `wave:clear` is replayed on every guest (with `wave:start`: banners, shop breaks, supply pods, ammo top-up).
- **Loot and the shop.** Since the overhaul there is one supply pod and one weapon cache for everyone, at the same spot on every
  screen; each player shops there with their own purse, and takes their own share of a cache. Ordinary pickups are still each
  player's own. See "The shared world" above. The pod's shop opens over the live world (the co-op "paused" state releases
  controls but never stops the clock).
- **Slow motion.** One player slows everyone, and every screen says who: see "Time: the team's slow motion" below.
- **Call-ins.** Each player calls their own (earned from their own combo). A strike, the AA sentry, the mech, the door gunner or the
  AC-130 runs on the caller's screen; its damage reaches the host as call-in claims, with no line-of-sight test and no time limit
  (see "Claims"; only the instakills need a call-in announced in the last 10 minutes). Every explosion anyone's game makes is
  drawn and heard on every screen (`boom`), and the others get a feed line "VIPER called in AIRSTRIKE". Since the overhaul
  the call-in itself plays on every screen: see "Call-ins on every screen".
- **Bodies.** A friend holds the nearest baked prop to their gun (SMG, shotgun, launcher, minigun, pistol, sniper rifle, blade, flamer),
  and everything their gun does is drawn from it (see "Weapons on other screens"). Poses: crouch, slide (a crouch at speed), wall run left and right (lean),
  jump and mantle (the airborne gait), downed (prone), kneeling over a friend they revive. Tags sit above the head, clear of the HUD's
  chest-height markers; a downed friend's tag turns red with their seconds left. Implant parts are not drawn (not cheap).
- **HUD.** Teammates strip at the top (health, DOWN/DEAD, SHOPPING or IN A MENU, CHEATS, READY, ping); the break's clock and vote
  under it; the kill feed at the left; teammates on the minimap; Tab board; Enter chat (Esc cancels; lines show in the feed);
  revive prompt over the downed friend; the end-of-run board with its buttons.
- **Esc never pauses co-op** (stage 1). Leaving: the host's "End match (all to lobby)", a guest's "Leave match (to lobby)".

## Time: the team's slow motion

The owner's rule (decision 3 of the overhaul): **one player slows everyone, and every screen says who and with what. No slow-mo
starts on any screen without that notice**, the causer's own screen included.

**What slows the world, for everyone:** the Focus brain chip (0.35x), the SLOWMO perk and a Time Warp capsule (0.25x), and a
boss's death (0.4x Juggernaut, 0.45x Titan). These are the scales and blend-ins of single player. **What does nothing in co-op:**
hit-stop (every freeze-frame: gore, perks, call-ins, bosses, the Lance), the Judge's fan half speed, the solo death beat
(`hud-death`) and the dev panel's world speed. A freeze-frame or the fan would put the whole team in and out of slow motion many
times a minute.

**How it feels.** The world clock slows on every screen: enemies, their projectiles, physics, ragdolls, gore, particles, the
audio's pitch, and for SLOWMO and Time Warp the SLOWMO colour grade. Each player's own clock does not: body, aim, guns, reloads,
stims and the Focus meter keep full speed, exactly as in single-player slow-mo. A guest's screen in a teammate's slow-mo runs the
same code path as a solo screen in its own slow-mo (one shared request on `GameTime`, `dt` scaled, `playerDt` not), so whatever
single player does with tracers, impacts and the viewmodel, a guest does too. Other players' bodies are drawn from their pose
stream on real time, so they move at full speed through the slowed world, as the player does on their own screen. The world blends
in over the cause's own time (0.05 to 0.18 s) and back over **0.5 s** (0.6 s after a boss), on every screen's own clock, so a late
or lost message never makes a step. In co-op the blends run on true wall time (`GameTime.tick`, `blend`), so a screen with long
frames is back at full speed when the others are; single player blends on its clamped step, as before.

**The notice** (`world/slowNotice.ts`): top centre under the teammates strip. One line per cause in the causer's colour:
"KESTREL used Focus", "KESTREL earned SLOWMO", "KESTREL took Time Warp", "KESTREL killed the JUGGERNAUT" ("The TITAN is dead"
when no player did it); your own carries "(you)". Under them "WORLD AT 0.35x · YOU AT FULL SPEED", and a bar per line that
drains to its end. When the last one ends it reads "WORLD BACK TO FULL SPEED" for 1.1 s, then goes. A teammate's slow-mo also
plays `time_warp_in` and `time_warp_out`; the causer hears what single player plays.

**Rules (the host's `SlowBoard`, `world/slow.ts`):**

| Rule | Value |
|---|---|
| Two players at once | The deeper scale wins; both are named, each with its own bar. The world eases between scales |
| Asking again while yours runs (a second Time Warp) | Its clock goes back to full. It never adds |
| Longest one request can run | Focus 4.5 s, SLOWMO and Time Warp 5.5 s, a boss's death 9 s (real time). Focus asks for what its meter holds |
| Each player's own limits | Unchanged: Focus's 4 s meter, 25% to start, 1.5 s rest, 18 s refill; a perk's 5 s; SLOWMO's rearm |
| Down or dead | Refused ("NO SLOW-MO WHILE DOWN"); whatever they had running ends. The same when a player leaves |
| The team's budget | Players can keep the world slow **12 s in a row**. The budget fills at 1 s per second of full speed. Run dry, the world returns to full speed and nothing a player asks for is granted until **3 s** are back ("TEAM SLOW-MO SPENT · 3 S"). So: at most 12 s at once, and half the time over a long fight |
| A boss's death | The world's own: never refused, spends none of the budget |

A lone player's Focus (4 s of every 23.5) and SLOWMO never meet the budget; it exists for three or four players chaining.

**Wire** (reliable `action` lane):

| Event | Direction | Fields |
|---|---|---|
| `slow` | Guest to host | `id` (`focus`, `slowmo`, `timeWarp`), `on`, `s` seconds it means to run |
| `slowstate` | Host to guests | `list` of `{ k kind, s slot (-1 the world), sc scale, ms left, of ms granted, nm boss name }`, `lock` ms until the budget allows a new one |
| `slowno` | Host to one guest | `id`, `why` (`down`, `spent`), `ms` to wait |

`slowstate` goes out on every change, every 250 ms while the world is slow and every 2 s otherwise, so a lost message or a late
joiner is put right within a quarter second. Every entry also carries its own end: a guest lets go of an entry 0.5 s after its
deadline if the end never arrives. A guest's own request is applied on its own screen at once and confirmed by the next state
(700 ms to arrive, or it comes off), so the key has no network lag. Asking again while it runs does not renew those 700 ms:
when the host ends a slow-mo its owner keeps re-asking for, that screen lets go with everyone else. **The scale is not in the snapshot header**: the periodic
`slowstate` does that job, and the snapshot lane stays the enemy-motion lane's alone.

**Code path.** `ctx.time.gate` (`core/time.ts`) is set by `Clock` while a co-op world lives. With a gate, `pushScale`, `popScale`
and `hitStop` from anywhere in the game go to the gate and not to the clock, so no system needed a co-op branch: Focus
(`contracts/chips.ts`), the perks (`progression/index.ts`) and the bosses call what they call alone. The gate keeps the four team
kinds and drops the rest. Each frame before the tick, `Clock.clock()` applies the current list with `ctx.time.share` /
`unshare` (one request per entry, so the blends are the clock's own). Focus reads `world.slowHeld('focus')` and turns off when the
host has refused or ended it. A teammate's SLOWMO look comes through `progression.shareGrade` (it ranks as the perk would).
Single player has no gate: `pushScale` is the code it was.

**Clocks, for every lane:** `ctx.time.dt` is the world clock and on a guest it now follows the team's slow-mo: everything
cosmetic that should slow with the world (replica animation, enemy projectiles in flight, gore, ragdolls, particles) uses it.
`ctx.time.playerDt` is the player's own and never slows. `ctx.time.realDt` is for UI and for other players' bodies. Enemy
interpolation between snapshots runs on the host's wall clock (`performance.now()`), never on `ctx.time.elapsed`: a slowed enemy
simply moves less between stamps. Team timers that belong to players run on real time and are not stretched by slow-mo: the
30 s bleed-out, the revive hold, the end board (a slowed bleed-out would be a free extension, since the rescuer moves at full
speed). Timers that belong to the world stretch with it: waves and breaks (the host's director on `dt`), and an enemy's blast on
a remote player, which now burns on the world clock (`Later.after`, T2).

**A slow host (T1).** `GameTime.tick` clamps a frame to 1/20 s. Alone that is right; a co-op host at 10 fps was running the world at
half speed for everyone. Now a co-op host cuts a long frame into world steps of at most 1/20 s (`GameTime.split`, `Game.run`): two
at 10 fps, up to five (4 fps), drawn once. The first step takes the frame's input; the later ones see only what is still held.
If the steps themselves are what is slow (they would cost over half the frame), there are fewer and longer ones, up to 0.125 s,
which still keeps real speed down to 8 fps. After a stall at most 0.25 s of world is played out. Guests and single player are
unchanged.
## Call-ins on every screen

The owner's rule: everyone can call them in, and it is global. A call-in made by any player plays on every screen as it does for the
caller. Damage stays the caller's: its own game claims every hit with the host, and a watcher's copy never deals any.

**How.** The caller's game sends an **order** (`cin`: which call-in, its own number 0-255, the mark, one angle, a seed) and every
other screen starts the same call-in through the *same strike class* (`progression/callins/mirror.ts`), on a context that cannot
hurt anything (`ghost.ts`): `combat.explode` and `spawnProjectile` draw, sound and shake but hurt nobody (`ExplosionSpec.cosmetic`,
`ProjectileSpec.ghost`: a copy's round bursts on the first body or wall in its way, as its caller's does), `fireRay` is a tracer and an impact, `enemies.applyDamage` and `afflict` do nothing, banners and crew
chatter are muted, no key is ever down. Each player has their own set of what a strike borrows (jet, missiles, gunship and its
rounds, both helicopters, sentry, Frame), built the first time they call something that needs it. What an order cannot say goes as
**news** (`cnews`), named by the call-in's number. A copy starts when its order arrives, so it runs one network delay behind the
caller's, in step with the kills and blasts that arrive on the same ordered lane.

| Call-in | What keeps it the same everywhere | What a watcher sees |
|---|---|---|
| Airstrike | The seed: the same 15 rockets from the same places | The ring, 15 rockets falling with their trails and blasts, the finale missile and its blast, flash and shake |
| Warthog | The seed and the heading | The strip, the jet on the same pass with its trails and flares, 50 shells with tracers from its nose, their blasts, the roar |
| Orbital Lance | `steer` 10 times a second (the caller's aim on the ground), `release` | The pilot laser, the column and pool following the caller's aim at the beam's own speed, the ignition blast, embers, scorch marks, the hum |
| Black Sun | The order (a place and a clock) | The singularity growing, the streaks, bodies pulled in, the implosion and its blast. The host's copy drags the real enemies; the pull tugs every player |
| Tactical Nuke | The order | The siren and countdown banner (for everyone), the missile, the white flash, the shock front, the mushroom cloud and burnt sky. The front shoves every player |
| AA sentry | The order and the seed | The pod falling on the mark, the landing blast, the gun unfolding, tracking and firing at what flies (by itself, at the same drones), powering down |
| AC-130 | Its circle is the order (centre and side) and its clock (`clock` once a second, so a screen that dropped frames does not fall behind on the circle); `round` for every round with the exact spot it flies to, `bomb`, `laser` 10 times a second while guiding, `flares`, `down` | The ship on the same circle, the ring, every 25, 40 and 105 mm round in flight with its muzzle flash and report, each round's own blast (HE, AP, flak cone, white phosphorus cloud), the glide bomb steering onto the laser, flares, the crash. The same whether the crew or a player is on the guns |
| Attack chopper, door gunner | `pose` 10 times a second (position, attitude, the gun's aim and the triggers), `flares`, `down` (with where it was and how fast it was going, so every wreck lands on the same spot), `end` | The helicopter where the caller's is, rotors and engine sound, the gun pointing where the caller's points, its cannon shells, rockets or 20 mm stream with tracers, flashes and bursts, flares, the crash and wreck |
| The Frame (drop) | The order: the spot and the facing | The pod coming down on its jets, the landing blast, the Frame standing open. Its own pilot boards it; nobody else is offered the seat |
| The Frame (crewed) | `mech`: its pose 10 times a second (feet, legs, hull, stride, sink, sway, the guns' spot, firing and jets) and a word for each shell, missile, stomp, smoke and backhand | A puppet of the same body and arms walking where the pilot walks, footfalls, jets, the rotary's tracers, 40 mm shells in flight and their blasts, pod missiles, the stomp, the smoke. The pilot's own body is not drawn while they are in it |
| A mission's courier (`flyFlight`) | As a helicopter: `pose`, `down` | The host's Packmule crossing and being shot down |

Also on the wire: `aadown` (host to one guest: the Commander's missile brought your aircraft down; the host raises
`callin:teammate` for every guest's call-in, which the Commander and the Outpost's dread hear as they hear the host's own),
`pfx` (a streak perk's effect in the world: Chain Storm's arcs, Frost Nova's ring; Skyfall, Chain Reaction and Hellfire rounds are
blasts and already travel as `boom`), and `airlift` (the skyhook: `uid`, where the hook takes the man, the heading, the seconds
until it does; every guest flies its own drone, hook and line and carries its copy of the man up).

**Blasts.** A blast is sent as `boom` unless it is `cosmetic` (it is a copy), `mirrored` (the copies draw it themselves: every
call-in's rounds, so a gunship run costs no booms at all) or `worldObject` (its owner drew it). The budget is two buckets a sender:
24 a second for anything, and 12 more that only a large blast (5 m or more) or one near another player may use, so a storm of small
far blasts is thinned first. The host keeps a pair for itself and one for each guest it relays. `CoopWorld.boomsDropped` counts
what was left out.

**Checks.** Every field of what arrives is checked, numbers are bounded and rounded to a millimetre, and a sender is capped at 4
orders, 90 news, 40 Frame messages and 30 perk effects a second. A guest's goes to the host, which stamps the caller's slot and
passes it on. A player who leaves takes their copies with them. At most 6 copies a player.

**Cost on the wire** (measured by the proof, `Callins.cost`: bytes of the events as JSON, without the lane's envelope):

| Call-in | Bytes for the whole call | Messages | Rate while it runs |
|---|---:|---:|---|
| Airstrike, Warthog, Black Sun, nuke | 123 to 127 | 2 (the order, the end) | nothing |
| AA sentry (shot down at 9 s in the proof) | 158 | 3 | nothing |
| Orbital Lance | 4,300 | 72 | 60 bytes, 10 a second, for 7 s |
| AC-130, crew on the guns (50 s of a 141 s sortie) | 12,800 | 214 | about 60 bytes a round, plus its clock once a second |
| AC-130, a player on the guns (same) | 9,300 | 164 | the same per round |
| Attack chopper (27 s) | 32,000 | 270 | a pose of about 120 bytes 10 a second: 1.2 KB/s |
| Door gunner (27 s) | 30,300 | 268 | 1.1 KB/s |
| The Frame, crewed (20 s, walking and firing) | 17,000 | 200 | a pose of about 86 bytes 10 a second, and a word a shell |

The `wire` lane will pack these (the poses are thirteen numbers as text).

**Added by the fix pass (lane "fix-session", 2026-11-19):**

- **Late and returning players.** An order carries `age`, the seconds its call-in has been running (`cin { age }`, bounded to
  900). The host tells a player who arrives every call-in running now, its own (`CallInManager.runningOrders`) and its copies of
  the other players' (`copyOrders(slot)`), each with its age (`Callins.catchUp`). A guest whose line dropped has its copies
  dropped on every other screen with the seat; when the same page is back it says again what it still has up, with ages
  (`Callins.resay`; the host passes those on under their own budget of 16 a second and does not wake the Commander again).
  The same number told twice is still one copy.
- **Copies keep the wall clock.** A copy is born at "now minus age" and each frame is run up to the wall clock since then, not
  to the sum of that screen's frames (`CallinMirror.update`). More than `BEHIND_S` = 0.25 s behind, it is run forward in steps
  of 1/30 s, at most 20 s of strike time a frame, with the context quiet (`GhostStats.quiet`: no blast, round, tracer, sound or
  shake), its rounds in flight advanced with it. So a late joiner's gunship is on the host's place of the circle one frame after
  it is told, a short strike that is already over is never shown, one in its last moments shows only what is left, and a screen
  that dropped frames or a tab that was hidden catches up instead of flying late for the rest of the strike. This is the same
  for every call-in; the gunship's own `clock` news still works and agrees with it. A strike that cannot be run forward blind
  (it throws) is dropped for that screen, as before the fix: the next one is seen whole.
- **The uplink jammer holds every player.** A guest has no radio men of its own, so its game goes by the host's word
  (`commander:status`, flag `uplink`, already mirrored and told to an arriving player by `villain.ts`): `uplinkJammed()` in
  `callins/link.ts`. A guest's call under the jammer reads "HELD: UPLINK JAMMED" and goes when the jammer stops or after the
  same 12 s patience as the host's.
- **The missile an enemy fires at an aircraft** is told by the aircraft's own game as news of that call-in: `aa` (it left from
  here) and `aax` (it burst there: on the aircraft, on a flare, or spent). Every screen flying a copy flies a missile of its own
  from the same spot at its copy (the same speed, climb and turn as `antiAir.ts`), and ends it where the caller's ended.
- **The skyhook** tells a player who arrives of a drone still on its way, with the seconds it has left (`Skyhook.catchUp`).

**Not mirrored:** enemy helicopters fighting a guest's helicopter (vehicles are the host's); a mission's rides, where every
player mans their own copy. A late joiner does not see rounds that were already in flight when they arrived, nor a prisoner
already on the hook (he is simply gone).

Files: `src/progression/callins/link.ts` (the plain-number types both sides share), `ghost.ts`, `mirror.ts`, each strike's
`news`/`tell` (`shared.ts` `StrikeNet`), `src/frame/puppet.ts`, `src/enemies/outpost/airlift.ts` (`AirliftCopy`),
`src/net/world/callins.ts`, `airlift.ts`, `booms.ts`. Tests: `src/net/world/callins.test.ts`, `booms.test.ts`,
`src/progression/callins/copies.test.ts`. Proof: `tools/scripts/coop-callins-matrix.mjs`.

**Tests and proofs (2026-11-18).** Unit: `src/net/world/slow.test.ts` (the rules: scales, caps, reset not add, down, the
budget, a boss's death, a stalled host), `src/net/world/clock.test.ts` (host and two guests over the mocked transport: each
cause on every screen, two at once, the blends, refusals, a player going down or leaving, the budget, a lost start, a lost end, a
lost "I let go", a late joiner, junk from the wire, the clock given back to single player), `src/core/time.test.ts` (the gate,
single player below 20 fps unchanged, the host's steps at 15, 10, 8 and 5 fps, the stall cap, wall-time blends in co-op only),
`src/contracts/chips.test.ts` (Focus in co-op). Browser, on your own port, one run at a time:

```sh
node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 900 --script tools/scripts/coop-time-team.mjs --out tools/out/coop/time/team.png
#   COOP_PLAYERS=3, COOP_SIM=lag:120,jitter:40,loss:0.05, COOP_ONLY=late,budget (one part), COOP_SHOTS=1 with --dpr 2 --w 1440 --h 900
node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 600 --script tools/scripts/coop-time-slowhost.mjs --out tools/out/coop/time/slowhost.png
node tools/shot.mjs --port <port> --url "/?contract=crucible&autostart=1" --wait 3000 --timeout 300 --script tools/scripts/coop-time-solo.mjs --out tools/out/coop/time/solo.png
```

`coop-time-team.mjs` asserts on **every** page, for a guest's Focus, the host's Focus, both at once with a perk, a Time Warp and a
boss's death: the notice's words and the world's speed on it, the notice no later than the slowing, the world clock at the cause's
scale, the player's own clock at 1.00, walking speed and fire rate against the same page at full speed, enemies' movement against
their own speed, and a clean return to 1. Then a dropped end both ways, a late joiner mid-slow-mo, the 12 s budget and a downed
player. Two pages at 60 fps, 91 checks each (three pages: 87 checks, the late joiner left out to stay at three pages, the notice
on all three screens 13 to 50 ms after the cause, the same scales and speeds):

| | Clean network | `lag:120,jitter:40,loss:0.05` |
|---|---|---|
| Notice after the cause, causer's own screen | 9 to 36 ms | 9 to 32 ms |
| Notice after the cause, the other screen | 20 to 103 ms | 75 to 464 ms (a resent packet) |
| Back at full speed after the end | 495 to 623 ms | 500 to 767 ms |
| World clock on every screen | 0.35 / 0.25 / 0.40, exact | the same |
| Own clock | 1.00 | 1.00 |
| Walking, at full speed and in a teammate's slow-mo | 12.5 and 12.5 m/s | 12.5 and 12.5 m/s |
| Fire rate (SMG), full speed and slow-mo | 13.0 to 14.2 and 13.1 to 14.2 a second | 13.1 to 14.2 and 12.9 to 14.2 |
| Enemies against their own speed | 0.35, 0.25, 0.40 to 0.41 | 0.35, 0.23 to 0.25, 0.40 |
| A lost end (host to guests) | the guest lets go 1.0 s after the entry's own deadline | the same |
| A lost "I let go" (guest to host) | every screen at full speed 1.5 s after | 1.5 s |
| The budget, every player chaining Time Warps | slow for 12.50 to 12.53 s, then "TEAM SLOW-MO SPENT · 2 S" | the same shape |

`coop-time-solo.mjs` is the single-player reference on a solo page (11 checks): SLOWMO runs the world at 0.25 and Focus at 0.35
with the own clock at 1.00, walking 12.5 m/s before and during, the same fire rate (13.3 a second both), enemies at 0.24 and 0.33
of their speed, hit-stop intact, no gate and no notice. A teammate's slow-mo on a guest gives the same figures.
`coop-time-slowhost.mjs` (T1, 11 checks), the guest running free at about 55 fps:

| Host page | Host's world clock against real time | Guest's enemies against their own speed | World steps a second |
|---|---|---|---|
| Uncapped (60 fps) | 1.00 | 1.00 | 60 |
| 15 fps | 1.00 | 1.00 | 30 |
| 10 fps | 1.00 | 1.01 | 22 |
| 10 fps, the fix switched off (as before) | 0.50 | 0.50 | 10 |

One click of a semi-automatic on the 10 fps host fired one round, and a mouse move turned the view once. The proofs measure on
frame boundaries, wait for every page to be drawing at 15 fps before each part, and discount time a page's main thread was
blocked: the dev box is shared, and a starved page says nothing about timing.

Screenshots (dpr 2, 1440x900, `COOP_SHOTS=1`): the notice on the causer's screen and a teammate's for a Focus, two causes at once
and a boss's death.

**Not done.** Hit-stop in co-op (it would have to be per screen; owner's call). The Judge's fan slow-mo in co-op (owner's call).
KF2's "lite" slow-mo for a player far from the fight (research 5.6): everyone gets the same effect. The host's frame rate on its
team card ("host lagging"). Four pages were not run (three were). The late joiner was measured from the moment its page had finished
joining, by when the notice was already up; the quarter-second figure for it is the unit test's. Whether the notice ever sits
on top of a wave banner was not looked at.

## Stage 4: Endless Humans, Outpost Defense, any map

The host runs the world for all three survival modes, on whichever map the lobby picked; nothing in `src/net` names a map, so the Office
(`Crucible: Office`, `Humans: Office`) needed no code of its own.

- **Endless Humans.** The snapshot carries each man's posture (hands up, kneeling, cuffed, cowering, in cover, crouched, down) and a
  "can be cuffed" bit. A guest holds E on a surrendered man in reach and in view; the host cuffs him for them through the drone's own
  cuff (not the prisoners' key path, which would drop whatever the host holds). When the drone secures him the bounty moves from the
  host's purse to the captor's. Grabbing a man as a shield and questioning him stay the host's own. Trucks, humvees and tanks are drawn
  on the guests at 5 Hz; a guest's bullets, rockets and blasts are applied to them on the host as claims (`vhit`). Squad chatter
  and voices replicate (stage 2). The Commander's box on guests shows only what reaches them.
- **Outpost Defense.** Every player deploys from their own loadout screen and spends their own credits at the Armoury and Infirmary,
  over the live world. The fort is one fort for the team since the overhaul: see "Outpost Defense: one fort" below.
  The garrison runs on the host and is drawn on guests at 5 Hz with posture and tracers. Kill pay goes to the killer, wave pay to all.

## Outpost Defense: one fort (overhaul, lane world-b)

The fort is the host's and every guest sees and uses the same one. `src/net/world/fort.ts` carries it; `world/structures.ts` and
`contracts/defense/` each have a small `link` the module sets once the world is up (null in a solo run, where nothing changed).

- **Walls, gates and shacks** (`Structures.link`, a `StructureLink`). On the host every change of a piece is reported and goes out as
  `fort { pieces: [[index, stage, health, gate up, repair 0..1 or -1, repair seconds]] }`: a stage change in the frame it happens,
  with the indexes that changed loudly and the blast behind them (`loud`, `at`, `power`) so the guest's dust, sound and debris fly
  the same way; health alone every 150 ms. Health is sent exact, so every page reads the same number. On a guest
  `Structures.damage`, `blast` and `hit` change nothing: the guest's own blast goes to the host as `wallblast` (bounded: radius 60,
  3000 a blast, 24 a second, never the tank shell's x4) and its rounds on a shack as `wallhit`; the host's word comes back through
  `Structures.apply`, which swaps the mesh stage and the colliders, so what a guest sees is what stops it and its shots.
- **Lift gates** rise on the host for any player (`link.others`, every living player's feet from `Targeting.players()`), and never
  drop on one. A guest's own gate also rises as that guest comes within 4.5 m, without waiting for the host, and drops on the
  host's word once the guest is 6 m away.
- **A late or returning player** gets `fort { full: true }` (every piece that is not whole and shut) and `fortstate` from
  `Fort.catchUp`, called by `team.onArrived`.
- **Boarding up by hand.** A guest's `HandRepair` runs as solo (prompt, ring, hammering). When a stage is done it sends
  `repair { i, from }` (again every 0.35 s while E is held); the host checks the guest stands within 6 m of the piece, the piece is
  still at stage `from`, no crew has it, nobody is in the gap, and 0.9 s have passed since that guest's last one, puts the stage up
  with its own `setStage`, and answers that guest `repaired { pay }` (or `blocked`: CLEAR THE GAP). The guest's own purse is
  paid; the host's is not. Two players on one stage: the first is paid, the second is refused and starts the next stage.
- **The Barracks and the fort's other purchases** (`fortAct`: a hire, a work crew, a mortar team, a mounted gun's upgrade, a shop
  rebuilt). A guest's `Defense.buy` checks its own shop view, takes the price from its own credits, and sends
  `fortbuy { n, shop, act }`. The host checks every rule but the price where the fort is (`Defense.buyFor`: squad full, nothing to
  repair, posts manned, only in a break) and carries it out; `fortsold { n, why }` answers, and a refusal (or 6 s of silence) puts
  the price back with a feed line. Everyone's feed says who hired or bought what. Weapons, ammunition, stims, call-ins and
  implants stay each player's own, as before.
- **The fort's facts** go out as `fortstate` when they change (checked 4 times a second): hired men, each gun's level, mortar
  teams, the three shops' health, the next wave's line in a break, the uids of the men carrying charges, and the attackers'
  works (jump pads by wall index, sandbag walls and mortar pits by place). A guest's shop view, HUD chips, shop signs, gun
  models, mortar tubes, red carrier outlines, pads and sandbags (with their colliders) are made to match.
- **Mortar rounds** of both sides fly on every screen (`shell`): the team's own burst as a drawn rocket blast, the attackers'
  land as the host's `boom` and `hurt`.
- **The attackers** read every player: the siege goes on in toward the deepest defender, a squad fights the nearest player it can
  reach from its ring, and the enemy mortars shell any player inside the walls (`Defense.players()`, solo unchanged).
- **A guest's blast** also reaches what stands only on the host: sandbags, pads (and, in the villain's lane, shutters and devices)
  hear `coop:blast`, a game event raised on the host by `wallblast`. **Contract:** a cosmetic copy of somebody else's explosion
  must not go through `combat.explode` with damage on a guest, or it would be sent to the host as that guest's own.
- **The radio.** A guest's `DefenseRadio` is silent (its director, siege and garrison run on the host). The host's lines on the box
  (the Council's and the villain's) reach guests as every bark does (`world/villain.ts`, `cmd`); the garrison's callouts on the
  squad feed go out as `fortradio` and are said on guests through the same `comms:line` event. The wave-start sounds, the boss
  banner and the shop LOST and REBUILT banners reach guests too.
- **The break** is the team's (`net/teamBreak.ts`, the ready vote); the guest's Defense never times or skips it.

Proof: `tools/scripts/coop-worldb-defense.mjs` (a host, a guest and a late joiner; `COOP_PLAYERS=3` is a host and two guests),
57 checks; unit tests `src/net/world/fort.test.ts` (12, real Rapier walls on every side).

## The villain's props on every screen (overhaul, lane world-b)

His words and warning chips are `world/villain.ts`; what he leaves lying around is `src/net/world/villainProps.ts`. All of it is the
host's: laid, lit, tripped and blown there. `Devices`, `Barricades` and `Smoke` (enemies/commander/) each have a `link` the module
sets (null alone, where nothing changed).

- **Devices** (mines, tripwires, claymores, snares, beacons, charges, mortar tubes; Outpost Defense's satchels and tubes are the
  same class). The host numbers each one as it is laid and sends `dev { add: [[id, kind, place, far post, facing, model yaw, fuse]] }`,
  `dev { lit: [id, fuse] }` when a fuse lights and `dev { gone: [id, how] }` (0 taken away, 1 shot apart with sparks, 2 gone off).
  A guest draws the same model in the same place with the same blink, and hears the tick quicken as its own player closes
  (`Devices.animate`, run from the module because a guest's Commander never runs). Nothing trips or blows on a guest.
- **Any player sets one off.** On the host `Devices.update` reads every living player (`link.walkers()`, from
  `Targeting.players()`): a mine under any feet, a wire any shin crosses, a claymore's fan, a snare. The blast is the host's
  `combat.explode`, which already reaches every player (`boom` and `hurt`). A snare on a running guest sends that guest `snared`
  (the stop and the jolt are felt on its own screen) and the 8 damage as `hurt`.
- **Any player shoots one.** A guest's own shot is tested against its own copies (`Devices.onShot`, as solo); a hit sends
  `devshot { id }`; the host checks the device is live, within 400 m of the guest's body and not behind the world, then does
  what a round does (`Devices.shoot`): a mine, wire, claymore or charge goes off, a beacon or a cable dies with sparks. 30 a second.
- **Blasts.** A guest's blast reaches the host's devices and shutters through `coop:blast` (raised by `fort.ts` on `wallblast`).
- **Shutters** are real colliders on every screen: `shutter { put: [x, z, dx, dz, width, floor] }` drops one (it falls, with the
  dust and the slam), `shutter { take, blown }` removes it. The host never drops one on any player standing in a doorway.
- **Smoke:** `smoke { at, left }`; a guest's cloud is drawn for the seconds it has left. The canister is thrown at whichever
  player is up high.
- **A late or returning player** gets every device (`dev { full }`, which also clears anything stale), every shutter already
  down (`settled`) and every cloud with its seconds left (`Props.catchUp`, from `team.onArrived`).
- Not built: the sonar jammer's false men (`jam.ts`) are still only on the host's sonar; the tracker still learns from the
  host's shots, pickups, sonar and call-ins (and everyone's kills).

Proof: `tools/scripts/coop-worldb-props.mjs` (a host and two guests in Endless Humans: 40 checks), unit tests
`src/net/world/villainProps.test.ts` (9, his real `Devices`, `Barricades` and `Smoke` on every side).

## Prisoners for every player (overhaul, lane world-b)

`src/net/world/capture.ts`. A guest's E on a kneeling man is the designed key, read by the same `gesture()` and `holdFill()` the
host's own key uses (`enemies/outpost/capture.ts`): **tap to question, tap again to release, hold 0.4 s to capture**, the prompt
"Tap [E] to question · Hold [E] to capture" (then "Tap [E] to release · ..."), the fill ring. Reach 3.1 m and the 0.55 cone, as solo.

- The guest sends `capture { uid, act: question | release | cuff }`. The host checks the sender is up and within 4.5 m of the man
  (bodies, as the host sees them) and does it through `Prisoners.questionFor`, `releaseFor`, `cuffFor`: the same code the host's key
  runs. Two players on one man are settled by arrival: a man already cuffed, questioned or gone refuses the second key. 20 keys a second.
- **What he gives up is the team's.** `prisoner:questioned` now carries the marks his word put on the map; the host sends
  `prisoner { op: 'questioned', marks, seconds, reveal }` and every guest gets the markers for 9 s and, when he told the truth,
  every fighting man lit through the walls, exactly as the host's screen does. A lie puts "SQUAD?" on everyone's map.
- Every screen's feed says who questioned, released or cuffed him; the captor's own reads PRISONER CUFFED as solo.
- **The bounty** (250 to 450 by rank, about 300) goes to the captor when the drone lifts him: the host's purse is paid by the
  drone and passes it on (`credit`), to the captor's seat if they reloaded (team.ts `payee`).
- **A late or returning player** gets `prisoner { op: 'state' }`: who is already questioned and who holds whom.
- **The skyhook drone** is the call-ins lane's (`world/airlift.ts` there hooks the host's `Airlift` directly). What this module
  gives it: the host's `prisoner:cuffed` and `prisoner:secured` game events fire for a guest's capture as for the host's, and the
  `prisoner` event names the captor's slot.
- **The human shield is off in the game** (`HOSTAGES.on = false` in prisoners.ts, the owner's decision of 2026-11-15: hold E cuffs
  at once). It is built for co-op for the day it returns, and proven with the switch on: `act: grab` puts the man in the guest's
  hands (`Prisoners.grabFor`; the host keeps him in front of that guest's body, so every screen sees it), `drop` lets him go,
  hold E 0.6 s cuffs him; on the holder's own screen rounds from the front stop on him (`shield`, applied to him on the host)
  and the holder walks at his pace; his friends hold their fire for whoever they are after (`stopsFire`).

Proof: `tools/scripts/coop-worldb-prisoners.mjs` (a host and two guests: prompt, question and reveal on every screen, release,
capture with the ring, the bounty of 300 to the captor alone, two guests holding E on one man, the shield with its switch on:
34 checks, clean and under `lag:120,jitter:40,loss:0.05`); unit tests `src/net/world/capture.test.ts` (7).

## Enemy vehicles on a guest are working machines (overhaul, lane world-b)

`src/net/world/vehicles.ts` (the copy and its parts; the interpolation in it is the enemy-motion lane's, the hit boxes are
`vehicleHits.ts`, the claims lane's, and the guns' flashes, shots and sounds are the enemy-attacks lane's `enemyMuzzle` and
`enemySound`, which arrive at the muzzle in the world).

- **Parts.** Each 5 Hz state carries `x`, from `GroundVehicle.wire()`: speed along the road, the front wheels' angle, the body's
  pitch and roll on its springs, the main gun's lift, the roof gun's world yaw and pitch, and flags (left and right track thrown,
  engine fire, fuel fire, a roof gun fitted, the roof gun firing). The guest eases each toward the host's last word and poses the
  model as `GroundVehicle.pose` does: wheels turn by the distance run, the front pair steer, the tracks' links swap, the body rides
  its springs, the barrel lifts. The roof gun is the same `Gun` model off the same rack, swung at the pintle (`pintleOf`), and it
  kicks at its own rate while the host's fires. A thrown track is gone; an engine fire and a fuel fire burn with the same
  emitters; the engine is heard (`EngineSound`, pitched by speed).
- **It is solid.** The claims lane's hit boxes are the host's part boxes moved with the copy: a guest cannot walk or shoot through
  one (proven: a round stops on the hull, a guest walking at it is stopped).
- **Wrecks.** When a vehicle dies the host sends `wreck { op: 'add', wid, id, p, r, body, hop, tumble, flung }` once (found by
  watching `VehicleSystem.wrecks`). The guest's copy becomes the same `Wreck` class run as a `ghost`: scorched, hopping and
  tumbling with the host's own numbers, burning and smoking for as long, the tank's turret thrown with the host's velocity and
  spin; it sets off no cook-off blast and burns nobody (both are the host's, and reach guests as `boom` and `hurt`). It stands on
  colliders of its own (one per part), so it is cover on every screen. `wreck { op: 'gone' }` clears one the host cleared.
- **A late or returning player** gets every wreck standing (`Vehicles.catchUp`), lying where it lies with its seconds of fire left.
- **The attack helicopter** flies on guests too: the vehicle system's own airframe (there is only ever one), placed from the
  same 5 Hz states, with `EnemyChopper.wire()` for its rotors' rate, its chin gun's aim, and flags (tail on, main rotor on, going
  down, gun firing). Its rotors turn, the tail and its rotor go when the host's are shot off, it trails fire and black smoke
  as it falls, and its engine is heard. On the ground it becomes the same wreck (`Fleet.gunshipWreck`), on the boxes of what is
  left of it. It has hit boxes on a guest as the ground vehicles do.
- **Not built:** the barrel's recoil on a guest's copy when the tank fires; a wreck's cook-off blasts are seen as the host's
  explosions only.

Proof: `tools/scripts/coop-worldb-vehicles.mjs` (Outpost Defense's open field); unit tests `src/net/world/vehicleParts.test.ts` (5,
the real models, airframe and wreck class on both sides).

## Mounted guns: one gun, one gunner (overhaul, lane world-b)

Each browser builds its own `Emplacement` for every mounted gun, so before this two players could man the same gun, a guest could
sit on a gun the host's garrison was firing, and nobody saw anyone else's gun move.

- A guest who steps onto a gun says so (`gunseat { gun, on, yaw, pitch, firing }`, about 7 a second while seated). The host keeps
  the seat for them (`Defense.seatFor`): its own copy of the gun is occupied by a stand-in, so neither the host's player nor a
  garrison gunner can take it. A gun that is already someone's is refused: the guest steps off with "THAT GUN IS TAKEN".
- `fortstate.guns` tells every screen who is on each gun (a player's slot, the garrison, nobody) with where it points and whether
  it fires. On every other screen that gun is occupied too (no prompt to man it) and is `remote`: it swings there, spins, kicks,
  flashes, sounds and throws casings as the gunner's does, with tracers drawn to whatever the world puts in the way, and its
  rounds hurt nothing (the damage is done on the gunner's own screen, through the claims lane's mounted-gun kind).
- A seat with no word from its guest for 2.5 s is free again (they left, dropped or died).

Unit test: `src/net/world/fort.test.ts`, "one mounted gun, one gunner"; in the browser, the mounted-gun step of `coop-worldb-defense.mjs`.

## Missions (the campaign together)

The lobby offers **Mission 1: The Outpost** and **Mission 2: Foreclosure**. Retraining (the tutorial) is single player only. The
host's browser runs the mission: the runner, its triggers, the spawns, the battles. Every guest's own mission host runs inert (its
runner never starts) and plays what the host's does, so a guest plays the same mission from the first line to the ending, and
every player's actions count.

Files: `src/campaign/coop.ts` (the tables below, plain data), `src/net/mission.ts` (carries them out), `src/campaign/host.ts`
(`cue`, `show`, `issue`, `taken`), `src/campaign/index.ts` (`follow`, `tally`), tests `src/campaign/coop.test.ts` and
`src/net/mission.test.ts`.

### Where each operation happens

Every operation of the mission host (`MissionHost`, `src/campaign/types.ts`) is in one of three classes. **Mirrored:** the host
does it and every guest plays the same at once. **Shared, with catch-up:** mirrored, and the host also keeps the latest, so a late
joiner, a reconnecting player and a team back at a checkpoint get it. **Host's:** the host's alone by design; the last column says
how it reaches a guest anyway. `coop.test.ts` fails (and a new `MissionHost` method does not compile) until a new operation, step,
`call`, cue, trigger kind or trigger event has a row.

| Operation | Class | What a guest gets |
|---|---|---|
| `playerAt` | Host's | The runner's own feet. Zones read `crowd`, which is every living player |
| `crowd` | Host's | Every living player's feet, read on the host from the pose lane |
| `listen` | Host's | The host's own events, plus every guest's player actions, forwarded (`EVENTS`) |
| `speak` | Mirrored | The line: its box, its portrait and its voice, as the host's radio starts it |
| `hush` | Mirrored | The radio cut off |
| `objectives` | Shared, with catch-up | The whole list, with its world markers |
| `hint` | Mirrored | A teaching prompt, with each player's own keys |
| `banner` | Mirrored | A banner across the screen |
| `door` | Shared, with catch-up | Each door as it last moved; a closing door regroups the team |
| `squad` | Host's | Enemies are the host's world: guests get them in the enemy snapshot |
| `release` | Host's | Enemy orders: the host's AI |
| `sweep` | Host's | The host withdraws them; they leave the snapshot, and the vehicles their own lane |
| `drill` | Host's | Enemy orders: the host's AI |
| `place` | Mirrored | Everyone to the mark, a step apart |
| `vehicle` | Host's | The host's vehicles, drawn on guests by the vehicles lane (net/world/vehicles.ts) |
| `boss` | Host's | An enemy: the snapshot |
| `health` | Host's | A question about an enemy |
| `rounds` | Host's | A question: the lowest count among the players who own the gun (guests report theirs) |
| `give` | Shared, with catch-up | A gun handed to every player; part of the kit a late joiner gets |
| `grenades` | Shared, with catch-up | Grenades handed to every player; part of the kit |
| `rack` | Shared, with catch-up | A gun on the map: the first player to reach it takes it for the team, and everyone is issued one |
| `drop` | Shared, with catch-up | A pickup on every screen (each player's own); a late joiner gets those since the checkpoint |
| `cutscene` | Shared, with catch-up | The film on every screen in step; a skip is by vote; a late joiner comes in part way |
| `ride` | Shared, with catch-up | Everyone rides their own copy of the same flight; it ends for all when the host's does |
| `sortie` | Shared, with catch-up | Everyone gets a gunship seat over the same mark; it ends for all when the host's does |
| `frame` | Mirrored | The stand-in the game has today: its banner, and the eject's landing mark for everyone |
| `roster` | Host's | The squad is the host's allies: drawn on guests by the allies lane |
| `callins` | Shared, with catch-up | The sky shut or open for every player |
| `battle` | Host's | Allies and enemies: the allies lane and the snapshot |
| `stop` | Host's | As `battle` |
| `adapt` | Host's | The Commander's box between rounds: the villain's own mirror (the enemy-attacks lane) carries it |
| `field` | Host's | Enemy doctrine: the host's AI |
| `threat` | Host's | How hard the enemy hits: the host's AI |
| `music` | Shared, with catch-up | The music state |
| `call` | Mirrored | By name: see `CALLS` |
| `deploy` | Shared, with catch-up | The mark and the kit: each player lands a step apart with their own starter gun |
| `saved` | Mirrored | The "Checkpoint" notice; everyone down or dead gets up |
| `finished` | Mirrored | The mission is won on every screen, with its result for the team board |
| `cue` | Mirrored | A set piece's look: see `CUES` |

The `call` steps, by name (`CALLS`). Retraining's own (`tut.*`) are single player only.

| `call` name | Class | What a guest gets |
|---|---|---|
| `lights` | Shared, with catch-up | The blackout grade and its sound |
| `crash` | Mirrored | The curtain, the shake and the ring in the ears |
| `shatter` | Mirrored | The glass going |
| `comeAbout` | Shared, with catch-up | The circling ride turns for its route, on every player's copy |
| `mark` | Host's | A kill mark on a host vehicle: the vehicles lane draws vehicles, not their marks |
| `quiet` | Mirrored | The Commander's box closed |
| `commanderToRoof` | Host's | An enemy's order |
| `crew` | Host's | An enemy on a mounted gun: the host's war |
| `charge` | Host's | An ally's job: the host's war. Its countdown label is a `cue` |
| `watch` | Host's | The host watches its own walls; the breach reaches guests as a signal's consequences |
| `wound` | Host's | An ally shot: the host's allies. The round's tracer and report are a `cue` |
| `lose` | Host's | As `wound` |
| `courier` | Shared, with catch-up | The courier's flight and the flak round it, on every screen |
| `wreck` | Shared, with catch-up | The smoke over the wreck |
| `chip` | Shared, with catch-up | A brain chip fitted for the mission, for every player |

Cues (`CUES`): a set piece's look, sent by the host's `cue(name, ...)` and drawn by a guest's `show`. Alone, `cue` does nothing.

| Cue | What it draws on a guest |
|---|---|
| `alight` | The ride or the sortie is over on the host: anyone still in a seat is out of it |
| `filmEnd` | The film is over on the host (run out, or skipped by vote): it ends here too |
| `votes` | How many have voted to skip the film, on the film's bar |
| `callout` | A call-out of the war, on the comms feed |
| `charge` | The breaching charge's countdown over the man setting it |
| `sniped` | A sniper's round into one of the squad: its tracer and report |
| `frame` | The Frame's stand-in banner |

How each kind of trigger counts players (`TRIGGERS`):

| Trigger | Who counts |
|---|---|
| zone | Any living player inside |
| zone outside | Every living player has left |
| zone that ends a section | Any living player; the others get REGROUP_SECONDS to get into the zone, then are moved onto that player's spot |
| after | The host's mission clock |
| kills | Kills by anyone: the host's world counts them |
| cleared | The host's books |
| left | The host's books |
| below | The host's enemy |
| signal | The host's signals; `took:<weapon>` is raised by any player taking the rack |
| event | A player's action: any player. A world event: the host's (`EVENTS`) |
| ammo | The player worst off among those who own the gun |


Events a trigger may wait on (`EVENTS`). A player's own action, forwarded from every guest (only the ones the mission waits on,
at most 4 a second each): `weapon:fired`, `weapon:unlocked`, `weapon:switched`, `weapon:reload`, `stim:inject`, `player:slam`,
`player:dashed`, `player:jumped`, `player:wallrun`, `player:slide`, `player:mantle`, `sonar:ping`, `chip:kata`, `callin:used`,
`prisoner:questioned`. The host's world, heard on the host's own bus: `commander:done`, `enemy:surrendered`, `enemy:killed`,
`vehicle:destroyed`. A forwarded action reaches the runner's trigger only: it is never emitted on the host's bus, so the host's HUD
and guns hear nothing of it.

### A mission won together is won by each player

The host's `finished` word carries `counts` when the win opens what the mission opens (`mission.unlocks`, and not a run begun
part-way from a dev flag). Each guest's own browser then records it in its own save (`recordCampaignBeaten`, the flag that
opens Endless Humans), exactly as the host's does in `campaign/index.ts`, and its result says whether that opened something
there. A word from a guest cannot write anyone's save. The other things the game keeps per player: the **high score** is not
written by a co-op run for anyone, host or guest (`progression/score.ts`, a rule from before the overhaul: a team's run would
overwrite a solo record); the first-launch flag is untouched. Lead's call if co-op should keep high scores of its own.

### The rules, per trigger and set piece

| Thing | Decision |
|---|---|
| Zone triggers | Any living player entering counts; an `outside` trigger waits until all have left |
| A zone that ends a section (The Outpost: `easternApron`, `sallyHall`, `northCorridor`, `coolantNear`, `coolantFar`, `galleryFar`, `stackTop`; Foreclosure: `westGate`) | The mission moves on with the first player in. Everyone else gets **10 s** on the real clock ("REGROUP · moving you up to NAME in 10") and is then put on that player's own spot, unless they got into the zone first. Being near the leader is not enough: a door that has just shut may stand between. So nobody is left behind the blast door, the coolant pit or the gallery |
| A door closing | Regroups on the living player nearest the door: anyone more than 30 m from them gets **5 s**, then is put on their spot. Each screen's own door leaf still waits above its own player, so a door never closes on anyone |
| `place`, `deploy` | Everyone goes to the mark, a step (1.3 m) to the side per slot where that step is floor at the mark's height; on a narrow deck or against a wall, onto the mark itself (players' bodies do not collide). Each player keeps the starter gun they picked in the lobby: the host's stands in the kit where theirs goes |
| Guns on racks | A rack is the team's. The first player to walk over their copy takes it: the runner hears `took:<gun>`, every other player is issued the gun in the hand they hold ("NAME took the X: one issued to you") and the rack goes from every screen. A second take is ignored |
| `ammo` (rockets running out) | The player worst off among the living who carry the gun. Guests report their rounds when they change, at most twice a second |
| Kills, `cleared`, `left`, `below` | The host's world: any player's kill counts |
| Lines, hints, banners, music | Start on every screen when the host's start. A menu open over the live world no longer pauses the voice in co-op |
| Films | Everyone watches; whoever is down or dead is got up first. **A film is skipped by vote:** the skip key is a vote, the bar shows "1/2", and the film ends on every screen when every player in the match has pressed it. When the host's film ends, every screen's ends. A player arriving while it runs comes in part way |
| The door-gunner ride (The Outpost), the gunship sortie (Foreclosure) | Everyone rides: each player has a seat on their own copy of the same flight; whoever is down or dead is got up first; their rounds count through the host as call-in hits. The come-about reaches every copy. When the host's ride ends, anyone still in a seat is taken out of it |
| The courier going down (Foreclosure) | Every screen flies its own copy of the same flight with its own flak round it; the host's decides `war:hit` and `war:downed`. The smoke over the wreck is state |
| The war (Foreclosure) | A front is joined when any player walks within 32 m. A militia gunner on a wall gun turns on any player in his arc and sight, not only the host. Call-outs are said if any player is in earshot, and each player hears those in their own. The breaching charge's countdown shows on every screen. The sniper's round into the squad has its tracer and report on every screen |
| The Frame (the mech) | In both missions the `frame` steps are still the game's stand-in, alone as in co-op: a banner, and the eject's landing mark. Every screen gets both. When the real Frame is provided for missions: one Frame, piloted by the first player to reach it (decision), the others on foot beside it, drawn by the call-ins lane's puppet. As a call-in it is each player's own |
| The sky (`callins`) | Shut and opened for every player |
| A brain chip the mission hands out (`call chip`) | Fitted for every player |
| Checkpoints | "Checkpoint" on every screen; everyone down or dead gets up beside the leading player |
| One player down | The team's to revive; the mission does not fail |
| Everyone down, or the host's "Restart from checkpoint" | The whole team goes back to the last checkpoint. **Every screen rebuilds its run** (`reset`, then the same `Game.newRun()` the host does): enemies, corpses, pickups, dropped guns, doors, racks and the set pieces go, each player lands at the checkpoint's mark with its kit, the Council takes its 10% of each player's own score, and the doors, objectives and kit are sent again. The sky opens and the lights come back, as alone. A guest cannot send the team back |
| Mission won | `finished` gives every screen the mission's numbers (`ctx.coop.world.mission.result`: title, seconds, replacements, vehicles) before the team's end goes out; the board is the team lane's |
| A late or returning player | Is put beside a living player, then gets: the section's title, every door as it stands, the objectives, the music, the sky, the lights, the kit handed out so far (the last checkpoint's, plus every gun and grenade issued since), the brain chips, the wreck's smoke, the racks still standing, the pickups dropped since the checkpoint, and the film (part way) or the ride in progress |
| Villain lines | As written ("you") |

For the other lanes: a checkpoint restart is `run:start` on every screen in the middle of a match. A module that holds copies of the
host's world drops them then (`CoopWorld` does it for the enemy and vehicle copies before a guest's run is rebuilt), and state that
both sides rebuild the same way from a new run needs nothing sent.

Hooks: `ctx.coop.world.mission.restart()` (host: the team back to the checkpoint; the team's wipe and the pause menu's item go
through `campaign.restart()`, which is the same thing), `.catchUp(id)` (host: one arriving player; called on their first card),
`.result` (every screen, once won), `team.respawnAll(at?, yaw?)`.

### Proofs (2026-11-18 and 19)

Unit: `src/campaign/coop.test.ts` (9: every operation, step, `call`, cue, trigger kind and trigger event has a class and is
carried; what a mission waits on from a player; the zones that end a section) and `src/net/mission.test.ts` (9: the host's real
mission runner over the mocked transport: what is mirrored and what is not, a guest's shot, a rack taken by either side, low
rockets on a guest, the two regroups, a regroup dropped by a `place`, the film vote, the ride's end, the result, the checkpoint
restart, the late joiner's catch-up, and that a guest cannot drive the mission).

Browser: `tools/scripts/coop-missions-play.mjs`. A bot plays the mission on 2 or 3 pages. The ACTOR (the host, or the first
guest) walks into every zone, takes every gun off its rack, fires and votes; enemies get a dev kill on the host four seconds
after they appear, and the Commander is brought down in three steps, so every wave, set piece, film and ride still runs. At
every section each guest's screen is checked against the host's: the title, the objectives, the doors, the lights, the sky,
the kit, the racks, the enemies present, the film and the ride, the lines heard (same ids, same order, how far apart they
started), and ten seconds after a section change that nobody was left behind. At the end: the team board, the mission's
result, every checkpoint notice and hint.

```sh
OP2_NO_HMR=1 npx vite --port <port> --strictPort
COOP_MISSION=campaign|foreclosure COOP_ACTOR=host|guest COOP_PLAYERS=2|3 COOP_SIM=lag:120,jitter:40,loss:0.05 \
COOP_EXTRAS=skip,restart:<section>,rejoin:<section> COOP_BEAT=<start section> COOP_STOP=<end section> COOP_NET=rtc \
  node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 1700 \
    --script tools/scripts/coop-missions-play.mjs --out tools/out/coop/missions/<name>.png
```

| Run | Sections | Checks | Lines on a guest behind the host's (median, worst) |
|---|---|---|---|
| The Outpost, host acting, 2 players | all 18, 540 s | 236 (1 note: timing not measured in the briefing, a page paused 1.4 s) | 1 to 3 ms, 99 ms |
| The Outpost, guest acting, films skipped by vote, 2 players | all 18, 441 s | 241 | 0 to 1 ms, 12 ms |
| The Outpost, guest acting, 3 players, films skipped by 3 votes | all 18, 466 s | 452 | 0 ms, 2 ms |
| The Outpost, a guest's shot brings the line that waits on one (`heavy`) | 2, 67 s | 28 | 1 ms, 1 ms |
| The Outpost under `lag:120,jitter:40,loss:0.05`: everyone put down at the gate (checkpoint restart), the guest leaves and rejoins in the breather | `softskins` to `heavy`, 166 s | 76 | 162 ms, 430 ms |
| The Outpost over real WebRTC, guest acting | `lockout`, `softskins`, 111 s | 29 | 1 ms, 1 ms |
| Foreclosure, host acting, 2 players | all 16, 325 s | 192 | 0 to 1 ms, 6 ms |
| Foreclosure, guest acting, under the same bad network, films by vote, restart at the wall, rejoin at the Slip (sky shut) | all 16, 332 s | 225 | up to 285 ms, 447 ms |
| Foreclosure, 3 players, bad network | all 16, 360 s | 358 (and 4 notes: the proof read the film's end in the same instant on every page; fixed and proven in the next row) | up to 362 ms, 589 ms |
| Foreclosure, 3 players, bad network: the film ends on every guest when the host's does | 2, 172 s | 36 | up to 428 ms, 695 ms |

Single player, same build: the Outpost's film with one press of skip, no co-op in the page (`crowd` unset, no skip hook), and the
mission's own tests (`runner.test.ts`, `outpost.test.ts`, `foreclosure.test.ts`, `war.test.ts`) unedited and green.

The pages ran in the kit's fast mode (no picture between screenshots) with the loop on a 30 Hz timer. Screenshots are the guest's
view at 1440x900, dpr 2, one per section.

What the play-throughs found and fixed on the way: a straggler "near the leader" was treated as arrived, so a regroup was
cancelled the moment it began (and would have left a teammate outside a sealed door); a regroup that ran out as the mission
placed the team sent a player back; a player landing a step beside a mark could fall off a narrow deck; and **a hidden co-op tab
on a slow machine froze**: it took a step for every 33 ms worker tick, the queue grew without end, and the page never reached
its timers or its network, so the match dropped as "lost" (`Game.ts`, `keepTickingWhenHidden`: queued ticks are now skipped).

Not done, missions:

- **A guest cannot order or revive the host's Bailiffs** (Foreclosure's squad): E on a Bailiff is the host's. Foreclosure teaches
  the revive on a downed Bailiff, and only the host can do it.
- **The enemy chopper** (The Outpost, `turn`), **scenery vehicles** (`state: 'parked' | 'wrecked'`, the tank jammed in the gate)
  and **the kill marks on vehicles** (`call mark`) are not drawn on a guest: `net/world/vehicles.ts` draws living humvees, trucks
  and tanks only.
- **Holdfast's wall breach** is a structure stage on the host; whether a guest's wall opens with it depends on the fort's
  structure sync covering Holdfast (not checked here).
- **The Commander's box between rounds** (`adapt`) is the host's; a guest gets the mission's lines, not that box.
- **The courier's door gun** on a guest's copy fires for real through claims the host may accept (within four minutes of a ride):
  a little extra fire on the militia in the Square per guest.
- **The Frame in missions** is the game's stand-in, alone and in co-op (see the table).
- **A friend's name tag shows through a film.**
- **Each player's own starter gun** is kept by the code and unit-tested; the browser proofs' pages share one browser profile,
  so every page had the same pick.
- A line that is in the air when a player arrives is not said again for them; they get the next one.

## Failure cases handled

| Case | What happens |
|---|---|
| Host leaves or crashes | Guests wait on "Reconnecting to host… 30" (a host that only reloaded restarts the match for everyone), then get the team board and regroup in a new lobby on the same code with the next player as host. **No host migration:** the host's browser *is* the world. See "The life of a session" |
| Guest disconnects | "NAME lost connection.", body and tag go, the seat is kept 60 s, the run goes on; then "NAME left." |
| Guest rejoins mid-match, even mid-wave | A reload rejoins by itself; otherwise the invite link and password. Same seat and slot, the deploy gate, the full enemy state from the next snapshot, and the team's restore (purse, kit, life) by browser |
| A network blip | Nobody is dropped: "Reconnecting to host…" on the guest for up to 30 s, a kept seat on the host for 60 s |
| A slow or absent player at match start | The host's world waits at most 90 s, naming them; they join in progress when they arrive |
| Wrong password | Told on both ends, never silence (the door) |
| Version mismatch | "Version mismatch: the host has X, you have Y. Both of you hard reload (Ctrl+Shift+R, or Cmd+Shift+R on a Mac)" |
| A phone or touch-only tablet | "OVERPOWERED 2 needs a computer with keyboard and mouse" on Multiplayer; Join and Host refuse |
| A match handoff that fails on the new page | Multiplayer with why ("could not be carried over" or "could not reconnect"), never a silent splash |
| Lobby full | The fifth player is told at once ("That lobby is full: four players") |
| Code reused by another host | The newer empty lobby steps aside with "That code was already in use" |
| Stale invite link | "Lobby not found: nobody answered on code X ... an old invite link points at a lobby that has closed" after 30 s |
| No relay reachable | "Could not reach any of the matchmaking relays. Check your internet connection (a VPN or firewall can block them)" |
| Networks cannot link | The TURN message above, or a precise cause read from the ICE candidates each side offered (`src/net/ice.ts`; trystero already trickles each side's candidates to the other over Nostr, so no extra message): a side with no addresses at all, a side hiding its LAN address (Brave's WebRTC policy, a privacy extension), or **the same network** (same public address on both sides) that will not link its own computers |
| Same home Wi-Fi fails, other networks work | Seen 2026-11-17, both on Chrome: one player on a phone hotspot played fine. Chrome hides LAN addresses behind random `.local` names that need multicast to resolve; a router that blocks that (or isolates Wi-Fi clients, or a Mac whose Local Network permission is off for the browser) plus no NAT loop-back leaves no working pair. The page cannot get raw LAN addresses (only with camera or microphone permission). Fixes: macOS Local Network permission, a phone hotspot, or TURN. The console line `[coop] Peer connection failed. Our candidates: host N (N as .local), srflx N ... Theirs: ...` shows what each side offered |
| A file download fails while loading (flaky connection) | `fetchAsset` (`src/core/fetchAsset.ts`) retries network errors, 5xx and 429 three times; still failing, the page says "Network hiccup while loading" with a Reload button, and a co-op match's handoff is put back first so the reload rejoins the match instead of starting a solo run |
| The game open in two tabs of one browser | Before: a second tab on the invite link joined as a second player under the same callsign, and tabs share localStorage (settings are saved whole, last tab wins). Now one tab runs the game (`core/oneTab.ts`, a Web Lock); another shows "OVERPOWERED 2 is already open in another tab" with **Play here instead**, which makes the running tab reload into that notice (leaving its room). The host also replaces a guest's old seat when the same browser (an id in localStorage) says hello again. To test two players on one machine, use a second browser profile or a private window |
| Host tab hidden or minimised | See below |
| Lag, loss, reordering, duplicates, clock drift | Events ride the reliable lane, so loss there arrives as delay. Poses and enemy snapshots ride the unreliable lane: a lost packet is simply replaced by the next. Enemy states carry the host's clock; the guest reads that clock from the fastest packet of the last few seconds and draws each enemy a little in the past, so the two pages' clocks never need to agree and may drift ("Enemy motion" below). A lost `up` or bleed-out is healed by the 4 Hz team cards |
| Desync | Every enemy sends a full record at least once a second, so a missing one is made within a second; twice a second a roster names everyone alive, and a copy the roster no longer names is withdrawn after 500 ms (time for its `kill` to arrive) |
| Cheating among friends | Hit claims are checked for the absurd only (see "Claims"): a flood, an amount no weapon makes (cut to a cap), a shot from where the shooter is not, a straight shot through a wall. Revives and captures are checked against the bodies' positions |
| Malformed messages | Every lane validates shape and range; a handler that throws is caught and logged per message (`trystero.ts`, `CoopWorld.receive`); the fuzz test throws 23 kinds of junk at both ends |
| Esc, menus, shops, loadout | Never pause co-op |

**A hidden host tab.** Browsers stop animation frames in a background tab and throttle its timers to once a second, which would freeze
the world for everyone. While a co-op tab is hidden, a tiny dedicated worker posts a message every 33 ms and the game steps on it,
without drawing (`keepTickingWhenHidden` in `Game.ts`); guests get a lobby line that the host stepped away and that they are back.
Measured: 5 s hidden, the host's world advanced 5.0 s and sent 41 snapshots (8 Hz). Chosen over silent keep-alive audio (unreliable once
the audio context suspends, which the game does when hidden) and over pausing everyone (friends frozen whenever the host alt-tabs).
It does not depend on any browser's own exemptions. Guests' hidden tabs keep sending poses the same way.

## Measurements

The figures in this section are from before the overhaul (one reliable 45-byte-per-enemy snapshot, 10 Hz). The enemy lane's
current sizes, rates and measured smoothness are in "Enemy motion" above.

Real WebRTC, two pages in one headless browser, each capped at 15 frames a second (two full worlds on one 8 GB machine), so the snapshot
rate was ~6 Hz instead of the production 10 Hz. A live Crucible wave of 13 to 21 enemies, host firing, under 150-300 ms lag with 5% resend
stalls (`coop-robust.mjs`):

| Traffic | Bytes per second |
|---|---:|
| Host enemy snapshots to one guest | 5,144 |
| Host events to one guest (fire, hits, kills, team cards, chatter) | 2,776 |
| Host total DataChannel bytes to one guest | 9,615 |
| Guest total DataChannel bytes | 1,786 |

Peak budget: a snapshot is 12 + 45 bytes per enemy, at most 2,172 bytes at the 48-enemy cap, so 21.7 KB/s per guest at 10 Hz, 65 KB/s
(0.52 Mbit/s) host upload for three guests, plus events (booms capped at 24/s, garrison tracers 30/s, cards 4 Hz) and the 5 Hz
garrison and vehicle lanes (about 4 KB/s with a full garrison). Fine on home broadband; through TURN a 3-hour evening for three guests is
1-2 GB of Cloudflare's 1,000 free.

Host CPU: what co-op itself costs a frame (remote bodies, snapshot packing, events, team, mirrors), `CoopSession.cpuMs`, averaged
0.42-0.74 ms with one guest during those waves. The remote bodies are the allies' Bailiffs (about 0.5 ms median for eight in a fight, docs/notes/allies.md), so
three guests add well under 1 ms to the M1's frame; the host's real cost is the same world it runs alone, plus gore from four guns.
Not measured: four real machines; a 4-player session on the 8 GB M1 (three extra full browsers would not fit beside it).

## Stage 1 (history): starting and running a match

Play > Multiplayer > Host a lobby, choose a password and share the invite link/code and password. Friends join and set their callsigns.
The host chooses **The Crucible**, **Endless Humans** or **Outpost Defense**, then presses **Start**. These select `crucible`, `outpost`
and `defense` respectively, on the Crucible, Kill House and fort maps. Stage 1 deliberately ignores the solo unlock gates.
All three are **free roam**: no enemies, allies, waves, campaign scripts, contract director or shops. Local player, movement, weapons
and viewmodel run as before. Remote bodies are visual only: no collision, hit tests, friendly fire or shooting replication yet.

Maps are fixed for a page's lifetime. Start uses the existing contract page-load path, rather than attempting to hot-swap Rapier,
light volumes and systems. Each guest saves the match in **sessionStorage** when it receives the reliable `start` message and
acknowledges `started`. Only after all current guests have acknowledged (or left) does the host deploy. The handoff contains room
code/password, callsign, host role and `{ id, mode }`; it is consumed on reload, never placed in the URL, and cleared on quit.
The room reconnects **before** the expensive world boot. The host republishes its match to reconnecting players. Hello carries a `deployed` flag: returning guests ignore the old lobby host while slower peers finish acknowledging, then adopt only the new host page. Duplicate starts
never reset a live run; a late join follows the same map handoff. Refresh after the handoff is consumed leaves the match.
A browser may require a **Resume click** after asynchronous deployment to take pointer lock; the co-op world keeps running meanwhile.

`Ctx.coop` is the flag and `src/net/index.ts` is the game-facing interface. `Game` skips enemy/allied AI, waves, contracts and campaign
init/reset/update while `freeRoam` is set. It defers their initialization until the first subsequent solo run, so quitting co-op does
not strand the solo waves with uninitialized systems. Stage 2 replaces these gates with host simulation and guest snapshot receivers.
No changes are made in Player, Weapons, viewmodels, shop implementation or progression.

### Pose lane

`Lobby.sendPose` sends at **20 Hz** (one every 50 ms at normal frame rate, no catch-up bursts after a stalled tab), including while the
Esc menu is open. Guests send to the host. The host identifies the actual sender, overwrites the claimed roster slot and forwards to
other guests; its own poses go to every guest. This adds a host hop between guests but needs only a guest-host link, works before the
full peer mesh is connected, and leaves a single place for stage 2 validation. No public relay carries plaintext game poses: Nostr
handles encrypted signaling and WebRTC DataChannels carry the game traffic.

The `pose` action is binary, little endian, **40 bytes plus 1-32 UTF-8 bytes** of weapon id:

| Offset | Type | Value |
|---|---|---|
| 0 | u8 | Format version, currently 1 |
| 1 | u8 | Host-assigned roster slot, 0-3; host is 0 |
| 2 | u8 | Move: walk, sprint, crouch, slide, airborne, wallrun (0-5) |
| 3 | u8 | Weapon id byte length |
| 4 | u32 | Per-sender sequence, wraps at 2^32 |
| 8 | 3 x f32 | Feet position x/y/z |
| 20 | 3 x f32 | Velocity x/y/z |
| 32 | f32 | View yaw |
| 36 | f32 | View pitch |
| 40 | UTF-8 | Current weapon id |

Decode accepts ArrayBuffer or trystero's Uint8Array (including an offset view), rejects malformed lengths/versions/states, NaN,
infinities and implausible bounds. Host start messages are `{ t: 'start', match: { id, mode } }`, acknowledgements `{ t: 'started', id }`.
Lobby ids remain trystero peer ids except the host's canonical `host`. Slots are stable for a connected player and recycled on departure.
Since the overhaul's stage 0a poses travel on the unreliable lane (see Transport above), 7 bytes of lane framing over the 40 + weapon id.

The buffer renders **100 ms behind receiver arrival time**, so peer clocks need no synchronization. It interpolates position,
velocity, pitch and shortest-path yaw; rejects duplicate/old sequence numbers (including across wrap), bounds history to 32 frames,
holds the last received pose without unbounded extrapolation, and snaps teleports over 10 m. A frozen/background tab therefore leaves
a stationary remote body until it sends again; connection loss removes it through the roster.

### Bodies, menus and departures

Remote players use the allies' **Bailiff** body and **HumanoidAnimator**, armed with the allies' generic SMG. No Soldier AI or ally
registration is created. Each player's roster slot selects a private skin tint and matching floating callsign. Materials, props,
markers and pooled bodies are released on departure. Weapon ids arrive and are stored on the remote root for stage 2; the prop does
not yet change with the local weapon. Sprint is inferred from speed (>8 m/s); this game has no separate sprint input.

Crouch uses the existing crouch posture, slide falls back to crouch, wall-run falls back to lean-left plus airborne locomotion.
**New poses needed:** sliding, left/right wall-running, dash, mantle/vault/climb/cling, and a dedicated airborne/jump layer. Existing
procedural gait handles walk/run, strafing and aim pitch. Stage 1 maps other airborne special moves to airborne.

Esc shows **Co-op menu · world live**, releases local controls and hides Restart run. World time, physics, remote interpolation and
pose traffic continue; Guide and Settings opened there also keep the world live. A guest's quit removes its body and shows
`CALLSIGN left.` in the host/other guests' feed. If the host quits or disconnects, guests clear the run and return to Multiplayer with
an explicit host-left message. There is no host migration. Back from Multiplayer lands on **PLAY**.

**Still local/out of scope:** slow-mo requests and hit-stop still affect that browser's clocks; world props, pickups, damage, guns,
projectiles, deaths/game-over and effects are not synchronized. Death/game-over still stops that browser's world; revive and respawn
are stage 2+. Shops/loadout are disabled by the free-roam contract gate; their underlying solo pause paths are unchanged and will
need integration when enabled. Opening a paused shop through an external debug call uses the same live co-op paused-state clock,
but has not been made into a shared shop. Background tabs still throttle; keep the host foregrounded. TURN is still absent.

### Verification

Run Vitest one file at a time (`nice npx vitest run <file> --testTimeout=60000`): `src/net/pose.test.ts`, `src/net/lobby.test.ts`,
`src/net/session.test.ts`, `src/core/coop.test.ts`. The mocked transport copies binary packets and exercises all modes, start acknowledgements, host identity,
late joins, guest departure/slot reuse and host loss. Existing lobby coverage includes password and version failures.

For the real two-page run, use one browser and a private server on 5268; wait while another `node tools/shot.mjs` is running:

```sh
node tools/shot.mjs --port 5268 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 420 \
  --script tools/scripts/coop-stage1.mjs --out tools/out/coop/stage1-final.png
```

The script arranges the two real local controllers on a common spawn for framing, then uses keyboard movement and checks the remote
mesh's coordinates against the moving local player. It captures `tools/out/coop/stage1-*.png` at 1440x900 CSS pixels, DPR 2.
`COOP_MODE='Endless Humans'` or `COOP_MODE='Outpost Defense'` selects either other host mode.

The 2026-11-15 two-page Crucible run passed all assertions: keyboard movement in both directions, settled remote coordinates,
world/remote updates under Esc, zero enemies/waves, departure feed, late rejoin, host-left menu message, PLAY Back navigation,
and a solo wave after quitting. All eight captures were inspected at DPR 2. `stage1-evidence-crucible.json` records the assertions.
The two-page Outpost Defense start smoke also passed: both browsers loaded `fort` with zero enemies/waves and remote bodies,
and host quit ended the guest's match (`stage1-defense-host.png`, `stage1-defense-guest.png`).
The two-page Endless Humans start smoke passed as well: both browsers loaded `killhouse` with zero enemies/waves and remote bodies,
and host quit ended the guest's match (`stage1-outpost-host.png`, `stage1-outpost-guest.png`). These four smoke captures were inspected.
All 31 focused tests pass. `npx tsc --noEmit` passes with only stage 1 changes applied to the stage 0 base; `npx vite build` passes.
The shared checkout temporarily had unrelated unfinished shop/defense type errors during final verification, so the isolated
checkout supplied the typecheck evidence. The only request failure in the successful Crucible run was menu audio aborted by navigation;
no game/page exceptions were reported by any successful run.
The final reconnect-generation smoke passed after the multi-guest handoff fix (`stage1-evidence-crucible-smoke.json`).
The shared checkout's typecheck was repeated once the other agents' shop/defense edits settled and passed too.

## Stage 2 (history): Crucible shooting and enemies

Only **The Crucible** enables stage 2. The host runs the original enemy manager, wave director, damage model and progression.
Guests initialize the normal character library and enemy manager for visuals and bone hit tests, but run no enemy AI, wave director,
status damage, reinforcements or navigation simulation. Their local controller, guns, ammo, recoil, muzzle flashes, sounds and tracers
are immediate. `src/net/world.ts` owns the replication, combat admission, player-target adapters and respawn timers. Solo code paths
keep their original behavior. Co-op contracts/allies/campaign remain gated off, so neither co-op peer can use the shop.
Guest pickup layout, pickup spawning/collection and pod updates are disabled until their authoritative replication is built.

The small integration hooks are in `Game`, `EnemyManager`, enemy steering/damage, Combat's enemy rays/explosions/projectile spawning,
projectile player sweeps, Player's guest-damage gate, and the HUD/progression death handlers. Crucible combat and projectiles continue
under Esc; only local controls and viewmodel updates stop. Co-op clears local hit-stop and slow-motion requests before clock ticks,
instead of allowing one player's perk or boss death to silently slow their own simulation. Shared slow-mo rules remain stage 3.

### Enemy snapshot lane

The host sends a **10 Hz** `world` action, binary all the way through trystero, not an ArrayBuffer nested in JSON. The receiver
accepts ArrayBuffer and trystero's Uint8Array, including offset views. Sequence numbers reject duplicates/older packets across wrap.
Each frame is **12 + 44 × live enemies bytes**; the 48-enemy cap is **2,124 bytes**, or **21,240 B/s per guest at 10 Hz** before
transport overhead. The host sends one copy to each guest. Interpolation is over the next 100 ms of receiver time, with no unbounded
extrapolation. A missing enemy is removed after a 500 ms grace for its death event. Killed IDs are tombstoned against stale snapshots.

| Offset | Type | Meaning |
|---|---|---|
| 0 | u16 | Magic/version `0xc202`, little endian |
| 2 | u32 | Snapshot sequence |
| 6 | u16 | Wave |
| 8 | u16 | Enemy count, at most 48 |
| 10 | u8 | Wave phase: intermission/spawning/clearing/boss |
| 11 | u8 | Rounded-up seconds to next wave, capped at 255 |

Each 44-byte record:

| Offset | Type | Meaning |
|---|---|---|
| 0 | u32 | Host-assigned enemy UID |
| 4 | u8 | Archetype index, fixed table in `worldProtocol.ts` |
| 5 | u8 | Airborne, downed, frozen, burning, shield, ward, boss-entry immunity bits |
| 6 | u8 | Locomotion / attack windup / attack active / stagger state |
| 7 | u8 | Intact plate mask, including all eight Juggernaut plates |
| 8 | 3 × f32 | Feet position |
| 20 | f32 | Facing yaw |
| 24 | f32 | Health |
| 28 | f32 | Max health |
| 32 | f32 | Remaining armour |
| 36 | 3 × i16 | Velocity in centimetres/second |
| 42 | u16 | Eleven-region sever mask |

The guest uses each archetype's normal mesh/rig/props and procedural animator, including downed posture, frost/burn skin and missing
limbs. Wounds and death effects use the normal gore system, which owns local ragdolls, droplets and blood decals. Bones and corpse
physics are cosmetic and need not match. The coarse attack/stagger/downed states do not synchronize every muscle, catch step or
get-up clip; a full living-knockdown interpolation pass is still needed. Late joiners get living state, not historical corpse piles.

### Reliable game events and hit claims

`action` carries JSON `{ match, data }`. Only admitted peers in the current match are accepted. Guests accept only their host's
events; the host stamps roster slots on forwarded fire and never accepts guest-forged enemy kills, wounds, player-hurt or world events. Messages contain
game state only. Passwords, storage contents, device information and account data are never in these lanes. Nostr remains encrypted
signaling; WebRTC carries game traffic. trystero's channels are reliable/ordered; congestion/backpressure and an unreliable world
lane remain future work.

| `data.t` | Fields | Direction |
|---|---|---|
| `fire` | shot sequence, weapon, origin, direction; host-stamped slot | Guest→host→other guests, or host→guests |
| `hit` | shot, target UID, weapon, origin, complete damage inputs | Guest→host only |
| `hitfx` | UID, damage inputs, final health/armour, blocked | Host→guests |
| `sever` | UID, region, damage inputs | Host→guests |
| `kill` | UID, archetype, position/yaw, damage inputs, gib flag | Host→guests |
| `ray` | Enemy shot origin/end | Host→guests, cosmetic |
| `hurt` | Amount, source position, type/source, life generation | Host→one guest |
| `life` | Slot, alive flag, life generation | Guest death acknowledgement→host; host→guests |

Damage vectors are arrays. Other inputs retain the existing `DamageInfo` names: amount/type/source, region/bone, force, ammo `load`,
sever/headshot multipliers, penetration flags, blast reach/kind, explosion ID and optional slice plane. No second AP/HP or Raufoss
damage implementation exists: accepted claims call the host's normal `applyDamage`. Guests return a local predicted plate stop to
their firing code, so Raufoss's existing behind-the-plate pellet path also submits its component hits. The host is the only side
that spends armour/health. Prediction does not kill a guest's replica before the host confirms it.

The loose friends-only validator requires a known weapon, admitted living sender, monotonically increasing/rate-limited fire,
the matching recent shot, bounded finite inputs, a plausible hit point and origin, a 350 m maximum range, world line of sight
with a 1 m cover tolerance, and a bounded number of component hits per shot. It deliberately does not implement rewind, anti-cheat,
inventory proofs or exact server-side projectile replay. Late impact/continuous attacks may use a new rate-limited claim group.
Remote teammates show their firing tracer, muzzle flash and positional sound, but still hold the generic Bailiff SMG: first-person
weapons are code-built viewmodels rather than a complete matching third-person prop set.

### Targets and respawn

The host selects the nearest living player per enemy, with 20% hysteresis before switching. It refreshes the AI's PlayerSense for
that enemy and supplies a player adapter (and `Soldier.foe` where a soldier exists) without moving or simulating a friend's
controller. Remote-target walking can reuse the existing RouteFinder around cover, with one bounded search per frame. Enemy rays
and projectile sweeps test all living player segments; blasts also reach guests. The host sends the resulting damage to a guest's
own normal health/armour code. Cosmetic replay on a guest cannot independently hurt that guest.

A local death is acknowledged to the host. Host-owned real-time timers respawn either player after **3.5 seconds**, using the
existing player reset and a slot-selected map spawn, while enemies, physics, networking and the other players continue. Guns/ammo
are retained. Life generations reject delayed damage from a previous life. There is no revive, downed team wipe, checkpoint,
respawn protection, host migration or persistent player-health reconciliation yet. Other modes still use the stage 1 free-roam gate.

### Stage 2 verification

Isolated verification on 2026-11-16: `npx tsc --noEmit`, `npx vite build`, and **75 tests in 12 files** passed, one file per run.
Focused tests: `src/net/worldProtocol.test.ts`, `authority.test.ts`, `world.test.ts`, plus the existing pose/lobby/session and
`src/core/coop.test.ts`. The new mocked-relay tests exercise raw binary transport, host identity, actual damage-input delivery,
out-of-order and boot-time snapshots, wound/sever/death replay, guest targeting/damage, renamed remote bodies, rejection of
cosmetic secondary damage, respawn epochs and a live host during death. `src/net/economy.test.ts` checks that only solo/host
progression ticks pickups and pods; guests cannot generate their own economy. Existing
armour/headshot/blast/contact tests guard the solo damage and contact paths. Run each file separately with
`nice npx vitest run <file> --testTimeout=60000`.

The two-page real WebRTC proof is `tools/scripts/coop-stage2.mjs`. Use your own server on 5268 with HMR disabled and a private Vite
`cacheDir` (concurrent dev servers otherwise invalidate each other's optimized dependencies); wait for any other
`node tools/shot.mjs` process first. Run one Chrome with two pages, 1440×900 CSS pixels and DPR 2:

```sh
node tools/shot.mjs --port 5268 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
  --script tools/scripts/coop-stage2.mjs --out tools/out/coop/stage2-final.png
```

The proof caps each test page at 15 animation frames per second to fit two full worlds on the shared 8 GB machine. This is a
harness setting, not a production frame limit or a game performance benchmark. It measures a ten-second live wave with host fire before
arranging controlled normal enemy spawns for an actual guest mouse-trigger kill. After the traffic sample and wave screenshots,
it stops the wave feed and withdraws the crowd so the subsequent combat assertions isolate one ordinary enemy at a time:
enemy-AI damage to that guest, guest and host deaths/respawns, and live Esc. It records payload counters and WebRTC data-channel
bytes, not an estimate from object sizes alone. `tools/out/coop/stage2-evidence.json` is the evidence receipt; screenshots use
`tools/out/coop/stage2-*.png`.

The completed run passed all **nine assertions**, with no browser console, page, request or script errors. It started the Crucible
over the real password lobby/WebRTC path, rendered a host wave on both peers, fired the guest's local SMG through mouse input
(16 rounds; two accepted host damage claims; no rejected claims), and confirmed the same enemy UID dead on both. The host's ordinary
enemy AI damaged the guest from **100 to 88 health**. Both guest and host died and respawned while the other peer's world clock
continued. Esc left the clock and simulation live. The ten captured PNGs are **2880×1800** (1440×900 CSS, DPR 2); wave, kill, damage
and menu screenshots were visually inspected. The screenshot helper dismisses a focus-loss menu before non-menu captures; it does
not freeze the game. Pickups and powers visible in this combat receipt were not an economy-sync assertion; the final guest-economy
guard is covered by its separate unit test.

Measured **10.0785 seconds**, early wave 1 with **17–20 enemies**, one host and one guest:

| Traffic | Bytes per second |
|---|---:|
| Host enemy snapshot payload | 3,905 |
| Host action-event JSON payload, including shooting | 990 |
| Host total DataChannel application bytes, including poses and trystero framing | 5,989 |
| Guest total DataChannel application bytes | 792 |

The observed snapshot send rate was **4.86 Hz** under the shared-machine load and test frame cap, not a claim that production
is limited to that rate. The production cap is 10 Hz. At the 48-enemy cap, snapshots alone are at most **21,240 B/s per guest**,
or **63,720 B/s host upload for three guests** before events, poses and framing. DataChannel counters exclude DTLS/SCTP/UDP/IP
overhead. This is a bounded snapshot budget and a measured two-peer smoke test, not a four-machine throughput/latency benchmark.

## Verification (stages 3 to 5)

Unit tests, one file at a time (`nice npx vitest run <file> --testTimeout=60000`): `src/net/lobby.test.ts` (29: ping, heartbeat both
ways, full lobby, countdown and cancel, code clash, end match, away and rejoin, plus stage 0), `world.test.ts` (19: kill attribution and
replay, revive reach, bleed-out and wipe, wave replay and respawn, purse restore, explosions without damage, shared slow-mo, the fuzz,
mission mirroring, any-player zones, gathering, checkpoints), `authority.test.ts` (10: claim kinds, blasts round corners, call-in
window, down/revive/bleed/respawn, wipes, card clamping), `turn.test.ts` (4), `pose.test.ts`, `session.test.ts`, `economy.test.ts`,
`worldProtocol.test.ts`, `starter.test.ts`, `src/core/coop.test.ts`, `src/campaign/crowd.test.ts`.

Two-page proofs, one browser over the real relays, your own dev server with HMR off (`OP2_NO_HMR=1`), screenshots at 1440x900 DPR 2:

```sh
node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 --script tools/scripts/coop-stage3.mjs --out tools/out/coop3/stage3-final.png
COOP_MODE=humans|defense|office node tools/shot.mjs ... --script tools/scripts/coop-modes.mjs --out tools/out/coop3/modes-final.png
node tools/shot.mjs ... --script tools/scripts/coop-mission.mjs --out tools/out/coop3/mission-final.png
node tools/shot.mjs ... --script tools/scripts/coop-robust.mjs --out tools/out/coop3/robust-final.png
```

`coop-stage3.mjs`: lobby ping and countdown, the guest's kill paid to the guest and not the host, down and crawl, revive by the host's
held E, bleed-out and spectating, respawn on the next wave, the guest's shop over the live world, a guest's call-in strike killing on the
host and drawn there, the host's tab hidden for 5 s with the world running, the team wipe and both back in one lobby.
`coop-modes.mjs`: each mode's wave on both screens; Endless Humans' surrender seen with hands up and cuffed by the guest; Outpost
Defense's two loadouts and the garrison drawn on the guest; the Office map loaded on both. `coop-mission.mjs`: mission 1's briefing
lines, cutscene, objectives and the door-gunner ride on both, the guest's runner idle. `coop-robust.mjs`: as in Measurements, plus a
guest's tab dying mid-wave, rejoining by link with credits back, and leaving to the lobby and rejoining. Evidence JSON beside the PNGs.

## Not done, and why

- **Host migration:** see Failure cases.
- **Four-player and multi-machine testing:** only two pages fit on the 8 GB machine; the 4-player numbers above are budgets, not runs.
- **Anti-air missiles at another player's aircraft, and a call-in already running when a player joins:** see "Call-ins on every screen".
- Guest repairs and Barracks hires in Outpost Defense, questioning and releasing a prisoner as a guest, and the shield for a
  guest (switched off in the game, as in single player) are built: "Outpost Defense: one fort", "Prisoners for every player".
  Guest bullets on vehicles are the claims lane's, and built.
- **Per-muscle wound animation** on guests (a stage 2 limit) is unchanged. Living knockdowns and get-ups are done: "Enemy motion", Moves.
- **Implant parts** on friends' bodies.
- **The shared world** (lane world-a): walls, gates and shacks are not in it (lane world-b's). A prop two players have each
  half-damaged breaks when the host's count says so: a guest only knows its own hits, so it can see that break one message later
  than its own guess would have shown it. A late guest gets what is broken, not the scorch marks or the wreck fires. Ordinary
  pickups are each player's own by decision. Weapon caches are unit-tested and proven once in the browser in a mission; four
  pages and real WebRTC were not run for these proofs (the machine's page limit).
- **Campaign:** both missions are played from start to end by 2 and 3 pages ("Missions", "Proofs"), where what is still not done
  for missions is listed.
