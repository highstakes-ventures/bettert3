import { useState, type ReactNode } from "react";
import type { HumanCommand, StudioResponse } from "./contracts.ts";

/** The host supplies transport and controls; this package owns the complete release-review presentation. */
export function ReleaseStudio({
  value,
  busy,
  error,
  act,
  button,
}: {
  value: StudioResponse;
  busy: boolean;
  error: string | null;
  act: (command: HumanCommand) => void;
  button: (label: string, action: () => void, disabled: boolean) => ReactNode;
}) {
  const [feedback, setFeedback] = useState("");
  const d = value.draft;
  if (!d)
    return (
      <section className="p-5 text-sm text-muted-foreground">
        This conversation has no release draft. A verified production release creates its own
        conversation and Studio.
      </section>
    );
  const published = d.companyPublication.status === "published";
  const locked =
    published ||
    [d.companyPublication.status, d.personalPublication.status].some(
      (s) => s === "sending" || s === "uncertain",
    );
  const review = d.selectionApproved;
  return (
    <section
      aria-label="Release Studio"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3 text-xs text-muted-foreground">
        <span>Release Studio</span>
        <a
          href={d.release.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {d.release.tag}
        </a>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold leading-snug tracking-tight">
            {d.highlights?.title ?? "Choosing the release highlights"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {d.highlights?.summary ??
              "The agent is reviewing the release. Its recommended combination will appear here and in the conversation."}
          </p>
        </div>
        {d.highlights && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Selected highlights</h3>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {d.highlights.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        <>
          <section aria-label="recuut company post" className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">recuut · LinkedIn company update</h3>
              <span className="text-xs text-muted-foreground">Included</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {d.company.text || "The post draft will appear here as we prepare it."}
            </p>
            {d.media.map((m) => (
              <figure key={m.id} className="space-y-2">
                <img src={m.dataUrl} alt={m.alt} className="h-auto w-full rounded-lg" />
                <figcaption className="text-xs text-muted-foreground">{m.alt}</figcaption>
              </figure>
            ))}
            {d.company.author && (
              <p className="text-xs text-muted-foreground">Destination: {d.company.author}</p>
            )}
            {d.companyPublication.url && (
              <a
                href={d.companyPublication.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline"
              >
                Open company post
              </a>
            )}
          </section>
          <section aria-label="Personal repost" className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Your personal repost</h3>
              <span className="text-xs text-muted-foreground">
                {d.personal.enabled ? "Included" : "Not selected"}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {d.personal.text ||
                "Optional. Tell the agent your own reaction in the conversation to include a personal repost."}
            </p>
            <p className="text-xs text-muted-foreground">
              Shares the company update after it is published.
            </p>
            {d.personal.enabled && d.personal.author && (
              <p className="text-xs text-muted-foreground">Destination: {d.personal.author}</p>
            )}
            {d.personalPublication.url && (
              <a
                href={d.personalPublication.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline"
              >
                Open personal repost
              </a>
            )}
          </section>
        </>
        {(error || d.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? d.error}
          </p>
        )}
        {!value.publishingConfigured && (
          <p role="status" className="text-sm text-muted-foreground">
            {value.publishingReason}
          </p>
        )}
        {d.stage === "published" ? (
          <p role="status" className="text-sm font-medium">
            The selected posts are published. Their links are saved in this Studio.
          </p>
        ) : (
          !locked && (
            <section className="space-y-3 border-t pt-5">
              <label htmlFor="release-feedback" className="block text-sm font-medium">
                Feedback for the agent
              </label>
              <textarea
                id="release-feedback"
                rows={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={busy}
                className="w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What should change?"
              />
              <div className="flex flex-wrap gap-2">
                {button(
                  "Send feedback",
                  () => {
                    act({ type: "feedback", expectedRevision: d.revision, feedback });
                    setFeedback("");
                  },
                  busy || !feedback.trim(),
                )}
                {!review
                  ? button(
                      "Approve highlights and prepare",
                      () => act({ type: "approve_highlights", expectedRevision: d.revision }),
                      busy || !d.highlights,
                    )
                  : button(
                      "Approve selected posts and publish",
                      () => act({ type: "approve_publication", expectedRevision: d.revision }),
                      busy ||
                        !d.company.text ||
                        d.media.length !== 1 ||
                        !value.publishingConfigured ||
                        d.stage === "approved" ||
                        d.stage === "publishing",
                    )}
              </div>
              <p className="text-xs text-muted-foreground">
                {review
                  ? "Approval covers the selected accounts, exact text and image above. A content change requires fresh approval."
                  : "Approval starts preparation automatically. Nothing publishes at this stage."}
              </p>
            </section>
          )
        )}
        {["company", "personal"].map((channel) => {
          const publication = channel === "company" ? d.companyPublication : d.personalPublication;
          return publication.status === "uncertain" ? (
            <div key={channel} className="space-y-2 border-t pt-4">
              <p className="text-sm">
                Check LinkedIn for the{" "}
                {channel === "company" ? "company update" : "personal repost"} before retrying.
              </p>
              {button(
                `I checked: ${channel === "company" ? "company update" : "personal repost"} was not published`,
                () =>
                  act({
                    type: "confirm_not_published",
                    expectedRevision: d.revision,
                    channel: channel as "company" | "personal",
                    expectedAttempt: publication.attempt ?? 0,
                  }),
                busy,
              )}
            </div>
          ) : null;
        })}
        {locked && d.stage !== "published" && (
          <p role="status" className="text-sm text-muted-foreground">
            Publication has started. The agent will verify the saved result before making another
            publishing attempt.
          </p>
        )}
      </div>
    </section>
  );
}
