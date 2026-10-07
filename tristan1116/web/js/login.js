// ============================================================
//  登录页
//  登录成功后跳回 redirect 参数指定的页面（比如从详情页跳过来的）
// ============================================================

const redirect = getQuery('redirect') || 'index.html';

async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username) return toast('请输入用户名');
  if (!password) return toast('请输入密码');

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = '登录中…';

  try {
    const data = await api.post('/auth/login', { username, password });
    setToken(data.token);          // token 存进浏览器本地
    toast('登录成功');
    setTimeout(() => { location.href = redirect; }, 600);
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '登 录';
  }
}

document.getElementById('loginBtn').onclick = doLogin;

// 在密码框按回车直接登录
document.getElementById('password').onkeydown = (e) => {
  if (e.key === 'Enter') doLogin();
};
