/**
 * A text's paragraphs: blank lines divide them, a single line break inside
 * one is only a wrap. Empty paragraphs are dropped.
 */
export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}
