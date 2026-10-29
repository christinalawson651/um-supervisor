import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BHP_BY, BHP_PRODUCTS, WFM_STATES, bhpOf, bhpProductOf, bhpStateOf, stateCodeOf, wfmQueueOf } from '../data/case-fields';
import { NOW, H, dueLabel, dueTone, fmtDue } from '../data/wfm-work';
import { Item, QfKey, QueueFilter, UNCLAIMED, WfmStore } from '../shared/wfm-store';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { TODAY_ISO } from '../data/case-fields';

/** Breached = past the SLA; At risk = step overdue or SLA inside a day; else Routine. */
export const prioOf = (i: Item) => (i.l.slaDue < NOW ? 'Breached' : i.l.stepDue < NOW || i.l.slaDue - NOW < 24 * H ? 'At risk' : 'Routine');
const productLabel = (id: string) => `${bhpStateOf(id) === 'Arizona' ? 'AZ' : 'FL'} · ${BHP_BY[id].name}`;
const stepOf = (i: Item) => (i.queue !== wfmQueueOf(i.c) ? 'MD Review' : i.c.status);

interface AuthRow { authId: string; items: Item[]; first: Item; slaDue: number; stepDue: number; holder: string; prio: string; }
type SortKey = 'sla' | 'step' | 'age' | 'member';

/** A queue's work, built for fast bulk assignment: search, sort and stacking filters (saved per
 *  queue in the user's view), one row per authorization that opens to its line items, both due dates
 *  on every row, and bulk Assign / Claim / Escalate / Return / Export on the selection. */
@Component({
  selector: 'app-wfm-worklist',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wl">
      <div class="wl-head">
        <button class="back" (click)="back.emit()">← All queues</button>
        <div class="wl-title"><h3>{{ title }}</h3>
          <span class="wl-sub">{{ rows().length }} authorization{{ rows().length === 1 ? '' : 's' }} · {{ visibleItems().length }} line{{ visibleItems().length === 1 ? '' : 's' }} · {{ unclaimedCount() }} unclaimed</span></div>
        @if (queueId !== '*mine*') {
          <button class="pin" [class.on]="store.pins().includes(queueId)" (click)="store.togglePin(queueId)" title="Pin this queue">★</button>
        }
      </div>

      <div class="wl-tools">
        <input class="search" type="text" placeholder="Search auth, member, provider, service…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <label class="sortsel"><span>Sort</span>
          <select [ngModel]="sort()" (ngModelChange)="setSort($event)">
            <option value="sla">SLA due (soonest)</option><option value="step">Step due (soonest)</option>
            <option value="age">Longest waiting</option><option value="member">Member A–Z</option>
          </select></label>
        <label class="tog"><input type="checkbox" [ngModel]="byAuth()" (ngModelChange)="byAuth.set($event)" /> Group lines by authorization</label>
        @if (fCount()) { <button class="btn outline sm" (click)="clearF()">Clear filters ({{ fCount() }})</button> }
      </div>
      <div class="wl-filters">
        @for (d of dims(); track d.key) {
          <div class="fg"><span class="fl">{{ d.label }}</span>
            @for (o of d.options; track o.id) {
              <button class="chip" [class.on]="has(d.key, o.id)" (click)="toggleF(d.key, o.id)">{{ o.label }}</button>
            }
          </div>
        }
      </div>

      <div class="bulk" [class.on]="sel().size">
        <label class="selall"><input type="checkbox" [checked]="allSel()" (change)="toggleAll()" />
          @if (sel().size) { <b>{{ selAuths() }}</b>&nbsp;authorization{{ selAuths() === 1 ? '' : 's' }} · {{ sel().size }} line{{ sel().size === 1 ? '' : 's' }} selected }
          @else { Select all {{ visibleItems().length }} lines }</label>
        <span class="spacer"></span>
        @if (sel().size) {
          @if (store.perms().assignOthers) { <button class="btn primary sm" (click)="assign.emit(selItems())">Assign…</button> }
          @if (store.perms().claimSelf && canClaimSel()) { <button class="btn sm" [class.primary]="!store.perms().assignOthers" [class.outline]="store.perms().assignOthers" (click)="claim(selItems())">{{ store.isReviewer() ? 'Claim' : 'Assign to me' }}</button> }
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
            <th>Step</th><th>Holder</th><th>Step due</th><th>SLA (decision due)</th>
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
                  <td>@if (r.holder === unclaimed) { <span class="un">Unclaimed</span> } @else { {{ r.holder }} }
                    @if (store.isReviewer() && r.holder === unclaimed) { <button class="mini" (click)="claim(r.items)">Claim</button> }</td>
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
                      <td></td><td class="mut">{{ step(i) }}</td>
                      <td>{{ i.holder === unclaimed ? 'Unclaimed' : i.holder }}</td>
                      <td><span class="due" [attr.data-t]="tone(i.l.stepDue)">{{ fmt(i.l.stepDue) }}</span><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small>
                        @if (stepReason(i); as why) { <small class="why" [title]="why">moved: {{ why }}</small> }</td>
                      <td><span class="due" [attr.data-t]="tone(i.l.slaDue)">{{ fmt(i.l.slaDue) }}</span><small [attr.data-t]="tone(i.l.slaDue)">{{ due(i.l.slaDue) }}</small></td>
                    </tr>
                  }
                }
              } @empty { <tr><td colspan="12" class="empty">No work matches.</td></tr> }
            } @else {
              @for (i of sortedItems(); track i.key) {
                <tr class="arow" [class.sel]="sel().has(i.key)">
                  <td class="ck"><input type="checkbox" [checked]="sel().has(i.key)" (change)="toggle(i.key)" /></td>
                  <td class="aid">{{ i.c.authId }}</td><td>{{ i.c.member }}</td><td class="mut">{{ plan(i) }}</td><td>{{ st(i) }}</td>
                  <td>{{ i.l.urgency }}@if (i.l.downgraded) { <span class="dg">downgraded</span> }</td>
                  <td>L{{ i.l.no }} · {{ i.l.service }}</td><td class="mut">{{ step(i) }}</td>
                  <td>{{ i.holder === unclaimed ? 'Unclaimed' : i.holder }}</td>
                  <td><span class="due" [attr.data-t]="tone(i.l.stepDue)">{{ fmt(i.l.stepDue) }}</span><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small></td>
                  <td><span class="due" [attr.data-t]="tone(i.l.slaDue)">{{ fmt(i.l.slaDue) }}</span><small [attr.data-t]="tone(i.l.slaDue)">{{ due(i.l.slaDue) }}</small></td>
                </tr>
              } @empty { <tr><td colspan="11" class="empty">No work matches.</td></tr> }
            }
          </tbody>
        </table>
      </div>
      <div class="legend"><b>Step due</b> = due date for the current step on a line (a supervisor can move it, with a reason). <b>SLA</b> = the authorization's decision due date, set by urgency and receipt; an authorization's SLA is its earliest open line.</div>
    </div>
  `,
  styles: [`
    .wl { background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:14px 16px; }
    .wl-head { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
    .back { border:1px solid var(--gray-300); background:#fff; border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer; color:var(--teal-700); }
    .wl-title { flex:1; } .wl-title h3 { margin:0; font-size:16px; } .wl-sub { font-size:12px; color:var(--gray-500); }
    .pin { border:none; background:none; font-size:20px; color:var(--gray-300); cursor:pointer; } .pin.on { color:#e3a008; }
    .wl-tools { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:280px; outline:none; } .search:focus { border-color:var(--teal-600); }
    .sortsel { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--gray-500); } .sortsel select { border:1px solid var(--gray-300); border-radius:8px; padding:6px 8px; font-size:12px; }
    .tog { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); cursor:pointer; }
    .wl-filters { display:flex; flex-wrap:wrap; gap:6px 16px; margin-bottom:10px; }
    .fg { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
    .fl { font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-right:2px; }
    .chip { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:2px 9px; font-size:11.5px; color:var(--gray-500); cursor:pointer; }
    .chip.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; font-weight:600; }
    .bulk { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:8px; padding:7px 10px; border:1px dashed var(--gray-300); border-radius:8px; margin-bottom:8px; font-size:12px; color:var(--gray-500); background:#fff; flex-wrap:wrap; }
    .bulk.on { border:1px solid var(--teal-600); background:var(--teal-50); color:var(--teal-900); }
    .selall { display:flex; align-items:center; gap:8px; cursor:pointer; } .spacer { flex:1; }
    .esc { color:var(--red,#c81e1e); border-color:var(--red,#c81e1e); }
    .tbl { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { text-align:left; font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); padding:6px 8px; border-bottom:1px solid var(--border); white-space:nowrap; }
    td { padding:6px 8px; border-bottom:1px solid var(--gray-100); vertical-align:top; }
    .ck { width:22px; padding-right:0; } .aid { font-weight:700; color:var(--teal-900); white-space:nowrap; } .mut { color:var(--gray-500); }
    tr.sel td { background:var(--teal-50); }
    .lrow td { background:var(--gray-50); font-size:11.5px; } .lname b { color:var(--ink); }
    .ls { font-size:10px; font-weight:700; color:var(--gray-500); background:#fff; border:1px solid var(--border); border-radius:999px; padding:0 6px; margin-left:4px; }
    .exp, .lc { border:none; background:none; cursor:pointer; color:var(--teal-700); font-size:12px; padding:0; } .lc { text-decoration:underline dotted; }
    .un { color:var(--amber-fg); font-weight:600; }
    .mini { margin-left:6px; border:1px solid var(--teal-600); background:#fff; color:var(--teal-700); border-radius:6px; padding:0 8px; font-size:11px; font-weight:700; cursor:pointer; }
    .due { display:block; white-space:nowrap; font-weight:600; } small { display:block; font-size:10.5px; white-space:nowrap; }
    [data-t="red"] { color:var(--red,#c81e1e); } [data-t="amber"] { color:var(--amber-fg); } small[data-t="green"] { color:var(--green-fg,#1e7b3a); }
    .why { color:var(--gray-500); max-width:160px; overflow:hidden; text-overflow:ellipsis; }
    .dg { font-size:9.5px; font-weight:800; text-transform:uppercase; color:var(--gray-500); background:var(--gray-100); border-radius:3px; padding:0 4px; margin-left:4px; }
    .empty { text-align:center; color:var(--gray-500); padding:20px; }
    .legend { font-size:11.5px; color:var(--gray-500); margin-top:10px; } .legend b { color:var(--ink-soft); }
  `],
})
export class WfmWorklist {
  readonly store = inject(WfmStore);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);
  readonly unclaimed = UNCLAIMED;

  @Input({ required: true }) queueId!: string;
  @Input() title = '';
  private readonly itemsSig = signal<Item[]>([]);
  @Input() set items(v: Item[]) { this.itemsSig.set(v); }
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly assign = new EventEmitter<Item[]>();
  @Output() readonly escalate = new EventEmitter<Item[]>();

  readonly q = signal('');
  readonly byAuth = signal(true);
  readonly open = signal<ReadonlySet<string>>(new Set());
  readonly sel = signal<ReadonlySet<string>>(new Set());
  none() { return new Set<string>(); }

  // ---- filters, saved per queue in the user's current view
  readonly dims = computed(() => {
    const plans = [...new Set(this.itemsSig().map((i) => bhpProductOf(bhpOf(i.c.authId))))];
    const holder = this.store.isReviewer() ? ['Unclaimed', 'Mine'] : ['Unclaimed', 'Assigned', 'Mine'];
    const o = (xs: string[]) => xs.map((x) => ({ id: x, label: x }));
    return [
      { key: 'holder' as QfKey, label: 'Holder', options: o(holder) },
      { key: 'due' as QfKey, label: 'Due', options: o(['SLA breached', 'SLA < 24h', 'Step overdue']) },
      { key: 'urg' as QfKey, label: 'Urgency', options: o(['Expedited', 'Standard']) },
      { key: 'prio' as QfKey, label: 'Priority', options: o(['Breached', 'At risk', 'Routine']) },
      { key: 'state' as QfKey, label: 'State', options: o(WFM_STATES) },
      { key: 'plan' as QfKey, label: 'Plan', options: BHP_PRODUCTS.filter((p) => plans.includes(p.id)).map((p) => ({ id: p.id, label: productLabel(p.id) })) },
    ];
  });
  private readonly f = computed<QueueFilter>(() => this.store.state().qf[this.queueId] ?? {});
  readonly sort = computed(() => (this.store.state().qsort[this.queueId] ?? 'sla') as SortKey);
  readonly fCount = computed(() => Object.values(this.f()).reduce((n, v) => n + (v?.length ?? 0), 0));
  has(k: QfKey, v: string) { return !!this.f()[k]?.includes(v); }
  toggleF(k: QfKey, v: string) {
    this.store.patch((s) => {
      const cur = s.qf[this.queueId] ?? {}, vals = cur[k] ?? [];
      cur[k] = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
      if (!cur[k]!.length) delete cur[k];
      if (Object.keys(cur).length) s.qf[this.queueId] = cur; else delete s.qf[this.queueId];
    });
    this.sel.set(new Set());
  }
  clearF() { this.store.patch((s) => { delete s.qf[this.queueId]; }); }
  setSort(v: string) { this.store.patch((s) => { s.qsort[this.queueId] = v; }); }

  private match(i: Item): boolean {
    const f = this.f(), me = this.store.actor();
    const any = (k: QfKey, ok: (v: string) => boolean) => !f[k]?.length || f[k]!.some(ok);
    const text = this.q().trim().toLowerCase();
    return any('holder', (v) => v === 'Unclaimed' ? i.holder === UNCLAIMED : v === 'Mine' ? i.holder === me : i.holder !== UNCLAIMED)
      && any('due', (v) => v === 'SLA breached' ? i.l.slaDue < NOW : v === 'SLA < 24h' ? i.l.slaDue >= NOW && i.l.slaDue - NOW < 24 * H : i.l.stepDue < NOW)
      && any('urg', (v) => v === i.l.urgency) && any('prio', (v) => v === prioOf(i)) && any('state', (v) => v === stateCodeOf(i.c.authId))
      && any('plan', (v) => v === bhpProductOf(bhpOf(i.c.authId)))
      && (!text || [i.c.authId, i.c.member, i.c.provider, i.l.service].some((x) => x.toLowerCase().includes(text)));
  }
  readonly visibleItems = computed(() => this.itemsSig().filter((i) => this.match(i)));
  readonly unclaimedCount = computed(() => this.visibleItems().filter((i) => i.holder === UNCLAIMED).length);
  private cmp(a: { slaDue: number; stepDue: number; age: number; member: string }, b: typeof a) {
    switch (this.sort()) {
      case 'step': return a.stepDue - b.stepDue;
      case 'age': return b.age - a.age;
      case 'member': return a.member.localeCompare(b.member);
      default: return a.slaDue - b.slaDue;
    }
  }
  readonly rows = computed((): AuthRow[] => {
    const by = new Map<string, Item[]>();
    for (const i of this.visibleItems()) { if (!by.has(i.c.authId)) by.set(i.c.authId, []); by.get(i.c.authId)!.push(i); }
    const rows = [...by].map(([authId, items]) => {
      const holders = [...new Set(items.map((i) => i.holder))];
      const r = { authId, items, first: items[0], slaDue: Math.min(...items.map((i) => i.l.slaDue)), stepDue: Math.min(...items.map((i) => i.l.stepDue)),
        holder: holders.length === 1 ? holders[0] : `${holders.length} holders`, prio: '' };
      r.prio = r.slaDue < NOW ? 'Breached' : r.stepDue < NOW ? 'At risk' : 'Routine';
      return r;
    });
    const k = (r: AuthRow) => ({ slaDue: r.slaDue, stepDue: r.stepDue, age: NOW - r.slaDue, member: r.first.c.member });
    return rows.sort((a, b) => this.cmp(k(a), k(b)));
  });
  readonly sortedItems = computed(() => {
    const k = (i: Item) => ({ slaDue: i.l.slaDue, stepDue: i.l.stepDue, age: NOW - i.l.slaDue, member: i.c.member });
    return [...this.visibleItems()].sort((a, b) => this.cmp(k(a), k(b)));
  });

  // ---- selection (line keys; an authorization's box selects its visible open lines)
  selItems() { const s = this.sel(); return this.visibleItems().filter((i) => s.has(i.key)); }
  selAuths() { return new Set(this.selItems().map((i) => i.c.authId)).size; }
  allSel() { const v = this.visibleItems(); return v.length > 0 && v.every((i) => this.sel().has(i.key)); }
  toggleAll() { this.sel.set(this.allSel() ? new Set() : new Set(this.visibleItems().map((i) => i.key))); }
  toggle(k: string) { const s = new Set(this.sel()); s.has(k) ? s.delete(k) : s.add(k); this.sel.set(s); }
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
  clearSelection() { this.sel.set(new Set()); }

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
