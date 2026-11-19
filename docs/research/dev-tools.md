# Outside tools, skills and libraries for OVERPOWERED 2

Research date: 2026-11-18. Read-only job: nothing was installed, run, edited or committed.

## How to read this

- **Checked** means: the npm registry (latest version, release date, licence, size, declared three.js/Vite range) and the GitHub
  API (stars, last push, licence, archived or not), queried today. For the agent "skills" packs I downloaded the file lists and read
  the main files to judge whether there is substance.
- **Not checked** means: I did not install or run anything, so "works with this stack" is judged from each package's declared
  version range and docs, not from a test in this repo. Speed gains are unmeasured.
- Verdicts: **try now**, **later**, **skip**.
- "Runtime" = would ship inside the game. "Dev-only" = lives in tools/tests, never ships.

## What the repo already has (so nothing below repeats it)

Looked at `package.json`, `tools/shot.mjs` and a few greps in `src/`:

- Headless Chromium on the real GPU already works (`--use-angle=gl-egl`, 60 fps on the 4090). Public guides are behind this, not ahead.
- Page hooks (`window.__op2`, 41 uses), about 160 probe scripts, a co-op kit, an in-game network simulator, a loopback transport.
- `renderer.info` is already read in 18 places. `OfflineAudioContext` is already used.
- The installed `playwright-core` 1.65 already contains three features no tool script uses yet: **Screencast** (video and frame
  capture), **Clock** (fake time, including `requestAnimationFrame`), and **Chromium tracing** (`browser.startTracing`).
- Nothing in `tools/` compares two screenshots (no pixelmatch, odiff or similar).
- Hit tests use Rapier (27 ray/shape casts), never `THREE.Raycaster` (0 uses).
- Shaders are TypeScript strings: there are 0 `.glsl` files.
- `Math.random()` is called 211 times in non-test source. That matters for repeatable screenshots and replays.
- There is no linter in `package.json`.
- `ffmpeg` 6.1 is installed on the dev box.

**Main conclusion:** the repo's own harness is already better than most public agent tooling for three.js. The real gaps are small
and dev-only: comparing screenshots, seeing motion, freezing time, performance traces, leak checks, and property tests for the
co-op protocol. No runtime library is worth adding today.

---

## 1. Agent tooling (skills, plugins, MCP servers)

Honest summary: most "three.js skills" repos are documents for starting a new game from nothing. This game is far past that, has
its own rules (`CLAUDE.md`, `docs/notes/`), and those rules beat any generic pack. Two packs have real substance and are worth
reading for ideas. None is worth installing wholesale.

**CloudAI-X/threejs-skills** — https://github.com/CloudAI-X/threejs-skills
- What: 13 reference documents (fundamentals, shaders, materials, post-processing, performance, and so on), 17–29 KB each. No scripts.
- Checked: 4,274 stars, last push 2026-10-19, MIT. Text says it targets three.js r186. Substantial writing, not thin prompts.
- Why it could matter: keeps an agent on current three.js API names. The performance and shader files are careful (for example how
  `renderer.info` counters reset).
- What an agent gains over what it has: little. The agents here can already read `node_modules/three` (the exact r187 source). One
  file is about react-three-fiber, which the game does not use.
- Cost: dev-only, about 310 KB of text loaded on demand.
- Verdict: **later.** Hand the performance or shaders file to an agent doing that specific work. Do not install all 13.

**majidmanzarpour/threejs-game-skills** — https://github.com/majidmanzarpour/threejs-game-skills
- What: 9 skills plus scripts for building a new three.js game: a "director", gameplay, graphics, UI, a debug profiler, QA/release,
  and three generators that call paid outside services for 3D models, images and audio.
- Checked: 2,850 stars, last push 2026-09-28, MIT. 87 files, of which 278 KB are real scripts and tests.
- Why it could matter: the QA part is the best public write-up I found of how to make an agent prove a 3D game works. Worth copying:
  - a bot playtest that measures frames advanced, distance travelled under held keys, time to first score, and "softlock windows"
    (input held, frames moving, but no motion and no progress);
  - a "determinism contract" (seed, set state, pause for screenshot, hide debug UI) before any baseline image;
  - run the bot at two skill levels (0 ms and 300 ms reaction) to see if difficulty is real;
  - check that the GPU is real before quoting any frame time (this repo already does).
- Conflicts: the generators break the "everything procedural, no third-party art" rule, and the director skill would fight the
  repo's own orchestrator rules.
- Verdict: **later, read and borrow.** Do not install. The files to read are `skills/threejs-qa-release/references/playtest-bot.md`
  and `visual-test-harness.md`.

**Threesmith** — https://github.com/laaielichter/Threesmith (npm `threesmith` 0.3.0, 2026-11-12)
- What: an MCP server, CLI and Claude Code plugin: 98 review rules pinned to the installed three.js release, API lookup read from
  `node_modules/three`, a headless page check, a per-cycle leak finder, a performance budget, saved play scenarios. The README says it is
  tested on r187.
- Checked: created 2026-11-03, **0 stars**, one author, MIT, 9 MB. So: two weeks old with no users.
- Why it could matter: the leak finder ("what grows per cycle, down to GPU resources never disposed") and the review rules are
  exactly the checks nothing else offers for three.js.
- Risks: unproven. The plugin installs hooks that run after every edit. Its headless checks use software WebGL, which runs this game at
  about 1 frame a second, so its frame times would mean nothing here.
- Verdict: **later.** When it has some track record, run only the read-only `npx threesmith review` in a scratch worktree and
  see whether its findings are real. Do not install the plugin or hooks on the shared checkout.

**threejs-devtools-mcp** — https://github.com/DmitriyGolub/threejs-devtools-mcp (npm 0.5.0, 2026-10-14)
- What: an MCP server that looks inside a live three.js scene: scene tree, materials, shaders, textures, draw-call and memory
  counts, "why is this object invisible", and a frame recorder with virtual time. 69 tools. Says it needs no change to the project and
  works with plain three.js on WebGLRenderer.
- Checked: 132 stars, MIT, one maintainer, 622 KB.
- What an agent gains: answers about the scene without writing a probe script first. It also exports a Playwright helper
  (`threejs-devtools-mcp/playwright`: `attachDevtools`, `threeCall`) that could be called from a `tools/scripts/` probe with no
  MCP server at all.
- Risks: 69 tool descriptions cost context in every turn; as an MCP server it opens its own browser (port 9222), which must be
  Playwright's Chromium, never the owner's Chrome.
- Verdict: **try now, small.** Use the Playwright helper in one probe script on one real visual bug. Keep it only if it beats
  the existing `window.__op2` probes.

**Playwright CLI with skills** — https://github.com/microsoft/playwright-cli (npm `@playwright/cli` 0.1.25, 2026-11-18)
- What: Microsoft's command-line browser driver made for coding agents, with installable skills. Keeps a browser session open
  between commands; has `video-start`, `tracing-start`, screenshots. Microsoft now recommends it over their MCP server for coding
  agents because it uses far less context.
- What an agent gains over `shot.mjs`: poking a live page step by step without writing a script file.
- Risks: must be pointed at Playwright's Chromium with the GPU flags and an agent port; the default launch would not use the GPU.
- Verdict: **later.** `shot.mjs` covers the main need. Useful for exploratory debugging sessions.

**Chrome DevTools MCP** — https://github.com/ChromeDevTools/chrome-devtools-mcp (npm 1.13.0, 2026-11-11, Google, Apache-2.0, 16 MB)
- What: lets an agent drive Chrome's DevTools, including recording a performance trace and getting a short summary back instead of
  30 MB of raw data.
- Why it could matter: finding which function eats a slow frame.
- Risks: by default it attaches to or launches the real Chrome. That is forbidden here (never drive the owner's Chrome); it would
  need its executable-path and isolated-profile options. Its summaries lean towards web-page loading, not game loops.
- Verdict: **later.** The same trace can be captured with the Playwright already installed (see section 2).

**three.js official docs for AI** — https://threejs.org/docs/llms.txt and https://threejs.org/docs/llms-full.txt
- What: three.js now publishes its own guidance file for language models (5 KB) and a full version (379 KB). Checked today: both
  exist and name version 0.187.0.
- Why it matters less than it sounds: it is mostly about script tags, import maps and the new node/WebGPU material system. This game
  uses Vite and WebGLRenderer, and agents can read the exact installed source.
- Verdict: **skip for now.** Becomes useful if the game ever moves to the WebGPU renderer.

**Skip, with reason:**
- **Claude-Code-Game-Studios** (https://github.com/Donchitos/Claude-Code-Game-Studios, 40k stars, MIT): 49 role-play agents and 75
  skills copying a studio hierarchy, mainly for new projects and Godot/Unity/Unreal. Would fight this repo's own orchestrator rules.
- **game-creator** (https://github.com/PlayableIntelligence/game-creator, 370 stars, no licence stated, 215 MB): makes small new
  Phaser/three.js games with monetisation and promo steps. Wrong stage, no licence.
- **Three.js-Claude-Skill-Package** (https://github.com/Impertio-Studio/Three.js-Claude-Skill-Package, 31 stars): 24 general skills
  including react-three-fiber and building-model formats. Not relevant.
- **Generic packs** (https://github.com/wshobson/agents, https://github.com/VoltAgent/awesome-claude-code-subagents,
  mrgoonie/claudekit-skills, https://github.com/obra/superpowers): prompt collections for general software work. Nothing about games,
  WebGL or this stack that `CLAUDE.md` does not already say better.
- **Anthropic's `webapp-testing` skill** (https://github.com/anthropics/skills): a basic Playwright helper for web apps. `shot.mjs` is
  well past it.
- **Playwright MCP** (`@playwright/mcp`): same engine as the CLI but heavier on context. Microsoft itself points coding agents to the CLI.
- **Context7 docs MCP** (`@upstash/context7-mcp`): sends questions to an outside service to fetch library docs. The installed
  source and types are already on disk and exact.
- **agent-browser** (https://github.com/vercel-labs/agent-browser, 52k stars): another agent browser CLI; duplicates the above.
- **ThreeJSMCP** (deya-0x): 2 stars, one commit day in January. Thin.

**For the owner's own browser (not for agents):** the official **Three.js DevTools** extension (source lives in the three.js repo's
`devtools/` folder; on the Chrome Web Store, published by threejs.org) and **Needle Inspector**
(https://needle.tools/needle-inspector-devtools-for-threejs). Both show the scene tree and materials of a running three.js page.
**Later**, if the owner ever wants to click on an object and see what it is.

**Best "skill" option overall:** write two or three small skills for this repo's own recurring jobs (for example "compare before
and after shots", "hot-path review: allocation, clocks, spread rules"). The one detailed write-up from a large agent-built
three.js game (section 6) says its custom review skills, built to catch that project's repeated mistakes, were what worked.

---

## 2. Testing a WebGL game

### Comparing screenshots

**pixelmatch** — https://github.com/mapbox/pixelmatch (8.0.0, 2026-10-06, ISC, 36 KB, 1 dependency)
- What: compares two PNGs, returns the number of different pixels and writes a picture showing where.
- Why here: every agent visual change could come with before, after and a difference picture plus one number ("0.4 % of pixels
  changed, all on the gun"). It also catches the opposite: a change that was not supposed to touch the picture but did.
- Cost: dev-only, tiny. It is also the comparator Vitest uses internally.
- Verdict: **try now.** A small `tools/diff.mjs` next to `shot.mjs`.

**odiff** — https://github.com/dmtrKovalenko/odiff (`odiff-bin` 4.5.0, 2026-07-23, MIT, native binary)
- What: the same job, several times faster on big images, as a command-line program.
- Verdict: **later.** Only if pixelmatch is slow on 2880x1800 shots. Pick one, not both.

**NVIDIA FLIP** — https://github.com/NVlabs/flip (`flip-evaluator` 1.7 on PyPI, 2025-11-07, NVIDIA open licence, check before use)
- What: a difference measure built for rendered images, closer to what a person notices than counting pixels.
- Why here: scenes full of particles and blood differ in every pixel between runs even when nothing is wrong.
- Cost: dev-only, Python.
- Verdict: **later**, if pixel counting is too noisy even with time frozen.

**Vitest browser mode with `toMatchScreenshot`** — https://vitest.dev/guide/browser/visual-regression-testing
- What: Vitest (already used, version 5) can run tests inside real Chromium and compare screenshots to saved baselines. Needs
  `@vitest/browser` and `@vitest/browser-playwright` (both 5.1.1, released today) and the full `playwright` package.
- Why here: tests that need a real GPU could live beside the other tests: "every shader in the game compiles", "the particle
  system draws something", "this gun model looks like its baseline".
- Cost: dev-only, three packages. Baselines only match on the same machine and GPU.
- Verdict: **later.** The shader-compile check is the valuable part and can be done sooner as one `shot.mjs` script (compile
  every material, fail on any shader error).

Skip: `ssim.js` (last release 2020), `looks-same` (fine but nothing extra), hosted services such as Percy, Chromatic, Argos
(they upload screenshots to an outside service).

### Repeatable runs and replays

**Playwright Clock** — https://playwright.dev/docs/clock (already inside the installed `playwright-core`)
- What: replaces the page's clocks, timers and `requestAnimationFrame` with ones the script controls: pause, run exactly N
  milliseconds, step.
- Why here: a script could run the game for exactly 120 frames and take a shot, and get the same picture every time. Paired with a
  seeded replacement for `Math.random` injected by the script (the game calls it 211 times), no game code changes.
- Limits: sound, WebRTC and the physics library do not follow the fake clock, so this suits single-player look checks, not co-op.
- Verdict: **try now.** It is what makes screenshot comparison trustworthy.

**Record and replay of inputs:** no ready library exists for this (see "not found"). The standard pattern is: record seed, per-frame
time step and inputs; replay them; compare a hash of the physics state. Rapier supports the last part: `world.takeSnapshot()` is in
the installed build, and its docs (https://rapier.rs/docs/user_guides/javascript/determinism/) say the browser builds give
identical results on every machine for identical inputs in identical order. **Later**, as an in-house tool once time is frozen.

### Headless GPU on Linux

Already solved in `shot.mjs`. Chromium's own guidance suggests the Vulkan back end; the repo already found that it loses the WebGL
context one run in three and uses OpenGL through EGL instead. **Nothing to adopt.**

### Frame time and performance capture

**Chromium tracing from Playwright** — https://playwright.dev/docs/api/class-browser#browser-start-tracing (already installed)
- What: records the same trace the Performance tab records, to a JSON file.
- Pair with **Perfetto trace processor** (https://perfetto.dev/docs/analysis/trace-processor): a free program that answers
  questions about a trace file, so an agent gets "worst frame 41 ms, 60 % in function X" instead of a 30 MB file.
- Cost: dev-only. Capture needs nothing new; the trace processor is one download.
- Verdict: **try now** for any "it stutters when X" report.

**Spector.js** — https://github.com/BabylonJS/Spector.js (0.9.33, 2026-09-14, MIT, last push 2026-11-13)
- What: records every WebGL command of one frame: each draw call, its shader, its state.
- Why here: answers "what drew this" and "why 900 draw calls" exactly. Can be injected by a script and its capture saved as JSON.
- Cost: dev-only. Captures are large, so a short summariser script is needed.
- Verdict: **later**, the first time a draw-call or render-state problem needs explaining.

**stats-gl** — https://github.com/RenaudRohlinger/stats-gl (4.2.3, 2026-07-10, MIT) and **three-perf**
(https://github.com/TheoTheDev/three-perf, 1.0.11, 2025-06-09, MIT, needs three >= 0.170)
- What: on-screen frame, CPU and GPU time graphs.
- Verdict: **later**, for the owner's eyes behind `?dev=1` if the existing dev panel lacks GPU time. Agents need numbers in a file,
  not an overlay.

### Memory and leaks

**webgl-memory** — https://github.com/greggman/webgl-memory (1.1.3, MIT, last push 2026-10-27, 62 KB)
- What: a script loaded before the game that tracks GPU memory in bytes: buffers, textures, render targets.
- Why here: a soak test. A bot plays ten waves; GPU memory and `renderer.info.memory` must come back to where they started after
  each wave. With ragdolls, gibs, decals and particles pooled under hard caps, this proves the caps hold.
- Cost: dev-only, injected by the test script.
- Verdict: **try now.**

**memlab** — https://github.com/meta/memlab (2.0.6, 2026-10-29, MIT, Meta)
- What: finds ordinary JavaScript memory leaks by comparing heap snapshots across a scripted scenario.
- Cost: dev-only but heavier; drives its own browser.
- Verdict: **later**, if long sessions show the JavaScript heap growing.

**webgl-lint** — https://github.com/greggman/webgl-lint (1.11.4, 2025-04-26, MIT)
- What: makes WebGL mistakes loud (unset uniforms, wrong sizes, feedback loops) with readable messages.
- Verdict: **later**, as a one-off audit run. Too slow to leave on.

Skip: `fuite` (made for page-navigation web apps).

### Fuzzing and bot play

**fast-check** — https://github.com/dubzzz/fast-check (4.10.3, released today, MIT, dev-only)
- What: property testing for Vitest. You state a rule; it generates thousands of random cases and shrinks any failure to the
  smallest example.
- Why here, right now: the co-op overhaul is full of rules that suit it: "decode(encode(snapshot)) equals the snapshot",
  "applying a delta to the old snapshot gives the new one", "the shot bucket never goes negative", "packets arriving out of order
  or twice never corrupt state". Also "`lockWave` always lands before round 10".
- Verdict: **try now.**

**Bot play:** no library. Borrow the measurements from the threejs-game-skills QA notes (section 1) into the existing bot scripts.

---

## 3. Netcode

**trystero and unreliable channels** — https://github.com/dmotz/trystero
- Checked in the installed package: 0.27.0 (2026-11-11) is the newest release and is what the game pins. Its core opens exactly one
  channel with no options (`pc.createDataChannel("data")`), which means reliable and ordered. There is no setting to change that
  and no open request asking for one (I searched its issues).
- The game's own approach (its own unreliable channel on the same connection) is the right workaround. Keep the version pinned
  exactly, as it is, because this leans on trystero internals.
- Verdict: **nothing to upgrade to.** Optional: file a feature request upstream.

**Reference reading (not dependencies):**
- Gaffer on Games, "Snapshot Interpolation" (https://gafferongames.com/post/snapshot_interpolation/) and "Snapshot Compression"
  (https://gafferongames.com/post/snapshot_compression/): the standard text on buffering, quantising values, and sending only
  differences from the last snapshot the other side confirmed.
- Gabriel Gambetta, "Fast-Paced Multiplayer" (https://www.gabrielgambetta.com/client-server-game-architecture.html): prediction,
  reconciliation, interpolation and lag compensation with a live demo.
- Valve, "Source Multiplayer Networking" (https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) and "Latency
  Compensating Methods" (same site): how a shooter favours the shooter.
- Verdict: **read**, if `docs/research/coop-netcode.md` does not already cover them.

**@geckos.io/snapshot-interpolation** — https://github.com/geckosio/snapshot-interpolation (1.1.1, 2025-02-22, BSD-3, no dependencies)
- What: a small snapshot buffer with interpolation (including rotations) and a basic reconciliation helper.
- Verdict: **reference only.** A few hundred lines worth reading against the overhaul's own code. Not a dependency: quiet for 21
  months, and the game needs its own version anyway.

**nengi** — https://github.com/timetocode/nengi (npm 2.0.0-alpha, 2024-05; repo pushed 2026-10; Apache-2.0)
- What: a full network engine with binary schemas, interpolation, prediction and lag compensation. Built around a Node server.
- Verdict: **reference only** (its lag-compensation code). Wrong shape for peer-to-peer.

**@hpx7/delta-pack** — https://github.com/hpx7/delta-pack (0.3.1, 2026-04-22, MIT, 2 stars)
- What: schema-based binary packing that sends only changed fields and stores numbers at a chosen precision.
- Verdict: **reference only.** Good ideas, almost no users; would be a runtime dependency.

**typed-binary** — https://github.com/iwoplaza/typed-binary (4.3.5, 2026-10-27, MIT, no dependencies)
- What: describe a binary layout once, get typed read and write functions. No differences-only mode.
- Verdict: **later**, only if hand-written byte packing becomes a source of bugs. Would be runtime.

**Skip:** `netplayjs` (rollback model, needs a fully deterministic game, last push 2024-10); `snowglobe` (dead since 2021);
`@colyseus/schema` (5.0.50, active, but built for the Colyseus server and 4.8 MB); `msgpackr` (general packing, not compact
enough for snapshots); `peerjs` and `simple-peer` (trystero already does this; simple-peer unmaintained since 2022); `playroomkit`
(hosted service, needs React).

**WebTransport**
- What: the newer browser transport with unreliable messages. Secondary sources say it reached all major browsers in March 2026
  (Safari 26.4); I did not confirm that against Apple's release notes.
- It only connects a browser to a **server**. It cannot connect two players directly.
- Verdict: **skip** while the game has no server. Revisit only if a relay server is ever built.

**Network condition simulators**
- The game has its own (`?netsim=`). An independent second check exists inside Chrome: the DevTools protocol's
  `Network.emulateNetworkConditions` now has `packetLoss`, `packetQueueLength` and `packetReordering` (I confirmed the three fields
  in the current protocol file), and Chrome's docs say these apply to WebRTC
  (https://developer.chrome.com/docs/devtools/settings/throttling). Playwright can send that command.
- Why here: it drops packets at the real transport, below the game's code, so it tests the game's own simulator and the unreliable
  channel fallback honestly.
- Not checked: whether it affects data channels between two pages on one machine. A ten-minute experiment settles it.
- Verdict: **try now** (the experiment).
- Linux `tc netem` does the same at the system level but needs root and would also slow every other agent's server. **Later.**

**node-datachannel** (0.33.6, 2026-10-27, MPL-2.0) and **werift** (0.27.0, 2026-11-10, MIT): real WebRTC inside Node, so co-op
tests could run without a browser. **Skip for now**: the loopback transport and the browser kit already cover this.

---

## 4. three.js development helpers

**Rapier SIMD build** — `@dimforge/rapier3d-simd-compat` (0.21.0, 2026-09-25, Apache-2.0)
- What: the same physics library and same version as today's, built to use the processor's vector instructions. Same API.
- Why here: ragdolls and gibs are physics-heavy. This is a swap of one runtime package for its sibling, not a new dependency.
- Not checked: the actual gain. Measure a ragdoll-heavy scene both ways. All current browsers support it.
- Verdict: **try now** as a measured A/B.
- Note: the Rapier JavaScript repo is archived; the code moved into https://github.com/dimforge/rapier (`typescript/` folder).
  Look for issues and changelogs there. A `-deterministic-compat` flavour also exists; I could not confirm how it differs from the
  default, which the docs already call identical across machines.

**Rapier debug drawing** (already in the installed build: `world.debugRender()`)
- What: returns line segments for every collider and joint.
- Why here: nothing in `src/` calls it. Drawn as an overlay in the lab, it lets an agent screenshot "collider versus visible
  mesh" and see ragdoll joints. No new package.
- Verdict: **try now.**

**three-mesh-bvh** — https://github.com/gkjohnson/three-mesh-bvh (0.9.18, 2026-11-03, MIT, three >= 0.159)
- What: makes ray tests against render meshes fast.
- Verdict: **skip.** The game never ray-tests render meshes; everything goes through Rapier. Might serve the offline bake tools
  one day (it can build distance fields from meshes).

**Debug panels** — lil-gui (0.21.0, 2025-10, MIT), tweakpane (4.0.5, 2024-11, MIT): **skip**, the game has its own lab panel.

**three.js Inspector add-on** (`three/addons/inspector`, present in r187): checked the installed file; it imports the WebGPU
renderer and does not work with WebGLRenderer. **Skip.**

**Shader tooling**
- `vite-plugin-glsl` (https://github.com/UstymUkhman/vite-plugin-glsl, 1.6.3, 2026-11-13, MIT): imports and minifies shader files.
  The game has no shader files (all are TypeScript strings), so **skip** unless shaders move to files.
- No offline shader checker understands three.js's `#include` pieces (see "not found"). The practical check is a real-browser
  script that compiles every material and fails on the first shader error.

**Post-processing** — pmndrs `postprocessing` (https://github.com/pmndrs/postprocessing, 6.39.6, 2026-11-01, Zlib; declares three
>= 0.168 and **< 0.188**, so it works on r187 but would block each three.js upgrade until it updates) and `n8ao`
(https://github.com/N8python/n8ao, 2.1.0, 2026-11-15, ISC; ambient occlusion). Both runtime. **Skip**: the game has its own post
pipeline. `n8ao` is the one piece to remember if contact shadows are ever wanted.

**Particles and instancing** — `three.quarks` (0.18.0, 2026-11-17, MIT): **skip**, the game has its own GPU particles.
`@three.ez/instanced-mesh` (https://github.com/agargaro/instanced-mesh, 0.3.16, 2026-07-26, MIT): per-instance culling and level
of detail. Runtime. **Later**, only if draw calls for crowds or gibs become the bottleneck.

**Bundle analysis** — `rollup-plugin-visualizer` (7.1.3, 2026-11-08, MIT; declares support for Rolldown, which Vite 8 uses) or
`sonda` (0.14.0, 2026-07, MIT). Dev-only. Shows what is inside each built file. **Later**, as a one-off look. One thing it will
likely show: the `-compat` Rapier build carries its WebAssembly as text inside the JavaScript, which is about a third bigger than
the raw file.

**Linting house rules** — `oxlint` (https://github.com/oxc-project/oxc, 1.94.0, 2026-11-16, MIT) or Biome
(https://github.com/biomejs/biome, 2.6.8, 2026-11-15)
- What: very fast linters (the whole repo in about a second).
- Why here: the repo has no linter, and several `CLAUDE.md` rules are mechanical: no `performance.now()` or `setTimeout` in
  gameplay, only `Game.ts` and sandboxes import concrete classes. A lint rule catches these in every agent's change without a
  reviewer. Not checked: that the needed "ban this name / ban this import" rules cover every case.
- Verdict: **try now**, with a short rule list (rules that match house rules only, no style rules).

**Dead code** — `knip` (https://github.com/webpro-nl/knip, 6.46.1, 2026-11-18, ISC, dev-only): lists files, exports and
dependencies nothing uses. Agent-built code collects these. **Try now** as a one-off report.

**Building shapes** — `manifold-3d` (https://github.com/elalish/manifold, 3.5.5, 2026-11-13, Apache-2.0): reliable cutting and
joining of solid meshes. Could serve gun models with real cut-outs, at bake time so it never ships. **Later**, only if cut-outs
with the house mesher are painful. `three-bvh-csg` (0.0.18, MIT) does the same in plain JavaScript.

**WebGPU readiness**
- WebGLRenderer is still shipped and works in r187. New three.js features (node materials, the Inspector, the new post stack) are
  built for the WebGPU renderer. Moving would mean rewriting every custom shader in the new node language.
- Blogs claim the WebGPU renderer became the "recommended" one in late 2025; I found no official statement.
- Verdict: **skip for now.** No reason to move mid-project. Revisit after the game ships or if three.js announces an end date
  for WebGLRenderer.

**Also skip:** `detect-gpu` (picks quality by GPU; runtime, fetches its tables from an outside server by default; **later** if
friends on weak laptops need automatic settings), `recast-navigation` (the game has its own nav), `yuka` (last release 2022).

---

## 5. Procedural content and audio

Nothing here beats what the game already builds itself. For completeness:

- **Noise:** `simplex-noise` (https://github.com/jwagner/simplex-noise.js, 4.0.3, MIT, no dependencies, small and finished),
  `fastnoise-lite` (1.1.1, MIT; cellular and warped noise), `open-simplex-noise` (3.0.0, 2026-08, public domain). **Skip** unless a
  new noise type is needed; all are small enough to read rather than depend on.
- **Shader function libraries:** LYGIA (https://github.com/patriciogonzalezvivo/lygia, 3.5k stars) is the big one, but its licence
  is "Prosperity + Patron": free for non-commercial use only. **Skip** for that reason. `psrdnoise`
  (https://github.com/stegu/psrdnoise) is tiling shader noise with slopes; licence not shown by GitHub, check before copying.
- **Distance-field references:** Inigo Quilez's articles (https://iquilezles.org/articles/distfunctions/) are the standard source
  for shape formulas. **Read**, no dependency.
- **Sound:** `zzfx` (1.4.0, 2026-10, MIT, under 1 KB), `jsfxr` (1.4.1), Tone.js (15.1.22, 5 MB, heavy), Elementary Audio
  (`@elemaudio/core` 4.0.1, 2024-12), Faust in the browser (`@grame/faustwasm` 0.22.0, LGPL, 31 MB). **Skip all**: the game has its
  own synth and catalog.
- **Idea, no package:** `ffmpeg` on the dev box can turn any rendered sound into a spectrogram picture (`showspectrumpic`) and a
  loudness reading (`ebur128`). An agent can then look at a sound it cannot hear. Worth adding to the audio report if it is not
  there already.

---

## 6. Faster feedback for agents

**Motion contact sheets** (already-installed Playwright Screencast + `ffmpeg`)
- What: `page.screencast.start({ path })` records the page to a video file; `ffmpeg` then lays 24 evenly spaced frames on one image.
- Why here: screenshots cannot show a reload animation, recoil, a ragdoll fall or a dismemberment. One contact sheet can, and
  agents read images. This is the biggest blind spot agents have today: gun animation and gore are judged from single frames.
- Cost: nothing new to install.
- Verdict: **try now**: a `--video` or `--sheet` option on `shot.mjs`. For exact timing, step the frozen clock and take a shot every
  N frames instead.

**Before/after/difference pictures:** section 2, pixelmatch. **Try now.**

**Numbers in every run:** have `shot.mjs` print one small block per run: frame-time middle and worst, draw calls, triangles,
shader programs, GPU memory, console errors. Then every agent report carries numbers without anyone asking.

**Write-ups by people building three.js games with agents**

- "I made a Mario Galaxy game with Claude Code and Three.js in 53 days" (Hacker News, April 2026; summary at
  https://hnshowcase.com/post/47600002/i-made-a-mario-galaxy-game-with-claude-code-and-three-js-in-). 76,000 lines of TypeScript,
  Rapier with SIMD. Concrete lessons:
  - a 164-line project file of hard rules, each learned from a failure (this repo does the same);
  - custom skills that review plans and code for the agent's one recurring bad habit were what fixed that habit;
  - 87 short plan documents, split so the game stays runnable after each phase;
  - **level design by agent failed completely**, even with special tools;
  - having agents build tools nobody would have had time for was "one of the biggest wins".
- "The Librarian 2: What AI Game Building Can and Cannot Do" (August 2026,
  https://www.ai.joaoqueiros.com/blog/librarian-2-ai-game-development-claude-code-codex). A fully procedural three.js game with no
  asset files. Lessons: the first playtest found more than any code review; the design document is the real handoff between
  agents; keep game rules testable without rendering; seed all randomness; put a new player in front of it and say nothing.
- Simon Willison, "The October inflection point for vibe game development" (2026-10-28,
  https://simonwillison.net/2026/oct/28/vibe-game-development). Four small three.js games. Little on tooling. The useful part: the
  time went to playtesting story and gameplay bugs, not code, and blunt quality prompts now work.
- The New Stack, "AI agents, 3D and Playwright" (https://thenewstack.io/ai-agents-3d-playwright/): the site refused my request, so
  I only have a search summary: screenshots alone get less useful as a 3D app grows; give agents the scene's state as data.

What these agree on is what this repo already does. The two points this repo could still take: review skills aimed at its own
repeated mistakes, and motion evidence instead of still frames.

---

## Top 10, in order of expected benefit

1. **Screenshot difference tool** (pixelmatch) wired next to `shot.mjs`: before, after, difference picture, one number.
2. **Motion contact sheets** (Playwright Screencast + ffmpeg, both already on the machine): agents finally see animation and gore.
3. **Frozen time and seeded randomness for look checks** (Playwright Clock, already installed): makes 1 and 2 repeatable.
4. **fast-check property tests for the co-op protocol**, while the overhaul is in progress.
5. **Leak soak test** (webgl-memory + `renderer.info` over a bot run): proves the pools and caps hold over ten waves.
6. **Performance trace capture with a summary** (Playwright tracing + Perfetto trace processor) for stutter reports.
7. **Chrome's built-in packet loss for WebRTC** as a second network simulator below the game's own. Needs a short experiment first.
8. **A linter for house rules only** (oxlint or Biome), plus a one-off dead-code report (knip).
9. **Rapier: measure the SIMD build, and draw `debugRender()` in the lab.**
10. **threejs-devtools-mcp's Playwright helper** on one real visual bug; and read the QA notes in threejs-game-skills for bot
    measurements worth copying.

Every item is dev-only except 9, which swaps one physics package for its sibling.

## Looked for and did not find

- A screenshot-comparison tool made for WebGL games or for coding agents. Only general ones exist.
- A record-and-replay test library for a three.js game loop. It has to be built in-house.
- A bot-play or input-fuzzing library for browser 3D games. Only written patterns exist.
- An established three.js "did you dispose everything" checker. Threesmith's leak tool is two weeks old and unproven; webgl-memory
  is the closest solid thing.
- A trystero option, or an open request, for unreliable channels.
- A maintained TypeScript library that does snapshot interpolation, prediction and lag compensation together for peer-to-peer play.
  The maintained ones assume a server.
- A way to use WebTransport between two browsers. It does not exist.
- An official three.js MCP server. The official offering is the `llms.txt` files.
- An offline shader linter that understands three.js `#include` pieces.
- A maintained JavaScript library for distance-field modelling or baking, or for active ragdolls on Rapier.
- A write-up of an agent-built three.js shooter of this size with co-op, or any account of agents doing gun models and hand poses well.

## Not checked

- Nothing was installed or run. Compatibility comes from declared version ranges and docs.
- Star counts and dates are as of 2026-11-18.
- The New Stack article was not read in full (blocked).
- Whether Chrome's packet-loss setting reaches data channels between two local pages.
- The speed gain of the Rapier SIMD build in this game.
- Whether oxlint or Biome can express every house rule.
- Licence texts for FLIP, psrdnoise and stats-gl were not read; the licences given are what npm or GitHub report.
