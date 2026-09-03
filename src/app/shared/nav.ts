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

  go(m: ModuleId) {
    if (this.visibleModules().includes(m)) this.module.set(m);
  }

  setRole(label: string) {
    const r = ROLES.find((x) => x.label === label);
    if (!r) return;
    this.role.set(r);
    const visible = this.visibleModules();
    if (!visible.includes(this.module())) this.module.set(visible[0]);
  }
}
