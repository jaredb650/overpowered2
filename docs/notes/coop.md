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
4. Play. Tab shows the team board, Enter opens chat, E beside a downed friend revives them. Esc opens a menu over the live game.
5. When everyone is down (or the mission is won) the final board shows and everyone lands back in the same lobby. The host's
   "End match (all to lobby)" does the same at any time; a friend's "Leave match (to lobby)" steps out while the others play on,
   and "Rejoin match" takes them back.

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
| `src/net/team.ts` | Down, revive, bleed-out, spectate, respawn, the wipe, cards (health, kills, credits), rejoin purses |
| `src/net/mission.ts` | Campaign co-op: the host's mission mirrored to guests, any-player zones, gathering, checkpoints, late-joiner catch-up |
| `src/net/coopHud.ts` | Teammates strip, Tab board, Enter chat, end-of-run board |
| `src/net/*.test.ts`, `src/core/coop.test.ts`, `src/campaign/crowd.test.ts` | Unit tests over the mocked transport |
| `tools/scripts/coop-kit.mjs` | The test kit every multi-page proof shares: `startParty`, `live`, `measure` and the rest (see Testing) |
| `tools/scripts/coop-smoke.mjs`, `coop-baseline.mjs` | The rig's own proofs: any mode with 2 to 4 players reaches a fight; the baseline numbers |
| `tools/scripts/coop-stage3.mjs`, `coop-modes.mjs`, `coop-mission.mjs`, `coop-robust.mjs` | The two-page proofs (below) |

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
| `world/claims.ts` | Guest's `claim` (its damage as a `hit` event, and the guess at the result); the host's check and apply (`hitIn`); whose claim is being applied (`applying`) and who last hit an enemy (`lastHit`), read by hits.ts for kill credit | `hit` |
| `world/hits.ts` | What the host's damage did, as every other screen shows it: the host's `hitfx`, `ack`, `sever` and `kill`; a guest drawing its own hit at once (`stamp`, `predict`), putting right what it guessed wrong (`ackIn`) and showing the hits, cuts and deaths the host decided; `whenKilled`; `selfDestruct`. See "Gore on every screen" | `hitfx`, `ack`, `kill`, `sever` |
| `world/hitWire.ts` | The round and the host's findings as ids and whole numbers: `packHit`/`unpackHit`, `packFacts`/`unpackFacts`, `packKill`/`unpackKill` | |
| `world/remoteFire.ts` | A player's weapons on other screens: what is sent of a shot, a projectile, a swing and the gun in hand, the host's check and relay, and handing each to that friend's `Watcher` (`src/weapons/watch.ts`), which draws it. See "Weapons on other screens". Gun Kata's notice | `fire`, `round`, `loop`, `held`, `mfx`, `kata` |
| `world/enemyFire.ts` | Host: enemy rays against remote players (`enemyRay`), every enemy projectile described once as it leaves (`projectile`), flashes and sounds of things that are not an enemy's attack, the scope and shot recorder attacks.ts uses. Guest: tracers with the near-miss crack, harmless projectile copies, removing one at the host's word, asking the host to blow up one it shot | `ray`, `proj`, `projx`, `projhit`, `efx` |
| `world/attacks.ts` | Enemy attacks on every screen: the host's three events per attack, and the guest running the same `AttackDef` on its copy against a world that cannot hurt. Also a line said outside an attack and a boss's phase effects | `atk`, `atkf`, `atke`, `say`, `bossfx` |
| `world/warnings.ts` | Ground rings, falling shells, ground shocks, flashbangs, and the stars and lasers of things that are not an enemy's attack | `zone`, `strike`, `shock`, `bang`, `glint`, `laser` |
| `world/villain.ts` | The Commander's briefing, barks, warning chips, arrival and last words raised on guests as the same game events | `cmd` |
| `world/hostTime.ts` | `HostTime`: how much later than usual a host-stamped event arrived, so a late wind-up starts that far in | |
| `world/booms.ts` | `blast`: explosions sent to other screens (24 a second), an enemy blast's damage on remote players, a guest's blast on the host's vehicles | `boom` |
| `world/callins.ts` | A call-in's feed line, and the host's note that lets the caller's call-in damage pass | `callin` |
| `world/sonar.ts` | The shared Sonar ping | `sonar` |
| `world/chatter.ts` | The soldiers' lines on every screen | `chatter`, `chatcut` |
| `world/slow.ts` | The team's slow-mo rules with no game in them: the kinds, their scales and caps, the host's list and the team's budget (`SlowBoard`), the notice's words | |
| `world/clock.ts` | The clock's gate (`ctx.time.gate`): every slow-mo request the game makes, on host and guest; the host's answer; `clock()` applies the list to this screen's clock; the host's long-frame steps | `slow`, `slowstate`, `slowno` |
| `world/slowNotice.ts` | The notice every screen shows while the world is slow (its own element in the HUD root, `ui/css/cooptime.css`) | |
| `world/capture.ts` | A guest capturing a prisoner (hold E, the host cuffs, the bounty comes back); `capturable` | `capture`, `credit` |
| `world/guns.ts` | Carries the news of dropped guns for `weapons/dropped.ts` | `gun` |
| `world/pods.ts` | Carries the news of the drop pods for `progression/pickups/pods.ts` | `pod` |
| `world/props.ts` | Barrels, tanks and props: a guest's hits, the host's breaks, chairs, the late guest's state, the machinery clock | `prop` |
| `world/vehicles.ts` | The host's ground vehicles drawn on guests, 5 Hz, stamped with the host's clock and drawn through a `MotionBuffer` | `vehicles` |
| `world/villainProps.ts` | The villain's devices, shutters and smoke on every screen; a guest's round on a device; a snare on a guest. See "The villain's props on every screen" | `dev`, `devshot`, `snared`, `shutter`, `smoke` |
| `world/fort.ts` | Outpost Defense's fort for the whole team: walls, gates and shacks by index, the fort's facts, a guest's blasts, boarding up and Barracks purchases, mortar rounds, the Defense radio. See "Outpost Defense: one fort" | `fort`, `fortstate`, `wallblast`, `wallhit`, `repair`, `repaired`, `fortbuy`, `fortsold`, `shell`, `fortsay`, `fortradio` |
| `world/allies.ts` | The host's garrison drawn on guests, 5 Hz, the same way, and its tracers (30 a second) | `allies`, `ashot` |
| `team.ts` | As before; registers its own events with the router (`plug`) | `life`, `card`, `team`, `revive`, `up`, `wave`, `over`, `restore` |
| `mission.ts` | As before; registers its own events with the router (`plug`) | `mission`, `gather` |
| `worldProtocol.ts` | For code outside `world/`: re-exports `wire.ts` and `snapshot.ts`, and defines `WorldEvent` as the union of every module's event types | |

Rules that keep it working:

- **A module keeps its own state.** It reaches another module only through that module's public methods, and gets it as a constructor
  argument in `world.ts` (for example `Claims` is given `Replicas`, `Targeting` and `RemoteFire`, and `Hits` is given `Claims`). Nothing reaches into another module's
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

Both still go 5 times a second on the reliable lane as JSON, now with the host's clock (`at`). On a guest each has a
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
| Either, a deliberate quit | `leave()` sends `bye`: "NAME left." at once, no grace; a host's `bye` closes guests at once | |
| Either, its own page stalled | A heartbeat that last ran more than `STALL_MS` = 5 s ago restarts every peer's silence from now | |

A guest's page always reconciles with the host's list: if the list has it as loading or lost while it is in the world, it says
`loaded` again (once a second). So a lost message or a host that gave the seat up too early heals itself.

A full lobby never turns a live player away for a ghost: a fifth hello evicts the seat lost longest. trystero's own cap is 8
(`TRANSPORT_MAX_USERS`), so only the lobby's own check says "full".

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
- Not covered: a reload on the lobby page (between matches) still drops out of the room; the invite link brings the player back.

### Host loss

No host migration: the world lives only on the host's page. When the host is gone for good (grace over, or it quit):

1. Mid-match, guests get the team board "HOST LOST" with each player's kills, score and credits for `LOST_BOARD_MS` = 10 s.
2. Then everyone **regroups on the same code and password** (`CoopScreen.regroup`): the survivors in slot order as the host
   last listed them (`Lobby.successors`), the first hosts a new lobby, the others join it under the callsigns they had. Each
   joiner waits 14 s times its place in the line, then takes over if nobody ahead showed up; a host that finds the code
   already hosted joins instead. Players on the lobby page when the host goes regroup the same way, without the board.
3. The old host can come back with the invite link and joins as a guest.

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

### Hooks for the other lanes (`CoopSession`)

| Hook | When |
|---|---|
| `onArrived.add((id, { seat, slot, name, rejoin }) => …)` | Host: a player is in the world. `rejoin` when that seat has been in this match before (reload, reconnect, back from the lobby page) |
| `onLost.add((id, seat) => …)` | Host: a player's connection dropped while they were in the world; the seat is kept 60 s |
| `onGone.add(seat => …)` | Host: a seat is given up for good |
| `holding` | True until the barrier lifts. Host-side timers that must not run before every player is in can read it |
| `lobby.live`, `lobby.waitingFor`, `lobby.holdLeft` | The barrier, who it waits for, seconds until it starts regardless |
| `lobby.reconnecting`, `lobby.reconnectIn` | Guest: the link to the host is in trouble |
| `deploy()` | Presses "Click to deploy" from a script (`coop-kit.mjs` `deploy`, used by `inMatch`) |

The team's own first-card arrival (`team.onArrived`) still fires for every new connection. For the same connection coming back
after a drop (no new page, so no new first card) the session calls `team.onArrived(id)` itself, so the mission, dropped guns
and villain catch-ups run again; the team's `restore` and `sync` do not (see "Not done").

### Proofs (`tools/scripts/coop-session-*.mjs`, helpers in `coop-session-kit.mjs`)

Each asserts on every page and runs on the loopback transport; `COOP_SIM='lag:120,jitter:40,loss:0.05'` reruns it on a bad network.

| Script | What it proves |
|---|---|
| `coop-session-start` | 3 players, one held back 25 s: real clicks on the gate, nobody in the pause menu, the host's world held with "Waiting for GUEST-THREE" on both screens, slots are the lobby's, no join/leave lines, wave 1 only when all are in |
| `coop-session-noshow` | A guest that never arrives: the countdown, the host starting alone after 90 s and naming them, the guest joining the running wave later, announced once |
| `coop-session-blip` | The link silent for 8 s (the guest shows "Reconnecting to host…", nobody dropped, credits and gun unchanged), then the guest's page frozen 22 s (still in the match, never "left") |
| `coop-session-reload` | A guest reloads mid-wave and is back in its seat, never playing without a session; the host reloads and all three are in a new match with their seats |
| `coop-session-late` | A late joiner by invite ("is joining…", "joined.", the wave and its enemies); a match ended while a slow page loads lands that page in the lobby with the reason |
| `coop-session-hostquit` | The host's tab closes: "Reconnecting", the HOST LOST board, both guests in one new lobby on the same code with the lowest slot hosting, and a new match from there |
| `coop-session-three` | Three matches in one room with a 3 s hitch on one guest at every start: everyone in every match, seats kept, the host's mode pick remembered |
| `coop-session-password` | Someone typing the wrong password does not disturb a friend joining; "Wrong password" for the one, a double press is one lobby |
| `coop-session-modes` | Every co-op mode in turn in one room: world held while waiting (no wave running, mission not begun), started when the guest clicks |

Unit tests: `src/net/lobbyLife.test.ts` (30: each timer rule and each case above over the fake transport, `fakeHub.ts`).

### Not done

- The dropped-then-reconnected link over **real WebRTC** (trystero finding the same peer again) is covered by the unit tests
  and by the loopback proofs only; no proof cuts a real peer connection.
- A same-connection return after a long drop gets the world catch-ups but not the team's `restore`/`sync` (the guest's page
  kept its kit, and cards and snapshots heal state, but a wave banner or pod call sent while it was away is not replayed).
- Hidden-tab and "in a menu" tags on teammates (M7, M8), a note in the one-tab takeover (H2), a rejoin after a reload on the
  lobby page, and a host page reload after its guests have already regrouped (two hosts on one code; they do not merge).
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

Sizes as JSON, before the match wrapper (58 bytes a message today, the wire lane's to remove): `hitfx` about 108 bytes, `ack`
about 66; the old `hitfx` was about 330 and went to the shooter too (`hitWire.test.ts` holds them under 120 and 70). By
arithmetic, every round landing: the Buzzsaw at 50 rounds a second is 5.4 KB/s to each watching guest and 3.3 KB/s of answers to
the shooter (8.3 and 6.2 with the wrapper); a pump shotgun, six pellets every 0.55 s, is 1.2 KB/s to each watcher and 0.7 KB/s
to the shooter (1.8 and 1.4). Measured in the browser: see the lane's report. The wire lane will make these binary and batch a
frame's worth.

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
fired; the host answered; every screen wounds as often and as deep as the host decided, throws the puffs, cuts the same limbs,
leaves the body in the same state or kills it the same kind of way; nobody but the shooter gets a marker or a hit sound; the
shooter gets the same markers and sounds as host and as guest. `COOP_SIM=lag:120,jitter:40,loss:0.05` runs it on a bad network.

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
file's header): `coop-world-pods.mjs`, `coop-world-drops.mjs`, `coop-world-props.mjs`. Results: the overhaul log.

## How it works

- **trystero 0.27.0, pinned**, with its default strategy, Nostr: peers meet through public Nostr relays, then talk browser to browser
  over WebRTC. `appId` is `overpowered-2-coop`, the room id is the code, and `identity: 'none'` stores nothing and makes each tab its own
  player. trystero's own `maxUsers` is 8, so the lobby's check is the only cap of four. **Relays:** 8 of trystero's 30 public relays (`RELAY_REDUNDANCY`); trystero picks the same 8 for everyone from
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
  at 15 for the 8 GB Mac.
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
- **Respawn.** The dead (and anyone still down) come back at the spawn when the next wave starts.
- **Wipe.** Nobody up: the run is over for everyone. The final board (kills, score, credits, downs, revives, ping) shows on every
  screen; 15 s later (or the host's Enter) everyone is back in the same lobby. A co-op run never writes a solo high score.
- **Economy: each player's own purse.** Every browser runs its own Crucible shop and credits. The host attributes every kill: a guest's
  accepted claim marks the enemy, a later death by bleeding or fire goes to the last guest to land a claim, anything else is the host's.
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
  AC-130 runs on the caller's screen; its damage reaches the host as call-in claims, accepted for 4 minutes after the caller's
  `callin:used` (sentries stand that long), rate-capped at 160 a second, no line-of-sight test. Every explosion anyone's game makes is
  drawn and heard on every screen (`boom`, 24 a second at most), and the others get a feed line "VIPER called in AIRSTRIKE". The
  aircraft model itself is only on the caller's screen.
- **Bodies.** A friend holds the nearest baked prop to their gun (SMG, shotgun, launcher, minigun, pistol, sniper rifle, blade, flamer),
  and everything their gun does is drawn from it (see "Weapons on other screens"). Poses: crouch, slide (a crouch at speed), wall run left and right (lean),
  jump and mantle (the airborne gait), downed (prone), kneeling over a friend they revive. Tags sit above the head, clear of the HUD's
  chest-height markers; a downed friend's tag turns red with their seconds left. Implant parts are not drawn (not cheap).
- **HUD.** Teammates strip at the top (health, DOWN/DEAD, ping); Tab board; Enter chat (Esc cancels; lines show in the feed); revive
  prompt over the downed friend; end-of-run board.
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
or lost message never makes a step.

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
(700 ms to arrive, or it comes off), so the key has no network lag. **The scale is not in the snapshot header**: the periodic
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

## Stage 4: Endless Humans, Outpost Defense, any map

The host runs the world for all three survival modes, on whichever map the lobby picked; nothing in `src/net` names a map, so the Office
(`Crucible: Office`, `Humans: Office`) needed no code of its own.

- **Endless Humans.** The snapshot carries each man's posture (hands up, kneeling, cuffed, cowering, in cover, crouched, down) and a
  "can be cuffed" bit. A guest holds E on a surrendered man in reach and in view; the host cuffs him for them through the drone's own
  cuff (not the prisoners' key path, which would drop whatever the host holds). When the drone secures him the bounty moves from the
  host's purse to the captor's. Grabbing a man as a shield and questioning him stay the host's own. Trucks, humvees and tanks are drawn
  on the guests at 5 Hz; a guest's explosion is applied to them on the host (bullets from guests do not hurt vehicles). Squad chatter
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

## Stage 5: the campaign together

The lobby offers **Mission 1: The Outpost** and **Mission 2: Foreclosure**. The host runs the mission. Each guest's campaign host runs
inert (its runner never starts) and plays what the host's mirrors to it: lines (subtitles and voice), objectives and the beat title,
hints, banners, doors, music, cutscenes, guns and grenades handed out, pickups dropped, weapon racks, teleports and deploys, rides.

| Rule | Decision |
|---|---|
| Zone triggers | Any living player entering counts; an `outside` trigger waits until all have left |
| Gates and doors | A closing door gathers the group: a guest more than 30 m from the host is put beside them, so no gate splits it |
| `place`, `deploy` | Everyone goes to the mark, a step to the side per slot |
| The door-gunner intro (The Outpost), Foreclosure's flights | Everyone rides: each player mans the door gun of their own copy of the same Packmule on the same route and clock; their rounds count through the host as call-in hits |
| The gunship sortie | The same: each player gets a gunship seat |
| The Frame (the mech) | The host's alone |
| Checkpoints | Everyone down or dead gets up beside the host |
| One player down | The team's to revive; the mission does not fail |
| Everyone down | The whole team goes back to the last checkpoint (the mission's own redeploy) |
| Mission won | The end board, then the lobby |
| A late or returning guest | Gets the loadout, objectives, music, doors and beat, and is put beside the host |
| Villain lines | As written ("you"); the proposal's Q5 default |

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
| Cheating among friends | Hit claims: a known gun, a living sender, the matching rate-limited shot, range 350 m, line of sight from the shooter's eye, bounded inputs and hits per shot; blasts: no eye line, 160 a second; call-ins: only after calling one in. Revives and captures are checked against the bodies' positions |
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
- **Aircraft drawn for the others:** a call-in's jet, gunship or helicopter is only on the caller's screen (its explosions are on all).
- **Guest bullets on vehicles**, **grabbing a prisoner as a shield or questioning him** as a guest: the host's only. (Guest repairs
  and Barracks hires in Outpost Defense are built: "Outpost Defense: one fort".)
- **Per-muscle wound animation** on guests (a stage 2 limit) is unchanged. Living knockdowns and get-ups are done: "Enemy motion", Moves.
- **Implant parts** on friends' bodies.
- **Campaign:** mission 1's opening (briefing, cutscene, door-gunner ride) is proven in the browser; the rest of both missions has only
  the unit-tested rules behind it, not a full two-player playthrough.
