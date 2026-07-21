import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Reassign, ReassignCase, ReassignNurse } from './reassign';

@Component({
  selector: 'app-reassign-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (rx.config(); as c) {
      <div class="scrim" (click)="rx.close()">
        <div class="panel" (click)="$event.stopPropagation()">
          <div class="ph">
            <div><h3>{{ c.title }}</h3><div class="psub">Select cases, review the recommendation, and reassign</div></div>
            <button class="x" (click)="rx.close()">×</button>
          </div>

          <div class="body">
            <!-- LEFT: cases -->
            <div class="col cases">
              <div class="col-head">
                <span class="ct">Cases <span class="cn">{{ selected().size }}/{{ filtered().length }}</span></span>
                <input class="search" type="text" placeholder="Search auth or member…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
              </div>
              <div class="qpills">
                @for (qn of queues; track qn) {
                  <button class="qp" [class.on]="queue() === qn" (click)="queue.set(qn)">{{ qn }}</button>
                }
              </div>
              <label class="selall"><input type="checkbox" [checked]="allSel()" (change)="toggleAll($event)" /> Select all ({{ filtered().length }})</label>
              <div class="clist">
                @for (cs of filtered(); track cs.authId) {
                  <label class="ci" [class.sel]="selected().has(cs.authId)">
                    <input type="checkbox" [checked]="selected().has(cs.authId)" (change)="toggle(cs.authId)" />
                    <div class="cmain"><b>{{ cs.authId }}</b> · {{ cs.member }}<div class="cmeta">{{ cs.queue }} · {{ cs.priority }} · {{ cs.owner }}</div></div>
                  </label>
                } @empty { <div class="empty">No cases match.</div> }
              </div>
            </div>

            <!-- RIGHT: target -->
            <div class="col target">
              <div class="col-head"><span class="ct">Assign to</span></div>
              @if (recommended(); as rec) {
                <button class="nrec" [class.on]="target() === rec.name" (click)="target.set(rec.name)">
                  <div class="nrow"><b>{{ rec.name }}</b><span class="recbadge">★ Recommended</span></div>
                  <div class="nmeta">Most capacity · {{ rec.active }} active</div>
                  <div class="ubar"><span [style.width.%]="rec.utilization" [attr.data-t]="tone(rec.utilization)"></span></div>
                  <div class="upct">{{ rec.utilization }}% utilized</div>
                </button>
              }
              <div class="ovr">Or override:</div>
              <div class="nlist">
                @for (n of others(); track n.name) {
                  <button class="ni" [class.on]="target() === n.name" (click)="target.set(n.name)">
                    <div class="nrow"><b>{{ n.name }}</b>
                      @if (n.utilization < 85) { <span class="cap">capacity</span> } @else { <span class="full">near full</span> }</div>
                    <div class="ubar"><span [style.width.%]="n.utilization" [attr.data-t]="tone(n.utilization)"></span></div>
                    <div class="upct">{{ n.utilization }}% · {{ n.active }} active</div>
                  </button>
                }
              </div>
            </div>
          </div>

          <div class="pf">
            <span class="fnote">@if (selected().size && target()) { Reassigning <b>{{ selected().size }}</b> case(s) → <b>{{ target() }}</b> }
              @else { Select at least one case and a target }</span>
            <span class="spacer"></span>
            <button class="btn outline" (click)="rx.close()">Cancel</button>
            <button class="btn primary" [disabled]="!selected().size || !target()" (click)="apply(c)">Reassign {{ selected().size || '' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.5); z-index:120; display:flex; align-items:center; justify-content:center; padding:3vh 3vw; }
    .panel { background:#fff; border-radius:14px; width:100%; max-width:960px; height:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.28); overflow:hidden; }
    .ph { display:flex; justify-content:space-between; align-items:flex-start; padding:18px 22px; border-bottom:1px solid var(--border); }
    .ph h3 { margin:0; font-size:17px; } .psub { font-size:12.5px; color:var(--gray-500); margin-top:4px; }
    .x { border:none; background:none; font-size:24px; color:var(--gray-400); cursor:pointer; }
    .body { flex:1; display:grid; grid-template-columns:1.4fr 1fr; gap:0; overflow:hidden; }
    .col { display:flex; flex-direction:column; overflow:hidden; padding:16px 20px; }
    .col.target { border-left:1px solid var(--border); background:var(--gray-50); }
    .col-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .ct { font-size:13px; font-weight:700; color:var(--ink); } .cn { color:var(--gray-500); font-weight:600; margin-left:4px; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:6px 10px; font-size:12.5px; width:180px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .qpills { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .qp { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:4px 10px; font-size:11px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .qp.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .selall { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:8px; cursor:pointer; }
    .clist { flex:1; overflow-y:auto; border:1px solid var(--gray-100); border-radius:8px; }
    .ci { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-bottom:1px solid var(--gray-100); cursor:pointer; font-size:12.5px; }
    .ci:last-child { border-bottom:none; } .ci.sel { background:var(--teal-50); }
    .cmain b { color:var(--teal-900); } .cmeta { font-size:11px; color:var(--gray-500); margin-top:2px; }
    .empty { padding:20px; text-align:center; color:var(--gray-500); }

    .nrec { text-align:left; width:100%; border:2px solid var(--teal-600); background:#fff; border-radius:10px; padding:12px 14px; cursor:pointer; margin-bottom:14px; }
    .nrec.on { background:var(--teal-50); }
    .recbadge { font-size:10.5px; font-weight:700; color:var(--teal-700); background:var(--teal-100); padding:2px 8px; border-radius:999px; }
    .nmeta { font-size:11.5px; color:var(--gray-500); margin:2px 0 8px; }
    .ovr { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:8px; }
    .nlist { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
    .ni { text-align:left; width:100%; border:1px solid var(--gray-300); background:#fff; border-radius:10px; padding:10px 12px; cursor:pointer; }
    .ni.on { border-color:var(--teal-600); background:var(--teal-50); }
    .nrow { display:flex; align-items:center; justify-content:space-between; }
    .nrow b { font-size:13px; color:var(--ink); }
    .cap { font-size:10.5px; font-weight:700; color:var(--green-fg); background:var(--green-bg); padding:2px 8px; border-radius:999px; }
    .full { font-size:10.5px; font-weight:700; color:var(--amber-fg); background:var(--amber-bg); padding:2px 8px; border-radius:999px; }
    .ubar { height:6px; border-radius:999px; background:var(--gray-200); overflow:hidden; margin:8px 0 4px; }
    .ubar > span { display:block; height:100%; border-radius:999px; }
    .ubar > span[data-t="green"]{ background:var(--green); } .ubar > span[data-t="amber"]{ background:var(--amber); } .ubar > span[data-t="red"]{ background:var(--red); }
    .upct { font-size:11px; color:var(--gray-500); }
    .pf { display:flex; align-items:center; gap:12px; padding:14px 22px; border-top:1px solid var(--border); }
    .fnote { font-size:12.5px; color:var(--gray-500); } .spacer { flex:1; }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class ReassignPanel {
  rx = inject(Reassign);
  readonly q = signal('');
  readonly queue = signal('All');
  readonly selected = signal<Set<string>>(new Set());
  readonly target = signal('');

  constructor() {
    effect(() => {
      const c = this.rx.config();
      // reset + default target to recommended when a new reassign opens
      this.q.set(''); this.queue.set('All'); this.selected.set(new Set());
      const rec = c ? [...c.nurses].sort((a, b) => a.utilization - b.utilization)[0] : null;
      this.target.set(rec ? rec.name : '');
    });
  }

  get queues() { const c = this.rx.config(); return ['All', ...Array.from(new Set((c?.cases ?? []).map((x) => x.queue)))]; }
  readonly filtered = computed(() => {
    const c = this.rx.config(); if (!c) return [];
    const query = this.q().trim().toLowerCase(); const qn = this.queue();
    return c.cases.filter((x) => (qn === 'All' || x.queue === qn) && (!query || x.authId.toLowerCase().includes(query) || x.member.toLowerCase().includes(query)));
  });
  readonly recommended = computed(() => { const c = this.rx.config(); return c ? [...c.nurses].sort((a, b) => a.utilization - b.utilization)[0] : null; });
  readonly others = computed(() => { const c = this.rx.config(); const rec = this.recommended(); return c ? c.nurses.filter((n) => n.name !== rec?.name).sort((a, b) => a.utilization - b.utilization) : []; });

  tone(u: number) { return u >= 90 ? 'red' : u < 80 ? 'green' : 'amber'; }
  toggle(id: string) { this.selected.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  allSel() { const f = this.filtered(); return f.length > 0 && f.every((x) => this.selected().has(x.authId)); }
  toggleAll(e: Event) { const on = (e.target as HTMLInputElement).checked; this.selected.set(on ? new Set(this.filtered().map((x) => x.authId)) : new Set()); }
  apply(c: { apply: (ids: string[], t: string) => void }) { c.apply([...this.selected()], this.target()); this.rx.close(); }
}
