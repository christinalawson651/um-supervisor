import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Interaction } from './interaction';
import { Members } from './members';
import { Reassign, ReassignCase } from './reassign';
import { Escalate, ESCALATE_TARGETS } from './escalate';
import { Balance } from './balance';
import { downloadCsv } from './export-csv';
import { DashboardData } from '../data/dashboard-data';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { lobOf, programOf, tatStatus, urgencyOf } from '../data/case-fields';
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
            <input class="search" type="text" placeholder="Search all cases…"
              [ngModel]="q()" (ngModelChange)="setQuery($event)" />
            <span class="count">{{ filtered().length }} case{{ filtered().length === 1 ? '' : 's' }}</span>

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
              <button class="btn outline sm" [disabled]="!selected().size" (click)="reassignSelected(e)">Reassign selected</button>
            }
            <button class="btn outline sm" (click)="balance(e)">Balance{{ selected().size ? ' selected' : '' }}</button>
            <button class="btn outline sm" (click)="exportAll(e)">Export all ({{ filtered().length }})</button>
          </div>

          <!-- table -->
          <div class="etable-wrap">
            <table class="etable">
              <thead>
                <tr>
                  @if (isCaseList()) {
                    <th class="selth"><input type="checkbox" [checked]="allSelected()" (change)="toggleAllFiltered($event)" /></th>
                  }
                  @for (c of e.columns; track c; let ci = $index) {
                    <th (click)="sortBy(ci)">{{ c }}{{ caret(ci) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of pageRows(); track $index) {
                  <tr>
                    @if (isCaseList()) {
                      <td class="selth"><input type="checkbox" [checked]="selected().has(rowId(row))" (change)="toggleSel(rowId(row))" /></td>
                    }
                    @for (cell of row; track $index; let ci = $index) {
                      @if (ci === e.memberColumn) {
                        <td><a class="mlink" (click)="openAuth(row, e)">{{ cell }}</a></td>
                      } @else {
                        <td>{{ cell }}</td>
                      }
                    }
                  </tr>
                }
                @empty {
                  <tr><td [attr.colspan]="e.columns.length + 1" class="empty">No cases match "{{ q() }}".</td></tr>
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
  private rx = inject(Reassign);
  private esc = inject(Escalate);
  private bal = inject(Balance);

  readonly q = signal('');
  readonly page = signal(0);
  readonly sortCol = signal<number>(-1);
  readonly sortDir = signal<1 | -1>(1);
  readonly quickSort = signal<QuickSort>('default');
  readonly selected = signal<Set<string>>(new Set());

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
    });
  }

  /** Every drill in the app starts its columns with "Auth ID" except the team-utilization roster. */
  readonly isCaseList = computed(() => this.ix.explorer()?.columns[0] === 'Auth ID');

  readonly availableSorts = computed(() => {
    const e = this.ix.explorer();
    if (!e || !this.isCaseList()) return [];
    return QUICK_SORTS.filter((s) => s.col(e.columns) >= 0);
  });

  rowId(row: (string | number)[]) { return String(row[0]); }

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
  allSelected() { const f = this.filtered(); return f.length > 0 && f.every((r) => this.selected().has(this.rowId(r))); }
  toggleAllFiltered(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.selected.set(on ? new Set(this.filtered().map((r) => this.rowId(r))) : new Set());
  }

  exportAll(e: { columns: string[]; exportName: string }) {
    downloadCsv(e.exportName, e.columns, this.filtered());
  }

  // ---- reassign / balance directly from any drill-down ----
  reassignSelected(e: { columns: string[]; rows: (string | number)[][]; memberColumn?: number }) {
    const ids = [...this.selected()];
    if (!ids.length) return;
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
        type: row && iService >= 0 ? String(row[iService]) : (rec?.serviceType ?? 'Case'),
        queue: row && iStatus >= 0 ? String(row[iStatus]) : (rec?.status ?? 'Case'),
        priority: row && iUrgency >= 0 ? String(row[iUrgency]) : (rec ? urgencyOf(rec) : 'Standard'),
        owner: rec && rec.nurse !== '—' ? rec.nurse : 'Unassigned',
      };
    });
    const nurses = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization, active: n.active }));
    this.rx.open({
      title: `Reassign ${ids.length} case${ids.length > 1 ? 's' : ''}`,
      cases, nurses, preselectAll: true,
      apply: (assignedIds, target) => {
        assignedIds.forEach((aid) => {
          const cs = cases.find((x) => x.authId === aid);
          this.data.moveOneCase(cs && cs.owner !== 'Unassigned' ? cs.owner : null, target);
        });
        this.ix.toast(`${assignedIds.length} case(s) reassigned to ${target}.`);
        this.data.addHistory('swap', 'Cases reassigned', `${assignedIds.length} case(s) → ${target}`);
        this.selected.set(new Set());
      },
    });
  }

  /**
   * With cases selected, Balance spreads exactly those auths across nurses with capacity
   * (not a single target — that's what Reassign does). With nothing selected, it falls back
   * to the generic team-wide rebalance.
   */
  balance(_e: { columns: string[]; rows: (string | number)[][]; memberColumn?: number }) {
    const ids = [...this.selected()];
    if (!ids.length) { this.bal.run(); return; }

    const owners = new Map(ids.map((id) => {
      const rec = CASE_POOL.find((c) => c.authId === id);
      return [id, rec && rec.nurse !== '—' ? rec.nurse : null] as const;
    }));

    // Simulate: each case goes to whichever nurse has the least utilization *at that point*,
    // so a run of cases spreads out instead of piling onto a single "most capacity" nurse.
    const sim = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization }));
    const plan = ids.map((id) => {
      sim.sort((a, b) => a.utilization - b.utilization);
      const target = sim[0];
      target.utilization = Math.min(100, target.utilization + 4); // rough capacity nudge for ordering only
      return { authId: id, from: owners.get(id) ?? null, to: target.name };
    });
    const byTarget = new Map<string, number>();
    plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
    const summary = [...byTarget.entries()].map(([n, c]) => `${c} → ${n}`).join(', ');

    this.ix.ask({
      title: `Balance ${ids.length} selected case${ids.length > 1 ? 's' : ''}`,
      body: `Distribute these ${ids.length} case(s) across nurses with the most capacity: ${summary}. Continue?`,
      confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        plan.forEach((p) => this.data.moveOneCase(p.from, p.to));
        this.ix.toast(`${ids.length} case(s) balanced across ${byTarget.size} nurse(s).`);
        this.data.addHistory('balance', 'Selected cases balanced', `${ids.length} case(s): ${summary}`);
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
        { label: 'Program', value: programOf(rec) },
        { label: 'Urgency', value: urgencyOf(rec) },
        ...(pending
          ? [{ label: 'Pend Reason', value: reason! }, { label: 'Next Best Action', value: nbaFor(reason!) }]
          : [{ label: 'TAT Status', value: tatStatus(rec) as string }]),
        { label: 'Submitted', value: rec.submitted },
        { label: 'TAT', value: `${rec.tatH}h` },
        { label: 'Est. Cost', value: `$${rec.cost.toLocaleString()}` },
      ],
      actions: [
        { label: 'Reassign this case', tone: 'teal', run: () => this.reassignOne(rec) },
        { label: 'Escalate this case', tone: 'amber', run: () => this.escalateOne(rec) },
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
      apply: (_ids, target) => {
        this.data.moveOneCase(rec.nurse !== '—' ? rec.nurse : null, target);
        this.ix.toast(`${rec.authId} reassigned to ${target}.`);
        this.data.addHistory('swap', 'Case reassigned', `${rec.authId} → ${target}`);
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
        this.data.addHistory('arrowup', 'Case escalated', `${rec.authId} → ${who}`);
      },
    });
  }
}
