import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Ring } from '../shared/ring';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { DashboardData } from '../data/dashboard-data';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Exporter } from '../shared/exporter';
import { Lookback } from '../shared/lookback';

interface Appeal {
  appealId: string; auth: string; member: string; service: string;
  level: 'L1'|'L2'|'IRO'; status: string; statusTone: string;
  nba: string; nbaTone: string; tat: string; tatTone: string; assigned: string; aiConfidence: number; queue: string;
}
interface Reviewer { name: string; role: string; open: number; nearSla: number; overdue: number; overturnRate: number; utilization: number; }

const TABS = ['Workforce & Queue','TAT & Deadline Compliance','Determination Insights','Risk & Escalation','Level & Aging','Intake & Documentation','Provider Patterns','Overturn Cost Impact','Audit & Compliance','AI / NextGen'];

@Component({
  selector: 'app-appeals-dashboard',
  standalone: true,
  imports: [KpiStrip, Ring, FormsModule],
  template: `
    <app-kpi-strip [items]="displayKpis()" />

    <nav class="subtabs">
      @for (t of tabs; track t; let i = $index) {
        <button class="subtab" [class.active]="sel() === i" (click)="sel.set(i)">{{ t }}</button>
      }
    </nav>

    @switch (sel()) {
      <!-- 0: Workforce & Queue -->
      @case (0) {
        <div class="tab-head"><h2>Appeals Worklist</h2><span class="section-note">Prioritized by smart priority — deadline &amp; risk weighted</span></div>
        <div class="wl-tools">
          <div class="pills">
            @for (f of filters; track f.key) {
              <button class="pill" [class.active]="filter() === f.key" (click)="filter.set(f.key)"><span class="pdot" [attr.data-tone]="f.tone"></span>{{ f.label }}<span class="pcount">{{ countFor(f.key) }}</span></button>
            }
          </div>
          <div class="flex gap-8 center">
            <input class="search" type="text" placeholder="Search appeals…" [ngModel]="apSearch()" (ngModelChange)="apSearch.set($event)" />
            <button class="btn outline sm" (click)="exportAppeals()">Export</button>
          </div>
        </div>
        <div class="panel"><table class="z-table">
          <thead><tr><th>Next Action</th>
            <th class="srt" (click)="sortAp('member')">Member{{ caretAp('member') }}</th>
            <th>Appeal · Auth</th>
            <th class="srt" (click)="sortAp('level')">Level{{ caretAp('level') }}</th>
            <th>Status</th><th>TAT</th><th>Assigned To</th></tr></thead>
          <tbody>@for (a of worklistRows(); track a.appealId) {
            <tr class="clk" (click)="open(a)"><td><span class="nba" [attr.data-tone]="a.nbaTone">{{ a.nba }}</span></td>
              <td><a class="ml" (click)="members.openByName(a.member); $event.stopPropagation()">{{ a.member }}</a></td>
              <td><span class="strong">{{ a.appealId }}</span><br><span class="sub">{{ a.auth }} · {{ a.service }}</span></td>
              <td><span class="lv" [attr.data-l]="a.level">{{ a.level }}</span></td>
              <td><span class="st" [attr.data-tone]="a.statusTone">{{ a.status }}</span></td>
              <td><span class="tat" [attr.data-tone]="a.tatTone">{{ a.tat }}</span></td><td>{{ a.assigned }}</td></tr>
          } @empty { <tr><td colspan="7" class="empty">No appeals in this queue.</td></tr> }</tbody>
        </table></div>
        <div class="panel mt-6"><div class="panel-pad tbl-head"><h3 class="pt">Workload per Reviewer</h3>
          <button class="btn outline sm" (click)="exportReviewers()">Export</button></div>
          <table class="z-table"><thead><tr><th class="srt" (click)="sortRv('name')">Reviewer{{ caretRv('name') }}</th>
            <th class="srt" (click)="sortRv('open')">Open{{ caretRv('open') }}</th>
            <th class="srt" (click)="sortRv('nearSla')">Near SLA{{ caretRv('nearSla') }}</th>
            <th class="srt" (click)="sortRv('overdue')">Overdue{{ caretRv('overdue') }}</th>
            <th class="srt" (click)="sortRv('overturnRate')">Overturn Rate{{ caretRv('overturnRate') }}</th>
            <th class="srt" (click)="sortRv('utilization')">Utilization{{ caretRv('utilization') }}</th></tr></thead>
          <tbody>@for (r of sortedReviewers(); track r.name) {
            <tr><td class="strong">{{ r.name }}<div class="sub">{{ r.role }}</div></td><td class="num">{{ r.open }}</td>
              <td><b [class.warn]="r.nearSla>0">{{ r.nearSla }}</b></td><td><b [class.hot]="r.overdue>0">{{ r.overdue }}</b></td>
              <td class="num">{{ r.overturnRate }}%</td>
              <td><span class="mini-bar" [class.teal]="r.utilization<80" [class.red]="r.utilization>=90"><span [style.width.%]="r.utilization"></span></span><span class="pct">{{ r.utilization }}%</span></td></tr>
          }</tbody></table></div>
      }

      <!-- 1: TAT & Deadline Compliance -->
      @case (1) {
        <div class="tab-head"><h2>TAT &amp; Deadline Compliance</h2><span class="section-note">Regulatory deadline adherence</span></div>
        <div class="panel panel-pad"><div class="sla-grid">
          <div class="donut"><z-ring [value]="88" [size]="120" [thickness]="12" tone="teal"></z-ring><div class="dlab">On-Time Rate</div></div>
          <div class="rows">
            <div class="srow green"><span><i></i>On track</span><b>14</b></div>
            <div class="srow amber"><span><i></i>Near deadline (≤5d)</span><b>4</b></div>
            <div class="srow red"><span><i></i>Overdue</span><b>1</b></div>
          </div>
          <div class="stats">
            <div class="stat-box"><div class="val">9.2d</div><div class="lab">Avg Time Remaining</div></div>
            <div class="stat-box"><div class="val">30d</div><div class="lab">Standard TAT</div></div>
            <div class="stat-box"><div class="val">72h</div><div class="lab">Expedited TAT</div></div>
            <div class="stat-box"><div class="val">6.4d</div><div class="lab">Avg Decision Time</div></div>
          </div>
        </div></div>
      }

      <!-- 2: Determination Insights -->
      @case (2) {
        <div class="tab-head"><h2>Determination Insights</h2><span class="section-note">Outcome mix and overturn drivers</span></div>
        <div class="dstats">
          <div class="dstat teal"><div class="dv">61%</div><div class="dl">Overturned</div></div>
          <div class="dstat gray"><div class="dv">31%</div><div class="dl">Upheld</div></div>
          <div class="dstat amber"><div class="dv">8%</div><div class="dl">Partial</div></div>
          <div class="dstat blue"><div class="dv">15%</div><div class="dl">MD Reviewed</div></div>
          <div class="dstat purple"><div class="dv">9%</div><div class="dl">Peer-to-Peer</div></div>
          <div class="dstat teal"><div class="dv">6.4d</div><div class="dl">Avg TAT</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Overturn Drivers (why appeals succeed)</h3></div>
          <table class="z-table"><thead><tr><th>Denial Category</th><th>Appeals</th><th>Overturn Rate</th><th>Top Reason</th></tr></thead>
          <tbody>@for (d of drivers; track d.cat) {
            <tr><td class="strong">{{ d.cat }}</td><td class="num">{{ d.count }}</td>
              <td><span class="rate-pill" [class.good]="d.rate>=60" [class.mid]="d.rate<60">{{ d.rate }}%</span></td><td>{{ d.reason }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 3: Risk & Escalation -->
      @case (3) {
        <div class="tab-head"><h2>Risk &amp; Escalation</h2><span class="section-note note-warn">Appeals at deadline or escalation risk</span></div>
        <div class="rtiles">
          <div class="rtile red"><div class="rl">Overdue</div><div class="rv">1</div><div class="rf">immediate action</div></div>
          <div class="rtile amber"><div class="rl">Near Deadline (≤5d)</div><div class="rv">4</div><div class="rf">expedite review</div></div>
          <div class="rtile blue"><div class="rl">Pending MD / P2P</div><div class="rv">2</div><div class="rf">physician review</div></div>
          <div class="rtile amber"><div class="rl">Pending Information</div><div class="rv">1</div><div class="rf">RFI · clock paused</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad tbl-head"><h3 class="pt">Cases Requiring Attention</h3><span class="section-note">Sorted by deadline</span></div>
          <table class="z-table"><thead><tr><th>Appeal</th><th>Member</th><th>Level</th><th>Status</th><th>TAT</th><th>Action</th></tr></thead>
          <tbody>@for (a of riskCases(); track a.appealId) {
            <tr><td class="strong">{{ a.appealId }}</td><td><a class="ml" (click)="members.openByName(a.member)">{{ a.member }}</a></td>
              <td><span class="lv" [attr.data-l]="a.level">{{ a.level }}</span></td><td><span class="st" [attr.data-tone]="a.statusTone">{{ a.status }}</span></td>
              <td><span class="tat" [attr.data-tone]="a.tatTone">{{ a.tat }}</span></td>
              <td><button class="btn outline teal sm" (click)="open(a)">Review</button></td></tr>
          }</tbody></table></div>
      }

      <!-- 4: Level & Aging -->
      @case (4) {
        <div class="tab-head"><h2>Level &amp; Aging</h2><span class="section-note">Volume &amp; aging by appeal level</span></div>
        <div class="dstats">
          <div class="dstat blue"><div class="dv">11</div><div class="dl">Level 1 (Internal)</div></div>
          <div class="dstat purple"><div class="dv">5</div><div class="dl">Level 2</div></div>
          <div class="dstat gray"><div class="dv">2</div><div class="dl">External (IRO)</div></div>
        </div>
        <div class="panel panel-pad mt-6"><h3 class="pt">Aging by Bucket</h3>
          <div class="bars">@for (b of aging; track b.label) {
            <div class="bar-row"><span class="bl">{{ b.label }}</span><span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span><span class="bv">{{ b.value }}</span></div>
          }</div></div>
      }

      <!-- 5: Intake & Documentation -->
      @case (5) {
        <div class="tab-head"><h2>Intake &amp; Documentation</h2><span class="section-note">Appeal intake completeness</span></div>
        <div class="grid-3">
          <div class="panel panel-pad bar-block"><div class="bar-top">Complete Intake</div><div class="bar-val">83%</div><div class="pbar"><span style="width:83%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">AI Auto-Extracted</div><div class="bar-val">71%</div><div class="pbar"><span style="width:71%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">Needing RFI</div><div class="bar-val amber">17%</div><div class="pbar amber"><span style="width:17%"></span></div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Top Missing / Low-Confidence Fields</h3></div>
          <table class="z-table"><thead><tr><th>Field</th><th>Flagged</th><th>Avg AI Confidence</th></tr></thead>
          <tbody>@for (f of intakeFields; track f.field) {
            <tr><td class="strong">{{ f.field }}</td><td class="num">{{ f.count }}</td><td>{{ f.conf }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 6: Provider Patterns -->
      @case (6) {
        <div class="tab-head"><h2>Provider Appeal Patterns</h2><span class="section-note">Providers driving appeals &amp; overturns</span></div>
        <div class="panel"><table class="z-table">
          <thead><tr><th>Provider</th><th>Appeals</th><th>Overturn Rate</th><th>Top Service</th></tr></thead>
          <tbody>@for (p of providerPatterns; track p.provider) {
            <tr><td class="strong">{{ p.provider }}</td><td class="num">{{ p.count }}</td>
              <td><span class="rate-pill" [class.good]="p.rate<50" [class.mid]="p.rate>=50">{{ p.rate }}%</span></td><td>{{ p.service }}</td></tr>
          }</tbody></table></div>
      }

      <!-- 7: Overturn Cost Impact -->
      @case (7) {
        <div class="tab-head"><h2>Overturn Cost Impact</h2><span class="section-note">Financial impact of appeal determinations</span></div>
        <div class="grid-3">
          <div class="metric-tile"><div class="val">$0.2M</div><div class="lab">Cost Reinstated (overturns)</div></div>
          <div class="metric-tile"><div class="val">$0.9M</div><div class="lab">Denials Upheld (avoided)</div></div>
          <div class="metric-tile"><div class="val">$14k</div><div class="lab">Avg Overturn Value</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Highest-Value Determinations</h3></div>
          <table class="z-table"><thead><tr><th>Appeal</th><th>Member</th><th>Service</th><th>Value</th><th>Outcome</th></tr></thead>
          <tbody>@for (c of highValue; track c.appeal) {
            <tr><td class="strong">{{ c.appeal }}</td><td><a class="ml" (click)="members.openByName(c.member)">{{ c.member }}</a></td><td>{{ c.service }}</td>
              <td class="strong">{{ c.value }}</td><td><span class="badge" [class.teal]="c.outcome==='Overturned'" [class.gray]="c.outcome==='Upheld'">{{ c.outcome }}</span></td></tr>
          }</tbody></table></div>
      }

      <!-- 8: Audit & Compliance -->
      @case (8) {
        <div class="tab-head"><h2>Audit &amp; Compliance</h2><span class="section-note">Regulatory timeliness &amp; notices</span></div>
        <div class="grid-3">
          <div class="panel panel-pad"><div class="clab">Timely Determinations</div><div class="cval">96%</div><div class="pbar"><span style="width:96%"></span></div></div>
          <div class="panel panel-pad"><div class="clab">Member Notices Sent</div><div class="cval">99%</div><div class="pbar"><span style="width:99%"></span></div></div>
          <div class="panel panel-pad"><div class="clab">Rationale Documented</div><div class="cval">93%</div><div class="pbar"><span style="width:93%"></span></div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Audit Flags</h3></div>
          <table class="z-table"><thead><tr><th>ID</th><th>Type</th><th>Description</th><th>Date</th><th>Severity</th></tr></thead>
          <tbody>@for (f of apFlags; track f.id) {
            <tr><td class="strong">{{ f.id }}</td><td>{{ f.type }}</td><td>{{ f.desc }}</td><td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.sev==='High'" [class.amber]="f.sev==='Medium'" [class.green]="f.sev==='Low'">{{ f.sev }}</span></td></tr>
          }</tbody></table></div>
      }

      <!-- 9: AI / NextGen -->
      @case (9) {
        <div class="ai-shell">
          <div class="ai-head"><h2>AI / NextGen Intelligence</h2><span class="ai-pill">AI-Powered</span></div>
          <div class="recs">
            <div class="rec teal"><div class="rt">Likely Overturn — AP-2026-0112</div><div class="rd">4 of 5 clinical criteria now met with new evidence. AI confidence 94%.</div><button class="btn primary rbtn" (click)="toast('Determination drafted: Overturn — AP-2026-0112.')">Draft overturn</button></div>
            <div class="rec red"><div class="rt">Deadline Risk — AP-2025-0891</div><div class="rd">L1 appeal is overdue. Auto-prioritized to top of queue for immediate review.</div><button class="btn primary rbtn" (click)="toast('AP-2025-0891 escalated for immediate review.')">Escalate now</button></div>
            <div class="rec amber"><div class="rt">RFI Recommended — AP-2026-0088</div><div class="rd">Missing outpatient therapy records. Provider has 24h response history.</div><button class="btn primary rbtn" (click)="toast('RFI sent for AP-2026-0088.')">Send RFI</button></div>
          </div>
          <div class="ai-bottom">
            <div class="panel panel-pad"><h3 class="pt">Predictive Gauges</h3>
              <div class="gauges">
                <div class="g"><z-ring [value]="61" [size]="90" [thickness]="9" tone="teal" [fontSize]="18"></z-ring><div class="gl">Overturn Likelihood</div></div>
                <div class="g"><z-ring [value]="12" [size]="90" [thickness]="9" tone="red" [fontSize]="18"></z-ring><div class="gl">Deadline Breach Risk</div></div>
                <div class="g"><z-ring [value]="72" [size]="90" [thickness]="9" tone="teal" [fontSize]="18"></z-ring><div class="gl">AI Intake Confidence</div></div>
              </div>
            </div>
            <div class="panel panel-pad"><h3 class="pt">AI Confidence Distribution</h3>
              <div class="bars">
                <div class="bar-row"><span class="bl">High (>90%)</span><span class="bt"><span class="bf" style="width:64%;background:#0d9488"></span></span><span class="bv">64%</span></div>
                <div class="bar-row"><span class="bl">Medium (70-90%)</span><span class="bt"><span class="bf" style="width:27%;background:#f59e0b"></span></span><span class="bv">27%</span></div>
                <div class="bar-row"><span class="bl">Low (<70%)</span><span class="bt"><span class="bf" style="width:9%;background:#ef4444"></span></span><span class="bv">9%</span></div>
              </div></div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .sub { font-size:11px; color:var(--gray-500); font-weight:400; margin-top:2px; }
    b.hot { color:#c2410c; } b.warn { color:var(--amber-fg); }
    .pct { margin-left:10px; font-size:12.5px; font-weight:600; color:var(--ink-soft); }
    .clk { cursor:pointer; } .ml { color:#5B47E0; font-weight:600; cursor:pointer; } .ml:hover { text-decoration:underline; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 4px; }
    .note-warn { color:var(--amber-fg); } .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .flex { display:flex; } .gap-8 { gap:8px; } .center { align-items:center; }
    .srt { cursor:pointer; user-select:none; } .srt:hover { color:var(--ink-soft); }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:190px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .wl-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
    .wl-tools .pills { margin-bottom:0; }
    .pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .pill { display:flex; align-items:center; gap:7px; border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .pill.active { background:#5B47E0; border-color:#5B47E0; color:#fff; } .pill.active .pcount { background:rgba(255,255,255,.25); color:#fff; }
    .pdot { width:8px; height:8px; border-radius:999px; }
    .pdot[data-tone="purple"]{ background:#5B47E0; } .pdot[data-tone="blue"]{ background:#1A6BC4; } .pdot[data-tone="amber"]{ background:#C07A0A; } .pdot[data-tone="teal"]{ background:#1D9E75; } .pdot[data-tone="red"]{ background:#D94040; } .pdot[data-tone="gray"]{ background:#9CA3AF; }
    .pcount { background:var(--gray-100); color:var(--gray-500); font-size:10.5px; padding:0 6px; border-radius:999px; }
    .sub2 { font-size:11px; color:var(--gray-500); }
    .nba { font-size:11.5px; font-weight:600; padding:4px 10px; border-radius:6px; display:inline-block; }
    .nba[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .nba[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; } .nba[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .nba[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; } .nba[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; }
    .lv { font-size:11px; font-weight:700; padding:2px 9px; border-radius:6px; }
    .lv[data-l="L1"]{ background:#EAF2FC; color:#1A6BC4; } .lv[data-l="L2"]{ background:#EEEAFC; color:#5B47E0; } .lv[data-l="IRO"]{ background:#F3F4F6; color:#6B7280; }
    .st { font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:6px; }
    .st[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .st[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; } .st[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .st[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; } .st[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; } .st[data-tone="gray"]{ background:#F3F4F6; color:#6B7280; }
    .tat { font-weight:600; } .tat[data-tone="red"]{ color:#D94040; } .tat[data-tone="amber"]{ color:#C07A0A; } .tat[data-tone="teal"]{ color:#1D9E75; }
    .sub { } .empty { text-align:center; color:var(--gray-500); padding:24px; }

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
    .dstat.teal{border-top-color:var(--teal-600);} .dstat.amber{border-top-color:var(--amber);} .dstat.gray{border-top-color:var(--gray-400);} .dstat.blue{border-top-color:var(--blue);} .dstat.purple{border-top-color:var(--purple);}
    .dv { font-size:24px; font-weight:700; color:var(--ink); } .dl { font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:4px; }

    .rtiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .rtile { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px 18px; }
    .rtile.red{border-left-color:var(--red);} .rtile.amber{border-left-color:var(--amber);} .rtile.blue{border-left-color:var(--blue);}
    .rl { font-size:12px; color:var(--gray-500); font-weight:600; } .rv { font-size:26px; font-weight:700; color:var(--ink); margin:8px 0 4px; } .rf { font-size:11px; color:var(--gray-500); }

    .bars { display:flex; flex-direction:column; gap:14px; }
    .bar-row { display:grid; grid-template-columns:150px 1fr 60px; align-items:center; gap:12px; font-size:12.5px; }
    .bl { color:var(--ink-soft); font-weight:600; } .bt { height:10px; border-radius:999px; background:var(--gray-100); overflow:hidden; }
    .bf { display:block; height:100%; border-radius:999px; } .bv { text-align:right; font-weight:700; color:var(--ink); }
    .clab { font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom:8px; } .cval { font-size:26px; font-weight:700; color:var(--ink); margin-bottom:14px; }

    .ai-shell { border:1px solid var(--teal-600); border-radius:12px; padding:20px 22px; background:linear-gradient(180deg,#f7fdfc,#fff 40%); }
    .ai-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; } .ai-head h2 { margin:0; font-size:17px; }
    .ai-pill { background:var(--teal-700); color:#fff; font-size:11px; font-weight:700; padding:5px 12px; border-radius:999px; }
    .recs { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; }
    .rec.red{border-left-color:var(--red);} .rec.amber{border-left-color:var(--amber);} .rec.teal{border-left-color:var(--teal-600);}
    .rt { font-size:13.5px; font-weight:700; margin-bottom:6px; } .rd { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; } .rbtn { width:100%; justify-content:center; }
    .ai-bottom { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
    .gauges { display:flex; justify-content:space-around; padding:10px 0; } .g { text-align:center; } .gl { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }
  `],
})
export class AppealsDashboard {
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);
  private exporter = inject(Exporter);
  private lookback = inject(Lookback);
  readonly tabs = TABS;
  readonly sel = signal(0);

  private readonly PERIOD_VALUES: Record<string, string[]> = {
    today: ['3', '1', '1', '0', '0', '60%', '5.9d', '2'],
    '7d': ['6', '2', '1', '1', '1', '61%', '6.1d', '7'],
    qtd: ['22', '5', '4', '2', '2', '63%', '6.8d', '58'],
  };
  readonly displayKpis = computed(() => {
    const p = this.lookback.period();
    if (p === '30d' || !this.PERIOD_VALUES[p]) return this.kpis;
    return this.kpis.map((k, i) => ({ ...k, value: this.PERIOD_VALUES[p][i] }));
  });

  readonly kpis: KpiItem[] = [
    { icon: 'balance', value: '8',  label: 'Open Appeals',       tone: 'purple' },
    { icon: 'user',    value: '3',  label: 'Assigned for Review', tone: 'blue' },
    { icon: 'phone',   value: '2',  label: 'Pending MD / P2P',   tone: 'amber' },
    { icon: 'mail',    value: '1',  label: 'Pending Information', tone: 'teal' },
    { icon: 'xcircle', value: '1',  label: 'SLA Overdue',        tone: 'red' },
    { icon: 'check',   value: '61%', label: 'Overturn Rate',     tone: 'green' },
    { icon: 'clock',   value: '6.4d', label: 'Avg Decision Time', tone: 'teal' },
    { icon: 'folder',  value: '19', label: 'Closed (MTD)',       tone: 'green' },
  ];

  readonly filters = [
    { key: 'all', label: 'All Open', tone: 'purple' }, { key: 'assigned', label: 'Assigned', tone: 'purple' },
    { key: 'md', label: 'MD / P2P', tone: 'blue' }, { key: 'info', label: 'Pending Info', tone: 'amber' },
    { key: 'ready', label: 'Ready', tone: 'teal' }, { key: 'overdue', label: 'Overdue', tone: 'red' }, { key: 'closed', label: 'Closed', tone: 'gray' },
  ];
  readonly filter = signal('all');

  readonly appeals = signal<Appeal[]>([
    { appealId: 'AP-2025-0891', auth: 'BH656278', member: 'Sheryl Leonard', service: 'Medical necessity — BH IOP', level: 'L1', status: 'Overdue', statusTone: 'red', nba: 'Overdue — Review Now', nbaTone: 'red', tat: '352d overdue', tatTone: 'red', assigned: 'C. Lawson', aiConfidence: 71, queue: 'overdue' },
    { appealId: 'AP-2026-0112', auth: 'BH784201', member: 'Maria Benitez', service: 'Criteria not met — IP psych', level: 'L1', status: 'Assigned for Review', statusTone: 'purple', nba: 'Review Appeal Case', nbaTone: 'purple', tat: '11d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 94, queue: 'assigned' },
    { appealId: 'AP-2026-0088', auth: 'BH877493', member: 'Shannon Wright', service: 'Not medically necessary', level: 'L2', status: 'Pending MD Review', statusTone: 'blue', nba: 'Complete MD Review', nbaTone: 'blue', tat: '5d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 66, queue: 'md' },
    { appealId: 'AP-2026-0077', auth: 'BH300966', member: 'Marcus Webb', service: 'IOP criteria not met', level: 'L1', status: 'Pending Information', statusTone: 'amber', nba: 'Resume — Records Received?', nbaTone: 'amber', tat: '12d left', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 80, queue: 'info' },
    { appealId: 'AP-2026-0059', auth: 'RX408528', member: 'Vanessa Hernandez', service: 'Experimental — not covered', level: 'IRO', status: 'Ready for Determination', statusTone: 'teal', nba: 'Send Member & Provider Notice', nbaTone: 'teal', tat: '12d left', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 88, queue: 'ready' },
    { appealId: 'AP-2026-0031', auth: 'IP490812', member: 'James Okafor', service: 'IP LOS extension', level: 'L1', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 90, queue: 'closed' },
    { appealId: 'AP-2026-0028', auth: 'OP351953', member: 'Linda Park', service: 'OP procedure denial', level: 'L1', status: 'Closed — Upheld', statusTone: 'gray', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 55, queue: 'closed' },
    { appealId: 'AP-2026-0019', auth: 'RX921945', member: 'Carlos Reyes', service: 'Specialty Rx denial', level: 'L2', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 84, queue: 'closed' },
  ]);
  readonly visible = computed(() => { const f = this.filter(); const rows = this.appeals(); return f === 'all' ? rows.filter((a) => a.queue !== 'closed') : rows.filter((a) => a.queue === f); });
  countFor(key: string) { const rows = this.appeals(); return key === 'all' ? rows.filter((a) => a.queue !== 'closed').length : rows.filter((a) => a.queue === key).length; }
  readonly riskCases = computed(() => this.appeals().filter((a) => ['overdue', 'md', 'info'].includes(a.queue) || a.tatTone === 'amber'));

  // worklist search + sort + export
  readonly apSearch = signal('');
  readonly apSortKey = signal<keyof Appeal | ''>('');
  readonly apSortDir = signal<SortDir>(1);
  readonly worklistRows = computed(() => {
    const q = this.apSearch().trim().toLowerCase();
    const rows = this.visible().filter((a) => !q || a.member.toLowerCase().includes(q) || a.appealId.toLowerCase().includes(q) || a.auth.toLowerCase().includes(q) || a.service.toLowerCase().includes(q));
    return compareRows(rows, this.apSortKey(), this.apSortDir());
  });
  sortAp(k: keyof Appeal) { if (this.apSortKey() === k) this.apSortDir.set(this.apSortDir() === 1 ? -1 : 1); else { this.apSortKey.set(k); this.apSortDir.set(1); } }
  caretAp(k: keyof Appeal) { return caretFor(this.apSortKey(), k, this.apSortDir()); }
  exportAppeals() {
    this.exporter.open({ title: 'Appeals Worklist', name: 'appeals-worklist_2026-07-17',
      columns: ['Appeal', 'Auth', 'Member', 'Service', 'Level', 'Status', 'TAT', 'Assigned'],
      rows: this.visible().map((a) => [a.appealId, a.auth, a.member, a.service, a.level, a.status, a.tat, a.assigned]) });
  }

  // reviewers sort + export
  readonly rvSortKey = signal<keyof Reviewer | ''>('');
  readonly rvSortDir = signal<SortDir>(1);
  readonly sortedReviewers = computed(() => compareRows(this.reviewers, this.rvSortKey(), this.rvSortDir()));
  sortRv(k: keyof Reviewer) { if (this.rvSortKey() === k) this.rvSortDir.set(this.rvSortDir() === 1 ? -1 : 1); else { this.rvSortKey.set(k); this.rvSortDir.set(1); } }
  caretRv(k: keyof Reviewer) { return caretFor(this.rvSortKey(), k, this.rvSortDir()); }
  exportReviewers() {
    this.exporter.open({ title: 'Reviewer Workload', name: 'appeals-reviewers_2026-07-17',
      columns: ['Reviewer', 'Role', 'Open', 'Near SLA', 'Overdue', 'Overturn Rate %', 'Utilization %'],
      rows: this.reviewers.map((r) => [r.name, r.role, r.open, r.nearSla, r.overdue, r.overturnRate, r.utilization]) });
  }

  readonly reviewers: Reviewer[] = [
    { name: 'C. Lawson', role: 'Appeals RN', open: 5, nearSla: 2, overdue: 1, overturnRate: 63, utilization: 91 },
    { name: 'T. Rivera', role: 'Appeals RN', open: 3, nearSla: 1, overdue: 0, overturnRate: 58, utilization: 74 },
    { name: 'Dr. M. Webb', role: 'Medical Director', open: 2, nearSla: 1, overdue: 0, overturnRate: 55, utilization: 68 },
  ];
  readonly drivers = [
    { cat: 'Behavioral Health', count: 7, rate: 71, reason: 'New clinical evidence' },
    { cat: 'Inpatient LOS', count: 5, rate: 60, reason: 'Documentation submitted late' },
    { cat: 'Specialty Rx', count: 4, rate: 50, reason: 'Step-therapy exception' },
    { cat: 'Out-of-Network', count: 3, rate: 33, reason: 'Network adequacy' },
  ];
  readonly aging = [
    { label: '0–7 days', value: 6, pct: 100, color: '#10b981' },
    { label: '8–14 days', value: 5, pct: 83, color: '#f59e0b' },
    { label: '15–30 days', value: 4, pct: 67, color: '#f97316' },
    { label: '> 30 days', value: 3, pct: 50, color: '#ef4444' },
  ];
  readonly intakeFields = [
    { field: 'Provider NPI', count: 4, conf: '78%' },
    { field: 'Urgency', count: 3, conf: '81%' },
    { field: 'Denial Reason', count: 2, conf: '84%' },
  ];
  readonly providerPatterns = [
    { provider: 'City Behavioral Health', count: 6, rate: 71, service: 'BH IOP' },
    { provider: 'Memorial Orthopedic Group', count: 4, rate: 55, service: 'Spinal fusion' },
    { provider: 'Coastal Neurology', count: 3, rate: 48, service: 'Imaging' },
  ];
  readonly highValue = [
    { appeal: 'AP-2026-0031', member: 'James Okafor', service: 'IP LOS extension', value: '$48k', outcome: 'Overturned' },
    { appeal: 'AP-2026-0019', member: 'Carlos Reyes', service: 'Specialty Rx', value: '$31k', outcome: 'Overturned' },
    { appeal: 'AP-2026-0028', member: 'Linda Park', service: 'OP procedure', value: '$22k', outcome: 'Upheld' },
  ];
  readonly apFlags = [
    { id: 'AG-201', type: 'Timeliness', desc: 'Determination approaching regulatory deadline — AP-2025-0891', date: '2026-07-17', sev: 'High' },
    { id: 'AG-202', type: 'Notice', desc: 'Member notice pending send — AP-2026-0059', date: '2026-07-16', sev: 'Medium' },
    { id: 'AG-203', type: 'Rationale', desc: 'Determination rationale incomplete — AP-2026-0028', date: '2026-07-14', sev: 'Low' },
  ];

  open(a: Appeal) {
    const rec = a.aiConfidence >= 85 ? 'Overturn' : a.aiConfidence >= 60 ? 'Partial' : 'Uphold';
    this.ix.openDrawer({
      title: `${a.appealId} · ${a.member}`, subtitle: `${a.service} · Auth ${a.auth}`,
      badge: { text: a.level === 'IRO' ? 'External (IRO)' : `Level ${a.level.replace('L', '')}`, tone: a.level === 'L1' ? 'blue' : 'teal' },
      formula: `AI Confidence ${a.aiConfidence}% — Likely ${rec}`,
      fields: [ { label: 'Status', value: a.status }, { label: 'TAT', value: a.tat, tone: a.tatTone === 'red' ? 'red' : a.tatTone === 'amber' ? 'amber' : 'green' }, { label: 'Assigned To', value: a.assigned }, { label: 'Next Action', value: a.nba } ],
      note: `AI reviewed the denial rationale against clinical criteria and recommends "${rec}".`,
      actions: a.queue === 'closed' ? [] : [
        { label: 'Overturn — Approve appeal', tone: 'teal', run: () => this.decide(a, 'Overturned') },
        { label: 'Partial — Partially overturn', tone: 'amber', run: () => this.decide(a, 'Partially Overturned') },
        { label: 'Uphold — Deny appeal', tone: 'red', run: () => this.decide(a, 'Upheld') },
      ],
    });
  }
  private decide(a: Appeal, outcome: string) {
    const tone = outcome === 'Upheld' ? 'gray' : 'teal';
    this.appeals.update((rows) => rows.map((x) => x.appealId === a.appealId ? { ...x, status: `Closed — ${outcome}`, statusTone: tone, queue: 'closed', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal' } : x));
    this.ix.toast(`${a.appealId} determination recorded: ${outcome}.`, 'info');
    this.data.addHistory('balance', 'Appeal determination', `${a.appealId} (${a.member}) — ${outcome}`);
  }
  toast(m: string) { this.ix.toast(m, 'info'); this.data.addHistory('sparkles', 'Appeals AI action', m); }
}
