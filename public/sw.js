/*
 * CommunityFund service worker.
 *
 * ## The one rule
 *
 * **Never cache an API response.** Every figure a member sees — their balance,
 * their receipts, what they owe — comes from Convex over a websocket or an
 * authenticated POST. Caching any of it would mean showing somebody a balance
 * that is no longer true, and a member told "you owe nothing" from a stale
 * response has been told something false. Financial data is therefore always
 * fetched from the network, always fresh, and fails visibly when offline.
 *
 * That leaves the shell: the HTML, the JS, the CSS, the icons. Caching those is
 * the difference between the app opening on a weak connection at the collection
 * table and the browser showing its own error page — which a member has no way
 * to tell apart from the app being broken.
 *
 * ## Why this is deliberately boring
 *
 *   - Navigations are **network-first**. A member who has just paid wants today's
 *     figure, and an HTML shell is cheap to revalidate.
 *   - Static assets are **stale-while-revalidate**, because a hashed bundle
 *     cannot change under a URL that is already cached.
 *   - Everything is **same-origin only**. In this app Convex may be proxied
 *     through the dev server, and it is a different origin in production; neither
 *     is cached, and neither is allowed to pass through the caches at all.
 *   - A failed navigation falls back to the cached shell, which is a real page
 *     that then shows the member a proper "you are offline" state rather than a
 *     browser error.
 *
 * There is no versioned cache to purge because the strategies above are
 * self-correcting: a new bundle is fetched on the next load and the cache
 * naturally holds only the latest per URL.
 */

const CACHE = "cf-shell-v1"
const SHELL_URL = "/index.html"

/** Requests that must go straight to the network, every time. */
function isPrivate(url) {
  if (url.origin !== self.location.origin) return true // a different deployment
  if (url.pathname.startsWith("/__convex")) return true // the dev proxy
  if (url.pathname.startsWith("/api/")) return true
  if (url.pathname.startsWith("/convex/api")) return true
  return false
}

function isAsset(url) {
  return ["script", "style", "font", "image", "worker"].includes(url.destination)
}

self.addEventListener("install", (event) => {
  // Take over promptly: a member who has just installed wants the app that was
  // just installed, not the one from the last session.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from earlier versions of this file.
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)

  // The rule. Checked before anything else so no future strategy can
  // accidentally cache a balance.
  if (isPrivate(url)) return

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put(SHELL_URL, fresh.clone())
          return fresh
        } catch {
          // Offline. The cached shell loads, and the app renders its own
          // "cannot reach the server" state — which is a far better thing to
          // show than a browser error page with no way forward.
          const cached = await caches.match(SHELL_URL)
          return (
            cached ??
            new Response(
              "<!doctype html><meta charset=utf-8>" +
                "<title>Offline</title>" +
                "<body style='font:16px system-ui;padding:2rem'>" +
                "<h1>You are offline</h1>" +
                "<p>Your balance needs a connection to load. " +
                "Open this page again once you have signal.</p>",
              { status: 503, headers: { "Content-Type": "text/html" } },
            )
          )
        }
      })(),
    )
    return
  }

  if (!isAsset(url)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request)

      // Serve what we have, refresh in the background. Hashed asset URLs mean a
      // hit is almost always current; the revalidation only matters for the
      // un-hashed ones like the manifest and the icons.
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => null)

      return cached ?? (await network) ?? new Response("", { status: 504 })
    })(),
  )
})
