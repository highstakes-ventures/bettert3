# BetterT3 boundaries

BetterT3 regularly merges stable `pingdotgg/t3code` releases. Keep custom decisions
in their owning modules so an upstream change does not require resolving the same
product rule in several files. Moving code does not prove compatibility: an
upstream change around a clean integration point still needs semantic review.

## Ownership

| Concept                                       | Owner and permitted integration                                                                                                                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider sessions, run state and chat history | T3 execution services. Cloud `runDestination`, project `sectionId` and fork command cases remain explicit core extensions. Do not move their validation into clients.                                                                                                         |
| Product rules and integrations                | `mation`, `workflows`, `pai`, `todo` and `marketing` services. They call T3 services through existing typed contracts. HTTP, WS and MCP handlers check request scope and call the owning service.                                                                             |
| Automation ownership                          | Mation owns automation definitions, settings and schedule history after explicit cutover. T3 owns execution history. Keep the existing `ScheduledTaskService` implementation choice and generic `ExecutionRequestService`; a Mation outage must not start a native scheduler. |
| Thread-list presentation rules                | Pure functions in client-runtime consume existing thread entities and explicit feature context. Clients retain their current visibility differences. A Todo visibility override still obeys project scope.                                                                    |
| Categories                                    | Shared category matching stays in `threadSections`; web coordination, menus and headings stay in `sidebar/ThreadSections`. Reuse the existing UI store, permission-aware commands and projections.                                                                            |
| Contracts and stored data                     | Contracts own typed wire fields. Custom migrations use `BetterT3Migrations` and `bettert3_sql_migrations`. Never reuse an upstream migration number for custom schema.                                                                                                        |

## Dependency checks and exceptions

The server import overrides in [vite.config.ts](../../vite.config.ts) prevent
production orchestration and provider modules from importing product services.
Tests may compose real product implementations. `runtimeLayer.ts` is the service
composition exception; transport toolkits remain adapters for their services.

`bettert3Http` and `bettert3Rpc` compose the fork's API groups with T3's groups.
The core API declarations must not import the fork's groups: composition imports
core authentication and authorization tags, so the reverse dependency creates a
cycle. Keep endpoint names, scopes and stored field encodings stable when moving
definitions. `bettert3ThreadFields` owns the typed additions to existing records;
those additions still participate in T3's command and replay validation.

`ProjectionStore` has one import exception for `ThreadShellIntegrations`. Its SQL
fragments execute inside the store's existing statements and transaction, preserving
snapshot consistency and indexes. The adapter owns workflow joins and PAI review
interpretation; it must not make network requests or perform per-thread reads.
`draftRunDestination` owns pure destination decisions, while `composerDraftStore`
continues to own drafts, preferences and persistence.

`ThreadManagementService` has one statement-level exception for
`WorkflowThreadPolicy`. This is an admission guard, not workflow execution. It
rejects writable or worktree delegation from refinement chats and descendants
before committing child work. Preserve the related MCP guard. The negative cases
belong to `ThreadManagementService.test.ts` and `WorkflowThreadPolicy.test.ts`.

When a change introduces another dependency across this boundary, update the
restriction, its reason here and the proof of its invariant in that same change.
Keep exceptions as narrow as their responsibility. A lint suppression must not
move authoritative permission checks into a client or transport-only path.

## Maintaining upstream imports

For each import, record the stable upstream commit, the previously incorporated
upstream commit and the exact fork candidate. Preserve real merge ancestry and
reconcile concurrent fork `main` changes before publication. Regenerate the
lockfile after resolving manifests rather than hand-merging it.

Review upstream changes around each retained core extension and client
integration even when Git reports no conflict. Preserve upstream code shape
where practical; unrelated formatting and control-flow rewrites enlarge future
conflicts. A feature change touching a shared hotspot must identify the concept
that requires it and the existing or new proof that protects its behavior.

Retain actual conflicting paths and per-hotspot fork deltas in the upgrade's
evidence, not in a permanent file inventory. These are advisory measurements,
not release limits. Verify semantics through focused existing checks: client
placement and project scope, refinement admission, Mation ownership through an
outage, execution replay and migration-history preservation when affected.

Rehearse a newer stable release in an isolated checkout with copied development
state. If no newer release exists, record forward rehearsal as pending. A
historical replay or a smaller diff cannot establish future compatibility.
Keep source integration, installation and live verification distinct. Follow the
existing weekly cadence and guarded Custom runtime installation procedure.
