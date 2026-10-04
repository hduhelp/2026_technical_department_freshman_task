/* ==========================================================================
   api.js —— 后端接口封装
   --------------------------------------------------------------------------
   为什么要单独抽一层，而不是在每个页面里直接 fetch？

   1. 统一错误处理：后端返回的错误格式是固定的
      { error, code, message }，在这里转成 Error 对象抛出去，
      页面只写 try/catch 就行，不用每次都判断 response.ok。

   2. 统一凭证处理：登录凭证在 HttpOnly Cookie 里，浏览器会自动带上。
      但要用 `credentials: 'same-origin'` 明确告诉 fetch 带上 Cookie，
      否则某些情况下不会发送，会出现"明明登录了却说未登录"的怪问题。

   3. 便于替换：以后要换接口地址或加请求日志，只改这一个文件。
   ========================================================================== */

const API = (() => {
  // 前端由后端自己托管（同源），所以用相对路径即可。
  // 如果将来前端单独部署，把这里改成完整地址即可。
  const BASE = '';

  /** 自定义错误类型，带上后端返回的错误码，方便页面按码做不同处理 */
  class ApiError extends Error {
    constructor(message, code, status, problems) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'unknown';
      this.status = status || 0;
      this.problems = problems || null;
    }
  }

  /**
   * 统一的请求函数
   */
  async function request(method, path, { body, headers = {}, raw = false } = {}) {
    const options = {
      method,
      // 【关键】带上 Cookie，登录凭证就是靠它自动传递的
      credentials: 'same-origin',
      headers: { ...headers },
    };

    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(BASE + path, options);
    } catch (err) {
      // fetch 只有在网络层失败时才 reject（比如服务没启动）
      throw new ApiError('无法连接服务器，请确认后端已启动', 'network_error', 0);
    }

    if (raw) return response;

    // 204 没有内容体
    if (response.status === 204) return null;

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // 后端返回了非 JSON（比如 500 的 HTML 错误页）
        if (!response.ok) {
          throw new ApiError('服务器返回了无法解析的内容', 'bad_response', response.status);
        }
        return text;
      }
    }

    if (!response.ok) {
      const message = (data && data.message) || `请求失败（HTTP ${response.status}）`;
      const code = (data && data.code) || `http_${response.status}`;
      throw new ApiError(message, code, response.status, data && data.problems);
    }

    return data;
  }

  const get = (path) => request('GET', path);
  const post = (path, body) => request('POST', path, { body });
  const patch = (path, body) => request('PATCH', path, { body });
  const del = (path) => request('DELETE', path);

  /** 把对象转成查询字符串，自动跳过空值 */
  function toQuery(params) {
    const usable = Object.entries(params || {}).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    );
    if (!usable.length) return '';
    const sp = new URLSearchParams();
    for (const [k, v] of usable) sp.append(k, v);
    return `?${sp.toString()}`;
  }

  return {
    ApiError,

    // ---------------- 认证 ----------------
    auth: {
      register: (payload) => post('/api/auth/register', payload),
      login: (payload) => post('/api/auth/login', payload),
      me: () => get('/api/auth/me'),
      updateProfile: (payload) => patch('/api/auth/me', payload),
      logout: () => post('/api/auth/logout'),
    },

    // ---------------- 失物招领 ----------------
    items: {
      /**
       * 查询列表
       * @param {{q?:string, type?:string, status?:string, location?:string,
       *          sort?:string, page?:number, page_size?:number}} params
       */
      list: (params) => get(`/api/items${toQuery(params)}`),

      /** 我发布的信息 */
      mine: (params) => get(`/api/items/mine${toQuery(params)}`),

      detail: (id) => get(`/api/items/${id}`),

      create: (payload) => post('/api/items', payload),

      update: (id, payload) => patch(`/api/items/${id}`, payload),

      updateStatus: (id, status) => patch(`/api/items/${id}/status`, { status }),

      remove: (id) => del(`/api/items/${id}`),

      /** 智能匹配建议 */
      suggestions: (id, limit = 5) => get(`/api/items/${id}/suggestions${toQuery({ limit })}`),
    },

    // ---------------- 图片 ----------------
    uploads: {
      /** 上传图片，传 base64 字符串，返回 { url } */
      upload: (imageBase64) => post('/api/uploads/images', { image_base64: imageBase64 }),

      /** 给已有信息追加图片 */
      attach: (itemId, imageBase64) =>
        post(`/api/uploads/items/${itemId}/images`, { image_base64: imageBase64 }),
    },
  };
})();
