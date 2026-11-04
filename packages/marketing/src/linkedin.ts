import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeBuffer from "node:buffer";
import { MarketingError, PublicationRejected, type Draft } from "./contracts.ts";
import type { Publisher } from "./store.ts";
export type LinkedInConfig = {
  tokenFile: string;
  version: string;
  companyAuthor: string;
  personalAuthor: string;
};
export class LinkedInRejected extends PublicationRejected {
  readonly status: number;
  constructor(status: number) {
    super(`LinkedIn rejected the request, HTTP ${status}. No post was accepted by this request.`);
    this.status = status;
  }
}
const decodeUpload = Schema.decodeUnknownSync(
  Schema.Struct({ value: Schema.Struct({ image: Schema.String, uploadUrl: Schema.String }) }),
);
const decodeImage = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));
const decodePost = Schema.decodeUnknownSync(
  Schema.Struct({
    author: Schema.String,
    commentary: Schema.String,
    lifecycleState: Schema.String,
    content: Schema.optionalKey(
      Schema.Struct({ media: Schema.optionalKey(Schema.Struct({ id: Schema.String })) }),
    ),
    reshareContext: Schema.optionalKey(Schema.Struct({ parent: Schema.String })),
  }),
);
export function linkedInPublisher(
  config: LinkedInConfig,
  request: typeof fetch = fetch,
): Publisher {
  async function headers() {
    const token = (await NodeFSP.readFile(config.tokenFile, "utf8")).trim();
    if (!token) throw new PublicationRejected("The LinkedIn publishing credential is empty.");
    return {
      authorization: `Bearer ${token}`,
      "LinkedIn-Version": config.version,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    };
  }
  async function api(path: string, method: "GET" | "POST", body?: unknown) {
    const response = await request(`https://api.linkedin.com/rest/${path}`, {
      method,
      headers: await headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500)
        throw new LinkedInRejected(response.status);
      throw new MarketingError(
        "unavailable",
        "LinkedIn did not confirm this request. Check its result before retrying.",
      );
    }
    return response;
  }
  const base = (author: string, commentary: string) => ({
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  });
  async function post(body: unknown) {
    const response = await api("posts", "POST", body),
      urn = response.headers.get("x-restli-id");
    if (!urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn))
      throw new MarketingError(
        "unavailable",
        "LinkedIn accepted the request without a usable post receipt. Check LinkedIn before retrying.",
      );
    return { urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  }
  return {
    async publishCompany(draft: Draft, saveImage) {
      let image: string;
      try {
        if (draft.company.author !== config.companyAuthor)
          throw new MarketingError(
            "forbidden",
            "The connected company account differs from the approved destination.",
          );
        const media = draft.media[0];
        if (!media) throw new MarketingError("invalid", "The approved company post has no image.");
        const initialized = await api("images?action=initializeUpload", "POST", {
            initializeUploadRequest: { owner: draft.company.author },
          }),
          data = decodeUpload(await initialized.json());
        image = data.value.image;
        if (!image.startsWith("urn:li:image:"))
          throw new MarketingError("invalid", "LinkedIn returned an invalid image identity.");
        const target = new URL(data.value.uploadUrl);
        if (
          target.protocol !== "https:" ||
          !(target.hostname === "linkedin.com" || target.hostname.endsWith(".linkedin.com"))
        )
          throw new MarketingError("invalid", "LinkedIn returned an unexpected upload host.");
        const bytes = NodeBuffer.Buffer.from(media.dataUrl.split(",")[1]!, "base64");
        const uploaded = await request(target, {
          method: "PUT",
          headers: { ...(await headers()), "Content-Type": media.mimeType },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (!uploaded.ok) throw new LinkedInRejected(uploaded.status);
        let available = false;
        for (let attempt = 0; attempt < 6; attempt++) {
          const response = await api(`images/${encodeURIComponent(image)}`, "GET");
          const status = decodeImage(await response.json()).status;
          if (status === "AVAILABLE") {
            available = true;
            break;
          }
          if (!["PROCESSING", "WAITING_UPLOAD"].includes(status)) break;
          await NodeTimersPromises.setTimeout(1000);
        }
        if (!available)
          throw new MarketingError(
            "unavailable",
            "LinkedIn has not finished processing the image. No post was sent.",
          );
        await saveImage(image);
      } catch (error) {
        if (error instanceof PublicationRejected) throw error;
        throw new PublicationRejected(
          "The company image could not be prepared. No post was sent. Check the LinkedIn connection and image before retrying.",
        );
      }
      return post({
        ...base(draft.company.author, draft.company.text),
        content: { media: { id: image, altText: draft.media[0]!.alt } },
      });
    },
    async publishPersonal(draft, parent) {
      if (draft.personal.author !== config.personalAuthor)
        throw new PublicationRejected(
          "The connected personal account differs from the approved destination. No repost was sent.",
        );
      return post({
        ...base(draft.personal.author, draft.personal.text),
        reshareContext: { parent },
      });
    },
    async confirm(urn, author, text, evidence) {
      if (!/^urn:li:(share|ugcPost):\d+$/.test(urn)) return false;
      const data = decodePost(await (await api(`posts/${encodeURIComponent(urn)}`, "GET")).json());
      return (
        data.author === author &&
        data.commentary === text &&
        data.lifecycleState === "PUBLISHED" &&
        (evidence.image === undefined || data.content?.media?.id === evidence.image) &&
        (evidence.parent === undefined || data.reshareContext?.parent === evidence.parent)
      );
    },
  };
}
