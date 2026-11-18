# OVERPOWERED 2: gore and wound systems, web research

> Kept from the gore and ragdoll research round. The proposals built from it, with each idea checked against the code, are in [docs/proposals/gore-ragdoll-proposals.md](../proposals/gore-ragdoll-proposals.md). The code audit is [gore-audit.md](gore-audit.md); its companion on ragdolls is [ragdoll-techniques.md](ragdoll-techniques.md).

Research date: 2026-11-18. Scope: gore, wounds, blood, dismemberment visuals, gore audio and gore feedback. Ragdolls and physics animation are covered by another agent, and the code audit by another. Techniques and inspiration only: no art, names or assets to be copied.

How to read this:
- **Part A** goes game by game: what each game does and how, with sources.
- **Part B** is the technique catalogue. Each entry gives what it is, who does it best, how it works, browser cost, and whether it fits a fast FPS.
- **Part C** has three.js notes and code sketches for the strongest techniques.
- **Part D** is the top 12 ranked by wow per effort.
- **Part E** lists what I could not find.

Source quality key:
- **[P]** primary: developer slides, developer blog, shipped source code, or a developer quote.
- **[S]** secondary: press or community analysis.
- **[I]** my inference, not stated by any source.

---

## Headline findings

1. **The best primary sources are Valve's L4D2 wound slides and the Ghoul2 gore code.** The Ghoul2 code shipped open-source in the Jedi Academy codebase (the SoF2 engine family). Both solve "wounds on a skinned character" cheaply, and both map almost one to one onto three.js:
   - L4D2 discards pixels inside a bind-pose ellipsoid and drops in a shared wound mesh. Costs: 15 vertex and 7 pixel instructions. [P]
   - Ghoul2 projects a planar UV splat along the shot direction. It keeps only the triangles under the splat, references the original skinned vertices so the splat deforms with animation, and grows and fades it over time. [P]
2. **Wound masks in bind-pose space cost almost nothing.** Store each hit in the mesh's rest pose, not world space, and the wound never slides during animation (Tom Looman, L4D2, the UE forum work). In three.js the `position` attribute already *is* the rest pose, so this needs no engine change. [P][I]
3. **The dramatic stuff is post-process and timing, not geometry.** Killing Floor 2's Zed Time drains every colour except red. Hit-stop is a few frames of freeze. Gore audio is layered produce foley: celery, pasta, peppers. All three are cheap and all are proven. [P][S]
4. **Persistence sells carnage more than detail does.** KF2 keeps blood on the map all game. Vlambeer's "permanence" principle and Hotline Miami's corpses that stay while you backtrack make the same point. A FIFO-capped decal pool gets this in a browser. [P][S]
5. **Dead Island 2's FLESH is not magic.** Its dismemberment cuts the mesh by testing each triangle against a plane. Bones are pre-split chunks. The cut is always complete, with no half-severed heads. Viscera ships as one model and is split into draw calls only when it breaks. [P] Our katana cut-in-half is already in that family.

---

## Part A: game by game

### Soldier of Fortune / SoF2 (Raven, GHOUL / Ghoul2)

**What:**
- The first game has 26 gore zones on a modified Quake II engine, and each body part reacts separately. [S] https://www.linuxjournal.com/node/4381
- SoF2 has 36 damage zones and 16 dismemberment zones. [S] https://www.mobygames.com/game/xbox/soldier-of-fortune-ii-double-helix
- Zones also drive behaviour: shoot a knee and the enemy limps. [S] https://gamesfirst.com/articles/2000/soldier-of-fortune-2/

**How the Ghoul2 wound splats work** [P], from the GPL source in OpenJK, Raven's Jedi Academy codebase that shares Ghoul2. Files: `codemp/ghoul2/G2_gore.h`, `codemp/rd-vanilla/G2_misc.cpp` (`G2_GorePolys`) and `codemp/rd-vanilla/tr_ghoul2.cpp`. https://github.com/JACoders/OpenJK/blob/master/codemp/ghoul2/G2_gore.h , https://github.com/JACoders/OpenJK/blob/master/codemp/rd-vanilla/G2_misc.cpp , https://github.com/JACoders/OpenJK/blob/master/codemp/rd-vanilla/tr_ghoul2.cpp
- **Hit test.** A trace runs against the *posed* (transformed) model vertices. The texture under the hit can also hold a hit-location map and a hit-material map, read at the hit UV (`shader->hitLocation`, `shader->hitMaterial`). The *texture* says which zone or material was hit, so a painted mask defines the hit zones. No extra hitboxes are needed.
- **Projection.** It builds two axes perpendicular to the shot direction, with a random rotation `theta` and sizes `ssize` and `tsize`. For each vertex of the hit surface it computes splat UVs `s,t = dot(vertex − hitPoint, axis) + 0.5`.
- **Culling.** It keeps only triangles that touch the 0..1 square. An option keeps front faces only or back faces only, so one trace can stamp both the entry and the exit wound.
- **Storage.** It stores just the kept triangles' vertex *indices* into the original surface, plus the new UVs, per LOD. At render time the gore surface copies the already-skinned positions and normals, so **the splat deforms with the skeleton for free**. It draws as an extra surface with a gore shader. The default is `gfx/damage/burnmark1`, which is why lightsaber burns use this system.
- **Lifetime.** Per-splat `lifeTime`, `fadeOutTime`, `fadeRGB`, and a grow animation (`growDuration`, `goreScaleStartFraction`). The splat UVs are rescaled each frame so the wound *spreads* after the hit.
- **Budget.** `MAX_GORE_RECORDS (500)`, with the oldest evicted first.

**Fit:** excellent. This is the cheapest correct way to put wounds on animated enemies. The three.js version is in Part C.

### Left 4 Dead 2 (Valve): wound holes cut into the model

Primary: Alex Vlachos, "Rendering Wounds in Left 4 Dead 2", GDC 2010. https://cdn.fastly.steamstatic.com/apps/valve/2010/gdc2010_vlachos_l4d2wounds.pdf [P]

**Goals:**
- Accurate wound location.
- Wound size matched to weapon strength: remove a limb, the torso, the head, or half the body.
- Separate wound geometry and textures.
- They shipped with up to 2 active wounds per infected.

**Constraints:**
- Already at Xbox 360 memory limits.
- No heavy CPU setup, so a GPU solution.
- No new base meshes; wound models are shared across many infected.
- "Simplest infected has over 24,000 variations" from randomised parts and tints.

**Rejected approaches:**
- Pre-modelled wound combos.
- Index-buffer culling, which is LOD-unfriendly and gives poor silhouettes.
- Auto-generated meshes with holes cut in.
- Per-section authored variants.

**How it works:**
- **Pose-space ellipsoid cull.** The vertex shader takes the *pre-skinned* position, subtracts the ellipsoid centre, and dots it with the ellipsoid's three axes divided by its per-axis size. `length()` of that goes to the pixel shader as the clip/texkill input. The xy of the same vector is the projected texture UV. The talk shows the actual shader code.
- **Wound model.** A separate draw call with its own textures, attached to the base skeleton, fills the hole.
- **Projected texture.** The first prototype's hard ellipsoid edge "looked unnatural", and the wound needed "a lip around the border". The fix projects a texture whose alpha also kills pixels for ragged edges, and adds a **blood layer** around the hole multiplied by a gradient "to prevent the blood from spraying too far".
- **Abdomen case.** A projected texture alone would also cut the back, so they combine it with the ellipsoid limit.
- **Gotchas.** Depth-only and shadow passes must apply the same cut ("You don't want phantom shadows"). Hi-Z performance issues appear, because discard defeats early depth rejection.
- **Stats.** Up to 54 unique wounds per model. Each wound costs 13% of the memory of the L4D1 system. Vertex shader 15 instructions, pixel shader 7. "Fill-bound, so rendering perf impacted minimally."
- **Catalogue of wound types.** Upper and lower back, groin, arms and legs, abdomen, head, half body, axe and sword slashes, upper body.

Community ports:
- UE4 forum ports confirm the recipe and its pain points: you need bind-pose position, and pre-made skinned wound meshes break when morph targets are used. https://forums.unrealengine.com/t/wip-dynamic-left-4-dead-2-style-wounds-dismemberment/46775 [S]

**Fit:** excellent for heavy hits. Close shotgun blasts, explosive rounds and the beam can carve real holes with a wound insert behind. Browser cost: cheap. It is one extra uniform set and a discard. The one cost is that a material with discard loses early-Z, which is minor on enemies.

### Killing Floor 2 (Tripwire): M.E.A.T., persistent blood, Zed Time

**Dismemberment points:** 19 per Zed in Aug 2014, 5 of them on the head. Later 2014 coverage says 22. Sources disagree; the count rose during development. [P quotes in S]
- Hensley: "you can use this information as a barometer of difficulty", meaning visible damage tells players how close an enemy is to death. https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/
- https://pcgamesn.com/killing-floor-2/painting-paris-red-with-killing-floor-2s-meat-system
- https://www.gamewatcher.com/2014-12-12-tripwire-interactive-talks-killing-floor-2-and-enhanced-dismemberment-engines-during-panel-event (also mentions 95 death animations)

**Persistent blood:**
- Munk: "wouldn't it be badass if the blood from all these bad guys stayed on the map? … That's basically our entire design strategy."
- As the reporter describes it, the level's surfaces are layered over a pre-blooded base, and blood "peels back" the top layer. Hensley: done "in a way that caused no memory lag or frames-per-second issues". (GamesBeat, above)
- Bloodstains are permanent on maps. [S] https://wikipedia.com/wiki/Killing_Floor_2

**Corpse juggling:** dead Zeds can still be dismembered ("We call this Zed juggling"). (GamesBeat)

**Zed Time:**
- A slow-motion moment that "amps up the gore by desaturating the world of everything but the colour red". [S summarising the dev diary] https://pcinvasion.com/?p=89857
- Alan Wilson: "That's what you want in Zed Time, is the gore. So let's enhance that element of it." [P quote via S] https://gamersdecide.dev.weebpal.com/pc-game-news/killing-floor-2-gameplay-5-things-die
- Tripwire had to fix engine parts that broke under slow motion, and resync audio. [S] https://www.pcgamer.com/killing-floor-2-gore-system

**FleX blood (PC, NVIDIA GPU only):**
- Soft tissue and fluid particles, with blood and bile mixing.
- The menu recommended a GTX 980 for full FleX.
- Expensive, and impossible in WebGL. Useful as proof that particle gore is "nice to have", not the core.
- [S] https://www.tomshardware.com/news/nvidia-gameworks-flex-killing-floor,29392.html , https://www.pcgamer.com/how-nvidia-physx-flex-will-power-bile-blood-and-gibs-in-killing-floor-2

**Fit:**
- Zed Time's red-only grade is the single cheapest high-impact idea in this doc. It needs one post-process pass. It suits our slow-mo moments, katana kills, chip effects and nukes.
- Persistent blood and corpse juggling also fit.

### Dead Island 2 (Dambuster): FLESH

FLESH stands for "Fully Locational Evisceration System for Humanoids". [P via S] https://kotaku.com/ama-reddit-dead-island-2-weapons-flesh-system-ps5-xbox-1850415887

**Layers:**
- Every zombie type uses the same setup, so damage anywhere goes "through the layers of skin, fat, muscle, and then break through to bones and the internal organs" (Dan Evans-Lawes). [P] https://www.theloadout.com/dead-island-2/realistic-zombies-gore-system
- Structure: "Zombies are built out of a surface mesh and a set of 'viscera' meshes" (Aaron Ridge, render programmer, Reddit AMA). [P via Kotaku, above]
- The outer flesh has real thickness, not "a wafer-thin, single-sided mesh". The first version had an undamageable solid core. They changed it so you can "blast holes straight through", filling the hole with destructible guts. [P via Kotaku]

**Dismemberment:**
- "we dynamically split the mesh across a cutting plane, testing each triangle to determine what side it lands on." The cut is then closed with a "Kinder egg man" technique (not described further) "to close it up and detail the wound".
- "The viscera which makes up the bones is split into fixed pieces, but the mesh is dynamically cut."
- Rules: "it always has to be a complete cut; we don't support making a zombie nearly-headless", and "we always have some attachment to the spine remaining". [P via Kotaku]

**Draw calls:** "The viscera itself comes in as one model, but we split up the draw call when we break it apart." Viscera is shared across zombies with a few variations. [P via Kotaku]

**Limits:** a freezing effect was cut partly because "we quickly maxed-out the number of textures we could look up in a single zombie material". Shader texture count is a real budget even on consoles. [P via Kotaku]

**Sound:**
- "The sound team twisted frozen celery to simulate the sounds of snapping limbs and bones."
- "smashing pasta was excellent for simulating visceral crunchy noises."
- [P] https://culturedvultures.com/dambuster-studios-talk-dead-island-2-interview/

**Fit:**
- The layered idea scales down well. One shared inner "wound cup" or viscera mesh per body region, plus a layered mask in the skin shader (skin → fat → muscle → bone colours by mask depth), gets most of the look.
- The full layered simulation is not worth it for a 48-enemy browser FPS.

### Resident Evil 2 remake (Capcom, RE Engine)

- Director Kazunori Kadoi wanted gunshot and explosion damage to show *immediately* on limbs and heads. Off-centre headshots mangle a face without killing. Gait changes with damage. [P quotes via S] https://www.newsweek.com/entertainment/video-games/resident-evil-2-wet-gore-remake-director-kazunori-kadoi-zombies-shotgun-night-1305780 , https://www.syfy.com/syfy-wire/resident-evil-2-remake-horror-gore-zombie-evolution
- I found no CEDEC or technical talk on the RE2 or RE4 wound tech (see Part E).
- Newer: Capcom had RE Engine engineers build a "Dynamic Dismemberment System" for *Onimusha: Way of the Sword*. It cuts along the sword's actual swing trajectory for certain attacks. The team deliberately avoided MGR-style free cutting because it did not suit the pace. [S] https://gameinformer.com/exclusive-feature/2026/08/13/capcom-had-to-ask-re-engine-engineers-to-create-the-dynamic , https://gamingbolt.com/?p=655608
- **Fit:** "wound appears exactly where you shot, instantly, and changes behaviour" is the bar. We already have crawling maimed enemies. Cutting along the swing trajectory suits our katana, since there's no aiming mode.

### Sniper Elite (Rebellion): X-ray kill cam

- V2 shows skin, bones and organs. SE3 adds muscle and the circulatory system. SE5 lets bullets deflect off bone at angles. [S] https://www.pcgamer.com/sniper-elite-3-trailer-explores-the-gruesome-detail-of-the-x-ray-killcam , https://fingerguns.net/news/2022/05/22/sniper-elite-5-shows-off-its-enhanced-kill-cam-skills/
- Tim Jones: the goal was "to track it through the body and see how it breaks bones, punch holes through skulls".
- Whether the cam fires depends on a hidden score: was the target moving, how hard was the shot, which body part. "the engine has to pick from on the fly in any given situation to make sure it's both valid and looks cool". Cameras must not be "staring at a wall with the bullets on the other side". [P] https://mcvuk.com/?p=23739
- The rendering method isn't public. Likely approach [I]: a skeleton-and-organ mesh skinned to the same rig, with the skin drawn as fresnel or transparent during the cam. Damaged organ and bone variants swap in at the bullet path.
- **Fit:** a rare-event treat, such as an explosive-round headshot at range or the last kill of a wave. The cost is assets (one shared skeleton and organ set) plus one camera. Browser cost: medium. Gate it so it is rare and skippable, because a fast FPS can't stop often.

### Metal Gear Rising: Revengeance (PlatinumGames): free cutting

- Own engine. "at first, our engine wasn't capable of doing something like cutting through an opponent anywhere"; object cutting took about three months.
- "This freedom to cut anywhere turned out to use an amount of memory far greater than any other processes in the system." So "the process … would be distributed over multiple frames" and "finished before the end of the swing". [P] https://platinumgames.com/official-blog/article/4732
- **Caps:** a cut forms "two new surfaces". Caps are parametric: "By changing a few figures, we can switch the surface to anything we want". On a fruit, "horizontal cuts give us an orange and vertical cuts give us a watermelon". Enemies need "different surfaces for each part of the body" and "for different angles of cuts". [P] https://platinumgames.com/official-blog/article/4748
- Hit reactions were hand-authored, one cut angle at a time. [P quoted in S] https://simonschreibt.de/tag/rising/
- **Fit:**
  - Two ideas carry straight over to our katana. Pick the cap texture by body region and cut angle. Spread cut work over the frames of the swing, so you never compute it all in the frame of the hit.

### The Last of Us Part II (Naughty Dog)

- Dynamic blood drips appear on body parts when shot or cut. [P patch notes, via S] https://gamingbolt.com/the-last-of-us-part-2-20-tiny-but-amazing-details-you-may-have-missed
- Hot blood pools out of corpses and melts the snow around them. Blood soaks through bandages over time. [S] (same)
- The blood and bile used a "blood package" shader by technical shader artist Steven Tang. No internals are public. [S] https://80.lv/articles/using-unreal-engine-to-recreate-bloody-scene-from-the-last-of-us-part-2/
- GDC 2021 included a screen-space particle simulation talk applicable to droplets and blood. [S] https://www.famitsu.com/news/202108/02228953.html
- **Fit:** pools that keep growing after death, and drips that keep falling from wounds, are cheap and highly readable.

### Doom Eternal (id): destructible demons

- "Internally we call it destructible demons" (Hugo Martin). Hits strip chunks of armour and flesh, the body progressively deteriorates, and losing parts changes behaviour: destroy a weapon arm and it can't fire. [S] https://www.pcgamesn.com/doom-eternal/doom-eternal-destructible-demons , https://www.pcgamer.com/hugo-martin-doom-eternals-destructible-demon-system-makes-such-an-impact-2016s-doom-is-now-hard-to-play/
- id renders decals in the clustered forward pass from an atlas, with up to 256 decals per cluster (Doom 2016 study). [S, detailed] https://www.adriancourreges.com/blog/2016/09/09/doom-2016-graphics-study
- **Fit:** armour pieces that break off are a good gore *and* readability tool for our armoured humans and the mech. Our existing dismemberment can carry the behaviour changes.

### Dead Space remake (Motive): peeling

- Each Necromorph is built outward from the skeleton: organs, flesh, tendons, fat, skin. Each layer can be peeled off in chunks. The layering also lets blunt and fire weapons matter, not just cutting ones. [S, EA/Epic interview] https://store.epicgames.com/news/inside-dead-space-2-the-new-necromorph-nightmare
- **Fit:** same lesson as FLESH. Damage should visibly change the body before the kill.

### Mortal Kombat (NetherRealm)

- The X-ray moves (MK9 onward) got a SIGGRAPH talk on the art process. [S] https://history.siggraph.org/?p=143769
- The earlier X-ray attacks gradually dissolved the outer layer away and back. [S, Polycount] https://polycount.com/discussion/comment/2683572/
- MK11's slow-motion fatalities were the hardest part to render. [S] https://gamingbolt.com/?p=382751
- **Fit:** the skin-dissolve-to-skeleton transition is one shader parameter. It's a reference for the X-ray idea.

### Gears of War, Halo, Postal, Ready or Not, MGS V, Fallout

- **Gears:** UE3 heritage, chainsaw gibs. No technical source found.
- **Halo, Postal:** no technical gore source found.
- **Ready or Not:**
  - An early devlog describes a bullet-hole blood emitter: when wounded bodies knock into objects they leave small splatters, based on bone velocity. [S] https://www.thesixthaxis.com/?p=287492
  - After the console certification changes, dead bodies can no longer be dismembered, but the living still can. [S] https://insider-gaming.com/all-ready-or-not-censorship-changes-before-after-explained/
- **MGS V:** Snake visibly accumulates blood on his body. [S] https://twinfinite.net/pc/heres-just-how-bloody-snake-can-get-in-mgs-v-the-phantom-pain/
  - Idea: blood that builds up on our viewmodel arms and gun.
- **Fallout (Bethesda BodyPartData):** each body part has a severable flag, a cut and gore target bone, a "Meat Cap TextureSet" and a "Collar TextureSet", and cut min/max, radius and tessellation. Prebuilt cap meshes ship with the body mesh, and cap indices map to body segments. [S, CK wiki via search snippet; page itself 403] https://falloutck.uesp.net/wiki/BodyPartData , https://forums.nexusmods.com/topic/530086-nifskope-bsdismemberskininstance-partitions
  - Prebuilt caps are the "authored" end of the dismemberment spectrum.

### Indie and others

- **Shadow Warrior (2013, Flying Wild Hog)** [P] ZTG 2014 slides: https://www.slideshare.net/slideshow/the-technology-behind-shadow-warrior-ztg-2014/40789491
  - "must have skinned decals."
  - Deferred decals "float when mesh is animated", so they used geometry decals grown from the hit triangle over adjacency.
  - Dismemberment first recomputed decals on destruction: "5 enemies destroyed at once can produce 50 jobs", and it blinked. They switched to hand-made limb meshes, and split existing decals so they stay "available instantly".
  - Budget: "Decal size hard limit: 10k vertices", "Decal count limit: 100 decals (FIFO)", "Vertex memory: 30 MB total, in pool". About 0.5 ms per 500-triangle bullet decal (async, i7).
  - Decals animate by "alpha test level shifting". Lower the alpha reference over time and the decal grows.
  - "Big decals: skinned geometry rendered multiple times, avoid them."
- **Brutal Doom (GZDoom mod)** [S]
  - Pools form around dead monsters. Blood drips from ceilings. Spray presets range from "Low" to "Comical".
  - One CVAR caps blood pools, gibs and debris for low-end machines.
  - The cleaner "Bolognese" gore mod was split from it. https://dsogaming.com/?p=77719 , https://doomwiki.org/wiki/Br%C3%BCtal_Doom
- **Hotline Miami** [S]: corpses and blood stay when you backtrack, which gives the post-mission feeling. No developer technical source found. https://itch.io/post/4275463
- **ULTRAKILL** [S]: gore is a mechanic, not decoration. Enemy blood near you is how you heal. https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/ULTRAKILL
  - Fits our satire if blood ties to a stim or chip mechanic. No technical source found.
- **Chivalry 2** [S]: players pick up severed heads and limbs and throw them as weapons. Torn Banner: gore "is there to add to the satisfaction of kills", in an over-the-top film style. https://www.pcgamer.com/decapitated-human-heads-are-my-weapon-of-choice-in-chivalry-2 , https://www.gamingbible.co.uk/features/games-chivalry-2-interview-gory-multiplayer-action-hollywood-style-20210625
- **Mordhau** [S]: limbs fly from strikes, with partial (not total) dismemberment. Blood and gore can be turned off. No technical source.
- **Exanima** [S]: blood decals exist as a system, and brushes clean weapons. No internals found. https://www.gogdb.org/product/1470768488/releasenotes
- **Ravenfield** [S]: gore comes from Workshop mutators, such as damage thresholds that cut below or above the joints. https://top-mods.com/mods/ravenfield-mods/mutators/11684-lemieux-s-gore-2.html
- **Severed Steel** [S]: bullet time, particles and voxel destruction. MobyGames credits a "Bullet and Gore Particles" role. No gore internals. https://www.unrealengine.com/developer-interviews/severed-steel-is-an-fps-inspired-by-superhot-and-hotline-miami-made-mostly-by-a-solo-dev
- **Trepang2** [S]: has full-body dismemberment (devs showed it in videos). No technical source reachable. https://www.dsogaming.com/news/new-demo-coming-for-fear-inspired-indie-fps-trepang2-new-videos-show-full-dismemberment/
- **ILL (Team Clout)** [S]: severed limbs collide physically and knock down other enemies. Severed limbs can become separate threats. https://80.lv/articles/how-ill-combines-body-horror-physics-and-binaural-audio-to-terrify-players/
- **The Callisto Protocol** [S]:
  - A gore system took "two and a half years". Schofield: "it's just chunks. You can take pieces off the character all over." https://gamingbolt.com/the-callisto-protocols-gore-system-took-a-couple-years-to-developer , https://gameinformer.com/exclusive-feature/2022/06/23/designing-the-creatures-and-gore-of-the-callisto-protocol
  - The technical interview (Twinfinite) was blocked.
- **UEGoreSystem (UE plugin)** [P docs]: https://github.com/Klian326/-Public-UEGoreSystem/wiki/3.-Auto-Dismemberment
  - Auto-dismemberment with no pre-cut assets: clone the character, hide everything except the broken bone hierarchy, and simulate the clone. Per-bone health. Socket-placed spill VFX.
  - "That avoids a one-frame hole between hide and spawn."
  - This is the same trick as cloning a SkinnedMesh and collapsing bones in three.js.
- **gorescript (three.js retro FPS, MIT)**: a browser shooter whose code is open. https://github.com/gorescript/gorescript
- **Teardown, Rain World, Zero Sievert, Gunfire Reborn, Splitgate:** no gore-tech sources.
  - Gunfire Reborn and Splitgate are deliberately low- or no-gore, so they aren't useful here.
  - Teardown's voxel engine is a destruction reference, not a gore one. https://80.lv/articles/teardown-developer-breaks-down-multiplayer-and-voxel-destruction-tech

---

## Part B: technique catalogue

Cost labels are for three.js r187 WebGL2 on an 8 GB M1 with up to 48 enemies:
- **cheap:** under about 0.3 ms GPU and trivial CPU.
- **medium:** needs care, pooling or per-event CPU work.
- **expensive:** avoid or keep for one-off moments.

### B1. Bind-pose wound masks in the skin shader
- **What:** a per-enemy uniform array of recent hits (point, radius, type, time). The skin shader darkens and reddens around each hit, adds a wound centre, and raises wetness.
- **Best:** Tom Looman's write-up; the L4D2 ellipsoid is the same idea with a hole.
  - Looman's advice: "Anything between 3-5 hits should be fine". Render-target painting cost "1.6-4.5ms on my GTX 850M", so he dropped it for pure sphere masks: "no RT per enemy". https://tomlooman.com/unreal-engine-render-character-wounds/
- **How:**
  - Convert the hit to the mesh's rest pose. That means the rest-pose interpolation of the hit triangle's vertices, or inverse-bone-then-bind transform.
  - In the vertex shader, pass `position` (rest pose, before `#include <skinning_vertex>`) as a varying.
  - In the fragment shader, loop the N hits with `smoothstep` falloff. Noise the edge (Looman's HeightLerp) so it isn't a perfect sphere.
  - Animate the radius over time for blood soaking outward. Shift colour and roughness from wet to dry.
- **Cost:** cheap. About N×10 ALU per pixel on enemy pixels only. No textures, no render targets.
- **Fit:** yes. This is the base layer that makes every bullet leave a mark. Use N=8, a ring buffer per enemy, and pack data in a `vec4[8]`.

### B2. Skinned splat decals that share the skeleton (Ghoul2 or Shadow Warrior style)
- **What:** a textured wound or blood splat that hugs the animated mesh and deforms with it.
- **Best:** Ghoul2 (shared-vertex gore surfaces with grow and fade) and Shadow Warrior (geometry decals, FIFO 100).
- **How (three.js) [I]:**
  - On a hit, take the skinned mesh's triangles near the hit and project planar UVs along the shot direction, as `G2_GorePolys` does.
  - Keep the triangles that touch the splat. Build a new `BufferGeometry` that *reuses the original* `position`, `normal`, `skinIndex` and `skinWeight` attributes (shared GPU buffers), with its own small index buffer and a new `uv` attribute.
  - Wrap it in a `SkinnedMesh` bound to the *same* `Skeleton`, rendered with polygonOffset and a decal material.
  - With `backFaces` set, a second pass at the far side of the body gives a **larger, rougher exit wound**.
- **Cost:** cheap to medium. Building the decal on the CPU costs about 0.1–0.5 ms per hit [I, from Shadow Warrior's ~0.5 ms for 500 tris]. Add one draw call per decal, or merge per enemy. Cap it globally (FIFO, around 64–128).
- **Fit:** yes, it's the best visual-per-ms option for "wound textures" on enemies. Use it for big hits and exits; B1 covers small hits.

### B3. Shader-cut holes plus wound inserts (L4D2)
- **What:** a discard-based hole inside a bind-pose ellipsoid, a ragged-edge alpha texture, and a blood ring. A shared, authored "wound cup" mesh (flesh and bone interior) is parented to the nearest bone and fills the hole.
- **Best:** Valve, L4D2.
- **How:** see the L4D2 section. Apply the same discard in `customDepthMaterial` and `customDistanceMaterial` so shadows also have the hole [I, three.js mechanism].
- **Cost:** cheap on the GPU (15 VS and 7 PS instructions in 2010). One extra draw for the insert. Content cost: a small set of insert meshes per region (chest, gut, thigh, head, half-body).
- **Fit:** strong for shotgun point blank, explosive rounds and the beam. Gives "through-and-through" holes you can see light through. Watch for:
  - discard on the enemy material disables early-Z for those pixels (L4D2's "Hi-Z performance issues"), so only switch to the discard variant after the first big hit (Looman suggests swapping shaders on first hit);
  - the insert needs an inside-facing lip to hide the seam.

### B4. Plane slicing with caps (katana)
- **What:** cut the posed mesh along a plane into two meshes and cap the cross-section.
- **Best:**
  - MGR (free cut, parametric caps by angle, work spread over the swing).
  - DI2 (cut by per-triangle side test, bones as pre-split chunks, always a complete cut).
  - Onimusha (cut along the swing trajectory).
- **How:**
  - Freeze the pose: bake skinned vertex positions with `SkinnedMesh.applyBoneTransform`. Split triangles by side, clipping the straddling ones.
  - Collect the cut-edge loop and triangulate it into a cap. Ear clipping is fine for one loop; ezy-slice uses monotone chain for convex slices. https://github.com/filkata123/ezy-slice
  - Give the cap UVs from the plane basis and a material picked by body region and cut angle (MGR).
  - Insert pre-split bone and viscera chunks at the cut (DI2).
  - Alternatively, keep both halves skinned. The ezy-slice fork and LimbHacker track bone weights per new vertex. https://github.com/kenamis/LimbHacker
- **Libraries:**
  - **three-pinata** (MIT, three ≥0.158) slices and fractures in real time. Two material groups: 0 for the original surface, 1 for cut faces. It needs watertight meshes and has no SkinnedMesh support, so freeze the pose first. "10-50 fragments is optimal." https://github.com/dgreenheck/three-pinata
  - **three-bvh-csg** (MIT) is "More than 100 times faster than other BSP-based three.js CSG libraries" but drops `skinIndex` and `skinWeight` by default and is "experimental". https://github.com/gkjohnson/three-bvh-csg
- **Cost:** medium. It's CPU work per cut on a mesh of a few thousand triangles. Spread the work over the swing frames (MGR), or pre-warm with a worker [I].
- **Fit:** we already have cut-in-half. The cheap upgrades are caps that depend on region and angle, viscera inserts, and cutting along the actual swing.

### B5. Prebuilt caps on skinned dismemberment (Fallout style)
- **What:** each severable joint has an authored cap mesh (stump and limb end) hidden until the cut.
- **How:**
  - Collapse the severed bone chain's scale to zero on the body. UEGoreSystem does the same: it hides everything except the broken hierarchy on a clone.
  - Spawn the detached part as a clone with only that chain visible. Show the two caps.
- **Cost:** cheapest dismemberment there is: no geometry work at runtime.
- **Fit:** this is probably what OVERPOWERED 2 already does. Keep it for bullets and explosions, and use B4 only for the katana.

### B6. Blood particles: real fluid vs tricks
- **Real fluid:** KF2 FleX needed NVIDIA PhysX and a GTX 980 class GPU. https://www.tomshardware.com/news/nvidia-gameworks-flex-killing-floor,29392.html
  - **Expensive:** no WebGL path. WebGPU compute could do SPH, but it's not worth it here.
- **Tricks (what nearly everyone does):**
  - A burst of stretched billboards, or instanced low-poly droplets with gravity.
  - Each droplet that lands writes a decal (floor or wall) from a pool.
  - A mist puff (soft additive or alpha sprite).
  - A few "ribbon" streams for arterial spray.
- **three.js:**
  - three.quarks batches and instances on the CPU, with GPU simulation listed as WIP. https://libraries.io/npm/three.quarks
  - @newkrok/three-particles has optional WebGPU compute. https://newkrok.github.io/three-particles/api/
  - On WebGL2, our own `InstancedMesh` emitter with the integrator in the vertex shader (start pos, velocity, birth time as instance attributes; `pos = p0 + v*t + 0.5*g*t²`) costs zero CPU per particle [I].
- **Cost:** cheap if the simulation is in the shader and nothing collides. Use a single raycast per "lead" droplet to place the splat decal, not one per particle.
- **Fit:** yes. Combine shader-integrated droplets with a few raycast leaders that land decals.

### B7. Decals on the world: projected meshes, screen-space, or baked paint
- **Projected mesh decals:** three.js `DecalGeometry` clips the target's triangles against a box and generates UVs. It distorts around corners ("decal projections can be distorted when used around corners"). It reads only `position`, not skinning, so on a SkinnedMesh it projects onto the bind pose. https://threejs.org/docs/pages/DecalGeometry.html , https://github.com/mrdoob/three.js/blob/dev/examples/jsm/geometries/DecalGeometry.js
  - **Cost:** medium CPU per decal on big meshes. Pool and FIFO, and dispose of geometry and materials when evicted.
- **Screen-space or deferred decals:** a box is rasterised and reads scene depth. The pixel reconstructs its position and gets `clip(0.5 - abs(pos))`, with UV = pos.xz + 0.5. Uses include "Blood splat on the wall or ground". Problems: side stretching on steep angles (they reject normals beyond about 60°), cost when the camera is inside a box, and slowdown when large decals stack. [P] Pope Kim, Space Marine: https://www.slideshare.net/blindrenderer/screen-space-decals-in-warhammer-40000-space-marine-14699854
  - In three.js forward rendering this needs a depth texture pass. Getting normals needs a normal pass or depth derivatives.
  - **Cost:** medium. It's fill-bound, so keep decals small.
- **Clustered forward decals:** Doom (2016) applies decals inside the mesh shader from an atlas, with a per-cluster list of up to 256. https://www.adriancourreges.com/blog/2016/09/09/doom-2016-graphics-study
  - The browser version is our world shader reading a small uniform or texture list of decal boxes. The project's `DECAL_GLSL` in `render/materials` suggests something like this may already exist. (Checked: `DECAL_GLSL` is the generated decal atlas, not a clustered decal list; world decals are one `InstancedMesh` ring of 2048 in `src/render/Decals.ts`. See the proposals doc, section 3.)
  - **Cost:** cheap per pixel if the decal list is bounded per area.
- **Baked paint (Splatoon or KF2 style):** paint into a render target in each surface's lightmap or unique UVs, with sphere masks in world space. It needs unique non-overlapping UVs and one render target per painted surface set. https://www.kodeco.com/6817-dynamic-mesh-painting-in-unreal-engine-4
  - **Cost:** medium (memory). It does give unlimited permanent blood at no per-frame cost. It suits floors once the level has a lightmap-style UV set.
- **Fit:** stay on the decal path we already have, with a FIFO cap. Consider baked floor paint later for true KF2-style map-wide persistence.

### B8. Blood pools under corpses, and drag or crawl trails
- **Best:**
  - Brutal Doom (pools around kills).
  - TLOU2 (pools that keep growing, melting snow).
  - The Ghoul2 grow parameters.
  - Shadow Warrior's alpha-reference shift.
- **How:**
  - One pool decal per corpse, spawned at the pelvis or chest bone after the body settles.
  - In its shader: `alphaThreshold = mix(0.9, 0.2, smoothstep(0, growTime, age))` against a noisy radial height texture, so the pool *spreads* irregularly over 5–15 s. Brightest and wettest at the centre.
  - Crawlers and dragged bodies: every N cm of travel, drop a smear decal stretched along the motion direction, alternating hand prints.
  - A Godot shader shows a smooth growing trail with a drying tween. https://godotshaders.com/shader/bloody-pool-smooth-blood-trail/
- **Cost:** cheap. A few decals, with growth done in the shader.
- **Fit:** strong. Our crawling maimed enemies make trails that tell a story.

### B9. Wet look: sheen, drying and drips
- **How:**
  - Fresh blood: dark saturated red albedo, roughness about 0.15–0.25, a slightly raised clearcoat or specular.
  - Over 20–90 s: roughness rises to about 0.6, albedo darkens toward brown-red, and the edge dries before the centre.
  - Gears Tactics' wet function notes that darkening albedo, not just lowering roughness, avoids the "everything looks shiny" look. https://80.lv/articles/how-splash-damage-built-efficient-material-systems-for-gears-tactics
  - Looman suggests drying and fading wounds over time (above).
  - Drips: a few droplets per second from fresh wounds for 2–4 s, from the wound's bone socket, as in TLOU2's dynamic drips.
- **Cost:** cheap. A uniform per decal or wound, and a time comparison.
- **Fit:** yes. It's nearly free and makes everything look fresher.

### B10. Arterial spray
- **What:** a pulsing jet from a neck or limb stump for 1–3 s after a sever.
- **How [I]:** an emitter on the stump bone. Rate and velocity are multiplied by `max(0, sin(t*2π*1.4))^3` for pulses, and the pulse amplitude decays over time. A few droplets per pulse land decals on walls (wall splats look best).
- **Cost:** cheap.
- **Fit:** yes, mostly as satire. It makes the stump read clearly at FPS speed.

### B11. Gibs and bone or organ props, pooled
- **Best:** Brutal Doom (capped gib count), Callisto ("just chunks"), ILL (limbs hit other enemies).
- **How:**
  - A pool of 8–16 gib meshes (chunk, rib piece, jaw, finger, organ blob) shared by all enemies, drawn with `InstancedMesh` or `BatchedMesh`.
  - Physics: cheap ballistic plus a ground plane, or a few light Rapier bodies with a short lifetime.
  - Each gib emits a short blood trail and splats a decal where it first lands.
  - Optional: gibs hitting enemies cause flinch or knockdown (ILL).
- **Cost:** cheap with instancing. Physics cost is the limit, so cap live Rapier gibs at about 24–32.
- **Fit:** yes, for explosive rounds, nukes and mech stomps. Keep a global cap and a quality setting, like Brutal Doom's single gore CVAR.

### B12. Burn and char (beam weapon, nukes, fire)
- **Best:** Ghoul2's default gore shader is a burn mark (lightsaber), and DI2's clothes really burn.
- **How [I]:**
  - A per-enemy `burn` mask, either the same hit list as B1 tagged "heat" or a body-wide factor.
  - Albedo goes black, roughness to 0.9.
  - A thin emissive orange band where noise is near the threshold (the classic dissolve-edge trick).
  - Ember particles and smoke sprites.
  - With enough burn, the threshold also discards: clothes burn away and reveal charred skin underneath. That needs a second texture or a darker tint of the same one.
- **Beam:** it naturally leaves a cauterised hole. Use B3 with an emissive rim and no blood ring.
- **Nuke:** a full-body char plus a short "skeleton flash" (MK X-ray dissolve) is a cheap, iconic payoff.
- **Cost:** cheap.
- **Fit:** strong. Weapon identity: beam = burns, flechettes = many small punctures, explosive = holes and gibs.

### B13. Exit wounds and through-and-through
- **How:**
  - A second hit-point query along the ray *after* it leaves the body: raycast the same skinned mesh from beyond it, back along the shot direction.
  - Stamp a larger, rougher splat (B2 with back faces) plus a spray cone of blood out of the exit, which hits the wall behind and places a wall splat.
  - High calibre or explosive: a B3 hole you can see through.
- **Best:** Ghoul2's back-face option makes this one call. The wall splat behind the target is the most readable cue in fast play. Space Marine lists blood splats on walls as a core decal use.
- **Cost:** cheap. One extra raycast and two decals.
- **Fit:** very high. Players read "that went through" instantly.

### B14. Armour shatter and plate spall
- **Best:** Doom Eternal (armour chunks fly off; behaviour changes), Dead Space peeling.
- **How:**
  - Armour pieces are separate meshes per bone with HP.
  - At 0 HP, hide the piece, spawn 3–6 pooled shards with the plate's material, and a spark and dust burst (spall).
  - Expose the B1-damaged body under it. Optionally make that region take more damage.
  - For the mech: panels fly, sparks, hydraulic fluid in place of blood.
- **Cost:** cheap at runtime. Content: armour split per region.
- **Fit:** high. It shows progress on tough enemies (KF2's "barometer"), and makes the shotgun and explosive rounds feel distinct.

### B15. Layered anatomy reveal (FLESH or X-ray lite)
- **What:** as damage builds, a mask reveals skin → muscle → bone. In a kill cam, the skin fades away to show the skeleton and organs.
- **How [I]:**
  - In-game: the B1 mask strength picks between three colour and roughness sets plus a normal-perturbation noise. No extra meshes.
  - Kill cam: one shared skeleton and organ mesh skinned to the same rig, shown during the cam. Fresnel-fade the skin (MK's dissolve). Swap the hit bone for a fractured version.
- **Cost:** in-game, cheap. Kill cam, medium (assets).
- **Fit:** the in-game layering fits. Make the kill cam rare (Sniper Elite scores shots to decide when to show it).

### B16. Gore audio
- **Best practice:** layering produce and props.
  - DI2: frozen celery for snapping bones, smashed pasta for crunch.
  - Scorn: "Bone and rock are great for making grind and crunch sounds"; flesh squish from market vegetables.
  - Film foley: celery in a wet chamois for bone under skin, peppers ripped for flesh, melon for a sharp break.
  - Sources: https://culturedvultures.com/dambuster-studios-talk-dead-island-2-interview/ , https://www.asoundeffect.com/scorn-game-audio , https://nofilmschool.com/want-perfect-gory-sound-how-you-create-it
- **How (runtime) [I]:** build each gore event from 3 layers picked at random and pitched ±8%:
  1. Impact transient (thump or crack) scaled by calibre.
  2. Material layer (wet squelch for flesh, crunch for bone, clank for armour).
  3. Tail (drip or splatter, delayed 80–200 ms, at the splat's world position).
  - Duck the music and other SFX by 2–3 dB for 150 ms on dismemberment.
  - Use WebAudio with pooled AudioBufferSourceNodes and a limiter.
  - Record our own produce; never use library assets we don't own.
- **Cost:** cheap.
- **Fit:** very high. Sound sells gore more than polygons do.

### B17. Hit-stop, screen feedback, and the red-only grade
- **Hit-stop:** freeze or near-freeze the game for a few frames on heavy hits. More powerful hits get longer pauses (Sakurai's Famitsu column). https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
  - Vlambeer's "Art of Screenshake" lists "Sleep (pause game on hit)" and "Permanence (corpses)" as juice. https://medienwissenschaft.uni-bayreuth.de/wp-content/uploads/GxD-10-Game-Feel.pdf
  - Suggested values [I]: dismember 40–60 ms at 5% timescale, katana bisect 80 ms, headshot gib 50 ms. Never on ordinary body shots. Fast FPS players hate stutter, so keep it under 100 ms and never stack.
- **Red-only grade:** KF2 Zed Time. A post pass: `lum = dot(c, vec3(.299,.587,.114)); redness = smoothstep(0.15, 0.35, c.r - max(c.g, c.b)); out = mix(vec3(lum), c, redness)`. Ease in and out over 150 ms. [I shader; P idea]
- **Screen blood:** a few viewmodel or lens droplets when gibbing at close range, wiped after 1–2 s. Our lens layer could do this.
- **Cost:** cheap.
- **Fit:** very high.

### B18. Gore scaled by calibre and weapon
- **Best:**
  - SoF zones and limp behaviour.
  - L4D2's "wounds match weapon strength" (limb, torso, head, half body).
  - KF2 uses damage as a barometer.
  - Ravenfield mods cut below or above the joint by damage thresholds.
- **How [I]:** one data table per weapon. Fields: wound radius (B1), splat size (B2), hole chance (B3), sever threshold per joint (B5), gib count (B11), spray count (B6), exit-wound flag (B13), burn amount (B12), hit-stop ms (B17), audio layer set (B16).
- Example rows:
  - Flechettes: many tiny punctures, no sever, fine mist.
  - Shotgun: cluster wounds, sever at under 6 m, wall spray behind.
  - Explosive round: hole plus gibs.
  - Beam: burn, cauterised hole, no blood.
  - Katana: plane cut, arterial spray.
  - Mech: pulp.
  - Nuke: char plus skeleton flash.
- **Cost:** none. It's data.
- **Fit:** essential. It makes each weapon's gore distinct.

### B19. Persistence and budgets
- KF2 (blood stays all game), Hotline Miami (corpses stay), Vlambeer (permanence).
- Budgets from shipped games:
  - Ghoul2: 500 gore records.
  - Shadow Warrior: 100 decals, FIFO, 30 MB pool.
  - Brutal Doom: one CVAR caps pools, gibs and debris.
- **How [I]:** world decals get a large FIFO (256–512 instanced, shared atlas). Enemy wound splats get a small one (64–128). Corpses fade only off-screen. Use a single "gore quality" setting.
- **Cost:** cheap if instanced. One `InstancedMesh` per decal material.

### B20. Throwable severed parts (Chivalry 2)
- **What:** severed heads and limbs become pickup or throw items. The thrown part does a little damage, makes a splat on impact, and plays a comic sound.
- **Cost:** cheap if dismembered parts are already physics bodies.
- **Fit:** good. Satirical tone, a co-op laugh generator, and no new tech needed.

---

## Part C: three.js notes and sketches

Sketches only, not drop-in code. Check them against the current codebase before use.

### C1. Bind-pose hit point from a raycast on a SkinnedMesh
- three.js raycasts SkinnedMesh against the *posed* vertices. `SkinnedMesh.applyBoneTransform` is used inside `getVertexPosition`, so `intersection.face` and `intersection.barycoord` (or the face's a, b, c) locate the triangle.
- Interpolate the raw `geometry.attributes.position` (rest pose) with the barycentric weights to get the bind-pose hit point.
- No inverse bone math is needed. [I, three.js mechanism; check that `barycoord` exists in r187 or compute it with `Triangle.getBarycoord`]

### C2. Wound mask patch (B1 + B3 + B9)
```glsl
// vertex: before <skinning_vertex>, capture rest-pose position
varying vec3 vRest;            // vRest = position;
// fragment
uniform vec4 uHit[8];          // xyz = rest-pose point, w = radius (0 = empty)
uniform vec4 uHitInfo[8];      // x = age seconds, y = type (0 blood, 1 burn, 2 hole), z = seed
float m = 0.0; float hole = 0.0; float burn = 0.0; float wet = 0.0;
for (int i = 0; i < 8; i++) {
  float r = uHit[i].w; if (r <= 0.0) continue;
  float grow = mix(0.5, 1.0, clamp(uHitInfo[i].x / 6.0, 0.0, 1.0));     // soak outward
  float d = length(vRest - uHit[i].xyz) / (r * grow);
  float n = noise3(vRest * 18.0 + uHitInfo[i].z) * 0.35;                // ragged edge
  float k = 1.0 - smoothstep(0.6, 1.0, d + n);
  if (uHitInfo[i].y == 2.0 && d + n < 0.35) hole = 1.0;                  // L4D2-style cut
  burn = max(burn, uHitInfo[i].y == 1.0 ? k : 0.0);
  m = max(m, uHitInfo[i].y == 0.0 ? k : 0.0);
  wet = max(wet, k * (1.0 - smoothstep(20.0, 90.0, uHitInfo[i].x)));   // dries over time
}
if (hole > 0.5) discard;   // only in the "wounded" material variant (early-Z cost)
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.02, 0.02), m);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), burn);
roughnessFactor = mix(roughnessFactor, 0.18, wet);
```
- Share one compiled program across all enemies; per-enemy uniforms are fine.
- Put the same discard in `customDepthMaterial` and `customDistanceMaterial`.
- Swap to the discard variant only after the first "hole" hit (Looman's shader-swap tip, L4D2's Hi-Z note).

### C3. Skeleton-sharing splat decal (B2 + B13), the Ghoul2 recipe in three.js
- Gather candidate triangles. Use triangles whose bone weights include the hit bone, or use a three-mesh-bvh sphere query on a posed snapshot.
- Compute posed vertex positions with `applyBoneTransform`.
- Project `s,t` along the shot direction with a random rotation, as in `G2_GorePolys`. Keep triangles touching [0,1]². For exit wounds, keep only back-facing ones.
- Build the geometry:
  - `new BufferGeometry()`
  - `setAttribute('position', src.attributes.position)` (shared buffer)
  - the same for `normal`, `skinIndex` and `skinWeight`
  - `setAttribute('uv', new BufferAttribute(uvsPerSourceVertex, 2))`
  - `setIndex(keptIndices)`
  - UVs are per source vertex, so give triangles outside the splat out-of-range UVs; the texture's clamp and alpha hides them.
- Then `const d = new SkinnedMesh(geo, splatMat); d.bind(enemy.skeleton, enemy.bindMatrix); enemyRoot.add(d)`.
- Splat material: `polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, transparent: true`, with an alpha-threshold grow uniform (Shadow Warrior's alpha-reference shift).
- Cap active splats per enemy at 4–6 and globally at about 96, FIFO.

### C4. World blood decals (B7, B8, B19)
- One `InstancedMesh` of unit quads (or small boxes for a projector shader) per atlas, oriented to the hit normal and slightly offset.
- Per-instance attributes: atlas cell, birth time, grow time, dry time. Everything animates in the shader.
- FIFO ring of 512. On flat floors this skips `DecalGeometry` entirely. Use `DecalGeometry` only for big splats on irregular props, and dispose of it on eviction.

### C5. GPU droplets (B6, B10)
- `InstancedMesh` of stretched quads. Instance attributes: p0, v0, birth, life, size.
- The vertex shader integrates gravity and aligns the quad along velocity (motion stretch).
- The CPU raycasts only 1–3 "leader" droplets per burst to place splats.
- Arterial spray is an emitter that re-arms bursts on a pulse curve.

### C6. Red-only grade (B17)
- One full-screen pass in the existing post chain, with a `uRedPass` uniform eased 0→1→0. Use it in slow-mo and kill moments.

---

## Part D: top 12 by wow per effort

Ranked for OVERPOWERED 2 as it stands: dismemberment, crawlers, blood decals and the katana cut already exist.

| # | Idea | Wow | Effort | Browser cost | Why it ranks here |
|---|------|-----|--------|--------------|-------------------|
| 1 | **Red-only grade in slow-mo and kill moments** (KF2 Zed Time) | High | Tiny (one post pass) | Cheap | Proven by Tripwire; it makes all existing gore pop at once. It suits katana, chips and nukes. |
| 2 | **Hit-stop plus layered gore audio** (crack, wet, tail; more for bigger calibres) | High | Small | Cheap | Sound and timing sell gore more than polygons do (DI2 celery and pasta, Sakurai, Vlambeer). It reuses everything we have. |
| 3 | **Exit wounds and wall spray behind the target** (Ghoul2 back-face splat plus a decal on the wall behind) | High | Small | Cheap | Instantly readable at FPS speed. One extra raycast. |
| 4 | **Bind-pose wound masks in the enemy shader** (8 hits; soak outward; wet-to-dry) | High | Small to medium | Cheap | Every bullet leaves a mark that follows animation, with no render targets (Looman, L4D2). |
| 5 | **Weapon gore table** (calibre → wound, sever, gib, burn, hit-stop, audio) | Medium-high | Small (data) | None | Makes flechettes, shotgun, explosive, beam, katana, mech and nuke each feel different (L4D2, SoF, KF2). |
| 6 | **Growing pools under corpses plus crawl and drag trails, kept with a FIFO** | Medium-high | Small | Cheap | It tells a story of the fight (TLOU2, Brutal Doom, KF2, Hotline Miami), and our crawlers are perfect trail-makers. |
| 7 | **Beam burn and char** (black and rough, ember edge, cauterised hole, clothes burn away; nuke skeleton flash) | High | Small to medium | Cheap | The beam needs its own gore identity, and it's the same mask as #4. |
| 8 | **L4D2 holes plus shared wound inserts** for shotgun point blank and explosive rounds | Very high | Medium (a few insert meshes, shadow pass) | Cheap GPU | See-through holes are the signature shot. Valve did it in 15 vertex and 7 pixel instructions. |
| 9 | **Skeleton-sharing splat decals** (Ghoul2 recipe) for big hits | Medium-high | Medium | Cheap to medium | Real textured wounds that bend with the body, and the basis of #3. |
| 10 | **Armour shatter and spall states** (plates pop as pooled shards; mech panels and hydraulic fluid) | High | Medium (content split) | Cheap | Shows damage progress on tough enemies (Doom Eternal, the KF2 barometer). |
| 11 | **Katana upgrades:** caps chosen by region and angle, bone and viscera inserts, cut along the swing, work spread over the swing | High | Medium | Medium CPU, spread | Polishes a system we already have (MGR, DI2, Onimusha). |
| 12 | **Throwable severed heads and limbs** (Chivalry 2) | Medium-high (comic) | Small if parts are already physics bodies | Cheap | A satirical laugh and a co-op toy, with no new rendering. |

Honourable mentions (higher effort or narrower):
- A rare X-ray kill cam: a shared skeleton and organ mesh, a skin dissolve, and Sniper Elite-style shot scoring to decide when to show it.
- Blood that builds up on the viewmodel arms and gun (MGS V, Chivalry 2).
- Pulsing arterial spray from stumps.
- Pooled instanced gibs that knock enemies down (ILL).
- ULTRAKILL-style "blood near you heals", as a chip.
- Baked map-wide floor paint for true KF2 permanence.
- A layered skin → muscle → bone look as damage builds (FLESH-lite).

Things to skip:
- Real fluid simulation (FleX-class).
- Per-enemy render-target painting. Looman measured 1.6–4.5 ms spikes.
- Runtime CSG on every bullet.
- Full multi-layer FLESH simulation.

---

## Part E: what I could not find

- **Callisto Protocol internals.** The SI.com deep dive is gone (410), and the Twinfinite CTO interview and inkl were blocked (403). Only quotes are available ("just chunks", 2.5 years).
- **RE2 and RE4 remake wound tech.** No CEDEC or Capcom technical talk found. The Onimusha "Dynamic Dismemberment System" has only design-level coverage.
- **Dead Island 2 implementation.** No GDC talk found. The Reddit AMA is blocked from here. The PC Gamer and AusGamers pages didn't load. The "Kinder egg man" cap technique isn't explained anywhere I could reach. The Game Informer video (https://www.youtube.com/watch?v=GW7N83E1NqY) is probably the best remaining source.
- **Sniper Elite X-ray rendering method.** Only design quotes. The GameSkinny page was blocked.
- **Mortal Kombat X-ray and fatality tech.** Only a SIGGRAPH talk abstract and Polycount speculation. The Business Insider audio article didn't resolve.
- **Metal Gear Rising skinned-mesh cutting algorithm.** Platinum's blog covers memory, the multi-frame split and caps, but not how skinned meshes are cut.
- **KF2 Zed Time and FleX internals.** Only secondary descriptions. The PC Gamer article body didn't load.
- **Fallout BodyPartData page.** 403. Fields come from the search snippet only.
- **No usable technical sources for:** TLOU2's blood shader internals, Doom Eternal's destructible demons tech (the SIGGRAPH 2020 PDF was over 10 MB and didn't fetch), Gears, Halo, Postal, MGS V, Ultrakill, Severed Steel, Trepang2 (the aiandgames link 404'd), Ravenfield's base game, Rain World, Exanima internals, Mordhau, Zero Sievert, Gunfire Reborn, Splitgate, and Hotline Miami (the PC Gamer interview body didn't load).
- **No patents** turned up for dismemberment or wound rendering in a general search. A direct Google Patents search would be the next step.
- **No three.js library** does skinned-mesh slicing or skinned decals out of the box. The skeleton-sharing decal (C3) and rest-pose mask (C2) are my own translations of the Ghoul2 and L4D2 recipes, not existing three.js code.
- **Valve's MIGS 2008 "Connecting Visuals to Gameplay"** has no gore content (I read the slides).

---

## Source list

Primary:
- Valve, Vlachos, "Rendering Wounds in Left 4 Dead 2" (GDC 2010): https://cdn.fastly.steamstatic.com/apps/valve/2010/gdc2010_vlachos_l4d2wounds.pdf
- OpenJK Ghoul2 gore source (Raven/Activision, GPLv2; technique reference only): https://github.com/JACoders/OpenJK/blob/master/codemp/ghoul2/G2_gore.h , https://github.com/JACoders/OpenJK/blob/master/codemp/rd-vanilla/G2_misc.cpp , https://github.com/JACoders/OpenJK/blob/master/codemp/rd-vanilla/tr_ghoul2.cpp
- Flying Wild Hog, "The Technology Behind Shadow Warrior" (ZTG 2014): https://www.slideshare.net/slideshow/the-technology-behind-shadow-warrior-ztg-2014/40789491
- Pope Kim, "Screen Space Decals in Warhammer 40,000: Space Marine": https://www.slideshare.net/blindrenderer/screen-space-decals-in-warhammer-40000-space-marine-14699854
- PlatinumGames blog (Noda, Odera): https://platinumgames.com/official-blog/article/4732 ; (Yoritomi, caps): https://platinumgames.com/official-blog/article/4748
- Tom Looman, "Rendering Wounds on Characters": https://tomlooman.com/unreal-engine-render-character-wounds/
- Dambuster quotes: https://kotaku.com/ama-reddit-dead-island-2-weapons-flesh-system-ps5-xbox-1850415887 , https://www.theloadout.com/dead-island-2/realistic-zombies-gore-system , https://culturedvultures.com/dambuster-studios-talk-dead-island-2-interview/
- Tripwire quotes: https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/ , https://pcgamesn.com/killing-floor-2/painting-paris-red-with-killing-floor-2s-meat-system
- Rebellion (Tim Jones): https://mcvuk.com/?p=23739
- Scorn audio interview: https://www.asoundeffect.com/scorn-game-audio
- UEGoreSystem docs: https://github.com/Klian326/-Public-UEGoreSystem/wiki/3.-Auto-Dismemberment
- three.js DecalGeometry: https://threejs.org/docs/pages/DecalGeometry.html , https://github.com/mrdoob/three.js/blob/dev/examples/jsm/geometries/DecalGeometry.js
- three-pinata: https://github.com/dgreenheck/three-pinata ; three-bvh-csg: https://github.com/gkjohnson/three-bvh-csg

Secondary (as cited inline): Doom 2016 graphics study (Courrèges), the UE forum L4D2-style thread, Kodeco mesh painting, KF2 and FleX press, Dead Space, Doom Eternal, RE2, Onimusha, TLOU2, MGS V, Chivalry 2, Brutal Doom, Hotline Miami, ULTRAKILL, Ravenfield, Exanima, Sakurai's hitstop column, Vlambeer game-feel notes, foley articles, ezy-slice, LimbHacker, three.quarks, @newkrok/three-particles, gorescript, the CGA skinned-cut paper (https://arxiv.org/abs/2007.04464v1).
