# Co-op audit (2026-11-18)

This audit covers the owner's two-player playtest on the live site, on dev at `da2ff4c`. It is research only: nothing here changes
code. Sections: A root causes, B what only the shooter sees, C lag and jank, D known limits re-checked, E the fix list. How other
games do this (Killing Floor 2/3) is in `docs/research/`; this doc only points at it.

**Evidence.** I read the code, then ran two-page browser probes (Playwright chromium, one browser, a private Vite server, HMR off,
each page capped at 15 fps by `coop-kit.mjs`). The probe scripts were scratch files; their outputs are in `tools/out/coopaudit/`
(`audit-evidence.json`, `audit2-evidence.json` and the PNGs). `tools/out` is not committed. Note that `coop-kit.mjs`'s `startPair`
no longer works on a fresh profile: since `da2ff4c`, Play on a first launch goes to Retraining. The probes set `op2.played.v1` first.

---

## A. Root causes of the five reports

### A1. Load race: the host plays on while a guest is still loading, and the guest gets kicked

How a match starts today:

1. The host presses Start. Each guest acks `started` and navigates (`session.ts:19-31` `deployMatch`). Once every ack is in, the
   host navigates too (`lobby.ts` `finishStart`).
2. On the map page, `startGame` first calls `reconnectMatch()` (`Game.ts:294`). That rebuilds the `Lobby` **before** the heavy boot
   (`session.ts:50`), so the lobby's liveness timers are armed for the whole download and boot:
   - the guest's `HOST_WAIT_MS` = 30 s timer (`lobby.ts:83`, armed at `lobby.ts:186`), which waits for the host's `hello`;
   - the 20 s silence rule (`SILENCE_MS`, `lobby.ts:90`). The guest closes with `'lost'` at `lobby.ts:214`. The host drops a silent
     guest in `heartbeat` (the loop just after `lobby.ts:214`, `peerLeft`).
3. **Nothing makes the host wait.** Its boot ends in `hud.startRun()` (`Game.ts:320`), then `newRun()`, then
   `c.waves.start()` (`Game.ts:143`) for a host. No message says "loaded", and no barrier exists. Waves start the moment the
   host's own page is ready, whether or not a guest has arrived. The only "arrived" signal is the host getting a guest's first
   `card` (`team.ts:235`), which today feeds the purse restore and the mission/drops catch-up, never the waves.
4. When the guest finally finishes booting, `Game.ts:318` checks `ctx.coop.lobby.phase === 'closed'`. If the room closed during
   the boot, for any reason, it shows one generic line: **"The host left or the room could not reconnect."** That matches what the
   owner saw. The real reason (`lost`, `host-left`, `no-host`, `connect`, `relays`) is in `lobby.error` but is thrown away there.
   `WORKER_URL` is empty (`turn.ts:11`), so the `report()` in `Lobby.close` (`lobby.ts:650-656`) never leaves the browser either.

What closed the friend's room is one of these timers firing while the friend's page was busy loading:

- **Most likely: 20 s silence.** The friend's boot runs long synchronous tasks on the main thread: world build, `characters.load`,
  `gore.warm()` (cuts every archetype's trunk kit in one loop, `gore/index.ts:1529`), and the first shader compiles. On a slower PC
  with a cold cache these tasks can starve the Lobby's `ping`/`pong` handlers and its `setInterval`. Starve them past 20 s and either
  the guest's interval sees `now - heard(host) > SILENCE_MS` and closes `'lost'`, or the host drops the guest as silent.
- **Also possible: the 30 s `HOST_WAIT_MS`.** The guest's new page must redo Nostr signalling and ICE with the host's new page while
  it also downloads every asset. If the host's `hello` hasn't arrived within 30 s, the guest closes with `no-host` or `connect`.

Either way the cause is a design gap, not one bad line. Match start has no "loading" phase: the room's liveness rules assume a
running game, and the host's waves assume everyone is in. **To tell the two timers apart**, the error code must reach the screen
(`Game.ts:318`) or the console. Today neither happens.

While a guest loads, the host also sends it snapshots and events. A message that arrives before `CoopWorld.begin()` is dropped,
except the last snapshot (`world.ts:227`, `world.ts:444`). This is harmless today, since the first `card` triggers the catch-up, but
any one-shot event the host sends in that window (a wave start, a drop, a chatter line) is lost to that guest.

### A2. The guest's experience is "streamed": less gore, laggy, sparse

How an enemy, its gore and its ragdoll reach a guest today:

**In the snapshot** (`world.ts:432-441` `frame()`, encoded at `worldProtocol.ts:95-122`): 45 bytes per living enemy, at most
10 Hz. The fields are uid, archetype, flags (airborne, downed, frozen, burning, shield, ward, boss entry, capturable), a coarse
`animation` byte (0 move, 1 windup, 2 attack, 3 stagger), the intact-plate mask, position, yaw, health, max health, armour, velocity
(cm/s), the 11-bit sever mask and posture.

**Not in the snapshot:** wounds, blood level, fractures, maim and crawl state, living knockdowns (the host's partial ragdolls),
stumbles, flinches, the real attack clip, aim, telegraphs and get-ups.

**On the host**, every hit runs the full model, `EnemyDamage.apply` (`damage.ts:375-475`):

- `gore.wound(char, d, amount / maxHealth)` (`damage.ts:456`): wound cuts, exit wounds, gut spill, then `blood.onHit`'s spray, wet
  skin and drips (`gore/index.ts:1159-1165`, `gore/blood.ts:281-306`);
- `headPellets`, plate wear and shoot-off;
- `react()`: stagger, flinch and knockdown;
- `spendLimb`/`blastWound`: sever with scream and sound, then `updateMaim`.

**On a guest**, its own shot does this:

1. `Combat` hits the replica's bones locally and calls `enemies.applyDamage`.
2. That returns `CoopWorld.claim()` (`EnemyManager.ts:862`, `world.ts:205-225`). `claim()` sends a `hit` claim and returns a
   predicted result. **It touches no gore.** The guest draws only `fx.bloodHit` at once (`Combat.ts:373`).
3. The host validates the claim and runs the full `apply`. Its `enemy:hit` listener broadcasts `hitfx` (`world.ts:131-132`).
4. One round trip later, the guest runs `gore.wound(char, damage, 0.6)` plus a second `fx.bloodHit` and a hit flash
   (`world.ts:317-324`). Severity is fixed at 0.6 rather than the host's computed value. Then:
   - no `react()`, so no stagger, flinch or knockdown beyond the coarse animation byte;
   - no hit voice;
   - and on a blocked hit, only an armour impact.
5. A limb comes as a `sever` event, calling `gore.sever` directly (`world.ts:341-345`). That skips `EnemyDamage.sever`
   (`damage.ts:570-586`), so there's no `limb_sever` sound, no scream and **no `updateMaim`**. A replica that lost its legs is not
   put into the crawl the host shows. If the event was missed, the snapshot's sever bit cuts the limb with a fake damage
   (`world.ts:479-482`: point = centre, dir = up, force 1). The limb then drops instead of flying.
6. Deaths come as a `kill` event and replay **locally** through `manager.replayDeath` → `model.kill` (`world.ts:300-316`,
   `EnemyManager.ts:877-880`). So the guest's ragdoll, gib, slice, vaporize, headshot burst, blood pools and corpse are each its
   own simulation, which is already the client-side approach. Two caveats:
   - `kill(..., blast = null)` drops the blast-ring outcome. The host's waist cuts and torn limbs arrive only as earlier `sever` events.
   - Shatter becomes a gib because `e.frozen` isn't replicated, only the frost skin.
7. Everything enemies *do* is host-only (detailed in B and C3). Guests get:
   - a tracer per enemy shot (`ray`, `world.ts:291`);
   - an instant tracer for every enemy projectile (`world.ts:630-635`);
   - and explosions.

   They get no enemy gunshot sounds, muzzle flashes, glints, sniper lasers, rocket bodies, pain or bark voices (`attacks.ts:246-272`
   and the rest are inside the host's AI).

**Choices made from the host player's position, not the shooter's:**

- `blowsOut(d, distance to ctx.player)` (`damage.ts:858`). The host decides point-blank torso blowouts from the *host's* distance; a
  guest replays only what the host decided (`d.torso`).
- `gutShot` uses `ctx.player.eye` (`gore/index.ts:1181`).
- Pellet wound size scales with distance to `ctx.player.eye` (`gore/wounds.ts:175`).

So a guest's point-blank shotgun blast on a far-from-host enemy is wounded as a long-range hit and never blows out.

**Laggy and sparse.** The interpolation (C2) has no jitter buffer, so enemies step. Enemy replicas also run no real attack
animation (C3), and attacks have no audio, so the fight reads as sparse and silent.

**Endless Humans:** the outpost layer still runs `onSpawn` on the guest's replicas (`EnemyManager.ts:289` →
`outpost/index.ts:368-400`). Each guest therefore invents its own squads, names, ranks and bravado for the host's men; only chatter
lines carry the host's name ids.

**Why it feels like a stream:** every hit's gore detail on a guest is the host's verdict, sent back one round trip later in
reduced form. The Killing Floor model the owner remembers (see `docs/research/`) has each machine apply the full cosmetic damage
model to its local copy, with the server sending only the authoritative numbers.

The pieces already exist here: the guest has the full `EnemyDamage`, `Gore` and the enemy's rig. It just isn't allowed to use them
on a living enemy.

### A3. Effects that exist only in first person

The `fire` event (`world.ts:195-204`) carries a weapon id, an origin and a direction, nothing more. `drawFire`
(`world.ts:414-430`) draws every gun the same way:

- one `'bullet'` tracer to the first wall within 100 m;
- one `fx.muzzleFlash` with the row's `muzzle` kind, from the friend's third-person prop;
- the weapon's sounds at 0.65 volume;
- and a generic `shoot` animation.

Melee and swords get the sound and the `shoot` animation only.

So a charged Lance beam is a single bullet tracer on others' screens. The beam column, sheath, shell, arcs, scorches, lights and
post FX are drawn only on the shooter's machine (`lance.ts:890-923` `startBeam`, `lance.ts:1068` `drawBeam`). The full list is in B.

### A4. A host's dropped weapon isn't seen by the guest

**Not reproduced.** Probe 1 ran on this build (Crucible, `audit-evidence.json`):

- The host dropped its SMG. The guest's `DroppedGuns` held it with its model in the scene, `visible: true`.
- A guest drop went to the host and came back to the guest as `add`.

Probe 2 (`audit2-guest-sees-host-drop.png`) shows the guest's "[E] Take SMG (from HOST-ONE)" prompt over the host's drop. The model
renders with world materials on camera layer 1.

The code path (`dropped.ts:157-163` → `world.ts:683-685` → guest `world.ts:235` → `dropped.ts:188-197`) is symmetric. Candidates,
most likely first:

1. **The event never reached a running `CoopWorld`.** A `gun add` that arrives before the guest's `begin()` is dropped
   (`world.ts:227`), and `catchUp` (`dropped.ts:200`) runs only on the host's *first* card from that peer id (`team.ts:235-238`).
   A guest still booting, or one that rejoined around the A1 kick, can miss a drop. This fits a session that also had A1.
2. **It landed where the guest didn't look.** `at` is 1.3 m ahead of the host's feet at the host's height (`dropped.ts:128`). From a
   ledge or stairs it floats in mid-air or sits inside geometry, and with no beacon or marker it is easy to miss. The take prompt
   appears only within 2.2 m.
3. **Walk-over take.** A guest who doesn't own that gun and passes within 1.1 m takes it automatically (`dropped.ts:111`). The host
   then removes it for everyone.

The fix is to log `gun` traffic and retest in the playtest's mode (E11). No code bug was found in the sync itself.

### A5. Endless Humans (Office): only the host's supply pod appeared

**Confirmed in the browser** (Crucible; the mechanism is shared by every shop mode). Guest samples from `audit-evidence.json`:

| t (ms) | guest `waves.phase` | guest `wave:clear` | guest pods |
|---:|---|---|---|
| 0 | spawning | – | spent, spent |
| 41 | spawning | at 33 | **warning**, spent |
| 89 | spawning | at 33 | **spent**, spent |
| 131 | intermission | at 33 | spent, spent |

The host at the same moment: `intermission`, pod `falling`.

Cause, step by step:

1. Both wave directors emit `wave:clear` **before** setting `phase = 'intermission'`: `waves.ts:253-255` and
   `outpost/waves.ts:123-125`.
2. The host relays it at once as a `wave` event (`team.ts:121`).
3. The guest replays `wave:clear` (`team.ts:273`), and progression calls its pod (`progression/index.ts:134-137` →
   `pods.ts:139` → `call()`).
4. A guest has no wave director (`Game.ts:111`). Its `ctx.waves.phase` comes only from the next snapshot (`world.ts:449`), which is
   up to one snapshot interval (100-170 ms) behind.
5. On the guest's next frame, `DropPods.update` sees `phase !== 'intermission'` and retires every pod (`pods.ts:201`). The pod is
   gone before the intermission snapshot arrives.

The guest's shop opens only at an open pod (`shop/index.ts:92` also needs `intermission`), so the guest can't shop or upgrade.

Sonar worked because it is an event (`world.ts:247-254`) with no phase check. The browser proof `coop-stage3.mjs:87` opens the
guest's shop with a debug `shop:open` event, so it never exercised the pod.

---

## B. Effects only the shooter sees (or only the host)

"Remote" means another player's screen. `drawFire` is `world.ts:414-430`.

### Weapons

| Effect | Drawn where | What remote players see today | Needed |
|---|---|---|---|
| Lance tap (rail shot) | `lance.ts:861-871` `drawRail`: rail beam, sheath, arcs, plasma bursts on bodies (`setOff`, 875-882) | One bullet tracer and a muzzle flash. Bursts on bodies only as `boom`s if they go through `combat.explode` | A `fire` kind for the rail: draw `fx.beam('rail')` and the arcs from the friend's muzzle to the end |
| **Lance charged beam** | `lance.ts:890-1066`: the column, sheath, shell meshes (`look`), per-tick sparks, embers, shimmer, light flashes, scorch and crack decals, loops, post flash, chromatic, radial blur | **One tracer at the beam's start, nothing after.** Kills replay (vaporize via `kill` damage) | Beam start and end events (or a held flag in the pose) and a cosmetic copy of `drawBeam` on remote screens: the column along the friend's aim, the end-point FX and decals, and the loop audio positioned there. No post FX |
| Lance ball and giant ball | `lance.ts:714-731`, `1184-1300`: projectile and orb meshes, the halo, a loop, then a ring/explosion blast | A tracer. The blast is seen only if it goes through `explode` (as a `boom`) | Draw the projectile flying (B4 below) |
| Flak (AC-130 flak / autocannon burst) | `flak.ts:99-107` ring, sparks, light, sound; fragments with heavy tracers | The `explode` part reaches others as a `boom`. The ring, the spark cone and the fragment tracers don't | `boom` kind `flak` with direction, or a `fire` kind that draws the cone |
| Raufoss | `raufoss.ts:113-135` sparks, embers, ring, burst, scorch decal, red mist | Nothing (the round shows as the shooter's tracer only) | Impact FX at the remote shot's end point, by load |
| Flechette tracers and needles | `Combat.ts:361,580` needles stuck in walls, white sparks | A bullet tracer | `fire` carries the load; remote draws needle tracers and stuck needles |
| API tracers and fire | `Combat.ts:362,581` orange sparks; ignition on the host only | A bullet tracer; burning shows through the snapshot's burn flag | Same as flechette |
| Rocket laser (sight) | `laser.ts`, `ROCKET_LASER.sight` | Nothing | Optional: a laser line from the friend's muzzle while `sight` is on (pose bit) |
| Weapon light | `viewmodels/rig.ts:212` one `SpotLight` on the viewmodel | Nothing (the friend's world stays dark) | A pose bit, and a cheap cone sprite or a shared spotlight pool on the friend's prop |
| Muzzle flashes | `fx.muzzleFlash` | Yes, from the friend's prop, the row's `muzzle` kind | Fine. Akimbo flashes only from the right prop |
| Tracers (normal guns) | `Combat.ts` `fx.tracer(spec.tracer)` per ray | One tracer per `fire` event (pellets and spread not drawn), always kind `'bullet'`, **no wall impacts, no decals** | Send pellet count or a seed; draw the per-pellet tracers and `fx.impact` + decal at each end |
| Shell casings | `fx/index.ts:71-77` from the viewmodel | Nothing | Eject from the friend's prop on `fire` (cheap, local) |
| Akimbo | `remote.ts:94` second prop in the left hand; `fire.ak` | Two props drawn; one flash and one tracer from the right muzzle | Alternate muzzles |
| Gun Kata | `chips.ts:367-368` post flash, chromatic; the burst | The burst's `fire` events, as tracers | Fine (post FX are personal). Maybe a body glow |
| Melee and katana slashes, the energy blade | `Melee.ts:381,507-532` `fx.slash`, rings, dash streaks | Swing sound and a **`shoot` animation**, no slash | `fire` kind `melee` with the swing type: play a swing clip and the slash FX at the friend's blade |
| Energy blade dissolve | vaporize on kill (`damage.ts` `gore.vaporize`) | Yes: the `kill` damage carries `vaporize`, replayed locally | Fine |
| Flamethrower (Kiln) | `Flames.ts:118,157,264` hose and stream, napalm pools, scorches | A bullet tracer per 20 ms-deduped `fire` | `fire` kind `hose`; remote runs a cosmetic `Flames` stream from the prop |
| Grenades (thrown) | `Weapons.ts:2345` throw, local projectile | Nothing until the `boom` | Draw the thrown grenade (B4) |
| Jump Jet flames | `remote.ts:129-145` | **Yes** (pose move `jet`) | Fine |
| Stim, heal and visor animations | viewmodel off-hand (`rig.ts:298,607`) | Nothing | A pose bit, plus a one-shot body gesture and a stim sound |
| Reloads | viewmodel | Nothing | A pose bit and a reload clip (`smg_reload` sound already exists) |

**B4. Projectiles.** Every remote projectile is a straight tracer: a friend's rocket, grenade, plasma ball, stake or launcher round
(through `fire`), and every **enemy** rocket or grenade (`world.ts:630-635` sends a `ray`). The explosion comes later as a `boom`.
What's needed: a `shot`/`proj` event with kind, origin, velocity and fuse, so each machine flies its own cosmetic copy (no
damage), the way `ProjectileVisuals` already draws them.

### Call-ins, implants, the world

| Effect | Drawn where | What remote players see today | Needed |
|---|---|---|---|
| Aircraft (jet, gunship, attack chopper, door gunner's helo, AC-130, Black Sun, orbital, nuke) | caller's `progression/callins/*` | Feed line "X called in Y" (`world.ts:237-245`) and every explosion as `boom` (24/s cap). **No aircraft, beams, rounds in flight or orbital column** | `callin` with its targeting result (id, point, heading, seed); each screen flies a cosmetic copy, with damage still only from the caller's claims |
| The mech (Frame call-in) | `frameDrop.ts`, `src/frame/*` | The drop pod, the Frame and its weapons are the caller's only. Others see the caller's Bailiff wherever the pose puts it. The Frame's shells are `worldObject` blasts and **don't `boom`** (`frame/weapons.ts:288`, `world.ts:638`) | Draw a Frame puppet (pose flag + yaw), and `boom` its shells |
| Sentry / AA sentry | caller's | Nothing; its kills replay | Puppet at a sent position |
| Sonar | shared (`world.ts:247-254`) | **Yes** | Fine |
| Thermal | `chips.ts` (local view) | Nothing, by design | Fine (a personal vision mode) |
| Focus | disabled in co-op (`chips.ts:264-267`) | n/a | A design decision, not a gap |
| Explosions | `boom` (`world.ts:357-381`) | **Yes**, with sound and shake, capped at 24/s | Also send world-object booms (barrels, props) as visual-only `boom`s |
| Blood pools and stains, gore decals | each machine's own `Gore` and `blood` | Each machine makes its own on deaths and replayed hits (fine, client-side). Wound drips on living men only after `hitfx` | Covered by E3 |
| Bullet holes and impact decals | shooter's `Combat.impact` and `decals.add` | **None from other players' shots** | Remote `fire` end-point impacts (see Tracers) |
| Supply pods | each player's own (`progression/index.ts:113`) | Broken on guests (A5) | E2 |
| Weapon caches / drop pods (non-shop modes) | each player's own | Same race: `onWaveClear` → `call()`; `pods.ts:201` only retires *supply* pods, so caches survive | Fine after E2 |
| Pickups | each player's own | By design | Fine |
| Dropped weapons | host-synced (`dropped.ts`) | Works in the probe; see A4 | E11 |
| Destructible props (`world/breakables.ts`) and barrels | Each machine breaks its own when its own shots or booms reach them. A remote `boom` is drawn with `fx.explosion` but never damages world objects, and a remote bullet hits nothing there | **Props diverge.** A host's broken window or exploded barrel can still be whole for the guest. A guest's local barrel blast does hurt enemies (claims) but isn't sent | Host-authoritative break events (prop id), applied cosmetically everywhere |
| Capture skyhook (airlift drone) | host's `outpost/airlift.ts` | **Nothing.** The cuffed man is withdrawn from the snapshot and pops out after 500 ms | `airlift` event (uid, path seed); the guest flies the drone and the hook, ragdolling the replica |
| Enemy attacks: telegraphs, glints, sniper lasers, muzzle flashes, gunshot sounds, swing and lunge sounds | host's AI (`attacks.ts:150-272,305-451`, `outpost/weapons.ts`) | Tracer (`ray`) only, plus the coarse attack animation byte. **No sound, no flash, no laser** | An enemy-attack event (uid, attack id, phase), or attack id and phase bits in the snapshot; the guest plays the same telegraph, sound and flash locally |
| Enemy voices (pain, barks, deaths) | host's `say()` | Death voice on `kill` replay; outpost chatter replicated; pain and barks not | Follows E3 (local `react`) |
| Vehicles | host, 5 Hz `vehicles` | Model puppets; no wheels, guns, muzzle flashes or wrecks | Fire events; wreck state |
| Garrison (allies) | host, 5 Hz `allies`, tracers `ashot` 30/s | Bodies, posture and tracers; no sounds | Fine for now |
| Implant parts on bodies | n/a | Not drawn | Known limit |

---

## C. Lag and jank

### C1. Rates and sizes (read from the code)

| Lane | Rate | Size | Encoding |
|---|---|---|---|
| `world` snapshot, host → each guest | `SNAPSHOT_MS` 100 (`worldProtocol.ts:8`), **frame-gated**: `nextSnapshot = now + 100` (`world.ts:667`), so the real interval is 100 ms rounded **up** to the host's next frame | 12 + 45·n bytes (`worldProtocol.ts:9-10`): **20 enemies 912 B, 40 enemies 1,812 B**, 48 (the cap, `waves.ts:16`, `decodeWorld` rejects >48) 2,172 B | Binary (DataView) |
| `pose`, each player → host → others | 20 Hz (`pose.ts:2`), throttled per frame | 40 + 1-32 B, about 43-48 B | Binary |
| `action` events | per event | JSON `{ match: uuid, data }`: `hitfx` ≈ 391 B, `hit` claim ≈ 443 B, `kill` ≈ 470 B, `fire` ≈ 233 B (measured with representative values; floats print to 16-17 digits) | JSON |
| `vehicles`, `allies` | 5 Hz (`world.ts:657`) | JSON: about 120 B per vehicle; about 50 B per ally row | JSON |
| `card` / `team` | 4 Hz | about 200 B | JSON |
| `boom` | ≤ 24/s (`world.ts:44`) | about 150 B | JSON |
| `ashot` | ≤ 30/s (`world.ts:34`) | about 120 B | JSON |

**Bandwidth per guest (host upload), before trystero, SCTP and DTLS overhead:**

| | 20 enemies | 40 enemies |
|---|---:|---|
| Snapshots at 10 Hz | 9.1 KB/s | 18.1 KB/s |
| `hitfx` at 20 hits/s (a busy fight; every pellet is a hit) | 7.8 KB/s | 7.8 KB/s |
| `hitfx` at 60 hits/s (shotguns or a minigun into a crowd) | 23.5 KB/s | 23.5 KB/s |
| Kills, fire, poses, cards | about 2-4 KB/s | about 2-4 KB/s |
| **Total per guest** | **about 19-37 KB/s** | **about 28-46 KB/s** |
| **× 3 guests (host upload)** | **about 57-110 KB/s** | **about 85-140 KB/s (0.7-1.1 Mbit/s)** |

Guest upload is mostly `hit` claims: 443 B each, one per pellet or ray that touches a replica. A guest shotgun blast into a crowd
is about 8-12 claims, about 4-5 KB. That's fine on broadband, but `hitfx` is the biggest variable cost, and it scales with every
player's hits × the number of guests.

**Measured** in probe 2 (`audit2-evidence.json`): 15 fps cap, host at 12 fps, a live wave of 12-18 enemies, nobody shooting.

| | Value |
|---|---:|
| Snapshot payload | 3,296 B/s |
| Events | 1,117 B/s (3 events/s) |
| DataChannel bytes sent by the host | 5,799 B/s |
| `CoopSession.cpuMs` | 0.18 ms |
| Snapshot arrivals at the guest, over 8 s | 47 |
| Gap between arrivals | **p50 166 ms**, p90 169 ms, max 286 ms |
| Gaps over 150 ms | 46 of 46 |

The frame gating (`now + 100`, then wait for a frame) turned the "10 Hz" lane into **6 Hz** at 12 fps. At 60 fps it averages about
108 ms (9.2 Hz); at 30 fps, about 117 ms.

### C2. Interpolation and buffering

- **Poses** (`pose.ts:59-90`) are done properly: an arrival-time buffer 100 ms behind, interpolating between two buffered frames.
- **Enemy replicas have no buffer** (`world.ts:461-464`, `496-503`). On every snapshot, `from` is reset to wherever the replica is
  drawn now and `to` to the new state. Then `alpha = (now - at) / SNAPSHOT_MS` is clamped to 1.
  - When the next snapshot is later than 100 ms (always, see C1), the enemy **stops** at the target until the next one arrives.
    That is 0-17 ms per snapshot at 60 fps, 66 ms at 12 fps, and any network hiccup stalls the whole crowd.
  - When one comes early, it re-bases mid-lerp.
  - Velocity is sent but used only for the gait, never to extrapolate.

  This is the main "enemies are laggy" cause, made worse by C4 (head-of-line stalls).
- Yaw lerps the shortest way, with no angular smoothing across snapshots.
- Coarse animation (`world.ts:474`) is only edge-triggered on a *change* of the byte. A stagger that begins and ends between two
  snapshots never plays; a melee windup straight after another windup plays once.
- Vehicles: position lerps over 200 ms; the quaternion slerps 0.25 **per frame** (`world.ts:493`), so it turns faster at higher
  frame rates. Allies lerp over 200 ms (`world.ts:816`).

### C3. What's sent per enemy, and what isn't

The sent fields are in A2. These are not serialized: wounds and severity, fractures, maim and crawl, living knockdown ragdolls,
blood level, the attack id, aim and telegraph, reaction clips, get-up, and the outpost soldier's identity (name, rank, squad). The
guest invents those (A2). Ragdolls and corpses aren't serialized; each machine makes its own from the `kill` damage, which is the
right model. Limbs: the sever mask, plus `sever` events.

### C4. Transport

- **One reliable, ordered channel for everything.** `trystero.ts:75-83` makes every lane a trystero action, and trystero 0.27 runs
  each peer over one reliable, ordered RTCDataChannel. A lost packet holds back every lane behind it: snapshots, poses, hits and
  chat. The SCTP resend costs an RTT or more, and then a burst arrives. Snapshots and poses are latest-wins data and should be
  unordered with no retransmit. `coop-robust.mjs`'s "5% resend stalls" simulate exactly this.
- **Ordering across lanes** happens to be preserved (one channel), but the game logic assumes things it doesn't check:
  - A `wave` event outruns the snapshot that carries its phase (A5).
  - A `hitfx` or `sever` for an enemy the guest hasn't spawned yet is dropped (`world.ts:318`, `342`).
  - A `kill` for an unseen enemy spawns it just to kill it (`world.ts:304-307`), which is fine.
- *(Measured 2026-11-19, wire lane: the relay costs the second link and about 1 ms; `coop.md`, "The wire", Guest to guest.)* **The host relays guest↔guest** (`fire`, `boom`, `sonar`, `callin`, poses): one extra hop of latency between guests.
- *(Fixed 2026-11-19, wire lane: `coop.md`, "The wire", Backpressure.)* **No congestion control or backpressure.** The `send()` result is ignored (`trystero.ts:78`). A slow guest's buffer grows
  without limit while the host keeps queuing.

### C5. Encoding and allocations

- **JSON events carry a 36-char match UUID** on every message (`lobby.ts` `gameplay`), the full `DamageInfo` (including `undefined`
  keys dropped, and 17-digit floats), and string enum values. A compact binary `hitfx` (uid u32, region u8, bone u8, type u8, point
  and dir as i16, severity u8, health and armour f32) is about 24 B against about 391.
- **Every event is stringified twice:** once by `broadcast` *just for the stats counter* (`world.ts:188`:
  `new TextEncoder().encode(JSON.stringify(...))`) and once by trystero.
- **Per-frame allocations in net code:**
  - `updateGuests` builds `new THREE.Vector3(...to.position)` per replica per frame (`world.ts:499`).
  - `receiveSnapshot` makes `{ ...replica.to, position: toArray() }` per enemy per snapshot (`world.ts:462`).
  - `decodeWorld` makes arrays, a Set and objects per enemy.
  - `frame()` makes `toArray()` arrays, an object and a `REGIONS.reduce` per enemy (`world.ts:432-441`).
  - `unpack` makes three `Vector3`s per event.
  - `drawFire` scans `[...remotes.values()]` per shot.
- **Host cost that scales with enemies × players.** `select()` runs per enemy per host frame (`EnemyManager.ts:439`) and calls
  `players()` (`world.ts:506-554`). For every remote, `players()` calls `remote.buffer.sample(now)` **twice** (`world.ts:511`, `547`),
  and each `sample` allocates a new pose with mapped arrays. `selectTarget` then maps the list into new objects (`world.ts:557`).

  40 enemies × 3 guests is about 240 pose samples and 120 small arrays per frame, plus a line-of-sight raycast per enemy every
  200 ms (`world.ts:567-570`). `enemyRay` (per enemy shot), `blast` (per explosion) and `playerEyes` (per fleeing man) each call
  `players()` again. Measured overhead is small with one guest (0.18-0.74 ms), but it grows linearly and is pure garbage-collector
  churn.
- **Hit-claim validation** does a physics raycast per accepted claim (`world.ts:274-275` → `visible`): about 8-12 per guest
  shotgun blast, all on the host's main thread.
- **The host simulates everything for everyone:** AI, physics, the full damage model, gore for every player's hits, and the outpost
  layer. That's correct for authority, but it is why the host's frame sets the whole party's tick rate (C1).

### C6. The hidden-tab worker tick

`keepTickingWhenHidden` (`Game.ts:198`) steps the game on a dedicated worker's 33 ms message while the tab is hidden, without
rendering. Snapshots then follow the 30 Hz tick: about 8 Hz measured (`coop.md`), because of the same `now + 100` frame gating.

The gating cost the hidden case 1-2 Hz. More importantly, a hidden host still runs the full simulation at up to 30 Hz on a
background-throttled CPU, and its `dt` jumps if the worker message is late (`time.tick` gets wall time).

### C7. Things that scale badly

- Host upload: N guests × (snapshots + every event). `hitfx` scales with all players' hits.
- `players()` per enemy per frame (C5).
- Guest↔guest traffic relayed through the host.
- The `dead` tombstone set (`world.ts:83`) grows for the whole match.
- `hitfx` per pellet (shotguns ×8-12).
- `delayed` blasts are filtered twice per frame (`world.ts:663-664`); trivial.

---

## D. Known limits in `docs/notes/coop.md`, re-checked at `da2ff4c`

| Limit | Still holds? | Where |
|---|---|---|
| No host migration | **Yes.** A guest closes `host-left` (`lobby.ts:565`); the world exists only on the host | `lobby.ts:563-566`, `coop.md` failure table |
| Call-in aircraft unseen by others | **Yes.** Only the `callin` feed line and `boom`s are sent (`world.ts:115`, `237-245`) | B (call-ins) |
| Guest bullets vs vehicles | **Yes.** `claim()` covers enemies only, and guests draw vehicles as puppet models with no colliders (`world.ts:828-853`). Only a guest's *explosion* damage reaches vehicles (`world.ts:368-370`) | |
| Guests can't repair or hire in Outpost Defense | **Yes.** Repairs update only off-guest (`defense/index.ts:282`); the Barracks is skipped for guests (`defense/index.ts:636`) | |
| Grabbing a prisoner as a shield, questioning him | **Yes**, host only (the guest's E is capture only, `world.ts:724`) | |
| Living knockdown get-up blends, per-muscle wound animation on guests | **Yes** (A2, C3) | |
| Implant parts on friends' bodies | **Yes** | `remote.ts` draws the Bailiff and a prop only |
| The Frame is the host's alone in missions | **Yes**, and in survival the Frame call-in is unseen by others (B) | |
| Focus does nothing in co-op | **Yes** (`chips.ts:264-267`) | |
| No four-player or multi-machine test | **Yes.** Probes here are two pages on one machine | |
| The browser proof covers the guest's shop | **Misleading.** It opens the shop by a debug event; the guest's pod is broken (A5) | `coop-stage3.mjs:87` |

---

## E. Fix list, by priority

Sizes: **S** is under half a day, **M** one to two days, **L** several days. None of these is done.

1. **E1 Load barrier (A1). M.**
   - The host deploys into an empty map: waves, wave director, campaign runner and contract timers held, with a "Waiting for X to
     load" banner.
   - It starts when every match player's first `card` has arrived (`team.arrived`), or after a timeout (about 90 s) with a lobby
     line naming who it gave up on.
   - While a guest is booting, the guest suspends `SILENCE_MS` and `HOST_WAIT_MS` (or sets them to several minutes), and the host
     does the same for guests not yet arrived.
   - Show `lobby.error`'s real message at `Game.ts:318`, and `console.warn` the code.
   - Fix `coop-kit.mjs` for the first-launch Retraining route.
2. **E2 Supply pod race (A5). S.**
   - Carry the phase in the `wave` event and set `ctx.waves.phase`/`nextWaveIn` on the guest when it's replayed (`team.ts:270-274`).
   - Also move both directors' `phase = 'intermission'` above the `emit('wave:clear')` (`waves.ts:253-255`,
     `outpost/waves.ts:123-125`).
   - Add a browser assertion that the guest's pod lands and opens after a real wave clear.
3. **E3 Client-side gore on guests (A2). M-L.** This is the change the owner asked for.
   - Let a guest run `EnemyDamage`'s *cosmetic* half on its replica, with no health, armour or kill: wound with real severity,
     `react` (stagger, flinch, knockdown), head pellets, blood spray and drips, and sever through `EnemyDamage.sever` (sound, scream,
     `updateMaim`). A cheap way is a "cosmetic apply" flag on `apply` that skips the health, armour, limb-HP and kill side effects.
   - **For the guest's own hits:** run it immediately on the local hit (prediction), not after `hitfx`. The host skips sending
     `hitfx` back to the shooter.
   - **For other players' hits:** `hitfx` triggers the same cosmetic apply. Keep `hitfx` small: uid, bone, region, type, point, dir,
     severity, blocked and the host's verdict bits (`torso`, `spill`, headshot outcome).
   - Make the distance-based gore choices (`blowsOut`, `gutShot`, pellet size; `damage.ts:858`, `gore/index.ts:1181`,
     `wounds.ts:175`) use the **shooter's** eye, which `hit` claims already send (`origin`).
   - Deaths already replay locally; also pass the blast roll in `kill`.
   - The research doc in `docs/research/` covers the Killing Floor side.
4. **E4 Snapshot interpolation buffer (C2). M.**
   - Put the host's send time (or sequence × interval) in the header.
   - Buffer snapshots on the guest and render 100-150 ms behind, interpolating between buffered pairs, as `PoseBuffer` does, with a
     short velocity extrapolation when the buffer runs dry.
   - Fix the send clock to `nextSnapshot += SNAPSHOT_MS` (no frame drift; catch up by at most one).
   - Interpolate yaw and replay the animation byte from the buffer.
5. **E5 Enemy attacks on guests (B, C3). M.**
   - Send the attack id and phase (in the snapshot as a byte, or as a small event) and have the guest run the same telegraph,
     sound, muzzle flash and laser locally from the replica's muzzle.
   - Send enemy projectiles as projectile events, not `ray`s.
6. **E6 Remote weapon FX parity (A3, B). M to start, L for all.** In this order:
   - Lance beam start and end, rail, giant ball;
   - projectiles (rockets, grenades, balls, stakes) as cosmetic flights;
   - per-pellet tracers with wall impacts and decals at the end points;
   - load FX (flechette, API, Raufoss);
   - melee swing and slash; Kiln hose;
   - casings; weapon light, reload and stim gestures (pose bits).

   Extend `fire` with a `kind` and a seed instead of growing new event types per gun.
7. **E7 Unreliable lane for snapshots and poses (C4). L.**
   - Open a second RTCDataChannel per peer with `ordered: false, maxRetransmits: 0` beside trystero's (trystero 0.27 doesn't expose
     channel options; it needs the `RTCPeerConnection` already wrapped in `trystero.ts:34-63`, or a trystero patch or upgrade).
   - Keep events on the reliable channel. Add backpressure: check `bufferedAmount` and skip a snapshot when a guest is behind.
8. **E8 Compact event encoding (C5). M.** *Done 2026-11-19 (wire lane): batches, a match tag, every event packed, bytes counted at the encode. `coop.md`, "The wire".*
   - Make `hitfx`, `hit`, `kill` and `fire` binary, or at least drop the per-message match UUID (put it in the lane handshake),
     quantize vectors and use enum indexes.
   - Batch a frame's events into one message.
   - Remove the stats `JSON.stringify` in `broadcast` (`world.ts:188`); count bytes at the transport instead.
9. **E9 Host per-frame cost (C5). S.** *Done 2026-11-19 (wire lane): the player list once a frame, each pose read once, the target pick makes nothing. `coop.md`, "The wire", Host cost.*
   - Compute `players()` once per frame and reuse it in `select`, `enemyRay`, `blast` and `playerEyes`.
   - Sample each remote's pose once per frame.
   - Reuse vectors in `updateGuests`, `receiveSnapshot` and `frame()`.
10. **E10 Call-ins, mech and skyhook on every screen (B, D). L.**
    - `callin` carries the targeting result and a seed, and each screen flies a cosmetic copy of the aircraft or beam. Damage stays
      the caller's claims.
    - Draw a Frame puppet; `boom` the Frame's `worldObject` shells.
    - Send an `airlift` event so the guest sees the drone take the prisoner.
11. **E11 Dropped-gun diagnostics (A4). S.**
    - `console.info` every `gun` op on both sides, and retest Endless Humans on the Office with a guest that loads slowly.
    - Run the drop catch-up on every guest `begin()` (not only the first card) or have the host resend live drops on `arrived`.
    - Consider a marker or beacon over a drop so it can't be missed.
12. **E12 Shared destructibles. M.** Make breakables and barrels host-authoritative: a break event by prop id, applied cosmetically
    on every screen, and world-object `boom`s sent as visual-only.
13. **E13 Endless Humans identity. S-M.** Send each man's name id, rank and squad once (on first sight, or in a spawn event), so a
    guest doesn't invent its own.

**Top 10 in order:** E1, E2, E3, E4, E5, E6 (Lance and projectiles first), E7, E8, E9, E11.
