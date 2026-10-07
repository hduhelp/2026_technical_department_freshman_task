"use client"

import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { TurnstileWidget } from "@/components/auth/turnstile-widget"
import { toast } from "@/components/ui/toast"
import { publicEnv } from "@/lib/public-env"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { signUp, type AuthState } from "../actions"

const initialState: AuthState = {}

function toErrors(messages?: string[]) {
  return messages?.map((message) => ({ message }))
}

export function SignUpForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState)
  // 受控输入：React 19 在 action 结束后会 reset 表单，否则用户已填内容会被清空
  const [realName, setRealName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  // 没配 sitekey 时（本地/测试）整块人机校验都不存在，表单也不该被它挡住
  const captchaEnabled = publicEnv.turnstileSiteKey !== ""
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  useEffect(() => {
    if (state.formError) toast.add({ type: "error", title: state.formError })
  }, [state])

  const nameInvalid = Boolean(state.fieldErrors?.realName)
  const phoneInvalid = Boolean(state.fieldErrors?.phone)
  const passwordInvalid = Boolean(state.fieldErrors?.password)
  const confirmInvalid = Boolean(state.fieldErrors?.confirmPassword)
  const agreeInvalid = Boolean(state.fieldErrors?.agree)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={nextPath} />

      <Field data-invalid={nameInvalid}>
        <FieldLabel htmlFor="realName">真实姓名</FieldLabel>
        <Input
          id="realName"
          name="realName"
          autoComplete="name"
          placeholder="例如 张三"
          aria-invalid={nameInvalid}
          value={realName}
          onChange={(event) => setRealName(event.target.value)}
          required
        />
        <FieldDescription>线下核对身份用，不会公开展示。</FieldDescription>
        <FieldError errors={toErrors(state.fieldErrors?.realName)} />
      </Field>

      <Field data-invalid={phoneInvalid}>
        <FieldLabel htmlFor="phone">手机号</FieldLabel>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="11 位手机号"
          aria-invalid={phoneInvalid}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        <FieldDescription>
          手机号就是登录账号；只对拾主可见，用来联系你认领失物。
        </FieldDescription>
        <FieldError errors={toErrors(state.fieldErrors?.phone)} />
      </Field>

      <Field data-invalid={passwordInvalid}>
        <FieldLabel htmlFor="password">密码</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="至少 6 位"
          aria-invalid={passwordInvalid}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <FieldError errors={toErrors(state.fieldErrors?.password)} />
      </Field>

      <Field data-invalid={confirmInvalid}>
        <FieldLabel htmlFor="confirmPassword">确认密码</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="再输入一次密码"
          aria-invalid={confirmInvalid}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
        <FieldError errors={toErrors(state.fieldErrors?.confirmPassword)} />
      </Field>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="agree"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          aria-invalid={agreeInvalid}
        />
        <span>
          我已阅读并同意
          <Link
            href="/terms"
            target="_blank"
            className="mx-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
          >
            《服务条款》
          </Link>
          与
          <Link
            href="/privacy"
            target="_blank"
            className="mx-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
          >
            《隐私政策》
          </Link>
        </span>
      </label>
      {agreeInvalid ? (
        <p className="text-xs text-destructive">
          {state.fieldErrors?.agree?.[0]}
        </p>
      ) : null}

      {captchaEnabled ? (
        <>
          {/* state 每次动作结束都是新引用 → 令牌被消费掉后自动换一张 */}
          <TurnstileWidget onToken={setCaptchaToken} resetSignal={state} />
          <input type="hidden" name="captchaToken" value={captchaToken ?? ""} />
        </>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full text-base"
        disabled={pending || (captchaEnabled && captchaToken === null)}
      >
        {pending ? "注册中…" : "注册并登录"}
      </Button>
    </form>
  )
}
