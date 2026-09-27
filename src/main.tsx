import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "@/App"
import { ConvexProvider } from "@/lib/convex"
import { DataProvider } from "@/data/store"
import { registerServiceWorker } from "@/lib/pwa"
import "./index.css"

// Only in a production build — see `registerServiceWorker`. A dev-time worker
// would serve yesterday's bundle and make every edit look like it did nothing.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider>
      <BrowserRouter>
        <DataProvider>
          <App />
        </DataProvider>
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
)
