import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const REGION = (process.env.REGION || 'TR').toUpperCase();
const list = (v, d) => [...new Set((v ? v.split(',') : d)
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(s => /^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(s)))];

// Açık kaynaklı API sunucuları (Piped ve Invidious). Biri çalışmazsa sıradakine geçilir.
const PIPED = list(process.env.PIPED_INSTANCES, [
  'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee', 'https://pipedapi.leptons.xyz']);
const INV = list(process.env.INVIDIOUS_INSTANCES, [
  'https://yt.chocolatemoo53.com']);
const MAX_TRIES = 4, TIMEOUT = 6000, COOLDOWN = 120000;

const ID = /^[\w-]{11}$/, CH = /^[\w-]{10,40}$/;
const nfc = new Intl.NumberFormat('tr', { notation: 'compact', maximumFractionDigits: 1 });
const fmtN = n => (typeof n === 'number' && n >= 0 ? nfc.format(n) : '');
const abs = (b, u) => !u ? '' : u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? b + u : u;
const text = (s = '') => String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = s => { try { return JSON.parse(Buffer.from(String(s), 'base64url').toString()); } catch { return null; } };

const cache = new Map();
const cached = async (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  // Aynı isteklerin aynı anda gelmesi, herkese açık sunuculara gereksiz yük bindirmesin.
  const value = Promise.resolve().then(fn);
  cache.set(key, { value, exp: Date.now() + ttl });
  try { await value; }
  catch (error) { if (cache.get(key)?.value === value) cache.delete(key); throw error; }
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
};

const down = new Map();
const getJSON = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (TurkishTube)' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
async function tryAll(tasks) {
  const now = Date.now(), ok = tasks.filter(t => !(down.get(t.host) > now)), bad = tasks.filter(t => down.get(t.host) > now);
  let last;
  for (const t of [...ok, ...bad].slice(0, MAX_TRIES)) {
    try { const v = await t.run(); down.delete(t.host); return v; }
    catch (e) { last = e; down.set(t.host, Date.now() + COOLDOWN); console.warn('Başarısız:', e.message); }
  }
  throw last || new Error('Sunucu yok');
}
// Piped ve Invidious sunucularını sırayla karıştırır
const both = (pf, inf) => {
  const out = [];
  for (let i = 0; i < Math.max(PIPED.length, INV.length); i++) {
    if (PIPED[i]) { const h = PIPED[i]; out.push({ host: h, run: () => pf(h) }); }
    if (INV[i]) { const h = INV[i]; out.push({ host: h, run: () => inf(h) }); }
  }
  return out;
};

// ---- Ortak biçime çevirme ----
const pId = u => (u || '').match(/(?:[?&]v=|youtu\.be\/)([\w-]{11})/)?.[1];
const pCard = i => {
  const id = pId(i.url);
  if (!id || (i.type && i.type !== 'stream')) return null;
  return { id, title: i.title || '', thumb: i.thumbnail || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    channel: i.uploaderName || '', channelId: (i.uploaderUrl || '').split('/channel/')[1] || '', avatar: i.uploaderAvatar || '',
    views: i.views ?? -1, duration: i.duration ?? 0, published: i.uploadedDate || '', verified: !!i.uploaderVerified };
};
const iCard = (v, b) => {
  if ((v.type && v.type !== 'video') || !v.videoId) return null;
  return { id: v.videoId, title: v.title || '', thumb: `${b}/vi/${v.videoId}/mqdefault.jpg`, channel: v.author || '',
    channelId: v.authorId || '', avatar: abs(b, v.authorThumbnails?.[0]?.url), views: v.viewCount ?? -1,
    duration: v.liveNow ? -1 : (v.lengthSeconds ?? 0), published: v.publishedText || '', verified: !!v.authorVerified };
};
const clean = a => (Array.isArray(a) ? a : []).filter(Boolean);

// ---- Arama ----
const pSearch = async (h, q, token) => {
  const d = await getJSON(token
    ? `${h}/nextpage/search?nextpage=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}&filter=videos`
    : `${h}/search?q=${encodeURIComponent(q)}&filter=videos`);
  return { items: clean(d.items?.map(pCard)), next: d.nextpage ? enc({ kind: 'p', host: h, token: d.nextpage }) : null };
};
const iSearch = async (h, q, page = 1) => {
  const d = await getJSON(`${h}/api/v1/search?q=${encodeURIComponent(q)}&type=video&page=${page}&region=${REGION}`);
  const items = clean(d.map?.(v => iCard(v, h)));
  return { items, next: items.length ? enc({ kind: 'i', host: h, page: page + 1 }) : null };
};
const search = (q, next) => {
  const nx = next ? dec(next) : null;
  if (nx) {
    if (nx.kind === 'p' && PIPED.includes(nx.host)) return pSearch(nx.host, q, nx.token);
    if (nx.kind === 'i' && INV.includes(nx.host)) return iSearch(nx.host, q, +nx.page || 2);
    throw new Error('Geçersiz sayfa');
  }
  return cached('s:' + q, 300000, () => tryAll(both(h => pSearch(h, q), h => iSearch(h, q))));
};

// ---- Video ----
const byQuality = (a, b) => b.h - a.h;
const pVideo = async (h, id) => {
  const s = await getJSON(`${h}/streams/${id}`);
  if (s.error) throw new Error(s.message || 'hata');
  const seen = new Set();
  const sources = (s.videoStreams || []).filter(v => !v.videoOnly && v.url)
    .map(v => ({ label: v.quality || 'Video', url: v.url, kind: 'mp4', h: v.height || parseInt(v.quality) || 0 }))
    .sort(byQuality).filter(v => !seen.has(v.label) && seen.add(v.label)).map(({ h, ...r }) => r);
  const live = s.duration === -1 || !!s.livestream;
  if (s.hls) sources[live ? 'unshift' : 'push']({ label: 'Otomatik (HLS)', url: s.hls, kind: 'hls' });
  return { id, title: s.title || '', description: text(s.description), channel: s.uploader || '',
    channelId: (s.uploaderUrl || '').split('/channel/')[1] || '', avatar: s.uploaderAvatar || '', subs: fmtN(s.uploaderSubscriberCount),
    views: s.views ?? -1, likes: s.likes ?? -1, published: s.uploadDate || '', live, sources, related: clean(s.relatedStreams?.map(pCard)) };
};
const iVideo = async (h, id) => {
  const v = await getJSON(`${h}/api/v1/videos/${id}?local=true`);
  if (v.error) throw new Error(v.error);
  const sources = (v.formatStreams || []).filter(f => f.url)
    .map(f => ({ label: f.qualityLabel || f.quality || 'Video', url: abs(h, f.url), kind: 'mp4', h: parseInt(f.qualityLabel || f.quality) || 0 }))
    .sort(byQuality).map(({ h, ...r }) => r);
  if (v.hlsUrl) sources[v.liveNow ? 'unshift' : 'push']({ label: 'Otomatik (HLS)', url: abs(h, v.hlsUrl), kind: 'hls' });
  return { id, title: v.title || '', description: text(v.description), channel: v.author || '', channelId: v.authorId || '',
    avatar: abs(h, v.authorThumbnails?.[1]?.url || v.authorThumbnails?.[0]?.url), subs: v.subCountText || '', views: v.viewCount ?? -1,
    likes: v.likeCount ?? -1, published: v.publishedText || '', live: !!v.liveNow, sources,
    related: clean(v.recommendedVideos?.map(r => iCard({ ...r, type: 'video' }, h))) };
};

// ---- Kanal ----
const pChannel = async (h, id) => {
  const c = await getJSON(`${h}/channel/${id}`);
  if (c.error) throw new Error(c.message || 'hata');
  return { id, name: c.name || '', avatar: c.avatarUrl || '', subs: fmtN(c.subscriberCount), description: text(c.description), verified: !!c.verified,
    items: clean(c.relatedStreams?.map(pCard)).map(v => ({ ...v, channel: v.channel || c.name, channelId: v.channelId || id, avatar: v.avatar || c.avatarUrl })) };
};
const iChannel = async (h, id) => {
  const [c, vs] = await Promise.all([getJSON(`${h}/api/v1/channels/${id}`), getJSON(`${h}/api/v1/channels/${id}/videos`)]);
  if (c.error) throw new Error(c.error);
  const arr = Array.isArray(vs) ? vs : vs.videos;
  const avatar = abs(h, c.authorThumbnails?.[2]?.url || c.authorThumbnails?.[0]?.url);
  return { id, name: c.author || '', avatar, subs: fmtN(c.subCount), description: text(c.description), verified: !!c.authorVerified,
    items: clean(arr?.map(v => iCard({ ...v, type: 'video' }, h))).map(v => ({ ...v, channel: v.channel || c.author, channelId: id, avatar })) };
};

// ---- Yorumlar ve öneriler ----
const pComments = async (h, id) => {
  const d = await getJSON(`${h}/comments/${id}`);
  return { items: (d.comments || []).slice(0, 40).map(c => ({ author: c.author || '', avatar: c.thumbnail || '', text: text(c.commentText), likes: c.likeCount ?? 0, time: c.commentedTime || '' })) };
};
const iComments = async (h, id) => {
  const d = await getJSON(`${h}/api/v1/comments/${id}`);
  return { items: (d.comments || []).slice(0, 40).map(c => ({ author: c.author || '', avatar: abs(h, c.authorThumbnails?.[0]?.url), text: text(c.content), likes: c.likeCount ?? 0, time: c.publishedText || '' })) };
};

// ---- Sunucu ----
const app = express();
app.disable('x-powered-by');
const wrap = async (res, fn) => {
  try { res.json(await fn()); }
  catch (e) {
    console.error('Hata:', e.message);
    res.status(e.status || 502).json({ error: e.status === 400 ? 'Geçersiz istek.' : 'Videolar şu an alınamadı. Birazdan tekrar deneyin.' });
  }
};
const bad = () => Object.assign(new Error('bad'), { status: 400 });

app.get('/api/trending', (req, res) => wrap(res, async () => {
  try {
    const items = await cached('trend', 600000, () => tryAll(both(
      async h => { const a = clean((await getJSON(`${h}/trending?region=${REGION}`)).map?.(pCard)); if (!a.length) throw new Error('boş'); return a; },
      async h => { const a = clean((await getJSON(`${h}/api/v1/trending?region=${REGION}`)).map?.(v => iCard(v, h))); if (!a.length) throw new Error('boş'); return a; })));
    return { items };
  } catch { return { items: (await search('gündem')).items }; }   // Gündem listesi kapalıysa arama ile doldur
}));
app.get('/api/search', (req, res) => wrap(res, async () => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return { items: [], next: null };
  return search(q, req.query.next);
}));
// Açık kaynak sunucularda ayrı bir Shorts uç noktası yok. Birkaç arama
// sorgusunu birleştirip kısa videoları seçiyoruz; böylece tek sorgunun
// uzun derleme videolarıyla dolması sayfayı boş bırakmıyor.
const SHORTS_QUERIES = ['#shorts', 'shorts', 'keşfet shorts', 'shorts türkçe'];
app.get('/api/shorts', (req, res) => wrap(res, async () => {
  const results = await Promise.allSettled(SHORTS_QUERIES.map(q =>
    cached('sh:' + q, 300000, () => search(q))));
  const items = [...new Map(results
    .flatMap(r => r.status === 'fulfilled' ? r.value.items : [])
    .map(v => [v.id, v])).values()];
  const short = items.filter(v => v.duration > 0 && v.duration <= 180);
  const medium = items.filter(v => v.duration > 180 && v.duration <= 600);
  const picked = short.length >= 8 ? short : [...short, ...medium];
  return { items: (picked.length ? picked : items).slice(0, 30) };
}));
app.get('/api/suggest', (req, res) => wrap(res, async () => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return { items: [] };
  const items = await cached('g:' + q, 600000, () => tryAll(both(
    async h => clean(await getJSON(`${h}/suggestions?query=${encodeURIComponent(q)}`)),
    async h => clean((await getJSON(`${h}/api/v1/search/suggestions?q=${encodeURIComponent(q)}`)).suggestions))));
  return { items: items.slice(0, 8) };
}));
app.get('/api/video/:id', (req, res) => wrap(res, async () => {
  const id = req.params.id; if (!ID.test(id)) throw bad();
  return cached('v:' + id, 180000, () => tryAll(both(h => pVideo(h, id), h => iVideo(h, id))));
}));
app.get('/api/channel/:id', (req, res) => wrap(res, async () => {
  const id = req.params.id; if (!CH.test(id)) throw bad();
  return cached('c:' + id, 600000, () => tryAll(both(h => pChannel(h, id), h => iChannel(h, id))));
}));
app.get('/api/comments/:id', (req, res) => wrap(res, async () => {
  const id = req.params.id; if (!ID.test(id)) throw bad();
  return cached('m:' + id, 600000, () => tryAll(both(h => pComments(h, id), h => iComments(h, id))));
}));
app.get('/api/status', (req, res) => res.json({ piped: PIPED, invidious: INV,
  cooldown: Object.fromEntries([...down].filter(([, t]) => t > Date.now()).map(([h, t]) => [h, Math.round((t - Date.now()) / 1000) + ' sn'])) }));

app.get('/vendor/hls.js', (q, r) => r.sendFile(path.join(dir, 'node_modules/hls.js/dist/hls.min.js'), error => {
  if (error && !r.headersSent) r.status(404).end();
}));
app.use(express.static(path.join(dir, 'public')));
const server = app.listen(PORT, () => console.log(`TürkishTube hazır: http://localhost:${PORT}`));
server.on('error', error => {
  console.error(`Sunucu başlatılamadı (${error.code || error.message}). PORT ayarını kontrol edin.`);
  process.exitCode = 1;
});
