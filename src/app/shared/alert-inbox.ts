import { Component, inject } from '@angular/core';
import { Alerts, Alert } from './alerts';
import { Icon } from './icon';

/** The Inbox: what is happening that a supervisor should know about, without any of it being
 *  assigned to them. Every row states where it will take you before you click it, and clicking is
 *  the only thing a row does — the actions live on the surface that owns the problem. */
@Component({
  selector: 'app-alert-inbox',
  standalone: true,
  imports: [Icon],
  template: `
    @if (alerts.open()) {
      <div class="scrim" (click)="alerts.close()"></div>
      <aside class="panel" role="dialog" aria-label="Notifications">
        <header class="head">
          <div>
            <h3>Notifications</h3>
            <p class="sub">
              {{ alerts.count() }} open signal{{ alerts.count() === 1 ? '' : 's' }} across your modules
              @if (alerts.criticalCount()) { · <b class="crit">{{ alerts.criticalCount() }} critical</b> }
            </p>
          </div>
          <button class="x" (click)="alerts.close()" aria-label="Close">×</button>
        </header>

        <p class="note">Nothing here is assigned to you. Each one opens the screen that owns it, where the actions already are.</p>

        <div class="body">
          @for (g of alerts.bySource(); track g.source) {
            <div class="grp">
              <div class="grp-head">{{ g.source }}<span>{{ g.alerts.length }}</span></div>
              @for (a of g.alerts; track a.id) {
                <button class="row" [attr.data-sev]="a.severity" (click)="alerts.goTo(a)">
                  <span class="dot"></span>
                  <span class="body-col">
                    <span class="title">{{ a.title }}</span>
                    <span class="detail">{{ a.detail }}</span>
                    <span class="dest"><z-icon name="chevron" [size]="11"></z-icon> {{ a.targetLabel }}</span>
                  </span>
                  <span class="metric">{{ a.metric }}</span>
                </button>
              }
            </div>
          } @empty {
            <div class="empty">Nothing needs your attention right now. ✓</div>
          }
        </div>
      </aside>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(15, 27, 34, .32); z-index: 60; }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 94vw); z-index: 61;
      background: #fff; border-left: 1px solid var(--border);
      box-shadow: -18px 0 46px -24px rgba(15, 27, 34, .45);
      display: flex; flex-direction: column;
    }
    .head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 12px; border-bottom: 1px solid var(--border); }
    .head h3 { margin: 0; font-size: 17px; font-weight: 700; }
    .sub { margin: 3px 0 0; font-size: 12.5px; color: var(--gray-500); }
    .sub .crit { color: var(--red, #c0392b); font-weight: 700; }
    .x { margin-left: auto; border: 0; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: var(--gray-500); }
    .note { margin: 0; padding: 12px 20px; font-size: 12px; color: var(--gray-500); background: var(--gray-50, #f9fafb); border-bottom: 1px solid var(--border); line-height: 1.5; }

    .body { overflow-y: auto; padding: 6px 0 24px; }
    .grp { padding: 10px 0 2px; }
    .grp-head {
      display: flex; align-items: center; gap: 8px; padding: 6px 20px;
      font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--gray-500);
    }
    .grp-head span { background: var(--gray-100); border-radius: 999px; padding: 1px 7px; font-size: 10px; }

    .row {
      display: grid; grid-template-columns: 10px minmax(0,1fr) auto; gap: 12px; align-items: start;
      width: 100%; text-align: left; border: 0; border-top: 1px solid var(--gray-100);
      background: #fff; padding: 13px 20px; cursor: pointer; font: inherit;
    }
    .row:hover { background: var(--gray-50, #f9fafb); }
    .row:focus-visible { outline: 2px solid var(--teal-600); outline-offset: -2px; }
    .dot { width: 8px; height: 8px; border-radius: 999px; margin-top: 5px; background: var(--gray-300); }
    .row[data-sev="critical"] .dot { background: var(--red, #c0392b); }
    .row[data-sev="warning"] .dot { background: var(--amber); }
    .row[data-sev="info"] .dot { background: var(--teal-600); }

    .body-col { display: grid; gap: 3px; min-width: 0; }
    .title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; }
    .detail { font-size: 12px; color: var(--gray-500); line-height: 1.45; }
    .dest { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--teal-700); font-weight: 600; margin-top: 2px; }
    .metric { font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 1px; }
    .empty { text-align: center; padding: 48px 24px; color: var(--teal-700); font-weight: 600; }
  `],
})
export class AlertInbox {
  alerts = inject(Alerts);
}
