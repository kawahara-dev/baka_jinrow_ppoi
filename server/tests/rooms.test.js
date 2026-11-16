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

test("部屋作成時にホストの初期設定が使われ、不正な値は既定値に戻る", () => {
  const store = deterministicStore();
  const { room } = store.createRoom({ fakeCount: "1", bomber: "on", difficulty: "hard", discussTimer: "120" });
  assert.deepEqual(room.settings, { fakeCount: "1", bomber: "on", difficulty: "hard", discussTimer: "120" });
  const { room: room2 } = store.createRoom({ fakeCount: "3", bomber: "maybe", difficulty: "extreme", discussTimer: "90", sound: "off" });
  assert.deepEqual(room2.settings, { fakeCount: "random", bomber: "random", difficulty: "normal", discussTimer: "0" });
  const { room: room3 } = store.createRoom();
  assert.deepEqual(room3.settings, { fakeCount: "random", bomber: "random", difficulty: "normal", discussTimer: "0" });
});

test("setRoomSettings は部屋設定を検証して反映する。指定のないキーは今のまま", () => {
  const store = deterministicStore();
  const { room } = store.createRoom({ fakeCount: "1", bomber: "off", difficulty: "hard", discussTimer: "120" });
  const next = store.setRoomSettings(room, { fakeCount: "2" });
  assert.deepEqual(next, { fakeCount: "2", bomber: "off", difficulty: "hard", discussTimer: "120" });
  assert.deepEqual(room.settings, next);
  // 許容外の値はそのキーだけ既定値に戻る（README どおり）。
  const next2 = store.setRoomSettings(room, { fakeCount: "3", difficulty: "easy" });
  assert.deepEqual(next2, { fakeCount: "random", bomber: "off", difficulty: "easy", discussTimer: "120" });
});

// ロビーでのホスト移譲（フェーズ3 第4歩：ホスト退出の整備）。
// ホストが抜けたら、つながっている参加者の中で一番若い席がホストになる。
test("部屋を作るとホストは id 0 になる", () => {
  const store = deterministicStore();
  const { room } = store.createRoom();
  assert.equal(room.hostId, 0);
});

test("ロビーでホストが切断すると、つながっている一番若い席へホストが移る", () => {
  const store = deterministicStore();
  const { room, player: host } = store.createRoom();
  const second = store.joinRoom(room.code).player;
  const third = store.joinRoom(room.code).player;
  store.disconnect(room.code, host.token);
  assert.equal(room.hostId, 1);
  // ホスト以外が抜けてもホストは変わらない。
  store.disconnect(room.code, third.token);
  assert.equal(room.hostId, 1);
  // 新ホストが抜けたら、残っている一番若い席へさらに移る。
  // 誰も残っていなければ今のまま（元のホストが戻ればまたホスト）。
  store.disconnect(room.code, second.token);
  assert.equal(room.hostId, 1);
});

test("誰もつながっていなければホストは今のまま。元のホストが戻ればまたホストになる", () => {
  const store = deterministicStore();
  const { room, player: host } = store.createRoom();
  store.disconnect(room.code, host.token);
  assert.equal(room.hostId, 0);
  const ok = store.reconnect(room.code, host.token);
  assert.equal(ok.error, undefined);
  assert.equal(room.hostId, 0);
});

test("移ったあと元のホストが戻ってきても、ホストは戻らない", () => {
  const store = deterministicStore();
  const { room, player: host } = store.createRoom();
  store.joinRoom(room.code);
  store.disconnect(room.code, host.token);
  assert.equal(room.hostId, 1);
  const ok = store.reconnect(room.code, host.token);
  assert.equal(ok.error, undefined);
  assert.equal(room.hostId, 1);
});

test("試合中はホストが切断してもホストは移らない（試合はサーバー側で続く）", () => {
  const store = deterministicStore();
  const { room, player: host } = store.createRoom();
  store.joinRoom(room.code);
  room.game = { phase: "night" };
  store.disconnect(room.code, host.token);
  assert.equal(room.hostId, 0);
});
