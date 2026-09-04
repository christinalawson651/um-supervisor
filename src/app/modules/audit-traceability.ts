import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  AUDIT_EVENTS, AuditEvent, AuditCategory, AuditChannel, AuditEntityType, AuditOutcome,
  SYSTEM_USERS, SystemUser, AccessRole,
  PERMISSIONS, Permission, PERMISSION_MATRIX, COMPLIANCE_REGISTER, ComplianceRequirement, registerCounts,
  verifyChain, isOffHours, isExternalIp, eventDate, governanceSection,
  POLICY_RULES, resolvePolicy, stateOf, marketOf, STATES_BY_LOB,
  AUDIT_RANGES, AuditRange, auditSpan, userActivityRollup, UserActivityRow,
  evaluateSod, SodResult, SodConflictRow, attestationAgeDays, ATTESTATION_CYCLE_DAYS,
  activityBuckets, weekdayBuckets, ActivityBucket, ActivityGrain, ACTIVITY_GRAINS,
  commonalityHits, CommonalityHit, CommonalityFlag, COMMONALITY_STRENGTH, breakGlassAccesses,
  RETENTION_POLICIES, ARCHIVE_SEGMENTS, ArchiveSegment, RESTORE_REQUESTS, RestoreRequest, RetentionPolicy,
  slaLabel, slaHoursFor, StorageTier,
  archiveSummary, verifyArchiveChain,
  memberAuditRollup, MemberAuditRow, memberTimeline, TimelineThread, membersForUser, UserMemberRow, memberName,
} from '../data/audit-trail';
import { Interaction } from '../shared/interaction';
import { Nav } from '../shared/nav';
import { Exporter } from '../shared/exporter';
import { LOBS, daysAgo, TODAY_ISO } from '../data/case-fields';
import { diffWords, DiffOp, EditKind, EDIT_KINDS } from '../data/ai-oversight';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Disposition, DispositionCertificate, DISPOSITION_APPROVERS } from '../shared/disposition';
import { NOTIFICATION_RULES } from '../shared/alerts';
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
  // Sits next to User Activity deliberately: the two are the same evidence pivoted opposite ways,
  // and an auditor moves between them constantly.
  { key: 'member', label: 'Member Timeline' },
  { key: 'governance', label: 'Governance & Access Controls' },
  { key: 'retention', label: 'Retention & Archive' },
  { key: 'compliance', label: 'Compliance Requirements & Gaps' },
];

const CATEGORIES: AuditCategory[] = ['Access', 'Clinical Decision', 'Case Management', 'Correspondence', 'Administrative', 'Configuration', 'Security', 'Data Export'];
const CHANNELS: AuditChannel[] = ['Web UI', 'API', 'Batch Interface', 'Fax / OCR Intake', 'System Rule'];
const ENTITY_TYPES: AuditEntityType[] = ['Authorization', 'CM Case', 'Member', 'Appeal', 'Report', 'User Account', 'Configuration'];
const OUTCOMES: AuditOutcome[] = ['Success', 'Denied', 'Failed'];
const PAGE_SIZE = 50;

const EVENT_COLUMNS = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Category', 'Action', 'Entity Type', 'Entity ID', 'Member', 'Member ID', 'Screen', 'Control', 'Field', 'Before', 'After', 'Channel', 'Source IP', 'Session', 'Correlation ID', 'Reason Code', 'PHI', 'Outcome', 'Record Hash'];
function eventRow(e: AuditEvent): (string | number)[] {
  return [e.eventId, e.timestamp.replace('T', ' '), e.actor, e.actorRole, e.category, e.action, e.entityType, e.entityId,
    e.memberId ? memberName(e.memberId) : (e.memberCount ? `${e.memberCount} members — extract` : 'Not member-specific'),
    e.memberId ?? '—', e.screen ?? '—', e.control ?? '—', e.field ?? '—', e.before ?? '—', e.after ?? '—', e.channel, e.sourceIp, e.sessionId,
    e.correlationId, e.reasonCode ?? '—', e.phi ? 'Yes' : 'No', e.outcome, e.recordHash];
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
const govSection = governanceSection;

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
          <div class="tile" (click)="drillEvents('Field-Level Edits', fieldEditEvents(), 'field-edits')">
            <div class="tile-val">{{ fieldEditEvents().length | number }}</div><div class="tile-lab">Field-Level Edits</div>
            <div class="tile-sub">value changed, with what it was before</div>
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
            <label class="chk"><input type="checkbox" [checked]="editsOnly()" (change)="setEditsOnly($any($event.target).checked)" /> Field edits only</label>
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
                  <td class="mono">{{ r.ev.entityId }}<div class="sub">{{ r.ev.entityType }}@if (r.ev.phi) { · <span class="phi">PHI</span> }
                    @if (r.ev.memberCount) { · <b>{{ r.ev.memberCount | number }} members</b> }</div>
                    @if (r.ev.memberId) {
                      <div class="memln">
                        @if (hasMemberName(r.ev.memberId)) {
                          <button class="lnk" (click)="openMemberFromId(r.ev.memberId!); $event.stopPropagation()">{{ memberNameOf(r.ev.memberId) }}</button>
                        } @else { <span class="sub mono">{{ r.ev.memberId }}</span> }
                      </div>
                    }</td>
                  <td>@if (r.ev.field) {
                      @if (r.ev.changeAction) { <span class="chg" [attr.data-a]="r.ev.changeAction">{{ r.ev.changeAction }}</span> }
                      <span class="sub">{{ r.ev.field }}:</span> <span class="was">{{ r.ev.before ?? '—' }}</span> → <b>{{ r.ev.after }}</b>
                      @if (r.ev.screen) { <div class="scr">{{ r.ev.screen }} · <span class="ctl">{{ r.ev.control }}</span></div> }
                    } @else { <span class="sub">—</span> }</td>
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
          <div class="tile" (click)="drillAi('Rationale Shipped Exactly As Generated', verbatimRows(), 'verbatim')">
            <div class="tile-ic" [class.hot]="verbatimPct() >= 70"></div>
            <div class="tile-val">{{ verbatimPct() }}%</div><div class="tile-lab">Rationale Shipped Verbatim</div>
            <div class="tile-sub">of clinician-reviewed cases · watch for automation bias</div>
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
          <div class="panel-pad tbl-head"><h3 class="pt">What the Model Said, and What Went Out</h3>
            <span class="section-note sm">The rationale the model presented to the reviewer, what the clinician changed, and the text recorded on the determination. A structured override reason says a change happened; only these two say what it was.</span></div>
          <div class="panel-pad narrbar">
            <span class="albl">Show</span>
            <button class="qp" [class.on]="narrFilter() === 'edited'" (click)="narrFilter.set('edited')">Edited<span class="qn">{{ editedRows().length | number }}</span></button>
            <button class="qp" [class.on]="narrFilter() === 'verbatim'" (click)="narrFilter.set('verbatim')">Shipped verbatim<span class="qn">{{ verbatimRows().length | number }}</span></button>
            <span class="spacer"></span>
            @for (k of editKinds; track k) {
              <button class="qp sm" [class.on]="narrKind() === k" (click)="narrKind.set(narrKind() === k ? '' : k)">{{ k }}<span class="qn">{{ editKindCount(k) }}</span></button>
            }
          </div>
          <table class="z-table">
            <thead><tr>
              <th>Authorization</th><th>Member</th><th>Reviewer</th><th>Recommendation</th>
              <th class="num">Words Changed</th><th>What Changed</th><th>Outcome</th>
            </tr></thead>
            <tbody>
              @for (r of narrativeRows(); track r.authId) {
                <tr class="clk" (click)="openNarrative(r)">
                  <td class="strong mono">{{ r.authId }}</td>
                  <td>{{ r.member }}<div class="sub">{{ r.lob }}</div></td>
                  <td>@if (r.reviewer !== '—') {
                        <button class="lnk" (click)="openActor(r.reviewer); $event.stopPropagation()">{{ r.reviewer }}</button>
                      } @else { <span class="sub">{{ reviewerLabel(r) }}</span> }
                      <div class="sub">signed {{ signerFor(r.authId) }}</div></td>
                  <td>{{ r.recommendation }}<div class="sub">final: {{ r.finalDecision }}</div></td>
                  <td class="num">@if (r.narrativeEdited) { <b>{{ r.narrativeChangePct }}%</b> } @else { <span class="sub">verbatim</span> }</td>
                  <td>@for (k of r.editKinds; track k) { <span class="chip">{{ k }}</span> }
                      @if (!r.editKinds.length) { <span class="sub">accepted as generated</span> }</td>
                  <td>{{ r.outcome }}
                    @if (r.overriddenBy) { <div class="sub">by <button class="lnk" (click)="openActor(r.overriddenBy!); $event.stopPropagation()">{{ r.overriddenBy }}</button></div> }
                    <div class="sub"><button class="lnk" (click)="drillGovernanceRecord(r.authId, 'COR-' + r.authId); $event.stopPropagation()">Who did what ›</button></div>
                  </td>
                </tr>
              } @empty { <tr><td colspan="7" class="empty">Nothing matches this filter.</td></tr> }
            </tbody>
          </table>
          @if (narrativeOverflow() > 0) {
            <div class="panel-pad sub">Showing the first {{ narrativeRows().length }} · {{ narrativeOverflow() | number }} more —
              <button class="lnk" (click)="drillAi('Rationale Changes', narrativeAll(), 'narratives')">open all in explorer</button></div>
          }
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
              <th>Account</th>
            </tr></thead>
            <tbody>
              @for (r of byReviewer(); track r.reviewer) {
                <tr class="clk" (click)="drillReviewer(r.reviewer)">
                  <td class="strong"><button class="lnk" (click)="openActor(r.reviewer); $event.stopPropagation()">{{ r.reviewer }}</button></td>
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
                  <td><button class="lnk" (click)="openActor(r.reviewer); $event.stopPropagation()">Who they are ›</button></td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No clinician-reviewed determinations in range.</td></tr> }
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
          <div class="tile" (click)="drillBreakGlass()">
            <div class="tile-ic" [class.hot]="breakGlass().length > 0"></div>
            <div class="tile-val">{{ breakGlass().length }}</div><div class="tile-lab">Break-the-Glass Grants</div>
            <div class="tile-sub">each requires review</div>
          </div>
          <div class="tile" (click)="drillCommonality()">
            <div class="tile-ic" [class.hot]="commCount('High') > 0"></div>
            <div class="tile-val">{{ commAll().length | number }}</div><div class="tile-lab">Relationship Flags</div>
            <div class="tile-sub">{{ commCount('High') }} high · account shares details with a member they opened</div>
          </div>
          <div class="tile" (click)="drillEvents('Data Exports', exportEventsList(), 'exports')">
            <div class="tile-val">{{ exportEventsList().length }}</div><div class="tile-lab">Data Exports</div>
            <div class="tile-sub">{{ exportedRows() | number }} rows extracted</div>
          </div>
        </div>


        @if (selectedUserRow(); as u) {
          <div class="panel mt-6 acct-panel">
            <div class="panel-pad mhead">
              <div>
                <button class="lnk back" (click)="selectedUser.set('')">‹ Clear selection</button>
                <h3 class="pt">{{ u.name }}</h3>
                <div class="sub">{{ u.role }} · {{ u.department }} · <span class="mono">{{ u.userId }}</span></div>
              </div>
              <div class="hactions">
                <button class="btn outline sm" (click)="openActor(u.name)">Account detail</button>
                <button class="btn outline sm" (click)="drillUser(u)">All events</button>
              </div>
            </div>

            <div class="panel-pad acctscope">
              <span class="albl">Access scope</span>
              <span class="scope" [attr.data-wide]="isWideScope(u.userId) ? '1' : null">{{ scopeOf(u.userId).recordScope }}</span>
              <span class="skv"><span class="sub">Lines of business</span> {{ scopeList(scopeOf(u.userId).lobScope) }}</span>
              <span class="skv"><span class="sub">Populations</span> {{ scopeList(scopeOf(u.userId).populationScope) }}</span>
              <span class="skv"><span class="sub">States</span> {{ scopeList(scopeOf(u.userId).licensedStates) }}</span>
            </div>

            <div class="panel-pad narrbar">
              <span class="albl" title="Independent of the Range control in the page header">Window</span>
              @for (w of windowPresets; track w.id) {
                <button class="qp" [class.on]="windowPreset() === w.id" (click)="setWindowPreset(w.id)">{{ w.label }}</button>
              }
              <label class="dt"><span class="sub">From</span>
                <input type="date" [value]="winFrom()" [max]="winTo()" (change)="setFrom($any($event.target).value)" /></label>
              <label class="dt"><span class="sub">To</span>
                <input type="date" [value]="winTo()" [min]="winFrom()" (change)="setTo($any($event.target).value)" /></label>
            </div>

            <div class="panel-pad narrbar">
              <span class="albl">Grain</span>
              <button class="qp" [class.on]="!grainOverride()" (click)="grainOverride.set(null)">Auto<span class="qn">{{ autoGrain() }}</span></button>
              @for (g of grains; track g) {
                <button class="qp" [class.on]="grainOverride() === g" (click)="grainOverride.set(g)">{{ g }}</button>
              }
              <span class="spacer"></span>
              <span class="sub">{{ userEvents().length | number }} events over {{ spanDays() | number }} days · click a bar to open it</span>
            </div>

            @if (archiveGap(); as gap) {
              <div class="panel-pad archnote">
                <b>{{ gap }}</b> of this window predates the online store, which holds
                {{ onlineFrom() }} → {{ onlineTo() }}. Older events are sealed in
                {{ segmentsCovering().length }} archive segment(s) and are not queryable until restored.
                <button class="lnk" (click)="goArchive()">Open Retention &amp; Archive ›</button>
              </div>
            }

            <div class="chartwrap">
              @if (buckets().length) {
                <div class="bars" [attr.data-grain]="grain()">
                  @for (b of buckets(); track b.key) {
                    <button class="bar" [class.zero]="!b.total"
                      [attr.title]="b.label + ' — ' + b.total + ' events, ' + b.phi + ' PHI, ' + b.offHours + ' off-hours'"
                      (click)="drillBucket(u.name, b)">
                      <span class="col">
                        <span class="fill" [style.height.%]="pctOfPeak(b.total)"></span>
                        <span class="fill off" [style.height.%]="pctOfPeak(b.offHours)"></span>
                      </span>
                      <span class="bn">{{ b.total || '' }}</span>
                      <span class="bl">{{ showLabel($index) ? b.label : '' }}</span>
                    </button>
                  }
                </div>
                <div class="legend">
                  <span><i class="sw teal"></i> events</span>
                  <span><i class="sw amber"></i> of which off-hours</span>
                  <span class="sub">peak {{ peak() | number }} · busiest {{ busiest()?.label }}</span>
                </div>
              } @else { <div class="empty">No activity in range.</div> }
            </div>

            <div class="panel-pad tbl-head"><h3 class="pt sm">Day of week</h3>
              <span class="section-note sm">Hour-of-day hides this: a Saturday spike and a 22:00 spike are different findings.</span></div>
            <table class="z-table">
              <thead><tr><th>Day</th><th class="num">Events</th><th class="num">PHI</th><th class="num">Off-Hours</th><th class="num">Exports</th><th class="num">Denied / Failed</th><th class="agree-col">Share</th></tr></thead>
              <tbody>
                @for (d of weekdays(); track d.key) {
                  <tr class="clk" (click)="drillBucket(u.name, d)">
                    <td class="strong">{{ d.label }}</td>
                    <td class="num">{{ d.total | number }}</td>
                    <td class="num">{{ d.phi | number }}</td>
                    <td class="num"><b [class.warn]="d.offHours > 0">{{ d.offHours }}</b></td>
                    <td class="num">{{ d.exports }}</td>
                    <td class="num"><b [class.warn]="d.denied > 0">{{ d.denied }}</b></td>
                    <td class="agree-col">
                      <span class="mbar"><span class="teal" [style.width.%]="pctOfWeekPeak(d.total)"></span></span>
                      <span class="mpct">{{ d.total }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="panel mt-6">
          <div class="panel-pad filters">
            <button class="pcap" (click)="togglePanel('accounts')" [attr.aria-expanded]="isOpen('accounts')">
              <span class="tcar" [class.open]="isOpen('accounts')">▸</span>
              <h3 class="pt">Activity by Account</h3>
              <span class="pcount">{{ activity().length }}</span>
            </button>
            @if (isOpen('accounts')) {
              <span class="section-note sm">Select an account to see its access scope and activity over time.</span>
              <input class="search sm" type="text" placeholder="Search account or role…" [ngModel]="aq()" (ngModelChange)="aq.set($event)" />
              <label class="chk"><input type="checkbox" [checked]="flaggedOnly()" (change)="flaggedOnly.set($any($event.target).checked)" /> Flagged only</label>
            }
          </div>
          @if (isOpen('accounts')) {
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortAct('name')">Account{{ caretAct('name') }}</th>
              <th class="srt" (click)="sortAct('role')">Role{{ caretAct('role') }}</th>
              <th>Access Scope</th>
              <th class="srt num" (click)="sortAct('events')">Events{{ caretAct('events') }}</th>
              <th class="srt num" (click)="sortAct('phi')">PHI{{ caretAct('phi') }}</th>
              <th class="num">Members</th>
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
                <tr class="clk" [class.sel]="selectedUser() === a.userId" (click)="selectUser(a.userId)">
                  <td class="strong">{{ a.name }}<div class="sub mono">{{ a.userId }}</div></td>
                  <td>{{ a.role }}</td>
                  <td class="scopecell">
                    <span class="scope" [attr.data-wide]="isWideScope(a.userId) ? '1' : null">{{ scopeOf(a.userId).recordScope }}</span>
                    <div class="sub">{{ scopeLine(a.userId) }}</div>
                  </td>
                  <td class="num">{{ a.events | number }}</td>
                  <td class="num">{{ a.phi | number }}</td>
                  <td class="num"><button class="lnk" (click)="drillUserMembers(a); $event.stopPropagation()">{{ membersTouched(a) | number }}</button></td>
                  <td class="num"><b [class.warn]="a.offHours > 0">{{ a.offHours }}</b></td>
                  <td class="num"><b [class.warn]="a.failedLogins > 0">{{ a.failedLogins }}</b></td>
                  <td class="num">{{ a.deniedAccess }}</td>
                  <td class="num"><b [class.hot]="a.breakGlass > 0">{{ a.breakGlass }}</b></td>
                  <td class="num">{{ a.exports }}</td>
                  <td class="mono">{{ a.lastActivity || '—' }}</td>
                  <td>@for (f of a.signals; track f) { <span class="chip amber">{{ f }}</span> } @if (!a.signals.length) { <span class="sub">—</span> }</td>
                </tr>
              } @empty { <tr><td colspan="13" class="empty">No accounts match this filter.</td></tr> }
            </tbody>
          </table>
          }
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head">
            <button class="pcap" (click)="togglePanel('screening')" [attr.aria-expanded]="isOpen('screening')">
              <span class="tcar" [class.open]="isOpen('screening')">▸</span>
              <h3 class="pt">Relationship Screening</h3>
              <span class="pcount">{{ commAll().length | number }}@if (commCount('High')) { · {{ commCount('High') }} high }</span>
            </button>
            @if (isOpen('screening')) {
              <span class="section-note sm">Accounts that opened the PHI of a member sharing their surname, address, postal code or telephone number. A staff member reading a relative's or a neighbour's record is inside their role, inside their caseload and often inside working hours — no other control on this tab can see it. Every row is a question to ask, never a finding: the innocent explanation is the common one.</span>
            }
          </div>
          @if (isOpen('screening')) {
          <div class="panel-pad narrbar">
            <span class="albl">Strength</span>
            @for (st of strengths; track st) {
              <button class="qp" [class.on]="commStrength() === st" (click)="commStrength.set(commStrength() === st ? '' : st)">{{ st }}<span class="qn">{{ commCount(st) }}</span></button>
            }
            <span class="spacer"></span>
            <span class="sub">{{ commRows().length | number }} of {{ commAll().length | number }} pair(s) · {{ commBtg() }} involved break-the-glass</span>
          </div>
          <table class="z-table">
            <thead><tr>
              <th>Account</th><th>Member</th><th>What they share</th><th>Strength</th>
              <th class="num">PHI Events</th><th class="num">Break-the-Glass</th><th>Last Touch</th>
            </tr></thead>
            <tbody>
              @for (c of commRows(); track c.actorId + c.memberId) {
                <tr>
                  <td class="strong"><button class="lnk" (click)="openActor(c.actor)">{{ c.actor }}</button><div class="sub">{{ c.actorRole }}</div></td>
                  <td><button class="lnk" (click)="openMemberFromId(c.memberId)">{{ c.member }}</button><div class="sub mono">{{ c.memberId }}</div></td>
                  <td>@for (f of c.flags; track f) { <span class="chip" [class.amber]="strengthOf(f) !== 'Low'">{{ f }}</span> }</td>
                  <td><span class="chip" [class.amber]="c.strength === 'Medium'" [class.red]="c.strength === 'High'">{{ c.strength }}</span></td>
                  <td class="num">{{ c.phiEvents | number }}</td>
                  <td class="num"><b [class.hot]="c.breakGlass > 0">{{ c.breakGlass }}</b></td>
                  <td class="mono">{{ c.lastTouch }}</td>
                </tr>
              } @empty { <tr><td colspan="7" class="empty">No account shares identifying details with a member whose PHI they opened in this range.</td></tr> }
            </tbody>
          </table>
          }
        </div>
      }

      <!-- ========================== MEMBER TIMELINE ========================== -->
      @case ('member') {
        <div class="tab-head">
          <div><h2>Member Timeline</h2>
            <span class="section-note">Everything done on one member, by everyone who touched them — threaded by the authorization or case it belonged to. The mirror of User Activity: same events, pivoted on the member instead of the account.</span></div>
          <button class="btn outline sm" (click)="exportMembers()">Export</button>
        </div>

        <div class="tile-row">
          <div class="tile" (click)="drillMemberSet('Members Touched', allMemberRows(), 'all-members')">
            <div class="tile-val">{{ allMemberRows().length | number }}</div><div class="tile-lab">Members Touched</div>
            <div class="tile-sub">in {{ rangeLabel().toLowerCase() }}</div>
          </div>
          <div class="tile" (click)="drillEvents('Member-Linked Events', memberLinkedEvents(), 'member-linked')">
            <div class="tile-val">{{ memberLinkedEvents().length | number }}</div><div class="tile-lab">Member-Linked Events</div>
            <div class="tile-sub">of {{ scopedEvents().length | number }} total</div>
          </div>
          <div class="tile" (click)="drillMemberSet('Touched by 3+ Accounts', multiUserMembers(), 'multi-account')">
            <div class="tile-val">{{ multiUserMembers().length | number }}</div><div class="tile-lab">Touched by 3+ Accounts</div>
            <div class="tile-sub">handoffs worth reading end to end</div>
          </div>
          <div class="tile" (click)="drillBreakGlass()">
            <div class="tile-ic" [class.hot]="btgMemberRows().length > 0"></div>
            <div class="tile-val">{{ btgMemberRows().length | number }}</div><div class="tile-lab">Members Accessed Under Break-the-Glass</div>
            <div class="tile-sub">each opens in context</div>
          </div>
        </div>

        @if (!selectedMemberRow()) {
          <!-- Search first. A plan with millions of lives cannot be browsed, and a list that long is
               slower to work with than a search box even when it does render. -->
          <div class="panel mt-6">
            <div class="msearch">
              <h3 class="ms-h">Find a member</h3>
              <p class="ms-p">Search by name or member ID to open their complete record — every account that touched them, threaded by authorization or case.</p>
              <input class="ms-in" type="text" placeholder="Member name or ID…" autocomplete="off"
                     [ngModel]="mq()" (ngModelChange)="mq.set($event)" />

              @if (mq().trim().length >= 2) {
                <div class="ms-res">
                  @for (m of memberSearchResults(); track m.memberId) {
                    <button class="mrow" (click)="selectMember(m.memberId)">
                      <span class="mmain"><b>{{ m.member }}</b>
                        <span class="sub mono">{{ m.memberId }} · {{ m.lob }}</span></span>
                      <span class="mstats">
                        <span class="mchip">{{ m.events }} events</span>
                        <span class="mchip">{{ m.users }} {{ m.users === 1 ? 'account' : 'accounts' }}</span>
                        <span class="mchip">{{ m.records }} {{ m.records === 1 ? 'record' : 'records' }}</span>
                        <span class="mchip">{{ m.modules }}</span>
                      </span>
                    </button>
                  } @empty { <div class="empty">No member matches "{{ mq() }}" in {{ rangeLabel().toLowerCase() }}.</div> }
                  @if (memberSearchOverflow() > 0) {
                    <div class="ms-more">{{ memberSearchOverflow() | number }} more match — narrow the search to see them.</div>
                  }
                </div>
              } @else {
                <!-- Not a browse list: three short, purposeful ways in. -->
                <div class="ms-entry">
                  <div class="ms-col">
                    <div class="ms-lab">Accessed under break-the-glass</div>
                    @for (b of btgList().slice(0, 6); track b.eventId) {
                      <button class="ms-link" (click)="selectMember(b.memberId)">{{ b.member }} <span class="sub">by {{ b.actor }}</span></button>
                    } @empty { <div class="sub">None in range.</div> }
                  </div>
                  <div class="ms-col">
                    <div class="ms-lab">Touched by the most accounts</div>
                    @for (m of mostHandledMembers(); track m.memberId) {
                      <button class="ms-link" (click)="selectMember(m.memberId)">{{ m.member }} <span class="sub">{{ m.users }} accounts</span></button>
                    } @empty { <div class="sub">None in range.</div> }
                  </div>
                  <div class="ms-col">
                    <div class="ms-lab">Most recent activity</div>
                    @for (m of recentMembers(); track m.memberId) {
                      <button class="ms-link" (click)="selectMember(m.memberId)">{{ m.member }} <span class="sub mono">{{ m.lastActivity }}</span></button>
                    } @empty { <div class="sub">None in range.</div> }
                  </div>
                </div>
              }
            </div>
          </div>
        } @else if (selectedMemberRow(); as m) {
          <div class="panel mt-6">
            <div class="panel-pad mhead">
              <div>
                <button class="lnk back" (click)="clearMember()">‹ Back to search</button>
                <h3 class="pt">{{ m.member }}</h3>
                <div class="sub mono">{{ m.memberId }} · {{ m.lob }} · {{ m.records }} record(s) · {{ m.users }} account(s) · {{ m.phi }} PHI event(s) · {{ m.modules }}</div>
              </div>
              <button class="btn outline sm" (click)="drillMember(m)">Open in explorer</button>
            </div>

            <div class="panel-pad actorbar">
              <span class="albl">Accounts on this member</span>
              <button class="qp" [class.on]="!memberActor()" (click)="memberActor.set('')">All<span class="qn">{{ m.events }}</span></button>
              @for (a of memberActors(); track a.actorId) {
                <button class="qp" [class.on]="memberActor() === a.actorId" (click)="memberActor.set(a.actorId)">{{ a.actor }}<span class="qn">{{ a.n }}</span></button>
              }
            </div>
            @if (activeActor(); as a) {
              <div class="panel-pad xlink">
                Showing only <b>{{ a.actor }}</b> on this member.
                <button class="lnk" (click)="drillAccountTrail({ userId: a.actorId, name: a.actor })">Open their full activity across all members ›</button>
                <button class="lnk" (click)="drillUserMembersById(a.actorId, a.actor)">Every member they touched ›</button>
              </div>
            }

            <div class="threads">
              @for (t of memberThreads(); track t.correlationId) {
                <div class="thread">
                  <button class="thead" (click)="toggleThread(t.correlationId)">
                    <span class="tcar" [class.open]="openThreads().has(t.correlationId)">▸</span>
                    <span class="tid mono">{{ t.entityId }}</span>
                    <span class="ttype">{{ t.entityType }}</span>
                    <span class="tspan sub">{{ t.opened }} → {{ t.closed }}</span>
                    <span class="tn">{{ t.events.length }} events · {{ t.actors.length }} accounts</span>
                  </button>
                  @if (openThreads().has(t.correlationId)) {
                    <div class="tacts">
                      <button class="lnk" (click)="drillThread(t)">Open this record's full trail</button>
                      <button class="lnk" (click)="drillGovernanceRecord(t.entityId, t.correlationId)">Governance record</button>
                    </div>
                    <ol class="tl">
                      @for (e of t.events; track e.eventId) {
                        <li class="tli" [attr.data-cat]="e.category">
                          <button class="tlin" (click)="openEvent(e)" [attr.aria-label]="'Open full record for ' + e.action">
                            <span class="tlt mono">{{ e.timestamp.replace('T', ' ') }}</span>
                            <span class="tlb">
                              <span class="tla">{{ e.action }}
                                @if (e.phi) { <span class="phi">PHI</span> }
                                @if (e.outcome !== 'Success') { <span class="chip red">{{ e.outcome }}</span> }
                              </span>
                              @if (e.field) {
                                <span class="tlf">
                                  @if (e.changeAction) { <span class="chg" [attr.data-a]="e.changeAction">{{ e.changeAction }}</span> }
                                  <span class="sub">{{ e.field }}:</span> <span class="was">{{ e.before ?? '—' }}</span> → <b>{{ e.after }}</b>
                                  @if (e.screen) { <span class="scr">{{ e.screen }} · <span class="ctl">{{ e.control }}</span></span> }
                                </span>
                              }
                              <span class="tlm sub">{{ e.actor }} · {{ e.actorRole }} · {{ e.channel }}@if (e.reasonCode) { · {{ e.reasonCode }} }@if (e.memberCount) { · {{ e.memberCount | number }} members in extract }</span>
                            </span>
                            <span class="tlgo mono">{{ e.eventId }} ›</span>
                          </button>
                        </li>
                      }
                    </ol>
                  }
                </div>
              } @empty { <div class="empty">No activity for this account on this member.</div> }
            </div>
          </div>
        }

      }

      <!-- ==================== GOVERNANCE & ACCESS CONTROLS ==================== -->
      @case ('governance') {
        <div class="tab-head">
          <div><h2>Governance &amp; Access Controls</h2>
            <span class="section-note">Who is entitled to do what, whether those entitlements are still attested, and where two duties that must stay separate have landed on one person. The account inventory and entitlement figures are a point-in-time state and do not move with the Range control; the segregation-of-duty results are evaluated over the selected range and do.</span></div>
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
          <div class="panel-pad tbl-head"><h3 class="pt">Policy Resolution — Market, State &amp; Line of Business</h3>
            <span class="section-note sm">Which policy governs a case, and on what basis. Two plans in two states can sit under the same line of business and be governed by different policy, so the SELECTION is logged as its own step — a trail recording which criteria were applied without recording why those criteria answers half the question. Every determination carries a <em>Policy version resolved</em> event with the inputs, the version and the basis.</span></div>
          <div class="scroll">
            <table class="z-table">
              <thead><tr><th>Line of Business</th><th>State</th><th>Market</th><th>Policy Version</th><th class="num">Determinations</th><th>Basis</th><th>Citation</th></tr></thead>
              <tbody>
                @for (p of policyRules; track p.lob + p.state) {
                  <tr class="clk" (click)="drillPolicy(p.lob, p.state)">
                    <td class="strong">{{ p.lob }}</td>
                    <td class="mono">{{ p.state }}</td>
                    <td class="sub">{{ market(p.state) }}</td>
                    <td class="mono">{{ p.policyVersion }}<span class="chip" [class.amber]="p.stateRule">{{ p.stateRule ? 'state rule' : 'national' }}</span></td>
                    <td class="num">{{ policyCount(p.lob, p.state) }}</td>
                    <td>{{ p.basis }}</td>
                    <td class="sub">{{ p.citation }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Notification Rules</h3>
            <span class="section-note sm">What each signal is, who owns it, and how quickly someone is expected to have looked.</span></div>
          <table class="z-table">
            <thead><tr><th>Signal</th><th>Severity</th><th>Owner</th><th>Review Window</th><th>Destination</th><th>Delivery</th></tr></thead>
            <tbody>
              @for (r of notificationRules; track r.signal) {
                <tr>
                  <td class="strong">{{ r.signal }}</td>
                  <td><span class="badge" [class.red]="r.severity==='critical'" [class.amber]="r.severity==='warning'" [class.green]="r.severity==='info'">{{ r.severity }}</span></td>
                  <td>{{ r.owner }}</td>
                  <td class="sub">{{ r.reviewWindow }}</td>
                  <td class="sub">{{ r.destination }}</td>
                  <td><span class="badge amber">{{ r.delivery }}</span></td>
                </tr>
              }
            </tbody>
          </table>
          <div class="finding panel-pad">
            <b>Known gap — REQ-13</b>
            This is the routing configuration, not a delivery mechanism. Every rule here is real and auditable, and each signal reaches the Inbox and opens the screen that owns it — but nothing leaves the platform. No mail, no page, no ticket. Anyone relying on being told rather than on looking would not be told.
          </div>
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

        @if (archiveLookup(); as l) {
          <div class="panel mt-6 lookup">
            <div class="panel-pad lk-head">
              <div>
                <h3 class="pt">Looking for {{ l.account }} · {{ l.from }} → {{ l.to }}</h3>
                <div class="sub">{{ lookupSegments().length }} sealed segment(s) cover this window, holding
                  {{ lookupEvents() | number }} archived events. These are not queryable from the Audit Trail until restored.</div>
              </div>
              <button class="lnk" (click)="clearLookup()">Dismiss</button>
            </div>
            @if (lookupSegments().length) {
              <table class="z-table">
                <thead><tr><th>Segment</th><th>Period</th><th class="num">Events</th><th>Tier</th><th>Legal Hold</th><th>Retrieval</th></tr></thead>
                <tbody>
                  @for (g of lookupSegments(); track g.segmentId) {
                    <tr class="clk" (click)="drillSegments('Segment ' + g.segmentId, [g], g.segmentId)">
                      <td class="strong mono">{{ g.segmentId }}</td>
                      <td class="mono">{{ g.periodFrom }} → {{ g.periodTo }}</td>
                      <td class="num">{{ g.eventCount | number }}</td>
                      <td>{{ g.tier }}@if (g.wormLocked) { <span class="chip">WORM</span> }</td>
                      <td>@if (g.legalHold) { <span class="chip amber">{{ g.legalHold }}</span> } @else { <span class="sub">—</span> }</td>
                      <td>@if (restoreStateOf(g.segmentId); as r) {
                            <span class="chip" [class.amber]="r.status === 'In Progress'">{{ r.status }}</span>
                            <div class="sub mono">{{ r.requestId }}</div>
                          } @else { <span class="sub">Not requested</span> }</td>
                    </tr>
                  }
                </tbody>
              </table>
              <div class="panel-pad lk-foot">
                @if (lookupNeedingRestore().length) {
                  <button class="btn primary sm" (click)="requestRestore()">
                    Request restore of {{ lookupNeedingRestore().length }} segment{{ lookupNeedingRestore().length > 1 ? 's' : '' }}
                  </button>
                  <span class="sub">retrieval target {{ slaLabelFor(lookupNeedingRestore()[0].tier) }} ({{ lookupNeedingRestore()[0].tier }} tier) · the request is itself logged</span>
                } @else {
                  <span class="sub">Every segment covering this window is already requested or retrieved.</span>
                }
              </div>
            } @else {
              <div class="panel-pad sub">No archived segment covers this window — the period is either inside the online store already, or older than the retention schedule keeps.</div>
            }
          </div>
        }

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
            <div class="tile-sub">retrieval SLA by tier · nearline {{ slaLabelFor('Nearline') }} · archive {{ slaLabelFor('Archive') }}</div>
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
            <span class="section-note sm">Retrieval from cold storage is itself an auditable act — who asked, why, and how long it took against the retrieval target for its storage tier.</span></div>
          <table class="z-table">
            <thead><tr><th>Request</th><th>Segment</th><th>Requested By</th><th>Reason</th><th>Requested</th><th>Fulfilled</th><th>Status</th></tr></thead>
            <tbody>
              @for (r of restores(); track r.requestId) {
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
            <span class="section-note">Requirement → control in the platform today → where the evidence lives → what is still missing. This is the working list for the gap, priority and next-step discussion. The Range and LOB controls do not apply here — this is the control set itself, not a measurement over a window.</span></div>
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

    @if (narrativeOpen(); as r) {
      <div class="nscrim" (click)="closeNarrative()"></div>
      <aside class="npanel" role="dialog" aria-label="Rationale comparison">
        <header class="nhead">
          <div>
            <h3>{{ r.authId }} · {{ r.member }}</h3>
            <p class="sub"><button class="lnk" (click)="openActor(r.reviewer)">{{ r.reviewer }}</button> · model {{ r.model }} · {{ r.criteriaSet }} · confidence {{ r.confidence.toFixed(2) }}</p>
          </div>
          <button class="x" (click)="closeNarrative()" aria-label="Close">×</button>
        </header>
        <div class="nbody">
          <div class="ncol">
            <div class="nlab">What the model stated</div>
            <p class="ntext">{{ r.aiNarrative }}</p>
          </div>
          <div class="ncol">
            <div class="nlab">What the clinician changed
              @if (r.narrativeEdited) { <span class="chip amber">{{ r.narrativeChangePct }}% of words</span> }
              @else { <span class="chip">no change</span> }
            </div>
            @if (r.narrativeEdited) {
              <p class="ntext">
                @for (d of narrativeDiff(); track $index) {
                  @if (d.op === 'same') { <span>{{ d.text }}</span> }
                  @else if (d.op === 'del') { <del>{{ d.text }}</del> }
                  @else { <ins>{{ d.text }}</ins> }
                }
              </p>
              <div class="nkinds">@for (k of r.editKinds; track k) { <span class="chip">{{ k }}</span> }</div>
            } @else {
              <p class="nverbatim">Submitted exactly as generated. Nothing in the clinical language was changed before it went on the determination.</p>
            }
          </div>
          <div class="ncol">
            <div class="nlab">What was submitted</div>
            <p class="ntext">{{ r.submittedNarrative }}</p>
            <div class="nchain">
              <div class="nlab">Who touched this determination</div>
              @for (a of actorChain(r.authId); track a.actor) {
                <button class="chain" (click)="openActor(a.actor)">
                  <span class="cw"><b>{{ a.actor }}</b><span class="sub">{{ a.role }}</span></span>
                  <span class="ca sub">{{ a.actions }}</span>
                  <span class="cn">{{ a.n }}</span>
                </button>
              }
              <button class="lnk" (click)="drillGovernanceRecord(r.authId, 'COR-' + r.authId)">Full event chain ›</button>
            </div>
            <div class="nmeta">
              <div><span class="sub">Recommendation</span> <b>{{ r.recommendation }}</b></div>
              <div><span class="sub">Final determination</span> <b>{{ r.finalDecision }}</b></div>
              <div><span class="sub">Outcome</span> <b>{{ r.outcome }}</b></div>
              <div><span class="sub">Signed by</span> <button class="lnk" (click)="openActor(signerFor(r.authId))">{{ signerFor(r.authId) }}</button></div>
              @if (r.overrideReason) { <div><span class="sub">Override reason</span> <b>{{ r.overrideReason }}</b></div> }
              @if (r.overriddenBy) { <div><span class="sub">Overridden by</span> <button class="lnk" (click)="openActor(r.overriddenBy!)">{{ r.overriddenBy }}</button></div> }
            </div>
          </div>
        </div>
      </aside>
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
    .tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; cursor: pointer;
      background: #fff; transition: box-shadow .15s; }
    .tile:hover { box-shadow: var(--shadow); }
        /* The attention dot is positioned, not stacked. As a flow item it contributed its own height
       plus a flex gap, so any tile carrying one pushed its number ~16px below the tiles beside it
       and the row lost its baseline. In the corner it reads as a status marker and every figure in
       the row starts at the same height whether or not it is flagged. */
    .tile-ic { position: absolute; top: 10px; right: 11px; }
    .tile-ic.hot { width: 9px; height: 9px; border-radius: 999px; background: var(--amber); }
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
    .lnk { border:0; background:none; padding:0; font:inherit; font-weight:700; color:var(--teal-700);
           cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
    .lnk:hover { color:var(--teal-900); }

    /* ---- Member Timeline ---- */
    .scopecell { max-width:260px; }
    .scope { display:inline-block; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:3px;
             background:var(--gray-100); color:var(--gray-500); white-space:nowrap; }
    .scope[data-wide] { background:var(--amber-bg); color:var(--amber-fg); }
    .acctscope { display:flex; align-items:center; flex-wrap:wrap; gap:8px 18px; border-bottom:1px solid var(--border); background:var(--gray-50, #f9fafb); }
    .skv { font-size:12px; } .skv .sub { margin-right:5px; }
    .hactions { display:flex; gap:8px; }

    .lookup { border:1px solid var(--teal-600); }
    .lk-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; border-bottom:1px solid var(--border); background:var(--teal-50); }
    .lk-foot { display:flex; align-items:center; gap:12px; flex-wrap:wrap; border-top:1px solid var(--border); }
    .dt { display:inline-flex; align-items:center; gap:6px; font-size:12px; }
    .dt input { border:1px solid var(--gray-300); border-radius:7px; padding:3px 8px; font:inherit; font-size:12px; outline:none; }
    .dt input:focus { border-color:var(--teal-600); }
    .archnote { font-size:12.5px; color:var(--amber-fg); background:var(--amber-bg); border-bottom:1px solid var(--border); line-height:1.5; }
    .archnote b { font-weight:700; }
    .archnote .lnk { color:var(--amber-fg); margin-left:6px; }
    .chartwrap { padding:18px 20px 8px; overflow-x:auto; }
    .bars { display:flex; align-items:flex-end; gap:3px; min-height:190px; }
    .bars[data-grain="Hour of day"] .bl { font-size:9px; }
    .bar { flex:1 1 0; min-width:16px; display:flex; flex-direction:column; align-items:center; gap:3px;
           border:0; background:none; padding:0; font:inherit; cursor:pointer; }
    .bar .col { position:relative; width:100%; height:150px; display:flex; align-items:flex-end; justify-content:center; }
    .bar .fill { position:absolute; bottom:0; width:100%; background:var(--teal-600); border-radius:3px 3px 0 0; min-height:2px; }
    .bar .fill.off { background:var(--amber); }
    .bar:hover .fill { background:var(--teal-700); }
    .bar.zero { cursor:default; }
    .bar.zero .fill { background:var(--gray-200); }
    .bn { font-size:10px; font-weight:700; color:var(--gray-500); font-variant-numeric:tabular-nums; }
    .bl { font-size:10px; color:var(--gray-500); white-space:nowrap; transform:rotate(-45deg); transform-origin:top right;
          height:34px; align-self:flex-end; }
    .bars[data-grain="Hour of day"] .bl { transform:none; align-self:center; height:auto; }
    .legend { display:flex; gap:16px; align-items:center; padding:10px 0 4px; font-size:11.5px; color:var(--gray-500); }
    .sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; }
    .sw.teal { background:var(--teal-600); } .sw.amber { background:var(--amber); }
    .pt.sm { font-size:14px; }
    tr.sel > td { background:var(--teal-50); }

    .narrbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--border); background:var(--gray-50, #f9fafb); }
    .narrbar .spacer { flex:1; min-width:12px; }
    .qp.sm { font-size:10.5px; padding:2px 8px; }

    .nscrim { position:fixed; inset:0; background:rgba(17,24,39,.5); z-index:130; }
    .npanel { position:fixed; inset:5vh 4vw; z-index:131; background:#fff; border-radius:14px;
              box-shadow:0 24px 60px rgba(0,0,0,.28); display:flex; flex-direction:column; overflow:hidden; }
    .nhead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
             padding:18px 22px; border-bottom:1px solid var(--border); }
    .nhead h3 { margin:0; font-size:16px; }
    .nhead .sub { margin:4px 0 0; font-size:12px; }
    .nbody { flex:1; display:grid; grid-template-columns:repeat(3, 1fr); gap:0; overflow:hidden; }
    @media (max-width: 1100px) { .nbody { grid-template-columns:1fr; overflow-y:auto; } }
    .ncol { padding:16px 20px 20px; overflow-y:auto; border-right:1px solid var(--border); }
    .ncol:last-child { border-right:0; background:var(--gray-50, #f9fafb); }
    .nlab { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
            color:var(--gray-500); margin-bottom:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .ntext { font-size:13px; line-height:1.65; color:var(--ink); margin:0; }
    .ntext del { background:#fdecea; color:#a63a31; text-decoration:line-through; border-radius:2px; padding:0 1px; }
    .ntext ins { background:#e6f4ec; color:#1e6b45; text-decoration:none; border-radius:2px; padding:0 1px; }
    .nverbatim { font-size:13px; line-height:1.6; color:var(--gray-500); margin:0; font-style:italic; }
    .nkinds { display:flex; flex-wrap:wrap; gap:5px; margin-top:14px; }
    .nchain { margin-top:18px; padding-top:14px; border-top:1px solid var(--border); display:flex; flex-direction:column; align-items:stretch; gap:5px; }
    .chain { display:grid; grid-template-columns:1fr auto; gap:2px 10px; width:100%; text-align:left; border:1px solid var(--border);
             border-radius:8px; background:#fff; padding:8px 10px; font:inherit; cursor:pointer; }
    .chain:hover { border-color:var(--teal-600); }
    .cw { display:flex; flex-direction:column; }
    .cw b { font-size:12.5px; } .cw .sub { font-size:10.5px; }
    .ca { grid-column:1 / -1; font-size:11px; line-height:1.4; }
    .cn { font-size:11px; font-weight:700; color:var(--gray-500); align-self:start; }
    .nmeta { margin-top:16px; padding-top:14px; border-top:1px solid var(--border); display:grid; gap:6px; font-size:12.5px; }
    .nmeta .sub { display:inline-block; min-width:130px; }

    .msearch { padding:26px 26px 30px; max-width:920px; }
    .ms-h { margin:0 0 4px; font-size:17px; font-weight:700; }
    .ms-p { margin:0 0 14px; font-size:12.5px; color:var(--gray-500); max-width:62ch; line-height:1.5; }
    .ms-in { width:100%; max-width:520px; border:1px solid var(--gray-300); border-radius:9px;
             padding:11px 14px; font:inherit; font-size:14px; outline:none; }
    .ms-in:focus { border-color:var(--teal-600); box-shadow:0 0 0 3px var(--teal-50); }
    .ms-res { margin-top:14px; border:1px solid var(--gray-200); border-radius:9px; overflow:hidden; max-height:480px; overflow-y:auto; }
    .ms-more { padding:10px 16px; font-size:12px; color:var(--gray-500); background:var(--gray-50, #f9fafb); }
    .ms-entry { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:22px; margin-top:22px;
                padding-top:18px; border-top:1px solid var(--gray-100); }
    .ms-col { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
    .ms-lab { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--gray-500); margin-bottom:4px; }
    .ms-link { border:0; background:none; padding:2px 0; font:inherit; font-size:12.5px; font-weight:600;
               color:var(--teal-700); cursor:pointer; text-align:left; }
    .ms-link:hover { text-decoration:underline; }
    .ms-link .sub { font-weight:500; margin-left:5px; }
    .mrow { display:flex; flex-direction:column; gap:5px; width:100%; text-align:left; border:0;
            border-bottom:1px solid var(--gray-100); background:#fff; padding:11px 16px; cursor:pointer; font:inherit; }
    .mrow:hover { background:var(--gray-50, #f9fafb); }
    .mrow.on { background:var(--teal-50); box-shadow:inset 3px 0 0 var(--teal-600); }
    .mrow:focus-visible { outline:2px solid var(--teal-600); outline-offset:-2px; }
    .mmain b { font-size:13.5px; color:var(--ink); }
    .mstats { display:flex; flex-wrap:wrap; gap:5px; }
    .mchip { font-size:10.5px; font-weight:600; color:var(--gray-500); background:var(--gray-100); border-radius:999px; padding:1px 7px; }
    .mrow.on .mchip { background:#fff; color:var(--teal-700); }

    .mhead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; border-bottom:1px solid var(--border); }
    .lnk.back { display:block; margin-bottom:6px; font-size:11.5px; text-decoration:none; }
    .lnk.back:hover { text-decoration:underline; }
    .xlink { display:flex; align-items:center; flex-wrap:wrap; gap:12px; font-size:12.5px; color:var(--gray-500);
             background:var(--teal-50); border-bottom:1px solid var(--border); }
    .xlink b { color:var(--ink); }
    .actorbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--border); background:var(--gray-50, #f9fafb); }
    .albl { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--gray-500); margin-right:4px; }
    .qp { border:1px solid var(--border); background:#fff; border-radius:999px; padding:3px 10px; font:inherit;
          font-size:11.5px; font-weight:600; color:var(--gray-500); cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
    .qp:hover { border-color:var(--teal-600); color:var(--teal-700); }
    .qp.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .qn { font-size:10px; font-weight:700; background:var(--gray-100); color:var(--gray-500); border-radius:999px; padding:0 5px; }
    .qp.on .qn { background:rgba(255,255,255,.24); color:#fff; }

    .threads { max-height:620px; overflow-y:auto; }
    .thread { border-bottom:1px solid var(--gray-100); }
    .thead { display:flex; align-items:center; gap:10px; width:100%; text-align:left; border:0; background:#fff;
             padding:11px 16px; cursor:pointer; font:inherit; }
    .thead:hover { background:var(--gray-50, #f9fafb); }
    .tcar { color:var(--gray-400); transition:transform .15s; display:inline-block; }
    .tcar.open { transform:rotate(90deg); }
    .tid { font-size:12.5px; font-weight:700; color:var(--teal-900); }
    .ttype { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); background:var(--gray-100); border-radius:3px; padding:1px 6px; }
    .tspan { font-size:11px; }
    .tn { margin-left:auto; font-size:11px; color:var(--gray-500); font-weight:600; white-space:nowrap; }

    /* The timeline itself: one rail, events hung off it in order. */
    .tl { list-style:none; margin:0; padding:2px 16px 14px 30px; border-left:2px solid var(--gray-100); margin-left:24px; }
    .tli { position:relative; }
    .tlin { display:grid; grid-template-columns:132px 1fr auto; gap:12px; align-items:start; width:100%;
            text-align:left; border:0; background:none; padding:7px 8px 7px 0; margin:0; font:inherit;
            cursor:pointer; border-radius:6px; }
    .tlin:hover { background:var(--gray-50, #f9fafb); }
    .tlin:focus-visible { outline:2px solid var(--teal-600); outline-offset:-2px; }
    .tlb { display:block; min-width:0; }
    .tlgo { font-size:10.5px; color:var(--gray-400); white-space:nowrap; padding-top:3px; opacity:0; transition:opacity .12s; }
    .tlin:hover .tlgo, .tlin:focus-visible .tlgo { opacity:1; }
    .tacts { display:flex; gap:16px; padding:0 16px 10px 54px; }
    .tli::before { content:''; position:absolute; left:-37px; top:13px; width:9px; height:9px; border-radius:999px;
                   background:var(--gray-300); border:2px solid #fff; }
    .tli[data-cat="Clinical Decision"]::before { background:var(--teal-600); }
    .tli[data-cat="Access"]::before { background:var(--amber); }
    .tli[data-cat="Correspondence"]::before { background:var(--teal-400, #5eb1b5); }
    .tli[data-cat="Security"]::before { background:var(--red, #c0392b); }
    .tlt { font-size:11px; color:var(--gray-500); padding-top:2px; white-space:nowrap; }
    .tla { font-size:13px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .tlf, .tlm { display:block; }
    .tlf { font-size:12px; margin-top:3px; }
    .tlm { font-size:11px; margin-top:2px; }
    .empty.pick { padding:70px 24px; color:var(--gray-500); font-weight:500; text-align:center; }

    .pcap { display:flex; align-items:center; gap:9px; border:0; background:none; padding:0; margin:0;
            font:inherit; cursor:pointer; text-align:left; }
    .pcap .pt { margin:0; }
    /* This caret is a control, not decoration — at gray-400 and 11px it read as a stray glyph and
       people did not find it. Given its own chip so it looks like something you press. */
    .pcap .tcar {
      display:inline-flex; align-items:center; justify-content:center;
      width:20px; height:20px; border-radius:5px; font-size:13px; line-height:1;
      background:var(--gray-100); color:var(--gray-500);
    }
    .pcap:hover .tcar { background:var(--teal-600); color:#fff; }
    .pcap:hover .pt { color:var(--teal-700); }
    .pcap:focus-visible { outline:2px solid var(--teal-600); outline-offset:3px; border-radius:4px; }
    .pcount { font-size:11px; font-weight:700; color:var(--gray-500); background:var(--gray-100);
              border-radius:999px; padding:1px 8px; white-space:nowrap; }
    .memln { margin-top:2px; font-size:11.5px; }
    .scr { display:block; font-size:10.5px; color:var(--gray-500); margin-top:2px; }
    .scr .ctl { font-weight:700; letter-spacing:.03em; text-transform:uppercase; font-size:9.5px; }
    .chg { display:inline-block; font-size:9.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
           padding:1px 6px; border-radius:3px; margin-right:6px; background:var(--gray-100); color:var(--gray-500); vertical-align:1px; }
    .chg[data-a="Deleted"] { background:var(--red-bg); color:var(--red-fg); }
    .chg[data-a="Created"], .chg[data-a="Activated"] { background:var(--green-bg); color:var(--green-fg); }
    .chg[data-a="Deactivated"] { background:var(--amber-bg); color:var(--amber-fg); }
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
  private navSvc = inject(Nav);
  private exporter = inject(Exporter);

  readonly tabs = TAB_DEFS;
  readonly sel = signal('trail');

  constructor() {
    effect(() => {
      if (this.navSvc.module() !== 'audit') return;
      const tab = this.navSvc.takeRequestedTab();
      if (tab && TAB_DEFS.some((t) => t.key === tab)) this.sel.set(tab);
    });
  }
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
  /** Field edits are the grain a plan's own admin audit works in — "what did this person change on
   *  this screen, and what was there before". Filterable on its own because that question is asked
   *  independently of everything else in the trail. */
  readonly editsOnly = signal(false);
  setEditsOnly(v: boolean) { this.editsOnly.set(v); this.page.set(0); }
  readonly fieldEditEvents = computed(() => this.scopedEvents().filter((e) => e.action === 'Field edited'));
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
    this.actor() !== 'all' || this.outcome() !== 'all' || this.phiOnly() || this.offHoursOnly() || this.editsOnly());
  clearFilters() {
    this.q.set(''); this.cat.set('all'); this.chan.set('all'); this.entity.set('all');
    this.actor.set('all'); this.outcome.set('all'); this.phiOnly.set(false); this.offHoursOnly.set(false); this.editsOnly.set(false);
    this.reset();
  }

  readonly filteredEvents = computed(() => {
    const q = this.q().trim().toLowerCase();
    const cat = this.cat(), chan = this.chan(), ent = this.entity(), act = this.actor(), out = this.outcome();
    const phi = this.phiOnly(), off = this.offHoursOnly(), edits = this.editsOnly();
    return this.scopedEvents().filter((e) =>
      (cat === 'all' || e.category === cat) &&
      (chan === 'all' || e.channel === chan) &&
      (ent === 'all' || e.entityType === ent) &&
      (act === 'all' || e.actorId === act) &&
      (out === 'all' || e.outcome === out) &&
      (!phi || e.phi) &&
      (!off || isOffHours(e.timestamp)) &&
      (!edits || e.action === 'Field edited') &&
      (!q || [e.eventId, e.actor, e.actorRole, e.action, e.entityId, e.entityType, e.correlationId, e.reasonCode ?? '', e.sourceIp, e.after ?? '', e.sessionId]
        .concat([e.field ?? '', e.before ?? '', e.screen ?? '', e.control ?? ''])
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
  readonly policyRules = POLICY_RULES;
  readonly notificationRules = NOTIFICATION_RULES;
  market(state: string) { return marketOf(state); }
  private policyEvents(lob: string, state: string) {
    const pol = resolvePolicy(lob, state);
    return this.scopedEvents().filter((e) => e.action === 'Policy version resolved'
      && e.after === pol.policyVersion && (e.before ?? '').startsWith(`${lob} · ${state}`));
  }
  policyCount(lob: string, state: string) { return this.policyEvents(lob, state).length; }
  drillPolicy(lob: string, state: string) {
    const pol = resolvePolicy(lob, state);
    this.drillEvents(`Policy ${pol.policyVersion} — ${lob} · ${state}`, this.policyEvents(lob, state), `policy-${slug(pol.policyVersion)}`);
  }
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
  /** Reviewer and Overridden By sit third and fourth, not twentieth. Who acted is the first thing
   *  asked of a determination, and a column twenty places right is a column nobody scrolls to. */
  private readonly AI_COLUMNS = ['Auth', 'Member', 'Reviewer', 'Overridden By', 'Signed By', 'Worked By', 'Outcome',
    'Recommendation', 'Final Determination', 'Agreed', 'Override Reason', 'Confidence', 'Band',
    'Rationale Edited', 'Words Changed', 'Edit Kinds', 'Policy', 'LOB', 'Pend Reason', 'Agents', 'Models Used',
    'Panel', 'Grounded', 'Converged', 'Flags', 'Tokens', 'Cost', 'Latency', 'Workflow', 'Bundle', 'Model',
    'Criteria Set', 'Scored', 'Decided'];
  private aiRow(r: AiDecisionRecord): (string | number)[] {
    return [r.authId, r.member, this.reviewerLabel(r), r.overriddenBy ?? '—', this.signerFor(r.authId), this.workedBy(r.authId), r.outcome,
      r.recommendation, r.finalDecision, r.agreed ? 'Yes' : 'No', r.overrideReason ?? '—', r.confidence.toFixed(2), r.band,
      r.narrativeEdited ? 'Yes' : 'No', r.narrativeEdited ? `${r.narrativeChangePct}%` : '—', r.editKinds.join('; ') || '—',
      r.procedure, r.lob, r.pendReason ?? '—', `${r.agentsCompleted}/${r.agentsTotal}`, r.modelsUsed,
      r.panel ? 'panel' : '—', `${r.groundedMet}/${r.groundedTotal}`, r.panel ? (r.converged ? 'Yes' : 'SPLIT') : '—',
      r.flags.join('; ') || '—', r.tokens, `$${r.cost.toFixed(2)}`, `${r.latencySec}s`, r.workflowVersion, r.bundle, r.model,
      r.criteriaSet, r.scoredDate, r.decidedDate];
  }

  /** Who actually signed the determination, read off the trail rather than off the AI record. The
   *  reviewer who worked a case and the clinician who signed an adverse determination are often
   *  different people — a nurse can approve within criteria but cannot deny — and that difference
   *  is the whole point of the segregation-of-duties rule two tabs over. An auto-approved
   *  determination is signed by the rule, which is a real answer and not a blank: the AI record
   *  called it '—' only because it was looking for the human event name. */
  signerFor(authId: string): string {
    const e = AUDIT_EVENTS.find((x) => x.entityId === authId &&
      (x.action === 'Determination recorded' || x.action === 'Auto-approval rule applied'));
    return e ? e.actor : '—';
  }

  /** The people who actually handled this authorization, from the trail — intake, reviewer,
   *  medical director, whoever edited a field. Service accounts are excluded: an interface is not
   *  a person, and listing it here would answer "who touched this" with "the software did".
   *  This is populated on nearly every determination, including the ones with no clinical reviewer
   *  yet, which is exactly where the AI record's Reviewer column has nothing to say. */
  workedBy(authId: string): string {
    const names = new Set<string>();
    for (const e of AUDIT_EVENTS) {
      if (e.entityId !== authId) continue;
      if (e.actorRole === 'Interface Service Account') continue;
      names.add(e.actor);
    }
    return names.size ? [...names].join(', ') : '—';
  }

  /** Why a determination has no clinical reviewer, rather than a bare em-dash. The two reasons are
   *  different facts: nobody needed to look at it, versus nobody has looked at it yet. */
  reviewerLabel(r: AiDecisionRecord): string {
    if (r.reviewer !== '—') return r.reviewer;
    return r.autoCleared ? 'Auto-cleared — no human review' : 'Unassigned — awaiting review';
  }

  /** Every account that touched one determination, in order, with what each of them did. This is
   *  the answer to "who did this one" — a determination is a chain of events by different people
   *  and service accounts, not a single act by the reviewer named on the record. */
  actorChain(authId: string): { actor: string; role: string; actions: string; first: string; n: number }[] {
    const evs = AUDIT_EVENTS.filter((e) => e.entityId === authId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const byActor = new Map<string, { actor: string; role: string; acts: string[]; first: string; n: number }>();
    for (const e of evs) {
      const cur = byActor.get(e.actorId) ?? { actor: e.actor, role: e.actorRole, acts: [], first: e.timestamp.replace('T', ' '), n: 0 };
      cur.n++;
      if (!cur.acts.includes(e.action)) cur.acts.push(e.action);
      byActor.set(e.actorId, cur);
    }
    return [...byActor.values()]
      .sort((a, b) => a.first.localeCompare(b.first))
      .map((a) => ({ actor: a.actor, role: a.role, actions: a.acts.join(' · '), first: a.first, n: a.n }));
  }
  /** Column 0 is 'Auth' rather than 'Auth ID' on purpose — these are compliance records, so the
   *  Explorer treats them as informational and offers no Reassign/Balance/Escalate, the same
   *  treatment the IRR log gets. */
  drillAi(title: string, rows: AiDecisionRecord[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${rows.length.toLocaleString()} determination(s) · run ledger · ${this.rangeLabel()}`,
      columns: this.AI_COLUMNS, rows: rows.map((r) => this.aiRow(r)),
      exportName: `ai-oversight-${slugName}${TODAY_ISO}`, memberColumn: 1,
      // Every actor column is a link, and so is the authorization. "Who did this one" is a
      // per-event question: the AI record names the reviewer and whoever overrode the model, the
      // trail names everyone else, and column 0 opens the whole chain.
      rowLinks: [
        { column: 0, run: (row) => { this.ix.closeExplorer(); this.drillGovernanceRecord(String(row[0]), `COR-${row[0]}`); } },
        // Column 2 carries a reason string when there is no clinical reviewer; only a real name links.
        { column: 2, run: (row) => this.openActor(String(row[2])), enabled: (row) => !String(row[2]).includes(' — ') },
        { column: 3, run: (row) => this.openActor(String(row[3])) },
        { column: 4, run: (row) => this.openActor(String(row[4])) },
        { column: 5, run: (row) => { this.ix.closeExplorer(); this.drillGovernanceRecord(String(row[0]), `COR-${row[0]}`); } },
      ],
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
      title: 'AI Oversight', name: `ai-oversight${TODAY_ISO}`,
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
  /** A signal rather than the constant, because this screen can now create a request. A retrieval
   *  queue where asking for something leaves the queue unchanged would be worse than not offering
   *  the action at all. */
  readonly restores = signal<RestoreRequest[]>([...RESTORE_REQUESTS]);
  /** Retrieval time follows the storage tier rather than one flat number — see RETRIEVAL_SLA_HOURS. */
  slaLabelFor(tier: StorageTier) { return slaLabel(tier); }
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
  openRestores() { return this.restores().filter((r) => r.status === 'In Progress').length; }

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
      columns: this.SEGMENT_COLUMNS, rows: gs.map((g) => this.segmentRow(g)), exportName: `audit-archive-${slugName}${TODAY_ISO}`,
    });
  }
  drillRestores() {
    this.ix.openExplorer({
      title: 'Restore Requests', context: `${this.restores().length} retrieval request(s) from cold storage`,
      columns: ['Request', 'Segment', 'Requested By', 'Reason', 'Requested', 'Fulfilled', 'Tier', 'Retrieval SLA', 'Status'],
      rows: this.restores().map((r) => [r.requestId, r.segmentId, r.requestedBy, r.reason, r.requestedDate, r.fulfilledDate ?? '—', r.tier, slaLabel(r.tier), r.status]),
      exportName: `audit-archive-restores${TODAY_ISO}`,
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
      title: 'Archive Segment Index', name: `audit-archive-index${TODAY_ISO}`,
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
      title: 'Certificates of Destruction', name: `audit-disposition-certificates${TODAY_ISO}`,
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

  /** The per-determination view, in Symphony's shape: every agent step, every human action, every
   *  executed action, ordered by section then time — the governance record rather than a log. */
  drillGovernanceRecord(entityId: string, correlationId: string) {
    const order: Record<string, number> = { 'Decision lineage': 0, 'Human actions': 1, 'Execution': 2 };
    const evs = AUDIT_EVENTS.filter((x) => x.correlationId === correlationId)
      .sort((a, b) => order[governanceSection(a)] - order[governanceSection(b)] || a.timestamp.localeCompare(b.timestamp));
    // Multiple actors on one record is the POINT of a governance record, not a bug — intake
    // receives it, the interface extracts and scores it, a clinician reviews and signs it. But the
    // rows are grouped by governance section rather than by time, so timestamps run backwards
    // between sections and the actor column jumps about, which reads as several records piled
    // together. Say what is in view so it cannot be misread.
    const actors = [...new Set(evs.map((e) => e.actor))];
    const times = evs.map((e) => e.timestamp).sort();
    this.ix.openExplorer({
      title: `Governance Record — ${entityId}`,
      context: `One record · ${evs.length} event(s) · ${actors.length} account(s): ${actors.join(', ')}`
        + (times.length ? ` · ${times[0].replace('T', ' ')} → ${times[times.length - 1].replace('T', ' ')}` : '')
        + ` · grouped by governance section, not chronologically — decision lineage first, then human actions, then what was executed`,
      columns: ['Section', ...EVENT_COLUMNS],
      rows: evs.map((e) => [governanceSection(e), ...eventRow(e)]),
      exportName: `governance-record-${slug(entityId)}${TODAY_ISO}`,
      rowLinks: this.eventRowLinks(1),
    });
  }

  /** Actor and Member are links on every event list, not just on the tab that happens to render
   *  them. A drill-down is where a reviewer actually spends their time, and a name they cannot
   *  click is a name they have to go and look up somewhere else. Column positions are read off
   *  EVENT_COLUMNS rather than hard-coded, so inserting a column cannot silently point a link at
   *  the wrong cell. */
  private eventRowLinks(offset = 0) {
    const at = (c: string) => EVENT_COLUMNS.indexOf(c) + offset;
    const iActor = at('Actor'), iMember = at('Member'), iMemberId = at('Member ID');
    return [
      { column: iActor, run: (row: (string | number)[]) => this.openActor(String(row[iActor])) },
      {
        column: iMember,
        run: (row: (string | number)[]) => { this.ix.closeExplorer(); this.openMemberFromId(String(row[iMemberId])); },
        // "Not member-specific" and "412 members — extract" are statements, not destinations.
        enabled: (row: (string | number)[]) => String(row[iMemberId]) !== '—',
      },
    ];
  }

  drillEvents(title: string, evs: AuditEvent[], slugName: string) {
    const rows = [...evs].reverse();
    this.ix.openExplorer({
      title, context: `${rows.length.toLocaleString()} audit event(s) · ${this.rangeLabel()}`,
      columns: EVENT_COLUMNS, rows: rows.map(eventRow), exportName: `audit-trail-${slugName}${TODAY_ISO}`,
      rowLinks: this.eventRowLinks(),
    });
  }
  /** The trail STORES the member id, which is correct — an id is stable and a name is not, and the
   *  record has to still mean the same thing in ten years when someone has married or been merged
   *  from a duplicate. But an id alone is unreadable to the person doing the review, so the name is
   *  resolved for display and the id kept beside it. Where no name resolves, the id stands rather
   *  than a blank: an unresolvable member is a real thing to notice, not something to hide.
   *
   *  Note for deployment: name display should follow the viewer's own record scope — an account
   *  marked "Masked — no PHI" has no business reading these. That gating is not modelled here. */
  memberNameOf(id: string | null | undefined): string { return id ? memberName(id) : ''; }
  hasMemberName(id: string | null | undefined): boolean { return !!id && memberName(id) !== id; }
  openMemberFromId(id: string) { this.sel.set('member'); this.mq.set(''); this.selectMember(id); }

  /** A blank member column reads as missing data. These three are different facts: one member,
   *  many members (an extract is a disclosure of everyone in it), or an event that is genuinely not
   *  about a member at all — a sign-in, a rule change, an account grant. Only the first two are
   *  about anyone. */
  memberLabel(e: AuditEvent): string {
    if (e.memberId) return this.hasMemberName(e.memberId) ? `${memberName(e.memberId)} · ${e.memberId}` : e.memberId;
    if (e.memberCount) return `${e.memberCount.toLocaleString()} members — extract`;
    return 'Not member-specific';
  }
  openEvent(e: AuditEvent) {
    this.ix.openDrawer({
      title: `${e.eventId} · ${e.action}`,
      subtitle: `${e.actor} (${e.actorRole}) · ${e.timestamp.replace('T', ' ')}`,
      badge: { text: e.outcome, tone: e.outcome === 'Success' ? 'green' : e.outcome === 'Denied' ? 'amber' : 'red' },
      fields: [
        { label: 'Category', value: e.category },
        { label: 'Record', value: `${e.entityType} ${e.entityId}` },
        { label: 'Governance Section', value: govSection(e) },
        { label: 'Member', value: this.memberLabel(e), tone: e.memberCount ? 'amber' : undefined },
        { label: 'Line of Business', value: e.lob ?? '—' },
        { label: 'Change Action', value: e.changeAction ?? '—' },
        { label: 'Screen', value: e.screen ?? '—' },
        { label: 'Control', value: e.control ?? '—' },
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
      actions: [
        { label: 'Governance record', tone: 'teal', run: () => this.drillGovernanceRecord(e.entityId, e.correlationId) },
        { label: `${e.actor} — all activity`, tone: 'teal' as const, run: () => this.drillAccountTrail({ userId: e.actorId, name: e.actor }) },
        ...(e.memberId ? [{
          label: 'Open member timeline', tone: 'teal' as const,
          run: () => { this.ix.closeDrawer(); this.sel.set('member'); this.selectMember(e.memberId!); },
        }] : []),
      ],
    });
  }
  // ---- Account forensics -------------------------------------------------------------------------
  readonly selectedUser = signal('');
  readonly grains = ACTIVITY_GRAINS;

  // ---- the window ------------------------------------------------------------------------------
  // Panel-local and absolute, not a trailing count of days from today. An investigation is usually
  // "the fortnight around the complaint", which was eighteen months ago — a Today/7d/30d control
  // cannot express that at all.
  readonly windowPresets = [
    { id: '30d', label: '30 days' }, { id: '90d', label: '90 days' },
    { id: '12m', label: '12 months' }, { id: 'all', label: 'All retained' },
  ];
  readonly windowPreset = signal<string>('90d');
  readonly winFrom = signal<string>('');
  readonly winTo = signal<string>(TODAY_ISO);

  private shiftDays(days: number): string {
    const d = new Date(`${TODAY_ISO}T00:00:00`);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  setWindowPreset(id: string) {
    this.windowPreset.set(id);
    this.winTo.set(TODAY_ISO);
    this.winFrom.set(id === '30d' ? this.shiftDays(30) : id === '90d' ? this.shiftDays(90)
      : id === '12m' ? this.shiftDays(365) : archiveSummary().oldestRetained);
  }
  /** Typing a date drops the preset — the chips describe trailing windows and a custom range is
   *  not one of them, so leaving one lit would be a lie about what is on screen. */
  setFrom(v: string) { if (v) { this.winFrom.set(v); this.windowPreset.set(''); } }
  setTo(v: string) { if (v) { this.winTo.set(v); this.windowPreset.set(''); } }

  readonly spanDays = computed(() => {
    const a = new Date(`${this.winFrom() || this.shiftDays(90)}T00:00:00`).getTime();
    const b = new Date(`${this.winTo()}T00:00:00`).getTime();
    return Math.max(1, Math.round((b - a) / 86400000));
  });

  /** Grain follows the span unless someone overrides it. Two years at a daily grain is 730 bars;
   *  a fortnight at a monthly grain is one. Neither is a chart. */
  readonly grainOverride = signal<ActivityGrain | null>(null);
  readonly autoGrain = computed<ActivityGrain>(() => {
    const d = this.spanDays();
    return d <= 45 ? 'Daily' : d <= 200 ? 'Weekly' : 'Monthly';
  });
  readonly grain = computed<ActivityGrain>(() => this.grainOverride() ?? this.autoGrain());

  /** At most fourteen labels on the axis. Every bar keeps its tooltip and its click, so nothing is
   *  lost — a label under every one of sixty bars is noise standing where information should be. */
  showLabel(i: number) {
    const n = this.buckets().length;
    if (n <= 14) return true;
    const step = Math.ceil(n / 14);
    return i % step === 0;
  }

  // ---- what is actually queryable ---------------------------------------------------------------
  readonly onlineFrom = computed(() => archiveSummary().onlineFrom);
  readonly onlineTo = computed(() => archiveSummary().onlineTo);
  /** Asking for a window older than the online store is a normal thing to do and a normal thing to
   *  be told about. Silently returning an empty chart would read as "this account did nothing",
   *  which is the single most misleading answer an audit tool can give. */
  readonly archiveGap = computed(() => {
    const from = this.winFrom();
    if (!from || from >= this.onlineFrom()) return '';
    const days = Math.round((new Date(`${this.onlineFrom()}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
    return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`;
  });
  readonly segmentsCovering = computed(() => {
    const from = this.winFrom(), to = this.winTo();
    return ARCHIVE_SEGMENTS.filter((sg) => sg.periodTo >= from && sg.periodFrom <= to);
  });
  /** What the reader was actually looking for when they left the activity panel. Switching tabs
   *  without it drops them on a retention screen with no idea which of 46 segments matters — the
   *  link answered "where do I go" and then abandoned the question that sent them. */
  readonly archiveLookup = signal<{ account: string; from: string; to: string } | null>(null);
  goArchive() {
    const u = this.selectedUserRow();
    this.archiveLookup.set({ account: u ? u.name : '—', from: this.winFrom(), to: this.winTo() });
    this.sel.set('retention');
  }
  clearLookup() { this.archiveLookup.set(null); }
  /** Segments overlapping the window that was asked for. */
  lookupSegments = computed(() => {
    const l = this.archiveLookup();
    if (!l) return [] as ArchiveSegment[];
    return this.disp.remaining()
      .filter((g) => g.periodTo >= l.from && g.periodFrom <= l.to)
      .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom));
  });
  readonly lookupEvents = computed(() => this.lookupSegments().reduce((n, g) => n + g.eventCount, 0));
  /** Segments in the window that already have a restore in flight or fulfilled — asking twice for
   *  the same segment is noise in a queue that a compliance team works by hand. */
  restoreStateOf(segmentId: string): RestoreRequest | null {
    return this.restores().find((r) => r.segmentId === segmentId && r.status !== 'Denied') ?? null;
  }
  readonly lookupNeedingRestore = computed(() => this.lookupSegments().filter((g) => !this.restoreStateOf(g.segmentId)));

  /** Creating the request is the point. It is a REQUEST, not a retrieval — cold storage has an SLA
   *  and pretending otherwise would misrepresent the one number a plan cares about here. */
  requestRestore() {
    const l = this.archiveLookup();
    const needed = this.lookupNeedingRestore();
    if (!l || !needed.length) return;
    const held = needed.filter((g) => g.legalHold);
    this.ix.ask({
      title: `Request restore of ${needed.length} segment${needed.length > 1 ? 's' : ''}`,
      body: `Retrieve ${this.lookupEvents().toLocaleString()} archived events covering ${l.from} → ${l.to} for ${l.account}. `
        + `Retrieval target ${[...new Set(needed.map((g) => `${g.tier.toLowerCase()} ${slaLabel(g.tier)}`))].join(', ')}. `
        + `That is the technical rehydration time; the events do not become queryable until the segment chain is re-verified and published.`
        + (held.length ? ` ${held.length} of these segments is under legal hold — the hold does not block retrieval, only disposition.` : ''),
      breakdown: needed.map((g) => ({ count: g.eventCount, label: g.segmentId, target: `${g.periodFrom} → ${g.periodTo}` })),
      confirmLabel: 'Request restore', tone: 'teal',
      onConfirm: () => {
        const next = needed.map((g, k) => ({
          requestId: `RST-${String(this.restores().length + k + 1).padStart(4, '0')}`,
          segmentId: g.segmentId, requestedBy: this.currentUser, requestedDate: TODAY_ISO,
          reason: `Account activity review — ${l.account}, ${l.from} → ${l.to}`,
          status: 'In Progress' as const, fulfilledDate: null,
          slaHours: slaHoursFor(g.tier), tier: g.tier,
        }));
        this.restores.update((r) => [...next, ...r]);
        this.ix.toast(`${next.length} restore request(s) raised — retrieval target ${slaLabel(needed[0].tier)}.`);
      },
    });
  }
  selectUser(id: string) {
    const next = this.selectedUser() === id ? '' : id;
    this.selectedUser.set(next);
    if (next && !this.winFrom()) this.setWindowPreset('90d');
    // Rendering above the table is the structural fix; this covers the case where the tile row
    // alone still pushes the panel under the fold on a short viewport.
    // Two frames, not a microtask: this app is zoneless, so the signal write schedules a render
    // that has not happened yet when microtasks drain — the panel does not exist to scroll to.
    if (next) requestAnimationFrame(() => requestAnimationFrame(() =>
      document.querySelector('.acct-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  }
  readonly selectedUserRow = computed(() => this.activity().find((a) => a.userId === this.selectedUser()) ?? null);
  /** Reads the whole online store rather than scopedEvents(): the panel carries its own window, and
   *  intersecting it with the module's trailing range would silently return nothing whenever the
   *  two disagree. The module's LOB lens still applies — narrowing to a line of business is a
   *  question about the work, and it stays true here. */
  readonly userEvents = computed(() => {
    const id = this.selectedUser();
    if (!id) return [];
    const from = this.winFrom() || this.shiftDays(90), to = this.winTo(), lob = this.lob();
    return AUDIT_EVENTS.filter((e) => {
      if (e.actorId !== id) return false;
      const d = eventDate(e.timestamp);
      if (d < from || d > to) return false;
      if (lob !== 'all' && e.lob !== null && e.lob !== lob) return false;
      return true;
    });
  });
  readonly buckets = computed(() => activityBuckets(this.userEvents(), this.grain(), this.winFrom() || undefined, this.winTo()));
  readonly weekdays = computed(() => weekdayBuckets(this.userEvents()));
  readonly peak = computed(() => Math.max(1, ...this.buckets().map((b) => b.total)));
  readonly busiest = computed(() => [...this.buckets()].sort((a, b) => b.total - a.total)[0] ?? null);
  pctOfPeak(n: number) { return Math.round((n / this.peak()) * 100); }
  pctOfWeekPeak(n: number) { return Math.round((n / Math.max(1, ...this.weekdays().map((d) => d.total))) * 100); }
  /** A bar you cannot open is a bar that ends the investigation where it should have started it. */
  drillBucket(name: string, b: ActivityBucket) {
    if (!b.total) { this.ix.toast(`No activity for ${name} in ${b.label}.`, 'info'); return; }
    this.drillEvents(`${name} — ${b.label}`, b.events, `activity-${slug(name)}-${slug(b.key)}`);
  }

  /** Collapsible panels. The account inventory is 22 rows and the screening queue can be dozens;
   *  either one pushes everything after it off a short screen. Collapsed state is per-panel and
   *  lives for the session only — a panel that stayed shut across a reload would hide a control
   *  from the next person to open the tab. Both start open: hiding the primary surface of a tab by
   *  default is a worse trade than a bit of scrolling. */
  private readonly collapsed = signal<Set<string>>(new Set());
  isOpen(key: string) { return !this.collapsed().has(key); }
  togglePanel(key: string) {
    this.collapsed.update((c) => { const n = new Set(c); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // ---- Relationship screening --------------------------------------------------------------------
  readonly strengths = ['High', 'Medium', 'Low'];
  readonly commStrength = signal<string>('');
  readonly commAll = computed(() => commonalityHits(this.scopedEvents()));
  readonly commRows = computed(() => {
    const st = this.commStrength();
    return st ? this.commAll().filter((c) => c.strength === st) : this.commAll();
  });
  commCount(st: string) { return this.commAll().filter((c) => c.strength === st).length; }
  readonly commBtg = computed(() => this.commAll().filter((c) => c.breakGlass > 0).length);
  strengthOf(f: CommonalityFlag) { return COMMONALITY_STRENGTH[f]; }
  /** Same rows as the panel below, in the explorer every other tile opens — so the count is
   *  reachable from above the fold and the list is exportable like everything else here. */
  drillCommonality() {
    const rows = this.commRows();
    this.ix.openExplorer({
      title: 'Relationship Screening',
      context: `${rows.length} account/member pair(s) sharing identifying details · ${this.commCount('High')} high strength · a question to ask, never a finding`,
      columns: ['Account', 'Role', 'Member', 'Member ID', 'What They Share', 'Strength', 'Events', 'PHI Events', 'Break-the-Glass', 'First Touch', 'Last Touch'],
      rows: rows.map((c) => [c.actor, c.actorRole, c.member, c.memberId, c.flags.join('; '), c.strength,
        c.events, c.phiEvents, c.breakGlass, c.firstTouch, c.lastTouch]),
      exportName: `audit-relationship-screening${TODAY_ISO}`,
      rowLinks: [
        { column: 0, run: (row) => this.openActor(String(row[0])) },
        { column: 2, run: (row) => { this.ix.closeExplorer(); this.openMemberFromId(String(row[3])); } },
      ],
    });
  }

  // ---- Break-the-glass ------------------------------------------------------------------------
  readonly btgList = computed(() => breakGlassAccesses(this.scopedEvents()));
  /** Who opened it, on whom, when, and under what justification — in one view. The member alone
   *  does not answer the question the control exists to ask, and neither does the count. */
  drillBreakGlass() {
    const rows = this.btgList();
    this.ix.openExplorer({
      title: 'Break-the-Glass Access',
      context: `${rows.length} emergency access grant(s) · ${new Set(rows.map((r) => r.actorId)).size} account(s) · ${new Set(rows.map((r) => r.memberId)).size} member(s) · each requires review`,
      columns: ['Timestamp', 'Account', 'Role', 'Member', 'Member ID', 'Justification', 'Channel', 'Source IP', 'Event ID'],
      rows: rows.map((r) => [r.timestamp, r.actor, r.actorRole, r.member, r.memberId, r.reasonCode, r.channel, r.sourceIp, r.eventId]),
      exportName: `audit-break-the-glass${TODAY_ISO}`,
      rowLinks: [
        { column: 1, run: (row) => this.openActor(String(row[1])) },
        { column: 3, run: (row) => { this.ix.closeExplorer(); this.openMemberFromId(String(row[4])); } },
      ],
    });
  }

  // ---- Access scope --------------------------------------------------------------------------
  scopeOf(userId: string) {
    return SYSTEM_USERS.find((u) => u.userId === userId)
      ?? { recordScope: '—', lobScope: [] as string[], populationScope: [] as string[], licensedStates: [] as string[] };
  }
  scopeList(v: string[]) { return v.length ? v.join(', ') : 'All'; }
  /** One line summarising what an account can see, for the inventory table. */
  scopeLine(userId: string) {
    const u = this.scopeOf(userId);
    const parts = [
      `LOB: ${this.scopeList(u.lobScope)}`,
      `Pop: ${this.scopeList(u.populationScope)}`,
      ...(u.licensedStates.length ? [`States: ${u.licensedStates.join(', ')}`] : []),
    ];
    return parts.join(' · ');
  }
  /** Unrestricted record access is not automatically a finding — a Medical Director needs it and a
   *  compliance analyst is read-only by design — but it IS the thing an entitlement review should
   *  stop on, so it is marked rather than left to be spotted. */
  isWideScope(userId: string) {
    const u = this.scopeOf(userId);
    return u.recordScope === 'All members' || u.recordScope === 'All members — audit read-only';
  }

  // ---- Actors -----------------------------------------------------------------------------------
  /** One place to land on whoever acted, from anywhere they are named. AI Oversight knows a
   *  clinician by display name; the audit trail knows them by account id. Resolving the two here
   *  means every surface that shows a person can hand off to the evidence about that person,
   *  rather than each table inventing its own half of the pivot. */
  openActor(name: string) {
    const u = SYSTEM_USERS.find((x) => x.name === name);
    if (!u) { this.ix.toast(`No system account matches "${name}".`, 'info'); return; }
    const evs = this.scopedEvents().filter((e) => e.actorId === u.userId);
    const members = new Set(evs.filter((e) => e.memberId).map((e) => e.memberId));
    const scored = this.aiRows().filter((r) => r.reviewer === name);
    const overrides = scored.filter((r) => r.outcome === 'Overridden');
    const edited = scored.filter((r) => r.narrativeEdited);
    this.ix.openDrawer({
      title: name,
      subtitle: `${u.role} · ${u.department} · ${u.userId}`,
      badge: { text: u.status, tone: u.status === 'Active' ? 'green' : 'amber' },
      fields: [
        { label: 'Access Role', value: u.role },
        { label: 'Record Scope', value: u.recordScope, tone: this.isWideScope(u.userId) ? 'amber' : undefined },
        { label: 'Lines of Business', value: this.scopeList(u.lobScope) },
        { label: 'Populations', value: this.scopeList(u.populationScope) },
        { label: 'Licensed States', value: this.scopeList(u.licensedStates) },
        { label: 'MFA', value: u.mfaEnrolled ? 'Enrolled' : 'Password only', tone: u.mfaEnrolled ? undefined : 'amber' },
        { label: 'Last Entitlement Review', value: `${u.lastAccessReview} (${attestationAgeDays(u)} days ago)`,
          tone: attestationAgeDays(u) > ATTESTATION_CYCLE_DAYS ? 'amber' : undefined },
        { label: 'Last Sign-in', value: u.lastLogin },
        { label: 'Audit Events in Range', value: evs.length.toLocaleString() },
        { label: 'PHI Events', value: evs.filter((e) => e.phi).length.toLocaleString() },
        { label: 'Members Touched', value: members.size.toLocaleString() },
        { label: 'Relationship Flags', value: this.commAll().filter((c) => c.actorId === u.userId).length.toLocaleString(),
          tone: this.commAll().some((c) => c.actorId === u.userId && c.strength === 'High') ? 'amber' : undefined },
        { label: 'Determinations Reviewed', value: scored.length.toLocaleString() },
        { label: 'Overrode the Model', value: `${overrides.length} of ${scored.length}` },
        { label: 'Edited the Rationale', value: scored.length ? `${edited.length} of ${scored.length}` : '—' },
      ],
      note: `Everything above is scoped to ${this.rangeLabel().toLowerCase()}. Agreement and override rates are a signal to look at, never a score to manage someone by — a reviewer below the group may be catching what the model misses.`,
      actions: [
        ...(scored.length ? [{ label: 'Determinations they reviewed', tone: 'teal' as const,
          run: () => { this.ix.closeDrawer(); this.drillReviewer(name); } }] : []),
        { label: 'Full audit activity', tone: 'teal' as const,
          run: () => { this.ix.closeDrawer(); this.drillAccountTrail({ userId: u.userId, name }); } },
        ...(members.size ? [{ label: 'Every member they touched', tone: 'teal' as const,
          run: () => { this.ix.closeDrawer(); this.drillUserMembersById(u.userId, name, u.role); } }] : []),
      ],
    });
  }

  // ---- What the model said vs what went out ----------------------------------------------------
  readonly editKinds = EDIT_KINDS;
  readonly narrFilter = signal<'edited' | 'verbatim'>('edited');
  readonly narrKind = signal<string>('');
  private static readonly NARR_CAP = 60;

  /** Verbatim rate is reported over cases a clinician ACTUALLY REVIEWED. Auto-cleared work has no
   *  reviewer to edit it, and a case still sitting unclaimed in a queue has no reviewer yet — fold
   *  either in and the rate climbs toward 100% while describing the gate and the backlog rather
   *  than the clinicians, which is the opposite of what this number is for. */
  readonly reviewedRows = computed(() => this.aiRows().filter((r) => !r.autoCleared && r.reviewer !== '—'));
  readonly verbatimRows = computed(() => this.reviewedRows().filter((r) => !r.narrativeEdited));
  readonly editedRows = computed(() => this.reviewedRows().filter((r) => r.narrativeEdited));
  readonly verbatimPct = computed(() => {
    const n = this.reviewedRows().length;
    return n ? Math.round((this.verbatimRows().length / n) * 100) : 0;
  });
  editKindCount(k: EditKind) { return this.editedRows().filter((r) => r.editKinds.includes(k)).length; }

  readonly narrativeAll = computed(() => {
    const base = this.narrFilter() === 'edited' ? this.editedRows() : this.verbatimRows();
    const k = this.narrKind();
    return k ? base.filter((r) => r.editKinds.includes(k as EditKind)) : base;
  });
  readonly narrativeRows = computed(() => this.narrativeAll().slice(0, AuditTraceability.NARR_CAP));
  readonly narrativeOverflow = computed(() => Math.max(0, this.narrativeAll().length - AuditTraceability.NARR_CAP));

  readonly narrativeOpen = signal<AiDecisionRecord | null>(null);
  openNarrative(r: AiDecisionRecord) { this.narrativeOpen.set(r); }
  closeNarrative() { this.narrativeOpen.set(null); }
  /** Word-level diff of the two texts, rendered inline. Exact rather than approximate: a diff that
   *  showed an edit which did not happen would be worse than showing no diff at all. */
  readonly narrativeDiff = computed<DiffOp[]>(() => {
    const r = this.narrativeOpen();
    return r ? diffWords(r.aiNarrative, r.submittedNarrative) : [];
  });

  // ---- Member Timeline -------------------------------------------------------------------------
  // Same scopedEvents() the Audit Trail reads. Pivoting must never introduce a second source of
  // truth: if this tab and that tab ever disagreed, both become unusable as evidence.
  readonly mq = signal('');
  readonly selectedMember = signal('');
  readonly memberActor = signal('');
  readonly openThreads = signal<Set<string>>(new Set());

  /** Search caps at 40 rows and needs two characters. Neither is cosmetic: a plan with millions of
   *  lives returns tens of thousands of "smith" matches, and rendering them costs more than it
   *  tells anyone. The overflow count stays visible so the number is never silently truncated. */
  private static readonly SEARCH_CAP = 40;

  readonly allMemberRows = computed(() => memberAuditRollup(this.scopedEvents()));
  readonly memberLinkedEvents = computed(() => this.scopedEvents().filter((e) => e.memberId));

  private readonly memberMatches = computed(() => {
    const q = this.mq().trim().toLowerCase();
    if (q.length < 2) return [] as MemberAuditRow[];
    return this.allMemberRows().filter((m) => m.member.toLowerCase().includes(q) || m.memberId.toLowerCase().includes(q));
  });
  readonly memberSearchResults = computed(() => this.memberMatches().slice(0, AuditTraceability.SEARCH_CAP));
  readonly memberSearchOverflow = computed(() => Math.max(0, this.memberMatches().length - AuditTraceability.SEARCH_CAP));

  readonly multiUserMembers = computed(() => this.allMemberRows().filter((m) => m.users >= 3));
  readonly mostHandledMembers = computed(() => [...this.allMemberRows()].sort((a, b) => b.users - a.users).slice(0, 6));
  readonly recentMembers = computed(() => this.allMemberRows().slice(0, 6));
  /** Members whose record was opened under an emergency justification — the highest-value way into
   *  this tab, because every one of them needs a human to read the whole timeline. */
  readonly btgMemberRows = computed(() => {
    const ids = new Set<string>();
    for (const e of this.scopedEvents()) if (e.action.startsWith('Break-the-glass') && e.memberId) ids.add(e.memberId);
    return this.allMemberRows().filter((m) => ids.has(m.memberId));
  });

  readonly selectedMemberRow = computed(() => this.allMemberRows().find((m) => m.memberId === this.selectedMember()) ?? null);

  /** Every account that touched the selected member, with how many events each — the "by user" cut
   *  of a member's own record, which is how a handoff dispute actually gets settled. */
  readonly memberActors = computed(() => {
    const id = this.selectedMember();
    if (!id) return [] as { actorId: string; actor: string; n: number }[];
    const counts = new Map<string, { actorId: string; actor: string; n: number }>();
    for (const e of this.scopedEvents()) {
      if (e.memberId !== id) continue;
      const cur = counts.get(e.actorId) ?? { actorId: e.actorId, actor: e.actor, n: 0 };
      cur.n++; counts.set(e.actorId, cur);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n);
  });
  readonly activeActor = computed(() => this.memberActors().find((a) => a.actorId === this.memberActor()) ?? null);
  readonly memberThreads = computed<TimelineThread[]>(() => {
    const id = this.selectedMember();
    return id ? memberTimeline(id, this.scopedEvents(), this.memberActor() || undefined) : [];
  });

  selectMember(id: string) {
    this.selectedMember.set(id);
    this.memberActor.set('');
    // Open the most recent thread by default — landing on an all-collapsed list makes the reader
    // click once before seeing anything, every single time.
    const first = memberTimeline(id, this.scopedEvents())[0];
    this.openThreads.set(new Set(first ? [first.correlationId] : []));
  }
  clearMember() { this.selectedMember.set(''); this.memberActor.set(''); }
  /** Cross-pivot jump: from one account's row straight to one member's full record, with that
   *  account pre-selected so you see their part first and can clear it to see everyone else's. */
  openMemberFromUser(memberId: string, actorId: string) {
    this.sel.set('member');
    this.mq.set('');
    this.selectMember(memberId);
    this.memberActor.set(actorId);
  }
  toggleThread(id: string) {
    this.openThreads.update((set) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  /** Any list of members, opened in the explorer with the member column wired back INTO this tab —
   *  so a tile drill is a way in rather than a dead end. */
  drillMemberSet(title: string, rows: MemberAuditRow[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${rows.length} member(s) · ${this.rangeLabel()}`,
      columns: ['Member', 'Member ID', 'LOB', 'Modules', 'Records', 'Events', 'Accounts', 'PHI Events', 'First Activity', 'Last Activity'],
      rows: rows.map((m) => [m.member, m.memberId, m.lob, m.modules, m.records, m.events, m.users, m.phi, m.firstActivity, m.lastActivity]),
      exportName: `audit-members-${slugName}${TODAY_ISO}`,
      rowLinks: [{ column: 0, run: (row) => { this.ix.closeExplorer(); this.sel.set('member'); this.selectMember(String(row[1])); } }],
    });
  }
  /** One record's complete trail, flat and exportable — the thread expanded in place is for
   *  reading, this is for handing over. */
  drillThread(t: TimelineThread) {
    this.drillEvents(`${t.entityType} ${t.entityId} — full trail`, t.events, `record-${slug(t.entityId)}`);
  }
  drillMember(m: MemberAuditRow) {
    this.drillEvents(`Member record — ${m.member}`, this.scopedEvents().filter((e) => e.memberId === m.memberId), `member-${slug(m.memberId)}`);
  }
  exportMembers() {
    this.exporter.open({
      title: 'Members Touched', name: `audit-members${TODAY_ISO}`,
      columns: ['Member', 'Member ID', 'LOB', 'Modules', 'Events', 'Accounts', 'Records', 'PHI Events', 'First Activity', 'Last Activity'],
      rows: this.allMemberRows().map((m) => [m.member, m.memberId, m.lob, m.modules, m.events, m.users, m.records, m.phi, m.firstActivity, m.lastActivity]),
    });
  }

  /** Distinct members one account touched.
 Cheap enough to compute per row at this scale, and
   *  reading it off the same scoped events keeps it consistent with the drill it opens. */
  membersTouched(a: UserActivityRow): number {
    const ids = new Set<string>();
    for (const e of this.scopedEvents()) if (e.actorId === a.userId && e.memberId) ids.add(e.memberId);
    return ids.size;
  }
  drillUserMembers(a: UserActivityRow) { this.drillUserMembersById(a.userId, a.name, a.role); }

  /** Every member one account touched. Each row opens that member's timeline with this account
   *  pre-selected, so you land on their part of the record and can clear the filter to see who
   *  else was in there — the two pivots are one click apart in both directions. */
  drillUserMembersById(userId: string, name: string, role?: string) {
    const rows = membersForUser(userId, this.scopedEvents());
    this.ix.openExplorer({
      title: `Members touched — ${name}`,
      context: `${rows.length} member(s) touched by ${name}${role ? ` (${role})` : ''} in ${this.rangeLabel().toLowerCase()}`,
      columns: ['Member', 'Member ID', 'LOB', 'Records', 'Events', 'PHI Events', 'First Touch', 'Last Touch', 'What They Did'],
      rows: rows.map((m: UserMemberRow) => [m.member, m.memberId, m.lob, m.records, m.events, m.phi, m.firstTouch, m.lastTouch, m.actions]),
      exportName: `audit-members-of-${slug(userId)}${TODAY_ISO}`,
      rowLinks: [{ column: 0, run: (row) => { this.ix.closeExplorer(); this.openMemberFromUser(String(row[1]), userId); } }],
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
      exportName: `audit-accounts-${slugName}${TODAY_ISO}`,
    });
  }
  drillSod(r: SodResult) {
    this.ix.openExplorer({
      title: `${r.rule.id} — ${r.rule.name}`, context: `${r.conflicts.length} conflict(s) detected in ${this.rangeLabel().toLowerCase()}`,
      columns: ['Rule', 'Subject', 'Detail', 'Citation', 'Event ID'],
      rows: r.conflicts.map((c: SodConflictRow) => [c.ruleId, c.subject, c.detail, c.citation, c.eventIds.join(', ')]),
      exportName: `audit-sod-${slug(r.rule.id)}${TODAY_ISO}`,
    });
  }
  drillRegister(title: string, rows: ComplianceRequirement[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${rows.length} requirement(s)`,
      columns: ['ID', 'Domain', 'Requirement', 'Citation', 'Control Today', 'Evidence', 'Status', 'Priority', 'Gap', 'Next Step', 'Owner'],
      rows: rows.map((r) => [r.id, r.domain, r.requirement, r.citation, r.control, r.evidence, r.status, r.priority, r.gap ?? '—', r.nextStep ?? '—', r.owner]),
      exportName: `audit-compliance-${slugName}${TODAY_ISO}`,
    });
  }

  exportEvents() {
    this.exporter.open({
      title: 'Audit Trail', name: `audit-trail${TODAY_ISO}`,
      columns: EVENT_COLUMNS, rows: this.sortedRows().map((r) => eventRow(r.ev)),
    });
  }
  exportActivity() {
    this.exporter.open({
      title: 'User Activity Monitoring', name: `audit-user-activity${TODAY_ISO}`,
      columns: ['Account', 'User ID', 'Role', 'Events', 'Sessions', 'PHI Events', 'Off-Hours', 'Failed Sign-ins', 'Denied Access', 'Break-the-Glass', 'Exports', 'Rows Exported', 'External IP', 'Last Activity', 'Signals'],
      rows: this.activity().map((a) => [a.name, a.userId, a.role, a.events, a.sessions, a.phi, a.offHours, a.failedLogins, a.deniedAccess, a.breakGlass, a.exports, a.exportedRows, a.externalIp, a.lastActivity || '—', a.signals.join('; ') || '—']),
    });
  }
  exportGovernance() {
    this.exporter.open({
      title: 'Role → Permission Matrix', name: `audit-permission-matrix${TODAY_ISO}`,
      columns: ['Permission', ...this.roles],
      rows: this.permissions.map((p) => [p, ...this.roles.map((r) => this.matrix(r, p))]),
    });
  }
  exportRegister() {
    this.exporter.open({
      title: 'Compliance Requirements & Gaps', name: `audit-compliance-register${TODAY_ISO}`,
      columns: ['ID', 'Domain', 'Requirement', 'Citation', 'Control Today', 'Evidence', 'Status', 'Priority', 'Gap', 'Next Step', 'Owner'],
      rows: this.register.map((r) => [r.id, r.domain, r.requirement, r.citation, r.control, r.evidence, r.status, r.priority, r.gap ?? '—', r.nextStep ?? '—', r.owner]),
    });
  }
}
