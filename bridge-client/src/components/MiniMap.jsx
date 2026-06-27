import { useMemo } from "react";

// Tactical minimap. Lays out the map's rooms from its adjacency graph (a quick
// force-free radial/spine layout), draws connections, and marks:
//   • task locations (your incomplete tasks) — gold pips
//   • turret rooms — red brackets
//   • oxygen / refill rooms — cyan O2
//   • your current room — pulsing marker
// Reads the live view the game server streams (rooms, adjacency, refillRooms,
// turretRooms, your tasks, your room).
export default function MiniMap({ view, compact = false, local = false }) {
  const map = view?.map || {};
  const rooms = map.rooms || [];
  const adjacency = map.adjacency || null;
  const refill = new Set(map.refillRooms || []);
  const turret = new Set(map.turretRooms || []);
  const myRoom = view?.you?.room;
  const myTaskRooms = new Set((view?.you?.tasks || []).filter((t) => !t.done).map((t) => t.room));

  // Use geometry positions if available so it matches the actual ship layout perfectly
  const pos = useMemo(() => {
    const out = {};
    if (map.geometry?.rooms) {
      const { worldW, worldH, rooms: gRooms } = map.geometry;
      for (const [name, r] of Object.entries(gRooms)) {
        out[name] = {
          x: (r.x + r.w / 2) / (worldW || 1),
          y: (r.y + r.h / 2) / (worldH || 1),
        };
      }
      return out;
    }
    return layout(rooms, adjacency, map.spawnRoom);
  }, [rooms, adjacency, map.spawnRoom, map.geometry]);

  // Aspect ratio of the actual ship, so the map never squishes or overflows.
  const worldW = map.geometry?.worldW || 1;
  const worldH = map.geometry?.worldH || 1;
  const aspect = worldW && worldH ? worldW / worldH : 1.6;
  const vbW = compact ? 300 : 600;
  const vbH = Math.round(vbW / aspect);
  const PAD = 0.08; // fraction padding so nodes/labels aren't clipped at edges
  // map a normalized 0..1 position into the padded viewBox
  const place = (p) => p ? { x: (PAD + p.x * (1 - 2 * PAD)) * vbW, y: (PAD + p.y * (1 - 2 * PAD)) * vbH } : null;

  // Local mode: zoom into your room + its neighbors. We compute a window in
  // normalized space around those rooms and remap positions into the viewBox.
  let viewport = null;
  const focusSet = new Set(local && myRoom && adjacency ? [myRoom, ...(adjacency[myRoom] || [])] : []);
  if (local && myRoom && adjacency) {
    const focus = [myRoom, ...(adjacency[myRoom] || [])].filter((r) => pos[r]);
    if (focus.length) {
      let minx = 1, maxx = 0, miny = 1, maxy = 0;
      for (const r of focus) { const p = pos[r]; minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
      // pad the window and keep a minimum span so a lone room isn't over-zoomed
      const padX = Math.max(0.12, (maxx - minx) * 0.4), padY = Math.max(0.12, (maxy - miny) * 0.4);
      viewport = { x0: minx - padX, x1: maxx + padX, y0: miny - padY, y1: maxy + padY };
    }
  }
  const placeL = (p) => {
    if (!p) return null;
    if (!viewport) return place(p);
    const nx = (p.x - viewport.x0) / (viewport.x1 - viewport.x0 || 1);
    const ny = (p.y - viewport.y0) / (viewport.y1 - viewport.y0 || 1);
    return { x: (PAD + nx * (1 - 2 * PAD)) * vbW, y: (PAD + ny * (1 - 2 * PAD)) * vbH };
  };
  const edges = useMemo(() => {
    if (!adjacency) return [];
    const seen = new Set(), out = [];
    for (const a of rooms) for (const b of adjacency[a] || []) {
      const key = [a, b].sort().join("|"); if (seen.has(key)) continue; seen.add(key);
      out.push([a, b]);
    }
    return out;
  }, [rooms, adjacency]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {!compact && (
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--volt)" }}>TACTICAL MAP</span>
          <span className="kanji faint" style={{ fontSize: 12 }}>戦域図</span>
        </div>
      )}
      <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", background: "transparent", border: "none", display: "block", flex: "1 1 auto", minHeight: 0 }} preserveAspectRatio="xMidYMid meet">
        {/* grid wash */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="rgba(120,110,150,0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        {!compact && <rect x="0" y="0" width={vbW} height={vbH} fill="url(#grid)" />}

        {/* edges */}
        {edges.map(([a, b], i) => {
          if (local && viewport && !(focusSet.has(a) && focusSet.has(b))) return null;
          const pa = placeL(pos[a]), pb = placeL(pos[b]);
          if (!pa || !pb) return null;
          return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="rgba(160,150,190,0.22)" strokeWidth="2" />;
        })}

        {/* rooms */}
        {rooms.map((r) => {
          if (local && viewport && !focusSet.has(r)) return null;
          const p = placeL(pos[r]); if (!p) return null;
          const isMe = r === myRoom, isTask = myTaskRooms.has(r), isTurret = turret.has(r), isO2 = refill.has(r);
          return (
            <g key={r} transform={`translate(${p.x},${p.y})`}>
              {/* node */}
              <rect x="-9" y="-9" width="18" height="18" fill={isMe ? "var(--hot)" : "var(--ink-3)"} stroke={isMe ? "#fff" : "var(--line)"} strokeWidth="2"
                style={{ transformBox: "fill-box" }} />
              {/* turret brackets */}
              {isTurret && <g stroke="var(--hot)" strokeWidth="2" fill="none">
                <path d="M-13 -13 h5 M-13 -13 v5 M13 -13 h-5 M13 -13 v5 M-13 13 h5 M-13 13 v-5 M13 13 h-5 M13 13 v-5" />
              </g>}
              {/* o2 */}
              {isO2 && <circle cx="0" cy="0" r="5" fill="none" stroke="var(--volt)" strokeWidth="2" />}
              {isO2 && <text x="0" y="3" textAnchor="middle" fontSize="7" fill="var(--volt)" fontFamily="Rajdhani" fontWeight="700">O₂</text>}
              {/* task pip */}
              {isTask && <circle cx="9" cy="-9" r="4" fill="var(--gold)" stroke="var(--ink)" strokeWidth="1.5">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
              </circle>}
              {/* me marker */}
              {isMe && <circle cx="0" cy="0" r="14" fill="none" stroke="var(--hot)" strokeWidth="2" opacity="0.6">
                <animate attributeName="r" values="12;18;12" dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.4s" repeatCount="indefinite" />
              </circle>}
              {/* label */}
              <text x="0" y="22" textAnchor="middle" fontSize="8" fill={isMe ? "var(--paper)" : "var(--dim)"} fontFamily="Rajdhani" fontWeight="600">
                {shorten(r)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      {!compact && (
      <div className="row gap-m" style={{ marginTop: 8, flexWrap: "wrap", fontSize: 11 }}>
        <Legend swatch={<span style={{ width: 8, height: 8, background: "var(--gold)", borderRadius: "50%", display: "inline-block" }} />} label="Task" />
        <Legend swatch={<span style={{ color: "var(--hot)", fontWeight: 700 }}>⌜⌝</span>} label="Turret" />
        <Legend swatch={<span style={{ color: "var(--volt)", fontWeight: 700, fontSize: 9 }}>O₂</span>} label="Oxygen" />
        <Legend swatch={<span style={{ width: 8, height: 8, background: "var(--hot)", display: "inline-block" }} />} label="You" />
      </div>
      )}
    </div>
  );
}

function Legend({ swatch, label }) {
  return <span className="row gap-s faint" style={{ alignItems: "center" }}>{swatch}<span style={{ marginLeft: 4 }}>{label}</span></span>;
}
function shorten(name) { return name.length > 9 ? name.slice(0, 8) + "…" : name; }

// BFS-depth radial layout: spawn center, deeper rooms on outer rings.
function layout(rooms, adjacency, spawn) {
  const pos = {};
  if (!rooms.length) return pos;
  if (!adjacency) {
    // no graph: simple ring
    rooms.forEach((r, i) => { const a = (i / rooms.length) * Math.PI * 2; pos[r] = { x: 0.5 + 0.36 * Math.cos(a), y: 0.5 + 0.36 * Math.sin(a) }; });
    return pos;
  }
  const start = spawn && rooms.includes(spawn) ? spawn : rooms[0];
  const depth = { [start]: 0 }; const q = [start]; const byDepth = { 0: [start] };
  while (q.length) {
    const cur = q.shift();
    for (const n of adjacency[cur] || []) if (depth[n] === undefined) { depth[n] = depth[cur] + 1; (byDepth[depth[n]] ||= []).push(n); q.push(n); }
  }
  // any disconnected leftovers => outer ring
  for (const r of rooms) if (depth[r] === undefined) { depth[r] = Math.max(...Object.values(depth)) + 1 || 1; (byDepth[depth[r]] ||= []).push(r); }
  const maxDepth = Math.max(...Object.keys(byDepth).map(Number));
  for (const [d, list] of Object.entries(byDepth)) {
    const ring = Number(d); const radius = maxDepth === 0 ? 0 : (ring / maxDepth) * 0.4;
    list.forEach((r, i) => {
      if (ring === 0) { pos[r] = { x: 0.5, y: 0.5 }; return; }
      const a = (i / list.length) * Math.PI * 2 + ring * 0.6;
      pos[r] = { x: 0.5 + radius * Math.cos(a), y: 0.5 + radius * Math.sin(a) };
    });
  }
  return pos;
}
function scale(p, size) { if (!p) return null; const pad = 28; return { x: pad + p.x * (size - pad * 2), y: pad + p.y * (size - pad * 2) }; }
