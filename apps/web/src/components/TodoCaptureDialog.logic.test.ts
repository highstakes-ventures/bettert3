import { expect, it } from "vite-plus/test";
import { prepareTodoCaptureNote } from "./TodoCaptureDialog.logic";

it("retains the complete note and conversation at the save limit", () => {
  const context = "Follow up on the invoice.\nuser: Verify the total before paying.";
  const note = "x".repeat(5000 - context.length - 2);
  expect(prepareTodoCaptureNote(note, context)).toEqual({
    note: `${note}\n\n${context}`,
    error: null,
  });
});

it("rejects oversized captures without silently dropping conversation context", () => {
  const context = "Follow up on the invoice.\nuser: Verify the total before paying.";
  const note = "x".repeat(5001 - context.length - 2);
  const result = prepareTodoCaptureNote(note, context);
  expect(result.note).toBeNull();
  expect(result.error).toContain("Shorten your note by 1 character");
});

it("supports personal notes and linked conversations without an additional note", () => {
  expect(prepareTodoCaptureNote("  Call the dentist  ")).toEqual({
    note: "Call the dentist",
    error: null,
  });
  expect(prepareTodoCaptureNote("  ", "Follow up on the invoice.")).toEqual({
    note: "Follow up on the invoice.",
    error: null,
  });
});
