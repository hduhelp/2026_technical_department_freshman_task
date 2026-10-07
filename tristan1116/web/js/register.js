// ============================================================
//  注册页
//  注册成功后自动帮用户登录（少一步操作）
// ============================================================

async function doRegister() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const nickname = document.getElementById('nickname').value.trim();
  const studentId = document.getElementById('studentId').value.trim();

  // 前端先校验（后端也会校验，这里只是让提示更及时）
  if (username.length < 3 || username.length > 20) return toast('用户名需要 3~20 位');
  if (password.length < 6 || password.length > 32) return toast('密码需要 6~32 位');

  const btn = document.getElementById('regBtn');
  btn.disabled = true;
  btn.textContent = '注册中…';

  try {
    // ① 注册
    await api.post('/auth/register', {
      username, password,
      nickname: nickname,
      student_id: studentId,
    });

    // ② 注册成功 → 顺手登录，省得用户再输一遍
    const login = await api.post('/auth/login', { username, password });
    setToken(login.token);

    toast('注册成功，正在进入…');
    setTimeout(() => { location.href = 'index.html'; }, 800);
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '注 册';
  }
}

document.getElementById('regBtn').onclick = doRegister;
