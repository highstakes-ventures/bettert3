# Shared ticket brief

Preparation writes a PR-style proposal. Refinement maintains that proposal and
adds the implementation design. Keep the same description authoritative throughout.
Scale supporting detail to the change rather than filling every section mechanically.

## Preparation form

- **Problem.** Current behavior, concrete consequence, and decisive evidence.
- **User story.** Who needs what and why, in plain language. A system operator
  or developer can be the actor; do not invent a customer persona.
- **Proposed solution.** Intended behavior and the smallest supported approach.
  Identify unsettled choices rather than presenting them as approved.
- **Flow.** The smallest useful user or system flow diagram. Compare current
  and proposed behavior when that comparison explains the change. Keep diagrams
  readable in Linear using supported Markdown, text, or a real linked asset.
- **Change impact.** Affected responsibilities and scope. Include explicit
  exclusions when they prevent a plausible misunderstanding.
- **Acceptance criteria.** Independently checkable outcomes, including important
  preserved behavior. Replace vague adjectives with observable results.
- **Evidence.** Real screenshots, examples, traces, and repository references
  with their revision. Distinguish present evidence from proposed mockups.
- **Risks and open questions.** Material uncertainty that needs a decision or
  more evidence. Keep a question next to the affected requirement when clearer.

Do not invent final file counts, an implemented hierarchy, speedups, passing
tests, or before/after implementation evidence during preparation. Native project,
priority, labels, and dependencies stay authoritative in Linear fields.

## Refinement extension

Keep the preparation sections current as decisions settle. Add the following
implementation detail where it applies. A small correction needs a smaller
design than a new workflow, but each ticket must explain its actual change.

### Architecture

Ground the design in the actual repository and its closest working pattern.
Show the responsibility hierarchy with current or proposed symbols, the owner
of authoritative state, and the dependency direction. Include a representative
call-flow diagram naming entry points, validation, business logic, persistence,
side effects, and outputs where those boundaries matter.

Describe important interfaces and data contracts, including inputs, outputs,
and compatibility constraints. Mark proposed symbols and paths as suggestions
unless their identity is a real contract. Explain material errors, retries,
concurrency, cancellation, or recovery behavior that the change affects.
Do not create classes or layers merely to populate an architecture diagram.

### Scope and decisions

Record agreed product and architecture choices, material tradeoffs, behavior
that must remain intact, and explicit exclusions. Separate binding decisions
from implementation suggestions. Keep remaining blocking questions visible.

### Implementation and verification

Start with the smallest useful end-to-end change, then describe necessary
dependent steps. One ticket should normally deliver one coherent PR. Discuss
any split with the user instead of decomposing the work automatically.

For each material acceptance criterion, state its stimulus, observable outcome,
and the appropriate proof. Identify relevant existing checks and practical
commands, required fixtures or access, and significant edge cases. Choose proof
appropriate to the risk rather than requiring a new automated test for every edit.

Add migrations, compatibility, deployment ordering, and rollback when relevant.
Do not treat implementation approval as merge or production-release approval.

### Delivery agreement

The implementation owner delivers the approved change, validation evidence,
independent review and repairs, and a PR that satisfies the repository's required
checks. Include relevant screenshots and documentation in that finish condition.
State unresolved access or external prerequisites before approval.

An independent auditor compares the exact PR revision with the preserved,
approved version of this brief and its supporting evidence. Later ticket edits
must not silently replace that reference. The auditor reports missing criteria,
design deviations, unapproved additions, and missing proof to the implementation
owner. Audit findings are repaired before claiming merge readiness.

Approval requires settled scope and design, checkable acceptance criteria, and
no blocking product or architecture questions. Dependencies may still be
unfinished native blockers; the workflow waits before launching implementation.

## Source guidance

The visual emphasis follows the user's [delivery repair PR](https://github.com/recuut/platform/pull/1100)
and [revenue PR](https://github.com/recuut/platform/pull/1091). This brief is a
proposal format, so their post-implementation counts and validation claims do not
carry over. Concrete examples and explicit questions are informed by
[Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/).
The format and approval boundary are BetterT3 workflow decisions.
