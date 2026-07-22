import { Component, computed, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Ring } from '../shared/ring';
import { CASE_POOL, CaseRec } from '../data/case-pool';

const LOBS = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
function lobOf(id: string) { return LOBS[Number(id.slice(-2)) % LOBS.length]; }
function programOf(c: CaseRec) {
  if (c.serviceType === 'Inpatient') return 'Inpatient';
  if (c.serviceType === 'Behavioral') return 'Behavioral Health';
  const h = Number(c.authId.slice(-1)) % 3;
  return h === 0 ? 'Pharmacy' : h === 1 ? 'DME / Home Health' : 'Outpatient';
}
function tatStatus(c: CaseRec) {
  return c.tags.includes('onTrack') ? 'On Track' : c.tags.includes('atRisk') ? 'At Risk' : c.tags.includes('breached') ? 'Breached' : 'On Track';
}

@Component({
  selector: 'app-tat-tab',
  standalone: true,
  imports: [Ring],
  template: `
    <div class="tab-head">
      <h2>TAT &amp; SLA Compliance</h2>
      <span class="section-note">Strong compliance — your team is meeting targets</span>
    </div>

    <div class="panel panel-pad">
      <div class="tat-grid">
        <div class="left">
          <div class="donut">
            <z-ring [value]="data.tatCompliance" [size]="120" [thickness]="12" tone="teal"></z-ring>
            <div class="donut-lab">TAT Compliance</div>
          </div>
          <div class="rows">
            @for (b of data.tatBuckets; track b.label) {
              <div class="row" [attr.data-tone]="b.tone"><span><i></i>{{ b.label }}</span><b>{{ b.count }}</b></div>
            }
          </div>
        </div>
        <div class="stats">
          @for (s of data.tatStats; track s.label) {
            <div class="stat-box"><div class="val">{{ s.value }}</div><div class="lab">{{ s.label }}</div></div>
          }
        </div>
      </div>
    </div>

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
    .comp { white-space:nowrap; } .comp .rate-pill { margin-left:10px; }

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
    .mini-bar { display:inline-block; height:7px; border-radius:999px; background:var(--gray-200,#e5e7eb); width:100%; overflow:hidden; vertical-align:middle; }
    .mini-bar > span { display:block; height:100%; background:var(--gray-400,#9ca3af); border-radius:999px; }
    .mini-bar.teal > span { background:var(--green,#14b8a6); }
    .mini-bar.red > span { background:var(--red,#ef4444); }
  `],
})
export class TatTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);

  private decided = CASE_POOL.filter((c) => c.phase === 'decided');

  private breakdown(keyFn: (c: CaseRec) => string) {
    const map = new Map<string, CaseRec[]>();
    for (const c of this.decided) { if (!map.has(keyFn(c))) map.set(keyFn(c), []); map.get(keyFn(c))!.push(c); }
    return [...map.entries()].map(([name, cs]) => {
      const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
      const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
      const breached = cs.filter((c) => c.tags.includes('breached')).length;
      // compliance = on-track share (consistent with the headline donut)
      return { name, total: cs.length, onTrack, atRisk, breached, compliance: Math.round((onTrack / cs.length) * 100) };
    }).sort((a, b) => b.total - a.total);
  }
  readonly byLob = computed(() => this.breakdown((c) => lobOf(c.authId)));
  readonly byProgram = computed(() => this.breakdown((c) => programOf(c)));

  // ---- Regulatory TAT by urgency (mandated clock) ----
  // Compliance = on-track share within each urgency tier — consistent with the headline donut
  // and the LOB/Program tables, and it directly explains the Expedited/Standard tiles above.
  private urgencyGroup(name: string): CaseRec[] {
    const tag = name.startsWith('Expedited') ? 'expedited' : 'standard';
    return this.decided.filter((c) => c.tags.includes(tag));
  }
  readonly regTat = computed(() =>
    [
      { name: 'Expedited / Urgent', clock: '72 hours' },
      { name: 'Standard Pre-Service', clock: '14 calendar days' },
    ].map((g) => {
      const cs = this.urgencyGroup(g.name);
      const onTime = cs.filter((c) => c.tags.includes('onTrack')).length;
      const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
      const breached = cs.filter((c) => c.tags.includes('breached')).length;
      return { ...g, total: cs.length, onTime, atRisk, breached, compliance: Math.round((onTime / cs.length) * 100) };
    }),
  );

  // ---- Notification compliance (member & provider notice timeliness) ----
  private adverse = this.decided.filter((c) => c.tags.includes('appeal')); // adverse determinations need member notice
  private memberLate = this.adverse.filter((_, i) => i % 31 === 0);
  private providerLate = this.decided.filter((_, i) => i % 55 === 0);
  readonly notif = computed(() => {
    const memberTotal = this.adverse.length;
    const providerTotal = this.decided.length;
    const memberOnTime = memberTotal - this.memberLate.length;
    const providerOnTime = providerTotal - this.providerLate.length;
    return {
      memberTotal, providerTotal,
      memberPct: Math.round((memberOnTime / memberTotal) * 100),
      providerPct: Math.round((providerOnTime / providerTotal) * 100),
      avgDays: 0.7,
      late: this.memberLate.length + this.providerLate.length,
    };
  });

  drillNotice(kind: 'member' | 'provider' | 'late') {
    let cases: CaseRec[]; let title: string; let context: string;
    if (kind === 'member') { cases = this.adverse; title = 'Member Notices — Adverse Determinations'; context = `${cases.length} member notices required · ${this.memberLate.length} late`; }
    else if (kind === 'provider') { cases = this.decided; title = 'Provider Notices — All Determinations'; context = `${cases.length} provider notices · ${this.providerLate.length} late`; }
    else { cases = [...this.memberLate, ...this.providerLate]; title = 'Late Notices'; context = `${cases.length} notices sent past the regulatory timeframe`; }
    const lateSet = new Set([...this.memberLate, ...this.providerLate]);
    this.ix.openExplorer({
      title,
      context,
      columns: ['Auth ID', 'Member', 'Determination', 'Notice Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.decision, lateSet.has(c) ? 'Late' : 'On Time', `$${c.cost.toLocaleString()}`]),
      exportName: `notification-${kind}_2026-07-17`,
      memberColumn: 1,
    });
  }

  drillReg(name: string) {
    const cases = this.urgencyGroup(name);
    this.ix.openExplorer({
      title: `Regulatory TAT — ${name}`,
      context: `${cases.length} decisions in this urgency tier`,
      columns: ['Auth ID', 'Member', 'Procedure', 'TAT Status', 'TAT (days)', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, tatStatus(c), c.tatH, `$${c.cost.toLocaleString()}`]),
      exportName: `regulatory-tat-${name.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }

  drill(dim: 'lob' | 'program', value: string) {
    const keyFn = dim === 'lob' ? (c: CaseRec) => lobOf(c.authId) : (c: CaseRec) => programOf(c);
    const cases = this.decided.filter((c) => keyFn(c) === value);
    const label = dim === 'lob' ? 'Line of Business' : 'Program';
    this.ix.openExplorer({
      title: `TAT — ${value}`,
      context: `${cases.length} decisions · ${label} ${value}`,
      columns: ['Auth ID', 'Member', 'Procedure', label, 'TAT Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, value, tatStatus(c), `$${c.cost.toLocaleString()}`]),
      exportName: `tat-${dim}-${value.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }
}
