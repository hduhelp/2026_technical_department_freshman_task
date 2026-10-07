# 真实微信后端联调

本目录只提供后端联调脚本，不开发小程序前端。AppSecret 仅保存在被 Git 忽略的 `backend/configs/config.local.yaml` 中。

在微信开发者工具打开独立临时空项目 `/Users/lushihao/WeChatProjects/lost-found-backend-probe`（AppID：`wxac7f48ae41ea7c72`）。在调试器 Console 执行：

```javascript
wx.login({ success: r => console.log(r.code), fail: e => console.error(e.errMsg) })
```

每次测试使用新 code。在 backend 目录运行：

```sh
rtk proxy python3 tests/wechat/real_login.py
```

脚本隐藏 code 输入，不输出 JWT、OpenID 或 session_key。`409 WECHAT_NOT_BOUND` 表示 Go 后端已成功向微信交换真实身份，但该微信身份未绑定校园平台账号；`200` 表示已有绑定的微信快捷登录成功。绑定和换绑接口已实现，隔离回归见 `tests/accounts`，实际绑定入口在小程序账号设置中。

当前电脑直接访问微信接口（使用无效测试 code）返回 `40029`，只能确认网络可达及错误码，不能作为真实 code 联调成功证据。需要完成上述真实 code 步骤。

本机后端地址：`http://127.0.0.1:8080`。临时项目不调用本机网络，无需关闭合法域名或 HTTPS 校验。AppSecret 只通过 Go 后端发送到微信官方 API。

## 本次实测

`last-result.json` 记录 2026-10-06 的真实 `wx.login` 身份交换检查，返回 `409 WECHAT_NOT_BOUND`。该历史记录只证明当时身份交换链路正常，不代表之后账号的绑定状态或微信快捷登录结果。三端业务前端已经实现，当前验证边界见 [三端验证记录](../../../frontend/VERIFICATION.md)。
