/* 闻曲 Earworm — Web 播放器 v2 */
const $ = (id) => document.getElementById(id);
const audio = $('audio');

const POEMS = [
  '此曲只应天上有，人间能得几回闻。',
  '为我一挥手，如听万壑松。',
  '转轴拨弦三两声，未成曲调先有情。',
  '余音绕梁，三日不绝。',
  '谁家玉笛暗飞声，散入春风满洛城。',
  '嘈嘈切切错杂弹，大珠小珠落玉盘。',
];

const state = {
  queue: [], index: -1, playing: false,
  lyrics: [], curLyric: -1,
  qrKey: null, qrTimer: null,
  offset: 0, keyword: '',
  mode: localStorage.getItem('ew_mode') || 'order', // order | one | shuffle
  liked: {},           // id -> bool
  user: null,
  currentPl: null,     // 歌单详情上下文
};

/* ---------- 工具 ---------- */
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const escapeHtml = (s) => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const coverUrl = (u) => u ? `/api/cover?url=${encodeURIComponent(u)}` : '';
const plural = (n) => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n;
async function api(path) { const r = await fetch(path); return r.json(); }

/* ---------- 页面切换 ---------- */
document.querySelectorAll('#tabbar .tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('#tabbar .tab').forEach(x => x.classList.toggle('cur', x === t));
  ['page-discover', 'page-search', 'page-mine'].forEach(id => $(id).hidden = id !== t.dataset.page);
}));

/* ---------- 氛围视觉 ---------- */
const canvas = $('ambient');
const ctx = canvas.getContext('2d');
let motes = [];
function resizeCanvas() {
  canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  motes = Array.from({ length: 46 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: 1 + Math.random() * 2.6, vx: (Math.random() - .5) * .22, vy: -(0.12 + Math.random() * .3),
    a: .08 + Math.random() * .3,
  }));
}
addEventListener('resize', resizeCanvas); resizeCanvas();
function drawAmbient(t) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const beat = state.playing ? (Math.sin(t / 900) * .5 + .5) : 0;
  for (const m of motes) {
    m.x += m.vx; m.y += m.vy;
    if (m.y < -10) { m.y = innerHeight + 10; m.x = Math.random() * innerWidth; }
    if (m.x < -10) m.x = innerWidth + 10;
    if (m.x > innerWidth + 10) m.x = -10;
    const alpha = m.a * (state.playing ? .8 + beat * .9 : .7);
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
    g.addColorStop(0, `rgba(230,176,106,${alpha})`);
    g.addColorStop(1, 'rgba(230,176,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 4, 0, 7); ctx.fill();
  }
  requestAnimationFrame(drawAmbient);
}
requestAnimationFrame(drawAmbient);

/* ---------- 登录态 ---------- */
async function refreshLoginStatus() {
  try {
    const r = await api('/api/login/status');
    if (r.loggedIn) {
      state.user = r;
      $('topbar-user').hidden = false; $('login-btn').hidden = true;
      $('user-name').textContent = r.nickname || '';
      if (r.avatar) $('user-avatar').src = r.avatar;
      $('mine-user').hidden = false; $('mine-login-tip').hidden = true;
      $('mine-name').textContent = r.nickname || '';
      $('mine-vip').textContent = r.vipLabel && r.vipLabel !== '无VIP' ? r.vipLabel : '普通听众';
      if (r.avatar) $('mine-avatar').src = r.avatar;
      loadMyPlaylists();
    } else {
      state.user = null;
      $('topbar-user').hidden = true; $('login-btn').hidden = false;
      $('mine-user').hidden = true; $('mine-login-tip').hidden = false;
    }
  } catch { $('login-btn').hidden = false; }
}

/* ---------- 发现页 ---------- */
async function loadDiscover() {
  $('poem-line').textContent = POEMS[Math.floor(Math.random() * POEMS.length)];
  try {
    const d = await api('/api/discover/home');
    if (d.user && d.user.nickname) { /* 接口已带用户态，刷新 */ }
    const daily = d.dailySongs || [];
    if (daily.length) {
      $('daily-hero').hidden = false; $('daily-rail-section').hidden = false;
      const first = daily[0];
      $('hero-cover').src = coverUrl(first.cover);
      $('hero-name').textContent = first.name;
      $('hero-artist').textContent = first.artist + ' · ' + (first.album || '');
      $('hero-play').onclick = () => { state.queue = daily.slice(); state.offset = 0; renderQueue(); playIndex(0); };
      $('daily-hero').onclick = () => $('hero-play').click();
      const rail = $('daily-rail'); rail.innerHTML = '';
      daily.slice(0, 20).forEach(s => {
        const el = document.createElement('div');
        el.className = 'rail-card';
        el.innerHTML = `<img src="${coverUrl(s.cover)}" loading="lazy" alt=""><div class="rc-name">${escapeHtml(s.name)}</div><div class="rc-sub">${escapeHtml(s.artist)}</div>`;
        el.onclick = () => { state.queue = daily.slice(); renderQueue(); playIndex(daily.indexOf(s)); };
        rail.appendChild(el);
      });
    }
    const pls = d.playlists || [];
    if (pls.length) {
      $('pl-grid-section').hidden = false;
      const grid = $('pl-grid'); grid.innerHTML = '';
      pls.forEach(p => {
        const el = document.createElement('div');
        el.className = 'pl-cell';
        el.innerHTML = `<img src="${coverUrl(p.cover)}" loading="lazy" alt=""><div class="pc-name">${escapeHtml(p.name)}</div><div class="pc-sub">${escapeHtml(p.tag || '')} · ${p.trackCount || 0}首</div>`;
        el.onclick = () => openPlaylist(p.id);
        grid.appendChild(el);
      });
    }
  } catch (e) { console.warn('discover', e); }
}

/* ---------- 歌单 ---------- */
async function loadMyPlaylists() {
  try {
    const d = await api('/api/user/playlists');
    const list = $('my-playlists'); list.innerHTML = '';
    (d.playlists || []).forEach(p => {
      const el = document.createElement('div');
      el.className = 'pl-row';
      el.innerHTML = `<img src="${coverUrl(p.cover)}" loading="lazy" alt=""><div style="flex:1;min-width:0"><div class="pr-name">${escapeHtml(p.name)}</div><div class="pr-sub">${p.trackCount} 首 · ${p.specialType === 5 ? '我的心头好' : escapeHtml(p.creator || '')}</div></div>`;
      el.onclick = () => openPlaylist(p.id);
      list.appendChild(el);
    });
  } catch (e) { console.warn('my playlists', e); }
}
async function openPlaylist(id) {
  $('pl-detail').hidden = false;
  requestAnimationFrame(() => $('pl-detail').classList.add('show'));
  $('pl-tracks').innerHTML = '<div class="song"><div class="meta"><div class="name">正在取曲……</div></div></div>';
  try {
    const d = await api(`/api/playlist/tracks?id=${id}&limit=50`);
    const pl = d.playlist || {}, tracks = d.tracks || [];
    state.currentPl = tracks;
    $('pl-cover').src = coverUrl(pl.cover);
    $('pl-name').textContent = pl.name || '曲单';
    $('pl-count').textContent = `${pl.trackCount || tracks.length} 首 · ${plural(pl.playCount || 0)} 次听过`;
    $('pl-playall').onclick = () => {
      state.queue = tracks.slice(); renderQueue();
      closePlDetail(); playIndex(0);
    };
    const box = $('pl-tracks'); box.innerHTML = '';
    tracks.forEach((s, i) => box.appendChild(songEl(s, i, i + 1)));
  } catch (e) {
    $('pl-tracks').innerHTML = `<div class="song"><div class="meta"><div class="name">取曲失败：${escapeHtml(e.message)}</div></div></div>`;
  }
}
function closePlDetail() {
  $('pl-detail').classList.remove('show');
  setTimeout(() => { $('pl-detail').hidden = true; }, 380);
}
$('pl-back').addEventListener('click', closePlDetail);

/* ---------- 搜索 ---------- */
function getHist() { try { return JSON.parse(localStorage.getItem('ew_hist') || '[]'); } catch { return []; } }
function pushHist(kw) {
  let h = getHist().filter(x => x !== kw);
  h.unshift(kw); h = h.slice(0, 10);
  localStorage.setItem('ew_hist', JSON.stringify(h)); renderHist();
}
function renderHist() {
  const h = getHist();
  $('search-history-wrap').hidden = !h.length;
  const box = $('search-history'); box.innerHTML = '';
  h.forEach(kw => {
    const c = document.createElement('span');
    c.className = 'chip'; c.textContent = kw;
    c.onclick = () => { $('search-input').value = kw; doSearch(kw); };
    box.appendChild(c);
  });
}
$('hist-clear').addEventListener('click', () => { localStorage.removeItem('ew_hist'); renderHist(); });
$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); const kw = e.target.value.trim(); if (kw) { pushHist(kw); doSearch(kw); } }
});
async function doSearch(kw, append) {
  if (!append) { state.offset = 0; $('results').innerHTML = '<div class="song"><div class="meta"><div class="name">正在寻曲……</div></div></div>'; }
  try {
    const data = await api(`/api/search?keywords=${encodeURIComponent(kw)}&limit=20&offset=${state.offset}`);
    const songs = data.songs || [];
    if (!append) { state.queue = []; $('results').innerHTML = ''; }
    const start = state.queue.length;
    state.queue.push(...songs);
    songs.forEach((s, i) => $('results').appendChild(songEl(s, start + i)));
    state.offset += songs.length;
    $('more-btn-wrap').hidden = songs.length < 20;
    renderQueue();
  } catch (e) {
    $('results').innerHTML = `<div class="song"><div class="meta"><div class="name">寻曲失败：${escapeHtml(e.message)}</div></div></div>`;
  }
}
$('more-btn').addEventListener('click', () => doSearch(state.keyword || $('search-input').value.trim(), true));

/* ---------- 歌曲条目 ---------- */
function songEl(s, i, idxLabel) {
  const el = document.createElement('div');
  el.className = 'song';
  el.dataset.i = i;
  el.innerHTML = `
    <div class="song-idx">${idxLabel != null ? idxLabel : ''}</div>
    <img src="${coverUrl(s.cover) || '/app/icon.svg'}" loading="lazy" alt="">
    <div class="meta">
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="artist">${escapeHtml(s.artist)}${s.fee === 1 ? ' · VIP' : ''}</div>
    </div>`;
  el.addEventListener('click', () => playIndex(i));
  return el;
}
function markPlaying() {
  document.querySelectorAll('.song').forEach(el =>
    el.classList.toggle('playing', Number(el.dataset.i) === state.index && el.closest('.results,.queue-list')));
  renderQueue();
}

/* ---------- 播放 ---------- */
function renderQueue() {
  const box = $('queue-list'); box.innerHTML = '';
  state.queue.forEach((s, i) => {
    const el = songEl(s, i, i + 1);
    if (i === state.index) el.classList.add('playing');
    box.appendChild(el);
  });
}
async function playIndex(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const s = state.queue[i];
  markPlaying();
  $('mini').hidden = false;
  $('mini-name').textContent = s.name;
  $('mini-artist').textContent = s.artist;
  $('stage-name').textContent = s.name;
  $('stage-artist').textContent = s.artist;
  const cv = coverUrl(s.cover);
  $('mini-cover').src = cv || '/app/icon.svg';
  $('stage-cover').src = cv || '/app/icon.svg';
  $('stage-bg').style.backgroundImage = cv ? `url(${cv})` : 'none';
  $('fee-badge').hidden = s.fee !== 1;
  $('quality-badge').hidden = true;
  loadLyrics(s.id);
  refreshLikeState(s.id);
  $('play-icon').textContent = '…'; $('mini-icon').textContent = '…';
  try {
    const info = await api(`/api/song/url?id=${s.id}`);
    const url = info.url || (info.playback && info.playback.url);
    if (!url) throw new Error(info.error || info.message || '取不到播放地址（VIP 或版权歌曲需登录）');
    if (info.level || info.br) {
      $('quality-badge').hidden = false;
      $('quality-badge').textContent = (info.level || (info.br >= 999000 ? '无损' : info.br >= 320000 ? 'Hi-Res' : '标准'));
    }
    audio.src = url;
    audio.play();
  } catch (err) {
    $('mini-artist').textContent = '⚠ ' + err.message;
    setPlayingUI(false);
  }
}
function setPlayingUI(p) {
  state.playing = p;
  $('play-icon').textContent = p ? '❚❚' : '▶';
  $('mini-icon').textContent = p ? '❚❚' : '▶';
  $('stage').classList.toggle('paused', !p);
}
function toggle() { if (!audio.src) return; audio.paused ? audio.play() : audio.pause(); }
audio.addEventListener('play', () => setPlayingUI(true));
audio.addEventListener('pause', () => setPlayingUI(false));
audio.addEventListener('ended', () => {
  if (state.mode === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (state.mode === 'shuffle' && state.queue.length) return playIndex(Math.floor(Math.random() * state.queue.length));
  playIndex(state.index + 1);
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0, c = audio.currentTime || 0;
  $('t-cur').textContent = fmt(c); $('t-dur').textContent = fmt(d);
  $('seek').value = d ? Math.round(c / d * 1000) : 0;
  $('mini-progress').firstElementChild.style.width = d ? (c / d * 100) + '%' : '0';
  syncLyric(c);
});
$('seek').addEventListener('input', (e) => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; });
$('toggle').addEventListener('click', toggle);
$('mini-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
$('prev').addEventListener('click', () => playIndex(state.index - 1));
$('next').addEventListener('click', () => playIndex(state.index + 1));

/* 播放模式 */
function applyMode() {
  audio.loop = false;
  $('mode-icon').textContent = state.mode === 'one' ? '⟳' : state.mode === 'shuffle' ? '⤨' : '⇉';
  localStorage.setItem('ew_mode', state.mode);
}
$('mode-btn').addEventListener('click', () => {
  state.mode = state.mode === 'order' ? 'one' : state.mode === 'one' ? 'shuffle' : 'order';
  applyMode();
});
applyMode();

/* ---------- 红心 ---------- */
async function refreshLikeState(id) {
  if (!state.user || !id) return;
  try {
    const r = await api(`/api/song/like/check?ids=${id}`);
    const ids = r.likedIds || [];
    const likedObj = r.liked || {};
    const liked = Array.isArray(ids) ? ids.includes(String(id)) : !!likedObj[id];
    state.liked[id] = liked;
    updateHeartUI();
  } catch { /* ignore */ }
}
function updateHeartUI() {
  const cur = state.queue[state.index];
  const on = cur && state.liked[cur.id];
  $('mini-like').textContent = on ? '♥' : '♡';
  $('mini-like').classList.toggle('on', !!on);
  $('like-btn').textContent = on ? '♥' : '♡';
  $('like-btn').classList.toggle('on', !!on);
}
async function toggleLike() {
  const cur = state.queue[state.index];
  if (!cur) return;
  if (!state.user) { openLogin(); return; }
  const next = !state.liked[cur.id];
  try {
    await fetch('/api/song/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cur.id, like: next }) });
    state.liked[cur.id] = next;
    updateHeartUI();
  } catch { /* ignore */ }
}
$('like-btn').addEventListener('click', toggleLike);
$('mini-like').addEventListener('click', (e) => { e.stopPropagation(); toggleLike(); });

/* ---------- 播放页开关 ---------- */
function openStage() { $('stage').hidden = false; requestAnimationFrame(() => $('stage').classList.add('show')); }
function closeStage() { $('stage').classList.remove('show'); setTimeout(() => { $('stage').hidden = true; }, 400); }
$('mini-expand').addEventListener('click', (e) => { e.stopPropagation(); openStage(); });
$('mini').addEventListener('click', openStage);
$('stage-close').addEventListener('click', closeStage);

/* ---------- 队列抽屉 ---------- */
function openQueue() {
  renderQueue();
  $('queue-drawer').hidden = false; $('queue-mask').hidden = false;
  requestAnimationFrame(() => $('queue-drawer').classList.add('show'));
}
function closeQueue() {
  $('queue-drawer').classList.remove('show');
  setTimeout(() => { $('queue-drawer').hidden = true; $('queue-mask').hidden = true; }, 340);
}
$('queue-btn').addEventListener('click', openQueue);
$('queue-close').addEventListener('click', closeQueue);
$('queue-mask').addEventListener('click', closeQueue);

/* ---------- 歌词 ---------- */
function parseLrc(text) {
  const out = [];
  const raw = String(text || '').trim();
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      const list = Array.isArray(arr) ? arr : (arr.lines || [arr]);
      list.forEach(item => {
        const tx = (item.c || []).map(c => c.tx || '').join('').trim();
        const t = Number(item.t || 0);
        if (tx) out.push({ t: t > 100000 ? t / 1000 : t, text: tx });
      });
      return out.sort((a, b) => a.t - b.t);
    } catch { /* fallthrough */ }
  }
  raw.split('\n').forEach(line => {
    const m = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const txt = line.replace(/\[[^\]]*\]/g, '').trim();
    if (m.length && txt) m.forEach(t => out.push({ t: (+t[1]) * 60 + (+t[2]), text: txt }));
  });
  return out.sort((a, b) => a.t - b.t);
}
async function loadLyrics(id) {
  $('lyrics').innerHTML = '';
  state.lyrics = []; state.curLyric = -1;
  try {
    const d = await api(`/api/lyric?id=${id}`);
    state.lyrics = parseLrc(d.lrc || d.lyric || d.text || '');
    const trans = parseLrc(d.tlyric || d.translation || '');
    if (trans.length) state.lyrics = state.lyrics.map(l => {
      const tr = trans.find(t => Math.abs(t.t - l.t) < 0.5);
      return tr ? { t: l.t, text: l.text + '\n' + tr.text } : l;
    });
    state.lyrics.forEach((l, i) => {
      const el = document.createElement('div');
      el.className = 'line'; el.dataset.i = i;
      el.innerHTML = escapeHtml(l.text).replace('\n', '<br>');
      el.addEventListener('click', () => { if (audio.duration) audio.currentTime = l.t; });
      $('lyrics').appendChild(el);
    });
  } catch { /* 无歌词静默 */ }
}
function syncLyric(c) {
  if (!state.lyrics.length) return;
  let idx = -1;
  for (let i = 0; i < state.lyrics.length; i++) { if (state.lyrics[i].t <= c + .2) idx = i; else break; }
  if (idx === state.curLyric) return;
  state.curLyric = idx;
  const nodes = $('lyrics').children;
  for (const n of nodes) n.classList.toggle('cur', Number(n.dataset.i) === idx);
  const cur = nodes[idx];
  if (cur) $('lyrics').scrollTop = cur.offsetTop - $('lyrics').clientHeight / 2 + cur.offsetHeight;
}

/* ---------- 扫码登录 ---------- */
async function openLogin() {
  $('login-modal').hidden = false;
  $('qr-status').textContent = '正在生成二维码…';
  try {
    const k = await api('/api/login/qr/key');
    if (!k.key) throw new Error(k.error || 'key 获取失败');
    state.qrKey = k.key;
    const c = await api(`/api/login/qr/create?key=${k.key}`);
    $('qr-img').src = c.img || c.qrimg || '';
    pollQr();
  } catch (err) { $('qr-status').textContent = '⚠ ' + err.message; }
}
function pollQr() {
  clearInterval(state.qrTimer);
  state.qrTimer = setInterval(async () => {
    if (!state.qrKey) return clearInterval(state.qrTimer);
    try {
      const r = await api(`/api/login/qr/check?key=${state.qrKey}`);
      const code = r.code ?? r.statusCode;
      if (code === 800) { $('qr-status').textContent = '二维码已过期，请重开'; clearInterval(state.qrTimer); }
      else if (code === 802) $('qr-status').textContent = '已扫码，请在手机上确认';
      else if (code === 803) {
        $('qr-status').textContent = '✓ 登录成功';
        clearInterval(state.qrTimer); state.qrKey = null;
        setTimeout(() => { $('login-modal').hidden = true; refreshLoginStatus(); }, 800);
      }
      else $('qr-status').textContent = '等待扫码…';
    } catch { /* 网络抖动忽略 */ }
  }, 2500);
}
$('login-btn').addEventListener('click', openLogin);
$('login-close').addEventListener('click', () => { $('login-modal').hidden = true; clearInterval(state.qrTimer); state.qrKey = null; });

/* ---------- 启动 ---------- */
renderHist();
refreshLoginStatus();
loadDiscover();
