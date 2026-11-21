import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { setCurLang } from "./lib/lang";
import { api, bootstrapToken, getToken, setToken } from "./api";
import { dicts, I18nContext, type Lang } from "./i18n";
import type { StatusResponse } from "./types";
import { CommandPage } from "./pages/CommandPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LibraryPage } from "./pages/LibraryPage";
import { RunPage } from "./pages/RunPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPanel } from "./pages/SettingsPanel";
import { AddConnectionForm } from "./pages/AddConnectionForm";
import { ApiFloorPopup } from "./components/office/ApiFloorPopup";
import { useApiFloors } from "./office/useApiFloors";
import { useDesign3DFloors } from "./office/useDesign3DFloors";
import { useVideoStudioFloors } from "./office/useVideoStudioFloors";
import { videoStudioTowerFloors } from "./office/videostudio-floors";
import { VideoStudioLobbyPopup, VideoStudioRoomPopup } from "./components/videostudio/VideoStudioPopups";
import { Design3DPopup, Design3DFloorPopup } from "./components/workshop3d/Design3DPopups";
import { Workshop3DPopup } from "./components/workshop3d/Workshop3DPopup";
import { AddFloorForm } from "./pages/AddFloorForm";
import { AddSkillFloorForm } from "./pages/AddSkillFloorForm";
import { Modal } from "./components/common/Modal";
import { PopupBoundary } from "./components/common/PopupBoundary";
import { SkillFloorPopup } from "./components/skills/SkillFloorPopup";
import { SkillOverviewPopup } from "./components/skills/SkillOverviewPopup";
import { LeftPanel } from "./components/LeftPanel";
import { CommandPalette } from "./components/CommandPalette";
import { DEFAULT_PALETTE_KEY, SHORTCUTS_EVENT, isPaletteKey, loadShortcuts, matchShortcut, resolveShortcuts, type ShortcutsConfig } from "./shortcuts";
import { runPaletteAction } from "./paletteActions";
import { OfficeStage } from "./office/OfficeStage";
import { CityScene } from "./office/CityScene";
import { FloorPopup, floorTitle } from "./office/FloorPopup";
import { parseView, viewReducer } from "./lib/view-mode";
import { PREF_PROJECT, PREF_VIEW, getNotify, recall, remember } from "./lib/prefs";
import { useRunWatch } from "./run/useRunWatch";
import { useFloors } from "./office/useFloors";
import { useSkillFloors } from "./office/useSkillFloors";
import { initialPopupState, popupFromHash, popupReducer, type PopupId, type PopupPayload, type PopupState } from "./lib/popup";
import "./office/city.css";

const DEFAULT_TOWERS_VI: [string, string] = ["TNF Tower", "Huấn luyện AI"];
const DEFAULT_TOWERS_EN: [string, string] = ["TNF Tower", "AI Training"];

export function navigate(to: string): void {
  location.hash = to;
}

function useTheme(): [string, (t: string) => void] {
  const [theme, set] = useState<string>(() => {
    try {
      return localStorage.getItem("tnf.theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem("tnf.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, set];
}

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("tnf.lang") as Lang) || "vi";
    } catch {
      return "vi";
    }
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("tnf.lang", l);
    } catch {
      /* ignore */
    }
  }, []);
  setCurLang(lang);
  const t = dicts[lang];
  const [theme, setTheme] = useTheme();
  const [popup, dispatch] = useReducer(popupReducer, undefined, (): PopupState => {
    bootstrapToken();
    return getToken() ? (popupFromHash(location.hash) ?? initialPopupState) : initialPopupState;
  });
  const [hasToken, setHasToken] = useState<boolean>(() => !!getToken());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutCfg, setShortcutCfg] = useState<ShortcutsConfig>(() => loadShortcuts());
  useEffect(() => {
    const reload = () => setShortcutCfg(loadShortcuts());
    window.addEventListener(SHORTCUTS_EVENT, reload);
    return () => window.removeEventListener(SHORTCUTS_EVENT, reload);
  }, []);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const { floors, total, reload: reloadFloors } = useFloors();
  const { floors: skillFloors, reload: reloadSkills } = useSkillFloors();
  const { floors: apiFloors, max: maxApiFloors, defaultPath: apiDefaultPath, reload: reloadApi } = useApiFloors();
  const { floors: design3dFloors, kit: design3dKit, sessions: design3dSessions, reload: reloadDesign3D } = useDesign3DFloors();
  const { projects: videoProjects, reload: reloadVideoStudio } = useVideoStudioFloors();
  const videoFloors = useMemo(() => videoStudioTowerFloors(videoProjects), [videoProjects]);
  const DEFAULT_TOWERS = lang === "en" ? DEFAULT_TOWERS_EN : DEFAULT_TOWERS_VI;
  const towers: [string, string] = status?.towers
    ? [status.towers[0], status.towers[1] === "Tower 2" ? DEFAULT_TOWERS[1] : status.towers[1]]
    : DEFAULT_TOWERS;
  // Chosen environment (floor) persists across restarts; "" means the default floor. Shared by the left panel and the stage.
  const [env, setEnv] = useState(() => recall(PREF_PROJECT));
  const pickEnv = useCallback((name: string) => {
    const v = name === "default" ? "" : name;
    setEnv(v);
    remember(PREF_PROJECT, v);
  }, []);

  const [notifyOn, setNotifyOn] = useState(() => getNotify());
  useRunWatch(hasToken && notifyOn);

  const [view, dispatchView]= useReducer(viewReducer, undefined, () => parseView(recall(PREF_VIEW)));
  useEffect(() => {
    remember(PREF_VIEW, view);
  }, [view]);
  const onToggleView = useCallback(() => dispatchView({ type: "toggle" }), []);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#/, "");
      const fromHash = popupFromHash(location.hash);
      if (fromHash) dispatch({ type: "open", id: fromHash.open as PopupId, ...(fromHash.payload ? { payload: fromHash.payload } : {}) });
      else if (/^\/runs\/?(\?|$)/.test(h)) dispatch({ type: "open", id: "runs" });
      else if (/^\/cmd/.test(h)) dispatch({ type: "open", id: "cmd" });
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const onOpen = useCallback((id: PopupId, payload?: PopupPayload) => dispatch({ type: "open", id, ...(payload ? { payload } : {}) }), []);
  const onClose = useCallback(() => {
    dispatch({ type: "close" });
    try {
      history.replaceState(null, "", "#/cmd");
    } catch {
      /* ignore */
    }
  }, []);

  const shortcutMap = useMemo(() => resolveShortcuts(shortcutCfg, floors.map((f) => f.id)), [shortcutCfg, floors]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasToken) return;
      if (isPaletteKey(e, shortcutCfg.palette || DEFAULT_PALETTE_KEY)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const id = matchShortcut(shortcutMap, e);
      if (!id) return;
      e.preventDefault();
      setPaletteOpen(false);
      if (id.startsWith("page:")) onOpen(id.slice(5) as PopupId);
      else if (id.startsWith("env:")) pickEnv(id.slice(4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasToken, shortcutCfg.palette, shortcutMap, onOpen, pickEnv]);

  const refreshStatus = useCallback(() => {
    if (!getToken()) return;
    api
      .status()
      .then((s) => {
        setStatus(s);
        setStatusErr(null);
      })
      .catch((e: Error) => setStatusErr(e.message));
  }, []);
  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 60_000);
    return () => clearInterval(id);
  }, [refreshStatus, hasToken]);

  const ctx = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);

  const open = hasToken ? popup.open : null;
  const runId = typeof popup.payload?.runId === "string" ? popup.payload.runId : "";
  const w3dSlug = typeof popup.payload?.slug === "string" ? popup.payload.slug : "";
  const projectName = typeof popup.payload?.projectName === "string" ? popup.payload.projectName : undefined;
  const promptText = typeof popup.payload?.prompt === "string" ? popup.payload.prompt : undefined;

  const apiConnId = typeof popup.payload?.connectionId === "string" ? popup.payload.connectionId : "";
  const apiConn = apiFloors.find((f) => f.id === apiConnId);
  const skillId = typeof popup.payload?.skillId === "string" ? popup.payload.skillId : "";
  const skillInfo = skillFloors.find((f) => f.id === skillId);
  const floorProject = typeof popup.payload?.projectName === "string" ? popup.payload.projectName : "";
  const floorNo = typeof popup.payload?.floorNo === "number" ? popup.payload.floorNo : 1;
  // A deleted floor closes its popup (only once the floor list has loaded).
  useEffect(() => {
    if (open === "floor" && floors.length > 0 && !floors.some((f) => f.id === (floorProject || "default"))) onClose();
  }, [open, floors, floorProject, onClose]);

  return (
    <I18nContext.Provider value={ctx}>
      <div className="single-screen">
        <LeftPanel apiFloors={apiFloors.map((f) => ({ id: f.id, name: f.name, text: f.summary.text }))} status={status} statusErr={statusErr} towerName={towers[0]} env={env} pickEnv={pickEnv} onOpen={onOpen} view={view} onToggleView={onToggleView} />
        <CommandPalette shortcuts={shortcutMap} open={paletteOpen && hasToken} onClose={() => setPaletteOpen(false)} onAction={(a) => runPaletteAction(a, { navigate, pickEnv, onOpen })} />
        {view === "city" ? (
          <CityScene
            towers={towers}
            floors={floors}
            onFloorClick={(id) => {
              pickEnv(id);
              dispatchView({ type: "set", view: "office" });
            }}
            onAddFloor={() => onOpen("addFloor")}
            skillFloors={skillFloors}
            onSkillFloorClick={(id) => onOpen("skillFloor", { skillId: id })}
            onAddSkillFloor={() => onOpen("addSkillFloor")}
            onGroundFloorClick={() => onOpen("skillOverview")}
            apiFloors={apiFloors.map((f) => ({ id: f.id, name: f.name, badge: f.summary.badge, text: f.summary.text }))}
            maxApiFloors={maxApiFloors}
            onApiFloorClick={(id) => onOpen("apiFloor", { connectionId: id })}
            onAddApiFloor={() => onOpen("addApiFloor")}
            design3dFloors={design3dFloors}
            onDesign3DFloorClick={(id) => onOpen("design3dFloor", { runId: id })}
            design3dSessions={design3dSessions}
            onDesign3DSessionClick={(slug) => onOpen("workshop3d", { slug })}
            onAddDesign3DFloor={() => onOpen("design3d")}
            onDesign3DGroundClick={() => onOpen("design3d")}
            videoStudioFloors={videoFloors}
            onVideoStudioFloorClick={(slug) => onOpen("videostudioFloor", { slug })}
            onAddVideoStudio={() => onOpen("videostudio")}
            onVideoStudioGroundClick={() => onOpen("videostudio")}
          />
        ) : (
          <OfficeStage
            floors={floors}
            total={total}
            selected={env}
            onSelect={pickEnv}
            onAddFloor={() => onOpen("addFloor")}
            onOpenRun={(id) => onOpen("run", { runId: id })}
          />
        )}
        {!hasToken ? (
          <div className="ss-overlay">
            <div className="ss-modal"><div className="ss-body"><TokenGate onSet={() => setHasToken(true)} /></div></div>
          </div>
        ) : null}
        <PopupBoundary key={`${open ?? ""}:${runId}:${w3dSlug}`} onClose={onClose}>
        {open === "cmd" ? (
          <Modal title={t.nav_cmd} onClose={onClose}><CommandPage status={status} onRecheck={refreshStatus} {...(promptText ? { initialPrompt: promptText } : {})} {...(projectName ? { initialProject: projectName } : {})} {...(popup.payload?.rolesOpen === true ? { initialRolesOpen: true } : {})} key={`${promptText ?? ""}|${projectName ?? ""}|${popup.payload?.rolesOpen === true ? "r" : ""}`} /></Modal>
        ) : open === "runs" ? (
          <Modal title={t.nav_runs} onClose={onClose}><RunsPage /></Modal>
        ) : open === "run" && runId ? (
          <Modal title={`${t.nav_runs} · ${runId}`} onClose={onClose}><RunPage id={runId} key={runId} /></Modal>
        ) : open === "history" ? (
          <Modal title={t.nav_history} size="large" onClose={onClose}><HistoryPage {...(typeof popup.payload?.queueProject === "string" ? { queueProject: popup.payload.queueProject } : {})} onOpenWorkshop3d={(slug) => onOpen("workshop3d", { slug })} /></Modal>
        ) : open === "library" ? (
          <Modal title={t.nav_library} onClose={onClose}><LibraryPage status={status} /></Modal>
        ) : open === "settings" ? (
          <Modal title={t.ss_settings} onClose={onClose}><SettingsPanel status={status} statusErr={statusErr} theme={theme} setTheme={setTheme} notifyOn={notifyOn} onNotifyChange={setNotifyOn} onOpen={(n) => onOpen(n)} /></Modal>
        ) : open === "floor" ? (
          <Modal size="large" title={floorTitle(floorNo, floorProject, t)} sub={t.floor_sub} onClose={onClose}>
            <FloorPopup projectName={floorProject} floorNo={floorNo} hasRepo={floors.find((f) => f.id === floorProject)?.hasRepo === true} onOpenRun={(id) => onOpen("run", { runId: id })} onClose={onClose} />
          </Modal>
        ) : open === "addSkillFloor" ? (
          <Modal title={t.city_skill_add.replace(/^＋\s*/, "")} onClose={onClose}>
            <AddSkillFloorForm onDone={() => { reloadSkills(); onClose(); }} onStarted={reloadSkills} />
          </Modal>
        ) : open === "skillOverview" ? (
          <SkillOverviewPopup skills={skillFloors} onOpenSkill={(id) => onOpen("skillFloor", { skillId: id })} onAdd={() => onOpen("addSkillFloor")} onClose={onClose} />
        ) : open === "skillFloor" && skillInfo ? (
          <SkillFloorPopup slug={skillInfo.id} title={skillInfo.name} onClose={onClose} onDeleted={reloadSkills} />
        ) : open === "addApiFloor" ? (
          <Modal title={t.city_api_add.replace(/^＋\s*/, "")} onClose={onClose}>
            <AddConnectionForm defaultPath={apiDefaultPath} onDone={() => { reloadApi(); onClose(); }} />
          </Modal>
        ) : open === "apiFloor" && apiConn ? (
          <ApiFloorPopup conn={apiConn} onClose={onClose} onDeleted={reloadApi} />
        ) : open === "addFloor" ? (
          <Modal title={t.ss_add_floor} onClose={onClose}>
            <AddFloorForm onDone={() => { reloadFloors(); onClose(); }} />
          </Modal>
        ) : open === "design3d" ? (
          <Design3DPopup kit={design3dKit} onCreated={(slug) => { reloadDesign3D(); onOpen("workshop3d", { slug }); }} onClose={onClose} />
        ) : open === "design3dFloor" && runId ? (
          <Design3DFloorPopup runId={runId} title={design3dFloors.find((f) => f.runId === runId)?.title} onOpenRun={(id) => onOpen("run", { runId: id })} onClose={onClose} />
        ) : open === "videostudio" ? (
          <VideoStudioLobbyPopup onCreated={(slug) => { reloadVideoStudio(); onOpen("videostudioFloor", { slug }); }} onClose={onClose} />
        ) : open === "videostudioFloor" && w3dSlug ? (
          <VideoStudioRoomPopup slug={w3dSlug} title={videoProjects.find((p) => p.slug === w3dSlug)?.title} onDeleted={() => { reloadVideoStudio(); onClose(); }} onClose={onClose} />
        ) : open === "workshop3d" ? (
          <Workshop3DPopup slug={w3dSlug || undefined} demo={popup.payload?.demo === true} initialTab={popup.payload?.tab === "batch" ? "batch" : undefined} title={design3dSessions.find((x) => x.slug === w3dSlug)?.title} onClose={onClose} onDeleted={reloadDesign3D} />
        ) : null}
        </PopupBoundary>
      </div>
    </I18nContext.Provider>
  );
}

function TokenGate({ onSet }: { onSet: () => void }) {
  const t = dicts["vi"];
  const [v, setV] = useState("");
  return (
    <div className="card">
      <p className="error">{t.token_missing}</p>
      <div className="row">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={t.token_prompt} style={{ minWidth: 360 }} />
        <button
          className="primary"
          onClick={() => {
            if (v.trim()) {
              setToken(v.trim());
              onSet();
            }
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
