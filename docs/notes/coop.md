# Co-op

The plan is `docs/proposals/coop.md`. Stages 0–2 are built: a password lobby, remote players, and host-authoritative Crucible combat.
The historical stage 1 sections below describe its enemy-free baseline, not the current Crucible.

## Files

| File | What |
|---|---|
| `src/net/room.ts` | The seam: `NetRoom` (named channels, peer join and leave, errors) and `LobbyRooms`. Tests pass a fake |
| `src/net/trystero.ts` | The real `NetRoom` over trystero. Loaded only when someone hosts or joins (its own 150 KB chunk) |
| `src/net/lobby.ts` | `Lobby`: players, ready, chat, and every check on what peers send. Room codes, invite links, callsigns |
| `src/net/build.ts` | `BUILD`, the short commit hash, from `define` in `vite.config.ts` (`GITHUB_SHA` on Pages) |
| `src/ui/screens/coop.ts`, `src/ui/css/coop.css` | Play > Multiplayer: start, host, join and lobby pages |
| `src/net/lobby.test.ts` | Join, leave, host leaving, wrong password both ways, version mismatch, no host, forged messages |
| `src/net/pose.ts`, `src/net/pose.test.ts` | Binary pose codec and bounded arrival-time interpolation buffer |
| `src/net/index.ts`, `src/net/remote.ts` | Game-facing co-op session, remote Bailiff bodies, animation, tags and departure feed |
| `src/net/session.ts` | Tab-local match handoff and early room reconnect across the existing map page-load path |
| `src/net/session.test.ts` | Remote lifecycle and startup tag order, host loss and send-rate tests |
| `src/core/coop.test.ts` | Solo pause parity, live co-op menus, free-roam gates and solo restoration |
| `tools/scripts/coop-stage1.mjs` | Two real WebRTC peers: start, movement both ways, live Esc, guest quit, late rejoin, host quit and solo restoration |
| `tools/scripts/coop-lobby.mjs` | Two pages of one browser over the real relays: host, join by link, wrong password, chat, host leaves |

## How it works

- **trystero 0.27.0, pinned**, with its default strategy, Nostr: peers meet through public Nostr relays, then talk browser to browser
  over WebRTC. `appId` is `overpowered-2-coop`, the room id is the code, and `identity: 'none'` stores nothing and makes each tab its own
  player. `maxUsers` is 4.
- **Code and password.** The host picks the password, and the game picks a 6 character code (no 0, O, 1, I or L). The password is
  trystero's room `password`: it encrypts the handshake, so the relays only ever carry hashed topics and encrypted offers.
  The only things sent between players are callsigns, ready flags, chat, the build id, match configuration and game poses. Passwords stay in the handshake and tab-local storage; they never enter the game messages or invite URL.
- **Invite link:** `<page>?join=CODE`. The splash click goes straight to the join page with the code filled in, and the `?join` is
  stripped from the address bar.
- **Host-authoritative.** The host keeps the player list and sends it to each guest, with that guest's own id. Guests only send to the
  host: `hello` (build and name) when they connect, `set` (name, ready) and `chat`. The host puts the sender's name on each chat line.
  Joins and leaves show as amber lines in the chat. Names are 16 characters and chat lines are 160, with control characters stripped.
- **Build check.** Every peer says `hello` with `BUILD` on connect. A guest that meets a host on another build stops with "your friend
  has a different version (theirs X, yours Y), both reload". The host gets a line saying who could not join.
- **Wrong password.** trystero reports `decrypt-failed` only to the peer that received the offer, and which peer that is depends on how
  the two peer ids compare. So about half the time only the host knows. For those cases there is a **door**: a second room, `CODE-door`,
  with the code as its password. The host opens it with the lobby. A guest still not in after 5 s (`DOOR_AFTER_MS`) joins it. A peer has
  the same id in both rooms, so the host can tell that guest "wrong password" there. In the browser the error showed after 8 to 10 s
  either way. A guest with the right password is in within about 3 to 4 s and never opens the door.
- **No answer.** A guest that hears from no host in 30 s stops with "no lobby answered": a wrong code, a host who left, or a network that
  needs TURN.
- **Connection state.** The status line reads Connecting, Connected or Hosting, with the player count. A guest leaving is a chat line.
  When the host leaves, the guests go back to the Multiplayer page with "The host left".
- **Mode picker.** Only the host sees it. Start deploys everyone into free roam on the chosen mode's map. Ready is informational in stage 1.
- **Callsign** is stored in `localStorage` under `op2_coop_name`, wrapped in try/catch. The first default is a random `VIPER-27`.
- Typing in a field never drives the menu: `Screens` ignores keys whose target is an input, and Esc in a field only leaves the field.

## Limits: no TURN yet

The browsers have STUN only, so a friend behind a strict router, mobile data or some office networks may never connect. The UI
says so on the start and join pages, and a connect failure says the relay server is not set up. Proposal section 2.1 has the numbers.

**TURN plugs in at `turnConfig` in `src/net/trystero.ts`** (`openRoom`): a list of `{ urls, username, credential }`. The plan is a free
Cloudflare Worker, about 30 lines, that mints short-lived Cloudflare Realtime TURN credentials from an API key. `openLobby` fetches them
before it joins. Metered Open Relay with a key in the page is the quicker fallback.

## Stage 1: starting and running a match

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

## Stage 2: Crucible shooting and enemies

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

### Remaining stage 3 work

- Replace timed respawn with downed/revive rules, player corpse presentation, team wipes and deliberate respawn/loadout policies.
- Share and arbitrate pickups, powerups, credits, shop access, score/kill attribution and per-player rewards. Currently the host
  earns combat progression, while guests are shooters with their local issued kit; pickups and world props are not replicated.
- Synchronize call-ins, perk effects and a shared slow-mo policy; provide a host-hidden-tab banner/pause protocol.
- Finish living knockdown/get-up transitions, matching third-person weapons, projectile/explosion presentation and late-join state.
- Add TURN, real multi-machine/four-player latency testing, transport backpressure, and production concurrency/disconnect hardening.
