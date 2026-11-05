import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
function Icon({ name, size = 18 }: { name: keyof typeof iconPaths; size?: number }) {
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
  accent,
  secondary,
  inset = false,
}: {
  text: string;
  fold: boolean;
  accent: string;
  secondary: string;
  inset?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const element = useRef<HTMLParagraphElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the rendered feed lines as the preview width changes
  useEffect(() => {
    const node = element.current;
    if (!node || !fold || !text) {
      setOverflows(false);
      return;
    }
    const measure = () =>
      setOverflows(
        node.scrollHeight > Number.parseFloat(getComputedStyle(node).lineHeight) * 3 + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, fold]);
  return (
    <div style={{ padding: inset ? "0 16px 10px 74px" : "0 16px 10px" }}>
      <p
        ref={element}
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 14,
          lineHeight: "20px",
          ...(fold && !expanded
            ? ({
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
              } as CSSProperties)
            : {}),
        }}
      >
        {text || <span style={{ color: secondary }}>The post draft will appear here.</span>}
      </p>
      {fold && overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "block",
            marginLeft: "auto",
            padding: "2px 0",
            border: 0,
            background: "none",
            color: expanded ? accent : secondary,
            cursor: "pointer",
            font: "inherit",
            fontSize: 14,
          }}
        >
          {expanded ? "Show less" : "…see more"}
        </button>
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
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 16px 10px" }}>
      {personal ? (
        <span
          aria-label="Personal profile image not connected"
          style={{
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            width: 48,
            height: 48,
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
          width={48}
          height={48}
          style={{ borderRadius: platform === "x" ? "50%" : 2, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, lineHeight: "20px" }}>
          {personal ? "Joseph" : "recuut"}
        </div>
        <div style={{ fontSize: 12, color: secondary, lineHeight: "17px" }}>
          {personal
            ? "Personal repost preview"
            : platform === "x"
              ? "X post preview"
              : "Company update"}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: secondary,
            lineHeight: "17px",
          }}
        >
          Preview · <Icon name="globe" size={12} />
        </div>
      </div>
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
        justifyContent: "space-around",
        gap: 4,
        padding: "9px 8px",
        borderTop: `1px solid ${border}`,
        color,
      }}
    >
      {actions.map(([icon, label]) => (
        <span
          key={label}
          aria-label={label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            minHeight: 30,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Icon name={icon} />
          {platform === "linkedin" && label}
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
  const background = dark ? (platform === "x" ? "#000000" : "#1b1f23") : "#ffffff";
  const foreground = dark ? "#f2f2f2" : "#191919";
  const secondary = dark ? "#a8aeb4" : "#62676b";
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
          border: `1px solid ${border}`,
          borderRadius: platform === "x" ? 0 : 8,
          overflow: "hidden",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <Author personal={personal} platform={platform} secondary={secondary} />
        <PostText
          text={text}
          inset={platform === "x"}
          fold={platform === "linkedin"}
          accent="#0a66c2"
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
            <PostText text={company.text} fold accent="#0a66c2" secondary={secondary} />
            <PostMedia media={company.media} />
          </div>
        ) : (
          <div style={platform === "x" ? { margin: "0 16px 12px 74px" } : undefined}>
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
