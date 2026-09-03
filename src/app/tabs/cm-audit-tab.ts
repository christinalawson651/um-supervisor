import { Component, computed, inject } from '@angular/core';
import { CmData, CM_COLUMNS, cmToRow } from '../shared/cm-data';
import { CmCaseRec } from '../data/cm-case-pool';
import {
  CM_FILE_AUDITS, CmFileAuditRecord, CmAuditElement, CM_AUDIT_ELEMENTS, CmDiscrepancyReason, CM_DISCREPANCY_REASONS,
  CM_AUDIT_PASS_PCT, CM_IRR_TARGET_PCT, MIN_FILES_PER_CM, scoreElements,
  cmRegCompliance, cmRegBreachesFor, cmRegElapsed,
} from '../data/cm-audit';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { daysAgo } from '../data/case-fields';

const CM_AUDIT_WIDGETS = [
  { id: 'quality', title: 'Documentation Quality' },
  { id: 'fileAudit', title: 'File Audit (Chart Review)' },
  { id: 'byManager', title: 'Pass Rate by Care Manager' },
  { id: 'elements', title: 'Rubric Element Findings' },
  { id: 'irr', title: 'Inter-Rater Reliability' },
  { id: 'regCompliance', title: 'Regulatory Compliance by Program' },
  { id: 'actions', title: 'Corrective Actions' },
  { id: 'flags', title: 'Audit Flags' },
];

const REG_TARGET_PCT = 90;

const AUDIT_COLUMNS = ['Member', 'Member ID#', 'LOB', 'Care Manager', 'Auditor', 'Audit Date', 'Score', 'Result', 'Failed Elements', 'Finding', 'Corrective Action', 'Status', 'Action Date'];
function auditRow(r: CmFileAuditRecord): (string | number)[] {
  return [r.member, r.memberId, r.lob, r.careManager, r.auditor, r.auditDate, `${r.score}%`, r.pass ? 'Pass' : 'Fail',
    r.failedElements.join('; ') || '—', r.discrepancyReason ?? '—', r.correctiveAction, r.correctiveActionStatus ?? '—', r.correctiveActionDate ?? '—'];
}
const IRR_COLUMNS = ['Member', 'Member ID#', 'Care Manager', 'Primary Auditor', 'Primary Score', 'Primary Result', 'Second Auditor', 'Rescore', 'Rescore Result', 'Agree'];
function irrRow(r: CmFileAuditRecord): (string | number)[] {
  return [r.member, r.memberId, r.careManager, r.auditor, `${r.score}%`, r.pass ? 'Pass' : 'Fail',
    r.irrAuditor ?? '—', r.irrScore === null ? '—' : `${r.irrScore}%`, r.irrPass === null ? '—' : r.irrPass ? 'Pass' : 'Fail', r.irrAgree ? 'Yes' : 'No'];
}
const REG_COLUMNS = ['Member ID', 'Member', 'LOB', 'Care Manager', 'Program', 'Assessment Days', 'Assessment Window', 'Care Plan Days', 'Care Plan Window', 'Breach'];
function regRow(c: CmCaseRec): (string | number)[] {
  const e = cmRegElapsed(c);
  const breaches: string[] = [];
  if (e.rule && e.assessment > e.rule.assessmentDays) breaches.push('Assessment');
  if (e.rule && e.carePlan > e.rule.carePlanDays) breaches.push('Care Plan');
  return [c.memberId, c.member, c.lob, c.careManager, c.program, e.assessment, e.rule?.assessmentDays ?? '—', e.carePlan, e.rule?.carePlanDays ?? '—', breaches.join(' + ') || '—'];
}

/** A live compliance exception on a member record — replaces the four hand-typed flag rows the
 *  CM Audit tab used to render. Every flag points at a real case, so it can be drilled into. */
interface CmAuditFlag {
  id: string; type: string; description: string; date: string;
  severity: 'red' | 'amber' | 'green'; severityLabel: string;
  member: string; memberId: string; careManager: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-cm-audit-tab',
  standalone: true,
  imports: [WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Audit &amp; Compliance</h2>
      <span class="section-note">Documentation file review and regulatory compliance evidence — click a tile to drill in</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('quality')) {
    <div class="panel">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Documentation Quality</h3>
        <span class="section-note sm">Rubric compliance across the whole caseload, not just the audited sample — {{ scopedCases().length }} case(s) in scope</span>
        <z-widget-actions (exportClick)="exportQuality()" (removeClick)="hide('quality')"></z-widget-actions>
      </div>
      <div class="tile-row panel-pad">
        @for (e of elementCompliance(); track e.element) {
          <div class="tile" (click)="drillElementFailures(e.element)">
            <div class="tile-val">{{ e.pct }}%</div>
            <div class="tile-lab">{{ e.element }}</div>
            <div class="tile-sub">{{ e.met }}/{{ e.total }} met</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('fileAudit')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">File Audit (Chart Review)</h3>
        <span class="section-note sm">A QI reviewer pulls a sampled member record and scores it element-by-element; a file passes at {{ passTarget }}% of the rubric</span>
        <z-widget-actions (exportClick)="exportFileAudit()" (removeClick)="hide('fileAudit')"></z-widget-actions>
      </div>
      <div class="tile-row irr-row panel-pad">
        <div class="tile" (click)="drillAllAudits()">
          <div class="tile-val">{{ audits().length }}</div>
          <div class="tile-lab">Files Audited</div>
          <div class="tile-sub">{{ auditCoverage() }}% of caseload sampled</div>
        </div>
        <div class="tile" (click)="drillPassed()">
          <div class="tile-val">{{ passRate() }}%</div>
          <div class="tile-lab">File Pass Rate</div>
        </div>
        <div class="tile" (click)="drillFailed()">
          <div class="tile-ic" [class.hot]="failedAudits().length > 0"></div>
          <div class="tile-val">{{ failedAudits().length }}</div>
          <div class="tile-lab">Files Failing Review</div>
        </div>
        <div class="tile" (click)="drillManagersBelow()">
          <div class="tile-ic" [class.hot]="managersBelowTarget() > 0"></div>
          <div class="tile-val">{{ managersBelowTarget() }}</div>
          <div class="tile-lab">Care Managers Below {{ passTarget }}% Pass Rate</div>
        </div>
        <div class="tile" (click)="drillOpenActions()">
          <div class="tile-ic" [class.hot]="openActions() > 0"></div>
          <div class="tile-val">{{ openActions() }}</div>
          <div class="tile-lab">Open Corrective Actions</div>
        </div>
      </div>
    </div>
    }

    @if (!isHidden('byManager')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Pass Rate by Care Manager</h3>
        <span class="section-note sm">Fewer than {{ minFiles }} audited files is reported as insufficient sample, not as a pass/fail rate</span>
        <z-widget-actions (exportClick)="exportByManager()" (removeClick)="hide('byManager')"></z-widget-actions>
      </div>
      <div class="ilist">
        @for (m of byManager(); track m.careManager) {
          <div class="irow clk" (click)="drillManager(m.careManager)">
            <div class="ilab">{{ m.careManager }}</div>
            @if (m.adequate) {
              <div class="ibar-track"><div class="ibar-fill" [class.amber]="m.pct < passTarget" [class.teal]="m.pct >= passTarget" [style.width.%]="m.pct"></div></div>
              <div class="icount">{{ m.passed }}/{{ m.audited }} · {{ m.pct }}%</div>
            } @else {
              <div class="ibar-track"><div class="ibar-fill gray" style="width:100%"></div></div>
              <div class="icount muted">n={{ m.audited }} · insufficient</div>
            }
          </div>
        } @empty { <div class="empty">No files audited in this window.</div> }
      </div>
    </div>
    }

    @if (!isHidden('elements')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Rubric Element Findings</h3>
        <span class="section-note sm">Which rubric elements the audited files actually failed — the part that drives training and template fixes</span>
        <z-widget-actions (exportClick)="exportElements()" (removeClick)="hide('elements')"></z-widget-actions>
      </div>
      <div class="ilist">
        @for (f of elementFindings(); track f.element) {
          <div class="irow clk" (click)="drillAuditedElementFailures(f.element)">
            <div class="ilab">{{ f.element }}</div>
            <div class="ibar-track"><div class="ibar-fill amber" [style.width.%]="f.pct"></div></div>
            <div class="icount">{{ f.count }} · {{ f.pct }}%</div>
          </div>
        }
      </div>
      <div class="ilist tight">
        <div class="sub-head">Finding codes</div>
        @for (r of findingCodes(); track r.reason) {
          <div class="irow clk" (click)="drillFinding(r.reason)">
            <div class="ilab">{{ r.reason }}</div>
            <div class="ibar-track"><div class="ibar-fill amber" [style.width.%]="findingPct(r.count)"></div></div>
            <div class="icount">{{ r.count }} · {{ findingPct(r.count) }}%</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('irr')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Inter-Rater Reliability (IRR)</h3>
        <span class="section-note sm">A second QI reviewer blind-rescores a subset of the same files — this measures whether the RUBRIC is applied consistently, not whether the care manager was right. {{ irrTarget }}% is this org's own policy target.</span>
        <z-widget-actions (exportClick)="exportIrr()" (removeClick)="hide('irr')"></z-widget-actions>
      </div>
      <div class="tile-row kpi-row panel-pad">
        <div class="tile" (click)="drillRescored()">
          <div class="tile-val">{{ rescored().length }}</div>
          <div class="tile-lab">Files Blind-Rescored</div>
        </div>
        <div class="tile" (click)="drillRescored()">
          <div class="tile-ic" [class.hot]="irrAgreementRate() < irrTarget"></div>
          <div class="tile-val">{{ irrAgreementRate() }}%</div>
          <div class="tile-lab">Reviewer Agreement Rate</div>
        </div>
        <div class="tile" (click)="drillDisagreements()">
          <div class="tile-ic" [class.hot]="disagreements().length > 0"></div>
          <div class="tile-val">{{ disagreements().length }}</div>
          <div class="tile-lab">Scoring Disagreements</div>
        </div>
      </div>
      <div class="ilist">
        @for (a of irrByAuditor(); track a.auditor) {
          <div class="irow clk" (click)="drillAuditor(a.auditor)">
            <div class="ilab">{{ a.auditor }}</div>
            <div class="ibar-track"><div class="ibar-fill" [class.amber]="a.pct < irrTarget" [class.teal]="a.pct >= irrTarget" [style.width.%]="a.pct"></div></div>
            <div class="icount">{{ a.agree }}/{{ a.rescored }} · {{ a.pct }}%</div>
          </div>
        } @empty { <div class="empty">No files were blind-rescored in this window.</div> }
      </div>
    </div>
    }

    @if (!isHidden('regCompliance')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Regulatory Compliance by Program</h3>
        <span class="section-note sm">Initial assessment and individualized care plan completed inside each program's own required window — a member counts as compliant only if both clocks were met</span>
        <z-widget-actions (exportClick)="exportRegCompliance()" (removeClick)="hide('regCompliance')"></z-widget-actions>
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
          <div class="irow clk" (click)="drillRegLob(r.lob)">
            <div class="ilab">{{ r.lob }}<span class="cite">Assessment {{ r.assessmentDays }}d / Care plan {{ r.carePlanDays }}d · {{ r.citation }}</span></div>
            <div class="ibar-track"><div class="ibar-fill" [class.amber]="r.pct < regTarget" [class.teal]="r.pct >= regTarget" [style.width.%]="r.pct"></div></div>
            <div class="icount">{{ r.compliant }}/{{ r.total }} · {{ r.pct }}%</div>
          </div>
        }
      </div>
      <div class="foot-note panel-pad">Windows and citations are directional — Commercial PPO and ACA Exchange have no federal care-management clock, so those rows measure accreditation/plan policy. Validate exact subsections with Compliance before using this as survey evidence.</div>
    </div>
    }

    @if (!isHidden('actions')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Corrective Actions</h3>
        <span class="section-note sm">Every failed file that escalated into coaching or retraining — evidence the loop closes</span>
        <z-widget-actions (exportClick)="exportActions()" (removeClick)="hide('actions')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead><tr><th>Care Manager</th><th>Member</th><th>Finding</th><th>Corrective Action</th><th>Status</th><th>Action Date</th></tr></thead>
        <tbody>
          @for (a of correctiveActions(); track a.memberId) {
            <tr class="clickable" (click)="drillAction(a)">
              <td class="strong">{{ a.careManager }}</td>
              <td>{{ a.member }}</td>
              <td>{{ a.discrepancyReason }}</td>
              <td>{{ a.correctiveAction }}</td>
              <td><span class="badge" [class.amber]="a.correctiveActionStatus==='Open'" [class.green]="a.correctiveActionStatus==='Closed'">{{ a.correctiveActionStatus }}</span></td>
              <td>{{ a.correctiveActionDate }}</td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No corrective actions in this window.</td></tr> }
        </tbody>
      </table>
    </div>
    }

    @if (!isHidden('flags')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Audit Flags</h3>
        <span class="section-note sm">Live compliance exceptions on member records — each one points at the case that raised it</span>
        <z-widget-actions (exportClick)="exportFlags()" (removeClick)="hide('flags')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead><tr><th>ID</th><th>Type</th><th>Description</th><th>Care Manager</th><th>Date</th><th>Severity</th></tr></thead>
        <tbody>
          @for (f of flags(); track f.id) {
            <tr class="clickable" (click)="openFlag(f)">
              <td class="strong">{{ f.id }}</td>
              <td>{{ f.type }}</td>
              <td>{{ f.description }}</td>
              <td>{{ f.careManager }}</td>
              <td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.severity==='red'" [class.amber]="f.severity==='amber'" [class.green]="f.severity==='green'">{{ f.severityLabel }}</span></td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No open audit flags — all resolved. ✓</td></tr> }
        </tbody>
      </table>
      @if (flagOverflow() > 0) {
        <div class="foot-note panel-pad">Showing the {{ flags().length }} highest-severity exceptions — <a class="lnk" (click)="drillAllFlagged()">open all {{ flags().length + flagOverflow() }} flagged member records</a>.</div>
      }
    </div>
    }
  `,
  styles: [`
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .tbl-head { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tbl-head:hover z-widget-actions { opacity: 1; }
    .panel-title { margin-right: auto; }
    .section-note.sm { font-size: 12px; margin-right: auto; max-width: 780px; }

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
    .tile-sub { font-size: 10.5px; color: var(--gray-400, var(--gray-500)); }

    .ilist { padding: 6px 20px 20px; display: flex; flex-direction: column; gap: 8px; }
    .ilist.tight { padding-top: 0; }
    .sub-head { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gray-500); margin: 6px 0 2px; }
    .irow { display: grid; grid-template-columns: minmax(140px, 250px) 1fr 110px; align-items: center; gap: 14px;
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

    .foot-note { font-size: 11.5px; color: var(--gray-500); padding-top: 0; line-height: 1.5; }
    .lnk { color: var(--teal-700); font-weight: 600; cursor: pointer; text-decoration: underline; }
    .clickable { cursor: pointer; }
    .empty { text-align:center; color: var(--teal-700); font-weight:600; padding: 26px; }
  `],
})
export class CmAuditTab {
  private cmData = inject(CmData);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);

  readonly passTarget = CM_AUDIT_PASS_PCT;
  readonly irrTarget = CM_IRR_TARGET_PCT;
  readonly regTarget = REG_TARGET_PCT;
  readonly minFiles = MIN_FILES_PER_CM;

  readonly vis = new WidgetVisibility('zyter-cm-audit-widgets-v1', CM_AUDIT_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  /** LOB narrows the caseload; Lookback deliberately does not (a mature member's `received` date
   *  can be months old by design — the same reasoning CmDashboard.scopedCases() documents). */
  readonly scopedCases = computed(() => {
    const lob = this.lobFilter.value();
    return lob === 'all' ? this.cmData.cases() : this.cmData.cases().filter((c) => c.lob === lob);
  });

  /** Audits are scoped by LOB *and* by when the audit was performed — that's the one date on this
   *  tab a lookback window means something against. '30d' is the unfiltered baseline, same
   *  convention UM's Audit tab uses. */
  readonly audits = computed(() => {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    const days = period === '30d' ? undefined : this.lookback.windowDays();
    return CM_FILE_AUDITS.filter((r) =>
      (lob === 'all' || r.lob === lob) && (days === undefined || (daysAgo(r.auditDate) >= 0 && daysAgo(r.auditDate) <= days)));
  });

  // ---- Documentation quality across the whole caseload ----
  readonly elementCompliance = computed(() => {
    const cs = this.scopedCases();
    const scored = cs.map(scoreElements);
    return CM_AUDIT_ELEMENTS.map((element, i) => {
      const met = scored.filter((s) => s[i].met).length;
      return { element, met, total: cs.length, pct: cs.length ? Math.round((met / cs.length) * 100) : 0 };
    });
  });

  // ---- File audit rollups ----
  readonly passedAudits = computed(() => this.audits().filter((r) => r.pass));
  readonly failedAudits = computed(() => this.audits().filter((r) => !r.pass));
  readonly passRate = computed(() => { const a = this.audits(); return a.length ? Math.round((this.passedAudits().length / a.length) * 100) : 0; });
  readonly auditCoverage = computed(() => { const cs = this.scopedCases(); return cs.length ? Math.round((this.audits().length / cs.length) * 100) : 0; });
  readonly correctiveActions = computed(() => this.audits().filter((r) => r.correctiveAction !== 'None'));
  readonly openActions = computed(() => this.correctiveActions().filter((r) => r.correctiveActionStatus === 'Open').length);

  readonly byManager = computed(() => {
    const rs = this.audits();
    return [...new Set(rs.map((r) => r.careManager))]
      .map((careManager) => {
        const mine = rs.filter((r) => r.careManager === careManager);
        const passed = mine.filter((r) => r.pass).length;
        return { careManager, audited: mine.length, passed, pct: mine.length ? Math.round((passed / mine.length) * 100) : 0, adequate: mine.length >= MIN_FILES_PER_CM };
      })
      .sort((a, b) => a.pct - b.pct);
  });
  readonly managersBelowTarget = computed(() => this.byManager().filter((m) => m.adequate && m.pct < this.passTarget).length);

  readonly elementFindings = computed(() => {
    const rs = this.audits();
    return CM_AUDIT_ELEMENTS
      .map((element) => {
        const count = rs.filter((r) => r.failedElements.includes(element)).length;
        return { element, count, pct: rs.length ? Math.round((count / rs.length) * 100) : 0 };
      })
      .sort((a, b) => b.count - a.count);
  });
  readonly findingCodes = computed(() => {
    const failed = this.failedAudits();
    return CM_DISCREPANCY_REASONS.map((reason) => ({ reason, count: failed.filter((r) => r.discrepancyReason === reason).length }));
  });
  findingPct(count: number): number {
    const total = this.findingCodes().reduce((s, r) => s + r.count, 0);
    return total ? Math.round((count / total) * 100) : 0;
  }

  // ---- IRR ----
  readonly rescored = computed(() => this.audits().filter((r) => r.irrRescored));
  readonly disagreements = computed(() => this.rescored().filter((r) => !r.irrAgree));
  readonly irrAgreementRate = computed(() => { const rs = this.rescored(); return rs.length ? Math.round((rs.filter((r) => r.irrAgree).length / rs.length) * 100) : 0; });
  readonly irrByAuditor = computed(() => {
    const rs = this.rescored();
    return [...new Set(rs.map((r) => r.auditor))]
      .map((auditor) => {
        const mine = rs.filter((r) => r.auditor === auditor);
        const agree = mine.filter((r) => r.irrAgree).length;
        return { auditor, rescored: mine.length, agree, pct: mine.length ? Math.round((agree / mine.length) * 100) : 0 };
      })
      .sort((a, b) => a.pct - b.pct);
  });

  // ---- Regulatory ----
  readonly regCompliance = computed(() => cmRegCompliance(this.scopedCases()));
  readonly programsBelow = computed(() => this.regCompliance().filter((r) => r.pct < this.regTarget).length);

  // ---- Live audit flags ----
  private readonly allFlags = computed((): CmAuditFlag[] => {
    const out: CmAuditFlag[] = [];
    let n = 0;
    const id = () => `CMA-${(++n + 300).toString()}`;
    this.scopedCases().forEach((c) => {
      const overdueReview = -daysAgo(c.carePlanReviewDate);
      if (daysAgo(c.consentExpiresDate) > 0) {
        out.push({ id: id(), type: 'Consent Expired', description: `Member consent lapsed ${daysAgo(c.consentExpiresDate)} day(s) ago (${c.consentType}) — ${c.member}`, date: c.consentExpiresDate, severity: 'red', severityLabel: 'High', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
      if (c.carePlanStatus === 'Open' && overdueReview < 0) {
        const late = -overdueReview;
        out.push({ id: id(), type: 'Reassessment Overdue', description: `Care plan review ${late} day(s) past due — ${c.member}`, date: c.carePlanReviewDate, severity: late > 7 ? 'red' : 'amber', severityLabel: late > 7 ? 'High' : 'Medium', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
      if (c.carePlanStatus === 'Open' && c.goals.length === 0) {
        out.push({ id: id(), type: 'No Goals Documented', description: `Open care plan with no documented goals — ${c.member}`, date: c.carePlanOpenedDate, severity: 'amber', severityLabel: 'Medium', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
      const uncovered = c.goals.filter((g) => g.interventionStatus === 'None').length;
      if (uncovered > 0) {
        out.push({ id: id(), type: 'Goal Without Intervention', description: `${uncovered} goal(s) carry no intervention — ${c.member}`, date: c.carePlanOpenedDate, severity: 'amber', severityLabel: 'Medium', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
      if (!c.outreachSuccessful && !c.utrLetterSent) {
        out.push({ id: id(), type: 'Unable to Reach — No UTR Letter', description: `${c.outreachAttempts} failed outreach attempt(s), no unable-to-reach letter on file — ${c.member}`, date: c.received, severity: 'amber', severityLabel: 'Medium', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
      if (!c.memberParticipation) {
        out.push({ id: id(), type: 'Participation Not Documented', description: `No documented member agreement or participation on the care plan — ${c.member}`, date: c.carePlanOpenedDate, severity: 'green', severityLabel: 'Low', member: c.member, memberId: c.memberId, careManager: c.careManager });
      }
    });
    const rank = { red: 0, amber: 1, green: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date));
  });
  /** The table shows the worst 25 — the full set is one click away rather than a 400-row scroll. */
  readonly flags = computed(() => this.allFlags().slice(0, 25));
  readonly flagOverflow = computed(() => Math.max(0, this.allFlags().length - 25));

  // ---- drill-downs ----
  private openAudits(title: string, rs: CmFileAuditRecord[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${rs.length} audited file(s)`,
      columns: AUDIT_COLUMNS, rows: rs.map(auditRow), exportName: `cm-audit-${exportSlug}_2026-07-17`, memberColumn: 0,
    });
  }
  private openCases(title: string, cs: CmCaseRec[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${cs.length} case(s)`,
      columns: CM_COLUMNS, rows: cs.map(cmToRow), exportName: `cm-audit-${exportSlug}_2026-07-17`, memberColumn: 1,
    });
  }

  drillAllAudits() { this.openAudits('Audited Files', this.audits(), 'all-files'); }
  drillPassed() { this.openAudits('Files Passing Review', this.passedAudits(), 'passed'); }
  drillFailed() { this.openAudits('Files Failing Review', this.failedAudits(), 'failed', `${this.failedAudits().length} file(s) scored below ${this.passTarget}% of the rubric`); }
  drillManager(careManager: string) { this.openAudits(`Audited Files — ${careManager}`, this.audits().filter((r) => r.careManager === careManager), `cm-${slug(careManager)}`); }
  drillManagersBelow() {
    const names = new Set(this.byManager().filter((m) => m.adequate && m.pct < this.passTarget).map((m) => m.careManager));
    this.openAudits('Audited Files — Care Managers Below Target', this.audits().filter((r) => names.has(r.careManager)), 'below-target');
  }
  drillOpenActions() { this.openAudits('Open Corrective Actions', this.correctiveActions().filter((r) => r.correctiveActionStatus === 'Open'), 'actions-open'); }
  drillAction(a: CmFileAuditRecord) { this.openAudits(`Corrective Action — ${a.careManager}`, [a], `action-${slug(a.memberId)}`); }
  drillAuditedElementFailures(element: CmAuditElement) {
    this.openAudits(`Audit Findings — ${element}`, this.audits().filter((r) => r.failedElements.includes(element)), `element-${slug(element)}`);
  }
  drillFinding(reason: CmDiscrepancyReason) { this.openAudits(`Findings Coded — ${reason}`, this.failedAudits().filter((r) => r.discrepancyReason === reason), `finding-${slug(reason)}`); }
  /** Caseload-wide (not sample-limited) — this tile measures every member record, so its drill
   *  opens member records rather than audit records. */
  drillElementFailures(element: CmAuditElement) {
    const i = CM_AUDIT_ELEMENTS.indexOf(element);
    const cs = this.scopedCases().filter((c) => !scoreElements(c)[i].met);
    this.openCases(`Not Meeting — ${element}`, cs, `quality-${slug(element)}`, `${cs.length} case(s) do not meet this rubric element`);
  }

  private openIrr(title: string, rs: CmFileAuditRecord[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${rs.length} blind-rescored file(s)`,
      columns: IRR_COLUMNS, rows: rs.map(irrRow), exportName: `cm-audit-${exportSlug}_2026-07-17`, memberColumn: 0,
    });
  }
  drillRescored() { this.openIrr('Blind-Rescored Files', this.rescored(), 'irr-rescored'); }
  drillDisagreements() { this.openIrr('Scoring Disagreements', this.disagreements(), 'irr-disagreements', `${this.disagreements().length} file(s) where the two QI reviewers reached different pass/fail conclusions`); }
  drillAuditor(auditor: string) { this.openIrr(`Blind-Rescored Files — ${auditor}`, this.rescored().filter((r) => r.auditor === auditor), `irr-${slug(auditor)}`); }

  drillRegLob(lob: string) {
    const cs = cmRegBreachesFor(lob, this.scopedCases());
    this.ix.openExplorer({
      title: `${lob} — Assessment / Care Plan Window Breaches`,
      context: `${cs.length} case(s) missed ${lob}'s assessment or care-plan window`,
      columns: REG_COLUMNS, rows: cs.map(regRow), exportName: `cm-audit-reg-${slug(lob)}_2026-07-17`, memberColumn: 1,
    });
  }
  drillProgramsBelow() {
    const below = this.regCompliance().filter((r) => r.pct < this.regTarget).map((r) => r.lob);
    const cs = below.flatMap((lob) => cmRegBreachesFor(lob, this.scopedCases()));
    this.ix.openExplorer({
      title: 'Window Breaches — Programs Below Target', context: `${cs.length} case(s)`,
      columns: REG_COLUMNS, rows: cs.map(regRow), exportName: 'cm-audit-reg-below-target_2026-07-17', memberColumn: 1,
    });
  }

  drillAllFlagged() {
    const fs = this.allFlags();
    this.ix.openExplorer({
      title: 'All Audit Flags', context: `${fs.length} compliance exception(s)`,
      columns: ['Flag ID', 'Type', 'Member', 'Member ID#', 'Care Manager', 'Description', 'Date', 'Severity'],
      rows: fs.map((f) => [f.id, f.type, f.member, f.memberId, f.careManager, f.description, f.date, f.severityLabel]),
      exportName: 'cm-audit-flags_2026-07-17', memberColumn: 2,
    });
  }
  openFlag(f: CmAuditFlag) {
    this.ix.openDrawer({
      title: `${f.id} · ${f.type}`,
      subtitle: `${f.member} · flagged ${f.date}`,
      badge: { text: `${f.severityLabel} severity`, tone: f.severity as any },
      fields: [
        { label: 'Flag ID', value: f.id },
        { label: 'Type', value: f.type },
        { label: 'Member', value: `${f.member} (${f.memberId})` },
        { label: 'Care Manager', value: f.careManager },
        { label: 'Date', value: f.date },
        { label: 'Severity', value: f.severityLabel, tone: f.severity as any },
      ],
      note: f.description,
    });
  }

  // ---- exports ----
  exportQuality() {
    this.exporter.open({
      title: 'Documentation Quality', name: 'cm-audit-quality_2026-07-17',
      columns: ['Rubric Element', 'Met', 'Records in Scope', 'Compliance %'],
      rows: this.elementCompliance().map((e) => [e.element, e.met, e.total, e.pct]),
    });
  }
  exportFileAudit() {
    this.exporter.open({
      title: 'File Audit (Chart Review)', name: 'cm-audit-file-review_2026-07-17',
      columns: ['Metric', 'Value'],
      rows: [
        ['Files Audited', this.audits().length],
        ['Audit Coverage %', this.auditCoverage()],
        ['File Pass Rate %', this.passRate()],
        ['Files Failing Review', this.failedAudits().length],
        ['Care Managers Below Target', this.managersBelowTarget()],
        ['Open Corrective Actions', this.openActions()],
      ],
    });
  }
  exportByManager() {
    this.exporter.open({
      title: 'Pass Rate by Care Manager', name: 'cm-audit-by-manager_2026-07-17',
      columns: ['Care Manager', 'Files Audited', 'Passed', 'Pass Rate %', 'Sample Adequate'],
      rows: this.byManager().map((m) => [m.careManager, m.audited, m.passed, m.pct, m.adequate ? 'Yes' : 'No']),
    });
  }
  exportElements() {
    this.exporter.open({
      title: 'Rubric Element Findings', name: 'cm-audit-elements_2026-07-17',
      columns: ['Rubric Element', 'Files Failing', '% of Audited Files'],
      rows: this.elementFindings().map((f) => [f.element, f.count, f.pct]),
    });
  }
  exportIrr() {
    this.exporter.open({
      title: 'Inter-Rater Reliability', name: 'cm-audit-irr_2026-07-17',
      columns: ['Auditor', 'Files Rescored', 'Agreements', 'Agreement Rate %'],
      rows: this.irrByAuditor().map((a) => [a.auditor, a.rescored, a.agree, a.pct]),
    });
  }
  exportRegCompliance() {
    this.exporter.open({
      title: 'Regulatory Compliance by Program', name: 'cm-audit-reg-compliance_2026-07-17',
      columns: ['Program', 'Assessment Window (days)', 'Care Plan Window (days)', 'Citation', 'Basis', 'Compliant', 'Total', 'Compliance %'],
      rows: this.regCompliance().map((r) => [r.lob, r.assessmentDays, r.carePlanDays, r.citation, r.basis, r.compliant, r.total, r.pct]),
    });
  }
  exportActions() {
    this.exporter.open({
      title: 'Corrective Actions', name: 'cm-audit-actions_2026-07-17',
      columns: ['Care Manager', 'Member', 'Member ID', 'Finding', 'Corrective Action', 'Status', 'Action Date'],
      rows: this.correctiveActions().map((a) => [a.careManager, a.member, a.memberId, a.discrepancyReason ?? '—', a.correctiveAction, a.correctiveActionStatus ?? '—', a.correctiveActionDate ?? '—']),
    });
  }
  exportFlags() {
    this.exporter.open({
      title: 'Audit Flags', name: 'cm-audit-flags_2026-07-17',
      columns: ['ID', 'Type', 'Member', 'Member ID', 'Care Manager', 'Description', 'Date', 'Severity'],
      rows: this.allFlags().map((f) => [f.id, f.type, f.member, f.memberId, f.careManager, f.description, f.date, f.severityLabel]),
    });
  }
}
