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

// 決定的な乱数（mulberry32）：同じ seed なら同じ配役になる。
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countRoles(dealt) {
  const counts = {};
  for (const d of dealt) counts[d.roleKey] = (counts[d.roleKey] || 0) + 1;
  return counts;
}

test("dealRoles：8人・バカ1・占い師1・指定通りのインポスター人数とボマー", () => {
  for (const settings of [
    { fakeCount: "1", bomber: "off" },
    { fakeCount: "2", bomber: "off" },
    { fakeCount: "1", bomber: "on" },
    { fakeCount: "2", bomber: "on" },
  ]) {
    const dealt = Logic.dealRoles(settings, seededRandom(42));
    assert.equal(dealt.length, 8, "8人分");
    const counts = countRoles(dealt);
    assert.equal(counts.baka, 1, "バカは常に1人");
    assert.equal(counts.apprenticeSeer, 1, "見習い占い師は常に1人");
    const fakeN = (counts.fakeGirl || 0) + (counts.mimic || 0);
    assert.equal(fakeN, Number(settings.fakeCount), "インポスター人数は指定通り");
    if (settings.fakeCount === "1") assert.equal(fakeN, 1);
    if (settings.fakeCount === "2") assert.equal(counts.fakeGirl, 1, "2人ならフェイクガール");
    if (settings.fakeCount === "2") assert.equal(counts.mimic, 1, "2人ならなりすまし");
    assert.equal(counts.bomber || 0, settings.bomber === "on" ? 1 : 0, "ボマーの有無は指定通り");
    for (const d of dealt) assert.ok(d.roleKey in Logic.ROLES, `${d.roleKey} は有効な役職`);
    // 役職の合計が8人になる（残りは村ガールで埋まる）。
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 8);
  }
});

test("dealRoles：ランダム指定では両方の出目が出る（抽選が生きている）", () => {
  const fakeCounts = new Set();
  const bomberSeen = new Set();
  for (let i = 0; i < 200; i++) {
    const dealt = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(i));
    assert.equal(dealt.length, 8);
    const counts = countRoles(dealt);
    fakeCounts.add((counts.fakeGirl || 0) + (counts.mimic || 0));
    bomberSeen.add(counts.bomber || 0);
  }
  assert.ok(fakeCounts.has(1) && fakeCounts.has(2), "インポスター1人と2人の両方が出る");
  assert.ok(bomberSeen.has(0) && bomberSeen.has(1), "ボマーあり・なしの両方が出る");
});

test("dealRoles：表示役職はバカだけ、うっかり個体は占い師だけ", () => {
  for (let i = 0; i < 100; i++) {
    const dealt = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(1000 + i));
    for (const d of dealt) {
      if (d.roleKey === "baka") {
        assert.ok(Logic.INNOCENT_ROLE_KEYS.includes(d.fakeDisplayRoleKey), "バカの表示役職はイノセント役職");
      } else {
        assert.equal(d.fakeDisplayRoleKey, null, "バカ以外に表示役職はない");
      }
      if (d.roleKey === "apprenticeSeer") assert.equal(typeof d.clumsy, "boolean");
      else assert.equal(d.clumsy, false, "占い師以外はうっかり個体にならない");
    }
  }
});

test("dealRoles：同じ seed なら同じ配役、seed を変えれば変わる", () => {
  const a = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(7));
  const b = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(7));
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ seed は同じ結果");
  const c = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(8));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c), "違う seed は違う結果");
});

test("resolveVoteTally：最多票1人・同数・空の票", () => {
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 3], [1, 1], [2, 2]])), { winnerId: 0, max: 3 });
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 2], [1, 2]])), { winnerId: null, max: 2 });
  assert.deepEqual(Logic.resolveVoteTally(new Map()), { winnerId: null, max: -1 });
  assert.deepEqual(Logic.resolveVoteTally(new Map([[5, 1]])), { winnerId: 5, max: 1 });
  // 政治家の2票分など、票数が重い1人が勝つ。
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 4], [1, 4], [2, 5]])), { winnerId: 2, max: 5 });
});

test("checkWinCondition：勝敗4パターンと続行", () => {
  // インポスター全滅 → イノセント勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "apprenticeSeer"], 0),
    "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！"
  );
  // インポスターがイノセントと同数以上 → インポスター勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "fakeGirl"], 0),
    "💀 インポスター陣営の勝利…生存者数が同数以上になった。"
  );
  // ボマーだけ残る → ボマーの単独勝利。
  assert.equal(
    Logic.checkWinCondition(["bomber"], 0),
    "💣 ボマーの単独勝利！最後の1人になったよ！"
  );
  // ボマーが爆弾で2人以上倒し、インポスターが全滅した瞬間 → 横取り勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "bomber"], 2),
    "💣 ボマーの勝利！爆弾で2人以上を倒し、勝利を横取りした！"
  );
  // ボマー1キルだけでは横取りしない。インポスターが0人ならイノセント勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "bomber"], 1),
    "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！"
  );
  // ボマー1キルでインポスターが残っていれば横取りせず続行。
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "bomber", "fakeGirl"], 1), null);
  // まだ決着していない盤面 → null。
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "apprenticeSeer", "fakeGirl"], 0), null);
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "bomber", "fakeGirl"], 0), null);
});

test("ブラウザ側の setupGame は dealRoles と同じ配役の不変条件を満たす", () => {
  for (let i = 0; i < 50; i++) {
    const { FB } = loadGame({ seedSettings: { fakeCount: "random", bomber: "random", sound: "off", difficulty: "normal" } });
    FB.setupGame();
    const players = FB.state.players;
    assert.equal(players.length, 8);
    const counts = {};
    for (const p of players) counts[p.roleKey] = (counts[p.roleKey] || 0) + 1;
    assert.equal(counts.baka, 1, "バカは1人");
    assert.equal(counts.apprenticeSeer, 1, "占い師は1人");
    const fakeN = (counts.fakeGirl || 0) + (counts.mimic || 0);
    assert.ok(fakeN === 1 || fakeN === 2, "インポスターは1〜2人");
    for (const p of players) {
      if (p.roleKey === "baka") assert.ok(Logic.INNOCENT_ROLE_KEYS.includes(p.fakeDisplayRoleKey));
      else assert.equal(p.fakeDisplayRoleKey, null);
    }
  }
});

test("ブラウザ側の dealRoles / checkWinCondition は共有モジュールと同一結果", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  // 同じ seed の乱数を与えれば、別レルムでも配役はバイト単位で一致する。
  const settings = { fakeCount: "random", bomber: "random" };
  assert.equal(
    JSON.stringify(FB.dealRoles(settings, seededRandom(123))),
    JSON.stringify(Logic.dealRoles(settings, seededRandom(123)))
  );
  assert.equal(
    FB.checkWinCondition(["villager", "bomber"], 2),
    Logic.checkWinCondition(["villager", "bomber"], 2)
  );
  assert.equal(
    JSON.stringify(FB.resolveVoteTally(new Map([[0, 2], [1, 2]]))),
    JSON.stringify(Logic.resolveVoteTally(new Map([[0, 2], [1, 2]])))
  );
});
