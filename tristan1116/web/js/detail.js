// ============================================================
//  详情页：展示信息 + 查看联系方式 + 发布者本人的管理操作
// ============================================================

const itemId = getQuery('id');
let item = null;     // 当前帖子
let me = null;       // 当前登录用户（没登录就是 null）
let isOwner = false; // 这条帖子是不是我发的

// ---------- 渲染页面 ----------
function render() {
  const it = item;

  // 信息行
  const rows = [
    ['类型', TYPE_TEXT[it.type] || it.type],
    ['分类', CATEGORY_TEXT[it.category] || it.category],
    ['校区', it.campus || '—'],
    ['地点', it.place || '—'],
    [it.type === 'found' ? '捡到时间' : '丢失时间', formatDate(it.happened_at)],
  ];

  document.getElementById('content').innerHTML = `
    <div class="detail">
      <h2>${escapeHtml(it.title)}</h2>
      <div class="badges">
        <span class="tag ${it.type}">${TYPE_TEXT[it.type] || it.type}</span>
        <span class="badge ${it.status}">${statusText(it)}</span>
      </div>

      <div class="info-card">
        ${rows.map(([k, v]) => `<div class="info-row"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`).join('')}
      </div>

      ${it.description ? `
      <div class="info-card">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:8px">详细描述</div>
        <div class="detail-desc">${escapeHtml(it.description)}</div>
      </div>` : ''}

      <div class="info-card">
        <div class="info-row"><span class="k">发布者</span><span class="v">${escapeHtml(it.publisher_nickname || '匿名')}</span></div>
        ${it.publisher_student_id ? `<div class="info-row"><span class="k">学号</span><span class="v">${escapeHtml(it.publisher_student_id)}</span></div>` : ''}
        <div class="info-row"><span class="k">发布时间</span><span class="v">${timeAgo(it.created_at)}</span></div>
      </div>
    </div>
  `;

  renderActions();
}

// ---------- 渲染底部操作区 ----------
function renderActions() {
  const box = document.getElementById('actions');
  box.style.display = 'flex';

  if (!isOwner) {
    // 不是本人：只给一个"查看联系方式"
    box.innerHTML = `<button class="btn btn-primary" id="btnContact">查看联系方式</button>`;
    document.getElementById('btnContact').onclick = showContact;
    return;
  }

  // 本人：改状态 / 编辑 / 删除
  const next = nextStatus(item);
  const parts = [];
  if (next) parts.push(`<button class="btn btn-primary" id="btnNext">${next.label}</button>`);
  parts.push(`<button class="btn btn-outline" id="btnEdit">编辑</button>`);
  parts.push(`<button class="btn btn-danger" id="btnDel">删除</button>`);
  box.innerHTML = parts.join('');

  if (next) document.getElementById('btnNext').onclick = () => changeStatus(next.value);
  document.getElementById('btnEdit').onclick = () => { location.href = 'publish.html?id=' + item.id; };
  document.getElementById('btnDel').onclick = del;
}

// ---------- 查看联系方式（演示重点） ----------
async function showContact() {
  // 未登录：引导去登录，登录后跳回本页
  if (!isLoggedIn()) {
    toast('请先登录后查看');
    setTimeout(() => {
      location.href = 'login.html?redirect=' + encodeURIComponent('detail.html?id=' + itemId);
    }, 700);
    return;
  }

  try {
    const data = await api.get(`/items/${itemId}/contact`);
    showContactModal(data.contact);
  } catch (err) {
    toast(err.message);
  }
}

function showContactModal(contact) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>联系方式</h3>
      <div class="modal-sub">请文明联系，说明来意～</div>
      <div class="contact-value">${escapeHtml(contact)}</div>
      <button class="btn btn-primary" id="modalClose">知道了</button>
    </div>
  `;
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
  document.getElementById('modalClose').onclick = () => mask.remove();
}

// ---------- 改状态 ----------
async function changeStatus(status) {
  try {
    await api.patch(`/items/${itemId}/status`, { status });
    toast('状态已更新');
    await loadDetail();   // 重新拉一次，界面同步刷新
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 删除（二次确认） ----------
async function del() {
  if (!confirm('确定要删除这条信息吗？删除后无法恢复。')) return;
  try {
    await api.del(`/items/${itemId}`);
    toast('删除成功');
    setTimeout(() => { location.href = 'index.html'; }, 700);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 加载详情 ----------
async function loadDetail() {
  try {
    item = await api.get('/items/' + itemId);

    // 已登录的话顺便查一下"我是谁"，用来判断是不是本人
    if (isLoggedIn()) {
      try {
        me = await api.get('/auth/me', { silent: true });
      } catch (e) { /* token 失效，当没登录处理 */ }
    }
    isOwner = !!(me && item.user_id === me.id);

    render();
  } catch (err) {
    document.getElementById('content').innerHTML = `
      <div class="empty">
        <span class="emoji">😵</span>
        <div class="tip">${escapeHtml(err.message)}</div>
      </div>`;
  }
}

// ---------- 启动 ----------
if (!itemId) {
  document.getElementById('content').innerHTML =
    '<div class="empty"><span class="emoji">🤔</span><div class="tip">缺少 id 参数</div></div>';
} else {
  loadDetail();
}
