/* Kitűzővadász — közös segédek (index + esemény oldal) */
'use strict';

const KV = (() => {
  const MONTH = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
  const MONTH_LONG = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  const DAY = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  const DAY_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
  const AWARD = { kituzo: 'Kitűző', jelveny: 'Jelvény', erem: 'Érem', oklevel: 'Oklevél', egyeb: 'Egyéb' };
  const AWARD_ORDER = ['erem', 'jelveny', 'kituzo', 'egyeb', 'oklevel'];

  const parse = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const daysUntil = s => Math.round((parse(s) - today()) / 86400000);

  function dateShort(s) { const d = parse(s); return `${MONTH[d.getMonth()]} ${d.getDate()}.`; }
  function dateBox(s) { const d = parse(s); return { m: MONTH[d.getMonth()].replace('.', ''), d: d.getDate(), w: DAY_SHORT[d.getDay()] }; }
  function monthTitle(s) { const d = parse(s); return `${d.getFullYear()}. ${MONTH_LONG[d.getMonth()]}`; }
  function weekday(s) { return DAY[parse(s).getDay()]; }

  function countdown(ev) {
    const n = daysUntil(ev.date), end = ev.end ? daysUntil(ev.end) : n;
    if (end < 0) return 'lezajlott';
    if (n <= 0) return 'ma';
    if (n === 1) return 'holnap';
    if (n < 14) return `${n} nap múlva`;
    if (n < 60) return `${Math.round(n / 7)} hét múlva`;
    return `${Math.round(n / 30.4)} hónap múlva`;
  }

  // soonness → marker szín osztály
  function soon(s) {
    const n = daysUntil(s);
    if (n <= 7) return 's1';
    if (n <= 31) return 's2';
    if (n <= 92) return 's3';
    return 's4';
  }

  const km = x => x == null ? '—' : String(Math.round(x * 10) / 10).replace('.', ',');
  const ft = n => n == null ? '' : n === 0 ? 'ingyenes' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ft`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function awardIcons(list, labels = false) {
    const set = new Set(list);
    return AWARD_ORDER.filter(a => set.has(a)).map(a =>
      `<span class="aw aw-${a}" title="${AWARD[a]}"><svg><use href="#i-${a}"/></svg>${labels ? AWARD[a] : ''}</span>`).join('');
  }

  function haversine(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // kedvencek (localStorage)
  const FAV_KEY = 'kv_fav';
  const favs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); } };
  function toggleFav(slug) {
    const f = favs(); f.has(slug) ? f.delete(slug) : f.add(slug);
    localStorage.setItem(FAV_KEY, JSON.stringify([...f]));
    return f.has(slug);
  }

  const TILES = {
    osm: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }],
    topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxZoom: 17, attribution: '© OSM, <a href="https://opentopomap.org">OpenTopoMap</a>' }],
    trails: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
      { maxZoom: 18, opacity: 0.75, attribution: '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>' }],
  };
  function baseLayers(map) {
    const osm = L.tileLayer(...TILES.osm), topo = L.tileLayer(...TILES.topo), trails = L.tileLayer(...TILES.trails);
    const saved = localStorage.getItem('kv_base') || 'osm';
    (saved === 'topo' ? topo : osm).addTo(map);
    if (localStorage.getItem('kv_trails') === '1') trails.addTo(map);
    L.control.layers({ 'Utcatérkép': osm, 'Domborzat': topo }, { 'Turistautak': trails }, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', e => localStorage.setItem('kv_base', e.layer === topo ? 'topo' : 'osm'));
    map.on('overlayadd', () => localStorage.setItem('kv_trails', '1'));
    map.on('overlayremove', () => localStorage.setItem('kv_trails', '0'));
  }

  return { parse, daysUntil, dateShort, dateBox, monthTitle, weekday, countdown, soon, km, ft, esc,
    awardIcons, haversine, favs, toggleFav, baseLayers, AWARD };
})();
