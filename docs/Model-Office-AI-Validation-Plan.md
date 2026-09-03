# Model Office — AI Validation & Clinical AI Governance Plan

**Purpose:** define what has to be true before a machine-influenced determination goes live, who signs it off, and how it stays true afterwards.
**Scope:** the clinical recommendation model that scores authorizations and the auto-approval rules that act on it. Not in scope: the operational next-best-action suggestions on the supervisor dashboards, which never touch a determination.
**Status:** proposed for the 9/4 session. Thresholds below are the ones the product currently measures against (`AI_TARGETS` in `src/app/data/ai-oversight.ts`) and are open to Centene's own numbers.

---

## 0. Why this is a separate document

Everything else in the audit build is a screen you can point at. This is a *process*: entry criteria, test design, sign-off, and a monitoring cadence that outlives the implementation. It should be run as a Model Office workstream alongside the operational ones, not folded into UAT — UAT asks "does the button work", and this asks "should a clinician trust the number the button shows".

The live evidence for all of it is on **Audit & Traceability → AI Oversight**, and exports as **Reports → Audit & Traceability → AI Oversight & Concordance**. Every threshold below is already measured; what this document adds is when they are measured, against what, and who is accountable for the answer.

---

## 1. Entry criteria — before Model Office validation starts

| # | Criterion | Evidence |
|---|---|---|
| E1 | The serving configuration is pinned and immutable for the duration of the test | AI Oversight — Production Config |
| E2 | Criteria sets and policy versions in the test environment match production intent | Configuration Change Log |
| E3 | Every scored determination writes an audit event carrying recommendation, confidence, serving model and criteria set | Audit Trail — Clinical Decision category |
| E4 | Override capture is live, with structured reason codes rather than free text | AI Oversight — override reasons |
| E5 | A validation population is defined and agreed with Compliance (see §2) | This document, signed |
| E6 | Reviewers participating are credentialed and their scope of practice is configured | Governance & Access — permission matrix |

**Gate:** all six. E3 and E4 are the ones that get skipped under schedule pressure, and without them the rest of the validation cannot be evidenced afterwards.

---

## 2. Validation population

Statistical validity is the part that most often gets waved through, so it is stated explicitly.

- **Stratify by**: line of business, service category (inpatient / outpatient / behavioral / pharmacy / DME), and determination type (approval / partial / denial). Denials and partials are over-sampled deliberately — they carry the appeal and regulatory exposure.
- **Minimum N per confidence band: 40.** Below that a band is reported as *insufficient sample* — no observed rate, no deviation — never as pass or fail. Enforced in the product, not just in policy. A band holding thirty determinations swings ten points on sampling alone, and a swing that size read as a finding sends someone chasing noise.
- **Minimum N per reviewer: 12** before a per-clinician agreement rate is reported at all. Deliberately lower than the band floor: a clinician with a dozen scored determinations is a meaningful read on that person, where a confidence band with a dozen is not a meaningful read on a model. Different questions, different thresholds.
- **Overall minimum: 400 scored determinations**, or one full month of production-representative volume, whichever is larger.
- **Blinding:** the reviewer cohort for the concordance test should not see the confidence score at scoring time (see §5), or the test measures anchoring rather than agreement.

---

## 3. Acceptance criteria — the exit gate

| Metric | Threshold | Rationale |
|---|---|---|
| **Decision agreement** (recommendation matches final determination) | **≥ 90%** | Below this the model is generating more review work than it saves |
| **Calibration deviation**, any adequately-sampled band | **within ±5 points** | A score that does not mean what it says is worse than no score |
| **No band over-confident** by more than 5 points | **required** | Over-confidence at the top of the range is the failure mode that actually causes harm |
| **Override rate** | **≤ 15%** of reviewed determinations | Higher suggests the model is not fit for the population |
| **Model-attributable overrides** | **≤ 5%** of reviewed determinations | Separates model defect from legitimate clinical divergence |
| **Groundedness** (verdict supported by its cited source) | **≥ 90%** | An unsupported verdict cannot be defended in an appeal |
| **Convergence** (panel reaches one answer) | **≥ 80%** | A split panel means the flow has no settled position |
| **Adverse-determination agreement** | **≥ 90%**, measured separately | A denial is where being wrong costs the most |
| **Auto-approval false-positive rate** | **0 tolerated defects** on the validation set | An auto-approval nobody reviewed has no human backstop |

**A single over-confident band fails the gate**, even if overall agreement passes. Aggregate agreement can mask a band that is confidently wrong — which is precisely the condition the current build surfaces.

### Current state against these criteria
Measured on the demo dataset, as of the build in front of you:

- Decision agreement **85%** — **fails** the 90% gate
- 0.90–1.00 band claims 0.95, observes 86% — **−9 points, over-confident, fails**
- Groundedness **89%** — marginally below the 90% line
- Convergence **84%** — passes
- Override rate **17%** — **fails** the 15% ceiling
- Avg confidence **0.83**, P95 latency **15.3s**

The failures share a root: the top confidence band carries 85 of 247 determinations and runs nine points hot, which drags decision agreement under target and pushes the override rate over its ceiling. That is the finding, and catching it is what a Model Office gate exists for.

---

## 4. Test design

**4.1 Retrospective agreement.** Score a held-out set of already-decided authorizations and compare against the determination a clinician actually made. Cheap, fast, and the only test that can run before go-live. Weakness: the clinician was not working from the model, so it measures agreement, not influence.

**4.2 Parallel-run (shadow) scoring.** Model scores live cases; recommendation is hidden from the reviewer; agreement measured against what the reviewer decides independently. This is the honest test and should run for at least four weeks. It is also the only way to measure the anchoring effect in §5.

**4.3 Adversarial / edge review.** Deliberately construct cases at the boundaries — comorbidity combinations, out-of-network, retro requests, members with prior overturned appeals. Small N, clinician-authored, pass/fail rather than statistical.

**4.4 Stability.** Re-score the same population twice and confirm identical output. A recommendation that moves without an input changing cannot be defended in an appeal.

**4.5 Regression on promotion.** Every promotion — a model, a med-necessity bundle, or a gate threshold — re-runs 4.1 and 4.4 against the prior configuration's population before going live, with results attached to the change ticket.

---

## 5. The confidence-display question

*Should confidence scores be shown to reviewers, hidden, or managed by role?*

There is no settled industry answer, and anyone claiming one is selling something. The trade-off is real in both directions: a displayed score anchors the reviewer and inflates agreement without improving decisions; a hidden score wastes information the reviewer could legitimately use to triage.

**Position taken in the product today** — role-configured, visible on `Governance & Access Controls → Role → Permission Matrix`:

| Role | Confidence visibility | Reasoning |
|---|---|---|
| UM Nurse Reviewer | After own assessment is recorded | Preserves independent judgment, then allows reconciliation |
| Medical Director | Yes | Adjudicating the hard cases; needs the full picture |
| UM Supervisor | Aggregate only | Managing the queue, not the case |
| Appeals Reviewer | **No — blinded** | An appeal must be independent of the original machine input |
| Compliance Analyst | Yes, read-only | Auditing the score is the job |
| Care Manager / Intake / Administrator | No | Not applicable to their scope |

The reveal-after-assessment pattern for nurse reviewers is the one worth discussing with Centene: it keeps the concordance measurement honest while still giving the reviewer the information. It costs a workflow step, which is a real trade.

---

## 6. Ongoing monitoring after go-live

| Cadence | Activity | Owner | Evidence |
|---|---|---|---|
| Continuous | Recommendation, confidence, model version and override written to the audit trail | Platform | Audit Trail |
| Monthly | Calibration review — every adequately-sampled band against tolerance | Clinical Content | AI Oversight — calibration |
| Monthly | Agreement, groundedness and confidence drift against the configuration in force | Clinical Content | AI Oversight — drift |
| Monthly | Model-attributable overrides routed to the criteria owner and closed | Clinical Content | AI Oversight — override reasons |
| Quarterly | Per-clinician agreement reviewed as a signal, never as a performance score | UM Leadership | AI Oversight — agreement by clinician |
| Quarterly | AI governance report to the plan | Compliance | Reports → AI Oversight & Concordance |
| Quarterly | Per-agent latency and error review across the five agents | Platform | AI Oversight — per-agent |
| On promotion | Regression + acceptance gate re-run and attached to the change ticket | Clinical Content | Configuration Change Log |

**Vocabulary note.** Decision agreement, groundedness, convergence, the 0–1 confidence scale, the four bands and the two gates are Symphony Studio's, not this document's. The supervisor build's audit view reports the same measures in the same words on the same scale, so a reviewer moving between Symphony's Monitor and the audit module is not being asked to reconcile two vocabularies for one run.

**Known gap (REQ-20):** calibration is measured and visible, but nothing alerts when a band drifts out of tolerance — today it is found by a person opening the tab. Alerting, and gating model promotion on the same check, is the next step.

**Known gap (REQ-21):** model-attributable overrides are coded and reportable but do not route anywhere. The loop back to the clinical content team who own the criteria is manual.

---

## 7. Governance and sign-off

| Decision | Accountable | Consulted |
|---|---|---|
| Approve the validation population and thresholds | Compliance | Clinical Content, UM Leadership |
| Declare the acceptance gate passed or failed | Medical Director (clinical) + Compliance (evidence) | Platform |
| Promote a model version to production | Clinical Content, with two-person approval on the change ticket | Compliance |
| Suspend or roll back a model in production | Medical Director, unilaterally | Notified: Compliance, Platform |
| Set confidence-display policy by role | UM Leadership | Compliance, Clinical Content |

Model promotion is governed exactly like a criteria or letter-template change: versioned, approved by someone other than the person publishing it, and logged with before/after. That equivalence is deliberate — a model change silently rewrites how every subsequent case is decided, which is the same risk profile as a rule change.

---

## 8. Open questions for Centene

1. **Thresholds.** Are 90% decision agreement, 90% groundedness, 80% convergence, ±5 points calibration and ≤15% override the right lines, or does Centene carry its own?
2. **Parallel-run duration.** Is four weeks of shadow scoring acceptable before go-live, or is a longer observation period required?
3. **Confidence display.** Does Centene have a position on showing scores to reviewers, and does the reveal-after-assessment pattern work operationally?
4. **Adverse determinations.** Should denials be held to a higher concordance bar than 90%, given the appeal exposure?
5. **Sign-off.** Who on the Centene side countersigns the acceptance gate, and does a failed gate block go-live outright or trigger a mitigation plan?
6. **Reporting cadence.** Monthly internal, quarterly to the plan — or does Centene want the monthly?
7. **Scope.** Does this governance extend to the operational AI (queue routing, next-best-action), or only to determination-influencing models? Our position is the latter, because those never touch a determination.

---

## 9. Where the evidence lives

| Artifact | Location |
|---|---|
| AI decision records, calibration, drift, overrides | `src/app/data/ai-oversight.ts` |
| AI Oversight tab | Audit & Traceability → AI Oversight |
| Exportable governance report | Reports → Audit & Traceability → AI Oversight & Concordance |
| Recommendation + override events in the case trail | Audit Trail → category *Clinical Decision* |
| Serving configuration | AI Oversight → Production Config |
| Confidence visibility by role | Governance & Access Controls → permission matrix |
| Open AI-governance gaps | Compliance Requirements & Gaps → REQ-19, REQ-20, REQ-21 |
