import { query } from "./_generated/server"
import { requireConsole, requireTreasurer } from "./lib/authz"
import { hasProvider, provider } from "./lib/payments"

/**
 * The gateway's side of M4 — the part that waits for a decision.
 *
 * Everything in here reads tables that M4a created but that nothing writes yet,
 * because no provider is chosen (docs/M4-PLAN.md). That is deliberate: the query
 * a treasurer will need on the day a provider lands should already exist, should
 * already be correct about what an exception *is*, and should already be honest
 * that there is nothing to see yet. An exceptions panel invented at the same
 * moment as the first real problem tends to be invented *wrong*, because by then
 * the person writing it is debugging.
 *
 * ## What counts as an exception
 *
 * Not "something went wrong" — the things that specifically corrupt the books if
 * they are not looked at:
 *
 *   - An event claimed but never finished. A crash between claiming an event and
 *     recording its payment leaves exactly this, and it is a payment that
 *     happened and is not in the books. It is the most important row here.
 *   - An event whose amount disagrees with the intent it matched. Never credited;
 *     a treasurer has to decide.
 *   - An event for an intent that does not exist. A payment we cannot attribute.
 *   - A captured intent that has been captured for too long with no settlement
 *     against it. The money is in the member's account and not in the bank, and
 *     the day's reconciliation is about to be wrong because of it.
 *
 * Deliberately **not** here: retries, provider health, and dashboard tiles. Those
 * belong to the provider that gets chosen, and guessing at them now would be
 * building for a provider nobody has picked.
 */

export type ExceptionKind =
  | "unprocessed_event"
  | "amount_mismatch"
  | "unknown_intent"
  | "unsettled"

export const exceptions = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireConsole(ctx)

    const events = await ctx.db
      .query("gatewayEvents")
      .withIndex("by_org_received", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const intents = await ctx.db
      .query("gatewayIntents")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()
    const settlements = await ctx.db
      .query("settlements")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect()

    const intentById = new Map(intents.map((i) => [i._id as string, i]))
    const found: {
      id: string
      kind: ExceptionKind
      detail: string
      at: number
      amountPaise: number | null
    }[] = []

    for (const event of events) {
      // Claimed but never finished. The row says "received" and nothing else
      // happened, so either a process died mid-handling or a scheduled sweep
      // has not run. Either way a real payment may be missing from the books.
      if (event.status === "received") {
        found.push({
          id: event._id,
          kind: "unprocessed_event",
          detail: `${event.kind} claimed but never finished`,
          at: event.receivedAt,
          amountPaise: event.amountPaise,
        })
        continue
      }

      if (event.status === "failed") {
        found.push({
          id: event._id,
          kind: "unprocessed_event",
          detail: event.reason ?? `${event.kind} could not be applied`,
          at: event.receivedAt,
          amountPaise: event.amountPaise,
        })
        continue
      }

      if (event.outcome === "succeeded" && event.intentId) {
        const intent = intentById.get(event.intentId)
        if (!intent) {
          found.push({
            id: event._id,
            kind: "unknown_intent",
            detail: `${event.kind} matched no collection attempt`,
            at: event.receivedAt,
            amountPaise: event.amountPaise,
          })
        } else if (intent.amountPaise !== event.amountPaise) {
          // Never credited. The amount the member sent is not the amount we
          // asked for, and deciding what to do about the difference is a
          // treasurer's judgement, not a rule.
          found.push({
            id: event._id,
            kind: "amount_mismatch",
            detail:
              `expected ${intent.amountPaise} paise, received ` +
              `${event.amountPaise} paise — not credited`,
            at: event.receivedAt,
            amountPaise: event.amountPaise,
          })
        }
      }
    }

    // Captured but not settled. Providers settle a captured payment into a bank
    // account a day or so later, and until that leg is written the organisation's
    // bank balance is short by this much. That is expected in flight and a
    // problem once it stops moving, so the threshold is generous: an amount
    // sitting unsettled for a week is not "in flight", it is missing.
    const WEEK = 7 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const settledIntents = new Set<string>()
    for (const settlement of settlements) {
      // The payout id is the provider's; the link back to intents is not stored
      // per settlement, so an intent is considered settled when *any* settlement
      // exists for the same provider on the same day. A provider is chosen before
      // this can matter, and a wrong answer here shows as a spurious warning
      // rather than as a lost payment.
      settledIntents.add(`${settlement.provider}:${settlement.settledOn}`)
    }

    for (const intent of intents) {
      if (intent.status !== "captured") continue
      const key = `${intent.provider}:new Date(intent.createdAt).toISOString().slice(0, 10)}`
      if (settledIntents.has(key)) continue
      const age = now - intent.createdAt
      if (age < WEEK) continue
      found.push({
        id: intent._id,
        kind: "unsettled",
        detail:
          `captured ${Math.floor(age / 86400000)} days ago and not in the bank yet`,
        at: intent.createdAt,
        amountPaise: intent.amountPaise,
      })
    }

    found.sort((a, b) => b.at - a.at)

    return {
      provider: provider().name,
      configured: hasProvider(),
      exceptions: found,
      counts: {
        total: found.length,
        needsMoney: found.filter(
          (e) => e.kind === "unprocessed_event" || e.kind === "unknown_intent",
        ).length,
      },
    }
  },
})

/**
 * Whether online collection is available, and if not, why not.
 *
 * The console asks this so it can say the true thing rather than rendering a
 * payment button that fails. With no provider configured the answer is
 * "not configured", which is the shipping state of M4a rather than an error —
 * and the screen it drives says so in those words instead of hiding the feature
 * and leaving somebody to wonder.
 */
export const config = query({
  args: {},
  handler: async (ctx) => {
    await requireTreasurer(ctx)
    return {
      configured: hasProvider(),
      provider: provider().name,
      /** Kept explicit so the UI never has to infer capability from absence. */
      canCollectOnline: false,
    }
  },
})
