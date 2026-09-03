import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  AUDIT_EVENTS, AuditEvent, AuditCategory, AuditChannel, SYSTEM_USERS, SystemUser, AccessRole,
  PERMISSIONS, Permission, PERMISSION_MATRIX, SOD_RULES, COMPLIANCE_REGISTER, ComplianceRequirement, registerCounts,
  verifyChain, isOffHours, isExternalIp, eventDate,
} from '../data/audit-trail';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { Lookback } from '../shared/lookback';
import { LobFilter } from '../shared/lob-filter';
import { daysAgo } from '../data/case-fields';

interface TabDef { key: string; label: string; }
const TAB_DEFS: TabDef[] = [
  { key: 'trail', label: 'Audit Trail' },
  { key: 'activity', label: 'User Activity Monitoring' },
  { key: 'governance', label: 'Governance & Access Controls' },
  { key: 'compliance', label: 'Compliance Requirements & Gaps' },
];

const CATEGORIES: AuditCategory[] = ['Access', 'Clinical Decision', 'Case Management', 'Correspondence', 'Administrative', 'Configuration', 'Security', 'Data Export'];
const CHANNELS: AuditChannel[] = ['Web UI', 'API', 'Batch Interface', 'Fax / OCR Intake', 'System Rule'];

const EVENT_COLUMNS = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Category', 'Action', 'Entity Type', 'Entity ID', 'Field', 'Before', 'After', 'Channel', 'Source IP', 'Session', 'Correlation ID', 'Reason Code', 'PHI', 'Outcome', 'Record Hash'];
function eventRow(e: AuditEvent): (string | number)[] {
  return [e.eventId, e.timestamp.replace('T', ' '), e.actor, e.actorRole, e.category, e.action, e.entityType, e.entityId,
    e.field ?? '—', e.before ?? '—', e.after ?? '—', e.channel, e.sourceIp, e.sessionId, e.correlationId, e.reasonCode ?? '—',
    e.phi ? 'Yes' : 'No', e.outcome, e.recordHash];
}

interface UserActivity {
  user: SystemUser;
  events: number; sessions: number; phi: number; exports: number;
  offHours: number; failedLogins: number; deniedAccess: number; breakGlass: number; externalIp: number;
  lastActivity: string;
  flags: string[];
}
interface SodConflict { ruleId: string; rule: string; citation: string; subject: string; detail: string; eventIds: string[]; }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-audit-traceability',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  template: `
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
            <div class="tile-val">{{ scopedEvents().length | number }}</div><div class="tile-lab">Events in Window</div>
            <div class="tile-sub">{{ windowLabel() }}</div>
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
            <input class="search" type="text" placeholder="Search actor, action, entity, correlation ID…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
            <select [value]="cat()" (change)="cat.set($any($event.target).value)">
              <option value="all">All categories</option>
              @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            <select [value]="chan()" (change)="chan.set($any($event.target).value)">
              <option value="all">All channels</option>
              @for (c of channels; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            <label class="chk"><input type="checkbox" [checked]="phiOnly()" (change)="phiOnly.set($any($event.target).checked)" /> PHI only</label>
            <span class="count">{{ filteredEvents().length | number }} event(s)</span>
          </div>
          <table class="z-table">
            <thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Record</th><th>Change</th><th>Channel</th><th>Outcome</th></tr></thead>
            <tbody>
              @for (e of pagedEvents(); track e.eventId) {
                <tr class="clk" (click)="openEvent(e)">
                  <td class="mono">{{ e.timestamp.replace('T', ' ') }}@if (isOff(e.timestamp)) { <span class="chip amber">off-hours</span> }</td>
                  <td class="strong">{{ e.actor }}<div class="sub">{{ e.actorRole }}</div></td>
                  <td>{{ e.action }}<div class="sub">{{ e.category }}</div></td>
                  <td class="mono">{{ e.entityId }}<div class="sub">{{ e.entityType }}@if (e.phi) { · <span class="phi">PHI</span> }</div></td>
                  <td>@if (e.field) { <span class="sub">{{ e.field }}:</span> <span class="was">{{ e.before ?? '—' }}</span> → <b>{{ e.after }}</b> } @else { <span class="sub">—</span> }</td>
                  <td>{{ e.channel }}</td>
                  <td><span class="badge" [class.green]="e.outcome==='Success'" [class.red]="e.outcome==='Failed'" [class.amber]="e.outcome==='Denied'">{{ e.outcome }}</span></td>
                </tr>
              } @empty { <tr><td colspan="7" class="empty">No events match these filters.</td></tr> }
            </tbody>
          </table>
          @if (filteredEvents().length > pagedEvents().length) {
            <div class="foot-note panel-pad">Showing the {{ pagedEvents().length }} most recent of {{ filteredEvents().length | number }} —
              <a class="lnk" (click)="drillEvents('Filtered Audit Trail', filteredEvents(), 'filtered')">open the full set</a>.</div>
          }
        </div>
      }

      <!-- ======================= USER ACTIVITY MONITORING ======================= -->
      @case ('activity') {
        <div class="tab-head">
          <div><h2>User Activity Monitoring</h2>
            <span class="section-note">Per-account activity review — the evidence behind HIPAA §164.308(a)(1)(ii)(D). Signals are relative to the selected lookback window.</span></div>
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
          <div class="panel-pad tbl-head"><h3 class="pt">Activity by Account</h3>
            <span class="section-note sm">Click an account to open its own trail</span></div>
          <table class="z-table">
            <thead><tr><th>Account</th><th>Role</th><th class="num">Events</th><th class="num">PHI</th><th class="num">Off-Hours</th>
              <th class="num">Failed</th><th class="num">Denied</th><th class="num">BTG</th><th class="num">Exports</th><th>Last Activity</th><th>Signals</th></tr></thead>
            <tbody>
              @for (a of activity(); track a.user.userId) {
                <tr class="clk" (click)="drillUser(a)">
                  <td class="strong">{{ a.user.name }}<div class="sub mono">{{ a.user.userId }}</div></td>
                  <td>{{ a.user.role }}</td>
                  <td class="num">{{ a.events | number }}</td>
                  <td class="num">{{ a.phi | number }}</td>
                  <td class="num"><b [class.warn]="a.offHours > 0">{{ a.offHours }}</b></td>
                  <td class="num"><b [class.warn]="a.failedLogins > 0">{{ a.failedLogins }}</b></td>
                  <td class="num">{{ a.deniedAccess }}</td>
                  <td class="num"><b [class.hot]="a.breakGlass > 0">{{ a.breakGlass }}</b></td>
                  <td class="num">{{ a.exports }}</td>
                  <td class="mono">{{ a.lastActivity || '—' }}</td>
                  <td>@for (f of a.flags; track f) { <span class="chip amber">{{ f }}</span> } @if (!a.flags.length) { <span class="sub">—</span> }</td>
                </tr>
              }
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
            <div class="tile-sub">90-day cycle</div>
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
                  <td>@if (r.conflicts.length) { {{ r.conflicts[0].detail }}@if (r.conflicts.length > 1) { <span class="sub"> +{{ r.conflicts.length - 1 }} more</span> } } @else { <span class="sub">Control passing across {{ scopedEvents().length | number }} events in window</span> }</td>
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
          <div class="panel-pad tbl-head"><h3 class="pt">Account Inventory</h3></div>
          <table class="z-table">
            <thead><tr><th>Account</th><th>Role</th><th>Department</th><th>MFA</th><th>Last Entitlement Review</th><th>Last Sign-in</th><th>Status</th></tr></thead>
            <tbody>
              @for (u of accounts; track u.userId) {
                <tr class="clk" (click)="drillAccountTrail(u)">
                  <td class="strong">{{ u.name }}<div class="sub mono">{{ u.userId }}</div></td>
                  <td>{{ u.role }}</td><td class="sub">{{ u.department }}</td>
                  <td><span class="badge" [class.green]="u.mfaEnrolled" [class.red]="!u.mfaEnrolled">{{ u.mfaEnrolled ? 'Enrolled' : 'Password only' }}</span></td>
                  <td class="mono">{{ u.lastAccessReview }}@if (overdue(u)) { <span class="chip amber">{{ ageDays(u.lastAccessReview) }}d</span> }</td>
                  <td class="mono">{{ u.lastLogin }}</td>
                  <td><span class="badge green">{{ u.status }}</span></td>
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
    .filters .search { flex: 1 1 280px; min-width: 220px; }
    .filters select { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; background: #fff; }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--gray-500); }
    .count { margin-left: auto; font-size: 12px; color: var(--gray-500); font-variant-numeric: tabular-nums; }

    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    .sub { font-size: 11px; color: var(--gray-500); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .was { color: var(--gray-500); text-decoration: line-through; }
    .phi { color: var(--amber); font-weight: 700; }
    .warn { color: var(--amber); }
    .hot { color: var(--red, #c0392b); }
    .chip { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; background: var(--gray-100); color: var(--gray-500); }
    .chip.amber { background: #fdf3e3; color: #9a6400; }
    .clk { cursor: pointer; }
    .ctl { max-width: 380px; line-height: 1.45; }
    .next { margin-top: 4px; font-size: 11.5px; color: var(--teal-700); }
    .lnk { color: var(--teal-700); font-weight: 600; cursor: pointer; text-decoration: underline; }
    .foot-note { font-size: 11.5px; color: var(--gray-500); }
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
  private lookback = inject(Lookback);
  private lobFilter = inject(LobFilter);

  readonly tabs = TAB_DEFS;
  readonly sel = signal('trail');
  readonly categories = CATEGORIES;
  readonly channels = CHANNELS;
  readonly permissions = PERMISSIONS;
  readonly roles = Object.keys(PERMISSION_MATRIX) as AccessRole[];
  readonly accounts = SYSTEM_USERS;
  readonly register = COMPLIANCE_REGISTER;

  readonly q = signal('');
  readonly cat = signal<'all' | AuditCategory>('all');
  readonly chan = signal<'all' | AuditChannel>('all');
  readonly phiOnly = signal(false);

  /** '30d' is the unfiltered baseline (same convention the module Audit tabs use); narrower
   *  periods and QTD actually window the trail by event date. LOB narrows to events carrying that
   *  line of business — infrastructure events (sign-ins, config) have no LOB and stay visible,
   *  because hiding them would misrepresent the trail. */
  readonly windowLabel = computed(() => this.lookback.period() === '30d' ? 'all retained events' : `last ${this.lookback.windowDays() + 1} day(s)`);
  readonly scopedEvents = computed(() => {
    const period = this.lookback.period();
    const days = period === '30d' ? undefined : this.lookback.windowDays();
    const lob = this.lobFilter.value();
    return AUDIT_EVENTS.filter((e) => {
      if (days !== undefined) { const d = daysAgo(eventDate(e.timestamp)); if (d < 0 || d > days) return false; }
      if (lob !== 'all' && e.lob !== null && e.lob !== lob) return false;
      return true;
    });
  });

  readonly filteredEvents = computed(() => {
    const q = this.q().trim().toLowerCase();
    const cat = this.cat(); const chan = this.chan(); const phi = this.phiOnly();
    return this.scopedEvents().filter((e) =>
      (cat === 'all' || e.category === cat) &&
      (chan === 'all' || e.channel === chan) &&
      (!phi || e.phi) &&
      (!q || [e.eventId, e.actor, e.actorRole, e.action, e.entityId, e.entityType, e.correlationId, e.reasonCode ?? '', e.sourceIp, e.after ?? '']
        .some((v) => String(v).toLowerCase().includes(q))));
  });
  /** Newest first, capped — the full set goes to the Explorer rather than the page. */
  readonly pagedEvents = computed(() => [...this.filteredEvents()].reverse().slice(0, 120));

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

  readonly activity = computed((): UserActivity[] => {
    const evs = this.scopedEvents();
    return SYSTEM_USERS.map((user) => {
      const mine = evs.filter((e) => e.actorId === user.userId);
      const a: UserActivity = {
        user, events: mine.length,
        sessions: new Set(mine.map((e) => e.sessionId)).size,
        phi: mine.filter((e) => e.phi).length,
        exports: mine.filter((e) => e.category === 'Data Export').length,
        offHours: mine.filter((e) => isOffHours(e.timestamp)).length,
        failedLogins: mine.filter((e) => e.action === 'Failed sign-in attempt').length,
        deniedAccess: mine.filter((e) => e.outcome === 'Denied').length,
        breakGlass: mine.filter((e) => e.action.startsWith('Break-the-glass')).length,
        externalIp: mine.filter((e) => isExternalIp(e.sourceIp)).length,
        lastActivity: mine.length ? mine[mine.length - 1].timestamp.replace('T', ' ') : '',
        flags: [],
      };
      if (a.breakGlass > 0) a.flags.push('break-the-glass');
      if (a.externalIp > 0) a.flags.push('external IP');
      if (!user.mfaEnrolled) a.flags.push('no MFA');
      if (a.failedLogins >= 2) a.flags.push('repeated failed sign-ins');
      if (a.offHours > 0 && a.events > 0 && a.offHours / a.events > 0.15) a.flags.push('off-hours pattern');
      if (a.exports >= 8) a.flags.push('high export volume');
      return a;
    }).sort((x, y) => y.flags.length - x.flags.length || y.events - x.events);
  });

  // ---- Governance ----
  readonly roleCount = computed(() => new Set(SYSTEM_USERS.map((u) => u.role)).size);
  readonly noMfa = computed(() => SYSTEM_USERS.filter((u) => !u.mfaEnrolled));
  readonly mfaCoverage = computed(() => Math.round(((SYSTEM_USERS.length - this.noMfa().length) / SYSTEM_USERS.length) * 100));
  ageDays(iso: string) { return daysAgo(iso); }
  overdue(u: SystemUser) { return daysAgo(u.lastAccessReview) > 90; }
  readonly attestationOverdue = computed(() => SYSTEM_USERS.filter((u) => this.overdue(u)));

  matrix(role: AccessRole, p: string): string { return PERMISSION_MATRIX[role]?.[p as Permission] ?? '—'; }
  verdict(role: AccessRole, p: string): 'yes' | 'no' | 'limited' {
    const v = this.matrix(role, p);
    if (v.startsWith('No')) return 'no';
    return v.includes('—') || v.includes('only') ? 'limited' : 'yes';
  }

  /** Every SOD rule is evaluated against the live trail rather than asserted. */
  readonly sodResults = computed(() => {
    const evs = this.scopedEvents();
    return SOD_RULES.map((rule) => {
      const conflicts: SodConflict[] = [];
      if (rule.id === 'SOD-1') {
        // The appeal reviewer must differ from whoever recorded the original determination. Every
        // appeal event in the trail is checked against its case's determination actor.
        const determinationBy = new Map<string, string>();
        evs.filter((e) => e.action === 'Determination recorded').forEach((e) => determinationBy.set(e.entityId, e.actorId));
        evs.filter((e) => e.entityType === 'Appeal').forEach((e) => {
          if (determinationBy.get(e.entityId) === e.actorId) {
            conflicts.push({ ruleId: rule.id, rule: rule.name, citation: rule.citation, subject: e.actor, detail: `${e.actor} reviewed the appeal on ${e.entityId} after recording its original determination`, eventIds: [e.eventId] });
          }
        });
      }
      if (rule.id === 'SOD-2') {
        const approvals = new Set(evs.filter((e) => e.action === 'Configuration change approved').map((e) => e.correlationId));
        evs.filter((e) => e.action === 'Configuration change published').forEach((e) => {
          if (!approvals.has(e.correlationId)) {
            conflicts.push({ ruleId: rule.id, rule: rule.name, citation: rule.citation, subject: e.actor, detail: `${e.entityId} — "${e.field}" changed to "${e.after}" by ${e.actor} with no independent approval on ${e.correlationId}`, eventIds: [e.eventId] });
          }
        });
      }
      if (rule.id === 'SOD-3') {
        const clinical: AccessRole[] = ['Medical Director', 'Appeals Reviewer'];
        evs.filter((e) => e.action === 'Determination recorded' && e.after === 'Denied').forEach((e) => {
          if (!clinical.includes(e.actorRole)) {
            conflicts.push({ ruleId: rule.id, rule: rule.name, citation: rule.citation, subject: e.actor, detail: `${e.entityId} denied by ${e.actor} (${e.actorRole}) — medical-necessity denials require a qualified clinician`, eventIds: [e.eventId] });
          }
        });
      }
      if (rule.id === 'SOD-4') {
        const admins = new Set(SYSTEM_USERS.filter((u) => u.role === 'System Administrator').map((u) => u.userId));
        const offenders = new Map<string, AuditEvent>();
        evs.filter((e) => admins.has(e.actorId) && e.phi).forEach((e) => { if (!offenders.has(e.actorId)) offenders.set(e.actorId, e); });
        offenders.forEach((e) => conflicts.push({ ruleId: rule.id, rule: rule.name, citation: rule.citation, subject: e.actor, detail: `${e.actor} holds administrator rights and accessed PHI (${e.entityId})`, eventIds: [e.eventId] }));
      }
      return { rule, conflicts };
    });
  });
  readonly sodConflicts = computed(() => this.sodResults().flatMap((r) => r.conflicts));

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
      title, context: `${rows.length.toLocaleString()} audit event(s)`,
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
        label: 'Open full case trail', tone: 'teal',
        run: () => this.drillEvents(`Trail — ${e.entityId}`, AUDIT_EVENTS.filter((x) => x.correlationId === e.correlationId), slug(e.entityId)),
      }],
    });
  }
  drillUser(a: UserActivity) {
    this.drillEvents(`Activity — ${a.user.name}`, this.scopedEvents().filter((e) => e.actorId === a.user.userId), `user-${slug(a.user.userId)}`);
  }
  drillAccountTrail(u: SystemUser) {
    this.drillEvents(`Activity — ${u.name}`, this.scopedEvents().filter((e) => e.actorId === u.userId), `user-${slug(u.userId)}`);
  }
  drillAccounts(title: string, us: SystemUser[], slugName: string) {
    this.ix.openExplorer({
      title, context: `${us.length} account(s)`,
      columns: ['Account', 'User ID', 'Access Role', 'Department', 'MFA', 'Last Entitlement Review', 'Days Since Review', 'Last Sign-in', 'Status'],
      rows: us.map((u) => [u.name, u.userId, u.role, u.department, u.mfaEnrolled ? 'Enrolled' : 'Password only', u.lastAccessReview, daysAgo(u.lastAccessReview), u.lastLogin, u.status]),
      exportName: `audit-accounts-${slugName}_2026-07-17`,
    });
  }
  drillSod(r: { rule: { id: string; name: string }; conflicts: SodConflict[] }) {
    this.ix.openExplorer({
      title: `${r.rule.id} — ${r.rule.name}`, context: `${r.conflicts.length} conflict(s) detected in the current window`,
      columns: ['Rule', 'Subject', 'Detail', 'Citation', 'Event ID'],
      rows: r.conflicts.map((c) => [c.ruleId, c.subject, c.detail, c.citation, c.eventIds.join(', ')]),
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
      columns: EVENT_COLUMNS, rows: [...this.filteredEvents()].reverse().map(eventRow),
    });
  }
  exportActivity() {
    this.exporter.open({
      title: 'User Activity Monitoring', name: 'audit-user-activity_2026-07-17',
      columns: ['Account', 'User ID', 'Role', 'Events', 'Sessions', 'PHI Events', 'Off-Hours', 'Failed Sign-ins', 'Denied Access', 'Break-the-Glass', 'Exports', 'External IP', 'Last Activity', 'Signals'],
      rows: this.activity().map((a) => [a.user.name, a.user.userId, a.user.role, a.events, a.sessions, a.phi, a.offHours, a.failedLogins, a.deniedAccess, a.breakGlass, a.exports, a.externalIp, a.lastActivity || '—', a.flags.join('; ') || '—']),
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
