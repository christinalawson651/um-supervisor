import { Component, computed, effect, EventEmitter, Input, Output, signal, untracked } from '@angular/core';
import { WfmQueue, WfmStaff, wfmEligible } from '../data/case-fields';
import { dueLabel, dueTone } from '../data/wfm-work';

/** One row offered for bulk assignment: a whole authorization (its open lines go together) or a
 *  single line when the supervisor splits one out. authId is the row id; label is what shows. */
export interface AssignCase { label?: string; lines?: number; slaDue?: number; authId: string; member: string; queueId: string; urgency: string; state: string; ageH: number; priority: 'Breached' | 'At risk' | 'Routine'; }
/** A staff member with their current load, so the split can favour whoever has room. */
export interface StaffLoad extends WfmStaff { active: number; utilization: number; perCase: number; }
export interface AssignRequest { queues: WfmQueue[]; cases: AssignCase[]; }

const RANK = { Breached: 0, 'At risk': 1, Routine: 2 } as const;
type Pick = 'all' | 'breach' | 'risk' | 'exp';

/** Bulk manual assignment for WFM queues. Every unassigned case in the chosen queues (already
 *  narrowed by the tab's Plans, Dates, Urgency and State filters) starts selected, most urgent and
 *  oldest first. Staff are limited to those eligible by role and specialty; each case then goes to
 *  the selected person licensed in its state with the lowest projected load. */
@Component({
  selector: 'app-wfm-assign-panel',
  standalone: true,
  template: `
    @if (req; as r) {
      <div class="scrim" (click)="close.emit()">
        <div class="panel" (click)="$event.stopPropagation()">
          <div class="ph">
            <div>
              <h3>Assign {{ r.queues.length === 1 ? r.queues[0].name : r.queues.length + ' queues' }}</h3>
              @if (r.queues.length > 1) {
                <div class="qchips">@for (q of r.queues; track q.id) { <span class="qc">{{ q.name }}</span> }</div>
              }
            </div>
            <button class="x" (click)="close.emit()">×</button>
          </div>

          <div class="body">
            <div class="col">
              <div class="col-head">
                <span class="ct">Work <span class="cn">{{ selected().size }}/{{ shown().length }}</span></span>
                <div class="take">
                  <span class="tl">Take</span>
                  @for (n of takes; track n) { <button class="tk" (click)="take(n)">{{ n === 0 ? 'All' : 'Top ' + n }}</button> }
                  <button class="tk" (click)="selected.set(new0())">None</button>
                </div>
              </div>
              <div class="picks">
                @for (p of picks; track p.key) {
                  <button class="pk" [class.on]="pick() === p.key" (click)="setPick(p.key)">{{ p.label }} <b>{{ pickCount(p.key) }}</b></button>
                }
              </div>
              <div class="clist">
                @for (c of shown(); track c.authId) {
                  <label class="ci" [class.sel]="selected().has(c.authId)">
                    <input type="checkbox" [checked]="selected().has(c.authId)" (change)="toggle(c.authId)" />
                    <span class="cid">{{ c.label ?? c.authId }}</span>@if (c.lines && c.lines > 1) { <span class="cq">{{ c.lines }} lines</span> }
                    <span class="cmem">{{ c.member }}</span>
                    @if (r.queues.length > 1) { <span class="cq">{{ c.queueId }}</span> }
                    <span class="pr" [attr.data-p]="c.priority">{{ c.priority }}</span>
                    <span class="cm">{{ c.urgency === 'Expedited' ? 'Exp' : 'Std' }} · {{ c.state }}</span>@if (c.slaDue) { <span class="sla" [attr.data-t]="dtone(c.slaDue)">SLA {{ due(c.slaDue) }}</span> }
                    @if (plan().to.get(c.authId); as who) { <span class="to">→ {{ short(who) }}</span> }
                    @else if (selected().has(c.authId)) { <span class="to none">no eligible staff</span> }
                  </label>
                } @empty { <div class="empty">Nothing unclaimed in this scope.</div> }
              </div>
            </div>

            <div class="col target">
              <div class="col-head">
                <span class="ct">Assign to <span class="cn">{{ chosen().size }}/{{ eligible().length }}</span></span>
                <div class="take">
                  <button class="tk" (click)="chosen.set(allEligible())">All eligible</button>
                  <button class="tk" (click)="chosen.set(new0())">None</button>
                </div>
              </div>
              <div class="hint">Eligible by role and specialty. Each case goes to the selected person licensed in its state with the most room.</div>
              <div class="slist">
                @for (s of eligible(); track s.name) {
                  <label class="si" [class.on]="chosen().has(s.name)">
                    <input type="checkbox" [checked]="chosen().has(s.name)" (change)="toggleStaff(s.name)" />
                    <div class="sm">
                      <div class="srow"><b>{{ s.name }}</b>
                        @if (plan().adds.get(s.name); as n) { <span class="add">+{{ n }}</span> }
                      </div>
                      <div class="smeta">{{ s.role }} · {{ s.states.join(', ') }} · {{ s.skills.join(', ') }}</div>
                      <div class="ubar"><span [style.width.%]="s.utilization" [attr.data-t]="tone(s.utilization)"></span>
                        @if (plan().adds.get(s.name); as n) { <span class="proj" [style.width.%]="projected(s, n) - s.utilization"></span> }
                      </div>
                      <div class="upct">{{ s.utilization }}%@if (plan().adds.get(s.name); as n) { → {{ projected(s, n) }}% } · {{ s.active }} active</div>
                    </div>
                  </label>
                } @empty { <div class="empty">No staff are eligible for these queues.</div> }
              </div>
            </div>
          </div>

          <div class="pf">
            <span class="fnote">
              @if (plan().to.size) { <b>{{ plan().to.size }}</b> case(s) to <b>{{ plan().adds.size }}</b> {{ plan().adds.size === 1 ? 'person' : 'people' }} }
              @else { Select cases and at least one person }
              @if (plan().left) { · <span class="warn">{{ plan().left }} with no eligible staff licensed in their state</span> }
            </span>
            <span class="spacer"></span>
            <button class="btn outline" (click)="close.emit()">Cancel</button>
            <button class="btn primary" [disabled]="!plan().to.size" (click)="apply()">Assign {{ plan().to.size || '' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.5); z-index:120; display:flex; align-items:center; justify-content:center; padding:3vh 3vw; }
    .panel { background:#fff; border-radius:14px; width:100%; max-width:1080px; height:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.28); overflow:hidden; }
    .ph { display:flex; justify-content:space-between; align-items:flex-start; padding:16px 22px; border-bottom:1px solid var(--border); }
    .ph h3 { margin:0; font-size:17px; } .x { border:none; background:none; font-size:24px; color:var(--gray-400); cursor:pointer; }
    .qchips { display:flex; gap:4px; flex-wrap:wrap; margin-top:6px; }
    .qc { font-size:10.5px; font-weight:600; color:var(--teal-900); background:var(--teal-50); border:1px solid var(--teal-100); border-radius:999px; padding:1px 8px; }
    .body { flex:1; display:grid; grid-template-columns:1.5fr 1fr; overflow:hidden; }
    .col { display:flex; flex-direction:column; overflow:hidden; padding:14px 20px; }
    .col.target { border-left:1px solid var(--border); background:var(--gray-50); }
    .col-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
    .ct { font-size:13px; font-weight:700; color:var(--ink); } .cn { color:var(--gray-500); font-weight:600; margin-left:4px; }
    .take { display:flex; gap:4px; align-items:center; } .tl { font-size:11px; color:var(--gray-500); font-weight:600; margin-right:2px; }
    .tk { border:1px solid var(--gray-300); background:#fff; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:600; color:var(--ink-soft); cursor:pointer; }
    .tk:hover { border-color:var(--teal-600); color:var(--teal-700); }
    .picks { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
    .pk { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:3px 10px; font-size:11.5px; color:var(--gray-500); cursor:pointer; }
    .pk b { margin-left:2px; } .pk.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .clist, .slist { flex:1; overflow-y:auto; border:1px solid var(--gray-100); border-radius:8px; background:#fff; }
    .ci { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--gray-100); cursor:pointer; font-size:12px; white-space:nowrap; }
    .ci.sel { background:var(--teal-50); }
    .cid { font-weight:700; color:var(--teal-900); } .cmem { color:var(--ink-soft); overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
    .cq { font-size:10.5px; color:var(--gray-500); } .cm { font-size:11px; color:var(--gray-500); }
    .pr { font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; padding:1px 5px; border-radius:3px; background:var(--gray-100); color:var(--gray-500); }
    .pr[data-p="Breached"] { background:var(--red-bg, #fde8e8); color:var(--red, #c81e1e); } .pr[data-p="At risk"] { background:var(--amber-bg); color:var(--amber-fg); }
    .sla { font-size:10.5px; font-weight:700; } .sla[data-t="red"] { color:var(--red,#c81e1e); } .sla[data-t="amber"] { color:var(--amber-fg); } .sla[data-t="green"] { color:var(--green-fg,#1e7b3a); }
    .to { font-size:11px; font-weight:700; color:var(--teal-700); min-width:92px; text-align:right; } .to.none { color:var(--amber-fg); font-weight:600; }
    .hint { font-size:11px; color:var(--gray-500); margin-bottom:8px; }
    .slist { display:flex; flex-direction:column; }
    .si { display:flex; gap:10px; align-items:flex-start; padding:9px 12px; border-bottom:1px solid var(--gray-100); cursor:pointer; }
    .si.on { background:var(--teal-50); } .sm { flex:1; min-width:0; }
    .srow { display:flex; justify-content:space-between; font-size:12.5px; } .add { font-size:11px; font-weight:700; color:var(--teal-700); }
    .smeta { font-size:10.5px; color:var(--gray-500); margin-top:1px; }
    .ubar { display:flex; height:6px; border-radius:999px; background:var(--gray-200); overflow:hidden; margin:6px 0 3px; }
    .ubar > span[data-t="green"]{ background:var(--green); } .ubar > span[data-t="amber"]{ background:var(--amber); } .ubar > span[data-t="red"]{ background:var(--red); }
    .ubar > .proj { background:var(--teal-600); opacity:.45; }
    .upct { font-size:10.5px; color:var(--gray-500); }
    .empty { padding:20px; text-align:center; color:var(--gray-500); font-size:12.5px; }
    .pf { display:flex; align-items:center; gap:12px; padding:12px 22px; border-top:1px solid var(--border); }
    .fnote { font-size:12.5px; color:var(--gray-500); } .warn { color:var(--amber-fg); font-weight:600; } .spacer { flex:1; }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class WfmAssignPanel {
  private readonly reqSig = signal<AssignRequest | null>(null);
  private readonly staffSig = signal<StaffLoad[]>([]);
  @Input() set request(r: AssignRequest | null) { this.reqSig.set(r); }
  @Input() set staff(s: StaffLoad[]) { this.staffSig.set(s); }
  @Output() readonly assign = new EventEmitter<{ authId: string; to: string }[]>();
  @Output() readonly close = new EventEmitter<void>();
  get req() { return this.reqSig(); }

  readonly takes = [10, 25, 0];
  readonly picks: { key: Pick; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'breach', label: 'Breached' }, { key: 'risk', label: 'Breached + at risk' }, { key: 'exp', label: 'Expedited' },
  ];
  readonly pick = signal<Pick>('all');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly chosen = signal<ReadonlySet<string>>(new Set());

  /** Most urgent first, then oldest. */
  readonly sorted = computed(() => [...(this.reqSig()?.cases ?? [])].sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.slaDue ?? 0) - (b.slaDue ?? 0) || b.ageH - a.ageH));
  readonly shown = computed(() => this.sorted().filter((c) => this.matches(c, this.pick())));
  readonly eligible = computed(() => {
    const qs = this.reqSig()?.queues ?? [];
    return this.staffSig().filter((s) => qs.some((q) => wfmEligible(s, q))).sort((a, b) => a.utilization - b.utilization);
  });

  constructor() {
    // A new request starts with everything selected and every eligible person in the split.
    effect(() => {
      const r = this.reqSig();
      untracked(() => {
        this.pick.set('all');
        this.selected.set(new Set(r?.cases.map((c) => c.authId) ?? []));
        this.chosen.set(this.allEligible());
      });
    });
  }

  /** The split: each selected case to the eligible, state-licensed chosen person whose load would
   *  be lowest after taking it. Cases that nobody chosen can take are counted, not assigned. */
  readonly plan = computed(() => {
    const qs = new Map((this.reqSig()?.queues ?? []).map((q) => [q.id, q]));
    const people = this.eligible().filter((s) => this.chosen().has(s.name));
    const load = new Map(people.map((s) => [s.name, s.utilization]));
    const to = new Map<string, string>(), adds = new Map<string, number>();
    let left = 0;
    for (const c of this.shown()) {
      if (!this.selected().has(c.authId)) continue;
      const q = qs.get(c.queueId);
      const can = people.filter((s) => q && wfmEligible(s, q) && s.states.includes(c.state));
      if (!can.length) { left++; continue; }
      const best = can.reduce((a, b) => (load.get(b.name)! < load.get(a.name)! ? b : a));
      to.set(c.authId, best.name);
      adds.set(best.name, (adds.get(best.name) ?? 0) + 1);
      load.set(best.name, load.get(best.name)! + best.perCase);
    }
    return { to, adds, left };
  });

  new0() { return new Set<string>(); }
  allEligible() { return new Set(this.eligible().map((s) => s.name)); }
  private matches(c: AssignCase, p: Pick) {
    return p === 'all' || (p === 'breach' && c.priority === 'Breached') || (p === 'risk' && c.priority !== 'Routine') || (p === 'exp' && c.urgency === 'Expedited');
  }
  pickCount(p: Pick) { return this.sorted().filter((c) => this.matches(c, p)).length; }
  setPick(p: Pick) { this.pick.set(p); this.selected.set(new Set(this.shown().map((c) => c.authId))); }
  take(n: number) { this.selected.set(new Set((n ? this.shown().slice(0, n) : this.shown()).map((c) => c.authId))); }
  toggle(id: string) { const s = new Set(this.selected()); s.has(id) ? s.delete(id) : s.add(id); this.selected.set(s); }
  toggleStaff(name: string) { const s = new Set(this.chosen()); s.has(name) ? s.delete(name) : s.add(name); this.chosen.set(s); }
  projected(s: StaffLoad, n: number) { return Math.min(100, Math.round(s.utilization + n * s.perCase)); }
  tone(u: number) { return u >= 90 ? 'red' : u >= 75 ? 'amber' : 'green'; }
  short(name: string) { return name.replace(/,.*$/, ''); }
  due(at: number) { return dueLabel(at); }
  dtone(at: number) { return dueTone(at); }
  age(h: number) { return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`; }
  apply() { this.assign.emit([...this.plan().to].map(([authId, to]) => ({ authId, to }))); }
}
