# Co-op netcode: how horde shooters make a guest feel like the host

Research note, 2026-11-18. No game code was changed. Code references are to the repo at `da2ff4c`. The code audit is a separate
job (`docs/notes/coop-audit.md`); this note is about how other games do it, and touches our code only to make the advice concrete.

## The short answer

Killing Floor 2 does what the owner remembers. The server owns health, death and which body parts are gone. For each hit it sends a
small **"what just hit me"** record: location, direction, damage type, bone, and an "obliterated" flag. Every machine runs the whole
gore system itself from that record: blood, wounds, dismemberment, ragdolls, gibs and decals. Corpses stop being networked the
moment they die. Each player's own detail settings decide how much gore *they* keep. Nobody streams gore.

**Our co-op already has that shape.** The host sends `hitfx`, `sever` and `kill` events, and the guest runs its own gore from them
(`src/net/world.ts:317-345`). The guest's poor experience comes from the details around that shape:

1. **Guest gore is weaker by construction.** The host wounds at the real severity (`amount / maxHealth`, or 1 for blasts,
   `src/enemies/damage.ts:456`). The guest always uses a fixed `0.6` (`world.ts:323`) and never runs `updateMaim`.
2. **A sever can arrive "empty".** The snapshot's sever mask goes on the `world` channel and the `sever` event goes on the
   `action` channel. Two channels have no shared order. When the snapshot wins, the guest severs the limb with a dummy hit
   (1 damage, pointing straight up, `world.ts:479-482`). The limb drops off with no force and no spray, and the real event is then
   ignored because the region is already gone.
3. **The guest's own hits wait a round trip.** A guest's shot calls `claim()`, which returns a predicted result but draws no blood
   (`EnemyManager.ts:862`, `world.ts:203-225`). The blood comes back with the host's `hitfx`, 50-250 ms later.
4. **Enemy motion has no jitter buffer.** Each snapshot starts a 100 ms blend from where the replica *is* to the newest state
   (`world.ts:462`, `:497`). That is a buffer of zero snapshots on a 10 Hz feed, over a reliable, ordered channel. Any late packet
   freezes the crowd, then makes it jump. Valve and Gaffer both say to buffer two packets' worth.
5. **Other players' weapons are one generic tracer.** `drawFire` draws a bullet tracer, a flash and a sound for every weapon
   (`world.ts:414-430`). A beam like the Lance has no remote version, so nothing is drawn.
6. **Slow-mo never reaches the guest's own effects.** `docs/research/coop-slowmo.md` already covers this: there is no host-to-guest
   slow message.

So the fix is not a rewrite. It is about eight focused jobs, listed in section 6. Together they make each guest a full gore
renderer that the host feeds with rich events, as Killing Floor 2 does.

---

## 1. Killing Floor 2 (Unreal Engine 3)

**Sources.** Tripwire shipped KF2's UnrealScript game code with its SDK. A public mirror of the final version (1150) is
[GenZmeY/KF2-Game-Scripts](https://github.com/GenZmeY/KF2-Game-Scripts), and every file and line below is from it. The native C++ parts
(the server's hit checks, corpse rating) are not public. I found no Tripwire GDC talk on netcode or gore. The gore system was
presented to the press as M.E.A.T. ("Massive Evisceration And Trauma"), with 19 to 22 dismemberment points per zed and blood that
stays all match ([PC Gamer](https://www.pcgamer.com/killing-floor-2-gore-system), [GamesBeat](https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/),
[Shacknews panel](https://shacknews.com/article/87441/killing-floor-2-panel-discusses-increased-gore-and-more)).

### What the server owns, and what each client simulates

| Thing | Who decides | How it reaches clients |
|---|---|---|
| Health, damage, death | Server only (`TakeDamage`) | Death is a "tear off", see below |
| Which zones are wrecked | Server | `InjuredHitZones`, an int bitmask, reliable and repnotify (`KFPawn.uc:305`, set at `KFPawn_Monster.uc:4097`) |
| The look of the last hit | Server records it | `HitFxInfo` struct, see below. Each client plays it |
| Dismemberment, head pops | Each client | Client sees the zone bit plus the hit, then calls `PlayDismemberment` itself (`KFPawn_Monster.uc:3435`) |
| Ragdolls | Each client | On death the pawn is **torn off** (`bTearOff`, `KFPawn.uc:3322`). Replication stops and each client ragdolls its own copy (`PlayRagdollDeath`) |
| Gore on corpses | Each client | `PlayDeadHitEffects` keeps dismembering a corpse locally for 3 s after death, or forever with `bAllowRagdollAndGoreOnDeadBodies` (`KFPawn_Monster.uc:3432`) |
| Blood decals, gibs, corpse count | Each client's settings | `KFGoreManager` is config-driven. `MaxDeadBodies` is 8, 12 or 15 by detail preset (`KFGFxOptionsMenu_Graphics.uc:3473-3475`). Decal caps and lifetimes are per player. A dedicated server skips all of it (`KFGoreManager.uc:144`, `:186`) |
| Zed attacks, grabs, stumbles | Server | `ReplicatedSpecialMove` {move enum, other pawn, flags byte}, repnotify. Each client plays the move's animation itself (`KFPawn.uc:673-694`) |
| Knockdowns | Server | `KnockdownImpulse` is replicated, and the client ragdolls the stumble |

### The hit record (`HitFxInfo`, `KFPawn.uc:193-232`)

```
HitLocation, EncodedHitDirection   // "Momentum is only replicated as a normalized HitDir. Momentum transfer is handled server-side"
DamageType                          // a class: the client looks up how this weapon's hits look
HitBoneIndex                        // the hit zone
bRadialDamage, bObliterated         // blast, and "turn him into chunks"
DamagerPRI                          // who did it, for special effects
+ RadiusDamageScale, RadiusHurtOrigin   // blasts only, for ragdoll impulses
+ HitFxAddedRelativeLocs[7], HitFxAddedHitCount   // extra pellets this frame, relative to the first
```

Points worth copying:

- **One record per pawn per frame, plus up to 7 extra pellet hits** as offsets from the first. That is how a shotgun blast shows
  eight wounds without eight messages.
- **A replication timeout.** `HitFxInfo` only replicates while `WorldInfo.TimeSeconds < LastTakeHitTimeout`
  (`KFPawn.uc:903`). A client that sees a zed for the first time does not replay old hits.
- **Two channels for one fact, on purpose.** The zone bitmask is the reliable truth ("this arm is gone"). The hit record is the
  pretty version ("from here, with this gun"). The comment at `KFPawn_Monster.uc:4100` says so: dismemberment uses the client-side
  hit FX, and the bitmask is for "when we need a reliably replicated effect". The client uses the rich record when it has one
  and falls back to the bitmask when it doesn't.
- **The damage type plays the effects.** `DamageType.static.PlayImpactHitEffects(pawn, location, direction, bone, instigator)`
  (`KFPawn.uc:3851`). Gore is a pure function of (body, hit record), so every machine gets about the same result.

### Hit registration: the client decides, the server checks

- `InstantFireClient` (`KFWeapon.uc:4347`) traces **on the shooter's machine**. The client sends what it hit with
  `ServerRegisterImpact1..8(FiringMode, ImpactRepInfo[])`. `ImpactRepInfo` is {HitActor, HitLocation, RayDir, BoneName}
  (`KFWeapon.uc:822`, `:4314-4325`). There are fixed-size RPCs for 1 to 8 impacts because UE3 can't send dynamic arrays.
  Projectiles, fragments and explosions have the same "client-side hit detection" path (`bUseClientSideHitDetection`).
- The server's check is native code and not public. The design is "favour the shooter": the client's trace is the hit, and the server
  only judges whether it is plausible. Ours (`ClaimValidator`) is the same idea.
- **Blood on a zed still waits for the server, even for the shooter.** The impact manager skips pawns: "pawns impacts are handled
  by the pawn (see PlayTakeHitEffects)" (`KFImpactEffectManager.uc:99-101`). World impacts (sparks, dust, decals on walls) play at
  once on the shooter's machine. On KF2's dedicated servers the round trip is usually small. Our P2P guests can sit much further
  from the host, which is why section 6 adds a small predicted puff.
- **Other players' guns:** the shooter sets `FlashLocation` and `FlashCount`, which replicate to everyone but the owner. Each client
  then plays `WeaponAttachment.ThirdPersonFireEffects(HitLocation, ...)` (`KFPawn.uc:1975`), the third-person version of that gun.
  Looping guns (flamethrowers, beams) replicate `WeaponAmbientSound` and `WeaponSpecialAction` to non-owners (`KFPawn.uc:919-920`).
  So every weapon has a third-person FX path driven by a few bytes of state.

### Movement, relevancy, scale

- Zeds are normal UE3 simulated proxies. Location, rotation and velocity replicate, and the client moves them between updates.
  Animation is local: a client picks its locomotion from velocity and plays special moves from the replicated enum.
- Relevancy: zeds are only replicated to players who can see them or are near them, which is UE3's default. One exception: when
  `AIRemaining <= NumAlwaysRelevantZeds` (3), the last few become always relevant (`KFPawn_Monster.uc:865-874`,
  `KFGameInfo.uc:4209`). That is so the team can hunt the stragglers.
- The alive cap at the top difficulties is 12, 18, then 32 zeds for 1, 2, then 3 to 6 players (`KFAISpawnManager.uc:1379-1396`).
  So KF2 tops out at about 32 live zeds for 6 players. Our cap is 48 for 4.

### Zed Time in multiplayer (`KFGameInfo.uc:2762-2960`, `KFPlayerController.uc:5915-6010`)

- **Server-only and global.** `DramaticEvent(chance, duration = 3 s)` rolls on the server. A win calls `SetGameSpeed(0.2)`, so
  `WorldInfo.TimeDilation` (replicated, `WorldInfo.uc:1619`) slows **every machine's whole sim, players included**.
  Players get a reliable `ClientEnterZedTime` RPC for the sound and the screen effect. Perk skills can let a player move at full
  speed (`bMovesFastInZedTime`).
- **Trigger odds per kill:** 5% if the killer was within 3 m, 2.5% otherwise, 5% for a player death. The odds double after 30 s
  without Zed Time and quadruple after 60 s. Zed Time can't trigger again within 10 s, unless it is forced.
- **Extensions:** during Zed Time, a kill by a player whose perk has extensions left calls `DramaticEvent(1.0)`, which **resets** the
  clock to the full duration. It doesn't add time. `ZedTimeExtensionsUsed` counts per chain, for the whole team. The fan wiki says
  a chain can have at most 6 extensions ([KF2 wiki](https://wiki.killingfloor2.com/index.php?title=Mechanics_(Killing_Floor_2))).
  Commando is the extension perk ([Steam thread](https://steamcommunity.com/app/232090/discussions/0/1621726179574063026/)).
- **Blend out:** for the last 0.5 s the dilation lerps from 0.2 back to 1.
- **Partial Zed Time ("Zed Time Lite").** When Zed Time starts, the server checks for each player whether they can see a zed that
  is in it. The check can pass through teammates who can see one (`CanSeeZedTimePawn`). A player who can't is set to
  `bUnaffectedByZedTime`: their own time dilation cancels the world's, so they move at normal speed, with the screen effect at 35%
  intensity. They drop into full Zed Time as soon as they fire (`KFPawn.uc:2006`) or spot a zed (a native sight counter).
  This is how KF2 stops a slow-mo moment in one room from slowing a player on the other side of the map.

### Starting and late joiners

- The match waits for ready-up: `bDelayedStart`, `CheckAllPlayersReady`, `MajorityPlayersReady` (`KFGameInfo.uc:3930-3960`).
- A player who joins mid-wave can't spawn until the wave ends: `PlayerCanRestart` returns `!IsWaveActive()`
  (`KFGameInfo_Survival.uc:209`). They spectate, then spawn at trader time. A late joiner never needs the wave's history, only what
  is alive.

---

## 2. Killing Floor 3 (Unreal Engine 5, 2025)

I found little public material on it.

- I found no talk, dev blog or patch note on its replication. Reviews disagree: some say the netcode is solid, and player
  summaries report latency spikes and disconnects ([Vaporlens](https://vaporlens.app/app/1430190/killing_floor_3),
  [Notebookcheck](https://www.notebookcheck.net/Killing-Floor-3-Early-gameplay-sparks-heavy-criticism.965449.0.html)).
- **Gore:** M.E.A.T. returns. Early footage drew complaints that zeds "explode" instead of coming apart
  ([Notebookcheck](https://www.notebookcheck.net/Killing-Floor-3-Early-gameplay-sparks-heavy-criticism.965449.0.html)). PC Gamer wrote up
  the "dynamic tech that makes zed heads flower" ([PC Gamer](https://www.pcgamer.com/games/fps/killing-floor-3s-dynamic-tech-that-makes-zed-heads-flower-when-you-shoot-them-will-haunt-me-for-the-rest-of-my-days-but-also-i-have-to-see-more/)).
  There are no technical details. It is UE5, so it most likely keeps KF2's model (server hit record, client gore), but I couldn't
  confirm that.
- **Zed Time:** no longer random. A meter at the top of the screen fills from kills and headshots (and parries, per one review), and
  it has a cooldown after use ([PlayStation Blog interview](https://blog.playstation.com/?p=407781),
  [Game8](https://game8.co/games/Killing-Floor-3/archives/539106), [The Escapist](https://www.escapistmagazine.com/how-could-weapon-customization-innovate-killing-floor/)).
  Some skills get stronger during Zed Time. Fans complained about the change at the beta. Patch 2.012 fixed Zed Time bonuses that
  lasted past the end of Zed Time ([MP1st](https://mp1st.com/title-updates-and-patches/killing-floor-3-text-chat-update-released-may-14-patch-2-012)).
  The lesson for us: an earned, visible meter reads better in a team than a hidden dice roll. Our SLOWMO headshot rule is
  already earned.

---

## 3. Other references

**Source engine / Left 4 Dead.**
- Ragdolls are client-side by default. "When an NPC or player dies, the engine normally creates a client-side ragdoll", and those
  are "handled completely on a per-client basis" and cheap. A server-side ragdoll "produces very large amounts of network traffic"
  and exists only for special cases (`trigger_serverragdoll`). Small breakable pieces are client-simulated and "not synchronized
  between clients" ([Valve wiki: Ragdoll](https://developer.valvesoftware.com/wiki/Ragdoll),
  [Trigger serverragdoll](https://developer.valvesoftware.com/wiki/Trigger_serverragdoll),
  [Physics entities on server and client](https://developer.valvesoftware.com/wiki/Physics_Entities_on_Server_%26_Client)).
- L4D2 wounds are a shader on the infected, with up to 54 wound spots per model and "accurate location of wounds" as a goal
  ([Vlachos, GDC 2010](https://gdcvault.com/play/1012264/Shading-a-Bigger-Better-Sequel),
  [slides](https://es.slideshare.net/alexvlachos/gdc-2010-left4dead2-wounds), [Infected shader](https://developer.valvesoftware.com/wiki/Infected_(shader))).
  A wound is a few numbers, so it is cheap to drive from a hit event.
- Interpolation: clients render about 100 ms in the past by default, which keeps two snapshots in hand, so one lost packet doesn't
  break the motion. The effective delay is `max(cl_interp, cl_interp_ratio / cl_updaterate)`
  ([Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking),
  [Interpolation](https://developer.valvesoftware.com/wiki/Interpolation), [TF2 network graph](https://developer.valvesoftware.com/wiki/TF2_Network_Graph)).
- Lag compensation rewinds players only, by default, with 1 s of history, and accounts for each client's interpolation delay
  ([Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation)).

**Deep Rock Galactic (UE4, the host is a listen server over Steam P2P, like ours).** Ghost Ship has published little. Patch notes
mention "client authoritative projectiles" whose impacts failed to register on the server when the flight was shorter than the
client's ping, and "client prediction" for the Hurricane's targeting, to make damage reliable for high-latency clients
([Season 1 patch 1 notes](https://updatecrazy.com/deep-rock-galactic-update-season-1-patch-1-notes-nov-8-2021/)). So DRG lets the guest
decide many of its own hits, and the host accepts them. That is the main host-advantage fix in host-based co-op: the guest's aim is
the truth. Player reports of host and guest disagreeing (a beam hitting on one side and not the other) and join-time lag spikes exist,
but they are unconfirmed
([Steam](https://steamcommunity.com/app/548430/discussions/2/3061868384752865412), [BetaHub](https://app.betahub.io/projects/pr-5632787018/issues/247)).

**Vermintide 2 / Darktide (Fatshark).** This is forum-grade evidence only. A Fatshark forum post says that in Vermintide 1 and 2,
"hit detection (shooting and melee) and blocking was done on the client. Hit response was done on the Server", and that Darktide
(dedicated servers) moved more onto the server ([Fatshark forums](https://forums.fatsharkgames.com/t/client-server-authoritative-networking/67657)).
A community Vermintide 2 dismemberment mod notes that "nothing extra is sent over the network", so friends without it see normal
enemies ([DSV2](https://github.com/gitparrot/DSV2)). That fits gore being local and cosmetic. Players did complain that enemy hits on
*players* were resolved on the host ([Steam](https://steamcommunity.com/app/552500/discussions/0/2650805212060154115/)).

**Back 4 Blood.** I found nothing technical. Reviewers said its gore was toned down from L4D
([Shacknews](https://www.shacknews.com/article/127132/back-4-blood-review-settling-4-less)). Skip.

**Halo: Reach (host-based, Bungie, GDC 2011, "I Shot You First").** Replication is unreliable and prioritised per object, from the
Tribes model, with reliable events kept separate. Bandwidth dropped by over 80% from Halo 3
([GDC Vault, free](https://www.gamedeveloper.com/business/gdc-vault-adds-free-crawford-i-halo-reach-i-maxis-lectures),
[Wolfire summary](https://wolfire-blog.appspot.com/2011/03/GDC-Session-Summary-Halo-networking), [Edgegap](https://edgegap.com/blog/game-backend-deep-dive-halo-reach-netcode-host-migration)).

**Gaffer on Games.** Packets don't arrive evenly spaced, so the interpolation buffer needs "enough delay to lose two packets in a row
and still have something to interpolate towards". At 10 snapshots a second that is at least 100 ms, and about 150 ms with real jitter
([Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation), [Snapshot Compression](https://www.gafferongames.com/post/snapshot_compression/)).
The state-sync variant uses a smaller jitter buffer keyed by frame number ([State Synchronization](https://new.gafferongames.com/post/state_synchronization/)).

**WebRTC.** A DataChannel can be `ordered: false, maxRetransmits: 0` (or `maxPacketLifeTime`), which is the UDP-like setting for
state that replaces itself. Keep a second, reliable, ordered channel for one-shot events
([RFC 8831](https://rfc-editor.org/rfc/rfc8831), [Cloudflare](https://developers.cloudflare.com/changelog/post/2026-08-13-datachannels-reliability-ordering/),
[bugnet](https://bugnet.io/blog/how-to-fix-webrtc-datachannel-ordered-mode-latency)). trystero 0.27 opens one reliable channel named
`data` per peer (`node_modules/@trystero-p2p/core/dist/peer.mjs:284`) but exposes the `RTCPeerConnection`
(`room.getPeers()[id].connection`, null when the peer is reached through another peer, so keep the fallback). A second, pre-negotiated unreliable channel (`negotiated: true, id: N` on both ends) can be added
without forking trystero.

---

## 4. The patterns

### P1. Authority split

| Authoritative (host decides, guests never guess) | Local cosmetic (each machine simulates, may differ) |
|---|---|
| Enemy health, armour, plates, shields | Blood spray, droplets, mist |
| Death, and *how* (gib, sliced, obliterated) | Ragdolls and corpse physics (torn off at death) |
| Which regions are severed (the bitmask) | The severed piece, its flight, the stump, intestine ropes |
| Wave state, spawns, the director, timers | Wound decals on bodies, blood decals and pools in the world |
| Score, credits, kill credit, run report | Gibs, chunks and organs |
| Status effects that change play (frozen, burning, downed, stagger) | Tracers, muzzle flashes, impact sparks and dust, shell casings |
| Shared slow-mo scale and who holds it | Hit flashes, flinch reflexes, muscle twitches |
| Pickups, prisoners, vehicles, call-ins | Camera shake, screen grade, audio pitch |

KF2's rule: **if getting it wrong changes the game, the server owns it. If not, every client makes its own.**

### P2. Send the event, not the result

Send "uid 431 took a hit at bone *forearmL*, point P, direction D, weapon *shotgun*, 7 more pellets at these offsets, severity 0.8,
seed 9172, severed *forearmL*, killed: gib". Don't stream what that hit did to the mesh. Each client feeds the event into the same gore
function the host uses. The gore never crosses the wire, only the cause does.

### P3. A reliable fact plus a rich event

Keep a small reliable state ("these regions are gone", "dead") for late joiners and lost events. Use it only as a fallback, after a
short grace period, so the rich event wins whenever it arrives. KF2 does this with `InjuredHitZones` and `HitFxInfo`.

### P4. Seeded cosmetics

When an event carries a seed, every machine picks the same wound shape, the same gib set and the same droplet pattern. Physics will
still diverge, which is fine. Valve and KF2 both accept that corpses differ per machine.

### P5. Per-client budgets

Corpse count, decal caps and blood lifetimes are each player's own graphics setting. They are never the network's, and never the
host's.

### P6. Interpolation with a real buffer

Each snapshot carries the host's send time. The guest renders at `hostNow - delay`, between the two snapshots on either side of that
time. The delay is about 2.5 snapshot intervals (or adaptive, from measured jitter). If the buffer runs dry, extrapolate along
velocity for a short time (100 ms or less), then hold.

### P7. Client-side hits, host checks (favour the shooter)

KF2, DRG and Vermintide all let the shooter's machine decide what it hit, and the host checks plausibility. A rewind on the host isn't
needed when the client decides the hit. It only matters if the host re-traces.

### P8. Predict the cosmetic, confirm the consequence

The shooter's machine plays a *light* hit cosmetic at once (impact puff, flesh sound, hit-marker, a small wound). The heavy,
irreversible things (a limb off, a death, a gib) wait for the host. KF2 waits for the server even for the puff. With P2P round trips,
a predicted puff is worth it.

### P9. Third-person weapon FX from fire state

Each weapon defines how *other* players see it: per-shot weapons from a "fired W from O along D, hit point H" event, looping weapons
(beams, flamers, miniguns) from a small "firing / aim / stopped" state at 10-20 Hz. KF2 uses `FlashCount`/`FlashLocation`,
`ThirdPersonFireEffects` and `WeaponAmbientSound`.

### P10. Animation from moves, not frames

Send "attack *swipe* started, target T", "stagger from direction D", "knockdown impulse I". Each client plays the move itself. KF2 uses
`ReplicatedSpecialMove`.

### P11. Priority and relevancy

Enemies near a guest, or in front of them, get updates more often than far ones. Halo and Tribes send by priority under a byte budget.
KF2 culls by relevancy, but always keeps the last 3 zeds relevant. With 48 enemies and 4 players we don't need culling, only a rate
tier.

### P12. Loading and late joiners

Ready-up, then a shared countdown, then start. Late joiners get the living state, not the history. In wave modes they spawn at the
next break (KF2 trader time).

---

## 5. Recommended architecture for OVERPOWERED 2

### 5.1 What moves from "host state streamed" to "host events, local cosmetic sim"

| Today | Target |
|---|---|
| `hitfx` carries damage inputs, and the guest wounds at a fixed **0.6** | `hitfx` carries the host's real **severity**, a **seed** and up to **7 extra pellet offsets**. The guest calls the same `gore.wound(char, damage, severity)` and runs `updateMaim` when it breaks something |
| Snapshot sever bits sever at once with a dummy hit | The snapshot bit is a **fallback only**: the guest severs from it only if no `sever` event for that region has arrived 300 ms after the bit (P3). Real severs always come from the event with the real damage |
| The guest's own shot: no blood until the host answers | The guest plays a **predicted light cosmetic** at the hit point: puff, flesh sound, hit flash, small wound (P8). The host's `hitfx` for that shot (matched by shot id) then adds only what was not predicted: real severity, sever and kill |
| `kill` → `replayDeath` | Unchanged, plus the seed. The ragdoll and the gibs are already local, which is correct, as in KF2 tear-off |
| One generic remote tracer for every weapon | A **remote FX table** per weapon (P9): bullet (tracer, flash), pellets (cone of tracers), beam (Lance: start and stop plus aim at 15 Hz on the existing lane, drawn with the same beam layer the shooter sees), flame and spray (an emitter on while firing), melee (swing arc and sound), thrown things (already `boom`) |
| Corpse, decal and blood budgets possibly differ by role | Budgets come from the **local** graphics settings only. Host and guest with the same settings show the same amount of gore (P5) |

### 5.2 What stays authoritative on the host

Health, armour, plates, shields, ward. Death and its kind (gib, slice, obliterate). The sever bitmask. Status effects that change play
(frozen, burning, downed, stagger, capturable). The wave director and spawns. Enemy AI and targeting. Score, credits and kill credit
(as now: `notMine`, `ownKill`). Pickups, prisoners, vehicles, call-ins. The shared slow-mo scale. Hit acceptance (`ClaimValidator`
stays the judge, and a client-side hit is a claim, not a fact).

### 5.3 The enemy snapshot lane

1. **Unreliable lane.** Open a second DataChannel on each trystero peer connection: `{ negotiated: true, id: 7, ordered: false,
   maxRetransmits: 0 }`. Send `world` snapshots on it, and keep `action` events on trystero's reliable channel. A lost snapshot is then
   replaced by the next one, instead of stalling every later one. If the channel won't open (an old browser, TURN oddities), fall back
   to today's path.
2. **Host timestamps.** Add a u32 of host milliseconds to the header. The guest keeps a smoothed host-clock offset (from the
   existing 2 s ping).
3. **Real buffer.** Keep the last 4 snapshots per enemy. Render at `hostNow - 150 ms` at 10 Hz, or `- 100 ms` at 20 Hz. Extrapolate
   along velocity for up to 100 ms, then hold. This replaces the "blend from where it is now" in `updateGuests`.
4. **Rate tiers by priority (P11).** For each guest: enemies within about 25 m, or inside a wide cone ahead, go every frame at 20 Hz.
   The rest go at 5 Hz. Bosses and the last 3 enemies always go at 20 Hz.
5. **Animation events (P10).** Turn the 2-bit animation field into reliable `move` events: {uid, move id, target slot or point,
   stagger direction}. The guest plays the same clip and timing the host started. Keep the bits as a fallback.

**Bandwidth budget.** Today one guest gets about 9.6 KB/s in a 13-21 enemy wave (measured, `docs/notes/coop.md`). Target, at the
48-enemy cap, per guest: snapshots at about 20 near enemies × 20 Hz + 28 far × 5 Hz ≈ 25 KB/s, plus events at about 6 KB/s (hits
with pellets are the big item; pack `hitfx` as binary if they pass 8 KB/s), so **about 30-35 KB/s per guest, about 1 MB/s (≈ 0.85
Mbit/s) host upload for three guests**. That is fine on home broadband, and through TURN it is under 2 GB for a 3-hour evening.
Hard ceiling: 64 KB/s per guest, beyond which the host lowers the far tier to 2 Hz.

### 5.4 Weapon effects for other players (P9)

Add one optional field to each weapon definition: `remote: 'bullet' | 'pellets' | 'beam' | 'flame' | 'melee' | 'none'`, plus that
kind's parameters. `drawFire` dispatches on it. For looping kinds the shooter sends `{ t: 'beam', slot, weapon, on, origin, dir }`
when it starts, at 15 Hz while it is on, and once when it stops. The receiver draws the beam from the friend's muzzle to its own
raycast end, using the same FX layer the shooter's viewmodel uses (`src/fx/layers/`). This fixes the invisible Lance and every
future beam in one place.

### 5.5 Host advantage

- The host already decides its own hits instantly. Guests already decide theirs (claims). The remaining host advantage is
  **cosmetic latency** (fixed by 5.1 prediction) and **enemy freshness** (fixed by 5.3).
- **One gore path for both.** The host should render gore from the same event object it sends, so host and guest can't drift
  apart in what they show. `enemy:hit`, `sever` and `kill` already exist on the host's bus. Make the host's own gore call and the
  guest's take the same packed inputs (severity, seed, pellets).
- Hits *on* guests: enemy attacks are resolved on the host and sent as `hurt`. That is the Vermintide complaint (getting hit by
  something you dodged on your screen). Leave it as is, but give a guest a small grace window: the host ignores a melee hit if
  the guest's last pose, received within 150 ms, was outside reach by more than 0.5 m. Cheap, and it removes the worst
  "hit through a dodge" cases.

### 5.6 Slow-mo in multiplayer (consistent with `docs/research/coop-slowmo.md`)

Keep the slow-mo note's design. Players keep full speed, only the world slows, the host owns the scale, and any player can request
slow-mo (SLOWMO, Time Warp, and Team Focus if adopted). Add from KF2:

- **Broadcast the scale.** The host sends `{ t: 'slowstate', scale, by, until }` on change, and repeats it in the snapshot header
  (1 byte, scale × 255). Guests apply it to the **cosmetic clock** (gore, particles, droplets, ropes, ragdolls, replica animation,
  tracers, audio rate, colour grade) and never to `playerDt`. This is the same message the slow-mo note asks for.
- **Interpolation uses host time, not scaled time.** Snapshots are stamped with the host's wall clock, so a slowed enemy just moves
  less between stamps. No special case.
- **KF2 rules worth taking:** a 0.5 s blend-out, as in `TickZedTime`. Kill extensions **reset** the timer to full, they don't
  add, with a cap per chain (KF2: about 6). Re-triggering is blocked for some seconds after the end.
- **KF2's partial Zed Time, adapted:** a guest more than about 40 m from every slowed enemy, or with none in view, gets the effect
  at reduced intensity (a 35% grade, no audio pitch drop). The world is equally slowed for everyone, since there is one host sim.
  This is cosmetic only, so it costs one distance check per frame on the guest.

### 5.7 Loading and late joiners

- **A load barrier.** After the countdown, each peer sends `{ t: 'loaded' }` once its map, character library and gore pools are
  warm. The host's world starts (enemies spawn, timers run) only when every guest has reported, or after 20 s. A guest that misses
  the 20 s joins as a late joiner. This is KF2's `bDelayedStart`, applied to loading.
- **Late joiners** get living enemies, the sever bitmask and dead flags. They don't get corpse piles: corpses are local cosmetics,
  as in KF2 and Source. In wave modes, spawn at the next intermission or after a short respawn delay, as `team.ts` decides.
  The campaign keeps `CoopMission.catchUp`.

---

## 6. Staged migration plan

Each stage ships alone, in order of how much it fixes the playtest complaint per day of work. Sizes are rough and include tests and
one two-browser check (run one at a time on the 8 GB machine, dpr 2).

| # | Stage | Fixes | Size | Main risk |
|---|---|---|---|---|
| 0 | **Measure.** On the guest, record per kill: the delay from shot to `hitfx`, snapshot gaps over 150 ms, `gore.wound` calls and severity, and the corpse count. Do the same on the host. Show it on the existing co-op cost meter | Knowing what to fix first. Confirms or rules out "sparse enemies" (live replica count against the host's alive count) | 0.5 day | None |
| 1 | **Gore parity.** Real severity, a seed and pellet offsets in `hitfx`. `updateMaim` on the guest. Snapshot sever bits as a 300 ms fallback only. Local budgets checked to be equal | "Gore stripped back" | 1-1.5 days | Bigger `hitfx` JSON with shotguns. Pack it as binary if stage 0 shows more than 8 KB/s |
| 2 | **Predicted own-hit cosmetics.** Light puff, sound, flash and small wound at once. Match the host's `hitfx` by shot id and skip duplicate spray | "Laggy gore" on the guest's own shots | 1 day | Double blood if matching fails. A predicted wound on an enemy the host then says was blocked: keep the prediction to puff and sound for armoured regions |
| 3 | **Remote weapon FX table.** `remote` kind per weapon, beam start, update and stop events, flame and melee | "Lance invisible", and every future beam | 1-2 days | Each weapon needs a look-check. Beam updates add about 1 KB/s per firing player |
| 4 | **Snapshot lane.** Unreliable negotiated channel with fallback, host timestamps, 150 ms buffer, short extrapolation, 20/5 Hz tiers | "Streamed the host's game", crowd stutter | 2-3 days | Depends on trystero internals (`getPeers()`, `connection`): pin and test. Clock offset error shows as a constant lag, not jitter |
| 5 | **Animation move events.** Attack, stagger and knockdown starts as reliable events | Enemies look puppeted | 1-2 days | Each archetype's moves need ids. Moves for bosses and vehicles need a decision |
| 6 | **Slow-mo broadcast.** `slowstate`, cosmetic clock on guests, blend-out, the distance "lite" grade. Team Focus from the slow-mo note if the owner wants it | Guests not feeling SLOWMO | 1-1.5 days (shared with the slow-mo note's Option A) | Guest effects run on the scaled clock but the guest's own gun on `playerDt`: check that guest tracers and impacts don't look slowed |
| 7 | **Load barrier.** `loaded` message, 20 s timeout, late-join path | Guests missing the first seconds | 0.5-1 day | A stuck guest delays everyone up to 20 s. Show "waiting for X to load" |

Total: about 8.5-12.5 days. Stages 1-3 (about 3.5-4.5 days) should answer most of the playtest complaint by themselves.

**Risks across the plan.**
- **Guest CPU.** A guest that renders full-fidelity gore for four guns does the same work as the host's gore, without the AI. The
  host already does that today, so the cost is known. Per-client budgets (P5) are the release valve.
- **Divergence is fine, but check it.** Corpses will lie differently on each screen, as in every game above. A corpse is never
  something a player stands on or shoots through for gameplay, so keep it that way (corpse collision cosmetic only).
- **Trust.** More client-decided cosmetics change nothing about trust. Claims are still checked, and cosmetics can't hurt anyone.
- **Test load.** Every stage needs two real browsers. Keep them one at a time on the 8 GB machine.

---

## 7. Open questions for the owner

1. Should a guest's own shot show a predicted blood puff at once (stage 2), or is waiting for the host, as KF2 does, acceptable?
2. Is it OK that corpses and gibs land differently on each screen? (Every game above accepts this.)
3. Should guests get the "slow-mo lite" grade when far from the action, or always the full effect?
4. What is the upload budget for a host: is about 1 MB/s with three guests fine, or should it be tuned for weaker home connections?

## Sources

- KF2 game scripts (Tripwire, via the SDK), mirror [GenZmeY/KF2-Game-Scripts](https://github.com/GenZmeY/KF2-Game-Scripts): `KFGame/Classes/KFPawn.uc`,
  `KFPawn_Monster.uc`, `KFWeapon.uc`, `KFImpactEffectManager.uc`, `KFGoreManager.uc`, `KFGameInfo.uc`, `KFPlayerController.uc`, `KFAISpawnManager.uc`,
  `KFGFxOptionsMenu_Graphics.uc`, `KFPerk_Commando.uc`, `KFGameContent/Classes/KFGameInfo_Survival.uc`, `Engine/Classes/WorldInfo.uc`, `Engine/Classes/Pawn.uc`
- KF2 gore press: [PC Gamer](https://www.pcgamer.com/killing-floor-2-gore-system), [GamesBeat](https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/),
  [Shacknews](https://shacknews.com/article/87441/killing-floor-2-panel-discusses-increased-gore-and-more), [PCGamesN](https://pcgamesn.com/killing-floor-2/painting-paris-red-with-killing-floor-2s-meat-system)
- KF2 Zed Time: [KF2 wiki mechanics](https://wiki.killingfloor2.com/index.php?title=Mechanics_(Killing_Floor_2)), [Steam thread](https://steamcommunity.com/app/232090/discussions/0/1621726179574063026/),
  [Wikipedia](https://en.wikipedia.org/wiki/Killing_Floor_2)
- KF3: [PlayStation Blog](https://blog.playstation.com/?p=407781), [Game8](https://game8.co/games/Killing-Floor-3/archives/539106), [The Escapist](https://www.escapistmagazine.com/how-could-weapon-customization-innovate-killing-floor/),
  [Notebookcheck](https://www.notebookcheck.net/Killing-Floor-3-Early-gameplay-sparks-heavy-criticism.965449.0.html), [PC Gamer](https://www.pcgamer.com/games/fps/killing-floor-3s-dynamic-tech-that-makes-zed-heads-flower-when-you-shoot-them-will-haunt-me-for-the-rest-of-my-days-but-also-i-have-to-see-more/),
  [MP1st patch 2.012](https://mp1st.com/title-updates-and-patches/killing-floor-3-text-chat-update-released-may-14-patch-2-012), [Vaporlens](https://vaporlens.app/app/1430190/killing_floor_3)
- Valve: [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking), [Interpolation](https://developer.valvesoftware.com/wiki/Interpolation),
  [Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation), [TF2 Network Graph](https://developer.valvesoftware.com/wiki/TF2_Network_Graph),
  [Ragdoll](https://developer.valvesoftware.com/wiki/Ragdoll), [Trigger serverragdoll](https://developer.valvesoftware.com/wiki/Trigger_serverragdoll),
  [Physics entities on server and client](https://developer.valvesoftware.com/wiki/Physics_Entities_on_Server_%26_Client), [Infected shader](https://developer.valvesoftware.com/wiki/Infected_(shader)),
  [Vlachos GDC 2010](https://gdcvault.com/play/1012264/Shading-a-Bigger-Better-Sequel)
- Deep Rock Galactic: [Season 1 patch 1 notes](https://updatecrazy.com/deep-rock-galactic-update-season-1-patch-1-notes-nov-8-2021/), [Steam](https://steamcommunity.com/app/548430/discussions/2/3061868384752865412),
  [BetaHub](https://app.betahub.io/projects/pr-5632787018/issues/247)
- Fatshark: [forum on client/server authority](https://forums.fatsharkgames.com/t/client-server-authoritative-networking/67657), [Steam V2 thread](https://steamcommunity.com/app/552500/discussions/0/2650805212060154115/),
  [DSV2 mod](https://github.com/gitparrot/DSV2)
- Back 4 Blood: [Shacknews review](https://www.shacknews.com/article/127132/back-4-blood-review-settling-4-less)
- Halo: Reach: [Game Developer](https://www.gamedeveloper.com/business/gdc-vault-adds-free-crawford-i-halo-reach-i-maxis-lectures), [Wolfire](https://wolfire-blog.appspot.com/2011/03/GDC-Session-Summary-Halo-networking),
  [Edgegap](https://edgegap.com/blog/game-backend-deep-dive-halo-reach-netcode-host-migration)
- Gaffer on Games: [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation), [Snapshot Compression](https://www.gafferongames.com/post/snapshot_compression/),
  [State Synchronization](https://new.gafferongames.com/post/state_synchronization/)
- WebRTC: [RFC 8831](https://rfc-editor.org/rfc/rfc8831), [Cloudflare DataChannel reliability](https://developers.cloudflare.com/changelog/post/2026-08-13-datachannels-reliability-ordering/),
  [bugnet on ordered mode](https://bugnet.io/blog/how-to-fix-webrtc-datachannel-ordered-mode-latency)

Not checked: the native C++ side of KF2 (the server's hit validation, corpse rating), KF3's code, and any Ghost Ship or Fatshark
engineering talk. I found none, and none of the claims above depend on them.
