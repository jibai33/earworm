/* 闻曲 Earworm — Web 播放器 v1.1：逐字卡拉 + 持久化 + 音质 + 快捷键 */
const $ = (id) => document.getElementById(id);
const audio = $('audio');

/* API 基地址：本地/自部署为空；GitHub Pages 部署时默认指向云端服务 */
const IS_PAGES = location.hostname.endsWith('github.io');
const CLOUD_API = 'https://earworm-music.app.workbuddy.host';
const CLOUD_SHARECODE = '66G2SQ67OM';
let API_BASE = localStorage.getItem('ew_api') || (IS_PAGES ? CLOUD_API : '');
function apiUrl(path) {
  if (!API_BASE) return path;
  const sep = path.includes('?') ? '&' : '?';
  const code = API_BASE === CLOUD_API ? CLOUD_SHARECODE : localStorage.getItem('ew_sharecode') || '';
  return API_BASE + path + sep + (code ? 'sharecode=' + code : '');
}

const POEMS = [
  '此曲只应天上有，人间能得几回闻。',
  '为我一挥手，如听万壑松。',
  '转轴拨弦三两声，未成曲调先有情。',
  '余音绕梁，三日不绝。',
  '谁家玉笛暗飞声，散入春风满洛城。',
  '嘈嘈切切错杂弹，大珠小珠落玉盘。',
];

const QUALITIES = [
  { key: 'standard', label: '标准' },
  { key: 'exhigh', label: '极高' },
  { key: 'lossless', label: '无损' },
  { key: 'hires', label: 'Hi-Res' },
];

const state = {
  queue: [], index: -1, playing: false,
  lyrics: [], curLyric: -1, karaoke: false,
  qrKey: null, qrTimer: null,
  offset: 0, keyword: '',
  mode: localStorage.getItem('ew_mode') || 'order',
  quality: localStorage.getItem('ew_quality') || 'exhigh',
  liked: {}, user: null,
  pendingSeek: 0,
  provider: localStorage.getItem('ew_provider') || 'netease',
};

/* ---------- 工具 ---------- */
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const escapeHtml = (s) => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const coverUrl = (u) => u ? apiUrl(`/api/cover?url=${encodeURIComponent(u)}`) : '';
const plural = (n) => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n;
async function api(path, opts) { const r = await fetch(apiUrl(path), opts); return r.json(); }

/* ---------- API 地址设置（Pages 模式） ---------- */
if (IS_PAGES) {
  document.addEventListener('DOMContentLoaded', () => {
    const tip = document.createElement('div');
    tip.className = 'api-tip';
    tip.innerHTML = API_BASE
      ? `在线版 · 服务：<code>${escapeHtml(API_BASE)}</code> <button class="text-btn" onclick="setApiBase()">修改</button>`
      : `在线版需要指定服务地址 <button class="brush-btn" onclick="setApiBase()">设置</button>`;
    document.body.prepend(tip);
  });
}
function setApiBase() {
  const v = prompt('填入闻曲服务地址（如 https://your-server.com）', API_BASE);
  if (v !== null) { localStorage.setItem('ew_api', v.trim()); location.reload(); }
}

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
  const beat = state.playing ? (state.level || (Math.sin(t / 900) * .5 + .5)) : 0;
  for (const m of motes) {
    m.x += m.vx; m.y += m.vy;
    if (m.y < -10) { m.y = innerHeight + 10; m.x = Math.random() * innerWidth; }
    if (m.x < -10) m.x = innerWidth + 10;
    if (m.x > innerWidth + 10) m.x = -10;
    const alpha = m.a * (state.playing ? .8 + beat * .9 : .7);
    const rr = m.r * (4 + beat * 3);
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, rr);
    g.addColorStop(0, `rgba(230,176,106,${alpha})`);
    g.addColorStop(1, 'rgba(230,176,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, rr, 0, 7); ctx.fill();
  }
  requestAnimationFrame(drawAmbient);
}
requestAnimationFrame(drawAmbient);

/* ---------- 频谱可视化（Web Audio，复刻原版 02-visual/03-beat） ---------- */
let audioCtx = null, analyser = null, freqData = null;
function ensureAudioGraph() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = .8;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (e) { console.warn('频谱不可用', e); }
}
const spCanvas = $('spectrum');
const spCtx = spCanvas.getContext('2d');
let lowAvg = 0;
function drawSpectrum() {
  requestAnimationFrame(drawSpectrum);
  if (!spCanvas.width) resizeSpectrum();
  spCtx.clearRect(0, 0, spCanvas.width, spCanvas.height);
  if (!analyser || !state.playing) { state.level = 0; return; }
  analyser.getByteFrequencyData(freqData);
  const bars = 48, step = Math.floor(freqData.length / bars);
  const w = spCanvas.width / bars;
  let sum = 0;
  for (let i = 0; i < bars; i++) {
    let v = 0;
    for (let k = 0; k < step; k++) v += freqData[i * step + k];
    v = v / step / 255;
    sum += v;
    const h = Math.max(2, v * spCanvas.height * .9);
    const grad = spCtx.createLinearGradient(0, spCanvas.height, 0, spCanvas.height - h);
    grad.addColorStop(0, 'rgba(230,176,106,.15)');
    grad.addColorStop(1, `rgba(230,176,106,${.25 + v * .6})`);
    spCtx.fillStyle = grad;
    spCtx.fillRect(i * w + w * .18, spCanvas.height - h, w * .64, h);
  }
  lowAvg = lowAvg * .8 + (sum / bars) * .2;
  state.level = Math.min(1.4, lowAvg * 2.2);
  document.documentElement.style.setProperty('--beat', state.level.toFixed(3));
}
function resizeSpectrum() {
  if (!spCanvas.offsetParent) return;
  spCanvas.width = spCanvas.clientWidth * devicePixelRatio;
  spCanvas.height = spCanvas.clientHeight * devicePixelRatio;
}
addEventListener('resize', resizeSpectrum);
requestAnimationFrame(drawSpectrum);

/* ---------- 登录态 ---------- */
async function refreshLoginStatus() {
  try {
    const r = await api('/api/login/status');
    if (r.loggedIn) {
      state.user = r;
      $('topbar-user').hidden = false; $('login-btn').hidden = true;
      $('logout-btn').hidden = false;
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
      $('logout-btn').hidden = true;
      $('mine-user').hidden = true; $('mine-login-tip').hidden = false;
    }
  } catch { $('login-btn').hidden = false; }
}
function logout() {
  if (!confirm('退出登录并清除本机 cookie？')) return;
  api('/api/logout').then(refreshLoginStatus);
}

/* ---------- 发现页 ---------- */
async function loadDiscover() {
  $('poem-line').textContent = POEMS[Math.floor(Math.random() * POEMS.length)];
  try {
    const d = await api('/api/discover/home');
    const daily = d.dailySongs || [];
    if (daily.length) {
      $('daily-hero').hidden = false; $('daily-rail-section').hidden = false;
      const first = daily[0];
      $('hero-cover').src = coverUrl(first.cover);
      $('hero-name').textContent = first.name;
      $('hero-artist').textContent = first.artist + (first.album ? ' · ' + first.album : '');
      $('hero-play').onclick = () => { state.queue = daily.slice(); renderQueue(); playIndex(0); };
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
    $('pl-playall').onclick = () => { state.queue = tracks.slice(); renderQueue(); closePlDetail(); playIndex(0); };
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

/* ---------- 小宇宙播客详情 ---------- */
async function openXYPodcast(pid) {
  $('pl-detail').hidden = false;
  requestAnimationFrame(() => $('pl-detail').classList.add('show'));
  $('pl-tracks').innerHTML = '<div class="song"><div class="meta"><div class="name">正在取节目……</div></div></div>';
  try {
    const d = await api(`/api/xy/podcast?id=${pid}`);
    const p = d.podcast || {}, episodes = d.episodes || [];
    state.currentPl = episodes;
    $('pl-cover').src = coverUrl(p.cover);
    $('pl-name').textContent = p.name || '播客';
    $('pl-count').textContent = `小宇宙 · ${episodes.length}${d.total ? ' / ' + d.total : ''} 集 · ${p.artist || ''}`;
    $('pl-playall').onclick = () => { state.queue = episodes.slice(); renderQueue(); closePlDetail(); playIndex(0); };
    const box = $('pl-tracks'); box.innerHTML = '';
    episodes.forEach((s, i) => box.appendChild(songEl(s, i, i + 1)));
  } catch (e) {
    $('pl-tracks').innerHTML = `<div class="song"><div class="meta"><div class="name">取节目失败：${escapeHtml(e.message)}</div></div></div>`;
  }
}

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
/* ---------- 搜索平台切换 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('src-tabs').querySelectorAll('.src-tab').forEach(btn => {
    if (btn.dataset.src === state.provider) {
      btn.parentElement.querySelectorAll('.src-tab').forEach(b => b.classList.remove('cur'));
      btn.classList.add('cur');
    }
    btn.addEventListener('click', () => {
      state.provider = btn.dataset.src;
      localStorage.setItem('ew_provider', state.provider);
      btn.parentElement.querySelectorAll('.src-tab').forEach(b => b.classList.toggle('cur', b === btn));
      const kw = $('search-input').value.trim();
      if (kw) doSearch(kw);
    });
  });
});

async function doSearch(kw, append) {
  if (!append) { state.offset = 0; $('results').innerHTML = '<div class="song"><div class="meta"><div class="name">正在寻曲……</div></div></div>'; }
  try {
    const ep = state.provider === 'qq' ? '/api/qq/search'
      : state.provider === 'qishui' ? '/api/qishui/search'
      : state.provider === 'xy' ? '/api/xy/search'
      : '/api/search';
    const data = await api(`${ep}?keywords=${encodeURIComponent(kw)}&limit=20&offset=${state.offset}`);
    if (data.error === 'NEED_LOGIN') {
      $('results').innerHTML = `<div class="song"><div class="meta"><div class="name">需要登录 ${state.provider === 'xy' ? '小宇宙' : ''}</div><div class="artist">${escapeHtml(data.message || '请先登录该平台')}</div></div></div>`;
      $('more-btn-wrap').hidden = true;
      return;
    }
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
  const SRC_LABEL = { qq: 'QQ', qishui: '汽水', xy: '小宇宙' };
  const tag = s.provider && s.provider !== 'netease'
    ? `<span class="src-tag">${SRC_LABEL[s.provider] || s.provider}${s.isPodcast ? ' · 播客' : ''}</span>` : '';
  el.innerHTML = `
    <div class="song-idx">${idxLabel != null ? idxLabel : ''}</div>
    <img src="${coverUrl(s.cover) || 'icon.svg'}" loading="lazy" alt="">
    <div class="meta">
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="artist">${escapeHtml(s.artist)}${s.fee === 1 ? ' · VIP' : ''}${tag}</div>
    </div>`;
  el.addEventListener('click', () => {
    if (s.provider === 'xy' && s.isPodcast) openXYPodcast(s.pid || s.id);
    else playIndex(i);
  });
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
  saveState();
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
  $('mini-cover').src = cv || 'icon.svg';
  $('stage-cover').src = cv || 'icon.svg';
  $('stage-bg').style.backgroundImage = cv ? `url(${cv})` : 'none';
  $('fee-badge').hidden = s.fee !== 1;
  $('quality-badge').hidden = true;
  loadLyrics(s);
  refreshLikeState(s);
  $('play-icon').textContent = '…'; $('mini-icon').textContent = '…';
  try {
    let url = '';
    if (s.provider === 'qq') {
      const info = await api(`/api/qq/song/url?mid=${encodeURIComponent(s.mid || s.id)}&mediaMid=${encodeURIComponent(s.mediaMid || '')}&quality=${state.quality === 'lossless' ? 'lossless' : 'standard'}`);
      if (!info.url) throw new Error(info.error || info.message || '取不到 QQ 播放地址（VIP 歌曲需登录）');
      // QQ 源多为 http，https 页面下需走代理
      url = apiUrl(`/api/audio?url=${encodeURIComponent(info.url)}`);
      if (info.level) { $('quality-badge').hidden = false; $('quality-badge').textContent = info.level; }
    } else if (s.provider === 'qishui') {
      const info = await api(`/api/qishui/song/url?id=${encodeURIComponent(s.id)}&quality=${state.quality}`);
      if (!info.url) throw new Error(info.message || info.error || '取不到汽水播放地址（需登录汽水）');
      url = apiUrl(`/api/audio?url=${encodeURIComponent(info.url)}`);
      if (info.level || info.qualityLabel) { $('quality-badge').hidden = false; $('quality-badge').textContent = info.level || info.qualityLabel; }
    } else if (s.provider === 'xy') {
      const e = await api(`/api/xy/episode?id=${encodeURIComponent(s.epid || s.id)}`);
      const ep = e.episode || {};
      if (!e.enclosure || !e.enclosure.url) throw new Error('取不到单集音频');
      url = apiUrl(`/api/audio?url=${encodeURIComponent(e.enclosure.url)}`);
      s._shownotes = ep.shownotes || '';
    } else {
      const info = await api(`/api/song/url?id=${s.id}&quality=${state.quality}`);
      url = info.url || (info.playback && info.playback.url);
      if (!url) throw new Error(info.error || info.message || '取不到播放地址（VIP 或版权歌曲需登录）');
      // 统一走代理（同源），保证 Web Audio 频谱可用
      url = apiUrl(`/api/audio?url=${encodeURIComponent(url)}`);
      if (info.level) {
        $('quality-badge').hidden = false;
        $('quality-badge').textContent = info.level;
      }
    }
    const seek = state.pendingSeek; state.pendingSeek = 0;
    audio.src = url;
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (seek) audio.addEventListener('loadedmetadata', function once() {
      audio.currentTime = seek; audio.removeEventListener('loadedmetadata', once);
    }, { once: true });
    audio.play();
    saveState();
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
audio.addEventListener('play', () => { setPlayingUI(true); saveState(); });
audio.addEventListener('pause', () => { setPlayingUI(false); saveState(); });
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
  if (Math.floor(c) % 5 === 0) saveState();
});
$('seek').addEventListener('input', (e) => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; });
$('toggle').addEventListener('click', toggle);
$('mini-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
$('prev').addEventListener('click', () => playIndex(state.index - 1));
$('next').addEventListener('click', () => playIndex(state.index + 1));

/* ---------- 持久化 ---------- */
function saveState() {
  try {
    localStorage.setItem('ew_state', JSON.stringify({
      queue: state.queue.slice(0, 200), index: state.index,
      time: audio.currentTime || 0, playing: state.playing,
    }));
  } catch { /* 满 */ }
}
function restoreState() {
  try {
    const s = JSON.parse(localStorage.getItem('ew_state') || 'null');
    if (!s || !s.queue || !s.queue.length) return;
    state.queue = s.queue; state.index = s.index ?? 0;
    state.pendingSeek = s.time || 0;
    renderQueue();
    const cur = state.queue[state.index];
    if (cur) {
      $('mini').hidden = false;
      $('mini-name').textContent = cur.name;
      $('mini-artist').textContent = cur.artist + ' · 继续听';
      const cv = coverUrl(cur.cover);
      $('mini-cover').src = cv || 'icon.svg';
      $('mini-toggle').addEventListener('click', () => playIndex(state.index), { once: true });
    }
  } catch { /* ignore */ }
}

/* ---------- 播放模式 ---------- */
function applyMode() {
  $('mode-icon').textContent = state.mode === 'one' ? '⟳' : state.mode === 'shuffle' ? '⤨' : '⇉';
  localStorage.setItem('ew_mode', state.mode);
}
$('mode-btn').addEventListener('click', () => {
  state.mode = state.mode === 'order' ? 'one' : state.mode === 'one' ? 'shuffle' : 'order';
  applyMode();
});
applyMode();

/* ---------- 音质选择 ---------- */
function renderQualityMenu() {
  const wrap = $('q-list');
  wrap.innerHTML = '';
  QUALITIES.forEach(q => {
    const b = document.createElement('button');
    b.className = 'q-item' + (q.key === state.quality ? ' cur' : '');
    b.textContent = q.label;
    b.onclick = () => {
      state.quality = q.key;
      localStorage.setItem('ew_quality', q.key);
      renderQualityMenu();
      $('quality-menu').hidden = true;
      if (state.index >= 0) playIndex(state.index);
    };
    wrap.appendChild(b);
  });
}
$('quality-btn').addEventListener('click', () => {
  renderQualityMenu();
  const m = $('quality-menu');
  m.hidden = !m.hidden;
});
$('quality-close').addEventListener('click', () => { $('quality-menu').hidden = true; });

/* ---------- 红心（仅网易云） ---------- */
async function refreshLikeState(song) {
  const s = typeof song === 'object' ? song : { id: song };
  if (!state.user || !s.id || (s.provider && s.provider !== 'netease')) return;
  try {
    const r = await api(`/api/song/like/check?ids=${id}`);
    const ids = r.likedIds || [];
    state.liked[id] = Array.isArray(ids) ? ids.includes(String(id)) : !!((r.liked || {})[id]);
    updateHeartUI();
  } catch { /* ignore */ }
}
function updateHeartUI() {
  const cur = state.queue[state.index];
  const on = cur && (state.liked[cur.id] || isCollected(cur.id));
  $('mini-like').textContent = on ? '♥' : '♡';
  $('mini-like').classList.toggle('on', !!on);
  $('like-btn').textContent = on ? '♥' : '♡';
  $('like-btn').classList.toggle('on', !!on);
}
async function toggleLike() {
  const cur = state.queue[state.index];
  if (!cur) return;
  // 网易云登录态：红心云端；否则存入本地收藏夹
  if (cur.provider === 'netease' && state.user) {
    const next = !state.liked[cur.id];
    try {
      await api('/api/song/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cur.id, like: next }) });
      state.liked[cur.id] = next;
    } catch { /* ignore */ }
  } else {
    toggleCollect(cur);
  }
  updateHeartUI();
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
/* 逐字格式: [行起,行长](字起,字长,0)字 … */
function parseYrc(text) {
  const out = [];
  String(text || '').split('\n').forEach(line => {
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) return;
    const words = [];
    for (const w of line.matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)) {
      const tx = w[3];
      if (tx.trim()) words.push({ start: (+w[1]) / 1000, dur: (+w[2]) / 1000, text: tx });
    }
    if (words.length) out.push({ t: (+head[1]) / 1000, dur: (+head[2]) / 1000, words });
  });
  return out.sort((a, b) => a.t - b.t);
}
async function loadLyrics(song) {
  const s = typeof song === 'object' ? song : { id: song };
  $('lyrics').innerHTML = '';
  state.lyrics = []; state.curLyric = -1; state.karaoke = false;
  try {
    let d;
    if (s.provider === 'qq') d = await api(`/api/qq/lyric?mid=${encodeURIComponent(s.mid || s.id)}&id=${s.songId || ''}`);
    else if (s.provider === 'qishui') d = await api(`/api/qishui/lyric?id=${encodeURIComponent(s.id)}`);
    else if (s.provider === 'xy') {
      // 播客无歌词，展示 shownotes 文本
      let notes = s._shownotes || '';
      if (!notes) {
        try { const e = await api(`/api/xy/episode?id=${encodeURIComponent(s.epid || s.id)}`); notes = (e.episode && e.episode.shownotes) || ''; } catch { /* ignore */ }
      }
      const text = notes.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      const lines = text.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 80);
      lines.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'line'; el.dataset.i = i;
        el.textContent = t;
        $('lyrics').appendChild(el);
      });
      if (!lines.length) { const el = document.createElement('div'); el.className = 'line'; el.textContent = '（本单集无 shownotes）'; $('lyrics').appendChild(el); }
      return;
    }
    else d = await api(`/api/lyric?id=${s.id}`);
    const yrc = parseYrc(d.yrc);
    if (yrc.length) {
      state.lyrics = yrc; state.karaoke = true;
      yrc.forEach((l, i) => {
        const el = document.createElement('div');
        el.className = 'line karaoke'; el.dataset.i = i;
        l.words.forEach(w => {
          const sp = document.createElement('span');
          sp.textContent = w.text;
          sp.dataset.start = w.start; sp.dataset.end = w.start + w.dur;
          el.appendChild(sp);
        });
        el.addEventListener('click', () => { if (audio.duration) audio.currentTime = l.t; });
        $('lyrics').appendChild(el);
      });
      return;
    }
    state.lyrics = parseLrc(d.lyric || d.lrc || '');
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
  if (idx === state.curLyric) { if (state.karaoke && idx >= 0) paintKaraoke(idx, c); return; }
  state.curLyric = idx;
  const nodes = $('lyrics').children;
  for (const n of nodes) n.classList.toggle('cur', Number(n.dataset.i) === idx);
  const cur = nodes[idx];
  if (cur) $('lyrics').scrollTop = cur.offsetTop - $('lyrics').clientHeight / 2 + cur.offsetHeight;
  if (state.karaoke && idx >= 0) paintKaraoke(idx, c);
}
function paintKaraoke(idx, c) {
  const el = $('lyrics').children[idx];
  if (!el) return;
  for (const sp of el.children) {
    const s = +sp.dataset.start, e = +sp.dataset.end;
    sp.classList.toggle('lit', c >= e);
    sp.classList.toggle('singing', c >= s && c < e);
  }
}

/* ---------- 登录弹窗（三平台） ---------- */
function switchLoginTab(lp) {
  $('login-tabs').querySelectorAll('.login-tab').forEach(b => b.classList.toggle('cur', b.dataset.lp === lp));
  ['netease', 'qishui', 'qq', 'xy'].forEach(p => { $('lp-' + p).hidden = p !== lp; });
  if (lp === 'netease') startQrLogin();
  if (lp === 'qishui') checkQishuiStatus();
  if (lp === 'qq') checkQQStatus();
  if (lp === 'xy') checkXYStatus();
}
async function startQrLogin() {
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
async function openLogin() {
  $('login-modal').hidden = false;
  switchLoginTab('netease');
}
async function checkQishuiStatus() {
  const st = $('qishui-cookie-status');
  st.textContent = '查询登录态……';
  try {
    const r = await api('/api/qishui/status');
    st.textContent = r.loggedIn ? `✓ 已登录：${r.nickname || r.userId}（${r.vipLabel || r.vipLevel || ''}）` : '未登录，粘贴 cookie 后点「登录」';
  } catch (e) { st.textContent = '⚠ ' + e.message; }
}
async function checkQQStatus() {
  const st = $('qq-cookie-status');
  st.textContent = '查询登录态……';
  try {
    const r = await api('/api/qq/status');
    st.textContent = r.loggedIn ? `✓ 已登录：${r.nickname || r.uin}` : '未登录，粘贴 cookie 后点「登录」（VIP 歌曲需登录）';
  } catch (e) { st.textContent = '⚠ ' + e.message; }
}
$('login-tabs').querySelectorAll('.login-tab').forEach(b => b.addEventListener('click', () => switchLoginTab(b.dataset.lp)));
$('qishui-cookie-save').addEventListener('click', async () => {
  const st = $('qishui-cookie-status');
  const c = $('qishui-cookie-input').value.trim();
  if (!c) { st.textContent = '⚠ 请先粘贴 cookie'; return; }
  st.textContent = '保存中……';
  try {
    const r = await api('/api/qishui/login/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: c }) });
    st.textContent = r.loggedIn ? '✓ 登录成功' : '⚠ cookie 无效或不含登录态';
  } catch (e) { st.textContent = '⚠ ' + e.message; }
});
$('qishui-cookie-clear').addEventListener('click', () => api('/api/qishui/logout').then(() => { $('qishui-cookie-status').textContent = '已退出'; }));
$('qq-cookie-save').addEventListener('click', async () => {
  const st = $('qq-cookie-status');
  const c = $('qq-cookie-input').value.trim();
  if (!c) { st.textContent = '⚠ 请先粘贴 cookie'; return; }
  st.textContent = '保存中……';
  try {
    const r = await api('/api/qq/login/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: c }) });
    st.textContent = r.loggedIn ? `✓ 登录成功：${r.nickname || r.uin}` : '⚠ cookie 无效或不含 uin/qm_keyst';
  } catch (e) { st.textContent = '⚠ ' + e.message; }
});
$('qq-cookie-clear').addEventListener('click', () => api('/api/qq/logout').then(() => { $('qq-cookie-status').textContent = '已退出'; }));
async function checkXYStatus() {
  const st = $('xy-token-status');
  st.textContent = '查询登录态……';
  try {
    const r = await api('/api/xy/status');
    st.textContent = r.loggedIn ? '✓ 已登录' + (r.nickname ? '：' + r.nickname : '') : '未登录，粘贴 token 后点「登录」';
  } catch (e) { st.textContent = '⚠ ' + e.message; }
}
$('xy-token-save').addEventListener('click', async () => {
  const st = $('xy-token-status');
  const t = $('xy-token-input').value.trim();
  if (!t) { st.textContent = '⚠ 请先粘贴 token'; return; }
  st.textContent = '验证中……';
  try {
    const r = await api('/api/xy/login/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
    if (r.ok) { st.textContent = '✓ 登录成功，可以搜索和听播客了'; }
    else st.textContent = '⚠ ' + (r.error || 'token 无效');
  } catch (e) { st.textContent = '⚠ ' + e.message; }
});
$('xy-token-clear').addEventListener('click', () => api('/api/xy/logout').then(() => { $('xy-token-status').textContent = '已退出'; }));
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

/* ---------- 倍速 ---------- */
const RATES = [1, 1.25, 1.5, 2, 0.75];
let rateIdx = 0;
$('rate-btn').addEventListener('click', () => {
  rateIdx = (rateIdx + 1) % RATES.length;
  audio.playbackRate = RATES[rateIdx];
  $('rate-icon').textContent = RATES[rateIdx] + '×';
});

/* ---------- 评论抽屉（复刻原版热评） ---------- */
function openComments() {
  $('comment-drawer').hidden = false;
  $('comment-mask').hidden = false;
  loadComments();
}
function closeComments() { $('comment-drawer').hidden = true; $('comment-mask').hidden = true; }
$('comment-btn').addEventListener('click', openComments);
$('comment-close').addEventListener('click', closeComments);
$('comment-mask').addEventListener('click', closeComments);
async function loadComments() {
  const box = $('comment-list');
  const cur = state.queue[state.index];
  box.innerHTML = '<div class="c-item"><div class="c-content">正在取评论……</div></div>';
  if (!cur) { box.innerHTML = '<div class="c-item"><div class="c-content">先放首歌再来</div></div>'; return; }
  if (cur.provider !== 'netease') { box.innerHTML = `<div class="c-item"><div class="c-content">「${cur.provider === 'xy' ? '小宇宙' : cur.provider === 'qq' ? 'QQ 音乐' : '汽水'}」暂不支持评论区</div></div>`; return; }
  try {
    const d = await api(`/api/comment?id=${cur.id}`);
    const item = (c) => `<div class="c-item"><img class="c-avatar" src="${coverUrl(c.user.avatar) || 'icon.svg'}" loading="lazy"><div class="c-body"><div class="c-head"><span class="c-nick">${escapeHtml(c.user.nickname)}</span><span class="c-likes">♥ ${c.likedCount}</span></div><div class="c-content">${escapeHtml(c.content)}</div></div></div>`;
    const hot = (d.hotComments || []).map(c => Object.assign({}, c, { likedCount: c.likedCount })).slice(0, 5);
    const rest = (d.comments || []);
    box.innerHTML = (hot.length ? '<div class="c-sec">云村热评</div>' + hot.map(item).join('') : '') +
      (rest.length ? '<div class="c-sec">最新评论</div>' + rest.map(item).join('') : '') ||
      '<div class="c-item"><div class="c-content">还没有人评论</div></div>';
  } catch (e) {
    box.innerHTML = `<div class="c-item"><div class="c-content">评论加载失败：${escapeHtml(e.message)}</div></div>`;
  }
}

/* ---------- 本地收藏夹（复刻原版 collect；未登录网易云时红心即收藏） ---------- */
function getCollects() { try { return JSON.parse(localStorage.getItem('ew_collect') || '[]'); } catch { return []; } }
function isCollected(id) { return getCollects().some(s => String(s.id) === String(id)); }
function toggleCollect(song) {
  let list = getCollects();
  const exists = list.some(s => String(s.id) === String(song.id));
  if (exists) list = list.filter(s => String(s.id) !== String(song.id));
  else {
    list.unshift({ provider: song.provider, id: song.id, mid: song.mid, mediaMid: song.mediaMid, epid: song.epid, pid: song.pid, isPodcast: song.isPodcast, name: song.name, artist: song.artist, cover: song.cover, fee: song.fee });
    if (list.length > 200) list.length = 200;
  }
  localStorage.setItem('ew_collect', JSON.stringify(list));
  renderCollects();
  return !exists;
}
function renderCollects() {
  const list = getCollects();
  const box = $('collect-list');
  if (!box) return;
  $('collect-section').hidden = !list.length;
  box.innerHTML = '';
  list.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'song';
    const SRC_LABEL = { qq: 'QQ', qishui: '汽水', xy: '小宇宙' };
    const tag = s.provider && s.provider !== 'netease' ? `<span class="src-tag">${SRC_LABEL[s.provider] || s.provider}${s.isPodcast ? ' · 播客' : ''}</span>` : '';
    el.innerHTML = `
      <div class="song-idx">♥</div>
      <img src="${coverUrl(s.cover) || 'icon.svg'}" loading="lazy" alt="">
      <div class="meta">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="artist">${escapeHtml(s.artist)}${s.fee === 1 ? ' · VIP' : ''}${tag}</div>
      </div>`;
    el.addEventListener('click', () => { state.queue.push(s); renderQueue(); playIndex(state.queue.length - 1); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleCollect(s); });
    box.appendChild(el);
  });
}

/* ---------- 键盘快捷键 ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight' && e.shiftKey) playIndex(state.index + 1);
  else if (e.code === 'ArrowLeft' && e.shiftKey) playIndex(state.index - 1);
  else if (e.code === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  else if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (e.code === 'ArrowUp') audio.volume = Math.min(1, audio.volume + .1);
  else if (e.code === 'ArrowDown') audio.volume = Math.max(0, audio.volume - .1);
});

/* ---------- 启动 ---------- */
renderHist();
renderCollects();
refreshLoginStatus();
loadDiscover();
restoreState();
