import { useEffect, useState } from "react"

/**
 * Making the member portal installable, and keeping it usable on a bad network.
 *
 * ## Why the portal is the PWA, not the console
 *
 * The committee console is a desk tool: a treasurer on a laptop with a connection.
 * The portal is the opposite — a member standing in a queue at the collection
 * table, on a phone, possibly on mobile data. So the service worker is
 * conservative on purpose:
 *
 *   - **Never cache an API response.** Convex queries are the balances. A stale
 *     balance is worse than no balance: a member who is shown "you owe nothing"
 *     from a cached response has been told something false. Authenticated reads go
 *     to the network, always, and fail loudly if it is not there.
 *   - **Cache the shell.** The HTML, the JS, the CSS and the icons, so the app
 *     opens at all when the network is slow or gone. Without this a member on a
 *     weak connection gets a browser error page, which is indistinguishable from
 *     the portal being broken.
 *
 * ## Why registration is production-only
 *
 * A service worker caches aggressively and survives reloads. During development
 * that means editing a component and getting the previous build, which costs more
 * time than it could ever save. It is registered only when `import.meta.env.PROD`
 * is true, so `bun run dev` behaves like every other Vite app.
 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

  // `load`, not `DOMContentLoaded`: registering during the initial parse competes
  // with the bundle the member is actually waiting for.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration costs the offline shell and nothing else. It must
      // not be allowed to surface as an error, because nothing is broken.
    })
  })
}

export interface InstallPrompt {
  /** True when the browser has offered an install and we are holding the event. */
  canInstall: boolean
  /** True once the app is running as an installed PWA. */
  installed: boolean
  install: () => void
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * The install button, when the browser offers one.
 *
 * `beforeinstallprompt` is Chromium-only and fires once, early, so the event has
 * to be caught and held — by the time the member reaches the bottom of a balance
 * screen it has long since gone. `appinstalled` then confirms the outcome.
 *
 * Returns `installed: true` for a browser with no install concept at all (iOS
 * Safari before 16.4, Firefox) so the caller can hide the button rather than
 * offer one that does nothing.
 */
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    // Already installed: standalone display mode, or added to the home screen.
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    ) {
      setInstalled(true)
      return
    }

    const onPrompt = (event: Event) => {
      // Chromium's default is a mini-infobar the member will dismiss without
      // reading. Suppressing it is what lets the portal ask properly, in context,
      // once they have seen what they would be installing.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }

    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  return {
    canInstall: deferred !== null,
    installed,
    install: () => {
      if (!deferred) return
      void deferred.prompt()
      setDeferred(null)
    },
  }
}
