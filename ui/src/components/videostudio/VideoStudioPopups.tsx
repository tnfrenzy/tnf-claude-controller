import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { Modal } from "../common/Modal";
import { VideoStudioCreate } from "./VideoStudioCreate";
import { VideoStudioPopup } from "./VideoStudioPopup";
import type { VsLibraryItem, VsSettingsPublic, VsStyle } from "../../../../src/core/videostudio/plan-types";

/** Lobby popup (ground floor and "new video"): loads styles and settings, then shows the three tabs. */
export function VideoStudioLobbyPopup(props: { onCreated: (slug: string) => void; onClose: () => void }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [styles, setStyles] = useState<VsStyle[]>([]);
  const [settings, setSettings] = useState<VsSettingsPublic | null>(null);
  const [library, setLibrary] = useState<VsLibraryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [s, c, l] = await Promise.allSettled([api.videoStudioStyles(), api.videoStudioSettings(), api.videoStudioLibrary()]);
    if (l.status === "fulfilled" && Array.isArray(l.value.files)) setLibrary(l.value.files);
    if (s.status === "fulfilled" && Array.isArray(s.value.styles)) setStyles(s.value.styles);
    if (c.status === "fulfilled" && c.value.settings && typeof c.value.settings === "object") setSettings(c.value.settings);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal title={t["vs_building_name"] ?? ""} size="large" onClose={props.onClose}>
      {loaded ? <VideoStudioCreate styles={styles} settings={settings} library={library} onCreated={props.onCreated} onChanged={() => void load()} /> : null}
    </Modal>
  );
}

/** Project room popup: the existing VideoStudioPopup in a modal titled with the project name. */
export function VideoStudioRoomPopup(props: { slug: string; title?: string | undefined; onDeleted: () => void; onClose: () => void }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  return (
    <Modal title={props.title || t["vs_building_name"] || ""} size="large" onClose={props.onClose}>
      <VideoStudioPopup slug={props.slug} onDeleted={props.onDeleted} />
    </Modal>
  );
}
