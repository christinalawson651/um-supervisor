import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { AiRecommendation } from '../data/dashboard.models';
import { Icon } from '../shared/icon';
import { Ring } from '../shared/ring';

@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [Icon, Ring],
  template: `
    <div class="ai-shell">
      <div class="ai-head">
        <div class="ai-title">
          <span class="ai-spark"><z-icon name="sparkles" [size]="18"></z-icon></span>
          <div>
            <h2>AI / NextGen Intelligence</h2>
            <p class="section-note">Predictive analytics and intelligent recommendations</p>
          </div>
        </div>
        <span class="ai-pill">AI-Powered</span>
      </div>

      <!-- recommendation cards -->
      <div class="recs">
        @for (r of data.aiRecommendations(); track r.title) {
          <div class="rec" [attr.data-tone]="r.tone">
            <div class="rec-top">
              <span class="rec-ic"><z-icon [name]="r.icon" [size]="16" [stroke]="1.8"></z-icon></span>
              <span class="conf">{{ r.confidence }}% confidence</span>
            </div>
            <div class="rec-title">{{ r.title }}</div>
            <div class="rec-detail">{{ r.detail }}</div>
            <button class="btn primary rec-btn" (click)="act(r)">
              <z-icon [name]="r.icon" [size]="14"></z-icon> {{ r.action }}
            </button>
          </div>
        } @empty {
          <div class="rec-empty">All AI recommendations have been actioned. ✓</div>
        }
      </div>

      <!-- bottom panels -->
      <div class="ai-bottom">
        <div class="panel panel-pad">
          <h3 class="panel-title">Predictive Risk Gauges</h3>
          <div class="gauges">
            @for (g of data.riskGauges; track g.label; let i = $index) {
              <div class="gauge clickable" (click)="metrics.open(gaugeKeys[i])">
                <z-ring [value]="g.value" [size]="92" [thickness]="9" [tone]="g.tone" [fontSize]="18"></z-ring>
                <div class="glab">{{ g.label }}</div>
              </div>
            }
          </div>
        </div>

        <div class="panel panel-pad">
          <h3 class="panel-title">Automation Metrics</h3>
          <div class="auto-val clickable" (click)="metrics.open('ai.auto')">{{ data.aiAutoApproved }}%</div>
          <div class="auto-cap">Auto-Approved</div>
          <div class="pbar auto-bar"><span [style.width.%]="data.aiAutoApproved"></span></div>

          <div class="conf-title">AI Confidence Distribution</div>
          @for (c of data.aiConfidence; track c.label; let i = $index) {
            <div class="conf-row clickable" (click)="metrics.open(confKeys[i])">
              <span class="conf-lab">{{ c.label }}</span>
              <span class="conf-track">
                <span class="pbar" [class.amber]="c.tone==='amber'" [class.red]="c.tone==='red'">
                  <span [style.width.%]="c.pct"></span>
                </span>
              </span>
              <span class="conf-pct">{{ c.pct }}%</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ai-shell { border: 1px solid var(--teal-600); border-radius: 12px; padding: 20px 22px;
      background: linear-gradient(180deg, #f7fdfc 0%, #ffffff 40%); }
    .ai-head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom: 18px; }
    .ai-title { display:flex; gap:12px; align-items:flex-start; }
    .ai-spark { width:32px;height:32px;border-radius:9px;background:var(--teal-100);color:var(--teal-700);
      display:flex;align-items:center;justify-content:center; }
    .ai-title h2 { font-size:17px; font-weight:600; margin:0 0 2px; }
    .ai-pill { background: var(--teal-700); color:#fff; font-size:11px; font-weight:700;
      padding:5px 12px; border-radius:999px; }

    .recs { display:grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; }
    .rec[data-tone="red"]  { border-left-color: var(--red); }
    .rec[data-tone="amber"]{ border-left-color: var(--amber); }
    .rec[data-tone="blue"] { border-left-color: var(--blue); }
    .rec-top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
    .rec-ic { width:30px;height:30px;border-radius:8px;background:var(--teal-50);color:var(--teal-700);
      display:flex;align-items:center;justify-content:center; }
    .conf { background: var(--teal-50); color: var(--teal-900); font-size:11px; font-weight:600;
      padding:3px 9px; border-radius:999px; }
    .rec-title { font-size:13.5px; font-weight:700; color:var(--ink); margin-bottom:6px; }
    .rec-detail { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; }
    .rec-btn { width:100%; justify-content:center; }

    .ai-bottom { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
    .gauges { display:flex; justify-content:space-around; padding: 14px 0 4px; }
    .gauge { text-align:center; }
    .glab { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }

    .auto-val { text-align:center; font-size:26px; font-weight:700; color: var(--teal-700); }
    .auto-cap { text-align:center; font-size:12px; color:var(--gray-500); margin: 2px 0 12px; }
    .auto-bar { margin-bottom: 22px; }
    .conf-title { font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom: 14px; }
    .conf-row { display:flex; align-items:center; gap:12px; margin-bottom: 12px; }
    .conf-lab { flex: 0 0 92px; font-size:11.5px; color:var(--gray-500); }
    .conf-track { flex:1; }
    .conf-pct { flex:0 0 34px; text-align:right; font-size:12px; font-weight:600; color:var(--ink-soft);
      font-variant-numeric: tabular-nums; }
    .rec-empty { grid-column: 1 / -1; text-align:center; padding: 28px; color: var(--teal-700);
      font-size: 13px; font-weight: 600; background:#fff; border:1px dashed var(--teal-600);
      border-radius: var(--radius); }
    .clickable { cursor: pointer; }
    .gauge.clickable:hover { transform: scale(1.04); transition: transform .12s; }
    .conf-row.clickable:hover .conf-lab { color: var(--teal-700); }
    .auto-val.clickable:hover { color: var(--teal-900); }
  `],
})
export class AiTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  readonly gaugeKeys = ['ai.denial', 'ai.appeal', 'ai.tatrisk'];
  readonly confKeys = ['ai.confHigh', 'ai.confMed', 'ai.confLow'];

  act(r: AiRecommendation) {
    // Escalations let the supervisor pick who to assign to.
    if (r.action === 'Escalate to MD') {
      this.ix.choose({
        title: r.title, body: r.detail, label: 'Assign to',
        options: ['Dr. Patel — Medical Director', 'Dr. Nguyen — MD Review', 'Dr. Rivera — MD Review', 'Peer-to-Peer Review Queue'],
        confirmLabel: 'Escalate to MD', tone: 'teal',
        onChoose: (who) => {
          this.data.decrementQueue('MD Review');
          this.ix.toast(`AUTH-4498 escalated to ${who}.`, 'info');
          this.data.addHistory('arrowup', 'AI: escalated to MD', `${r.title} → ${who}`);
          this.data.dismissRecommendation(r.title);
        },
      });
      return;
    }
    this.ix.ask({
      title: r.action,
      body: r.detail,
      confirmLabel: r.action,
      tone: r.tone === 'red' ? 'red' : r.tone === 'amber' ? 'amber' : 'teal',
      onConfirm: () => {
        if (r.action === 'Reassign Case') {
          const move = this.data.reassignBusiest();
          this.data.decrementQueue('Clinical Review');
          this.ix.toast(move ? `Case reassigned from ${move.from} to ${move.to}.` : 'Case reassigned.');
          this.data.addHistory('swap', 'AI: case reassigned', move ? `${move.from} → ${move.to}` : r.title);
        } else if (r.action === 'Send RFI') {
          this.data.decrementQueue('RFI Pending');
          this.ix.toast('RFI sent to provider for AUTH-4521.', 'info');
          this.data.addHistory('mail', 'AI: RFI sent', 'AUTH-4521 — clinical justification requested');
        } else {
          this.ix.toast('Action completed.');
        }
        this.data.dismissRecommendation(r.title);
      },
    });
  }
}
