"use client"

import { useActionState, useEffect, useState } from "react"
import { TurnstileWidget } from "@/components/auth/turnstile-widget"
import { toast } from "@/components/ui/toast"
import { publicEnv } from "@/lib/public-env"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { signIn, type AuthState } from "../actions"

const initialState: AuthState = {}

function toErrors(messages?: string[]) {
  return messages?.map((message) => ({ message }))
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState)
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  // 没配 sitekey 时（本地/测试）整块人机校验都不存在，表单也不该被它挡住
  const captchaEnabled = publicEnv.turnstileSiteKey !== ""
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  useEffect(() => {
    if (state.formError) toast.add({ type: "error", title: state.formError })
  }, [state])

  const phoneInvalid = Boolean(state.fieldErrors?.phone)
  const passwordInvalid = Boolean(state.fieldErrors?.password)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={nextPath} />

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
        <FieldError errors={toErrors(state.fieldErrors?.phone)} />
      </Field>

      <Field data-invalid={passwordInvalid}>
        <FieldLabel htmlFor="password">密码</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="请输入密码"
          aria-invalid={passwordInvalid}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <FieldError errors={toErrors(state.fieldErrors?.password)} />
      </Field>

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
        {pending ? "登录中…" : "登录"}
      </Button>
    </form>
  )
}
