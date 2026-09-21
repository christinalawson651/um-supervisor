# Spec — Rebalance transparency, assignment-history references, resizable drawers

**Jira project:** NGEN · **Sizing:** T-shirt · **Date:** 21 September 2026
**Reference build:** TruCare Pulse (`um-supervisor`), commits `8224270`, `ee2bdec`, `e18ba68`
**Author:** Christina Lawson

> Engineering implements against the reference build. Every behaviour below is implemented and
> observable there — this document states the requirement so it can be built and tested
> independently, not so it can be copied. Where the reference makes a choice that is a *judgement*
> rather than a rule (which case gets moved, what the default drawer width is), that is called out.

---

## Scope Summary

**Personas**
- **UM Supervisor** — rebalances nurse workload, reassigns authorizations, audits who moved what.
- **CM Supervisor** — the same for care managers, cases and referrals.
- **Intake Coordinator** — reassigns referrals that have not yet become cases.
- **UM Nurse / Care Manager** — read-only against these flows (see permission ACs).

**Feature areas**
1. Workforce & Queue Management — workload rebalancing
2. Assignment History — the audit surface for every reassignment
3. Platform shell — side drawers

**Key interactions**
Preview a rebalance plan · decline individual moves · commit the reviewed plan · open a member,
authorization, case or referral from history · resize a drawer.

**System behaviours**
Build a plan from live utilization · apply only what was confirmed · record what moved · resolve a
reference to the right record · persist drawer width per viewer.

**Edge cases in scope**
Nothing to move · every row declined · a nurse who is busiest but has no movable work · a reference
that no longer resolves · empty history · CM work with no case number yet.

---

## Epic: UM — Workload Rebalancing

### WFM-1 — Preview every proposed rebalance move

**Story**
As a **UM Supervisor**, I want to see exactly which authorizations a rebalance will move and where
they will go, so that I am approving a specific set of changes rather than a number.

**Acceptance Criteria**

```
Given I have selected a balancing strategy
When the system builds the plan
Then a review step lists one row per proposed move
And each row shows the authorization ID, the member, the nurse it leaves, the nurse it joins,
    and a stated reason for selecting that authorization
```

```
Given the plan has been built
When the review step is displayed
Then the dialog header states the number of moves proposed
And a count of the form "N of M selected" is visible
```

```
Given the team is already within tolerance, or no nurse has movable work
When I select a strategy and the plan is built
Then no review step opens
And an informational message states that the workload is already balanced and nothing will move
```

```
Given a nurse has the highest utilization but holds no movable authorizations
When the plan is built
Then the plan stops at the moves it could produce
And no row is generated for that nurse
```

**Business rules**
- A move is only proposed between two different people.
- One authorization can appear in at most one row of a plan.
- Only authorizations in a pending phase and currently owned by the source nurse are eligible.

**[ASSUMPTION: plan building is synchronous and client-side in the reference. If the production
build computes the plan server-side, add a loading AC — the review step must not render a partial
plan.]**

**Out of scope** — backend API design; the utilization calculation itself (unchanged).

**Size:** M

---

### WFM-2 — Decline individual moves before committing

**Story**
As a **UM Supervisor**, I want to switch off individual moves in the plan, so that I can keep a case
with its current nurse without abandoning the whole rebalance.

**Acceptance Criteria**

```
Given the review step is displayed with all rows selected by default
When I deselect a row
Then the selected count decreases by one
And the confirm button label updates to show the number that will be applied
And the deselected row is visibly de-emphasised but remains readable
```

```
Given some rows are deselected
When I choose "Select all"
Then every row returns to selected
When I choose "Clear"
Then every row is deselected
```

```
Given every row has been deselected
When the review step is displayed
Then the confirm button is disabled
```

```
Given every row has been deselected
And the confirm action is somehow invoked
Then no authorization is moved
And an informational message states that nothing was selected
And no history entry is written
```

**Business rules**
- All rows are selected by default. The supervisor opts *out* of moves, not into them.
- Declining rows never re-plans. The remaining rows are unchanged.

**Out of scope** — persisting a partially reviewed plan across sessions.

**Size:** S

---

### WFM-3 — Apply exactly the plan that was reviewed

**Story**
As a **UM Supervisor**, I want the moves that happen to be the moves I approved, so that the preview
is a commitment rather than an estimate.

**Acceptance Criteria**

```
Given I have reviewed a plan and left N rows selected
When I confirm
Then exactly those N authorizations move, from the nurse named in the row to the nurse named in
    the row
And no move is recalculated at commit time
```

```
Given I confirm a plan with rows declined
When the action completes
Then a confirmation message states how many moved and how many were kept in place
```

```
Given the confirm action fails partway
When the failure is detected
Then the user is shown which moves succeeded and which did not
And the history entry records only the moves that succeeded
```

**Business rules**
- The plan is the unit of record. Re-deriving "the busiest nurse" during commit is a defect — it was
  the behaviour that made the previous preview unreliable.

**[COMPLIANCE NOTE]** Reassignment moves prior-authorization work between reviewers. Where a moved
authorization is expedited or already past its turnaround deadline, the transfer must be recorded
with a timestamp and both parties, because turnaround accountability follows the work.

**[ASSUMPTION: partial-failure handling is not implemented in the reference, which applies moves
client-side. The AC above is stated for the production build and needs confirmation.]**

**Out of scope** — retry logic; queue rebalancing (separate flow).

**Size:** M

---

### WFM-4 — Size the plan to the problem

**Story**
As a **UM Supervisor**, I want "Even out" to move as many authorizations as levelling actually
requires, so that the strategy does what its name says on any spread.

**Acceptance Criteria**

```
Given the team's utilization spread is wider than the tolerance
When I select "Even out"
Then the plan contains as many moves as are needed to bring the spread within tolerance
And the number of moves is not fixed
```

```
Given the team's utilization spread is already within tolerance
When I select "Even out"
Then no moves are proposed
```

```
Given an extreme spread
When the plan is built
Then the number of moves is capped at a configured maximum
```

**Business rules**
- Tolerance in the reference is 8 percentage points, because one move shifts 4 points off the
  busiest and onto the lightest — so it closes the gap by 8. A tighter target would move an
  authorization, overshoot and move it back. **Both the tolerance and the per-move delta are
  configuration, not constants.**
- Cap in the reference is 40 moves. No single action should be able to relocate a whole caseload.
- The three fixed strategies (1, 3, 6) are unchanged.

**Out of scope** — auto-rebalancing on a schedule.

**Size:** S

---

## Epic: UM / CM — Assignment History References

### HIST-1 — Record what moved, not only how much

**Story**
As a **UM Supervisor**, I want assignment history to record which authorizations or cases were
moved, so that a reassignment can be reconstructed later rather than counted.

**Acceptance Criteria**

```
Given I reassign, move to a queue, or rebalance any number of items
When the action completes
Then the history entry records the identifier of every item moved and every member affected
```

```
Given every item in one action came from the same owner
When the history entry is written
Then the source owner is recorded
Given the items came from more than one owner
Then no single source owner is recorded
```

```
Given an action moves items for the same member more than once
When the history entry is written
Then that member appears once, not once per item
```

**Business rules**
- Identifiers are self-identifying by prefix: `AUTH-` (UM authorization), `CM-` (care-management
  case), `REF-` (referral). One history list carries all three.
- Identity must be captured **before** the move is applied. Moving a case to a queue clears its
  owner, so reading it afterwards loses the person it came from.
- Members are stored `"Last, First"`. Any joined display must use a separator that cannot occur in a
  name — **not a comma**.

**[COMPLIANCE NOTE]** This is the audit record for who reassigned which member's work and when.
Retention and immutability follow the platform's HIPAA audit-logging policy.

**Out of scope** — backfilling history entries written before this change.

**Size:** M

---

### HIST-2 — Open a reference from Assignment History

**Story**
As a **UM Supervisor**, I want to open the member or the work item directly from an assignment
history row, so that I can check a reassignment without searching for it in another module.

**Acceptance Criteria**

```
Given a history row lists one or more members
When I select a member name
Then that member's chart opens
```

```
Given a history row lists one or more references
When I select a reference beginning AUTH-
Then the authorization opens in the standard case drilldown
When I select a reference beginning CM-
Then the care-management case opens, showing member, member ID, case type, care manager,
    programme, lifecycle stage, queue, risk and care-plan status
When I select a reference beginning REF-
Then the referral opens, showing status, reason, source, received date, who is working it,
    and whether a care manager has accepted it
```

```
Given a cell lists several values
When it is rendered
Then each value is independently selectable
```

```
Given a history row has no members or no references recorded
When the row is rendered
Then the cell shows an em dash and is not selectable
```

```
Given a reference no longer resolves to a record
When I select it
Then an informational message names the reference and states it is not in the current data set
And nothing opens
```

```
Given no reassignment, balance or redistribution has occurred
When I open Assignment History
Then the table is not rendered
And an empty-state message explains that nothing has been reassigned yet
```

```
Given I am a UM Nurse rather than a Supervisor
When I open Assignment History
Then I see only entries for work I own
```

**Business rules**
- **This applies to every Assignment History surface, not one of them.** In the reference there are
  four: the Workforce tab, every Case Explorer drilldown, the CM dashboard, and the Reassignment &
  Assignment History report. A shared builder and a shared resolver are used so a fix to one cannot
  leave the others behind — which is exactly what happened when the report alone was updated.
- Opening a record from inside a drawer closes that drawer first, so the new panel is not layered
  behind it.
- References print as plain text — a printed report has nothing to click.

**[ASSUMPTION: the permission AC above is stated as a requirement. The reference build has a single
supervisor persona and does not enforce it.]**

**Out of scope** — editing a history entry; exporting the resolved records.

**Size:** M

---

### HIST-3 — Record the referral where no case exists yet

**Story**
As an **Intake Coordinator**, I want reassigned referrals to be recorded by referral ID, so that
pre-case work is as auditable as case work.

**Acceptance Criteria**

```
Given I reassign one or more referrals
When the action completes
Then the history entry records each referral ID and the members they concern
```

```
Given a referral has not been accepted
When I open it from history
Then the care manager field states that no case has been opened
And a note explains that the reference is a referral because no case exists yet
```

```
Given a referral has been accepted and a case now exists
When I open the referral from a historical entry
Then the referral opens as recorded
And the entry is not rewritten to point at the case
```

**Business rules**
- A referral ID is the correct reference for pre-case work. Recording only a member name loses which
  referral was handed over.
- History is a record of what was true at the time. A referral that later becomes a case does not
  retroactively change the reference already written.

**Out of scope** — linking a referral to the case it becomes (no such link exists in the reference
data model).

**Size:** S

---

### DATA-1 — Case identifier on the care-management record

**Story**
As a **CM Supervisor**, I want care-management cases to carry a case number distinct from the member
identifier, so that reassignment and audit can name the episode rather than the person.

**Acceptance Criteria**

```
Given a care-management case exists
When it is read
Then it carries a case number that is stable for the life of that case
And the case number is distinct from the member identifier
```

```
Given a member holds more than one case over time
When each case is read
Then each carries its own case number
```

**Business rules**
- Format in the reference is `CM-26-xxxxx`. **The format is illustrative; the requirement is a
  stable, unique, member-independent identifier.**
- Existing records need a case number assigned as part of this change.

**[ASSUMPTION: whether historical closed cases are backfilled with case numbers is a data decision,
not a UI one — see Open Question 3.]**

**Out of scope** — case numbering scheme across tenants; migration sequencing.

**Size:** M

---

## Epic: Platform — Side Drawers

### SHELL-1 — Resize a side drawer

**Story**
As any user, I want to widen a side drawer, so that I can read a table inside it without fighting a
horizontal scrollbar.

**Acceptance Criteria**

```
Given a side drawer is open
When I drag its leading edge
Then the drawer width follows the pointer
And the width is constrained to a minimum and a maximum
```

```
Given I have resized a drawer
When I close it and open any drawer again — including in a later session
Then it opens at the width I set
```

```
Given the resize handle has keyboard focus
When I press the left or right arrow key
Then the width changes by a step
When I hold shift and press an arrow key
Then the width changes by a larger step
When I press Home
Then the width returns to default
```

```
Given a drawer has been resized
When I double-click the resize handle
Then the width returns to default
```

```
Given the stored width is unreadable, absent, or larger than the current window allows
When a drawer opens
Then it opens at the default width, or the largest width the window permits
And no error is surfaced to the user
```

```
Given I am dragging the handle
When the pointer moves across the page
Then no page text is selected
```

**Business rules**
- Minimum in the reference is 380px — below that the two-column field list becomes unreadable.
  Maximum is 90% of window width, so a strip of the page behind stays visible: a panel that covers
  everything is a modal, and a drawer is meant to be read against what it came from.
- Default is 420px.
- Width is a per-viewer convenience stored in browser storage. Every read and write must tolerate
  storage being unavailable — private windows and blocked site data must not break the drawer.

**[ASSUMPTION: applies to all drawers uniformly. If any drawer needs its own width, that is a
separate story.]**

**Out of scope** — resizing modals; drag-to-reorder; mobile behaviour (drawers are full-width below
the tablet breakpoint).

**Size:** S

---

## A note on the AI sign-off rule

The rebalance plan is **generated by a deterministic algorithm, not by a model** — same inputs, same
plan, every time. The platform's AI recommendation rules therefore do not formally apply, and no
confidence score or model attribution should be shown, because there is none.

It is worth noting that WFM-2 and WFM-3 nonetheless implement the control the AI rule exists to
enforce: a system-proposed action is displayed in full, requires explicit confirmation, can be
rejected in part, and writes an audit entry recording what the human actually approved. If a future
version ranks or selects moves using a model, the AI rules apply in full and this section should be
replaced rather than amended.

---

## Open Questions

| # | Question | Raised by | Owner | Due |
|---|----------|-----------|-------|-----|
| 1 | Should a UM Nurse see Assignment History at all, or only entries affecting their own caseload? The reference does not gate it. | PM | Clinical / Security | Before HIST-2 build |
| 2 | On partial failure of a multi-move commit, do we roll back or apply what succeeded? WFM-3 assumes apply-and-report. | PM | Eng | Before WFM-3 build |
| 3 | Do closed and archived CM cases get case numbers backfilled, or only cases open at the time of release? | PM | Data | Before DATA-1 build |
| 4 | Should the rebalance candidate ordering (standard before expedited, un-breached before breached) be configurable per client, or fixed? It is a clinical judgement, currently fixed. | PM | Clinical | Before WFM-1 build |
| 5 | Is the tolerance for "Even out" (8 points) a client-configurable value alongside the per-move delta? | PM | Product | Before WFM-4 build |
| 6 | Does a referral that becomes a case need a link to that case, for history entries written pre-acceptance? | PM | Clinical / Data | Post-release |

---

## Data model changes summary

| Entity | Change | Notes |
|---|---|---|
| Assignment history entry | Add `refs: string[]` | Identifiers of items moved. Prefix-typed: `AUTH-`, `CM-`, `REF-`. Replaces the earlier authorization-only field. |
| Assignment history entry | `members: string[]` now populated by all reassign paths | Previously written by the balance flow only. |
| Care-management case | Add `caseNumber` | Stable, unique, distinct from member ID. See DATA-1. |
| Confirm dialog contract | Add optional itemised picks | `{ id, ref, label, from, to, note, selected }`; confirm returns the selected ids. Reusable by any action that reassigns work. |
| Report / drawer table contract | Add optional cell links | `{ column, run, enabled?, splitOn? }`. Identical shape in both so behaviour does not diverge. |
