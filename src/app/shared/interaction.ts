import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'warn';
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'teal' | 'red' | 'amber';
  onConfirm: () => void;
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
export interface DrawerTable { columns: string[]; rows: (string | number)[][]; caption?: string; }
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

  resolve(ok: boolean) {
    const req = this.confirm();
    this.confirm.set(null);
    if (ok && req) req.onConfirm();
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
