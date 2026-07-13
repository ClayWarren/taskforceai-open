export const LARGE_PASTE_CHARACTER_THRESHOLD = 10_000;

const largePasteContents = new WeakMap<File, string>();

export const createLargePasteAttachment = (content: string): File => {
  const file = new File([content], 'Pasted text.txt', { type: 'text/plain' });
  largePasteContents.set(file, content);
  return file;
};

export const getLargePasteContent = (file: File): string | null =>
  largePasteContents.get(file) ?? null;
