// What a saved link is: its title, picture, site and description, read from the page the way a link preview is
// (Open Graph, Twitter cards, then the plain HTML), with special cases for YouTube (oEmbed) and X (fxtwitter, which
// needs no login). No dependencies; every request is bounded in time and size.
const UA = 'Mozilla/5.0 (compatible; CubeMind/0.1; +https://cube.computer)';

async function get(url, { accept = 'text/html,*/*', max = 3e6, timeout = 15000 } = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  const reader = r.body.getReader(); const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { reader.cancel(); break; } chunks.push(value); }
  return { buf: Buffer.concat(chunks), type: r.headers.get('content-type') || '', url: r.url };
}

const decode = s => String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
}).replace(/\s+/g, ' ').trim();

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = (/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/content\s*=\s*["']([^"']*)["']/i.exec(tag) || /content\s*=\s*([^\s>]+)/i.exec(tag) || [])[1];
    if (key && val && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decode(val);
  }
  return out;
}

// the article's readable text, roughly: paragraphs inside <article>/<main>, else the page's longest paragraphs
function readable(html) {
  const scope = (/<article[\s\S]*?<\/article>/i.exec(html) || /<main[\s\S]*?<\/main>/i.exec(html) || [html])[0];
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, ''))).filter(p => p.length > 60);
  return paras.join('\n\n').slice(0, 20000);
}

export async function preview(raw) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, '');
  // X / Twitter: the post itself
  const tw = /^(?:x|twitter|mobile\.twitter)\.com$/.test(host) && /^\/([^/]+)\/status\/(\d+)/.exec(url.pathname);
  if (tw) {
    const d = JSON.parse((await get(`https://api.fxtwitter.com/${tw[1]}/status/${tw[2]}`, { accept: 'application/json' })).buf).tweet;
    const media = d.media?.photos?.[0]?.url || d.media?.videos?.[0]?.thumbnail_url || null;
    return { type: 'tweet', title: `${d.author?.name || tw[1]} on X`, author: `@${d.author?.screen_name || tw[1]}`, site: 'x.com', url: d.url || raw, image: media, body: d.text || '', created_at: d.created_at };
  }
  // YouTube: oEmbed gives the title, the channel and a thumbnail
  if (/^(youtube\.com|m\.youtube\.com|youtu\.be)$/.test(host)) {
    const o = JSON.parse((await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(raw)}`, { accept: 'application/json' })).buf);
    return { type: 'video', title: o.title, author: o.author_name, site: 'youtube.com', url: raw, image: (o.thumbnail_url || '').replace('hqdefault', 'maxresdefault'), image_fallback: o.thumbnail_url };
  }
  const page = await get(raw);
  if (/^image\//.test(page.type)) return { type: 'image', title: decodeURIComponent(url.pathname.split('/').pop() || host), site: host, url: raw, image: raw };
  const html = page.buf.toString('utf8');
  const m = metaTags(html);
  const title = m['og:title'] || m['twitter:title'] || decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]) || host;
  let image = m['og:image:secure_url'] || m['og:image'] || m['twitter:image'] || m['twitter:image:src'] || null;
  if (image) { try { image = new URL(image, page.url).href; } catch { image = null; } }
  const ogType = (m['og:type'] || '').toLowerCase();
  const price = m['product:price:amount'] || m['og:price:amount'] || '';
  const currency = m['product:price:currency'] || m['og:price:currency'] || '';
  const type = price ? 'product' : /article|blog/.test(ogType) || m['article:published_time'] ? 'article' : /video/.test(ogType) ? 'video' : 'link';
  return {
    type, title, url: page.url || raw, image,
    site: m['og:site_name'] || host,
    author: m['author'] || m['article:author'] || m['twitter:creator'] || '',
    price: price ? `${currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency ? currency + ' ' : ''}${price}` : '',
    description: m['og:description'] || m['description'] || m['twitter:description'] || '',
    text: type === 'article' ? readable(html) : '',
  };
}

// a picture from the web, as bytes to keep in assets/ (so a card never depends on someone else's server)
export async function image(url) {
  const r = await get(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*', max: 12e6, timeout: 20000 });
  const type = r.type.split(';')[0].trim();
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' }[type];
  if (!ext) throw new Error(`not an image (${type || 'unknown type'})`);
  return { buf: r.buf, ext };
}
