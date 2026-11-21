import fs from "node:fs";
import path from "node:path";
import { runGit } from "../../git/git.js";

const EXCLUDE_COMMENT = "# tnf-cli-temp-agents";
const EXCLUDE_PATTERN = ".agents/";
const EXCLUDE_BLOCK = `${EXCLUDE_COMMENT}\n${EXCLUDE_PATTERN}`;

export interface AgyRoleDef {
  description?: string;
  prompt: string;
}

export interface TempAgyAgentsHandle {
  agentsRoot: string;
  rolesWritten: string[];
  cleanup: () => void;
}

function resolveGitExcludeFile(worktreePath: string): string | null {
  const res = runGit(worktreePath, ["rev-parse", "--git-path", "info/exclude"]);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  const rel = res.stdout.trim();
  return path.isAbsolute(rel) ? rel : path.resolve(worktreePath, rel);
}

/**
 * Materialize temporary `.agents/agents/<role>/agent.md` files inside a worktree
 * for Antigravity CLI (`agy --agent <role>`), and hide `.agents/` via `info/exclude`
 * (never touching the repository's `.gitignore`).
 * Call `handle.cleanup()` after the run so git diff/status stays completely clean.
 */
export function prepareAgyRoleAgents(
  worktreePath: string,
  roles: Record<string, AgyRoleDef>,
): TempAgyAgentsHandle {
  const agentsRoot = path.join(worktreePath, ".agents", "agents");
  const hadDotAgents = fs.existsSync(path.join(worktreePath, ".agents"));
  const rolesWritten: string[] = [];

  for (const [role, def] of Object.entries(roles)) {
    if (!/^[a-z0-9_-]{1,50}$/i.test(role) || !def.prompt) continue;
    const dir = path.join(agentsRoot, role);
    fs.mkdirSync(dir, { recursive: true });
    const desc = (def.description ?? `TNF CLI role ${role}`).replace(/\r?\n/g, " ").replace(/"/g, "'");
    const md = [
      "---",
      `name: ${role}`,
      `description: "${desc}"`,
      "---",
      "",
      def.prompt,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "agent.md"), md, "utf8");
    rolesWritten.push(role);
  }

  const excludeFile = resolveGitExcludeFile(worktreePath);
  let addedExclude = false;
  if (excludeFile) {
    try {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      const prev = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
      if (!prev.includes(EXCLUDE_COMMENT)) {
        const sep = prev.length > 0 && !prev.endsWith("\n") ? "\n" : "";
        fs.writeFileSync(excludeFile, `${prev}${sep}${EXCLUDE_BLOCK}\n`, "utf8");
        addedExclude = true;
      }
    } catch {
      /* best effort */
    }
  }

  const cleanup = () => {
    try {
      if (!hadDotAgents) {
        fs.rmSync(path.join(worktreePath, ".agents"), { recursive: true, force: true });
      } else {
        for (const r of rolesWritten) {
          fs.rmSync(path.join(agentsRoot, r), { recursive: true, force: true });
        }
      }
    } catch {
      /* best effort */
    }
    if (addedExclude && excludeFile && fs.existsSync(excludeFile)) {
      try {
        const cur = fs.readFileSync(excludeFile, "utf8");
        const lines = cur.split(/\r?\n/);
        const next: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.trim() === EXCLUDE_COMMENT && lines[i + 1]?.trim() === EXCLUDE_PATTERN) {
            i++; // skip both marker comment and .agents/ line
            continue;
          }
          next.push(lines[i]!);
        }
        fs.writeFileSync(excludeFile, next.join("\n"), "utf8");
      } catch {
        /* best effort */
      }
    }
  };

  return { agentsRoot, rolesWritten, cleanup };
}
