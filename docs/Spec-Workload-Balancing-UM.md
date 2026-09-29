# Spec — UM workload balancing

**Jira project:** NGEN · **Epic:** UM · **Sizing:** T-shirt · **Date:** 29 September 2026
**Reference build:** TruCare Pulse (`um-supervisor`), `shared/balance.ts` — commit `8224270`
**Author:** Christina Lawson
**Related:** `Spec-Rebalance-History-Drawers.md` — the audit trail balancing writes to

> **Scope of this document: UM only.** Care management and appeals balancing are separate work and
> are deliberately not specified here.

> **Why balancing gets its own spec.** It takes clinical work off one nurse and gives it to another.
> The supervisor pressing the button is accountable for the outcome of work they will not personally
> do. The preview is therefore not a convenience — **it is the control**, and every requirement below
> follows from that.

All behaviour below is implemented and observable in the reference build. This document states the
requirements so they can be built and tested independently, not copied. Where the reference makes a
**judgement** rather than following a rule — which authorization gets moved, what the levelling
tolerance is — that is called out rather than presented as fixed.

---

## Scope Summary

**Personas**
- **UM Supervisor** — balances authorization workload across nurses. Holds the balancing permission.
- **UM Nurse** — subject of the rebalance, not an actor in it. See BAL-10.

> Supervision is a role held **per module, with a scope** — a team, a line of business, a delegated
> entity or a site — and one person may hold more than one. Two supervisors' scopes can overlap the
> same population. BAL-10 depends on this; a design assuming one global supervisor will need
> reworking at the first client whose modules have different leadership.

**Key interactions**
Choose a strategy · review the proposed moves · decline individual moves · commit · audit afterwards.

**System behaviours**
Derive utilization · select which authorization to move · simulate the effect · apply exactly what
was approved · record what moved.

**Edge cases in scope**
Already balanced · nobody has movable work · every row declined · one nurse is both busiest and
lightest · a spread wide enough to produce an enormous plan.

---

### BAL-1 — Choose how aggressively to rebalance

**Story**
As a **UM Supervisor**, I want to choose the size of a rebalance before seeing it, so that I can make
a small correction or a full levelling depending on what the team needs.

**Acceptance Criteria**

```
Given I open the balance flow
When the strategy picker is displayed
Then I can choose a fixed number of moves, or an option that levels the team toward its average
And each option states in plain language what it will do
```

```
Given I choose a strategy
When I continue
Then a preview is built and displayed
And no authorization has moved at this point
```

```
Given I cancel at the strategy picker or at the preview
Then nothing moves and no history entry is written
```

**Business rules**
- Strategy labels must describe the **outcome**, not the mechanism. A label promising levelling that
  moves a fixed number is a defect — that was NGP-4393.
- Fixed strategies in the reference are 1, 3 and 6 moves. **These counts are configuration.**

**Out of scope** — scheduling a rebalance; rebalancing without a reviewer (see Out of scope, below).

**Size:** S

---

### BAL-2 — Level the team rather than move a fixed number

**Story**
As a **UM Supervisor**, I want the levelling option to move as many authorizations as levelling
actually requires, so that it works on any spread.

**Acceptance Criteria**

```
Given the utilization spread is wider than the configured tolerance
When the levelling plan is built
Then it contains as many moves as are needed to bring the spread within tolerance
And the number of moves is not fixed
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
- **Tolerance must be at least twice the per-move delta.** In the reference, one move shifts 4
  utilization points off the busiest nurse and onto the lightest — closing the gap by 8 — so the
  tolerance is 8 points. A tighter target makes the algorithm move an authorization, overshoot, and
  move it back.
- Reference cap is 40 moves. No single action should be able to relocate a whole caseload.
- Both values are per-client configuration, not constants. See Open Question 1.

*Worked example from the current roster (96% down to 55%, a 41-point spread): the plan is 7 moves and
everyone lands between 76% and 84%.*

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
And each row names the authorization, the member, the nurse losing it, the nurse receiving it,
    and why that authorization was selected
And a count of the form "N of M selected" is visible
```

```
Given the team is already balanced, or no nurse has a movable authorization
When I choose a strategy
Then no review step opens, and an informational message explains why
```

```
Given a nurse has the highest utilization but holds no movable authorization
When the plan is built
Then the plan stops at the moves it could produce
And no row is generated for that nurse
```

**Business rules**
- A summary by target — "3 authorizations → Sarah Mitchell, RN" — **does not satisfy this story.** It
  tells the supervisor how much is moving, not what.
- An authorization may appear at most once in a plan.
- Only authorizations in a pending phase, currently owned by the source nurse, are eligible.
- The stated reason is required on every row. A plan that cannot explain its own selection invites
  the supervisor to cancel all of it.

**Size:** M

---

### BAL-4 — Decline individual moves

**Story**
As a **UM Supervisor**, I want to switch off individual moves, so that I can keep one case with its
current nurse without abandoning the whole rebalance.

**Acceptance Criteria**

```
Given all rows are selected by default
When I deselect a row
Then the selected count decreases
And the confirm button label reflects the number that will be applied
And the row is visibly de-emphasised but still readable
```

```
Given some rows are deselected
When I choose "Select all" or "Clear"
Then all rows become selected, or all become deselected, respectively
```

```
Given every row is deselected
Then the confirm button is disabled
And if confirm is invoked anyway, nothing moves, a message states that nothing was selected,
    and no history entry is written
```

**Business rules**
- Rows are selected by default. The supervisor opts **out** of moves, not into them — the plan is a
  proposal to be trimmed, not a blank list to be filled.
- Deselecting never re-plans. The remaining rows are untouched.

**Out of scope** — persisting a partially reviewed plan across sessions.

**Size:** S

---

### BAL-5 — Apply exactly the plan that was reviewed

**Story**
As a **UM Supervisor**, I want the moves that happen to be the moves I approved, so that the preview
is a commitment rather than an estimate.

**Acceptance Criteria**

```
Given I confirm a plan with N rows selected
When it is applied
Then exactly those N authorizations move, between the nurses named on each row
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

```
Given a balance completes
When history is written
Then it records the authorizations and the members moved
    (see Spec-Rebalance-History-Drawers, HIST-1)
```

**Business rules**
- **The reviewed plan is the unit of record.** Re-deriving "the busiest nurse" while applying — rather
  than applying the plan as shown — is the specific defect this story exists to prevent. It was live
  in the reference and was fixed.

**[COMPLIANCE NOTE]** Balancing moves prior-authorization work between reviewers. Where a moved
authorization is expedited or already past its turnaround deadline, the transfer must be recorded
with a timestamp and both nurses named, because turnaround accountability follows the work.

**[ASSUMPTION: partial-failure handling is not implemented in the reference, which applies moves
client-side. The AC above is stated for the production build and needs confirmation — see Open
Question 3.]**

**Size:** M

---

### BAL-6 — Select the authorization whose handover costs least

**Story**
As a **UM Supervisor**, I want the system to propose moving the authorizations where a handover costs
least, so that rebalancing does not disrupt work that is mid-flight.

**Acceptance Criteria**

```
Given a plan is being built
When candidate authorizations are ranked for a nurse
Then standard requests are preferred over expedited
And un-breached requests are preferred over those past their deadline
And among equals, the most recently submitted is preferred
```

```
Given a proposed row
When it is displayed
Then the reason shown states which of these applied
```

```
Given an expedited or breached authorization is the only movable candidate
When it is proposed
Then the row states that explicitly, so the supervisor can decline it
```

**Business rules**
- **This ordering is a clinical judgement, not an implementation detail.** The reasoning: an
  expedited case has a running clock and a handover costs more; a breached case needs continuity
  rather than a new owner; and a recently submitted case has the least work invested, so the least
  context is lost in transfer.
- It is stated here so it can be reviewed and changed by Clinical, rather than discovered in code.
  See Open Question 2.

**Size:** M

---

### BAL-9 — One balancing implementation behind every entry point

**Story**
As an **engineer**, I want one balancing implementation behind every entry point, so that a fix or a
rule change lands everywhere at once.

**Acceptance Criteria**

```
Given balancing is invoked from any surface — the Workforce tab or a case drilldown
When the flow runs
Then strategy options, preview format, deselection, application and audit are identical
And only the domain differs: what is being moved, and the rule for selecting it
```

```
Given a defect is fixed in the balancing flow
When it is deployed
Then every entry point receives the fix without a separate change
```

```
Given another module later needs balancing
When it is added
Then only its selection rule, its item vocabulary and its scope definition are new
And no part of the strategy picker, preview, deselection, application or audit is rewritten
```

**Business rules**
- Domain differences belong in a **selection strategy passed into the flow**, not in duplicated
  flows.
- This is worth doing in the UM build even though only UM ships now. The reference has already paid
  for the alternative twice: once where four Assignment History surfaces each had their own copy and
  fixing one left three behind, and once in balancing itself.

**Size:** M

---

### BAL-10 — Scope rebalancing to the right supervisor

**Story**
As a **compliance owner**, I want rebalancing restricted to the supervisor of that module and scope,
so that work is only moved by someone accountable for it.

**Acceptance Criteria**

```
Given I hold no supervisory role for the module
When I view a workload surface
Then no balancing control is offered
And if the action is invoked directly, it is rejected server-side and the attempt is logged
```

```
Given I supervise one team
When I balance
Then only nurses within my scope are offered as source or target
And the plan cannot move work to someone outside it
```

```
Given two supervisors' scopes overlap the same population
When either of them balances
Then the action is permitted
And the audit entry names which supervisor performed it
```

```
Given a move would hand work to a nurse outside my scope
When the plan is built
Then that move requires explicit confirmation naming the receiving supervisor
And it is recorded as a cross-scope transfer
```

**Business rules**
- Moving work **out** of your scope moves it out of your accountability. That is a different act from
  rebalancing within a team, and it should feel different: named, confirmed and recorded.
- Hiding the control is presentation. **Rejecting the action is the control** — the same principle as
  NGP-4391, where a filtered dropdown was mistaken for enforcement.

**[COMPLIANCE NOTE]** Segregation of duties. Who may reassign clinical work, and over which
population, is an access-control decision subject to audit.

**[ASSUMPTION: the reference build has one supervisor persona and does not enforce scope. The role
and scope model is a platform capability this spec depends on rather than defines — see Open
Question 4.]**

**Size:** M

---

## A note on the AI rule

The rebalance plan is produced by a **deterministic algorithm, not a model** — the same inputs give
the same plan every time. The platform's AI recommendation rules therefore do not formally apply, and
no confidence score or model attribution should be displayed, because there is none to show.

BAL-3, BAL-4 and BAL-5 nonetheless implement the control those rules exist to enforce: a
system-proposed action is shown in full, requires explicit confirmation, can be rejected in part, and
writes an audit entry recording what the human actually approved. If a future version ranks or
selects moves using a model, the AI rules apply in full and this section should be replaced rather
than amended.

---

## Contract changes

| Item | Change | Notes |
|---|---|---|
| Balance plan | A plan is a list of concrete moves, each naming the authorization, member, source, target and selection reason | Replaces the by-target count summary. |
| Confirm dialog | Optional itemised picks: `{ id, ref, label, from, to, note, selected }`; confirm returns the surviving ids | Shared contract — reusable by any action that reassigns clinical work. |
| Balance strategy | Move count is `number \| null`, where `null` means "level to tolerance" | Supports BAL-2. |
| Selection strategy | The candidate ranking is injected, not hardcoded into the flow | Supports BAL-6 and BAL-9. |
| Assignment history | Records authorizations and members for every balance | See companion spec, HIST-1. |

---

## Non-functional

- The preview must render before any work moves. No exceptions, no flow.
- Plan building must not mutate live data — the reference simulates against a copy.
- A plan is valid only for the state it was built against. See Open Question 3.

---

## Open Questions

| # | Question | Raised by | Owner | Due |
|---|----------|-----------|-------|-----|
| 1 | Are the levelling tolerance (8 points) and the per-move delta (4 points) client-configurable? They are constants today. | PM | Product | Before BAL-2 build |
| 2 | Is the candidate ordering in BAL-6 fixed clinical policy, or configurable per client? | PM | Clinical | Before BAL-6 build |
| 3 | If workload changes between preview and confirm, do we apply the plan as reviewed, re-validate and warn, or rebuild? | PM | Eng / Clinical | Before BAL-5 build |
| 4 | What is the supervisor role and scope model — which roles, scoped by team, LOB, delegated entity or site, and can one person hold several? BAL-10 depends on it. | PM | Security / Clinical | Before BAL-10 build |
| 5 | For a cross-scope transfer, must the receiving supervisor accept, or is naming them at the point of transfer sufficient? | PM | Clinical | Before BAL-10 build |
| 6 | Should a balance be undoable as a single action, or is a reverse reassignment sufficient? | PM | Product | Post-release |

---

## Out of scope

- **Care management and appeals balancing.** Separate work, separate rules, specified separately.
- **PTO redistribution.** Adjacent but different — it empties one nurse to their teammates rather
  than levelling a group.
- **Queue rebalancing** — moving unclaimed work between queues rather than between people.
- **Automatic or scheduled balancing with no human in the loop.** Not recommended: the preview is the
  control, and removing the reviewer removes it.
- Backend API design and the utilization calculation itself, both unchanged by this spec.
