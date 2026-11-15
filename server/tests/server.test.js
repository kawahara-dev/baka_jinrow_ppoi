// 実行方法: リポジトリのルートで `node --test server/tests/server.test.js`
// 最小サーバー（server/server.js）の通しテスト。実際に HTTP + WebSocket で
// 接続し、部屋の作成/参加・セッショントークン・キャラ割当を確認する。
// Node 24 の組み込み WebSocket クライアントを使う。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

// 次に届くメッセージを1件待つ。
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("message", function handler(event) {
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(event.data));
    });
  });
}

async function withServer(fn) {
  const server = createServer();
  const port = await listen(server);
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("静的配信：/ は index.html、/game-logic.js は共有モジュールを返す", async () => {
  await withServer(async (port) => {
    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /text\/html/);
    const indexText = await index.text();
    assert.match(indexText, /FakeBloomLogic/);

    const logic = await fetch(`http://127.0.0.1:${port}/game-logic.js`);
    assert.equal(logic.status, 200);
    assert.match(await logic.text(), /FakeBloomLogic/);
  });
});

test("静的配信：server/ 配下と存在しないファイルは 404 になる", async () => {
  await withServer(async (port) => {
    const serverFile = await fetch(`http://127.0.0.1:${port}/server/server.js`);
    assert.equal(serverFile.status, 404);
    const missing = await fetch(`http://127.0.0.1:${port}/no-such-file.js`);
    assert.equal(missing.status, 404);
  });
});

test("WebSocket で部屋を作れる。作成者はルナでトークンが返る", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "createRoom" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "roomCreated");
      assert.equal(msg.code.length, 4);
      assert.equal(msg.playerId, 0);
      assert.equal(msg.name, "ルナ");
      assert.equal(typeof msg.token, "string");
      assert.ok(msg.token.length > 0);
      assert.deepEqual(msg.players, [{ id: 0, name: "ルナ", icon: "🌸", connected: true }]);
    } finally {
      ws.close();
    }
  });
});

test("2人目がコードで参加するとミオになり、両方に roomUpdate が届く", async () => {
  await withServer(async (port) => {
    const host = await connectWs(port);
    const guest = await connectWs(port);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await nextMessage(host);
      // ホスト側の roomUpdate は参加時に届くので先に購読しておく。
      const hostUpdate = nextMessage(host);
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      const joined = await nextMessage(guest);
      assert.equal(joined.type, "roomJoined");
      assert.equal(joined.code, created.code);
      assert.equal(joined.playerId, 1);
      assert.equal(joined.name, "ミオ");
      assert.notEqual(joined.token, created.token);
      assert.equal(joined.players.length, 2);

      const update = await hostUpdate;
      assert.equal(update.type, "roomUpdate");
      assert.equal(update.players.length, 2);
      assert.deepEqual(
        update.players.map((p) => p.name),
        ["ルナ", "ミオ"]
      );
      assert.equal("token" in update.players[0], false);
    } finally {
      host.close();
      guest.close();
    }
  });
});

test("存在しないコードへの参加は error になる", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "joinRoom", code: "ZZZZ" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "error");
      assert.equal(msg.error, "room_not_found");
    } finally {
      ws.close();
    }
  });
});

test("切断後にセッショントークンで同じ席へ再接続できる", async () => {
  await withServer(async (port) => {
    const first = await connectWs(port);
    first.send(JSON.stringify({ type: "createRoom" }));
    const created = await nextMessage(first);
    first.close();
    // 切断がサーバーへ伝わるのを少し待つ。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const again = await connectWs(port);
    try {
      again.send(JSON.stringify({ type: "reconnect", code: created.code, token: created.token }));
      const msg = await nextMessage(again);
      assert.equal(msg.type, "reconnected");
      assert.equal(msg.playerId, 0);
      assert.equal(msg.name, "ルナ");
      assert.equal(msg.players[0].connected, true);
    } finally {
      again.close();
    }
  });
});

test("不正な JSON と未知の type は error になる（接続は維持される）", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send("not json");
      assert.equal((await nextMessage(ws)).error, "bad_json");
      ws.send(JSON.stringify({ type: "startGame" }));
      assert.equal((await nextMessage(ws)).error, "unknown_type");
      ws.send(JSON.stringify({ type: "createRoom" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "roomCreated");
    } finally {
      ws.close();
    }
  });
});
