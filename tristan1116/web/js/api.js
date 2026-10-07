// ============================================================
//  api.js —— 所有页面共用的工具层
//  ① 后端地址  ② token 管理  ③ 请求封装  ④ 枚举中文映射  ⑤ 小工具
//  每个页面在 <head> 里先引这个文件，再写自己的逻辑
// ============================================================

// ---------- ① 后端地址 ----------
// 三种运行场景，自动判断：
//   ① 线上（tsx.world/lostfound/）→ Nginx 把 /lostfound/api/ 反代给后端
//   ② 本地后端托管（http://localhost:8080/app/...）→ 同源，用相对路径
//   ③ 本地前端单独打开（file:// 或别的端口）→ 指向本机后端
const API_BASE = (() => {
  if (location.hostname === 'tsx.world' || location.hostname === 'www.tsx.world') {
    return '/lostfound/api';
  }
  if (location.port === '8080') return '/api';
  return 'http://localhost:8080/api';
})();

// ---------- ② token 管理（存在浏览器本地） ----------
const TOKEN_KEY = 'lostfound_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
function isLoggedIn() {
  return !!getToken();
}

// ---------- ③ 请求封装 ----------
// 统一处理：自动带 token、自动解析 JSON、自动处理错误
// 用法：await api.get('/items?page=1') ／ await api.post('/items', {...})
async function request(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // fetch 抛异常 = 压根没连上服务器（后端没启动 / 地址不对）
    throw new Error('连不上服务器，请确认后端已启动');
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('服务器返回了无法解析的内容');
  }

  // 401：未登录或 token 过期 → 清掉本地 token，引导去登录
  if (res.status === 401) {
    clearToken();
    if (!opts.silent && !location.pathname.endsWith('login.html')) {
      toast('请先登录');
      // 登录后跳回当前页面
      const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
      setTimeout(() => { location.href = 'login.html?redirect=' + back; }, 700);
    }
    throw new Error(data.message || '未登录');
  }

  // 其他错误：code 非 0 一律当失败
  if (data.code !== 0) {
    throw new Error(data.message || '请求失败');
  }
  return data.data;
}

const api = {
  get:   (path, opts)       => request('GET', path, null, opts),
  post:  (path, body, opts) => request('POST', path, body, opts),
  put:   (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  del:   (path, opts)       => request('DELETE', path, null, opts),
};

// ---------- ④ 枚举中文映射（后端存英文码，前端显示中文） ----------
const TYPE_TEXT = { lost: '失物', found: '招领' };

const CATEGORY_TEXT = {
  card: '证件卡类',
  electronics: '电子设备',
  books: '书籍资料',
  clothing: '衣物配饰',
  daily: '生活用品',
  other: '其他',
};

const CATEGORY_EMOJI = {
  card: '💳',
  electronics: '🎧',
  books: '📚',
  clothing: '🧥',
  daily: '🧴',
  other: '📦',
};

// 状态文案：招领帖做同义适配（寻找中 ≈ 待认领）
const STATUS_TEXT = {
  lost:  { searching: '寻找中', resolved: '已找到', closed: '已结束' },
  found: { searching: '待认领', resolved: '已认领', closed: '已结束' },
};

function statusText(item) {
  const map = STATUS_TEXT[item.type] || STATUS_TEXT.lost;
  return map[item.status] || item.status;
}

// 状态机：下一个状态是什么（用于"标记为已找到/已结束"按钮）
function nextStatus(item) {
  if (item.status === 'searching') return { value: 'resolved', label: item.type === 'found' ? '标记为已认领' : '标记为已找到' };
  if (item.status === 'resolved')  return { value: 'closed',   label: '标记为已结束' };
  return null;   // 已结束，没有下一步
}

// ---------- ⑤ 小工具 ----------

// 轻提示（居中弹一下）
function toast(msg, ms = 2000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), ms);
}

// 防 XSS：用户输入的内容要转义后再插进 HTML
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 相对时间："刚刚 / 5 分钟前 / 3 小时前 / 10-05 14:30"
function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return formatDate(iso);
}

// 完整日期时间："2026-10-05 14:30"
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 转成 <input type="datetime-local"> 需要的格式："2026-10-05T14:30"
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 取 URL 问号后面的参数
function getQuery(name) {
  return new URLSearchParams(location.search).get(name) || '';
}

// 未登录就跳去登录页（带跳回地址）
function requireLogin() {
  if (!isLoggedIn()) {
    const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.href = 'login.html?redirect=' + back;
    return false;
  }
  return true;
}

// 退出登录：调接口（服务端只返回成功）+ 删本地 token
async function logout() {
  try {
    await api.post('/auth/logout', null, { silent: true });
  } catch (e) {
    // JWT 无状态，服务端本来也做不了什么，本地清掉就行
  }
  clearToken();
  toast('已退出登录');
  setTimeout(() => { location.href = 'index.html'; }, 600);
}

// ---------- 底部导航（各页面共用，自动高亮当前页） ----------
function renderNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const items = [
    {
      href: 'index.html', label: '首页',
      icon: '<path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    },
    {
      href: 'publish.html', label: '发布',
      icon: '<path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1z"/>',
    },
    {
      href: 'my.html', label: '我的',
      icon: '<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.8-3.6-5-8-5z"/>',
    },
  ];

  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.innerHTML = items.map((it) => `
    <a href="${it.href}" class="${it.href === page ? 'active' : ''}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">${it.icon}</svg>
      ${it.label}
    </a>
  `).join('');
  document.body.appendChild(nav);
}
