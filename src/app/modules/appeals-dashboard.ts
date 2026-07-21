import { Component, computed, inject, signal } from '@angular/core';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { DashboardData } from '../data/dashboard-data';

interface Appeal {
  appealId: string; auth: string; member: string; service: string;
  level: 'L1' | 'L2' | 'IRO'; status: string; statusTone: string;
  nba: string; nbaTone: string; tat: string; tatTone: string; assigned: string;
  aiConfidence: number; queue: string;
}

@Component({
  selector: 'app-appeals-dashboard',
  standalone: true,
  imports: [KpiStrip],
  template: `
    <app-kpi-strip [items]="kpis" />

    <div class="tab-head">
      <h2>Appeals Worklist</h2>
      <span class="section-note">Prioritized by smart priority — deadline &amp; risk weighted</span>
    </div>

    <div class="pills">
      @for (f of filters; track f.key) {
        <button class="pill" [class.active]="filter() === f.key" (click)="filter.set(f.key)">
          <span class="pdot" [attr.data-tone]="f.tone"></span>{{ f.label }}
          <span class="pcount">{{ countFor(f.key) }}</span>
        </button>
      }
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Next Action</th><th>Member</th><th>Appeal · Auth</th><th>Level</th>
            <th>Status</th><th>TAT</th><th>Assigned To</th></tr>
        </thead>
        <tbody>
          @for (a of visible(); track a.appealId) {
            <tr class="clickable" (click)="open(a)">
              <td><span class="nba" [attr.data-tone]="a.nbaTone">{{ a.nba }}</span></td>
              <td><a class="mlink" (click)="members.openByName(a.member); $event.stopPropagation()">{{ a.member }}</a></td>
              <td><span class="strong">{{ a.appealId }}</span><br><span class="sub">{{ a.auth }} · {{ a.service }}</span></td>
              <td><span class="lv" [attr.data-l]="a.level">{{ a.level }}</span></td>
              <td><span class="st" [attr.data-tone]="a.statusTone">{{ a.status }}</span></td>
              <td><span class="tat" [attr.data-tone]="a.tatTone">{{ a.tat }}</span></td>
              <td>{{ a.assigned }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">No appeals in this queue.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .pill { display:flex; align-items:center; gap:7px; border:1px solid var(--gray-300); background:#fff;
      border-radius:999px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .pill:hover { border-color:var(--gray-400); }
    .pill.active { background:#5B47E0; border-color:#5B47E0; color:#fff; }
    .pill.active .pcount { background:rgba(255,255,255,.25); color:#fff; }
    .pdot { width:8px; height:8px; border-radius:999px; }
    .pdot[data-tone="purple"]{ background:#5B47E0; } .pdot[data-tone="blue"]{ background:#1A6BC4; }
    .pdot[data-tone="amber"]{ background:#C07A0A; } .pdot[data-tone="teal"]{ background:#1D9E75; }
    .pdot[data-tone="red"]{ background:#D94040; } .pdot[data-tone="gray"]{ background:#9CA3AF; }
    .pcount { background:var(--gray-100); color:var(--gray-500); font-size:10.5px; padding:0 6px; border-radius:999px; }
    .clickable { cursor:pointer; }
    .mlink { color:#5B47E0; font-weight:600; cursor:pointer; } .mlink:hover { text-decoration:underline; }
    .sub { font-size:11px; color:var(--gray-500); }
    .nba { font-size:11.5px; font-weight:600; padding:4px 10px; border-radius:6px; display:inline-block; }
    .nba[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .nba[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; }
    .nba[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .nba[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; }
    .nba[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; }
    .lv { font-size:11px; font-weight:700; padding:2px 9px; border-radius:6px; }
    .lv[data-l="L1"]{ background:#EAF2FC; color:#1A6BC4; } .lv[data-l="L2"]{ background:#EEEAFC; color:#5B47E0; }
    .lv[data-l="IRO"]{ background:#F3F4F6; color:#6B7280; }
    .st { font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:6px; }
    .st[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .st[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; }
    .st[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .st[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; }
    .st[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; } .st[data-tone="gray"]{ background:#F3F4F6; color:#6B7280; }
    .tat { font-weight:600; font-variant-numeric:tabular-nums; }
    .tat[data-tone="red"]{ color:#D94040; } .tat[data-tone="amber"]{ color:#C07A0A; } .tat[data-tone="teal"]{ color:#1D9E75; }
    .empty { text-align:center; color:var(--gray-500); padding:24px; }
  `],
})
export class AppealsDashboard {
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  readonly kpis: KpiItem[] = [
    { icon: 'balance', value: '8',  label: 'Open Appeals',       tone: 'purple' },
    { icon: 'user',    value: '3',  label: 'Assigned for Review', tone: 'blue' },
    { icon: 'phone',   value: '2',  label: 'Pending MD / P2P',   tone: 'amber' },
    { icon: 'mail',    value: '1',  label: 'Pending Information', tone: 'teal' },
    { icon: 'xcircle', value: '1',  label: 'SLA Overdue',        tone: 'red' },
    { icon: 'check',   value: '19', label: 'Closed This Month',  tone: 'green' },
  ];

  readonly filters = [
    { key: 'all',      label: 'All Open',      tone: 'purple' },
    { key: 'assigned', label: 'Assigned',      tone: 'purple' },
    { key: 'md',       label: 'MD / P2P',      tone: 'blue' },
    { key: 'info',     label: 'Pending Info',  tone: 'amber' },
    { key: 'ready',    label: 'Ready',         tone: 'teal' },
    { key: 'overdue',  label: 'Overdue',       tone: 'red' },
    { key: 'closed',   label: 'Closed',        tone: 'gray' },
  ];
  readonly filter = signal('all');

  readonly appeals = signal<Appeal[]>([
    { appealId: 'AP-2025-0891', auth: 'BH656278', member: 'Sheryl Leonard',    service: 'Medical necessity — BH IOP', level: 'L1', status: 'Overdue', statusTone: 'red', nba: 'Overdue — Review Now', nbaTone: 'red', tat: '352d overdue', tatTone: 'red', assigned: 'C. Lawson', aiConfidence: 71, queue: 'overdue' },
    { appealId: 'AP-2026-0112', auth: 'BH784201', member: 'Maria Benitez',     service: 'Criteria not met — IP psych', level: 'L1', status: 'Assigned for Review', statusTone: 'purple', nba: 'Review Appeal Case', nbaTone: 'purple', tat: '11d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 94, queue: 'assigned' },
    { appealId: 'AP-2026-0088', auth: 'BH877493', member: 'Shannon Wright',    service: 'Not medically necessary', level: 'L2', status: 'Pending MD Review', statusTone: 'blue', nba: 'Complete MD Review', nbaTone: 'blue', tat: '5d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 66, queue: 'md' },
    { appealId: 'AP-2026-0077', auth: 'BH300966', member: 'Marcus Webb',       service: 'IOP criteria not met', level: 'L1', status: 'Pending Information', statusTone: 'amber', nba: 'Resume — Records Received?', nbaTone: 'amber', tat: '12d left', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 80, queue: 'info' },
    { appealId: 'AP-2026-0059', auth: 'RX408528', member: 'Vanessa Hernandez', service: 'Experimental — not covered', level: 'IRO', status: 'Ready for Determination', statusTone: 'teal', nba: 'Send Member & Provider Notice', nbaTone: 'teal', tat: '12d left', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 88, queue: 'ready' },
    { appealId: 'AP-2026-0031', auth: 'IP490812', member: 'James Okafor',      service: 'IP LOS extension', level: 'L1', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 90, queue: 'closed' },
    { appealId: 'AP-2026-0028', auth: 'OP351953', member: 'Linda Park',        service: 'OP procedure denial', level: 'L1', status: 'Closed — Upheld', statusTone: 'gray', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 55, queue: 'closed' },
    { appealId: 'AP-2026-0019', auth: 'RX921945', member: 'Carlos Reyes',      service: 'Specialty Rx denial', level: 'L2', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 84, queue: 'closed' },
  ]);

  readonly visible = computed(() => {
    const f = this.filter();
    const rows = this.appeals();
    if (f === 'all') return rows.filter((a) => a.queue !== 'closed');
    return rows.filter((a) => a.queue === f);
  });

  countFor(key: string) {
    const rows = this.appeals();
    if (key === 'all') return rows.filter((a) => a.queue !== 'closed').length;
    return rows.filter((a) => a.queue === key).length;
  }

  open(a: Appeal) {
    const rec = a.aiConfidence >= 85 ? 'Overturn' : a.aiConfidence >= 60 ? 'Partial' : 'Uphold';
    this.ix.openDrawer({
      title: `${a.appealId} · ${a.member}`,
      subtitle: `${a.service} · Auth ${a.auth}`,
      badge: { text: a.level === 'IRO' ? 'External (IRO)' : `Level ${a.level.replace('L', '')}`,
        tone: a.level === 'L1' ? 'blue' : 'teal' },
      formula: `AI Confidence ${a.aiConfidence}% — Likely ${rec}`,
      fields: [
        { label: 'Status', value: a.status },
        { label: 'Level', value: a.level === 'IRO' ? 'External (IRO)' : `Level ${a.level.replace('L', '')}` },
        { label: 'TAT', value: a.tat, tone: a.tatTone === 'red' ? 'red' : a.tatTone === 'amber' ? 'amber' : 'green' },
        { label: 'Assigned To', value: a.assigned },
        { label: 'Next Action', value: a.nba },
      ],
      note: `AI reviewed the denial rationale against clinical criteria and recommends "${rec}". Record the determination below.`,
      actions: a.queue === 'closed' ? [] : [
        { label: 'Overturn — Approve appeal', tone: 'teal', run: () => this.decide(a, 'Overturned') },
        { label: 'Partial — Partially overturn', tone: 'amber', run: () => this.decide(a, 'Partially Overturned') },
        { label: 'Uphold — Deny appeal', tone: 'red', run: () => this.decide(a, 'Upheld') },
      ],
    });
  }

  private decide(a: Appeal, outcome: string) {
    const tone = outcome === 'Upheld' ? 'gray' : 'teal';
    this.appeals.update((rows) => rows.map((x) => x.appealId === a.appealId
      ? { ...x, status: `Closed — ${outcome}`, statusTone: tone, queue: 'closed', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal' }
      : x));
    this.ix.toast(`${a.appealId} determination recorded: ${outcome}.`, 'info');
    this.data.addHistory('balance', 'Appeal determination', `${a.appealId} (${a.member}) — ${outcome}`);
  }
}
