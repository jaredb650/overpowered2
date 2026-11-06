// Long audio soak in the real game, with a bot firing for minutes. The owner's "audio gives up" cannot be heard
// from here, so this logs everything that could explain it, once a second:
//
//   node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/audio-stress.mjs --wait 3000 --timeout 175
//
// Env:
//   AS_LABEL=before     Names the log: tools/out/audio-stress-<label>.json
//   AS_PLAN=a:20,b:30   Phases and seconds. Default runs them all in 102 s. See PHASES.
//   AS_METER=0          Skips the output tap.
//   AS_CDP=0            Skips CDP's WebAudio domain. It reports every node and param, which is real main-thread work,
//                       so the cleanest numbers for frame rate come from a run without it. Loses render capacity.
//
// What it reads: engine stats, every request by id and outcome (it wraps startVoice), the AudioContext's state and
// latency, underruns from ac.playbackStats, an analyser tap on the final output for level and NaN, and Chrome's own
// render capacity over CDP's WebAudio domain, which is the number the DevTools WebAudio panel shows.
//
// Do not tap with an AudioWorklet. Adding one moves the graph onto a worklet thread, and that alone read as 99%
// capacity and a late clock on an idle game.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LABEL = process.env.AS_LABEL ?? 'run';
const METER = process.env.AS_METER !== '0';
const CDP = process.env.AS_CDP !== '0';
const DEADLINE_MS = 135000;
/** Ids that must never drop out, and whose requests the summary lists one by one. */
const MUST_PLAY = /^(smg_fire|shotgun_fire|rocket_fire|minigun_|hit_marker|enemy_headshot|perk_|bloodthirsty_shot|berserk_shot|hellfire_shot)/;
const PLAN = (process.env.AS_PLAN ?? 'idle:4,smg:25,buzzsaw:20,rockets:10,slowmo:10,everything:15,pause:4,hidden:4,after:10')
  .split(',').map(s => { const [name, seconds] = s.split(':'); return { name, seconds: Number(seconds) }; });

/** Runs in the page. Everything it keeps is plain data, so the log can be read back at any time. */
async function install({ meter }) {
  const { ctx, game } = window.__op2;
  const engine = ctx.audio;
  const ac = engine.contextForTests;
  const log = { samples: [], errors: [], meters: [], phases: [], ids: {}, phase: 'boot', capabilities: {} };
  window.__as = log;
  // What a player's first click does. Without it there is no music, and hiding the tab does not suspend the context.
  engine.unlock();
  // A slow boot can leave the unguarded player dead before the bot takes over.
  if (game.state !== 'playing') game.newRun();
  window.addEventListener('error', e => log.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => log.errors.push(String(e.reason)));

  log.capabilities = {
    sampleRate: ac.sampleRate,
    baseLatency: ac.baseLatency,
    outputLatency: ac.outputLatency,
    playbackStats: 'playbackStats' in ac,
    renderCapacity: 'renderCapacity' in ac,
    destinationChannels: ac.destination.maxChannelCount,
    userAgent: navigator.userAgent,
  };

  // Every request, with what became of it. Stacks and groups have resolved to real sounds by this point.
  const startVoice = engine.startVoice;
  const counts = engine.counts;
  const keys = Object.keys(counts).filter(k => k !== 'played' && k !== 'stolen');
  const mark = new Array(keys.length).fill(0);
  engine.startVoice = function (sound, ...rest) {
    for (let i = 0; i < keys.length; i++) mark[i] = counts[keys[i]];
    const voice = startVoice.call(this, sound, ...rest);
    const id = sound.def.id;
    const row = log.ids[id] ?? (log.ids[id] = { asked: 0, got: 0 });
    row.asked++;
    if (voice) row.got++;
    else for (let i = 0; i < keys.length; i++) if (counts[keys[i]] !== mark[i]) row[keys[i]] = (row[keys[i]] ?? 0) + 1;
    return voice;
  };

  if (meter) {
    const tap = ac.createAnalyser();
    tap.fftSize = 2048;
    engine.mixerForTests.clipper.connect(tap);
    const data = new Float32Array(2048);
    log.readTap = () => {
      tap.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      let nan = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v !== v) { nan++; continue; }
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      log.meters.push({ phase: log.phase, rms: Math.sqrt(sum / data.length), peak, nan });
    };
  }

  const V = ctx.player.position.constructor;
  const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
  const down = new V(0, -1, 0);
  const from = new V();
  const ground = (x, z) => {
    from.set(x, ctx.player.position.y + 2, z);
    return ctx.physics.raycastInto(from, down, 30, 1, hit) ? hit.point : from;
  };
  const spawnKinds = ['husk', 'trooper', 'gunner', 'husk', 'brute', 'leaper', 'drone', 'skitter', 'burner', 'husk'];
  let spawned = 0;
  const topUp = target => {
    const alive = ctx.enemies.alive.length;
    const p = ctx.player.position;
    for (let i = alive; i < target && i < alive + 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 7 + Math.random() * 22;
      if (ctx.enemies.spawn(spawnKinds[spawned++ % spawnKinds.length], ground(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d))) continue;
    }
  };

  const weapons = ctx.weapons;
  for (const w of ['smg', 'shotgun', 'rocket', 'autocannon', 'buzzsaw', 'judge', 'kiln', 'stakegun', 'lance']) weapons.give(w);

  let t = 0;
  let last = performance.now();
  let perkClock = 0;
  let frames = 0;
  let worst = 0;
  const perksFor = {
    rockets: ['hellfire'],
    slowmo: ['slowmo', 'berserk'],
    everything: ['bloodthirst', 'hellfire', 'berserk', 'chainStorm', 'sentinels', 'butcher', 'chainReaction', 'adrenaline', 'overdrive'],
  };
  const weaponFor = { smg: 'smg', buzzsaw: 'buzzsaw', rockets: 'rocket', slowmo: 'smg', everything: 'buzzsaw', after: 'smg' };
  log.firing = true;
  const tick = now => {
    requestAnimationFrame(tick);
    const dt = (now - last) / 1000;
    last = now;
    frames++;
    if (dt > worst) worst = dt;
    if (frames % 15 === 0) log.readTap?.();
    if (game.state !== 'playing') return;
    t += dt;
    const p = ctx.player;
    p.health = p.maxHealth;
    if (p.armor !== undefined) p.armor = p.maxArmor ?? 100;
    weapons.refillMagazines();
    weapons.addAmmo(1);
    const want = weaponFor[log.phase];
    if (want && weapons.current !== want) weapons.switchTo(want);
    let best = null;
    let bestD = Infinity;
    for (const e of ctx.enemies.alive) {
      const d = e.position.distanceToSquared(p.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best && p.eye) {
      const dx = best.center.x - p.eye.x;
      const dy = best.center.y - p.eye.y;
      const dz = best.center.z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    ctx.input.simulate('fire', log.firing && !!want);
    ctx.input.simulate('forward', Math.sin(t * 0.5) > 0);
    ctx.input.simulate('left', Math.sin(t * 0.9) > 0.2);
    ctx.input.simulate('right', Math.sin(t * 0.9) < -0.2);
    ctx.input.simulate('jump', Math.sin(t * 2.3) > 0.7);
    perkClock -= dt;
    if (perkClock <= 0) {
      perkClock = 3;
      topUp(log.phase === 'after' ? 24 : 48);
      for (const id of perksFor[log.phase] ?? []) ctx.progression.grant(id);
    }
  };
  requestAnimationFrame(tick);

  const realStart = performance.now();
  let before = engine.stats();
  log.takeSample = () => {
    const s = engine.stats();
    const mixer = engine.mixerForTests;
    const sample = {
      t: Math.round((performance.now() - realStart) / 100) / 10,
      phase: log.phase,
      fps: frames,
      worstFrameMs: Math.round(worst * 1000),
      gameState: game.state,
      enemies: ctx.enemies.alive.length,
      ragdolls: ctx.gore.bodies?.length,
      state: ac.state,
      baseLatency: ac.baseLatency,
      outputLatency: ac.outputLatency,
      currentTime: ac.currentTime,
      voices3d: s.voices3d,
      voices2d: s.voices2d,
      voicesUi: s.voicesUi,
      hrtf: s.hrtf,
      loops: s.loops,
      budget: s.budget,
      loadStep: s.loadStep,
      thinned: s.thinnedQuiet + s.thinnedRepeat - (before.thinnedQuiet + before.thinnedRepeat),
      played: s.played - before.played,
      stolen: s.stolen - before.stolen,
      dropped: s.dropped - before.dropped,
      culled: s.culled - before.culled,
      collapsed: s.collapsed - before.collapsed,
      missed: s.missed - before.missed,
      duck: s.duck,
      limiterDb: mixer.filters.gainReduction,
      heapMb: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
      playback: ac.playbackStats?.toJSON?.(),
      loopIds: [...engine.pool3d.all, ...engine.pool2d.all].filter(v => v.loop && !v.releasing).map(v => v.soundId).sort().join(' '),
      live: s,
    };
    before = s;
    frames = 0;
    worst = 0;
    log.samples.push(sample);
    return sample;
  };
  log.setHidden = hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

export default async function stress(page, h) {
  const began = Date.now();
  const say = text => console.error(`[${((Date.now() - began) / 1000).toFixed(1)}s] ${text}`);
  say('page loaded');
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing' && !!window.__op2.ctx.audio.contextForTests)) break;
    await h.sleep(1000);
  }
  // The bank finishes after the run starts on a slow boot, and a soak should not be measuring that.
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__op2.ctx.audio.stats().ready)) break;
    await h.sleep(500);
  }

  say('sounds ready');
  const cdp = await page.context().newCDPSession(page);
  const nodes = { created: 0, destroyed: 0, byType: {} };
  let contextId = null;
  cdp.on('WebAudio.contextCreated', e => { if (e.context.contextType === 'realtime') contextId = e.context.contextId; });
  cdp.on('WebAudio.audioNodeCreated', e => {
    nodes.created++;
    nodes.byType[e.node.nodeType] = (nodes.byType[e.node.nodeType] ?? 0) + 1;
  });
  cdp.on('WebAudio.audioNodeWillBeDestroyed', () => { nodes.destroyed++; });
  if (CDP) await cdp.send('WebAudio.enable');

  await page.evaluate(install, { meter: METER });
  say('probe installed');

  const started = Date.now();
  const file = join(h.outDir, `audio-stress-${LABEL}.json`);
  const rows = [];
  const every = async () => {
    // A page too busy to answer is a result in itself, and must not stop the log.
    const asked = Date.now();
    const s = await Promise.race([
      page.evaluate(() => {
        const { live, ...rest } = window.__as.takeSample();
        return { ...rest, peakPre: live.peakPre, peakPost: live.peakPost, extra: live.budget };
      }),
      h.sleep(8000).then(() => null),
    ]);
    if (!s) {
      say(`page did not answer for ${Date.now() - asked} ms`);
      return;
    }
    if (contextId) {
      const r = await cdp.send('WebAudio.getRealtimeData', { contextId }).catch(() => null);
      if (r) {
        s.renderCapacity = r.realtimeData.renderCapacity;
        s.callbackMs = r.realtimeData.callbackIntervalMean * 1000;
        s.callbackVar = r.realtimeData.callbackIntervalVariance;
      }
    }
    s.nodesLive = nodes.created - nodes.destroyed;
    s.nodesCreated = nodes.created;
    const prev = rows.at(-1);
    if (prev) {
      const wall = s.t - prev.t;
      // The audio clock only advances as fast as the render thread keeps up, so below 1 is audio falling behind.
      s.clockRate = wall > 0 ? (s.currentTime - prev.currentTime) / wall : 1;
      if (s.playback && prev.playback) {
        s.underrunShare = (s.playback.underrunDuration - prev.playback.underrunDuration) / Math.max(0.001, s.playback.totalDuration - prev.playback.totalDuration);
        s.underruns = s.playback.underrunEvents - prev.playback.underrunEvents;
      }
    }
    rows.push(s);
    // A run that hits the harness timeout must still leave its log behind.
    if (rows.length % 5 === 0) writeFileSync(file, JSON.stringify({ plan: PLAN, rows, nodes, partial: true }, null, 1));
    const voices = s.voices3d + s.voices2d;
    console.error(`[${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s ${s.phase.padEnd(10)}] v=${String(voices).padStart(2)} hrtf=${s.hrtf} loops=${s.loops} step=${s.loadStep} played=${s.played} thin=${s.thinned} drop=${s.dropped} stolen=${s.stolen} cap=${(s.renderCapacity ?? 0).toFixed(3)} clock=${(s.clockRate ?? 1).toFixed(2)} under=${((s.underrunShare ?? 0) * 100).toFixed(0)}% lim=${s.limiterDb.toFixed(1)}dB ${s.state} fps=${s.fps} en=${s.enemies} nodes=${s.nodesLive}`);
  };

  const run = async (name, seconds) => {
    await page.evaluate(n => { window.__as.phase = n; window.__as.phases.push({ name: n, at: performance.now() }); }, name);
    if (name === 'pause') {
      await page.evaluate(() => window.__op2.game.setState('paused'));
    } else if (name === 'hidden') {
      await page.evaluate(() => { window.__op2.game.setState('playing'); window.__as.setHidden(true); });
    }
    // By the clock, not by counting samples: a slow sample must not stretch the run past the harness timeout.
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      await h.sleep(1000);
      await every();
    }
    if (name === 'pause') await page.evaluate(() => window.__op2.game.setState('playing'));
    if (name === 'hidden') await page.evaluate(() => window.__as.setHidden(false));
  };

  // The log is written from the page at the end, so a run must leave itself time before the harness closes it.
  for (const phase of PLAN) {
    if (Date.now() - began < DEADLINE_MS) await run(phase.name, phase.seconds);
  }

  const tail = await page.evaluate(() => {
    const { errors, ids, meters, capabilities, phases } = window.__as;
    return { errors, ids, meters, capabilities, phases };
  });
  writeFileSync(file, JSON.stringify({ plan: PLAN, rows, nodes, ...tail }, null, 1));

  // Not `notRunning`: the hidden phase suspends the context with the game still firing, which a really hidden tab cannot do.
  const losses = r => (r.dropped ?? 0) + (r.droppedBudget ?? 0) + (r.droppedFamily ?? 0) + (r.thinnedQuiet ?? 0) + (r.thinnedRepeat ?? 0) + (r.missed ?? 0) + (r.invalid ?? 0);
  const lost = Object.entries(tail.ids).filter(([id, r]) => MUST_PLAY.test(id) && losses(r) > 0).map(([id, r]) => `${id} lost ${losses(r)} of ${r.asked}`);
  const firing = tail.meters.filter(m => !['idle', 'pause', 'hidden'].includes(m.phase));
  const asked = Object.values(tail.ids).reduce((n, r) => n + r.asked, 0);
  const got = Object.values(tail.ids).reduce((n, r) => n + r.got, 0);
  const worstBy = key => rows.reduce((m, r) => Math.max(m, r[key] ?? 0), 0);
  const mean = (list, key) => list.reduce((n, r) => n + (r[key] ?? 0), 0) / Math.max(1, list.length);
  const byPhase = PLAN.map(({ name }) => {
    const list = rows.filter(r => r.phase === name);
    return `${name}: cap ${mean(list, 'renderCapacity').toFixed(3)}, clock ${mean(list, 'clockRate').toFixed(3)}, underrun ${(mean(list, 'underrunShare') * 100).toFixed(1)}%, voices ${mean(list, 'voices3d').toFixed(0)}+${mean(list, 'voices2d').toFixed(0)}, hrtf ${mean(list, 'hrtf').toFixed(1)}, step ${mean(list, 'loadStep').toFixed(1)}, limiter ${mean(list, 'limiterDb').toFixed(1)} dB, played/sample ${mean(list, 'played').toFixed(0)}, thinned ${mean(list, 'thinned').toFixed(0)}, dropped ${mean(list, 'dropped').toFixed(1)}`;
  });
  const quiet = firing.filter(m => m.rms < 0.0005).length;
  return {
    file,
    capabilities: tail.capabilities,
    byPhase,
    nodesByType: nodes.byType,
    requests: `${got} of ${asked} got a voice`,
    mustPlayLost: lost,
    worst: { capacity: worstBy('renderCapacity'), loops: worstBy('loops'), hrtf: worstBy('hrtf'), limiterDb: rows.reduce((m, r) => Math.min(m, r.limiterDb), 0) },
    silentReads: `${quiet} of ${firing.length} while firing`,
    rms: Number((firing.reduce((n, m) => n + m.rms, 0) / Math.max(1, firing.length)).toFixed(3)),
    outputPeak: Number(tail.meters.reduce((m, r) => Math.max(m, r.peak), 0).toFixed(3)),
    nan: tail.meters.reduce((n, m) => n + m.nan, 0),
    errors: tail.errors.slice(0, 10),
  };
}
