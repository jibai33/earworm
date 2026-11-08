/* ═══════════════════════════════════════════════════════════════
   闻曲 · 今日一卦（太极 → 两仪 → 四象 → 八卦 → 六十四卦）
   —— 三枚铜钱六掷成卦（金钱卦），老阴老阳为动爻，动则变之卦。
   卦名取《周易》六十四卦方阵；卦解引《周易》卦辞、爻辞、彖、象
   （经文见 iching-text.js），并按朱熹《易学启蒙》变占之例选取断辞；
   白话卦解与逐条今译见 iching-plain.js，依字面直译，供理解经文，
   不代下吉凶断言。
   独立模块：只往侧栏插一条签、往 body 挂一层面板，不改动播放器逻辑。
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  /* ---------- 八卦：按伏羲先天次序，bits 为自下而上三爻（阳 1 / 阴 0） ---------- */
  // idx: 0 乾 1 兑 2 离 3 震 4 巽 5 坎 6 艮 7 坤；bits = 7 - idx
  const TRIGRAMS = [
    { name: '乾', glyph: '☰', nature: '天', virtue: '健', element: '金', yi: '进取', ji: '躁进' },
    { name: '兑', glyph: '☱', nature: '泽', virtue: '悦', element: '金', yi: '和悦', ji: '口舌' },
    { name: '离', glyph: '☲', nature: '火', virtue: '丽', element: '火', yi: '明辨', ji: '炫露' },
    { name: '震', glyph: '☳', nature: '雷', virtue: '动', element: '木', yi: '行动', ji: '妄动' },
    { name: '巽', glyph: '☴', nature: '风', virtue: '入', element: '木', yi: '渐进', ji: '优柔' },
    { name: '坎', glyph: '☵', nature: '水', virtue: '陷', element: '水', yi: '沉淀', ji: '涉险' },
    { name: '艮', glyph: '☶', nature: '山', virtue: '止', element: '土', yi: '守成', ji: '停滞' },
    { name: '坤', glyph: '☷', nature: '地', virtue: '顺', element: '土', yi: '承载', ji: '迟疑' },
  ];

  /* ---------- 六十四卦方阵：行 = 上卦，列 = 下卦，序同 TRIGRAMS ---------- */
  const NAMES = [
    ['乾为天', '天泽履', '天火同人', '天雷无妄', '天风姤', '天水讼', '天山遁', '天地否'],
    ['泽天夬', '兑为泽', '泽火革', '泽雷随', '泽风大过', '泽水困', '泽山咸', '泽地萃'],
    ['火天大有', '火泽睽', '离为火', '火雷噬嗑', '火风鼎', '火水未济', '火山旅', '火地晋'],
    ['雷天大壮', '雷泽归妹', '雷火丰', '震为雷', '雷风恒', '雷水解', '雷山小过', '雷地豫'],
    ['风天小畜', '风泽中孚', '风火家人', '风雷益', '巽为风', '风水涣', '风山渐', '风地观'],
    ['水天需', '水泽节', '水火既济', '水雷屯', '水风井', '坎为水', '水山蹇', '水地比'],
    ['山天大畜', '山泽损', '山火贲', '山雷颐', '山风蛊', '山水蒙', '艮为山', '山地剥'],
    ['地天泰', '地泽临', '地火明夷', '地雷复', '地风升', '地水师', '地山谦', '坤为地'],
  ];

  /* 《周易》通行卦序，用来标注「第几卦」；名称与 NAMES 一一对应 */
  const ORDER = [
    '乾为天', '坤为地', '水雷屯', '山水蒙', '水天需', '天水讼', '地水师', '水地比',
    '风天小畜', '天泽履', '地天泰', '天地否', '天火同人', '火天大有', '地山谦', '雷地豫',
    '泽雷随', '山风蛊', '地泽临', '风地观', '火雷噬嗑', '山火贲', '山地剥', '地雷复',
    '天雷无妄', '山天大畜', '山雷颐', '泽风大过', '坎为水', '离为火', '泽山咸', '雷风恒',
    '天山遁', '雷天大壮', '火地晋', '地火明夷', '风火家人', '火泽睽', '水山蹇', '雷水解',
    '山泽损', '风雷益', '泽天夬', '天风姤', '泽地萃', '地风升', '泽水困', '水风井',
    '泽火革', '火风鼎', '震为雷', '艮为山', '风山渐', '雷泽归妹', '雷火丰', '火山旅',
    '巽为风', '兑为泽', '风水涣', '水泽节', '风泽中孚', '雷山小过', '水火既济', '火水未济',
  ];

  const YAO_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  const SHENG = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };  // 相生
  const KE = { '木': '土', '土': '水', '水': '火', '火': '金', '金': '木' };    // 相克
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 起卦内核 ----------
     每爻掷三枚铜钱：背 = 3（阳），字 = 2（阴）。
     6 = 老阴（阴动 ×） / 7 = 少阳 / 8 = 少阴 / 9 = 老阳（阳动 ○）
     老阴老阳为动爻，阳极变阴、阴极变阳，得「之卦」。 */
  function castYao(rng) {
    const coins = [0, 0, 0].map(() => (rng() < .5 ? 3 : 2));
    const num = coins[0] + coins[1] + coins[2];
    return {
      coins,
      num,                                  // 6 / 7 / 8 / 9
      yang: num === 7 || num === 9,
      moving: num === 6 || num === 9,
    };
  }
  function castHexagram(rng) {
    return [0, 1, 2, 3, 4, 5].map(() => castYao(rng)); // index 0 = 初爻（最下）
  }
  function trigramIdx(yaos, from) {
    /* 三爻自下而上排成 b2b1b0（上爻为最高位）。
       乾111=7 兑110=6 离101=5 震100=4 巽011=3 坎010=2 艮001=1 坤000=0，
       恰好与 TRIGRAMS 的先天次序一一对应，故 idx = 7 - bits。
       注意不能用 (1<<i) 让初爻当最低位——那样兑/震/巽/艮会互相错位。 */
    let bits = 0;
    for (let i = 0; i < 3; i++) if (yaos[from + i].yang) bits |= (1 << (2 - i));
    return 7 - bits;
  }
  function hexagramOf(yaos) {
    const upper = trigramIdx(yaos, 3), lower = trigramIdx(yaos, 0);
    const name = NAMES[upper][lower];
    const no = ORDER.indexOf(name) + 1;
    const short = name.includes('为') ? name[0] : name.slice(2);
    return { upper, lower, name, short, no };
  }
  function changingOf(yaos) {
    return yaos.map(y => y.moving ? { ...y, yang: !y.yang } : { ...y });
  }
  function readingOf(yaos) {
    const ben = hexagramOf(yaos);
    const movingIdx = yaos.map((y, i) => y.moving ? i : -1).filter(i => i >= 0);
    const zhi = movingIdx.length ? hexagramOf(changingOf(yaos)) : null;
    return { yaos, ben, zhi, movingIdx, ...interpret(ben, movingIdx, zhi) };
  }

  /* ---------- 卦意推演：上下卦卦德 + 五行生克 + 动静 ---------- */
  function interpret(g, movingIdx, zhi) {
    const up = TRIGRAMS[g.upper], lo = TRIGRAMS[g.lower];
    const pure = g.upper === g.lower;
    const eUp = up.element, eLo = lo.element;
    let relation;
    if (pure) relation = `上下皆${up.name}，${up.nature}${up.virtue}之象重叠，宜守其本、勿求外助`;
    else if (SHENG[eUp] === eLo) relation = `外${up.name}生内${lo.name}，环境来助，事有可乘之势`;
    else if (SHENG[eLo] === eUp) relation = `内${lo.name}生外${up.name}，心力外付，宜量力而行`;
    else if (KE[eUp] === eLo) relation = `外${up.name}克内${lo.name}，外有牵制，先安内而后动`;
    else if (KE[eLo] === eUp) relation = `内${lo.name}克外${up.name}，我能持势，然不可逼之过甚`;
    else relation = `外${up.name}（${up.nature}·${up.virtue}）与内${lo.name}（${lo.nature}·${lo.virtue}）气类相侔，宜守正以观其变`;

    const n = movingIdx.length;
    let motion;
    if (n === 0) motion = '六爻皆静，只观本卦：眼下的局面宜守不宜造，顺其势而徐图之。';
    else if (n === 1) motion = `${YAO_NAMES[movingIdx[0]]}独动，一念起而全局转，关键在那一处的取舍。`;
    else if (n <= 3) motion = `${movingIdx.map(i => YAO_NAMES[i]).join('、')}动，变数渐增，宜分步而行，莫一时并进。`;
    else motion = `${n} 爻俱动，卦气摇荡，诸事未定，此时宜静观，不宜骤决。`;

    let turning;
    if (!zhi) turning = '本卦无之卦，取象止于当下。';
    else if (g.upper === zhi.upper) {
      const zLo = TRIGRAMS[zhi.lower];
      turning = `由「${g.short}」之「${zhi.short}」，动在内卦：下卦由${lo.name}${lo.nature}转为${zLo.name}${zLo.nature}，外势未改而内里先变。`;
    } else if (g.lower === zhi.lower) {
      const zUp = TRIGRAMS[zhi.upper];
      turning = `由「${g.short}」之「${zhi.short}」，动在外卦：上卦由${up.name}${up.nature}转为${zUp.name}${zUp.nature}，本心未移而外境已换。`;
    } else {
      turning = `由「${g.short}」之「${zhi.short}」，内外皆动，局面正在整体换个方向。`;
    }

    return {
      relation, motion, turning,
      yi: [lo.yi, up.yi], ji: [lo.ji, up.ji],
      meta: `上${up.name} ${up.glyph} ${up.nature} · 下${lo.name} ${lo.glyph} ${lo.nature}　|　${n} 爻动`,
    };
  }

  /* ---------- 《周易》经文 ----------
     iching-text.js 按通行卦序存 [撮要, 卦辞, 大象, 彖辞, 六爻, 用辞]。 */
  const TEXT = Array.isArray(window.__ichingText) && window.__ichingText.length === 64
    ? window.__ichingText : null;
  /* 白话今译与经文同序，字段见 iching-plain.js 文件头 */
  const PLAIN = Array.isArray(window.__ichingPlain) && window.__ichingPlain.length === 64
    ? window.__ichingPlain : null;
  const plainOf = no => PLAIN ? PLAIN[no - 1] : null;
  const YAO_POS = ['初', '二', '三', '四', '五', '上'];
  const textOf = no => TEXT ? TEXT[no - 1] : null;
  function yaoTitle(i, yang) {
    const n = yang ? '九' : '六';
    return i === 0 ? '初' + n : i === 5 ? '上' + n : n + YAO_POS[i];
  }

  /* ---------- 断辞所依：朱熹《易学启蒙》变占七例 ----------
     不变取本卦卦辞；一爻动取该爻爻辞；二爻动取两爻而以上爻为主；
     三爻动本卦为贞、之卦为悔，兼参两卦卦辞；四爻动取之卦两静爻
     而以下爻为主；五爻动取之卦静爻；六爻皆动，乾坤取用九用六，
     余卦以之卦卦辞断。 */
  function decide(rd) {
    const { ben, zhi, yaos, movingIdx } = rd;
    const bt = textOf(ben.no), zt = zhi ? textOf(zhi.no) : null;
    const bp = plainOf(ben.no), zp = zhi ? plainOf(zhi.no) : null;
    const n = movingIdx.length;
    const still = [0, 1, 2, 3, 4, 5].filter(i => !movingIdx.includes(i));
    /* 每条断辞同时带上对应白话今译：卦辞取 ci，爻辞按卦序 + 爻位取 y[i] */
    const ci = (label, t, p) => ({ label, text: t ? t[1] : '', plain: p ? p.ci : '' });
    const benYao = (i, main) => ({
      label: `${yaoTitle(i, yaos[i].yang)} · 本卦${YAO_NAMES[i]}${main ? '（主）' : ''}`,
      text: bt ? bt[4][i] : '', plain: bp ? bp.y[i] : '', main: !!main,
    });
    const zhiYao = (i, main) => {
      const yang = yaos[i].moving ? !yaos[i].yang : yaos[i].yang;
      return {
        label: `${yaoTitle(i, yang)} · 之卦${YAO_NAMES[i]}${main ? '（主）' : ''}`,
        text: zt ? zt[4][i] : '', plain: zp ? zp.y[i] : '', main: !!main,
      };
    };
    let rule, items;
    if (n === 0) {
      rule = '六爻皆不变 · 以本卦卦辞断';
      items = [ci(`${ben.name} · 卦辞`, bt, bp)];
    } else if (n === 1) {
      rule = '一爻动 · 以本卦变爻爻辞断';
      items = [benYao(movingIdx[0], true)];
    } else if (n === 2) {
      rule = '二爻动 · 以本卦两变爻爻辞断，以上爻为主';
      items = [benYao(movingIdx[0]), benYao(movingIdx[1], true)];
    } else if (n === 3) {
      rule = '三爻动 · 本卦为贞、之卦为悔，兼参两卦卦辞';
      items = [ci(`${ben.name} · 本卦卦辞`, bt, bp), ci(`${zhi.name} · 之卦卦辞`, zt, zp)];
    } else if (n === 4) {
      rule = '四爻动 · 以之卦两不变爻爻辞断，以下爻为主';
      items = [zhiYao(still[0], true), zhiYao(still[1])];
    } else if (n === 5) {
      rule = '五爻动 · 以之卦不变爻爻辞断';
      items = [zhiYao(still[0], true)];
    } else if (bt && bt[5]) {
      rule = '六爻皆动 · 乾坤取「用九 / 用六」';
      items = [{ label: ben.no === 1 ? '用九' : '用六', text: bt[5], plain: bp ? bp.u : '', main: true }];
    } else {
      rule = '六爻皆动 · 以之卦卦辞断';
      items = [ci(`${zhi.name} · 之卦卦辞`, zt, zp)];
    }
    return {
      rule, items,
      note: '上面先列经文原文，其后浅色一行是白话今译。断辞只是读卦的入手处，仍须合本卦卦辞、大象与全卦形势通看。',
    };
  }

  /* ---------- 每日一卦：以日期为种子，同一天恒定，次日自换 ---------- */
  function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyReading() {
    const key = dateKey();
    const cacheKey = 'ew_gua_v1_' + key;
    let nums = null;
    try { nums = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { /* 缓存损坏则重算 */ }
    if (!Array.isArray(nums) || nums.length !== 6) {
      const rng = mulberry32(hash32('earworm · ' + key));
      const yaos = castHexagram(rng);
      nums = yaos.map(y => y.num);
      try { localStorage.setItem(cacheKey, JSON.stringify(nums)); } catch { /* 隐私模式忽略 */ }
    }
    return readingOf(nums.map(n => ({
      num: n,
      coins: coinFaces(n),
      yang: n === 7 || n === 9,
      moving: n === 6 || n === 9,
    })));
  }
  // 由爻数反推一组铜钱字面，仅供复现今日卦的动画展示。
  // 背记 3、字记 2：三背 9 老阳、一背 7 少阳、二背 8 少阴、无背 6 老阴。
  function coinFaces(n) {
    const backs = ({ 9: 3, 7: 1, 8: 2, 6: 0 })[n] ?? 0;
    return [0, 1, 2].map(i => (i < backs ? 3 : 2));
  }

  /* ---------- DOM：侧栏签条 ---------- */
  const sticker = document.createElement('button');
  sticker.type = 'button';
  sticker.className = 'gua-sticker';
  sticker.id = 'gua-sticker';
  sticker.innerHTML = `
    <span class="gs-taiji" aria-hidden="true"></span>
    <span class="gs-text">
      <span class="gs-kicker">今日一卦 · 太极起象</span>
      <span class="gs-name" id="gs-name">—</span>
    </span>
    <span class="gs-go">抽一签 ›</span>`;
  const quote = document.querySelector('.sp-quote');
  if (quote) quote.after(sticker);

  /* ---------- DOM：起卦面板 ---------- */
  const modal = document.createElement('div');
  modal.className = 'gua-modal';
  modal.id = 'gua-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="gua-card" role="dialog" aria-modal="true" aria-labelledby="gua-title">
      <button type="button" class="gua-close" id="gua-close" aria-label="收卦">✕</button>
      <div class="gua-head">
        <span class="gua-seal">易</span>
        <div class="gh-title">
          <h2 id="gua-title">闻曲 · 今日一卦</h2>
          <p>太极生两仪 · 两仪生四象 · 四象生八卦</p>
        </div>
      </div>
      <div class="gua-stage">
        <div class="gua-wheel" aria-hidden="true">
          <div class="gua-ring" id="gua-ring"></div>
          <svg class="taiji" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="96" fill="#e9e4d8"/>
            <path d="M100 4 A96 96 0 0 1 100 196 A48 48 0 0 1 100 100 A48 48 0 0 0 100 4 Z" fill="#0b0d10"/>
            <circle cx="100" cy="52" r="15" fill="#0b0d10"/>
            <circle cx="100" cy="148" r="15" fill="#e9e4d8"/>
            <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(230,176,106,.45)" stroke-width="2"/>
          </svg>
        </div>
        <div class="gua-hex">
          <div class="gh-label">本卦 · 六爻（自下而上）</div>
          <div class="gh-lines" id="gh-lines"></div>
          <div class="gh-meta" id="gh-meta"></div>
          <div class="gua-coins" id="gua-coins" aria-hidden="true">
            <i class="coin"></i><i class="coin"></i><i class="coin"></i>
            <span class="coins-note" id="coins-note">三枚铜钱 · 六掷成卦</span>
          </div>
        </div>
      </div>
      <div class="gua-result">
        <div class="gr-seal" id="gr-seal">卦</div>
        <div class="gr-body">
          <div class="gr-name" id="gr-name"></div>
          <div class="gr-sub" id="gr-sub"></div>
          <p class="gr-read" id="gr-read"></p>
          <div class="gr-yiji"><span id="gr-yi"></span><span id="gr-ji"></span></div>
        </div>
      </div>
      <section class="gua-comm" id="gua-comm" aria-label="卦解">
        <div class="gc-head">
          <h3>白话卦解</h3>
          <span class="gc-src">今译 · 依经文字面直译</span>
        </div>
        <div class="gp-lead" id="gp-lead"></div>
        <p class="gp-change" id="gp-change" hidden></p>
        <details class="gc-fold gc-extra">
          <summary>延伸 · 经义撮要与取象今释</summary>
          <p class="gc-gist" id="gc-gist"></p>
          <p class="gc-sum" id="gc-sum"></p>
        </details>
        <div class="gc-cols">
          <div class="gc-block">
            <span class="gc-k">卦辞 · 原文</span>
            <p class="gc-text" id="gc-ci"></p>
            <p class="gc-plain" id="gc-ci-plain"></p>
          </div>
          <div class="gc-block">
            <span class="gc-k">象曰 · 原文</span>
            <p class="gc-text" id="gc-xiang"></p>
            <p class="gc-plain" id="gc-xiang-plain"></p>
          </div>
        </div>
        <details class="gc-fold">
          <summary>彖曰 · 卦辞义理（原文）</summary>
          <p class="gc-text" id="gc-tuan"></p>
          <p class="gc-fold-note">彖传是对卦辞的义理阐发，读时可对照上方「白话卦解」与卦辞今译。</p>
        </details>
        <div class="gc-verdict">
          <div class="gv-head">
            <span class="gv-k">断辞所依</span>
            <span class="gv-rule" id="gv-rule"></span>
          </div>
          <div class="gv-items" id="gv-items"></div>
          <p class="gv-note" id="gv-note"></p>
        </div>
        <details class="gc-fold">
          <summary>六爻爻辞 · 原文与白话</summary>
          <div class="gc-yaos" id="gc-yaos"></div>
        </details>
        <p class="gc-footnote">断卦参朱熹《易学启蒙》变占之例。卦辞、爻辞、彖、象为《周易》原文；白话卦解与逐条今译由今人依字面直译，供理解参考，义理以原文为准，不作吉凶断语。</p>
      </section>
      <div class="gua-foot">
        <span class="gf-note">三枚铜钱六掷成卦 · 老阴老阳为动爻 · 白话今译依《周易》经文</span>
        <div class="gf-acts">
          <button type="button" class="chip-btn" id="gua-again">再起一卦</button>
          <button type="button" class="chip-btn accent" id="gua-daily">回到今日一卦</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  /* 先天（伏羲）八卦方位：上南下北、左东右西。
     自正上方顺时针依次：乾、巽、坎、艮、坤、震、离、兑。
     数组里存的是 TRIGRAMS 的索引，位置角与卦序分开，避免把「次序」当成「方位」。 */
  const XIAN_TIAN = [0, 4, 5, 6, 7, 3, 2, 1];
  const ring = document.getElementById('gua-ring');
  XIAN_TIAN.forEach((idx, pos) => {
    const t = TRIGRAMS[idx];
    const s = document.createElement('span');
    s.className = 'ring-gua';
    s.textContent = t.glyph;
    s.style.transform = `rotate(${pos * 45}deg) translateY(-76px) rotate(${-pos * 45}deg)`;
    s.dataset.idx = String(idx);
    s.title = `${t.name} · ${t.nature} · ${t.virtue} · 五行属${t.element}`;
    ring.appendChild(s);
  });

  const $ = id => document.getElementById(id);
  const linesEl = $('gh-lines'), coinsEl = $('gua-coins');
  let current = null, castToken = 0;
  function showResults(on) {
    const fn = on ? 'add' : 'remove';
    document.querySelector('.gua-result').classList[fn]('shown');
    $('gua-comm').classList[fn]('shown');
  }

  /* ---------- 渲染：卦象 / 卦意 ---------- */
  function renderReading(rd, opts = {}) {
    current = rd;
    const { ben, yaos, movingIdx } = rd;
    $('gua-title').textContent = opts.daily ? '闻曲 · 今日一卦' : '闻曲 · 随起一卦';

    // 八卦环点亮本卦的上下卦
    ring.querySelectorAll('.ring-gua').forEach(el => {
      el.classList.toggle('on', Number(el.dataset.idx) === ben.upper || Number(el.dataset.idx) === ben.lower);
    });

    // 六爻：DOM 自上而下（上爻 → 初爻），逐爻落定
    linesEl.innerHTML = '';
    for (let i = 5; i >= 0; i--) {
      const y = yaos[i];
      const el = document.createElement('div');
      el.className = 'yao ' + (y.yang ? 'yang' : 'yin') + (y.moving ? ' moving' : '');
      el.innerHTML = `<span class="y-bars"><span class="y-bar"></span><span class="y-bar"></span></span>
        <span class="y-mark">${y.moving ? (y.num === 9 ? '○' : '×') : ''}</span>
        <span class="y-name">${YAO_NAMES[i]}</span>`;
      el.dataset.order = String(5 - i);
      linesEl.appendChild(el);
    }
    $('gh-meta').textContent = rd.meta;

    $('gr-seal').textContent = ben.short;
    $('gr-name').textContent = `${ben.name} · 《周易》第 ${ben.no} 卦`;
    $('gr-sub').textContent = movingIdx.length
      ? `之卦「${rd.zhi.name}」　动爻：${movingIdx.map(i => YAO_NAMES[i]).join('、')}`
      : '六爻皆静 · 无之卦';
    const txt = textOf(ben.no), bp = plainOf(ben.no);
    /* 结果卡首屏直接给白话：这一卦在讲什么、宜如何自处 */
    $('gr-read').textContent = bp ? `${bp.g[1]}${bp.g[2]}` : (txt ? txt[0] : `${rd.relation}。`);
    $('gr-yi').textContent = '宜 · ' + rd.yi.join(' / ');
    $('gr-ji').textContent = '忌 · ' + rd.ji.join(' / ');
    $('coins-note').textContent = opts.daily ? '今日之卦 · 同日不更' : '三枚铜钱 · 六掷成卦';
    renderCommentary(rd, txt, decide(rd));
  }

  /* ---------- 渲染：白话卦解 + 经文原文（逐条附今译）+ 变占断辞 ---------- */
  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function renderCommentary(rd, txt, dc) {
    const bp = plainOf(rd.ben.no);
    const zp = rd.zhi ? plainOf(rd.zhi.no) : null;

    /* 整卦白话卦解：卦象 / 卦义 / 自处 */
    const lead = $('gp-lead');
    lead.replaceChildren();
    if (bp) {
      const keys = ['卦象', '卦义', '自处'];
      bp.g.forEach((s, i) => {
        const row = node('div', 'gp-row');
        row.append(node('span', 'gp-k', keys[i]), node('span', 'gp-v', s));
        lead.appendChild(row);
      });
    } else {
      lead.appendChild(node('p', 'gp-v', '白话今译未载入'));
    }

    /* 之卦白话：变了之后，讲的是另一种处境 */
    const change = $('gp-change');
    if (rd.zhi && zp) {
      change.hidden = false;
      change.textContent = `之卦「${rd.zhi.name}」· 变到这一境时：${zp.g[0]}${zp.g[2]}`;
    } else {
      change.hidden = true;
      change.textContent = '';
    }

    $('gc-gist').textContent = txt ? `经义撮要 · ${txt[0]}` : '';
    $('gc-sum').textContent = `${rd.relation}。${rd.motion}${rd.turning}`;
    $('gc-ci').textContent = txt ? txt[1] : '经文未载入';
    $('gc-ci-plain').textContent = bp ? bp.ci : '';
    $('gc-xiang').textContent = txt ? txt[2] : '';
    $('gc-xiang-plain').textContent = bp ? bp.xiang : '';
    $('gc-tuan').textContent = txt ? txt[3] : '';
    $('gv-rule').textContent = dc.rule;
    $('gv-note').textContent = dc.note;

    const items = $('gv-items');
    items.replaceChildren();
    dc.items.forEach(it => {
      const box = node('div', 'gv-item' + (it.main ? ' main' : ''));
      box.append(node('span', 'gv-label', it.label), node('p', 'gv-text', it.text || '—'));
      if (it.plain) box.append(node('p', 'gv-plain', it.plain));
      items.appendChild(box);
    });

    const yaos = $('gc-yaos');
    yaos.replaceChildren();
    for (let i = 5; i >= 0; i--) {
      const y = rd.yaos[i];
      const row = node('div', 'gc-yao' + (y.moving ? ' moving' : ''));
      const body = node('div', 'gcy-body');
      body.append(node('span', 'gcy-text', txt ? txt[4][i] : ''));
      if (bp && bp.y[i]) body.append(node('span', 'gcy-plain', bp.y[i]));
      row.append(
        node('span', 'gcy-title', `${yaoTitle(i, y.yang)}${y.moving ? ' · 动' : ''}`),
        body
      );
      yaos.appendChild(row);
    }
    document.querySelectorAll('.gua-comm details').forEach(d => { d.open = false; });
    document.querySelector('.gua-card').scrollTop = 0;
  }

  /* ---------- 动画：铜钱翻掷 → 六爻自下而上落定 → 卦意浮现 ---------- */
  function animateCast(rd, done) {
    const token = ++castToken;
    const coins = [...coinsEl.querySelectorAll('.coin')];
    const lineEls = [...linesEl.querySelectorAll('.yao')].reverse(); // 视觉上的初爻 → 上爻
    const step = REDUCED ? 0 : 230;

    modal.classList.add('casting');
    lineEls.forEach(el => el.classList.remove('settled'));
    showResults(false);
    $('coins-note').textContent = '铜钱落案……';

    function oneYao(k) {
      if (token !== castToken) return;
      if (k >= 6) {
        modal.classList.remove('casting');
        showResults(true);
        $('coins-note').textContent = '六爻已定 · 卦成';
        if (done) done();
        return;
      }
      const y = rd.yaos[k];
      coins.forEach((c, ci) => {
        c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
        c.setAttribute('data-label', y.coins[ci] === 3 ? '背' : '字');
      });
      const el = lineEls[k];
      if (el) el.classList.add('settled');
      $('coins-note').textContent = `第 ${k + 1} 爻 · ${y.num === 6 ? '老阴' : y.num === 7 ? '少阳' : y.num === 8 ? '少阴' : '老阳'}${y.moving ? '（动）' : ''}`;
      setTimeout(() => oneYao(k + 1), step);
    }
    if (step === 0) {
      lineEls.forEach(el => el.classList.add('settled'));
      showResults(true);
      modal.classList.remove('casting');
      if (done) done();
    } else setTimeout(() => oneYao(0), 260);
  }

  /* ---------- 交互 ---------- */
  function openPanel(castDaily) {
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('show'));
    const daily = dailyReading();
    renderReading(daily, { daily: true });
    if (castDaily && !REDUCED) {
      animateCast(daily);
    } else {
      linesEl.querySelectorAll('.yao').forEach(el => el.classList.add('settled'));
      showResults(true);
      $('coins-note').textContent = '今日之卦 · 同日不更';
    }
  }
  function closePanel() {
    castToken++;
    modal.classList.remove('show');
    setTimeout(() => { modal.hidden = true; }, 240);
  }

  sticker.addEventListener('click', () => {
    const first = !sessionStorage.getItem('ew_gua_seen');
    try { sessionStorage.setItem('ew_gua_seen', '1'); } catch { /* 忽略 */ }
    openPanel(first);
  });
  $('gua-close').addEventListener('click', closePanel);
  modal.addEventListener('click', (e) => { if (e.target === modal) closePanel(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) { e.stopPropagation(); closePanel(); }
  }, true);
  $('gua-again').addEventListener('click', () => {
    const rd = readingOf(castHexagram(Math.random));
    renderReading(rd, { daily: false });
    animateCast(rd);
  });
  $('gua-daily').addEventListener('click', () => {
    castToken++;
    const rd = dailyReading();
    renderReading(rd, { daily: true });
    linesEl.querySelectorAll('.yao').forEach(el => el.classList.add('settled'));
    showResults(true);
    $('coins-note').textContent = '今日之卦 · 同日不更';
    $('gs-name').textContent = `${rd.ben.name} · 第 ${rd.ben.no} 卦`;
  });

  // 首屏就把今日卦算好，签条像一张真正的便签
  const today = dailyReading();
  $('gs-name').textContent = `${today.ben.name} · 第 ${today.ben.no} 卦`;

  /* 暴露只读的起卦内核，方便回归脚本校验卦名、动爻与今译，不污染播放器 */
  window.__iching = {
    TRIGRAMS, NAMES, ORDER, castHexagram, hexagramOf, changingOf, readingOf, dailyReading,
    textOf, plainOf, yaoTitle, decide, TEXT, PLAIN,
  };
})();
