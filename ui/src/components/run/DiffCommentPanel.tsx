import { useState } from "react";
import { dicts, type Lang } from "../../i18n.js";
import { MAX_COMMENTS, MAX_COMMENT_CHARS, isTooLong, type DiffComment } from "../../run/diffComments.js";

const fill = (s: string, n: number, max: number) => s.replace("{n}", String(n)).replace("{max}", String(max));

export function CommentEditor(props: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  lang: Lang;
}) {
  const t = dicts[props.lang];
  const [text, setText] = useState(props.initial);
  const tooLong = isTooLong(text);
  const empty = text.trim() === "";
  return (
    <div className="dc-editor">
      <textarea
        value={text}
        placeholder={t.dc_input_placeholder}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <div className="dc-actions">
        <span className={tooLong ? "dc-count err" : "dc-count fine"}>{fill(t.dc_counter, text.length, MAX_COMMENT_CHARS)}</span>
        <button type="button" disabled={empty || tooLong} onClick={() => props.onSave(text)}>{t.dc_save}</button>
        <button type="button" onClick={props.onCancel}>{t.dc_cancel}</button>
      </div>
      {tooLong ? <div className="err fine">{fill(t.dc_too_long, text.length, MAX_COMMENT_CHARS)}</div> : null}
    </div>
  );
}

export function CommentList(props: {
  comments: DiffComment[];
  lang: Lang;
  onEdit: (c: DiffComment) => void;
  onDelete: (c: DiffComment) => void;
  disabled?: boolean;
}) {
  const t = dicts[props.lang];
  if (props.comments.length === 0) return null;
  const n = props.comments.length;
  return (
    <div className="dc-list">
      <div className="dc-title">
        <strong>{t.dc_list_title.replace("{n}", String(n))}</strong>{" "}
        <span className="fine">{fill(t.dc_counter, n, MAX_COMMENTS)}</span>
      </div>
      <ul>
        {props.comments.map((c) => (
          <li key={`${c.file}:${c.line}:${c.side}`}>
            <span className="dc-loc">{c.file}:{c.line}{c.side === "old" ? " (old)" : ""}</span>
            <span className="dc-text">{c.text}</span>
            <button type="button" disabled={props.disabled} onClick={() => props.onEdit(c)}>{t.dc_edit}</button>
            <button type="button" disabled={props.disabled} onClick={() => props.onDelete(c)}>{t.dc_delete}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
