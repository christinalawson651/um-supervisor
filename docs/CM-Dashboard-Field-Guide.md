# CM Supervisor Dashboard — Field & Calculation Guide

**Scope:** Care Management (CM) Supervisor Dashboard only. UM and Appeals share the same
Scheduling & Adherence / Demand & Forecasting design (see the note at the end) — happy to produce
matching guides for those two modules on request.

**How to read this document:** for every number on screen, this guide gives (1) what it means,
(2) the exact formula behind it, and (3) whether it's currently a **live calculation** (computed
from the underlying case/referral records) or an **illustrative placeholder** (a fixed demo value,
not yet wired to a formula). Several tabs are explicitly the latter — flagged clearly below so
nothing is presented as more real than it is.

All dollar/date examples reflect the demo's fixed "today" of **Friday, July 17, 2026**.

---

## Shared controls (apply across every tab)

| Control | Effect |
|---|---|
| **LOB filter** (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange) | Narrows the active caseload and every steady-state panel (queues, workload, case type, consent, assessments, outreach, care plans, scheduling) to members in that line of business. Does **not** narrow the referral funnel or Demand & Forecasting (those use Lookback instead). |
| **Lookback** (Today / 7 days / 30 days / QTD) | Narrows the **referral funnel** (received-date window) and any metric explicitly labeled with the lookback period (e.g. "Due for Review (30 days)", "Closure Rate (30 days)"). Does **not** narrow the active caseload — a mature member's enrollment date can be months old by design, so gating the caseload by a 7-day window would just make it look empty rather than filtered. |

---

## Top KPI Strip

Always visible above the tabs (collapsible). Scoped by the LOB filter; "New Referrals" is also
scoped by Lookback.

| KPI | Formula |
|---|---|
| **High-Risk Members** | Count of caseload members flagged `highRisk` (Risk Level = High or Critical at generation). |
| **High-Acuity** | Count flagged `highAcuity` (Acuity = High). |
| **High-Cost (>$100k)** | Count flagged `highCost` (annualized cost estimate ≥ $100,000). |
| **SLA At-Risk** | Count flagged `slaAtRisk` (past their next SLA milestone). |
| **Active Care Plans** | Count of caseload members whose care plan status = **Open**. |
| **New Referrals** | Count of referrals received within the selected Lookback window (any status). |
| **Members Managed** | Total caseload size (all members in the current LOB scope). |
| **Intake SLA** | `(Members Managed − SLA At-Risk) ÷ Members Managed`, as a % — i.e. the inverse of the SLA-At-Risk rate. |

---

## Tab: Workforce & Caseload

**Status: live calculation**, computed from the active caseload (`CmData.cases()`).

### Queues (6 cards: New Referral, Outreach, Reassessment, Escalation, Discharge Follow-Up, Documentation)
- **Count** = members currently sitting in that operational queue (a member has at most one queue
  at a time, or none if nothing's actionable right now).
- **Age bands** (0–24h / 24–48h / >48h / Breach), shown as a % split within the card:
  - **Breach** = flagged as past its SLA while queued.
  - **0–24h** = queue age < 24 hours.
  - **24–48h** = queue age 24–48 hours.
  - **>48h** = queue age ≥ 48 hours (and not breached).

### Cases by Case Type
Count of members by their intake wizard's Case Type field (Care Coordination / Case Management /
Disability / Disease Management), optionally filtered to one team.

### Workload — by Care Manager / by Team
| Column | Formula |
|---|---|
| Active | Count of members currently assigned to this care manager (or summed across the team). |
| High Risk / High Acuity / High Cost / SLA At-Risk | Same flags as the KPI strip, counted within this care manager's (or team's) caseload. |
| **Utilization %** | `Active ÷ 40 (capacity per care manager)`, capped at 100%. Team utilization is the **average** of its members' utilization %, not a re-derived team-level ratio. |

### How Members Were Assigned
Count of members by **how their current care manager came to own them** — independent of whether
they have a queue item right now:
- **Queue Draw** — pulled from the shared unclaimed pool.
- **Direct — Smart** — placed by the system's proficiency-matching rule (see "Automated routing"
  under Intake & Referral below).
- **Direct — Manual** — hand-assigned by a supervisor or intake coordinator.

---

## Tab: Scheduling & Adherence

**Status: live calculation, over illustrative shift/attendance data.** The underlying weekly shift
patterns and clock-in/out records are generated for this demo (there's no live HRIS/timeclock
integration behind it), but every rate, count, and rollup shown is a real aggregation of that data —
the same math a production integration would run.

**Period toggle** (Daily / Weekly / Rolling 4 Weeks / Monthly) changes the underlying window every
metric below is computed over. "Monthly" is a rolling ~5-week window, not a calendar-month cut.
**Team filter** narrows everything to one of the three CM teams.

| Tile | Formula |
|---|---|
| **Adherence Rate** | `On-Time shifts ÷ Total scheduled shifts` in the selected period/team. Off and PTO days don't count (nothing to be on-time for). |
| **Exceptions** | Count of scheduled shifts in the period that were **not** On Time (Late Start, Early Leave, Overtime, or Absence). |
| **Care Managers Scheduled** | Count of care managers with a shift schedule in scope (team-filtered headcount). |
| **PTO Days** | Count of PTO-type shift-days in the period/team. |
| **Upcoming PTO** | Count of PTO days scheduled in the **next 3 weeks from today** (forward-looking, independent of the period toggle). |

**Adherence Breakdown** (donut): every scheduled shift in the period, split into On Time / Late
Start / Early Leave / Overtime / Absence. Clicking a segment drills into that exact population.

**Adherence & PTO by Care Manager** (table): per-person adherence rate (same formula as the tile,
computed per individual) alongside PTO Accrued (YTD, prorated by day-of-year against a 20-day
annual grant), PTO Used, and PTO Remaining. Row color thresholds: Adherence Rate red <70%, amber
70–89%, green ≥90%; PTO Remaining red ≤2 days, amber 3–5 days, green >5 days.

---

## Tab: Demand & Forecasting

**Status: live calculation**, bucketed from each referral's actual `received` date (real data, not
fabricated) — the only fabricated part is the demo's underlying referral dataset itself, same as
every other tab.

**Team filter**: a referral has no team of its own before it's accepted, so it's attributed to the
team whose discipline its clinical reason maps to (the same rule "Direct — Smart" routing uses —
see Intake & Referral below).

| Tile | Formula |
|---|---|
| **Referrals This Week (to date)** | Count of referrals received since the Monday of the current week — a partial week, since today sits mid-week. |
| **Projected Next Week** | Average of the **4 most recently completed** weeks (the current partial week is excluded from the average, though it's shown on the trend line). Deliberately a simple trailing average, not a statistical forecasting model. |
| **Team Intake Capacity** (All Teams) | `Intake Coordinators (5) × nominal capacity (15 referrals each)` = 75. |
| **Caseload Headroom** (one team selected) | `(Care managers on that team × 40 capacity) − that team's current active caseload` — how many more active cases the team could take on right now. This is a different concept from Team Intake Capacity (pre-decision intake load vs. post-acceptance caseload room), which is why the label changes when a team is selected. |
| **Coverage Outlook** | "At Risk" if Projected Next Week > the capacity figure above; "Adequate" otherwise. |

The 8-week trend chart plots real weekly volume; clicking any tile drills into the underlying
referrals, the forecast's 4-week basis, or the capacity roster behind the number.

---

## Tab: Intake & Referral

**Status: live calculation.**

### Lifecycle Stage cards (Newly Accepted → Assessment Scheduled → Care Plan Development → Active Monitoring → Care Plan Review Due)
- **Count** = members currently in that stage.
- **On Track / Due Soon / Overdue** split:
  - **Overdue** = flagged at risk of missing its SLA milestone.
  - **Due Soon** = SLA milestone due within 3 days (live date check).
  - **On Track** = everything else.

### Referrals section
- **View Referrals (N)** — opens the full referral list, filterable by Care Manager and scoped by
  LOB/Lookback.
- **New Referrals (N)** — count of currently-**Pending** referrals within the Lookback window.
- **Assign Referral** — hands a Pending referral to an Intake Coordinator (completeness work) or a
  Care Manager who does their own intake; this is **not** the clinical accept/decline decision.
- **Intake Coordinator Workload** — count of Pending referrals currently sitting with each
  coordinator (+ "Unclaimed" for ones nobody's picked up), optionally filtered to one intake
  channel/modality.
- **By Source** — referral count by intake channel (Fax / Provider Portal / Call / UM Referral),
  over the Lookback window.
- **Accepted by Care Manager** — count of **Accepted** referrals currently routed to each care
  manager; bar width = that count ÷ total accepted.
- **By Status** — count by Pending / Accepted / CM Declined / Member Declined, over the Lookback
  window.
- **Pending — Blocked By** — of currently-Pending referrals, how many are blocked by "Pending
  Intake" (just arrived), "Missing Information", or "Missing Eligibility".
- **Referral TAT** — Pending referrals banded by age-since-received against a 3-day intake window:
  On Track / Due Soon (2 days old) / Overdue (≥3 days old).
- **By Referral Reason** — count by the clinical/programmatic reason for referral (6 categories);
  bar width = count ÷ total.
- **Automated routing ("Direct — Smart")** — a referral's clinical reason maps to a target CM
  discipline (e.g. "Behavioral Health Integration" → Behavioral Health), and the system suggests
  the **least-utilized** care manager in that discipline. This surfaces as a "Suggested Care
  Manager" field when reviewing a referral, and as the default-ordered pick in the accept flow —
  it is a suggestion a supervisor confirms, not an automatic silent assignment.

### Consent / Assessments / Outreach
| Panel | Formula |
|---|---|
| Consent (by type) | Count on file per consent type; "At Risk of Expiring" = expires within 30 days (or already past). |
| Assessments (by type) | Count per assessment type; "TAT Adherent" = completed within 5 days of assignment. |
| Outreach Success Rate | `Members reached ≤3 attempts ÷ Total members`. |
| Avg Attempts per Member | Mean outreach attempts across the caseload. |
| UTR Letters Sent | Count of members with an "Unable to Reach" letter on file (sent after repeated failed outreach). |

---

## Tab: Care Plan & Outcomes

**Status: live calculation**, computed per the user's original 11-metric spec.

| Metric | Formula |
|---|---|
| **Active Care Plans** | Count of Open care plans. |
| **Due for Review (30 days)** | Open plans whose review date falls within the Lookback window (0 to N days out). |
| **Overdue Review** | Open plans whose review date has already passed. |
| **Without Goals** | Open plans with zero documented goals. |
| **Without Interventions** | Open plans with at least one goal whose intervention status = "None". |
| **Intervention Completion** | `Completed interventions ÷ interventions "due"` (due = every goal whose intervention status isn't "None"). |
| **Closure Rate (30 days)** | `Plans closed within the Lookback window ÷ total plan population` (open + closed). |
| **Avg. Plan Duration** | Mean days from opened to closed, over plans that have actually closed. |
| **Member Participation** | `Plans with documented member agreement/participation ÷ total plan population`. |
| **Reopened Care Plans** | Count (and %) of plans reopened at least once after a prior closure. |
| **SMART Language Usage** | `Plans whose goal/intervention language meets SMART criteria ÷ total plan population`. Clicking drills into the non-compliant coaching gap. |
| **Goal Progress** (donut) | Every goal across open plans, split Not Started / In Progress / At Risk / Achieved. |
| **Care Plan Template** (donut) | Count of plans built from each of 5 templates (4 condition-specific + "Custom / Other"). |

---

## Tabs that are illustrative placeholders (not yet wired to real calculations)

These five tabs currently show **fixed demo values** — useful for showing the intended layout, but
none of the numbers below recompute from the underlying case data yet:

| Tab | What's static |
|---|---|
| **Risk & Escalation** | The four summary tiles (High-Risk Members: 23, High-Acuity: 14, High-Cost: 9, Escalated Today: 4) and the High-Priority Member Worklist table are all a fixed 6-row list, not derived from the live caseload. |
| **Program Management** | Program Enrollment bars and the Program Outcomes table (enrolled/attainment/readmit reduction) are a fixed 4-program list. |
| **Documentation** | HRA Completion (88%), SDOH Screening (76%), Care Plan Documented (94%), and the Overdue Assessments table are fixed values. |
| **Financial / Cost** | Cost Avoided (MTD), High-Cost Exposure, and PMPM figures are fixed; Highest-Cost Members reuses the same static worklist as Risk & Escalation. |
| **Audit & Compliance** | Care Plan Timeliness (92%), Assessment Compliance (85%), Consent on File (97%), and the Audit Flags table are a fixed 3-item list. |

If any of these matter for the presentation, they're the natural next candidates to wire up to
real formulas — happy to scope that out.

---

## Extending this guide to UM and Appeals

UM and Appeals both got matching **Scheduling & Adherence** and **Demand & Forecasting** tabs this
session, built with the same calculation methodology described above (adapted to each module's own
roster — nurses/teams for UM, reviewers/roles for Appeals). Appeals' Demand tab is a partial
exception: its 8 referenceable appeals are a curated worklist snapshot, not a real per-item
history, so its weekly volume there is a small deterministic series rather than bucketed real
records. Let me know if you'd like the same field-by-field treatment for UM's and Appeals' full tab
sets.
