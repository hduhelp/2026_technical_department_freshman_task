// ============================================================
//  我的：个人信息 + 我的发布（含状态管理）+ 退出登录
// ============================================================

let me = null;
let items = [];

// ---------- 渲染整页 ----------
function render() {
  const initial = (me.nickname || me.username || '?').slice(0, 1).toUpperCase();

  document.getElementById('content').innerHTML = `
    <div class="profile">
      <div class="avatar">${escapeHtml(initial)}</div>
      <div>
        <div class="name">${escapeHtml(me.nickname || me.username)}</div>
        <div class="sub">@${escapeHtml(me.username)}${me.student_id ? ' · 学号 ' + escapeHtml(me.student_id) : ''}</div>
      </div>
    </div>

    <div class="section-title">
      <span>我的发布</span>
      <span id="count"></span>
    </div>

    <div class="list" id="myList"></div>
  `;

  renderItems();
}

// ---------- 渲染我的发布列表 ----------
function renderItems() {
  const box = document.getElementById('myList');
  document.getElementById('count').textContent = items.length ? `共 ${items.length} 条` : '';

  if (items.length === 0) {
    box.innerHTML = `
      <div class="empty">
        <span class="emoji">📭</span>
        <div class="tip">你还没有发布过信息<br>去首页点右下角的 + 试试吧</div>
      </div>`;
    return;
  }

  box.innerHTML = items.map((it) => {
    const next = nextStatus(it);
    return `
      <div class="card${it.status !== 'searching' ? ' dim' : ''}">
        <div class="card-head" data-goto="${it.id}">
          <span class="tag ${it.type}">${TYPE_TEXT[it.type] || it.type}</span>
          <span class="card-title">${escapeHtml(it.title)}</span>
          <span class="badge ${it.status}">${statusText(it)}</span>
        </div>
        <div class="card-meta" data-goto="${it.id}">
          <span>🕐 ${formatDate(it.happened_at)}</span>
        </div>
        <div class="card-actions">
          ${next ? `<button class="btn btn-outline btn-sm" data-next="${it.id}" data-status="${next.value}">${next.label}</button>` : ''}
          <button class="btn btn-outline btn-sm" data-edit="${it.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-del="${it.id}">删除</button>
        </div>
      </div>
    `;
  }).join('');

  bindActions();
}

function bindActions() {
  const box = document.getElementById('myList');

  box.onclick = async (e) => {
    // 点卡片主体 → 进详情
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      location.href = 'detail.html?id=' + goto.dataset.goto;
      return;
    }

    // 改状态
    const next = e.target.closest('[data-next]');
    if (next) {
      try {
        await api.patch(`/items/${next.dataset.next}/status`, { status: next.dataset.status });
        toast('状态已更新');
        await loadItems();
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    // 编辑
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      location.href = 'publish.html?id=' + edit.dataset.edit;
      return;
    }

    // 删除（二次确认）
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('确定要删除这条信息吗？删除后无法恢复。')) return;
      try {
        await api.del('/items/' + del.dataset.del);
        toast('删除成功');
        await loadItems();
      } catch (err) {
        toast(err.message);
      }
    }
  };
}

// ---------- 拉数据 ----------
async function loadItems() {
  const data = await api.get('/items/my?page_size=50');
  items = data.list;
  renderItems();
}

async function init() {
  try {
    me = await api.get('/auth/me');
    document.getElementById('logoutBtn').style.display = 'block';
    document.getElementById('logoutBtn').onclick = () => {
      if (confirm('确定要退出登录吗？')) logout();
    };
    render();
    await loadItems();
  } catch (err) {
    // 没登录（api.js 会自动跳登录页），这里给个兜底提示
    document.getElementById('content').innerHTML = `
      <div class="empty">
        <span class="emoji">🔒</span>
        <div class="tip">请先登录</div>
      </div>`;
  }
}

init();
renderNav();
