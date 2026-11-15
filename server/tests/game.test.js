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
  needsNightInput,
  submitNightAction,
  nightInputsComplete,
  resolveNight,
  nightResolvedMessage,
  MIN_PLAYERS_TO_START,
  NIGHT_TIMEOUT_MS,
} = require("../game.js");
const { ROLES, getEffectiveRoleKey } = require("../../game-logic.js");

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

// seed 2：人間は占い師（id 0）と罠師（id 1）で、両方とも夜入力が必要。
function gameBothNeedInput() {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(2));
  assert.equal(game.players[0].roleKey, "apprenticeSeer");
  assert.equal(game.players[1].roleKey, "trapper");
  return game;
}

// seed 3：人間は政治家（id 0）とネズミ（id 1）で、どちらも夜入力は不要。
function gameNobodyNeedsInput() {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(3));
  assert.equal(game.players[0].roleKey, "politician");
  assert.equal(game.players[1].roleKey, "mouse");
  return game;
}

test("needsNightInput：夜行動のある人間の席だけが true（CPU・能力なし・死亡は false）", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    for (const p of game.players) {
      const expected =
        !p.isCpu &&
        p.alive &&
        (["fakeGirl", "mimic"].includes(p.roleKey) ||
          (!["fakeGirl", "mimic"].includes(getEffectiveRoleKey(p)) &&
            !!ROLES[getEffectiveRoleKey(p)]?.nightAction));
      assert.equal(needsNightInput(game, p.id), expected, `seed ${seed} seat ${p.id} (${p.roleKey})`);
    }
    // 死亡した席は入力不要になる。
    game.players[0].alive = false;
    assert.equal(needsNightInput(game, 0), false);
  }
  assert.equal(needsNightInput(gameBothNeedInput(), 99), false);
});

test("submitNightAction：対象の検証と上書き、夜行動なし・CPU・試合なしはエラー", () => {
  const game = gameBothNeedInput();
  // 占い師は自分を選べない。
  assert.equal(submitNightAction(game, 0, 0), "invalid_target");
  assert.equal(submitNightAction(game, 0, 99), "invalid_target");
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(game.pnpNightInputs[0], 2);
  // 送り直すと上書きされる。
  assert.equal(submitNightAction(game, 0, 3), null);
  assert.equal(game.pnpNightInputs[0], 3);
  // 罠師は自分を選べる（allowSelf: true）。
  assert.equal(submitNightAction(game, 1, 1), null);
  // CPU 席は夜入力を送れない。
  assert.equal(submitNightAction(game, 5, 2), "not_a_player");
  // 夜行動のない人間は送れない。
  const calm = gameNobodyNeedsInput();
  assert.equal(submitNightAction(calm, 0, 2), "no_night_action");
  assert.equal(submitNightAction(calm, 1, 2), "no_night_action");
  // 試合なし。
  assert.equal(submitNightAction(null, 0, 2), "no_game");
});

test("nightInputsComplete と resolveNight：全員分が揃うと夜が解決して朝になる", () => {
  const game = gameBothNeedInput();
  assert.equal(nightInputsComplete(game), false);
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(nightInputsComplete(game), false);
  assert.equal(submitNightAction(game, 1, 3), null);
  assert.equal(nightInputsComplete(game), true);

  const result = resolveNight(game, seededRandom(100));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  assert.ok(["eliminated", "blocked", "none", "revived"].includes(result.report.type));
  assert.ok(Array.isArray(result.publicLogs));
  // 個人ログは人間の席にだけ付く（CPU の夜結果はサーバー内に留まる）。
  assert.equal(Object.keys(result.privateLogs).every((id) => ["0", "1"].includes(id)), true);
  // 二重解決はできない。
  assert.equal(resolveNight(game, seededRandom(100)), null);
  assert.equal(game.phase, "morning");
  // 夜が明けたら夜入力は受け付けない。
  assert.equal(submitNightAction(game, 0, 2), "not_night");
  // 夜に倒れた者の役職は view で公開される。
  for (const p of game.players) {
    if (!p.alive) assert.notEqual(p.publicRoleKey, null);
  }
  // 席ごとの nightResolved：個人ログはその席の分だけ、秘匿漏れなし。
  for (const id of [0, 1]) {
    const msg = nightResolvedMessage(game, result, id);
    assert.equal(msg.type, "nightResolved");
    assert.equal(msg.view.phase, "morning");
    assert.equal(msg.night.privateLog, result.privateLogs[id] || null);
    const json = JSON.stringify(msg);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
    // 他人の個人ログが混ざっていない（違う文言のときだけ判定できる）。
    const other = result.privateLogs[id === 0 ? 1 : 0];
    if (other && other !== result.privateLogs[id]) {
      assert.equal(JSON.stringify(msg.night).includes(other), false);
    }
  }
  assert.equal(nightResolvedMessage(game, result, 99), null);
  assert.equal(NIGHT_TIMEOUT_MS, 60000);
});

test("resolveNight：誰も夜入力がいらない配役でも解ける（開始直後の即解決）", () => {
  const game = gameNobodyNeedsInput();
  assert.equal(nightInputsComplete(game), true);
  const result = resolveNight(game, seededRandom(100));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  assert.ok(["eliminated", "blocked", "none", "revived"].includes(result.report.type));
});

test("resolveNight：インポスター人間の入力が襲撃先になる", () => {
  const { game, impSeat } = gameWithHumanImpostor();
  const otherHuman = game.players.find((p) => p.id < 2 && p.id !== impSeat.id);
  assert.ok(otherHuman, "second human seat expected");
  const victim = game.players.find(
    (p) => p.alive && p.id !== impSeat.id && !["fakeGirl", "mimic"].includes(p.roleKey)
  );
  assert.ok(victim, "a living non-impostor victim is expected");
  assert.equal(submitNightAction(game, impSeat.id, victim.id), null);
  const result = resolveNight(game, seededRandom(77));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  // 人間インポスター（代表者）の入力がそのまま襲撃先になった。
  assert.equal(game.nightActions[impSeat.id], victim.id);
});
