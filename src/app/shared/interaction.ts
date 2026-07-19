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

@Injectable({ providedIn: 'root' })
export class Interaction {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);
  readonly confirm = signal<ConfirmRequest | null>(null);

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
