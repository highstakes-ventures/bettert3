import type { WorkflowDetail } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { ticketType } from "./workflow.ts";

function Link({ href, children }: { href: string; children: ReactNode }) {
  return /^https?:\/\//i.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

/** Ticket presentation is colocated with its workflow; the client supplies its controls and markdown renderer. */
export function RefinementPanel({
  detail,
  projectControl,
  actions,
  renderMarkdown,
  refreshControl,
}: {
  detail: WorkflowDetail;
  projectControl: ReactNode;
  actions: ReactNode;
  refreshControl: ReactNode;
  renderMarkdown: (text: string) => ReactNode;
}) {
  const ticket = detail.ticket;
  if (!ticket)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        The agent is preparing this ticket. Continue in the chat if it needs more information.
      </div>
    );
  const priority =
    ["No priority", "Urgent", "High", "Normal", "Low"][ticket.priority] ?? "No priority";
  const type = ticketType(ticket.labels);
  const otherLabels = ticket.labels.filter((label) => label.id !== type?.id);
  return (
    <section aria-label="Ticket refinement" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3 text-xs text-muted-foreground">
        <span>{ticket.identifier}</span>
        <div className="flex items-center gap-3">
          {refreshControl}
          <Link href={ticket.url}>Open in Linear ↗</Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <h2 className="text-xl font-semibold leading-snug tracking-tight">{ticket.title}</h2>
        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-5 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Target project</dt>
          <dd className="min-w-0">{projectControl}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{type?.name ?? "Choose in chat"}</dd>
          <dt className="text-muted-foreground">Priority</dt>
          <dd>{priority}</dd>
          {otherLabels.length ? (
            <>
              <dt className="text-muted-foreground">Labels</dt>
              <dd className="flex flex-wrap gap-1">
                {otherLabels.map((label) => (
                  <span key={label.id} className="rounded bg-muted px-2 py-0.5 text-xs">
                    {label.name}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {ticket.estimate !== null ? (
            <>
              <dt className="text-muted-foreground">Estimate</dt>
              <dd>{ticket.estimate}</dd>
            </>
          ) : null}
          {ticket.dueDate ? (
            <>
              <dt className="text-muted-foreground">Due</dt>
              <dd>{ticket.dueDate}</dd>
            </>
          ) : null}
        </dl>
        {detail.questions.length > 0 && (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-warning/30 bg-warning-surface p-3 text-sm"
          >
            {detail.questions.map((question) => (
              <p key={question}>{question}</p>
            ))}
          </div>
        )}
        {detail.run.error && (
          <p role="status" className="text-sm text-muted-foreground">
            {detail.run.error}
          </p>
        )}
        <div className="text-sm">{renderMarkdown(ticket.description)}</div>
        {(ticket.blockedBy.length > 0 || ticket.blocks.length > 0) && (
          <section className="space-y-3 border-t pt-4 text-sm">
            <h3 className="font-medium">Dependencies</h3>
            {ticket.blockedBy.map((issue) => (
              <div key={issue.id} className="flex items-baseline gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">Blocked by</span>
                <Link href={issue.url}>
                  {issue.identifier} · {issue.title}
                </Link>
                <span className="ml-auto text-xs text-muted-foreground">{issue.stateType}</span>
              </div>
            ))}
            {ticket.blocks.map((issue) => (
              <div key={issue.id} className="flex items-baseline gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">Blocks</span>
                <Link href={issue.url}>
                  {issue.identifier} · {issue.title}
                </Link>
              </div>
            ))}
          </section>
        )}
        {ticket.resources.length > 0 && (
          <section className="space-y-2 border-t pt-4 text-sm">
            <h3 className="font-medium">Resources</h3>
            {ticket.resources.map((resource) => (
              <div key={resource.url}>
                <Link href={resource.url}>{resource.title}</Link>
              </div>
            ))}
          </section>
        )}
        {ticket.comments.length > 0 && (
          <section className="space-y-4 border-t pt-4 text-sm">
            <h3 className="font-medium">Activity</h3>
            {ticket.comments.map((comment) => (
              <article key={comment.id}>
                <p className="mb-1 text-xs text-muted-foreground">
                  {comment.author} ·{" "}
                  <time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 10)}</time>
                </p>
                {renderMarkdown(comment.body)}
              </article>
            ))}
          </section>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">Refined on approval</span>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </footer>
    </section>
  );
}
