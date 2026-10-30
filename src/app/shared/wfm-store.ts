import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CaseRec } from '../data/case-pool';
import { WFM_QUEUES, WFM_STAFF, WfmRole, WfmStaff, wfmEligible, wfmQueueOf } from '../data/case-fields';
import { H, LINE_OPEN, Urgency, WorkLine, linesOf, poolOf, receivedOf, windowH } from '../data/wfm-work';
import { DashboardData } from '../data/dashboard-data';
import { Nav } from './nav';

// The supervisor the shell shows. Reviewer roles act as a named person instead (Role.wfmUser).
export const SUPERVISOR = 'Christina Lawson';
export const UNCLAIMED = '—';

/** What each role may do in the queues. Pulse Admin should own this matrix; these are the defaults. */
export interface WfmPerms { allQueues: boolean; othersWork: boolean; assignOthers: boolean; claimSelf: boolean; escalate: boolean; stepDue: boolean; }
export const WFM_PERMS: Record<'Supervisor' | WfmRole, WfmPerms> = {
  'Supervisor':            { allQueues: true,  othersWork: true,  assignOthers: true,  claimSelf: true, escalate: true,  stepDue: true },
  'L1 Nurse Reviewer':     { allQueues: false, othersWork: false, assignOthers: false, claimSelf: true, escalate: false, stepDue: false },
  'L2 Physician Reviewer': { allQueues: false, othersWork: false, assignOthers: false, claimSelf: true, escalate: true,  stepDue: false },
  'Correspondence':        { allQueues: false, othersWork: false, assignOthers: false, claimSelf: true, escalate: false, stepDue: false },
  'Intake Coordinator':    { allQueues: false, othersWork: false, assignOthers: false, claimSelf: true, escalate: false, stepDue: false },
};

/** A queue worklist's own filters. */
export type QfKey = 'plan' | 'urg' | 'state' | 'prio' | 'holder' | 'due';
export type QueueFilter = Partial<Record<QfKey, string[]>>;
export interface WorkState {
  /** Finding queues: by name, what the queue is (type, setting, product, specialty, role) and flags. */
  find: { q: string; type: string[]; setting: string[]; product: string[]; spec: string[]; role: string[]; pinned: boolean; breach: boolean; unclaimed: boolean };
  /** Each queue's own filters, by queue id. */
  qf: Record<string, QueueFilter>;
  qsort: Record<string, string>;
  split: boolean;
  cardSort: string;
}
export interface SavedView { name: string; state: WorkState; }
const EMPTY: WorkState = {
  find: { q: '', type: [], setting: [], product: [], spec: [], role: [], pinned: false, breach: false, unclaimed: false },
  qf: {}, qsort: {}, split: false, cardSort: 'volume',
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** A saved state over the defaults, so views saved before a field existed still load. */
const withDefaults = (x?: Partial<WorkState>): WorkState => {
  const e = clone(EMPTY), v = clone(x ?? {});
  return { ...e, ...v, find: { ...e.find, ...(v.find ?? {}) }, qf: v.qf ?? {}, qsort: v.qsort ?? {} };
};

/** One open line of work, with the session's changes applied. */
export interface Item { c: CaseRec; l: WorkLine; key: string; queue: string; holder: string; }
export interface CustodyEntry { at: number; authId: string; line: number; action: string; from: string; to: string; by: string; reason?: string; }
export const lineKey = (authId: string, no: number) => `${authId}#${no}`;
/** Unclaimed work this queue can hand out: a pool line (RX) waiting in its pool is not this queue's to assign. */
export const unclaimedHere = (i: Item) => i.holder === UNCLAIMED && !poolOf(i.l);

/** The L2 queue that MD review / peer-to-peer routes a line to. Specialized queues keep their queue. */
export function l2QueueOf(queueId: string): string {
  return queueId.startsWith('L1-') ? 'L2-' + queueId.slice(3) : queueId;
}

@Injectable({ providedIn: 'root' })
export class WfmStore {
  private nav = inject(Nav);
  private data = inject(DashboardData);

  // ---- who is acting, and what they may do
  readonly actor = computed(() => this.nav.role().wfmUser ?? SUPERVISOR);
  readonly me = computed<WfmStaff | undefined>(() => WFM_STAFF.find((s) => s.name === this.nav.role().wfmUser));
  readonly isReviewer = computed(() => !!this.me());
  readonly perms = computed(() => WFM_PERMS[this.me()?.role ?? 'Supervisor']);

  // ---- session changes layered over TruCare's data (these are the writes Pulse would send to 26.x)
  private readonly holders = signal<ReadonlyMap<string, string>>(new Map());
  /** Auth Owner: the person accountable for closing the authorization (um-03 addendum 01 §12.0). */
  private readonly owners = signal<ReadonlyMap<string, string>>(new Map());
  private readonly queueOv = signal<ReadonlyMap<string, string>>(new Map());
  private readonly stepOv = signal<ReadonlyMap<string, { at: number; reason: string }>>(new Map());
  private readonly urgOv = signal<ReadonlyMap<string, { u: Urgency; reason: string }>>(new Map());
  readonly custody = signal<CustodyEntry[]>([]);
  /** Work added this session to staff who aren't on the RN Workload roster. */
  private readonly staffAdds = signal<ReadonlyMap<string, number>>(new Map());

  /** Lines with urgency and step-due changes applied. Changing to Expedited clears line downgrades. */
  lines(c: CaseRec): WorkLine[] {
    const base = linesOf(c), u = this.urgOv().get(c.authId), steps = this.stepOv();
    if (!u && !base.some((l) => steps.has(lineKey(c.authId, l.no)))) return base;
    const received = receivedOf(c);
    return base.map((l) => {
      let x = l;
      if (u) {
        const sla = received + windowH(c.authId, u.u) * H;
        x = { ...x, urgency: u.u, downgraded: false, slaDue: sla, stepDue: Math.min(x.stepDue, sla) };
      }
      const s = steps.get(lineKey(c.authId, l.no));
      return s ? { ...x, stepDue: s.at } : x;
    });
  }
  /** A pool line (an RX line) starts queued in its pool; any other line starts with the case's holder. */
  holderOf(c: CaseRec, l: WorkLine) { return this.holders().get(lineKey(c.authId, l.no)) ?? (poolOf(l) ? UNCLAIMED : c.nurse); }
  ownerOf(c: CaseRec) { return this.owners().get(c.authId) ?? c.nurse; }
  queueOf(c: CaseRec, l: WorkLine) { return this.queueOv().get(lineKey(c.authId, l.no)) ?? wfmQueueOf(c); }
  /** Every open line of these cases, each in its queue with its holder. */
  items(cases: CaseRec[]): Item[] {
    const out: Item[] = [];
    for (const c of cases) for (const l of this.lines(c)) {
      if (!LINE_OPEN(l)) continue;
      out.push({ c, l, key: lineKey(c.authId, l.no), queue: this.queueOf(c, l), holder: this.holderOf(c, l) });
    }
    return out;
  }
  stepDueReason(c: CaseRec, l: WorkLine) { return this.stepOv().get(lineKey(c.authId, l.no))?.reason; }
  urgencyReason(authId: string) { return this.urgOv().get(authId)?.reason; }

  // ---- staff and load
  readonly staffLoads = computed(() => {
    const rns = new Map(this.data.nurses().map((n) => [n.name, n]));
    return WFM_STAFF.map((s) => {
      const rn = rns.get(s.name);
      if (rn) return { ...s, active: rn.active, utilization: rn.utilization, perCase: rn.active > 0 ? rn.utilization / rn.active : 3 };
      const active = (s.active ?? 0) + (this.staffAdds().get(s.name) ?? 0), cap = s.cap ?? 30;
      return { ...s, active, utilization: Math.min(100, Math.round((active / cap) * 100)), perCase: 100 / cap };
    });
  });

  // ---- actions (each is one custody-log entry per line, like 26.x's custody log)
  private log(items: Item[], action: string, to: (i: Item) => string, reason?: string) {
    const by = this.actor(), at = Date.now();
    this.custody.update((xs) => [...items.map((i) => ({ at, authId: i.c.authId, line: i.l.no, action, from: i.holder, to: to(i), by, reason })), ...xs]);
  }
  private setHolders(items: Item[], to: (i: Item) => string) {
    const h = new Map(this.holders()), adds = new Map(this.staffAdds());
    const rns = new Set(this.data.nurses().map((n) => n.name));
    // load counts authorizations, not lines: one person taking three lines of one request is one case
    const counted = new Set<string>();
    for (const i of items) {
      const who = to(i);
      h.set(i.key, who);
      if (who === UNCLAIMED || counted.has(`${i.c.authId}|${who}`)) continue;
      counted.add(`${i.c.authId}|${who}`);
      if (rns.has(who)) this.data.claimToNurse(null, null, who);
      else if (WFM_STAFF.some((s) => s.name === who)) adds.set(who, (adds.get(who) ?? 0) + 1);
    }
    this.holders.set(h); this.staffAdds.set(adds);
  }
  private history(action: string, detail: string, items: Item[], toStaff?: string) {
    const ids = [...new Set(items.map((i) => i.c.authId))];
    this.data.addHistory('swap', action, detail, this.actor(), { toStaff, members: [...new Set(items.map((i) => i.c.member))], refs: ids });
  }
  private n(items: Item[]) {
    const auths = new Set(items.map((i) => i.c.authId)).size;
    return `${auths} authorization(s), ${items.length} line(s)`;
  }

  /** Assign authorizations, one person each. The person becomes Auth Owner and takes the lines
   *  their role works; a pool line (RX) is not handed to them: it keeps a holder who works the pool,
   *  or stays queued in the pool. Returns how many lines stayed in a pool. */
  assignAuths(plan: { items: Item[]; to: string }[]): number {
    const give: { item: Item; to: string }[] = [];
    let pooled = 0;
    for (const p of plan) for (const item of p.items) (poolOf(item.l) ? pooled++ : give.push({ item, to: p.to }));
    // the assignee becomes Auth Owner when they take lines (or nobody owns it yet)
    const owners = new Map(this.owners());
    plan.forEach((p) => { const c = p.items[0].c; if (p.items.some((i) => !poolOf(i.l)) || this.ownerOf(c) === UNCLAIMED) owners.set(c.authId, p.to); });
    this.owners.set(owners);
    if (give.length) {
      const to = new Map(give.map((g) => [g.item.key, g.to])), items = give.map((g) => g.item);
      this.log(items, 'Assigned', (i) => to.get(i.key)!);
      this.setHolders(items, (i) => to.get(i.key)!);
    }
    const people = [...new Set(plan.map((p) => p.to))], all = plan.flatMap((p) => p.items);
    const pool = pooled ? `; ${pooled} RX line(s) left with the pharmacist pool` : '';
    this.history('Bulk assigned from WFM queue', `${this.n(all)} → ${people.join(', ')} (Auth Owner)${pool}`, all, people.length === 1 ? people[0] : undefined);
    return pooled;
  }
  claim(items: Item[]) {
    const me = this.actor();
    items = items.filter((i) => !poolOf(i.l)); // a pool line is claimed from its pool, not by the queue's role
    this.log(items, 'Claimed', () => me);
    this.setHolders(items, () => me);
    this.history('Claimed from WFM queue', `${this.n(items)} claimed by ${me}`, items, me);
  }
  release(items: Item[]) {
    this.log(items, 'Returned to queue', () => UNCLAIMED);
    this.setHolders(items, () => UNCLAIMED);
    this.history('Returned to queue', `${this.n(items)} returned to their queues`, items);
  }
  /** Route up: to the L2 queue for MD review or peer-to-peer (unclaimed there), or straight to a named MD. */
  route(items: Item[], target: 'MD Review' | 'Peer-to-Peer' | string, reason: string) {
    const md = target !== 'MD Review' && target !== 'Peer-to-Peer' ? target : null;
    const q = new Map(this.queueOv());
    items.forEach((i) => q.set(i.key, l2QueueOf(i.queue)));
    this.log(items, md ? 'Routed to MD' : `Routed to ${target}`, () => md ?? `${target} queue`, reason);
    this.queueOv.set(q);
    this.setHolders(items, () => md ?? UNCLAIMED);
    this.history('Escalated: routed up', `${this.n(items)} → ${md ?? target}${reason ? ` · ${reason}` : ''}`, items, md ?? undefined);
  }
  setStepDue(items: Item[], at: number, reason: string) {
    const m = new Map(this.stepOv());
    items.forEach((i) => m.set(i.key, { at, reason }));
    this.stepOv.set(m);
    this.log(items, 'Step due date changed', (i) => i.holder, reason);
    this.history('Escalated: step due date changed', `${this.n(items)} · step due ${new Date(at).toLocaleString()} · ${reason}`, items);
  }
  changeUrgency(items: Item[], u: Urgency, reason: string) {
    const m = new Map(this.urgOv());
    new Set(items.map((i) => i.c.authId)).forEach((id) => m.set(id, { u, reason }));
    this.urgOv.set(m);
    this.log(items, `Urgency changed to ${u}`, (i) => i.holder, reason);
    this.history('Escalated: urgency changed', `${this.n(items)} → ${u}; decision due date recalculated · ${reason}`, items);
  }

  // ---- saved views and pins, per user
  private key() { return `zyter-um-wfm-views-v1:${this.actor()}`; }
  readonly state = signal<WorkState>(clone(EMPTY));
  readonly views = signal<SavedView[]>([]);
  readonly defaultView = signal<string | null>(null);
  readonly activeView = signal<string | null>(null);
  readonly pins = signal<string[]>([]);
  /** The applied view has unsaved changes. */
  readonly viewDirty = computed(() => {
    const v = this.views().find((x) => x.name === this.activeView());
    return !!v && JSON.stringify(v.state) !== JSON.stringify(this.state());
  });

  constructor() {
    // Load the acting user's views whenever the role (and so the user) changes; on load the
    // default view applies, otherwise whatever they had last.
    effect(() => {
      const k = this.key();
      untracked(() => {
        let saved: { state?: WorkState; views?: SavedView[]; defaultView?: string | null; pins?: string[] } = {};
        try { saved = JSON.parse(localStorage.getItem(k) ?? '{}'); } catch { /* fresh */ }
        this.views.set(saved.views ?? []);
        this.defaultView.set(saved.defaultView ?? null);
        this.pins.set(saved.pins ?? []);
        const def = saved.views?.find((v) => v.name === saved.defaultView);
        this.state.set(withDefaults(def?.state ?? saved.state));
        this.activeView.set(def?.name ?? null);
      });
    });
    effect(() => {
      const payload = { state: this.state(), views: this.views(), defaultView: this.defaultView(), pins: this.pins() };
      const k = untracked(() => this.key());
      try { localStorage.setItem(k, JSON.stringify(payload)); } catch { /* storage unavailable: lasts for the session */ }
    });
  }
  patch(fn: (s: WorkState) => void) { const s = clone(this.state()); fn(s); this.state.set(s); }
  resetState() { this.state.set(clone(EMPTY)); this.activeView.set(null); }
  saveView(name: string) {
    const v = { name, state: clone(this.state()) };
    this.views.set([...this.views().filter((x) => x.name !== name), v].sort((a, b) => a.name.localeCompare(b.name)));
    this.activeView.set(name);
  }
  applyView(name: string) {
    const v = this.views().find((x) => x.name === name);
    if (v) { this.state.set(withDefaults(v.state)); this.activeView.set(name); }
  }
  deleteView(name: string) {
    this.views.set(this.views().filter((x) => x.name !== name));
    if (this.defaultView() === name) this.defaultView.set(null);
    if (this.activeView() === name) this.activeView.set(null);
  }
  togglePin(id: string) { const p = this.pins(); this.pins.set(p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); }

  /** Queues this user may see. */
  readonly visibleQueues = computed(() => {
    const me = this.me();
    return this.perms().allQueues || !me ? WFM_QUEUES : WFM_QUEUES.filter((q) => wfmEligible(me, q));
  });
}
