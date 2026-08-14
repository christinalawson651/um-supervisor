# Search & View Referrals Assigned to a Care Manager (CM Supervisor)

**Status**: Implemented (`command-center`, commit `13a7d61`)
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
private readonly REFERRAL_COLUMNS = ['Referral ID', 'Member', 'Care Manager', 'Source', 'Status', 'Received', 'LOB'];
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

## FR-3 — Bulk Reassign referrals (Pending only)

**Where**: `src/app/shared/case-explorer.ts`.

`Explorer` recognizes a referral list by its first column and branches accordingly:

```ts
readonly isReferralList = computed(() => this.ix.explorer()?.columns[0] === 'Referral ID');
```

```ts
reassignSelected(e) {
  const ids = [...this.selected()];
  if (!ids.length) return;
  if (this.isCmList()) { this.reassignSelectedCm(ids); return; }
  if (this.isReferralList()) { this.reassignSelectedReferral(ids); return; }
  ...
}
```

**AC-3.1**: Only referrals with `status === 'Pending'` can be selected — their row checkbox is
enabled; every other row's checkbox is disabled:

```ts
isRowReassignable(row: (string | number)[]): boolean {
  if (!this.isReferralList()) return true;
  const statusIdx = this.ix.explorer()?.columns.indexOf('Status') ?? -1;
  return statusIdx >= 0 && row[statusIdx] === 'Pending';
}
```

**AC-3.2**: "Select all" (the header checkbox) only selects reassignable (Pending) rows, not every
filtered row.

**AC-3.3**: Confirming reassignment calls the existing `CmData.reassignReferral(id, target)` for
each selected referral, which sets `careManager` to the target and flips `status` to `'Accepted'`
(assigning **is** the triage decision — this method already existed and is unchanged).

**AC-3.4**: The reassign panel is opened with a synthetic single "Pending Intake" queue target so
its Queue-mode toggle doesn't fall back to UM's live authorization queue counts:

```ts
private reassignSelectedReferral(ids: string[]) {
  const all = this.cmData.referrals();
  const pendingIds = ids.filter((id) => all.find((r) => r.id === id)?.status === 'Pending');
  if (!pendingIds.length) { this.ix.toast('Only Pending referrals can be reassigned.', 'info'); return; }
  ...
  this.rx.open({
    title: `Reassign ${pendingIds.length} referral${pendingIds.length > 1 ? 's' : ''}`,
    cases, nurses, preselectAll: true, queueTargets: [{ name: 'Pending Intake', count: pendingIds.length }],
    apply: (assignedIds, target, mode) => {
      if (mode === 'queue') { this.ix.toast('Pending referrals only have one intake queue right now.', 'info'); return; }
      assignedIds.forEach((id) => this.cmData.reassignReferral(id, target));
      ...
    },
  });
}
```

**AC-3.5**: A successful reassignment records a history entry via `DashboardData.addHistory('swap', 'Referrals assigned', ...)`, visible in the existing Assignment History drawer.

**AC-3.6**: **Escalate selected** and **Balance** are hidden entirely for referral lists
(`@if (!isCmList() && !isReferralList())` / `@if (!isReferralList())` in the Explorer template) —
neither has a real referral-specific target or flow defined today.

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

## Data model (unchanged by this feature, referenced for context)

`ReferralIntakeRec` (`src/app/data/cm-intake.ts`):
```ts
export interface ReferralIntakeRec {
  id: string; member: string; source: ReferralSource; status: ReferralStatus;
  careManager: string | null; received: string; lob: string;
}
```
`careManager` is the field this whole feature filters/displays/mutates. `status` values:
`'Pending' | 'Accepted' | 'CM Declined' | 'Member Declined'` — only `'Pending'` is ever mutable.

---

## Known gap (not fixed this round)

`buildReferralIntake()` in `cm-intake.ts` sets `careManager: null` on **every** generated referral
at startup, regardless of `status` — including ones already marked `'Accepted'`. Realistically, an
Accepted referral has already been triaged to a specific Care Manager and shouldn't start
unassigned.

**Effect**: on a fresh session, every specific-Care-Manager filter shows 0 referrals, and
"Unassigned" shows all of them, until a Supervisor manually reassigns some via Reassign Pending or
the new bulk Reassign. This is a mock-data generation gap, not a defect in the filter/list/reassign
logic itself (verified: reassigning a referral correctly moves it into that Care Manager's filtered
count).

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
