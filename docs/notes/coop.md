# Co-op

The plan is `docs/proposals/coop.md`. All five stages are built: the lobby (0), walking together (1), host-authoritative combat (2),
the Crucible fully playable (3), Endless Humans and Outpost Defense on any map, the Office included (4), and the campaign's two missions,
The Outpost and Foreclosure (5). Stage 1 and 2 sections further down are the history of how the base was laid; where they and this top
part disagree (respawn timers, free roam, the pose and snapshot formats), this top part is current.

## Playing with friends

1. Play > Multiplayer > Host a lobby. Pick a password. Send your friends the invite link (Copy link) and tell them the password.
2. Each friend opens the link, clicks once, types the password, Join. Up to four of you. Everyone can set a callsign and pick a starter gun.
3. The host picks a mode (the Crucible, Endless Humans, Outpost Defense, either on the Office, or mission 1 or 2) and presses Start.
   A five-second countdown runs on every screen; Start again cancels it.
4. Play. Tab shows the team board, Enter opens chat, E beside a downed friend revives them. Esc opens a menu over the live game.
5. When everyone is down (or the mission is won) the final board shows and everyone lands back in the same lobby. The host's
   "End match (all to lobby)" does the same at any time; a friend's "Leave match (to lobby)" steps out while the others play on,
   and "Rejoin match" takes them back.

If a friend cannot connect at all, set up TURN once (below).

## Files

| File | What |
|---|---|
| `src/net/room.ts` | The seam: `NetRoom` (named channels, peer join and leave, errors) and `LobbyRooms`. Tests pass a fake |
| `src/net/trystero.ts` | The real `NetRoom` over trystero: 8 Nostr relays, TURN when configured, a malformed message never throws into the game |
| `src/net/turn.ts` | **The TURN config slot** (`WORKER_URL`), fetching and cleaning the Worker's credentials, never hanging (4 s cap) |
| `tools/turn-worker/worker.js` | The Cloudflare Worker that mints TURN credentials. Setup below |
| `src/net/lobby.ts` | `Lobby`: players, ready, chat, ping, heartbeat, countdown, full lobby, code clash, end match and away/rejoin, every check on what peers send |
| `src/ui/screens/coop.ts`, `src/ui/css/coop.css` | Play > Multiplayer: start, host, join and lobby pages; the in-match co-op HUD styles |
| `src/net/session.ts` | Tab-local match handoff and early room reconnect across the map page load |
| `src/net/index.ts` | `CoopSession`: the game-facing session, remote bodies, poses, chat lines in the feed, leaving to the lobby, the co-op cost meter |
| `src/net/remote.ts` | A friend's body: the Bailiff with the nearest third-person prop to their gun, posture, tag |
| `src/net/pose.ts` | Binary pose codec and arrival-time interpolation buffer |
| `src/net/world.ts`, `src/net/worldProtocol.ts`, `src/net/authority.ts` | The host's world: enemy snapshots, hit claims and their checks, kill attribution, explosions, call-ins, slow-mo, prisoners, vehicles, the garrison |
| `src/net/team.ts` | Down, revive, bleed-out, spectate, respawn, the wipe, cards (health, kills, credits), rejoin purses |
| `src/net/mission.ts` | Campaign co-op: the host's mission mirrored to guests, any-player zones, gathering, checkpoints, late-joiner catch-up |
| `src/net/coopHud.ts` | Teammates strip, Tab board, Enter chat, end-of-run board |
| `src/net/*.test.ts`, `src/core/coop.test.ts`, `src/campaign/crowd.test.ts` | Unit tests over the mocked transport |
| `tools/scripts/coop-kit.mjs` | Shared steps for the two-page browser proofs, including the hidden-tab and bad-network simulators |
| `tools/scripts/coop-stage3.mjs`, `coop-modes.mjs`, `coop-mission.mjs`, `coop-robust.mjs` | The two-page proofs (below) |

Small hooks outside `src/net`, each marked with a co-op comment: `Game.ts` (which systems run where, the shared slow-mo clock, the hidden
tab's worker tick), `Player.ts` (`downed` and its crawl), `time.ts` (`keepScales`), `Hud.ts` (shops and loadout over the live world in
co-op, `mount`, quitting to the lobby), `Screens.ts`/`pause.ts` (lobby return, labels), `progression/index.ts`, `contracts/shop/index.ts`,
`contracts/defense/index.ts`, `Weapons.ts`, `runreport.ts` (a teammate's kill is not yours), `progression/score.ts` (no solo record from
a co-op run), `EnemyManager.placeReplica` (posture), `allies/fire.ts` (garrison tracers), `campaign/index.ts`, `watch.ts`, `types.ts`.

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
- **Start.** The host's Start counts down 5 s for everyone (`countdown`); Start again cancels. Ready is shown but holds nobody back.
- **Callsign** is stored in `localStorage` under `op2_coop_name`. The first default is a random `VIPER-27`.

## Connectivity: TURN setup (once, by the owner)

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
   - Optional, type **Text**, name `ALLOWED_ORIGINS`, value: your game's address, e.g. `https://yourname.github.io` (only that page
     may ask for credentials; leave it out to allow any page).
   Click **Deploy** (or **Save and deploy**).
6. Copy the Worker's address from its overview, e.g. `https://op2-turn.yourname.workers.dev`. Open it in a browser tab: you should see
   JSON starting `{"iceServers":[`. If it says a variable is not set, recheck step 5.
7. Put that address in the game: in `src/net/turn.ts` set `const WORKER_URL = 'https://op2-turn.yourname.workers.dev';`, commit and
   push. That is the only config slot; the address is not a secret (the key stays in the Worker). A build can also set `VITE_TURN_URL`.

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
| Version mismatch | "Your friend has a different version... both reload" |
| Lobby full | The fifth player is told at once ("That lobby is full: four players") |
| Code reused by another host | The newer empty lobby steps aside with "That code was already in use" |
| Stale invite link | "No lobby answered on code X ... an old invite link points at a lobby that has closed" after 30 s |
| No relay reachable | "Could not reach any of the matchmaking relays. Check your internet connection (a VPN or firewall can block them)" |
| Networks cannot link | The TURN message above |
| Host tab hidden or minimised | See below |
| Lag, loss, reordering, duplicates, clock drift | trystero's channels are reliable and ordered, so loss arrives as delay; poses and snapshots carry sequence numbers and drop old or duplicate frames; both render on the receiver's own clock 100 ms behind arrival, so clocks never need to agree; a lost `up` or bleed-out is healed by the 4 Hz team cards |
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
trystero 0.27's existing action transport is reliable/ordered: a separate unordered snapshot lane and congestion policy remain future work.

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
