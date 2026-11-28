/**
 * Live Chromium visual & functional verification for Campaign Mission: Deprecation (`Form 7742-A`).
 * Visits 5 headline sections on `openmind` at 1440x900 dpr 2 and captures screenshots + diagnostics:
 *   1. skyline_drop   — Mirror's Edge rooftops, Gaff harpoon, Canyon Zipline, Ram Faultman HUD
 *   2. office_breach  — 80th-floor glass curtain wall & Executive Office breakables
 *   3. datacenter     — Sub-Level 4 Compute Vault, server rack aisles & AEGIS-0 in bay
 *   4. boss_stage1    — Inside Distraint Frame on Grand Boulevard facing 12 m ORION-0 + fleeing civilians
 *   5. boss_stage3    — Civic Spire Plaza, Municipal Power Spire, 3 Grid Umbilical Conduits & Upload % bar
 */
export default async function run(page, { sleep, shot }) {
  const origin = new URL(page.url()).origin;
  const beats = [
    { id: 'skyline_drop', name: '01-skyline', wait: 2200, switchGaff: true, toggleVisionOff: false },
    { id: 'office_breach', name: '02-office-glass', wait: 2200, switchGaff: false, toggleVisionOff: false },
    { id: 'datacenter', name: '03-datacenter', wait: 2200, switchGaff: false, toggleVisionOff: false },
    { id: 'boss_stage1', name: '04-boulevard-boss1', wait: 1600, switchGaff: false, toggleVisionOff: true },
    { id: 'boss_stage3', name: '05-spire-boss3', wait: 1800, switchGaff: false, toggleVisionOff: true },
  ];

  const report = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (i > 0) {
      const url = `${origin}/?contract=deprecation&beat=${b.id}&autostart=1&music=0`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForFunction(
      () => {
        const op2 = window.__op2;
        return op2?.game?.state === 'playing' && op2?.campaign?.runner?.describe?.()?.beat;
      },
      { timeout: 60000 },
    );

    // Keep camera invulnerable during screenshot capture & switch to Gaff on Tower 1 to showcase it.
    await page.evaluate(switchGaff => {
      const op2 = window.__op2;
      if (op2?.ctx?.player?.modifiers) op2.ctx.player.modifiers.invulnerable = true;
      if (switchGaff) op2?.ctx?.weapons?.switchTo?.('gaff');
    }, b.switchGaff);

    if (b.toggleVisionOff) {
      await page.keyboard.press('KeyI');
    }

    await sleep(b.wait);

    const info = await page.evaluate(() => {
      const op2 = window.__op2;
      const d = op2?.campaign?.runner?.describe?.();
      const r = op2?.ctx?.renderer?.renderer?.info;
      const p = op2?.ctx?.player?.position;
      const f = op2?.ctx?.frame;
      return {
        beat: d?.beat ?? null,
        playerPos: p ? [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] : null,
        inFrame: Boolean(f?.inSeat || op2?.ctx?.player?.parked),
        draws: r?.render?.calls ?? null,
        tris: r?.render?.triangles ?? null,
        objectives: Array.from(document.querySelectorAll('.ms-obj-text')).map(el => el.textContent),
        speaker: document.querySelector('.cmd-box.on .cmd-name')?.textContent ?? null,
        bossTitle: document.querySelector('.fc-bar.on .fc-title')?.textContent ?? null,
        bossPhase: document.querySelector('.fc-bar.on .fc-phase')?.textContent ?? null,
      };
    });

    await shot(b.name);
    report.push({ id: b.id, info });
  }
  return report;
}
