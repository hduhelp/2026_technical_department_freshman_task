// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  InstallAppButton,
  PwaInstallProvider,
} from "@/components/pwa/install-prompt"

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

afterEach(cleanup)

function renderTree() {
  return render(
    <PwaInstallProvider>
      <InstallAppButton />
    </PwaInstallProvider>
  )
}

/** 临时换 navigator.userAgent（浏览器判定在每次渲染时读它） */
async function withUserAgent(ua: string, run: () => Promise<void>) {
  const own = Object.getOwnPropertyDescriptor(window.navigator, "userAgent")
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  })
  try {
    await run()
  } finally {
    if (own) Object.defineProperty(window.navigator, "userAgent", own)
    else
      Reflect.deleteProperty(
        window.navigator as unknown as Record<string, unknown>,
        "userAgent"
      )
  }
}

/** 造一个假的 beforeinstallprompt（真实事件只有 Chrome 在「可安装且未安装」时给） */
function fireInstallPrompt() {
  const prompt = vi.fn(async () => {})
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" }>
  }
  event.prompt = prompt
  event.userChoice = Promise.resolve({ outcome: "accepted" as const })
  act(() => {
    window.dispatchEvent(event)
  })
  return { event, prompt }
}

describe("安装应用按钮", () => {
  it("没有安装事件、也不是 iOS：按钮不出现（不留空位）", async () => {
    renderTree()
    await waitFor(() => expect(screen.queryByTestId("install-app")).toBeNull())
  })

  it("收到 beforeinstallprompt：拦截浏览器默认提示，按钮出现并调用原生安装弹窗", async () => {
    renderTree()

    const { event, prompt } = fireInstallPrompt()
    // 浏览器自己的安装提示被拦下 —— 装不装由用户点按钮决定
    expect(event.defaultPrevented).toBe(true)

    const button = await screen.findByTestId("install-app")
    expect(button).toHaveTextContent("安装应用")

    fireEvent.click(button)
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    // 事件只能用一次：点完按钮就该消失
    await waitFor(() => expect(screen.queryByTestId("install-app")).toBeNull())
  })

  it("收到 appinstalled：按钮消失", async () => {
    renderTree()
    fireInstallPrompt()
    await screen.findByTestId("install-app")

    act(() => {
      window.dispatchEvent(new Event("appinstalled"))
    })

    await waitFor(() => expect(screen.queryByTestId("install-app")).toBeNull())
  })

  it("iOS Safari 没有安装事件：按钮改成「分享 → 添加到主屏幕」指引", async () => {
    await withUserAgent(IPHONE_UA, async () => {
      renderTree()

      const button = await screen.findByTestId("install-app")
      fireEvent.click(button)

      expect(await screen.findByTestId("install-ios-dialog")).toHaveTextContent(
        "添加到主屏幕"
      )
    })
  })
})
