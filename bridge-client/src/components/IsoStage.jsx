import { useEffect, useRef, useState } from "react";
import IsoPilot from "./IsoPilot.jsx";
import { EmoteBubble } from "./Emotes.jsx";

// Isometric playfield. Projects world (x,y) into angled 2.5D screen space, draws
// the station floor (rooms as diamonds, corridors between them) on a canvas, and
// overlays station markers + character models as DOM. Camera follows you. Click
// (or hold) on the floor to set a movement destination — the server is
// authoritative; we interpolate other players between its 10 Hz updates so
// motion looks smooth.
//
// Iso projection: screen = ( (x - y) * COS, (x + y) * SIN ) — classic 2:1 iso.
const ISO = { cos: 0.86, sin: 0.5, scale: 0.62 };
function toScreen(wx, wy) { return { sx: (wx - wy) * ISO.cos * ISO.scale, sy: (wx + wy) * ISO.sin * ISO.scale }; }

// ---- Room art image cache ----
// Each room TYPE may have a top-down art PNG at /assets/rooms/<slug>.png. We load
// it lazily, once, and remember success/failure so the renderer can fall back to
// the drawn diamond when art is missing (the game stays fully playable with zero
// art files present — art is purely additive). Drop files into the client's
// public/assets/rooms/ folder (see the art template guide) and they appear here.
const roomImgCache = {}; // slug -> { img, status: 'loading'|'ok'|'fail' }
function roomSlug(name) {
  return name.replace(/\s+\d+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function getRoomImage(name) {
  const slug = roomSlug(name);
  let entry = roomImgCache[slug];
  if (!entry) {
    entry = roomImgCache[slug] = { img: new Image(), status: "loading" };
    entry.img.onload = () => { entry.status = "ok"; };
    entry.img.onerror = () => { entry.status = "fail"; };
    entry.img.src = `/assets/rooms/${slug}.png`;
  }
  return entry;
}

export default function IsoStage({ view, emoteBubbles = {} }) {
  const geo = view?.map?.geometry;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  // accessibility prefs that affect player rendering (symbols + labels)
  const [a11y, setA11y] = useState({ colorblindShapes: true, colorblindLabels: false, ghostReadability: true });
  useEffect(() => {
    import("../api/backend.js").then((api) => api.getSettings?.()
      .then((s) => s?.accessibility && setA11y({
        colorblindShapes: s.accessibility.colorblindShapes !== false,
        colorblindLabels: !!s.accessibility.colorblindLabels,
        ghostReadability: s.accessibility.ghostReadability !== false,
      })).catch(() => {})).catch(() => {});
  }, []);

  // Smooth interpolation: keep a local render-position per player that eases
  // toward the authoritative server position each animation frame.
  const renderPos = useRef({});           // id -> {x,y, fx,fy facing}
  const lastFacing = useRef({});
  const [, force] = useState(0);          // re-render tick for DOM overlay

  // size to container
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // animation loop: ease render positions toward server truth + redraw floor
  useEffect(() => {
    let raf;
    const loop = () => {
      const players = view?.players || [];
      for (const p of players) {
        if (p.x == null || p.y == null) continue;
        const r = renderPos.current[p.id] || (renderPos.current[p.id] = { x: p.x, y: p.y });
        const dx = p.x - r.x, dy = p.y - r.y;
        // facing from movement delta (server pos vs render pos)
        if (Math.hypot(dx, dy) > 1.5) {
          r.facing = (dx >= 0 ? (dy >= 0 ? "SE" : "NE") : (dy >= 0 ? "SW" : "NW"));
          r.moving = true;
        } else { r.moving = false; }
        r.x += dx * 0.25; r.y += dy * 0.25; // ease
      }
      drawFloor();
      force((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [view, dims]);

  // camera offset centers on YOU (or world center)
  function camera() {
    const me = view?.you;
    const meR = me && renderPos.current[me.id];
    const focus = meR || { x: (geo?.worldW || 0) / 2, y: (geo?.worldH || 0) / 2 };
    const s = toScreen(focus.x, focus.y);
    return { ox: dims.w / 2 - s.sx, oy: dims.h / 2 - s.sy };
  }

  function drawFloor() {
    const cv = canvasRef.current; if (!cv || !geo) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== dims.w * dpr) { cv.width = dims.w * dpr; cv.height = dims.h * dpr; }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    const { ox, oy } = camera();

    // corridors first (thick connecting bands)
    ctx.lineCap = "round";
    for (const [a, b] of geo.corridors) {
      const ra = geo.rooms[a], rb = geo.rooms[b]; if (!ra || !rb) continue;
      const ca = toScreen(ra.x + ra.w / 2, ra.y + ra.h / 2);
      const cb = toScreen(rb.x + rb.w / 2, rb.y + rb.h / 2);
      ctx.strokeStyle = "rgba(80,72,104,0.55)"; ctx.lineWidth = 20;
      ctx.beginPath(); ctx.moveTo(ca.sx + ox, ca.sy + oy); ctx.lineTo(cb.sx + ox, cb.sy + oy); ctx.stroke();
      ctx.strokeStyle = "rgba(40,36,58,0.9)"; ctx.lineWidth = 13;
      ctx.beginPath(); ctx.moveTo(ca.sx + ox, ca.sy + oy); ctx.lineTo(cb.sx + ox, cb.sy + oy); ctx.stroke();
    }

    // rooms as iso diamonds
    const refill = new Set(view.map.refillRooms || []);
    const turret = new Set(view.map.turretRooms || []);
    const repair = new Set(view.map.repairRooms || []);
    const myRoom = view.you?.room;
    for (const [name, r] of Object.entries(geo.rooms)) {
      const c = [
        toScreen(r.x, r.y), toScreen(r.x + r.w, r.y),
        toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h),
      ].map((p) => ({ x: p.sx + ox, y: p.sy + oy }));
      const here = name === myRoom;
      // clip to the room diamond
      ctx.save();
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();

      const art = getRoomImage(name);
      if (art.status === "ok" && art.img.width) {
        // Map the square art onto the iso parallelogram via an affine transform.
        // Top-left=c[0], top-right=c[1], bottom-left=c[3]. Image is art.img.width sq.
        ctx.clip();
        const iw = art.img.width, ih = art.img.height;
        const ax = (c[1].x - c[0].x) / iw, ay = (c[1].y - c[0].y) / iw; // image x-axis
        const bx = (c[3].x - c[0].x) / ih, by = (c[3].y - c[0].y) / ih; // image y-axis
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.transform(ax, ay, bx, by, c[0].x, c[0].y);
        ctx.drawImage(art.img, 0, 0);
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.restore();
        // highlight ring for your current room
        if (here) {
          ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
          ctx.strokeStyle = "rgba(255,45,77,0.8)"; ctx.lineWidth = 2.5; ctx.stroke();
        }
      } else {
        // fallback: drawn diamond + a subtle iso tech-grid texture so the floor
        // doesn't read as flat. Keeps the game fully playable with no art present.
        ctx.fillStyle = here ? "#241d33" : "#1a1626"; ctx.fill();
        // clip to the room and draw grid lines along the two iso axes
        ctx.save();
        ctx.clip();
        ctx.lineWidth = 1;
        ctx.strokeStyle = here ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.04)";
        const STEP = 56; // world units between grid lines
        for (let gx = 0; gx <= r.w; gx += STEP) {
          const p0 = toScreen(r.x + gx, r.y), p1 = toScreen(r.x + gx, r.y + r.h);
          ctx.beginPath(); ctx.moveTo(p0.sx + ox, p0.sy + oy); ctx.lineTo(p1.sx + ox, p1.sy + oy); ctx.stroke();
        }
        for (let gy = 0; gy <= r.h; gy += STEP) {
          const p0 = toScreen(r.x, r.y + gy), p1 = toScreen(r.x + r.w, r.y + gy);
          ctx.beginPath(); ctx.moveTo(p0.sx + ox, p0.sy + oy); ctx.lineTo(p1.sx + ox, p1.sy + oy); ctx.stroke();
        }
        // a faint accent ring near the room edge for depth
        const inset = 14;
        const e = [toScreen(r.x + inset, r.y + inset), toScreen(r.x + r.w - inset, r.y + inset),
                   toScreen(r.x + r.w - inset, r.y + r.h - inset), toScreen(r.x + inset, r.y + r.h - inset)];
        ctx.strokeStyle = here ? "rgba(255,45,77,0.18)" : "rgba(90,81,112,0.18)";
        ctx.beginPath(); ctx.moveTo(e[0].sx + ox, e[0].sy + oy);
        for (let i = 1; i < 4; i++) ctx.lineTo(e[i].sx + ox, e[i].sy + oy); ctx.closePath(); ctx.stroke();
        ctx.restore();
        // room outline
        ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
        ctx.strokeStyle = here ? "rgba(255,45,77,0.7)" : "rgba(90,81,112,0.5)";
        ctx.lineWidth = here ? 2.5 : 1.5; ctx.stroke();
        ctx.restore();
      }
      // room label
      const ctr = toScreen(r.x + r.w / 2, r.y + r.h / 2);
      ctx.fillStyle = art.status === "ok" ? "#f7f3e9" : (here ? "#f7f3e9" : "#6f6688");
      ctx.font = "600 11px Rajdhani, sans-serif"; ctx.textAlign = "center";
      // a subtle shadow so labels read over art
      if (art.status === "ok") { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(name, ctr.sx + ox + 1, ctr.sy + oy - 3); ctx.fillStyle = "#f7f3e9"; }
      ctx.fillText(name, ctr.sx + ox, ctr.sy + oy - 4);
      // station glyphs
      let tag = null, col = null;
      if (refill.has(name)) { tag = "O₂"; col = "#46e6ff"; }
      else if (repair.has(name)) { tag = "⚒"; col = "#ffc83d"; }
      else if (turret.has(name)) { tag = "▣"; col = "#ff2d4d"; }
      if (tag) { ctx.fillStyle = col; ctx.font = "700 12px Rajdhani"; ctx.fillText(tag, ctr.sx + ox, ctr.sy + oy + 12); }
    }

    // furniture blockers: draw each collision rect as a filled iso quad so the
    // obstacles players bump into are visible (matches the server's collision data).
    const blockers = view.map.blockers || {};
    for (const rects of Object.values(blockers)) {
      for (const b of rects) {
        const q = [
          toScreen(b.x, b.y), toScreen(b.x + b.w, b.y),
          toScreen(b.x + b.w, b.y + b.h), toScreen(b.x, b.y + b.h),
        ].map((p) => ({ x: p.sx + ox, y: p.sy + oy }));
        ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y); ctx.closePath();
        ctx.fillStyle = "rgba(60,54,82,0.85)"; ctx.fill();
        ctx.strokeStyle = "rgba(120,110,150,0.6)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  if (!geo) return <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--faint)" }} className="impactf">NO SPATIAL MAP</div>;

  const { ox, oy } = camera();
  const players = view.players || [];

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "default", background: "radial-gradient(120% 100% at 50% 30%, #15111f 0%, #0b0911 70%)" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {/* in-world TASK markers: a yellow "!" you walk up to and press E. Only your
          own uncompleted tasks show, in the room you're in. Glows brighter when
          you're close enough to interact. */}
      {(view.you?.tasks || []).filter((t) => !t.done && t.x != null && t.room === view.you?.room).map((t) => {
        const s = toScreen(t.x, t.y);
        const near = view.you?.x != null && Math.hypot(t.x - view.you.x, t.y - view.you.y) <= 70;
        return (
          <div key={t.id} style={{ position: "absolute", left: s.sx + ox, top: s.sy + oy, transform: "translate(-50%,-100%)", pointerEvents: "none", textAlign: "center" }}>
            <div style={{ fontSize: near ? 30 : 24, lineHeight: 1, color: "#ffd24d", fontWeight: 900,
              textShadow: near ? "0 0 12px #ffd24d, 0 2px 3px #000" : "0 2px 3px #000", animation: "taskbob 1.2s ease-in-out infinite" }}>❗</div>
            {near && <div style={{ fontFamily: "var(--impact)", fontSize: 10, color: "#ffd24d", background: "rgba(13,11,20,0.85)", padding: "1px 6px", marginTop: 2, whiteSpace: "nowrap" }}>E · {t.name}</div>}
          </div>
        );
      })}
      {/* characters, depth-sorted by world y+x so nearer ones overlap farther */}
      {[...players]
        .filter((p) => p.x != null && p.y != null)
        .map((p) => ({ p, r: renderPos.current[p.id] || { x: p.x, y: p.y } }))
        .sort((a, b) => (a.r.x + a.r.y) - (b.r.x + b.r.y))
        .map(({ p, r }) => {
          const s = toScreen(r.x, r.y);
          const isYou = p.id === view.you?.id;
          return (
            <div key={p.id} style={{ position: "absolute", left: s.sx + ox, top: s.sy + oy }}>
              <IsoPilot player={p} facing={r.facing || "SE"} moving={r.moving} isYou={isYou}
                showSymbol={a11y.colorblindShapes} showLabel={a11y.colorblindLabels} />
              {emoteBubbles[p.id] && <EmoteBubble emoji={emoteBubbles[p.id].emoji} />}
              {a11y.ghostReadability && (p.plane === "energy" || p.plane === "eliminated") && (
                <div style={{ position: "absolute", left: "50%", top: -20, transform: "translate(-50%,-100%)",
                  fontFamily: "var(--impact)", fontSize: 9, padding: "0 5px", background: "rgba(70,230,255,0.18)",
                  color: "#7fe8ff", border: "1px dashed #46e6ff", whiteSpace: "nowrap" }}>
                  {p.plane === "eliminated" ? "FROZEN" : "GHOST"}
                </div>
              )}
              <div style={{ position: "absolute", left: "50%", top: -2, transform: "translate(-50%,-100%)", whiteSpace: "nowrap",
                fontFamily: "var(--impact)", fontSize: 10, padding: "1px 6px", background: "rgba(13,11,20,0.8)",
                color: isYou ? "var(--hot)" : "var(--paper)", border: `1px solid ${p.idColor?.hex || "var(--line)"}` }}>
                {p.name}
              </div>
            </div>
          );
        })}
      <style>{`@keyframes pilotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}} @keyframes emotePop{0%{transform:translateX(-50%) scale(0.3);opacity:0}60%{transform:translateX(-50%) scale(1.15)}100%{transform:translateX(-50%) scale(1);opacity:1}} @keyframes taskbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
    </div>
  );
}
