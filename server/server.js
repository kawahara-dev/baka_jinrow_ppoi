// Fake Bloom オンライン対戦 フェーズ1：最小サーバー。
// Node 標準のみ（http / fs / path / crypto）。依存パッケージなし。
// - 静的ファイル配信：リポジトリ直下の index.html / game-logic.js 等を配る
//   （フェーズ2でクライアントがここへ接続する準備）。server/ と .git は配らない。
// - WebSocket（/ws）：部屋の作成/参加、セッショントークンでの再接続、
//   配役とプレイヤー別ビューの配信、夜フェーズ（夜入力の収集・
//   タイムアウト・夜の解決と結果配信）、議論フェーズ（CPU の発言・
//   人間の定型文＋自由入力・議論の終了と投票への遷移）。投票の
//   受け付けと勝敗・結果開示は後の歩で追加する。
// 試験運用は VM 内だけ。外部公開しない。待ち受けは 127.0.0.1 に固定する。
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createRoomStore } = require("./rooms.js");
const {
  createGame,
  validateStart,
  playerView,
  submitNightAction,
  nightInputsComplete,
  resolveNight,
  nightResolvedMessage,
  startDiscussion,
  submitTalk,
  markDiscussionDone,
  discussionComplete,
  discussionStartedMessage,
  talkBroadcast,
  discussionEndedMessage,
  NIGHT_TIMEOUT_MS,
} = require("./game.js");
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
  const random = options.random || Math.random;
  const nightTimeoutMs = options.nightTimeoutMs || NIGHT_TIMEOUT_MS;
  // 議論タイマーの上書き（テスト用）。未指定なら設定の discussTimer
  // （秒。DEFAULT_SETTINGS は "0"＝タイマーなし）を使う。
  const discussTimeoutMs = options.discussTimeoutMs;
  // 部屋コード → その部屋に繋がっているソケットの集合。
  const roomSockets = new Map();
  const sockets = new Set();
  // 部屋コード → 夜の締め切りタイマー。unref しておく（テストで
  // サーバーを閉じたあと、残ったタイマーがプロセスを止めないため）。
  const nightTimers = new Map();
  // 部屋コード → 議論の締め切りタイマー（夜と同じく unref 付き）。
  const discussionTimers = new Map();

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

  // 試合開始を部屋の各ソケットへ送る。送るのは席ごとの player view
  // だけ（全員へ同じものを送る broadcast は使わない。秘匿のため）。
  function sendGameStarted(room) {
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      sendJson(socket, {
        type: "gameStarted",
        code: room.code,
        view: playerView(room.game, player.id),
      });
    }
  }

  function clearNightTimer(roomCode) {
    const timer = nightTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      nightTimers.delete(roomCode);
    }
  }

  function scheduleNightTimer(room) {
    clearNightTimer(room.code);
    const timer = setTimeout(() => {
      nightTimers.delete(room.code);
      resolveNightForRoom(room);
    }, nightTimeoutMs);
    timer.unref();
    nightTimers.set(room.code, timer);
  }

  // 夜を解決し、結果を部屋の各ソケットへ席ごとに送る（個人ログは
  // その席の分だけ。gameStarted と同じく全員への同一配信は使わない）。
  // 送り終えたらすぐ議論を開始する（朝の報告を読んでから議論へ）。
  function resolveNightForRoom(room) {
    clearNightTimer(room.code);
    if (!room.game || room.game.phase !== "night") return;
    const result = resolveNight(room.game, random);
    if (!result) return;
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = nightResolvedMessage(room.game, result, player.id);
      if (msg) sendJson(socket, msg);
    }
    startDiscussionForRoom(room);
  }

  function clearDiscussionTimer(roomCode) {
    const timer = discussionTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      discussionTimers.delete(roomCode);
    }
  }

  // 議論の締め切り（設定の discussTimer 秒。テスト用の上書きがあれば
  // そちらを優先する。0 ならタイマーなしで、全員の discussionDone
  // を待つ）。タイマーが回るのは議論が始まったときだけ。
  function scheduleDiscussionTimer(room) {
    clearDiscussionTimer(room.code);
    const ms =
      discussTimeoutMs !== undefined
        ? discussTimeoutMs
        : (Number(room.game.settings?.discussTimer) || 0) * 1000;
    if (ms <= 0) return;
    const timer = setTimeout(() => {
      discussionTimers.delete(room.code);
      endDiscussionForRoom(room);
    }, ms);
    timer.unref();
    discussionTimers.set(room.code, timer);
  }

  // 議論を開始し、CPU の発言イベントを部屋の各ソケットへ席ごとに送る
  // （view が席ごとに違うため broadcast は使わない。発言イベント自体は
  // 公開情報で全席共通）。タイマーもここで回す。
  function startDiscussionForRoom(room) {
    if (!room.game || room.game.phase !== "morning") return;
    const events = startDiscussion(room.game, random);
    if (!events) return;
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = discussionStartedMessage(room.game, events, player.id);
      if (msg) sendJson(socket, msg);
    }
    scheduleDiscussionTimer(room);
  }

  // 議論を終え、投票フェーズへ移す。view を席ごとに送る。
  function endDiscussionForRoom(room) {
    clearDiscussionTimer(room.code);
    if (!room.game || room.game.phase !== "discussion") return;
    room.game.phase = "vote";
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = discussionEndedMessage(room.game, player.id);
      if (msg) sendJson(socket, msg);
    }
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
      const reply = {
        type: "reconnected",
        code: room.code,
        token: player.token,
        playerId: player.id,
        name: player.name,
        icon: player.icon,
        players: rooms.publicPlayers(room),
      };
      // 試合中の再接続には現在の player view を再送して復帰させる（§7）。
      if (room.game) reply.view = playerView(room.game, player.id);
      sendJson(socket, reply);
      broadcast(room.code, roomUpdate(room));
      return;
    }
    if (msg.type === "startGame") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const error = validateStart(room, player ? player.id : -1);
      if (error) {
        sendJson(socket, { type: "error", error });
        return;
      }
      room.game = createGame(room.code, room.players, undefined, random);
      sendGameStarted(room);
      // 夜の締め切りタイマーを回す。誰も夜入力がいらない配役なら
      // すぐ解決する（待っても誰も送ってこないため）。
      scheduleNightTimer(room);
      if (nightInputsComplete(room.game)) resolveNightForRoom(room);
      return;
    }
    if (msg.type === "nightAction") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const error = submitNightAction(room && room.game, player ? player.id : -1, msg.targetId);
      if (error) {
        sendJson(socket, { type: "error", error });
        return;
      }
      sendJson(socket, { type: "nightActionAccepted", targetId: msg.targetId });
      if (nightInputsComplete(room.game)) resolveNightForRoom(room);
      return;
    }
    if (msg.type === "talk") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const talk = submitTalk(room && room.game, player ? player.id : -1, {
        phraseId: msg.phraseId,
        targetId: msg.targetId,
        text: msg.text,
      });
      if (typeof talk === "string") {
        sendJson(socket, { type: "error", error: talk });
        return;
      }
      // 発言は公開情報なので部屋の全員へ同じものを配信する。
      const out = talkBroadcast(room.game, talk);
      if (out) broadcast(room.code, out);
      return;
    }
    if (msg.type === "discussionDone") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const error = markDiscussionDone(room && room.game, player ? player.id : -1);
      if (error) {
        sendJson(socket, { type: "error", error });
        return;
      }
      sendJson(socket, { type: "discussionDoneAccepted" });
      if (discussionComplete(room.game)) endDiscussionForRoom(room);
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
        if (room) {
          // 切断中の人間は「未入力＝行動しない」扱い（§7）。議論中なら
          // その席を議論済みにして、タイマーなしでも議論が止まらない
          // ようにする。戻ってきたら reconnect で現在の view を再送する。
          if (room.game && room.game.phase === "discussion") {
            const player = room.players.find((p) => p.token === socket._token);
            if (player) {
              markDiscussionDone(room.game, player.id);
              if (discussionComplete(room.game)) endDiscussionForRoom(room);
            }
          }
          broadcast(socket._roomCode, roomUpdate(room));
        }
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
