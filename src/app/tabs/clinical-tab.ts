import { Component, computed, inject, signal } from '@angular/core';
import {
  DashboardData, liveDecisionStats, liveDecisionRows, inScope,
  liveDeterminationMix, liveDeterminationCases, DeterminationMixRow, DeterminationOutcome,
} from '../data/dashboard-data';
import { CASE_POOL, GUIDELINE_DETAIL } from '../data/case-pool';
import { urgencyOf, mdReviewerOf, determinationReasonOf, criteriaStatusOf, authStatusOf, AUTH_STATUSES, dxOf, TODAY_ISO } from '../data/case-fields';
import { Interaction } from '../shared/interaction';
import { Metrics, COLUMNS, toRow } from '../shared/metrics';
import { Exporter } from '../shared/exporter';
import { DecisionRow } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const CLINICAL_WIDGETS = [
  { id: 'decision-mix', title: 'Decision Mix' },
  { id: 'Approved', title: 'Approved' }, { id: 'Denied', title: 'Denied' }, { id: 'Partial', title: 'Partial' },
  { id: 'Auto-Approved', title: 'Auto-Approved' }, { id: 'MD Review', title: 'MD Review' }, { id: 'P2P Rate', title: 'P2P Rate' },
  { id: 'auth-status-mix', title: 'Authorization Status Mix' },
  { id: 'diagnosis-mix', title: 'Diagnosis Mix' },
  { id: 'reason-mix', title: 'Reason Codes by Outcome' },
  { id: 'drilldown', title: 'Decision Drilldown by Service' },
];

@Component({
  selector: 'app-clinical-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Clinical Decision Insights</h2>
      <span class="section-note">Decision quality remains strong across service types</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('decision-mix')) {
    <div class="panel mix-panel mb-4">
      <z-widget-actions (exportClick)="exportMix()" (removeClick)="hide('decision-mix')"></z-widget-actions>
      <h3 class="panel-title">Decision Mix</h3>
      <div class="mix-bar">
        @for (m of decisionMix(); track m.label; let i = $index) {
          <div class="mix-seg" [attr.data-tone]="m.tone" [style.width.%]="m.pct"
               (click)="metrics.open(decKeys[i])" [title]="m.label + ': ' + m.count + ' (' + m.pct + '%)'"></div>
        }
      </div>
      <div class="mix-legend">
        @for (m of decisionMix(); track m.label; let i = $index) {
          <div class="mix-item clk" [attr.data-tone]="m.tone" (click)="metrics.open(decKeys[i])">
            <span class="mix-dot"></span>{{ m.label }} — {{ m.count }} ({{ m.pct }}%)
          </div>
        }
      </div>
    </div>
    }

    <div class="dstats">
      @for (s of decisionStats(); track s.label; let i = $index) {
        @if (!isHidden(s.label)) {
          <div class="dstat clickable" [attr.data-tone]="s.tone" (click)="metrics.open(decKeys[i])">
            <z-widget-actions (exportClick)="exportStat(s, decKeys[i])" (removeClick)="hide(s.label)"></z-widget-actions>
            <div class="dic"><z-icon [name]="s.icon" [size]="20" [stroke]="1.8"></z-icon></div>
            <div class="dval">{{ s.value }}</div>
            <div class="dlab">{{ s.label }}</div>
          </div>
        }
      }
    </div>

    @if (!isHidden('auth-status-mix')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Authorization Status Mix</h3>
        <z-widget-actions (exportClick)="exportAuthStatus()" (removeClick)="hide('auth-status-mix')"></z-widget-actions>
      </div>
      <div class="reason-rows">
        @for (s of authStatusMix(); track s.status) {
          <div class="reason-row clk" (click)="drillAuthStatus(s.status)">
            <div class="reason-lab">{{ s.status }}</div>
            <div class="reason-bar-track"><div class="reason-bar-fill" [style.width.%]="s.pct"></div></div>
            <div class="reason-count">{{ s.count }} · {{ s.pct }}%</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('diagnosis-mix')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Diagnosis Mix</h3>
        <span class="section-note">Primary diagnosis behind every authorization, ranked by volume</span>
        <z-widget-actions (exportClick)="exportDiagnosisMix()" (removeClick)="hide('diagnosis-mix')"></z-widget-actions>
      </div>
      <div class="reason-rows">
        @for (d of diagnosisMix(); track d.code) {
          <div class="reason-row clk" (click)="drillDiagnosis(d.code)">
            <div class="reason-lab"><span class="reason-code">{{ d.code }}</span>{{ d.description }}</div>
            <div class="reason-bar-track"><div class="reason-bar-fill" [style.width.%]="d.pct"></div></div>
            <div class="reason-count">{{ d.count }} · {{ d.pct }}%</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('reason-mix')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Reason Codes by Outcome</h3>
        <div class="mix-toggle">
          <button class="seg-btn" [class.active]="mixOutcome()==='Denied'" (click)="mixOutcome.set('Denied')">Denied</button>
          <button class="seg-btn" [class.active]="mixOutcome()==='Partial'" (click)="mixOutcome.set('Partial')">Partial</button>
          <button class="seg-btn" [class.active]="mixOutcome()==='Approved'" (click)="mixOutcome.set('Approved')">Approved</button>
        </div>
        <z-widget-actions (exportClick)="exportReasonMix()" (removeClick)="hide('reason-mix')"></z-widget-actions>
      </div>
      <div class="reason-rows">
        @for (r of reasonMix(); track r.code) {
          <div class="reason-row clk" (click)="drillReason(r)">
            <div class="reason-lab">
              <span class="reason-code">{{ r.code }}</span>
              <span class="reason-cat" [attr.data-cat]="r.category">{{ r.category }}</span>
              {{ r.label }}
            </div>
            <div class="reason-bar-track"><div class="reason-bar-fill" [style.width.%]="r.pct"></div></div>
            <div class="reason-count">{{ r.count }} · {{ r.pct }}%</div>
          </div>
        }
        @if (!reasonMix().length) {
          <div class="reason-empty">No {{ mixOutcome().toLowerCase() }} decisions in the current scope.</div>
        }
      </div>
    </div>
    }

    @if (!isHidden('drilldown')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Decision Drilldown by Service</h3>
        <select class="svc-filter" [value]="serviceTypeFilter()" (change)="serviceTypeFilter.set($any($event.target).value)">
          <option value="all">All Service Types</option>
          <option value="Inpatient">Inpatient</option>
          <option value="Outpatient">Outpatient</option>
          <option value="Behavioral">Behavioral</option>
        </select>
        <z-widget-actions (exportClick)="exportDrilldown()" (removeClick)="hide('drilldown')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr>
            <th class="sortable" (click)="sortBy('procedure')">Procedure{{ caret('procedure') }}</th>
            <th class="sortable" (click)="sortBy('serviceType')">Service Type{{ caret('serviceType') }}</th>
            <th>Guideline</th>
            <th class="sortable" (click)="sortBy('approvalRate')">Approval Rate{{ caret('approvalRate') }}</th>
            <th class="sortable" (click)="sortBy('volume')">Volume{{ caret('volume') }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of sortedRows(); track r.procedure) {
            <tr class="clickable" (click)="open(r)">
              <td class="strong">{{ r.procedure }}</td>
              <td><span class="stype" [attr.data-t]="r.serviceType">{{ r.serviceType }}</span></td>
              <td class="gl has-tip">{{ r.guideline }}
                @if (guidelineDetail(r.guideline); as detail) { <span class="tip">{{ detail }}</span> }
              </td>
              <td><span class="rate-pill" [class.good]="r.approvalRate >= 80"
                    [class.mid]="r.approvalRate < 80">{{ r.approvalRate }}%</span></td>
              <td class="num"><span class="vol-link" (click)="openDecisionLog(r); $event.stopPropagation()">{{ r.volume }}</span></td>
            </tr>
          }
          @if (!sortedRows().length) {
            <tr><td colspan="5" class="empty-row">No procedures match this filter.</td></tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .dstats { display:grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }
    .dstat { position: relative; background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 12px; text-align:center; }
    .dstat:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
    .tbl-head { position: relative; display: flex; align-items: center; justify-content: flex-start; gap: 10px 16px; padding-right: 44px; }
    .dic { display:flex; justify-content:center; margin-bottom: 10px; }
    .dval { font-size: 26px; font-weight: 700; color: var(--ink); }
    .dlab { font-size: 10.5px; letter-spacing:0.05em; text-transform:uppercase;
      color: var(--gray-500); font-weight:600; margin-top: 4px; }
    .dstat[data-tone="green"]{ border-top-color: var(--green); } .dstat[data-tone="green"] .dic{ color: var(--green); }
    .dstat[data-tone="red"]  { border-top-color: var(--red); }   .dstat[data-tone="red"] .dic{ color: var(--red); }
    .dstat[data-tone="amber"]{ border-top-color: var(--amber); } .dstat[data-tone="amber"] .dic{ color: var(--amber); }
    .dstat[data-tone="teal"] { border-top-color: var(--teal-600); } .dstat[data-tone="teal"] .dic{ color: var(--teal-700); }
    .dstat[data-tone="blue"] { border-top-color: var(--blue); }  .dstat[data-tone="blue"] .dic{ color: var(--blue); }
    .dstat[data-tone="purple"]{ border-top-color: var(--purple);} .dstat[data-tone="purple"] .dic{ color: var(--purple); }
    .gl { font-style: italic; color: var(--gray-500); }
    .has-tip { position: relative; cursor: help; text-decoration: underline dotted var(--gray-400); text-underline-offset: 3px; }
    .has-tip .tip { visibility: hidden; opacity: 0; position: absolute; top: 100%; left: 0; margin-top: 6px;
      background: var(--ink); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      font-style: normal; white-space: normal; width: 260px; line-height: 1.4; z-index: 30; transition: opacity .1s; pointer-events: none; }
    .has-tip:hover .tip { visibility: visible; opacity: 1; }
    .stype { font-weight:600; font-size:12.5px; padding:3px 10px; border-radius:6px; }
    .stype[data-t="Inpatient"]  { background: var(--teal-100); color: var(--teal-900); }
    .stype[data-t="Outpatient"] { background: var(--green-bg); color: var(--green-fg); }
    .stype[data-t="Behavioral"] { background: var(--amber-bg); color: var(--amber-fg); }
    .clickable { cursor: pointer; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .mb-4 { margin-bottom: 16px; }
    .mix-panel { position: relative; padding: 16px 20px; }
    .mix-panel:hover z-widget-actions { opacity: 1; }
    .mix-bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; margin: 10px 0 12px; background: var(--gray-100); }
    .mix-seg { cursor: pointer; transition: opacity .12s; }
    .mix-seg:hover { opacity: .85; }
    .mix-seg[data-tone="green"] { background: var(--green); }
    .mix-seg[data-tone="red"] { background: var(--red); }
    .mix-seg[data-tone="amber"] { background: var(--amber); }
    .mix-legend { display: flex; gap: 20px; flex-wrap: wrap; }
    .mix-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; padding: 2px 4px; border-radius: 4px; color: var(--ink-soft); }
    .mix-item:hover { background: var(--gray-100); }
    .mix-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .mix-item[data-tone="green"] .mix-dot { background: var(--green); }
    .mix-item[data-tone="red"] .mix-dot { background: var(--red); }
    .mix-item[data-tone="amber"] .mix-dot { background: var(--amber); }
    .mix-toggle { display: flex; gap: 6px; margin-left: auto; margin-right: 12px; }
    .seg-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: #fff;
      font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--gray-500); }
    .seg-btn.active { background: var(--ink); color: #fff; border-color: var(--ink); }
    .reason-rows { padding: 4px 20px 18px; display: flex; flex-direction: column; gap: 10px; }
    .reason-row { display: grid; grid-template-columns: minmax(200px, 460px) 1fr 90px; align-items: center; gap: 16px;
      cursor: pointer; padding: 6px 8px; border-radius: 6px; }
    .reason-row:hover { background: var(--gray-100); }
    .reason-code { font-family: monospace; font-weight: 700; color: var(--ink); margin-right: 8px; }
    .reason-cat { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px;
      border-radius: 4px; margin-right: 8px; font-weight: 600; }
    .reason-cat[data-cat="Admission"] { background: var(--blue-bg); color: var(--blue-fg); }
    .reason-cat[data-cat="Clinical"] { background: var(--teal-100); color: var(--teal-900); }
    .reason-cat[data-cat="Administrative"] { background: var(--amber-bg); color: var(--amber-fg); }
    .reason-bar-track { height: 8px; background: var(--gray-100); border-radius: 4px; overflow: hidden; }
    .reason-bar-fill { height: 100%; background: var(--teal-600); }
    .reason-count { text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--gray-500); }
    .reason-empty { color: var(--gray-500); font-size: 13px; padding: 8px; }
    .svc-filter { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: #fff;
      font-size: 12.5px; color: var(--ink-soft); margin-left: auto; margin-right: 12px; }
    .empty-row { text-align: center; color: var(--gray-500); padding: 20px; }
    .vol-link { color: var(--teal-700); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .vol-link:hover { color: var(--teal-900); }
  `],
})
export class ClinicalTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private exporter = inject(Exporter);
  readonly decKeys = ['dec.approved', 'dec.denied', 'dec.partial', 'dec.auto', 'dec.md', 'dec.p2p'];

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or a card's × ----
  readonly vis = new WidgetVisibility('zyter-um-clinical-widgets-v1', CLINICAL_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  /** Exports the real cases behind the tile's percentage (same set its own click-through drilldown
   *  shows) — not just the single headline number. */
  exportStat(s: { label: string; value: string }, key: string) {
    const cases = this.metrics.cases(key);
    this.exporter.open({
      title: s.label, name: `clinical-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}${TODAY_ISO}`,
      columns: COLUMNS, rows: cases.map(toRow),
    });
  }
  exportDrilldown() {
    this.exporter.open({
      title: 'Decision Drilldown by Service', name: `clinical-drilldown${TODAY_ISO}`,
      columns: ['Procedure', 'Service Type', 'Guideline', 'Approval Rate %', 'Volume'],
      rows: this.sortedRows().map((r) => [r.procedure, r.serviceType, r.guideline, r.approvalRate, r.volume]),
    });
  }

  // ---- shared top-bar filters — same treatment as every other converted tab ----
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }

  /** The 6 headline tiles — same liveDecisionStats() the global Export button reads, so the tile, its drilldown, and its export can never drift apart. */
  readonly decisionStats = computed(() => liveDecisionStats(...this.scopeArgs()));

  /** Approved/Denied/Partial as one visual mix (the 6 tiles above show each independently — this
   *  shows them as parts of one whole). Reuses decKeys[0..2] so its drill-through matches the tiles. */
  readonly decisionMix = computed(() => {
    const [lob, days] = this.scopeArgs();
    const cs = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, days));
    const total = cs.length || 1;
    const of = (d: string) => cs.filter((c) => c.decision === d).length;
    const approved = of('Approved'); const denied = of('Denied'); const partial = of('Partial');
    return [
      { label: 'Approved', count: approved, pct: Math.round((approved / total) * 100), tone: 'green' },
      { label: 'Denied', count: denied, pct: Math.round((denied / total) * 100), tone: 'red' },
      { label: 'Partial', count: partial, pct: Math.round((partial / total) * 100), tone: 'amber' },
    ];
  });
  exportMix() {
    const [lob, days] = this.scopeArgs();
    const cases = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, days));
    this.exporter.open({ title: 'Decision Mix', name: `clinical-decision-mix${TODAY_ISO}`, columns: COLUMNS, rows: cases.map(toRow) });
  }

  /** Full lifecycle status mix — pending queues collapse into their broader stage, decided cases
   *  keep their decision label, so this reads as one continuous funnel from Submitted to Determined. */
  readonly authStatusMix = computed(() => {
    const [lob, days] = this.scopeArgs();
    const cs = CASE_POOL.filter((c) => inScope(c, lob, days));
    const total = cs.length || 1;
    const counts = new Map<string, number>();
    cs.forEach((c) => { const s = authStatusOf(c); counts.set(s, (counts.get(s) ?? 0) + 1); });
    return AUTH_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0, pct: Math.round(((counts.get(status) ?? 0) / total) * 100) }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);
  });
  drillAuthStatus(status: string) {
    const [lob, days] = this.scopeArgs();
    const cases = CASE_POOL.filter((c) => inScope(c, lob, days) && authStatusOf(c) === status);
    this.ix.openExplorer({
      title: `Authorization Status — ${status}`,
      context: `${cases.length} authorization(s) currently ${status}`,
      columns: COLUMNS, rows: cases.map(toRow),
      exportName: `auth-status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${TODAY_ISO}`, memberColumn: 1,
    });
  }
  exportAuthStatus() {
    this.exporter.open({
      title: 'Authorization Status Mix', name: `clinical-auth-status-mix${TODAY_ISO}`,
      columns: ['Status', 'Count', '% of Total'],
      rows: this.authStatusMix().map((s) => [s.status, s.count, s.pct]),
    });
  }

  /** Primary diagnosis behind every authorization — correlated with procedure (dxOf), ranked by
   *  volume across the same LOB/Lookback scope as the rest of this tab. */
  readonly diagnosisMix = computed(() => {
    const [lob, days] = this.scopeArgs();
    const cs = CASE_POOL.filter((c) => inScope(c, lob, days));
    const total = cs.length || 1;
    const byCode = new Map<string, { description: string; count: number }>();
    cs.forEach((c) => {
      const dx = dxOf(c);
      const cur = byCode.get(dx.code);
      if (cur) cur.count++; else byCode.set(dx.code, { description: dx.description, count: 1 });
    });
    return [...byCode.entries()].map(([code, v]) => ({ code, description: v.description, count: v.count, pct: Math.round((v.count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
  });
  drillDiagnosis(code: string) {
    const [lob, days] = this.scopeArgs();
    const cases = CASE_POOL.filter((c) => inScope(c, lob, days) && dxOf(c).code === code);
    const description = this.diagnosisMix().find((d) => d.code === code)?.description ?? '';
    this.ix.openExplorer({
      title: `Diagnosis — ${code}`,
      context: `${cases.length} authorization(s) coded ${code} (${description})`,
      columns: COLUMNS, rows: cases.map(toRow),
      exportName: `diagnosis-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${TODAY_ISO}`, memberColumn: 1,
    });
  }
  exportDiagnosisMix() {
    this.exporter.open({
      title: 'Diagnosis Mix', name: `clinical-diagnosis-mix${TODAY_ISO}`,
      columns: ['Diagnosis Code', 'Description', 'Count', '% of Total'],
      rows: this.diagnosisMix().map((d) => [d.code, d.description, d.count, d.pct]),
    });
  }

  /** Reason Codes by Outcome — a drill-down of the Decision Mix above: pick one of its three
   *  outcomes and see the real reason-code breakdown behind it, matching the real UM workflow
   *  where every determination requires a reason code. */
  readonly mixOutcome = signal<DeterminationOutcome>('Denied');
  readonly reasonMix = computed(() => liveDeterminationMix(this.mixOutcome(), ...this.scopeArgs()));
  drillReason(row: DeterminationMixRow) {
    const [lob, days] = this.scopeArgs();
    const cases = liveDeterminationCases(this.mixOutcome(), row.code, lob, days);
    this.ix.openExplorer({
      title: `${row.code} · ${row.label}`,
      context: `${cases.length} ${this.mixOutcome().toLowerCase()} decision(s) coded ${row.code} (${row.pct}% of ${this.mixOutcome().toLowerCase()} decisions)`,
      columns: COLUMNS, rows: cases.map(toRow),
      exportName: `determination-${row.code.toLowerCase()}${TODAY_ISO}`, memberColumn: 1,
    });
  }
  exportReasonMix() {
    const [lob, days] = this.scopeArgs();
    const outcome = this.mixOutcome();
    const cases = CASE_POOL.filter((c) => c.phase === 'decided' && c.decision === outcome && inScope(c, lob, days));
    this.exporter.open({
      title: `Reason Codes by Outcome — ${outcome}`, name: `determination-mix-${outcome.toLowerCase()}${TODAY_ISO}`,
      columns: [...COLUMNS, 'Reason Code'],
      rows: cases.map((c) => [...toRow(c), determinationReasonOf(c)?.label ?? '—']),
    });
  }

  /** Per-procedure approval rate + volume — same liveDecisionRows() the global Export button reads. */
  readonly decisionRows = computed(() => liveDecisionRows(...this.scopeArgs()));

  readonly serviceTypeFilter = signal<'all' | 'Inpatient' | 'Outpatient' | 'Behavioral'>('all');
  readonly filteredRows = computed(() => {
    const f = this.serviceTypeFilter();
    const rows = this.decisionRows();
    return f === 'all' ? rows : rows.filter((r) => r.serviceType === f);
  });

  readonly sortKey = signal<keyof DecisionRow | ''>('');
  readonly sortDir = signal<SortDir>(1);
  readonly sortedRows = computed(() => compareRows(this.filteredRows(), this.sortKey(), this.sortDir()));
  sortBy(k: keyof DecisionRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(1); }
  }
  caret(k: keyof DecisionRow) { return caretFor(this.sortKey(), k, this.sortDir()); }
  guidelineDetail(guideline: string): string { return GUIDELINE_DETAIL[guideline] ?? ''; }

  open(r: DecisionRow) {
    this.ix.openDrawer({
      title: r.procedure,
      subtitle: `${r.serviceType} · ${r.guideline}`,
      badge: { text: `${r.approvalRate}% approval`, tone: r.approvalRate >= 80 ? 'green' : 'amber' },
      fields: [
        { label: 'Service Type', value: r.serviceType },
        { label: 'Guideline', value: r.guideline },
        { label: 'Approval Rate', value: `${r.approvalRate}%`, tone: r.approvalRate >= 80 ? 'green' : 'amber' },
        { label: 'Volume (MTD)', value: String(r.volume) },
        { label: 'Denials (est.)', value: String(Math.round(r.volume * (1 - r.approvalRate / 100))) },
      ],
      note: r.approvalRate < 75
        ? 'Approval rate is below the service-line benchmark. Review recent denials for guideline-application consistency.'
        : 'Approval rate is tracking in line with the service-line benchmark.',
      actions: [{ label: 'View decision log', tone: 'teal',
        run: () => this.openDecisionLog(r) }],
    });
  }

  /** Every decided case for this procedure, with the nurse reviewer who handled it, the MD reviewer
   *  tied to the determination (only populated for cases that actually required MD/peer-to-peer
   *  review; Reviewer is '—' for auto-approved cases), and the criteria review outcome behind it. */
  openDecisionLog(r: DecisionRow) {
    const [lob, days] = this.scopeArgs();
    const cases = CASE_POOL.filter((c) => c.phase === 'decided' && c.procedure === r.procedure && inScope(c, lob, days));
    this.ix.openExplorer({
      title: `${r.procedure} — Decision Log`,
      context: `${cases.length} decision(s) for ${r.procedure} · ${r.approvalRate}% approval rate`,
      columns: ['Auth ID', 'Member', 'Decision', 'Criteria Met', 'Reason Code', 'Reviewer', 'MD Reviewer', 'Provider', 'Urgency', 'Submitted', 'TAT (h)', 'Est. Cost'],
      rows: cases.map((c) => {
        const cs = criteriaStatusOf(c);
        return [c.authId, c.member, c.decision, `${cs.met}/${cs.total}`, determinationReasonOf(c)?.code ?? '—', c.nurse, mdReviewerOf(c) ?? '—', c.provider, urgencyOf(c), c.submitted, c.tatH, `$${c.cost.toLocaleString()}`];
      }),
      exportName: `decision-log-${r.procedure.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${TODAY_ISO}`,
      memberColumn: 1,
    });
  }
}
