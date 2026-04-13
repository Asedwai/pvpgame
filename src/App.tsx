import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Peer, { type DataConnection } from "peerjs";

type Role = "menu" | "host" | "guest";

type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  punch: boolean;
  hook: boolean;
  seq: number;
};

type PlayerState = {
  id: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: 1 | -1;
  onGround: boolean;
  spawnX: number;
  spawnY: number;
  punchCd: number;
  hookCd: number;
  stunLeft: number;
  punchFx: number;
  hookFx: number;
  lastHitBy: number | null;
  lastHitLeft: number;
  score: number;
  respawnTick: number;
  punchHeld: boolean;
  hookHeld: boolean;
  hookPullLeft: number;
  hookTargetX: number;
  hookTargetY: number;
  coyoteLeft: number;
  jumpBufferLeft: number;
  jumpHeld: boolean;
  inputSeq: number;
};

type GameState = {
  mapId: string;
  customMapCode: string | null;
  matchEnded: boolean;
  winnerId: number | null;
  players: PlayerState[];
};

type NetInputMessage = {
  type: "input";
  input: InputState;
};

type NetStateMessage = {
  type: "state";
  state: GameState;
};

type NetJoinMessage = {
  type: "join";
  nickname: string;
};

type NetStartMessage = {
  type: "start";
  playerId: number;
};

type NetResetMessage = {
  type: "reset";
};

type NetRenameMessage = {
  type: "rename";
  nickname: string;
};

type NetMessage =
  | NetInputMessage
  | NetStateMessage
  | NetJoinMessage
  | NetStartMessage
  | NetResetMessage
  | NetRenameMessage;

const ARENA_HEIGHT = 560;
const PLAYER_W = 34;
const PLAYER_H = 52;
const SCORE_TO_WIN = 50;

const GRAVITY = 1680;
const MOVE_SPEED = 340;
const JUMP_SPEED = 690;
const COYOTE_TIME = 0.08;
const JUMP_BUFFER_TIME = 0.12;
const JUMP_CUT_GRAVITY_MULT = 1.45;

const PUNCH_PUSH_X = 1000;
const PUNCH_PUSH_Y = 220;
const PUNCH_RANGE = 160;
const HOOK_RANGE = 340;
const HOOK_STUN = 0.65;
const PUNCH_COOLDOWN = 1.0;
const HOOK_COOLDOWN = 1.6;
const HOOK_PULL_TIME = 0.12;

const KILL_CREDIT_TIME = 4;
const MAX_PLAYERS = 6;

const CAMERA_DEFAULT_VIEW_WIDTH = 980;
const CAMERA_MAX_SPEED = 860;
const NET_STEP = 1 / 60;
const HOST_BROADCAST_MS = 12;
const HOST_UI_SYNC_MS = 40;
const GUEST_UI_SYNC_MS = 60;
const CONTACT_GAP_X = 8;
const CONTACT_GAP_Y = 6;
const GRID_SIZE = 50;
const CLIENT_PREDICTION_ENABLED = true;
const INPUT_SEQUENCE_WINDOW = 120;

type Platform = { x: number; y: number; w: number; h: number };
type SpawnPoint = { x: number; y: number };
type SpikeDir = "up" | "down" | "left" | "right";
type Spike = { x: number; y: number; size: number; dir: SpikeDir };
type TileId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
type TileEntry = [number, number, TileId];
type MapCodePayload = { v: 1; name?: string; tiles: TileEntry[] };
type ArenaMap = {
  id: string;
  name: string;
  width: number;
  wallLeft: boolean;
  wallRight: boolean;
  spawns: SpawnPoint[];
  platforms: Platform[];
  spikes?: Spike[];
};

type RoomListEntry = {
  id: string;
  host: string;
  mapId: string;
  mapName: string;
  players: number;
  updatedAt: number;
};

const LOBBY_RELAY_ID = "parkour-lobby-relay-v1";
const ROOM_STALE_MS = 12_000;

const MAPS: ArenaMap[] = [
  {
    id: "compact",
    name: "紧凑乱斗",
    width: 1680,
    wallLeft: true,
    wallRight: true,
    spawns: [
      { x: 70, y: 470 - PLAYER_H },
      { x: 35, y: 330 - PLAYER_H },
      { x: 95, y: 330 - PLAYER_H },
      { x: 340, y: 470 - PLAYER_H },
      { x: 1170, y: 470 - PLAYER_H },
      { x: 1290, y: 360 - PLAYER_H },
      { x: 1470, y: 305 - PLAYER_H },
      { x: 1600, y: 470 - PLAYER_H },
    ],
    platforms: [
      { x: 0, y: 470, w: 140, h: 90 },
      { x: 320, y: 470, w: 220, h: 90 },
      { x: 650, y: 470, w: 350, h: 90 },
      { x: 1090, y: 470, w: 150, h: 90 },
      { x: 1590, y: 470, w: 90, h: 90 },
      { x: 0, y: 330, w: 150, h: 16 },
      { x: 400, y: 390, w: 140, h: 16 },
      { x: 760, y: 350, w: 170, h: 16 },
      { x: 1020, y: 300, w: 170, h: 16 },
      { x: 1270, y: 360, w: 180, h: 16 },
      { x: 1360, y: 470, w: 90, h: 90 },
      { x: 1450, y: 305, w: 130, h: 16 },
    ],
  },
  {
    id: "sky",
    name: "空中断层",
    width: 1680,
    wallLeft: true,
    wallRight: true,
    spawns: [
      { x: 110, y: 500 - PLAYER_H },
      { x: 170, y: 500 - PLAYER_H },
      { x: 390, y: 500 - PLAYER_H },
      { x: 450, y: 500 - PLAYER_H },
      { x: 690, y: 500 - PLAYER_H },
      { x: 750, y: 500 - PLAYER_H },
    ],
    platforms: [
      { x: 80, y: 500, w: 180, h: 18 },
      { x: 360, y: 500, w: 170, h: 18 },
      { x: 660, y: 500, w: 190, h: 18 },
      { x: 980, y: 500, w: 170, h: 18 },
      { x: 1270, y: 500, w: 180, h: 18 },
      { x: 1510, y: 500, w: 150, h: 18 },
      { x: 230, y: 390, w: 130, h: 16 },
      { x: 540, y: 390, w: 130, h: 16 },
      { x: 860, y: 390, w: 130, h: 16 },
      { x: 1170, y: 390, w: 130, h: 16 },
      { x: 1450, y: 390, w: 120, h: 16 },
      { x: 150, y: 280, w: 120, h: 16 },
      { x: 460, y: 280, w: 120, h: 16 },
      { x: 760, y: 280, w: 120, h: 16 },
      { x: 1060, y: 280, w: 120, h: 16 },
      { x: 1350, y: 280, w: 120, h: 16 },
      { x: 300, y: 170, w: 110, h: 16 },
      { x: 610, y: 170, w: 110, h: 16 },
      { x: 920, y: 170, w: 110, h: 16 },
      { x: 1220, y: 170, w: 110, h: 16 },
    ],
  },
  {
    id: "wide_void",
    name: "深渊长桥",
    width: 3200,
    wallLeft: false,
    wallRight: false,
    spawns: [
      { x: 420, y: 500 - PLAYER_H },
      { x: 520, y: 500 - PLAYER_H },
      { x: 1320, y: 500 - PLAYER_H },
      { x: 1420, y: 500 - PLAYER_H },
      { x: 2320, y: 500 - PLAYER_H },
      { x: 2420, y: 500 - PLAYER_H },
    ],
    platforms: [
      { x: 260, y: 500, w: 460, h: 20 },
      { x: 860, y: 500, w: 520, h: 20 },
      { x: 1520, y: 500, w: 480, h: 20 },
      { x: 2140, y: 500, w: 480, h: 20 },
      { x: 560, y: 400, w: 160, h: 16 },
      { x: 980, y: 380, w: 180, h: 16 },
      { x: 1360, y: 340, w: 180, h: 16 },
      { x: 1760, y: 300, w: 180, h: 16 },
      { x: 2160, y: 360, w: 180, h: 16 },
      { x: 2500, y: 420, w: 140, h: 16 },
      { x: 740, y: 250, w: 150, h: 16 },
      { x: 1160, y: 220, w: 150, h: 16 },
      { x: 1580, y: 210, w: 150, h: 16 },
      { x: 2000, y: 240, w: 150, h: 16 },
    ],
  },
];

const EDITOR_BLOCKS: { id: TileId; name: string; category: string }[] = [
  { id: 1, name: "重生锚", category: "复活" },
  { id: 2, name: "砖头", category: "障碍" },
  { id: 3, name: "上半砖", category: "障碍" },
  { id: 4, name: "下半砖", category: "障碍" },
  { id: 5, name: "左半砖", category: "障碍" },
  { id: 6, name: "右半砖", category: "障碍" },
  { id: 7, name: "上尖刺", category: "陷阱" },
  { id: 8, name: "下尖刺", category: "陷阱" },
  { id: 9, name: "左尖刺", category: "陷阱" },
  { id: 10, name: "右尖刺", category: "陷阱" },
];

const inputMap: Record<string, keyof InputState> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "jump",
  KeyJ: "punch",
  KeyK: "hook",
};

function initialInput(): InputState {
  return { left: false, right: false, jump: false, punch: false, hook: false, seq: 0 };
}

function sameInput(a: InputState, b: InputState): boolean {
  return a.left === b.left && a.right === b.right && a.jump === b.jump && a.punch === b.punch && a.hook === b.hook;
}

function sameInputWithSeq(a: InputState, b: InputState): boolean {
  return sameInput(a, b) && a.seq === b.seq;
}

function getMapById(mapId: string): ArenaMap {
  return MAPS.find((m) => m.id === mapId) ?? MAPS[0];
}

function encodeMapCode(payload: MapCodePayload): string {
  const json = JSON.stringify(payload);
  const utf8 = new TextEncoder().encode(json);
  let raw = "";
  for (const byte of utf8) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeMapCode(code: string): MapCodePayload | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MapCodePayload>;
    if (parsed.v !== 1 || !Array.isArray(parsed.tiles)) return null;
    const safeTiles: TileEntry[] = [];
    for (const row of parsed.tiles) {
      if (!Array.isArray(row) || row.length !== 3) continue;
      const [x, y, id] = row;
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(id)) continue;
      if (id < 1 || id > 10) continue;
      safeTiles.push([x, y, id as TileId]);
    }
    return { v: 1, name: typeof parsed.name === "string" ? parsed.name.slice(0, 24) : undefined, tiles: safeTiles };
  } catch {
    return null;
  }
}

function buildArenaMapFromCode(code: string): ArenaMap | null {
  const payload = decodeMapCode(code);
  if (!payload) return null;
  const tiles = payload.tiles;
  const unique = new Map<string, TileId>();
  for (const [gx, gy, id] of tiles) {
    unique.set(`${gx},${gy}`, id);
  }
  const cells = [...unique.entries()].map(([k, id]) => {
    const [sx, sy] = k.split(",");
    return { gx: Number(sx), gy: Number(sy), id };
  });

  const minGX = cells.length > 0 ? Math.min(...cells.map((c) => c.gx)) : 0;
  const maxGX = cells.length > 0 ? Math.max(...cells.map((c) => c.gx)) : 24;
  const shiftGX = minGX < 0 ? -minGX + 2 : 2;

  const spawns: SpawnPoint[] = [];
  const platforms: Platform[] = [];
  const spikes: Spike[] = [];

  for (const cell of cells) {
    const x = (cell.gx + shiftGX) * GRID_SIZE;
    const y = cell.gy * GRID_SIZE;
    if (cell.id === 1) {
      spawns.push({ x: x + (GRID_SIZE - PLAYER_W) / 2, y: y + GRID_SIZE - PLAYER_H });
      continue;
    }
    if (cell.id === 2) {
      platforms.push({ x, y, w: GRID_SIZE, h: GRID_SIZE });
      continue;
    }
    if (cell.id === 3) {
      platforms.push({ x, y, w: GRID_SIZE, h: GRID_SIZE / 2 });
      continue;
    }
    if (cell.id === 4) {
      platforms.push({ x, y: y + GRID_SIZE / 2, w: GRID_SIZE, h: GRID_SIZE / 2 });
      continue;
    }
    if (cell.id === 5) {
      platforms.push({ x, y, w: GRID_SIZE / 2, h: GRID_SIZE });
      continue;
    }
    if (cell.id === 6) {
      platforms.push({ x: x + GRID_SIZE / 2, y, w: GRID_SIZE / 2, h: GRID_SIZE });
      continue;
    }
    if (cell.id >= 7 && cell.id <= 10) {
      const dir: SpikeDir = cell.id === 7 ? "up" : cell.id === 8 ? "down" : cell.id === 9 ? "left" : "right";
      spikes.push({ x, y, size: GRID_SIZE, dir });
    }
  }

  if (spawns.length === 0) {
    spawns.push({ x: 220, y: 420 - PLAYER_H }, { x: 300, y: 420 - PLAYER_H });
  }

  const contentRight = (maxGX + shiftGX + 1) * GRID_SIZE;
  const width = Math.max(1600, contentRight + 400);
  return {
    id: "custom",
    name: payload.name?.trim() ? `自定义:${payload.name.trim()}` : "自定义地图",
    width,
    wallLeft: true,
    wallRight: true,
    spawns,
    platforms,
    spikes,
  };
}

function mapFromState(state: GameState): ArenaMap {
  if (!state.customMapCode) return getMapById(state.mapId);
  return buildArenaMapFromCode(state.customMapCode) ?? getMapById(state.mapId);
}

type LobbyMessage =
  | { type: "lobby-sync"; rooms: RoomListEntry[] }
  | { type: "lobby-upsert"; entry: RoomListEntry }
  | { type: "lobby-remove"; roomId: string }
  | { type: "lobby-refresh" };

function sanitizeRoomList(input: RoomListEntry[]): RoomListEntry[] {
  const now = Date.now();
  const newestById = new Map<string, RoomListEntry>();
  for (const room of input) {
    const prev = newestById.get(room.id);
    if (!prev || room.updatedAt > prev.updatedAt) {
      newestById.set(room.id, room);
    }
  }
  return [...newestById.values()]
    .filter((r) => now - r.updatedAt < ROOM_STALE_MS)
    // Keep ordering stable so room cards do not jump around on every heartbeat.
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 64);
}

function isGroundedSpawn(spawn: SpawnPoint, map: ArenaMap): boolean {
  const feetY = spawn.y + PLAYER_H;
  return map.platforms.some((p) => {
    const onTop = Math.abs(feetY - p.y) <= 3;
    const hasFootSupport = spawn.x + PLAYER_W > p.x + 4 && spawn.x < p.x + p.w - 4;
    return onTop && hasFootSupport;
  });
}

function getSafeSpawns(map: ArenaMap): SpawnPoint[] {
  const safe = map.spawns.filter((spawn) => isGroundedSpawn(spawn, map));
  return safe.length > 0 ? safe : map.spawns;
}

function getSpawnFromMap(index: number, map: ArenaMap, randomize = false) {
  const safeSpawns = getSafeSpawns(map);
  if (randomize) {
    return safeSpawns[Math.floor(Math.random() * safeSpawns.length)];
  }
  return safeSpawns[index % safeSpawns.length];
}

function makePlayer(id: number, name: string, mapId: string, mapOverride?: ArenaMap): PlayerState {
  const map = mapOverride ?? getMapById(mapId);
  const spawn = getSpawnFromMap(id - 1, map, true);
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    face: 1,
    onGround: false,
    spawnX: spawn.x,
    spawnY: spawn.y,
    punchCd: 0,
    hookCd: 0,
    stunLeft: 0,
    punchFx: 0,
    hookFx: 0,
    lastHitBy: null,
    lastHitLeft: 0,
    score: 0,
    respawnTick: 0,
    punchHeld: false,
    hookHeld: false,
    hookPullLeft: 0,
    hookTargetX: spawn.x,
    hookTargetY: spawn.y,
    coyoteLeft: 0,
    jumpBufferLeft: 0,
    jumpHeld: false,
    inputSeq: 0,
  };
}

function makeHostGame(hostName: string, mapId: string, customMapCode: string | null = null): GameState {
  const arena = customMapCode ? buildArenaMapFromCode(customMapCode) ?? getMapById(mapId) : getMapById(mapId);
  return {
    mapId,
    customMapCode,
    matchEnded: false,
    winnerId: null,
    players: [makePlayer(1, hostName, mapId, arena)],
  };
}

function respawnPlayer(player: PlayerState, map: ArenaMap) {
  const spawn = getSpawnFromMap(player.id - 1, map, true);
  player.spawnX = spawn.x;
  player.spawnY = spawn.y;
  player.x = spawn.x;
  // Spawn in the air, then fall onto the spawn platform.
  player.y = spawn.y - 260;
  player.vx = 0;
  player.vy = 0;
  player.stunLeft = 0;
  player.lastHitBy = null;
  player.lastHitLeft = 0;
  player.respawnTick += 1;
  player.punchHeld = false;
  player.hookHeld = false;
  player.hookPullLeft = 0;
  player.hookTargetX = spawn.x;
  player.hookTargetY = spawn.y;
  player.coyoteLeft = 0;
  player.jumpBufferLeft = 0;
  player.jumpHeld = false;
}

function overlap(a: PlayerState, b: PlayerState): boolean {
  return a.x < b.x + PLAYER_W && a.x + PLAYER_W > b.x && a.y < b.y + PLAYER_H && a.y + PLAYER_H > b.y;
}

function isNearBodyContact(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const leftA = a.x;
  const rightA = a.x + PLAYER_W;
  const topA = a.y;
  const bottomA = a.y + PLAYER_H;
  const leftB = b.x;
  const rightB = b.x + PLAYER_W;
  const topB = b.y;
  const bottomB = b.y + PLAYER_H;
  const gapX = Math.max(0, Math.max(leftA, leftB) - Math.min(rightA, rightB));
  const gapY = Math.max(0, Math.max(topA, topB) - Math.min(bottomA, bottomB));
  const overlapY = Math.min(bottomA, bottomB) - Math.max(topA, topB);
  return gapX <= CONTACT_GAP_X && gapY <= CONTACT_GAP_Y && overlapY > PLAYER_H * 0.3;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01 || 1);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function playerHitsSpike(player: PlayerState, spike: Spike): boolean {
  const boxLeft = player.x;
  const boxTop = player.y;
  const boxRight = player.x + PLAYER_W;
  const boxBottom = player.y + PLAYER_H;
  if (boxRight <= spike.x || boxLeft >= spike.x + spike.size || boxBottom <= spike.y || boxTop >= spike.y + spike.size) {
    return false;
  }

  const sx = spike.x;
  const sy = spike.y;
  const s = spike.size;
  const tri =
    spike.dir === "up"
      ? [sx, sy + s, sx + s, sy + s, sx + s / 2, sy]
      : spike.dir === "down"
        ? [sx, sy, sx + s, sy, sx + s / 2, sy + s]
        : spike.dir === "left"
          ? [sx, sy, sx, sy + s, sx + s, sy + s / 2]
          : [sx + s, sy, sx + s, sy + s, sx, sy + s / 2];

  const samples: [number, number][] = [
    [boxLeft + 2, boxTop + 2],
    [boxRight - 2, boxTop + 2],
    [boxLeft + 2, boxBottom - 2],
    [boxRight - 2, boxBottom - 2],
    [(boxLeft + boxRight) / 2, (boxTop + boxBottom) / 2],
  ];

  for (const [px, py] of samples) {
    if (pointInTriangle(px, py, tri[0], tri[1], tri[2], tri[3], tri[4], tri[5])) {
      return true;
    }
  }
  return false;
}

function updatePlayerPhysics(player: PlayerState, input: InputState, dt: number, map: ArenaMap): number | null {
  const disabled = player.stunLeft > 0;
  const left = !disabled && input.left;
  const right = !disabled && input.right;
  const jump = !disabled && input.jump;
  const jumpPressed = jump && !player.jumpHeld;
  player.jumpHeld = jump;

  player.punchCd = Math.max(0, player.punchCd - dt);
  player.hookCd = Math.max(0, player.hookCd - dt);
  player.stunLeft = Math.max(0, player.stunLeft - dt);
  player.punchFx = Math.max(0, player.punchFx - dt);
  player.hookFx = Math.max(0, player.hookFx - dt);
  player.lastHitLeft = Math.max(0, player.lastHitLeft - dt);
  player.hookPullLeft = Math.max(0, player.hookPullLeft - dt);
  player.coyoteLeft = Math.max(0, player.coyoteLeft - dt);
  player.jumpBufferLeft = Math.max(0, player.jumpBufferLeft - dt);
  if (player.lastHitLeft <= 0) {
    player.lastHitBy = null;
  }

  if (jumpPressed) {
    player.jumpBufferLeft = JUMP_BUFFER_TIME;
  }
  // Allow hold-to-jump: while W is held, keep a small jump buffer so landing can chain into the next jump.
  if (jump) {
    player.jumpBufferLeft = Math.max(player.jumpBufferLeft, JUMP_BUFFER_TIME);
  }

  if (player.hookPullLeft > 0) {
    // Pull the hooked player toward the target over a few frames to avoid camera snap-jumps.
    const pullT = Math.min(1, dt * 24);
    player.x += (player.hookTargetX - player.x) * pullT;
    player.y += (player.hookTargetY - player.y) * pullT;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
  }

  if (left === right) {
    player.vx *= player.onGround ? 0.75 : 0.94;
  } else {
    player.vx = (left ? -1 : 1) * MOVE_SPEED;
    player.face = left ? -1 : 1;
  }

  if (player.onGround) {
    player.coyoteLeft = COYOTE_TIME;
  }

  if (player.jumpBufferLeft > 0 && player.onGround) {
    player.vy = -JUMP_SPEED;
    player.onGround = false;
    player.coyoteLeft = 0;
    player.jumpBufferLeft = 0;
  }

  if (player.hookPullLeft <= 0) {
    player.vy += GRAVITY * dt;
    if (!jump && player.vy < 0) {
      player.vy += GRAVITY * (JUMP_CUT_GRAVITY_MULT - 1) * dt;
    }
  }

  const prevX = player.x;
  const prevY = player.y;

  if (player.hookPullLeft <= 0) {
    player.x += player.vx * dt;
  }

  for (const p of map.platforms) {
    const overlaps = player.x < p.x + p.w && player.x + PLAYER_W > p.x && player.y < p.y + p.h && player.y + PLAYER_H > p.y;
    if (!overlaps) continue;
    const prevRight = prevX + PLAYER_W;
    const prevLeft = prevX;
    const currRight = player.x + PLAYER_W;
    const currLeft = player.x;
    const overlapVert = player.y + PLAYER_H > p.y + 1 && player.y < p.y + p.h - 1;
    if (!overlapVert) continue;

    if (player.vx > 0 && prevRight <= p.x && currRight >= p.x) {
      player.x = p.x - PLAYER_W;
      player.vx = 0;
    } else if (player.vx < 0 && prevLeft >= p.x + p.w && currLeft <= p.x + p.w) {
      player.x = p.x + p.w;
      player.vx = 0;
    }
  }

  const prevYAfterX = player.y;
  if (player.hookPullLeft <= 0) {
    player.y += player.vy * dt;
    player.onGround = false;
  }

  for (const p of map.platforms) {
    const overlaps = player.x < p.x + p.w && player.x + PLAYER_W > p.x && player.y < p.y + p.h && player.y + PLAYER_H > p.y;
    if (!overlaps) continue;
    const prevBottom = prevYAfterX + PLAYER_H;
    const prevTop = prevYAfterX;
    const currBottom = player.y + PLAYER_H;
    const currTop = player.y;
    const overlapHoriz = player.x + PLAYER_W > p.x + 1 && player.x < p.x + p.w - 1;
    if (!overlapHoriz) continue;

    if (player.vy > 0 && prevBottom <= p.y && currBottom >= p.y) {
      player.y = p.y - PLAYER_H;
      player.vy = 0;
      player.onGround = true;
    } else if (player.vy < 0 && prevTop >= p.y + p.h && currTop <= p.y + p.h) {
      player.y = p.y + p.h;
      player.vy = 0;
    }
  }

  // Fallback depenetration for rare edge-cases after knockback/hook snaps.
  for (const p of map.platforms) {
    const overlaps = player.x < p.x + p.w && player.x + PLAYER_W > p.x && player.y < p.y + p.h && player.y + PLAYER_H > p.y;
    if (!overlaps) continue;
    const ox = Math.min(player.x + PLAYER_W, p.x + p.w) - Math.max(player.x, p.x);
    const oy = Math.min(player.y + PLAYER_H, p.y + p.h) - Math.max(player.y, p.y);
    if (ox <= 0 || oy <= 0) continue;
    if (ox < oy) {
      if (prevX + PLAYER_W / 2 <= p.x + p.w / 2) {
        player.x -= ox + 0.01;
      } else {
        player.x += ox + 0.01;
      }
      player.vx = 0;
    } else {
      if (prevY + PLAYER_H / 2 <= p.y + p.h / 2) {
        player.y -= oy + 0.01;
        player.onGround = true;
      } else {
        player.y += oy + 0.01;
      }
      player.vy = 0;
    }
  }

  if (map.wallLeft) {
    player.x = Math.max(0, player.x);
  }
  if (map.wallRight) {
    player.x = Math.min(player.x, map.width - PLAYER_W);
  }

  const outLeftVoid = !map.wallLeft && player.x < -220;
  const outRightVoid = !map.wallRight && player.x > map.width + 220;
  const touchSpike = (map.spikes ?? []).some((sp) => playerHitsSpike(player, sp));
  if (player.y > ARENA_HEIGHT + 320 || outLeftVoid || outRightVoid || touchSpike) {
    const killerId = player.lastHitLeft > 0 ? player.lastHitBy : null;
    respawnPlayer(player, map);
    return killerId;
  }

  return null;
}

function pickTarget(actor: PlayerState, players: PlayerState[], range: number, verticalRange: number): PlayerState | null {
  let chosen: PlayerState | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const candidate of players) {
    if (candidate.id === actor.id) continue;
    const dx = candidate.x + PLAYER_W / 2 - (actor.x + PLAYER_W / 2);
    const dy = Math.abs(candidate.y - actor.y);
    if (Math.abs(dx) > range || dy > verticalRange) continue;
    if (Math.sign(dx) !== actor.face) continue;

    const dist = Math.abs(dx);
    if (dist < bestDist) {
      bestDist = dist;
      chosen = candidate;
    }
  }

  return chosen;
}

function processCombat(actor: PlayerState, players: PlayerState[], input: InputState) {
  const wantsPunch = input.punch && !actor.punchHeld;
  const wantsHook = input.hook && !actor.hookHeld;
  actor.punchHeld = input.punch;
  actor.hookHeld = input.hook;

  if (actor.stunLeft > 0) return;

  if (wantsPunch && actor.punchCd <= 0) {
    actor.punchCd = PUNCH_COOLDOWN;
    actor.punchFx = 0.15;
    const target = pickTarget(actor, players, PUNCH_RANGE, 56);
    if (target) {
      target.vx = actor.face * PUNCH_PUSH_X;
      target.vy = -PUNCH_PUSH_Y;
      target.lastHitBy = actor.id;
      target.lastHitLeft = KILL_CREDIT_TIME;
    }
  }

  if (wantsHook && actor.hookCd <= 0) {
    actor.hookCd = HOOK_COOLDOWN;
    actor.hookFx = 0.2;
    const target = pickTarget(actor, players, HOOK_RANGE, 76);
    if (target) {
      target.hookTargetX = actor.x + actor.face * (PLAYER_W + 10);
      target.hookTargetY = actor.y;
      target.hookPullLeft = HOOK_PULL_TIME;
      target.vx = 0;
      target.vy = 0;
      target.stunLeft = HOOK_STUN;
      target.lastHitBy = actor.id;
      target.lastHitLeft = KILL_CREDIT_TIME;
    }
  }
}

function resolvePlayerCollisions(
  players: PlayerState[],
  map: ArenaMap,
  prevPosById: Map<number, { x: number; y: number }>,
) {
  // Run a few passes so fast pushes do not leave unresolved overlap.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        const prevA = prevPosById.get(a.id) ?? { x: a.x, y: a.y };
        const prevB = prevPosById.get(b.id) ?? { x: b.x, y: b.y };

        if (!overlap(a, b)) {
          // Prevent same-frame horizontal cross-through when two players body-push each other.
          const prevDelta = prevA.x + PLAYER_W / 2 - (prevB.x + PLAYER_W / 2);
          const currDelta = a.x + PLAYER_W / 2 - (b.x + PLAYER_W / 2);
          const verticalOverlap = Math.min(a.y + PLAYER_H, b.y + PLAYER_H) - Math.max(a.y, b.y);
          if (verticalOverlap > 10 && prevDelta !== 0 && Math.sign(prevDelta) !== Math.sign(currDelta)) {
            const keepAOnLeft = prevDelta < 0;
            const centerMid = (a.x + PLAYER_W / 2 + (b.x + PLAYER_W / 2)) / 2;
            if (keepAOnLeft) {
              a.x = centerMid - PLAYER_W - 0.02;
              b.x = centerMid + 0.02;
              if (a.vx > 0) a.vx = 0;
              if (b.vx < 0) b.vx = 0;
            } else {
              b.x = centerMid - PLAYER_W - 0.02;
              a.x = centerMid + 0.02;
              if (a.vx < 0) a.vx = 0;
              if (b.vx > 0) b.vx = 0;
            }
            changed = true;
          }
          continue;
        }

        const overlapX = Math.min(a.x + PLAYER_W, b.x + PLAYER_W) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + PLAYER_H, b.y + PLAYER_H) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const slop = 0.35;
        const fixX = Math.max(0.01, overlapX - slop);
        const fixY = Math.max(0.01, overlapY - 0.2);

        const aAboveB = a.y + PLAYER_H / 2 <= b.y + PLAYER_H / 2;
        const top = aAboveB ? a : b;
        const bottom = aAboveB ? b : a;
        const prevTop = aAboveB ? prevA : prevB;
        const prevBottom = aAboveB ? prevB : prevA;
        const headPenetration = top.y + PLAYER_H - bottom.y;
        const topWasAbove = prevTop.y + PLAYER_H <= prevBottom.y + 4;
        const bottomWasBelow = prevBottom.y >= prevTop.y + PLAYER_H - 4;

        // Stable stomp: when someone comes from above, keep it vertical-only.
        if (topWasAbove && top.vy >= 0 && headPenetration <= 16) {
          top.y = bottom.y - PLAYER_H - 0.01;
          top.vy = 0;
          top.onGround = true;
          changed = true;
          continue;
        }

        // Head bump from below: stop upward motion, never convert it into horizontal shove.
        const bottomStillBelowCenter = bottom.y + PLAYER_H / 2 > top.y + PLAYER_H / 2 + 1;
        if (bottomWasBelow && bottom.vy < 0 && bottomStillBelowCenter) {
          bottom.y = top.y + PLAYER_H + 0.01;
          bottom.vy = 0;
          changed = true;
          continue;
        }

        const prevCenterA = prevA.x + PLAYER_W / 2;
        const prevCenterB = prevB.x + PLAYER_W / 2;
        const nearVerticalStack =
          Math.abs(prevCenterA - prevCenterB) < PLAYER_W * 0.45 &&
          (topWasAbove || bottomWasBelow || overlapY < overlapX * 0.72);
        if (nearVerticalStack) {
          // In tight vertical stacks, do not force the upper player upward (causes squeeze-launch bugs).
          if (top.vy > 0) {
            top.y -= fixY + 0.01;
            top.vy = 0;
            top.onGround = true;
            changed = true;
            continue;
          }
          if (bottom.vy < 0) {
            bottom.y += fixY + 0.01;
            bottom.vy = 0;
            changed = true;
            continue;
          }
          // If both are almost vertically stacked and neither is actively moving vertically,
          // keep the relation vertical-only so the lower player cannot side-push the upper one.
          const restingStack = Math.abs(top.vy) < 20 && Math.abs(bottom.vy) < 20;
          if (restingStack && top.y + PLAYER_H > bottom.y) {
            top.y = bottom.y - PLAYER_H - 0.01;
            if (top.vy > 0) top.vy = 0;
            top.onGround = true;
            changed = true;
            continue;
          }
        }

        // Default to horizontal separation to avoid jump+push teleport artifacts.
        const sep = fixX / 2 + 0.01;
        const aLeftOfB =
          Math.abs(prevCenterA - prevCenterB) > 0.1
            ? prevCenterA <= prevCenterB
            : a.x + PLAYER_W / 2 <= b.x + PLAYER_W / 2;
        if (aLeftOfB) {
          a.x -= sep;
          b.x += sep;
          if (a.vx > 0) a.vx = 0;
          if (b.vx < 0) b.vx = 0;
        } else {
          a.x += sep;
          b.x -= sep;
          if (a.vx < 0) a.vx = 0;
          if (b.vx > 0) b.vx = 0;
        }

        changed = true;
      }
    }

    for (const p of players) {
      if (map.wallLeft) p.x = Math.max(0, p.x);
      if (map.wallRight) p.x = Math.min(map.width - PLAYER_W, p.x);
    }
    if (!changed) break;
  }
}

function simulate(state: GameState, inputs: Record<number, InputState>, dt: number): GameState {
  if (state.matchEnded) {
    return state;
  }

  const map = mapFromState(state);
  const next: GameState = {
    mapId: state.mapId,
    customMapCode: state.customMapCode,
    matchEnded: state.matchEnded,
    winnerId: state.winnerId,
    players: state.players.map((p) => ({ ...p })),
  };
  const prevPosById = new Map(next.players.map((p) => [p.id, { x: p.x, y: p.y }]));

  const killsByPlayer: Record<number, number> = {};

  for (const pl of next.players) {
    const killerId = updatePlayerPhysics(pl, inputs[pl.id] ?? initialInput(), dt, map);
    if (killerId && killerId !== pl.id) {
      killsByPlayer[killerId] = (killsByPlayer[killerId] ?? 0) + 1;
    }
  }

  for (const pl of next.players) {
    processCombat(pl, next.players, inputs[pl.id] ?? initialInput());
  }

  resolvePlayerCollisions(next.players, map, prevPosById);

  if (Object.keys(killsByPlayer).length > 0) {
    next.players = next.players.map((pl) => {
      const gain = killsByPlayer[pl.id] ?? 0;
      return gain > 0 ? { ...pl, score: pl.score + gain } : pl;
    });

    const winner = next.players.find((p) => p.score >= SCORE_TO_WIN);
    if (winner) {
      next.matchEnded = true;
      next.winnerId = winner.id;
    }
  }

  return next;
}

function clampView(v: number, worldWidth: number, viewWidth: number): number {
  const maxX = Math.max(0, worldWidth - viewWidth);
  return Math.max(0, Math.min(v, maxX));
}

function clampPlayerXToMap(x: number, map: ArenaMap): number {
  let nextX = x;
  if (map.wallLeft) nextX = Math.max(0, nextX);
  if (map.wallRight) nextX = Math.min(map.width - PLAYER_W, nextX);
  return nextX;
}

function stepCamera(current: number, target: number, dt: number): number {
  const maxDelta = CAMERA_MAX_SPEED * dt;
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function stepCameraWithSpeed(current: number, target: number, dt: number, speed: number): number {
  const maxDelta = speed * dt;
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function playerColor(id: number): string {
  const hue = (id * 67) % 360;
  return `hsl(${hue} 85% 62%)`;
}

type VisualPlayer = {
  id: number;
  x: number;
  y: number;
};

type RenderFrame = {
  visualPlayers: VisualPlayer[];
  viewX: number;
};

function toVisualPlayers(players: PlayerState[]): VisualPlayer[] {
  return players.map((p) => ({ id: p.id, x: p.x, y: p.y }));
}

export default function App() {
  const [role, setRole] = useState<Role>("menu");
  const [status, setStatus] = useState("输入昵称后创建或加入房间");
  const [nickname, setNickname] = useState("玩家");
  const [roomId, setRoomId] = useState("");
  const [roomList, setRoomList] = useState<RoomListEntry[]>([]);
  const [selectedMapId, setSelectedMapId] = useState(MAPS[0].id);
  const [createMapCode, setCreateMapCode] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMapName, setEditorMapName] = useState("我的地图");
  const [editorCodeInput, setEditorCodeInput] = useState("");
  const [editorSelectedBlock, setEditorSelectedBlock] = useState<TileId | null>(2);
  const [editorTiles, setEditorTiles] = useState<Record<string, TileId>>({
    "2,9": 2,
    "3,9": 2,
    "4,9": 2,
    "5,9": 2,
    "8,8": 2,
    "9,8": 2,
    "12,7": 2,
    "1,8": 1,
    "6,8": 1,
    "11,6": 1,
  });
  const [editorPan, setEditorPan] = useState({ x: -200, y: -80 });
  const [myPlayerId, setMyPlayerId] = useState<number>(1);
  const [game, setGame] = useState<GameState>(() => makeHostGame("玩家", MAPS[0].id));
  const [renderFrame, setRenderFrame] = useState<RenderFrame>(() => ({
    visualPlayers: toVisualPlayers(makeHostGame("玩家", MAPS[0].id).players),
    viewX: 0,
  }));
  const [cameraWidth, setCameraWidth] = useState(CAMERA_DEFAULT_VIEW_WIDTH);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const hostConnsRef = useRef<Map<number, DataConnection>>(new Map());
  const connToPlayerRef = useRef<Map<string, number>>(new Map());
  const nextPlayerIdRef = useRef(2);

  const localInputRef = useRef<InputState>(initialInput());
  const hostInputsRef = useRef<Record<number, InputState>>({ 1: initialInput() });
  const guestPredictedInputRef = useRef<InputState>(initialInput());
  const guestPredictedStateRef = useRef<Map<number, { x: number; y: number; vx: number; vy: number; onGround: boolean; coyoteLeft: number; jumpBufferLeft: number }>>(new Map());
  const gameRef = useRef<GameState>(game);
  const lastSentNicknameRef = useRef("");
  const lastSentInputRef = useRef<InputState>(initialInput());
  const lastInputSentAtRef = useRef(0);
  const lastHostUiSyncAtRef = useRef(0);
  const lastGuestUiSyncAtRef = useRef(0);
  const lastRespawnTickRef = useRef(0);
  const lastServerSampleRef = useRef<Map<number, { x: number; y: number; vx: number; vy: number; onGround: boolean }>>(new Map());
  const lastGroundYRef = useRef<Map<number, number>>(new Map());
  const lobbyPeerRef = useRef<Peer | null>(null);
  const lobbyConnRef = useRef<DataConnection | null>(null);
  const lobbyClientsRef = useRef<Map<string, DataConnection>>(new Map());
  const lobbyRoomsRef = useRef<Map<string, RoomListEntry>>(new Map());
  const lobbyIsRelayRef = useRef(false);
  const lobbyReconnectTimerRef = useRef<number | null>(null);
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const editorViewportRef = useRef<HTMLDivElement | null>(null);

  function applyLobbyRooms(silent = true) {
    const cleaned = sanitizeRoomList([...lobbyRoomsRef.current.values()]);
    lobbyRoomsRef.current = new Map(cleaned.map((room) => [room.id, room]));
    setRoomList(cleaned);
    if (!silent) {
      setStatus(cleaned.length > 0 ? `房间列表已刷新，共 ${cleaned.length} 个` : "房间列表已刷新，暂无可用房间");
    }
  }

  function broadcastLobbySync() {
    if (!lobbyIsRelayRef.current) return;
    const rooms = sanitizeRoomList([...lobbyRoomsRef.current.values()]);
    const msg: LobbyMessage = { type: "lobby-sync", rooms };
    for (const conn of lobbyClientsRef.current.values()) {
      if (conn.open) conn.send(msg);
    }
    applyLobbyRooms(true);
  }

  function upsertLobbyEntry(entry: RoomListEntry) {
    lobbyRoomsRef.current.set(entry.id, entry);
    if (lobbyIsRelayRef.current) {
      broadcastLobbySync();
      return;
    }
    const msg: LobbyMessage = { type: "lobby-upsert", entry };
    if (lobbyConnRef.current?.open) {
      lobbyConnRef.current.send(msg);
    }
    applyLobbyRooms(true);
  }

  function removeLobbyEntry(roomKey: string) {
    lobbyRoomsRef.current.delete(roomKey);
    if (lobbyIsRelayRef.current) {
      broadcastLobbySync();
      return;
    }
    const msg: LobbyMessage = { type: "lobby-remove", roomId: roomKey };
    if (lobbyConnRef.current?.open) {
      lobbyConnRef.current.send(msg);
    }
    applyLobbyRooms(true);
  }

  async function refreshRooms(silent = false) {
    const request: LobbyMessage = { type: "lobby-refresh" };
    if (lobbyIsRelayRef.current) {
      broadcastLobbySync();
      if (!silent) {
        applyLobbyRooms(false);
      }
      return;
    }
    if (lobbyConnRef.current?.open) {
      lobbyConnRef.current.send(request);
      if (!silent) {
        setStatus("正在刷新房间列表...");
      }
      return;
    }
    applyLobbyRooms(silent);
    if (!silent) {
      setStatus("大厅连接中，请稍后再刷新");
    }
  }

  function publishRoomSnapshot(targetRoomId: string) {
    const host = gameRef.current.players.find((p) => p.id === 1);
    const map = mapFromState(gameRef.current);
    upsertLobbyEntry({
      id: targetRoomId,
      host: host?.name ?? "主机",
      mapId: gameRef.current.customMapCode ? "custom" : map.id,
      mapName: map.name,
      players: gameRef.current.players.length,
      updatedAt: Date.now(),
    });
  }

  function applyIncomingGuestState(nextState: GameState) {
    const prev = gameRef.current;
    gameRef.current = nextState;
    const now = performance.now();
    const majorChanged =
      prev.mapId !== nextState.mapId ||
      prev.players.length !== nextState.players.length ||
      prev.matchEnded !== nextState.matchEnded ||
      prev.winnerId !== nextState.winnerId;
    if (majorChanged || now - lastGuestUiSyncAtRef.current > GUEST_UI_SYNC_MS) {
      lastGuestUiSyncAtRef.current = now;
      setGame(nextState);
    }
  }

  useEffect(() => {
    void refreshRooms(true);
  }, []);

  useEffect(() => {
    let stopped = false;

    const clearLobbyHandles = () => {
      lobbyConnRef.current?.close();
      lobbyConnRef.current = null;
      for (const conn of lobbyClientsRef.current.values()) {
        conn.close();
      }
      lobbyClientsRef.current.clear();
      lobbyPeerRef.current?.destroy();
      lobbyPeerRef.current = null;
      lobbyIsRelayRef.current = false;
      if (lobbyReconnectTimerRef.current) {
        window.clearTimeout(lobbyReconnectTimerRef.current);
        lobbyReconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || lobbyReconnectTimerRef.current) return;
      lobbyReconnectTimerRef.current = window.setTimeout(() => {
        lobbyReconnectTimerRef.current = null;
        initLobbyPeer();
      }, 1200);
    };

    const handleLobbyMessage = (msg: LobbyMessage, conn?: DataConnection) => {
      if (msg.type === "lobby-sync") {
        lobbyRoomsRef.current = new Map(msg.rooms.map((r) => [r.id, r]));
        applyLobbyRooms(true);
        return;
      }
      if (msg.type === "lobby-upsert") {
        lobbyRoomsRef.current.set(msg.entry.id, msg.entry);
        if (lobbyIsRelayRef.current) {
          broadcastLobbySync();
        } else {
          applyLobbyRooms(true);
        }
        return;
      }
      if (msg.type === "lobby-remove") {
        lobbyRoomsRef.current.delete(msg.roomId);
        if (lobbyIsRelayRef.current) {
          broadcastLobbySync();
        } else {
          applyLobbyRooms(true);
        }
        return;
      }
      if (msg.type === "lobby-refresh" && lobbyIsRelayRef.current && conn?.open) {
        const rooms = sanitizeRoomList([...lobbyRoomsRef.current.values()]);
        conn.send({ type: "lobby-sync", rooms } as LobbyMessage);
      }
    };

    const initClientPeer = () => {
      const peer = new Peer();
      lobbyPeerRef.current = peer;
      lobbyIsRelayRef.current = false;

      peer.on("open", () => {
        const conn = peer.connect(LOBBY_RELAY_ID);
        lobbyConnRef.current = conn;
        conn.on("open", () => {
          conn.send({ type: "lobby-refresh" } as LobbyMessage);
        });
        conn.on("data", (raw) => handleLobbyMessage(raw as LobbyMessage));
        conn.on("close", scheduleReconnect);
        conn.on("error", scheduleReconnect);
      });

      peer.on("error", scheduleReconnect);
      peer.on("disconnected", scheduleReconnect);
      peer.on("close", scheduleReconnect);
    };

    const initLobbyPeer = () => {
      if (stopped) return;
      clearLobbyHandles();
      const relayPeer = new Peer(LOBBY_RELAY_ID);
      lobbyPeerRef.current = relayPeer;

      relayPeer.on("open", () => {
        lobbyIsRelayRef.current = true;
        applyLobbyRooms(true);
      });

      relayPeer.on("connection", (conn) => {
        lobbyClientsRef.current.set(conn.peer, conn);
        conn.on("open", () => {
          const rooms = sanitizeRoomList([...lobbyRoomsRef.current.values()]);
          conn.send({ type: "lobby-sync", rooms } as LobbyMessage);
        });
        conn.on("data", (raw) => handleLobbyMessage(raw as LobbyMessage, conn));
        conn.on("close", () => {
          lobbyClientsRef.current.delete(conn.peer);
        });
      });

      relayPeer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          clearLobbyHandles();
          initClientPeer();
          return;
        }
        scheduleReconnect();
      });

      relayPeer.on("close", scheduleReconnect);
      relayPeer.on("disconnected", scheduleReconnect);
    };

    initLobbyPeer();

    return () => {
      stopped = true;
      clearLobbyHandles();
    };
  }, []);

  useEffect(() => {
    if (role !== "host" || !roomId) return;
    const tick = window.setInterval(() => {
      publishRoomSnapshot(roomId);
    }, 1500);
    return () => window.clearInterval(tick);
  }, [role, roomId, game.mapId, game.customMapCode]);

  useEffect(() => {
    const onUnload = () => {
      if (role === "host" && roomId) {
        removeLobbyEntry(roomId);
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [role, roomId]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const updateWidth = () => {
      setCameraWidth(Math.max(320, Math.round(el.clientWidth)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent, down: boolean) => {
      const key = inputMap[ev.code];
      if (!key) return;
      ev.preventDefault();
      localInputRef.current = { ...localInputRef.current, [key]: down };
    };

    const kd = (ev: KeyboardEvent) => onKey(ev, true);
    const ku = (ev: KeyboardEvent) => onKey(ev, false);
    const resetInput = () => {
      localInputRef.current = initialInput();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", resetInput);
    document.addEventListener("visibilitychange", resetInput);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", resetInput);
      document.removeEventListener("visibilitychange", resetInput);
    };
  }, []);

  useEffect(() => {
    if (role !== "host") return;

    let prev = performance.now();
    let accumulator = 0;
    let lastBroadcast = 0;

    const timer = window.setInterval(() => {
      const now = performance.now();
      const frame = Math.min(1, (now - prev) / 1000);
      prev = now;
      accumulator += frame;

      hostInputsRef.current[1] = localInputRef.current;

      let steps = 0;
      let next = gameRef.current;
      while (accumulator >= NET_STEP && steps < 120) {
        next = simulate(next, hostInputsRef.current, NET_STEP);
        accumulator -= NET_STEP;
        steps += 1;
      }

      if (steps > 0) {
        gameRef.current = next;
        if (now - lastHostUiSyncAtRef.current >= HOST_UI_SYNC_MS) {
          lastHostUiSyncAtRef.current = now;
          setGame(next);
        }
      }

      if (now - lastBroadcast > HOST_BROADCAST_MS) {
        const msg: NetStateMessage = { type: "state", state: gameRef.current };
        for (const conn of hostConnsRef.current.values()) {
          if (conn.open) conn.send(msg);
        }
        lastBroadcast = now;
      }

      if (accumulator > NET_STEP * 6) {
        accumulator = NET_STEP * 2;
      }
    }, 16);

    return () => {
      window.clearInterval(timer);
    };
  }, [role]);

  useEffect(() => {
    if (role !== "guest" || !connRef.current) return;
    let seqCounter = 0;
    const timer = window.setInterval(() => {
      if (!connRef.current?.open) return;
      const now = performance.now();
      const changed = !sameInput(localInputRef.current, lastSentInputRef.current);
      if (!changed && now - lastInputSentAtRef.current < 50) return;
      seqCounter = (seqCounter + 1) % INPUT_SEQUENCE_WINDOW;
      const inputWithSeq: InputState = { ...localInputRef.current, seq: seqCounter };
      const msg: NetInputMessage = { type: "input", input: inputWithSeq };
      connRef.current.send(msg);
      lastSentInputRef.current = { ...localInputRef.current };
      guestPredictedInputRef.current = { ...localInputRef.current };
      lastInputSentAtRef.current = now;
    }, 16);
    return () => window.clearInterval(timer);
  }, [role]);

  useEffect(() => {
    const trimmed = nickname.trim().slice(0, 14);

    if (role === "host") {
      const nextName = trimmed || "主机";
      setGame((prev) => {
        const hasHost = prev.players.some((p) => p.id === 1);
        if (!hasHost) return prev;
        const host = prev.players.find((p) => p.id === 1);
        if (!host || host.name === nextName) return prev;
        const next = {
          ...prev,
          players: prev.players.map((p) => (p.id === 1 ? { ...p, name: nextName } : p)),
        };
        gameRef.current = next;
        return next;
      });
      return;
    }

    if (role !== "guest" || !connRef.current?.open) return;
    const rename = trimmed || "玩家";
    if (lastSentNicknameRef.current === rename) return;
    lastSentNicknameRef.current = rename;
    const msg: NetRenameMessage = { type: "rename", nickname: rename };
    connRef.current.send(msg);
  }, [nickname, role]);

  useEffect(() => {
    if (role === "menu") {
      setRenderFrame((prev) => ({ ...prev, viewX: 0 }));
      lastRespawnTickRef.current = 0;
      lastServerSampleRef.current.clear();
      lastGroundYRef.current.clear();
    }
  }, [role]);

  useEffect(() => {
    if (role === "menu") return;
    const me = game.players.find((p) => p.id === myPlayerId);
    if (!me) return;
    if (me.respawnTick === lastRespawnTickRef.current) return;
    lastRespawnTickRef.current = me.respawnTick;
    const map = mapFromState(game);
    const respawnView = clampView(me.x + PLAYER_W / 2 - cameraWidth / 2, map.width, cameraWidth);
    setRenderFrame((prev) => ({ ...prev, viewX: respawnView }));
  }, [game.players, myPlayerId, role, game.mapId, game.customMapCode, cameraWidth]);

  useEffect(() => {
    if (role === "menu") {
      setRenderFrame({ visualPlayers: toVisualPlayers(game.players), viewX: 0 });
      guestPredictedStateRef.current.clear();
      return;
    }

    let raf = 0;
    let prevNow = performance.now();
    
    // Guest-side prediction loop
    let predictionAccumulator = 0;
    const PREDICTION_STEP = 1 / 60;
    
    const tick = () => {
      const targets = gameRef.current.players;
      const map = mapFromState(gameRef.current);
      const now = performance.now();
      const dt = Math.min(0.033, (now - prevNow) / 1000);
      prevNow = now;
      
      // Run client-side prediction for local player
      if (role === "guest" && CLIENT_PREDICTION_ENABLED) {
        predictionAccumulator += dt;
        
        // Initialize predicted state from last server snapshot if needed
        const meServer = targets.find((p) => p.id === myPlayerId);
        if (meServer) {
          if (!guestPredictedStateRef.current.has(myPlayerId)) {
            guestPredictedStateRef.current.set(myPlayerId, {
              x: meServer.x,
              y: meServer.y,
              vx: meServer.vx,
              vy: meServer.vy,
              onGround: meServer.onGround,
              coyoteLeft: COYOTE_TIME,
              jumpBufferLeft: 0,
            });
          }
          
          // Apply prediction steps
          while (predictionAccumulator >= PREDICTION_STEP) {
            const pred = guestPredictedStateRef.current.get(myPlayerId)!;
            const input = guestPredictedInputRef.current;
            
            // Apply gravity
            pred.vy += GRAVITY * PREDICTION_STEP;
            
            // Apply movement
            if (input.left === input.right) {
              pred.vx *= pred.onGround ? 0.75 : 0.94;
            } else {
              pred.vx = (input.left ? -1 : 1) * MOVE_SPEED;
            }
            
            // Update coyote time and jump buffer
            if (pred.onGround) {
              pred.coyoteLeft = COYOTE_TIME;
            } else {
              pred.coyoteLeft = Math.max(0, pred.coyoteLeft - PREDICTION_STEP);
            }
            
            if (input.jump) {
              pred.jumpBufferLeft = JUMP_BUFFER_TIME;
            } else {
              pred.jumpBufferLeft = Math.max(0, pred.jumpBufferLeft - PREDICTION_STEP);
            }
            
            // Jump if buffer > 0 and on ground or has coyote time
            if (pred.jumpBufferLeft > 0 && (pred.onGround || pred.coyoteLeft > 0)) {
              pred.vy = -JUMP_SPEED;
              pred.onGround = false;
              pred.coyoteLeft = 0;
              pred.jumpBufferLeft = 0;
            }
            
            // Apply position
            pred.x += pred.vx * PREDICTION_STEP;
            pred.y += pred.vy * PREDICTION_STEP;
            
            // Simple ground check (assume y=0 is ground for prediction)
            const groundY = 0;
            if (pred.y >= groundY) {
              pred.y = groundY;
              pred.vy = 0;
              pred.onGround = true;
            }
            
            predictionAccumulator -= PREDICTION_STEP;
          }
        }
      }
      
      setRenderFrame((prev) => {
        if (role === "host") {
          const me = targets.find((p) => p.id === myPlayerId) ?? targets[0];
          let nextView = prev.viewX;
          if (me) {
            const targetView = clampView(me.x + PLAYER_W / 2 - cameraWidth / 2, map.width, cameraWidth);
            nextView = stepCameraWithSpeed(prev.viewX, targetView, dt, 2400);
          }
          return { visualPlayers: toVisualPlayers(targets), viewX: nextView };
        }

        const prevMap = new Map(prev.visualPlayers.map((p) => [p.id, p]));
        const meServer = targets.find((p) => p.id === myPlayerId) ?? targets[0];
        const localInContact = !!meServer && targets.some((p) => p.id !== meServer.id && isNearBodyContact(p, meServer));
        let meVisualX: number | undefined;
        const nextVisual = targets.map((target) => {
          const cur = prevMap.get(target.id);
          const isLocal = target.id === myPlayerId;
          const prevServer = lastServerSampleRef.current.get(target.id);
          if (target.onGround) {
            lastGroundYRef.current.set(target.id, target.y);
          }
          const leadX = role === "guest" && isLocal ? (localInContact ? 0 : 0.02) : 0;
          const tx = clampPlayerXToMap(target.x + target.vx * leadX, map);
          // Keep a tiny airborne Y lead so local motion stays smooth, but still snap cleanly on landing.
          const leadY = role === "guest" && isLocal && !target.onGround ? Math.max(-10, Math.min(10, target.vy * 0.012)) : 0;
          const ty = target.y + leadY;
          if (!cur) {
            if (isLocal) meVisualX = tx;
            return { id: target.id, x: tx, y: ty };
          }
          const closeToLocal = role === "guest" && !isLocal && !!meServer && isNearBodyContact(target, meServer);
          const contactBoost = role === "guest" && (closeToLocal || (isLocal && localInContact));
          // Contact moments use higher lerp, not hard snapping, to avoid magnetic pull artifacts.
          const lerpX = 1 - Math.exp(-((isLocal ? 22 : closeToLocal ? 20 : 13) + (contactBoost ? 11 : 0)) * dt);
          const lerpY = 1 - Math.exp(-((isLocal ? (target.onGround ? 22 : 16) : 12) + (contactBoost ? 8 : 0)) * dt);
          const nx = cur.x + (tx - cur.x) * lerpX;
          const ny = cur.y + (ty - cur.y) * lerpY;
          const finalX = clampPlayerXToMap(Math.abs(tx - nx) < 0.15 ? tx : nx, map);
          let finalY = Math.abs(ty - ny) < 0.15 ? ty : ny;
          if (isLocal) {
            // Improved jump detection: check for significant upward velocity change from grounded state
            // Use visual position (cur.y) instead of server onGround to account for interpolation delay
            const wasVisuallyGrounded = !!prevServer && Math.abs(cur.y - prevServer.y) < 2;
            const isVisuallyAirborne = cur.y < (lastGroundYRef.current.get(target.id) ?? cur.y) - 3;
            const justJumped = !!prevServer && wasVisuallyGrounded && isVisuallyAirborne && target.vy < -100;
            const justLanded = !!prevServer && !isVisuallyAirborne && target.onGround;
            if (target.onGround) {
              // Strong ground settling, but avoid hard snapping every frame which feels stiff.
              const settleY = 1 - Math.exp(-34 * dt);
              finalY = cur.y + (target.y - cur.y) * settleY;
              if (Math.abs(finalY - target.y) < 0.7 || justLanded) {
                finalY = target.y;
              }
            } else {
              const airY = 1 - Math.exp(-18 * dt);
              finalY = cur.y + (ty - cur.y) * airY;
              // Only apply jump visual correction when we actually detected a fresh jump from grounded state
              if (justJumped) {
                // Prevent the visual "not landed but already jumped" illusion on chained jumps.
                const groundY = lastGroundYRef.current.get(target.id);
                if (groundY !== undefined && cur.y < groundY - 2) {
                  finalY = Math.max(finalY, groundY - 0.5);
                }
                finalY += (target.y - finalY) * 0.65;
              }
            }
          }
          if (isLocal) meVisualX = finalX;
          return {
            id: target.id,
            x: finalX,
            y: finalY,
          };
        });

        const stabilizedVisual = nextVisual;

        // Use predicted position for local player when prediction is enabled
        let meX = role === "guest" ? meVisualX ?? meServer?.x : meServer?.x;
        if (role === "guest" && CLIENT_PREDICTION_ENABLED) {
          const pred = guestPredictedStateRef.current.get(myPlayerId);
          if (pred) {
            meX = clampPlayerXToMap(pred.x, map);
          }
        }
        let nextView = prev.viewX;
        if (meX !== undefined) {
          const targetView = clampView(meX + PLAYER_W / 2 - cameraWidth / 2, map.width, cameraWidth);
          // Keep guest camera smooth to avoid hard snap when network updates jump (e.g. hook pull).
          nextView = role === "guest" ? stepCameraWithSpeed(prev.viewX, targetView, dt, 1900) : stepCamera(prev.viewX, targetView, dt);
        }

        const serverSnapshot = new Map<number, { x: number; y: number; vx: number; vy: number; onGround: boolean }>();
        for (const p of targets) {
          serverSnapshot.set(p.id, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, onGround: p.onGround });
        }
        lastServerSampleRef.current = serverSnapshot;

        return { visualPlayers: stabilizedVisual, viewX: nextView };
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [role, myPlayerId, game.mapId, game.customMapCode, cameraWidth]);

  useEffect(() => {
    return () => {
      connRef.current?.close();
      peerRef.current?.destroy();
    };
  }, []);

  function closeOnline() {
    if (role === "host" && roomId) {
      removeLobbyEntry(roomId);
    }
    connRef.current?.close();
    connRef.current = null;
    for (const conn of hostConnsRef.current.values()) conn.close();
    hostConnsRef.current.clear();
    connToPlayerRef.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    hostInputsRef.current = { 1: initialInput() };
    nextPlayerIdRef.current = 2;
    lastSentInputRef.current = initialInput();
    lastInputSentAtRef.current = 0;
  }

  function handleHostDisconnect(conn: DataConnection) {
    const pid = connToPlayerRef.current.get(conn.peer);
    if (!pid) return;
    connToPlayerRef.current.delete(conn.peer);
    hostConnsRef.current.delete(pid);
    delete hostInputsRef.current[pid];

    const nextGame: GameState = {
      ...gameRef.current,
      players: gameRef.current.players.filter((p) => p.id !== pid),
    };
    gameRef.current = nextGame;
    setGame(nextGame);
    if (role === "host" && roomId) {
      void publishRoomSnapshot(roomId);
    }
  }

  function addGuestPlayer(conn: DataConnection, joinedName: string) {
    if (gameRef.current.players.length >= MAX_PLAYERS) {
      setStatus(`房间已满(${MAX_PLAYERS})`);
      conn.close();
      return;
    }

    const playerId = nextPlayerIdRef.current;
    nextPlayerIdRef.current += 1;

    connToPlayerRef.current.set(conn.peer, playerId);
    hostConnsRef.current.set(playerId, conn);
    hostInputsRef.current[playerId] = initialInput();

    const name = joinedName.trim().slice(0, 14) || `玩家${playerId}`;
    const arena = mapFromState(gameRef.current);
    const nextGame: GameState = {
      ...gameRef.current,
      players: [...gameRef.current.players, makePlayer(playerId, name, gameRef.current.mapId, arena)],
    };
    gameRef.current = nextGame;
    setGame(nextGame);

    const startMsg: NetStartMessage = { type: "start", playerId };
    conn.send(startMsg);
    const stateMsg: NetStateMessage = { type: "state", state: nextGame };
    conn.send(stateMsg);
    setStatus(`${name} 已加入，当前 ${nextGame.players.length}/${MAX_PLAYERS}`);
    if (roomId) {
      void publishRoomSnapshot(roomId);
    }
  }

  function createRoom() {
    const hostName = nickname.trim().slice(0, 14) || "主机";
    const pickedMap = getMapById(selectedMapId);
    const trimmedCode = createMapCode.trim();
    const customCode = trimmedCode ? (decodeMapCode(trimmedCode) ? trimmedCode : null) : null;
    if (trimmedCode && !customCode) {
      setStatus("地图码无效，请先修正再创建房间");
      return;
    }
    closeOnline();
    const id = `parkour-${Math.random().toString(36).slice(2, 7)}`;
    setRoomId(id);
    setStatus("正在创建房间...");

    const fresh = makeHostGame(hostName, pickedMap.id, customCode);
    gameRef.current = fresh;
    setGame(fresh);
    setRenderFrame({ visualPlayers: toVisualPlayers(fresh.players), viewX: 0 });
    setMyPlayerId(1);
    setRole("host");
    void publishRoomSnapshot(id);

    const peer = new Peer(id);
    peerRef.current = peer;

    peer.on("open", () => {
      setStatus(`房间 ${id} 已创建，等待玩家加入`);
    });

    peer.on("connection", (conn) => {
      const pendingInputs = new Map<number, InputState>();
      
      conn.on("data", (raw) => {
        const msg = raw as NetMessage;
        if (msg.type === "join") {
          addGuestPlayer(conn, msg.nickname);
          return;
        }

        if (msg.type === "input") {
          const pid = connToPlayerRef.current.get(conn.peer);
          if (!pid) return;
          const incomingInput = msg.input;
          const existingInput = hostInputsRef.current[pid];
          if (!existingInput || incomingInput.seq > existingInput.seq) {
            hostInputsRef.current[pid] = incomingInput;
          }
          return;
        }

        if (msg.type === "rename") {
          const pid = connToPlayerRef.current.get(conn.peer);
          if (!pid) return;
          const safeName = msg.nickname.trim().slice(0, 14) || `玩家${pid}`;
          const nextGame: GameState = {
            ...gameRef.current,
            players: gameRef.current.players.map((p) => (p.id === pid ? { ...p, name: safeName } : p)),
          };
          gameRef.current = nextGame;
          setGame(nextGame);
        }
      });

      conn.on("close", () => handleHostDisconnect(conn));
    });

    peer.on("error", (err) => {
      setStatus(`创建失败: ${err.message}`);
      setRole("menu");
      closeOnline();
    });
  }

  function joinRoom(targetRoomId?: string) {
    const joinName = nickname.trim().slice(0, 14) || "玩家";
    const roomTarget = (targetRoomId ?? roomId).trim();
    if (!roomTarget) {
      setStatus("请输入房间号");
      return;
    }

    setRoomId(roomTarget);

    closeOnline();
    setStatus("正在加入房间...");

    const peer = new Peer();
    peerRef.current = peer;

    peer.on("open", () => {
      const conn = peer.connect(roomTarget);
      connRef.current = conn;

      conn.on("open", () => {
        setRole("guest");
        setStatus("已连接，等待主机分配角色");
        const joinMsg: NetJoinMessage = { type: "join", nickname: joinName };
        conn.send(joinMsg);
      });

      conn.on("data", (raw) => {
        const msg = raw as NetMessage;
        if (msg.type === "start") {
          setMyPlayerId(msg.playerId);
          setStatus(`已加入，编号 P${msg.playerId}`);
        }
        if (msg.type === "state") {
          applyIncomingGuestState(msg.state);
        }
        if (msg.type === "reset") {
          const refreshed = makeHostGame(nickname.trim().slice(0, 14) || "玩家", MAPS[0].id, null);
          gameRef.current = refreshed;
          setGame(refreshed);
        }
      });

      conn.on("close", () => {
        setStatus("连接断开，已返回菜单");
        setRole("menu");
      });
    });

    peer.on("error", (err) => {
      setStatus(`加入失败: ${err.message}`);
      setRole("menu");
      closeOnline();
    });
  }

  function backToMenu() {
    closeOnline();
    setRole("menu");
    setStatus("输入昵称后创建或加入房间");
    setRenderFrame((prev) => ({ ...prev, viewX: 0 }));
    void refreshRooms(true);
  }

  function startMatchWithMap(mapId: string) {
    if (role !== "host") return;
    const chosenMap = getMapById(mapId);
    const refreshedPlayers = gameRef.current.players.map((p) => {
      const fresh = makePlayer(p.id, p.name, chosenMap.id, chosenMap);
      return fresh;
    });
    const nextGame: GameState = {
      mapId: chosenMap.id,
      customMapCode: null,
      matchEnded: false,
      winnerId: null,
      players: refreshedPlayers,
    };
    gameRef.current = nextGame;
    setGame(nextGame);
    setRenderFrame({ visualPlayers: toVisualPlayers(nextGame.players), viewX: 0 });
    setStatus(`地图已切换: ${chosenMap.name}`);
  }

  const activeGame = role === "menu" ? game : gameRef.current;
  const myPlayer = useMemo(() => activeGame.players.find((p) => p.id === myPlayerId) ?? null, [activeGame.players, myPlayerId]);
  const currentMap = useMemo(() => mapFromState(activeGame), [activeGame]);
  const visualPlayers = renderFrame.visualPlayers;
  const viewX = renderFrame.viewX;
  const visualById = useMemo(() => new Map(visualPlayers.map((p) => [p.id, p])), [visualPlayers]);
  const localSelf = activeGame.players.find((p) => p.id === myPlayerId) ?? null;
  const worldPlayers = useMemo(
    () => activeGame.players.filter((p) => p.id !== myPlayerId),
    [activeGame.players, myPlayerId],
  );
  const winner = useMemo(
    () => activeGame.players.find((p) => p.id === activeGame.winnerId) ?? null,
    [activeGame.players, activeGame.winnerId],
  );
  const leaderboard = useMemo(
    () => activeGame.players.slice().sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id - b.id)),
    [activeGame.players],
  );
  const editorTileEntries = useMemo(
    () =>
      Object.entries(editorTiles).map(([key, id]) => {
        const [sx, sy] = key.split(",");
        return { gx: Number(sx), gy: Number(sy), id };
      }),
    [editorTiles],
  );

  function exportEditorCode() {
    const payload: MapCodePayload = {
      v: 1,
      name: editorMapName.trim() || "我的地图",
      tiles: editorTileEntries.map((cell) => [cell.gx, cell.gy, cell.id] as TileEntry),
    };
    const code = encodeMapCode(payload);
    setEditorCodeInput(code);
    setCreateMapCode(code);
    setStatus("地图码已导出并填入创建房间输入框");
  }

  function importEditorCode() {
    const parsed = decodeMapCode(editorCodeInput);
    if (!parsed) {
      setStatus("地图码无效，导入失败");
      return;
    }
    const nextTiles: Record<string, TileId> = {};
    for (const [gx, gy, id] of parsed.tiles) {
      nextTiles[`${gx},${gy}`] = id;
    }
    setEditorTiles(nextTiles);
    setEditorMapName(parsed.name?.trim() || "我的地图");
    setCreateMapCode(editorCodeInput.trim());
    setStatus("地图码导入成功");
  }

  function paintEditorCell(ev: MouseEvent<HTMLDivElement>) {
    const rect = editorViewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldX = editorPan.x + (ev.clientX - rect.left);
    const worldY = editorPan.y + (ev.clientY - rect.top);
    const gx = Math.floor(worldX / GRID_SIZE);
    const gy = Math.floor(worldY / GRID_SIZE);
    const key = `${gx},${gy}`;
    setEditorTiles((prev) => {
      const next = { ...prev };
      if (editorSelectedBlock === null) {
        delete next[key];
      } else {
        next[key] = editorSelectedBlock;
      }
      return next;
    });
  }

  function renderEditorTile(tile: TileId) {
    if (tile === 1) {
      return <div className="h-full w-full bg-emerald-500/15"><div className="mx-auto mt-2 h-7 w-1.5 bg-emerald-400" /><div className="mx-auto mt-0.5 h-3 w-5 bg-emerald-300" /></div>;
    }
    if (tile === 2) return <div className="h-full w-full bg-black" />;
    if (tile === 3) return <div className="h-1/2 w-full bg-black" />;
    if (tile === 4) return <div className="mt-1/2 h-1/2 w-full bg-black" />;
    if (tile === 5) return <div className="h-full w-1/2 bg-black" />;
    if (tile === 6) return <div className="ml-1/2 h-full w-1/2 bg-black" />;
    if (tile === 7) return <div className="h-full w-full bg-red-500" style={{ clipPath: "polygon(0% 100%,100% 100%,50% 0%)" }} />;
    if (tile === 8) return <div className="h-full w-full bg-red-500" style={{ clipPath: "polygon(0% 0%,100% 0%,50% 100%)" }} />;
    if (tile === 9) return <div className="h-full w-full bg-red-500" style={{ clipPath: "polygon(0% 0%,0% 100%,100% 50%)" }} />;
    return <div className="h-full w-full bg-red-500" style={{ clipPath: "polygon(100% 0%,100% 100%,0% 50%)" }} />;
  }

  function renderPlayerBody(pl: PlayerState, px: number, py: number) {
    // Keep the avatar shape and effects consistent for world-space and screen-space rendering.
    const pupilShift = pl.face > 0 ? 3 : -3;
    const facingMarkerLeft = pl.face > 0 ? PLAYER_W - 5 : 1;
    return (
      <>
        <div className="absolute rounded-sm" style={{ left: px, top: py, width: PLAYER_W, height: PLAYER_H, background: playerColor(pl.id) }}>
          <div className="absolute h-4 w-1.5 rounded bg-zinc-950/85" style={{ left: facingMarkerLeft, top: 16 }} />
          <div className="absolute h-[8px] w-[10px] rounded-full bg-zinc-100" style={{ left: 6, top: 11 }} />
          <div className="absolute h-[8px] w-[10px] rounded-full bg-zinc-100" style={{ left: 18, top: 11 }} />
          <div className="absolute h-[4px] w-[4px] rounded-full bg-zinc-900" style={{ left: 9 + pupilShift, top: 13 }} />
          <div className="absolute h-[4px] w-[4px] rounded-full bg-zinc-900" style={{ left: 21 + pupilShift, top: 13 }} />
        </div>
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-white"
          style={{ left: px + PLAYER_W / 2, top: py - 20 }}
        >
          {pl.name}
        </div>
        {pl.punchFx > 0 && (
          <div className="absolute h-3 bg-rose-400" style={{ width: 48, left: px + (pl.face > 0 ? PLAYER_W : -48), top: py + 18 }} />
        )}
        {pl.hookFx > 0 && (
          <div
            className="absolute h-[2px] bg-cyan-300"
            style={{ width: 130, left: px + (pl.face > 0 ? PLAYER_W : -130), top: py + 25 }}
          />
        )}
        {pl.stunLeft > 0 && (
          <div className="absolute text-[10px] text-cyan-200" style={{ left: px - 2, top: py - 34 }}>
            stunned
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">多人互坑乱斗</h1>
          <button onClick={backToMenu} className="rounded bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
            返回菜单
          </button>
        </div>

        <div className="text-sm text-zinc-300">{status}</div>

        {role === "menu" ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="输入昵称"
              className="rounded bg-zinc-900 px-3 py-2 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            <div className="min-w-[320px] rounded bg-zinc-900 px-3 py-2 text-zinc-400 ring-1 ring-zinc-800">大厅自动同步已开启</div>
            <select
              value={selectedMapId}
              onChange={(e) => setSelectedMapId(e.target.value)}
              className="rounded bg-zinc-900 px-3 py-2 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            >
              {MAPS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button onClick={createRoom} className="rounded bg-emerald-500 px-4 py-2 font-semibold text-white hover:bg-emerald-400">
              创建多人房间
            </button>
            <button
              onClick={() => setEditorOpen((v) => !v)}
              className="rounded bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400"
            >
              {editorOpen ? "关闭地图编辑" : "打开地图编辑"}
            </button>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="输入房间号"
              className="rounded bg-zinc-900 px-3 py-2 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            <button onClick={() => joinRoom()} className="rounded bg-sky-500 px-4 py-2 font-semibold text-white hover:bg-sky-400">
              加入房间
            </button>
            <button onClick={() => void refreshRooms()} className="rounded bg-zinc-700 px-4 py-2 font-semibold text-white hover:bg-zinc-600">
              刷新房间列表
            </button>
            <textarea
              value={createMapCode}
              onChange={(e) => setCreateMapCode(e.target.value)}
              placeholder="创建房间时可导入地图码，不填则使用上方预设地图"
              className="h-24 w-full rounded bg-zinc-900 px-3 py-2 text-xs outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            <div className="w-full text-sm text-zinc-300">大厅说明: 直接点刷新即可，会自动同步当前在线玩家创建的房间。</div>
            <div className="w-full text-sm text-zinc-300">
              可加入房间:
              {roomList.length === 0 ? (
                <span className="ml-2 text-zinc-500">暂无可见房间</span>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {roomList.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => joinRoom(entry.id)}
                      className="rounded bg-zinc-800 px-3 py-2 text-left text-xs leading-5 text-zinc-100 hover:bg-zinc-700"
                    >
                      {entry.id} | {entry.host} | {entry.mapName} | {entry.players}/{MAX_PLAYERS}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-300">
            <div>操作: A/D 移动, W 跳跃, J 推, K 钩</div>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="修改昵称"
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            {myPlayer && (
              <div>
                你的冷却: 拳 {myPlayer.punchCd.toFixed(1)}s, 钩 {myPlayer.hookCd.toFixed(1)}s
              </div>
            )}
            <div>计分规则: 先到 50 杀获胜</div>
            <div>当前地图: {currentMap.name}</div>
            {role === "host" && activeGame.matchEnded && (
              <>
                <select
                  value={selectedMapId}
                  onChange={(e) => setSelectedMapId(e.target.value)}
                  className="rounded bg-zinc-900 px-3 py-1.5 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
                >
                  {MAPS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => startMatchWithMap(selectedMapId)}
                  className="rounded bg-amber-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
                >
                  重新开始
                </button>
              </>
            )}
          </div>
        )}

        {role === "menu" && editorOpen ? (
          <div className="space-y-3">
            <div
              ref={editorViewportRef}
              onWheel={(ev) => {
                ev.preventDefault();
                setEditorPan((prev) => ({ x: prev.x + ev.deltaX, y: Math.max(-200, prev.y + ev.deltaY) }));
              }}
              onClick={paintEditorCell}
              className="relative h-[560px] w-full cursor-crosshair overflow-hidden rounded border border-zinc-700 bg-zinc-900"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
                backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                backgroundPosition: `${-editorPan.x}px ${-editorPan.y}px`,
              }}
            >
              {editorTileEntries.map((cell) => {
                const px = cell.gx * GRID_SIZE - editorPan.x;
                const py = cell.gy * GRID_SIZE - editorPan.y;
                if (px < -GRID_SIZE || py < -GRID_SIZE || px > cameraWidth + GRID_SIZE || py > ARENA_HEIGHT + GRID_SIZE) return null;
                return (
                  <div key={`${cell.gx}-${cell.gy}`} className="absolute" style={{ left: px, top: py, width: GRID_SIZE, height: GRID_SIZE }}>
                    {renderEditorTile(cell.id)}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                value={editorMapName}
                onChange={(e) => setEditorMapName(e.target.value)}
                placeholder="地图名"
                className="rounded bg-zinc-900 px-3 py-2 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
              />
              <button onClick={exportEditorCode} className="rounded bg-emerald-500 px-3 py-2 font-semibold text-white hover:bg-emerald-400">
                导出地图码
              </button>
              <button onClick={importEditorCode} className="rounded bg-sky-500 px-3 py-2 font-semibold text-white hover:bg-sky-400">
                导入地图码
              </button>
              <span className="text-zinc-400">滚轮拖动地图，点击格子放置或清空。</span>
            </div>
            <textarea
              value={editorCodeInput}
              onChange={(e) => setEditorCodeInput(e.target.value)}
              placeholder="地图码"
              className="h-24 w-full rounded bg-zinc-900 px-3 py-2 text-xs outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
            />
            <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-800 bg-zinc-950/95 px-4 py-2">
              <div className="mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto">
                {EDITOR_BLOCKS.map((blk) => (
                  <button
                    key={blk.id}
                    onClick={() => setEditorSelectedBlock((prev) => (prev === blk.id ? null : blk.id))}
                    className={`min-w-[90px] rounded px-2 py-2 text-xs ${editorSelectedBlock === blk.id ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                  >
                    {blk.id} {blk.name}
                  </button>
                ))}
                <button
                  onClick={() => setEditorSelectedBlock(null)}
                  className={`min-w-[90px] rounded px-2 py-2 text-xs ${editorSelectedBlock === null ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                >
                  清空模式
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
              <span className="font-semibold text-zinc-100">击杀排行榜:</span>
              {leaderboard.map((p, idx) => (
                <div key={p.id} className={p.id === myPlayerId ? "text-amber-300" : "text-zinc-200"}>
                  #{idx + 1} {p.name}(P{p.id}) {p.score}
                </div>
              ))}
            </div>

            <div ref={arenaRef} className="relative h-[560px] w-full overflow-hidden rounded border border-zinc-800 bg-zinc-900">
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(14,22,40,0.8),rgba(10,10,10,0.6))]" />

              <div
                className="absolute left-0 top-0 h-full will-change-transform"
                style={{ width: `${currentMap.width}px`, transform: `translate3d(${-viewX}px, 0, 0)` }}
              >
                {currentMap.wallLeft && <div className="absolute left-0 top-0 h-full w-1 bg-cyan-300/70" />}
                {currentMap.wallRight && (
                  <div className="absolute top-0 h-full w-1 bg-cyan-300/70" style={{ left: currentMap.width - 1 }} />
                )}
                {currentMap.platforms.map((p, idx) => (
                  <div key={idx} className="absolute bg-zinc-700" style={{ left: p.x, top: p.y, width: p.w, height: p.h }} />
                ))}
                {(currentMap.spikes ?? []).map((sp, idx) => (
                  <div
                    key={`sp-${idx}`}
                    className="absolute bg-red-500"
                    style={{
                      left: sp.x,
                      top: sp.y,
                      width: sp.size,
                      height: sp.size,
                      clipPath:
                        sp.dir === "up"
                          ? "polygon(0% 100%,100% 100%,50% 0%)"
                          : sp.dir === "down"
                            ? "polygon(0% 0%,100% 0%,50% 100%)"
                            : sp.dir === "left"
                              ? "polygon(0% 0%,0% 100%,100% 50%)"
                              : "polygon(100% 0%,100% 100%,0% 50%)",
                    }}
                  />
                ))}

                {worldPlayers.map((pl) => (
                  <div key={pl.id}>
                    {(() => {
                      const visual = visualById.get(pl.id);
                      const px = visual?.x ?? pl.x;
                      const py = visual?.y ?? pl.y;
                      return renderPlayerBody(pl, px, py);
                    })()}
                  </div>
                ))}
              </div>
              {localSelf && (() => {
                const visual = visualById.get(localSelf.id);
                const worldX = visual?.x ?? localSelf.x;
                const worldY = visual?.y ?? localSelf.y;
                const screenX = worldX - viewX;
                const screenY = worldY;
                return <div className="absolute left-0 top-0 h-full w-full">{renderPlayerBody(localSelf, screenX, screenY)}</div>;
              })()}
              {activeGame.matchEnded && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-center">
                  <div className="space-y-2">
                    <div className="text-3xl font-bold text-amber-300">{winner ? `${winner.name} 获胜` : "对局结束"}</div>
                    <div className="text-sm text-zinc-200">已达到 {SCORE_TO_WIN} 击杀</div>
                    {role === "host" ? (
                      <div className="text-sm text-zinc-300">房主可在上方选择地图后重新开始</div>
                    ) : (
                      <div className="text-sm text-zinc-300">等待房主选择地图并开新局</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="text-sm text-zinc-400">掉出地图或碰到尖刺会重生，被你在 4 秒内击中过的玩家死亡会计入你的击杀。</div>
          </>
        )}
      </div>
    </div>
  );
}
