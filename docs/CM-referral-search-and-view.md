# Search & View Referrals Assigned to a Care Manager (CM Supervisor)

**Status**: Implemented (`command-center`, commits `13a7d61`, `0841633`, `fa5cd1c`, `ca6e4d4`, `ea06cc2`, `8003ce8`, `922cd61`)
**Module**: CM (Care Management) — Referral Intake
**Role**: CM Supervisor
**Location in app**: CM Supervisor Dashboard → **Intake & Assessment SLA** tab → **REFERRALS** subsection

> This document describes what was built, as it exists in the codebase today. It is not a
> pre-implementation requirements doc — see "Origin & deferred scope" at the end for how this
> feature was originally scoped, and what was deliberately left out.

---

## Summary

A Supervisor can filter the CM referral funnel by the Care Manager it's currently assigned to
(including an explicit "Unassigned" state), and view/search/sort/export/reassign the results —
reusing the same shared list overlay (`CaseExplorer`) already used for case and authorization
drill-downs elsewhere in the app, rather than the static read-only drawer referrals used before.

---

## FR-1 — Filter referrals by assigned Care Manager

**Where**: `src/app/modules/cm-dashboard.ts`, REFERRALS subsection template (search `<h3 class="sec-title">Referrals</h3>`).

A `<select>` control lists:
- `All Care Managers` (value `'all'`)
- `Unassigned` (value `'unassigned'`)
- Every name in `CARE_MANAGERS` (imported from `../data/cm-case-pool`)

Bound to a new signal:
```ts
readonly referralCmFilter = signal('all');
readonly careManagerNames = CARE_MANAGERS.map((cm) => cm.name);
```

**AC-1.1**: Selecting a specific Care Manager narrows every referral view to only referrals whose
`careManager` field equals that name — this covers By Source, By Status, View Referrals, the New
Referrals KPI, all five FR-5 breakdown panels, and the FR-6 "New Referrals" view, since every one of
them is built on the same `scopedReferrals()` computed below (not individually wired).

**AC-1.2**: Selecting "Unassigned" narrows to referrals where `careManager === null`.

**AC-1.3**: The Care Manager filter combines with the existing LOB and Lookback top-bar filters as
a strict intersection (AND) — implemented as one additional clause inside the existing
`scopedReferrals()` computed:

```ts
readonly scopedReferrals = computed(() => {
  const lob = this.lobFilter.value();
  const cmFilter = this.referralCmFilter();
  return this.cmData.referrals().filter((r) =>
    (lob === 'all' || r.lob === lob) &&
    this.lookback.includes(r.received) &&
    (cmFilter === 'all' || (cmFilter === 'unassigned' ? r.careManager === null : r.careManager === cmFilter)));
});
```

**AC-1.4**: Every panel/button that reads `scopedReferrals()` automatically reflects the Care
Manager filter with no additional wiring, since they all read the same computed. `exportReferralsBySource`/`exportReferralsByStatus` still exist unchanged; `reassignReferrals`/`balanceReferrals`,
which this AC originally cited, were later deleted entirely in FR-3's second revision (the
"no bulk accept" rule) — see FR-3, Action 2.

---

## FR-2 — View filtered referrals in a full searchable/sortable list

**Where**: `openReferralsExplorer()` in `cm-dashboard.ts`, rendering through
`src/app/shared/case-explorer.ts`.

A "View Referrals (N)" button opens the currently-scoped referral list (LOB + Lookback + Care
Manager filter applied) in the shared Explorer overlay:

```ts
openAllReferrals() {
  const cmLabel = this.referralCmFilter() === 'all' ? '' : this.referralCmFilter() === 'unassigned' ? ' — Unassigned' : ` — ${this.referralCmFilter()}`;
  this.openReferralsExplorer(`Referrals${cmLabel}`, this.scopedReferrals(), 'all');
}
```

The three existing referral drill-downs were converted from `ix.openDrawer()` (static, read-only)
to the same Explorer path:
- `openReferralSource(source)` — clicking a By Source bar
- `openReferralStatus(status)` — clicking a By Status tile
- `onKpi('newReferrals')` — clicking the KPI strip's "New Referrals" tile

All four share one helper. `REFERRAL_COLUMNS` shown below is this doc's original (`commit 13a7d61`)
set — it was extended twice more since (FR-3 added Assigned To/Pend Reason, FR-5 added Referral
Reason); **see "Final column reference" after the Data model section for the authoritative current
set.**
```ts
private openReferralsExplorer(title: string, refs: ReferralIntakeRec[], exportSlug: string, context?: string) {
  this.ix.openExplorer({
    title, context: context ?? `${refs.length} referral(s) in the last ${this.lookbackLabel()}`,
    columns: this.REFERRAL_COLUMNS, rows: refs.map((r) => this.referralToRow(r)),
    exportName: `cm-referrals-${exportSlug}_2026-07-17`, memberColumn: 1,
  });
}
```

**AC-2.1**: The results table shows every column in the current `REFERRAL_COLUMNS` (see "Final
column reference"), including Care Manager (`Unassigned` when null).

**AC-2.2**: Clicking a column header sorts ascending; clicking again reverses to descending
(existing `Explorer.sortBy()` — no referral-specific change needed).

**AC-2.3**: The free-text search box (existing `Explorer.filtered()`) matches across all columns,
including the Care Manager column — so typing a name (or "Unassigned") narrows results without
needing the dropdown filter.

**AC-2.4**: "Customize" shows/hides columns (existing `Explorer.hiddenCols`/`toggleCol()` — no
referral-specific change needed).

**AC-2.5**: "Export all (N)" downloads a CSV of exactly the filtered/searched rows and visible
columns (existing `Explorer.exportAll()` — no referral-specific change needed).

**AC-2.6**: The search placeholder, row-count label, and empty-state message read "referral(s)",
not "authorization(s)" — see FR-4.

---

## FR-3 — Two distinct referral assignment actions: Intake Coordinator handoff vs Accept

**Revision note**: FR-3 originally shipped as a single "Reassign" action that conflated two
real-world steps into one (see `commit 13a7d61`). That was revised in `commit 0841633` after a
design discussion surfaced the actual workflow: an **Intake Coordinator** (non-clinical) works a
Pending referral for completeness, then hands it to a **Care Manager** (clinical) who makes the
accept/decline call — and accepting is what creates the case, which then lives on the CM dashboard
outside the referral funnel entirely. The two steps needed to be separate actions, not one.

**Where**: `src/app/shared/case-explorer.ts`, `src/app/shared/cm-data.ts`, `src/app/data/cm-intake.ts`, `src/app/modules/cm-dashboard.ts`.

### Data model addition (further extended in commit `fa5cd1c`)

```ts
// cm-intake.ts
export type ReferralPendReason = 'Pending Intake' | 'Missing Information' | 'Missing Eligibility';
export const INTAKE_COORDINATORS: string[] = ['Priya Shah', 'Connor Blake', 'Natalie Osei', 'Tobias Reed', 'Wendy Park'];

export interface ReferralIntakeRec {
  id: string; member: string; source: ReferralSource; status: ReferralStatus;
  pendReason: ReferralPendReason | null;  // only meaningful while status === 'Pending'
  intakeCoordinator: string | null;  // who's working this referral for completeness — independent of the clinical decision
  careManager: string | null;        // set only once accepted (the clinical decision)
  received: string; lob: string;
}
```

A referral never carries a case-lifecycle label like `Assessment Scheduled` — that only exists once
Accepted, on the case itself (`CmCaseRec.stage`). While still `Pending`, `pendReason` records the
operational reason it hasn't moved: mostly `Pending Intake` (just arrived, nothing wrong), a
minority `Missing Information` or `Missing Eligibility`. `INTAKE_COORDINATORS` is a separate,
non-clinical roster from `CARE_MANAGERS` (`cm-case-pool.ts`), kept local to `cm-intake.ts` to avoid
the import cycle that file's own header comment already guards against.

### Action 1 — Assign Referral (completeness handoff, no clinical decision made)

```ts
// cm-data.ts
assignIntakeCoordinator(id: string, coordinator: string) {
  this.referrals.update((list) => list.map((r) => (r.id === id ? { ...r, intakeCoordinator: coordinator } : r)));
}
intakeCoordinatorStats(): { name: string; active: number; utilization: number }[] {
  return INTAKE_COORDINATORS.map((name) => {
    const active = this.referrals().filter((r) => r.intakeCoordinator === name && r.status === 'Pending').length;
    return { name, active, utilization: Math.min(100, Math.round((active / 15) * 100)) };  // capacity = 15, nominal intake volume
  });
}
/** Who can be assigned to work a still-Pending referral — Intake Coordinators primarily, but some
 *  clients have a Care Manager do their own intake, so CMs are offered too. Coordinators come
 *  first in the list since they're the common case. */
referralAssigneeStats(): { name: string; active: number; utilization: number }[] {
  return [...this.intakeCoordinatorStats(), ...this.managerStats().map((m) => ({ name: m.name, active: m.active, utilization: m.utilization }))];
}
```

**Revision note** (`commit fa5cd1c`): the target roster for this action originally only offered
Intake Coordinators. A design discussion established that some clients have a Care Manager do their
own intake, so the picker now offers both — Intake Coordinators listed first (the common case), Care
Managers after. The action/button was renamed from "Assign to Intake Coordinator" to **"Assign
Referral"** to reflect the broader target list; the field storing the assignment is still named
`intakeCoordinator` on the record (pragmatic — avoids a wider rename churn — but its value may now
be either an Intake Coordinator or a Care Manager's name).

**AC-3.1**: Assigning sets only `intakeCoordinator` — `status` and `careManager` are untouched. A
referral can be reassigned between assignees any number of times while still `Pending`.

**AC-3.2**: Available via two entry points, both restricted to `status === 'Pending'` referrals:
- Dashboard toolbar button **"Assign Referral"** (`CmDashboard.assignToIntakeCoordinator()`) — operates on all currently-Pending referrals.
- Explorer bulk button **"Assign referral"**, shown only when `isReferralList()` (`CaseExplorer.assignSelectedToIntakeCoordinator()`) — operates on the user's current selection.

**AC-3.3**: The assign panel's "Recommended" pick is the least-loaded assignee across the combined
roster (by count of `Pending` referrals currently on their plate), via `referralAssigneeStats()` —
same least-utilized-first convention already used for Care Manager/nurse assignment elsewhere.

**AC-3.4**: A successful assignment records a history entry: `DashboardData.addHistory('swap', 'Referrals assigned', ...)`.

### Action 2 — Accept & Assign to Care Manager (the clinical decision, creates the case)

**Second revision note** (`commit ca6e4d4`): the original FR-3 (and its first revision) modeled
Accept as a bulk action — select N referrals, pick one CM, confirm all at once. A further design
discussion established that this was wrong: a Supervisor or CM must **review a referral (and, if
needed, the member's chart) before accepting it** — you cannot blind-bulk-accept a batch. Per the
explicit decision **"no bulk accept"**, this was removed and replaced with a one-at-a-time flow
reached only from a per-referral review step.

**What was removed** (all bulk/auto-accept paths, since they're the same category of problem
regardless of UI):
- Dashboard button **"Accept & Assign Pending"** and its method `CmDashboard.reassignReferrals()`.
- Dashboard button **"Balance Pending"** and its method `CmDashboard.balanceReferrals()` — this used
  a strategy picker (Light/Standard/All) to auto-accept N pending referrals via
  `CmData.reassignNextPendingReferral()`, called in a loop with zero review. Same violation as the
  bulk button, just a different door, so it had to go too.
- Explorer button **"Accept & assign selected"** and its method
  `CaseExplorer.reassignSelectedReferral()`.
- `CmData.reassignNextPendingReferral()` and the `REFERRAL_BALANCE_STRATEGIES` constant (dead code
  once `balanceReferrals()` was removed).

**What replaced it — review, then accept, one at a time:**

```ts
// case-explorer.ts — clicking a referral's own ID (not just its Member name) opens a review drawer
@if (vc.i === 0 && isReferralList()) {
  <td><a class="mlink" (click)="openReferralDetail(row, e)">{{ row[vc.i] }}</a></td>
}
```

```ts
openReferralDetail(row: (string | number)[], e: { columns: string[]; memberColumn?: number }) {
  const id = this.rowId(row);
  const rec = this.cmData.referrals().find((r) => r.id === id);
  if (!rec) return;
  const fields = e.columns.map((label, i) => ({ label, value: String(row[i]) })).filter((f) => f.label !== 'Referral ID');
  this.ix.openDrawer({
    title: rec.id, subtitle: `${rec.member} · ${rec.source}`,
    badge: { text: rec.status, tone: rec.status === 'Accepted' ? 'green' : rec.status === 'Pending' ? 'amber' : 'red' },
    fields,
    actions: [
      ...(rec.status === 'Pending' ? [{ label: 'Accept & Assign to Care Manager', tone: 'teal' as const, run: () => { this.ix.closeDrawer(); this.acceptOneReferral(rec); } }] : []),
      { label: 'View Member 360', tone: 'teal' as const, run: () => this.members.openByName(String(row[e.memberColumn ?? 1])) },
    ],
  });
}

private acceptOneReferral(rec: ReferralIntakeRec) {
  const nurses = this.cmData.managerStats().map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }));
  this.rx.open({
    title: `Accept & assign ${rec.id}`,
    cases: [{ authId: rec.id, member: rec.member, type: rec.source, queue: 'Pending Intake', priority: 'Routine', owner: rec.careManager ?? 'Unassigned' }],
    nurses, preselectAll: true, queueTargets: [{ name: 'Pending Intake', count: 1 }],
    apply: (_ids, target, mode) => {
      if (mode === 'queue') { this.ix.toast('Pending referrals only have one intake queue right now.', 'info'); return; }
      this.cmData.reassignReferral(rec.id, target);
      this.ix.toast(`${rec.id} accepted and assigned to ${target}.`);
      this.data.addHistory('swap', 'Referral accepted & assigned', `${rec.id} → ${target}`);
    },
  });
}
```

**AC-3.5**: The review drawer shows every field on the referral (Assigned To, Care Manager, Source,
Status, Pend Reason, Received, LOB) plus a "View Member 360" link. It has no way to affect multiple
referrals — one drawer, one referral, always.

**AC-3.6**: The "Accept & Assign to Care Manager" action is present in the drawer **only** when
`status === 'Pending'` — Accepted/Declined referrals show no accept action (nothing left to decide).

**AC-3.7**: Confirming Accept calls `CmData.reassignReferral(id, target)` for that single referral,
which sets `careManager` to the target Care Manager, flips `status` to `'Accepted'`, and clears
`pendReason` to `null` (no longer meaningful once decided) — this is the clinical decision, and it
is what creates the case (out of scope for the referral funnel from that point on).

**AC-3.8**: There is no bulk or multi-select path to Accept anywhere in the app — not via checkbox
selection, not via a strategy picker. The only way a referral becomes Accepted is via this
one-at-a-time review-then-accept flow.

**AC-3.9**: The single-referral Accept panel still offers a "Queue" mode toggle (inherited from the
shared Reassign panel) backed by a synthetic single "Pending Intake" target, so it doesn't fall back
to UM's live authorization queue counts; selecting Queue mode shows an explanatory toast rather than
silently doing the wrong thing.

**AC-3.10**: A successful Accept records a history entry:
`DashboardData.addHistory('swap', 'Referral accepted & assigned', ...)`.

**AC-3.11**: **Escalate selected** and **Balance** remain hidden entirely for referral lists
(`@if (!isCmList() && !isReferralList())` / `@if (!isReferralList())` in the Explorer template) —
neither has a real referral-specific target or flow defined today.

**Action 1 (Assign to Intake Coordinator / Care Manager handoff) is unaffected** — bulk assignment
is still fine there, since handing off a referral for completeness work isn't the clinical decision.

### Referral list column addition

`REFERRAL_COLUMNS` (`cm-dashboard.ts`) and the Explorer table gained an **Assigned To** column
(renamed from "Intake Coordinator" once the target roster broadened) between Member and Care
Manager, plus a **Pend Reason** column. FR-5 later added **Referral Reason** too — see "Final
column reference" after the Data model section for the complete, current set.

---

## FR-4 — Generalize Explorer's item terminology

**Where**: `src/app/shared/case-explorer.ts`.

Explorer previously hardcoded the word "authorization" in three places (search placeholder, row
count, empty-state message), which was already slightly wrong for CM case lists and would have been
worse for referrals. Replaced with a computed noun:

```ts
readonly itemNoun = computed(() => this.isReferralList() ? 'referral' : this.isCmList() ? 'member' : 'authorization');
```

**AC-4.1**: Search placeholder reads "Search all {noun}s…".
**AC-4.2**: Row count reads "{N} {noun}(s)".
**AC-4.3**: Empty state reads "No {noun}s match "{query}"."

---

## Data model

`ReferralIntakeRec` (`src/app/data/cm-intake.ts`) — complete current shape, every field's origin
noted:
```ts
export interface ReferralIntakeRec {
  id: string;
  member: string;
  source: ReferralSource;              // intake channel — Fax | Provider Portal | Call | UM Referral
  status: ReferralStatus;              // Pending | Accepted | CM Declined | Member Declined
  reason: ReferralReason;               // FR-5 — why the member was referred; set at intake, never changes
  caseType: CaseType;                   // FR-6 — reuses the case-side CaseType enum; set at intake, never changes
  pendReason: ReferralPendReason | null; // FR-3 — only meaningful while status === 'Pending'
  intakeCoordinator: string | null;      // FR-3 — who's working it pre-decision (IC name, CM name, or null = "Unclaimed")
  careManager: string | null;            // set only once Accepted (the clinical decision)
  received: string;
  lob: string;
}
```

**Mutability**: `pendReason`, `intakeCoordinator`, and `careManager` are the only fields that ever
change after generation, and only while `status === 'Pending'` (`careManager`/`status` change
together, exactly once, at Accept). `reason` and `caseType` are set at intake and never change —
they describe the referral itself, not its processing state. `pendReason` is cleared to `null` the
moment a referral is Accepted (`CmData.reassignReferral`).

### Final column reference

Two distinct Explorer column sets exist for referrals — don't confuse them:

```ts
// General list — all statuses, every referral drill-down except the dedicated view below
// (View Referrals, By Source, By Status, KPI "New Referrals", and all five FR-5 panels)
private readonly REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Assigned To', 'Care Manager', 'Source', 'Referral Reason', 'Status', 'Pend Reason', 'Received', 'LOB'];

// Dedicated "New Referrals" view (FR-6) — Pending only, no Care Manager column
private readonly NEW_REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Referral Reason', 'Case Type', 'Status', 'Assigned To', 'Received', 'TAT'];
```

---

## FR-5 — Five referral breakdown panels (commit `ea06cc2`)

**Where**: `src/app/data/cm-intake.ts`, `src/app/shared/cm-data.ts`, `src/app/modules/cm-dashboard.ts`.

Prompted by "we should address all areas in which we show referrals" — the funnel previously only
had two breakdown panels (By Source, By Status). Five more were added, each following the same
established pattern (computed → panel → click-through to Explorer → export → Customize toggle):

| Panel | Data | Notes |
|---|---|---|
| **Intake Coordinator Workload** | `CmData.intakeCoordinatorWorkload(source?, scope?)` | Pending referrals per coordinator + "Unclaimed", filterable by modality (`ReferralSource`). Explicitly **not** a Care Manager assignment. |
| **Accepted by Care Manager** | `CmData.acceptedByCareManager(scope?)` | Which CM each Accepted referral landed with. |
| **By Status** (existing, unchanged) | `referralsByStatus` | Already split `CM Declined`/`Member Declined` — kept as-is, not collapsed. |
| **Pending — Blocked By** | `CmData.pendReasonBreakdown(scope?)` | `Pending Intake` / `Missing Information` / `Missing Eligibility` counts; the latter two are visually flagged (amber/red via `.warn-tile`/`.bad-tile`). |
| **Referral TAT** | `CmData.referralTatBreakdown(scope?)` | `onTrack`/`dueSoon`/`overdue` bands on Pending referrals via `referralTatBandOf()` (`cm-intake.ts`) — a 3-day window, matching the generator's own definition of "Pending" (`daysAgo <= 3`). Same day-based banding shape as `slaBandOf`/`queueBandOf` elsewhere in this file, just for referrals. |
| **By Referral Reason** | `CmData.referralReasonBreakdown(scope?)` | New `reason: ReferralReason` field on `ReferralIntakeRec` — why the member was referred (`Post-Discharge Follow-Up`, `Disease Management`, etc.), independent of `source` (intake channel) and `pendReason` (operational blocker). |

**Rebalancing (Intake Coordinator Workload panel only)**: a **"Balance"** button opens a
strategy-picker (`IC_BALANCE_STRATEGIES` — Light/Standard/Aggressive, worded for referrals, kept
separate from `CM_BALANCE_STRATEGIES`'s Care-Manager wording), backed by
`CmData.simulateIntakeBalance(n)` (preview) and `CmData.reassignBusiestReferral()` (single real
move, called N times) — same "busiest → least-loaded" shape as the Care Manager caseload's
`simulateBalance`/`reassignBusiestCase`. This only ever moves `intakeCoordinator`, never `status` or
`careManager` — it cannot become an Accept action, so it doesn't need the review gate FR-3 requires
for accepting.

**AC-5.1**: All five panels respect the same LOB/Lookback/Care-Manager-filter scoping as every
other referral view on this tab (each takes `this.scopedReferrals()` or an equivalently-scoped list
as input).

**AC-5.2**: Every panel's counts sum to the same total as the existing `By Status`
tile for that status bucket (verified live: Intake Coordinator Workload sums to the Pending count;
Pending — Blocked By sums to the Pending count; Referral TAT sums to the Pending count; By Referral
Reason sums to the full referral count).

**AC-5.3**: Clicking any tile/bar opens the Explorer, scoped to exactly that slice — verified live
for Intake Coordinator Workload (clicking "Priya Shah" showed exactly her 3 Pending referrals).

**AC-5.4**: The Explorer's referral column set gained a **Referral Reason** column (between Source
and Status) so it's searchable/sortable/exportable there too, not just in the new breakdown panel.

---

## FR-6 — Case-lifecycle stage rename + dedicated "New Referrals" view (commits `8003ce8`, `922cd61`)

**Naming fix**: the case-lifecycle stage `'New Referral'` (`CM_STAGES`, `cm-case-pool.ts`) was
renamed to **`'Newly Accepted'`**. That stage card lives in Lifecycle Stages and queries the
already-accepted case pool (`CmCaseRec.stage`), not the referral funnel — but its old name made it
read as if it were incoming/undecided referrals. Chose "Accepted" over "Assigned" deliberately:
"Assigned" already means something specific and different in the referral funnel (the Intake
Coordinator/nurse holding a Pending referral), so reusing it for the CM-assignment event would
reintroduce the same ambiguity one level up. Renamed in all 4 places it appeared: `CM_STAGES`, the
roster's next-task lookup (`cm-roster.ts`), and two KPI-drill filters (`cm-dashboard.ts`).
`CM_QUEUES`' `'New Referral Queue'` is a distinct, correct concept (an operational work queue for
active cases) and was left untouched.

**New dedicated "New Referrals" view**: the general "View Referrals" list (FR-1/FR-2) necessarily
mixes Pending, Accepted, and Declined referrals, so it keeps a Care Manager column (meaningful for
Accepted rows) and the full field set. A genuinely *incoming-only* view needed different columns —
built as a separate entry point rather than replacing the general list:

```ts
// cm-intake.ts — new field, set at intake like `reason`
caseType: CaseType;  // reuses the existing CaseType enum, decorrelated from `source` the same way `lob` is

// new literal countdown alongside the existing banded referralTatBandOf()
export function referralTatCountdown(r: ReferralIntakeRec): string {
  const days = Math.round((TODAY.getTime() - new Date(`${r.received}T00:00:00`).getTime()) / 86400000);
  const left = 3 - days;
  if (left < 0) return `Overdue by ${-left}d`;
  if (left === 0) return 'Due today';
  if (left === 1) return '1 day left';
  return `${left} days left`;
}
```

```ts
// cm-dashboard.ts
private readonly NEW_REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Referral Reason', 'Case Type', 'Status', 'Assigned To', 'Received', 'TAT'];
openNewReferrals() {
  const refs = this.scopedReferrals().filter((r) => r.status === 'Pending');
  this.ix.openExplorer({ title: 'New Referrals', context: `${refs.length} referral(s) awaiting a decision`,
    columns: this.NEW_REFERRAL_COLUMNS, rows: refs.map((r) => this.newReferralToRow(r)),
    exportName: 'cm-new-referrals_2026-07-17', memberColumn: 1 });
}
```

**AC-6.1**: The view is scoped to `status === 'Pending'` only (plus the existing LOB/Lookback/CM
filters) — no Care Manager column, since nothing is set there pre-decision.

**AC-6.2**: "Assigned To" shows the Intake Coordinator/nurse name or `'Unclaimed'` — there is no
separate real queue concept for referrals in this app today; `'Unclaimed'` stands in for "sitting
unclaimed," per an explicit design call rather than a silent assumption.

**AC-6.3**: Reached via a new **"New Referrals (N)"** toolbar button, count-matched to the button
label (verified live: button read "New Referrals (8)", opened list showed exactly 8 rows, all
`Pending`).

**AC-6.4**: The KPI strip's existing **"New Referrals"** tile was deliberately **not** rerouted to
this view — that tile's displayed count (`scopedReferrals().length`) includes every status within
the Lookback window, not just Pending, so pointing its drill-through at a Pending-only list would
make the tile's number and the opened list disagree. The tile still opens the general "View
Referrals" list.

**AC-6.5**: The review-then-accept drawer (FR-3) works unchanged from this view — it looks up the
full record by ID rather than reading from the displayed columns, so "Accept & Assign to Care
Manager" still appears correctly for every Pending row here despite the narrower column set.

---

## Known gap (not fixed this round)

`buildReferralIntake()` in `cm-intake.ts` sets `careManager: null` on **every** generated referral
at startup, regardless of `status` — including ones already marked `'Accepted'`. Realistically, an
Accepted referral has already been triaged to a specific Care Manager and shouldn't start
unassigned.

**Effect**: on a fresh session, every specific-Care-Manager filter shows 0 referrals, and
"Unassigned" shows all of them, until a Supervisor accepts some one at a time via the review drawer
(see FR-3, Action 2). This is a mock-data generation gap, not a defect in the filter/list/accept
logic itself (verified: accepting a referral correctly moves it into that Care Manager's filtered
count). Note this gap is specific to `careManager` — the `intakeCoordinator` field does **not** have
this problem; it's seeded realistically at generation time (every referral older than 1 day already
has one, per FR-3's revision).

**Suggested fix** (not implemented): assign a deterministic `careManager` from a Care Manager
roster to referrals generated with `status === 'Accepted'`, so the funnel arrives demo-ready. This
would need `CARE_MANAGERS`-equivalent data available in `cm-intake.ts` without creating an import
cycle with `cm-case-pool.ts` (which currently imports *from* `cm-intake.ts`) — likely by relocating
`CARE_MANAGERS` to the shared `case-fields.ts` module both files already import from.

---

## Origin & deferred scope

This feature was originally scoped through a multi-round Gherkin/user-story exercise earlier in
this project's history (personas: Supervisor as primary actor, Care Manager as the filter target).
That exercise also surfaced a substantially larger, related capability that was **explicitly
deferred and is not part of this implementation**:

- **LOB-scoped visibility permissions**: an Admin-configured system where a Care Manager's default
  visibility is bounded to their granted Line(s) of Business (broadest grant = one LOB; additional
  LOBs added explicitly), with Supervisors exempt from all such restrictions, and audit logging of
  both permission changes and cross-assignment access (HIPAA minimum-necessary / audit-control
  considerations).
- **An Admin Portal** to configure those grants (grant CRUD, bulk onboarding, an audit-log viewer).

Neither exists in this codebase today — there is no login, no per-user identity, and no permission
enforcement anywhere in the app (only a cosmetic "Switch role" menu that changes nav visibility, not
data scoping). Both are real backend/auth-dependent capabilities and should be spec'd and built
separately once that infrastructure exists.

**Also explicitly deferred**: the AI Agent path, where a single automated step evaluates payer and
clinical program eligibility, then auto-creates the case and auto-assigns it to a CM/queue —
collapsing the Intake Coordinator completeness step and the Care Manager's clinical decision into
one. Only the non-agentic (human-driven) flow is built (FR-3), and per the later "no bulk accept"
decision, even that flow requires individual review before any Accept — an AI path, if built, would
need its own explicit design conversation about whether/how it bypasses that review, rather than
silently reintroducing bulk auto-accept through an AI door. Per the PM decision that prompted FR-3's
first revision: "we can address the AI when we have it" — this app has no AI evaluation capability
today, so building toward it now would be speculative.
