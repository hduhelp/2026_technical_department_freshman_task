// ============================================================
//  首页：搜索 + 筛选 + 上拉加载更多
// ============================================================

// 页面状态：所有筛选条件集中放这里，改完重新请求
const state = {
  keyword: '',
  category: '',
  type: '',
  status: 'searching',   // 默认只看"寻找中"（和后端默认一致）
  page: 1,
  pageSize: 10,
  total: 0,
  list: [],
  loading: false,
};

// ---------- 渲染筛选标签 ----------
function renderFilters() {
  // 分类（横向滚动）
  const cats = [['', '全部'], ...Object.entries(CATEGORY_TEXT)];
  document.getElementById('catRow').innerHTML = cats
    .map(([v, t]) => `<div class="chip ${state.category === v ? 'active' : ''}" data-cat="${v}">${t}</div>`)
    .join('');

  // 类型 + 状态（用一条竖线分隔两组）
  const types = [['', '全部'], ['lost', '失物'], ['found', '招领']];
  const stats = [['searching', '寻找中'], ['resolved', '已找到'], ['closed', '已结束']];
  document.getElementById('typeRow').innerHTML =
    types.map(([v, t]) => `<div class="chip ${state.type === v ? 'active' : ''}" data-type="${v}">${t}</div>`).join('') +
    '<div style="width:1px;background:var(--border);flex-shrink:0;margin:2px 3px"></div>' +
    stats.map(([v, t]) => `<div class="chip ${state.status === v ? 'active' : ''}" data-status="${v}">${t}</div>`).join('');
}

// ---------- 渲染一张卡片 ----------
function cardHtml(item) {
  const dim = item.status !== 'searching' ? ' dim' : '';
  const meta = [];
  if (item.place || item.campus) {
    meta.push('📍 ' + escapeHtml([item.campus, item.place].filter(Boolean).join(' · ')));
  }
  meta.push('🕐 ' + formatDate(item.happened_at));

  return `
    <div class="card${dim}" data-id="${item.id}">
      <div class="card-head">
        <span class="tag ${item.type}">${TYPE_TEXT[item.type] || item.type}</span>
        <span class="card-title">${escapeHtml(item.title)}</span>
        <span class="badge ${item.status}">${statusText(item)}</span>
      </div>
      <div class="card-meta">${meta.join('<span style="width:10px"></span>')}</div>
      ${item.description ? `<div class="card-desc">${escapeHtml(item.description)}</div>` : ''}
    </div>
  `;
}

// ---------- 渲染列表 ----------
function renderList(append) {
  const box = document.getElementById('list');

  if (!append) {
    box.innerHTML = '';
  }

  if (state.list.length === 0) {
    box.innerHTML = `
      <div class="empty">
        <span class="emoji">🔍</span>
        <div class="tip">还没有相关信息<br>点右下角的 + 发布第一条吧</div>
      </div>`;
    document.getElementById('loadMore').textContent = '';
    return;
  }

  box.innerHTML = state.list.map(cardHtml).join('');
  bindCardClick();

  // 底部提示
  const more = document.getElementById('loadMore');
  const loadedAll = state.list.length >= state.total;
  more.textContent = loadedAll ? `共 ${state.total} 条，已经到底啦` : '';
}

// 卡片点击 → 进详情页
function bindCardClick() {
  document.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => { location.href = 'detail.html?id=' + el.dataset.id; };
  });
}

// ---------- 拉数据 ----------
async function load(reset) {
  if (state.loading) return;
  state.loading = true;

  if (reset) {
    state.page = 1;
    state.list = [];
  }

  const params = new URLSearchParams();
  if (state.keyword) params.set('keyword', state.keyword);
  if (state.category) params.set('category', state.category);
  if (state.type) params.set('type', state.type);
  if (state.status) params.set('status', state.status);
  params.set('page', state.page);
  params.set('page_size', state.pageSize);

  const box = document.getElementById('list');
  if (reset) box.innerHTML = '<div class="loading">加载中…</div>';

  try {
    const data = await api.get('/items?' + params.toString());
    state.total = data.total;
    state.list = reset ? data.list : state.list.concat(data.list);
    renderList(false);
  } catch (err) {
    box.innerHTML = `<div class="empty"><span class="emoji">😵</span><div class="tip">${escapeHtml(err.message)}</div></div>`;
  } finally {
    state.loading = false;
  }
}

// ---------- 上拉加载更多 ----------
function onScroll() {
  if (state.loading) return;
  if (state.list.length >= state.total) return;   // 已经到底
  const nearBottom = window.innerHeight + window.scrollY > document.body.offsetHeight - 300;
  if (nearBottom) {
    state.page += 1;
    load(false);
  }
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 分类点击
  document.getElementById('catRow').onclick = (e) => {
    const el = e.target.closest('[data-cat]');
    if (!el) return;
    state.category = el.dataset.cat;
    renderFilters();
    load(true);
  };

  // 类型 / 状态点击
  document.getElementById('typeRow').onclick = (e) => {
    const t = e.target.closest('[data-type]');
    const s = e.target.closest('[data-status]');
    if (t) state.type = t.dataset.type;
    if (s) state.status = s.dataset.status;
    if (t || s) { renderFilters(); load(true); }
  };

  // 搜索：输入停顿 400ms 后自动搜（防抖）
  let timer = null;
  const input = document.getElementById('keyword');
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.keyword = input.value.trim();
      load(true);
    }, 400);
  };
  // 回车立即搜
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      state.keyword = input.value.trim();
      load(true);
    }
  };

  // 悬浮按钮：发布
  document.getElementById('fab').onclick = () => { location.href = 'publish.html'; };

  window.onscroll = onScroll;
}

// ---------- 启动 ----------
renderFilters();
bindEvents();
renderNav();
load(true);
