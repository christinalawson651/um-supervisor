import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WfmQueue, bhpOf, bhpProductOf, stateCodeOf, wfmEligible, wfmQueueOf, TODAY_ISO } from '../data/case-fields';
import { WfmQueueFilter, matchQueueFilter, prioOf, productLabel, qfCount } from './wfm-queue-filter';
import { NOW, dueLabel, dueTone, fmtDue, poolOf } from '../data/wfm-work';
import { Item, QueueFilter, UNCLAIMED, WfmStore, unclaimedHere } from '../shared/wfm-store';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';

export { prioOf };
const stepOf = (i: Item) => (i.queue !== wfmQueueOf(i.c) ? 'MD Review' : i.c.status);

interface AuthRow { authId: string; items: Item[]; first: Item; slaDue: number; stepDue: number; holder: string; }
type SortKey = 'sla' | 'step' | 'age' | 'member';

/** An opened queue: the place assignment happens. Left, the queue's own filters (saved per queue,
 *  per user). Middle, its work — one row per authorization that opens to its line items, Step due and
 *  SLA on every row — with search, sort and selection. Right, the people eligible for this queue with
 *  their load: tick work, then click a person, or tick several people and split it between them. */
@Component({
  selector: 'app-wfm-worklist',
  standalone: true,
  imports: [FormsModule, WfmQueueFilter],
  template: `
    <div class="wl-head">
      <button class="back" (click)="back.emit()">← All queues</button>
      <div class="wl-title"><h3>{{ title }}</h3>
        <span class="wl-sub">{{ rows().length }} authorization{{ rows().length === 1 ? '' : 's' }} · {{ visibleItems().length }} line{{ visibleItems().length === 1 ? '' : 's' }} · {{ unclaimedCount() }} unclaimed@if (queue) { · {{ queue.type }} · {{ queue.scope }} }</span></div>
      @if (queue) {
        <button class="pin" [class.on]="store.pins().includes(queue.id)" (click)="store.togglePin(queue.id)" title="Pin this queue">★</button>
      }
    </div>

    <div class="ws" [class.noRail]="!showRail()">
      <!-- LEFT: this queue's filters -->
      <aside class="side filters">
        <div class="sh"><b>Filters</b>@if (fCount()) { <button class="link" (click)="clearF()">Clear ({{ fCount() }})</button> }</div>
        <app-wfm-queue-filter class="stack" [queueId]="queueId" [items]="allItems()"></app-wfm-queue-filter>
        <div class="note">For this queue only · saved for {{ store.actor() }}</div>
      </aside>

      <!-- MIDDLE: the work -->
      <section class="work">
        <div class="tools">
          <input class="search" type="text" placeholder="Search auth, member, provider, service…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
          <label class="sortsel"><span>Sort</span>
            <select [ngModel]="sort()" (ngModelChange)="setSort($event)">
              <option value="sla">SLA due (soonest)</option><option value="step">Step due (soonest)</option>
              <option value="age">Longest waiting</option><option value="member">Member A–Z</option>
            </select></label>
          <label class="tog"><input type="checkbox" [ngModel]="byAuth()" (ngModelChange)="byAuth.set($event)" /> Group lines by authorization</label>
        </div>

        <div class="bulk" [class.on]="sel().size">
          <label class="selall"><input type="checkbox" [checked]="allSel()" (change)="toggleAll()" />
            @if (sel().size) { <b>{{ selAuths() }}</b>&nbsp;authorization{{ selAuths() === 1 ? '' : 's' }} · {{ sel().size }} line{{ sel().size === 1 ? '' : 's' }} selected }
            @else { Select all {{ visibleItems().length }} lines }</label>
          <span class="take">Take
            @for (n of [10, 25]; track n) { <button class="tk" (click)="take(n)">Top {{ n }}</button> }
            <button class="tk" (click)="takeUnclaimed()">All unclaimed</button></span>
          <span class="spacer"></span>
          @if (sel().size) {
            @if (store.perms().claimSelf && canClaimSel()) { <button class="btn sm" [class.primary]="store.isReviewer()" [class.outline]="!store.isReviewer()" (click)="claim(selItems())">{{ store.isReviewer() ? 'Claim' : 'Assign to me' }}</button> }
            @if (store.perms().escalate) { <button class="btn outline sm esc" (click)="escalate.emit(selItems())">Escalate selected</button> }
            @if (canRelease()) { <button class="btn outline sm" (click)="release(selItems())">Return to queue</button> }
            <button class="btn outline sm" (click)="sel.set(none())">Clear</button>
          }
          <button class="btn outline sm" (click)="exportRows()">Export</button>
        </div>

        <div class="tbl">
          <table>
            <thead><tr>
              <th class="ck"></th>@if (byAuth()) { <th class="ck"></th> }
              <th>Auth ID</th><th>Member</th><th>Plan</th><th>St</th><th>Urgency</th><th>{{ byAuth() ? 'Lines' : 'Line' }}</th>
              <th>Step</th>@if (byAuth()) { <th>Auth owner</th><th>Clinical reviewer</th> } @else { <th>Holder</th> }<th>Step due</th><th>SLA (decision due)</th>
            </tr></thead>
            <tbody>
              @if (byAuth()) {
                @for (r of rows(); track r.authId) {
                  <tr class="arow" [class.sel]="authSel(r) === 'all'">
                    <td class="ck"><input type="checkbox" [checked]="authSel(r) === 'all'" [indeterminate]="authSel(r) === 'some'" (change)="toggleAuth(r)" /></td>
                    <td class="ck"><button class="exp" (click)="toggleOpen(r.authId)">{{ open().has(r.authId) ? '▾' : '▸' }}</button></td>
                    <td class="aid">{{ r.authId }}</td><td>{{ r.first.c.member }}</td><td class="mut">{{ plan(r.first) }}</td><td>{{ st(r.first) }}</td>
                    <td>{{ r.first.l.urgency }}</td>
                    <td><button class="lc" (click)="toggleOpen(r.authId)">{{ r.items.length }} open line{{ r.items.length === 1 ? '' : 's' }}</button></td>
                    <td class="mut">{{ step(r.first) }}</td>
                    <td>@if (owner(r) === unclaimed) { <span class="un">Unassigned</span> } @else { {{ owner(r) }} }
                      @if (store.isReviewer() && owner(r) === unclaimed) { <button class="mini" (click)="claim(r.items)">Claim</button> }</td>
                    <td>@if (reviewers(r); as rv) {
                      @if (rv.names.length === 1) { {{ rv.names[0] }} }
                      @else if (rv.names.length > 1) { <span class="multi" [title]="rv.detail">Multiple ({{ rv.names.length }})</span> }
                      @else { <span class="mut">—</span> }
                      @if (rv.queued) { <span class="qd" title="Open lines waiting in a queue, not counted as reviewers">{{ rv.queued }} queued</span> }
                    }</td>
                    <td><span class="due" [attr.data-t]="tone(r.stepDue)">{{ fmt(r.stepDue) }}</span><small [attr.data-t]="tone(r.stepDue)">{{ due(r.stepDue) }}</small></td>
                    <td><span class="due" [attr.data-t]="tone(r.slaDue)">{{ fmt(r.slaDue) }}</span><small [attr.data-t]="tone(r.slaDue)">{{ due(r.slaDue) }}</small></td>
                  </tr>
                  @if (open().has(r.authId)) {
                    @for (i of r.items; track i.key) {
                      <tr class="lrow" [class.sel]="sel().has(i.key)">
                        <td class="ck"></td>
                        <td class="ck"><input type="checkbox" [checked]="sel().has(i.key)" (change)="toggle(i.key)" /></td>
                        <td colspan="4" class="lname">Line {{ i.l.no }} · {{ i.l.type }} · <b>{{ i.l.service }}</b> <span class="ls">{{ i.l.status }}</span></td>
                        <td>{{ i.l.urgency }}@if (i.l.downgraded) { <span class="dg" title="Downgraded by a reviewer; this line is on the standard clock">downgraded</span> }</td>
                        <td></td><td class="mut">{{ step(i) }}</td><td></td>
                        <td>@if (i.holder === unclaimed) { <span class="un">{{ pool(i) ? 'Queued · ' + pool(i) + ' pool' : 'Queued' }}</span> } @else { {{ i.holder }} }</td>
                        <td><span class="due" [attr.data-t]="tone(i.l.stepDue)">{{ fmt(i.l.stepDue) }}</span><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small>
                          @if (stepReason(i); as why) { <small class="why" [title]="why">moved: {{ why }}</small> }</td>
                        <td><span class="due" [attr.data-t]="tone(i.l.slaDue)">{{ fmt(i.l.slaDue) }}</span><small [attr.data-t]="tone(i.l.slaDue)">{{ due(i.l.slaDue) }}</small></td>
                      </tr>
                    }
                  }
                } @empty { <tr><td colspan="13" class="empty">No work matches.</td></tr> }
              } @else {
                @for (i of sortedItems(); track i.key) {
                  <tr class="arow" [class.sel]="sel().has(i.key)">
                    <td class="ck"><input type="checkbox" [checked]="sel().has(i.key)" (change)="toggle(i.key)" /></td>
                    <td class="aid">{{ i.c.authId }}</td><td>{{ i.c.member }}</td><td class="mut">{{ plan(i) }}</td><td>{{ st(i) }}</td>
                    <td>{{ i.l.urgency }}@if (i.l.downgraded) { <span class="dg">downgraded</span> }</td>
                    <td>L{{ i.l.no }} · {{ i.l.service }}</td><td class="mut">{{ step(i) }}</td>
                    <td>@if (i.holder === unclaimed) { <span class="un">{{ pool(i) ? 'Queued · ' + pool(i) + ' pool' : 'Unclaimed' }}</span> } @else { {{ i.holder }} }</td>
                    <td><span class="due" [attr.data-t]="tone(i.l.stepDue)">{{ fmt(i.l.stepDue) }}</span><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small></td>
                    <td><span class="due" [attr.data-t]="tone(i.l.slaDue)">{{ fmt(i.l.slaDue) }}</span><small [attr.data-t]="tone(i.l.slaDue)">{{ due(i.l.slaDue) }}</small></td>
                  </tr>
                } @empty { <tr><td colspan="11" class="empty">No work matches.</td></tr> }
              }
            </tbody>
          </table>
        </div>
        <div class="legend"><b>Step due</b> = due date for the current step on a line (a supervisor can move it, with a reason). <b>SLA</b> = the authorization's decision due date, set by urgency and receipt; an authorization's SLA is its earliest open line.</div>
      </section>

      <!-- RIGHT: who gets it -->
      @if (showRail()) {
        <aside class="side people">
          <div class="sh"><b>Assign to</b><span class="mut">{{ staff().length }} eligible</span></div>
          @if (sel().size) {
            <div class="hint">Click a person to give them the {{ selAuths() }} selected authorization{{ selAuths() === 1 ? '' : 's' }}, or tick several and split. Each authorization goes to one person, who becomes its Auth Owner; RX lines stay with the pharmacist pool.</div>
          } @else {
            <div class="hint">Select work in the list, then pick who gets it. Only people eligible for this queue by role and specialty are shown.</div>
          }
          <div class="plist">
            @for (s of staff(); track s.name; let first = $first) {
              <div class="p" [class.on]="picked().has(s.name)">
                <input type="checkbox" [checked]="picked().has(s.name)" (change)="togglePick(s.name)" [attr.aria-label]="'Include ' + s.name + ' in a split'" />
                <div class="pm">
                  <div class="pr"><b>{{ s.name }}</b>@if (first) { <span class="rec">most room</span> }</div>
                  <div class="ps">{{ s.role }} · {{ s.states.join(', ') }}</div>
                  <div class="ubar"><span [style.width.%]="s.utilization" [attr.data-t]="utone(s.utilization)"></span>
                    @if (preview().get(s.name); as n) { <span class="proj" [style.width.%]="proj(s, n) - s.utilization"></span> }</div>
                  <div class="pu">{{ s.utilization }}%@if (preview().get(s.name); as n) { → {{ proj(s, n) }}% } · {{ s.active }} active</div>
                </div>
                <button class="give" [disabled]="!fits(s.name)" (click)="giveTo(s.name)"
                  [title]="fits(s.name) ? 'Assign the selection to ' + s.name : 'Select work licensed in ' + s.states.join(' or ')">
                  {{ fits(s.name) ? 'Assign ' + fits(s.name) : 'Assign' }}</button>
              </div>
            } @empty { <div class="empty">No one is eligible for this queue.</div> }
          </div>
          <div class="split">
            <button class="btn primary sm" [disabled]="!sel().size || picked().size < 2" (click)="split()">
              Split across {{ picked().size || '' }} {{ picked().size === 1 ? 'person' : 'people' }}</button>
            <span class="mut">Each authorization goes to the ticked person licensed in its state with the most room.</span>
          </div>
        </aside>
      }
    </div>
  `,
  styles: [`
    :host { display:block; }
    .wl-head { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
    .back { border:1px solid var(--gray-300); background:#fff; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; color:var(--teal-700); }
    .wl-title { flex:1; } .wl-title h3 { margin:0; font-size:17px; } .wl-sub { font-size:12px; color:var(--gray-500); }
    .pin { border:none; background:none; font-size:20px; color:var(--gray-300); cursor:pointer; } .pin.on { color:#e3a008; }
    .ws { display:grid; grid-template-columns: 210px minmax(0, 1fr) 290px; gap:14px; align-items:start; }
    .ws.noRail { grid-template-columns: 210px minmax(0, 1fr); }
    @media (max-width: 1100px) { .ws, .ws.noRail { grid-template-columns: minmax(0, 1fr); } }
    .side, .work { background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:12px 14px; }
    .side { position:sticky; top:8px; }
    .sh { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; font-size:13px; }
    .link { border:none; background:none; color:var(--teal-700); font-size:11.5px; font-weight:600; cursor:pointer; padding:0; }
    .note, .mut { font-size:11px; color:var(--gray-500); } .note { margin-top:10px; }
    .tools { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; flex:1; min-width:200px; outline:none; } .search:focus { border-color:var(--teal-600); }
    .sortsel { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--gray-500); } .sortsel select { border:1px solid var(--gray-300); border-radius:8px; padding:6px 8px; font-size:12px; }
    .tog { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); cursor:pointer; }
    .bulk { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:8px; padding:7px 10px; border:1px dashed var(--gray-300); border-radius:8px; margin-bottom:8px; font-size:12px; color:var(--gray-500); background:#fff; flex-wrap:wrap; }
    .bulk.on { border:1px solid var(--teal-600); background:var(--teal-50); color:var(--teal-900); }
    .selall { display:flex; align-items:center; gap:8px; cursor:pointer; } .spacer { flex:1; }
    .take { display:flex; align-items:center; gap:4px; font-size:11px; }
    .tk { border:1px solid var(--gray-300); background:#fff; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:600; color:var(--ink-soft); cursor:pointer; }
    .tk:hover { border-color:var(--teal-600); color:var(--teal-700); }
    .esc { color:var(--red,#c81e1e); border-color:var(--red,#c81e1e); }
    .tbl { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { text-align:left; font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); padding:6px 8px; border-bottom:1px solid var(--border); white-space:nowrap; }
    td { padding:6px 8px; border-bottom:1px solid var(--gray-100); vertical-align:top; }
    .ck { width:22px; padding-right:0; } .aid { font-weight:700; color:var(--teal-900); white-space:nowrap; } td.mut { font-size:12px; }
    tr.sel td { background:var(--teal-50); }
    .lrow td { background:var(--gray-50); font-size:11.5px; } .lname b { color:var(--ink); }
    .ls { font-size:10px; font-weight:700; color:var(--gray-500); background:#fff; border:1px solid var(--border); border-radius:999px; padding:0 6px; margin-left:4px; }
    .exp, .lc { border:none; background:none; cursor:pointer; color:var(--teal-700); font-size:12px; padding:0; } .lc { text-decoration:underline dotted; }
    .un { color:var(--amber-fg); font-weight:600; }
    .multi { text-decoration:underline dotted; cursor:help; }
    .qd { display:inline-block; font-size:10px; font-weight:700; color:var(--gray-500); background:var(--gray-100); border-radius:999px; padding:0 6px; margin-left:4px; }
    .mini { margin-left:6px; border:1px solid var(--teal-600); background:#fff; color:var(--teal-700); border-radius:6px; padding:0 8px; font-size:11px; font-weight:700; cursor:pointer; }
    .due { display:block; white-space:nowrap; font-weight:600; } small { display:block; font-size:10.5px; white-space:nowrap; }
    [data-t="red"] { color:var(--red,#c81e1e); } [data-t="amber"] { color:var(--amber-fg); } small[data-t="green"] { color:var(--green-fg,#1e7b3a); }
    .why { color:var(--gray-500); max-width:160px; overflow:hidden; text-overflow:ellipsis; }
    .dg { font-size:9.5px; font-weight:800; text-transform:uppercase; color:var(--gray-500); background:var(--gray-100); border-radius:3px; padding:0 4px; margin-left:4px; }
    .empty { text-align:center; color:var(--gray-500); padding:20px; font-size:12px; }
    .legend { font-size:11.5px; color:var(--gray-500); margin-top:10px; } .legend b { color:var(--ink-soft); }
    .hint { font-size:11.5px; color:var(--gray-500); margin-bottom:10px; }
    .plist { display:flex; flex-direction:column; gap:6px; max-height:60vh; overflow-y:auto; }
    .p { display:flex; gap:8px; align-items:flex-start; border:1px solid var(--gray-200); border-radius:8px; padding:8px; }
    .p.on { border-color:var(--teal-600); background:var(--teal-50); }
    .pm { flex:1; min-width:0; } .pr { display:flex; align-items:center; gap:6px; font-size:12.5px; }
    .rec { font-size:9.5px; font-weight:700; color:var(--teal-700); background:var(--teal-100); border-radius:999px; padding:0 6px; }
    .ps { font-size:10.5px; color:var(--gray-500); }
    .ubar { display:flex; height:5px; border-radius:999px; background:var(--gray-200); overflow:hidden; margin:5px 0 2px; }
    .ubar > span[data-t="green"]{ background:var(--green); } .ubar > span[data-t="amber"]{ background:var(--amber); } .ubar > span[data-t="red"]{ background:var(--red); }
    .ubar > .proj { background:var(--teal-600); opacity:.5; }
    .pu { font-size:10.5px; color:var(--gray-500); }
    .give { align-self:center; border:none; background:var(--teal-700); color:#fff; border-radius:6px; padding:5px 9px; font-size:11.5px; font-weight:700; cursor:pointer; white-space:nowrap; }
    .give:hover { background:var(--teal-900); } .give[disabled] { background:var(--gray-200); color:var(--gray-500); cursor:default; }
    .split { display:flex; flex-direction:column; gap:6px; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class WfmWorklist {
  readonly store = inject(WfmStore);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);
  readonly unclaimed = UNCLAIMED;

  @Input({ required: true }) queueId!: string;
  /** The queue's definition (eligibility for the Assign to rail); absent for "My work". */
  @Input() queue?: WfmQueue;
  @Input() title = '';
  readonly allItems = signal<Item[]>([]);
  @Input() set items(v: Item[]) { this.allItems.set(v); }
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly escalate = new EventEmitter<Item[]>();

  readonly q = signal('');
  readonly byAuth = signal(true);
  readonly open = signal<ReadonlySet<string>>(new Set());
  readonly sel = signal<ReadonlySet<string>>(new Set());
  none() { return new Set<string>(); }

  // ---- this queue's filters (shared component; saved per queue in the user's view)
  private readonly f = computed<QueueFilter>(() => this.store.state().qf[this.queueId] ?? {});
  readonly sort = computed(() => (this.store.state().qsort[this.queueId] ?? 'sla') as SortKey);
  readonly fCount = computed(() => qfCount(this.f()));
  clearF() { this.store.patch((s) => { delete s.qf[this.queueId]; }); }
  setSort(v: string) { this.store.patch((s) => { s.qsort[this.queueId] = v; }); }
  private match(i: Item): boolean {
    const text = this.q().trim().toLowerCase();
    return matchQueueFilter(this.f(), i, this.store.actor())
      && (!text || [i.c.authId, i.c.member, i.c.provider, i.l.service].some((x) => x.toLowerCase().includes(text)));
  }
  readonly visibleItems = computed(() => this.allItems().filter((i) => this.match(i)));
  readonly unclaimedCount = computed(() => this.visibleItems().filter(unclaimedHere).length);
  private cmp(a: { slaDue: number; stepDue: number; member: string }, b: typeof a) {
    switch (this.sort()) {
      case 'step': return a.stepDue - b.stepDue;
      case 'age': return a.slaDue - b.slaDue; // received earliest = longest waiting; SLA tracks receipt
      case 'member': return a.member.localeCompare(b.member);
      default: return a.slaDue - b.slaDue;
    }
  }
  readonly rows = computed((): AuthRow[] => {
    const by = new Map<string, Item[]>();
    for (const i of this.visibleItems()) { if (!by.has(i.c.authId)) by.set(i.c.authId, []); by.get(i.c.authId)!.push(i); }
    const rows = [...by].map(([authId, items]) => {
      const holders = [...new Set(items.map((i) => i.holder))];
      return { authId, items, first: items[0], slaDue: Math.min(...items.map((i) => i.l.slaDue)), stepDue: Math.min(...items.map((i) => i.l.stepDue)),
        holder: holders.length === 1 ? holders[0] : `${holders.length} holders` };
    });
    return rows.sort((a, b) => this.cmp({ ...a, member: a.first.c.member }, { ...b, member: b.first.c.member }));
  });
  readonly sortedItems = computed(() =>
    [...this.visibleItems()].sort((a, b) => this.cmp({ slaDue: a.l.slaDue, stepDue: a.l.stepDue, member: a.c.member }, { slaDue: b.l.slaDue, stepDue: b.l.stepDue, member: b.c.member })));

  // ---- selection (line keys; an authorization's box selects its visible open lines)
  selItems() { const s = this.sel(); return this.visibleItems().filter((i) => s.has(i.key)); }
  selAuths() { return new Set(this.selItems().map((i) => i.c.authId)).size; }
  allSel() { const v = this.visibleItems(); return v.length > 0 && v.every((i) => this.sel().has(i.key)); }
  toggleAll() { this.sel.set(this.allSel() ? new Set() : new Set(this.visibleItems().map((i) => i.key))); }
  toggle(k: string) { const s = new Set(this.sel()); s.has(k) ? s.delete(k) : s.add(k); this.sel.set(s); }
  /** The first n unclaimed authorizations in the current sort, all their lines. */
  take(n: number) { this.sel.set(new Set(this.rows().filter((r) => r.items.some(unclaimedHere)).slice(0, n).flatMap((r) => r.items.filter(unclaimedHere).map((i) => i.key)))); }
  takeUnclaimed() { this.sel.set(new Set(this.visibleItems().filter(unclaimedHere).map((i) => i.key))); }
  authSel(r: AuthRow): 'all' | 'some' | 'none' {
    const n = r.items.filter((i) => this.sel().has(i.key)).length;
    return n === 0 ? 'none' : n === r.items.length ? 'all' : 'some';
  }
  toggleAuth(r: AuthRow) {
    const s = new Set(this.sel()), on = this.authSel(r) !== 'all';
    r.items.forEach((i) => (on ? s.add(i.key) : s.delete(i.key)));
    this.sel.set(s);
  }
  toggleOpen(id: string) { const s = new Set(this.open()); s.has(id) ? s.delete(id) : s.add(id); this.open.set(s); }
  canClaimSel() { return this.selItems().some((i) => i.holder !== this.store.actor()); }
  canRelease() {
    const me = this.store.actor(), items = this.selItems();
    return items.some((i) => i.holder !== UNCLAIMED) && (this.store.perms().assignOthers || items.every((i) => i.holder === me || i.holder === UNCLAIMED));
  }

  // ---- Assign to: eligible people, one-click give, or split across ticked people
  readonly showRail = computed(() => !!this.queue && this.store.perms().assignOthers);
  readonly staff = computed(() => {
    const q = this.queue;
    return q ? this.store.staffLoads().filter((s) => wfmEligible(s, q)).sort((a, b) => a.utilization - b.utilization) : [];
  });
  readonly picked = signal<ReadonlySet<string>>(new Set());
  togglePick(n: string) { const s = new Set(this.picked()); s.has(n) ? s.delete(n) : s.add(n); this.picked.set(s); }
  private selByAuth() {
    const by = new Map<string, Item[]>();
    this.selItems().forEach((i) => { if (!by.has(i.c.authId)) by.set(i.c.authId, []); by.get(i.c.authId)!.push(i); });
    return by;
  }
  /** How many selected authorizations this person is licensed for. */
  fits(name: string) {
    const s = this.staff().find((x) => x.name === name);
    return s ? [...this.selByAuth().keys()].filter((id) => s.states.includes(stateCodeOf(id))).length : 0;
  }
  /** Split plan, one person per authorization (never per line): each selected authorization goes to
   *  the ticked, licensed person with the lowest projected load, soonest SLA first. */
  private splitPlan(people: string[]) {
    const ppl = this.staff().filter((s) => people.includes(s.name));
    const load = new Map(ppl.map((s) => [s.name, s.utilization]));
    const out: { items: Item[]; to: string }[] = [];
    let left = 0;
    const auths = [...this.selByAuth()].sort((a, b) => Math.min(...a[1].map((i) => i.l.slaDue)) - Math.min(...b[1].map((i) => i.l.slaDue)));
    for (const [id, items] of auths) {
      const can = ppl.filter((s) => s.states.includes(stateCodeOf(id)));
      if (!can.length) { left++; continue; }
      const best = can.reduce((a, b) => (load.get(b.name)! < load.get(a.name)! ? b : a));
      out.push({ items, to: best.name });
      load.set(best.name, load.get(best.name)! + best.perCase);
    }
    return { out, left };
  }
  /** Per-person preview of what the current selection would add (the split when 2+ are ticked). */
  readonly preview = computed(() => {
    const m = new Map<string, number>();
    if (!this.sel().size || this.picked().size < 2) return m;
    this.splitPlan([...this.picked()]).out.forEach(({ to }) => m.set(to, (m.get(to) ?? 0) + 1));
    return m;
  });
  giveTo(name: string) { this.run([name], `to ${name}`); }
  split() { this.run([...this.picked()], `across ${this.picked().size} people`); }
  private run(people: string[], how: string) {
    const { out, left } = this.splitPlan(people);
    if (!out.length) { this.ix.toast('No selected work is in a state these people are licensed for.', 'info'); return; }
    const pooled = this.store.assignAuths(out);
    const extra = [left ? `${left} left: no one selected is licensed in their state.` : '', pooled ? `${pooled} RX line(s) stay with the pharmacist pool.` : ''].filter(Boolean).join(' ');
    this.ix.toast(`${out.length} authorization(s) assigned ${how}.${extra ? ' ' + extra : ''}`);
    this.sel.set(new Set());
  }
  /** Auth Owner and the Clinical Reviewer roll-up for a row (um-03 addendum 01 §12.0). */
  owner(r: AuthRow) { return this.store.ownerOf(r.first.c); }
  reviewers(r: AuthRow) {
    const held = r.items.filter((i) => i.holder !== UNCLAIMED);
    const names = [...new Set(held.map((i) => i.holder))];
    return { names, queued: r.items.length - held.length,
      detail: names.map((n) => `${n}: line ${held.filter((i) => i.holder === n).map((i) => i.l.no).join(', ')}`).join('\n') };
  }
  pool(i: Item) { return poolOf(i.l); }
  proj(s: { utilization: number; perCase: number }, n: number) { return Math.min(100, Math.round(s.utilization + n * s.perCase)); }
  utone(u: number) { return u >= 90 ? 'red' : u >= 75 ? 'amber' : 'green'; }

  claim(items: Item[]) {
    const mine = items.filter((i) => i.holder !== this.store.actor());
    if (!this.store.perms().othersWork && mine.some((i) => i.holder !== UNCLAIMED)) { this.ix.toast('You can only claim unclaimed work.', 'info'); return; }
    this.store.claim(mine);
    this.ix.toast(`${new Set(mine.map((i) => i.c.authId)).size} authorization(s) claimed by ${this.store.actor()}.`);
    this.sel.set(new Set());
  }
  release(items: Item[]) {
    const held = items.filter((i) => i.holder !== UNCLAIMED);
    this.store.release(held);
    this.ix.toast(`${held.length} line(s) returned to the queue.`);
    this.sel.set(new Set());
  }

  exportRows() {
    const rows = (this.sel().size ? this.selItems() : this.sortedItems()).map((i) => [
      i.c.authId, i.l.no, i.l.type, i.l.service, i.c.member, this.plan(i), this.st(i), i.l.urgency + (i.l.downgraded ? ' (downgraded)' : ''),
      i.l.status, this.step(i), i.holder === UNCLAIMED ? 'Unclaimed' : i.holder, fmtDue(i.l.stepDue), fmtDue(i.l.slaDue), prioOf(i),
    ] as (string | number)[]);
    this.exporter.open({
      title: `${this.title} — line items`, name: `${this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-lines${TODAY_ISO}`,
      columns: ['Auth ID', 'Line', 'Line type', 'Service', 'Member', 'Plan', 'State', 'Urgency', 'Line status', 'Step', 'Holder', 'Step due', 'SLA due', 'Priority'],
      rows,
    });
  }

  plan(i: Item) { return productLabel(bhpProductOf(bhpOf(i.c.authId))); }
  st(i: Item) { return stateCodeOf(i.c.authId); }
  step(i: Item) { return stepOf(i); }
  stepReason(i: Item) { return this.store.stepDueReason(i.c, i.l); }
  fmt(at: number) { return fmtDue(at); }
  due(at: number) { return dueLabel(at); }
  tone(at: number) { return dueTone(at); }
}
