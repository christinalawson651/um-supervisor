import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { BHP, BhpNode, BHP_BY, bhpChildren, bhpIsLeaf, bhpLeavesUnder } from '../data/case-fields';
import { LobFilter, summarize } from './lob-filter';

interface Row { node: BhpNode; depth: number; branch: boolean; open: boolean; total: number; on: number; }

// Plans (BHP) tree picker for the shell filter bar. Tri-state ticks: a parent selects every leaf
// under it. Edits go to a draft and apply when the picker closes (Done, Escape or a click outside).
@Component({
  selector: 'app-bhp-picker',
  standalone: true,
  template: `
    <div class="bp">
      <button type="button" class="bp-btn" [class.custom]="filter.selected().size" [attr.aria-expanded]="open()" (click)="toggle()">
        <span class="bp-v">{{ filter.summary() }}</span><span aria-hidden="true">▾</span>
      </button>
      @if (open()) {
        <div class="bp-pop" role="dialog" aria-label="Choose plans">
          <input class="bp-q" type="search" placeholder="Search plans" aria-label="Search plans" [value]="q()" (input)="q.set($any($event.target).value)" />
          <div class="bp-bar">
            <button type="button" class="bp-sm" (click)="selectAll()">Select all</button>
            <button type="button" class="bp-sm" (click)="clear()">Clear</button>
          </div>
          <ul class="bp-tree">
            @for (r of rows(); track r.node.id) {
              <li class="bp-row" [style.padding-left.px]="8 + r.depth * 18">
                @if (r.branch) {
                  <button type="button" class="bp-exp" [attr.aria-expanded]="r.open" [attr.aria-label]="(r.open ? 'Collapse ' : 'Expand ') + r.node.name" (click)="expand(r.node.id)">{{ r.open ? '▾' : '▸' }}</button>
                } @else { <span class="bp-exp"></span> }
                <label class="bp-lab">
                  <input type="checkbox" [checked]="r.on === r.total" [indeterminate]="r.on > 0 && r.on < r.total" (change)="tick(r.node.id)" />
                  {{ r.node.name }}
                </label>
                @if (r.node.level !== 'state') { <code class="bp-code">{{ r.node.id }}</code> }
                @if (r.branch) { <span class="bp-n">{{ r.on ? r.on + ' of ' : '' }}{{ r.total }}</span> }
              </li>
            } @empty { <li class="bp-none">No plans match.</li> }
          </ul>
          <div class="bp-foot"><span class="bp-sum">{{ draftSummary() }}</span><button type="button" class="bp-done" (click)="apply()">Done</button></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .bp { position:relative; }
    .bp-btn { display:inline-flex; gap:8px; align-items:center; border:1px solid var(--gray-300); border-radius:7px; background:#fff;
      padding:4px 10px; font-size:11px; font-weight:600; color:var(--gray-700); cursor:pointer; max-width:320px; }
    .bp-btn.custom { border-color:var(--teal-600); background:var(--teal-100); color:var(--teal-900); }
    .bp-v { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bp-pop { position:absolute; top:calc(100% + 6px); left:0; z-index:70; width:min(420px, 88vw); background:#fff; border:1px solid var(--border);
      border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,.14); display:flex; flex-direction:column; }
    .bp-q { margin:10px 10px 0; border:1px solid var(--gray-300); border-radius:7px; padding:6px 10px; font-size:12.5px; outline:none; }
    .bp-q:focus { border-color:var(--teal-600); }
    .bp-bar { display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid var(--gray-200); }
    .bp-sm { border:1px solid var(--gray-300); background:#fff; border-radius:6px; padding:3px 9px; font-size:11.5px; font-weight:600; color:var(--gray-700); cursor:pointer; }
    .bp-tree { list-style:none; margin:0; padding:6px 4px; max-height:320px; overflow-y:auto; }
    .bp-row { display:flex; align-items:center; gap:6px; padding:3px 8px; border-radius:6px; font-size:12.5px; }
    .bp-row:hover { background:var(--gray-50); }
    .bp-exp { width:18px; flex:none; border:none; background:none; color:var(--gray-500); cursor:pointer; padding:0; }
    .bp-lab { display:flex; gap:6px; align-items:center; cursor:pointer; }
    .bp-lab input { accent-color:var(--teal-700); }
    .bp-code { font-size:10.5px; background:var(--gray-50); border-radius:4px; padding:0 4px; color:var(--gray-500); }
    .bp-n { margin-left:auto; font-size:11px; color:var(--gray-500); }
    .bp-none { padding:10px; font-size:12.5px; color:var(--gray-500); }
    .bp-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; border-top:1px solid var(--gray-200); }
    .bp-sum { font-size:11.5px; color:var(--gray-500); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bp-done { border:none; background:var(--teal-700); color:#fff; border-radius:6px; padding:4px 12px; font-size:11.5px; font-weight:600; cursor:pointer; }
  `],
})
export class BhpPicker {
  readonly filter = inject(LobFilter);
  private host = inject(ElementRef<HTMLElement>);
  clear() { this.draft.set(new Set()); }

  readonly open = signal(false);
  readonly q = signal('');
  readonly draft = signal<ReadonlySet<string>>(new Set());
  private readonly expanded = signal<ReadonlySet<string>>(new Set(['BW', 'FL']));

  readonly draftSummary = computed(() => summarize(this.draft()));

  /** Leaves under a node that match the search (a match on any ancestor keeps the whole branch). */
  private visibleLeaves(id: string): string[] {
    const q = this.q().trim().toLowerCase();
    if (!q) return bhpLeavesUnder(id);
    return bhpLeavesUnder(id).filter((leaf) => {
      for (let n: BhpNode | undefined = BHP_BY[leaf]; n; n = n.parent ? BHP_BY[n.parent] : undefined) {
        if (n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  readonly rows = computed<Row[]>(() => {
    const out: Row[] = [], sel = this.draft(), exp = this.expanded(), searching = !!this.q().trim();
    const walk = (parent: string | null, depth: number) => {
      for (const node of bhpChildren(parent)) {
        const leaves = this.visibleLeaves(node.id);
        if (!leaves.length) continue;
        const branch = !bhpIsLeaf(node.id), open = searching || exp.has(node.id);
        out.push({ node, depth, branch, open, total: leaves.length, on: leaves.filter((l) => sel.has(l)).length });
        if (branch && open) walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  toggle() { this.open() ? this.apply() : this.openPicker(); }
  private openPicker() { this.draft.set(new Set(this.filter.selected())); this.q.set(''); this.open.set(true); }
  apply() { this.filter.selected.set(new Set(this.draft())); this.open.set(false); }

  expand(id: string) {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }
  tick(id: string) {
    const leaves = this.visibleLeaves(id), next = new Set(this.draft());
    const all = leaves.every((l) => next.has(l));
    leaves.forEach((l) => (all ? next.delete(l) : next.add(l)));
    this.draft.set(next);
  }
  selectAll() {
    const next = new Set(this.draft());
    BHP.filter((n) => bhpIsLeaf(n.id)).forEach((n) => { if (this.visibleLeaves(n.id).length) next.add(n.id); });
    this.draft.set(next);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) { if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.apply(); }
  @HostListener('document:keydown.escape')
  onEsc() { if (this.open()) this.apply(); }
}
