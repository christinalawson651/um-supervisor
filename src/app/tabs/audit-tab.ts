import { TODAY_ISO } from '../data/case-fields';
import { Component, computed, inject } from '@angular/core';
import { DashboardData, liveComplianceBars, liveIrrReviews, liveIrrByReviewer, liveIrrDiscrepancyReasons, liveIrrCorrectiveActions, liveRegCompliance, regBreachesFor, inScope } from '../data/dashboard-data';
import { IrrReviewRecord, DiscrepancyReason, IRR_TARGET_PCT, MIN_SAMPLE_PER_REVIEWER } from '../data/um-irr';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { Exporter } from '../shared/exporter';
import { AuditFlag } from '../data/dashboard.models';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { COLUMNS, toRow } from '../shared/metrics';

const AUDIT_WIDGETS = [
  { id: 'quality', title: 'Internal Quality' },
  { id: 'irr', title: 'Inter-Rater Reliability' },
  { id: 'irrByReviewer', title: 'IRR Agreement by Reviewer' },
  { id: 'irrReasons', title: 'IRR Discrepancy Reasons' },
  { id: 'irrActions', title: 'IRR Corrective Actions' },
  { id: 'regTat', title: 'Regulatory TAT Compliance by Program' },
  { id: 'audit-flags', title: 'Audit Flags' },
];

const REG_TARGET_PCT = 90;
const IRR_COLUMNS = ['Auth', 'Reviewer', 'Original Decision', 'Review Date', 'Auditor', 'IRR Review Date', 'IRR Determination', 'Agree', 'Discrepancy Reason', 'Corrective Action', 'Status', 'Action Date'];
function irrRow(r: IrrReviewRecord): (string | number)[] {
  return [r.authId, r.reviewer, r.originalDecision, r.reviewDate, r.auditor, r.irrReviewDate, r.irrDetermination, r.agree ? 'Yes' : 'No', r.discrepancyReason ?? '—', r.correctiveAction, r.correctiveActionStatus ?? '—', r.correctiveActionDate ?? '—'];
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-audit-tab',
  standalone: true,
  imports: [WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Audit &amp; Compliance</h2>
      <span class="section-note">Internal quality review and regulatory compliance evidence — click a tile to drill in</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('quality')) {
    <div class="panel">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Internal Quality</h3>
        <z-widget-actions (exportClick)="exportQuality()" (removeClick)="hide('quality')"></z-widget-actions>
      </div>
      <div class="tile-row panel-pad">
        @for (b of complianceBars(); track b.label; let i = $index) {
          <div class="tile" (click)="metrics.open(barKeys[i])">
            <div class="tile-val">{{ b.pct }}%</div>
            <div class="tile-lab">{{ b.label }}</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('irr')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Inter-Rater Reliability (IRR)</h3>
        <span class="section-note sm">{{ irrTarget }}% agreement is this org's own policy target — NCQA/URAC require a defined, followed methodology, not one universal number</span>
        <z-widget-actions (exportClick)="exportIrr()" (removeClick)="hide('irr')"></z-widget-actions>
      </div>
      <div class="tile-row irr-row panel-pad">
        <div class="tile" (click)="drillIrrAll()">
          <div class="tile-val">{{ irrAgreementRate() }}%</div>
          <div class="tile-lab">IRR Agreement Rate</div>
        </div>
        <div class="tile" (click)="drillReviewersBelow()">
          <div class="tile-ic" [class.hot]="reviewersBelowThreshold() > 0"></div>
          <div class="tile-val">{{ reviewersBelowThreshold() }}</div>
          <div class="tile-lab">Reviewers Below {{ irrTarget }}% Threshold</div>
        </div>
        <div class="tile" (click)="drillInsufficientSample()">
          <div class="tile-val">{{ reviewersInsufficientSample() }}</div>
          <div class="tile-lab">Reviewers — Insufficient Sample (&lt;{{ minSample }})</div>
        </div>
        <div class="tile" (click)="drillDenialSample()">
          <div class="tile-val">{{ denialSampleCoverage() }}%</div>
          <div class="tile-lab">Denial/Partial Sample Coverage</div>
        </div>
        <div class="tile" (click)="drillOpenActions()">
          <div class="tile-ic" [class.hot]="openCorrectiveActions() > 0"></div>
          <div class="tile-val">{{ openCorrectiveActions() }}</div>
          <div class="tile-lab">Open Corrective Actions</div>
        </div>
      </div>
    </div>
    }

    @if (!isHidden('irrByReviewer')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">IRR Agreement by Reviewer</h3>
        <z-widget-actions (exportClick)="exportIrrByReviewer()" (removeClick)="hide('irrByReviewer')"></z-widget-actions>
      </div>
      <div class="ilist">
        @for (r of irrByReviewer(); track r.reviewer) {
          <div class="irow clk" (click)="drillReviewer(r.reviewer)">
            <div class="ilab">{{ r.reviewer }}</div>
            @if (r.adequate) {
              <div class="ibar-track"><div class="ibar-fill" [class.amber]="r.pct < irrTarget" [class.teal]="r.pct >= irrTarget" [style.width.%]="r.pct"></div></div>
              <div class="icount">{{ r.agree }}/{{ r.sampled }} · {{ r.pct }}%</div>
            } @else {
              <div class="ibar-track"><div class="ibar-fill gray" style="width:100%"></div></div>
              <div class="icount muted">n={{ r.sampled }} · insufficient</div>
            }
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('irrReasons')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">IRR Discrepancy Reasons</h3>
        <span class="section-note sm">Why the sampled disagreements happened — the part that actually drives training/criteria fixes</span>
        <z-widget-actions (exportClick)="exportIrrReasons()" (removeClick)="hide('irrReasons')"></z-widget-actions>
      </div>
      <div class="ilist">
        @for (r of irrReasons(); track r.reason) {
          <div class="irow clk" (click)="drillReason(r.reason)">
            <div class="ilab">{{ r.reason }}</div>
            <div class="ibar-track"><div class="ibar-fill amber" [style.width.%]="reasonPct(r.count)"></div></div>
            <div class="icount">{{ r.count }} · {{ reasonPct(r.count) }}%</div>
          </div>
        } @empty { <div class="empty">No disagreements sampled in this window.</div> }
      </div>
    </div>
    }

    @if (!isHidden('irrActions')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">IRR Corrective Actions</h3>
        <span class="section-note sm">Every disagreement that escalated into coaching or retraining — evidence the loop closes</span>
        <z-widget-actions (exportClick)="exportIrrActions()" (removeClick)="hide('irrActions')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead><tr><th>Reviewer</th><th>Discrepancy Reason</th><th>Corrective Action</th><th>Status</th><th>Action Date</th></tr></thead>
        <tbody>
          @for (a of irrActions(); track a.authId) {
            <tr class="clickable" (click)="drillAction(a)">
              <td class="strong">{{ a.reviewer }}</td>
              <td>{{ a.discrepancyReason }}</td>
              <td>{{ a.correctiveAction }}</td>
              <td><span class="badge" [class.amber]="a.correctiveActionStatus==='Open'" [class.green]="a.correctiveActionStatus==='Closed'">{{ a.correctiveActionStatus }}</span></td>
              <td>{{ a.correctiveActionDate }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="empty">No corrective actions in this window.</td></tr> }
        </tbody>
      </table>
    </div>
    }

    @if (!isHidden('regTat')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Regulatory TAT Compliance by Program</h3>
        <span class="section-note sm">Standard decision window / expedited window, per program's own statutory requirement</span>
        <z-widget-actions (exportClick)="exportRegTat()" (removeClick)="hide('regTat')"></z-widget-actions>
      </div>
      <div class="tile-row kpi-row panel-pad no-bottom">
        <div class="tile" (click)="drillProgramsBelow()">
          <div class="tile-ic" [class.hot]="programsBelow() > 0"></div>
          <div class="tile-val">{{ programsBelow() }}</div>
          <div class="tile-lab">Programs Below {{ regTarget }}% Target</div>
        </div>
      </div>
      <div class="ilist">
        @for (r of regCompliance(); track r.lob) {
          <div class="irow clk" (click)="drillLob(r.lob)">
            <div class="ilab">{{ r.lob }}<span class="cite">{{ r.standardDays }}d / {{ r.expeditedHours }}h · {{ r.citation }}</span></div>
            <div class="ibar-track"><div class="ibar-fill" [class.amber]="r.pct < regTarget" [class.teal]="r.pct >= regTarget" [style.width.%]="r.pct"></div></div>
            <div class="icount">{{ r.compliant }}/{{ r.total }} · {{ r.pct }}%</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('audit-flags')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Audit Flags</h3>
        <z-widget-actions (exportClick)="exportFlags()" (removeClick)="hide('audit-flags')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr><th>ID</th><th>Type</th><th>Description</th><th>Date</th><th>Severity</th></tr>
        </thead>
        <tbody>
          @for (f of data.auditFlags(); track f.id) {
            <tr class="clickable" (click)="open(f)">
              <td class="strong">{{ f.id }}</td>
              <td>{{ f.type }}</td>
              <td>{{ f.description }}</td>
              <td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.severity==='red'"
                    [class.amber]="f.severity==='amber'"
                    [class.green]="f.severity==='green'">{{ f.severityLabel }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">No open audit flags — all resolved. ✓</td></tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .tbl-head { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tbl-head:hover z-widget-actions { opacity: 1; }
    .panel-title { margin-right: auto; }
    .section-note.sm { font-size: 12px; margin-right: auto; }

    .tile-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .kpi-row { grid-template-columns: repeat(3, 1fr); }
    .irr-row { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .tile-row.no-bottom { padding-bottom: 4px; }
    .tile {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px;
      cursor: pointer; background: #fff; transition: border-color .15s, box-shadow .15s;
    }
    .tile:hover { box-shadow: var(--shadow); }
    .tile-ic.hot { width: 10px; height: 10px; border-radius: 999px; background: var(--amber); }
    .tile-val { font-size: 22px; font-weight: 700; color: var(--ink); }
    .tile-lab { font-size: 11px; color: var(--gray-500); font-weight: 600; line-height: 1.3; }

    .ilist { padding: 6px 20px 20px; display: flex; flex-direction: column; gap: 8px; }
    .irow { display: grid; grid-template-columns: minmax(140px, 220px) 1fr 90px; align-items: center; gap: 14px;
      padding: 6px 8px; border-radius: 8px; }
    .irow.clk { cursor: pointer; }
    .irow.clk:hover { background: var(--gray-100); }
    .ilab { font-size: 13px; color: var(--ink); font-weight: 500; display: flex; flex-direction: column; }
    .cite { font-size: 10.5px; color: var(--gray-500); font-weight: 600; margin-top: 1px; }
    .ibar-track { height: 8px; background: var(--gray-100); border-radius: 4px; overflow: hidden; }
    .ibar-fill { height: 100%; border-radius: 4px; }
    .ibar-fill.teal { background: var(--teal-600); }
    .ibar-fill.amber { background: var(--amber); }
    .ibar-fill.gray { background: var(--gray-300); }
    .icount { text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--gray-500); }
    .icount.muted { font-style: italic; }

    .clickable { cursor: pointer; }
    .empty { text-align:center; color: var(--teal-700); font-weight:600; padding: 26px; }
  `],
})
export class AuditTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  readonly barKeys = ['audit.doc', 'audit.guideline', 'audit.rationale'];
  readonly regTarget = REG_TARGET_PCT;
  readonly irrTarget = IRR_TARGET_PCT;
  readonly minSample = MIN_SAMPLE_PER_REVIEWER;

  readonly vis = new WidgetVisibility('zyter-um-audit-widgets-v2', AUDIT_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }
  private withinDays(): number | undefined {
    const period = this.lookback.period();
    return period === '30d' ? undefined : this.lookback.windowDays();
  }

  readonly complianceBars = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveComplianceBars(lob, days);
  });

  // ---- Inter-Rater Reliability ----
  readonly irrSample = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveIrrReviews(lob, days);
  });
  readonly irrAgreementRate = computed(() => {
    const s = this.irrSample();
    return s.length ? Math.round((s.filter((r) => r.agree).length / s.length) * 100) : 0;
  });
  readonly irrByReviewer = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveIrrByReviewer(lob, days);
  });
  readonly reviewersBelowThreshold = computed(() => this.irrByReviewer().filter((r) => r.adequate && r.pct < this.irrTarget).length);
  readonly reviewersInsufficientSample = computed(() => this.irrByReviewer().filter((r) => !r.adequate).length);
  readonly irrReasons = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveIrrDiscrepancyReasons(lob, days);
  });
  readonly irrActions = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveIrrCorrectiveActions(lob, days);
  });
  readonly openCorrectiveActions = computed(() => this.irrActions().filter((a) => a.correctiveActionStatus === 'Open').length);
  readonly denialSampleCoverage = computed(() => {
    const [lob, days] = this.scopeArgs();
    const allDenials = CASE_POOL.filter((c) => c.phase === 'decided' && (c.decision === 'Denied' || c.decision === 'Partial') && inScope(c, lob, days));
    const sampled = this.irrSample().filter((r) => r.originalDecision === 'Denied' || r.originalDecision === 'Partial');
    return allDenials.length ? Math.round((sampled.length / allDenials.length) * 100) : 0;
  });
  reasonPct(count: number): number {
    const total = this.irrReasons().reduce((s, r) => s + r.count, 0);
    return total ? Math.round((count / total) * 100) : 0;
  }

  // ---- Regulatory TAT compliance by program ----
  readonly regCompliance = computed(() => liveRegCompliance(this.withinDays()));
  readonly programsBelow = computed(() => this.regCompliance().filter((r) => r.pct < this.regTarget).length);

  private casesByAuthIds(ids: Set<string>): CaseRec[] {
    const [lob, days] = this.scopeArgs();
    return CASE_POOL.filter((c) => ids.has(c.authId) && inScope(c, lob, days));
  }
  private openCases(title: string, cs: CaseRec[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${cs.length} authorization(s)`,
      columns: COLUMNS, rows: cs.map(toRow),
      exportName: `audit-${exportSlug}${TODAY_ISO}`, memberColumn: 1,
    });
  }
  /** IRR review records get their own column set (auditor, redetermination, discrepancy reason,
   *  corrective action) — a real audit-log view, not just the generic case columns. Column 0 is
   *  deliberately 'Auth' (not 'Auth ID') so Explorer treats this as an informational list — no
   *  Reassign/Balance/Escalate, which don't make sense against a compliance record. */
  private openIrr(title: string, rs: IrrReviewRecord[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${rs.length} IRR review(s)`,
      columns: IRR_COLUMNS, rows: rs.map(irrRow),
      exportName: `audit-${exportSlug}${TODAY_ISO}`,
    });
  }

  drillIrrAll() { this.openIrr('IRR-Sampled Decisions', this.irrSample(), 'irr-sample', `${this.irrSample().length} decision(s) sampled for Inter-Rater Reliability review`); }
  drillReviewer(reviewer: string) { this.openIrr(`IRR Sample — ${reviewer}`, this.irrSample().filter((r) => r.reviewer === reviewer), `irr-${slug(reviewer)}`); }
  drillReviewersBelow() {
    const names = new Set(this.irrByReviewer().filter((r) => r.adequate && r.pct < this.irrTarget).map((r) => r.reviewer));
    this.openIrr('IRR Sample — Reviewers Below Threshold', this.irrSample().filter((r) => names.has(r.reviewer)), 'irr-below-threshold');
  }
  drillInsufficientSample() {
    const names = new Set(this.irrByReviewer().filter((r) => !r.adequate).map((r) => r.reviewer));
    this.openIrr('IRR Sample — Insufficient Sample Size', this.irrSample().filter((r) => names.has(r.reviewer)), 'irr-insufficient', `Fewer than ${this.minSample} sampled decisions — not enough to report pass/fail`);
  }
  drillDenialSample() {
    const [lob, days] = this.scopeArgs();
    const cs = CASE_POOL.filter((c) => c.phase === 'decided' && (c.decision === 'Denied' || c.decision === 'Partial') && inScope(c, lob, days));
    this.openCases('Denials & Partial Approvals', cs, 'denials-partials', `${cs.length} denial/partial decision(s) — IRR-sampled subset shown via the icons noted on export`);
  }
  drillReason(reason: DiscrepancyReason) { this.openIrr(`IRR Discrepancies — ${reason}`, this.irrSample().filter((r) => r.discrepancyReason === reason), `irr-reason-${slug(reason)}`); }
  drillOpenActions() { this.openIrr('Open Corrective Actions', this.irrActions().filter((a) => a.correctiveActionStatus === 'Open'), 'irr-actions-open'); }
  drillAction(a: IrrReviewRecord) { this.openIrr(`Corrective Action — ${a.reviewer}`, [a], `irr-action-${slug(a.authId)}`); }

  drillLob(lob: string) {
    const cs = regBreachesFor(lob, this.withinDays());
    this.openCases(`${lob} — Regulatory TAT Breaches`, cs, `reg-${slug(lob)}`, `${cs.length} decision(s) exceeded ${lob}'s regulatory decision window`);
  }
  drillProgramsBelow() {
    const below = this.regCompliance().filter((r) => r.pct < this.regTarget).map((r) => r.lob);
    const cs = below.flatMap((lob) => regBreachesFor(lob, this.withinDays()));
    this.openCases('Regulatory TAT Breaches — Programs Below Target', cs, 'reg-below-target');
  }

  exportQuality() {
    this.exporter.open({
      title: 'Internal Quality', name: `audit-internal-quality${TODAY_ISO}`,
      columns: ['Metric', 'Value'], rows: this.complianceBars().map((b) => [b.label, `${b.pct}%`]),
    });
  }
  exportIrr() {
    this.exporter.open({
      title: 'Inter-Rater Reliability', name: `audit-irr${TODAY_ISO}`,
      columns: ['Metric', 'Value'],
      rows: [
        ['IRR Agreement Rate', `${this.irrAgreementRate()}%`],
        ['Reviewers Below Threshold', this.reviewersBelowThreshold()],
        ['Reviewers — Insufficient Sample', this.reviewersInsufficientSample()],
        ['Denial/Partial Sample Coverage', `${this.denialSampleCoverage()}%`],
        ['Open Corrective Actions', this.openCorrectiveActions()],
      ],
    });
  }
  exportIrrByReviewer() {
    this.exporter.open({
      title: 'IRR Agreement by Reviewer', name: `audit-irr-by-reviewer${TODAY_ISO}`,
      columns: ['Reviewer', 'Agreements', 'Sampled', 'Agreement Rate %', 'Sample Adequate'],
      rows: this.irrByReviewer().map((r) => [r.reviewer, r.agree, r.sampled, r.pct, r.adequate ? 'Yes' : 'No']),
    });
  }
  exportIrrReasons() {
    this.exporter.open({
      title: 'IRR Discrepancy Reasons', name: `audit-irr-reasons${TODAY_ISO}`,
      columns: ['Reason', 'Count', '% of Disagreements'],
      rows: this.irrReasons().map((r) => [r.reason, r.count, this.reasonPct(r.count)]),
    });
  }
  exportIrrActions() {
    this.exporter.open({
      title: 'IRR Corrective Actions', name: `audit-irr-actions${TODAY_ISO}`,
      columns: ['Reviewer', 'Auth', 'Discrepancy Reason', 'Corrective Action', 'Status', 'Action Date'],
      rows: this.irrActions().map((a) => [a.reviewer, a.authId, a.discrepancyReason ?? '—', a.correctiveAction, a.correctiveActionStatus ?? '—', a.correctiveActionDate ?? '—']),
    });
  }
  exportRegTat() {
    this.exporter.open({
      title: 'Regulatory TAT Compliance by Program', name: `audit-reg-tat${TODAY_ISO}`,
      columns: ['Program', 'Standard Window (days)', 'Expedited Window (hours)', 'Citation', 'Compliant', 'Total', 'Compliance %'],
      rows: this.regCompliance().map((r) => [r.lob, r.standardDays, r.expeditedHours, r.citation, r.compliant, r.total, r.pct]),
    });
  }
  exportFlags() {
    this.exporter.open({
      title: 'Audit Flags', name: `audit-flags${TODAY_ISO}`,
      columns: ['ID', 'Type', 'Description', 'Date', 'Severity'],
      rows: this.data.auditFlags().map((f) => [f.id, f.type, f.description, f.date, f.severityLabel]),
    });
  }

  open(f: AuditFlag) {
    this.ix.openDrawer({
      title: `${f.id} · ${f.type}`,
      subtitle: `Flagged ${f.date}`,
      badge: { text: `${f.severityLabel} severity`, tone: f.severity as any },
      fields: [
        { label: 'Flag ID', value: f.id },
        { label: 'Type', value: f.type },
        { label: 'Date', value: f.date },
        { label: 'Severity', value: f.severityLabel, tone: f.severity as any },
      ],
      note: f.description,
      actions: [{
        label: 'Mark as resolved', tone: 'teal',
        run: () => {
          this.data.resolveAuditFlag(f.id);
          this.ix.toast(`Audit flag ${f.id} marked resolved.`);
          this.data.addHistory('check', 'Audit flag resolved', `${f.id} — ${f.type}`);
        },
      }],
    });
  }
}
