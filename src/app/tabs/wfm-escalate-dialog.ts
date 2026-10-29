import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WFM_STAFF } from '../data/case-fields';
import { H, NOW, SLA_WINDOW_H, STEP_DUE_REASONS, Urgency } from '../data/wfm-work';
import { Item, WfmStore } from '../shared/wfm-store';
import { Interaction } from '../shared/interaction';

type Mode = 'route' | 'step' | 'urgency';

/** Escalate selected, the TruCare 26.x way. 26.x has no "escalated" status: escalating changes who
 *  holds a line (Assign Line, to the role that acts next) or tightens its dates (Adjust Step Due Date,
 *  Change Urgency, which recalculates the decision due date). Every change lands in the custody log. */
@Component({
  selector: 'app-wfm-escalate-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (items.length) {
      <div class="scrim" (click)="close.emit()">
        <div class="dlg" (click)="$event.stopPropagation()">
          <div class="dh">
            <div><h3>Escalate {{ auths() }} authorization{{ auths() === 1 ? '' : 's' }} <span class="sub">({{ items.length }} line{{ items.length === 1 ? '' : 's' }})</span></h3>
              <div class="stat">{{ slaBreached() }} past SLA · {{ stepOverdue() }} past step due</div></div>
            <button class="x" (click)="close.emit()">×</button>
          </div>

          <div class="modes">
            <label class="mode" [class.on]="mode() === 'route'"><input type="radio" name="m" [checked]="mode() === 'route'" (change)="mode.set('route')" />
              <div><b>Route up</b><span>Move the lines to the role that acts next. The holder changes; the line status does not.</span></div></label>
            @if (store.perms().stepDue) {
              <label class="mode" [class.on]="mode() === 'step'"><input type="radio" name="m" [checked]="mode() === 'step'" (change)="mode.set('step')" />
                <div><b>Reprioritize</b><span>Bring the step due date forward. The SLA does not move.</span></div></label>
              <label class="mode" [class.on]="mode() === 'urgency'"><input type="radio" name="m" [checked]="mode() === 'urgency'" (change)="mode.set('urgency')" />
                <div><b>Change urgency</b><span>Set on the authorization; the decision due date (SLA) is recalculated.</span></div></label>
            }
          </div>

          <div class="form">
            @switch (mode()) {
              @case ('route') {
                <label class="f">Route to
                  <select [ngModel]="target()" (ngModelChange)="target.set($event)">
                    <option value="MD Review">MD Review (L2 queue)</option>
                    <option value="Peer-to-Peer">Peer-to-Peer (L2 queue)</option>
                    @for (m of mds; track m) { <option [value]="m">Specific MD: {{ m }}</option> }
                  </select></label>
                <label class="f">Reason <input type="text" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Why this needs a physician" /></label>
              }
              @case ('step') {
                <label class="f">New step due
                  <input type="datetime-local" [ngModel]="stepAt()" (ngModelChange)="stepAt.set($event)" /></label>
                <label class="f">Reason
                  <select [ngModel]="stepReason()" (ngModelChange)="stepReason.set($event)">
                    @for (r of reasons; track r) { <option [value]="r">{{ r }}</option> }
                  </select></label>
                @if (stepReason().startsWith('Other')) {
                  <label class="f">Note <input type="text" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Required" /></label>
                }
              }
              @case ('urgency') {
                <div class="f">Urgency
                  <div class="seg">@for (u of urgencies; track u) {
                    <button type="button" [class.on]="urg() === u" (click)="urg.set(u)">{{ u }}</button> }</div></div>
                <label class="f">Reason <input type="text" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Required" /></label>
                <div class="hint">Decision due date becomes {{ urg() === 'Expedited' ? expH + ' hours' : medicaidD + ' days (Medicaid) or ' + mpD + ' days (Marketplace)' }} from receipt.
                  @if (urg() === 'Expedited') { Changing to Expedited cancels any line downgrades. } @else { A member notice is owed when expedited work moves to standard. }</div>
              }
            }
          </div>

          <div class="df">
            <span class="foot">Sent to TruCare 26.x as {{ mode() === 'route' ? 'Assign Line' : mode() === 'step' ? 'Adjust Step Due Date' : 'Change Urgency' }} · written to the custody log</span>
            <button class="btn outline" (click)="close.emit()">Cancel</button>
            <button class="btn primary" [disabled]="!valid()" (click)="apply()">Escalate</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.5); z-index:130; display:flex; align-items:center; justify-content:center; padding:16px; }
    .dlg { background:#fff; border-radius:14px; width:100%; max-width:620px; box-shadow:0 24px 60px rgba(0,0,0,.28); overflow:hidden; }
    .dh { display:flex; justify-content:space-between; align-items:flex-start; padding:16px 20px; border-bottom:1px solid var(--border); }
    .dh h3 { margin:0; font-size:16px; } .sub { color:var(--gray-500); font-weight:500; font-size:13px; }
    .stat { font-size:12px; color:var(--gray-500); margin-top:2px; }
    .x { border:none; background:none; font-size:24px; color:var(--gray-400); cursor:pointer; }
    .modes { display:grid; gap:8px; padding:14px 20px 4px; }
    .mode { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--gray-300); border-radius:10px; padding:10px 12px; cursor:pointer; }
    .mode.on { border-color:var(--teal-600); background:var(--teal-50); }
    .mode b { display:block; font-size:13px; } .mode span { font-size:12px; color:var(--gray-500); }
    .form { display:grid; gap:10px; padding:12px 20px; }
    .f { display:grid; gap:4px; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); }
    .f select, .f input { font:inherit; font-size:13px; text-transform:none; letter-spacing:0; font-weight:400; color:var(--ink); border:1px solid var(--gray-300); border-radius:8px; padding:7px 10px; }
    .seg { display:inline-flex; gap:4px; } .seg button { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:4px 12px; font-size:12px; cursor:pointer; text-transform:none; letter-spacing:0; }
    .seg button.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; font-weight:600; }
    .hint { font-size:12px; color:var(--gray-500); }
    .df { display:flex; align-items:center; gap:10px; padding:12px 20px; border-top:1px solid var(--border); }
    .foot { flex:1; font-size:11px; color:var(--gray-500); }
    .btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class WfmEscalateDialog {
  readonly store = inject(WfmStore);
  private ix = inject(Interaction);
  @Input() items: Item[] = [];
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly done = new EventEmitter<void>();

  readonly mds = WFM_STAFF.filter((s) => s.role === 'L2 Physician Reviewer').map((s) => s.name);
  readonly reasons = STEP_DUE_REASONS;
  readonly urgencies: Urgency[] = ['Expedited', 'Standard'];
  readonly expH = SLA_WINDOW_H.Expedited; readonly medicaidD = SLA_WINDOW_H.Medicaid / 24; readonly mpD = SLA_WINDOW_H.Marketplace / 24;

  readonly mode = signal<Mode>('route');
  readonly target = signal('MD Review');
  readonly note = signal('');
  readonly stepAt = signal(toLocalInput(NOW + 4 * H));
  readonly stepReason = signal(STEP_DUE_REASONS[1]);
  readonly urg = signal<Urgency>('Expedited');

  auths() { return new Set(this.items.map((i) => i.c.authId)).size; }
  slaBreached() { return this.items.filter((i) => i.l.slaDue < NOW).length; }
  stepOverdue() { return this.items.filter((i) => i.l.stepDue < NOW).length; }
  readonly valid = computed(() => {
    const m = this.mode();
    if (m === 'step') return !!this.stepAt() && (!this.stepReason().startsWith('Other') || !!this.note().trim());
    if (m === 'urgency') return !!this.note().trim();
    return true;
  });

  apply() {
    const n = this.auths();
    switch (this.mode()) {
      case 'route': this.store.route(this.items, this.target(), this.note().trim()); this.ix.toast(`${n} authorization(s) routed to ${this.target()}.`); break;
      case 'step': {
        const reason = this.stepReason().startsWith('Other') ? `Other: ${this.note().trim()}` : this.stepReason();
        this.store.setStepDue(this.items, new Date(this.stepAt()).getTime(), reason);
        this.ix.toast(`Step due date moved on ${this.items.length} line(s).`); break;
      }
      case 'urgency': this.store.changeUrgency(this.items, this.urg(), this.note().trim()); this.ix.toast(`${n} authorization(s) changed to ${this.urg()}; decision due dates recalculated.`); break;
    }
    this.done.emit();
  }
}

function toLocalInput(ms: number): string {
  const d = new Date(ms), p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
