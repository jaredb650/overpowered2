# Contracts, sonar and the comms feed

`src/contracts/`. Section 15 of DESIGN.md is the source of truth. `createContracts(ctx)` from `index.ts`, on `ctx.contracts`.

| File | What it is |
|---|---|
| `data.ts` | `CONTRACTS`, the Council's copy, `SONAR`. No three.js, so anything can read it |
| `select.ts` | `ACTIVE`: which contract and map this page runs. The URL rules, and the route to another contract |
| `scores.ts` | One high score per contract in localStorage |
| `sonar.ts` | Key T: cooldown, ping, reveal |
| `rewards.ts` | The back-shot bonus |
| `index.ts` | The system: `def`, `sonar`, frame update, reset |

## Adding a society

Add a row to `CONTRACTS`: map, faction, wave source, AI rule set, wound rules, rewards, briefing, score key. The menu, the high score table, the map choice and the URL all follow from the row. `ContractId` needs the new id, and a new rule set needs its id added to the union it belongs to. Nothing else in this folder changes.

## Reading the contract

```ts
import { ACTIVE } from '../contracts/select';   // from anywhere, at any time, including before systems exist
ACTIVE.def.ai === 'outpost';                    // also .waves, .wounds, .faction, .rewards
ctx.contracts.def;                              // the same row, from a system
ACTIVE.ranked;                                  // false on a map the contract does not own
```

`waves`, `ai` and `wounds` are ids. This folder does not implement them: the enemy systems choose their behaviour from them. The Crucible's row has to keep meaning exactly what the game did before contracts: `swarm`, `swarm`, `limbs`, and a back-shot multiplier of 1.

## URLs

| URL | Contract | Map | Scores |
|---|---|---|---|
| `/` | The Crucible | Crucible | Kept |
| `/?contract=outpost` | The Outpost | Kill House | Kept |
| `/?map=killhouse` | The Outpost: the contract that plays there | Kill House | Kept |
| `/?map=crucible` | The Crucible | Crucible | Kept |
| `/?map=range` | The Crucible's rules. No contract owns it | Test Range | Not kept |
| `/?contract=crucible&map=killhouse` | The Crucible's rules | Kill House | Not kept |

`/` is always the default contract. There is no remembered choice, so the URL is the only state and a sandbox can never open on the wrong map.

## Changing contract is a page load

`World` builds one map at boot, and pulling a map out from under physics, nav, the light volume, the pickups and every pool is a far bigger job than a load of about 10 s. A reload also hands back all of the old map's GPU memory, which matters on 8 GB.

Pointer lock and audio both need a fresh gesture after a load, so the click cannot be saved. Instead Play sends the browser to `?contract=<id>&deploy=1`, and the splash reads `Click to deploy: <name>`. That one click unlocks audio, takes the mouse and starts the run. `takeDeploy` strips the flag, so a refresh shows the normal splash. Dev flags such as `?dev=1` survive the move. `map` and `autostart` do not.

## Sonar

Key T, action `sonar`, rebindable. `SONAR` in `data.ts` has every number.

Press, then `sonar:tap` raises the left hand. `tapLead` later the fingers land, the sound plays, the ring leaves and `sonar:ping` goes out. Enemies are lit as the ring reaches them, at 150 m/s, for the rest of 4 s, and fade over the last 0.7 s. The cooldown runs from the key press: 8 s, or 3 s at 3 or fewer `enemies.remaining`, and it shortens the moment the count falls. A press on cooldown plays `ui_error`.

It runs on `playerDt`: SLOWMO does not stretch it, a hit-stop does.

A hand holding a grenade or a device keeps it. The ping goes out without the tap.

Rendering is in `docs/notes/render.md`. The minimap pulses every enemy while the reveal runs. The chip is `ui/hud/sonar.ts`.

## Rewards

**Geneva Suggestion.** `enemy:executed`, from the Outpost, pays `STYLE.geneva` through the usual multipliers on top of the kill, and grants the `geneva` effect: 6 s, stacks to 5, +20% damage and +12% fire rate a stack. Numbers are in `progression/data.ts`.

**Back shots.** `enemy:backshot`, from the Outpost, pays `rewards.backShot - 1` of the hit again as a second hit on the same spot, through `enemies.applyDamage`. That way armour, limb pools and the kill all go through the damage model. A head hit is skipped: it has its own multiplier, and a second one would pay its score twice. A `BACK SHOT` label floats at most once a second.

It is a second hit and not a multiplier on the first because the first has already been dealt by the time the event goes out. A multiplier in the damage model would be cleaner if whoever owns that file wants it, and then `BackShots` can shrink to the label.

## Comms feed

`comms:line` (`CommsLine` in `enemies/outpost/events.ts`) goes to `CommsFeed` in `ui/hud/feed.ts`: four lines at most, six seconds each, above the sonar chip. The speaker shows, or the squad when the speaker is null. `fear`, `panic`, `surrender` and `squadGone` show amber, everything else cold. Text only for now.

## Tuning knobs

| Want | Change |
|---|---|
| Sonar timing, range, colours | `SONAR` |
| How a silhouette looks | `SILHOUETTE_FRAG` in `render/XRay.ts` |
| How the ring looks | `SWEEP_FRAG` in `render/XRay.ts` |
| Tap pose | `TAP_*` in `weapons/viewmodels/offhand.ts`, `HANDS.tap` |
| Ping sound | `sonar_ping` in `audio/synth/recipes/rewards.ts` |
| Council copy | `briefing` rows and `NOTICE_*` in `data.ts` |
| Geneva | `STYLE.geneva`, `STACK.geneva*`, `EFFECTS.geneva` in `progression/data.ts` |
| Back shots | `rewards.backShot` on the contract |
