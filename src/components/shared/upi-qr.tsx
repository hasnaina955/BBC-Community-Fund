import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { cn } from "@/lib/utils"

/**
 * A UPI QR code, drawn in the browser.
 *
 * ## The rule this component exists to keep
 *
 * **A QR code here is a printed instruction, not a transaction.** It encodes a
 * `upi://pay` URI that the member's own UPI app resolves. The application never
 * learns that a payment happened, never confirms one, and never marks a
 * contribution paid. The committee decided that this product keeps records
 * rather than taking money (docs/M4-PLAN.md §1), and this is the visible face of
 * that decision: a member scans, pays, and then tells the treasurer through the
 * existing claim flow.
 *
 * That is why `upiIntentUri` is amountless. A QR carrying an amount would look
 * like a checkout and imply the app knows what the member owes and whether they
 * paid. It knows neither. It knows the account.
 *
 * ## Drawn locally, never by a service
 *
 * `qrcode` renders to a canvas in the page. No request leaves the browser, and
 * the VPA and IFSC on this component are never sent anywhere — which matters,
 * because those two strings are the address money arrives at. Handing them to a
 * third-party QR endpoint to get back a picture would hand over the payment
 * account itself.
 */
export function UpiQr({
  value,
  /** Rendered size in pixels. The QR is square; the border is part of it. */
  size = 220,
  className,
  testId,
}: {
  value: string
  size?: number
  className?: string
  testId?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    // `toCanvas` is async because the module can fall back to a worker-backed
    // path for large payloads. A UPI URI is ~60 characters and never is, but the
    // API is promise-returning either way, and a rejection has to be caught or
    // it surfaces as an unhandled promise in the console of a treasurer's
    // browser.
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 2,
      // Nearest-neighbour would give hard edges that alias badly when printed
      // or scaled; the default smoothing keeps it legible at any size.
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(() => {
        if (!cancelled) setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [value, size])

  if (failed) {
    // Never render a half-drawn or blank square. A member who scans a blank
    // square gets a dead end with no explanation; a member who is told to read
    // the VPA can still pay.
    return (
      <div
        className={cn(
          "flex items-center justify-center border border-dashed p-4 text-center text-xs text-muted-foreground",
          className,
        )}
        style={{ width: size, minHeight: size }}
        data-testid={testId}
      >
        The QR code could not be drawn. Use the UPI address printed beside it.
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={cn("rounded-md bg-white", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label="UPI QR code"
      data-testid={testId}
      /*
       * What was actually encoded, in the DOM.
       *
       * This is asserted in the visual suite — specifically that it carries no
       * `am=` and no `tr=`. Those are the two parameters that would turn a
       * printed instruction into something that looks like a checkout, and a
       * comment saying "don't add an amount" is worth considerably less than a
       * failing test. A VPA is not a secret (it is printed on a sign), so
       * putting the payload here leaks nothing that is not already public.
       */
      data-upi-uri={value}
    />
  )
}
