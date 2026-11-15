// 実行方法: リポジトリのルートで `node --test server/tests/game.test.js`
// 配役（server/game.js）とプレイヤー別ビュー（秘匿）のテスト。
// 秘匿の要：player view の JSON には他人の実役職・うっかり flag・
// トークンが含まれてはならない。バカには表示役職だけが送られる。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGame,
  validateStart,
  playerView,
  MIN_PLAYERS_TO_START,
} = require("../game.js");

// 決定的な乱数源（mulberry32）。seed を変えて何通りかの配役を試す。
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function twoHumans() {
  return [
    { id: 0, name: "ルナ", icon: "🌸" },
    { id: 1, name: "ミオ", icon: "🪄" },
  ];
}

// seed をずらして、人間の席にバカが来る試合を探す。
function gameWithHumanBaka() {
  for (let seed = 1; seed < 200; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    const bakaSeat = game.players.find((p) => p.roleKey === "baka");
    if (bakaSeat && bakaSeat.id < 2) return { game, bakaSeat };
  }
  throw new Error("human baka game not found in 200 seeds");
}

// seed をずらして、人間の席にインポスターが来る試合を探す。
function gameWithHumanImpostor() {
  for (let seed = 1; seed < 200; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    const impSeat = game.players.find(
      (p) => p.id < 2 && (p.roleKey === "fakeGirl" || p.roleKey === "mimic")
    );
    if (impSeat) return { game, impSeat };
  }
  throw new Error("human impostor game not found in 200 seeds");
}

test("配役：8席に役職が配られ、バカ1・占い師1・インポスター1〜2人になる", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(42));
  assert.equal(game.players.length, 8);
  assert.equal(game.phase, "night");
  assert.equal(game.day, 1);
  const roles = game.players.map((p) => p.roleKey);
  assert.equal(roles.filter((r) => r === "baka").length, 1);
  assert.equal(roles.filter((r) => r === "apprenticeSeer").length, 1);
  const impostors = roles.filter((r) => r === "fakeGirl" || r === "mimic");
  assert.ok(impostors.length === 1 || impostors.length === 2);
  // 人間の席は部屋の名前・アイコン、残りは CPU 席。
  assert.equal(game.players[0].name, "ルナ");
  assert.equal(game.players[1].name, "ミオ");
  assert.equal(game.players[0].isCpu, false);
  assert.equal(game.players[1].isCpu, false);
  assert.equal(game.players.filter((p) => p.isCpu).length, 6);
  assert.equal(game.players[2].name, "ユイ");
  assert.equal(game.players.every((p) => p.alive), true);
  assert.equal(game.players.every((p) => p.publicRoleKey === null), true);
});

test("バカの view：表示役職だけが送られ、実役職・うっかり flag は含まれない", () => {
  const { game, bakaSeat } = gameWithHumanBaka();
  const view = playerView(game, bakaSeat.id);
  assert.equal(view.me.roleKey, bakaSeat.fakeDisplayRoleKey);
  assert.notEqual(view.me.roleKey, "baka");
  const json = JSON.stringify(view);
  assert.equal(json.includes("baka"), false);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("fakeDisplayRoleKey"), false);
  assert.equal(json.includes("token"), false);
  // 表示役職の名前・陣営が見える（本人はその役職だと思っている）。
  assert.equal(view.me.roleName.length > 0, true);
  assert.equal(view.me.faction, "イノセント");
  // 仲間情報はない（バカはインポスターではない）。
  assert.deepEqual(view.me.allies, []);
});

test("インポスターの view：仲間は名前だけで、他人の役職キーは含まれない", () => {
  const { game, impSeat } = gameWithHumanImpostor();
  const view = playerView(game, impSeat.id);
  const otherImpostor = game.players.find(
    (p) => p.id !== impSeat.id && (p.roleKey === "fakeGirl" || p.roleKey === "mimic")
  );
  if (otherImpostor) {
    assert.equal(view.me.allies.length, 1);
    assert.equal(view.me.allies[0].name, otherImpostor.name);
    assert.equal("roleKey" in view.me.allies[0], false);
  } else {
    assert.deepEqual(view.me.allies, []);
  }
  // players 一覧に役職キーのフィールドは一切ない。
  assert.equal(view.players.every((p) => !("roleKey" in p)), true);
  const json = JSON.stringify(view);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("token"), false);
});

test("イノセントの view：他人の役職も仲間も見えない", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(7));
  const innocent = game.players.find(
    (p) => p.id < 2 && !["baka", "fakeGirl", "mimic", "bomber"].includes(p.roleKey)
  );
  assert.ok(innocent, "human innocent seat expected");
  const view = playerView(game, innocent.id);
  assert.equal(view.me.roleKey, innocent.roleKey);
  assert.deepEqual(view.me.allies, []);
  assert.equal(view.players.length, 8);
  assert.equal(view.players.filter((p) => p.isCpu).length, 6);
  assert.equal(view.players.every((p) => !("roleKey" in p)), true);
  const json = JSON.stringify(view);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("token"), false);
});

test("CPU 席の役職はサーバー内にだけあり、どの view にも出ない", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(99));
  assert.equal(game.players.filter((p) => p.isCpu).length, 6);
  for (const human of [0, 1]) {
    const view = playerView(game, human);
    assert.equal(view.players.every((p) => !("roleKey" in p)), true);
    assert.equal(JSON.stringify(view).includes("clumsy"), false);
  }
});

test("playerView：存在しない席は null", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(3));
  assert.equal(playerView(game, 99), null);
});

test("validateStart：ホスト以外・人数不足・開始済みはエラー、条件を満たせば null", () => {
  const room = { code: "ABCD", players: twoHumans(), game: null };
  assert.equal(validateStart(room, 0), null);
  assert.equal(validateStart(room, 1), "not_host");
  assert.equal(validateStart({ code: "ABCD", players: [twoHumans()[0]], game: null }, 0), "not_enough_players");
  assert.equal(validateStart({ code: "ABCD", players: twoHumans(), game: {} }, 0), "game_already_started");
  assert.equal(validateStart(null, 0), "room_not_found");
  assert.equal(MIN_PLAYERS_TO_START, 2);
});
