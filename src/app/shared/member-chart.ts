import { Component, computed, inject } from '@angular/core';
import { Interaction } from './interaction';
import { MemberChart as MC } from './members';
import { Icon } from './icon';

@Component({
  selector: 'app-member-chart',
  standalone: true,
  imports: [Icon],
  template: `
    @if (member(); as m) {
      <div class="scrim" (click)="ix.closeMemberChart()">
        <div class="chart" (click)="$event.stopPropagation()">
          <!-- context bar -->
          <div class="ctx">
            <button class="back" (click)="ix.closeMemberChart()">← Back to dashboard</button>
            <span class="crumb">{{ m.name }} · {{ m.memberId }}</span>
            <span class="umbadge">UM REVIEW</span>
            <button class="x" (click)="ix.closeMemberChart()">×</button>
          </div>

          <div class="body">
            <!-- member header -->
            <div class="mhead">
              <div class="avatar">{{ initials(m.name) }}</div>
              <div class="mid">
                <div class="mname">{{ m.name }} <span class="chk">✓</span></div>
                <div class="demo">DOB {{ m.dob }} · {{ m.age }}y · {{ m.gender }} · {{ m.memberId }}</div>
                <div class="tags">
                  <span class="tag cases">{{ m.openCases }} Open Cases</span>
                  <span class="tag" [attr.data-a]="m.acuity">Acuity: {{ m.acuity }}</span>
                  <span class="tag pcm">PCM: {{ m.pcm }}</span>
                  <span class="tag pcp">PCP: {{ m.pcp }}</span>
                  <span class="tag plan">{{ m.lob }}</span>
                </div>
              </div>
              <div class="riskbox">
                <div class="rlab">RISK SCORE</div>
                <div class="rbar"><span [style.width.%]="m.riskScore * 10"></span></div>
                <div class="rval">{{ m.riskScore }} / 10 · {{ m.riskLevel }}</div>
                <div class="cp" [attr.data-s]="m.carePlanStatus">Care Plan: {{ m.carePlanStatus }}</div>
              </div>
            </div>

            <!-- alerts -->
            @if (m.alerts.length) {
              <div class="alerts">
                @for (a of m.alerts; track a) { <span class="alert"><z-icon name="alert" [size]="12"></z-icon> {{ a }}</span> }
              </div>
            }

            <!-- cards grid -->
            <div class="grid">
              <div class="mcard">
                <h4>Demographics &amp; Coverage</h4>
                <dl>
                  <div><dt>Address</dt><dd>{{ m.address }}</dd></div>
                  <div><dt>Phone</dt><dd>{{ m.phone }}</dd></div>
                  <div><dt>Line of Business</dt><dd>{{ m.lob }}</dd></div>
                  <div><dt>Plan</dt><dd>{{ m.planName }}</dd></div>
                  <div><dt>PCP</dt><dd>{{ m.pcp }}</dd></div>
                  <div><dt>Care Manager</dt><dd>{{ m.pcm }}</dd></div>
                </dl>
              </div>

              <div class="mcard">
                <h4>Utilization (12 mo)</h4>
                <div class="ustats">
                  <div class="u"><b [class.warn]="m.utilization.er12>=3">{{ m.utilization.er12 }}</b><span>ER Visits</span></div>
                  <div class="u"><b [class.warn]="m.utilization.adm12>=2">{{ m.utilization.adm12 }}</b><span>Admissions</span></div>
                  <div class="u"><b>{{ m.utilization.avgLos }}</b><span>Avg LOS</span></div>
                  <div class="u"><b>{{ m.utilization.lastAdmit }}</b><span>Last Admit</span></div>
                </div>
                <div class="cmline"><span class="cmstatus" [attr.data-on]="m.programs.length>0">{{ m.cmStatus }}</span>
                  @for (p of m.programs; track p) { <span class="prog">{{ p }}</span> }
                </div>
              </div>

              <div class="mcard span2">
                <h4>Active Diagnoses</h4>
                <table class="mt">
                  <thead><tr><th>ICD-10</th><th>Description</th><th>Type</th></tr></thead>
                  <tbody>
                    @for (d of m.diagnoses; track d.code) {
                      <tr><td class="code">{{ d.code }}</td><td>{{ d.desc }}</td>
                        <td>@if (d.primary) { <span class="pill primary">Primary</span> } @else { <span class="pill">Secondary</span> }</td></tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="mcard span2">
                <h4>Medications</h4>
                <table class="mt">
                  <thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th></tr></thead>
                  <tbody>
                    @for (med of m.medications; track med.name) {
                      <tr><td class="strong">{{ med.name }}</td><td>{{ med.dose }}</td><td>{{ med.freq }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="mcard span2">
                <h4>Care Plan &amp; Goals</h4>
                @if (m.goals.length) {
                  <table class="mt">
                    <thead><tr><th>Goal</th><th>Status</th><th>Target</th></tr></thead>
                    <tbody>
                      @for (g of m.goals; track g.desc) {
                        <tr><td>{{ g.desc }}</td><td><span class="pill">{{ g.status }}</span></td><td>{{ g.target }}</td></tr>
                      }
                    </tbody>
                  </table>
                } @else {
                  <p class="empty">No active care plan. @if (m.riskScore >= 6) { <b>Eligible for CM referral.</b> }</p>
                }
              </div>
            </div>

            <div class="mactions">
              <button class="btn primary" (click)="toast('Call placed to ' + m.name)"><z-icon name="phone" [size]="14"></z-icon> Call</button>
              <button class="btn outline" (click)="toast('Message sent to ' + m.name)"><z-icon name="mail" [size]="14"></z-icon> Message</button>
              <button class="btn outline" (click)="toast('Timeline view is not part of this demo build.')"><z-icon name="clock" [size]="14"></z-icon> Timeline</button>
              @if (m.cmStatus === 'Not referred' && m.riskScore >= 6) {
                <button class="btn outline teal" (click)="refer(m)"><z-icon name="arrowup" [size]="14"></z-icon> Refer to Care Management</button>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(17,24,39,.5); z-index: 130;
      display:flex; align-items:stretch; justify-content:flex-end; }
    .chart { width: 900px; max-width: 96vw; height: 100%; background:#f1f5f9; overflow-y:auto;
      box-shadow:-16px 0 40px rgba(0,0,0,.25); animation: slide .2s ease-out; }
    @keyframes slide { from { transform: translateX(40px); opacity:.7; } to { transform:none; opacity:1; } }
    .ctx { display:flex; align-items:center; gap:14px; background:linear-gradient(90deg,#eff6ff,#dbeafe);
      border-bottom:1px solid #bfdbfe; padding:12px 20px; position:sticky; top:0; z-index:2; }
    .back { border:none; background:none; color:#2563eb; font-weight:600; font-size:12.5px; cursor:pointer; }
    .crumb { font-size:12.5px; color:var(--ink-soft); font-weight:600; }
    .umbadge { background:#2563eb; color:#fff; font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:6px; }
    .x { margin-left:auto; border:none; background:none; font-size:22px; color:var(--gray-400); cursor:pointer; }
    .body { padding: 20px 24px 40px; }

    .mhead { display:flex; gap:18px; align-items:flex-start; background:#fff; border:1px solid var(--border);
      border-radius:12px; padding:20px; }
    .avatar { width:60px;height:60px;border-radius:999px;background:linear-gradient(135deg,#0ea5e9,#2563eb);
      color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 60px; }
    .mid { flex:1; }
    .mname { font-size:19px;font-weight:700;color:var(--ink); }
    .chk { color:var(--green); font-size:14px; }
    .demo { font-size:12.5px;color:var(--gray-500);margin:3px 0 10px; }
    .tags { display:flex; gap:8px; flex-wrap:wrap; }
    .tag { font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--gray-100);color:var(--gray-500); }
    .tag.cases { background:#dbeafe;color:#1e40af; }
    .tag[data-a="Medium"]{ background:#ffedd5;color:#c2410c; } .tag[data-a="High"]{ background:#f3e8ff;color:#7e22ce; }
    .tag[data-a="Low"]{ background:#dcfce7;color:#166534; }
    .tag.pcm{ background:#ede9fe;color:#6d28d9; } .tag.pcp{ background:#dcfce7;color:#166534; }
    .tag.plan{ background:#e0f2fe;color:#0369a1; }
    .riskbox { width:220px;flex:0 0 220px; }
    .rlab { font-size:10px;letter-spacing:.06em;color:var(--gray-500);font-weight:700; }
    .rbar { height:8px;border-radius:999px;background:var(--gray-200);overflow:hidden;margin:6px 0; }
    .rbar > span { display:block;height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444); }
    .rval { font-size:12.5px;font-weight:700;color:var(--ink); }
    .cp { margin-top:8px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;display:inline-block;
      background:var(--gray-100);color:var(--gray-500); }
    .cp[data-s="Active"]{ background:#dcfce7;color:#166534; } .cp[data-s="In Progress"]{ background:#fef3c7;color:#92400e; }

    .alerts { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; }
    .alert { display:flex;align-items:center;gap:5px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;
      font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:8px; }

    .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:4px; }
    .mcard { background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px; }
    .mcard.span2 { grid-column:1 / -1; }
    .mcard h4 { margin:0 0 12px;font-size:13px;color:var(--ink); }
    .mcard dl { margin:0; display:grid; gap:9px; }
    .mcard dl > div { display:flex; justify-content:space-between; gap:12px; font-size:12.5px; }
    .mcard dt { color:var(--gray-500); } .mcard dd { margin:0; font-weight:600; color:var(--ink); text-align:right; }
    .ustats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
    .u { text-align:center; background:var(--gray-50); border-radius:8px; padding:10px 4px; }
    .u b { display:block; font-size:20px; color:var(--ink); } .u b.warn { color:var(--red); }
    .u span { font-size:10px; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .cmline { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .cmstatus { font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--gray-100);color:var(--gray-500); }
    .cmstatus[data-on="true"]{ background:#dcfce7;color:#166534; }
    .prog { font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;background:#e0f2fe;color:#0369a1; }
    .mt { width:100%; border-collapse:collapse; font-size:12.5px; }
    .mt thead th { text-align:left;padding:8px 10px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;
      color:var(--gray-500);font-weight:600;border-bottom:1px solid var(--gray-100); }
    .mt tbody td { padding:9px 10px;border-bottom:1px solid var(--gray-100);color:var(--ink-soft); }
    .mt tbody tr:last-child td { border-bottom:none; }
    .code { font-family:monospace; font-weight:600; color:var(--teal-900); }
    .strong { font-weight:600; color:var(--ink); }
    .pill { font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--gray-100);color:var(--gray-500); }
    .pill.primary { background:var(--teal-100);color:var(--teal-900); }
    .empty { font-size:12.5px;color:var(--gray-500); }
    .mactions { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
  `],
})
export class MemberChart {
  ix = inject(Interaction);
  readonly member = computed(() => this.ix.memberChart() as MC | null);

  initials(name: string) { return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }
  toast(msg: string) { this.ix.toast(msg, 'info'); }
  refer(m: MC) {
    this.ix.toast(`${m.name} referred to Care Management — CM intake created.`, 'success');
  }
}
