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

  await shot("16-reminders")
  check("the reminders screen produced no runtime errors", quietSince(mark), noiseReport(mark))
}
