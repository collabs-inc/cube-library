import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCards, parse, serialize } from './cards.mjs';

test('front matter round-trips, with quotes, colons and lists', () => {
  const meta = { type: 'link', title: 'A "quoted": title', tags: ['design', 'mid-century'], colors: ['#aabbcc'], url: 'https://x.y/z?a=1' };
  const { meta: back, body } = parse(serialize(meta, 'Body text'));
  assert.deepEqual(back, meta);
  assert.equal(body, 'Body text\n');
  assert.deepEqual(parse('---\ntitle: plain\ntags:\n  - a\n  - b\n---\nx').meta, { title: 'plain', tags: ['a', 'b'] });
});

test('search: words, #tags, type: and color:', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-'));
  const c = createCards(dir);
  c.write({ id: 'aaaa0001', type: 'image', title: 'Orange poster', tags: ['poster'], colors: ['#ff8a00'], body: '', meta: {} });
  c.write({ id: 'aaaa0002', type: 'link', title: 'Eames chair', tags: ['chair', 'design'], colors: ['#3a2a1c'], body: '', meta: {} });
  c.write({ id: 'aaaa0003', type: 'note', title: '', tags: [], colors: [], body: 'buy a chair for the studio', meta: {} });
  assert.deepEqual(c.search('chair').map(x => x.id), ['aaaa0002', 'aaaa0003']);
  assert.deepEqual(c.search('#design').map(x => x.id), ['aaaa0002']);
  assert.deepEqual(c.search('type:image').map(x => x.id), ['aaaa0001']);
  assert.deepEqual(c.search('color:orange').map(x => x.id), ['aaaa0001']);
  assert.deepEqual(c.search('color:brown').map(x => x.id), ['aaaa0002']);
  assert.ok(fs.readdirSync(dir).includes('orange-poster-aaaa0001.md'));
  c.write({ ...c.get('aaaa0001'), title: 'Big orange poster' }, { rename: true });
  assert.ok(fs.readdirSync(dir).includes('big-orange-poster-aaaa0001.md'));
});
