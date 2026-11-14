# Plan: Outpost Defense, an Endless Humans map

Status: plan, not scheduled. Written 2026-11-14 from the owner's notes; the owner answered the first round of questions
the same day. Pieces 1 (stims), 2 (allies, partly: see `docs/notes/allies.md`, Rough), 3 (mounted guns) and 4 (walls, gates and shacks) are built; nothing else is. Open details are marked **Q** with the default the build would use.

## Why this, and why in this order

The owner wants one big campaign mission eventually, built from pieces made along the way. This mode is the first big
use of those pieces: almost everything it needs, the big mission needs too (allied soldiers above all). So the build
order below makes each piece useful on its own first, and the mode last.

## The mode

A real-time tower defense in first person, under Endless Humans. The player holds a fort built in rings against
endless waves of human attackers. Each wave pays credits. Credits buy troops, ammunition, weapons, repairs and gun
upgrades. Losing a ring loses the shop inside it. It never ends; it escalates.

### Decisions from the owner

- **Stims replace health pickups everywhere**, in every mode. Carry up to 5. Using one is a short self-injection during
  which the player is vulnerable. A stim also revives a wounded ally. A dead ally stays dead.
- **Squad of 4 to 8 allies.** They hold an area by type (see below). Walk up to one and tap E: that one follows you.
  Hold E: the whole squad follows. Tap or hold again to send them back to their posts.
- **Loadout:** the run starts with a budget and a loadout screen: one primary and one secondary, no explosives.
- **Breaks between waves.** New weapons can be bought only in a break. Everything else (troops, ammo, repairs,
  upgrades, stims) can be bought at any time, under fire.
- **Endless, escalating. Humans only**, except the bosses late on.
- **The player can buy their own mortar teams**, who shell the field at random: a constant friendly bombardment to watch.

### The fort

Three rings, the inner ones mattering more:

| Ring | Shop | Losing it means |
|---|---|---|
| Outer | **Barracks**: hire troops, replace the fallen, buy mortar teams | No new troops |
| Middle | **Armoury**: weapons (in breaks), specialty and explosive ammo, gun upgrades | No new weapons or special ammo |
| Core | **Infirmary and magazine**: stims, basic ammo | No healing and no resupply: fight on with what you carry |

- Catwalks along the walls, so the whole perimeter can be reached. Gates in each ring.
- Mounted guns on the walls.
- Destructible shacks outside: cover for the attackers that the player can level.
- **Q1.** How a shop is lost. Default: each shop is a building with health; attackers inside its ring go for it.

### Walls that wear down in stages

| Stage | What it means |
|---|---|
| Intact | Full cover |
| Damaged | Holes to shoot through; attackers can build a ramp or a jump pad over it |
| Breached | A gap they pour through |

Explosives, rockets and tank shells wear walls; small arms do not. Gates can be blown. Repairs cost credits per stage
and take a few seconds of work, so a wall cannot be fixed instantly mid-fight.

### Mounted guns

Each starts as a heavy machine gun with infinite ammunition. Upgrades: **Q2.** Default ladder: HMG, then a faster HMG
with a shield, then a minigun.

### Allies by type (owner, 2026-11-14)

Each type has a job, and costs differ by type.

| Type | Where it is good | Where it is bad | Holds |
|---|---|---|---|
| Rifleman (Trooper) | All-rounder, the perimeter | | A wall section |
| Machine gunner | All-rounder, the perimeter | | A mounted gun or a wall corner |
| Sniper | The perimeter, at range | Close combat | A tower or high point |
| Rocketeer | The perimeter; vehicles and choppers | Close combat | Near a gate |
| Mortar team | Shelling the field | Useless up close | Inside the walls, out of sight |
| Shotgunner (Gunner) | Close combat inside the fort | Range | Inside, guarding a shop |
| Riot police | Containing a breach | Range | Inside; when a wall is breached they move to it and form a shield line across the gap to block it at close range |
| Medic | The core | | Revives with stims of his own |

- **Q3.** Prices. Default: riflemen cheapest; machine gunners and shotgunners about twice that; riot police and medics
  about three times; snipers, rocketeers and mortar teams about four to five times. No upkeep.

### The economy

The tension is spending now against saving for what is coming:
- Infantry ammunition is cheap.
- Explosive and specialty ammunition is expensive: rockets, autocannon shells, Sabot darts, sniper rounds.
- The right tool is cheaper than the wrong one: the lock-on rockets (Quiver) are cheap against helicopters and poor
  against tanks; tanks want the rocket launcher, the autocannon or a weak point.
- Each break shows the next wave's preview, so saving up is a real choice.
- **Q4.** Starting budget and pay per wave. Default: tuned so the first loadout is a decent rifle and pistol, and wave 5
  can afford the first rocketeer.

### The waves

| Waves | Who comes |
|---|---|
| 1 to 3 | Riflemen and shotgunners, some carrying satchel charges for the walls |
| 4 to 6 | **Mortar teams**: set up in place behind cover, easy to find and disrupt; they cannot fire while moving. Engineers who build cover and jump pads |
| 7 to 9 | Trucks and Humvees, the first **tank** boss wave. Rocketeers join the attackers |
| 10+ | **Suicide bombers** (the Bomber); snipers; machine gunners |
| Boss waves, in this order | Tanks, then **helicopter** bosses, then the **Juggernaut**, then the **Titan**, then everything at once. The undead bosses are the late surprise |

- **Q5.** Boss wave spacing. Default: every 5th wave, in the order above, then repeating harder.
- **Call-ins are bought in this mode** (owner, 2026-11-14), not earned by combo: airstrike, Warthog, door gunner, attack
  chopper, AC-130 and the rest sit in a shop at prices that climb with their power. **Q6.** Which shop. Default: the
  Armoury, and any time, not only in breaks.
- **Q7.** The owner said shops can be bought. Default: a lost shop can be rebuilt for a large sum in a break, once its ring
  is clear again.

## The pieces, in build order

Each is useful on its own; the mode comes last. Sizes are rough.

| # | Piece | Useful on its own because | Size | Model, effort |
|---|---|---|---|---|
| 1 | **Stims** replacing health pickups everywhere: inventory of 5, injection animation, the vulnerable second, HUD. **Built**: `progression/stims.ts`, notes in `docs/notes/progression.md` under Stims | Every mode gets it | Medium | Opus, medium |
| 2 | **Allied soldiers** (built, partly: `src/allies/`, `docs/notes/allies.md`; enemies other than human squads ignore them, and nobody has played them): friendly squad AI built from the enemy soldier code, hold an area by type, follow on E, revive with a stim, a friendly crosshair, no friendly fire (the hive plan's question 1 default) | The big mission's core piece | Large | Opus, high |
| 3 | **Mounted guns** (built: `src/vehicles/emplacement.ts`, `docs/notes/vehicles.md`): wall emplacements the player and allies can man, infinite ammo, the upgrade ladder | Any map can use them | Medium | Opus, medium |
| 4 | **Destructible walls, gates and shacks**: staged wear, holes, breaches, repairs. **Built**: `src/world/structures.ts`, notes in `docs/notes/world.md` under Walls, gates and shacks | Any map can use them | Large | Opus, high |
| 5 | **Credits, shops, loadout screen, breaks**: the economy and its UI | The mode | Medium to large | Opus, medium |
| 6 | **The fort map**: rings, catwalks, gates, towers, shacks, the open field round it | The mode | Large | Opus, high |
| 7 | **The wave director**: escalation, mortar teams, engineers (charges, cover, jump pads), vehicles, the boss order | The mode | Medium to large | Opus, high |
| 8 | **The player's mortar teams** | The mode | Small to medium | Opus, medium |

Pieces 1, 3 and 4 do not depend on each other and could be built side by side; 2 is the longest. The mode (5 to 8)
starts once 2 and 4 exist.

## Left out

- The air support overhaul (`docs/proposals/air-support.md`); later, on its own.
- Zombies, except the late bosses.
- Saving a run between sessions.
