#!/usr/bin/env python3
"""将开发者工具生成的新 code 交给本机 Go 登录接口，不输出微信身份或 JWT。"""
import argparse
import getpass
import json
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    code = getpass.getpass("请输入新的 wx.login code（输入隐藏）：")
    body = json.dumps({"grant_type": "wechat_code", "client_type": "miniapp", "code": code}).encode()
    req = urllib.request.Request(args.base_url.rstrip("/") + "/api/v1/auth/tokens", body,
                                 {"Content-Type": "application/json"}, method="POST")
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    except urllib.error.URLError:
        print("无法连接本机后端，请检查启动状态。")
        return 1
    with response:
        data = json.load(response)
        status = response.status
    print(json.dumps({"http_status": status, "code": data.get("code"),
                      "request_id": data.get("request_id")}, ensure_ascii=False))
    if status == 409 and data.get("code") == "WECHAT_NOT_BOUND":
        print("真实微信 code 交换成功；当前微信身份尚未绑定平台账号。")
        return 0
    if status == 200 and data.get("code") == 1:
        print("真实微信快捷登录成功，已绑定的平台账号获得 JWT（不输出凭证）。")
        return 0
    print("未完成真实微信登录联调，请核对新的 code、AppID 和后端配置。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
