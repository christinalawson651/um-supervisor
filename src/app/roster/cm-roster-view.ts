import { TODAY_ISO } from '../data/case-fields';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Icon } from '../shared/icon';
import { Overlays } from '../shared/overlays';
import { ExportDialog } from '../shared/export-dialog';
import { Interaction } from '../shared/interaction';
import { Exporter } from '../shared/exporter';
import { CmData } from '../shared/cm-data';
import { CARE_MANAGERS, CmCaseRec } from '../data/cm-case-pool';
import { buildRosterRows, RosterRow } from '../data/cm-roster';

type StatusFilter = 'all' | 'new' | 'overdue' | 'dueToday' | 'tomorrow';
type Scope = 'mine' | 'team';

function usernameOf(name: string): string {
  const [first, last] = name.split(',')[0].trim().split(' ');
  return `${first[0]}${last}`.toLowerCase() + '_cm';
}
function initialsOf(name: string): string {
  const [first, last] = name.split(',')[0].trim().split(' ');
  return `${first[0]}${last[0]}`.toUpperCase();
}

@Component({
  selector: 'app-cm-roster-view',
  standalone: true,
  imports: [FormsModule, Icon, Overlays, ExportDialog],
  template: `
    @if (careManager(); as cm) {
    <div class="roster-page">
      <header class="rhead">
        <div>
          <h1>Care Management Roster</h1>
          <p class="rsub">Manage your assigned cases and to-do's</p>
        </div>
        <div class="rhead-right">
          <button class="btn outline" (click)="exportRoster()"><z-icon name="download" [size]="14"></z-icon> Export</button>
          <label class="scope-sel">
            <select [ngModel]="scope()" (ngModelChange)="scope.set($event)">
              <option value="mine">My Roster</option>
              <option value="team">Team Roster — {{ cm.team }}</option>
            </select>
            <z-icon name="chevron" [size]="12"></z-icon>
          </label>
          <div class="user">
            <span class="avatar">{{ initials }}</span>
            <span class="uinfo"><b>{{ username }}</b><small>Cm</small></span>
          </div>
        </div>
      </header>

      <div class="kpis">
        <div class="ktile blue"><z-icon name="users" [size]="18"></z-icon><div><div class="kv">{{ rows().length }}</div><div class="kl">Members</div></div></div>
        <div class="ktile green"><z-icon name="inbox" [size]="18"></z-icon><div><div class="kv">{{ counts().new }}</div><div class="kl">New</div></div></div>
        <div class="ktile red"><z-icon name="alert" [size]="18"></z-icon><div><div class="kv">{{ counts().overdue }}</div><div class="kl">Overdue</div></div></div>
        <div class="ktile amber"><z-icon name="clock" [size]="18"></z-icon><div><div class="kv">{{ counts().dueToday }}</div><div class="kl">Due Today</div></div></div>
        <div class="ktile blue"><z-icon name="clock" [size]="18"></z-icon><div><div class="kv">{{ counts().tomorrow }}</div><div class="kl">Tomorrow</div></div></div>
        <div class="ktile purple"><z-icon name="building" [size]="18"></z-icon><div><div class="kv">{{ counts().adt }}</div><div class="kl">ADT</div></div></div>
      </div>

      <div class="toolbar">
        <div class="filter-wrap">
          <button class="btn outline" (click)="filterOpen.set(!filterOpen())"><z-icon name="filter" [size]="14"></z-icon> Filter{{ statusFilter() !== 'all' ? ' · ' + filterLabel(statusFilter()) : '' }}</button>
          @if (filterOpen()) {
            <div class="filter-pop">
              @for (f of statusOptions; track f) {
                <button [class.on]="statusFilter() === f" (click)="statusFilter.set(f); filterOpen.set(false)">{{ filterLabel(f) }}</button>
              }
            </div>
          }
        </div>
        <input class="search" type="text" placeholder="Search members, cases, programs…" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        <div class="cols-wrap">
          <button class="btn outline" (click)="colsOpen.set(!colsOpen())"><z-icon name="columns" [size]="14"></z-icon> Columns</button>
          @if (colsOpen()) {
            <div class="filter-pop cols-pop">
              <label><input type="checkbox" [ngModel]="showAcuity()" (ngModelChange)="showAcuity.set($event)" /> Clinical Acuity</label>
              <label><input type="checkbox" [ngModel]="showDates()" (ngModelChange)="showDates.set($event)" /> CM Dates</label>
            </div>
          }
        </div>
        <button class="btn outline" (click)="reset()"><z-icon name="refresh" [size]="14"></z-icon> Reset</button>
      </div>

      <div class="panel">
        <table class="z-table">
          <thead><tr>
            <th>Status / Priority</th>
            <th>Member Name</th>
            <th>To-Do's</th>
            @if (showAcuity()) { <th>Clinical Acuity</th> }
            <th>Case #</th>
            @if (showDates()) { <th>CM Dates</th> }
            <th>Program</th>
            <th>Last Update</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            @for (r of pagedRows(); track r.case.memberId) {
              <tr>
                <td>
                  <span class="prio" [attr.data-tone]="r.priorityTone">{{ r.priorityLabel }}</span>
                  @if (r.dueLabel) { <div class="duelab" [class.overdue]="r.overdueDays > 0">{{ r.dueLabel }}</div> }
                </td>
                <td><a class="ml" (click)="openMember(r.case)">{{ r.case.member }}</a><div class="sub">{{ r.case.memberId }}</div></td>
                <td><z-icon name="folder" [size]="13"></z-icon> {{ r.todoCount }}</td>
                @if (showAcuity()) { <td>{{ r.case.acuity }}</td> }
                <td><a class="ml" (click)="openMember(r.case)">{{ r.caseNumber }}</a></td>
                @if (showDates()) { <td class="dates">Start: {{ r.case.received }}<br />Target: {{ r.case.slaDueDate }}</td> }
                <td>{{ r.case.program }}</td>
                <td>{{ r.lastUpdate }}</td>
                <td><button class="icon-btn" title="Case actions" (click)="openMember(r.case)"><z-icon name="user" [size]="15"></z-icon></button></td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="colCount()" class="empty">No cases match the current filter.</td></tr>
            }
          </tbody>
        </table>
        <div class="pager">
          <div class="pagesize">
            <span>Show:</span>
            @for (n of [10,25,50,100]; track n) { <button [class.on]="pageSize() === n" (click)="pageSize.set(n); page.set(0)">{{ n }}</button> }
          </div>
          <span class="pcount">{{ filteredRows().length }} / {{ rows().length }} records</span>
        </div>
      </div>
    </div>
    } @else {
      <div class="notfound">No care manager named "{{ nameParam }}" was found.</div>
    }

    <app-overlays />
    <app-export-dialog />
  `,
  styles: [`
    .roster-page { max-width: 1400px; margin: 0 auto; padding: 24px 28px 40px; }
    .rhead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    .rhead h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; color: var(--ink); }
    .rsub { margin: 0; font-size: 13px; color: var(--gray-500); }
    .rhead-right { display: flex; align-items: center; gap: 12px; }
    .scope-sel { position: relative; display: inline-flex; align-items: center; }
    .scope-sel select { appearance: none; border: 1px solid var(--gray-300); border-radius: 8px; padding: 8px 30px 8px 12px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); background: #fff; cursor: pointer; }
    .scope-sel z-icon { position: absolute; right: 10px; pointer-events: none; color: var(--gray-500); }
    .user { display: flex; align-items: center; gap: 9px; }
    .avatar { width: 34px; height: 34px; border-radius: 999px; background: linear-gradient(135deg, #14b8a6, #6366f1); color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .uinfo { display: flex; flex-direction: column; line-height: 1.25; }
    .uinfo b { font-size: 13px; color: var(--ink); }
    .uinfo small { font-size: 11px; color: var(--gray-500); }

    .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 18px; }
    .ktile { background: #fff; border: 2px solid var(--gray-200); border-radius: 10px; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
    .ktile .kv { font-size: 22px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .ktile .kl { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gray-500); margin-top: 2px; }
    .ktile.blue { border-color: #bfdbfe; color: var(--blue); }
    .ktile.green { border-color: #bbf7d0; color: var(--green-fg); }
    .ktile.red { border-color: #fecaca; color: var(--red); }
    .ktile.amber { border-color: #fde68a; color: var(--amber-fg); }
    .ktile.purple { border-color: #e9d5ff; color: #7e22ce; }

    .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .search { flex: 1; border: 1px solid var(--gray-300); border-radius: 8px; padding: 9px 14px; font-size: 13px; outline: none; }
    .search:focus { border-color: var(--teal-600); }
    .filter-wrap, .cols-wrap { position: relative; }
    .filter-pop { position: absolute; top: calc(100% + 6px); left: 0; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 160px; z-index: 20; }
    .filter-pop button { border: none; background: none; text-align: left; padding: 8px 10px; border-radius: 6px; font-size: 12.5px; color: var(--ink-soft); cursor: pointer; }
    .filter-pop button:hover { background: var(--gray-50); }
    .filter-pop button.on { background: var(--teal-50); color: var(--teal-900); font-weight: 600; }
    .cols-pop { padding: 10px 12px; gap: 8px; }
    .cols-pop label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-soft); cursor: pointer; }

    .prio { font-weight: 600; font-size: 12.5px; color: var(--ink-soft); }
    .prio[data-tone="red"] { color: var(--red); } .prio[data-tone="amber"] { color: var(--amber-fg); }
    .duelab { font-size: 11px; color: var(--gray-500); margin-top: 2px; } .duelab.overdue { color: var(--red); font-weight: 600; }
    .ml { color: #2563eb; font-weight: 600; cursor: pointer; } .ml:hover { text-decoration: underline; }
    .sub { font-size: 11px; color: var(--gray-500); margin-top: 2px; }
    .dates { font-size: 11.5px; line-height: 1.5; }
    .icon-btn { border: none; background: var(--gray-100); border-radius: 8px; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--gray-500); }
    .icon-btn:hover { background: var(--teal-50); color: var(--teal-700); }
    .empty { text-align: center; color: var(--gray-500); padding: 24px; }

    .pager { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-top: 1px solid var(--gray-100); }
    .pagesize { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--gray-500); }
    .pagesize button { border: 1px solid var(--gray-300); background: #fff; border-radius: 6px; padding: 4px 9px; font-size: 12px; cursor: pointer; color: var(--ink-soft); }
    .pagesize button.on { background: var(--teal-700); border-color: var(--teal-700); color: #fff; }
    .pcount { font-size: 12px; color: var(--gray-500); }

    .notfound { padding: 60px; text-align: center; color: var(--gray-500); font-size: 14px; }
  `],
})
export class CmRosterView {
  private route = inject(ActivatedRoute);
  private cmData = inject(CmData);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);

  readonly nameParam = decodeURIComponent(this.route.snapshot.paramMap.get('name') ?? '');
  readonly careManager = computed(() => CARE_MANAGERS.find((c) => c.name === this.nameParam));
  readonly username = usernameOf(this.nameParam);
  readonly initials = initialsOf(this.nameParam);

  readonly scope = signal<Scope>('mine');
  readonly scopedCases = computed(() => {
    const cm = this.careManager();
    if (!cm) return [];
    const cases = this.cmData.cases();
    return this.scope() === 'mine' ? cases.filter((c) => c.careManager === cm.name) : cases.filter((c) => CARE_MANAGERS.find((x) => x.name === c.careManager)?.team === cm.team);
  });
  readonly rows = computed(() => buildRosterRows(this.scopedCases()));

  readonly counts = computed(() => {
    const rs = this.rows();
    return {
      new: rs.filter((r) => r.isNew).length,
      overdue: rs.filter((r) => r.overdueDays > 0).length,
      dueToday: rs.filter((r) => r.dueLabel === 'Due today').length,
      tomorrow: rs.filter((r) => r.dueLabel === 'Due tomorrow').length,
      adt: rs.filter((r) => r.adt).length,
    };
  });

  readonly statusOptions: StatusFilter[] = ['all', 'new', 'overdue', 'dueToday', 'tomorrow'];
  filterLabel(f: StatusFilter): string {
    return f === 'all' ? 'All' : f === 'new' ? 'New' : f === 'overdue' ? 'Overdue' : f === 'dueToday' ? 'Due Today' : 'Tomorrow';
  }
  readonly statusFilter = signal<StatusFilter>('all');
  readonly filterOpen = signal(false);
  readonly search = signal('');
  readonly colsOpen = signal(false);
  readonly showAcuity = signal(true);
  readonly showDates = signal(true);
  readonly page = signal(0);
  readonly pageSize = signal(25);

  colCount(): number { return 6 + (this.showAcuity() ? 1 : 0) + (this.showDates() ? 1 : 0); }

  readonly filteredRows = computed(() => {
    const q = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.rows().filter((r) => {
      if (status === 'new' && !r.isNew) return false;
      if (status === 'overdue' && r.overdueDays <= 0) return false;
      if (status === 'dueToday' && r.dueLabel !== 'Due today') return false;
      if (status === 'tomorrow' && r.dueLabel !== 'Due tomorrow') return false;
      if (!q) return true;
      return r.case.member.toLowerCase().includes(q) || r.case.memberId.toLowerCase().includes(q) || r.case.program.toLowerCase().includes(q);
    });
  });
  readonly pagedRows = computed(() => {
    const start = this.page() * this.pageSize();
    return this.filteredRows().slice(start, start + this.pageSize());
  });

  reset() {
    this.search.set(''); this.statusFilter.set('all'); this.showAcuity.set(true); this.showDates.set(true);
    this.page.set(0); this.filterOpen.set(false); this.colsOpen.set(false);
  }

  openMember(c: CmCaseRec) {
    this.ix.openDrawer({
      title: c.member, subtitle: `${c.memberId} · ${c.program}`,
      badge: { text: `${c.riskLevel} risk`, tone: c.riskLevel === 'Critical' || c.riskLevel === 'High' ? 'red' : c.riskLevel === 'Moderate' ? 'amber' : 'green' },
      fields: [
        { label: 'Primary Dx', value: c.dx },
        { label: 'Stage', value: c.stage },
        { label: 'Queue', value: c.queue ?? 'No active queue' },
        { label: 'Assignment', value: c.assignmentMethod },
        { label: 'Annual Cost', value: `$${c.cost.toLocaleString()}` },
        { label: 'SLA Due', value: c.slaDueDate },
      ],
      actions: [
        { label: 'Escalate to Medical Director', tone: 'amber', run: () => { this.ix.closeDrawer(); this.ix.toast(`${c.member} escalated to Medical Director.`, 'warn'); } },
      ],
    });
  }

  exportRoster() {
    this.exporter.open({
      title: 'CM Roster', name: `cm-roster-${this.username}${TODAY_ISO}`,
      columns: ['Member ID', 'Member', 'Priority', 'To-Dos', 'Clinical Acuity', 'Case #', 'Start', 'Target', 'Program', 'Last Update'],
      rows: this.filteredRows().map((r) => [r.case.memberId, r.case.member, r.priorityLabel, r.todoCount, r.case.acuity, r.caseNumber, r.case.received, r.case.slaDueDate, r.case.program, r.lastUpdate]),
    });
  }
}
