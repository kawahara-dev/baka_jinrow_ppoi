// Fake Bloom の自動テスト。依存なし（Node 18+ の node:test を使用）。
// 実行方法: リポジトリのルートで `node --test tests/`
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGame } = require("./harness");

const BASE_SETTINGS = { fakeCount: "2", bomber: "off", sound: "off", difficulty: "normal" };

// 全員を村ガールに戻す（役職固定テストの土台）。人間以外のプレイヤーを返す。
function resetToVillagers(FB) {
  const s = FB.state;
  s.players.forEach((p) => {
    p.roleKey = "villager";
    p.fakeDisplayRoleKey = null;
    p.alive = true;
    p.suspicion = 0;
  });
  return s.players.filter((p) => p.id !== FB.state.playerId);
}

function humanOf(FB) {
  return FB.state.players[FB.state.playerId];
}

// resolveNightActions を直接呼ぶための夜行動の下ごしらえ。
function craftNight(FB, actions) {
  const s = FB.state;
  s.nightActions = actions;
  s.nightActionTypes = {};
  s.protectedTargets = new Set();
  s.bombs = [];
  s.loneFakeAbility = null;
  return s;
}

// 素朴な自動プレイヤーで1試合を最後まで回す。夜は生存中の自分以外から
// 先頭を選び、投票は最も疑念が高い生存者を選ぶ。終了時の state を返す。
function playFullGame(FB, maxDays = 40) {
  FB.setupGame();
  let steps = 0;
  while (FB.state.phase !== "end" && steps++ < maxDays * 4) {
    const s = FB.state;
    const alive = s.players.filter((p) => p.alive);
    const me = s.players[s.playerId];
    if (s.phase === "night") {
      s.selectedId = alive.find((p) => p.id !== me.id).id;
      FB.runNight();
    } else if (s.phase === "morning") {
      FB.morningToDiscussion();
    } else if (s.phase === "discussion") {
      FB.discussionToVote();
    } else if (s.phase === "vote") {
      const candidates = alive
        .filter((p) => p.id !== me.id)
        .sort((a, b) => b.suspicion - a.suspicion);
      s.selectedId = candidates[0].id;
      FB.doVote();
    } else {
      throw new Error(`未知のフェーズ: ${s.phase}`);
    }
  }
  return FB.state;
}

test("setupGame: 8人・バカ1人・占い師1人・フェイク人数が設定通り", () => {
  for (const fakeCount of ["1", "2"]) {
    const { FB } = loadGame({ seedSettings: { ...BASE_SETTINGS, fakeCount } });
    FB.setupGame();
    const s = FB.state;
    assert.equal(s.players.length, 8);
    assert.ok(s.players.every((p) => p.alive));
    assert.equal(s.phase, "night");
    assert.equal(s.day, 1);
    assert.ok(s.playerId >= 0 && s.playerId < 8);
    const count = (k) => s.players.filter((p) => p.roleKey === k).length;
    assert.equal(count("baka"), 1);
    assert.equal(count("apprenticeSeer"), 1);
    assert.equal(count("fakeGirl") + count("mimic"), Number(fakeCount));
    assert.equal(count("bomber"), 0);
    const baka = s.players.find((p) => p.roleKey === "baka");
    assert.ok(FB.ROLES[baka.fakeDisplayRoleKey]);
    assert.equal(FB.ROLES[baka.fakeDisplayRoleKey].faction, "ピュア");
  }
});

test("setupGame: ランダム設定でも構成が崩れない", () => {
  for (let i = 0; i < 20; i++) {
    const { FB } = loadGame({ seedSettings: { fakeCount: "random", bomber: "random", sound: "off", difficulty: "normal" } });
    FB.setupGame();
    const s = FB.state;
    const count = (k) => s.players.filter((p) => p.roleKey === k).length;
    const fakes = count("fakeGirl") + count("mimic");
    assert.ok(fakes === 1 || fakes === 2);
    assert.ok(count("bomber") === 0 || count("bomber") === 1);
    assert.equal(count("baka"), 1);
    assert.equal(s.players.length, 8);
  }
});

test("gameSettings: 保存された設定が読まれ、不正な値は初期値に戻る", () => {
  const { FB } = loadGame({ seedSettings: { fakeCount: "1", bomber: "on", sound: "off", difficulty: "hard" } });
  assert.equal(FB.gameSettings.fakeCount, "1");
  assert.equal(FB.gameSettings.bomber, "on");
  assert.equal(FB.gameSettings.difficulty, "hard");
  const bad = loadGame({ seedSettings: { fakeCount: "9", bomber: "maybe", sound: "loud", difficulty: "extreme" } });
  assert.equal(bad.FB.gameSettings.fakeCount, "random");
  assert.equal(bad.FB.gameSettings.bomber, "random");
  assert.equal(bad.FB.gameSettings.sound, "on");
  assert.equal(bad.FB.gameSettings.difficulty, "normal");
});

test("getEffectiveRoleKey: バカは表示役職、それ以外は本来の役職", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const baka = s.players.find((p) => p.roleKey === "baka");
  assert.equal(FB.getEffectiveRoleKey(baka), baka.fakeDisplayRoleKey);
  const seer = s.players.find((p) => p.roleKey === "apprenticeSeer");
  assert.equal(FB.getEffectiveRoleKey(seer), "apprenticeSeer");
});

test("checkWin: 勝敗条件", () => {
  const { FB } = loadGame({ seedSettings: { ...BASE_SETTINGS, bomber: "on" } });
  const killAll = (faction) =>
    FB.state.players
      .filter((p) => FB.ROLES[p.roleKey].faction === faction)
      .forEach((p) => { p.alive = false; });

  FB.setupGame();
  assert.equal(FB.checkWin(), null);

  // フェイク全滅 → ピュア勝利
  killAll("フェイク");
  assert.match(FB.checkWin(), /ピュア陣営の勝利/);

  // ピュアがフェイクと同数以下 → フェイク勝利
  FB.setupGame();
  FB.state.players
    .filter((p) => FB.ROLES[p.roleKey].faction === "ピュア")
    .slice(0, 5)
    .forEach((p) => { p.alive = false; });
  assert.match(FB.checkWin(), /フェイク陣営の勝利/);

  // ボマーだけ生存 → ボマーの単独勝利
  FB.setupGame();
  FB.state.players
    .filter((p) => p.roleKey !== "bomber")
    .forEach((p) => { p.alive = false; });
  assert.match(FB.checkWin(), /ボマーの単独勝利/);

  // ボマーが爆弾で2人以上倒して生き残り、フェイク全滅 → 横取り勝利
  FB.setupGame();
  FB.state.bombKills = 2;
  killAll("フェイク");
  assert.match(FB.checkWin(), /横取り/);
});

test("resolveNightActions: 守り手が襲撃を防ぐ／防げなければ脱落する", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "guardian";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const alive = FB.state.players.filter((p) => p.alive);

  // 守り手が被害者を守っている場合
  let s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, alive);
  assert.equal(victim.alive, true);
  assert.equal(s.nightReport.type, "blocked");

  // 守り手がいない場合（夜行動を立て直す）
  victim.alive = true;
  s = craftNight(FB, { [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, alive);
  assert.equal(victim.alive, false);
  assert.equal(victim.deathCause, "襲撃");
  assert.equal(s.nightReport.type, "eliminated");
});

test("resolveNightActions: 罠は襲撃者を道連れにし、ドクターは蘇生する", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });

  // 罠
  FB.setupGame();
  let others = resetToVillagers(FB);
  let me = humanOf(FB);
  me.roleKey = "trapper";
  let fake = others[0];
  fake.roleKey = "fakeGirl";
  let victim = others[1];
  let s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(victim.alive, false);
  assert.equal(fake.alive, false);
  assert.equal(fake.deathCause, "罠");
  assert.ok(s.trapReport);

  // 蘇生
  FB.setupGame();
  others = resetToVillagers(FB);
  me = humanOf(FB);
  me.roleKey = "doctor";
  fake = others[0];
  fake.roleKey = "fakeGirl";
  victim = others[1];
  s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(victim.alive, true);
  assert.equal(s.nightReport.type, "revived");
  assert.ok(s.doctorReport);
});

test("resolveNightActions: 見習い占い師の調査はフェイクを正しく見抜く", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  for (let i = 0; i < 20; i++) {
    FB.setupGame();
    const others = resetToVillagers(FB);
    const me = humanOf(FB);
    me.roleKey = "apprenticeSeer";
    const fake = others[0];
    fake.roleKey = "fakeGirl";
    const s = craftNight(FB, { [me.id]: fake.id });
    FB.resolveNightActions(me, fake, FB.state.players.filter((p) => p.alive));
    assert.equal(s.lastInvestigation[me.id].result, "フェイク");
    assert.equal(s.lastInvestigation[me.id].targetId, fake.id);
  }
});

test("resolveNightActions: なりすましは調査でピュアに化けることがある", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  const results = new Set();
  for (let i = 0; i < 60; i++) {
    FB.setupGame();
    const others = resetToVillagers(FB);
    const me = humanOf(FB);
    me.roleKey = "apprenticeSeer";
    const mimic = others[0];
    mimic.roleKey = "mimic";
    const s = craftNight(FB, { [me.id]: mimic.id });
    FB.resolveNightActions(me, mimic, FB.state.players.filter((p) => p.alive));
    results.add(s.lastInvestigation[me.id].result);
  }
  // 65%でピュアに化けるため、両方の結果が出るはず
  assert.ok(results.has("ピュア"));
  assert.ok(results.has("フェイク"));
});

test("resolveNightActions: バカの占い結果は偽物（両方の判定が出る）", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  const results = new Set();
  for (let i = 0; i < 60; i++) {
    FB.setupGame();
    const others = resetToVillagers(FB);
    const me = humanOf(FB);
    me.roleKey = "baka";
    me.fakeDisplayRoleKey = "apprenticeSeer";
    const target = others[0];
    const s = craftNight(FB, { [me.id]: target.id });
    FB.resolveNightActions(me, target, FB.state.players.filter((p) => p.alive));
    results.add(s.lastInvestigation[me.id].result);
  }
  assert.ok(results.has("ピュア"));
  assert.ok(results.has("フェイク"));
});

test("revealMouse: フェイクを公開すると疑念が上がり、ピュアだと下がる", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "mouse";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const villager = others[1];
  FB.revealMouse(me, fake);
  assert.equal(FB.state.revealedRoles[fake.id], "fakeGirl");
  assert.equal(fake.suspicion, 8);
  assert.equal(me.mouseUsed, true);

  me.mouseUsed = false;
  FB.revealMouse(me, villager);
  assert.equal(FB.state.revealedRoles[villager.id], "villager");
  assert.equal(villager.suspicion, -5);
});

test("buildHighlights: 名場面を最大2行でまとめ、なければ日数で締める", () => {
  const { FB } = loadGame({ seedSettings: { ...BASE_SETTINGS, bomber: "on" } });
  FB.setupGame();
  const s = FB.state;
  const bomber = s.players.find((p) => p.roleKey === "bomber");
  assert.ok(bomber, "ボマーがいるはず");

  // 何も起きていない試合 → 日数のフォールバック1行
  assert.equal(FB.buildHighlights().join("\n"), `📅 ${s.day}日目で決着`);

  // 爆弾2キル・罠・蘇生・護衛が全部起きた試合 → 優先度の高い2行だけ
  s.bombKills = 2;
  s.players[0].deathCause = "罠";
  s.revives = 1;
  s.guardSaves = 3;
  const top = FB.buildHighlights();
  assert.equal(top.length, 2);
  assert.match(top[0], new RegExp(`💣 ${bomber.name}の爆弾で2人が倒れた`));
  assert.match(top[1], /🪤 罠が1回作動/);

  // 爆弾1キルだけ → 1行で出る
  s.bombKills = 1;
  s.players[0].deathCause = null;
  s.revives = 0;
  s.guardSaves = 0;
  assert.equal(FB.buildHighlights().join("\n"), `💣 ${bomber.name}の爆弾で1人が倒れた`);

  // 蘇生と護衛だけ → 両方出る
  s.bombKills = 0;
  s.revives = 2;
  s.guardSaves = 1;
  assert.equal(FB.buildHighlights().join("\n"), "💉 ドクターの蘇生で2人が助かった\n🛡️ 護衛が1回、襲撃を防いだ");
});

test("resolveNightActions: 罠・蘇生・護衛がハイライト用カウンタに残る", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });

  // 罠：襲撃者が「罠」で倒れ、ハイライトに罠の行が出る
  FB.setupGame();
  let others = resetToVillagers(FB);
  let me = humanOf(FB);
  me.roleKey = "trapper";
  let fake = others[0];
  fake.roleKey = "fakeGirl";
  let victim = others[1];
  let s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.match(FB.buildHighlights().join("\n"), /🪤 罠が1回作動/);

  // 蘇生：revives が1になり、ハイライトに蘇生の行が出る
  FB.setupGame();
  others = resetToVillagers(FB);
  me = humanOf(FB);
  me.roleKey = "doctor";
  fake = others[0];
  fake.roleKey = "fakeGirl";
  victim = others[1];
  s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(s.revives, 1);
  assert.match(FB.buildHighlights().join("\n"), /💉 ドクターの蘇生で1人が助かった/);

  // 護衛：guardSaves が1になり、ハイライトに護衛の行が出る
  FB.setupGame();
  others = resetToVillagers(FB);
  me = humanOf(FB);
  me.roleKey = "guardian";
  fake = others[0];
  fake.roleKey = "fakeGirl";
  victim = others[1];
  s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(s.guardSaves, 1);
  assert.match(FB.buildHighlights().join("\n"), /🛡️ 護衛が1回、襲撃を防いだ/);
});

test("CHAR_TALK: 8人全員が全カテゴリの口調バリエーションを持つ", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const names = FB.state.players.map((p) => p.name);
  assert.deepEqual(Object.keys(FB.CHAR_TALK).sort(), [...names].sort());
  const tiered = ["defense", "pressure"];
  const flatWithTarget = ["claimFake", "claimWhite", "claimNeutral"];
  const flatWithoutTarget = ["tracker", "observe", "bomb", "guardian", "endgame"];
  for (const name of names) {
    const talk = FB.CHAR_TALK[name];
    for (const cat of tiered) {
      for (const tier of ["low", "mid", "high"]) {
        const pool = talk[cat][tier];
        assert.ok(Array.isArray(pool) && pool.length > 0, `${name} ${cat}.${tier}`);
        for (const line of pool) {
          assert.equal(typeof line, "string");
          assert.ok(line.length > 0);
          assert.ok(line.includes("{target}"), `${name} ${cat}.${tier} には {target} が必要`);
        }
      }
    }
    for (const cat of flatWithTarget) {
      assert.ok(Array.isArray(talk[cat]) && talk[cat].length > 0, `${name} ${cat}`);
      for (const line of talk[cat]) assert.ok(line.includes("{target}"), `${name} ${cat} には {target} が必要`);
    }
    for (const cat of flatWithoutTarget) {
      assert.ok(Array.isArray(talk[cat]) && talk[cat].length > 0, `${name} ${cat}`);
      for (const line of talk[cat]) assert.ok(!line.includes("{target}"), `${name} ${cat} に {target} は不要`);
    }
  }
});

test("pickTalkLine: キャラ固有のセリフと共通テンプレートの両方が選ばれる", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const player = FB.state.players.find((p) => p.id !== FB.state.playerId);
  const charPool = FB.CHAR_TALK[player.name].observe;
  const genericPool = ["共通セリフ1", "共通セリフ2"];
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(FB.pickTalkLine(player, "observe", null, genericPool));
  assert.ok(charPool.some((l) => seen.has(l)), "キャラ固有のセリフが選ばれる");
  assert.ok(genericPool.some((l) => seen.has(l)), "共通テンプレートも選ばれる");
  // 段位付きカテゴリもキャラプールから選ばれる
  const seenTiered = new Set();
  for (let i = 0; i < 200; i++) seenTiered.add(FB.pickTalkLine(player, "defense", "high", ["共通の高セリフ"]));
  assert.ok(FB.CHAR_TALK[player.name].defense.high.some((l) => seenTiered.has(l)));
  // 知らない名前のキャラは共通テンプレートだけ
  const stranger = { name: "知らない子" };
  for (let i = 0; i < 20; i++) assert.ok(genericPool.includes(FB.pickTalkLine(stranger, "observe", null, genericPool)));
});

test("morningToDiscussion: 議論ログにキャラ別セリフが出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const names = FB.state.players.map((p) => p.name);
  // {target} を全キャラ名で置換したキャラ別セリフの集合を作る。
  const charLines = new Set();
  for (const talk of Object.values(FB.CHAR_TALK)) {
    const collect = (pool) => pool.forEach((l) => names.forEach((n) => charLines.add(l.replaceAll("{target}", n))));
    for (const tier of ["low", "mid", "high"]) { collect(talk.defense[tier]); collect(talk.pressure[tier]); }
    for (const cat of ["tracker", "observe", "claimFake", "claimWhite", "claimNeutral", "bomb", "guardian", "endgame"]) collect(talk[cat]);
  }
  let sawCharLine = false;
  let totalLines = 0;
  for (let i = 0; i < 15; i++) {
    FB.setupGame();
    const s = FB.state;
    const alive = s.players.filter((p) => p.alive);
    s.selectedId = alive.find((p) => p.id !== s.playerId).id;
    FB.runNight();
    if (s.phase !== "morning") continue;
    const before = elements.get("dialogueLog").children.length;
    FB.morningToDiscussion();
    const lines = elements.get("dialogueLog").children.slice(before).map((c) => c.textContent);
    totalLines += lines.length;
    for (const line of lines) {
      const said = line.slice(line.indexOf("：") + 1);
      if (charLines.has(said)) sawCharLine = true;
    }
  }
  assert.ok(totalLines > 0, "議論ログが出る");
  assert.ok(sawCharLine, "キャラ別セリフが議論ログに出る");
});

test("フルゲーム: 各種設定で40日以内に必ず決着し、戦績が記録される", () => {
  const settingsList = [
    { fakeCount: "1", bomber: "off", difficulty: "easy" },
    { fakeCount: "2", bomber: "on", difficulty: "normal" },
    { fakeCount: "random", bomber: "random", difficulty: "hard" },
  ];
  for (const settings of settingsList) {
    for (let i = 0; i < 10; i++) {
      const { FB, localStorage, elements } = loadGame({ seedSettings: { ...settings, sound: "off" } });
      const end = playFullGame(FB);
      assert.equal(end.phase, "end", `設定 ${JSON.stringify(settings)} #${i} が終わらなかった`);
      assert.ok(["ピュア", "フェイク", "ニュートラル"].includes(end.winnerFaction));
      assert.ok(end.day <= 40);
      // 結果画面のハイライト欄が空でないこと（フォールバック行でもよい）
      assert.ok(elements.get("resultHighlights").innerHTML.length > 0);
      const stats = JSON.parse(localStorage.getItem("fakeBloomStats"));
      assert.equal(stats.games, 1);
      assert.equal(stats.wins, end.myWin ? 1 : 0);
    }
  }
});
