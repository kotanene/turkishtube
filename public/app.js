'use strict';
const $ = s => document.querySelector(s);
const app = $('#app');
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
let requestController = null;
const api = async (p, signal = requestController?.signal) => {
  const r = await fetch('/api/' + p, { signal });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Bir sorun oluştu.');
  return d;
};

const nf = new Intl.NumberFormat('tr', { notation: 'compact', maximumFractionDigits: 1 });
const U = { second: 'saniye', minute: 'dakika', hour: 'saat', day: 'gün', week: 'hafta', month: 'ay', year: 'yıl' };
const fmtViews = n => (n >= 0 ? nf.format(n) + ' görüntüleme' : '');
const fmtDur = s => {
  if (s < 0) return 'CANLI';
  if (!s) return '';
  const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const fmtDate = p => {
  if (!p) return '';
  if (/^\d{4}-\d\d-\d\d/.test(p)) return new Date(p).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const m = p.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  return m ? `${m[1]} ${U[m[2].toLowerCase()]} önce` : p;
};

const initial = n => h('span', { class: 'ini' }, (n || '?')[0].toUpperCase());
const avatar = (u, n) => u ? h('img', { src: u, alt: '', loading: 'lazy', onerror: e => e.target.replaceWith(initial(n)) }) : initial(n);
const watchHref = id => `#/watch?v=${id}`;
const SUBS_KEY = 'turkishtube-subscriptions';
const subscriptions = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SUBS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(s => s && /^[\w-]{10,40}$/.test(s.id)) : [];
  } catch { return []; }
};
const isSubscribed = id => subscriptions().some(s => s.id === id);
const saveSubscriptions = items => localStorage.setItem(SUBS_KEY, JSON.stringify(items));
const toggleSubscription = channel => {
  const items = subscriptions();
  const index = items.findIndex(item => item.id === channel.id);
  if (index >= 0) items.splice(index, 1);
  else items.unshift({ id: channel.id, name: channel.name || 'İsimsiz kanal', avatar: channel.avatar || '' });
  saveSubscriptions(items);
  return index < 0;
};
const subscribeButton = channel => {
  if (!channel?.id) return null;
  const button = h('button', { class: 'ghost subscribe' }, 'Abone ol');
  const refresh = () => {
    const active = isSubscribed(channel.id);
    button.classList.toggle('active', active);
    button.textContent = active ? 'Abonelikten çık' : 'Abone ol';
    button.setAttribute('aria-pressed', String(active));
  };
  button.addEventListener('click', () => { toggleSubscription(channel); refresh(); });
  refresh();
  return button;
};
const sponsorSegments = async id => {
  try {
    const categories = encodeURIComponent(JSON.stringify(['sponsor', 'selfpromo', 'interaction']));
    const response = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(id)}&categories=${categories}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map(item => item.segment)
      .filter(segment => Array.isArray(segment) && segment.length === 2 && segment.every(Number.isFinite) && segment[1] > segment[0]);
  } catch { return []; }
};

const channelLink = (v, className) => v.channelId
  ? h('a', { class: className, href: `#/channel/${v.channelId}` }, v.channel)
  : h('span', { class: className }, v.channel);
const card = (v, compact) => h('article', { class: 'card' + (compact ? ' compact' : '') },
  h('a', { class: 'thumb', href: watchHref(v.id), tabindex: '-1' },
    h('img', { src: v.thumb, alt: '', loading: 'lazy', onerror: e => { e.target.onerror = null; e.target.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`; } }),
    v.duration ? h('span', { class: 'dur' + (v.duration < 0 ? ' live' : '') }, fmtDur(v.duration)) : null),
  h('div', { class: 'meta' },
    !compact && v.channelId ? h('a', { class: 'av', href: `#/channel/${v.channelId}`, tabindex: '-1' }, avatar(v.avatar, v.channel)) : null,
    h('div', {},
      h('a', { class: 'title', href: watchHref(v.id) }, v.title),
      channelLink(v, 'ch'),
      h('p', { class: 'sub' }, h('span', {}, fmtViews(v.views)), h('span', {}, fmtDate(v.published))))));

const skeleton = () => h('div', { class: 'grid' }, Array.from({ length: 12 }, () => h('div', { class: 'sk skel' })));
const errorBox = (msg, retry) => h('div', { class: 'err' }, h('p', {}, msg), h('button', { class: 'ghost', onclick: retry }, 'Tekrar dene'));

// ---------- Sayfalar ----------
function gridPage(heading, items, q, next) {
  const grid = h('div', { class: 'grid' }, items.map(v => card(v)));
  const btn = h('button', { class: 'ghost more', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Yükleniyor…';
    try { const d = await api(`search?q=${encodeURIComponent(q)}&next=${encodeURIComponent(next)}`); grid.append(...d.items.map(v => card(v))); next = d.next; }
    catch (error) {
      if (error.name === 'AbortError') return;
      btn.disabled = false;
      btn.textContent = 'Tekrar dene';
      return;
    }
    if (next) { btn.disabled = false; btn.textContent = 'Daha fazla göster'; } else btn.remove();
  } }, 'Daha fazla göster');
  app.replaceChildren(h('h1', { class: 'pt' }, heading),
    items.length ? grid : h('p', { class: 'empty' }, 'Sonuç bulunamadı. Başka bir arama deneyin.'),
    next && q ? btn : null);
}

async function shortsPage(my) {
  document.title = 'Shorts – TürkishTube';
  app.replaceChildren(h('h1', { class: 'pt' }, 'Shorts'), skeleton());
  const d = await api('shorts');
  if (my !== seq) return;
  const grid = h('div', { class: 'grid shorts' }, d.items.map(v => card(v)));
  app.replaceChildren(h('h1', { class: 'pt' }, 'Shorts'),
    h('p', { class: 'subnote' }, 'Kısa videolar.'),
    d.items.length ? grid : h('p', { class: 'empty' }, 'Şu anda kısa video bulunamadı. Biraz sonra tekrar deneyin.'));
}

async function subscriptionsPage(my) {
  const saved = subscriptions();
  document.title = 'Abonelikler – TürkishTube';
  if (!saved.length) {
    app.replaceChildren(h('h1', { class: 'pt' }, 'Abonelikler'), h('p', { class: 'empty' }, 'Henüz bir kanala abone olmadın. Bir kanal sayfasından “Abone ol” düğmesine basabilirsin.'));
    return;
  }
  app.replaceChildren(h('h1', { class: 'pt' }, 'Abonelikler'), h('p', { class: 'subnote' }, 'Aboneliklerin bu cihazda saklanır.'), skeleton());
  const results = await Promise.allSettled(saved.map(channel => api('channel/' + encodeURIComponent(channel.id))));
  if (my !== seq) return;
  const videos = results.flatMap(result => result.status === 'fulfilled' ? result.value.items : []);
  const unique = [...new Map(videos.map(video => [video.id, video])).values()];
  app.replaceChildren(h('h1', { class: 'pt' }, 'Abonelikler'), h('p', { class: 'subnote' }, 'Aboneliklerin bu cihazda saklanır.'),
    unique.length ? h('div', { class: 'grid' }, unique.map(v => card(v))) : h('p', { class: 'empty' }, 'Abone olduğun kanallardan şu an video alınamadı.'));
}

async function homePage(my) {
  document.title = 'TürkishTube';
  app.replaceChildren(h('h1', { class: 'pt' }, 'Gündemdeki videolar'), skeleton());
  const d = await api('trending');
  if (my === seq) gridPage('Gündemdeki videolar', d.items);
}

async function searchPage(q, my) {
  if (!q) { location.hash = '#/'; return; }
  $('#q').value = q;
  document.title = `${q} – TürkishTube`;
  app.replaceChildren(h('h1', { class: 'pt' }, `“${q}” için sonuçlar`), skeleton());
  const d = await api('search?q=' + encodeURIComponent(q));
  if (my === seq) gridPage(`“${q}” için sonuçlar`, d.items, q, d.next);
}

async function channelPage(id, my) {
  app.replaceChildren(skeleton());
  const c = await api('channel/' + encodeURIComponent(id));
  if (my !== seq) return;
  document.title = `${c.name} – TürkishTube`;
  app.replaceChildren(
    h('div', { class: 'chead' }, avatar(c.avatar, c.name),
      h('div', {}, h('h1', {}, c.name), h('p', { class: 'sub' }, c.subs ? `${c.subs} abone` : ''),
        subscribeButton({ id: c.id, name: c.name, avatar: c.avatar }), c.description ? h('p', {}, c.description) : null)),
    h('div', { class: 'grid' }, c.items.map(v => card(v))));
}

let cur = null;
function stopPlayer() {
  if (!cur) return;
  cur.hls?.destroy();
  cur.video.pause();
  cur = null;
}

function mountPlayer(stage, bar, d) {
  let player = null;
  const embed = note => {
    if (cur === player) {
      player.hls?.destroy();
      player.video.pause();
      cur = null;
    }
    stage.replaceChildren(h('iframe', { src: `https://www.youtube-nocookie.com/embed/${d.id}?autoplay=1&rel=0`, title: d.title, allowfullscreen: true,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen' }));
    bar.replaceChildren(h('span', {}, note));
  };
  const src = d.sources || [];
  if (!src.length) return embed('Doğrudan akış bulunamadı. YouTube oynatıcısındaki reklam ve sponsor geçişleri denetlenemez.');
  const video = h('video', { controls: true, autoplay: true, playsinline: true });
  player = { video, hls: null };
  cur = player;
  let i = 0;
  const sel = h('select', { 'aria-label': 'Kalite' }, src.map((s, n) => h('option', { value: n }, s.label)));
  const speedSel = h('select', { 'aria-label': 'Oynatma Hızı' },
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(sp => h('option', { value: sp, selected: sp === 1 ? true : undefined }, `${sp}x`))
  );
  speedSel.addEventListener('change', () => { video.playbackRate = +speedSel.value; });
  const sponsorNote = h('span', { class: 'sponsor-note' }, 'Reklamsız akış · Sponsor geçişi hazırlanıyor');
  let segments = [], lastSkipped = -1;
  sponsorSegments(d.id).then(found => {
    if (cur !== player) return;
    segments = found;
    sponsorNote.textContent = found.length ? 'Reklamsız akış · Sponsor geçişi açık' : 'Reklamsız akış · Sponsor bölümü bulunamadı';
  });
  video.addEventListener('timeupdate', () => {
    if (cur !== player || !segments.length) return;
    const segment = segments.find(([start, end]) => video.currentTime >= start && video.currentTime < end);
    if (segment && segment[1] !== lastSkipped) {
      lastSkipped = segment[1];
      video.currentTime = segment[1];
    }
  });
  const load = (n, keep) => {
    i = n; sel.value = n;
    const s = src[n], t = keep ? video.currentTime : 0;
    if (cur !== player) return;
    player.hls?.destroy(); player.hls = null;
    if (s.kind === 'hls' && window.Hls && Hls.isSupported()) {
      const x = new Hls(); player.hls = x;
      x.loadSource(s.url); x.attachMedia(video);
      x.on(Hls.Events.ERROR, (_, e) => { if (e.fatal && cur === player) fail(); });
    } else video.src = s.url;
    if (t) video.addEventListener('loadedmetadata', () => { video.currentTime = t; }, { once: true });
    video.play().catch(() => {});
  };
  const fail = () => {
    if (cur !== player) return;
    return i + 1 < src.length ? load(i + 1) : embed('Bu video doğrudan oynatılamadı, YouTube oynatıcısına geçildi.');
  };
  video.addEventListener('error', fail);
  sel.addEventListener('change', () => load(+sel.value, true));
  stage.replaceChildren(video);
  bar.replaceChildren(src.length > 1 ? sel : null, speedSel, sponsorNote,
    h('button', { class: 'ghost', onclick: () => embed('YouTube oynatıcısı kullanılıyor.') }, 'YouTube oynatıcısıyla aç'));
  load(0);
}

const commentEl = c => h('div', { class: 'cm' }, avatar(c.avatar, c.author),
  h('div', {}, h('b', {}, c.author), ' ', h('small', {}, fmtDate(c.time)), h('p', {}, c.text),
    c.likes > 0 ? h('small', {}, `${nf.format(c.likes)} beğeni`) : null));

async function watchPage(id, my) {
  if (!/^[\w-]{11}$/.test(id || '')) { location.hash = '#/'; return; }
  app.replaceChildren(h('div', { class: 'watch' }, h('div', {}, h('div', { class: 'stage skel' })), h('div', {})));
  const d = await api('video/' + id);
  if (my !== seq) return;
  document.title = `${d.title} – TürkishTube`;
  const stage = h('div', { class: 'stage' }), bar = h('div', { class: 'bar' }), comments = h('section', { class: 'comments' });
  const cbtn = h('button', { class: 'ghost', onclick: async () => {
    cbtn.disabled = true; cbtn.textContent = 'Yükleniyor…';
    try {
      const c = await api('comments/' + id);
      comments.replaceChildren(h('h2', {}, 'Yorumlar'), c.items.length ? c.items.map(commentEl) : h('p', { class: 'empty' }, 'Yorum bulunamadı.'));
    } catch (error) {
      if (error.name === 'AbortError') return;
      cbtn.disabled = false;
      cbtn.textContent = 'Yorumlar alınamadı, tekrar dene';
    }
  } }, 'Yorumları göster');
  comments.append(cbtn);
  const stats = [fmtViews(d.views), fmtDate(d.published), d.likes >= 0 ? `${nf.format(d.likes)} beğeni` : ''].filter(Boolean).join('   ');
  app.replaceChildren(h('div', { class: 'watch' },
    h('div', {}, stage, bar, h('h1', { class: 'vt' }, d.title),
      h('div', { class: 'chrow' }, d.channelId ? h('a', { href: `#/channel/${d.channelId}` }, avatar(d.avatar, d.channel)) : avatar(d.avatar, d.channel),
        h('div', {}, h('b', {}, d.channel), h('small', {}, d.subs ? `${d.subs} abone` : ''),
          subscribeButton({ id: d.channelId, name: d.channel, avatar: d.avatar }))),
      h('details', { class: 'stats' }, h('summary', {}, stats || 'Açıklama'), h('p', {}, d.description || 'Açıklama yok.')),
      comments),
    h('aside', { class: 'side' }, d.related.map(v => card(v, true)))));
  mountPlayer(stage, bar, d);
}

// ---------- Yönlendirme ----------
let seq = 0;
async function route() {
  const my = ++seq;
  requestController?.abort();
  requestController = new AbortController();
  const [path, qs = ''] = location.hash.slice(1).split('?');
  const p = new URLSearchParams(qs);
  window.scrollTo(0, 0);
  stopPlayer();
  try {
    if (path.startsWith('/watch')) await watchPage(p.get('v'), my);
    else if (path.startsWith('/channel/')) await channelPage(path.split('/')[2], my);
    else if (path.startsWith('/search')) await searchPage(p.get('q') || '', my);
    else if (path.startsWith('/shorts')) await shortsPage(my);
    else if (path.startsWith('/subscriptions')) await subscriptionsPage(my);
    else await homePage(my);
  } catch (e) {
    if (e.name === 'AbortError' || my !== seq) return;
    app.replaceChildren(errorBox(e.message, route));
  }
}
addEventListener('hashchange', route);

$('#sf').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});
let tm, suggestionController = null, suggestionSeq = 0;
$('#q').addEventListener('input', e => {
  clearTimeout(tm);
  const q = e.target.value.trim();
  suggestionController?.abort();
  if (q.length < 2) { $('#sg').replaceChildren(); return; }
  const mine = ++suggestionSeq;
  tm = setTimeout(async () => {
    suggestionController = new AbortController();
    try {
      const d = await api('suggest?q=' + encodeURIComponent(q), suggestionController.signal);
      if (mine === suggestionSeq && $('#q').value.trim() === q) $('#sg').replaceChildren(...d.items.map(s => h('option', { value: s })));
    } catch (error) { if (error.name !== 'AbortError' && mine === suggestionSeq) $('#sg').replaceChildren(); }
  }, 250);
});
const welcome = $('#welcome');
const dismissWelcome = () => welcome?.classList.add('is-hidden');
$('#welcome-skip')?.addEventListener('click', dismissWelcome);
setTimeout(dismissWelcome, 4800);
addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});
route();
