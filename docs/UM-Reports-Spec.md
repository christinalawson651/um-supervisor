# UM Reports Module — Developer Spec

**Status:** Implemented (prototype/demo)
**Module:** Reports → UM (Utilization Management reports only; CM and Appeals report catalogs exist as empty arrays, not yet built)
**Primary files:**
- `src/app/data/report-registry.ts` — report catalog, filters, and business logic (the source of truth for what each report shows)
- `src/app/modules/reports-dashboard.ts` — the UI shell that renders the picker, filter bar, generated tables, print, and export
- `src/app/shared/export-dialog.ts`, `exports.ts`, `export-csv.ts`, `exporter.ts` — the multi-table export pipeline this module drives
**Related docs:** `docs/UM-Dashboard-Field-Guide.md` classifies the underlying case-pool data (Live / Live rollup\* / Static) that every report ultimately reads from. This document doesn't repeat that guide — it covers the Reports module itself: its architecture, its UI/interaction spec, its report catalog, and the handful of data-model fields (diagnosis, authorization status, OON resolution) added specifically to support new reports.

> This is a prototype over deterministic, seeded mock data (no RNG — the same input always produces the same output). "Live" below means "computed in real time from `CASE_POOL` and reacts correctly to filters," not "backed by a real production database."

---

## 1. Purpose & Scope

The Reports module is a **printable, exportable, filter-then-generate reporting surface**, distinct from the live dashboard tabs. It exists so a supervisor can pull a specific, scoped, operational report (not just glance at a dashboard tile) and hand it to someone else as a PDF/CSV/Excel file with a clear record of who ran it, when, and with what filters.

It is reachable as its own top-level module pill (TruCare Pulse | UM | CM | Appeals | **Reports**) and is visible to every role — it isn't gated by the UM/CM/Appeals role scoping the way the live dashboards are (Generic reports are always shown; UM/CM/Appeals report groups appear based on `Nav.scope()`).

### Design rules (binding — any new report should follow these)

1. **One report = one specific query.** Do not bundle several unrelated tables into one report just because they live on the same dashboard tab. (Exception: a report may return *multiple tables* if they're all facets of the same query — e.g. "Queue Standing" returns both an aggregate table and a by-LOB breakdown of the same data.)
2. **Full, real detail by default.** No pre-baked "top 5" or "only the exceptions" truncation. If a slice is useful, it's a dropdown filter the user picks, not a decision the report makes for them.
3. **No KPI tiles.** Just filters and tables — this is for operational use, not an executive summary.
4. **Every report calls the same calculation functions already backing the live dashboard tabs** (`dashboard-data.ts`'s `live*` functions, or direct `CASE_POOL` filters using the same derived-field helpers in `case-fields.ts`). A report's numbers must always reconcile with what's on screen elsewhere — nothing is recomputed independently.

---

## 2. Architecture

### 2.1 Core types (`report-registry.ts`)

```ts
export interface ReportTable { title: string; columns: string[]; rows: (string | number)[][]; }
export interface ReportDimensionFilter { label: string; options: string[]; }

export interface ReportContext {
  lob?: string | string[];
  days?: number;
  dimension?: string;   // currently-selected value of the report's optional dimension filter
  dimension2?: string;  // a second, independent dropdown (e.g. TAT's Auth Type + Service Category)
  queues?: string[];    // selected queues, for queueFilterable reports
  memberSearch?: string;
  period?: string;      // schedulePeriod reports only — daily/weekly/rolling4/monthly
  historyTeam?: string;
  historyStaff?: string;
  historyActor?: string;
  data: DashboardData;  // for reports needing session-mutable signals (nurses(), riskCases(), auditFlags())
}

export interface ReportDef {
  id: string;
  module: 'um' | 'cm' | 'appeals' | 'generic';
  group: string;              // sidebar sub-heading (WFM, Audit & Compliance, etc.)
  title: string;
  description: string;
  staticNote?: string;        // callout shown when part/all of the report is illustrative, not live
  dimension?: ReportDimensionFilter;
  dimension2?: ReportDimensionFilter;
  noLobDays?: boolean;        // true for reports not scoped by LOB/lookback (staffing/schedule-based)
  caseLevel?: boolean;        // case-level drilldown: adds Queue multi-select + Member search, uses shared COLUMNS/toRow
  queueFilterable?: boolean;  // adds a Queue multi-select (only meaningful alongside caseLevel/pending-only data)
  historyFilterable?: boolean;// adds Team / Staff / Actor dropdowns + Member search, for HistoryEntry-based reports
  memberSearchable?: boolean; // adds a plain Member search box (independent of caseLevel/historyFilterable)
  schedulePeriod?: boolean;   // adds a Daily/Weekly/Rolling 4 Weeks/Monthly dropdown
  tables: (ctx: ReportContext) => ReportTable[];
}
```

Reports are grouped into 4 registries, each a plain `ReportDef[]`:

```ts
export const UM_REPORTS: ReportDef[] = [ /* 22 entries */ ];
export const CM_REPORTS: ReportDef[] = [];        // not yet built
export const APPEALS_REPORTS: ReportDef[] = [];   // not yet built
export const GENERIC_REPORTS: ReportDef[] = [ /* 1 entry: User Activity Report */ ];
```

`ReportsDashboard` (the component) maps `Nav.scope()` (the caller's visible business modules) plus `'generic'` to these registries via a `REGISTRY: Record<Group, ReportDef[]>` lookup.

### 2.2 Configure → Generate → View, not live-reactive

This is the most important architectural decision in the module, called out explicitly in a code comment:

> A report is generated on demand from a chosen filter scope — it is **not** a live-reactive view of the dashboard. Selecting a report (or changing filters) drops back into "configure" mode with no output shown; clicking **Generate Report** snapshots the current filters and renders the result. Changing a filter after that has no effect until you explicitly re-generate — the report you're looking at should never silently change under you.

Mechanically: the filter-bar signals (`dimension`, `selectedLobs`, `memberSearch`, etc.) are the "form." `generate()` freezes them into an immutable `ReportContext` (`appliedCtx`), and the rendered `tables()` computed reads *only* from `appliedCtx` — never from the live form signals. `editFilters()` just flips `generated` back to `false`; it does not clear the form, so your prior selections are still there to tweak.

### 2.3 Grouping (sidebar)

Each `ReportDef.group` string is a sidebar sub-heading. `subGroupsFor(module)` buckets a registry's reports by `group`, preserving first-appearance order (not alphabetical) — so the array order in `report-registry.ts` determines display order within a module. Current UM groups, in order of first appearance: **Queue & Case Operations**, **Workforce Management (WFM)**, **Clinical & Utilization**, **Provider & Network**, **Audit & Compliance**, **Diagnosis & Coding**.

---

## 3. UI / Interaction Spec

### FR-1 — Report picker sidebar

- **Where:** `<aside class="picker">` in `reports-dashboard.ts`.
- Reports are listed under two levels: module (`UM`/`CM`/`Appeals`/`Generic`) → group (per §2.3) → individual report buttons.
- **AC-1.1:** Every group starts **collapsed** on load. Clicking a group's caret toggles it independently of every other group (`expandedGroups: Set<string>`, keyed by group name — not per-module, so a group name collapsed under one module stays collapsed if the same name later appears under another).
- **AC-1.2:** Selecting a report from a collapsed group auto-expands that group as a one-time convenience (`select()` adds the report's group to `expandedGroups`). This is *not* a standing rule — the group can still be manually collapsed afterward even while its report stays open (there is no special-casing that forces the active report's group to stay open — that was tried and explicitly reverted because it prevented collapsing the group you were actively looking at).
- **AC-1.3:** The whole sidebar can be collapsed to a ~40px rail via a `«`/`»` toggle button, independent of per-group state, to reclaim horizontal space for wide tables. `.reports-shell` grid-template-columns animates between `240px 1fr` and `40px 1fr`.
- **AC-1.4:** The sidebar (and every other picker/filter control) is marked `no-print` and does not appear in printed/PDF output.
- **AC-1.5:** Group header font size matches report-item font size (both 13px) — group headers must never read as *less* prominent than the items they contain.

### FR-2 — Report header

- **Where:** `.report-head`, directly above the filter bar / generated tables.
- **AC-2.1:** A `▾`/`▸` chevron collapses the description paragraph and the `staticNote` callout (if present), leaving only the title — for reclaiming vertical space once you're working with the tables. This does **not** hide the filter bar or generated tables; only the descriptive text.
- **AC-2.2:** A `×` close button fully deselects the report (`closed` signal) — distinct from "no report picked yet" (which falls back to the first report in the list so the module never opens onto a blank page). Closing shows an explicit "No report open — choose one from the list on the left" empty state.
- **AC-2.3:** `headerCollapsed` and `closed` both reset to their default (expanded / not-closed) whenever a new report is selected via `select()`.
- **AC-2.4:** The report title (`<h2>`) is 14px/600-weight — matching the font size of each generated table's own section title (`.pt`), not a larger page-header size.

### FR-3 — Filter bar (configure step)

Rendered only when `!generated()`. Which controls appear depends on the `ReportDef`'s flags:

| Control | Shown when | Behavior |
|---|---|---|
| **Lookback** (Today / 7 days / 30 days / QTD) | `!noLobDays` | Segmented button group; mutually exclusive with **Since**. |
| **Since** (custom date) | `!noLobDays` | A date picker; selecting a date clears the Lookback segment selection. |
| **LOB** | `!noLobDays` | Multi-select dropdown — see FR-3a. |
| `dimension` dropdown | `ReportDef.dimension` set | Single-select `<select>`, labeled per `dimension.label`. |
| `dimension2` dropdown | `ReportDef.dimension2` set | A second, independent single-select dropdown alongside `dimension`. |
| **Period** (Daily/Weekly/Rolling 4 Weeks/Monthly) | `schedulePeriod` | Single-select `<select>`. |
| **Queues** (multi-select checkboxes) | `caseLevel && queueFilterable` | Only meaningful for pending-only, queue-scoped reports. |
| **Member** search box | `caseLevel`, or `memberSearchable && !caseLevel && !historyFilterable`, or `historyFilterable` | Plain substring, case-insensitive text match. |
| **Team / Staff / Reassigned By** dropdowns + Member search | `historyFilterable` | For `HistoryEntry`-based reports (assignment/reassignment history). |
| "No filters apply..." note | `noLobDays && !dimension && !dimension2 && !schedulePeriod && !caseLevel && !memberSearchable` | Shown instead of an empty filter bar. |

**FR-3a — LOB multi-select dropdown** (built specifically because a real client can have 50–100 LOBs, not just this demo's 4):

- A trigger button shows a smart summary: **"All LOBs"** when nothing (or *everything*) is selected, the LOB name itself when exactly 1–2 are selected, or **"N LOBs selected"** for 3+. An explicit "select every option" state collapses back to "All LOBs" rather than listing every name — selecting all is semantically identical to selecting none (no filter).
- Clicking the trigger opens a panel (anchored below the trigger, with a full-page transparent scrim behind it — clicking the scrim or the **Done** button closes it; clicking inside the panel does not).
- The panel has: a text search box (filters the option list by substring), **Select all** / **Clear** shortcuts, and a scrollable (max-height 220px) checkbox list.
- Selected state is a plain `selectedLobs: string[]` signal; `toggleLob()`/`selectAllLobs()`/`clearAllLobs()` mutate it directly.

### FR-4 — Generate / Edit Filters / Close lifecycle

- **Generate Report** button freezes the form into `appliedCtx` (a `ReportContext`) and `appliedScope` (a human-readable scope string built by `buildScopeLabel()`, e.g. `"30 days · Medicaid, Commercial PPO · Team: Outpatient Review"`), and stamps `generatedAt` (`new Date().toLocaleString()`).
- Once generated, the filter bar is replaced by a **scope bar**: `Scope: <appliedScope>` on the left; Portrait/Landscape toggle, **Edit Filters**, **Print**, **Export** on the right.
- **Edit Filters** returns to the configure step without clearing the form (your prior selections are still set).
- Nothing under `tables()` re-reads the live filter signals — only `appliedCtx`. This is what makes "the report you're looking at never silently changes under you" true.

### FR-5 — Print

- A **Portrait/Landscape** segmented toggle (`orientation` signal) controls a real page-size override, not a cosmetic-only toggle.
- `doPrint()` **always** explicitly injects `<style>@page { size: portrait; }</style>` or `landscape` (never omits the override for portrait) — some browsers remember the orientation from the last print job on the same origin, so a prior bug here was that picking Portrait after a Landscape print silently did nothing (fixed; always stamp both directions explicitly).
- The injected style is removed on the `afterprint` event.
- `.print-header` (title + scope + generated-at/by line) is `display: none` normally and `display: block` only inside `@media print` — it exists purely for the printed page, distinct from the on-screen `.report-head`.
- Every `.no-print`-marked element (sidebar, filter bar, scope bar, buttons) is hidden via `@media print { .no-print { display: none !important; } }`.

### FR-6 — Export

- Three formats: **CSV**, **Excel (.xls, SpreadsheetML)**, **PDF** (a print-ready HTML page opened in a new tab, auto-triggers `window.print()`).
- `doExport()` always passes **every table the report currently shows** as `sections`, plus `combineAll: true` — this is deliberate: a prior bug had the export dialog silently exporting only *one* table (whichever the section-picker defaulted to) when a report had exactly 2 tables, because the section-picker UI was designed for tab-level "pick one dataset" exports, not "give me the whole report." `combineAll` bypasses that picker entirely for Reports-sourced exports.
  - CSV: all tables in one file, each preceded by a `## Table Title` marker line.
  - Excel: one workbook, one worksheet per table (sheet names capped at 31 chars per Excel's limit), plus a leading **Report Info** sheet.
  - PDF: one page, every table rendered in sequence.
- **Every export is stamped with provenance** via `ExportMeta { generatedAt, generatedBy, scope }`:
  - CSV: three leading rows (`Generated`, `Generated By`, `Filters Applied`) before the first `##` table marker.
  - Excel: the leading **Report Info** sheet (`Field`/`Value` rows for the same three items).
  - PDF: folded into the meta line under the title (`Generated <ts> by <name> · Filters: <scope> · N rows across M tables`).
  - `generatedBy` is currently hardcoded to `"Christina Lawson"` (the demo's only signed-in user, matching the topbar) — **a real implementation needs to source this from the authenticated session, not a constant.**

---

## 4. Data model additions made specifically for Reports

None of the following existed before the Reports module needed them. They live in `src/app/data/case-fields.ts` / `case-pool.ts`, follow the same "deterministic, no RNG, seeded off `authId` digits" pattern as every other derived field in the app, and are **not yet reflected in `docs/UM-Dashboard-Field-Guide.md`** (that guide predates these — flagged as a follow-up).

| Field | Function(s) | Classification | Notes |
|---|---|---|---|
| **Diagnosis (ICD-10-CM)** | `dxOf(c)`, `DX_BY_PROCEDURE`, `DX_CODES` (`case-pool.ts`) | **Live rollup\*** | Every procedure maps to 2 clinically plausible ICD-10-CM codes (e.g. Total Knee Replacement → `M17.11`/`M17.12`); which of the 2 a given case gets is `authId`-hashed, not a captured field. Powers 3 dedicated reports + a column on 2 others + the Clinical tab's new "Diagnosis Mix" panel. |
| **Authorization Status Mix** | `authStatusOf(c)`, `AUTH_STATUSES` | **Live rollup\*** | Collapses the 7 real pending-queue names into 5 lifecycle-stage labels a supervisor thinks in (e.g. `Clinical Review` + `Concurrent Review` → `In Clinical Review`) plus the 4 decided-phase statuses. **Draft, Withdrawn, and Expired are not modeled anywhere in this demo** — no case ever enters those states, so this mix can only ever show Submitted/In Review/Pended/Determined. |
| **OON Resolution** | `oonResolutionOf(c)` → `'Continuity of Care' \| 'Single Case Agreement' \| 'Standard Exception'` | **Live rollup\*** | Every `oon`-tagged case (the 15 in the `OON Review` pending queue) is deterministically bucketed into one of the 3 resolutions (`authId`-hashed, roughly 1/3 each). |
| **OON / CoC / SCA Reason** | `oonReasonOf(c)`, `COC_REASONS`, `SCA_REASONS`, `STANDARD_OON_REASONS` | **Live rollup\*** | Each resolution has its own 3–5-item reason-code list (e.g. CoC → "Pregnancy — second or third trimester"); which reason a case gets is `authId`-hashed within its resolution bucket. |

These are surfaced in the **live dashboard** (not just Reports) at: Clinical tab → "Diagnosis Mix" panel + "Authorization Status Mix" panel; Provider & Network tab → "Out-of-Network Resolution" panel. Per explicit direction, **no new dashboard tabs were added** for these — they were folded into the two existing tabs that already own the closest-related concepts.

---

## 5. UM Report Catalog (22 reports)

Every report calls `inScope(c, ctx.lob, ctx.days)` (or an equivalent LOB/date filter) unless it's `noLobDays`. "Columns" below are per-table; a report with multiple tables lists each separately.

### Group: Queue & Case Operations

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **Queue Standing** (`um-queue-standing`) | Unclaimed authorizations by queue, age-band + breach + by-LOB detail. | Lookback, LOB | *Queue Standing*: Queue, Unclaimed, 0-24h %, 24-48h %, >48h %, Breach %. *Queue Standing by LOB*: Queue, one column per active LOB. | `ctx.data.queueStatsScoped()` |
| **Breach Detail** (`um-breach-detail`) | Every unclaimed authorization past its TAT deadline, case-level. Matches the Workforce tab's queue-card breach drill (unclaimed only — assigned breaches show under that nurse's workload instead). | Lookback, LOB, Queues (multi), Member search | *Breached Authorizations*: shared `COLUMNS` (Auth ID, Member, Procedure, Service Type, Status, Decision, Provider, Urgency, Submitted, TAT (h), Est. Cost). | `CASE_POOL` filtered on `phase==='pending' && nurse==='—' && tags.includes('breached')` |
| **Daily Inpatient Authorization Requests** (`um-daily-ip`) | Inpatient auths submitted in the window, case-level. Defaults to a daily grain via Lookback="Today". | Lookback, LOB, Member search | *Inpatient Authorization Requests*: shared `COLUMNS`. | `CASE_POOL` filtered on `authTypeOf(c)==='IP'` |
| **Authorizations by Member** (`um-auth-by-member`) | Every authorization on file for one member, all phases/queues. **Search-driven — shows nothing until a name is entered.** | Member search only (`noLobDays`) | *Authorizations by Member*: `COLUMNS` + LOB + Diagnosis. | `CASE_POOL` filtered by member substring; empty array when search is blank |

### Group: Workforce Management (WFM)

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **Team & Nurse Workload** (`um-team-workload`) | Per-nurse workload + team rollups. | Lookback, LOB, Team, Nurse-name search | *Workload by Nurse*: Nurse, Team, Active, Pending (RFI/P2P), Completed, Avg TAT, Utilization. *Team Totals*: Team, Nurses, Total Active, Total Pending, Total Completed, Avg TAT, Avg Utilization. | `ctx.data.nurses()` + `nurseStatsForLob()` (special-cased for Rachel Foster, who isn't in `case-pool.ts`'s `NURSES` roster) |
| **Reassignment & Assignment History** (`um-assignment-history`) | Session log of reassignments/balancing/PTO-driven moves. | Lookback (by date), Team, Staff, Reassigned By, Member search | *Assignment History*: Date, Time, Action, Detail, Team, From, To, Members, By. | `ctx.data.assignmentHistory()` |
| **Adherence Detail by Nurse** (`um-adherence-detail`) | Per-nurse on-time/exception rate over a selectable period. | Team, Nurse-name search, Period (Daily/Weekly/Rolling4/Monthly) — `noLobDays` | *Adherence Detail (period)*: Nurse, Team, Adherence Rate, Late Start, Early Leave, Overtime, Absence. *Day-Level Detail*: Nurse, Date, Day, Scheduled Start, Actual Start, Status, Variance (min). | `UM_ROLLING_4_WEEKS` / `UM_MONTHLY_WEEKS` (`um-schedule.ts`) — **Static**: seeded shift/attendance dataset, not a real timeclock feed |
| **PTO Balances** (`um-pto-balances`) | Accrued/used/remaining PTO YTD. | Team — `noLobDays` | *PTO Balances (YTD)*: Nurse, Team, Accrued, Used, Remaining. | `UM_PTO_BALANCES` |
| **Upcoming PTO** (`um-pto-upcoming`) | Scheduled PTO over the next 3 weeks. | Team — `noLobDays` | *Upcoming PTO (Next 3 Weeks)*: Nurse, Team, Day, Date. | `UM_UPCOMING_WEEKS` |
| **Weekly Submission Volume** (`um-demand-weekly`) | Raw weekly submission counts, trailing 9 weeks. | Team — `noLobDays` | *Weekly Submission Volume (9 Weeks)*: Week Of, Submissions. | `CASE_POOL` bucketed by `submitted` date, filtered by nurse→team map |
| **Capacity & Coverage Outlook** (`um-capacity-coverage`) | Projected next-week volume vs. capacity; switches to "Caseload Headroom" when a team is picked. | Team — `noLobDays` | *Capacity by Team*: Team, Nurses, Nominal Capacity. *Per-Nurse Capacity & Utilization*: Nurse, Team, Active, Utilization. *Coverage Outlook*: Metric, Value (This Week, Projected Next Week, Capacity/Headroom, Margin, Outlook). | Same 9-week bucketing as above + `nurses()` |

### Group: Clinical & Utilization

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **TAT Compliance** (`um-tat`) | Buckets, by-LOB/by-Service-Category compliance, urgency/pause detail, regulatory clock, notification compliance, concurrent-review aggregates. | Lookback, LOB, Auth Type (IP/OP/RX), Service Category | *TAT Buckets*, *TAT Compliance by Line of Business*, *TAT Compliance by Service Category*, *Urgency & Pause Detail*, *Regulatory TAT by Urgency*, *Notification Compliance*, *Inpatient Concurrent Review* (7 tables). | `CASE_POOL`, `liveTatStats()`, `liveConcurrentRows()` — staticNote: Notification Compliance late/on-time flags are a seeded pattern, not real notice-delivery timestamps |
| **Decision & Determination Insights** (`um-clinical`) | Headline decision mix, full auth status mix, approval rate by procedure, reason codes by outcome. | Lookback, LOB, Service Type, Reason-Codes outcome (Denied/Partial/Approved) | *Headline Decision Stats*, *Authorization Status Mix*, *Decisions by Procedure*, *Reason Codes — {outcome}* (4 tables). | `liveDecisionStats()`, `authStatusOf()` (§4), `liveDecisionRows()`, `liveDeterminationMix()` |
| **Risk & Escalation Worklist** (`um-risk`) | Headline risk tiles + full high-risk/high-acuity worklist. | Lookback, LOB | *Headline Risk Tiles*, *Authorizations Requiring Attention*, *High-Dollar Authorizations (>$50k)*, *High-Acuity Authorizations*, *Escalated Today* (5 tables). | `ctx.data.riskCases()` (**Static** seed list — staticNote), `CASE_POOL` cost filter (real), `ctx.data.history()` |
| **Concurrent Review Monitoring** (`um-concurrent`) | Full inpatient continued-stay review list. | Lookback, LOB, Status, Member/facility/reviewer search | *Concurrent Review Stats*, *Concurrent Review Detail* (Member, Facility, LOS, Total Certified Days, Certified Through, Days Remaining, Uncertified Days, Next Review Due, Requested/Approved, Status, Reviewer, Expected Discharge, Next Action). | `liveConcurrentRows()` |
| **Intake & Documentation Quality** (`um-intake`) | Full breakdown — headline rates, channel mix, routing, duplicates, TAT/assignment risk, missing info/fields, review timing, provider issues, auto-processing. | Lookback, LOB, Category (All/Medical/IP/OP/RX/Behavioral Health) | 10 tables: *Headline Rates*, *Intake Channel Mix*, *Routing Status*, *Duplicates*, *TAT & Assignment Risk*, *Missing Information*, *Top Missing Fields*, *Auth Type (Review Timing)*, *Provider Issues*, *Intake Auto-Processing*. | `CASE_POOL` + `intakeChannelOf()`, `routingStatusOf()`, `isDuplicateOf()`, `missingInfoCategoryOf()`, `liveMissingFields()`, `reviewTypeOf()`, `providerIssueOf()`, `intakeProcessingStatusOf()` (all **Live rollup\*** per the field guide) |
| **Internal Quality** (`um-internal-quality`) | Documentation completeness, guideline adherence, decision-rationale rates. | Lookback, LOB | *Internal Quality*: Metric, %. | `liveComplianceBars()` |

### Group: Provider & Network

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **Provider & Network Insights** (`um-provider`) | Full provider performance vs. peer average, outlier flags, VIP/Gold Card, needs-attention summary, OON resolution. | Lookback, LOB, Provider, Designation (Needs Attention/VIP/Gold Card) | *Provider Detail* (14 columns), *Needs-Attention Summary* (7 outlier flags), *Out-of-Network Resolution*, *Out-of-Network Reasons* (4 tables). | `liveProviderInsights()`, `oonResolutionOf()`/`oonReasonOf()` (§4) |

### Group: Audit & Compliance

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **IRR Agreement by Reviewer** (`um-irr`) | Every sampled reviewer's agreement rate and sample adequacy. | Lookback, LOB | Reviewer, Agreements, Sampled, Agreement %, Adequate Sample, Below {target}%. | `liveIrrByReviewer()` |
| **IRR Corrective Actions** (`um-irr-actions`) | Every corrective action from an IRR disagreement. | Lookback, LOB, Status (Open/Closed) | Reviewer, Auth, Discrepancy Reason, Corrective Action, Status, Action Date. | `liveIrrCorrectiveActions()` |
| **Regulatory TAT Compliance by Program** (`um-reg-tat`) | Every program's compliance vs. its own statutory window. | Lookback, LOB shown in the filter bar (no `noLobDays` flag) — **but `liveRegCompliance()` only accepts `ctx.days`; the LOB control has no effect on this report's output**, since "Program" (the row axis) already *is* the LOB breakdown. Worth adding `noLobDays: true` or otherwise hiding the LOB control here. | Program, Compliant, Total, Compliance %, Standard Window, Expedited Window, Citation. | `liveRegCompliance()` |
| **Audit Flags** (`um-audit-flags`) | Every open audit flag. | Lookback, LOB, Severity | ID, Type, Description, Date, Severity. | `ctx.data.auditFlags()` |
| **IRR Discrepancy Reasons** (`um-irr-discrepancy-reasons`) | Every IRR disagreement, grouped by root-cause reason. | Lookback, LOB | Reason, Count. | `liveIrrDiscrepancyReasons()` |

### Group: Diagnosis & Coding

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **Authorizations by Diagnosis** (`um-dx-authorizations`) | Volume/approval rate/avg cost per diagnosis code. | Lookback, LOB, Service Type | Diagnosis Code, Description, Volume, Approval Rate %, Avg Cost. | `dxOf()` (§4) |
| **Diagnoses by Authorization** (`um-dx-by-authorization`) | Case-level list, one row per auth+diagnosis. | Lookback, LOB, Diagnosis Code, Member search | Auth ID, Member, Diagnosis Code, Description, Procedure, Status, Decision. | `dxOf()` |
| **Top Admission Diagnoses** (`um-dx-top-admission`) | Diagnosis codes on inpatient auths, ranked by volume. | Lookback, LOB | Diagnosis Code, Description, Admissions. | `dxOf()` filtered to `authTypeOf(c)==='IP'` |

### Generic (cross-module, always visible)

| Report (`id`) | Description | Filters | Tables → Columns | Data source |
|---|---|---|---|---|
| **User Activity Report** (`generic-user-activity`) | Every reassignment/balance/escalation/PTO move this session (UM only for now). | None (`noLobDays`) | Time, Action, Detail, By. | `ctx.data.history()` |

---

## 6. Known Gaps / Explicit Non-Goals

- **CM_REPORTS and APPEALS_REPORTS are empty arrays.** The same granular-report pattern needs to be applied to those modules; UM was built first because its data layer (including the real IRR audit process) is the most complete. This is the single largest gap.
- **No location/facility dimension separate from provider.** A `um-auth-by-location`-style report was explicitly deferred — the data model has no site/servicing-location field distinct from the ordering/treating provider.
- **Draft, Withdrawn, and Expired authorization statuses are not modeled anywhere** — `AUTH_STATUSES` can only ever show Submitted/In-Review/Pended/Determined states (see §4).
- **`generatedBy` is a hardcoded constant** (`"Christina Lawson"`), not sourced from an authenticated session — flagged in FR-6.
- **Risk & Escalation Worklist's core list (`ctx.data.riskCases()`) is a fixed illustrative seed**, not a live risk calculation — clearly disclosed via `staticNote`, but a real implementation needs an actual risk-scoring engine behind it.
- **Notification Compliance timestamps (TAT Compliance report) are a seeded pattern**, not real notice-delivery events.

---

## 7. Extension Guide — Adding a New Report

1. Pick (or create) a `group` string — check `subGroupsFor()`'s first-appearance ordering if you want it to land in a specific sidebar position relative to existing groups.
2. Add a new object to the appropriate registry array (`UM_REPORTS`, etc.) in `report-registry.ts`, following the `ReportDef` shape in §2.1.
3. In `tables(ctx)`, call into an existing `live*` function from `dashboard-data.ts` if one already backs the same number on a dashboard tab — **do not recompute independently**. If no such function exists yet, filter `CASE_POOL` directly using the derived-field helpers already in `case-fields.ts` (`dxOf`, `authStatusOf`, `oonResolutionOf`, etc.) rather than inventing a new one-off calculation.
4. Only set `noLobDays: true` if the underlying data genuinely isn't LOB/date-scoped (e.g. staffing/schedule data). Otherwise every table should respect `ctx.lob`/`ctx.days` via `inScope()`.
5. If a genuinely new derived field is needed (like diagnosis, auth status, or OON resolution were), follow the existing pattern: deterministic, `authId`-digit-keyed, documented with a comment naming its classification (Live / Live rollup\* / Static) so it can be added to the dashboard field guide later.
6. If the new field should also be visible on a live dashboard tab, **fold it into an existing tab** rather than creating a new one, unless explicitly told otherwise.
7. Run `npx tsc --noEmit -p tsconfig.app.json` and `npx ng build --configuration production`, then verify live in the browser: generate the report, confirm the numbers reconcile with the dashboard tab it's sourced from, and confirm Print/Export both include every table.
