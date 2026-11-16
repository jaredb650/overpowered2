# Co-op

The plan is `docs/proposals/coop.md`. Stage 0 is built: the lobby. Nobody plays a mode together yet.

## Files

| File | What |
|---|---|
| `src/net/room.ts` | The seam: `NetRoom` (named channels, peer join and leave, errors) and `LobbyRooms`. Tests pass a fake |
| `src/net/trystero.ts` | The real `NetRoom` over trystero. Loaded only when someone hosts or joins (its own 150 KB chunk) |
| `src/net/lobby.ts` | `Lobby`: players, ready, chat, and every check on what peers send. Room codes, invite links, callsigns |
| `src/net/build.ts` | `BUILD`, the short commit hash, from `define` in `vite.config.ts` (`GITHUB_SHA` on Pages) |
| `src/ui/screens/coop.ts`, `src/ui/css/coop.css` | Play > Multiplayer: start, host, join and lobby pages |
| `src/net/lobby.test.ts` | Join, leave, host leaving, wrong password both ways, version mismatch, no host, forged messages |
| `tools/scripts/coop-lobby.mjs` | Two pages of one browser over the real relays: host, join by link, wrong password, chat, host leaves |

## How it works

- **trystero 0.27.0, pinned**, with its default strategy, Nostr: peers meet through public Nostr relays, then talk browser to browser
  over WebRTC. `appId` is `overpowered-2-coop`, the room id is the code, and `identity: 'none'` stores nothing and makes each tab its own
  player. `maxUsers` is 4.
- **Code and password.** The host picks the password, and the game picks a 6 character code (no 0, O, 1, I or L). The password is
  trystero's room `password`: it encrypts the handshake, so the relays only ever carry hashed topics and encrypted offers.
  The only things sent between players are callsigns, ready flags, chat and the build id.
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
- **Mode picker.** Only the host sees it, and it is shut: "Co-op gameplay comes in the next stage."
- **Callsign** is stored in `localStorage` under `op2_coop_name`, wrapped in try/catch. The first default is a random `VIPER-27`.
- Typing in a field never drives the menu: `Screens` ignores keys whose target is an input, and Esc in a field only leaves the field.

## Limits: no TURN yet

The browsers have STUN only, so a friend behind a strict router, mobile data or some office networks may never connect. The UI
says so on the start and join pages, and a connect failure says the relay server is not set up. Proposal section 2.1 has the numbers.

**TURN plugs in at `turnConfig` in `src/net/trystero.ts`** (`openRoom`): a list of `{ urls, username, credential }`. The plan is a free
Cloudflare Worker, about 30 lines, that mints short-lived Cloudflare Realtime TURN credentials from an API key. `openLobby` fetches them
before it joins. Metered Open Relay with a key in the page is the quicker fallback.

## For stage 1

- Add channels through `NetRoom.channel(name)`. trystero carries `ArrayBuffer`s as they are, so a binary pose and snapshot channel is
  another `channel<ArrayBuffer>('pose')`.
- `Lobby.players` ids are trystero peer ids, except the host's own row, which is `host`.
- No ping is shown yet. trystero has `room.ping(peerId)` when it is wanted.
