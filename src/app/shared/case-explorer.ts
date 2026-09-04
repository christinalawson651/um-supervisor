import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Interaction } from './interaction';
import { Members } from './members';
import { Reassign, ReassignCase } from './reassign';
import { Escalate, ESCALATE_TARGETS } from './escalate';
import { Balance } from './balance';
import { downloadCsv } from './export-csv';
import { DashboardData } from '../data/dashboard-data';
import { CASE_POOL, CaseRec, GUIDELINE_BY_PROCEDURE } from '../data/case-pool';
import { CM_CASE_POOL } from '../data/cm-case-pool';
import { ReferralIntakeRec } from '../data/cm-intake';
import { CmData } from './cm-data';
import { lobOf, serviceCategoryOf, tatStatus, urgencyOf } from '../data/case-fields';
import { nbaFor } from '../data/um-status';
import { pendReason } from './metrics';

const PAGE = 12;

type QuickSort = 'default' | 'urgency' | 'cost' | 'tat' | 'oldest';
const QUICK_SORTS: { id: QuickSort; label: string; col: (cols: string[]) => number }[] = [
  { id: 'urgency', label: 'Urgency (expedited first)', col: (c) => c.indexOf('Urgency') },
  { id: 'cost', label: 'Cost (highest first)', col: (c) => c.findIndex((h) => /cost/i.test(h)) },
  { id: 'tat', label: 'TAT (longest first)', col: (c) => c.findIndex((h) => /^TAT/i.test(h)) },
  { id: 'oldest', label: 'Oldest first', col: (c) => c.indexOf('Submitted') },
];

@Component({
  selector: 'app-case-explorer',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (ix.explorer(); as e) {
      <div class="scrim" (click)="ix.closeExplorer()">
        <div class="explorer" (click)="$event.stopPropagation()">
          <!-- header -->
          <div class="ehead">
            <div>
              <h3>{{ e.title }}</h3>
              <div class="ctx">{{ e.context }}</div>
            </div>
            <button class="ex" (click)="ix.closeExplorer()">×</button>
          </div>

          <!-- toolbar -->
          <div class="toolbar">
            <input class="search" type="text" [placeholder]="'Search all ' + itemNoun() + 's…'"
              [ngModel]="q()" (ngModelChange)="setQuery($event)" />
            <span class="count">{{ filtered().length }} {{ itemNoun() }}{{ filtered().length === 1 ? '' : 's' }}</span>

            @if (availableSorts().length) {
              <label class="sortsel">
                <span>Sort</span>
                <select [value]="quickSort()" (change)="setQuickSort($any($event.target).value)">
                  <option value="default">Default</option>
                  @for (s of availableSorts(); track s.id) { <option [value]="s.id">{{ s.label }}</option> }
                </select>
              </label>
            }

            <span class="spacer"></span>

            @if (isCaseList()) {
              @if (selected().size) { <span class="selcount">{{ selected().size }} selected</span> }
              @if (!isReferralList()) {
                <button class="btn outline sm" [disabled]="!selected().size" (click)="reassignSelected(e)">Reassign selected</button>
              }
              @if (isReferralList()) {
                <button class="btn outline sm" [disabled]="!selected().size" (click)="assignSelectedToIntakeCoordinator()">Assign referral</button>
              }
              @if (!isCmList() && !isReferralList()) {
                <button class="btn outline sm" [disabled]="!selected().size" (click)="escalateSelected(e)">Escalate selected</button>
              }
            }
            @if (isCaseList() && !isReferralList()) {
              <button class="btn outline sm" (click)="balance(e)">Balance{{ selected().size ? ' selected' : '' }}</button>
            }
            @if (isCaseList()) {
              <button class="btn outline sm" (click)="openAssignmentHistory()">Assignment History</button>
            }
            <button class="btn outline sm" (click)="exportAll(e)">Export all ({{ filtered().length }})</button>
            <span class="cz-wrap">
              <button class="btn outline sm" (click)="customizing.set(!customizing())">Customize</button>
              @if (customizing()) {
                <div class="cz-pop" (click)="$event.stopPropagation()">
                  <div class="cz-title">Show columns</div>
                  @for (c of e.columns; track c; let ci = $index) {
                    <label class="cz-row"><input type="checkbox" [checked]="!hiddenCols().has(ci)" (change)="toggleCol(ci)" /> {{ c }}</label>
                  }
                </div>
              }
            </span>
          </div>

          <!-- table -->
          <div class="etable-wrap" (click)="customizing.set(false)">
            <table class="etable">
              <thead>
                <tr>
                  @if (isCaseList()) {
                    <th class="selth"><input type="checkbox" [checked]="allSelected()" (change)="toggleAllFiltered($event)" /></th>
                  }
                  @for (vc of visibleCols(); track vc.i) {
                    <th (click)="sortBy(vc.i)">{{ vc.c }}{{ caret(vc.i) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of pageRows(); track $index) {
                  <tr>
                    @if (isCaseList()) {
                      <td class="selth"><input type="checkbox" [checked]="selected().has(rowId(row))" [disabled]="!isRowReassignable(row)" (change)="toggleSel(rowId(row))" /></td>
                    }
                    @for (vc of visibleCols(); track vc.i) {
                      @if (e.rowLink && vc.i === e.rowLink.column) {
                        <td><a class="mlink" (click)="e.rowLink!.run(row)">{{ row[vc.i] }}</a></td>
                      } @else if (vc.i === 0 && isReferralList()) {
                        <td><a class="mlink" (click)="openReferralDetail(row, e)">{{ row[vc.i] }}</a></td>
                      } @else if (vc.i === e.memberColumn) {
                        <td><a class="mlink" (click)="openAuth(row, e)">{{ row[vc.i] }}</a></td>
                      } @else if (vc.c === 'Procedure' && guidelineFor(row[vc.i])) {
                        <td class="has-tip">{{ row[vc.i] }}<span class="tip">Guideline: {{ guidelineFor(row[vc.i]) }}</span></td>
                      } @else {
                        <td>{{ row[vc.i] }}</td>
                      }
                    }
                  </tr>
                }
                @empty {
                  <tr><td [attr.colspan]="e.columns.length + 1" class="empty">No {{ itemNoun() }}s match "{{ q() }}".</td></tr>
                }
              </tbody>
            </table>
          </div>

          <!-- pagination -->
          <div class="pager">
            <span>Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ filtered().length }}</span>
            <span class="spacer"></span>
            <button class="btn outline sm" [disabled]="page() === 0" (click)="prev()">‹ Prev</button>
            <span class="pnum">Page {{ page() + 1 }} of {{ totalPages() }}</span>
            <button class="btn outline sm" [disabled]="page() >= totalPages() - 1" (click)="next()">Next ›</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(17,24,39,.5); z-index: 120;
      display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; }
    .explorer { background:#fff; border-radius: 14px; width: 100%; max-width: 1100px; height: 100%;
      max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,.28);
      overflow: hidden; }
    .ehead { display:flex; justify-content:space-between; align-items:flex-start;
      padding: 20px 24px 14px; border-bottom: 1px solid var(--border); }
    .ehead h3 { margin:0; font-size:18px; color:var(--ink); }
    .ctx { margin-top:6px; font-size:13px; font-weight:700; color: var(--teal-900);
      background: var(--teal-50); border:1px solid var(--teal-100); border-radius:8px;
      padding: 7px 12px; display:inline-block; }
    .ex { border:none; background:none; cursor:pointer; color:var(--gray-400); font-size:24px; line-height:1; }
    .toolbar { display:flex; align-items:center; gap:14px; padding: 14px 24px; flex-wrap:wrap; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:8px 12px; font-size:13px;
      width: 240px; outline:none; }
    .search:focus { border-color: var(--teal-600); }
    .count { font-size:12.5px; color:var(--gray-500); font-weight:600; white-space:nowrap; }
    .sortsel { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; color:var(--gray-500);
      text-transform:uppercase; letter-spacing:.03em; }
    .sortsel select { font-size:12.5px; font-weight:500; color:var(--ink); text-transform:none; letter-spacing:0;
      padding:6px 8px; border:1px solid var(--gray-300); border-radius:8px; background:#fff; cursor:pointer; }
    .selcount { font-size:12px; font-weight:700; color:var(--teal-700); white-space:nowrap; }
    .spacer { flex:1; }
    .cz-wrap { position: relative; }
    .cz-pop { position: absolute; top: calc(100% + 6px); left: 0; background: #fff; border: 1px solid var(--gray-200);
      border-radius: 10px; box-shadow: 0 12px 28px rgba(0,0,0,.14); padding: 10px 12px; z-index: 40; min-width: 180px;
      max-height: 260px; overflow: auto; }
    .cz-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      color: var(--gray-500); margin-bottom: 6px; }
    .cz-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-soft);
      padding: 4px 0; cursor: pointer; white-space: nowrap; }
    .etable-wrap { flex:1; overflow:auto; margin: 0 24px; border:1px solid var(--gray-100); border-radius:10px; }
    .etable { width:100%; border-collapse:collapse; font-size:13px; }
    .etable thead th { position: sticky; top: 0; background: var(--gray-50); cursor:pointer;
      text-align:left; padding:11px 14px; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase;
      color:var(--gray-500); font-weight:600; white-space:nowrap; border-bottom:1px solid var(--gray-200);
      user-select:none; }
    .etable thead th:hover { color: var(--ink-soft); }
    .etable thead th.selth, .etable tbody td.selth { cursor:default; width:1%; padding-right:4px; }
    .etable tbody td { padding:11px 14px; border-bottom:1px solid var(--gray-100); color:var(--ink-soft);
      white-space:nowrap; }
    .etable tbody tr:hover { background: var(--gray-50); }
    .mlink { color:#2563eb; font-weight:600; cursor:pointer; }
    .mlink:hover { text-decoration:underline; }
    .has-tip { position: relative; cursor: help; text-decoration: underline dotted var(--gray-400); text-underline-offset: 3px; }
    .has-tip .tip { visibility: hidden; opacity: 0; position: absolute; top: 100%; left: 0; margin-top: 6px;
      background: var(--ink); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      white-space: nowrap; z-index: 30; transition: opacity .1s; pointer-events: none; }
    .has-tip:hover .tip { visibility: visible; opacity: 1; }
    .empty { text-align:center; color:var(--gray-500); padding: 28px; }
    .pager { display:flex; align-items:center; gap:12px; padding: 14px 24px; font-size:12.5px;
      color: var(--gray-500); }
    .pnum { font-weight:600; color:var(--ink-soft); }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class CaseExplorer {
  ix = inject(Interaction);
  members = inject(Members);
  private data = inject(DashboardData);
  private cmData = inject(CmData);
  private rx = inject(Reassign);
  private esc = inject(Escalate);
  private bal = inject(Balance);

  readonly q = signal('');
  readonly page = signal(0);
  readonly sortCol = signal<number>(-1);
  readonly sortDir = signal<1 | -1>(1);
  readonly quickSort = signal<QuickSort>('default');
  readonly selected = signal<Set<string>>(new Set());
  readonly customizing = signal(false);
  readonly hiddenCols = signal<Set<number>>(new Set());

  constructor() {
    // reset view state whenever a new metric is opened
    effect(() => {
      this.ix.explorer();
      this.q.set('');
      this.page.set(0);
      this.sortCol.set(-1);
      this.sortDir.set(1);
      this.quickSort.set('default');
      this.selected.set(new Set());
      this.customizing.set(false);
      this.hiddenCols.set(new Set());
    });
  }

  /** Every drill in the app starts its columns with "Auth ID" (UM), "Member ID" (CM caseload),
   *  or "Referral ID" (CM referral funnel). */
  readonly isCaseList = computed(() => {
    const c = this.ix.explorer()?.columns[0];
    return c === 'Auth ID' || c === 'Member ID' || c === 'Referral ID';
  });
  readonly isCmList = computed(() => this.ix.explorer()?.columns[0] === 'Member ID');
  readonly isReferralList = computed(() => this.ix.explorer()?.columns[0] === 'Referral ID');
  /** Search placeholder / row-count noun — referrals and CM members aren't "authorizations", and
   *  informational (non-case) lists like Scheduling/Adherence/Demand drill-downs aren't either.
   *  Care management works in CASES — a member is the person, the case is the work item — so CM
   *  drill-downs say "case" rather than borrowing UM's "authorization" or naming the person. */
  readonly itemNoun = computed(() => this.isReferralList() ? 'referral' : this.isCmList() ? 'case' : this.isCaseList() ? 'authorization' : 'record');

  toggleCol(i: number) { this.hiddenCols.update((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; }); }
  readonly visibleCols = computed(() => (this.ix.explorer()?.columns ?? []).map((c, i) => ({ c, i })).filter(({ i }) => !this.hiddenCols().has(i)));

  readonly availableSorts = computed(() => {
    const e = this.ix.explorer();
    if (!e || !this.isCaseList()) return [];
    return QUICK_SORTS.filter((s) => s.col(e.columns) >= 0);
  });

  rowId(row: (string | number)[]) { return String(row[0]); }

  /** The clinical guideline behind a procedure — shown as a hover tooltip on the Procedure cell
   *  (every explorer using the standard columns has one, not just Clinical Decision Insights'). */
  guidelineFor(procedure: string | number): string { return GUIDELINE_BY_PROCEDURE[String(procedure)] ?? ''; }

  readonly filtered = computed(() => {
    const e = this.ix.explorer();
    if (!e) return [];
    const query = this.q().trim().toLowerCase();
    let rows = query
      ? e.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(query)))
      : e.rows;

    const qs = this.quickSort();
    if (qs !== 'default') {
      const spec = QUICK_SORTS.find((s) => s.id === qs)!;
      const ci = spec.col(e.columns);
      if (ci >= 0) {
        rows = [...rows].sort((a, b) => {
          if (qs === 'urgency') {
            const rank = (v: unknown) => (String(v) === 'Expedited' ? 0 : 1);
            return rank(a[ci]) - rank(b[ci]);
          }
          const an = parseFloat(String(a[ci]).replace(/[$,h]/gi, ''));
          const bn = parseFloat(String(b[ci]).replace(/[$,h]/gi, ''));
          if (qs === 'oldest') return String(a[ci]).localeCompare(String(b[ci]));
          return bn - an; // cost / tat: highest first
        });
      }
      return rows;
    }

    const col = this.sortCol();
    if (col >= 0) {
      const dir = this.sortDir();
      rows = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        const an = parseFloat(String(av).replace(/[$,h]/g, '')), bn = parseFloat(String(bv).replace(/[$,h]/g, ''));
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    }
    return rows;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  readonly pageRows = computed(() => this.filtered().slice(this.page() * PAGE, this.page() * PAGE + PAGE));
  rangeStart() { return this.filtered().length === 0 ? 0 : this.page() * PAGE + 1; }
  rangeEnd() { return Math.min(this.filtered().length, (this.page() + 1) * PAGE); }

  setQuery(v: string) { this.q.set(v); this.page.set(0); }
  prev() { this.page.update((p) => Math.max(0, p - 1)); }
  next() { this.page.update((p) => Math.min(this.totalPages() - 1, p + 1)); }
  sortBy(ci: number) {
    this.quickSort.set('default');
    if (this.sortCol() === ci) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortCol.set(ci); this.sortDir.set(1); }
    this.page.set(0);
  }
  setQuickSort(v: QuickSort) { this.quickSort.set(v); this.sortCol.set(-1); this.page.set(0); }
  caret(ci: number) { return this.sortCol() === ci ? (this.sortDir() === 1 ? ' ▲' : ' ▼') : ''; }

  // ---- bulk selection ----
  toggleSel(id: string) { this.selected.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  /** Referrals: only Pending rows are reassignable — Accepted/Declined are read-only history.
   *  Every other list type is always reassignable. */
  isRowReassignable(row: (string | number)[]): boolean {
    if (!this.isReferralList()) return true;
    const statusIdx = this.ix.explorer()?.columns.indexOf('Status') ?? -1;
    return statusIdx >= 0 && row[statusIdx] === 'Pending';
  }
  allSelected() { const f = this.filtered().filter((r) => this.isRowReassignable(r)); return f.length > 0 && f.every((r) => this.selected().has(this.rowId(r))); }
  toggleAllFiltered(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.selected.set(on ? new Set(this.filtered().filter((r) => this.isRowReassignable(r)).map((r) => this.rowId(r))) : new Set());
  }

  exportAll(e: { columns: string[]; exportName: string }) {
    downloadCsv(e.exportName, e.columns, this.filtered());
  }

  // ---- reassign / balance directly from any drill-down ----
  reassignSelected(e: { columns: string[]; rows: (string | number)[][]; memberColumn?: number }) {
    const ids = [...this.selected()];
    if (!ids.length) return;
    if (this.isCmList()) { this.reassignSelectedCm(ids); return; }
    const iMember = e.memberColumn ?? 1;
    const iService = e.columns.indexOf('Service Type');
    const iStatus = e.columns.indexOf('Status');
    const iUrgency = e.columns.indexOf('Urgency');
    const rowByAuth = new Map(e.rows.map((r) => [this.rowId(r), r]));

    const cases: ReassignCase[] = ids.map((id) => {
      const row = rowByAuth.get(id);
      const rec = CASE_POOL.find((c) => c.authId === id);
      return {
        authId: id,
        member: row ? String(row[iMember]) : (rec?.member ?? ''),
        type: row && iService >= 0 ? String(row[iService]) : (rec?.serviceType ?? 'Authorization'),
        queue: row && iStatus >= 0 ? String(row[iStatus]) : (rec?.status ?? 'Authorization'),
        priority: row && iUrgency >= 0 ? String(row[iUrgency]) : (rec ? urgencyOf(rec) : 'Standard'),
        owner: rec && rec.nurse !== '—' ? rec.nurse : 'Unassigned',
      };
    });
    const nurses = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization, active: n.active }));
    this.rx.open({
      title: `Reassign ${ids.length} authorization${ids.length > 1 ? 's' : ''}`, noun: 'authorization',
      cases, nurses, preselectAll: true,
      apply: (assignedIds, target, mode) => {
        if (mode === 'queue') {
          assignedIds.forEach((aid) => {
            const cs = cases.find((x) => x.authId === aid);
            if (cs) this.data.releaseToQueue(cs.queue, cs.owner, target);
          });
          this.ix.toast(`${assignedIds.length} authorization(s) moved to ${target}.`);
          this.data.addHistory('swap', 'Authorizations moved to queue', `${assignedIds.length} authorization(s) → ${target}`);
        } else {
          assignedIds.forEach((aid) => {
            const cs = cases.find((x) => x.authId === aid);
            this.data.claimToNurse(cs?.queue ?? null, cs?.owner ?? null, target);
          });
          this.ix.toast(`${assignedIds.length} authorization(s) reassigned to ${target}.`);
          this.data.addHistory('swap', 'Authorizations reassigned', `${assignedIds.length} authorization(s) → ${target}`);
        }
        this.selected.set(new Set());
      },
    });
  }

  private reassignSelectedCm(ids: string[]) {
    const cases: ReassignCase[] = ids.map((id) => {
      const rec = CM_CASE_POOL.find((c) => c.memberId === id);
      return {
        authId: id, member: rec?.member ?? id, type: rec?.program ?? 'Care Management',
        queue: rec?.queue ?? 'No Active Queue', priority: rec?.riskLevel ?? 'Moderate', owner: rec?.careManager ?? 'Unassigned',
      };
    });
    const nurses = this.cmData.managerStats().map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }));
    const queueTargets = this.cmData.queues().map((q) => ({ name: q.name, count: q.count }));
    this.rx.open({
      title: `Reassign ${ids.length} case${ids.length > 1 ? 's' : ''}`, noun: 'case',
      cases, nurses, queueTargets, preselectAll: true,
      apply: (assignedIds, target, mode) => {
        assignedIds.forEach((id) => mode === 'queue' ? this.cmData.reassignQueue(id, target) : this.cmData.reassignCase(id, target));
        this.ix.toast(`${assignedIds.length} case(s) ${mode === 'queue' ? 'moved to ' + target : 'reassigned to ' + target}.`);
        this.data.addHistory('swap', mode === 'queue' ? 'CM cases moved to queue' : 'CM cases reassigned', `${assignedIds.length} case(s) → ${target}`);
        this.selected.set(new Set());
      },
    });
  }

  /** "Balance" for a CM case-list drill-down — previously fell straight through to the UM-only
   *  branch below (CASE_POOL/this.bal/this.data.nurses(), none of which match a CM memberId), so
   *  it silently did nothing useful for any CM drill-down. With items selected, spreads exactly
   *  those across care managers by least-utilization-first (same shape as the UM "selected" path);
   *  with nothing selected, opens the same strategy-picker flow as CmDashboard.cmBalance(), just
   *  duplicated locally since Explorer is a shared component with no reference to that class. */
  private balanceCm(ids: string[]) {
    if (!ids.length) {
      this.ix.choose({
        title: 'Balance workload', body: 'Choose how aggressively to rebalance cases from over-utilized care managers to those with capacity.',
        label: 'Balancing strategy',
        options: ['Light — move 1 case from the busiest care manager', 'Standard — rebalance 3 cases', 'Aggressive — rebalance 6 cases', 'Even out — level everyone toward the team average'],
        confirmLabel: 'Continue', tone: 'teal',
        onChoose: (opt) => {
          const n = opt.startsWith('Light') ? 1 : opt.startsWith('Standard') ? 3 : opt.startsWith('Aggressive') ? 6 : 5;
          const plan = this.cmData.simulateBalance(n);
          if (!plan.length) { this.ix.toast('Caseloads are already balanced.', 'info'); return; }
          const byTarget = new Map<string, number>();
          plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
          const breakdown = [...byTarget.entries()].map(([target, count]) => ({ count, label: count === 1 ? 'case' : 'cases', target }));
          this.ix.ask({
            title: `Balance ${plan.length} case${plan.length > 1 ? 's' : ''}`,
            body: 'Move cases from over-utilized care managers to those with capacity:',
            breakdown, confirmLabel: 'Balance', tone: 'teal',
            onConfirm: () => {
              const moves = plan.map(() => this.cmData.reassignBusiestCase()).filter((m): m is { member: string; from: string; to: string } => !!m);
              this.ix.toast(`Workload balanced — ${opt.split(' — ')[0].toLowerCase()} (${moves.length} case${moves.length > 1 ? 's' : ''} moved).`);
              this.data.addHistory('balance', 'CM caseload balanced', `${opt.split(' — ')[0]} · ${moves.map((m) => `${m.member} → ${m.to}`).join(', ') || 'no moves'}`);
            },
          });
        },
      });
      return;
    }
    const all = this.cmData.cases();
    const owners = new Map(ids.map((id) => [id, all.find((c) => c.memberId === id)?.careManager ?? null]));
    const sim = this.cmData.managerStats().map((m) => ({ name: m.name, utilization: m.utilization }));
    const plan = ids.map((id) => {
      sim.sort((a, b) => a.utilization - b.utilization);
      const target = sim[0];
      target.utilization = Math.min(100, target.utilization + 2);
      return { memberId: id, from: owners.get(id) ?? null, to: target.name };
    });
    const byTarget = new Map<string, number>();
    plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
    const breakdown = [...byTarget.entries()].map(([target, count]) => ({ count, label: count === 1 ? 'case' : 'cases', target }));
    this.ix.ask({
      title: `Balance ${ids.length} selected case${ids.length > 1 ? 's' : ''}`,
      body: 'Move these cases to the care managers with the most capacity:',
      breakdown, confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        plan.forEach((p) => this.cmData.reassignCase(p.memberId, p.to));
        this.ix.toast(`${ids.length} case(s) balanced across ${byTarget.size} care manager(s).`);
        this.data.addHistory('balance', 'Selected CM cases balanced', `${ids.length} case(s) across ${byTarget.size} care manager(s)`);
        this.selected.set(new Set());
      },
    });
  }

  /** Click a Referral ID to review it before acting — Accept has no bulk path (see below); a
   *  Supervisor/CM must open and look at a referral (and, if needed, the member's chart) before
   *  making the clinical accept/decline call. */
  openReferralDetail(row: (string | number)[], e: { columns: string[]; memberColumn?: number }) {
    const id = this.rowId(row);
    const rec = this.cmData.referrals().find((r) => r.id === id);
    if (!rec) return;
    const iMember = e.memberColumn ?? 1;
    const fields = e.columns.map((label, i) => ({ label, value: String(row[i]) })).filter((f) => f.label !== 'Referral ID');
    if (rec.status === 'Pending') {
      const match = this.cmData.proficiencyMatch(rec);
      fields.push({ label: 'Suggested Care Manager', value: match.matched ? `${match.cm} (${match.discipline} — proficiency match)` : `${match.cm} (no ${match.discipline} capacity — least-utilized fallback)` });
    }
    this.ix.openDrawer({
      title: rec.id,
      subtitle: `${rec.member} · ${rec.source}`,
      badge: { text: rec.status, tone: rec.status === 'Accepted' ? 'green' : rec.status === 'Pending' ? 'amber' : 'red' },
      fields,
      actions: [
        ...(rec.status === 'Pending' ? [{ label: 'Accept & Assign to Care Manager', tone: 'teal' as const, run: () => { this.ix.closeDrawer(); this.acceptOneReferral(rec); } }] : []),
        { label: 'View Member 360', tone: 'teal' as const, run: () => this.members.openByName(String(row[iMember])) },
      ],
    });
  }

  /** Accept is one-at-a-time only, reached from the review drawer above — never a bulk action.
   *  Assigning a referral IS the triage decision (CmData.reassignReferral), so it always follows
   *  an explicit look at that one referral first. */
  private acceptOneReferral(rec: ReferralIntakeRec) {
    // Proficiency match (see CmData.proficiencyMatch) is listed first as the soft default —
    // same "most-likely pick goes first" treatment referralAssigneeStats() gives coordinators —
    // but the supervisor can still pick anyone else from the full list.
    const match = this.cmData.proficiencyMatch(rec);
    const nurses = this.cmData.managerStats()
      .map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }))
      .sort((a, b) => (a.name === match.cm ? -1 : b.name === match.cm ? 1 : 0));
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

  /** Completeness handoff — gives selected still-Pending referrals a working owner (Intake
   *  Coordinator, or a Care Manager for clients where CMs do their own intake) without making the
   *  clinical accept/decline call (that's reassignSelectedReferral above). */
  assignSelectedToIntakeCoordinator() {
    const ids = [...this.selected()];
    if (!ids.length) return;
    const all = this.cmData.referrals();
    const pendingIds = ids.filter((id) => all.find((r) => r.id === id)?.status === 'Pending');
    if (!pendingIds.length) { this.ix.toast('Only Pending referrals can be reassigned.', 'info'); return; }
    const cases: ReassignCase[] = pendingIds.map((id) => {
      const rec = all.find((r) => r.id === id);
      return { authId: id, member: rec?.member ?? id, type: rec?.source ?? 'Referral', queue: 'Pending Intake', priority: 'Routine', owner: rec?.intakeCoordinator ?? 'Unclaimed' };
    });
    const assignees = this.cmData.referralAssigneeStats();
    this.rx.open({
      title: `Assign ${pendingIds.length} referral${pendingIds.length > 1 ? 's' : ''}`,
      cases, nurses: assignees, preselectAll: true, queueTargets: [],
      apply: (assignedIds, target, mode) => {
        if (mode === 'queue') { this.ix.toast('Referrals are assigned directly, not by queue.', 'info'); return; }
        assignedIds.forEach((id) => this.cmData.assignIntakeCoordinator(id, target));
        this.ix.toast(`${assignedIds.length} referral(s) assigned to ${target}.`);
        this.data.addHistory('swap', 'Referrals assigned', `${assignedIds.length} referral(s) → ${target}`);
        this.selected.set(new Set());
      },
    });
  }

  escalateSelected(e: { columns: string[]; rows: (string | number)[][]; memberColumn?: number }) {
    const ids = [...this.selected()];
    if (!ids.length) return;
    const iMember = e.memberColumn ?? 1;
    const iStatus = e.columns.indexOf('Status');
    const iUrgency = e.columns.indexOf('Urgency');
    const rowByAuth = new Map(e.rows.map((r) => [this.rowId(r), r]));

    const candidates = ids.map((id) => {
      const row = rowByAuth.get(id);
      const rec = CASE_POOL.find((c) => c.authId === id);
      const status = row && iStatus >= 0 ? String(row[iStatus]) : (rec?.status ?? 'Authorization');
      const urgency = row && iUrgency >= 0 ? String(row[iUrgency]) : (rec ? urgencyOf(rec) : 'Standard');
      return {
        authId: id, member: row ? String(row[iMember]) : (rec?.member ?? ''),
        detail: `${status} · ${urgency}`, riskLabel: urgency,
        risk: (urgency === 'Expedited' ? 'amber' : 'green') as 'red' | 'amber' | 'green',
      };
    });
    this.esc.open({
      title: `Escalate ${ids.length} authorization${ids.length > 1 ? 's' : ''}`,
      candidates, targets: ESCALATE_TARGETS,
      apply: (_ids, who) => {
        this.ix.toast(`${ids.length} authorization(s) escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Authorizations escalated', `${ids.length} authorization(s) → ${who}`);
        this.selected.set(new Set());
      },
    });
  }

  /**
   * With authorizations selected, Balance spreads exactly those across nurses with capacity
   * (not a single target — that's what Reassign does). With nothing selected, it falls back
   * to the generic team-wide rebalance.
   */
  balance(_e: { columns: string[]; rows: (string | number)[][]; memberColumn?: number }) {
    if (this.isCmList()) { this.balanceCm([...this.selected()]); return; }
    const ids = [...this.selected()];
    if (!ids.length) { this.bal.run(); return; }

    const owners = new Map(ids.map((id) => {
      const rec = CASE_POOL.find((c) => c.authId === id);
      return [id, rec && rec.nurse !== '—' ? rec.nurse : null] as const;
    }));

    // Simulate: each authorization goes to whichever nurse has the least utilization *at that
    // point*, so a run of them spreads out instead of piling onto a single "most capacity" nurse.
    const sim = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization }));
    const plan = ids.map((id) => {
      sim.sort((a, b) => a.utilization - b.utilization);
      const target = sim[0];
      target.utilization = Math.min(100, target.utilization + 4); // rough capacity nudge for ordering only
      return { authId: id, from: owners.get(id) ?? null, to: target.name };
    });
    const byTarget = new Map<string, number>();
    plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
    const breakdown = [...byTarget.entries()].map(([target, count]) => ({ count, label: count === 1 ? 'authorization' : 'authorizations', target }));

    this.ix.ask({
      title: `Balance ${ids.length} selected authorization${ids.length > 1 ? 's' : ''}`,
      body: 'Move these authorizations to the nurses with the most capacity:',
      breakdown,
      confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        plan.forEach((p) => this.data.moveOneCase(p.from, p.to));
        this.ix.toast(`${ids.length} authorization(s) balanced across ${byTarget.size} nurse(s).`);
        this.data.addHistory('balance', 'Selected authorizations balanced', `${ids.length} authorization(s) across ${byTarget.size} nurse(s)`);
        this.selected.set(new Set());
      },
    });
  }

  // ---- member name -> the auth in question (not straight to Member 360) ----
  openAuth(row: (string | number)[], e: { memberColumn?: number }) {
    const authId = this.rowId(row);
    const rec = CASE_POOL.find((c) => c.authId === authId);
    if (!rec) { this.members.openByName(String(row[e.memberColumn ?? 1])); return; }

    const pending = rec.phase === 'pending';
    const reason = pending ? pendReason(rec) : null;
    this.ix.openDrawer({
      title: rec.authId,
      subtitle: `${rec.member} · ${rec.procedure}`,
      badge: { text: pending ? rec.status : rec.decision, tone: rec.tags.includes('breached') ? 'red' : rec.tags.includes('atRisk') ? 'amber' : 'green' },
      fields: [
        { label: 'Service Type', value: rec.serviceType },
        { label: 'Provider', value: rec.provider },
        { label: 'Line of Business', value: lobOf(rec.authId) },
        { label: 'Service Category', value: serviceCategoryOf(rec) },
        { label: 'Urgency', value: urgencyOf(rec) },
        ...(pending
          ? [{ label: 'Pend Reason', value: reason! }, { label: 'Next Best Action', value: nbaFor(reason!) }]
          : [{ label: 'TAT Status', value: tatStatus(rec) as string }]),
        { label: 'Submitted', value: rec.submitted },
        { label: 'TAT', value: `${rec.tatH}h` },
        { label: 'Est. Cost', value: `$${rec.cost.toLocaleString()}` },
      ],
      actions: [
        { label: 'Reassign this authorization', tone: 'teal', run: () => this.reassignOne(rec) },
        { label: 'Escalate this authorization', tone: 'amber', run: () => this.escalateOne(rec) },
        { label: 'View Member 360', tone: 'teal', run: () => this.members.openByName(rec.member) },
      ],
    });
  }

  private reassignOne(rec: CaseRec) {
    const nurses = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization, active: n.active }));
    this.rx.open({
      title: `Reassign ${rec.authId}`,
      cases: [{ authId: rec.authId, member: rec.member, type: rec.serviceType, queue: rec.status, priority: urgencyOf(rec), owner: rec.nurse !== '—' ? rec.nurse : 'Unassigned' }],
      nurses, preselectAll: true,
      apply: (_ids, target, mode) => {
        if (mode === 'queue') {
          this.data.releaseToQueue(rec.status, rec.nurse !== '—' ? rec.nurse : null, target);
          this.ix.toast(`${rec.authId} moved to ${target}.`);
          this.data.addHistory('swap', 'Authorization moved to queue', `${rec.authId} → ${target}`);
        } else {
          this.data.claimToNurse(rec.status, rec.nurse !== '—' ? rec.nurse : null, target);
          this.ix.toast(`${rec.authId} reassigned to ${target}.`);
          this.data.addHistory('swap', 'Authorization reassigned', `${rec.authId} → ${target}`);
        }
      },
    });
  }

  private escalateOne(rec: CaseRec) {
    this.esc.open({
      title: `Escalate ${rec.authId}`,
      candidates: [{
        authId: rec.authId, member: rec.member, detail: `${rec.status} · ${rec.procedure}`,
        riskLabel: urgencyOf(rec), risk: rec.tags.includes('breached') ? 'red' : rec.tags.includes('atRisk') ? 'amber' : 'green',
      }],
      targets: ESCALATE_TARGETS,
      apply: (_ids, who) => {
        this.ix.toast(`${rec.authId} escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Authorization escalated', `${rec.authId} → ${who}`);
      },
    });
  }

  /** All reassign/balance activity this session — separate from the fuller Activity History (which also has escalations). */
  openAssignmentHistory() {
    const rows = this.data.assignmentHistory();
    this.ix.openDrawer({
      title: 'Assignment History',
      subtitle: `${rows.length} reassignment${rows.length === 1 ? '' : 's'} & balance event${rows.length === 1 ? '' : 's'} this session`,
      table: rows.length ? { columns: ['Time', 'Action', 'Detail'], rows: rows.map((h) => [h.time, h.action, h.detail]) } : undefined,
      note: rows.length ? undefined : 'Nothing has been reassigned or balanced yet this session.',
    });
  }
}
