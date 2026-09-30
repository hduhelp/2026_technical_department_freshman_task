"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SearchIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { toItemsHref, type ItemsQuery } from "@/lib/items-url"

/**
 * 列表页唯一带 JS 的控件。
 * 输入停顿 300ms 后只改 URL，数据仍由服务端重新渲染，不维护客户端数据副本。
 * form 保留 GET 提交，所以禁用 JS 时按回车一样能用。
 */
export function SearchForm({ query }: { query: ItemsQuery }) {
  const router = useRouter()
  const [value, setValue] = useState(query.q)
  const [pending, startTransition] = useTransition()
  const submitted = useRef(query.q)

  useEffect(() => {
    if (value === submitted.current) return
    const timer = window.setTimeout(() => {
      submitted.current = value
      startTransition(() => {
        router.replace(toItemsHref({ q: value, page: 1 }, query))
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [value, query, router])

  return (
    <form
      action="/items"
      method="get"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        submitted.current = value
        startTransition(() => {
          router.replace(toItemsHref({ q: value, page: 1 }, query))
        })
      }}
    >
      {query.kind ? (
        <input type="hidden" name="kind" value={query.kind} />
      ) : null}
      {query.includeResolved ? (
        <input type="hidden" name="resolved" value="1" />
      ) : null}
      {query.mine ? <input type="hidden" name="mine" value="1" /> : null}

      <InputGroup className="h-11 bg-background">
        <InputGroupAddon align="inline-start">
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="搜索物品、描述或地点"
          aria-label="搜索帖子"
          enterKeyHint="search"
        />
        {pending ? (
          <InputGroupAddon align="inline-end">
            <Spinner />
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  )
}
