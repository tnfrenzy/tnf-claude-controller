import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { modelBlob } from "../../api";
import { useT } from "../../i18n";
import { pickModelLoader } from "./model3d-loader";

interface Props {
  runId: string;
  relPath: string;
  onOpenFile: (runId: string, relPath: string) => void;
  /** Override how the file is fetched (the Workshop 3D viewer serves files from its own endpoint). */
  fetchBlob?: (relPath: string) => Promise<Blob>;
}

const HEIGHT = 320;

export default function Model3DViewer({ runId, relPath, onOpenFile, fetchBlob }: Props) {
  const { t } = useT();
  const kind = pickModelLoader(relPath);
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const fetchRef = useRef(fetchBlob);
  fetchRef.current = fetchBlob;

  useEffect(() => {
    if (kind === "unsupported") return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    setState("loading");

    (async () => {
      try {
        const [three, controlsMod, blob] = await Promise.all([
          import("three"),
          import("three/examples/jsm/controls/OrbitControls.js"),
          fetchRef.current ? fetchRef.current(relPath) : modelBlob(runId, relPath),
        ]);
        const buf = await blob.arrayBuffer();
        if (cancelled) return;

        let object: THREE.Object3D;
        if (kind === "stl") {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          if (cancelled) return;
          const geometry = new STLLoader().parse(buf);
          geometry.computeVertexNormals();
          object = new three.Mesh(
            geometry,
            new three.MeshStandardMaterial({ color: 0xb8c4d0, metalness: 0.3, roughness: 0.55 }),
          );
        } else {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          if (cancelled) return;
          const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
            new GLTFLoader().parse(buf, "", (g) => resolve(g as { scene: THREE.Object3D }), reject);
          });
          object = gltf.scene;
        }
        if (cancelled) {
          disposeObject(object);
          return;
        }

        const scene = new three.Scene();
        scene.background = new three.Color(0x1b2430);
        scene.add(object);

        const box = new three.Box3().setFromObject(object);
        const size = box.getSize(new three.Vector3());
        const center = box.getCenter(new three.Vector3());
        object.position.sub(center);
        object.position.y += size.y / 2; // sit on the grid plane
        const maxDim = Math.max(size.x, size.y, size.z, 1);

        // Grid in mm: side = max dimension rounded up to a multiple of 100 mm, 10 mm cells.
        const side = Math.max(100, Math.ceil(maxDim / 100) * 100);
        const grid = new three.GridHelper(side, side / 10, 0x6b7a8c, 0x3a4656);
        scene.add(grid);

        scene.add(new three.AmbientLight(0xffffff, 0.7));
        const dir = new three.DirectionalLight(0xffffff, 1.6);
        dir.position.set(maxDim, maxDim * 1.5, maxDim);
        scene.add(dir);

        const width = Math.max(host.clientWidth, 200);
        const camera = new three.PerspectiveCamera(45, width / HEIGHT, maxDim / 1000, maxDim * 50);
        camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.4);

        const renderer = new three.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, HEIGHT);
        host.appendChild(renderer.domElement);

        const controls = new controlsMod.OrbitControls(camera, renderer.domElement);
        controls.target.set(0, size.y / 2, 0);
        controls.update();

        let raf = 0;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          controls.update();
          renderer.render(scene, camera);
        };
        loop();

        const ro = new ResizeObserver(() => {
          const w = Math.max(host.clientWidth, 200);
          camera.aspect = w / HEIGHT;
          camera.updateProjectionMatrix();
          renderer.setSize(w, HEIGHT);
        });
        ro.observe(host);

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          controls.dispose();
          disposeObject(scene);
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        };
        if (cancelled) {
          cleanup();
          cleanup = null;
          return;
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      cleanup = null;
    };
  }, [runId, relPath, kind]);

  if (kind === "unsupported") {
    return (
      <div className="fine" data-viewer="unsupported">
        <p>{t.d3p_viewer_unsupported}</p>
        <button type="button" onClick={() => onOpenFile(runId, relPath)}>
          {t.d3p_open_file}
        </button>
      </div>
    );
  }

  return (
    <div data-viewer={kind}>
      {state === "loading" && <div className="fine">{t.d3p_viewer_loading}</div>}
      {state === "error" && <div className="fine">{t.d3p_viewer_error}</div>}
      <div ref={hostRef} style={{ width: "100%", height: HEIGHT, display: state === "error" ? "none" : "block" }} />
      {state === "ready" && (
        <div className="fine">
          {t.d3p_viewer_grid_mm} · {t.d3p_viewer_hint}
          {kind === "gltf" ? ` ${t.d3p_viewer_gltf_note}` : ""}
        </div>
      )}
    </div>
  );
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      for (const v of Object.values(x)) {
        if (v && typeof (v as THREE.Texture).dispose === "function" && (v as THREE.Texture).isTexture) {
          (v as THREE.Texture).dispose();
        }
      }
      x.dispose();
    }
  });
}
