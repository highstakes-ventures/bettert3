import { useEffect, useRef, useState, type ReactNode } from "react";
import twitterText from "twitter-text";
import type { Media } from "./contracts.ts";

const avatar = new URL("./assets/recuut-avatar.png", import.meta.url).href;
const iconPaths = {
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
  like: "M7 10H3v11h4m0-11 5-8c2 0 3 2 2 5l-1 3h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 1H7Z",
  comment: "M21 11a9 9 0 0 1-9 9H4l-3 2 2-6A9 9 0 1 1 21 11Z",
  repost: "M4 15V5h13m-4-4 4 4-4 4M20 9v10H7m4-4-4 4 4 4",
  send: "m22 2-8 20-4-9L1 9Zm-12 11L22 2",
  heart: "M20 4c-3-2-6 0-8 3-2-3-5-5-8-3-6 5 2 11 8 16 6-5 14-11 8-16Z",
  views: "M4 20V9m5 11V4m5 16v-8m5 8V2",
  bookmark: "M6 3h12v19l-6-4-6 4Z",
} as const;
const linkedinIconPaths = {
  like: "M8.914 1a2.47 2.47 0 0 1 2.361 1.747c.57 1.86 1.063 3.075 1.897 3.979.818.886 2.044 1.552 4.258 2.1l.57.14v8.696h-1.677c-.942 0-1.53.27-2.188.593-.676.33-1.468.745-2.648.745H5.433a2.09 2.09 0 0 1-2.088-2.088v-.746a2.08 2.08 0 0 1-.893-1.707v-1.225a2.97 2.97 0 0 1-.891-2.12 2.98 2.98 0 0 1 2.979-2.98h2.357a21 21 0 0 1-.155-.89C6.577 6.15 6.44 4.656 6.56 3.098 6.657 1.833 7.753 1 8.914 1M3.061 11.114c0 .481.23.91.592 1.182l.3.225v1.938c0 .253.16.47.392.553l.5.176v1.724c0 .325.263.588.588.588h6.054c.792 0 1.298-.255 1.988-.593.707-.346 1.55-.745 2.848-.745h.177v-6.03c-2.034-.563-3.42-1.296-4.43-2.39-1.086-1.176-1.657-2.69-2.23-4.554a.97.97 0 0 0-.926-.688c-.486 0-.829.334-.858.713-.11 1.408.015 2.78.17 3.808a19 19 0 0 0 .302 1.56l.022.083.006.024.257.947H4.54a1.48 1.48 0 0 0-1.48 1.48z",
  comment:
    "M1 9a7 7 0 0 1 7-7h3.7a7.3 7.3 0 0 1 3.047 13.935L8.25 18.92V16H8a7 7 0 0 1-7-7m1.5 0A5.5 5.5 0 0 0 8 14.5h1.75v2.08l4.371-2.009A5.8 5.8 0 0 0 11.7 3.5H8A5.5 5.5 0 0 0 2.5 9",
  repost:
    "M17.5 12.55c0 .547.001 1.004-.03 1.375-.03.38-.098.736-.27 1.073a2.75 2.75 0 0 1-1.202 1.202c-.337.172-.693.24-1.073.27-.371.031-.828.03-1.375.03H7.815l1.632 1.63-1.06 1.061-3.448-3.444L8.387 12.3l1.06 1.06L7.81 15h5.74c.573 0 .958 0 1.254-.024.287-.024.424-.067.514-.113.236-.12.426-.31.546-.546.046-.09.09-.227.113-.514.024-.296.024-.68.024-1.253V7.917h1.5zm-2.523-8.296L11.53 7.7l-1.06-1.06L12.11 5H6.45c-.572 0-.957 0-1.253.024-.287.024-.424.067-.514.113a1.25 1.25 0 0 0-.546.546c-.046.09-.09.227-.113.514C4 6.493 4 6.877 4 7.45v4.633H2.5V7.45c0-.547-.001-1.004.03-1.375.03-.38.098-.736.27-1.073A2.75 2.75 0 0 1 4.002 3.8c.337-.172.693-.24 1.073-.27.371-.031.828-.03 1.375-.03h5.65l-1.63-1.63L11.53.81z",
  send: "m12.164 19.384-4.217-7.831-7.83-4.216 18.07-6.023zM3.884 7.662l4.48 2.413L9.971 8.47l1.06 1.06-1.606 1.606 2.413 4.48 3.977-11.93-11.93 3.976z",
} as const;
function Icon({
  name,
  size = 18,
  linkedin = false,
}: {
  name: keyof typeof iconPaths;
  size?: number;
  linkedin?: boolean;
}) {
  const nativePath =
    linkedin && name in linkedinIconPaths
      ? linkedinIconPaths[name as keyof typeof linkedinIconPaths]
      : null;
  if (nativePath)
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d={nativePath} />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
function PostText({
  text,
  fold,
  secondary,
  inset = false,
  expanded,
  expand,
}: {
  text: string;
  fold: boolean;
  secondary: string;
  inset?: boolean;
  expanded: boolean;
  expand: () => void;
}) {
  const [collapsedText, setCollapsedText] = useState<string | null>(null);
  const element = useRef<HTMLParagraphElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures feed wrapping with room for the inline expansion control
  useEffect(() => {
    const node = element.current;
    if (!node || !fold || !text) {
      setCollapsedText(null);
      return;
    }
    const measure = () => {
      const computed = getComputedStyle(node);
      const probe = node.cloneNode(false) as HTMLParagraphElement;
      Object.assign(probe.style, {
        position: "fixed",
        visibility: "hidden",
        pointerEvents: "none",
        width: `${node.getBoundingClientRect().width}px`,
        maxHeight: "none",
        font: computed.font,
        letterSpacing: computed.letterSpacing,
      });
      probe.setAttribute("aria-hidden", "true");
      probe.textContent = text;
      document.body.append(probe);
      try {
        const height = Number.parseFloat(computed.lineHeight) * 3 + 1;
        if (probe.getBoundingClientRect().height <= height) {
          setCollapsedText(null);
          return;
        }
        const characters = Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
          (part) => part.segment,
        );
        const prefix = document.createTextNode("");
        const suffix = document.createElement("span");
        suffix.textContent = " …see more";
        suffix.style.whiteSpace = "nowrap";
        probe.replaceChildren(prefix, suffix);
        let low = 0;
        let high = characters.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          prefix.textContent = characters.slice(0, middle).join("").trimEnd();
          if (probe.getBoundingClientRect().height <= height) low = middle;
          else high = middle - 1;
        }
        setCollapsedText(characters.slice(0, low).join("").trimEnd());
      } finally {
        probe.remove();
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, fold]);
  const collapsed = fold && !expanded && collapsedText !== null;
  return (
    <div style={{ marginTop: inset ? -20 : 0, padding: inset ? "0 16px 12px 68px" : "0 12px" }}>
      <p
        ref={element}
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: inset ? 15 : 14,
          lineHeight: "20px",
          maxHeight: fold && !expanded ? 60 : undefined,
          overflow: "hidden",
        }}
      >
        {text ? (
          collapsed ? (
            collapsedText
          ) : (
            text
          )
        ) : (
          <span style={{ color: secondary }}>The post draft will appear here.</span>
        )}
        {collapsed && (
          <>
            {" "}
            <button
              type="button"
              aria-expanded={false}
              onClick={expand}
              style={{
                padding: 0,
                border: 0,
                background: "none",
                color: secondary,
                cursor: "pointer",
                font: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              …see more
            </button>
          </>
        )}
      </p>
      {fold && text && (
        <div
          aria-label="Translation control, preview only"
          style={{
            display: "flex",
            alignItems: "center",
            height: 48,
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 600,
            color: secondary,
          }}
        >
          See translation
        </div>
      )}
    </div>
  );
}
function Author({
  personal,
  platform,
  secondary,
}: {
  personal?: boolean;
  platform: "linkedin" | "x";
  secondary: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: platform === "x" ? 12 : 8,
        alignItems: "flex-start",
        padding: platform === "x" ? "12px 16px 0" : "12px 12px 8px",
      }}
    >
      {personal ? (
        <span
          aria-label="Personal profile image not connected"
          style={{
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            width: 40,
            height: 40,
            background: "#e7e9eb",
            color: "#404447",
            fontWeight: 600,
          }}
        >
          J
        </span>
      ) : (
        <img
          src={avatar}
          alt="recuut logo"
          width={40}
          height={40}
          style={{ borderRadius: platform === "x" ? "50%" : 8, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: platform === "x" ? 700 : 600,
            fontSize: platform === "x" ? 15 : 16,
            lineHeight: "20px",
          }}
        >
          {personal ? "Joseph" : "recuut"}
        </div>
        {platform === "linkedin" && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: secondary,
                lineHeight: "16px",
              }}
            >
              Preview · <Icon name="globe" size={16} />
            </div>
          </>
        )}
      </div>
      {!personal && platform === "linkedin" && (
        <span
          aria-hidden="true"
          style={{
            color: "#0a66c2",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 600,
            padding: "4px 8px",
          }}
        >
          + Follow
        </span>
      )}
      <span aria-hidden="true" style={{ color: secondary, alignSelf: "flex-start", fontSize: 22 }}>
        ···
      </span>
    </div>
  );
}
function PostMedia({ media, rounded = false }: { media: readonly Media[]; rounded?: boolean }) {
  return (
    <>
      {media.map((m) => (
        <img
          key={m.id}
          src={m.dataUrl}
          alt={m.alt}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            ...(rounded ? { borderRadius: 14 } : {}),
          }}
        />
      ))}
    </>
  );
}
function Actions({
  platform,
  color,
  border,
}: {
  platform: "linkedin" | "x";
  color: string;
  border: string;
}) {
  const actions: Array<[keyof typeof iconPaths, string]> =
    platform === "linkedin"
      ? [
          ["like", "Like"],
          ["comment", "Comment"],
          ["repost", "Repost"],
          ["send", "Send"],
        ]
      : [
          ["comment", "Reply"],
          ["repost", "Repost"],
          ["heart", "Like"],
          ["views", "Views"],
          ["bookmark", "Bookmark"],
          ["send", "Share"],
        ];
  return (
    <div
      aria-label="Feed actions, preview only"
      style={{
        display: "flex",
        justifyContent: platform === "linkedin" ? "flex-start" : "space-around",
        gap: 4,
        margin: platform === "linkedin" ? "0" : "0 16px 0 68px",
        padding: platform === "linkedin" ? "0 12px" : "0 0 4px",
        borderTop: platform === "linkedin" ? undefined : `1px solid ${border}`,
        color,
      }}
    >
      {platform === "linkedin" && (
        <span
          aria-label="Viewer profile image not connected"
          style={{ display: "grid", placeItems: "center", width: 40, height: 44 }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="9" r="3" />
            <path d="M5 19c1-7 13-7 14 0" />
          </svg>
        </span>
      )}
      {actions.map(([icon, label]) => (
        <span
          key={label}
          aria-label={label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minHeight: platform === "linkedin" ? 44 : 32,
            minWidth: platform === "linkedin" ? 40 : undefined,
            justifyContent: "center",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 600,
          }}
        >
          <Icon
            name={icon}
            size={platform === "linkedin" ? 20 : 18}
            linkedin={platform === "linkedin"}
          />
        </span>
      ))}
    </div>
  );
}
export function SocialPostPreview({
  platform,
  text,
  media,
  dark,
  personal = false,
  company,
}: {
  platform: "linkedin" | "x";
  text: string;
  media: readonly Media[];
  dark: boolean;
  personal?: boolean;
  company?: { text: string; media: readonly Media[] };
}) {
  const [expanded, setExpanded] = useState(false);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const background = dark ? (platform === "x" ? "#000000" : "#1b1f23") : "#ffffff";
  const foreground =
    platform === "x" ? (dark ? "#e7e9ea" : "#0f1419") : dark ? "#ffffff" : "#191919";
  const secondary =
    platform === "x" ? (dark ? "#71767b" : "#536471") : dark ? "#ffffff99" : "#00000099";
  const border = dark ? "#3c434a" : "#dfe3e7";
  const count = platform === "x" ? twitterText.parseTweet(text).weightedLength : text.length;
  const limit = platform === "x" ? 280 : 3000;
  return (
    <>
      <article
        aria-label={
          personal
            ? "LinkedIn personal repost preview"
            : platform === "x"
              ? "X post preview"
              : "LinkedIn company post preview"
        }
        style={{
          background,
          color: foreground,
          border: platform === "x" ? `1px solid ${border}` : undefined,
          borderRadius: 0,
          overflow: "hidden",
          fontFamily:
            platform === "linkedin"
              ? 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Oxygen, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
              : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: platform === "x" ? 15 : 14,
          fontWeight: 400,
          lineHeight: "20px",
          letterSpacing: "normal",
          textAlign: "left",
          WebkitFontSmoothing: "auto",
        }}
      >
        <Author personal={personal} platform={platform} secondary={secondary} />
        <PostText
          text={text}
          inset={platform === "x"}
          fold={platform === "linkedin"}
          expanded={expanded}
          expand={() => setExpanded(true)}
          secondary={secondary}
        />
        {personal && company ? (
          <div
            style={{
              margin: "0 16px 12px",
              border: `1px solid ${border}`,
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <Author platform="linkedin" secondary={secondary} />
            <PostText
              text={company.text}
              fold
              expanded={quotedExpanded}
              expand={() => setQuotedExpanded(true)}
              secondary={secondary}
            />
            <PostMedia media={company.media} />
          </div>
        ) : (
          <div style={platform === "x" ? { margin: "0 16px 8px 68px" } : undefined}>
            <PostMedia media={media} rounded={platform === "x"} />
          </div>
        )}
        <Actions platform={platform} color={secondary} border={border} />
      </article>
      <div
        role="status"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 10,
          fontSize: 12,
          color: count > limit ? "var(--destructive)" : "var(--muted-foreground)",
        }}
      >
        <span>
          {count.toLocaleString()} / {limit.toLocaleString()}
          {platform === "x" ? " weighted characters" : " characters"}
        </span>
        {(expanded || quotedExpanded) && (
          <button
            type="button"
            aria-expanded={true}
            onClick={() => {
              setExpanded(false);
              setQuotedExpanded(false);
            }}
            style={{
              padding: 0,
              border: 0,
              background: "none",
              color: "var(--primary)",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Show less
          </button>
        )}
        {count > limit && (
          <span>Over the {platform === "x" ? "standard X" : "LinkedIn"} post limit</span>
        )}
      </div>
    </>
  );
}
export function PreviewToggle({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="rounded px-2.5 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      style={{
        background: selected ? "var(--secondary)" : "transparent",
        color: selected ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      {children}
    </button>
  );
}
