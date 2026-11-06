// ====================================================================
//  小宇宙播客客户端（闻曲 Earworm）
//  - 登录: 手机号 + 短信验证码（/v1/auth/sendCode + loginOrSignUpWithSMS）
//    → x-jike-access-token / x-jike-refresh-token
//  - 搜索: /v1/search（播客 + 单集）
//  - 订阅: /v1/subscription（登录用户播客列表）
//  - 单集: /v1/podcast/get（播客详情+单集列表）、/v1/episode/get（单集详情+音频）
//  参考: ultrazg/xyz、MosesHe/xiaoyuzhoufm-mcp（MIT）
// ====================================================================
const https = require('https');
const crypto = require('crypto');

const XY_API = 'api.xiaoyuzhoufm.com';
const DEVICE_ID = crypto.createHash('md5').update('earworm-xy').digest('hex');
const XY_HEADERS = {
  'Host': XY_API,
  'User-Agent': 'Xiaoyuzhou/1.24.0 (app.podcast.cosmos; build:1576; iOS 16.0.0) Alamofire/4.9.1',
  'App-BuildNo': '1576',
  'OS': 'ios',
  'Manufacturer': 'Apple',
  'BundleID': 'app.podcast.cosmos',
  'abtest-info': '{"old_user_discovery_feed":"enable"}',
  'Accept-Language': 'zh-Hans-CN;q=1.0',
  'X-XY-Unique-ID': DEVICE_ID,
  'X-XY-App-Version': '1.24.0',
  'X-XY-Platform': 'ios',
};

/* ---------- token 持久化（由 server.js 注入存取器） ---------- */
let tokenStore = { get: () => ({}), save: () => {}, clear: () => {} };
function setTokenStore(s) { tokenStore = s; }
function xyToken() { return tokenStore.get(); } // { access, refresh, uid, nickname }
function setXyToken(t) { tokenStore.save(t); }
function xyLoggedIn() { return !!(xyToken().access); }

/* ---------- 请求 ---------- */
function xyPost(path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const headers = Object.assign({
      'Content-Type': 'application/json;charset=UTF-8',
      'Content-Length': Buffer.byteLength(data),
    }, XY_HEADERS, extraHeaders || {});
    const t = xyToken();
    if (t.access && !headers['x-jike-access-token']) headers['x-jike-access-token'] = t.access;
    const req = https.request({ host: XY_API, path, method: 'POST', headers, timeout: 12000 }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(buf || '{}'); } catch { body = { _html: true, code: res.statusCode === 401 ? 401 : 0 }; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('小宇宙请求超时')));
    req.on('error', reject);
    req.end(data);
  });
}

/* ---------- 登录（token 粘贴） ---------- */
// 小宇宙 App API 已加人机验证，短信直连登录不可行；
// 用户从小宇宙 Web 端（web.xiaoyuzhoufm.com）或抓包获取 x-jike-access-token 粘贴
function normalizeXyToken(input) {
  const s = String(input || '').trim();
  const m = s.match(/([A-Za-z0-9\-_]{2,}\.[A-Za-z0-9\-_]{2,}\.[A-Za-z0-9\-_]{2,})/); // JWT 形态
  if (m) return m[1];
  return s || '';
}
async function handleXYSetToken(input) {
  const t = normalizeXyToken(input);
  if (!t || /[^A-Za-z0-9\-_.]/.test(t)) throw new Error('token 格式不像 x-jike-access-token');
  setXyToken({ access: t, refresh: '', uid: '', nickname: '', avatar: '', at: Date.now() });
  // 用订阅接口验证 token 有效性
  const r = await xyPost('/v1/subscription', { loadMoreKey: { limit: 5 } });
  if (r.status === 401 || r.body.code === 401) {
    tokenStore.clear();
    throw new Error('token 无效或已过期');
  }
  return { ok: true };
}
async function handleXYLogout() { tokenStore.clear(); return { ok: true }; }
function handleXYStatus() {
  const t = xyToken();
  return { provider: 'xy', loggedIn: !!t.access, nickname: t.nickname || '', avatar: t.avatar || '', uid: t.uid || '' };
}

/* ---------- 映射 ---------- */
function mapXYPodcast(p) {
  p = p || {};
  const img = p.image ? (p.image.smallPicUrl || p.image.middlePicUrl || p.image.largePicUrl || '') : '';
  return {
    provider: 'xy', source: 'xy', type: 'podcast',
    id: p.pid || '', pid: p.pid || '',
    name: p.title || '', nameCN: '',
    artist: p.author || '', host: p.author || '',
    album: '', cover: img, image: img,
    duration: 0, episodesCount: p.episodesCount || 0,
    description: p.description || '',
    fee: 0, isPodcast: true,
  };
}
function mapXYEpisode(e) {
  e = e || {};
  const pc = e.podcast || {};
  const img = (e.image && e.image.smallPicUrl) || (pc.image && (pc.image.smallPicUrl || pc.image.middlePicUrl)) || '';
  return {
    provider: 'xy', source: 'xy', type: 'episode',
    id: e.eid || '', epid: e.eid || '',
    pid: e.pid || pc.pid || '',
    name: e.title || '',
    artist: pc.author || pc.title || '播客',
    album: pc.title || '',
    cover: img, image: img,
    duration: (e.duration || 0) * 1000,
    pubDate: e.pubDate || 0,
    shownotes: e.shownotes || '',
    hasShownotes: !!e.hasShownotes,
    fee: 0, isEpisode: true,
  };
}

/* ---------- 搜索 ---------- */
async function handleXYSearch(keyword, limit, offset) {
  const loadMoreKey = offset > 0 ? { nextOffset: offset } : { limit: 20 };
  const r = await xyPost('/v1/search', { type: 'ALL', keyword: String(keyword || ''), loadMoreKey });
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: '小宇宙搜索需要登录（登录面板粘贴 token）', songs: [], hasMore: false };
  const d = r.body.data || {};
  const podcasts = (d.podcasts || []).map(mapXYPodcast);
  const episodes = (d.episodes || []).map(mapXYEpisode);
  // 播客在前、单集在后；每类 20 条一页
  const total = podcasts.length + episodes.length;
  return { provider: 'xy', songs: [...podcasts, ...episodes], hasMore: total >= 20 };
}

/* ---------- 播客详情 + 单集列表 ---------- */
async function handleXYPodcast(pid, loadMoreKey) {
  const r = await xyPost('/v1/podcast/get', { pid, loadMoreKey: loadMoreKey || undefined });
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: '需要登录小宇宙', episodes: [] };
  const d = r.body.data || {};
  return {
    provider: 'xy', podcast: mapXYPodcast(d),
    episodes: (d.episodes || []).map(mapXYEpisode),
    loadMoreKey: d.loadMoreKey || null,
    total: d.episodesCount || 0,
  };
}

/* ---------- 单集详情（含音频地址） ---------- */
async function handleXYEpisode(eid) {
  const r = await xyPost('/v1/episode/get', { eid });
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: '需要登录小宇宙', episode: {}, enclosure: null };
  const d = r.body.data || {};
  return { provider: 'xy', episode: mapXYEpisode(d), enclosure: d.enclosure || null };
}

/* ---------- 订阅列表（登录后） ---------- */
async function handleXYSubscription(limit) {
  if (!xyLoggedIn()) return { provider: 'xy', loggedIn: false, podcasts: [] };
  const r = await xyPost('/v1/subscription', { loadMoreKey: { limit: limit || 100 } });
  if (r.status === 401 || r.body.code === 401) {
    // token 过期 → 尝试刷新一次
    const ok = await refreshXyToken();
    if (!ok) return { provider: 'xy', loggedIn: false, podcasts: [], expired: true };
    const r2 = await xyPost('/v1/subscription', { loadMoreKey: { limit: limit || 100 } });
    const d2 = r2.body.data || {};
    return { provider: 'xy', loggedIn: true, podcasts: (d2.subscriptions || []).map(mapXYPodcast) };
  }
  const d = r.body.data || {};
  return { provider: 'xy', loggedIn: true, podcasts: (d.subscriptions || []).map(mapXYPodcast) };
}
async function refreshXyToken() {
  const t = xyToken();
  if (!t.refresh) return false;
  try {
    const r = await xyPost('/v1/auth/refreshToken', {}, { 'x-jike-access-token': '', 'x-jike-refresh-token': t.refresh });
    const at = r.headers['x-jike-access-token'];
    if (at) { setXyToken(Object.assign(t, { access: at, refresh: r.headers['x-jike-refresh-token'] || t.refresh, at: Date.now() })); return true; }
  } catch { /* ignore */ }
  return false;
}

module.exports = {
  setTokenStore, xyToken, xyLoggedIn, normalizeXyToken,
  handleXYSetToken, handleXYLogout, handleXYStatus,
  handleXYSearch, handleXYPodcast, handleXYEpisode, handleXYSubscription,
};
