import { Component, DestroyRef, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WfmQueue, WFM_QUEUES, stateCodeOf, wfmEligible, wfmQueueOf, TODAY_ISO } from '../data/case-fields';
import { WfmQueueFilter, matchQueueFilter, planLabel, prioOf, qfCount } from './wfm-queue-filter';
import { H, dueLabel, dueTone, fmtDue, poolOf, tatText, tatTone } from '../data/wfm-work';
import { Item, QueueFilter, UNCLAIMED, WfmStore, unclaimedHere } from '../shared/wfm-store';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';

export { prioOf };
const stepOf = (i: Item) => (i.queue !== wfmQueueOf(i.c) ? 'MD Review' : i.c.status);
const PEOPLE_SHOWN = 5;
const PANELS_KEY = 'zyter-um-wfm-panels-v1';
function loadPanels(): { filters: boolean; people: boolean } {
  try { return { filters: true, people: true, ...JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') }; } catch { return { filters: true, people: true }; }
}

interface AuthRow { authId: string; items: Item[]; first: Item; tat: number; stepDue: number; driver: Item; }
type SortKey = 'tat' | 'step';

/** An opened queue: the place assignment happens. Left, this queue's filters. Middle, its work by
 *  authorization, presented by due date (TAT, the narrowest running line clock), each opening to its
 *  lines. Right, who can take it: the most available eligible people first, type-ahead for the rest.
 *  An authorization goes to one person, its Auth Owner; specialty-pool lines stay with their pool. */
@Component({
  selector: 'app-wfm-worklist',
  standalone: true,
  imports: [FormsModule, WfmQueueFilter],
  template: `
    <div class="band">
      <button class="back" (click)="back.emit()">← All queues</button>
      <div class="bt">
        <h3>{{ title }}</h3>
        <div class="bsub">@if (queue) { {{ queue.type }} · {{ queue.roles.join(', ') }} · {{ queue.scope }} } @else { Work held or owned by {{ store.actor() }} }</div>
      </div>
      <div class="stats">
        <div class="stat"><b>{{ stats().queued }}</b><span>queued</span></div>
        <div class="stat red"><b>{{ stats().overdue }}</b><span>TAT overdue</span></div>
        <div class="stat amber"><b>{{ stats().soon }}</b><span>TAT &lt; 24h</span></div>
        <div class="stat"><b>{{ stats().noOwner }}</b><span>no owner</span></div>
      </div>
      @if (queue) { <button class="pin" [class.on]="store.pins().includes(queue.id)" (click)="store.togglePin(queue.id)" title="Pin this queue">★</button> }
    </div>

    <div class="ws" [class.noRail]="!showRail()" [class.fMin]="!panels().filters" [class.pMin]="!panels().people">
      <!-- LEFT: this queue's filters (collapsible) -->
      @if (panels().filters) {
        <aside class="panel side">
          <div class="ph"><button class="col" (click)="setPanel('filters', false)" title="Collapse filters" aria-label="Collapse filters">«</button>
            <b>Filters</b>@if (fCount()) { <button class="link" (click)="clearF()">Clear all</button> }</div>
          <app-wfm-queue-filter [queueId]="queueId"></app-wfm-queue-filter>
          <div class="note">This queue only · saved for {{ store.actor() }}</div>
        </aside>
      } @else {
        <button class="rail" (click)="setPanel('filters', true)" title="Show filters" aria-label="Show filters">
          <span class="ri">»</span><span class="rl">Filters</span>@if (fCount()) { <span class="rb" title="Active filters">{{ fCount() }}</span> }
        </button>
      }

      <!-- MIDDLE: the work, by due date -->
      <section class="panel work">
        <div class="tools">
          <div class="srch"><span>⌕</span><input type="text" placeholder="Search auth ID, member, provider, service" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
          <div class="seg" title="Order">
            <button [class.on]="sort() === 'tat'" (click)="setSort('tat')">By TAT</button>
            <button [class.on]="sort() === 'step'" (click)="setSort('step')">By step due</button>
          </div>
          <label class="tog"><input type="checkbox" [ngModel]="byAuth()" (ngModelChange)="byAuth.set($event)" /> Group by authorization</label>
        </div>

        <div class="bulk" [class.on]="sel().size">
          <label class="selall"><input type="checkbox" [checked]="allSel()" (change)="toggleAll()" />
            @if (sel().size) { <b>{{ selAuths() }}</b>&nbsp;auth{{ selAuths() === 1 ? '' : 's' }} · {{ sel().size }} line{{ sel().size === 1 ? '' : 's' }} }
            @else { Select }</label>
          <span class="take">
            @for (n of [10, 25]; track n) { <button class="tk" (click)="take(n)">Next {{ n }} queued</button> }
            <button class="tk" (click)="takeQueued()">All queued</button></span>
          <span class="spacer"></span>
          @if (sel().size) {
            @if (store.perms().claimSelf && canClaimSel()) { <button class="btn sm" [class.primary]="store.isReviewer()" [class.outline]="!store.isReviewer()" (click)="claim(selItems())">{{ store.isReviewer() ? 'Claim' : 'Assign to me' }}</button> }
            @if (store.perms().escalate) { <button class="btn outline sm esc" (click)="escalate.emit(selItems())">Escalate</button> }
            @if (store.perms().assignOthers) { <button class="btn outline sm" (click)="routing.set(!routing())">Route to queue…</button> }
            <button class="btn outline sm" (click)="sel.set(none())">Clear</button>
          }
          <button class="btn outline sm" (click)="exportRows()">Export</button>
        </div>
        @if (routing() && sel().size) {
          <div class="route">
            <span>Route {{ sel().size }} line{{ sel().size === 1 ? '' : 's' }} to</span>
            <select [ngModel]="routeTo()" (ngModelChange)="routeTo.set($event)">
              <option value="">Choose a queue…</option>
              @for (q of routeTargets(); track q.id) { <option [value]="q.id">{{ q.name }}</option> }
            </select>
            <input type="text" placeholder="Reason" [ngModel]="routeWhy()" (ngModelChange)="routeWhy.set($event)" />
            <button class="btn primary sm" [disabled]="!routeTo()" (click)="route()">Route</button>
            <button class="btn outline sm" (click)="routing.set(false)">Cancel</button>
            <span class="mut">They arrive there queued, with no holder.</span>
          </div>
        }

        <div class="tbl">
          <table>
            <thead><tr>
              <th class="ck"></th>@if (byAuth()) { <th class="ck"></th> }
              <th>Authorization</th><th class="tatc">TAT</th><th>Step due</th><th>Urgency</th><th>{{ byAuth() ? 'Lines' : 'Line' }}</th><th>Step</th>
              @if (byAuth()) { <th>Auth owner</th><th>Clinical reviewer</th> } @else { <th>Held by</th> }
            </tr></thead>
            <tbody>
              @if (byAuth()) {
                @for (r of rows(); track r.authId) {
                  <tr class="arow" [class.sel]="authSel(r) === 'all'">
                    <td class="ck"><input type="checkbox" [checked]="authSel(r) === 'all'" [indeterminate]="authSel(r) === 'some'" (change)="toggleAuth(r)" /></td>
                    <td class="ck"><button class="exp" (click)="toggleOpen(r.authId)" [attr.aria-label]="'Lines of ' + r.authId">{{ open().has(r.authId) ? '▾' : '▸' }}</button></td>
                    <td><div class="aid">{{ r.authId }}</div><div class="sub">{{ r.first.c.member }} · {{ plan(r.first) }}</div></td>
                    <td class="tatc"><span class="tat" [attr.data-t]="ttone(r.tat)" [title]="'Driven by line ' + r.driver.l.no + ' · due ' + fmt(r.tat)">{{ tat(r.tat) }}</span></td>
                    <td><div class="d">{{ fmt(r.stepDue) }}</div><small [attr.data-t]="tone(r.stepDue)">{{ due(r.stepDue) }}</small></td>
                    <td><span class="urg" [class.exp]="r.first.l.urgency === 'Expedited'">{{ r.first.l.urgency }}</span></td>
                    <td><button class="lc" (click)="toggleOpen(r.authId)">{{ r.items.length }}</button></td>
                    <td class="mut">{{ step(r.first) }}</td>
                    <td>@if (owner(r) === unclaimed) { <span class="none">No owner</span> } @else { {{ owner(r) }} }
                      @if (store.isReviewer() && owner(r) === unclaimed) { <button class="mini" (click)="claim(r.items)">Claim</button> }</td>
                    <td>@if (reviewers(r); as rv) {
                      @if (rv.names.length === 1) { {{ rv.names[0] }} }
                      @else if (rv.names.length > 1) { <span class="multi" [title]="rv.detail">Multiple ({{ rv.names.length }})</span> }
                      @if (rv.queued) { <span class="qd" title="Open lines waiting in a queue; not counted as reviewers">{{ rv.queued }} queued</span> }
                    }</td>
                  </tr>
                  @if (open().has(r.authId)) {
                    @for (i of r.items; track i.key) {
                      <tr class="lrow" [class.sel]="sel().has(i.key)">
                        <td class="ck"></td>
                        <td class="ck"><input type="checkbox" [checked]="sel().has(i.key)" (change)="toggle(i.key)" /></td>
                        <td class="lname">Line {{ i.l.no }} · {{ i.l.type }}<div><b>{{ i.l.service }}</b> <span class="ls">{{ i.l.status }}</span></div></td>
                        <td class="tatc"><span class="tat" [attr.data-t]="ttone(i.l.slaDue)">{{ tat(i.l.slaDue) }}</span></td>
                        <td><div class="d">{{ fmt(i.l.stepDue) }}</div><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small>
                          @if (stepReason(i); as why) { <small class="why" [title]="why">moved: {{ why }}</small> }</td>
                        <td>{{ i.l.urgency }}@if (i.l.downgraded) { <span class="dg" title="Downgraded by a reviewer; this line runs on the standard clock">downgraded</span> }</td>
                        <td></td><td class="mut">{{ step(i) }}</td><td></td>
                        <td>@if (i.holder === unclaimed) { <span class="none">{{ pool(i) ? 'Queued · ' + pool(i) + ' pool' : 'Queued' }}</span> } @else { {{ i.holder }} }</td>
                      </tr>
                    }
                  }
                } @empty { <tr><td colspan="10" class="empty">No work matches this queue's filters.</td></tr> }
              } @else {
                @for (i of sortedItems(); track i.key) {
                  <tr class="arow" [class.sel]="sel().has(i.key)">
                    <td class="ck"><input type="checkbox" [checked]="sel().has(i.key)" (change)="toggle(i.key)" /></td>
                    <td><div class="aid">{{ i.c.authId }} · L{{ i.l.no }}</div><div class="sub">{{ i.c.member }} · {{ i.l.service }}</div></td>
                    <td class="tatc"><span class="tat" [attr.data-t]="ttone(i.l.slaDue)">{{ tat(i.l.slaDue) }}</span></td>
                    <td><div class="d">{{ fmt(i.l.stepDue) }}</div><small [attr.data-t]="tone(i.l.stepDue)">{{ due(i.l.stepDue) }}</small></td>
                    <td><span class="urg" [class.exp]="i.l.urgency === 'Expedited'">{{ i.l.urgency }}</span></td>
                    <td>{{ i.l.type }}</td><td class="mut">{{ step(i) }}</td>
                    <td>@if (i.holder === unclaimed) { <span class="none">{{ pool(i) ? 'Queued · ' + pool(i) + ' pool' : 'Queued' }}</span> } @else { {{ i.holder }} }</td>
                  </tr>
                } @empty { <tr><td colspan="8" class="empty">No work matches this queue's filters.</td></tr> }
              }
            </tbody>
          </table>
        </div>
        <div class="legend"><b>TAT</b> is the regulatory due: on an authorization, the earliest due among its open lines (the line that drives it shows on hover). ⚠ amber within 72 h, red within 24 h. <b>Step due</b> is the working due of the line's current step.</div>
      </section>

      <!-- RIGHT: who gets it (collapsible) -->
      @if (showRail() && !panels().people) {
        <button class="rail" (click)="setPanel('people', true)" title="Show assignees" aria-label="Show assignees">
          <span class="ri">«</span><span class="rl">Assign to</span>@if (sel().size) { <span class="rb" title="Selected authorizations">{{ selAuths() }}</span> }
        </button>
      }
      @if (showRail() && panels().people) {
        <aside class="panel side people">
          <div class="ph"><b>Assign to</b><span class="mut">{{ staff().length }} eligible</span>
            <button class="col" (click)="setPanel('people', false)" title="Collapse assignees" aria-label="Collapse assignees">»</button></div>
          <div class="srch sm"><span>⌕</span><input type="text" placeholder="Find a person" [ngModel]="who()" (ngModelChange)="who.set($event)" /></div>
          <div class="hint">@if (sel().size) { Click <b>Assign</b> to give the {{ selAuths() }} selected authorization{{ selAuths() === 1 ? '' : 's' }} to one person, or tick several and split. } @else { Select work, then pick who gets it. Most available first. }</div>
          <div class="plist">
            @for (s of shownStaff(); track s.name; let first = $first) {
              <div class="p" [class.on]="picked().has(s.name)">
                <input type="checkbox" [checked]="picked().has(s.name)" (change)="togglePick(s.name)" [attr.aria-label]="'Include ' + s.name + ' in a split'" />
                <div class="pm">
                  <div class="pr"><b>{{ s.name }}</b>@if (first && !who()) { <span class="rec">most available</span> }</div>
                  <div class="ps">{{ s.role }} · {{ s.states.join(', ') }}</div>
                  <div class="ubar"><span [style.width.%]="s.utilization" [attr.data-t]="utone(s.utilization)"></span>
                    @if (preview().get(s.name); as n) { <span class="proj" [style.width.%]="proj(s, n) - s.utilization"></span> }</div>
                  <div class="pu">{{ s.utilization }}% utilized@if (preview().get(s.name); as n) { → {{ proj(s, n) }}% } · {{ s.active }} active</div>
                </div>
                <button class="give" [disabled]="!fits(s.name)" (click)="giveTo(s.name)"
                  [title]="fits(s.name) ? 'Assign to ' + s.name : 'Licensed in ' + s.states.join(', ') + ' only'">Assign@if (fits(s.name)) { {{ fits(s.name) }}}</button>
              </div>
            } @empty { <div class="empty">No one matches.</div> }
          </div>
          @if (!who() && staff().length > shown) {
            <button class="more" (click)="seeAll.set(!seeAll())">{{ seeAll() ? 'Show fewer' : 'See all ' + staff().length }}</button>
          }
          <div class="split">
            <button class="btn primary sm" [disabled]="!sel().size || picked().size < 2" (click)="split()">Split across {{ picked().size >= 2 ? picked().size + ' people' : 'ticked people' }}</button>
            <span class="mut">Each authorization goes to one ticked person licensed in its state, the most available first.</span>
          </div>
        </aside>
      }
    </div>
  `,
  styles: [`
    :host { display:block; }
    .band { display:flex; align-items:center; gap:16px; padding:14px 18px; margin-bottom:14px; border-radius:var(--radius);
      background:linear-gradient(135deg, var(--teal-900), var(--teal-700)); color:#fff; box-shadow:var(--shadow); flex-wrap:wrap; }
    .back { border:1px solid rgba(255,255,255,.4); background:rgba(255,255,255,.1); color:#fff; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; }
    .back:hover { background:rgba(255,255,255,.2); }
    .bt { flex:1; min-width:220px; } .bt h3 { margin:0; font-size:17px; color:#fff; } .bsub { font-size:12px; opacity:.8; margin-top:2px; }
    .stats { display:flex; gap:8px; }
    .stat { background:rgba(255,255,255,.12); border-radius:10px; padding:6px 12px; min-width:72px; text-align:center; }
    .stat b { display:block; font-size:18px; line-height:1.1; } .stat span { font-size:10.5px; opacity:.85; }
    .stat.red b { color:#fecaca; } .stat.amber b { color:#fde68a; }
    .pin { border:none; background:none; font-size:20px; color:rgba(255,255,255,.4); cursor:pointer; } .pin.on { color:#fcd34d; }

    .ws { --fw: 230px; --pw: 300px; display:grid; grid-template-columns: var(--fw) minmax(0, 1fr) var(--pw); gap:14px; align-items:start; }
    .ws.fMin { --fw: 40px; } .ws.pMin { --pw: 40px; }
    .ws.noRail { grid-template-columns: var(--fw) minmax(0, 1fr); }
    @media (max-width: 1100px) { .ws, .ws.noRail { grid-template-columns: minmax(0, 1fr); } .rail { flex-direction:row; min-height:0; width:100%; } .rail .rl { writing-mode:horizontal-tb; transform:none; } }
    .col { border:1px solid var(--gray-200); background:#fff; color:var(--gray-500); border-radius:6px; width:24px; height:24px; font-size:13px; line-height:1; cursor:pointer; padding:0; }
    .col:hover { color:var(--teal-700); border-color:var(--teal-600); }
    .ph .col:first-child { margin-right:8px; } .ph b { flex:1; }
    .rail { position:sticky; top:8px; display:flex; flex-direction:column; align-items:center; gap:10px; width:40px; min-height:180px; padding:10px 0;
      border:1px solid var(--border); border-radius:var(--radius); background:#fff; box-shadow:var(--shadow); cursor:pointer; color:var(--teal-700); }
    .rail:hover { border-color:var(--teal-600); background:var(--teal-50); }
    .ri { font-size:14px; font-weight:700; }
    .rl { writing-mode:vertical-rl; transform:rotate(180deg); font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--ink-soft); }
    .rb { min-width:20px; height:20px; border-radius:999px; background:var(--teal-700); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; padding:0 5px; }
    .panel { background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:14px 16px; }
    .side { position:sticky; top:8px; }
    .ph { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:13.5px; color:var(--ink); }
    .link { border:none; background:none; color:var(--teal-700); font-size:11.5px; font-weight:600; cursor:pointer; padding:0; }
    .note, .mut { font-size:11px; color:var(--gray-500); } .note { margin-top:14px; padding-top:10px; border-top:1px solid var(--gray-100); }

    .tools { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
    .srch { display:flex; align-items:center; gap:6px; flex:1; min-width:220px; border:1px solid var(--gray-300); border-radius:8px; padding:0 10px; background:#fff; }
    .srch:focus-within { border-color:var(--teal-600); box-shadow:0 0 0 3px var(--teal-50); }
    .srch span { color:var(--gray-400); } .srch input { border:none; outline:none; padding:7px 0; font-size:12.5px; flex:1; min-width:0; background:transparent; }
    .srch.sm { flex:none; margin-bottom:8px; }
    .seg { display:flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg button { border:none; background:#fff; padding:6px 12px; font-size:12px; color:var(--ink-soft); cursor:pointer; }
    .seg button + button { border-left:1px solid var(--gray-300); } .seg button.on { background:var(--teal-700); color:#fff; font-weight:600; }
    .tog { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); cursor:pointer; } .tog input { accent-color:var(--teal-700); }

    .bulk { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; margin-bottom:8px; font-size:12px; color:var(--gray-500); background:var(--gray-50); flex-wrap:wrap; }
    .bulk.on { background:var(--teal-50); color:var(--teal-900); box-shadow:inset 0 0 0 1px var(--teal-600); }
    .selall { display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; } .selall input { accent-color:var(--teal-700); } .spacer { flex:1; }
    .take { display:flex; gap:4px; }
    .tk { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:3px 10px; font-size:11px; font-weight:600; color:var(--ink-soft); cursor:pointer; }
    .tk:hover { border-color:var(--teal-600); color:var(--teal-700); }
    .esc { color:var(--red,#c81e1e); border-color:#f3b4b4; }
    .route { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; margin:-2px 0 8px; border:1px solid var(--teal-600); border-radius:8px; font-size:12px; }
    .route select, .route input { border:1px solid var(--gray-300); border-radius:6px; padding:5px 8px; font-size:12px; }

    .tbl { overflow-x:auto; border:1px solid var(--gray-100); border-radius:8px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { position:sticky; top:0; background:var(--gray-50); text-align:left; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); padding:8px; border-bottom:1px solid var(--border); white-space:nowrap; }
    td { padding:8px; border-bottom:1px solid var(--gray-100); vertical-align:middle; }
    td:nth-last-child(-n+2) { white-space:nowrap; }
    tbody tr.arow:hover td { background:#f8fbfb; }
    .ck { width:22px; padding-right:0; } .ck input { accent-color:var(--teal-700); }
    .aid { font-weight:700; color:var(--teal-900); white-space:nowrap; } .sub { font-size:11px; color:var(--gray-500); white-space:nowrap; }
    td.mut { font-size:12px; }
    tr.sel td { background:var(--teal-50) !important; }
    .lrow td { background:#fafbfc; font-size:11.5px; } .lname b { color:var(--ink); }
    .ls { font-size:10px; font-weight:700; color:var(--gray-500); background:#fff; border:1px solid var(--border); border-radius:999px; padding:0 6px; margin-left:4px; }
    .exp, .lc { border:none; background:none; cursor:pointer; color:var(--teal-700); font-size:12px; padding:0; }
    .lc { min-width:22px; border-radius:999px; background:var(--gray-100); padding:1px 8px; font-weight:700; color:var(--ink-soft); }
    .urg { font-size:11px; color:var(--gray-500); } .urg.exp { color:#9a3412; font-weight:700; }
    .none { color:var(--amber-fg); font-weight:600; }
    .multi { text-decoration:underline dotted; cursor:help; }
    .qd { display:inline-block; font-size:10px; font-weight:700; color:var(--gray-500); background:var(--gray-100); border-radius:999px; padding:0 6px; margin-left:4px; }
    .mini { margin-left:6px; border:1px solid var(--teal-600); background:#fff; color:var(--teal-700); border-radius:6px; padding:0 8px; font-size:11px; font-weight:700; cursor:pointer; }
    .d { white-space:nowrap; } small { display:block; font-size:10.5px; white-space:nowrap; color:var(--gray-500); }
    small[data-t="red"] { color:var(--red,#c81e1e); } small[data-t="amber"] { color:var(--amber-fg); }
    .tatc { white-space:nowrap; }
    .tat { display:inline-block; font-variant-numeric:tabular-nums; font-weight:700; padding:3px 8px; border-radius:6px; background:var(--gray-100); color:var(--ink); cursor:help; }
    .tat[data-t="amber"] { background:#fef3c7; color:#92400e; } .tat[data-t="red"] { background:#fee2e2; color:#b91c1c; }
    .why { max-width:160px; overflow:hidden; text-overflow:ellipsis; }
    .dg { font-size:9.5px; font-weight:800; text-transform:uppercase; color:var(--gray-500); background:var(--gray-100); border-radius:3px; padding:0 4px; margin-left:4px; }
    .empty { text-align:center; color:var(--gray-500); padding:24px; font-size:12px; }
    .legend { font-size:11.5px; color:var(--gray-500); margin-top:10px; } .legend b { color:var(--ink-soft); }

    .hint { font-size:11.5px; color:var(--gray-500); margin-bottom:10px; }
    .plist { display:flex; flex-direction:column; gap:6px; max-height:56vh; overflow-y:auto; }
    .p { display:flex; gap:8px; align-items:center; border:1px solid var(--gray-200); border-radius:10px; padding:8px 10px; }
    .p:hover { border-color:var(--teal-100); } .p.on { border-color:var(--teal-600); background:var(--teal-50); }
    .p input { accent-color:var(--teal-700); }
    .pm { flex:1; min-width:0; } .pr { display:flex; align-items:center; gap:6px; font-size:12.5px; flex-wrap:wrap; } .pr b { white-space:nowrap; }
    .rec { font-size:9.5px; font-weight:700; color:var(--teal-700); background:var(--teal-100); border-radius:999px; padding:0 6px; white-space:nowrap; }
    .ps { font-size:10.5px; color:var(--gray-500); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ubar { display:flex; height:5px; border-radius:999px; background:var(--gray-200); overflow:hidden; margin:5px 0 2px; }
    .ubar > span[data-t="green"]{ background:var(--green); } .ubar > span[data-t="amber"]{ background:var(--amber); } .ubar > span[data-t="red"]{ background:var(--red); }
    .ubar > .proj { background:var(--teal-600); opacity:.5; }
    .pu { font-size:10.5px; color:var(--gray-500); }
    .give { border:none; background:var(--teal-700); color:#fff; border-radius:8px; padding:6px 10px; font-size:11.5px; font-weight:700; cursor:pointer; white-space:nowrap; }
    .give:hover { background:var(--teal-900); } .give[disabled] { background:var(--gray-100); color:var(--gray-400); cursor:default; }
    .more { margin-top:8px; width:100%; border:1px dashed var(--gray-300); background:#fff; border-radius:8px; padding:6px; font-size:12px; font-weight:600; color:var(--teal-700); cursor:pointer; }
    .split { display:flex; flex-direction:column; gap:6px; margin-top:12px; padding-top:12px; border-top:1px solid var(--gray-100); }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class WfmWorklist {
  readonly store = inject(WfmStore);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);
  readonly unclaimed = UNCLAIMED;
  readonly shown = PEOPLE_SHOWN;

  @Input({ required: true }) queueId!: string;
  /** The queue's definition (eligibility for the Assign to rail); absent for "My work". */
  @Input() queue?: WfmQueue;
  @Input() title = '';
  readonly allItems = signal<Item[]>([]);
  @Input() set items(v: Item[]) { this.allItems.set(v); }
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly escalate = new EventEmitter<Item[]>();

  /** Live clock for the TAT countdown (um-05 §6: counts down every second under 72 h). */
  readonly now = signal(Date.now());
  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  readonly q = signal('');
  readonly byAuth = signal(true);
  readonly open = signal<ReadonlySet<string>>(new Set());
  readonly sel = signal<ReadonlySet<string>>(new Set());
  none() { return new Set<string>(); }

  // ---- this queue's filters and order
  private readonly f = computed<QueueFilter>(() => this.store.state().qf[this.queueId] ?? {});
  readonly sort = computed(() => (this.store.state().qsort[this.queueId] === 'step' ? 'step' : 'tat') as SortKey);
  readonly fCount = computed(() => qfCount(this.f()));
  clearF() { this.store.patch((s) => { delete s.qf[this.queueId]; }); }
  setSort(v: SortKey) { this.store.patch((s) => { s.qsort[this.queueId] = v; }); }
  private match(i: Item): boolean {
    const text = this.q().trim().toLowerCase();
    return matchQueueFilter(this.f(), i, this.store.actor(), this.store.ownerOf(i.c))
      && (!text || [i.c.authId, i.c.member, i.c.provider, i.l.service].some((x) => x.toLowerCase().includes(text)));
  }
  readonly visibleItems = computed(() => this.allItems().filter((i) => this.match(i)));
  readonly rows = computed((): AuthRow[] => {
    const by = new Map<string, Item[]>();
    for (const i of this.visibleItems()) { if (!by.has(i.c.authId)) by.set(i.c.authId, []); by.get(i.c.authId)!.push(i); }
    const rows = [...by].map(([authId, items]) => {
      const driver = items.reduce((a, b) => (b.l.slaDue < a.l.slaDue ? b : a));
      return { authId, items, first: items[0], driver, tat: driver.l.slaDue, stepDue: Math.min(...items.map((i) => i.l.stepDue)) };
    });
    return rows.sort((a, b) => (this.sort() === 'step' ? a.stepDue - b.stepDue || a.tat - b.tat : a.tat - b.tat || a.stepDue - b.stepDue));
  });
  readonly sortedItems = computed(() => [...this.visibleItems()].sort((a, b) =>
    this.sort() === 'step' ? a.l.stepDue - b.l.stepDue : a.l.slaDue - b.l.slaDue));
  readonly stats = computed(() => {
    const now = Date.now(), rows = this.rows();
    return {
      queued: rows.filter((r) => r.items.some(unclaimedHere)).length,
      overdue: rows.filter((r) => r.tat < now).length,
      soon: rows.filter((r) => r.tat >= now && r.tat - now < 24 * H).length,
      noOwner: rows.filter((r) => this.store.ownerOf(r.first.c) === UNCLAIMED).length,
    };
  });

  // ---- selection (line keys; an authorization's box selects its visible open lines)
  selItems() { const s = this.sel(); return this.visibleItems().filter((i) => s.has(i.key)); }
  selAuths() { return new Set(this.selItems().map((i) => i.c.authId)).size; }
  allSel() { const v = this.visibleItems(); return v.length > 0 && v.every((i) => this.sel().has(i.key)); }
  toggleAll() { this.sel.set(this.allSel() ? new Set() : new Set(this.visibleItems().map((i) => i.key))); }
  toggle(k: string) { const s = new Set(this.sel()); s.has(k) ? s.delete(k) : s.add(k); this.sel.set(s); }
  /** The next n authorizations with queued lines, in the current order (soonest TAT first). */
  take(n: number) { this.sel.set(new Set(this.rows().filter((r) => r.items.some(unclaimedHere)).slice(0, n).flatMap((r) => r.items.filter(unclaimedHere).map((i) => i.key)))); }
  takeQueued() { this.sel.set(new Set(this.visibleItems().filter(unclaimedHere).map((i) => i.key))); }
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

  // ---- route to a different queue
  readonly routing = signal(false);
  readonly routeTo = signal('');
  readonly routeWhy = signal('');
  readonly routeTargets = computed(() => WFM_QUEUES.filter((q) => q.id !== this.queue?.id));
  route() {
    const items = this.selItems(), name = WFM_QUEUES.find((q) => q.id === this.routeTo())?.name;
    this.store.routeToQueue(items, this.routeTo(), this.routeWhy().trim());
    this.ix.toast(`${new Set(items.map((i) => i.c.authId)).size} authorization(s) routed to ${name}.`);
    this.routing.set(false); this.routeTo.set(''); this.routeWhy.set(''); this.sel.set(new Set());
  }

  // ---- Assign to: most available first, type-ahead, see all; one person per authorization
  readonly showRail = computed(() => !!this.queue && this.store.perms().assignOthers);

  // ---- collapsible side panels, remembered in this browser
  readonly panels = signal<{ filters: boolean; people: boolean }>(loadPanels());
  setPanel(k: 'filters' | 'people', open: boolean) {
    const next = { ...this.panels(), [k]: open };
    this.panels.set(next);
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* storage unavailable: lasts for the session */ }
  }
  readonly staff = computed(() => {
    const q = this.queue;
    return q ? this.store.staffLoads().filter((s) => wfmEligible(s, q)).sort((a, b) => a.utilization - b.utilization) : [];
  });
  readonly who = signal('');
  readonly seeAll = signal(false);
  readonly shownStaff = computed(() => {
    const t = this.who().trim().toLowerCase(), all = this.staff();
    if (t) return all.filter((s) => s.name.toLowerCase().includes(t) || s.role.toLowerCase().includes(t));
    const top = this.seeAll() ? all : all.slice(0, PEOPLE_SHOWN);
    // anyone ticked for a split stays visible
    return [...top, ...all.filter((s) => this.picked().has(s.name) && !top.includes(s))];
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
  /** Split plan, one person per authorization (never per line), soonest TAT first. */
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
  proj(s: { utilization: number; perCase: number }, n: number) { return Math.min(100, Math.round(s.utilization + n * s.perCase)); }
  utone(u: number) { return u >= 90 ? 'red' : u >= 75 ? 'amber' : 'green'; }

  /** Auth Owner and the Clinical Reviewer roll-up for a row (um-03 addendum 01 §12.0). */
  owner(r: AuthRow) { return this.store.ownerOf(r.first.c); }
  reviewers(r: AuthRow) {
    const held = r.items.filter((i) => i.holder !== UNCLAIMED);
    const names = [...new Set(held.map((i) => i.holder))];
    return { names, queued: r.items.length - held.length,
      detail: names.map((n) => `${n}: line ${held.filter((i) => i.holder === n).map((i) => i.l.no).join(', ')}`).join('\n') };
  }
  pool(i: Item) { return poolOf(i.l); }

  claim(items: Item[]) {
    const mine = items.filter((i) => i.holder !== this.store.actor());
    if (!this.store.perms().othersWork && mine.some((i) => i.holder !== UNCLAIMED)) { this.ix.toast('You can only claim queued work.', 'info'); return; }
    this.store.claim(mine);
    this.ix.toast(`${new Set(mine.map((i) => i.c.authId)).size} authorization(s) claimed by ${this.store.actor()}.`);
    this.sel.set(new Set());
  }

  exportRows() {
    const rows = (this.sel().size ? this.selItems() : this.sortedItems()).map((i) => [
      i.c.authId, i.l.no, i.l.type, i.l.service, i.c.member, this.plan(i), this.st(i), i.l.urgency + (i.l.downgraded ? ' (downgraded)' : ''),
      i.l.status, this.step(i), this.store.ownerOf(i.c) === UNCLAIMED ? 'No owner' : this.store.ownerOf(i.c),
      i.holder === UNCLAIMED ? 'Queued' : i.holder, fmtDue(i.l.stepDue), fmtDue(i.l.slaDue), prioOf(i),
    ] as (string | number)[]);
    this.exporter.open({
      title: `${this.title} — line items`, name: `${this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-lines${TODAY_ISO}`,
      columns: ['Auth ID', 'Line', 'Line type', 'Service', 'Member', 'Plan', 'State', 'Urgency', 'Line status', 'Step', 'Auth owner', 'Held by', 'Step due', 'TAT due', 'TAT status'],
      rows,
    });
  }

  plan(i: Item) { return planLabel(i.c.authId); }
  st(i: Item) { return stateCodeOf(i.c.authId); }
  step(i: Item) { return stepOf(i); }
  stepReason(i: Item) { return this.store.stepDueReason(i.c, i.l); }
  fmt(at: number) { return fmtDue(at); }
  due(at: number) { return dueLabel(at); }
  tone(at: number) { return dueTone(at); }
  tat(at: number) { return tatText(at, this.now()); }
  ttone(at: number) { return tatTone(at, this.now()); }
}
