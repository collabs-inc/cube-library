// Mind's page: a grid of everything saved, one search, and a card view. Paste or drop anywhere to save.
import { applyTheme } from '/kit/persona.js';
import { mountFloatingPersona } from '/kit/persona-float.js';
applyTheme();

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const api = async (p, opts = {}) => { const r = await fetch(p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } }); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); return b; };
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
const toast = m => { $('toast').innerHTML = `<div>${esc(m)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => { $('toast').innerHTML = ''; }, 2400); };
const img = src => !src ? '' : /^https?:/.test(src) ? src : `/api/asset?path=${encodeURIComponent(src)}`;
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const TYPES = [['', 'Everything'], ['link', 'Links'], ['image', 'Images'], ['article', 'Articles'], ['video', 'Videos'], ['note', 'Notes'], ['quote', 'Quotes'], ['product', 'Products'], ['tweet', 'Posts']];
const COLORS = [['red', '#ff453a'], ['orange', '#ff9f0a'], ['yellow', '#ffd60a'], ['green', '#30d158'], ['blue', '#0a84ff'], ['purple', '#bf5af2'], ['pink', '#ff6482'], ['brown', '#a2845e'], ['black', '#1c1c1e'], ['white', '#f5f5f7']];
const S = { q: '', type: '', color: '', space: '', cards: [], all: [], spaces: [], open: null };

// ---- the query: words, plus the chips ----
const query = () => [S.space ? S.spaces.find(s => s.name === S.space)?.query : '', S.q, S.type ? `type:${S.type}` : '', S.color ? `color:${S.color}` : ''].filter(Boolean).join(' ');
async function load() {
  const [cards, all] = await Promise.all([api(`/api/cards?q=${encodeURIComponent(query())}`), S.all.length && !S.q && !S.type && !S.color && !S.space ? null : api('/api/cards')]);
  S.cards = cards; if (all) S.all = all; else S.all = cards;
  render();
}
function renderFilters() {
  const count = t => S.all.filter(c => !t || c.type === t || (t === 'link' && false)).length;
  const types = TYPES.filter(([t]) => !t || S.all.some(c => c.type === t));
  $('filters').innerHTML =
    types.map(([t, label]) => `<button class="chip${S.type === t && !S.space ? ' on' : ''}" data-type="${t}">${label}${t ? `<span class="n">${count(t)}</span>` : ''}</button>`).join('') +
    (S.spaces.length ? '<span class="sep"></span>' + S.spaces.map(s => `<button class="chip space${S.space === s.name ? ' on' : ''}" data-space="${esc(s.name)}" title="${esc(s.query)}">${esc(s.name)}</button>`).join('') : '') +
    '<span class="sep"></span>' + COLORS.map(([n, hex]) => `<button class="swatch${S.color === n ? ' on' : ''}" data-color="${n}" title="${n}" style="background:${hex}"></button>`).join('') +
    (S.q || S.type || S.color ? `<span class="sep"></span><button class="chip" data-save-space>Save as a Space</button>` : '');
}
$('filters').onclick = async e => {
  const t = e.target.closest('[data-type]'); if (t) { S.type = t.dataset.type; S.space = ''; return load(); }
  const sp = e.target.closest('[data-space]'); if (sp) { S.space = S.space === sp.dataset.space ? '' : sp.dataset.space; S.type = ''; return load(); }
  const c = e.target.closest('[data-color]'); if (c) { S.color = S.color === c.dataset.color ? '' : c.dataset.color; return load(); }
  if (e.target.closest('[data-save-space]')) {
    const name = prompt('Name this Space', S.q || S.type || S.color); if (!name) return;
    S.spaces = await api('/api/spaces', { method: 'PUT', body: JSON.stringify([...S.spaces.filter(s => s.name !== name), { name, query: query() }]) });
    S.space = name; S.q = ''; S.type = ''; S.color = ''; $('q').value = ''; load();
  }
};
let qTimer = null;
$('q').oninput = e => { S.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(load, 140); };
$('q').onkeydown = e => { if (e.key === 'Escape') { $('q').value = ''; S.q = ''; load(); } };

// ---- cards ----
const PLAY = '<span class="play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"/></svg></span>';
function cardHtml(c) {
  const tags = c.tags.length ? `<div class="tags">${c.tags.slice(0, 4).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';
  const pic = c.image ? `<img src="${esc(img(c.image))}" alt="" loading="lazy" data-id="${c.id}" crossorigin="anonymous">` : '';
  if (c.pending) return `<button class="card pending" data-open="${c.id}"><div class="shimmer"></div><div class="pad"><div class="t">${esc(c.url)}</div><div class="s">Saving…</div></div></button>`;
  switch (c.type) {
    case 'image': return `<button class="card image" data-open="${c.id}">${pic}${tags}</button>`;
    case 'note': return `<button class="card note" data-open="${c.id}"><div class="pad"><div class="body">${esc(c.body)}</div></div>${tags}</button>`;
    case 'quote': return `<button class="card quote" data-open="${c.id}"><div class="pad"><div class="body">“${esc(c.body)}”</div>${c.author ? `<div class="by">${esc(c.author)}</div>` : ''}</div>${tags}</button>`;
    case 'tweet': return `<button class="card tweet" data-open="${c.id}"><div class="pad"><div class="who">${esc(c.author)}</div><div class="body">${esc(c.body)}</div></div>${pic}${tags}</button>`;
    default: return `<button class="card ${c.type}" data-open="${c.id}">${pic}${c.type === 'video' && c.image ? PLAY : ''}<div class="pad"><div class="t">${esc(c.title || c.url)}</div>
      ${!c.image && c.body ? `<div class="d">${esc(c.body)}</div>` : ''}<div class="s"><span>${esc(c.site || host(c.url))}</span>${c.price ? `<span class="price">${esc(c.price)}</span>` : ''}</div></div>${tags}</button>`;
  }
}
const ADD = `<div class="add" id="add"><textarea id="addText" rows="3" placeholder="Paste a link, write a thought, or drop an image…"></textarea><div class="row"><span>Or paste anywhere. ⌘↵ saves.</span><button class="btn" id="addBtn">Save</button></div></div>`;
function render() {
  renderFilters();
  const filtered = S.q || S.type || S.color || S.space;
  const keep = document.activeElement?.id === 'addText' ? $('addText').value : null;
  $('grid').innerHTML = (filtered ? '' : ADD) + (S.cards.map(cardHtml).join('') || `<div class="empty-mind">${filtered ? 'Nothing matches. Ask the Curator: it can find things from a description.' : ''}</div>`);
  if (keep !== null) { $('addText').value = keep; $('addText').focus(); }
  wireAdd();
}
$('grid').onclick = e => { const c = e.target.closest('[data-open]'); if (c) openCard(c.dataset.open); };

// colors: worked out here from each picture as it loads, once, and kept on the card
const pending = new Set();
$('grid').addEventListener('load', e => {
  const el = e.target; if (el.tagName !== 'IMG' || !el.dataset.id) return;
  const c = S.cards.find(x => x.id === el.dataset.id);
  if (!c || c.colors.length || pending.has(c.id)) return;
  pending.add(c.id);
  try { const colors = palette(el); if (colors.length) post(`/api/cards/${c.id}`, { colors }); } catch {}
}, true);
function palette(el) {
  const cv = document.createElement('canvas'), W = 48, H = Math.max(1, Math.round(48 * el.naturalHeight / el.naturalWidth));
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(el, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data, bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    const b = bins.get(k) || [0, 0, 0, 0]; b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; bins.set(k, b);
  }
  return [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, 5).map(([r, g, b, n]) => '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join(''));
}

// ---- saving: the add card, paste anywhere, drop anywhere ----
async function save(text) {
  text = String(text || '').trim(); if (!text) return;
  const urls = text.split(/\s+/).filter(w => /^https?:\/\/\S+$/.test(w));
  if (urls.length && urls.join(' ') === text.replace(/\s+/g, ' ')) for (const u of urls) await post('/api/save', { url: u });
  else await post('/api/save', { text });
  toast('Saved');
}
async function upload(file) {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name || 'image.png')}`, { method: 'POST', body: file });
  if (!r.ok) return toast('Only images can be dropped here');
  toast('Saved');
}
function wireAdd() {
  const t = $('addText'); if (!t) return;
  const go = async () => { const v = t.value; t.value = ''; await save(v); };
  $('addBtn').onclick = go;
  t.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } };
}
addEventListener('paste', e => {
  if (e.target.closest?.('input, textarea, .pf') && !(e.target.id === 'addText' && [...(e.clipboardData?.files || [])].length)) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); files.forEach(upload); return; }
  const text = e.clipboardData?.getData('text/plain'); if (text) { e.preventDefault(); save(text); }
});
let dragDepth = 0;
addEventListener('dragenter', e => { if ([...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/uri-list')) { dragDepth++; $('drop').hidden = false; } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (files.length) return files.forEach(upload);
  const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (u) save(u);
});

// ---- a card, opened ----
async function openCard(id) {
  const c = await api(`/api/cards/${id}`).catch(() => null); if (!c) return;
  S.open = c; history.replaceState(null, '', `#${id}`);
  curator.refreshContext?.();
  const yt = /youtube\.com\/watch\?v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/.exec(c.url || '');
  const media = yt ? `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1] || yt[2]}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
    : c.type === 'quote' ? `<div class="reading quote">“${esc(c.body)}”${c.author ? `<div class="by">${esc(c.author)}</div>` : ''}</div>`
    : c.image ? `<img src="${esc(img(c.image))}" alt="">`
    : `<div class="reading">${esc(c.body || c.title || c.url)}</div>`;
  $('detail').innerHTML = `<div class="overlay" id="ov">
    <div class="media">${media}</div>
    <div class="side">
      <button class="icon-btn x" data-close title="Close (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <div style="height:18px"></div>
      <textarea class="side-title" id="dTitle" rows="1" placeholder="Untitled">${esc(c.title)}</textarea>
      ${c.url ? `<div class="src"><span>${esc(c.site || host(c.url))}${c.author ? ` · ${esc(c.author)}` : ''}</span><a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">Open ↗</a></div>` : ''}
      ${c.price ? `<div><span class="badge">${esc(c.price)}</span></div>` : ''}
      <div><h4>Summary</h4><div class="summary${c.summary ? '' : ' none'}">${esc(c.summary || 'The Curator adds one shortly after you save.')}</div></div>
      <div><h4>Tags</h4><div class="tagbox" id="dTags">${c.tags.map(t => `<span>${esc(t)}<button data-untag="${esc(t)}">×</button></span>`).join('')}<input id="dTag" placeholder="Add a tag"></div></div>
      ${c.colors.length ? `<div><h4>Colors</h4><div class="palette">${c.colors.map(h => `<button style="background:${h}" title="${h}" data-hex="${h}"></button>`).join('')}</div></div>` : ''}
      <div><h4>${c.type === 'note' ? 'Note' : 'Your notes'}</h4><textarea class="notes" id="dBody" placeholder="Anything worth remembering about it…">${esc(c.type === 'quote' ? '' : c.body)}</textarea></div>
      ${c.similar.length ? `<div><h4>Similar</h4><div class="sim">${c.similar.map(cardHtml).join('')}</div></div>` : ''}
      <button class="btn plain danger" data-delete>Delete</button>
    </div></div>`;
  const keepEdits = () => {
    const patch = { title: $('dTitle').value };
    if (c.type !== 'quote') patch.body = $('dBody').value;
    if (patch.title === c.title && (patch.body ?? c.body) === c.body) return;
    post(`/api/cards/${c.id}`, patch).then(n => Object.assign(c, n));
  };
  $('dTitle').onblur = keepEdits; $('dBody').onblur = keepEdits;
  $('dTag').onkeydown = async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const n = await post(`/api/cards/${c.id}`, { tags: [...c.tags, e.target.value] }); Object.assign(c, n); openCard(c.id);
  };
}
function closeCard() { $('detail').innerHTML = ''; S.open = null; history.replaceState(null, '', location.pathname); curator.refreshContext?.(); }
$('detail').onclick = async e => {
  if (e.target.id === 'ov' || e.target.closest('[data-close]')) return closeCard();
  const c = S.open; if (!c) return;
  const u = e.target.closest('[data-untag]'); if (u) { await post(`/api/cards/${c.id}`, { tags: c.tags.filter(t => t !== u.dataset.untag) }); return openCard(c.id); }
  const h = e.target.closest('[data-hex]'); if (h) { closeCard(); S.color = ''; S.q = `color:${h.dataset.hex}`; $('q').value = S.q; return load(); }
  const o = e.target.closest('[data-open]'); if (o) return openCard(o.dataset.open);
  if (e.target.closest('[data-delete]') && confirm('Delete this card? It goes to the .trash folder.')) { await post(`/api/cards/${c.id}/delete`); closeCard(); }
};
addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.open && !e.target.closest?.('.pf')) closeCard();
  if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); $('q').focus(); }
});

// ---- the Curator, floating in the corner ----
const BOOKMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-4.97 0-9 3.58-9 8 0 2.5 1.3 4.74 3.33 6.2L6 21l4.2-2.2c.58.13 1.18.2 1.8.2 4.97 0 9-3.58 9-8s-4.03-8-9-8Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
const curator = mountFloatingPersona($('mind'), {
  base: '/api/curator', name: 'Curator', role: 'Your mind',
  avatar: { color: 'linear-gradient(160deg, #da8fff, #af52de 55%, #7d2fb3)', svg: BOOKMARK },
  hello: { suggestions: () => ['Find that chair I saved', 'Make a Space for recipes', 'What did I save this week?'] },
  context: () => S.open ? { label: S.open.title || S.open.type, card: S.open.id, ref: { card: S.open.id } } : S.q ? { label: `results for “${S.q}”`, query: S.q } : null,
  placeholder: c => c?.card ? `Ask about “${(c.label || '').slice(0, 30)}”…` : 'Ask the Curator to find or sort anything…',
  refFor: text => S.all.some(c => c.id === text) ? { card: text } : null,
  open: ref => ref?.card && openCard(ref.card),
});

// ---- live ----
const es = new EventSource('/api/events');
let liveTimer = null;
es.onmessage = e => {
  const ev = JSON.parse(e.data);
  if (ev.type === 'spaces') return api('/api/spaces').then(s => { S.spaces = s; renderFilters(); });
  clearTimeout(liveTimer); liveTimer = setTimeout(async () => { S.all = []; await load(); if (S.open && ev.id === S.open.id && document.activeElement?.closest?.('.side') == null) openCard(S.open.id); }, 200);
};
S.spaces = await api('/api/spaces');
await load();
if (location.hash.length > 1) openCard(location.hash.slice(1));
