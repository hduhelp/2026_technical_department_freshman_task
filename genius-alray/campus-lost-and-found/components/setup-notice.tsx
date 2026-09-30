import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MISSING_CONFIG_MESSAGE } from "@/lib/env"

/** 没配 .env.local 时的友好提示，避免直接白屏。 */
export function SetupNotice() {
  return (
    <div className="flex flex-1 items-center p-4">
      <Alert>
        <AlertTitle>还差一步配置</AlertTitle>
        <AlertDescription>{MISSING_CONFIG_MESSAGE}</AlertDescription>
      </Alert>
    </div>
  )
}
