export function prepareTodoCaptureNote(note: string, context?: string) {
  const value = [note.trim(), context].filter(Boolean).join("\n\n");
  const excess = value.length - 5000;
  if (excess > 0) {
    return {
      note: null,
      error: `Shorten your note by ${excess} ${excess === 1 ? "character" : "characters"} ${context ? "to keep the full linked conversation" : "to fit the 5,000-character limit"}.`,
    };
  }
  return { note: value, error: null };
}
