/* ============================================================
   失物招领系统 · 原型演示脚本（纯前端模拟数据，不连接后端）
   ============================================================ */

/* ---------- 演示数据 ---------- */
const CATEGORIES = [
  { id: 1, name: '证件卡类' }, { id: 2, name: '电子产品' }, { id: 3, name: '书籍资料' },
  { id: 4, name: '衣物鞋帽' }, { id: 5, name: '钥匙' }, { id: 6, name: '饰品手表' },
  { id: 7, name: '运动器材' }, { id: 8, name: '雨具' }, { id: 9, name: '钱包财物' },
  { id: 10, name: '其他' }
];

const LOCATIONS = ['教学楼 A 座', '图书馆 / 一楼大厅', '图书馆 / 二楼自习区', '一食堂', '二食堂',
  '宿舍 3 号楼', '体育馆', '操场', '行政楼', '校门口'];

/* 地点分两大类：校内 / 校外，选择后再自由填写详细地址 */
const CAMPUS_LOCATIONS = ['教学楼 A 座', '图书馆', '一食堂', '二食堂', '宿舍 3 号楼', '体育馆', '操场', '行政楼', '校门口'];
const OUTSIDE_LOCATIONS = ['校门口公交站', '地铁 2 号线站台', '周边超市 / 便利店', '周边餐饮店', '共享单车上', '其他校外地点'];

const ITEMS = [
  { id: 2001, type: 2, title: '在图书馆一楼大厅捡到一张校园卡', categoryId: 1, locType: 'campus', locDetail: '图书馆 / 一楼大厅（靠近自助借还机）',
    happenTime: '2025-06-11 14:20', time: '3 小时前', desc: '卡面姓名模糊，尾部编号 0482，已交至图书馆一楼服务台代管，请失主携带学生证认领。',
    phone: '138****1111', phoneFull: '13800001111', wechat: 'zs_2025', publisher: '张三', anonymous: false,
    handover: '图书馆一楼服务台', handoverPhone: '13866668888',
    views: 133, favs: 4, status: 1, images: 3 },
  { id: 2002, type: 1, title: '黑色蓝牙耳机丢失，带蓝色保护壳', categoryId: 2, locType: 'campus', locDetail: '体育馆东侧看台',
    happenTime: '2025-06-10 18:00', time: '昨天', desc: '品牌为漫步者，右耳耳机壳有轻微划痕，装在蓝色硅胶保护壳内。打球时可能掉在体育馆东侧看台。',
    phone: '139****2222', phoneFull: '13900002222', wechat: '', publisher: '李四', anonymous: false,
    views: 96, favs: 7, status: 1, images: 1 },
  { id: 2003, type: 1, title: '蓝色折叠雨伞丢失（伞柄有挂绳）', categoryId: 8, locType: 'outside', locDetail: '校门口公交站 302 路站牌旁',
    happenTime: '2025-06-09 12:30', time: '2 天前', desc: '深蓝色八骨折叠伞，伞柄上系着一根灰色挂绳，可能落在校门口公交站附近。',
    phone: '137****3333', phoneFull: '13700003333', wechat: 'wx_li', publisher: '王五', anonymous: false,
    handover: '', handoverPhone: '',
    views: 54, favs: 2, status: 1, images: 0 },
  { id: 2004, type: 2, title: '捡到一串钥匙（含宿舍门禁卡）', categoryId: 5, locType: 'campus', locDetail: '宿舍 3 号楼一楼门厅',
    happenTime: '2025-06-11 08:10', time: '今天', desc: '共 3 把钥匙 + 1 张门禁卡，挂在一个小黄鸭挂件上，已放在 3 号楼一楼宿管处。',
    phone: '', phoneFull: '', wechat: 'kind_2025', publisher: '匿名用户', anonymous: true,
    handover: '宿舍 3 号楼一楼宿管处', handoverPhone: '13877779999',
    views: 78, favs: 3, status: 1, images: 1 },
  { id: 2005, type: 1, title: '《数据结构与算法分析》教材丢失', categoryId: 3, locType: 'campus', locDetail: '教学楼 A 座 305 教室',
    happenTime: '2025-06-08 16:40', time: '3 天前', desc: '书内有较多笔记，扉页写着姓名首字母 L.M.，可能遗留在 A 座 305 教室。',
    phone: '135****5555', phoneFull: '13500005555', wechat: 'lm_2025', publisher: '刘明', anonymous: false,
    handover: '', handoverPhone: '',
    views: 41, favs: 1, status: 1, images: 0 },
  { id: 2006, type: 2, title: '在一食堂捡到一个保温杯（银色）', categoryId: 10, locType: 'campus', locDetail: '一食堂二楼餐盘回收处',
    happenTime: '2025-06-07 12:05', time: '4 天前', desc: '500ml 银色不锈钢保温杯，杯身贴有一张卡通贴纸，已放至一食堂失物暂存柜。',
    phone: '134****6666', phoneFull: '13400006666', wechat: '', publisher: '陈静', anonymous: false,
    handover: '一食堂二楼失物暂存柜', handoverPhone: '',
    views: 62, favs: 0, status: 1, images: 2 },
  { id: 2007, type: 2, title: '操场看台捡到一副黑框眼镜', categoryId: 6, locType: 'campus', locDetail: '操场西侧看台第三排',
    happenTime: '2025-06-05 19:30', time: '6 天前', desc: '黑色细框近视眼镜，镜腿内侧有度数标记，装在透明眼镜盒里。',
    phone: '133****7777', phoneFull: '13300007777', wechat: 'jy_2025', publisher: '孙悦', anonymous: false,
    views: 33, favs: 1, status: 2, images: 1 },
  { id: 2008, type: 1, title: '丢失一个粉色保温饭盒（含餐具）', categoryId: 10, locType: 'outside', locDetail: '地铁 2 号线站台（返校途中）',
    happenTime: '2025-06-04 11:50', time: '1 周前', desc: '粉色双层保温饭盒，内附不锈钢勺筷，饭盒盖上有小熊图案。',
    phone: '132****8888', phoneFull: '13200008888', wechat: '', publisher: '周桐', anonymous: false,
    views: 27, favs: 2, status: 2, images: 0 }
];

/* 认领申请：仅失物（type = 1）可被认领；超时 72 小时未沟通/完成的自动断开 */
const CLAIMS = [
  { id: 1, itemId: 2002, userId: 3, name: '王五', time: '2025-06-11 16:40', deadline: '2025-06-14 16:40', status: 'active', messages: 2 },
  { id: 2, itemId: 2002, userId: 4, name: '赵六', time: '2025-06-11 18:05', deadline: '2025-06-14 18:05', status: 'active', messages: 1 },
  { id: 3, itemId: 2005, userId: 2, name: '李四', time: '2025-06-09 10:00', deadline: '2025-06-12 10:00', status: 'expired', messages: 1 },
  { id: 4, itemId: 2008, userId: 2, name: '李四', time: '2025-06-05 09:30', deadline: '2025-06-08 09:30', status: 'done', messages: 4 }
];
const CLAIM_TIMEOUT_HOURS = 72;

const USERS = [
  { id: 1, name: '张三', phone: '13800001111', items: 6, status: 1, reg: '2025-01-02' },
  { id: 2, name: '李四', phone: '13900002222', items: 4, status: 1, reg: '2025-02-14' },
  { id: 3, name: '王五', phone: '13700003333', items: 3, status: 1, reg: '2025-03-08' },
  { id: 4, name: '赵六', phone: '13600004444', items: 1, status: 0, reg: '2025-04-21' }
];

/* ---------- 会话状态 ---------- */
const store = {
  get logged() { return sessionStorage.getItem('lf_logged') === '1'; },
  set logged(v) { v ? sessionStorage.setItem('lf_logged', '1') : sessionStorage.removeItem('lf_logged'); },
  get name() { return sessionStorage.getItem('lf_name') || '张三'; },
  set name(v) { sessionStorage.setItem('lf_name', v); }
};

const favIds = new Set([2001]);

/* ---------- 工具函数 ---------- */
const catName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).name || '其他';
const typeTag = (it) => it.type === 1
  ? '<span class="tag tag-lost">失物</span>' : '<span class="tag tag-found">招领</span>';
const statusTag = (it) => it.status === 1 ? '' : '<span class="tag tag-end">已结束</span>';
const anonTag = (it) => it.anonymous ? '<span class="tag tag-anon">匿名发布</span>' : '';
/* 地点展示：校内/校外 + 详细地址 */
const locText = (it) => (it.locType === 'outside' ? '校外 · ' : '校内 · ') + it.locDetail;
const locArea = (it) => (it.locType === 'outside' ? '校外' : '校内');

/* ---------- 认领状态 ---------- */
const activeClaims = (itemId) => CLAIMS.filter((c) => c.itemId === itemId && c.status === 'active');
const isClaiming = (itemId) => activeClaims(itemId).length > 0;
const myClaim = (itemId) => CLAIMS.find((c) => c.itemId === itemId && c.status === 'active' && c.mine);

/* 认领状态标识：有人提交申请 → 黄色「n 人认领中」；否则 → 蓝色「暂未认领」 */
function claimTag(it) {
  if (it.type !== 1) return '';
  const n = activeClaims(it.id).length;
  return n > 0
    ? `<span class="tag tag-claiming">${n} 人认领中</span>`
    : '<span class="tag tag-noclaim">暂未认领</span>';
}

function hoursLeft(deadline) {
  const ms = new Date(deadline.replace(/-/g, '/')) - new Date();
  if (ms <= 0) return 0;
  // 演示数据的截止时间是固定的历史时间，超过 72 小时则视为过期，不再显示倒计时
  const h = Math.ceil(ms / 3600000);
  return h > CLAIM_TIMEOUT_HOURS ? CLAIM_TIMEOUT_HOURS : h;
}

/* 剩余时间文案：有效时显示倒计时，超过 72 小时视为过期 */
function remainText(deadline) {
  const h = hoursLeft(deadline);
  return h > 0 ? h + ' 小时' : '已过期';
}

/* 提交认领申请 */
function submitClaim(itemId, note) {
  if (!store.logged) {
    location.href = 'login.html?redirect=item-detail.html?id=' + itemId;
    return false;
  }
  if (myClaim(itemId)) { toast('你已经提交过认领申请，请在站内私聊中继续沟通'); return false; }
  const now = new Date();
  const dl = new Date(now.getTime() + CLAIM_TIMEOUT_HOURS * 3600000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  CLAIMS.push({
    id: CLAIMS.length + 1, itemId, userId: 1, name: store.name, mine: true,
    time: fmt(now), deadline: fmt(dl), status: 'active', messages: 1,
    note: note || '这是我的物品，特征：'
  });
  toast(`认领申请已提交，请在 ${CLAIM_TIMEOUT_HOURS} 小时内与发布人沟通完成认领`);
  return true;
}

/* 发布人确认认领完成 */
function finishClaim(itemId) {
  const c = activeClaims(itemId)[0];
  if (c) c.status = 'done';
  toast('已确认认领完成，该信息可以标记为结束了');
}

/* 72 小时超时自动断开 */
function expireClaim(claimId) {
  const c = CLAIMS.find((x) => x.id === claimId);
  if (c) c.status = 'expired';
  toast('已解除该认领（超过 72 小时未沟通或未完成）');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* 关键词高亮（先转义再包裹，避免 XSS） */
function highlight(text, kw) {
  const safe = esc(text);
  if (!kw) return safe;
  const k = esc(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return safe.replace(new RegExp(k, 'gi'), (m) => `<em class="hl">${m}</em>`);
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- 顶部导航 ---------- */
function renderNav(active) {
  // 「我要发布」（蓝）+「管理端」（橙）连在一起，统一使用按钮样式
  const userArea = store.logged
    ? `<a class="nav-link" href="my-items.html">我的发布</a>
       <span class="muted">${esc(store.name)}</span>
       <span class="row" style="gap:0">
         <a class="btn btn-sm btn-primary" style="border-radius:8px 0 0 8px" href="item-publish.html">我要发布</a>
         <a class="btn btn-sm btn-orange" style="border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,.35)" href="admin.html">管理端</a>
       </span>
       <button class="btn btn-sm" onclick="logout()">退出</button>`
    : `<a class="nav-link" href="login.html">登录</a>
       <span class="row" style="gap:0">
         <a class="btn btn-sm btn-primary" style="border-radius:8px 0 0 8px" href="login.html?redirect=item-publish.html">我要发布</a>
         <a class="btn btn-sm btn-orange" style="border-radius:0 8px 8px 0;border-left:1px solid rgba(255,255,255,.35)" href="login.html?redirect=admin.html">管理端</a>
       </span>`;

  const html = `
  <div class="nav-inner">
    <a class="logo" href="index.html">失物<span>招领</span></a>
    <div class="nav-search">
      <input id="navKw" type="text" placeholder="搜索物品名称、特征、地点…" onkeydown="if(event.key==='Enter')goSearch()">
      <button onclick="goSearch()">搜索</button>
    </div>
    <div class="nav-right">
      <a class="nav-link ${active === 'home' ? 'logo' : ''}" href="index.html">首页</a>
      <a class="nav-link" href="search.html">全部信息</a>
      ${userArea}
    </div>
  </div>`;
  const box = document.getElementById('nav');
  box.className = 'nav';
  box.innerHTML = html;
}

function goSearch() {
  const kw = (document.getElementById('navKw') || {}).value || '';
  location.href = 'search.html?keyword=' + encodeURIComponent(kw.trim());
}

function logout() {
  store.logged = false;
  toast('已退出登录');
  setTimeout(() => location.href = 'index.html', 600);
}

/* ---------- 信息卡片 ---------- */
function cardHtml(it, kw) {
  return `
  <div class="item-card ${it.status === 2 ? 'done' : ''}" onclick="location.href='item-detail.html?id=${it.id}'">
    <div class="thumb">${it.images > 0 ? '图片 ' + it.images + ' 张' : '暂无图片'}</div>
    <div class="item-body">
      <div class="row" style="gap:6px">${typeTag(it)}<span class="tag tag-cat">${catName(it.categoryId)}</span>${statusTag(it)}${claimTag(it)}${anonTag(it)}</div>
      <h3 class="item-title">${highlight(it.title, kw)}</h3>
      <div class="item-meta">
        <span>📍 ${esc(locText(it))}</span>
        <span>🕒 ${esc(it.happenTime.slice(0, 10))}</span>
      </div>
      <div class="item-foot">
        <span>${esc(it.publisher)} · ${esc(it.time)}</span>
        <span>浏览 ${it.views}</span>
      </div>
    </div>
  </div>`;
}

function renderList(el, list, kw, emptyText) {
  if (!list.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="icon">🔍</div>
        <div>${emptyText || '没有找到相关信息，换个关键词试试'}</div>
        <div class="mt8"><a class="btn btn-sm" href="search.html">查看全部信息</a></div>
      </div>`;
    return;
  }
  el.innerHTML = list.map((it) => cardHtml(it, kw)).join('');
}

/* ---------- 检索逻辑（模拟后端筛选） ---------- */
function queryItems(q) {
  let list = ITEMS.slice();
  if (q.status !== 'all') list = list.filter((i) => i.status === (Number(q.status) || 1));
  if (q.type) list = list.filter((i) => i.type === Number(q.type));
  if (q.categoryId) list = list.filter((i) => i.categoryId === Number(q.categoryId));
  if (q.locArea) list = list.filter((i) => i.locType === q.locArea);
  if (q.location) list = list.filter((i) => i.locDetail.includes(q.location));
  if (q.keyword) {
    const k = q.keyword.toLowerCase();
    list = list.filter((i) => i.title.toLowerCase().includes(k) || i.desc.toLowerCase().includes(k));
  }
  // 认领筛选：claiming = 有人认领中，none = 暂未认领（仅失物有意义）
  if (q.claim === 'claiming') list = list.filter((i) => isClaiming(i.id));
  if (q.claim === 'none') list = list.filter((i) => !isClaiming(i.id));
  if (q.sort === 'oldest') list.reverse();
  return list;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name) || '';
}
