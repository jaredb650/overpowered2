# OVERPOWERED 2: ragdolls, hit reactions and physics-driven animation (web research)

> Kept from the gore and ragdoll research round. The proposals built from it, with each idea checked against the code, are in [docs/proposals/gore-ragdoll-proposals.md](../proposals/gore-ragdoll-proposals.md). The code audit is [gore-audit.md](gore-audit.md); its companion on wounds and blood is [gore-techniques.md](gore-techniques.md).

Scope: ragdolls, hit reactions while alive, physics-driven animation, and the Rapier side of it. Gore and wound visuals are covered by another agent, and our own code by a third. Everything here is a technique or a source of inspiration. No assets.

How to read the "fit" lines: **FPS-48** means "fits a fast browser FPS with up to about 48 enemies alive on an 8 GB M1". Costs are my estimates for three.js r187 + Rapier WASM unless a source gives a number. Where a source gives a number, it is quoted and cited.

Date of research: 2026-11-18. Rapier facts were checked against the rapier.js and rapier `master` branches on that date. Check them against the `@dimforge/rapier3d` version in `package.json` before relying on an API name.

---

## 0. The ten-line summary

1. Every serious shipped system (Euphoria, Unreal, Frostbite, Respawn, Naughty Dog, Diablo 3, Jolt) does the same thing at its core. A ragdoll tracks a target pose through drives (motors, velocities or constraints). Hit reactions work by **lowering drive strength for a short time and then ramping it back up**, not by switching animation off and physics on.
2. The cheapest big win is **shaping the bullet impulse**. Spread it over about 0.1 s, add a counter-impulse at the pelvis, scale it by weapon class and clamp it, but let shotguns and explosives through. Euphoria exposes every one of these knobs (section 2.1).
3. Spaghetti bodies come from **missing joint limits, bad mass ratios and tiny inertias**, not from too few solver iterations. Jolt and Havok give hard rules: parent/child mass ratio 0.8 to 1.2, parent inertia at least the sum of its children's, and small links get 2 to 4 times their inertia (section 4).
4. Most rapier.js ragdoll demos use **unlimited spherical joints**, and that causes the Gmod-style flop. The JS `JointData.spherical` API exposes no limits. The WASM layer does take per-axis limits and motors on any impulse joint, though (`rawSet.jointSetLimits(handle, axis, min, max)`), which is how a three.js game can get proper shoulder and hip cones (section 5.2).
5. A dead ragdoll looks far better if it is **weakly driven toward a death pose** for a second or two instead of going instantly limp. Jolt ships a demo of exactly this, and Euphoria's "looseness ramps" are the same idea (section 3.3).
6. When an animated enemy becomes a ragdoll, **give the bodies the animation's velocity** (a finite difference over two frames, with quaternion sign-flip care). Otherwise the death "pops" (Catto, Diablo 3).
7. Explosions look right when you **apply the impulse per collider at the point closest to the blast, scaled by the collider's projected area**. Spin then comes for free (Catto, Diablo 3).
8. Budgets: Diablo 3 turned off ragdoll-vs-ragdoll collision for performance. Source caps and fades ragdolls. Doom 3 freezes a figure once it has hardly moved for 1 s, and can force a freeze after a maximum time. All three are cheap and all three fit 48 enemies.
9. Full balance controllers (Euphoria, Wobbledoll, DReCon, ARC Raiders) are machine learning or large proprietary middleware. **Wrong cost class for a browser shooter.** We can fake 80% of their look with procedural stumble steps, foot IK and stiffness ramps.
10. Jolt (JoltPhysics.js) has a real ragdoll API: `DriveToPoseUsingMotors`, `DriveToPoseUsingKinematics`, `Stabilize()`, swing-twist limits and a browser demo. Rapier is lighter and already integrated. Section 6 has the comparison. My recommendation: stay on Rapier.

---

## 1. Vocabulary (one line each)

- **Passive ragdoll**: jointed rigid bodies with limits and no muscles. A standard death ragdoll.
- **Powered or active ragdoll**: the same bodies with drives that pull each joint or body toward an animated target pose.
- **Drive types** (Respawn's three-way split, see 2.4): *motors* in the joints (local, relative between bodies), *velocities* set on each body so it reaches its target this frame, and *constraints* between a body and its animated target (world-space pins).
- **Physics blend weight**: per-bone mix of the simulated pose and the animated pose, drawn after physics. Unreal's main hit-reaction knob.
- **Partial ragdoll**: only a sub-tree simulates (one arm, a ponytail), rooted on a kinematic body that follows the animation.
- **PD controller**: torque = stiffness × (target − current) + damping × (target velocity − current velocity). Rapier, Jolt, PhysX and Unreal motors are all PD.

---

## 2. What the best shipped systems do

### 2.1 NaturalMotion Euphoria (GTA IV/V, RDR 1/2, Max Payne 3)

**What it is.** The run-time version of NaturalMotion's "Dynamic Motion Synthesis", announced at GDC 2006. It simulates "the game character's actual motor control, muscles and biomechanics" ([Game Developer press release](https://www.gamedeveloper.com/press-release/naturalmotion-announces-euphoria-run-time-technology-for-next-generation-game-platforms)). Rockstar says it used Euphoria "to enhance the physics-based reactions of both humans and animals" in RDR2 ([Wccftech quoting Rockstar's Phil Hooker](https://wccftech.com/rockstar-euphoria-evolved-rdr2/)). Max Payne 3 tuned the bullet reactions around bullet time ([TechRadar](https://www.techradar.com/news/gaming/the-technology-of-max-payne-3-1082751)).

**How it works (from what is public).** No primary technical paper on the balance controller is public. I searched GDC Vault and found nothing. The best window is the **message and behaviour API that GTA V exposes to script**, which modders have documented with defaults and ranges ([SHVDN NaturalMotion namespace](https://docs.ragecoop.com/SHVDN/GTA.NaturalMotion.html)). It shows the architecture: a ragdoll runs one or more **behaviours** at once, and each one sets per-joint stiffness and damping targets plus a desired pose.

Behaviour names alone are a design menu. Excerpt: `Shot`, `ShotFromBehind`, `ShotInGuts`, `ShotFallToKnees`, `ShotShockSpin`, `ShotSnap`, `ShotRelax`, `StaggerFall`, `BodyBalance`, `CatchFall`, `BraceForImpact`, `BodyWrithe`, `InjuredOnGround`, `RollDownStairs`, `HighFall`, `Teeter`, `FallOverWall`, `ArmsWindmill`, `UpperBodyFlinch`, `Grab`, `Yanked`, `OnFire`, `Electrocute`, `Dangle`, `PointGun`, `HeadLook`, `SmartFall`, `BodyFoetal`, `BodyRollUp`.

**Concrete parameters worth stealing** (defaults and ranges as documented in the [SHVDN docs](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_helper.html)). Euphoria's stiffness scale runs about 6 (floppy) to 16 (rigid), and its damping is a ratio where about 1 is critical.

- **Shot** ([ShotHelper](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_helper.html)):
  - `BodyStiffness` 11 (6–16), `ArmStiffness` 10, `NeckStiffness` 14, `SpineDamping` 1.0, `NeckDamping` 1.0.
  - `LoosenessAmount` 1.0: each new bullet makes the body loose, then a ramp brings stiffness back. `InitialWeaknessRampDuration` 0.4 s, `InitialNeckRampDuration` 0.4 s, `MinArmsLooseness` and `MinLegsLooseness` 0.1.
  - `ReachForWound` true, with `TimeBeforeReachForWound` 0.2 s. `GrabHoldTime` 2.0 s holds the hand on the wound.
  - `Fling` with `FlingTime` 0.6 s. `FallingReaction` picks rollup, catch-fall, roll-down-stairs or smart-fall.
  - `ExagMag` 1.0 and `ExagTwistMag` 0.5 exaggerate spine lean and twist per bullet.
- **ConfigureBullets**, the impulse shaping ([ConfigureBulletsHelper](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_configure_bullets_helper.html)):
  - `ImpulsePeriod` 0.1 s: the impulse is spread over 0.1 s in a triangle shape.
  - `ImpulseAirMax` 100 clamps the impulse when the target is airborne, but `ImpulseAirApplyAbove` 399 lets it through as-is: "it's a shotgun or cannon". The same pair exists for one-leg contact.
  - `DoCounterImpulse` with `CounterImpulseMag` 0.5 and `CounterImpulse2Hips` 1.0: half of the impulse is countered at the hips. The hit part moves and the whole body does not slide.
  - `ImpulseReductionPerShot` and `ImpulseRecovery` weaken repeated hits.
  - `ImpulseTorqueScale` scales the torque part of an off-centre hit.
  - The `Rb*` options mix a whole-body "rigid body" response with a per-part response, cap the moment arm (`RbMaxTwistMomentArm` 0.5, `RbMaxBroomMomentArm` 1.0), and can pivot around the feet when grounded (`RbPivot`).
  - `TorqueGain` 4, `TorquePeriod` 0.1 s, `TorqueSpinMode.Flipping` for "a burst effect".
- **StaggerFall** ([StaggerFallHelper](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_stagger_fall_helper.html)): `LowerBodyStiffness` 13 to `LowerBodyStiffnessEnd` 8. `StepsTillStartEnd` 2, then `PerStepReduction1` 0.7 per step "to make the character fallover". `PredictionTime` (bigger means fewer, bigger recovery steps). `SpineBendMult` 0.4, `LeanInDirMaxB` 0.3. A "yanked" whiplash comes from start values (`SpineStiffnessStart` 3, `ArmDampingStart` 0.1) that ramp to normal values.
- **BodyWrithe** ([BodyWritheHelper](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_body_writhe_helper.html)): arm, back and leg stiffness 13. Damping 0.5 ("less is underdamped"). Period 1.0, amplitude 1.0. `RollTorqueScale` 150 with `MaxRollOverTime` (the rolling torque fades to zero). Blend weights let writhe mix with the current pose.
- **CatchFall** ([CatchFallHelper](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_catch_fall_helper.html)): `ArmsStiffness` 15 (6–16), plus forward and backward arm offsets that prop the hands near the shoulders or behind.

**Who does it best.** GTA IV is still the reference for "drunk stumble then fall". RDR2 is the most refined version. Modders say GTA IV was more dramatic ([DSOGaming on a ragdoll rework mod](https://www.dsogaming.com/mods/red-dead-redemption-2-gets-a-realistic-euphoria-physics-mod)).

**Browser cost.** A real Euphoria-class balance controller is out of reach. The *behaviour layer* is cheap: stiffness ramps, impulse shaping, reach-for-wound IK, writhe noise. It is a few hundred lines of game code on top of a ragdoll that has drives.

**FPS-48 fit.** Copy the knobs, not the controller. Impulse shaping and looseness ramps fit every enemy. Stagger and writhe fit the nearest 4–8 enemies.

### 2.2 Wobbledoll (LIGHTSPEED STUDIOS, GDC 2023)

This is a full-body balancing ragdoll trained with machine learning, by a former Rockstar physics programmer (GTA V, Max Payne 3, RDR2). It is useful for its **run-time pipeline**, which DReCon inspired ([80.lv interview](https://80.lv/articles/wobbledoll-developing-an-advanced-full-body-ragdoll-system/), [GDC Vault](https://gdcvault.com/play/1028886/Machine-Learning-Summit-Wobbledoll-ML)):
- It "only gets activated when certain physical interaction happens". Otherwise the character stays purely kinematic.
- Each frame: kinematic animation update, then animated pose plus simulated pose go into a network, which outputs drive targets, then physics, then optional pose fix-up.
- When knocked over, it "can perform custom motion while falling and blend to kinematic get-up animation when the character settles".
- It says Unreal's partial physical animation "uses kinematic body or constraint to pin the body root", which "cannot handle any full-body physical interaction that involves the root".

FPS-48 fit: the ML part is no (training takes days and inference per character). The **activate on contact, blend back when settled** state machine is a yes. Every technique below plugs into it.

### 2.3 EA Frostbite, "Physics Driven Ragdolls and Animation at EA: From Sports to Star Wars"

Abstract only, since the vault page is members-only: "driven ragdolls that are able to follow animation and react believably", with tricks for "improving animation follow, reducing complexity to gain performance, reducing potential bad output poses, feedback into the animation system and networking, and how they used ragdolls to generate procedural animations" ([GDC Vault](https://gdcvault.com/play/1025210/Physics-Driven-Ragdolls-and-Animation)). The useful takeaway is the list of problem areas. "Reducing complexity" (fewer bodies) and "bad output poses" (clamp the result) match what Catto says in 4.x.

### 2.4 Respawn, Star Wars Jedi: Fallen Order (GDC Summer 2020)

Bartlomiej Waszak's talk ([Game Developer write-up](https://gamedeveloper.com/programming/leveraging-physical-animation-to-sell-force-powers-in-i-jedi-fallen-order-i-), [80.lv](https://80.lv/articles/gdc-2020-talk-on-physical-animation-in-star-wars-jedi-fallen-order)):
- Three ways to make physics follow animation: **motors** ("use a specified animation target to generate the local force between connected bodies"), **velocities** ("compute a velocity needed to move the body from one place to another during a given frame time"), and **constraints** ("a new constraint between the dynamic body of the rag doll and the animation target"). They shipped with motors.
- **Death animation in tight spaces.** The hip body stays simulated but gets a constraint to its animation target that "removes all degrees of freedom". Then: "we monitor the distance between the actual position of the hip body and the desired animation target. If the constant drive for that hip body is unable to hit the target within some threshold, we just switch to a free-fall rag doll mode." Result: Force-pushed stormtroopers slump into walls instead of clipping through them.
- Other topics listed: PhysX parameters, CCD, "Partial Velocity Drive", ground animation.

FPS-48 fit: **yes, high value.** The hip-distance bailout is a few lines of code and solves "death animation clips through wall".

### 2.5 Naughty Dog (Uncharted 4, The Last of Us Part II)

- Uncharted 4, GDC 2017, Michal Mach: "how to drive physics objects with animation more predictably, with minimal distortions and almost absolute artistic control" ([80.lv](https://80.lv/articles/gdc-physics-animation-in-uncharted), [GDC Vault](https://gdcvault.com/play/1024087/Physics-Animation-in-Uncharted-4)). No public slides. A 2015 interview says melee hit reactions are "all based on the angle from which Drake punches, and where he hits them on the body" ([Game Informer](https://gameinformer.com/b/features/archive/2015/01/23/how-uncharted-4-is-taking-game-technology-to-the-next-level)).
- TLOU2, GDC 2024, Derek Mattson ([speaker notes PDF](https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Mattson_Derek_ASecondShot_Notes.pdf), [GDC Vault](https://www.gdcvault.com/play/1034215/A-Second-Shot-Improving-Ranged)):
  - Weapon feel "is almost entirely hit reactions... our brains just expect them to move in certain ways."
  - Hit detection was rebuilt to support it. Torso boxes became "multiple horizontal capsules attached at various spine joints up and down the character".
  - A **leg-shot stun state** ("Instant stun state, less damage") became a crowd-control tool: an opener for a grab or melee, and it brings the head down for a follow-up shot.
  - Players aimed at the knee and the hit landed on the thigh, so they "split the thigh into 2 collisions", one with the core body and one with the lower leg, to favour the player.
  - Takeaway for us: hit zones and reaction states matter as much as the physics.

### 2.6 Unreal Engine: Physical Animation Component, physics blend weight, Physics Control

- **Physics blend weight** hit reactions ([Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-driven-animation-in-unreal-engine)): get the hit bone, call `SetAllBodiesBelowSimulatePhysics` on it, then "quickly animate [the blend weight] going up to 1.0 and then back down to 0.0", then turn simulation off again. This is the classic **partial ragdoll flinch**.
- **Physical Animation Component** profiles carry `OrientationStrength`, `AngularVelocityStrength`, `PositionStrength`, `VelocityStrength`, `MaxLinearForce`, `MaxAngularForce` and `bIsLocalSimulation` ([FPhysicalAnimationData](https://docs.unrealengine.com/4.26/API/Runtime/Engine/PhysicsEngine/FPhysicalAnimationData/index.html)). A search summary of Epic's physics-asset docs gives a starting set of "1000, 100, 1000, 100, 0, 0" (orientation, angular velocity, position, velocity, max linear, max angular). I could not confirm the field order from the page text, so treat it as a ratio hint: **position-type gain about 10 times the velocity-type gain** ([Epic, creating a physical animation profile](https://dev.epicgames.com/documentation/unreal-engine/creating-a-physical-animation-profile-in-unreal-engine)).
- **Physics Control** (UE5 plugin) re-expresses drives as **strength + damping ratio + extra damping**: "Values > 1 result in more damped motion, and values below 1 result in faster, but more 'wobbly' motion", and 1 is critical. Extra damping "can be useful when you want damping even when [Strength] is zero". Multipliers scale strength per tick from 0 to 1 ([FPhysicsControlData](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/FPhysicsControlData), [SetControlAngularData](https://dev.epicgames.com/documentation/unreal-engine/BlueprintAPI/PhysicsControl/SetControlAngularData)). **This is the parameterisation to copy**, because it does not depend on mass (see 5.3 for the Rapier version).
- **Get-up**: Pose Snapshot captures the final ragdoll pose, then blends from it into a get-up montage ([UE 4.27 Pose Snapshot](https://docs.unrealengine.com/4.27/AnimatingObjects/SkeletalMeshAnimation/PoseSnapshot)). Forum pitfalls: popping through the T-pose if no prior pose exists, and a 360° flip when the root yaw is not aligned first ([UE forum](https://forums.unrealengine.com/t/going-from-ragdoll-simulate-physics-on-the-mesh-to-animation-always-goes-through-t-pose-bindpose/100232)).

### 2.7 Diablo 3 ragdolls (Erin Catto, GDC 2012). The most useful single source here

Read the whole deck ([PDF](https://box2d.org/files/ErinCatto_Ragdolls_GDC2012.pdf)). Points that map directly to us:
- **Bodies on a subset of bones.** Active bones follow bodies, leaf bones keep their animated local pose, and intermediate bones stay in bind pose relative to the parent. Otherwise "you will see the mesh stretch".
- **Spawning.** Create bodies at the current animated bone transforms. Joint errors heal over time, but "some physics engines may flip a joint 180 degrees if it is distorted by more than 90 degrees".
- **Initial velocity.** "We set the initial velocities based on the animation. Otherwise the ragdoll transition will not be smooth." Use a finite difference over two animation frames, and for angular velocity "make sure the quaternions have the same polarity". Animators can shape the fling through the death animation.
- **Limbs stuck in terrain.** A triangle mesh "has no sense of volume", so a foot below the floor stays there and jitters ("your dead guy appears to be convulsing"). Fixes: **remove hand and foot collision** ("they do not add much visual improvement"), use one-sided triangles, and run a **spawn de-penetration pass**. It "assumes the pelvis is inside the world and then fires rays along the bones", then shifts the whole ragdoll until clear or until an iteration limit.
- **Mass distribution.** "We don't want to support heavy bodies with light bodies. The opposite is okay." Use uniform density per material, and use **fatter shapes instead of mass tweaks**, because "rotational inertia scales faster with size than with mass".
- **Joint gaps** are bad. Let shapes overlap, for example upper and lower arm capsules around the elbow. **Disable collision between joined bodies**, but watch for overlapping *siblings* (two thigh capsules) that "jitter and propel across the ground".
- **Long skinny bodies** spin and tunnel, so make them fatter.
- **Rolling resistance** on spheres and capsules stops endless rolling on slopes and "helps bodies get to sleep faster".
- **Performance.** "Preventing those ragdolls from colliding with each other" for some ragdolls, while still allowing self-collision.
- **Explosions** are radial or linear (fixed direction, for example along an axe blade, fired on the weapon's contact frame). "For each shape we compute the closest point on the shape to the center of the explosion. We apply the explosion at that closest point. This gives the explosion some torque and leads to a nice spinning effect." Also "scale the explosion impulse by the projected surface area".
- **Gibbing.** "The full ragdoll is spawned, the visual mesh is swapped to a custom gibbed mesh, and then select ragdoll joints are disabled". So there is no separate gib ragdoll.
- **Partial ragdolls on fast-moving characters.** A kinematic root follows the animation by velocity, but velocity is capped so joints do not rip. To avoid lag they use **partial teleport**: teleport the kinematic root a fraction alpha toward the target, drive the rest by velocity, and "apply that partial transform to the entire dynamic sub-tree... No damping is required!" This is directly usable for **corpse dragging** and for living enemies' dangling limbs.

### 2.8 Older shooters: Hitman, Source, Doom 3, Painkiller

- **Hitman: Codename 47**, Thomas Jakobsen, "Advanced Character Physics" (GDC 2001): Verlet particles plus stick constraints, solved by relaxation. Bones are particles "connected... via simple constraints" ([Game Developer reprint](https://gamedeveloper.com/programming/advanced-character-physics)). Still the best cheap method for **secondary motion and for far-LOD corpses** (section 7.1).
- **Source / Garry's Mod**: per-axis limits per bone (`$jointconstrain bone axis allow min max friction`) and per-bone `$jointinertia`, `$jointdamping`, `$jointrotdamping`, `$jointmassbias` ([Valve wiki, $jointconstrain](https://developer.valvesoftware.com/wiki/$jointconstrain), [$collisionjoints](https://developer.valvesoftware.com/wiki/$collisionjoints)). Ragdoll-vs-ragdoll collision defaults to **off** (`cl_ragdoll_collide 0`, [wiki](https://developer.valvesoftware.com/wiki/Cl_ragdoll_collide)). A ragdoll manager caps counts and fades old ragdolls, with an LRU removing unused ones ([game_ragdoll_manager](https://developer.valvesoftware.com/wiki/Game_ragdoll_manager)). World pinning: "to constrain an object to the world, leave one of the target fields blank" ([Constraint](https://developer.valvesoftware.com/wiki/Constraint)). The "Gmod look" is passive ragdolls with generous limits, low friction, no drives, and players dragging them by one point. It is charming in a sandbox but reads as lifeless in a shooter.
- **Doom 3 articulated figures** ([AF docs](https://iddevnet.dhewm3.org/doom3/afs.html), [Physics_AF.cpp](https://github.com/dhewm/dhewm3/blob/master/neo/game/physics/Physics_AF.cpp)):
  - Per-figure linear, angular and contact friction, `selfCollision`, and `totalMass` (masses rescaled to a set total).
  - A body may constrain to `"world"`. That is a **wall-pin primitive**.
  - Projectile hits map to "the nearest joint" and then to a body through each body's `containedjoints`.
  - **Rest rule**: a figure suspends when, for `NO_MOVE_TIME = 1.0 s`, every body moved less than `NO_MOVE_TRANSLATION_TOLERANCE = 10` units and rotated less than `NO_MOVE_ROTATION_TOLERANCE = 10`°. Doom units are about an inch, so 10 units is about 25 cm.
  - Velocity and acceleration caps for suspending: 10 units/s linear, 15 angular, 20 acceleration.
  - `minMoveTime` keeps it awake for at least that long, and `maxMoveTime` **forces suspension after a maximum time**.
- **Painkiller and other stake guns**: the design is "the chump goes flying back, gets pinned to the wall, and hangs there". The stake gun is slow on purpose, which makes each pin a set piece ([PC Gamer](https://www.pcgamer.com/an-ode-to-the-stake-gun-and-the-macabre-glory-of-sticking-dudes-to-walls)). I found no public implementation write-up. The usual approach is a world constraint at the hit point (Doom 3's `"world"` body, Source's blank target), shown in 3.6.

### 2.9 Killing Floor 2, Doom (2016), Sniper Elite 4

From one PC Gamer feature with developer quotes ([PC Gamer, "The dark art of creating gorgeous death animations"](https://pcgamer.com/the-dark-art-of-creating-gorgeous-death-animations)):
- **KF2.** Non-lethal hits make a Zed "stagger depending on where you hit it"; on a kill "it'll fall back in a direction based on from where you hit it". KF2 blends "a large number of canned animations into physics-based ragdoll". Dismemberment swaps to a gore model of 22 slices; on a strong hit a slice's skinning switches from smooth to rigid and "the physics constraints which attach it to the monster are broken". Same idea as Catto's "disable select joints".
- **Doom 2016.** Directional stagger animations per demon. Deaths are designed so the killing blow is readable: "giving the player the cues as to whether a guy is dead or not". They removed legless enemies shooting back because it frustrated players. That matters for our **crawlers**: make it obvious whether a crawler is a threat.
- **Sniper Elite 4** bulletcam: bone shatter is authored, because "if you're fully procedural you run into problems because you get unexpected results", while fragments use physics with turbulence.

### 2.10 Active-ragdoll indie games (Gang Beasts, Human Fall Flat, TABS, Exanima, Boneworks, Half Sword)

I found no primary technical write-ups for Gang Beasts, TABS, Exanima or Boneworks. What exists:
- An itch.io comment attributed to Human Fall Flat's developer (I could not verify the account) says "90% of the feel of Human is actually the result of Unity physics & joints", and that several different prototypes "felt pretty much the same" ([itch.io comment](https://itch.io/post/11835)). The lesson: limits, mass and friction tuning matter more than the clever controller.
- Exanima's developer describes "quite brute force approaches to things like physics" ([Prima Games interview](https://primagames.com/gaming/sui-generis-interview-with-bare-mettles-madoc-evans)). No details.
- A practitioner's list, "8 tips for animating active ragdolls" ([Game Developer blog](https://gamedeveloper.com/design/8-tips-for-animating-active-ragdolls)):
  - Walk by jolting the foot furthest from the goal.
  - For punches, "increasing the weight of the moving body part for a few frames", so the body leans in behind it.
  - Use custom gravity with a shifted centre of mass.
  - **Separate vertical drag from horizontal**, or falls look like "swimming in honey".
  - **"String puppet" design**: a physical torso and hands and feet, with visual IK limbs joining them.
- Saints & Sinners (VR, Unreal) runs an active ragdoll on NPC upper bodies. Their blog notes the PID's integral term goes to zero for a moving target, "leaving proportional and derivative components – effectively a critically damped oscillator" ([Unreal tech blog](https://www.unrealengine.com/tech-blog/skydance-interactive-shows-how-it-injected-vr-physicality-and-melee-combat-in-the-walking-dead-saints-sinners). The page refused automated fetch, so this is the search-index quote only.)
- Unity **PuppetMaster**, from community posts only since the official manual was not reachable: `pinWeight` 0 makes the puppet fall, and pinning only pelvis and spine keeps it upright while limbs flop ([Unity forum thread](https://discussions.unity.com/t/puppetmaster-advanced-character-physics-tool-released/599766?page=110)).

FPS-48 fit: the string-puppet idea and split drag are cheap and useful. Full active-ragdoll locomotion is not needed for a fast shooter.

### 2.11 Research that underpins all of it

- **Zordan & Hodgins 2002, "Motion capture-driven simulations that hit and react"** (SCA). The tracking controller "responds to collision forces by adjusting the stiffness and damping terms", then returns to tracking ([CMU RI page](https://www.ri.cmu.edu/publications/motion-capture-driven-simulations-that-hit-and-react)). This is the academic origin of "drop the gains on hit, ramp back".
- **Zordan, Majkowska, Chiu & Fast 2005, "Dynamic response for motion capture animation"**. A physical response, then a search for a mocap clip to re-enter, while the character is moved toward the re-entry clip over time ([UCR project page](https://graphics.cs.ucr.edu/projects/dynResp/mocsim2.html)). This is the origin of **death animations chosen to match the fall**, and of get-ups.
- **DReCon (Ubisoft La Forge, 2019)**: motion matching plans, and a learned policy drives a ragdoll to track it ([paper PDF](https://theorangeduck.com/media/uploads/other_stuff/DReCon.pdf)). Not for us at run time, but the pipeline is the same as Wobbledoll's.
- **Embark, ARC Raiders (GDC 2026, "Learning to Move")**: legged robots driven by RL plus physics control ([GDC schedule](https://schedule.gdconf.com/session/learning-to-move-physics-based-enemy-locomotion-in-arc-raiders/917319), [Embark blog](https://medium.com/embarkstudios/transforming-animation-with-machine-learning-27ac694590c)). A self-taught physics creature "can keep moving when it loses a limb". Interesting as a direction for the **mech** or crawlers, but out of budget.

---

## 3. Techniques, one by one

Format: **What / Who does it best / How / Browser cost / FPS-48 fit / Starting parameters.**

### 3.1 Shaped hit impulses (alive and dead)

- **What**: the bullet's push on the body, made readable and not floaty.
- **Best**: Euphoria (2.1).
- **How**:
  1. Find the body and the world hit point from the hitscan.
  2. Impulse magnitude comes from a weapon table, not from damage.
  3. Spread it over `ImpulsePeriod` (Euphoria 0.1 s, triangle shape). In Rapier, apply `applyImpulseAtPoint` over 3–6 steps.
  4. Add a counter-impulse of about 50% at the pelvis, so the hit part rotates and the body does not slide (`CounterImpulseMag 0.5`).
  5. Clamp the impulse when the target is airborne or on one foot (`ImpulseAirMax 100`), but pass big hits through (`ApplyAbove 399`: shotgun, cannon).
  6. Reduce each extra hit (`ImpulseReductionPerShot`).
  7. Scale or cap the torque part of off-centre hits (`ImpulseTorqueScale`, a moment arm of about 0.5).
- **Cost**: almost nothing, a few WASM calls per hit.
- **Fit**: **yes, all enemies.**
- **Start with**: pistol and SMG small, rifle medium, shotgun pellets summed per body then passed through unclamped, explosive with its own path (3.5). Counter-impulse 0.5 to the pelvis. 0.1 s spread. Note that Euphoria's units are not documented, so scale the 100/399 thresholds to our own weapon table and keep the ratio of roughly 1 : 4.

### 3.2 Hit reactions while alive

Three layers, in order of cost:

**a) Pose-space additive flinch with a spring** (cheapest, all 48 enemies)
- **What**: an additive rotation on spine, neck and the hit limb, driven by a damped spring.
- **Best**: most shooters' "flinch" layers. KF2 and Doom add directional staggers on top (2.9).
- **How**: on a hit, add angular velocity (in bone space) to a per-bone spring state toward "away from the shot". Integrate a critically or under-damped spring each frame, and apply the result as an additive quaternion after the animation mixer and before skinning.
- **Cost**: tiny, about 6–10 bones × 48 enemies of quaternion maths per frame.
- **Fit**: **yes.**
- **Start with**: natural frequency about 6–10 Hz for spine and neck, damping ratio 0.4–0.7 for a visible wobble (Physics Control: below 1 is "wobbly"), peak about 10–25°. Neck about 1.5 times stiffer than spine, mirroring Euphoria's NeckStiffness 14 against BodyStiffness 11.

**b) Partial ragdoll on the hit limb** (nearest enemies only)
- **What**: the hit arm or the head simulates for about 0.3–0.6 s and blends back.
- **Best**: Unreal's blend-weight method (2.6). Catto's kinematic-root partial ragdoll for robustness (2.7).
- **How**: make the sub-tree root's parent body kinematic, following the animation (Catto partial teleport). Make the limb bodies dynamic with drives toward the animated pose. Ramp a per-bone physics blend weight quickly up, hold, then down over about 0.3 s. Then turn the bodies off or make them kinematic again.
- **Cost**: a few bodies per active reaction. Pool 6–8 limb rigs.
- **Fit**: **yes, for the 4–8 closest enemies.** Otherwise use (a).

**c) Full powered ragdoll with a "looseness" ramp** (big hits, knockdowns)
- **What**: the whole body goes to drives, stiffness drops to a floor on the hit, then ramps back up. Either it recovers or it falls.
- **Best**: Euphoria `Shot` looseness (2.1). Zordan & Hodgins gain drop (2.11).
- **How**: on a big hit, stiffness goes to about 10% of normal (`MinArmsLooseness 0.1`) and ramps back over about 0.4 s (`InitialWeaknessRampDuration`). If balance is lost (the pelvis falls below a height, or the centre of mass leaves the feet), switch to death or knockdown.
- **Cost**: medium. About 11 bodies plus 10 joints with motors per active character.
- **Fit**: **only for 1–3 enemies at a time** (shotgun at point blank, mech stomp), and only if we build the motor rig (5.2). Otherwise fake it with (a) plus a stumble (3.4).

### 3.3 Death: animation → ragdoll handoff, and "dying, not limp"

- **What**: an enemy dies mid-stride and should keep its momentum, maybe play a short death motion, then go physical. It should also *fight a little* before going limp.
- **Best**: Catto (velocity inheritance), Respawn (hip pin plus bailout), Jolt (drive to death pose), Euphoria (looseness and writhe), KF2 (canned death anims blended into ragdoll).
- **How**:
  1. Create bodies at the current animated transforms (2.7).
  2. Set linear and angular velocity from the last two animation frames, with quaternion sign care (2.7).
  3. Add the shaped bullet impulse (3.1).
  4. Optional: keep the death clip as a drive target for 0.3–0.8 s with **decaying** stiffness. If the pelvis is more than a threshold from its target (Respawn), drop to free ragdoll immediately.
  5. Optional: after the clip, drive weakly toward a **death pose** (curled, hand to wound) at low stiffness for 1–2 s, then let go. Jolt's sample shows a pile of ragdolls "driven to a specific animated death pose. This gives the ragdolls 'stiffness'" ([Jolt Samples.md](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Samples.md), [video](https://www.youtube.com/watch?v=jhpsIqbsU4I)).
- **Cost**: steps 1–3 are free. Steps 4–5 need drives (motors, or per-body velocity drives, see 5.3).
- **Fit**: **1–3 everywhere. 4–5 within about 25 m** (distance-gated).
- **Start with**: pelvis bailout distance about 0.25–0.4 m. Death-pose stiffness about 10–20% of "alive" with damping ratio about 1, fading to 0 over about 1.5 s.

### 3.4 Stumble steps and staggers

- **What**: a hit, especially to the legs, makes the enemy take 1–3 recovery steps, or fall after a few.
- **Best**: GTA IV/V `StaggerFall`. TLOU2 leg-shot stun as a gameplay state.
- **How (procedural, no balance controller)**:
  1. Push the character controller's root along the impulse with a decaying velocity.
  2. Play a stagger clip or the locomotion blend in that direction.
  3. Use foot IK to place feet on the ground ahead of the centre of mass. `PredictionTime` sets how far ahead each step is placed.
  4. Each step reduces a "stability" value (Euphoria: `PerStepReduction1 0.7` after `StepsTillStartEnd 2`). At 0 the enemy falls, using the ragdoll handoff (3.3) with the current velocity.
  5. A second hit during a stagger adds to it.
- **Cost**: low. It is kinematic, plus IK for 2 legs.
- **Fit**: **yes.**
- **Start with**: 2 free steps, then 30% stability lost per step. A leg hit on an already-staggering enemy ends in a fall. The leg stun lasts about 0.6–1.0 s (TLOU2 calls it "instant stun, less damage").

### 3.5 Explosive flings with spin

- **What**: bodies tumble believably instead of flying as a stiff plank.
- **Best**: Diablo 3 (2.7).
- **How**: for each collider of each ragdoll in range, find the closest point on the collider to the blast centre (Rapier `collider.projectPoint` or simple capsule maths). Apply the impulse there, scaled by falloff and by the collider's **projected area** toward the blast. Add a small upward bias so bodies leave the floor. Wake the bodies. Turn on CCD or soft CCD on torso and head for the next 0.5 s (5.5).
- **Cost**: about 11 small calls per ragdoll per explosion.
- **Fit**: **yes.**
- **Start with**: up-bias 20–35% of the horizontal impulse, falloff (1 − d/r)². Linear "blade" explosions for melee and katana: direction along the swing, fired on the contact frame (Catto).

### 3.6 Wall pinning (stake, rail, sniper, harpoon)

- **What**: a high-power hit carries the body backwards and nails it to the surface behind.
- **Best**: Painkiller and the stake-gun lineage (2.8). Doom 3 and Source world constraints.
- **How**:
  1. On a qualifying hit, raycast from the hit point along the shot direction up to about 2–3 m.
  2. If there is static geometry, give the hit body a large impulse toward it, or move a kinematic "stake" along the ray over about 0.1 s.
  3. When the body is within a few cm of the wall (or on stake arrival), create a **spherical impulse joint between the hit body and a fixed body at the wall point** (Rapier: a fixed rigid body plus `JointData.spherical`).
  4. The rest of the ragdoll hangs from it.
  5. Optional: a second spherical joint on another limb for a "crucified" pose.
  6. Release the joint if the wall is destroyed, or after a time.
- **Cost**: one joint per pin.
- **Fit**: **yes.** It is one of the best "wow" moments for its cost. Gate it to specific weapons so it stays special (PC Gamer: the slow stake gun is the point).
- **Start with**: max carry distance 2.5 m. The joint anchor sits on the body's surface point, not its centre, so the body hangs with some torque.

### 3.7 Corpse shooting, dragging and carrying

- **Corpse shots**: wake the ragdoll and apply the shaped impulse (3.1) at reduced strength. Every extra shot reduces the next (`ImpulseReductionPerShot`), so corpses do not get juggled across the map. This is cheap and fits everywhere. Already-frozen corpses (3.9) can be "thawed" for a shot within a short range.
- **Dragging** (enemy medics, a player grab, the mech carrying a body): use Catto's partial-teleport kinematic root (2.7) on the grabbed body, or a spherical joint to a kinematic "hand" body that follows the carrier, with velocity capped so joints do not rip. Fit: yes, for one or two at a time.

### 3.8 Dismembered limbs, decapitation, crawlers

- **Detach**: keep one ragdoll and **remove the joint** at the cut (Catto: "select ragdoll joints are disabled"; KF2: constraints broken plus rigid skinning on the slice). The severed body part becomes its own small ragdoll, or a single rigid body. Give it the parent's velocity at that point, plus a fraction of the hit impulse plus spin.
- **Crawling maimed enemies**: kinematic locomotion with **hand-plant IK** (arms reach forward and plant, the pelvis drags), plus a spring layer on the stumps and head. Euphoria-style "reach for wound" fits here: one hand IK-targets the wound socket with `TimeBeforeReachForWound` about 0.2 s, and `GrabHoldTime` about 2 s alternates with crawling. Add writhe noise (period about 1 s, underdamped about 0.5) on spine and legs when the crawler stops. Doom's lesson applies: make it obvious whether a crawler is still a threat.
- **Fit**: yes. Procedural crawling costs about the same as a normal walking enemy.

### 3.9 Settling, sleeping, freezing, and budgets for many ragdolls

- **Rapier sleep defaults** (Rust master): a body may sleep after its velocity has stayed under `normalized_linear_threshold 0.05` (length units/s) and `angular_threshold 0.5` rad/s for `time_until_sleep 0.5 s` ([rigid_body_components.rs](https://github.com/dimforge/rapier/blob/master/src/dynamics/rigid_body_components.rs)). The whole island has to be still. A twitching foot keeps the entire ragdoll awake, and so does a neighbour touching it.
- **Doom 3's figure-level rule** (2.8): 1 s with tiny movement suspends the whole figure, and `maxMoveTime` forces it after a cap. Implement it as our own check over the ragdoll's bodies and then call `body.sleep()` on all of them. For a long cap, remove the bodies and keep the skinned pose as a static mesh.
- **Bullet's RagdollDemo** defaults, a well-known working set: per-body damping linear **0.05**, angular **0.85**, deactivation time **0.8 s**, sleeping thresholds **1.6** (linear) and **2.5** (angular) ([BenchmarkDemo.cpp RagDoll](https://github.com/bulletphysics/bullet3/blob/master/examples/Benchmarks/BenchmarkDemo.cpp)).
- **Budget levers** (all cheap):
  1. No ragdoll-vs-ragdoll collision, or torso-only (Diablo 3, Source default). Rapier: collision groups.
  2. A cap on simultaneously simulated ragdolls with least-recently-used freezing, plus a cap on total corpses with fade-out (Source ragdoll manager).
  3. A force-freeze timer (Doom 3).
  4. Hands and feet without colliders (Catto).
  5. Distance-gated quality: drives and CCD only near the player.
  6. Fewer bodies per ragdoll at range (11 → 6 or 7: merge forearm into upper arm and shin into thigh) or a Verlet stick ragdoll (7.1) for far bodies.
- **Real body counts in engines' own stress tests**: Rapier ships a 125-ragdoll pile (1,250 bodies, 1,125 limited joints) as a stress test ([ragdolls3.rs](https://github.com/dimforge/rapier/blob/master/examples3d/stress_tests/ragdolls3.rs)). Jolt shows 160 ragdolls on a Horizon Zero Dawn scene, natively ([Samples.md](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Samples.md)). **I found no published WASM timing for ragdolls.** Measure with `world.profilerEnabled = true` and the `World.timing*` getters (rapier.js 0.18+, [CHANGELOG](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md)).
- **My estimate for the M1**: 10–20 fully awake 11-body ragdolls with limits, plus contacts with a trimesh, should cost a few ms per step in SIMD WASM. 40+ awake at once (a nuke) is the danger case, so the freeze timer and no-ragdoll-collision matter most there. Use the `rapier3d-simd` package if the project is not already on it ([package list in CHANGELOG 0.15.0](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md)).

### 3.10 Contact quality: stairs, ledges, slopes, piles

- **Stuck limbs, convulsions**: spawn de-penetration rays (Catto). No hand or foot colliders. Disable parent-child contacts (Rapier `setContactsEnabled(false)` on the joint, which Rapier's own test does with `.contacts_enabled(false)`). Check sibling overlaps.
- **Sliding down slopes**: raise ragdoll collider friction (about 0.8–1.0) and use the Max friction combine rule against the world. Raise angular damping once the ragdoll has been in contact for more than about 0.5 s (my stand-in for Catto's rolling resistance; I did not find a rolling-resistance option in Rapier's docs).
- **Stairs and ledges**: Euphoria has `RollDownStairs`, `Teeter` and `FallOverWall` behaviours, so it treats these as special cases. Cheap version: when a fresh ragdoll's pelvis is over a drop (one raycast), add a small outward impulse so it goes over the ledge instead of balancing on it.
- **Piles**: with ragdoll-vs-ragdoll off, bodies interpenetrate in piles. Allow torso-vs-torso only (one group bit) for a believable heap at about a quarter of the pair count.

---

## 4. Ragdoll setup quality: limits, mass, inertia, solver, CCD

### 4.1 Joint limits that stop the spaghetti look

Three independent, published sets:

| Joint | Rapier stress test ([ragdolls3.rs](https://github.com/dimforge/rapier/blob/master/examples3d/stress_tests/ragdolls3.rs)) | Jolt sample ([RagdollLoader.cpp](https://github.com/jrouwe/JoltPhysics/blob/master/Samples/Utils/RagdollLoader.cpp)) twist / normal-cone / plane-cone | Bullet demo ([BenchmarkDemo.cpp](https://github.com/bulletphysics/bullet3/blob/master/examples/Benchmarks/BenchmarkDemo.cpp)) |
|---|---|---|---|
| Neck | spherical ±0.5 rad (±29°) each axis | ±90° / 45° / 45° | cone π/4, π/4, twist π/2 |
| Spine (pelvis→mid→chest) | single torso body | ±5° / 10° / 10° per segment | hinge −π/4..π/2 |
| Shoulder | spherical ±1.2 rad (±69°) | ±45° / 90° / 45° | cone π/2, π/2, 0 |
| Elbow | revolute 0..2.5 rad (143°) | ±45° twist, plane 90°, normal 0 | hinge 0..π/2 |
| Hip | spherical ±1.0 rad (±57°) | ±45° / 45° / 45° | cone π/4, π/4, 0 |
| Knee | revolute 0..2.3 rad (132°) | plane 60° (the source says "cheating", knees are not symmetric) | hinge 0..π/2 |

**My recommended starting point for our humans**: knee and elbow as **revolute, one-sided** (0..~2.3 rad) so they never bend backwards. That single change removes most of the "spaghetti" look. Hips: forward swing about 1.6 rad, back about 0.5 rad, side about 0.6 rad, twist ±0.4 rad. Asymmetric limits are supported by Rapier's angular-limit helper, which stores a centre and half-range ([joint_constraint_helper.rs](https://github.com/dimforge/rapier/blob/master/src/dynamics/solver/joint_constraint/joint_constraint_helper.rs)). Shoulders ±1.2 to 1.5. Neck ±0.5 with twist ±0.8. Catto's tuning check: drag the ragdoll with a mouse joint to find bad poses, because "Dead guys should not be sitting on their knees!" ([Catto](https://box2d.org/files/ErinCatto_Ragdolls_GDC2012.pdf)).

### 4.2 Mass ratios and inertia

- **Jolt's `RagdollSettings::Stabilize()`**, which follows Strunk: clamp each child/parent mass ratio to **[0.8, 1.2]** down the chain while keeping the total mass, and make each parent's inertia **at least the sum of its children's** ([Ragdoll.cpp](https://github.com/jrouwe/JoltPhysics/blob/master/Jolt/Physics/Ragdoll/Ragdoll.cpp)).
- **Strunk (Havok), "Stop my Constraints from Blowing Up!"** ([PDF](https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/box2d/Strunk_Oliver_Stop_My_Constraints_From_Blowing_Up.pdf)):
  - Effective mass at a point is 1/(1/m + d²/I). A link 4× smaller drops effective mass about 750×.
  - "Low inertias are the main problem for bad solver behavior!!!"
  - "We can increase inertia of selected single objects easily by factor of 2 - 4 before users spot serious artifacts", especially small links in a chain (multiply for single bodies, add a constant to the diagonal in chains).
  - "Let your artist set the mass not the density."
  - "Don't try to damp rigid bodies or the solver" to fix explosions.
  - Clip impulses for soft or breakable behaviour.
- **Catto**: heavy-on-light is bad, light-on-heavy is fine. Fatter shapes beat mass tweaks. No joint gaps.
- **Rapier hooks**: `setAdditionalMassProperties(mass, centerOfMass, principalInertia, frame)` per body, or set a collider density per part ([rigid_body.ts](https://github.com/dimforge/rapier.js/blob/master/src.ts/dynamics/rigid_body.ts)).
- **Starting masses for an 80 kg human with 11 bodies** (my numbers, adjusted to stay inside Jolt's 0.8–1.2 chain rule as far as anatomy allows):
  - Pelvis 12, chest 14, head 5.
  - Upper arm 3, forearm 2.5 (×2).
  - Thigh 9, shin 7 (×2).
  - The arm chain breaks the rule at the shoulder (14 → 3). That is acceptable because it is light-on-heavy. Boost upper-arm and forearm inertia 2–3× (Strunk).

### 4.3 Damping

Bullet's working set is linear 0.05 and angular 0.85 per body (above). Rapier's damping default is 0 ([rigid bodies guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)). Start with linear 0.05–0.1 and angular 0.6–1.0. Per the "8 tips" post, consider a *horizontal-only* drag so falls do not look slowed. Strunk warns against using damping to hide instability, so fix mass and inertia first.

### 4.4 Solver iterations and stability (Rapier)

- `num_solver_iterations` defaults to **4**. "8 to 12 is a reasonable range for demanding scenes (tall stacks, machinery with stiff joints)", and 1–2 "may be enough if performance matters more" ([integration parameters](https://rapier.rs/docs/user_guides/rust/integration_parameters)).
- Per-body extra iterations: `RigidBodyDesc.setAdditionalSolverIterations(n)` raises accuracy **only for that body's island** ([rigid bodies guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)). Use 2–4 on ragdoll bodies so the rest of the world stays at the default.
- `warmstart_joints` (Rust, default false): "enabling it noticeably improves the convergence of stiff joint assemblies". Check whether our JS version exposes it.
- `normalized_max_corrective_velocity` 3.0 is what "keeps a deep penetration from being resolved explosively". Leave it alone. It is our friend for spawn overlaps.
- `contact_softness` is set as a natural frequency plus damping ratio, so it does not depend on mass.

### 4.5 CCD for fast impulses

- In current Rapier docs, "every fast-moving dynamic rigid-body is swept against the fixed colliders" automatically, controlled by `maxCcdSubsteps` (default 1, 0 turns it all off). Per-body CCD (`setCcdEnabled`) also sweeps against dynamic and kinematic bodies and "is more expensive". The **soft-CCD prediction distance** (`setSoftCcdPrediction`) is "a cheaper alternative... for the objects that are thin or moderately fast" ([rigid bodies guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)). Check that the automatic sweep exists in our installed version. The guide is for JS 0.21.
- **Use**: soft CCD on head and torso for about 0.5 s after an explosion or a big fling. True CCD only on severed limbs flung at high speed near thin walls. Respawn's talk lists CCD as a production detail for physical animation (2.4).

### 4.6 Jitter and stretching

- **Stretching** happens because impulse joints are "constraints-based" and "can be violated if the solver does not converge". Multibody (reduced-coordinate) joints "cannot be violated at all" and handle "large assemblies" well ([joint constraints guide](https://rapier.rs/docs/user_guides/javascript/joint_constraints)). But rapier.js multibody joints currently expose **no limits and no motors** in JS (section 5.2), so they are not usable for ragdolls today.
- **Visual fix that always works**: drive the three.js skeleton from body **rotations only**, and keep bone lengths and parent-relative offsets from the bind pose (Catto's leaf and intermediate bone rule). Joint drift then never shows as a stretched mesh. Only the pelvis takes its position from physics.

---

## 5. Rapier specifics for this project

### 5.1 Impulse joints vs multibody joints

From the [joint constraints guide](https://rapier.rs/docs/user_guides/javascript/joint_constraints):
- Multibody: exact, stable with big assemblies and moderate timesteps, but "adding/removing a joint is slow", joint forces cannot be read, and it must be a tree.
- Impulse: flexible and fast to add or remove (good for dismemberment and wall pins), can be read (good for "rip limb off above force X"), but can drift.
- You can combine them: impulse joints can close loops on a multibody.

**For us**: impulse joints. Dismemberment and wall pins add and remove joints all the time, and JS multibody joints have no limits or motors (below).

### 5.2 What the JS API exposes vs what the WASM layer accepts (important)

- `JointData.spherical(a1, a2)` in JS takes **only anchors**: no limits. `SphericalImpulseJoint`'s motor methods are **commented out** ("Unsupported by this alpha release"). The same is true for `SphericalMultibodyJoint`. `UnitMultibodyJoint` has limits and motors commented out too ([impulse_joint.ts](https://github.com/dimforge/rapier.js/blob/master/src.ts/dynamics/impulse_joint.ts), [multibody_joint.ts](https://github.com/dimforge/rapier.js/blob/master/src.ts/dynamics/multibody_joint.ts)).
- Revolute and prismatic **impulse** joints do expose `setLimits`, `configureMotorPosition(target, stiffness, damping)`, `configureMotorVelocity`, `configureMotor`, `configureMotorModel` and `setMotorMaxForce`.
- **But** the WASM binding's raw functions take an **axis** argument and work on any impulse joint: `jointSetLimits(handle, axis, min, max)`, `jointConfigureMotorPosition(handle, axis, target, stiffness, damping)`, `jointConfigureMotor(...)`, `jointSetMotorMaxForce(...)`, `jointConfigureMotorModel(...)`. Each writes `data.limits[axis]` and `data.motors[axis]` on the generic joint data ([impulse_joint.rs](https://github.com/dimforge/rapier.js/blob/master/src/dynamics/impulse_joint.rs)). Rapier's Rust spherical joint takes per-axis limits on `AngX`, `AngY` and `AngZ`, which its own ragdoll test uses ([ragdolls3.rs](https://github.com/dimforge/rapier/blob/master/examples3d/stress_tests/ragdolls3.rs)).
- **So a three.js game can give spherical impulse joints per-axis limits and per-axis PD motors** by calling the raw set the TS wrapper keeps internally, along the lines of `joint.rawSet.jointSetLimits(joint.handle, RawJointAxis.AngX, -1.2, 1.2)`. `rawSet` is `protected` in TypeScript, so it needs a cast. **I have not run this.** Test it in a 30-line sandbox (one capsule hanging from a ball joint) before building on it, and confirm the axis enum values in our installed version.
- Limits on several angular axes are applied per axis to the relative rotation, using a half-angle form internally ([joint_constraint_helper.rs](https://github.com/dimforge/rapier/blob/master/src/dynamics/solver/joint_constraint/joint_constraint_helper.rs)). It is not a true swing-twist cone like Jolt's, but it behaves well inside about ±90°, which covers human joints.

### 5.3 Motors: what the numbers mean, and starting values

- A Rapier motor is a PD controller: "stiffness... controls the strength of the force... to reach the target relative positions", "damping... to reach the target relative velocities" ([joints guide](https://rapier.rs/docs/user_guides/javascript/joints)). Fields: `target_pos`, `target_vel`, `stiffness`, `damping`, `max_force` ([JointMotor docs](https://docs.rs/rapier3d/0.13.0/rapier3d/dynamics/struct.JointMotor.html)).
- **Motor model**: Rapier has an *acceleration-based* model, which is easier to tune across masses, and a *force-based* model, which depends on mass ([motor_model.rs mirror](https://idanarye.github.io/bevy-tnua/src/rapier3d/dynamics/joint/motor_model.rs.html)). **Use acceleration-based** so one set of numbers works for head and thigh alike. That gets us close to Unreal Physics Control's mass-independent "strength + damping ratio".
- Rapier's own position-motor example uses stiffness **1000**, damping **150** ([joint_motor_position3.rs v0.20](https://git.nea.moe/github/rapier.git/plain/examples3d/joint_motor_position3.rs?h=v0.20.0)).
- **Convert from "feel" numbers** (for the acceleration model, where stiffness k ≈ ω² and damping c ≈ 2ζω):
  - Alive, holding a pose: f = 4–6 Hz, so ω ≈ 25–38, **k ≈ 600–1400, c ≈ 50–75** at ζ = 1. The same ballpark as Rapier's 1000/150.
  - Hit "looseness" floor: about 10% of k (Euphoria's `MinLooseness 0.1`), with ζ kept around 0.7–1.
  - Dying toward a death pose: about 10–20% of alive k, fading to 0 over about 1.5 s.
  - Writhe: k about 40–60% of alive with ζ about 0.5 (Euphoria damping 0.5 "underdamped"), target pose animated by noise with a period of about 1 s.
  - **Cap the force** (`setMotorMaxForce`) on every motor so a bad target cannot launch the body.
- Jolt's equivalent: `MotorSettings(frequency, damping)` with force and torque limits. Its position mode is `force = stiffness * (target − current) − damping * velocity` ([MotorSettings.h](https://github.com/jrouwe/JoltPhysics/blob/master/Jolt/Physics/Constraints/MotorSettings.h)).
- **Alternative with no joint motors**: velocity drive (Respawn's method 2, Jolt's `DriveToPoseUsingKinematics`). Each step, set each body's angular velocity toward its target rotation: ω = axis·angle / dt × gain, with gain 0.1–0.4 for soft following, blended with the current velocity. It uses only public JS API (`setAngvel`, `setLinvel`), works today, and costs a little JS maths per body. Rapier also ships a `PidController` (rapier.js 0.15) built for velocity-based control ([CHANGELOG](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md)).

### 5.4 Collision groups and contacts

- Disable contacts on each joint (`joint.setContactsEnabled(false)`). Rapier's ragdoll test does this on every joint ([ragdolls3.rs](https://github.com/dimforge/rapier/blob/master/examples3d/stress_tests/ragdolls3.rs)).
- Use collision groups (16-bit membership + 16-bit filter) for "ragdoll limbs never hit other ragdolls, torsos may" and "ragdolls ignore the player capsule".
- **Dominance groups** make one body immune to another's push ([rigid bodies guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)). Put corpses in a lower dominance group than the mech's feet and players, so a pile can never shove the mech.
- Contact force events with a threshold ([advanced collision detection](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection)) give us "corpse hit a wall hard → thud sound or blood decal" without polling.

### 5.5 Three.js and browser examples found

- **mattvb91/rapierjs-ragdoll** (three.js + Rapier, TypeScript): 11 bodies, `JointData.spherical` for **every** joint including elbows and knees, **no limits**, one shared density ([repo](https://github.com/mattvb91/rapierjs-ragdoll), [Ragdoll.ts](https://github.com/mattvb91/rapierjs-ragdoll/blob/main/src/Ragdoll.ts), [write-up](https://dev.to/mattvb91/realistic-ragdoll-physics-in-threejs-1pko)). A good example of the spaghetti setup to avoid.
- The three.js forum "Active Ragdoll Physics" thread has no real active-ragdoll answer. It points to the old cannon.js ragdoll demo and a "physics with animation mixer" demo that attaches spheres to animated bones ([thread](https://discourse.threejs.org/t/active-ragdoll-physics/67247), [cannon.js demo](https://schteppe.github.io/cannon.js/demos/ragdoll.html), [sbcode demo](https://sbcode.net/extra_html/physics-with-animation-mixer.html)).
- three.js ships a `RapierPhysics` helper, but it covers basic bodies only ([docs](https://threejs.org/docs/pages/RapierPhysics.html)).
- **JoltPhysics.js** has rig examples: `rig/create_rig`, `rig/kinematic_rig`, `rig/load_rig` and **`rig/powered_rig`**. The last calls `DriveToPoseUsingMotors(pose)` each frame in the browser ([repo](https://github.com/jrouwe/JoltPhysics.js), [powered_rig.html](https://github.com/jrouwe/JoltPhysics.js/blob/main/Examples/rig/powered_rig.html)).
- **Net finding: I found no public three.js + Rapier *active* ragdoll.** Whatever we build is new ground in this stack.

---

## 6. Engine comparison for ragdolls in the browser

| | Rapier (`@dimforge/rapier3d`) | Jolt (`jolt-physics`) | cannon-es | ammo.js (Bullet) |
|---|---|---|---|---|
| Ragdoll helper | none (build it) | `Ragdoll`, `RagdollSettings` with `Stabilize()`, `DisableParentChildCollisions()`, `SetPose`, `GetPose`, `DriveToPoseUsingMotors`, `DriveToPoseUsingKinematics`, `AddImpulse` ([Ragdoll.h](https://github.com/jrouwe/JoltPhysics/blob/master/Jolt/Physics/Ragdoll/Ragdoll.h)) | none | none (classic demo values above) |
| Cone and twist limits | per-axis (Rust; JS through raw calls) | true swing-twist (normal cone, plane cone, twist) | ConeTwist | btConeTwist |
| Joint motors | revolute and prismatic in JS; spherical through raw calls | yes, frequency + damping + force/torque limits | hinge only | btConeTwist motor |
| Multithreading | no (single thread) | yes, `wasm-multithread` builds ([README](https://github.com/jrouwe/JoltPhysics.js)); needs cross-origin isolation headers for SharedArrayBuffer | no | no |
| Maintenance | active (0.19.x 2025, docs at 0.21) | active | "apparently no longer maintained" per [three.js manual](https://threejs.org/manual/en/physics) | old |
| Our switching cost | none, already integrated | high: whole physics layer, character controller, queries | n/a | n/a |

**Verdict**: stay on Rapier. Jolt's ragdoll API is the cleaner design, so **copy it** in a thin `Ragdoll` class of our own: stabilize at build, pose in and out, drive by motors or kinematics. Treat Jolt as a fallback only if Rapier's raw spherical-motor path fails in testing.

---

## 7. Procedural tricks that fake physics cheaply

### 7.1 Verlet sticks (Jakobsen)
- **What**: particles at joints plus distance constraints, relaxed a few times per frame ([Advanced Character Physics](https://gamedeveloper.com/programming/advanced-character-physics)). Overgrowth's predecessor Lugaru used it ("Newtonian particles connected by rigid stick constraints", per the [Wolfire blog via search summary](https://wolfire-blog.appspot.com/2009/05/creating-the-overgrowth-physics-engine). The page itself now 404s).
- **Cost**: about 15 particles × 4 iterations of plain JS per body. Very cheap.
- **Fit**: far-LOD corpses, dangling gear, severed-limb chains (intestine-like straps), the mech's cables. Collide only against a floor height or plane.

### 7.2 Spring bones for secondary motion
- **What**: per-bone damped springs toward the animated rotation, with gravity and drag. three-vrm's spring bones use `stiffness`, `gravityPower`, `gravityDir`, `dragForce` and `hitRadius`, and must be rescaled with model scale ([three-vrm spring bones on scaled models](https://pixiv.github.io/three-vrm/docs/documents/spring-bones-on-scaled-models.html)).
- **Fit**: yes, for pouches, antennas, a heavy's belly, loose straps, and the stump wobble on crawlers. Cost is tiny.

### 7.3 Foot and hand IK for plants, stumbles and crawling
- three.js has a `CCDIKSolver` in its addons, and two-bone analytic IK is a few lines.
- Rosen's GDC 2014 talk shows how few keyframes (13 for Overgrowth) you need when the rest is procedural springs and IK ([GDC Vault](https://gdcvault.com/play/1020049/Animation-Bootcamp-An-Indie-Approach), [summary](https://gamedeveloper.com/design/video-an-indie-approach-to-procedural-animation)).
- Rain World's GDC 2016 talk covers procedural limbs on simple bodies ([Game Developer](https://gamedeveloper.com/art/video-animating-i-rain-world-i-and-its-many-squishy-stretchy-creatures)).
- **Fit**: yes. Crawlers (hand plants), stumbles (foot placement), corpses on stairs (one pass to snap feet out of steps).

### 7.4 Pose-space flinches
See 3.2a. Combine with directional stagger clips (KF2 and Doom style) for big hits.

### 7.5 "String puppet" active ragdoll
Physical torso plus hands and feet, with visual IK limbs between them ("8 tips"). It is a cheap way to get an active-ragdoll look on 1–2 hero enemies (a brute, a boss) without a full motor rig.

---

## 8. Co-op note (host-authoritative, cosmetic ragdolls per client)

Every client runs its own ragdoll from the same **hit record**: body part, hit point, direction, weapon class and impulse. The physics will not match across clients. That is fine for cosmetic bodies, but three things should be deterministic from the record, so both screens agree on what matters:
- whether a wall pin happened, and on which surface point (send the pin point);
- which limb came off (send it);
- whether the enemy fell or recovered from a stagger (host decides, client plays it).

Frostbite's talk lists "networking" as a solved problem area, but its content is not public ([GDC Vault abstract](https://gdcvault.com/play/1025210/Physics-Driven-Ragdolls-and-Animation)).

---

## 9. Top 12 ideas, ranked by wow per effort

Ranked for OVERPOWERED 2 as described: an existing ragdoll, dismemberment, crawlers, explosions, a mech, co-op. Some of these may already exist in part; the code audit will tell.

| # | Idea | Wow | Effort | Why it ranks here |
|---|---|---|---|---|
| 1 | **Shaped hit impulses**: 0.1 s spread, 50% pelvis counter-impulse, weapon-class table, airborne clamp with shotgun and explosive pass-through, diminishing repeat hits (3.1) | High | Very low | Every kill and corpse shot looks better. Euphoria's defaults give us the numbers. |
| 2 | **Anti-spaghetti setup pass**: one-sided revolute knees and elbows, real hip, shoulder and neck limits through raw per-axis limits, Jolt's 0.8–1.2 mass chain, 2–3× inertia on arm links, no hand or foot colliders, parent-child contacts off (4.1–4.2, 5.2) | High | Low | Removes the most common "cheap ragdoll" tells. Mostly data, not code. |
| 3 | **Momentum-correct death handoff**: inherit two-frame animation velocity with quaternion polarity, plus spawn de-penetration rays along the bones (3.3, 2.7) | High | Low | Kills the death "pop" and the corpse convulsing in the floor. |
| 4 | **Per-collider explosion impulses at closest point, scaled by projected area**, with up-bias and short soft CCD (3.5) | High | Low | Spin and tumble for free on every fling. |
| 5 | **Wall pinning** for one or two special weapons: raycast carry, then a spherical joint to a fixed body (3.6) | Very high | Low–med | The most "screenshot" moment per line of code. One joint per pin. |
| 6 | **Pose-space spring flinches** on all 48 enemies, plus directional stagger clips for big hits (3.2a) | High | Low–med | Living enemies visibly feel each bullet. TLOU2 says hit reactions are most of weapon feel. |
| 7 | **"Dying, not limp"**: decaying drive toward the death clip with Respawn's pelvis-distance bailout, then a weak death-pose drive fading over about 1.5 s, using velocity drive (works today) or raw spherical motors (3.3, 5.3) | Very high | Medium | The biggest step toward the Euphoria look. Distance-gate it to the nearest 6–10 enemies. |
| 8 | **Settle, freeze and budget pipeline**: Doom 3-style figure rest test (1 s, small move) plus max-awake cap, LRU cap on simulated ragdolls, no ragdoll-vs-ragdoll except torso, Bullet-style damping (3.9) | Medium (enables the rest) | Low | Keeps nukes and airstrikes at frame rate, so the other 11 can run. |
| 9 | **Leg-shot stumble state**: 2 free steps with foot IK, stability drops 30% per step, a second hit means a fall; doubles as crowd control (3.4) | High | Medium | Gameplay and feel together (TLOU2 leg stun, Euphoria StaggerFall). |
| 10 | **Crawler upgrade**: hand-plant IK crawl, reach-for-wound pauses (0.2 s delay, about 2 s hold), underdamped writhe noise when stopped, clearer threat state (3.8) | Medium–high | Medium | Our maimed enemies become memorable. Doom's lesson keeps them readable. |
| 11 | **Knockdown and get-up** for survivors of explosions and mech stomps: ragdoll settles, choose face-up or face-down clip, align root yaw to pelvis, blend from the pose snapshot over about 0.3 s (2.6, 2.2) | High | High | Needs get-up clips and careful blending. Strong payoff but the most work here. |
| 12 | **Spring-bone secondary motion** on gear, heads and stumps, plus Verlet stick ragdolls for far-LOD corpses (7.1–7.2) | Medium | Low | Cheap life everywhere, and a fallback LOD that frees Rapier for close bodies. |

Honourable mentions: partial-teleport corpse dragging (2.7), contact-force "body slam" sounds and decals (5.4), corpses in a low dominance group so piles never shove the mech (5.4).

---

## 10. What I could not find

- **No public technical source for Euphoria's balance controller** (only the behaviour API and its parameters through GTA V script docs), and none for Max Payne 3 or RDR2 internals beyond interviews.
- **Gated or unrecorded GDC content**: no slides or transcripts for EA/Frostbite's ragdoll talk, Uncharted 4's physics animation talk, or the full Fallen Order talk. Only abstracts and press write-ups.
- **No developer write-ups** on how Gang Beasts, Human Fall Flat, TABS, Exanima, Boneworks/Bonelab, Half-Life: Alyx, Hitman (modern), Battlefield, Arma 3, Ready or Not, Mordhau, Halo, Ultrakill, Trepang2 or Severed Steel build ragdolls or hit reactions. Only player commentary and a one-line Human Fall Flat dev comment.
- **KF2 hit reactions** beyond a press feature: no tuning values.
- **Zordan & Hodgins gain values**: the paper full text was not reachable, only the abstract.
- **Unity PuppetMaster's official manual**: only forum tips.
- **Saints & Sinners tech blog and a Medium "analysis of active ragdolls" article** both refused automated fetches. I used search-index snippets only.
- **Source engine defaults** for `ragdoll_sleepaftertime` and fade speed.
- **Rapier WASM ragdoll timings** (ms per ragdoll). Neither Dimforge nor anyone else has published them as far as I found. Measure with `World.timing*`.
- **Rolling resistance in Rapier**: not found in the docs. I suggested contact-gated angular damping instead.
- **Runtime confirmation of the raw per-axis spherical limit and motor path in rapier.js.** Confirmed from source, **not executed**.
- **No public three.js + Rapier active-ragdoll project.**
