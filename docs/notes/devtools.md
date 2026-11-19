# Dev tools for agents: seeing change, motion, leaks and slow frames

Built 2026-11-18 from the research in `docs/research/dev-tools.md` (its "Top 10"). Everything here is **dev-only**: four packages
in `devDependencies`, tools under `tools/`, nothing imported by game code, nothing in the shipped build. Test files may import them.

| Package | For | Size in `node_modules` |
|---|---|---:|
| `pixelmatch` 8.0 | comparing two pictures | 60 KB |
| `pngjs` 7.0 | reading and writing PNGs (pixelmatch's own dependency) | 712 KB |
| `fast-check` 4.10 (+ its `pure-rand`) | property tests | 1.5 MB + 280 KB |
| `webgl-memory` 1.1 | GPU memory in bytes, injected by the test harness | 76 KB |

About 2.6 MB in all. No agent skill pack and no MCP server was installed (the research found none worth installing whole).

All browser tools run through `tools/shot.mjs`, so they share its GPU flags, its private Vite, and its machine-wide browser slots.
**Always pass your own `--port`.**

## 1. Picture difference: `tools/diff.mjs`

```sh
node tools/diff.mjs before.png after.png --out tools/out/<you>/diff.png
```

Writes the difference picture (`before` faded to grey, changed pixels red, ignored edge pixels yellow), `diff-strip.png`
(before | after | difference, each panel 960 px wide) and, when something changed, `diff-zoom.png` (the same three cut to the
box around the change at full size). Prints one JSON line:

```json
{"changed":3994,"exact":4000,"total":921600,"percent":0.4334,"bbox":{"x":600,"y":300,"w":100,"h":40},"width":1280,"height":720,...}
```

- `changed`: pixels that differ by more than `--threshold` (default 0.1; anti-aliased edge pixels are ignored unless `--aa`).
- `exact`: pixels whose bytes differ at all. `--threshold 0 --aa` makes `changed` strict too.
- `--max <percent>` exits 1 when more changed, so a script can fail on "this change was not supposed to touch the picture".
- Two sizes: exit 2 with a message saying to take both at one `--w`, `--h`, `--dpr`.

Use it with every visual change: before, after, the strip, and the one number ("0.4 % changed, all on the gun"). Two shots only
compare cleanly when both were taken with the frozen clock (section 3): a live page differs in film grain on most pixels.

## 2. Motion contact sheet: `tools/sheet.mjs`

```sh
node tools/sheet.mjs --port <yours> --url "/?sandbox=viewmodels&weapon=smg" --eval "window.__vm.rig.reload(1)" \
  --frames 24 --every 64 --out tools/out/<you>/reload.png [--video tools/out/<you>/reload.mp4]
```

One PNG: 24 frames on a 6-column grid of 480 px tiles, the frame number and its time under each (`#12  +704 ms`). A reload, a
recoil, a ragdoll or a blood puff can be judged from that one image. The trigger (`--script`, then `--eval`) runs first; frame 1
is taken right after it.

- **The clock is frozen by default** (section 3): the times are exact whatever the machine load, and the same command gives the
  same sheet. Frames are whole 16 ms steps, so `--every 50` lands on 0, 48, 96, 144, 208...: the real time is what is printed.
- `--crop x,y,w,h` (page pixels) captures only the gun or one body, so a tile shows detail. `--pick n` puts n evenly spaced frames
  on the sheet while the video keeps them all. `--cols`, `--tile`, `--w/--h/--dpr`, `--wait`, `--seed`, `--until`, `--keep`.
- `--video out.mp4` builds a true-speed video of the frames with `ffmpeg` (`--slow 4` for quarter speed). Where `ffmpeg` is
  missing (the owner's Mac may not have it) the sheet is still written and a message says how to install it.
- `--live` uses real time instead: needed for co-op, menus and anything else the frozen clock does not drive. Times are then
  approximate and printed as measured.
- A `--script` gets helpers whose `sleep`, `press` and `click` move the frozen clock. A script that waits with its own
  `setTimeout` or `page.waitForTimeout` waits while the page stands still: use the helpers.

The sheet is drawn by a second page in the same browser (it shrinks the frames and prints the text), so there is no font or
scaling code to maintain. The layout maths is in `tools/lib/sheet-layout.mjs` (tested).

## 3. Frozen time and fixed randomness: `tools/scripts/lib/steady.mjs`

```sh
node tools/shot.mjs --port <yours> --url "/?sandbox=gore" --wait 0 --script tools/scripts/steady-shot.mjs --out tools/out/<you>/a.png
```

(`STEADY_FRAMES`, `STEADY_SEED`, `STEADY_EVAL`, `STEADY_UNTIL` set it up; or import the helper in your own script: its header
shows how.) It uses Playwright's Clock, already inside `playwright-core`: `Date`, `performance.now`, timers and
`requestAnimationFrame` only move when the script steps them, one 16 ms frame at a time; and it replaces `Math.random` with a
seeded generator before any page code runs. `tools/shot.mjs` scripts may now export `before(page)`, which runs before the page
loads: that is the only change to `shot.mjs`.

**The same single-player run on two builds** (`tools/scripts/solo-fixgame.mjs`, then `solo-fixgame-compare.mjs`): with the
clock frozen and the dice seeded, a scripted player's run can be recorded as numbers (how many random draws, where every
enemy is, what was heard) on a reference build and on a branch, and the two records compared field by field. It is how the
co-op overhaul's "single player is unchanged" was checked for the enemy side: 38 s of Endless Humans came out identical
(14,784 draws). Two things it needs: every run starts with `game.newRun()` after a fresh seed (loading is not part of the
record), and **sound is silenced for the record** (`ctx.audio.play` and its siblings counted and dropped): audio is not
frozen and throws the same dice as the game, so two runs of one build differed by a draw until it was. Each build needs
its own Vite on its own port; the script runs from one checkout against both.

Three things had to be solved to get the same picture twice, and are worth knowing:

- **Loading takes a different amount of real time each run** (downloads, and three.js polling its shader compiles every 10 ms
  of page time). So page time stands still all through loading: `ready()` fires the short timers the page is waiting on (a
  compile poll, a yield, a "next paint") without moving the clock, leaves long ones alone (the dev server's 30 s ping, the error
  reporter's 5 s flush), and checks "ready?" and fires in one indivisible step, so the game loop's first frame can never slip in
  early. Every run leaves loading with the clock at the same reading and the game at frame 0. A page that needs time to pass
  before it is ready gets it after 400 such steps, and the result then says `advanced: true`.
- **Late files.** A step is only taken while no request is in flight, so a download lands on the same frame every run.
- **The clock must be paused in one call.** Playwright's `clock.install()` followed by `clock.pauseAt()` replays, in every new
  page, the few real milliseconds that passed between the two calls, so `performance.now()` started at 3 ms one run and 7 ms the
  next. Anything reading it directly (a three.js clock, a shader's time) then drifted by a hair: 0.11 % of pixels on a gun's
  edges. `pauseAt()` alone starts every page at exactly 0, and `ready()` returns that reading as `clockMs`.

**Proof (2026-11-18), each the same command run twice, compared with `tools/diff.mjs --threshold 0 --aa`:**

| Page | Result |
|---|---|
| `/?sandbox=gore`, 120 frames, 1280x720 | 0 of 921,600 pixels differ |
| `/?sandbox=gore&scenario=explosion` as a 24-frame sheet at 1440x900 dpr 2 (blast, gibs, blood, smoke, ragdolls) | 0 of 3,944,700 pixels differ (run twice more after the last change: 0 again) |
| `/?sandbox=viewmodels&weapon=smg&pose=reload`, 90 frames, 1440x900 dpr 2 | **2,404 of 5,184,000 differ (0.046 %), by 1 to 7 levels out of 255, 1,989 of them by 1.** At the default threshold, and at 0.03: 0 changed |
| Control: the explosion sheet twice with `--live` | 17 % changed (71 % differ at all); frames asked for every 100 ms arrived at 0, 402, 548, 4106, 5228 ms on the loaded machine |

**What still differs, honestly:** on the gun, two small patches (the hazard stripes on the magazine, the markings on the sight)
come out a level or two different between runs. Both are decals drawn through a 2D canvas and uploaded as one texture
(`src/weapons/viewmodels/kit/materials.ts`, `makeDecals`); the likely cause is Chrome rasterising that canvas on the GPU, which
this helper cannot pin. Not proven. In practice: compare gun shots at the default threshold (or `--threshold 0.03`), where it
reads 0, and treat a strict-mode difference under 0.1 % confined to those decals as noise.

Three earlier versions of the helper failed these proofs (film grain everywhere, then one frame of drift, then hairline gun
edges): the causes are the three points above.

Not frozen: sound, WebRTC, web workers, `crypto.getRandomValues`, and CSS animations in the DOM (HUD and menu fades run in real
time; `page.screenshot({ animations: 'disabled' })` settles those). So this is for single-player look-checks, not co-op.

A side effect worth having: a frozen page never sees a slow frame, so nothing that adapts to frame time can change the picture.

## 4. Property tests: `fast-check`

`src/net/pose.property.test.ts` and `src/net/world/wire.property.test.ts`: the pose codec round trip at 32-bit float precision,
views at any offset, junk and truncated and damaged packets, the pose buffer under repeats and out-of-order delivery (with the
sequence number wrapping), the event router for any registration and any arrival order, `validVec` and `packDamage`. 14 tests,
about a third of a second. How to add one: `docs/notes/coop.md`, "Testing".

One edge the tests found and now pin: a pitch of exactly ±π is refused by `encodePose` ("Invalid pose"), because π rounds
upward as a 32-bit float and the decoder's limit is the 64-bit π. The game's pitch never gets near it, so nothing was changed.

## 5. Leak soak: `tools/scripts/soak-memory.mjs`

```sh
node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 2000 --timeout 600 \
  --script tools/scripts/soak-memory.mjs --out tools/out/<you>/soak.png
```

Plays Crucible waves with a bot that kills everything alive every 250 ms (a head shot, a blast that gibs, a sword cut, in turn),
rests 5 s after each wave, then reads: GPU bytes by kind and GPU object counts (from `webgl-memory`, injected by the harness
before the page loads), three.js's `renderer.info` counts, and the JS heap after a forced collection. `SOAK_ROUNDS` (default 6),
`SOAK_SETTLE`, `SOAK_WARM`. It writes every reading to `soak.json` and returns a table and a verdict per number:

- `flat`: came back (within 2 % or 1 MB; counts within 2 % or 4).
- `step`: rose, then held for the second half of the run: a pool or cache filling to its cap.
- `grows`: still rising in the second half: a leak, or a pool that has not reached its cap yet. Run more rounds to tell.

`holds` is true when nothing `grows`. The sampler and the verdict are in `tools/scripts/lib/glmem.mjs` for other scripts
(a different mode, a mission, the gore sandbox).

### What it showed (2026-11-18, RTX 4090, machine load 50 to 65)

**No leak found.** Three runs:

| Run | GPU memory | Textures | Buffers | JS heap |
|---|---|---|---|---|
| Real waves, 6 rounds, 214 kills | 452 MB after wave 2 → 569 MB after wave 6 | 146 → 249 | 1,673 → 2,037 | 50 → 57 MB |
| Real waves, 9 rounds, 363 kills | 479 MB after wave 2 → 584 MB after wave 9 | 174 → 325 | 1,719 → 2,236 | 51 → 63 MB |
| **Fixed crowd** (24 of husk, trooper, brute), 8 rounds, 192 kills | 503.9 MB after round 2, **504.4 → 504.5 MB over rounds 3 to 8** | 205 → 246, level from round 5 | **1,869 from round 3 on** | 52 → 57 MB, level in the last two rounds |

In real waves memory rose every wave, with corpses and limbs at their caps (40 and 48) from wave 3. The by-size list named what
multiplied: 16 more textures of 5.3 MB (1024 x 1024 with mips: +85 MB), 129 more of 4 KB (a body's bone texture,
`src/characters/Character.ts` `makeSkeleton`), and mesh buffers. Those are the per-kind atlases and pooled bodies of
`CharacterLibrary`, which are kept for the whole run. The fixed-crowd run settles it: with the same enemy kinds every round, GPU
memory stops moving after two rounds. So the growth in real waves is new enemy kinds arriving and bigger crowds filling pools,
not a leak in killing, gore, corpses or blood.

Two things this does not prove: the JS heap rose about 5 MB over six fixed rounds and looked level only at the end (a longer run
would say); and nothing here measured where the real-wave growth stops (16 enemy kinds, at most 48 alive: it is bounded, but the
top was not reached in 9 waves, at 584 MB).

## 6. Performance trace: `tools/scripts/perf-trace.mjs`

```sh
node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 8000 \
  --script tools/scripts/perf-trace.mjs --out tools/out/<you>/trace.png
```

Records a Chrome trace (`browser.startTracing`, already in Playwright) for `TRACE_MS` (default 5000), or while another script
runs (`TRACE_SCRIPT`), and returns a summary small enough to read: frame rate, frame interval and work time (median, 95th, worst),
the slowest frames each with its three hungriest functions and any garbage collection inside it, and the top functions by self
time over the whole trace. `TRACE_KEEP=1` also writes the raw trace for Chrome's Performance tab. No new package: the research
suggested Perfetto's trace processor for the summary, but a 130-line summariser (`tools/scripts/lib/trace.mjs`, tested) gives the
two answers that matter, so nothing was installed for it.

### What it showed (2026-11-18, load 77, so the timings are only an example)

Five seconds of Crucible play: 189 frames in 4.3 s, frame interval median 16.9 ms, 95th 73 ms, worst 353 ms. The worst frame
spent 342 of its 353 ms in `getProgramInfoLog` (a shader program linking in the middle of play, one second in); another frame
had a 48 ms garbage collection in it. Both are worth a look on a quiet machine. One lesson built into the script: it waits for
the game to be in play before recording, because on a busy machine a fixed `--wait` records the loading screen.

## 7. Comparing two builds of the game: `tools/scripts/solo-trace.mjs`, `tools/solo-compare.mjs`

For "did this branch change single player?". One scripted run is recorded frame by frame on each build, and the two records are
compared exactly. Built for the co-op overhaul's last pass (2026-11-19), where it compared `dev` with the branch tip.

```sh
git worktree add <scratch>/dev-ref dev && (cd <scratch>/dev-ref && npm ci && OP2_NO_HMR=1 npx vite --port <port B> --strictPort &)
OP2_NO_HMR=1 npx vite --port <port A> --strictPort &
for build in "tip <port A>" "dev <port B>"; do set -- $build
  SOLO_SCENARIO=crucible SOLO_LABEL=$1 node tools/shot.mjs --port $2 --url "/" --wait 0 --timeout 900 --quiet \
    --script tools/scripts/solo-trace.mjs --out tools/out/<you>/crucible-$1.png
done
node tools/solo-compare.mjs tools/out/<you>/crucible.dev.trace.json tools/out/<you>/crucible.tip.trace.json
```

The tools are always the newer checkout's; only the server differs. `solo-compare` prints `SAME: every frame, every event`, or
the first frame that differs with the numbers and events that differ there, and exits 1.

**All of it in one command:** `node tools/solo-parity.mjs --old <port B> --new <port A> --out tools/out/<you>/parity` plays
every scenario (36) on both builds, six to a browser run, and prints one line each (`same`, or the first difference). It knows the
differences that are meant to be there (`EXPECTED` at its top) and exits 1 on any other. `--long` adds the three runs to the
round-10 ending. About 25 minutes without the queue, 55 with `--long`. **Run it before merging anything that should not
change single player.**

**What makes two builds comparable.**

- **The frozen clock** (section 3): every frame is 16 ms of page time on both.
- **Randomness by caller** (`lib/solotrace.mjs`, `keyedRandom`): `Math.random` is replaced, before the page loads, by one seeded
  stream **per calling function** (source file and function name, read from the call stack; `core/math.ts`'s helpers are looked
  through). A build that adds a random call in one function changes only that function's later numbers. So the blood puff, which
  draws 2 numbers a puff in `fx/recipes/blood.ts#bloodPuff`, moves no enemy's dodge roll. The calls each caller made are counted
  per frame, and the comparison prints the first frame where a caller's count differs: that names the function that changed.
  Dev server only (it reads source paths from the stack).
- **Level ground at the start.** Which archetype's model finishes loading first differs from load to load (the downloads race),
  and with it which archetype lent its spare body to the wound warm-up (`CharacterLibrary.warmWounds`), so which bodies sit in
  the pool with which idle phases. The trace runs 8 frames, drops every spare body and restarts every stream, then records.
- **The recorder** (`recorder`): every game event with a short form of its payload; every call to the HUD that carries words
  (`hud.feed`, `hud.follow`, `hud.banner`, `hud.showScreen`, the hold ring...), once per change; and each frame the game state and
  screen, the clocks and time scale, the player (place, speed, view, health, armour, move state), the gun (id, magazine, reserve,
  grenades, reloading), the run (wave, phase, score, kills, head shots, combo, multiplier, credits, call-ins held, effects,
  pickups), every living enemy (uid, kind, place, health, armour), the gore system's counts, and the scenario's own probe.
- A payload field only one build has (`weapon:fired.note`, `enemy:hit.damage.from`) is listed and set aside, not counted.
  An event only one build has is a difference: `--skip-events <name>` sets one aside once it is understood.
- **A function that moved keeps its stream.** `fillShot` went from `weapons/Weapons.ts` to `weapons/shot.ts` on the co-op
  branch, so its one draw (does this heavy round burst what it kills?) came from another stream and the Piledriver's hits
  parted ways. `ALIAS` in `keyedRandom` maps a new name to its old one; `PASS` lists files whose functions only hand
  `Math.random` on (`core/math.ts`, `progression/callins/shared.ts`). Add a line when a run parts at a caller that only
  changed its name: the comparison prints the two callers side by side on the frame it happens.
- **A body's idle phase goes by its turn, not by the pool.** From the start of a run every body handed out gets its
  animation phase from its archetype and its turn (the first trooper, the second...). Which bodies sit in the pool differs
  between builds and loads (the warm-up borrows some), and a phase moves limbs: on one build a round grazed an arm that it
  missed on the other, before the trace had begun (a mission section that opens on a fight).
- **A pretend pointer lock** (the co-op kit's): a menu's Resume waits for the lock, which a browser grants in its own time.
- **Recorded voices are not served** (`audio/voice/`, `audio/chatter/`): they play through real `<audio>` elements in real
  time, and a page of the Commander's words stays up until its recording ends, which fell 14 to 250 frames apart between two
  runs. Every line is text on the game's own reading clock. `SOLO_VOICES=1` serves them.
- Several scenarios in one browser run: `SOLO_SCENARIO=a,b,c`. Each starts from a clean browser storage and writes its own
  trace. Use it on a shared machine: a run takes one browser slot however many scenarios it plays.

**Proved first:** the same build twice gives the same trace, frame for frame (600 frames of a Crucible fight; the only caller
whose counts differed was `audio/AudioEngine.ts#pickBuffer`: sound is not frozen, so the comparison leaves `audio/` out).

**Scenarios** (`lib/solo-scenarios.mjs`; a bot is a function run in the page before every frame, using only what both builds
have: `window.__op2`, `ctx`, `input.simulate`): `crucible`, `humans`, `office` (a fight with the starting kit: aimbot, a fixed
walk, dashes, jumps, grenades, melee, E); `crucible-waves`, `humans-waves`, `office-waves` (cannot be hurt, kills four of the
living every 12 frames through `applyDamage`: many waves fast, to the boss wave and to round 10); `crucible-shop`, `humans-shop`
(the same, reading every shop row at each break and then buying everything open); `defense`; `campaign`, `foreclosure`,
`retraining` and their `?beat=` sections, two with a death and a checkpoint restart; `defense-walls` (a wall knocked down,
bought back, boarded up by hand); `menus` and `menu-tree` (the words on every menu screen); `capture` (question, release, a hold short of 0.4 s, a
hold past it); `death` (a run that ends and starts again); `drops`; `tanks` (enemies that carry a tank, shot dead); `weapons`
(every weapon id in turn at standing targets); `adszoom` (the focus zoom to its limit); `movement`; `chips`; `callins`.

**Exit codes of `solo-compare`:** 0 the same; 3 the same play in every frame and event with only the gore system's counts
different (how bodies and limbs came to rest: listed, not failed); 1 different. `music:track` is never compared (a track
ends in real time).

**What it cannot compare.** Anything whose random source really changed (not just its name) parts ways at the first draw and
is then compared by totals. Sound, and anything timed by sound. CSS animations in the DOM (the end-of-run screenshots differ
in a pulsing HUD bar). The menus' 3D backdrop shifts by a frame from load to load.

`tools/scripts/solo-perf.mjs` is the frame-time half: a real-time fight with every frame drawn, giving frame interval and the
game's own work time per frame (median, 95th, 99th, worst), draw calls, triangles, heap, GPU memory, and each hitch over 40 ms
with the shader programs that were linked on it.

## 8. Other probes from the same pass

- `tools/scripts/gates-public.mjs`: on a production build, that the test-only switches cannot be reached from a public address
  and that `?netsim=` and `?dev=1` behave as documented. The game takes a page for "ours" by host name (`localhost`,
  `127.0.0.1`, `[::1]`), so `dist/` served on `127.0.0.2` is a public site as far as it can tell, with no hosts file; the same
  `dist/` on `127.0.0.1` is the control where the switches are allowed (its header has the commands). Checks: `?net=loop` (the
  one-tab rule still holds, and an opened lobby says `rtc`), proof mode (`window.__op2Proof` set, every frame still drawn), the
  pretend pointer lock and the silenced audio (the kit's page scripts: not in the bundle), `?netsim=`, `?dev=1`, `?dev=0`.
- `tools/scripts/first-launch.mjs`: an empty browser on the bare address, the splash, Play, and where that goes (real time).
- `tools/scripts/first-use.mjs`: the first gib, head shot, sever and shotgun kill against the four after it (the game's work
  on the frame, the worst frame interval, programs linked).
- `tools/scripts/audio-thread.mjs`: the CPU of Chrome's audio thread on an empty page, with a bare `AudioContext`, and with the
  game idle, fighting and suspended, read from `/proc`. Tells the browser's cost from the game's.

## 9. The test suite: seeded randomness

`tools/test-setup.ts` (Vitest `setupFiles`) replaces `Math.random` with a seeded generator, restarted before every test from
the test's full name and before each file's top-level code from the file's path. Game code draws from `Math.random` on purpose
(a body's idle phase, a stumble's side), so a test on real ragdolls used to check a different case every run. `OP2_TEST_SEED=<n>`
draws other numbers; `OP2_TEST_SEED=random` leaves `Math.random` alone. Hooks have 60 s (`hookTimeout`), as tests do with
`--testTimeout=60000`: `weapons/viewmodels/hands.test.ts` builds every gun model in `beforeAll`, a second alone, and overran
the default 10 s on a busy machine at the suite's low priority.

**Tests whose bounds are tighter than the game's real spread** (the whole suite under seeds 2 to 21; the default seed 1 passes
all). These are not machine load: they fail alone, on an idle machine, for the same seeds.

| Test | Fails in 20 seeds | What overruns |
|---|---:|---|
| `gore/knockdown` "goes down on its muscles, heading 0,1" | 3 | bone shake across the switch 0.0601 to 0.064 m against 0.06 (over 150 seeds of this test alone: 19 fail, median 0.034, worst 0.070) |
| `gore/stand` "loses it, on the same ragdoll, and gets up" | 3 | pop on getting up 0.142 to 0.144 m against 0.14 |
| `gore/strength` "a gut wound, lying: both hands on it within 0.7 s" | 2 | 0.72 and 0.78 s |
| `gore/knockdown` "killed on its way up, it drops under its own weight" | 1 | |
| `gore/knockdown` "dies on the way: the death carries on from where the body is" | 1 | |
| `gore/wounds` "a blast opens the side that faced it, and scorches it" | 1 | a count of 2 where more than 2 is expected |

Whoever next works on the ragdolls should either widen those bounds to what the game really does or make the game meet them
for every phase; the damage response update is the natural place.

## Decisions left to the owner (nothing installed)

- **Rapier's SIMD build** (`@dimforge/rapier3d-simd-compat` 0.21.0): the same physics library, same version and API, built to
  use the processor's vector instructions. It would **replace a runtime package**, so it changes what ships and is not a dev
  tool. To decide it needs a measured A/B on a ragdoll-heavy scene (the gore sandbox's `stress` scenario prints physics times;
  the trace helper above gives the rest). Two things to check with the measurement: that every browser the friends use
  loads it (the research says all current ones support WebAssembly SIMD; not tested here), and that ragdolls still look the
  same. Say the word and an agent measures it.
- **A linter for house rules only** (`oxlint` or Biome): the repo has none, and several `CLAUDE.md` rules are mechanical (no
  `performance.now()` or `setTimeout` in gameplay, only `core/Game.ts` and sandboxes import concrete classes). It was not installed
  because turning it on is a decision about every agent's workflow: the first run will list existing breaks (`performance.now()`
  is read in the renderer, gore and light-volume code today, for timing), and someone has to rule on each. Suggested, if wanted:
  two or three "ban this name / ban this import" rules, no style rules, run on demand, not as a gate.

## Not done from the research's Top 10

- 7, Chrome's built-in packet loss for WebRTC: needs its own experiment in the co-op lane's test kit.
- 8, the one-off dead-code report (`knip`): not run.
- 9, drawing Rapier's `debugRender()` in the lab: that is game code (the lab), outside this job.
- 10, `threejs-devtools-mcp`'s Playwright helper: not tried.
