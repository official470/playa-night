// Automatic 24-hour schedule from the SoundCloud set list in admin.html.
// Run: node tools/schedule-autofill.mjs <repo dir> [--force]
// Keeps every stage filled about 30 hours ahead with full SoundCloud sets that match the stage's genres
// (the same rules as the admin's 자동 편성: genre placement, Korean DJs only in Itaewon and first there,
// one DJ never on two stages of the same branch at once). Hand-made slots are never touched.
// Exits with code 0 and prints CHANGED when schedule.json was rewritten, NOCHANGE otherwise.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.';
const force = process.argv.includes('--force');
const admin = fs.readFileSync(path.join(dir, 'admin.html'), 'utf8');
const file = path.join(dir, 'schedule.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.booths = data.booths || {};

// pull the lists out of admin.html so the admin page stays the single place they are edited
function jsonConst(name) { const i = admin.indexOf('const ' + name + '='); if (i < 0) throw new Error('missing ' + name); const s = admin.slice(i + name.length + 7); let depth = 0, inStr = false, q = '', k = 0;
  for (; k < s.length; k++) { const c = s[k]; if (inStr) { if (c === '\\') { k++; continue; } if (c === q) inStr = false; continue; } if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; } if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (depth === 0) { k++; break; } } }
  return Function('"use strict"; return (' + s.slice(0, k) + ');')(); }
const SC_DJS = jsonConst('SC_DJS'), ST_G = jsonConst('ST_G'), AREAS = jsonConst('AREAS'), ITAEWON = jsonConst('ITAEWON');

const MIN = 60000, HOUR = 60 * MIN, now = Date.now(), from = Math.ceil(now / (5 * MIN)) * 5 * MIN;
const AHEAD = 30 * HOUR, REFILL_BELOW = 24 * HOUR, KEEP_PAST = 12 * HOUR;
const endOf = s => s.start + (s.dur || 0) * MIN;
const norm = d => String(d || '').trim().toLowerCase();

// every full set, with its genres and where it may play
const SETS = [];
for (const [key, d] of Object.entries(SC_DJS)) for (const [p, title, sec, art] of d.sets) {
  if (!sec || sec < 1200) continue;
  SETS.push({ key, url: 'https://soundcloud.com/' + p, title, dj: d.name, art: art || '', min: Math.ceil(sec / 60), g: d.g || [], kr: !!d.kr, only: d.kr ? ITAEWON : (d.only || null) }); }
const fits = (x, k) => k !== 'zone:jazz' && (!x.only || x.only.includes(k)) && x.g.some(g => (ST_G[k] || []).includes(g));
const branchOf = k => (AREAS.find(([, L]) => L.some(([x]) => x === k)) || [null, []])[1].map(([x]) => x);

// tidy: drop slots that ended long ago
let pruned = 0;
for (const k of Object.keys(data.booths)) { const L = data.booths[k]; const keep = L.filter(s => endOf(s) > now - KEEP_PAST); pruned += L.length - keep.length; data.booths[k] = keep.sort((a, b) => a.start - b.start); }

const stages = AREAS.flatMap(([, L]) => L.map(([k]) => k)).filter(k => k !== 'zone:jazz');
const coveredUntil = k => { let t = from; for (const s of (data.booths[k] || []).slice().sort((a, b) => a.start - b.start)) { if (s.start <= t + MIN && endOf(s) > t) t = endOf(s); } return t; };
const need = stages.filter(k => force || coveredUntil(k) < now + REFILL_BELOW);
if (!need.length && pruned < 40) { console.log('NOCHANGE'); process.exit(0); }

// seeded shuffle so a run is stable but sets rotate from day to day
let seed = Math.floor(now / HOUR) % 2147483647 || 1; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
let added = 0;
for (const k of need) {
  const S = data.booths[k] = data.booths[k] || [], sibs = branchOf(k).filter(x => x !== k);
  const pool = SETS.filter(x => fits(x, k)); if (!pool.length) continue;
  // least recently played on this stage first; Korean DJs lead in Itaewon
  const lastAt = {}; for (const s of S) lastAt[s.url] = Math.max(lastAt[s.url] || 0, endOf(s));
  const order = () => pool.map(x => ({ x, r: rnd() })).sort((a, b) => ((lastAt[a.x.url] || 0) - (lastAt[b.x.url] || 0)) || ((b.x.kr ? 1 : 0) - (a.x.kr ? 1 : 0)) || (a.r - b.r)).map(o => o.x);
  const clash = (x, a, b) => sibs.some(o => (data.booths[o] || []).some(s => norm(s.dj) === norm(x.dj) && s.start < b && endOf(s) > a))
    || stages.some(o => o !== k && (data.booths[o] || []).some(s => s.url === x.url && s.start < b && endOf(s) > a));
  let t = from, guard = 0;
  while (t < now + AHEAD && guard++ < 200) {
    const busy = S.find(s => s.start <= t && endOf(s) > t); if (busy) { t = endOf(busy); continue; }
    const next = S.filter(s => s.start > t).sort((a, b) => a.start - b.start)[0], gap = (next ? next.start : Infinity) - t;
    if (gap < 20 * MIN) { t = next.start; continue; }
    const pick = order().find(x => !clash(x, t, t + Math.min(x.min * MIN, gap)));
    if (!pick) { t += 10 * MIN; continue; }
    const dur = Math.min(pick.min, Math.floor(gap / MIN));
    S.push({ start: t, dur, url: pick.url, title: pick.title, dj: pick.dj, art: pick.art, djIntro: '', musicIntro: '', auto: true, v: 2 });
    S.sort((a, b) => a.start - b.start); lastAt[pick.url] = t + dur * MIN; t += dur * MIN; added++; } }

data.version = data.version || 1; data.updated = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
console.log('CHANGED added=' + added + ' pruned=' + pruned + ' stages=' + need.length);
