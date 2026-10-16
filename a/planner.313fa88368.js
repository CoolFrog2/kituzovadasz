/* Kitűzővadász — körtúra-tervező jelzett turistautakon. Teljesen a böngészőben fut:
 * a jelzett-út hálózatot csempénként tölti (data/trails, tools/build_trails.py építi),
 * és itt keres adott hosszúságú kört. Szerver nem kell → statikus hoszton is megy. */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  const B = window.B || '';
  const D2R = Math.PI / 180;
  const SNAP_MAX = 1500;   // m — ennél messzebb a jelzett úttól nem illesztünk
  const SPEED = 4;         // km/h sík terepen
  const CLIMB = 400;       // m/óra emelkedés (menetidő = km/SPEED + szint/CLIMB)

  const hav = (a, b) => {
    const dLat = (b[0] - a[0]) * D2R, dLng = (b[1] - a[1]) * D2R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  const polyLen = g => { let s = 0; for (let i = 1; i < g.length; i++) s += hav(g[i - 1], g[i]); return s; };
  const bearing = (a, b) => {
    const y = Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R);
    const x = Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  };

  // --- gráf: csempék betöltése -------------------------------------------------
  const G = { meta: null, tiles: new Set(), V: new Map(), E: [], adj: new Map(), ids: new Set() };
  let TMPE = [], TMPADJ = new Map();             // a virtuális rajtpont ideiglenes élei (negatív index)
  let SKIP = -1;                                  // az az eredeti él, amit a rajt két félre vág (tervezéskor kimarad)
  const edge = i => (i < 0 ? TMPE[-i - 1] : G.E[i]);
  const ekey = i => i;                            // a két fél-él külön szakasz; az eredeti él közben nem használható
  const neighbors = n => (G.adj.get(n) || []).filter(i => i !== SKIP).concat(TMPADJ.get(n) || []);
  const degree = n => neighbors(n).length;
  const nodeLL = n => (n === -1 ? START.P : G.V.get(n));

  function addEdge(u, v, len, marks, geom, z) {
    const i = G.E.length;
    G.E.push({ u, v, len, marks, geom, z });
    if (!G.adj.has(u)) G.adj.set(u, []);
    G.adj.get(u).push(i);
    if (v !== u) { if (!G.adj.has(v)) G.adj.set(v, []); G.adj.get(v).push(i); }
  }

  async function ensureTiles(lat, lng, km) {
    // a meta mindig friss (query-vel kerüljük a CDN-cache-t); online a csempék verziózott mappában
    // vannak (trails/<v>/t/), így egy havi újraépítés után sem keveredhet régi és új csempe
    if (!G.meta) G.meta = await (await fetch(`${B}/trails/meta.json?${Date.now()}`)).json();
    const tdir = G.meta.v ? `${B}/trails/${G.meta.v}/t` : `${B}/trails/t`;
    const [TL, TG] = G.meta.tile, have = new Set(G.meta.tiles);
    const dLat = km / 111, dLng = km / (111 * Math.cos(lat * D2R));
    const need = [];
    for (let ty = Math.floor((lat - dLat) / TL); ty <= Math.floor((lat + dLat) / TL); ty++) {
      for (let tx = Math.floor((lng - dLng) / TG); tx <= Math.floor((lng + dLng) / TG); tx++) {
        const k = `${ty}_${tx}`;
        if (have.has(k) && !G.tiles.has(k)) need.push(k);
      }
    }
    const added = [];
    await Promise.all(need.map(async k => {
      const t = await (await fetch(`${tdir}/${k}.json`)).json();
      G.tiles.add(k);
      for (const [id, ll] of Object.entries(t.v)) G.V.set(Number(id), [ll[0] / 1e5, ll[1] / 1e5]);
      for (const [eid, u, v, len, marks, flat, zflat] of t.e) {
        if (G.ids.has(eid)) continue;   // több csempében is szereplő él
        G.ids.add(eid);
        let la = flat[0], ln = flat[1];
        const geom = [[la / 1e5, ln / 1e5]];
        for (let i = 2; i < flat.length; i += 2) { la += flat[i]; ln += flat[i + 1]; geom.push([la / 1e5, ln / 1e5]); }
        let z = null;
        if (zflat && zflat.length) { z = new Array(zflat.length); let acc = 0; for (let i = 0; i < zflat.length; i++) { acc += zflat[i]; z[i] = acc; } }
        addEdge(u, v, len, marks, geom, z);
        added.push(geom);
      }
    }));
    return added;
  }

  // --- rajtpont illesztése a legközelebbi jelzett útra --------------------------
  let START = null;
  function snapStart(lat, lng) {
    const kx = 111320 * Math.cos(lat * D2R), ky = 110540;
    let best = { d: Infinity };
    for (let i = 0; i < G.E.length; i++) {
      const g = G.E[i].geom;
      for (let k = 1; k < g.length; k++) {
        const ax = (g[k - 1][1] - lng) * kx, ay = (g[k - 1][0] - lat) * ky;
        const dx = (g[k][1] - g[k - 1][1]) * kx, dy = (g[k][0] - g[k - 1][0]) * ky;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best.d) best = { d, e: i, k, t };
      }
    }
    if (best.d > SNAP_MAX) return null;
    TMPE = []; TMPADJ = new Map(); SKIP = -1;
    const e = G.E[best.e], g = e.geom, k = best.k;
    const P = [g[k - 1][0] + (g[k][0] - g[k - 1][0]) * best.t, g[k - 1][1] + (g[k][1] - g[k - 1][1]) * best.t];
    const gA = g.slice(0, k).concat([P]), gB = [P].concat(g.slice(k));
    const la = polyLen(gA), lb = polyLen(gB), sc = e.len / ((la + lb) || 1);
    if (la * sc < 25) return { S: e.u, P: G.V.get(e.u), d: best.d };
    if (lb * sc < 25) return { S: e.v, P: G.V.get(e.v), d: best.d };
    let zA = null, zB = null;
    if (e.z && e.z.length >= 2) {
      const n = e.z.length, x = (la / (la + lb)) * (n - 1), kP = Math.min(Math.floor(x), n - 2), t = x - kP;
      const zP = e.z[kP] * (1 - t) + e.z[kP + 1] * t;
      zA = [zP]; for (let i = kP; i >= 0; i--) zA.push(e.z[i]);
      zB = [zP]; for (let i = kP + 1; i < n; i++) zB.push(e.z[i]);
    }
    TMPE.push({ u: -1, v: e.u, len: la * sc, marks: e.marks, geom: gA.slice().reverse(), base: best.e, z: zA });
    TMPE.push({ u: -1, v: e.v, len: lb * sc, marks: e.marks, geom: gB, base: best.e, z: zB });
    TMPADJ.set(-1, [-1, -2]);
    SKIP = best.e;
    const addT = (n, i) => { if (!TMPADJ.has(n)) TMPADJ.set(n, []); TMPADJ.get(n).push(i); };
    addT(e.u, -1); addT(e.v, -2);
    return { S: -1, P, d: best.d };
  }

  // --- Dijkstra (bináris kupac) -----------------------------------------------
  function dijkstra(src, limit, penalty, target) {
    const dist = new Map([[src, 0]]), prev = new Map();
    const hk = [0], hn = [src];   // párhuzamos kupac-tömbök
    const push = (k, n) => {
      let i = hk.length; hk.push(k); hn.push(n);
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hn[p], hn[i]] = [hn[i], hn[p]]; i = p; }
    };
    const pop = () => {
      const k = hk[0], n = hn[0], lk = hk.pop(), ln = hn.pop();
      if (hk.length) {
        hk[0] = lk; hn[0] = ln;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < hk.length && hk[l] < hk[m]) m = l;
          if (r < hk.length && hk[r] < hk[m]) m = r;
          if (m === i) break;
          [hk[m], hk[i]] = [hk[i], hk[m]]; [hn[m], hn[i]] = [hn[i], hn[m]]; i = m;
        }
      }
      return [k, n];
    };
    while (hk.length) {
      const [d, n] = pop();
      if (d > (dist.get(n) ?? Infinity)) continue;
      if (n === target || d > limit) break;
      for (const ei of neighbors(n)) {
        const e = edge(ei);
        const m = e.u === n ? e.v : e.u;
        if (m === n) continue;
        const nd = d + e.len * (penalty && penalty.has(ekey(ei)) ? 8 : 1);
        if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, [ei, n]); push(nd, m); }
      }
    }
    return { dist, prev };
  }
  function pathTo(prev, src, dst) {
    const steps = [];
    let n = dst;
    while (n !== src) {
      const p = prev.get(n);
      if (!p) return null;
      steps.push({ e: p[0], from: p[1], to: n });
      n = p[1];
    }
    return steps.reverse();
  }
  const reverseSteps = st => st.slice().reverse().map(s => ({ e: s.e, from: s.to, to: s.from }));
  // Tüske-eltávolítás: ha az út rámegy egy szakaszra és rögtön ugyanazon jön vissza, a párt kivágjuk
  // (veremmel, így az egymásba ágyazott oda-visszák is eltűnnek). A rajt fix, ezért a kör eleje–vége
  // közötti „szár” marad, ha a rajt maga zsákutcában van.
  function cancelUturns(steps) {
    const out = [];
    for (const s of steps) {
      const last = out[out.length - 1];
      if (last && last.e === s.e && last.from === s.to && last.to === s.from) out.pop();
      else out.push(s);
    }
    return out;
  }

  function evaluate(steps, L) {
    const seen = new Map();
    let len = 0, reuse = 0;
    for (const s of steps) {
      const e = edge(s.e), k = ekey(s.e);
      len += e.len;
      if (seen.has(k)) reuse += e.len;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return { steps, len, reuse, keys: new Set(seen.keys()), score: Math.abs(len - L) / L + 2.5 * reuse / Math.max(len, 1) };
  }

  // --- kör keresése: rajt → A → B → rajt, a visszaút kerüli a már bejárt éleket ---
  function planLoops(S, L) {
    const base = dijkstra(S, 0.8 * L);
    const P0 = nodeLL(S);
    const cands = [];
    for (const [n, d] of base.dist) {
      // fordulópont csak olyan csomópont lehet, ahonnan tovább is lehet menni (nem zsákutca vége)
      if (n !== S && d >= 0.12 * L && d <= 0.6 * L && degree(n) >= 2) cands.push({ n, d, b: bearing(P0, nodeLL(n)) });
    }
    const results = [];
    const SECT = 16;
    const tryRadius = r => {
      const per = new Array(SECT).fill(null);
      for (const c of cands) {
        const s = Math.floor(c.b / (360 / SECT)) % SECT;
        if (!per[s] || Math.abs(c.d - r) < Math.abs(per[s].d - r)) per[s] = c;
      }
      for (let i = 0; i < SECT; i++) {
        for (const sep of [2, 3, 4]) {
          const A = per[i], Bc = per[(i + sep) % SECT];
          if (!A || !Bc || A.n === Bc.n) continue;
          // rajt → A a keresőfából; A → B kerüli az odautat; B → rajt kerüli mindkettőt
          const pSA = pathTo(base.prev, S, A.n);
          if (!pSA) continue;
          const used = new Set(pSA.map(s => ekey(s.e)));
          const pAB = pathTo(dijkstra(A.n, 1.5 * L, used, Bc.n).prev, A.n, Bc.n);
          if (!pAB) continue;
          pAB.forEach(s => used.add(ekey(s.e)));
          const pBS = pathTo(dijkstra(Bc.n, 1.5 * L, used, S).prev, Bc.n, S);
          if (!pBS) continue;
          const steps = cancelUturns(pSA.concat(pAB, pBS));
          if (steps.length >= 2) results.push(evaluate(steps, L));
        }
      }
    };
    // több indulási sugár, majd a legjobb hossza alapján újraméretezés (legfeljebb 3 kör)
    for (const f of [3.6, 3.1, 2.7]) tryRadius(L / f);
    let r = L / 3.1;
    for (let it = 0; it < 3 && results.length; it++) {
      const best = results.reduce((a, b) => (a.score < b.score ? a : b));
      if (Math.abs(best.len - L) / L <= 0.05) break;
      r = (r * L) / best.len;
      tryRadius(r);
    }
    // oda-vissza, ha kör nem jön ki (pl. zsákutca-hálózat)
    if (!results.length && cands.length) {
      const far = cands.reduce((a, c) => (Math.abs(c.d - L / 2) < Math.abs(a.d - L / 2) ? c : a));
      const p = pathTo(base.prev, S, far.n);
      if (p) results.push(evaluate(p.concat(reverseSteps(p)), L));
    }
    results.sort((a, b) => a.score - b.score);
    LAST_ALL = results;
    const pick = [];
    for (const r_ of results) {
      if (pick.length >= 3) break;
      const similar = pick.some(p => {
        let inter = 0;
        for (const k of r_.keys) if (p.keys.has(k)) inter++;
        return inter / (r_.keys.size + p.keys.size - inter) > 0.55;
      });
      if (!similar) pick.push(r_);
    }
    // ha a hálózat miatt a legjobbak messze vannak a kért hossztól, legyen a hosszra legközelebbi
    // (kevés ismétlésű) kör is a választékban
    const near = results.filter(r_ => r_.reuse / r_.len <= 0.15)
      .reduce((a, b) => (!a || Math.abs(b.len - L) < Math.abs(a.len - L) ? b : a), null);
    if (near && !pick.includes(near) && pick.length
        && Math.abs(near.len - L) + 0.05 * L < Math.min(...pick.map(q => Math.abs(q.len - L)))) {
      if (pick.length >= 3) pick.pop();
      pick.push(near);
    }
    return pick;
  }

  let LAST_ALL = [];
  // --- magasságprofil és szint (a build_trails.py-val azonos simítás: tools/dem.py) ---
  function profileOf(steps) {
    const d = [], z = [];
    let off = 0;
    for (const s of steps) {
      const e = edge(s.e);
      let zz = e.z && e.z.length >= 2 ? e.z : null;
      if (!zz) { off += e.len; continue; }
      if (s.from !== e.u) zz = zz.slice().reverse();
      const n = zz.length, st = e.len / (n - 1);
      for (let i = d.length ? 1 : 0; i < n; i++) { d.push(off + i * st); z.push(zz[i]); }
      off += e.len;
    }
    return { d, z };
  }
  function ascentOf(prof) {
    const { d, z } = prof, n = z.length;
    if (n < 2) return { up: 0, down: 0, zs: z };
    const cfg = (G.meta && G.meta.ascent) || { smooth_m: 100, hyst_m: 3 };
    const w = Math.max(1, Math.round(cfg.smooth_m / (d[n - 1] / (n - 1) || 1)));
    const left = Math.floor(w / 2), get = i => z[Math.min(n - 1, Math.max(0, i))], zs = new Array(n);
    let sum = 0;
    for (let i = -left; i < -left + w; i++) sum += get(i);
    for (let i = 0; i < n; i++) { zs[i] = sum / w; sum += get(i - left + w) - get(i - left); }
    let up = 0, down = 0, ref = zs[0];
    for (let i = 1; i < n; i++) {
      const v = zs[i];
      if (v - ref >= cfg.hyst_m) { up += v - ref; ref = v; } else if (ref - v >= cfg.hyst_m) { down += ref - v; ref = v; }
    }
    return { up, down, zs };
  }
  // távolság (m) a profilon → pont a térképi vonalon (a két hossz kissé eltérhet → arányosítunk)
  function lineCum(line) { const c = [0]; for (let i = 1; i < line.length; i++) c.push(c[i - 1] + hav(line[i - 1], line[i])); return c; }
  function pointAt(p, dist) {
    const c = p.cum, target = (dist / (p.prof.d[p.prof.d.length - 1] || 1)) * c[c.length - 1];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < target) lo = m; else hi = m; }
    const f = c[hi] > c[lo] ? (target - c[lo]) / (c[hi] - c[lo]) : 0;
    return [p.line[lo][0] + (p.line[hi][0] - p.line[lo][0]) * f, p.line[lo][1] + (p.line[hi][1] - p.line[lo][1]) * f];
  }
  function zAtDist(prof, dist) {
    const { d, z } = prof;
    if (!d.length) return null;
    let lo = 0, hi = d.length - 1;
    if (dist <= d[0]) return z[0];
    if (dist >= d[hi]) return z[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] < dist) lo = m; else hi = m; }
    const f = (dist - d[lo]) / ((d[hi] - d[lo]) || 1);
    return z[lo] + (z[hi] - z[lo]) * f;
  }
  // --- útvonal geometria, jelzések, GPX ---------------------------------------
  function routeLine(steps) {
    const out = [];
    for (const s of steps) {
      const e = edge(s.e);
      const g = s.from === e.u ? e.geom : e.geom.slice().reverse();
      for (let i = out.length ? 1 : 0; i < g.length; i++) out.push(g[i]);
    }
    return out;
  }
  // Jelzés-sor: közös szakaszon azt a jelzést visszük tovább, amelyiken a legtovább maradsz;
  // a 300 m alatti darabok az előzőbe olvadnak.
  const codesOf = e => e.marks.split(',').filter(c => c && c !== '?');
  function markRuns(steps) {
    const E = steps.map(s => edge(s.e));
    const runs = [];
    let cur = null;
    for (let i = 0; i < E.length; i++) {
      const codes = codesOf(E[i]);
      let pick = cur && codes.includes(cur.code) ? cur.code : null;
      if (!pick) {
        let bestLen = -1;
        for (const c of codes) {
          let l = 0;
          for (let j = i; j < E.length && codesOf(E[j]).includes(c); j++) l += E[j].len;
          if (l > bestLen) { bestLen = l; pick = c; }
        }
      }
      pick = pick || '?';
      if (cur && cur.code === pick) cur.len += E[i].len;
      else { cur = { code: pick, len: E[i].len }; runs.push(cur); }
    }
    const out = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && (r.len < 300 || last.code === r.code)) last.len += r.len;
      else out.push({ ...r });
    }
    return out;
  }
  // magyar `jel` kód → színes turistajelzés
  const MCOL = { k: '#1c64c4', p: '#d6332e', z: '#2c8c3c', s: '#d9a000', l: '#7b3fb0', f: '#222' };
  const MSYM = { '': '▬', '+': '✚', 3: '▲', 4: '■', q: '●', l: '▙', c: '↺', b: 'Ω', m: 'M', t: 'T', tmp: '✞',
                 eml: '♜', pec: '♟', sziv: '♥', atl: '╱', atlv: '╲', x: '✕' };
  function markBadge(code) {
    if (code === '?') return '<span class="mk mk-q" title="jelzett út">•</span>';
    if (code === 't') return '<span class="mk" style="color:#222" title="tanösvény">T</span>';
    const col = MCOL[code[0]], rest = code.slice(1);
    if (!col || !(rest in MSYM)) return `<span class="mk mk-x">${KV.esc(code.toUpperCase())}</span>`;
    return `<span class="mk" style="color:${col}" title="${KV.esc(code)}">${MSYM[rest]}</span>`;
  }

  function gpx(p, name) {
    const line = p.line, total = p.cum[p.cum.length - 1] || 1, ptot = p.prof.d[p.prof.d.length - 1] || 0;
    const pts = line.map((q, i) => {
      const z = ptot ? zAtDist(p.prof, (p.cum[i] / total) * ptot) : null;
      return `<trkpt lat="${q[0].toFixed(6)}" lon="${q[1].toFixed(6)}">${z == null ? '' : `<ele>${z.toFixed(1)}</ele>`}</trkpt>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Kitűzővadász körtúra-tervező" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${KV.esc(name)}</name></metadata>
<trk><name>${KV.esc(name)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>`;
  }

  // --- térkép és felület -------------------------------------------------------
  const map = L.map('pmap', { zoomControl: false });
  KV.baseLayers(map);
  const me0 = KV.savedMe();
  map.setView(me0 || [47.6, 18.5], me0 ? 12 : 9);
  const canvas = L.canvas({ padding: 0.3 });
  const netLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  let startMarker = null, plans = [], sel = 0;
  const COLORS = ['#d9480f', '#1971c2', '#9c36b5'];

  let km = Number(localStorage.getItem('kv_planKm')) || 15;
  const syncKm = () => {
    km = Math.max(3, Math.min(60, km));
    $('#kmVal').textContent = km;
    $('#kmRange').value = km;
    localStorage.setItem('kv_planKm', km);
  };
  syncKm();
  on('#kmMinus', 'click', () => { km -= 1; syncKm(); });
  on('#kmPlus', 'click', () => { km += 1; syncKm(); });
  on('#kmRange', 'input', ev => { km = Number(ev.target.value); syncKm(); });

  const hint = (t, err) => { const h = $('#phint'); h.textContent = t; h.classList.toggle('err', !!err); };

  async function setStart(lat, lng) {
    hint('Turistautak betöltése…');
    const added = await ensureTiles(lat, lng, 6);
    drawNet(added);
    const st = snapStart(lat, lng);
    if (!st) {
      START = null; $('#planBtn').disabled = true;
      if (startMarker) map.removeLayer(startMarker);
      hint('Itt 1,5 km-en belül nincs jelzett turistaút. Koppints közelebb egy jelzett úthoz (vékony zöld vonalak).', true);
      return;
    }
    START = st;
    const icon = L.divIcon({ className: 'sf st', html: '<span>R</span>', iconSize: [26, 26], iconAnchor: [13, 13] });
    if (startMarker) startMarker.setLatLng(st.P); else startMarker = L.marker(st.P, { icon }).addTo(map);
    $('#planBtn').disabled = false;
    hint(st.d > 60 ? `Rajt a legközelebbi jelzett úton (${Math.round(st.d)} m-re a koppintástól). Állítsd be a távot!`
      : 'Rajt kijelölve. Állítsd be a távot, és tervezz!');
    routeLayer.clearLayers(); $('#pres').innerHTML = ''; plans = [];
  }

  function drawNet(geoms) {
    if (!geoms.length) return;
    L.polyline(geoms, { renderer: canvas, color: '#2e7a47', weight: 2, opacity: 0.55, interactive: false }).addTo(netLayer);
  }

  map.on('click', ev => setStart(ev.latlng.lat, ev.latlng.lng));
  on('#pLocate', 'click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      const p = [pos.coords.latitude, pos.coords.longitude];
      localStorage.setItem('kv_me', JSON.stringify({ p, t: Date.now() }));
      map.setView(p, 13);
      setStart(p[0], p[1]);
    }, () => hint('Nem sikerült a helymeghatározás.', true), { timeout: 10000, maximumAge: 600000 });
  });

  on('#planBtn', 'click', async () => {
    if (!START) return;
    const btn = $('#planBtn');
    btn.disabled = true; btn.textContent = 'Tervezés…';
    hint('Útvonalak keresése a jelzett utakon…');
    await new Promise(r => setTimeout(r, 30));    // a felirat kirajzolódjon
    try {
      const added = await ensureTiles(START.P[0], START.P[1], Math.max(6, km * 0.45 + 2));
      drawNet(added);
      // az új csempék után újraillesztünk (a virtuális rajt élei friss gráfra épüljenek)
      const st = snapStart(START.P[0], START.P[1]);
      if (st) START = st;
      const t0 = performance.now();
      plans = planLoops(START.S, km * 1000);
      const ms = Math.round(performance.now() - t0);
      if (!plans.length) { hint('Ebből a pontból nem találtam kört a jelzett utakon. Próbálj másik rajtot vagy rövidebb távot.', true); return; }
      plans.forEach(p => {
        p.line = routeLine(p.steps); p.runs = markRuns(p.steps); p.cum = lineCum(p.line);
        p.prof = profileOf(p.steps); Object.assign(p, ascentOf(p.prof));
        p.stem = 0;
        for (let i = 0, j = p.steps.length - 1; i < j && p.steps[i].e === p.steps[j].e; i++, j--) p.stem += edge(p.steps[i].e).len;
      });
      hint(`${plans.length} változat (${ms} ms). Válassz, vagy koppints új rajtpontra.`);
      sel = 0; drawPlans();
    } finally {
      btn.disabled = false; btn.textContent = 'Kör tervezése';
    }
  });

  // őszinte megjegyzések: rajt-zsákutca, máshol ismétlés, és ha nincs a kért hosszú tiszta kör
  function notes(p) {
    const L = km * 1000, out = [];
    const dev = (p.len - L) / L;
    if (Math.abs(dev) > 0.15) {
      out.push(`Itt nincs ${km} km-es tiszta kör a jelzett utakon — ez a legközelebbi ${dev > 0 ? 'hosszabb' : 'rövidebb'} változat.`);
    }
    if (p.stem >= 200) out.push(`A rajt zsákutcás jelzett úton van: az első és az utolsó ${KV.km(p.stem / 1000)} km ugyanaz az út (oda-vissza).`);
    const other = p.reuse - p.stem;
    if (other >= 200) out.push(`Még ${KV.km(other / 1000)} km-en ugyanazon az úton halad kétszer.`);
    return out.length ? `<ul class="pnotes">${out.map(t => `<li>${t}</li>`).join('')}</ul>` : '';
  }

  function drawPlans() {
    routeLayer.clearLayers();
    plans.forEach((p, i) => {
      if (i === sel) return;
      L.polyline(p.line, { color: COLORS[i], weight: 3, opacity: 0.45 }).on('click', () => { sel = i; drawPlans(); }).addTo(routeLayer);
    });
    const p = plans[sel];
    const line = L.polyline(p.line, { color: COLORS[sel], weight: 6, opacity: 0.9 }).addTo(routeLayer);
    const h = (p.len / 1000) / SPEED + (p.up || 0) / CLIMB;
    let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh += 1; mm = 0; }
    $('#pres').innerHTML = `
      <div class="popts">${plans.map((q, i) => `<button data-i="${i}" class="${i === sel ? 'on' : ''}" style="--c:${COLORS[i]}">${'ABC'[i]} · ${KV.km(q.len / 1000)} km<small>↗ ${Math.round(q.up || 0)} m</small></button>`).join('')}</div>
      <div class="pstat"><b>${KV.km(p.len / 1000)} km</b> · <b>↗ ${Math.round(p.up || 0)} m</b> ↘ ${Math.round(p.down || 0)} m · ≈ ${hh} ó ${mm} p${p.reuse < 100 ? ' · <span class="ok">tiszta kör</span>' : ''}</div>
      <div class="pprof"><svg id="ppsvg" preserveAspectRatio="none"></svg><div class="ppinfo" id="ppinfo"></div></div>
      ${notes(p)}
      <div class="pmarks">${p.runs.map(r => `<span class="run">${markBadge(r.code)}<small>${KV.km(r.len / 1000)}</small></span>`).join('<i>›</i>')}</div>
      <div class="pact"><button class="btn-line sm" id="gpxBtn">GPX letöltés</button>
        <a class="btn-line sm" href="https://www.google.com/maps/dir/?api=1&destination=${START.P[0].toFixed(6)},${START.P[1].toFixed(6)}" target="_blank" rel="noopener">Odajutás a rajthoz</a></div>`;
    drawProfile(p, COLORS[sel]);
    // a térképet a panel kirajzolása UTÁN igazítjuk, hogy a kör ne csússzon a panel alá
    map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, $('#ppanel').offsetHeight + 20] });
    $('#pres').querySelectorAll('.popts button').forEach(b => b.addEventListener('click', () => { sel = Number(b.dataset.i); drawPlans(); }));
    $('#gpxBtn').addEventListener('click', () => {
      const name = `Kitűzővadász kör ${KV.km(p.len / 1000)} km`;
      const blob = new Blob([gpx(p, name)], { type: 'application/gpx+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kor_${Math.round(p.len / 1000)}km.gpx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  // --- profil-rajz: érintésre/húzásra a pont a térképen ---
  let cursor = null;
  function drawProfile(p, color) {
    const svg = $('#ppsvg'), info = $('#ppinfo');
    if (!svg || !p.prof.d.length) return;
    const { d } = p.prof, zs = p.zs || p.prof.z, n = zs.length;
    const W = 1000, H = 160, P = 3, maxD = d[n - 1] || 1;
    let lo = Math.min(...zs), hi = Math.max(...zs);
    const span = Math.max(hi - lo, 60); lo -= span * 0.08; hi = lo + span * 1.2;
    const x = v => P + (v / maxD) * (W - 2 * P), y = v => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    const path = zs.map((v, i) => `${i ? 'L' : 'M'}${x(d[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<path d="${path}L${x(maxD)},${H}L${x(0)},${H}Z" fill="${color}" opacity=".18"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/>
      <line id="ppcur" x1="0" x2="0" y1="0" y2="${H}" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/>`;
    const base = `${Math.round(Math.min(...p.prof.z))}–${Math.round(Math.max(...p.prof.z))} m tszf. · húzd az ujjad a profilon`;
    info.textContent = base;
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const dv = Math.max(0, Math.min(maxD, (cx / r.width) * maxD));
      const zv = zAtDist(p.prof, dv);
      const ln = svg.querySelector('#ppcur');
      ln.setAttribute('x1', x(dv)); ln.setAttribute('x2', x(dv)); ln.setAttribute('opacity', '.7');
      info.textContent = `${KV.km(dv / 1000)} km · ${Math.round(zv)} m tszf.`;
      const ll = pointAt(p, dv);
      if (!cursor) cursor = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
      else cursor.setLatLng(ll).setStyle({ fillColor: color });
    };
    const end = () => {
      info.textContent = base;
      const ln = svg.querySelector('#ppcur'); if (ln) ln.setAttribute('opacity', '0');
      if (cursor) { map.removeLayer(cursor); cursor = null; }
    };
    svg.onmousemove = move; svg.ontouchstart = move; svg.ontouchmove = ev => { ev.preventDefault(); move(ev); };
    svg.onmouseleave = end; svg.ontouchend = end;
  }

  // tesztekhez / konzolhoz
  // elemzés teszthez: hossz, ismétlés, és a „visszafordulások” (egymás utáni oda-vissza él) száma
  const countU = st => st.reduce((n, s, i) => n + (i && ekey(st[i - 1].e) === ekey(s.e) && st[i - 1].from === s.to ? 1 : 0), 0);
  window.KVPlanner = { setStart, planLoops: (L_) => planLoops(START.S, L_), G,
    lastAll: () => LAST_ALL.map(p => ({ len: Math.round(p.len), reuse: Math.round(p.reuse) })),
    lastPlans: () => (plans.length ? window.KVPlanner.analyze(plans) : null),
    profiles: () => plans.map(p => ({ len: Math.round(p.len), up: Math.round(p.up || 0), down: Math.round(p.down || 0), n: p.prof.z.length })),
    analyze: ps => ps.map(p => {
      let stem = 0;
      for (let i = 0, j = p.steps.length - 1; i < j && p.steps[i].e === p.steps[j].e; i++, j--) stem += edge(p.steps[i].e).len;
      return { len: Math.round(p.len), reuse: Math.round(p.reuse), uturns: countU(p.steps), stem: Math.round(stem) };
    }) };
})();
