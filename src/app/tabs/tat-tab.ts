import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveConcurrentRows } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Ring } from '../shared/ring';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { LOBS, PROGRAMS, lobOf, programOf, authTypeOf, tatStatus, urgencyOf } from '../data/case-fields';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

type AuthTypeChoice = 'all' | 'IP' | 'OP' | 'RX';

@Component({
  selector: 'app-tat-tab',
  standalone: true,
  imports: [Ring],
  template: `
    <div class="tab-head">
      <h2>TAT Compliance</h2>
      <span class="section-note">Strong compliance — your team is meeting targets</span>
    </div>

    <!-- Filter bar (LOB is set from the top bar and applies here too) -->
    <div class="filter-bar">
      <div class="fseg">
        <span class="flab">Auth Type</span>
        @for (a of authTypes; track a.id) {
          <button [class.on]="authType() === a.id" (click)="authType.set(a.id)">{{ a.label }}</button>
        }
      </div>
      <label class="fsel">
        <span>Program</span>
        <select [value]="program()" (change)="program.set($any($event.target).value)">
          <option value="all">All Programs</option>
          @for (p of programs; track p) { <option [value]="p">{{ p }}</option> }
        </select>
      </label>
      @if (filterActive()) {
        <span class="fcount">{{ head().count }} decisions in view</span>
        <button class="fclear" (click)="clearFilters()">Clear filters</button>
      }
    </div>

    <div class="panel panel-pad">
      <div class="tat-grid">
        <div class="left">
          <div class="donut clk" (click)="drillAllDecided()">
            <z-ring [value]="head().compliance" [size]="120" [thickness]="12" tone="teal"></z-ring>
            <div class="donut-lab">TAT Compliance</div>
          </div>
          <div class="rows">
            @for (b of buckets(); track b.label) {
              <div class="row clk" [attr.data-tone]="b.tone" (click)="drillBucket(b.label)"><span><i></i>{{ b.label }}</span><b>{{ b.count }}</b></div>
            }
          </div>
        </div>
        <div class="stats">
          @for (s of stats(); track s.label) {
            <div class="stat-box clk" (click)="drillStat(s.label)"><div class="val">{{ s.value }}</div><div class="lab">{{ s.label }}</div></div>
          }
        </div>
      </div>
    </div>

    <!-- Concurrent review numbers (inpatient) -->
    @if (showConcurrent()) {
      <div class="panel panel-pad mt-6">
        <div class="pt-row">
          <h3 class="pt">Inpatient Concurrent Review</h3>
          <span class="pt-sub">Continued-stay reviews &amp; length-of-stay management</span>
        </div>
        <div class="conc-stats">
          <div class="stat-box clk" (click)="drillConcurrent()">
            <div class="val">{{ concurrent().active }}</div><div class="lab">Active Reviews</div>
          </div>
          <div class="stat-box clk" [class.warn]="concurrent().overstay > 0" (click)="drillOverstay()">
            <div class="val">{{ concurrent().overstay }}</div><div class="lab">Overstay Risk</div>
          </div>
          <div class="stat-box clk" (click)="drillAllConcurrent()">
            <div class="val">{{ concurrent().daysApproved }}<span class="of">/{{ concurrent().daysRequested }}</span></div>
            <div class="lab">Days Approved / Requested</div>
          </div>
          <div class="stat-box clk" (click)="drillAllConcurrent()">
            <div class="val">{{ concurrent().avgLos }}d<span class="of">/{{ concurrent().avgExp }}d</span></div>
            <div class="lab">Avg LOS / Expected</div>
          </div>
        </div>
      </div>
    }

    <div class="grid-2 mt-6">
      <div class="panel">
        <div class="panel-pad"><h3 class="pt">TAT Compliance by Line of Business</h3></div>
        <table class="z-table">
          <thead><tr><th>Line of Business</th><th>Volume</th><th>On Track</th><th>At Risk</th><th>Breached</th><th>Compliance</th></tr></thead>
          <tbody>
            @for (r of byLob(); track r.name) {
              <tr class="clk" (click)="drill('lob', r.name)">
                <td class="strong">{{ r.name }}</td>
                <td class="num">{{ r.total }}</td>
                <td class="num">{{ r.onTrack }}</td>
                <td class="num">{{ r.atRisk }}</td>
                <td class="num" [class.danger]="r.breached > 0">{{ r.breached }}</td>
                <td class="comp">
                  <span class="mini-bar" [class.teal]="r.compliance >= 90" [class.red]="r.compliance < 85"><span [style.width.%]="r.compliance"></span></span>
                  <span class="rate-pill" [class.good]="r.compliance >= 90" [class.mid]="r.compliance < 90">{{ r.compliance }}%</span>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty-row">No decisions match the current filters.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-pad"><h3 class="pt">TAT Compliance by Program</h3></div>
        <table class="z-table">
          <thead><tr><th>Program</th><th>Volume</th><th>On Track</th><th>At Risk</th><th>Breached</th><th>Compliance</th></tr></thead>
          <tbody>
            @for (r of byProgram(); track r.name) {
              <tr class="clk" (click)="drill('program', r.name)">
                <td class="strong">{{ r.name }}</td>
                <td class="num">{{ r.total }}</td>
                <td class="num">{{ r.onTrack }}</td>
                <td class="num">{{ r.atRisk }}</td>
                <td class="num" [class.danger]="r.breached > 0">{{ r.breached }}</td>
                <td class="comp">
                  <span class="mini-bar" [class.teal]="r.compliance >= 90" [class.red]="r.compliance < 85"><span [style.width.%]="r.compliance"></span></span>
                  <span class="rate-pill" [class.good]="r.compliance >= 90" [class.mid]="r.compliance < 90">{{ r.compliance }}%</span>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty-row">No decisions match the current filters.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid-2 mt-6">
      <!-- Notification Compliance -->
      <div class="panel panel-pad">
        <div class="pt-row">
          <h3 class="pt">Notification Compliance</h3>
          <span class="pt-sub">Member &amp; provider notice within regulatory timeframes</span>
        </div>
        <div class="notif-stats">
          <div class="stat-box clk" (click)="drillNotice('member')">
            <div class="val">{{ notif().memberPct }}%</div><div class="lab">Member Notice On-Time</div>
          </div>
          <div class="stat-box clk" (click)="drillNotice('provider')">
            <div class="val">{{ notif().providerPct }}%</div><div class="lab">Provider Notice On-Time</div>
          </div>
          <div class="stat-box">
            <div class="val">{{ notif().avgDays }}d</div><div class="lab">Avg Time to Notice</div>
          </div>
          <div class="stat-box clk" [class.warn]="notif().late > 0" (click)="drillNotice('late')">
            <div class="val">{{ notif().late }}</div><div class="lab">Late Notices</div>
          </div>
        </div>
        <div class="notif-bars">
          <div class="nb"><span class="nb-lab">Member ({{ notif().memberTotal }})</span>
            <span class="mini-bar" [class.teal]="notif().memberPct >= 95"><span [style.width.%]="notif().memberPct"></span></span>
          </div>
          <div class="nb"><span class="nb-lab">Provider ({{ notif().providerTotal }})</span>
            <span class="mini-bar" [class.teal]="notif().providerPct >= 95"><span [style.width.%]="notif().providerPct"></span></span>
          </div>
        </div>
      </div>

      <!-- Regulatory TAT by Urgency -->
      <div class="panel panel-pad">
        <div class="pt-row">
          <h3 class="pt">Regulatory TAT by Urgency</h3>
          <span class="pt-sub">Decisions rendered within the mandated clock</span>
        </div>
        <div class="urg-grid">
          @for (u of regTat(); track u.name) {
            <div class="urg-card clk" (click)="drillReg(u.name)">
              <div class="urg-top">
                <span class="urg-name">{{ u.name }}</span>
                <span class="clock-badge">{{ u.clock }}</span>
              </div>
              <div class="urg-pct" [class.mid]="u.compliance < 95" [class.bad]="u.compliance < 90">{{ u.compliance }}%</div>
              <span class="mini-bar" [class.teal]="u.compliance >= 95" [class.red]="u.compliance < 90"><span [style.width.%]="u.compliance"></span></span>
              <div class="urg-counts">
                <span>{{ u.onTime }} on-time</span>
                <span class="mid" [class.hide]="!u.atRisk">{{ u.atRisk }} at risk</span>
                <span class="bad" [class.hide]="!u.breached">{{ u.breached }} breached</span>
                <span class="urg-vol">{{ u.total }} total</span>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tat-grid { display:grid; grid-template-columns: 1.15fr 1fr; gap: 26px; align-items:center; }
    .left { display:flex; gap: 22px; align-items:center; }
    .donut { text-align:center; flex: 0 0 auto; }
    .donut-lab { font-size:12px; color: var(--gray-500); margin-top: 8px; font-weight:600; }
    .rows { flex:1; display:flex; flex-direction:column; gap:12px; }
    .row { display:flex; align-items:center; justify-content:space-between; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight:500; }
    .row i { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:8px; }
    .row span { display:flex; align-items:center; } .row b { font-weight:700; font-variant-numeric: tabular-nums; }
    .row[data-tone="green"] { background:#e7f8f0; color: var(--green-fg); } .row[data-tone="green"] i { background: var(--green); }
    .row[data-tone="amber"] { background:#fdf6e3; color: var(--amber-fg); } .row[data-tone="amber"] i { background: var(--amber); }
    .row[data-tone="red"] { background:#fdecec; color: var(--red-fg); } .row[data-tone="red"] i { background: var(--red); }
    .stats { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0; }
    .clk { cursor:pointer; }
    .row.clk:hover { filter:brightness(0.97); }
    .donut.clk:hover { opacity:0.85; }
    .comp { white-space:nowrap; } .comp .rate-pill { margin-left:10px; }
    .empty-row { text-align:center; color:var(--gray-500); padding:20px; font-size:13px; }

    /* filter bar */
    .filter-bar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
    .fseg { display:inline-flex; align-items:center; gap:0; border:1px solid var(--line,#e5e7eb); border-radius:8px; overflow:hidden; background:#fff; }
    .fseg .flab { font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; padding:0 12px; }
    .fseg button { border:0; background:transparent; padding:8px 14px; font-size:13px; font-weight:600; color:var(--gray-600); cursor:pointer; border-left:1px solid var(--line,#e5e7eb); }
    .fseg button.on { background:var(--green,#14b8a6); color:#fff; }
    .fsel { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .fsel select { font-size:13px; font-weight:500; color:var(--ink); text-transform:none; letter-spacing:0; padding:8px 10px; border:1px solid var(--line,#e5e7eb); border-radius:8px; background:#fff; cursor:pointer; }
    .fcount { font-size:12px; color:var(--gray-600); font-weight:600; }
    .fclear { border:0; background:transparent; color:var(--green-fg,#0f766e); font-size:12px; font-weight:600; cursor:pointer; text-decoration:underline; }

    /* concurrent review */
    .conc-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .conc-stats .val .of { font-size:15px; color:var(--gray-500); font-weight:600; }
    .conc-stats .stat-box.warn { background:#fdf6e3; }

    /* notification compliance + regulatory tat */
    .pt-row { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
    .pt-sub { font-size:12px; color:var(--gray-500); }
    .notif-stats { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .notif-stats .stat-box.warn { background:#fdf6e3; }
    .stat-box.clk:hover { box-shadow:0 0 0 2px var(--teal, #14b8a6) inset; }
    .notif-bars { margin-top:16px; display:flex; flex-direction:column; gap:12px; }
    .nb { display:flex; align-items:center; gap:12px; }
    .nb-lab { font-size:12px; color:var(--gray-600); width:110px; flex:0 0 auto; }
    .urg-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .urg-card { border:1px solid var(--line, #e5e7eb); border-radius:10px; padding:14px 16px; transition:box-shadow .12s; }
    .urg-card:hover { box-shadow:0 2px 10px rgba(0,0,0,.06); }
    .urg-top { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
    .urg-name { font-size:13px; font-weight:600; color:var(--ink); }
    .clock-badge { font-size:11px; font-weight:600; color:var(--gray-600); background:var(--gray-100,#f3f4f6); border-radius:999px; padding:3px 9px; white-space:nowrap; }
    .urg-pct { font-size:26px; font-weight:700; color:var(--green-fg,#0f766e); font-variant-numeric:tabular-nums; line-height:1.1; }
    .urg-pct.mid { color:var(--amber-fg,#b45309); } .urg-pct.bad { color:var(--red-fg,#b91c1c); }
    .urg-counts { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; font-size:11px; color:var(--gray-600); }
    .urg-counts .mid { color:var(--amber-fg,#b45309); } .urg-counts .bad { color:var(--red-fg,#b91c1c); }
    .urg-counts .urg-vol { margin-left:auto; font-weight:600; }
    .hide { display:none; }
    /* only the panel bars fill their container; table (.comp) bars keep the global fixed 110px so the % pill stays inside the cell */
    .notif-bars .mini-bar, .urg-card .mini-bar { width:100%; height:7px; }
  `],
})
export class TatTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);

  private decided = CASE_POOL.filter((c) => c.phase === 'decided');
  private pending = CASE_POOL.filter((c) => c.phase === 'pending');

  // ---- filter state ----
  private lobFilter = inject(LobFilter);
  readonly lobs = LOBS;
  readonly programs = PROGRAMS;
  readonly authTypes: { id: AuthTypeChoice; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'IP', label: 'IP' }, { id: 'OP', label: 'OP' }, { id: 'RX', label: 'RX' },
  ];
  readonly authType = signal<AuthTypeChoice>('all');
  readonly lob = this.lobFilter.value; // shared top-bar filter — same signal, so it stays in sync everywhere
  private lookback = inject(Lookback); // shared top-bar lookback — same treatment as LOB
  readonly program = signal<string>('all');
  readonly filterActive = computed(() => this.authType() !== 'all' || this.lob() !== 'all' || this.program() !== 'all' || this.lookback.period() !== '30d');
  /** Clears this tab's own filters; the LOB and Lookback filters are shell-level controls, reset them from the top bar. */
  clearFilters() { this.authType.set('all'); this.program.set('all'); }

  private passes(c: CaseRec, skip: { lob?: boolean; program?: boolean; auth?: boolean } = {}) {
    if (!skip.auth && this.authType() !== 'all' && authTypeOf(c) !== this.authType()) return false;
    if (!skip.lob && this.lob() !== 'all' && lobOf(c.authId) !== this.lob()) return false;
    if (!skip.program && this.program() !== 'all' && programOf(c) !== this.program()) return false;
    if (this.lookback.period() !== '30d' && !this.lookback.includes(c.submitted)) return false;
    return true;
  }
  readonly fDecided = computed(() => this.decided.filter((c) => this.passes(c)));

  // ---- headline compliance + buckets (react to filters; identical to statics when All) ----
  readonly head = computed(() => {
    const cs = this.fDecided();
    const total = cs.length || 1;
    const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
    const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
    const breached = cs.filter((c) => c.tags.includes('breached')).length;
    return { count: cs.length, onTrack, atRisk, breached, compliance: Math.round((onTrack / total) * 100) };
  });
  readonly buckets = computed(() => {
    const h = this.head();
    return [
      { label: 'On Track', count: h.onTrack, tone: 'green' },
      { label: 'At Risk', count: h.atRisk, tone: 'amber' },
      { label: 'Breached', count: h.breached, tone: 'red' },
    ];
  });
  readonly stats = computed(() => {
    const cs = this.fDecided();
    const expedited = cs.filter((c) => c.tags.includes('expedited')).length;
    const standard = cs.filter((c) => c.tags.includes('standard')).length;
    const paused = this.pending.filter((c) => this.passes(c) && c.tags.includes('paused')).length;
    // avg turnaround: keep the familiar headline for the unfiltered view; compute for slices
    const avg = this.filterActive() && cs.length
      ? (cs.reduce((s, c) => s + c.tatH, 0) / cs.length).toFixed(1) + 'd'
      : '1.8d';
    return [
      { value: String(expedited), label: 'Expedited' },
      { value: String(standard), label: 'Standard' },
      { value: String(paused), label: 'Paused' },
      { value: avg, label: 'Avg Turnaround' },
    ];
  });

  // ---- breakdowns (each ignores its own dimension so it never collapses to one row) ----
  private breakdownOver(cases: CaseRec[], keyFn: (c: CaseRec) => string) {
    const map = new Map<string, CaseRec[]>();
    for (const c of cases) { if (!map.has(keyFn(c))) map.set(keyFn(c), []); map.get(keyFn(c))!.push(c); }
    return [...map.entries()].map(([name, cs]) => {
      const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
      const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
      const breached = cs.filter((c) => c.tags.includes('breached')).length;
      return { name, total: cs.length, onTrack, atRisk, breached, compliance: Math.round((onTrack / cs.length) * 100) };
    }).sort((a, b) => b.total - a.total);
  }
  readonly byLob = computed(() => this.breakdownOver(this.decided.filter((c) => this.passes(c, { lob: true })), (c) => lobOf(c.authId)));
  readonly byProgram = computed(() => this.breakdownOver(this.decided.filter((c) => this.passes(c, { program: true })), (c) => programOf(c)));

  // ---- Regulatory TAT by urgency ----
  readonly regTat = computed(() => {
    const cs = this.fDecided();
    return [
      { name: 'Expedited / Urgent', clock: '72 hours', tag: 'expedited' },
      { name: 'Standard Pre-Service', clock: '14 calendar days', tag: 'standard' },
    ].map((g) => {
      const grp = cs.filter((c) => c.tags.includes(g.tag));
      const total = grp.length || 1;
      const onTime = grp.filter((c) => c.tags.includes('onTrack')).length;
      const atRisk = grp.filter((c) => c.tags.includes('atRisk')).length;
      const breached = grp.filter((c) => c.tags.includes('breached')).length;
      return { name: g.name, clock: g.clock, total: grp.length, onTime, atRisk, breached, compliance: Math.round((onTime / total) * 100) };
    });
  });

  // ---- Notification compliance ----
  readonly notif = computed(() => {
    const cs = this.fDecided();
    const adverse = cs.filter((c) => c.tags.includes('appeal')); // adverse determinations need member notice
    const memberLate = adverse.filter((_, i) => i % 31 === 0);
    const providerLate = cs.filter((_, i) => i % 55 === 0);
    const memberTotal = adverse.length;
    const providerTotal = cs.length;
    return {
      adverse, memberLate, providerLate, memberTotal, providerTotal,
      memberPct: memberTotal ? Math.round(((memberTotal - memberLate.length) / memberTotal) * 100) : 0,
      providerPct: providerTotal ? Math.round(((providerTotal - providerLate.length) / providerTotal) * 100) : 0,
      avgDays: 0.7,
      late: memberLate.length + providerLate.length,
    };
  });

  // ---- Inpatient concurrent review ----
  readonly showConcurrent = computed(() =>
    (this.authType() === 'all' || this.authType() === 'IP') && (this.program() === 'all' || this.program() === 'Inpatient'));
  private concurrentActive = computed(() =>
    this.pending.filter((c) => c.tags.includes('concurrent') && (this.lob() === 'all' || lobOf(c.authId) === this.lob())
      && (this.lookback.period() === '30d' || this.lookback.includes(c.submitted))));
  /** Same scope (LOB + Lookback) as concurrentActive — real rows derived from the case pool. */
  private liveConcurrent(): ReturnType<typeof liveConcurrentRows> {
    const lob = this.lob();
    const period = this.lookback.period();
    return liveConcurrentRows(lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays());
  }
  readonly concurrent = computed(() => {
    const rows = this.liveConcurrent();
    const n = rows.length || 1;
    return {
      active: this.concurrentActive().length,
      overstay: rows.filter((r) => r.overstayRisk !== 'green').length,
      daysApproved: rows.reduce((s, r) => s + r.daysApproved, 0),
      daysRequested: rows.reduce((s, r) => s + r.daysRequested, 0),
      avgLos: (rows.reduce((s, r) => s + parseInt(r.los), 0) / n).toFixed(1),
      avgExp: (rows.reduce((s, r) => s + parseInt(r.expectedLos), 0) / n).toFixed(1),
    };
  });

  // ---- drills ----

  /** The headline donut — every decision currently in view (respects Auth Type/Program/LOB filters). */
  drillAllDecided() {
    const cases = this.fDecided();
    this.ix.openExplorer({
      title: 'TAT Compliance — All Decisions in View',
      context: `${cases.length} decisions · ${this.head().compliance}% on track`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'TAT Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, urgencyOf(c), tatStatus(c), `$${c.cost.toLocaleString()}`]),
      exportName: 'tat-all-decided_2026-07-17',
      memberColumn: 1,
    });
  }

  /** On Track / At Risk / Breached bucket rows. */
  drillBucket(label: string) {
    const tag = label === 'On Track' ? 'onTrack' : label === 'At Risk' ? 'atRisk' : 'breached';
    const cases = this.fDecided().filter((c) => c.tags.includes(tag));
    this.ix.openExplorer({
      title: `TAT — ${label}`,
      context: `${cases.length} decisions · ${label}`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'TAT Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, urgencyOf(c), tatStatus(c), `$${c.cost.toLocaleString()}`]),
      exportName: `tat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }

  /** Expedited / Standard / Paused / Avg Turnaround stat tiles. */
  drillStat(label: string) {
    if (label === 'Paused') {
      const cases = this.pending.filter((c) => this.passes(c) && c.tags.includes('paused'));
      this.ix.openExplorer({
        title: 'Paused Authorizations',
        context: `${cases.length} authorization(s) with the clock stopped, pending RFI response`,
        columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'Status', 'Est. Cost'],
        rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, urgencyOf(c), c.status, `$${c.cost.toLocaleString()}`]),
        exportName: 'tat-paused_2026-07-17',
        memberColumn: 1,
      });
      return;
    }
    if (label === 'Avg Turnaround') {
      const cases = [...this.fDecided()].sort((a, b) => b.tatH - a.tatH);
      this.ix.openExplorer({
        title: 'Avg Turnaround — Completed Reviews',
        context: `${this.stats().find((s) => s.label === 'Avg Turnaround')?.value} average across ${cases.length} completed reviews (longest first)`,
        columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'TAT Status', 'TAT (days)', 'Est. Cost'],
        rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, urgencyOf(c), tatStatus(c), c.tatH, `$${c.cost.toLocaleString()}`]),
        exportName: 'tat-avg-turnaround_2026-07-17',
        memberColumn: 1,
      });
      return;
    }
    // Expedited / Standard
    const tag = label === 'Expedited' ? 'expedited' : 'standard';
    const cases = this.fDecided().filter((c) => c.tags.includes(tag));
    this.ix.openExplorer({
      title: `${label} Reviews`,
      context: `${cases.length} ${label.toLowerCase()} review(s) in view`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'TAT Status', 'TAT (days)', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, tatStatus(c), c.tatH, `$${c.cost.toLocaleString()}`]),
      exportName: `tat-${label.toLowerCase()}_2026-07-17`,
      memberColumn: 1,
    });
  }

  /** All 5 concurrent-review rows (not just overstay risk) — backs the Days/LOS aggregate tiles. */
  drillAllConcurrent() {
    const rows = this.liveConcurrent();
    this.ix.openExplorer({
      title: 'Concurrent Review — All Active Reviews',
      context: `${rows.length} inpatient continued-stay reviews`,
      columns: ['Member', 'Facility', 'LOS', 'Expected', 'Days Approved', 'Days Requested', 'Overstay Risk'],
      rows: rows.map((r) => [r.member, r.facility, r.los, r.expectedLos, r.daysApproved, r.daysRequested, r.overstayLabel]),
      exportName: 'concurrent-all_2026-07-17',
      memberColumn: 0,
    });
  }

  drill(dim: 'lob' | 'program', value: string) {
    const keyFn = dim === 'lob' ? (c: CaseRec) => lobOf(c.authId) : (c: CaseRec) => programOf(c);
    const cases = this.decided.filter((c) => this.passes(c, dim === 'lob' ? { lob: true } : { program: true }) && keyFn(c) === value);
    const label = dim === 'lob' ? 'Line of Business' : 'Program';
    this.ix.openExplorer({
      title: `TAT — ${value}`,
      context: `${cases.length} decisions · ${label} ${value}`,
      columns: ['Auth ID', 'Member', 'Procedure', label, 'Provider', 'Urgency', 'TAT Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, value, c.provider, urgencyOf(c), tatStatus(c), `$${c.cost.toLocaleString()}`]),
      exportName: `tat-${dim}-${value.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }

  drillReg(name: string) {
    const tag = name.startsWith('Expedited') ? 'expedited' : 'standard';
    const cases = this.fDecided().filter((c) => c.tags.includes(tag));
    this.ix.openExplorer({
      title: `Regulatory TAT — ${name}`,
      context: `${cases.length} decisions in this urgency tier`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'TAT Status', 'TAT (days)', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, c.provider, tatStatus(c), c.tatH, `$${c.cost.toLocaleString()}`]),
      exportName: `regulatory-tat-${name.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }

  drillNotice(kind: 'member' | 'provider' | 'late') {
    const n = this.notif();
    const lateSet = new Set([...n.memberLate, ...n.providerLate]);
    let cases: CaseRec[]; let title: string; let context: string;
    if (kind === 'member') { cases = n.adverse; title = 'Member Notices — Adverse Determinations'; context = `${cases.length} member notices required · ${n.memberLate.length} late`; }
    else if (kind === 'provider') { cases = this.fDecided(); title = 'Provider Notices — All Determinations'; context = `${cases.length} provider notices · ${n.providerLate.length} late`; }
    else { cases = [...n.memberLate, ...n.providerLate]; title = 'Late Notices'; context = `${cases.length} notices sent past the regulatory timeframe`; }
    this.ix.openExplorer({
      title, context,
      columns: ['Auth ID', 'Member', 'Determination', 'Provider', 'Urgency', 'Notice Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.decision, c.provider, urgencyOf(c), lateSet.has(c) ? 'Late' : 'On Time', `$${c.cost.toLocaleString()}`]),
      exportName: `notification-${kind}_2026-07-17`,
      memberColumn: 1,
    });
  }

  drillConcurrent() {
    const cases = this.concurrentActive();
    this.ix.openExplorer({
      title: 'Active Concurrent Reviews',
      context: `${cases.length} inpatient continued-stay reviews in progress`,
      columns: ['Auth ID', 'Member', 'Procedure', 'LOB', 'Provider', 'Urgency', 'Status'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, lobOf(c.authId), c.provider, urgencyOf(c), c.status]),
      exportName: `concurrent-active_2026-07-17`,
      memberColumn: 1,
    });
  }

  drillOverstay() {
    const rows = this.liveConcurrent().filter((r) => r.overstayRisk !== 'green');
    this.ix.openExplorer({
      title: 'Concurrent Review — Overstay Risk',
      context: `${rows.length} members exceeding expected length of stay`,
      columns: ['Member', 'Facility', 'LOS', 'Expected', 'Days Approved', 'Days Requested', 'Overstay Risk'],
      rows: rows.map((r) => [r.member, r.facility, r.los, r.expectedLos, r.daysApproved, r.daysRequested, r.overstayLabel]),
      exportName: `concurrent-overstay_2026-07-17`,
      memberColumn: 0,
    });
  }
}
