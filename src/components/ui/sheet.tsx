import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A panel that slides in from the edge of the screen.
 *
 * Built on the Radix dialog rather than by hand, so it gets the focus trap, the
 * Escape key, the `aria-modal` semantics and the scroll lock that a keyboard
 * user and a screen reader both depend on. The console needs this for one
 * specific reason: before it existed, **the console had no navigation at all
 * below the `lg` breakpoint.** The sidebar is `hidden lg:flex` and the phone
 * header carried the logo, the theme toggle and a sign-out button, so a
 * treasurer who opened the app on a phone could see the dashboard and could not
 * reach a single other screen. Twelve of the thirteen routes were unreachable
 * from a phone.
 *
 * `side="left"` is the only side this app needs; adding the other three would be
 * a component library's worth of API for one call site.
 */

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = "SheetOverlay"

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex h-full w-[17rem] max-w-[85vw] flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
        <X className="size-4" />
        <span className="sr-only">Close navigation</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = "SheetContent"

export { Sheet, SheetTrigger, SheetClose, SheetContent }
