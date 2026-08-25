# UM Supervisor Dashboard — Field & Calculation Guide

**Scope:** Utilization Management (UM) module only (the 12-tab dashboard plus its top KPI strip). A
matching CM guide already exists (`docs/CM-Dashboard-Field-Guide.md`); an Appeals guide can be
produced the same way on request.

**How to read this document:** every field is tagged with how real it is:

| Tag | Meaning |
|---|---|
| **Live** | Computed in real time from the authorization pool's genuine, distinguishing attributes (decision, dollar amount, provider, submitted date, and tags like `breached`/`atRisk`/`oon`/`expedited`/`concurrent`). Reacts correctly to every filter. |
| **Live rollup*** | The aggregation, percentage, and filter-reactivity are all real — but the underlying per-case attribute being counted (which of 5 intake channels a case arrived through, which of 3 MD reviewers touched it, etc.) is assigned by a **deterministic formula keyed off the authorization ID** rather than a genuinely distinct captured field. It's stable and internally consistent, but it's a stand-in for data this demo doesn't have — not a real intake log, not a real reviewer assignment. Marked with `*` throughout. |
| **Static** | A fixed placeholder value or dataset, not derived from the authorization pool at all. |

This distinction matters for a "knowledgeable audience" presentation: **Live** numbers would
survive a real data connection unchanged in logic; **Live rollup\*** numbers show the right *shape*
of a real feature (percentages, breakdowns, thresholds) but would need the placeholder field
swapped for a genuine source field; **Static** sections are pure mockup and would need to be built
before they mean anything.

All date examples reflect the demo's fixed "today" of **Friday, July 17, 2026**.

---

## Shared controls

| Control | Effect |
|---|---|
| **LOB filter** (All / Medicaid / Medicare Advantage / Commercial PPO / ACA Exchange) | Narrows almost every tab's panels to that line of business. A case's LOB isn't a stored field — it's derived via `LOBS[hash(authId) % 4]` (a **Live rollup\*** input used everywhere LOB appears). |
| **Lookback** (Today / 7 days / 30 days / QTD, default 30 days) | Narrows every "in scope" calculation to cases submitted within that window. |

**Important quirk to know before presenting the top KPI strip:** the 8-tile strip only
recomputes live when the **Lookback** period is changed away from its default (30 days) — changing
the **LOB filter alone, while Lookback stays at its default, does not re-filter the KPI strip.**
Every other tab's own panels already respect the LOB filter as soon as it's touched; the top strip
is the one exception, because its "resting" state intentionally shows a fixed baseline snapshot
rather than recomputing on every keystroke. Worth deciding whether to fix before a live client
demo, but accurately described here as it stands.

---

## Top KPI Strip

| KPI | Formula | Static baseline shown at rest |
|---|---|---|
| **Pending Authorizations** | Count of pending-phase cases (in the Lookback window, once one is applied) | 247 |
| **TAT Compliance** | `On Track decided cases ÷ Total decided cases`, % | 94.2% |
| **Auto-Approval Rate** | `Auto-approved decided cases ÷ Total decided cases`, % | 38% |
| **At Risk** | Count of pending cases tagged "at risk of breaching TAT" | 12 |
| **AHT (Average Handle Time)** | Mean `tatH` across decided cases, shown as hours | 2.4h |
| **Unassigned** | Count of pending cases with no nurse owner | 39 |
| **Breached TAT** | Count of pending cases already past their TAT deadline | 3 |
| **Team Utilization** | Average of the per-nurse utilization values (see Workforce tab — several of those are themselves fixed baselines, not case-count-derived) | 87% |

---

## Tab: Workforce & Queue Management

**Status: Live**, with a few named static exceptions below.

### Queue cards (7 queues: Intake, Clinical Review, MD Review, RFI Pending, OON Review, Concurrent Review, Pending P2P)
- **Count** = unclaimed pending cases in that queue (nurse = "—"), scoped by LOB/Lookback.
- **Age bands** (0–24h / 24–48h / >48h / Breach): **Breach** = tagged as past TAT. The other three
  bands come from `ageH = 6 + (hash(authId) % 90)` — a **Live rollup\*** stand-in for "hours since
  submitted" (6–95h), not a real elapsed-time clock. Band % = band count ÷ total in that queue.
- **Split by LOB** toggle re-slices each queue card into per-LOB counts.

### Workload table — by Nurse
| Column | Formula |
|---|---|
| Active Authorizations | Pending cases owned by this nurse, in scope |
| Pending | Of Active, the subset waiting on an external response (tagged RFI or P2P) |
| Completed (labeled "MTD") | Decided cases owned by this nurse, in scope — the boundary is whatever the shared Lookback window is (30 days by default), **not** an actual calendar-month cutoff despite the label |
| Avg TAT | Mean `tatH` of this nurse's completed cases |
| **Utilization** | **Static baseline** per nurse (92% / 96% / 85% / 72% / 88% / 80%, plus 55% for Rachel Foster) — does not recompute from LOB/Lookback scope. It only changes when a supervisor action (Reassign / Balance / Redistribute for PTO) moves a case to/from that nurse, at which point it's rescaled proportionally to the nurse's own prior case-to-utilization ratio. |

**Rachel Foster's entire row is static** — hand-entered, not derived from the case pool (she isn't
part of the underlying nurse roster the case-pool generator assigns work from).

### Workload table — by Team
Simple sums/averages of the member nurses' own numbers (Avg TAT is an average-of-averages, not
re-derived from raw case data).

### Actions
- **Reassign** — moves a case's queue or owner; recalculates the receiving/losing nurse's
  utilization proportionally.
- **Balance** — moves one case at a time from the highest- to the lowest-utilization nurse.
- **Escalate** — pulls candidates from the same static seed list used by the Risk & Escalation tab
  (see below) — **not** a live risk calculation.
- **Redistribute for PTO** — greedily reassigns a departing nurse's cases one at a time, each time
  to whichever remaining nurse currently has the lowest utilization.

---

## Tab: Scheduling & Adherence

**Status: Live rollup\* over a deterministic, seeded shift/attendance dataset** (same honesty note
as CM's version of this tab — there's no real HRIS/timeclock behind it, but every rate/count shown
is a genuine aggregation of the generated data). Roster: 7 UM nurses across 3 teams (Inpatient
Review, Outpatient Review, Complex & Concurrent).

| Tile | Formula |
|---|---|
| **Adherence Rate** | `On-Time shifts ÷ Total scheduled shifts` for the selected Team + Period |
| **Exceptions** | Count of shifts in period that were not On Time |
| **Nurses Scheduled** | Static headcount of the 7-person roster filtered by team — **does not vary by Period** (Daily/Weekly/Rolling4/Monthly all show the same number) |
| **PTO Days** | Sum of PTO shift-days in the period — cumulative across every week in the window for Rolling 4 Weeks/Monthly, not a daily rate |
| **Upcoming PTO (Next 3 Weeks)** | PTO days across the **current week plus the next two** (weeks 0–2, so it includes some of "this week," not strictly "upcoming") where the date is today or later |

**Adherence Breakdown** (donut): every scheduled shift-day split On Time / Late Start / Early Leave
/ Overtime / Absence, from the same generator as CM's version (~79% On Time / 7% Late / 6% Early /
4% Overtime / 4% Absence by construction).

**Adherence & PTO by Nurse** (table): per-nurse adherence rate (defaults to **100%** rather than "—"
if that nurse has zero shifts in the current scope — worth knowing before a live filter demo);
**PTO Accrued (YTD)** is a flat, identical-for-every-nurse value prorated by calendar day
(`day-of-year ÷ 365 × 20`); **PTO Used** is a deterministic pseudo-random fraction (10–64%) of
accrued days per nurse — neither is drawn from real leave records.

---

## Tab: Demand & Forecasting

**Status: Live**, bucketed from each authorization's real `submitted` date (same honest pattern as
CM/UM's shared design — the fabrication is in the underlying case-pool dataset, not in this tab's
math).

| Tile | Formula |
|---|---|
| **Submissions This Week (to date)** | Count since Monday of the current (partial) week |
| **Projected Next Week** | Trailing average of the 4 most recently **completed** weeks (current partial week excluded from the average) |
| **Total Nurse Capacity** (All Teams) | `7 nurses × 25 (nominal active-authorization capacity each)` = 175 |
| **Caseload Headroom** (one team selected) | `(nurses on that team × 25) − that team's current active caseload` |
| **Coverage Outlook** | "At Risk" if Projected Next Week > the capacity figure shown; "Adequate" otherwise |

---

## Tab: TAT Compliance

**Status: mostly Live**, with two panels that are explicitly static placeholders (flagged below).
Filters: Auth Type (IP/OP/RX), Service Category, plus the shared LOB/Lookback.

### Headline
- **TAT Compliance (donut)** = `On Track decided cases ÷ Total decided cases`, %.
- **On Track / At Risk / Breached** buckets — straight counts of each tag.
- **Expedited / Standard / Paused** stat boxes — tag counts (Paused pulls from pending cases only).
- **Avg Turnaround** — computed live (`mean tatH`) only once a filter is applied; in the **default,
  unfiltered view it's a static `"1.8d"` string**, not a calculation.

### Inpatient Concurrent Review sub-panel (shown when scope includes Inpatient)
Reuses the same per-case day-count math as the Concurrent Review Monitoring tab (LOS, expected LOS,
certified/requested days) — see that tab below for the exact formulas. **Live rollup\*.**

### TAT Compliance by Line of Business / by Service Category (tables)
Per group: `Compliance % = On Track ÷ Total`, sorted by volume. Color bands: teal ≥90%, red <85%.
**Live.**

### Notification Compliance panel — **Static placeholder**
"Member" and "provider" notice lateness (`memberLate`/`providerLate`) is **not** a real
date/deadline comparison — it's a fixed pattern (literally "every 31st adverse case" and "every
55th decided case," by array position). **Avg Time to Notice is a hardcoded `0.7` days constant.**
The percentages shown react to filters (since the underlying case set changes), but the lateness
determination itself is not a genuine calculation — flag this clearly if presenting notification
compliance as a real capability.

### Regulatory TAT by Urgency panel
Displays fixed regulatory-clock labels ("72 hours" for Expedited/Urgent, "14 calendar days" for
Standard Pre-Service) alongside the same real On Track/At Risk/Breached tag counts used elsewhere
— the clock labels are descriptive text, not independently validated against an hour-based field in
this panel.

---

## Tab: Clinical Decision Insights

**Status: Live**, with clearly-flagged synthetic sub-fields.

- **Decision Mix** (Approved/Denied/Partial %) — live, from each case's real `decision` field.
- **6 headline stats** (Approved / Denied / Partial / Auto-Approved / MD Review / P2P Rate, all %
  of decided cases in scope) — live, from real `decision` field and real tags.
- **Reason Codes by Outcome** (toggle Denied/Partial/Approved) — the % breakdown is a live
  aggregation, but which specific reason code each case carries is assigned via a deterministic
  hash of the authorization ID (**Live rollup\***), not a clinician's actual documented rationale.
- **Decision Drilldown by Service** (by-procedure Approval Rate % / Volume) — live, from real
  `decision` and `procedure` fields; the clinical guideline shown per procedure comes from a fixed
  lookup table (19 procedures).
- Row-drawer's **"Denials (est.)"** figure is a client-side estimate
  (`Volume × (1 − Approval Rate)`), not an actual denial count field.
- Row-drawer's **MD reviewer name** and **criteria-met count** are also authorization-ID hashes
  (**Live rollup\***), not real reviewer/criteria-checklist data.

---

## Tab: Risk & Escalation Panel

**Status: mostly Static** — the tab with the least real calculation behind it in the UM module.

| Tile | Status |
|---|---|
| SLA Breach Risk | Live (reads the shared "At Risk"/"Breached" KPI counts) |
| High-Dollar (>$50k) | **Live** — count/exposure of in-scope pending cases costing ≥ $50,000 |
| High-Acuity | Live *filter logic*, applied over a **static 6-row seed list** (see below) |
| Escalated Today | Live — count of this-session escalation actions from the shared activity log |

**"Authorizations Requiring Attention" table is a fixed, hand-authored 6-row list** (not derived
from the case pool at all) — the risk score, dollar amount, drivers, and red/amber tone on each row
are pre-set values, not the output of a scoring formula. Escalating a row removes it from the list
(so the demo can show the worklist "clearing"), but nothing about *which* cases are risky is
calculated. If this tab needs to be presented as a real capability, it's the top candidate (along
with CM's equivalent tab) to wire up to an actual risk-scoring formula.

---

## Tab: Concurrent Review Monitoring

**Status: Live rollup\*** — genuinely derived from the case pool (pending cases tagged
"concurrent"), but every day-count field is a deterministic formula keyed off the authorization ID
rather than a real admission/certification date.

Per case (all Live rollup\*, keyed off a 2-digit hash `n` of the authorization ID):
- **LOS** (day of stay) = `3 + (n % 10)` → 3–12 days.
- **Expected LOS** = `3 + ((n+3) % 8)` → 3–10 days.
- **Total Certified Days**, **Uncertified Days**, **Days Remaining**, **Days Requested** — all
  derived from LOS/Expected LOS via fixed rules (documented in full in the engineering appendix if
  needed).
- **Certified Through**, **Next Review Due**, **Expected Discharge** — each is "today" plus a
  deterministic day offset from the same hash.
- **Status / Next Action** — a priority chain: Uncertified Days present → "Uncertified Days"
  (red); else Days Requested > Certified → "Extension Requested" (amber); else Days Remaining ≤ 1
  → "Recert Due" (amber); else "Certified" (green).

**Headline stats** (Active Reviews, Uncertified Days, Extension Requested, Recert Due, Certified)
are live counts of the above. The **Stay Timeline bar** is a genuine visualization of the same
fields (certified-so-far / at-risk-uncertified / certified-cushion segments, today marker, expected
-discharge marker). **Balance-selected** uses a simplified greedy simulation (assign to whichever
nurse is currently least-utilized, then bump their simulated utilization by a flat +4) rather than
a true capacity recalculation.

---

## Tab: Intake & Documentation Quality

**Status: Live rollups\*** throughout — every percentage is a genuine aggregation over the in-scope
pending caseload, but most of the *categorical* fields being counted (which intake channel, which
missing-info category, which specific missing field, whether routing was "Smart" vs. "Manual,"
whether an authorization is a duplicate, why intake processing failed) are authorization-ID hashes
rather than real captured attributes. A few classifications **are** genuine tag-based facts:
"Late" routing (from the real at-risk/breached tags), "Concurrent Review" auth type (real tag), and
"Out of Network" provider issues (real tag) all ride on real data; everything else in this tab is a
placeholder standing in for a field this demo doesn't have.

| Panel | What it shows |
|---|---|
| Complete Submissions / Auto-Approved / Needing RFI | % of pending (or decided, for Auto-Approved) cases without the "incomplete doc" tag / with the "auto" tag / with an RFI raised at intake |
| Intake Channel Mix | % split across 5 channels (Live rollup*) |
| Routing Status | Smart / Manual / Late split, cross-tabbed by Standard/Expedited urgency |
| Duplicates | Unresolved vs. resolved count (both Live rollup*) |
| TAT & Assignment Risk | Real counts of at-risk and unassigned pending cases |
| Missing Information | % by category, of the incomplete-doc subset (Live rollup*) |
| Top Missing Fields | Count and % (of **all** pending submissions, not just incomplete ones) per specific missing field (Live rollup*) |
| Auth Type (Review Timing) | Pre-Auth / Concurrent Review / Retro split |
| Provider Issues | Incomplete vs. Out-of-Network counts |
| Intake Auto-Processing | Completed / Failed / "No Shell Created" outcome split for cases still in the Intake queue |

---

## Tab: Provider & Network Insights

**Status: Live**, with one clearly-flagged synthetic input. This is the tab built specifically
around **peer-relative outlier flagging** rather than fixed magic-number thresholds.

Per provider/facility (6 in the demo): Total Requests, OON Requests, Approval/Denial/Partial-
Approval Rate, Incomplete Rate, Expedited Rate — all live, from real `decision`/tag fields. **Avg
Response Time** is a fixed value per provider name (1–4 days, from a name-hash) — a **Live rollup\***
stand-in, since there's no real request/response timestamp pair to measure.

**Outlier flags** (a provider can carry several at once), each compared to the peer average across
all 6 providers in the current scope:
| Flag | Trigger |
|---|---|
| OON Exceptions | Any OON activity at an In-Network/Delegated provider, or ≥3 OON requests regardless of status |
| Missing/Late Clinicals | ≥ the greater of 2, or 125% of the peer-average count |
| Network-Status Exceptions | Provider's network status is Out-of-Network or Exception |
| High Incomplete Rate | ≥ the greater of 10%, or 125% of peer average |
| High Denial/Partial Rate | ≥ the greater of 15%, or 125% of peer average |
| Unusual Utilization | Volume ≥ 140% of peer average, or Expedited Rate ≥ the greater of 15%, or 140% of peer average |
| Repeated TAT Delays | Avg Response Time ≥ the greater of 3 days, or 120% of peer average |

**Gold Card** designation (fixed, not peer-relative, by design): no flags **and** Approval Rate ≥
60% **and** Total Requests ≥ 20 — modeled on real prior-authorization-exemption ("gold carding")
programs, which use a statutory bar rather than a curve.

---

## Tab: Cost & Utilization Insights

**Status: Live**, over the pending (active) caseload, with one flagged synthetic input.

Per case: **Requested Cost** (real `cost` field); **Approved Cost** is `Requested Cost × a
modeled approval factor` (mostly 85–100%, occasionally 50–65% for ~20% of cases) — a **Live
rollup\*** stand-in for a real adjudicated amount, since these cases haven't been decided yet.
**Cost Variance** = Requested − Approved.

**Flags** (a case can carry several): High-Cost (≥ $50,000); Out-of-Network Cost Exposure;
Uncertified Inpatient Days (reuses Concurrent Review math); Extended-Stay Exposure (actual LOS >
expected LOS); High-Cost Drug/Procedure (Pharmacy or DME/Home Health service, ≥ $10,000); Requested
-vs-Approved Variance (≥ the greater of $5,000, or 15% of requested cost); Potential Duplicate
Service.

**Total Cost Exposure** per case = the **maximum** (not the sum) of whichever applicable amounts
apply — e.g. a case flagged both High-Cost and Uncertified Days doesn't double-count both dollar
figures, it takes the larger one. The tile-level **Total Cost Exposure (Estimate)** sums this
per-case figure across all in-scope cases. **Avg Requested-vs-Approved Variance %** is the mean of
each case's own variance ratio (not aggregate variance ÷ aggregate cost). Breakdowns by Service Type
and Network Status are both computed over the needs-attention subset only, not the full caseload.

---

## Tab: Audit & Compliance

**Status: mixed** — one Live rollup* section, one explicitly-modeled section, one real-reference-
data section, and one fully static table.

### Internal Quality bars — Live rollup* (explicitly documented in source as "proxy metrics")
Documentation Completeness (% without the incomplete-doc tag), Guideline Adherence (% of decided
cases not tagged "appeal" — used as a stand-in, since "was it appealed" is the closest available
proxy for "was the guideline applied correctly"), Decision Rationale Documented (% of approved
cases that weren't auto-approved and weren't incomplete) — all real aggregations, but explicitly
proxy definitions rather than a literal "rationale documented" field.

### Inter-Rater Reliability (IRR) — explicitly modeled, not real audit data
Which cases get "sampled" for IRR and whether the sampled reviewer "agreed" with the original
decision are both simulated: roughly 40% of Denied/Partial decisions and 10% of others are sampled
(weighted toward denials, as a real audit program would do), and agreement is modeled at ~95% for
Denied/Partial and ~99% for others. The **IRR Agreement Rate**, **Reviewers Below 90% Threshold**
(reviewers with ≥3 sampled cases and <90% agreement), **Denial/Partial Sample Coverage**, and the
**by-Reviewer breakdown** are all real aggregations of this simulated sample — useful for showing
the *shape* of an IRR program, not yet real audit output.

### Regulatory TAT Compliance by Program — real reference thresholds, modeled case data
Per-LOB statutory windows are real reference values (flagged in source as "directional — validate
exact citations with Compliance"): Medicaid 14 days / 72h expedited (42 CFR §438.210); Medicare
Advantage 14 days / 72h (42 CFR §422.568); Commercial PPO 15 days / 72h (ERISA §2560.503-1); ACA
Exchange 15 days / 72h (ACA §2719). However, each case's own turnaround time (used to test against
those windows) is a deterministic authorization-ID hash, not a measured decision date — so the
thresholds are real, but the data being tested against them is a placeholder.

### Audit Flags table — Static
A fixed 4-row list (Missing Rationale, Guideline Deviation, Incomplete Documentation, TAT
Compliance) with hand-set severity. Marking one resolved removes it from the list; nothing about
which flags exist or their severity is calculated.

---

## Tab: CM Referrals

**Status: fully Static.** This entire tab — the three summary cards (Referred to CM, Pending
Intake, Care Plan Active) and the outgoing-referral table — reads a fixed 6-row dataset. The "MTD"
label on the first card is descriptive text, not an actual month-to-date filter (it's just the full
static list). SLA labels and their red/amber/green tone are hand-assigned per row, not computed
from a date comparison.

---

## Notes for a knowledgeable audience

- **A recurring pattern worth naming once, up front, if asked "is this real data?":** dozens of
  fields across Intake, Provider, Clinical, and Audit are assigned via a **deterministic formula
  keyed off the authorization ID** (e.g. "channel = `CHANNELS[hash(authId) % 5]`"). This is
  intentional design for the demo — it keeps every number stable across reloads and internally
  consistent — but it means the *field itself* is a placeholder for something a real integration
  would need to supply, even though the *math built on top of it* (rates, breakdowns, peer
  comparisons, thresholds) is genuine and would carry over unchanged.
- **Unit-label inconsistency worth resolving with engineering before a client-facing claim about
  turnaround time:** the case pool's `tatH` field is rendered as hours in some places (e.g. the
  case-detail export column "TAT (h)") and as days in others (e.g. TAT Compliance tab's "Avg
  Turnaround," suffixed "d"). The underlying values are small (0.3–6.0), consistent with an hours
  interpretation — worth confirming the intended unit before it's quoted in a presentation.
- **Two tabs are the best candidates to "go live" next** if this demo needs to look more complete:
  Risk & Escalation Panel (currently a static 6-row worklist) and the Audit Flags table (currently
  a static 4-row list) — both are small, self-contained, and have an obvious real formula to wire
  in (a risk-scoring rule; a compliance-flag-generation rule), similar to what was done for CM's
  Care Plan & Outcomes tab this session.
