import { describe, expect, it } from "vitest"
import {
  photoAdviceSchema,
  pickupSchema,
  profileSchema,
  publishItemSchema,
  signUpSchema,
  phoneSchema,
} from "@/lib/validation/schemas"

const ITEM_ID = "11111111-1111-4111-8111-111111111111"

/** 第 9 轮起照片用 upload id（uuid）引用，不再传存储路径 */
function uploadId(seed: number): string {
  return "22222222-2222-4222-8222-" + String(seed).padStart(12, "0")
}

function publishInput(overrides: Record<string, unknown> = {}) {
  return {
    uploadIds: [uploadId(1)],
    title: "黑色钱包",
    description: "皮质钱包，内有若干卡片。",
    custody: "kept",
    contact: "13800138000",
    locationLabel: "",
    lat: null,
    lng: null,
    ...overrides,
  }
}

function issuePaths(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return []
  const error = result.error as {
    issues: Array<{ path: Array<string | number> }>
  }
  return error.issues.map((issue) => issue.path.join("."))
}

describe("publishItemSchema：联系方式与位置分支", () => {
  it("代为保管：没有联系方式必须失败（path=contact）", () => {
    const result = publishItemSchema.safeParse(publishInput({ contact: "" }))
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain("contact")
  })

  it("代为保管：联系方式 4 字失败、5 字通过", () => {
    expect(
      publishItemSchema.safeParse(publishInput({ contact: "1234" })).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(publishInput({ contact: "12345" })).success
    ).toBe(true)
  })

  it("留在原地：位置详情为空必须失败（path=locationLabel）", () => {
    const result = publishItemSchema.safeParse(
      publishInput({
        custody: "in_place",
        lat: null,
        lng: null,
        locationLabel: "",
      })
    )
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain("locationLabel")
  })

  it("留在原地：位置详情必填，只有坐标不算填了", () => {
    expect(
      publishItemSchema.safeParse(
        publishInput({ custody: "in_place", locationLabel: "图书馆 3 楼" })
      ).success
    ).toBe(true)

    const onlyCoords = publishItemSchema.safeParse(
      publishInput({ custody: "in_place", lat: 31.23, lng: 121.47 })
    )
    expect(onlyCoords.success).toBe(false)
    expect(issuePaths(onlyCoords)).toContain("locationLabel")
  })

  it("照片数量 1-5：0 张与 6 张失败，1 张与 5 张通过", () => {
    expect(
      publishItemSchema.safeParse(publishInput({ uploadIds: [] })).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(
        publishInput({ uploadIds: [1, 2, 3, 4, 5, 6].map(uploadId) })
      ).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(publishInput({ uploadIds: [uploadId(1)] }))
        .success
    ).toBe(true)
    expect(
      publishItemSchema.safeParse(
        publishInput({ uploadIds: [1, 2, 3, 4, 5].map(uploadId) })
      ).success
    ).toBe(true)
  })

  it("照片必须是 upload id：路径或任意字符串一律拒绝", () => {
    for (const bad of ["u1/a.jpg", "9f1/x.jpg", "", "not-a-uuid"]) {
      expect(
        publishItemSchema.safeParse(publishInput({ uploadIds: [bad] })).success,
        bad
      ).toBe(false)
    }
  })

  it("名称 1-60 字、描述 1-600 字", () => {
    expect(
      publishItemSchema.safeParse(publishInput({ title: "" })).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(publishInput({ title: "x".repeat(61) }))
        .success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(publishInput({ title: "x".repeat(60) }))
        .success
    ).toBe(true)
    expect(
      publishItemSchema.safeParse(publishInput({ description: "" })).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(
        publishInput({ description: "x".repeat(601) })
      ).success
    ).toBe(false)
    expect(
      publishItemSchema.safeParse(
        publishInput({ description: "x".repeat(600) })
      ).success
    ).toBe(true)
  })

  it("custody 非法值失败", () => {
    expect(
      publishItemSchema.safeParse(publishInput({ custody: "somewhere" }))
        .success
    ).toBe(false)
  })
})

describe("pickupSchema：只提交物品 id", () => {
  it("合法 uuid 通过", () => {
    expect(pickupSchema.safeParse({ itemId: ITEM_ID }).success).toBe(true)
  })

  it("itemId 必须是 uuid，且必填", () => {
    expect(pickupSchema.safeParse({ itemId: "abc" }).success).toBe(false)
    expect(pickupSchema.safeParse({}).success).toBe(false)
  })

  it("客户端塞进来的姓名/手机号会被丢掉（实名由服务端从 profiles 取）", () => {
    const parsed = pickupSchema.safeParse({
      itemId: ITEM_ID,
      name: "张三",
      phone: "13800138000",
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ itemId: ITEM_ID })
  })
})

describe("账号与上传元数据", () => {
  it("手机号即账号：只接受 11 位大陆手机号", () => {
    expect(phoneSchema.parse(" 13800138000 ")).toBe("13800138000")
    for (const bad of ["1380013800", "23800138000", "1380013800a", ""]) {
      expect(phoneSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it("注册需要姓名 + 手机号 + 两次一致密码 + 勾选同意", () => {
    const valid = {
      realName: "张三",
      phone: "13800138000",
      password: "abcdef",
      confirmPassword: "abcdef",
      agree: true,
    }
    expect(signUpSchema.safeParse(valid).success).toBe(true)
    expect(
      signUpSchema.safeParse({ ...valid, confirmPassword: "abcdefg" }).success
    ).toBe(false)
    expect(signUpSchema.safeParse({ ...valid, agree: false }).success).toBe(
      false
    )
    expect(signUpSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(
      false
    )
  })
})

describe("第 5 轮：profileSchema 与 photoAdviceSchema", () => {
  it("profileSchema：姓名 1 字/21 字失败，2 字与 20 字通过", () => {
    const base = { phone: "13800138000" }
    expect(profileSchema.safeParse({ ...base, realName: "张" }).success).toBe(
      false
    )
    expect(
      profileSchema.safeParse({ ...base, realName: "张".repeat(21) }).success
    ).toBe(false)
    expect(profileSchema.safeParse({ ...base, realName: "张三" }).success).toBe(
      true
    )
    expect(
      profileSchema.safeParse({ ...base, realName: "张".repeat(20) }).success
    ).toBe(true)
  })

  it("profileSchema：手机号沿用注册那套严格规则（11 位大陆手机号）", () => {
    const base = { realName: "张三" }
    for (const phone of [
      "1380013800a",
      "12345",
      "1".repeat(21),
      "电话13800138000",
      "+86 138-0013-8000",
    ]) {
      expect(profileSchema.safeParse({ ...base, phone }).success, phone).toBe(
        false
      )
    }
    expect(
      profileSchema.safeParse({ ...base, phone: " 13800138000 " }).success
    ).toBe(true)
  })

  it("profileSchema：姓名会 trim 后校验", () => {
    const result = profileSchema.safeParse({
      realName: "  张三  ",
      phone: "13800138000",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.realName).toBe("张三")
  })

  it("photoAdviceSchema：verdict 只能是 ok/retake，reason 1-30 字", () => {
    expect(
      photoAdviceSchema.safeParse({ verdict: "ok", reason: "可以用" }).success
    ).toBe(true)
    expect(
      photoAdviceSchema.safeParse({ verdict: "retake", reason: "再拍一张" })
        .success
    ).toBe(true)
    expect(
      photoAdviceSchema.safeParse({ verdict: "maybe", reason: "x" }).success
    ).toBe(false)
    expect(
      photoAdviceSchema.safeParse({ verdict: "ok", reason: "" }).success
    ).toBe(false)
    expect(
      photoAdviceSchema.safeParse({ verdict: "ok", reason: "x".repeat(31) })
        .success
    ).toBe(false)
    // AI SDK 的 schema 不再用 boolean 字段（StepFun 对枚举更稳）
    expect(photoAdviceSchema.safeParse({ ok: true, reason: "x" }).success).toBe(
      false
    )
  })
})
