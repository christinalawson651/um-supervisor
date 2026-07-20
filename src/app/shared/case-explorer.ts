import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Interaction } from './interaction';
import { downloadCsv } from './export-csv';

const PAGE = 12;

@Component({
  selector: 'app-case-explorer',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (ix.explorer(); as e) {
      <div class="scrim" (click)="ix.closeExplorer()">
        <div class="explorer" (click)="$event.stopPropagation()">
          <!-- header -->
          <div class="ehead">
            <div>
              <h3>{{ e.title }}</h3>
              <div class="ctx">{{ e.context }}</div>
            </div>
            <button class="ex" (click)="ix.closeExplorer()">×</button>
          </div>

          <!-- toolbar -->
          <div class="toolbar">
            <input class="search" type="text" placeholder="Search all cases…"
              [ngModel]="q()" (ngModelChange)="setQuery($event)" />
            <span class="count">{{ filtered().length }} case{{ filtered().length === 1 ? '' : 's' }}</span>
            <span class="spacer"></span>
            <button class="btn outline sm" (click)="exportAll(e)">Export all ({{ filtered().length }})</button>
          </div>

          <!-- table -->
          <div class="etable-wrap">
            <table class="etable">
              <thead>
                <tr>
                  @for (c of e.columns; track c; let ci = $index) {
                    <th (click)="sortBy(ci)">{{ c }}{{ caret(ci) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of pageRows(); track $index) {
                  <tr>@for (cell of row; track $index) { <td>{{ cell }}</td> }</tr>
                }
                @empty {
                  <tr><td [attr.colspan]="e.columns.length" class="empty">No cases match "{{ q() }}".</td></tr>
                }
              </tbody>
            </table>
          </div>

          <!-- pagination -->
          <div class="pager">
            <span>Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ filtered().length }}</span>
            <span class="spacer"></span>
            <button class="btn outline sm" [disabled]="page() === 0" (click)="prev()">‹ Prev</button>
            <span class="pnum">Page {{ page() + 1 }} of {{ totalPages() }}</span>
            <button class="btn outline sm" [disabled]="page() >= totalPages() - 1" (click)="next()">Next ›</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(17,24,39,.5); z-index: 120;
      display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; }
    .explorer { background:#fff; border-radius: 14px; width: 100%; max-width: 1100px; height: 100%;
      max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,.28);
      overflow: hidden; }
    .ehead { display:flex; justify-content:space-between; align-items:flex-start;
      padding: 20px 24px 14px; border-bottom: 1px solid var(--border); }
    .ehead h3 { margin:0; font-size:18px; color:var(--ink); }
    .ctx { margin-top:6px; font-size:13px; font-weight:700; color: var(--teal-900);
      background: var(--teal-50); border:1px solid var(--teal-100); border-radius:8px;
      padding: 7px 12px; display:inline-block; }
    .ex { border:none; background:none; cursor:pointer; color:var(--gray-400); font-size:24px; line-height:1; }
    .toolbar { display:flex; align-items:center; gap:14px; padding: 14px 24px; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:8px 12px; font-size:13px;
      width: 280px; outline:none; }
    .search:focus { border-color: var(--teal-600); }
    .count { font-size:12.5px; color:var(--gray-500); font-weight:600; }
    .spacer { flex:1; }
    .etable-wrap { flex:1; overflow:auto; margin: 0 24px; border:1px solid var(--gray-100); border-radius:10px; }
    .etable { width:100%; border-collapse:collapse; font-size:13px; }
    .etable thead th { position: sticky; top: 0; background: var(--gray-50); cursor:pointer;
      text-align:left; padding:11px 14px; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase;
      color:var(--gray-500); font-weight:600; white-space:nowrap; border-bottom:1px solid var(--gray-200);
      user-select:none; }
    .etable thead th:hover { color: var(--ink-soft); }
    .etable tbody td { padding:11px 14px; border-bottom:1px solid var(--gray-100); color:var(--ink-soft);
      white-space:nowrap; }
    .etable tbody tr:hover { background: var(--gray-50); }
    .empty { text-align:center; color:var(--gray-500); padding: 28px; }
    .pager { display:flex; align-items:center; gap:12px; padding: 14px 24px; font-size:12.5px;
      color: var(--gray-500); }
    .pnum { font-weight:600; color:var(--ink-soft); }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class CaseExplorer {
  ix = inject(Interaction);

  readonly q = signal('');
  readonly page = signal(0);
  readonly sortCol = signal<number>(-1);
  readonly sortDir = signal<1 | -1>(1);

  constructor() {
    // reset view state whenever a new metric is opened
    effect(() => {
      this.ix.explorer();
      this.q.set('');
      this.page.set(0);
      this.sortCol.set(-1);
      this.sortDir.set(1);
    });
  }

  readonly filtered = computed(() => {
    const e = this.ix.explorer();
    if (!e) return [];
    const query = this.q().trim().toLowerCase();
    let rows = query
      ? e.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(query)))
      : e.rows;
    const col = this.sortCol();
    if (col >= 0) {
      const dir = this.sortDir();
      rows = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        const an = parseFloat(String(av).replace(/[$,h]/g, '')), bn = parseFloat(String(bv).replace(/[$,h]/g, ''));
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    }
    return rows;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  readonly pageRows = computed(() => this.filtered().slice(this.page() * PAGE, this.page() * PAGE + PAGE));
  rangeStart() { return this.filtered().length === 0 ? 0 : this.page() * PAGE + 1; }
  rangeEnd() { return Math.min(this.filtered().length, (this.page() + 1) * PAGE); }

  setQuery(v: string) { this.q.set(v); this.page.set(0); }
  prev() { this.page.update((p) => Math.max(0, p - 1)); }
  next() { this.page.update((p) => Math.min(this.totalPages() - 1, p + 1)); }
  sortBy(ci: number) {
    if (this.sortCol() === ci) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortCol.set(ci); this.sortDir.set(1); }
    this.page.set(0);
  }
  caret(ci: number) { return this.sortCol() === ci ? (this.sortDir() === 1 ? ' ▲' : ' ▼') : ''; }

  exportAll(e: { columns: string[]; exportName: string }) {
    downloadCsv(e.exportName, e.columns, this.filtered());
  }
}
