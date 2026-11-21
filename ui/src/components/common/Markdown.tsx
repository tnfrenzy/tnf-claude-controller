import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Render markdown safely (sources are free model output: run reports, REPORT.md of the 3D workshop): HTML produced by
 * marked is sanitized, scripts/iframes/event handlers stripped, javascript: links dropped by DOMPurify's URI check.
 * Images are dropped too: app files need the token header, and a remote image would be a request the model chose.
 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(source, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "img"],
      FORBID_ATTR: ["onerror", "onload", "style"],
    });
  }, [source]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
