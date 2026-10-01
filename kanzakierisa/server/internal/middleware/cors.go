package middleware

import (
	"net"
	"net/url"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// CORS 返回开发期跨域中间件。
//
// 生产环境（APP_ENV=production）下返回直通中间件，不添加任何 CORS 头 ——
// 同源部署时浏览器不会发跨域请求；若确有跨域需求，应在部署层显式配置网关，
// 而不是在应用里放宽。
//
// ============================ 为什么用 AllowOriginFunc ============================
//
// 最初这里是一份固定白名单（只有 localhost:5173 / 127.0.0.1:5173）。P5 走查发现
// 它会让「手机连同一 Wi-Fi 访问 http://<电脑IP>:5173」整条链路失效：
//
//   浏览器对**同源的非 GET 请求**同样会带上 Origin 头（Fetch 规范如此）。
//   前端是通过 Vite 的 proxy 把 /api 转给本服务的，所以这些请求在浏览器看来
//   是同源、在服务端看来却带着一个陌生 Origin —— 于是被 CORS 中间件直接 403。
//
// 表现是「页面能打开、列表能加载（GET 不带 Origin），但一登录/发布就
// 『网络异常，请检查连接』」。同一原因也会让 `npm run preview`（4173 端口）无法登录。
//
// 白名单方案还有第二个问题：端口一换（dev 5173 / preview 4173）、电脑换一个
// 网段，都要回来改代码。改成**按来源判定**之后，开发期怎么访问都不会踩到，
// 也不必预知端口。
// ==================================================================================
func CORS(isProduction bool) gin.HandlerFunc {
	if isProduction {
		return func(c *gin.Context) { c.Next() }
	}

	return cors.New(cors.Config{
		AllowOriginFunc:  isDevOrigin,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", HeaderRequestID},
		ExposeHeaders:    []string{HeaderRequestID},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}

// isDevOrigin 判断一个 Origin 是否属于「开发期的本机或局域网前端」。
//
// 放行两类，**端口不限**（dev server 5173、vite preview 4173、将来换端口都适用）：
//
//   - 回环地址：localhost / 127.0.0.0/8 / ::1
//   - 私有网段：10/8、172.16/12、192.168/16（net.IP.IsPrivate 的实现，
//     另含 IPv6 的 fc00::/7），用于「手机连同一个 Wi-Fi 访问电脑 IP」这一场景
//
// 公网域名与公网 IP 一律拒绝 —— 这一层只服务于本地开发，不是对外放开。
func isDevOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return false
	}

	host := u.Hostname()
	if host == "localhost" {
		return true
	}

	ip := net.ParseIP(host)
	if ip == nil {
		// 非 IP 且非 localhost 的域名（例如任意公网域名）不在此列
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate()
}
