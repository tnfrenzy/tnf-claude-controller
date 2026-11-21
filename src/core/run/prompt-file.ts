/**
 * Long app-generated prompts are stored and shown short: the first lines (what to do) stay in the prompt, the long guidance
 * goes to a file the agent opens with Read. The prompt then only says that the guidance file exists.
 */

/** Prompts shorter than this are left alone. */
export const FOLD_MIN_CHARS = 900;
/** Lines of the original prompt kept as the visible task. */
export const FOLD_HEAD_LINES = 2;
const HEAD_LINE_MAX = 400;

export interface FoldedPrompt {
  /** Prompt to store, show and send on stdin. */
  prompt: string;
  /** Whole original prompt for the guidance file; null when nothing was folded. */
  file: string | null;
}

/** `filePath` is the absolute path the agent should Read (forward slashes). Pure. */
export function foldPrompt(full: string, filePath: string, opts: { minChars?: number; headLines?: number } = {}): FoldedPrompt {
  const minChars = opts.minChars ?? FOLD_MIN_CHARS;
  const headLines = opts.headLines ?? FOLD_HEAD_LINES;
  if (full.length < minChars) return { prompt: full, file: null };
  const lines = full.split(/\r?\n/);
  const head: string[] = [];
  let i = 0;
  for (; i < lines.length && head.length < headLines; i++) {
    const l = lines[i]!.trim();
    if (l) head.push(l.length > HEAD_LINE_MAX ? `${l.slice(0, HEAD_LINE_MAX - 1)}…` : l);
  }
  const rest = lines.slice(i).join("\n").trim();
  if (!rest) return { prompt: full, file: null };
  const note = `(Chỉ dẫn chi tiết đã có sẵn trong tệp ${filePath}. Dùng công cụ Read mở tệp này trước và làm theo từng điều; tệp chứa toàn bộ yêu cầu.)`;
  return { prompt: `${head.join("\n")}\n\n${note}`, file: full };
}
