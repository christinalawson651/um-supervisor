import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Exporter } from './exporter';
import { Interaction } from './interaction';
import { downloadCsv, downloadXls, exportPdf } from './exports';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (ex.config(); as c) {
      <div class="scrim" (click)="ex.close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="mh"><h3>Export — {{ c.title }}{{ sections().length > 1 ? ' — ' + sections()[sectionIdx()].label : '' }}</h3><button class="x" (click)="ex.close()">×</button></div>

          @if (sections().length > 1) {
            <div class="sect">
              <div class="slab">Section</div>
              <select class="search" [value]="sectionIdx()" (change)="selectSection(+$any($event.target).value)">
                @for (s of sections(); track s.name; let i = $index) { <option [value]="i">{{ s.label }}</option> }
              </select>
            </div>
          }

          <div class="sect">
            <div class="slab">Format</div>
            <div class="fmt">
              @for (f of formats; track f.key) {
                <button class="fbtn" [class.on]="format() === f.key" (click)="format.set(f.key)">
                  <b>{{ f.label }}</b><span>{{ f.hint }}</span></button>
              }
            </div>
          </div>

          <div class="sect">
            <div class="slab">Filter rows</div>
            <input class="search" type="text" placeholder="Include only rows containing…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
          </div>

          <div class="sect">
            <div class="slab">Columns <span class="cnt">{{ included().size }}/{{ activeColumns().length }}</span></div>
            <div class="cols">
              @for (col of activeColumns(); track col; let i = $index) {
                <label class="col"><input type="checkbox" [checked]="included().has(i)" (change)="toggleCol(i)" /> {{ col }}</label>
              }
            </div>
          </div>

          <div class="mf">
            <span class="note">{{ filteredRows().length }} row(s) · {{ included().size }} column(s)</span>
            <span class="spacer"></span>
            <button class="btn outline" (click)="ex.close()">Cancel</button>
            <button class="btn primary" [disabled]="!included().size || !filteredRows().length" (click)="run(c)">Export</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.45); z-index:120; display:flex; align-items:center; justify-content:center; }
    .modal { background:#fff; border-radius:12px; width:460px; max-width:92vw; max-height:88vh; overflow-y:auto; padding:20px 22px; box-shadow:0 20px 40px rgba(0,0,0,.2); }
    .mh { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
    .mh h3 { margin:0; font-size:16px; } .x { border:none; background:none; font-size:22px; color:var(--gray-400); cursor:pointer; }
    .sect { margin-bottom:18px; }
    .slab { font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:8px; }
    .cnt { color:var(--gray-400); margin-left:4px; }
    .fmt { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .fbtn { border:1px solid var(--gray-300); background:#fff; border-radius:10px; padding:12px 8px; cursor:pointer; text-align:center; display:flex; flex-direction:column; gap:3px; }
    .fbtn.on { border-color:var(--teal-600); background:var(--teal-50); }
    .fbtn b { font-size:13px; color:var(--ink); } .fbtn span { font-size:10.5px; color:var(--gray-500); }
    .search { width:100%; border:1px solid var(--gray-300); border-radius:8px; padding:8px 12px; font-size:12.5px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .cols { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .col { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-soft); cursor:pointer; }
    .mf { display:flex; align-items:center; gap:10px; margin-top:6px; }
    .note { font-size:12px; color:var(--gray-500); } .spacer { flex:1; }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class ExportDialog {
  ex = inject(Exporter);
  private ix = inject(Interaction);
  readonly formats = [
    { key: 'csv', label: 'CSV', hint: 'Sheets/Excel' },
    { key: 'xls', label: 'Excel', hint: '.xls workbook' },
    { key: 'pdf', label: 'PDF', hint: 'print-ready' },
  ];
  readonly format = signal('csv');
  readonly q = signal('');
  readonly included = signal<Set<number>>(new Set());
  readonly sectionIdx = signal(0);
  readonly sections = computed(() => this.ex.config()?.sections ?? []);
  readonly activeColumns = computed(() => { const secs = this.sections(); return secs.length ? secs[this.sectionIdx()].columns : (this.ex.config()?.columns ?? []); });
  readonly activeRows = computed(() => { const secs = this.sections(); return secs.length ? secs[this.sectionIdx()].rows : (this.ex.config()?.rows ?? []); });
  readonly activeName = computed(() => { const secs = this.sections(); return secs.length ? secs[this.sectionIdx()].name : (this.ex.config()?.name ?? 'export'); });

  constructor() {
    effect(() => {
      // Read only `config` here — reading activeColumns()/sectionIdx() would make this effect
      // depend on sectionIdx too, so selectSection() changing it would immediately re-trigger
      // this reset and snap it straight back to 0.
      const c = this.ex.config();
      this.q.set(''); this.format.set('csv'); this.sectionIdx.set(0);
      const cols = c?.sections?.length ? c.sections[0].columns : (c?.columns ?? []);
      this.included.set(new Set(cols.map((_, i) => i)));
    });
  }

  selectSection(i: number) {
    this.sectionIdx.set(i);
    this.included.set(new Set(this.activeColumns().map((_, i) => i)));
  }
  toggleCol(i: number) { this.included.update((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; }); }

  readonly filteredRows = computed(() => {
    const query = this.q().trim().toLowerCase();
    const rows = this.activeRows();
    return query ? rows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(query))) : rows;
  });

  run(c: { title: string }) {
    const cols = [...this.included()].sort((a, b) => a - b);
    const columns = this.activeColumns();
    const headers = cols.map((i) => columns[i]);
    const rows = this.filteredRows().map((r) => cols.map((i) => r[i]));
    const fmt = this.format();
    const title = this.sections().length > 1 ? `${c.title} — ${this.sections()[this.sectionIdx()].label}` : c.title;
    const name = this.activeName();
    if (fmt === 'csv') downloadCsv(name, headers, rows);
    else if (fmt === 'xls') downloadXls(name, headers, rows);
    else exportPdf(title, headers, rows);
    this.ix.toast(`Exported "${title}" (${rows.length} rows) as ${fmt.toUpperCase()}.`);
    this.ex.close();
  }
}
