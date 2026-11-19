# Co-op gameplay parity audit ("audit-play", 2026-11-18)

Read-only audit of `coop-overhaul` at `958212f`. Question: does a guest (and a third and fourth player, relayed through the host)
play the same game the host plays, and does every player see what every other player does?

This builds on `docs/notes/coop-audit.md` (same day). **Nothing from that audit is repeated here**, in particular its section B
table (effects only the shooter sees), its A1 load race, A5 supply pod race, C lag sections and D known limits. Where a finding
here touches one of those, it says "audit X" and adds only what is new.

**How it was checked.** By reading the code paths, every finding cites `file:line`. One scratch script (outside the repo, run with
`vite-node`) fed the real `ClaimValidator` the timings and claims described below; its output is quoted as "probe". No browser run,
no dev server, no file in the repo changed. Each finding is marked **verified** (read in code, or probed) or **suspected** (follows
from the code but one link was not traced, or needs a browser to be sure).

**Severity.** blocker = the mode or weapon does not work for a guest; major = works wrongly or pays the wrong player; minor = edge
case; polish = feel.

**Lanes** are the plan's stage table (`docs/notes/coop-overhaul.md`): session, enemies, gore, weapons fx, call-ins, world state,
time, wire. Hit acceptance (`src/net/authority.ts`) has no lane of its own in that table. Findings about it are tagged
**claims**; I recommend giving it to one agent as a small lane of its own (it touches only `authority.ts` and the `claim`/`hit`
parts of `world.ts`), otherwise fold it into world state.

---

## 1. The ten things that matter most

1. **Endless Humans cannot be won in co-op** (V1). The Commander's death ends the run on the host's screen only, and puts the
   host's game in `gameover`, which stops the host's simulation. Guests are left in a frozen world with no board.
2. **The host throws away a guest's shots when they come faster than 65% of the gun's listed rate** (P1). Berserk, Haste, a
   rate mod, or plain network bunching does it. Probe: an SMG at double rate lands 20 shots of 40; four shots that arrive
   together land 1 of 4.
3. **A guest's Kiln sets nobody on fire, and no guest effect can burn or freeze** (P5). Burn and freeze are written straight
   onto the guest's local copy and never reach the host.
4. **The line-of-sight check rejects honest hits** (P3): shots through walls by the guns built for it (Lance, Sabot,
   Piledriver), ricochets, peeking round a corner, men whose chest is behind cover.
5. **The villain is the host's alone** (V2). His briefings, barks and warning chips never show on a guest. His shutters, mines,
   wires, claymores, snares and smoke do not exist on a guest's screen, cannot be shot by a guest and only trip on the host.
6. **Outpost Defense: the fort is not shared** (M1). Wall and gate damage, breaches, repairs and lost shops exist only on the
   host. A guest sees whole walls and enemies walking through them.
7. **Kill credit and rewards go to the wrong player** (E1, E2). A host call-in kill on an enemy a guest touched once pays the
   guest. A guest's execution gives the host the Geneva perk.
8. **Guests are immune to several enemy attacks, and cannot dodge one** (E8, E9): the Burner's flames, vehicle rams, wreck fire
   and the villain's traps hurt only the host; a boss's ground slam cannot be jumped by a guest.
9. **A guest gets no kill confirmation** (P10, P11): no kill marker, a headshot kill plays the "did not kill" sound, no
   hit-confirm audio. The host hears the guest's hit markers instead.
10. **Not everything a mission does is mirrored** (M2): the sky being shut to call-ins, the lights, the Thermal brain chip a
    mission hands out, the courier set piece, and every trigger that waits for the player to do something (fire, stim, slam,
    Gun Kata, call-in) counts only the host.

---

## 2. Claims: what the host does with a guest's damage

Background, verified: every hit a guest lands goes `Combat.strike` → `EnemyManager.applyDamage` (`EnemyManager.ts:862`) →
`CoopWorld.claim` (`world.ts:205-225`), which sends a `hit` and returns a prediction with `killed: false` always. The host checks
it in `ClaimValidator.validate` (`authority.ts:65-104`) and, if it passes, runs the real `applyDamage` with the same
`DamageInfo`. A claim is one of three kinds by its `source` and `type` (`authority.ts:22-25`): **shot** (needs the guest's
matching accepted `fire` event, a line of sight, at most 64 hits per shot), **blast** (`type: 'explosive'`: no shot, no sight
line, 160 a second), **assist** (a source in the `ASSIST_CLAIM` list: needs a call-in announced in the last 4 minutes).

### P1. Fire-rate check drops real shots, and every hit of a dropped shot. Blocker. Verified (probe). Lane: claims.

- `acceptFire` (`authority.ts:55-64`) refuses a `fire` that arrives less than `def.interval × 0.65` after the last accepted one,
  measured on the **host's arrival clock**. A hit is only accepted for the last accepted shot number (`authority.ts:73`), so a
  refused `fire` loses all of that shot's hits.
- The guest's real interval is `def.interval / fireRate / akimbo` (`Weapons.ts:1053`). `fireRate` is 1.5 under Berserk or Haste
  and up to 2 with both or with Geneva stacks (`progression/perks.ts:165-172`, cap `implants.ts:102`; 4.5 on `?implants=0`).
  Rate mods shorten it too (`weapons/mods.ts:132,139,148,176,199,205`), and the host reads its own `WEAPONS` table, not the
  guest's fitted gun.
- Probe, SMG (75 ms): at 75 ms 40/40 accepted; at 50 ms (1.5×) 40/40 with a 1.25 ms margin; at 48 ms 20/40; at 37.5 ms (2×)
  20/40. Four shots arriving 5 ms apart (a normal burst after any hiccup on a reliable ordered channel, audit C4): 1 of 4.
- So a guest on Berserk or Haste, or on a bad moment of the link, loses up to half its bullets. This is the likeliest cause of
  "my shots do nothing" reports from guests.
- **Fix sketch.** Replace the gap test with a token bucket per guest and gun: refill at `1 / (interval / 2 / akimbo / rateMod)`
  (the perk cap is 2), burst of about 6, so honest bunching passes and a flood does not. Accept a hit for any shot number the
  bucket has admitted in the last few seconds, not only the latest. The guest can also send its fitted rate mod once (a mod id
  from `mods.ts`), so the host uses the right interval.

### P2. The Judge's fan lands only its first round. Major. Verified (probe). Lane: claims.

- The fan fires a round every `gap: 0.1` s (`weapons/data.ts:468`, `Weapons.ts:2128-2140`); the Judge's interval is 0.42 s, so the
  host's floor is 273 ms. Probe: fires at 0, 100, 200 ms → accepted `[true, false, false]`; a hit for shot 2 → rejected.
- **Fix.** Covered by P1's bucket if the bucket's burst covers `altFan.bars` rounds; or a `fan` allowance like `kata`
  (`authority.ts:48-53`).

### P3. Line-of-sight check rejects honest hits. Major. Verified in code (probe for the reject itself). Lane: claims.

`validate` ends with `visible(eye, target)` (`authority.ts:101`): a ray from the **host's delayed copy of the guest's eye**
(`world.ts:266`, body position + 1.6 m, about 150-300 ms old) to the **enemy's centre**, stopping 1 m short
(`world.ts:409-413`). It wrongly rejects:

- **Shots through walls by guns that are meant to.** `Combat.playerRay` passes walls on the round's budget
  (`Combat.ts:589-601`): Lance rail (2 walls of 1.6 m, `data.ts:739-741,782`), Sabot (`penetration: 5`, `data.ts:383`),
  Piledriver (2.4, `data.ts:552`), the scout rifle (0.8), AP rounds. Probe: a Lance hit with no sight line → rejected.
- **Ricochets and hops.** `hopNearest` and `hopHeads` strike men visible from the *last body*, not from the eye
  (`Combat.ts:756-833`); the Ricochet power-up bounces off walls (`Combat.ts:603-612`).
- **Peeking.** A guest who steps out of cover and fires is still behind the corner on the host for 150-300 ms.
- **Men in cover.** Head or arm showing, chest more than 1 m behind the cover along that ray: the hit is refused. Endless
  Humans is built on cover.
- **Geometry that differs between machines**: the villain's shutters (V2), Defense walls (M1), broken props (audit E12).
- **Fix.** Test from `claim.origin` (already held within 7 m of the host's copy) to `damage.point`, not eye to centre. Skip the
  test when the gun's row has a wall budget (`penetration > 0`, the Lance) and for a hop (a `hop` flag on the claim, bounded by
  the row's bounce count). Keep the range and rate limits; this is friends-only cheating protection.

### P4. A claim over its cap is dropped whole; the AC-130's bomb is missing from the instakill table. Major. Verified (probe). Lane: claims (the AC-130 row: call-ins).

- `authority.ts:83-91`: over the cap, the claim is either recognised as an instakill or rejected, never clamped.
- `CALLIN_KILLS` (`authority.ts:33`) has `airstrike`, `black_sun`, `nuke`. The AC-130's bomb is an instakill blast with source
  `ac130_bomb` (`callins/ac130.ts:80`). Probe: `ac130_bomb` 99999 → rejected; `airstrike` and `black_sun` → accepted. A guest's
  AC-130 bomb hurts nobody.
- A sword claim of 9999 is rejected too (probe); no melee row deals that today (`melee/data.ts`), so this is a trap for later.
- **Fix.** Add `ac130_bomb: 'finisher'`. Clamp to the cap instead of rejecting.

### P5. Burn, freeze and the stuck bolt never reach the host. Major. Verified. Lane: claims (the status event), enemies (replica fields).

- These write the enemy object directly: Kiln stream and napalm patches (`Flames.ts:400,427`), Lance beam (`lance.ts:991`),
  AC-130 white phosphorus (`ac130.ts:172`), orbital (`orbital.ts:228`), Frost Nova (`progression/frost.ts:72`), the exploding
  bolt's "he runs to his friends" (`Projectiles.ts:759`).
- On a guest that object is a replica. The guest's `EnemyManager.update` returns before `updateStatus`
  (`EnemyManager.ts:387-393`), and the snapshot only sets the burn and frost **skin** (`world.ts:471-473`).
- Result: a guest's Kiln does its 9-damage lick (`data.ts:565`) and nothing else, so the gun is close to useless; Frost Nova
  freezes nobody; a guest's beam, orbital and white phosphorus leave no fire. The replica's `burning`/`frozen` number the guest
  wrote is never counted down either (suspected side effect: Frost Nova's ice shards stay on a replica until it dies).
- API rounds are fine: the host lights the man inside `apply` from `d.load` (`damage.ts:454`).
- **Fix.** One `status` claim: `{ uid, kind: 'burn' | 'freeze' | 'bolt', seconds, source }`, checked like a blast claim, applied
  by the host through `EnemyDamage.ignite` (`damage.ts:535`) or the freeze. On guests, set `enemy.burning`/`frozen` from the
  snapshot flags so local readers agree. Replace the six direct writes with one helper that does the right thing on host, solo
  and guest.

### P6. Damage that is not a gun's is treated as a gun shot, or as a call-in. Major. Verified (probe for the kinds). Lane: claims.

- Probe of `claimKind`: `emplacement`, `slam`, `sword_deflect`, `gib` → **shot**. So a guest on a mounted gun
  (`vehicles/emplacement.ts:301`), a ground slam (`player/feedback.ts:53`) or a parried round (`Combat.ts:924-932`) needs a
  matching gun shot. `claim()` then sends a made-up `fire` for the gun in hand (`world.ts:211-212`): the other players see a
  tracer and hear that gun from the guest's body. A mounted gun is limited to 64 hits per made-up shot and is checked for sight
  from the guest's body, not the gun.
- Sources in `ASSIST_CLAIM` (`authority.ts:22`) need a call-in announced in the last 4 minutes (`authority.ts:75`). That list
  holds things that are **not** call-ins: `chain_storm` and `chain_reaction` (perks, `progression/chains.ts`), `rigged`,
  `deadman`. A guest whose Chain Storm fires with no recent call-in has it rejected. Verified from the regex and the check;
  `rigged`/`deadman` not traced to their origin.
- The Frame's weapons (`frame_*`) are in the list; the window is 4 minutes from `callin:used`. Suspected: a guest still in the
  mech after 4 minutes stops doing damage (Frame lifetime not checked).
- **Fix.** Give each source an owner class in one table: gun, blast, call-in, perk, mounted gun, body (slam, parry). Perks and
  body moves pass on the rate cap alone. Never invent a `fire` for a claim.

### P7. Lance beam: 64 hits per shot, and 350 m against a 400 m beam. Minor. Verified (probe). Lane: claims.

- The beam ticks every 0.05 s on every body near the line (`data.ts:795`, `lance.ts:960-996`). Hits per shot number are capped at
  64 (`authority.ts:101`); a new shot number only comes when `claim()` re-fires after 240 ms. Probe: 64 of 100 accepted. More
  than about 12 bodies in the beam lose ticks.
- Shot range is 350 m (`authority.ts:87`); the beam reaches 400 (`data.ts:795`). Probe: a hit at 380 m → rejected.
- The re-fires are also why a remote Lance beam is heard as `railgun_fire` + `railgun_beam` every 240 ms (adds to audit B).

### P8. Seven metres of tolerance against a 26 m/s dash. Minor. Suspected (arithmetic only). Lane: claims.

`fire` and `hit` need the claimed origin within 7 m of the host's copy of the guest (`world.ts:267`, `authority.ts:90`). That
copy is 150-300 ms old. Dash is 26 m/s (`player/tuning.ts:97`): 7 m is 270 ms. Shots fired during or just after a dash on a
slow link are dropped. Fix: scale the tolerance by the guest's sent velocity and measured ping.

### P9. Hit point within 8 m of the enemy's centre. Minor. Suspected. Lane: claims.

`authority.ts:90`. Fine for men. Not checked against the Titan's size or a fast leaper seen 300 ms apart on the two machines.

### P10. A guest never gets "killed" back. Major (feel). Verified. Lane: gore (it is the same prediction work).

`claim()` returns `killed: false` (`world.ts:224`). Everything keyed on a kill at the moment of the hit is missing for guests:

- the kill hit marker; a headshot kill plays `headshot_crack`, the sound that means "did not kill", and no red mist
  (`Combat.ts:363-371`);
- kill hit-stop (`Combat.ts:378`, `Melee.ts:950-954`), the Lance's kill stop and cleave count (`lance.ts:814-831`);
- a stake pinning its kill to the wall (`Projectiles.ts:729-733`), a melee kill's fling (`Melee.ts:1087-1090`);
- the blast kill marker (`Combat.ts:1034`).
- **Fix.** Predict the kill from the replica's health (already replicated) for feedback only, or play the kill feedback when the
  host's `kill` arrives with `by` = me (`world.ts:312`). The body still dies only on the host's word.

### P11. Hit-confirm audio and `enemy:hit` go to the wrong screen. Major (feel). Verified. Lane: gore.

- A guest never emits `enemy:hit` or `enemy:severed` (neither `claim()` nor the `hitfx`/`sever` handlers do,
  `world.ts:317-345`). So the guest has no 2D hit marker sound, no body-hit crunch, no armour sounds
  (`audio/reactions.ts:233-260`), no accuracy in the run report (`ui/runreport.ts:37-42`), no headshot-hit score and no slow-mo
  headshot window (`progression/index.ts:319-331`), no Butcher (`index.ts:333-341`).
- The host's listeners have no "not mine" guard: the **host hears hit markers for the guests' bullets**
  (`reactions.ts:236` filters only allies), and the host's accuracy counts them.
- **Fix.** Guests emit local `enemy:hit`/`enemy:severed` for their own predicted hits (stage 3 does this anyway). Guard the
  host's audio and run-report listeners with `notMine()`.

### Per weapon: does it hurt enemies for a guest?

| Weapon / effect | Path | Works for a guest? |
|---|---|---|
| Bullet guns (SMG, rifles, pistols, sniper) | shot claims | Yes at base rate. Loses shots under rate perks and bunching (P1). Headshots, plates, `bossHit` correct |
| Shotguns (pump, Thresher, Deuce) | shot claims, one per pellet | Yes. Cap is `max(64, pellets × 12)` hits per shot, enough. Spread untouched |
| Rockets, launcher, grenades, Quiver | blast claims | Yes, round corners too. Hellfire rocket and autocannon shell instakills handled (`authority.ts:110-120`). Direct hit on a vehicle: no (audit D) |
| Melee, katana, energy blade, dash cuts | shot claims, source `sword…`/the club's id | Yes. Slices and vaporize replay from the kill's damage. Under Berserk with the energy blade swings can beat the 162 ms floor (P1). No kill-stop or fling (P10) |
| Kiln and napalm | shot claims of type `fire` | **Lick damage only. No burning** (P5) |
| Lance rail | shot claims, pierce 31 | Yes in the open. Through walls rejected (P3) |
| Lance beam | shot claims of type `fire` | Mostly. 64-hit cap, 350 m, no burn on survivors (P5, P7) |
| Lance ball, giant ball, rail bursts | blast claims | Yes |
| Stakes | projectile hit → shot claim | Yes. No wall pin (P10). Exploding bolt: blast yes, panic no (P5) |
| Flak airburst | `autocannon` fragments and blast | Yes (blast and shot claims). Fragments are many claims per shot: within the cap |
| Raufoss | plate prediction + component hits | Yes (as stage 2 built it, `world.ts:214-224`) |
| Flechette, API, AP, HP, +P | `load` rides in the claim | Yes. Dart bleed and API ignition run on the host (`damage.ts:453-454`) |
| Smart aim (Autoraffica) | shot claims at 75 ms | Yes |
| Akimbo | `ak: 1` halves the floor | Yes for the five akimbo guns |
| Gun Kata | `kata` opens the rate floor for its window | Yes (`authority.ts:48-53`) |
| Judge fan | shot claims 100 ms apart | **First round only** (P2) |
| Ricochet power-up, head hops | shot claims | Bounced hits round a corner rejected (P3) |
| Shock rounds arcs | shot claims of type `shock` | Yes when the arced man is in view of the guest |
| Hellfire rounds | blast claims per round | Yes |
| Ground slam, Skyfall | `slam` is a shot (P6), `skyfall` a blast | Skyfall yes. Slam only with a made-up gun shot |
| Chain Storm, Chain Reaction | assist claims | **Only within 4 min of a call-in** (P6) |
| Mounted guns | `emplacement`, a shot | Wrongly limited (P6) |
| Vehicles | bullets: no. Blasts: yes through `boom` (`world.ts:368-370`), lost if the 24-a-second boom cap drops it | audit D |

Status effects from a guest's hits: stagger, flinch and knockdown **do** run on the host (`react` inside `apply`,
`damage.ts:468`). Burn and freeze do not (P5).

---

## 3. Economy and progression per player

### E1. Kill credit goes to the wrong player. Major. Verified. Lane: world state.

`world.ts:126-130`: a kill is the claimant's, else the host's if the source is a gun, a grenade or a sword, else **the last guest
who ever landed a claim on that enemy**, else the host's. `lastHitter` never expires while the enemy lives (`world.ts:676`).

- The host's airstrike, Warthog, AC-130, sentry, mech, slam, Skyfall, a barrel, or a burn the host's Kiln started, killing an
  enemy a guest hit once minutes ago: the **guest** is paid and scored, the host is not (`notMine` is true for the host).
- A garrison ally's kill on such an enemy is marked as the guest's (no pay, but it counts as their kill on the board).
- The other way: a guest's hit that sets off a chain of tanks. The first blast runs inside the claim and is the guest's. Blasts
  queued for a later frame (`Combat.ts:956-959`) run with no claimant and a gun's source: the **host** is paid.
- **Fix.** Stamp the owner on the damage where it is made (`DamageInfo.by` = slot), carry it through blasts, burns and bleeds,
  and attribute from that. Keep "last hitter" only for bleed-outs, with a time limit, and record the host's own hits in it.

### E2. Rewards raised by host-only events go to the host. Major. Verified. Lane: world state.

- `enemy:executed` → `onExecuted` → execution score and a **Geneva** stack (`progression/index.ts:130,343-346`), with no
  "not mine" guard. A guest executes a prisoner, the host gets the perk.
- `enemy:wounded` bonus score (`index.ts:131-133`): the host's, whoever did the wounding.
- "BACK SHOT" text floats on the host's screen for a guest's back shot (`contracts/rewards.ts:45-49`). The bonus damage itself
  is applied correctly.
- **Fix.** Guard these with `notMine()`, and send the guest an `award` event (kind, uid, points, label) so its own browser
  scores, labels and grants.

### E3. Rejoining gives back credits and score only. Major. Verified. Lane: session.

`team.ts:335-339,276-283`. A guest who drops and returns has their credits, score and kills, but every gun, mod, implant, brain
chip, ammo, stim and held call-in they bought is gone, and the credits spent on them stay spent. The purse is keyed by callsign
(`team.ts:240`): two players with one name share it. Fix: the guest reports its loadout when it changes; the host keeps it
under the lobby's stable browser id and sends it back with `restore`.

### E4. The break and "next wave" belong to the host. Major. Verified. Lane: world state.

- A guest pressing L sets its own inert `nextWaveIn` to 3 and is told "NEXT WAVE CALLED IN" (`contracts/shop/index.ts:83-86`;
  Defense `defense/index.ts:367-373`). Nothing happens; the next snapshot overwrites it.
- The host pressing L ends the break for everyone, mid-purchase.
- **Fix.** L sends a `ready` to the host. The wave starts early when every living player is ready (show "2/3 ready" in the
  feed); the guest's message says what really happened.

### E5. Supply pod, caches and pickups are one per player. Major against owner decision 4. Verified. Lane: world state.

- Each browser calls its own pod at a random spot near its own player (`pickups/pods.ts:156-173`,
  `progression/index.ts:113,137`). With four players, four pods land in four places; each player sees one pod and three
  unexplained landing blasts (`pods.ts:281-283` → `boom`).
- Map pickups, kill drops and weapon caches are also per browser (`index.ts:267,494-496`): two players see different loot.
- This was a choice (`docs/notes/coop.md`, "Loot and the shop"); the owner has now decided the other way.
- **Fix.** The host picks the spot and sends `pod { id, at, kind }`; every client flies the same pod. The shop stays each
  player's own, opened at the shared pod. Pickups and caches get host ids: `pickup add/take/gone` like dropped guns
  (`weapons/dropped.ts` is the pattern). A cache's gun is granted to whoever opens it and the model stays for the others to
  take their own copy, or one gun for the first taker: owner's call, I recommend "everyone can take from it once".

### E6. Ghost power-up does nothing in co-op, for the host too. Minor. Verified. Lane: enemies.

`select()` sets `sense.ghost = false` for every enemy every frame (`world.ts:564`), overwriting `sensePlayer`
(`EnemyManager.ts:434`). Fix: host's own from `progression.isActive('ghost')`; a guest's from a pose bit.

### E7. A guest takes no damage from its own non-gun blasts. Minor. Verified. Lane: world state.

`allowsLocalDamage` (`world.ts:580-582`) lets through hazards, gun ids and `grenade`. A guest's own barrel blast cannot hurt it;
the host's can hurt the host. Most call-ins have `selfDamage: 0`, so the gap is small.

### What is right in the economy

Each player's purse, kill pay, score, combo and perks run in their own browser from the host's `kill` event with `by` and `head`
(`world.ts:311-312,349-355`). Wave pay reaches everyone (`team.ts:121,270-273`). Shop prices and locks are each player's own and
read the replicated wave (`shop/index.ts:98-99`), so `lockWave` works for guests. Heals and armour are the buyer's own. In
Crucible and Endless Humans call-ins are earned from each player's own combo (`progression/index.ts:254`); in Defense they are
bought. Vampire, Regen, Magnet, Quad work. Stims are local.

---

## 4. Enemies as a guest fights them

### V1. Endless Humans has no co-op ending. Blocker. Verified. Lane: session.

- Round 10 ends when the Commander dies: `commander:fulfilled` → the box reads his last words → `Hud.fulfilled()`
  (`ui/Hud.ts:178,376-382`) → `updateDeath` emits `run:end` and sets the state to `gameover` (`Hud.ts:515-533`).
- `onDeath` has a co-op guard (`Hud.ts:368`); `fulfilled` has none. Only `campaign:complete` is relayed as `over`
  (`team.ts:123-128`).
- In `gameover` the host's frame runs camera, fx, audio and HUD only (`Game.ts:149-163`): **the host's world stops**. Guests
  keep getting snapshots of a frozen world, with no "contract fulfilled", no board and no way back to the lobby until the host
  works it out.
- **Fix.** In co-op, `commander:fulfilled` (after the last words) sends `over { won: true }` and shows the co-op board on every
  screen, as a mission win does. `Hud.fulfilled` returns early when `ctx.coop?.world` is set.

### V2. The villain is the host's alone. Major. Verified. Lane: enemies (his words), world state (his props).

- **Words.** No `commander:*` event is in `WorldEvent` (`worldProtocol.ts:32-93`). The guest's box listens for
  `commander:briefing`, `status`, `bark`, `fulfilled`, `person` (`ui/commander/index.ts:104-109`) and never hears them. A guest
  sees no between-round briefing (what he fielded against you), no warning chips (painted, jammed, uplink, AA lock), no barks.
- **Shutters.** A real collider and mesh added on the host only (`commander/barricades.ts:49-54`). A guest walks and shoots
  through a door the host sees shut, and P3 rejects those shots.
- **Devices** (mines, tripwires, claymores, snares, beacons, charges, mortar tubes, `commander/devices.ts`): not drawn on
  guests. They trip on the host's player only (`devices.ts:345,390,398,422`). They can be shot only by the host's
  `weapon:fired` (`commander/index.ts:147-151`) or a blast on the host's physics; a guest's `fire` is only drawn
  (`world.ts:267-271`) and a guest's `boom` only drawn (`world.ts:371`).
- **Smoke** (`commander/smoke.ts:72,108`) and the jammer's false men (`jam.ts`): host screen only; the host's AI treats men as
  hidden whom the guest sees plainly.
- **What he learns.** The tracker hears the host's shots, pickups, sonar and call-ins and everyone's kills
  (`commander/index.ts:147-166`): he adapts to the host.
- **Fix.** Mirror his events as ids and variables, the way `chatter` is (`world.ts:140-145`). Make shutters and devices
  host-owned world objects with ids (`device add / armed / tripped / gone`), drawn on every screen. On the host, run
  `devices.onShot` for an accepted guest `fire`, test trips against every player (`players()`), and let a guest's `boom` reach
  `physics.radialListeners`. Feed the tracker from every player's events.

### E8. A boss's ground slam: guests cannot jump it, and only its target is tested. Major. Verified. Lane: enemies.

`shockwave` (`enemies/bosses.ts:43-59`) tests `w.player`, the one player that boss is chasing, and skips an airborne one. For a
remote target `grounded` is always `true` (`world.ts:524`) and `launch` does nothing (`world.ts:526`). So a guest is hit while
in the air (the jump is the designed counter), is never thrown, and a second player standing in the ring is not hit at all.
Fix: loop over `players()` for area attacks; take `grounded` from the pose's move (`airborne`, `jet`, `wallrun`); send the
launch with `hurt`.

### E9. Enemy attacks that hurt only the host. Major. Verified. Lane: enemies.

- **Burner flames** and any enemy flame: `lickPlayer` reads the local player (`Flames.ts:440-448`). Guests cannot be burnt.
  Each glob is also sent to guests as a bullet tracer (`Combat.ts:941` → `world.ts:630-635`), about 30 a second per Burner.
- **Vehicle ram** (`vehicles/ground.ts:480`), **wreck fire** (`vehicles/wreck.ts:153`), **the villain's crush**
  (`commander/index.ts:537`), **his devices** (V2).
- The Titan's fire tick (`bosses.ts:414`) reaches only its target.
- Right today: enemy melee (`attacks.ts:100` through the target proxy), enemy bullets and projectile direct hits
  (`world.ts:615-629`, `Projectiles.ts:637`), enemy blasts (`world.ts:642-649`).
- **Fix.** One helper `hurtPlayersIn(shape, damage)` over `players()` for flames, rams, fires and crushes.

### V3. Telegraphs. Major. Verified. Lane: enemies.

Adds to audit B's "enemy attacks" row: the ground rings that warn of a strike, mortar or slam (`telegraphs.zone`, ten callers
under `src/enemies`) are drawn by the host's `EnemyManager.update`, which a guest never reaches (`EnemyManager.ts:387-393`). A
guest is hit by mortars it was never warned of.

### V4. Prisoners. Major for parity. Verified. Lane: world state.

Audit D lists questioning and the human shield as host-only. New here:

- The guest's capture is a **0.6 s** hold with the prompt "Hold [E] to capture" (`world.ts:724-731`). The game fact is a 0.4 s
  hold and "Tap [E] to question · Hold [E] to capture".
- "X cuffed a prisoner" is fed on the host only (`world.ts:705`); other guests are not told.
- What it would take: `question { uid }` → the host runs the questioning; its reveal is shared like Sonar (`world.ts:247-254`).
  Shield: the host attaches the man to the remote player's body and that player's pose carries a bit. Release by second tap is
  the same message.

### V5. Smaller things. Minor. Verified unless marked.

- The knife's bonus on an "open" man reads `stagger`, `downed`, `rising` off the replica (`Melee.ts:1009-1019`), which a guest
  does not have: only the "from behind" half works.
- The villain's anti-air and the enemy chopper hunt only the host's aircraft (`progression/index.ts:233`,
  `VehicleTargets.setFriendly`). A guest's aircraft is never shot at.
- Blast-ring rolls key on `explosionId` alone (`damage.ts:476-480`). Each browser numbers its own blasts, so two players' blasts
  can share an id and share one roll state. Suspected effect: an odd missing limb cut. Fix: put the slot in the id.
- A guest cannot shoot an enemy rocket out of the air (`Combat.ts:485-491`): enemy projectiles do not exist on a guest.

---

## 5. Modes

| Mode | For a guest today | Verdict |
|---|---|---|
| The Crucible | Fights, earns, shops (after audit E2), call-ins, revive, wipe | Playable. P1, P3, P5, P10, P11, E1, E5 apply |
| Endless Humans, Kill House and Office | As Crucible, plus capture | **Cannot be won (V1).** Villain missing (V2). Cover makes P3 worse. Burner (E9) |
| Outpost Defense | Deploys, buys at Armoury and Infirmary | **Fort not shared (M1)** |
| The Outpost, Foreclosure | Mirrored lines, objectives, doors, rides | Gaps in M2 |
| Retraining | Not offered in the lobby (`ui/screens/coop.ts:31-35`), not in `WORLD_MODES` (`net/index.ts:11`) | Single player only: confirmed |

### M1. Outpost Defense: the fort is not shared. Blocker for parity. Verified. Lane: world state.

- Nothing in `src/net` mentions structures. Wall and gate health lives in each browser's `world/structures.ts`
  (`structures.ts:543-567`); enemies damage it only on the host (their AI runs there). A guest's walls never break: enemies walk
  through whole walls on the guest's screen, and the guest's own wall blocks its shots through a breach the host has.
- Shops lost to the enemy (`defense/index.ts:622-624`), mortar teams, the next wave's preview (`defense/index.ts:351-352` falls
  back to a placeholder on a guest, whose `ctx.waves` has no `preview`): host only.
- Repairs and hires are switched off for guests (`defense/index.ts:282,636`; audit D).
- **What it takes.** (1) Structure state from the host by index: `struct { i, hp, stage }` on change, full list on arrival;
  guests apply it to their own pieces (mesh stage and collider). (2) `repair { i }` request while the guest holds E; the host
  checks reach from the pose and runs its own `HandRepair` for that player, paying them by `credit`. (3) `hire { type }`: the
  guest's purse pays, the host spawns; refuse and refund if the roster is full. (4) Shop-lost flags and the wave preview in the
  `wave` event. (5) Mounted guns: seat ownership by id and P6.

### M2. Campaign: what is not mirrored. Major. Verified unless marked. Lane: session (runner and catch-up), call-ins (the Frame).

`MIRRORED` (`net/mission.ts:24-25`) against `MissionHost` (`campaign/host.ts`):

- **`callins(held)`** (`host.ts:361-363`): a mission shuts the sky; guests can still call strikes in.
- **`call(name)`** (`host.ts:425-500`): `lights` (the blackout grade and its sound), `crash` (curtain, ear ring), `shatter`
  (glass), **`chip`** (fits the Thermal brain chip for the mission: a guest never gets it), `courier` and `wreck` (the Packmule
  shot down: a guest sees nothing).
- **`frame`**: the mech is the host's (audit D). **`saved`**: guests get up but see no "checkpoint" notice.
- **`rack`**: mirrored, but the `took` callback is the host's (`mission.ts:28,139`). If a step waits for the gun to be taken,
  only the host taking it counts. Suspected: not checked against each mission script.
- **Event triggers** (`host.ts:146-148` listens on the host's bus). Missions wait on `weapon:fired`, `stim:inject`,
  `player:slam`, `sonar:ping`, `chip:kata`, `callin:used`, `weapon:unlocked`, `prisoner:questioned`
  (`campaign/missions/*.ts`). `callin:used` and guest fire are not re-emitted on the host. A guest doing the thing does not
  move the mission on.
- **Checkpoint restart.** Everyone down → `campaign.restart()` → the host's `Game.newRun()` (`team.ts:464-471`,
  `campaign/index.ts:124-133`). The host's whole world resets. Guests are stood up and re-deployed, but their own doors, drops,
  pickups and corpses are not reset, the score fee is taken from the host only, and the host's dropped guns are cleared without
  a `gone` (`dropped.ts:237-240`). Suspected: `run:start` clears the host's HUD world markers, so friends' name tags vanish on
  the host until their text next changes (`remote.ts:79-84`); needs a browser check.
- **Cutscenes.** Each browser plays and skips its own (`host.ts:310-312`, callback is a no-op on guests). Suspected: the host
  skipping leaves guests in the film while the fight starts.
- **Fix.** Add `callins`, `call` (for the cosmetic names and `chip`) and `saved` to `MIRRORED`. Forward a guest's trigger events
  to the host as `did { event }` and emit them there for the runner. A `reset` op to guests on checkpoint restart. One skip for
  all: the host's skip ends every film.

### M3. Third and fourth players. Verified by reading; never run (audit D).

- Relayed by the host to the others: `fire`, `boom`, `sonar`, `callin`, poses, dropped guns, and every hit, sever and kill.
- **Not** told to the other guests: "X IS DOWN" and "X BLED OUT" (`team.ts:163,357`, host feed only; they have the strip and
  the tag), "X cuffed a prisoner" (`world.ts:705`).
- Gun sharing guest to guest works through the host (`dropped.ts:170-183`).
- Zones, gathering, revive reach and spectate all read every player (`mission.ts:98-106`, `team.ts:299-303,430-450`).
- With per-player pods (E5) a break lands up to four pods and four blasts.

---

## 6. World

- **W1. Barrels can be used twice.** Adds to audit E12: a guest's own barrel blast is claimed as blast damage and accepted,
  while the host's copy of that barrel still stands for the host to use. Verified (`Combat.ts:582,1024`, `world.ts:638`). Lane:
  world state.
- **W2. A guest's dropped gun can be lost.** The gun leaves the guest's hands before the host answers (`dropped.ts:116-133`). If
  the host drops the message or `cleanKit` refuses it, the gun is gone. Whether a drop is "mine" is decided by callsign
  (`dropped.ts:191`). Minor. Verified. Lane: world state. Fix: the guest keeps the gun until `add` comes back with its own slot.
- **W3. The AC-130's blasts are not mirrored at all.** Audit B says every explosion reaches the others as `boom`. The AC-130's
  seven round types are `worldObject: true` (`callins/ac130.ts:69-80`), which `blast()` skips (`world.ts:638`), as it does the
  Frame's (audit B) and a crashing aircraft's (`callins/crash.ts:61`). A friend's AC-130 run shows nothing, not even the
  explosions, only bodies dying. Major. Verified. Lane: call-ins.
- **Right today:** mission doors (mirrored, with catch-up, `mission.ts:72,86-92`), mission pickups and racks (mirrored), hazards
  (each player's own, `world/objects.ts:714-719`), corpses and blood (local by design).

---

## 7. Co-op UI

| Item | Today | Finding |
|---|---|---|
| Teammate name tags | Yes (`remote.ts:73`) | Fine |
| Health, down, dead, ping strip | Yes (`coopHud.ts:81-91`) | Fine |
| Revive prompt and ring | Yes (`team.ts:390-421`) | Fine |
| Tab board, end board | Yes | Endless Humans win has none (V1) |
| Chat (Enter) | Yes | Fine |
| Spectate | Dead only, over the shoulder, fire cycles (`team.ts:430-450`) | Minor: with no living visible friend the camera stays on your own body |
| **Minimap** | Enemies, pickups, the host's allies (`ui/hud/minimap.ts:79,145,243`) | **No teammates.** A guest has no allies system, so no garrison either. Minor. Lane: session |
| **Kill feed** | None. Feed lines exist for joins, downs (host only), revives, call-ins, sonar | Polish: "VIPER killed the Juggernaut" for bosses at least |
| **Ping / marker** | None: no binding (`input/bindings.ts:14-63`), no event | **Should exist.** With four players and no voice it is the cheapest way to say "here". One `ping { at, kind, slot }` event, a world marker in the player's colour for 5 s, a dot on the minimap. Lane: session or world state |
| Commander box | Empty on guests (V2) | Major |
| Boss bar | Reads replicas' `isBoss` and health (`ui/hud/boss.ts:53-54`) | Works. Suspected fine through phases; not run |

---

## 8. Time

Decision 3 says no slow-mo may start on a screen without "NAME used X". Today, verified:

- The host shares `slowmo`, `timeWarp` and a boss death (`world.ts:42,172-178`); a guest's perk asks the host for up to 8 s
  (`world.ts:121-122,256-260`). **No notice is sent or shown for any of them.**
- A guest clears every scale each frame (`world.ts:174`), so on a guest the enemies slow (they follow the host) while the
  guest's own effects, ragdolls, flames and projectiles run at full speed.
- Dropped in co-op: hit-stop, the Judge fan's half speed (`Weapons.ts:2122-2124`), Focus (`contracts/chips.ts:264-267`).
- Lane: time. Nothing here is new work beyond the plan; listed so the lane has the line numbers.

---

## 9. Wire

- **X1.** A `ray` event per Burner flame glob (E9), each with a physics raycast on the host (`world.ts:630-635`). Minor.
- **X2.** Made-up `fire` events from `claim()` for damage that is not a gun's (P6, P7). Minor.

---

## 10. Correct today: do not break

Verified by reading.

- Guest hits carry the whole `DamageInfo`, so the host's one damage model decides: region and bone, headshot multiplier,
  plates, shield, ward, boss entry, ammo loads, sever multipliers, slice plane, vaporize (`worldProtocol.ts:155-158`,
  `world.ts:277-284`).
- `bossHit` is applied on both sides (`Combat.ts:312`, `world.ts:279`).
- The guest's local prediction of a plate or shield stop (`world.ts:214-224`), which Raufoss depends on.
- During a claim the host's damage model sees the **shooter** as the player (`world.ts:280`, `EnemyManager.ts:170,863`).
- Stagger, flinch, knockdown, morale, suppression and surrender all run on the host from a guest's hits.
- Blast claims need no sight line from the eye, so grenades work round corners; 160 a second.
- Gun Kata's and akimbo's rate allowances; the Hellfire rocket and autocannon shell instakills; airstrike, Black Sun and nuke.
- Mission rides: everyone rides their own copy and their rounds count as call-in hits (`mission.ts:68`, `world.ts:112-113`).
- No friendly fire: bullets do not test players, a player's blast hurts only its owner (`world.ts:642`).
- Life numbers stop damage meant for an earlier life (`team.ts:66`, `world.ts:293`).
- Each player's own kill pay, score, combo, perks and shop; wave pay for all; purse restore of credits.
- Dropped guns are numbered by the host and anyone can take them, with mods and ammo.
- The snapshot's 48-enemy limit matches the manager's hard cap (`EnemyManager.ts:242`, `worldProtocol.ts:130`).
- Sonar shared, Thermal personal.
- Zones count any living player; a closing door gathers the group; a checkpoint stands everyone up.

---

## 11. Not checked

- Anything in a browser. Every "suspected" above needs a two-page run.
- The Frame's lifetime against the 4-minute window; `rigged` and `deadman` sources; the Titan's size against the 8 m rule.
- Flyable and gunner vehicles (`src/vehicles`) with a guest in the seat, beyond the mounted gun's claim kind.
- Each mission script line by line for steps that depend on a host-only callback (`rack`, `rounds`, `health`).
- Boss phases on guests beyond the plate mask and health.
- Lobby and session edge cases (the other audit's job).
