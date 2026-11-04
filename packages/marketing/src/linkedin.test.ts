import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { MarketingStore } from "./store.ts";
import { linkedInPublisher, LinkedInRejected } from "./linkedin.ts";
import type { Draft, Release } from "./contracts.ts";
const release: Release = {
  id: "42",
  tag: "v3.0.4",
  url: "https://github.com/recuut/platform/releases/tag/v3.0.4",
  revision: "a".repeat(40),
  publishedAt: "2026-11-01T23:46:08Z",
  notes: "Evidence",
  productionRunUrl: "https://github.com/recuut/platform/actions/runs/7",
};
async function fixture(run: (draft: Draft, tokenFile: string) => Promise<void>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "marketing-linkedin-"));
  try {
    const tokenFile = NodePath.join(dir, "token");
    await NodeFSP.writeFile(tokenFile, "fake-test-token", { mode: 0o600 });
    const store = await MarketingStore.open(NodePath.join(dir, "state"));
    const created = await store.create(release, "project", "thread", {
      company: "urn:li:organization:123",
      personal: "urn:li:person:me",
    });
    await run(
      {
        ...created.draft,
        company: { text: "The exact approved company post.", author: "urn:li:organization:123" },
        personal: { text: "My own reaction.", author: "urn:li:person:me", enabled: true },
        media: [
          {
            id: "media",
            name: "capture.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            source: "Test fixture only",
            alt: "The approved image description",
          },
        ],
      },
      tokenFile,
    );
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
}
it("uses the approved company payload and saves its uploaded image identity before posting", async () =>
  fixture(async (draft, tokenFile) => {
    const posts: unknown[] = [];
    let saved = "";
    const request: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("initializeUpload"))
        return Response.json({
          value: {
            image: "urn:li:image:test",
            uploadUrl: "https://www.linkedin.com/dms-uploads/test",
          },
        });
      if (init?.method === "PUT") return new Response(null, { status: 201 });
      if (url.includes("/rest/images/")) return Response.json({ status: "AVAILABLE" });
      if (url.endsWith("/rest/posts")) {
        expect(saved).toBe("urn:li:image:test");
        posts.push(JSON.parse(String(init?.body)));
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": `urn:li:share:${posts.length}` },
        });
      }
      throw new Error("Unexpected endpoint");
    };
    const p = linkedInPublisher(
      {
        tokenFile,
        version: "202609",
        companyAuthor: draft.company.author,
        personalAuthor: draft.personal.author,
      },
      request,
    );
    const company = await p.publishCompany(draft, async (image) => {
      saved = image;
    });
    await p.publishPersonal(draft, company.urn);
    expect(posts).toEqual([
      expect.objectContaining({
        author: draft.company.author,
        commentary: draft.company.text,
        content: { media: { id: "urn:li:image:test", altText: draft.media[0]!.alt } },
      }),
      expect.objectContaining({
        author: draft.personal.author,
        commentary: draft.personal.text,
        reshareContext: { parent: "urn:li:share:1" },
      }),
    ]);
  }));
it("does not upload credentials or image bytes to an unexpected host", async () =>
  fixture(async (draft, tokenFile) => {
    const urls: string[] = [];
    const request: typeof fetch = async (input) => {
      urls.push(String(input));
      return Response.json({
        value: { image: "urn:li:image:test", uploadUrl: "https://unexpected.example/upload" },
      });
    };
    const p = linkedInPublisher(
      {
        tokenFile,
        version: "202609",
        companyAuthor: draft.company.author,
        personalAuthor: draft.personal.author,
      },
      request,
    );
    await expect(p.publishCompany(draft, async () => {})).rejects.toThrow("No post was sent");
    expect(urls).toEqual(["https://api.linkedin.com/rest/images?action=initializeUpload"]);
  }));
it("reconciliation requires the approved author, text, image and repost parent", async () =>
  fixture(async (draft, tokenFile) => {
    const request: typeof fetch = async () =>
      Response.json({
        author: draft.company.author,
        commentary: draft.company.text,
        lifecycleState: "PUBLISHED",
        content: { media: { id: "urn:li:image:wrong" } },
      });
    const p = linkedInPublisher(
      {
        tokenFile,
        version: "202609",
        companyAuthor: draft.company.author,
        personalAuthor: draft.personal.author,
      },
      request,
    );
    expect(
      await p.confirm("urn:li:share:1", draft.company.author, draft.company.text, {
        image: "urn:li:image:approved",
      }),
    ).toBe(false);
  }));
it("treats a rejected post differently from a lost response", async () =>
  fixture(async (draft, tokenFile) => {
    const p = linkedInPublisher(
      {
        tokenFile,
        version: "202609",
        companyAuthor: draft.company.author,
        personalAuthor: draft.personal.author,
      },
      async () => new Response(null, { status: 403 }),
    );
    await expect(p.publishPersonal(draft, "urn:li:share:1")).rejects.toBeInstanceOf(
      LinkedInRejected,
    );
  }));
