# Euphoria update: the plan

Written 2026-11-09 by the ragdoll study (lane 3), which was read-only: nothing under `src/` was changed and no scratch scripts were added for this plan. The inputs were three designs (weight-first, powered ragdoll, behaviours), the map of the body pipeline, the weight measurements (`tools/out/ragweight/*.json` and its sheets), the research notes, and the code. I checked the code and the measurements wherever a design's claim mattered. Section 2 lists what that check changed.

The owner today: "euphoria ragdoll update lets do it. The ragdolls feel good but dont feel very weighty." Weight comes first. After it come the asks in `docs/NEXT.md` and `docs/DESIGN.md` section 20:

- half ragdoll and half animated, interwoven with the wounds;
- no hard transitions;
- knocked over by running into them, then fighting to get back up;
- a well-placed headshot drops the body like a sack;
- non-fatal headshots knock them over;
- blasts throw survivors, who then get up.

The owner loves today's muscle ragdolls, and nothing here may lose them. Earlier, forces came down because they were "ridiculous", so bullets stay modest and only blasts got stronger. Heavy is not the same as hard to move.

## 1. Verdict

Scores run from 1 to 5, and 5 is best in every column, so for risk and cost 5 means the least.

| | Weight-first | Powered ragdoll | Behaviours |
|---|---|---|---|
| Answers "not very weighty" | **5**. It removes each measured cause in the order the owner meets it: the squat onto the heels, the hoisted collapse, the headshot twitch, momentum dropped at death, doubled gravity, and mass-blind reactions | **3**. Stage 1 fixes the collapse. Everything after that adds physical living bodies, which is a different problem | **4**. Stage 1 covers the deaths, but gravity is only a sandbox scene and mass waits until stage 2 |
| Euphoria ask | **3**. Body checks, a failed get-up, and a stagger that turns into a fall on muscles. No physical recovery, no link to the wounds | **5**. The nearest bodies are always physical. Balance, wounds, get-ups and deaths all run on one chain | **4**. A physical stagger it can win or lose, a library of behaviours, a get-up it can fail, wounds choosing the behaviour |
| Risk to what works | **5**. Every change is inside today's chain, muscle and reflex code, and most have measurements behind them | **2**. It changes what `root` means, lets AI and physics diverge, relies on Rapier motor behaviour nobody has verified, and puts living enemies on physics all the time | **3**. Stage 2 is a new balance controller on 4 solver iterations, and recovery hands the body back mid-stride |
| Frame cost on the 8 GB M1 | **5**. About 0 for stages 1 to 4, and an estimated 0.4 ms at most for the falls on muscles | **2**. 75 to 240 µs per body per frame in Node at load average 5, never measured in Chrome, and double at 30 fps | **4**. 0.6 to 1.2 ms estimated for 6 standing bodies, unmeasured |
| Testability | **5**. Probe metrics with today's values next to them, plus sheets and before/after flags | **3**. Its headline numbers are Node proxies, and the Chrome cost and the motor caps are both unknown | **4**. Good tests, but stage 4's refactor needs a determinism gate |
| **Total** | **23** | **15** | **19** |

**The winner is weight-first.** The plan below is weight-first's order, with the best parts of the other two grafted on:

| Taken from | What |
|---|---|
| Behaviours | The knock-out feel on head hits: the head whips back and the arms go slack. A braced fall that gives. Hands kept over the head through a blast flight. A get-up the body pushes up physically and can fail. A capture-point give-up inside the fall. The physical stagger it can win, as a late stage behind a flag. Wounds setting strength per limb. A refusal on uneven feet |
| Powered ragdoll | Pin yield by speed change: a hit moves the hold on the hips by `|J|/mass`, so a heavy body is heavy without being hard to move. Its measured hold band (at 11 rad/s a 120 N·s chest hit moves the hips 6 cm, at 4 rad/s the body sways, at 2.5 it sags 0.35 m). Carry pairs as the fallback if cutting the trunk's gravity is not enough. Its measurements of tracking lag, which are the reason running bodies stay animated |
| Research | The miniature effect behind the gravity A/B. Euphoria's "strength 0..1 per limb". The 0.2 s of looseness at the moment of impact. Restitution near 0 |

Stages:

| # | Stage | What the owner sees | Est. frame cost | Risk |
|---|---|---|---|---|
| 1 | The weight pass | Every death drops under its full weight, headshots like a sack | 0 to -0.3 ms | Low |
| 2 | Tempo dial | Falls at real-world timing, if the owner wants it | 0 | Low (A/B) |
| 3 | Hits with mass | Big bodies stop flapping, light rounds stop wobbling bodies, nothing freezes in the air | ≤ +0.4 ms worst frame | Low |
| 4 | Knocked over | Run them over. Every non-fatal head hit puts them down. Landings that give | Inside today's knockdown cap | Medium |
| 5 | Fight to get up | A physical push-up that can fail. Hit while rising, they go back down | Small | Medium |
| 6 | Losing balance on muscles | A stagger that becomes a fall is one motion | ≈ 0.4 ms (measure) | Medium |
| 7 | Catching balance | A hard hit it wins or loses physically | ≤ 1.0 ms (measure) | High, behind a flag |
| 8 | Wounds set strength | A shot leg buckles, a gut shot curls, a burning man rolls | Small | Medium |

## 2. Facts checked, and what they changed

1. **The weight probe no longer runs under tsx.** `src/core/devflags.ts:18` reads `import.meta.env.DEV`. Under node, `DEV_ASKED` is false, so the right side of `||` is evaluated, and `import.meta.env` is undefined there, so it throws. Every probe therefore runs through a vitest wrapper, as `tools/out/puppet-study/probe.test.ts` already does. Weight-first's `npx tsx` commands are replaced. `devflags.ts` belongs to lane 1, so leave it alone.
2. **The probe's heel collider also changed the foot's mass.** The variant at `tools/out/ragweight/probe.ts:88-90` replaced `hit`, and `rigInfo` takes volume from `hit`. A 0.2 m capsule became a ball, so the foot weighed about 4 times less. The real change keeps the mass on `hit`, so its numbers must be measured again, not assumed.
3. **The heel alone makes bodies more balled up and faster.** Trooper, 6-heading means, today against heel only:

   | Kind | Head-to-foot at rest, m | First-0.25 s acceleration, m/s² | Hips on the floor, s |
   |---|---|---|---|
   | Drop | 1.09 → 0.66 | -12.7 → -15.7 | 0.43 → 0.30 |
   | Headshot | 0.87 → 0.62 | -12.7 → -15.7 | 0.40 → 0.29 |
   | Judge | 1.12 → 0.83 | -12.8 → -15.5 | 0.48 → 0.31 |

   So the heel cannot ship alone, and it ships with the knee stop. Heel plus a 0.2 margin has never been measured, so stage 1 sweeps it. The only measured knee stop sat at 2.45 rad, with a free ankle. It put drop and headshot bodies back on their shins (0.48 to 0.79 s) and slowed drops to -7 to -9.8 m/s².
4. **There is no trunk-only gravity measurement.** The probe's `cutKeep` at lines 59-62 rescales *every* `setGravityScale` call: arms, head, root, spine and the Reflex. On the collapse, today against the three values tried:

   | | Today | cutKeep 0 | cutKeep 0.25 | cutKeep 0.5 |
   |---|---|---|---|---|
   | First-0.25 s acceleration, m/s² | -0.64 | -3.61 | -3.45 | -2.97 |
   | Peak centre-of-mass speed, m/s | -2.59 | -1.67 | -1.78 | -1.91 |

   Hips reached the floor at 0.96 s today and 0.97 s with cutKeep 0. The trunk alone, with arms and head keeping their cut, should land between cutKeep 0.25 and cutKeep 0. It must be measured.
5. **`Rag.goLimp()` does not end a collapse.** `MuscleState.letGo()` (`muscles.ts:962`) returns at once when there is no reflex. A limp call on a collapsing body therefore leaves the held-hip stumble running. Stage 1 needs a real give-up.
6. **`Gore.headshot` does nothing to a body gore owns that is collapsing and not down** (`index.ts:890-893`). Head rounds on a dying body only reach gore through `damageCorpse`. They sever the head at 60 raw damage, about three SMG rounds, and `sever` then only raises the pace to about 1.9x (`index.ts:741`, `muscles.ts:937`). The fix goes in `damageCorpse` and `sever`.
7. **The guard on "a working muscle carries its own weight" is not a physics test.** `docs/notes/gore.md:234` says `knockdown.test.ts` guards it "by the hand reaching a wound". That test (`knockdown.test.ts:379`) runs only the animator, through `stand(c)`, with no ragdoll. Stage 1 adds a physics guard before it touches any gravity cut.
8. **Weight-first's `legFade [0.35, 0.9]` would break a guard test.** muscles.test 'holds the pose at first, lets the upper body go...' (`muscles.test.ts:461`) expects `drive(shinL)` to be exactly 1 at frame 36 of a 1.7 s collapse, which is u = 0.353. Dropped.
9. **Weight-first's flinch changes do not hit its own target.**
   - `HumanoidAnimator.flinch` already scales by archetype: `magnitude × (1.4 - 0.9 × weight)`, with husk 0.1, trooper 0.25, brute 0.7 and juggernaut 0.92. `frac` is already damage over max health. So the extra `sqrt(85/mass)` counts mass twice, and it is dropped.
   - For a spring kicked to speed v, the peak is about `v/ω · exp(-ζ/√(1-ζ²) · atan(√(1-ζ²)/ζ))`. That gives 0.037 v at (210, 15) and 0.036 v at (130, 19). The retuned springs remove the overshoot, from about 16% to under 1%, but they do not lower the peak.
   - The peak follows the magnitude change alone. On a Trooper (hp 70, an SMG round is 25) that goes from 1.42 to 0.99, which is 0.69x, so 0.26 rad becomes about 0.18 rad, not the design's ≤ 0.13. The acceptance below uses 0.15 to 0.2.
10. **Ragdolls already fall slower than the living.** Physics bodies fall at 19 m/s², living enemies at 28 (`movement.ts:11`) and the player at 32 (`player/tuning.ts:39`). A lower corpse gravity widens that gap. That is why stage 2 is a dial the owner sets, with full gravity until the first landing for airborne kills.
11. **`EnemyManager.ts` imports `waves.ts`**, so it sits in lane 1's area today. `contact.ts` and the wounds already reach the damage model through the public `EnemyManager.model` (`wounds/index.ts:433` calls `manager.model.drop`), so stages 4 to 6 need no edit to `EnemyManager.ts`. Only stage 7 needs a one-line change there, scheduled after lane 1 finishes.
12. **Lane 2's sound calls sit inside the functions this plan edits.** `damageCorpse` and `headshot` contain lane 2's `audio.play` lines, and `hear` sends landings to the sound system. Every edit there is an exact replacement that leaves those lines untouched.
13. **`maxKnockdowns` is 12, not 6** (`index.ts:38`). `maxKnockdowns` 12 plus `maxCollapses` 4 is more than `maxRagdolls` 14, and `enforceBudget` (`index.ts:599`) freezes the oldest plain ragdoll, which can be one killed this frame.
14. **The behaviours design's sag figure is not the real one.** It says the hips sag g/hipRate² = 0.157 m. `holdHips` applies its impulse through an implicit factor bounded by the mass of the hips (`dt / (1 + (d·dt + k·dt²)/hips.mass)`), so its effective stiffness at 60 Hz is several times lower than k. The legs also carry part of the weight. So the sag is measured, not computed. With cutKeep 0 the hips still reached the floor on time (0.97 s), so the hold and the legs did carry it.
15. **`e.velocity.y` is written in one place** (`roles.ts:249`, a climbing role). The death velocity therefore uses `airborne ? verticalSpeed : velocity.y`.
16. **The Euphoria numbers are GTA V helper defaults** from modding documentation, with no units given. They are used only as starting points, never as targets.
17. **Doc drift to fix when the stage that touches each lands:**
    - `gore.md:280-282` says 64 instances per archetype; the code has 96.
    - `gore.md:286` says the burn emitter sits on the root; it sits on the chest.
    - The `contact.ts` header (lines 5-6) and `enemies.md:193` say running into a body knocks it off its feet. Stage 4 makes that true.
    - `wounds.md:148` says a paralysed man's legs still stir. Stage 8 fixes that.

## 3. Rules for every stage

- **One agent per stage.** Edit only with exact replacements. Leave `src/enemies/waves.ts` and its consumers alone, and the same for `src/ui`, `src/lab`, `src/core/devflags.ts`, `src/contracts` and `src/audio`. In `src/gore/index.ts`, edit around lane 2's `audio.play` lines and never through them. Do not commit. If tsc reports errors only in other lanes' files, report them and do not fix them.
- **Shell.** Start with `export PATH=$HOME/.nvm/versions/node/v22.23.3/bin:/opt/homebrew/bin:$PATH`.
- **Tests.** Run one file at a time: `nice npx vitest run <file> --testTimeout=60000`. Never run the whole suite.
- **Probe.** `PROBE=<sections> nice npx vitest run tools/scripts/ragweight.test.ts --testTimeout=60000`. The probe's own `it` carries a 30-minute timeout, and `it.skipIf(!process.env.PROBE)` keeps it out of any full run. Trust 6-heading means only. Single runs differ by seed (MuscleState seeds come from a module counter).
- **Browser.** Only through `node tools/shot.mjs`, at `--dpr 2 --w 1440 --h 900`. It allows one browser at a time and queues on a lock, so wait your turn and never kill another Chrome. The dev server on port 5173 stays up.
- **Cost check.** Run `react-chaos` before and after in the same session:

  ```
  node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-chaos.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/chaos.png
  ```

  The load moves the absolute numbers, so only the difference counts. The physics step peak may rise by at most the stage's budget, and every survivor must get back up with no console errors. Today's reference on a loaded machine is a 6.7 ms peak and 4.7 ms of CPU a frame.
- **Before and after.** Each stage that changes how bodies look ships a switch, read inside gore the way `muscles.ts:92` reads `?muscles=`, so the owner can compare in motion.
- **What has to stay true.** Every rule in `gore.md` "What has to stay true" holds unless a stage says why and how it is tested.
- **Hand-off.** Each stage ends with the owner trying it. Stage 2's gravity choice must be in before stages 5 to 7 are tuned.

---

## Stage 1. The weight pass: dead weight

**Goal.** Every death goes down under its full weight, starting with what the owner meets most.

- **The commonest death on `/`, The Crucible, is a collapse.** An SMG, Buzzsaw or Kiln kill on a body's feet sinks from its first frame and speeds up into the floor. Today it is held at standing height and lowered at a steady 0.6 to 0.8 m/s with a third of its weight switched off, then drops its last 0.3 to 0.5 m in 0.15 s.
- **Every plain death drops through its knees and lies at length.** That covers headshots, shotguns, the Judge, blasts and any collapse past the cap of 4. Today they squat on their heels for 0.4 to 1.1 s (a Brute 1.1 to 1.3 s) and end as a ball half their height.
- **A lethal headshot drops and then lies still.** No twitching for 3 to 4 s after it lands.
- **A round to the head of a body still stumbling drops it on that frame.** This is the owner's "the head pops, then a stagger plays".
- **Momentum survives the kill.** A body killed mid-stagger, under knockback or in the air keeps the speed it had.

**Changes, in order.** Each step's check passes before the next step starts.

**1.0 Tooling and a missing guard (no change to how anything looks)**
- Copy `tools/out/ragweight/probe.ts` to `tools/scripts/ragweight.probe.ts`.
  - Read sections from `process.env.PROBE` (comma-separated) as well as argv.
  - Write each section to `tools/out/ragweight/<section>.json`.
  - Change the `heel` rig variant to set `collider` rather than replace `hit` (see 1.1).
- Add the wrapper `tools/scripts/ragweight.test.ts`: `it.skipIf(!process.env.PROBE)('ragweight probe', () => import('./ragweight.probe'), 1_800_000)`.
- Record baselines before any `src` change: `PROBE=deaths,fixes,twitch,pose,hits,flinch`, saved as `baseline-<section>.json`.
- Add a physics guard to `src/gore/knockdown.test.ts`, called 'a body lying down reaches its wound'.
  - Setup: knockdown with topple (0, 0, -1.7), lie 2, hurt 0.6, wound `{ bone: B.thighL, point: thigh centre }`.
  - Pass: during the lying phase, one hand comes within 0.2 m of the wound.
  - Prove it bites: it must fail in a scratch copy with the arm cut at `reflex.ts:485` set to scale 1, the "broken on purpose" method in `gore.md`.

**1.1 A foot that cannot stand**
- `src/characters/rig.ts`, `BoneDef`: add `collider?: { from: Vec3Tuple; to: Vec3Tuple; radius: number }`. It is the ragdoll's collider where that differs from `hit`; hits, mass, cuts and slices keep reading `hit`.
- In `humanoidRig` `leg()`, give the foot (rig.ts:122-126, `name: footName` at 123) `collider: { from: v(0, -0.03, 0), to: v(0, -0.03, 0.001), radius: 0.05 * s }`: a heel ball under the ankle.
- `src/gore/rag.ts` `Rag.create`, in the collider loop (`const hit = defs[b]!.hit`, about line 361):
  - shape `= (RagTuning.heelFeet ? defs[b]!.collider : undefined) ?? hit`;
  - radius `shape.radius * RagTuning.colliderScale` (0.044 m, the value the probe ran);
  - mass unchanged, still the `info.volume[b]` share.
- Add `RagTuning.heelFeet: true`.
- `raycast.ts`, `rigInfo.ts`, `cut.ts` and `sliced.ts` are untouched, so feet stay shootable and shins keep their mass.

**1.2 A knee that stops where a knee stops**
- Add `MuscleTuning.kneeMarginFolded`, starting at 0.5, which is today's value.
- In `rag.ts:443-446`, use `joint.role === 'leg' ? kneeMarginFolded : hardMarginFolded` for the folded end on both `lo` and `hi`. Elbows keep 0.5.
- Sweep with the heel on: kneeMarginFolded ∈ {0.5, 0.35, 0.2, 0.1}, on drop, headshot-still and judge, for trooper and brute, 6 headings each.
- Choose the largest margin that meets all three:
  - trooper `finalHeadToFoot` ≥ 1.0 m (mean of the three kinds) and ≥ 0.85 m for each kind;
  - `onHeelsSeconds` ≤ 0.15;
  - `tKneesDown` ≤ 0.6 s.

  Expect 0.2, a stop at 2.6 rad.
- If no margin qualifies:
  - keep 0.35;
  - add a braking-only zone for knees at the folded end, `MuscleTuning.kneeFlesh: { from: 2.1, damping: 60 }`, in `MuscleState.hinge` for role `leg`;
  - give it no spring, so the `limitElasticLow` rule holds.

**1.3 A headshot falls like a sack**
- Add `GoreTuning.headshotTwitch: 0`.
- In `Gore.startRag` (`index.ts:583`), the twitch becomes `options?.twitch ?? (options?.limp ? GoreTuning.headshotTwitch : char.severed.has('head') ? 1 : 0)`.
- In `damage.ts` `kill()`, add `const HEADSHOT_TWITCH = 0` beside `SUDDEN_TWITCH`. The two headshot branches pass it in place of `SUDDEN_TWITCH`:
  - rising or floored: `this.ragdoll(e, d, force, body ? SUDDEN_TWITCH : undefined, true)`;
  - light round on a body with anatomy: `this.ragdoll(e, d, force, SUDDEN_TWITCH, true)`.
- These keep their twitch: a blade decapitation (a sever with no limp ragdoll: 1), a bleed-out (`SLOW_TWITCH` 0.45), and the collapse's own twitch.
- `muscles.test.ts:654` 'twitches only once it has landed' moves to `sever(c, 'head', ...)` plus `gore.ragdoll(c)`, so twitch timing stays guarded.

**1.4 A head round ends a collapse on that frame**
- `muscles.ts`: add public `giveUp(): void { if (this.collapse) this.endCollapse(); this.twitch = 0; }`.
- `rag.ts` `goLimp()`: call `this.muscle?.giveUp()` after `letGo()`.
  - `startRag` calls `goLimp` before `startTwitch`, so a twitch passed on purpose still starts.
  - `slack` keeps tone at 0, so nothing eases the drop.
- `Gore.damageCorpse`, right after `const drive = muscle?.collapse;`:
  - make it `let drive = muscle?.collapse ?? null; if (drive && hit.region === 'head') { target.rag!.goLimp(); drive = null; }`;
  - from there the whole round lands on the head bone, with no carry and no flinch of the animation underneath.
- `Gore.sever` (`index.ts:741`): for `region === 'head'` on a body whose muscle has a collapse, call `body.rag.goLimp()` instead of `struck(...)`.

**1.5 A collapse that carries its own weight**
- Add `MuscleTuning.trunkCut: 0`. 1 is today's behaviour: it is the share of a working drive's gravity cut that the root and spine keep.
- In `MuscleState.sampleStrengths` (`muscles.ts:1138`), set gravity scale per part:
  - legs: 1;
  - the root (`!part.parent`) and role `spine`: `1 - trunkCut * m.drive`;
  - arms and head: `1 - m.drive`, unchanged, which keeps "a working muscle carries its own weight".
- **Topple and stumble ramp in** instead of landing in one frame, by the rule that nothing a hit does to the animation may land in one frame.
  - New tuning: `MuscleTuning.toppleSeconds: 0.2` and `stumbleSeconds: 0.2`.
  - `CollapseDrive` gains `toppleLeft`, `stumbleLeft`, `toppleSpread` and `stumbleSpread`. `stumble()` and `topple()` set them instead of applying the push.
  - `sampleCollapse` spends them each frame, with `k = min(dt, left) / seconds`. Drift gets `away × stumbleSpeed × spread × k`. Each spine part gets `mass × toppleSpeed × spread × k` along `away`.
  - The totals are unchanged: 1.3 m/s and 1.6 m/s.
- **Only if the targets below miss:**
  - first, `supportFade` [0.3, 0.8] → [0.2, 0.6];
  - then `MuscleTuning.hipCarry`, a cap on the hold's upward impulse at `hipCarry × totalMass × g × support × dt`. It defaults to off; try 0.5.
  - Keep `legFade` at [0.45, 1] (fact 8).
- **Fallback** if the gravity cut is still above 0.15 of the weight: carry pairs. Each sub-step, push each driven arm or head part up by `mass × g × drive × dt` through `RagPart.push`, and the chain root down by the same. Limb weight then reaches the floor while each limb still holds itself.

**1.6 Momentum at death, and true seeds at every level of detail**
- `src/enemies/damage.ts`: export `deathVelocity(e: Enemy, out: THREE.Vector3)` = `(velocity.x + reel.x + push.x, airborne ? verticalSpeed : velocity.y, velocity.z + reel.z + push.z)`. This is the sum `knockDown` already builds at line 721.
- Use it in `ragdoll()` (593), `collapse()` (568), and both `ctx.gore.headshot(e.char, d, e.velocity)` calls in `kill()` (500, 503).
- `HumanoidAnimator.update` (628-634): a probing step uses its own `dt` and leaves the LOD accumulator for the next real frame.
  - `if (!probing) this.acc += dt;`
  - skip the `tickCount` gate when probing;
  - `const step = probing ? dt : this.acc; if (!probing) this.acc = 0;`
  - Today the probe divides by 1/90 s whatever the animator actually stepped, so bodies at LOD 1 and 2 start up to 1.7x too fast.

**1.7 Before and after**
- `?weight=0` restores today's values:
  - `heelFeet` false;
  - `kneeMarginFolded` 0.5;
  - `trunkCut` 1;
  - `headshotTwitch` 1, today's default for a headless body.

  Gore reads it, the way `muscles.ts:92` reads `?muscles=`. The ramps, the momentum and the Campaign twitch constant are not switched.
- New sandbox scenario `weight` in `src/sandbox/gore.ts`: four troopers in profile, each hit at frame 20:
  - a plain `gore.ragdoll`;
  - `gore.headshot` at 50 damage;
  - a collapse with an SMG hit (chest, 20 N·s, duration 1.1);
  - a ragdoll with a Judge chest impulse of 40 N·s.

**Acceptance.**

Probe, 6-heading means, trooper and brute (husk too for twitch). Today's value is in brackets.

| Metric | Cases | Target (today) |
|---|---|---|
| `onHeelsSeconds` | drop, headshot-still, judge | ≤ 0.15 (0.40 to 1.08; brute 1.1 to 1.3) |
| `tKneesDown` | same | ≤ 0.6 s (0.91 to 1.53) |
| `finalHeadToFoot`, trooper | same | mean ≥ 1.0 m, each ≥ 0.85 (0.87 to 1.12; heel alone 0.62 to 0.83) |
| `maxKneeFlex` | same | at least 0.15 rad below the same run at margin 0.5 |
| `tHipsFloor` | same | 0.30 to 0.50 s at gravity 19 (0.39 to 0.48) |
| `tRest01` | same | ≤ 1.8 s (1.03 to 1.95) |
| Judge kills frozen with a knee above 0.25 m | husk, trooper, brute × 6 | 0 of 18 (today one or more per archetype) |
| `lateHipsRise` | headshot, headshot-pop | ≤ 0.03 m (0.10 to 0.16, max 0.39) |
| `lateMotion` | same | ≤ 0.5 m (2.0 to 4.6) |
| `tRest01`, `tFreeze` | same | ≤ 2.0 s and ≤ 2.5 s (4.0 to 4.35 and 5.0) |
| `meanGravityScaleFirst1s` | collapse-smg, collapse-0.85, collapse-1.4 | ≥ 0.85 (0.67) |
| `weightShare.gravityCut` | same | ≤ 0.15 (0.35 to 0.39) |
| `accFirst025` | same | ≤ -2.5 m/s² (-0.64 to -2.07) |
| `comVpeak` | same | -1.5 to -2.3 m/s (-2.59 to -2.70) |
| `tKnee035` | same | ≤ 0.15 s (0.15 to 0.17) |
| End drop: largest change of centre-of-mass acceleration between 0.05 s windows after u = 0.6 | same | ≤ 6 m/s² (about 9, from -1.5 to -10 or -12, at u ≈ 0.8) |
| `tHipsFloor` | collapse at 1.1 s | within ±0.15 s of 0.94 to 0.96 |
| `footSlideRest` | collapses | ≤ 0.4 m (0.28 to 0.39) |

- **LOD.** In `tools/out/ragdoll-study/lod-probe.ts`, the worst seeded bone speed at LOD 1 and LOD 2 is within 10% of LOD 0. Today a walking Trooper reads 5.6 to 6.3 m/s at LOD 0 against 9.1 at LOD 1 and 10.5 at LOD 2.
- **Momentum.** A unit test on `deathVelocity`, using an `Enemy` from `reactions.test.ts`'s `body()` factory:
  - with reel (3, 0, 0) and push (1, 0, 0), the result is (4, 0, 0);
  - airborne with `verticalSpeed` -8, y is -8.

**Tests.** Run each file alone.
- New, `src/gore/weight.test.ts`:
  - 'a dead body does not sit on its heels';
  - 'a dead body lies at length';
  - 'a lethal headshot lies still once down': after the hips first go under 0.4 m they never rise more than 0.02 m in 3 s;
  - 'a head round ends a collapse on that frame': in the same call `collapse` is null and `slack` is true, `stats().collapses` is 0, and hips vy ≤ -1 m/s within 8 frames.
- The new knockdown guard from 1.0.
- These must pass unchanged:
  - `ragdoll.test.ts` in full: 'every fall comes to rest by itself', 'knees and elbows only fold the way they fold', 'caps simulated ragdolls and corpses';
  - `muscles.test.ts` in full except the twitch test moved in 1.3: 'holds the pose at first...', 'tracks the animation steadily: no thrashing hips, and feet that stay planted', 'stops at the cap', 'a hit while going down ends it early';
  - `knockdown.test.ts` in full (handover pop < 0.14 m);
  - `forces.test.ts` in full (bullets < 1.2 m under sustained fire; shotgun 0.8 to 2.2 m; rocket 2 to 7 m, nearer further; nuke < 9 m and < 16 m/s; dial 0 < 1.3 m).
- **"Legs keep their gravity during a collapse"**, now through a ball: over 3 rounds of 6 headings, feet slide ≤ 0.16 m in the first 0.6 s.

**Sheets**, before (`&weight=0`) and after:

```
node tools/shot.mjs --url "/?sandbox=gore&scenario=weight&arch=trooper&hold=1" --dpr 2 --w 1440 --h 900 --wait 9000 --out tools/out/weight/s1.png --eval "window.__gore.sheet([20,26,32,38,44,56,80,140,240],3)"
```

- In frames 38 to 56, no body sits upright on its heels.
- The headshot body has the same pose at 240 as at 140.
- The collapse's hips are visibly lower at 32 than at 20.

Also run `scenario=fall`, `scenario=collapse` and `scenario=stairs`, each with `&arch=husk` and `hold=1`. On the stairs, check that no foot sinks or hangs.

**In game, at dpr 2:**
- `HEAD=stand,run,crouch` with `head-seq.mjs` on `/?map=range`. In the run case the hips are below 0.45 m by step 18, which clears `gore.md`'s "can vault its planted leg".
- `REACT=dance,stagger` with `react-seq.mjs`.
- In `lab-throw`, 'SMG, kill at 8 m' stays at 0.5 to 1.0 m (0.7 today).
- `react-chaos` before and after.

**What the owner tries**, each against `&weight=0`:
- **`/`, The Crucible:** SMG a husk and a trooper dead at 6 to 10 m and watch them sink. On the next one, put a round in the head while it is still stumbling.
- **`/?map=range`, AI off:**
  - the Judge to a Trooper's chest;
  - SMG headshots on a standing Trooper and a running one;
  - the shotgun at 8 m;
  - a shotgun to the thigh to make it reel, then the SMG to kill it mid-reel (it should keep travelling).

**Frame cost.** No new bodies and no new WASM calls. The heel ball is cheaper than the capsule. Headshot bodies freeze at 1.5 to 2.3 s instead of 5 s, so a fight holds fewer live chains, at about 0.1 ms per chain. Expected 0 to -0.3 ms. Budget: +0.2 ms on `react-chaos`.

**Risks.**
- The visible foot reaches about 0.21 m ahead of the ankle with no collider under it, so toes can clip the floor on prone bodies. Stairs and slopes are untested; the stairs sheets cover them.
- The knee stop can prop a body in a kneel. At 2.45 rad it did; the sweep decides.
- With the trunk's weight on, the hold and the legs carry more, which could bring back hip thrash. The rule "in a collapse, the hold takes the reaction" is guarded by 'tracks the animation steadily'.
- Campaign headshots with anatomy lose their twitch. That follows the owner's words, "no unnecessary animation".
- Edits in `damageCorpse` and `sever` sit beside lane 2's audio lines.

**As built (2026-11-09), where it differs from the above.** Numbers are in `gore.md` and `lab.md`.
- 1.2: no knee stop. The sweep found no margin that met all three targets, and every stop and braking zone propped bodies in a kneel. The heel ships alone with `kneeMarginFolded` 0.5, so bodies end folded (Trooper head to foot 0.75 m against 0.96): the owner's call at the hand-off.
- 1.0: the knockdown guard passes at 0.4 m, not 0.2. The wound is 0.78 m from the shoulder and the wrist reaches 0.56 m; it measures 0.24 to 0.31 m, and 0.53 to 0.66 m with the arm cut.
- 1.3: the twitch default is `severed.has('head') ? (limp ? headshotTwitch : 1) : 0`, so a blade decapitation still twitches and `?weight=0` twitches exactly as before. `HEADSHOT_TWITCH` is switched too.
- 1.5: the trunk's weight goes onto the hips (raised gravity on the root, the spine's own cut as the arms'), not onto the chest. On the chest it pitched the hips up to 1.1 rad off the animation and failed 'tracks the animation steadily' one run in ten. 'holds the pose at first...' now asks for hips above 0.55 of standing height, not 0.75: the body sinks from the first frame, to 0.64 to 0.72 there. The ramps run on the collapse's own clock.
- 1.6: the probe step alone missed its target, so the animator also keeps the level of detail it last drew at and spends a far body's saved frames first (`catchUp`). `deathVelocity` keeps at most 0.6 m/s of reel and knockback, and nothing the same frame's rounds added: kept whole, the SMG kill at 8 m landed twice as far. `?weight=0` switches it, and the head round that ends a collapse, so every one of the owner's tries compares.
- Tests: 'lies still' counts from 1 s, as the probe does, since from the moment the hips pass 0.4 m it counts the landing. 'lies at length' became 'lies flat'. `fracture.test.ts` kicks the knee backward: forward, it was forced through the toe of the old foot capsule.

---

## Stage 2. Tempo: a dial for how fast a body falls

**Goal.** Let the owner pick the speed of a fall, with every throw landing where it lands today.

At 19 m/s² every gravity-driven motion plays 1.41 times faster than real. That is how a 0.95 m figure falls at real gravity: the miniature effect, which is why film shoots miniatures at 24·√scale fps. Whether a slower fall reads heavier here is a call only the owner can make in motion. This stage builds the dial and leaves the default at today's value until the owner chooses.

**Changes.**
- `RagTuning.gravityScale: 1`. A URL `?raggrav=<0.5..1>` overrides it at load. Add a getter `throwScale = Math.sqrt(gravityScale)`.
- `Rag.create`: call `.setGravityScale(RagTuning.gravityScale)` on each `RigidBodyDesc`.
- Multiply every absolute gravity write by it:
  - `muscles.ts`: `letGo` (968), `sampleStrengths` (1138), `endCollapse` (1193);
  - `reflex.ts`: `setStrengths` (485);
  - `sliced.ts`: 182 (`holdGravity`) and 248.
- Size the muscles for the weight that actually acts:
  - `muscles.ts` `WEIGHT` (409) becomes `-GRAVITY * RagTuning.gravityScale`, read in `bind()`, so load, stand stiffness, `neutralCap` and twitch torque match;
  - `crawl.ts`: multiply the crawler's lift by the scale.
- **Throw distances held.** Range is v²/g, so speeds scale by `throwScale`:
  - `Rag.radialImpulse` speeds, with `maxBlastSpeed` 10 → `10 × throwScale`;
  - `Rag.shove`, with `maxShoveSpeed` 5 → `5 × throwScale`;
  - `MuscleState.tip`, which covers the knockdown topple;
  - `MuscleTuning.toppleSpeed`;
  - `GoreTuning.gibSpeedMin` and `gibSpeedMax`.

  Bullet impulses on the bone do not change.
- **Grip held.** `startRag` friction (`index.ts:567`) 0.72 → `min(1.2, 0.72 / gravityScale)`, so friction times g stays 13.7 m/s² (`gore.md` Forces).
- **Landing thresholds scaled by `throwScale`:**
  - `ReflexTuning.landSpeed` (2.4) and `stunThud` (1.4);
  - `ImpactTuning` min/full in `impacts.ts`. These pick the landing sounds, so tell lane 2.
- **Airborne kills.** A chain seeded with |vy| > 2 m/s keeps scale 1 until its first thud (`rag.thud / rag.mass > 0.5`), then takes `gravityScale`. Otherwise a Leaper shot falling at 28 m/s² hangs.
- **Chunks** stay at world gravity.

**Acceptance**, at 0.75 and at 0.6, with stage 1 in.
- Probe, drop, headshot-still and judge:
  - at 0.6: `tHipsFloor` 0.36 to 0.58 s (the heel at 11 m/s² measured 0.38 to 0.52), `accFirst025` -7.5 to -10 (measured -8.7 to -8.8);
  - at 0.75: `tHipsFloor` 0.33 to 0.52 s (the heel at 13 measured 0.37 to 0.46), `accFirst025` -9.5 to -12 (measured -10.5);
  - at both: `reboundHips` ≤ 0.1 m, `lyingSlide` ≤ 0.2 m, `tRest01` ≤ 2.2 s.
- Probe, collapse-smg:
  - `footSlideRest` ≤ 0.45 m. The heel at 11 with no friction change slid 0.49 to 0.74 m, so this checks the grip compensation;
  - feet slide ≤ 0.16 m in the first 0.6 s, over 3 rounds of 6 headings.
- **Tests.**
  - `forces.test.ts` passes at 1, 0.75 and 0.6. Add `describe.each([1, 0.75, 0.6])` that sets `RagTuning.gravityScale`. The bands do not change.
  - `knockdown.test.ts` passes at 0.6.
  - New in `ragdoll.test.ts`: 'no part outweighs the dial'. Through a knockdown, a collapse, `letGo` and `endCollapse`, every part's `gravityScale()` stays ≤ `RagTuning.gravityScale`. This catches any write that was not multiplied.
- **In game, `&raggrav=0.6`.** These rows of `lab.md` "After the blast rings" hold within ±15%:
  - rocket, floor 2 m away: 5.8 to 6.9 m;
  - rocket survivor at 4 m: 3.2 to 4.2 m;
  - grenade, floor 2 m away: 4.8 m;
  - shotgun at 2 m: 1.2 to 2.4 m.

  Report the airtime; expect 1.29x at 0.6.
- **Sheets**, with and without `&raggrav=0.6`: `scenario=weight` and `scenario=blast` at `[20,26,35,52,90,180]`.

**What the owner tries.** Three tabs: `/?map=range`, `/?map=range&raggrav=0.75` and `/?map=range&raggrav=0.6`.
- the Judge to the chest;
- an SMG headshot;
- the shotgun at 2 m;
- a rocket 4 m from a pair;
- a Leaper killed mid-leap;
- on `/?raggrav=0.6`, a grenade into a Crucible pack.

The owner then picks 1, 0.75 or 0.6, and that value becomes the default in one line.

**Frame cost.** 0. The scale is set once per part when a chain is built, and the per-frame calls already exist.

**Risks.**
- A corpse at 11.4 m/s² next to a player at 32 and living enemies at 28 may read as slow motion.
- Chunks fall faster than the limbs beside them; judge it on the explosion sheet.
- A write that misses the scale snaps a body back to 19. The new test covers it.
- Airtime grows.
- `ImpactTuning` belongs to lane 2's sounds.

**As built (2026-11-09), where it differs from the above.** Numbers are in `gore.md` (Forces, Measured, Known limitations) and `lab.md`.
- The dial lives on each chain. `Rag.gravity` is the share a chain falls under and `Rag.throwScale` its square root; every write and every throw reads those, not `RagTuning.gravityScale`, because a chain killed in the air is on 1 until it lands. A getter on `RagTuning` would also have broken the probe's `Object.assign` restores. Muscles are sized from `Rag.gravity` in `bind()` and reweighed when a chain lands.
- 'no part outweighs the dial' holds jointed parts to the dial and the chain to the dial's weight in total, not every part: since stage 1 a collapse's hips carry the trunk's weight, above 1 on purpose.
- Grip is not held: friction stays 0.72 and comes down with the weight, so a throw slowed by the square root slides about as far. The plan's `min(1.2, 0.72 / dial)` measured no better for a collapse's feet (nor held only during a collapse), sat Judge kills on their heels longer and stopped a sandbox throw 13% short.
- Rounds are slowed too, against the plan: a round's share on the bone (`applyImpulse`) and a limb's spin (`kick`) take `throwScale`, like every other push. At full speed on the dial they sat Judge kills on their heels 0.46 to 0.66 s at 0.6, failing `weight.test` every run, and walked a corpse under the SMG 0.51 m against 0.28. Jolts are not slowed: they are torque across joints, and slowed they only pushed knockdown.test's 'jerks a dying body about' toward its line.
- A body killed in the air takes the dial when the floor gives back upward speed in a frame with nothing pushing it (`Rag.pushed`), not on any loss of momentum: that read gravity on a rising body in a 30 fps frame, and a round against a falling body's motion, as landings. A limb cut from a chain takes that chain's state (`RagBuild.lofted`).
- `ImpactTuning` is untouched: chunks report through it at world gravity. Gore reads a chain's landing speeds over `throwScale` instead, at `hear`, a loose limb's splat and a sliced half's thud. A gib scales its limbs' launch only, since `launch` also flings the chunks.
- Proof at 1: twenty-one deaths, every bone, on a fixed random stream, identical to the bit against the code before the dial, and again after the fix round with a second harness.
- Acceptance at 0.75 and 0.6: hips on the floor, first 0.25 s, at rest, slide once lying, the blast rows and airtime pass; `forces.test` passes at all three dials and `weight.test`'s heels at 0.75 and 0.6. Misses: hips rebound up to 0.18 and 0.20 m on a Brute (0.13 at 1) and 0.12 on a Trooper at 0.6; a collapse's feet in the first 0.6 s, a Trooper 0.18 and 0.23 m (0.13 at 1), a Brute 0.18 at 0.6; a Brute collapse's feet at rest 0.41 m on average, single rounds to 0.55. `knockdown.test` at 0.6 failed 1 run in 80, 'jerks a dying body about' at 1.21 against 1.3. More bodies end with a knee up, 4 to 8 of 84 at 1 against 9 to 14 at 0.6, mostly Brutes: the resting-pose pull holds them (0 and 1 of 84 with `neutralCap` 0), the owner's call. The speed a body dies with carries it further (1.17 m against 0.95 at 2 m/s), which is likely why the shotgun at 2 m goes 2.67 m against 2.29 in the game.
- `knockdown.test.ts` 'does not hurry a collapse along' failed 3 of 30 runs on the stage 1 code: a body sinking under its weight bows its head into the chest fire, and a head round now ends a collapse. Its fire skips head hits; 60 of 60 pass.
- Not covered: the call-ins push bodies directly, and `Physics.radialImpulse` throws hard-limit bodies (`muscles=0`) and sliced halves, at full speed.

---

## Stage 3. Hits with mass, and nothing freezes in the air

**Goal.** A round shows the mass of what it hits.

- A Brute's or a Juggernaut's limbs go with its trunk under rounds and blasts. Today one SMG round on a downed Juggernaut moves its hand 1.18 m.
- A corpse's forearm no longer flips from one round.
- A standing Trooper rocks with an SMG round and comes back without a wobble, and the Judge still rocks a man.
- A grenade into a big crowd never freezes a fresh body standing or in mid-air.

**Changes.**
- **Jolts scale with mass.** In `index.ts`, `joltOf(force)` (110) becomes `joltOf(force, mass)`: the same value times `Math.min(1.3, (HUMAN_MASS / mass) ** MuscleTuning.joltMassExp)`. `joltMassExp` is 0.75 (range 0.5 to 1), and `HUMAN_MASS` is imported from `rigInfo.ts`. The call sites are `beginCollapse` (`info.mass`), `strikeDown` (`rag.info.mass`) and `damageCorpse` (`target.info.mass`).
- **Blast kicks scale with mass.** In `throwFromBlast` (1289), multiply the kick by `Math.min(1.3, HUMAN_MASS / rag.info.mass)`.
- **One impulse moves a limb less.** `RagTuning.maxImpulseSpeed` 9 → 6. Today a 20 N·s round puts 8.7 m/s on a 2.3 kg forearm.
- **A smaller living flinch.** In `damage.ts` `react()` (606), `clamp(0.35 + frac * 3, 0.35, 1.6)` becomes `clamp(0.2 + frac * 2.2, 0.2, 1.4)`. No mass factor is added (fact 9).
- **Flinches that settle instead of ringing.** The `HumanoidAnimator` springs at 318-321:
  - spine (170, 13) → (110, 17);
  - chest (210, 15) → (130, 19);
  - head (240, 13) → (160, 15);
  - pelvis (180, 15) → (120, 18).

  Damping goes from a ratio of about 0.5 to 0.6 to 0.83, so a flinch lands, leans and comes back without rebounding.
- **`enforceBudget`** (`index.ts:599`):
  - never freeze a body younger than `GoreTuning.freezeMinAge: 0.6` s, or one moving faster than 1 m/s (`rag.speed`);
  - if nothing qualifies, allow `GoreTuning.maxRagdollsOver: 4` more chains for at most 1 s, checked again in `update()`, then freeze the oldest that qualifies by age.

**Acceptance.**
- **Probe, `hits`.** Hand travel after one SMG round on a downed body:
  - Juggernaut ≤ 0.45 m (1.18);
  - Brute ≤ 0.3 m (0.38);
  - Trooper 0.15 to 0.25 m (0.22);
  - Husk 0.06 to 0.11 m (0.085).
- One SMG round on a lying forearm moves the hand ≤ 0.2 m (0.08 to 0.32).
- **Rocket at 3 m on corpses.** Peak hand speed over hips speed ≤ 1.8 for husk, brute and juggernaut (1.35, 1.6, 3.2). Hips peak speeds within ±10% of today's (8.6, 4.8, 1.4 m/s).
- **Probe, `flinch`.** Chest tilt from one SMG round:
  - Trooper 0.15 to 0.2 rad (0.26);
  - Husk ≤ 0.24 rad (0.32);
  - Brute ≤ 0.06 rad (0.076).

  Overshoot past rest ≤ 5% of the peak (about 16% today), and back within 0.02 rad by 0.5 s. One Judge round on a Trooper still gives ≥ 0.22 rad.
- **Tests.** `forces.test.ts` unchanged. `knockdown.test.ts` 'jerks a dying body about far more than a quiet death'. `ragdoll.test.ts` 'caps simulated ragdolls and corpses, oldest out', updated only for the age rule.
- **New, `ragdoll.test.ts`: 'a blast at the cap freezes nothing in the air'.** With 12 knockdowns and 4 collapses running, 6 bodies die in one frame.
  - No body freezes with its hips above 0.5 m or its speed above 1 m/s.
  - Live chains stay ≤ 18, and are back to ≤ 14 within 1.1 s.
- **In game, at dpr 2:**
  - `lab-throw` 'Shotgun, 2 m' stays at 1.2 to 2.4 m;
  - `BLAST_TRIES=4` `blast-seq.mjs` with a crowd of 16 leaves no frozen standing body;
  - `react-chaos` stays within its budget.

**What the owner tries** on `/?map=range`:
- the SMG on a standing Trooper and a Brute side by side;
- the Judge on a Trooper;
- rockets at a Brute and a Juggernaut;
- the SMG on a corpse's arm;
- a grenade into 16 Husks.

**Frame cost.** Nothing per hit. The budget overflow holds at most 4 extra chains for at most 1 s, about +0.4 ms in the worst frame. Budget: +0.4 ms on the `react-chaos` peak.

**Risks.**
- The flinch springs also carry the enemies' firing recoil (`play('shoot')` kicks the chest spring by -1.1, line 415), so every enemy gun looks different.
- A Brute or a Juggernaut could look unhit. The 1.3 cap and the 0.75 exponent are there for that.
- `maxImpulseSpeed` 6 also caps the part of pellet and Judge hits that stays on the limb, so the shotgun bands must hold.
- The `damageCorpse` edit sits beside lane 2's audio lines.

**As built (2026-11-10), where it differs from the above.** Numbers are in `gore.md` (Taking rounds, The ragdoll budget, Forces, Measured, Known limitations) and `lab.md`.
- A switch, `?mass=0`, puts back all of it: `MASS_PASS` in `muscles.ts`, read by `damage.ts`; the animator reads the same flag for `FlinchSprings`, since characters do not import gore. A blast's spin has its own exponent, `MuscleTuning.blastMassExp` (1), so the switch and the probe can turn it. `Reflex.struck` in `strikeDown` keeps the unscaled jolt: how long a round keeps a body down is stage 5's.
- `enforceBudget`: the plan's rule, built first as written, froze grenade-thrown bodies 1.4 m up. With twelve knockdowns and four collapses running (never frozen) and six killed, 22 chains were over its 18, so four froze on age alone at 0.6 s, when a grenade's throw is still in the air; its one clock for the whole budget had been started by the knockdowns, so the other two froze at 0.8 s, 0.1 to 0.25 m up at 9 to 11 m/s, and a collapse ending over the budget froze while still dropping at 2.3 m/s. Its new test also cannot pass as written: 16 unfreezable plus 6 dead is 22 whatever the budget does, so "≤ 18" means freezing four of the six in the air, and "≤ 14 within 1.1 s" cannot happen while the knockdowns lie. Built instead: the time is each body's own, from its death, its waking or the end of its collapse (which is where a slow death's fall starts), stretched by the tempo dial's pace. At rest (0.6 s and under 1 m/s) it may freeze; still moving, it gets `overSeconds` (1 s) more; younger, never. There is no `maxRagdollsOver`: a burst runs over the budget until its bodies are at rest, 1.6 s at most. The test asserts that: no freeze with the hips above 0.5 m, no budget freeze under 0.6 s into a fall nor above 1 m/s before 1.6 s, back inside the budget once each has had its time, and the same when collapses end over the budget. It fails on the old budget, on age alone, and on a collapse dated from its death.
- 'a corpse shot at the ragdoll budget wakes and stays awake' is updated for the age rule too: the fourteen it is shot among died a frame earlier, so for a moment there are fifteen.
- The `hits` acceptance is measured by a new probe section, `hitmass`, over 24 bodies a case. The plan's figures were single runs: the downed Juggernaut's 1.18 m is the fall from the knockdown (unshot, its hand moves 0.42 m in the same 0.3 s), and the forearm's 0.08 to 0.32 m were rays that struck other bones. So the targets are read as what the round adds, on a body lying still, and on rays that land on the forearm.
- The flinch section now reads the tilt against an unhit twin, signed, so overshoot is measurable.

**Acceptance, as measured.**
- Hand travel, one SMG round on a downed body, as the plan measured it (right hand, 0.3 s, shot 1.2 s after the knockdown): Juggernaut 0.39 m (≤ 0.45, but 0.43 before and 0.42 unshot), Brute 0.17 (≤ 0.3), Trooper 0.10 (0.15 to 0.25: miss, 0.10 before), Husk 0.18 (0.06 to 0.11: miss, 0.17 before). What the round adds on a body lying still: Juggernaut 0.03 m against 0.15, Brute 0.03 against 0.08, Trooper and Husk unchanged at 0.07.
- One SMG round on a lying forearm: the hand ends ≤ 0.09 m away (≤ 0.2: pass; 0.15 before).
- Rocket at 3 m, fastest hand over fastest hips: Husk 1.35, Brute 1.68, Juggernaut 1.98, 1.81 for the right hand the plan measured (≤ 1.8: pass, pass, narrow miss). Hips 8.57, 4.55, 1.53 m/s against 8.58, 4.50, 1.37 (±10%: pass, pass, +12% miss; +9.5% against the plan's 1.4).
- Flinch: Trooper 0.164 rad (0.15 to 0.2: pass), Husk 0.242 (≤ 0.24: narrow miss), Brute 0.045 (≤ 0.06: pass), overshoot under 1% (≤ 5%: pass), within 0.02 rad by 0.35 to 0.38 s (by 0.5 s: pass), Judge on a Trooper 0.233 (≥ 0.22: pass).
- Tests: `forces.test.ts` unchanged and passing; `knockdown.test.ts` whole, 'jerks a dying body about' included, eight runs of eight; `ragdoll.test.ts` with the new test, 32 runs of 32 for the new test.
- In the game: shotgun at 2 m 1.78 m on average (1.2 to 2.4: pass on the mean, four of 28 under 1.2; 2.35 with `?mass=0`); a grenade into 16 froze nothing standing in eight tries (four of eight with `?mass=0`); `react-chaos` step peak 8.8 ms on average against 9.4 (budget +0.4: pass), every survivor up, no errors.

**Fix round (2026-11-10), after an independent measurement and a review.**
- The measurement, seeded, 36 bodies a case, mostly agrees: downed-body hand travel Juggernaut 0.43 m (≤ 0.45), Brute 0.21 (≤ 0.3), Trooper 0.10 and Husk 0.16 outside their bands but the same as before the stage (the bands were wrong, not the code); forearm 0.175 m at most (≤ 0.2, and 0.181 before); rocket right hand over hips 1.33, 1.59, 1.76 (≤ 1.8), fastest of either hand 1.38, 1.68, 1.93; hips +0.1%, +0.8%, +8.8% (±10%); flinch Trooper 0.164, Husk 0.242 (≤ 0.24, a miss by 0.002 left as the plan's own sizes give it), Brute 0.045, Judge 0.233, chest overshoot under 1%, back within 0.02 rad by 0.35 to 0.38 s; shotgun at 2 m 1.86 m over 30 (2.43 with `?mass=0`); `react-chaos` +0.25 ms. `?mass=0` is byte-identical to the code before the stage on the probe's `flinch` and `hitmass` and on a 26-scenario rigid-body hash, and still is after this round.
- Fixed: a throw or a round on a body already simulating starts its budget time again (a second grenade 0.9 s after the first had a corpse frozen 1.4 to 2.3 m up; a corpse under fire froze and woke every 0.6 s, a pool each time). The out-of-time rule frees a body only once its centre of mass is under 1 m/s (`Rag.massSpeed`), so nothing falling or flying freezes for it. New test, 'a body thrown or shot again starts its time over', last in `ragdoll.test.ts`: there, the tempo dial's 'only the floor ends a fall' test, which lands over its 0.6 m in 7 to 9 draws of 40 before this stage too, kept failing one run in two behind it.
- Fixed: the animation flinch under a collapse takes a man's jolt, not the mass-scaled one, since the animator sizes it by build; a blast's spin on a loose limb is not mass-scaled (its rig's mass is the whole body's); a drone's and a skitter's living flinch keep the old size, as their animators size nothing by build and their springs were not retuned. None of the three changes a humanoid acceptance figure.
- Not built: a ceiling over the budget. Freezing what was down past 22 chains whatever its speed froze bodies at 10 m/s the frame they hit the floor, which breaks this stage's own rule, and freezing what was down with only a limb moving cut a grenade into 30 by about a tenth and froze arms mid-swing. So a big burst runs as many chains as it kills for about a second: in Chrome a grenade into 30 held 26 to 27 for about 1.7 s, step plus gore 5.3 to 5.9 ms at the 99th percentile against 4.1 to 4.2 (the plan's "+0.4 ms worst frame" holds for `react-chaos`, not for that). The owner should try a Crucible-sized wave on the M1.
- The test's chain targets (≤ 18, ≤ 14 within 1.1 s) stay unmet by design, for the reason above; what it asserts instead needs the plan owner's nod.
- After the round: `ragdoll.test.ts` 33 of 33, ten whole-file runs of ten; `knockdown` 22, five runs; `weight` 7, three runs; `forces` 24, `muscles` 41, `reactions` 17, `blast` 11, once each; tsc clean. A grenade into 16 Troopers, four tries: nothing frozen above 0.19 m or before 0.63 s. `react-chaos` three each way: 8.1 ms against 8.6, every survivor up, no errors.

---

## Stage 4. Knocked over

**Goal.**
- Running into a light enemy at speed knocks it off its feet along the run, carrying the player's momentum, and it then gets up. A slide sweeps its legs.
- Every non-fatal head hit from a real gun puts the body down, not only the shotgun. That is the owner's rule.
- A shotgun or a heavy round to the head knocks the body out: the head whips back, the arms go slack, and it lands like a sack, alive.
- Every knockdown lands like a weight: the arms brace and then give.
- Blast survivors keep their hands over their heads through the flight.

**Changes.**

**4.1 The body check.**
- In `contact.ts`, line 167 becomes `w.enemies.model.bodyCheck(e, _v, closing, w.ctx.player.sliding)`. `EnemyManager.ts` is not edited.
- `contact.ts` gains `CHECK_FROM = 9.5`, `CHECK_FULL = 13` and `CHECK_CARRY = 3.5` (all m/s).
- New `DamageModel.bodyCheck(e, dir, closing, sliding)`:
  - With no profile (bosses and machines), it does what it does today.
  - `s = checkStrength(closing, e.def.mass, sliding)`, a pure function exported for tests: `smoothstep(9.5, 13, closing) × (1 - mass)`, plus 0.4 when sliding.
  - If s < 0.3, today's 0.4 s stagger runs for mass < 0.5.
  - Otherwise clamp `e.push` to `CHECK_CARRY`, then call `knockDown`, struck at `B.thighL` on a slide and `B.chest` otherwise:
    - standing: topple `dir × lerp(1.8, 2.8, s)`;
    - sliding: topple `dir × -1.2` with impact `{ dir, 0.8 }`, so the legs go with the player and the body goes over backwards.
- `knockDown` gains an options argument `{ topple?: THREE.Vector3 | null; impact?: number; stumble?: number }`. Null means no tip and no plank. `stumble` is used in stage 6.
- The contact trauma (0.06 + 0.1 × mass) stays, plus 0.06 on a knockdown.
- Correct the `contact.ts` header and `enemies.md:193`.

**4.2 Head hits.**
- `reactions.ts` `knocksOut(d, region, force)` becomes `region === 'head' && d.type !== 'explosive' && (d.type === 'pellet' || d.amount >= HEAVY_ROUND || force >= HEAD_KNOCK_FORCE)`.
  - `HEAD_KNOCK_FORCE` is 15 N·s, so the SMG (20) counts and the Buzzsaw (6) and Kiln (1) do not.
  - Strength stays at `HEAD_KNOCK` 0.7 for pellets and heavy rounds. Everything else gets `HEAD_KNOCK_LIGHT` 0.5, which tips the body over at 1.7 m/s.
  - In Campaign it still reaches only glances and helmets, because a clean head hit there is always lethal.
- **Knocked out.** Pellets and heavy rounds pass `KnockdownOptions.knockout: true`.
  - On the hit frame, `muscle.jolt(headBone, point, dir, 1)`.
  - The Reflex holds head drive at 0 for 0.25 s, then goes back to its table.
  - Arm drive is capped at 0.1 for `koSeconds` 0.6 s: no brace and no guard.
  - `plankSeconds` is 0.25 instead of 0.42.
  - `damage.ts` multiplies `lie` by 1.5 and sets a daze at hand-back.

**4.3 Landing like a weight.**
- **The brace gives.** In `reflex.ts` `poseFall`, once a hand is within 0.08 m of `groundY` while the chest is still falling:
  - the elbow target eases from `braceElbow` 0.3 to `yieldElbow` 1.3 over `yieldSeconds` 0.18 s;
  - `braceGain` 5 drops to `yieldGain` 2.
- **Arm weight in the fall.** Add `ReflexTuning.fallCarry`, the share of the arm and head gravity cut kept in the `fall` phase. Today it is effectively 1: the arms fall at 25% of gravity and the head at 40%. Sweep 1, 0.5 and 0, and take the lowest that still gets the hands down before the chest in ≥ 6 of 8 topples.
- **Blast survivors guard their heads.** `guardHold` changes from 0.2 s to holding while the hips are above `landHeight × standHips` and vy > -2 m/s, for at most 0.6 s.

**Acceptance.**
- **New `src/enemies/contact.test.ts`**, on `checkStrength`:
  - 12.5 m/s into mass 0 knocks down; 9.2 m/s staggers;
  - a Riot (0.35) at 12.5 knocks down;
  - a Brute (0.8) never does;
  - a slide at 10 m/s knocks down mass 0.
- **`reactions.test.ts`.** Two tests are rewritten: 'a head hit that does not kill always rattles them' (90) and 'a light round to the head keeps the stun...' (103).
  - A non-lethal SMG head hit on a Trooper is `felled`, at strength ≥ 0.5.
  - A Buzzsaw head hit staggers.
  - A legless body flinches.
  - Bosses and machines are unchanged.
- **New, `knockdown.test.ts`:**
  - 'knocked out lands like a sack': the chest reaches the floor before either hand in ≥ 3 of 4 headings, and the head pitches back ≥ 0.4 rad relative to the chest within 0.1 s;
  - 'a braced fall gives': elbow flex is ≥ 0.9 rad by 0.2 s after the first hand contact, and the chest's descent 0.1 s after contact is 30 to 60% slower than at contact;
  - 'is thrown, lands and gets up' still passes, and the hands are within 0.25 m of the head for ≥ 0.3 s of the flight;
  - the four existing headings still pass (pop < 0.14 m).
- **`lab-contact.mjs`, new case `knock`**, at dpr 2. A bot runs at 12.5 m/s into a standing Trooper and into a Husk, 10 runs each.
  - Each is downed in ≥ 9 of 10 runs.
  - The hips come to rest 1.0 to 2.5 m along the run.
  - The player keeps ≥ 11 m/s.
- **`lab-contact.mjs`, 'run into a pack, 11 husks and a Brute':**
  - ≥ 6 Husks down;
  - the player carries on ≥ 10 m past the Brute (13 m today);
  - knockdowns ≤ 12;
  - physics peak within +1.0 ms of the same-session baseline;
  - the Brute, Juggernaut and Titan rows unchanged.
- `forces.test.ts` bands hold. In `blast-seq`, a rocket survivor at 4 m is still thrown 3.2 to 4.2 m (±15%).
- **New sandbox scenario `knock`.** Three husks:
  - a body check (velocity 3 m/s, topple 2.4);
  - a head knock-out;
  - a blast survivor at 3 m.

  Sheet frames: `[20,24,28,33,40,48,58,70,90,120,160,220]`.

**What the owner tries.**
- **`/?map=range`, AI on patrol:**
  - sprint into a Trooper;
  - slide into a Husk;
  - one SMG round to a Trooper's head;
  - the shotgun to a Trooper's head at 15 m (one pellet, non-lethal);
  - a grenade into six at 4 to 5 m.
- **`/`:** charge a pack of Husks.

**Frame cost.** No new kinds of chain. A charge can put up to about 11 bodies down at once, inside `maxKnockdowns` 12, which is the load of the crowd test. Husks lie only 0.1 to 0.35 s. Budget: +1.0 ms on the `react-chaos` and pack-charge peaks.

**Risks.**
- **Difficulty.** SMG head knockdowns and charges add downtime, so the owner should confirm them. The first SMG headshot on a Trooper now floors it (the head pool of 59.5 survives the 50 of one round).
- A charge spends knockdown slots, so a grenade straight after it may only stagger some survivors.
- The player still walks through bodies that are down.
- A topple of up to 2.8 m/s is more than the 2.2 of shots, against the history of "ridiculous" throws. `CHECK_CARRY` and the topple range are the knobs.
- `fallCarry` below 1 could weaken the brace; the 6-of-8 rule guards it.

**As built (2026-11-10), where it differs from the above.** Numbers are in `gore.md` (Knockdown and getting up, What has to stay true, Measured, Known limitations), `enemies.md` (Decisions, Hit reactions) and `lab.md` (Contact, measured).
- **Owner's decision on question 2:** every non-fatal head hit from a real gun floors the body, the SMG included, behind one knob, `HEAD_KNOCK_FORCE` (15 N·s) in `reactions.ts`; above 20 leaves the SMG out. Bosses and machines keep `poise`.
- **A switch, `?knock=0`** (`KNOCK_PASS` in `muscles.ts`), puts back running into a body as a stagger, the old head rule, no knockout, the stiff brace, `fallCarry` 1 and the 0.2 s guard. On it, lab-contact matches the code before: 0 of 10 sprints down, the same heavy rows.
- **`EnemyManager.ts` is edited, one line.** The plan said it need not be. A body check runs inside `updateEnemy`, which went on to place and animate the body; the animator wrote the hips bone, gore took the instance for one the library had taken back, and let go the same frame. In the game 0 of 20 sprints knocked a body down although every `gore.knockdown` returned true. `updateEnemy` now returns once `e.downed` is set, as it already did after a fall.
- **`checkStrength`:** the slide's 0.4 is times `1 - mass` too. As written, a Brute on a slide scored 0.4 or more, against the plan's own "a Brute never does". The contact flinch is skipped when the body goes down: its spring speed would be read into the throw.
- **`knockDown`'s options** are `{ topple, impact, knockout, point }`. Null topple and `stumble` are left to the stages that use them. A slide's knockdown runs back along the slide, so its `impact` throws the arms back and the legs on with the player: `kick` sends legs against its direction, so `impact { dir, 0.8 }` as written would have thrown the legs back at the player.
- **Knocked cold:** `muscle.jolt(head, ...)` whipped the chest back 0.6 to 0.8 rad on the hips in two frames and left the head nodding against it. The neck is snapped alone instead (`MuscleState.whip`, `ReflexTuning.koWhip` 24 rad/s, times the body's jolt share): 0.50 to 1.0 rad along the shot within 0.1 s over 32 bodies. 'Chest on the floor before either hand in 3 of 4' is not met, 0 of 32: slack arms hang at the hips and a crumpling body drops onto them. The test asserts the snap, the slack neck and arms, and that it gets up.
- **The brace gives** as specified, but the plan's chest measure cannot be met by it or by the brace before it: the arms carry a few kilograms against an 85 kg trunk, so the chest is as fast or faster 0.1 s after the hand lands (0.3 to 1.8 times). The elbow at 0.2 s is 0.9 rad or more in 28 of 30 forward falls; the old brace bends about as much, so that test guards the outcome and does not tell them apart.
- **`fallCarry` is 0.5, not the sweep's literal pick.** Hands down before the chest: 1 gave 5 or 6 of 8 a round, 0.5 6 to 8 over ten rounds, 0 7 or 8. Heavier arms get there first because they fall, not because they brace, so the rule picks 0; at 0 the elbows folded flat under the body (2.2 to 2.5 rad) and one or two forward falls in nine rolled onto the back, the weakened brace the rule was meant to stop.
- **The guard** holds as specified, but the arms wake 0.07 s after the hit and are strong by about 0.2 s, and the arm on the blast's side is thrown off: one hand at the face for 0.22 to 0.38 s at 3 m from a rocket (0.17 on average before), both at once 0.15 s at most, and none at all from 'is thrown, lands and gets up's own weak blast, before or after. The new test throws six survivors 3 m from a rocket instead. Three times the arm strength while guarding added 0.07 s, inside the noise, and was left out.
- **The pack row** cannot reach 6 husks down: its front row leaves the run's line open and the player meets two husks 0.6 m off the middle at about 9 m/s closing, where a body check needs about 0.43 m at 12.5 m/s. The row is kept as it was; a new `charge` row, six husks in the run's lane from 23 m, puts all six down.
- Found, not fixed: a body that falls on its side and gets up face up can lose its left wrist for a frame 0.3 s into the clip, 0.37 to 0.78 m, on the code before as well (3 of 24 sideways knockdowns). It is in the get-up animation.

**Acceptance, as measured.**
- `contact.test.ts` 4 of 4, `reactions.test.ts` 17 of 17, `knockdown.test.ts` 25 of 25 in four runs of four; on a copy of the code before, the knocked-cold and the rocket-guard tests fail four runs of four, the brace test passes.
- Must-pass, once each: `forces.test.ts` 24, `muscles.test.ts` 41, `ragdoll.test.ts` 33, `weight.test.ts` 7, `blast.test.ts` 11, `fracture.test.ts` 3, `gore/wounds.test.ts` 14, `enemies/wounds/wounds.test.ts` 26, `rules.test.ts` 24, `outpost.test.ts` 16, `crucible.test.ts` 15. `tsc` clean.
- `lab-contact` `knock`: Trooper and Husk down 10 of 10 each (target 9 of 10), hips at rest 1.47 to 1.70 m along the run (1.0 to 2.5), the player never under 12.5 m/s (11).
- 'Run into a pack': 0 husks down (target 6, see above), 12.5 m past the Brute (10; 12.5 before), 0 knockdowns, step peak 0.2 ms as before. `charge`: 6 down, 6 knockdowns (12), 12.5 m past the Brute, step peak 9.3 ms against 0.2 with nobody down (+1.0: miss), 0.9 median and 1.5 at the 90th percentile while they are down. Brute, Juggernaut and Titan rows unchanged.
- `forces.test.ts` bands hold. Rocket survivor 4 m off: 4.25 to 4.95 m against 4.54 to 4.94 with `?knock=0`, six each (within 15%; the plan's 3.2 to 4.2 predates the weight pass, which moved it to about 4.8).
- `react-chaos`, five each: step peak mean 11.3 ms, median 10.3, against 9.8 and 9.2 (+1.0: +1.5 on the mean, +1.1 on the median, inside a run-to-run spread of 8.6 to 15.5), CPU a frame 4.5 against 4.6, every survivor up, no errors.
- Sandbox `knock` sheets with and without `&knock=0`: no console errors; the knocked-cold head is back by frame 28 to 33 where it stays upright before, the checked body goes over backwards in one piece, and all three are standing by frame 220.

**Fix round (2026-11-10), after an independent measurement and a review.**
- **A head hit that floors a body no longer flinches the animator first.** `DamageModel.react` flinched the head at `flinchSize` and `respond` raised the guard, then the same frame `knockDown` read both into the ragdoll (gore.md, nothing a hit does to the animation may land in one frame). Every acceptance number above called `gore.knockdown` directly, so none saw it. `respond` now decides first and flinches only a body that stays up, as `contact.ts` does for a body check. In the game, `?map=range`, four each: an SMG round to a Trooper's head started the ragdoll's head at 15.4 to 15.8 rad/s against its parent, now 0.6 to 1.5; a knocked-cold head turns 0.53 to 0.64 rad in 0.1 s, the whip alone, against 0.74 to 0.80 with the flinch on top. The guard's arm speed (10 to 12 m/s in a headless probe with no gun in hand) does not show on a Trooper holding one: 2.9 to 3.1 m/s either way. With `?knock=0`, as before.
- **A head hit gore has no room for** (twelve down, or `?muscles=0`) staggers as before, but inside the cooldown or a get-up it flinches, as any other hit would there. Before, every SMG round to the head restarted a full stagger and added to the reel. Four SMG rounds 0.1 s apart into a Brute's head with `?muscles=0`: the first staggers it 1.05 s and the other three add nothing, 0.56 m moved and 1.3 m/s of reel at most; with `?knock=0` 0.39 m and 0.86.
- **A refused body check keeps a fall the body had coming** (`e.fallIn`, which `knockDown` clears on a refusal).
- **The slide's 0.4 comes in from 0 to `CHECK_FROM` closing.** It took any light body within reach, even one met 0.8 m off the line or walking into the slide from the side. A 10 m/s slide now takes a light body within about 0.65 m of its middle; head on it is as before (`contact.test.ts`, a new test; in the game, a slide into a Husk down 4 of 4, 1.07 to 1.27 m along it).
- **The brace test now fails on the old brace.** It also reads what the reflex asks of the landing hand's elbow: 1.0 to 1.3 rad in 4 to 6 falls of 8 (`yieldElbow`), and never past 0.47 with `?knock=0`. With the switch off, all three new knockdown tests fail.
- **Knocked cold, still not like a sack by the plan's measure.** The chest lands 0.03 s after a plain knockdown's on average (frame 29 against 27, eight headings), and a fall forward can kneel 0.4 m up for half a second either way. Hanging the slack arms bent along the trunk, as the measurement suggested, made it 0.06 s later and was taken out. Left for the owner to judge in play.
- **Not changed, and why.** The pack row's "6 husks down" cannot be met by any tuning: a straight run reaches only two of its husks (the front row is 1.2 m out, past a husk's 0.87 m reach), so `charge` stands in for it. The charge's 9.3 ms peak is six new chains, the first in a session: six Troopers floored in one frame by pellets cost the same with `?knock=0` (7.0 to 7.2 ms the first time, 2.5 to 3.2 after, 1.5 at the 90th percentile). The stage adds knockdowns, not cost to each. The wrist pop at a sideways get-up is in the get-up animation and was there before (3 of 24 plain sideways knockdowns on the copy of the code before). Only one hand reaches the face in a blast's flight: a physical limit measured above.
- **Re-measured.** `react-chaos`, three pairs, load 5.5 to 8.6: step peak mean 9.1 and median 9.4 ms against 9.3 and 8.8 (inside +1.0), CPU 4.9 against 6.0 ms, every survivor up, no errors. In the game: SMG to a Trooper's head floored 4 of 4, not cold, up in 4.8 to 5.6 s; a pellet knocked cold 4 of 4, up in 5.3 to 6.9 s. `lab-contact` pack and `charge` as above, with a new `slowest` (the run's slowest from full speed to 3 m past the Brute, since every run stops at the back wall): the Brute's, 2.2 to 3.0 m/s either way. The rocket survivor band, re-based on `?knock=0`, is about 4.6 m ±15% (3.9 to 5.3); the stage's 4.06 to 4.95 is inside it. Scratch probes are in `tools/out/fix4`.

---

## Stage 5. Fight to get up

**Goal.**
- A knocked-down body pushes itself up on its muscles against its own weight, and strains.
- Hurt, it can give out, drop back and try again.
- A hard hit while it is getting up puts it back down. A single SMG round only rocks it.
- The keyed clip only finishes the last part of the rise.
- The undead get straight up.

**Changes.**
- **Get-up poses from any point in the clip.**
  - `getUp.ts` (`CharacterAnimation`) gains optional `poseGetUpAt?(kind, u, hips)` and an optional `startU` on `getUp`.
  - `HumanoidAnimator.poseGetUpAt` generalises `poseGetUpStart` (534), through `poseClip(kind, u, flip, 0)`.
  - `getUp(kind, seconds, hurt, startU = 0)` starts `clipU` at `startU`, plays the rest over `seconds`, and uses a 0.25 s pose match when `startU > 0`.
- **A struggle phase.** `reflex.ts` gains a phase `struggle` between `lying` and `gather`, for `prone` and `supine` with both arms present. Anything else gathers to frame 0 as today.

  | `ReflexTuning` | Value |
  |---|---|
  | `struggle` (drive by role) | arm 0.9, leg 0.7, spine 0.55, head 0.5 |
  | `struggleU` | prone 0.24 (hands and knees, prone key 1), supine 0.3 (sat up, supine key 1) |
  | `pushSeconds` | 0.7, or 0.35 when pain is 0 |
  | `assistMax` | 0.55 |
  | `wobble` | 0.08 at 17 rad/s |
  | `retryWait` | [0.5, 1.2] s |
  | `maxTries` | 3 |
  | `struggleKnock` | 0.3 |

- **A lift assist.** This is a capped cheat, like Euphoria's fall-to-knees hip helper.
  - Each sub-step, `MuscleState` puts a vertical impulse on the hips and chest toward the key's heights.
  - Force ≤ `assistMax × weight × effort × min(arm drive, leg drive)`, with effort ramping up over `pushSeconds`.
  - It is an explicit impulse with a cap, like `holdHips`, and never a joint torque, so the gain limit holds.
- **Failing.**
  - Chance per attempt: `clamp(0.6 × hurt - 0.2)`. Stage 8 adds leg strength.
  - It fires at effort 0.7 to 0.9: arm drive goes to 0.15 and the assist to 0 over 0.25 s, so the body drops under its own weight. It lies for `retryWait` and tries again.
  - The last try succeeds unless the body is dying.
  - A `struck` of at least `struggleKnock` counts as a failure on the spot.
- **Succeeding.** With the hips within 0.08 m of the key's height and the chest within 0.3 rad of it for 0.15 s, the body gathers the rest of the way as today and hands back with `startU`.
- **Timing.** In `damage.ts` `knockDown`, multiply `o.rise` and `e.riseSeconds` by (1 - 0.27) when both arms are present. `EnemyManager.ts` is not edited.
- **A rising body takes rounds.** `reactions.ts:131` becomes `if (e.rising > 0 && !area) { if (e.shock >= profile.fall) { out.level = 'felled'; out.strength = Math.max(out.strength, 0.4); } return out; }`. In `respond`, `felled` on a rising body calls `knockDown` with topple `null`: it drops from the clip pose under its own weight, seeded by `measureAnimVelocity` with `probing`.
- **Before and after.** `?struggle=0`, read in `reflex.ts`.

**Acceptance.**
- **`knockdown.test.ts`.** The four headings pass: pop < 0.14 m, floor > -0.05 m, root y = 0.
- **New, `knockdown.test.ts`:**
  - 'fights its way up' (hurt 0.9, failure forced): at least one failed attempt before the hand-back in 4 of 4 headings, meaning the hips rise ≥ 0.15 m and then fall ≥ 0.1 m. Landing to standing takes 1.0 to 1.6 times today's lie + gather + rise;
  - 'undead get straight up': at pain 0, no failure and a struggle of ≤ 0.5 s;
  - 'the assist never lifts more than 0.55 of the weight', checked through a hook;
  - 'a hard hit during the struggle puts it back down': a `strikeDown` of strength 0.4 at effort 0.5 gets the hips under 0.3 m within 0.5 s.
- **Over 20 seeds at hurt 0.9,** 4 to 10 first attempts fail (the expected chance is 0.34).
- **`reactions.test.ts`:**
  - a rising body hit by one SMG chest round flinches;
  - hit by a shotgun to the chest at 8 m, it is felled;
  - nothing floors a legless body.
- **In game.** `REACT=rise,riseback` before and after, plus a new case `riseshot` (the shotgun at clip u 0.5), at dpr 2. The sheets show the hands and knees and the push. In `riseshot` the body is down within 20 frames.
- **On the range, AI on.** Over 20 Trooper knockdowns, 15 to 40% fail at least once and none fails more than twice. Husks never fail.

**What the owner tries.**
- Put a Trooper down with the shotgun or by running into it, and watch it get up.
- Shoot it as it rises, first with one SMG round, then with a shotgun shell.
- Compare a Husk, which goes straight up, with a Brute, which is heavy and slow.
- A soldier in the Kill House.
- Compare everything with `?struggle=0`.

**Frame cost.** Two impulses per sub-step for each body struggling. Its chain lives 0.7 to 2.5 s longer, still inside `maxKnockdowns`. Budget: +0.3 ms.

**Risks.**
- Arms pushing a trunk up on 4 solver iterations. That is why the assist exists.
- `keepAboveFloor` can lift the hips on the frame the clip starts.
- The get-up still assumes flat ground.
- Repeated failures add time on the floor; `maxTries` bounds it.
- `poseGetUpStart` picks its mirror with `Math.random`, so headless runs need the flip fixed.

**As built (2026-11-10), where it differs from the above.** Numbers are in `gore.md` (Knockdown and getting up, What has to stay true, Measured, Known limitations), `enemies.md` (Getting up) and `characters.md` (Getting up). Scratch probes are in `tools/out/struggle`.
- **Question 3, for the owner:** one knob, `ReflexTuning.giveOut`. An attempt fails with `giveOut × (hurt - 1/3)`, which at 0.6 is the plan's `0.6 × hurt - 0.2`. At 0.45, 28% of 72 Trooper knockdowns on the range gave out at least once (17, 33 and 33% in three batches; 25% expected from their `hurt`), none more than twice, no Husk ever.
- **The lift's cap.** As written, `assistMax × weight × effort × min(arm drive, leg drive)` is 0.39 of the weight at the struggle's own drives (0.9, 0.7), and with arms and legs held to what turns a light limb (the gain limit) a body face down got its hips 0.05 m up in 2 s. The drives count as a share of their struggle strength, so it is 0.55 with arms and legs at it, and 0.55 is the most the hook ever reads. It is all there from half the effort, and the heights it lifts toward rise with the effort.
- **It lifts between the shoulders, not at the chest's joint.** Lifted at the base of the chest, a body face down pitched its chest head down (1.9 rad from upright) as the hips rose, and never met the chest test. Being up is the hips and the shoulders within 0.08 m of the frame and the chest within 0.5 rad of its lean, not 0.3: sat up, the chest swung 0.4 rad either side of upright for half a second.
- **Giving out comes most of the way up** (0.7 to 0.9 of the way to being up), not at 0.7 to 0.9 of the effort: then the lift had only just come in, the hips 0.07 m up, with nothing to drop back from. As it gives out the elbows give, or straight arms held the shoulders up on their stops.
- **The legs come with the body**, eased from where they lay by how far up it is. Driven to the frame at once, a body face up swung its feet 0.5 to 0.67 m into the air before it sat up.
- **`struggleKnock` is 0.6 on hits that add up and fade at 7/s**, not 0.3. A struck strength is `joltOf`, where one SMG round is 0.47, so 0.3 put a struggling body down for every round against the goal's "a single SMG round only rocks it". A second round 0.1 s later, a shell or a Judge round puts it down.
- **Both legs too.** On one shin a body face down never got its hips past 0.21 m and gathered for the clip after `upPatience`, 2 s of pushing for nothing; the knockdown test 'gets up on one leg' timed out once in thirteen runs. A body short of a leg gathers for the clip as before, and `damage.ts` shortens the rise only for one with all four limbs.
- **Not in the plan:** `pushGain` 4 for arms and legs, as `braceGain` is for a brace (1, 4, 6 and 8 were within the noise of each other, and it is kept like the brace); `upGather` 0.2 s at the frame once there, not 0.55 s, since the joints have been reaching for it all along (handover pops the same, 0.04 to 0.07 m); handed back part way up, the yaw comes from the turn that puts the frame's hips on the real ones, since sat up the chest is over the hips; a rising body felled goes over with no flinch on the animator first, as stage 4 did for head hits.
- **Tests, where they read other than planned.** 'Fights its way up' measures whichever of the hips and the shoulders rose more, which was the shoulders in every run: face up the supine frame keeps the hips on the floor (0.15 m), and face down the hips rise only 0.05 to 0.13 m before it gives out, against the plan's 0.15. It allows two tries, so exactly one gives out: two forced failures take 1.6 to 1.7 times as long. 'A hard hit during the struggle' hits at 70% of the way up with a shell (four pellets) and one SMG round: at effort 0.5 the hips are still under 0.3 m, and a single 0.4 would not knock under the rule above. 'Undead get straight up' allows 1.5 s (below).
- **Not met: undead in 0.5 s.** Unhurt, it sits up face up in 0.55 to 0.6 s (now and then up to 1.27, still rolling when it starts), and pushes up on straight arms face down in 0.62 to 1.13 s: the limbs carry little, and the capped lift rises only so fast. Stronger limbs and a stiffer lift did not change it past the noise.
- **Face down it pushes to a push-up, not hands and knees.** The prone key at 0.24 has the arms straight and the legs out behind; hands and knees is the key at 0.46, which the clip plays.
- **Not met: riseshot down within 20 frames.** Knocked down half way through the face-down clip it is on its knees; the upper body is down in 10 frames but the hips rest on the knees until about frame 34. Slack arms and legs (no brace) and a 0.8 to 1.2 m/s topple were tried in a probe and changed nothing past the noise; the plan's no topple is kept.
- **The rising rule rarely fells a Trooper**: four pellets in the chest are about its fall, and 80 damage, more than the 70 it starts with. In the game a Gunner on 72 of 90 died to one shell too. Health grows 8.5% a wave, so later bodies live through it and go back down; a Brute's `fall` of 2 is out of a shell's reach.
- **Fix round, after an independent measurement and a review.** Killed on its way up, a body kept its lift (up to 0.53 of its weight, fading with the limbs) for half a second and face down its shoulders rose 0.1 m after the death: the lift and the push now stop on the frame it dies. Thrown by a blast while pushing, its legs kept the push's gain of 4 and 0.3 of their weight through the flight: `Reflex.thrown` puts them back and drops the lift. `damage.ts` shortened the rise for a body with a broken arm or leg joint, which gore does not let push, so it played the whole clip in 0.73 of the time: `pushesUp` now reads the joints `canPush` reads. A head hit on a rising body had lost stage 4's topple and knocked-cold lock: only the rising rule drops a body with no topple now. Two tests guard the first two. Not changed, and in `gore.md` Known limitations: the push carries about 0.9 of the weight with help (the lift's 0.55 and 0.36 from the limbs carrying their own weight), and a limb broken or lost while the body is down still gets the shortened rise.

**Acceptance, as measured.**
- `knockdown.test.ts` 29 of 29 in eight runs on the final code, the four headings among them (pop under 0.14 m, floor over -0.05, root at 0). The four new tests fail on copies with no lift, with no cap on it, with giving out by effort, and with `struggleKnock` 0.3. `reactions.test.ts` 18 of 18. Must-pass, once each: `forces` 24, `muscles` 41, `ragdoll` 33, `weight` 7, `blast` 11, `gore/fracture` 3, `gore/wounds` 14, `enemies/wounds` 26, `rules` 24, `enemies/outpost` 16, `crucible` 15, campaign `outpost` 18, `contact` 5, `gait` 10, anatomy `fracture` 7 and `wounds` 9. `tsc` clean.
- Fights its way up, forced: 12 of 12 give out once; hips or shoulders rise 0.23 to 0.36 m and drop 0.24 to 0.34 (0.15 and 0.1); landing to standing 1.24 to 1.57 times before (1.0 to 1.6). Undead: never gives out, one try, 0.55 to 1.27 s (0.5, above). The lift: at most 0.55 of the weight. Hits: one SMG round, 3 of 3 carry on; a shell, 3 of 3 lying within 0.5 s. Twenty seeds at hurt 0.9: 6 first attempts fail (4 to 10).
- In the game, `react-seq` at dpr 2 with and without `&struggle=0`: `rise`, `riseback`, `struggle`, `struggleback` show the push up on the arms and the sit-up, one giving out and trying again; `riseshot` as above, and with `&struggle=0` the shell only flinches it; `huskup` sits up in 0.6 to 0.7 s. No console errors.
- On the range, AI on: 28% of 72 Trooper knockdowns give out at least once (15 to 40%), none more than twice; Husks never (12).
- `react-chaos`, six pairs: step peak mean 11.5 and median 11.0 ms against 11.35 and 11.2 with `?struggle=0`; four more pairs on another run, 9.75 against 10.05. The +0.3 ms budget is inside the noise either way. The script's CPU figure is the last frame's, read once every body is up, so it does not measure the struggle. Every survivor up, no errors.
- Independently re-measured: `?struggle=0` matched the code before the stage bone for bone, every frame, to 1e-6 m over 15 knockdowns; the range gave 42% of another 24 Troopers giving out (31% of all 96); `knockdown.test.ts` failed once in 36 runs, in 'a body lying down reaches its wound', a test of the lying phase, which this stage does not change and whose seed it does not move.

---

## Stage 6. Losing balance on muscles

**Goal.** A stagger that becomes a fall is one motion. The man is on his muscles from the hit: he takes his catch steps, his legs give under his weight, and he goes over. There is no switch from animation springs to a ragdoll to see. When he goes over depends on whether his momentum carries his centre of mass past his feet, with today's timer as the latest it can happen.

**Changes.**
- **`muscles.ts`.**
  - `KnockdownOptions.stumble?: { seconds: number }`.
  - `CollapseDrive` gains `alive = false`.
  - `MuscleTuning.standFade`, as shares of `stumble.seconds`, used by `sampleStrengths` while `alive`:
    - support [0, 0.7];
    - legs [0.35, 1];
    - spine [0.5, 1];
    - arms [0.7, 1];
    - head [0.7, 1].
  - The gravity split is stage 1's: legs 1, trunk by `trunkCut`, arms and head `1 - drive`.
  - `sampleReflex` waits while a collapse is set. `advance` already keeps tone during a collapse.
- **The balance read** (behaviours design), in `sampleCollapse` while `alive`:
  - `com` and `vCom`, weighted by part mass;
  - the feet are the lower ends of the shin parts, and `h = com.y - lowest foot`;
  - `cp = com.xz + vCom.xz × sqrt(h / g)`, where g is the ragdoll gravity;
  - `err = |cp - feetMid| / (0.55 × rig scale)`.
- **Giving up.** The body gives up when the first of these happens:
  - `err` > 1.6;
  - chest tilt > 0.8 rad;
  - hip gap `|hips - hipsAt|` > 0.3 m;
  - `h` < 0.5 of the standing height of the centre of mass;
  - u ≥ 1.

  Giving up ends the drive into `Reflex.offFeet()`: phase `fall`, time 0, landed 0, `dir = vCom.xz`, with drives easing at `driveRate`. It is the same `Rag`, with no new chain.
- **`Gore.knockdown` with `stumble`.**
  - Build `new CollapseDrive(char.anim, char.root, char.bones, stumble.seconds, options.velocity)` before `startRag`, with no `deathStumble`. The animator carries on with the stumble that `damage.stagger` started.
  - Start the Reflex, then `muscle.startCollapse(drive)` with `drive.alive = true`.
  - Refuse past `GoreTuning.maxStumbles: 4`.
  - `collapsing()` counts only drives that are not alive, so `maxCollapses` still means deaths.
- **`endDown` on an alive drive** calls `giveUp()` and lets the Reflex die, so a death on the way carries on from where the body is.
- **`damage.ts` `respond`.** For `fall`, for a trip, and in `drop()` from the wounds:
  - when `e.lod === 0 && e.inView` and the body is within 20 m of the player, call `this.stagger(...)` as now, then `knockDown(e, dir, strength, bone, profile, false, { topple: null, stumble: rand(FALL_LEAD_MIN, FALL_LEAD_MAX) + 0.35 })`;
  - if that returns false, set today's `fallIn` timer.

  `knockDown` already passes `velocity + reel + push`, which includes the reel the stagger just added, so the drift starts at the body's real speed. `EnemyManager.ts` is not edited.
- **Before and after.** `?stand=0` keeps today's timer path.

**Acceptance.** New describe 'losing balance' in `knockdown.test.ts`, at strength 0.9 with a 3 m/s reel unless a test says otherwise:
- **'goes down on its muscles':**
  - a planted foot slides ≤ 0.05 m a frame while support is > 0.5;
  - at least one footfall;
  - the worst bone move in one frame is ≤ 0.03 m at the start and ≤ 0.03 m across the switch to the Reflex;
  - |Δv| of the hips across the switch is ≤ 1.0 m/s;
  - it is the same `Rag` object throughout;
  - it is `lying` within 1.6 s, then gets up (`watch()` pop < 0.14 m).
- **'loses it on its momentum, not the clock':** at a 4 m/s reel the give-up comes before u = 1 in ≥ 4 of 6 headings, logged with `err`.
- **'dies on the way':** `endDown` at 0.2 s moves no bone more than 0.03 m in a frame, and the body becomes a corpse.
- **'the fifth is refused'.**
- **'four at once':** `physics.stepMs` is ≤ +0.8 ms over four plain knockdowns.

In game, the `react-seq` cases `fall`, `fallback`, `trip` and `husk` at dpr 2:
- before landing, no frame changes the hips' speed by more than 3 m/s;
- once support is below 0.5, the hips never rise more than 0.03 m.

**What the owner tries** on `/?map=range`, each against `?stand=0`:
- shotgun a running Trooper's leg;
- shotgun a standing Trooper in the chest twice;
- burst the SMG into a Husk until it falls.

**Frame cost.** The animator update for a falling body moves from `EnemyManager` into gore, so it is not new work. Each chain starts 0.16 to 0.42 s earlier than today's knockdown, with at most 4 at once. That is about 0.4 ms, an estimate to measure. Budget: +0.6 ms.

**Risks.**
- The handshake between the collapse and the Reflex is new code in the most-tested part of gore.
- Past 4 bodies, beyond 20 m or out of view, falls keep today's switch, so a crowd shows both kinds.
- The capture point is noisy on 4 iterations; the clock stays as the backstop.
- On a living body the hold's reaction has to follow "the hold takes the reaction" (`back = 1 - support`).

---

## Stage 7. Catching balance (behind `?stand=0`)

**Goal.** A hard non-lethal hit puts the living body on its muscles on its feet: a shotgun at 6 to 12 m, a Judge round, or a burst into a Brute. You watch the result. Either it catches itself and is handed back to the animation mid-stride, or it runs out of balance and goes over with stage 6's fall, the same ragdoll throughout. Every further round lands physically. A Brute barely leans where a Trooper lurches.

**Changes.** This builds on stage 6's alive drive. Add `StandTuning` in a new `src/gore/stand.ts`:

| `StandTuning` | Value | Range |
|---|---|---|
| `stepReach` (m, scaled by rig size) | 0.55 | 0.45 to 0.65 |
| `balanceFrom` | 0.6 | 0.4 to 0.8 |
| `giveUp` | 1.6 | |
| `perStep` | 0.06 | 0.03 to 0.12 |
| `hitCost` (per share of health) | 0.5 | |
| `maxSteps` | 5 | |
| `maxSeconds` | 2.5 | |
| `abortTilt` (rad) | 0.8 | 0.6 to 1.0 |
| `knockOut` (m of hip gap) | 0.3 | 0.2 to 0.4 |
| `stableSpeed` (m/s) | 0.45 | |
| `stableSpin` (rad/s) | 0.6 | |
| `stableHold` (s) | 0.2 | |
| `minStand` (s) | 0.35 | |
| `standBlend` (s) | 0.25 | 0.2 to 0.42 |
| `startDrive` | 0.25 | 0.15 to 0.4 |
| `holdDrive` | 0.85 | |
| `rampSeconds` | 0.2 | |
| `legDrive` | 0.85 | 0.7 to 0.95 |
| `pinYieldFrom` (m/s of Δv) | 0.3 | |
| `pinYieldFull` (m/s of Δv) | 1.0 | |
| `pinRegain` (s) | 0.35 | |
| `lod` (m) | 20 | |
| `GoreTuning.maxStanding` | 6, counted inside `maxKnockdowns` 12 | |

- **Budget.** It starts at `lerp(0.9, 0.55, strength)` and falls:
  - by `perStep` at every footfall. Wrap `anim.onFootstep` and restore it afterwards: `EnemyManager.ts:322` chains it for sound;
  - by `hitCost × share of health` at every hit.
- **Support** eases toward `min(budget, balance)` at 8/s.
- **The whiplash at impact.** After each hit, arms, spine and head restart at `startDrive` and ramp to `holdDrive` over `rampSeconds`. This is Euphoria's looseness.
- **Pin yield** (powered-ragdoll design). Any hit multiplies the hold's horizontal and turning gain by `1 - smoothstep(0.3, 1.0, |J| / mass)`, which recovers over `pinRegain`.
  - One SMG round on a Trooper is 0.24 m/s, so it never unpins.
  - The Judge is 0.47 m/s, a partial yield.
  - A close shotgun is about 1.4 m/s, a full yield.

  The vertical hold is untouched. Heavy, but not hard to move.
- **Hits on a standing body.** These go through `strikeDown` with `Gore.push` at `bodyLift` 0. They are standing, so no lift.
- **Recovering.** All of these hold:
  - age > `minStand`;
  - |vCom| < `stableSpeed` and chest spin < `stableSpin`, for `stableHold`;
  - balance > 0.8;
  - hip gap < 0.1 m.

  The hand-back puts the root at the ghost with the yaw of `facing`, takes the bones from `drive.local`, and calls a new `anim.blendFrom(standBlend)`. That is a public wrapper on `HumanoidAnimator.matchPose` (503), declared optional in `getUp.ts`. Any drift left over goes back through `options.velocity`.
- **Refusals.** It is refused past `maxStanding`, beyond `lod`, out of view, with muscles off, with no `getUp`, or when the ground under the two feet differs by more than 0.15 m (stairs). In each case today's animated stagger runs.
- **Callers.**
  - `damage.ts` `respond`: a `stagger` of strength ≥ 0.35 calls `knockDown` with `stumble` and a budget.
  - Gore reports `handedBack(char): 'clip' | 'stand' | 'crawl'`.
  - `EnemyManager.updateDowned` (468) sets `rising` to 0 and `stagger` to 0.2 for `'stand'`. This is the only `EnemyManager.ts` edit in the plan; schedule it after lane 1 finishes.
- **Fallback.** If bodies never lose a fight except on the budget, add the behaviours design's virtual pendulum on the hold target: `tipW += ((g/h)·tilt - 40·support·tilt - 2√40·support·tipW)·dt`. It is new and untested, so it stays out unless it is needed.

**Acceptance.** New `src/gore/stand.test.ts`, on the `knockdown.test.ts` harness, over 4 headings:
- **'catches itself'** (strength 0.5, 2.5 m/s, budget 0.8):
  - handed back by 2.5 s after 2 to 5 footfalls;
  - hips travel 0.7 to 1.3 m (the animated reel of the same hit goes 0.98 m);
  - a planted foot slides ≤ 0.05 m a frame;
  - the worst bone move is ≤ 0.06 m a frame over the hand-back and the 15 frames after it;
  - hips ≥ 0.8 m at the end, and root y = 0 ± 0.001.
- **'loses it'** (strength 0.9, 3.5 m/s, budget 0.25):
  - `downed` is non-null by 0.8 s, on the same `Rag`;
  - |Δv| of the hips across the give-up frame is ≤ 1.0 m/s;
  - hips < 0.6 m by 1.2 s, then it gets up with pop < 0.14 m.
- **'every round lands':** 20 N·s every 0.1 s puts it down within 2.5 s, with hips travel ≤ 3 m.
- **'mass':**
  - the same round on a Brute gives a peak tilt ≤ 0.45 of the Trooper's;
  - 20 N·s on the chest of a standing Trooper moves the hips ≤ 0.08 m (pin yield);
  - 60 N·s takes 1 to 3 steps;
  - 150 N·s gives up within 0.15 to 0.6 s.
- **'the cap':** the 7th at once is refused, standing plus down never exceeds 12, and no standing body is ever frozen.
- **'refused on a 0.3 m step'.**
- **Tests unchanged:** `knockdown.test.ts` and `reactions.test.ts`.
- **In game:**
  - `REACT=stagger,stagleg,trip,fall,fallback` before and after. `stagger` ends standing with `e.downed` never true, and `fall` has no frame where the hips jump more than 0.1 m;
  - new sandbox scenario `stand6`, six bodies staggered at once: the median physics step over frames 30 to 150, less the idle median, is ≤ 1.0 ms in Chrome at dpr 2;
  - `react-chaos`: every survivor gets up.

**What the owner tries** on `/?map=range` with a Trooper and a Brute, AI off and then on, each against `?stand=0`:
- the shotgun to the chest at 8 to 10 m;
- a shot to the thigh while it patrols;
- the SMG held on a Brute.

**Frame cost.** About 0.1 to 0.2 ms a frame per standing body, at most 6. The 1.0 ms budget is measured in `stand6`. If it is over budget, lower `maxStanding` to 4 and `lod` to 15 m.

**Risks.**
- **Feet.** A balance controller at 60 Hz on 4 iterations can skate feet or jitter. The slide caps and `?stand=0` are the guard.
- **Fights.** While gore holds a body it cannot attack. The reaction cooldown (FLESH 0.9 s, HEAVY 1.6 s) and `maxSeconds` 2.5 bound that, but wave pacing is unchecked.
- **Hand-back.** Handing back mid-stride can slide the feet visibly.
- **Collisions.** A standing ragdoll never touches the player or other enemies, so a reeling body passes through its neighbours.
- **The powered-ragdoll measurements.** Ball joints on the pre-step drive trail their target by about 5 frames: 0.38 rad walking and 0.59 running. So a body on the move tracks loosely, and that is why running bodies are refused here.

---

## Stage 8. Wounds set strength

**Goal.** A body moves like the wound it has.
- A shot leg buckles and takes the stagger with it.
- A femoral wound gets both hands clamped on it.
- A spine-shot man's legs lie dead.
- A gut-shot man curls up.
- A burning man really rolls.
- A concussed man reels.
- The undead feel nothing and get straight up.

**Changes.**
- `JointMuscle.strength`, 0 to 1 and 1 by default. It multiplies `stiffness()` (`muscles.ts:783`) and the stage 5 assist.
- `LimbStrength { legL, legR, armL, armR, trunk, neck }` and `gore.setStrength(char, s)`, called each frame for bodies gore holds.
- **The Crucible.** Strength comes from the limb pools: `1 - smoothstep(0.45, 1, spent share)`, the curve `reactions.ts legGone` already uses. A fractured limb is 0.15.
- **Campaign.** Strength comes from `WoundSystem.syncBody` (`wounds/index.ts:657`):
  - legs `1 - 0.8 × smoothstep(0, 0.75, wear)`;
  - an arm wound 0.2, a hand wound 0.6;
  - paralysed: legs 0;
  - `hunched` (gut): trunk 0.6;
  - concussed or ringing: neck 0.4.
- **Where it is used:**
  - Stage 6 and 7 balance: the weak knee gets +0.5 rad × (1 - strength), the budget is multiplied by `0.5 + 0.5 × the weaker leg`, and the stagger turns toward the weak side;
  - Stage 5 failure chance gains `+ 0.4 × (1 - the weaker leg)`;
  - Collapse: leg drive is multiplied by strength, alongside `shotLeg` going first.
- **Reflex while lying:**
  - paralysed legs get drive 0 and do not stir (fixes `wounds.md:148`);
  - a femoral leg stays still while the other kicks;
  - a gut wound sets `lyingCurl` 0.16 → 0.45 with the knees up, and both hands go to it;
  - an arm wound uses the other hand.
- **Stop, drop and roll** (`wounds/index.ts:534-539`): an alternating roll about the trunk axis every 0.6 s for 1.5 to 2.5 s. It goes through the jolt channel, sized from body inertia.
- **Concussed or ringing**, in balance: the ghost root sways 0.06 m at 1.3 Hz to match `anim.daze`, and the budget is multiplied by 0.7.
- **Undead** (pain 0): no grab, no writhe, a fast struggle, and the budget multiplied by 1.3.

**Acceptance.**
- **Selector tests**, in a new `src/gore/strength.test.ts` with a table of cases:
  - legL 0.2 plus a stagger gives a weak left leg and a budget ≤ 0.5;
  - paralysed and lying gives leg drive 0.
- **Headless:**
  - a gut wound, lying: both hands within 0.15 m of the wound by 0.6 s;
  - burning: the chest's up vector changes sign at least twice in 2.5 s;
  - one Judge round to `thighL` on a standing body: the left knee flexes at least 0.4 rad more than the right within 0.35 s.
- **Tests that must still pass:** `nice npx vitest run src/enemies/wounds/wounds.test.ts --testTimeout=60000`, `src/gore/wounds.test.ts`, and stage 1's guard 'a body lying down reaches its wound'.
- **In game:**

  ```
  WOUND=thigh3,femoral,spine,gut,fire,concuss node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/wounds-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/wounds.png
  ```

  Before and after: femoral has a hand on the thigh, spine has still legs, gut is curled, fire is rolling.

**What the owner tries**, in the Kill House or on `/?map=range&contract=outpost`:
- three SMG rounds in one thigh;
- a femoral hit;
- a spine shot from behind;
- set a man alight;
- on `/`, shoot a Husk's leg until it gives.

**Frame cost.** Writes per frame only, under 5 µs per body.

**Risks.**
- A weak arm hangs on purpose, which must not break the hand-to-wound guard.
- Strength changes have to ease in, by the rule that nothing lands in one frame.
- `wounds/index.ts` is enemy code; edit it with exact replacements only.

---

## 5. Left out on purpose

- **Every nearby enemy physical all the time** (powered-ragdoll stages 2 to 6).
  - The cost is a Node proxy at load average 5: 75 to 240 µs per body per frame, varying 3x between passes. It has never been measured in Chrome, and it doubles at 30 fps.
  - Ball joints trail by about 5 frames.
  - `keepRoot` changes what `root` means for sever, gib, slice, `raycastCharacter` and the burn emitter.
  - AI and physics positions diverge.
  - Rapier's `setMotorMaxForce` on acceleration-based motors is unverified.
  - Stages 6 and 7 reach most of the look at a fraction of the cost. Revisit only if the owner wants every hit physical after stage 7.
- **Rapier solver motors** in place of the pre-step drive. This changes every tuned gain. The only low-risk place for them is knees and elbows (measured hinge error walking: 0.077 rad against 0.244). Park it unless stage 7's tracking fails.
- **A physical stepping controller** (SIMBICON, Coros). Published controllers run at 200 to 3000 Hz, and this game runs 4 iterations at 60 Hz. The hip hold is the shortcut Euphoria, PuppetMaster and Jedi ship, and it is already here.
- **A knee buckle sold on headshots** (research P6). It would be extra animation, which the owner ruled out. The heel foot already takes the knees first.
- **Gravity compensation as joint torque** (research P2). It fights the gain limit ("a pre-step impulse has a gain limit"). `trunkCut` and, if needed, carry pairs do the same job.
- **Lower joint damping** (research P3). Measured, it is not a cause: switching it off moved the hips' landing by 0.05 s or less and the acceleration by under 10%.
- **Camera shake on landings, and hit stop scaled by force.** These are presentation, with no measurement behind them, and lane 2 is working in `hear` and `headshot`. Revisit after stage 3 if the owner still wants more weight.
- **Tumble spin on blast survivors.** Given the force history, and throws are already 3 to 7 m.
- **Raising `maxKnockdowns` or `maxCollapses`.** Only on a measurement, after stage 4 shows how charges spend slots.
- **Self-collision, ragdolls touching the player or living enemies, and frozen corpses keeping colliders.** These cost budget and were never measured. The player still walks through bodies that are down.
- **Stairs and slopes for get-ups and collapses.** The flat-ground assumption stays. Stage 7 refuses uneven feet.
- **Head mass on the Brute and Juggernaut** (2.6% and 2.1% of body mass). Minor.
- **The behaviours library refactor into `src/gore/behaviours/`.** It is structure with no feel of its own. Do it only if stage 8 outgrows `reflex.ts`, and then with the behaviours design's 1 mm determinism gate.

## 6. Questions for the owner, at the hand-off that needs each

1. **After stage 2:** 1, 0.75 or 0.6 for ragdoll gravity?
2. **Before stage 4:** should every non-fatal head hit from a real gun floor the body, the SMG included? The first SMG headshot on a Trooper becomes a knockdown.
3. **After stage 5:** how often should a hurt man fail to get up? The target is 15 to 40% of Troopers failing at least once.
4. **Before stage 7:** may an enemy spend up to 2.5 s on physics under fire, unable to attack, during a stagger it might recover from?
