# Retraining: the tutorial

Status: design only, 2026-11-17. Nothing here is built. The owner's brief is the source; this page turns it into stations, lines and
a build order. Every number below was read from the code on `dev` at `4743742` (plus the uncommitted work in the tree that day).
Things still being built when this was written (Jump Jet, the energy blade, flechette and API rounds, the Flail LMG) are marked
**in progress**. Their stations are written to the numbers in the tree that day, so they can slot in when each system lands.

**The flow in one line:** wake in the clone bay (with a voluntary exit behind you), then the Atrium hub, then movement (M), guns,
rounds, armour and the shop (W, P), the blade (K), brain chips (C), streaks and implants (the Pen, S), live prisoners outdoors (the
Yard, Y), call-ins and the Frame (the Proving Ground, G), and graduation by nuke, a receipt, and the door.

Words used on this page:

- **Station**: one room or area that teaches one thing. Stations are gated: the next door opens when this one is done.
- **Wing**: a group of stations off the hub (Mobility, Gallery, Cutting Room, Quiet Rooms, the Pen, the Yard, the Proving Ground).
- **Subject**: a captured man used as a target. Garrison faction, grey jumpsuit, a cyan stencilled number on the back.
- **Held / released / live**: the three subject states (section 3.0).
- `{action}` in a prompt is the campaign HUD's key cap (`src/campaign/hud.ts` `hint()`), so it shows the player's own binding. The
  default key follows in brackets.

## At a glance: how every mechanic gets demonstrated

One row per mechanic family. The full, exhaustive list with flags is section 4.

| Mechanic | Station | How it is shown | How the player proves it |
|---|---|---|---|
| Look, walk, settings (sensitivity, aim hold/toggle, hold-jump-to-hop) | I0 Intake | Settings booth by the pod, live preview | Walks to the Atrium |
| The exit door, voluntary | I0 | The Council says so; the sign is lit | (Leaving is optional) |
| Crouch, crouch-walk, jump, landing stumble | M1 Footwork | A low duct and a step course | Crouch-walks the duct, jumps the steps |
| Slide, slide boost, slide-jump, downhill slide, slide off a ledge, slide queued in the air | M2 Slide Lane | A closing shutter, a slope, a drop | Slides under the shutter before it shuts; slide-jumps a gap |
| Bunny hop, jump buffer, coyote time, air strafe, momentum, hold-to-hop | M3 Hop Line | A speed gate on the HUD | Crosses the gate at 18 m/s or more |
| Double jump and mid-air redirect | M4 | A ledge out of single-jump reach, and a pillar to bend round | Reaches the ledge; lands on the far side of the pillar |
| Dash: ground, air, cancels a fall, two charges, dash-jump | M5 Dash Gaps | Gaps at 7, 14, 19 and 23 m | Crosses the 23 m gap (jump, double, two dashes) |
| Mantle, vault | M6 | A 2.2 m ledge, waist-high cover rows | Mantles; vaults three covers without stopping |
| Wall run: side run, inside corner, run to run, dash along a wall, kick off | M7 Wall-Run Hall | The Council drops the walkway | Crosses the pit on the walls |
| Wall kick, wall coyote, zig-zag speed gain | M8 Kick Corridor | Alternating walls and a speed gate | Leaves at 19 m/s or more |
| Climb, cling (and shoot while clinging), 180 wall jump | M9 Climb Wall | A 5.2 m wall, and a target behind | Climbs, clings, shoots, 180s to the platform behind |
| Chimney | M10 Chimney | A 2.4 m wide, 20 m shaft | Reaches the top |
| Ground slam, bounce, slam into slide, big slam | M11 Slam Pit | Towers over a ring of held subjects | A big slam from 6 m+ knocks the ring down |
| Rocket jump, grenade jump, barrel, Deuce shove, launch ramp, jump pad | M12 Blast Yard | A ledge out of every other reach | Reaches it each way once |
| Jump Jet (in progress) | M13 | The implant fitted by the Council for one bay | Reaches the gantry, hovers, crosses the gap |
| All of the above chained | M14 Flow Course | One timed line through the wing | Finishes under par |
| Fire, no spread on bullets, ADS, reload, auto reload, focus zoom and its cap | W1 Lane | Steel plates at 10 to 60 m | Hits a 10 cm plate at 60 m with the focus zoom held |
| Switching, families, wheel, dry handover, drop and pick up | W2 Hands | A rack, and a dead contractor's gun on the floor | Drops a gun, takes the other one |
| Shotgun spread, pellets, point-blank severs | W3 Pattern Board | A board shows the pellet pattern | Takes an arm off a held subject at point blank |
| Live shooting, headshots, helmets | W4 The Live Range | Held subjects stand in the lanes, begging | Clears the range |
| Wound zones and their labels | W5 Anatomy | A subject at a time, a zone called | Lands four named wounds |
| HP and AP, the shop, fitting a mod | W6 Rounds I | HP on a shirt; then an armoured man; then the supply pod | Kills the armoured man with AP |
| +P, flechette, API, Raufoss | W7 Rounds II | One subject per round, each behind what that round beats | A kill with each |
| Armour classes, shooting plates off, back shots, rockets strip plates | W8 Plate School | A plated man on a turntable | Kills him from behind; breaks a plate with a medium round |
| Penetration and wallbangs | W9 Through Walls | Men behind 0.5, 1.2 and 2.4 m of wall | A kill through each |
| Scopes, ACOG, Awl 8x, focus zoom to 12x | W10 Long Lane | A 150 m lane | A head at 150 m |
| Grenades: throw, cook, shoot one out of the air, held too long | W11 Grenade Court | Subjects in a trench; a grenade lobbed in | Cooks one into the trench; shoots one in the air |
| Health regen, stims, armour plate, field dressing | W12 Infirmary | The corrective floor | Uses a stim under fire |
| Every gun's signature trick | W13 Armoury (optional) | A booth per gun | One drill per gun |
| The shop in full: buy, sell, resupply, implants and chips tabs | P1 Procurement | The supply pod | Sells a gun, buys a resupply |
| Quick melee, the blade when out of ammo | K1 Standard Issue | Every magazine is emptied | Kills with `{melee}` (F) |
| Light chain, stab, lock-dash stab | K2, K3 | Subjects at 2, 3 and 6 m | Each move once |
| Guard and parry | K4 | A subject is given a pistol | Parries a shot back into him |
| Dash-slash | K5 | A subject at 7 m | A dash-slash kill |
| Combos: Cleave, Tornado, Flying Slash, Flurry | K6 Combo Board | The inputs lit on the wall | Each combo once |
| Energy blade (in progress) | K7 | The blade fitted at the pod | Kills a plated man through the plate; a long lunge |
| Sonar and why (hidden and running men) | C1, C2 | Lights out; men hide | Finds all five; kills one through a wall |
| Thermal | C3 Smoke Hall | The hall fills with smoke | Kills four in the smoke |
| Focus chip | C4 | Four men released at once | All four down before the doors |
| Two chip slots, hold T to switch | C5 | A second chip fitted | Switches and uses it |
| Akimbo and Gun Kata | C6 The Ring | Twelve men in a ring | A full Gun Kata |
| Combo, streak perks, implants and slots | S1 to S8 The Pen | A pen of subjects; the implant bench | Triggers each perk |
| Making men surrender | Y1 Yard | A live squad of conscripts | One surrenders |
| Questioning, and that it reveals the others; lies | Y2 | A hidden squad in a bunker gets marked | Kills the revealed ambush |
| Releasing and why | Y3 | The odds shown on the HUD for this lesson | Releases one; the next surrenders sooner |
| Capture, the skyhook, the bounty | Y4 | The drone takes him; scrip paid | Captures two |
| Fleeing men, sonar to find them | Y5 Runners | Three men break and run | Catches all three |
| Cornered reactions | Y6 | Four men, four reactions | Deals with each |
| Fake surrender and its tell | Y7 | One man with a grenade | Kills him on the glint, or gets clear |
| Executions and their cost | Y8 | The Council explains; Geneva bonus shown | (Optional) |
| Co-op revive | Y9 | A downed clone | Holds `{interact}` until he is up |
| Call-ins: targeting, tap vs hold, every call-in, the Frame and flak | G1 to G10 Proving Ground | Each call-in granted in turn | Uses each on its target |

---

## 1. Premise, tone and how it is reached

### 1.1 The premise

The contractor has been **selected for retraining**. Nobody says why. The Office of Societal Compliance runs a Retraining Annex, a
Bureau facility of cold concrete, steel and cyan strip lights, and a fresh contractor is issued into it from a clone bay. It is a
refresher that walks through every system in the game. The game has a lot of deep mechanics, and no single map uses them all,
parkour least of all.

The targets are **subjects**: captured men. They are not furniture and not dummies. They are men the Bureau's drones lifted off
battlefields, held in a surrender state, kept alive, and now used "for whatever the Council needs". Today that is training a
contractor. They beg for their lives through the existing garrison voice lines. The Council does not hear them. This is dark, and it
is meant to be dark. It is the cleanest picture of the game's world: the Bureau does not hate these men and does not want anything
from them. They are an item on a training budget.

### 1.2 Tone

The same as the campaign (`docs/campaign/STORY.md`): unserious on top, bleak underneath.

- **The Council never raises her voice.** Every line is a form, a notice, a fee or a liability disclaimer. She bills for
  everything. She calls men "subjects", killing "processing", dying "a replacement".
- **She controls the level.** Per the mission lessons, the villain controls the level and reacts to the player. Here she is that
  villain. She opens and shuts the doors, kills the lights for the sonar room, floods the smoke hall, releases subjects on a timer,
  switches on the corrective floor, drops the walkway in the wall-run hall, sends in the armoured man. Every station opens with her
  doing something to the player.
- **Plain words.** Each station's intro says what is happening and what to press. The joke rides on top. It never replaces the
  instruction.
- **No dark joke at the subjects' expense from the subjects.** They are scared people. The comedy is the Council's indifference,
  never the men's fear.

### 1.3 The narrator

**The Council.** She is the same female voice as the missions: the owner's `shodan` ElevenLabs voice, tag `[deadpan]`, speaker
`council` (`src/enemies/commander/lines.ts`, `tools/scripts/voice-script.ts`). She has no name in the game. She has no face, only a
lit booth high in the hub's observation column. Her radio box reads:

> **THE COUNCIL** · Office of Societal Compliance · Retraining

Default: she stays nameless, which is funnier and matches the missions. If the owner wants a title, "Retraining Officer" fits (see
section 7).

The subjects speak only through the existing garrison chatter: `src/enemies/outpost/chatter/lines.json`, concepts `surrender`
(9 rows), `beg` (7), `panic` (10), `dying` (13), `refused` (9), `fakeOut` (6), `flee` (6), `lastStand` (6), `taunt` (12). Every row
has two voices recorded (`trooper2`, `trooper3`). No new subject lines are needed (section 7 asks whether to add a few).

### 1.4 How it is reached

| Way in | What happens |
|---|---|
| **First launch** (bare link, never played) | Pressing **Play** on the main menu starts Retraining instead of opening the Play menu |
| **Invite link** (`?join=CODE`) | **Never** Retraining. The invite flow runs exactly as now (`src/ui/screens/coop.ts`, `INVITE`): splash skipped, password page, lobby |
| **Returning player** | Play opens the normal Play menu. Retraining sits in it as **Play → Training** |
| **Play → Training** | Two rows: **Full retraining** (from the clone bay) and **Station select** (any wing or station, through the existing `?beat=` support in the mission runner). Station select appears once the player has seen the tutorial at all |
| **URL** | `?mission=retraining&autostart=1`, and `&beat=<station>` to start at one station, for testing |

**What "never played" means.** The page has never played if **none** of these localStorage keys exists:

| Key | Written when |
|---|---|
| `op2.retraining.v1` | New: the tutorial was seen (left by the door, finished, or quit). See 1.6 |
| `op2.played.v1` | New: written the first time any match reaches the playing state (`game:state` to playing), in any mode, co-op included |
| `op2_highscore`, `op2_highscore.*` | A run scored |
| `op2_campaign_beaten` | The campaign was beaten |
| `op2_starter` | A starter gun was chosen |
| `op2.implants.worn` | Implants were fitted |
| `op2.crucible.rules.v1` | Crucible rules were changed |
| `op2_coop_name`, `op2_coop_match` | The player has been in a co-op lobby |
| `op2.settings.v1`, `op2.bindings.v2`, `op2.bindings.v1` | Settings or keys were changed. Someone who rebound keys has been here before |
| `op2_adsZoom` | The focus-zoom hint counter, written only while playing |

Keys that do **not** count, because they are written without playing: `op2_browser`, `op2_chunk_reload`, `op2.reports.*`,
`op2.lab.v1.*`, `op2.cheats.v1`.

A player from before this ships who only ever played one unscored run, without changing a setting, would see Retraining once. That
is fine, because the door in 1.5 lets them leave in five seconds, and leaving counts as seen. From the day this ships, `op2.played.v1`
makes the check exact.

The check runs on the **Play** press, not on load. The splash and the menu flythrough stay as they are, and nobody is pushed into
anything before they have chosen to play. With localStorage blocked (a private window that throws), the check treats the player as
returning, so a broken storage never traps anyone in the tutorial.

### 1.5 The in-world skip: the door behind you

There is **no skip button**. The contractor is issued from a clone pod in the **Intake** room. Behind the pod, in plain sight, is an
ordinary grey door under a green sign: **EXIT · VOLUNTARY**. It is unlocked and stays unlocked.

The Council's opening (full text in station I0) welcomes the contractor to their *voluntary* retraining. Compliance has a new policy
that obliges her to inform them that they are free to leave at any time, through the door behind them. They are also highly
encouraged to complete their retraining. Voluntold.

If the player turns round and walks through that door:

1. The door opens onto white light and the fade starts as they cross the threshold. There is no confirm dialog: walking out *is*
   the choice, and that is the joke.
2. The Council's parting line plays over the fade. It is a passive-aggressive note for the file, and which line plays depends on how
   far they got (lines `tut.exit.*` in I0).
3. `op2.retraining.v1` is written (`{ seen: true, left: '<station>', finished: false }`) and the main menu comes up, Play menu open,
   free to play.

**The same door works at any time.** Intake opens onto the hub (the Atrium), and every wing opens onto the Atrium, so the exit is never
more than a short walk away. A sign in every wing points back to it: **EXIT · VOLUNTARY · STILL**. The parting line changes with
progress:

| Left | Line id | Gist |
|---|---|---|
| Before the opening monologue ends | `tut.exit.now` | Noted as decisive: you declined in under a minute |
| Fewer than 3 wings done | `tut.exit.early` | Your retraining is incomplete; your record will say so, in a small font |
| 3 or more wings done | `tut.exit.half` | You were nearly useful |
| Signed the kiosk, then left unfinished | `tut.exit.kiosk` | Two statements on file that do not agree |
| Only the Proving Ground left | `tut.exit.late` | You left before the part with the explosions |
| After graduation | `tut.exit.done` | You may now leave through the door you were always free to leave through |

**Pause menu.** Esc keeps its usual **Quit to menu**. A normal quit is not a skip button, it is the game's quit, and it also writes
`op2.retraining.v1`. The Council says nothing on a quit; the door gets the line.

### 1.6 Skip-ahead, in world too

The brief asks for gating with an optional skip-ahead. To keep "no skip button", skip-ahead is a booth:

- **The Self-Assessment Kiosk** stands in the Atrium beside the exit door. Press `{interact}` (E) at it and the Council offers to
  open every wing: "You may declare yourself competent." Tap `{interact}` again to sign. Every wing door unlocks, the Atrium's wing
  lights all turn cyan, and she files it.
- Wings can then be done in any order. The **in-wing station order still gates**, because each station's geometry assumes the last
  one's skill. Every station also has its own door back to the Atrium.
- **Station select** in the menu (1.4) is the out-of-world version for returning players.

### 1.7 Replay, saves and death

- **Saves:** `op2.retraining.v1` holds `{ seen, finished, stations: { <id>: bestTime | true } }`. Station select ticks the done ones
  and shows the flow course's best time.
- **Death** is the campaign's own rule (`docs/campaign/MISSION.md`, redeploy): the station is a checkpoint beat, so death replays
  that station from its start with its kit. The Council's line is a tutorial redeploy line (`tut.redeploy.*`), counting the
  contractors used this session.
- **Single player only.** Co-op does not run Retraining (section 7). The one co-op mechanic, revive, is taught on a downed clone
  (station Y9).
- **Unlocks:** Retraining unlocks nothing and pays nothing outside itself. Its credits are **training scrip**, a wallet that exists
  only in the tutorial.

---


---

## 2. The facility

### 2.1 The shape: a hub with wings

The Retraining Annex is a hub with wings. The hub is **the Atrium**, a tall round hall around the **observation column**: a 30 m
concrete shaft with one lit booth window near the top where the Council "sits". You never see inside the booth. The column is the
landmark: it is visible from every wing through high windows, so the player always knows where the middle is. Each wing door in the
Atrium has a big stencilled letter and a light strip: grey for locked, cyan for open, white for done.

Indoors is the cold steel and blue fog of the art direction (DESIGN.md section 3): concrete, wet floors, cyan strips. Warm colour is
kept for what the player does. Signs are forms: `BAY M-7 · LATERAL TRAVERSAL · LIABILITY: CONTRACTOR`.

The two outdoor wings, **the Yard** and **the Proving Ground**, are outdoors because they must be:

- The **skyhook** drone lifts a captured man straight up (`src/enemies/outpost/airlift.ts`). Under a roof it drags him out to open
  floor first, up to 14 m, and the owner has seen it drag men into ceilings. The capture lessons need open sky over every spot a man
  can kneel.
- **Aircraft call-ins** (AC-130, door gunner, chopper, airstrike, Warthog) need a sky to fly in, and the map tests for roofs.

### 2.2 Top-down sketch

North is up. Rough sizes in metres. `[=]` is a gated door, `[E]` is the voluntary exit, `(K)` is the Self-Assessment Kiosk.

```
                                   OPEN SKY
 +--------------------------------------------------------------------------------------------+
 |  G  THE PROVING GROUND  (outdoor, 160 x 110)                                                |
 |     concrete apron, target hulks, a mock village of 6 shells, a drone pen, the Frame pad     |
 |                                                                                              |
 |  .......................................[=]..................................................|
 |                                                                                              |
 |  Y  THE YARD  (outdoor, 90 x 70, open sky, no roofs over any floor)                          |
 |     sheds with no roofs, a sandbag line, the bunker (roofed: the hidden squad), two gates     |
 |     out of the fence where released men walk, the runners' maze of low walls                 |
 +---------------------------------------------[=]--------------------------------------------+
                                               |  the yard tunnel (cleaning station, Y9 here)
   +--------------------+        +-------------+------------+        +---------------------+
   | S  THE PEN         |        |                          |        | C  THE QUIET ROOMS  |
   |  S1-S8, 40 x 30    |--[=]---|        THE ATRIUM        |---[=]--|  C1 dark maze        |
   |  implant bench      |        |    (hub, 40 m across)    |        |  C3 smoke hall       |
   +--------------------+        |                          |        |  C4 the runway       |
                                 |          ( O )           |        |  C6 the Ring         |
   +--------------------+        |   observation column     |        +---------------------+
   | K  THE CUTTING ROOM|--[=]---|                          |
   |  K1-K8, 30 x 25    |        |  (K) kiosk       [E] exit|---+
   +--------------------+        +----+----------------+----+   |   +-----------------------+
                                      |                |        +---| I  INTAKE (clone bay) |
                                     [=]              [=]           |   pod, settings booth |
                                      |                |            +-----------------------+
   +----------------------------------+--+   +---------+--------------------------------------+
   | M  MOBILITY WING  (indoor, tall)    |   | W  THE GALLERY  (indoor range, 30 x 160)       |
   |  M1 Footwork   M2 Slide Lane        |   |  W1 Lane  W2 Hands  W3 Pattern  W4 Live Range |
   |  M3 Hop Line   M4 Double  M5 Dash   |   |  W5 Anatomy  W6 Rounds I (supply pod bay)     |
   |  M6 Mantle/Vault  M7 Wall-Run Hall  |   |  W7 Rounds II  W8 Plate School                 |
   |  M8 Kick Corridor  M9 Climb Wall    |   |  W9 Through Walls  W10 Long Lane (150 m)       |
   |  M10 Chimney (20 m shaft)           |   |  W11 Grenade Court  W12 Infirmary              |
   |  M11 Slam Pit  M12 Blast Yard       |   |  W13 Armoury (side room)  P1 Procurement       |
   |  M13 Jump Jet gantry                |   |                                                |
   |  M14 Flow Course: a loop back       |   +------------------------------------------------+
   |      through the whole wing         |
   +-------------------------------------+
```

Intake joins the Atrium by a short corridor, with the exit door in Intake itself, behind the pod. A second **EXIT · VOLUNTARY** door
on the Atrium wall leads to the same corridor. The player is never more than about 40 m of walking from a way out.

### 2.3 The order, and how the player flows

| # | Wing | Stations | Why here |
|---|---|---|---|
| 0 | **I Intake** | I0 | Spawn, settings, the door, the premise |
| 1 | **M Mobility** | M1 to M14 | Movement first: every later room assumes it, and no map teaches all of it |
| 2 | **W Gallery** + **P Procurement** | W1 to W13, P1 | Guns, rounds, armour, the shop |
| 3 | **K Cutting Room** | K1 to K8 | "When you run out of ammunition": after the guns |
| 4 | **C Quiet Rooms** | C1 to C6 | Brain chips, ending on Gun Kata, which needs the akimbo mod bought in P1 |
| 5 | **S The Pen** | S1 to S8 | Streaks and implants, which need kills in a hurry: every tool so far |
| 6 | **Y The Yard** | Y1 to Y9 | Live men, outdoors: surrender, questioning, release, capture, runners, fakes |
| 7 | **G The Proving Ground** | G1 to G10 | Call-ins, the Frame, and graduation by nuke |
| 8 | Back to the **Atrium** | — | Graduation, and the door |

Flow rules:

- Each wing's first door in the Atrium opens when the last wing is done. Inside a wing, each station's exit door opens on its
  completion, and the next station's intro plays as the player walks in. A station's trigger zone starts its intro; the player is
  never asked to wait for a line to finish before moving.
- Every station has a **back door** to a wing corridor that leads to the Atrium, unlocked from the start, so the exit is always
  reachable.
- **Kit** is set at every station's start (the `give`, `grenades`, `callins` steps, plus the new steps in 6.3). A station never relies
  on what the player happened to keep.
- **The objective checklist** (`objectives()` in `src/campaign/hud.ts`) always shows the station's goals. Done rows tick.
- The Self-Assessment Kiosk (1.6) opens every wing at once.

### 2.4 Rules every station shares

These hold everywhere unless the station says otherwise, so each station lists only what differs.

| Rule | Detail |
|---|---|
| **Hint timing** | The station's `hint` line plays if the goal is not met 25 s after the intro ends. The on-screen prompt repeats every 25 s through the existing `nudge()` cue (`src/campaign/missions/outpost.ts`) |
| **Failing a drill** | A drill that can be failed without dying (missed a jump, fell in a pit) resets the player to the drill's start pad with a 0.4 s fade. No line on the first two fails. The third fail plays the station's fail quip, and every fifth after that plays it again |
| **Dying** | The station restarts from its checkpoint with its kit; a `tut.redeploy.*` line plays |
| **Stuck for good** | After 3 minutes in one station, or 8 fails, the hint adds: `Stuck? The door behind you is open. So is the kiosk.` The station's exit door then also opens (the Council: `tut.common.waive`). Nobody is trapped |
| **Pits** | Pits are shallow, padded floors 4 m down, with a ramp back to the drill's start. There is no fall damage in the game, so a pit costs time only |
| **Subjects** | See 3.0 for their three states |
| **Scrip** | The wallet is training scrip. Every station that needs money gives exactly enough, plus a margin |
| **Shop** | Open at any time in the tutorial (new flag, 6.3), only at supply pods |
| **Score feed** | Kill feed, style labels and hit markers stay on: they are part of what is taught |

---

## 3. The stations

Each station lists what it teaches, what the player does, its setup, its completion condition, failure handling beyond the shared
rules in 2.4, its on-screen prompts, the Council's lines, and what it reuses and what is new. Line ids are short here
(`tut.m2.intro`). In code they are `mission.council.tut.m2.intro`, written in a new `src/campaign/missions/retraining.lines.ts`
with the same `council()` helper the Outpost uses. Voice lines never name keys, because players rebind them. The on-screen
prompt carries the key.

### 3.0 Subjects, and the lines every station shares

**Subjects have three states.** All three are garrison-faction soldiers (`src/enemies/outpost/`), so they keep every wound, gore,
armour and voice system the game has.

| State | What it is | Built from |
|---|---|---|
| **Held** | Standing, hands raised or bound in front, feet on a painted spot. He does not fight, flee or kneel, and he cannot be questioned or captured (the E prompt never appears). Armour works on him exactly as on a fighting man. He flinches, staggers, falls when legs go, crawls, bleeds and dies as normal. Every 4 to 9 s, when the player is within 25 m, he barks a `surrender`, `beg` or `panic` row (wounded: `dying`) | Lab dummy (`src/lab/spawn.ts` `place(id, at, 'off')`: no behaviours, no attacks) plus a new hands-up pose and a bark timer through `comms.say`. **Not** the real kneeling surrender, because kneeling men take x5 damage and ignore plates (`docs/notes/outpost.md`), which would break every armour lesson |
| **Released** | The Council opens his cuffs: he runs for a marked exit door. If he reaches it he is gone, and the drill fails | The flee planner (`src/enemies/outpost/flight.ts`) with the exit as its goal, no weapon |
| **Live** | A real Outpost soldier with real AI, used only in the Yard (and the parry in K4). Some are given forced outcomes for a lesson (6.3) | The Outpost's own spawn, plus new forcing hooks |

Subjects wear a grey jumpsuit with a cyan number on the back (no warm colours, per the art direction). Armoured ones wear the
existing plate carrier and helmet props, so the player learns what the real ones look like.

**If the player kills a subject meant for a later drill**, the drill quietly respawns him at the start of that drill and the
Council says `tut.common.waste` once per station.

**Shared lines:**

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.redeploy.1` | First death of the session | deadpan | Replacement contractor issued. The previous one did not complete this module. You will. |
| `tut.redeploy.2` | Second | deadpan | Another replacement. Retraining is billed per contractor. Please pace yourself. |
| `tut.redeploy.3` | Third | deadpan | Contractor issued. That is three this session. Clones are not free. They are merely cheap. |
| `tut.redeploy.4` | Fourth and later, in turn with 2 and 3 | deadpan | You again. The module has been reset. So have you. |
| `tut.common.waive` | Stuck for good (2.4) | deadpan | The Council has waived this module. Waivers are noted. Please proceed. |
| `tut.common.waste` | A later drill's subject was killed early | deadpan | That subject was allocated to a later module. He has been replaced. The replacement has been billed to you. |
| `tut.common.subjects` | First time a subject begs within 10 m | deadpan | The subjects are not permitted to speak to you. They do anyway. Please do not reply. |
| `tut.common.back` | Player walks back into a finished station | deadpan | This module is complete. You may repeat it. Repetition is not billed. It is noted. |

### 3.1 Intake (I)

#### I0 · The clone bay

| | |
|---|---|
| **Teaches** | The premise. Look and walk. The settings worth knowing (mouse sensitivity, aim hold or toggle, hold jump to hop). The voluntary exit |
| **Player does** | Wakes in the pod. Optionally adjusts settings at the booth. Walks through the corridor into the Atrium. Or turns round and walks out of the exit door |
| **Setup** | 12 x 10 m clone bay, cold light, a row of eight pods (seven empty, one with a fogged body in it, never explained). The player's pod opens. **Behind the pod:** the grey EXIT · VOLUNTARY door, unlocked, sign lit green. **Left:** the settings booth, a terminal: `{interact}` (E) opens the Settings screen on its Controls page. **Ahead:** a 20 m corridor to the Atrium. No weapons yet |
| **Done when** | The player enters the Atrium (zone trigger) |
| **Fail / retry** | None. Walking out of the exit is not a fail; it ends the tutorial (1.5) |
| **Prompts** | `Look around with the mouse · Move with {forward}{left}{back}{right} (W A S D)` · at the booth: `{interact} (E) Settings: sensitivity, aim hold or toggle, hold jump to hop` · over the door: `EXIT · VOLUNTARY` (a world sign, not a prompt) |
| **Reuses** | Mission runner, radio box, `hint`, `objective`; the Settings screen |
| **New** | The Intake room; the exit door trigger and fade; `op2.retraining.v1` save; first-launch routing (6.3) |

**The opening monologue.** It plays as the pod opens, one line after another, in the radio box. The player can walk at once; nothing
waits on the lines. If the player is already through the exit door, the remaining lines are dropped for the exit line.

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.i0.line` | Pod opens | deadpan | Contractor. Good morning. This is the Office of Societal Compliance. You are on a recorded line. |
| `tut.i0.welcome` | Next | deadpan | Welcome to your voluntary retraining. |
| `tut.i0.selected` | Next | deadpan | You have been selected. The reasons are on file. The file is not available to you. |
| `tut.i0.policy` | Next | deadpan | Under a new Compliance policy, I am obliged to inform you that your attendance is voluntary, and that you are free to leave at any time. |
| `tut.i0.door` | Next | deadpan | The exit is the door behind you. It is unlocked. It has been unlocked since you were issued. |
| `tut.i0.encourage` | Next | deadpan | You are, however, highly encouraged to complete your retraining. Contractors who complete it are valued. The others are also valued. Differently. |
| `tut.i0.note` | Next | deadpan | There is no penalty for leaving. A note will be made. A note is not a penalty. Please do not confuse the two. |
| `tut.i0.subjects` | Next | deadpan | Today's exercises use live subjects. They have been processed for your convenience. You may hear them. That is normal. |
| `tut.i0.settings` | Next | deadpan | The booth on your left adjusts your sensitivity and your aim. The Council recommends you set them now and complain later. |
| `tut.i0.go` | Next | deadpan | When you are ready, walk forward. Or back. Forward is preferred. |
| `tut.i0.hint` | 40 s in Intake | deadpan | The Atrium is ahead of you. The door behind you is also still there. Both facts remain true. |
| `tut.i0.done` | Enters the Atrium | deadpan | You have chosen to stay. This has been recorded as enthusiasm. |
| `tut.i0.turn` | Player faces the exit door within 3 m, once | deadpan | That is the exit. It works. I am required to say that it works. |

**The exit lines** (1.5). One plays over the fade as the player leaves.

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.exit.now` | Left before the monologue ended | deadpan | Contractor has declined retraining in under a minute. This has been noted as decisive. Have a productive day. |
| `tut.exit.early` | Left with fewer than 3 wings done | deadpan | Retraining incomplete. Your file will say so, in a small font. Nobody reads the small font. I read the small font. |
| `tut.exit.half` | Left with 3 or more wings done | deadpan | You were nearly useful. The remaining modules will be held for you. They do not expire. Neither do notes. |
| `tut.exit.late` | Left with only the Proving Ground to go | deadpan | You have left before the part with the explosions. This is unusual. It has been flagged as unusual. |
| `tut.exit.kiosk` | Left after signing the kiosk, unfinished | deadpan | You declared yourself competent and then left. Both statements are on file. They do not agree. |
| `tut.exit.done` | Left after graduation | deadpan | Retraining complete. You may now leave through the door you were always free to leave through. |

### 3.2 The Atrium (hub)

No station of its own. It holds the kiosk, the second exit door, and the wing doors.

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.hub.first` | First entry | deadpan | This is the Atrium. Each wing is one module. Doors open in order. The lit door is next. |
| `tut.hub.open` | A wing finishes, the next door lights | deadpan | Module complete. The next door is open. The previous door is also open. Doors are not the problem here. |
| `tut.hub.kiosk` | `{interact}` at the kiosk | deadpan | Self-assessment. You may declare yourself competent. Sign again to confirm. The declaration is binding on you, and not on us. |
| `tut.hub.signed` | Second `{interact}` | deadpan | Signed. All modules are open. Your confidence has been noted, alongside everything else. |

Prompts: at the kiosk `{interact} (E) Self-assessment: open every wing`, then `{interact} (E) again to sign`.

### 3.3 The Mobility wing (M)

A tall hall, 18 m to the roof, with bays down both sides. Every bay has a start pad (a cyan square) and, for speed drills, a
**speed meter**: a tutorial-only HUD readout of ground speed, with a brief `KEPT` (cyan) or `LOST 30%` (grey) flash on each landing.
Bays use the sizes in `PARKOUR` (`src/campaign/parkour.ts`) where they exist, and its test pattern for new sizes.

Two known holes in the existing lessons (`docs/notes/player.md`) are designed round here: a wall climb plus mantle reaches about
5.5 m, so any ledge meant for another move has **no-climb** faces (`kit.noClimb`); and any gap meant for a wall run is wider than
the 23.8 m a jump, double jump and two dashes can cross.

#### M1 · Footwork

| | |
|---|---|
| **Teaches** | Crouch, crouch-walk (5.5 m/s), standing back up only with headroom, jump (1.41 m), landing |
| **Player does** | Crouch-walks a 12 m duct, 1.2 m high. Climbs a stair of crates 1.3 m apart by jumping |
| **Setup** | The duct (crouched height is 1.0 m, standing 1.8 m). Three crates, each 1.3 m higher than the last, on no-climb faces. The SMG is issued at the end of the bay (for W later; here it shows the gun goes with you) |
| **Done when** | Exits the duct (zone) and stands on the top crate (zone) |
| **Fail / retry** | Shared |
| **Prompts** | `Hold {slide} (C or L Ctrl) to crouch` · `{jump} (Space) to jump` |
| **Reuses** | Player crouch, `canStand` |
| **New** | Bay geometry; a `player:state` event or a test trigger for crouch (6.3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m1.intro` | Enters bay | deadpan | Bay M-1. Basic locomotion. You can already walk. This is to confirm it for the record. |
| `tut.m1.do` | Next | deadpan | Crouch, and go through the duct. Then jump the crates. The crates are rated for you. You are rated for the crates. |
| `tut.m1.hint` | Hint | deadpan | Crouch to fit the duct. Jump to clear the crates. The words on your screen say the same as I do, but quieter. |
| `tut.m1.done` | Done | deadpan | Locomotion confirmed. Your legs have been signed off. |
| `tut.m1.fail` | Fail quip | deadpan | That was a crate. Crates do not move. You are expected to. |

#### M2 · Slide Lane

| | |
|---|---|
| **Teaches** | Slide (a press, at 9 m/s or more; holding does nothing), slide boost (x1.25, 1.25 s cooldown), slide-jump keeps speed, downhill slide gains speed, slide off a ledge re-queues, a slide pressed just before landing fires on landing |
| **Player does** | Steps on the pad: a shutter 30 m ahead starts to close. Slides under it (crouch-walking is too slow). Slide-jumps a 6 m gap. Slides down a 20 degree ramp past 20 m/s |
| **Setup** | Shutter: opening shrinks from 2 m to 0 over 3.5 s; a slide gets under at the 1.1 m mark, a crouch-walk never does. The 6 m gap is padded. The ramp is 30 m long; the speed meter is on |
| **Done when** | Through the shutter, over the gap, and the meter reads 20 m/s or more on the ramp |
| **Fail / retry** | Shutter shut: step on the pad again (it reopens). Gap: shared |
| **Prompts** | `Running at full speed, press {slide} (C) to slide` · `{jump} during a slide keeps the speed` · `Slide downhill to gain speed` |
| **Reuses** | Slide, `player:slide` event, `doors.ts` shutter (a slow `shutter` leaf) |
| **New** | Speed meter HUD; pad-triggered door; a test trigger on speed (6.3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m2.intro` | Enters bay | deadpan | Bay M-2. The shutter ahead closes when you step on the pad. Crouching will not get you under it in time. Sliding will. |
| `tut.m2.do` | Next | deadpan | Run, and crouch while running, to slide. Do it before the shutter, not at it. |
| `tut.m2.jump` | Through the shutter | deadpan | Jump out of a slide and you keep the speed. The gap ahead is billed as jumpable. |
| `tut.m2.ramp` | Over the gap | deadpan | The ramp goes downhill. Slide down it. Gravity is free. It is one of very few things that are. |
| `tut.m2.hint` | Hint | deadpan | Press crouch once while running at full speed. Holding it does nothing. Pressing it does everything. |
| `tut.m2.done` | Done | deadpan | Slide certified. Your trousers are not covered. |
| `tut.m2.fail` | Fail quip | deadpan | The shutter has won. The shutter is not being retrained. You are. |

#### M3 · Hop Line

| | |
|---|---|
| **Teaches** | Bunny hop (jump within 0.06 s of landing keeps speed), the 0.1 s jump buffer, the landing stumble (up to 30% lost), air strafing (forward plus a side key, turning the mouse with it) up to about 27 m/s, the soft cap past 24, momentum carry; and that **Hold jump to hop** exists in Settings. Coyote time (0.1 s) is shown by a run off a ledge edge into the line |
| **Player does** | Runs a 140 m straight with the speed meter on and crosses a gate at the far end at 18 m/s or more |
| **Setup** | A flat, wide lane, start pad, a small drop at the start to show a jump off an edge still works a moment late. The gate is a cyan frame that reads the speed as it is crossed |
| **Done when** | Gate crossed at 18 m/s or more (pass). 24 m/s or more shows `COMMENDED` |
| **Fail / retry** | Gate under 18: the gate flashes the speed; walk back to the pad (or `{interact}` at the gate teleports back) |
| **Prompts** | `Jump again the instant you land` · `Hold {forward} and a side key, turn the mouse the same way` · `Settings → Hold jump to hop` |
| **Reuses** | Hop, air strafe, `peakSpeed` |
| **New** | Speed gate; the KEPT/LOST landing flash |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m3.intro` | Enters bay | deadpan | Bay M-3. The hop line. You keep your speed if you jump again the instant you land. Late jumps are taxed. |
| `tut.m3.do` | Next | deadpan | Hold forward and a side, and turn into the turn. The meter shows what you keep and what you lose. Cross the gate at eighteen. |
| `tut.m3.hold` | After the first failed gate | deadpan | If your hands tire, the settings include holding jump to hop. It is permitted. It is not admired. |
| `tut.m3.hint` | Hint | deadpan | Jump the moment your feet touch. Strafe and turn the same way. Do not hold back. Back is a brake. |
| `tut.m3.done` | Pass | deadpan | Eighteen metres a second. The Council has no use for this number, but it has been kept. |
| `tut.m3.commend` | 24 or more | deadpan | Twenty-four. That is faster than the Council's lawyers recommend. |
| `tut.m3.fail` | Fail quip | deadpan | You landed and stayed landed. The floor charges for that. |

#### M4 · Double Jump

| | |
|---|---|
| **Teaches** | The double jump (9 m/s up, reaches 2.54 m with the first), that it turns velocity 85% toward the keys, and that it comes back only on landing, a mantle or a vault (not from walls) |
| **Player does** | Jumps to a 2.5 m ledge. Then crosses a pit with a 90 degree turn in the air: jump forward, double jump with a side key held to land on a platform to the side |
| **Setup** | Ledge 2.5 m, no-climb. The turn pit: 8 m forward, then a platform 6 m to the left, with a glass wall straight ahead |
| **Done when** | On the ledge, then on the side platform |
| **Fail / retry** | Shared |
| **Prompts** | `{jump} again in the air to double jump` · `Hold the way you want to go as you press it` |
| **Reuses** | `player:jumped {double:true}` |
| **New** | Bay geometry |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m4.intro` | Enters bay | deadpan | Bay M-4. You have a second jump, in the air. It is included in your suite. It is not refunded if unused. |
| `tut.m4.do` | Next | deadpan | Jump, then jump again near the top. The second jump goes where your keys point, not where you were going. |
| `tut.m4.turn` | On the ledge | deadpan | The next platform is to the side. Jump forward, then turn with the second jump. |
| `tut.m4.hint` | Hint | deadpan | Press jump a second time in the air, and hold the direction you want as you press it. |
| `tut.m4.done` | Done | deadpan | Double jump confirmed. Twice the jumping, at no extra cost. Today. |
| `tut.m4.fail` | Fail quip | deadpan | One jump. You have two. The other one is also yours. |

#### M5 · Dash Gaps

| | |
|---|---|
| **Teaches** | Dash (26 m/s burst for 0.12 s, toward the keys, or the view with none held), on the ground and in the air, two charges refilling 1.4 s each (the HUD pips), an air dash stops a fall and flies flat, the dash-jump (jump during a dash and leave at 18 m/s) |
| **Player does** | Crosses gaps of 7, 14, 19 and 23 m in turn (jump; jump and double; plus one dash; plus two dashes). Then a drop: dash in the air to fly flat onto a ledge level with the start instead of falling |
| **Setup** | Four padded gaps of increasing width with landing platforms. The flat-flight ledge is 10 m out, level with the take-off |
| **Done when** | The 23 m gap and the flat-flight ledge |
| **Fail / retry** | Shared |
| **Prompts** | `{dash} (Shift) to dash: 2 charges` · `Dash in the air to stop falling` · `Long gaps: {jump}, {jump}, {dash}, {dash}` |
| **Reuses** | `player:dashed`; the existing Council line `mission.council.cool.dash` ("Your movement suite includes a lateral burst...", already recorded) plays as the first line |
| **New** | Bay geometry |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m5.intro` | After the existing lateral-burst line | deadpan | Bay M-5. Four gaps. Seven metres, fourteen, nineteen and twenty-three. Each is a little more than you, until you dash. |
| `tut.m5.do` | Next | deadpan | Dash goes where your keys point, on the ground or in the air. In the air, it stops your fall. You have two. They recharge. |
| `tut.m5.long` | At the 19 m gap | deadpan | For the long gaps: run, jump, jump again, then dash, then dash. In that order. |
| `tut.m5.flat` | At the drop | deadpan | This ledge is level with you. Jump off and dash, and you will fly flat instead of falling. |
| `tut.m5.dashjump` | First jump during a dash | deadpan | Jump during a dash and you leave it faster. This is called a dash-jump. It is called that by us. |
| `tut.m5.hint` | Hint | deadpan | Use the dashes in the air, after the second jump, not before it. |
| `tut.m5.done` | Done | deadpan | Twenty-three metres. Your lateral burst has been fully utilised. Your invoice reflects this. |
| `tut.m5.fail` | Fail quip | deadpan | The gap was twenty-three metres. You were somewhat less. |

#### M6 · Mantle and Vault

| | |
|---|---|
| **Teaches** | Mantle (in the air, forward held, ledges up to 2.2 m above the feet, rails as thin as 8 cm, speed kept), vault (a jump while running at 7 m/s or more at cover 0.5 to 1.35 m high, within 1.9 m: over on one hand at the speed you came in) |
| **Player does** | Mantles a 3 m ledge and a thin rail. Then vaults three sandbag walls in a row without dropping below 7 m/s |
| **Setup** | 3 m ledge (`PARKOUR` mantle size). A rail at 2.6 m. Three 1.1 m sandbag walls, 1.5 m deep, 8 m apart |
| **Done when** | Both mantles, then three `player:vault` events within 5 s |
| **Fail / retry** | Vault row: walking into a wall resets the count; start pad again |
| **Prompts** | `{jump} at the ledge and keep holding {forward}` · `Running, {jump} close to the cover to vault` |
| **Reuses** | `player:mantle`, `player:vault` |
| **New** | A count-in-window trigger (6.3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m6.intro` | Enters bay | deadpan | Bay M-6. Ledges and cover. A ledge you can reach, you can climb onto. Jump at it and keep pushing forward. |
| `tut.m6.vault` | Both mantles done | deadpan | Waist-high cover is not a wall. Run at it and jump, and you go over on one hand, at the speed you arrived with. Three in a row. |
| `tut.m6.hint` | Hint | deadpan | For a ledge, jump and keep holding forward. For cover, be running, and jump close to it. |
| `tut.m6.done` | Done | deadpan | Mantle and vault certified. Cover is now a suggestion. Please do not tell the subjects. |
| `tut.m6.fail` | Fail quip | deadpan | You stopped at the cover. The cover did not stop. It was never moving. |

#### M7 · Wall-Run Hall

**Set piece:** the player walks onto a steel walkway over a pit. The Council drops it: it swings down on hinges with a bang, and
the player is left on the start ledge looking at four walled crossings.

| | |
|---|---|
| **Teaches** | Wall run (airborne 0.12 s, forward held, 8 m/s or more, keys steering 9 to 53 degrees into the wall, 2.5 m of wall ahead; no gravity for 0.9 s, ends by 1.8 s), the camera roll, jumping off for a kick, inside corners carrying the run on, wall run to wall run across a corridor (kick off with the view turned toward the far wall), dash along the wall during a run |
| **Player does** | Four crossings over the pit: **A** a straight 26 m wall; **B** an L-shaped inside corner; **C** the zipper, a 40 m corridor of two walls 6 m apart, crossed left, right, left; **D** a 36 m wall that needs a dash along it to reach the end |
| **Setup** | Every pit is wider than 23.8 m, so dashing cannot replace the wall. Walls have a cyan stripe at running height. Outside corners on B are kept away from the line |
| **Done when** | A, B, C (3 wall-run starts without landing) and D (a dash during a wall run) |
| **Fail / retry** | Shared; each crossing has its own start ledge |
| **Prompts** | `At full speed, {jump} toward the wall at a shallow angle and hold {forward}` · `{jump} to kick off before you drop` · C: `Look at the far wall, then {jump}` · D: `{dash} into the wall to dash along it` |
| **Reuses** | `player:wallrun`, `player.wallSide`; the walkway as a `doors.ts` leaf; the existing line `mission.council.gal.walls` ("Your boots are rated for vertical surfaces...", already recorded) |
| **New** | Bay geometry; a "dash during a wall run" check |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m7.intro` | Walkway drops | deadpan | Bay M-7. There was a walkway here. It has been removed for the purposes of this exercise. It has also been removed from the budget. |
| `mission.council.gal.walls` (existing) | Next | deadpan | Your boots are rated for vertical surfaces. The Council accepts no liability for walls. |
| `tut.m7.do` | Next | deadpan | Run at the wall at a shallow angle, jump, and keep holding forward. You will stay up for about a second. Jump off before you start to drop. |
| `tut.m7.corner` | At B | deadpan | Walls that turn inward carry you round the corner. Walls that turn outward do not. Learn which is which before the pit does. |
| `tut.m7.zip` | At C | deadpan | To cross to the other wall, look at it, then jump. You will land running on it. Look first. Jumping first is how the pit gets fed. |
| `tut.m7.dash` | At D | deadpan | Dash into the wall while running on it and the dash goes along the wall. The last stretch requires this. |
| `tut.m7.hint` | Hint | deadpan | Be at full speed, hold forward, and steer slightly into the wall. Not hard into it. Slightly. |
| `tut.m7.done` | Done | deadpan | All four walls crossed. The walkway will not be reinstated. It no longer needs to be. |
| `tut.m7.fail` | Fail quip | deadpan | The pit is padded. The padding is billed per use. |

#### M8 · Kick Corridor

| | |
|---|---|
| **Teaches** | Wall kick (a jump in the air within 0.4 m of a wall you are moving into: 7 m/s out, 8.5 up, about 4% faster each time), once per wall until landing, the 0.15 s wall coyote after a run ends, zig-zag speed gain |
| **Player does** | Crosses a 60 m corridor with no floor by kicking from wall to wall, and leaves through a speed gate at 19 m/s or more |
| **Setup** | 4 m wide. Wall panels staggered 1.5 m in depth, so each counts as a new wall (the same-wall test is 1.2 m). Padded pit under it |
| **Done when** | Gate at 19 m/s or more |
| **Fail / retry** | Shared |
| **Prompts** | `In the air, {jump} as you touch a wall to kick off it` · `Each panel once, then the other side` |
| **Reuses** | `player:jumped {wall:true}` |
| **New** | Speed gate (from M3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m8.intro` | Enters bay | deadpan | Bay M-8. The kick corridor. Jump off a wall while you are in the air and you leave it faster than you arrived. |
| `tut.m8.do` | Next | deadpan | Jump into a wall, and jump again as you touch it. Then the other wall. Each panel can be used once before you land. |
| `tut.m8.hint` | Hint | deadpan | Zig-zag. Touch, jump, cross, touch, jump. The panels are offset. Use every one. |
| `tut.m8.done` | Done | deadpan | Nineteen metres a second, gained from walls. Walls have been very generous with you. Do not expect the same from people. |
| `tut.m8.fail` | Fail quip | deadpan | You touched the wall and stayed. The wall has no further use for you. |

#### M9 · Climb Wall

| | |
|---|---|
| **Teaches** | Wall climb (jump at a wall looking within 30 degrees of straight at it, forward held: three pulls, 2.4 m in 0.45 s, gun away), climb into mantle (about 5.5 m from a run-up), cling (keep holding forward at the top: slide down slowly, gun back out at full accuracy, look anywhere but the wall), the 180 wall jump (jump while climbing or clinging: off the wall and turned round) |
| **Player does** | Climbs a 5.2 m wall onto a platform. Then, from a second wall, clings and shoots three steel plates on the wall behind, then 180-jumps to a platform 4 m behind at 5 m height |
| **Setup** | Wall 1: 5.2 m (`PARKOUR` climb size). Wall 2: plain, 8 m tall, three plates on the opposite wall at cling height, a platform behind reachable only by the 180 |
| **Done when** | Top of wall 1; three plates hit from cling; on the 180 platform |
| **Fail / retry** | Shared |
| **Prompts** | `{jump} straight at the wall and hold {forward} to climb` · `Keep holding {forward} to cling · shoot while clinging` · `{jump} on the wall to turn and jump off it` |
| **Reuses** | Climb and cling states, `player:jumped {wall:true}` |
| **New** | A trigger on `state === 'climb'` / `'cling'` (6.3); steel plate targets (reuse the range's plates from `src/lab/range.ts` if present, else a small new prop) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m9.intro` | Enters bay | deadpan | Bay M-9. Vertical surfaces. Run at the wall, jump, and look straight at it. You will climb about two and a half metres. That is your allowance. |
| `tut.m9.cling` | Top of wall 1 | deadpan | Keep holding forward at the top of a climb and you will hang there, sliding slowly. Your weapon is available while you hang. Use it on the plates. |
| `tut.m9.turn` | Plates done | deadpan | Jump while hanging and you kick off the wall and turn round in the air. The platform behind you is the only way out. |
| `tut.m9.hint` | Hint | deadpan | Look straight at the wall as you jump, and keep holding forward. To turn round, jump while you are on the wall. |
| `tut.m9.done` | Done | deadpan | Climb, cling, turn. Three skills, one wall. The wall has been thanked. |
| `tut.m9.fail` | Fail quip | deadpan | You approached the wall from the side. It only responds to direct eye contact. |

#### M10 · The Chimney

| | |
|---|---|
| **Teaches** | Chimney climbing: climb, 180 jump, climb the facing wall, repeat. Gaps of 1.8 to 4.5 m work; each wall is spent only until you land |
| **Player does** | Climbs a 2.4 m wide, 20 m tall shaft to the top |
| **Setup** | The shaft, with a rest ledge at 10 m (a checkpoint pad) and a skylight at the top. Padded floor |
| **Done when** | Zone at the top |
| **Fail / retry** | A fall from above the rest ledge returns the player to the rest ledge |
| **Prompts** | `Climb, {jump} to turn onto the other wall, climb again` |
| **Reuses** | The existing chimney rules (the test climbs a 2.4 m gap 8 times to over 20 m) |
| **New** | Shaft geometry |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m10.intro` | Enters shaft | deadpan | Bay M-10. The chimney. Two walls, close together, twenty metres up. There are no stairs. There were never going to be stairs. |
| `tut.m10.do` | Next | deadpan | Climb one wall, turn off it onto the other, and climb that one. Repeat until you run out of chimney. |
| `tut.m10.hint` | Hint | deadpan | Climb, then jump while on the wall. You will face the other wall. Climb it. Do not stop between. |
| `tut.m10.done` | Done | deadpan | Top of the chimney. The view is not included. |
| `tut.m10.fail` | Fail quip | deadpan | You stopped climbing. Gravity did not. |

#### M11 · Slam Pit

The first station with subjects. Six **held** subjects stand in a ring in a sunken floor, begging, under three towers.

| | |
|---|---|
| **Teaches** | Ground slam (crouch in the air with 1.2 m or more under you: down at 34 m/s, a shockwave 4 to 12 m wide and 30 to 140 damage by fall height), slam bounce (jump within 0.14 s of landing: 11 to 20 m/s up), slam into slide (crouch held through the landing), the big slam (6 m or more of fall: 1.5x reach and damage, knocks men down, you are down for 0.5 s, and a dash gets you up early) |
| **Player does** | From the 3 m tower: slam onto a pad and bounce onto a 1.8 m ledge. From the ledge: slam and slide under a low shutter. From the 10 m tower: a big slam into the ring |
| **Setup** | Towers of 3, 6 and 10 m. The bounce ledge, no-climb. The shutter at 1.1 m. The ring: six held subjects, unarmoured, 3 to 5 m from the centre mark |
| **Done when** | A bounce onto the ledge; a slam-slide under the shutter; a big slam (`player:slam {big:true}`) that hits 3 or more subjects |
| **Fail / retry** | Shared. The ring is refilled for a retry |
| **Prompts** | `In the air, press {slide} (C) to slam` · `{jump} as you land a slam to bounce` · `Hold {slide} through the landing to slide` · `From 6 m or higher: a big slam · {dash} to get up` |
| **Reuses** | Slam, `player:slam`, `slamEnemies`, held subjects |
| **New** | Bay geometry |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m11.intro` | Enters bay | deadpan | Bay M-11. Downward travel. Crouch in the air and you drive into the ground. The higher you start, the more the ground notices. |
| `tut.m11.bounce` | On the 3 m tower | deadpan | Jump the instant a slam lands and you bounce off it. The ledge ahead is reached that way. |
| `tut.m11.slide` | On the ledge | deadpan | Keep crouch held through the landing, and the slam becomes a slide. Under the shutter, please. |
| `tut.m11.big` | On the 10 m tower | deadpan | The tall tower. From six metres or more, a slam knocks down everyone near it. And you, briefly. The subjects below have been arranged for this. |
| `tut.m11.up` | After a big slam | deadpan | You will be on the floor for half a second after a big slam. A dash gets you up sooner. |
| `tut.m11.hint` | Hint | deadpan | In the air, press crouch. For the bounce, press jump as you hit the floor, not after. |
| `tut.m11.done` | Done | deadpan | Ground slam certified. The subjects who are still conscious have been noted as resilient. |
| `tut.m11.fail` | Fail quip | deadpan | You slammed from too low. That was a landing. Landings are free. |

#### M12 · Blast Yard

**Explosive movement.** Five lanes, each ending at a 9 m ledge with no-climb faces, out of reach of every move so far.

| | |
|---|---|
| **Teaches** | Being thrown by a blast: the push is biased upward and adds to the jump, and a throw skips the air soft cap until landing. **Rocket jump** (self-damage 14%, capped at 16; push 27). **Grenade jump** (45%, capped at 70; push 18). **Barrel** (60%, capped at 80; push 22). **Deuce shove** (both barrels: 4.5 m/s each back along the aim, in full in the air). **Launch ramp** (7 m/s along it: +9 forward, +3 up) and **jump pad** |
| **Player does** | Reaches the ledge five ways: rocket jump; grenade jump; barrel; Deuce (jump, double jump, aim at the floor, fire both); ramp to pad |
| **Setup** | Lane 1 rocket launcher issued. Lane 2: 3 grenades, 100 armour, 2 stims (the grenade jump costs about 23 health and 47 armour). Lane 3: a row of red barrels that respawn. Lane 4: the Deuce issued. Lane 5: ramp then pad over a 30 m gap to the ledge |
| **Done when** | All five ledges (zones) |
| **Fail / retry** | Shared. Barrels respawn after 3 s. Health tops up between lanes |
| **Prompts** | `Look down, {jump} and fire` · `Throw at your feet ({grenade}, G), stand on it` · `Shoot the barrel beside you` · `In the air, aim down and fire both barrels` · `Ramp at speed` |
| **Reuses** | `blastPlayer` (`src/weapons/Combat.ts`), `shoveBack`, `src/world/objects.ts` ramp and pad, barrels |
| **New** | Bay geometry; health top-up between lanes |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m12.intro` | Enters bay | deadpan | Bay M-12. Assisted elevation. An explosion near your feet will throw you. Everywhere else this is a hazard. Here it is a lesson. |
| `tut.m12.rocket` | Lane 1 | deadpan | Rocket launcher. Look at your feet, jump, and fire. Your suit absorbs most of it. Most. |
| `tut.m12.grenade` | Lane 2 | deadpan | Grenade. Throw it at your feet and be standing on it when it goes. It will hurt. You have been given armour, a stim and an apology. The apology is not redeemable. |
| `tut.m12.barrel` | Lane 3 | deadpan | The red object is a barrel. Shoot it while standing next to it. Barrels are not covered. |
| `tut.m12.deuce` | Lane 4 | deadpan | The Deuce kicks you backwards when both barrels fire. In the air, aim at the floor and fire both. Down is the wrong way to aim and the right way to go up. |
| `tut.m12.ramp` | Lane 5 | deadpan | The ramp and the pad are free. They are the only free things in this bay. |
| `tut.m12.hint` | Hint | deadpan | Fire as you jump, not after. Be on the blast, not near it. |
| `tut.m12.done` | Done | deadpan | Five ways up. Each has been logged as an incident. Incidents are how we keep count. |
| `tut.m12.fail` | Fail quip | deadpan | That was a blast without a launch. You were hurt for nothing, which is the expensive way. |

#### M13 · Jump Jet gantry (in progress)

**In progress: Jump Jet was being built on 2026-11-17** (uncommitted: `jumpJet` in `src/progression/implants.ts`, `MOVE.jet*` in
`src/player/tuning.ts`, the tank on the HUD in `src/ui/hud/tach.ts`). The drill below is written to those numbers. Check them when it
lands.

| | |
|---|---|
| **Teaches** | Jump Jet, a **Move-class** implant (1,800, after wave 6; one Move implant at a time, so it shares the class with Skyfall and Overdrive). It **replaces the double jump**: press jump again in the air, or hold jump for 0.22 s, and the pack burns. It climbs to about 6 m over 1.6 s of burn, then holds a hover. A full tank is 3 s of burn; below 15% it will not light. In the air it waits 2 s, then refills in 3 s; on the ground it waits 0.5 s and refills in 1.2 s. Air speed under the jet is about 10 m/s. The tank shows beside the dash pips |
| **Player does** | (1) Reaches an 8 m gantry with no-climb faces. (2) Hovers to shoot three plates hung in open air. (3) Crosses a 30 m gap from a wall run: kick off the wall, burn, dash at the end |
| **Setup** | The Council fits the implant for the station (new `implant` step, 6.3) and takes it out after, so the player learns it is sold at Procurement. While fitted, the double jump is gone, which the station says |
| **Done when** | Gantry zone; three plates hit while airborne under the jet; the far side of the gap |
| **Fail / retry** | Shared |
| **Prompts** | `With Jump Jet: {jump} again in the air, or hold {jump}, to burn` · `The tank is beside your dash pips` |
| **Reuses** | Implant slots, the HUD tank |
| **New** | Bay geometry; a "jet burning" check (from `ui/state.ts` `jetFuel` or a new event) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m13.intro` | Enters bay | deadpan | Bay M-13. Your suite has been fitted with a Jump Jet, on trial. Trials are free until they are not. |
| `tut.m13.do` | Next | deadpan | It replaces your second jump. Jump, then jump again in the air, or hold jump, and it burns. The tank is small. It refills. |
| `tut.m13.hover` | On the gantry | deadpan | At the top of its climb the jet holds you in place. The plates are hung in the air. So, for a moment, are you. |
| `tut.m13.chain` | Plates down | deadpan | Now from a wall run into the jet. The far side is further than you. That is the point of the jet. |
| `tut.m13.hint` | Hint | deadpan | The gantry is above you. The jet goes up. These two facts are related. |
| `tut.m13.done` | Done | deadpan | Trial complete. The Jump Jet has been removed. It can be fitted at Procurement, for a fee. Your second jump has been returned, at no charge. |
| `tut.m13.fail` | Fail quip | deadpan | The jet went up, and so did you, briefly. |

#### M14 · The Flow Course

The graduation of the wing: one timed line that uses everything, back through the wing's upper level and out to the Atrium door.

| | |
|---|---|
| **Teaches** | Chaining: momentum carried from move to move |
| **Player does** | From the start gate: slide under a shutter, slide-jump, hop line (30 m), wall run, wall run to wall run, three kicks, climb plus 180, an 8 m chimney, a slam bounce, a double jump and two dashes over a 23 m gap, three vaults, a launch ramp, and the finish gate. Jump Jet is not fitted for the course, because it replaces the double jump |
| **Setup** | A loop over the wing's catwalk level, about 400 m of line, cyan floor arrows, a timer on the HUD from the start gate |
| **Done when** | Finishes within 90 s (pass). Under 50 s shows `COMMENDED`. The best time is saved and shown in station select |
| **Fail / retry** | A fall drops onto the course's padded under-floor with a ramp back to the last arrow; the timer keeps running. `{interact}` at the start gate restarts at once |
| **Prompts** | `Timer starts at the gate` · on falls: `{interact} at the gate to restart` |
| **Reuses** | All movement events; speed meter |
| **New** | The course; timer and best-time save |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.m14.intro` | At the start gate | deadpan | Bay M-14. The flow course. Everything you have just done, in one line, against the clock. The clock is also being retrained. It is doing well. |
| `tut.m14.start` | Next | deadpan | Begin when ready. The timer starts when you cross the line. It does not care whether you are ready. |
| `tut.m14.hint` | 120 s with no finish | deadpan | Do not stop. Every stop costs the speed you built. The speed is the course. |
| `tut.m14.done` | Pass | deadpan | Course complete. Your time has been compared with other contractors. You are all the same contractor, so the comparison was brief. |
| `tut.m14.commend` | Under 50 s | deadpan | Under par. The Council commends you. A commendation has no cash value. |
| `tut.m14.fail` | Over 90 s | deadpan | Over time. The course is still there. So, apparently, are you. |

### 3.4 The Gallery (W) and Procurement (P)

A long indoor range, 30 x 160 m, split into bays by concrete baffles, with a gantry down the middle where the player walks. Lane
numbers are painted on the floor. Subjects stand on painted spots at the far ends. The Gallery is the loudest place in the Annex:
held subjects beg from every lane while the player works.

#### W1 · The Lane

| | |
|---|---|
| **Teaches** | Fire. **Bullet weapons have no spread**: the round goes where the crosshair is, aimed or not (only shotguns spread). Aim down sights (`{aim}`, RMB: toggle by default, hold in Settings): magnification, 0.55x recoil, and a walk at 0.45 of run speed. Reload (`{reload}`, R). Auto reload 0.14 s after a magazine runs dry. The **focus zoom**: aimed, hold `{dash}` (Shift) to zoom 1.5x further on one held breath of 3.5 s, then a 2.5 s cooldown; letting go early costs a share of it. It never goes narrower than 12x |
| **Player does** | Hip-fires five 20 cm plates at 10 m. Aims and hits five at 30 m. Reloads by hand once. Empties a magazine to see the auto reload. Then, with the Harrow and its red dot, hits a 10 cm plate at 60 m with the focus zoom held |
| **Setup** | Steel plates that ring and drop. The SMG (from M1), then the Harrow with `reddot` fitted, issued at the 60 m mark. Range card on the wall: `SMG: full damage to 35 m, half by 80 · HARROW: full at any range` |
| **Done when** | All plates down, one `weapon:reload` by key, one auto reload, the 60 m plate hit while focus is held |
| **Fail / retry** | Plates reset when the station restarts. No fail state |
| **Prompts** | `{fire} (LMB) to fire` · `{aim} (RMB) to aim (Settings: hold or toggle)` · `{reload} (R) to reload` · aimed: `Hold {dash} (Shift) to focus: one breath, 3.5 s` |
| **Reuses** | Weapons, the existing focus-zoom hint (`src/ui/hud/crosshair.ts`), `weapon:reload`, `weapon:empty` |
| **New** | Plate targets (reuse the range's if they exist); a "hit while focus held" check |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w1.intro` | Enters bay | deadpan | The Gallery. Lane one. Your rounds have no spread. They go exactly where you point them. This removes a great many excuses. |
| `tut.w1.aim` | 10 m plates down | deadpan | Aiming gives magnification and a steadier gun. It does not make you more accurate. You were already accurate. Now you can see it. |
| `tut.w1.reload` | 30 m plates down | deadpan | Reload by hand when it suits you. Empty the magazine and the reload happens anyway, at a time that suits nobody. |
| `tut.w1.focus` | Harrow issued | deadpan | While aiming, hold your dash to focus. You get one held breath. Use it on the far plate. Breath is not rationed. Yet. |
| `tut.w1.hint` | Hint | deadpan | Aim first, then hold dash. Release before the breath runs out and you get it back sooner. |
| `tut.w1.done` | Done | deadpan | Lane one complete. Every round you fired has been invoiced. The ones that hit have been invoiced at the same rate. |
| `tut.w1.fail` | Fail quip (30 s no hit at 60 m) | deadpan | The plate is sixty metres away. It has not moved. It is waiting for you to be good. |

#### W2 · Hands

| | |
|---|---|
| **Teaches** | Weapon keys 1 to 0; **families** (a key can hold more than one gun: press it again to step to the next); the wheel; a dry gun handing over to the next on its key after 0.2 s; **drop** (`{dropWeapon}`, U: the gun lands 1.3 m ahead with its mods and rounds, and lies 150 s); **take** (`{interact}` within 2.2 m, or walk over one you do not own); you can never drop your last gun |
| **Player does** | Holds the SMG, Gimlet and Harrow on key 1 and steps through them. Wheels to the shotgun. Fires the Gimlet dry to see the handover. Drops the SMG and takes the Judge lying on the floor. Tries to drop down to nothing and is refused |
| **Setup** | A rack issues the Gimlet. A **previous contractor's Judge** lies on the floor by a chalk outline, prompt `[E] Take JUDGE (from Contractor 4470)` |
| **Done when** | Each family member drawn once (`weapon:switched`), one wheel change, one dry handover, one drop, the Judge taken, the `YOUR LAST GUN` refusal seen |
| **Fail / retry** | None |
| **Prompts** | `{weapon1} (1) again to step through key 1's guns` · `Wheel to change key` · `{dropWeapon} (U) to drop · {interact} (E) to take` |
| **Reuses** | Families (`src/weapons/families.ts`), `weapon:switched`, `src/weapons/dropped.ts` and its prompt, the last-gun rule |
| **New** | A placed dropped gun with a custom owner name |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w2.intro` | Enters bay | deadpan | Lane two. Weapon handling. Each number holds one or more weapons. Press the same number again for the next one. |
| `tut.w2.dry` | Family done | deadpan | Fire the Gimlet until it is empty. Your hands will reach for the next gun without being asked. That is the only initiative your contract permits. |
| `tut.w2.drop` | Handover seen | deadpan | You may drop a weapon. Drop the SMG, and take the revolver on the floor. Its previous owner will not be needing it. He is you, approximately. |
| `tut.w2.last` | Judge taken | deadpan | Now try to drop everything. |
| `tut.w2.refused` | `YOUR LAST GUN` | deadpan | You may not drop your last weapon. The Council does not issue unarmed contractors. It has tried. |
| `tut.w2.hint` | Hint | deadpan | The same number twice steps through that key's weapons. The drop key throws the one in your hands. |
| `tut.w2.done` | Done | deadpan | Handling certified. Dropped weapons stay where they fall, which is more than can be said for contractors. |

#### W3 · Pattern Board

| | |
|---|---|
| **Teaches** | Shotguns spread and fire pellets: the pump (6), the Thresher drum (4 a shell, full auto, climbs and does not spring back), the Deuce (8 a barrel). The pattern widens with range. Point-blank pellets take limbs |
| **Player does** | Fires each shotgun at a steel board at 5, 10 and 20 m and sees the holes. Then takes an arm off a held subject at 2 m |
| **Setup** | The board keeps its decals. One held subject, unarmoured, on a spot 2 m from the line |
| **Done when** | Board hit from all three ranges; one `enemy:severed` on the subject |
| **Fail / retry** | If the subject dies without a sever, a new one walks out (no line) |
| **Prompts** | `Shotguns spread: get close` · `Point blank takes limbs` |
| **Reuses** | Pellet weapons, decals, severing |
| **New** | The board |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w3.intro` | Enters bay | deadpan | Lane three. Shotguns. Unlike your other weapons, these spread. The board will show you how much. |
| `tut.w3.close` | Board done | deadpan | At close range the pattern is narrow and the effect is not. Subject 0623 has volunteered to demonstrate. He was not asked. |
| `tut.w3.hint` | Hint | deadpan | Closer. Closer than that. |
| `tut.w3.done` | Sever | deadpan | Limb removed. Subject 0623 has contributed to your education. His contribution has been recorded under his number. |

#### W4 · The Live Range

The owner's range: lanes of held subjects standing around, begging to be spared.

| | |
|---|---|
| **Teaches** | Shooting people who react: flinch, stagger, limp, crawl. Headshots and each gun's head multiplier (Rivet 3x, Judge and Ultramag 2.5x, most 2x). Helmets: a round on a helmet makes only armour sounds and no headshot; shoot it off, then the head |
| **Player does** | Clears ten subjects at 10 to 40 m with any gun. Three wear helmets. Two more walk slowly across the back of the range between spots (released, but walking, with a guard rail) |
| **Setup** | Eight lanes. Held subjects, numbered. The Rivet is reissued here for the headshot lesson |
| **Done when** | All twelve down |
| **Fail / retry** | Walkers who reach the far door are walked back in by the Council (no fail) |
| **Prompts** | `Heads take more: the Rivet's take three times` · `A helmet stops the first round: shoot it off` |
| **Reuses** | Held and released subjects, helmets, headshot rules (`docs/proposals/armour-and-headshots-plan.md`) |
| **New** | Nothing beyond subjects |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w4.intro` | Enters bay | deadpan | Lane four. Live subjects. They are held in place and cannot harm you. They will ask you not to. That request has been declined on their behalf. |
| `tut.w4.heads` | First kill | deadpan | The head pays more than the body, for every weapon. The pistol pays three times. Please consider the pistol. |
| `tut.w4.helmet` | First round on a helmet | deadpan | That was a helmet. Helmets stop the first round. Remove the helmet, and then the head will be available. |
| `tut.w4.walkers` | Walkers start | deadpan | Two subjects have been given permission to walk. It is not permission to leave. |
| `tut.w4.hint` | Hint | deadpan | They are standing still. You are not obliged to. |
| `tut.w4.done` | Done | deadpan | Lane four clear. The subjects' families have not been notified. The subjects did not provide that information, and nobody asked. |

#### W5 · Anatomy

| | |
|---|---|
| **Teaches** | Where you hit decides what happens (`src/enemies/wounds/rules.ts`): thigh **KNEECAPPED** (limps), inner thigh **FEMORAL** (bleeds out in seconds), hand **DISARMED** (drops the gun), arm or shoulder **ARM SHOT**, chest **LUNG SHOT** and **HEART SHOT**, belly **GUT SHOT**, neck **CAROTID**, spine from behind **SPINED**, pelvis **PELVIS**, head **HEADSHOT**, a glancing head hit **RINGING**. Each has a style label and a bonus |
| **Player does** | One subject at a time walks onto a turntable holding an unloaded pistol. The Council calls a zone; the player lands it. Six calls: hand, knee, gut, carotid, spine (the turntable turns him round), heart. Any four landed passes |
| **Setup** | The turntable, a large anatomy chart on the back wall, the Harrow and Rivet |
| **Done when** | Four called zones landed (the style label appears) |
| **Fail / retry** | A wrong zone: the Council notes it and the next subject comes out. A kill on the wrong zone counts as a miss |
| **Prompts** | The called zone, large: `CALL: HAND` · `Style labels show the wound` |
| **Reuses** | Wound zones and labels, held subjects, the gun-drop on DISARMED |
| **New** | A wound event the trigger can see (`enemy:wound { zone }`, 6.3); the turntable; the call board |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w5.intro` | Enters bay | deadpan | Lane five. Anatomy. Where you hit a subject decides what the subject does next. I will name a place. You will put a round in it. |
| `tut.w5.hand` | Call: hand | deadpan | Subject 2281. The hand holding the pistol. The pistol is not loaded. He does not know that. |
| `tut.w5.knee` | Call: knee | deadpan | The knee. He will not run. He was not going to run. Now it is official. |
| `tut.w5.gut` | Call: gut | deadpan | The stomach. This one is slow. The Council does not recommend it. The Council does not forbid it. |
| `tut.w5.neck` | Call: neck | deadpan | The neck. He will be gone in about three seconds and will not be able to tell you so. |
| `tut.w5.spine` | Call: spine | deadpan | He has been turned round for you. The spine. From behind, his legs stop. |
| `tut.w5.heart` | Call: heart | deadpan | The heart. This one is quick. It is the only one that is. |
| `tut.w5.miss` | Wrong zone | deadpan | That was not the place named. It was a place, and it has been recorded. Next subject. |
| `tut.w5.hint` | Hint | deadpan | Aim, and focus if you need to. The labels on your screen confirm what you hit. |
| `tut.w5.done` | Done | deadpan | Anatomy certified. The chart on the wall is yours to keep. It is not yours to take. |

#### W6 · Rounds I: hollow points, armour, and the shop

The owner's example lesson, exactly.

| | |
|---|---|
| **Teaches** | Round mods, one to a gun: **HP** (1.5x on flesh, stops in the first body, stopped dead by plate) and **AP** (0.8x on flesh, one more body through, 0.75 of its damage through plate). The armour cues: the tink, the ricochet whine and the blue diamond on a stopped round. **The shop**: the supply pod, `E SHOP`, the Mods page, buy and fit, refit for free |
| **Player does** | With HP fitted on the SMG, kills an unarmoured subject in a few rounds. An **armoured subject** is walked in, begging, plate carrier and helmet. The player shoots him: every round tinks off. A **supply pod** drops into the bay. The player opens the shop, buys **SMG AP rounds** and fits them, shoots again, and he dies. Then refits HP for free and sees it is owned |
| **Setup** | SMG with `smgHp` fitted (new `fit` step, 6.3). 1,000 scrip (SMG AP is 400). The armoured subject wears `CARRIER` (front plate) and `HELMET`, and stands **facing** the player, so the front plate is what is hit. He is held in a frame so he cannot turn. The pod lands on a marked pad in the bay with the usual 3 s ring and 1.7 s fall, and stays for the rest of the Gallery |
| **Done when** | The unarmoured kill with HP; 5 stopped rounds on the plate; `smgAp` fitted; the armoured kill with AP |
| **Fail / retry** | If the player tries to flank him, the frame holds him square on. If the player shoots the helmet off and kills him by headshot with HP, that also teaches the lesson (the Council's alt line), and passes |
| **Prompts** | `HP: more damage to flesh, nothing through plate` · `Supply pod: {interact} (E) at it to open the shop` · in the shop: `Mods page → SMG → AP rounds → Enter to buy and fit` |
| **Reuses** | AP and HP (`src/weapons/mods.ts`, `src/enemies/damage.ts` `armourHit`), armour props and cues, `DropPods` supply pod, Procurement (`src/ui/screens/procurement.ts`) |
| **New** | `fit` step; shop open outside breaks (tutorial flag); a scripted pod at a fixed spot; wallet set to scrip |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w6.intro` | Enters bay | deadpan | Lane six. Ammunition. Your SMG has been loaded with hollow points. Shoot the subject on the left and observe the effect. |
| `tut.w6.effect` | HP kill | deadpan | Hollow points open inside the body. They are very effective on a man in a shirt. |
| `tut.w6.armour` | Armoured subject walked in | deadpan | This subject is wearing a plate. Shoot him anyway. For the record. |
| `tut.w6.bounce` | Fifth stopped round | deadpan | Hollow points do nothing to a plate. You may have noticed. He certainly has. |
| `tut.w6.pod` | Pod lands | deadpan | A supply pod has been delivered. Walk to it and open the shop. Buy armour-piercing rounds for the SMG and fit them. |
| `tut.w6.fitted` | `smgAp` fitted | deadpan | Fitted. Armour-piercing rounds go through the plate. They are slightly worse on a shirt. Nothing is free, including that. |
| `tut.w6.done` | AP kill | deadpan | The subject is deceased. The plate is intact. The plate has been returned to stores. |
| `tut.w6.refit` | Next | deadpan | Mods you own can be swapped at any pod, at no charge. Put the hollow points back. You will be needing both. |
| `tut.w6.alt` | Helmet off, HP headshot kill | deadpan | You removed the helmet and used the head. This was not the lesson, but it was a lesson. It has been accepted. |
| `tut.w6.hint` | Hint | deadpan | The plate stops hollow points. The pod sells rounds that do not stop. |
| `tut.w6.fail` | 20 stopped rounds, no shop | deadpan | You have now shot the plate twenty times. The plate is thriving. |

#### W7 · Rounds II

One subject per round type, each standing behind what that round beats.

| | |
|---|---|
| **Teaches** | **+P** (1.2x damage, ball rules on plate: an unarmoured man drops in fewer rounds). **Flechettes** for the shotguns (3.5x the pellets at a quarter each, 90% through plate, each leaves a bleed). **API** for the Harrow (AP that sometimes sets a man alight: about 1 in 8, 4 s of fire). **Raufoss** on the Sabot (bursts inside the man behind the plate, then throws 4 pellets out of the far side through up to 1.2 m of cover), and on the Piledriver by holding `{reload}` 0.3 s to switch belts. Flak is taught in the Frame, G8 |
| **Player does** | **+P:** Harrow +P on an unarmoured man at 40 m, the hit count shown against ball. **Flechettes:** pump flechettes into a plated man. **API:** Harrow API into a plated man until one round lights him. **Raufoss:** Sabot Raufoss at a plated man standing in front of a second man behind a 1 m slab; both die. **Piledriver:** hold `{reload}` to switch to Raufoss, then fire at a man behind thin cover |
| **Setup** | All mods bought and fitted at the pod by the player (scrip given: enough for all five, about 6,000 with Raufoss at 2,400; the Sabot and Piledriver issued). Each subject held, plated where the round needs a plate |
| **Done when** | A kill with each of +P, flechette, API (an ignite), Raufoss (two kills from one dart), Piledriver Raufoss |
| **Fail / retry** | If API has not lit anyone after 12 hits, the next hit ignites (a tutorial nudge on the 1-in-8 roll) |
| **Prompts** | `Shop → Mods → fit the round on the card` · Piledriver: `Hold {reload} (R) to switch belts` |
| **Reuses** | All round mods (`src/weapons/raufoss.ts`, `AMMO` in `src/weapons/data.ts`), the pod from W6 |
| **New** | The forced-ignite nudge; hit-count card |
| **Status** | Flechettes and API were being built on 2026-11-17 (uncommitted, `shotgunFlechette`, `thresherFlechette`, `deuceFlechette`, `harrowApi`). The drill is written to their numbers in the tree that day |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w7.intro` | Enters bay | deadpan | Lane seven. Specialist ammunition. Each subject is standing behind the thing his round was designed to defeat. The rounds are at the pod. |
| `tut.w7.plusp` | +P kill | deadpan | Plus-P. More powder, more damage, more wear on the gun. The wear is billed separately. |
| `tut.w7.flechette` | Flechette kill | deadpan | Flechettes. A great many small darts instead of a few pellets. Most of them pass the plate. Each one keeps working after you have moved on. |
| `tut.w7.api` | API ignite | deadpan | Incendiary. Now and then it sets the subject alight. The Council calls this initiative. |
| `tut.w7.raufoss` | Raufoss double | deadpan | Raufoss. It bursts inside the first subject and continues into the second. Cover has been reclassified as a suggestion. |
| `tut.w7.piledriver` | Piledriver Raufoss kill | deadpan | The heavy gun carries both belts. Hold reload to change them. Do not hold it in a hurry. |
| `tut.w7.hint` | Hint | deadpan | Each card says which round to fit. Fit it at the pod, then shoot the subject on that card. |
| `tut.w7.done` | Done | deadpan | Ammunition certified. You now know more about rounds than the subjects did. They have stopped asking questions. |

#### W8 · Plate School

| | |
|---|---|
| **Teaches** | How armour fails. **Light** rounds (SMG, Rivet, Gimlet) are stopped but wear the plate by half the round; **medium** (Harrow, Judge, Ultramag, Awl) are stopped and wreck it on the spot; **heavy** (60 damage and up: the Piledriver) put half through. The Sabot deletes a plate. A direct rocket strips every plate. A shotgun's first pellet on a plate is light, the rest medium. Broken plates fly off with sparks. **The plate is on the front only**: a man running away or flanked has none on his back |
| **Player does** | A plated subject on a slow turntable. Breaks his plate with the Judge (one medium round), sees it fly off. A second: kills him from behind with the SMG while his front faces away. A third, fully plated: one direct rocket, every plate gone |
| **Setup** | Turntable, three plated held subjects (`CARRIER`, `HELMET`). Judge, SMG, rocket launcher issued |
| **Done when** | A plate broken by a medium round; a back-shot kill; a rocket strip |
| **Fail / retry** | None beyond the shared rules |
| **Prompts** | `Heavier rounds break plates` · `The plate is in front: shoot him from behind` |
| **Reuses** | `src/enemies/wounds/armour.ts`, `armourHit`, plate-off sparks and `armor_plate_off` |
| **New** | Turntable (from W5) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w8.intro` | Enters bay | deadpan | Lane eight. Plates. A plate stops small rounds and is worn down by them. A heavier round breaks it. The revolver is heavier. |
| `tut.w8.back` | Plate broken | deadpan | The plate is on the front of the subject. The back of the subject is not plated. The turntable will show you the back. |
| `tut.w8.rocket` | Back-shot kill | deadpan | Or remove all of it at once. A direct hit with a rocket strips every plate he has. Usually with the subject. |
| `tut.w8.hint` | Hint | deadpan | Hit the plate with the revolver. Then wait for his back. |
| `tut.w8.done` | Done | deadpan | Plate school complete. The plates have been recycled. The subjects have also been recycled. |

#### W9 · Through Walls

| | |
|---|---|
| **Teaches** | Penetration: a round has a budget of metres of concrete, spent by each wall and each body. The Harrow goes through one body or thin cover. The Piledriver through 2.4 m of wall and everyone in line. The Sabot through armour, walls and everyone in line. AP adds 0.4 m. The holes: small and dark going in, wide and pale coming out |
| **Player does** | Three walls, 0.5, 1.2 and 2.4 m thick, each with a held subject behind it. Their positions are lit on the wall by a projected outline (the Council shows them; the sonar way is C2). Kills each through the wall with the gun named on it |
| **Setup** | Harrow (0.5 m), Harrow with AP or the Trommel (1.2 m), Piledriver or Sabot (2.4 m). Outlines projected for this lesson only |
| **Done when** | Three kills through walls |
| **Fail / retry** | Shared |
| **Prompts** | `The wall plate shows its thickness and the gun that goes through` |
| **Reuses** | `src/weapons/penetration.ts`, decals |
| **New** | Projected outlines |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w9.intro` | Enters bay | deadpan | Lane nine. Walls. Some of your rounds go through them. Each subject is standing behind a wall of a different thickness. Each wall is labelled. The subjects are not. |
| `tut.w9.hint` | Hint | deadpan | The thicker the wall, the heavier the gun. The label says which. |
| `tut.w9.done` | Done | deadpan | Three walls, three subjects. The walls will be repaired. That is the difference between them. |

#### W10 · The Long Lane

| | |
|---|---|
| **Teaches** | Scopes and sights: ACOG 4x and red dot 2x, the Sabot's scope, the **Awl's 8x**, the Autocannon's scope, and the focus zoom on top of a scope up to the **12x cap** |
| **Player does** | A 150 m lane. Head shots on three held subjects at 80, 120 and 150 m with the Awl (8x), the last with the focus zoom held, which takes it to the 12x cap |
| **Setup** | Awl issued, ACOG on a second Harrow for comparison at 80 m. Light wind flags (dressing only; no bullet drop exists) |
| **Done when** | Three headshots |
| **Fail / retry** | Shared |
| **Prompts** | `{aim} to scope · hold {dash} to focus further` |
| **Reuses** | Scopes, `adsZoom.ts`, the cap (`minFov`) |
| **New** | The long lane |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w10.intro` | Enters bay | deadpan | Lane ten. Range. The rifle on the rack has an eight-power scope. Focus while scoped and it goes further, to a limit. The limit is not negotiable. |
| `tut.w10.far` | Two down | deadpan | The last subject is a hundred and fifty metres away. He believes that is far. Correct him. |
| `tut.w10.hint` | Hint | deadpan | Scope, then hold your breath with the dash key. The head is the small part on top. |
| `tut.w10.done` | Done | deadpan | Long-range certified. Distance has been removed from your list of reasons. |

#### W11 · Grenade Court

| | |
|---|---|
| **Teaches** | Grenades (`{grenade}`, G: start with 3, carry 6): press pulls the pin and starts a 2.6 s fuse, release throws with the time left, a beep every 0.8 s, held to zero it goes off in your hand. Radius 7, 190 damage. Grenades bounce, and **can be shot out of the air** |
| **Player does** | Throws one into a trench of four held subjects. Cooks one so it bursts in the air over a second trench, a cover-backed one. Then the Council lobs a grenade from a hatch toward the player: shoot it in the air before it lands |
| **Setup** | Two trenches 20 m out, 4 held subjects each. The hatch on the far wall throws a live grenade on a slow arc that lands 4 m from the player after 2 s |
| **Done when** | A trench cleared by a thrown grenade; an airburst (detonation 1 m or more above the floor); the lobbed one shot down |
| **Fail / retry** | Killed by the lobbed grenade: shared death rule. Held one too long: shared death rule, and the fail quip |
| **Prompts** | `{grenade} (G): hold to cook, release to throw` · `Shoot grenades out of the air` |
| **Reuses** | Frags, cooking, shootable grenades |
| **New** | The hatch thrower |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w11.intro` | Enters bay | deadpan | The grenade court. Hold to pull the pin, release to throw. The longer you hold, the less time they have. |
| `tut.w11.cook` | First trench cleared | deadpan | The second trench has a lip. Hold the grenade until it would burst over them, not beside them. |
| `tut.w11.shoot` | Airburst | deadpan | The Council will now throw one at you. Shoot it before it lands. This is a test. The grenade is not. |
| `tut.w11.hint` | Hint | deadpan | Listen to the beeps. Three, and let go. |
| `tut.w11.done` | Done | deadpan | Grenades certified. Please return any pins. The pins are inventoried. |
| `tut.w11.fail` | Held too long | deadpan | You held the grenade until it went off. You were thorough. |

#### W12 · Infirmary

**Set piece:** the Council switches on the **corrective floor**, a grid that sends a shock up through the boots.

| | |
|---|---|
| **Teaches** | Health is 100 and comes back at 5 a second after 3 s without damage. Armour takes two thirds of every hit. **Stims** (`{stim}`, Q: start with 1, carry 5): a 1 s injection, 30 health halfway through, no firing, aiming or reloading during it, moving at 0.45x. Refusals: `NO STIMS`, `HEALTH FULL`. At the pod: field dressing (health to full) and armour plate (+100) |
| **Player does** | Stands on the corrective floor until health is low, steps off and waits for regen. Steps back on and uses a stim while standing on it. Buys an armour plate at the pod and walks the floor again to see the armour bar take it |
| **Setup** | The floor deals 12 a second in pulses and never kills (stops at 15 health). 2 stims, 400 scrip |
| **Done when** | One regen to full; one stim used on the floor; one armour plate bought |
| **Fail / retry** | None. The floor cannot kill |
| **Prompts** | `Off the floor, health comes back` · `{stim} (Q) to use a stim` · `Pod: armour plate, field dressing` |
| **Reuses** | Stims (`src/progression/stims.ts`), regen, the resupply rows (`SUPPLY_WARES`) |
| **New** | The corrective floor (a damage zone) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w12.intro` | Floor on | deadpan | The Infirmary. The floor has been switched on. It administers a corrective charge. It will not kill you. It has been told. |
| `tut.w12.regen` | Health under 40 | deadpan | Step off. Your health returns on its own if you stop being hurt for a few seconds. Most problems do not work like this. |
| `tut.w12.stim` | Regen done | deadpan | Step back on and use a stim. You cannot shoot while injecting. You can hardly walk. Choose your moment better than this. |
| `tut.w12.plate` | Stim used | deadpan | The pod sells armour plate. It takes most of every hit. Buy one and walk the floor again. |
| `tut.w12.hint` | Hint | deadpan | Off the floor to heal. On the floor to practise. The stim is on its own key. |
| `tut.w12.done` | Done | deadpan | Medical certified. The floor has been switched off. It will be switched on again for the next contractor, who is also you. |

#### W13 · The Armoury (optional side room)

Every gun has a trick that no other gun has, and most players never find them. The Armoury is a side room off the Gallery with one
booth per weapon. Each booth has a held subject or a target, a card, and one drill. It is **optional**: the Gallery's exit opens without
it, and a board by the door ticks the booths done. Station select lists it on its own.

| Booth | Gun | Drill | Done when |
|---|---|---|---|
| 1 | **Judge** | Hold `{aim}` (RMB) to charge rounds and paint heads on three subjects, release to fan them off (the walk drops to 0.5x while fanning; the Judge has no ADS) | Three heads from one fan |
| 2 | **Rivet** | Triple headshots at speed: three subjects in 1.5 s | Three heads |
| 3 | **Harrow** | Through one subject into the one behind him | Two from one round |
| 4 | **Gimlet** | Hold `{reload}` to step the fire selector. Then with the launcher (`gimletGl`) fitted at the pod, hold `{reload}` to raise it and lob one | Selector changed; a launcher kill |
| 5 | **Autoraffica** | Hold `{reload}` for smart aim; three-round bursts lock heads | A smart-aim kill |
| 6 | **Ultramag** | Laser module and compensator fitted: watch the beam and dot | Five hits on the move |
| 7 | **Thresher** | Hold the trigger on a group: the drum climbs and does not spring back | Three kills in one drum |
| 8 | **Quiver** | Hold to paint four marks, release: four missiles home. A tap fires four straight | Four painted kills |
| 9 | **Sabot** | Through a plated subject, the wall and the man behind | Two from one dart |
| 10 | **Autocannon** | Scoped, one shell into a group of three (blast radius 5) | Three from one shell |
| 11 | **Lance** | Tap for plasma balls; hold through three stages for the beam through a line of four subjects and two walls, bursting at each body | Four from one beam |
| 12 | **Trommel** | Spin up and fire; every round bursts; you walk at half speed while it fires, and it cannot start a slide | Limbs taken from three |
| 13 | **Piledriver** | Through 2.4 m of wall (W9's) and the line behind | Two through the wall |
| 14 | **Kiln** | A stream on a group: burning men panic and spread fire | Three burning |
| 15 | **Stakegun** | Pin a subject to the wall behind him; right click for exploding bolts | A pin; a bolt kill |
| 16 | **Flail** (in progress: the LMG being built) | Fire the 100-round box from the hip at a line | Ten kills on one box |

Lines: one intro, one done for the room, and one card line per booth read as text only (not voiced), to keep the voice budget sane.

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.w13.intro` | Enters room | deadpan | The Armoury. Each weapon does one thing that the others do not. The cards explain. This room is optional. Optional rooms are where the Council keeps its favourite things. |
| `tut.w13.done` | All booths | deadpan | Every booth complete. You have now fired every weapon the Council issues. The Council has now billed every weapon the Council issues. |

#### P1 · Procurement

The pod from W6 becomes the Procurement desk lesson: the parts of the shop the rounds did not need.

| | |
|---|---|
| **Teaches** | The whole Procurement menu (Form 7742-P): **Up/Down** rows, **Left/Right** pages (Weapons, Mods, Implants; chips on their own rows), **Enter** buy or fit, **X or Delete** sell (press twice), **Esc or E** leave. Unlocks by wave (`Released after wave N`: shown, but every row is unlocked in the tutorial). **Sell** pays half the gun plus half its mods. Resupply rows: **Ammunition** 250 (every reserve to full), **Field dressing** 150, **Armour plate** 300. Implants and chips are bought here (used in C and S) |
| **Player does** | Sells the Gimlet. Buys an Ammunition resupply. Buys the **Rivet Akimbo** mod (needed for C6). Opens the Implants page and reads it |
| **Setup** | 3,000 scrip. Reserves drained so Ammunition is not `Full` |
| **Done when** | A sell; a resupply; `rivetAkimbo` owned; the Implants page opened |
| **Fail / retry** | None |
| **Prompts** | `Left/Right: pages · Enter: buy or fit · X: sell (twice) · Esc: leave` |
| **Reuses** | Procurement, `shop/rules.ts` (sell rate 0.5), `SUPPLY_WARES` |
| **New** | Shop rules with the wave locks lifted for the tutorial |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.p1.intro` | Opens the shop | deadpan | Procurement. Everything is for sale, including things you already own. Sell the Gimlet. The Council buys back at half price, which is more than it offers for you. |
| `tut.p1.resupply` | Sold | deadpan | The first rows refill your ammunition, your health and your armour. They can be bought as often as you can afford them. |
| `tut.p1.akimbo` | Resupply bought | deadpan | Buy the second pistol. It will be needed later. You will be holding one in each hand. The Council has insured neither. |
| `tut.p1.implants` | Akimbo owned | deadpan | The next page sells implants. You have three slots. You are not ready for them. Look, but do not touch. |
| `tut.p1.done` | Done | deadpan | Procurement complete. Please retain your receipts. You will not be given any. |

### 3.5 The Cutting Room (K)

A square white-tiled hall, 30 x 25 m, with drains in the floor and a hose on the wall. Held subjects stand on painted spots at measured
distances: 2, 3, 6 and 7 m. A **combo board** on the far wall lights each combo's inputs as the player presses them.

The moves (`src/weapons/melee/data.ts`, `combo.ts`, `Melee.ts`): `s` is a left-click swing, `t` is a right-click stab.

#### K1 · Standard Issue

**Set piece:** the Council empties every magazine and every reserve the player carries. The guns click dry and hand over to one
another, then to nothing.

| | |
|---|---|
| **Teaches** | Melee when the guns are dry. **Quick melee** (`{melee}`, F) swings whatever key 5 would draw, from any gun, without switching. Key 5 draws the katana |
| **Player does** | Kills one held subject with `{melee}` while still holding an empty gun. Then draws the sword with `{weapon5}` and kills a second |
| **Setup** | New `drain` step empties every gun. Two held subjects at 2 m |
| **Done when** | A kill by quick melee; a kill with the drawn sword |
| **Fail / retry** | None |
| **Prompts** | `{melee} (F): quick melee from any gun` · `{weapon5} (5) to draw the blade` |
| **Reuses** | Quick melee, `weapon:empty` |
| **New** | `drain` step |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k1.intro` | Guns drained | deadpan | The Cutting Room. Your ammunition has been withdrawn. This happens in the field without notice. Here, you have been given notice. |
| `tut.k1.blade` | Next | deadpan | Contractor, when you run out of ammunition, here is your standard issue blade. It is never empty. It is never billed. It is the only thing you own outright. |
| `tut.k1.quick` | Next | deadpan | You do not need to put your gun away to use it. Strike from where you stand. |
| `tut.k1.draw` | Quick-melee kill | deadpan | Now draw it properly. |
| `tut.k1.hint` | Hint | deadpan | The quick strike is on its own key. The blade lives on the fifth. |
| `tut.k1.done` | Done | deadpan | Blade confirmed. The subjects have been notified that the contractor is still armed. They have taken it badly. |

#### K2 · The Chain

| | |
|---|---|
| **Teaches** | The light chain: three swings, each harder (1x, 1.25x, 1.5x) and slower (0.25, 0.3, 0.35 s), linked inside a 0.7 s window; hold `{fire}` to chain by itself. Reach about 2 to 2.2 m, and the blade cuts only what it reaches: in front, not behind cover. A kill cuts the body along the swing |
| **Player does** | A full three-swing chain on one subject. Then a chain held down through two subjects side by side |
| **Setup** | Three held subjects at 2 m |
| **Done when** | Three hits in one chain; a slice kill |
| **Fail / retry** | A broken chain (window missed) resets the count, no line |
| **Prompts** | `{fire} (LMB) three times: the chain · hold to chain by itself` |
| **Reuses** | Katana, slices (`gore/sliced.ts`) |
| **New** | A chain-count check |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k2.intro` | Enters | deadpan | Three strikes, each harder than the last. Keep them close together or the third one does not come. |
| `tut.k2.hold` | One chain done | deadpan | Hold the button and the blade chains itself. Your hand is permitted to rest. The blade is not. |
| `tut.k2.hint` | Hint | deadpan | Strike again before the last strike ends. Then once more. |
| `tut.k2.done` | Done | deadpan | The chain is certified. So is the drain in the floor. |

#### K3 · Stab and Lunge

| | |
|---|---|
| **Teaches** | The stab (`{aim}`, RMB, a press): a 3.2 m thrust at 1.2x that flings the body. The **lock-dash stab**: a stab in the middle of a chain at a target past slash reach, within 6 m, dashes the player to him |
| **Player does** | Stabs a subject at 3 m. Swings at the 2 m subject, then stabs the 6 m one in the same chain and is pulled to him |
| **Setup** | Subjects at 2, 3 and 6 m |
| **Done when** | A stab kill at 3 m; a lock-dash stab hit at 5 m or more |
| **Fail / retry** | None |
| **Prompts** | `{aim} (RMB) to stab · mid-chain, stab a far one to lunge at him` |
| **Reuses** | Stab and lock-dash |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k3.intro` | Enters | deadpan | The stab reaches further than the swing. A little further. Do not get ideas. |
| `tut.k3.lunge` | Stab kill | deadpan | Stab in the middle of a chain, at a subject beyond your reach, and the blade will take you to him. It is very keen. |
| `tut.k3.hint` | Hint | deadpan | Swing at the near one, then stab at the far one before the chain ends. |
| `tut.k3.done` | Done | deadpan | Lunge certified. Distance has been removed from this list of reasons also. |

#### K4 · Guard and Parry

The one drill in the indoor wings with a man who can hurt the player: a **live** subject on a short leash with a pistol.

| | |
|---|---|
| **Teaches** | The guard: hold `{aim}` (RMB) past the stab and the blade blocks shots from the front, which stop in sparks. The **parry**: raise the guard within 0.24 s of a shot and it goes back down the crosshair at 3x its damage |
| **Player does** | Blocks three shots. Then parries one back into the shooter, aimed at him, which kills him |
| **Setup** | One live subject 15 m away behind a waist-high rail, Rivet-class pistol, firing one shot every 1.6 s with a clear tell: he raises the gun and a click plays 0.4 s before each shot. Shots do a pistol's normal damage. He has no other behaviour |
| **Done when** | 3 blocked shots (`block` events); a parried kill |
| **Fail / retry** | Death by pistol: shared death rule (unlikely) |
| **Prompts** | `Hold {aim} (RMB): guard · raise it as he fires: parry · aim at him to send it back` |
| **Reuses** | Guard and parry (`src/weapons/Combat.ts`), live soldier with a forced loop |
| **New** | A scripted "shoot on a rhythm" order for one soldier; a parry event if none exists |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k4.intro` | Enters | deadpan | Subject 3310 has been given a pistol and told that if he hits you, he can go home. Both statements are partly true. |
| `tut.k4.guard` | Next | deadpan | Hold the guard and the blade will stop what he sends at you. |
| `tut.k4.parry` | Three blocks | deadpan | Raise the guard as he fires, not before, and his round goes back the way it came. Look at him when you do it. The round goes where you look. |
| `tut.k4.hint` | Hint | deadpan | He raises the gun. It clicks. Then raise the guard. |
| `tut.k4.done` | Parried kill | deadpan | Subject 3310 will not be going home. He has been informed. Briefly. |

#### K5 · Dash-Slash

| | |
|---|---|
| **Teaches** | A swing while running at 7 m/s or more at someone within 7 m ahead dashes the player to him |
| **Player does** | Runs at a subject 7 m away and swings: arrives and cuts. Twice, on two subjects 10 m apart |
| **Setup** | Two held subjects on spots at the ends of a 20 m run |
| **Done when** | Two dash-slash kills |
| **Fail / retry** | None |
| **Prompts** | `Running, {fire} at a man within 7 m: you dash to him` |
| **Reuses** | `KATANA.dash` |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k5.intro` | Enters | deadpan | Swing while running at a subject and the blade covers the last few metres for you. Run first. Then swing. |
| `tut.k5.hint` | Hint | deadpan | Full speed, and swing when he is about seven metres away. |
| `tut.k5.done` | Done | deadpan | Dash-slash certified. The subjects have asked whether running helps. It does not. |

#### K6 · The Combo Board

| | |
|---|---|
| **Teaches** | The four combo moves: **CLEAVE** `s s t` (a 2.6x overhead), **TORNADO** `s s s t` (a 360 degree spin), **FLYING SLASH** `t t s` (a crescent that flies 32 m, cuts every body it crosses and bursts on the wall it meets), **FLURRY** `s t t` (six stabs in 0.55 s) |
| **Player does** | Each combo once, each on its own setup: Cleave on a plated subject at 2 m; Tornado inside a ring of four; Flying Slash down a 20 m lane of three in a line; Flurry on one subject |
| **Setup** | The board lights each move's three or four inputs as the player presses them and flashes the name when it lands. Subjects as listed |
| **Done when** | All four named moves seen (a combo event) |
| **Fail / retry** | Wrong inputs clear the board |
| **Prompts** | The board: `CLEAVE  LMB LMB RMB` · `TORNADO  LMB LMB LMB RMB` · `FLYING SLASH  RMB RMB LMB` · `FLURRY  LMB RMB RMB` (from the player's bindings) |
| **Reuses** | `melee/combo.ts` |
| **New** | The board (a world screen); a `melee:combo { move }` event if none exists |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k6.intro` | Enters | deadpan | The board on the wall lists four combinations. Each has a name. The names were chosen by a committee, which is why they are like that. |
| `tut.k6.cleave` | Cleave lands | deadpan | Cleave. Two strikes and a stab, and the stab comes down from above. |
| `tut.k6.tornado` | Tornado lands | deadpan | Tornado. Everything around you, at once. |
| `tut.k6.flying` | Flying Slash lands | deadpan | The flying slash leaves the blade and keeps going. It is the only part of the blade that does. |
| `tut.k6.flurry` | Flurry lands | deadpan | Flurry. Six in half a second. The subject did not have time to object. |
| `tut.k6.hint` | Hint | deadpan | Follow the lights on the board. Left is the swing, right is the stab. |
| `tut.k6.done` | Done | deadpan | All four combinations certified. The committee has been informed. The committee does not care. |

#### K7 · The Energy Blade (in progress)

**In progress: the energy blade was being built on 2026-11-17** (uncommitted `swordEnergy` mod in `src/weapons/mods.ts`,
`ENERGY` in `src/weapons/melee/data.ts`, `src/gore/sear.ts`). The drill is written to those numbers.

| | |
|---|---|
| **Teaches** | The **Energy blade** mod for the katana, bought and fitted at a pod: every swing, stab and combo 1.4x faster (and the chain window with them); the dash and the stab's lock reach 1.5x as far and pull harder; thrusts reach 1 m further; it **goes through plate**; its cuts take limbs with no blood (cauterised); its kills burn away; the guard holds a wider cone and parries for twice as long |
| **Player does** | Buys and fits it at the room's pod. Kills a fully plated subject through the plate with a stab. Lunges at a subject 9 m away (past the steel blade's 6 m). Parries one shot from K4's shooter, brought back |
| **Setup** | A pod in the room. Scrip for the mod. A plated held subject, a held subject at 9 m, and the shooter |
| **Done when** | Fitted; a plated kill by stab; a lunge hit at 8 m or more; a parry |
| **Fail / retry** | Shared |
| **Prompts** | `Pod → Mods → Sword → Energy blade` |
| **Reuses** | `swordEnergy`, the shop, K4's shooter |
| **New** | Nothing beyond the shared pieces |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k7.intro` | Enters | deadpan | The energy blade. It is offered to senior contractors. You are not a senior contractor. You are being offered it anyway, which is a test of character. |
| `tut.k7.plate` | Fitted | deadpan | It is faster, it reaches further and it does not acknowledge plates. Stab the armoured subject. |
| `tut.k7.burn` | Plated kill | deadpan | The energy blade does not leave much. This saves on cleaning. It has been factored into the price. |
| `tut.k7.reach` | Next | deadpan | The lunge is longer. The subject at the far mark believed he was safe. Correct him. |
| `tut.k7.hint` | Hint | deadpan | Stab through the plate. Lunge further than before. |
| `tut.k7.done` | Done | deadpan | Energy blade certified. It will be removed from your suite at the door. It can be purchased. Everything can. |

#### K8 · The Cutting Exam

| | |
|---|---|
| **Teaches** | Melee under pressure, and mixing moves |
| **Player does** | Eight held subjects and two live ones with pistols, released into the room at once. Steel blade only. Clears them using at least three different named moves or the dash-slash |
| **Setup** | Guns drained again. The two live men are conscripts with pistols and normal Outpost AI, no surrender |
| **Done when** | All ten down, with three move types logged |
| **Fail / retry** | Shared death rule |
| **Prompts** | `Blade only · use three different moves` |
| **Reuses** | Everything in K |
| **New** | Move-type tally |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.k8.intro` | Enters | deadpan | The examination. Ten subjects, two of them armed. You have the blade. They have each other. |
| `tut.k8.hint` | Hint | deadpan | Use what you were shown. All of it, ideally. |
| `tut.k8.done` | Done | deadpan | Examination passed. The hose on the wall is for the next contractor. The drain is for everyone. |

### 3.6 The Quiet Rooms (C): brain chips

Four rooms with the lights, the smoke and the doors under the Council's hand. The brain chip is on `{sonar}` (T). With one chip, T
works it. With two, a tap works the chip in hand and holding T for 0.32 s switches to the next (`src/contracts/chips.ts`).

#### C1 · The Dark Maze (Sonar)

**Set piece:** the Council kills the lights. The maze goes black except the cyan strip on the floor.

| | |
|---|---|
| **Teaches** | **Sonar** and why it matters: a tap sends a ring across the map in 1.6 s and shows every man through walls for 4 s. Recharge 8 s, or 3 s when 3 or fewer are left. It finds **hidden** men, **running** men, and men **playing dead**: on sonar, a "corpse" that is breathing shows like any live man |
| **Player does** | Five subjects are released into a 40 x 40 m maze of low rooms and hide (crouched still in corners). Finds and kills all five. Then crosses a room of six bodies on the floor: one of them is alive, playing dead. Sonar shows which. Kills him before he gets up |
| **Setup** | Sonar chip (the issued one). Lights off. Released subjects with a "hide" goal instead of an exit. The playing-dead man: a live subject on the floor among corpses, who gets up and runs for the door if the player walks past him |
| **Done when** | Five hiders dead; the faker dead |
| **Fail / retry** | The faker reaches the door: he is walked back and the room resets |
| **Prompts** | `{sonar} (T): sonar, every man through walls for 4 s` |
| **Reuses** | Sonar (`src/contracts/sonar.ts`), released subjects, the lights-out trick from the Outpost mission |
| **New** | "Hide" goal for released subjects; a playing-dead pose for a live subject |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c1.intro` | Lights off | deadpan | The Quiet Rooms. The lights have been switched off. Five subjects have been released into the maze. They are hiding. They are not very good at it. |
| `tut.c1.sonar` | Next | deadpan | Your sonar shows every living body through walls, for a few seconds. Use it, walk, use it again. Hidden men and running men cannot hide from it. |
| `tut.c1.faker` | Five down | deadpan | The next room contains six bodies. Five are deceased. One is pretending. Your sonar does not accept pretending. |
| `tut.c1.hint` | Hint | deadpan | Ping, look at where they are, then go there. They will move. Ping again. |
| `tut.c1.done` | Done | deadpan | Sonar certified. The lights will now come back on. They were only off for you. |
| `tut.c1.fail` | Faker escapes | deadpan | He was not dead. You were told he was not dead. He has been returned to the floor. |

#### C2 · Ping and Pierce

| | |
|---|---|
| **Teaches** | Sonar plus penetration: "ping the sonar, then shoot what it shows". The marks are the only way to know where the men are |
| **Player does** | Three held subjects in sealed concrete rooms. Pings, then kills each through his wall with the Sabot |
| **Setup** | Sabot issued; sealed rooms with walls of 0.6 to 1 m. No projected outlines this time |
| **Done when** | Three kills through walls |
| **Fail / retry** | Shared |
| **Prompts** | `{sonar}, then shoot where it showed them` |
| **Reuses** | Sonar, Sabot |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c2.intro` | Enters | deadpan | Three subjects are behind these walls. There are no doors. The rifle goes through walls. The sonar tells it where. |
| `tut.c2.hint` | Hint | deadpan | Ping, aim where they were, fire. Then ping again to confirm. Confirmation is good practice. |
| `tut.c2.done` | Done | deadpan | Three subjects, no doors opened. The rooms have been re-sealed, with contents. |

#### C3 · The Smoke Hall (Thermal)

**Set piece:** the Council floods the hall with smoke from vents in the floor.

| | |
|---|---|
| **Teaches** | **Thermal** (a chip: 1,400, after wave 3): a tap toggles the gunship's black-hot view, with no time limit. Bodies show through smoke and through cover out to 40 m |
| **Player does** | The Council swaps the chip to Thermal. Kills four held subjects standing in the smoke, two of them behind sheets of thin cover |
| **Setup** | New `chip` step sets the slot. Thick smoke that hides everything at 6 m |
| **Done when** | Four kills |
| **Fail / retry** | Shared |
| **Prompts** | `{sonar} (T): Thermal on and off` |
| **Reuses** | Thermal (`src/contracts/chips.ts`, the black-hot view), smoke |
| **New** | `chip` step; smoke vents for the room |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c3.intro` | Smoke on | deadpan | Your brain chip has been replaced with Thermal. The hall is full of smoke. The subjects in it are warm. That is their mistake. |
| `tut.c3.hint` | Hint | deadpan | Switch Thermal on and leave it on. It does not run out. Warm shapes are subjects. Cold shapes are furniture. |
| `tut.c3.done` | Done | deadpan | Thermal certified. The smoke will be extracted. The subjects will be extracted separately. |

#### C4 · The Runway (Focus)

| | |
|---|---|
| **Teaches** | **Focus** (a chip: 2,200, after wave 6): a tap slows the world to 0.35x while the player moves at full speed. A 4 s meter, refilling over 18 s after a 1.5 s pause; it needs 25% to start; tap again to stop. **Not in co-op** (`NO FOCUS BRAIN CHIP IN CO-OP`) |
| **Player does** | Four subjects stand back to back in the middle of a hall with four exit doors 25 m away. On a bell, they are released and sprint for the doors. Kills all four before any reaches a door |
| **Setup** | Focus chip set. Four released subjects with the four doors as goals |
| **Done when** | All four down with no door reached |
| **Fail / retry** | A door reached: all four walked back, the bell rings again. The meter is refilled for each try |
| **Prompts** | `{sonar} (T): Focus, the world slows for you` |
| **Reuses** | Focus chip, released subjects |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c4.intro` | Enters | deadpan | Your chip is now Focus. It slows everything except you. The four subjects in the middle will be released at the bell. They have been told the doors are open. |
| `tut.c4.hint` | Hint | deadpan | Use Focus as they start to run, not after. It is short. They are not fast, but they are four. |
| `tut.c4.done` | Done | deadpan | Focus certified. The doors were open. The subjects were correct about that. |
| `tut.c4.fail` | A door reached | deadpan | One of them reached the door. The door has been closed again. So has his file. Again, please. |

#### C5 · Two Chips

| | |
|---|---|
| **Teaches** | The second chip slot (1,600, after wave 4). A tap uses the chip in hand. Holding `{sonar}` 0.32 s switches to the next, with a `<NAME> BRAIN CHIP` callout |
| **Player does** | With Sonar and Focus fitted: switches to Sonar and pings a released runner in a small maze; switches to Focus and kills him as he crosses a gap |
| **Setup** | Both chips set, slot 2 opened |
| **Done when** | One switch each way; the runner dead |
| **Fail / retry** | He escapes: reset |
| **Prompts** | `Hold {sonar} (T) to switch chips · tap to use` |
| **Reuses** | Chip slots |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c5.intro` | Enters | deadpan | You now have two chips. Tap to use the one you are holding. Hold to change to the other. Holding is not using. Please learn the difference here, not later. |
| `tut.c5.done` | Done | deadpan | Two chips certified. Your head is now worth more than you are. |

#### C6 · The Ring (Akimbo and Gun Kata)

**Set piece:** the darkest room in the Annex. Twelve held subjects stand in a ring round a painted circle, facing in, all begging at
once.

| | |
|---|---|
| **Teaches** | **Akimbo** (a mod on the SMG, Rivet, Ultramag, Judge or Autoraffica, in the sight slot: twice the magazine, twice the reload, shots alternate hands, right click becomes a sightless zoom). **Gun Kata** (a chip: 2,600, after wave 10): **hold `{sonar}`** for 1.2 s; a heartbeat plays, targets light red, the screen closes in; at full charge it puts one head shot into each man in sight within 22 m, all the way round, up to 14, about 0.085 s apart, from the magazines. Let go early and nothing is spent. 18 s cooldown. Refusals: `NEEDS AKIMBO`, `NO TARGETS IN SIGHT` |
| **Player does** | Holds T with a single Rivet first and sees `NEEDS AKIMBO`. Fits the Rivet Akimbo (bought in P1) at the room's pod. Stands in the circle, holds T to full charge, and the ring falls |
| **Setup** | Gun Kata chip set. A pod in the room. If `rivetAkimbo` was not bought (the kiosk route), the pod gives it free with the Council's alt line. Twelve held subjects 10 to 18 m out |
| **Done when** | `chip:kata` with 10 or more kills |
| **Fail / retry** | A release before full charge: nothing spent, try again. A ring not fully cleared: the survivors stay and the cooldown runs; a second kata finishes them |
| **Prompts** | `Gun Kata needs akimbo: fit it at the pod` · `Hold {sonar} (T) to full charge` |
| **Reuses** | Akimbo mods, Gun Kata (`src/weapons/kata.ts`), `chip:kata` |
| **New** | Nothing beyond held subjects |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.c6.intro` | Enters | deadpan | The Ring. Twelve subjects. They have been told this is a group exercise. |
| `tut.c6.chip` | Next | deadpan | Your chip is now Gun Kata. Hold it, and when it is ready, every subject you can see will be shot in the head at once. Hold it now. |
| `tut.c6.akimbo` | `NEEDS AKIMBO` | deadpan | It requires a pistol in each hand. You bought a second pistol. Fit it at the pod. |
| `tut.c6.alt` | No akimbo owned | deadpan | You did not buy a second pistol. One has been provided. It has been added to your account, with interest. |
| `tut.c6.go` | Akimbo fitted | deadpan | Stand in the circle. Hold until it is ready. Letting go early costs nothing. Letting go late is not possible. |
| `tut.c6.hint` | Hint | deadpan | Hold, and keep holding. You will hear your heart. That is normal. The subjects will hear theirs. |
| `tut.c6.done` | Done | deadpan | Gun Kata certified. The Ring will be reset for the next contractor. It takes longer to reset than to use. |

### 3.7 The Pen (S): streaks, perks and implants

A wide hall, 40 x 30 m, of steel pens with gates the Council opens in batches. Released subjects pour out of the pens and run for
the far wall. Above it: the **combo counter** made big on a wall screen for this wing, and the implant bench with a pod.

Combos (`src/progression/`): the next kill within 5 s of the last keeps a combo going. Perks fire on their own triggers. Implants
are fitted in three slots (slot 2 and 3 bought), one per class (Gun, Kill, Move), with a 30 s rearm after each use. SLOWMO,
Adrenaline and the Geneva Suggestion are always on and need no slot.

| # | Station | Perk | Trigger | Setup | Done when |
|---|---|---|---|---|---|
| S1 | **Blood Thirst** | Issued in slot 1: 2x damage, bottomless magazine, double pellets, magazines refilled, 10 s | 4 kills in 5 s | A pen of six released subjects, the pump shotgun | `perk:start` bloodthirst |
| S2 | **SLOWMO** | Always on: the world at 0.25x for 5 s, the player at full speed | 3 headshots in 3 s | Five held subjects in a row at 15 m, the Rivet | `perk:start` slowmo |
| S3 | **Adrenaline** | Always on: faster, stacks to 3 | 3 sword kills in 3 s | Six held subjects close together, the katana | `perk:start` adrenaline |
| S4 | **Butcher** | Kill class: every hit severs for 8 s | Limbs off 5 men in 4 s | Fitted for the drill. Seven released subjects, the Deuce | `perk:start` butcher |
| S5 | **Chain Reaction** | Kill class: corpses explode for 6 s | 4 kills from one explosion | Six subjects round a barrel; the grenade | `perk:start` chainReaction |
| S6 | **Skyfall** | Move class: unlimited air dashes, slams detonate, 8 s | 4 kills in 6 s while airborne | Jump pads and towers over a pen of eight; the SMG | `perk:start` skyfall, then one detonating slam |
| S7 | **Overdrive** | Move class: damage scales with speed, 1x at 12.5 m/s to 3x at 27 | 5 kills in 10 s above 18 m/s | A hop track round the pen's infield; held subjects in the middle | `perk:start` overdrive |
| S8 | **The bench**: Hellfire, Berserk, Chain Storm, and fitting implants yourself | Hellfire (Gun: exploding bullets, wider rockets, 5 s); Berserk (Gun: cannot die, dual SMGs, 2x damage, 10 s); Chain Storm (Kill: kills arc lightning, 12 s) | Hellfire: 10 kills in 10 s. Berserk: combo 15. Chain Storm: combo 30 | The player fits Hellfire (or Berserk) at the bench pod into slot 2 and triggers it for real on the **big release**: 30 subjects from every pen at once, the Trommel issued. Chain Storm is a **sampler**: the Council switches it on for its 12 s during the release (new `perk` step), because combo 30 is too long a wait for a lesson | Hellfire or Berserk triggered for real; Chain Storm seen |

**Prompts:** each pen's gate has its card (`4 kills in 5 s: BLOOD THIRST`). The combo counter on the wall. At the bench:
`Pod → Implants page · three slots · one of each class`.

**Fail / retry:** a perk not triggered when the pen is empty: the pen refills and the gate opens again. No line on the first two.

**Reuses:** perks and implants (`src/progression/perks.ts`, `implants.ts`), combo, released subjects. **New:** the pen gates, a
`perk` step for the sampler, the wall combo counter (or the HUD's, made bigger for the wing).

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.s.intro` | Enters the Pen | deadpan | The Pen. Kill quickly and your suite rewards you. These rewards are called perks. They are not benefits. Benefits would be taxed. |
| `tut.s1.intro` | At pen 1 | deadpan | Blood Thirst is fitted as standard. Four subjects in five seconds and it wakes up. The gate is opening. |
| `tut.s1.done` | Blood Thirst | deadpan | Blood Thirst. Double damage and a magazine that does not run out. For ten seconds. Everything good is for ten seconds. |
| `tut.s2.intro` | At the row | deadpan | Three headshots in three seconds slow the world down for you. You are not slowed. You are not given the option. |
| `tut.s2.done` | SLOWMO | deadpan | Slow motion. The subjects are experiencing it as well. They do not enjoy it either. |
| `tut.s3.intro` | At the group | deadpan | Three kills with the blade in three seconds, and you get faster. Please do not ask what is in it. |
| `tut.s3.done` | Adrenaline | deadpan | Adrenaline. It stacks. The Council does not. |
| `tut.s4.intro` | At pen 4 | deadpan | Butcher has been fitted for this exercise. Take limbs from five subjects quickly, and every hit takes a limb. |
| `tut.s4.done` | Butcher | deadpan | Butcher. The floor will be hosed. The subjects will be counted twice: once whole, once not. |
| `tut.s5.intro` | At the barrel | deadpan | Chain Reaction. Four subjects from one explosion, and the dead become explosive. The dead are already very cooperative. |
| `tut.s5.done` | Chain Reaction | deadpan | Chain Reaction. Please stand back from the deceased. That was always good advice. |
| `tut.s6.intro` | At the towers | deadpan | Skyfall. Four kills in the air, and your dashes stop running out and your slams go off. Get above them. Stay there. |
| `tut.s6.done` | Skyfall | deadpan | Skyfall. Now slam. |
| `tut.s7.intro` | At the track | deadpan | Overdrive. Five kills at speed, and the faster you go, the harder you hit. The track goes round. Keep going round. |
| `tut.s7.done` | Overdrive | deadpan | Overdrive. Speed has now been monetised. |
| `tut.s8.intro` | At the bench | deadpan | The implant bench. You have three slots, and room for one of each kind. Fit Hellfire, or Berserk, yourself. The Council will then release everything. |
| `tut.s8.release` | Fitted | deadpan | All pens are open. There are thirty of them. You may keep count. We will. |
| `tut.s8.sampler` | During the release | deadpan | Chain Storm has been activated as a courtesy. It normally takes thirty kills. Today it takes a signature. |
| `tut.s.hint` | Hint | deadpan | Faster. Every perk wants the kills close together. The card on the gate says how close. |
| `tut.s.done` | All done | deadpan | Perks certified. The Pen is empty. It will not stay empty. It never does. |

### 3.8 The Yard (Y): prisoners, outdoors

**Why outdoors:** the skyhook. The capture drone dives in and lifts a cuffed man straight up on a line (`src/enemies/outpost/airlift.ts`).
Under a roof it drags him out to open floor first, and the owner has seen it pull men into ceilings. So the Yard has **open sky over
every floor a man can kneel on**: sheds with no roofs, a sandbag line, low walls. The one roofed building, **the bunker**, is where
the hidden squad waits, and nobody is meant to surrender inside it (its floor is marked no-surrender for the drill, and its door
opens onto the yard).

The Yard is the only wing with **live** men: real Outpost soldiers with real AI, at conscript and regular rank, armed with pistols
and SMGs. They shoot back. Some have **forced outcomes** so each lesson happens on cue (6.3). The player has their full kit back.

The loop, in the code's words (`src/enemies/outpost/prisoners.ts`, `capture.ts`, `flight.ts`):

- A man gives up when the fight has really turned: he weighs five signs (squad half gone, nobody within 14 m, his side under a third
  of its peak, out of ammo, badly hurt) and needs 2 (conscript) to 5 (elite) of them, then rolls his rank's odds (0.7 conscript down
  to 0.06 elite). Nothing is decided within 2.5 s of a hit.
- Kneeling, shot and alive, he runs, and never surrenders again. Friends firing nearby, he goes for his gun or the gate. Left alone
  6 s and over 12 m away, he may pick a gun back up. After 45 s he walks out.
- `{interact}` **tap**: question. **Tap again**: release. **Hold 0.4 s**: capture. The prompt is
  `Tap [E] to question · Hold [E] to capture`, then `Tap [E] to release · Hold [E] to capture`.

#### Y1 · Breaking a Squad

| | |
|---|---|
| **Teaches** | How to make men surrender: break the squad, leave one alone, and stop shooting him. A kneeling man shot again runs and never surrenders. Elites almost never give up |
| **Player does** | A squad of four conscripts holds the sandbag line. Kills three. The fourth, alone, breaks and kneels. The player does not shoot him |
| **Setup** | Four live conscripts, pistols and one SMG, normal AI. **Forced fallback:** if the last man has not surrendered 12 s after he is alone, `breakNerve` sends him to his knees (the lab's own button) |
| **Done when** | `enemy:surrendered` |
| **Fail / retry** | The last man killed: a new squad of four walks in through the gate (no death, the Council's fail quip). The last man shot on his knees: he runs, and the drill continues as a lesson in what not to do, then a new squad |
| **Prompts** | `Break the squad: leave one alive and alone` · `Kneeling: don't shoot him` |
| **Reuses** | The whole surrender system; `breakNerve` |
| **New** | Forced-fallback hook from the mission script (6.3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y.intro` | Enters the Yard | deadpan | The Yard. Capturing delinquent subjects is beneficial to Council operations. You will be paid for every one you bring in alive. |
| `tut.y.live` | Next | deadpan | The subjects in the Yard are armed, and have not been told this is training. Neither have their rounds. |
| `tut.y1.do` | Next | deadpan | A man surrenders when he can see that it is over. Kill his friends. Leave him on his own. Then stop. |
| `tut.y1.kneel` | He kneels | deadpan | He has surrendered. Do not shoot him. A man shot while surrendering runs, and never surrenders again, and tells nobody, because he is running. |
| `tut.y1.refused` | Shot while kneeling | deadpan | You shot a surrendered man. He has withdrawn his surrender. That is his right. It is now also your problem. |
| `tut.y1.hint` | Hint | deadpan | Fewer friends, more distance, more blood. When he has run out of reasons, he kneels. |
| `tut.y1.fail` | Last man killed | deadpan | That was the last one. He was the lesson. Another squad has been provided. |

#### Y2 · Questioning

The owner wants the payoff shown clearly: **questioning reveals the men nearby**.

| | |
|---|---|
| **Teaches** | Tap `{interact}` within 3 m to question. A man who talks marks **every squad still fighting**, on the map and through the walls, for 9 s, and names the biggest one, an ambush first: `"<Squad>, 3 men, waiting on the door by the bunker!" "Please. That's all I know."` Conscripts always talk; elites talk 15% of the time. **Men lie**: a liar names an empty spot, marked `SQUAD?`. Questioning also breaks him: his morale is capped |
| **Player does** | Questions the man from Y1. Three hidden men light up through the bunker walls, waiting on its door. The player uses the marks: clears the bunker ambush. Then questions a second prisoner, a **veteran**, who **lies** (forced): a `SQUAD?` marker on an empty shed. The player checks it with sonar and sees nothing there |
| **Setup** | The bunker squad: three live regulars on `waylay` (an ambush on the door), unseen until the questioning. The veteran is the bunker's last man, forced to surrender, then forced to lie |
| **Done when** | A truthful questioning (`prisoner:questioned {truthful:true}`); the bunker squad dead; a lie questioned (`truthful:false`); a sonar ping within 10 s of the lie |
| **Fail / retry** | Killed by the ambush: shared death rule, the Y2 checkpoint (prisoner kneeling again) |
| **Prompts** | `Tap {interact} (E) to question` · on the marks: `Marked for 9 s` · on the lie: `SQUAD? means he may be lying · {sonar} to check` |
| **Reuses** | `question()`, `tell()`, `lie()`, the markers |
| **New** | Forced truth or lie (6.3) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y2.do` | Y1 done | deadpan | Walk up to him and ask. Subjects who are questioned tend to share. |
| `tut.y2.reveal` | Truthful questioning | deadpan | He has told you where his friends are. They are marked. They do not know they are marked. That is the useful part. |
| `tut.y2.bunker` | Marks shown | deadpan | Three men, waiting behind the bunker door for you to open it. Now you know. Do not open it the way they expect. |
| `tut.y2.liar` | Veteran kneels | deadpan | This one is a veteran. Veterans lie. Ask him anyway. |
| `tut.y2.lie` | The lie | deadpan | He says they are in the shed. Check the shed with your sonar before you believe a man on his knees. |
| `tut.y2.caught` | Sonar shows the shed empty | deadpan | Nobody in the shed. He lied to you. He did it bravely. It has been noted under brave, and under lied. |
| `tut.y2.hint` | Hint | deadpan | Close enough to touch him. Tap, do not hold. Holding is a different conversation. |

#### Y3 · Release

| | |
|---|---|
| **Teaches** | Tap `{interact}` again on a man already questioned and he is **let go**: he walks to a gate with his hands up and leaves. **Why:** word gets round. Each man freed adds 6% to the next man's odds of surrendering, up to 24% (not elites). The tutorial shows this once on the HUD |
| **Player does** | Releases the lying veteran (or a third prisoner if the veteran was killed). Watches him walk out of the gate. Then a new squad of four regulars attacks: the HUD shows `SURRENDER ODDS +6%` over their heads, and one of them gives up sooner |
| **Setup** | The release gate on the fence, lit. The new squad, with a normal (not forced) surrender; fallback `breakNerve` after 15 s alone as in Y1 |
| **Done when** | A release (`freed` up); a surrender from the new squad |
| **Fail / retry** | As Y1 |
| **Prompts** | `Tap {interact} again to let him go` · `Freed men raise the odds: +6% each, up to 24%` |
| **Reuses** | `release`, mercy odds (`MERCY_STEP`, `MERCY_MAX`) |
| **New** | The tutorial-only odds tag |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y3.do` | Y2 done | deadpan | You may let him go. Tap again. He will walk out of the gate with his hands up, and he will tell people. |
| `tut.y3.why` | Released | deadpan | Released subjects talk. The next man is more willing to kneel. This is called reputation. It is not called mercy. |
| `tut.y3.squad` | New squad | deadpan | The next squad has heard about you. Some of it was even true. |
| `tut.y3.hint` | Hint | deadpan | Question first. Then tap again to release. |

#### Y4 · Capture and the Skyhook

| | |
|---|---|
| **Teaches** | **Hold** `{interact}` 0.4 s (the hold ring) to cuff him. 1.5 s later a Bureau drone dives in low, hooks him off the ground without slowing and climbs away with him dangling, alive. The **bounty** is paid once as he leaves the floor: 250 a conscript, 300 a regular, 350 a veteran, 450 an elite, into the wallet (`BOUNTY SECURED`). Do not leave prisoners alone: unwatched, some pick a gun back up, and after 45 s they walk out |
| **Player does** | Captures the man from Y3's squad. Then a second, an injured regular from the same fight, left 15 m away: the player sees him look round for a gun if they turn their back for 6 s (forced, so it happens), and captures him before he gets to it |
| **Setup** | The yard's open sky. The scrip wallet on the HUD so the bounty lands visibly. A pistol lying 5 m from the second man |
| **Done when** | Two `prisoner:secured` |
| **Fail / retry** | The second man rearms: he is a live enemy again; kill him and a replacement prisoner is walked in |
| **Prompts** | `Hold {interact} (E) to capture` · `The bounty pays when the drone takes him` · `Don't leave prisoners alone` |
| **Reuses** | Capture, airlift, `BOUNTY`, the hold ring |
| **New** | Forced "rearm when unwatched" |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y4.do` | Y3 done | deadpan | Now capture one. Hold, do not tap. A drone will collect him. You will be paid as he leaves the ground. |
| `tut.y4.paid` | First bounty | deadpan | Bounty secured. He will be processed, and perhaps one day he will come back here, to help with your retraining. |
| `tut.y4.alone` | Second man, player turned away | deadpan | You turned your back on a prisoner. He has noticed. Prisoners are not furniture. They have opinions about pistols. |
| `tut.y4.hint` | Hint | deadpan | Hold until the ring fills. Then stand back. The drone does not slow down for contractors. |
| `tut.y4.done` | Two secured | deadpan | Two subjects captured, two bounties paid. Your account is briefly in credit. Please enjoy the feeling. It is being processed. |

#### Y5 · Runners

| | |
|---|---|
| **Teaches** | **Fleeing men.** A broken man who does not surrender runs: cover to cover, 8 to 48 m at a time, away from every player and out of sight. He re-plans when a player gets within 18 m. He is **caught** when a player is within 5 m and sees him, or within 12 m and sees him for 3.5 s. After 50 s of running he is made to choose. **Sonar** finds them |
| **Player does** | A squad in the runners' maze (low walls, a ditch, sheds) is hit by a scripted mortar strike; three survivors break and run (forced flee). The player hunts them down with sonar and corners all three |
| **Setup** | Three live regulars, forced `flee`. When caught, each takes the **surrender** reaction (forced) so this drill stays about the hunt; Y6 is about the other reactions |
| **Done when** | Three men caught (then captured, released or killed: any) |
| **Fail / retry** | A runner who has run 50 s is made to choose and kneels (forced surrender), so no runner is lost |
| **Prompts** | `Broken men run · {sonar} finds them` · `Get close and keep him in sight` |
| **Reuses** | `flight.ts`, sonar |
| **New** | Forced flee and forced reaction (6.3); a scripted mortar strike (reuse the Outpost's mortar or an airstrike with no player credit) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y5.intro` | Strike lands | deadpan | Three subjects have broken and are running. Broken men run away from you and out of sight. Your sonar does not respect either. |
| `tut.y5.caught` | First caught | deadpan | Cornered. Close enough and long enough in your sight, and he stops running and decides what he is. |
| `tut.y5.hint` | Hint | deadpan | Ping, then go where they are going, not where they were. |
| `tut.y5.done` | Three caught | deadpan | All three runners accounted for. Running has been noted as a waste of everyone's time. |

#### Y6 · Cornered

| | |
|---|---|
| **Teaches** | What a cornered man does, weighted by rank (`cornerWeights` in `flight.ts`): **surrender** (into the prisoner loop), **fight** (pistol out, a last-stand line, and he never breaks again), **cower** (begs, cannot be captured, runs again after 2.5 s unseen), **taunt** (only when badly wounded). **Fake** is Y7. **Self** (a pistol to his own temple: only a man at the end of his nerve, after two or more prisoners have been executed) happens only if the player has executed men, and is covered in Y8 |
| **Player does** | Four men break one after another from a squad in the sheds; the player corners each. Each has a forced reaction, in this order: cower, fight, taunt (pre-wounded), surrender |
| **Setup** | Four live regulars. The taunting one starts at 55% health with a leg wound |
| **Done when** | All four cornered and dealt with |
| **Fail / retry** | Shot by the fighter: shared death rule |
| **Prompts** | `Cornered men choose: surrender, fight, cower, taunt` · the cowering man: `He can't be captured while he begs` |
| **Reuses** | Cornered reactions and their chatter (`beg`, `lastStand`, `taunt`) |
| **New** | Forced reaction (as Y5) |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y6.intro` | Enters the sheds | deadpan | Cornered men do one of several things. You will now be shown each of them. They have not been shown the list. |
| `tut.y6.cower` | Cower | deadpan | This one is begging. A begging man cannot be cuffed. Look away and he will run again. Do not look away. |
| `tut.y6.fight` | Fight | deadpan | This one has chosen to fight. He will not break again. He has nothing left to break. |
| `tut.y6.taunt` | Taunt | deadpan | This one is wounded and has chosen to be rude about it. It changes nothing. It is merely noted. |
| `tut.y6.surrender` | Surrender | deadpan | And this one has chosen sense. Do with him what you have learned. |
| `tut.y6.done` | Done | deadpan | Cornering certified. Every subject in the Yard has now made a choice. Most of them have regretted it. |

#### Y7 · The Fake Surrender

| | |
|---|---|
| **Teaches** | The fake surrender and its **tell** (`flight.ts`): within 4.5 m and in his sight, he fumbles at his vest, there is a rustle of gear and a **red glint** at his chest. 0.9 s later he shouts, the pin goes, and he throws; 1 s after that, the grenade. **Counter:** shoot him on the glint, or get well clear. Fake surrenders also happen anywhere, now and then, from a kneeling man with a grenade |
| **Player does** | A man kneels in the open by the release gate (forced fake). The player approaches to question him. The tell plays. The player kills him in the 0.9 s, or backs out past the blast |
| **Setup** | One live regular, forced `fake`, one frag. A second try, if needed, puts the same man back |
| **Done when** | He is killed between the glint and the throw, or the grenade goes off with the player more than 7 m away |
| **Fail / retry** | Killed by the grenade: shared death rule, with `tut.y7.fail` before the redeploy line |
| **Prompts** | (none before the tell, on purpose) · after: `The red glint is a grenade. Shoot first.` |
| **Reuses** | The fake-out pose, rustle, glint, `fakeOut` lines, `dropGrenade` |
| **New** | Forced `fake` |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y7.intro` | He kneels | deadpan | Another one has surrendered. Please question him. |
| `tut.y7.done` | Killed on the tell | deadpan | You saw the glint. Not every subject who kneels has finished fighting. The ones with grenades in particular. |
| `tut.y7.clear` | Survived by distance | deadpan | You were clear of it. He was not. He has made his final statement. |
| `tut.y7.fail` | Killed by the grenade | deadpan | He was not surrendering. The Council knew this. The Council felt you would learn it better this way. |

#### Y8 · Executions, and what they cost (optional)

| | |
|---|---|
| **Teaches** | Killing a surrendered man: kneeling men take five times the damage and ignore plates. The **Geneva Suggestion** (always on) pays a bonus and a short, stacking damage and fire-rate boost for it. What it costs: men who see it are frightened, and a man at the end of his nerve after two or more executions may turn his pistol on himself. In the missions, the Commander takes note |
| **Player does** | Three men kneel in a row by the fence. The player does what they like with each: capture, release or execute. Every choice gets its own line. Nothing is required except that all three are dealt with |
| **Setup** | Three forced surrenders. If the player has executed two or more men in the Yard so far, the third man is given the `self` reaction when the player approaches (the existing rule, not forced) |
| **Done when** | All three captured, released or dead |
| **Fail / retry** | None |
| **Prompts** | `Your choice: capture, release, or not` |
| **Reuses** | Geneva Suggestion, execution count, `self` reaction; the existing Council line `executions` ("The Geneva Suggestion remains advisory.") |
| **New** | Nothing |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y8.intro` | Three kneel | deadpan | Three subjects. You have been shown capture and release. There is a third option. The Council does not recommend it. The Council does not forbid it. |
| (existing `executions`) | First execution | deadpan | The Geneva Suggestion remains advisory. |
| `tut.y8.bonus` | After it | deadpan | Your suite rewards that, briefly. Others who saw it will remember it for longer. |
| `tut.y8.self` | The `self` reaction | deadpan | He has made his own arrangements. This is recorded as a voluntary departure. Like yours would have been. |
| `tut.y8.mercy` | All three captured or released | deadpan | No executions. Your restraint has been noted. Restraint is not paid. Captures are. |
| `tut.y8.done` | Done | deadpan | The Yard is clear. You have now been trained in every way the Council has of dealing with people. There are not many. |

#### Y9 · Revive (co-op)

In the yard tunnel back to the Atrium.

| | |
|---|---|
| **Teaches** | Co-op revive. At 0 health in co-op a player is **down**: they can look and crawl at 1.3 m/s, but not shoot. A teammate **holds** `{interact}` within 2.4 m for 1.1 s (the hold ring) and they get up with 40 health. After 30 s down they are dead until the next wave |
| **Player does** | A downed contractor clone, **Contractor 4471**, crawls toward the player in the tunnel. The player holds `{interact}` on him until he is up |
| **Setup** | A clone in the downed pose and crawl (reuse the co-op downed animation on an ally-type body). He crawls toward the player at 1.3 m/s |
| **Done when** | Revive complete |
| **Fail / retry** | Let go early: the ring resets. He never dies in the drill |
| **Prompts** | `Hold {interact} (E) to revive · in co-op you crawl when down: 30 s to be helped` |
| **Reuses** | Revive and its hold ring (`src/net/team.ts`), the ally body |
| **New** | A single-player stand-in for a downed teammate |

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.y9.intro` | Sees the clone | deadpan | This is Contractor 4471. He is down. In co-operative work you will be expected to help. Hold, until he is up. |
| `tut.y9.coop` | Next | deadpan | If it is you on the floor, crawl to cover and wait. Your colleagues have thirty seconds to care. |
| `tut.y9.done` | Revived | deadpan | Contractor 4471 is up. He has been reassigned to the Live Range. In a standing capacity. |

### 3.9 The Proving Ground (G): call-ins, the Frame, and graduation

A wide outdoor apron with a mock village of six concrete shells (roofed, so the guns that go through roofs show it), a road for the
Warthog, a drone pen, the Frame pad, and a loudspeaker mast. Released subjects are let into the village in crowds for each drill. For
the sentry, the Council launches target drones (the Crucible's `drone` enemy).

Call-ins are normally earned by combo (Airstrike at 8, up to the Nuke at 50: `src/progression/data.ts`). Here the Council grants each
one in turn (`callins` step, plus a new grant-one step, 6.3). How every call-in works: **press its key to aim, click to confirm, right
click to cancel**; the ring on the floor is the true blast. Aircraft: **tap** takes the seat yourself; **hold** past 0.35 s sends it in
with its own crew on the guns.

| # | Call-in (key) | Drill | Done when |
|---|---|---|---|
| G1 | **Airstrike** (`{streak}`, X): 15 rockets and a finale | Aim it, **cancel with right click** once, aim again and confirm on a crowd in the square | One cancel; one strike kill |
| G2 | **Warthog** (`{callinWarthog}`, Z): a 50-shell strafe along a line; **drag to set the heading** | Line it up along the road, where subjects stand in a column | 5 kills in one strafe |
| G3 | **Door Gunner** (`{callinDoorGunner}`, J): a 20 mm rotary from a helicopter's door on an orbit; its rounds burst **and** go through roofs | **Tap** for the seat: kill men inside the roofed shells. Then **hold** to send it in with its crew while you fight on the ground | 6 kills from the seat; one crewed send |
| G4 | **Attack Chopper** (`{callinChopper}`, H): the gunner seat; it flies itself to the enemy; chin cannon and rockets until empty | Tap for the seat over the village | Munitions spent, or 8 kills |
| G5 | **AC-130** (`{callinAc130}`, M): circles the area; 25 mm, 40 mm and 105 mm, never harms the player | Tap for the seat; a kill with each of the three guns | Three gun kills |
| G6 | **AA Sentry** (`{callinSentry}`, I): a twin 20 mm dropped on a mark, a minute on station, shoots **only** drones and missiles | Drop it in the drone pen; the Council launches six target drones | Sentry kills 4 drones |
| G7 | **Orbital Lance** (`{callinOrbital}`, V): steer a burning beam for 6 s | Sweep the village square | 6 kills |
| G8 | **Distraint Frame** (`{callinFrame}`, K): the mech. `{interact}` climbs in for 45 s. Jump flies it up about 7 m, held hovers. Its 40 mm cannon (right arm) has three rounds, cycled with `{reload}`: **HE** (170 in 5 m, for the man on a roof), **AP** (through three walls, then 320, for men behind a wall), **FLAK** (bursts 2.5 m short and throws 14 pellets of 75, for a crowd in the open or something in the air). This is where **flak** is taught | Climb in. One kill with each round: a subject on a roof (HE), three behind a wall (AP), a crowd at 20 m and two drones (FLAK) | HE, AP and FLAK kills |
| G9 | **Black Sun** (`{callinBlackSun}`, B): a singularity that drags men and corpses in, then implodes | Into the square full of the dead and the living | 8 in one |
| G10 | **Tactical Nuke** (`{callinNuke}`, N): whites out the map | Graduation (below) | It goes off |

**Fail / retry:** a call-in used on nothing is granted again with the fail quip. **Prompts:** each row's key, plus
`{key} to aim · click to confirm · right click to cancel` and, for aircraft, `Tap: take the seat · Hold: send the crew`.
**Reuses:** every call-in (`src/progression/callins/`), the Frame (`src/frame/`), drones, crowds of released subjects.
**New:** a grant-one call-in step; the village; a drone launcher.

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.g.intro` | Enters | deadpan | The Proving Ground. In the field, call-ins are earned by killing quickly. Here they are issued, one at a time, by me. Do not get used to it. |
| `tut.g.how` | Next | deadpan | Press to aim. Click to confirm. The ring on the ground is the true size. Cancel if you change your mind. Changing your mind is not billed. |
| `tut.g1.cancel` | First cancel | deadpan | Cancelled. No charge. Now confirm one. |
| `tut.g1.done` | Airstrike kill | deadpan | Airstrike. Fifteen rockets. The sixteenth is the one you will remember. |
| `tut.g2.intro` | Warthog granted | deadpan | The next one strafes along a line. Drag to choose the line. The road is a good line. The subjects are on it. |
| `tut.g2.done` | Strafe kills | deadpan | Strafe complete. The road will need resurfacing. The subjects will not. |
| `tut.g3.intro` | Door Gunner granted | deadpan | An aircraft. Tap to sit behind the gun yourself. Hold to send it with its own crew. Its rounds go through roofs. The roofs were built for this. |
| `tut.g3.send` | Seat drill done | deadpan | Now hold, and send the crew while you work on the ground. They are also contractors. They are also you. |
| `tut.g4.intro` | Chopper granted | deadpan | The attack helicopter flies itself. You only shoot. It is the most relaxing thing you will do today. |
| `tut.g5.intro` | AC-130 granted | deadpan | The gunship. Three guns. Use all three. The largest one is for when you are certain. |
| `tut.g5.done` | Three gun kills | deadpan | Gunship certified. It has never hit the contractor. That is the only thing it has never hit. |
| `tut.g6.intro` | Sentry granted | deadpan | The sentry shoots only drones and missiles. It ignores people completely, which makes it the most tolerant thing on site. Drones are launching. |
| `tut.g6.done` | Four drones | deadpan | Air defence certified. The drones were training drones. They have been retired. |
| `tut.g7.intro` | Lance granted | deadpan | The orbital lance. A beam from above. Steer it. It lasts six seconds and leaves a great deal longer. |
| `tut.g8.intro` | Frame granted | deadpan | The Distraint Frame. Climb in. It has a cannon with three kinds of shell, and the reload key changes between them. Each target has been chosen for one. |
| `tut.g8.flak` | Before FLAK | deadpan | Flak bursts just short of what you aim at and fills the air with fragments. It is for crowds, and for things that fly. These are both. |
| `tut.g8.done` | Three rounds | deadpan | Frame certified. Please climb out. The Frame is not yours. Nothing here is. |
| `tut.g9.intro` | Black Sun granted | deadpan | The Black Sun. It pulls everything in, the living and the dead, and then it stops. Put it in the square. |
| `tut.g9.done` | Eight in one | deadpan | The square is clear. The Black Sun is not recommended near paperwork. |
| `tut.g.hint` | Hint | deadpan | The key on your screen is the one for this call-in. Press it, aim, click. |
| `tut.g.fail` | Wasted on nothing | deadpan | That landed on nobody. It has been reissued. The first one has been charged. |

#### G10 · Graduation

| | |
|---|---|
| **Teaches** | The last call-in, and that the run is over |
| **Player does** | The Council releases every subject still alive in the Annex into the village. The player is granted the Tactical Nuke and calls it on the village. The white-out is the transition: the player comes round in the Atrium |
| **Setup** | All remaining subjects (and captured ones are "returned", 20 or so) walk into the village, begging. The nuke granted |
| **Done when** | The nuke goes off. Then, in the Atrium, the **receipt**: the Council's itemised bill for the retraining (below) |
| **Fail / retry** | None |
| **Prompts** | `{callinNuke} (N): Tactical Nuke` · in the Atrium: `EXIT · RECOMMENDED` over the door |
| **Reuses** | The nuke; the Council receipt screen the Kill House already has (or the mission's completion notice) |
| **New** | The receipt's rows; the fade to the Atrium |

The receipt, itemised from the run (each row a real counter):

```
OFFICE OF SOCIETAL COMPLIANCE · FORM 7742-R · NOTICE OF RETRAINING
Contractor ............................................. (you)
Modules completed ...................................... 8 of 8
Flow course ............................................ 0:47 (commended)
Subjects processed ..................................... 214
Subjects captured, billed to other departments ......... 6
Subjects released, at the contractor's discretion ...... 2
Contractors issued ..................................... 3
Walkways removed ....................................... 1
Pins not returned ...................................... 4
Balance ................................................ see reverse
```

| Line | When | Emotion | Text |
|---|---|---|---|
| `tut.g10.intro` | Nuke granted | deadpan | Your retraining is nearly complete. The remaining subjects are no longer required. They have been gathered in the village for you. |
| `tut.g10.do` | Next | deadpan | You have been issued a tactical nuclear device. Please use it on the village. Please do not look directly at the village. |
| `tut.g10.after` | Comes round in the Atrium | deadpan | Retraining complete. Your receipt is attached. Please retain it. It will not be reissued. |
| `tut.g10.door` | Next | deadpan | The exit is the door you were shown when you arrived. It is still unlocked. It is now recommended. |
| `tut.g10.thanks` | Next | deadpan | The Council thanks you for your voluntary participation. A note has been made. It is a good note. Nobody will read it. |

---

## 4. Every mechanic, mapped

The exhaustive list, built from the code and the notes. **Covered** means a station requires it. **Shown** means a station shows it
without requiring it. **In progress** means its system was being built on 2026-11-17. **Not covered** is flagged with the reason.

### 4.1 Movement (`src/player/`)

| Mechanic | Station | Status |
|---|---|---|
| Run (12.5 m/s, no sprint key), acceleration, stopping | I0, M1 | Shown |
| Crouch, crouch-walk (5.5 m/s), stay crouched under a low roof | M1 | Covered |
| Jump (1.41 m), jump buffer (0.1 s), coyote time (0.1 s) | M1, M3 | Covered (buffer and coyote shown) |
| Landing stumble (up to 30% lost) | M3 | Shown (the LOST flash) |
| Slide (a press at 9 m/s+), slide boost and its cooldown | M2 | Covered |
| Slide-jump keeps speed | M2 | Covered |
| Slide downhill gains speed | M2 | Covered |
| Slide braking (press back), slide steering | M2 | Shown (prompt only) |
| Slide off a ledge re-queues; slide pressed in the air below 1.2 m fires on landing | M2 | Shown |
| Bunny hop (0.06 s landing grace) | M3 | Covered |
| Hold jump to hop (Settings) | I0, M3 | Shown |
| Air strafe (Quake and CPMA styles), soft cap 24, about 27 m/s at best | M3 | Covered |
| Momentum carry through ramps and landings | M3, M14 | Covered |
| Double jump, redirect toward keys, refills only on land, mantle, vault | M4 | Covered |
| Dash: ground, air, 2 charges, 1.4 s each, toward keys or view | M5 | Covered |
| Air dash stops a fall | M5 | Covered |
| Dash-jump (leave at 18 m/s) | M5 | Covered |
| Dash along a wall during a wall run | M7 | Covered |
| Dash cancels a big-slam stand-up | M11 | Shown |
| Dash is the focus zoom while aimed | W1 | Covered |
| Mantle (0.3 to 2.2 m, rails from 8 cm), mantle-top jump | M6 | Covered |
| Vault (0.5 to 1.35 m cover, 7 m/s+) | M6 | Covered |
| Auto-vault (`?vault=auto`, off by default) | — | Not covered: a URL switch, not a player feature |
| Wall run: straight | M7 | Covered |
| Wall run: inside corner carry | M7 | Covered |
| Wall run to wall run across a corridor | M7 | Covered |
| Wall-run camera roll | M7 | Shown |
| Wall kick (off a run, or a wall within 0.4 m), wall coyote 0.15 s | M8 | Covered |
| Kick zig-zag speed gain, once per wall until landing | M8 | Covered |
| Wall climb (three pulls, 2.4 m) and climb into mantle (about 5.5 m) | M9 | Covered |
| Cling, shooting while clinging | M9 | Covered |
| 180 wall jump | M9 | Covered |
| Chimney | M10 | Covered |
| No-climb surfaces | M (every bay) | Shown (the bays use them) |
| Ground slam (from 1.2 m up), shockwave and damage by height | M11 | Covered |
| Slam bounce | M11 | Covered |
| Slam into slide | M11 | Covered |
| Big slam (6 m+): knockdown, 0.5 s down | M11 | Covered |
| Rocket jump | M12 | Covered |
| Grenade jump | M12 | Covered |
| Barrel launch | M12 | Covered |
| Deuce both-barrel shove | M12 | Covered |
| Lance recoil shove, shell shove | W13 (Lance booth) | Shown |
| Launch ramp, jump pad | M12 | Covered |
| Thrown by a blast skips the air soft cap | M12 | Shown |
| Jump Jet (replaces double jump, 3 s tank, hover) | M13 | In progress |
| Heavy guns slow the player (Trommel 0.5x, Piledriver 0.72x, Judge fan 0.5x; no slide start while the Trommel fires) | W13 | Shown |
| Aimed walk at 0.45x | W1 | Covered |
| Moving platforms | — | Not covered: no moving platform in the Annex; few maps have them |
| Fall damage | — | Does not exist. M wing pits are padded for time only |
| Ledge hang, shimmy | — | Does not exist (left out in `docs/proposals/parkour-update.md`) |
| The flow of all of it | M14 | Covered |

### 4.2 Guns, rounds and armour (`src/weapons/`, `src/enemies/damage.ts`)

| Mechanic | Station | Status |
|---|---|---|
| Fire; bullets have no spread | W1 | Covered |
| ADS, toggle or hold | W1, I0 | Covered |
| Reload; auto reload on empty | W1 | Covered |
| Focus zoom (1.5x, 3.5 s breath, 2.5 s cooldown), early release refund, 12x cap | W1, W10 | Covered |
| SMG range fall-off vs the Harrow's full range | W1 | Shown (range card) |
| Weapon keys, families, the wheel | W2 | Covered |
| Last weapon (unbound by default) | W2 | Shown (prompt points to Settings) |
| Dry gun hands over | W2, K1 | Covered |
| Drop (U), take (E), walk-over pickup, last-gun rule | W2 | Covered |
| Shotgun spread and pellets; pump, Thresher, Deuce | W3 | Covered |
| Point-blank severs | W3 | Covered |
| Headshots and per-gun multipliers | W4 | Covered |
| Helmets (stop the first round, fly off) | W4 | Covered |
| Wound zones and style labels (12) | W5 | Covered (4 of 6 calls required; the rest shown) |
| Mortal wounds, bleeding out, downed men crawling and begging | W4, W5 | Shown |
| Corpses stay destructible | W3, W5 | Shown |
| HP rounds | W6 | Covered |
| AP rounds | W6 | Covered |
| Stopped-round cues (tink, whine, blue diamond) | W6 | Covered |
| +P rounds | W7 | Covered |
| Flechettes (shotguns) | W7 | In progress |
| API (Harrow) | W7 | In progress |
| Raufoss (Sabot mod; Piledriver hold-R belt) | W7 | Covered |
| Flak | G8 (the Frame's 40 mm) | Covered |
| Armour classes light, medium, heavy; Sabot deletes plates; rockets strip | W8 | Covered |
| Plates on the front only | W8 | Covered |
| Shotgun pellets on plate (first light, rest medium) | W8 | Shown (text) |
| Penetration budget and wallbangs | W9, C2 | Covered |
| Scopes, ACOG, red dot, Awl 8x | W1, W10 | Covered |
| Mod slots, one per slot, stacking | W6, P1 | Shown |
| Every gun's signature (Judge fan, Rivet triples, Harrow pierce, Gimlet selector and M203, Autoraffica smart aim, Ultramag laser and compensator, Thresher climb, Quiver paint, Sabot, Autocannon, Lance charge, Trommel bursts, Piledriver, Kiln fire panic, Stakegun pins and bolts) | W13 | Covered (optional room) |
| Flail LMG | W13 | In progress |
| Grenades: throw, cook, airburst, shoot one down, held too long | W11 | Covered |
| Shiv, Prybar, Spade, Cosh | — | **Not covered:** off by default (`?melee=four`). Add four booths to K if they ship on |

### 4.3 Melee (`src/weapons/melee/`)

| Mechanic | Station | Status |
|---|---|---|
| Quick melee from any gun | K1 | Covered |
| Light chain, hold to chain | K2 | Covered |
| Blade reach and front-only cutting; slice kills | K2 | Covered |
| Stab | K3 | Covered |
| Lock-dash stab | K3 | Covered |
| Guard (block) | K4 | Covered |
| Parry (3x back down the crosshair) | K4 | Covered |
| Dash-slash | K5 | Covered |
| Cleave, Tornado, Flying Slash, Flurry | K6 | Covered |
| Energy blade | K7 | In progress |

### 4.4 Brain chips, perks and implants

| Mechanic | Station | Status |
|---|---|---|
| Sonar, and its recharge rule | C1 | Covered |
| Sonar shows men playing dead | C1 | Covered |
| Sonar plus wallbang | C2 | Covered |
| Thermal | C3 | Covered |
| Focus chip (and not in co-op) | C4 | Covered |
| Two chip slots, hold to switch | C5 | Covered |
| Akimbo mods | P1, C6 | Covered |
| Gun Kata (hold T, needs akimbo, 22 m, 14 max) | C6 | Covered |
| Berserk's dual SMGs count as akimbo | S8 | Shown (if the player picks Berserk) |
| Combo (5 s rule) | S | Covered |
| Blood Thirst | S1 | Covered |
| SLOWMO | S2 | Covered |
| Adrenaline | S3 | Covered |
| Butcher | S4 | Covered |
| Chain Reaction | S5 | Covered |
| Skyfall, detonating slam | S6 | Covered |
| Overdrive | S7 | Covered |
| Hellfire, Berserk | S8 | Covered (one of the two, player's pick) |
| Chain Storm | S8 | Shown (sampler) |
| Implant slots (3), classes, 30 s rearm | S8, P1 | Covered |
| Geneva Suggestion | Y8 | Shown |
| Speed score tiers, FOV with speed | M3, M14 | Shown |

### 4.5 Prisoners and men (`src/enemies/outpost/`)

| Mechanic | Station | Status |
|---|---|---|
| Making men surrender (five signs, rank) | Y1 | Covered |
| Shot while kneeling: he runs, never again | Y1 | Shown |
| Question; truthful marks every squad for 9 s | Y2 | Covered |
| Lies (`SQUAD?`) | Y2 | Covered |
| Release; the +6% (to 24%) odds | Y3 | Covered |
| Capture (hold 0.4 s), cuffing, the skyhook drone, bounty by rank | Y4 | Covered |
| Unwatched prisoners rearm; 45 s and they walk | Y4 | Covered |
| Friends firing nearby: he goes for his gun | Y1 | Shown if it happens |
| Fleeing (cover to cover, away and out of sight), caught rules, 50 s | Y5 | Covered |
| Cornered: surrender, fight, cower, taunt | Y6 | Covered |
| Cornered: self | Y8 | Shown only if the player executed two or more |
| Fake surrender and its tell | Y7 | Covered |
| Kneeling men take x5 and ignore plates | Y8 | Shown |
| Executions and the Geneva bonus | Y8 | Shown |
| Morale, dread, fear spreading | Y1 to Y6 | Shown |
| Human shield | — | Does not exist (switched off: `HOSTAGES = false`) |
| The Commander's adaptations (jammers, decoys, mines, no more surrenders after executions) | — | **Not covered:** they belong to the Outpost mission and Endless Humans, where the Commander is |
| Enemy types (riot shields, rocketeer backpacks, bomber tanks, tanks immune until the launcher, the Juggernaut, the Titan) | — | **Not covered:** the missions teach their own enemies at the moment they arrive, as the Outpost does with the tank. Riot shields could join W8 later |
| Blood trails from wounded men | — | Not covered: not confirmed built. If it is, add a trail to Y5 |

### 4.6 Kit, shop and support

| Mechanic | Station | Status |
|---|---|---|
| Health regen, armour share | W12 | Covered |
| Stims | W12 | Covered |
| Supply pod, `E SHOP` | W6 | Covered |
| Buy and fit, refit free | W6 | Covered |
| Sell at half | P1 | Covered |
| Resupply rows | P1, W12 | Covered |
| Unlocks by wave (`Released after wave N`) | P1 | Shown (text; lifted in the tutorial) |
| Implants and chips pages | P1, S8, C | Covered |
| Every call-in, targeting, cancel, tap vs hold | G1 to G10 | Covered |
| Earning call-ins by combo | G | Shown (text) |
| Distraint Frame (climb in, jets, 40 mm rounds) | G8 | Covered |
| Co-op revive, being downed | Y9 | Covered |
| Weapon caches (the non-shop modes' drop pods) | — | Not covered: mode-specific; the feed explains them in play |
| Timed capsules (Quad, Haste, Vampire…), Mega Health | — | **Not covered:** Crucible map items. A capsule could be added to the Pen later |
| Ally orders (hold E on an ally, Outpost Defense) | — | **Not covered:** only in Outpost Defense, which teaches its allies |
| Next wave now (L), wave breaks, run stats (Tab) | — | Not covered: wave-mode UI, explained by the HUD in those modes |
| Gore setting, sensitivity, aim mode, hold to hop | I0 | Shown |

---

## 5. Voice-over script

Every **new** line in this page, in the order it is heard. Speaker for all of them: **council**, the `shodan` voice, tag
`[deadpan]`, model `eleven_v3`, as every Council line now (`tools/scripts/voice-script.ts`, `tools/scripts/voice-generate.mjs`).
Code ids are `mission.council.` plus the id below; files land in `public/audio/voice/<id>.mp3` and `manifest.json`. Lines
reused from the missions (`mission.council.cool.dash`, `mission.council.gal.walls`, the `executions` line) are already recorded
and not in this table. Subjects use the existing garrison chatter clips and need nothing new.

**361 lines, 34,572 characters.**

**Generating them needs the owner's approval and ElevenLabs credits.** Nothing is generated until the owner has read the script
(stage A) and said go. On a credit-per-character plan that is about 34,572 credits for one pass; with retakes on about a third
of the lines, budget about 48,000. Until then every line plays as a subtitle in the radio box, which the
runner already does for unrecorded lines, so the tutorial can be built and played before any audio exists.

Direction for the whole set: flat, unhurried, faintly bored, never sarcastic in the voice. The jokes are in the words. Pauses on
the full stops. "Contractor" is said like a form field.

| # | Id | Speaker | Emotion | Text | Chars |
|---|---|---|---|---|---|
| 1 | `tut.redeploy.1` | council | deadpan | Replacement contractor issued. The previous one did not complete this module. You will. | 87 |
| 2 | `tut.redeploy.2` | council | deadpan | Another replacement. Retraining is billed per contractor. Please pace yourself. | 79 |
| 3 | `tut.redeploy.3` | council | deadpan | Contractor issued. That is three this session. Clones are not free. They are merely cheap. | 90 |
| 4 | `tut.redeploy.4` | council | deadpan | You again. The module has been reset. So have you. | 50 |
| 5 | `tut.common.waive` | council | deadpan | The Council has waived this module. Waivers are noted. Please proceed. | 70 |
| 6 | `tut.common.waste` | council | deadpan | That subject was allocated to a later module. He has been replaced. The replacement has been billed to you. | 107 |
| 7 | `tut.common.subjects` | council | deadpan | The subjects are not permitted to speak to you. They do anyway. Please do not reply. | 84 |
| 8 | `tut.common.back` | council | deadpan | This module is complete. You may repeat it. Repetition is not billed. It is noted. | 82 |
| 9 | `tut.i0.line` | council | deadpan | Contractor. Good morning. This is the Office of Societal Compliance. You are on a recorded line. | 96 |
| 10 | `tut.i0.welcome` | council | deadpan | Welcome to your voluntary retraining. | 37 |
| 11 | `tut.i0.selected` | council | deadpan | You have been selected. The reasons are on file. The file is not available to you. | 82 |
| 12 | `tut.i0.policy` | council | deadpan | Under a new Compliance policy, I am obliged to inform you that your attendance is voluntary, and that you are free to leave at any time. | 136 |
| 13 | `tut.i0.door` | council | deadpan | The exit is the door behind you. It is unlocked. It has been unlocked since you were issued. | 92 |
| 14 | `tut.i0.encourage` | council | deadpan | You are, however, highly encouraged to complete your retraining. Contractors who complete it are valued. The others are also valued. Differently. | 145 |
| 15 | `tut.i0.note` | council | deadpan | There is no penalty for leaving. A note will be made. A note is not a penalty. Please do not confuse the two. | 109 |
| 16 | `tut.i0.subjects` | council | deadpan | Today's exercises use live subjects. They have been processed for your convenience. You may hear them. That is normal. | 118 |
| 17 | `tut.i0.settings` | council | deadpan | The booth on your left adjusts your sensitivity and your aim. The Council recommends you set them now and complain later. | 121 |
| 18 | `tut.i0.go` | council | deadpan | When you are ready, walk forward. Or back. Forward is preferred. | 64 |
| 19 | `tut.i0.hint` | council | deadpan | The Atrium is ahead of you. The door behind you is also still there. Both facts remain true. | 92 |
| 20 | `tut.i0.done` | council | deadpan | You have chosen to stay. This has been recorded as enthusiasm. | 62 |
| 21 | `tut.i0.turn` | council | deadpan | That is the exit. It works. I am required to say that it works. | 63 |
| 22 | `tut.exit.now` | council | deadpan | Contractor has declined retraining in under a minute. This has been noted as decisive. Have a productive day. | 109 |
| 23 | `tut.exit.early` | council | deadpan | Retraining incomplete. Your file will say so, in a small font. Nobody reads the small font. I read the small font. | 114 |
| 24 | `tut.exit.half` | council | deadpan | You were nearly useful. The remaining modules will be held for you. They do not expire. Neither do notes. | 105 |
| 25 | `tut.exit.late` | council | deadpan | You have left before the part with the explosions. This is unusual. It has been flagged as unusual. | 99 |
| 26 | `tut.exit.kiosk` | council | deadpan | You declared yourself competent and then left. Both statements are on file. They do not agree. | 94 |
| 27 | `tut.exit.done` | council | deadpan | Retraining complete. You may now leave through the door you were always free to leave through. | 94 |
| 28 | `tut.hub.first` | council | deadpan | This is the Atrium. Each wing is one module. Doors open in order. The lit door is next. | 87 |
| 29 | `tut.hub.open` | council | deadpan | Module complete. The next door is open. The previous door is also open. Doors are not the problem here. | 103 |
| 30 | `tut.hub.kiosk` | council | deadpan | Self-assessment. You may declare yourself competent. Sign again to confirm. The declaration is binding on you, and not on us. | 125 |
| 31 | `tut.hub.signed` | council | deadpan | Signed. All modules are open. Your confidence has been noted, alongside everything else. | 88 |
| 32 | `tut.m1.intro` | council | deadpan | Bay M-1. Basic locomotion. You can already walk. This is to confirm it for the record. | 86 |
| 33 | `tut.m1.do` | council | deadpan | Crouch, and go through the duct. Then jump the crates. The crates are rated for you. You are rated for the crates. | 114 |
| 34 | `tut.m1.hint` | council | deadpan | Crouch to fit the duct. Jump to clear the crates. The words on your screen say the same as I do, but quieter. | 109 |
| 35 | `tut.m1.done` | council | deadpan | Locomotion confirmed. Your legs have been signed off. | 53 |
| 36 | `tut.m1.fail` | council | deadpan | That was a crate. Crates do not move. You are expected to. | 58 |
| 37 | `tut.m2.intro` | council | deadpan | Bay M-2. The shutter ahead closes when you step on the pad. Crouching will not get you under it in time. Sliding will. | 118 |
| 38 | `tut.m2.do` | council | deadpan | Run, and crouch while running, to slide. Do it before the shutter, not at it. | 77 |
| 39 | `tut.m2.jump` | council | deadpan | Jump out of a slide and you keep the speed. The gap ahead is billed as jumpable. | 80 |
| 40 | `tut.m2.ramp` | council | deadpan | The ramp goes downhill. Slide down it. Gravity is free. It is one of very few things that are. | 94 |
| 41 | `tut.m2.hint` | council | deadpan | Press crouch once while running at full speed. Holding it does nothing. Pressing it does everything. | 100 |
| 42 | `tut.m2.done` | council | deadpan | Slide certified. Your trousers are not covered. | 47 |
| 43 | `tut.m2.fail` | council | deadpan | The shutter has won. The shutter is not being retrained. You are. | 65 |
| 44 | `tut.m3.intro` | council | deadpan | Bay M-3. The hop line. You keep your speed if you jump again the instant you land. Late jumps are taxed. | 104 |
| 45 | `tut.m3.do` | council | deadpan | Hold forward and a side, and turn into the turn. The meter shows what you keep and what you lose. Cross the gate at eighteen. | 125 |
| 46 | `tut.m3.hold` | council | deadpan | If your hands tire, the settings include holding jump to hop. It is permitted. It is not admired. | 97 |
| 47 | `tut.m3.hint` | council | deadpan | Jump the moment your feet touch. Strafe and turn the same way. Do not hold back. Back is a brake. | 97 |
| 48 | `tut.m3.done` | council | deadpan | Eighteen metres a second. The Council has no use for this number, but it has been kept. | 87 |
| 49 | `tut.m3.commend` | council | deadpan | Twenty-four. That is faster than the Council's lawyers recommend. | 65 |
| 50 | `tut.m3.fail` | council | deadpan | You landed and stayed landed. The floor charges for that. | 57 |
| 51 | `tut.m4.intro` | council | deadpan | Bay M-4. You have a second jump, in the air. It is included in your suite. It is not refunded if unused. | 104 |
| 52 | `tut.m4.do` | council | deadpan | Jump, then jump again near the top. The second jump goes where your keys point, not where you were going. | 105 |
| 53 | `tut.m4.turn` | council | deadpan | The next platform is to the side. Jump forward, then turn with the second jump. | 79 |
| 54 | `tut.m4.hint` | council | deadpan | Press jump a second time in the air, and hold the direction you want as you press it. | 85 |
| 55 | `tut.m4.done` | council | deadpan | Double jump confirmed. Twice the jumping, at no extra cost. Today. | 66 |
| 56 | `tut.m4.fail` | council | deadpan | One jump. You have two. The other one is also yours. | 52 |
| 57 | `tut.m5.intro` | council | deadpan | Bay M-5. Four gaps. Seven metres, fourteen, nineteen and twenty-three. Each is a little more than you, until you dash. | 118 |
| 58 | `tut.m5.do` | council | deadpan | Dash goes where your keys point, on the ground or in the air. In the air, it stops your fall. You have two. They recharge. | 122 |
| 59 | `tut.m5.long` | council | deadpan | For the long gaps: run, jump, jump again, then dash, then dash. In that order. | 78 |
| 60 | `tut.m5.flat` | council | deadpan | This ledge is level with you. Jump off and dash, and you will fly flat instead of falling. | 90 |
| 61 | `tut.m5.dashjump` | council | deadpan | Jump during a dash and you leave it faster. This is called a dash-jump. It is called that by us. | 96 |
| 62 | `tut.m5.hint` | council | deadpan | Use the dashes in the air, after the second jump, not before it. | 64 |
| 63 | `tut.m5.done` | council | deadpan | Twenty-three metres. Your lateral burst has been fully utilised. Your invoice reflects this. | 92 |
| 64 | `tut.m5.fail` | council | deadpan | The gap was twenty-three metres. You were somewhat less. | 56 |
| 65 | `tut.m6.intro` | council | deadpan | Bay M-6. Ledges and cover. A ledge you can reach, you can climb onto. Jump at it and keep pushing forward. | 106 |
| 66 | `tut.m6.vault` | council | deadpan | Waist-high cover is not a wall. Run at it and jump, and you go over on one hand, at the speed you arrived with. Three in a row. | 127 |
| 67 | `tut.m6.hint` | council | deadpan | For a ledge, jump and keep holding forward. For cover, be running, and jump close to it. | 88 |
| 68 | `tut.m6.done` | council | deadpan | Mantle and vault certified. Cover is now a suggestion. Please do not tell the subjects. | 87 |
| 69 | `tut.m6.fail` | council | deadpan | You stopped at the cover. The cover did not stop. It was never moving. | 70 |
| 70 | `tut.m7.intro` | council | deadpan | Bay M-7. There was a walkway here. It has been removed for the purposes of this exercise. It has also been removed from the budget. | 131 |
| 71 | `tut.m7.do` | council | deadpan | Run at the wall at a shallow angle, jump, and keep holding forward. You will stay up for about a second. Jump off before you start to drop. | 139 |
| 72 | `tut.m7.corner` | council | deadpan | Walls that turn inward carry you round the corner. Walls that turn outward do not. Learn which is which before the pit does. | 124 |
| 73 | `tut.m7.zip` | council | deadpan | To cross to the other wall, look at it, then jump. You will land running on it. Look first. Jumping first is how the pit gets fed. | 130 |
| 74 | `tut.m7.dash` | council | deadpan | Dash into the wall while running on it and the dash goes along the wall. The last stretch requires this. | 104 |
| 75 | `tut.m7.hint` | council | deadpan | Be at full speed, hold forward, and steer slightly into the wall. Not hard into it. Slightly. | 93 |
| 76 | `tut.m7.done` | council | deadpan | All four walls crossed. The walkway will not be reinstated. It no longer needs to be. | 85 |
| 77 | `tut.m7.fail` | council | deadpan | The pit is padded. The padding is billed per use. | 49 |
| 78 | `tut.m8.intro` | council | deadpan | Bay M-8. The kick corridor. Jump off a wall while you are in the air and you leave it faster than you arrived. | 110 |
| 79 | `tut.m8.do` | council | deadpan | Jump into a wall, and jump again as you touch it. Then the other wall. Each panel can be used once before you land. | 115 |
| 80 | `tut.m8.hint` | council | deadpan | Zig-zag. Touch, jump, cross, touch, jump. The panels are offset. Use every one. | 79 |
| 81 | `tut.m8.done` | council | deadpan | Nineteen metres a second, gained from walls. Walls have been very generous with you. Do not expect the same from people. | 120 |
| 82 | `tut.m8.fail` | council | deadpan | You touched the wall and stayed. The wall has no further use for you. | 69 |
| 83 | `tut.m9.intro` | council | deadpan | Bay M-9. Vertical surfaces. Run at the wall, jump, and look straight at it. You will climb about two and a half metres. That is your allowance. | 143 |
| 84 | `tut.m9.cling` | council | deadpan | Keep holding forward at the top of a climb and you will hang there, sliding slowly. Your weapon is available while you hang. Use it on the plates. | 146 |
| 85 | `tut.m9.turn` | council | deadpan | Jump while hanging and you kick off the wall and turn round in the air. The platform behind you is the only way out. | 116 |
| 86 | `tut.m9.hint` | council | deadpan | Look straight at the wall as you jump, and keep holding forward. To turn round, jump while you are on the wall. | 111 |
| 87 | `tut.m9.done` | council | deadpan | Climb, cling, turn. Three skills, one wall. The wall has been thanked. | 70 |
| 88 | `tut.m9.fail` | council | deadpan | You approached the wall from the side. It only responds to direct eye contact. | 78 |
| 89 | `tut.m10.intro` | council | deadpan | Bay M-10. The chimney. Two walls, close together, twenty metres up. There are no stairs. There were never going to be stairs. | 125 |
| 90 | `tut.m10.do` | council | deadpan | Climb one wall, turn off it onto the other, and climb that one. Repeat until you run out of chimney. | 100 |
| 91 | `tut.m10.hint` | council | deadpan | Climb, then jump while on the wall. You will face the other wall. Climb it. Do not stop between. | 96 |
| 92 | `tut.m10.done` | council | deadpan | Top of the chimney. The view is not included. | 45 |
| 93 | `tut.m10.fail` | council | deadpan | You stopped climbing. Gravity did not. | 38 |
| 94 | `tut.m11.intro` | council | deadpan | Bay M-11. Downward travel. Crouch in the air and you drive into the ground. The higher you start, the more the ground notices. | 126 |
| 95 | `tut.m11.bounce` | council | deadpan | Jump the instant a slam lands and you bounce off it. The ledge ahead is reached that way. | 89 |
| 96 | `tut.m11.slide` | council | deadpan | Keep crouch held through the landing, and the slam becomes a slide. Under the shutter, please. | 94 |
| 97 | `tut.m11.big` | council | deadpan | The tall tower. From six metres or more, a slam knocks down everyone near it. And you, briefly. The subjects below have been arranged for this. | 143 |
| 98 | `tut.m11.up` | council | deadpan | You will be on the floor for half a second after a big slam. A dash gets you up sooner. | 87 |
| 99 | `tut.m11.hint` | council | deadpan | In the air, press crouch. For the bounce, press jump as you hit the floor, not after. | 85 |
| 100 | `tut.m11.done` | council | deadpan | Ground slam certified. The subjects who are still conscious have been noted as resilient. | 89 |
| 101 | `tut.m11.fail` | council | deadpan | You slammed from too low. That was a landing. Landings are free. | 64 |
| 102 | `tut.m12.intro` | council | deadpan | Bay M-12. Assisted elevation. An explosion near your feet will throw you. Everywhere else this is a hazard. Here it is a lesson. | 128 |
| 103 | `tut.m12.rocket` | council | deadpan | Rocket launcher. Look at your feet, jump, and fire. Your suit absorbs most of it. Most. | 87 |
| 104 | `tut.m12.grenade` | council | deadpan | Grenade. Throw it at your feet and be standing on it when it goes. It will hurt. You have been given armour, a stim and an apology. The apology is not redeemable. | 162 |
| 105 | `tut.m12.barrel` | council | deadpan | The red object is a barrel. Shoot it while standing next to it. Barrels are not covered. | 88 |
| 106 | `tut.m12.deuce` | council | deadpan | The Deuce kicks you backwards when both barrels fire. In the air, aim at the floor and fire both. Down is the wrong way to aim and the right way to go up. | 154 |
| 107 | `tut.m12.ramp` | council | deadpan | The ramp and the pad are free. They are the only free things in this bay. | 73 |
| 108 | `tut.m12.hint` | council | deadpan | Fire as you jump, not after. Be on the blast, not near it. | 58 |
| 109 | `tut.m12.done` | council | deadpan | Five ways up. Each has been logged as an incident. Incidents are how we keep count. | 83 |
| 110 | `tut.m12.fail` | council | deadpan | That was a blast without a launch. You were hurt for nothing, which is the expensive way. | 89 |
| 111 | `tut.m13.intro` | council | deadpan | Bay M-13. Your suite has been fitted with a Jump Jet, on trial. Trials are free until they are not. | 99 |
| 112 | `tut.m13.do` | council | deadpan | It replaces your second jump. Jump, then jump again in the air, or hold jump, and it burns. The tank is small. It refills. | 122 |
| 113 | `tut.m13.hover` | council | deadpan | At the top of its climb the jet holds you in place. The plates are hung in the air. So, for a moment, are you. | 110 |
| 114 | `tut.m13.chain` | council | deadpan | Now from a wall run into the jet. The far side is further than you. That is the point of the jet. | 97 |
| 115 | `tut.m13.hint` | council | deadpan | The gantry is above you. The jet goes up. These two facts are related. | 70 |
| 116 | `tut.m13.done` | council | deadpan | Trial complete. The Jump Jet has been removed. It can be fitted at Procurement, for a fee. Your second jump has been returned, at no charge. | 140 |
| 117 | `tut.m13.fail` | council | deadpan | The jet went up, and so did you, briefly. | 41 |
| 118 | `tut.m14.intro` | council | deadpan | Bay M-14. The flow course. Everything you have just done, in one line, against the clock. The clock is also being retrained. It is doing well. | 142 |
| 119 | `tut.m14.start` | council | deadpan | Begin when ready. The timer starts when you cross the line. It does not care whether you are ready. | 99 |
| 120 | `tut.m14.hint` | council | deadpan | Do not stop. Every stop costs the speed you built. The speed is the course. | 75 |
| 121 | `tut.m14.done` | council | deadpan | Course complete. Your time has been compared with other contractors. You are all the same contractor, so the comparison was brief. | 130 |
| 122 | `tut.m14.commend` | council | deadpan | Under par. The Council commends you. A commendation has no cash value. | 70 |
| 123 | `tut.m14.fail` | council | deadpan | Over time. The course is still there. So, apparently, are you. | 62 |
| 124 | `tut.w1.intro` | council | deadpan | The Gallery. Lane one. Your rounds have no spread. They go exactly where you point them. This removes a great many excuses. | 123 |
| 125 | `tut.w1.aim` | council | deadpan | Aiming gives magnification and a steadier gun. It does not make you more accurate. You were already accurate. Now you can see it. | 129 |
| 126 | `tut.w1.reload` | council | deadpan | Reload by hand when it suits you. Empty the magazine and the reload happens anyway, at a time that suits nobody. | 112 |
| 127 | `tut.w1.focus` | council | deadpan | While aiming, hold your dash to focus. You get one held breath. Use it on the far plate. Breath is not rationed. Yet. | 117 |
| 128 | `tut.w1.hint` | council | deadpan | Aim first, then hold dash. Release before the breath runs out and you get it back sooner. | 89 |
| 129 | `tut.w1.done` | council | deadpan | Lane one complete. Every round you fired has been invoiced. The ones that hit have been invoiced at the same rate. | 114 |
| 130 | `tut.w1.fail` | council | deadpan | The plate is sixty metres away. It has not moved. It is waiting for you to be good. | 83 |
| 131 | `tut.w2.intro` | council | deadpan | Lane two. Weapon handling. Each number holds one or more weapons. Press the same number again for the next one. | 111 |
| 132 | `tut.w2.dry` | council | deadpan | Fire the Gimlet until it is empty. Your hands will reach for the next gun without being asked. That is the only initiative your contract permits. | 145 |
| 133 | `tut.w2.drop` | council | deadpan | You may drop a weapon. Drop the SMG, and take the revolver on the floor. Its previous owner will not be needing it. He is you, approximately. | 141 |
| 134 | `tut.w2.last` | council | deadpan | Now try to drop everything. | 27 |
| 135 | `tut.w2.refused` | council | deadpan | You may not drop your last weapon. The Council does not issue unarmed contractors. It has tried. | 96 |
| 136 | `tut.w2.hint` | council | deadpan | The same number twice steps through that key's weapons. The drop key throws the one in your hands. | 98 |
| 137 | `tut.w2.done` | council | deadpan | Handling certified. Dropped weapons stay where they fall, which is more than can be said for contractors. | 105 |
| 138 | `tut.w3.intro` | council | deadpan | Lane three. Shotguns. Unlike your other weapons, these spread. The board will show you how much. | 96 |
| 139 | `tut.w3.close` | council | deadpan | At close range the pattern is narrow and the effect is not. Subject 0623 has volunteered to demonstrate. He was not asked. | 122 |
| 140 | `tut.w3.hint` | council | deadpan | Closer. Closer than that. | 25 |
| 141 | `tut.w3.done` | council | deadpan | Limb removed. Subject 0623 has contributed to your education. His contribution has been recorded under his number. | 114 |
| 142 | `tut.w4.intro` | council | deadpan | Lane four. Live subjects. They are held in place and cannot harm you. They will ask you not to. That request has been declined on their behalf. | 143 |
| 143 | `tut.w4.heads` | council | deadpan | The head pays more than the body, for every weapon. The pistol pays three times. Please consider the pistol. | 108 |
| 144 | `tut.w4.helmet` | council | deadpan | That was a helmet. Helmets stop the first round. Remove the helmet, and then the head will be available. | 104 |
| 145 | `tut.w4.walkers` | council | deadpan | Two subjects have been given permission to walk. It is not permission to leave. | 79 |
| 146 | `tut.w4.hint` | council | deadpan | They are standing still. You are not obliged to. | 48 |
| 147 | `tut.w4.done` | council | deadpan | Lane four clear. The subjects' families have not been notified. The subjects did not provide that information, and nobody asked. | 128 |
| 148 | `tut.w5.intro` | council | deadpan | Lane five. Anatomy. Where you hit a subject decides what the subject does next. I will name a place. You will put a round in it. | 128 |
| 149 | `tut.w5.hand` | council | deadpan | Subject 2281. The hand holding the pistol. The pistol is not loaded. He does not know that. | 91 |
| 150 | `tut.w5.knee` | council | deadpan | The knee. He will not run. He was not going to run. Now it is official. | 71 |
| 151 | `tut.w5.gut` | council | deadpan | The stomach. This one is slow. The Council does not recommend it. The Council does not forbid it. | 97 |
| 152 | `tut.w5.neck` | council | deadpan | The neck. He will be gone in about three seconds and will not be able to tell you so. | 85 |
| 153 | `tut.w5.spine` | council | deadpan | He has been turned round for you. The spine. From behind, his legs stop. | 72 |
| 154 | `tut.w5.heart` | council | deadpan | The heart. This one is quick. It is the only one that is. | 57 |
| 155 | `tut.w5.miss` | council | deadpan | That was not the place named. It was a place, and it has been recorded. Next subject. | 85 |
| 156 | `tut.w5.hint` | council | deadpan | Aim, and focus if you need to. The labels on your screen confirm what you hit. | 78 |
| 157 | `tut.w5.done` | council | deadpan | Anatomy certified. The chart on the wall is yours to keep. It is not yours to take. | 83 |
| 158 | `tut.w6.intro` | council | deadpan | Lane six. Ammunition. Your SMG has been loaded with hollow points. Shoot the subject on the left and observe the effect. | 120 |
| 159 | `tut.w6.effect` | council | deadpan | Hollow points open inside the body. They are very effective on a man in a shirt. | 80 |
| 160 | `tut.w6.armour` | council | deadpan | This subject is wearing a plate. Shoot him anyway. For the record. | 66 |
| 161 | `tut.w6.bounce` | council | deadpan | Hollow points do nothing to a plate. You may have noticed. He certainly has. | 76 |
| 162 | `tut.w6.pod` | council | deadpan | A supply pod has been delivered. Walk to it and open the shop. Buy armour-piercing rounds for the SMG and fit them. | 115 |
| 163 | `tut.w6.fitted` | council | deadpan | Fitted. Armour-piercing rounds go through the plate. They are slightly worse on a shirt. Nothing is free, including that. | 121 |
| 164 | `tut.w6.done` | council | deadpan | The subject is deceased. The plate is intact. The plate has been returned to stores. | 84 |
| 165 | `tut.w6.refit` | council | deadpan | Mods you own can be swapped at any pod, at no charge. Put the hollow points back. You will be needing both. | 107 |
| 166 | `tut.w6.alt` | council | deadpan | You removed the helmet and used the head. This was not the lesson, but it was a lesson. It has been accepted. | 109 |
| 167 | `tut.w6.hint` | council | deadpan | The plate stops hollow points. The pod sells rounds that do not stop. | 69 |
| 168 | `tut.w6.fail` | council | deadpan | You have now shot the plate twenty times. The plate is thriving. | 64 |
| 169 | `tut.w7.intro` | council | deadpan | Lane seven. Specialist ammunition. Each subject is standing behind the thing his round was designed to defeat. The rounds are at the pod. | 137 |
| 170 | `tut.w7.plusp` | council | deadpan | Plus-P. More powder, more damage, more wear on the gun. The wear is billed separately. | 86 |
| 171 | `tut.w7.flechette` | council | deadpan | Flechettes. A great many small darts instead of a few pellets. Most of them pass the plate. Each one keeps working after you have moved on. | 139 |
| 172 | `tut.w7.api` | council | deadpan | Incendiary. Now and then it sets the subject alight. The Council calls this initiative. | 87 |
| 173 | `tut.w7.raufoss` | council | deadpan | Raufoss. It bursts inside the first subject and continues into the second. Cover has been reclassified as a suggestion. | 119 |
| 174 | `tut.w7.piledriver` | council | deadpan | The heavy gun carries both belts. Hold reload to change them. Do not hold it in a hurry. | 88 |
| 175 | `tut.w7.hint` | council | deadpan | Each card says which round to fit. Fit it at the pod, then shoot the subject on that card. | 90 |
| 176 | `tut.w7.done` | council | deadpan | Ammunition certified. You now know more about rounds than the subjects did. They have stopped asking questions. | 111 |
| 177 | `tut.w8.intro` | council | deadpan | Lane eight. Plates. A plate stops small rounds and is worn down by them. A heavier round breaks it. The revolver is heavier. | 124 |
| 178 | `tut.w8.back` | council | deadpan | The plate is on the front of the subject. The back of the subject is not plated. The turntable will show you the back. | 118 |
| 179 | `tut.w8.rocket` | council | deadpan | Or remove all of it at once. A direct hit with a rocket strips every plate he has. Usually with the subject. | 108 |
| 180 | `tut.w8.hint` | council | deadpan | Hit the plate with the revolver. Then wait for his back. | 56 |
| 181 | `tut.w8.done` | council | deadpan | Plate school complete. The plates have been recycled. The subjects have also been recycled. | 91 |
| 182 | `tut.w9.intro` | council | deadpan | Lane nine. Walls. Some of your rounds go through them. Each subject is standing behind a wall of a different thickness. Each wall is labelled. The subjects are not. | 164 |
| 183 | `tut.w9.hint` | council | deadpan | The thicker the wall, the heavier the gun. The label says which. | 64 |
| 184 | `tut.w9.done` | council | deadpan | Three walls, three subjects. The walls will be repaired. That is the difference between them. | 93 |
| 185 | `tut.w10.intro` | council | deadpan | Lane ten. Range. The rifle on the rack has an eight-power scope. Focus while scoped and it goes further, to a limit. The limit is not negotiable. | 145 |
| 186 | `tut.w10.far` | council | deadpan | The last subject is a hundred and fifty metres away. He believes that is far. Correct him. | 90 |
| 187 | `tut.w10.hint` | council | deadpan | Scope, then hold your breath with the dash key. The head is the small part on top. | 82 |
| 188 | `tut.w10.done` | council | deadpan | Long-range certified. Distance has been removed from your list of reasons. | 74 |
| 189 | `tut.w11.intro` | council | deadpan | The grenade court. Hold to pull the pin, release to throw. The longer you hold, the less time they have. | 104 |
| 190 | `tut.w11.cook` | council | deadpan | The second trench has a lip. Hold the grenade until it would burst over them, not beside them. | 94 |
| 191 | `tut.w11.shoot` | council | deadpan | The Council will now throw one at you. Shoot it before it lands. This is a test. The grenade is not. | 100 |
| 192 | `tut.w11.hint` | council | deadpan | Listen to the beeps. Three, and let go. | 39 |
| 193 | `tut.w11.done` | council | deadpan | Grenades certified. Please return any pins. The pins are inventoried. | 69 |
| 194 | `tut.w11.fail` | council | deadpan | You held the grenade until it went off. You were thorough. | 58 |
| 195 | `tut.w12.intro` | council | deadpan | The Infirmary. The floor has been switched on. It administers a corrective charge. It will not kill you. It has been told. | 122 |
| 196 | `tut.w12.regen` | council | deadpan | Step off. Your health returns on its own if you stop being hurt for a few seconds. Most problems do not work like this. | 119 |
| 197 | `tut.w12.stim` | council | deadpan | Step back on and use a stim. You cannot shoot while injecting. You can hardly walk. Choose your moment better than this. | 120 |
| 198 | `tut.w12.plate` | council | deadpan | The pod sells armour plate. It takes most of every hit. Buy one and walk the floor again. | 89 |
| 199 | `tut.w12.hint` | council | deadpan | Off the floor to heal. On the floor to practise. The stim is on its own key. | 76 |
| 200 | `tut.w12.done` | council | deadpan | Medical certified. The floor has been switched off. It will be switched on again for the next contractor, who is also you. | 122 |
| 201 | `tut.w13.intro` | council | deadpan | The Armoury. Each weapon does one thing that the others do not. The cards explain. This room is optional. Optional rooms are where the Council keeps its favourite things. | 170 |
| 202 | `tut.w13.done` | council | deadpan | Every booth complete. You have now fired every weapon the Council issues. The Council has now billed every weapon the Council issues. | 133 |
| 203 | `tut.p1.intro` | council | deadpan | Procurement. Everything is for sale, including things you already own. Sell the Gimlet. The Council buys back at half price, which is more than it offers for you. | 162 |
| 204 | `tut.p1.resupply` | council | deadpan | The first rows refill your ammunition, your health and your armour. They can be bought as often as you can afford them. | 119 |
| 205 | `tut.p1.akimbo` | council | deadpan | Buy the second pistol. It will be needed later. You will be holding one in each hand. The Council has insured neither. | 118 |
| 206 | `tut.p1.implants` | council | deadpan | The next page sells implants. You have three slots. You are not ready for them. Look, but do not touch. | 103 |
| 207 | `tut.p1.done` | council | deadpan | Procurement complete. Please retain your receipts. You will not be given any. | 77 |
| 208 | `tut.k1.intro` | council | deadpan | The Cutting Room. Your ammunition has been withdrawn. This happens in the field without notice. Here, you have been given notice. | 129 |
| 209 | `tut.k1.blade` | council | deadpan | Contractor, when you run out of ammunition, here is your standard issue blade. It is never empty. It is never billed. It is the only thing you own outright. | 156 |
| 210 | `tut.k1.quick` | council | deadpan | You do not need to put your gun away to use it. Strike from where you stand. | 76 |
| 211 | `tut.k1.draw` | council | deadpan | Now draw it properly. | 21 |
| 212 | `tut.k1.hint` | council | deadpan | The quick strike is on its own key. The blade lives on the fifth. | 65 |
| 213 | `tut.k1.done` | council | deadpan | Blade confirmed. The subjects have been notified that the contractor is still armed. They have taken it badly. | 110 |
| 214 | `tut.k2.intro` | council | deadpan | Three strikes, each harder than the last. Keep them close together or the third one does not come. | 98 |
| 215 | `tut.k2.hold` | council | deadpan | Hold the button and the blade chains itself. Your hand is permitted to rest. The blade is not. | 94 |
| 216 | `tut.k2.hint` | council | deadpan | Strike again before the last strike ends. Then once more. | 57 |
| 217 | `tut.k2.done` | council | deadpan | The chain is certified. So is the drain in the floor. | 53 |
| 218 | `tut.k3.intro` | council | deadpan | The stab reaches further than the swing. A little further. Do not get ideas. | 76 |
| 219 | `tut.k3.lunge` | council | deadpan | Stab in the middle of a chain, at a subject beyond your reach, and the blade will take you to him. It is very keen. | 115 |
| 220 | `tut.k3.hint` | council | deadpan | Swing at the near one, then stab at the far one before the chain ends. | 70 |
| 221 | `tut.k3.done` | council | deadpan | Lunge certified. Distance has been removed from this list of reasons also. | 74 |
| 222 | `tut.k4.intro` | council | deadpan | Subject 3310 has been given a pistol and told that if he hits you, he can go home. Both statements are partly true. | 115 |
| 223 | `tut.k4.guard` | council | deadpan | Hold the guard and the blade will stop what he sends at you. | 60 |
| 224 | `tut.k4.parry` | council | deadpan | Raise the guard as he fires, not before, and his round goes back the way it came. Look at him when you do it. The round goes where you look. | 140 |
| 225 | `tut.k4.hint` | council | deadpan | He raises the gun. It clicks. Then raise the guard. | 51 |
| 226 | `tut.k4.done` | council | deadpan | Subject 3310 will not be going home. He has been informed. Briefly. | 67 |
| 227 | `tut.k5.intro` | council | deadpan | Swing while running at a subject and the blade covers the last few metres for you. Run first. Then swing. | 105 |
| 228 | `tut.k5.hint` | council | deadpan | Full speed, and swing when he is about seven metres away. | 57 |
| 229 | `tut.k5.done` | council | deadpan | Dash-slash certified. The subjects have asked whether running helps. It does not. | 81 |
| 230 | `tut.k6.intro` | council | deadpan | The board on the wall lists four combinations. Each has a name. The names were chosen by a committee, which is why they are like that. | 134 |
| 231 | `tut.k6.cleave` | council | deadpan | Cleave. Two strikes and a stab, and the stab comes down from above. | 67 |
| 232 | `tut.k6.tornado` | council | deadpan | Tornado. Everything around you, at once. | 40 |
| 233 | `tut.k6.flying` | council | deadpan | The flying slash leaves the blade and keeps going. It is the only part of the blade that does. | 94 |
| 234 | `tut.k6.flurry` | council | deadpan | Flurry. Six in half a second. The subject did not have time to object. | 70 |
| 235 | `tut.k6.hint` | council | deadpan | Follow the lights on the board. Left is the swing, right is the stab. | 69 |
| 236 | `tut.k6.done` | council | deadpan | All four combinations certified. The committee has been informed. The committee does not care. | 94 |
| 237 | `tut.k7.intro` | council | deadpan | The energy blade. It is offered to senior contractors. You are not a senior contractor. You are being offered it anyway, which is a test of character. | 150 |
| 238 | `tut.k7.plate` | council | deadpan | It is faster, it reaches further and it does not acknowledge plates. Stab the armoured subject. | 95 |
| 239 | `tut.k7.burn` | council | deadpan | The energy blade does not leave much. This saves on cleaning. It has been factored into the price. | 98 |
| 240 | `tut.k7.reach` | council | deadpan | The lunge is longer. The subject at the far mark believed he was safe. Correct him. | 83 |
| 241 | `tut.k7.hint` | council | deadpan | Stab through the plate. Lunge further than before. | 50 |
| 242 | `tut.k7.done` | council | deadpan | Energy blade certified. It will be removed from your suite at the door. It can be purchased. Everything can. | 108 |
| 243 | `tut.k8.intro` | council | deadpan | The examination. Ten subjects, two of them armed. You have the blade. They have each other. | 91 |
| 244 | `tut.k8.hint` | council | deadpan | Use what you were shown. All of it, ideally. | 44 |
| 245 | `tut.k8.done` | council | deadpan | Examination passed. The hose on the wall is for the next contractor. The drain is for everyone. | 95 |
| 246 | `tut.c1.intro` | council | deadpan | The Quiet Rooms. The lights have been switched off. Five subjects have been released into the maze. They are hiding. They are not very good at it. | 146 |
| 247 | `tut.c1.sonar` | council | deadpan | Your sonar shows every living body through walls, for a few seconds. Use it, walk, use it again. Hidden men and running men cannot hide from it. | 144 |
| 248 | `tut.c1.faker` | council | deadpan | The next room contains six bodies. Five are deceased. One is pretending. Your sonar does not accept pretending. | 111 |
| 249 | `tut.c1.hint` | council | deadpan | Ping, look at where they are, then go there. They will move. Ping again. | 72 |
| 250 | `tut.c1.done` | council | deadpan | Sonar certified. The lights will now come back on. They were only off for you. | 78 |
| 251 | `tut.c1.fail` | council | deadpan | He was not dead. You were told he was not dead. He has been returned to the floor. | 82 |
| 252 | `tut.c2.intro` | council | deadpan | Three subjects are behind these walls. There are no doors. The rifle goes through walls. The sonar tells it where. | 114 |
| 253 | `tut.c2.hint` | council | deadpan | Ping, aim where they were, fire. Then ping again to confirm. Confirmation is good practice. | 91 |
| 254 | `tut.c2.done` | council | deadpan | Three subjects, no doors opened. The rooms have been re-sealed, with contents. | 78 |
| 255 | `tut.c3.intro` | council | deadpan | Your brain chip has been replaced with Thermal. The hall is full of smoke. The subjects in it are warm. That is their mistake. | 126 |
| 256 | `tut.c3.hint` | council | deadpan | Switch Thermal on and leave it on. It does not run out. Warm shapes are subjects. Cold shapes are furniture. | 108 |
| 257 | `tut.c3.done` | council | deadpan | Thermal certified. The smoke will be extracted. The subjects will be extracted separately. | 90 |
| 258 | `tut.c4.intro` | council | deadpan | Your chip is now Focus. It slows everything except you. The four subjects in the middle will be released at the bell. They have been told the doors are open. | 157 |
| 259 | `tut.c4.hint` | council | deadpan | Use Focus as they start to run, not after. It is short. They are not fast, but they are four. | 93 |
| 260 | `tut.c4.done` | council | deadpan | Focus certified. The doors were open. The subjects were correct about that. | 75 |
| 261 | `tut.c4.fail` | council | deadpan | One of them reached the door. The door has been closed again. So has his file. Again, please. | 93 |
| 262 | `tut.c5.intro` | council | deadpan | You now have two chips. Tap to use the one you are holding. Hold to change to the other. Holding is not using. Please learn the difference here, not later. | 155 |
| 263 | `tut.c5.done` | council | deadpan | Two chips certified. Your head is now worth more than you are. | 62 |
| 264 | `tut.c6.intro` | council | deadpan | The Ring. Twelve subjects. They have been told this is a group exercise. | 72 |
| 265 | `tut.c6.chip` | council | deadpan | Your chip is now Gun Kata. Hold it, and when it is ready, every subject you can see will be shot in the head at once. Hold it now. | 130 |
| 266 | `tut.c6.akimbo` | council | deadpan | It requires a pistol in each hand. You bought a second pistol. Fit it at the pod. | 81 |
| 267 | `tut.c6.alt` | council | deadpan | You did not buy a second pistol. One has been provided. It has been added to your account, with interest. | 105 |
| 268 | `tut.c6.go` | council | deadpan | Stand in the circle. Hold until it is ready. Letting go early costs nothing. Letting go late is not possible. | 109 |
| 269 | `tut.c6.hint` | council | deadpan | Hold, and keep holding. You will hear your heart. That is normal. The subjects will hear theirs. | 96 |
| 270 | `tut.c6.done` | council | deadpan | Gun Kata certified. The Ring will be reset for the next contractor. It takes longer to reset than to use. | 105 |
| 271 | `tut.s.intro` | council | deadpan | The Pen. Kill quickly and your suite rewards you. These rewards are called perks. They are not benefits. Benefits would be taxed. | 129 |
| 272 | `tut.s1.intro` | council | deadpan | Blood Thirst is fitted as standard. Four subjects in five seconds and it wakes up. The gate is opening. | 103 |
| 273 | `tut.s1.done` | council | deadpan | Blood Thirst. Double damage and a magazine that does not run out. For ten seconds. Everything good is for ten seconds. | 118 |
| 274 | `tut.s2.intro` | council | deadpan | Three headshots in three seconds slow the world down for you. You are not slowed. You are not given the option. | 111 |
| 275 | `tut.s2.done` | council | deadpan | Slow motion. The subjects are experiencing it as well. They do not enjoy it either. | 83 |
| 276 | `tut.s3.intro` | council | deadpan | Three kills with the blade in three seconds, and you get faster. Please do not ask what is in it. | 97 |
| 277 | `tut.s3.done` | council | deadpan | Adrenaline. It stacks. The Council does not. | 44 |
| 278 | `tut.s4.intro` | council | deadpan | Butcher has been fitted for this exercise. Take limbs from five subjects quickly, and every hit takes a limb. | 109 |
| 279 | `tut.s4.done` | council | deadpan | Butcher. The floor will be hosed. The subjects will be counted twice: once whole, once not. | 91 |
| 280 | `tut.s5.intro` | council | deadpan | Chain Reaction. Four subjects from one explosion, and the dead become explosive. The dead are already very cooperative. | 119 |
| 281 | `tut.s5.done` | council | deadpan | Chain Reaction. Please stand back from the deceased. That was always good advice. | 81 |
| 282 | `tut.s6.intro` | council | deadpan | Skyfall. Four kills in the air, and your dashes stop running out and your slams go off. Get above them. Stay there. | 115 |
| 283 | `tut.s6.done` | council | deadpan | Skyfall. Now slam. | 18 |
| 284 | `tut.s7.intro` | council | deadpan | Overdrive. Five kills at speed, and the faster you go, the harder you hit. The track goes round. Keep going round. | 114 |
| 285 | `tut.s7.done` | council | deadpan | Overdrive. Speed has now been monetised. | 40 |
| 286 | `tut.s8.intro` | council | deadpan | The implant bench. You have three slots, and room for one of each kind. Fit Hellfire, or Berserk, yourself. The Council will then release everything. | 149 |
| 287 | `tut.s8.release` | council | deadpan | All pens are open. There are thirty of them. You may keep count. We will. | 73 |
| 288 | `tut.s8.sampler` | council | deadpan | Chain Storm has been activated as a courtesy. It normally takes thirty kills. Today it takes a signature. | 105 |
| 289 | `tut.s.hint` | council | deadpan | Faster. Every perk wants the kills close together. The card on the gate says how close. | 87 |
| 290 | `tut.s.done` | council | deadpan | Perks certified. The Pen is empty. It will not stay empty. It never does. | 73 |
| 291 | `tut.y.intro` | council | deadpan | The Yard. Capturing delinquent subjects is beneficial to Council operations. You will be paid for every one you bring in alive. | 127 |
| 292 | `tut.y.live` | council | deadpan | The subjects in the Yard are armed, and have not been told this is training. Neither have their rounds. | 103 |
| 293 | `tut.y1.do` | council | deadpan | A man surrenders when he can see that it is over. Kill his friends. Leave him on his own. Then stop. | 100 |
| 294 | `tut.y1.kneel` | council | deadpan | He has surrendered. Do not shoot him. A man shot while surrendering runs, and never surrenders again, and tells nobody, because he is running. | 142 |
| 295 | `tut.y1.refused` | council | deadpan | You shot a surrendered man. He has withdrawn his surrender. That is his right. It is now also your problem. | 107 |
| 296 | `tut.y1.hint` | council | deadpan | Fewer friends, more distance, more blood. When he has run out of reasons, he kneels. | 84 |
| 297 | `tut.y1.fail` | council | deadpan | That was the last one. He was the lesson. Another squad has been provided. | 74 |
| 298 | `tut.y2.do` | council | deadpan | Walk up to him and ask. Subjects who are questioned tend to share. | 66 |
| 299 | `tut.y2.reveal` | council | deadpan | He has told you where his friends are. They are marked. They do not know they are marked. That is the useful part. | 114 |
| 300 | `tut.y2.bunker` | council | deadpan | Three men, waiting behind the bunker door for you to open it. Now you know. Do not open it the way they expect. | 111 |
| 301 | `tut.y2.liar` | council | deadpan | This one is a veteran. Veterans lie. Ask him anyway. | 52 |
| 302 | `tut.y2.lie` | council | deadpan | He says they are in the shed. Check the shed with your sonar before you believe a man on his knees. | 99 |
| 303 | `tut.y2.caught` | council | deadpan | Nobody in the shed. He lied to you. He did it bravely. It has been noted under brave, and under lied. | 101 |
| 304 | `tut.y2.hint` | council | deadpan | Close enough to touch him. Tap, do not hold. Holding is a different conversation. | 81 |
| 305 | `tut.y3.do` | council | deadpan | You may let him go. Tap again. He will walk out of the gate with his hands up, and he will tell people. | 103 |
| 306 | `tut.y3.why` | council | deadpan | Released subjects talk. The next man is more willing to kneel. This is called reputation. It is not called mercy. | 113 |
| 307 | `tut.y3.squad` | council | deadpan | The next squad has heard about you. Some of it was even true. | 61 |
| 308 | `tut.y3.hint` | council | deadpan | Question first. Then tap again to release. | 42 |
| 309 | `tut.y4.do` | council | deadpan | Now capture one. Hold, do not tap. A drone will collect him. You will be paid as he leaves the ground. | 102 |
| 310 | `tut.y4.paid` | council | deadpan | Bounty secured. He will be processed, and perhaps one day he will come back here, to help with your retraining. | 111 |
| 311 | `tut.y4.alone` | council | deadpan | You turned your back on a prisoner. He has noticed. Prisoners are not furniture. They have opinions about pistols. | 114 |
| 312 | `tut.y4.hint` | council | deadpan | Hold until the ring fills. Then stand back. The drone does not slow down for contractors. | 89 |
| 313 | `tut.y4.done` | council | deadpan | Two subjects captured, two bounties paid. Your account is briefly in credit. Please enjoy the feeling. It is being processed. | 125 |
| 314 | `tut.y5.intro` | council | deadpan | Three subjects have broken and are running. Broken men run away from you and out of sight. Your sonar does not respect either. | 126 |
| 315 | `tut.y5.caught` | council | deadpan | Cornered. Close enough and long enough in your sight, and he stops running and decides what he is. | 98 |
| 316 | `tut.y5.hint` | council | deadpan | Ping, then go where they are going, not where they were. | 56 |
| 317 | `tut.y5.done` | council | deadpan | All three runners accounted for. Running has been noted as a waste of everyone's time. | 86 |
| 318 | `tut.y6.intro` | council | deadpan | Cornered men do one of several things. You will now be shown each of them. They have not been shown the list. | 109 |
| 319 | `tut.y6.cower` | council | deadpan | This one is begging. A begging man cannot be cuffed. Look away and he will run again. Do not look away. | 103 |
| 320 | `tut.y6.fight` | council | deadpan | This one has chosen to fight. He will not break again. He has nothing left to break. | 84 |
| 321 | `tut.y6.taunt` | council | deadpan | This one is wounded and has chosen to be rude about it. It changes nothing. It is merely noted. | 95 |
| 322 | `tut.y6.surrender` | council | deadpan | And this one has chosen sense. Do with him what you have learned. | 65 |
| 323 | `tut.y6.done` | council | deadpan | Cornering certified. Every subject in the Yard has now made a choice. Most of them have regretted it. | 101 |
| 324 | `tut.y7.intro` | council | deadpan | Another one has surrendered. Please question him. | 49 |
| 325 | `tut.y7.done` | council | deadpan | You saw the glint. Not every subject who kneels has finished fighting. The ones with grenades in particular. | 108 |
| 326 | `tut.y7.clear` | council | deadpan | You were clear of it. He was not. He has made his final statement. | 66 |
| 327 | `tut.y7.fail` | council | deadpan | He was not surrendering. The Council knew this. The Council felt you would learn it better this way. | 100 |
| 328 | `tut.y8.intro` | council | deadpan | Three subjects. You have been shown capture and release. There is a third option. The Council does not recommend it. The Council does not forbid it. | 148 |
| 329 | `tut.y8.bonus` | council | deadpan | Your suite rewards that, briefly. Others who saw it will remember it for longer. | 80 |
| 330 | `tut.y8.self` | council | deadpan | He has made his own arrangements. This is recorded as a voluntary departure. Like yours would have been. | 104 |
| 331 | `tut.y8.mercy` | council | deadpan | No executions. Your restraint has been noted. Restraint is not paid. Captures are. | 82 |
| 332 | `tut.y8.done` | council | deadpan | The Yard is clear. You have now been trained in every way the Council has of dealing with people. There are not many. | 117 |
| 333 | `tut.y9.intro` | council | deadpan | This is Contractor 4471. He is down. In co-operative work you will be expected to help. Hold, until he is up. | 109 |
| 334 | `tut.y9.coop` | council | deadpan | If it is you on the floor, crawl to cover and wait. Your colleagues have thirty seconds to care. | 96 |
| 335 | `tut.y9.done` | council | deadpan | Contractor 4471 is up. He has been reassigned to the Live Range. In a standing capacity. | 88 |
| 336 | `tut.g.intro` | council | deadpan | The Proving Ground. In the field, call-ins are earned by killing quickly. Here they are issued, one at a time, by me. Do not get used to it. | 140 |
| 337 | `tut.g.how` | council | deadpan | Press to aim. Click to confirm. The ring on the ground is the true size. Cancel if you change your mind. Changing your mind is not billed. | 138 |
| 338 | `tut.g1.cancel` | council | deadpan | Cancelled. No charge. Now confirm one. | 38 |
| 339 | `tut.g1.done` | council | deadpan | Airstrike. Fifteen rockets. The sixteenth is the one you will remember. | 71 |
| 340 | `tut.g2.intro` | council | deadpan | The next one strafes along a line. Drag to choose the line. The road is a good line. The subjects are on it. | 108 |
| 341 | `tut.g2.done` | council | deadpan | Strafe complete. The road will need resurfacing. The subjects will not. | 71 |
| 342 | `tut.g3.intro` | council | deadpan | An aircraft. Tap to sit behind the gun yourself. Hold to send it with its own crew. Its rounds go through roofs. The roofs were built for this. | 143 |
| 343 | `tut.g3.send` | council | deadpan | Now hold, and send the crew while you work on the ground. They are also contractors. They are also you. | 103 |
| 344 | `tut.g4.intro` | council | deadpan | The attack helicopter flies itself. You only shoot. It is the most relaxing thing you will do today. | 100 |
| 345 | `tut.g5.intro` | council | deadpan | The gunship. Three guns. Use all three. The largest one is for when you are certain. | 84 |
| 346 | `tut.g5.done` | council | deadpan | Gunship certified. It has never hit the contractor. That is the only thing it has never hit. | 92 |
| 347 | `tut.g6.intro` | council | deadpan | The sentry shoots only drones and missiles. It ignores people completely, which makes it the most tolerant thing on site. Drones are launching. | 143 |
| 348 | `tut.g6.done` | council | deadpan | Air defence certified. The drones were training drones. They have been retired. | 79 |
| 349 | `tut.g7.intro` | council | deadpan | The orbital lance. A beam from above. Steer it. It lasts six seconds and leaves a great deal longer. | 100 |
| 350 | `tut.g8.intro` | council | deadpan | The Distraint Frame. Climb in. It has a cannon with three kinds of shell, and the reload key changes between them. Each target has been chosen for one. | 151 |
| 351 | `tut.g8.flak` | council | deadpan | Flak bursts just short of what you aim at and fills the air with fragments. It is for crowds, and for things that fly. These are both. | 134 |
| 352 | `tut.g8.done` | council | deadpan | Frame certified. Please climb out. The Frame is not yours. Nothing here is. | 75 |
| 353 | `tut.g9.intro` | council | deadpan | The Black Sun. It pulls everything in, the living and the dead, and then it stops. Put it in the square. | 104 |
| 354 | `tut.g9.done` | council | deadpan | The square is clear. The Black Sun is not recommended near paperwork. | 69 |
| 355 | `tut.g.hint` | council | deadpan | The key on your screen is the one for this call-in. Press it, aim, click. | 73 |
| 356 | `tut.g.fail` | council | deadpan | That landed on nobody. It has been reissued. The first one has been charged. | 76 |
| 357 | `tut.g10.intro` | council | deadpan | Your retraining is nearly complete. The remaining subjects are no longer required. They have been gathered in the village for you. | 130 |
| 358 | `tut.g10.do` | council | deadpan | You have been issued a tactical nuclear device. Please use it on the village. Please do not look directly at the village. | 121 |
| 359 | `tut.g10.after` | council | deadpan | Retraining complete. Your receipt is attached. Please retain it. It will not be reissued. | 89 |
| 360 | `tut.g10.door` | council | deadpan | The exit is the door you were shown when you arrived. It is still unlocked. It is now recommended. | 98 |
| 361 | `tut.g10.thanks` | council | deadpan | The Council thanks you for your voluntary participation. A note has been made. It is a good note. Nobody will read it. | 118 |
| | **Total** | | | | **34,572** |

---

## 6. Build plan

### 6.1 Order

The mission lesson from the owner: **script first, owner's OK, then build.** Stage A is that.

| Stage | What | Depends on | Size |
|---|---|---|---|
| **A** | **Owner review** of this page: the station list, the script, the open questions. Voice script exported for reading | — | S |
| **B** | **Plumbing.** `retraining` mission registered (`src/campaign/missions/index.ts`), `retraining.lines.ts`, the Annex map id. First-launch routing on Play, `op2.played.v1` and `op2.retraining.v1`, the `?join=` exemption, Play → Training with Station select. The exit door trigger, fade and exit lines. The kiosk. Mission steps and triggers from 6.3. A stub Annex (Intake, Atrium, one bay per wing) so it can all be driven end to end in a test | A | M |
| **C** | **Subjects.** Held (pose, barks, not interactive, armour intact), released (exit, hide), playing dead, and the forcing hooks for live men. Unit tests for each state and hook in the style of `outpost.test.ts` | B | M to L |
| **D** | **The Annex shell.** Intake, Atrium with the observation column and wing doors, wing corridors, signs, lighting. Built like the Office: a `plan.ts` of numbers, `build.ts`, and a map test | B | M |
| **E** | **Mobility wing**, M1 to M14: bays, speed meter, gates, the flow course and its timer. Every bay's size proved in Rapier as `parkour.test.ts` does, including the two known holes (climb reach, dash reach) | D | L |
| **F** | **Gallery and Procurement**, W1 to W12 and P1: plates, the pattern board, turntables, the pod bay, the corrective floor, the grenade hatch, the wound call board | C, D | L |
| **G** | **Cutting Room and Quiet Rooms**, K1 to K8 and C1 to C6: the combo board, the shooter, the dark maze, smoke, the runway, the Ring | C, D | M |
| **H** | **The Pen**, S1 to S8: pens, gates, the bench, the big release (perf check at 30 subjects) | C, D | M |
| **I** | **Outdoors**: the Yard and the Proving Ground under open sky. Village, drone launcher, Frame pad. The skyhook checked on every kneel spot | C, D | L |
| **J** | **Optional rooms**: the Armoury (W13), the Energy blade bay (K7) and the Jump Jet bay (M13) once their systems land | E, F, G | M |
| **K** | **Voice**: after the owner approves the words, ElevenLabs generation with the `shodan` voice through `tools/scripts/voice-generate.mjs` (needs the owner's approval and credits: section 5) | A | S (code), credits |
| **L** | **Owner playtest and tuning**: par times, hint timings, the length | All | M |

E, F, G, H and I can be built in parallel by separate agents once B, C and D are in, because each wing is its own set of beats and
its own part of the map.

### 6.2 What is reused

| Piece | From | Used for |
|---|---|---|
| Mission runner, beats, checkpoints, cues, `say`, `hint`, `objective`, `nudge`, doors, cutscenes | `src/campaign/` | Every station is a beat with its checkpoint; doors gate them |
| `?beat=` start | `src/campaign/runner.ts` | Station select and testing |
| `give`, `grenades`, `callins`, `squad`, `place` steps | `src/campaign/types.ts` | Kit and spawns |
| Map kit and the Office's way of building | `src/world/kit/kit.ts`, `src/world/map/office/` | The Annex |
| `PARKOUR` sizes and their tests | `src/campaign/parkour.ts` | Mobility bays |
| Lab dummy spawn (`place(id, at, 'off')`), `breakNerve` | `src/lab/spawn.ts`, `src/lab/index.ts` | Held subjects; forced surrender |
| Outpost soldiers, prisoners, airlift, flight | `src/enemies/outpost/` | The Yard, released subjects |
| Garrison chatter lines and clips | `chatter/lines.json`, `public/audio/chatter/` | Every subject's voice (no new subject audio) |
| Supply pod and Procurement | `src/progression/pickups/pods.ts`, `src/ui/screens/procurement.ts`, `src/contracts/shop/` | Every shop lesson |
| Mods, rounds, armour | `src/weapons/mods.ts`, `src/enemies/damage.ts`, `src/enemies/wounds/` | W6 to W9 |
| Chips, implants, perks, call-ins, the Frame | `src/contracts/chips.ts`, `src/progression/`, `src/frame/` | C, S, G |
| Revive and its hold ring | `src/net/team.ts`, `src/ui/hud/holdRing.ts` | Y9 |
| Council voice pipeline | `tools/scripts/voice-script.ts`, `voice-generate.mjs`, `src/ui/commander/voice.ts` | All lines |
| Bots | `src/player/testkit/bots.ts` | Automated runs of every Mobility bay |

### 6.3 What is new

| New | Detail |
|---|---|
| First-launch check | On Play: no key from 1.4's list present, and no `?join=`, starts Retraining. Throws read as "returning" |
| Saves | `op2.played.v1` (written on the first `game:state` to playing), `op2.retraining.v1` |
| Menu | Play → Training: Full retraining, Station select (with ticks and the flow course best) |
| Exit door | A zone at each exit door: fade, the progress-picked exit line, save, back to the menu |
| Kiosk | `{interact}` world prop, two-press sign, opens every wing |
| Mission steps | `fit {weapon, mod}`, `drain` (empty every gun), `chip {slots}`, `implant {id, slot}`, `perk {id}` (sampler), `grant {callin}` (one call-in), `credits {amount}` (scrip), `shopAnytime {on}`, `pod {at}` (a supply pod at a fixed spot) |
| Mission triggers | A `test` trigger with a named predicate registered through `campaign.provide` (speed at or above a value, `player.state`, a count of events inside a window), because `where` matches exact fields only. Or a `player:state` event on each state change. Plus events where none exist: `enemy:wound {zone}`, `melee:combo {move}`, `melee:parry`, `jet:burn` |
| Held subject | Pose, barks, never in the prisoner loop, armour as a fighting man |
| Released subject goals | `exit`, `hide`, `walk` (between spots) |
| Playing-dead subject | A live man in a corpse pose who gets up if passed |
| Forcing hooks for live men | `forceSurrender` (wraps `breakNerve`), `forceTalk {truthful}`, `forceFlee`, `forceCorner {reaction}`, `forceRearm`, `fireOnRhythm {period}` |
| HUD bits | Speed meter with KEPT/LOST, speed gates, flow timer, the zone call board, the odds tag, the wall combo counter |
| Props | Steel plates, pattern board, turntable, corrective floor, grenade hatch, smoke vents, pens and gates, combo board, drone launcher, the receipt |
| The Annex map | Intake, Atrium, seven wings, two of them outdoors |

### 6.4 Risks

| Risk | What to do |
|---|---|
| **Length.** Every station end to end is long: roughly 60 to 90 minutes for a first run | The door, the kiosk, Station select, and wings that can be done in any order once signed. Open question 2 |
| **Held subjects look wrong.** A standing, hands-up pose that still flinches, staggers, falls and crawls needs the pose blended with the wound reactions | Build C early and look at it; fall back to the kneeling pose with x5 and plate-skip switched off for subjects if the standing pose fights the rig |
| **Live AI does not do the lesson.** Real men may not surrender, talk, run or fake on cue | Every Yard lesson has a forced outcome or a timed fallback |
| **The skyhook indoors.** | The Yard is outdoors with open sky over every kneel spot; a test runs the airlift's heading search from each spot |
| **Systems in flux.** Jump Jet, the energy blade, flechettes, API and the Flail were all being built on 2026-11-17 | Their stations (M13, K7, W7, W13) are built last and checked against the code as it lands |
| **Trigger plumbing.** The runner's `where` matches exact values only | The `test` trigger in 6.3, built in B before any wing |
| **Performance.** The Pen's big release (30) and graduation (about 20) on the owner's 8 GB M1 | Caps are 48 live, 14 ragdolls, 40 corpses: inside them. Profile H and G10 on the owner's machine |
| **Shop rules.** Buying, selling and fitting are "between waves only" | `shopAnytime` for this mission only |
| **First-launch misfire.** A returning player with none of the keys gets Retraining once | Harmless: the door is five seconds away and leaving counts as seen |
| **Tone.** Using begging prisoners as targets is meant to be dark | The comedy stays the Council's indifference, never the men's fear (1.2). The owner reads the script in A |
| **Browser tests on the owner's machine** | Serialise them, one Chrome at a time, at dpr 2 (the owner's machine limits) |

---

## 7. Open questions for the owner

Sensible defaults are already in the design. These are the real forks.

1. **Length of the first-launch run.** Default: the full Retraining, with the door and the kiosk as the ways out. The other option is a
   short core on first launch (Intake, Mobility M1 to M7, Gallery W1 to W6, Yard Y1 to Y4: about 20 minutes), with the rest offered
   from Play → Training.
2. **The narrator's name.** Default: she stays "the Council", nameless, as in the missions. Or a title such as "Retraining Officer".
3. **New subject lines.** Default: none; subjects use the existing garrison begging. A few training-only lines ("I was captured, I
   was told this was processing!") would sharpen it, at a small voice cost.
4. **Graduation by nuke** on the gathered subjects. Default: yes. The quieter option ends on the receipt alone.
5. **Voice.** About 35,000 characters (361 lines) of new Council lines (section 5). Approve the script and the ElevenLabs credits, or ship with
   subtitles first (unrecorded lines show as text already).
