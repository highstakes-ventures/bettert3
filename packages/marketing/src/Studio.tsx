import { useState, type ReactNode } from "react";
import type { HumanCommand, StudioResponse } from "./contracts.ts";
import { SocialPostPreview, PreviewToggle } from "./PostPreview.tsx";

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
  const [destination, setDestination] = useState<"company" | "personal" | "x">("company");
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(false);
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
      <div className="scrollbar-gutter-both min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <nav aria-label="Post previews" className="flex flex-wrap gap-1 border-b pb-3">
          <PreviewToggle
            selected={destination === "company"}
            onClick={() => setDestination("company")}
          >
            LinkedIn · recuut
          </PreviewToggle>
          <PreviewToggle
            selected={destination === "personal"}
            onClick={() => setDestination("personal")}
          >
            Personal repost{d.personal.enabled ? "" : " · Not selected"}
          </PreviewToggle>
          <PreviewToggle selected={destination === "x"} onClick={() => setDestination("x")}>
            X · Preview only
          </PreviewToggle>
        </nav>
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          aria-label="Preview display"
        >
          <div className="flex gap-1">
            <PreviewToggle selected={!mobile} onClick={() => setMobile(false)}>
              Desktop
            </PreviewToggle>
            <PreviewToggle selected={mobile} onClick={() => setMobile(true)}>
              Mobile
            </PreviewToggle>
          </div>
          <div className="flex gap-1">
            <PreviewToggle selected={!dark} onClick={() => setDark(false)}>
              Light
            </PreviewToggle>
            <PreviewToggle selected={dark} onClick={() => setDark(true)}>
              Dark
            </PreviewToggle>
          </div>
        </div>
        <div className="mx-auto w-full min-w-0" style={{ maxWidth: mobile ? 360 : 552 }}>
          <SocialPostPreview
            key={destination}
            platform={destination === "x" ? "x" : "linkedin"}
            personal={destination === "personal"}
            text={
              destination === "personal"
                ? d.personal.text
                : destination === "x"
                  ? (d.xText ?? "")
                  : d.company.text
            }
            media={d.media}
            dark={dark}
            {...(destination === "personal"
              ? { company: { text: d.company.text, media: d.media } }
              : {})}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {destination === "x"
            ? "X preview only. Standard post limits use X’s weighted character rules. X publishing is not connected."
            : "Approximate feed preview. The collapsed cutoff can vary with the live platform and device."}
          {destination === "personal"
            ? " Your profile image is not connected. Only your supplied reaction is included."
            : " The logo comes from recuut’s brand assets; the live account identity is not connected."}
        </p>
        {destination === "personal" && !d.personal.enabled && (
          <p className="text-sm text-muted-foreground">
            Personal repost is not selected. Give the agent your own reaction in chat to include it.
          </p>
        )}
        <details className="border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Release brief and sources
          </summary>
          <div className="space-y-3 pt-3 text-sm">
            <h2 className="font-semibold">
              {d.highlights?.title ?? "Choosing the release highlights"}
            </h2>
            <p className="text-muted-foreground">
              {d.highlights?.summary ??
                "The release agent will fill this brief as you refine it together."}
            </p>
            {d.highlights && (
              <ul className="list-disc space-y-2 pl-5">
                {d.highlights.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {d.company.author && (
              <p className="text-xs text-muted-foreground">
                Company destination: {d.company.author}
              </p>
            )}
            {d.personal.enabled && d.personal.author && (
              <p className="text-xs text-muted-foreground">
                Personal destination: {d.personal.author}
              </p>
            )}
          </div>
        </details>
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
                      "Approve LinkedIn posts and publish",
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
