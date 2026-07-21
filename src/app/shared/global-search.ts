import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Members } from './members';
import { Interaction } from './interaction';
import { Nav } from './nav';
import { DashboardData } from '../data/dashboard-data';
import { CASE_POOL } from '../data/case-pool';
import { Icon } from './icon';

interface Hit { type: 'Member' | 'Case' | 'Provider' | 'Nurse'; label: string; sub: string; member?: string; }

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [FormsModule, Icon],
  template: `
    <div class="gs" (focusout)="onBlur($event)">
      <span class="gs-ic"><z-icon name="folder" [size]="14" [stroke]="1.8"></z-icon></span>
      <input class="gs-in" type="text" placeholder="Search members, cases, providers, nurses…"
        [ngModel]="q()" (ngModelChange)="q.set($event)" (focus)="open.set(true)" />
      @if (open() && q().trim().length >= 2) {
        <div class="gs-drop">
          @for (h of hits(); track h.type + h.label) {
            <button class="gs-hit" (click)="pick(h)">
              <span class="gs-type" [attr.data-t]="h.type">{{ h.type }}</span>
              <span class="gs-main"><b>{{ h.label }}</b>@if (h.sub) { <span class="gs-sub">{{ h.sub }}</span> }</span>
            </button>
          } @empty { <div class="gs-none">No matches for "{{ q() }}"</div> }
        </div>
      }
    </div>
  `,
  styles: [`
    .gs { position:relative; }
    .gs-ic { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--gray-400); pointer-events:none; }
    .gs-in { width:300px; border:1px solid var(--gray-300); border-radius:8px; padding:8px 12px 8px 32px; font-size:12.5px; outline:none; }
    .gs-in:focus { border-color:var(--teal-600); width:340px; }
    .gs-drop { position:absolute; top:calc(100% + 6px); left:0; right:0; background:#fff; border:1px solid var(--border);
      border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,.14); z-index:60; max-height:340px; overflow-y:auto; padding:4px; }
    .gs-hit { display:flex; align-items:center; gap:10px; width:100%; text-align:left; border:none; background:none; cursor:pointer; padding:8px 10px; border-radius:8px; }
    .gs-hit:hover { background:var(--gray-50); }
    .gs-type { flex:0 0 66px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; padding:2px 0; text-align:center; border-radius:5px; }
    .gs-type[data-t="Member"]{ background:var(--blue-bg); color:var(--blue-fg); }
    .gs-type[data-t="Case"]{ background:var(--teal-100); color:var(--teal-900); }
    .gs-type[data-t="Provider"]{ background:#ede9fe; color:var(--purple); }
    .gs-type[data-t="Nurse"]{ background:var(--green-bg); color:var(--green-fg); }
    .gs-main { font-size:12.5px; color:var(--ink); } .gs-main b { font-weight:600; }
    .gs-sub { color:var(--gray-500); margin-left:6px; }
    .gs-none { padding:12px; font-size:12.5px; color:var(--gray-500); text-align:center; }
  `],
})
export class GlobalSearch {
  private members = inject(Members);
  private ix = inject(Interaction);
  private nav = inject(Nav);
  private data = inject(DashboardData);

  readonly q = signal('');
  readonly open = signal(false);

  private index: Hit[] = this.build();

  private build(): Hit[] {
    const out: Hit[] = [];
    const seen = new Set<string>();
    for (const c of CASE_POOL) {
      if (!seen.has(c.member)) { seen.add(c.member); out.push({ type: 'Member', label: c.member, sub: '' }); }
      out.push({ type: 'Case', label: c.authId, sub: c.member, member: c.member });
    }
    // risk / appeal ids + members
    [['IP542119', 'Karen Wells'], ['IP543902', 'Robert Hayes'], ['IP540088', 'George Pike'],
     ['AP-2026-0112', 'Maria Benitez'], ['AP-2025-0891', 'Sheryl Leonard'], ['AP-2026-0088', 'Shannon Wright']]
      .forEach(([id, m]) => { out.push({ type: 'Case', label: id, sub: m, member: m });
        if (!seen.has(m)) { seen.add(m); out.push({ type: 'Member', label: m, sub: '' }); } });
    for (const p of this.data.providers) out.push({ type: 'Provider', label: p.provider, sub: `NPI ${p.npi}` });
    for (const n of this.data.nurses()) out.push({ type: 'Nurse', label: n.name, sub: `${n.utilization}% utilized` });
    ['Sara Nguyen, RN', 'David Patel, MSW', 'Maria Torres, RN', 'James Wong, PharmD', 'Angela Ruiz, RN']
      .forEach((n) => out.push({ type: 'Nurse', label: n, sub: 'Care Manager' }));
    return out;
  }

  readonly hits = computed(() => {
    const query = this.q().trim().toLowerCase();
    if (query.length < 2) return [];
    return this.index
      .filter((h) => h.label.toLowerCase().includes(query) || h.sub.toLowerCase().includes(query))
      .slice(0, 8);
  });

  pick(h: Hit) {
    this.q.set(''); this.open.set(false);
    if (h.type === 'Member') this.members.openByName(h.label);
    else if (h.type === 'Case') { if (h.member) this.members.openByName(h.member); else this.ix.toast(`Opening ${h.label}…`, 'info'); }
    else if (h.type === 'Provider') this.ix.toast(`Opening provider ${h.label}…`, 'info');
    else this.ix.toast(`Opening ${h.label}'s workload…`, 'info');
  }
  onBlur(e: FocusEvent) {
    const rel = e.relatedTarget as HTMLElement | null;
    if (!rel || !rel.closest('.gs')) setTimeout(() => this.open.set(false), 120);
  }
}
