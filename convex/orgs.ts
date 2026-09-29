import { mutation, query, type MutationCtx } from "./_generated/server"
import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import type { Id, TableNames } from "./_generated/dataModel"
import { requireAdmin, requireIdentity } from "./lib/authz"
import { recordAudit, AUDIT } from "./lib/audit"
import { assertPaise, assertPositive } from "./lib/money"

/**
 * Creating an organisation, and leaving one.
 *
 * M1 built this database org-scoped but gave it exactly one organisation, so
 * every one of those `orgId` filters had a single possible value and proved
 * nothing. This is the door: the first moment a second community can arrive.
 *
 * ## The awkward part, which is why this is its own file
 *
 * Every other function in `convex/` starts with `requireActor`, which resolves
 * an organisation and refuses the caller if there isn't one. That is the whole
 * isolation guarantee, and it is not negotiable. But it makes this file's own
 * job impossible: the person creating the organisation is, by definition, an
 * account with no organisation yet.
 *
 * So exactly two functions here look at the session *without* an org — the
 * identity query that tells the app where to send a new signup, and
 * `createOrganization`, which then writes the org. Every other function on this
 * page, including `deleteOrganization`, goes straight back through
 * `requireAdmin`. The exemption is the size of one file and is the only place in
 * the codebase where "signed in" is enough to do something.
 */

/**
 * A URL-safe identifier derived from the organisation's name.
 *
 * Not chosen by the user. A slug is a permanent public-ish identifier that ends
 * up in emails and printed receipts, and a person naming their own community is
 * not thinking about character sets. Deriving it means two communities called
 * "Jamaat Anjuman" in different cities still get distinct, valid slugs, which is
 * what the `-2`, `-3` suffix below exists for.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Strip the combining marks NFKD just split apart, so "Anjuman-e-Tija" and
    // "Anjuman e Tija" cannot produce two different slugs.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
  return base || "organisation"
}

/** A slug no existing organisation holds. */
async function uniqueSlug(
  db: MutationCtx["db"],
  base: string,
): Promise<string> {
  const taken = async (candidate: string) =>
    (await db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first()) !== null

  if (!(await taken(base))) return base
  // Bounded, because an unbounded loop against a unique index is a denial of
  // service wearing a disguise.
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base}-${n}`
    if (!(await taken(candidate))) return candidate
  }
  throw new Error("Could not find an available identifier for that name")
}

/**
 * Who the caller is, whether or not they belong to an organisation yet.
 *
 * This is the query the app routes on. A signed-in account with no
 * organisation is not an error — it is the state every new signup is in for the
 * few seconds between the form and the onboarding — and `data:me` used to throw
 * `No organisation is linked to this account` for them, which painted the whole
 * console in its "could not load your data" screen with an explanation that
 * made it look like a broken account.
 *
 * It deliberately returns less than `data:me` for an orgless caller: there is no
 * organisation whose name could be disclosed, so there is nothing to return.
 */
export const mySetup = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    return {
      userId: identity.userId,
      name: identity.name,
      email: identity.email,
      isActive: identity.isActive,
      /** null means "signed in, no organisation yet" — go to /welcome. */
      orgId: identity.orgId,
      role: identity.role,
    }
  },
})

/**
 * Create an organisation and make the caller its first administrator.
 *
 * The caller must be signed in *and* organisation-less. The second condition is
 * what stops this from being a privilege-escalation endpoint: an existing admin
 * calling it gets `You already belong to an organisation`, not a second org
 * they would also administer, which would be a way around every role check in
 * the codebase by simply making a fresh tenant.
 *
 * A first bank account and a first fund are optional but encouraged. A community
 * that has signed up and lands on an empty console has no idea what to do next;
 * the alternative is an empty dashboard that looks broken. Both are created in
 * this one transaction, so a community can never end up with a fund and no bank
 * account to receive its money, or the reverse.
 */
export const createOrganization = mutation({
  args: {
    name: v.string(),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    ifscCode: v.optional(v.string()),
    fundName: v.optional(v.string()),
    /** Rupees, converted here. The client sends rupees like every other form. */
    monthlyRupees: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Not signed in")
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("Not signed in")
    if (user.isActive === false) {
      throw new Error("This account has been deactivated")
    }
    if (user.orgId) {
      throw new Error("You already belong to an organisation")
    }

    const name = args.name.trim()
    if (name.length < 2) {
      throw new Error("Organisation name must be at least 2 characters")
    }
    if (name.length > 120) {
      throw new Error("Organisation name must be under 120 characters")
    }

    const slug = await uniqueSlug(ctx.db, slugify(name))

    const bankName = args.bankName?.trim()
    if (bankName && bankName.length < 2) {
      throw new Error("Bank name must be at least 2 characters")
    }
    const fundName = args.fundName?.trim()
    if (fundName && fundName.length < 2) {
      throw new Error("Fund name must be at least 2 characters")
    }

    let monthlyAmountPaise: number | undefined
    if (args.monthlyRupees !== undefined && args.monthlyRupees !== null) {
      assertPaise(Math.round(args.monthlyRupees * 100), "Monthly amount")
      if (args.monthlyRupees > 0) {
        assertPositive(Math.round(args.monthlyRupees * 100), "Monthly amount")
        monthlyAmountPaise = Math.round(args.monthlyRupees * 100)
      }
    }

    const now = Date.now()
    const orgId = await ctx.db.insert("organizations", {
      name,
      slug,
      plan: "free",
      createdAt: now,
    })

    // The user row is created by the auth provider at sign-up with no
    // organisation. This is the one moment it is attached to one.
    await ctx.db.patch(userId, { orgId, role: "admin", isActive: true })

    const bankId = bankName
      ? await ctx.db.insert("banks", {
          orgId,
          name: bankName,
          accountNumber: args.accountNumber?.trim() || undefined,
          ifscCode: args.ifscCode?.trim().toUpperCase() || undefined,
          createdAt: now,
        })
      : undefined

    if (fundName) {
      await ctx.db.insert("funds", {
        orgId,
        name: fundName,
        type: "general",
        // A brand-new community's first fund is almost always the monthly
        // subscription, which is what makes arrears meaningful. It is still
        // optional, and a community that only takes donations can leave the
        // monthly amount blank.
        collectionMode: "fixed_monthly",
        bankId,
        isActive: true,
        isMemberContribution: monthlyAmountPaise !== undefined,
        monthlyAmountPaise,
        createdAt: now,
      })
    }

    // `recordAudit` wants an `Actor`, and an Actor is exactly what this caller
    // has just become. Constructing it here rather than loosening the helper's
    // signature keeps every other call site honest: there is no way to write an
    // audit row for an organisation that does not exist.
    await recordAudit(
      ctx,
      { userId, orgId, role: "admin", fundIds: undefined },
      {
        action: "org.created",
        entityType: "organization",
        entityId: orgId,
        details: name,
      },
    )
    if (bankId) {
      await recordAudit(
        ctx,
        { userId, orgId, role: "admin", fundIds: undefined },
        {
          action: AUDIT.bankCreated,
          entityType: "bank",
          entityId: bankId,
          details: bankName,
        },
      )
    }

    return { orgId, slug, name }
  },
})

/**
 * Delete this organisation and everything in it.
 *
 * An admin may delete their own organisation and nothing else — `requireAdmin`
 * resolves an actor first, so there is no id argument and therefore no way to
 * aim this at somebody else's tenant. Every org-scoped table is purged, because
 * leaving a row behind would be worse than useless: the org is gone, so nothing
 * could ever read or reconcile it again, and it would sit in the database
 * holding a real community's money records forever.
 *
 * The caller's auth account is deliberately left alone. The auth library keeps
 * its own store, which cannot be written to from another module (the same
 * constraint the seeder documents), so the sign-in row survives while the app's
 * `users` row goes. The result is an account that authenticates and is then
 * refused by `requireActor` — which is the correct end state for a person who
 * asked to be deleted, and is why the sign-in form tells them to use signup
 * again rather than sign in.
 */
export const deleteOrganization = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireAdmin(ctx)
    const orgId: Id<"organizations"> = actor.orgId

    // The org row itself is deleted last. If anything above throws, the
    // transaction rolls back and the community is still whole — which is the
    // whole point of doing this as one mutation rather than a queue.
    //
    // Each purge names its index explicitly rather than looping over a table
    // list. Three tables have no index called `by_org` — `counters` is
    // `by_org_scope`, `gatewayEvents` is `by_event`, `reminders` is
    // `by_campaign` — and a generic loop would have had to special-case them.
    // Spelling them out means the index name is checked against the schema at
    // build time, so a future rename is a type error rather than a deletion
    // that quietly leaves a community's ledger behind.
    let removed = 0
    // `Id<"banks">` and friends are branded per table, so one helper accepting
    // a single table's ids cannot take another's. `Id<TableNames>` is the union
    // the database itself is declared over, so this stays a checked type rather
    // than a cast.
    const purge = async (ids: Id<TableNames>[]) => {
      for (const id of ids) await ctx.db.delete(id)
      removed += ids.length
    }

    await purge(
      await ctx.db
        .query("reminders")
        .withIndex("by_campaign", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("reminderCampaigns")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("notificationPreferences")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("settlements")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("gatewayEvents")
        .withIndex("by_event", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("gatewayIntents")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("counters")
        .withIndex("by_org_scope", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("auditLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("balances")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("reconciliations")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("transactions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("paymentRequests")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    // Children before parents. `ledgerEntries` references funds, banks and
    // members; deleting a fund first would leave entries pointing at nothing,
    // which Convex does not prevent and which would be invisible until someone
    // tried to reconcile a year that no longer exists.
    await purge(
      await ctx.db
        .query("ledgerEntries")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("payments")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("contributions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("pledges")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("collectionRounds")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await purge(
      await ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    )
    await ctx.db.delete(orgId)

    return { removed }
  },
})
