export const campuses = { xiasha: '下沙校区', shaoxing: '绍兴校区', wenyi: '文一校区' }
export const reviewLabels = { pending: '待审核', approved: '已通过', returned: '退回修改', rejected: '已拒绝', removed: '已下架', superseded: '已被取代' }
export const reportLabels = { pending: '待处理', handled: '已处理', dismissed: '已驳回' }
export const contactLabels = { wechat: '微信', phone: '手机号', qq: 'QQ', other: '其他' }
export const reasons = { false_information: '虚假信息', inappropriate: '不良内容', privacy: '隐私泄露', harassment: '骚扰', other: '其他' }
export const actions = { approve_post: '审核通过', return_post: '退回修改', reject_post: '拒绝发布', remove_post: '下架帖子', handle_report: '处理举报', dismiss_report: '驳回举报', disable_user: '禁用账号', reset_password: '重置密码' }
export function resolution(post) {
  if (post.resolution_status === 'withdrawn') return '已撤回'
  return post.resolution_status === 'completed' ? (post.post_type === 'lost' ? '已找回' : '已归还') : (post.post_type === 'lost' ? '寻找中' : '待认领')
}
export function dateTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—' }
export function eventTime(post) { return [post.event_date, post.time_precision === 'date' ? '（仅日期）' : post.event_time_start + (post.time_precision === 'range' ? '–' + post.event_time_end : '')].join(' ') }
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) }
export function blankPost() { return { post_type: '', item_name: '', campus: '', location: '', event_date: today(), time_precision: 'date', event_time_start: null, event_time_end: null, description: '', images: [], contact_methods: [{ type: 'wechat', value: '' }] } }
export function postPayload(form) {
  const result = Object.fromEntries(Object.keys(blankPost()).map(k => [k, form[k]]))
  result.event_time_start = form.time_precision === 'date' ? null : form.event_time_start
  result.event_time_end = form.time_precision === 'range' ? form.event_time_end : null
  return result
}
export function validatePost(post, now = new Date()) {
  const errors = {}
  if (!['lost', 'found'].includes(post.post_type)) errors.post_type = '请选择寻物或拾物'
  if (!campuses[post.campus]) errors.campus = '请选择校区'
  for (const [field, max, label] of [['item_name', 50, '物品名称'], ['location', 100, '具体地点'], ['description', 300, '物品描述']]) {
    if (!post[field]?.trim() || [...post[field]].length > max) errors[field] = `${label}需填写 1–${max} 个字符`
  }
  const date = new Date(post.event_date + 'T00:00:00+08:00')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.event_date || '') || Number.isNaN(+date) || new Date(+date + 8 * 3600000).toISOString().slice(0, 10) !== post.event_date || date > now) errors.event_date = '日期不能为空或晚于当前时间'
  if (!['date', 'exact', 'range'].includes(post.time_precision)) errors.time_precision = '请选择时间精度'
  if (post.time_precision !== 'date') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(post.event_time_start || '')) errors.event_time_start = '请选择具体时间'
    else if (new Date(`${post.event_date}T${post.event_time_start}:00+08:00`) > now) errors.event_time_start = '时间不能晚于当前时间'
  }
  if (post.time_precision === 'range' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(post.event_time_end || '') || post.event_time_end < post.event_time_start || new Date(`${post.event_date}T${post.event_time_end}:00+08:00`) > now)) errors.event_time_end = '结束时间不能早于开始或晚于当前时间'
  if (!post.contact_methods.length) errors.contact_methods = '至少填写一种联系方式'
  for (const c of post.contact_methods) {
    if (!contactLabels[c.type] || !c.value.trim() || [...c.value].length > 200) errors.contact_methods = '联系方式需填写 1–200 个字符'
    else if (c.type === 'phone' && !/^1\d{10}$/.test(c.value)) errors.contact_methods = '请输入 11 位大陆手机号'
    else if (c.type === 'qq' && !/^\d{5,12}$/.test(c.value)) errors.contact_methods = 'QQ 号码应为 5–12 位数字'
  }
  if (post.images.length > 6) errors.images = '最多上传 6 张图片'
  return errors
}
export function passwordError(oldPassword, password, confirm) {
  if ([...password].length < 8 || [...password].length > 32) return '密码长度为 8–32 个字符'
  if (oldPassword === password) return '新密码不能与原密码相同'
  if (password !== confirm) return '两次密码不一致'
  return ''
}
