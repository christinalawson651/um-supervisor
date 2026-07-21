import { Component, computed, inject, signal } from '@angular/core';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Ring } from '../shared/ring';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { DashboardData } from '../data/dashboard-data';
import { REFERRALS, Referral } from '../data/referrals';

interface CaseManager { name: string; discipline: string; active: number; highRisk: number; highAcuity: number; highCost: number; slaAtRisk: number; utilization: number; }
interface CmMemberRow { name: string; risk: number; level: 'Low'|'Moderate'|'High'|'Critical'; acuity: 'Low'|'Medium'|'High'; cost: string; sla: string; slaTone: string; cm: string; dx: string; }

const TABS = ['Workforce & Caseload','Intake & Assessment SLA','Care Plan & Outcomes','Risk & Escalation','Program Management','Assessments & Documentation','Referrals & Sources','Financial / Cost','Audit & Compliance','AI / NextGen'];

@Component({
  selector: 'app-cm-dashboard',
  standalone: true,
  imports: [KpiStrip, Ring],
  template: `
    <app-kpi-strip [items]="kpis" (drill)="onKpi($event)" />

    <nav class="subtabs">
      @for (t of tabs; track t; let i = $index) {
        <button class="subtab" [class.active]="sel() === i" (click)="sel.set(i)">{{ t }}</button>
      }
    </nav>

    @switch (sel()) {
      <!-- 0: Workforce & Caseload -->
      @case (0) {
        <div class="tab-head"><h2>Caseload &amp; Workload Balancing</h2>
          <button class="btn primary" (click)="rebalance()">Balance caseloads</button></div>
        <div class="panel"><table class="z-table">
          <thead><tr><th>Care Manager</th><th>Active</th><th>High Risk</th><th>High Acuity</th><th>High Cost</th><th>SLA At-Risk</th><th>Utilization</th><th>Action</th></tr></thead>
          <tbody>@for (c of caseManagers(); track c.name) {
            <tr><td class="strong">{{ c.name }}<div class="sub">{{ c.discipline }}</div></td>
              <td class="num">{{ c.active }}</td>
              <td><b [class.hot]="c.highRisk>=5">{{ c.highRisk }}</b></td>
              <td><b [class.hot]="c.highAcuity>=4">{{ c.highAcuity }}</b></td>
              <td><b [class.hot]="c.highCost>=3">{{ c.highCost }}</b></td>
              <td><b [class.warn]="c.slaAtRisk>0">{{ c.slaAtRisk }}</b></td>
              <td><span class="mini-bar" [class.teal]="c.utilization<80" [class.red]="c.utilization>=90"><span [style.width.%]="c.utilization"></span></span>
                <span class="pct">{{ c.utilization }}%</span></td>
              <td><button class="btn outline sm" (click)="reassign(c)">Reassign</button></td></tr>
          }</tbody></table></div>
      }

      <!-- 1: Intake & Assessment SLA -->
      @case (1) {
        <div class="tab-head"><h2>Intake &amp; Assessment SLA</h2><span class="section-note">Time-to-outreach and assessment turnaround</span></div>
        <div class="panel panel-pad"><div class="sla-grid">
          <div class="donut"><z-ring [value]="96" [size]="120" [thickness]="12" tone="teal"></z-ring><div class="dlab">Intake SLA</div></div>
          <div class="rows">
            <div class="srow green"><span><i></i>On track</span><b>108</b></div>
            <div class="srow amber"><span><i></i>At risk</span><b>14</b></div>
            <div class="srow red"><span><i></i>Overdue</span><b>5</b></div>
          </div>
          <div class="stats">
            <div class="stat-box"><div class="val">1.4d</div><div class="lab">Avg Time to Outreach</div></div>
            <div class="stat-box"><div class="val">18</div><div class="lab">Assessments Due (7d)</div></div>
            <div class="stat-box"><div class="val">5</div><div class="lab">Assessments Overdue</div></div>
            <div class="stat-box"><div class="val">3.1d</div><div class="lab">Avg Assessment TAT</div></div>
          </div>
        </div></div>
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
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">High-Priority Member Worklist</h3></div>
          <table class="z-table"><thead><tr><th>Member</th><th>Primary Dx</th><th>Risk</th><th>Acuity</th><th>Annual Cost</th><th>SLA</th><th>Care Manager</th><th>Action</th></tr></thead>
          <tbody>@for (m of worklist; track m.name) {
            <tr class="clk" (click)="members.openByName(m.name)"><td><a class="ml">{{ m.name }}</a></td><td>{{ m.dx }}</td>
              <td><span class="score" [attr.data-l]="m.level">{{ m.risk }} · {{ m.level }}</span></td>
              <td><span class="ac" [attr.data-a]="m.acuity">{{ m.acuity }}</span></td>
              <td class="strong">{{ m.cost }}</td>
              <td><span class="badge" [class.red]="m.slaTone==='red'" [class.amber]="m.slaTone==='amber'" [class.green]="m.slaTone==='green'">{{ m.sla }}</span></td>
              <td>{{ m.cm }}</td>
              <td><button class="btn outline teal sm" (click)="escalate(m); $event.stopPropagation()">Escalate</button></td></tr>
          }</tbody></table></div>
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
        <div class="tab-head"><h2>Referrals &amp; Sources</h2><span class="section-note">Incoming referrals — including UM → CM</span></div>
        <div class="panel"><div class="panel-pad"><h3 class="pt">Referral Intake Queue</h3></div>
          <table class="z-table"><thead><tr><th>Source Auth</th><th>Member</th><th>Reason</th><th>Referred By</th><th>Intake SLA</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>@for (r of referrals(); track r.authId) {
            <tr><td class="strong">{{ r.authId }}</td><td><a class="ml" (click)="members.openByName(r.member)">{{ r.member }}</a></td><td>{{ r.reason }}</td><td>{{ r.fromStage }}</td>
              <td><span class="badge" [class.red]="r.slaTone==='red'" [class.amber]="r.slaTone==='amber'" [class.green]="r.slaTone==='green'">{{ r.sla }}</span></td>
              <td><span class="badge blue">{{ r.status }}</span></td>
              <td>@if (r.status === 'Pending intake') { <button class="btn outline teal sm" (click)="accept(r)">Accept &amp; assign</button> } @else { <span class="muted-label">—</span> }</td></tr>
          }</tbody></table></div>
        <div class="panel panel-pad mt-6"><h3 class="pt">Referral Sources (MTD)</h3>
          <div class="bars">@for (s of sources; track s.label) {
            <div class="bar-row"><span class="bl">{{ s.label }}</span><span class="bt"><span class="bf" [style.width.%]="s.pct" [style.background]="s.color"></span></span><span class="bv">{{ s.value }}</span></div>
          }</div></div>
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
          <div class="ai-head"><h2>AI / NextGen Intelligence</h2><span class="ai-pill">AI-Powered</span></div>
          <div class="recs">
            <div class="rec red"><div class="rt">Rising-Risk Alert — Marcus Webb</div><div class="rd">Predicted 30-day readmission risk 84%. Recommend intensive outreach + nephrology coordination.</div><button class="btn primary rbtn" (click)="toast('Outreach task created for Marcus Webb.')">Create outreach task</button></div>
            <div class="rec amber"><div class="rt">Program Match — Yolanda Reyes</div><div class="rd">Eligible for Maternal Care program based on risk factors. AI confidence 88%.</div><button class="btn primary rbtn" (click)="toast('Enrolled in Maternal Care program.')">Enroll in program</button></div>
            <div class="rec blue"><div class="rt">SDOH Gap — Denise Holloway</div><div class="rd">Transportation barrier detected. Recommend community resource referral.</div><button class="btn primary rbtn" (click)="toast('Community resource referral sent.')">Send referral</button></div>
          </div>
          <div class="ai-bottom">
            <div class="panel panel-pad"><h3 class="pt">Predictive Risk Gauges</h3>
              <div class="gauges">
                <div class="g"><z-ring [value]="84" [size]="90" [thickness]="9" tone="red" [fontSize]="18"></z-ring><div class="gl">Readmission Risk</div></div>
                <div class="g"><z-ring [value]="31" [size]="90" [thickness]="9" tone="amber" [fontSize]="18"></z-ring><div class="gl">ER Utilization Risk</div></div>
                <div class="g"><z-ring [value]="19" [size]="90" [thickness]="9" tone="amber" [fontSize]="18"></z-ring><div class="gl">Care Gap Risk</div></div>
              </div>
            </div>
            <div class="panel panel-pad"><h3 class="pt">Rising-Risk Members</h3>
              <div class="bars">@for (m of worklist.slice(0,4); track m.name) {
                <div class="bar-row"><span class="bl wide">{{ m.name }}</span><span class="bt"><span class="bf" [style.width.%]="m.risk*10" style="background:#ef4444"></span></span><span class="bv">{{ m.risk }}</span></div>
              }</div></div>
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
    .recs { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; }
    .rec.red{border-left-color:var(--red);} .rec.amber{border-left-color:var(--amber);} .rec.blue{border-left-color:var(--blue);}
    .rt { font-size:13.5px; font-weight:700; margin-bottom:6px; } .rd { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; } .rbtn { width:100%; justify-content:center; }
    .ai-bottom { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
    .gauges { display:flex; justify-content:space-around; padding:10px 0; } .g { text-align:center; } .gl { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }
  `],
})
export class CmDashboard {
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);
  readonly tabs = TABS;
  readonly sel = signal(0);

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

  readonly caseManagers = signal<CaseManager[]>([
    { name: 'Sara Nguyen, RN', discipline: 'Complex Care', active: 34, highRisk: 8, highAcuity: 6, highCost: 4, slaAtRisk: 2, utilization: 94 },
    { name: 'David Patel, MSW', discipline: 'Behavioral Health', active: 28, highRisk: 5, highAcuity: 3, highCost: 1, slaAtRisk: 1, utilization: 82 },
    { name: 'Maria Torres, RN', discipline: 'Transitional Care', active: 31, highRisk: 6, highAcuity: 4, highCost: 2, slaAtRisk: 1, utilization: 88 },
    { name: 'James Wong, PharmD', discipline: 'Medication Mgmt', active: 22, highRisk: 2, highAcuity: 1, highCost: 1, slaAtRisk: 0, utilization: 71 },
    { name: 'Angela Ruiz, RN', discipline: 'Complex Care', active: 26, highRisk: 4, highAcuity: 3, highCost: 2, slaAtRisk: 1, utilization: 79 },
  ]);
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

  private clampUtil(active: number, ref: CaseManager) { const perCase = ref.active > 0 ? ref.utilization / ref.active : 3; return Math.max(0, Math.min(100, Math.round(active * perCase))); }
  rebalance() {
    this.ix.ask({ title: 'Balance CM caseloads', body: 'Move members from over-utilized care managers to those with capacity?', confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => { this.caseManagers.update((list) => { const from = list.reduce((a, b) => b.utilization > a.utilization ? b : a); const to = list.reduce((a, b) => b.utilization < a.utilization ? b : a);
        return list.map((c) => c.name === from.name ? { ...c, active: c.active - 2, utilization: this.clampUtil(c.active - 2, c) } : c.name === to.name ? { ...c, active: c.active + 2, utilization: this.clampUtil(c.active + 2, c) } : c); });
        this.ix.toast('CM caseloads rebalanced.'); this.data.addHistory('balance', 'CM caseload balanced', 'Rebalanced across care managers'); } });
  }
  reassign(c: CaseManager) {
    const others = this.caseManagers().filter((x) => x.name !== c.name).map((x) => x.name);
    this.ix.choose({ title: `Reassign a member from ${c.name}`, body: `${c.name} is at ${c.utilization}% utilization.`, label: 'Reassign to', options: others, confirmLabel: 'Reassign', tone: 'teal',
      onChoose: (to) => { this.caseManagers.update((list) => list.map((x) => x.name === c.name ? { ...x, active: x.active - 1, utilization: this.clampUtil(x.active - 1, x) } : x.name === to ? { ...x, active: x.active + 1, utilization: this.clampUtil(x.active + 1, x) } : x));
        this.ix.toast(`Member reassigned to ${to}.`); this.data.addHistory('swap', 'CM member reassigned', `${c.name} → ${to}`); } });
  }
  escalate(m: CmMemberRow) {
    this.ix.choose({ title: `Escalate ${m.name}`, body: `Escalate this ${m.level}-risk member for review.`, label: 'Escalate to', options: ['Medical Director', 'Social Work Lead', 'Pharmacy (PharmD)', 'CM Supervisor'], confirmLabel: 'Escalate', tone: 'amber',
      onChoose: (who) => { this.ix.toast(`${m.name} escalated to ${who}.`, 'warn'); this.data.addHistory('arrowup', 'CM member escalated', `${m.name} → ${who}`); } });
  }
  accept(r: Referral) {
    this.ix.choose({ title: `Accept referral ${r.authId}`, body: `Accept ${r.member} into care management and assign.`, label: 'Assign to', options: this.caseManagers().map((c) => c.name), confirmLabel: 'Accept & assign', tone: 'teal',
      onChoose: (to) => { this.referrals.update((rows) => rows.map((x) => x.authId === r.authId ? { ...x, status: 'Assessment scheduled', assignedTo: to } : x)); this.ix.toast(`${r.member} accepted into CM — assigned to ${to}.`); this.data.addHistory('inbox', 'CM referral accepted', `${r.member} → ${to}`); } });
  }
  toast(m: string) { this.ix.toast(m, 'info'); this.data.addHistory('sparkles', 'CM AI action', m); }
}
