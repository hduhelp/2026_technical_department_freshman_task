export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 登录/注册不显示统一标题栏，页面自己出标题并在剩余空间里居中
  return <div className="flex min-h-svh flex-col px-6 py-12">{children}</div>
}
