import { useEffect, useRef, useState } from "react";
import IsoPilot from "./IsoPilot.jsx";

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
function toWorld(sx, sy) {
  // invert the projection
  const a = sx / (ISO.cos * ISO.scale), b = sy / (ISO.sin * ISO.scale);
  return { wx: (a + b) / 2, wy: (b - a) / 2 };
}

export default function IsoStage({ view, onMoveTo }) {
  const geo = view?.map?.geometry;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

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
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
      ctx.fillStyle = here ? "#241d33" : "#1a1626"; ctx.fill();
      ctx.strokeStyle = here ? "rgba(255,45,77,0.7)" : "rgba(90,81,112,0.5)";
      ctx.lineWidth = here ? 2.5 : 1.5; ctx.stroke();
      // room label
      const ctr = toScreen(r.x + r.w / 2, r.y + r.h / 2);
      ctx.fillStyle = here ? "#f7f3e9" : "#6f6688";
      ctx.font = "600 11px Rajdhani, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(name, ctr.sx + ox, ctr.sy + oy - 4);
      // station glyphs
      let tag = null, col = null;
      if (refill.has(name)) { tag = "O₂"; col = "#46e6ff"; }
      else if (repair.has(name)) { tag = "⚒"; col = "#ffc83d"; }
      else if (turret.has(name)) { tag = "▣"; col = "#ff2d4d"; }
      if (tag) { ctx.fillStyle = col; ctx.font = "700 12px Rajdhani"; ctx.fillText(tag, ctr.sx + ox, ctr.sy + oy + 12); }
    }
  }

  // click-to-move: screen -> world (account for camera) -> setDestination
  function onClick(e) {
    if (!geo) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const { ox, oy } = camera();
    const sx = e.clientX - rect.left - ox, sy = e.clientY - rect.top - oy;
    const { wx, wy } = toWorld(sx, sy);
    onMoveTo(Math.round(wx), Math.round(wy));
  }

  if (!geo) return <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--faint)" }} className="impactf">NO SPATIAL MAP</div>;

  const { ox, oy } = camera();
  const players = view.players || [];

  return (
    <div ref={wrapRef} onClick={onClick} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "crosshair", background: "radial-gradient(120% 100% at 50% 30%, #15111f 0%, #0b0911 70%)" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {/* destination marker */}
      {view.you?.tx != null && (() => {
        const s = toScreen(view.you.tx, view.you.ty);
        return <div style={{ position: "absolute", left: s.sx + ox, top: s.sy + oy, width: 14, height: 14, transform: "translate(-50%,-50%)", border: "2px solid var(--hot)", borderRadius: "50%", pointerEvents: "none", opacity: 0.7 }} />;
      })()}
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
              <IsoPilot player={p} facing={r.facing || "SE"} moving={r.moving} isYou={isYou} />
              <div style={{ position: "absolute", left: "50%", top: -2, transform: "translate(-50%,-100%)", whiteSpace: "nowrap",
                fontFamily: "var(--impact)", fontSize: 10, padding: "1px 6px", background: "rgba(13,11,20,0.8)",
                color: isYou ? "var(--hot)" : "var(--paper)", border: `1px solid ${p.idColor?.hex || "var(--line)"}` }}>
                {p.name}
              </div>
            </div>
          );
        })}
      <style>{`@keyframes pilotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}`}</style>
    </div>
  );
}
