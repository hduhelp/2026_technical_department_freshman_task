import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "隐私政策 · 校园失物招领",
}

const SECTIONS = [
  {
    title: "我们收集什么",
    body: "注册时你提供的真实姓名与手机号，以及你发布物品时填写的联系方式或位置。除此之外不收集其它个人信息。",
  },
  {
    title: "用来做什么",
    body: "姓名与手机号用于：① 手机号作为登录账号；② 认领时让拾主能联系到你、并线下核对身份。位置信息只在你选择「留在原地」时用于指引失主取回。",
  },
  {
    title: "谁能看到",
    body: "失物墙只展示物品图片、名称、描述与发布时间。你的姓名、手机号不会出现在信息流里：只有拾主能看到认领人的信息；同一物品有多个认领人时，认领人之间也能看到彼此的信息，用于协商。",
  },
  {
    title: "不做的事",
    body: "我们不做短信验证码、不接入广告、不向第三方出售或共享你的个人信息。",
  },
  {
    title: "你的权利",
    body: "你可以在「我的」里修改姓名与手机号。需要删除账号或数据，请联系校园失物招领管理员。",
  },
]

export default function PrivacyPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5">
      <p className="text-sm text-muted-foreground">
        我们会尽量少收集、只用于找回失物。
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
