import { z } from "zod"

/** 真实姓名（注册与「我的信息」共用同一套规则） */
export const realNameSchema = z
  .string()
  .trim()
  .min(2, "请填写真实姓名（2-20 字）")
  .max(20, "姓名最多 20 字")

/** 手机号即账号：只接受中国大陆 11 位手机号 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^1[3-9][0-9]{9}$/, "请填写 11 位手机号")

export const passwordSchema = z.string().min(6, "密码至少 6 位").max(72)

/** 注册：真实姓名 + 手机号 + 密码，且必须勾选同意条款 */
export const signUpSchema = z
  .object({
    realName: realNameSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    agree: z
      .boolean()
      .refine((v) => v, "请先阅读并同意《隐私政策》与《服务条款》"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  })

/** 登录：手机号 + 密码（不做验证码） */
export const signInSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "请输入密码"),
})

export const custodyKindSchema = z.enum(["kept", "in_place"])

/** 发布招领：拍照 → AI 名称/描述（可改）→ 电话或位置 */
export const publishItemSchema = z
  .object({
    /** 上传登记 id（image_uploads.id）：客户端拿不到、也不需要存储路径 */
    uploadIds: z
      .array(z.string().uuid("照片参数不合法"))
      .min(1, "请至少上传一张照片")
      .max(5, "最多 5 张照片"),
    title: z.string().trim().min(1, "请填写物品名称").max(60, "名称最多 60 字"),
    description: z
      .string()
      .trim()
      .min(1, "请填写物品描述")
      .max(600, "描述最多 600 字"),
    custody: custodyKindSchema,
    contact: z.string().trim().max(100).optional().default(""),
    locationLabel: z.string().trim().max(200).optional().default(""),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.custody === "kept") {
      if (v.contact.length < 5) {
        ctx.addIssue({
          code: "custom",
          path: ["contact"],
          message: "代为保管需要填写联系方式（至少 5 个字符）",
        })
      }
      return
    }
    // 位置详情必填：只有坐标的话失主还是不知道东西在哪，而且经纬度不该展示给用户
    if (v.locationLabel.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["locationLabel"],
        message: "请填写位置详情",
      })
    }
  })

/**
 * AI 给的照片建议（generateObject 用）。
 * 刻意用字符串枚举而不是 boolean：StepFun 的 json_schema 对枚举最稳，
 * 历史上 json_object / 自由键 / 嵌套结构都翻过车（见 docs/REQUIREMENTS.md §5.1）。
 */
export const photoAdviceSchema = z.object({
  verdict: z.enum(["ok", "retake"]),
  reason: z.string().min(1).max(30),
})

/** 「我的信息」：真实姓名 + 手机号（与注册同一套规则） */
export const profileSchema = z.object({
  realName: realNameSchema,
  phone: phoneSchema,
})

/**
 * 发布草稿：**允许不完整**（草稿本来就可能只填了一半），所以不复用 publishItemSchema
 * 的那套 superRefine（它要求 kept 必须有联系方式、in_place 必须有位置详情）。
 */
export const publishDraftSchema = z.object({
  title: z.string().trim().max(60, "名称最多 60 字"),
  description: z.string().trim().max(600, "描述最多 600 字"),
  custody: custodyKindSchema.nullable(),
  contact: z.string().trim().max(100, "联系方式最多 100 字"),
  locationLabel: z.string().trim().max(200, "位置详情最多 200 字"),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
})

/**
 * 领取：只提交物品 id。
 * 姓名与手机号由 create_pickup 在服务端从 profiles 取 —— 客户端提交的实名信息
 * 一律不算数（否则「实名认领」只是浏览器里的君子协定）。
 */
export const pickupSchema = z.object({
  itemId: z.string().uuid(),
})
