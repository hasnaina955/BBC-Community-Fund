import { mutation } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { hashSecret } from "./lib/password"
import { truthFromEntries } from "./lib/balances"

/**
 * Demo seeder — milestone M1.
 *
 * SECURITY: this is a PUBLIC mutation. It refuses to run once an organisation
 * exists, so it cannot be re-run to duplicate or corrupt data, and it only
 * ever writes demo rows into a new organisation. It must be deleted or moved
 * behind an internal function before general availability — tracked in
 * docs/ROADMAP.md -> M8 (security review).
 *
 * Run once with:  bunx convex run seed:seedDemo '{}'
 */

/**
 * Tables the demo reset sweeps, children before parents.
 *
 * The order matters: an entry references a payment, a payment references a
 * member, and so on. The driver in `scripts/reset-demo.mjs` walks this list.
 */  const RESET_ORDER = [
  "auditLog",
  "reconciliations",
  "balances",
  "ledgerEntries",
  "payments",
  "contributions",
  "pledges",
  "collectionRounds",
  "transactions",
  "members",
  "funds",
  "banks",
] as const

/**
 * The demo staff accounts.
 *
 * The auth tables have no `orgId`, so a reset reaches them through the user ids
 * the organisation owns — or, when the users have already gone, through the
 * account rows themselves, matched on these addresses. That second path is what
 * makes the reset recoverable after a partial run, which is exactly the state a
 * half-finished reset leaves behind.
 */
const DEMO_EMAILS = [
  "secretary@jamaat.org",
  "treasurer@jamaat.org",
  "bilal@jamaat.org",
  "farhan@jamaat.org",
  "sadia@jamaat.org",
  "imran@example.org",
  "ayesha@example.org",
] as const

const DEMO_PASSWORD = "community123"

/**
 * A minimal generic view of the database, used only by `resetDemo`'s sweep.
 * Convex's typed `db.query` overloads are per-table, so a loop over a list of
 * table names has to go through this shape instead.
 */
interface GenericReader {
  query(table: string): {
    withIndex(
      index: string,
      range?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ): { collect(): Promise<Array<Record<string, string>>> }
    collect(): Promise<Array<Record<string, string>>>
    take(n: number): Promise<Array<Record<string, string>>>
  }
  delete(id: string): Promise<void>
}

/**
 * Delete every row of a table, a page at a time.
 *
 * A mutation may read at most 4096 documents, and eight years of payments is
 * nearly 9,500, so a plain `.collect()` throws before a single row is removed.
 * Paging is what makes the reset usable at the history length this community
 * actually has.
 */
/**
 * Rows one `wipe` call will delete.
 *
 * A Convex mutation may read 4096 documents in total, and every row it deletes
 * is a row it read. The budget is set well below the limit so that a slice plus
 * the page that finds it empty still fits. `resetDemo` returns `done: false`
 * while rows remain and the driver simply calls it again.
 */
const WIPE_BUDGET = 2000

async function wipe(
  db: GenericReader,
  table: string,
  filter?: (row: Record<string, string>) => boolean,
): Promise<number> {
  let wiped = 0
  while (wiped < WIPE_BUDGET) {
    // `take` rather than `paginate`: Convex allows only one paginated query per
    // function, and this has to sweep many tables.
    const rows = await db
      .query(table)
      .take(Math.min(500, WIPE_BUDGET - wiped))
    if (rows.length === 0) return wiped

    let removed = 0
    for (const row of rows) {
      if (filter && !filter(row)) continue
      await db.delete(row._id)
      wiped += 1
      removed += 1
    }
    // Nothing matched the filter and nothing can be removed: stop rather than
    // loop forever on the same rows.
    if (removed === 0) return wiped
  }
  return wiped
}

const FIRST_NAMES = [
  "Imran", "Yusuf", "Bilal", "Aamir", "Zahid", "Tariq", "Nadeem", "Faisal",
  "Shakeel", "Javed", "Aslam", "Rashid", "Salim", "Arif", "Hassan", "Khalid",
  "Sohail", "Wajid", "Adnan", "Naveed", "Farhan", "Kashif", "Owais", "Zeeshan",
  "Rizwan", "Shahid", "Noman", "Junaid", "Mushtaq", "Rafiq", "Sadiq",
  "Usman", "Hamza", "Omar", "Abdullah", "Ibrahim", "Ismail", "Idris", "Abdul",
  "Muhammad", "Ahmed", "Ali", "Hussain", "Mustafa", "Rashida", "Sajid", "Taufeeq",
  "Wajeeh", "Yaseen", "Zubair", "Asif", "Bashir", "Danish", "Ehsan", "Fahad",
  "Hamid", "Haris", "Imran", "Kamran", "Luqman", "Mansoor", "Owais", "Pervez",
  "Qadir", "Raees", "Salman", "Tanveer", "Umair", "Varis", "Yasir", "Adeel",
  "Faraz", "Irtiza", "Kashmiri", "Latif", "Moin", "Obaid", "Qaisar", "Sabir",
  "Talat", "Waheed", "Zameer", "Aslam", "Dilawar", "Ehsanullah", "Haroon",
  "Imtiaz", "Mumtaz", "Qamar", "Rehan", "Sajjad", "Tauseef", "Umair", "Yusuf",
  "Zubair", "Aftab", "Bilal", "Danish", "Fahim", "Ghulam", "Hayat", "Iltijaat",
  "Junaid", "Khurram", "Latif", "Mansoor", "Nadeem", "Omar", "Parvez", "Qaisar",
  "Rafiq", "Sami", "Tanveer", "Umair", "Waqar", "Yasin", "Zubair", "Adeel",
] as const

const LAST_NAMES = [
  "Khan", "Sheikh", "Ansari", "Siddiqui", "Alvi", "Qureshi", "Baig", "Merchant",
  "Bohra", "Dhuliawala", "Contractor", "Vohra",
] as const

const RELATIONS = [
  "Member", "Member", "Member", "Committee", "Volunteer", "Imam", "Treasurer",
] as const

/** Deterministic PRNG so seeded data is identical on every run. */
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RUPEE = 100
const LAKH = 100000 * RUPEE
const MEMBER_COUNT = 84
/** The demo org's slug. The reset above refuses to touch anything else. */
const DEMO_SLUG = "jamaat-anjuman"
/** The monthly fund is Rs 100 per member per month. */
const MONTHLY_DUES_PAISE = 100 * RUPEE

/**
 * Guarded reset of the demo deployment, **one table per call**.
 *
 * Only operates on an organisation whose slug is the demo slug, and only with
 * the exact confirm string. This exists so the seed can be reshaped as the
 * domain is understood better — it is not a general "wipe everything" tool, and
 * it must be deleted before any real community data is loaded. Tracked in
 * docs/ROADMAP.md -> M8.
 *
 * ## Why one table at a time
 *
 * A Convex mutation may read at most 4096 documents in total. Eight years of
 * payments is 9,545, so a reset that swept every table in one call would throw
 * before it deleted anything — the tool would be useless at exactly the history
 * length it exists to handle. `scripts/reset-demo.mjs` drives one call per
 * table, in the order `RESET_ORDER` declares, and repeats the call until each
 * table reports zero.
 *
 *   bun run seed:reset
 */
export const resetDemo = mutation({
  args: {
    confirm: v.optional(v.string()),
    table: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== "wipe demo data") {
      throw new Error('Pass { "confirm": "wipe demo data" } to run the reset')
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .first()

    if (org && org.slug !== DEMO_SLUG) {
      throw new Error("Refusing to reset: that is not the demo organisation")
    }
    const orgId = org?._id

    const table = args.table
    if (!table) {
      throw new Error(
        `Pass a "table" to clear. Clear them in this order: ${RESET_ORDER.join(", ")}, ` +
          "then authSessions, authRefreshTokens, authAccounts, users",
      )
    }

    // Convex's per-table `db.query` overloads cannot express a loop over table
    // names, so the sweep goes through the generic reader. This is the one
    // place in the codebase that does: a reset that must be correct above all,
    // and that docs/ROADMAP.md -> M8 deletes before real data loads.
    const anyDb = ctx.db as unknown as GenericReader

    // Convex Auth's tables carry no `orgId`. They are reached through the user
    // ids the organisation owns, and — when those rows are already gone, which
    // is what an interrupted reset leaves behind — through the demo account
    // addresses themselves.
    if (
      table === "authSessions" ||
      table === "authRefreshTokens" ||
      table === "authAccounts"
    ) {
      const owned = new Set<string>()
      if (orgId) {
        for (const u of await anyDb
          .query("users")
          .withIndex(
            "by_org",
            (q: { eq: (a: string, b: unknown) => unknown }) =>
              q.eq("orgId", orgId),
          )
          .collect()) {
          owned.add(u._id)
        }
      }
      if (table === "authAccounts") {
        const emails = new Set<string>(DEMO_EMAILS)
        for (const a of await anyDb.query("authAccounts").take(1000)) {
          if (emails.has(a.providerAccountId)) owned.add(a.userId)
        }
      }

      // Refresh tokens hang off a session, so the sessions are found first.
      let sessionIds = new Set<string>()
      if (table === "authRefreshTokens") {
        sessionIds = new Set(
          (await anyDb.query("authSessions").take(1000))
            .filter((r) => owned.has(r.userId))
            .map((r) => r._id),
        )
      }

      const wiped = await wipe(anyDb, table, (row) =>
        table === "authAccounts"
          ? owned.has(row.userId)
          : sessionIds.has(row.sessionId),
      )
      return { wiped, done: wiped === 0, reason: null }
    }

    if (table === "users") {
      if (!org) {
        return { wiped: 0, done: true, reason: "no demo organisation found" }
      }
      const wiped = await wipe(anyDb, "users", (row) => row.orgId === orgId)
      // The organisation goes last, once nothing points at it.
      if (wiped === 0) await ctx.db.delete(org._id)
      return { wiped, done: wiped === 0, reason: null }
    }

    if (!(RESET_ORDER as readonly string[]).includes(table)) {
      throw new Error(
        `"${table}" is not one of ${RESET_ORDER.join(", ")}, or users`,
      )
    }
    if (!org) {
      return { wiped: 0, done: true, reason: "no demo organisation found" }
    }

    const wiped = await wipe(anyDb, table, (row) => row.orgId === orgId)
    // `done` is true only when a call found nothing left to remove, so the
    // driver knows a partial slice means "call me again".
    return { wiped, done: wiped === 0, reason: null }
  },
})

export const seedDemo = mutation({
  args: { confirm: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.confirm !== "seed") {
      throw new Error('Pass { "confirm": "seed" } to run the seeder')
    }

    const existing = await ctx.db.query("organizations").first()
    if (existing) {
      throw new Error(
        "This deployment is already seeded. Delete the data to re-seed.",
      )
    }

    const rand = rng(20260926)
    const pick = <T,>(arr: readonly T[]): T =>
      arr[Math.floor(rand() * arr.length)]
    const int = (min: number, max: number) =>
      Math.floor(rand() * (max - min + 1)) + min

    const now = Date.now()
    const year = new Date().getUTCFullYear()
    const month = new Date().getUTCMonth() + 1

    /* ---------------------------------------------------- organisation */

    const orgId: Id<"organizations"> = await ctx.db.insert("organizations", {
      name: "Jamaat Anjuman",
      slug: DEMO_SLUG,
      plan: "free",
      createdAt: now,
    })

    /* ----------------------------------------------------------- users */
    // Auth accounts are created through the library's own store so the
    // password hash format matches what sign-in will verify against.

    const secret = await hashSecret(DEMO_PASSWORD)

    const staffSpecs = [
      { name: "Abdul Rahman", email: "secretary@jamaat.org", role: "admin" as const },
      { name: "Yusuf Merchant", email: "treasurer@jamaat.org", role: "treasurer" as const },
      { name: "Bilal Qureshi", email: "bilal@jamaat.org", role: "fund_manager" as const },
      { name: "Farhan Shaikh", email: "farhan@jamaat.org", role: "viewer" as const },
      { name: "Sadia Ansari", email: "sadia@jamaat.org", role: "viewer" as const },
    ]

    // The Convex Auth library's internal store cannot be invoked from another
    // module, so the user and its account row are written directly. This is
    // the same shape `createAccount` produces: provider "password", account id
    // the normalised email, and `secret` the hash produced by the same
    // hashSecret the provider is configured with.
    const userIds: Id<"users">[] = []
    for (const spec of staffSpecs) {
      const email = spec.email.toLowerCase()
      const isActive = email !== "sadia@jamaat.org"

      const userId = await ctx.db.insert("users", {
        name: spec.name,
        email,
        orgId,
        role: spec.role,
        isActive,
      })
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: email,
        secret,
      })
      userIds.push(userId)
    }

    /* ----------------------------------------------------------- banks */

    const bankIds: Id<"banks">[] = []
    const bankSpecs = [
      { name: "HDFC Bank — Andheri East", branch: "Andheri East", accountNumber: "50200034778912", ifscCode: "HDFC0000521", notes: "Primary operating account" },
      { name: "State Bank of India — Fort", branch: "Fort", accountNumber: "38291045612", ifscCode: "SBIN0000345", notes: "Zakat collection account" },
      { name: "ICICI Bank — Vile Parle", branch: "Vile Parle", accountNumber: "004705012893", ifscCode: "ICIC0000045", notes: "Project fund account" },
    ]
    for (const spec of bankSpecs) {
      bankIds.push(
        await ctx.db.insert("banks", { orgId, ...spec, createdAt: now }),
      )
    }

    /* ----------------------------------------------------------- funds */

    const fundIds: Record<string, Id<"funds">> = {}

    const fundRows = [
      { key: "contribution", name: "Monthly Contribution", type: "operational" as const, mode: "fixed_monthly" as const, description: "Rs 100 per member per month", bankIndex: 0, target: 12 * LAKH, monthly: MONTHLY_DUES_PAISE },
      { key: "friday", name: "Friday Fund", type: "general" as const, mode: "voluntary" as const, description: "Voluntary giving after Friday prayers — any amount, any member", bankIndex: 0, target: 5 * LAKH, monthly: null },
      { key: "reconstruction", name: "Mosque Reconstruction", type: "project" as const, mode: "pledge_based" as const, description: "Rebuilding the prayer hall and courtyard", bankIndex: 2, target: 60 * LAKH, monthly: null },
      { key: "zakat", name: "Zakat Fund", type: "zakat" as const, mode: "donation" as const, description: "Compulsory almsgiving collected during Ramadan", bankIndex: 1, target: 15 * LAKH, monthly: null },
      { key: "charity", name: "Charity Fund", type: "charity" as const, mode: "donation" as const, description: "Welfare disbursements and one-off gifts", bankIndex: 0, target: 8 * LAKH, monthly: null },
      { key: "emergency", name: "Emergency Reserve", type: "emergency" as const, mode: "donation" as const, description: "Held back for medical and unforeseen expenses", bankIndex: 0, target: 10 * LAKH, monthly: null },
    ]

    for (const spec of fundRows) {
      fundIds[spec.key] = await ctx.db.insert("funds", {
        orgId,
        name: spec.name,
        type: spec.type,
        collectionMode: spec.mode,
        description: spec.description,
        bankId: bankIds[spec.bankIndex],
        managerId: spec.mode === "pledge_based" ? userIds[2] : userIds[1],
        targetAmountPaise: spec.target ?? undefined,
        isActive: true,
        isMemberContribution: spec.mode === "fixed_monthly",
        monthlyAmountPaise: spec.monthly ?? undefined,
        createdAt: now,
      })
    }

    /* --------------------------------------------------------- members */

    // The first two members are fixed rather than generated, because M3's portal
    // is only demonstrable if there is a member with a real, matching email
    // address. Everything else here is random; these two rows are what let
    // `bun run visual` sign in as a member and see a real balance.
    //
    //   imran  — has an account, already linked. The happy path.
    //   ayesha — has an account, *not* linked. The self-claim path, including
    //            the claim screen and the treasurer's "still to claim" list.
    const PORTAL_MEMBERS = [
      { name: "Imran Shaikh", email: "imran@example.org" },
      { name: "Ayesha Khan", email: "ayesha@example.org" },
    ] as const

    const memberIds: Id<"members">[] = []
    for (let i = 0; i < MEMBER_COUNT; i++) {
      const portal = PORTAL_MEMBERS[i]
      const name = portal ? portal.name : `${FIRST_NAMES[i % FIRST_NAMES.length]} ${pick(LAST_NAMES)}`
      const joinedYear = rand() < 0.12 ? year - 1 : year - int(3, 12)
      const joinedMonth = rand() < 0.12 ? int(7, 9) : int(1, 6)
      const id = await ctx.db.insert("members", {
        orgId,
        name,
        phone: `9${int(100000000, 899999999)}`,
        email: portal
          ? portal.email
          : rand() < 0.55
            ? `${name.split(" ")[0].toLowerCase()}${i + 1}@example.org`
            : undefined,
        relation: pick(RELATIONS),
        joinedYear,
        joinedMonth,
        isActive: true,
        createdAt: now,
      })
      memberIds.push(id)
    }

    /* --------------------------------------------- member portal accounts */

    // Two `member`-role accounts. This is the first role in the system that is
    // signed in but is *not* on the committee, and it is the one that makes the
    // console's `requireConsole` gate meaningful: these two can reach the portal
    // and nothing else.
    //
    // Imran is linked to his record. Ayesha is deliberately *not*, so the claim
    // flow has something real to act on — and so the treasurer's screen has a
    // genuine "cannot see their own balance" row rather than a filtered-out one.
    const memberUserId = await ctx.db.insert("users", {
      name: "Imran Shaikh",
      email: "imran@example.org",
      orgId,
      role: "member",
      isActive: true,
    })
    await ctx.db.insert("authAccounts", {
      userId: memberUserId,
      provider: "password",
      providerAccountId: "imran@example.org",
      secret,
    })
    await ctx.db.patch(memberIds[0], { userId: memberUserId })

    const unclaimedUserId = await ctx.db.insert("users", {
      name: "Ayesha Khan",
      email: "ayesha@example.org",
      orgId,
      role: "member",
      isActive: true,
    })
    await ctx.db.insert("authAccounts", {
      userId: unclaimedUserId,
      provider: "password",
      providerAccountId: "ayesha@example.org",
      secret,
    })

    /* --------------------------------------- contributions, payments, ledger */

    const contributionFundId = fundIds.contribution
    const contributionBankId = bankIds[0]
    const monthlyPaise = MONTHLY_DUES_PAISE

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()

    const isOwed = (member: (typeof members)[number]) =>
      !(member.joinedYear === year && member.joinedMonth > month)

    let paymentSeq = 40
    let ledgerSeq = 0

    for (const member of members) {
      if (!member.isActive && rand() < 0.5) continue

      for (let m = 1; m <= month; m++) {
        if (!isOwed(member)) continue

        const age = month - m
        const paidChance = age >= 3 ? 0.94 : age === 1 ? 0.88 : 0.78
        const roll = rand()
        const status =
          roll < paidChance ? "paid" : roll < paidChance + 0.04 ? "waived" : "due"

        await ctx.db.insert("contributions", {
          orgId,
          memberId: member._id,
          fundId: contributionFundId,
          year,
          month: m,
          amountPaise: monthlyPaise,
          status,
          waivedReason:
            status === "waived"
              ? pick([
                  "Approved by committee — hardship",
                  "Approved by committee — senior member",
                  "Approved by committee — in service abroad",
                ])
              : undefined,
          waivedBy: status === "waived" ? userIds[0] : undefined,
        })

        if (status === "paid") {
          const day = int(4, 12)
          const paidAt = new Date(Date.UTC(year, m - 1, day, 10, 30)).toISOString()
          const method = pick(["cash", "upi", "cheque", "transfer"] as const)
          const receiptNo = `R-${String(++paymentSeq).padStart(5, "0")}`

          const paymentId = await ctx.db.insert("payments", {
            orgId,
            memberId: member._id,
            fundId: contributionFundId,
            bankId: contributionBankId,
            amountPaise: monthlyPaise,
            method,
            paidAt,
            collectedBy: pick([userIds[1], userIds[2]]),
            receiptNo,
            reference:
              method === "cheque"
                ? `CHQ ${int(100000, 999999)}`
                : method === "upi"
                  ? `UPI${int(100000000, 999999999)}`
                  : undefined,
            createdAt: now,
          })

          await ctx.db.insert("ledgerEntries", {
            orgId,
            fundId: contributionFundId,
            bankId: contributionBankId,
            memberId: member._id,
            amountPaise: monthlyPaise,
            direction: "credit",
            category: "donation",
            effectiveDate: paidAt,
            source: "payment",
            refType: "payment",
            refId: paymentId,
            note: `Monthly contribution — ${receiptNo}`,
            actorId: userIds[1],
            lockedTo: m <= 3 ? year : undefined,
          })
          ledgerSeq += 1
        }
      }
    }

    /* ------------------------------------------------- transactions */

    const txnSpecs = [
      { fund: "zakat", type: "deposit" as const, category: "donation" as const, description: "Ramzan collection box — Friday proceeds", amount: 128500, m: 4, d: 11, status: "approved" as const, by: 0 },
      { fund: "zakat", type: "deposit" as const, category: "donation" as const, description: "Eid dinner donations", amount: 96500, m: 4, d: 18, status: "approved" as const, by: 0 },
      { fund: "charity", type: "deposit" as const, category: "donation" as const, description: "Winter blanket drive — cash counter", amount: 61200, m: 1, d: 20, status: "approved" as const, by: 2 },
      { fund: "charity", type: "deposit" as const, category: "donation" as const, description: "Corporate donation — local bakery", amount: 150000, m: 2, d: 14, status: "approved" as const, by: 2 },
      { fund: "contribution", type: "withdrawal" as const, category: "maintenance" as const, description: "Hall deep clean and pest control", amount: 24000, m: 2, d: 6, status: "approved" as const, by: 0 },
      { fund: "contribution", type: "withdrawal" as const, category: "maintenance" as const, description: "Generator servicing — quarterly", amount: 18750, m: 5, d: 9, status: "approved" as const, by: 0 },
      { fund: "contribution", type: "withdrawal" as const, category: "operations" as const, description: "Electricity bill", amount: 41200, m: 6, d: 8, status: "approved" as const, by: 0 },
      { fund: "contribution", type: "withdrawal" as const, category: "operations" as const, description: "Water tanker — building dry run", amount: 9800, m: 7, d: 3, status: "approved" as const, by: 0 },
      { fund: "emergency", type: "deposit" as const, category: "donation" as const, description: "Sister society collection — medical aid", amount: 75000, m: 6, d: 22, status: "approved" as const, by: 0 },
      { fund: "emergency", type: "withdrawal" as const, category: "emergency" as const, description: "Urgent medical aid — member hospitalisation", amount: 50000, m: 7, d: 15, status: "approved" as const, by: 0 },
      { fund: "reconstruction", type: "deposit" as const, category: "donation" as const, description: "Reconstruction pledge — phase 2 launch", amount: 425000, m: 3, d: 21, status: "approved" as const, by: 2 },
      { fund: "reconstruction", type: "withdrawal" as const, category: "maintenance" as const, description: "Floor material — first instalment", amount: 310000, m: 5, d: 27, status: "approved" as const, by: 2 },
      { fund: "reconstruction", type: "withdrawal" as const, category: "maintenance" as const, description: "Contractor advance — labour", amount: 165000, m: 9, d: 12, status: "pending" as const, by: 2 },
      { fund: "reconstruction", type: "withdrawal" as const, category: "maintenance" as const, description: "Marble samples and transport", amount: 42000, m: 9, d: 18, status: "pending" as const, by: 2 },
      { fund: "friday", type: "deposit" as const, category: "donation" as const, description: "Friday collection — folded into the main account", amount: 84000, m: 8, d: 1, status: "approved" as const, by: 1 },
      { fund: "contribution", type: "withdrawal" as const, category: "salary" as const, description: "Imam and muazzin stipend", amount: 36000, m: 9, d: 20, status: "pending" as const, by: 1 },
      { fund: "reconstruction", type: "deposit" as const, category: "donation" as const, description: "Milestone 2 pledge collection", amount: 220000, m: 9, d: 22, status: "pending" as const, by: 2 },
      { fund: "contribution", type: "withdrawal" as const, category: "operations" as const, description: "Water tanker — building dry run", amount: 9800, m: 8, d: 5, status: "rejected" as const, by: 1, note: "Duplicate of July entry — rejected" },
    ]

    for (const spec of txnSpecs) {
      const fundId = fundIds[spec.fund]
      if (!fundId) continue
      const amountPaise = spec.amount * RUPEE
      const date = new Date(Date.UTC(year, spec.m - 1, spec.d, 11, 0)).toISOString()

      const txnId = await ctx.db.insert("transactions", {
        orgId,
        fundId,
        type: spec.type,
        amountPaise,
        description: spec.description,
        category: spec.category,
        status: spec.status,
        requestedBy: userIds[spec.by],
        approvedBy: spec.status === "pending" ? undefined : userIds[0],
        approvalNote: "note" in spec ? (spec.note as string) : undefined,
        transactionDate: date,
        createdAt: now,
      })

      if (spec.status === "approved") {
        const credit = spec.type === "deposit"
        const fundRow = fundRows.find((f) => f.key === spec.fund)
        const bankId = bankIds[fundRow ? fundRow.bankIndex : 0]
        await ctx.db.insert("ledgerEntries", {
          orgId,
          fundId,
          bankId,
          amountPaise: credit ? amountPaise : -amountPaise,
          direction: credit ? "credit" : "debit",
          category: spec.category,
          effectiveDate: date,
          source: "transaction",
          refType: "transaction",
          refId: txnId,
          note: spec.description,
          actorId: userIds[0],
          lockedTo: spec.m <= 3 ? year : undefined,
        })
        ledgerSeq += 1
      }
    }

    /* ------------------------------------------------ inter-fund transfer */

    const transferTxnId = await ctx.db.insert("transactions", {
      orgId,
      fundId: fundIds.contribution,
      type: "transfer_out",
      amountPaise: 500000,
      description: "Transfer to idle investment — surplus parked",
      category: "investment",
      toFundId: fundIds.investment,
      status: "approved",
      requestedBy: userIds[1],
      approvedBy: userIds[0],
      transactionDate: new Date(Date.UTC(year, 7, 28, 11, 0)).toISOString(),
      createdAt: now,
    })
    const transferDate = new Date(Date.UTC(year, 7, 28, 11, 0)).toISOString()
    await ctx.db.insert("ledgerEntries", {
      orgId,
      fundId: fundIds.contribution,
      bankId: bankIds[0],
      amountPaise: -500000,
      direction: "debit",
      category: "investment",
      effectiveDate: transferDate,
      source: "transfer",
      refType: "transaction",
      refId: transferTxnId,
      note: "Transfer out — surplus parked",
      actorId: userIds[0],
    })
    await ctx.db.insert("ledgerEntries", {
      orgId,
      fundId: fundIds.investment,
      bankId: bankIds[2],
      amountPaise: 500000,
      direction: "credit",
      category: "investment",
      effectiveDate: transferDate,
      source: "transfer",
      refType: "transaction",
      refId: transferTxnId,
      note: "Transfer in — surplus parked",
      actorId: userIds[0],
    })
    ledgerSeq += 2

    /* ----------------------------- Friday fund: rounds and voluntary gifts */

    // The Friday fund is voluntary: there are no dues, only dated sessions and
    // whatever people chose to give. Some gifts are anonymous, which is exactly
    // why `memberId` is nullable.
    const fridayFundId = fundIds.friday
    const fridayStart = new Date(Date.UTC(year, 5, 5)).getTime()
    const fridayBankId = bankIds[0]
    let anonymousGifts = 0
    let fridayRounds = 0

    for (let i = 0; i < 14; i++) {
      const date = new Date(fridayStart + i * 7 * 86400000)
      if (date.getTime() > now) break
      const dateIso = date.toISOString().slice(0, 10)

      const roundId = await ctx.db.insert("collectionRounds", {
        orgId,
        fundId: fridayFundId,
        date: dateIso,
        label: `Friday ${date.getUTCDate()} ${date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`,
        note: i % 5 === 0 ? "Ramadan month — longer session" : undefined,
        collectedBy: userIds[1],
        createdAt: date.getTime(),
      })
      fridayRounds += 1

      // Four to eight people give each Friday, at irregular amounts.
      const givers = int(4, 8)
      for (let g = 0; g < givers; g++) {
        // Every so often, someone gives without being named.
        const anonymous = rand() < 0.2
        if (anonymous) anonymousGifts += 1
        const memberId = anonymous ? undefined : memberIds[int(0, memberIds.length - 1)]
        const amountPaise = int(1, 15) * 100 * RUPEE
        const paidAt = new Date(date.getTime() + 20 * 3600000).toISOString()

        const paymentId = await ctx.db.insert("payments", {
          orgId,
          memberId,
          fundId: fridayFundId,
          bankId: fridayBankId,
          amountPaise,
          method: pick(["cash", "upi", "cash"] as const),
          paidAt,
          collectedBy: userIds[1],
          receiptNo: `F-${String(++fridayRounds).padStart(4, "0")}`,
          roundId,
          createdAt: date.getTime(),
        })

        await ctx.db.insert("ledgerEntries", {
          orgId,
          fundId: fridayFundId,
          bankId: fridayBankId,
          memberId,
          amountPaise,
          direction: "credit",
          category: "donation",
          effectiveDate: paidAt,
          source: "payment",
          refType: "payment",
          refId: paymentId,
          note: anonymous
            ? `Friday giving — anonymous, ${dateIso}`
            : `Friday giving — ${dateIso}`,
          actorId: userIds[1],
        })
        ledgerSeq += 1
      }
    }

    /* --------------------------- Reconstruction: pledges against a project */

    const reconstructionFundId = fundIds.reconstruction
    const allMembers = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()

    for (const member of allMembers) {
      if (!member.isActive) continue
      if (rand() < 0.55) continue // not everyone pledged

      const amountPledgedPaise = int(1, 60) * 1000 * RUPEE
      const fulfilled = rand() < 0.55
      await ctx.db.insert("pledges", {
        orgId,
        fundId: reconstructionFundId,
        memberId: member._id,
        amountPledgedPaise,
        status: fulfilled ? "fulfilled" : "promised",
        note: fulfilled ? undefined : "Awaiting transfer — reminded in August",
        createdAt: now - int(30, 240) * 86400000,
      })
    }

    /* --------------------------------- materialise balances from the ledger */

    // The seeder writes ledger entries directly, so it must build the
    // materialised balances itself — exactly what the ledger writer does during
    // normal use. Run afterwards, this is the same thing
    // `balances:verify` would independently confirm.
    const allEntries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_date", (q) => q.eq("orgId", orgId))
      .collect()
    // `truthFromEntries` is the single definition of which scopes an entry moves.
    // The seeder used to keep its own copy of that list — fund, bank, member —
    // and M2d added a fourth scope, `bank_year`, without the seeder following.
    // The result was that a freshly seeded deployment failed `bun run check` with
    // three `bank_year` mismatches, and the only reason it went unnoticed is that
    // this workspace's data had been through `balances:backfill` by hand.
    //
    // Duplicating the scope rules is exactly what that function's own comment
    // warns against ("that duplication is how a scope quietly stops being
    // verified"), so the seeder now calls it instead of restating it.
    const running = truthFromEntries(allEntries)
    for (const [key, amountPaise] of running) {
      const separator = key.indexOf(":")
      const scope = key.slice(0, separator)
      const scopeId = key.slice(separator + 1)
      await ctx.db.insert("balances", {
        orgId,
        scope: scope as "fund" | "bank" | "bank_year" | "member",
        scopeId,
        amountPaise,
        updatedAt: now,
      })
    }

    /* ------------------------------------------------------ audit log */

    const auditSpecs: Array<[string, string, string | null, string]> = [
      ["fund.updated", "fund", fundIds.reconstruction, "Reconstruction target raised"],
      ["transaction.approved", "transaction", transferTxnId, "Inter-fund transfer to idle investment"],
      ["member.updated", "member", memberIds[13], "Marked inactive — relocated"],
      ["bank.updated", "bank", bankIds[0], "Branch address corrected"],
      ["user.updated", "user", userIds[4], "Deactivated — left the committee"],
    ]
    for (const [action, entityType, entityId, details] of auditSpecs) {
      await ctx.db.insert("auditLog", {
        orgId,
        userId: userIds[0],
        action,
        entityType,
        entityId: entityId ?? undefined,
        details,
        createdAt: now - int(1, 6) * 86400000,
      })
    }

    return {
      orgId,
      users: staffSpecs.length,
      banks: bankIds.length,
      funds: Object.keys(fundIds).length,
      members: memberIds.length,
      ledgerEntries: ledgerSeq,
      balances: running.size,
      fridayRounds,
      anonymousGifts,
      monthlyDues: MONTHLY_DUES_PAISE / 100,
      demoPassword: DEMO_PASSWORD,
      signInAs: staffSpecs[0].email,
    }
  },
})

/**
 * Back-fill the demo organisation's real history.
 *
 * The community was founded in 2018 and the books were kept in a spreadsheet
 * until now, so the real thing will have eight years of contributions, Friday
 * collections and expenditure. Nine months of demo data is not a test of that:
 * at eight years the ledger is around 12k entries, which is most of the way to
 * the 16384-document limit a single Convex query can read.
 *
 * So this generates the history the community actually has, and the point is
 * to then run `bun run measure` and confirm the read models do not grow with
 * it. Only `fixed_monthly` dues get chased and collected, so old months are
 * almost entirely paid; the Friday fund gets a round most weeks with a handful
 * of irregular gifts, some of them anonymous.
 *
 * Guarded exactly like the other seed entry points: demo slug plus an explicit
 * confirm string, and deleted before real data loads. See docs/ROADMAP.md -> M8.
 *
 * One year per call, because Convex allows 16000 writes in a single mutation
 * and a year of dues for 84 members is already ~3000 documents before the
 * Friday rounds and the spending. `bun run seed:history` drives the loop.
 *
 *   bunx convex run seed:seedHistory '{"confirm":"backfill history","year":2018}'
 */
export const seedHistory = mutation({
  args: {
    confirm: v.optional(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== "backfill history") {
      throw new Error('Pass { "confirm": "backfill history" } to run this')
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .first()
    if (!org) {
      throw new Error("Seed the demo data first: bunx convex run seed:seedDemo")
    }
    const orgId = org._id

    const [funds, banks, users] = await Promise.all([
      ctx.db
        .query("funds")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("banks")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ])
    const byName = new Map(funds.map((f) => [f.name, f]))
    const contributionFund = byName.get("Monthly Contribution")
    const fridayFund = byName.get("Friday Fund")
    const zakatFund = byName.get("Zakat Fund")
    const charityFund = byName.get("Charity Fund")
    const reconstructionFund = byName.get("Mosque Reconstruction")
    if (!contributionFund || !fridayFund) {
      throw new Error("The demo funds are not present — re-seed first")
    }
    const operatingBank = banks[0]
    const userIds = users.map((u) => u._id)

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
    // Every member's join date is pulled back to the community's founding so
    // the history is continuous rather than a cloud of late arrivals.
    const founded = Math.min(...members.map((m) => m.joinedYear))

    const now = Date.now()
    const thisYear = new Date().getUTCFullYear()
    const startYear = founded
    const endYear = thisYear - 1
    const target = args.year
    if (target === undefined) {
      throw new Error(
        `Pass a "year" between ${startYear} and ${endYear}. One year per call: ` +
          "Convex allows 16000 writes per mutation, and a year is already " +
          "several thousand documents. Use `bun run seed:history` to drive it.",
      )
    }
    if (target < startYear || target > endYear) {
      throw new Error(`Year ${target} is outside ${startYear}..${endYear}`)
    }
    // Re-running a year would duplicate it, and the driver script may need to
    // resume after the local deployment's write-rate limit intervenes.
    const alreadySeeded = await ctx.db
      .query("contributions")
      .withIndex("by_org_year", (q) => q.eq("orgId", orgId).eq("year", target))
      .first()
    if (alreadySeeded) {
      return {
        year: target,
        skipped: true,
        reason: "that year is already seeded",
      }
    }
    // A stable per-year seed so re-running one year reproduces the same rows.
    const rand = rng(20180101 + target)
    const int = (min: number, max: number) =>
      Math.floor(rand() * (max - min + 1)) + min
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

    let contributions = 0
    let payments = 0
    let ledger = 0
    let rounds = 0
    let txnSeq = target * 1000

    /**
     * Accumulate what each ledger entry does to the materialised balances, as
     * it is written. This is the same accounting the ledger writer performs
     * during normal use; doing it here means the seeder never has to read the
     * ledger back, which at eight years a mutation cannot do.
     *
     * The four scopes here are exactly the four `truthFromEntries` produces,
     * which `bun run check` then verifies against. They have to agree: a scope
     * that is written here but not verified there (or the reverse) is a scope
     * that silently stops being trustworthy. `bank_year` was the one this helper
     * forgot, and the symptom was 24 mismatches after back-filling eight years —
     * a historical bank passbook working from a materialised movement total that
     * was zero for every year before 2026.
     */
    const running = new Map<string, number>()
    const record = (
      scopeId: string | undefined,
      amountPaise: number,
      extra?: { bankId?: string; memberId?: string; year?: number },
    ) => {
      const add = (key: string) =>
        running.set(key, (running.get(key) ?? 0) + amountPaise)
      if (scopeId) add(`fund:${scopeId}`)
      if (extra?.bankId) {
        add(`bank:${extra.bankId}`)
        if (extra.year !== undefined) {
          add(`bank_year:${extra.bankId}:${extra.year}`)
        }
      }
      if (extra?.memberId) add(`member:${extra.memberId}`)
    }

    for (let y = target; y <= target; y++) {
      /* ------------------------------ monthly dues, one row per member-month */
      for (const member of members) {
        if (y < member.joinedYear) continue
        const firstMonth = y === member.joinedYear ? member.joinedMonth : 1

        for (let m = firstMonth; m <= 12; m++) {
          // Old dues were chased and collected; only the last year or so of
          // history carries the tail of unpaid months that is still open today.
          const paidChance = thisYear - y >= 2 ? 0.985 : 0.9
          const roll = rand()
          const status =
            roll < paidChance
              ? "paid"
              : roll < paidChance + 0.005
                ? "waived"
                : "due"

          await ctx.db.insert("contributions", {
            orgId,
            memberId: member._id,
            fundId: contributionFund._id,
            year: y,
            month: m,
            amountPaise: MONTHLY_DUES_PAISE,
            status,
            waivedReason:
              status === "waived"
                ? "Approved by committee — hardship"
                : undefined,
          })
          contributions += 1

          if (status !== "paid") continue

          const day = int(3, 14)
          const paidAt = new Date(Date.UTC(y, m - 1, day, 10, 30)).toISOString()
          const method = pick(["cash", "upi", "cheque", "transfer"] as const)
          const receiptNo = `R-${String(++txnSeq).padStart(6, "0")}`

          const paymentId = await ctx.db.insert("payments", {
            orgId,
            memberId: member._id,
            fundId: contributionFund._id,
            bankId: operatingBank._id,
            amountPaise: MONTHLY_DUES_PAISE,
            method,
            paidAt,
            collectedBy: pick(userIds),
            receiptNo,
            reference:
              method === "cheque"
                ? `CHQ ${int(100000, 999999)}`
                : method === "upi"
                  ? `UPI${int(100000000, 999999999)}`
                  : undefined,
            createdAt: new Date(paidAt).getTime(),
          })
          payments += 1

          await ctx.db.insert("ledgerEntries", {
            orgId,
            fundId: contributionFund._id,
            bankId: operatingBank._id,
            memberId: member._id,
            amountPaise: MONTHLY_DUES_PAISE,
            direction: "credit",
            category: "donation",
            effectiveDate: paidAt,
            source: "payment",
            refType: "payment",
            refId: paymentId,
            note: `Monthly contribution — ${receiptNo}`,
            actorId: pick(userIds),
            lockedTo: y < thisYear - 1 ? y : undefined,
          })
          record(contributionFund._id, MONTHLY_DUES_PAISE, {
            bankId: operatingBank._id,
            memberId: member._id,
            year: y,
          })
          ledger += 1
        }
      }

      /* ---------------------------- Friday rounds, and the gifts in them */
      for (let i = 0; i < 52; i++) {
        const date = new Date(Date.UTC(y, 0, 2 + i * 7))
        const dateIso = date.toISOString().slice(0, 10)

        const roundId = await ctx.db.insert("collectionRounds", {
          orgId,
          fundId: fridayFund._id,
          date: dateIso,
          label: `Friday ${date.getUTCDate()} ${date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`,
          collectedBy: pick(userIds),
          createdAt: date.getTime(),
        })
        rounds += 1

        for (let g = 0, n = int(5, 11); g < n; g++) {
          const anonymous = rand() < 0.18
          const giftMemberId = anonymous
            ? undefined
            : members[int(0, members.length - 1)]._id
          const giftPaise = int(1, 12) * 100 * RUPEE
          const paidAt = new Date(date.getTime() + 20 * 3600000).toISOString()
          const paymentId = await ctx.db.insert("payments", {
            orgId,
            memberId: giftMemberId,
            fundId: fridayFund._id,
            bankId: operatingBank._id,
            amountPaise: giftPaise,
            method: pick(["cash", "upi", "cash"] as const),
            paidAt,
            collectedBy: pick(userIds),
            receiptNo: `F-${String(rounds).padStart(4, "0")}-${g + 1}`,
            roundId,
            createdAt: date.getTime(),
          })
          payments += 1

          await ctx.db.insert("ledgerEntries", {
            orgId,
            fundId: fridayFund._id,
            bankId: operatingBank._id,
            memberId: giftMemberId,
            amountPaise: giftPaise,
            direction: "credit",
            category: "donation",
            effectiveDate: paidAt,
            source: "payment",
            refType: "payment",
            refId: paymentId,
            note: anonymous
              ? `Friday giving — anonymous, ${dateIso}`
              : `Friday giving — ${dateIso}`,
            actorId: pick(userIds),
            lockedTo: y < thisYear - 1 ? y : undefined,
          })
          record(fridayFund._id, giftPaise, {
            bankId: operatingBank._id,
            memberId: giftMemberId,
            year: y,
          })
          ledger += 1
        }
      }

      /* ------------------------------ the year's spending and its occasions */
      const spendSpecs = [
        { fund: zakatFund, type: "deposit" as const, category: "donation" as const, description: "Ramzan collection box", amount: 90000 + int(0, 40) * 1000, m: 4, d: 11 },
        { fund: zakatFund, type: "deposit" as const, category: "donation" as const, description: "Eid dinner donations", amount: 70000 + int(0, 30) * 1000, m: 4, d: 18 },
        { fund: charityFund, type: "deposit" as const, category: "donation" as const, description: "Winter blanket drive", amount: 45000 + int(0, 25) * 1000, m: 1, d: 20 },
        { fund: contributionFund, type: "withdrawal" as const, category: "maintenance" as const, description: "Hall deep clean and pest control", amount: 22000 + int(0, 8) * 1000, m: 2, d: 6 },
        { fund: contributionFund, type: "withdrawal" as const, category: "salary" as const, description: "Imam and muazzin stipend", amount: 33000 + int(0, 6) * 1000, m: 9, d: 20 },
        { fund: contributionFund, type: "withdrawal" as const, category: "operations" as const, description: "Electricity bill", amount: 36000 + int(0, 14) * 1000, m: 6, d: 8 },
        { fund: contributionFund, type: "withdrawal" as const, category: "operations" as const, description: "Water tanker", amount: 8000 + int(0, 4) * 1000, m: 7, d: 3 },
        { fund: reconstructionFund, type: "deposit" as const, category: "donation" as const, description: "Reconstruction pledge instalment", amount: 250000 + int(0, 90) * 1000, m: 3, d: 21 },
        { fund: reconstructionFund, type: "withdrawal" as const, category: "maintenance" as const, description: "Material and labour", amount: 180000 + int(0, 70) * 1000, m: 6, d: 14 },
      ]
      for (const spec of spendSpecs) {
        if (!spec.fund) continue
        const amountPaise = spec.amount * RUPEE
        const date = new Date(Date.UTC(y, spec.m - 1, spec.d, 11, 0)).toISOString()
        const txnId = await ctx.db.insert("transactions", {
          orgId,
          fundId: spec.fund._id,
          type: spec.type,
          amountPaise,
          description: spec.description,
          category: spec.category,
          status: "approved",
          requestedBy: pick(userIds),
          approvedBy: pick(userIds),
          transactionDate: date,
          createdAt: new Date(date).getTime(),
        })
        const fundBank =
          banks.find((b) => b._id === spec.fund?.bankId) ?? operatingBank
        await ctx.db.insert("ledgerEntries", {
          orgId,
          fundId: spec.fund._id,
          bankId: fundBank._id,
          amountPaise: spec.type === "deposit" ? amountPaise : -amountPaise,
          direction: spec.type === "deposit" ? "credit" : "debit",
          category: spec.category,
          effectiveDate: date,
          source: "transaction",
          refType: "transaction",
          refId: txnId,
          note: spec.description,
          actorId: pick(userIds),
          lockedTo: y < thisYear - 1 ? y : undefined,
        })
        record(spec.fund._id, spec.type === "deposit" ? amountPaise : -amountPaise, {
          bankId: fundBank._id,
          year: y,
        })
        ledger += 1
      }
    }

    // `thisYear` is already fully seeded by `seedDemo`, so the loop above
    // deliberately stops at `endYear`.

    // Materialise the balances for everything this year wrote.
    //
    // The running map is accumulated as the rows are written rather than by
    // re-reading the ledger afterwards: a mutation may read 4096 documents, and
    // by the last year of history the ledger alone is well past that. This is
    // exactly what the ledger writer does during normal use, and
    // `balances:verify` then confirms the invariant independently.
    const existingBalances = await ctx.db
      .query("balances")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
    const existing = new Map(
      existingBalances.map((r) => [`${r.scope}:${r.scopeId}`, r]),
    )

    // `running` holds this year's *deltas*, so an existing balance is moved by
    // the delta rather than replaced by it.
    for (const [key, deltaPaise] of running) {
      const row = existing.get(key)
      if (row) {
        if (deltaPaise === 0) continue
        await ctx.db.patch(row._id, {
          amountPaise: row.amountPaise + deltaPaise,
          updatedAt: now,
        })
        continue
      }
      const index = key.indexOf(":")
      await ctx.db.insert("balances", {
        orgId,
        scope: key.slice(0, index) as "fund" | "bank" | "bank_year" | "member",
        scopeId: key.slice(index + 1),
        amountPaise: deltaPaise,
        updatedAt: now,
      })
    }

    return {
      orgId,
      year: target,
      from: startYear,
      to: endYear,
      contributions,
      payments,
      ledgerEntriesAdded: ledger,
      fridayRounds: rounds,
      balances: running.size,
    }
  },
})
