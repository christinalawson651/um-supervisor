# Response to QA gap list — 16 September 2026

**From:** Christina Lawson · **To:** Kiran Banda, engineering & QA · **Rows:** 20

**What "confirmed" means here.** Every row was checked against the reference implementation — the
working prototype. I cannot see the engineering build's code. Where a response says *confirmed*, it
means the behaviour QA expected is real, specified and working in the reference; it does not mean I
have diagnosed why the build differs. Three rows turned out to be defects the reference itself
carried (NGP-4393, PLS-104, NGP-4370) and all three are fixed at source.

| Key / area | Expected | Response |
| --- | --- | --- |
| **NGP-4485**<br>FR-006, AC-3 | Build the seven-tile row; each tile filters the grid beneath it to its flag. | **Confirmed — build as specified.** The reference has exactly seven: OON Exceptions, Missing/Late Clinicals, Network-Status Exceptions, High Incomplete Rate, High Denial/Partial Rate, Unusual Utilization, Repeated TAT Delays. Zero tiles with a working grid reads as never built rather than mis-rendered. |
| **NGP-4452**<br>FR-015, AC-6 | Append the reason to each preview line, naming the figure it rests on. | **Real requirement, never implemented anywhere — including the reference.** The preview builds `{count, label, target}` with no reason field, so AC-6 has not been met by anyone and this is not a regression in your build. The rule is lowest current utilization among nurses in scope, and it should carry the number: "1 authorization → Tariq Patel — lowest on the team at 55%". Same fix as PLS-111 Balance preview. |
| **NGP-4442**<br>Layout only | Let the panel size to its content, or scroll its own body. | **No clarification needed — straightforward layout defect.** Clipping that appears at some zoom levels and not others points at a fixed-height container. Please sweep the other workload panels while you are in there; they share the pattern. |
| **NGP-4438**<br>No FR/AC | Escalation removes the record from the list *and* the count that list feeds. | **One of six rows with the same shape** — see the note under the table. An action that changes one view and not the other means the two are reading from different places. |
| **NGP-4437**<br>No FR/AC | Derive the five cards from the same records the table renders. | **Same family.** Five cards reading zero at once is not five wrong sums — it is one source returning nothing while the table's own source returns rows. |
| **NGP-4401**<br>No FR/AC | Escalation drops the record out of Approaching TAT in every LOB and look-back. | **Same family**, and the "in every combination" detail is useful — it rules out a filter-specific bug and points at the count itself. |
| **NGP-4397**<br>No FR/AC | Open the dialog over the list the dashboard already holds; do not re-query. | **Same family, stated most plainly.** Two surfaces describing one population disagree, so they are querying independently rather than the dialog opening over the list the dashboard already has. |
| **NGP-4395**<br>No FR/AC | Start opens on today. Return takes the start date as its minimum. | **No clarification needed.** "Blocks upfront" and "errors on submit" are different behaviours, not two ways of doing the same thing — validating after the fact does not satisfy the requirement. |
| **NGP-4394**<br>Against the prototype | Draw both surfaces from one nurse-only roster, and derive the count from it. | **Confirmed.** The reference roster is seven names, every one an RN, no supervisors — and the count is derived from that same list rather than stated separately, so the two cannot disagree. Supervisors appearing suggests both surfaces are reading the general user directory. Point them at one filtered source or they will drift again. |
| **NGP-4393**<br>"Even out" label intent | Take the corrected levelling from the reference and retest against your roster. | **Good catch, and your build was right — the reference was wrong.** It carried a fixed five while its label promised levelling, so on a tight spread it overshot and on a wide one it never arrived. Fixed: a strategy can now say "until level" instead of a move count; the simulation runs while the spread is open and stops at eight points (one move shifts four off the busiest onto the lightest, closing the gap by eight — chasing tighter would move an authorization and then move it back), capped at 40 moves. On the current roster (96% down to 55%, a 41-point spread) it plans **7** moves and lands everyone between 76% and 84%. |
| **NGP-4392**<br>No FR/AC | Implement the move: clear the owner, decrement the source, increment the target. | **Confirmed, and the toast is the tell** — "not available yet" is a stub, so this is unbuilt rather than broken. One rule matters beyond this ticket: work is either sitting in a queue or owned by a person, never both. A record that can be in two places at once is very likely behind some of the count mismatches above. |
| **NGP-4391**<br>FR-028 | Make the permitted target roles a per-queue setting. Enforce whatever it holds. | **This should be configurable.** MD-only is one tenant's setting, not a universal rule: plenty of organisations let clinical advisors or senior nurses take MD Review work, and hardcoding the restriction would make the queue unusable for them. FR-028 is describing a configuration value, not the behaviour.<br><br>So what gets built is the mechanism: each queue holds a configured set of permitted target roles; the reassign list is drawn from that set; and an assignment outside it is **rejected server-side, not merely hidden from the dropdown**. Default this tenant to Medical Director, which is what QA was testing against.<br><br>That last clause is where the segregation-of-duties concern sits: whatever the configured set is, the system has to enforce it, and the audit trail has to record which roles were permitted at the time — otherwise an auditor cannot tell a deliberate policy change from a violation. |
| **NGP-4370**<br>No FR/AC | Drill from the same filtered population the row counted, and drop "None" from the panel. | **Confirmed, with a named cause — the reference had the same asymmetry.** Rows count over pending cases tagged incomplete, while the drill-down was querying *all* pending cases. The two agreed only by accident: a case with nothing missing is categorised "None", so the four real categories could never pick up an untagged case. The mismatch was invisible, not absent.<br><br>That is almost certainly your 1 versus 3,471. The moment a "None" row renders, its count comes from the incomplete subset while its drill-down returns every pending case with nothing missing — the entire book of business behind a row reading 1. Two things to change: drill from the same filtered population the row counted, and do not give "None" a row in a panel called Missing Information at all. Fixed in the reference (`intake-tab.ts`). |
| **NGP-4367**<br>FR-015 (Risk panel spec) | List each selected authorization by ID and member name in the dialog. | **Requirement stands as written.** A count is exactly the case where a supervisor escalates the wrong two records and has no way to tell from the dialog. The confirmation is the last point at which a mis-selection is recoverable. |
| **NGP-4353**<br>PLS-102, AC-3/AC-6 | No spec change needed — fix escalation's state update and this resolves with it. | **Your reclassification is right** — there is no escalate action on that tab, so nothing in the written spec is being violated. But it belongs with the rows above, not on its own: if escalation updated shared state properly this would resolve without a spec change. Route it to PLS-111 as an enhancement rather than closing it — closing it would bury the only row that names the pattern. |
| **NGP-4345**<br>No FR/AC | Navigate to CM, then open that member's chart. Two steps, not one. | **Confirmed.** The reference closes the drawer, navigates to CM, then opens that member's chart by name. Landing on the bare CM dashboard would leave the supervisor to go and search for a member they were already looking at. The toast wording is worth correcting too: "temporarily unavailable" tells the user to try again later, when nothing about waiting will help. |
| **PLS-104**<br>BR-1 · Risk & Escalation | Take the new caption from the reference. | **Correct, and the reference carried the same leftover.** Fixed: the caption now reads "Prioritized by turnaround band — breached first, then at risk", which is what the panel actually does. Copy naming a field that no longer exists is worth more than its severity suggests — it makes a reviewer doubt everything else on the panel. |
| **PLS-109**<br>FR-003, FR-006/007, AC-1–4 | Render three widgets on this tab, not five — and split the spec row by tab first. | **AG-109-007 answers itself: intentional, not a regression.** The spec row conflates two different tabs. Audit Flags belongs to CM Audit & Compliance; the two IRR widgets belong to UM. Neither was specified to sit alongside the other three, so "2 of 5" is the correct behaviour for this tab.<br><br>One further point, so it does not get rebuilt by mistake: IRR was removed from the CM tab deliberately last week. Inter-rater reliability measures whether reviewers agree on a UM determination, and CM has no equivalent decision for two people to agree on. |
| **PLS-111**<br>FR-015, AC-6 · Balance preview | Same fix as NGP-4452. Link the two tickets. | **Duplicate of NGP-4452 — one fix closes both.** They are the same line of the same dialog; please link rather than working them separately. |
| **PLS-111**<br>FR-028 · MD Review reassign | Same fix as NGP-4391. Configurable role set, enforced. | **Duplicate of NGP-4391 — and the answer is that AG-111-003 has not shipped.** There is no role restriction in the reference for it to have regressed from. Please carry the configurable-role-set framing from NGP-4391 onto this ticket too. |

## The five rows that are probably one bug

NGP-4438, 4437, 4401, 4397 and 4353 all have the same shape: **a summary figure that does not agree
with the list it summarises, or an action that changes one view and not the other.** That pattern
usually has one cause — summary counts computed independently of the collections they describe,
whether through a separate query or a snapshot taken at load, so an action mutates one and leaves
the other behind. In the reference every count is derived from the single record list, which is why
there is no second number available to disagree.

NGP-4370 turned out to be exactly this and is now confirmed rather than suspected — its row and its
drill-down were reading from two different populations. Worth testing the same idea against the
remaining five before filing five separate fixes.

## What I would like back

1. **NGP-4391 / PLS-111** — confirm the permitted roles are configuration, not code. MD-only is this
   tenant's setting; others escalate to advisors and senior nurses. I need to know the role set is
   configurable per queue *and* enforced when someone attempts an assignment outside it — a filtered
   dropdown on its own is not a control.
2. **NGP-4370** — confirmed defect, and it was latent in the reference too. Fixed at source. If the
   same split explains the other five count mismatches, they all close together.
3. **PLS-109** — split the spec row by tab before anyone builds to it. As written it asks one tab to
   render widgets that belong to two, and one of those was removed on purpose.

---

*Reference-implementation checks performed 16 September 2026 against the TruCare Pulse prototype.
NGP-4393, PLS-104 and NGP-4370 were fixed in the reference the same day and are on the deployed
build; every other row is a statement about the reference, not a diagnosis of the engineering build.*
