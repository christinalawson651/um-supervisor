import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Escalate, EscalateCandidate } from './escalate';

@Component({
  selector: 'app-escalate-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (ex.config(); as c) {
      <div class="scrim" (click)="ex.close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="mh">
            <div><h3>{{ c.title }}</h3><div class="sub">Designate the cases to escalate, then choose who to assign them to.</div></div>
            <button class="x" (click)="ex.close()">×</button>
          </div>

          <div class="filters">
            @for (f of filters(); track f) {
              <button class="fp" [class.on]="filter() === f" (click)="filter.set(f)">{{ f }}</button>
            }
            <span class="spacer"></span>
            <button class="link" (click)="selectAll()">Select all</button>
            <button class="link" (click)="clearAll()">Clear</button>
          </div>

          <div class="list">
            @for (cand of visible(); track cand.authId) {
              <label class="row" [class.sel]="selected().has(cand.authId)">
                <input type="checkbox" [checked]="selected().has(cand.authId)" (change)="toggle(cand.authId)" />
                <span class="dot" [attr.data-r]="cand.risk"></span>
                <span class="main"><b>{{ cand.authId }}</b> · {{ cand.member }}<div class="det">{{ cand.detail }}</div></span>
                <span class="rl" [attr.data-r]="cand.risk">{{ cand.riskLabel }}</span>
              </label>
            } @empty { <div class="empty">No cases match this filter.</div> }
          </div>

          <label class="tlab">Escalate to</label>
          <select class="tsel" [ngModel]="target()" (ngModelChange)="target.set($event)">
            @for (t of c.targets; track t) { <option [value]="t">{{ t }}</option> }
          </select>

          <div class="mf">
            <span class="note">@if (selected().size) { Escalating <b>{{ selected().size }}</b> case(s) → <b>{{ target() }}</b> }
              @else { Select at least one case }</span>
            <span class="spacer"></span>
            <button class="btn outline" (click)="ex.close()">Cancel</button>
            <button class="btn primary" [attr.data-tone]="'amber'" [disabled]="!selected().size || !target()" (click)="apply(c)">Escalate {{ selected().size || '' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.45); z-index:120; display:flex; align-items:center; justify-content:center; }
    .modal { background:#fff; border-radius:12px; width:520px; max-width:92vw; max-height:88vh; display:flex; flex-direction:column; padding:20px 22px; box-shadow:0 20px 40px rgba(0,0,0,.2); }
    .mh { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; }
    .mh h3 { margin:0; font-size:16px; } .sub { font-size:12.5px; color:var(--gray-500); margin-top:4px; }
    .x { border:none; background:none; font-size:22px; color:var(--gray-400); cursor:pointer; }
    .filters { display:flex; align-items:center; gap:6px; margin-bottom:10px; }
    .fp { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:4px 12px; font-size:11.5px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .fp.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .spacer { flex:1; } .link { border:none; background:none; color:var(--teal-700); font-size:11.5px; font-weight:600; cursor:pointer; }
    .list { overflow-y:auto; max-height:280px; border:1px solid var(--gray-100); border-radius:8px; margin-bottom:16px; }
    .row { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--gray-100); cursor:pointer; font-size:12.5px; }
    .row:last-child { border-bottom:none; } .row.sel { background:var(--teal-50); }
    .dot { width:8px; height:8px; border-radius:999px; flex:0 0 8px; }
    .dot[data-r="red"]{ background:var(--red); } .dot[data-r="amber"]{ background:var(--amber); } .dot[data-r="green"]{ background:var(--green); }
    .main { flex:1; } .main b { color:var(--teal-900); } .det { font-size:11px; color:var(--gray-500); margin-top:2px; }
    .rl { font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap; }
    .rl[data-r="red"]{ background:var(--red-bg); color:var(--red-fg); } .rl[data-r="amber"]{ background:var(--amber-bg); color:var(--amber-fg); } .rl[data-r="green"]{ background:var(--green-bg); color:var(--green-fg); }
    .empty { padding:20px; text-align:center; color:var(--gray-500); }
    .tlab { display:block; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:6px; }
    .tsel { width:100%; padding:9px 12px; border:1px solid var(--gray-300); border-radius:8px; font-size:13px; outline:none; margin-bottom:18px; }
    .tsel:focus { border-color:var(--teal-600); }
    .mf { display:flex; align-items:center; gap:10px; }
    .note { font-size:12.5px; color:var(--gray-500); }
    .btn.primary[data-tone="amber"] { background:var(--amber); border-color:var(--amber); color:#3d2c00; }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class EscalatePanel {
  ex = inject(Escalate);
  readonly filter = signal('All');
  readonly selected = signal<Set<string>>(new Set());
  readonly target = signal('');

  constructor() {
    effect(() => {
      const c = this.ex.config();
      this.filter.set('All');
      // sensible default: pre-select the highest-risk candidates + default target
      this.selected.set(new Set((c?.candidates ?? []).filter((x) => x.risk === 'red').map((x) => x.authId)));
      this.target.set(c?.targets[0] ?? '');
    });
  }

  filters() {
    const c = this.ex.config();
    const has = (r: string) => (c?.candidates ?? []).some((x) => x.risk === r);
    return ['All', ...(['red', 'amber'].filter(has).map((r) => (r === 'red' ? 'High' : 'Medium')))];
  }
  readonly visible = computed(() => {
    const c = this.ex.config(); if (!c) return [];
    const f = this.filter();
    return f === 'All' ? c.candidates : c.candidates.filter((x) => (f === 'High' ? x.risk === 'red' : x.risk === 'amber'));
  });
  toggle(id: string) { this.selected.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  selectAll() { this.selected.set(new Set(this.visible().map((x) => x.authId))); }
  clearAll() { this.selected.set(new Set()); }
  apply(c: { apply: (ids: string[], t: string) => void }) { c.apply([...this.selected()], this.target()); this.ex.close(); }
}
