import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Freebuff requires HMR to stay disabled. Do not enable it here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: false,
    // The local Convex backend listens on loopback only, so a browser that
    // loaded the app from anywhere else — the hosted preview proxy, a phone on
    // the LAN, another machine — cannot open a websocket to it, and is blocked
    // outright by Chrome's local-network checks. It gets a blank app that hangs
    // on "Signing in…" forever, because `signIn()` never resolves when the
    // client's socket never opens.
    //
    // Proxying Convex through this dev server means the browser only ever
    // talks to its own origin, so the app works the same whether it was opened
    // on 127.0.0.1 or through a tunnel. `src/lib/convex.tsx` picks the proxied
    // path automatically when the page is not itself on loopback.
    //
    // The prefix must not collide with a real path in the project. `/convex`
    // does: `import { api } from "../convex/_generated/api"` is served by Vite
    // as `/convex/_generated/api.js`, so proxying that prefix hands the app's
    // own modules to the backend and the page comes up blank. `/__convex`
    // cannot collide with anything on disk.
    proxy: {
      "/__convex": {
        target: "http://127.0.0.1:3210",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__convex/, ""),
        ws: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
})
