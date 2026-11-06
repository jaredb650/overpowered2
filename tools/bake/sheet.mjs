#!/usr/bin/env node
// Contact sheet of existing captures: node tools/bake/sheet.mjs <out.png> <columns> <file...>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [out, colsArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg);
const cell = Math.floor(1800 / cols);
const rows = Math.ceil(files.length / cols);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: cols * cell, height: rows * cell } });
const imgs = files.map(f => `<div style="position:relative;width:${cell}px;height:${cell}px;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover" src="data:image/png;base64,${readFileSync(f).toString('base64')}"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace">${basename(f, '.png')}</span></div>`);
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cell}px)">${imgs.join('')}</body>`);
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(out) });
await browser.close();
