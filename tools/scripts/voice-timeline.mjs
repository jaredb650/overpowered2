// Plays the Outpost with every voice clip on a stopwatch. Before the game boots it patches HTMLMediaElement.prototype.play and watches
// each voice element's playing, ended, pause, error and emptied events, and it wraps the runner, the radio, the films and the
// Commander's box, so what was heard can be laid against what the mission asked for, on the page's own clock.
//
//   VOICE_STEP=campaign node tools/shot.mjs --url "/audio/voice/manifest.json" --script tools/scripts/voice-timeline.mjs --out tools/out/voice-campaign.png --wait 200 --timeout 620 --dpr 2 --w 1440 --h 900 --quiet
//
// The --url is a light page only: the script installs its probe and then opens the game itself, so the probe is in before the first
// line of the game runs. VOICE_STEP picks the run:
//   campaign  briefing film, the ride with the door gun firing, the crash, lockout, the gate, and a death in the middle of soft.east
//   ending    ?beat=commander: the boss to his death, his last words, the ending lines and film, and the complete screen
//   pause     a pause in the middle of the first line, a skip in the middle of the second, a pause and a restart in the ride
//   direct    ?beat=ending, with no screenshots, for the film against its lines
//   skip      the briefing skipped 0.6 s in, on a fresh page
// The timeline and its analysis land in tools/out/voice-<step>.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const STEP = process.env.VOICE_STEP ?? 'campaign';
const DURATIONS = process.env.VOICE_DURATIONS ?? '';

/** Runs in the page before any of the game's code. Everything it learns goes to window.__alog. */
function probe() {
  const T = () => Math.round(performance.now()) / 1000;
  const log = (window.__alog = []);
  const push = (kind, data) => log.push({ t: T(), kind, ...(data ?? {}) });
  window.__apush = push;

  // ---- Voice elements ---------------------------------------------------------------------------------------------------
  const recs = new Map();
  let nextId = 0;
  const clipOf = el => {
    const s = el.getAttribute('src') || '';
    const m = /audio\/voice\/([^?#]+)\.mp3/.exec(s);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const sounding = new Set();
  const hook = (el, rec) => {
    const on = (type, fn) => el.addEventListener(type, fn);
    on('playing', () => {
      rec.sounding = true;
      sounding.add(rec);
      const others = [...sounding].filter(r => r !== rec).map(r => `${r.clip}#${r.id}@vol${r.el.volume.toFixed(2)}`);
      push('playing', { el: rec.id, clip: rec.clip, ct: +el.currentTime.toFixed(2), dur: +(el.duration || 0).toFixed(3), vol: +el.volume.toFixed(2), others });
    });
    const stop = type => () => {
      const was = rec.sounding;
      rec.sounding = false;
      sounding.delete(rec);
      push(type, { el: rec.id, clip: rec.clip, ct: +el.currentTime.toFixed(2), dur: +(el.duration || 0).toFixed(3), vol: +el.volume.toFixed(2), was });
    };
    on('ended', stop('ended'));
    on('pause', stop('pause'));
    on('error', () => {
      rec.sounding = false;
      sounding.delete(rec);
      push('error', { el: rec.id, clip: rec.clip, code: el.error?.code ?? null, msg: el.error?.message ?? '' });
    });
    on('emptied', stop('emptied'));
    on('waiting', () => push('waiting', { el: rec.id, clip: rec.clip, ct: +el.currentTime.toFixed(2) }));
    on('volumechange', () => {
      const v = el.volume;
      if (v === 0 || Math.abs(v - rec.vol) > 0.08) {
        push('vol', { el: rec.id, clip: rec.clip, vol: +v.toFixed(3) });
        rec.vol = v;
      }
    });
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const clip = clipOf(this);
    if (!clip) return play.call(this);
    let rec = recs.get(this);
    if (!rec) {
      rec = { id: ++nextId, clip, el: this, sounding: false, vol: this.volume };
      recs.set(this, rec);
      hook(this, rec);
    }
    push('play()', { el: rec.id, clip, ct: +this.currentTime.toFixed(2), vol: +this.volume.toFixed(2), ready: this.readyState });
    const p = play.call(this);
    p.then(() => push('play-ok', { el: rec.id, clip }), e => push('play-refused', { el: rec.id, clip, err: e?.name ?? String(e) }));
    return p;
  };

  // ---- The game ---------------------------------------------------------------------------------------------------------
  const wrap = (obj, name, before, after) => {
    const orig = obj?.[name];
    if (typeof orig !== 'function') {
      push('wrap-miss', { name });
      return;
    }
    obj[name] = function (...args) {
      let mark;
      try { mark = before?.call(this, ...args); } catch (e) { push('wrap-err', { name, e: String(e) }); }
      const out = orig.apply(this, args);
      try { after?.call(this, mark, out, ...args); } catch (e) { push('wrap-err', { name, e: String(e) }); }
      return out;
    };
  };
  const small = p => {
    if (!p || typeof p !== 'object') return p;
    const o = {};
    for (const k in p) {
      const v = p[k];
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
      else if (k === 'vars') o[k] = v;
    }
    return o;
  };
  const EVENTS = /^(commander:|campaign:|player:died|run:start|run:end|game:state|vehicle:destroyed|weapon:unlocked)/;
  let kills = 0;

  const onCampaign = c => {
    const { runner, host, ui } = c;
    const radioState = r => ({ onAir: r.onAir?.line.id ?? null, queue: r.radio.map(s => s.line.id) });
    wrap(runner, 'open', function (index) { return { from: this.beat?.id ?? null }; }, function (m, _o, index) {
      push('beat', { id: this.mission.beats[index]?.id, index, from: m.from, elapsed: +this.elapsed.toFixed(2) });
    });
    wrap(runner, 'signal', function (name) { push('signal', { name, beat: this.beat?.id }); });
    wrap(runner, 'say', function (id, again, latch, now, within) {
      return { heard: this.heard.has(id), queued: this.radio.some(s => s.line.id === id), ...radioState(this) };
    }, function (m, _o, id, again, latch, now, within) {
      const r = this;
      const where = r.onAir?.line.id === id ? 'on-air' : r.radio.some(s => s.line.id === id) ? 'queued' : 'not-queued';
      push('say', { id, again: !!again, now: !!now, wait: !!latch, within: Number.isFinite(within) ? within : null, beat: r.beat?.id, wasHeard: m.heard, wasQueued: m.queued, before: { onAir: m.onAir, queue: m.queue }, result: where });
    });
    wrap(runner, 'nextLine', function () {
      return { ids: this.radio.map(s => s.line.id), asked: this.radio.map(s => +(this.elapsed - s.asked).toFixed(2)) };
    }, function (m) {
      const left = new Set([...this.radio.map(s => s.line.id), this.onAir?.line.id]);
      m.ids.forEach((id, i) => {
        if (!left.has(id)) push('dropped-late', { id, waited: m.asked[i], beat: this.beat?.id });
      });
    });
    wrap(runner, 'hush', function () { push('runner.hush', { beat: this.beat?.id, ...radioState(this) }); });
    wrap(runner, 'down', function () { push('runner.down', { beat: this.beat?.id, ...radioState(this) }); });
    wrap(runner, 'redeploy', function () { push('runner.redeploy', { beat: this.beat?.id, saved: this.save ? this.mission.beats[this.save.index]?.id : null }); });
    wrap(runner, 'win', function () { push('runner.win', {}); });
    wrap(runner, 'noteKill', function (tag, source) {
      kills++;
      if (kills <= 12 || kills % 25 === 0) push('kill', { n: kills, tag, source, beat: this.beat?.id });
    });

    const speak = host.speak;
    host.speak = function (line, done) {
      push('speak', { id: line.id, words: line.text.split(' ').length, text: line.text.slice(0, 60) });
      return speak.call(this, line, () => {
        push('speak-done', { id: line.id });
        done();
      });
    };
    wrap(host, 'hush', () => push('host.hush', {}));
    const cutscene = host.cutscene;
    host.cutscene = function (id, scene, done) {
      push('film', { id, shots: scene.shots.map(s => s.seconds), fades: scene.shots.map(s => [s.fadeIn ?? 0, s.fadeOut ?? 0]) });
      return cutscene.call(this, id, scene, skipped => {
        push('film-done', { id, skipped });
        done(skipped);
      });
    };
    wrap(host, 'finished', () => push('finished', {}));
    wrap(host, 'call', (name, arg) => push('call', { name, arg: arg ?? null }));
    const ride = host.ride;
    host.ride = function (seat, route, done) {
      push('ride', { seat, marks: route.length });
      return ride.call(this, seat, route, () => { push('ride-done', {}); done(); });
    };
    const film = host.film;
    wrap(film, 'cut', function () { push('cut', { index: this.index, film: +this.total.toFixed(2) }); });
    wrap(film, 'stop', function (skipped) { push('film-stop', { skipped, film: +this.total.toFixed(2), index: this.index }); });

    let curtain = 0;
    wrap(ui, 'curtain', share => {
      if ((curtain === 0 && share > 0) || (curtain < 1 && share >= 1) || (curtain > 0 && share === 0)) push('curtain', { share: +share.toFixed(2) });
      curtain = share;
    });
    wrap(ui, 'lift', seconds => { push('lift', { seconds }); });
    const mv = ui.voice;
    wrap(mv, 'say', clips => push('mvoice.say', { clips, known: mv.known ? mv.known.size : null }));
    wrap(mv, 'stop', function () {
      const cur = this.current;
      if (cur || this.pending) push('mvoice.stop', { clip: cur ? (cur.audio.getAttribute('src') || '').replace(/^.*\//, '') : null, started: cur?.started ?? null, pending: !!this.pending });
    });
    wrap(mv, 'setPaused', p => push('mvoice.paused', { p }));
  };

  const onCommanderHud = cmd => {
    if (!cmd) return;
    wrap(cmd, 'onBark', function (id) { return { radio: this.radio, page: this.page, bark: this.bark }; }, function (m, _o, id) {
      const why = m.page >= 0 && !m.bark ? 'box open' : m.radio ? 'radio talking' : this.bark && this.page === 0 ? null : 'no such line';
      push('cmd.bark', { id, dropped: why, radio: m.radio });
    });
    wrap(cmd, 'show', function (index) { return { radio: this.radio }; }, function (m, _o, index) {
      const page = this.pages[index];
      push('cmd.show', { index, of: this.pages.length, bark: this.bark, speaker: page?.speaker, held: m.radio, clips: page?.parts.map(p => p.clip) });
    });
    wrap(cmd, 'hold', function () { push('cmd.hold', { page: this.page }); });
    wrap(cmd, 'close', function () { if (this.page >= 0) push('cmd.close', { page: this.page, bark: this.bark }); });
    wrap(cmd, 'onFulfil', () => push('cmd.fulfil', {}));
    const cv = cmd.voice;
    wrap(cv, 'say', clips => push('cvoice.say', { clips }));
    wrap(cv, 'stop', function () {
      const cur = this.current;
      if (cur || this.pending) push('cvoice.stop', { clip: cur ? (cur.audio.getAttribute('src') || '').replace(/^.*\//, '') : null, started: cur?.started ?? null, pending: !!this.pending });
    });
  };

  let op2;
  Object.defineProperty(window, '__op2', {
    configurable: true,
    get: () => op2,
    set(v) {
      op2 = v;
      push('op2', {});
      try {
        const ev = v.ctx.events;
        const emit = ev.emit;
        ev.emit = function (type, payload) {
          if (EVENTS.test(type)) push('event', { type, p: small(payload) });
          return emit.call(this, type, payload);
        };
        onCommanderHud(v.ctx.hud?.commander);
      } catch (e) { push('wrap-err', { name: 'op2', e: String(e) }); }
      let camp;
      Object.defineProperty(v, 'campaign', {
        configurable: true,
        get: () => camp,
        set(c) {
          camp = c;
          try { onCampaign(c); } catch (e) { push('wrap-err', { name: 'campaign', e: String(e) }); }
          push('campaign', {});
        },
      });
    },
  });

  // ---- A watch every tenth of a second, for what events can miss ---------------------------------------------------------
  let multi = 0, completeShown = false, pauseShown = false, beatAt = 0, multiLogged = 0;
  setInterval(() => {
    const live = [...recs.values()].filter(r => r.el.getAttribute('src') && !r.el.paused && !r.el.ended && r.el.currentTime > 0 && r.el.volume > 0.02);
    if (live.length > 1) {
      multi++;
      if (multiLogged < 400) {
        multiLogged++;
        push('multi', { clips: live.map(r => `${r.clip}#${r.id} t${r.el.currentTime.toFixed(2)} v${r.el.volume.toFixed(2)}`) });
      }
    }
    const complete = document.querySelector('.scr-complete');
    const shown = !!complete && complete.style.display === '';
    if (shown !== completeShown) { completeShown = shown; push('complete-screen', { shown }); }
    const pause = document.querySelector('.scr-pause');
    const pshown = !!pause && pause.style.display === '';
    if (pshown !== pauseShown) { pauseShown = pshown; push('pause-screen', { shown: pshown }); }
    const now = performance.now();
    if (op2?.stats && now - beatAt > 5000) {
      beatAt = now;
      try {
        const s = op2.stats();
        const r = op2.campaign?.runner;
        push('tick', { fps: s.fps, cpu: s.cpuMs, state: s.state, beat: r?.beat?.id ?? null, radio: r?.onAir?.line.id ?? null, waiting: r ? r.radio.length : null });
      } catch {}
    }
  }, 100);

  /** Where the parked tank in the yard is against the camera: in frame, how far off centre, and whether the wall is in the way. */
  window.__tankView = () => {
    const op = window.__op2;
    const v = (op.ctx.enemies.vehicles?.live ?? []).find(x => x.tag === 'in.parked');
    if (!v) return { tank: 'none' };
    const cam = op.ctx.render.camera;
    cam.updateMatrixWorld();
    const p = v.position.clone();
    p.y += 1.4;
    const eye = p.clone().setFromMatrixPosition(cam.matrixWorld);
    const ndc = p.clone().project(cam);
    const dir = p.clone().sub(eye);
    const dist = dir.length();
    dir.normalize();
    const fwd = p.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = op.ctx.physics.raycast(eye, dir, dist);
    return {
      inFrame: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
      ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)],
      offCentre: Math.round((Math.acos(Math.max(-1, Math.min(1, fwd.dot(dir)))) * 180) / Math.PI),
      dist: Math.round(dist),
      blocked: hit ? hit.distance < dist - 6 : false,
      eye: eye.toArray().map(Math.round),
    };
  };
  window.__watchTank = (ms = 7000) => {
    const end = performance.now() + ms;
    const id = setInterval(() => {
      try { push('tank-view', window.__tankView()); } catch (e) { push('tank-view', { err: String(e) }); }
      if (performance.now() > end) clearInterval(id);
    }, 500);
  };
}

// ---- Node side -------------------------------------------------------------------------------------------------------------

function loadDurations() {
  const paths = [DURATIONS, 'tools/out/mission-durations.txt'].filter(Boolean);
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const map = {};
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const [id, s] = line.trim().split(/\s+/);
      if (id && s) map[id] = Number(s);
    }
    return map;
  }
  return {};
}

/** Lays the log out as clips, overlaps, lines and films. */
function analyse(events, durations) {
  const t0 = events.find(e => e.kind === 'beat')?.t ?? events[0]?.t ?? 0;
  const rel = t => (t === null || t === undefined ? null : +(t - t0).toFixed(2));
  const els = new Map();
  for (const e of events) {
    if (e.el === undefined) continue;
    let c = els.get(e.el);
    if (!c) els.set(e.el, (c = { el: e.el, clip: e.clip, calls: [], segs: [], open: null, endings: [], refused: [], errors: [] }));
    if (e.kind === 'play()') c.calls.push(e.t);
    if (e.kind === 'play-refused') c.refused.push(e.err);
    if (e.kind === 'error') c.errors.push(e.code);
    if (e.kind === 'playing') {
      c.firstPlaying ??= e.t;
      c.open = { start: e.t, ct: e.ct, others: e.others };
      c.dur = e.dur || c.dur;
    }
    if (['ended', 'pause', 'emptied', 'error'].includes(e.kind)) {
      if (c.open) {
        // At the last frame the browser says pause and then ended: that is a clip played through, not one stopped.
        const whole = e.kind === 'ended' || (e.kind === 'pause' && e.dur > 0 && e.ct >= e.dur - 0.05);
        c.segs.push({ ...c.open, end: e.t, how: whole ? 'ended' : e.kind, endCt: e.ct, vol: e.vol });
        c.open = null;
      }
      c.endings.push({ t: e.t, how: e.kind, ct: e.ct });
    }
  }
  const clips = [...els.values()].map(c => {
    if (c.open) c.segs.push({ ...c.open, end: null, how: 'still playing at the end of the run' });
    const heard = c.segs.reduce((s, g) => s + ((g.end ?? g.start) - g.start), 0);
    const file = durations[c.clip] ?? c.dur ?? null;
    const last = c.segs[c.segs.length - 1];
    return {
      el: c.el,
      clip: c.clip,
      called: rel(c.calls[0]),
      started: rel(c.firstPlaying),
      startDelay: c.firstPlaying !== undefined ? +(c.firstPlaying - c.calls[0]).toFixed(3) : null,
      ended: rel(last?.end ?? null),
      how: last?.how ?? (c.refused.length ? `refused ${c.refused.join(',')}` : c.errors.length ? `error ${c.errors.join(',')}` : 'never started'),
      segments: c.segs.length,
      heard: +heard.toFixed(2),
      file,
      lastCt: last?.endCt ?? null,
      complete: last?.how === 'ended',
    };
  });
  const overlaps = [];
  const segs = [...els.values()].flatMap(c => c.segs.map(s => ({ ...s, el: c.el, clip: c.clip })));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.el === b.el) continue;
      const end = Math.min(a.end ?? Infinity, b.end ?? Infinity);
      const start = Math.max(a.start, b.start);
      const over = end - start;
      if (over <= 0.001) continue;
      const first = a.start <= b.start ? a : b;
      const second = first === a ? b : a;
      // A clip cut by a stop fades for 0.1 s; while it does, the next one may already be up.
      const fade = (first.how === 'pause' || first.how === 'emptied') && over <= 0.2;
      overlaps.push({ first: first.clip, second: second.clip, from: rel(start), seconds: +over.toFixed(3), kind: fade ? 'fade tail of a cut clip' : 'OVERLAP', firstEnd: first.how });
    }
  }
  const lines = [];
  const says = events.filter(e => e.kind === 'say');
  for (const s of events.filter(e => e.kind === 'speak')) {
    const ask = [...says].reverse().find(x => x.id === s.id && x.t <= s.t + 0.001);
    const clip = clips.find(c => c.clip === s.id && c.called !== null && c.called >= rel(s.t) - 0.01 && c.called <= rel(s.t) + 6);
    const done = events.find(e => e.kind === 'speak-done' && e.id === s.id && e.t >= s.t);
    const beatAt = t => [...events].reverse().find(e => e.kind === 'beat' && e.t <= t)?.id ?? null;
    lines.push({
      id: s.id,
      asked: rel(ask?.t),
      onAir: rel(s.t),
      waitedInQueue: ask ? +(s.t - ask.t).toFixed(2) : null,
      clipStart: clip?.started ?? null,
      clipEnd: clip?.ended ?? null,
      clipHow: clip?.how ?? 'no clip',
      file: durations[s.id] ?? null,
      heard: clip?.heard ?? null,
      radioFreed: rel(done?.t),
      beatAsked: ask ? beatAt(ask.t) : null,
      beatSpoken: clip?.started !== null && clip?.started !== undefined ? beatAt(clip.started + t0) : beatAt(s.t),
    });
  }
  const notQueued = says.filter(s => s.result === 'not-queued').map(s => ({ id: s.id, at: rel(s.t), beat: s.beat, why: s.wasHeard ? 'already heard' : s.wasQueued ? 'already queued' : '?' }));
  const films = [];
  for (const f of events.filter(e => e.kind === 'film')) {
    const stop = events.find(e => e.kind === 'film-stop' && e.t >= f.t);
    const cuts = events.filter(e => e.kind === 'cut' && e.t >= f.t && (!stop || e.t <= stop.t)).map(e => ({ at: rel(e.t), index: e.index, film: e.film }));
    const sounding = t => clips.filter(c => c.started !== null && c.started <= rel(t) && (c.ended === null || c.ended >= rel(t))).map(c => c.clip);
    const shots = f.shots;
    const last = shots.length - 1;
    const fadeOut = f.fades[last][1];
    const lastCut = events.filter(e => e.kind === 'cut' && e.t >= f.t && e.index === last && (!stop || e.t <= stop.t)).pop();
    const fadeStartWall = lastCut ? lastCut.t + (shots[last] - fadeOut) : null;
    const spoken = clips.filter(c => c.started !== null && c.started >= rel(f.t) - 1 && (!stop || c.started <= rel(stop.t)));
    const lastWord = spoken.reduce((m, c) => Math.max(m, c.ended ?? 0), 0);
    films.push({
      id: f.id,
      start: rel(f.t),
      stop: rel(stop?.t),
      skipped: stop?.skipped ?? null,
      filmClock: stop?.film ?? null,
      wall: stop ? +(stop.t - f.t).toFixed(2) : null,
      planned: shots.reduce((a, b) => a + b, 0),
      cuts: cuts.map(c => ({ ...c, sounding: sounding(c.at + t0) })),
      fadeStart: rel(fadeStartWall),
      lastWordEnds: lastWord || null,
      fadeAfterLastWord: fadeStartWall ? +(rel(fadeStartWall) - lastWord).toFixed(2) : null,
      stopAfterLastWord: stop ? +(rel(stop.t) - lastWord).toFixed(2) : null,
      soundingAtStop: stop ? sounding(stop.t) : null,
    });
  }
  const startDelays = clips.filter(c => c.startDelay !== null).map(c => c.startDelay);
  return {
    t0,
    clips,
    overlaps,
    lines,
    notQueued,
    films,
    multiSamples: events.filter(e => e.kind === 'multi').length,
    startDelay: startDelays.length ? { n: startDelays.length, mean: +(startDelays.reduce((a, b) => a + b, 0) / startDelays.length).toFixed(3), max: Math.max(...startDelays) } : null,
    fps: events.filter(e => e.kind === 'tick').map(e => e.fps),
    droppedLate: events.filter(e => e.kind === 'dropped-late').map(e => ({ ...e, t: rel(e.t) })),
    barks: events.filter(e => e.kind === 'cmd.bark' || e.kind === 'cmd.show' || e.kind === 'cmd.close' || e.kind === 'cmd.hold').map(e => ({ ...e, t: rel(e.t) })),
    errors: events.filter(e => e.kind === 'wrap-err' || e.kind === 'wrap-miss' || e.kind === 'play-refused' || e.kind === 'error'),
  };
}

/** One line per thing worth reading, against the mission's start. */
function timeline(events, t0) {
  const keep = new Set(['beat', 'signal', 'say', 'speak', 'speak-done', 'playing', 'ended', 'pause', 'error', 'dropped-late', 'runner.hush', 'runner.down', 'runner.redeploy', 'runner.win',
    'film', 'cut', 'film-stop', 'film-done', 'finished', 'complete-screen', 'pause-screen', 'cmd.bark', 'cmd.show', 'cmd.hold', 'cmd.close', 'cvoice.stop', 'mvoice.stop', 'mvoice.paused',
    'event', 'curtain', 'multi', 'play-refused', 'call', 'ride', 'ride-done', 'tank-view', 'note', 'kill', 'tick', 'emptied']);
  const out = [];
  for (const e of events) {
    if (!keep.has(e.kind)) continue;
    if (e.kind === 'emptied' && !e.was) continue;
    if (e.kind === 'event' && /vehicle:destroyed/.test(e.type)) continue;
    const { t, kind, ...rest } = e;
    let s;
    switch (kind) {
      case 'playing': s = `PLAYING ${e.clip}#${e.el}${e.ct > 0 ? ` from ${e.ct}` : ''} (file ${e.dur}s)${e.others.length ? ` WITH ${e.others.join(', ')}` : ''}`; break;
      case 'ended': s = `ended   ${e.clip}#${e.el} at ${e.ct}/${e.dur}`; break;
      case 'pause': s = `pause   ${e.clip}#${e.el} at ${e.ct}/${e.dur} vol ${e.vol}`; break;
      case 'emptied': s = `emptied ${e.clip}#${e.el} at ${e.ct}`; break;
      case 'say': s = `say ${e.id}${e.now ? ' NOW' : ''}${e.again ? ' again' : ''}${e.wait ? ' wait' : ''}${e.within !== null ? ` within ${e.within}` : ''} -> ${e.result}${e.result === 'queued' ? ` behind ${e.before.onAir ?? '-'} +${e.before.queue.length}` : ''}${e.result === 'not-queued' ? (e.wasHeard ? ' (heard)' : e.wasQueued ? ' (queued)' : '') : ''}`; break;
      case 'speak': s = `ON AIR  ${e.id} (${e.words} words) "${e.text}"`; break;
      case 'speak-done': s = `radio free after ${e.id}`; break;
      case 'event': s = `event ${e.type} ${JSON.stringify(e.p)}`; break;
      default: s = `${kind} ${JSON.stringify(rest)}`;
    }
    out.push(`${(t - t0).toFixed(2).padStart(8)}  ${s}`);
  }
  return out;
}

export default async function voiceTimeline(page, h) {
  const origin = new URL(page.url()).origin;
  const events = [];
  const notes = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(probe);
  const urls = {
    campaign: '/?contract=campaign&autostart=1',
    ending: '/?contract=campaign&autostart=1&beat=commander',
    direct: '/?contract=campaign&autostart=1&beat=ending',
    pause: '/?contract=campaign&autostart=1',
    skip: '/?contract=campaign&autostart=1',
  };
  const path = process.env.VOICE_URL ?? urls[STEP];
  await page.goto(origin + path, { waitUntil: 'load', timeout: 90000 });

  const drain = async () => {
    const got = await page.evaluate(() => (window.__alog ? window.__alog.splice(0) : [])).catch(() => []);
    events.push(...got);
    return got;
  };
  const note = async (what, data) => {
    await page.evaluate(([w, d]) => window.__apush?.('note', { what: w, ...(d ?? {}) }), [what, data ?? null]).catch(() => {});
    notes.push(what);
  };
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner?.describe() ?? null).catch(() => null);
  /** Polls the log until `test` is true of an event, or of the runner. */
  const until = async (test, seconds, label, onEach, from = 0) => {
    const end = Date.now() + seconds * 1000;
    let seen = from;
    while (Date.now() < end) {
      await drain();
      for (; seen < events.length; seen++) {
        const e = events[seen];
        if (onEach) await onEach(e);
        if (test(e)) return e;
      }
      await h.sleep(200);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const beat = (id, seconds) => events.find(e => e.kind === 'beat' && e.id === id) ?? until(e => e.kind === 'beat' && e.id === id, seconds, `beat ${id}`);
  /** Since the latest beat opened, so a clip from before a restart does not count. */
  const playing = (clip, seconds) => {
    let from = 0;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'beat') { from = i; break; }
    return until(e => e.kind === 'playing' && e.clip === clip, seconds, `${clip} playing`, null, from);
  };
  const press = action => page.evaluate(async a => {
    const { input } = window.__op2.ctx;
    input.simulate(a, true);
    await new Promise(r => setTimeout(r, 120));
    input.simulate(a, false);
  }, action);
  const tp = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => {
    const { player } = window.__op2.ctx;
    player.teleport(player.position.clone().set(x, y, z), yaw);
  }, [x, y, z, yaw]);
  const face = (x, y, z) => page.evaluate(([x, y, z]) => {
    const p = window.__op2.ctx.player;
    const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, [x, y, z]);
  const kill = (...tags) => page.evaluate(names => {
    const { ctx, campaign } = window.__op2;
    const point = ctx.player.position.clone();
    for (const e of [...ctx.enemies.alive]) {
      if (names.length && !names.includes(campaign.host.tagOf.get(e.uid))) continue;
      ctx.enemies.applyDamage(e, { amount: 1e6, type: 'true', point: e.center.clone(), dir: point.clone().set(0, 0, 1), force: 0, source: 'smg' });
    }
    for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) if (!names.length || names.includes(v.tag)) v.take(1e6, null, 'rocket', v.position);
  }, tags);
  const snap = name => Promise.race([h.shot(name), h.sleep(9000)]).catch(() => notes.push(`no shot ${name}`));
  /** Cannot be hurt, until `mortal`. The run rebuilds the player's modifiers, so this keeps saying it. */
  const god = () => page.evaluate(() => {
    window.__god = true;
    setInterval(() => { const p = window.__op2?.ctx?.player; if (p?.modifiers) p.modifiers.invulnerable = window.__god; }, 100);
  });
  const die = () => page.evaluate(async () => {
    window.__god = false;
    const p = window.__op2.ctx.player;
    p.modifiers.invulnerable = false;
    p.maxHealth = p.health = 100;
    p.armor = 0;
    for (let i = 0; i < 40 && p.alive; i++) {
      p.takeDamage({ amount: 1e6, from: p.position, type: 'true', source: 'test' });
      await new Promise(r => setTimeout(r, 150));
    }
    return p.alive;
  });
  const button = text => page.locator('.scr-pause button.mi').filter({ hasText: text }).first();
  const pause = async () => {
    await press('pause');
    await page.waitForFunction(() => window.__op2.game.state === 'paused', null, { timeout: 5000 });
  };
  const resume = async () => {
    await button('Resume').click();
    await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 8000 });
  };
  const gun = on => page.evaluate(on => {
    const { ctx } = window.__op2;
    clearInterval(window.__rideGun);
    if (!on) { ctx.input.simulate('fire', false); return; }
    window.__rideGun = setInterval(() => {
      const s = ctx.progression.callInsManager.seats.seat;
      if (!s) return;
      const eye = s.view.position;
      let best = null, near = 300;
      for (const e of ctx.enemies.alive) { const d = e.center.distanceTo(eye); if (d < near) { near = d; best = e; } }
      if (!best) return;
      const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
      s.yaw = Math.atan2(-dx, -dz);
      s.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }, 120);
    ctx.input.simulate('fire', true);
  }, on);
  const voiceState = () => page.evaluate(() => {
    const c = window.__op2.campaign;
    const v = c.ui.voice;
    const cv = window.__op2.ctx.hud.commander?.voice;
    const el = v.current?.audio;
    return {
      t: performance.now() / 1000,
      game: window.__op2.game.state,
      mission: el ? { src: (el.getAttribute('src') || '').replace(/^.*\//, ''), paused: el.paused, ct: +el.currentTime.toFixed(2) } : null,
      missionSpeaking: v.speaking,
      cmd: cv?.current ? { src: (cv.current.audio.getAttribute('src') || '').replace(/^.*\//, ''), paused: cv.current.audio.paused } : null,
      talking: c.talking,
      radio: c.runner.describe().radio,
      waiting: c.runner.describe().waiting,
      film: c.host.film.playing ? +c.host.film.total.toFixed(2) : null,
      box: document.querySelector('.ms-radio.on')?.textContent?.slice(0, 50) ?? null,
    };
  });
  const probes = [];

  const steps = {
    async campaign() {
      await god();
      await beat('briefing', 120);
      await until(e => e.kind === 'film-done' && e.id === 'briefing', 120, 'briefing film to end');
      await beat('insertion', 15);
      await h.sleep(3000);
      await gun(true);
      let armourShot = false, missileShot = false;
      await until(e => e.kind === 'beat' && e.id === 'lockout', 220, 'lockout', async e => {
        if (!armourShot && e.kind === 'playing' && e.clip === 'mission.radio.in.armour') {
          armourShot = true;
          await page.evaluate(() => window.__watchTank(13000));
          await snap('armour');
        }
        if (!missileShot && e.kind === 'signal' && e.name === 'ride:fly8') {
          missileShot = true;
          await snap('missile');
        }
      });
      await gun(false);
      const landed = Date.now();
      await h.sleep(3500);
      await note('out of the pit');
      await tp(-20, 0, 66, 0);
      await h.sleep(2500);
      await kill('lz.rim');
      // A player who climbs out and runs the lane gets to the road about a quarter of a minute after the crash.
      while (Date.now() - landed < 16000) await h.sleep(250);
      await note('at the gate');
      await tp(0, 0, 40, 0);
      await face(0, 3, 12);
      await h.sleep(400);
      await tp(0, 0, 30, 0);
      await beat('softskins', 60);
      await playing('mission.cmd.soft.east', 15);
      await h.sleep(1600);
      await note('dying in the middle of soft.east');
      probes.push({ beforeDeath: await voiceState() });
      const alive = await die();
      probes.push({ died: !alive, after: await voiceState() });
      await until(e => e.kind === 'runner.redeploy', 25, 'redeploy');
      await h.sleep(300);
      probes.push({ redeployed: await voiceState() });
      await h.sleep(15000);
      probes.push({ later: await voiceState(), d: await read() });
    },
    async ending() {
      await god();
      await beat('commander', 120);
      await tp(0, 10, -63, 0);
      await h.sleep(3000);
      await page.evaluate(async () => {
        const { ctx } = window.__op2;
        const b = ctx.enemies.outpost.commander.person.body;
        for (let i = 0; i < 120 && b.health / b.maxHealth > 0.56; i++) {
          ctx.enemies.applyDamage(b, { amount: 120, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' });
          await new Promise(r => setTimeout(r, 30));
        }
      });
      await page.waitForFunction(() => window.__op2.campaign.runner.describe().doors.warRoomStairs === 1, null, { timeout: 15000 }).catch(() => notes.push('stairs never opened'));
      await h.sleep(3000);
      await tp(-14, 14, -62, Math.PI);
      await h.sleep(1500);
      await face(0, 15, -70);
      await page.waitForFunction(() => window.__op2.ctx.enemies.outpost.commander.mortars.stage !== 'idle', null, { timeout: 24000 }).catch(() => notes.push('no mortars'));
      await h.sleep(4000);
      await note('killing him');
      await page.evaluate(async () => {
        const { ctx } = window.__op2;
        const b = ctx.enemies.outpost.commander.person.body;
        for (let i = 0; i < 200 && b.alive; i++) {
          ctx.enemies.applyDamage(b, { amount: 1e6, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' });
          await new Promise(r => setTimeout(r, 30));
        }
      });
      await beat('ending', 20);
      await h.sleep(2500);
      await snap('last-words');
      await until(e => e.kind === 'film' && e.id === 'ending', 40, 'ending film');
      await h.sleep(12000);
      await snap('film');
      await until(e => e.kind === 'complete-screen' && e.shown, 80, 'complete screen');
      await h.sleep(1500);
      await snap('complete');
      probes.push({ atComplete: await voiceState(), result: await page.evaluate(() => window.__op2.campaign.result) });
      await h.sleep(3000);
    },
    /** Straight into the ending, with no screenshot to stall the film's clock: the film against its lines, and the handoff. */
    async direct() {
      await god();
      await beat('ending', 120);
      await until(e => e.kind === 'film' && e.id === 'ending', 60, 'ending film');
      await until(e => e.kind === 'complete-screen' && e.shown, 80, 'complete screen');
      await h.sleep(1500);
      probes.push({ atComplete: await voiceState(), result: await page.evaluate(() => window.__op2.campaign.result) });
    },
    async pause() {
      await god();
      await beat('briefing', 120);
      const first = await playing('mission.council.brief.line', 20);
      await h.sleep(2500);
      probes.push({ beforePause: await voiceState() });
      await note('pause');
      await pause();
      await h.sleep(300);
      probes.push({ paused: await voiceState() });
      await h.sleep(3000);
      probes.push({ pausedLater: await voiceState() });
      await snap('paused');
      await note('resume');
      await resume();
      await h.sleep(500);
      probes.push({ resumed: await voiceState() });
      await playing('mission.council.brief.breach', 20);
      await h.sleep(3000);
      await note('skip');
      probes.push({ beforeSkip: await voiceState() });
      await press('interact');
      await h.sleep(250);
      probes.push({ skipped: await voiceState() });
      await beat('insertion', 10);
      await playing('mission.radio.in.wire', 15);
      await h.sleep(2000);
      probes.push({ wire: await voiceState() });
      await note('pause in the seat');
      await pause();
      await h.sleep(2000);
      probes.push({ seatPaused: await voiceState() });
      await resume();
      await h.sleep(800);
      probes.push({ seatResumed: await voiceState() });
      await until(e => e.kind === 'ended' && e.clip === 'mission.radio.in.wire', 15, 'in.wire to end');
      // Restart from the checkpoint while the Commander's hello is on, if it comes in time.
      await playing('mission.cmd.in.hello', 15).catch(() => notes.push('no in.hello in time'));
      await h.sleep(2000);
      await note('restart from checkpoint');
      await pause();
      await button('Restart from checkpoint').click();
      await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 8000 });
      await until(e => e.kind === 'runner.redeploy', 15, 'redeploy');
      await h.sleep(12000);
      probes.push({ afterRestart: await voiceState(), d: await read() });
    },
    async skip() {
      await god();
      await until(e => e.kind === 'film' && e.id === 'briefing', 120, 'briefing film');
      const film = events.find(e => e.kind === 'film');
      // The film ignores a press in its first half second; a press soon after it is the earliest skip there is.
      await page.waitForFunction(() => window.__op2.campaign.host.film.total > 0.6, null, { timeout: 10000, polling: 30 });
      await note('skip');
      probes.push({ beforeSkip: await voiceState() });
      await press('interact');
      await h.sleep(250);
      probes.push({ skipped: await voiceState(), filmStarted: film.t });
      await beat('insertion', 10);
      await h.sleep(9000);
      probes.push({ later: await voiceState(), d: await read() });
    },
  };

  try {
    await steps[STEP]();
  } catch (e) {
    errors.push(String(e));
  }
  await drain();
  const durations = loadDurations();
  const analysis = analyse(events, durations);
  const lines = timeline(events, analysis.t0);
  const out = `tools/out/voice-${STEP}.json`;
  writeFileSync(out, JSON.stringify({ step: STEP, path, notes, errors, probes, analysis, timeline: lines, events }, null, 1));
  writeFileSync(`tools/out/voice-${STEP}.txt`, lines.join('\n') + '\n');
  return { step: STEP, out, errors, notes, overlaps: analysis.overlaps.filter(o => o.kind === 'OVERLAP').length, multi: analysis.multiSamples, clips: analysis.clips.length };
}
