// Playa Night schedule server (Cloudflare Worker)
//
// What it does
//   GET  /time       -> { now }                server clock, so every player lines up on the same moment
//   GET  /schedule   -> { booths, updated }    the booth timetable
//   PUT  /schedule   (Authorization: Bearer <ADMIN_PASSWORD>)  save a new timetable from admin.html
//
// Cloudflare setup (Workers > your worker > Settings)
//   KV namespace binding : SCHEDULE         (create a KV namespace and bind it with this exact name)
//   Variable (Secret)    : ADMIN_PASSWORD   (the password you type into admin.html)
//   Variable             : ALLOWED_ORIGIN   (optional, e.g. https://your-site.netlify.app ; leave empty to allow any site)

const KEY_RE = /^[a-z0-9:_-]{1,40}$/i;
const MIX_RE = /^https:\/\/(www\.|m\.)?mixcloud\.com\/[^\s?#]+\/[^\s?#]+\/?$/i;

function clean(body) {
  if (!body || typeof body !== 'object' || typeof body.booths !== 'object' || body.booths === null) return null;
  const out = { booths: {} };
  for (const [k, arr] of Object.entries(body.booths)) {
    if (!KEY_RE.test(k) || !Array.isArray(arr)) continue;
    out.booths[k] = arr.slice(0, 300)
      .filter(s => s && Number.isFinite(s.start) && typeof s.url === 'string' && MIX_RE.test(s.url.trim()))
      .map(s => ({
        start: Math.round(s.start),
        url: s.url.trim().slice(0, 300),
        title: String(s.title || '').slice(0, 120),
        dur: Number.isFinite(s.dur) && s.dur > 0 ? Math.min(Math.round(s.dur), 1440) : null
      }))
      .sort((a, b) => a.start - b.start);
  }
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').trim();
    const cors = {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (allowed && origin && origin !== allowed) return reply({ error: 'origin not allowed' }, 403);

    if (url.pathname === '/time') return reply({ now: Date.now() });

    if (url.pathname === '/schedule') {
      if (req.method === 'GET') {
        const raw = env.SCHEDULE ? await env.SCHEDULE.get('schedule') : null;
        return reply(raw ? JSON.parse(raw) : { booths: {}, updated: 0 });
      }
      if (req.method === 'PUT') {
        const auth = req.headers.get('Authorization') || '';
        if (!env.ADMIN_PASSWORD || auth !== 'Bearer ' + env.ADMIN_PASSWORD) return reply({ error: 'unauthorized' }, 401);
        if (!env.SCHEDULE) return reply({ error: 'KV binding SCHEDULE is missing' }, 500);
        let body;
        try { body = await req.json(); } catch (e) { return reply({ error: 'bad json' }, 400); }
        const data = clean(body);
        if (!data) return reply({ error: 'invalid schedule' }, 400);
        data.updated = Date.now();
        await env.SCHEDULE.put('schedule', JSON.stringify(data));
        return reply({ ok: true, updated: data.updated });
      }
    }
    return reply({ error: 'not found' }, 404);
  }
};
