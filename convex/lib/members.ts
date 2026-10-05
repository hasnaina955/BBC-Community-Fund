import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { assertMonth, assertYear } from "./money"

/**
 * The one place a `members` row is written.
 *
 * `members.createMember` and the CSV import both call this, for the reason
 * `imports.ts` documents at length about money: a second writer of the same row
 * drifts, and the drift is invisible until it matters. The rules here are small
 * but not decorative —
 *
 *   - the name is trimmed and held to the same two-character floor;
 *   - the email is lowercased, because the member portal claims a record by an
 *     *exact* match on `members.email` (see `portal.claim`), so
 *     `Ayesha@Example.org` and `ayesha@example.org` would be two different
 *     people to the claim path;
 *   - `isActive` and `createdAt` are set here, so no caller can forget them.
 *
 * Audit rows are deliberately *not* written here. A treasurer adding one member
 * and an import adding two hundred are not the same event in the log: the first
 * gets a row per member and the second gets one row for the batch, and only the
 * caller knows which of the two it is.
 */
export interface NewMember {
  name: string
  phone?: string
  email?: string
  relation?: string
  joinedYear: number
  joinedMonth: number
}

export async function insertMember(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  input: NewMember,
): Promise<Id<"members">> {
  const name = input.name.trim()
  if (name.length < 2) throw new Error("Member name must be at least 2 characters")
  assertYear(input.joinedYear)
  assertMonth(input.joinedMonth)

  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error("That email address does not look right")
  }

  return ctx.db.insert("members", {
    orgId,
    name,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    relation: input.relation?.trim() || undefined,
    joinedYear: input.joinedYear,
    joinedMonth: input.joinedMonth,
    isActive: true,
    createdAt: Date.now(),
  })
}
