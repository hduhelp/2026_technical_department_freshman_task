"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { registerAction } from "@/lib/actions/auth"
import { EMPTY_AUTH_STATE } from "@/lib/actions/state"
import { PASSWORD_MIN, USERNAME_MAX } from "@/lib/validation"

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    registerAction,
    EMPTY_AUTH_STATE
  )

  return (
    <form action={action} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors.username)}>
          <FieldLabel htmlFor="username">用户名</FieldLabel>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            enterKeyHint="next"
            maxLength={USERNAME_MAX}
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors.username)}
            required
          />
          <FieldDescription>
            中文、字母、数字或下划线，2 到 {USERNAME_MAX} 个字符。
          </FieldDescription>
          {state.fieldErrors.username ? (
            <FieldError>{state.fieldErrors.username}</FieldError>
          ) : null}
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors.password)}>
          <FieldLabel htmlFor="password">密码</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="next"
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors.password)}
            required
          />
          <FieldDescription>至少 {PASSWORD_MIN} 位。</FieldDescription>
          {state.fieldErrors.password ? (
            <FieldError>{state.fieldErrors.password}</FieldError>
          ) : null}
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors.confirm)}>
          <FieldLabel htmlFor="confirm">确认密码</FieldLabel>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            enterKeyHint="go"
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors.confirm)}
            required
          />
          {state.fieldErrors.confirm ? (
            <FieldError>{state.fieldErrors.confirm}</FieldError>
          ) : null}
        </Field>

        <input type="hidden" name="next" value={next} />

        {state.formError ? (
          <p role="alert" className="text-sm text-destructive">
            {state.formError}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full"
          disabled={pending}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          注册并登录
        </Button>

        <FieldDescription className="text-center">
          已经有账号了？{" "}
          <Link
            href={"/login?next=" + encodeURIComponent(next)}
            className="underline underline-offset-4"
          >
            去登录
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  )
}
