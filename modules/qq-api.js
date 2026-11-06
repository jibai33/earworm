// ====================================================================
//  QQ 音乐精简客户端（闻曲 Earworm）
//  - 搜索: musicu.fcg DoSearchForQQMusicDesktop
//  - 播放: vkey.GetVkey (C600/M800/F000 逐级尝试, cookie 可提升音质)
//  - 歌词: music.musichallSong.PlayLyricInfo
//  - 登录: cookie 粘贴（含 uin + qm_keyst/musickey）
// ====================================================================
const https = require('https');
const crypto = require('crypto');

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://y.qq.com/',
  'Content-Type': 'application/json',
};

/* ---------- cookie ---------- */
let qqCookie = '';
function setQQCookie(c) { qqCookie = String(c || '').trim(); }
function getQQCookie() { return qqCookie; }
function qqCookieObject() {
  const out = {};
  String(qqCookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}
function qqLoginInfo() {
  const obj = qqCookieObject();
  const uin = obj.uin ? obj.uin.replace(/^o0*/, '') : '';
  const key = obj.qm_keyst || obj.musickey || obj.qqmusic_key || '';
  return { loggedIn: !!(uin && key), uin, nickname: obj.nickname || '', avatar: obj['qqmusic_avatar'] || '' };
}

/* ---------- 请求 ---------- */
function qqMusicPost(payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(QQ_MUSICU_URL);
    const headers = Object.assign({}, QQ_HEADERS, { 'Content-Length': Buffer.byteLength(data) });
    const c = cookie || qqCookie;
    if (c) headers.Cookie = c;
    const req = https.request(url, { method: 'POST', headers, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('QQ 响应解析失败')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('QQ 请求超时')); });
    req.on('error', reject);
    req.end(data);
  });
}

/* ---------- 搜索 ---------- */
function mapQQSong(t) {
  t = t || {};
  const album = t.album || {};
  const singers = (t.singer || []).map(s => s.name).filter(Boolean);
  return {
    provider: 'qq', source: 'qq', type: 'song',
    id: t.songmid || t.mid || '',
    mid: t.songmid || t.mid || '',
    mediaMid: (t.file && t.file.media_mid) || t.media_mid || (album.mid || t.albummid || ''),
    songId: t.songid || 0,
    name: t.songname || t.name || '',
    artist: singers.join(' / ') || '未知歌手',
    album: album.name || '',
    albumMid: album.mid || '',
    cover: album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.mid}.jpg` : '',
    duration: (t.interval || 0) * 1000,
    fee: t.pay ? (t.pay.pay_play ? 1 : 0) : 0,
  };
}
async function handleQQSearch(keywords, limit, offset) {
  const reqId = Math.floor(Math.random() * 900000) + 100000;
  const payload = {
    comm: { ct: 19, cv: 1859, uin: qqLoginInfo().uin || '0' },
    req_1: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: { search_type: 0, query: String(keywords || ''), page_num: Math.floor((offset || 0) / Math.max(limit, 1)) + 1, num_per_page: limit },
    },
  };
  const r = await qqMusicPost(payload);
  const body = (((r.req_1 || {}).data || {}).body) || {};
  const list = (body.song && body.song.list) || [];
  return { provider: 'qq', songs: list.map(mapQQSong), hasMore: list.length >= limit };
}

/* ---------- 播放地址 ---------- */
const QQ_FILENAME_TIERS = [
  ['F000', 'flac'],   // 无损
  ['M800', 'mp3'],    // 320k
  ['C600', 'mp3'],    // 128k
];
async function handleQQSongUrl(mid, mediaMid, qualityHint) {
  if (!mid) return { provider: 'qq', url: '', playable: false, error: 'Missing song mid' };
  const info = qqLoginInfo();
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const uin = info.uin || '0';
  // 未登录只可用 C400 m4a（128k）；登录后可试 M800/F000
  const prefixes = info.loggedIn ? ['M800', 'C400'] : ['C400'];
  const filenames = prefixes.map(p => `${p}${mediaMid || mid}.${p === 'M800' ? 'mp3' : 'm4a'}`);
  const payload = {
    comm: { uin, format: 'json', ct: info.loggedIn ? 19 : 24, cv: 0 },
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid,
        songmid: filenames.map(() => mid),
        songtype: filenames.map(() => 0),
        uin,
        loginflag: 1,
        platform: '20',
        filename: filenames,
      },
    },
  };
  const r = await qqMusicPost(payload, qqCookie);
  const data = (((r.req_0 || {}).data || {}) || {});
  const items = (data.midurlinfo || []).filter(it => it && it.purl);
  const sips = Array.isArray(data.sip) && data.sip.length ? data.sip.filter(Boolean) : ['http://ws.stream.qqmusic.qq.com/'];
  let url = '', tier = '';
  outer: for (const sip of sips) {
    for (const it of items) {
      const cand = `${String(sip).replace(/\/?$/, '/')}${it.purl}`;
      const fn = String(it.filename || '');
      // C400 m4a 未登录可用；M800 mp3 一般要登录
      url = cand; tier = fn.startsWith('M800') ? 'HQ' : fn.startsWith('F000') ? '无损' : '标准';
      break outer;
    }
  }
  if (!url) {
    return { provider: 'qq', url: '', playable: false, level: '', error: '取不到 QQ 播放地址（VIP 歌曲需登录）' };
  }
  return { provider: 'qq', url, playable: true, level: tier };
}

/* ---------- 歌词 ---------- */
async function handleQQLyric(mid, songId) {
  if (!mid && !songId) return { provider: 'qq', lyric: '' };
  const payload = {
    comm: { ct: 19, cv: 1859, uin: qqLoginInfo().uin || '0' },
    req_1: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: { songMID: mid || '', songID: Number(songId) || 0, transmit: 1, qrc: 1, ct: 19, cv: 1859 },
    },
  };
  const r = await qqMusicPost(payload);
  const d = (((r.req_1 || {}).data || {}) || {});
  const lyric = d.lyric ? Buffer.from(String(d.lyric), 'base64').toString('utf8') : (d.lyric || '');
  const trans = d.trans ? Buffer.from(String(d.trans), 'base64').toString('utf8') : '';
  return { provider: 'qq', lyric, tlyric: trans };
}

module.exports = {
  setQQCookie, getQQCookie, qqLoginInfo,
  handleQQSearch, handleQQSongUrl, handleQQLyric,
};
