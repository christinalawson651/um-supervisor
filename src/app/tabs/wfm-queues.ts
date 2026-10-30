import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CASE_POOL } from '../data/case-pool';
import {
  WFM_QUEUES, WFM_ROLES, WFM_SPECIALTIES, WfmQueue, LOBS, TODAY_ISO,
  inPlanScope, lobOf, bandOf, ageH, urgencyOf, stateCodeOf,
} from '../data/case-fields';
import { NOW, dueLabel, dueTone } from '../data/wfm-work';
import { Item, UNCLAIMED, WfmStore, WorkState, unclaimedHere } from '../shared/wfm-store';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetActions } from '../shared/widget-actions';
import { WfmWorklist } from './wfm-worklist';
import { qfCount, qfSummary } from './wfm-queue-filter';
import { WfmEscalateDialog } from './wfm-escalate-dialog';

type FindList = 'type' | 'setting' | 'product' | 'spec' | 'role';
interface Card {
  key: string; queue: WfmQueue; lob?: string; name: string;
  auths: number; lines: number; mine: number; slaBreached: number; stepOverdue: number; soonest: number;
  buckets: { fresh: number; day2: number; over48: number; breach: number };
}

/** The UM queues: saved views, a queue finder and queue cards. Opening a queue opens its workspace,
 *  where that queue's filters and assignment live. Supervisors assign in bulk; reviewers see only the queues
 *  they may work and claim (cherry-pick) any item for themselves. */
@Component({
  selector: 'app-wfm-queues',
  standalone: true,
  imports: [FormsModule, WidgetActions, WfmWorklist, WfmEscalateDialog],
  template: `
    <!-- Saved views -->
    <div class="views">
      <span class="lab">View</span>
      <select [ngModel]="store.activeView() ?? ''" (ngModelChange)="pickView($event)">
        <option value="">{{ store.activeView() ? '— none —' : 'Unsaved view' }}</option>
        @for (v of store.views(); track v.name) { <option [value]="v.name">{{ v.name }}{{ store.defaultView() === v.name ? ' ★' : '' }}</option> }
      </select>
      @if (store.activeView(); as av) {
        @if (store.viewDirty()) { <button class="btn primary sm" (click)="store.saveView(av); ix.toast('View “' + av + '” updated.')">Save changes</button> }
        <button class="btn outline sm" [class.on]="store.defaultView() === av" (click)="store.defaultView.set(store.defaultView() === av ? null : av)"
          title="Open with this view">{{ store.defaultView() === av ? '★ Default' : '☆ Make default' }}</button>
        <button class="btn outline sm" (click)="store.deleteView(av)">Delete</button>
      }
      @if (naming()) {
        <input class="vname" type="text" placeholder="Name this view" [ngModel]="viewName()" (ngModelChange)="viewName.set($event)" (keydown.enter)="saveAs()" />
        <button class="btn primary sm" [disabled]="!viewName().trim()" (click)="saveAs()">Save</button>
        <button class="btn outline sm" (click)="naming.set(false)">Cancel</button>
      } @else {
        <button class="btn outline sm" (click)="naming.set(true); viewName.set('')">Save as new view…</button>
      }
      <button class="btn outline sm" (click)="store.resetState()">Reset</button>
      <span class="saved">✓ Saved for {{ store.actor() }}</span>
    </div>

    @if (openQueue(); as oq) {
      <app-wfm-worklist [queueId]="oq" [queue]="openDef()" [title]="worklistTitle()" [items]="worklistItems()"
        (back)="openQueue.set(null)" (escalate)="escItems.set($event)"></app-wfm-worklist>
    } @else {
      <!-- Queue finder -->
      <div class="finder">
        <input class="search" type="text" placeholder="Find a queue…" [ngModel]="st().find.q" (ngModelChange)="setFind('q', $event)" />
        @for (g of finderGroups; track g.key) {
          <span class="lab">{{ g.label }}</span>
          @for (v of g.values; track v) { <button class="chip" [class.on]="finderHas(g.key, v)" (click)="toggleFinder(g.key, v)">{{ v }}</button> }
        }
        @if (findActive()) { <button class="btn outline sm" (click)="clearFind()">Clear</button> }
      </div>
      <div class="finder">
        <span class="lab">Specialty</span>
        @for (v of specs; track v) { <button class="chip" [class.on]="finderHas('spec', v)" (click)="toggleFinder('spec', v)">{{ v }}</button> }
        @if (!store.isReviewer()) {
          <span class="lab">Role</span>
          @for (v of roles; track v) { <button class="chip" [class.on]="finderHas('role', v)" (click)="toggleFinder('role', v)">{{ v }}</button> }
        }
        <button class="chip" [class.on]="st().find.pinned" (click)="setFind('pinned', !st().find.pinned)">★ Pinned</button>
        <button class="chip" [class.on]="st().find.breach" (click)="setFind('breach', !st().find.breach)">Has SLA breaches</button>
        <button class="chip" [class.on]="st().find.unclaimed" (click)="setFind('unclaimed', !st().find.unclaimed)">Has unclaimed</button>
      </div>
      <div class="finder">
        <label class="sortsel"><span>Sort</span>
          <select [ngModel]="st().cardSort" (ngModelChange)="store.patch(s => s.cardSort = $event)">
            <option value="volume">Most unclaimed</option><option value="due">Soonest SLA</option>
            <option value="breach">Most SLA breaches</option><option value="name">Name A–Z</option>
          </select></label>
        <button class="btn outline sm" [class.on]="st().split" (click)="store.patch(s => s.split = !s.split)">{{ st().split ? 'Split by LOB ✓' : 'Split by LOB' }}</button>
        <span class="count">{{ cards().length }} of {{ store.visibleQueues().length }} queues</span>
      </div>
    }

    @if (!openQueue()) {
      <div class="qhint">
        @if (store.isReviewer()) { You see the queues your role, specialties and licensed states allow, with unclaimed work and your own. Open a queue and claim any item. }
        @else { Cards show <b>unclaimed authorizations available to pull next</b>. Bars show how long each has waited; click a band to see those authorizations. <b>Open a queue</b> to filter its work and assign it. }
      </div>

      <div class="cards">
        @if (store.isReviewer()) {
          <div class="card mine" (click)="openQueue.set('*mine*')">
            <div class="top"><span class="name">My work</span><span class="cnt">{{ myAuths() }}</span></div>
            <div class="meta">{{ myItems().length }} line{{ myItems().length === 1 ? '' : 's' }} held by {{ store.actor() }}</div>
            <button class="open" (click)="openQueue.set('*mine*'); $event.stopPropagation()">Open my work</button>
          </div>
        }
        @for (c of cards(); track c.key) {
          @if (!vis || !vis.isHidden(c.queue.id)) {
          <div class="card">
            @if (vis && store.perms().assignOthers) { <z-widget-actions (exportClick)="exportCard(c)" (removeClick)="vis.remove(c.queue.id)"></z-widget-actions> }
            <div class="top">
              <button class="pin" [class.on]="store.pins().includes(c.queue.id)" (click)="store.togglePin(c.queue.id)" title="Pin">★</button>
              <span class="name">{{ c.name }}</span>
              <span class="cnt">{{ c.auths }}</span>
            </div>
            <div class="meta">{{ c.lines }} line{{ c.lines === 1 ? '' : 's' }}@if (store.isReviewer()) { · {{ c.mine }} mine } · {{ c.queue.type }} · {{ c.queue.scope }}</div>
            <div class="flags">
              @if (c.slaBreached) { <span class="fl red">{{ c.slaBreached }} past SLA</span> }
              @if (c.stepOverdue) { <span class="fl amber">{{ c.stepOverdue }} past step due</span> }
              @if (c.auths) { <span class="fl" [attr.data-t]="tone(c.soonest)">next SLA {{ due(c.soonest) }}</span> }
            </div>
            @if (qfText(c.queue.id); as t) { <div class="qf" [title]="t">Queue filters: {{ t }}</div> }
            <div class="seg">
              <span class="s-fresh"  [style.width.%]="c.buckets.fresh"  title="0–24h in queue" (click)="openBucket(c, 'fresh')"></span>
              <span class="s-day2"   [style.width.%]="c.buckets.day2"   title="24–48h in queue" (click)="openBucket(c, 'day2')"></span>
              <span class="s-over48" [style.width.%]="c.buckets.over48" title="Over 48h in queue" (click)="openBucket(c, 'over48')"></span>
              <span class="s-breach" [style.width.%]="c.buckets.breach" title="Past SLA" (click)="openBucket(c, 'breach')"></span>
            </div>
            <div class="legend">
              <span (click)="openBucket(c, 'fresh')"><i class="d-fresh"></i>0-24h</span>
              <span (click)="openBucket(c, 'day2')"><i class="d-day2"></i>24-48h</span>
              <span (click)="openBucket(c, 'over48')"><i class="d-over48"></i>&gt;48h</span>
              <span (click)="openBucket(c, 'breach')"><i class="d-breach"></i>Breach</span>
            </div>
            <div class="acts">
              <button class="assign" (click)="openQueue.set(c.key)">{{ store.perms().assignOthers ? 'Open queue to assign' : 'Open queue' }}</button>
            </div>
          </div>
          }
        } @empty { <div class="empty">No queues match.</div> }
      </div>

      <details class="nip"><summary>Not considered for pilot (Medicare, 10 queues)</summary>
        <div>{{ notInPilot.join(' · ') }}</div></details>
    }

    <app-wfm-escalate-dialog [items]="escItems()" (close)="escItems.set([])" (done)="escItems.set([])"></app-wfm-escalate-dialog>
  `,
  styles: [`
    :host { display:block; }
    .views, .finder, .bar { display:flex; align-items:center; gap:6px 8px; flex-wrap:wrap; margin-bottom:10px; }
    .views { padding-bottom:10px; border-bottom:1px solid var(--border); }
    .views select, .sortsel select { border:1px solid var(--gray-300); border-radius:8px; padding:6px 8px; font-size:12px; }
    .vname { border:1px solid var(--teal-600); border-radius:8px; padding:6px 10px; font-size:12px; width:200px; outline:none; }
    .saved { margin-left:auto; font-size:11px; color:var(--teal-700); font-weight:600; }
    .lab { font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-left:6px; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:200px; outline:none; } .search:focus { border-color:var(--teal-600); }
    .chip { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:3px 10px; font-size:11.5px; color:var(--gray-500); cursor:pointer; }
    .chip.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; font-weight:600; }
    .btn.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .sortsel { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--gray-500); }
    .count { margin-left:auto; font-size:12px; font-weight:600; color:var(--gray-500); }
    .qf { font-size:11px; color:var(--teal-900); background:var(--teal-50); border-radius:6px; padding:2px 8px; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .bhp { font-size:11.5px; font-weight:600; color:var(--teal-900); background:var(--teal-50); border:1px solid var(--teal-100); border-radius:999px; padding:3px 10px; }
    .bulk { display:flex; align-items:center; gap:12px; margin:0 0 12px; padding:6px 12px; border:1px dashed var(--gray-300); border-radius:8px; font-size:12px; color:var(--gray-500); }
    .bulk.on { position:sticky; top:0; z-index:5; border:1px solid var(--teal-600); background:var(--teal-50); color:var(--teal-900); }
    .selall { display:flex; align-items:center; gap:8px; font-weight:600; cursor:pointer; } .spacer { flex:1; }
    .qhint { font-size:12px; color:var(--gray-500); margin-bottom:12px; } .qhint b { color:var(--ink-soft); }
    .cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:14px; }
    .card { position:relative; display:flex; flex-direction:column; background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:14px 16px; }
    .card:hover z-widget-actions { opacity:1; }
    .card.picked { border-color:var(--teal-600); box-shadow:0 0 0 2px var(--teal-100); }
    .card.mine { border-color:var(--teal-600); background:var(--teal-50); cursor:pointer; }
    .top { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
    .pick { margin:0; accent-color:var(--teal-700); cursor:pointer; }
    .pin { border:none; background:none; padding:0; font-size:15px; color:var(--gray-300); cursor:pointer; } .pin.on { color:#e3a008; }
    .name { flex:1; font-size:13.5px; font-weight:600; color:var(--ink); }
    .cnt { font-size:16px; font-weight:700; color:var(--ink); }
    .meta { font-size:11.5px; color:var(--gray-500); margin-bottom:6px; }
    .flags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; min-height:18px; }
    .fl { font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 7px; background:var(--gray-100); color:var(--gray-500); }
    .fl.red { background:#fde8e8; color:var(--red,#c81e1e); } .fl.amber { background:var(--amber-bg); color:var(--amber-fg); } .fl.teal { background:var(--teal-50); color:var(--teal-700); }
    .fl[data-t="red"] { color:var(--red,#c81e1e); } .fl[data-t="amber"] { color:var(--amber-fg); }
    .seg { display:flex; height:10px; border-radius:999px; overflow:hidden; background:var(--gray-100); cursor:pointer; }
    .seg span { display:block; height:100%; }
    .s-fresh { background:var(--green); } .s-day2 { background:var(--amber); } .s-over48 { background:#f97316; } .s-breach { background:var(--red); }
    .legend { display:flex; gap:10px; font-size:10.5px; color:var(--gray-500); margin-top:6px; } .legend span { cursor:pointer; display:flex; align-items:center; gap:3px; }
    .legend i { width:8px; height:8px; border-radius:2px; display:inline-block; }
    .d-fresh { background:var(--green); } .d-day2 { background:var(--amber); } .d-over48 { background:#f97316; } .d-breach { background:var(--red); }
    .acts { display:flex; gap:6px; margin-top:12px; }
    .open { flex:1; border:1px solid var(--teal-600); background:#fff; color:var(--teal-700); border-radius:8px; padding:6px 8px; font-size:12px; font-weight:700; cursor:pointer; }
    .assign { flex:1; border:none; background:var(--teal-700); color:#fff; border-radius:8px; padding:6px 8px; font-size:12px; font-weight:700; cursor:pointer; }
    .assign:hover { background:var(--teal-900); } .assign[disabled] { background:var(--gray-200); color:var(--gray-500); cursor:default; }
    .empty { grid-column:1/-1; text-align:center; padding:24px; color:var(--gray-500); font-size:13px; }
    .nip { margin-top:12px; font-size:12px; color:var(--gray-500); } .nip summary { cursor:pointer; font-weight:600; } .nip div { margin-top:6px; }
  `],
})
export class WfmQueues {
  readonly store = inject(WfmStore);
  readonly lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  readonly ix = inject(Interaction);
  private exporter = inject(Exporter);
  @Input() vis?: WidgetVisibility;

  readonly notInPilot = [
    'L1 - PH - IP - Medicare', 'L1 - PH - OP - Medicare', 'L1 - BH - IP - Medicare', 'L1 - BH - OP - Medicare',
    'L2 - PH - IP - Medicare', 'L2 - PH - OP - Medicare', 'L2 - BH - IP - Medicare', 'L2 - BH - OP - Medicare',
    'Corr - PH - OP - Medicare', 'Corr - BH - IP - Medicare',
  ];
  readonly specs = WFM_SPECIALTIES;
  readonly roles = WFM_ROLES;
  readonly finderGroups = [
    { key: 'type' as const, label: 'Type', values: ['General', 'Specialized'] },
    { key: 'setting' as const, label: 'Setting', values: ['IP', 'OP'] },
    { key: 'product' as const, label: 'Product', values: ['Medicaid', 'Marketplace'] },
  ];
  readonly st = this.store.state;
  readonly openQueue = signal<string | null>(null);
  readonly naming = signal(false);
  readonly viewName = signal('');
  readonly escItems = signal<Item[]>([]);
  // A different user (role switch) starts from their own queue list, not the last user's open worklist.
  private readonly onUser = effect(() => { this.store.actor(); this.openQueue.set(null); });
  none() { return new Set<string>(); }

  // ---- views
  pickView(name: string) { if (name) { this.store.applyView(name); this.openQueue.set(null); } else this.store.activeView.set(null); }
  saveAs() {
    const n = this.viewName().trim();
    if (!n) return;
    this.store.saveView(n); this.naming.set(false);
    this.ix.toast(`View “${n}” saved for ${this.store.actor()}.`);
  }

  // ---- finder and bar
  setFind<K extends keyof WorkState['find']>(k: K, v: WorkState['find'][K]) { this.store.patch((s) => { s.find[k] = v; }); }
  finderHas(k: FindList, v: string) { return this.st().find[k].includes(v); }
  readonly findActive = computed(() => { const f = this.st().find; return !!(f.q || f.type.length || f.setting.length || f.product.length || f.spec.length || f.role.length || f.pinned || f.breach || f.unclaimed); });
  clearFind() { this.store.patch((s) => { s.find = { q: '', type: [], setting: [], product: [], spec: [], role: [], pinned: false, breach: false, unclaimed: false }; }); }
  toggleFinder(k: FindList, v: string) {
    this.store.patch((s) => { const a = s.find[k]; s.find[k] = a.includes(v) ? a.filter((x) => x !== v) : [...a, v]; });
  }
  qfText(id: string) { return qfSummary(this.st().qf[id]); }
  /** All of a queue's work in scope, before its own filters (the filter offers plans from it). */
  queueItems(id: string) { return this.byQueue().get(id) ?? []; }

  /** Open lines in scope: the shell's Plans and Dates, and for a reviewer only unclaimed or their
   *  own work in the states they are licensed in. Each queue's own filters apply on top. */
  readonly items = computed((): Item[] => {
    const plans = this.lobFilter.value(), period = this.lookback.period();
    this.lookback.from(); this.lookback.to();
    const me = this.store.me(), actor = this.store.actor();
    const cases = CASE_POOL.filter((c) => c.phase === 'pending' && inPlanScope(c.authId, plans) && (period === '30d' || this.lookback.includes(c.submitted))
      && (!me || me.states.includes(stateCodeOf(c.authId))));
    return this.store.items(cases).filter((i) => this.store.perms().othersWork || i.holder === UNCLAIMED || i.holder === actor);
  });
  private queueOk(q: WfmQueue) {
    const s = this.st(), f = s.find;
    const t = f.q.trim().toLowerCase();
    return (!t || q.name.toLowerCase().includes(t)) && (!f.type.length || f.type.includes(q.type))
      && (!f.setting.length || f.setting.some((x) => q.setting.includes(x))) && (!f.product.length || f.product.some((x) => q.product.includes(x)))
      && (!f.pinned || this.store.pins().includes(q.id))
      && (!f.spec.length || q.spec.some((x) => f.spec.includes(x))) && (!f.role.length || q.roles.some((x) => f.role.includes(x)));
  }
  readonly byQueue = computed(() => {
    const m = new Map<string, Item[]>();
    for (const i of this.items()) { if (!m.has(i.queue)) m.set(i.queue, []); m.get(i.queue)!.push(i); }
    return m;
  });
  private card(q: WfmQueue, all: Item[], lob?: string): Card {
    const actor = this.store.actor();
    const items = lob ? all.filter((i) => lobOf(i.c.authId) === lob) : all;
    const un = items.filter(unclaimedHere);
    const auths = new Map<string, Item[]>();
    un.forEach((i) => { if (!auths.has(i.c.authId)) auths.set(i.c.authId, []); auths.get(i.c.authId)!.push(i); });
    const bands = { fresh: 0, day2: 0, over48: 0, breach: 0 };
    let slaBreached = 0, stepOverdue = 0, soonest = Infinity;
    for (const [id, xs] of auths) {
      const sla = Math.min(...xs.map((x) => x.l.slaDue)), step = Math.min(...xs.map((x) => x.l.stepDue));
      bands[bandOf(id, sla < NOW)]++;
      if (sla < NOW) slaBreached++; else if (step < NOW) stepOverdue++;
      soonest = Math.min(soonest, sla);
    }
    const n = auths.size || 1;
    return {
      key: lob ? `${q.id}|${lob}` : q.id, queue: q, lob, name: lob ? `${q.name} · ${lob}` : q.name,
      auths: auths.size, lines: un.length, mine: new Set(items.filter((i) => i.holder === actor).map((i) => i.c.authId)).size,
      slaBreached, stepOverdue, soonest,
      buckets: { fresh: Math.round(bands.fresh / n * 100), day2: Math.round(bands.day2 / n * 100), over48: Math.round(bands.over48 / n * 100), breach: Math.round(bands.breach / n * 100) },
    };
  }
  readonly cards = computed((): Card[] => {
    const s = this.st(), pins = this.store.pins();
    let list = this.store.visibleQueues().filter((q) => this.queueOk(q)).flatMap((q) => {
      const all = this.queueItems(q.id);
      return s.split ? LOBS.map((l) => this.card(q, all, l)).filter((c) => c.auths > 0) : [this.card(q, all)];
    });
    if (s.find.breach) list = list.filter((c) => c.slaBreached > 0);
    if (s.find.unclaimed) list = list.filter((c) => c.auths > 0);
    const sort = s.cardSort;
    return list.sort((a, b) => (+pins.includes(b.queue.id) - +pins.includes(a.queue.id))
      || (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'due' ? a.soonest - b.soonest : sort === 'breach' ? b.slaBreached - a.slaBreached : b.auths - a.auths));
  });

  // ---- reviewer: my work
  readonly myItems = computed(() => this.items().filter((i) => i.holder === this.store.actor()));
  myAuths() { return new Set(this.myItems().map((i) => i.c.authId)).size; }

  // ---- worklist
  private parse(key: string) { const [id, lob] = key.split('|'); return { id, lob }; }
  readonly worklistTitle = computed(() => {
    const k = this.openQueue();
    if (k === '*mine*') return `My work · ${this.store.actor()}`;
    if (!k) return '';
    const { id, lob } = this.parse(k);
    return `${WFM_QUEUES.find((q) => q.id === id)?.name ?? id}${lob ? ` · ${lob}` : ''}`;
  });
  readonly worklistItems = computed(() => {
    const k = this.openQueue();
    if (!k) return [];
    if (k === '*mine*') return this.myItems();
    const { id, lob } = this.parse(k);
    return (this.byQueue().get(id) ?? []).filter((i) => !lob || lobOf(i.c.authId) === lob);
  });

  readonly openDef = computed(() => { const k = this.openQueue(); return k && k !== '*mine*' ? WFM_QUEUES.find((q) => q.id === this.parse(k).id) : undefined; });

  // ---- drill and export
  openBucket(c: Card, band: string) {
    const labels: Record<string, string> = { fresh: '0–24h in queue', day2: '24–48h in queue', over48: '>48h in queue', breach: 'Breach (past SLA)' };
    const un = this.worklistFor(c).filter(unclaimedHere);
    const ids = [...new Set(un.map((i) => i.c.authId))].filter((id) => {
      const sla = Math.min(...un.filter((i) => i.c.authId === id).map((i) => i.l.slaDue));
      return bandOf(id, sla < NOW) === band;
    });
    const rows = ids.map((id) => {
      const xs = un.filter((i) => i.c.authId === id), c0 = xs[0].c;
      return [id, c0.member, c0.procedure, c0.provider, urgencyOf(c0), stateCodeOf(id), xs.length, dueLabel(Math.min(...xs.map((x) => x.l.stepDue))), dueLabel(Math.min(...xs.map((x) => x.l.slaDue)))] as (string | number)[];
    });
    this.ix.openExplorer({
      title: `${c.name} — ${labels[band]}`, context: `${rows.length} unclaimed authorization(s) in ${c.name} · ${labels[band]}`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'State', 'Open lines', 'Step due', 'SLA'],
      rows, exportName: `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${band}${TODAY_ISO}`, memberColumn: 1,
    });
  }
  private worklistFor(c: Card) { return this.queueItems(c.queue.id).filter((i) => !c.lob || lobOf(i.c.authId) === c.lob); }
  exportCard(c: Card) {
    this.exporter.open({
      title: c.name, name: `queue-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${TODAY_ISO}`, columns: ['Metric', 'Value'],
      rows: [['Unclaimed authorizations', c.auths], ['Unclaimed lines', c.lines], ['Past SLA', c.slaBreached], ['Past step due', c.stepOverdue],
        ['0-24h %', c.buckets.fresh], ['24-48h %', c.buckets.day2], ['>48h %', c.buckets.over48], ['Breach %', c.buckets.breach]],
    });
  }
  /** The tab's Export: every queue card in view. */
  exportAll() {
    this.exporter.open({
      title: 'UM queues', name: `um-queues${TODAY_ISO}`,
      columns: ['Queue', 'Type', 'Scope', 'Unclaimed authorizations', 'Unclaimed lines', 'Past SLA', 'Past step due', 'Next SLA'],
      rows: this.cards().map((c) => [c.name, c.queue.type, c.queue.scope, c.auths, c.lines, c.slaBreached, c.stepOverdue, c.auths ? dueLabel(c.soonest) : '—']),
    });
  }
  due(at: number) { return dueLabel(at); }
  tone(at: number) { return dueTone(at); }
}
