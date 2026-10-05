// Cube Library — save anything, find it again. A calm grid of everything you keep, and a Librarian that tags, summarizes and
// finds things for you.
//   node server/server.mjs      → http://127.0.0.1:$PORT (as a Cube app: behind Cube's gate)
//
//   GET  /api/cards?q=           cards, newest first, or matching q (words, #tag, type:image, color:red)
//   GET  /api/cards/<id>         one card, with similar ones
//   POST /api/save               { url } | { text } — saved at once, filled in as its preview arrives
//   POST /api/upload?name=       raw image bytes → an image card
//   POST /api/cards/<id>         { title, body, tags, summary, colors, … } · POST /api/cards/<id>/delete
//   GET  /api/asset?path=        a file from assets/
//   GET  /api/tags · GET|PUT /api/spaces · GET /api/events · /api/librarian/…
//   GET  /save?url=              a bookmarklet's target: saves, then says so
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCards, newId } from './cards.mjs';
import { preview, image } from './fetch.mjs';
import { createPersona } from '../kit/persona.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STATE = path.resolve(process.env.MIND_STATE || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'cube-library'));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = () => readJson(path.join(STATE, 'settings.json'), {});
const HOME = path.resolve(String(process.env.MIND_HOME || settings().home || path.join(os.homedir(), 'Mind')).replace(/^~(?=$|\/)/, os.homedir()));
const ASSETS = path.join(HOME, 'assets');
const PORT = Number(process.env.PORT || 4323);
const URL_SELF = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });
const cards = createCards(HOME);

// ---- live updates ----
const clients = new Set();
const broadcast = ev => { const d = `data: ${JSON.stringify(ev)}\n\n`; for (const r of clients) r.write(d); };
let rescanTimer = null;
const rescan = () => { clearTimeout(rescanTimer); rescanTimer = setTimeout(() => { const { changed, removed } = cards.scan(); for (const id of changed) broadcast({ type: 'card', id }); for (const id of removed) broadcast({ type: 'remove', id }); }, 150); };
try { fs.watch(HOME, (e, f) => { if (!f || (/\.md$/.test(f) && !f.startsWith('.'))) rescan(); }); } catch {}
setInterval(rescan, 30000);

// ---- the Librarian: tags and summarizes new saves (in batches), finds things, keeps Spaces ----
const librarian = createPersona({
  name: 'Librarian',
  dir: path.join(STATE, 'librarian'),
  cwd: HOME,
  brief: () => { try { return fs.readFileSync(path.join(APP, 'librarian', 'LIBRARIAN.md'), 'utf8').replaceAll('{{HOME}}', HOME).replaceAll('{{URL}}', URL_SELF).replaceAll('{{APP}}', APP); } catch { return ''; } },
  env: () => ({ MIND_HOME: HOME, MIND_URL: URL_SELF, MIND_APP: APP }),
  models: { claude: process.env.MIND_CLAUDE_MODEL, codex: process.env.MIND_CODEX_MODEL },
  describe: c => c.card ? `[Cube Library: the user is looking at card ${c.card}${cards.get(c.card) ? ` (${HOME}/${cards.get(c.card).file})` : ''}.]` : c.query ? `[Cube Library: the user is looking at the results for “${c.query}”.]` : '',
  eventPrompt: details => `[Cube Library: new things were saved:\n${details.map(d => `- ${d}`).join('\n')}\nFor each, add 2–5 lowercase tags that someone would search for (reuse existing tags where they fit: GET ${URL_SELF}/api/tags) and a one-sentence summary of what it is and why it might have been kept, by editing the card's front matter (tags, summary) or POST ${URL_SELF}/api/cards/<id>. Don't reply unless something needs the user; then say it in one line.]`,
});
// new saves reach the Librarian together, a little after the last one, so a burst of saves costs one turn
let enrichTimer = null, enrichQueue = [];
function enrich(card) {
  if (settings().autoTag === false) return;
  enrichQueue.push(`${card.id} · ${card.type} · ${card.title || card.body.slice(0, 80)} ${card.url ? `· ${card.url}` : ''} · ${HOME}/${card.file}`);
  clearTimeout(enrichTimer);
  enrichTimer = setTimeout(() => { const q = enrichQueue.splice(0); if (q.length) librarian.event(q.length > 1 ? `Tagging ${q.length} new cards` : 'Tagging a new card', q.join('\n- '), { quiet: true }); }, 15000);
}

// ---- saving ----
const isUrl = s => /^https?:\/\/\S+$/i.test(String(s).trim());
async function keepImage(src, base) {
  let got;
  try { got = await image(src); }
  catch (e) { if (!/\b(429|5\d\d)\b/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 2500)); got = await image(src); }
  const { buf, ext } = got;
  const name = `${base}${ext}`;
  fs.writeFileSync(path.join(ASSETS, name), buf);
  return `assets/${name}`;
}
function saveUrl(url, extra = {}) {
  const id = newId();
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  let card = cards.write({ id, type: 'link', title: host, url, site: host, created: new Date().toISOString(), tags: [], colors: [], body: '', meta: { pending: 'true', ...extra } });
  broadcast({ type: 'card', id });
  (async () => {
    try {
      const p = await preview(url);
      let img = '';
      for (const src of [p.image, p.image_fallback].filter(Boolean)) { try { img = await keepImage(src, id); break; } catch {} }
      if (!img && p.image) img = p.image;          // couldn't keep a copy: show it from where it lives
      const body = [p.description, p.body, p.text].filter(Boolean).join('\n\n').trim();
      card = cards.write({ ...cards.get(id), type: p.type, title: p.title || host, url: p.url || url, site: p.site || host, author: p.author || '', price: p.price || '', image: img, body, meta: { ...cards.get(id).meta, pending: undefined } }, { rename: true });
    } catch (e) {
      // the site wouldn't say (bots blocked, a login wall): a title from the address is better than none
      let title = host;
      try { const seg = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); const words = seg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').split(' ').filter(w => !/\d/.test(w) || /^\d{1,4}$/.test(w)).filter((w, i, a) => !(i === a.length - 1 && w.length === 1)).join(' ').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim(); if (/[a-z]{3}/i.test(words) && words.length > 6) title = words[0].toUpperCase() + words.slice(1); } catch {}
      card = cards.write({ ...cards.get(id), title, meta: { ...cards.get(id).meta, pending: undefined, error: String(e.message || e).slice(0, 200) } }, { rename: true });
    }
    broadcast({ type: 'card', id });
    enrich(card);
  })();
  return card;
}
function saveText(text) {
  text = String(text).trim();
  // a quotation: wrapped in quotes, or a line ending with an attribution ("— Name")
  const quoted = /^["“«'‘].+["”»'’]\s*(?:[-—–]\s*.+)?$/s.test(text) || /\n\s*[-—–]\s*\S.{0,60}$/.test(text);
  const m = /\n?\s*[-—–]\s*([^\n]{1,60})$/.exec(text);
  const card = cards.write({
    id: newId(), type: quoted ? 'quote' : 'note', title: '', created: new Date().toISOString(), tags: [], colors: [],
    author: quoted && m ? m[1].trim() : '', body: quoted && m ? text.slice(0, m.index).trim().replace(/^["“«'‘]|["”»'’]$/g, '') : text, meta: {},
  });
  broadcast({ type: 'card', id: card.id });
  enrich(card);
  return card;
}

// ---- http ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
function body(req, res, fn, limit = 2e6) {
  const chunks = []; let size = 0;
  req.on('data', d => { size += d.length; if (size > limit) { send(res, 413, { error: 'too large' }); req.destroy(); } else chunks.push(d); });
  req.on('end', () => { let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return send(res, 400, { error: e.message }); } try { fn(b); } catch (e) { send(res, 400, { error: e.message }); } });
}
const view = (c, full = false) => c && ({ id: c.id, type: c.type, title: c.title, url: c.url, site: c.site, image: c.image, author: c.author, price: c.price, tags: c.tags, colors: c.colors, summary: c.summary, created: c.created, pending: Boolean(c.meta.pending), error: c.meta.error || null, file: c.file, body: full ? c.body : c.body.slice(0, 600) });
const SPACES = path.join(HOME, '.mind', 'spaces.json');

function route(req, res) {
  const url = new URL(req.url, 'http://x');
  let p; try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad url', 'text/plain'); }
  if (librarian.route(req, res, p, '/api/librarian', { body, send })) return;
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': hi\n\n'); clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (p === '/api/mind') return send(res, 200, { home: HOME, cards: cards.all().length, autoTag: settings().autoTag !== false });
  if (p === '/api/cards' && req.method === 'GET') return send(res, 200, cards.search(url.searchParams.get('q') || '').map(c => view(c)));
  const one = /^\/api\/cards\/([0-9a-z]+)(\/delete)?$/.exec(p);
  if (one && req.method === 'GET' && !one[2]) { const c = cards.get(one[1]); return c ? send(res, 200, { ...view(c, true), similar: cards.similar(c.id).map(x => view(x)) }) : send(res, 404, { error: 'no such card' }); }
  if (one && req.method === 'POST' && one[2]) { const ok = cards.remove(one[1]); broadcast({ type: 'remove', id: one[1] }); return send(res, ok ? 200 : 404, { ok }); }
  if (one && req.method === 'POST') return body(req, res, b => {
    const c = cards.get(one[1]); if (!c) return send(res, 404, { error: 'no such card' });
    const next = { ...c };
    for (const k of ['title', 'body', 'summary', 'author', 'price', 'url']) if (typeof b[k] === 'string') next[k] = b[k].slice(0, k === 'body' ? 50000 : 2000);
    if (Array.isArray(b.tags)) next.tags = [...new Set(b.tags.map(t => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 30);
    if (Array.isArray(b.colors)) next.colors = b.colors.filter(h => /^#[0-9a-f]{6}$/i.test(h)).slice(0, 6);
    const w = cards.write(next); broadcast({ type: 'card', id: w.id });
    send(res, 200, view(w, true));
  });
  if (p === '/api/save' && req.method === 'POST') return body(req, res, b => {
    const v = String(b.url || b.text || '').trim();
    if (!v) throw new Error('nothing to save');
    send(res, 200, view(isUrl(v) ? saveUrl(v) : saveText(v)));
  });
  if (p === '/save') {
    const u = url.searchParams.get('url');
    if (!u || !isUrl(u)) return send(res, 400, 'Give a ?url= to save.', 'text/plain');
    saveUrl(u);
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Saved</title><body style="font:15px -apple-system,system-ui;display:grid;place-items:center;height:90vh;color:#444">Saved to Cube Library.<script>setTimeout(()=>{history.length>1?history.back():close()},900)</script>`, 'text/html; charset=utf-8');
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const name = path.basename(url.searchParams.get('name') || 'image.png').replace(/[^\w.\- ]/g, '');
    const ext = (path.extname(name) || '.png').toLowerCase();
    if (!TYPES[ext]?.startsWith('image/')) return send(res, 415, { error: 'images only' });
    const chunks = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > 25e6) req.destroy(); else chunks.push(d); });
    req.on('end', () => {
      const id = newId(), file = `${id}${ext}`;
      fs.writeFileSync(path.join(ASSETS, file), Buffer.concat(chunks));
      const c = cards.write({ id, type: 'image', title: name.replace(/\.[^.]+$/, '').replace(/^(image|Pasted image.*|Screenshot.*)$/i, ''), image: `assets/${file}`, created: new Date().toISOString(), tags: [], colors: [], body: '', meta: {} });
      broadcast({ type: 'card', id }); enrich(c);
      send(res, 200, view(c));
    });
    return;
  }
  if (p === '/api/asset') {
    const rel = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    const abs = path.join(HOME, rel);
    if (!rel.startsWith('assets/') || rel.includes('..') || !abs.startsWith(ASSETS + path.sep)) return send(res, 404, { error: 'not found' });
    let st; try { st = fs.statSync(abs); } catch { return send(res, 404, { error: 'not found' }); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    return fs.createReadStream(abs).pipe(res);
  }
  if (p === '/api/tags') return send(res, 200, cards.tags());
  if (p === '/api/spaces' && req.method === 'GET') return send(res, 200, readJson(SPACES, []));
  if (p === '/api/spaces' && req.method === 'PUT') return body(req, res, b => {
    if (!Array.isArray(b)) throw new Error('spaces are a list of { name, query }');
    const list = b.filter(s => s && s.name && s.query).map(s => ({ name: String(s.name).slice(0, 60), query: String(s.query).slice(0, 300) })).slice(0, 50);
    fs.mkdirSync(path.dirname(SPACES), { recursive: true }); fs.writeFileSync(SPACES, JSON.stringify(list, null, 2));
    broadcast({ type: 'spaces' }); send(res, 200, list);
  });
  if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
  const rel = p === '/' ? '/web/index.html' : p;
  if (!/^\/(web|kit)\//.test(rel)) return send(res, 404, 'not found', 'text/plain');
  const abs = path.join(APP, rel);
  let st; try { st = fs.statSync(abs); } catch { return send(res, 404, 'not found', 'text/plain'); }
  if (!abs.startsWith(APP + path.sep) || !st.isFile()) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(abs).pipe(res);
}
// spaces.json changed by the Librarian (or by hand) reaches the page too
try { fs.mkdirSync(path.dirname(SPACES), { recursive: true }); fs.watch(path.dirname(SPACES), () => broadcast({ type: 'spaces' })); } catch {}

http.createServer((req, res) => { try { route(req, res); } catch (e) { if (!res.headersSent) send(res, 400, { error: String(e.message || e) }); else res.destroy(); } })
  .listen(PORT, '127.0.0.1', () => console.log(`Cube Library → ${URL_SELF}  (${HOME})`));
process.on('uncaughtException', e => console.error('mind: uncaught', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { librarian.shutdown(); process.exit(0); });
