import { describe, it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { MarketingStore, type Publisher } from "./store.ts";
import type { Release } from "./contracts.ts";
const release: Release = {
  id: "430791958",
  tag: "v3.0.4",
  url: "https://github.com/recuut/platform/releases/tag/v3.0.4",
  revision: "a".repeat(40),
  publishedAt: "2026-11-01T23:46:08Z",
  notes: "Real release evidence",
  productionRunUrl: "https://github.com/recuut/platform/actions/runs/1",
};
const authors = { company: "urn:li:organization:123", personal: "urn:li:person:joseph" };
async function fixture(run: (store: MarketingStore, dir: string) => Promise<void>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "marketing-test-"));
  try {
    await run(await MarketingStore.open(dir), dir);
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
}
async function ready(store: MarketingStore, personal = false) {
  let d = (await store.create(release, "project", "chat", authors)).draft;
  d = await store.highlights("chat", d.revision, {
    title: "A useful release",
    summary: "Two related improvements",
    items: ["Easier passkey setup", "Retry without losing the entered name"],
  });
  d = await store.human("chat", { type: "approve_highlights", expectedRevision: d.revision });
  d = await store.save("chat", d.revision, "Company update", "Really proud of this one.");
  if (personal) d = await store.personal("chat", d.revision, d.personal.text, true);
  d = await store.attach("chat", d.revision, {
    id: "image",
    name: "actual.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,aW1hZ2U=",
    source: "Production capture with synthetic data",
    alt: "Passkey setup",
  });
  return store.human("chat", { type: "approve_publication", expectedRevision: d.revision });
}
const publisher = (calls: string[]): Publisher => ({
  publishCompany: async () => {
    calls.push("company");
    return { urn: "urn:li:share:1", url: "https://www.linkedin.com/feed/update/urn:li:share:1/" };
  },
  publishPersonal: async (_, parent) => {
    calls.push(parent);
    return { urn: "urn:li:share:2", url: "https://www.linkedin.com/feed/update/urn:li:share:2/" };
  },
  confirm: async () => true,
});
describe("one release Studio", () => {
  it("reuses a release's draft and conversation across collection and restart", async () =>
    fixture(async (s, dir) => {
      const first = await s.create(release, "p", "chat", authors);
      await s.highlights("chat", first.draft.revision, {
        title: "Chosen",
        summary: "Useful",
        items: ["One"],
      });
      const duplicate = await s.create(release, "different-project", "different-chat", authors);
      expect(duplicate.created).toBe(false);
      expect(duplicate.draft.threadId).toBe("chat");
      const reopened = await MarketingStore.open(dir);
      expect(reopened.read("chat")?.highlights?.title).toBe("Chosen");
    }));
  it("previews draft content before selection approval while rejecting publication and stale edits", async () =>
    fixture(async (s) => {
      const d = (await s.create(release, "p", "chat", authors)).draft;
      await expect(s.save("chat", d.revision, "Post", "")).rejects.toThrow("highlights");
      let preview = await s.highlights("chat", d.revision, {
        title: "Selected",
        summary: "Useful",
        items: ["One"],
      });
      await expect(
        s.highlights("chat", d.revision, { title: "Stale", summary: "Old", items: ["One"] }),
      ).rejects.toThrow("changed");
      preview = await s.save("chat", preview.revision, "Preview company copy", "");
      preview = await s.attach("chat", preview.revision, {
        id: "preview-image",
        name: "announcement.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aW1hZ2U=",
        source: "Branded announcement",
        alt: "Release announcement",
      });
      expect(preview.selectionApproved).toBe(false);
      expect(preview.stage).toBe("selecting");
      expect(preview.company.text).toBe("Preview company copy");
      expect(preview.media[0]?.id).toBe("preview-image");
      await expect(
        s.human("chat", { type: "approve_publication", expectedRevision: preview.revision }),
      ).rejects.toThrow("Complete");
      const calls: string[] = [];
      await expect(s.publish("chat", preview.revision, publisher(calls))).rejects.toThrow(
        "approval",
      );
      expect(calls).toEqual([]);
      const approved = await s.human("chat", {
        type: "approve_highlights",
        expectedRevision: preview.revision,
      });
      expect(approved.company.text).toBe(preview.company.text);
      expect(approved.media).toEqual(preview.media);
    }));
  it("removes final approval when the text or selected personal post changes", async () =>
    fixture(async (s) => {
      const d = await ready(s);
      const edited = await s.save("chat", d.revision, "Revised text", d.personal.text);
      expect(edited.approvedRevision).toBeNull();
      await expect(s.publish("chat", edited.revision, publisher([]))).rejects.toThrow("approval");
      const approved = await s.human("chat", {
        type: "approve_publication",
        expectedRevision: edited.revision,
      });
      const selected = await s.personal("chat", approved.revision, "My actual reaction", true);
      expect(selected.approvedRevision).toBeNull();
    }));
  it("publishes company first, then the selected personal repost, once", async () =>
    fixture(async (s) => {
      const d = await ready(s, true),
        calls: string[] = [];
      const p = publisher(calls);
      const result = await s.publish("chat", d.revision, p);
      expect(calls).toEqual(["company", "urn:li:share:1"]);
      expect(result.stage).toBe("published");
      await s.publish("chat", d.revision, p);
      expect(calls).toHaveLength(2);
    }));
  it("preserves the company receipt and blocks replay after uncertain personal publication", async () =>
    fixture(async (s, dir) => {
      const d = await ready(s, true),
        calls: string[] = [];
      const p = publisher(calls);
      p.publishPersonal = async () => {
        calls.push("personal");
        throw new Error("lost response");
      };
      await expect(s.publish("chat", d.revision, p)).rejects.toThrow("lost response");
      expect(s.read("chat")?.companyPublication.status).toBe("published");
      const reopened = await MarketingStore.open(dir);
      await expect(reopened.publish("chat", d.revision, p)).rejects.toThrow("uncertain");
      expect(calls).toEqual(["company", "personal"]);
      await reopened.reconcile("chat", d.revision, "personal", "urn:li:share:2", p);
      const result = await reopened.publish("chat", d.revision, p);
      expect(result.stage).toBe("published");
      expect(calls).toHaveLength(2);
    }));
  it("does not accept two simultaneous publish attempts", async () =>
    fixture(async (s) => {
      const d = await ready(s),
        calls: string[] = [];
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let finish: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const p = publisher(calls);
      p.publishCompany = async () => {
        calls.push("company");
        started();
        await waiting;
        return {
          urn: "urn:li:share:1",
          url: "https://www.linkedin.com/feed/update/urn:li:share:1/",
        };
      };
      const first = s.publish("chat", d.revision, p);
      await entered;
      await expect(s.publish("chat", d.revision, p)).rejects.toThrow("uncertain");
      finish!();
      await first;
      expect(calls).toEqual(["company"]);
    }));
  it("persists continuation identity and does not clear a newer continuation", async () =>
    fixture(async (s) => {
      const d = await ready(s);
      const edited = await s.human("chat", {
        type: "feedback",
        expectedRevision: d.revision,
        feedback: "Shorten it",
      });
      await s.delivered("chat", d.pendingMessage!.id);
      expect(s.read("chat")?.pendingMessage?.id).toBe(edited.pendingMessage!.id);
      await s.delivered("chat", edited.pendingMessage!.id);
      expect(s.pending()).toHaveLength(0);
    }));
});

it("keeps approved content immutable outside the store", async () =>
  fixture(async (store) => {
    const d = await ready(store);
    const approvedText = d.company.text;
    const exposed = store.read("chat") as unknown as { company: { text: string } };
    exposed.company.text = "Unapproved replacement";
    expect(store.read("chat")?.company.text).toBe(approvedText);
    let sent = "";
    const p = publisher([]);
    p.publishCompany = async (draft) => {
      sent = draft.company.text;
      return { urn: "urn:li:share:1", url: "https://www.linkedin.com/feed/update/urn:li:share:1/" };
    };
    await store.publish("chat", d.revision, p);
    expect(sent).toBe(approvedText);
  }));
it("rejects an old absence confirmation after a later publication attempt", async () =>
  fixture(async (store) => {
    const d = await ready(store);
    let calls = 0;
    const p = publisher([]);
    p.publishCompany = async () => {
      calls++;
      throw new Error("lost response");
    };
    await expect(store.publish("chat", d.revision, p)).rejects.toThrow("lost response");
    const command = {
      type: "confirm_not_published",
      expectedRevision: d.revision,
      channel: "company",
      expectedAttempt: 1,
    } as const;
    await store.human("chat", command);
    await expect(store.publish("chat", d.revision, p)).rejects.toThrow("lost response");
    await expect(store.human("chat", command)).rejects.toThrow("attempt");
    expect(calls).toBe(2);
  }));
it("requires fresh content when the selected highlights change", async () =>
  fixture(async (store) => {
    const d = await ready(store);
    const changed = await store.highlights("chat", d.revision, {
      title: "Different release story",
      summary: "Billing changes",
      items: ["Improved billing"],
    });
    const selected = await store.human("chat", {
      type: "approve_highlights",
      expectedRevision: changed.revision,
    });
    await expect(
      store.human("chat", { type: "approve_publication", expectedRevision: selected.revision }),
    ).rejects.toThrow("Complete");
  }));

it("isolates a newly created Studio from caller-owned objects", async () =>
  fixture(async (store) => {
    const input = { ...release };
    const result = await store.create(input, "project", "isolated", authors);
    (result.draft.company as { text: string }).text = "External edit";
    input.tag = "v9.9.9";
    expect(store.read("isolated")?.company.text).toBe("");
    expect(store.read("isolated")?.release.tag).toBe(release.tag);
  }));

it("does not let the creation result fabricate approval", async () =>
  fixture(async (store) => {
    const result = await store.create({ ...release }, "project", "forged", authors);
    Object.assign(result.draft, {
      approvedRevision: result.draft.revision,
      company: { text: "Unapproved", author: authors.company },
    });
    const calls: string[] = [];
    await expect(store.publish("forged", result.draft.revision, publisher(calls))).rejects.toThrow(
      "approval",
    );
    expect(calls).toEqual([]);
  }));
