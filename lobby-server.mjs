import http from "node:http";

const PORT = Number(process.env.LOBBY_PORT || 8787);
const ROOM_STALE_MS = 20_000;

/** @type {Map<string, {id:string,host:string,mapId:string,mapName:string,players:number,updatedAt:number}>} */
const rooms = new Map();

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.updatedAt > ROOM_STALE_MS) {
      rooms.delete(id);
    }
  }
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 32_000) {
      throw new Error("Payload too large");
    }
  }
  return data;
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  cleanupStaleRooms();

  if (req.method === "GET" && url.pathname === "/rooms") {
    const list = [...rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    sendJson(res, 200, list);
    return;
  }

  const match = url.pathname.match(/^\/rooms\/([^/]+)$/);
  if (!match) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const roomId = decodeURIComponent(match[1]);

  if (req.method === "PUT") {
    try {
      const bodyRaw = await readBody(req);
      const body = JSON.parse(bodyRaw || "{}");
      const now = Date.now();
      const entry = {
        id: roomId,
        host: String(body.host || "主机").slice(0, 20),
        mapId: String(body.mapId || ""),
        mapName: String(body.mapName || "未知地图").slice(0, 30),
        players: Math.max(1, Math.min(16, Number(body.players || 1))),
        updatedAt: now,
      };
      rooms.set(roomId, entry);
      sendJson(res, 200, entry);
      return;
    } catch {
      sendJson(res, 400, { error: "Invalid payload" });
      return;
    }
  }

  if (req.method === "DELETE") {
    rooms.delete(roomId);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[lobby] running on http://0.0.0.0:${PORT}`);
});
