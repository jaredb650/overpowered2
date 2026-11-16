# Co-op

The plan is `docs/proposals/coop.md`. Stages 0 and 1 are built: a password lobby and players walking together in enemy-free matches.

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
