import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import type { Actor } from "./authz"

/**
 * Every mutation records an audit row.
 *
 * The legacy build wrote audit rows that no endpoint could read, so the trail
 * existed but promised nothing. Here it is written by the one function each
 * mutation calls, and it is queryable. See docs/RECOVERY.md -> flaw 5.
 */
export async function recordAudit(
  ctx: MutationCtx,
  actor: Actor,
  entry: {
    action: string
    entityType: string
    entityId?: string
    details?: string
  },
): Promise<Id<"auditLog">> {
  return ctx.db.insert("auditLog", {
    orgId: actor.orgId,
    userId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details,
    createdAt: Date.now(),
  })
}

/** Standard action names, so the log is greppable. */
export const AUDIT = {
  fundCreated: "fund.created",
  fundUpdated: "fund.updated",
  bankCreated: "bank.created",
  bankUpdated: "bank.updated",
  memberCreated: "member.created",
  memberUpdated: "member.updated",
  contributionStatus: "contribution.status",
  transactionCreated: "transaction.created",
  transactionApproved: "transaction.approved",
  transactionRejected: "transaction.rejected",
  paymentRecorded: "payment.recorded",
  userCreated: "user.created",
  userUpdated: "user.updated",
} as const
