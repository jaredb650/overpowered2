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
| `src/net/session.ts` | Tab-local match handoff and early room reconnect across the map page load |
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
tab's worker tick), `Player.ts` (`downed` and its crawl), `time.ts` (`keepScales`), `Hud.ts` (shops and loadout over the live world in
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
| `world/snapshot.ts` | The binary enemy snapshot: `encodeWorld`, `decodeWorld`, `EnemyFrame`, `SNAPSHOT_MS`, `POSTURES`, `CAPTURABLE` | (the `world` lane) |
| `world/replicas.ts` | Host: builds and sends the snapshot. Guest: the enemy copies, their interpolation (`animate`), the `dead` set | (the `world` lane) |
| `world/targeting.ts` | Host: every player as a target (`players()`), `select`, line of sight, `steer` and its routes, `targetPlayer`, sending `hurt`. Guest: taking `hurt`, `allowsLocalDamage` | `hurt` |
| `world/claims.ts` | Guest's `claim` (its damage as a `hit` event, and the guess at the result); the host's check and apply (`hitIn`); whose claim is being applied (`applying`) and who last hit an enemy (`lastHit`), read by hits.ts for kill credit | `hit` |
| `world/hits.ts` | Kill credit (`killedBy`, `notMine`, the guest's own kill replay); what the host's damage did, sent out; wounds, severs and deaths on guests; `selfDestruct` | `hitfx`, `kill`, `sever` |
| `world/remoteFire.ts` | A player's shots on other screens: the local `fire`, the host's check and relay, drawing it. The shot counter claims carry. Gun Kata's notice | `fire`, `kata` |
| `world/enemyFire.ts` | `enemyRay` (the host's enemy rays against remote players) and `projectile`; the guest's tracer | `ray` |
| `world/booms.ts` | `blast`: explosions sent to other screens (24 a second), an enemy blast's damage on remote players, a guest's blast on the host's vehicles | `boom` |
| `world/callins.ts` | A call-in's feed line, and the host's note that lets the caller's call-in damage pass | `callin` |
| `world/sonar.ts` | The shared Sonar ping | `sonar` |
| `world/chatter.ts` | The soldiers' lines on every screen | `chatter`, `chatcut` |
| `world/clock.ts` | `clock()`: which slow-mo the host keeps; a guest's slow-mo perk asking the host | `slow` |
| `world/capture.ts` | A guest capturing a prisoner (hold E, the host cuffs, the bounty comes back); `capturable` | `capture`, `credit` |
| `world/guns.ts` | Carries the news of dropped guns for `weapons/dropped.ts` | `gun` |
| `world/vehicles.ts` | The host's ground vehicles drawn on guests, 5 Hz | `vehicles` |
| `world/allies.ts` | The host's garrison drawn on guests, 5 Hz, and its tracers (30 a second) | `allies`, `ashot` |
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

## How it works

- **trystero 0.27.0, pinned**, with its default strategy, Nostr: peers meet through public Nostr relays, then talk browser to browser
  over WebRTC. `appId` is `overpowered-2-coop`, the room id is the code, and `identity: 'none'` stores nothing and makes each tab its own
  player. `maxUsers` is 4. **Relays:** 8 of trystero's 30 public relays (`RELAY_REDUNDANCY`); trystero picks the same 8 for everyone from
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
  feed. Thermal is never sent, and Focus does nothing in co-op (`clock()` keeps only the shared slow-mo scales).
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
- **Loot and the shop.** Pickups, weapon caches and the supply pod are each player's own: every browser lays out its own pickups and
  drops its own kills' loot, and each player gets their own supply pod near them each break. Nobody can take another's loot.
  The pod's shop opens over the live world (the co-op "paused" state releases controls but never stops the clock).
- **Slow motion.** The world is the host's, so slow-mo is everyone's or no one's. The host keeps SLOWMO, Time Warp and a boss death's
  slow-down (`SHARED_SLOW`); a guest's SLOWMO or Time Warp perk is forwarded and the host slows the world for its duration (8 s cap).
  Every player keeps full speed, as solo. Hit-stop, the Judge's fan slow-mo and Focus are dropped in co-op (Focus says so).
- **Call-ins.** Each player calls their own (earned from their own combo). A strike, the AA sentry, the mech, the door gunner or the
  AC-130 runs on the caller's screen; its damage reaches the host as call-in claims, accepted for 4 minutes after the caller's
  `callin:used` (sentries stand that long), rate-capped at 160 a second, no line-of-sight test. Every explosion anyone's game makes is
  drawn and heard on every screen (`boom`, 24 a second at most), and the others get a feed line "VIPER called in AIRSTRIKE". The
  aircraft model itself is only on the caller's screen.
- **Bodies.** A friend holds the nearest baked prop to their gun (SMG, shotgun, launcher, minigun, pistol, sniper rifle, blade, flamer),
  with flash, tracer and positional sound from its muzzle. Poses: crouch, slide (a crouch at speed), wall run left and right (lean),
  jump and mantle (the airborne gait), downed (prone), kneeling over a friend they revive. Tags sit above the head, clear of the HUD's
  chest-height markers; a downed friend's tag turns red with their seconds left. Implant parts are not drawn (not cheap).
- **HUD.** Teammates strip at the top (health, DOWN/DEAD, ping); Tab board; Enter chat (Esc cancels; lines show in the feed); revive
  prompt over the downed friend; end-of-run board.
- **Esc never pauses co-op** (stage 1). Leaving: the host's "End match (all to lobby)", a guest's "Leave match (to lobby)".

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
  over the live world. The fort is the host's: the Barracks (troops, work crews) is the host's counter, and wall repairs are the host's.
  The garrison runs on the host and is drawn on guests at 5 Hz with posture and tracers. Kill pay goes to the killer, wave pay to all.

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
| Host leaves or crashes | Every guest's match ends with "The host left" (or, if silent, "Lost the connection to the host" after 20 s), back to Multiplayer. **No host migration:** the host's browser *is* the world (enemy AI, physics, mission runner, wave director); a guest has only cosmetic replicas, so migrating would mean rebuilding the whole simulation from a 10 Hz snapshot mid-fight. Not feasible here |
| Guest disconnects | Body and tag go, a feed line says so, the run goes on; the host drops a silent guest after 20 s |
| Guest rejoins mid-match, even mid-wave | The invite link and password; the host sends the match, the guest loads the map and gets the full enemy state from the next snapshot (every snapshot is complete), team cards within 250 ms, their purse and score back by callsign, and in a mission the catch-up above |
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
| Lag, loss, reordering, duplicates, clock drift | Events, the lobby and (still) enemy snapshots are on the reliable, ordered lane, so loss arrives as delay; player poses are on the unreliable lane, where a lost or late pose is simply skipped; poses and snapshots carry sequence numbers and drop old or duplicate frames; both render on the receiver's own clock 100 ms behind arrival, so clocks never need to agree; a lost `up` or bleed-out is healed by the 4 Hz team cards |
| Desync | Every enemy snapshot is the full living list: a replica the host no longer has goes after 500 ms, a missing one is spawned |
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
- **Guest bullets on vehicles**, **grabbing a prisoner as a shield or questioning him** as a guest, **guest repairs and Barracks hires**
  in Outpost Defense: the host's only.
- **Living knockdown get-up blends** on guests and per-muscle wound animation (stage 2 limits) are unchanged.
- **Implant parts** on friends' bodies.
- **Campaign:** mission 1's opening (briefing, cutscene, door-gunner ride) is proven in the browser; the rest of both missions has only
  the unit-tested rules behind it, not a full two-player playthrough.
