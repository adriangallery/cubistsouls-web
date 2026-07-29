"use client";

// EXTRUSION LAB — extrudes the 8 official vector trait plates of a soul into
// stacked 3D slabs (real z-order), under a studio three-point light rig.
// Data comes straight from the assets repo: svg-manifest.json (label → file,
// zOrder) + traits/index.json (token → trait label per category).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const RAW = "https://raw.githubusercontent.com/adriangallery/cubist-souls-assets/main";
const CANVAS = 768; // trait plate viewBox

type LayerData = {
  catLabel: string;
  traitLabel: string;
  paths: any[]; // SVGLoader ShapePath[]
  gradientFirstStop: Record<string, string>;
};

type Resolved = { layers: LayerData[]; skipped: string[] };

// First stop-color of every gradient in the doc — SVGLoader can't rasterise
// gradients, so a flat fill from the first stop is the least-wrong fallback.
function extractGradientStops(svgText: string): Record<string, string> {
  const map: Record<string, string> = {};
  const gradRe = /<(linearGradient|radialGradient)[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = gradRe.exec(svgText))) {
    const body = m[3];
    const stop =
      /stop-color\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgb[^;"')]+|[a-zA-Z]+)/.exec(body);
    if (stop) map[m[2]] = stop[1];
  }
  return map;
}

function pathColor(path: any, gradients: Record<string, string>, kind: "fill" | "stroke") {
  const raw: string | undefined = path.userData?.style?.[kind];
  if (!raw || raw === "none") return null;
  if (raw.startsWith("url(")) {
    const id = raw.replace(/url\(["']?#?/, "").replace(/["']?\)/, "");
    const c = gradients[id];
    return new THREE.Color().setStyle(c || "#8a6a4a");
  }
  try {
    return new THREE.Color().setStyle(raw);
  } catch {
    return new THREE.Color("#8a6a4a");
  }
}

export default function Extrude3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [tokenInput, setTokenInput] = useState("136");
  const [status, setStatus] = useState("warming up the workshop…");
  const [traits, setTraits] = useState<{ cat: string; label: string }[]>([]);
  const [depth, setDepth] = useState(12);
  const [gap, setGap] = useState(16);
  const [spin, setSpin] = useState(true);

  // Long-lived three objects + loaded layer cache, owned outside React state.
  const three = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    controls?: OrbitControls;
    soul?: THREE.Group;
    layers?: LayerData[];
    manifest?: any;
    traitsIdx?: any;
    disposed?: boolean;
  }>({});
  const wanted = useRef({ depth: 12, gap: 16 });

  // ------- scene bootstrap (once) -------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const t = three.current;
    t.disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#120a0b");
    scene.fog = new THREE.Fog("#120a0b", 70, 160);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    camera.position.set(0, 7, 40);

    // Soft studio reflections without an HDR file.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

    // ---- studio rig: warm key, cool fill, ember rim ----
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
    key.position.set(18, 26, 28);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -32;
    key.shadow.camera.right = key.shadow.camera.top = 32;
    key.shadow.camera.far = 120;
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9db8ff, 0.7);
    fill.position.set(-24, 10, 16);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffb020, 1.5);
    rim.position.set(-6, 16, -26);
    scene.add(rim);

    // ---- cyclorama: floor + back wall, museum-dark ----
    const cycMat = new THREE.MeshStandardMaterial({ color: "#1b1315", roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), cycMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -13;
    floor.receiveShadow = true;
    scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(300, 160), cycMat);
    wall.position.set(0, 60, -60);
    wall.receiveShadow = true;
    scene.add(wall);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    controls.minDistance = 14;
    controls.maxDistance = 90;

    Object.assign(t, { renderer, scene, camera, controls });

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      t.disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      pmrem.dispose();
      disposeGroup(t.soul);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  function disposeGroup(g?: THREE.Group) {
    if (!g) return;
    g.traverse((o: any) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose());
    });
    g.parent?.remove(g);
  }

  // Build (or rebuild) the extruded soul from cached layer data.
  function buildSoul() {
    const t = three.current;
    if (!t.scene || !t.layers) return;
    const { depth: D, gap: G } = wanted.current;
    disposeGroup(t.soul);

    // Everything is built in SVG units (0..768, y down); the outer group flips
    // Y and scales the whole stack to ~22 world units.
    const s = 22 / CANVAS;
    const inner = new THREE.Group();
    const stackDepth = (t.layers.length - 1) * G + D;

    t.layers.forEach((layer, li) => {
      const lg = new THREE.Group();
      lg.position.z = li * G - stackDepth / 2;
      layer.paths.forEach((path: any) => {
        const style = path.userData?.style || {};
        const fillCol = pathColor(path, layer.gradientFirstStop, "fill");
        if (fillCol) {
          const shapes = SVGLoader.createShapes(path);
          if (shapes.length) {
            const geo = new THREE.ExtrudeGeometry(shapes, {
              depth: D,
              bevelEnabled: true,
              bevelThickness: 1.1,
              bevelSize: 0.9,
              bevelSegments: 2,
              curveSegments: 10,
            });
            const opacity = (style.fillOpacity ?? 1) * (style.opacity ?? 1);
            const mat = new THREE.MeshPhysicalMaterial({
              color: fillCol,
              roughness: 0.38,
              metalness: 0.04,
              clearcoat: 0.55,
              clearcoatRoughness: 0.35,
              transparent: opacity < 1,
              opacity,
              side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            lg.add(mesh);
          }
        }
        const strokeCol = pathColor(path, layer.gradientFirstStop, "stroke");
        if (strokeCol) {
          for (const sub of path.subPaths) {
            const geo = SVGLoader.pointsToStroke(sub.getPoints(), style as any);
            if (!geo) continue;
            const mat = new THREE.MeshBasicMaterial({
              color: strokeCol,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: (style.strokeOpacity ?? 1) * (style.opacity ?? 1),
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.z = D + 0.4; // paint strokes on the slab face
            lg.add(mesh);
          }
        }
      });
      inner.add(lg);
    });

    inner.position.set(-CANVAS / 2, -CANVAS / 2, 0);
    const outer = new THREE.Group();
    outer.scale.set(s, -s, s);
    outer.add(inner);
    t.scene.add(outer);
    t.soul = outer;
  }

  // ------- data: manifest + traits index (once), then token loads -------
  async function ensureData() {
    const t = three.current;
    if (!t.manifest) {
      const [manifest, traitsIdx] = await Promise.all([
        fetch(`${RAW}/svg/svg-manifest.json`, { cache: "force-cache" }).then((r) => r.json()),
        fetch(`${RAW}/traits/index.json`, { cache: "force-cache" }).then((r) => r.json()),
      ]);
      t.manifest = manifest;
      t.traitsIdx = traitsIdx;
    }
  }

  async function loadToken(idStr: string) {
    const id = Math.floor(Number(idStr));
    if (!Number.isFinite(id) || id < 1 || id > 10000) {
      setStatus("soul id must be 1–10000");
      return;
    }
    const t = three.current;
    setStatus(`fetching the plates of soul #${id}…`);
    try {
      await ensureData();
      const { manifest, traitsIdx } = t;
      const loader = new SVGLoader();
      const layers: LayerData[] = [];
      const skipped: string[] = [];
      const shown: { cat: string; label: string }[] = [];

      await Promise.all(
        manifest.zOrder.map(async (catId: string, i: number) => {
          const cat = manifest.categories.find((c: any) => c.id === catId);
          if (!cat) return;
          const label =
            traitsIdx.values[cat.label]?.[
              traitsIdx.tokens[cat.label].charCodeAt(id - 1) - traitsIdx.base
            ] ?? null;
          if (!label) {
            skipped.push(cat.label);
            return;
          }
          const opt = cat.options.find((o: any) => o.label === label);
          if (!opt) {
            skipped.push(`${cat.label}: ${label}`);
            return;
          }
          const text = await fetch(`${RAW}/${cat.dir}/${opt.file}`, { cache: "force-cache" }).then(
            (r) => {
              if (!r.ok) throw new Error(`${opt.file} ${r.status}`);
              return r.text();
            }
          );
          layers[i] = {
            catLabel: cat.label,
            traitLabel: label,
            paths: loader.parse(text).paths,
            gradientFirstStop: extractGradientStops(text),
          };
          shown[i] = { cat: cat.label, label };
        })
      );

      t.layers = layers.filter(Boolean);
      if (!t.layers.length) {
        setStatus(`soul #${id} has no vector plates (1/1 or honorary) — try another`);
        setTraits([]);
        return;
      }
      buildSoul();
      setTraits(shown.filter(Boolean));
      setStatus(
        skipped.length
          ? `soul #${id} · ${t.layers.length} layers extruded · skipped: ${skipped.join(", ")}`
          : `soul #${id} · ${t.layers.length} layers extruded — drag to turn, scroll to zoom`
      );
    } catch (e: any) {
      setStatus(`could not load soul #${id} — ${e?.message || "network error"}`);
    }
  }

  // initial token
  useEffect(() => {
    loadToken("136");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // slider → rebuild / retune
  useEffect(() => {
    wanted.current.depth = depth;
    wanted.current.gap = gap;
    if (three.current.layers) buildSoul();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth, gap]);

  useEffect(() => {
    if (three.current.controls) three.current.controls.autoRotate = spin;
  }, [spin]);

  return (
    <main className="lab3d">
      <header className="lab3d-head">
        <p className="eyebrow">workshop · unlisted experiment</p>
        <h1 className="lab3d-title">Extrusion Lab</h1>
        <p className="lab3d-sub">
          every plate of the canvas, pulled into depth — the soul as sculpture
        </p>
      </header>

      <section className="lab3d-controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadToken(tokenInput);
          }}
        >
          <label>
            soul №
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              inputMode="numeric"
              maxLength={5}
            />
          </label>
          <button type="submit" className="lab3d-btn">
            summon
          </button>
        </form>
        <label className="lab3d-slider">
          depth <span>{depth}</span>
          <input
            type="range"
            min={2}
            max={40}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
        </label>
        <label className="lab3d-slider">
          spread <span>{gap}</span>
          <input
            type="range"
            min={0}
            max={120}
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
          />
        </label>
        <label className="lab3d-check">
          <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} />
          turntable
        </label>
      </section>

      <div className="lab3d-stage" ref={mountRef} />

      <p className="lab3d-status">{status}</p>
      {traits.length > 0 && (
        <ul className="lab3d-traits">
          {traits.map((tr) => (
            <li key={tr.cat}>
              <b>{tr.cat}</b> {tr.label}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
