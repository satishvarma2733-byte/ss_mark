# Review recovery and handoff prompts

## Independent review

```text
Review without editing. Read instructions, current BRIEF/PLAN/HANDOFF, relevant specs, actual diff and test output. Check exclusivity, late/reordered payments, refund/partner liabilities, extension rollback, RLS/service-role tenant checks, native sessions/deep links, privacy, parity and recovery. Report evidence-based issues with severity, exact path/line, impact, reproduction and smallest fix. Mark missing evidence unverified. Update REVIEW with reviewed revision and limits; do not invent findings.
```

## Resume

```text
Read CLAUDE.md, shared context and tasks/current BRIEF, PLAN, HANDOFF and REVIEW. Verify claims against files/git status. State objective, confirmed decisions, completed work, blockers and next action concisely, then continue. Preserve web plus Android/iOS scope and unrelated edits. Reuse verified evidence unless changes justify rerunning. A template checklist is not proof.
```

## Diagnose a repeated failure

```text
Read the exact failing command, redacted logs, expected behavior and current diff. Reproduce the smallest failure and explain its cause before editing. Propose the smallest fix and regression check. If two attempts add no evidence, get a fresh review or isolate the component. Do not reset user work or disable a security/inventory constraint to pass tests.
```

## Close checkpoint

```text
Update HANDOFF with objective, actual paths, decisions/source versions, exact pass/fail/not-run commands, manual web/native evidence, verified criteria, unresolved issues/owners, rollback and next action. Inspect diff for unrelated edits. Do not call the task complete until its definition of done is met.
```
