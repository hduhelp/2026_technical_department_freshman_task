/* ============================================================
   失物招领系统 · 前端核心（API 封装 + 通用组件 + 页面逻辑）
   纯原生 JS，无需构建，直接由后端静态托管
   ============================================================ */
const API_BASE = '/api/v1';

/* ---------- 会话状态 ---------- */
const Store = {
  get access() { return localStorage.getItem('lf_access') || ''; },
  set access(v) { v ? localStorage.setItem('lf_access', v) : localStorage.removeItem('lf_access'); },
  get refresh() { return localStorage.getItem('lf_refresh') || ''; },
  set refresh(v) { v ? localStorage.setItem('lf_refresh', v) : localStorage.removeItem('lf_refresh'); },
  get user() { try { return JSON.parse(localStorage.getItem('lf_user') || 'null'); } catch (e) { return null; } },
  set user(v) { v ? localStorage.setItem('lf_user', JSON.stringify(v)) : localStorage.removeItem('lf_user'); },
  get logged() { return !!this.access && !!this.user; },
  clear() { this.access = ''; this.refresh = ''; this.user = ''; },
};

/* ---------- 通用工具 ---------- */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function qs(name) { return new URLSearchParams(location.search).get(name) || ''; }
function el(id) { return document.getElementById(id); }
function toast(msg, type = '') {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.className = 'toast show ' + type;
  t.textContent = msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast ' + type; }, 2600);
}
function fmtTime(s, friendly = true) {
  if (!s) return '-';
  const d = new Date(s.replace(/-/g, '/'));
  if (Number.isNaN(d.getTime())) return s;
  if (!friendly) return s.slice(0, 16);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return s.slice(0, 10);
}
function highlight(text, kw) {
  const safe = esc(text);
  if (!kw) return safe;
  const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return safe.replace(new RegExp(k, 'gi'), (m) => `<em class="hl">${m}</em>`); } catch (e) { return safe; }
}
function remainHours(deadline) {
  if (!deadline) return 0;
  const d = new Date(deadline.replace(/-/g, '/'));
  const h = Math.ceil((d.getTime() - Date.now()) / 3600000);
  return h > 0 ? h : 0;
}
function confirmBox(msg) { return window.confirm(msg); }
function closeModal() { const m = document.querySelector('.modal-mask'); if (m) m.remove(); }
function openModal(html) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">${html}</div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
  return mask;
}
function viewImage(url) {
  const v = document.createElement('div');
  v.className = 'img-viewer';
  v.innerHTML = `<img src="${esc(url)}" alt="图片预览">`;
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

/* ---------- API 调用（带令牌刷新重试） ---------- */
async function api(path, { method = 'GET', body, isForm = false, auth = true, retry = true } = {}) {
  const headers = {};
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && Store.access) headers['Authorization'] = 'Bearer ' + Store.access;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method, headers, body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    toast('网络连接失败，请检查服务是否已启动', 'error');
    throw e;
  }

  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }

  const code = json ? json.code : res.status;
  if (code === 0) return json.data;

  // 令牌过期：尝试静默刷新一次
  if ((code === 1006 || res.status === 401) && retry && Store.refresh) {
    const okRefresh = await tryRefresh();
    if (okRefresh) return api(path, { method, body, isForm, auth, retry: false });
  }
  if (code === 1001 || code === 1006) {
    Store.clear();
    renderNav();
    const back = encodeURIComponent(location.pathname + location.search);
    if (!location.pathname.endsWith('login.html')) {
      toast('登录已过期，请重新登录', 'error');
      setTimeout(() => location.href = `login.html?redirect=${back}`, 900);
    }
    throw new Error(json ? json.message : '未登录');
  }

  const msg = (json && json.message) || `请求失败（${res.status}）`;
  toast(msg, 'error');
  const err = new Error(msg);
  err.code = code;
  err.data = json ? json.data : null;
  throw err;
}

async function tryRefresh() {
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: Store.refresh }),
    });
    const json = await res.json();
    if (json.code === 0 && json.data.accessToken) { Store.access = json.data.accessToken; return true; }
  } catch (e) { /* ignore */ }
  Store.clear();
  return false;
}

/* ---------- 站点配置 ---------- */
let SITE = { claimTimeoutHours: 72, imageMaxCount: 6, imageMaxMb: 5, allowAnonymous: true };
async function loadSiteConfig() {
  try { SITE = Object.assign(SITE, await api('/site/config', { auth: Store.logged })); } catch (e) { /* ignore */ }
  return SITE;
}

/* ---------- 顶部导航 ---------- */
function renderNav(active = '') {
  const box = el('nav');
  if (!box) return;
  const u = Store.user;
  const userArea = Store.logged
    ? `<span class="row" style="gap:0">
         <a class="btn btn-sm btn-primary" style="border-radius:8px 0 0 8px" href="publish.html">我要发布</a>
         <a class="btn btn-sm btn-orange" style="border-radius:0 8px 8px 0" href="admin.html">管理端</a>
       </span>
       <a class="nav-link ${active === 'center' ? 'active' : ''}" href="my-items.html">
         ${u.avatar ? `<img class="avatar-sm" src="${esc(u.avatar)}" alt="">` : `<span class="avatar-sm">${esc((u.nickname || 'U')[0])}</span>`}
         ${esc(u.nickname)}<span id="navUnread"></span>
       </a>
       <button class="btn btn-sm" onclick="doLogout()">退出</button>`
    : `<a class="nav-link ${active === 'login' ? 'active' : ''}" href="login.html">登录</a>
       <a class="nav-link" href="register.html">注册</a>
       <span class="row" style="gap:0">
         <a class="btn btn-sm btn-primary" style="border-radius:8px 0 0 8px" href="login.html?redirect=publish.html">我要发布</a>
         <a class="btn btn-sm btn-orange" style="border-radius:0 8px 8px 0" href="login.html?redirect=admin.html">管理端</a>
       </span>`;

  box.className = 'nav';
  box.innerHTML = `
    <div class="nav-inner">
      <a class="logo" href="index.html">失物<span>招领</span></a>
      <div class="nav-search">
        <input id="navKw" type="text" placeholder="搜索物品名称、特征、地点…"
               onkeydown="if(event.key==='Enter')goSearch()">
        <button onclick="goSearch()">搜索</button>
      </div>
      <div class="nav-right">
        <a class="nav-link ${active === 'home' ? 'active' : ''}" href="index.html">首页</a>
        <a class="nav-link ${active === 'search' ? 'active' : ''}" href="search.html">全部信息</a>
        <a class="nav-link ${active === 'claims' ? 'active' : ''}" href="my-claims.html">我的认领</a>
        ${userArea}
      </div>
    </div>`;
  if (Store.logged) loadUnread();
}

async function loadUnread() {
  try {
    const d = await api('/claims/unread-count');
    const span = el('navUnread');
    if (span && d.count > 0) span.innerHTML = `<span class="badge-dot">${d.count}</span>`;
  } catch (e) { /* ignore */ }
}

function goSearch() {
  const kw = (el('navKw') || {}).value || '';
  location.href = 'search.html?keyword=' + encodeURIComponent(kw.trim());
}
async function doLogout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  Store.clear();
  toast('已退出登录', 'success');
  setTimeout(() => location.href = 'index.html', 500);
}
function requireLogin(redirect) {
  if (Store.logged) return true;
  toast('请先登录', 'error');
  setTimeout(() => location.href = 'login.html?redirect=' + encodeURIComponent(redirect || (location.pathname + location.search)), 700);
  return false;
}

/* ---------- 卡片渲染 ---------- */
function tagHtml(it) {
  const parts = [];
  parts.push(it.type === 1
    ? '<span class="tag tag-lost">失物</span>'
    : '<span class="tag tag-found">招领</span>');
  if (it.categoryName) parts.push(`<span class="tag tag-cat">${esc(it.categoryName)}</span>`);
  if (it.status === 2) parts.push('<span class="tag tag-end">已结束</span>');
  if (it.type === 1 && it.claimStatusName) {
    parts.push(it.claimStatus === 1
      ? `<span class="tag tag-claiming">${esc(it.claimStatusName)}</span>`
      : '<span class="tag tag-noclaim">暂未认领</span>');
  }
  if (it.isAnonymous) parts.push('<span class="tag tag-anon">匿名发布</span>');
  return parts.join('');
}

function cardHtml(it, kw) {
  const thumb = it.coverThumb
    ? `<img src="${esc(it.coverThumb)}" alt="${esc(it.title)}" loading="lazy">`
    : '暂无图片';
  return `
  <div class="item-card ${it.status === 2 ? 'done' : ''}" onclick="location.href='item.html?id=${it.id}'">
    <div class="thumb">${thumb}</div>
    <div class="item-body">
      <div class="row" style="gap:6px">${tagHtml(it)}</div>
      <h3 class="item-title">${highlight(it.title, kw)}</h3>
      <div class="item-meta">
        <span>📍 ${esc(it.locationText || it.locationDetail || '')}</span>
        <span>🕒 ${esc((it.happenTime || '').slice(0, 10))}</span>
      </div>
      <div class="item-foot">
        <span>${esc(it.publisherNickname || '')} · ${fmtTime(it.createTime)}</span>
        <span>浏览 ${it.viewCount || 0}</span>
      </div>
    </div>
  </div>`;
}

function renderList(container, list, kw, emptyText = '没有找到相关信息，换个关键词试试') {
  const box = typeof container === 'string' ? el(container) : container;
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = `<div class="empty">
        <div class="icon">🔍</div>
        <div>${esc(emptyText)}</div>
        <div class="mt8"><a class="btn btn-sm" href="search.html">查看全部信息</a></div>
      </div>`;
    return;
  }
  box.innerHTML = list.map((it) => cardHtml(it, kw)).join('');
}

function renderSkeleton(box, n = 6) {
  const target = typeof box === 'string' ? el(box) : box;
  if (!target) return;
  target.innerHTML = Array.from({ length: n }, () => `
    <div class="item-card">
      <div class="thumb skeleton"></div>
      <div class="item-body">
        <div class="skeleton" style="height:14px;width:60%"></div>
        <div class="skeleton" style="height:18px;width:92%"></div>
        <div class="skeleton" style="height:14px;width:40%"></div>
      </div>
    </div>`).join('');
}

function pagerHtml(page, pages, onclickName) {
  if (!pages || pages <= 1) return '';
  const btns = [];
  btns.push(`<button ${page <= 1 ? 'disabled' : ''} onclick="${onclickName}(${page - 1})">‹ 上一页</button>`);
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) {
    btns.push(`<button class="${i === page ? 'active' : ''}" onclick="${onclickName}(${i})">${i}</button>`);
  }
  btns.push(`<button ${page >= pages ? 'disabled' : ''} onclick="${onclickName}(${page + 1})">下一页 ›</button>`);
  return `<div class="pager">${btns.join('')}<span class="muted">共 ${pages} 页</span></div>`;
}

/* ---------- 字典缓存 ---------- */
const Dict = {
  categories: [], locations: { campus: [], outside: [] },
  async load() {
    const [c, l] = await Promise.all([api('/categories'), api('/locations/tree')]);
    this.categories = c.list || [];
    this.locations = { campus: l.campus || [], outside: l.outside || [] };
    return this;
  },
  catName(id) { const c = this.categories.find((x) => x.id === Number(id)); return c ? c.name : ''; },
  locName(id) {
    const all = [...this.locations.campus, ...this.locations.outside];
    const l = all.find((x) => x.id === Number(id));
    return l ? l.name : '';
  },
  locList(areaType) { return Number(areaType) === 2 ? this.locations.outside : this.locations.campus; },
};

/* ---------- 上传 ---------- */
async function uploadImage(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  const data = await api('/images', { method: 'POST', body: fd, isForm: true });
  if (onProgress) onProgress(data);
  return data;
}

/* ---------- 页面启动 ---------- */
async function boot(active) {
  renderNav(active);
  await loadSiteConfig();
  renderNav(active);
}
