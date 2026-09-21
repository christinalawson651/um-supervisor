import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'warn';
}

export interface ConfirmBreakdownRow { count: number; label: string; target: string; }

/** One concrete change the user is about to make, listed individually and switched off individually.
 *  A summary ("3 authorizations → Sarah Mitchell") tells a supervisor how MUCH is moving; it does not
 *  tell them WHICH work is moving, and it leaves them no way to keep one case where it is. Anything
 *  that reassigns clinical work should be able to name it. */
export interface ConfirmPick {
  id: string;
  /** The thing being moved — an authorization ID, a case number. */
  ref: string;
  /** Who it concerns, shown beside the ref so the supervisor recognises it. */
  label: string;
  from: string;
  to: string;
  /** Why this one was chosen. A plan that cannot explain its selection invites "cancel the lot". */
  note?: string;
  selected: boolean;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Optional clean list of what's about to happen (e.g. "2 authorizations → Sarah Mitchell, RN"),
   *  rendered instead of cramming counts into the body sentence. */
  breakdown?: ConfirmBreakdownRow[];
  /** Itemised, individually deselectable changes. When present, the dialog lists every one of them
   *  and hands the surviving ids to onConfirm — so what gets applied is what was left ticked, never
   *  a plan recomputed after the fact. */
  picks?: ConfirmPick[];
  confirmLabel: string;
  tone: 'teal' | 'red' | 'amber';
  /** `selectedIds` is populated only when `picks` was supplied. */
  onConfirm: (selectedIds?: string[]) => void;
}

export interface ChooserRequest {
  title: string;
  body: string;
  label: string;                 // field label above the select
  options: string[];
  confirmLabel: string;
  tone: 'teal' | 'red' | 'amber';
  onChoose: (value: string) => void;
}

export interface DrawerField { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'blue' | 'teal'; }
export interface DrawerAction { label: string; tone: 'teal' | 'red' | 'amber'; run: () => void; }
/** A cell inside a drawer table that opens something. Same idea as the Reports module's cell links:
 *  a member or an authorization printed as text is a dead end, and the drawer is where a supervisor
 *  most often lands. */
export interface DrawerCellLink {
  column: number;
  run: (value: string, row: (string | number)[]) => void;
  enabled?: (value: string, row: (string | number)[]) => boolean;
  /** When set, the cell is split on this and each part links on its own. Never a comma — member
   *  names are stored "Last, First". */
  splitOn?: string;
}
export interface DrawerTable {
  columns: string[];
  rows: (string | number)[][];
  caption?: string;
  links?: DrawerCellLink[];
}
export interface DrawerData {
  title: string;
  subtitle?: string;
  badge?: { text: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'teal' };
  formula?: string;            // e.g. "62% = 153 of 247 decisions"
  fields?: DrawerField[];
  table?: DrawerTable;         // contributing case list
  note?: string;
  actions?: DrawerAction[];
}

export interface ExplorerData {
  title: string;
  context: string;             // headline / formula line
  columns: string[];
  rows: (string | number)[][]; // ALL contributing cases
  exportName: string;
  memberColumn?: number;       // index of the Member column (renders clickable)
  /** Override for lists that are a navigation surface rather than a clinical case list: makes one
   *  column a link that runs this, instead of opening the member's clinical drawer. The audit
   *  pivots use it to hand off from one view to the other. */
  rowLinks?: { column: number; run: (row: (string | number)[]) => void;
                /** Optional: suppress the link on rows where the cell is a stated reason rather than
                 *  a thing to open. A link that opens nothing is worse than plain text. */
                enabled?: (row: (string | number)[]) => boolean }[];
}

@Injectable({ providedIn: 'root' })
export class Interaction {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);
  readonly confirm = signal<ConfirmRequest | null>(null);
  readonly chooser = signal<ChooserRequest | null>(null);
  readonly drawer = signal<DrawerData | null>(null);
  readonly explorer = signal<ExplorerData | null>(null);
  readonly memberChart = signal<unknown | null>(null);

  openDrawer(d: DrawerData) { this.drawer.set(d); }
  closeDrawer() { this.drawer.set(null); }
  openExplorer(e: ExplorerData) { this.explorer.set(e); }
  closeExplorer() { this.explorer.set(null); }
  openMemberChart(m: unknown) { this.memberChart.set(m); }
  closeMemberChart() { this.memberChart.set(null); }

  toast(message: string, tone: Toast['tone'] = 'success') {
    const id = this.nextId++;
    this.toasts.update((t) => [...t, { id, message, tone }]);
    // auto-dismiss after 3.2s
    setTimeout(() => this.dismiss(id), 3200);
  }

  dismiss(id: number) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  ask(req: ConfirmRequest) {
    this.confirm.set(req);
  }

  resolve(ok: boolean, selectedIds?: string[]) {
    const req = this.confirm();
    this.confirm.set(null);
    if (ok && req) req.onConfirm(selectedIds);
  }

  choose(req: ChooserRequest) {
    this.chooser.set(req);
  }

  resolveChoice(value: string | null) {
    const req = this.chooser();
    this.chooser.set(null);
    if (value !== null && req) req.onChoose(value);
  }
}
