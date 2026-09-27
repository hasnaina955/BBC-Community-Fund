import { useCallback, useEffect, useState } from "react"

/**
 * The light/dark theme, in one place.
 *
 * This used to be a `useTheme` hook written twice — once in the console shell
 * and once in the portal shell — and the two copies had drifted. The console
 * copy persisted the choice; **the portal copy did not**, so a member who
 * tapped the sun/moon button in their portal and then reloaded the page got
 * the old theme back. That is the kind of bug that reads as the app being
 * broken rather than as a missing `localStorage.setItem`, and it was invisible
 * because the console shell is never mounted when a member is signed in.
 *
 * One copy fixes it, and the two shells can no longer disagree.
 *
 * The initial value reads the class off `<html>` rather than from storage,
 * because `index.html` applies the stored theme in an inline script *before*
 * first paint to avoid a flash. Reading storage here instead would be a second
 * source of truth that can disagree with the one that already ran — and on the
 * very first paint after a toggle, it does.
 */

const STORAGE_KEY = "cf-theme"

function currentTheme(): boolean {
  return document.documentElement.classList.contains("dark")
}

function readStored(): boolean | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "dark") return true
    if (stored === "light") return false
  } catch {
    // Private browsing, or storage disabled. The toggle still works for this
    // session; it just will not survive a reload.
  }
  return null
}

export function useTheme() {
  const [dark, setDark] = useState<boolean>(currentTheme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#0e1a1f" : "#fbfaf7")
    try {
      localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light")
    } catch {
      // See readStored — nothing to do, and nothing worth breaking the app over.
    }
  }, [dark])

  const toggle = useCallback(() => setDark((d) => !d), [])

  return { dark, toggle, setDark }
}

/**
 * The theme the visitor has not chosen yet.
 *
 * Only used to decide whether the OS preference is the better default on a
 * first visit, which is a nicer first impression than always opening in light.
 * Once a person touches the toggle, their stored choice wins and this is never
 * consulted again.
 */
export function preferredTheme(): boolean | null {
  const stored = readStored()
  if (stored !== null) return stored
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return null
  }
}
