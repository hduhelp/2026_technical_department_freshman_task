// ============================================================
//  发布页：新建 和 编辑 共用
//  URL 带 ?id= 就是编辑模式，否则是新建
// ============================================================

const editId = getQuery('id');
const isEdit = !!editId;

let type = 'lost';   // 当前选中的类型
let category = '';   // 当前选中的分类

// ---------- 渲染类型选择（两个大按钮） ----------
function renderTypePicker() {
  const options = [
    { value: 'lost',  emoji: '😢', name: '我丢了东西', desc: '发布失物' },
    { value: 'found', emoji: '🙌', name: '我捡到东西', desc: '发布招领' },
  ];
  document.getElementById('typePicker').innerHTML = options.map((o) => `
    <div class="type-btn ${type === o.value ? 'active' : ''}" data-type="${o.value}">
      <span class="emoji">${o.emoji}</span>
      <span class="name">${o.name}</span>
      <span class="desc">${o.desc}</span>
    </div>
  `).join('');

  // 编辑模式下不允许改类型（后端也不支持改，一条失物帖不该变成招领帖）
  document.getElementById('typeHint').textContent = isEdit ? '（编辑时不可修改）' : '';
  document.getElementById('timeLabel').innerHTML =
    (type === 'found' ? '捡到时间' : '丢失时间') + ' <span class="hint">必填</span>';

  document.getElementById('typePicker').onclick = (e) => {
    const el = e.target.closest('[data-type]');
    if (!el || isEdit) return;
    type = el.dataset.type;
    renderTypePicker();
  };
}

// ---------- 渲染分类网格 ----------
function renderCatGrid() {
  document.getElementById('catGrid').innerHTML = Object.entries(CATEGORY_TEXT).map(([v, t]) => `
    <div class="cat-item ${category === v ? 'active' : ''}" data-cat="${v}">
      <span class="emoji">${CATEGORY_EMOJI[v]}</span>${t}
    </div>
  `).join('');

  document.getElementById('catGrid').onclick = (e) => {
    const el = e.target.closest('[data-cat]');
    if (!el) return;
    category = el.dataset.cat;
    renderCatGrid();
  };
}

// ---------- 编辑模式：先把原数据填进表单 ----------
async function loadForEdit() {
  try {
    const it = await api.get('/items/' + editId);
    type = it.type;
    category = it.category;

    document.getElementById('pageTitle').textContent = '编辑信息';
    document.getElementById('submitBtn').textContent = '保存修改';
    document.getElementById('title').value = it.title;
    document.getElementById('campus').value = it.campus || '';
    document.getElementById('place').value = it.place || '';
    document.getElementById('happenedAt').value = toLocalInput(it.happened_at);
    document.getElementById('description').value = it.description || '';
    // 联系方式不在详情接口里返回，留空 = 不修改
    document.getElementById('contact').placeholder = '不填则保持原联系方式不变';

    renderTypePicker();
    renderCatGrid();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 提交 ----------
async function submit() {
  const title = document.getElementById('title').value.trim();
  const campus = document.getElementById('campus').value;
  const place = document.getElementById('place').value.trim();
  const happenedAt = document.getElementById('happenedAt').value;
  const description = document.getElementById('description').value.trim();
  const contact = document.getElementById('contact').value.trim();

  // 前端先校验一遍（后端也会校验，这里是为了体验好）
  if (!title) return toast('请填写物品名称');
  if (!category) return toast('请选择物品分类');
  if (!happenedAt) return toast('请选择时间');
  if (!isEdit && !contact) return toast('请填写联系方式');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = isEdit ? '保存中…' : '发布中…';

  try {
    if (isEdit) {
      // 编辑：只传改动的字段（空字符串后端会当作"不修改"）
      const body = { title, category, campus, place, happened_at: happenedAt, description };
      if (contact) body.contact = contact;
      await api.put('/items/' + editId, body);
      toast('修改成功');
      setTimeout(() => { location.href = 'detail.html?id=' + editId; }, 700);
    } else {
      // 新建：type / status / user_id 都由后端定，前端只传内容
      const data = await api.post('/items', {
        type, title, category, campus, place,
        happened_at: happenedAt, description, contact,
      });
      toast('发布成功');
      setTimeout(() => { location.href = 'detail.html?id=' + data.id; }, 700);
    }
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = isEdit ? '保存修改' : '发布';
  }
}

// ---------- 启动 ----------
if (!requireLogin()) {
  // 没登录，已经在跳转登录页了
} else {
  renderTypePicker();
  renderCatGrid();
  document.getElementById('submitBtn').onclick = submit;
  if (isEdit) loadForEdit();
}
