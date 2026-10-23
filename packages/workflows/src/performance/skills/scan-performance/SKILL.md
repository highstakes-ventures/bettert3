---
name: scan-performance
description: Inspect a codebase for evidenced performance costs and submit actionable findings to BetterT3 ticket preparation. Use for a performance scan, not implementation, general cleanup, or speculative optimization.
---

# Scan performance

Find current performance costs that deserve ticket intake. Empty findings are
valid. Ten is the current scan ceiling, not a quota.

## Choose where to look

Read the repository instructions, manifests, runtime entry points, existing
performance evidence, and relevant ticket context with `t3_workflow_read` and
`t3_workflow_search`. Identify the actual stack before choosing diagnostics.
Investigate credible high-use or expensive paths and follow their callers to
establish that they are reachable. A pattern match is a lead, not a finding.

Consider repeated work, query and transport volume, blocking callbacks,
render/update cost, allocation or retention, contention, and input growth where
they apply. Distinguish a user-visible symptom from its suspected cause.

Search results are bounded candidates. Select plausible issue IDs and call
`t3_workflow_ticket_read` before comparing complete evidence or ruling out a
duplicate. `descriptionTruncated` marks incomplete context. If `hasMore` is true,
refine the query before treating the search as sufficient. Keep candidate excerpts
distinct from complete ticket descriptions, comments, and resources.

## Establish the evidence

Reuse existing traces, profiles, benchmark results, and repository checks first.
Label their revision, environment, workload, time window, and measurement scope.
Keep local lab measurements distinct from real-user or production observations.
Preserve distributions when available; an average can hide a slow tail.

Only run diagnostics that fit the task's authorization and repository rules.
Inspect commands first, bound the workload, and keep artifacts outside tracked
source. Do not mutate source, install agents, stress shared services, or assume
a diagnostic command is read-only. `EXPLAIN ANALYZE` executes its query.

Separate measured symptoms, source-proved extra work with unmeasured timing,
and unsupported hypotheses. Query counts and algorithmic growth do not establish
elapsed latency. A missing cache, index, memoization, or profiler alone is not
evidence of a defect. Check existing batching, caching, and input limits before
proposing an optimization. Do not invent baselines, percentiles, or speedups.

Admit a finding only when it has a current reachable path, decisive evidence,
a credible user or system consequence, and a concrete verification method.
If workload context or causality is missing, report the gap rather than promoting
a guess. Rank by supported impact, exposure, confidence, and actionability.
Group symptoms of one demonstrated mechanism instead of producing fragments.

## Submit ticket intake

Search for existing findings before new intake. Return zero to ten findings via
`t3_workflow_result`, `type: scan`. Each finding has a stable short `key` and a
`request` that carries the problem, repository revision and source locations,
observed quantity and its limits, consequence, bounded proposed direction,
verification method, and relevant existing ticket references.

These findings enter the same ticket flow as other requests. `prepare-tickets`
owns the standard brief and native metadata; `refine-tickets` settles product
decisions and splitting. Do not implement a finding, create a parallel ticket
format, approve work, or create another schedule.

## Sources

Original guidance informed by [Brendan Gregg's USE method](https://www.brendangregg.com/usemethod.html),
[Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/),
and web.dev's [lab and field data](https://web.dev/articles/lab-and-field-data-differences).
Use the applicable runtime's official diagnostics, such as
[Node's event loop guidance](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop)
or [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html).
These references supply investigation methods, not universal thresholds.
