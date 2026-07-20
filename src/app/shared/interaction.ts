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

export interface DrawerField { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'blue' | 'teal'; }
export interface DrawerAction { label: string; tone: 'teal' | 'red' | 'amber'; run: () => void; }
export interface DrawerData {
  title: string;
  subtitle?: string;
  badge?: { text: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'teal' };
  fields: DrawerField[];
  note?: string;
  actions?: DrawerAction[];
}

@Injectable({ providedIn: 'root' })
export class Interaction {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);
  readonly confirm = signal<ConfirmRequest | null>(null);
  readonly drawer = signal<DrawerData | null>(null);

  openDrawer(d: DrawerData) { this.drawer.set(d); }
  closeDrawer() { this.drawer.set(null); }

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
}
