// Minimal streaming-free parser for OSM API XML (cgimap output).
// Merges several tiles and de-duplicates elements by id.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseOsmDir(dir) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.osm')).sort()) {
    parseInto(readFileSync(join(dir, f), 'utf8'), nodes, ways, relations);
  }
  return { nodes, ways, relations };
}

function parseInto(xml, nodes, ways, relations) {
  const lines = xml.split('\n');
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('<node ')) {
      const id = +attr(line, 'id');
      const n = { id, lat: +attr(line, 'lat'), lon: +attr(line, 'lon'), tags: {} };
      if (!nodes.has(id)) nodes.set(id, n);
      cur = line.endsWith('/>') ? null : nodes.get(id);
    } else if (line.startsWith('<way ')) {
      const id = +attr(line, 'id');
      const w = { id, nds: [], tags: {} };
      const fresh = !ways.has(id);
      if (fresh) ways.set(id, w);
      cur = fresh ? w : { nds: [], tags: {}, members: [] }; // ignore duplicate body
    } else if (line.startsWith('<relation ')) {
      const id = +attr(line, 'id');
      const r = { id, members: [], tags: {} };
      const fresh = !relations.has(id);
      if (fresh) relations.set(id, r);
      cur = fresh ? r : { nds: [], tags: {}, members: [] };
    } else if (line.startsWith('<nd ') && cur) {
      cur.nds.push(+attr(line, 'ref'));
    } else if (line.startsWith('<member ') && cur) {
      cur.members.push({ type: attr(line, 'type'), ref: +attr(line, 'ref'), role: attr(line, 'role') });
    } else if (line.startsWith('<tag ') && cur) {
      cur.tags[unescape(attr(line, 'k'))] = unescape(attr(line, 'v'));
    } else if (line.startsWith('</')) {
      cur = null;
    }
  }
}

function attr(line, name) {
  const i = line.indexOf(` ${name}="`);
  if (i < 0) return '';
  const s = i + name.length + 3;
  return line.slice(s, line.indexOf('"', s));
}
