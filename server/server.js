// Fake Bloom オンライン対戦 フェーズ1：最小サーバー。
// Node 標準のみ（http / fs / path / crypto）。依存パッケージなし。
// - 静的ファイル配信：リポジトリ直下の index.html / game-logic.js 等を配る
//   （フェーズ2でクライアントがここへ接続する準備）。server/ と .git は配らない。
// - WebSocket（/ws）：部屋の作成/参加、セッショントークンでの再接続。
//   1試合の進行（配役・夜・議論・投票）は後の歩で追加する。
// 試験運用は VM 内だけ。外部公開しない。待ち受けは 127.0.0.1 に固定する。
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createRoomStore } = require("./rooms.js");
const { computeAcceptKey, encodeTextFrame, encodeFrame, decodeFrames } = require("./ws.js");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function createServer(options = {}) {
  const root = options.root || path.resolve(__dirname, "..");
  const rooms = options.rooms || createRoomStore();
  // 部屋コード → その部屋に繋がっているソケットの集合。
  const roomSockets = new Map();
  const sockets = new Set();

  function sendJson(socket, obj) {
    try {
      socket.write(encodeTextFrame(JSON.stringify(obj)));
    } catch {
      // 書き込みに失敗したソケットは次に壊れたものとして扱う。
    }
  }

  function broadcast(roomCode, obj) {
    const set = roomSockets.get(roomCode);
    if (!set) return;
    for (const socket of set) sendJson(socket, obj);
  }

  function attachToRoom(socket, roomCode) {
    detachFromRoom(socket);
    socket._roomCode = roomCode;
    let set = roomSockets.get(roomCode);
    if (!set) {
      set = new Set();
      roomSockets.set(roomCode, set);
    }
    set.add(socket);
  }

  function detachFromRoom(socket) {
    if (!socket._roomCode) return;
    const set = roomSockets.get(socket._roomCode);
    if (set) {
      set.delete(socket);
      if (set.size === 0) roomSockets.delete(socket._roomCode);
    }
    socket._roomCode = null;
  }

  function roomUpdate(room) {
    return { type: "roomUpdate", code: room.code, players: rooms.publicPlayers(room) };
  }

  function handleMessage(socket, msg) {
    if (!msg || typeof msg.type !== "string") {
      sendJson(socket, { type: "error", error: "bad_message" });
      return;
    }
    if (msg.type === "createRoom") {
      const { room, player } = rooms.createRoom();
      attachToRoom(socket, room.code);
      socket._token = player.token;
      sendJson(socket, {
        type: "roomCreated",
        code: room.code,
        token: player.token,
        playerId: player.id,
        name: player.name,
        icon: player.icon,
        players: rooms.publicPlayers(room),
      });
      return;
    }
    if (msg.type === "joinRoom") {
      const result = rooms.joinRoom(msg.code);
      if (result.error) {
        sendJson(socket, { type: "error", error: result.error });
        return;
      }
      const { room, player } = result;
      attachToRoom(socket, room.code);
      socket._token = player.token;
      sendJson(socket, {
        type: "roomJoined",
        code: room.code,
        token: player.token,
        playerId: player.id,
        name: player.name,
        icon: player.icon,
        players: rooms.publicPlayers(room),
      });
      broadcast(room.code, roomUpdate(room));
      return;
    }
    if (msg.type === "reconnect") {
      const result = rooms.reconnect(msg.code, msg.token);
      if (result.error) {
        sendJson(socket, { type: "error", error: result.error });
        return;
      }
      const { room, player } = result;
      attachToRoom(socket, room.code);
      socket._token = player.token;
      sendJson(socket, {
        type: "reconnected",
        code: room.code,
        token: player.token,
        playerId: player.id,
        name: player.name,
        icon: player.icon,
        players: rooms.publicPlayers(room),
      });
      broadcast(room.code, roomUpdate(room));
      return;
    }
    sendJson(socket, { type: "error", error: "unknown_type" });
  }

  function handleUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    const version = req.headers["sec-websocket-version"];
    if (!key || version !== "13") {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n\r\n`
    );
    sockets.add(socket);
    socket._roomCode = null;
    socket._token = null;
    socket._buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      socket._buffer = Buffer.concat([socket._buffer, chunk]);
      let parsed;
      try {
        parsed = decodeFrames(socket._buffer);
      } catch {
        socket.destroy();
        return;
      }
      socket._buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (frame.opcode === 9) {
          // ping には pong で返す。
          socket.write(encodeFrame(frame.payload, 10));
          continue;
        }
        if (frame.opcode === 8) {
          socket.end(encodeFrame(Buffer.alloc(0), 8));
          continue;
        }
        if (frame.opcode !== 1 || !frame.fin) continue;
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          sendJson(socket, { type: "error", error: "bad_json" });
          continue;
        }
        handleMessage(socket, msg);
      }
    });
    socket.on("close", () => {
      sockets.delete(socket);
      if (socket._roomCode && socket._token) {
        rooms.disconnect(socket._roomCode, socket._token);
        const room = rooms.getRoom(socket._roomCode);
        if (room) broadcast(socket._roomCode, roomUpdate(room));
      }
      detachFromRoom(socket);
    });
    socket.on("error", () => {
      socket.destroy();
    });
  }

  function serveStatic(req, res) {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.normalize(path.join(root, rel));
    // root の外・server/・ドットファイルは配らない。
    if (
      !filePath.startsWith(root + path.sep) ||
      filePath.startsWith(path.join(root, "server") + path.sep) ||
      path.basename(filePath).startsWith(".")
    ) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return;
    }
    serveStatic(req, res);
  });
  server.on("upgrade", (req, socket) => {
    const urlPath = new URL(req.url, "http://localhost").pathname;
    if (urlPath !== "/ws") {
      socket.destroy();
      return;
    }
    handleUpgrade(req, socket);
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.FB_PORT || 8787);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Fake Bloom server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer };
