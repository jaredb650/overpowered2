// The Crucible rules screen, a custom-rules run, a standard run and the dev panel, in real Chrome, read back. RULES_STEP picks
// the stretch, comma separated, run in order in one browser (so localStorage carries from one to the next). Bot only.
//
//   RULES_STEP=screen node tools/shot.mjs --url "/" --script tools/scripts/crucible-rules-live.mjs --out tools/out/crules/cr.png --wait 500 --dpr 2 --w 1440 --h 900 --timeout 240
//   RULES_STEP=custom,standard ...   the custom run, then Defaults and a standard run
//   RULES_STEP=dev ...               the panel on /, Endless Humans, the Campaign, the Test Range, and ?dev=0
const STEP = process.env.RULES_STEP ?? 'screen';
const KEY = 'op2.crucible.rules.v1';
const HIGH = 'op2_highscore';
/** What the custom step sets through the screen, for a standard step run on its own. */
const SEED = { juggernaut: { first: 2, every: 2 }, titan: { on: false }, types: { husk: { on: false }, skitter: { from: 1 } } };

export default async function crucibleRulesLive(page, h) {
  const log = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const shot = h.shot;
  h.shot = name => Promise.race([shot(name), h.sleep(9000)]).catch(() => log.push({ noShot: name }));
  const origin = new URL(page.url()).origin;

  const screenName = () => page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name ?? null);
  const waitScreen = name => page.waitForFunction(n => window.__op2?.ctx?.hud?.screens?.name === n, name, { timeout: 10000 });
  const toMenu = async () => {
    await page.waitForFunction(() => document.querySelector('.scr-splash')?.style.display === '', null, { timeout: 90000 });
    await h.sleep(600);
    await page.mouse.click(720, 450);
    await waitScreen('menu');
    await h.sleep(900);
  };
  const key = async (k, n = 1) => {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(k);
      await h.sleep(110);
    }
  };
  const focusText = () => page.evaluate(() => {
    const scr = [...document.querySelectorAll('.scr')].find(s => s.style.display === '');
    const f = scr?.querySelector('.focus');
    return f ? (f.querySelector('.row-k')?.textContent ?? f.textContent).trim() : null;
  });
  const menuState = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.mm-brief > .mi')].find(e => /rules/i.test(e.textContent));
    return {
      tabs: [...document.querySelectorAll('.mm-tab')].map(t => `${t.textContent}${t.classList.contains('on') ? ' [on]' : ''}${t.classList.contains('focus') ? ' [focus]' : ''}`),
      focus: document.querySelector('.scr-menu .focus')?.textContent ?? null,
      rulesButton: b ? (getComputedStyle(b).display !== 'none' ? 'shown' : 'hidden') : 'missing',
      customNote: document.querySelector('.nt-rules')?.textContent ?? null,
      high: document.querySelector('.nt-high')?.textContent ?? null,
    };
  });
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.scr-rules .row')].map(r => {
    const v = r.querySelector('.st-val') ?? r.querySelector('.row-v');
    const f = ['focus', 'off', 'changed'].filter(c => r.classList.contains(c));
    return `${r.querySelector('.row-k')?.textContent}=${v?.textContent}${f.length ? ` [${f.join(',')}]` : ''}`;
  }));
  const rowOf = label => page.locator('.scr-rules .row').filter({ has: page.getByText(label, { exact: true }) });
  const val = async label => (await rowOf(label).locator('.st-val, .row-v').first().textContent())?.trim();
  const rowFlags = label => rowOf(label).evaluate(r => ({ off: r.classList.contains('off'), changed: r.classList.contains('changed'), focus: r.classList.contains('focus') }));
  const side = () => page.evaluate(() => ({
    state: document.querySelector('.rl-state')?.innerText.replace(/\n/g, ' | '),
    plan: document.querySelector('.rl-plan')?.innerText.replace(/\n/g, ' | '),
    note: document.querySelector('.scr-rules .set-note')?.textContent ?? '',
    warn: (() => { const w = document.querySelector('.rl-warn'); return w && getComputedStyle(w).display !== 'none' ? w.textContent : null; })(),
  }));
  const stored = () => page.evaluate(k => localStorage.getItem(k), KEY);
  const high = () => page.evaluate(k => localStorage.getItem(k), HIGH);
  /** Down until `label` has the focus. */
  const focusOn = async label => {
    for (let i = 0; i < 34; i++) {
      if ((await focusText()) === label) return true;
      await key('ArrowDown');
    }
    return false;
  };
  const sideButton = text => page.locator('.scr-rules .sh-side .mi').filter({ hasText: text });
  const menuButtonNamed = text => page.locator('.scr-menu .mm-list .mi').filter({ has: page.getByText(text, { exact: true }) });

  /** Everything off the screen, cut, or on top of something else. */
  const layout = sel => page.evaluate(sel => {
    const root = document.querySelector(sel);
    const vw = innerWidth;
    const vh = innerHeight;
    const name = e => `${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : e.tagName}${e.textContent ? ` "${e.textContent.trim().slice(0, 28)}"` : ''}`;
    const box = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round).join(','); };
    const visible = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const all = [...root.querySelectorAll('*')].filter(visible);
    const offscreen = all.filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.top < -0.5; }).map(e => `${name(e)} [${box(e)}]`);
    const clipped = all.filter(e => e.children.length === 0 && e.clientWidth > 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2))
      .map(e => `${name(e)} content ${e.scrollWidth}x${e.scrollHeight} box ${e.clientWidth}x${e.clientHeight}`);
    const blocks = [...root.querySelectorAll('.row, .gd-h, .rl-col-note, .sh-title, .rl-sub, .rl-state, .rl-plan, .rl-hint, .rl-warn, .set-note, .mi, .nt, .mm-tabs, .mm-list, .mm-sub')].filter(visible);
    const overlaps = [];
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i], B = blocks[j];
      if (A.contains(B) || B.contains(A)) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) overlaps.push(`${name(A)} [${box(A)}] x ${name(B)} [${box(B)}]`);
    }
    // In each row, the label's text against its control's first visible part.
    const rowClash = [];
    let tightest = Infinity;
    for (const r of root.querySelectorAll('.row')) {
      const k = r.querySelector('.row-k');
      const c = r.querySelector('.stepper > *') ?? r.querySelector('.sl-track');
      if (!k || !c) continue;
      const range = document.createRange();
      range.selectNodeContents(k);
      const gap = c.getBoundingClientRect().left - range.getBoundingClientRect().right;
      tightest = Math.min(tightest, gap);
      if (gap < 4) rowClash.push(`${k.textContent}: ${Math.round(gap)}px from label to control`);
    }
    const body = root.querySelector('.sh-body');
    const cols = [...root.querySelectorAll('.rl-col')].map(c => { const r = c.getBoundingClientRect(); return `${Math.round(r.top)}-${Math.round(r.bottom)} (${Math.round(r.height)}px)`; });
    return {
      vw, vh, rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      pageScroll: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
      body: body ? { scrollH: body.scrollHeight, clientH: body.clientHeight, scrollTop: body.scrollTop, overflowY: getComputedStyle(body).overflowY } : null,
      cols, tightestLabelGap: Number.isFinite(tightest) ? Math.round(tightest) : null,
      offscreen: offscreen.slice(0, 12), clipped: clipped.slice(0, 12), overlaps: overlaps.slice(0, 12), rowClash,
    };
  }, sel);

  /** The same parts on the settings sheet and the rules sheet, so a mismatch in the look shows as data. */
  const looks = () => page.evaluate(() => {
    const pick = (sel, props) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); return props.map(p => cs[p]).join(' / '); };
    const out = {};
    for (const part of ['.sh-title', '.sh-side', '.gd-panel', '.gd-h', '.row', '.row-k', '.st-val', '.sh-side .mi', '.set-note']) {
      out[part] = {
        settings: pick(`.scr-settings ${part}`, ['fontFamily', 'fontSize', 'color', 'height', 'backgroundColor']),
        rules: pick(`.scr-rules ${part}`, ['fontFamily', 'fontSize', 'color', 'height', 'backgroundColor']),
      };
    }
    return out;
  });

  // --- In a run ------------------------------------------------------------------------------------------------------

  const record = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    if (window.__rec) return;
    const rec = window.__rec = { spawned: {}, perWave: {}, starts: [], clears: [], feed: [], reactor: [] };
    ctx.events.on('enemy:spawned', e => {
      const w = ctx.waves.wave;
      rec.spawned[e.enemy.id] = (rec.spawned[e.enemy.id] ?? 0) + 1;
      const pw = rec.perWave[w] ??= {};
      pw[e.enemy.id] = (pw[e.enemy.id] ?? 0) + 1;
    });
    ctx.events.on('wave:start', e => rec.starts.push({ ...e }));
    ctx.events.on('wave:clear', e => rec.clears.push({ ...e }));
    const feed = ctx.hud.feed.bind(ctx.hud);
    ctx.hud.feed = (t, c) => { rec.feed.push(`${ctx.waves.wave}: ${t}`); return feed(t, c); };
    const objs = ctx.world.objects;
    const reactor = objs.setReactorState.bind(objs);
    objs.setReactorState = s => { rec.reactor.push(`${ctx.waves.wave}: ${s}`); return reactor(s); };
    setInterval(() => { const p = ctx.player; if (p?.modifiers) p.modifiers.invulnerable = true; }, 100);
  });
  const rec = () => page.evaluate(() => window.__rec);
  const hudLine = () => page.evaluate(() => ({
    high: document.querySelector('.tl-high')?.textContent ?? null,
    band: `${document.querySelector('.band-t')?.textContent ?? ''} / ${document.querySelector('.band-s')?.textContent ?? ''}`,
    score: window.__op2.ctx.progression.score,
    record: window.__op2.ctx.progression.highScore,
  }));
  const describeSquad = s => {
    const lead = s[0];
    const n = s.filter(x => x === lead).length;
    const rest = s.filter(x => x !== lead);
    return `${lead}x${n}${rest.length ? `+${rest.join(',')}` : ''}`;
  };
  const snap = async () => {
    const d = await page.evaluate(() => {
      const w = window.__op2.ctx.waves;
      return { wave: w.wave, phase: w.phase, bosses: [...w.bossIds], squads: w.queue.map(s => [...s]), rules: { juggernaut: w.rules.juggernaut, titan: w.rules.titan, husk: w.rules.types.husk, skitter: w.rules.types.skitter } };
    });
    return { ...d, types: [...new Set(d.squads.flat())], squads: d.squads.map(describeSquad) };
  };
  const shootAll = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const p = ctx.player.position.clone();
    for (const e of [...ctx.enemies.alive]) {
      ctx.enemies.applyDamage(e, { amount: 1e6, type: 'true', point: e.center.clone(), dir: p.clone().set(0, 0, 1), force: 0, source: 'smg' });
    }
    return ctx.enemies.alive.length;
  });
  const clearField = async () => {
    await page.evaluate(() => window.__op2.ctx.enemies.killAll('lab'));
    for (let i = 0; i < 40; i++) {
      const busy = await page.evaluate(() => window.__op2.ctx.enemies.alive.length > 0 || window.__op2.ctx.enemies.bossDying);
      if (!busy) return;
      await page.evaluate(() => window.__op2.ctx.enemies.killAll('lab'));
      await h.sleep(250);
    }
  };
  const bossesAlive = () => page.evaluate(() => window.__op2.ctx.enemies.alive.filter(e => e.isBoss).map(e => e.id));
  /** Plays wave 1 out with scoring kills until it clears. */
  const playOut = async wave => {
    for (let t = 0; t < 120; t++) {
      const r = await rec();
      if (r.clears.some(c => c.wave === wave)) return true;
      await shootAll();
      await h.sleep(700);
    }
    return false;
  };
  /** Clears the field, jumps, and reads what the wave brought and who landed. */
  const jump = async (wave, shotName) => {
    await clearField();
    const n0 = (await rec()).starts.length;
    await page.evaluate(w => window.__op2.ctx.waves.jumpTo(w), wave);
    await page.waitForFunction(([n, w]) => window.__rec.starts.length > n && window.__rec.starts.at(-1).wave === w, [n0, wave], { timeout: 10000 });
    const s = await snap();
    await h.sleep(300);
    const start = (await rec()).starts.at(-1);
    const hud = await hudLine();
    let landed = [];
    if (s.bosses.length) {
      for (let t = 0; t < 60 && landed.length < s.bosses.length; t++) {
        await h.sleep(250);
        landed = await bossesAlive();
      }
    } else {
      await h.sleep(2500);
      landed = await bossesAlive();
    }
    if (shotName) await h.shot(shotName);
    const r = await rec();
    const entry = {
      wave, start, planned: s.bosses, landed, phase: s.phase, squads: s.squads.slice(0, 6).join(' '), squadCount: s.squads.length,
      types: s.types,
      band: hud.band, record: hud.high, reactor: r.reactor.filter(x => x.startsWith(`${wave}:`)), feed: r.feed.filter(x => x.startsWith(`${wave}:`) && /NEW THREAT/.test(x)),
    };
    log.push(entry);
    return entry;
  };

  const startCrucibleFromMenu = async () => {
    await page.locator('.mm-tab').filter({ hasText: 'The Crucible' }).click();
    await h.sleep(400);
    await record();
    await menuButtonNamed('Play').click();
    await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 15000 });
    await page.waitForFunction(() => window.__rec.starts.length > 0, null, { timeout: 20000 });
    await h.sleep(300);
  };

  const steps = {
    /** The menu, the button, the screen, every control on keys and mouse, Defaults and Back. */
    async screen() {
      await toMenu();
      await h.shot('menu-0');
      log.push({ menuAtStart: await menuState(), layout: await layout('.scr-menu') });
      // Right on Play turns the tabs.
      await key('ArrowRight');
      await h.sleep(300);
      const crucibleMenu = await menuState();
      await h.shot('menu-crucible');
      log.push({ afterRight: crucibleMenu, layout: await layout('.scr-menu') });
      // Up from Play wraps to the rules button.
      await key('ArrowUp');
      log.push({ upFromPlay: await menuState() });
      await key('ArrowDown');
      log.push({ downBackTo: await focusText() });
      // Down from Play through the list: what each press focuses, and which tab that leaves selected.
      const walk = [];
      for (let i = 0; i < 7; i++) {
        await key('ArrowDown');
        const m = await menuState();
        walk.push(`${m.focus} | on: ${m.tabs.find(t => t.includes('[on]'))} | rules ${m.rulesButton}`);
      }
      log.push({ downWalk: walk });
      // Back to Play, the Crucible tab by Right, then Up to the button.
      for (let i = 0; i < 10 && (await focusText()) !== 'Play'; i++) await key('ArrowUp');
      for (let i = 0; i < 4 && !(await menuState()).tabs.some(t => t.startsWith('The Crucible') && t.includes('[on]')); i++) await key('ArrowRight');
      await key('ArrowUp');
      const onButton = await focusText();
      await key('Enter');
      await h.sleep(500);
      log.push({ enterOn: onButton, screen: await screenName() });
      await h.shot('rules-0');
      log.push({ rulesAtOpen: await rows(), side: await side(), stored: await stored(), focus: await focusText(), layout: await layout('.scr-rules'), looks: await looks() });

      // --- Keys -------------------------------------------------------------------------------------------------------
      const k = {};
      await key('ArrowRight');
      k.jugFromRight = { v: await val('Juggernaut from'), f: await rowFlags('Juggernaut from'), stored: await stored(), side: await side() };
      await key('ArrowLeft');
      k.jugFromLeft = { v: await val('Juggernaut from'), f: await rowFlags('Juggernaut from'), stored: await stored() };
      await key('Enter');
      k.jugOff = { v: await val('Juggernaut from'), every: await rowFlags('Juggernaut every'), count: await rowFlags('Juggernaut count'), plan: (await side()).plan, stored: await stored() };
      await key('Space');
      k.jugOnBySpace = { v: await val('Juggernaut from'), stored: await stored() };
      await key('ArrowDown');
      await key('ArrowRight');
      k.everyRight = await val('Juggernaut every');
      await key('ArrowLeft', 12);
      k.everyLeft12 = { v: await val('Juggernaut every'), plan: (await side()).plan };
      await key('ArrowRight', 10);
      k.everyBack = { v: await val('Juggernaut every'), stored: await stored() };
      await key('ArrowDown');
      await key('ArrowRight', 7);
      k.countRight7 = { v: await val('Juggernaut count'), plan: (await side()).plan };
      await key('ArrowLeft', 7);
      k.countBack = await val('Juggernaut count');
      await focusOn('Start at wave');
      await key('ArrowRight');
      k.startRight = { v: await val('Start at wave'), side: await side() };
      await h.shot('rules-warn');
      k.layoutWithWarn = await layout('.scr-rules');
      await key('ArrowLeft');
      k.startBack = { v: await val('Start at wave'), warn: (await side()).warn };
      await key('ArrowDown');
      await key('ArrowRight');
      k.sizeRight = { v: await val('Wave size'), stored: await stored() };
      await key('ArrowLeft', 9);
      k.sizeLeft9 = await val('Wave size');
      await key('ArrowRight', 3);
      k.sizeBack = { v: await val('Wave size'), stored: await stored() };
      // The whole list on Down, and the wrap.
      await focusOn('Juggernaut from');
      const order = [];
      for (let i = 0; i < 31; i++) {
        const f = await page.evaluate(() => {
          const e = document.querySelector('.scr-rules .focus');
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return `${(e.querySelector('.row-k')?.textContent ?? e.textContent).trim()}${r.bottom > innerHeight || r.top < 0 ? ' (OFF SCREEN)' : ''}`;
        });
        order.push(f);
        if (i < 30) await key('ArrowDown');
      }
      k.downOrder = order;
      await key('ArrowUp');
      k.upFromFirst = await focusText();
      await key('ArrowDown');
      // A type off and on, its floor, and the refusal.
      await focusOn('Husk');
      await key('ArrowLeft');
      k.huskLeftAtFloor = { v: await val('Husk'), note: (await side()).note };
      await key('Enter');
      k.huskOff = { v: await val('Husk'), f: await rowFlags('Husk'), stored: await stored() };
      await key('ArrowDown');
      await key('Enter');
      k.trooperOffRefused = { trooper: await val('Trooper'), note: (await side()).note, stored: await stored() };
      await h.shot('rules-refused');
      await key('ArrowUp');
      await key('ArrowRight');
      k.huskBackOnByRight = { v: await val('Husk'), stored: await stored(), note: (await side()).note };
      log.push({ keys: k });

      // --- Mouse ------------------------------------------------------------------------------------------------------
      const m = {};
      const te = rowOf('Titan every');
      const box = await te.boundingBox();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width * 0.32, box.y + box.height / 2);
      await h.sleep(150);
      m.hoverFocus = await focusText();
      await te.locator('.st-arrow').nth(1).click();
      m.titanEveryNext = await val('Titan every');
      await te.locator('.st-arrow').nth(0).click();
      await te.locator('.st-arrow').nth(0).click();
      m.titanEveryBack2 = await val('Titan every');
      await te.locator('.st-arrow').nth(1).click();
      m.titanEveryRestored = { v: await val('Titan every'), stored: await stored() };
      await rowOf('Bomber').locator('.row-k').click();
      m.bomberClick = { v: await val('Bomber'), f: await rowFlags('Bomber') };
      await rowOf('Bomber').locator('.row-k').click();
      m.bomberClickAgain = await val('Bomber');
      await rowOf('Juggernaut count').locator('.row-k').click();
      m.countRowClick = await val('Juggernaut count');
      const track = rowOf('Enemy health').locator('.sl-track');
      const tb = await track.boundingBox();
      await page.mouse.click(tb.x + tb.width - 1, tb.y + tb.height / 2);
      m.healthTrackEnd = await val('Enemy health');
      await page.mouse.move(tb.x + tb.width * 0.5, tb.y + tb.height / 2);
      await page.mouse.down();
      await page.mouse.move(tb.x + tb.width * 0.2, tb.y + tb.height / 2, { steps: 6 });
      await page.mouse.up();
      m.healthDragTo20pc = { v: await val('Enemy health'), stored: await stored() };
      // A custom set for the look: a boss moved, a type off, a slider up.
      for (let i = 0; i < 3; i++) await rowOf('Juggernaut from').locator('.st-arrow').nth(0).click();
      await rowOf('Titan from').locator('.row-k').click();
      await rowOf('Warden').locator('.row-k').click();
      for (let i = 0; i < 2; i++) await rowOf('Wave size').locator('.sl-track').click({ position: { x: tb.width * 0.62, y: tb.height / 2 } });
      m.custom = { rows: await rows(), side: await side(), stored: await stored() };
      await page.mouse.move(5, 5);
      await h.shot('rules-custom');
      m.layoutCustom = await layout('.scr-rules');
      await sideButton('Defaults').click();
      await h.sleep(200);
      m.afterDefaults = { changedRows: (await rows()).filter(r => r.includes('changed') || r.includes('off')), side: await side(), stored: await stored() };
      await h.shot('rules-defaults');
      log.push({ mouse: m });

      // --- Back -------------------------------------------------------------------------------------------------------
      const b = {};
      await sideButton('Back').click();
      await h.sleep(300);
      b.clickBack = { screen: await screenName(), focus: await focusText() };
      await key('Enter');
      await h.sleep(300);
      b.enterAgain = await screenName();
      await key('Escape');
      await h.sleep(300);
      b.esc = { screen: await screenName(), focus: await focusText() };
      await key('Enter');
      await h.sleep(300);
      await key('Backspace');
      await h.sleep(300);
      b.backspace = { screen: await screenName(), focus: await focusText() };
      // Defaults by keyboard: change one rule, Down to Defaults, Enter.
      await key('Enter');
      await h.sleep(300);
      await key('ArrowRight');
      const changed = await stored();
      await focusOn('Defaults');
      await key('Enter');
      b.defaultsByKey = { before: changed, after: await stored(), note: (await side()).note };
      await focusOn('Back');
      await key('Enter');
      await h.sleep(300);
      b.backByKey = { screen: await screenName(), focus: await focusText(), menu: await menuState() };
      log.push({ back: b });

      // The settings sheet, for the look beside it.
      await menuButtonNamed('Settings').click();
      await h.sleep(500);
      await h.shot('settings');
      log.push({ settingsScreen: await screenName() });
    },

    /** Bosses every 2 from wave 2, no Titans, no Husks, Skitters from wave 1, set on the screen, then a run from the menu. */
    async custom() {
      // A small record already stored, so a run that could write one would.
      await page.evaluate(k => localStorage.setItem(k, '50'), HIGH);
      await page.reload({ waitUntil: 'load' });
      await toMenu();
      await page.locator('.mm-tab').filter({ hasText: 'The Crucible' }).click();
      await h.sleep(300);
      await page.locator('.mm-brief > .mi').filter({ hasText: 'Crucible rules' }).click();
      await waitScreen('rules');
      await h.sleep(300);
      for (let i = 0; i < 3; i++) await rowOf('Juggernaut from').locator('.st-arrow').nth(0).click();
      await rowOf('Juggernaut every').locator('.row-k').hover();
      await key('ArrowLeft', 8);
      await rowOf('Titan from').locator('.row-k').click();
      await rowOf('Husk').locator('.row-k').click();
      await rowOf('Skitter').locator('.row-k').hover();
      await key('ArrowLeft', 7);
      await page.mouse.move(5, 5);
      const set = { rows: await rows(), side: await side(), stored: await stored() };
      await h.shot('custom-rules');
      await sideButton('Back').click();
      await waitScreen('menu');
      await h.sleep(300);
      const menu = await menuState();
      await h.shot('custom-menu');
      log.push({ set, menu, highBefore: await high() });

      await startCrucibleFromMenu();
      const w1 = await snap();
      const r1 = await rec();
      const hud1 = await hudLine();
      await h.shot('custom-wave1');
      log.push({ wave1: { start: r1.starts[0], rules: w1.rules, squads: w1.squads, bosses: w1.bosses, feed: r1.feed, hud: hud1 } });
      const cleared = await playOut(1);
      await h.sleep(500);
      const after1 = await rec();
      log.push({ wave1Cleared: cleared, spawnedWave1: after1.perWave[1], hud: await hudLine(), highAfterClear: await high(), highFeed: after1.feed.filter(f => /HIGH/.test(f)) });

      for (const w of [2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 20]) await jump(w, w === 2 ? 'custom-boss2' : w === 16 ? 'custom-boss16' : null);
      await h.sleep(2500);
      const end = await rec();
      log.push({ spawnedAll: end.spawned, huskEver: end.spawned.husk ?? 0, titanEver: end.spawned.titan ?? 0, perWave: end.perWave, hudEnd: await hudLine(), highEnd: await high(), highFeed: end.feed.filter(f => /HIGH/.test(f)) });
      // Leaving the page is the record's last chance to be written.
      await page.goto(`${origin}/?`, { waitUntil: 'load' });
      log.push({ highAfterLeaving: await high(), rulesStillStored: await stored() });
    },

    /** Defaults from a custom set, then a standard run: ranked again, bosses on 5, 10, 15. */
    async standard() {
      if ((await stored()) === null) {
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(SEED)]);
        await page.evaluate(k => localStorage.getItem(k) ?? localStorage.setItem(k, '50'), HIGH);
        await page.reload({ waitUntil: 'load' });
      }
      await toMenu();
      await page.locator('.mm-tab').filter({ hasText: 'The Crucible' }).click();
      await h.sleep(300);
      const menuBefore = await menuState();
      await page.locator('.mm-brief > .mi').filter({ hasText: 'Crucible rules' }).click();
      await waitScreen('rules');
      await h.sleep(300);
      const before = { side: await side(), stored: await stored() };
      await sideButton('Defaults').click();
      await h.sleep(200);
      const after = { side: await side(), stored: await stored(), changed: (await rows()).filter(r => /changed|off/.test(r)) };
      await sideButton('Back').click();
      await waitScreen('menu');
      await h.sleep(300);
      log.push({ menuBefore, before, after, menuAfter: await menuState(), highBefore: await high() });

      await startCrucibleFromMenu();
      const w1 = await snap();
      const r1 = await rec();
      log.push({ wave1: { start: r1.starts[0], squads: w1.squads, bosses: w1.bosses, feed: r1.feed, hud: await hudLine() } });
      // STANDARD_WAVES=15,16,25 skips the wave 1 play-out and jumps only to those.
      const only = process.env.STANDARD_WAVES?.split(',').map(Number);
      if (!only) {
        const cleared = await playOut(1);
        await h.sleep(500);
        const after1 = await rec();
        log.push({ wave1Cleared: cleared, hud: await hudLine(), highAfterClear: await high(), highFeed: after1.feed.filter(f => /HIGH/.test(f)) });
        await h.shot('standard-wave1');
      }
      for (const w of only ?? [2, 4, 5, 6, 9, 10, 11, 14, 15, 16]) await jump(w, w === 10 ? 'standard-titan10' : w === 15 ? 'standard-jug15' : null);
      const end = await rec();
      log.push({ spawnedAll: end.spawned, hudEnd: await hudLine(), highEnd: await high() });
    },

    /** The panel on each page, F1 and backquote, and gone with ?dev=0. */
    async dev() {
      const pages = ['/', '/?contract=outpost', '/?contract=campaign&autostart=1', '/?map=range', '/?dev=0', '/?contract=outpost&dev=0', '/?map=range&dev=0'];
      for (const url of pages) {
        const t0 = Date.now();
        await page.goto(`${origin}${url}`, { waitUntil: 'load' });
        try {
          await page.waitForFunction(() => ['menu', 'playing'].includes(window.__op2?.game?.state), null, { timeout: 90000 });
        } catch {
          log.push({ url, error: 'never reached menu or play', state: await page.evaluate(() => window.__op2?.game?.state ?? null) });
          continue;
        }
        await h.sleep(1500);
        const read = () => page.evaluate(() => {
          const p = document.querySelector('.lab-panel');
          const lab = window.__lab;
          return {
            panel: p ? (p.classList.contains('open') ? 'open' : 'closed') : 'absent',
            title: p?.querySelector('h1')?.textContent ?? null,
            god: lab?.settings?.god ?? null, arsenal: lab?.settings?.arsenal ?? null,
            hint: (() => { const e = document.querySelector('.lab-hint'); return e ? e.style.display || 'shown' : 'absent'; })(),
            state: window.__op2.game.state, screen: window.__op2.ctx.hud?.screens?.name ?? null,
          };
        });
        const entry = { url, bootSeconds: Math.round((Date.now() - t0) / 1000), load: await read() };
        await page.keyboard.press('F1');
        await h.sleep(400);
        entry.f1 = await read();
        if (url === '/?contract=outpost' || url === '/?contract=campaign&autostart=1') await h.shot(`dev-${url.includes('campaign') ? 'campaign' : 'outpost'}`);
        await page.keyboard.press('F1');
        await h.sleep(300);
        entry.f1Again = (await read()).panel;
        await page.keyboard.press('Backquote');
        await h.sleep(300);
        entry.backquote = (await read()).panel;
        await page.keyboard.press('Escape');
        await h.sleep(300);
        entry.escape = { panel: (await read()).panel, screen: (await read()).screen };
        log.push(entry);
      }
    },
  };

  try {
    for (const step of STEP.split(',')) {
      log.push({ step });
      await steps[step]();
    }
  } catch (e) {
    errors.push(String(e.stack ?? e));
  }
  return { step: STEP, log, errors };
}
