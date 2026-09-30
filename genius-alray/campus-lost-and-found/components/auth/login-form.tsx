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
import { loginAction } from "@/lib/actions/auth"
import { EMPTY_AUTH_STATE } from "@/lib/actions/state"

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, EMPTY_AUTH_STATE)

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
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors.username)}
            required
          />
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
            autoComplete="current-password"
            enterKeyHint="go"
            className="h-11"
            aria-invalid={Boolean(state.fieldErrors.password)}
            required
          />
          {state.fieldErrors.password ? (
            <FieldError>{state.fieldErrors.password}</FieldError>
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
          登录
        </Button>

        <FieldDescription className="text-center">
          还没有账号？{" "}
          <Link
            href={"/register?next=" + encodeURIComponent(next)}
            className="underline underline-offset-4"
          >
            去注册
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  )
}
