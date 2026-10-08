-- The invariant the whole application rests on.
--
--   A materialised balance must always equal the sum of its ledger entries.
--
-- `convex/lib/balances.ts` states it, `balances.recomputeAll` rebuilds the rows
-- from the entries, and `balances:verify` reports any disagreement. This is the
-- same rule expressed as SQL, and it is stage 0 of the port for one reason: the
-- port replaces the thing that currently *guarantees* it — a Convex mutation
-- being a serialisable transaction — and this query is what proves the
-- replacement still holds.
--
-- It is written to be readable by a person, because the argument for this
-- application is that its books can be checked. A treasurer or an auditor should
-- be able to run it and understand the answer.
--
-- ## The four scopes, and the one that is not a balance
--
--   fund:<fundId>            the money in a fund
--   bank:<bankId>            the money in an account
--   member:<memberId>        what a member has given
--   bank_year:<bankId>:<Y>   the *movement* through an account during year Y
--
-- `bank_year` is not a running balance, and that is what makes it safe: an entry
-- dated in year Y moves that year and nothing else, so a backdated entry does not
-- invalidate every later year. It exists so a historical passbook can work out
-- its opening balance from a handful of rows rather than re-reading the ledger.
--
-- An entry moves only the scopes it names, so an entry with no `fund_id` moves no
-- fund. A row that is missing entirely counts: reads treat an absent balance as
-- zero, so a missing row against a non-zero truth is a real disagreement.
--
-- Returns one row per disagreement, so an empty result is the pass condition.

WITH truth AS (
  SELECT org_id, 'fund' AS scope, fund_id AS scope_id, sum(amount_paise) AS amount_paise
    FROM ledger_entries
   WHERE fund_id IS NOT NULL
   GROUP BY org_id, fund_id

  UNION ALL

  SELECT org_id, 'bank', bank_id, sum(amount_paise)
    FROM ledger_entries
   WHERE bank_id IS NOT NULL
   GROUP BY org_id, bank_id

  UNION ALL

  SELECT org_id, 'bank_year', bank_id || ':' || substr(effective_date, 1, 4), sum(amount_paise)
    FROM ledger_entries
   WHERE bank_id IS NOT NULL
   GROUP BY org_id, bank_id, substr(effective_date, 1, 4)

  UNION ALL

  SELECT org_id, 'member', member_id, sum(amount_paise)
    FROM ledger_entries
   WHERE member_id IS NOT NULL
   GROUP BY org_id, member_id
)
SELECT
  coalesce(m.org_id, t.org_id) AS org_id,
  coalesce(m.scope, t.scope) AS scope,
  coalesce(m.scope_id, t.scope_id) AS scope_id,
  m.amount_paise AS materialised_paise,
  coalesce(t.amount_paise, 0) AS ledger_paise,
  coalesce(m.amount_paise, 0) - coalesce(t.amount_paise, 0) AS difference_paise,
  CASE
    WHEN m.id IS NULL THEN 'no balance row for these entries'
    WHEN t.scope_id IS NULL THEN 'a balance row with no entries behind it'
    ELSE 'the balance disagrees with its entries'
  END AS reason
FROM balances m
FULL OUTER JOIN truth t
  ON t.org_id = m.org_id AND t.scope = m.scope AND t.scope_id = m.scope_id
WHERE coalesce(m.amount_paise, 0) <> coalesce(t.amount_paise, 0)
ORDER BY org_id, scope, scope_id;