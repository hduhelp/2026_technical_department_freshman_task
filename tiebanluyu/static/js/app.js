/* ==========================================================================
   app.js —— 前端主逻辑
   --------------------------------------------------------------------------
   结构说明（从上到下）：
     1. 全局状态
     2. 路由（基于 URL hash，天然支持浏览器前进后退和链接分享）
     3. 公共渲染部件（页头、卡片）
     4. 各个页面视图
     5. 事件绑定与启动

   为什么用 hash 路由而不是 History API？
     History API 需要后端配合把所有未知路径都回退到 index.html，
     否则用户刷新 /item/3 会 404。hash 路由没有这个问题，
     对一个小项目来说更省事，而且筛选条件放在 hash 里还能直接分享链接。
   ========================================================================== */

const App = (() => {
  /* ======================================================================
     1. 全局状态
     ====================================================================== */

  const state = {
    /** 当前登录用户，null 表示未登录 */
    user: null,
    /** 图片上传的临时结果，键是输入框的 id，值是服务端返回的 url */
    uploadedImages: {},
    /** 当前列表的查询参数，翻页时复用 */
    lastQuery: {},
  };

  const appEl = document.getElementById('app');

  /* ======================================================================
     2. 路由
     ====================================================================== */

  /** 解析 location.hash，返回 { path, query } */
  function parseHash() {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [path, queryString] = raw.split('?');
    const query = {};
    if (queryString) {
      new URLSearchParams(queryString).forEach((value, key) => {
        query[key] = value;
      });
    }
    return { path: path || '/', query };
  }

  /** 跳转到指定路由 */
  function go(path) {
    window.location.hash = path;
  }

  /* ======================================================================
     3. 公共渲染部件
     ====================================================================== */

  /** 渲染页头右侧（登录状态区域） */
  function renderHeader() {
    const actions = document.getElementById('headerActions');
    const { path } = parseHash();

    // 只有"我的发布"这一个导航项需要高亮。
    // 【历史说明】原来这里还有「全部 / 寻物启事 / 招领启事」三个导航项，
    // 它们的 URL 只有查询参数不同（#/ 与 #/?type=lost），路径部分都是 "/"，
    // 所以高亮判断永远落在"全部信息"上，点了不会跟着跳。
    // 根因是同一个筛选状态被做成了两套控件，必然有一方失真 ——
    // 现在筛选只保留页面里的 chip 行一套，导航区不再重复。
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.nav === 'mine' && path === '/mine');
    });

    // 把登录状态同步到 body 上，供 CSS 使用
    // （移动端要靠它决定是否显示汉堡按钮，见 layout.css 的说明）
    document.body.classList.toggle('is-logged-in', Boolean(state.user));

    // "我的发布"只在登录后显示
    const mineNav = document.querySelector('[data-nav="mine"]');
    if (mineNav) mineNav.hidden = !state.user;

    if (state.user) {
      actions.innerHTML = `
        <a class="user-chip" href="#/mine" title="查看我的发布">
          <span class="avatar">${UI.escapeHtml(UI.avatarText(state.user.display_name))}</span>
          <span class="user-chip-name">${UI.escapeHtml(state.user.display_name)}</span>
        </a>
        <button class="btn btn-ghost btn-sm" id="btnLogout">退出</button>
      `;
      document.getElementById('btnLogout').addEventListener('click', handleLogout);
    } else {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm" id="btnLogin">登录</button>
        <button class="btn btn-primary btn-sm" id="btnRegister">注册</button>
      `;
      document.getElementById('btnLogin').addEventListener('click', () => go('/login'));
      document.getElementById('btnRegister').addEventListener('click', () => go('/register'));
    }
  }

  /** 渲染一个信息卡片（列表用） */
  function renderItemCard(item) {
    const cover = item.cover_image
      ? `<img class="item-card-cover" src="${UI.escapeAttr(item.cover_image)}" alt="${UI.escapeAttr(
          item.title
        )}" loading="lazy">`
      : `<div class="item-card-placeholder">${UI.TYPE_EMOJI[item.type] || '📦'}</div>`;

    const isDone = item.status !== 'searching';

    // 保管地点对失主很关键（"去哪认领"），所以在列表上就显示出来。
    // 但发布人自己保管时这个信息没有额外价值，就不显示，避免卡片太挤。
    const holderLine =
      !item.holder_is_reporter && item.holder_place
        ? `<span title="认领地点">🧭 ${UI.escapeHtml(item.holder_place)}</span>`
        : '';

    return `
      <a class="item-card ${isDone ? 'is-done' : ''}" href="#/item/${item.id}">
        ${cover}
        <div class="card-badges">
          ${UI.typeBadge(item.type, item.type_label)}
          ${UI.statusBadge(item.status, item.status_label)}
        </div>
        ${item.is_mine ? '<span class="badge badge-mine">我的</span>' : ''}
        <div class="item-card-body">
          <h3 class="item-card-title">${UI.escapeHtml(item.title)}</h3>
          <p class="item-card-desc">${UI.escapeHtml(item.description || '暂无描述')}</p>
          <div class="item-card-meta">
            <span>📍 ${UI.escapeHtml(item.location || '地点未填')}</span>
            ${holderLine}
            <span>🕒 ${UI.escapeHtml(UI.formatRelative(item.created_at))}</span>
            <span>👁 ${item.view_count}</span>
          </div>
        </div>
      </a>
    `;
  }

  /** 渲染加载中骨架屏 */
  function renderSkeletons(count = 6) {
    return `<div class="grid grid-cards">${'<div class="skeleton-card"></div>'.repeat(count)}</div>`;
  }

  /** 渲染空状态 */
  function renderEmpty({ icon = '🗂', title, text, actionHtml = '' }) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">${UI.escapeHtml(title)}</div>
        <p class="empty-text">${UI.escapeHtml(text)}</p>
        ${actionHtml}
      </div>
    `;
  }

  /** 渲染分页控件 */
  function renderPagination(meta) {
    if (meta.total_pages <= 1) return '';

    const { page, total_pages } = meta;
    const buttons = [];

    // 页码按钮：始终显示首页、末页、当前页附近，其余用省略号折叠。
    // 这样即使有 100 页，控件也不会长到撑破布局。
    const pages = new Set([1, total_pages]);
    for (let p = page - 1; p <= page + 1; p++) {
      if (p >= 1 && p <= total_pages) pages.add(p);
    }
    const sorted = [...pages].sort((a, b) => a - b);

    buttons.push(
      `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`
    );

    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) buttons.push('<span class="page-ellipsis">…</span>');
      buttons.push(
        `<button class="page-btn ${p === page ? 'is-active' : ''}" data-page="${p}">${p}</button>`
      );
      prev = p;
    }

    buttons.push(
      `<button class="page-btn" data-page="${page + 1}" ${
        page >= total_pages ? 'disabled' : ''
      }>下一页</button>`
    );

    return `<nav class="pagination">${buttons.join('')}</nav>`;
  }

  /* ======================================================================
     4. 页面：列表
     ====================================================================== */

  async function viewHome(query) {
    const typeFilter = query.type || '';
    const statusFilter = query.status || '';
    const sort = query.sort || 'newest';
    const q = query.q || '';
    const location = query.location || '';
    const page = Number(query.page || 1);

    const typeTitle =
      typeFilter === 'lost' ? '寻物启事' : typeFilter === 'found' ? '招领启事' : '全部信息';
    const typeDesc =
      typeFilter === 'lost'
        ? '同学们丢失的东西，如果你捡到了请帮忙联系'
        : typeFilter === 'found'
          ? '同学们捡到的东西，看看有没有你丢的'
          : '汇聚校园里的失物与招领信息，找到东西后记得把状态改成「已找到」';

    // 先渲染搜索栏结构，再异步填充列表，这样用户能立刻开始输入
    appEl.innerHTML = `
      <div class="page-head">
        <h1 class="page-title">${UI.escapeHtml(typeTitle)}</h1>
        <p class="page-desc">${UI.escapeHtml(typeDesc)}</p>
      </div>

      <div class="filter-bar">
        <div class="search-box">
          <span class="search-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
            </svg>
          </span>
          <input class="form-input" id="searchInput" type="search" placeholder="搜索物品名、描述关键词…"
                 value="${UI.escapeAttr(q)}" autocomplete="off">
        </div>

        <div class="filter-item">
          <label class="form-label" for="statusSelect">状态</label>
          <select class="form-select" id="statusSelect">
            <option value="">全部状态</option>
            <option value="searching" ${statusFilter === 'searching' ? 'selected' : ''}>寻找中</option>
            <option value="found" ${statusFilter === 'found' ? 'selected' : ''}>已找到</option>
            <option value="closed" ${statusFilter === 'closed' ? 'selected' : ''}>已结束</option>
          </select>
        </div>

        <div class="filter-item">
          <label class="form-label" for="sortSelect">排序</label>
          <select class="form-select" id="sortSelect">
            <option value="newest" ${sort === 'newest' ? 'selected' : ''}>最新发布</option>
            <option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>最早发布</option>
            <option value="event_desc" ${sort === 'event_desc' ? 'selected' : ''}>事件时间从新到旧</option>
            <option value="event_asc" ${sort === 'event_asc' ? 'selected' : ''}>事件时间从旧到新</option>
            <option value="popular" ${sort === 'popular' ? 'selected' : ''}>最多浏览</option>
          </select>
        </div>

        <div class="filter-item">
          <label class="form-label" for="locationInput">地点</label>
          <input class="form-input" id="locationInput" type="search" placeholder="如图书馆"
                 value="${UI.escapeAttr(location)}" autocomplete="off" style="min-width:130px">
        </div>
      </div>

      <div class="chip-row">
        <a class="chip ${!typeFilter ? 'is-active' : ''}" href="#/">全部</a>
        <a class="chip ${typeFilter === 'lost' ? 'is-active' : ''}" href="#/?type=lost">🔍 寻物启事</a>
        <a class="chip ${typeFilter === 'found' ? 'is-active' : ''}" href="#/?type=found">📍 招领启事</a>
        <a class="chip ${statusFilter === 'searching' ? 'is-active' : ''}" href="#/?status=searching">寻找中</a>
      </div>

      <div id="listArea">${renderSkeletons()}</div>
    `;

    bindListControls();

    // 组装查询参数
    const params = {
      q: q || undefined,
      type: typeFilter || undefined,
      status: statusFilter || undefined,
      location: location || undefined,
      sort,
      page,
      page_size: 9,
    };
    state.lastQuery = { type: typeFilter, status: statusFilter, sort, q, location };

    try {
      const data = await API.items.list(params);
      const area = document.getElementById('listArea');
      if (!area) return; // 用户已经切到别的页面了

      if (!data.items.length) {
        area.innerHTML = renderEmpty({
          icon: '🔍',
          title: '没有找到符合条件的信息',
          text: q || location || typeFilter ? '试试换个关键词，或者清空筛选条件' : '现在还没有人发布信息，你可以成为第一个',
          actionHtml: '<a class="btn btn-primary" href="#/create">发布一条信息</a>',
        });
        return;
      }

      area.innerHTML = `
        <div class="result-line">
          <span>共找到 <strong>${data.total}</strong> 条信息 · 第 ${data.page} / ${data.total_pages} 页</span>
          <span>每页 ${data.page_size} 条</span>
        </div>
        <div class="grid grid-cards">${data.items.map(renderItemCard).join('')}</div>
        ${renderPagination(data)}
      `;

      // 分页点击：改 URL 里的 page，触发重新渲染
      area.querySelectorAll('.page-btn[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = Number(btn.dataset.page);
          if (!target || btn.disabled) return;
          updateQuery({ page: target });
        });
      });
    } catch (err) {
      const area = document.getElementById('listArea');
      if (area) {
        area.innerHTML = renderEmpty({
          icon: '⚠️',
          title: '加载失败',
          text: err.message || '请稍后重试',
          actionHtml: '<button class="btn btn-ghost" onclick="location.reload()">重新加载</button>',
        });
      }
      UI.toast('加载列表失败', 'error', err.message);
    }
  }

  /** 更新当前 URL 的查询参数（保留其它参数） */
  function updateQuery(patch, { resetPage = true } = {}) {
    const { path, query } = parseHash();
    const next = { ...query, ...patch };

    // 筛选条件变了应该回到第 1 页，否则会出现"搜出来只有 1 页但停在第 5 页"的空白
    if (resetPage && !('page' in patch)) delete next.page;

    // 清掉空值，保持 URL 干净
    Object.keys(next).forEach((k) => {
      if (next[k] === '' || next[k] === undefined || next[k] === null) delete next[k];
    });

    const qs = new URLSearchParams(next).toString();
    go(`${path}${qs ? `?${qs}` : ''}`);
  }

  /** 绑定筛选控件的交互 */
  function bindListControls() {
    const searchInput = document.getElementById('searchInput');
    const locationInput = document.getElementById('locationInput');
    const statusSelect = document.getElementById('statusSelect');
    const sortSelect = document.getElementById('sortSelect');

    // 搜索用防抖，避免每敲一个字就发一次请求
    const onSearch = UI.debounce(() => updateQuery({ q: searchInput.value.trim() }), 400);
    searchInput.addEventListener('input', onSearch);

    const onLocation = UI.debounce(() => updateQuery({ location: locationInput.value.trim() }), 400);
    locationInput.addEventListener('input', onLocation);

    statusSelect.addEventListener('change', () => updateQuery({ status: statusSelect.value }));
    sortSelect.addEventListener('change', () => updateQuery({ sort: sortSelect.value }));
  }

  /* ======================================================================
     5. 页面：详情
     ====================================================================== */

  async function viewDetail(itemId) {
    appEl.innerHTML = `<div class="loading-block"><div class="spinner"></div><p>正在加载详情…</p></div>`;

    let item;
    try {
      item = await API.items.detail(itemId);
    } catch (err) {
      appEl.innerHTML = renderEmpty({
        icon: '🔍',
        title: err.code === 'item_not_found' ? '这条信息不存在' : '加载失败',
        text: err.message,
        actionHtml: '<a class="btn btn-primary" href="#/">返回列表</a>',
      });
      return;
    }

    const imagesHtml = item.images.length
      ? `<div class="detail-images">${item.images
          .map(
            (url) =>
              `<img src="${UI.escapeAttr(url)}" alt="物品图片" loading="lazy" data-lightbox="${UI.escapeAttr(
                url
              )}">`
          )
          .join('')}</div>`
      : '';

    // 联系方式：优先用这条信息自己填的，没有就用账号里的
    const contact = item.contact || item.owner_contact || '';

    // ---------- 保管者信息（只对招领启事有意义）----------
    // 【为什么寻物启事不显示这些】
    // 「拾取者」和「保管者」是招领启事才有的角色 —— 东西被捡到了，
    // 才存在"谁捡的""现在在谁手里"。
    // 而寻物启事是失主在说自己丢了什么，那时候东西还在别人手上（或者根本找不到），
    // 谈"保管者"没有意义。之前这里无条件渲染，导致寻物启事也显示
    // "认领地点：行政楼 102"，语义完全错乱。
    const isFoundItem = item.type === 'found';
    const holderIsSelf = item.holder_is_reporter;

    // 保管者的展示名：优先用文字称呼，其次用关联账号的昵称
    const holderDisplayName = item.holder_name || (item.holder_username ? '（见用户名）' : '');

    // 保管者联系：如果保管者也是平台用户，用他的账号联系方式；
    // 否则回退到发布者的联系方式（可能是发布者代为转达）
    const holderContact = item.holder_contact || (holderIsSelf ? '' : contact);

    // 保管者那一行（只对招领启事显示，且发布人自己保管时不显示）
    let holderRow = '';
    if (isFoundItem && !holderIsSelf) {
      const holderLine =
        [holderDisplayName, item.holder_username ? `@${item.holder_username}` : '']
          .filter(Boolean)
          .join(' ') || '未填写';
      holderRow = `
        <div class="info-row">
          <span class="info-label">保管者</span>
          <span class="info-value">
            ${UI.escapeHtml(holderLine)}
            ${item.is_holder ? '<span class="badge badge-success" style="margin-left:6px">就是你</span>' : ''}
          </span>
        </div>
        ${
          item.holder_place
            ? `<div class="info-row">
                 <span class="info-label">认领地点</span>
                 <span class="info-value" style="color:var(--color-primary);font-weight:650">
                   ${UI.escapeHtml(item.holder_place)}
                 </span>
               </div>`
            : ''
        }
      `;
    }

    // 拾取者那一行（同样只对招领启事显示；留空就不显示，避免一堆"未填写"）
    const finderRow =
      isFoundItem && item.finder_name
        ? `<div class="info-row">
             <span class="info-label">拾取者</span>
             <span class="info-value">${UI.escapeHtml(item.finder_name)}</span>
           </div>`
        : '';

    appEl.innerHTML = `
      <div class="detail-layout">
        <div>
          <a class="btn btn-ghost btn-sm" href="#/">← 返回列表</a>

          <article class="card panel" style="margin-top:var(--space-4)">
            <div class="detail-head">
              <div class="detail-badges">
                ${UI.typeBadge(item.type, item.type_label)}
                ${UI.statusBadge(item.status, item.status_label)}
                ${item.is_holder && !item.is_owner ? '<span class="badge badge-success" style="position:static">我保管的</span>' : ''}
                ${item.is_owner ? '<span class="badge badge-mine" style="position:static">我发布的</span>' : ''}
              </div>
              <h1 class="detail-title">${UI.escapeHtml(item.title)}</h1>
            </div>

            ${imagesHtml}

            <div class="detail-description">${UI.escapeHtml(item.description || '发布者没有填写详细描述')}</div>

            <div class="info-list">
              <div class="info-row">
                <span class="info-label">${item.type === 'lost' ? '丢失地点' : '发现地点'}</span>
                <span class="info-value">${UI.escapeHtml(item.location || '未填写')}</span>
              </div>
              ${finderRow}
              ${holderRow}
              <div class="info-row">
                <span class="info-label">${item.type === 'lost' ? '丢失时间' : '发现时间'}</span>
                <span class="info-value">${UI.escapeHtml(
                  item.event_time ? UI.formatDateTime(item.event_time) : '未填写'
                )}</span>
              </div>
              <div class="info-row">
                <span class="info-label">发布时间</span>
                <span class="info-value">${UI.escapeHtml(UI.formatDateTime(item.created_at))}（${UI.escapeHtml(
                  UI.formatRelative(item.created_at)
                )}）</span>
              </div>
              <div class="info-row">
                <span class="info-label">浏览量</span>
                <span class="info-value">${item.view_count} 次</span>
              </div>
            </div>
          </article>

          <div id="matchArea"></div>
        </div>

        <aside class="detail-side">
          <div class="card panel side-card">
            <div class="side-card-title">发布者</div>
            <div class="owner-box">
              <span class="avatar">${UI.escapeHtml(
                UI.avatarText(item.owner ? item.owner.display_name : '?')
              )}</span>
              <div>
                <div class="owner-name">${UI.escapeHtml(
                  item.owner ? item.owner.display_name : '未知用户'
                )}</div>
                <div class="owner-sub">${UI.escapeHtml(item.type_label)}</div>
              </div>
            </div>
            ${
              // 只有招领启事才需要区分"发布者"和"保管者"。
              // 寻物启事没有保管者这个概念，直接把发布者联系方式给出来就行。
              !isFoundItem || holderIsSelf
                ? // 寻物启事，或者发布人就是保管者：不用重复列两个人
                  `<div class="contact-box">
                     <strong>联系方式</strong>
                     <span class="contact-value">${UI.escapeHtml(contact || '未留联系方式')}</span>
                   </div>`
                : // 招领启事且发布人与保管者不是同一人：把两人分开展示，避免混淆
                  `<div class="contact-box" style="background:var(--color-surface-soft);border-color:var(--color-border)">
                     <strong>发布者联系方式（代为转达）</strong>
                     <span class="contact-value" style="color:var(--color-text-soft);font-weight:500">
                       ${UI.escapeHtml(contact || '未留联系方式')}
                     </span>
                   </div>
                   <div class="contact-box">
                     <strong>保管者：${UI.escapeHtml(holderDisplayName || '未填写')}${
                       item.holder_username ? ` (@${UI.escapeHtml(item.holder_username)})` : ''
                     }</strong>
                     <span class="contact-value">${UI.escapeHtml(holderContact || '未留联系方式')}</span>
                     ${
                       item.holder_place
                         ? `<div style="margin-top:4px;font-size:var(--text-xs);color:var(--color-text-muted)">
                              认领地点：${UI.escapeHtml(item.holder_place)}
                            </div>`
                         : ''
                     }
                   </div>`
            }
          </div>

          ${
            // 只有发布者/保管者才需要这张管理卡片。
            // 没有管理权的人干脆不渲染它 —— 比"渲染出来再隐藏"干净，
            // 也避免留下一个空的 .card 边框。
            item.is_mine ? '<div class="card panel side-card" id="ownerActions"></div>' : ''
          }
        </aside>
      </div>
    `;

    bindDetailEvents(item);
    loadSuggestions(item);
  }

  /** 绑定详情页的图片放大、状态修改、编辑、删除 */
  function bindDetailEvents(item) {
    // 图片点击放大
    appEl.querySelectorAll('[data-lightbox]').forEach((img) => {
      img.addEventListener('click', () => UI.openLightbox(img.dataset.lightbox));
    });

    const actions = document.getElementById('ownerActions');

    // 【关于非管理者的处理】
    // 这里原来有一张「我能做什么」卡片，里面放了个"我也要发布一条"按钮，
    // 现在去掉了，原因有两个：
    //   1. 逻辑不通 —— 用户正看着一条失物、心里想的是"这是我的东西"，
    //      这时让他"发布一条"是两件不相关的事，按钮意图莫名其妙；
    //   2. 信息重复 —— "该去哪里认领"已经在上面的信息清单里用
    //      「认领地点」写清楚了，再在侧栏说一遍是啰嗦。
    //
    // 所以现在没有管理权的人看到的是：干净的信息 + 联系方式，没有多余按钮。
    if (!actions) return;

    // 是自己的信息：给出状态流转 + 编辑 / 删除
    const statusOptions = [
      {
        value: 'searching',
        label: '标记为「寻找中」',
        hint: '东西还没找到',
        disabled: item.status === 'searching',
      },
      {
        value: 'found',
        label: '标记为「已找到」',
        hint: '已经找到了，别人不用再帮忙',
        disabled: item.status === 'found',
      },
      {
        value: 'closed',
        label: '标记为「已结束」',
        hint: '事情办完，归档',
        disabled: item.status === 'closed',
      },
    ];

    actions.innerHTML = `
      <div class="side-card-title">
        ${item.is_owner ? '管理这条信息' : '管理这条信息（我是保管者）'}
      </div>
      ${
        !item.is_owner
          ? `<p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-2)">
               这条信息是别人发布的，但东西由你保管，所以你可以更新状态
             </p>`
          : ''
      }
      <div class="status-actions">
        ${statusOptions
          .map(
            (opt) => `
          <button class="status-btn" data-status="${opt.value}" ${opt.disabled ? 'disabled' : ''}>
            <span>${UI.escapeHtml(opt.label)}</span>
            <span class="status-hint">${opt.disabled ? '当前状态' : UI.escapeHtml(opt.hint)}</span>
          </button>
        `
          )
          .join('')}
      </div>
      <div class="action-row">
        <a class="btn btn-ghost btn-sm" href="#/edit/${item.id}">编辑内容</a>
        <button class="btn btn-danger btn-sm" id="btnDelete">删除</button>
      </div>
    `;

    actions.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.status;
        if (target === item.status) return;
        btn.disabled = true;
        try {
          await API.items.updateStatus(item.id, target);
          UI.toast('状态已更新', 'success', `现在是「${UI.STATUS_TEXT[target]}」`);
          render();
        } catch (err) {
          btn.disabled = false;
          UI.toast('状态更新失败', 'error', err.message);
        }
      });
    });

    document.getElementById('btnDelete').addEventListener('click', async () => {
      const ok = await UI.confirmDialog({
        title: '删除这条信息？',
        text: '删除后无法恢复，附带的图片也会一起清理。',
        confirmText: '删除',
      });
      if (!ok) return;
      try {
        const result = await API.items.remove(item.id);
        UI.toast('已删除', 'success', result.detail || '');
        go('/mine');
      } catch (err) {
        UI.toast('删除失败', 'error', err.message);
      }
    });
  }

  /** 加载并渲染智能匹配建议 */
  async function loadSuggestions(item) {
    const area = document.getElementById('matchArea');
    if (!area) return;

    try {
      const data = await API.items.suggestions(item.id, 5);
      if (!data.suggestions.length) {
        // 没有匹配结果时给一个说明，而不是留白。
        // 让用户知道"系统真的找过了"，而不是"功能坏了"。
        area.innerHTML = `
          <div class="match-panel">
            <div class="match-head">
              <span>智能匹配</span>
              <span class="match-tag">未找到明显匹配的${UI.escapeHtml(data.opposite_type_label)}</span>
            </div>
            <div style="padding:0 var(--space-4) var(--space-4);font-size:var(--text-xs);color:var(--color-text-muted)">
              系统按「物品名相似度 45% + 地点 25% + 描述 15% + 时间 15%」自动比对。
              也可以点上方「${UI.escapeHtml(data.opposite_type_label)}」分类自己翻一翻。
            </div>
          </div>
        `;
        return;
      }

      area.innerHTML = `
        <div class="match-panel">
          <div class="match-head">
            <span>智能匹配</span>
            <span class="match-tag">为这条信息找到 ${data.suggestions.length} 条可能的${UI.escapeHtml(
              data.opposite_type_label
            )}</span>
          </div>
          <div class="match-list">
            ${data.suggestions
              .map(
                (s) => `
              <a class="match-item" href="#/item/${s.item_id}">
                <div class="match-score">
                  <div class="match-score-num">${s.score_percent}%</div>
                  <div class="match-score-label">匹配度</div>
                </div>
                <div class="match-body">
                  <div class="match-title">${UI.escapeHtml(s.title)}</div>
                  <div class="match-reason">💡 ${UI.escapeHtml(s.reason)}</div>
                  <div class="match-meta">
                    📍 ${UI.escapeHtml(s.location || '地点未填')} ·
                    ${UI.escapeHtml(UI.formatDateTime(s.event_time, { withTime: false }))} ·
                    由 ${UI.escapeHtml(s.owner_display_name)} 发布
                  </div>
                </div>
              </a>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    } catch {
      // 匹配功能失败不应该影响详情页主体，静默处理即可
      area.innerHTML = '';
    }
  }

  /* ======================================================================
     6. 页面：登录 / 注册
     ====================================================================== */

  function viewAuth(mode) {
    const isLogin = mode === 'login';

    appEl.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-head">
            <span class="brand-mark">🔍︎</span>
            <h1 class="auth-title">${isLogin ? '登录' : '注册新账号'}</h1>
            <p class="auth-sub">${isLogin ? '登录后即可发布和修改信息' : '创建账号后会自动登录'}</p>
          </div>

          <form class="auth-form" id="authForm" novalidate>
            <div class="form-field">
              <label class="form-label" for="fUsername">用户名 <span class="required">*</span></label>
              <input class="form-input" id="fUsername" name="username" autocomplete="username"
                     placeholder="3~20 位字母、数字、下划线或连字符" required>
            </div>

            <div class="form-field">
              <label class="form-label" for="fPassword">密码 <span class="required">*</span></label>
              <input class="form-input" id="fPassword" name="password" type="password"
                     autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                     placeholder="${isLogin ? '请输入密码' : '至少 8 位'}" required>
            </div>

            ${
              isLogin
                ? ''
                : `
              <div class="form-field">
                <label class="form-label" for="fDisplayName">昵称</label>
                <input class="form-input" id="fDisplayName" name="display_name" placeholder="留空则用用户名">
              </div>
              <div class="form-field">
                <label class="form-label" for="fContact">联系方式</label>
                <input class="form-input" id="fContact" name="contact" placeholder="如 微信:xxx 或 QQ:123456">
                <span class="form-hint">方便别人捡到东西后联系你，可以稍后再填</span>
              </div>
            `
            }

            <div id="authError"></div>

            <button class="btn btn-primary btn-block" type="submit" id="authSubmit">
              ${isLogin ? '登录' : '注册并登录'}
            </button>
          </form>

          <div class="auth-switch">
            ${
              isLogin
                ? `还没有账号？<button id="switchAuth">去注册</button>`
                : `已经有账号了？<button id="switchAuth">去登录</button>`
            }
          </div>

          ${
            isLogin
              ? `
            <div class="demo-accounts">
              <p class="demo-accounts-title">演示账号（密码都是 Demo@2026，点一下自动填入）</p>
              <div class="demo-account-row">
                ${['xiaoming', 'xiaohong', 'lisi', 'wangwu', 'zhaoliu']
                  .map(
                    (u) =>
                      `<button class="chip" data-demo-user="${u}" type="button">${u}</button>`
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;

    document
      .getElementById('switchAuth')
      .addEventListener('click', () => go(isLogin ? '/register' : '/login'));

    // 演示账号一键填入，方便录演示视频
    appEl.querySelectorAll('[data-demo-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('fUsername').value = btn.dataset.demoUser;
        document.getElementById('fPassword').value = 'Demo@2026';
        document.getElementById('fUsername').focus();
      });
    });

    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('authSubmit');
      const errorBox = document.getElementById('authError');
      errorBox.innerHTML = '';
      submitBtn.disabled = true;
      submitBtn.textContent = isLogin ? '登录中…' : '注册中…';

      const form = new FormData(e.target);
      const payload = {
        username: String(form.get('username') || '').trim(),
        password: String(form.get('password') || ''),
      };
      if (!isLogin) {
        payload.display_name = String(form.get('display_name') || '').trim();
        payload.contact = String(form.get('contact') || '').trim();
      }

      try {
        const result = isLogin
          ? await API.auth.login(payload)
          : await API.auth.register(payload);
        state.user = result.user;
        UI.toast(isLogin ? '登录成功' : '注册成功', 'success', `欢迎，${result.user.display_name}`);
        go('/');
      } catch (err) {
        // 把后端的字段级错误也展示出来，用户才知道到底哪里填错了
        let message = err.message;
        if (err.problems && err.problems.length) {
          message = err.problems.map((p) => `${p.field}: ${p.reason}`).join('；');
        }
        errorBox.innerHTML = `<div class="form-error">${UI.escapeHtml(message)}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = isLogin ? '登录' : '注册并登录';
      }
    });
  }

  /* ======================================================================
     7. 页面：发布 / 编辑
     ====================================================================== */

  async function viewCreate(query) {
    if (!state.user) {
      UI.toast('请先登录', 'warning', '发布信息需要登录账号');
      go('/login');
      return;
    }

    // 从详情页的"我也要发布"跳过来时会带 type 参数，默认填对方相反的类型
    const presetType = query.type === 'found' ? 'found' : 'lost';
    renderItemForm(null, presetType);
  }

  async function viewEdit(itemId) {
    if (!state.user) {
      go('/login');
      return;
    }
    appEl.innerHTML = `<div class="loading-block"><div class="spinner"></div><p>正在加载…</p></div>`;
    try {
      const item = await API.items.detail(itemId);
      if (!item.is_mine) {
        appEl.innerHTML = renderEmpty({
          icon: '🚫',
          title: '无法编辑',
          text: '只能编辑自己发布的信息',
          actionHtml: `<a class="btn btn-primary" href="#/item/${itemId}">返回详情</a>`,
        });
        return;
      }
      renderItemForm(item, item.type);
    } catch (err) {
      appEl.innerHTML = renderEmpty({
        icon: '⚠️',
        title: '加载失败',
        text: err.message,
        actionHtml: '<a class="btn btn-primary" href="#/">返回列表</a>',
      });
    }
  }

  /**
   * 渲染发布/编辑表单
   * @param {object|null} item 编辑时传入原数据，新建时传 null
   * @param {string} presetType 新建时的默认类型
   */
  function renderItemForm(item, presetType) {
    const isEdit = Boolean(item);
    const type = item ? item.type : presetType;

    // 编辑时把已有图片转成"已上传"状态
    state.uploadedImages = {};
    const existingImages = item && item.images ? [...item.images] : [];

    // datetime-local 需要 "YYYY-MM-DDTHH:MM" 这样的格式
    const eventTimeValue = item && item.event_time ? String(item.event_time).slice(0, 16) : '';

    appEl.innerHTML = `
      <div class="form-page">
        <div class="page-head">
          <h1 class="page-title">${isEdit ? '编辑信息' : '发布信息'}</h1>
          <p class="page-desc">
            ${
              isEdit
                ? '修改后会立即更新，其他同学看到的就是新内容'
                : '填得越详细，越容易被对的人看到'
            }
          </p>
        </div>

        <form class="form-card" id="itemForm" novalidate>
          ${
            isEdit
              ? `
            <div class="form-field">
              <span class="form-label">类型</span>
              <div class="form-hint">
                当前是「${UI.escapeHtml(UI.TYPE_TEXT[type])}」。
                类型发布后不能修改 —— 如果选错了，请删除后重新发布
                （改类型会让已有的智能匹配结果失效）。
              </div>
            </div>
          `
              : `
            <div class="form-field">
              <span class="form-label">你要发布哪种信息 <span class="required">*</span></span>
              <div class="segmented">
                <input type="radio" name="type" id="typeLost" value="lost" ${
                  type === 'lost' ? 'checked' : ''
                }>
                <label for="typeLost">
                  <strong>🔍︎ 寻物启事</strong>
                  <small>我丢了东西，希望有人帮忙找</small>
                </label>
                <input type="radio" name="type" id="typeFound" value="found" ${
                  type === 'found' ? 'checked' : ''
                }>
                <label for="typeFound">
                  <strong>📍 招领启事</strong>
                  <small>我捡到东西，寻找失主</small>
                </label>
              </div>
            </div>
          `
          }

          <div class="form-grid" style="margin-top:var(--space-4)">
            <div class="form-field span-2">
              <label class="form-label" for="fTitle">物品名称 <span class="required">*</span></label>
              <input class="form-input" id="fTitle" name="title" maxlength="50" required
                     placeholder="例如：校园卡 / 黑色雨伞 / AirPods 耳机"
                     value="${UI.escapeAttr(item ? item.title : '')}">
              <span class="form-hint">写清楚名称，关键词搜索更容易命中</span>
            </div>

            <div class="form-field">
              <label class="form-label" for="fLocation">
                <span id="labelLocation">${type === 'lost' ? '丢失地点' : '发现地点'}</span>
              </label>
              <input class="form-input" id="fLocation" name="location" maxlength="100"
                     placeholder="例如：下沙校区图书馆二楼"
                     value="${UI.escapeAttr(item ? item.location : '')}">
            </div>

            <div class="form-field">
              <label class="form-label" for="fEventTime">
                <span id="labelEventTime">${type === 'lost' ? '丢失时间' : '发现时间'}</span>
              </label>
              <input class="form-input" id="fEventTime" name="event_time" type="datetime-local"
                     value="${UI.escapeAttr(eventTimeValue)}">
            </div>

            <!-- 拾取者：只有招领启事才有这个概念（东西被捡到了，才有"谁捡的"）。
                 由 syncTypeDependentFields() 按当前选择的类型显示/隐藏。
                 这里按初始类型决定 hidden，避免渲染后闪一下才隐藏。 -->
            <div class="form-field span-2" id="finderField" ${type === 'found' ? '' : 'hidden'}>
              <label class="form-label" for="fFinderName">谁发现的（发现者）</label>
              <input class="form-input" id="fFinderName" name="finder_name" maxlength="30"
                     placeholder="例如：一位同学 / 我自己 / 室友小李。留空也可以"
                     value="${UI.escapeAttr(item ? item.finder_name : '')}">
              <span class="form-hint">
                这一栏和「发布人」是两回事。如果你只是代为转发（比如老师替学生发），
                或者不想公开是谁发现的，都可以留空或只写一个称呼。
              </span>
            </div>

            <div class="form-field span-2">
              <label class="form-label" for="fDescription">详细描述</label>
              <textarea class="form-textarea" id="fDescription" name="description" maxlength="2000"
                        placeholder="颜色、品牌、有没有特殊标记、里面装了什么……描述越具体，越容易确认是不是同一件东西">${UI.escapeHtml(
                          item ? item.description : ''
                        )}</textarea>
            </div>

            <!--
              保管者区块：同样只对招领启事有意义。
              【为什么要单独问这个】
              很多人捡到东西后会交给别人代为保管：老师、宿管、保卫处；
              未成年人捡到贵重物品（比如一大包现金）根本不敢自己拿着，
              会第一时间交给老师。这时"谁发的帖"和"东西在哪"是两回事，
              而失主真正要去的是**保管者**那里。

              【寻物启事为什么不问】失主在说"我丢了什么"，
              那时东西还在别人手上甚至找不到，谈"保管者"没有意义。
            -->
            <div class="form-field span-2" id="holderField" ${type === 'found' ? '' : 'hidden'}>
              <span class="form-label">东西现在在谁手里（保管者）</span>

              <label class="check-row" for="fHolderIsReporter">
                <input type="checkbox" id="fHolderIsReporter" name="holder_is_reporter"
                       ${!item || item.holder_is_reporter ? 'checked' : ''}>
                <span>就是我自己在保管（对于电子设备、现金等贵重物品不宜自己保管）</span>
              </label>

              <!-- 取消勾选后才显示：因为"我自己保管"时这些字段没有意义 -->
              <div id="holderExtra" ${!item || item.holder_is_reporter ? 'hidden' : ''}>
                <div class="form-grid" style="margin-top:var(--space-3)">
                  <div class="form-field">
                    <label class="form-label" for="fHolderName">保管者称呼</label>
                    <input class="form-input" id="fHolderName" maxlength="30"
                           placeholder="例如：王老师 / 6 号楼宿管阿姨 / 图书馆服务台"
                           value="${UI.escapeAttr(item ? item.holder_name : '')}">
                  </div>

                  <div class="form-field">
                    <label class="form-label" for="fHolderPlace">保管地点（去这里认领）</label>
                    <input class="form-input" id="fHolderPlace" maxlength="100"
                           placeholder="例如：行政楼 102 保卫处"
                           value="${UI.escapeAttr(item ? item.holder_place : '')}">
                    <span class="form-hint">失主最需要看到的就是这一栏</span>
                  </div>

                  <div class="form-field span-2">
                    <label class="form-label" for="fHolderUsername">保管者的用户名（可选）</label>
                    <input class="form-input" id="fHolderUsername" maxlength="30"
                           placeholder="支持中文，例如 王老师。填了之后 TA 也能管理这条信息"
                           value="${UI.escapeAttr(item ? item.holder_username : '')}">
                    <span class="form-hint">
                      如果保管者也注册了本平台，填上用户名，TA 登录后就能自己更新状态
                      （比如标记「已交还给失主」）。没有账号就留空，只填上面的称呼和地点。
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-field span-2">
              <label class="form-label" for="fContact">联系方式</label>
              <input class="form-input" id="fContact" name="contact" maxlength="100"
                     placeholder="留空则显示账号里填的：${UI.escapeAttr(
                       state.user.contact || '（你还没填账号联系方式）'
                     )}"
                     value="${UI.escapeAttr(item ? item.contact : '')}">
              <span class="form-hint">这条信息单独使用的联系方式，留空会用账号里的</span>
            </div>

            <div class="form-field span-2">
              <span class="form-label">物品图片（最多 9 张，每张不超过 5MB）</span>
              <div class="image-grid" id="imageGrid"></div>
              <span class="form-hint">支持 JPG / PNG / GIF / WebP。第一张会作为列表封面。</span>
            </div>
          </div>

          <!-- 实名信息提示：当标题/描述里出现姓名、班级、学号，
               或物品本身是证件时，这里会实时出现一段提示，
               引导用户走"直接联系人 / 找辅导员 / 交给机构"的更省事路径。
               由 bindIdentityHint() 动态填充。 -->
          <div id="identityTip"></div>

          <div id="formError" style="margin-top:var(--space-4)"></div>

          <div class="form-actions">
            <button class="btn btn-ghost" type="button" id="btnCancel">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSubmit">
              ${isEdit ? '保存修改' : '发布'}
            </button>
          </div>
        </form>
      </div>
    `;

    // 图片区域：已有的 + 新增的
    renderImageGrid(existingImages);

    // 「就是我自己在保管」勾选框：控制保管者详细字段的显示/隐藏。
    // 勾上时隐藏，因为"我自己保管"时保管者和发布者是同一人，那些字段没有意义。
    const holderCheckbox = document.getElementById('fHolderIsReporter');
    const holderExtra = document.getElementById('holderExtra');
    if (holderCheckbox && holderExtra) {
      const syncHolderFields = () => {
        holderExtra.hidden = holderCheckbox.checked;
      };
      holderCheckbox.addEventListener('change', syncHolderFields);
      syncHolderFields(); // 初始化时同步一次，保证编辑已有信息时状态正确
    }

    // 类型切换：寻物启事和招领启事的表单结构不一样，必须跟着变。
    // （第一版没做这个，导致用户点了"招领启事"后标签不变、
    //   登记保管者的区块也不出现，等于这个功能藏起来了。）
    // 编辑已有信息时类型不可改，没有单选框，所以这里做存在性判断。
    appEl.querySelectorAll('input[name="type"]').forEach((radio) => {
      radio.addEventListener('change', syncTypeDependentFields);
    });
    syncTypeDependentFields();

    document.getElementById('btnCancel').addEventListener('click', () => {
      if (isEdit) go(`/item/${item.id}`);
      else go('/');
    });

    // 实名信息实时提示：用户在标题/描述里一打出姓名、班级、学号，
    // 或写到证件类物品，就立刻给出"更省事的路"指引。
    bindIdentityHint();

    document.getElementById('itemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitItemForm(item);
    });
  }

  /** 读取当前表单选择的类型（编辑模式下类型固定，取传入的 item.type） */
  function currentFormType() {
    const checked = document.querySelector('input[name="type"]:checked');
    return checked ? checked.value : null;
  }

  /**
   * 根据"寻物启事 / 招领启事"切换表单里随类型变化的文案和区块。
   *
   * 差别在哪：
   *   寻物启事（我丢了东西）
   *     · 时间叫「丢失时间」，地点叫「丢失地点」
   *     · 没有「谁发现的」，因为东西还没被找到
   *     · 没有「保管者」，因为东西不在任何人手上
   *     · 标题占位提示"你丢了什么"
   *   招领启事（我捡到东西）
   *     · 时间叫「发现时间」，地点叫「发现地点」
   *     · 有「谁发现的」和「保管者」
   *     · 标题占位提示"你捡到了什么"
   *
   * 【为什么要清空被隐藏字段的值】
   * 用户可能先填了招领启事的内容，又改成寻物启事。
   * 如果不清空，那些值会跟着提交上去，出现
   * "一条寻物启事上写着保管者是王老师"这种自相矛盾的数据。
   */
  function syncTypeDependentFields() {
    const type = currentFormType();
    const isFound = type === 'found';

    // 文案随类型变
    const labelLocation = document.getElementById('labelLocation');
    const labelEventTime = document.getElementById('labelEventTime');
    if (labelLocation) labelLocation.textContent = isFound ? '发现地点' : '丢失地点';
    if (labelEventTime) labelEventTime.textContent = isFound ? '发现时间' : '丢失时间';

    const titleInput = document.getElementById('fTitle');
    if (titleInput) {
      titleInput.placeholder = isFound
        ? '例如：校园卡 / 黑色雨伞 / AirPods 耳机'
        : '例如：我的校园卡 / 黑色长柄伞 / AirPods 耳机';
    }

    // 区块显示/隐藏
    const finderField = document.getElementById('finderField');
    const holderField = document.getElementById('holderField');

    if (finderField) {
      finderField.hidden = !isFound;
      if (!isFound) {
        const input = document.getElementById('fFinderName');
        if (input) input.value = '';
      }
    }

    if (holderField) {
      holderField.hidden = !isFound;
      if (!isFound) {
        // 三个保管者字段 + 勾选框一起复位
        const usernameInput = document.getElementById('fHolderUsername');
        const nameInput = document.getElementById('fHolderName');
        const placeInput = document.getElementById('fHolderPlace');
        if (usernameInput) usernameInput.value = '';
        if (nameInput) nameInput.value = '';
        if (placeInput) placeInput.value = '';
        const checkbox = document.getElementById('fHolderIsReporter');
        if (checkbox) {
          checkbox.checked = true;
          // 勾选框复位后，它控制的子区块也要跟着复位
          const extra = document.getElementById('holderExtra');
          if (extra) extra.hidden = true;
        }
      }
    }

    // 类型变了，实名信息提示也要重算：
    // 寻物启事不该提示"证件要交给校园卡中心"（详见 bindIdentityHint 的说明）。
    // 这里用自定义事件通知它，避免两个函数互相依赖。
    document.getElementById('identityTip')?.dispatchEvent(new Event('recheck'));
  }

  /**
   * 绑定实名信息的实时检测。
   *
   * 【为什么放在客户端而不是后端】
   * 这是一条"提示"，不是"校验规则"：
   *   · 它不需要可信，用户看到提示后仍可自由决定是否发布；
   *   · 放客户端能做到"边打字边提示"，反馈快；
   *   · 不占用接口，也就不会成为绕过点（因为本来就允许绕过）。
   *
   * 【为什么用 rAF 节流】
   * 每次按键都重算正则虽然不贵，但会把提示块反复重建，
   * 导致正在看它的用户视觉上闪动。用 requestAnimationFrame
   * 合并同一帧内的多次输入，DOM 只在真正需要变化时才更新。
   */
  function bindIdentityHint() {
    const tipBox = document.getElementById('identityTip');
    const titleInput = document.getElementById('fTitle');
    const descInput = document.getElementById('fDescription');
    if (!tipBox || !titleInput || !descInput) return;

    let lastHtml = '';
    let scheduled = false;

    const update = () => {
      scheduled = false;

      // 【只为招领启事提示】
      // 理由：这套提示解决的是"东西上带着实名信息，所以能直接找到人"这个问题，
      // 前提是**东西在你手上**。而寻物启事是失主在说"我丢了什么"，
      // 让他"把东西交给校园卡中心"完全没有意义 —— 东西又不在他那里。
      //
      // 我在第一版忽略了这一点，导致发寻物启事时也会弹
      // "建议交给发证机构"，逻辑上很荒谬。
      const type = currentFormType();
      if (type && type !== 'found') {
        if (lastHtml !== '') {
          lastHtml = '';
          tipBox.innerHTML = '';
        }
        return;
      }

      // 把标题和描述拼起来一起判断："校园卡"出现在标题、"姓名张三"出现在描述，
      // 分开检测会漏掉这种组合情况。
      const info = UI.detectIdentityInfo(`${titleInput.value} ${descInput.value}`);
      const html = UI.renderIdentityTip(info);

      // 内容没变就不动 DOM，避免输入时提示块每按一次键就重绘（会闪）
      if (html === lastHtml) return;
      lastHtml = html;
      tipBox.innerHTML = html;
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    };

    titleInput.addEventListener('input', schedule);
    descInput.addEventListener('input', schedule);

    // 类型切换时也要重算（syncTypeDependentFields 会派发 recheck 事件）。
    // 这样从"招领"切到"寻物"时，提示会立刻消失。
    tipBox.addEventListener('recheck', schedule);

    // 进入表单时先算一次：编辑已有信息时，如果原来就带实名信息，
    // 提示应该立刻出现，而不是等用户再敲一下键盘。
    update();
  }

  /** 渲染图片上传区（缩略图 + 上传按钮） */
  function renderImageGrid(images) {
    const grid = document.getElementById('imageGrid');
    if (!grid) return;

    const canAddMore = images.length < 9;

    grid.innerHTML = `
      ${images
        .map(
          (url, index) => `
        <div class="image-thumb">
          <img src="${UI.escapeAttr(url)}" alt="图片 ${index + 1}">
          <button type="button" class="image-remove" data-remove-index="${index}" title="移除">×</button>
        </div>
      `
        )
        .join('')}
      ${
        canAddMore
          ? `
        <label class="image-add" for="imageInput">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
          </svg>
          <span>添加图片</span>
          <input type="file" id="imageInput" accept="image/*" multiple>
        </label>
      `
          : ''
      }
    `;

    // 移除图片
    grid.querySelectorAll('[data-remove-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.removeIndex);
        images.splice(idx, 1);
        renderImageGrid(images);
      });
    });

    const input = document.getElementById('imageInput');
    if (input) {
      input.addEventListener('change', async (e) => {
        const files = [...e.target.files];
        if (!files.length) return;

        const remaining = 9 - images.length;
        const toUpload = files.slice(0, remaining);

        for (const file of toUpload) {
          try {
            const base64 = await UI.fileToBase64(file);
            const result = await API.uploads.upload(base64);
            images.push(result.url);
            renderImageGrid(images);
          } catch (err) {
            UI.toast('图片上传失败', 'error', `${file.name}：${err.message}`);
          }
        }
        if (files.length > remaining) {
          UI.toast('图片数量已达上限', 'warning', `最多 9 张，已忽略多余的 ${files.length - remaining} 张`);
        }
      });
    }
  }

  /** 提交发布/编辑表单 */
  async function submitItemForm(item) {
    const isEdit = Boolean(item);
    const submitBtn = document.getElementById('btnSubmit');
    const errorBox = document.getElementById('formError');
    errorBox.innerHTML = '';

    // 收集表单数据
    const title = document.getElementById('fTitle').value.trim();
    const location = document.getElementById('fLocation').value.trim();
    const description = document.getElementById('fDescription').value.trim();
    const contact = document.getElementById('fContact').value.trim();
    const eventTime = UI.normalizeDateTimeLocal(document.getElementById('fEventTime').value);

    // ---------- 发现者与保管者（只对招领启事）----------
    //
    // 「谁发现的」「东西在谁手里」是招领启事才有的概念 ——
    // 东西被捡到了，才谈得上谁捡的、现在在哪。
    // 寻物启事是失主在说自己丢了什么，那时东西不在他手上，
    // 所以这两个字段一律留空，不读取界面上那两个（已隐藏的）控件。
    //
    // 【实现上为什么用 isFound 而不是判断元素是否存在】
    // 因为这两个区块用的是 hidden 属性（不是条件渲染），
    // 元素始终在 DOM 里。直接去读它们的值会拿到空字符串或旧值，
    // 靠元素存在性判断不出"现在是什么类型"，必须显式看类型。
    const isFound = currentFormType() !== 'lost';
    const finderName = isFound ? document.getElementById('fFinderName').value.trim() : '';

    const holderIsReporter = isFound
      ? document.getElementById('fHolderIsReporter').checked
      : true; // 寻物启事没有保管者，按"发布人自己"记，保持数据一致

    // 勾了"我自己保管"时，保管者的三个字段在界面上是隐藏的。
    // 这里必须显式清空，否则会把上次填写（或编辑时的旧值）一起提交上去，
    // 造成"明明勾了自己保管，详情页却显示是王老师在保管"这种矛盾数据。
    const holderFields =
      !isFound || holderIsReporter
        ? { holder_username: '', holder_name: '', holder_place: '' }
        : {
            holder_username: document.getElementById('fHolderUsername').value.trim(),
            holder_name: document.getElementById('fHolderName').value.trim(),
            holder_place: document.getElementById('fHolderPlace').value.trim(),
          };

    if (!title) {
      errorBox.innerHTML = '<div class="form-error">物品名称不能为空</div>';
      document.getElementById('fTitle').focus();
      return;
    }

    // 未勾"我自己保管"、又没填任何保管者信息时，东西"在谁手里"就没有答案了，
    // 而失主最需要知道的就是这个。所以这里拦一下，让用户明确选一个。
    // （只对招领启事校验：寻物启事根本没有保管者这一说。）
    if (isFound && !holderIsReporter && !holderFields.holder_name && !holderFields.holder_place && !holderFields.holder_username) {
      errorBox.innerHTML =
        '<div class="form-error">请填写保管者信息，或勾选「就是我自己在保管」</div>';
      document.getElementById('fHolderName').focus();
      return;
    }

    // ---------- 证件类物品：发布前再确认一次 ----------
    //
    // 【只对招领启事确认】
    // 因为"证件类物品该怎么处理"这个建议的前提是**东西在你手上**。
    // 失主发寻物启事时东西又不在他那里，跟他说"交给校园卡中心"很荒谬。
    //
    // 【为什么只对"证件"确认，不对"姓名/班级"确认】
    // 证件类是"这个东西本身就是别人的身份凭证"，挂到公开列表上
    // 等于把一个身份凭证的位置公开告诉所有人，风险明显更高。
    // 而姓名/班级只是提示一下更省事的路，不该拦人。
    //
    // 【为什么是确认而不是禁止】
    // 用户可能真的有理由发布（比如已经交给宿管了，想留一条记录让人能查到）。
    // 系统的角色是"提醒"，不是"替用户做决定"，所以必须给一条明确的退路。
    const identityInfo = isFound ? UI.detectIdentityInfo(`${title} ${description}`) : null;
    if (identityInfo && identityInfo.level === 'document' && !isEdit) {
      const proceed = await UI.confirmDialog({
        title: '这是证件类物品，确定要公开发布吗？',
        text:
          `识别到「${identityInfo.matched.join('、')}」。` +
          '这类东西交给校园卡中心或保卫处通常更快，也能避免把失主的个人信息公开在列表上。' +
          '如果你已经交给别人保管，可以继续发布，并在「保管者」里写清交给了谁。',
        confirmText: '仍然发布',
        danger: false,
      });
      if (!proceed) {
        // 用户选择不发：把光标送到描述框，方便他改内容
        document.getElementById('fDescription').focus();
        return;
      }
    }

    // 从图片区收集当前的图片列表
    const images = [...document.querySelectorAll('#imageGrid .image-thumb img')].map((img) => img.src);

    // 图片的 src 是完整 URL（如 http://127.0.0.1:8000/uploads/x.png），
    // 而数据库里存的是相对路径 /uploads/x.png。这里转回相对路径。
    const imageUrls = images.map((src) => {
      try {
        const url = new URL(src);
        return url.pathname;
      } catch {
        return src;
      }
    });

    const payload = {
      title,
      location,
      description,
      contact,
      event_time: eventTime,
      image_urls: imageUrls,
      finder_name: finderName,
      holder_is_reporter: holderIsReporter,
      ...holderFields,
    };

    if (!isEdit) {
      const checked = document.querySelector('input[name="type"]:checked');
      payload.type = checked ? checked.value : 'lost';
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? '保存中…' : '发布中…';

    try {
      if (isEdit) {
        await API.items.update(item.id, payload);
        UI.toast('修改成功', 'success');
        go(`/item/${item.id}`);
      } else {
        const created = await API.items.create(payload);
        UI.toast('发布成功', 'success', '其他同学现在就能看到这条信息了');
        go(`/item/${created.id}`);
      }
    } catch (err) {
      let message = err.message;
      if (err.problems && err.problems.length) {
        message = err.problems.map((p) => `${p.field}: ${p.reason}`).join('；');
      }
      errorBox.innerHTML = `<div class="form-error">${UI.escapeHtml(message)}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? '保存修改' : '发布';
    }
  }

  /* ======================================================================
     8. 页面：我的发布
     ====================================================================== */

  async function viewMine(query) {
    if (!state.user) {
      UI.toast('请先登录', 'warning');
      go('/login');
      return;
    }

    const statusFilter = query.status || '';
    const page = Number(query.page || 1);

    appEl.innerHTML = `
      <div class="page-head">
        <h1 class="page-title">我的发布</h1>
        <p class="page-desc">管理你发布的寻物启事和招领启事</p>
      </div>

      <div class="tabs">
        <a class="tab ${!statusFilter ? 'is-active' : ''}" href="#/mine">全部</a>
        <a class="tab ${statusFilter === 'searching' ? 'is-active' : ''}" href="#/mine?status=searching">寻找中</a>
        <a class="tab ${statusFilter === 'found' ? 'is-active' : ''}" href="#/mine?status=found">已找到</a>
        <a class="tab ${statusFilter === 'closed' ? 'is-active' : ''}" href="#/mine?status=closed">已结束</a>
      </div>

      <div id="mineArea">${renderSkeletons(3)}</div>
    `;

    try {
      const data = await API.items.mine({
        status: statusFilter || undefined,
        page,
        page_size: 10,
      });
      const area = document.getElementById('mineArea');
      if (!area) return;

      if (!data.items.length) {
        area.innerHTML = renderEmpty({
          icon: '📝',
          title: statusFilter ? '这个状态下还没有信息' : '你还没有发布过信息',
          text: statusFilter ? '换个筛选条件看看' : '丢东西或者捡到东西时，都可以来这里发布',
          actionHtml:
            '<a class="btn btn-primary" href="#/create">发布第一条信息</a>',
        });
        return;
      }

      area.innerHTML = `
        <div class="result-line"><span>共 <strong>${data.total}</strong> 条</span></div>
        ${data.items.map(renderMyItem).join('')}
        ${renderPagination(data)}
      `;

      bindMyItemActions(data.items);

      area.querySelectorAll('.page-btn[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = Number(btn.dataset.page);
          if (!target || btn.disabled) return;
          updateQuery({ page: target }, { resetPage: false });
        });
      });
    } catch (err) {
      const area = document.getElementById('mineArea');
      if (area) {
        area.innerHTML = renderEmpty({ icon: '⚠️', title: '加载失败', text: err.message });
      }
    }
  }

  /** 我的发布里的一条（紧凑列表样式，带管理按钮） */
  function renderMyItem(item) {
    const thumb = item.cover_image
      ? `<img class="my-item-thumb" src="${UI.escapeAttr(item.cover_image)}" alt="" loading="lazy">`
      : `<div class="my-item-thumb my-item-thumb-placeholder">${UI.TYPE_EMOJI[item.type] || '📦'}</div>`;

    return `
      <div class="my-item" data-item-id="${item.id}">
        ${thumb}
        <div class="my-item-body">
          <div class="my-item-top">
            <a class="my-item-title" href="#/item/${item.id}">${UI.escapeHtml(item.title)}</a>
            ${UI.typeBadge(item.type, item.type_label)}
            ${UI.statusBadge(item.status, item.status_label)}
          </div>
          <div class="my-item-meta">
            <span>📍 ${UI.escapeHtml(item.location || '地点未填')}</span>
            <span>🕒 发布 ${UI.escapeHtml(UI.formatRelative(item.created_at))}</span>
            <span>👁 ${item.view_count}</span>
          </div>
          <div class="my-item-actions">
            <a class="btn btn-ghost btn-sm" href="#/item/${item.id}">查看</a>
            <a class="btn btn-ghost btn-sm" href="#/edit/${item.id}">编辑</a>
            ${
              item.status !== 'found'
                ? `<button class="btn btn-soft btn-sm" data-mark-found="${item.id}">标记已找到</button>`
                : ''
            }
            ${
              item.status !== 'closed'
                ? `<button class="btn btn-ghost btn-sm" data-close="${item.id}">结束</button>`
                : ''
            }
            <button class="btn btn-danger btn-sm" data-delete="${item.id}">删除</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindMyItemActions(items) {
    const byId = new Map(items.map((i) => [String(i.id), i]));

    const doStatus = async (id, status, successText) => {
      try {
        await API.items.updateStatus(id, status);
        UI.toast(successText, 'success');
        render();
      } catch (err) {
        UI.toast('操作失败', 'error', err.message);
      }
    };

    appEl.querySelectorAll('[data-mark-found]').forEach((btn) =>
      btn.addEventListener('click', () => doStatus(btn.dataset.markFound, 'found', '已标记为「已找到」'))
    );

    appEl.querySelectorAll('[data-close]').forEach((btn) =>
      btn.addEventListener('click', () => doStatus(btn.dataset.close, 'closed', '已标记为「已结束」'))
    );

    appEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delete;
        const item = byId.get(String(id));
        const ok = await UI.confirmDialog({
          title: '删除这条信息？',
          text: item ? `「${item.title}」删除后无法恢复。` : '删除后无法恢复。',
          confirmText: '删除',
        });
        if (!ok) return;
        try {
          await API.items.remove(id);
          UI.toast('已删除', 'success');
          render();
        } catch (err) {
          UI.toast('删除失败', 'error', err.message);
        }
      });
    });
  }

  /* ======================================================================
     9. 页面：404
     ====================================================================== */

  function viewNotFound() {
    appEl.innerHTML = renderEmpty({
      icon: '🧭',
      title: '页面不存在',
      text: '你访问的地址没有对应的页面',
      actionHtml: '<a class="btn btn-primary" href="#/">回到首页</a>',
    });
  }

  /* ======================================================================
     10. 路由分发
     ====================================================================== */

  async function render() {
    const { path, query } = parseHash();

    renderHeader();

    // 路由表：把路径映射到对应的视图函数
    const itemMatch = path.match(/^\/item\/(\d+)$/);
    const editMatch = path.match(/^\/edit\/(\d+)$/);

    if (path === '/' || path === '') {
      await viewHome(query);
    } else if (itemMatch) {
      await viewDetail(itemMatch[1]);
    } else if (editMatch) {
      await viewEdit(editMatch[1]);
    } else if (path === '/create') {
      await viewCreate(query);
    } else if (path === '/mine') {
      await viewMine(query);
    } else if (path === '/login') {
      viewAuth('login');
    } else if (path === '/register') {
      viewAuth('register');
    } else {
      viewNotFound();
    }

    UI.scrollTop();
  }

  /* ======================================================================
     11. 事件绑定与启动
     ====================================================================== */

  async function handleLogout() {
    const ok = await UI.confirmDialog({
      title: '确认退出登录？',
      text: '退出后需要重新登录才能发布信息。',
      confirmText: '退出登录',
      danger: false,
    });
    if (!ok) return;
    try {
      await API.auth.logout();
    } catch {
      // 即使请求失败也继续把本地状态清掉，保证用户能"退出去"
    }
    state.user = null;
    UI.toast('已退出登录', 'success');
    go('/');
    renderHeader();
  }

  /** 启动时先查一次登录状态 */
  async function bootstrapAuth() {
    try {
      state.user = await API.auth.me();
    } catch {
      // 401 是正常的"未登录"状态，不是错误
      state.user = null;
    }
  }

  function bindGlobalEvents() {
    // 路由变化时重新渲染
    window.addEventListener('hashchange', render);

    // 悬浮发布按钮
    document.getElementById('fabCreate').addEventListener('click', () => {
      if (!state.user) {
        UI.toast('请先登录', 'warning', '发布信息需要登录账号');
        go('/login');
        return;
      }
      go('/create');
    });

    // 移动端菜单。
    // 注意：导航区可能一个可见项都没有（未登录时"我的发布"是隐藏的），
    // 此时汉堡按钮也被 CSS 隐藏了，所以这里必须做存在性判断，
    // 否则 addEventListener 会抛错并中断后面的绑定。
    const navToggle = document.getElementById('navToggle');
    const mainNav = document.getElementById('mainNav');
    if (navToggle && mainNav) {
      navToggle.addEventListener('click', () => mainNav.classList.toggle('is-open'));
      mainNav.addEventListener('click', (e) => {
        if (e.target.classList.contains('nav-item')) mainNav.classList.remove('is-open');
      });
    }

    // 键盘快捷键：按 / 聚焦搜索框（很多网站都有这个习惯）
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        const search = document.getElementById('searchInput');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    });
  }

  async function start() {
    bindGlobalEvents();
    await bootstrapAuth();
    await render();
  }

  return { start };
})();

// 等 DOM 就绪后启动
document.addEventListener('DOMContentLoaded', () => App.start());
