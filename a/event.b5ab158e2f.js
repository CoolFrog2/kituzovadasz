/* Kitűzővadász — esemény-oldal: térkép a távokkal + szintprofil */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const EV = window.EV;
  const COLORS = ['#d9480f', '#1971c2', '#2b8a3e', '#9c36b5', '#e8590c', '#0c8599', '#c2255c', '#5f3dc4', '#66a80f', '#495057'];
  const color = i => COLORS[i % COLORS.length];

  // visszaszámlálás kliensoldalon (a statikus export napja után is pontos legyen)
  const cd = $('#cd');
  if (cd) cd.textContent = KV.countdown({ date: cd.dataset.date, end: cd.dataset.end || null });

  // távolság tőled (ha a főoldalon már engedélyezted a helyadatot)
  const me = KV.savedMe();
  if (me) {
    const ds = EV.starts.filter(s => s && s.lat != null).map(s => KV.haversine(me, [s.lat, s.lng]));
    const el = $('#medist');
    if (ds.length && el) {
      el.innerHTML = `<svg><use href="#i-pin"/></svg>${KV.distTxt(Math.min(...ds))}-re tőled`;
      el.title = 'légvonalban, a legközelebbi rajtig';
      el.hidden = false;
    }
  }

  // kedvenc gomb
  const fb = $('#favBtn');
  if (fb) {
    fb.classList.toggle('on', KV.favs().has(EV.slug));
    fb.addEventListener('click', () => fb.classList.toggle('on', KV.toggleFav(EV.slug)));
  }

  // megosztás: név + lényeg + a publikus link (helyi böngészésből is)
  const sb = $('#shareBtn');
  if (sb) sb.addEventListener('click', () => KV.share({
    title: sb.dataset.title || EV.name, text: sb.dataset.text || EV.name, url: sb.dataset.url || location.href }));

  // térkép
  const map = L.map('emap', { zoomControl: false, scrollWheelZoom: false });
  KV.baseLayers(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const bounds = L.latLngBounds([]);
  const seen = [];
  const dot = (cls, label) => L.divIcon({ className: 'sf ' + cls, html: `<span>${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
  EV.starts.forEach((s, i) => {
    if (!s || s.lat == null) return;
    bounds.extend([s.lat, s.lng]);
    if (!seen.some(p => KV.haversine(p, [s.lat, s.lng]) < 0.15)) {
      seen.push([s.lat, s.lng]);
      L.marker([s.lat, s.lng], { icon: dot('st', 'R') }).bindPopup(`<b>Rajt</b><br>${KV.esc(s.name)}`).addTo(map);
    }
  });
  EV.finishes.forEach(f => {
    if (!f || f.lat == null) return;
    bounds.extend([f.lat, f.lng]);
    if (!seen.some(p => KV.haversine(p, [f.lat, f.lng]) < 0.15)) {
      seen.push([f.lat, f.lng]);
      L.marker([f.lat, f.lng], { icon: dot('fi', 'C') }).bindPopup(`<b>Cél</b><br>${KV.esc(f.name)}`).addTo(map);
    }
  });
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.3), { maxZoom: 13 }); else map.setView([47.2, 19.4], 7);

  const lines = {}, profiles = {};
  let active = null, cursor = null;

  function fitTracks() {
    const b = L.latLngBounds([]);
    Object.values(lines).forEach(l => b.extend(l.getBounds()));
    if (bounds.isValid()) b.extend(bounds);
    if (b.isValid()) map.fitBounds(b, { padding: [16, 16] });
  }

  function select(i) {
    active = i;
    Object.entries(lines).forEach(([k, l]) => {
      const on = Number(k) === i;
      l.setStyle({ weight: on ? 5 : 3, opacity: on ? 0.95 : 0.45 });
      if (on) l.bringToFront();
    });
    document.querySelectorAll('#ptabs button').forEach(b => b.classList.toggle('on', Number(b.dataset.i) === i));
    drawProfile(i);
  }

  Promise.all(EV.tracks.map(i => fetch(`${window.B}/api/track/${EV.slug}/${i}.json`).then(r => r.ok ? r.json() : null).then(d => [i, d])))
    .then(rows => {
      const ok = rows.filter(([, d]) => d && d.line.length > 1);
      if (!ok.length) return;
      ok.forEach(([i, d]) => {
        lines[i] = L.polyline(d.line, { color: color(i), weight: 3, opacity: 0.6 }).addTo(map)
          .on('click', () => select(i));
        profiles[i] = d;
      });
      fitTracks();
      const tabs = $('#ptabs');
      tabs.innerHTML = ok.map(([i]) => `<button data-i="${i}" style="--c:${color(i)}">${KV.esc(EV.routes[i])}</button>`).join('');
      tabs.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) select(Number(b.dataset.i)); });
      $('#profile').hidden = false;
      select(ok[ok.length - 1][0]);
    });

  document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.show);
    if (lines[i]) { select(i); map.fitBounds(lines[i].getBounds(), { padding: [16, 16] }); $('#emap').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));

  // szintprofil
  function drawProfile(i) {
    const d = profiles[i], svg = $('#psvg'), info = $('#pinfo');
    const pts = (d.prof || []).map((p, k) => [p[0], p[1], k]).filter(p => p[1] != null);
    if (pts.length < 2) {
      svg.innerHTML = ''; svg.style.display = 'none';
      info.textContent = `${KV.km(d.km)} km (GPX alapján) — szintadat nincs a GPX-ben`;
      return;
    }
    svg.style.display = '';
    const W = 1000, H = 220, P = 4;
    const maxD = pts[pts.length - 1][0];
    const eles = pts.map(p => p[1]);
    let lo = Math.min(...eles), hi = Math.max(...eles);
    const span = Math.max(hi - lo, 80); lo = lo - span * 0.08; hi = lo + span * 1.2;
    const x = v => P + (v / maxD) * (W - 2 * P), y = v => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<path d="${path}L${x(maxD)},${H}L${x(0)},${H}Z" fill="${color(i)}" opacity=".18"/>
      <path d="${path}" fill="none" stroke="${color(i)}" stroke-width="3" vector-effect="non-scaling-stroke"/>
      <line id="pcur" x1="0" x2="0" y1="0" y2="${H}" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/>`;
    const base = `${KV.km(d.km)} km · ↗ ${d.ascent ?? '?'} m · ${Math.round(Math.min(...eles))}–${Math.round(Math.max(...eles))} m`;
    info.textContent = base + ' (GPX)';

    const move = ev => {
      const r = svg.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const dv = Math.max(0, Math.min(maxD, (cx / r.width) * maxD));
      let k = 0; while (k < pts.length - 1 && pts[k + 1][0] < dv) k++;
      const p = pts[k];
      const ln = svg.querySelector('#pcur');
      ln.setAttribute('x1', x(p[0])); ln.setAttribute('x2', x(p[0])); ln.setAttribute('opacity', '.7');
      info.textContent = `${KV.km(p[0])} km · ${p[1]} m tszf.`;
      const ll = d.line[Math.min(p[2], d.line.length - 1)];
      if (!cursor) cursor = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: color(i), fillOpacity: 1 }).addTo(map);
      else cursor.setLatLng(ll).setStyle({ fillColor: color(i) });
    };
    const end = () => { info.textContent = base + ' (GPX)'; const ln = svg.querySelector('#pcur'); if (ln) ln.setAttribute('opacity', '0'); if (cursor) { map.removeLayer(cursor); cursor = null; } };
    svg.onmousemove = move; svg.ontouchstart = move; svg.ontouchmove = ev => { ev.preventDefault(); move(ev); };
    svg.onmouseleave = end; svg.ontouchend = end;
  }
})();
