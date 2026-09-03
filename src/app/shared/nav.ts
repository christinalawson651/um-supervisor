import { Injectable, computed, signal } from '@angular/core';

export type ModuleId = 'overview' | 'um' | 'cm' | 'appeals' | 'reports' | 'audit';
export type BizModule = 'um' | 'cm' | 'appeals';

export interface Role { id: string; label: string; modules: BizModule[]; }

export const ROLES: Role[] = [
  { id: 'exec',        label: 'Executive / Ops Leader', modules: ['um', 'cm', 'appeals'] },
  { id: 'um',          label: 'UM Supervisor',          modules: ['um'] },
  { id: 'cm',          label: 'CM Supervisor',          modules: ['cm'] },
  { id: 'appeals',     label: 'Appeals Supervisor',     modules: ['appeals'] },
  { id: 'um_cm',       label: 'UM + CM Lead',           modules: ['um', 'cm'] },
  { id: 'um_appeals',  label: 'UM + Appeals Lead',      modules: ['um', 'appeals'] },
  { id: 'cm_appeals',  label: 'CM + Appeals Lead',      modules: ['cm', 'appeals'] },
];

@Injectable({ providedIn: 'root' })
export class Nav {
  readonly role = signal<Role>(ROLES[0]);
  readonly module = signal<ModuleId>('overview');

  /** Modules the current role can see; Overview is present only for multi-module roles. Reports
   *  and Audit & Traceability are always last and always visible — every role gets a reporting view
   *  scoped to whichever business module(s) they own (see ReportsDashboard's use of `scope()`), and
   *  the audit trail is role-independent. */
  readonly visibleModules = computed<ModuleId[]>(() => {
    const biz = this.role().modules;
    // Audit & Traceability sits alongside Reports: always visible, regardless of role. It is the
    // system-of-record evidence view (who did what, when) rather than a business module, and every
    // role is accountable to it — a UM Supervisor who can't see the trail can't answer for it.
    return biz.length > 1 ? ['overview', ...biz, 'reports', 'audit'] : [...biz, 'reports', 'audit'];
  });

  /** Business modules (no overview) the role owns — drives the exec Overview scope. */
  readonly scope = computed<BizModule[]>(() => this.role().modules);

  /** A tab a caller has asked the destination module to open. Set alongside the module, read and
   *  cleared by whichever dashboard owns that module — cross-component tab selection has no other
   *  route, because each module holds its own tab state. Null means "leave the tab alone", which is
   *  what every existing navigation does. */
  readonly requestedTab = signal<string | null>(null);

  go(m: ModuleId) {
    if (this.visibleModules().includes(m)) this.module.set(m);
  }

  /** Navigate to a module AND a tab within it — how an alert takes someone to the surface that owns
   *  the problem it is reporting. */
  goTo(m: ModuleId, tab?: string) {
    if (!this.visibleModules().includes(m)) return;
    this.module.set(m);
    this.requestedTab.set(tab ?? null);
  }

  /** Read once and clear, so returning to a module later does not silently re-navigate. */
  takeRequestedTab(): string | null {
    const t = this.requestedTab();
    if (t !== null) this.requestedTab.set(null);
    return t;
  }

  setRole(label: string) {
    const r = ROLES.find((x) => x.label === label);
    if (!r) return;
    this.role.set(r);
    const visible = this.visibleModules();
    if (!visible.includes(this.module())) this.module.set(visible[0]);
  }
}
