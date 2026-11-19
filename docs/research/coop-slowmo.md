# Slow motion in co-op: how other games do it, and what fits OVERPOWERED 2

Research note, 2026-11-17. No game code was changed. Code references are to the repo at the time of writing.

**Decided and built, 2026-11-18** (on branch `coop-overhaul`): the owner chose "one player slows everyone, and every screen says
who", which is Option A here with a notice. What was built, the rules and the numbers are in `docs/notes/coop.md`, "Time: the
team's slow motion"; where that note and this one differ (file names, the 12 s team budget in place of a per-player cool-down),
that note is current.

## The short answer

Our co-op **already has shared slow-mo**. What is missing is Focus (the T-key brain chip) and a few cues on the guests' screens. The cheapest good answer is to let Focus use the shared-slow-mo path that SLOWMO already uses. Nobody pays a speed penalty, because every player keeps full speed and only the host's enemies slow down. That removes the main problem other games had (one player slowing the others), and the netcode cost is about one new message.

**Pick: Option A, "Team Focus"** (section 5). Option B (a personal speed-up, no time change) is the cheap fallback. Option C (a slow-field bubble) is the cool one but costs about a week and touches the enemy clock.

## 1. What we have today (read from the code)

### How the host steps the sim

- `Game.run` (`src/core/Game.ts`) runs one loop on `requestAnimationFrame`. There is **no fixed tick**. Each frame calls `ctx.coop.world.clock()`, then `ctx.time.tick(realFrameSeconds)`, then `frame()`, which updates every system in a fixed order.
- A hidden host tab is ticked at 30 Hz by a worker (`keepTickingWhenHidden`), so the world doesn't freeze when the host alt-tabs.
- Physics (Rapier) is one world. It steps with `time.dt`, a variable step of up to 4 substeps.
- The host runs the enemies, wave director and damage. Guests run no AI. They get a 10 Hz binary snapshot (`SNAPSHOT_MS = 100`, 12 + 44 bytes per live enemy, at most 2,124 bytes) and interpolate over 100 ms of **real** receiver time (`alpha = (now - replica.at) / SNAPSHOT_MS`, `src/net/world.ts:491`).
- Guests send fire announcements and hit claims. The host checks each claim in `ClaimValidator` (`src/net/authority.ts`): a fire-rate floor (`now - previous.at < max(8, interval * 650)` ms, which is 65% of the gun's interval), a range of 350, a line-of-sight test, a damage cap, and a claim freshness of 8 s on the wall clock.

### Is time scale global?

**Yes, per browser.** `GameTime` (`src/core/time.ts`) has three clocks:

| Clock | What uses it | Slow-mo effect |
|---|---|---|
| `realDt` | UI, camera shake, audio ducking | none |
| `dt` | enemies, projectiles, particles, gore, **physics** | scaled |
| `playerDt` | the player's own body, gun, stims, the Focus meter | none (hit-stop only) |

Slow-mo is a map of named requests (`pushScale(id, scale, fadeIn, fadeOut)` / `popScale(id)`). The lowest scale wins. `EnemyManager` reads one `ctx.time.dt` and one world clock (`w.now = ctx.time.elapsed`, `EnemyManager.ts:385`). There is no per-enemy clock.

### How SLOWMO and Focus work in single player

- **SLOWMO** is a core implant, always on (`CORE` in `src/progression/implants.ts`). Three headshots on different heads in 3 s give 5 s of the world at 0.25x while the player stays at full speed (`docs/proposals/implants.md`). The perk code does `pushScale('slowmo', 0.25)`. Audio follows `time.slowmo` (pitch and rate in `AudioEngine.ts:596`), and the `slowmo` colour grade is applied through `GradeName`.
- **Focus** is a brain chip (`src/contracts/chips.ts`). `FOCUS`: scale 0.35, a 4 s meter that refills in 18 s, a 1.5 s delay before refill, and a 25% minimum to start. Tapping T calls `time.pushScale('focus', 0.35, 0.12, 0.25)`. The meter drains on `playerDt`, so the slow-mo doesn't stretch it.
- **In co-op, Focus is blocked on purpose.** `setFocus` returns early with the callout `NO FOCUS BRAIN CHIP IN CO-OP` (`chips.ts:241`). The comment says "one player's clock cannot slow the other's".

### What co-op already does about slow-mo

- `SHARED_SLOW = /^(slowmo|timeWarp|bossDeath|coop:)/` (`src/net/world.ts:41`). Each frame, before the clock ticks, `clock()` on the **host** keeps only those requests and drops hit-stop and everything else (`time.keepScales`). On a **guest**, `clock()` calls `clearScales()`, so a guest's own clock never slows.
- A guest's SLOWMO or Time Warp perk is sent to the host as `{ t: 'slow', id, on }`. The host pushes a `coop:<peer>:<id>` request at 0.25 and caps it at 8 s of wall time (`world.ts:252`). Everyone keeps full speed, because `playerDt` is not touched.
- Guests see it only as **slower enemies in the snapshots**. I found no host-to-guest `slow` message. The sender code at `world.ts:118` is inside `if (!session.hosting)`. So a guest who didn't trigger it gets no audio pitch drop, no colour grade, and no slowing of its own local particles, gore and bullets. Its replica animations also run at real time (`placeReplica(enemy, this.ctx.time.dt, ...)` uses the guest's cleared clock), so bodies may skate or animate faster than they move. This needs a play test to confirm.
- Hit-stop, the Judge's fan slow-mo and Focus are dropped in co-op (`docs/notes/coop.md`, "Slow motion").

So the question isn't really "how do we make slow-mo work in co-op". It works. The question is who may call it, and what the guests feel.

## 2. How other games handle it

All of this comes from web search summaries and the pages they point to. I did not open every page in full. Where the sources disagree, I say so. Numbers from fan sites are marked as such.

### Games with real multiplayer slow-mo

| Game | What it does | What we can learn |
|---|---|---|
| **F.E.A.R.** (2005) multiplayer SloMo | The player picks up an injector that charges a bar (about 20 s, per a [GameStar beta preview](https://www.gamestar.de/artikel/fear-mp-beta-angespielt,1452099.html)). Using it slows the world for **everyone**, and the user moves and fires faster than the rest. A fan walkthrough gives about 2.7x slower in multiplayer vs 5x in single player ([Cyberly](https://www.cyberly.org/game-cheats/pc-walkthroughs/f.e.a.r.-&-f.e.a.r.-extraction-point.html), unofficial). SloMo deathmatch modes were popular ([WorthPlaying](https://worthplaying.com/article/2005/3/23/previews/23379/)), and F.E.A.R. 2 added a free Slow-Mo Deathmatch ([Destructoid](https://vip-develop.destructoid.com/?p=52248)). | Global slow-mo plus a personal advantage for the user is the standard answer. The user gets a *relative speed-up*, not a gift to the enemy. |
| **Max Payne 3** multiplayer "Bullet Time" Burst (2012) | Not global. It affects players who are in the activator's **line of sight**, and the effect chains: if you see someone who is slowed, you are slowed too until you break line of sight. Affected players are slowed more than the activator ([Game Informer](https://gameinformer.com/games/max_payne_3/b/xbox360/archive/2012/05/11/hands-on-with-max-payne-3-39-s-multiplayer.aspx), [MP1st](https://mp1st.com/news/bullet-time-in-max-payne-3-multiplayer-how-will-it-work), [GamesRadar](https://gamesradar.com/max-payne-3-hands-gang-wars-payne-killer-and-multiplayer-bullet-time)). | The only big-studio example of "slow-mo for some". It was built for PvP, with 16 players, and I found no write-up of how Rockstar replicated it. It is a bubble in spirit, but with a sight test. |
| **Stranglehold** (2007) Tequila Time | In multiplayer it affects **everyone**, and a reviewer noted the user can suffer as much as anyone. Their gain is mostly that they know what is going on. Auto-triggers on dives and interactions, and a meter drains and refills ([HEXUS review](https://www.hexus.net/gaming/reviews/pc/9998-stranglehold-xbox-360ps3/?page=3), [GamesRadar hands-on](https://gamesradar.com/stranglehold-hands-on/2)). Described as the main multiplayer differentiator but limited in use. | A global slow with no advantage for the user is dull. Don't copy it. |
| **The Specialists** (Half-Life mod) | The first multiplayer slow-mo game by popular account. A powerup gives about 5 s, and everyone slows. A kill earns 1 s, up to 5 ([Combine OverWiki](https://www.combineoverwiki.net/wiki/The_Specialists), a fan review on [ModDB](https://www.moddb.com/mods/the-specialists/reviews/632102)). Double Action Boogaloo follows the same approach ([PC Gamer](https://www.pcgamer.com/mod-of-the-week-double-action-boogaloo-for-half-life-2)). | Slow-mo as a **rare pickup or earned resource**, shared by all, is the classic pattern. |
| **Unreal Tournament 3** Slow Field (2009 patch) | A deployable cube. Inside, projectiles run at 0.125x and players at 0.2x. It drains a lifetime when someone is inside, lasts 3 min if nobody is ([BeyondUnreal wiki](https://wiki.beyondunreal.com/UE3:UTSlowField_(UT3)), [Liandri Archives](https://unrealarchive.org/wikis/the-liandri-archives/Deployables.html)). Sources disagree on how hitscan interacts with it. | The one clear shipped example of a **bubble**. It slows projectiles harder than people, and it is a deployable, not a self-buff. |
| **Garry's Mod** bullet-time addons | Mostly single-player. Comments say host_timescale stutters in multiplayer and many slow-mo addons "only work in singleplayer" ([Steam comments](https://steamcommunity.com/sharedfiles/filedetails/comments/131426623), anecdotal; [ModDB Bullet Time](https://www.moddb.com/addons/bullet-time1)). A TTT "Zed Time" addon exists. | Server-wide timescale is the common hack, and it is rough. Warning, not a model. |
| **SUPERHOT-style co-op mods** | A Nuclear Throne Together mod ([itch](https://yokin.itch.io/superhot)) and a UE project "Super Hot Gun Game" ([Unreal forum](https://forums.unrealengine.com/t/super-hot-gun-game/2483176)) say time moves only when players move. Neither says how they sync. | The "time follows movement" idea works for co-op only as a **shared** rule, so the whole team's movement drives one clock. It is a different game, not a Focus replacement. |

### Single-player references (no netcode lessons, but good feel lessons)

- **Trepang2**: slow-mo is a recharging resource, about 10 s from full ([PC Gamer](https://www.pcgamer.com/this-intense-bullet-time-filled-fps-is-a-glorious-tribute-to-fear-and-the-spirit-of-2000s-era-gaming), [Softpedia](https://www.softpedia.com/reviews/games/pc/trepang2-review-537321.shtml)). Bullet trails and shock waves stay visible while slowed. I could not confirm a feature called "focus mode" there. It is the closest reference to our Focus.
- **Ghostrunner / Ghostrunner 2**: a brief slow-down to dodge or reposition, mostly in the air ([Shacknews review](https://shacknews.com/article/137483/ghostrunner-2-review-score)).
- **Sniper Elite 4**: the slow-motion X-ray kill cam is a presentation of one kill, with a frequency setting ([Co-Optimus](https://www.co-optimus.com/article/14040/new-x-ray-kill-cams-for-sniper-elite-4.html)). I could not confirm who sees it in multiplayer.
- **Titanfall 2 Stim** is the personal speed-up pattern: more move speed and double health regeneration for a few seconds, with a blue trail ([Titanfall wiki](https://titanfall.fandom.com/wiki/Stim)). It has no time change at all.
- **Superhot** has no multiplayer in the base game.

**Not checked** (single-player or no slow-mo, so they don't affect the netcode choice): Quantum Break, TimeSplitters, Hitman, Dead Island, Kill Team, Payday, Rainbow Six, Deep Rock Galactic, Ready or Not, Severed Steel, Doom Eternal. I did not search for these and make no claim about them.

### Engine and network write-ups

- **Unreal** keeps a global `TimeDilation` and a per-actor `CustomTimeDilation`, and they multiply ([AActor docs](https://docs.unrealengine.com/4.26/en-US/API/Runtime/Engine/GameFramework/AActor/CustomTimeDilation/)). Forum answers say a common multiplayer recipe is: the server sets the dilation and tells clients (a multicast, or a replicated variable that sets it on arrival) ([Time Dilation and Multiplayer](https://forums.unrealengine.com/t/time-dilation-and-multiplayer/755948), [Multiplayer slow motion effect](https://forums.unrealengine.com/t/multiplayer-slow-motion-effect/66547)). If you slow only one player, everyone else runs at normal speed ([Slowmo on the activator only](https://forums.unrealengine.com/t/slowmo-effect-on-player-that-activated-it-only/43610)). Known snags: net update rates move with the dilation (bug [UE-238682](https://issues.unrealengine.com/issue/UE-238682)), replays get messy, and per-actor dilation doesn't reach physics.
- **Local perception filters.** Smed, Niinisalo and Hakonen (2005, *Computer Networks*) built bullet time for one player without changing the others' speed, by bending what the player sees and hears ([DBLP](https://dblp.uni-trier.de/rec/journals/cn/SmedNH05.html), [author page](https://staff.cs.utu.fi/~jounsmed/mmd/)). It is academic and not a shipped pattern, and it needs a custom netcode model that we don't have.
- A GameDev.net thread ([link](https://www.gamedev.net/forums/topic/448906-slow-motionbullet-time-methods-for-a-multiplayer-game/3972779/)) suggests slowing the other players *less* than normal slow-mo, and a chained version. US patent [9,814,967](https://patents.google.com/patent/US9814967) points out that a player who alone is slowed is at a disadvantage, and suggests keeping aim and fire in real time while running stays slow. It is a patent claim, not evidence of a shipped game.

## 3. The patterns, and how they meet host-authoritative netcode

| Pattern | Fairness and consent | Host-authoritative fit | Our cost |
|---|---|---|---|
| **P1. Global slow, user triggers** (F.E.A.R., Specialists) | In PvP, the others never agreed. In PvE like ours, everyone keeps full speed, so it is a team buff. The only "consent" issue is pacing and a player spamming it. | **Best fit.** The host is the only place enemies exist. Slow the host's clock and the 10 Hz snapshots carry the slow to everyone, with no changes to the binary format. Hit claims get easier (slow targets move less between claim and check). | Already built for SLOWMO. Needs a Focus request and a cue to the guests. |
| **P2. Local perception only** (pitch, FOV, desaturation, blur, no time change) | No unfairness at all, and no benefit either, unless it comes with a stat change. | Free. Nothing crosses the network. Alone it is a *filter*, not a power. | Tiny. But it doesn't deliver "slow motion". |
| **P3. Personal speed-up** (Titanfall Stim, the F.E.A.R. holder advantage) | The player gets stronger, nobody else changes. | Fits well. The guest's own body, gun and reload run on its local clock already. Only guests' fire rate needs host agreement: the host's floor is 65% of the gun interval, so a speed-up past about 1.5x gets claims dropped unless the check is loosened. | Small to medium. Feels like a buff, not slow-mo. |
| **P4. Slow-field bubble** (UT3 Slow Field, Max Payne 3 line of sight in spirit) | Teammates are unaffected, and enemies in the bubble slow. Best "game feel" for a squad. | Works only if the **host gives each enemy its own clock**. Snapshots already carry velocity, so guests would see it. | Large. See section 4. |
| **P5. Shared meter, "everyone must agree"** | Fair on paper. In play it adds a vote UI and delay to something that should feel instant. | Needs a request, vote and expiry on the host. | Medium, and it feels worse. Not recommended. |
| **P6. Line of sight, chained** (Max Payne 3) | Built for PvP fairness. Pointless against AI. | Needs a visibility test per pair on every change. | Not a fit. |

Two points apply to any pattern that slows the host's world:

1. **Guests' local sim at full speed.** Guests run their own bullets, particles, gore, shells and replica animation on a cleared clock. During a host slow-mo these run too fast against the slowed enemies. The fix is one host-to-guest message carrying the current scale. The guest keeps its own player clock at full speed, but feeds the scale into local effects, replica animation (`placeReplica`) and the audio rate.
2. **Physics.** Rapier is one world. Global slow works. A bubble can't slow ragdolls in one region, so a bubble covers living enemies and projectiles only.

## 4. The options for OVERPOWERED 2

### Option A: Team Focus (shared world slow, any player calls it)

**Feel.** Any player taps T. For about 3 to 4 s the whole battlefield drops to roughly 0.35 to 0.4x, and everyone keeps full speed, with a callout like "VIPER: FOCUS". It is the same feel as solo Focus, and the same feel as the team's SLOWMO headshot reward, which already exists. The team gets one cinematic moment at a time.

**Netcode cost.**
- `chips.ts:241`: remove the co-op block. In co-op, don't call `pushScale` locally. A guest sends `{ t: 'slow', id: 'focus', on }` to the host. The host sees its own as a `coop:`-prefixed request.
- `world.ts:41` and `:252`: the regex and the guard only accept `slowmo` and `timeWarp`. Add `focus` with its own scale (0.35 to 0.4) and a shorter wall-clock cap (for example 4.5 s instead of 8 s).
- Host rule: **one shared slow at a time** (the lowest scale already wins in `GameTime`). Add a per-player cool-down of about 10 to 12 s on the host so no one can hold it open, and reject a request while another player's Focus is live.
- New host-to-guest message `{ t: 'slowstate', scale, by }` on the action lane. Guests use it for the audio rate, the grade, local effects and replica animation speed. This also fixes the gap that exists for SLOWMO today.
- `worldProtocol.ts`: widen the validator (`world.test.ts` already tests a bad `slow` message at line 387).
- **No change** to the 10 Hz snapshot, hit claims, or the validator. The 8 s claim age uses wall time.

**Risks.**
- Pacing: one player can dominate the cinematic. The host cool-down and a short cap handle most of it. A player who taps it every time ends up annoying the team, so the per-player cool-down should be long.
- Host and guest each have their own meter. A guest's meter is local. The host's cap is the real limit.
- Guests may see foot-skating on replicas until section 3 point 1 is done. Needs a play test at dpr 2.
- A real-time respawn timer (3.5 s) doesn't stretch. That is fine and probably right.

**Build size.** About 1 to 1.5 days, including tests in `world.test.ts` and `chips.test.ts` and a two-browser check. Part of that is the guest cue, which also upgrades SLOWMO.

### Option B: Personal Overdrive (no time change)

**Feel.** T makes *you* faster for a few seconds: the camera gets a low-pass audio pitch, a desaturated grade, a small FOV pull, and you get a real buff. Candidates are quicker reloads and ADS, a faster move speed, and a fire-rate boost. Enemies don't slow, so it feels more like Titanfall's Stim or a power-up than bullet time.

**Netcode cost.** Almost none. It runs on `playerDt`, the guest's own clock. Two real constraints:
- A fire-rate boost must stay under about 1.5x, or the host's rule at `authority.ts` (interval x 650 ms) drops the claims. Faster reload, ADS and move speed are free.
- Teammates should see it: a small cosmetic event, like Sonar's, so the others get a trail or a glow.

**Risks.** It's a different ability under the same key. Players who know Focus will expect slow motion. It doesn't give the "I can see the bullets" thrill. Safe, but a disappointment for the signature feature.

**Build size.** About 1 to 2 days, mostly tuning.

### Option C: Time Bubble (slow-field around the caller)

**Feel.** T drops a dome (about 10 to 14 m) on you for about 5 s. Inside it, enemies and their projectiles run at about 0.3x. You and your friends, inside or out, run at full speed. Friends can step in to share it. It is the best squad play: "get in my bubble". Closest to UT3's Slow Field.

**Netcode cost.** The network part is small: a `field { pos, radius, until }` event from the guest, validated on the host, and a broadcast to all so everyone sees the dome. Snapshots already carry velocity, so slowed enemies look right on guests.
The hard part is on the host's sim. There is **one world clock** (`w.now = ctx.time.elapsed`, `EnemyManager.ts:386`) and one `dt`. The bubble needs, per enemy:
- a local time scale based on its position (lowest scale of every field covering it),
- every timer that uses `w.now` (think timers, attack windups, telegraphs, status effects, burn and freeze ticks, stagger) moved onto a per-enemy clock,
- movement, steering and the animator stepping with the enemy's own dt,
- the same for enemy projectiles (UT3 does this with a projectile scaling factor).
Rapier ragdolls and gore don't slow. Commander allies, bosses and vehicles each need a decision.

**Risks.** The largest. Timers that read the global clock will desync from the enemy's visible speed, which gives enemies that "pop" out of the bubble. A boss that gets slowed trivially. Bubble placement while the caller is downed or in a vehicle. Anti-griefing for a bubble that traps allies' AI. The guest replicas need per-enemy animation rate too.

**Build size.** About 5 to 8 days, plus balance. It touches the core enemy loop, which is the most tested code in the game.

### Comparison

| | A. Team Focus | B. Personal Overdrive | C. Time Bubble |
|---|---|---|---|
| Gameplay feel | Real bullet time, shared. Same as solo Focus and our SLOWMO. | A power buff, no bullet time | Best squad play, most complex to read |
| Matches "slow motion" | Yes | No | Yes, partly (enemies only) |
| New network messages | 2 (guest `slow` focus request, host `slowstate`) | 0 to 1 cosmetic | 2 to 3 (`field`, broadcast, validation) |
| Host sim changes | None beyond the regex and the cap | None | Per-enemy clock in `EnemyManager`, projectiles, animators |
| Snapshot format change | None | None | None |
| Hit-claim validator | None | Keep fire-rate boost under about 1.5x | None |
| Griefing risk | Medium (cool-down fixes it) | None | Low to medium |
| Biggest risk | One player owns the moment | Players expect real slow-mo | Timers on the global clock desync |
| Rough build | 1 to 1.5 days | 1 to 2 days | 5 to 8 days |

## 5. Pick: Option A, Team Focus

Reasons:

1. **It's mostly built.** The host already slows the world for everyone when SLOWMO fires, with everyone at full speed. Focus is blocked by policy, not by a missing mechanism.
2. **The fairness problem other games had doesn't exist here.** F.E.A.R. and Stranglehold had to worry about the slowed-down victim. Our slowed things are AI enemies, and players keep `playerDt`. The only fairness issue is pacing, and the host cool-down handles it.
3. **It fixes a gap that exists today.** SLOWMO in co-op gives guests no audio pitch, no grade, and no slowing of local effects. The new `slowstate` message fixes that for SLOWMO and Focus together.
4. **It keeps snapshot interpolation and hit validation untouched.** Slowed enemies are just enemies with smaller velocities.
5. **It leaves C open.** If squads love Team Focus and want more, the bubble can come later on the same `slow` request path.

Suggested starting numbers, to tune in play: scale 0.4, a 3 to 4 s cap, a per-player cool-down of 10 to 12 s on the host, one shared slow at a time, and a feed line naming the caller. Boss death and SLOWMO keep their own requests and the lowest scale wins.

Build order:
1. Host: accept `focus` in the `slow` handler with the cap and cool-down. Widen the regex and the protocol validator.
2. `chips.ts`: in co-op, send the request instead of blocking, and show the callout for a refusal.
3. Host-to-guest `slowstate`, and guests apply it to the audio rate, the grade and replica animation.
4. Tests in `world.test.ts` (accept, cap, cool-down, bad payload) and `chips.test.ts` (co-op no longer blocked). Then a two-browser play test at dpr 2, one at a time on the 8 GB machine.

## 6. Open questions for the owner

- Should Focus in co-op be weaker or shorter than solo (my suggestion), or the same?
- Should the call be limited to one player per wave, or only cool-down limited?
- Is it acceptable that a hit-stop stays off in co-op, as it is now?
- If squad play is the goal, is Option C worth a later week?

## Sources

- F.E.A.R.: [GameStar beta](https://www.gamestar.de/artikel/fear-mp-beta-angespielt,1452099.html), [WorthPlaying preview](https://worthplaying.com/article/2005/3/23/previews/23379/), [Cyberly (fan)](https://www.cyberly.org/game-cheats/pc-walkthroughs/f.e.a.r.-&-f.e.a.r.-extraction-point.html), [Destructoid on F.E.A.R. 2 Slow-Mo DM](https://vip-develop.destructoid.com/?p=52248)
- Max Payne 3: [Game Informer](https://gameinformer.com/games/max_payne_3/b/xbox360/archive/2012/05/11/hands-on-with-max-payne-3-39-s-multiplayer.aspx), [MP1st](https://mp1st.com/news/bullet-time-in-max-payne-3-multiplayer-how-will-it-work), [GamesRadar](https://gamesradar.com/max-payne-3-hands-gang-wars-payne-killer-and-multiplayer-bullet-time)
- Stranglehold: [HEXUS](https://www.hexus.net/gaming/reviews/pc/9998-stranglehold-xbox-360ps3/?page=3), [GamesRadar](https://gamesradar.com/stranglehold-hands-on/2)
- The Specialists: [Combine OverWiki](https://www.combineoverwiki.net/wiki/The_Specialists), [ModDB review](https://www.moddb.com/mods/the-specialists/reviews/632102), [PC Gamer on Double Action](https://www.pcgamer.com/mod-of-the-week-double-action-boogaloo-for-half-life-2)
- UT3 Slow Field: [BeyondUnreal](https://wiki.beyondunreal.com/UE3:UTSlowField_(UT3)), [Liandri Archives](https://unrealarchive.org/wikis/the-liandri-archives/Deployables.html)
- Trepang2: [PC Gamer](https://www.pcgamer.com/this-intense-bullet-time-filled-fps-is-a-glorious-tribute-to-fear-and-the-spirit-of-2000s-era-gaming), [Softpedia](https://www.softpedia.com/reviews/games/pc/trepang2-review-537321.shtml)
- Ghostrunner 2: [Shacknews](https://shacknews.com/article/137483/ghostrunner-2-review-score)
- Sniper Elite 4: [Co-Optimus](https://www.co-optimus.com/article/14040/new-x-ray-kill-cams-for-sniper-elite-4.html)
- Titanfall Stim: [Titanfall wiki](https://titanfall.fandom.com/wiki/Stim)
- SUPERHOT-style co-op: [Nuclear Throne Together mod](https://yokin.itch.io/superhot), [Super Hot Gun Game](https://forums.unrealengine.com/t/super-hot-gun-game/2483176)
- Garry's Mod: [Steam comments](https://steamcommunity.com/sharedfiles/filedetails/comments/131426623), [ModDB Bullet Time](https://www.moddb.com/addons/bullet-time1)
- Unreal and network write-ups: [CustomTimeDilation docs](https://docs.unrealengine.com/4.26/en-US/API/Runtime/Engine/GameFramework/AActor/CustomTimeDilation/), [Time Dilation and Multiplayer](https://forums.unrealengine.com/t/time-dilation-and-multiplayer/755948), [Multiplayer slow motion effect](https://forums.unrealengine.com/t/multiplayer-slow-motion-effect/66547), [Slowmo on the activator only](https://forums.unrealengine.com/t/slowmo-effect-on-player-that-activated-it-only/43610), [UE-238682](https://issues.unrealengine.com/issue/UE-238682), [Smed et al. on DBLP](https://dblp.uni-trier.de/rec/journals/cn/SmedNH05.html), [Smed author page](https://staff.cs.utu.fi/~jounsmed/mmd/), [GameDev.net thread](https://www.gamedev.net/forums/topic/448906-slow-motionbullet-time-methods-for-a-multiplayer-game/3972779/), [US patent 9,814,967](https://patents.google.com/patent/US9814967)
- Our code and docs: `src/core/time.ts`, `src/contracts/chips.ts`, `src/net/world.ts`, `src/net/authority.ts`, `src/net/worldProtocol.ts`, `src/enemies/EnemyManager.ts`, `src/audio/AudioEngine.ts`, `docs/notes/coop.md`, `docs/proposals/coop.md`, `docs/proposals/implants.md`
