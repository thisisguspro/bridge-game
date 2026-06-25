// BRIDGE — combined deploy server.
//
// Runs EVERYTHING on one port so it can be hosted as a single service (e.g. on
// Render's free tier): the backend REST API, the Socket.IO game server, and the
// built React client (served as static files). One URL, no cross-service wiring.
//
// How it fits together:
//   - The backend Express app is imported and mounted (all /auth, /store, etc.).
//   - The game server's Socket.IO is attached to the SAME HTTP server.
//   - The built client (bridge-client/dist) is served for everything else.
//   - The game server talks to the backend over localhost on this same port, and
//     they share JWT/service secrets automatically (same process env).
//
// Required: build the client first (npm run build in ../bridge-client) and set
// BACKEND_URL to this server's own origin so the game server's internal calls
// resolve to itself. The start script and render.yaml handle this for you.

import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const PORT = process.env.PORT || 8080;
// The game server makes internal calls to the backend over HTTP. In this combined
// process they're the same server, so point those calls at our own port BEFORE
// importing the game server (its config reads BACKEND_URL at import time).
process.env.BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

import { app } from "../bridge-backend/src/server.js";
import { attachGameServer } from "../bridge-gameserver/src/net/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the built client. Vite outputs to bridge-client/dist.
const clientDist = path.join(__dirname, "..", "bridge-client", "dist");
app.use(express.static(clientDist));

// SPA fallback: any non-API, non-asset route returns index.html so the client
// router handles it. API routes are already matched above by the backend.
app.get(/^(?!\/(auth|store|player|profile|payments|internal|admintool|admin|health|maps|socket\.io)).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// One HTTP server carries the Express app AND Socket.IO.
const server = http.createServer(app);
attachGameServer(server);

server.listen(PORT, () => {
  console.log(`BRIDGE running on :${PORT}  (backend + game + client, one port)`);
  console.log(`Open the service URL in a browser to play.`);
});
