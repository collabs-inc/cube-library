// Cards: everything saved to Cube Library, one Markdown file each, so people, agents and Obsidian can all read them.
//
//   ~/Mind/<slug>-<id>.md       front matter (type, url, title, site, image, tags, colors, summary, created…) + body
//   ~/Mind/assets/              images: uploads, and pictures fetched from saved links
//   ~/Mind/.mind/spaces.json    Spaces, saved searches (a dot-folder, so Obsidian leaves it out)
//
// Front matter is written as YAML whose strings are JSON-quoted, which every YAML reader accepts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TYPES = ['link', 'image', 'note', 'quote', 'video', 'tweet', 'product', 'article'];
const FIELDS = ['type', 'title', 'url', 'site', 'image', 'author', 'price', 'tags', 'colors', 'summary', 'created', 'source'];

// ---- front matter ----
export function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && key) { meta[key] = [].concat(Array.isArray(meta[key]) ? meta[key] : [], val(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    meta[key] = v === '' ? [] : /^\[.*\]$/.test(v) ? listOf(v) : val(v);
  }
  return { meta, body: text.slice(m[0].length) };
}
function val(v) {
  v = v.trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch {} }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
function listOf(v) {
  try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(String); } catch {}
  return v.slice(1, -1).split(',').map(s => val(s)).filter(Boolean);
}
export function serialize(meta, body = '') {
  const lines = ['---'];
  const keys = [...FIELDS.filter(k => k in meta), ...Object.keys(meta).filter(k => !FIELDS.includes(k))];
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    lines.push(`${k}: ${Array.isArray(v) ? `[${v.map(x => JSON.stringify(String(x))).join(', ')}]` : JSON.stringify(String(v))}`);
  }
  lines.push('---', '');
  return lines.join('\n') + (body ? String(body).replace(/\s+$/, '') + '\n' : '');
}

const slug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'card';
export const newId = () => crypto.randomBytes(4).toString('hex');

export function createCards(root) {
  let cards = new Map();            // id → card
  const fileOf = new Map();         // id → relative path

  function read(rel) {
    let text, st;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); st = fs.statSync(path.join(root, rel)); } catch { return null; }
    const { meta, body } = parse(text);
    const id = String(meta.id || (/-([0-9a-f]{8})\.md$/.exec(rel) || [])[1] || crypto.createHash('sha1').update(rel).digest('hex').slice(0, 8));
    return {
      id, file: rel, mtime: st.mtimeMs,
      type: TYPES.includes(meta.type) ? meta.type : (meta.url ? 'link' : 'note'),
      title: meta.title || '', url: meta.url || '', site: meta.site || '', image: meta.image || '', author: meta.author || '', price: meta.price || '',
      tags: [].concat(meta.tags || []).map(String), colors: [].concat(meta.colors || []).map(String),
      summary: meta.summary || '', created: meta.created || new Date(st.birthtimeMs || st.mtimeMs).toISOString(),
      body: body.trim(), meta,
    };
  }
  function scan() {
    const next = new Map(), files = new Map();
    let names = [];
    try { names = fs.readdirSync(root).filter(f => f.endsWith('.md') && !/^(AGENTS|CLAUDE|README)\.md$/.test(f)); } catch {}
    for (const f of names) {
      const old = cards.get([...fileOf].find(([, v]) => v === f)?.[0]);
      let mtime = 0; try { mtime = fs.statSync(path.join(root, f)).mtimeMs; } catch {}
      const c = old && old.file === f && old.mtime === mtime ? old : read(f);
      if (!c) continue;
      next.set(c.id, c); files.set(c.id, f);
    }
    const changed = [...next.keys()].filter(id => cards.get(id)?.mtime !== next.get(id).mtime);
    const removed = [...cards.keys()].filter(id => !next.has(id));
    cards = next; fileOf.clear(); for (const [k, v] of files) fileOf.set(k, v);
    return { changed, removed };
  }

  // rename: give the file the card's (new) title, as when a link's real title arrives
  function write(card, { rename = false } = {}) {
    const meta = { ...card.meta, id: card.id };
    for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
    for (const k of FIELDS) if (card[k] !== undefined) meta[k] = card[k];
    const want = `${slug(card.title || card.site || card.body?.slice(0, 40) || card.type)}-${card.id}.md`;
    let rel = fileOf.get(card.id);
    if (rel && rename && rel !== want && !fs.existsSync(path.join(root, want))) { try { fs.renameSync(path.join(root, rel), path.join(root, want)); rel = want; } catch {} }
    if (!rel) rel = want;
    const abs = path.join(root, rel), tmp = path.join(root, `.${path.basename(rel)}.tmp`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(tmp, serialize(meta, card.body)); fs.renameSync(tmp, abs);
    fileOf.set(card.id, rel);
    const c = read(rel); cards.set(c.id, c);
    return c;
  }

  function search(q) {
    q = String(q || '').trim().toLowerCase();
    let list = [...cards.values()];
    // type:image, tag:design, #design, color:red are filters; the rest is text
    const words = [];
    for (const w of q.split(/\s+/).filter(Boolean)) {
      let m;
      if ((m = /^type:(\w+)$/.exec(w))) list = list.filter(c => c.type === m[1] || (m[1] === 'link' && ['link', 'article', 'product'].includes(c.type)));
      else if ((m = /^(?:tag:|#)(.+)$/.exec(w))) list = list.filter(c => c.tags.some(t => t.toLowerCase() === m[1]));
      else if ((m = /^color:(#?[0-9a-f]{6}|\w+)$/.exec(w))) list = list.filter(c => c.colors.some(h => near(h, m[1])));
      else words.push(w);
    }
    if (words.length) {
      list = list.map(c => {
        const hay = [c.title, c.site, c.url, c.author, c.summary, c.body, c.tags.join(' ')].join(' ').toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 + (c.title.toLowerCase().includes(w) ? 2 : 0) + (c.tags.some(t => t.toLowerCase() === w) ? 3 : 0) : -100), 0);
        return [c, score];
      }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    } else list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return list;
  }

  // cards that share tags or words with this one
  function similar(id, n = 8) {
    const c = cards.get(id); if (!c) return [];
    const words = new Set(`${c.title} ${c.summary}`.toLowerCase().match(/[a-z]{4,}/g) || []);
    return [...cards.values()].filter(x => x.id !== id).map(x => {
      const shared = x.tags.filter(t => c.tags.includes(t)).length * 3 + (`${x.title} ${x.summary}`.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => words.has(w)).length + (x.site && x.site === c.site ? 1 : 0);
      return [x, shared];
    }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x);
  }

  function tags() {
    const n = new Map();
    for (const c of cards.values()) for (const t of c.tags) n.set(t, (n.get(t) || 0) + 1);
    return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  function remove(id) {
    const rel = fileOf.get(id); if (!rel) return false;
    const trash = path.join(root, '.trash'); fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(path.join(root, rel), path.join(trash, rel));
    cards.delete(id); fileOf.delete(id);
    return true;
  }

  scan();
  return { scan, write, search, similar, tags, remove, get: id => cards.get(id) || null, all: () => [...cards.values()], root };
}

// ---- colors: named colors for search ("color:red"), matched by hue ----
const NAMED = { red: 0, orange: 30, yellow: 55, green: 120, teal: 175, blue: 215, purple: 275, pink: 325, brown: 25, black: -1, white: -2, grey: -3, gray: -3 };
function hsl(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16); if (!Number.isFinite(n)) return null;
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}
function near(hex, want) {
  const c = hsl(hex); if (!c) return false;
  if (/^#?[0-9a-f]{6}$/i.test(want)) { const w = hsl(want); return w && Math.min(Math.abs(c.h - w.h), 360 - Math.abs(c.h - w.h)) < 22 && Math.abs(c.l - w.l) < .25; }
  const h = NAMED[want]; if (h === undefined) return false;
  if (h === -1) return c.l < .18;
  if (h === -2) return c.l > .88;
  if (h === -3) return c.s < .12 && c.l >= .18 && c.l <= .88;
  if (want === 'brown') return c.h >= 10 && c.h <= 45 && c.l < .45 && c.s > .2;
  // a vivid color: dark versions of red and orange read as brown, so they need some light
  const minL = h <= 40 ? .3 : .2;
  return c.s > .3 && c.l > minL && c.l < .85 && Math.min(Math.abs(c.h - h), 360 - Math.abs(c.h - h)) < 25;
}
