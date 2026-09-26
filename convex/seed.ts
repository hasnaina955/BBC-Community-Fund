import { mutation } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { hashSecret } from "./lib/password"

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

const DEMO_PASSWORD = "community123"

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
const MEMBER_COUNT = 120

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
      slug: "jamaat-anjuman",
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
      { key: "contribution", name: "Member Contribution Fund", type: "operational" as const, description: "Monthly subscriptions from all active members", bankIndex: 0, target: 30 * LAKH, monthly: 500 * RUPEE },
      { key: "zakat", name: "Zakat Fund", type: "zakat" as const, description: "Compulsory almsgiving collected during Ramadan", bankIndex: 1, target: 15 * LAKH, monthly: null },
      { key: "charity", name: "Charity Fund", type: "charity" as const, description: "Donations and welfare disbursements", bankIndex: 0, target: 8 * LAKH, monthly: null },
      { key: "emergency", name: "Emergency Reserve", type: "emergency" as const, description: "Held back for medical and unforeseen expenses", bankIndex: 0, target: 10 * LAKH, monthly: null },
      { key: "renovation", name: "Mosque Renovation", type: "project" as const, description: "Phase 2 — replacing the main hall flooring", bankIndex: 2, target: 40 * LAKH, monthly: null },
      { key: "investment", name: "Idle Investment", type: "investment" as const, description: "Surplus parked in a short-term deposit", bankIndex: 2, target: null, monthly: null },
    ]

    for (const spec of fundRows) {
      fundIds[spec.key] = await ctx.db.insert("funds", {
        orgId,
        name: spec.name,
        type: spec.type,
        description: spec.description,
        bankId: bankIds[spec.bankIndex],
        managerId: spec.key === "renovation" || spec.key === "charity" || spec.key === "investment"
          ? userIds[2]
          : userIds[1],
        targetAmountPaise: spec.target ?? undefined,
        isActive: true,
        isMemberContribution: spec.monthly !== null,
        monthlyAmountPaise: spec.monthly ?? undefined,
        createdAt: now,
      })
    }

    /* --------------------------------------------------------- members */

    const memberIds: Id<"members">[] = []
    for (let i = 0; i < MEMBER_COUNT; i++) {
      const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${pick(LAST_NAMES)}`
      const joinedYear = rand() < 0.12 ? year - 1 : year - int(3, 12)
      const joinedMonth = rand() < 0.12 ? int(7, 9) : int(1, 6)
      const id = await ctx.db.insert("members", {
        orgId,
        name,
        phone: `9${int(100000000, 899999999)}`,
        email: rand() < 0.55 ? `${name.split(" ")[0].toLowerCase()}${i + 1}@example.org` : undefined,
        relation: pick(RELATIONS),
        joinedYear,
        joinedMonth,
        isActive: rand() < 0.94,
        createdAt: now,
      })
      memberIds.push(id)
    }

    /* --------------------------------------- contributions, payments, ledger */

    const contributionFundId = fundIds.contribution
    const contributionBankId = bankIds[0]
    const monthlyPaise = 500 * RUPEE

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
      { fund: "renovation", type: "deposit" as const, category: "donation" as const, description: "Renovation pledge — Phase 2 launch", amount: 425000, m: 3, d: 21, status: "approved" as const, by: 2 },
      { fund: "renovation", type: "withdrawal" as const, category: "maintenance" as const, description: "Floor material — first instalment", amount: 310000, m: 5, d: 27, status: "approved" as const, by: 2 },
      { fund: "renovation", type: "withdrawal" as const, category: "maintenance" as const, description: "Contractor advance — labour", amount: 165000, m: 9, d: 12, status: "pending" as const, by: 2 },
      { fund: "renovation", type: "withdrawal" as const, category: "maintenance" as const, description: "Marble samples and transport", amount: 42000, m: 9, d: 18, status: "pending" as const, by: 2 },
      { fund: "contribution", type: "withdrawal" as const, category: "salary" as const, description: "Imam and muazzin stipend", amount: 36000, m: 9, d: 20, status: "pending" as const, by: 1 },
      { fund: "renovation", type: "deposit" as const, category: "donation" as const, description: "Milestone 2 pledge collection", amount: 220000, m: 9, d: 22, status: "pending" as const, by: 2 },
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

    /* ------------------------------------------------------ audit log */

    const auditSpecs: Array<[string, string, string | null, string]> = [
      ["fund.updated", "fund", fundIds.renovation, "Renovation target raised"],
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
      demoPassword: DEMO_PASSWORD,
      signInAs: staffSpecs[0].email,
    }
  },
})
