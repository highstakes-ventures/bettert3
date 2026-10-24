# Shared ticket brief

Preparation researches context, ordering, and dependencies and writes a grounded
proposal for the refinement queue. It does not need an implementable design.
Refinement is the in-depth discussion that settles choices and adds the
implementation design. Keep the same description authoritative throughout.
Scale supporting detail to the change rather than filling every section mechanically.

## Writing style and length

Use mostly ASD-STE100-style English. Write short sentences in active voice.
Use plain words and one idea per sentence. State one checkable requirement per
acceptance bullet or table row. Keep exact technical names, code, and necessary domain terms.
Do not force them into a controlled vocabulary or claim formal STE compliance.

Use one or two short sentences for context. Put requirements, proof, and open
decisions in bullets or compact tables. Use a small flow for sequence and branches;
do not explain the same flow again in a paragraph. Write complete, clear requirements
instead of compressing them into unexplained abbreviations.

Aim for 150 to 250 words during preparation. This is a guide, not a hard limit.
Refinement adds the design and proof needed to implement the change in the same
format. Prefer a responsibility map and call flow to an architecture essay. Do not
remove requirements, important preserved behavior, or blockers to meet a word count.

Keep decisive facts in the ticket. Link detailed traces, research, source evidence,
and test procedures through durable, accessible references. Do not paste a research
report into the description or link a temporary local file as its only evidence.
If no durable link is available, include the essential facts inline. Links support
the brief; they do not replace its agreed requirements or architecture decisions.

## Preparation form

Use known requirements and researched options. Mark suggestions as provisional
and record missing product or design decisions for refinement. Do not ask the
user to complete these sections during preparation or invent answers to fill
the template. Continue independent background research before handing off.

| Section                  | Output shape                     | Required content                                                                                        |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Problem                  | One or two short sentences       | Current behavior, concrete consequence, decisive evidence.                                              |
| User story               | One sentence                     | Who needs what and why. A developer or operator can be the actor; do not invent a persona.              |
| Proposed solution        | One or two short sentences       | Smallest supported approach, intended behavior, scope, unsettled choices.                               |
| Flow                     | Small Markdown-supported diagram | Sequence and branches. Compare current and proposed behavior only when useful.                          |
| Change impact, if needed | Short bullets                    | Responsibility changes or exclusions that prevent a plausible misunderstanding.                         |
| Acceptance criteria      | Bullets or compact table         | One independently checkable outcome per item, including important preserved behavior.                   |
| Verification             | Short bullets                    | Owning layer, decisive stimulus and expected result, necessary checks. Link detailed procedures.        |
| Evidence                 | Links with short qualifiers      | Inspected revision, real screenshots, examples or traces. Distinguish observed evidence from proposals. |
| Open decisions, if any   | Short bullets                    | Unresolved choices for refinement; research factual gaps where possible.                                |

Omit empty or redundant sections. Do not add a search transcript, a duplicate-check
essay, or a prose copy of native metadata. Report a material duplicate or dependency
uncertainty briefly where the user needs to decide it.

Before submitting, remove repeated facts and convert narrative requirements or
test plans into the shapes above. Each statement should add a fact, requirement,
decision, or proof that the other sections do not already contain. Keep agreed
requirements and architecture in the description; do not hide them in evidence
comments to make the ticket shorter.

Do not invent final file counts, an implemented hierarchy, speedups, passing
tests, or before/after implementation evidence during preparation. Native project,
priority, labels, and dependencies stay authoritative in Linear fields.

## Refinement extension

Rewrite the preparation sections as decisions settle. Do not append a history of
the refinement conversation. Add the following
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
