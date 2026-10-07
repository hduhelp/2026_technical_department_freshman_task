const API = '/api';

let token = localStorage.getItem('token') || '';
let me = null;
let editingId = null;
let currentItems = [];
let currentFilter = { category: '', status: '', keyword: '' };
let authMode = 'login';

const $ = (sel) => document.querySelector(sel);

const CATEGORY_LABEL = { lost: '寻物启事', found: '招领启事' };
const STATUS_LABEL = { unclaimed: '未领取', claimed: '已领取' };

// 转义 HTML，防止 XSS
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('请求失败 (' + res.status + ')'));
  return data;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 2600);
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return String(s).slice(0, 10);
  return d.toLocaleDateString('zh-CN');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- 渲染 ----------

function renderAuth() {
  const area = $('#auth-area');
  if (me) {
    area.innerHTML = `
      <span class="hello">👋 你好，${esc(me.username)}</span>
      <button class="btn" id="btn-logout">退出登录</button>`;
    $('#btn-logout').onclick = logout;
  } else {
    area.innerHTML = `<button class="btn" id="btn-show-auth">登录 / 注册</button>`;
    $('#btn-show-auth').onclick = () => $('#auth-panel').classList.toggle('hidden');
  }
  renderCreate();
}

function renderCreate() {
  const panel = $('#create-panel');
  if (me) {
    panel.classList.remove('hidden');
    $('#create-title').textContent = editingId ? '编辑遗失物' : '发布遗失物';
    $('#btn-cancel-edit').style.display = editingId ? 'inline-block' : 'none';
  } else {
    panel.classList.add('hidden');
  }
}

function contactLines(c) {
  const lines = [];
  if (c.name) lines.push(`<strong>${esc(c.name)}</strong>`);
  if (c.phone) lines.push(`<a href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>`);
  if (c.wechat) lines.push(`💬 微信：${esc(c.wechat)}`);
  if (c.email) lines.push(`<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>`);
  if (c.message) lines.push(`📝 ${esc(c.message)}`);
  return lines;
}

function itemCard(it) {
  const isOwner = me && me.id === it.publisher_id;
  const cat = CATEGORY_LABEL[it.category] || it.category;
  const st = STATUS_LABEL[it.status] || it.status;
  const claimed = it.status === 'claimed';

  const actions = isOwner ? `
    <div class="item-actions">
      <button class="btn small" data-act="edit" data-id="${it.id}">编辑</button>
      <button class="btn small ${claimed ? 'success' : ''}" data-act="status" data-id="${it.id}">
        ${claimed ? '标记为未领取' : '标记为已领取'}
      </button>
      <button class="btn small danger" data-act="delete" data-id="${it.id}">删除</button>
    </div>` : '';

  return `
    <article class="item card ${claimed ? 'claimed' : ''}" data-id="${it.id}">
      <div class="item-head">
        <span class="badge ${it.category}">${esc(cat)}</span>
        <span class="badge ${claimed ? 'claimed' : 'unclaimed'}">${esc(st)}</span>
        <h3>${esc(it.title)}</h3>
      </div>
      ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
      <div class="meta">
        <span>📍 ${esc(it.location || '未知地点')}</span>
        <span>🗓️ ${esc(fmtDate(it.lost_at))}</span>
        <span>👤 发布者：${esc(it.publisher_name)}</span>
      </div>
      <div class="contact">
        <div class="contact-title">📞 联系方式</div>
        ${contactLines(it.contact).map((l) => `<div>${l}</div>`).join('')}
      </div>
      ${actions}
    </article>`;
}

async function loadItems() {
  const params = new URLSearchParams();
  for (const k in currentFilter) if (currentFilter[k]) params.set(k, currentFilter[k]);
  try {
    const data = await api('/items?' + params.toString());
    currentItems = data.items;
    const list = $('#item-list');
    if (!data.items.length) {
      list.innerHTML = '<p class="empty">暂无遗失物信息，登录后点击「发布遗失物」发布第一条吧～</p>';
      return;
    }
    list.innerHTML = data.items.map(itemCard).join('');
  } catch (e) {
    currentItems = [];
    $('#item-list').innerHTML = '';
    toast(e.message, true);
  }
}

// ---------- 认证 ----------

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === mode));
  $('#btn-auth-submit').textContent = mode === 'login' ? '登录' : '注册';
}

async function doAuth() {
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (!username || !password) { toast('请输入用户名和密码', true); return; }
  try {
    const data = await api('/auth/' + authMode, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    localStorage.setItem('token', token);
    me = data.user;
    $('#auth-panel').classList.add('hidden');
    renderAuth();
    loadItems();
    toast(authMode === 'login' ? '登录成功' : '注册成功');
  } catch (e) {
    toast(e.message, true);
  }
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
  token = '';
  localStorage.removeItem('token');
  me = null;
  cancelEdit();
  renderAuth();
  loadItems();
  toast('已退出登录');
}

// ---------- 发布 / 编辑 ----------

function readForm() {
  return {
    title: $('#f-title').value,
    description: $('#f-desc').value,
    category: document.querySelector('input[name="category"]:checked')?.value,
    location: $('#f-location').value,
    lost_at: $('#f-lost_at').value || undefined,
    contact: {
      name: $('#f-name').value,
      phone: $('#f-phone').value,
      wechat: $('#f-wechat').value,
      email: $('#f-email').value,
      message: $('#f-message').value,
    },
  };
}

async function submitItem(e) {
  e.preventDefault();
  const body = readForm();
  try {
    if (editingId) {
      await api('/items/' + editingId, { method: 'PUT', body: JSON.stringify(body) });
      toast('修改成功');
    } else {
      await api('/items', { method: 'POST', body: JSON.stringify(body) });
      toast('发布成功');
    }
    cancelEdit();
    loadItems();
  } catch (err) {
    toast(err.message, true);
  }
}

function startEdit(it) {
  editingId = it.id;
  $('#f-title').value = it.title;
  $('#f-desc').value = it.description;
  document.querySelector(`input[name="category"][value="${it.category}"]`).checked = true;
  $('#f-location').value = it.location;
  $('#f-lost_at').value = (it.lost_at || '').slice(0, 10);
  $('#f-name').value = it.contact.name;
  $('#f-phone').value = it.contact.phone;
  $('#f-wechat').value = it.contact.wechat;
  $('#f-email').value = it.contact.email;
  $('#f-message').value = it.contact.message;
  renderCreate();
  $('#create-panel').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;
  $('#item-form').reset();
  renderCreate();
}

// ---------- 事件绑定 ----------

function bindEvents() {
  // 登录 / 注册标签
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => setAuthMode(t.dataset.tab));
  });
  $('#btn-auth-submit').addEventListener('click', doAuth);
  $('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

  // 发布表单
  $('#item-form').addEventListener('submit', submitItem);
  $('#btn-cancel-edit').addEventListener('click', cancelEdit);

  // 列表操作（事件委托）
  $('#item-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const it = currentItems.find((x) => x.id === id);

    try {
      if (act === 'edit') {
        startEdit(it);
      } else if (act === 'delete') {
        if (!confirm('确定删除该遗失物吗？')) return;
        await api('/items/' + id, { method: 'DELETE' });
        toast('已删除');
        loadItems();
      } else if (act === 'status') {
        const next = it.status === 'claimed' ? 'unclaimed' : 'claimed';
        await api('/items/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status: next }) });
        toast('状态已更新');
        loadItems();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 筛选
  $('#filter-category').addEventListener('change', (e) => { currentFilter.category = e.target.value; loadItems(); });
  $('#filter-status').addEventListener('change', (e) => { currentFilter.status = e.target.value; loadItems(); });
  $('#filter-keyword').addEventListener('input', debounce((e) => {
    currentFilter.keyword = e.target.value.trim();
    loadItems();
  }, 300));
}

// ---------- 初始化 ----------

async function init() {
  bindEvents();
  setAuthMode('login');
  if (token) {
    try {
      me = await api('/auth/me');
    } catch (e) {
      token = '';
      localStorage.removeItem('token');
      me = null;
    }
  }
  renderAuth();
  loadItems();
}

init();
