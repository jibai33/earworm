// ====================================================================
//  小宇宙播客客户端（闻曲 Earworm）
//  - 登录: 官网 www.xiaoyuzhoufm.com 用小宇宙 App 扫码后，取 x-jike-access-token
//    （App 的短信登录 sendCode 已被强制人机验证 captchaVerifyParam 拦住，不可直连）
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

/* ---------- 登录（官网扫码后取得 token） ---------- */
// 官网二维码与登录态绑在官方域名，web 版无法自行生成；用户在官网用 App 扫码登录后
// 从 Network 里复制 x-jike-access-token。mac 端可改用 WebView 拦截请求头自动完成。
const XY_LOGIN_HINT = '小宇宙登录已失效，请在「我的 → 登录」用 App 扫码官网后重新复制 x-jike-access-token';
const XY_OFFICIAL_URL = 'https://www.xiaoyuzhoufm.com/';

// 容错：整段请求头 / curl 片段 / JSON / 引号包裹 / 换行，都能抽出 token
function normalizeXyToken(input) {
  let s = String(input || '').trim();
  const header = s.match(/x-jike-access-token\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i);
  if (header) s = header[1];
  else {
    const jwt = s.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwt) s = jwt[0];
  }
  return s.replace(/^["'`\s,;]+|["'`\s,;]+$/g, '').replace(/\s+/g, '');
}
async function handleXYSetToken(input) {
  const t = normalizeXyToken(input);
  if (!t || /[^A-Za-z0-9\-_.]/.test(t)) {
    throw new Error('没识别出 token，请粘贴 x-jike-access-token 的值（整段请求头也可以）');
  }
  setXyToken({ access: t, refresh: '', uid: '', nickname: '', avatar: '', at: Date.now() });
  // 用订阅接口验证 token 有效性
  let r;
  try { r = await xyPost('/v1/subscription', { loadMoreKey: { limit: 5 } }); }
  catch (e) { tokenStore.clear(); throw new Error('验证失败：' + e.message); }
  if (r.status === 401 || r.body.code === 401) {
    tokenStore.clear();
    throw new Error('token 无效或已过期，请在官网重新扫码并复制新的 x-jike-access-token');
  }
  return { ok: true, loggedIn: true, officialUrl: XY_OFFICIAL_URL, hint: 'token 有时效，过期后照引导重新取一次即可' };
}
async function handleXYLogout() { tokenStore.clear(); return { ok: true }; }
function handleXYStatus() {
  const t = xyToken();
  return {
    provider: 'xy', loggedIn: !!t.access,
    nickname: t.nickname || '', avatar: t.avatar || '', uid: t.uid || '',
    at: t.at || 0, officialUrl: XY_OFFICIAL_URL, hint: XY_LOGIN_HINT,
  };
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
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: XY_LOGIN_HINT, songs: [], hasMore: false };
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
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: XY_LOGIN_HINT, episodes: [] };
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
  if (r.status === 401 || r.body.code === 401) return { provider: 'xy', error: 'NEED_LOGIN', message: XY_LOGIN_HINT, episode: {}, enclosure: null };
  const d = r.body.data || {};
  return { provider: 'xy', episode: mapXYEpisode(d), enclosure: d.enclosure || null };
}

/* ---------- 订阅列表（登录后） ---------- */
async function handleXYSubscription(limit) {
  if (!xyLoggedIn()) return { provider: 'xy', loggedIn: false, podcasts: [] };
  const r = await xyPost('/v1/subscription', { loadMoreKey: { limit: limit || 100 } });
  if (r.status === 401 || r.body.code === 401) {
    // /v1/auth/refreshToken 实测 404（另试四种常见路径也全 404），自动续期不可行。
    //  因此这里直接给可读的过期提示，由前端引导用户重新取 token。
    return { provider: 'xy', loggedIn: false, podcasts: [], expired: true, message: XY_LOGIN_HINT };
  }
  const d = r.body.data || {};
  return { provider: 'xy', loggedIn: true, podcasts: (d.subscriptions || []).map(mapXYPodcast) };
}

module.exports = {
  setTokenStore, xyToken, xyLoggedIn, normalizeXyToken,
  handleXYSetToken, handleXYLogout, handleXYStatus,
  handleXYSearch, handleXYPodcast, handleXYEpisode, handleXYSubscription,
};
