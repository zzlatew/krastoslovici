// Генератор на скандинавски кръстословици, в които всички думи са свързани в една мрежа.
// Метод: малки валидни плочки, които делят рамките си -> симулирано охлаждане със свързаност
// -> точен ремонт на прозорци (LNS) около оставащите грешки.
// Гаранции на резултата: всяка поредица от ≥2 букви е дума от речника, без повторения,
// няма букви извън думи, всички букви са в една свързана мрежа.
// Клетка: буква или '#' (определение). Ред 0 и колона 0 са винаги определения.
// Валидна решетка: всяка поредица от ≥2 букви (хоризонтално и вертикално) е дума от речника,
// няма повторени думи, всяка буква е в поне една дума, всяко вътрешно определение има поне една дума,
// всички букви са свързани в една мрежа.
'use strict';

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function buildIndex(words) {
  const byLen = {};
  const pos = {}; // pos[L][i][ch] -> масив от думи
  for (const w of words) {
    const L = w.length;
    (byLen[L] = byLen[L] || []).push(w);
    pos[L] = pos[L] || [];
    for (let i = 0; i < L; i++) {
      pos[L][i] = pos[L][i] || {};
      (pos[L][i][w[i]] = pos[L][i][w[i]] || []).push(w);
    }
  }
  const root = { c: {}, w: false };
  for (const w of words) { let n = root; for (const ch of w) n = n.c[ch] || (n.c[ch] = { c: {}, w: false }); n.w = true; }
  return { byLen, pos, set: new Set(words), root };
}

function generateSA(words, W, H, opts) {
  opts = opts || {};
  const rng = makeRng(opts.seed || Math.floor(Math.random() * 4294967296));
  const idx = opts.index || buildIndex(words);
  const maxLen = Math.min(opts.maxLen || 9, Math.max(W, H) - 1);
  const iters = opts.iters || 400000;
  const T0 = opts.T0 || 1.5, T1 = opts.T1 || 0.03;
  const clueTarget = opts.clueTarget || 0.30;
  const deadline = Date.now() + (opts.timeLimit || 60000);
  const CLUE = '#';
  const EW = opts.emptyW != null ? opts.emptyW : 1;
  const BW = opts.borderW != null ? opts.borderW : 0.7;
  const SW = opts.singleW != null ? opts.singleW : 0.4;
  const lens = Object.keys(idx.byLen).map(Number).filter(l => l >= 2 && l <= maxLen);

  // начална решетка: случайна шахматоподобна смес
  const g = [];
  for (let r = 0; r < H; r++) {
    g.push([]);
    for (let c = 0; c < W; c++) g[r].push(r === 0 || c === 0 ? CLUE : opts.init ? opts.init[r][c] : (rng() < 0.3 ? CLUE : 'А'));
  }

  // ---------- оценка ----------
  const counts = new Map(); // дума -> брой
  const hRuns = [], vRuns = []; // за всеки ред/колона: списък от [start, len, word]
  for (let r = 0; r < H; r++) hRuns.push([]);
  for (let c = 0; c < W; c++) vRuns.push([]);
  let E = 0;
  let eRuns = 0, eDup = 0, eCells = 0;
  const cellCost = []; for (let r = 0; r < H; r++) cellCost.push(new Float64Array(W));

  function runsOfRow(r) {
    const out = []; let c = 1;
    while (c < W) {
      if (g[r][c] === CLUE) { c++; continue; }
      let s = c, w = '';
      while (c < W && g[r][c] !== CLUE) { w += g[r][c]; c++; }
      out.push([s, c - s, w]);
    }
    return out;
  }
  function runsOfCol(c) {
    const out = []; let r = 1;
    while (r < H) {
      if (g[r][c] === CLUE) { r++; continue; }
      let s = r, w = '';
      while (r < H && g[r][c] !== CLUE) { w += g[r][c]; r++; }
      out.push([s, r - s, w]);
    }
    return out;
  }
  function runCost(run) { const [, L, w] = run; if (L < 2) return 0; return idx.set.has(w) ? 0 : L; }
  function addRuns(list, sign) {
    for (const run of list) {
      if (run[1] < 2) continue;
      eRuns += sign * runCost(run);
      if (idx.set.has(run[2])) {
        const k = counts.get(run[2]) || 0;
        if (sign > 0) { if (k >= 1) eDup += 2; counts.set(run[2], k + 1); }
        else { if (k >= 2) eDup -= 2; if (k <= 1) counts.delete(run[2]); else counts.set(run[2], k - 1); }
      }
    }
  }
  function hLenAt(r, c) { let a = c, b = c; while (a - 1 >= 1 && g[r][a - 1] !== CLUE) a--; while (b + 1 < W && g[r][b + 1] !== CLUE) b++; return b - a + 1; }
  function vLenAt(r, c) { let a = r, b = r; while (a - 1 >= 1 && g[a - 1][c] !== CLUE) a--; while (b + 1 < H && g[b + 1][c] !== CLUE) b++; return b - a + 1; }
  function computeCell(r, c) {
    if (r === 0 && c === 0) return 0;
    if (g[r][c] === CLUE) {
      let cost = 0;
      // има ли дума надясно или надолу
      let right = 0; for (let x = c + 1; x < W && g[r][x] !== CLUE; x++) right++;
      let down = 0; for (let y = r + 1; y < H && g[y][c] !== CLUE; y++) down++;
      if (right < 2 && down < 2) cost += (r === 0 || c === 0) ? BW : EW;
      // блок 2×2 от определения
      if (r >= 1 && c >= 1 && g[r - 1][c] === CLUE && g[r][c - 1] === CLUE && g[r - 1][c - 1] === CLUE && !(r === 1 || c === 1)) cost += 0.6;
      return cost;
    }
    const h = hLenAt(r, c), v = vLenAt(r, c);
    if (h < 2 && v < 2) return 1.5;       // изолирана буква
    if (h < 2 || v < 2) return SW;      // кръстосана само в една посока
    return 0;
  }
  let clueCount = 0, eConn = 0;
  const connW = opts.connW || 0;
  const seenArr = new Int32Array(W * H); let stamp = 0; const stack = new Int32Array(W * H);
  function components() {
    stamp++; let comps = 0;
    for (let r = 1; r < H; r++) for (let c = 1; c < W; c++) {
      const k0 = r * W + c;
      if (g[r][c] === CLUE || seenArr[k0] === stamp) continue;
      comps++; let sp = 0; stack[sp++] = k0; seenArr[k0] = stamp;
      while (sp) {
        const k = stack[--sp], y = (k / W) | 0, x = k - y * W;
        if (x + 1 < W && g[y][x + 1] !== CLUE && seenArr[k + 1] !== stamp) { seenArr[k + 1] = stamp; stack[sp++] = k + 1; }
        if (x - 1 >= 1 && g[y][x - 1] !== CLUE && seenArr[k - 1] !== stamp) { seenArr[k - 1] = stamp; stack[sp++] = k - 1; }
        if (y + 1 < H && g[y + 1][x] !== CLUE && seenArr[k + W] !== stamp) { seenArr[k + W] = stamp; stack[sp++] = k + W; }
        if (y - 1 >= 1 && g[y - 1][x] !== CLUE && seenArr[k - W] !== stamp) { seenArr[k - W] = stamp; stack[sp++] = k - W; }
      }
    }
    return comps;
  }
  function densityCost() { const inner = (W - 1) * (H - 1); const ex = clueCount - clueTarget * inner; return ex > 0 ? ex * 0.4 : 0; }

  function fullEval() {
    counts.clear(); eRuns = 0; eDup = 0; eCells = 0; clueCount = 0;
    for (let r = 0; r < H; r++) { hRuns[r] = runsOfRow(r); addRuns(hRuns[r], 1); }
    for (let c = 0; c < W; c++) { vRuns[c] = runsOfCol(c); addRuns(vRuns[c], 1); }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { cellCost[r][c] = computeCell(r, c); eCells += cellCost[r][c]; if (r && c && g[r][c] === CLUE) clueCount++; }
    eConn = connW ? (components() - 1) * connW : 0;
    E = eRuns + eDup + eCells + densityCost() + eConn;
  }

  // промяна на клетки с инкрементално преизчисляване
  function apply(changes) { // changes: [[r,c,val]]
    const rows = new Set(), cols = new Set();
    for (const [r, c] of changes) { rows.add(r); cols.add(c); }
    // затронатите клетки за клетъчната цена: редовете и колоните (+ съседни за блок 2×2)
    for (const r of rows) addRuns(hRuns[r], -1);
    for (const c of cols) addRuns(vRuns[c], -1);
    const old = [];
    for (const [r, c, v] of changes) {
      old.push([r, c, g[r][c]]);
      if (r && c) { if (g[r][c] === CLUE) clueCount--; if (v === CLUE) clueCount++; }
      g[r][c] = v;
    }
    for (const r of rows) { hRuns[r] = runsOfRow(r); addRuns(hRuns[r], 1); }
    for (const c of cols) { vRuns[c] = runsOfCol(c); addRuns(vRuns[c], 1); }
    const touched = new Set();
    for (const r of rows) for (let c = 0; c < W; c++) touched.add(r * W + c);
    for (const c of cols) for (let r = 0; r < H; r++) touched.add(r * W + c);
    for (const [r, c] of changes) for (const [dr, dc] of [[1, 0], [0, 1], [1, 1]]) { const y = r + dr, x = c + dc; if (y < H && x < W) touched.add(y * W + x); }
    // определенията вляво от реда / над колоната също зависят
    for (const k of touched) {
      const r = Math.floor(k / W), c = k % W;
      const nv = computeCell(r, c);
      eCells += nv - cellCost[r][c]; cellCost[r][c] = nv;
    }
    // клетки-определения в колоните на промените, но в други редове (надясно) вече са в touched чрез реда.
    // клетки-определения в редовете над промените в същата колона са в touched чрез колоната.
    eConn = connW ? (components() - 1) * connW : 0;
    E = eRuns + eDup + eCells + densityCost() + eConn;
    return old;
  }
  function undo(old) { const ch = old.map(([r, c, v]) => [r, c, v]); apply(ch); }

  function letterFreqPick() { const L = lens[Math.floor(rng() * lens.length)]; const ws = idx.byLen[L]; const w = ws[Math.floor(rng() * ws.length)]; return w[Math.floor(rng() * w.length)]; }

  // ход: поставяне на дума в слот
  function wordMove(tr, tc) {
    const horiz = rng() < 0.5;
    const lineMax = horiz ? H : W, along = horiz ? W : H;
    let line, p, L;
    if (tr != null) {
      line = horiz ? tr : tc;
      const at = horiz ? tc : tr; // позиция, която трябва да покрием (или съседна)
      L = 2 + Math.floor(rng() * (Math.min(maxLen, along - 1) - 1));
      const lo = Math.max(1, at - L + 1), hi = Math.min(at, along - L);
      if (hi < lo) return null;
      p = lo + Math.floor(rng() * (hi - lo + 1));
    } else {
      line = 1 + Math.floor(rng() * (lineMax - 1));
      p = 1 + Math.floor(rng() * (along - 2));
      const maxL = Math.min(maxLen, along - p);
      if (maxL < 2) return null;
      L = 2 + Math.floor(rng() * (maxL - 1));
    }
    if (line < 1 || line >= lineMax) return null;
    if (!idx.byLen[L]) return null;
    const cell = i => horiz ? [line, p + i] : [p + i, line];
    const cons = [];
    for (let i = 0; i < L; i++) { const [r, c] = cell(i); const v = g[r][c]; if (v !== CLUE) cons.push([i, v]); }
    // избираме подмножество от ограниченията (понякога всички)
    let use = cons;
    if (cons.length && rng() < 0.35) use = cons.filter(() => rng() < 0.6);
    let cand = null;
    for (const [i, ch] of use) {
      const lst = (idx.pos[L][i] && idx.pos[L][i][ch]) || [];
      if (!cand || lst.length < cand.length) cand = lst;
      if (!lst.length) break;
    }
    if (cand === null) cand = idx.byLen[L];
    if (!cand.length) return null;
    let w = null;
    for (let t = 0; t < 12; t++) {
      const x = cand[Math.floor(rng() * cand.length)];
      if (use.every(([i, ch]) => x[i] === ch)) { w = x; break; }
    }
    if (!w) return null;
    const ch = [];
    for (let i = 0; i < L; i++) { const [r, c] = cell(i); if (g[r][c] !== w[i]) ch.push([r, c, w[i]]); }
    const [br, bc] = cell(-1); if ((br || bc) && br >= 0 && bc >= 0 && g[br][bc] !== CLUE && br > 0 && bc > 0) ch.push([br, bc, CLUE]);
    if (p + L < along) { const [ar, ac] = cell(L); if (g[ar][ac] !== CLUE) ch.push([ar, ac, CLUE]); }
    return ch.length ? ch : null;
  }
  let bad = [], lastWhy = null;
  function refreshBad() {
    const s = new Set();
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (cellCost[r][c] > 0) {
      if (g[r][c] === CLUE) { if (c + 1 < W) s.add(r * W + c + 1); if (r + 1 < H) s.add((r + 1) * W + c); if (r && c) s.add(r * W + c); }
      else s.add(r * W + c);
    }
    for (let r = 1; r < H; r++) for (const [st, L, w] of hRuns[r]) if (L >= 2 && (!idx.set.has(w) || counts.get(w) > 1)) for (let i = 0; i < L; i++) s.add(r * W + st + i);
    for (let c = 1; c < W; c++) for (const [st, L, w] of vRuns[c]) if (L >= 2 && (!idx.set.has(w) || counts.get(w) > 1)) for (let i = 0; i < L; i++) s.add((st + i) * W + c);
    bad = [...s].filter(k => Math.floor(k / W) >= 1 && k % W >= 1);
  }
  function flipMove(fr, fc) {
    let r = 1 + Math.floor(rng() * (H - 1)), c = 1 + Math.floor(rng() * (W - 1));
    if (fr != null && fr >= 1 && fc >= 1) { r = fr; c = fc; }
    return [[r, c, g[r][c] === CLUE ? letterFreqPick() : CLUE]];
  }


  // ---------- точен ремонт на прозорец (LNS) ----------
  function trieNode(p) { let n = idx.root; for (let i = 0; i < p.length; i++) { n = n.c[p[i]]; if (!n) return null; } return n; }
  function suffixH(r, c) { let s = ''; for (let x = c; x < W && g[r][x] !== CLUE; x++) s += g[r][x]; return s; }
  function suffixV(r, c) { let s = ''; for (let y = r; y < H && g[y][c] !== CLUE; y++) s += g[y][c]; return s; }
  function lnsRepair(r0, c0, h, w, budget) {
    const r1 = r0 + h - 1, c1 = c0 + w - 1;
    const inWin = (r, c) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
    // думи от поредици, които не пресичат прозореца
    const usedOut = new Set();
    for (let r = 1; r < H; r++) for (const [st, L, wd] of hRuns[r]) { if (L < 2) continue; let hit = r >= r0 && r <= r1 && st <= c1 && st + L - 1 >= c0; if (!hit) usedOut.add(wd); }
    for (let c = 1; c < W; c++) for (const [st, L, wd] of vRuns[c]) { if (L < 2) continue; let hit = c >= c0 && c <= c1 && st <= r1 && st + L - 1 >= r0; if (!hit) usedOut.add(wd); }
    const saved = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { saved.push(g[r][c]); g[r][c] = null; }
    const usedIn = new Set();
    let steps = 0;
    const okWord = wd => idx.set.has(wd) && !usedOut.has(wd) && !usedIn.has(wd);
    function hp(r, c) { let s = ''; for (let x = c - 1; x >= 0 && g[r][x] !== CLUE; x--) s = g[r][x] + s; return s; }
    function vp(r, c) { let s = ''; for (let y = r - 1; y >= 0 && g[y][c] !== CLUE; y--) s = g[y][c] + s; return s; }
    function dfs(k) {
      if (++steps > budget) return false;
      if (k === h * w) return true;
      const r = r0 + Math.floor(k / w), c = c0 + k % w;
      const hs = hp(r, c), vs = vp(r, c);
      const nh = trieNode(hs), nv = trieNode(vs);
      const opts2 = [];
      if (nh && nv) for (const ch in nh.c) if (nv.c[ch]) opts2.push(ch);
      for (let i = opts2.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [opts2[i], opts2[j]] = [opts2[j], opts2[i]]; }
      if (rng() < 0.3) opts2.unshift(CLUE); else opts2.push(CLUE);
      for (const ch of opts2) {
        const add = [];
        let ok = true;
        if (ch === CLUE) {
          if (hs.length >= 2) { if (okWord(hs)) add.push(hs); else ok = false; }
          if (ok && vs.length >= 2) { if (okWord(vs) && !add.includes(vs)) add.push(vs); else ok = false; }
          if (ok && c === c1 && c + 1 < W && g[r][c + 1] !== CLUE) { const s = suffixH(r, c + 1); if (s.length >= 2) { if (okWord(s) && !add.includes(s)) add.push(s); else ok = false; } }
          if (ok && r === r1 && r + 1 < H && g[r + 1][c] !== CLUE) { const s = suffixV(r + 1, c); if (s.length >= 2) { if (okWord(s) && !add.includes(s)) add.push(s); else ok = false; } }
          if (ok && r === r0 && r0 > 1 && c >= 1) { /* клетката над прозореца остава */ }
        } else {
          if (c === c1) {
            const full = hs + ch + (c + 1 < W ? suffixH(r, c + 1) : '');
            if (full.length >= 2) { if (okWord(full)) add.push(full); else ok = false; }
          }
          if (ok && r === r1) {
            const full = vs + ch + (r + 1 < H ? suffixV(r + 1, c) : '');
            if (full.length >= 2) { if (okWord(full) && !add.includes(full)) add.push(full); else ok = false; }
          }
        }
        if (!ok) continue;
        g[r][c] = ch;
        for (const a of add) usedIn.add(a);
        if (dfs(k + 1)) return true;
        for (const a of add) usedIn.delete(a);
        g[r][c] = null;
        if (steps > budget) return false;
      }
      return false;
    }
    const before = E;
    const okFill = dfs(0);
    if (!okFill) { let i = 0; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = saved[i++]; return false; }
    fullEval();
    if (E < before - 1e-9 || (E <= before + 1e-9 && rng() < 0.5)) return true;
    let i = 0; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = saved[i++];
    fullEval();
    return false;
  }
  function lnsRound(n) {
    refreshBad();
    for (let t = 0; t < n && bad.length; t++) {
      const k = bad[Math.floor(rng() * bad.length)];
      const r = Math.floor(k / W), c = k % W;
      const h = 2 + Math.floor(rng() * (inB ? 5 : 4)), w = 2 + Math.floor(rng() * (inB ? 6 : 5));
      const r0 = Math.max(1, Math.min(H - h, r - Math.floor(rng() * h)));
      const c0 = Math.max(1, Math.min(W - w, c - Math.floor(rng() * w)));
      if (lnsRepair(r0, c0, h, w, opts.lnsBudget || 30000)) refreshBad();
      if (eRuns === 0 && eDup === 0 && validate()) return true;
    }
    return false;
  }
  fullEval();
  const tStart = Date.now();
  const phaseB = tStart + (opts.timeLimit || 60000) * (opts.phaseA || 0.6);
  let inB = false;
  let best = E, T = T0;
  const cycle = opts.cycle || iters;
  const decay = Math.pow(T1 / T0, 1 / cycle);
  const reT = opts.reheat || T0;
  let it = 0;
  const maxSingles = opts.maxSingles != null ? opts.maxSingles : Math.round((W - 1) * (H - 1) * (opts.singleFrac || 0.12));
  let done = false;
  for (; it < iters; it++) {
    if ((it & 255) === 0) {
      if (Date.now() > deadline) break;
      if (eRuns === 0 && eDup === 0 && validate()) { done = true; break; }
    }
    if ((it & 127) === 0) refreshBad();
    if (opts.lnsEvery && it > 0 && it % opts.lnsEvery === 0 && E < (opts.lnsBelow || 1e9)) { if (lnsRound(opts.lnsTries || 40)) { done = true; break; } }
    let mv;
    if (bad.length && rng() < (opts.focus != null ? opts.focus : 0.5)) {
      const k = bad[Math.floor(rng() * bad.length)];
      const r = Math.floor(k / W), c = k % W;
      mv = rng() < 0.9 ? wordMove(Math.max(1, r), Math.max(1, c)) : flipMove(r, c);
    } else mv = rng() < 0.85 ? wordMove() : flipMove();
    T *= decay; if (it > 0 && it % cycle === 0 && Date.now() < phaseB) T = reT;
    if (Date.now() >= phaseB && !inB) { inB = true; T = Math.min(T, opts.TB || 0.08); }
    if (inB && (it & 4095) === 0) { if (lnsRound(opts.lnsTriesB || 60)) { done = true; break; } }
    if (!mv) continue;
    const before = E;
    const old = apply(mv);
    const d = E - before;
    if (d > 0 && rng() >= Math.exp(-d / T)) undo(old);
    if (E < best) best = E;
  }
  // последно почистване: буква от грешна поредица -> определение, ако това намалява енергията
  if (!done) {
    for (let pass = 0; pass < 6 && !done; pass++) {
      refreshBad();
      let improved = false;
      for (const k of bad) {
        const r = Math.floor(k / W), c = k % W;
        if (g[r][c] === CLUE) continue;
        const wasIso = cellCost[r][c] === 1.5;
        const before = E, old = apply([[r, c, CLUE]]);
        if (E < before - 1e-9 || (wasIso && E <= before + 1e-9)) { improved = true; if (eRuns === 0 && eDup === 0 && validate()) { done = true; break; } }
        else undo(old);
      }
      if (!improved) { if (lnsRound(200)) done = true; }
    }
  }
  if (!done && !(eRuns === 0 && eDup === 0 && validate())) {
    let iso = 0, emp = 0, sing = 0, blk = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const v = cellCost[r][c]; if (v === 1.5) iso++; else if (v === EW || Math.abs(v - EW - 0.6) < 1e-9) emp++; else if (Math.abs(v - SW) < 1e-9) sing++; else if (Math.abs(v - 0.6) < 1e-9) blk++; }
    return { ok: false, E, it, info: { why: lastWhy, eConn, eRuns, eDup, iso, emp, sing, blk, dens: densityCost(), clues: clueCount }, grid: g.map(r => r.slice()) };
  }
  return { ok: true, grid: g.map(r => r.slice()), it };

  function validate() {
    let singles = 0, borderEmpty = 0, innerEmpty = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (r === 0 && c === 0) continue;
      if (g[r][c] === CLUE) {
        let right = 0; for (let x = c + 1; x < W && g[r][x] !== CLUE; x++) right++;
        let down = 0; for (let y = r + 1; y < H && g[y][c] !== CLUE; y++) down++;
        if (right < 2 && down < 2) { if (r === 0 || c === 0) borderEmpty++; else innerEmpty++; }
      } else {
        const h = hLenAt(r, c), v = vLenAt(r, c);
        if (h < 2 && v < 2) return false;
        if (h < 2 || v < 2) singles++;
      }
    }
    lastWhy = { singles, borderEmpty, innerEmpty, maxSingles };
    if (innerEmpty > (opts.maxInnerEmpty != null ? opts.maxInnerEmpty : Math.round((W - 1) * (H - 1) * (opts.innerFrac || 0.01)))) return false;
    if (singles > maxSingles || borderEmpty > (opts.maxBorderEmpty != null ? opts.maxBorderEmpty : Math.round((W + H) * (opts.borderFrac || 0.25)))) return false;
    const cn = connected(); lastWhy.conn = cn; return cn;
  }
  function connected() {
    let start = null, total = 0;
    for (let r = 1; r < H; r++) for (let c = 1; c < W; c++) if (g[r][c] !== CLUE) { total++; if (!start) start = [r, c]; }
    const seen = new Set([start[0] * W + start[1]]), st = [start];
    while (st.length) {
      const [r, c] = st.pop();
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const y = r + dr, x = c + dc;
        if (y < 1 || x < 1 || y >= H || x >= W || g[y][x] === CLUE) continue;
        const k = y * W + x; if (!seen.has(k)) { seen.add(k); st.push([y, x]); }
      }
    }
    return seen.size === total;
  }
}

// Голяма решетка: първо малки валидни плочки, които делят рамките си, после сливане чрез търсене.
function splitSizes(total, parts) { // total = 1 + sum(w_i) + (parts-1)
  const inner = total - 1 - (parts - 1), base = Math.floor(inner / parts), out = [];
  for (let i = 0; i < parts; i++) out.push(base + (i < inner - base * parts ? 1 : 0));
  return out;
}
function generateBig(words, W, H, opts) {
  opts = opts || {};
  const idx = opts.index || buildIndex(words);
  const rng = makeRng(opts.seed || Math.floor(Math.random() * 4294967296));
  const tx = opts.tilesX || 3, ty = opts.tilesY || 3;
  const ws = splitSizes(W, tx), hs = splitSizes(H, ty);
  const init = []; for (let r = 0; r < H; r++) init.push(new Array(W).fill('#'));
  let y0 = 0;
  for (let i = 0; i < ty; i++) {
    let x0 = 0;
    for (let j = 0; j < tx; j++) {
      const tw = ws[j] + 1, th = hs[i] + 1;
      let tile = null;
      for (let k = 0; k < 20 && !tile; k++) {
        const p = generateSA(words, tw, th, { index: idx, iters: 4e6, timeLimit: 15000, cycle: 800000, seed: Math.floor(rng() * 4294967296), borderFrac: 0.4, maxInnerEmpty: 0 });
        if (p.ok) tile = p.grid;
      }
      if (!tile) return { ok: false, stage: 'tile' };
      for (let r = 1; r < th; r++) for (let c = 1; c < tw; c++) init[y0 + r][x0 + c] = tile[r][c];
      x0 += tw; // следващата плочка започва на своята рамка
    }
    y0 += hs[i] + 1;
  }
  return generateSA(words, W, H, Object.assign({ index: idx, init, connW: 3, T0: opts.T0 || 0.5 }, opts, { seed: Math.floor(rng() * 4294967296) }));
}

if (typeof module !== 'undefined') module.exports = { generateSA, generateBig, buildIndex, makeRng };
