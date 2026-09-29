# Spec — Workload balancing

**Jira project:** NGEN · **Sizing:** T-shirt · **Date:** 29 September 2026
**Reference build:** TruCare Pulse (`um-supervisor`) · UM balancing at `shared/balance.ts` (commit `8224270`)
**Author:** Christina Lawson
**Related:** `Spec-Rebalance-History-Drawers.md` (the audit trail balancing writes to)

> **Why this spec exists as its own document.** Balancing takes clinical work off one clinician and
> gives it to another. The supervisor pressing the button is accountable for the outcome of work they
> will not personally do, and in CM they are also moving a member away from a clinician that member
> has a relationship with. The preview is not a convenience — **it is the control**. Everything below
> follows from that.

---

## Current state — read this first

Five balancing entry points exist. **One of them meets this spec. The other four do not**, and they
share the defect that was fixed in UM.

| Flow | Where | Itemised preview | Deselect rows | Applies the reviewed plan | Levels to a target |
|---|---|---|---|---|---|
| UM workload balance | Workforce tab, Case Explorer | ✅ | ✅ | ✅ | ✅ |
| CM caseload balance | CM dashboard | ❌ count only | ❌ | ❌ **recomputes at commit** | ❌ |
| CM team balance | CM dashboard, per team | ❌ count only | ❌ | ❌ **recomputes at commit** | ❌ |
| CM balance from a drilldown | Case Explorer | ❌ count only | ❌ | ❌ **recomputes at commit** | ❌ |
| Intake Coordinator balance | CM dashboard | ❌ **no preview at all** | ❌ | ❌ loops N times | ❌ |

**"Recomputes at commit"** means the code re-derives the busiest person on each move as it applies
them, rather than applying the plan that was shown. The moves that happen are therefore not
guaranteed to be the moves that were previewed. This was a real defect in UM and was fixed there; it
is still live in the other four.

**BAL-6 through BAL-9 exist to close that gap.** They are not new features — they bring four flows up
to the standard the fifth already meets.

---

## Scope Summary

**Personas**
- **UM Supervisor** — balances authorization workload across nurses.
- **CM Supervisor** — balances caseload across care managers, including within a single team.
- **Intake Coordinator Lead** — balances unworked referrals across coordinators.
- **UM Nurse / Care Manager** — subject of the rebalance; see permission ACs.

**Key interactions**
Choose a strategy · review the proposed moves · decline individual moves · commit · audit afterwards.

**System behaviours**
Derive utilization · select which item to move · simulate the effect · apply exactly what was
approved · record what moved.

**Edge cases in scope**
Already balanced · nobody has movable work · every row declined · one person is both busiest and
lightest · a spread so wide the plan would be enormous · a member recently reassigned already.

---

## Epic: UM — Workload Balancing *(implemented; stated for parity and test coverage)*

### BAL-1 — Choose how aggressively to rebalance

**Story**
As a **UM Supervisor**, I want to choose the size of a rebalance before seeing it, so that I can make
a small correction or a full levelling depending on what the team needs.

**Acceptance Criteria**

```
Given I open the balance flow
When the strategy picker is displayed
Then I can choose a fixed number of moves, or an option that levels the team toward its average
And the picker states what each option will do in plain language
```

```
Given I choose a strategy
When I continue
Then a preview is built and displayed before anything is applied
And no work has moved at this point
```

**Business rules**
- Strategy labels must describe the outcome, not the mechanism. A label that promises levelling and
  moves a fixed number is a defect — that was NGP-4393.
- Fixed strategies in the reference are 1, 3 and 6 moves. **Counts are configuration.**

**Size:** S

---

### BAL-2 — Level the team rather than move a fixed number

**Story**
As a **UM Supervisor**, I want the levelling option to move as many items as levelling actually
requires, so that it works on any spread.

**Acceptance Criteria**

```
Given the utilization spread is wider than the configured tolerance
When the levelling plan is built
Then it contains as many moves as are needed to bring the spread within tolerance
```

```
Given the spread is already within tolerance
When I choose levelling
Then no moves are proposed and I am told the team is already balanced
```

```
Given an extreme spread
When the plan is built
Then the number of moves is capped at the configured maximum
```

**Business rules**
- **Tolerance must be at least twice the per-move delta.** In the reference one move shifts 4
  utilization points off the busiest and onto the lightest — closing the gap by 8 — so the tolerance
  is 8 points. A tighter target makes the algorithm move an item, overshoot, and move it back.
- Reference cap is 40 moves. No single action should be able to relocate a whole caseload.
- Both values are per-client configuration, not constants. See Open Question 2.

**Size:** S

---

### BAL-3 — Show every proposed move, named

**Story**
As a **UM Supervisor**, I want to see exactly which authorizations move and where, so that I am
approving specific changes rather than a number.

**Acceptance Criteria**

```
Given a plan has been built
When the review step is displayed
Then one row is shown per proposed move
And each row names the item, the member, the person losing it, the person receiving it,
    and why that item was selected
And a count of the form "N of M selected" is visible
```

```
Given the team is already balanced, or nobody has a movable item
When I choose a strategy
Then no review step opens and an informational message explains why
```

```
Given a person has the highest utilization but no movable items
When the plan is built
Then the plan stops at the moves it could produce rather than inventing one
```

**Business rules**
- A summary by target ("3 → Sarah Mitchell") is **not sufficient** and does not satisfy this story.
- One item may appear at most once in a plan.
- The stated reason is required on every row. A plan that cannot explain its own selection invites
  the supervisor to cancel all of it.

**Size:** M

---

### BAL-4 — Decline individual moves

**Story**
As a **UM Supervisor**, I want to switch off individual moves, so that I can keep one case with its
current owner without abandoning the rebalance.

**Acceptance Criteria**

```
Given all rows are selected by default
When I deselect a row
Then the selected count decreases, the confirm button label reflects the new count,
    and the row is visibly de-emphasised but still readable
```

```
Given some rows are deselected
When I choose "Select all" or "Clear"
Then all rows are selected, or all are deselected, respectively
```

```
Given every row is deselected
Then the confirm button is disabled
And if confirm is invoked anyway, nothing moves, a message says nothing was selected,
    and no history entry is written
```

**Business rules**
- Rows are selected by default — the supervisor opts **out** of moves, not into them.
- Deselecting never re-plans. Remaining rows are untouched.

**Size:** S

---

### BAL-5 — Apply exactly the plan that was reviewed

**Story**
As a **UM Supervisor**, I want the moves that happen to be the moves I approved, so that the preview
is a commitment.

**Acceptance Criteria**

```
Given I confirm a plan with N rows selected
When it is applied
Then exactly those N items move, between the people named on each row
And no move is recalculated during application
```

```
Given rows were declined
When the action completes
Then the confirmation states how many moved and how many were kept in place
```

```
Given application fails partway
Then the supervisor is told which moves succeeded and which did not
And only the successful moves are recorded in history
```

**Business rules**
- **The reviewed plan is the unit of record.** Re-deriving "the busiest" during application is the
  defect this story exists to prevent.

**[COMPLIANCE NOTE]** Balancing moves prior-authorization work between reviewers. Where a moved item
is expedited or past its turnaround deadline, the transfer must be recorded with a timestamp and both
parties, because turnaround accountability follows the work.

**Size:** M

---

## Epic: CM — Caseload Balancing *(gap — does not meet BAL-3, BAL-4 or BAL-5 today)*

### BAL-6 — Bring CM balancing to the UM standard

**Story**
As a **CM Supervisor**, I want CM balancing to show me each case that will move and let me decline
any of them, so that I have the same control over caseload moves that UM has over authorizations.

**Acceptance Criteria**

```
Given I balance a CM caseload — from the CM dashboard, from a single team, or from a drilldown
When the preview is displayed
Then BAL-3 applies in full: one row per case, naming case number, member, current care manager,
    receiving care manager, and the reason for selection
And BAL-4 applies in full: each row can be declined
And BAL-5 applies in full: exactly the approved rows are applied, with no recomputation
```

```
Given a CM balance completes
When history is written
Then it records the case numbers and members moved, per Spec-Rebalance-History-Drawers HIST-1
```

**Business rules**
- All three CM entry points behave identically. They should share one implementation — the reference
  learned this the hard way with Assignment History, where four surfaces each had their own copy and
  fixing one left three behind.

**Size:** M

---

### BAL-7 — Select CM cases on continuity, not on effort

**Story**
As a **CM Supervisor**, I want the system to propose moving the cases where a handover costs the
member least, so that balancing does not break a working therapeutic relationship.

**Acceptance Criteria**

```
Given a plan is being built for CM
When candidate cases are ranked
Then cases earliest in the lifecycle are preferred over cases in active monitoring
And the reason shown on the row states which applied
```

```
Given a member has an open escalation, an assessment in progress, or a care-plan review
    due within the configured window
When the plan is built
Then that case is not proposed automatically
```

```
Given a member has already been reassigned within the configured churn window
When that case would otherwise be proposed
Then the row is flagged as a repeat reassignment and is deselected by default
```

```
Given no case for a care manager passes these rules
When the plan is built
Then no move is proposed for that care manager, even if they are the busiest
```

**Business rules**
- **The UM selection rule does not transfer to CM.** In UM the cost of a move is lost context, so the
  rule is "least work invested". In CM the cost is a broken relationship with a named clinician the
  member knows — so the rule is **continuity first**. Applying the UM heuristic to CM would optimise
  for the wrong thing.
- Repeat reassignment is a care-quality signal, not just noise. A member moved twice in a quarter
  should be visible as such, which is why the row is flagged and defaults to off rather than hidden.

**[COMPLIANCE NOTE]** Care-manager continuity and documented handover are assessed in care-management
programme audits. Reassignment must be recorded with both clinicians named.

**[ASSUMPTION: lifecycle stages, escalation state and care-plan review dates all exist on the CM
record in the reference. Churn history requires the assignment history added in the companion spec.]**

**Size:** L

---

### BAL-8 — Preview Intake Coordinator rebalancing

**Story**
As an **Intake Coordinator Lead**, I want to see which referrals will move before confirming, so that
intake rebalancing is as reviewable as every other rebalance.

**Acceptance Criteria**

```
Given I balance Intake Coordinator workload
When the confirmation is displayed
Then it lists each referral that will move, by referral ID and member, with the coordinator
    losing it and the coordinator receiving it
```

```
Given a referral is pending a specific blocker — missing information or an eligibility check
When it is proposed for a move
Then the row states the blocker, so the receiving coordinator is not handed a stalled referral
    unknowingly
```

```
Given there is no unworked coordinator volume
When I choose a strategy
Then an informational message states there is nothing to rebalance and no confirmation opens
```

**Business rules**
- This flow currently shows **no breakdown at all** — only a count in the dialog title. It is the
  furthest from the standard and the cheapest to bring in line.
- Referrals are pre-case work; their reference is the referral ID (see companion spec HIST-3).

**Size:** S

---

## Cross-cutting requirements

### BAL-9 — One balancing implementation, many entry points

**Story**
As an **engineer**, I want a single balancing implementation behind every entry point, so that a fix
or a rule change lands everywhere at once.

**Acceptance Criteria**

```
Given balancing is invoked from any surface
When the flow runs
Then strategy options, preview format, deselection behaviour, application and audit are identical
And only the domain — what is being moved, and the selection rule — differs
```

```
Given a defect is fixed in the balancing flow
When the fix is deployed
Then every entry point receives it without a separate change
```

**Business rules**
- Domain differences belong in a selection strategy passed into the flow, not in duplicated flows.
- The reference has already paid for this lesson twice: once when the Reports module's history links
  left three other surfaces behind, and once in balancing itself, where UM was fixed and CM was not.

**Size:** M

---

### BAL-10 — Restrict who can rebalance

**Story**
As a **compliance owner**, I want rebalancing restricted to supervisors, so that clinicians cannot
move work between themselves without oversight.

**Acceptance Criteria**

```
Given I hold a non-supervisory role
When I view a workload or caseload surface
Then no balancing control is offered
And if the action is invoked directly, it is rejected server-side and the attempt is logged
```

```
Given I am a supervisor scoped to one team
When I balance
Then only members of that team are eligible as source or target
```

**Business rules**
- Hiding the control is presentation. **Rejecting the action is the control.** Same principle as
  NGP-4391 — a filtered dropdown is not enforcement.

**[COMPLIANCE NOTE]** Segregation of duties. Who may reassign clinical work is an access-control
decision subject to audit.

**[ASSUMPTION: the reference build has a single supervisor persona and does not enforce this.]**

**Size:** M

---

## Contract changes

| Item | Change | Notes |
|---|---|---|
| Balance plan | A plan is a list of concrete moves, each naming the item, the subject, source, target and selection reason | Replaces the by-target count summary. Already implemented for UM. |
| Confirm dialog | Optional itemised picks: `{ id, ref, label, from, to, note, selected }`; confirm returns the surviving ids | Shared contract — any action that reassigns work can use it. |
| Balance strategy | Move count is `number \| null`, where null means "level to tolerance" | Already implemented for UM; needed for CM. |
| CM selection strategy | New — ranks candidates on continuity, excludes protected cases, flags churn | BAL-7. No equivalent exists today. |
| Assignment history | Records refs and members for every balance | Implemented; see companion spec. |

---

## Non-functional

- The preview must render before any work moves, in every flow, without exception.
- Plan building must not mutate live data. The reference simulates against a copy.
- A plan is valid only for the state it was built against. If the underlying workload changes
  between preview and confirm, see Open Question 4.

---

## Open Questions

| # | Question | Raised by | Owner | Due |
|---|----------|-----------|-------|-----|
| 1 | Should the CM continuity rules in BAL-7 be client-configurable, or fixed clinical policy? | PM | Clinical | Before BAL-7 build |
| 2 | Are the levelling tolerance and per-move delta client-configurable? They are currently constants. | PM | Product | Before BAL-2 build |
| 3 | What is the churn window for "recently reassigned" — 30 days, a quarter, a care-plan cycle? | PM | Clinical | Before BAL-7 build |
| 4 | If workload changes between preview and confirm, do we apply the stale plan, re-validate and warn, or rebuild? | PM | Eng / Clinical | Before BAL-5 build |
| 5 | Should a balance be undoable as a single action, or is a reverse reassignment sufficient? | PM | Product | Post-release |
| 6 | Does the member or their care manager get notified when a CM case is reassigned? | PM | Clinical / Compliance | Before BAL-7 build |
| 7 | Which roles may rebalance, and at what scope — own team only, or any team? | PM | Security / Clinical | Before BAL-10 build |

---

## Out of scope

- PTO redistribution. Related and adjacent — it empties one person to their teammates rather than
  levelling a group — but it is a different flow with its own rules, and it is specified separately.
- Queue rebalancing (moving unclaimed work between queues rather than between people).
- Automatic or scheduled balancing without a human in the loop. **Not recommended**: the preview is
  the control, and removing the reviewer removes it.
- Backend API design and the utilization calculation itself, both unchanged by this spec.
