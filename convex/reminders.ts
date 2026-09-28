import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { requireConsole, requireMember, requireTreasurer } from "./lib/authz"
import { recordAudit } from "./lib/audit"
import { hasProvider } from "./lib/notify"
import { hasDues } from "./lib/funds"
import { AGING_BUCKETS, bucketFor, monthYearOf, oldestDuePerMember } from "./lib/arrears"
import {
  type MemberArrears,
  type MemberContact,
  SKIP_REASON_LABEL,
  periodOf,
  planRun,
  statementUrlFor,
  templateFor,
} from "./lib/reminders"
import { renderReminder, renderSms } from "./lib/notify"

/**
 * M5 — reminders and arrears.
 *
 * The treasury's side of chasing a contribution, and the record that it
 * happened. What this file deliberately does **not** do is send anything: the
 * transport is a seam (`lib/notify.ts`) with an offline stub, so this can be
 * built, argued about and verified before a vendor is chosen — the same split M4
 * made between the offline desk and the gateway.
 *
 * ## The rule that shapes this file
 *
 * **A run is recorded whether or not it sends anything.** Pressing "remind all
 * unpaid" writes a campaign, and the members it considered, the ones it queued,
 * and the ones it skipped with a reason. That is what makes "you reminded 61
 * people" an answerable question afterwards, and it is the reason the campaign
 * is a row rather than a loop.
 */

/** The public origin used in the links a reminder carries. */
function originOf(): string {
  return process.env.SITE_URL ?? "http://127.0.0.1:5173"
}

/** Open dues for the scheduled funds only — see `lib/arrears` on why. */
async function openScheduledDues(ctx: QueryCtx, orgId: Id<"organizations">) {
  const funds = await ctx.db
    .query("funds")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()
  const dueFundIds = new Set(funds.filter((f) => hasDues(f)).map((f) => f._id))
  const open = await ctx.db
    .query("contributions")
    .withIndex("by_open", (q) => q.eq("orgId", orgId).eq("status", "due"))
    .collect()
  return open.filter((c) => (c.fundId ? dueFundIds.has(c.fundId) : false))
}

/** Per-member arrears, resolved the same way for the list, the run and the cron. */
async function arrearsFor(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  asOf: Date,
): Promise<Map<string, MemberArrears>> {
  const open = await openScheduledDues(ctx, orgId)
  const oldest = oldestDuePerMember(open, asOf)

  const out = new Map<string, MemberArrears>()
  for (const due of open) {
    const current = out.get(due.memberId) ?? {
      memberId: due.memberId,
      amountPaise: 0,
      months: 0,
      daysPastDue: 0,
    }
    current.amountPaise += due.amountPaise
    current.months += 1
    out.set(due.memberId, current)
  }
  for (const [memberId, entry] of out) {
    const first = oldest.get(memberId)
    entry.daysPastDue = first ? first.days : 0
    entry.oldestMonth = first ? monthYearOf(first.dueDate) : undefined
  }
  return out
}

/** Every member who can be chased, with the preferences that govern it. */
async function contactsFor(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
): Promise<MemberContact[]> {
  const [members, prefs] = await Promise.all([
    ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("notificationPreferences")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
  ])
  const prefByMember = new Map<string, Doc<"notificationPreferences">>(
    prefs.map((p) => [p.memberId as string, p]),
  )
  return members
    .filter((m) => m.isActive)
    .map((m) => {
      const p = prefByMember.get(m._id)
      return {
        memberId: m._id as string,
        name: m.name,
        email: m.email ?? undefined,
        phone: m.phone ?? undefined,
        preferences: p ? { email: p.email, sms: p.sms, whatsapp: p.whatsapp } : null,
      }
    })
}

/* -------------------------------------------------------------- read models */

/**
 * The defaulter list: who owes what, how long, and whether we have chased them.
 *
 * Sorted oldest-first by default because the treasurer's question is "who do I
 * ring first", and the member who has not paid since 2019 is not the same
 * priority as the member who missed last month. The ageing buckets come from
 * `lib/arrears` unchanged, so this list and the reports page cannot disagree.
 */
export const defaulters = query({
  args: {
    sort: v.optional(
      v.union(
        v.literal("oldest"),
        v.literal("newest"),
        v.literal("amount"),
        v.literal("name"),
      ),
    ),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireConsole(ctx)
    const asOf = args.asOf ? new Date(args.asOf) : new Date()

    const [members, funds, prefs, campaigns] = await Promise.all([
      ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("notificationPreferences")      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
          .collect(),
      ctx.db
        .query("reminderCampaigns")
        .withIndex("by_org_created", (q) => q.eq("orgId", actor.orgId))
        .collect(),
    ])
    const org = await ctx.db.get(actor.orgId)

    const arrears = await arrearsFor(ctx, actor.orgId, asOf)
    const campaignIds = new Set(campaigns.map((c) => c._id))
    const sent = await ctx.db
      .query("reminders")
      .withIndex("by_org_created", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const lastReminded = new Map<string, number>()
    const lastChannel = new Map<string, string>()
    for (const row of sent) {
      if (!campaignIds.has(row.campaignId)) continue
      const seen = lastReminded.get(row.memberId) ?? 0
      if (row.createdAt > seen) {
        lastReminded.set(row.memberId, row.createdAt)
        lastChannel.set(row.memberId, `${row.channel} · ${row.status}`)
      }
    }

    const prefByMember = new Map(prefs.map((p) => [p.memberId, p]))
    const nameOf = new Map(members.map((m) => [m._id as string, m.name]))
    const dueFundIds = new Set(funds.filter(hasDues).map((f) => f._id as string))

    const rows = [...arrears.values()].map((entry) => {
      const pref = prefByMember.get(entry.memberId as Id<"members">)
      const hasEmail = !!members.find(
        (m) => m._id === entry.memberId && m.email,
      )
      const hasPhone = !!members.find(
        (m) => m._id === entry.memberId && m.phone,
      )
      const optedOut = pref
        ? [pref.email === false, pref.sms === false, pref.whatsapp === false].every(
            (v) => v,
          )
        : false
      return {
        memberId: entry.memberId as string,
        name: nameOf.get(entry.memberId) ?? "Unknown member",
        amountPaise: entry.amountPaise,
        months: entry.months,
        daysPastDue: entry.daysPastDue,
        oldestMonth: entry.oldestMonth ?? null,
        bucket: bucketFor(entry.daysPastDue),
        kind: templateFor(entry),
        reachEmail: hasEmail,
        reachSms: hasPhone,
        optedOut,
        preferences: pref
          ? { email: pref.email ?? null, sms: pref.sms ?? null, whatsapp: pref.whatsapp ?? null }
          : null,
        lastRemindedAt: lastReminded.get(entry.memberId) ?? null,
        lastReminderState: lastChannel.get(entry.memberId) ?? null,
      }
    })

    // Bucket totals come from the same rows, so a bucket that does not add up to
    // the total above it cannot happen.
    const buckets = AGING_BUCKETS.map((b) => {
      const inBucket = rows.filter((r) => r.bucket === b.key)
      return {
        key: b.key,
        label: b.label,
        hint: b.hint,
        members: inBucket.length,
        totalPaise: inBucket.reduce((sum, r) => sum + r.amountPaise, 0),
      }
    })

    const sort = args.sort ?? "oldest"
    rows.sort((a, b) => {
      if (sort === "newest") return a.daysPastDue - b.daysPastDue
      if (sort === "amount") return b.amountPaise - a.amountPaise
      if (sort === "name") return a.name.localeCompare(b.name)
      return b.daysPastDue - a.daysPastDue
    })

    return {
      asOf: asOf.toISOString(),
      providerConfigured: hasProvider(),
      orgName: org?.name ?? "the fund",
      dueFundCount: dueFundIds.size,
      totalPaise: rows.reduce((sum, r) => sum + r.amountPaise, 0),
      totalMembers: rows.length,
      buckets,
      rows,
      lastCampaignAt: campaigns.length
        ? Math.max(...campaigns.map((c) => c.createdAt))
        : null,
    }
  },
})

/** Per-member reminder history, newest first. */
export const history = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const actor = await requireConsole(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", args.memberId),
      )
      .collect()

    const campaigns = new Map(
      (
        await ctx.db
          .query("reminderCampaigns")
          .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
          .collect()
      ).map((c) => [c._id as string, c]),
    )

    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r._id,
        kind: r.kind,
        channel: r.channel,
        destination: r.destination,
        subject: r.subject,
        amountPaise: r.amountPaise,
        months: r.months,
        status: r.status,
        sentAt: r.sentAt ?? null,
        deliveredAt: r.deliveredAt ?? null,
        failureReason: r.failureReason ?? null,
        trigger: campaigns.get(r.campaignId as string)?.trigger ?? "manual",
        period: campaigns.get(r.campaignId as string)?.period ?? null,
      }))
  },
})

/** One member's preferences, and the roster's, for the consent panel. */
export const preferences = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireConsole(ctx)
    const rows = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const optedOut = rows.filter((r) => r.email === false || r.sms === false).length
    return {
      rows: rows.map((r) => ({
        memberId: r.memberId as string,
        email: r.email ?? null,
        sms: r.sms ?? null,
        whatsapp: r.whatsapp ?? null,
        decidedAt: r.decidedAt,
      })),
      decidedCount: rows.length,
      optedOutCount: optedOut,
    }
  },
})

/**
 * The signed-in member's own reminder preferences.
 *
 * Session-scoped, exactly like the rest of the portal: it resolves the member
 * row from the token and never takes a member id as an argument, so it is not
 * possible to ask it about somebody else by passing a different one.
 */
export const myPreferences = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireMember(ctx)
    const linked = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", actor.orgId).eq("userId", actor.userId),
      )
      .first()
    if (!linked) {
      return { memberId: null, email: null, sms: null, whatsapp: null, decidedAt: null }
    }
    const row = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", linked._id),
      )
      .first()
    return {
      memberId: linked._id as string,
      email: row?.email ?? null,
      sms: row?.sms ?? null,
      whatsapp: row?.whatsapp ?? null,
      decidedAt: row?.decidedAt ?? null,
    }
  },
})

/* ---------------------------------------------------------------- mutations */

/**
 * Record what a member has agreed to.
 *
 * A member changing this is not a console action, so `requireMember` rather than
 * `requireTreasurer` — but only for their *own* row, which is the whole reason
 * this is worth a separate mutation. A treasurer *can* record a refusal on
 * somebody's behalf, because a member who asks to be left alone does not always
 * have an account; they cannot record consent, because consent the member did
 * not give is not consent.
 */
export const setPreference = mutation({
  args: {
    memberId: v.optional(v.id("members")),
    email: v.optional(v.boolean()),
    sms: v.optional(v.boolean()),
    whatsapp: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireMember(ctx)

    // A member speaks only for themselves, and may set a channel either way.
    //
    // A committee member may record a **refusal** on somebody's behalf and
    // nothing else. The direction is the whole rule: someone in this community
    // who does not want to be chased does not always have an account, and a
    // treasurer who writes down "Mrs Sheikh asked to be left alone" is doing
    // what the member asked. The same treasurer turning reminders **on** for
    // somebody who never agreed is consent that was never given, so that is
    // refused outright.
    const linked = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", actor.orgId).eq("userId", actor.userId),
      )
      .first()

    let memberId: Id<"members">
    if (actor.role === "member") {
      if (!linked) throw new Error("Your account is not linked to a member record yet")
      if (args.memberId && args.memberId !== linked._id) {
        throw new Error("You can only change your own reminder preferences")
      }
      memberId = linked._id
    } else {
      if (!args.memberId) {
        throw new Error("A committee user has to say whose preferences they are recording")
      }
      if (args.email || args.sms || args.whatsapp) {
        throw new Error(
          "A committee user can record that a member asked not to be reminded, " +
            "but cannot agree to reminders on their behalf",
        )
      }
      memberId = args.memberId
    }

    const member = await ctx.db.get(memberId)
    if (!member || member.orgId !== actor.orgId) throw new Error("Member not found")

    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) =>
        q.eq("orgId", actor.orgId).eq("memberId", memberId!),
      )
      .first()

    const merged = {
      email: args.email ?? existing?.email,
      sms: args.sms ?? existing?.sms,
      whatsapp: args.whatsapp ?? existing?.whatsapp,
    }

    if (existing) {
      await ctx.db.patch(existing._id, { ...merged, decidedAt: Date.now() })
    } else {
      await ctx.db.insert("notificationPreferences", {
        orgId: actor.orgId,
        memberId,
        ...merged,
        decidedAt: Date.now(),
        updatedBy: actor.userId,
      })
    }

    await recordAudit(ctx, actor, {
      action: "notificationPreference.updated",
      entityType: "member",
      entityId: memberId,
      details: `email=${merged.email ?? "unset"} sms=${merged.sms ?? "unset"} whatsapp=${merged.whatsapp ?? "unset"}`,
    })

    return { memberId, ...merged }
  },
})

/**
 * Plan and queue a run.
 *
 * Idempotent per (org, kind, period) for a scheduled run, so a job that fires
 * twice — which they will, because these run on a monthly cron and crons retry —
 * does not chase the same people twice. A manual run is deliberately *not*
 * subject to that: a treasurer who presses the button twice has asked twice, and
 * telling them it was ignored is its own bug.
 */
export const runCampaign = mutation({
  args: {
    kind: v.union(
      v.literal("due_soon"),
      v.literal("overdue"),
      v.literal("arrears_summary"),
    ),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireTreasurer(ctx)
    return buildCampaign(ctx, {
      orgId: actor.orgId,
      kind: args.kind,
      asOf: args.asOf ? new Date(args.asOf) : new Date(),
      trigger: "manual",
      requestedBy: actor.userId,
    })
  },
})

/** The monthly job. `internalMutation` so nothing in the app can call it. */
export const runScheduled = internalMutation({
  args: {
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("due_soon"),
      v.literal("overdue"),
      v.literal("arrears_summary"),
    ),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return buildCampaign(ctx, {
      orgId: args.orgId,
      kind: args.kind,
      asOf: args.asOf ? new Date(args.asOf) : new Date(),
      trigger: "scheduled",
    })
  },
})

/**
 * Build a campaign. Shared by the button and the cron so the two cannot differ.
 *
 * This is a mutation rather than an action because it does no I/O: with the
 * offline stub the "send" is a local function call, and once a real provider is
 * configured the transport moves to an action while this stays exactly here.
 */
async function buildCampaign(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">
    kind: "due_soon" | "overdue" | "arrears_summary"
    asOf: Date
    trigger: "manual" | "scheduled"
    requestedBy?: Id<"users">
  },
) {
  const period = periodOf(args.asOf)

  // The replay guard. Only for scheduled runs, and only within the period.
  if (args.trigger === "scheduled") {
    const existing = await ctx.db
      .query("reminderCampaigns")
      .withIndex("by_org_period", (q: any) =>
        q
          .eq("orgId", args.orgId)
          .eq("kind", args.kind)
          .eq("period", period),
      )
      .first()
    if (existing) {
      return { replayed: true, campaignId: existing._id, queued: 0, considered: existing.considered }
    }
  }

  const org = await ctx.db.get(args.orgId)
  if (!org) throw new Error("Organisation not found")

  const [contacts, arrears] = await Promise.all([
    contactsFor(ctx, args.orgId),
    arrearsFor(ctx, args.orgId, args.asOf),
  ])

  // Who has already been chased this period. Asked once, for the whole roster,
  // because asking per member is a scan per member.
  const prior = await ctx.db
    .query("reminderCampaigns")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect()
  const priorIds = new Set(
    prior.filter((c: Doc<"reminderCampaigns">) => c.period === period).map((c) => c._id),
  )
  const alreadyReminded = new Set<string>()
  if (priorIds.size) {
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_org_created", (q) => q.eq("orgId", args.orgId))
      .collect()
    for (const row of rows) {
      if (priorIds.has(row.campaignId)) alreadyReminded.add(row.memberId as string)
    }
  }

  const { planned, skipped } = planRun({
    contacts,
    arrears: [...arrears.values()],
    alreadyReminded,
    origin: originOf(),
  })

  const campaignId = await ctx.db.insert("reminderCampaigns", {
    orgId: args.orgId,
    kind: args.kind,
    period,
    trigger: args.trigger,
    requestedBy: args.requestedBy,
    considered: contacts.length,
    queued: planned.length,
    skippedOptOut: skipped.filter((s) => s.reason === "opted_out").length,
    skippedUnreachable: skipped.filter((s) => s.reason === "no_destination").length,
    createdAt: Date.now(),
  })

  const nameOf = new Map(contacts.map((c) => [c.memberId, c.name]))
  for (const item of planned) {
    const facts = {
      memberName: nameOf.get(item.memberId) ?? "member",
      orgName: org.name,
      amountPaise: item.amountPaise,
      months: item.months,
      daysPastDue: item.daysPastDue,
      oldestMonth: item.oldestMonth,
      statementUrl: statementUrlFor(originOf(), item.memberId),
    }
    const rendered =
      item.channel === "email"
        ? renderReminder(item.kind, facts)
        : { kind: item.kind, subject: `${org.name} reminder`, body: renderSms(facts) }

    await ctx.db.insert("reminders", {
      orgId: args.orgId,
      campaignId,
      memberId: item.memberId as Id<"members">,
      kind: item.kind,
      channel: item.channel,
      destination: item.destination,
      subject: rendered.subject,
      body: rendered.body,
      amountPaise: item.amountPaise,
      months: item.months,
      status: "queued",
      createdAt: Date.now(),
    })
  }

  if (args.requestedBy) {
    await recordAudit(
      ctx,
      { orgId: args.orgId, userId: args.requestedBy } as any,
      {
        action: "reminderCampaign.run",
        entityType: "reminderCampaign",
        entityId: campaignId as string,
        details:
          `${args.kind} for ${period}: considered ${contacts.length}, queued ` +
          `${planned.length}, skipped ${skipped.length} ` +
          `(${skipped.map((s) => SKIP_REASON_LABEL[s.reason]).join(", ") || "none"})`,
      },
    )
  }

  return {
    replayed: false,
    campaignId,
    considered: contacts.length,
    queued: planned.length,
    skipped: skipped.length,
    skippedReasons: skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1
      return acc
    }, {}),
  }
}

/** The campaigns, newest first — the "who have we chased" list. */
export const campaigns = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireConsole(ctx)
    const rows = await ctx.db
      .query("reminderCampaigns")
      .withIndex("by_org_created", (q) => q.eq("orgId", actor.orgId))
      .collect()
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({
        id: c._id as string,
        kind: c.kind,
        period: c.period,
        trigger: c.trigger,
        considered: c.considered,
        queued: c.queued,
        skippedOptOut: c.skippedOptOut,
        skippedUnreachable: c.skippedUnreachable,
        createdAt: c.createdAt,
      }))
  },
})

/**
 * What a scheduled run *would* do, with a date the caller chooses.
 *
 * This is the preview a treasurer reads before pressing the button, and it is a
 * separate function from the run itself on purpose: a plan that is computed by
 * the same code that then writes it is not a preview, it is a summary of
 * something that already happened.
 */
export const preview = query({
  args: {
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireConsole(ctx)
    const asOf = args.asOf ? new Date(args.asOf) : new Date()
    const [contacts, arrears] = await Promise.all([
      contactsFor(ctx, actor.orgId),
      arrearsFor(ctx, actor.orgId, asOf),
    ])
    const { planned, skipped } = planRun({
      contacts,
      arrears: [...arrears.values()],
      alreadyReminded: new Set(),
      origin: originOf(),
    })
    return {
      asOf: asOf.toISOString(),
      considered: contacts.length,
      wouldQueue: planned.length,
      wouldSkip: skipped.length,
      byKind: planned.reduce<Record<string, number>>((acc, p) => {
        acc[p.kind] = (acc[p.kind] ?? 0) + 1
        return acc
      }, {}),
      byChannel: planned.reduce<Record<string, number>>((acc, p) => {
        acc[p.channel] = (acc[p.channel] ?? 0) + 1
        return acc
      }, {}),
    }
  },
})
