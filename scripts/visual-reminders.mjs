/**
 * The M5 group for the browser suite: `bun run visual`.
 *
 * ## Why this is its own file
 *
 * `scripts/visual-check.mjs` has grown past two and a half thousand lines, and
 * the file tool that edits it loses sight of everything past roughly the
 * fifteen-hundredth. A group added at the end of the run could not be corrected
 * afterwards, which is not a good property for the file that decides whether the
 * product works. So the group lives here, takes the harness's helpers as an
 * argument, and the suite calls it in order.
 *
 * That is the only reason it is a separate file. The assertions are ordinary.
 */

import { existsSync, readFileSync } from "node:fs"

/**
 * The same parser the app's own test suite uses, imported rather than
 * reimplemented — a CSV parser written twice is a parser that disagrees with
 * itself exactly when it matters.
 */
const { parseCsv } = await import("../src/lib/csv.ts")

/**
 * @param {object} h the harness: page, group, check, settle, shot, newNoise,
 *   quietSince, noiseReport, has, mainText, bodyText, BASE.
 */
export async function runRemindersGroup(h) {
  const { page, group, check, settle, shot, newNoise, quietSince, noiseReport, has, mainText, bodyText, BASE } = h

  /*
   * M5. The screen a treasurer opens on the 11th of the month.
   *
   * The assertions that matter are the ones about *not overstating*: that the
   * screen says plainly that nothing is being sent, and offers no button
   * claiming otherwise. A treasury tool that reports "reminded 61 people" when
   * it has sent nothing is worse than one that admits it is not connected yet.
   *
   * It also runs a real campaign, because a screen that has only ever rendered
   * an empty state is not evidence of anything.
   */
  group("reminders — who owes what, and who we have already chased")
  const mark = newNoise()
  await page.goto(`${BASE}/reminders`, { waitUntil: "domcontentloaded" })
  await settle("/reminders")

  const listText = await mainText()
  check(
    "the screen is honest that nothing is being sent yet",
    has(listText, "No message provider is connected yet") && has(listText, "still recorded in full"),
    listText.replace(/\s+/g, " ").slice(0, 140),
  )
  check(
    "it offers no button that would claim to have sent something",
    !/send (all|everyone)|email now|send reminders now/i.test(await bodyText()),
    "a send button is present while no provider is configured",
  )

  const bucketPaise = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="bucket-"]')].map((el) => {
      const value = el.querySelector(".tabular-nums")?.textContent ?? ""
      const digits = value.replace(/[^\d]/g, "")
      return digits ? Number(digits) : 0
    }),
  )
  check(
    "the ageing is presented in buckets, not as one undifferentiated total",
    bucketPaise.length === 5 && bucketPaise.some((v) => v > 0),
    `${bucketPaise.length} buckets: ${bucketPaise.join(", ")}`,
  )

  // The point of ageing by days: someone owing since 2019 is listed above
  // someone who merely missed last month, because that is the ring order. The
  // row carries the raw day count so the order is asserted rather than inferred
  // from how the first few names happen to read.
  // Scoped to the defaulter table: the runs table is also a `<tbody>`, and its
  // rows carry no day count, so an unscoped read compares against NaN and the
  // ordering assertion fails for a reason that has nothing to do with the order.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="defaulter-table"] tbody tr')].map((el) => ({
      name: (el.querySelector("td")?.textContent ?? "").trim(),
      days: Number(el.dataset.days ?? "NaN"),
    })),
  )
  check(
    "the defaulter list is populated",
    rows.length >= 5 && new Set(rows.map((r) => r.name)).size >= 5,
    `${rows.length} rows: ${rows.slice(0, 3).map((r) => r.name).join(", ")}`,
  )
  check(
    "the list is sorted longest-outstanding first",
    rows.every((r, i) => i === 0 || rows[i - 1].days >= r.days),
    rows.slice(0, 5).map((r) => r.days).join(", "),
  )
  check(
    "nobody on the list is described as owing nothing",
    !/owing nothing/i.test(listText),
    "a row reports a zero balance",
  )

  const search = page.getByLabel("Search members by name")
  await search.fill("zzzz-no-such-member")
  await page.waitForTimeout(300)
  const empty = await mainText()
  check(
    "a search with no matches says so rather than showing everyone",
    has(empty, "Nobody matches that"),
    empty.replace(/\s+/g, " ").slice(0, 120),
  )
  await search.fill("")
  await page.waitForTimeout(300)

  // The run. A campaign is written and the outcome is stated, not implied by a
  // spinner that stops.
  await page.getByRole("button", { name: /remind everyone unpaid/i }).click()
  // The dialog is portalled outside <main>, so this reads the whole document
  // rather than the console's content region.
  const confirmText = await bodyText()
  check(
    "pressing the button asks before queueing anything",
    has(confirmText, "Remind everyone unpaid?") && /\d+\s+member/.test(confirmText),
    confirmText.replace(/\s+/g, " ").slice(0, 140),
  )
  await page.getByRole("button", { name: /^Queue \d+ reminder/i }).click()
  await page.waitForTimeout(1500)

  const after = await mainText()
  check(
    "the run is recorded and the outcome is stated plainly",
    /(queued)/i.test(after) && has(after, "manual"),
    after.replace(/\s+/g, " ").slice(0, 140),
  )
  check(
    "the runs table has a row, because a run is a record and not a loop",
    has(after, "Overdue"),
    after.replace(/\s+/g, " ").slice(0, 140),
  )

  await page.getByRole("button", { name: /reminder history for/i }).first().click()
  await page.waitForTimeout(800)
  const historyText = await mainText()
  check(
    "a member's reminder history is readable",
    has(historyText, "Reminder history") && /(queued|sent|delivered|Never reminded)/i.test(historyText),
    historyText.replace(/\s+/g, " ").slice(0, 140),
  )
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)

  await exportChecks({ page, check })

  await shot("16-reminders")
  check("the reminders screen produced no runtime errors", quietSince(mark), noiseReport(mark))
}

/**
 * The CSV export, read back off the disk.
 *
 * Everything else in this group proves the screen renders. This proves a *file*
 * — a button that builds a correct-looking string and never hands it to the
 * browser passes every other check here, and the treasurer discovers it at the
 * worst possible moment, which is standing in front of the committee.
 *
 * So the download is captured, written to a real path, and parsed. The
 * assertions are deliberately about agreement between three things that can
 * drift apart: the row on screen, the row in the file, and the server's own
 * total.
 */
async function exportChecks({ page, check }) {
  // Re-read the table rather than reusing the `rows` captured at the top of the
  // group. A campaign ran in between, which is not expected to reorder the list,
  // but "not expected to" is exactly the kind of assumption that makes a check
  // pass for the wrong reason. What is on screen now is the only thing that
  // matters.
  const readRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="defaulter-table"] tbody tr')].map((el) => ({
        name: (el.querySelector("td")?.textContent ?? "").replace(/opted out$/, "").trim(),
        days: Number(el.dataset.days ?? "NaN"),
      })),
    )

  const rows = await readRows()
  const visible = rows.length

  // The button promises a row count before it is pressed, so a treasurer knows
  // whether they are about to export the whole list or the filtered one. An
  // export that silently ignores the search box is the wrong file, and this is
  // the only place the user gets a chance to notice before it happens.
  const buttonLabel = await page
    .getByTestId("export-defaulter-csv")
    .evaluate((el) => ({
      text: el.textContent ?? "",
      title: el.getAttribute("title") ?? "",
      label: el.getAttribute("aria-label") ?? "",
    }))
  check(
    "the export button says how many rows it will write before it is pressed",
    new RegExp(`of all ${visible} members`).test(
      `${buttonLabel.text} ${buttonLabel.title} ${buttonLabel.label}`,
    ),
    `${JSON.stringify(buttonLabel.text)} / ${JSON.stringify(buttonLabel.title)}`,
  )

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByTestId("export-defaulter-csv").click(),
  ])

  const suggested = download.suggestedFilename()
  check(
    "the download is a dated CSV named after the organisation",
    /^[a-z0-9-]+-arrears-\d{4}-\d{2}-\d{2}\.csv$/.test(suggested),
    suggested,
  )

  const path = await download.path()
  check("a file actually reached the disk", !!path && existsSync(path), String(path))

  const raw = readFileSync(path, "utf8")
  const records = parseCsv(raw)

  check(
    "the file starts with a byte-order mark, so Excel reads it as UTF-8",
    raw.charCodeAt(0) === 0xfeff,
    `first code point U+${raw.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  const header = records[0] ?? []
  check(
    "the header names the columns the screen shows",
    header[0] === "Member" && header[1] === "Outstanding (INR)" && header.length >= 8,
    header.join(" | "),
  )

  // The load-bearing assertion: one record per row on screen, so the file is
  // the list and not a sample of it.
  check(
    "the file holds exactly the rows the screen is showing",
    records.length - 1 === visible,
    `${records.length - 1} records for ${visible} rows on screen`,
  )

  // The first data row must be the first row in the DOM, in the same order.
  // This is what makes the export *sorted* rather than merely complete.
  const firstName = records[1]?.[0] ?? ""
  const firstScreenName = rows[0]?.name ?? ""
  check(
    "the first record is the first row on screen, so the sort order is kept",
    firstScreenName.length > 0 && firstName === firstScreenName,
    `file says ${JSON.stringify(firstName)}, screen says ${JSON.stringify(firstScreenName)}`,
  )

  // Cross-check the money against the server's own figure rather than against
  // a number this suite also computed, so the two are genuinely independent.
  const fileTotal = records
    .slice(1)
    .reduce((sum, r) => sum + (Number(r[1]) || 0), 0)
  const screenTotal = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="outstanding-total"]')
    return el?.getAttribute("data-paise") ?? null
  })
  const outstandingPaise = Number(screenTotal)
  const matchesServer =
    screenTotal === null
      ? null
      : Math.abs(fileTotal * 100 - outstandingPaise) < 1
  check(
    "the amounts in the file total the same as the server's outstanding figure",
    matchesServer === true,
    `file totals ${fileTotal.toFixed(2)} rupees against the server's ${outstandingPaise}`,
  )

  check(
    "amounts are plain numbers a spreadsheet can sum, not formatted currency",
    records.slice(1).every((r) => r[1] === "" || /^\d+(\.\d+)?$/.test(r[1])),
    records.slice(1, 4).map((r) => r[1]).join(", "),
  )

  check(
    "no record was split by a stray delimiter in a name",
    records.every((r) => r.length === header.length),
    records.map((r) => r.length).join(","),
  )

  // The export must carry exactly the columns the screen shows. A phone number
  // in this file is a privacy posture change the screen deliberately did not
  // make, so it is asserted rather than assumed: no email-shaped value, and no
  // bare ten-digit number, anywhere in the data records.
  const dataText = records.slice(1).map((r) => r.join(" ")).join(" ")
  check(
    "the export never carries a member's phone number or email",
    !dataText.includes("@") && !/\b\d{10}\b/.test(dataText),
    header.includes("Reachable by")
      ? "the channel is named, but the destination must not be"
      : "no address-shaped value in any record",
  )
  check(
    "the export names the channel without naming the destination",
    header.includes("Reachable by") && dataText.includes("SMS"),
    header.filter((h) => /Reach/i.test(h)).join(", ") || "no channel column at all",
  )

  // The filtered case, which is the one a treasurer actually hits: filter the
  // list and the file has to follow, or the button is lying about what it does.
  const search = page.getByLabel("Search members by name")
  const sample = firstScreenName.split(" ")[0]
  await search.fill(sample)
  await page.waitForTimeout(400)
  const filteredOnScreen = await page.evaluate(
    () => document.querySelectorAll('[data-testid="defaulter-table"] tbody tr').length,
  )
  const [filtered] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByTestId("export-defaulter-csv").click(),
  ])
  const filteredRecords = parseCsv(readFileSync(await filtered.path(), "utf8"))
  check(
    "a filtered list exports only the filtered rows",
    filteredRecords.length - 1 === filteredOnScreen,
    `${filteredRecords.length - 1} records for ${filteredOnScreen} rows matching "${sample}"`,
  )
  check(
    "and every one of them is a member who matched",
    filteredRecords.slice(1).every((r) => r[0].toLowerCase().includes(sample.toLowerCase())),
    filteredRecords.slice(1, 3).map((r) => r[0]).join(", "),
  )

  await search.fill("")
  await page.waitForTimeout(300)

  // And the honest empty case: a search matching nobody disables the button,
  // because a file with a header and no rows is a confusing thing to hand
  // someone rather than a useful one.
  await search.fill("zzzz-no-such-member")
  await page.waitForTimeout(400)
  const exportDisabled = await page.getByTestId("export-defaulter-csv").isDisabled()
  check(
    "a search matching nobody disables the export rather than writing an empty file",
    exportDisabled,
    exportDisabled ? "disabled" : "the button is still clickable with no rows",
  )
  await search.fill("")
  await page.waitForTimeout(300)
}
