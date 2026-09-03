# Audit & Traceability — Client Session Brief

**Audience:** Centene audit, compliance and oversight stakeholders
**Purpose:** demonstrate Zyter's audit and traceability capabilities across UM, CM and Appeals, then work through gaps, priority requirements and next steps.
**Demo build:** UM Supervisor Dashboard → **Audit & Traceability** module (visible to every role), plus the per-module **Audit & Compliance** tabs.

---

## 0. The distinction to set up front

Two different things get called "audit," and the session goes sideways if they blur together.

| | Clinical quality audit | System audit / traceability |
|---|---|---|
| Question it answers | *Did the reviewer apply the criteria correctly?* | *Can you prove who did what, when, from where — and that the record hasn't been altered since?* |
| Where it lives in the demo | UM → Audit & Compliance; CM → Audit & Compliance | **Audit & Traceability** module |
| Evidence | IRR sample, file/chart review, regulatory TAT | Event log, user activity, access governance, control register |
| Who asks for it | NCQA / URAC surveyor, delegation oversight clinician | CMS program audit, HIPAA security review, SOC 2, plan IT security |

Both are in the build. Lead with the second — that's what this session is about — and use the first as the "and here's the clinical layer on top of it" close.

---

## 1. Demo flow (≈36 minutes)

### 1.1 Audit Trail — 6 min
**Audit & Traceability → Audit Trail**

- ~3,800 events across authorizations, CM cases, members, reports, user accounts and configuration.
- Every event carries: actor + access role, timestamp, category, action, entity type/ID, **field changed with before → after**, channel, source IP, session ID, correlation ID, reason code, PHI flag, outcome.
- **Channel matters.** Filter to `Fax / OCR Intake`, then `API`, then `System Rule`. The trail proves *how* a request physically arrived — the first thing disputed when a provider argues a receipt date.
- Click any row → full event detail including **previous hash / record hash**.
- Click **Verify chain** → re-walks every event in timestamp order and reports whether the chain is intact. This is the tamper-evidence claim as a check anyone can run, not a bullet on a slide.
- **The money filter:** category = `Configuration`. Rule thresholds, criteria-set versions, letter templates, TAT windows and role entitlements are all logged with before → after and a change ticket. Auto-approval events carry the firing rule *and version* as their reason code, so any automated determination traces back to the exact rule that produced it.

### 1.2 User Activity Monitoring — 5 min
**Audit & Traceability → User Activity Monitoring**

- Sign-ins, off-hours access (outside 07:00–19:00), failed sign-ins, out-of-scope access **denied** by RBAC, break-the-glass grants, and data exports with row counts.
- Per-account table with computed signals: `break-the-glass`, `external IP`, `no MFA`, `repeated failed sign-ins`, `off-hours pattern`, `high export volume`.
- Click any account → that user's own trail.
- Point to make: *out-of-scope access denied* is the control working; *break-the-glass granted* is the control being deliberately overridden, and each one is a reviewable PHI disclosure.

### 1.3 Governance & Access Controls — 6 min
**Audit & Traceability → Governance & Access Controls**

- **Segregation of duties** — four rules, each evaluated against the live trail rather than asserted:
  - SOD-1 appeal reviewed by the original decision-maker (42 CFR §438.406(b)(2), §422.590)
  - SOD-2 configuration change published without independent approval (SOC 2 CC8.1)
  - SOD-3 denial issued by a non-clinician (42 CFR §438.210(b)(3))
  - SOD-4 administrator with standing PHI access (HIPAA §164.308(a)(4))
  - A clean rule reads *"Control passing across N events in window"* — an auditable statement, not a green checkmark. SOD-2 currently returns real findings; click through to them.
- **Role → permission matrix** — nine permissions across ten access roles. The constraint text is the point: "Yes — assigned caseload" is a materially different control than an unconditional grant, and it's the distinction an auditor writes up.
- **Account inventory** with MFA status and last entitlement review against a 90-day cycle.

### 1.4 Compliance Requirements & Gaps — 5 min
**Audit & Traceability → Compliance Requirements & Gaps**

14 tracked requirements, each stated as *requirement → control today → where the evidence lives → status → gap → next step → owner*, grouped by domain. This is the working list for section 3 below — put it on screen and drive the discussion from it rather than from slides.

### 1.5 AI Oversight — 6 min
**Audit & Traceability → AI Oversight**

- Every determination the model touched: what it recommended, at what confidence, on which model version, and what the clinician decided instead. **247 scored · 94 straight-through · 153 clinician-reviewed.**
- **Confidence calibration is the whole answer to "what evidence supports their reliability".** A band claiming 97% should be right about 97% of the time. Show the table: the 95%+ band claims 97% and observes 83% — **14 points hot, across 121 of 247 determinations.**
- That is also why aggregate concordance is **87% against a 90% target**. Say it in that order: the number misses, and the calibration table explains why. An aggregate that passed while a band ran hot would be the more dangerous result.
- **Override reasons carry attribution.** The top reason is *Criteria not applicable to this presentation* — model-attributable, and concentrated in the over-confident band. That is the loop back to clinical content, not a reviewer problem.
- Agreement by clinician is shown as a **signal, not a score** — a reviewer below the group may be catching what the model misses. Sample floor of 20 before anyone gets a rate at all.
- Agreement by procedure names where it breaks down: Behavioral Health PHP and Cardiac Catheterization sit lowest.
- Confidence display is **role-configured** — nurse reviewers see it only after recording their own assessment, appeals reviewers are blinded. That's on the permission matrix, and §5 of the Model Office plan has the reasoning.

### 1.6 Retention & Archive — 5 min
**Audit & Traceability → Retention & Archive**

- The Audit Trail queries the **online store**. This tab is everything behind it. Say that out loud — "3,824 events" invites the question "and where is year seven?", and the answer should not be improvised.
- **3,824 online · 133,745 archived across 46 sealed quarterly segments · 137,569 total retained, back to 2014-10-01.** Archived periods are represented by segment metadata — period, event count, hash range, storage tier, seal date, hold status — not by materialising a decade of individual events.
- **Retention schedule** is per record class, not one blanket number: authorization/appeal/CM/audit records at 10 years (42 CFR §422.504(d)), PHI disclosure accounting at 6 (HIPAA §164.528(a)(1)), configuration changes for the life of every record they governed.
- **Verify archive chain** walks the sealed segments and confirms each one's first hash derives from the previous segment's last — the chain is continuous across the archive boundary and on into the online store. That continuity is what lets an archived record still function as evidence.
- **2 segments under legal hold, 5 past retention and not held.** The second number is the honest one: those are sitting in a disposition queue with no certified-destruction step behind it (REQ-17).
- Restore requests from cold storage are tracked with requester, reason and turnaround against a 5-day retrieval SLA.

### 1.7 Clinical audit layer — 3 min
- **UM → Audit & Compliance**: IRR sample with independent re-determination, discrepancy reason codes, corrective-action lifecycle, regulatory TAT compliance per LOB.
- **CM → Audit & Compliance**: documentation file review (chart audit) scored element-by-element, pass rate by care manager, rubric-element findings, second-reviewer IRR on the rubric itself, assessment/care-plan window compliance per program, and live compliance exceptions on member records.
- **Appeals has no audit tab, on purpose.** It runs on a small hand-authored set of appeal records rather than a generated pool, so there is nothing to sample or aggregate. The thin placeholder that used to sit there was removed rather than shown. If it comes up: the clinical audit pattern is proven twice over, and extending it to Appeals is a matter of building the appeals pool first — decided appeals across levels and LOBs with acknowledgment and resolution clocks, reviewer credential and independence, and notice-content elements.

---

## 2. Mapping to Centene's oversight objectives

| Objective | What the platform shows | Where |
|---|---|---|
| Prove system-of-record integrity | Hash-chained event log, verifiable on demand | Audit Trail → Verify chain |
| Attribute every clinical action | Actor + access role on every determination, criteria application, letter | Audit Trail |
| Prove automated decisions are governed | Auto-approval reason code names the rule version; rule changes logged with before → after and approver | Audit Trail → Configuration |
| Minimum-necessary / PHI control | RBAC scoping, denied out-of-scope access, break-the-glass with reason code | User Activity |
| Delegation oversight evidence | IRR, file audit, regulatory TAT, corrective actions — all exportable | UM & CM Audit & Compliance |
| Program-audit readiness | Filtered, dated extracts with provenance | Reports module + Audit Trail export |
| Access governance | Role→permission matrix, SOD evaluation, entitlement attestation | Governance & Access Controls |
| AI decision transparency | Recommendation, confidence, model version and criteria logged per determination; override with structured reason | AI Oversight · Audit Trail |
| Confidence reliability | Per-band calibration against claimed accuracy, with a sample floor | AI Oversight — calibration |
| Model drift | Concordance and mean confidence by month against model version in force | AI Oversight — drift |
| Clinical AI governance | Model versions governed like policy: versioned, two-person approved, logged | AI Oversight · Configuration Change Log |
| Records retention & defensible disposition | Per-class retention schedule, sealed archive segment index with continuous hash chain, legal holds, disposition queue, restore SLA | Retention & Archive |

---

## 3. Gaps, priorities and next steps

Taken straight from the in-app register (`Compliance Requirements & Gaps` → export for the follow-up packet). **21 requirements: 7 Met · 10 Partial · 4 Gap. Six P1 items are still open.**

### P1 — address before a plan audit

| # | Requirement | Gap | Next step | Owner |
|---|---|---|---|---|
| REQ-08 | MFA on every account with PHI access (**Gap**) | A minority of accounts still authenticate password-only, including at least one with standing PHI access. | Enforce MFA at the identity provider; disable password-only sign-in for every clinical role. | IT Operations |
| REQ-03 | Regular information-system activity review (**Partial**) | Review is available on demand, but nothing records that a named reviewer actually looked, or when. | Monthly activity-review task with reviewer sign-off captured as its own audit event. | Compliance |
| REQ-04 | Break-the-glass justified and reviewed (**Partial**) | Reason codes are captured; narrative justification is not required and no follow-up review is forced. | Require narrative justification at point of access; auto-route each event to Compliance for 5-day review. | Compliance |
| REQ-06 | Periodic entitlement review and attestation (**Partial**) | Attestation is tracked but not enforced — an account past its cycle keeps full access. | Escalate at 90 days, auto-suspend entitlements at 120 unless re-attested. | IT Operations |
| REQ-16 | Legal hold suspends disposition (**Partial**) | Holds are recorded and visible, but applied by hand — nothing in the platform blocks a disposition job from running against a held segment. | Make the hold flag a hard precondition on the purge job; require a named releaser and a reason to lift one. | Compliance |

### P2 — required for scale and for plan-side ingestion

| # | Requirement | Gap | Next step | Owner |
|---|---|---|---|---|
| REQ-10 | Program-audit universes on request (**Partial**) | Extracts aren't shaped to the CMS ODAG/CDAG record layouts, so a universe request still needs manual reformatting. | ODAG/CDAG universe templates with field-level mapping and a record-count reconciliation page. | Reporting |
| REQ-11 | Delegated-entity oversight reporting (**Partial**) | Evidence exports per widget; there's no single dated packet assembling the required artifact set. | One-click **Delegation Oversight Packet** — standard artifacts, cover page, generation hash. | Compliance |
| REQ-12 | Audit data exportable to the plan's SIEM (**Gap**) | CSV pull only; no streaming or scheduled feed for continuous ingestion. | Append-only audit event API plus a nightly signed batch feed. | Platform Engineering |
| REQ-13 | Alerting on anomalous access (**Gap**) | Signals are computed and displayed but nothing notifies anyone when a threshold is crossed. | Define thresholds per signal; route breaches to Compliance as a work item, not just a tile. | Compliance |
| REQ-17 | Defensible disposition — destruction certified and logged (**Gap**) | Nothing produces a certificate of destruction, and a purge would leave no audit event of its own. After disposition there would be no evidence the record existed or was lawfully destroyed. | Emit a signed disposition record per segment (period, event count, terminal hash, approver, date) and write it back into the trail as its own event. | Platform Engineering |
| REQ-18 | Archived records retrievable within the requested window (**Partial**) | Turnaround is recorded after the fact; nothing alerts when a restore request approaches or passes the 5-day retrieval SLA. | Surface open restore requests as a work item with an SLA countdown, the same treatment the UM queues get. | Platform Engineering |

### P3

| # | Requirement | Gap | Next step | Owner |
|---|---|---|---|---|
| REQ-14 | Member-facing accounting of disclosures, HIPAA §164.528 (**Partial**) | Underlying events exist; there's no per-member disclosure report a member request could be answered with. | Member-scoped disclosure report covering the trailing 6 years. | Compliance |

### Questions to put back to Centene

1. **Universe layouts** — which ODAG/CDAG record layouts and versions should we build to, and does Centene supply the reconciliation template?
2. **SIEM ingestion** — push (API/feed into Centene's SIEM) or pull, and what authentication and signing does Centene's security team require?
3. **Retention & disposition** — the schedule holds 10 years for authorization, appeal, CM and audit records and 6 for disclosure accounting. Confirm against Centene's own schedule and any state overrides — and confirm who signs a certificate of destruction, since that step does not exist yet.
4. **Attestation cadence and owner** — is the 90-day entitlement cycle Centene's standard, and who signs?
5. **Break-the-glass SLA** — what review window does Centene expect between an emergent-access grant and compliance sign-off?
6. **Delegation packet contents** — which artifacts must the oversight packet contain, and at what cadence?
7. **Retrieval SLA** — is 5 days the right retrieval window for archived periods, and does Centene expect a standing feed instead of request-by-request restore?

---

## 4. Honest caveats to state in the room

- The hash chain in this build uses a lightweight digest so the mechanism is demonstrable in-browser. Production chain-of-custody is server-side SHA-256; the property being demonstrated — any alteration changes this record's hash and every hash after it — is the same.
- Regulatory citations throughout are directional. Commercial PPO and ACA Exchange have **no** federal care-management clock, so those rows measure accreditation and plan policy, not statute. Exact subsections need Compliance validation before anything goes in front of a surveyor.
- IRR thresholds (90% agreement) and the CM file-audit pass line (80% of rubric) are org policy choices. NCQA/URAC require a defined, followed methodology — not one universal number.
- The archive is represented by **segment metadata**, not by materialised events: period, count, hash range, tier and hold status for each sealed quarter. That is how a real tiered store exposes cold data, and it is the honest way to show ten years in a browser — but say it, rather than letting "137,569 retained" imply 137,569 rows are sitting behind the screen.
- Data in the demo is deterministically generated from the UM/CM case pools. It is realistic in shape and stable across runs, but it is not Centene data.

---

## 5. Where this lives

| Piece | File |
|---|---|
| Audit & Traceability module (4 tabs) | `src/app/modules/audit-traceability.ts` |
| Event log, users, permission matrix, SOD rules, compliance register | `src/app/data/audit-trail.ts` |
| CM file audit / chart review model | `src/app/data/cm-audit.ts` |
| CM Audit & Compliance tab | `src/app/tabs/cm-audit-tab.ts` |
| UM IRR model | `src/app/data/um-irr.ts` |
| UM Audit & Compliance tab | `src/app/tabs/audit-tab.ts` |

Eight audit extracts live under **Reports → Audit & Traceability** (access & change log, user activity review, PHI disclosure log, configuration change log, SOD exceptions, entitlements & attestation, retention & archive register, compliance control register). Each calls the same function backing the audit screen, so a report can never disagree with what is on the tab.

Hosted build deploys from this repo via `render.yaml` (static site, SPA rewrite).
