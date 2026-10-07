"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { saveProfileAction, type ProfileState } from "../actions"

const initialState: ProfileState = {}

function toErrors(messages?: string[]) {
  return messages?.map((message) => ({ message }))
}

/** 真实姓名 + 手机号：认领时会自动预填，所以只问这两件事。 */
export function ProfileForm({
  defaultName,
  defaultPhone,
  nextPath = null,
}: {
  defaultName: string
  defaultPhone: string
  /** 从认领流程进来时保存后回到这里（例如 /items/xxx） */
  nextPath?: string | null
}) {
  const [state, formAction, pending] = useActionState(
    saveProfileAction,
    initialState
  )
  const [name, setName] = useState(defaultName)
  const [phone, setPhone] = useState(defaultPhone)

  useEffect(() => {
    // 保存成功由服务端 redirect 回来源页（不再在客户端 replace）
    if (state.formError) toast.add({ type: "error", title: state.formError })
  }, [state])

  const nameInvalid = Boolean(state.fieldErrors?.realName)
  const phoneInvalid = Boolean(state.fieldErrors?.phone)

  return (
    <form action={formAction} className="my-auto flex flex-col gap-5">
      <input type="hidden" name="next" value={nextPath ?? "/me"} />

      <Field data-invalid={nameInvalid}>
        <FieldLabel htmlFor="profile-name">真实姓名</FieldLabel>
        <Input
          id="profile-name"
          name="realName"
          data-testid="profile-name"
          autoComplete="name"
          placeholder="给拾主核对用"
          aria-invalid={nameInvalid}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <FieldError errors={toErrors(state.fieldErrors?.realName)} />
      </Field>

      <Field data-invalid={phoneInvalid}>
        <FieldLabel htmlFor="profile-phone">手机号</FieldLabel>
        <Input
          id="profile-phone"
          name="phone"
          data-testid="profile-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="给拾主核对用"
          aria-invalid={phoneInvalid}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        <FieldError errors={toErrors(state.fieldErrors?.phone)} />
      </Field>

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full text-base"
        data-testid="profile-submit"
        disabled={pending}
      >
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  )
}
