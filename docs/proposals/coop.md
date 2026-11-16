# Proposal: co-op with friends

Status: research and proposal, 2026-11-15. Prices were checked on official pages the same day (section 7).

**Stage 0 built** (2026-11-15): the lobby, on trystero 0.27.0 with Nostr. Host with a password, join by code or invite link, names, ready, chat, the build check, and wrong-password errors on both ends. No TURN yet. See `docs/notes/coop.md`.

**Stage 1 built** (2026-11-15): host-selected Crucible / Endless Humans / Outpost Defense free roam, binary poses at 20 Hz through the host, tinted Bailiff bodies with callsigns and 100 ms interpolation, live Esc menus, and match departure handling. Enemy/world and shooting synchronization remain stage 2. See `docs/notes/coop.md`.

**Stage 2 built** (2026-11-16): the Crucible host now runs the waves and enemies. Guests render interpolated binary enemy snapshots,
shoot locally and submit sanity-checked hit claims through the host's existing damage model, including AP/HP and Raufoss plate hits.
Deaths, severing, wounds and enemy fire are events; enemies select among living players and host-computed damage reaches guests.
Players respawn after 3.5 seconds without stopping the world. Shops stay disabled; Endless Humans and Outpost Defense stay free roam.
Stage 3 still needs real downed/revive rules, shared pickups/economy, player rewards, shop integration and synchronized powerups/call-ins.
Remote weapon props are still the generic SMG. See `docs/notes/coop.md` for the wire format, measurements and verification limits.

## Verdict

1. **Feasible, but a big job:** about 3 to 5 months of steady work for everything. Survival co-op is the first half of that.
2. **Build it host-authoritative and peer-to-peer.** The host's browser runs the world. Each friend's browser runs their own body and guns, and tells the host what they hit.
3. **It costs $0 a month.** trystero runs the password lobby over public relays, and Cloudflare's free TURN tier (1,000 GB a month) covers the friends whose routers block a direct link. GitHub Pages stays the host. The only extra piece is one small free Cloudflare Worker that issues TURN passwords.
4. **First fun, after about 6 to 9 weeks:** 2 to 4 players in the Crucible. Endless Humans and Outpost Defense follow 2 to 4 weeks later. Campaign co-op comes last and takes 4 to 6 weeks more.
5. **The hard parts:** making enemy bodies look the same on every screen (animation, wounds, ragdolls that get back up), slow-mo and pauses (today they assume one player), and a host tab that must stay in front on an 8 GB machine.

## 1. How the game is built today, as it bears on networking

### 1.1 Loop and time

- **One loop, driven by the browser's frame callback.** `Game.run` in `src/core/Game.ts` calls `requestAnimationFrame`, ticks the clock with the real frame time, then updates every system in a fixed order: player, weapons, viewmodel, enemies, allies, waves, combat, world, gore, progression, contracts, campaign, camera, fx, audio, hud. Physics steps just before gore (`frame()`, same file). There is no fixed simulation rate: every frame is one step of whatever length the frame took.
- **Three clocks** (`src/core/time.ts`, `GameTime`):
  - `realDt` is wall time, clamped to 1/20 s.
  - `dt` is world time, slowed by slow-mo and hit-stop.
  - `playerDt` is player time. Slow-mo does not touch it, but hit-stop does.
- **Slow-mo** is a set of named requests (`pushScale`/`popScale`), and the strongest one wins. They come from:
  - the Slowmo and Time Warp powerups (`src/progression/index.ts`, `effectStarted`);
  - boss deaths (`src/enemies/bosses.ts`);
  - the fan-painting launcher's alt fire (`src/weapons/Weapons.ts`, `FAN_SLOWMO`);
  - the death grade (`src/ui/Hud.ts`, `hud-death`).

  `hitStop` is called from 13 places.
- **Pause** is one flag. `Game.setState` sets `time.paused` for any state other than `playing`, and then `dt` and `playerDt` are both 0. The run pauses under:
  - the Esc menu (`Hud.ts`);
  - Outpost Defense's shops and the Crucible's supply-pod shop ("over a paused run", `src/ui/screens/Screens.ts`, `src/contracts/shop/index.ts`);
  - the loadout screen (`src/contracts/defense/index.ts`).
- **Call-ins** run on `realDt` for timing and `dt` for their rounds (`src/progression/callins/shared.ts`, `manager.ts`). While the player flies the AC-130, they are in a gunner seat and their body is parked on the ground (`src/progression/callins/ac130.ts`, `PlayerSystem.parked` in `src/core/contracts.ts`).

### 1.2 Where game state lives

Everything is in one `Ctx` object built by `createCtx` (`src/core/Game.ts`). Every system holds the same `ctx` and reaches into the others directly.

| State | Where | Notes for networking |
|---|---|---|
| Player | `src/player/Player.ts` (2,179 lines), `ctx.player`, contract `PlayerSystem` in `src/core/contracts.ts` | Exactly one. It reads `ctx.input` directly. About 210 references to `ctx.player` across 63 files |
| Weapons, viewmodel | `src/weapons/Weapons.ts`, `Combat.ts`, `Projectiles.ts`, `melee/`, `lance.ts` | Built around the one local player and camera. Projectiles are pooled (256 max, `Projectiles.ts`) |
| Enemies and AI | `src/enemies/EnemyManager.ts`, `brain.ts`, `behaviours.ts`, `attacks.ts`; humans in `src/enemies/outpost/` (squads, planner, cover, morale); `src/enemies/commander/` | The AI reads the player through one snapshot, `PlayerSense` in `src/enemies/aiWorld.ts`, about 110 reads of `w.player`. Human soldiers can already shoot someone else through `Soldier.foe` (`src/enemies/outpost/soldier.ts`, interface `Foe`) |
| Allies | `src/allies/` | Friendly soldiers with full bodies, downed and revive rules, and a foe picker that turns enemy soldiers on them (`docs/notes/allies.md`) |
| Physics | `src/physics/Physics.ts` (Rapier) | One world. Steps follow `time.dt` with a variable timestep of up to 4 substeps |
| Gore and ragdolls | `src/gore/` | Muscle-driven ragdolls, knockdowns that get back up, severed limbs, chunks, and slicing |
| Pickups | `src/progression/pickups/` | Map spawns plus drops. Supply pods for the Crucible shop |
| Score, combo, perks, stims, call-ins | `src/progression/` | Per run. Call-ins are offered from the combo (`callins/manager.ts`) |
| Contracts and economy | `src/contracts/`: `defense/economy.ts` and `defense/data.ts` (Outpost Defense credits), `shop/` (Crucible credits) | One wallet: `ctx.contracts.wallet` |
| Campaign | `src/campaign/runner.ts` plays plain-data missions through one interface, `MissionHost` (`src/campaign/types.ts`) | Triggers ask where "the player" is (`playerAt`) and act on one player (deploy, ride, sortie, frame) |
| Saves | `localStorage` only: high scores (`contracts/scores.ts`), unlocks (`contracts/unlocks.ts`), Crucible rules (`contracts/crucible.ts`), settings and key bindings | Campaign checkpoints live in memory in the runner |

Events go through one typed bus (`src/core/events.ts`, about 80 event names such as `enemy:killed`, `enemy:severed`, `gore:impact`, `wave:start`, `player:damaged`). That bus is a natural place to send events to the other players.

### 1.3 How deterministic it is

It is not deterministic. Lockstep is ruled out for these reasons:

- The frame length varies, and so does the physics timestep (`Physics.step` divides whatever time has built up into up to 4 substeps).
- `Math.random` is called about 260 times across 79 files, mostly through `rand`, `pick` and `chance` in `src/core/math.ts`. A seeded `mulberry32` exists but only the test bots use it.
- Rapier gives the same result only with the same steps and inputs, and fully across machines only with its special deterministic build. This game uses the standard `rapier3d-compat` build.
- AI thinks are staggered by time, and timing reads go through `performance.now()` in places.

### 1.4 Peak load

| What | Cap | Source |
|---|---|---|
| Live enemies | 48 hard cap. Crucible default 48. Outpost Defense holds 20 men on foot plus crews and bosses | `src/enemies/waves.ts` `MAX_ALIVE`, `src/enemies/rules.ts`, `src/contracts/defense/waves.ts` |
| Allies | 20 | `src/allies/data.ts` |
| Simulated ragdolls | 14, about 13 rigid bodies each | `src/gore/index.ts` `GoreTuning`, `src/characters/rig.ts` |
| Living knockdowns on physics | 12 | `GoreTuning.maxKnockdowns` |
| Corpses | 40 | `GoreTuning.maxCorpses` |
| Loose limbs | 48, of which 22 simulate | `GoreTuning` |
| Gore chunks | 72 bodies | `src/gore/chunks.ts` |
| Debris | 90 moving bodies | `src/world/debris.ts` |
| Projectiles | 256 | `src/weapons/Projectiles.ts` |

At peak that is roughly 350 to 400 moving rigid bodies, on top of the static map. The frame budget on an M1 is 12 ms of CPU (`docs/DESIGN.md` section on budgets). Most of those bodies are cosmetic: gibs, chunks, debris and corpses. They do not need to match between screens, which is what keeps networking this game possible.

## 2. Architecture options

| | A. Host-authoritative peer-to-peer (WebRTC) | B. Dedicated server | C. Lockstep |
|---|---|---|---|
| How it works | The host's browser runs the world. Friends send their pose and hits, and get snapshots and events back | A Node process runs the world. Every browser is a client | Every browser runs the whole sim. Only inputs are sent |
| Cost per month | **$0**: trystero with Nostr relays, plus Cloudflare TURN's free 1,000 GB. Optional Durable Object relay: free plan, or $5 Workers Paid | $15 or more on Colyseus Cloud, about $7 to $30 on Fly.io, or €5.49 on Hetzner CPX02 (1 vCPU, 1 GB, Helsinki). 1 GB is tight for this sim | $0, same as A |
| What GitHub Pages can't do | Nothing for the game itself. One free Cloudflare Worker to issue short-lived TURN passwords (or put a free Metered key in the page) | The whole server | Same as A |
| NAT | Direct links fail for about 10 to 20% of people. TURN fixes that | None: everyone connects out to the server | Same as A |
| Latency | Direct between friends: usually 20 to 60 ms in one country. The host has zero | One region for everyone. Friends far from it pay for it | The slowest player sets everyone's delay |
| Cheating | The host can do anything, and so can a friend claiming hits. Fine among friends | Hardest to cheat | Hard to cheat, easy to desync |
| Work to build | Medium-large (section 4) | **Very large.** The sim is tied to three.js meshes, skinned bone capsules for hit tests, the character library and the world build. Only the player runs headless today (`src/player/testkit/headless.ts`). Porting the whole world to Node is months before any co-op work | **Not realistic.** Needs a fixed timestep, a seeded RNG through 79 files, deterministic Rapier, and a step-perfect rewrite of AI timing. One bit off, and the games drift apart for good |
| Host leaves | Run ends. Host migration is not worth building | Run continues | Run continues |

**Recommendation: A.** It is the only option that reuses the game as it is, keeps GitHub Pages, and costs nothing. Its weaknesses don't matter for a few friends: no host migration, the host can cheat, and the host needs a good machine.

### 2.1 The recommended stack

- **Lobby and signaling: trystero** (0.27.0, Nov 2026, actively maintained). Peers find each other through public Nostr relays (or MQTT or BitTorrent trackers), so no server of our own is needed. Its room `password` option encrypts the handshake (PBKDF2 plus AES-256-GCM). Without the password, nobody can join or even read who is in the room. That is exactly "create a private lobby, they enter a password".
  - PeerJS was the alternative. Its free cloud server has no SLA, and an open issue reports 6 to 10 minute connects. It is also slowly maintained.
- **TURN: Cloudflare Realtime TURN.** The first 1,000 GB out per month is free, then $0.05/GB. Its credentials are minted with an API key, which must not sit in a static page. A free-plan Cloudflare Worker of about 30 lines would issue them.
  - Simpler fallback: Metered Open Relay (20 GB a month free). Its key would be readable in the page. That is acceptable for a friends' game, and the key can be rotated if abused.
- **Transport:** WebRTC DataChannels in two lanes:
  - an unreliable, unordered one for snapshots and poses (`maxRetransmits: 0`);
  - a reliable one for events: kills, severs, purchases, mission beats.

  Messages are binary (`ArrayBuffer`/`DataView`), not JSON.
- **Rejected for now:**
  - **PartyKit:** the hosted platform shut down on 23 Oct 2026.
  - **A Durable Object relay** that carries all traffic: about $0 to $5 a month. Keep it as a plan B if Nostr relays prove flaky, because it also removes the NAT problem.
  - **Colyseus:** only makes sense with option B.

## 3. What has to change in the game

The key decision keeps most of the code untouched: **each browser runs its own player, weapons and viewmodel exactly as today.** The host runs everything else, and the other browsers only draw the world.

- `Player.ts` and `Weapons.ts` stay single-player. Movement is trusted from each client, which is fine among friends.
- The new seam is where a shot hurts something. On a guest, `Combat` sends a hit claim to the host instead of applying it, and the host applies it. Grenades and rockets work the same way: the guest says "my rocket burst here", and the host runs the blast.

| Topic | What exists | What changes | Size |
|---|---|---|---|
| **Other players' bodies** | No third-person player model. The player only has a first-person body layer (`src/player/moveAnim.ts`). But full soldier bodies do exist: the Bailiffs (`src/characters/archetypes.ts`) the allies wear, driven by `HumanoidAnimator` with procedural gait, crouch, aim yaw and pitch, and stances, with guns on the hand socket (smg, shotgun, sniper rifle, flamer models). | A `RemotePlayer`: a Bailiff body in a team colour with a name tag, its pose interpolated about 100 ms behind. It needs one third-person gun model per weapon family, made from a few existing models or a generic rifle at first. Slide, wall run, dash and mantle need new poses; v1 can use crouch and lean | M |
| **Enemies target the nearest player** | `PlayerSense` is one snapshot (`src/enemies/aiWorld.ts`). Human soldiers already pick other targets through `Soldier.foe`, and the allies' picker sets it (`src/allies/index.ts`, near the `prefersAlly` call) | Make `PlayerSense` a list, with a target per enemy, picked by nearest visible, sticky for a few seconds. The swarm's code (`behaviours.ts`, `attacks.ts`, `movement.ts`, `bosses.ts`) reads the enemy's own target instead of `w.player`. Quick first step for humans: a remote player is a `Foe` and joins the allies' foe picker. The Commander (`src/enemies/commander/`) tracks "the player" and needs a "most dangerous player" rule | M-L |
| **Damage to guests** | `PlayerSystem.takeDamage` | The host works out a hit on a remote body (`Foe.shotAt` already rolls misses and tests the world) and sends it to that guest. The guest applies it to its own player, so health stays client-side | S |
| **Revive and respawn** | The allies' rules are a ready template (`docs/notes/allies.md`): down at 0 health, about 45 s to bleed out, hold E for 1.1 s plus one stim to revive. | A player at 0 health goes down: prone, can still fire a pistol, and bleeds out in about 30 s. A teammate revives them with the allies' hold-E. Everyone down ends the run. In the Crucible and Endless Humans, the dead come back at the next wave. In Outpost Defense, the dead come back at the next break, for a fee from the shared fund. In the campaign, everyone down means a checkpoint restart for all | M |
| **Economy and shop** | One wallet (`ctx.contracts.wallet`). Shops pause the run | **Split personal and shared money.** Each player earns from their own kills, and wave pay goes to everyone. Weapons, ammo and mods come from the buyer's own wallet. Outpost Defense's fort items (troops, repairs, air support) can be bought by anyone and serve everyone. Shops stop pausing. The menu sits over the live game, and the break timer waits until everyone has left the shop or pressed Ready | M |
| **Slow-mo and pause** | One global clock. World slows while the player keeps full speed | Slow-mo is world-wide on the host. Whoever triggers it, every player keeps full speed, which is already how `playerDt` works. A HUD line names who triggered it. **Hit-stop becomes local only:** it freezes your camera and gun, never the host's world, or every hit by anyone would stutter the game for all. **Esc never pauses** in co-op. The world goes on, and the host's Esc shows a "pause for everyone" option only during a break. Boss-death slow-mo stays world-wide | S-M |
| **Call-ins and the AC-130** | Offered per kill from the combo (`callins/manager.ts`). The AC-130 parks the body and seats the player in the gunship | Combos and call-ins are per player. The host flies every aircraft. A guest in the AC-130 sends gun, aim and fire, and the host spawns the rounds. The rounds are slow, so latency is barely felt. The parked body stays on the ground and can be hit, and teammates can see it. Allow one AC-130 at a time | M |
| **Campaign scripting** | Plain-data missions behind `MissionHost` (`src/campaign/types.ts`). Zones are "the player is in this box". Deploy, ride, sortie and frame act on one player | The runner only runs on the host. Zone triggers get a rule per trigger: "any player" by default, "all players" for doors and gates that would split the group. `deploy` and `place` teleport everyone to marks around the spot. Cutscenes, radio lines and the villain's lines play on the host and are sent as events, so they stay in step. Rides seat each player in the gunship's seats, or the others follow. The Distraint Frame goes to one player while the rest fight on foot. Each mission needs a co-op pass of its own: tuning, extra enemies, spots where a second player could break a set piece | L |
| **Saving** | All `localStorage`, per browser. Endless Humans and Outpost Defense are `locked: true` | The host's unlocks decide what can be played. Co-op high scores get their own keys (for example `op2_highscore.crucible.coop`). A finished mission unlocks the next on every player's browser. No mid-run saves. If the host leaves, the run ends | S |
| **Build version** | Every push to dev redeploys the site | The lobby handshake carries the build hash. A friend on an old cached tab is told to reload | S |

## 4. Staged plan

Effort is in days of focused work. These are rough estimates for this codebase, and they include the playtest-and-fix rounds that the netcode will need.

| Stage | What gets built | Result | Effort |
|---|---|---|---|
| **0. Lobby and connection** | trystero room with a password. "Host co-op" and "Join" on the main menu. Invite link `?join=<code>`. Player names, ping, the build-hash check. The TURN Worker. A test page that sends pings | Friends see each other in a lobby | 3 to 5 days |
| **1. Two players walking** | The host picks map and mode, and guests load the same one. Each guest sends its pose at 20 Hz. `RemotePlayer` bodies with interpolation. No enemies yet (waves off) | Running around the Crucible together | 1 to 1.5 weeks |
| **2. Shooting and enemy sync** | Guests skip AI, waves and the director. The host sends an enemy snapshot at 20 Hz: id, type, position, yaw, aim, locomotion and stance, health band, and wound and posture flags. Reliable events: spawn, hit, wound, sever, kill (with the impulse), surrender, explosion, pickup. Guest hit claims. Remote players as enemy targets. Damage to guests. Cosmetic copies of other players' rockets and grenades. Ragdolls and gore run locally on each screen from the kill event | Shooting the same enemies together | 3 to 5 weeks |
| **3. The Crucible in co-op** | Wave and break sync. Downed and revive. Per-player credits and the supply-pod shop with no pause. Per-player combos and call-ins (strikes first, the AC-130 after). The slow-mo and hit-stop rules. Enemy count scaled (x1.5 for 2 players, x2 for 4, under the 48 cap). Co-op scores | **The first real fun, about 6 to 9 weeks in** | 1.5 to 2 weeks |
| **4. Endless Humans, then Outpost Defense** | Endless Humans: human squads' states (surrender, downed and crawling men, prisoners, executions), the Commander's between-round box shown to all, and targeting the most dangerous player. Outpost Defense: allies' sync (they are bodies like enemies), split and shared money, fort shops, repairs, tanks and choppers, and everyone at the loadout screen before the first wave | All three survival modes | 2 to 4 weeks |
| **5. Campaign co-op** | Runner on the host. Any or all player zones. Group teleport, cutscenes and the villain's lines as events. Rides, sorties and the Frame with more than one player. Checkpoint restart for all. A pass through the Outpost and Foreclosure missions in co-op | Every mission playable together | 4 to 6 weeks, plus 1 to 2 weeks per later mission |

The total is about 12 to 20 weeks. Stage 3 is the one to aim for: it is the soonest point where friends can play a full mode together, and the Crucible's swarm (no squads, no surrender, no Commander) is the simplest enemy to sync. Stages 0 and 1 are a cheap test of whether connecting works for this group of friends, so do them first and stop if they don't.

## 5. Risks and the honest hard parts

- **Enemy bodies are the real cost.** This game is its bodies.
  - Sending positions is easy. Sending what a wounded man is doing is not: clutching his throat, crawling legless, a stumble on his muscles, a knockdown and the climb back up, a surrender.
  - Each of those needs a state flag and a matching pose on the guest. Each one missed shows up as a man standing normally on a guest's screen while he crawls on the host.
  - Plan for a long tail of these fixes in stages 2 to 4.
  - Living bodies on physics (12 knockdowns at most) will look slightly different on each screen until they stand up, and then they snap to the host. That snap needs a short blend.
- **Physics sync.** Don't try. Corpses, gibs, chunks and debris run locally from the same starting push and settle in slightly different places on each screen. Nobody will notice, except for the uses that move corpses: the Black Sun's pull, and a stake pinning a body to a wall. Those send an extra event.
- **Hit registration.** The guest decides its own hits against the enemies as it sees them, about 100 ms in the past. That feels right to the shooter and costs nothing to build.
  - Downside: the host may see a hit land on a man who had just stepped behind cover. Among friends, accept it. The host only checks that the enemy still lives.
  - Headshots and severing then follow the guest's bone hit, through the existing damage path in `src/enemies/damage.ts`.
- **Hosting on an 8 GB M1.** The host runs the same game as today, plus a few remote bodies (the allies cost about 0.5 ms median for 8 in a fight, `docs/notes/allies.md`) and snapshot packing (well under 1 ms). Memory barely grows.
  - The risk is that four players shooting means more gore at once. The caps keep the cost bounded, but the 12 ms budget is already used in heavy fights.
  - Guests also run the full renderer, gore and ragdolls, so every friend needs a machine that runs the single-player game well.
  - **A hidden host tab stops the world for everyone:** browsers stop frame callbacks in background tabs, and the game already suspends audio when hidden (`src/audio/AudioEngine.ts`). Show a "host: keep this tab in front" warning, and pause everyone with a banner when the host's tab is hidden.
- **Bandwidth.** Packed binary:
  - an enemy is about 24 bytes, so 48 enemies plus 20 allies plus projectiles is about 2 KB a snapshot;
  - at 20 Hz that is about 40 KB/s (320 kbps) down per guest;
  - the host uploads that once per guest, about 1 Mbps for 3 guests, which is fine on home broadband;
  - guests send about 3 KB/s each.

  Through TURN, a 3-hour session for 3 guests is about 1.5 GB, far inside Cloudflare's free 1,000 GB. JSON would cost 5 to 10 times as much, so binary from day one.
- **Nostr relays are public and free.** One can be slow or down. trystero uses several relays at once, and MQTT or BitTorrent trackers can be added as a second strategy. If it still proves flaky, the Durable Object relay is the plan B ($0 to $5).
- **Everything assumes one player.** About 210 `ctx.player` reads across 63 files.
  - Most are fine: they are the local player on each machine.
  - The ones that matter are on the host and mean "the" player: AI, the Commander, campaign triggers, and pickups collected by distance. Find them one mode at a time, not all up front.
- **No host migration.** If the host's browser crashes, the run is lost.

## 6. Open questions for the owner

- **Q1.** How many players: 2, or up to 4? Default: design for 4, test with 2.
- **Q2.** Shared money or split money? Default: split personal money, with Outpost Defense's fort items shared (section 3).
- **Q3.** Friendly fire? Default: off. The allies already have the "CHECK FIRE" pass-through to copy.
- **Q4.** May the host pause everyone during a break? Default: yes, the host only.
- **Q5.** The villain talks to "you". In co-op, should lines address the group ("you lot") or stay as written? Default: as written, with a few group lines added later.

## 7. Sources (checked 2026-11-15)

| Item | Figure | Source |
|---|---|---|
| trystero | 0.27.0 (11 Nov 2026). Nostr, MQTT, BitTorrent, Supabase, Firebase and a self-hosted ws-relay. `password` room option with AES-GCM. `turnConfig` option. STUN included, TURN not | npmjs.com/package/trystero, github.com/dmotz/trystero |
| PeerJS | 1.5.5 (Jun 2025). Free server with no SLA. Open issue #1350 reports slow connects. No TURN | peerjs.com/peerserver, github.com/peers/peerjs/issues/1350 |
| Colyseus | 0.18.12. Cloud from $15/month. Self-host free | colyseus.io/pricing |
| PartyKit | Hosted platform shut down 23 Oct 2026. Successor PartyServer on your own Cloudflare account | blog.partykit.io/posts/hosted-platform-shutdown |
| Cloudflare Workers and Durable Objects | Free plan includes SQLite-backed Durable Objects, 100k requests a day. Paid $5/month. Incoming WebSocket messages count 20:1 as requests | developers.cloudflare.com/durable-objects/platform/pricing/ |
| Cloudflare Realtime TURN | 1,000 GB out a month free, then $0.05/GB | developers.cloudflare.com/realtime/pricing/ |
| Metered Open Relay | 20 GB/month free. Paid plans start at $99 | metered.ca/tools/openrelay/ |
| Twilio TURN | $0.40/GB in the US and Europe | twilio.com/en-us/stun-turn/pricing |
| Xirsys | Free 500 MB/month. $39 for 50 GB | xirsys.com/pricing |
| Fly.io | shared-cpu-1x: 256 MB $2.19, 1 GB $6.70 a month. $0.02/GB out. No free allowance for new organisations; bills under $5 are waived | docs.fly.io/about/pricing |
| Hetzner | CPX02: 1 vCPU, 1 GB, €5.49/month in Helsinki | hetzner.com/cloud |
| Share of connections needing TURN | 22% (callstats.io, 2016). 10 to 15% (trystero docs) | webrtchacks.com/usage-stats/ |
| Browsers | Unreliable DataChannels work everywhere. Safari 26.4 added WebTransport (Mar 2026) | webkit.org/blog/17862/ |
