import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "服务条款 · 校园失物招领",
}

const SECTIONS = [
  {
    title: "用途",
    body: "本站只用于校园内的失物招领：拾获者发布物品，失主认领并取回。请勿发布与失物招领无关的内容。",
  },
  {
    title: "诚信认领",
    body: "认领必须留下真实姓名与手机号。冒领会占用失主找回物品的机会；如果认领后发现拿错了，请立即联系拾主归还；据为己有可能需要承担法律责任。",
  },
  {
    title: "信息真实",
    body: "发布与认领时请填写真实信息。发布虚假信息、恶意认领他人财物，账号可能被停用。",
  },
  {
    title: "物品保管",
    body: "拾获者可以选择代为保管或留在原地。线下交接时请当面核对物品特征。",
  },
]

export default function TermsPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5">
      <p className="text-sm text-muted-foreground">
        使用本站即表示你同意以下条款。
      </p>
      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">
            {section.title}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {section.body}
          </p>
        </section>
      ))}
    </div>
  )
}
