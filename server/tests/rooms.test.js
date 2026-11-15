// 実行方法: リポジトリのルートで `node --test server/tests/rooms.test.js`
// 部屋とセッションの管理（server/rooms.js）のテスト。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoomStore, MAX_PLAYERS, ROOM_CODE_LENGTH } = require("../rooms.js");
const { PLAYER_NAMES } = require("../../game-logic.js");

function deterministicStore() {
  let counter = 0;
  return createRoomStore({
    randomBytes: (n) => Buffer.from(Array.from({ length: n }, (_, i) => counter + i)),
    randomUUID: () => `token-${counter++}`,
    now: () => 1000,
  });
}

test("部屋を作ると 4 文字のコードが発行され、最初の参加者はルナになる", () => {
  const store = deterministicStore();
  const { room, player } = store.createRoom();
  assert.equal(room.code.length, ROOM_CODE_LENGTH);
  assert.match(room.code, /^[A-Z2-9]+$/);
  assert.equal(player.id, 0);
  assert.equal(player.name, "ルナ");
  assert.equal(player.icon, "🌸");
  assert.equal(typeof player.token, "string");
  assert.ok(player.token.length > 0);
});

test("参加は入室順にキャラが割り当てられる（2人目はミオ）", () => {
  const store = deterministicStore();
  const { room } = store.createRoom();
  const { player } = store.joinRoom(room.code);
  assert.equal(player.id, 1);
  assert.equal(player.name, "ミオ");
  assert.equal(player.icon, "🪄");
});

test("参加コードは小文字・前後の空白でも通る", () => {
  const store = deterministicStore();
  const { room } = store.createRoom();
  const result = store.joinRoom(` ${room.code.toLowerCase()} `);
  assert.equal(result.error, undefined);
  assert.equal(result.player.id, 1);
});

test("存在しない部屋への参加は room_not_found になる", () => {
  const store = deterministicStore();
  assert.equal(store.joinRoom("ZZZZ").error, "room_not_found");
  assert.equal(store.reconnect("ZZZZ", "token-0").error, "room_not_found");
});

test("8人で満員になると room_full になる", () => {
  const store = deterministicStore();
  const { room } = store.createRoom();
  for (let i = 1; i < MAX_PLAYERS; i++) {
    const result = store.joinRoom(room.code);
    assert.equal(result.error, undefined);
  }
  assert.equal(store.joinRoom(room.code).error, "room_full");
  assert.equal(store.publicPlayers(room).length, MAX_PLAYERS);
  assert.deepEqual(
    store.publicPlayers(room).map((p) => p.name),
    PLAYER_NAMES
  );
});

test("セッショントークンで再接続できる。違うトークンは bad_token", () => {
  const store = deterministicStore();
  const { room, player } = store.createRoom();
  store.disconnect(room.code, player.token);
  assert.equal(store.getRoom(room.code).players[0].connected, false);
  const ok = store.reconnect(room.code, player.token);
  assert.equal(ok.error, undefined);
  assert.equal(ok.player.id, 0);
  assert.equal(store.getRoom(room.code).players[0].connected, true);
  assert.equal(store.reconnect(room.code, "wrong-token").error, "bad_token");
});

test("公開する参加者一覧にトークンは含まれない", () => {
  const store = deterministicStore();
  const { room } = store.createRoom();
  store.joinRoom(room.code);
  const list = store.publicPlayers(room);
  assert.equal(list.length, 2);
  for (const p of list) {
    assert.equal("token" in p, false);
    assert.deepEqual(Object.keys(p).sort(), ["connected", "icon", "id", "name"]);
  }
});

test("2つの部屋のトークンは重ならない", () => {
  const store = deterministicStore();
  const a = store.createRoom();
  const b = store.createRoom();
  assert.notEqual(a.player.token, b.player.token);
  assert.notEqual(a.room.code, b.room.code);
});
