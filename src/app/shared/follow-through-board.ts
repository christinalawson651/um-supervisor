import { Component, inject } from '@angular/core';
import { Icon } from './icon';
import { Donut, Segment } from './charts';
import { Interaction } from './interaction';
import { Members } from './members';
import { Exporter } from './exporter';
import { FollowThroughData } from './follow-through-data';
import { FollowThroughItem } from '../data/follow-through-pool';

const TYPE_COLORS: Record<string, string> = {
  'Follow-up Call': '#0d9488',
  'Notification Generation': '#2563eb',
  'Letter Completion': '#a855f7',
};

/**
 * Follow-Through Board — a shared, pull-based work surface for unskilled/support staff who
 * complete non-clinical follow-through (outreach calls, notifications, letters) that UM and CM
 * already triggered. Embedded as a tab in BOTH the UM and CM supervisor dashboards (shell.ts and
 * cm-dashboard.ts) against the same FollowThroughData singleton, so drawing an item from one
 * module's tab removes it from the other's view too — there is exactly one board, not two.
 */
@Component({
  selector: 'app-follow-through-board',
  standalone: true,
  imports: [Icon, Donut],
  template: `
    <div class="tab-head">
      <div><h2>Follow-Through Board</h2><span class="section-note">Non-clinical follow-through — outreach calls, notifications &amp; letters pulled from UM and CM</span></div>
      <button class="btn outline sm" (click)="exportBoard()"><z-icon name="download" [size]="13"></z-icon> Export</button>
    </div>

    <div class="ftb-cfg-row">
      <label class="sortsel">
        <span>Source</span>
        <div class="seg-toggle">
          <button [class.on]="data.sourceScope() === 'all'" (click)="data.sourceScope.set('all')">All Sources</button>
          <button [class.on]="data.sourceScope() === 'UM'" (click)="data.sourceScope.set('UM')">UM</button>
          <button [class.on]="data.sourceScope() === 'CM'" (click)="data.sourceScope.set('CM')">CM</button>
        </div>
      </label>
      <span class="ftb-cfg-note">Which modules feed this board is a client-level setting — shown here as a live toggle.</span>
    </div>

    <div class="ftb-kpis">
      <div class="ftb-kpi clk" (click)="openQueued()">
        <div class="ftb-ic" data-tone="blue"><z-icon name="inbox" [size]="17"></z-icon></div>
        <div><div class="ftb-val">{{ data.queued().length }}</div><div class="ftb-lab">Total Queued</div></div>
      </div>
      <div class="ftb-kpi">
        <div class="ftb-ic" data-tone="teal"><z-icon name="user" [size]="17"></z-icon></div>
        <div><div class="ftb-val">{{ data.myBoard().length }}</div><div class="ftb-lab">My Board</div></div>
      </div>
      <div class="ftb-kpi clk" (click)="openCompleted()">
        <div class="ftb-ic" data-tone="green"><z-icon name="check" [size]="17"></z-icon></div>
        <div><div class="ftb-val">{{ data.completed().length }}</div><div class="ftb-lab">Completed</div></div>
      </div>
      <div class="ftb-kpi clk" (click)="openDueOrOverdue()">
        <div class="ftb-ic" data-tone="red"><z-icon name="alert" [size]="17"></z-icon></div>
        <div><div class="ftb-val">{{ data.dueOrOverdue().length }}</div><div class="ftb-lab">Due Today / Overdue</div></div>
      </div>
    </div>

    <div class="ftb-overview">
      <z-donut [segments]="donutSegments()" [centerValue]="'' + data.queued().length" centerLabel="Queued"
        [clickable]="true" (segClick)="onDonutClick($event)"></z-donut>
      <div class="ftb-draw">
        <button class="draw-btn" (click)="drawNext()"><z-icon name="bolt" [size]="16"></z-icon> Draw Next</button>
        <div class="ftb-draw-note">Pulls the highest-priority, oldest-due item from the queues above.</div>
      </div>
    </div>

    <div class="tbl-head mt-6">
      <h3 class="sec-title">My Board ({{ data.myBoard().length }})</h3>
    </div>
    <div class="tablecard">
      <table class="z-table">
        <thead><tr><th>Task</th><th>Source</th><th>Member</th><th>Priority</th><th>Due</th><th>Drawn</th><th>Actions</th></tr></thead>
        <tbody>
          @for (i of data.myBoard(); track i.id) {
            <tr>
              <td class="strong">{{ i.detail }}<div class="sub">{{ i.taskType }}</div></td>
              <td><span class="badge" [class.blue]="i.sourceModule === 'UM'" [class.teal]="i.sourceModule === 'CM'">{{ i.sourceModule }}</span></td>
              <td><a class="ml" (click)="members.openByName(i.member)">{{ i.member }}</a></td>
              <td><span class="badge" [class.red]="i.priority === 'Urgent'" [class.gray]="i.priority === 'Standard'">{{ i.priority }}</span></td>
              <td>{{ i.dueDate }}</td>
              <td>{{ i.drawnAt }}</td>
              <td class="row-actions">
                <button class="btn outline teal sm" (click)="complete(i)">Complete</button>
                <button class="btn outline sm" (click)="returnItem(i)">Return</button>
                <button class="btn outline sm" (click)="openReassign(i)">Reassign</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">Nothing drawn yet — click "Draw Next" to pull your first item.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .ftb-cfg-row { display:flex; align-items:center; gap:14px; margin-bottom:16px; }
    .sortsel { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--gray-500); font-weight:600; }
    .ftb-cfg-note { font-size:11.5px; color:var(--gray-400); font-style:italic; }
    .seg-toggle { display:inline-flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg-toggle button { border:none; background:#fff; padding:7px 14px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .seg-toggle button.on { background:var(--teal-700); color:#fff; }

    .ftb-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
    .ftb-kpi { background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow);
      padding:14px 16px; display:flex; align-items:center; gap:12px; }
    .ftb-kpi.clk { cursor:pointer; transition:box-shadow .12s; }
    .ftb-kpi.clk:hover { box-shadow:0 4px 12px rgba(16,24,40,.10); }
    .ftb-ic { width:34px; height:34px; border-radius:9px; display:grid; place-items:center; background:#fff; border:1px solid var(--border); flex:0 0 34px; }
    .ftb-ic[data-tone="blue"] { background:var(--blue-bg); color:var(--blue-fg); }
    .ftb-ic[data-tone="teal"] { background:var(--teal-50); color:var(--teal-700); }
    .ftb-ic[data-tone="green"] { background:var(--green-bg); color:var(--green-fg); }
    .ftb-ic[data-tone="red"] { background:var(--red-bg); color:var(--red-fg); }
    .ftb-val { font-size:20px; font-weight:700; color:var(--ink); line-height:1.1; }
    .ftb-lab { font-size:11px; color:var(--gray-500); font-weight:600; margin-top:2px; }

    .ftb-overview { display:flex; align-items:center; gap:32px; background:#fff; border:1px solid var(--border);
      border-radius:var(--radius); box-shadow:var(--shadow); padding:18px 22px; margin-bottom:20px; flex-wrap:wrap; }
    .ftb-draw { display:flex; flex-direction:column; gap:8px; }
    .draw-btn { background:var(--teal-700); color:#fff; border:none; border-radius:8px; padding:11px 22px;
      font-weight:700; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; width:fit-content; }
    .draw-btn:hover { background:var(--teal-900); }
    .ftb-draw-note { font-size:11.5px; color:var(--gray-500); max-width:260px; }

    .tbl-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .sec-title { font-size:14px; font-weight:600; color:var(--ink); margin:0; }
    .tablecard { border:1px solid var(--border); border-radius:var(--radius); overflow:auto; background:#fff; }
    .sub { font-size:11px; color:var(--gray-500); margin-top:2px; }
    .ml { color:#2563eb; font-weight:600; cursor:pointer; } .ml:hover { text-decoration:underline; }
    .row-actions { display:flex; gap:6px; flex-wrap:wrap; }
    .empty { text-align:center; color:var(--gray-400); padding:24px !important; }
  `],
})
export class FollowThroughBoard {
  readonly data = inject(FollowThroughData);
  readonly members = inject(Members);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);

  donutSegments(): Segment[] {
    return this.data.byType().map((b) => ({ label: b.type, value: b.count, color: TYPE_COLORS[b.type], key: b.type }));
  }

  drawNext() {
    const item = this.data.drawNext();
    if (item) this.ix.toast(`Drew: ${item.detail}`, 'success');
    else this.ix.toast('No items available in the selected source scope.', 'info');
  }

  complete(i: FollowThroughItem) { this.data.complete(i.id); this.ix.toast('Marked complete.', 'success'); }
  returnItem(i: FollowThroughItem) { this.data.returnItem(i.id); this.ix.toast('Returned to queue.', 'info'); }

  openReassign(i: FollowThroughItem) {
    this.ix.choose({
      title: 'Reassign follow-through item',
      body: `${i.detail} — ${i.member}`,
      label: 'Assign to',
      options: this.data.staffRoster.filter((n) => n !== i.drawnBy),
      confirmLabel: 'Reassign',
      tone: 'teal',
      onChoose: (name) => { this.data.reassign(i.id, name); this.ix.toast(`Reassigned to ${name}.`, 'success'); },
    });
  }

  onDonutClick(seg: Segment) {
    this.openList(`Queued — ${seg.label}`, this.data.queued().filter((i) => i.taskType === seg.key));
  }
  openQueued() { this.openList('Total Queued', this.data.queued()); }
  openCompleted() { this.openList('Completed', this.data.completed()); }
  openDueOrOverdue() { this.openList('Due Today / Overdue', this.data.dueOrOverdue()); }

  private openList(title: string, rows: FollowThroughItem[]) {
    this.ix.openExplorer({
      title,
      context: `${rows.length} item(s)`,
      columns: ['Task', 'Type', 'Source', 'Member', 'Priority', 'Due', 'Status'],
      rows: rows.map((i) => [i.detail, i.taskType, i.sourceModule, i.member, i.priority, i.dueDate, i.status]),
      exportName: `follow-through_${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      memberColumn: 3,
    });
  }

  exportBoard() {
    const rows = this.data.scoped();
    this.exporter.open({
      title: 'Follow-Through Board',
      name: 'follow-through-board',
      columns: ['Task', 'Type', 'Source', 'Member', 'Priority', 'Due', 'Status', 'Assigned To'],
      rows: rows.map((i) => [i.detail, i.taskType, i.sourceModule, i.member, i.priority, i.dueDate, i.status, i.drawnBy ?? '—']),
    });
  }
}
