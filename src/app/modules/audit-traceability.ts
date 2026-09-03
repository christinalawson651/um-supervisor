import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  AUDIT_EVENTS, AuditEvent, AuditCategory, AuditChannel, AuditEntityType, AuditOutcome,
  SYSTEM_USERS, SystemUser, AccessRole,
  PERMISSIONS, Permission, PERMISSION_MATRIX, COMPLIANCE_REGISTER, ComplianceRequirement, registerCounts,
  verifyChain, isOffHours, isExternalIp, eventDate,
  AUDIT_RANGES, AuditRange, auditSpan, userActivityRollup, UserActivityRow,
  evaluateSod, SodResult, SodConflictRow, attestationAgeDays, ATTESTATION_CYCLE_DAYS,
  RETENTION_POLICIES, ARCHIVE_SEGMENTS, ArchiveSegment, RESTORE_REQUESTS, RestoreRequest, RetentionPolicy,
  archiveSummary, verifyArchiveChain,
} from '../data/audit-trail';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { LOBS, daysAgo } from '../data/case-fields';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Disposition, DispositionCertificate, DISPOSITION_APPROVERS } from '../shared/disposition';
import { DashboardData } from '../data/dashboard-data';
import {
  AI_DECISIONS, AiDecisionRecord, AiOutcome, OverrideReason, OVERRIDE_REASONS, MODEL_ATTRIBUTABLE,
  AI_TARGETS, PRODUCTION_CONFIG, AGENTS, aiScope, aiSummary, calibration, CalibrationRow, drift,
  overrideReasons, reviewerConcordance, concordanceBy, pendMix, modelMix, PendReason,
  confidenceDistribution, flagMix, InvestigationFlag,
} from '../data/ai-oversight';

interface TabDef { key: string; label: string; }
const TAB_DEFS: TabDef[] = [
  { key: 'trail', label: 'Audit Trail' },
  { key: 'ai', label: 'AI Oversight' },
  { key: 'activity', label: 'User Activity Monitoring' },
  { key: 'governance', label: 'Governance & Access Controls' },
  { key: 'retention', label: 'Retention & Archive' },
  { key: 'compliance', label: 'Compliance Requirements & Gaps' },
];

const CATEGORIES: AuditCategory[] = ['Access', 'Clinical Decision', 'Case Management', 'Correspondence', 'Administrative', 'Configuration', 'Security', 'Data Export'];
const CHANNELS: AuditChannel[] = ['Web UI', 'API', 'Batch Interface', 'Fax / OCR Intake', 'System Rule'];
const ENTITY_TYPES: AuditEntityType[] = ['Authorization', 'CM Case', 'Member', 'Appeal', 'Report', 'User Account', 'Configuration'];
const OUTCOMES: AuditOutcome[] = ['Success', 'Denied', 'Failed'];
const PAGE_SIZE = 50;

const EVENT_COLUMNS = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Category', 'Action', 'Entity Type', 'Entity ID', 'Field', 'Before', 'After', 'Channel', 'Source IP', 'Session', 'Correlation ID', 'Reason Code', 'PHI', 'Outcome', 'Record Hash'];
function eventRow(e: AuditEvent): (string | number)[] {
  return [e.eventId, e.timestamp.replace('T', ' '), e.actor, e.actorRole, e.category, e.action, e.entityType, e.entityId,
    e.field ?? '—', e.before ?? '—', e.after ?? '—', e.channel, e.sourceIp, e.sessionId, e.correlationId, e.reasonCode ?? '—',
    e.phi ? 'Yes' : 'No', e.outcome, e.recordHash];
}

/** Sort keys for the inline trail table — a flattened view of AuditEvent so compareRows() has
 *  plain scalars to work with (and so "Record" sorts by entity type then id, which is what a
 *  reader scanning that column actually wants). */
interface TrailRow {
  timestamp: string; actor: string; action: string; record: string; channel: string; outcome: string; ev: AuditEvent;
}
function trailRow(e: AuditEvent): TrailRow {
  return { timestamp: e.timestamp, actor: e.actor, action: e.action, record: `${e.entityType} ${e.entityId}`, channel: e.channel, outcome: e.outcome, ev: e };
}

interface InventoryRow extends SystemUser { mfa: string; reviewAge: number; }
type InvKey = 'name' | 'role' | 'department' | 'mfa' | 'reviewAge' | 'lastLogin';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-audit-traceability',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  template: `
    <!-- This module carries its own Range/LOB control rather than the shared dashboard period bar:
         on a caseload tab '30 days' is the unfiltered baseline, but the audit log spans the whole
         retained history, so that convention made the count FALL when you widened to QTD. -->
    <div class="scopebar">
      <span class="sc-lab">Range</span>
      <div class="seg">
        @for (r of ranges; track r.id) {
          <button [class.on]="range() === r.id" (click)="setRange(r.id)">{{ r.label }}</button>
        }
      </div>
      <span class="sc-lab">LOB</span>
      <div class="seg">
        <button [class.on]="lob() === 'all'" (click)="setLob('all')">All LOBs</button>
        @for (l of lobs; track l) {
          <button [class.on]="lob() === l" (click)="setLob(l)">{{ l }}</button>
        }
      </div>
      <span class="span-note">
        Online store: <b>{{ span.count | number }}</b> events, {{ span.from }} → {{ span.to }}.
        @if (range() !== 'all') { <a class="lnk" (click)="setRange('all')">Show entire online history</a> }
        @else { <a class="lnk" (click)="sel.set('retention')">+{{ archive().archivedEvents | number }} archived</a> }
      </span>
    </div>

    <nav class="subtabs">
      @for (t of tabs; track t.key) {
        <button class="subtab" [class.active]="sel() === t.key" (click)="sel.set(t.key)">{{ t.label }}</button>
      }
    </nav>

    @switch (sel()) {

      <!-- ============================ AUDIT TRAIL ============================ -->
      @case ('trail') {
        <div class="tab-head">
          <div><h2>Audit Trail</h2>
            <span class="section-note">Every create, read, and change against an authorization, care-management case, member, appeal, report or configuration — attributable, time-stamped and hash-chained. HIPAA §164.312(b).</span></div>
          <div class="head-actions">
            <button class="btn outline sm" (click)="verify()">Verify chain</button>
            <button class="btn outline sm" (click)="exportEvents()">Export</button>
          </div>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillEvents('All Events', scopedEvents(), 'all')">
            <div class="tile-val">{{ scopedEvents().length | number }}</div><div class="tile-lab">Events in Range</div>
            <div class="tile-sub">{{ rangeLabel() }}</div>
          </div>
          <div class="tile" (click)="drillEvents('PHI Access & Disclosure', phiEvents(), 'phi')">
            <div class="tile-val">{{ phiEvents().length | number }}</div><div class="tile-lab">PHI Access Events</div>
          </div>
          <div class="tile" (click)="drillEvents('Clinical Decisions', decisionEvents(), 'decisions')">
            <div class="tile-val">{{ decisionEvents().length | number }}</div><div class="tile-lab">Clinical Decision Events</div>
          </div>
          <div class="tile" (click)="drillEvents('Configuration Changes', configEvents(), 'config')">
            <div class="tile-ic" [class.hot]="configEvents().length > 0"></div>
            <div class="tile-val">{{ configEvents().length }}</div><div class="tile-lab">Configuration Changes</div>
          </div>
          <div class="tile" (click)="drillEvents('Denied or Failed Actions', deniedEvents(), 'denied')">
            <div class="tile-ic" [class.hot]="deniedEvents().length > 0"></div>
            <div class="tile-val">{{ deniedEvents().length }}</div><div class="tile-lab">Denied / Failed Actions</div>
          </div>
          <div class="tile" (click)="drillEvents('Entities Touched', scopedEvents(), 'entities')">
            <div class="tile-val">{{ entityCount() | number }}</div><div class="tile-lab">Distinct Records Touched</div>
            <div class="tile-sub">{{ actorCount() }} distinct actors</div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad filters">
            <input class="search" type="text" placeholder="Search actor, action, entity, correlation ID, IP…" [ngModel]="q()" (ngModelChange)="setQ($event)" />
            <select [value]="cat()" (change)="setCat($any($event.target).value)">
              <option value="all">All categories</option>
              @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            <select [value]="chan()" (change)="setChan($any($event.target).value)">
              <option value="all">All channels</option>
              @for (c of channels; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            <select [value]="entity()" (change)="setEntity($any($event.target).value)">
              <option value="all">All record types</option>
              @for (t of entityTypes; track t) { <option [value]="t">{{ t }}</option> }
            </select>
            <select [value]="actor()" (change)="setActor($any($event.target).value)">
              <option value="all">All actors</option>
              @for (u of actorOptions; track u.userId) { <option [value]="u.userId">{{ u.name }}</option> }
            </select>
            <select [value]="outcome()" (change)="setOutcome($any($event.target).value)">
              <option value="all">Any outcome</option>
              @for (o of outcomes; track o) { <option [value]="o">{{ o }}</option> }
            </select>
            <label class="chk"><input type="checkbox" [checked]="phiOnly()" (change)="setPhiOnly($any($event.target).checked)" /> PHI only</label>
            <label class="chk"><input type="checkbox" [checked]="offHoursOnly()" (change)="setOffHoursOnly($any($event.target).checked)" /> Off-hours only</label>
            @if (filtersActive()) { <button class="btn outline sm" (click)="clearFilters()">Clear</button> }
            <span class="count">{{ filteredEvents().length | number }} of {{ scopedEvents().length | number }}</span>
          </div>
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortBy('timestamp')">Timestamp{{ caret('timestamp') }}</th>
              <th class="srt" (click)="sortBy('actor')">Actor{{ caret('actor') }}</th>
              <th class="srt" (click)="sortBy('action')">Action{{ caret('action') }}</th>
              <th class="srt" (click)="sortBy('record')">Record{{ caret('record') }}</th>
              <th>Change</th>
              <th class="srt" (click)="sortBy('channel')">Channel{{ caret('channel') }}</th>
              <th class="srt" (click)="sortBy('outcome')">Outcome{{ caret('outcome') }}</th>
            </tr></thead>
            <tbody>
              @for (r of pagedRows(); track r.ev.eventId) {
                <tr class="clk" (click)="openEvent(r.ev)">
                  <td class="mono">{{ r.ev.timestamp.replace('T', ' ') }}@if (isOff(r.ev.timestamp)) { <span class="chip amber">off-hours</span> }</td>
                  <td class="strong">{{ r.ev.actor }}<div class="sub">{{ r.ev.actorRole }}</div></td>
                  <td>{{ r.ev.action }}<div class="sub">{{ r.ev.category }}</div></td>
                  <td class="mono">{{ r.ev.entityId }}<div class="sub">{{ r.ev.entityType }}@if (r.ev.phi) { · <span class="phi">PHI</span> }</div></td>
                  <td>@if (r.ev.field) { <span class="sub">{{ r.ev.field }}:</span> <span class="was">{{ r.ev.before ?? '—' }}</span> → <b>{{ r.ev.after }}</b> } @else { <span class="sub">—</span> }</td>
                  <td>{{ r.ev.channel }}</td>
                  <td><span class="badge" [class.green]="r.ev.outcome==='Success'" [class.red]="r.ev.outcome==='Failed'" [class.amber]="r.ev.outcome==='Denied'">{{ r.ev.outcome }}</span></td>
                </tr>
              } @empty { <tr><td colspan="7" class="empty">No events match these filters.</td></tr> }
            </tbody>
          </table>
          @if (filteredEvents().length) {
            <div class="pager panel-pad">
              <span class="pg-note">Showing {{ pageStart() | number }}–{{ pageEnd() | number }} of {{ filteredEvents().length | number }}</span>
              <div class="pg-actions">
                <button class="btn outline sm" [disabled]="page() === 0" (click)="page.set(0)">« First</button>
                <button class="btn outline sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">‹ Prev</button>
                <span class="pg-of">Page {{ page() + 1 | number }} of {{ pageCount() | number }}</span>
                <button class="btn outline sm" [disabled]="page() >= pageCount() - 1" (click)="page.set(page() + 1)">Next ›</button>
                <button class="btn outline sm" [disabled]="page() >= pageCount() - 1" (click)="page.set(pageCount() - 1)">Last »</button>
                <button class="btn outline sm" (click)="drillEvents('Filtered Audit Trail', filteredEvents(), 'filtered')">Open all in explorer</button>
              </div>
            </div>
          }
        </div>
      }

      <!-- ============================ AI OVERSIGHT ============================ -->
      @case ('ai') {
        <div class="tab-head">
          <div><h2>AI Oversight</h2>
            <span class="section-note">What the model recommended, how sure it said it was, what the clinician decided instead, and whether the score can be trusted. Every determination the agentic flow touched — {{ aiRows().length | number }} in range.</span></div>
          <button class="btn outline sm" (click)="exportAi()">Export</button>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillAi('Determinations', aiRows(), 'all')">
            <div class="tile-val">{{ ai().total | number }}</div><div class="tile-lab">Determinations</div>
            <div class="tile-sub">{{ ai().reviewed }} clinician-reviewed</div>
          </div>
          <div class="tile" (click)="drillAi('Auto-Cleared', autoRows(), 'auto-cleared')">
            <div class="tile-val">{{ ai().autoCleared | number }}</div><div class="tile-lab">Auto-Cleared</div>
            <div class="tile-sub">{{ ai().autoClearedPct }}% of volume</div>
          </div>
          <div class="tile" (click)="drillAi('Decision Agreement — Model Matched the Determination', concordantRows(), 'agreement')">
            <div class="tile-ic" [class.hot]="ai().decisionAgreementPct < targets.decisionAgreementPct"></div>
            <div class="tile-val">{{ ai().decisionAgreementPct }}%</div><div class="tile-lab">Decision Agreement</div>
            <div class="tile-sub">target ≥ {{ targets.decisionAgreementPct }}%</div>
          </div>
          <div class="tile" (click)="drillAi('Ungrounded Verdicts', ungroundedRows(), 'ungrounded')">
            <div class="tile-ic" [class.hot]="ai().groundednessPct < targets.groundednessPct"></div>
            <div class="tile-val">{{ ai().groundednessPct }}%</div><div class="tile-lab">Groundedness</div>
            <div class="tile-sub">verdict supported by its cited source · target ≥ {{ targets.groundednessPct }}%</div>
          </div>
          <div class="tile" (click)="drillAi('Panel Splits', panelSplitRows(), 'panel-split')">
            <div class="tile-ic" [class.hot]="ai().convergencePct < targets.convergencePct"></div>
            <div class="tile-val">{{ ai().convergencePct }}%</div><div class="tile-lab">Convergence</div>
            <div class="tile-sub">{{ ai().panelRuns }} panel runs · target ≥ {{ targets.convergencePct }}%</div>
          </div>
          <div class="tile" (click)="drillAi('Clinician Overrides', overriddenRows(), 'overrides')">
            <div class="tile-ic" [class.hot]="ai().overrideRatePct > targets.maxOverrideRatePct"></div>
            <div class="tile-val">{{ ai().overrideRatePct }}%</div><div class="tile-lab">Override Rate</div>
            <div class="tile-sub">{{ ai().overridden }} of {{ ai().reviewed }} reviewed · target ≤ {{ targets.maxOverrideRatePct }}%</div>
          </div>
          <div class="tile" (click)="drillAi('Model-Attributable Overrides', modelAttributableRows(), 'model-attributable')">
            <div class="tile-ic" [class.hot]="ai().modelAttributable > 0"></div>
            <div class="tile-val">{{ ai().modelAttributable }}</div><div class="tile-lab">Model-Attributable Overrides</div>
            <div class="tile-sub">the ones that are the model's fault</div>
          </div>
          <div class="tile" (click)="drillAi('Pended for Review', pendedRows(), 'pended')">
            <div class="tile-val">{{ ai().pended | number }}</div><div class="tile-lab">Pended for Review</div>
            <div class="tile-sub">{{ ai().pendedPctOfVolume }}% of volume stopped for a human</div>
          </div>
          <div class="tile" (click)="drillAi('Determinations', aiRows(), 'confidence')">
            <div class="tile-val">{{ ai().avgConfidence.toFixed(2) }}</div><div class="tile-lab">Avg Confidence</div>
            <div class="tile-sub">{{ ai().panelRatePct }}% adjudicated by panel</div>
          </div>
          <div class="tile" (click)="drillAi('Flagged for Investigation', flaggedRows(), 'flagged')">
            <div class="tile-ic" [class.hot]="ai().flagged > 0"></div>
            <div class="tile-val">{{ ai().flagged }}</div><div class="tile-lab">Flagged by the Gates</div>
            <div class="tile-sub">low confidence · panel split · ungrounded</div>
          </div>
          <div class="tile" (click)="drillAi('Determinations', aiRows(), 'spend')">
            <div class="tile-val">\${{ ai().avgCostPerCase.toFixed(2) }}</div><div class="tile-lab">Avg Cost / Case</div>
            <div class="tile-sub">{{ ai().tokensPerCase | number }} tokens · P95 {{ ai().p95LatencySec }}s</div>
          </div>
          <div class="tile" (click)="drillAi('Determinations', aiRows(), 'tokens')">
            <div class="tile-val">{{ tokensLabel() }}</div><div class="tile-lab">Tokens</div>
            <div class="tile-sub">\${{ ai().inferenceSpend.toFixed(2) }} inference spend</div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Confidence Distribution</h3>
            <span class="section-note sm">Determinations by confidence band. Below {{ gates.autoPendGate.toFixed(2) }} is auto-pended for review — the gate keeps low-confidence approvals out of production; at or above {{ gates.autoApproveGate.toFixed(2) }} a determination is eligible to auto-clear.</span></div>
          <table class="z-table">
            <thead><tr><th>Band</th><th class="num">Determinations</th><th class="agree-col">Share</th><th>Gate</th></tr></thead>
            <tbody>
              @for (b of distribution(); track b.band) {
                <tr class="clk" (click)="drillBandRaw(b.band)">
                  <td class="strong mono">{{ b.band }}</td>
                  <td class="num">{{ b.n | number }}</td>
                  <td class="agree-col">
                    <span class="mbar"><span class="teal" [style.width.%]="b.pct"></span></span>
                    <span class="mpct">{{ b.pct }}%</span>
                  </td>
                  <td class="sub">
                    @if (b.band === '< 0.70') { auto-pended }
                    @else if (b.band === '0.70–0.80') { below auto-approve gate }
                    @else { eligible to auto-clear }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Cases to Investigate</h3>
            <span class="section-note sm">Flagged by the gates. These are the determinations an ML Ops or compliance reviewer opens first — click through to the run ledger.</span></div>
          <table class="z-table">
            <thead><tr><th>Flag</th><th class="num">Determinations</th><th class="num">% of Volume</th><th>What it means</th></tr></thead>
            <tbody>
              @for (f of flags(); track f.flag) {
                <tr class="clk" (click)="drillFlag(f.flag)">
                  <td class="strong">{{ f.flag }}</td>
                  <td class="num">{{ f.count }}</td>
                  <td class="num">{{ f.pct }}%</td>
                  <td class="sub">
                    @if (f.flag === 'low confidence') { Scored below the {{ gates.autoPendGate.toFixed(2) }} pend gate }
                    @else if (f.flag === 'panel split') { The panel did not converge on one answer }
                    @else { The verdict was not fully supported by its cited source }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Per-Agent Latency &amp; Errors</h3>
            <span class="section-note sm">The {{ agents.length }} LLM agents in the flow. Measured by the runtime rather than derived here — a case pool cannot tell you where a step spent its time.</span></div>
          <table class="z-table">
            <thead><tr><th>Agent</th><th class="num">P95</th><th class="num">Error Rate</th><th class="agree-col">Share of P95 Path</th></tr></thead>
            <tbody>
              @for (a of agents; track a.agent) {
                <tr>
                  <td class="strong mono">{{ a.agent }}</td>
                  <td class="num">{{ a.p95Sec }}s</td>
                  <td class="num"><b [class.warn]="a.errorPct >= 0.5">{{ a.errorPct }}%</b></td>
                  <td class="agree-col">
                    <span class="mbar"><span class="teal" [style.width.%]="agentSharePct(a.p95Sec)"></span></span>
                    <span class="mpct">{{ agentSharePct(a.p95Sec) }}%</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Queue by Pend Reason</h3>
            <span class="section-note sm">Why the flow stopped and asked for a human. A reviewed determination matching none of these was routine — it reached a clinician without the flow flagging anything, so it is not counted as a pend.</span></div>
          <table class="z-table">
            <thead><tr><th>Pend Reason</th><th class="num">Determinations</th><th class="agree-col">Share of Pended</th></tr></thead>
            <tbody>
              @for (r of pendReasons(); track r.reason) {
                <tr class="clk" (click)="drillPend(r.reason)">
                  <td class="strong">{{ r.reason }}</td>
                  <td class="num">{{ r.count }}</td>
                  <td class="agree-col">
                    <span class="mbar"><span class="teal" [style.width.%]="r.pct"></span></span>
                    <span class="mpct">{{ r.pct }}%</span>
                  </td>
                </tr>
              } @empty { <tr><td colspan="3" class="empty">Nothing pended in range.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Models Used</h3>
            <span class="section-note sm">A panel is convened when one pass is not enough — an adverse direction or a soft score. It costs more per case; this is where you see whether it buys anything.</span></div>
          <table class="z-table">
            <thead><tr><th>Models</th><th>Panel</th><th class="num">Runs</th><th class="num">Tokens / Case</th><th class="num">Avg Cost</th><th class="num">Avg Latency</th><th class="num">Decision Agreement</th></tr></thead>
            <tbody>
              @for (m of models(); track m.modelsUsed + m.panel) {
                <tr>
                  <td class="strong mono">{{ m.modelsUsed }}</td>
                  <td>@if (m.panel) { <span class="badge amber">panel</span> } @else { <span class="sub">—</span> }</td>
                  <td class="num">{{ m.runs }}</td>
                  <td class="num">{{ m.tokensPerCase | number }}</td>
                  <td class="num">\${{ m.avgCost.toFixed(2) }}</td>
                  <td class="num">{{ m.avgLatencySec }}s</td>
                  <td class="num"><b [class.warn]="m.agreementPct < targets.decisionAgreementPct">{{ m.agreementPct }}%</b></td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Confidence Calibration</h3>
            <span class="section-note sm">The confidence distribution above shows how often the model is sure. This shows whether being sure means anything: a band claiming 0.95 should be right about 95% of the time. Observed agreement against the claim is the evidence a score is or is not reliable — the number alone proves nothing. Tolerance ±{{ targets.maxCalibrationDeviationPts }} points.</span></div>
          <table class="z-table">
            <thead><tr><th>Confidence Band</th><th class="num">Determinations</th><th class="num">Claimed</th><th class="num">Observed</th><th class="num">Deviation</th><th>Verdict</th></tr></thead>
            <tbody>
              @for (c of calib(); track c.band) {
                <tr class="clk" (click)="drillBand(c)">
                  <td class="strong">{{ c.band }}</td>
                  <td class="num">{{ c.n | number }}</td>
                  <td class="num">{{ c.claimed }}%</td>
                  <td class="num">@if (c.adequate) { {{ c.observed }}% } @else { <span class="sub">n={{ c.n }}</span> }</td>
                  <td class="num">
                    @if (c.adequate) {
                      <b [class.warn]="c.deviation < 0" [class.good]="c.deviation >= 0">{{ c.deviation > 0 ? '+' : '' }}{{ c.deviation }} pts</b>
                    } @else { <span class="sub">not reported</span> }
                  </td>
                  <td><span class="badge"
                        [class.green]="c.verdict === 'Calibrated'"
                        [class.red]="c.verdict === 'Overconfident'"
                        [class.amber]="c.verdict === 'Underconfident' || c.verdict === 'Insufficient sample'">{{ c.verdict }}</span></td>
                </tr>
              }
            </tbody>
          </table>
          @if (overconfidentBands().length) {
            <div class="finding panel-pad">
              <b>Finding</b>
              The {{ overconfidentBands().join(', ') }} band{{ overconfidentBands().length > 1 ? 's are' : ' is' }} over-confident — it agrees with the clinician less often than its score claims. Scores in that range should not be treated as stronger evidence than the band below it until this closes. Tracked as REQ-20.
            </div>
          }
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Concordance Over Time</h3>
            <span class="section-note sm">Symphony's three drift series — agreement, groundedness and confidence — by month against what was serving.</span></div>
          <!-- Chronological, and deliberately not sortable: a drift series read in any order other
               than time is no longer a drift series. -->
          <table class="z-table">
            <thead><tr>
              <th>Month</th><th class="num">Determinations</th><th>Serving</th>
              <th class="num">Avg Confidence</th><th class="num">Groundedness</th><th class="agree-col">Decision Agreement</th>
            </tr></thead>
            <tbody>
              @for (d of driftRows(); track d.month) {
                <tr>
                  <td class="strong mono">{{ d.month }}</td>
                  <td class="num">{{ d.n }}</td>
                  <td class="mono">{{ gates.model }}</td>
                  <td class="num">{{ d.avgConfidence.toFixed(2) }}</td>
                  <td class="num"><b [class.warn]="d.groundednessPct < targets.groundednessPct">{{ d.groundednessPct }}%</b></td>
                  <td class="agree-col">
                    <span class="mbar"><span [class.amber]="d.agreementPct < targets.decisionAgreementPct" [class.teal]="d.agreementPct >= targets.decisionAgreementPct" [style.width.%]="d.agreementPct"></span></span>
                    <span class="mpct" [class.warn]="d.agreementPct < targets.decisionAgreementPct">{{ d.agreementPct }}%</span>
                    @if (d.n < targets.minBandSample) { <span class="chip amber">thin month</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No scored determinations in range.</td></tr> }
            </tbody>
          </table>
          <div class="foot-note panel-pad">A sustained drop on any of these three is the early signal to re-test and recalibrate before it reaches a member.</div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Why Clinicians Overrode</h3>
            <span class="section-note sm">An override rate on its own says nothing. The reason code is what separates "the model is wrong about this population" from "the clinical picture changed after it scored" — only the first is a model problem.</span></div>
          <table class="z-table">
            <thead><tr><th>Reason</th><th class="num">Overrides</th><th class="num">% of Overrides</th><th>Attribution</th></tr></thead>
            <tbody>
              @for (r of reasons(); track r.reason) {
                <tr class="clk" (click)="drillReason(r.reason)">
                  <td class="strong">{{ r.reason }}</td>
                  <td class="num">{{ r.count }}</td>
                  <td class="num">{{ reasonPct(r.count) }}%</td>
                  <td><span class="badge" [class.red]="r.modelAttributable" [class.green]="!r.modelAttributable">{{ r.modelAttributable ? 'Model' : 'Clinical' }}</span></td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Agreement by Clinician</h3>
            <span class="section-note sm">A reviewer below the group is not necessarily wrong — they may be catching what the model misses. This is a signal to look at, never a score to manage someone by.</span></div>
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortRev('reviewer')">Clinician{{ caretRev('reviewer') }}</th>
              <th class="srt num" (click)="sortRev('scored')">Scored{{ caretRev('scored') }}</th>
              <th class="srt num" (click)="sortRev('agreed')">Agreed{{ caretRev('agreed') }}</th>
              <th class="srt num" (click)="sortRev('overrides')">Overrides{{ caretRev('overrides') }}</th>
              <th class="srt agree-col" (click)="sortRev('pct')">Agreement{{ caretRev('pct') }}</th>
            </tr></thead>
            <tbody>
              @for (r of byReviewer(); track r.reviewer) {
                <tr class="clk" (click)="drillReviewer(r.reviewer)">
                  <td class="strong">{{ r.reviewer }}</td>
                  <td class="num">{{ r.scored }}</td>
                  <td class="num">{{ r.adequate ? r.agreed : '—' }}</td>
                  <td class="num"><b [class.warn]="r.overrides > 0">{{ r.overrides }}</b></td>
                  <td class="agree-col">
                    @if (r.adequate) {
                      <span class="mbar"><span [class.amber]="r.pct < targets.decisionAgreementPct" [class.teal]="r.pct >= targets.decisionAgreementPct" [style.width.%]="r.pct"></span></span>
                      <span class="mpct" [class.warn]="r.pct < targets.decisionAgreementPct">{{ r.pct }}%</span>
                    } @else {
                      <span class="sub">n={{ r.scored }} — below the {{ targets.minReviewerSample }}-determination floor, no rate reported</span>
                    }
                  </td>
                </tr>
              } @empty { <tr><td colspan="5" class="empty">No clinician-reviewed determinations in range.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Where Agreement Breaks Down</h3>
            <span class="section-note sm">Grouped by the procedure the criteria govern — this is what tells the clinical content team which policy to look at. Groups below {{ targets.minReviewerSample / 2 }} scored determinations are omitted; a sample of three says nothing.</span></div>
          <table class="z-table">
            <thead><tr><th>Procedure / Criteria</th><th class="num">Scored</th><th class="num">Decision Agreement</th><th class="num">Override Rate</th></tr></thead>
            <tbody>
              @for (g of byCriteria(); track g.key) {
                <tr class="clk" (click)="drillCriteria(g.key)">
                  <td class="strong">{{ g.key }}</td>
                  <td class="num">{{ g.n }}</td>
                  <td class="num"><b [class.warn]="g.concordancePct < targets.decisionAgreementPct">{{ g.concordancePct }}%</b></td>
                  <td class="num">{{ g.overrideRatePct }}%</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Production Config — What's Serving Live</h3>
            <span class="section-note sm">A determination can only be re-explained against what produced it, so the serving configuration is retained the same way criteria versions are. Changes here are governed like any other configuration change — versioned, independently approved, logged with before and after.</span></div>
          <table class="z-table">
            <thead><tr><th>Setting</th><th>Value</th><th class="num">Determinations Scored</th></tr></thead>
            <tbody>
              <tr><td class="strong">Workflow</td><td class="mono">{{ gates.workflow }}</td><td class="num">{{ ai().total | number }}</td></tr>
              <tr><td class="strong">Med-necessity bundle</td><td class="mono">{{ gates.bundle }}<div class="sub">promoted {{ gates.bundlePromoted }}</div></td><td class="num">{{ ai().total | number }}</td></tr>
              <tr><td class="strong">Model</td><td class="mono">{{ gates.model }}</td><td class="num">{{ ai().total | number }}</td></tr>
              <tr><td class="strong">Confidence gate</td><td class="mono">≥ {{ gates.autoApproveGate.toFixed(2) }} auto-approve · &lt; {{ gates.autoPendGate.toFixed(2) }} auto-pend</td><td class="num">{{ ai().autoCleared | number }} auto-cleared</td></tr>
            </tbody>
          </table>
        </div>
      }

      <!-- ======================= USER ACTIVITY MONITORING ======================= -->
      @case ('activity') {
        <div class="tab-head">
          <div><h2>User Activity Monitoring</h2>
            <span class="section-note">Per-account activity review — the evidence behind HIPAA §164.308(a)(1)(ii)(D). Signals are relative to the selected range.</span></div>
          <button class="btn outline sm" (click)="exportActivity()">Export</button>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillEvents('Sign-in Events', signIns(), 'signins')">
            <div class="tile-val">{{ signIns().length | number }}</div><div class="tile-lab">Sign-ins</div>
            <div class="tile-sub">{{ activeUsers() }} distinct accounts</div>
          </div>
          <div class="tile" (click)="drillEvents('Off-Hours Access', offHoursEvents(), 'offhours')">
            <div class="tile-ic" [class.hot]="offHoursEvents().length > 0"></div>
            <div class="tile-val">{{ offHoursEvents().length | number }}</div><div class="tile-lab">Off-Hours Access Events</div>
            <div class="tile-sub">outside 07:00–19:00</div>
          </div>
          <div class="tile" (click)="drillEvents('Failed Sign-in Attempts', failedLogins(), 'failed')">
            <div class="tile-ic" [class.hot]="failedLogins().length > 0"></div>
            <div class="tile-val">{{ failedLogins().length }}</div><div class="tile-lab">Failed Sign-ins</div>
          </div>
          <div class="tile" (click)="drillEvents('Denied Record Access', deniedAccess(), 'denied-access')">
            <div class="tile-val">{{ deniedAccess().length }}</div><div class="tile-lab">Out-of-Scope Access Denied</div>
            <div class="tile-sub">role-based access control working</div>
          </div>
          <div class="tile" (click)="drillEvents('Break-the-Glass Access', breakGlass(), 'btg')">
            <div class="tile-ic" [class.hot]="breakGlass().length > 0"></div>
            <div class="tile-val">{{ breakGlass().length }}</div><div class="tile-lab">Break-the-Glass Grants</div>
            <div class="tile-sub">each requires review</div>
          </div>
          <div class="tile" (click)="drillEvents('Data Exports', exportEventsList(), 'exports')">
            <div class="tile-val">{{ exportEventsList().length }}</div><div class="tile-lab">Data Exports</div>
            <div class="tile-sub">{{ exportedRows() | number }} rows extracted</div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad filters">
            <h3 class="pt">Activity by Account</h3>
            <input class="search sm" type="text" placeholder="Search account or role…" [ngModel]="aq()" (ngModelChange)="aq.set($event)" />
            <label class="chk"><input type="checkbox" [checked]="flaggedOnly()" (change)="flaggedOnly.set($any($event.target).checked)" /> Flagged only</label>
            <span class="count">{{ activity().length }} account(s)</span>
          </div>
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortAct('name')">Account{{ caretAct('name') }}</th>
              <th class="srt" (click)="sortAct('role')">Role{{ caretAct('role') }}</th>
              <th class="srt num" (click)="sortAct('events')">Events{{ caretAct('events') }}</th>
              <th class="srt num" (click)="sortAct('phi')">PHI{{ caretAct('phi') }}</th>
              <th class="srt num" (click)="sortAct('offHours')">Off-Hours{{ caretAct('offHours') }}</th>
              <th class="srt num" (click)="sortAct('failedLogins')">Failed{{ caretAct('failedLogins') }}</th>
              <th class="srt num" (click)="sortAct('deniedAccess')">Denied{{ caretAct('deniedAccess') }}</th>
              <th class="srt num" (click)="sortAct('breakGlass')">BTG{{ caretAct('breakGlass') }}</th>
              <th class="srt num" (click)="sortAct('exports')">Exports{{ caretAct('exports') }}</th>
              <th class="srt" (click)="sortAct('lastActivity')">Last Activity{{ caretAct('lastActivity') }}</th>
              <th>Signals</th>
            </tr></thead>
            <tbody>
              @for (a of activity(); track a.userId) {
                <tr class="clk" (click)="drillUser(a)">
                  <td class="strong">{{ a.name }}<div class="sub mono">{{ a.userId }}</div></td>
                  <td>{{ a.role }}</td>
                  <td class="num">{{ a.events | number }}</td>
                  <td class="num">{{ a.phi | number }}</td>
                  <td class="num"><b [class.warn]="a.offHours > 0">{{ a.offHours }}</b></td>
                  <td class="num"><b [class.warn]="a.failedLogins > 0">{{ a.failedLogins }}</b></td>
                  <td class="num">{{ a.deniedAccess }}</td>
                  <td class="num"><b [class.hot]="a.breakGlass > 0">{{ a.breakGlass }}</b></td>
                  <td class="num">{{ a.exports }}</td>
                  <td class="mono">{{ a.lastActivity || '—' }}</td>
                  <td>@for (f of a.signals; track f) { <span class="chip amber">{{ f }}</span> } @if (!a.signals.length) { <span class="sub">—</span> }</td>
                </tr>
              } @empty { <tr><td colspan="11" class="empty">No accounts match this filter.</td></tr> }
            </tbody>
          </table>
        </div>
      }

      <!-- ==================== GOVERNANCE & ACCESS CONTROLS ==================== -->
      @case ('governance') {
        <div class="tab-head">
          <div><h2>Governance &amp; Access Controls</h2>
            <span class="section-note">Who is entitled to do what, whether those entitlements are still attested, and where two duties that must stay separate have landed on one person.</span></div>
          <button class="btn outline sm" (click)="exportGovernance()">Export</button>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillAccounts('All Accounts', accounts, 'accounts')">
            <div class="tile-val">{{ accounts.length }}</div><div class="tile-lab">Accounts</div>
            <div class="tile-sub">{{ roleCount() }} access roles</div>
          </div>
          <div class="tile" (click)="drillAccounts('Accounts Without MFA', noMfa(), 'no-mfa')">
            <div class="tile-ic" [class.hot]="noMfa().length > 0"></div>
            <div class="tile-val">{{ mfaCoverage() }}%</div><div class="tile-lab">MFA Coverage</div>
            <div class="tile-sub">{{ noMfa().length }} account(s) password-only</div>
          </div>
          <div class="tile" (click)="drillAccounts('Attestation Overdue', attestationOverdue(), 'attestation')">
            <div class="tile-ic" [class.hot]="attestationOverdue().length > 0"></div>
            <div class="tile-val">{{ attestationOverdue().length }}</div><div class="tile-lab">Entitlement Reviews Overdue</div>
            <div class="tile-sub">{{ cycleDays }}-day cycle</div>
          </div>
          <div class="tile" (click)="sel.set('compliance')">
            <div class="tile-ic" [class.hot]="sodConflicts().length > 0"></div>
            <div class="tile-val">{{ sodConflicts().length }}</div><div class="tile-lab">Segregation-of-Duty Conflicts</div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Segregation of Duties</h3>
            <span class="section-note sm">Each rule is evaluated against the live audit trail, not asserted — a clean rule means the trail contains no matching event.</span></div>
          <table class="z-table">
            <thead><tr><th>Rule</th><th>Citation</th><th>Result</th><th>Detail</th></tr></thead>
            <tbody>
              @for (r of sodResults(); track r.rule.id) {
                <tr [class.clk]="r.conflicts.length > 0" (click)="r.conflicts.length ? drillSod(r) : null">
                  <td class="strong">{{ r.rule.name }}<div class="sub">{{ r.rule.detail }}</div></td>
                  <td class="sub">{{ r.rule.citation }}</td>
                  <td><span class="badge" [class.green]="!r.conflicts.length" [class.red]="r.conflicts.length > 0">{{ r.conflicts.length ? r.conflicts.length + ' conflict(s)' : 'No conflicts' }}</span></td>
                  <td>@if (r.conflicts.length) { {{ r.conflicts[0].detail }}@if (r.conflicts.length > 1) { <span class="sub"> +{{ r.conflicts.length - 1 }} more</span> } } @else { <span class="sub">Control passing across {{ scopedEvents().length | number }} events in range</span> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Role → Permission Matrix</h3>
            <span class="section-note sm">Constraints matter more than the yes/no — "own caseload only" is a different control than an unconditional grant.</span></div>
          <div class="matrix-wrap">
            <table class="z-table matrix">
              <thead><tr><th class="sticky">Permission</th>@for (r of roles; track r) { <th>{{ r }}</th> }</tr></thead>
              <tbody>
                @for (p of permissions; track p) {
                  <tr><td class="sticky strong">{{ p }}</td>
                    @for (r of roles; track r) {
                      <td class="cell" [attr.data-v]="verdict(r, p)">{{ matrix(r, p) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad filters"><h3 class="pt">Account Inventory</h3>
            <input class="search sm" type="text" placeholder="Search account, role, department…" [ngModel]="gq()" (ngModelChange)="gq.set($event)" />
            <span class="count">{{ inventory().length }} account(s)</span>
          </div>
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortInv('name')">Account{{ caretInv('name') }}</th>
              <th class="srt" (click)="sortInv('role')">Role{{ caretInv('role') }}</th>
              <th class="srt" (click)="sortInv('department')">Department{{ caretInv('department') }}</th>
              <th class="srt" (click)="sortInv('mfa')">MFA{{ caretInv('mfa') }}</th>
              <th class="srt" (click)="sortInv('reviewAge')">Last Entitlement Review{{ caretInv('reviewAge') }}</th>
              <th class="srt" (click)="sortInv('lastLogin')">Last Sign-in{{ caretInv('lastLogin') }}</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              @for (u of inventory(); track u.userId) {
                <tr class="clk" (click)="drillAccountTrail(u)">
                  <td class="strong">{{ u.name }}<div class="sub mono">{{ u.userId }}</div></td>
                  <td>{{ u.role }}</td><td class="sub">{{ u.department }}</td>
                  <td><span class="badge" [class.green]="u.mfaEnrolled" [class.red]="!u.mfaEnrolled">{{ u.mfa }}</span></td>
                  <td class="mono">{{ u.lastAccessReview }}@if (u.reviewAge > cycleDays) { <span class="chip amber">{{ u.reviewAge }}d</span> }</td>
                  <td class="mono">{{ u.lastLogin }}</td>
                  <td><span class="badge green">{{ u.status }}</span></td>
                </tr>
              } @empty { <tr><td colspan="7" class="empty">No accounts match this search.</td></tr> }
            </tbody>
          </table>
        </div>
      }

      <!-- ==================== RETENTION & ARCHIVE ==================== -->
      @case ('retention') {
        <div class="tab-head">
          <div><h2>Retention &amp; Archive</h2>
            <span class="section-note">The Audit Trail queries the online store. This is everything behind it — what is retained, for how long, under whose rule, where it physically sits, and what is holding disposition. The Range control above does not apply here; retention is not a reporting window.</span></div>
          <div class="head-actions">
            <button class="btn outline sm" (click)="verifyArchive()">Verify archive chain</button>
            <button class="btn outline sm" (click)="exportCertificates()">Certificates</button>
            <button class="btn outline sm" (click)="exportArchive()">Export</button>
          </div>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="sel.set('trail')">
            <div class="tile-val">{{ archive().onlineEvents | number }}</div><div class="tile-lab">Online — Queryable</div>
            <div class="tile-sub">{{ archive().onlineFrom }} → {{ archive().onlineTo }}</div>
          </div>
          <div class="tile" (click)="drillSegments('Archive Segment Index', segments, 'segments')">
            <div class="tile-val">{{ archive().archivedEvents | number }}</div><div class="tile-lab">Archived — Retrievable</div>
            <div class="tile-sub">{{ archive().archivedSegments }} sealed segments</div>
          </div>
          <div class="tile" (click)="drillSegments('Archive Segment Index', segments, 'all-retained')">
            <div class="tile-val">{{ archive().totalRetained | number }}</div><div class="tile-lab">Total Retained</div>
            <div class="tile-sub">oldest {{ archive().oldestRetained }}</div>
          </div>
          <div class="tile" (click)="drillSegments('Segments Under Legal Hold', heldSegments(), 'held')">
            <div class="tile-ic" [class.hot]="archive().onHold > 0"></div>
            <div class="tile-val">{{ archive().onHold }}</div><div class="tile-lab">Under Legal Hold</div>
            <div class="tile-sub">disposition suspended</div>
          </div>
          <div class="tile" (click)="drillSegments('Disposition Queue', purgeQueue(), 'disposition')">
            <div class="tile-ic" [class.hot]="archive().purgeEligible > 0"></div>
            <div class="tile-val">{{ archive().purgeEligible }}</div><div class="tile-lab">Past Retention, Not Held</div>
            <div class="tile-sub">awaiting certified disposition</div>
          </div>
          <div class="tile" (click)="drillRestores()">
            <div class="tile-ic" [class.hot]="openRestores() > 0"></div>
            <div class="tile-val">{{ openRestores() }}</div><div class="tile-lab">Open Restore Requests</div>
            <div class="tile-sub">{{ restoreSla }}-day retrieval SLA</div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Retention Schedule</h3>
            <span class="section-note sm">Per record class, not one blanket number — the legal floor and the longest applicable requirement are rarely the same, and the schedule holds to the longest.</span></div>
          <table class="z-table">
            <thead><tr><th>Record Class</th><th class="num">Retention</th><th>Basis</th><th>Citation</th><th>Disposition</th></tr></thead>
            <tbody>
              @for (r of retention; track r.recordClass) {
                <tr>
                  <td class="strong">{{ r.recordClass }}</td>
                  <td class="num">{{ r.retentionYears }} years</td>
                  <td>{{ r.basis }}</td>
                  <td class="sub">{{ r.citation }}</td>
                  <td class="sub">{{ r.dispositionAction }}</td>
                </tr>
              }
            </tbody>
          </table>
          <div class="foot-note panel-pad">Directional — confirm against the plan's own retention schedule and any state overrides before this is used as survey evidence.</div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad filters"><h3 class="pt">Archive Segment Index</h3>
            <span class="section-note sm">Metadata for events that live in cold storage. Each segment's first hash derives from the one before it, so the chain stays continuous across the archive boundary.</span>
            <label class="chk"><input type="checkbox" [checked]="segIssuesOnly()" (change)="segIssuesOnly.set($any($event.target).checked)" /> Held or past retention only</label>
            <span class="count">{{ segments.length }} of {{ archive().archivedSegments }}</span>
          </div>
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortSeg('segmentId')">Segment{{ caretSeg('segmentId') }}</th>
              <th class="srt" (click)="sortSeg('periodFrom')">Period{{ caretSeg('periodFrom') }}</th>
              <th class="srt num" (click)="sortSeg('eventCount')">Events{{ caretSeg('eventCount') }}</th>
              <th class="srt" (click)="sortSeg('tier')">Tier{{ caretSeg('tier') }}</th>
              <th class="srt" (click)="sortSeg('sealedDate')">Sealed{{ caretSeg('sealedDate') }}</th>
              <th class="srt" (click)="sortSeg('lastVerified')">Last Verified{{ caretSeg('lastVerified') }}</th>
              <th class="srt" (click)="sortSeg('purgeEligible')">Purge Eligible{{ caretSeg('purgeEligible') }}</th>
              <th>Status</th><th>Disposition</th>
            </tr></thead>
            <tbody>
              @for (g of segments; track g.segmentId) {
                <tr class="clk" (click)="openSegment(g)">
                  <td class="strong mono">{{ g.segmentId }}</td>
                  <td class="mono">{{ g.periodFrom }} → {{ g.periodTo }}</td>
                  <td class="num">{{ g.eventCount | number }}</td>
                  <td>{{ g.tier }}@if (g.wormLocked) { <span class="chip">WORM</span> }</td>
                  <td class="mono">{{ g.sealedDate }}</td>
                  <td class="mono">{{ g.lastVerified }}</td>
                  <td class="mono">{{ g.purgeEligible }}</td>
                  <td>
                    @if (g.legalHold) { <span class="badge red">Legal hold</span> }
                    @else if (g.purgeEligible <= todayIso) { <span class="badge amber">Past retention</span> }
                    @else { <span class="badge green">Retained</span> }
                  </td>
                  <td class="act">
                    @if (g.legalHold || g.purgeEligible <= todayIso) {
                      <button class="btn outline sm" (click)="disposeSegment(g); $event.stopPropagation()">Dispose</button>
                    } @else { <span class="sub">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="9" class="empty">No segments match this filter.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Legal Holds</h3>
            <span class="section-note sm">A hold suspends disposition regardless of retention date — and today it is applied by hand, which is why REQ-16 is still open.</span></div>
          <table class="z-table">
            <thead><tr><th>Hold</th><th>Segment</th><th>Period</th><th class="num">Events Held</th><th>Would Otherwise Purge</th></tr></thead>
            <tbody>
              @for (g of heldSegments(); track g.segmentId) {
                <tr class="clk" (click)="openSegment(g)">
                  <td class="strong">{{ g.legalHold }}</td>
                  <td class="mono">{{ g.segmentId }}</td>
                  <td class="mono">{{ g.periodFrom }} → {{ g.periodTo }}</td>
                  <td class="num">{{ g.eventCount | number }}</td>
                  <td class="mono">{{ g.purgeEligible }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="empty">No active legal holds.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Certificates of Destruction</h3>
            <span class="section-note sm">What survives a purge. Once a segment is destroyed the events are gone, so unless something durable states what was destroyed, under whose authority and against which retention basis, there is afterwards no evidence the record existed <em>or</em> that it was lawfully destroyed. The terminal hash is retained so the chain the segment used to close can still be confirmed.</span></div>
          <table class="z-table">
            <thead><tr><th>Certificate</th><th>Segment</th><th>Period</th><th class="num">Events Destroyed</th><th>Terminal Hash</th><th>Disposed By</th><th>Approved By</th><th>Date</th></tr></thead>
            <tbody>
              @for (c of certificates(); track c.certificateId) {
                <tr class="clk" (click)="openCertificate(c)">
                  <td class="strong mono">{{ c.certificateId }}</td>
                  <td class="mono">{{ c.segmentId }}</td>
                  <td class="mono">{{ c.periodFrom }} → {{ c.periodTo }}</td>
                  <td class="num">{{ c.eventCount | number }}</td>
                  <td class="mono">{{ c.terminalHash }}</td>
                  <td>{{ c.disposedBy }}</td>
                  <td>{{ c.approvedBy }}</td>
                  <td class="mono">{{ c.disposedDate }}</td>
                </tr>
              } @empty { <tr><td colspan="8" class="empty">No segments have been disposed of. Use Dispose on a past-retention segment to see the control run.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Restore Requests</h3>
            <span class="section-note sm">Retrieval from cold storage is itself an auditable act — who asked, why, and how long it took against the {{ restoreSla }}-day SLA.</span></div>
          <table class="z-table">
            <thead><tr><th>Request</th><th>Segment</th><th>Requested By</th><th>Reason</th><th>Requested</th><th>Fulfilled</th><th>Status</th></tr></thead>
            <tbody>
              @for (r of restores; track r.requestId) {
                <tr>
                  <td class="strong mono">{{ r.requestId }}</td>
                  <td class="mono">{{ r.segmentId }}</td>
                  <td>{{ r.requestedBy }}</td>
                  <td class="sub">{{ r.reason }}</td>
                  <td class="mono">{{ r.requestedDate }}</td>
                  <td class="mono">{{ r.fulfilledDate ?? '—' }}</td>
                  <td><span class="badge" [class.green]="r.status==='Fulfilled'" [class.amber]="r.status==='In Progress'" [class.red]="r.status==='Denied'">{{ r.status }}</span></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- ================= COMPLIANCE REQUIREMENTS & GAPS ================= -->
      @case ('compliance') {
        <div class="tab-head">
          <div><h2>Compliance Requirements &amp; Gaps</h2>
            <span class="section-note">Requirement → control in the platform today → where the evidence lives → what is still missing. This is the working list for the gap, priority and next-step discussion.</span></div>
          <button class="btn outline sm" (click)="exportRegister()">Export</button>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillRegister('All Requirements', register, 'all')">
            <div class="tile-val">{{ counts().total }}</div><div class="tile-lab">Requirements Tracked</div>
          </div>
          <div class="tile" (click)="drillRegister('Requirements Met', byStatus('Met'), 'met')">
            <div class="tile-val">{{ counts().met }}</div><div class="tile-lab">Met</div>
            <div class="tile-sub">{{ counts().coverage }}% fully covered</div>
          </div>
          <div class="tile" (click)="drillRegister('Partially Met', byStatus('Partial'), 'partial')">
            <div class="tile-ic hot"></div>
            <div class="tile-val">{{ counts().partial }}</div><div class="tile-lab">Partial</div>
          </div>
          <div class="tile" (click)="drillRegister('Open Gaps', byStatus('Gap'), 'gap')">
            <div class="tile-ic hot"></div>
            <div class="tile-val">{{ counts().gap }}</div><div class="tile-lab">Gap</div>
          </div>
          <div class="tile" (click)="drillRegister('P1 — Address Before Go-Live', p1Open(), 'p1')">
            <div class="tile-ic hot"></div>
            <div class="tile-val">{{ p1Open().length }}</div><div class="tile-lab">P1 Items Still Open</div>
          </div>
        </div>

        @for (d of domains(); track d.domain) {
          <div class="panel mt-6">
            <div class="panel-pad tbl-head"><h3 class="pt">{{ d.domain }}</h3>
              <span class="section-note sm">{{ d.rows.length }} requirement(s)</span></div>
            <table class="z-table">
              <thead><tr><th>Requirement</th><th>Citation</th><th>Control Today</th><th>Status</th><th>Gap &amp; Next Step</th><th>Owner</th></tr></thead>
              <tbody>
                @for (r of d.rows; track r.id) {
                  <tr>
                    <td class="strong">{{ r.requirement }}<div class="sub mono">{{ r.id }} · {{ r.priority }}</div></td>
                    <td class="sub">{{ r.citation }}</td>
                    <td class="ctl">{{ r.control }}<div class="sub">Evidence: {{ r.evidence }}</div></td>
                    <td><span class="badge" [class.green]="r.status==='Met'" [class.amber]="r.status==='Partial'" [class.red]="r.status==='Gap'">{{ r.status }}</span></td>
                    <td class="ctl">@if (r.gap) { {{ r.gap }}<div class="next"><b>Next:</b> {{ r.nextStep }}</div> } @else { <span class="sub">—</span> }</td>
                    <td class="sub">{{ r.owner }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }

    .scopebar {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 14px; margin-bottom: 12px;
      background: var(--gray-50, #f9fafb); border: 1px solid var(--border); border-radius: var(--radius);
    }
    .sc-lab { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--gray-500); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: #fff; }
    .seg button {
      border: 0; background: transparent; padding: 5px 12px; font-size: 12.5px; cursor: pointer;
      color: var(--gray-500); font-weight: 600; white-space: nowrap;
    }
    .seg button.on { background: var(--teal-600); color: #fff; }
    .span-note { margin-left: auto; font-size: 12px; color: var(--gray-500); }
    .span-note b { color: var(--ink); font-variant-numeric: tabular-nums; }

    .tab-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .tab-head h2 { margin: 0 0 2px; }
    .head-actions { display: flex; gap: 8px; }
    .section-note { display: block; max-width: 900px; line-height: 1.5; }
    .section-note.sm { font-size: 12px; margin-right: auto; }
    .pt { margin-right: auto; }
    .tbl-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

    .tile-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; cursor: pointer;
      background: #fff; transition: box-shadow .15s; }
    .tile:hover { box-shadow: var(--shadow); }
    .tile-ic.hot { width: 10px; height: 10px; border-radius: 999px; background: var(--amber); }
    .tile-val { font-size: 22px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
    .tile-lab { font-size: 11px; color: var(--gray-500); font-weight: 600; line-height: 1.3; }
    .tile-sub { font-size: 10.5px; color: var(--gray-500); opacity: .8; }

    .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .filters .search { flex: 1 1 240px; min-width: 190px; }
    .filters .search.sm { flex: 0 1 240px; }
    .filters select { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; background: #fff; max-width: 190px; }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--gray-500); white-space: nowrap; }
    .count { margin-left: auto; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; white-space: nowrap; }

    .srt { cursor: pointer; user-select: none; white-space: nowrap; }
    .srt:hover { color: var(--teal-700); }

    .pager { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--border); }
    .pg-note { font-size: 12.5px; color: var(--gray-500); font-variant-numeric: tabular-nums; }
    .pg-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pg-of { font-size: 12.5px; color: var(--gray-500); font-variant-numeric: tabular-nums; padding: 0 4px; }
    .pg-actions .btn[disabled] { opacity: .45; cursor: default; }

    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    .sub { font-size: 11px; color: var(--gray-500); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .was { color: var(--gray-500); text-decoration: line-through; }
    .phi { color: var(--amber); font-weight: 700; }
    .warn { color: var(--amber); }
    .hot { color: var(--red, #c0392b); }
    .chip { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; background: var(--gray-100); color: var(--gray-500); }
    .chip.amber { background: #fdf3e3; color: #9a6400; }
    .good { color: var(--teal-700); }
    .agree-col { width: 250px; white-space: nowrap; }
    .act { white-space: nowrap; }
    .mbar {
      display: inline-block; vertical-align: middle; width: 110px; height: 7px;
      background: var(--gray-100); border-radius: 4px; overflow: hidden; margin-right: 10px;
    }
    .mbar > span { display: block; height: 100%; border-radius: 4px; background: var(--gray-300); }
    .mbar > span.teal { background: var(--teal-600); }
    .mbar > span.amber { background: var(--amber); }
    .mpct { font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 600; }
    .finding {
      border-left: 3px solid var(--amber); margin: 0 20px 18px; padding: 10px 0 10px 14px;
      font-size: 13px; line-height: 1.55; color: var(--ink); max-width: 76ch;
    }
    .finding b { display: block; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: #9a6400; margin-bottom: 2px; }
    .clk { cursor: pointer; }
    .ctl { max-width: 380px; line-height: 1.45; }
    .next { margin-top: 4px; font-size: 11.5px; color: var(--teal-700); }
    .lnk { color: var(--teal-700); font-weight: 600; cursor: pointer; text-decoration: underline; }
    .empty { text-align: center; color: var(--gray-500); padding: 26px; }

    .matrix-wrap { overflow-x: auto; }
    .matrix th, .matrix td { white-space: nowrap; font-size: 11.5px; }
    .matrix .sticky { position: sticky; left: 0; background: #fff; z-index: 1; white-space: normal; min-width: 190px; }
    .matrix thead .sticky { background: var(--gray-100, #f5f6f8); }
    .cell[data-v="yes"] { color: var(--teal-700); font-weight: 600; }
    .cell[data-v="no"] { color: var(--gray-500); }
    .cell[data-v="limited"] { color: #9a6400; }
  `],
})
export class AuditTraceability {
  private ix = inject(Interaction);
  private exporter = inject(Exporter);

  readonly tabs = TAB_DEFS;
  readonly sel = signal('trail');
  readonly categories = CATEGORIES;
  readonly channels = CHANNELS;
  readonly entityTypes = ENTITY_TYPES;
  readonly outcomes = OUTCOMES;
  readonly permissions = PERMISSIONS;
  readonly roles = Object.keys(PERMISSION_MATRIX) as AccessRole[];
  readonly accounts = SYSTEM_USERS;
  readonly actorOptions = [...SYSTEM_USERS].sort((a, b) => a.name.localeCompare(b.name));
  readonly register = COMPLIANCE_REGISTER;
  readonly ranges = AUDIT_RANGES;
  readonly lobs = LOBS;
  readonly cycleDays = ATTESTATION_CYCLE_DAYS;
  /** The whole retained log, independent of any filter — so the screen can always state how much
   *  history exists rather than leaving the current window to imply it. */
  readonly span = auditSpan();

  // ---- scope: this module's own controls, not the shared dashboard period bar ----
  readonly range = signal<AuditRange>('all');
  readonly lob = signal<string>('all');
  readonly rangeLabel = computed(() => AUDIT_RANGES.find((r) => r.id === this.range())?.label ?? 'All history');
  setRange(r: AuditRange) { this.range.set(r); this.page.set(0); }
  setLob(l: string) { this.lob.set(l); this.page.set(0); }

  readonly scopedEvents = computed(() => {
    const days = AUDIT_RANGES.find((r) => r.id === this.range())?.days ?? null;
    const lob = this.lob();
    return AUDIT_EVENTS.filter((e) => {
      if (days !== null) { const d = daysAgo(eventDate(e.timestamp)); if (d < 0 || d > days) return false; }
      // Infrastructure events (sign-ins, config changes, account admin) carry no LOB. They stay
      // visible under an LOB filter — hiding them would misrepresent the trail, not narrow it.
      if (lob !== 'all' && e.lob !== null && e.lob !== lob) return false;
      return true;
    });
  });

  // ---- trail filters ----
  readonly q = signal('');
  readonly cat = signal<'all' | AuditCategory>('all');
  readonly chan = signal<'all' | AuditChannel>('all');
  readonly entity = signal<'all' | AuditEntityType>('all');
  readonly actor = signal<'all' | string>('all');
  readonly outcome = signal<'all' | AuditOutcome>('all');
  readonly phiOnly = signal(false);
  readonly offHoursOnly = signal(false);
  readonly page = signal(0);

  /** Every filter setter resets paging — narrowing the results otherwise strands you on a page
   *  number the new result set no longer has. */
  private reset() { this.page.set(0); }
  setQ(v: string) { this.q.set(v); this.reset(); }
  setCat(v: 'all' | AuditCategory) { this.cat.set(v); this.reset(); }
  setChan(v: 'all' | AuditChannel) { this.chan.set(v); this.reset(); }
  setEntity(v: 'all' | AuditEntityType) { this.entity.set(v); this.reset(); }
  setActor(v: string) { this.actor.set(v); this.reset(); }
  setOutcome(v: 'all' | AuditOutcome) { this.outcome.set(v); this.reset(); }
  setPhiOnly(v: boolean) { this.phiOnly.set(v); this.reset(); }
  setOffHoursOnly(v: boolean) { this.offHoursOnly.set(v); this.reset(); }
  readonly filtersActive = computed(() =>
    !!this.q() || this.cat() !== 'all' || this.chan() !== 'all' || this.entity() !== 'all' ||
    this.actor() !== 'all' || this.outcome() !== 'all' || this.phiOnly() || this.offHoursOnly());
  clearFilters() {
    this.q.set(''); this.cat.set('all'); this.chan.set('all'); this.entity.set('all');
    this.actor.set('all'); this.outcome.set('all'); this.phiOnly.set(false); this.offHoursOnly.set(false);
    this.reset();
  }

  readonly filteredEvents = computed(() => {
    const q = this.q().trim().toLowerCase();
    const cat = this.cat(), chan = this.chan(), ent = this.entity(), act = this.actor(), out = this.outcome();
    const phi = this.phiOnly(), off = this.offHoursOnly();
    return this.scopedEvents().filter((e) =>
      (cat === 'all' || e.category === cat) &&
      (chan === 'all' || e.channel === chan) &&
      (ent === 'all' || e.entityType === ent) &&
      (act === 'all' || e.actorId === act) &&
      (out === 'all' || e.outcome === out) &&
      (!phi || e.phi) &&
      (!off || isOffHours(e.timestamp)) &&
      (!q || [e.eventId, e.actor, e.actorRole, e.action, e.entityId, e.entityType, e.correlationId, e.reasonCode ?? '', e.sourceIp, e.after ?? '', e.sessionId]
        .some((v) => String(v).toLowerCase().includes(q))));
  });

  // ---- trail sorting ----
  readonly sortKey = signal<keyof TrailRow | ''>('timestamp');
  readonly sortDir = signal<SortDir>(-1); // newest first
  sortBy(k: keyof TrailRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(k === 'timestamp' ? -1 : 1); }
    this.reset();
  }
  caret(k: keyof TrailRow) { return caretFor(this.sortKey(), k, this.sortDir()); }
  readonly sortedRows = computed(() => compareRows(this.filteredEvents().map(trailRow), this.sortKey(), this.sortDir()));

  // ---- paging: the whole history is walkable here, not just the newest slice ----
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredEvents().length / PAGE_SIZE)));
  readonly pagedRows = computed(() => {
    const start = Math.min(this.page(), this.pageCount() - 1) * PAGE_SIZE;
    return this.sortedRows().slice(start, start + PAGE_SIZE);
  });
  readonly pageStart = computed(() => this.filteredEvents().length ? Math.min(this.page(), this.pageCount() - 1) * PAGE_SIZE + 1 : 0);
  readonly pageEnd = computed(() => Math.min((Math.min(this.page(), this.pageCount() - 1) + 1) * PAGE_SIZE, this.filteredEvents().length));

  readonly phiEvents = computed(() => this.scopedEvents().filter((e) => e.phi));
  readonly decisionEvents = computed(() => this.scopedEvents().filter((e) => e.category === 'Clinical Decision'));
  readonly configEvents = computed(() => this.scopedEvents().filter((e) => e.category === 'Configuration'));
  readonly deniedEvents = computed(() => this.scopedEvents().filter((e) => e.outcome !== 'Success'));
  readonly entityCount = computed(() => new Set(this.scopedEvents().map((e) => `${e.entityType}:${e.entityId}`)).size);
  readonly actorCount = computed(() => new Set(this.scopedEvents().map((e) => e.actorId)).size);

  isOff(ts: string) { return isOffHours(ts); }

  // ---- User activity ----
  readonly signIns = computed(() => this.scopedEvents().filter((e) => e.action === 'Sign-in'));
  readonly failedLogins = computed(() => this.scopedEvents().filter((e) => e.action === 'Failed sign-in attempt'));
  readonly deniedAccess = computed(() => this.scopedEvents().filter((e) => e.outcome === 'Denied'));
  readonly breakGlass = computed(() => this.scopedEvents().filter((e) => e.action.startsWith('Break-the-glass')));
  readonly offHoursEvents = computed(() => this.scopedEvents().filter((e) => isOffHours(e.timestamp)));
  readonly exportEventsList = computed(() => this.scopedEvents().filter((e) => e.category === 'Data Export'));
  readonly exportedRows = computed(() => this.exportEventsList().reduce((s, e) => s + Number(e.after ?? 0), 0));
  readonly activeUsers = computed(() => new Set(this.signIns().map((e) => e.actorId)).size);

  readonly aq = signal('');
  readonly flaggedOnly = signal(false);
  readonly actSortKey = signal<keyof UserActivityRow | ''>('events');
  readonly actSortDir = signal<SortDir>(-1);
  sortAct(k: keyof UserActivityRow) {
    if (this.actSortKey() === k) this.actSortDir.set(this.actSortDir() === 1 ? -1 : 1);
    // Text columns read best A→Z on first click; count columns read best highest-first.
    else { this.actSortKey.set(k); this.actSortDir.set(k === 'name' || k === 'role' ? 1 : -1); }
  }
  caretAct(k: keyof UserActivityRow) { return caretFor(this.actSortKey(), k, this.actSortDir()); }
  readonly activity = computed(() => {
    const q = this.aq().trim().toLowerCase();
    const rows = userActivityRollup(this.scopedEvents()).filter((a) =>
      (!this.flaggedOnly() || a.signals.length > 0) &&
      (!q || [a.name, a.userId, a.role, a.department].some((v) => v.toLowerCase().includes(q))));
    return compareRows(rows, this.actSortKey(), this.actSortDir());
  });

  // ---- AI oversight ----
  readonly targets = AI_TARGETS;
  readonly gates = PRODUCTION_CONFIG;
  readonly agents = AGENTS;
  /** Scoped by the module's own Range/LOB controls, same as everything else on this module. */
  readonly aiRows = computed(() => {
    const days = AUDIT_RANGES.find((r) => r.id === this.range())?.days ?? null;
    return aiScope(this.lob(), days === null ? undefined : days);
  });
  readonly ai = computed(() => aiSummary(this.aiRows()));
  readonly calib = computed(() => calibration(this.aiRows()));
  readonly overconfidentBands = computed(() => this.calib().filter((c) => c.verdict === 'Overconfident').map((c) => c.band));
  readonly driftRows = computed(() => drift(this.aiRows()));
  readonly reasons = computed(() => overrideReasons(this.aiRows()));
  /** Under-sampled reviewers always sink to the bottom, whatever the sort. Their rate is not
   *  reported, so letting it position them in a list ordered by that rate would be the one thing
   *  the sample floor exists to prevent. */
  readonly byReviewer = computed(() => {
    const rows = reviewerConcordance(this.aiRows());
    const sorted = compareRows(rows, this.revSortKey(), this.revSortDir());
    return [...sorted.filter((r) => r.adequate), ...sorted.filter((r) => !r.adequate)];
  });
  /** Grouped by the procedure the criteria govern, not by criteria-set version — versioning
   *  fragments each procedure three ways and leaves samples of three or four, which say nothing.
   *  Groups below the band sample floor are dropped for the same reason. */
  readonly byCriteria = computed(() =>
    concordanceBy(this.aiRows(), (r) => r.procedure).filter((g) => g.n >= AI_TARGETS.minReviewerSample / 2).slice(0, 12));
  readonly concordantRows = computed(() => this.aiRows().filter((r) => r.agreed));
  readonly overriddenRows = computed(() => this.aiRows().filter((r) => r.outcome === 'Overridden'));
  readonly modelAttributableRows = computed(() => this.overriddenRows().filter((r) => r.overrideReason && MODEL_ATTRIBUTABLE.includes(r.overrideReason)));
  readonly pendedRows = computed(() => this.aiRows().filter((r) => r.pended));
  readonly pendReasons = computed(() => pendMix(this.aiRows()));
  readonly models = computed(() => modelMix(this.aiRows()));
  tokensLabel() { const t = this.ai().tokens; return t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : Math.round(t / 1000) + 'k'; }
  drillPend(reason: PendReason) { this.drillAi(`Pended — ${reason}`, this.pendedRows().filter((r) => r.pendReason === reason), `pend-${slug(reason)}`); }
  readonly autoRows = computed(() => this.aiRows().filter((r) => r.autoCleared));
  reasonPct(count: number): number {
    const total = this.overriddenRows().length;
    return total ? Math.round((count / total) * 100) : 0;
  }
  readonly distribution = computed(() => confidenceDistribution(this.aiRows()));
  readonly flags = computed(() => flagMix(this.aiRows()));
  readonly flaggedRows = computed(() => this.aiRows().filter((r) => r.flags.length > 0));
  readonly ungroundedRows = computed(() => this.aiRows().filter((r) => !r.grounded));
  readonly panelSplitRows = computed(() => this.aiRows().filter((r) => r.panel && !r.converged));
  /** Each agent's P95 as a share of the summed path — a rough read on where the time goes. P95s do
   *  not add up to an end-to-end P95, so this is presented as a share, never as a total. */
  agentSharePct(p95: number): number {
    const total = AGENTS.reduce((s, a) => s + a.p95Sec, 0);
    return total ? Math.round((p95 / total) * 100) : 0;
  }
  drillFlag(flag: InvestigationFlag) {
    this.drillAi(`Flagged — ${flag}`, this.aiRows().filter((r) => r.flags.includes(flag)), `flag-${slug(flag)}`);
  }
  drillBandRaw(band: string) {
    this.drillAi(`Confidence Band ${band}`, this.aiRows().filter((r) => r.band === band), `dist-${slug(band)}`);
  }

  readonly revSortKey = signal<'reviewer' | 'scored' | 'agreed' | 'overrides' | 'pct' | ''>('pct');
  readonly revSortDir = signal<SortDir>(1);
  sortRev(k: 'reviewer' | 'scored' | 'agreed' | 'overrides' | 'pct') {
    if (this.revSortKey() === k) this.revSortDir.set(this.revSortDir() === 1 ? -1 : 1);
    // Lowest agreement first by default — that is the row worth looking at.
    else { this.revSortKey.set(k); this.revSortDir.set(k === 'reviewer' ? 1 : -1); }
  }
  caretRev(k: 'reviewer' | 'scored' | 'agreed' | 'overrides' | 'pct') { return caretFor(this.revSortKey(), k, this.revSortDir()); }

  /** Run-ledger column set, in Symphony's order and its words: member, policy, outcome, agents,
   *  models used, then the audit-specific columns and the run's cost. */
  private readonly AI_COLUMNS = ['Auth', 'Member', 'Policy', 'LOB', 'Outcome', 'Pend Reason', 'Agents', 'Models Used', 'Panel',
    'Recommendation', 'Confidence', 'Band', 'Final Determination', 'Agreed', 'Grounded', 'Converged', 'Flags',
    'Override Reason', 'Overridden By', 'Reviewer', 'Tokens', 'Cost', 'Latency', 'Workflow', 'Bundle', 'Model',
    'Criteria Set', 'Scored', 'Decided'];
  private aiRow(r: AiDecisionRecord): (string | number)[] {
    return [r.authId, r.member, r.procedure, r.lob, r.outcome, r.pendReason ?? '—', `${r.agentsCompleted}/${r.agentsTotal}`,
      r.modelsUsed, r.panel ? 'panel' : '—', r.recommendation, r.confidence.toFixed(2), r.band, r.finalDecision,
      r.agreed ? 'Yes' : 'No', `${r.groundedMet}/${r.groundedTotal}`, r.panel ? (r.converged ? 'Yes' : 'SPLIT') : '—',
      r.flags.join('; ') || '—', r.overrideReason ?? '—', r.overriddenBy ?? '—', r.reviewer,
      r.tokens, `$${r.cost.toFixed(2)}`, `${r.latencySec}s`, r.workflowVersion, r.bundle, r.model,
      r.criteriaSet, r.scoredDate, r.decidedDate];
  }
  /** Column 0 is 'Auth' rather than 'Auth ID' on purpose — these are compliance records, so the
   *  Explorer treats them as informational and offers no Reassign/Balance/Escalate, the same
   *  treatment the IRR log gets. */
  drillAi(title: string, rows: AiDecisionRecord[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${rows.length.toLocaleString()} determination(s) · run ledger · ${this.rangeLabel()}`,
      columns: this.AI_COLUMNS, rows: rows.map((r) => this.aiRow(r)),
      exportName: `ai-oversight-${slugName}_2026-07-17`, memberColumn: 1,
    });
  }
  drillBand(c: CalibrationRow) {
    this.drillAi(`Confidence Band ${c.band} — claimed ${c.claimed}%, observed ${c.observed}%`,
      this.aiRows().filter((r) => r.band === c.band), `band-${slug(c.band)}`);
  }
  drillReason(reason: OverrideReason) {
    this.drillAi(`Overrides — ${reason}`, this.overriddenRows().filter((r) => r.overrideReason === reason), `reason-${slug(reason)}`);
  }
  drillReviewer(reviewer: string) {
    this.drillAi(`AI Agreement — ${reviewer}`, this.aiRows().filter((r) => r.reviewer === reviewer), `reviewer-${slug(reviewer)}`);
  }
  drillCriteria(key: string) {
    this.drillAi(`AI Agreement — ${key}`, this.aiRows().filter((r) => r.criteriaSet === key), `criteria-${slug(key)}`);
  }
  exportAi() {
    this.exporter.open({
      title: 'AI Oversight', name: 'ai-oversight_2026-07-17',
      columns: this.AI_COLUMNS, rows: this.aiRows().map((r) => this.aiRow(r)),
    });
  }

  // ---- Governance ----
  readonly roleCount = computed(() => new Set(SYSTEM_USERS.map((u) => u.role)).size);
  readonly noMfa = computed(() => SYSTEM_USERS.filter((u) => !u.mfaEnrolled));
  readonly mfaCoverage = computed(() => Math.round(((SYSTEM_USERS.length - this.noMfa().length) / SYSTEM_USERS.length) * 100));
  readonly attestationOverdue = computed(() => SYSTEM_USERS.filter((u) => attestationAgeDays(u) > ATTESTATION_CYCLE_DAYS));

  readonly gq = signal('');
  readonly invSortKey = signal<InvKey | ''>('name');
  readonly invSortDir = signal<SortDir>(1);
  sortInv(k: InvKey) {
    if (this.invSortKey() === k) this.invSortDir.set(this.invSortDir() === 1 ? -1 : 1);
    else { this.invSortKey.set(k); this.invSortDir.set(k === 'reviewAge' ? -1 : 1); }
  }
  caretInv(k: InvKey) { return caretFor(this.invSortKey(), k, this.invSortDir()); }
  readonly inventory = computed((): InventoryRow[] => {
    const q = this.gq().trim().toLowerCase();
    const rows: InventoryRow[] = SYSTEM_USERS
      .filter((u) => !q || [u.name, u.userId, u.role, u.department].some((v) => v.toLowerCase().includes(q)))
      .map((u) => ({ ...u, mfa: u.mfaEnrolled ? 'Enrolled' : 'Password only', reviewAge: attestationAgeDays(u) }));
    return compareRows(rows, this.invSortKey() as keyof InventoryRow | '', this.invSortDir());
  });

  matrix(role: AccessRole, p: string): string { return PERMISSION_MATRIX[role]?.[p as Permission] ?? '—'; }
  verdict(role: AccessRole, p: string): 'yes' | 'no' | 'limited' {
    const v = this.matrix(role, p);
    if (v.startsWith('No')) return 'no';
    return v.includes('—') || v.includes('only') ? 'limited' : 'yes';
  }

  readonly sodResults = computed(() => evaluateSod(this.scopedEvents()));
  readonly sodConflicts = computed(() => this.sodResults().flatMap((r) => r.conflicts));

  // ---- Retention & archive ----
  readonly retention: RetentionPolicy[] = RETENTION_POLICIES;
  /** The signed-in supervisor shown in the app's own top bar. */
  readonly currentUser = 'Christina Lawson';
  readonly restores = RESTORE_REQUESTS;
  readonly restoreSla = RESTORE_REQUESTS.length ? RESTORE_REQUESTS[0].slaDays : 5;
  readonly archive = computed(() => archiveSummary(this.disp.remaining()));
  readonly todayIso = auditSpan().to;
  readonly segIssuesOnly = signal(false);
  readonly segSortKey = signal<keyof ArchiveSegment | ''>('periodFrom');
  readonly segSortDir = signal<SortDir>(-1);
  sortSeg(k: keyof ArchiveSegment) {
    if (this.segSortKey() === k) this.segSortDir.set(this.segSortDir() === 1 ? -1 : 1);
    else { this.segSortKey.set(k); this.segSortDir.set(k === 'eventCount' ? -1 : 1); }
  }
  caretSeg(k: keyof ArchiveSegment) { return caretFor(this.segSortKey(), k, this.segSortDir()); }
  get segments(): ArchiveSegment[] {
    const rows = this.disp.remaining().filter((g) => !this.segIssuesOnly() || g.legalHold || g.purgeEligible <= this.todayIso);
    return compareRows(rows, this.segSortKey(), this.segSortDir());
  }
  heldSegments() { return this.disp.remaining().filter((g) => !!g.legalHold); }
  purgeQueue() { return this.disp.remaining().filter((g) => g.purgeEligible <= this.todayIso && !g.legalHold); }
  openRestores() { return RESTORE_REQUESTS.filter((r) => r.status === 'In Progress').length; }

  verifyArchive() {
    const r = verifyArchiveChain();
    if (r.brokenAt) this.ix.toast(`Archive chain broken at ${r.brokenAt} — ${r.verified} segment(s) verified before the break.`, 'warn');
    else this.ix.toast(`Archive chain continuous — ${r.verified} sealed segments verified, each chaining to the next and on into the online store.`);
  }
  private readonly SEGMENT_COLUMNS = ['Segment', 'Period From', 'Period To', 'Events', 'Tier', 'WORM Locked', 'Sealed', 'Last Verified', 'Chain Verified', 'Purge Eligible', 'Legal Hold', 'First Hash', 'Last Hash'];
  private segmentRow(g: ArchiveSegment): (string | number)[] {
    return [g.segmentId, g.periodFrom, g.periodTo, g.eventCount, g.tier, g.wormLocked ? 'Yes' : 'No', g.sealedDate,
      g.lastVerified, g.verified ? 'Yes' : 'No', g.purgeEligible, g.legalHold ?? '—', g.firstHash, g.lastHash];
  }
  drillSegments(title: string, gs: ArchiveSegment[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${gs.length} sealed segment(s) · ${gs.reduce((s, g) => s + g.eventCount, 0).toLocaleString()} archived events`,
      columns: this.SEGMENT_COLUMNS, rows: gs.map((g) => this.segmentRow(g)), exportName: `audit-archive-${slugName}_2026-07-17`,
    });
  }
  drillRestores() {
    this.ix.openExplorer({
      title: 'Restore Requests', context: `${RESTORE_REQUESTS.length} retrieval request(s) from cold storage`,
      columns: ['Request', 'Segment', 'Requested By', 'Reason', 'Requested', 'Fulfilled', 'SLA (days)', 'Status'],
      rows: RESTORE_REQUESTS.map((r) => [r.requestId, r.segmentId, r.requestedBy, r.reason, r.requestedDate, r.fulfilledDate ?? '—', r.slaDays, r.status]),
      exportName: 'audit-archive-restores_2026-07-17',
    });
  }
  openSegment(g: ArchiveSegment) {
    const held = !!g.legalHold;
    const pastRetention = g.purgeEligible <= this.todayIso;
    this.ix.openDrawer({
      title: `${g.segmentId} · ${g.periodFrom} → ${g.periodTo}`,
      subtitle: `${g.eventCount.toLocaleString()} events · sealed ${g.sealedDate}`,
      badge: { text: held ? 'Legal hold' : pastRetention ? 'Past retention' : 'Retained', tone: held ? 'red' : pastRetention ? 'amber' : 'green' },
      fields: [
        { label: 'Storage Tier', value: g.tier },
        { label: 'Write-Once Locked', value: g.wormLocked ? 'Yes — object lock' : 'No', tone: g.wormLocked ? 'green' : 'red' },
        { label: 'Events', value: g.eventCount.toLocaleString() },
        { label: 'Sealed', value: g.sealedDate },
        { label: 'Last Chain Verification', value: g.lastVerified },
        { label: 'Chain Verified', value: g.verified ? 'Yes' : 'No', tone: g.verified ? 'green' : 'red' },
        { label: 'Purge Eligible', value: g.purgeEligible, tone: pastRetention && !held ? 'amber' : undefined },
        { label: 'Legal Hold', value: g.legalHold ?? '—', tone: held ? 'red' : undefined },
        { label: 'First Hash', value: g.firstHash },
        { label: 'Last Hash', value: g.lastHash },
      ],
      note: held
        ? `Disposition is suspended on this segment by ${g.legalHold}. The hold is recorded here but applied by hand — nothing yet blocks a purge job from running against it, which is the open half of REQ-16.`
        : pastRetention
          ? 'This segment is past its retention date and not held. It sits in the disposition queue — but there is no certified-destruction step yet, so purging it today would leave no evidence it ever existed (REQ-17).'
          : 'Retained under the schedule. Its first hash derives from the previous segment\u2019s last hash, so the chain is continuous from here into the online store.',
    });
  }
  exportArchive() {
    this.exporter.open({
      title: 'Archive Segment Index', name: 'audit-archive-index_2026-07-17',
      columns: this.SEGMENT_COLUMNS, rows: ARCHIVE_SEGMENTS.map((g) => this.segmentRow(g)),
    });
  }

  // ---- certified disposition ----
  private disp = inject(Disposition);
  private data = inject(DashboardData);
  readonly certificates = computed(() => this.disp.certificates());

  /** The refusal path is the demo. A held segment is stopped by the control itself, naming the hold
   *  that stopped it — not by a note on screen saying it ought to be. */
  disposeSegment(g: ArchiveSegment) {
    const check = this.disp.canDispose(g, this.todayIso);
    if (!check.ok) { this.ix.toast(check.reason, 'warn'); return; }

    const rule = this.retention.find((r) => r.recordClass === 'Audit & Security Event');
    const basis = rule ? `${rule.recordClass} — ${rule.retentionYears} years (${rule.citation})` : 'Retention schedule';
    // Destroying a record is the least reversible action in the platform, so it takes the same
    // two-person control a configuration change takes: a countersignature from someone other than
    // the person running it.
    this.ix.choose({
      title: `Dispose of ${g.segmentId}`,
      body: `${g.eventCount.toLocaleString()} events covering ${g.periodFrom} to ${g.periodTo}, past retention since ${g.purgeEligible}. Disposition requires an independent approver.`,
      label: 'Countersigned by',
      options: DISPOSITION_APPROVERS.filter((n) => n !== this.currentUser),
      confirmLabel: 'Continue', tone: 'red',
      onChoose: (approver) => {
        this.ix.ask({
          title: `Confirm destruction of ${g.segmentId}`,
          body: `This cannot be undone. A certificate of destruction will be issued and written into the audit trail, retaining the segment's terminal hash so the chain can still be verified afterwards.`,
          breakdown: [{ count: g.eventCount, label: 'events', target: 'permanent destruction' }],
          confirmLabel: 'Dispose', tone: 'red',
          onConfirm: () => {
            const cert = this.disp.dispose(g, this.currentUser, approver, basis, this.todayIso);
            this.ix.toast(`${g.segmentId} disposed — certificate ${cert.certificateId} issued and logged.`);
            this.data.addHistory('check', 'Archive segment disposed', `${g.segmentId} · ${g.eventCount.toLocaleString()} events · certificate ${cert.certificateId}`);
          },
        });
      },
    });
  }
  openCertificate(c: DispositionCertificate) {
    this.ix.openDrawer({
      title: `${c.certificateId}`,
      subtitle: `${c.segmentId} · ${c.eventCount.toLocaleString()} events destroyed ${c.disposedDate}`,
      badge: { text: 'Certified disposition', tone: 'green' },
      fields: [
        { label: 'Segment', value: c.segmentId },
        { label: 'Period Covered', value: `${c.periodFrom} → ${c.periodTo}` },
        { label: 'Events Destroyed', value: c.eventCount.toLocaleString() },
        { label: 'Terminal Hash (retained)', value: c.terminalHash },
        { label: 'Retention Basis', value: c.retentionBasis },
        { label: 'Purge Eligible From', value: c.purgeEligible },
        { label: 'Method', value: c.method },
        { label: 'Disposed By', value: c.disposedBy },
        { label: 'Countersigned By', value: c.approvedBy },
        { label: 'Date', value: c.disposedDate },
      ],
      note: 'The events themselves are gone. This record, and the terminal hash it carries, are what remain as evidence that the segment existed and was lawfully destroyed — which is the whole purpose of certifying a disposition rather than simply running one.',
    });
  }
  exportCertificates() {
    this.exporter.open({
      title: 'Certificates of Destruction', name: 'audit-disposition-certificates_2026-07-17',
      columns: ['Certificate', 'Segment', 'Period From', 'Period To', 'Events Destroyed', 'Terminal Hash', 'Retention Basis', 'Method', 'Disposed By', 'Approved By', 'Date'],
      rows: this.certificates().map((c) => [c.certificateId, c.segmentId, c.periodFrom, c.periodTo, c.eventCount, c.terminalHash, c.retentionBasis, c.method, c.disposedBy, c.approvedBy, c.disposedDate]),
    });
  }

  // ---- Compliance register ----
  readonly counts = computed(() => registerCounts());
  byStatus(s: ComplianceRequirement['status']) { return this.register.filter((r) => r.status === s); }
  readonly p1Open = computed(() => this.register.filter((r) => r.priority === 'P1' && r.status !== 'Met'));
  readonly domains = computed(() => {
    const order = [...new Set(this.register.map((r) => r.domain))];
    return order.map((domain) => ({ domain, rows: this.register.filter((r) => r.domain === domain) }));
  });

  // ---- actions ----
  verify() {
    const r = verifyChain(AUDIT_EVENTS);
    if (r.brokenAt) this.ix.toast(`Chain broken at ${r.brokenAt} — ${r.verified.toLocaleString()} event(s) verified before the break.`, 'warn');
    else this.ix.toast(`Hash chain intact — ${r.verified.toLocaleString()} events verified, no gaps or alterations.`);
  }

  drillEvents(title: string, evs: AuditEvent[], slugName: string) {
    const rows = [...evs].reverse();
    this.ix.openExplorer({
      title, context: `${rows.length.toLocaleString()} audit event(s) · ${this.rangeLabel()}`,
      columns: EVENT_COLUMNS, rows: rows.map(eventRow), exportName: `audit-trail-${slugName}_2026-07-17`,
    });
  }
  openEvent(e: AuditEvent) {
    this.ix.openDrawer({
      title: `${e.eventId} · ${e.action}`,
      subtitle: `${e.actor} (${e.actorRole}) · ${e.timestamp.replace('T', ' ')}`,
      badge: { text: e.outcome, tone: e.outcome === 'Success' ? 'green' : e.outcome === 'Denied' ? 'amber' : 'red' },
      fields: [
        { label: 'Category', value: e.category },
        { label: 'Record', value: `${e.entityType} ${e.entityId}` },
        { label: 'Member', value: e.memberId ?? '—' },
        { label: 'Line of Business', value: e.lob ?? '—' },
        { label: 'Field Changed', value: e.field ?? '—' },
        { label: 'Before', value: e.before ?? '—' },
        { label: 'After', value: e.after ?? '—' },
        { label: 'Channel', value: e.channel },
        { label: 'Source IP', value: e.sourceIp, tone: isExternalIp(e.sourceIp) ? 'amber' : undefined },
        { label: 'Session', value: e.sessionId },
        { label: 'Correlation ID', value: e.correlationId },
        { label: 'Reason Code', value: e.reasonCode ?? '—' },
        { label: 'PHI Exposed', value: e.phi ? 'Yes' : 'No', tone: e.phi ? 'amber' : undefined },
        { label: 'Previous Hash', value: e.prevHash },
        { label: 'Record Hash', value: e.recordHash },
      ],
      note: `This record is chained to the event before it. Altering any field above changes this record's hash and every hash after it, which is what makes the alteration detectable — run "Verify chain" on the Audit Trail tab to re-walk it.`,
      actions: [{
        label: 'Lineage', tone: 'teal',
        run: () => this.drillEvents(`Lineage — ${e.entityId}`, AUDIT_EVENTS.filter((x) => x.correlationId === e.correlationId), slug(e.entityId)),
      }],
    });
  }
  drillUser(a: UserActivityRow) {
    this.drillEvents(`Activity — ${a.name}`, this.scopedEvents().filter((e) => e.actorId === a.userId), `user-${slug(a.userId)}`);
  }
  drillAccountTrail(u: { userId: string; name: string }) {
    this.drillEvents(`Activity — ${u.name}`, this.scopedEvents().filter((e) => e.actorId === u.userId), `user-${slug(u.userId)}`);
  }
  drillAccounts(title: string, us: SystemUser[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${us.length} account(s)`,
      columns: ['Account', 'User ID', 'Access Role', 'Department', 'MFA', 'Last Entitlement Review', 'Days Since Review', 'Last Sign-in', 'Status'],
      rows: us.map((u) => [u.name, u.userId, u.role, u.department, u.mfaEnrolled ? 'Enrolled' : 'Password only', u.lastAccessReview, attestationAgeDays(u), u.lastLogin, u.status]),
      exportName: `audit-accounts-${slugName}_2026-07-17`,
    });
  }
  drillSod(r: SodResult) {
    this.ix.openExplorer({
      title: `${r.rule.id} — ${r.rule.name}`, context: `${r.conflicts.length} conflict(s) detected in ${this.rangeLabel().toLowerCase()}`,
      columns: ['Rule', 'Subject', 'Detail', 'Citation', 'Event ID'],
      rows: r.conflicts.map((c: SodConflictRow) => [c.ruleId, c.subject, c.detail, c.citation, c.eventIds.join(', ')]),
      exportName: `audit-sod-${slug(r.rule.id)}_2026-07-17`,
    });
  }
  drillRegister(title: string, rows: ComplianceRequirement[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${rows.length} requirement(s)`,
      columns: ['ID', 'Domain', 'Requirement', 'Citation', 'Control Today', 'Evidence', 'Status', 'Priority', 'Gap', 'Next Step', 'Owner'],
      rows: rows.map((r) => [r.id, r.domain, r.requirement, r.citation, r.control, r.evidence, r.status, r.priority, r.gap ?? '—', r.nextStep ?? '—', r.owner]),
      exportName: `audit-compliance-${slugName}_2026-07-17`,
    });
  }

  exportEvents() {
    this.exporter.open({
      title: 'Audit Trail', name: 'audit-trail_2026-07-17',
      columns: EVENT_COLUMNS, rows: this.sortedRows().map((r) => eventRow(r.ev)),
    });
  }
  exportActivity() {
    this.exporter.open({
      title: 'User Activity Monitoring', name: 'audit-user-activity_2026-07-17',
      columns: ['Account', 'User ID', 'Role', 'Events', 'Sessions', 'PHI Events', 'Off-Hours', 'Failed Sign-ins', 'Denied Access', 'Break-the-Glass', 'Exports', 'Rows Exported', 'External IP', 'Last Activity', 'Signals'],
      rows: this.activity().map((a) => [a.name, a.userId, a.role, a.events, a.sessions, a.phi, a.offHours, a.failedLogins, a.deniedAccess, a.breakGlass, a.exports, a.exportedRows, a.externalIp, a.lastActivity || '—', a.signals.join('; ') || '—']),
    });
  }
  exportGovernance() {
    this.exporter.open({
      title: 'Role → Permission Matrix', name: 'audit-permission-matrix_2026-07-17',
      columns: ['Permission', ...this.roles],
      rows: this.permissions.map((p) => [p, ...this.roles.map((r) => this.matrix(r, p))]),
    });
  }
  exportRegister() {
    this.exporter.open({
      title: 'Compliance Requirements & Gaps', name: 'audit-compliance-register_2026-07-17',
      columns: ['ID', 'Domain', 'Requirement', 'Citation', 'Control Today', 'Evidence', 'Status', 'Priority', 'Gap', 'Next Step', 'Owner'],
      rows: this.register.map((r) => [r.id, r.domain, r.requirement, r.citation, r.control, r.evidence, r.status, r.priority, r.gap ?? '—', r.nextStep ?? '—', r.owner]),
    });
  }
}
