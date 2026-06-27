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

const TEXTURES = {
  "Helm": "./textures/room_helm.png",
  "Engineering": "./textures/room_engineering.png",
  "Sensors": "./textures/room_sensors.png",
  "Reactor": "./textures/room_reactor.png",
  "Medbay": "./textures/room_medbay.png",
  "Cargo": "./textures/room_cargo.png",
  "Hangar": "./textures/room_hangar.png",
  "Comms Array": "./textures/room_comms.png",
  "Labs": "./textures/room_labs.png",
  "Galley": "./textures/room_galley.png",
  "Storage": "./textures/room_storage.png",
  "Airlock": "./textures/room_airlock.png",
  "Space": "./textures/room_space.png",
  "Turret": "./textures/room_turret.png",
  "Corridor": "./textures/room_corridor.png",
};
const IMG_CACHE = {};
if (typeof Image !== "undefined") {
  Object.entries(TEXTURES).forEach(([k, v]) => {
    const img = new Image();
    img.src = v;
    IMG_CACHE[k] = img;
  });
}

export default function IsoStage({ view, showColorblind = false }) {
  const geo = view?.map?.geometry;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  // No longer using external images for floor/wall, using bright vectors instead.

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

    // -- 1) DRAW ROOM FLOORS --
    const refill = new Set(view.map.refillRooms || []);
    const turret = new Set(view.map.turretRooms || []);
    const repair = new Set(view.map.repairRooms || []);
    const myRoom = view.you?.room;
    
    for (const [name, r] of Object.entries(geo.rooms)) {
      const here = name === myRoom;
      const texKey = name.startsWith("Turret") ? "Turret" : (name.startsWith("Corridor") || name.includes("Junction") ? "Corridor" : name);
      const img = IMG_CACHE[texKey] || IMG_CACHE["Storage"];
      
      ctx.save();
      const c = [
        toScreen(r.x, r.y), toScreen(r.x + r.w, r.y),
        toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h),
      ].map((p) => ({ x: p.sx + ox, y: p.sy + oy }));
      
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
      
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.clip(); // clip to the exact floor diamond
        
        ctx.translate(ox, oy);
        ctx.transform(ISO.cos * ISO.scale, ISO.sin * ISO.scale, -ISO.cos * ISO.scale, ISO.sin * ISO.scale, 0, 0);
        
        // Draw the continuous floor texture! No holes.
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
        
        if (here) { ctx.fillStyle = "rgba(255, 200, 61, 0.1)"; ctx.fillRect(r.x, r.y, r.w, r.h); }
        else { ctx.fillStyle = "rgba(0, 0, 0, 0.4)"; ctx.fillRect(r.x, r.y, r.w, r.h); }
        ctx.restore();
      } else {
        ctx.fillStyle = here ? "rgba(255, 200, 61, 0.2)" : "#1a1525";
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(0, 240, 255, 0.15)"; ctx.lineWidth = 1;
        for (let i = r.x; i < r.x + r.w; i += 120) {
          const p1 = toScreen(i, r.y), p2 = toScreen(i, r.y + r.h);
          ctx.beginPath(); ctx.moveTo(p1.sx + ox, p1.sy + oy); ctx.lineTo(p2.sx + ox, p2.sy + oy); ctx.stroke();
        }
        for (let j = r.y; j < r.y + r.h; j += 120) {
          const p1 = toScreen(r.x, j), p2 = toScreen(r.x + r.w, j);
          ctx.beginPath(); ctx.moveTo(p1.sx + ox, p1.sy + oy); ctx.lineTo(p2.sx + ox, p2.sy + oy); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // time-based animation for stars
    const t = Date.now() / 1000;
    const engineSpeed = view.engine?.helmMomentum?.current || 1;
    const isAttacked = view.map?.globalAttack != null;

    // -- 3) DRAW WALLS AND FURNITURE --
    for (const [name, r] of Object.entries(geo.rooms)) {
      const here = name === myRoom;
      const texKey = name.startsWith("Turret") ? "Turret" : (name.startsWith("Corridor") || name.includes("Junction") ? "Corridor" : name);
      const img = IMG_CACHE[texKey] || IMG_CACHE["Storage"];
      const hasImg = img && img.complete && img.naturalWidth;
      
      const pTop = { x: r.x, y: r.y };
      const pRight = { x: r.x + r.w, y: r.y };
      const pLeft = { x: r.x, y: r.y + r.h };
      
      const sTop = toScreen(pTop.x, pTop.y);
      const sRight = toScreen(pRight.x, pRight.y);
      const sLeft = toScreen(pLeft.x, pLeft.y);
      
      const WALL_H = 300;
      const sTopH = toScreen(pTop.x, pTop.y); sTopH.sy -= WALL_H * ISO.scale;
      const sRightH = toScreen(pRight.x, pRight.y); sRightH.sy -= WALL_H * ISO.scale;
      const sLeftH = toScreen(pLeft.x, pLeft.y); sLeftH.sy -= WALL_H * ISO.scale;
      
      // -- DRAW ANIMATED STARS (HELM) --
      if (name === "Helm") {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sTop.sx + ox, sTop.sy + oy);
        ctx.lineTo(sLeft.sx + ox, sLeft.sy + oy);
        ctx.lineTo(sLeftH.sx + ox, sLeftH.sy + oy);
        ctx.lineTo(sTopH.sx + ox, sTopH.sy + oy);
        ctx.clip(); // Clip to left wall area
        
        ctx.fillStyle = "#05020a"; 
        ctx.fillRect(-1000 + ox, -1000 + oy, 4000, 4000);
        
        ctx.fillStyle = "#ffffff";
        const starSpeed = 800 * engineSpeed + 100; 
        const offset = (t * starSpeed) % 800;
        for (let i = 0; i < 150; i++) {
          const sx = ((i * 137) % 800) - offset;
          const sy = (i * 93) % 400;
          let finalX = sx;
          while(finalX < -400) finalX += 800;
          ctx.globalAlpha = (i % 5) / 5 + 0.2;
          ctx.beginPath(); ctx.arc(sTop.sx + ox + finalX, sTopH.sy + oy + sy, i%3, 0, 6); ctx.fill();
        }
        if (isAttacked && Math.random() > 0.8) {
           ctx.fillStyle = "rgba(255, 100, 50, 0.8)";
           ctx.beginPath(); ctx.arc(sTop.sx + ox - 200 + Math.random()*400, sTopH.sy + oy + Math.random()*200, Math.random()*50, 0, 6); ctx.fill();
        }
        ctx.restore();
      }

      // -- DRAW TOP-RIGHT WALL --
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sTop.sx + ox, sTop.sy + oy); ctx.lineTo(sRight.sx + ox, sRight.sy + oy);
      ctx.lineTo(sRightH.sx + ox, sRightH.sy + oy); ctx.lineTo(sTopH.sx + ox, sTopH.sy + oy); ctx.closePath();
      
      if (hasImg) {
          ctx.clip();
          const hClip = r.h * 0.15; // Top 15% of image folds up to the right wall
          ctx.translate(sTopH.sx + ox, sTopH.sy + oy);
          ctx.transform(ISO.cos * ISO.scale, ISO.sin * ISO.scale, 0, WALL_H / hClip, 0, 0);
          ctx.drawImage(img, 0, 0, img.width, img.height * 0.15, 0, 0, r.w, hClip);
      } else {
          ctx.fillStyle = "#3c3258"; ctx.fill(); 
      }
      // Inner corner crease
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sTop.sx + ox, sTop.sy + oy); ctx.lineTo(sRight.sx + ox, sRight.sy + oy); ctx.stroke();
      ctx.restore();
      
      // -- DRAW TOP-LEFT WALL --
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sTop.sx + ox, sTop.sy + oy); ctx.lineTo(sLeft.sx + ox, sLeft.sy + oy);
      ctx.lineTo(sLeftH.sx + ox, sLeftH.sy + oy); ctx.lineTo(sTopH.sx + ox, sTopH.sy + oy); ctx.closePath();
      
      if (name === "Helm" && hasImg) {
          // Punch a window hole BEFORE drawing the folded wall texture so stars show through!
          const wTop = { sx: sTopH.sx * 0.85 + sLeftH.sx * 0.15, sy: sTopH.sy * 0.85 + sLeftH.sy * 0.15 };
          const wBot = { sx: sTop.sx * 0.85 + sLeft.sx * 0.15, sy: sTop.sy * 0.85 + sLeft.sy * 0.15 };
          const wTop2 = { sx: sTopH.sx * 0.15 + sLeftH.sx * 0.85, sy: sTopH.sy * 0.15 + sLeftH.sy * 0.85 };
          const wBot2 = { sx: sTop.sx * 0.15 + sLeft.sx * 0.85, sy: sTop.sy * 0.15 + sLeft.sy * 0.85 };
          
          ctx.moveTo(wTop2.sx + ox, wTop2.sy + oy + 40);
          ctx.lineTo(wBot2.sx + ox, wBot2.sy + oy - 40);
          ctx.lineTo(wBot.sx + ox, wBot.sy + oy - 40);
          ctx.lineTo(wTop.sx + ox, wTop.sy + oy + 40);
          ctx.closePath();
          ctx.clip("evenodd");
      } else {
          ctx.clip();
      }
      
      if (hasImg) {
          const wClip = r.w * 0.15; // Left 15% of image folds up to the left wall
          ctx.translate(sTopH.sx + ox, sTopH.sy + oy);
          ctx.transform(0, WALL_H / wClip, -ISO.cos * ISO.scale, ISO.sin * ISO.scale, 0, 0);
          ctx.drawImage(img, 0, 0, img.width * 0.15, img.height, 0, 0, wClip, r.h);
      } else {
          ctx.fillStyle = "#2d2545"; ctx.fill();
      }
      ctx.restore();
      
      // Inner corner creases
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sTop.sx + ox, sTop.sy + oy); ctx.lineTo(sLeft.sx + ox, sLeft.sy + oy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sTop.sx + ox, sTop.sy + oy); ctx.lineTo(sTopH.sx + ox, sTopH.sy + oy); ctx.stroke();

      // Draw room label at center of the floor
      const cCenter = toScreen(r.x + r.w / 2, r.y + r.h / 2);
      ctx.fillStyle = here ? "#ffffff" : "#00f0ff";
      ctx.font = "800 15px Rajdhani, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(name, cCenter.sx + ox, cCenter.sy + oy - 4);
      
      let tag = null, col = null;
      if (refill.has(name)) { tag = "O₂"; col = "#46e6ff"; }
      else if (repair.has(name)) { tag = "⚒"; col = "#ffc83d"; }
      else if (turret.has(name)) { tag = "▣"; col = "#ff2d4d"; }
      if (tag) { ctx.fillStyle = col; ctx.font = "700 12px Rajdhani"; ctx.fillText(tag, cCenter.sx + ox, cCenter.sy + oy + 12); }
    }
    
    // -- DRAW CORRIDORS: wall-edge to wall-edge with yellow doorway markers --
    // hw must match CORR_HW on the server (250 world units)
    const CORR_HW = 250;
    ctx.lineCap = "butt";

    // Helper: find point on room's boundary in direction (ux,uy) from center
    const wallExit = (r, ux, uy) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const tx = Math.abs(ux) > 1e-9 ? (r.w / 2) / Math.abs(ux) : Infinity;
      const ty = Math.abs(uy) > 1e-9 ? (r.h / 2) / Math.abs(uy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: cx + ux * t, y: cy + uy * t };
    };

    for (const [a, b] of geo.corridors) {
      const ra = geo.rooms[a], rb = geo.rooms[b];
      if (!ra || !rb) continue;

      const isAirlockSpace = (a === "Airlock" && b === "Space") || (a === "Space" && b === "Airlock");
      if (isAirlockSpace) continue; // directly touching, no corridor tunnel

      const ax = ra.x + ra.w / 2, ay = ra.y + ra.h / 2;
      const bx = rb.x + rb.w / 2, by = rb.y + rb.h / 2;
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const nx = -uy, ny = ux; // perpendicular

      // Wall mouth points
      const startW = wallExit(ra, ux, uy);   // exit from room A's wall
      const endW   = wallExit(rb, -ux, -uy); // exit from room B's wall

      // Only draw corridor floor if there's actually a gap between rooms
      const gapLen = Math.hypot(endW.x - startW.x, endW.y - startW.y);

      if (gapLen > 20) {
        // 4 corners of the corridor floor polygon
        const c1w = { x: startW.x + nx * CORR_HW, y: startW.y + ny * CORR_HW };
        const c2w = { x: endW.x   + nx * CORR_HW, y: endW.y   + ny * CORR_HW };
        const c3w = { x: endW.x   - nx * CORR_HW, y: endW.y   - ny * CORR_HW };
        const c4w = { x: startW.x - nx * CORR_HW, y: startW.y - ny * CORR_HW };

        const sc1 = toScreen(c1w.x, c1w.y);
        const sc2 = toScreen(c2w.x, c2w.y);
        const sc3 = toScreen(c3w.x, c3w.y);
        const sc4 = toScreen(c4w.x, c4w.y);

        // Dark corridor floor
        ctx.fillStyle = "#12101e";
        ctx.beginPath();
        ctx.moveTo(sc1.sx + ox, sc1.sy + oy);
        ctx.lineTo(sc2.sx + ox, sc2.sy + oy);
        ctx.lineTo(sc3.sx + ox, sc3.sy + oy);
        ctx.lineTo(sc4.sx + ox, sc4.sy + oy);
        ctx.closePath();
        ctx.fill();

        // 3D walls along corridor sides (only the top/back wall to avoid hiding players)
        const WALL_H = 280;
        if (sc1.sy < sc4.sy) {
          const sc1H = { sx: sc1.sx, sy: sc1.sy - WALL_H * ISO.scale };
          const sc2H = { sx: sc2.sx, sy: sc2.sy - WALL_H * ISO.scale };
          ctx.fillStyle = "#2a2040";
          ctx.beginPath(); ctx.moveTo(sc1.sx+ox,sc1.sy+oy); ctx.lineTo(sc2.sx+ox,sc2.sy+oy);
          ctx.lineTo(sc2H.sx+ox,sc2H.sy+oy); ctx.lineTo(sc1H.sx+ox,sc1H.sy+oy); ctx.closePath(); ctx.fill();
        } else {
          const sc3H = { sx: sc3.sx, sy: sc3.sy - WALL_H * ISO.scale };
          const sc4H = { sx: sc4.sx, sy: sc4.sy - WALL_H * ISO.scale };
          ctx.fillStyle = "#382d58";
          ctx.beginPath(); ctx.moveTo(sc3.sx+ox,sc3.sy+oy); ctx.lineTo(sc4.sx+ox,sc4.sy+oy);
          ctx.lineTo(sc4H.sx+ox,sc4H.sy+oy); ctx.lineTo(sc3H.sx+ox,sc3H.sy+oy); ctx.closePath(); ctx.fill();
        }
      }
    }

    // === DRAW GLOWING YELLOW BOUNDARIES (where you can't walk past) ===
    ctx.save();
    ctx.strokeStyle = "#ffe020";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ffe020";
    ctx.shadowBlur = 8;

    // 1) Room walls (leaving gaps at doorways)
    for (const [name, r] of Object.entries(geo.rooms)) {
      if (name === "Space") continue;

      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const roomCorrs = geo.corridors.filter(([a, b]) => a === name || b === name);

      const walls = [
        { p1: { x: r.x, y: r.y }, p2: { x: r.x + r.w, y: r.y }, idx: 0 }, // Top-Right
        { p1: { x: r.x + r.w, y: r.y }, p2: { x: r.x + r.w, y: r.y + r.h }, idx: 1 }, // Bottom-Right
        { p1: { x: r.x + r.w, y: r.y + r.h }, p2: { x: r.x, y: r.y + r.h }, idx: 2 }, // Bottom-Left
        { p1: { x: r.x, y: r.y + r.h }, p2: { x: r.x, y: r.y }, idx: 3 } // Top-Left
      ];

      walls.forEach((wall) => {
        let doorMid = null;
        let doorDir = null;

        for (const [a, b] of roomCorrs) {
          const neighbor = a === name ? b : a;
          const rn = geo.rooms[neighbor];
          if (!rn) continue;

          const ncx = rn.x + rn.w / 2;
          const ncy = rn.y + rn.h / 2;
          const dx = ncx - cx;
          const dy = ncy - cy;

          let wallIdx = -1;
          if (Math.abs(dx) > Math.abs(dy)) {
            wallIdx = dx > 0 ? 1 : 3;
          } else {
            wallIdx = dy > 0 ? 2 : 0;
          }

          if (wall.idx === wallIdx) {
            const len = Math.hypot(dx, dy);
            doorMid = wallExit(r, dx / len, dy / len);
            doorDir = { x: -dy / len, y: dx / len };
            break;
          }
        }

        if (doorMid && doorDir) {
          const doorEdge1 = { x: doorMid.x + doorDir.x * CORR_HW, y: doorMid.y + doorDir.y * CORR_HW };
          const doorEdge2 = { x: doorMid.x - doorDir.x * CORR_HW, y: doorMid.y - doorDir.y * CORR_HW };

          const s1 = toScreen(wall.p1.x, wall.p1.y);
          const s2 = toScreen(wall.p2.x, wall.p2.y);
          const sd1 = toScreen(doorEdge1.x, doorEdge1.y);
          const sd2 = toScreen(doorEdge2.x, doorEdge2.y);

          const d1_to_sd1 = Math.hypot(wall.p1.x - doorEdge1.x, wall.p1.y - doorEdge1.y);
          const d1_to_sd2 = Math.hypot(wall.p1.x - doorEdge2.x, wall.p1.y - doorEdge2.y);
          const closeEdge = d1_to_sd1 < d1_to_sd2 ? sd1 : sd2;
          const farEdge = d1_to_sd1 < d1_to_sd2 ? sd2 : sd1;

          ctx.beginPath(); ctx.moveTo(s1.sx + ox, s1.sy + oy); ctx.lineTo(closeEdge.sx + ox, closeEdge.sy + oy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(farEdge.sx + ox, farEdge.sy + oy); ctx.lineTo(s2.sx + ox, s2.sy + oy); ctx.stroke();
        } else {
          const s1 = toScreen(wall.p1.x, wall.p1.y);
          const s2 = toScreen(wall.p2.x, wall.p2.y);
          ctx.beginPath(); ctx.moveTo(s1.sx + ox, s1.sy + oy); ctx.lineTo(s2.sx + ox, s2.sy + oy); ctx.stroke();
        }
      });
    }

    // 2) Corridor side walls (yellow border outlines)
    for (const [a, b] of geo.corridors) {
      const ra = geo.rooms[a], rb = geo.rooms[b];
      if (!ra || !rb) continue;
      if ((a === "Airlock" && b === "Space") || (a === "Space" && b === "Airlock")) continue;

      const ax = ra.x + ra.w / 2, ay = ra.y + ra.h / 2;
      const bx = rb.x + rb.w / 2, by = rb.y + rb.h / 2;
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const nx = -uy, ny = ux;

      const startW = wallExit(ra, ux, uy);
      const endW = wallExit(rb, -ux, -uy);
      const gapLen = Math.hypot(endW.x - startW.x, endW.y - startW.y);

      if (gapLen > 20) {
        const c1w = { x: startW.x + nx * CORR_HW, y: startW.y + ny * CORR_HW };
        const c2w = { x: endW.x   + nx * CORR_HW, y: endW.y   + ny * CORR_HW };
        const c4w = { x: startW.x - nx * CORR_HW, y: startW.y - ny * CORR_HW };
        const c3w = { x: endW.x   - nx * CORR_HW, y: endW.y   - ny * CORR_HW };

        const sc1 = toScreen(c1w.x, c1w.y);
        const sc2 = toScreen(c2w.x, c2w.y);
        const sc3 = toScreen(c3w.x, c3w.y);
        const sc4 = toScreen(c4w.x, c4w.y);

        ctx.beginPath(); ctx.moveTo(sc1.sx + ox, sc1.sy + oy); ctx.lineTo(sc2.sx + ox, sc2.sy + oy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sc4.sx + ox, sc4.sy + oy); ctx.lineTo(sc3.sx + ox, sc3.sy + oy); ctx.stroke();
      }
    }
    ctx.restore();
  }


  if (!geo) return <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--faint)" }} className="impactf">NO SPATIAL MAP</div>;

  const { ox, oy } = camera();
  const players = view.players || [];

  const getTaskWorldPos = (roomName, taskName) => {
    const r = geo?.rooms?.[roomName];
    if (!r) return null;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;

    let hash = 0;
    const str = taskName || "";
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash);

    const offsets = [
      { dx: -r.w / 4, dy: -r.h / 4 },
      { dx: r.w / 4, dy: r.h / 4 },
      { dx: -r.w / 4, dy: r.h / 4 },
      { dx: r.w / 4, dy: -r.h / 4 },
      { dx: 0, dy: -r.h / 3 },
      { dx: 0, dy: r.h / 3 },
    ];
    const offset = offsets[idx % offsets.length];
    return { x: cx + offset.dx, y: cy + offset.dy };
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "crosshair", background: "radial-gradient(120% 100% at 50% 30%, #1a1030 0%, #0d0820 70%)" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {/* destination marker */}
      {view.you?.tx != null && (() => {
        const s = toScreen(view.you.tx, view.you.ty);
        return <div style={{ position: "absolute", left: s.sx + ox, top: s.sy + oy, width: 14, height: 14, transform: "translate(-50%,-50%)", border: "2px solid var(--hot)", borderRadius: "50%", pointerEvents: "none", opacity: 0.7 }} />;
      })()}
      
      {/* active task exclamation marks */}
      {view.you?.tasks && (() => {
        return view.you.tasks
          .filter(t => !t.done)
          .map((t) => {
            const pos = getTaskWorldPos(t.room, t.name);
            if (!pos) return null;
            const s = toScreen(pos.x, pos.y);
            return (
              <div 
                key={t.id} 
                style={{ 
                  position: "absolute", 
                  left: s.sx + ox, 
                  top: s.sy + oy - 15,
                  transform: "translate(-50%,-100%)", 
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  zIndex: 20
                }}
              >
                <div style={{
                  color: "#ffc83d",
                  fontSize: 32,
                  fontWeight: 900,
                  textShadow: "0 0 12px rgba(255,200,61,0.9)",
                  animation: "taskbob 1.4s ease-in-out infinite",
                  lineHeight: 1
                }}>
                  !
                </div>
                <div style={{
                  background: "rgba(13,11,20,0.85)",
                  border: "1px solid #ffc83d",
                  color: "#ffc83d",
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 2,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.05em",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.5)"
                }}>
                  {t.name}
                </div>
              </div>
            );
          });
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
              <IsoPilot player={p} facing={r.facing || "SE"} moving={r.moving} isYou={isYou} scale={1.2} showColorblind={showColorblind} />
              <div style={{ position: "absolute", left: "50%", top: -2, transform: "translate(-50%,-100%)", whiteSpace: "nowrap",
                fontFamily: "var(--impact)", fontSize: 10, padding: "1px 6px", background: "rgba(13,11,20,0.8)",
                color: isYou ? "var(--hot)" : "var(--paper)", border: `1px solid ${p.idColor?.hex || "var(--line)"}` }}>
                {p.name}
              </div>
            </div>
          );
        })}
      {view?.lightsOut && view?.you?.role !== "impostor" && view?.you?.plane !== "energy" && view?.phase !== "ended" && (
        <div style={{
          position: "absolute",
          inset: -2000,
          pointerEvents: "none",
          background: "radial-gradient(circle 160px at 50% 50%, transparent 20%, rgba(3, 2, 8, 0.98) 70%, rgba(0, 0, 0, 0.995) 100%)",
          zIndex: 140
        }} />
      )}
      <style>{`
        @keyframes pilotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
        @keyframes taskbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
      `}</style>
    </div>
  );
}
