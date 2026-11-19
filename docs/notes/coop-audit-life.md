# Co-op audit: the life of a session (2026-11-18, agent audit-life)

Read-only audit at `958212f` (branch `coop-overhaul`, same code as `dev` at `a5e0d38` for `src/`). It covers everything around
the fight: lobby, match start, mid-match edge cases, deaths and endings, host loss, 3 and 4 players, waves and shop breaks, cheats
and settings, timers. It builds on `docs/notes/coop-audit.md` (cited as **A1**, **A5**, **E1**, **C4**… below) and does not repeat it.

**How to read the evidence.**

- **Read** = I traced the code path; `file:line` given. Nothing in this audit was run in a browser (the brief forbids it).
- **Proved** = also shown by a scratch unit test over the lobby's fake transport:
  a scratch test that was not kept in the repo (6 tests, all passed at the time).
- **Suspected** = the code allows it, but the trigger or the size of the effect needs a browser run to confirm.

Severity: **blocker** (a session breaks or a mode cannot finish), **major** (players lose progress, get thrown out or are badly
confused), **minor**, **polish**.

Each finding ends with **Prove**: what a two-page (or three-page) browser script should assert, using `coop-kit.mjs` `startPair`
plus the stage 0a network simulator.

---

## Summary table

| # | Finding | Severity | Evidence | Main file |
|---|---|---|---|---|
| D1 | Endless Humans has no co-op ending: the host gets the solo "Run over" screen, the world freezes, guests get nothing | **blocker** | read | `src/ui/Hud.ts` |
| M1 | A network blip of about 10 s ends the match for good, with "The host left" | **blocker** | read | `src/net/lobby.ts`, trystero `peer.mjs` |
| H1 | Host loss: guests are dumped to Multiplayer's first page, room gone, nothing kept | **blocker** for "finished game" | read | `src/net/index.ts` |
| S1 | Every match starts with every player in the pause menu ("Click Resume") while wave 1 comes in | major | read | `src/ui/Hud.ts`, `src/core/Game.ts` |
| S2 | The host's map page does not know who is supposed to arrive (no roster in the handoff) | major | read | `src/net/session.ts` |
| S3 | Second match in the same room: a fast guest adopts the host's old page and is thrown out | major | **proved** | `src/net/lobby.ts` |
| S4 | Refresh (or the error panel's Reload) mid-match drops the player into a **solo** run | major | read | `src/net/session.ts` |
| S5 | A match that ends or changes while a guest loads leaves that guest in an empty or wrong world | major | read | `src/net/lobby.ts`, `src/core/Game.ts` |
| M2 | Rejoining gives back credits, score and kills only: guns, mods, implants, brain chips are gone | major | read | `src/net/team.ts` |
| M5 | A guest's shots are rejected when two arrive together (host hitch, lag burst) | major | read (effect suspected) | `src/net/authority.ts` |
| D2 | Mission won: the host's solo "complete" screen covers the co-op board; its buttons break the room | major | read | `src/ui/Hud.ts` |
| D3 | The dead miss the shop break; the downed are not brought back at wave start (docs say they are) | major | read | `src/net/team.ts` |
| W1 | The "next wave" key: a guest's does nothing but says it did; the host's skips everyone's shop time, unannounced | major | read | `src/contracts/shop/index.ts` |
| W2 | The shop break is 25 s of real time for the whole team; solo it waits while you shop. The shop screen says it waits | major | read | `src/contracts/shop/index.ts`, `src/ui/screens/procurement.ts` |
| L2 | A joining guest is closed by **another** guest's failed connection or wrong password | major (3-4 players) | **proved** | `src/net/lobby.ts` |
| S8 | trystero's own 4-user cap counts stale and old-page peers: a rejoin into a full lobby can be refused | major (4 players) | suspected | `src/net/trystero.ts` |
| T1 | Host below 20 fps: the shared world runs in slow motion for everyone | major | read | `src/core/time.ts` |
| L3 | Callsigns are not unique; purses are kept by callsign | minor | **proved** / read | `src/net/team.ts` |
| L4 | Slots (colour, spawn, tag) change between lobby and match, and from match to match | minor | **proved** | `src/net/lobby.ts` |
| M3 | Rejoining is a free revive at full health | minor | read | `src/net/team.ts` |
| M4 | A late joiner in survival modes gets no wave banner, no pod in a break | minor | read | `src/net/world.ts` |
| M6 | A stalled main thread (sleep, lid, long hitch) closes the room as "lost" before queued messages are read | minor | **proved** | `src/net/lobby.ts` |
| M9 | "End match (all to lobby)" is one click; "Restart from checkpoint" shows in co-op | minor | read | `src/ui/screens/pause.ts` |
| S6 | Fast guests can time out waiting for a host who is waiting for a slow guest's ack | minor | read | `src/net/lobby.ts` |
| L1 | Join/Open can be submitted twice | minor | read (effect suspected) | `src/ui/screens/coop.ts` |
| L7 | Join/leave feed lines are doubled; a late join reads joined, joined, left, left, joined | minor | read | `src/net/index.ts` |
| W5 | The host's custom Crucible rules apply to everyone silently; guests' boss banner reads their own rules | minor | read | `src/enemies/waves.ts` |
| C1 | Cheats work for any player in co-op and nobody is told | minor | read | `src/lab/index.ts` |
| others | L5, L6, L8, L11, L12, S7, S9, M7, M10, M11, D4-D6, D9, C5, C7, T2, T3 | minor / polish | read | see below |

---

## 1. Lobby

### L1. Join and Open lobby can be submitted twice — minor (effect suspected)

- **Today.** `CoopScreen.submit()` guards with `if (this.lobby) return` (`src/ui/screens/coop.ts:357`), but `this.lobby` is only set
  in `attach()` after three awaits: `reportLobby` (`:370`), `import('../../net/trystero')` (`:377`, a network fetch the first
  time) and `openLobby` (`:378`, up to 4 s once TURN is configured, `src/net/turn.ts:18`). Enter in the password field
  (`:134`), the menu's Join item and the "Join lobby" button (`:151`) all call it. Nothing disables them meanwhile.
- **Why it matters.** Two presses make two `Lobby` objects. For a guest both are on the same code and password; the second
  replaces the first in the UI but the first is never left. Its 30 s `HOST_WAIT_MS` timer (`src/net/lobby.ts:186`) then closes
  and calls `room.leave()` (`:665`). If trystero hands both the same room object (its room registry looks like it does,
  `@trystero-p2p/core/dist/strategy.mjs:108-121`), the live lobby loses its room 30 s after joining and ends 20 s later with
  "Lost the connection to the host". Not run.
- **Fix.** A `busy` flag in `submit()` set before the first await and cleared in `attach`/`fail`; grey the buttons while it is set.
- **Prove.** On the join page press Enter twice within 50 ms; wait 60 s in the lobby; assert the guest is still `phase: 'open'`
  and the host's list still has it.

### L2. A joining guest is closed by another peer's error — major for 3-4 players (proved)

- **Today.** trystero joins every browser to every other (a mesh), though the game only uses guest-to-host links
  (`src/net/lobby.ts:173`, `:393-395`). trystero reports a failed connection or a failed password check to whichever end noticed,
  with the far peer's id (`@trystero-p2p/core/dist/signal-handler.mjs:233-254`). A guest's `netError` ignores that id: while it
  is still `connecting`, **any** error closes it (`src/net/lobby.ts:614-615`).
  - Guest C joins while guest B (already in) is behind a router C cannot reach directly: if that failure is reported before the
    host's hello arrives, C closes with "Couldn't connect", though its link to the host was fine or still coming.
  - Guest C joins while someone else is typing the wrong password: C can be told "Wrong password".
- **Proved:** `life.test.ts` "a joining guest is closed by ANOTHER guest's failed connection or wrong password".
- **Why it matters.** With two players it cannot happen; with three or four it turns one bad pair, or one typo, into a
  failure for an innocent player. The message blames the wrong thing.
- **Fix.** `src/net/lobby.ts` `netError` for a guest: do not close on `connect`, `password` or `full` at once. Remember it as
  the *pending reason* and let the join go on; the host's hello clears it. Close with `password` only on the door's word
  (`:589-591`, the host is the one who knows) and open the door at once on a decrypt failure rather than after 5 s. Close with
  `full` only on the host's own `full` message (`:523`). If no host arrives by `HOST_WAIT_MS`, close with the pending reason.
- **Prove.** Three pages. Give page C a network rule that blocks UDP to page B only. C joins: assert C reaches the lobby and
  the host lists three players.

### L3. Callsigns are not unique, and purses are kept by callsign — minor (proved / read)

- **Today.** The host takes any name up to 16 characters (`src/net/lobby.ts:460`, `:503`); two players can both be `VIPER-27`
  (proved: "two players may hold the same callsign"). The host keeps "a guest's purse by callsign" (`src/net/team.ts:107`,
  written every card at `:240`, read at `:335-339`).
- **Why it matters.** Same-name players are indistinguishable on the board and in "X IS DOWN" lines. If one of them rejoins,
  they get whichever purse was written last, maybe the other player's. A new player who picks the name of someone who left
  inherits that purse. A guest who renames while "away" in the lobby loses theirs.
- **Fix.** Host: on `hello` and `set`, make names unique (`VIPER-27` → `VIPER-27 (2)`). Key purses by the browser id that hello
  already carries (`src/net/lobby.ts:131-134`, `:456-459`), not the name. See P3.
- **Prove.** Two guests with the same callsign join: assert the host's list shows two different names. Guest A earns credits,
  closes the tab, rejoins under a new name: assert the purse comes back.

### L4. Slots change between lobby and match — minor (proved)

- **Today.** A slot is the first free of 1-3 at the moment a guest's hello arrives (`src/net/lobby.ts:471`). The match page
  builds a new `Lobby` that starts with the host alone (`:182`, `src/net/session.ts:50`), so slots follow the order the map
  pages reconnect (proved: "slots are handed out by arrival order on the map page"). Slot decides the tag and body colour
  (`src/net/remote.ts:8`, `:56`; `src/net/team.ts:488`), the spawn (`src/net/team.ts:207`) and the side-step at marks
  (`src/net/mission.ts:35-38`).
- **Why it matters.** "You were blue in the lobby and are orange now", and a different colour again next match. Small, but it
  is the kind of thing a finished game does not do. A rejoining guest can also come back in another colour.
- **Fix.** Put the roster (browser id → slot, name) in the handoff (S2) and have the host reserve each seat's slot.
- **Prove.** Three pages; make the second guest's map page load first; assert each player's slot equals its lobby slot.

### L5. The host's mode pick goes back to Crucible after every match — polish

- **Today.** `CoopScreen.mode = 0` on every page (`src/ui/screens/coop.ts:83`); the match page is a fresh page, and `attach()`
  sends `MODES[0]` as the pick (`:408`). After a round of Endless Humans on the Office the picker shows Crucible.
- **Fix.** `adopt()` sets `this.mode` from the match just played (`resumedMatch` in `src/net/session.ts:11`).
- **Prove.** Play Endless Humans on the Office, end the match: assert the lobby's selected mode is still that.

### L6. While the host waits for start acks the lobby looks idle — minor

- **Today.** After `startMatch` the host waits for every guest's `started` (`src/net/lobby.ts:287-289`, `:406-411`). A guest that
  never acks holds it until the 20 s silence rule or a peer-leave removes it (`:221`, `:575-576`). Meanwhile `match` is set, so
  the status still reads "Hosting · n of 4" and Start only beeps (`countdown` returns false at `:299`,
  `src/ui/screens/coop.ts:143`, `:303-308`).
- **Fix.** Status "Starting · waiting for NAME"; give acks 5 s, then go without them (they get `start` again on hello, `:479`).
- **Prove.** Three pages, freeze one guest's main thread at the countdown's end: assert the host's page has left within 6 s.

### L7. Join and leave lines are doubled in the match feed — minor

- **Today.** The lobby posts "X left." as a chat line (`src/net/lobby.ts:574`), which the session puts in the feed
  (`src/net/index.ts:95-98`); then the roster change feeds "X left." again (`:87`). Same for joins (`lobby.ts:476`,
  `index.ts:88-90`) and for stepping out ("X went back to the lobby." plus "X left.", `lobby.ts:516`, `index.ts:79`, `:87`). The
  feed does not dedupe (`src/ui/hud/feed.ts:34`).
  A late join is worse: the newcomer's lobby page says hello, then navigates to the map, then says hello again as a deployed
  page, which posts nothing (`lobby.ts:476-477`). Everyone reads: "X joined the match in progress." "X joined." "X left."
  "X left." "X joined."
- **Fix.** One source: drop the roster-diff lines in `index.ts:87-90` and let the lobby's own lines speak; do not post "left"
  for a peer that leaves within the handoff window of a `start` it was just sent; post "X is in" when its first card arrives
  (`src/net/team.ts:235`).
- **Prove.** Late-join a third page: assert the other two feeds got exactly "X is joining…" then "X joined."

### L8, L11, L12 — polish

- **L8.** A guest whose host connected but never said hello (host tab frozen or still loading) times out at stage `version`,
  which maps to `no-host`: "Lobby not found…" (`src/net/lobby.ts:186`, `:228-233`). It should say the host is not answering.
- **L11.** A brand-new player without the invite link cannot reach Multiplayer: their first Play goes straight to Retraining
  (`src/ui/screens/mainmenu.ts:95`). The link is the intended way in; the lobby's "Code" line could say "send the link, not the code".
- **L12.** The invite code is stripped from the URL when the join page opens (`src/ui/screens/coop.ts:199`), so a reload there
  (the error panel has a Reload button, `src/ui/errorReport.ts:15`) lands on the splash with no code.

---

## 2. Match start

A1/E1 in `coop-audit.md` cover the load race itself. These are the parts E1 needs that it does not mention.

### S1. Every player starts every match in the pause menu — major

- **Today.** The match page is a fresh page, so it has no click to its name. `startGame` calls `hud.startRun()`
  (`src/core/Game.ts:320`), which asks for the mouse (`src/ui/Hud.ts:397`). The browser refuses without a gesture; after
  `LOCK_RETRY_FOR` = 1.7 s the HUD calls `pause()` with "Click Resume to take the mouse back" (`src/ui/Hud.ts:79`, `:497-506`).
  The co-op world is live under it, and the first wave starts 3 s in (`src/enemies/waves.ts:17`, `:149`). `docs/notes/coop.md:310`
  admits the Resume click. Solo deploys already solve this with the splash's "Click to deploy" (`src/ui/screens/splash.ts:25-36`).
- **Why it matters.** The first thing every match shows is a menu, and enemies are already walking at a player who cannot move.
- **Fix.** Make the load barrier (E1) end in a click: each player's page shows "Click to deploy" when it has loaded; the click
  takes the mouse and sends `loaded`; the host starts the wave clock when all are in (or after the timeout). One mechanism
  fixes the barrier, the mouse and the audio unlock.
- **Prove.** Start a match with real clicks only in the lobby. Assert no page shows `.scr-pause` in the first 10 s after its
  deploy click, and that `waves.wave` is still 0 on the host until both pages have clicked.

### S2. The host's map page does not know who is coming — major (design gap for E1)

- **Today.** The handoff holds code, password, name, hosting, match and starter (`src/net/session.ts:8`). The host's new
  `Lobby` starts with `players = [host]` (`src/net/lobby.ts:182`) and learns of a guest only when that guest's map page says
  hello. So "wait for every match player" (E1) has nothing to wait on, cannot name who it waits for, and cannot tell "still
  loading" from "never coming".
- **Fix.** Add `roster: { browser, name, slot }[]` to the host's handoff in `deployMatch` (`src/net/session.ts:19-23`); the new
  host `Lobby` pre-seats them as `loading`. The barrier lists them by name; L4 and P3 fall out of the same change.
- **Prove.** Three pages, one guest's map page throttled to load 40 s late: assert the host shows "Waiting for NAME" and
  starts the waves only when it arrives or the timeout says so.

### S3. Second match in the same room: a fast guest is thrown out — major (proved)

- **Today.** During the page change a guest's new page must ignore the host's old page. That is done with a `deployed` flag
  (`src/net/lobby.ts:447-449`). The flag is set once, in the constructor (`:156`, `src/net/session.ts:50`), and the same `Lobby`
  object is then kept for the lobby page after the match (`src/net/index.ts:162`, `src/ui/screens/coop.ts:389-396`). So from the
  second match on, **every** lobby is `deployed`, and the rule tells nothing apart.
  If any guest is slow to ack (S6), a faster guest's new page meets the host's old page, is admitted by it (`:466-479`), adopts
  it as host, boots the map, and is closed with `host-left` the moment the old page navigates.
- **Proved:** `life.test.ts`, first match → the fast guest stays `connecting` (correct); second match → `open`, then
  `error: 'host-left'`.
- **Why it matters.** "Play again" with three or four players can kick someone at every start after the first. With two
  players the window is the host's own navigation time, so it is rare but not impossible on a slow connection.
- **Fix.** Replace the boolean with the match id the page was built for: hello carries `page: <match id> | null`. A map-page
  guest adopts only a host whose `page` equals its own match id; a host with a pending start and `page !== match.id` ignores
  hellos whose `page === match.id`. Reset to `null` when the lobby goes back to the lobby page (`endMatch`, `end`, `away(false)`).
- **Prove.** Three pages, two matches back to back, with the third page's main thread stalled 3 s at each start: assert all
  three are in match two.

### S4. Refresh mid-match becomes a solo run — major

- **Today.** `reconnectMatch()` removes the handoff from `sessionStorage` as it reads it (`src/net/session.ts:37`). The URL keeps
  `?contract=<mode>&starter=<gun>` (`:27-30`). A refresh therefore boots that mode **solo**, silently
  (`docs/notes/coop.md:309` says "Refresh after the handoff is consumed leaves the match"). The handoff is put back only when
  the boot itself fails (`src/main.ts:37`, `src/net/session.ts:61-65`). The fatal error overlay's Reload (WebGL context lost, out
  of memory: `src/core/capture.ts:6`, `:32-36`, `src/ui/errorReport.ts:15`) does the same.
- **Why it matters.** F5 is every player's first answer to a glitch. A guest who presses it is alone in a solo wave with no
  hint why, and must go back through the menu, the code and the password. A host who presses it ends the match for everyone
  and also lands solo.
- **Fix.** Keep the handoff for the tab's life: `reconnectMatch` leaves it in `sessionStorage` and only `clearSession()` (quit,
  leave, host-left) removes it. A guest's reload then rejoins on its own (the host's twin rule replaces the old seat,
  `src/net/lobby.ts:455-458`). If the rejoin fails, land on Multiplayer with the reason, never in a solo run. Add a
  `beforeunload` prompt while a match is live. For the host see H1.
- **Prove.** Guest reloads mid-wave: assert within 30 s it is back in the same match with `ctx.coop` set and its credits
  restored; assert it never reaches `state: 'playing'` without `ctx.coop`.

### S5. A match that ends or changes while a guest is loading — major

- **Today.** Between `reconnectMatch()` and the `CoopSession` constructor (the whole boot) the lobby's `onMatch` and `onEnd`
  are the default no-ops (`src/net/lobby.ts:111`, `:122`; the session sets them at `src/net/index.ts:38-42`).
  - The host ends the match (or the team wipes and 15 s pass) while a late joiner loads: `end` sets `match = null`
    (`lobby.ts:528-532`) and nothing else. The guest finishes loading; `Game.ts:318` only checks `phase === 'closed'`; it starts
    a run in an empty world that receives nothing (`gameplay` needs `match`, `lobby.ts:385`, `:391`). It looks like a broken solo game.
  - If the host then starts another match, the loading guest acks it (`lobby.ts:534-540`) and never deploys. It finishes
    building the **old** match's map while its lobby now passes the **new** match's snapshots into it.
- **Fix.** `reconnectMatch()` installs its own `onEnd`/`onMatch` at once and records what happened; `startGame` checks before
  `startRun`: ended → lobby page with "The match ended while you were loading"; a different match → `deployMatch` again.
- **Prove.** Late-join a slow-loading page, end the match from the host during its load: assert the guest lands on the lobby
  page with that note, not in a run.

### S6. Fast guests can time out on a host that is waiting for a slow guest — minor

- **Today.** Extends A1. A guest's new page arms `HOST_WAIT_MS` = 30 s (`src/net/lobby.ts:83`, `:186`). The host's old page does
  not navigate until every ack is in, and a dead guest holds that for up to 20 s (`:221`); then the host's own page must
  load and reconnect. 20 s + a slow load passes 30 s, and every fast guest closes with `no-host`, shown as "The host left or
  the room could not reconnect" (`src/core/Game.ts:318`).
- **Fix.** The 5 s ack limit of L6, and E1's suspended timers on the map page.
- **Prove.** As L6, asserting the fast guest is in the match.

### S7, S9 — minor / polish

- **S7.** If the host's `sessionStorage` write throws, the host leaves the lobby (`src/ui/screens/coop.ts:410-416`), but the
  guests have already navigated and now wait 30 s for nobody. Check storage is writable before sending `start`.
- **S9.** `reconnectMatch()` runs before `showLoading()` (`src/core/Game.ts:294-295`), so once TURN is configured the page is
  blank for up to 4 s (`src/net/turn.ts:18`). Show the loading screen first.

### S8. trystero's own four-user cap — major for 4 players (suspected)

- **Today.** The room is opened with `maxUsers: MAX_PLAYERS` (`src/net/trystero.ts:70`). trystero counts its own connected
  peers, per browser, and rejects the next one with "room full" (`@trystero-p2p/core/dist/room.mjs:609-612`, `:645-648`,
  `:937-945`). The rejected side reports `room-full`, which the lobby maps to `full`, and a guest still `connecting` closes
  (`src/net/trystero.ts:93`, `src/net/lobby.ts:615`).
  trystero's count is not the lobby's count. It includes peers the lobby has already dropped but WebRTC has not (a closed
  lid: trystero keeps the peer until ICE fails), and during a page change it can include old pages and new pages at once.
- **Why it matters.** With four players, someone who drops and comes straight back can be told "That lobby is full: four
  players" while their own ghost holds the seat. At match start a new page may be refused by a page that still counts four.
- **Fix.** Give trystero headroom (`maxUsers: 8`) and let the lobby's own check be the only cap (it already is one,
  `src/net/lobby.ts:466-470`); with L2's change a non-host `full` no longer closes a joining guest.
- **Prove.** Four pages in a lobby; kill one page's network without closing it; open a fifth page with the same callsign and
  browser profile: assert it is admitted (twin rule) rather than "full".

---

## 3. Mid-match

### M1. A network blip of about 10 s ends the match — blocker

- **Today.** trystero closes a peer 5 s after its connection reports `disconnected` and stays so
  (`@trystero-p2p/core/dist/peer.mjs:8`, `:344-350`); the browser reports `disconnected` after a few seconds without
  connectivity checks (not measured here; about 5 s in Chrome). The close reaches the lobby as a peer-leave:
  - a guest closes with `host-left` at once (`src/net/lobby.ts:563-566`) and the session ends with "The host left. The co-op
    match has ended." (`src/net/index.ts:72-77`), which is false: the host is still there;
  - the host removes the guest (`lobby.ts:568-576`).
  The lobby's own 20 s silence rule (`SILENCE_MS`, `:90`) never gets its say. Nothing tries to reconnect, though both pages
  are alive and trystero would re-announce them.
- **Why it matters.** A Wi-Fi roam, a router hiccup or a VPN reconnect ends a 40-minute run for that guest, or for everyone
  if it was the host's line. This is the single biggest "not a finished game" behaviour in the session layer.
- **Fix (stage 1 of the overhaul).**
  1. Guest, in a match: a host peer-leave or silence starts **"Reconnecting to host… 30"** instead of closing. Keep the room
     open, freeze replicas where they are, keep the local player alive but untargeted. If a hello from a host on the same match
     id arrives, resume; if the count runs out, go to H1's ending.
  2. Host: a guest's peer-leave marks the seat **lost** for 60 s ("NAME lost connection") instead of deleting it: slot, life,
     purse and kit stay, the body is hidden and not targeted (M11). A hello with the same browser id takes the seat back.
  3. Tell the truth in the messages: "left" only for a real quit (send a `bye` on `leave()`), "lost connection" otherwise.
- **Prove.** Two pages mid-wave; drop all packets between them for 12 s, then restore: assert both are still in the same
  match with the same wave, the guest's credits and guns unchanged, and the feed said "lost connection" then "is back".

### M2. Rejoining gives back credits, score and kills only — major

- **Today.** The host's `restore` sends `credits`, `score`, `kills` (`src/net/team.ts:335-339`); the guest applies exactly those
  (`:276-283`). The rejoining page is a fresh page: bought guns, fitted mods, implants, brain chips, perks, streak progress,
  grenades, ammo and armour are gone, and the player holds the starter gun. They also must retype code and password (S4).
- **Why it matters.** At wave 8 a dropped friend comes back with a wave-1 kit and a purse. "Lose their progress" in the brief.
- **Fix.** Add a small `kit` to the guest's card every few seconds: owned weapons, mods owned and fitted, implants, brain
  chips, grenades, reserves. The host stores it with the purse (by browser id) and sends it in `restore`; the guest applies it
  through the same calls the shop uses (`src/contracts/shop/index.ts` → `Weapons`, `progression.loadout`, `ChipRack`).
  The host should clamp it against what the wave allows (`lockWave`), as it clamps cards (`src/net/team.ts:76-85`).
- **Prove.** Guest buys a gun and a mod in a break, closes its tab, rejoins: assert the gun, the mod and the credits are back.

### M3. Rejoining is a free revive — minor

- **Today.** Lives are kept by lobby id (`src/net/team.ts:89`, `:134-138`), which is the trystero peer id; that id is new on
  every page load (`identity: 'none'`, `src/net/trystero.ts:70`). The host deletes the old id's life (`team.ts:361`) and the
  rejoiner's new one starts `up`. A dead player who reloads is back mid-wave at full health.
- **Fix.** Seats by browser id (P3): a rejoiner inherits the seat's life; dead stays dead until the team's next respawn.
- **Prove.** Guest bleeds out, rejoins: assert its card says DEAD until the respawn rule fires.

### M4. A late joiner in survival modes misses the wave's one-shot facts — minor

- **Today.** The arrival catch-up sends only mission state and dropped guns (`src/net/world.ts:111`). The wave number and
  phase come with the next snapshot (`:449`), but no `wave:start` or `wave:clear` is replayed (`src/net/team.ts:116-121`). So
  the newcomer has no wave banner or count, no supply pod if it arrived in a break (the pod is called on `wave:clear`, A5),
  no Commander box state, and in Outpost Defense none of the fort's state. This is the "late join catch-up" of overhaul stage 1.
- **Fix.** On `onArrived` send one `sync` event: wave, phase, seconds left, whether a break is on. The guest replays the
  matching `wave:start`, or calls its pod if a break is on.
- **Prove.** Join during a break: assert the newcomer's pod lands and its shop opens.

### M5. Guest shots are rejected when two arrive together — major (logic read; size of effect suspected)

- **Today.** The host accepts a guest's `fire` only if it arrives at least `interval × 0.65` after that guest's previous one,
  measured on the **host's arrival clock** (`src/net/authority.ts:60-61`). A hit claim is valid only for the accepted shot
  (`:73`). Events arrive together whenever the host's thread was busy (a long frame, a hidden host ticking at 30 Hz or less),
  or the reliable channel releases a burst after a lost packet (C4), or the guest's tab was hidden. Then the second shot of an
  automatic gun is refused and every hit of it is counted in `stats.rejected` (`src/net/world.ts:274-275`) and thrown away.
- **Why it matters.** Under exactly the conditions the owner calls "lag", a guest's bullets stop counting. It reads as "my
  gun does nothing", with blood already drawn on the guest's screen.
- **Fix.** A token bucket per guest in `acceptFire`: shots are earned at the gun's rate, up to a burst of about one second's
  worth, and each accepted `fire` spends one. Order is still checked by the shot sequence.
- **Prove.** Stall the host's main thread 300 ms while the guest holds the SMG's trigger on a dummy: assert
  `world.stats.rejected` stays 0 and the dummy's health fell by every round fired.

### M6. A stalled main thread closes the room as "lost" — minor (proved)

- **Today.** Extends A1 beyond loading. The 20 s rule compares `performance.now()` with the last message heard
  (`src/net/lobby.ts:204-221`). After a stall (laptop sleep, lid, a debugger pause, a GPU driver reset), the heartbeat timer can
  run before the queued messages are read. It sees 20 s of silence and closes, though the peer never went quiet.
- **Proved:** `life.test.ts` "a stalled main thread…".
- **Fix.** `heartbeat` keeps its own last-run time; if more than about 5 s passed since it last ran, the thread was away: reset
  every `heard` to now and judge again on the next beat.
- **Prove.** Freeze the guest's page 22 s (CDP `Emulation.setCPUThrottlingRate` or a blocking loop), release: assert it is
  still in the match.

### M7, M8. Hidden tabs and open menus are invisible to the team — minor / polish

- **Today.** A guest's hidden tab keeps posing through the worker tick (`src/core/Game.ts:198`, `:221-239`): its body stands
  still, is still a target, and nobody is told. Only the host's hidden tab is announced (`src/net/index.ts:99-104`). A player in
  the Esc menu, the shop or the loadout also stands still under fire (`src/core/Game.ts:118-119`, `:153-154`), by design.
- **Fix.** One pose bit "away" (hidden tab or a menu open): the tag reads "NAME · in a menu" / "tabbed out". Cheap, and it
  stops "why is he just standing there".
- **Prove.** Guest opens the shop: assert the host's tag over the guest reads the note.

### M9. One-click "End match", and a dead "Restart from checkpoint" — minor

- **Today.** The host's pause item "End match (all to lobby)" ends the run for four players on one click
  (`src/ui/screens/pause.ts:19`, `:51`; `src/ui/Hud.ts:456-465`). In a mission the pause menu still lists "Restart from
  checkpoint" in co-op (`pause.ts:27`, only "Restart run" is filtered at `:52`). On a guest it does nothing (the runner is
  idle: `src/campaign/runner.ts:159-161`, `src/campaign/index.ts:130-141`). On the host it rebuilds the host's run
  (`game.newRun()`, `campaign/index.ts:134`) with no notice to guests and without `respawnAll` (only the team-wipe path calls
  it, `src/net/team.ts:464-471`).
- **Fix.** Confirm "End match" the way Force start is confirmed (two presses). In co-op hide "Restart from checkpoint" for
  guests; for the host, route it through `Team.checkpoint()` with a feed line.
- **Prove.** Click "End match" once: assert the match is still on. Guest pause menu in mission 1: assert no checkpoint item.

### M10, M11 — minor

- **M10.** A prisoner's bounty is taken from the host's purse when the drone secures him and sent to the captor
  (`src/net/world.ts:148-155`). If the captor has left (or rejoined under a new id), the send reaches nobody and the credits are
  simply gone. Check the captor is still seated before debiting; with seats (P3) pay the seat.
- **M11.** A vanished guest's body stays as a target and counts as `up` for the wipe check until it is dropped
  (`src/net/world.ts:506-553`, `src/net/team.ts:351-363`). With M1's "lost" seat state, exclude lost seats from both.

### Two players doing the same thing at once — robust (see section 10)

Dropped guns, revives and captures are all judged by the host and the loser's request is dropped cleanly. One gap, polish:
the loser gets no feedback (the hold ring completes and nothing happens; the take prompt just goes). A one-line callout
("NAME got there first") would do.

---

## 4. Death and endings

### D1. Endless Humans has no co-op ending — blocker

- **Today.** When the Commander dies the HUD runs the solo ending: `commander.onFulfilled` → `Hud.fulfilled()`
  (`src/ui/Hud.ts:178`, `:376-381`), with no co-op check (the death path has one at `:368`). After 2.6 s `updateDeath` emits
  `run:end`, calls `game.setState('gameover')` and shows the solo "Run over · Contract fulfilled" screen (`:515-533`).
  - `setState('gameover')` pauses the host's clock (`src/core/Game.ts:119`), so the shared world freezes on every screen.
  - Guests get no `over` event: the team only sends one for a wipe or `campaign:complete` (`src/net/team.ts:123-128`,
    `:363-368`). They stand in a frozen, empty map with no board and no word.
  - The host's screen offers "Run again" (`src/ui/screens/gameover.ts:30`), which runs `game.newRun()` on the host alone: the
    host restarts at wave 1 while the guests keep their state; and "Menu", which ends the match.
- **Why it matters.** Endless Humans ends at round 10 by design. In co-op the win is the one moment that must work, and it
  is the one path nobody wired.
- **Fix.** In `Hud.fulfilled()` (and `onDeath`) when `ctx.coop?.world`: never start the solo beat. The host calls a new
  `team.finish(won: true, title: 'CONTRACT FULFILLED')`, which sends `over` and shows the co-op board on every screen
  (`src/net/coopHud.ts:111-123` already takes `won`). The Commander's last words can still play first on every screen (mirror
  `commander:fulfilled` as an event).
- **Prove.** `coop-modes.mjs` humans: jump to wave 10 (`jumpTo`), kill the Commander with the guest. Assert both pages show
  the final board with the win headline, the host's `game.state` is never `gameover`, and both return to one lobby.

### D2. Mission won: the host's solo screen covers the board — major

- **Today.** `campaign:complete` fires both the team's `over(won)` (`src/net/team.ts:123-128`) and the solo `fulfilled()`
  (`src/ui/Hud.ts:253`). Half a second later (`MISSION_BEAT`, `:77`) the host's state is `gameover` and the solo "complete"
  screen is up over the co-op board. Its buttons: "Play again" (host-only `newRun()`), and the Endless Humans unlock button,
  which navigates the host's page away and so closes the room (`src/ui/screens/complete.ts:34-41`). Guests see the right board.
  After 15 s the host is pulled back to the lobby anyway (`src/net/coopHud.ts:78`).
- **Fix.** The same guard as D1.
- **Prove.** Finish mission 1 with two pages (or emit `campaign:complete` on the host): assert the host shows `.cq-end` and
  not `.scr-complete`.

### D3. The dead miss the shop; the downed are not brought back — major

- **Today.**
  - The dead return on `wave:start` (`src/net/team.ts:116-120`). The supply pod and its shop exist only during the break and
    need a living player (`src/progression/pickups/pods.ts:201`, `readSupply`). So anyone who died in wave N cannot spend
    before wave N+1: they come back as the next wave begins, with credits and nothing to do with them.
  - Only `state === 'dead'` is respawned (`team.ts:119`). The comment on `TeamLife.respawn` (`:53`) and
    `docs/notes/coop.md:176` both say "the dead (and anyone still down)". A player who fell in the last 30 s before the wave
    starts stays down, bleeds out early in the new wave, and then sits out all of it.
- **Why it matters.** Dying already costs the rest of the wave. Losing the shop as well, and sometimes a whole second wave,
  makes one death snowball; it is the opposite of what the shared wave bonus intends (`team.ts:10-12`).
- **Fix.** Bring back the dead **and the downed** on `wave:clear`, at the start of the break (the usual rule in wave shooters:
  everyone shops together). Keep `wave:start` as a second pass. One line in `team.ts`, plus the pod call for a player who was
  dead when `wave:clear` fired. This is a co-op-only rule; solo is untouched. **Owner's call**, recommended.
- **Prove.** Guest bleeds out mid-wave; clear the wave: assert the guest is up within 1 s of `wave:clear` and can open its pod.

### D4, D5, D6, D9 — minor / polish

- **D4.** Going down runs the solo death clean-up: perks cleared, call-in seat left, brain chip toggles off
  (`src/progression/index.ts:365-373`, `src/contracts/chips.ts:453-458`). A revive 3 s later gives back none of it. Probably
  right, but it is a rule nobody chose: worth one line from the owner.
- **D5.** A player who joins during the 15 s end board loads into a finished world (the team stops sending cards once
  `final` is set, `src/net/team.ts:343`) and is pulled out seconds later. Hold `start` for late hellos while the board is up.
- **D6.** The wipe check counts everyone in the lobby list who is not "away" as `up`, including a guest still loading
  (`src/net/team.ts:351-354`). With all real players dead the run idles until the loader arrives alone. Count only arrived seats.
- **D9.** "BLED OUT · back next wave" and "WATCHING X · back next wave" (`src/net/team.ts:357`, `:449`) are shown in missions
  too, where there are no waves and the dead wait for a checkpoint. Say "back at the next checkpoint" there.

### Spectating, the end board, back to lobby — work as described

Read and found consistent: spectate cycles living teammates on Fire (`team.ts:430-450`), the board shows for 15 s or the
host's Enter (`coopHud.ts:56`, `:74-79`), everyone lands in the same lobby unready (the map page's lobby is a new object, so no
stale READY), and a second match starts through the same handoff (but see S3).

---

## 5. Host loss

### H1. What each guest sees and keeps today — blocker for "finished game"

- **Today.** Any loss of the host's peer (quit, crash, refresh, a blip per M1, the one-tab takeover) closes the guest's lobby.
  `CoopSession.roster()` ends the session, leaves the room and clears the handoff (`src/net/index.ts:72-77`, `:134-162`); the
  HUD goes to the menu and Multiplayer's **start** page with one red line (`src/ui/Hud.ts:456-465`,
  `src/ui/screens/Screens.ts:110-115`, `src/ui/screens/coop.ts:471-475`). Kept: nothing. No board, no score, no room. To play
  on, someone hosts a new lobby with a new code and everyone retypes a password.
- **Least bad without migration** (in order of cost):
  1. **Grace first** (M1): most "host left" events are blips.
  2. **End with dignity.** When the host is really gone, freeze the world and show the co-op board ("HOST LOST · wave 7")
     with each player's own numbers, for 10 s. Every guest already has the cards (`team.cards`).
  3. **Regroup on the same code.** Every guest still knows the code and password (`resumedRoom`, `src/net/session.ts:13`).
     After the board, the lowest surviving slot opens a host lobby on that same code and password; the others join it as
     guests, automatically. The code-clash rule already makes a newer empty host step aside (`src/net/lobby.ts:453`). Everyone
     lands together in a lobby with "The host dropped. NAME is hosting now." and can start again with one click. The old host
     can come back with the same invite link and join as a guest.
- **What real migration would need.** The world lives only on the host: enemy AI state, squads and morale, the wave
  director (wave, spawn queue, rules), the Commander's director (adaptations, tricks, tracker), the mission runner (beat,
  triggers, checkpoint), vehicles, the garrison, the fort, prisoners, dropped guns. Guests hold 45 bytes per enemy (C3). A
  true hand-over means serialising all of that and waking the wave and AI systems on a browser that skipped them at boot
  (`src/core/Game.ts:102-112`).
  A **soft migration** is realistic for the Crucible only: the new host wakes its skipped systems (the late-init path exists
  for "solo after co-op", `Game.ts:136-139`), calls `waves.jumpTo(currentWave)` (`src/enemies/waves.ts:154-159`), clears the
  replicas, and the current wave restarts from its beginning under the new host; every player keeps their own guns and
  purse, which already live in their own browsers. Endless Humans (Commander state) and missions (checkpoint restart) would
  need more. Size: large; do it only after 1-3.
- **Prove.** Close the host's page mid-wave with two guests: assert both guests show the board, then both are in one lobby
  on the old code with one of them as host, within 20 s.

### H2. The one-tab takeover kills a hosted match without a word — polish

"Play here instead" in another tab makes the running tab reload (`src/core/oneTab.ts:71`). If that tab hosts a match, the
match ends for everyone. The notice could say "A co-op match is running in the other tab; switching ends it."

---

## 6. Three and four players

### P1. What assumes one guest

Nothing in `src/net` hard-codes one guest: relays loop over players (`world.ts:243`, `:252`, `:271`, `:363`), cards and poses are
per slot. The problems are at the edges, and all are above: **L2** (mesh errors), **S8** (trystero's cap), **S3** (second
match), **L4** (slots), **L6/S6** (one slow ack holds everyone). None has been run with three pages; the overhaul's rig should
make a three-page `startTrio` the default for session tests.

### P2. The guest-to-guest mesh is paid for and unused — minor

trystero links every pair (six links for four players); the game sends guest traffic through the host
(`src/net/lobby.ts:173`, `:393-395`). The extra links cost handshakes and keep-alives, and cause L2 and S8. Either keep them
quiet (L2, S8 fixes) or later use them for poses to save the host hop (C4).

### P3. One player, three keys — minor, but the root of M2, M3, L3, L4

Per-player state is keyed by lobby id (lives, `arrived`, adapters, the validator, captors, last hitter, slow-mo:
`team.ts:89`, `:111`; `world.ts:63-73`, `:86`), by slot (cards, poses, every event's `slot`), and by callsign (purses,
`team.ts:107`). The lobby id changes on every page load, the slot changes with arrival order, callsigns clash.
**Fix:** a host-side `Seat` keyed by the browser id from hello (`lobby.ts:131-134`), holding slot, name, life, purse, kit and
"lost since". The lobby id becomes just the seat's current connection.

### P4. Balance with four — owner question, not a bug

Waves do not scale with player count (nothing in `src/enemies/waves.ts` or `rules.ts` reads it), every player gets full wave
pay and their own pod. Four players will flatten the early game. "Preserve the game" says leave it; worth one decision.

---

## 7. Waves, breaks and the shop

### W1. The "next wave" key — major

- **Today.** `CrucibleShop.update()` runs on every browser. On the key it sets its own `waves.nextWaveIn = 3` and feeds
  "NEXT WAVE CALLED IN" (`src/contracts/shop/index.ts:80-83`), with no co-op check.
  - Guest: the write lands on the guest's copy of `ctx.waves`, which the next snapshot overwrites (`src/net/world.ts:449`). The
    message is a lie; nothing was called in.
  - Host: the break is cut to 3 s for everyone. No other screen is told. A friend mid-purchase loses the break.
- **Fix.** In co-op the key is a **ready vote**: a guest sends `{ t: 'ready' }`; the host cuts the break when every living
  player has voted; the feed says "NAME is ready (2/3)". The host's own key is a vote like anyone's.
- **Prove.** Host presses the key while the guest's shop is open: assert `nextWaveIn` on the host is unchanged and the feed
  on both shows the vote. Both press: assert the break drops to 3 s.

### W2. The break is real time for a team, and the shop screen says otherwise — major

- **Today.** Solo, opening the shop pauses the run (`src/ui/Hud.ts:431-441`, `src/core/Game.ts:119`), so the break lasts as long
  as you shop. In co-op nothing pauses, and the break is the host's 25 s (`SUPPLY_BREAK`, `src/contracts/shop/data.ts:44`,
  stretched at `shop/index.ts:76-79`) for walking to your pod, waiting for it to land and open, and buying. The shop screen
  still reads "Break. Wave N in X s, **when you leave**." (`src/ui/screens/procurement.ts:178`). When the wave starts the pod is
  retired (`pods.ts:201`) but the shop screen stays up and nothing warns the player standing in it.
- **Why it matters.** Co-op players get a fraction of solo's shopping time and are told the clock is waiting. With four
  players and four pods this is the difference between "we kit up together" and "I never get to buy the mod".
- **Fix (co-op only).** A longer team break (suggest 45 s; boss break 60 s) with W1's vote to cut it short; the shop screen
  shows the live count "Wave 6 in 12 s" in co-op and closes itself with a callout at 0; the teammates strip shows who is
  shopping (M7's bit). **Owner's call on the numbers.**
- **Prove.** Guest opens its shop 5 s into a break and stays: assert the screen's text counts down in real time and the
  screen closes when the wave starts.

### W3. The final wave — see D1

### W5. Custom rules — minor

The host's saved custom Crucible rules run the shared world (`src/enemies/waves.ts:138`, `src/ui/Hud.ts:399`): start wave,
enemy health, break length. Guests are not told, and a guest's boss banner picks "titan" or "juggernaut" from its **own**
saved rules (`src/ui/Hud.ts:359`). Show "Custom rules" in the lobby next to the mode, and send the boss kind in the `wave` event.

### W6. Mission checkpoints — needs a playthrough

A team wipe sends the host through `campaign.restart()` → `game.newRun()` on the host only (`src/net/team.ts:464-471`,
`src/campaign/index.ts:130-141`), then gets everyone up beside the host. Guests' runs are not rebuilt: their kit, corpses and
local pickups carry over while the host's are reset to the checkpoint. I found no crash path by reading, but
`docs/notes/coop.md:587-588` says no full two-player mission has been played; the first wipe-at-checkpoint proof should check
guest kit, doors, objectives and dropped guns afterwards.

---

## 8. Cheats, settings, first launch, one tab, error reports

- **C1. Cheats in co-op — minor.** The panel's world actions are off in co-op (`src/lab/index.ts:49-50`, `:132`, `:354`,
  `:371`), but "the player's own kit stays": god mode, every weapon with infinite ammo, granted call-ins and perks, combo,
  mods, implants and brain chips work for any player (`src/lab/settings.ts:15-19`, `src/lab/index.ts:91-93`, `:108-122`), and
  their claims pass the host's checks (`src/net/authority.ts:83-87`). Nobody is told. For friends that is fine as a choice, not
  as a secret: send a `cheats` bit in the card, tag the player "CHEATS" in the lobby, on the strip and on the final board.
- **C2. Per-player settings — robust.** Quality, FOV, sensitivity and bindings are local and never sent; nothing in the net
  code reads them. The one-tab lock keeps two tabs from clobbering the saved settings.
- **C3. Reasons are lost at the end of a session too.** A1 covers the boot path (`Game.ts:318`). In a running match
  `roster()` has words for two of the nine close reasons and a generic line for the rest (`src/net/index.ts:72-77`). Use
  `errorText()` (`src/ui/screens/coop.ts:494-508`) in both places. Remote error logging is off until `WORKER_URL` is set
  (`src/net/turn.ts:11`); the local "Copy error report" works.
- **C4. TURN absent — known.** `WORKER_URL = ''` (`src/net/turn.ts:11`). Each added player adds a host pair that may need it.
  The owner's one-time setup is in `docs/notes/coop.md`.
- **C5. First launch and an invite link — works.** The link skips the splash and Retraining (`src/ui/screens/splash.ts:28-31`,
  `src/ui/screens/mainmenu.ts:95`). Afterwards the browser counts as "played" (`mainmenu.ts:119-124`), so a friend whose first
  game was co-op is never offered Retraining. A "New here? Controls" card in the lobby would cover it. Polish.
- **C6. One-tab lock — robust**, with H2's missing warning.
- **C7. A push during a session — minor.** A guest who reloads after a deploy gets the new build and is refused by the
  running host ("both of you hard reload", `src/net/lobby.ts:462-465`, `:484-487`); the host cannot reload without ending the
  match. Say so in the message, and push when nobody is playing.

---

## 9. Timers and clocks in the net code

`CLAUDE.md` bans `performance.now()` and `setTimeout` in gameplay. The net code uses real time on purpose (peers' clocks and
world clocks differ). The table lists every rule and what a stalled or hidden main thread does to it.

| Rule | Where | Clock | Under a stall / hidden tab |
|---|---|---|---|
| Guest waits for the host: 30 s | `lobby.ts:83`, `:186` | `setTimeout` | Armed during the map boot (A1); S6 |
| No relay: 10 s | `lobby.ts:85`, `:187` | `setTimeout` | Fine |
| Door knock: 5 s | `lobby.ts:87`, `:188` | `setTimeout` | Fine |
| Heartbeat, ping: 2 s | `lobby.ts:88`, `:200`, plus every frame `index.ts:108` | `setInterval` + frame | Hidden: the worker tick keeps it going in a match; on the lobby page the timer is throttled to 1 s, still fine |
| Silence: 20 s | `lobby.ts:90`, `:214`, `:221` | `performance.now()` vs last message | **M6**: fires on the first beat after a stall |
| Start countdown: 5 × 1 s | `lobby.ts:91`, `:315-319` | `setInterval` | A stalled host counts late; guests only mirror the number |
| Code clash: older host wins | `lobby.ts:130`, `:453` | `Date.now()` of each host | A host with a wrong system clock wins or loses wrongly; harmless |
| Force start arm: 4 s | `coop.ts:434-436` | `performance.now()` + `setTimeout` | Fine |
| Poses: 50 ms, no burst | `index.ts:114-115`, `pose.ts:2` | `performance.now()` | Designed for it |
| Pose buffer: 100 ms behind | `pose.ts:59-90` | arrival time | Fine |
| Team cards: 250 ms | `team.ts:30`, `:344-348` | `performance.now()` | Fine |
| Bleed-out: 30 s | `team.ts:24`, `:43`, `:61-65`, `:306` | `performance.now()` on the host | Real time: not slowed by shared slow-mo. After a host stall longer than what was left, the player dies at once on resume. **T3** |
| End board: 15 s | `coopHud.ts:112`, `:74-78` | `performance.now()` | Host hidden: the worker tick still fires it |
| Snapshots: 100 ms, frame-gated | `world.ts:666-667` | `performance.now()` | C1 in the earlier audit |
| Vehicles, garrison: 200 ms | `world.ts:657` | same | Fine |
| Kill attribution kept 3 s | `world.ts:662` | same | A host stall over 3 s between kill and replay loses "who"; harmless |
| Shared slow-mo cap: 8 s | `world.ts:176`, `:258` | real time | Good: a dropped guest cannot leave the world slow |
| Booms 24/s, garrison tracers 30/s | `world.ts:44`, `:377-381`, `:758-760` | per wall second | Fine |
| Enemy blast delay | `world.ts:538-539`, `:663-665` | **real time** | **T2** |
| Line-of-sight cache 200 ms, routes 1.2 s | `world.ts:568-569`, `:592-595` | real time | Fine |
| Fire dedupe 20 ms, phantom-shot window | `world.ts:198`, `:212` | real time | Fine |
| Fire pace per guest | `authority.ts:60-61` | host arrival time | **M5** |
| Shot valid 8 s, call-in window 240 s, area 160/s, Gun Kata | `authority.ts:27-29`, `:50`, `:59`, `:73`, `:77-81` | host arrival time | A stall over 8 s drops the claims queued behind it |
| TURN fetch 4 s, cache 1 h | `turn.ts:18`, `:22`, `:52` | `setTimeout`, `Date.now()` | Fine |
| Hidden-tab tick 33 ms | `Game.ts:221-239` | worker `setInterval` | The remedy itself |
| World step clamp: 50 ms | `time.ts:76` | frame | **T1** |
| trystero: drop a peer 5 s after `disconnected`; ICE gather 15 s | `peer.mjs:6`, `:8`, `:344-350` | `setTimeout` | **M1** |

### T1. A host below 20 fps runs the world in slow motion for everyone — major

- **Today.** `GameTime.tick` clamps a frame to 1/20 s (`src/core/time.ts:76`). Solo that is the right guard. In co-op the host's
  world is everyone's: at 10 fps it advances 50 ms per 100 ms, so enemies, waves and break timers run at half speed on every
  screen, while each guest's own body and guns run at full speed (their own `playerDt`). The hidden-tab tick (30 Hz) is just
  inside the clamp.
- **Fix.** In co-op the host sub-steps: when a frame is long, run the simulation systems two or three times with a fixed
  step, up to a budget, before rendering once. Also put the host's fps in its card so the strip can show "host lagging"
  instead of leaving guests to guess.
- **Prove.** Cap the host page at 8 fps for 10 s: assert the host's `time.elapsed` advanced at least 9 s, and a guest-side
  replica crossed its lane at normal speed.

### T2. Enemy blast delays run on real time — minor

`Foe.blast` queues `performance.now() + delay` (`src/net/world.ts:538-539`) and fires from `update()` (`:663-665`). Under shared
slow-mo the grenade the guest watches is slowed four times but its blast is not. Count the delay down with `ctx.time.dt`.

### T3. Bleed-out ignores slow-mo and stalls — minor

Bleeding uses the host's real clock (`src/net/team.ts:43`, `:61-65`). Probably intended (a fair 30 s), but with M1's
reconnect grace a downed player whose host froze for 10 s should get those seconds back. Pause the bleed while the host is
"reconnecting".

---

## 10. Correct and robust today — do not "fix"

- **Wrong password is told on both ends**, through the door room when trystero only tells the host
  (`src/net/lobby.ts:579-600`, `:605-609`; tests in `lobby.test.ts`). Passwords never enter URLs or game messages
  (`src/net/session.ts:3`, `:24`).
- **Version mismatch, a full lobby, a reused code, no relays** each have their own clear message
  (`src/ui/screens/coop.ts:494-508`), and the join status names the stage that stalled (`lobby.ts:228-233`).
- **Guests trust only the host.** Lobby and gameplay lanes drop anything not from the host (`lobby.ts:443`, `:388`); the host
  stamps slots on relayed poses and shots (`lobby.ts:171-173`, `world.ts:269`); a guest cannot forge a start (`lobby.test.ts:512`).
- **A duplicate or late `start` never resets a live run** (`lobby.ts:535-536`).
- **Ready rules:** Start refuses with who is not ready; going unready or a new join stops the count (`lobby.ts:305-308`,
  `:338-342`); Force start needs two presses (`coop.ts:431-441`). Everyone is unready again after a match (new lobby object).
- **Starter gun:** a player's own pick wins over the host's lagging list (`session.ts:20-22`).
- **The same browser twice** replaces its old seat (`lobby.ts:455-458`), and one tab runs the game (`core/oneTab.ts`).
- **Junk from a peer cannot throw into the game:** per-message try/catch at the transport and in `CoopWorld.receive`
  (`trystero.ts:79-82`, `world.ts:226-230`), every card clamped (`team.ts:76-85`), the fuzz test (`world.test.ts:401`).
- **Races are judged by the host and the loser is dropped cleanly:** a dropped gun's take (`src/weapons/dropped.ts:178-184`),
  a revive (`team.ts:244-248`, with the reach check `:299-303`), a capture (`world.ts:695-698`). Supply pods are each player's own.
- **Life generations** drop damage meant for an earlier life (`team.ts:66`, `world.ts:293`), and the 4 Hz cards heal a lost
  bleed-out or down (`team.ts:254-268`, `:289-296`).
- **Shared slow-mo cannot stick:** a guest's request is capped at 8 s real time and cleared when it ends (`world.ts:176`,
  `:256-260`).
- **Hidden tabs keep the world alive** (`Game.ts:221-239`), and poses never burst after a stall (`index.ts:115`).
- **Stepping out to the lobby and "Rejoin match"** works and is tested (`lobby.ts:366-371`, `:513-518`; `lobby.test.ts:493`).
- **Every snapshot is the whole living list,** so a rejoiner's enemies are right at once and a stale replica goes after
  500 ms (`world.ts:450-486`). Enemy uids never restart on the host (`src/enemies/EnemyManager.ts:160`, `:247`), so a guest's
  tombstones cannot hide a new enemy.
- **A boot failure or a failed code chunk puts the handoff back,** so that reload rejoins (`src/main.ts:37`,
  `session.ts:61-65`). (Only the boot: see S4.)
- **Lab world actions and time keys are off in co-op** (`lab/index.ts:132`, `:354`, `:371`).
- **A co-op run never writes a solo record,** and a teammate's kill never pays or scores for the host (`world.ts:165-169`).

---

## 11. Decisions for the owner

1. **D3:** bring the dead and the downed back when the wave is cleared (so everyone shops), not when the next one starts?
   Recommended.
2. **W1, W2:** team break length (suggest 45 s, boss 60 s) and a ready vote on the next-wave key? Recommended.
3. **H1:** after a real host loss, auto-regroup everyone in a new lobby on the same code with the next player as host?
   Recommended. Soft migration for the Crucible later, if wanted.
4. **P4:** leave waves and pay unscaled for 3-4 players ("preserve the game"), or scale?
5. **D4:** going down clears perks and a running call-in seat even if revived at once. Keep?
6. **C1:** show a "CHEATS" tag on a player who has them on?

---

## 12. The ten fixes I would do first

1. **Endings go through the team board** (D1, D2). In co-op never enter `gameover`; Endless Humans' win and a mission's win
   send `over(won)`. Small. `src/ui/Hud.ts`, `src/net/team.ts`.
2. **Deploy gate = load barrier + click** (S1, S2, with E1). Roster in the handoff; "Click to deploy" per player; waves held
   until all are in or the timeout names who is not. `src/net/session.ts`, `src/net/lobby.ts`, `src/core/Game.ts`, `src/ui/Hud.ts`.
3. **Reconnect grace and seats by browser id** (M1, M3, M11, L3, L4, P3). "Reconnecting to host… 30" on guests, a "lost" seat
   for 60 s on the host, honest "left" vs "lost connection". `src/net/lobby.ts`, `src/net/index.ts`, `src/net/team.ts`.
4. **Reload rejoins, never solo** (S4). Keep the handoff for the tab's life; `beforeunload` in a live match.
   `src/net/session.ts`, `src/main.ts`.
5. **Match id in hello instead of the `deployed` flag; handle `end` and `start` during a load** (S3, S5, S6, L6).
   `src/net/lobby.ts`, `src/net/session.ts`, `src/core/Game.ts`.
6. **Other peers' errors never close a joining guest; trystero's cap raised; submit guarded** (L2, S8, L1).
   `src/net/lobby.ts`, `src/net/trystero.ts`, `src/ui/screens/coop.ts`.
7. **Team break rules** (D3, W1, W2): respawn at wave clear, ready vote, longer break, an honest shop clock. Needs the owner's
   yes. `src/net/team.ts`, `src/contracts/shop/index.ts`, `src/ui/screens/procurement.ts`.
8. **Kit comes back on rejoin** (M2), and late joiners get a wave `sync` (M4). `src/net/team.ts`, `src/net/world.ts`.
9. **Host loss ends with a board and regroups on the same code** (H1). `src/net/index.ts`, `src/ui/screens/coop.ts`.
10. **Fair under lag:** token-bucket fire check (M5), stall-proof heartbeat (M6), host sub-stepping below 20 fps (T1).
    `src/net/authority.ts`, `src/net/lobby.ts`, `src/core/Game.ts`.

Then the small ones in one pass: real reasons everywhere (C3), one set of join/leave lines (L7), confirm on End match and no
dead pause items (M9), the mode pick remembered (L5), menu/tabbed-out tags (M7), cheats tag (C1), mission wording (D9).

## Not checked

- Nothing was run in a browser: every "read" finding needs its proof script before and after the fix.
- trystero behaviours marked suspected (L1's shared room, S8's counts during a page change, the exact seconds before a
  browser reports `disconnected` in M1) come from reading `node_modules/@trystero-p2p/core/dist`, not from a run.
- Outpost Defense's own ending and fort state for guests, and how many player spawns each map has (four players may stack
  where a map has fewer; `team.ts:207` wraps by slot), were not traced.
- Safari and Firefox background-tab behaviour.
