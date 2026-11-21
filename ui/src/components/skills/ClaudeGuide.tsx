import { useT } from "../../i18n";
import type { StatusResponse } from "../../types";

const INSTALL_CMD = "irm https://claude.ai/install.ps1 | iex";
const DOCS_URL = "https://docs.claude.com/en/docs/claude-code/setup";
const GIT_URL = "https://git-scm.com/download/win";

/** True when the command page should show the guide (CLI missing, not logged in, or git missing). */
export function needsGuide(status: StatusResponse | null): boolean {
  if (!status) return false;
  return !!status.claude_error || !!status.auth_error || !status.auth?.loggedIn || !!status.git_error;
}

/**
 * Phase 5.6: shown on the command page when the Claude Code CLI is missing (`claude_error`), not logged in,
 * or `git` is not on PATH (`git_error`). The installer bundles none of these, so the user sets them up once by hand.
 */
export function ClaudeGuide({ status, onRecheck }: { status: StatusResponse; onRecheck: () => void }) {
  const { t } = useT();
  const missing = !!status.claude_error;
  const notLoggedIn = !missing && (!!status.auth_error || !status.auth?.loggedIn);
  const gitMissing = !!status.git_error;
  const claudeIssue = missing || notLoggedIn;
  const title = missing ? t.guide_title_missing : notLoggedIn ? t.guide_title_login : t.guide_title_git;
  return (
    <div className="card claude-guide" role="alert">
      <h3>{title}</h3>
      {claudeIssue && (
        <>
          <p>{missing ? t.guide_intro_missing : t.guide_intro_login}</p>
          {missing && status.claude_error && <p className="muted mono">{status.claude_error}</p>}
          {!missing && status.claude_path && (
            <p className="muted">
              {t.guide_found}: <span className="mono">{status.claude_path}</span>
              {status.claude_version ? ` · ${status.claude_version}` : ""}
            </p>
          )}
          <ol>
            {missing && (
              <li>
                {t.guide_step_install}
                <pre className="mono">{INSTALL_CMD}</pre>
              </li>
            )}
            <li>{t.guide_step_login}</li>
            <li>{t.guide_step_apikey}</li>
            <li>{t.guide_step_recheck}</li>
          </ol>
        </>
      )}
      {gitMissing && (
        <>
          {claudeIssue && <h3>{t.guide_title_git}</h3>}
          <p>{t.guide_intro_git}</p>
          <p className="muted mono">{status.git_error}</p>
        </>
      )}
      <p className="muted">{t.guide_local_projects}</p>
      <div className="row">
        <button type="button" onClick={onRecheck}>{t.guide_recheck}</button>
        {claudeIssue && <a href={DOCS_URL} target="_blank" rel="noreferrer">{t.guide_docs}</a>}
        {gitMissing && <a href={GIT_URL} target="_blank" rel="noreferrer">{t.guide_git_docs}</a>}
      </div>
    </div>
  );
}
