import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Ring } from '../shared/ring';
import { Members } from '../shared/members';
import { Interaction, ConfirmBreakdownRow } from '../shared/interaction';
import { DashboardData } from '../data/dashboard-data';
import { REFERRALS, Referral } from '../data/referrals';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Exporter } from '../shared/exporter';
import { Lookback } from '../shared/lookback';
import { CmData, CmManagerStat, CmTeamStat, CmQueueCard, QueueBand, queueBandOf, SlaBand, slaBandOf, CM_COLUMNS, cmToRow } from '../shared/cm-data';
import { CARE_MANAGERS, CmCaseRec, AssignmentMethod } from '../data/cm-case-pool';
import { CaseType, CASE_TYPES, ConsentType, AssessmentType, REFERRAL_SOURCES, ReferralSource, ReferralStatus, consentAtRisk, tatAdherent } from '../data/cm-intake';
import { Reassign, ReassignCase } from '../shared/reassign';
import { Escalate } from '../shared/escalate';
import { Pto } from '../shared/pto';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';

interface CmMemberRow { name: string; risk: number; level: 'Low'|'Moderate'|'High'|'Critical'; acuity: 'Low'|'Medium'|'High'; cost: string; sla: string; slaTone: string; cm: string; dx: string; }

const CM_WORKFORCE_WIDGETS = [
  { id: 'New Referral Queue', title: 'New Referral Queue' }, { id: 'Outreach Queue', title: 'Outreach Queue' },
  { id: 'Reassessment Queue', title: 'Reassessment Queue' }, { id: 'Escalation Queue', title: 'Escalation Queue' },
  { id: 'Discharge Follow-Up Queue', title: 'Discharge Follow-Up Queue' }, { id: 'Documentation Queue', title: 'Documentation Queue' },
  { id: 'workload', title: 'Workload per Care Manager' },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const CM_INTAKE_WIDGETS = [
  { id: 'stages', title: 'Lifecycle Stages' }, { id: 'referralsBySource', title: 'Referrals by Source' },
  { id: 'referralsByStatus', title: 'Referrals by Status' }, { id: 'consent', title: 'Consent' },
  { id: 'assessments', title: 'Assessments' }, { id: 'outreach', title: 'Outreach' },
];
const CM_REFERRALS_WIDGETS = [
  { id: 'intakeQueue', title: 'Referral Intake Queue' }, { id: 'sources', title: 'Referral Sources (MTD)' },
];
const CM_AI_WIDGETS = [
  { id: 'recommendations', title: 'AI Recommendations' }, { id: 'riskGauges', title: 'Predictive Risk Gauges' },
  { id: 'risingMembers', title: 'Rising-Risk Members' },
];

// Same "how aggressively to rebalance" strategy chooser as UM's Balance service — kept CM-local
// (rather than sharing UM's Balance) since Balance.run() is coupled to DashboardData/nurses;
// see the memory note on why a literal shared service wasn't worth it for this one flow.
const CM_BALANCE_STRATEGIES = [
  { label: 'Light — move 1 member from the busiest care manager', n: 1 },
  { label: 'Standard — rebalance 3 members', n: 3 },
  { label: 'Aggressive — rebalance 6 members', n: 6 },
  { label: 'Even out — level everyone toward the team average', n: 5 },
];
const REFERRAL_BALANCE_STRATEGIES = [
  { label: 'Light — assign 1 pending referral', n: 1 },
  { label: 'Standard — assign 3 pending referrals', n: 3 },
  { label: 'All — assign every pending referral', n: 999 },
];

const TABS = ['Workforce & Caseload','Intake & Assessment SLA','Care Plan & Outcomes','Risk & Escalation','Program Management','Assessments & Documentation','Referrals & Sources','Financial / Cost','Audit & Compliance','AI / NextGen'];

@Component({
  selector: 'app-cm-dashboard',
  standalone: true,
  imports: [KpiStrip, Ring, FormsModule, Icon, WidgetActions, WidgetCustomize],
  template: `
    <app-kpi-strip [items]="displayKpis()" (drill)="onKpi($event)" />

    <nav class="subtabs">
      @for (t of tabs; track t; let i = $index) {
        <button class="subtab" [class.active]="sel() === i" (click)="sel.set(i)">{{ t }}</button>
      }
    </nav>

    @switch (sel()) {
      <!-- 0: Workforce & Caseload -->
      @case (0) {
        <div class="tab-head"><h2>Caseload &amp; Workload Balancing</h2>
          <div class="flex gap-8">
            <button class="btn primary" (click)="cmReassign()"><z-icon name="swap" [size]="14"></z-icon> Reassign</button>
            <button class="btn outline" (click)="cmBalance()"><z-icon name="balance" [size]="14"></z-icon> Balance</button>
            <button class="btn outline esc" (click)="cmEscalate()"><z-icon name="arrowup" [size]="14"></z-icon> Escalate</button>
            <button class="btn outline" (click)="openPto()"><z-icon name="calendar" [size]="14"></z-icon> PTO</button>
            <button class="btn outline" (click)="openAssignmentHistory()"><z-icon name="clock" [size]="14"></z-icon> Assignment History</button>
            <button class="btn outline sm" (click)="exportCaseload()">Export</button>
            <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
          </div>
        </div>

        <z-widget-customize [vis]="vis"></z-widget-customize>

        <h3 class="sec-title">Queues</h3>

        <div class="queues">
          @for (q of cmQueues(); track q.name) {
            @if (!isHidden(q.name)) {
            <div class="qcard">
              <z-widget-actions (exportClick)="exportQueue(q)" (removeClick)="hide(q.name)"></z-widget-actions>
              <div class="qtop"><span class="qname">{{ q.name }}</span><span class="qcount">{{ q.count }}</span></div>
              <div class="seg">
                <span class="s-fresh" [style.width.%]="q.buckets.fresh" title="0–24h in queue" (click)="openQueueBand(q.name, 'fresh')"></span>
                <span class="s-day2" [style.width.%]="q.buckets.day2" title="24–48h in queue" (click)="openQueueBand(q.name, 'day2')"></span>
                <span class="s-over48" [style.width.%]="q.buckets.over48" title="Over 48h in queue" (click)="openQueueBand(q.name, 'over48')"></span>
                <span class="s-breach" [style.width.%]="q.buckets.breach" title="Past SLA deadline" (click)="openQueueBand(q.name, 'breach')"></span>
              </div>
              <div class="legend">
                <span (click)="openQueueBand(q.name, 'fresh')"><i class="d-fresh"></i>0-24h</span>
                <span (click)="openQueueBand(q.name, 'day2')"><i class="d-day2"></i>24-48h</span>
                <span (click)="openQueueBand(q.name, 'over48')"><i class="d-over48"></i>&gt;48h</span>
                <span (click)="openQueueBand(q.name, 'breach')"><i class="d-breach"></i>Breach</span>
              </div>
            </div>
            }
          }
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head">
            <h3 class="pt">How Members Were Assigned</h3>
            <label class="sortsel">
              <span>Team</span>
              <select [value]="assignTeamFilter()" (change)="assignTeamFilter.set($any($event.target).value)">
                <option value="all">All Teams</option>
                @for (t of cmTeams(); track t.name) { <option [value]="t.name">{{ t.name }}</option> }
              </select>
            </label>
          </div>
          <div class="am-tiles">
            @for (a of assignmentBreakdown(); track a.method) {
              <div class="am-tile" (click)="openAssignmentMethod(a.method)">
                <div class="am-count">{{ a.count }}</div>
                <div class="am-label">{{ a.method }}</div>
              </div>
            }
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head">
            <h3 class="pt">Cases by Case Type</h3>
            <label class="sortsel">
              <span>Team</span>
              <select [value]="caseTypeTeamFilter()" (change)="caseTypeTeamFilter.set($any($event.target).value)">
                <option value="all">All Teams</option>
                @for (t of cmTeams(); track t.name) { <option [value]="t.name">{{ t.name }}</option> }
              </select>
            </label>
          </div>
          <div class="am-tiles ct-tiles">
            @for (c of caseTypeBreakdown(); track c.type) {
              <div class="am-tile" (click)="openCaseType(c.type)">
                <div class="am-count">{{ c.count }}</div>
                <div class="am-label">{{ c.type }}</div>
              </div>
            }
          </div>
        </div>

        @if (!isHidden('workload')) {
        <div class="panel mt-6">
          <div class="panel-pad tbl-head">
            <h3 class="pt">Workload {{ groupBy() === 'team' ? '— by Team' : 'per Care Manager' }}</h3>
            <z-widget-actions (exportClick)="exportWorkload()" (removeClick)="hide('workload')"></z-widget-actions>
            <div class="seg-toggle">
              <button [class.on]="groupBy() === 'manager'" (click)="groupBy.set('manager')">By Care Manager</button>
              <button [class.on]="groupBy() === 'team'" (click)="groupBy.set('team')">By Team</button>
            </div>
          </div>

          @if (groupBy() === 'manager') {
          <table class="z-table">
            <thead><tr>
              <th class="srt" (click)="sortCm('name')">Care Manager{{ caretCm('name') }}</th>
              <th class="srt" (click)="sortCm('active')">Active{{ caretCm('active') }}</th>
              <th class="srt" (click)="sortCm('highRisk')">High Risk{{ caretCm('highRisk') }}</th>
              <th class="srt" (click)="sortCm('highAcuity')">High Acuity{{ caretCm('highAcuity') }}</th>
              <th class="srt" (click)="sortCm('highCost')">High Cost{{ caretCm('highCost') }}</th>
              <th class="srt" (click)="sortCm('slaAtRisk')">SLA At-Risk{{ caretCm('slaAtRisk') }}</th>
              <th class="srt" (click)="sortCm('utilization')">Utilization{{ caretCm('utilization') }}</th><th>Actions</th></tr></thead>
            <tbody>@for (c of sortedCms(); track c.name) {
              <tr class="clk" (click)="openCm(c)"><td class="strong"><a class="ml" [href]="rosterHref(c)" target="_blank" rel="noopener" title="Open {{ c.name }}'s roster in a new tab" (click)="$event.stopPropagation()">{{ c.name }}</a><div class="sub">{{ c.discipline }}</div></td>
                <td class="num clk" (click)="openCmActive(c); $event.stopPropagation()">{{ c.active }}</td>
                <td class="clk" (click)="openCmFlag(c,'highRisk'); $event.stopPropagation()"><b [class.hot]="c.highRisk>0">{{ c.highRisk }}</b></td>
                <td class="clk" (click)="openCmFlag(c,'highAcuity'); $event.stopPropagation()"><b [class.hot]="c.highAcuity>0">{{ c.highAcuity }}</b></td>
                <td class="clk" (click)="openCmFlag(c,'highCost'); $event.stopPropagation()"><b [class.hot]="c.highCost>0">{{ c.highCost }}</b></td>
                <td class="clk" (click)="openCmFlag(c,'slaAtRisk'); $event.stopPropagation()"><b [class.warn]="c.slaAtRisk>0">{{ c.slaAtRisk }}</b></td>
                <td><span class="mini-bar" [class.teal]="c.utilization<80" [class.red]="c.utilization>=90"><span [style.width.%]="c.utilization"></span></span>
                  <span class="pct">{{ c.utilization }}%</span></td>
                <td><button class="btn outline sm" (click)="cmReassignOne(c); $event.stopPropagation()">Reassign</button></td></tr>
            }</tbody></table>
          } @else {
          <table class="z-table">
            <thead><tr><th>Team / Care Manager</th><th>Active</th><th>High Risk</th><th>High Acuity</th><th>High Cost</th><th>SLA At-Risk</th><th>Utilization</th><th>Actions</th></tr></thead>
            <tbody>
              @for (t of cmTeams(); track t.name) {
                <tr class="team-row" (click)="toggleTeam(t.name)">
                  <td class="strong"><span class="chev" [class.open]="expanded().has(t.name)">▸</span> {{ t.name }} <span class="tcount">{{ t.managers.length }} managers</span></td>
                  <td class="num">{{ t.active }}</td>
                  <td><b [class.hot]="t.highRisk>0">{{ t.highRisk }}</b></td>
                  <td><b [class.hot]="t.highAcuity>0">{{ t.highAcuity }}</b></td>
                  <td><b [class.hot]="t.highCost>0">{{ t.highCost }}</b></td>
                  <td><b [class.warn]="t.slaAtRisk>0">{{ t.slaAtRisk }}</b></td>
                  <td><span class="mini-bar" [class.teal]="t.utilization<80" [class.red]="t.utilization>=90"><span [style.width.%]="t.utilization"></span></span>
                    <span class="pct strong">{{ t.utilization }}%</span></td>
                  <td><button class="btn outline sm" (click)="cmBalanceTeam(t); $event.stopPropagation()">Balance</button></td></tr>
                @if (expanded().has(t.name)) {
                  @for (c of t.managers; track c.name) {
                    <tr class="nurse-child clk" (click)="openCm(c)">
                      <td class="child-name"><a class="ml" [href]="rosterHref(c)" target="_blank" rel="noopener" title="Open {{ c.name }}'s roster in a new tab" (click)="$event.stopPropagation()">{{ c.name }}</a><div class="sub">{{ c.discipline }}</div></td>
                      <td class="num clk" (click)="openCmActive(c); $event.stopPropagation()">{{ c.active }}</td>
                      <td class="clk" (click)="openCmFlag(c,'highRisk'); $event.stopPropagation()"><b [class.hot]="c.highRisk>0">{{ c.highRisk }}</b></td>
                      <td class="clk" (click)="openCmFlag(c,'highAcuity'); $event.stopPropagation()"><b [class.hot]="c.highAcuity>0">{{ c.highAcuity }}</b></td>
                      <td class="clk" (click)="openCmFlag(c,'highCost'); $event.stopPropagation()"><b [class.hot]="c.highCost>0">{{ c.highCost }}</b></td>
                      <td class="clk" (click)="openCmFlag(c,'slaAtRisk'); $event.stopPropagation()"><b [class.warn]="c.slaAtRisk>0">{{ c.slaAtRisk }}</b></td>
                      <td><span class="mini-bar" [class.teal]="c.utilization<80" [class.red]="c.utilization>=90"><span [style.width.%]="c.utilization"></span></span>
                        <span class="pct">{{ c.utilization }}%</span></td>
                      <td><button class="btn outline sm" (click)="cmReassignOne(c); $event.stopPropagation()">Reassign</button></td></tr>
                  }
                }
              }
            </tbody>
          </table>
          }
        </div>
        }
      }

      <!-- 1: Intake & Assessment SLA -->
      @case (1) {
        <div class="tab-head">
          <div><h2>Intake &amp; Assessment SLA</h2><span class="section-note">Members by lifecycle stage, banded by SLA status</span></div>
          <div class="flex gap-8">
            <button class="btn outline sm" (click)="exportStages()">Export</button>
            <button class="btn outline sm" (click)="visIntake.customizing() ? visIntake.cancel() : visIntake.open()">Customize</button>
          </div>
        </div>

        <z-widget-customize [vis]="visIntake"></z-widget-customize>

        @if (!visIntake.isHidden('stages')) {
        <div class="qhint">Cards show <b>every member currently in that stage</b> of the intake/assessment lifecycle. Bars show SLA status. Click a band to see those members. <b>Overdue</b> = past the stage's SLA.</div>
        <div class="queues">
          @for (s of cmStages(); track s.name) {
            <div class="qcard">
              <div class="qtop"><span class="qname">{{ s.name }}</span><span class="qcount">{{ s.count }}</span></div>
              <div class="seg">
                <span class="s-ontrack" [style.width.%]="s.buckets.onTrack" title="On track" (click)="openStageBand(s.name, 'onTrack')"></span>
                <span class="s-duesoon" [style.width.%]="s.buckets.dueSoon" title="Due soon" (click)="openStageBand(s.name, 'dueSoon')"></span>
                <span class="s-overdue" [style.width.%]="s.buckets.overdue" title="Overdue" (click)="openStageBand(s.name, 'overdue')"></span>
              </div>
              <div class="legend">
                <span (click)="openStageBand(s.name, 'onTrack')"><i class="d-ontrack"></i>On track</span>
                <span (click)="openStageBand(s.name, 'dueSoon')"><i class="d-duesoon"></i>Due soon</span>
                <span (click)="openStageBand(s.name, 'overdue')"><i class="d-overdue"></i>Overdue</span>
              </div>
            </div>
          }
        </div>
        }

        <div class="tbl-head mt-6">
          <h3 class="sec-title">Referrals</h3>
          <div class="flex gap-8">
            <button class="btn outline sm" (click)="reassignReferrals()"><z-icon name="swap" [size]="13"></z-icon> Reassign Pending</button>
            <button class="btn outline sm" (click)="balanceReferrals()"><z-icon name="balance" [size]="13"></z-icon> Balance Pending</button>
          </div>
        </div>
        <div class="grid-2">
          @if (!visIntake.isHidden('referralsBySource')) {
          <div class="panel panel-pad">
            <div class="tbl-head"><h3 class="pt">By Source (30d)</h3><z-widget-actions (exportClick)="exportReferralsBySource()" (removeClick)="visIntake.remove('referralsBySource')"></z-widget-actions></div>
            <div class="bars">
              @for (r of referralsBySource(); track r.label) {
                <div class="bar-row"><span class="bl">{{ r.label }}</span><span class="bt"><span class="bf" [style.width.%]="r.pct" [style.background]="r.color"></span></span><span class="bv clk" (click)="openReferralSource(r.label)">{{ r.value }}</span></div>
              }
            </div>
          </div>
          }
          @if (!visIntake.isHidden('referralsByStatus')) {
          <div class="panel panel-pad">
            <div class="tbl-head"><h3 class="pt">By Status (30d)</h3><z-widget-actions (exportClick)="exportReferralsByStatus()" (removeClick)="visIntake.remove('referralsByStatus')"></z-widget-actions></div>
            <div class="am-tiles">
              @for (r of referralsByStatus(); track r.status) {
                <div class="am-tile" (click)="openReferralStatus(r.status)">
                  <div class="am-count">{{ r.count }}</div>
                  <div class="am-label">{{ r.status }}</div>
                </div>
              }
            </div>
          </div>
          }
        </div>

        @if (!visIntake.isHidden('consent')) {
        <div class="tbl-head mt-6"><h3 class="sec-title" style="margin:0">Consent</h3><z-widget-actions (exportClick)="exportConsent()" (removeClick)="visIntake.remove('consent')"></z-widget-actions></div>
        <div class="queues">
          @for (c of consentBreakdown(); track c.type) {
            <div class="qcard">
              <div class="qtop"><span class="qname">{{ c.type }}</span><span class="qcount">{{ c.count }}</span></div>
              <div class="seg">
                <span class="s-ontrack" [style.width.%]="pct(c.count - c.atRisk, c.count)" title="Current" (click)="openConsent(c.type, false)"></span>
                <span class="s-overdue" [style.width.%]="pct(c.atRisk, c.count)" title="At risk of expiring" (click)="openConsent(c.type, true)"></span>
              </div>
              <div class="legend">
                <span (click)="openConsent(c.type, false)"><i class="d-ontrack"></i>Current</span>
                <span (click)="openConsent(c.type, true)"><i class="d-overdue"></i>At risk ({{ c.atRisk }})</span>
              </div>
            </div>
          }
        </div>
        }

        @if (!visIntake.isHidden('assessments')) {
        <div class="tbl-head mt-6"><h3 class="sec-title" style="margin:0">Assessments</h3><z-widget-actions (exportClick)="exportAssessments()" (removeClick)="visIntake.remove('assessments')"></z-widget-actions></div>
        <div class="queues">
          @for (a of assessmentBreakdown(); track a.type) {
            <div class="qcard">
              <div class="qtop"><span class="qname">{{ a.type }}</span><span class="qcount">{{ a.count }}</span></div>
              <div class="seg">
                <span class="s-ontrack" [style.width.%]="pct(a.adherent, a.count)" title="TAT adherent" (click)="openAssessment(a.type, true)"></span>
                <span class="s-overdue" [style.width.%]="pct(a.count - a.adherent, a.count)" title="TAT missed" (click)="openAssessment(a.type, false)"></span>
              </div>
              <div class="legend">
                <span (click)="openAssessment(a.type, true)"><i class="d-ontrack"></i>TAT adherent</span>
                <span (click)="openAssessment(a.type, false)"><i class="d-overdue"></i>TAT missed</span>
              </div>
            </div>
          }
        </div>
        }

        @if (!visIntake.isHidden('outreach')) {
        <div class="tbl-head mt-6"><h3 class="sec-title" style="margin:0">Outreach</h3><z-widget-actions (exportClick)="exportOutreach()" (removeClick)="visIntake.remove('outreach')"></z-widget-actions></div>
        <div class="grid-3">
          <div class="metric-tile"><div class="val">{{ outreachStats().successRate }}%</div><div class="lab">Outreach Success Rate</div></div>
          <div class="metric-tile"><div class="val">{{ outreachStats().avgAttempts }}</div><div class="lab">Avg Attempts per Member</div></div>
          <div class="metric-tile clk" (click)="openUtrLetters()"><div class="val">{{ outreachStats().utrCount }}</div><div class="lab">UTR Letters Sent</div></div>
        </div>
        }
      }

      <!-- 2: Care Plan & Outcomes -->
      @case (2) {
        <div class="tab-head"><h2>Care Plan &amp; Outcomes</h2><span class="section-note">Care-plan status and goal attainment</span></div>
        <div class="dstats">
          <div class="dstat teal"><div class="dv">68</div><div class="dl">Active</div></div>
          <div class="dstat amber"><div class="dv">24</div><div class="dl">In Progress</div></div>
          <div class="dstat gray"><div class="dv">6</div><div class="dl">On Hold</div></div>
          <div class="dstat green"><div class="dv">41</div><div class="dl">Closed (MTD)</div></div>
          <div class="dstat blue"><div class="dv">91%</div><div class="dl">Adherence</div></div>
          <div class="dstat teal"><div class="dv">73%</div><div class="dl">Goals Met</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Goals at Risk</h3></div>
          <table class="z-table"><thead><tr><th>Member</th><th>Goal</th><th>Target</th><th>Status</th><th>Barrier</th></tr></thead>
          <tbody>@for (g of goalsAtRisk; track g.member) {
            <tr class="clk" (click)="members.openByName(g.member)"><td><a class="ml">{{ g.member }}</a></td><td>{{ g.goal }}</td><td>{{ g.target }}</td>
              <td><span class="badge amber">{{ g.status }}</span></td><td>{{ g.barrier }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 3: Risk & Escalation -->
      @case (3) {
        <div class="tab-head"><h2>Risk &amp; Escalation</h2><span class="section-note note-warn">High-risk, high-acuity &amp; high-cost members</span></div>
        <div class="rtiles">
          <div class="rtile red"><div class="rl">High-Risk Members</div><div class="rv">23</div><div class="rf">8 rising this week</div></div>
          <div class="rtile amber"><div class="rl">High-Acuity</div><div class="rv">14</div><div class="rf">ICU / oncology / transplant</div></div>
          <div class="rtile amber"><div class="rl">High-Cost (>$100k)</div><div class="rv">9</div><div class="rf">$3.4M annual exposure</div></div>
          <div class="rtile blue"><div class="rl">Escalated Today</div><div class="rv">4</div><div class="rf">to MD / social work</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad tbl-head"><h3 class="pt">High-Priority Member Worklist</h3>
          <div class="flex gap-8 center">
            <input class="search" type="text" placeholder="Search members…" [ngModel]="wlSearch()" (ngModelChange)="wlSearch.set($event)" />
            <button class="btn outline sm" (click)="exportWorklist()">Export</button></div></div>
          <table class="z-table"><thead><tr>
            <th class="srt" (click)="sortWl('name')">Member{{ caretWl('name') }}</th><th>Primary Dx</th>
            <th class="srt" (click)="sortWl('risk')">Risk{{ caretWl('risk') }}</th><th>Acuity</th>
            <th>Annual Cost</th><th>SLA</th><th>Care Manager</th><th>Action</th></tr></thead>
          <tbody>@for (m of visibleWorklist(); track m.name) {
            <tr class="clk" (click)="members.openByName(m.name)"><td><a class="ml">{{ m.name }}</a></td><td>{{ m.dx }}</td>
              <td><span class="score" [attr.data-l]="m.level">{{ m.risk }} · {{ m.level }}</span></td>
              <td><span class="ac" [attr.data-a]="m.acuity">{{ m.acuity }}</span></td>
              <td class="strong">{{ m.cost }}</td>
              <td><span class="badge" [class.red]="m.slaTone==='red'" [class.amber]="m.slaTone==='amber'" [class.green]="m.slaTone==='green'">{{ m.sla }}</span></td>
              <td>{{ m.cm }}</td>
              <td><button class="btn outline teal sm" (click)="escalate(m); $event.stopPropagation()">Escalate</button></td></tr>
          } @empty { <tr><td colspan="8" class="empty">No members match "{{ wlSearch() }}".</td></tr> }</tbody></table></div>
      }

      <!-- 4: Program Management -->
      @case (4) {
        <div class="tab-head"><h2>Program Management</h2><span class="section-note">Enrollment &amp; program outcomes</span></div>
        <div class="panel panel-pad"><h3 class="pt">Program Enrollment</h3>
          <div class="bars">@for (p of programs; track p.label) {
            <div class="bar-row"><span class="bl">{{ p.label }}</span><span class="bt"><span class="bf" [style.width.%]="p.pct" [style.background]="p.color"></span></span><span class="bv">{{ p.value }}</span></div>
          }</div></div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Program Outcomes</h3></div>
          <table class="z-table"><thead><tr><th>Program</th><th>Enrolled</th><th>Goal Attainment</th><th>Readmit Reduction</th><th>Status</th></tr></thead>
          <tbody>@for (o of programOutcomes; track o.program) {
            <tr><td class="strong">{{ o.program }}</td><td class="num">{{ o.enrolled }}</td><td>{{ o.attainment }}</td><td class="num">{{ o.readmit }}</td>
              <td><span class="badge green">{{ o.status }}</span></td></tr>
          }</tbody></table></div>
      }

      <!-- 5: Assessments & Documentation -->
      @case (5) {
        <div class="tab-head"><h2>Assessments &amp; Documentation</h2><span class="section-note">Assessment completion &amp; documentation quality</span></div>
        <div class="grid-3">
          <div class="panel panel-pad bar-block"><div class="bar-top">HRA Completion</div><div class="bar-val">88%</div><div class="pbar"><span style="width:88%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">SDOH Screening</div><div class="bar-val">76%</div><div class="pbar amber"><span style="width:76%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">Care Plan Documented</div><div class="bar-val">94%</div><div class="pbar"><span style="width:94%"></span></div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Overdue Assessments</h3></div>
          <table class="z-table"><thead><tr><th>Member</th><th>Assessment</th><th>Due</th><th>Days Overdue</th><th>Care Manager</th></tr></thead>
          <tbody>@for (a of overdueAssess; track a.member) {
            <tr class="clk" (click)="members.openByName(a.member)"><td><a class="ml">{{ a.member }}</a></td><td>{{ a.tool }}</td><td>{{ a.due }}</td>
              <td class="danger">{{ a.overdue }}</td><td>{{ a.cm }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 6: Referrals & Sources -->
      @case (6) {
        <div class="tab-head">
          <div><h2>Referrals &amp; Sources</h2><span class="section-note">Incoming referrals — including UM → CM</span></div>
          <button class="btn outline sm" (click)="visReferrals.customizing() ? visReferrals.cancel() : visReferrals.open()">Customize</button>
        </div>

        <z-widget-customize [vis]="visReferrals"></z-widget-customize>

        @if (!visReferrals.isHidden('intakeQueue')) {
        <div class="panel"><div class="panel-pad tbl-head"><h3 class="pt">Referral Intake Queue</h3><z-widget-actions (exportClick)="exportIntakeQueue()" (removeClick)="visReferrals.remove('intakeQueue')"></z-widget-actions></div>
          <table class="z-table"><thead><tr><th>Source Auth</th><th>Member</th><th>Reason</th><th>Referred By</th><th>Intake SLA</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>@for (r of referrals(); track r.authId) {
            <tr><td class="strong">{{ r.authId }}</td><td><a class="ml" (click)="members.openByName(r.member)">{{ r.member }}</a></td><td>{{ r.reason }}</td><td>{{ r.fromStage }}</td>
              <td><span class="badge" [class.red]="r.slaTone==='red'" [class.amber]="r.slaTone==='amber'" [class.green]="r.slaTone==='green'">{{ r.sla }}</span></td>
              <td><span class="badge blue">{{ r.status }}</span></td>
              <td>@if (r.status === 'Pending intake') { <button class="btn outline teal sm" (click)="accept(r)">Accept &amp; assign</button> } @else { <span class="muted-label">—</span> }</td></tr>
          }</tbody></table></div>
        }
        @if (!visReferrals.isHidden('sources')) {
        <div class="panel panel-pad mt-6"><div class="tbl-head"><h3 class="pt">Referral Sources (MTD)</h3><z-widget-actions (exportClick)="exportSourcesMtd()" (removeClick)="visReferrals.remove('sources')"></z-widget-actions></div>
          <div class="bars">@for (s of sources; track s.label) {
            <div class="bar-row"><span class="bl">{{ s.label }}</span><span class="bt"><span class="bf" [style.width.%]="s.pct" [style.background]="s.color"></span></span><span class="bv">{{ s.value }}</span></div>
          }</div></div>
        }
      }

      <!-- 7: Financial / Cost -->
      @case (7) {
        <div class="tab-head"><h2>Financial / Cost</h2><span class="section-note">Cost avoidance and high-cost members</span></div>
        <div class="grid-3">
          <div class="metric-tile"><div class="val">$0.4M</div><div class="lab">Cost Avoided (MTD)</div></div>
          <div class="metric-tile"><div class="val">$3.4M</div><div class="lab">High-Cost Exposure</div></div>
          <div class="metric-tile"><div class="val">$412</div><div class="lab">PMPM (Managed)</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Highest-Cost Members</h3></div>
          <table class="z-table"><thead><tr><th>Member</th><th>Primary Dx</th><th>Annual Cost</th><th>Risk</th><th>Care Manager</th></tr></thead>
          <tbody>@for (m of worklist.slice(0,5); track m.name) {
            <tr class="clk" (click)="members.openByName(m.name)"><td><a class="ml">{{ m.name }}</a></td><td>{{ m.dx }}</td><td class="strong">{{ m.cost }}</td>
              <td><span class="score" [attr.data-l]="m.level">{{ m.risk }}</span></td><td>{{ m.cm }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 8: Audit & Compliance -->
      @case (8) {
        <div class="tab-head"><h2>Audit &amp; Compliance</h2><span class="section-note">Documentation &amp; regulatory compliance</span></div>
        <div class="grid-3">
          <div class="panel panel-pad"><div class="clab">Care Plan Timeliness</div><div class="cval">92%</div><div class="pbar"><span style="width:92%"></span></div></div>
          <div class="panel panel-pad"><div class="clab">Assessment Compliance</div><div class="cval">85%</div><div class="pbar"><span style="width:85%"></span></div></div>
          <div class="panel panel-pad"><div class="clab">Consent on File</div><div class="cval">97%</div><div class="pbar"><span style="width:97%"></span></div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Audit Flags</h3></div>
          <table class="z-table"><thead><tr><th>ID</th><th>Type</th><th>Description</th><th>Date</th><th>Severity</th></tr></thead>
          <tbody>@for (f of cmFlags; track f.id) {
            <tr><td class="strong">{{ f.id }}</td><td>{{ f.type }}</td><td>{{ f.desc }}</td><td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.sev==='High'" [class.amber]="f.sev==='Medium'" [class.green]="f.sev==='Low'">{{ f.sev }}</span></td></tr>
          }</tbody></table></div>
      }

      <!-- 9: AI / NextGen -->
      @case (9) {
        <div class="ai-shell">
          <div class="ai-head"><h2>AI / NextGen Intelligence</h2>
            <div class="flex gap-8 center">
              <span class="ai-pill">AI-Powered</span>
              <button class="btn outline sm" (click)="visAi.customizing() ? visAi.cancel() : visAi.open()">Customize</button>
            </div>
          </div>

          <z-widget-customize [vis]="visAi"></z-widget-customize>

          @if (!visAi.isHidden('recommendations')) {
          <div class="rec-wrap">
            <z-widget-actions (exportClick)="exportRecommendations()" (removeClick)="visAi.remove('recommendations')"></z-widget-actions>
            <div class="recs">
              <div class="rec red"><div class="rt">Rising-Risk Alert — Marcus Webb</div><div class="rd">Predicted 30-day readmission risk 84%. Recommend intensive outreach + nephrology coordination.</div><button class="btn primary rbtn" (click)="toast('Outreach task created for Marcus Webb.')">Create outreach task</button></div>
              <div class="rec amber"><div class="rt">Program Match — Yolanda Reyes</div><div class="rd">Eligible for Maternal Care program based on risk factors. AI confidence 88%.</div><button class="btn primary rbtn" (click)="toast('Enrolled in Maternal Care program.')">Enroll in program</button></div>
              <div class="rec blue"><div class="rt">SDOH Gap — Denise Holloway</div><div class="rd">Transportation barrier detected. Recommend community resource referral.</div><button class="btn primary rbtn" (click)="toast('Community resource referral sent.')">Send referral</button></div>
            </div>
          </div>
          }
          <div class="ai-bottom">
            @if (!visAi.isHidden('riskGauges')) {
            <div class="panel panel-pad"><div class="tbl-head"><h3 class="pt">Predictive Risk Gauges</h3><z-widget-actions (exportClick)="exportRiskGauges()" (removeClick)="visAi.remove('riskGauges')"></z-widget-actions></div>
              <div class="gauges">
                <div class="g"><z-ring [value]="84" [size]="90" [thickness]="9" tone="red" [fontSize]="18"></z-ring><div class="gl">Readmission Risk</div></div>
                <div class="g"><z-ring [value]="31" [size]="90" [thickness]="9" tone="amber" [fontSize]="18"></z-ring><div class="gl">ER Utilization Risk</div></div>
                <div class="g"><z-ring [value]="19" [size]="90" [thickness]="9" tone="amber" [fontSize]="18"></z-ring><div class="gl">Care Gap Risk</div></div>
              </div>
            </div>
            }
            @if (!visAi.isHidden('risingMembers')) {
            <div class="panel panel-pad"><div class="tbl-head"><h3 class="pt">Rising-Risk Members</h3><z-widget-actions (exportClick)="exportRisingMembers()" (removeClick)="visAi.remove('risingMembers')"></z-widget-actions></div>
              <div class="bars">@for (m of worklist.slice(0,4); track m.name) {
                <div class="bar-row"><span class="bl wide">{{ m.name }}</span><span class="bt"><span class="bf" [style.width.%]="m.risk*10" style="background:#ef4444"></span></span><span class="bv">{{ m.risk }}</span></div>
              }</div></div>
            }
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .sub { font-size:11px; color:var(--gray-500); font-weight:400; margin-top:2px; }
    b.hot { color:#c2410c; } b.warn { color:var(--amber-fg); }
    .pct { margin-left:10px; font-size:12.5px; font-weight:600; color:var(--ink-soft); }
    .clk { cursor:pointer; } .ml { color:#2563eb; font-weight:600; cursor:pointer; } .ml:hover { text-decoration:underline; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 4px; }
    .note-warn { color:var(--amber-fg); }
    .flex { display:flex; } .gap-8 { gap:8px; } .center { align-items:center; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .srt { cursor:pointer; user-select:none; } .srt:hover { color:var(--ink-soft); }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:200px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .empty { text-align:center; color:var(--gray-500); padding:22px; }
    .score { font-weight:600; font-size:12px; padding:2px 9px; border-radius:6px; }
    .score[data-l="Critical"]{ background:var(--red-bg); color:var(--red-fg); } .score[data-l="High"]{ background:#ffedd5; color:#c2410c; }
    .score[data-l="Moderate"]{ background:var(--amber-bg); color:var(--amber-fg); } .score[data-l="Low"]{ background:var(--green-bg); color:var(--green-fg); }
    .ac { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--gray-100); color:var(--gray-500); }
    .ac[data-a="High"]{ background:#f3e8ff; color:#7e22ce; } .ac[data-a="Medium"]{ background:#ffedd5; color:#c2410c; }

    .sla-grid { display:grid; grid-template-columns:auto 1fr 1fr; gap:26px; align-items:center; }
    .donut { text-align:center; } .dlab { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:8px; }
    .rows { display:flex; flex-direction:column; gap:12px; }
    .srow { display:flex; justify-content:space-between; padding:12px 16px; border-radius:8px; font-size:13px; font-weight:500; }
    .srow i { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:8px; } .srow span { display:flex; align-items:center; } .srow b { font-weight:700; }
    .srow.green { background:#e7f8f0; color:var(--green-fg); } .srow.green i { background:var(--green); }
    .srow.amber { background:#fdf6e3; color:var(--amber-fg); } .srow.amber i { background:var(--amber); }
    .srow.red { background:#fdecec; color:var(--red-fg); } .srow.red i { background:var(--red); }
    .stats { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

    .dstats { display:grid; grid-template-columns:repeat(6,1fr); gap:14px; }
    .dstat { background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:18px 12px; text-align:center; }
    .dstat.teal{border-top-color:var(--teal-600);} .dstat.amber{border-top-color:var(--amber);} .dstat.gray{border-top-color:var(--gray-400);}
    .dstat.green{border-top-color:var(--green);} .dstat.blue{border-top-color:var(--blue);}
    .dv { font-size:26px; font-weight:700; color:var(--ink); } .dl { font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:4px; }

    .rtiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .rtile { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px 18px; }
    .rtile.red{border-left-color:var(--red);} .rtile.amber{border-left-color:var(--amber);} .rtile.blue{border-left-color:var(--blue);}
    .rl { font-size:12px; color:var(--gray-500); font-weight:600; } .rv { font-size:26px; font-weight:700; color:var(--ink); margin:8px 0 4px; } .rf { font-size:11px; color:var(--gray-500); }

    .bars { display:flex; flex-direction:column; gap:14px; }
    .bar-row { display:grid; grid-template-columns:130px 1fr 60px; align-items:center; gap:12px; font-size:12.5px; }
    .bar-row:has(.bl.wide) { grid-template-columns:150px 1fr 48px; }
    .bl { color:var(--ink-soft); font-weight:600; } .bt { height:10px; border-radius:999px; background:var(--gray-100); overflow:hidden; }
    .bf { display:block; height:100%; border-radius:999px; } .bv { text-align:right; font-weight:700; color:var(--ink); }
    .clab { font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom:8px; } .cval { font-size:26px; font-weight:700; color:var(--ink); margin-bottom:14px; }

    .ai-shell { border:1px solid var(--teal-600); border-radius:12px; padding:20px 22px; background:linear-gradient(180deg,#f7fdfc,#fff 40%); }
    .ai-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; } .ai-head h2 { margin:0; font-size:17px; }
    .ai-pill { background:var(--teal-700); color:#fff; font-size:11px; font-weight:700; padding:5px 12px; border-radius:999px; }
    .rec-wrap { position: relative; }
    .rec-wrap:hover z-widget-actions { opacity: 1; }
    .recs { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; }
    .rec.red{border-left-color:var(--red);} .rec.amber{border-left-color:var(--amber);} .rec.blue{border-left-color:var(--blue);}
    .rt { font-size:13.5px; font-weight:700; margin-bottom:6px; } .rd { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; } .rbtn { width:100%; justify-content:center; }
    .ai-bottom { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
    .gauges { display:flex; justify-content:space-around; padding:10px 0; } .g { text-align:center; } .gl { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }

    /* ---- Workforce & Caseload (case 0) ---- */
    .esc { color: var(--amber-fg); border-color: var(--gray-300); }
    .cz-btn { margin-left: 8px; }
    .sec-title { font-size: 13px; font-weight: 700; color: var(--ink-soft); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }
    .queues { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .am-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 0 18px 18px; }
    .ct-tiles { grid-template-columns: repeat(4, 1fr); }
    .am-tile { background: #fff; border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; cursor: pointer; transition: box-shadow .12s, transform .12s; }
    .am-tile:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); transform: translateY(-1px); }
    .am-count { font-size: 24px; font-weight: 700; color: var(--ink); }
    .am-label { font-size: 12px; font-weight: 600; color: var(--gray-500); margin-top: 4px; }
    .qcard { position: relative; background:#fff; border:1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
    .qcard:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
    .tbl-head { position: relative; }
    .qtop { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
    .qname { font-size: 14px; font-weight: 600; color: var(--ink); } .qcount { font-size: 15px; font-weight: 700; color: var(--ink); }
    .seg { display:flex; height: 8px; border-radius: 999px; overflow:hidden; background: var(--gray-100); }
    .seg > span { display:block; height:100%; cursor: pointer; }
    .s-fresh { background:#10b981; } .s-day2 { background:#f59e0b; } .s-over48 { background:#f97316; } .s-breach { background:#ef4444; }
    .s-ontrack { background:#10b981; } .s-duesoon { background:#f59e0b; } .s-overdue { background:#ef4444; }
    .legend { display:flex; gap:14px; margin-top:10px; font-size: 10.5px; color: var(--gray-500); }
    .legend span { display:flex; align-items:center; gap:4px; cursor: pointer; } .legend span:hover { color: var(--ink-soft); }
    .legend i { width:8px; height:8px; border-radius:2px; display:inline-block; }
    .d-fresh { background:#10b981; } .d-day2 { background:#f59e0b; } .d-over48 { background:#f97316; } .d-breach { background:#ef4444; }
    .d-ontrack { background:#10b981; } .d-duesoon { background:#f59e0b; } .d-overdue { background:#ef4444; }

    .seg-toggle { display: inline-flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; margin-left: 8px; }
    .seg-toggle button { border:none; background:#fff; padding:7px 14px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .seg-toggle button.on { background:var(--teal-700); color:#fff; }
    .team-row { cursor:pointer; background:var(--teal-50); }
    .team-row:hover { background:var(--teal-100); }
    .team-row .strong { color:var(--teal-900); }
    .chev { display:inline-block; transition:transform .12s; color:var(--teal-700); margin-right:4px; }
    .chev.open { transform:rotate(90deg); }
    .tcount { font-size:11px; font-weight:600; color:var(--gray-500); background:#fff; border:1px solid var(--border); padding:1px 8px; border-radius:999px; margin-left:6px; }
    .nurse-child td:first-child { padding-left:34px; } .child-name { color:var(--ink-soft); }
  `],
})
export class CmDashboard {
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);
  private exporter = inject(Exporter);
  private lookback = inject(Lookback);
  private cmData = inject(CmData);
  private rx = inject(Reassign);
  private esc = inject(Escalate);
  private pto = inject(Pto);
  readonly tabs = TABS;
  readonly sel = signal(0);

  readonly vis = new WidgetVisibility('zyter-cm-workforce-widgets-v2', CM_WORKFORCE_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  readonly visIntake = new WidgetVisibility('zyter-cm-intake-widgets-v1', CM_INTAKE_WIDGETS);
  readonly visReferrals = new WidgetVisibility('zyter-cm-referrals-widgets-v1', CM_REFERRALS_WIDGETS);
  readonly visAi = new WidgetVisibility('zyter-cm-ai-widgets-v1', CM_AI_WIDGETS);

  private readonly PERIOD_VALUES: Record<string, string[]> = {
    today: ['21', '13', '8', '2', '66', '4', '126', '97%'],
    '7d': ['22', '14', '9', '4', '67', '9', '127', '96%'],
    qtd: ['28', '17', '12', '9', '74', '41', '132', '95%'],
  };
  readonly displayKpis = computed(() => {
    const p = this.lookback.period();
    if (p === '30d' || !this.PERIOD_VALUES[p]) return this.kpis;
    return this.kpis.map((k, i) => ({ ...k, value: this.PERIOD_VALUES[p][i] }));
  });

  readonly kpis: KpiItem[] = [
    { icon: 'alert',  value: '23',  label: 'High-Risk Members', tone: 'red' },
    { icon: 'shield', value: '14',  label: 'High-Acuity',       tone: 'amber' },
    { icon: 'dollar', value: '9',   label: 'High-Cost (>$100k)', tone: 'amber' },
    { icon: 'clock',  value: '5',   label: 'SLA At-Risk',       tone: 'red' },
    { icon: 'folder', value: '68',  label: 'Active Care Plans', tone: 'teal' },
    { icon: 'inbox',  value: '14',  label: 'New Referrals',     tone: 'blue' },
    { icon: 'users',  value: '128', label: 'Members Managed',   tone: 'green' },
    { icon: 'check',  value: '96%', label: 'Intake SLA',        tone: 'green' },
  ];
  onKpi(_: string) { /* KPIs on CM navigate within tabs; no explorer wired yet */ }

  readonly worklist: CmMemberRow[] = [
    { name: 'Marcus Webb', dx: 'ESRD on dialysis', risk: 8.9, level: 'Critical', acuity: 'High', cost: '$412k', sla: 'Assessment overdue', slaTone: 'red', cm: 'Sara Nguyen, RN' },
    { name: 'Gloria Simmons', dx: 'Breast cancer', risk: 8.2, level: 'Critical', acuity: 'High', cost: '$286k', sla: 'On track', slaTone: 'green', cm: 'David Patel, MSW' },
    { name: 'Kristina Anderson', dx: 'Congestive heart failure', risk: 7.8, level: 'High', acuity: 'Medium', cost: '$198k', sla: 'Review due 2d', slaTone: 'amber', cm: 'Sara Nguyen, RN' },
    { name: 'Yolanda Reyes', dx: 'High-risk pregnancy', risk: 6.9, level: 'High', acuity: 'Medium', cost: '$142k', sla: 'On track', slaTone: 'green', cm: 'Maria Torres, RN' },
    { name: 'Denise Holloway', dx: 'COPD, severe', risk: 6.4, level: 'High', acuity: 'Medium', cost: '$118k', sla: 'Outreach overdue', slaTone: 'red', cm: 'Maria Torres, RN' },
    { name: 'Ronald Pierce', dx: 'Type 2 diabetes', risk: 5.1, level: 'Moderate', acuity: 'Medium', cost: '$74k', sla: 'On track', slaTone: 'green', cm: 'Angela Ruiz, RN' },
  ];
  readonly referrals = signal<Referral[]>([...REFERRALS]);
  readonly goalsAtRisk = [
    { member: 'Marcus Webb', goal: 'Fluid management adherence', target: '2026-08-10', status: 'At Risk', barrier: 'Missed dialysis sessions' },
    { member: 'Denise Holloway', goal: 'Smoking cessation', target: '2026-09-01', status: 'At Risk', barrier: 'Low engagement' },
    { member: 'Kristina Anderson', goal: 'Daily weight monitoring', target: '2026-08-15', status: 'At Risk', barrier: 'No home scale (SDOH)' },
  ];
  readonly programs = [
    { label: 'CHF DM', value: 42, pct: 100, color: '#0d9488' },
    { label: 'Diabetes', value: 38, pct: 90, color: '#3b82f6' },
    { label: 'Complex Care', value: 28, pct: 67, color: '#8b5cf6' },
    { label: 'BH Integration', value: 20, pct: 48, color: '#f59e0b' },
  ];
  readonly programOutcomes = [
    { program: 'CHF Disease Mgmt', enrolled: 42, attainment: '78%', readmit: '-22%', status: 'On track' },
    { program: 'Diabetes Mgmt', enrolled: 38, attainment: '81%', readmit: '-15%', status: 'On track' },
    { program: 'Complex Care', enrolled: 28, attainment: '69%', readmit: '-31%', status: 'On track' },
    { program: 'BH Integration', enrolled: 20, attainment: '72%', readmit: '-18%', status: 'On track' },
  ];
  readonly overdueAssess = [
    { member: 'Marcus Webb', tool: 'KDQOL-36', due: '2026-07-14', overdue: '7d', cm: 'Sara Nguyen, RN' },
    { member: 'Denise Holloway', tool: 'SDOH Screening', due: '2026-07-16', overdue: '5d', cm: 'Maria Torres, RN' },
    { member: 'Ronald Pierce', tool: 'HRA', due: '2026-07-18', overdue: '3d', cm: 'Angela Ruiz, RN' },
  ];
  readonly sources = [
    { label: 'UM Referral', value: 47, pct: 100, color: '#0d9488' },
    { label: 'Health Plan', value: 32, pct: 68, color: '#3b82f6' },
    { label: 'PCP / Provider', value: 24, pct: 51, color: '#8b5cf6' },
    { label: 'ER / Hospital', value: 18, pct: 38, color: '#f59e0b' },
    { label: 'Self / Family', value: 7, pct: 15, color: '#9ca3af' },
  ];
  readonly cmFlags = [
    { id: 'CM-118', type: 'Care Plan Timeliness', desc: 'Care plan not created within 14 days of enrollment — MBR000284', date: '2026-07-15', sev: 'Medium' },
    { id: 'CM-119', type: 'Missing Assessment', desc: 'HRA not completed for high-risk member — MBR000098', date: '2026-07-14', sev: 'High' },
    { id: 'CM-120', type: 'Consent', desc: 'Verbal consent not documented — MBR000201', date: '2026-07-13', sev: 'Low' },
  ];

  // ---- caseload: real data from CmData, drills, and Reassign/Balance/Escalate actions ----
  readonly cmQueues = computed(() => this.cmData.queues());
  readonly cmManagers = computed(() => this.cmData.managerStats());
  readonly cmTeams = computed(() => this.cmData.teamStats());

  // ---- Intake & Assessment SLA (case 1) — lifecycle-stage cards, the same "graphs" shape as the
  // first pass of Workforce & Caseload, now on the tab that actually owns lifecycle stage. ----
  readonly cmStages = computed(() => this.cmData.stages());
  openStageBand(stage: string, band: SlaBand) {
    const labels: Record<SlaBand, string> = { onTrack: 'On track', dueSoon: 'Due soon', overdue: 'Overdue' };
    const cases = this.cmData.cases().filter((x) => x.stage === stage && slaBandOf(x) === band);
    this.openCmCases(`${stage} — ${labels[band]}`, cases, `${slug(stage)}-${slug(band)}`);
  }
  exportStages() {
    this.exporter.open({ title: 'Intake & Assessment SLA', name: 'cm-intake-assessment-sla_2026-07-17',
      columns: ['Stage', 'Members', 'On Track %', 'Due Soon %', 'Overdue %'],
      rows: this.cmStages().map((s) => [s.name, s.count, s.buckets.onTrack, s.buckets.dueSoon, s.buckets.overdue]) });
  }
  pct(part: number, total: number): number { return total > 0 ? Math.round((part / total) * 100) : 0; }

  // ---- Referrals (30-day intake funnel — includes referrals that never became an active case,
  // so "by source"/"by status" reflects true intake volume, not just the survivors). Only Pending
  // referrals (future work — not yet triaged) are reassignable/balanceable; the rest are history. ----
  private readonly REFERRAL_COLORS: Record<ReferralSource, string> = { 'Fax': '#f59e0b', 'Provider Portal': '#3b82f6', 'Call': '#8b5cf6', 'UM Referral': '#0d9488' };
  readonly referralsBySource = computed(() => {
    const all = this.cmData.referrals();
    const total = all.length || 1;
    return REFERRAL_SOURCES.map((label) => {
      const value = all.filter((r) => r.source === label).length;
      return { label, value, pct: Math.round((value / total) * 100), color: this.REFERRAL_COLORS[label] };
    });
  });
  readonly referralsByStatus = computed(() => {
    const all = this.cmData.referrals();
    const statuses: ReferralStatus[] = ['Pending', 'Accepted', 'CM Declined', 'Member Declined'];
    return statuses.map((status) => ({ status, count: all.filter((r) => r.status === status).length }));
  });
  openReferralSource(source: ReferralSource) {
    const rows = this.cmData.referrals().filter((r) => r.source === source);
    this.ix.openDrawer({ title: `Referral Source: ${source}`, subtitle: `${rows.length} referral(s) in the last 30 days`,
      table: { columns: ['Referral ID', 'Member', 'Status', 'Received'], rows: rows.map((r) => [r.id, r.member, r.status, r.received]) } });
  }
  openReferralStatus(status: ReferralStatus) {
    const rows = this.cmData.referrals().filter((r) => r.status === status);
    this.ix.openDrawer({ title: `${status} Referrals`, subtitle: `${rows.length} referral(s) in the last 30 days`,
      table: { columns: ['Referral ID', 'Member', 'Source', 'Received'], rows: rows.map((r) => [r.id, r.member, r.source, r.received]) } });
  }
  exportReferralsBySource() {
    this.exporter.open({ title: 'Referrals by Source', name: 'cm-referrals-by-source_2026-07-17',
      columns: ['Source', 'Count', '% of Total'], rows: this.referralsBySource().map((r) => [r.label, r.value, r.pct]) });
  }
  exportReferralsByStatus() {
    this.exporter.open({ title: 'Referrals by Status', name: 'cm-referrals-by-status_2026-07-17',
      columns: ['Status', 'Count'], rows: this.referralsByStatus().map((r) => [r.status, r.count]) });
  }
  /** Bulk Reassign for pending referrals only — same shared Reassign panel as everywhere else,
   *  with a single synthetic "Pending Intake" queue so Queue mode doesn't fall back to UM's queues. */
  reassignReferrals() {
    const pending = this.cmData.referrals().filter((r) => r.status === 'Pending');
    const cases: ReassignCase[] = pending.map((r) => ({ authId: r.id, member: r.member, type: r.source, queue: 'Pending Intake', priority: 'Routine', owner: r.careManager ?? 'Unassigned' }));
    const nurses = this.cmManagers().map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }));
    this.rx.open({
      title: 'Reassign pending referrals', cases, nurses, queueTargets: [{ name: 'Pending Intake', count: pending.length }],
      apply: (ids, target, mode) => {
        if (mode === 'queue') { this.ix.toast('Pending referrals only have one intake queue right now.', 'info'); return; }
        ids.forEach((id) => this.cmData.reassignReferral(id, target));
        this.ix.toast(`${ids.length} referral(s) assigned to ${target}.`);
        this.data.addHistory('swap', 'Pending referrals assigned', `${ids.length} referral(s) → ${target}`);
      },
    });
  }
  /** Same strategy-picker Balance shape as cmBalance(), applied to the pending referral queue instead of the active caseload. */
  balanceReferrals() {
    const pendingCount = this.cmData.referrals().filter((r) => r.status === 'Pending').length;
    this.ix.choose({
      title: 'Balance pending referrals', body: 'Choose how many pending referrals to assign to care managers with capacity.',
      label: 'Balancing strategy', options: REFERRAL_BALANCE_STRATEGIES.map((s) => s.label), confirmLabel: 'Continue', tone: 'teal',
      onChoose: (opt) => {
        const strat = REFERRAL_BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        const n = Math.min(strat.n, pendingCount);
        if (!n) { this.ix.toast('No pending referrals to assign.', 'info'); return; }
        this.ix.ask({
          title: `Assign ${n} pending referral${n > 1 ? 's' : ''}`, body: 'Assign pending referrals to care managers with the most capacity:',
          confirmLabel: 'Assign', tone: 'teal',
          onConfirm: () => {
            const moves: { member: string; to: string }[] = [];
            for (let i = 0; i < n; i++) { const m = this.cmData.reassignNextPendingReferral(); if (m) moves.push(m); }
            this.ix.toast(`${moves.length} referral(s) assigned.`);
            const byTarget = new Map<string, number>();
            moves.forEach((m) => byTarget.set(m.to, (byTarget.get(m.to) ?? 0) + 1));
            const breakdown = [...byTarget.entries()].map(([to, cnt]) => `${cnt} → ${to}`).join(', ') || 'no moves';
            this.data.addHistory('balance', 'Pending referrals assigned', `${opt.split(' — ')[0]} · ${breakdown}`);
          },
        });
      },
    });
  }

  // ---- Consent on file, by type + at-risk-of-expiring ----
  readonly consentBreakdown = computed(() => this.cmData.consentBreakdown());
  openConsent(type: ConsentType, atRiskOnly: boolean) {
    const cases = this.cmData.cases().filter((c) => c.consentType === type && (!atRiskOnly || consentAtRisk(c)));
    this.openCmCases(`${type}${atRiskOnly ? ' — At Risk of Expiring' : ''}`, cases, `consent-${slug(type)}${atRiskOnly ? '-at-risk' : ''}`);
  }
  exportConsent() {
    this.exporter.open({ title: 'Consent', name: 'cm-consent-by-type_2026-07-17',
      columns: ['Consent Type', 'Members', 'At Risk of Expiring'], rows: this.consentBreakdown().map((c) => [c.type, c.count, c.atRisk]) });
  }

  // ---- Assessments, by type + TAT adherence ----
  readonly assessmentBreakdown = computed(() => this.cmData.assessmentBreakdown());
  openAssessment(type: AssessmentType, adherentOnly: boolean) {
    const cases = this.cmData.cases().filter((c) => c.assessmentType === type && tatAdherent(c) === adherentOnly);
    this.openCmCases(`${type} — ${adherentOnly ? 'TAT Adherent' : 'TAT Missed'}`, cases, `assessment-${slug(type)}-${adherentOnly ? 'adherent' : 'missed'}`);
  }
  exportAssessments() {
    this.exporter.open({ title: 'Assessments', name: 'cm-assessments-by-type_2026-07-17',
      columns: ['Assessment Type', 'Members', 'TAT Adherent'], rows: this.assessmentBreakdown().map((a) => [a.type, a.count, a.adherent]) });
  }

  // ---- Outreach success + Unable-To-Reach letters ----
  readonly outreachStats = computed(() => this.cmData.outreachStats());
  openUtrLetters() {
    const cases = this.cmData.cases().filter((c) => c.utrLetterSent);
    this.openCmCases('UTR Letters Sent', cases, 'utr-letters');
  }
  exportOutreach() {
    const s = this.outreachStats();
    this.exporter.open({ title: 'Outreach', name: 'cm-outreach-stats_2026-07-17',
      columns: ['Metric', 'Value'], rows: [['Success Rate %', s.successRate], ['Avg Attempts', s.avgAttempts], ['UTR Letters Sent', s.utrCount]] });
  }

  // ---- how members were assigned (queue draw vs direct) — independent of the operational queues above ----
  readonly assignTeamFilter = signal('all');
  readonly assignmentBreakdown = computed(() => this.cmData.assignmentBreakdown(this.assignTeamFilter() === 'all' ? undefined : this.assignTeamFilter()));
  openAssignmentMethod(method: AssignmentMethod) {
    const team = this.assignTeamFilter();
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const cases = this.cmData.cases().filter((c) => c.assignmentMethod === method && (team === 'all' || teamOf.get(c.careManager) === team));
    this.openCmCases(`${method}${team === 'all' ? '' : ' · ' + team}`, cases, `${slug(method)}${team === 'all' ? '' : '-' + slug(team)}`);
  }

  // ---- cases by case type (the intake wizard's own Case Type field) ----
  readonly caseTypeTeamFilter = signal('all');
  readonly caseTypeBreakdown = computed(() => this.cmData.caseTypeBreakdown(this.caseTypeTeamFilter() === 'all' ? undefined : this.caseTypeTeamFilter()));
  openCaseType(type: CaseType) {
    const team = this.caseTypeTeamFilter();
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const cases = this.cmData.cases().filter((c) => c.caseType === type && (team === 'all' || teamOf.get(c.careManager) === team));
    this.openCmCases(`${type}${team === 'all' ? '' : ' · ' + team}`, cases, `${slug(type)}${team === 'all' ? '' : '-' + slug(team)}`);
  }

  readonly groupBy = signal<'manager' | 'team'>('manager');
  readonly expanded = signal<Set<string>>(new Set());
  toggleTeam(name: string) { this.expanded.update((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; }); }
  /** Same strategy-picker Balance flow as cmBalance() below, just restricted to this team's care managers. */
  cmBalanceTeam(t: CmTeamStat) {
    const scope = new Set(t.managers.map((m) => m.name));
    this.ix.choose({
      title: `Balance ${t.name}`, body: `Choose how aggressively to rebalance members from over-utilized care managers to those with capacity within ${t.name}.`,
      label: 'Balancing strategy', options: CM_BALANCE_STRATEGIES.map((s) => s.label), confirmLabel: 'Continue', tone: 'teal',
      onChoose: (opt) => {
        const strat = CM_BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        const plan = this.cmData.simulateBalance(strat.n, scope);
        if (!plan.length) { this.ix.toast(`${t.name} is already balanced.`, 'info'); return; }
        this.ix.ask({
          title: `Balance ${plan.length} member${plan.length > 1 ? 's' : ''} in ${t.name}`,
          body: `Move members from over-utilized care managers to those with capacity within ${t.name}:`,
          breakdown: this.summarizeBalance(plan),
          confirmLabel: 'Balance', tone: 'teal',
          onConfirm: () => {
            const moves = plan.map(() => this.cmData.reassignBusiestCase(scope)).filter((m): m is { member: string; from: string; to: string } => !!m);
            this.ix.toast(`${t.name} balanced — ${opt.split(' — ')[0].toLowerCase()} (${moves.length} member${moves.length > 1 ? 's' : ''} moved).`);
            this.data.addHistory('balance', 'CM team balanced', `${t.name} · ${opt.split(' — ')[0]} · ${this.summarizeMoves(moves)}`);
          },
        });
      },
    });
  }

  readonly cmSortKey = signal<keyof CmManagerStat | ''>('');
  readonly cmSortDir = signal<SortDir>(1);
  readonly sortedCms = computed(() => compareRows(this.cmManagers(), this.cmSortKey(), this.cmSortDir()));
  sortCm(k: keyof CmManagerStat) { if (this.cmSortKey() === k) this.cmSortDir.set(this.cmSortDir() === 1 ? -1 : 1); else { this.cmSortKey.set(k); this.cmSortDir.set(1); } }
  caretCm(k: keyof CmManagerStat) { return caretFor(this.cmSortKey(), k, this.cmSortDir()); }

  exportCaseload() {
    this.exporter.open({ title: 'CM Caseload', name: 'cm-caseload_2026-07-17',
      columns: ['Care Manager', 'Discipline', 'Active', 'High Risk', 'High Acuity', 'High Cost', 'SLA At-Risk', 'Utilization %'],
      rows: this.cmManagers().map((c) => [c.name, c.discipline, c.active, c.highRisk, c.highAcuity, c.highCost, c.slaAtRisk, c.utilization]) });
  }
  exportQueue(q: CmQueueCard) {
    this.exporter.open({ title: q.name, name: `cm-queue-${slug(q.name)}_2026-07-17`,
      columns: ['Metric', 'Value'],
      rows: [['Unclaimed', q.count], ['0-24h %', q.buckets.fresh], ['24-48h %', q.buckets.day2], ['>48h %', q.buckets.over48], ['Breach %', q.buckets.breach]] });
  }
  exportWorkload() {
    this.exporter.open({ title: 'Workload per Care Manager', name: 'cm-workload_2026-07-17',
      columns: ['Care Manager', 'Discipline', 'Active', 'High Risk', 'High Acuity', 'High Cost', 'SLA At-Risk', 'Utilization %'],
      rows: this.sortedCms().map((c) => [c.name, c.discipline, c.active, c.highRisk, c.highAcuity, c.highCost, c.slaAtRisk, c.utilization]) });
  }

  private openCmCases(title: string, cases: CmCaseRec[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${cases.length} member(s)`,
      columns: CM_COLUMNS, rows: cases.map(cmToRow),
      exportName: `cm-${exportSlug}_2026-07-17`, memberColumn: 1,
    });
  }
  openCmActive(c: CmManagerStat) {
    const cases = this.cmData.cases().filter((x) => x.careManager === c.name);
    this.openCmCases(`${c.name} — Active Caseload`, cases, `${slug(c.name)}-active`, `${cases.length} active member(s) · ${c.utilization}% utilized`);
  }
  openCmFlag(c: CmManagerStat, flag: 'highRisk' | 'highAcuity' | 'highCost' | 'slaAtRisk') {
    const cases = this.cmData.cases().filter((x) => x.careManager === c.name && x.tags.includes(flag));
    this.openCmCases(`${c.name} — ${flag}`, cases, `${slug(c.name)}-${slug(flag)}`);
  }
  openQueueBand(queue: string, band: QueueBand) {
    const labels: Record<QueueBand, string> = { fresh: '0–24h in queue', day2: '24–48h in queue', over48: '>48h in queue', breach: 'Breach (past SLA)' };
    const cases = this.cmData.cases().filter((x) => x.queue === queue && queueBandOf(x) === band);
    this.openCmCases(`${queue} — ${labels[band]}`, cases, `${slug(queue)}-${slug(band)}`);
  }

  /** URL to the real per-person Roster page (what this care manager sees when they log in) —
   *  bound as a real <a [href] target="_blank"> rather than window.open() from a click handler,
   *  since script-triggered popups get silently blocked in some browsers/embedded previews even
   *  on a genuine click; a native anchor's target="_blank" is treated as normal link-following. */
  rosterHref(c: CmManagerStat): string {
    return `/roster/cm/${encodeURIComponent(c.name)}`;
  }

  openCm(c: CmManagerStat) {
    this.ix.openDrawer({
      title: c.name, subtitle: c.discipline,
      badge: { text: `${c.utilization}% utilized`, tone: c.utilization >= 90 ? 'red' : c.utilization < 80 ? 'green' : 'amber' },
      fields: [
        { label: 'Active Members', value: String(c.active) },
        { label: 'High Risk', value: String(c.highRisk), tone: c.highRisk >= 5 ? 'red' : undefined },
        { label: 'High Acuity', value: String(c.highAcuity) },
        { label: 'High Cost', value: String(c.highCost) },
        { label: 'SLA At-Risk', value: String(c.slaAtRisk), tone: c.slaAtRisk > 0 ? 'amber' : undefined },
        { label: 'Utilization', value: `${c.utilization}%`, tone: c.utilization >= 90 ? 'red' : c.utilization < 80 ? 'green' : 'amber' },
      ],
      note: c.utilization >= 90 ? 'At or above capacity — consider reassigning members.' : 'Operating within healthy capacity.',
      actions: [
        { label: 'View active caseload', tone: 'teal', run: () => { this.ix.closeDrawer(); this.openCmActive(c); } },
        { label: `Reassign a member from ${c.name.split(',')[0]}`, tone: 'teal', run: () => { this.ix.closeDrawer(); this.cmReassignOne(c); } },
      ],
    });
  }

  /** Bulk Reassign over the whole caseload — same shared Reassign panel UM uses, with CM's care
   *  managers as targets and CM's real work queues as the Queue-mode targets (via the generalized
   *  config). Cases with no active queue item show as "No Active Queue" in the panel's filter pills. */
  cmReassign() {
    const cases: ReassignCase[] = this.cmData.cases().map((c) => ({ authId: c.memberId, member: c.member, type: c.program, queue: c.queue ?? 'No Active Queue', priority: c.riskLevel, owner: c.careManager }));
    const nurses = this.cmManagers().map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }));
    const queueTargets = this.cmQueues().map((q) => ({ name: q.name, count: q.count }));
    this.rx.open({
      title: 'Reassign care management members', cases, nurses, queueTargets,
      apply: (ids, target, mode) => {
        ids.forEach((id) => mode === 'queue' ? this.cmData.reassignQueue(id, target) : this.cmData.reassignCase(id, target));
        this.ix.toast(`${ids.length} member(s) ${mode === 'queue' ? 'moved to ' + target : 'reassigned to ' + target}.`);
        this.data.addHistory('swap', mode === 'queue' ? 'CM members moved to queue' : 'CM members reassigned', `${ids.length} member(s) → ${target}`);
      },
    });
  }
  /** Row-level Reassign — scoped to one care manager's members, same panel/UX as the bulk version. */
  cmReassignOne(c: CmManagerStat) {
    const cases: ReassignCase[] = this.cmData.cases().filter((x) => x.careManager === c.name)
      .map((x) => ({ authId: x.memberId, member: x.member, type: x.program, queue: x.queue ?? 'No Active Queue', priority: x.riskLevel, owner: x.careManager }));
    const nurses = this.cmManagers().filter((m) => m.name !== c.name).map((m) => ({ name: m.name, utilization: m.utilization, active: m.active }));
    this.rx.open({
      title: `Reassign a member from ${c.name}`, cases, nurses,
      apply: (ids, target, mode) => {
        ids.forEach((id) => mode === 'queue' ? this.cmData.reassignQueue(id, target) : this.cmData.reassignCase(id, target));
        this.ix.toast(`${ids.length} member(s) reassigned to ${target}.`);
        this.data.addHistory('swap', 'CM member reassigned', `${ids.length} member(s) → ${target}`);
      },
    });
  }
  /** Same "choose how aggressively to rebalance" strategy flow as UM's Balance service — see
   *  CM_BALANCE_STRATEGIES above. */
  cmBalance() {
    this.ix.choose({
      title: 'Balance workload', body: 'Choose how aggressively to rebalance members from over-utilized care managers to those with capacity.',
      label: 'Balancing strategy', options: CM_BALANCE_STRATEGIES.map((s) => s.label), confirmLabel: 'Continue', tone: 'teal',
      onChoose: (opt) => {
        const strat = CM_BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        const plan = this.cmData.simulateBalance(strat.n);
        if (!plan.length) { this.ix.toast('Caseloads are already balanced.', 'info'); return; }
        this.ix.ask({
          title: `Balance ${plan.length} member${plan.length > 1 ? 's' : ''}`,
          body: 'Move members from over-utilized care managers to those with capacity:',
          breakdown: this.summarizeBalance(plan),
          confirmLabel: 'Balance', tone: 'teal',
          onConfirm: () => {
            const moves = plan.map(() => this.cmData.reassignBusiestCase()).filter((m): m is { member: string; from: string; to: string } => !!m);
            this.ix.toast(`Workload balanced — ${opt.split(' — ')[0].toLowerCase()} (${moves.length} member${moves.length > 1 ? 's' : ''} moved).`);
            this.data.addHistory('balance', 'CM caseload balanced', `${opt.split(' — ')[0]} · ${this.summarizeMoves(moves)}`);
          },
        });
      },
    });
  }
  /** "2 → James Wong, 1 → Angela Ruiz" style breakdown so the history entry proves exactly where cases landed, not just a total count. */
  private summarizeMoves(moves: { member: string; from: string; to: string }[]): string {
    if (!moves.length) return 'no moves (already balanced)';
    const byTarget = new Map<string, number>();
    moves.forEach((m) => byTarget.set(m.to, (byTarget.get(m.to) ?? 0) + 1));
    return [...byTarget.entries()].map(([to, n]) => `${n} → ${to}`).join(', ');
  }
  private summarizeBalance(plan: { from: string; to: string }[]): ConfirmBreakdownRow[] {
    const byTarget = new Map<string, number>();
    plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
    return [...byTarget.entries()].map(([target, count]) => ({ count, label: count === 1 ? 'member' : 'members', target }));
  }

  /** Going-on-PTO handoff — unlike Reassign/Balance this always empties the person out completely,
   *  to teammates on their own team only (never across teams), since that's the whole point of a
   *  coverage handoff. */
  openPto() {
    const teamOf = new Map(CARE_MANAGERS.map((cm) => [cm.name, cm.team]));
    const people = this.cmManagers().map((m) => ({ name: m.name, team: teamOf.get(m.name)!, active: m.active, utilization: m.utilization }));
    this.pto.open({
      title: 'Redistribute caseload for PTO', itemLabel: 'member', people,
      apply: (person, start, end, chosenTarget) => {
        const team = teamOf.get(person)!;
        const scope = new Set(CARE_MANAGERS.filter((cm) => cm.team === team && cm.name !== person).map((cm) => cm.name));
        const cases = this.cmData.cases().filter((c) => c.careManager === person);
        const byTarget = new Map<string, number>();
        cases.forEach((c) => {
          const target = chosenTarget ?? this.cmData.managerStats().filter((m) => scope.has(m.name)).reduce((a, b) => (b.utilization < a.utilization ? b : a)).name;
          this.cmData.reassignCase(c.memberId, target);
          byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
        });
        const breakdown = [...byTarget.entries()].map(([to, n]) => `${n} → ${to}`).join(', ');
        this.ix.toast(`${cases.length} member(s) redistributed from ${person} for PTO (${start} – ${end}).`);
        this.data.addHistory('calendar', 'PTO caseload redistributed', `${person} (${team}), ${start}–${end}: ${breakdown}`);
      },
    });
  }

  /** Same Assignment History drawer as UM's Workforce & Queue Management — reads the same shared
   *  session log, so a reassign/balance/PTO move made from either module shows up here with a real
   *  "N → target" detail, not just a count. */
  openAssignmentHistory() {
    const rows = this.data.assignmentHistory();
    this.ix.openDrawer({
      title: 'Assignment History',
      subtitle: `${rows.length} reassignment${rows.length === 1 ? '' : 's'}, balance, & PTO event${rows.length === 1 ? '' : 's'} this session`,
      table: rows.length ? { columns: ['Time', 'Action', 'Detail'], rows: rows.map((h) => [h.time, h.action, h.detail]) } : undefined,
      note: rows.length ? undefined : 'No members have been reassigned, balanced, or redistributed for PTO yet this session.',
    });
  }

  /** Bulk Escalate for case(0)'s toolbar — distinct from the per-member `escalate()` used in the Risk & Escalation tab. */
  cmEscalate() {
    const candidates = this.cmData.cases().filter((c) => c.riskLevel === 'Critical' || c.riskLevel === 'High').slice(0, 25).map((c) => ({
      authId: c.memberId, member: c.member, detail: `${c.dx} · ${c.program}`, riskLabel: `${c.riskScore} · ${c.riskLevel}`,
      risk: (c.riskLevel === 'Critical' ? 'red' : 'amber') as 'red' | 'amber' | 'green',
    }));
    this.esc.open({
      title: 'Escalate care management members', candidates, targets: ['Medical Director', 'Social Work Lead', 'Pharmacy (PharmD)', 'CM Supervisor'],
      apply: (ids, who) => { this.ix.toast(`${ids.length} member(s) escalated to ${who}.`, 'warn'); this.data.addHistory('arrowup', 'CM members escalated', `${ids.length} member(s) → ${who}`); },
    });
  }

  // ---- worklist search + sort + export ----
  readonly wlSearch = signal('');
  readonly wlSortKey = signal<keyof CmMemberRow | ''>('');
  readonly wlSortDir = signal<SortDir>(1);
  readonly visibleWorklist = computed(() => {
    const q = this.wlSearch().trim().toLowerCase();
    let rows = this.worklist.filter((m) => !q || m.name.toLowerCase().includes(q) || m.dx.toLowerCase().includes(q) || m.cm.toLowerCase().includes(q));
    return compareRows(rows, this.wlSortKey(), this.wlSortDir());
  });
  sortWl(k: keyof CmMemberRow) { if (this.wlSortKey() === k) this.wlSortDir.set(this.wlSortDir() === 1 ? -1 : 1); else { this.wlSortKey.set(k); this.wlSortDir.set(1); } }
  caretWl(k: keyof CmMemberRow) { return caretFor(this.wlSortKey(), k, this.wlSortDir()); }
  exportWorklist() {
    this.exporter.open({ title: 'High-Risk Members', name: 'cm-high-risk-members_2026-07-17',
      columns: ['Member', 'Primary Dx', 'Risk', 'Level', 'Acuity', 'Annual Cost', 'SLA', 'Care Manager'],
      rows: this.worklist.map((m) => [m.name, m.dx, m.risk, m.level, m.acuity, m.cost, m.sla, m.cm]) });
  }

  escalate(m: CmMemberRow) {
    this.ix.choose({ title: `Escalate ${m.name}`, body: `Escalate this ${m.level}-risk member for review.`, label: 'Escalate to', options: ['Medical Director', 'Social Work Lead', 'Pharmacy (PharmD)', 'CM Supervisor'], confirmLabel: 'Escalate', tone: 'amber',
      onChoose: (who) => { this.ix.toast(`${m.name} escalated to ${who}.`, 'warn'); this.data.addHistory('arrowup', 'CM member escalated', `${m.name} → ${who}`); } });
  }
  accept(r: Referral) {
    this.ix.choose({ title: `Accept referral ${r.authId}`, body: `Accept ${r.member} into care management and assign.`, label: 'Assign to', options: CARE_MANAGERS.map((c) => c.name), confirmLabel: 'Accept & assign', tone: 'teal',
      onChoose: (to) => { this.referrals.update((rows) => rows.map((x) => x.authId === r.authId ? { ...x, status: 'Assessment scheduled', assignedTo: to } : x)); this.ix.toast(`${r.member} accepted into CM — assigned to ${to}.`); this.data.addHistory('inbox', 'CM referral accepted', `${r.member} → ${to}`); } });
  }
  exportIntakeQueue() {
    this.exporter.open({ title: 'Referral Intake Queue', name: 'cm-referral-intake-queue_2026-07-17',
      columns: ['Auth', 'Member', 'Reason', 'Referred By', 'Intake SLA', 'Status'],
      rows: this.referrals().map((r) => [r.authId, r.member, r.reason, r.fromStage, r.sla, r.status]) });
  }
  exportSourcesMtd() {
    this.exporter.open({ title: 'Referral Sources (MTD)', name: 'cm-referral-sources-mtd_2026-07-17',
      columns: ['Source', 'Count'], rows: this.sources.map((s) => [s.label, s.value]) });
  }
  exportRecommendations() {
    this.exporter.open({ title: 'AI Recommendations', name: 'cm-ai-recommendations_2026-07-17',
      columns: ['Member', 'Recommendation'],
      rows: [
        ['Marcus Webb', 'Predicted 30-day readmission risk 84%. Recommend intensive outreach + nephrology coordination.'],
        ['Yolanda Reyes', 'Eligible for Maternal Care program based on risk factors. AI confidence 88%.'],
        ['Denise Holloway', 'Transportation barrier detected. Recommend community resource referral.'],
      ] });
  }
  exportRiskGauges() {
    this.exporter.open({ title: 'Predictive Risk Gauges', name: 'cm-predictive-risk-gauges_2026-07-17',
      columns: ['Gauge', 'Value %'], rows: [['Readmission Risk', 84], ['ER Utilization Risk', 31], ['Care Gap Risk', 19]] });
  }
  exportRisingMembers() {
    this.exporter.open({ title: 'Rising-Risk Members', name: 'cm-rising-risk-members_2026-07-17',
      columns: ['Member', 'Risk Score'], rows: this.worklist.slice(0, 4).map((m) => [m.name, m.risk]) });
  }
  toast(m: string) { this.ix.toast(m, 'info'); this.data.addHistory('sparkles', 'CM AI action', m); }
}
