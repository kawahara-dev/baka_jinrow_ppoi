// Fake Bloom オンライン対戦 フェーズ1：最小サーバー。
// Node 標準のみ（http / fs / path / crypto）。依存パッケージなし。
// - 静的ファイル配信：リポジトリ直下の index.html / game-logic.js 等を配る
//   （フェーズ2でクライアントがここへ接続する準備）。server/ と .git は配らない。
// - WebSocket（/ws）：部屋の作成/参加、セッショントークンでの再接続、
//   配役とプレイヤー別ビューの配信、夜フェーズ（夜入力の収集・
//   タイムアウト・夜の解決と結果配信）、議論フェーズ（CPU の発言・
//   人間の定型文＋自由入力・議論の終了と投票への遷移）、投票フェーズ
//   （投票の収集・タイムアウト・集計と追放・勝敗・結果開示）。
//   夜の解決でも決着すればそのまま試合終了になる。
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
  submitMouseReveal,
  mouseRevealBroadcast,
  submitTalk,
  markDiscussionDone,
  clearDiscussionDone,
  discussionComplete,
  discussionStartedMessage,
  talkBroadcast,
  discussionEndedMessage,
  checkWin,
  endGame,
  submitVote,
  markVoteAbstained,
  clearVoteAbstained,
  votesComplete,
  resolveVote,
  voteResolvedMessage,
  gameEndedMessage,
  NIGHT_TIMEOUT_MS,
  VOTE_TIMEOUT_MS,
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
  // 投票タイマーの上書き（テスト用）。未指定なら夜と同じ目安60秒。
  const voteTimeoutMs = options.voteTimeoutMs || VOTE_TIMEOUT_MS;
  // 議論タイマーの上書き（テスト用）。未指定なら設定の discussTimer
  // （秒。DEFAULT_SETTINGS は "0"＝タイマーなし）を使う。
  const discussTimeoutMs = options.discussTimeoutMs;
  // 部屋コード → その部屋に繋がっているソケットの集合。
  const roomSockets = new Map();
  const sockets = new Set();
  // 部屋コード → 夜の締め切りタイマー。unref しておく（テストで
  // サーバーを閉じたあと、残ったタイマーがプロセスを止めないため）。
  const nightTimers = new Map();
  // 部屋コード → 投票の締め切りタイマー（夜と同じく unref 付き）。
  const voteTimers = new Map();
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
    return {
      type: "roomUpdate",
      code: room.code,
      players: rooms.publicPlayers(room),
      settings: room.settings,
    };
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
  // 夜の解決で決着したら試合終了（結果開示）になり、続くならすぐ
  // 議論を開始する（朝の報告を読んでから議論へ）。
  function resolveNightForRoom(room) {
    clearNightTimer(room.code);
    if (!room.game || room.game.phase !== "night") return;
    const result = resolveNight(room.game, random);
    if (!result) return;
    // 夜の解決で決着したら先に試合終了にしておく（nightResolved の
    // view も phase "end" になる）。続くなら議論を開始する。
    const winText = checkWin(room.game);
    if (winText) endGame(room.game, winText);
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = nightResolvedMessage(room.game, result, player.id);
      if (msg) sendJson(socket, msg);
    }
    if (winText) {
      sendGameEnded(room);
      return;
    }
    startDiscussionForRoom(room);
  }

  // 試合終了を部屋の各ソケットへ席ごとに送る（結果は席ごとに違う
  // view と同じく、gameEndedMessage が席ごとに組み立てる）。
  function sendGameEnded(room) {
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = gameEndedMessage(room.game, player.id);
      if (msg) sendJson(socket, msg);
    }
  }

  function clearVoteTimer(roomCode) {
    const timer = voteTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      voteTimers.delete(roomCode);
    }
  }

  function scheduleVoteTimer(room) {
    clearVoteTimer(room.code);
    const timer = setTimeout(() => {
      voteTimers.delete(room.code);
      resolveVoteForRoom(room);
    }, voteTimeoutMs);
    timer.unref();
    voteTimers.set(room.code, timer);
  }

  // 投票を集計し、結果を部屋の各ソケットへ席ごとに送る。
  // 決着したら試合終了（結果開示）になり、続くなら翌日の夜へ進む
  // （夜の締め切りタイマーを回し、誰も夜入力がいらなければすぐ解決）。
  function resolveVoteForRoom(room) {
    clearVoteTimer(room.code);
    if (!room.game || room.game.phase !== "vote") return;
    const result = resolveVote(room.game, random);
    if (!result) return;
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = result.ended
        ? gameEndedMessage(room.game, player.id)
        : voteResolvedMessage(room.game, result, player.id);
      if (msg) sendJson(socket, msg);
    }
    if (result.ended) return;
    scheduleNightTimer(room);
    if (nightInputsComplete(room.game)) resolveNightForRoom(room);
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
  // 公開情報で全席共通）。タイマーもここで回す。生存中の人間が
  // いなければ、議論は始まった時点で終わっている（誰も discussionDone
  // を送れないため、タイマーなしではここで止まってしまう）ので、夜の
  // 即解決と同じくすぐ投票へ進める。夜の途中で切断したままの人間も
  // ここで議論済み扱いにする（§7：切断中は「未入力＝行動しない」。
  // startDiscussion が discussionDone を作り直すため、切断時の印だけ
  // では残らない。戻ってきたら reconnect で外れる）。
  function startDiscussionForRoom(room) {
    if (!room.game || room.game.phase !== "morning") return;
    const events = startDiscussion(room.game, random);
    if (!events) return;
    for (const p of room.players) {
      if (!p.connected) markDiscussionDone(room.game, p.id);
    }
    const set = roomSockets.get(room.code);
    if (!set) return;
    for (const socket of set) {
      const player = room.players.find((p) => p.token === socket._token);
      if (!player) continue;
      const msg = discussionStartedMessage(room.game, events, player.id);
      if (msg) sendJson(socket, msg);
    }
    scheduleDiscussionTimer(room);
    if (discussionComplete(room.game)) endDiscussionForRoom(room);
  }

  // 議論を終え、投票フェーズへ移す。view を席ごとに送る。
  // 投票の締め切りタイマーもここで回す。生存中の人間がいなければ、
  // 投票は始まった時点で揃っている（誰も vote を送れないため、60秒の
  // タイマーまで待ってしまう）ので、夜・議論の即解決と同じくすぐ集計する。
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
    scheduleVoteTimer(room);
    if (votesComplete(room.game)) resolveVoteForRoom(room);
  }

  function handleMessage(socket, msg) {
    if (!msg || typeof msg.type !== "string") {
      sendJson(socket, { type: "error", error: "bad_message" });
      return;
    }
    if (msg.type === "createRoom") {
      const { room, player } = rooms.createRoom(msg.settings);
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
        settings: room.settings,
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
        settings: room.settings,
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
        settings: room.settings,
      };
      // 議論中の再接続では議論済み扱いを外し、戻ってきたらまた議論に参加できる。
      if (room.game && room.game.phase === "discussion") {
        clearDiscussionDone(room.game, player.id);
      }
      // 投票中の再接続では棄権扱いを外し、戻ってきたらまた投票できる。
      if (room.game && room.game.phase === "vote") {
        clearVoteAbstained(room.game, player.id);
      }
      // 試合中の再接続には現在の player view を再送して復帰させる（§7）。
      if (room.game) reply.view = playerView(room.game, player.id);
      sendJson(socket, reply);
      broadcast(room.code, roomUpdate(room));
      return;
    }
    // 部屋設定の同期（フェーズ2 第1歩）。ホストだけが、試合開始前に
    // 変えられる。値は検証して許容外は既定値に戻し、部屋の全員へ
    // 設定付きの roomUpdate を配信する。
    if (msg.type === "setSettings") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      if (!player) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      if (room.game) {
        sendJson(socket, { type: "error", error: "game_already_started" });
        return;
      }
      if (player.id !== 0) {
        sendJson(socket, { type: "error", error: "not_host" });
        return;
      }
      rooms.setRoomSettings(room, msg.settings);
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
      // 部屋設定（ホストが決めたもの）で配役する。未指定の部屋は
      // createRoom 時に既定値が入っている。
      room.game = createGame(room.code, room.players, room.settings, random);
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
    if (msg.type === "mouseReveal") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const event = submitMouseReveal(room && room.game, player ? player.id : -1, msg.targetId, random);
      if (typeof event === "string") {
        sendJson(socket, { type: "error", error: event });
        return;
      }
      // マウス公開は公開情報なので部屋の全員へ同じものを配信する
      // （CPU のマウス公開と同じ形。送った本人にも届く）。
      const out = mouseRevealBroadcast(room.game, event);
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
    if (msg.type === "vote") {
      if (!socket._roomCode) {
        sendJson(socket, { type: "error", error: "not_in_room" });
        return;
      }
      const room = rooms.getRoom(socket._roomCode);
      const player = room && room.players.find((p) => p.token === socket._token);
      const error = submitVote(room && room.game, player ? player.id : -1, msg.targetId);
      if (error) {
        sendJson(socket, { type: "error", error });
        return;
      }
      sendJson(socket, { type: "voteAccepted", targetId: msg.targetId });
      if (votesComplete(room.game)) resolveVoteForRoom(room);
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
          // ようにする。投票中ならその席を棄権扱いにして、残りの投票
          // で集計が進むようにする。戻ってきたら reconnect で現在の
          // view を再送する（投票中なら棄権扱いを外してまた投票できる）。
          if (room.game && room.game.phase === "discussion") {
            const player = room.players.find((p) => p.token === socket._token);
            if (player) {
              markDiscussionDone(room.game, player.id);
              if (discussionComplete(room.game)) endDiscussionForRoom(room);
            }
          }
          if (room.game && room.game.phase === "vote") {
            const player = room.players.find((p) => p.token === socket._token);
            if (player) {
              markVoteAbstained(room.game, player.id);
              if (votesComplete(room.game)) resolveVoteForRoom(room);
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
