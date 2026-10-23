---
name: scan-refactor
description: Inspect a codebase for bounded refactors supported by present maintenance cost or concrete failure risk, then submit findings to BetterT3 ticket preparation. Do not generate cleanup tickets from file size, style, or duplication alone.
---

# Scan refactor

Find structural improvements with a concrete reason to make them. Preserve
observable behavior. Empty findings are valid; ten is a ceiling, not a quota.

Read repository instructions, current code and callers, relevant tests, and
bounded history where useful. Use `t3_workflow_read` and `t3_workflow_search`
for context and existing-ticket discovery. Record the inspected revision.

Search results are bounded candidates. Select plausible issue IDs and call
`t3_workflow_ticket_read` before comparing complete evidence or ruling out a
duplicate. `descriptionTruncated` marks incomplete context. If `hasMore` is true,
refine the query before treating the search as sufficient. Keep candidate excerpts
distinct from complete ticket descriptions, comments, and resources.

## Investigate maintenance cost

Start with repeated repairs, one rule changed in several places, unclear
responsibilities, current misuse risk, or shared helpers that accumulate unrelated
caller cases. Complexity and churn help choose where to investigate; neither
proves a worthwhile refactor. Long files and similar syntax alone are insufficient.

Verify that apparently inconsistent paths are intended to follow the same rule.
Inspect actual callers, input differences, and documented constraints before
claiming drift. A proposed behavior change belongs in explicit bug or product
scope rather than being hidden inside a cleanup recommendation.

Prefer the smallest independently useful structural improvement. Consider
deletion, reuse, inlining, and a local correction before extracting a shared
abstraction. Explain why the selected direction addresses the observed cost.
Do not prescribe a future extension point without a present requirement.

## Define the safe boundary

Name the observable behavior, errors, and side effects that must remain intact.
Identify relevant existing proof or a concrete characterization need when intent
is unclear. A surprising current output is not automatically a bug. Proposed
proof should detect a meaningful behavioral change rather than freeze helper
layout or inflate coverage.

A finding needs present maintenance cost or concrete risk, decisive source
evidence, a bounded improvement, a behavior invariant, and focused verification.
Separate observed facts from inference. If the evidence is missing, withhold the
ticket and report the gap instead of filling the scan with style preferences.

## Submit ticket intake

Search for existing issues and preserve their references in the finding. Return
zero to ten findings through `t3_workflow_result`, `type: scan`. Each has a stable
short `key` and a `request` containing the maintenance outcome, why it matters now,
revision and source/caller evidence, bounded proposed direction, preserved behavior,
verification method, uncertainty, and any evidenced prerequisite.

`prepare-tickets` supplies the shared brief, metadata, and native dependencies.
`refine-tickets` settles scope and any split with the user. Do not create automatic
per-file or prerequisite tickets. Do not edit code, add tests, implement a finding,
approve work, or create schedules during the scan.

## Sources

Original guidance informed by [Fowler's refactoring definition](https://refactoring.com/),
[Google Engineering Practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html),
[Sandi Metz's The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction),
and [Michael Feathers's Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing).
Google's documentation is [CC BY 3.0](https://github.com/google/eng-practices/blob/master/README.md#license).
The instructions here use original wording and do not copy their articles or examples.
