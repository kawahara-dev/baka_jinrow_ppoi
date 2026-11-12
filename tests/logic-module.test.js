// game-logic.js（オンライン対戦フェーズ0の共有モジュール）のテスト。
// 依存なし（Node 18+ の node:test を使用）。
// 実行方法: リポジトリのルートで `node --test tests/logic-module.test.js`
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../game-logic.js");
const { loadGame } = require("./harness");

const BASE_SETTINGS = { fakeCount: "2", bomber: "off", sound: "off", difficulty: "normal" };

test("game-logic.js は DOM なしの素の Node で require できる", () => {
  assert.equal(typeof Logic, "object");
  assert.equal(typeof Logic.ROLES, "object");
});

test("ROLES は14役職で、各役職に表示に必要な項目が揃っている", () => {
  const keys = Object.keys(Logic.ROLES);
  assert.equal(keys.length, 14);
  for (const key of keys) {
    const r = Logic.ROLES[key];
    for (const field of ["name", "icon", "faction", "desc", "nightActionHint", "resultInterpretation", "riskNote"]) {
      assert.equal(typeof r[field], "string", `${key}.${field} は文字列`);
      assert.ok(r[field].length > 0, `${key}.${field} は空でない`);
    }
    assert.ok(["イノセント", "インポスター", "ニュートラル"].includes(r.faction), `${key} の陣営はどれか`);
    assert.ok("nightAction" in r, `${key} に nightAction がある`);
  }
  assert.ok("baka" in Logic.ROLES, "バカがいる");
  assert.equal(Logic.ROLES.baka.faction, "イノセント");
});

test("キャラ8人分の名前・絵文字・スラッグが揃っている", () => {
  assert.equal(Logic.PLAYER_NAMES.length, 8);
  assert.equal(Logic.PLAYER_ICONS.length, 8);
  assert.equal(Logic.ICON_SLUGS.length, 8);
  assert.equal(new Set(Logic.PLAYER_NAMES).size, 8, "名前は重複なし");
  assert.equal(new Set(Logic.ICON_SLUGS).size, 8, "スラッグは重複なし");
  assert.equal(Logic.PLAYER_NAMES[0], "ルナ");
  assert.equal(Logic.ICON_SLUGS[0], "luna");
});

test("PHASE_META は5フェーズ分のラベルとボタン文言を持つ", () => {
  for (const phase of ["night", "morning", "discussion", "vote", "end"]) {
    assert.equal(typeof Logic.PHASE_META[phase].label, "string");
    assert.equal(typeof Logic.PHASE_META[phase].button, "string");
  }
});

test("getEffectiveRoleKey / getPublicRoleKey：バカは表示役職、それ以外は実役職", () => {
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }), "doctor");
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: null }), "villager");
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "guardian" }), "guardian");
  assert.equal(Logic.getPublicRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "mouse" }), "mouse");
  assert.equal(Logic.getPublicRoleKey({ roleKey: "apprenticeSeer", clumsy: true }), "apprenticeSeer");
});

test("migrateFactionWins：旧陣営キーを新陣営名へ読み替え、同名は合算する", () => {
  assert.deepEqual(Logic.migrateFactionWins({ "ピュア": 2, "フェイク": 1, "イノセント": 3 }), { "イノセント": 5, "インポスター": 1 });
  assert.deepEqual(Logic.migrateFactionWins({}), {});
  assert.deepEqual(Logic.migrateFactionWins(null), {});
  assert.equal(Logic.LEGACY_ROLE_NAMES.clumsySeer, "うっかり占い師");
});

test("charTalkPool / pickTalkLine：キャラ別セリフの取り出しとフォールバック", () => {
  const pool = Logic.charTalkPool("ルナ", "defense", "low");
  assert.ok(Array.isArray(pool) && pool.length > 0, "ルナの defense/low がある");
  assert.equal(Logic.charTalkPool("ルナ", "defense", "nope"), null, "存在しない tier は null");
  assert.equal(Logic.charTalkPool("存在しない子", "defense", "low"), null, "存在しないキャラは null");
  assert.equal(Logic.charTalkPool("ルナ", "defense", null), null, "tier なしの tiered プールは null");
  // pickTalkLine はキャラ別プールか汎用プールのどちらかから1行を返す。
  const generic = ["汎用A", "汎用B"];
  for (let i = 0; i < 50; i++) {
    const line = Logic.pickTalkLine({ name: "ルナ" }, "defense", "low", generic);
    assert.ok(pool.includes(line) || generic.includes(line), "返る行はどちらかのプール由来");
  }
});

test("rand は配列の要素を1つ返す", () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(["a", "b", "c"].includes(Logic.rand(["a", "b", "c"])));
  }
  assert.equal(Logic.INNOCENT_ROLE_KEYS.length, 10);
  assert.equal(Logic.CLUMSY_SEER_RATE, 0.35);
});

test("game-logic.js は DOM・ストレージ・通信を使わない（Node 移植の前提）", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "game-logic.js"), "utf8");
  for (const banned of [/\bdocument\b/, /\blocalStorage\b/, /\bfetch\s*\(/, /\balert\s*\(/, /\bsetTimeout\b/, /\bsetInterval\b/]) {
    assert.ok(!banned.test(src), `game-logic.js に ${banned} を使わない`);
  }
});

test("ブラウザ側のゲームは共有モジュールと同じ内容の ROLES を使う", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  // ハーネスは vm の別レルムで game-logic.js を読むため、プロトタイプが
  // 異なる別オブジェクトになる。内容一致は JSON で比べる
  // （中身が同じ＝切り出しの漏れがない）。
  assert.equal(JSON.stringify(FB.ROLES), JSON.stringify(Logic.ROLES));
  assert.equal(FB.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }), Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }));
  FB.setupGame();
  assert.equal(FB.state.players.length, 8);
  assert.equal(JSON.stringify(FB.state.players.map((p) => p.name)), JSON.stringify(Logic.PLAYER_NAMES));
});
