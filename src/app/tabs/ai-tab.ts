import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Icon } from '../shared/icon';
import { Ring } from '../shared/ring';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { AI_DECISIONS, AiDecisionRecord } from '../data/ai-oversight';
import { inPlanScope, urgencyOf, TODAY_ISO } from '../data/case-fields';
import { COLUMNS, toRow } from '../shared/metrics';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

type Tone = 'teal' | 'amber' | 'red' | 'blue';
interface Rec { key: string; authId: string; icon: string; title: string; detail: string; confidence: number; action: 'Reassign Authorization' | 'Send RFI' | 'Escalate to MD'; tone: Tone; }
interface Gauge { label: string; value: number; tone: 'teal' | 'amber' | 'red'; cases: CaseRec[]; }

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

// AI / NextGen Intelligence. Every figure is computed from the cases and AI determinations in the
// shared Dates and Plans scope, the same way as the other UM tabs.
@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [Icon, Ring],
  template: `
    <div class="ai-shell">
      <div class="ai-head">
        <div class="ai-title">
          <span class="ai-spark"><z-icon name="sparkles" [size]="18"></z-icon></span>
          <h2>AI / NextGen Intelligence</h2>
        </div>
      </div>

      <div class="recs">
        @for (r of recs(); track r.key) {
          <div class="rec" [attr.data-tone]="r.tone">
            <div class="rec-top">
              <span class="rec-ic"><z-icon [name]="r.icon" [size]="16" [stroke]="1.8"></z-icon></span>
              <span class="conf clickable" (click)="openRec(r)">{{ r.confidence }}% confidence</span>
            </div>
            <div class="rec-title">{{ r.title }}</div>
            <div class="rec-detail">{{ r.detail }}</div>
            <button class="btn primary rec-btn" (click)="act(r)">
              <z-icon [name]="r.icon" [size]="14"></z-icon> {{ r.action }}
            </button>
          </div>
        } @empty {
          <div class="rec-empty">No open recommendations.</div>
        }
      </div>

      <div class="ai-bottom">
        <div class="panel panel-pad">
          <h3 class="panel-title">Predictive Risk Gauges</h3>
          <div class="gauges">
            @for (g of gauges(); track g.label) {
              <div class="gauge clickable" (click)="openGauge(g)">
                <z-ring [value]="g.value" [size]="92" [thickness]="9" [tone]="g.tone" [fontSize]="18"></z-ring>
                <div class="glab">{{ g.label }}</div>
                <div class="gnum">{{ g.cases.length }}</div>
              </div>
            }
          </div>
        </div>

        <div class="panel panel-pad">
          <h3 class="panel-title">Automation Metrics</h3>
          <div class="auto-val clickable" (click)="openAuto()">{{ autoPct() }}%</div>
          <div class="auto-cap">Auto-cleared · {{ autoRows().length }} of {{ aiRows().length }}</div>
          <div class="pbar auto-bar"><span [style.width.%]="autoPct()"></span></div>

          <div class="conf-title">AI Confidence Distribution</div>
          @for (c of confidence(); track c.label) {
            <div class="conf-row clickable" (click)="openConfidence(c.label, c.rows)">
              <span class="conf-lab">{{ c.label }}</span>
              <span class="conf-track">
                <span class="pbar" [class.amber]="c.tone === 'amber'" [class.red]="c.tone === 'red'">
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
    .ai-title { display:flex; gap:12px; align-items:center; }
    .ai-spark { width:32px;height:32px;border-radius:9px;background:var(--teal-100);color:var(--teal-700);
      display:flex;align-items:center;justify-content:center; }
    .ai-title h2 { font-size:17px; font-weight:600; margin:0; }

    .recs { display:grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; display:flex; flex-direction:column; }
    .rec[data-tone="red"]  { border-left-color: var(--red); }
    .rec[data-tone="amber"]{ border-left-color: var(--amber); }
    .rec[data-tone="blue"] { border-left-color: var(--blue); }
    .rec-top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
    .rec-ic { width:30px;height:30px;border-radius:8px;background:var(--teal-50);color:var(--teal-700);
      display:flex;align-items:center;justify-content:center; }
    .conf { background: var(--teal-50); color: var(--teal-900); font-size:11px; font-weight:600;
      padding:3px 9px; border-radius:999px; }
    .rec-title { font-size:13.5px; font-weight:700; color:var(--ink); margin-bottom:6px; }
    .rec-detail { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; flex:1; }
    .rec-btn { width:100%; justify-content:center; }

    .ai-bottom { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
    .gauges { display:flex; justify-content:space-around; padding: 14px 0 4px; }
    .gauge { text-align:center; }
    .glab { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }
    .gnum { font-size:11.5px; color:var(--gray-500); font-variant-numeric: tabular-nums; }

    .auto-val { text-align:center; font-size:26px; font-weight:700; color: var(--teal-700); }
    .auto-cap { text-align:center; font-size:12px; color:var(--gray-500); margin: 2px 0 12px; }
    .auto-bar { margin-bottom: 22px; }
    .conf-title { font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom: 14px; }
    .conf-row { display:flex; align-items:center; gap:12px; margin-bottom: 12px; }
    .conf-lab { flex: 0 0 110px; font-size:11.5px; color:var(--gray-500); }
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
  private data = inject(DashboardData);
  private ix = inject(Interaction);
  private plans = inject(LobFilter);
  private lookback = inject(Lookback);

  /** Recommendations already acted on this session (by auth ID). */
  private readonly done = signal<ReadonlySet<string>>(new Set());

  private inDates(date: string): boolean { return this.lookback.period() === '30d' || this.lookback.includes(date); }
  readonly cases = computed(() => {
    this.lookback.from(); this.lookback.to();
    const sel = this.plans.value();
    return CASE_POOL.filter((c) => inPlanScope(c.authId, sel) && this.inDates(c.submitted));
  });
  readonly pending = computed(() => this.cases().filter((c) => c.phase === 'pending'));
  readonly decided = computed(() => this.cases().filter((c) => c.phase === 'decided'));
  readonly aiRows = computed((): AiDecisionRecord[] => {
    this.lookback.from(); this.lookback.to();
    const sel = this.plans.value();
    return AI_DECISIONS.filter((r) => inPlanScope(r.authId, sel) && this.inDates(r.decidedDate));
  });

  readonly gauges = computed((): Gauge[] => {
    const p = this.pending(), d = this.decided();
    const denied = d.filter((c) => c.decision === 'Denied');
    const appeal = d.filter((c) => c.tags.includes('appeal'));
    const tat = p.filter((c) => c.tags.includes('atRisk') || c.tags.includes('breached'));
    const tone = (v: number): Gauge['tone'] => (v >= 20 ? 'red' : v >= 10 ? 'amber' : 'teal');
    const g = (label: string, cases: CaseRec[], of: number): Gauge => { const value = pct(cases.length, of); return { label, value, tone: tone(value), cases }; };
    return [g('Denial Likelihood', denied, d.length), g('Appeal Likelihood', appeal, d.length), g('TAT Breach Risk', tat, p.length)];
  });

  readonly autoRows = computed(() => this.aiRows().filter((r) => r.autoCleared));
  readonly autoPct = computed(() => pct(this.autoRows().length, this.aiRows().length));
  readonly confidence = computed(() => {
    const rows = this.aiRows();
    const bands: { label: string; tone: 'teal' | 'amber' | 'red'; test: (c: number) => boolean }[] = [
      { label: 'High (≥ 0.90)', tone: 'teal', test: (c) => c >= 0.9 },
      { label: 'Medium (0.70–0.90)', tone: 'amber', test: (c) => c >= 0.7 && c < 0.9 },
      { label: 'Low (< 0.70)', tone: 'red', test: (c) => c < 0.7 },
    ];
    return bands.map((b) => { const r = rows.filter((x) => b.test(x.confidence)); return { label: b.label, tone: b.tone, pct: pct(r.length, rows.length), rows: r }; });
  });

  /** Up to three recommendations drawn from the live scope. */
  readonly recs = computed((): Rec[] => {
    const done = this.done(), open = this.pending().filter((c) => !done.has(c.authId));
    // Pending cases have no scored determination yet; give each a stable per-case pre-review score.
    const conf = (authId: string, base: number) => {
      const r = AI_DECISIONS.find((x) => x.authId === authId);
      if (r) return Math.round(r.confidence * 100);
      const n = Number(authId.replace(/D/g, '')) || 0;
      return Math.min(99, Math.round(base * 100) - 6 + (n % 11));
    };
    const out: Rec[] = [];
    // 1. Reassign: oldest case held by the busiest nurse, to the least-utilized nurse.
    const nurses = [...this.data.nurses()].sort((a, b) => b.utilization - a.utilization);
    const busy = nurses[0], light = nurses[nurses.length - 1];
    const heavy = open.filter((c) => c.nurse === busy?.name).sort((a, b) => a.submitted.localeCompare(b.submitted))[0];
    if (heavy && light && busy.name !== light.name && busy.utilization >= 85) {
      out.push({ key: 'reassign', authId: heavy.authId, icon: 'swap', tone: 'red', action: 'Reassign Authorization', confidence: conf(heavy.authId, 0.91),
        title: `Reassign ${heavy.authId}`, detail: `${busy.name} is at ${busy.utilization}% utilization. Move to ${light.name} (${light.utilization}%). ${heavy.procedure} · submitted ${heavy.submitted}.` });
    }
    // 2. Send RFI: oldest case with incomplete documentation not already waiting on an RFI.
    const rfi = open.filter((c) => c.tags.includes('incompleteDoc') && !c.tags.includes('paused')).sort((a, b) => a.submitted.localeCompare(b.submitted))[0];
    if (rfi) {
      out.push({ key: 'rfi', authId: rfi.authId, icon: 'mail', tone: 'amber', action: 'Send RFI', confidence: conf(rfi.authId, 0.88),
        title: `Send RFI for ${rfi.authId}`, detail: `${rfi.procedure} · documentation incomplete · ${rfi.provider} · submitted ${rfi.submitted}.` });
    }
    // 3. Escalate: an at-risk or breached case not yet with a Medical Director.
    const esc = open.filter((c) => (c.tags.includes('breached') || c.tags.includes('atRisk')) && !c.tags.includes('mdReview'))
      .sort((a, b) => Number(b.tags.includes('breached')) - Number(a.tags.includes('breached')) || a.submitted.localeCompare(b.submitted))[0];
    if (esc) {
      out.push({ key: 'escalate', authId: esc.authId, icon: 'arrowup', tone: 'blue', action: 'Escalate to MD', confidence: conf(esc.authId, 0.93),
        title: `Escalate ${esc.authId} to MD`, detail: `${esc.procedure} · ${esc.tags.includes('breached') ? 'past its TAT deadline' : 'at risk of a TAT breach'} · ${urgencyOf(esc)}.` });
    }
    return out;
  });

  // ---------- drill-downs ----------
  private explore(title: string, context: string, cases: CaseRec[], name: string) {
    this.ix.openExplorer({ title, context, columns: COLUMNS, rows: cases.map(toRow), exportName: `ai-${name}-${TODAY_ISO}`, memberColumn: 1 });
  }
  openGauge(g: Gauge) { this.explore(g.label, `${g.cases.length} authorization(s) · ${g.value}%`, g.cases, g.label.toLowerCase().replace(/\s+/g, '-')); }
  private casesFor(rows: AiDecisionRecord[]) { const ids = new Set(rows.map((r) => r.authId)); return CASE_POOL.filter((c) => ids.has(c.authId)); }
  openAuto() { this.explore('Auto-cleared determinations', `${this.autoRows().length} of ${this.aiRows().length} AI determinations · ${this.autoPct()}%`, this.casesFor(this.autoRows()), 'auto-cleared'); }
  openConfidence(label: string, rows: AiDecisionRecord[]) { this.explore(`Confidence ${label}`, `${rows.length} AI determination(s)`, this.casesFor(rows), 'confidence'); }

  openRec(r: Rec) {
    this.ix.openDrawer({
      title: r.title,
      badge: { text: `${r.confidence}% confidence`, tone: r.confidence >= 90 ? 'green' : r.confidence >= 70 ? 'amber' : 'red' },
      fields: [
        { label: 'Authorization', value: r.authId },
        { label: 'Recommendation', value: r.detail },
        { label: 'Suggested Action', value: r.action },
        { label: 'Confidence', value: `${r.confidence}%` },
      ],
      actions: [{ label: r.action, tone: r.tone === 'red' ? 'red' : r.tone === 'amber' ? 'amber' : 'teal', run: () => this.act(r) }],
    });
  }

  private finish(r: Rec) { this.done.update((s) => new Set([...s, r.authId])); }

  act(r: Rec) {
    if (r.action === 'Escalate to MD') {
      this.ix.choose({
        title: r.title, body: r.detail, label: 'Assign to',
        options: ['Dr. Patel — Medical Director', 'Dr. Nguyen — MD Review', 'Dr. Rivera — MD Review', 'Peer-to-Peer Review Queue'],
        confirmLabel: 'Escalate to MD', tone: 'teal',
        onChoose: (who) => {
          this.ix.toast(`${r.authId} escalated to ${who}.`, 'info');
          this.data.addHistory('arrowup', 'AI: escalated to MD', `${r.authId} → ${who}`);
          this.finish(r);
        },
      });
      return;
    }
    this.ix.ask({
      title: r.action, body: r.detail, confirmLabel: r.action,
      tone: r.tone === 'red' ? 'red' : r.tone === 'amber' ? 'amber' : 'teal',
      onConfirm: () => {
        if (r.action === 'Reassign Authorization') {
          const move = this.data.reassignBusiest();
          this.ix.toast(move ? `${r.authId} reassigned from ${move.from} to ${move.to}.` : `${r.authId} reassigned.`);
          this.data.addHistory('swap', 'AI: authorization reassigned', move ? `${r.authId} · ${move.from} → ${move.to}` : r.authId);
        } else {
          this.ix.toast(`RFI sent to provider for ${r.authId}.`, 'info');
          this.data.addHistory('mail', 'AI: RFI sent', `${r.authId} — documentation requested`);
        }
        this.finish(r);
      },
    });
  }
}
