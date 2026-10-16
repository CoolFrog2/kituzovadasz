/* Kitűzővadász — főoldal: térkép + lista + szűrők */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  // null-biztos: ha a (gyorsítótárból jött) HTML-ben nincs meg egy elem, csak az a funkció marad ki
  const on = (sel, ev, fn, opt) => { const el = $(sel); if (el) el.addEventListener(ev, fn, opt); };
  const setText = (sel, t) => { const el = $(sel); if (el) el.textContent = t; };

  const KM_INF = 110, ASC_INF = 3100, PRICE_INF = 16000;
  const DEF = { when: 'all', from: '', to: '', kmMin: 0, kmMax: KM_INF, ascMax: ASC_INF, round: 'all', aw: [],
    yearly: false, night: 'all', radius: 0, walkin: false, runok: false, huOnly: false, favOnly: false,
    showCanceled: false, priceMax: PRICE_INF, q: '', sort: 'date', zsolti: false };
  const EUR = 400; // EUR→HUF durva átváltás az árszűrőhöz

  let F = load();
  let EVENTS = [];
  let me = loadMe();
  let view = 'map';

  function load() {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem('kv_filters') || '{}')); } catch { return { ...DEF }; }
  }
  function save() { localStorage.setItem('kv_filters', JSON.stringify(F)); }
  function loadMe() {
    try { const m = JSON.parse(localStorage.getItem('kv_me') || 'null'); return m && Date.now() - m.t < 6 * 3600e3 ? m.p : null; } catch { return null; }
  }

  // --- Zsolti kompatibilitás mód ---------------------------------------------
  // Zsolti minden második hétvégén dolgozik. Viszonyítási pont: 2026-10-17 (szombat)
  // hétvégéje FOGLALT → az ettől páratlan számú héttel későbbi hétvégék szabadok.
  // Csak a szombaton/vasárnap INDULÓ túrák számítanak (a péntek esti rajthoz péntek kéne).
  const ZS_BUSY_SAT = Date.UTC(2026, 9, 17) / 864e5;
  const dayNum = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  function zsoltiOk(s) {
    const dn = dayNum(s), dow = new Date(dn * 864e5).getUTCDay();
    if (dow !== 6 && dow !== 0) return false;
    const k = Math.round(((dow === 6 ? dn : dn - 1) - ZS_BUSY_SAT) / 7);
    return ((k % 2) + 2) % 2 === 1;
  }
  function zsoltiNext(count) {
    const t = new Date(); const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 864e5;
    const M = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
    const out = [];
    for (let d = today - 1; out.length < count && d < today + 400; d++) {
      const sat = new Date(d * 864e5);
      if (sat.getUTCDay() !== 6 || d + 1 < today) continue;
      const iso = sat.toISOString().slice(0, 10);
      if (!zsoltiOk(iso)) continue;
      const sun = new Date((d + 1) * 864e5);
      out.push(sat.getUTCMonth() === sun.getUTCMonth()
        ? `${M[sat.getUTCMonth()]} ${sat.getUTCDate()}–${sun.getUTCDate()}.`
        : `${M[sat.getUTCMonth()]} ${sat.getUTCDate()}. – ${M[sun.getUTCMonth()]} ${sun.getUTCDate()}.`);
    }
    return out;
  }
  setText('#zsoltiInfo', 'Csak a szabad hétvégék: ' + zsoltiNext(3).join(', ') + ' …');

  // --- szűrés ---------------------------------------------------------------
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function weekendRange() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const dow = t.getDay(); // 0 V .. 6 Szo
    const fri = new Date(t);
    if (dow === 0) fri.setDate(t.getDate() - 2); else if (dow === 6) fri.setDate(t.getDate() - 1); else fri.setDate(t.getDate() + (5 - dow));
    const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return [iso(fri < t ? t : fri), iso(sun)];
  }

  function routeOk(r) {
    if (r.km != null && (r.km < F.kmMin || (F.kmMax < KM_INF && r.km > F.kmMax))) return false;
    if (F.ascMax < ASC_INF && r.asc != null && r.asc > F.ascMax) return false;
    if (F.round === 'loop' && r.round !== true) return false;
    if (F.round === 'ab' && r.round !== false) return false;
    if (F.aw.length && !r.aw.some(a => F.aw.includes(a))) return false;
    if (F.night === 'day' && r.night) return false;
    if (F.night === 'night' && !r.night) return false;
    if (F.walkin && r.pre === 'kotelezo') return false;
    if (F.runok && !r.run) return false;
    if (F.priceMax < PRICE_INF && r.price != null) {
      const huf = r.cur === 'EUR' ? r.price * EUR : r.price;
      if (huf > F.priceMax) return false;
    }
    if (F.radius > 0 && me && r.lat != null && KV.haversine(me, [r.lat, r.lng]) > F.radius) return false;
    return true;
  }

  function filtered() {
    const favs = KV.favs();
    let range = null;
    if (F.when === 'weekend') range = weekendRange();
    const qn = norm(F.q.trim());
    const out = [];
    const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    for (const e of EVENTS) {
      if ((e.end || e.date) < todayIso) continue; // statikus exportnál a lezajlottak kiszűrése
      if (e.status === 'elmarad' && !F.showCanceled) continue;
      const end = e.end || e.date;
      if (range && (end < range[0] || e.date > range[1])) continue;
      if ((F.when === '30' || F.when === '90') && KV.daysUntil(e.date) > Number(F.when)) continue;
      if (F.when === 'custom') {
        if (F.from && end < F.from) continue;
        if (F.to && e.date > F.to) continue;
      }
      if (F.zsolti && !zsoltiOk(e.date)) continue;
      if (F.yearly && !e.yearly) continue;
      if (F.huOnly && e.country !== 'HU') continue;
      if (F.favOnly && !favs.has(e.slug)) continue;
      if (qn && !e._q.includes(qn)) continue;
      const hit = e.routes.map(routeOk);
      if (!hit.some(Boolean)) continue;
      let dist = null;
      if (me) {
        for (let i = 0; i < e.routes.length; i++) {
          const r = e.routes[i];
          if (hit[i] && r.lat != null) {
            const d = KV.haversine(me, [r.lat, r.lng]);
            if (dist == null || d < dist) dist = d;
          }
        }
      }
      out.push({ e, hit, dist });
    }
    if (F.sort === 'near' && me) out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
    else if (F.sort === 'km') out.sort((a, b) => maxKm(b) - maxKm(a) || a.e.date.localeCompare(b.e.date));
    return out;
  }
  const maxKm = x => Math.max(...x.e.routes.filter((r, i) => x.hit[i]).map(r => r.km || 0));

  function activeCount() {
    let n = 0;
    for (const k of Object.keys(DEF)) {
      if (k === 'sort' || k === 'q' || k === 'from' || k === 'to') continue;
      const a = F[k], b = DEF[k];
      if (Array.isArray(a) ? a.length : a !== b) n++;
    }
    return n;
  }

  // --- térkép --------------------------------------------------------------
  const map = L.map('map', { zoomControl: false, attributionControl: true });
  // álló telefonon a teljes ország csak nagyon kicsiben férne ki — inkább a közepét mutatjuk
  if (window.innerWidth < 700) map.setView(me || [47.2, 19.3], me ? 9 : 7);
  else map.fitBounds([[45.75, 16.1], [48.6, 22.9]], { padding: [4, 4] });
  KV.baseLayers(map);
  const cluster = L.markerClusterGroup({
    maxClusterRadius: 42, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: c => L.divIcon({ html: `<span>${c.getChildCount()}</span>`, className: 'cl', iconSize: [38, 38] }),
  });
  map.addLayer(cluster);
  let meMarker = null;

  function pinIcon(e, fav) {
    const b = KV.dateBox(e.date);
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin ${KV.soon(e.date)}${e.status === 'elmarad' ? ' canceled' : ''}"><b>${b.d}</b><i>${b.m}</i>${fav ? '<em>★</em>' : ''}</div>`,
      iconSize: [40, 44], iconAnchor: [20, 44],
    });
  }

  function drawMap(rows) {
    cluster.clearLayers();
    const favs = KV.favs();
    const markers = [];
    for (const { e, hit } of rows) {
      const spots = [];
      e.routes.forEach((r, i) => {
        if (!hit[i] || r.lat == null) return;
        if (!spots.some(p => KV.haversine(p, [r.lat, r.lng]) < 1.5)) spots.push([r.lat, r.lng]);
      });
      for (const p of spots) {
        const m = L.marker(p, { icon: pinIcon(e, favs.has(e.slug)), keyboard: false });
        m.on('click', () => openPeek(e, hit, p));
        markers.push(m);
      }
    }
    cluster.addLayers(markers);
  }

  function openPeek(e, hit) {
    const el = $('#peek');
    el.innerHTML = `<button class="peek-x" aria-label="Bezár">×</button>` + card({ e, hit, dist: me ? nearest(e, hit) : null }, true);
    el.hidden = false;
    el.querySelector('.peek-x').onclick = closePeek;
  }
  function closePeek() { $('#peek').hidden = true; }
  function nearest(e, hit) {
    let d = null;
    e.routes.forEach((r, i) => { if (hit[i] && r.lat != null) { const x = KV.haversine(me, [r.lat, r.lng]); if (d == null || x < d) d = x; } });
    return d;
  }
  map.on('click', closePeek);

  // --- lista ---------------------------------------------------------------
  function card({ e, hit, dist }, inPeek = false) {
    const b = KV.dateBox(e.date);
    const fav = KV.favs().has(e.slug);
    const dists = e.routes.map((r, i) => `<span class="d${hit[i] ? ' on' : ''}${r.night ? ' nt' : ''}">${KV.km(r.km)}</span>`).join('');
    const aw = new Set(); e.routes.forEach((r, i) => hit[i] && r.aw.forEach(a => aw.add(a)));
    const meta = [e.region.slice(0, 2).join(', '), KV.countdown(e)];
    // a távolság a sor ELEJÉRE kerül, hogy hosszú tájnévnél se vágódjon le
    const dHtml = dist != null ? `<span class="me-d" title="légvonalban a helyzetedtől"><svg><use href="#i-pin"/></svg>${KV.distTxt(dist)}</span>` : '';
    const multi = e.end && e.end !== e.date ? `<i class="multi">+${KV.daysUntil(e.end) - KV.daysUntil(e.date)}</i>` : '';
    return `<a class="card${e.status === 'elmarad' ? ' canceled' : ''}${inPeek ? ' in-peek' : ''}" href="${window.B}/e/${e.slug}">
      <div class="dbox ${KV.soon(e.date)}"><b>${b.d}</b><span>${b.m}</span><i>${b.w}</i>${multi}</div>
      <div class="cbody">
        <h4>${e.status === 'elmarad' ? '<span class="tag-x">ELMARAD</span> ' : ''}${KV.esc(e.name)}</h4>
        <div class="meta">${dHtml}${KV.esc(meta.filter(Boolean).join(' · '))}</div>
        <div class="dists">${dists}<small>km</small></div>
        <div class="awline">${KV.awardIcons([...aw])}<span>${KV.esc(e.aws || '')}</span></div>
      </div>
      <button class="star${fav ? ' on' : ''}" data-slug="${e.slug}" aria-label="Csillagozás"><svg><use href="#i-star"/></svg></button>
    </a>`;
  }

  function drawList(rows) {
    const el = $('#list');
    if (!rows.length) {
      el.innerHTML = `<div class="empty"><p>Ezekkel a szűrőkkel nincs találat.</p><button class="btn-line" id="emptyReset">Szűrők törlése</button></div>`;
      $('#emptyReset').onclick = reset;
      return;
    }
    let html = '', last = '';
    for (const row of rows) {
      if (F.sort === 'date') {
        const mt = KV.monthTitle(row.e.date);
        if (mt !== last) { html += `<h2 class="month">${mt}</h2>`; last = mt; }
      }
      html += card(row);
    }
    el.innerHTML = html;
  }

  document.addEventListener('click', ev => {
    const s = ev.target.closest('.star');
    if (!s) return;
    ev.preventDefault(); ev.stopPropagation();
    const on = KV.toggleFav(s.dataset.slug);
    $$(`.star[data-slug="${s.dataset.slug}"]`).forEach(x => x.classList.toggle('on', on));
    if (F.favOnly) refresh(); else drawMap(lastRows);
  });

  // --- frissítés -----------------------------------------------------------
  let lastRows = [];
  function refresh() {
    save();
    lastRows = filtered();
    const n = lastRows.length;
    $('#count').innerHTML = `<b>${n}</b> túra${F.zsolti ? ' <span class="zs-on">Zsolti-mód</span>' : ''}`;
    $('#applyCount').textContent = n;
    const ac = activeCount();
    $('#fbadge').hidden = !ac; $('#fbadge').textContent = ac;
    drawMap(lastRows);
    drawList(lastRows);
    syncControls();
    syncLocBanner();
  }

  // --- vezérlők ------------------------------------------------------------
  function syncControls() {
    $$('[data-f]').forEach(g => {
      const k = g.dataset.f, multi = g.hasAttribute('data-multi');
      g.querySelectorAll('button').forEach(b => {
        const v = b.dataset.v;
        const on = multi ? F[k].includes(v) : String(F[k]) === v;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      });
    });
    $('#customDates').hidden = F.when !== 'custom';
    $('#dFrom').value = F.from; $('#dTo').value = F.to;
    $('#kmMin').value = F.kmMin; $('#kmMax').value = F.kmMax;
    $('#kmOut').textContent = F.kmMin === 0 && F.kmMax >= KM_INF ? 'bármennyi' :
      F.kmMax >= KM_INF ? `${F.kmMin} km felett` : `${F.kmMin}–${F.kmMax} km`;
    const lo = F.kmMin / KM_INF * 100, hi = F.kmMax / KM_INF * 100;
    $('#kmRange').style.setProperty('--lo', lo + '%'); $('#kmRange').style.setProperty('--hi', hi + '%');
    $('#ascMax').value = F.ascMax; $('#ascOut').textContent = F.ascMax >= ASC_INF ? 'bármennyi' : `${F.ascMax} m`;
    $('#priceMax').value = F.priceMax; $('#priceOut').textContent = F.priceMax >= PRICE_INF ? 'bármennyi' : KV.ft(F.priceMax);
    for (const k of ['yearly', 'walkin', 'runok', 'huOnly', 'favOnly', 'showCanceled', 'zsolti']) { const el = $('#' + k); if (el) el.checked = F[k]; }
    $$('[data-preset="km"] button').forEach(b => {
      const [a, c] = b.dataset.v.split('-').map(Number); b.classList.toggle('on', F.kmMin === a && F.kmMax === c);
    });
    $('#radiusChips').hidden = !me;
    $('#btnGeo').textContent = me ? 'Helyzet frissítése' : 'Helyzetem használata';
    $('#sort').value = F.sort;
    $('#sort option[value="near"]').disabled = !me;
    if ($('#q').value !== F.q) $('#q').value = F.q;
  }

  $$('[data-f]').forEach(g => g.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const k = g.dataset.f, v = b.dataset.v;
    if (g.hasAttribute('data-multi')) F[k] = F[k].includes(v) ? F[k].filter(x => x !== v) : [...F[k], v];
    else F[k] = (k === 'radius') ? Number(v) : v;
    refresh();
  }));
  $$('[data-preset="km"] button').forEach(b => b.addEventListener('click', () => {
    const [a, c] = b.dataset.v.split('-').map(Number);
    if (F.kmMin === a && F.kmMax === c) { F.kmMin = 0; F.kmMax = KM_INF; } else { F.kmMin = a; F.kmMax = c; }
    refresh();
  }));
  on('#kmMin', 'input', ev => { F.kmMin = Math.min(Number(ev.target.value), F.kmMax - 1); refresh(); });
  on('#kmMax', 'input', ev => { F.kmMax = Math.max(Number(ev.target.value), F.kmMin + 1); refresh(); });
  on('#ascMax', 'input', ev => { F.ascMax = Number(ev.target.value); refresh(); });
  on('#priceMax', 'input', ev => { F.priceMax = Number(ev.target.value); refresh(); });
  on('#dFrom', 'change', ev => { F.from = ev.target.value; refresh(); });
  on('#dTo', 'change', ev => { F.to = ev.target.value; refresh(); });
  for (const k of ['yearly', 'walkin', 'runok', 'huOnly', 'favOnly', 'showCanceled', 'zsolti'])
    on('#' + k, 'change', ev => { F[k] = ev.target.checked; refresh(); });
  let qt; on('#q', 'input', ev => { clearTimeout(qt); qt = setTimeout(() => { F.q = ev.target.value; refresh(); }, 150); });
  on('#sort', 'change', ev => { F.sort = ev.target.value; refresh(); });

  function reset() { const keepSort = F.sort; F = { ...DEF, sort: keepSort === 'near' && me ? 'near' : 'date' }; refresh(); }
  on('#btnReset', 'click', reset);
  on('#btnApply', 'click', () => show('map'));

  // --- helymeghatározás ----------------------------------------------------
  // A helyzet csak a böngészőben marad (localStorage), sehova nem küldjük el.
  function locate(thenFit, silent) {
    if (!navigator.geolocation) { if (!silent) alert('Ez a böngésző nem ad helyadatot.'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      me = [pos.coords.latitude, pos.coords.longitude];
      localStorage.setItem('kv_me', JSON.stringify({ p: me, t: Date.now() }));
      drawMe();
      if (thenFit) map.setView(me, 10);
      refresh();
    }, err => {
      geoState = err.code === 1 ? 'denied' : geoState;
      syncLocBanner();
      if (!silent) alert(err.code === 1
        ? 'A helyadat-hozzáférés le van tiltva. A böngésző beállításaiban engedélyezheted ennek az oldalnak.'
        : 'Nem sikerült a helymeghatározás: ' + err.message);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  }

  // Ha a böngésző már kapott engedélyt, kérdezés nélkül frissítjük a helyzetet.
  let geoState = 'prompt';
  async function autoLocate() {
    if (!navigator.geolocation || !navigator.permissions) return;
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      geoState = st.state;
      if (st.state === 'granted') locate(false, true);
      st.onchange = () => { geoState = st.state; if (st.state === 'granted') locate(false, true); syncLocBanner(); };
    } catch { /* régi böngésző: marad a gomb */ }
    syncLocBanner();
  }

  // Lista teteji sáv: „Mutasd, milyen messze vannak” — csak ha még nincs helyzet és nincs tiltva.
  function syncLocBanner() {
    const el = $('#locBanner');
    if (!el) return;
    el.hidden = !!me || geoState === 'denied' || localStorage.getItem('kv_locDismiss') === '1';
  }
  on('#locYes', 'click', () => locate(false, false));
  on('#locNo', 'click', () => { localStorage.setItem('kv_locDismiss', '1'); syncLocBanner(); });
  function drawMe() {
    if (!me) return;
    if (meMarker) meMarker.setLatLng(me);
    else meMarker = L.marker(me, { icon: L.divIcon({ className: 'me', html: '<i></i>', iconSize: [18, 18] }), interactive: false }).addTo(map);
  }
  on('#btnLocate', 'click', () => { if (me) { map.setView(me, 10); } locate(!me); });
  on('#btnGeo', 'click', () => { locate(false); if (!F.radius) F.radius = 100; });

  // --- nézetek -------------------------------------------------------------
  function show(v, push = true) {
    view = v;
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'map') setTimeout(() => map.invalidateSize(), 0);
    if (v !== 'map') closePeek();
    // a hash NEM egyezhet elem-id-vel (#list), különben a böngésző odagörget
    if (push) history.replaceState(null, '', v === 'map' ? location.pathname : '#' + (v === 'list' ? 'lista' : 'szurok'));
    sessionStorage.setItem('kv_view', v);
  }
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  // --- indulás -------------------------------------------------------------
  fetch(`${window.B}/api/events.json`).then(r => r.json()).then(d => {
    EVENTS = d.events.map(e => Object.assign(e, {
      _q: norm([e.name, e.region.join(' '), e.tags.join(' '), e.routes.map(r => `${r.n} ${r.sn || ''} ${r.fn || ''}`).join(' ')].join(' ')),
    }));
    drawMe();
    refresh();
    autoLocate();
    const h = (location.hash || '').slice(1);
    const want = ({ lista: 'list', list: 'list', szurok: 'filter', filter: 'filter' })[h] || sessionStorage.getItem('kv_view');
    if (h === 'list' || h === 'filter') history.replaceState(null, '', '#' + (h === 'list' ? 'lista' : 'szurok'));
    if (want === 'list' || want === 'filter') show(want, false);
    const sy = sessionStorage.getItem('kv_listScroll');
    if (sy && view === 'list') requestAnimationFrame(() => { $('#view-list').scrollTop = Number(sy); });
  }).catch(() => { $('#count').textContent = 'hiba'; });

  on('#view-list', 'scroll', ev => sessionStorage.setItem('kv_listScroll', ev.target.scrollTop), { passive: true });
})();
