import { Component, inject } from '@angular/core';
import { REFERRALS } from '../data/referrals';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { Nav } from '../shared/nav';

@Component({
  selector: 'app-referrals-tab',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>Care Management Referrals</h2>
      <span class="section-note">Cases referred from UM into Care Management</span>
    </div>

    <div class="cards">
      <div class="c"><div class="v">{{ referrals.length }}</div><div class="l">Referred to CM (MTD)</div></div>
      <div class="c amber"><div class="v">{{ pending }}</div><div class="l">Pending Intake</div></div>
      <div class="c green"><div class="v">{{ active }}</div><div class="l">Care Plan Active</div></div>
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="pt">Outgoing Referrals</h3></div>
      <table class="z-table">
        <thead>
          <tr><th>Auth</th><th>Member</th><th>Reason</th><th>Referred From</th><th>Sent</th><th>CM Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          @for (r of referrals; track r.authId) {
            <tr>
              <td class="strong">{{ r.authId }}</td>
              <td><a class="ml" (click)="members.openByName(r.member)">{{ r.member }}</a></td>
              <td>{{ r.reason }}</td>
              <td>{{ r.fromStage }}</td>
              <td>{{ r.received }}</td>
              <td><span class="badge" [class.amber]="r.status==='Pending intake'" [class.blue]="r.status==='Assessment scheduled'"
                    [class.green]="r.status==='Care plan active'">{{ r.status }}</span></td>
              <td><button class="btn outline teal sm" (click)="nav.go('cm')">View in CM →</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .c { background:#fff; border:1px solid var(--border); border-left:3px solid var(--teal-600); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px 18px; }
    .c.amber { border-left-color:var(--amber); } .c.green { border-left-color:var(--green); }
    .v { font-size:26px; font-weight:700; color:var(--ink); } .l { font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:4px; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0; }
    .ml { color:#2563eb; font-weight:600; cursor:pointer; } .ml:hover { text-decoration:underline; }
  `],
})
export class ReferralsTab {
  members = inject(Members);
  private ix = inject(Interaction);
  nav = inject(Nav);
  readonly referrals = REFERRALS;
  get pending() { return REFERRALS.filter((r) => r.status === 'Pending intake').length; }
  get active() { return REFERRALS.filter((r) => r.status === 'Care plan active').length; }
}
