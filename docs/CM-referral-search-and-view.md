# Search & View Referrals Assigned to a Care Manager (CM Supervisor)

**Status**: Implemented (`command-center`, commits `13a7d61`, `0841633`)
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

**AC-1.1**: Selecting a specific Care Manager narrows every referral view (By Source, By Status,
View Referrals, New Referrals KPI) to only referrals whose `careManager` field equals that name.

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

**AC-1.4**: Every panel/button that reads `scopedReferrals()` (By Source bars, By Status tiles, the
"New Referrals" KPI tile, `exportReferralsBySource`/`exportReferralsByStatus`, `reassignReferrals`,
`balanceReferrals`) automatically reflects the Care Manager filter with no additional wiring, since
they all read the same computed.

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

All four share one helper:
```ts
private readonly REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Intake Coordinator', 'Care Manager', 'Source', 'Status', 'Received', 'LOB'];
private openReferralsExplorer(title: string, refs: ReferralIntakeRec[], exportSlug: string, context?: string) {
  this.ix.openExplorer({
    title, context: context ?? `${refs.length} referral(s) in the last ${this.lookbackLabel()}`,
    columns: this.REFERRAL_COLUMNS, rows: refs.map((r) => this.referralToRow(r)),
    exportName: `cm-referrals-${exportSlug}_2026-07-17`, memberColumn: 1,
  });
}
```

**AC-2.1**: The results table shows columns Referral ID, Member, Care Manager (`Unassigned` when
null), Source, Status, Received, LOB.

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

### Data model addition

```ts
// cm-intake.ts
export const INTAKE_COORDINATORS: string[] = ['Priya Shah', 'Connor Blake', 'Natalie Osei', 'Tobias Reed', 'Wendy Park'];

export interface ReferralIntakeRec {
  id: string; member: string; source: ReferralSource; status: ReferralStatus;
  intakeCoordinator: string | null;  // who's working this referral for completeness — independent of the clinical decision
  careManager: string | null;        // set only once accepted (the clinical decision)
  received: string; lob: string;
}
```

`INTAKE_COORDINATORS` is a separate, non-clinical roster from `CARE_MANAGERS` (`cm-case-pool.ts`),
kept local to `cm-intake.ts` to avoid the import cycle that file's own header comment already
guards against.

### Action 1 — Assign to Intake Coordinator (completeness handoff, no decision made)

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
```

**AC-3.1**: Assigning an Intake Coordinator to a referral sets only `intakeCoordinator` — `status`
and `careManager` are untouched. A referral can be reassigned between Intake Coordinators any
number of times while still `Pending`.

**AC-3.2**: Available via two entry points, both restricted to `status === 'Pending'` referrals:
- Dashboard toolbar button **"Assign to Intake Coordinator"** (`CmDashboard.assignToIntakeCoordinator()`) — operates on all currently-Pending referrals.
- Explorer bulk button **"Assign to Intake Coordinator"**, shown only when `isReferralList()` (`CaseExplorer.assignSelectedToIntakeCoordinator()`) — operates on the user's current selection.

**AC-3.3**: The assign panel's "Recommended" pick is the least-loaded Intake Coordinator (by count
of `Pending` referrals currently on their plate), via `intakeCoordinatorStats()` — same
least-utilized-first convention already used for Care Manager/nurse assignment elsewhere.

**AC-3.4**: A successful assignment records a history entry: `DashboardData.addHistory('swap', 'Referrals assigned to Intake Coordinator', ...)`.

### Action 2 — Accept & Assign to CM/Queue (the clinical decision, creates the case)

Unchanged in behavior from the original FR-3, only relabeled for clarity now that a second action
exists alongside it (dashboard button: "Reassign Pending" → **"Accept & Assign Pending"**; Explorer
button: "Reassign selected" → **"Accept & assign selected"** for referral lists specifically).

```ts
readonly isReferralList = computed(() => this.ix.explorer()?.columns[0] === 'Referral ID');

reassignSelected(e) {
  const ids = [...this.selected()];
  if (!ids.length) return;
  if (this.isCmList()) { this.reassignSelectedCm(ids); return; }
  if (this.isReferralList()) { this.reassignSelectedReferral(ids); return; }
  ...
}
```

**AC-3.5**: Only referrals with `status === 'Pending'` can be selected for **either** action — their
row checkbox is enabled; every other row's checkbox is disabled. This gating is shared by both
actions (same selection, same `isRowReassignable()` check):

```ts
isRowReassignable(row: (string | number)[]): boolean {
  if (!this.isReferralList()) return true;
  const statusIdx = this.ix.explorer()?.columns.indexOf('Status') ?? -1;
  return statusIdx >= 0 && row[statusIdx] === 'Pending';
}
```

**AC-3.6**: "Select all" (the header checkbox) only selects reassignable (Pending) rows, not every
filtered row.

**AC-3.7**: Confirming **Accept & Assign** calls the existing `CmData.reassignReferral(id, target)`
for each selected referral, which sets `careManager` to the target Care Manager and flips `status`
to `'Accepted'` — this is the clinical decision, and it is what creates the case (out of scope for
the referral funnel from that point on). This method is unchanged from the original FR-3.

**AC-3.8**: Both action panels are opened with a synthetic single "Pending Intake" queue target (or
an empty queue list for the Intake Coordinator panel, since coordinators aren't organized by
queue) so the Queue-mode toggle doesn't fall back to UM's live authorization queue counts; selecting
Queue mode on either panel shows a toast explaining it doesn't apply, rather than silently doing the
wrong thing.

**AC-3.9**: A successful Accept & Assign records a history entry:
`DashboardData.addHistory('swap', 'Referrals accepted & assigned', ...)`, distinct from the Intake
Coordinator handoff's history wording, so Assignment History reads unambiguously.

**AC-3.10**: **Escalate selected** and **Balance** are hidden entirely for referral lists
(`@if (!isCmList() && !isReferralList())` / `@if (!isReferralList())` in the Explorer template) —
neither has a real referral-specific target or flow defined today.

### Referral list column addition

`REFERRAL_COLUMNS` (`cm-dashboard.ts`) and the Explorer table now include an **Intake Coordinator**
column between Member and Care Manager, showing `Unclaimed` when null (parallel to `Unassigned` for
Care Manager):

```ts
private readonly REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Intake Coordinator', 'Care Manager', 'Source', 'Status', 'Received', 'LOB'];
```

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

`ReferralIntakeRec` (`src/app/data/cm-intake.ts`) — current shape, including the `intakeCoordinator`
field added in FR-3's revision:
```ts
export interface ReferralIntakeRec {
  id: string; member: string; source: ReferralSource; status: ReferralStatus;
  intakeCoordinator: string | null;
  careManager: string | null;
  received: string; lob: string;
}
```
`status` values: `'Pending' | 'Accepted' | 'CM Declined' | 'Member Declined'` — only `'Pending'` is
ever mutable (for either `intakeCoordinator` or `careManager`).

---

## Known gap (not fixed this round)

`buildReferralIntake()` in `cm-intake.ts` sets `careManager: null` on **every** generated referral
at startup, regardless of `status` — including ones already marked `'Accepted'`. Realistically, an
Accepted referral has already been triaged to a specific Care Manager and shouldn't start
unassigned.

**Effect**: on a fresh session, every specific-Care-Manager filter shows 0 referrals, and
"Unassigned" shows all of them, until a Supervisor manually accepts some via "Accept & Assign
Pending" or the Explorer's "Accept & assign selected". This is a mock-data generation gap, not a
defect in the filter/list/reassign logic itself (verified: accepting a referral correctly moves it
into that Care Manager's filtered count). Note this gap is specific to `careManager` — the newer
`intakeCoordinator` field does **not** have this problem; it's seeded realistically at generation
time (every referral older than 1 day already has one, per FR-3's revision).

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
one. Only the non-agentic (human-driven) two-step flow is built (FR-3). Per the PM decision that
prompted FR-3's revision: "we can address the AI when we have it" — this app has no AI evaluation
capability today, so building toward it now would be speculative. When it's ready, it most likely
plugs in as a third action alongside "Assign to Intake Coordinator" and "Accept & Assign Pending",
or as an automated variant of "Accept & Assign" gated by an AI on/off toggle (the pattern already
used for UM's AI recommendations elsewhere in this app).
