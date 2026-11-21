import { Modal } from "../common/Modal";
import { statusLabel, useT } from "../../i18n";
import { historyCommands, ideaHeading } from "../../queue/ideaGroups";
import type { IdeaGroup } from "../../queue/ideaGroups";
import type { QueueCommand } from "../../types";

/** Per-idea history: finished commands and every command that has run, each run linked to its popup. */
export function IdeaHistoryModal(props: { group: IdeaGroup<QueueCommand>; index?: number; onClose: () => void }) {
  const { t } = useT();
  const heading = ideaHeading(props.group, props.index ?? 0);
  const items = historyCommands(props.group);
  return (
    <Modal title={t.idea_historyTitle.replace("{heading}", () => heading)} size="large" onClose={props.onClose}>
      {items.length === 0 ? (
        <p className="fine">{t.idea_historyEmpty}</p>
      ) : (
        <ul className="idea-history">
          {items.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.title}</strong> <span className="fine">{statusLabel(t, c.status)}</span>
              </div>
              {c.branch ? (
                <div className="fine">
                  {t.idea_branch}: <code>{c.branch}</code>
                </div>
              ) : null}
              {(c.runIds?.length ?? 0) > 0 ? (
                <div className="fine">
                  {/* runIds = the command's own run, then its follow-ups: the run is the main line, follow-ups are indented replies. */}
                  {t.idea_runs}: <a href={"#/runs/" + c.runIds![0]}>{c.runIds![0]}</a>
                  {(c.runIds ?? []).length > 1 ? (
                    <ul className="run-replies idea-run-replies">
                      {(c.runIds ?? []).slice(1).map((id, i) => (
                        <li key={id}>
                          <span className="run-reply-no">↳ {t.tree_reply.replace("{n}", String(i + 1))}</span> <a href={"#/runs/" + id}>{id}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
