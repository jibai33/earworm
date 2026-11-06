// ====================================================================
//  闻曲 Earworm — 独立服务端
//  仅为 Web/PWA 前端提供网易云接口与静态资源
//  运行: node server.js  (PORT 环境变量可改端口, 默认 3210)
// ====================================================================
const {
  cloudsearch,
  song_url_v1,
  lyric_new,
  lyric,
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  user_account,
  user_playlist,
  playlist_track_all,
  playlist_detail,
  song_like,
  song_like_check,
  recommend_songs,
  personalized,
  personalized_newsong,
  like: like_song,
  likelist,
} = require('NeteaseCloudMusicApi');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- 多平台模块 ---------- */
const qishuiApi = require('./modules/qishui-api.js');
const qqApi = require('./modules/qq-api.js');
const xyApi = require('./modules/xiaoyuzhou-api.js');
const { TrackDecryptor } = require('./modules/qishui-audio-decryptor/track-decryptor');
const qishuiAudioDecryptor = new TrackDecryptor();

const QISHUI_COOKIE_FILE = path.join(__dirname, '.qishui-cookie');
const QQ_COOKIE_FILE = path.join(__dirname, '.qq-cookie');
let qishuiCookie = '';
try { qishuiCookie = fs.readFileSync(QISHUI_COOKIE_FILE, 'utf8').trim(); } catch { /* 首次无 cookie */ }
try { qqApi.setQQCookie(fs.readFileSync(QQ_COOKIE_FILE, 'utf8').trim()); } catch { /* 首次无 cookie */ }
function saveQishuiCookie(c) {
  qishuiCookie = String(c || '').trim();
  try { fs.writeFileSync(QISHUI_COOKIE_FILE, qishuiCookie); } catch (e) { console.error('[QishuiCookie] 写入失败', e.message); }
}
function saveQQCookie(c) {
  qqApi.setQQCookie(String(c || '').trim());
  try { fs.writeFileSync(QQ_COOKIE_FILE, qqApi.getQQCookie()); } catch (e) { console.error('[QQCookie] 写入失败', e.message); }
}

/* 小宇宙 token（JSON: access/refresh/uid/nickname） */
const XY_TOKEN_FILE = path.join(__dirname, '.xy-token.json');
let xyTokenData = {};
try { xyTokenData = JSON.parse(fs.readFileSync(XY_TOKEN_FILE, 'utf8')); } catch { /* 首次无 token */ }
xyApi.setTokenStore({
  get: () => xyTokenData,
  save: (t) => {
    xyTokenData = t || {};
    try { fs.writeFileSync(XY_TOKEN_FILE, JSON.stringify(xyTokenData, null, 1)); } catch (e) { console.error('[XYToken] 写入失败', e.message); }
  },
  clear: () => { xyTokenData = {}; try { fs.unlinkSync(XY_TOKEN_FILE); } catch { /* 无文件 */ } },
});

const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_FILE = path.join(__dirname, '.cookie');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ---------- cookie 持久化 ---------- */
let userCookie = '';
try { userCookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim(); } catch { /* 首次无 cookie */ }
function saveCookie(c) {
  userCookie = String(c || '').trim();
  try { fs.writeFileSync(COOKIE_FILE, userCookie); } catch (e) { console.error('[Cookie] 写入失败', e.message); }
}

/* ---------- 工具 ---------- */
function sendJSON(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function mapArtists(list) {
  return (list || []).map(a => ({ id: a && a.id, name: a && a.name }));
}
function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    provider: 'netease', source: 'netease', type: 'song',
    id: s.id, name: s.name,
    artist: artists.map(a => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    albumId: album.id || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    fee: s.fee,
  };
}
function mapPlaylist(p) {
  p = p || {};
  const creator = p.creator || {};
  return {
    provider: 'netease', source: 'netease', type: 'playlist',
    id: p.id, name: p.name,
    cover: p.coverImgUrl || p.picUrl || '',
    trackCount: p.trackCount || 0,
    playCount: p.playCount || 0,
    creator: creator.nickname || '',
    subscribed: !!p.subscribed,
    specialType: p.specialType || 0,
    tag: (p.tags && p.tags[0]) || '',
  };
}
function normalizeLoginInfo(profile, account, extra) {
  const vipType = Number((profile || {}).vipType || (extra || {}).vipType || 0);
  const labelMap = { 11: 'SVIP', 1: 'VIP' };
  return {
    loggedIn: !!(profile && profile.nickname),
    nickname: (profile && profile.nickname) || '',
    avatar: (profile && profile.avatarUrl) || '',
    vipType,
    vipLabel: labelMap[vipType] || '无VIP',
    userId: (account && account.id) || (profile && profile.userId) || 0,
  };
}
async function getLoginInfo() {
  try {
    const r = await login_status({ cookie: userCookie, timestamp: Date.now() });
    const b = r.body || {};
    const profile = b.profile || b.data && b.data.profile || {};
    const account = b.account || b.data && b.data.account || {};
    return normalizeLoginInfo(profile, account, b);
  } catch {
    return { loggedIn: false, nickname: '', avatar: '', vipType: 0, vipLabel: '无VIP', userId: 0 };
  }
}

/* ---------- 封面代理 ---------- */
function proxyCover(res, coverUrl) {
  const mod = coverUrl.startsWith('https') ? https : http;
  const req = mod.get(coverUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } }, (up) => {
    res.writeHead(200, { 'Content-Type': up.headers['content-type'] || 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' });
    up.pipe(res);
  });
  req.on('error', () => { res.writeHead(404); res.end(); });
}

/* ---------- 音频代理 ---------- */
const QISHUI_AUDIO_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const qishuiAudioCache = new Map();
let qishuiAudioCacheBytes = 0;
function qishuiAudioAuthFromUrl(audioUrl) {
  const idx = String(audioUrl).indexOf('#auth=');
  if (idx < 0) return null;
  const authRaw = audioUrl.slice(idx + 6);
  let auth = authRaw;
  try { auth = decodeURIComponent(authRaw); } catch { /* 原样 */ }
  return { cleanUrl: audioUrl.slice(0, idx), auth };
}
function getQishuiDecryptedAudio(cleanUrl, auth) {
  const key = crypto.createHash('sha1').update(cleanUrl + '\n' + auth).digest('hex');
  const cached = qishuiAudioCache.get(key);
  if (cached) { cached.at = Date.now(); return Promise.resolve(cached); }
  return fetch(cleanUrl).then(async (up) => {
    if (!up.ok) throw new Error('汽水加密音频拉取失败: HTTP ' + up.status);
    const encryptedBuffer = Buffer.from(await up.arrayBuffer());
    const result = qishuiAudioDecryptor.decrypt({ encryptedBuffer, spadeA: auth });
    const payload = {
      buffer: result.buffer,
      contentType: result.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
      at: Date.now(),
    };
    qishuiAudioCache.set(key, payload);
    qishuiAudioCacheBytes += payload.buffer.length;
    while (qishuiAudioCacheBytes > QISHUI_AUDIO_CACHE_MAX_BYTES && qishuiAudioCache.size > 1) {
      const oldest = [...qishuiAudioCache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0];
      if (!oldest) break;
      qishuiAudioCache.delete(oldest[0]);
      qishuiAudioCacheBytes -= oldest[1].buffer.length;
    }
    return payload;
  });
}
function sendAudioBuffer(res, buffer, contentType, range) {
  const total = buffer.length;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(range || ''));
  if (m) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); return res.end(); }
    res.writeHead(206, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` });
    return res.end(buffer.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': total });
  res.end(buffer);
}
function audioRefererFor(au) {
  try {
    const host = new URL(au).host;
    if (host.includes('qq.com') || host.includes('qpic.cn')) return 'https://y.qq.com/';
    if (host.includes('qishui.com') || host.includes('byteimg.com') || host.includes('douyin')) return 'https://www.qishui.com/';
    if (host.includes('music.163.com') || host.includes('163.com')) return 'https://music.163.com/';
  } catch { /* ignore */ }
  return '';
}
function proxyAudio(res, au, range) {
  const headers = { 'User-Agent': UA };
  const ref = audioRefererFor(au);
  if (ref) headers.Referer = ref;
  if (range) headers.Range = range;
  const mod = au.startsWith('https') ? https : http;
  const req2 = mod.get(au, { headers }, (up) => {
    const wh = { 'Content-Type': up.headers['content-type'] || 'audio/mp4', 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    if (up.headers['content-range']) wh['Content-Range'] = up.headers['content-range'];
    if (up.headers['content-length']) wh['Content-Length'] = up.headers['content-length'];
    res.writeHead(up.statusCode, wh);
    up.pipe(res);
  });
  req2.on('error', () => { res.writeHead(502); res.end(); });
}

/* ---------- 请求体 ---------- */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pn = u.pathname;
  const q = u.searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // ---------- 搜索 ----------
    if (pn === '/api/search') {
      const kw = q.get('keywords') || '';
      const limit = Math.min(50, parseInt(q.get('limit') || '20', 10) || 20);
      const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
      const r = await cloudsearch({ keywords: kw, limit, offset, cookie: userCookie });
      const songs = (r.body.result && r.body.result.songs || []).map(mapSongRecord);
      return sendJSON(res, { songs, offset, limit, hasMore: songs.length >= limit });
    }

    // ---------- 播放地址 ----------
    if (pn === '/api/song/url') {
      const id = q.get('id');
      const quality = q.get('quality') || '';
      const r = await song_url_v1({ id, level: quality || 'exhigh', cookie: userCookie, timestamp: Date.now() });
      const d = (r.body.data || [])[0] || {};
      return sendJSON(res, {
        provider: 'netease', source: 'netease',
        url: d.url || null, level: d.level || '', br: d.br || 0, type: d.type || '',
        freeTrialInfo: d.freeTrialInfo || null,
      });
    }

    // ---------- 歌词 ----------
    if (pn === '/api/lyric') {
      const id = q.get('id');
      let body = {};
      try { const nr = await lyric_new({ id, cookie: userCookie, timestamp: Date.now() }); body = nr.body || {}; } catch { /* 降级 */ }
      const lrcStr = body.lrc ? (body.lrc.lyric || '') : '';
      const tStr = body.tlyric ? (body.tlyric.lyric || '') : '';
      if (lrcStr) return sendJSON(res, { lyric: lrcStr, tlyric: tStr, yrc: body.yrc ? (body.yrc.lyric || '') : '', ytlyric: body.ytlrc ? (body.ytlrc.lyric || '') : '', source: 'lyric' });
      try {
        const r = await lyric({ id, cookie: userCookie, timestamp: Date.now() });
        const b = r.body || {};
        return sendJSON(res, { lyric: (b.lrc && b.lrc.lyric) || '', tlyric: (b.tlyric && b.tlyric.lyric) || '', source: 'lyric_new' });
      } catch (e) { return sendJSON(res, { lyric: '', tlyric: '', error: e.message }); }
    }

    // ---------- 封面代理 ----------
    if (pn === '/api/cover') {
      const cu = q.get('url') || '';
      if (!/^https?:\/\//i.test(cu)) { res.writeHead(400); return res.end(); }
      return proxyCover(res, cu);
    }

    // ---------- 扫码登录 ----------
    if (pn === '/api/login/qr/key') {
      const r = await login_qr_key({ timestamp: Date.now() });
      return sendJSON(res, { key: r.body.data.unikey });
    }
    if (pn === '/api/login/qr/create') {
      const r = await login_qr_create({ key: q.get('key'), qrimg: true, timestamp: Date.now() });
      const d = r.body.data || {};
      return sendJSON(res, { img: d.qrimg, url: d.qrurl });
    }
    if (pn === '/api/login/qr/check') {
      const r = await login_qr_check({ key: q.get('key'), noCookie: true, timestamp: Date.now() });
      const b = r.body || {};
      const code = Number(b.code || 0);
      const cookie = typeof r.cookie === 'string' ? r.cookie : (Array.isArray(r.cookie) ? r.cookie.join('; ') : '');
      if (code === 803 && cookie) saveCookie(cookie);
      return sendJSON(res, { code, message: b.message || '', nickname: (b.profile && b.profile.nickname) || '' });
    }

    // ---------- 登录态 ----------
    if (pn === '/api/login/status') return sendJSON(res, await getLoginInfo());
    if (pn === '/api/logout') { saveCookie(''); return sendJSON(res, { ok: true }); }

    // ---------- 用户歌单 ----------
    if (pn === '/api/user/playlists') {
      const info = await getLoginInfo();
      if (!info.loggedIn) return sendJSON(res, { loggedIn: false, playlists: [] });
      const r = await user_playlist({ uid: info.userId, limit: 60, cookie: userCookie, timestamp: Date.now() });
      const pls = (r.body.playlist || []).map(mapPlaylist);
      return sendJSON(res, { loggedIn: true, userId: info.userId, playlists: pls });
    }

    // ---------- 歌单详情 ----------
    if (pn === '/api/playlist/tracks') {
      const id = q.get('id');
      const limit = parseInt(q.get('limit') || '50', 10) || 50;
      const metaR = await playlist_detail({ id, cookie: userCookie, timestamp: Date.now() }).catch(() => null);
      const meta = metaR && metaR.body && metaR.body.playlist ? mapPlaylist(metaR.body.playlist) : { id };
      const r = await playlist_track_all({ id, limit, cookie: userCookie, timestamp: Date.now() });
      const tracks = (r.body.songs || []).map(mapSongRecord);
      return sendJSON(res, { playlist: meta, tracks });
    }

    // ---------- 红心 ----------
    if (pn === '/api/song/like/check') {
      const ids = String(q.get('ids') || '').split(',').filter(Boolean);
      try {
        const r = await song_like_check({ ids: JSON.stringify(ids.map(Number)), cookie: userCookie, timestamp: Date.now() });
        const data = (r.body && (r.body.data || r.body.ids)) || [];
        const likedIds = Array.isArray(data) ? data.map(String) : Object.keys(data || {}).filter(k => data[k]).map(String);
        return sendJSON(res, { likedIds });
      } catch (e) { return sendJSON(res, { likedIds: [], error: e.message }); }
    }
    if (pn === '/api/song/like') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const id = body.id || q.get('id');
      const like = body.like !== false && String(q.get('like') || 'true') !== 'false';
      const r = await like_song({ id, like, cookie: userCookie, timestamp: Date.now() });
      const ok = r.body && (r.body.playlistSongs !== undefined || r.body.code === 200 || r.body.resources !== undefined);
      return sendJSON(res, { ok: ok !== false });
    }

    // ---------- 发现页 ----------
    if (pn === '/api/discover/home') {
      const info = await getLoginInfo();
      let daily = [];
      if (info.loggedIn) {
        try {
          const r = await recommend_songs({ cookie: userCookie, timestamp: Date.now() });
          daily = ((r.body.data && r.body.data.dailySongs) || []).map(mapSongRecord);
        } catch { /* 降级 */ }
      }
      if (!daily.length) {
        try {
          const r = await personalized_newsong({ limit: 30, cookie: userCookie, timestamp: Date.now() });
          daily = (r.body.data || []).map(mapSongRecord);
        } catch { /* 空 */ }
      }
      let pls = [];
      try {
        const r = await personalized({ limit: 10, cookie: userCookie, timestamp: Date.now() });
        pls = (r.body.result || []).map(p => ({
          id: p.id, name: p.name, cover: p.picUrl || '',
          trackCount: (p.trackCount || 0), tag: (p.type || '') , creator: '',
        }));
      } catch { /* 空 */ }
      return sendJSON(res, { loggedIn: info.loggedIn, user: info.loggedIn ? { userId: info.userId, nickname: info.nickname, avatar: info.avatar } : null, dailySongs: daily, playlists: pls });
    }

    // ==================== 汽水音乐 ====================
    if (pn === '/api/qishui/status') return sendJSON(res, await qishuiApi.handleQishuiStatus(qishuiCookie));
    if (pn === '/api/qishui/login/cookie') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const c = body.cookie || q.get('cookie') || '';
      if (!c) return sendJSON(res, { ok: false, error: 'missing cookie' }, 400);
      saveQishuiCookie(qishuiApi.normalizeQishuiCookieInput(c) || c);
      return sendJSON(res, await qishuiApi.handleQishuiStatus(qishuiCookie));
    }
    if (pn === '/api/qishui/logout') { saveQishuiCookie(''); return sendJSON(res, { ok: true }); }
    if (pn === '/api/qishui/search') {
      const kw = q.get('keywords') || '';
      const limit = Math.min(50, parseInt(q.get('limit') || '20', 10) || 20);
      const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
      return sendJSON(res, await qishuiApi.handleQishuiSearch(kw, limit, qishuiCookie, offset));
    }
    if (pn === '/api/qishui/song/url') {
      return sendJSON(res, await qishuiApi.handleQishuiSongUrl({
        id: q.get('id') || q.get('trackId') || '',
        quality: q.get('quality') || '',
        vipRequired: q.get('vipRequired') || '',
        needVip: q.get('needVip') || '',
        onlyVipPlayable: q.get('onlyVipPlayable') || '',
        fee: q.get('fee') || '',
      }, qishuiCookie));
    }
    if (pn === '/api/qishui/lyric') return sendJSON(res, await qishuiApi.handleQishuiLyric(q.get('id') || '', qishuiCookie));

    // ==================== QQ 音乐 ====================
    if (pn === '/api/qq/status') return sendJSON(res, Object.assign({ provider: 'qq' }, qqApi.qqLoginInfo()));
    if (pn === '/api/qq/login/cookie') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const c = body.cookie || q.get('cookie') || '';
      if (!c) return sendJSON(res, { ok: false, error: 'missing cookie' }, 400);
      saveQQCookie(c);
      return sendJSON(res, Object.assign({ provider: 'qq', ok: true }, qqApi.qqLoginInfo()));
    }
    if (pn === '/api/qq/logout') { saveQQCookie(''); return sendJSON(res, { ok: true }); }
    if (pn === '/api/qq/search') {
      const kw = q.get('keywords') || '';
      const limit = Math.min(50, parseInt(q.get('limit') || '20', 10) || 20);
      const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
      return sendJSON(res, await qqApi.handleQQSearch(kw, limit, offset));
    }
    if (pn === '/api/qq/song/url') {
      return sendJSON(res, await qqApi.handleQQSongUrl(q.get('mid') || q.get('id') || '', q.get('mediaMid') || '', q.get('quality') || ''));
    }
    if (pn === '/api/qq/lyric') return sendJSON(res, await qqApi.handleQQLyric(q.get('mid') || '', q.get('id') || ''));

    // ==================== 小宇宙播客 ====================
    if (pn === '/api/xy/status') return sendJSON(res, xyApi.handleXYStatus());
    if (pn === '/api/xy/login/token') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      try { return sendJSON(res, await xyApi.handleXYSetToken(body.token || q.get('token') || '')); }
      catch (e) { return sendJSON(res, { ok: false, error: e.message }, 200); }
    }
    if (pn === '/api/xy/logout') return sendJSON(res, await xyApi.handleXYLogout());
    if (pn === '/api/xy/search') {
      const kw = q.get('keywords') || '';
      const offset = Math.max(0, parseInt(q.get('offset') || '0', 10) || 0);
      return sendJSON(res, await xyApi.handleXYSearch(kw, 20, offset));
    }
    if (pn === '/api/xy/podcast') return sendJSON(res, await xyApi.handleXYPodcast(q.get('id') || ''));
    if (pn === '/api/xy/episode') return sendJSON(res, await xyApi.handleXYEpisode(q.get('id') || ''));
    if (pn === '/api/xy/subscription') return sendJSON(res, await xyApi.handleXYSubscription(100));

    // ==================== 音频代理（汽水解密 + QQ/跨域透传） ====================
    if (pn === '/api/audio') {
      const au = q.get('url') || '';
      if (!/^https?:\/\//i.test(au)) { res.writeHead(400); return res.end(); }
      const range = req.headers.range || '';
      // 汽水加密音频：#auth= → 解密后按 Range 发送
      const parsed = au.indexOf('#auth=') >= 0 ? qishuiAudioAuthFromUrl(au) : null;
      if (parsed && parsed.auth) {
        try {
          const payload = await getQishuiDecryptedAudio(parsed.cleanUrl, parsed.auth);
          return sendAudioBuffer(res, payload.buffer, payload.contentType, range);
        } catch (e) {
          console.error('[AudioDecrypt]', e.message);
          return sendJSON(res, { error: e.message }, 502);
        }
      }
      // 通用透传（QQ m4a、网易云外链等）
      return proxyAudio(res, au, range);
    }

    // ---------- 静态资源 ----------
    if (pn === '/' || pn === '/app') return sendJSONRedirect(res);
    if (pn === '/favicon.ico') { res.writeHead(302, { Location: '/app/icon.svg' }); return res.end(); }
    if (pn.startsWith('/app/')) {
      const sub = pn.slice('/app'.length);
      const file = path.join(__dirname, 'web', sub === '/' ? 'index.html' : sub);
      if (!file.startsWith(path.join(__dirname, 'web'))) { res.writeHead(403); return res.end(); }
      serveStatic(res, file);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    console.error('[Server]', pn, err.message);
    sendJSON(res, { error: err.message }, 500);
  }
});

function sendJSONRedirect(res) {
  res.writeHead(302, { Location: '/app/' });
  res.end();
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 闻曲 Earworm →  http://localhost:' + PORT + '/app/');
  console.log(' 登录态: ' + (userCookie ? '已登录(cookie已加载)' : '未登录'));
  console.log('======================================================');
});
