#!/usr/bin/env node
// Генерира нови големи (21×25) скандинавски кръстословици и ги добавя към готовия набор.
// Употреба (от папката crossword-cloudflare):  node tools/generate-large.cjs [брой] [минути_на_опит]
// Една кръстословица отнема обикновено 5–10 минути (около половината опити успяват) на ядро; за повече скорост пуснете
// няколко копия едновременно в отделни терминали. Резултатите се записват в
// src/pools.json (за сървъра) и public/pools.js (за браузъра).
'use strict';
const fs = require('fs');
const path = require('path');
const { generateBig, buildIndex } = require('./scandi-generator.cjs');

const root = path.join(__dirname, '..');
const dictSrc = fs.readFileSync(path.join(root, 'public/dictionary.js'), 'utf8');
const dict = JSON.parse(dictSrc.slice(dictSrc.indexOf('['), dictSrc.lastIndexOf(']') + 1));
const words = dict.map(e => e.word);
const index = buildIndex(words);

const count = +process.argv[2] || 1;
const minutes = +process.argv[3] || 10;
const poolsPath = path.join(root, 'src/pools.json');

const settings = [
  { phaseA: 0.5, lnsEvery: 200000, lnsTries: 60, lnsBelow: 60 },
  { phaseA: 0.4, lnsEvery: 100000, lnsTries: 100, lnsBelow: 80, T0: 0.3, reheat: 0.3, lnsBudget: 60000 },
];

function save(grid) {
  const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));
  pools.l = pools.l || [];
  pools.l.push(grid.map(r => r.join('')).join('|'));
  fs.writeFileSync(poolsPath, JSON.stringify(pools));
  fs.writeFileSync(path.join(root, 'public/pools.js'),
    '/* Готови кръстословици. Генерирани с tools/generate-large.cjs – не редактирайте ръчно. */\nwindow.CROSSWORD_POOLS = ' + JSON.stringify(pools) + ';\n');
  return pools.l.length;
}

let made = 0, attempt = 0;
while (made < count) {
  const s = settings[attempt++ % settings.length];
  const t0 = Date.now();
  const p = generateBig(words, 21, 25, Object.assign({
    index, iters: 1e9, timeLimit: minutes * 60000, cycle: 3000000,
    singleFrac: 0.15, borderFrac: 0.4, innerFrac: 0.03, emptyW: 1.5,
  }, s));
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  if (p.ok) { made++; console.log(`✓ готова (${sec} s) – общо големи: ${save(p.grid)}`); }
  else console.log(`× неуспешен опит (${sec} s), пробвам пак`);
}
