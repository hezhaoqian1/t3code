# Baseline Governance

## 1. Baseline Roles

- Product / Requirement Baseline: confirmed requirement sources, target state, users, scenarios,
  acceptance criteria, non-goals, workflow constraints, open questions, and approved specifications.
- Architecture / Runtime Boundary Baseline: canonical owners, contracts, source-of-truth boundaries,
  dependency direction, compatibility, runtime-ready boundaries, and retirement state.

## 2. Design Defect

A confirmed error, gap, contradiction, or wrong abstraction in a requirement, design, or baseline.
Fix the defective baseline before aligning implementation. Do not patch implementation around it.

## 3. Implementation Drift

Implementation, planning, review, or documentation that differs from a confirmed and unchanged
baseline. Return to the baseline by the simplest stable path; do not silently redefine the baseline.

## 4. Compatibility Aliases

- Architecture Defect means an architecture-scoped Design Defect.
- Architecture Drift means architecture-scoped Implementation Drift.
- New findings report Design Defect or Implementation Drift with
  `scope: requirements | architecture | both`.

## 5. Baseline Check Protocol

Before non-trivial changes:

1. Read the latest Product / Requirement Baseline candidate.
2. Read the latest Architecture / Runtime Boundary Baseline candidate.
3. Compare the change against requirement acceptance and architecture ownership.
4. Check for new unrecorded anti-patterns.
5. Report aligned, Design Defect, Implementation Drift, missing-authority, or needs-clarification.

## 6. Architecture Review

Review ownership integrity, module boundaries, contract changes, dependency direction, compatibility
retirement, cascade proliferation, and net complexity after each non-trivial phase.

## 7. Hard Boundaries

- This file governs the Aegis workspace in this repository.
- Baseline snapshots are evidence, not authority or implementation completion proof.
- ADRs record decisions; they do not replace baseline governance.
- This file is NEVER auto-updated; changes require explicit review.
