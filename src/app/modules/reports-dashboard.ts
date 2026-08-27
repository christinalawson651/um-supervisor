import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from '../shared/icon';
import { Nav, BizModule } from '../shared/nav';
import { Exporter } from '../shared/exporter';
import { DashboardData } from '../data/dashboard-data';
import { daysAgo, TODAY } from '../data/case-fields';
import { UM_REPORTS, CM_REPORTS, APPEALS_REPORTS, GENERIC_REPORTS, UM_QUEUE_NAMES, UM_TEAMS, ReportDef, ReportContext } from '../data/report-registry';
import { NURSES } from '../data/case-pool';

type Group = BizModule | 'generic';
const MODULE_LABEL: Record<Group, string> = { um: 'UM', cm: 'CM', appeals: 'Appeals', generic: 'Generic' };
const REGISTRY: Record<Group, ReportDef[]> = { um: UM_REPORTS, cm: CM_REPORTS, appeals: APPEALS_REPORTS, generic: GENERIC_REPORTS };
const PERIODS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7d', label: '7 days', days: 6 },
  { id: '30d', label: '30 days', days: 29 },
  { id: 'qtd', label: 'QTD', days: 90 },
];

// A report is generated on demand from a chosen filter scope — it is NOT a live-reactive view of
// the dashboard. Selecting a report (or changing filters) drops back into "configure" mode with no
// output shown; clicking Generate Report snapshots the current filters and renders the result.
// Changing a filter after that has no effect until you explicitly re-generate — the report you're
// looking at should never silently change under you.
@Component({
  selector: 'app-reports-dashboard',
  standalone: true,
  imports: [FormsModule, Icon],
  template: `
    <div class="reports-shell">
      <!-- Report picker sidebar (hidden on print) -->
      <aside class="picker no-print">
        @for (mod of visibleGroups(); track mod) {
          <div class="grp">
            <div class="grp-title">{{ moduleLabel(mod) }}</div>
            @for (r of reportsFor(mod); track r.id) {
              <button class="picker-item" [class.active]="selectedId() === r.id" (click)="select(r.id)">{{ r.title }}</button>
            }
          </div>
        }
        <div class="grp-note">CM and Appeals reports are next up — this pass ships UM's full granular set.</div>
      </aside>

      <!-- Report body -->
      <section class="body">
        @if (!current()) {
          <div class="empty-state">No reports available for your current role.</div>
        } @else {
          <div class="report-head no-print">
            <div>
              <h2>{{ current()!.title }}</h2>
              <p class="desc">{{ current()!.description }}</p>
            </div>
          </div>

          @if (current()!.staticNote) {
            <div class="static-note no-print">{{ current()!.staticNote }}</div>
          }

          @if (!generated()) {
            <!-- Configure step: choose filters, nothing rendered yet -->
            <div class="filter-bar no-print">
              @if (!current()!.noLobDays) {
                <span class="flab">Lookback</span>
                <div class="fseg">
                  @for (p of periods; track p.id) {
                    <button [class.on]="period() === p.id && !customSince()" (click)="setPeriod(p.id)">{{ p.label }}</button>
                  }
                </div>
                <span class="flab">Since</span>
                <input type="date" [ngModel]="customSince()" (ngModelChange)="setCustomSince($event)" [max]="todayIso" />
                <span class="flab">LOB</span>
                <div class="queue-checks">
                  @for (l of lobOptions; track l) {
                    <label class="qchk"><input type="checkbox" [checked]="selectedLobs().includes(l)" (change)="toggleLob(l)" /> {{ l }}</label>
                  }
                </div>
              }
              @if (current()!.dimension; as dim) {
                <span class="flab">{{ dim.label }}</span>
                <select [ngModel]="dimension()" (ngModelChange)="dimension.set($event)">
                  @for (o of dim.options; track o) { <option [value]="o">{{ o }}</option> }
                </select>
              }
              @if (current()!.dimension2; as dim2) {
                <span class="flab">{{ dim2.label }}</span>
                <select [ngModel]="dimension2()" (ngModelChange)="dimension2.set($event)">
                  @for (o of dim2.options; track o) { <option [value]="o">{{ o }}</option> }
                </select>
              }
              @if (current()!.schedulePeriod) {
                <span class="flab">Period</span>
                <select [ngModel]="schedulePeriod()" (ngModelChange)="schedulePeriod.set($event)">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="rolling4">Rolling 4 Weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              }
              @if (current()!.noLobDays && !current()!.dimension && !current()!.dimension2 && !current()!.schedulePeriod && !current()!.caseLevel && !current()!.memberSearchable) {
                <span class="flab no-filters-note">No filters apply to this report — it always shows the full current data.</span>
              }
            </div>
            @if (current()!.caseLevel) {
              <div class="filter-bar no-print drilldown-bar">
                @if (current()!.queueFilterable) {
                  <span class="flab">Queues</span>
                  <div class="queue-checks">
                    @for (q of queueNames; track q) {
                      <label class="qchk"><input type="checkbox" [checked]="selectedQueues().includes(q)" (change)="toggleQueue(q)" /> {{ q }}</label>
                    }
                  </div>
                }
                <span class="flab">Member</span>
                <input type="text" class="member-search" placeholder="Search member name…" [ngModel]="memberSearch()" (ngModelChange)="memberSearch.set($event)" />
              </div>
            }
            @if (current()!.memberSearchable && !current()!.caseLevel && !current()!.historyFilterable) {
              <div class="filter-bar no-print drilldown-bar">
                <span class="flab">Search</span>
                <input type="text" class="member-search" placeholder="Search…" [ngModel]="memberSearch()" (ngModelChange)="memberSearch.set($event)" />
              </div>
            }
            @if (current()!.historyFilterable) {
              <div class="filter-bar no-print drilldown-bar">
                <span class="flab">Team</span>
                <select [ngModel]="historyTeam()" (ngModelChange)="historyTeam.set($event)">
                  <option value="">All</option>
                  @for (t of umTeams; track t) { <option [value]="t">{{ t }}</option> }
                </select>
                <span class="flab">Staff</span>
                <select [ngModel]="historyStaff()" (ngModelChange)="historyStaff.set($event)">
                  <option value="">All</option>
                  @for (n of staffNames; track n) { <option [value]="n">{{ n }}</option> }
                </select>
                <span class="flab">Reassigned By</span>
                <select [ngModel]="historyActor()" (ngModelChange)="historyActor.set($event)">
                  <option value="">All</option>
                  <option value="Christina Lawson">Christina Lawson</option>
                  <option value="System">System</option>
                </select>
                <span class="flab">Member</span>
                <input type="text" class="member-search" placeholder="Search member name…" [ngModel]="memberSearch()" (ngModelChange)="memberSearch.set($event)" />
              </div>
            }
            <button class="btn primary generate-btn no-print" (click)="generate()">Generate Report</button>
          } @else {
            <!-- Generated step: filters locked to the snapshot; Edit Filters returns to configure -->
            <div class="scope-bar no-print">
              <span><b>Scope:</b> {{ appliedScopeLabel() }}</span>
              <div class="scope-actions">
                <div class="fseg orient-seg">
                  <button [class.on]="orientation() === 'portrait'" (click)="orientation.set('portrait')" title="Portrait">Portrait</button>
                  <button [class.on]="orientation() === 'landscape'" (click)="orientation.set('landscape')" title="Landscape">Landscape</button>
                </div>
                <button class="btn outline sm" (click)="editFilters()">Edit Filters</button>
                <button class="btn outline sm" (click)="doPrint()"><z-icon name="download" [size]="14"></z-icon> Print</button>
                <button class="btn outline sm" (click)="doExport()"><z-icon name="download" [size]="14"></z-icon> Export</button>
              </div>
            </div>

            <div class="print-header">
              <h2>{{ current()!.title }} — {{ moduleLabel(current()!.module) }}</h2>
              <p>{{ appliedScopeLabel() }} · Generated {{ todayLabel }}</p>
            </div>

            @for (t of tables(); track t.title) {
              <div class="panel mt-6">
                <div class="panel-pad"><h3 class="pt">{{ t.title }}</h3></div>
                <table class="z-table">
                  <thead><tr>@for (c of t.columns; track c) { <th>{{ c }}</th> }</tr></thead>
                  <tbody>
                    @for (row of t.rows; track $index) {
                      <tr>@for (cell of row; track $index) { <td>{{ cell }}</td> }</tr>
                    } @empty { <tr><td [attr.colspan]="t.columns.length" class="empty">No records met this report's criteria in the applied scope.</td></tr> }
                  </tbody>
                </table>
              </div>
            }
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .reports-shell { display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start; }
    .picker { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 12px; }
    .grp-title { font-size: 11px; font-weight: 700; color: var(--gray-500); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
    .picker-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; border: none; background: none;
      font-size: 13px; color: var(--ink); cursor: pointer; margin-bottom: 2px; }
    .picker-item:hover { background: var(--gray-100); }
    .picker-item.active { background: var(--teal-50); color: var(--teal-700); font-weight: 600; }
    .grp-note { font-size: 11px; color: var(--gray-500); font-style: italic; padding: 8px 10px; border-top: 1px solid var(--border); margin-top: 4px; }

    .body { min-width: 0; }
    .report-head { margin-bottom: 10px; }
    .report-head h2 { margin: 0 0 4px; }
    .desc { font-size: 12.5px; color: var(--gray-500); margin: 0; max-width: 640px; }
    .empty-state { padding: 60px 0; text-align: center; color: var(--gray-500); }

    .static-note { font-size: 12px; background: var(--amber-bg); color: var(--amber-fg); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }

    .filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fff; border: 1px solid var(--border);
      border-radius: var(--radius); padding: 10px 14px; margin-bottom: 14px; }
    .flab { font-size: 11px; font-weight: 700; color: var(--gray-500); text-transform: uppercase; letter-spacing: .03em; }
    .fseg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .fseg button { border: none; background: #fff; padding: 5px 10px; font-size: 12.5px; cursor: pointer; }
    .fseg button.on { background: var(--teal-700); color: #fff; }
    .filter-bar input[type=date], .filter-bar select { font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--gray-300); border-radius: 8px; }
    .drilldown-bar { align-items: flex-start; }
    .queue-checks { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .qchk { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 500; text-transform: none; color: var(--ink); cursor: pointer; }
    .member-search { font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--gray-300); border-radius: 8px; min-width: 200px; }
    .generate-btn { margin-bottom: 4px; }
    .btn.primary { background: var(--teal-700); color: #fff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn.primary:hover { background: var(--teal-800, #0f766e); }

    .scope-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--gray-50, #f9fafb);
      border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; margin-bottom: 16px; font-size: 12.5px; }
    .scope-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
    .orient-seg button { font-size: 11.5px; padding: 5px 9px; }

    .print-header { display: none; }
    .no-filters-note { text-transform: none; font-weight: 500; font-style: italic; letter-spacing: normal; color: var(--gray-500); }

    .pt { font-size: 14px; font-weight: 600; color: var(--ink); margin: 0; }
    .empty { text-align: center; color: var(--gray-500); padding: 20px; }

    @media print {
      .no-print { display: none !important; }
      .reports-shell { display: block; }
      .print-header { display: block; margin-bottom: 16px; }
      .print-header p { color: #555; font-size: 12px; margin: 2px 0 0; }
      .panel { border: none !important; box-shadow: none !important; break-inside: avoid; }
    }
  `],
})
export class ReportsDashboard {
  private nav = inject(Nav);
  private exporter = inject(Exporter);
  data = inject(DashboardData);
  readonly periods = PERIODS;
  readonly todayIso = TODAY.toISOString().slice(0, 10);
  readonly todayLabel = 'Friday, July 17, 2026';

  // Generic reports aren't tied to a business module, so they're always appended regardless of role.
  readonly visibleGroups = computed<Group[]>(() => [...this.nav.scope(), 'generic']);
  moduleLabel(m: Group) { return MODULE_LABEL[m]; }
  reportsFor(m: Group): ReportDef[] { return REGISTRY[m]; }

  private allVisibleReports = computed<ReportDef[]>(() => this.visibleGroups().flatMap((m) => REGISTRY[m]));
  readonly selectedId = signal<string | null>(null);
  readonly current = computed<ReportDef | null>(() => {
    const id = this.selectedId();
    const all = this.allVisibleReports();
    return all.find((r) => r.id === id) ?? all[0] ?? null;
  });
  select(id: string) {
    this.selectedId.set(id);
    this.dimension.set('');
    this.dimension2.set('');
    this.schedulePeriod.set('rolling4');
    this.selectedQueues.set([]);
    this.memberSearch.set('');
    this.historyTeam.set('');
    this.historyStaff.set('');
    this.historyActor.set('');
    this.generated.set(false);
  }

  // ---- filter selections (the "form"); independent of the shared per-module Lookback/LOB
  // signals, so building a report doesn't shift underfoot when someone changes a filter on a
  // dashboard tab elsewhere (and vice versa). ----
  readonly period = signal('30d');
  readonly customSince = signal<string | null>(null);
  readonly lobOptions = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
  readonly selectedLobs = signal<string[]>([]);
  readonly dimension = signal('');
  readonly dimension2 = signal('');
  readonly schedulePeriod = signal('rolling4');
  readonly queueNames = UM_QUEUE_NAMES;
  readonly selectedQueues = signal<string[]>([]);
  readonly memberSearch = signal('');
  readonly umTeams = UM_TEAMS;
  readonly staffNames = NURSES;
  readonly historyTeam = signal('');
  readonly historyStaff = signal('');
  readonly historyActor = signal('');
  setPeriod(id: string) { this.period.set(id); this.customSince.set(null); }
  setCustomSince(v: string) { this.customSince.set(v || null); }
  toggleQueue(q: string) { this.selectedQueues.update((qs) => qs.includes(q) ? qs.filter((x) => x !== q) : [...qs, q]); }
  toggleLob(l: string) { this.selectedLobs.update((ls) => ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]); }

  // ---- generated snapshot — Generate Report freezes the current filter selections into `appliedCtx`;
  // nothing in the output section reads the live filter signals directly, so editing filters after
  // generating never changes what's on screen until you generate again. ----
  readonly generated = signal(false);
  private appliedCtx = signal<ReportContext | null>(null);
  private appliedScope = signal('');

  private windowDays(): number | undefined {
    if (this.customSince()) return Math.max(0, daysAgo(this.customSince()!));
    const p = PERIODS.find((x) => x.id === this.period());
    return p?.id === '30d' ? undefined : p?.days; // '30d' = no filter, matches the rest of the app's convention
  }
  private buildScopeLabel(): string {
    const dimPart = this.current()?.dimension && this.dimension() ? `${this.current()!.dimension!.label}: ${this.dimension()}` : '';
    const dim2Part = this.current()?.dimension2 && this.dimension2() ? `${this.current()!.dimension2!.label}: ${this.dimension2()}` : '';
    const periodPart = this.current()?.schedulePeriod ? `Period: ${this.schedulePeriodLabel()}` : '';
    const queuePart = this.current()?.queueFilterable && this.selectedQueues().length ? `Queues: ${this.selectedQueues().join(', ')}` : '';
    const searchable = this.current()?.caseLevel || this.current()?.historyFilterable || this.current()?.memberSearchable;
    const memberPart = searchable && this.memberSearch().trim() ? `Search "${this.memberSearch().trim()}"` : '';
    const teamPart = this.current()?.historyFilterable && this.historyTeam() ? `Team: ${this.historyTeam()}` : '';
    const staffPart = this.current()?.historyFilterable && this.historyStaff() ? `Staff: ${this.historyStaff()}` : '';
    const actorPart = this.current()?.historyFilterable && this.historyActor() ? `Reassigned By: ${this.historyActor()}` : '';
    const extra = [dimPart, dim2Part, periodPart, queuePart, memberPart, teamPart, staffPart, actorPart].filter(Boolean).join(' · ');
    if (this.current()?.noLobDays) return extra || 'No filters applied — full current data';
    const lobPart = this.selectedLobs().length ? this.selectedLobs().join(', ') : 'All LOBs';
    const datePart = this.customSince() ? `Since ${this.customSince()}` : (PERIODS.find((p) => p.id === this.period())?.label ?? '30 days');
    return `${datePart} · ${lobPart}${extra ? ' · ' + extra : ''}`;
  }
  private schedulePeriodLabel(): string {
    const p = this.schedulePeriod();
    return p === 'daily' ? 'Today' : p === 'weekly' ? 'This Week' : p === 'monthly' ? 'Monthly (5 Weeks)' : 'Rolling 4 Weeks';
  }

  generate() {
    const searchable = this.current()?.caseLevel || this.current()?.historyFilterable || this.current()?.memberSearchable;
    this.appliedCtx.set({
      lob: this.selectedLobs().length ? this.selectedLobs() : undefined,
      days: this.windowDays(),
      dimension: this.dimension() || undefined,
      dimension2: this.dimension2() || undefined,
      period: this.current()?.schedulePeriod ? this.schedulePeriod() : undefined,
      queues: this.current()?.queueFilterable ? this.selectedQueues() : undefined,
      memberSearch: searchable ? this.memberSearch() : undefined,
      historyTeam: this.current()?.historyFilterable ? this.historyTeam() : undefined,
      historyStaff: this.current()?.historyFilterable ? this.historyStaff() : undefined,
      historyActor: this.current()?.historyFilterable ? this.historyActor() : undefined,
      data: this.data,
    });
    this.appliedScope.set(this.buildScopeLabel());
    this.generated.set(true);
  }
  editFilters() { this.generated.set(false); }
  appliedScopeLabel() { return this.appliedScope(); }

  readonly tables = computed(() => {
    const ctx = this.appliedCtx();
    return ctx ? (this.current()?.tables(ctx) ?? []) : [];
  });

  // ---- Print orientation — a real, working page-size override, not a static toggle. `@page` rules
  // can't be scoped with a class selector, so a landscape override is injected as a global <style>
  // tag right before printing and removed again once the print dialog closes. ----
  readonly orientation = signal<'portrait' | 'landscape'>('portrait');
  doPrint() {
    if (this.orientation() === 'landscape') {
      const style = document.createElement('style');
      style.id = 'reports-print-orientation';
      style.textContent = '@page { size: landscape; }';
      document.head.appendChild(style);
      window.addEventListener('afterprint', () => document.getElementById('reports-print-orientation')?.remove(), { once: true });
    }
    window.print();
  }
  doExport() {
    const r = this.current();
    if (!r) return;
    const t = this.tables();
    if (!t.length) return;
    const [first, ...rest] = t;
    this.exporter.open({
      title: r.title, name: `report-${r.id}-${first.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_2026-07-17`,
      columns: first.columns, rows: first.rows,
      sections: rest.map((tbl) => ({ label: tbl.title, name: `report-${r.id}-${tbl.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_2026-07-17`, columns: tbl.columns, rows: tbl.rows })),
    });
  }
}
