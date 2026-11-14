// Fake Bloom の自動テスト。依存なし（Node 18+ の node:test を使用）。
// 実行方法: リポジトリのルートで `node --test tests/`
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadGame } = require("./harness");

const BASE_SETTINGS = { fakeCount: "2", bomber: "off", sound: "off", difficulty: "normal" };

// 全員を村ガールに戻す（役職固定テストの土台）。人間以外のプレイヤーを返す。
function resetToVillagers(FB) {
  const s = FB.state;
  s.players.forEach((p) => {
    p.roleKey = "villager";
    p.fakeDisplayRoleKey = null;
    // 隠し個体フラグも落とす（役職を固定するテストで占い師の判定が
    // ズレないようにする）。
    p.clumsy = false;
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
// パス＆プレイでは受け渡し画面と夜の順番入力もボタン経由で進める。
function playPnpNight(FB, elements) {
  const s = FB.state;
  let guard = 0;
  while (s.phase === "night" && guard++ < 40) {
    if (s.pnpStep === "nightCover") {
      elements.get("pnpRevealBtn").onclick();
    } else if (s.pnpStep === "nightResult") {
      elements.get("pnpConfirmBtn").onclick();
    } else if (s.pnpStep === "nightNoAction") {
      elements.get("pnpConfirmBtn").onclick();
    } else if (s.pnpStep === "nightFakeConsult" || s.pnpStep === "nightFakeAgree") {
      // 合意確認のあと、能力の対象入力へ進む（フェーズ3）。
      elements.get("pnpConfirmBtn").onclick();
    } else if (s.pnpStep === "nightFakeAbility") {
      const player = FB.pnpNightCurrentPlayer();
      const target = s.players.find((p) => p.alive && p.id !== player.id && FB.ROLES[p.roleKey].faction !== "インポスター");
      s.selectedId = target.id;
      elements.get("actionBtn").onclick();
    } else if (s.pnpStep === "nightAction") {
      const player = FB.pnpNightCurrentPlayer();
      const target = s.players.find((p) => p.alive && p.id !== player.id);
      s.selectedId = target.id;
      elements.get("actionBtn").onclick();
    } else {
      throw new Error(`夜入力の想定外のステップ: ${s.pnpStep}`);
    }
  }
  assert.ok(s.phase === "morning" || s.phase === "end", `夜が解決されなかった: ${s.phase} / ${s.pnpStep}`);
}

// パス＆プレイの投票入力を自動で回す。生存中の人間が順番に投票する。
function playPnpVote(FB, elements) {
  const s = FB.state;
  let guard = 0;
  while (s.phase === "vote" && guard++ < 40) {
    if (s.pnpStep === "voteCover") {
      elements.get("pnpRevealBtn").onclick();
    } else if (s.pnpStep === "voteAction") {
      const player = FB.pnpVoteCurrentPlayer();
      const target = s.players.find((p) => p.alive && p.id !== player.id);
      s.selectedId = target.id;
      elements.get("voteBtn").onclick();
    } else {
      throw new Error(`投票入力の想定外のステップ: ${s.pnpStep}`);
    }
  }
  // 投票で最後の人間が追放された場合、夜は人間なしで即解決され朝になる。
  assert.ok(["night", "morning", "end"].includes(s.phase), `投票が解決されなかった: ${s.phase} / ${s.pnpStep}`);
}

function playFullGame(FB, elements, maxDays = 40) {
  FB.setupGame();
  if (FB.state.mode === "pnp") {
    // 受け渡し画面を全員分進める（最後の確認で夜入力が始まる）。
    const n = FB.state.humanPlayerIds.length;
    for (let i = 0; i < n; i++) {
      elements.get("pnpRevealBtn").onclick();
      elements.get("pnpConfirmBtn").onclick();
    }
  }
  let steps = 0;
  while (FB.state.phase !== "end" && steps++ < maxDays * 4) {
    const s = FB.state;
    const alive = s.players.filter((p) => p.alive);
    const me = s.players[s.playerId];
    if (s.phase === "night") {
      if (s.mode === "pnp") playPnpNight(FB, elements);
      else {
        s.selectedId = alive.find((p) => p.id !== me.id).id;
        FB.runNight();
      }
    } else if (s.phase === "morning") {
      FB.morningToDiscussion();
    } else if (s.phase === "discussion") {
      FB.discussionToVote();
    } else if (s.phase === "vote") {
      if (s.mode === "pnp") playPnpVote(FB, elements);
      else {
        const candidates = alive
          .filter((p) => p.id !== me.id)
          .sort((a, b) => b.suspicion - a.suspicion);
        s.selectedId = candidates[0].id;
        FB.doVote();
      }
    } else {
      throw new Error(`未知のフェーズ: ${s.phase}`);
    }
  }
  return FB.state;
}

test("setupGame: 8人・バカ1人・占い師1人・インポスター人数が設定通り", () => {
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
    assert.equal(FB.ROLES[baka.fakeDisplayRoleKey].faction, "イノセント");
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

test("gameSettings: BGM は既定オフ、古い保存データでもオフになる", () => {
  const on = loadGame({ seedSettings: { ...BASE_SETTINGS, bgm: "on" } });
  assert.equal(on.FB.gameSettings.bgm, "on");
  const bad = loadGame({ seedSettings: { ...BASE_SETTINGS, bgm: "loud" } });
  assert.equal(bad.FB.gameSettings.bgm, "off");
  // bgm キー自体がない古い設定（PR #40 時点の保存データ）→ 後方互換でオフ
  const legacy = loadGame({ seedSettings: BASE_SETTINGS });
  assert.equal(legacy.FB.gameSettings.bgm, "off");
});

test("BGM: AudioContext が無ければ安全な no-op、あればコードが鳴り始める", () => {
  // Node の vm サンドボックスに AudioContext は無い → 壊れず false を返す
  const noAudio = loadGame({ seedSettings: { ...BASE_SETTINGS, bgm: "on" } });
  assert.equal(noAudio.FB.startBgm(), false);
  assert.equal(noAudio.FB.isBgmPlaying(), false);
  assert.doesNotThrow(() => noAudio.FB.stopBgm());

  // FakeAudioContext あり：START 押下で BGM が始まり、2回目は重複しない
  const { FB, elements, FakeAudioContext } = loadGame({
    seedSettings: { ...BASE_SETTINGS, bgm: "on" },
    fakeAudio: true,
  });
  FakeAudioContext.instances.length = 0;
  elements.get("startBtn").onclick();
  assert.equal(FB.isBgmPlaying(), true);
  assert.equal(FakeAudioContext.instances.length, 1);
  const ctx = FakeAudioContext.instances[0];
  assert.equal(ctx.createdOscillators.length, 4, "最初のコードは4声");
  assert.equal(FB.startBgm(), false, "再生中の再スタートは無視される");
  assert.equal(ctx.createdOscillators.length, 4, "再スタートで声は増えない");
  // START をもう一度押すと initAudio が既存の AudioContext を resume する
  elements.get("startBtn").onclick();
  assert.ok(ctx.resumed, "AudioContext が resume される");
  assert.equal(ctx.createdOscillators.length, 4, "START 再押下でも声は増えない");

  // 停止するとフラグが落ち、再開できる
  FB.stopBgm();
  assert.equal(FB.isBgmPlaying(), false);
  assert.equal(FB.startBgm(), true);
  assert.equal(FB.isBgmPlaying(), true);
  FB.stopBgm();
});

test("BGM: コード進行は4コード・各4声・可聴域の周波数", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.equal(FB.BGM_CHORDS.length, 4);
  for (const chord of FB.BGM_CHORDS) {
    assert.equal(chord.length, 4);
    for (const freq of chord) {
      assert.equal(typeof freq, "number");
      assert.ok(freq >= 100 && freq <= 1000, `周波数 ${freq} が可聴域`);
    }
  }
});

test("フルゲーム: BGM オンでも40日以内に決着する", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, bgm: "on" }, fakeAudio: true });
  elements.get("startBtn").onclick(); // BGM を実際に鳴らしながら1試合回す
  assert.equal(FB.isBgmPlaying(), true);
  const end = playFullGame(FB, elements);
  assert.equal(end.phase, "end");
  assert.ok(end.day <= 40);
  FB.stopBgm();
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

  // インポスター全滅 → イノセント勝利
  killAll("インポスター");
  assert.match(FB.checkWin(), /イノセント陣営の勝利/);

  // イノセントがインポスターと同数以下 → インポスター勝利
  FB.setupGame();
  FB.state.players
    .filter((p) => FB.ROLES[p.roleKey].faction === "イノセント")
    .slice(0, 5)
    .forEach((p) => { p.alive = false; });
  assert.match(FB.checkWin(), /インポスター陣営の勝利/);

  // ボマーだけ生存 → ボマーの単独勝利
  FB.setupGame();
  FB.state.players
    .filter((p) => p.roleKey !== "bomber")
    .forEach((p) => { p.alive = false; });
  assert.match(FB.checkWin(), /ボマーの単独勝利/);

  // ボマーが爆弾で2人以上倒して生き残り、インポスター全滅 → 横取り勝利
  FB.setupGame();
  FB.state.bombKills = 2;
  killAll("インポスター");
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

test("resolveNightActions: 見習い占い師の調査はインポスターを正しく見抜く", () => {
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
    assert.equal(s.lastInvestigation[me.id].result, "インポスター");
    assert.equal(s.lastInvestigation[me.id].targetId, fake.id);
  }
});

test("resolveNightActions: なりすましは調査でイノセントに化けることがある", () => {
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
  // 65%でイノセントに化けるため、両方の結果が出るはず
  assert.ok(results.has("イノセント"));
  assert.ok(results.has("インポスター"));
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
  assert.ok(results.has("イノセント"));
  assert.ok(results.has("インポスター"));
});

test("roleHtmlFor: バカには表示役職だけを見せ、「バカ」「偽表示」は出ない", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const me = humanOf(FB);
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "guardian";
  const html = FB.roleHtmlFor(me);
  assert.ok(html.includes("守り手"), `表示役職が出る: ${html}`);
  assert.ok(!html.includes("バカ"), `バカの文言が出ない: ${html}`);
  assert.ok(!html.includes("偽表示"), `偽表示の文言が出ない: ${html}`);
  // 占い師表示のバカも同じ（説明・ヒントは表示役職のもの）。
  me.fakeDisplayRoleKey = "apprenticeSeer";
  const seerHtml = FB.roleHtmlFor(me);
  assert.ok(seerHtml.includes("見習い占い師"));
  assert.ok(!seerHtml.includes("バカ"));
  // バカ以外は従来通り自分の役職が出る。
  me.roleKey = "tracker";
  me.fakeDisplayRoleKey = null;
  assert.ok(FB.roleHtmlFor(me).includes("追跡係"));
});

test("役職カードとフェーズヒント: バカは表示役職として見える", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = humanOf(FB);
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "apprenticeSeer";
  s.phase = "night";
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardName").textContent, "見習い占い師");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes('data-role-info="apprenticeSeer"'), "役職カードに説明ボタン");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes("🔮"), "役職カードにアイコン");
  assert.equal(elements.get("roleCardFaction").textContent, "イノセント");
  assert.ok(!FB.getPhaseHint(FB.ROLES[me.roleKey]).includes("偽表示"), "ヒントに偽表示の文言は出ない");
  assert.match(FB.getPhaseHint(FB.ROLES[me.roleKey]), /調査/);
  // 村ガール表示のバカも表示役職のカードになる。
  me.fakeDisplayRoleKey = "villager";
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardName").textContent, "村ガール");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes('data-role-info="villager"'));
});

test("公開情報: 脱落したバカは表示役職として公開される", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  const baka = others[0];
  baka.roleKey = "baka";
  baka.fakeDisplayRoleKey = "guardian";
  const fake = others[1];
  fake.roleKey = "fakeGirl";
  const s = craftNight(FB, { [fake.id]: baka.id });
  FB.resolveNightActions(me, baka, FB.state.players.filter((p) => p.alive));
  assert.equal(baka.alive, false);
  const lines = elements.get("actionLog").children.map((c) => c.textContent);
  const reveal = lines.find((l) => l.includes("役職:"));
  assert.ok(reveal, `公開ログがある: ${lines.join(" / ")}`);
  assert.ok(reveal.includes("守り手"), `表示役職で公開される: ${reveal}`);
  assert.ok(!reveal.includes("バカ"), `実役職は出ない: ${reveal}`);
  // カードの表示も表示役職（アイコン1つ）。
  FB.draw();
  const card = elements.get("cards").children[baka.id];
  assert.ok(card.innerHTML.includes("🛡️"), `カードも表示役職アイコン: ${card.innerHTML}`);
  assert.ok(!card.innerHTML.includes("バカ"));
  assert.ok(!card.innerHTML.includes("守り手"), "カードに役職名テキストは出ない（アイコン1つ）");
  assert.match(card.getAttribute("aria-label"), /守り手、脱落済み/);
  assert.equal(FB.getPublicRoleKey(baka), "guardian");
});

test("revealMouse: バカを公開しても表示役職が出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "mouse";
  const baka = others[0];
  baka.roleKey = "baka";
  baka.fakeDisplayRoleKey = "tracker";
  FB.revealMouse(me, baka);
  assert.equal(FB.state.revealedRoles[baka.id], "tracker");
  const lines = elements.get("dialogueLog").children.map((c) => c.textContent);
  assert.ok(lines.some((l) => l.includes("追跡係")), `表示役職で公開される: ${lines.join(" / ")}`);
  assert.ok(!lines.some((l) => l.includes("バカ")), `実役職は出ない: ${lines.join(" / ")}`);
});

test("setupGame: うっかり占い師は独立役職ではなく、占い師の隠し個体になった", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.ok(!("clumsySeer" in FB.ROLES), "ROLES に clumsySeer はない");
  let clumsyGames = 0;
  const games = 200;
  for (let i = 0; i < games; i++) {
    FB.setupGame();
    const s = FB.state;
    assert.equal(s.players.filter((p) => p.roleKey === "clumsySeer").length, 0);
    assert.equal(s.players.filter((p) => p.roleKey === "apprenticeSeer").length, 1);
    const seer = s.players.find((p) => p.roleKey === "apprenticeSeer");
    assert.equal(typeof seer.clumsy, "boolean");
    if (seer.clumsy) clumsyGames++;
    // バカの表示役職にうっかり占い師は出ない。
    const baka = s.players.find((p) => p.roleKey === "baka");
    assert.notEqual(baka.fakeDisplayRoleKey, "clumsySeer");
  }
  const rate = clumsyGames / games;
  assert.ok(rate > 0.2 && rate < 0.5, `うっかり個体の出現率が 30〜40% 目安: ${(rate * 100).toFixed(0)}%`);
});

test("resolveNightActions: うっかり個体の占い師は判定がズレる（本人には分からない）", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  // うっかり個体：インポスターを調べてもイノセント判定が出ることがある。
  const clumsyResults = new Set();
  for (let i = 0; i < 60; i++) {
    FB.setupGame();
    const others = resetToVillagers(FB);
    const me = humanOf(FB);
    me.roleKey = "apprenticeSeer";
    me.clumsy = true;
    const fake = others[0];
    fake.roleKey = "fakeGirl";
    const s = craftNight(FB, { [me.id]: fake.id });
    FB.resolveNightActions(me, fake, FB.state.players.filter((p) => p.alive));
    clumsyResults.add(s.lastInvestigation[me.id].result);
  }
  assert.ok(clumsyResults.has("イノセント"), "うっかり個体はインポスターをイノセントと誤認する");
  assert.ok(clumsyResults.has("インポスター"), "うっかり個体でも正しい判定が出ることがある");
  // 通常の占い師は従来通りインポスターを正しく見抜く（clumsy フラグなし）。
  for (let i = 0; i < 20; i++) {
    FB.setupGame();
    const others = resetToVillagers(FB);
    const me = humanOf(FB);
    me.roleKey = "apprenticeSeer";
    me.clumsy = false;
    const fake = others[0];
    fake.roleKey = "fakeGirl";
    const s = craftNight(FB, { [me.id]: fake.id });
    FB.resolveNightActions(me, fake, FB.state.players.filter((p) => p.alive));
    assert.equal(s.lastInvestigation[me.id].result, "インポスター");
  }
});

test("showResults: 結果画面でバカと うっかり個体が開示される", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const baka = s.players.find((p) => p.roleKey === "baka");
  baka.fakeDisplayRoleKey = "guardian";
  const seer = s.players.find((p) => p.roleKey === "apprenticeSeer");
  seer.clumsy = true;
  // 人間をうっかり個体の占い師にして、個人の結果文も確認する。
  s.playerId = seer.id;
  FB.showResults("🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  const rows = elements.get("resultRows").innerHTML;
  assert.ok(rows.includes("バカ（表示：守り手）"), `バカの実役職と表示役職が開示される: ${rows}`);
  assert.ok(rows.includes("実はうっかり個体でした"), `うっかり個体が開示される: ${rows}`);
  assert.match(elements.get("resultSub").textContent, /実はうっかり個体でした/);
});

test("renderStats: 旧セーブの clumsySeer 記録は当時の名前で表示される", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  localStorage.setItem("fakeBloomStats", JSON.stringify({
    games: 3, wins: 1,
    byRole: { clumsySeer: { games: 3, wins: 1 }, apprenticeSeer: { games: 2, wins: 0 } },
    factionWins: { "イノセント": 1 }, steals: 0, streak: 0, bestStreak: 1,
  }));
  assert.doesNotThrow(() => FB.renderStats());
  const chips = elements.get("statsRoles").innerHTML;
  assert.ok(chips.includes("うっかり占い師：3戦1勝"), `旧記録が表示される: ${chips}`);
  assert.ok(chips.includes("見習い占い師：2戦0勝"), `現行役職も表示される: ${chips}`);
});

test("シミュレーション: Feign 式秘匿化でも陣営勝率は目安から大きく崩れない", () => {
  // 素朴な自動プレイヤーで回す。変更前（2026-11-12 計測）の目安は
  // イノセント 46.5% / インポスター 53.0% / ボマー 0.5%（200試合）。
  const counts = { "イノセント": 0, "インポスター": 0, "ニュートラル": 0 };
  const N = 60;
  for (let i = 0; i < N; i++) {
    const { FB, elements } = loadGame({ seedSettings: { fakeCount: "random", bomber: "random", sound: "off", difficulty: "normal" } });
    const end = playFullGame(FB, elements);
    assert.equal(end.phase, "end", `試合 #${i} が終わらなかった`);
    counts[end.winnerFaction]++;
  }
  const pure = counts["イノセント"] / N;
  const fake = counts["インポスター"] / N;
  const bomber = counts["ニュートラル"] / N;
  assert.ok(pure >= 0.28 && pure <= 0.68, `イノセント勝率 ${(pure * 100).toFixed(0)}%`);
  assert.ok(fake >= 0.28 && fake <= 0.68, `インポスター勝率 ${(fake * 100).toFixed(0)}%`);
  assert.ok(bomber <= 0.15, `ボマー勝率 ${(bomber * 100).toFixed(0)}%`);
});

test("revealMouse: インポスターを公開すると疑念が上がり、イノセントだと下がる", () => {
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

// 吹き出しの検証用：発言者のカードに付いた .speech-bubble を返す。
function bubbleOf(elements, playerId) {
  const card = elements.get("cards").children.find(
    (c) => c.getAttribute("data-player") === String(playerId));
  if (!card) return null;
  return card.children.find((c) => c.className === "speech-bubble") || null;
}
function allBubbles(elements) {
  return elements.get("cards").children.flatMap((c) =>
    c.children.filter((x) => x.className === "speech-bubble"));
}
// ログ行から吹き出しに入るはずのセリフ部分を取り出す。
// 議論セリフは「名前：セリフ」、マウス公開は「🐭 名前「セリフ」」形式。
function bubbleTextOf(line) {
  const m = line.match(/「(.*)」$/);
  if (m) return m[1];
  return line.slice(line.indexOf("：") + 1);
}
// 夜を1回回して議論フェーズまで進める。朝にならなかったら false。
function reachDiscussion(FB) {
  for (let i = 0; i < 15; i++) {
    FB.setupGame();
    const s = FB.state;
    const alive = s.players.filter((p) => p.alive);
    s.selectedId = alive.find((p) => p.id !== s.playerId).id;
    FB.runNight();
    if (s.phase === "morning") return true;
  }
  return false;
}

test("speech bubble: 議論の最初のセリフが発言者のカードに吹き出しで出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.ok(reachDiscussion(FB), "議論まで進まなかった");
  const before = elements.get("dialogueLog").children.length;
  FB.morningToDiscussion();
  const lines = elements.get("dialogueLog").children.slice(before).map((c) => c.textContent);
  assert.ok(lines.length > 0, "議論ログが出る");
  // 先頭の発言者のカードにだけ吹き出しが出て、セリフが入っている。
  const first = lines[0];
  const speaker = FB.state.players.find((p) => first.startsWith(`${p.name}：`) || first.startsWith(`🐭 ${p.name}「`));
  assert.ok(speaker, `先頭行の発言者が特定できない: ${first}`);
  const bubble = bubbleOf(elements, speaker.id);
  assert.ok(bubble, "発言者のカードに吹き出しがない");
  assert.equal(bubble.textContent, bubbleTextOf(first));
  assert.equal(allBubbles(elements).length, 1, "同時に表示される吹き出しは1つだけ");
  // ログへの記録は従来通り即時（全員分が残る）。
  assert.equal(elements.get("dialogueLog").children.length - before, lines.length);
});

test("speech bubble: キューが順番に処理される", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.ok(reachDiscussion(FB), "議論まで進まなかった");
  const before = elements.get("dialogueLog").children.length;
  FB.morningToDiscussion();
  const lines = elements.get("dialogueLog").children.slice(before).map((c) => c.textContent);
  assert.ok(lines.length >= 2, "キュー検証には2行以上のセリフが必要");
  const queued = FB.speechQueue.length;
  assert.ok(queued > 0, "残りのセリフがキューに残る");
  // 1件分が終わると次の発言者の吹き出しに切り替わる。
  const firstBubble = allBubbles(elements)[0];
  FB.expireSpeechBubble();
  assert.equal(FB.speechQueue.length, queued - 1);
  assert.equal(allBubbles(elements).length, 1, "切り替え後も吹き出しは1つだけ");
  assert.ok(!allBubbles(elements).includes(firstBubble), "前の吹き出しは消えている");
  const second = allBubbles(elements)[0];
  assert.ok(lines.slice(1).some((l) => bubbleTextOf(l) === second.textContent),
    "2番目の吹き出しは次のセリフのもの");
});

test("speech bubble: 議論中のマウス公開（再描画）でも表示中の吹き出しが残る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.ok(reachDiscussion(FB), "議論まで進まなかった");
  FB.morningToDiscussion();
  const firstBubble = allBubbles(elements)[0];
  assert.ok(firstBubble, "議論の吹き出しが出ていない");
  const firstText = firstBubble.textContent;
  // 表示中の吹き出しがある最中に、別の発言者がマウス公開する。
  // revealMouse は内部で draw() を呼び #cards を再構築する。
  const me = humanOf(FB);
  me.roleKey = "mouse";
  me.mouseUsed = false;
  const target = FB.state.players.find((p) => p.alive && p.id !== me.id);
  FB.revealMouse(me, target);
  // 表示中の吹き出しが発言者の新しいカードへ付け直されている。
  const kept = allBubbles(elements).find((b) => b.textContent === firstText);
  assert.ok(kept, "再描画で表示中の吹き出しが消えた");
  // キューは捨てられていない（マウス公開のセリフが後続に残る）。
  assert.ok(FB.speechQueue.length > 0, "再描画でキューが捨てられた");
  // 期限切れでキューが進み、やがてマウス公開の吹き出しが出る
  // （マウス公開のセリフはキューの末尾に入るため、直後とは限らない）。
  let sawMouse = false;
  for (let i = 0; i < 20 && !sawMouse; i++) {
    FB.expireSpeechBubble();
    const b = allBubbles(elements)[0];
    if (b && b.textContent.includes("マウス能力")) sawMouse = true;
    if (!b && FB.speechQueue.length === 0) break;
  }
  assert.ok(sawMouse, "キューを進めてもマウス公開の吹き出しが出ない");
});

test("speech bubble: マウス公開のセリフがマウスのカードに吹き出しで出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  s.phase = "discussion";
  FB.draw();
  const me = humanOf(FB);
  me.roleKey = "mouse";
  me.mouseUsed = false;
  const target = s.players.find((p) => p.alive && p.id !== me.id);
  FB.revealMouse(me, target);
  const bubble = bubbleOf(elements, me.id);
  assert.ok(bubble, "マウスのカードに吹き出しがない");
  assert.ok(bubble.textContent.includes(target.name), "吹き出しに公開対象の名前が入る");
  assert.equal(allBubbles(elements).length, 1);
});

test("speech bubble: 投票フェーズへ移ると吹き出しとキューが消える", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  assert.ok(reachDiscussion(FB), "議論まで進まなかった");
  FB.morningToDiscussion();
  assert.equal(allBubbles(elements).length, 1, "議論中は吹き出しが出る");
  assert.ok(FB.speechQueue.length > 0, "議論中はキューが残る");
  FB.discussionToVote();
  assert.equal(FB.state.phase, "vote");
  assert.equal(allBubbles(elements).length, 0, "投票フェーズに吹き出しが残らない");
  assert.equal(FB.speechQueue.length, 0, "投票フェーズにキューが残らない");
});

test("speech bubble: 夜の個人結果では吹き出しが出ない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const alive = s.players.filter((p) => p.alive);
  s.selectedId = alive.find((p) => p.id !== s.playerId).id;
  FB.runNight();
  assert.ok(["morning", "end"].includes(s.phase), `夜が解決されなかった: ${s.phase}`);
  assert.equal(allBubbles(elements).length, 0, "夜の結果で吹き出しが出てはいけない");
  assert.equal(FB.speechQueue.length, 0, "夜の結果でキューが残ってはいけない");
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
      const end = playFullGame(FB, elements);
      assert.equal(end.phase, "end", `設定 ${JSON.stringify(settings)} #${i} が終わらなかった`);
      assert.ok(["イノセント", "インポスター", "ニュートラル"].includes(end.winnerFaction));
      assert.ok(end.day <= 40);
      // 結果画面のハイライト欄が空でないこと（フォールバック行でもよい）
      assert.ok(elements.get("resultHighlights").innerHTML.length > 0);
      const stats = JSON.parse(localStorage.getItem("fakeBloomStats"));
      assert.equal(stats.games, 1);
      assert.equal(stats.wins, end.myWin ? 1 : 0);
    }
  }
});

test("アクセシビリティ: プレイヤーカードはキーボードで選べる", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const cards = elements.get("cards").children;
  assert.equal(cards.length, 8);
  const me = s.players[s.playerId];
  // 生存カードは role=button・tabIndex=0・名前と状態を含む aria-label を持つ
  for (const card of cards) {
    assert.equal(card.getAttribute("role"), "button");
    assert.equal(card.tabIndex, 0);
    assert.match(card.getAttribute("aria-label"), /生存中/);
  }
  // Enter / Space で対象選択（夜フェーズ）。自分以外を選ぶ。
  const target = s.players.find((p) => p.id !== me.id);
  const card = cards[target.id];
  card.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(s.selectedId, target.id);
  s.selectedId = null;
  card.dispatch("keydown", { key: " ", preventDefault() {} });
  assert.equal(s.selectedId, target.id);
  // 関係ないキーは何もしない
  s.selectedId = null;
  card.dispatch("keydown", { key: "a", preventDefault() {} });
  assert.equal(s.selectedId, null);

  // 脱落したカードはタブ移動から外れ、aria-disabled になる
  target.alive = false;
  FB.draw();
  const deadCard = elements.get("cards").children[target.id];
  assert.equal(deadCard.tabIndex, -1);
  assert.equal(deadCard.getAttribute("aria-disabled"), "true");
  assert.match(deadCard.getAttribute("aria-label"), /脱落済み/);
});

test("アクセシビリティ: 設定ボタンは aria-pressed で選択状態を示す", () => {
  const { FB, sandbox } = loadGame({ seedSettings: { ...BASE_SETTINGS, difficulty: "hard", sound: "off" } });
  // paintSettings が読む .seg をスタブで用意する（静的 HTML のボタン相当）。
  const mkBtn = (value) => ({
    dataset: { value },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
  });
  const buttons = [mkBtn("easy"), mkBtn("normal"), mkBtn("hard")];
  const seg = { dataset: { setting: "difficulty" }, querySelectorAll: () => buttons };
  sandbox.document.querySelectorAll = (sel) => (sel === ".seg" ? [seg] : []);
  FB.paintSettings();
  assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
  assert.equal(buttons[2].getAttribute("aria-pressed"), "true");
});

test("gameSettings: パス＆プレイ設定の既定値と不正値の扱い", () => {
  const def = loadGame({ seedSettings: BASE_SETTINGS });
  assert.equal(def.FB.gameSettings.mode, "solo");
  assert.equal(def.FB.gameSettings.humanCount, "2");
  const pnp = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "5" } });
  assert.equal(pnp.FB.gameSettings.mode, "pnp");
  assert.equal(pnp.FB.gameSettings.humanCount, "5");
  const bad = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "party", humanCount: "9" } });
  assert.equal(bad.FB.gameSettings.mode, "solo");
  assert.equal(bad.FB.gameSettings.humanCount, "2");
});

test("paintSettings: 参加人数の行はパス＆プレイのときだけ表示される", () => {
  const solo = loadGame({ seedSettings: BASE_SETTINGS });
  solo.FB.paintSettings();
  assert.equal(solo.elements.get("humanCountRow").classList.contains("hidden"), true);
  const pnp = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp" } });
  pnp.FB.paintSettings();
  assert.equal(pnp.elements.get("humanCountRow").classList.contains("hidden"), false);
});

test("パス＆プレイ: 受け渡し画面で全員の役職を順番に確認できる", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "3" } });
  FB.setupGame();
  const s = FB.state;
  assert.equal(s.mode, "pnp");
  assert.equal(s.humanPlayerIds.length, 3);
  assert.equal(new Set(s.humanPlayerIds).size, 3);
  assert.equal(s.pnpIndex, 0);
  // ソロの役職画面は出ない（showRole が呼ばれず playerRole 要素も作られない）
  assert.equal(elements.has("playerRole"), false);
  for (let i = 0; i < 3; i++) {
    const player = s.players[s.humanPlayerIds[i]];
    const cover = elements.get("pnpCoverText").innerHTML;
    assert.ok(cover.includes(`P${i + 1}`), `カバー画面は P${i + 1} を示す`);
    assert.ok(cover.includes(player.name), "カバー画面はキャラ名を示す");
    assert.ok(!cover.includes(FB.ROLES[player.roleKey].name), "カバー画面に役職名は出ない");
    elements.get("pnpRevealBtn").onclick();
    const roleHtml = elements.get("pnpPlayerRole").innerHTML;
    assert.ok(roleHtml.includes(player.name), "役職画面は本人の名前を示す");
    // バカには表示役職だけが見える（役職画面は表示役職を示す）。
    assert.ok(roleHtml.includes(FB.ROLES[FB.getEffectiveRoleKey(player)].name), "役職画面は本人の役職を示す");
    elements.get("pnpConfirmBtn").onclick();
    if (i < 2) {
      assert.equal(elements.get("pnpRole").classList.contains("hidden"), true, "確認後は次の人のカバー画面に戻る");
    }
  }
  assert.equal(s.pnpIndex, 2);
  // 受け渡し完了後はそのまま夜行動の順番入力へ（フェーズ2）。
  // 受け渡し画面は閉じず、夜のカバー画面に切り替わる。
  assert.equal(elements.get("pnpScreen").classList.contains("hidden"), false, "受け渡し後は夜のカバー画面が出る");
  assert.equal(s.pnpStep, "nightCover");
  assert.match(elements.get("pnpCoverText").innerHTML, /夜行動/);
});

test("パス＆プレイ: 人間の調査結果が行動ログに出ない", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  for (let i = 0; i < 10; i++) {
    FB.setupGame();
    const s = FB.state;
    const humans = s.humanPlayerIds.map((id) => s.players[id]);
    const others = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
    s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
    humans[0].roleKey = "apprenticeSeer";
    others[0].roleKey = "fakeGirl";
    FB.runNight();
    assert.equal(s.phase, "morning");
    const lines = elements.get("actionLog").children.map((c) => c.textContent);
    assert.ok(!lines.some((l) => l.includes("判定:")), `調査結果が漏れた: ${lines.join(" / ")}`);
    assert.ok(!lines.some((l) => l.includes("の正体は")));
  }
});

test("フルゲーム: パス＆プレイで40日以内に決着し、個人情報が漏れず戦績も汚れない", () => {
  const PRIVATE_MARKERS = [/判定:/, /の正体は/, /を訪れた人/, /訪問先/, /罠設置 →/, /診察 →/, /爆弾設置 →/, /妨害されて/, /→ 防衛$/];
  for (const humanCount of ["2", "8"]) {
    for (let i = 0; i < 5; i++) {
      const { FB, elements, localStorage } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount, bomber: "on" } });
      const end = playFullGame(FB, elements);
      assert.equal(end.phase, "end", `パス＆プレイ ${humanCount}人 #${i} が終わらなかった`);
      assert.ok(end.day <= 40);
      assert.equal(end.myWin, null);
      assert.match(elements.get("resultSub").textContent, /パス＆プレイ/);
      assert.ok(!elements.get("resultRows").innerHTML.includes("（あなた）"), "結果画面に（あなた）が出ない");
      assert.equal(localStorage.getItem("fakeBloomStats"), null, "パス＆プレイでソロ戦績が記録されない");
      // フェーズ4：パス＆プレイの戦績は別キーに記録される。
      const pnpStats = JSON.parse(localStorage.getItem("fakeBloomPnpStats"));
      assert.equal(pnpStats.games, 1, "パス＆プレイの戦績が1戦記録される");
      assert.ok(["イノセント", "インポスター", "ニュートラル"].includes(Object.keys(pnpStats.factionWins)[0]), "勝った陣営が記録される");
      const actionLines = elements.get("actionLog").children.map((c) => c.textContent);
      for (const line of actionLines) {
        for (const marker of PRIVATE_MARKERS) {
          assert.ok(!marker.test(line), `行動ログに個人情報が漏れた: ${line}`);
        }
      }
      const humanNames = end.humanPlayerIds.map((id) => end.players[id].name);
      const talkLines = elements.get("dialogueLog").children.map((c) => c.textContent);
      for (const line of talkLines) {
        assert.ok(!humanNames.some((n) => line.startsWith(`${n}：`)), `人間の自動セリフが漏れた: ${line}`);
      }
    }
  }
});

test("アクセシビリティ: ログは aria-live、設定グループは role=group を持つ", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<div id="dialogueLog" class="log" aria-live="polite">/);
  assert.match(html, /<div id="actionLog" class="log" aria-live="polite">/);
  for (const label of ["インポスター人数", "効果音", "BGM", "難易度", "ボマー", "遊び方", "参加人数", "議論タイマー"]) {
    assert.ok(html.includes(`role="group" aria-label="${label}"`), `${label} の設定グループ`);
  }
});

test("CSS 変数監査: var(--x) は :root で定義されているか、要素の style 属性で与えられるものだけ", () => {
  // 2026-11-12 の不具合：.seg button.active が未定義の --accent/--accent2 を参照し、
  // 背景が透明になって白文字が見えなくなっていた（--line も未定義で枠線が出ていなかった）。
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const root = style.match(/:root \{([\s\S]*?)\}/)[1];
  const defined = new Set([...root.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  // 要素の style 属性で与えられる変数（歩行者の --i / --bd）は例外。
  const inlineVars = new Set(["i", "bd"]);
  const used = new Set([...style.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)].map((m) => m[1]));
  for (const name of used) {
    assert.ok(defined.has(name) || inlineVars.has(name), `未定義の CSS 変数 var(--${name}) が使われている`);
  }
  // 報告された不具合の再発防止：選択中の設定ボタンはピンク→紫のグラデ＋白文字。
  for (const name of ["accent", "accent2", "line"]) {
    assert.ok(defined.has(name), `:root に --${name} が定義されていない`);
  }
  assert.match(style, /\.seg button\.active \{[^}]*background: linear-gradient\(90deg, var\(--accent\), var\(--accent2\)\)/);
  assert.match(style, /\.seg \{[^}]*border: 2px solid var\(--line\)/);
});

test("パス＆プレイ フェーズ2: 夜行動の順番入力で人間の対象が使われ、結果は本人だけに貯まる", () => {
  // 単独インポスターの妨害で占い師がブロックされる回があるため、妨害されずに
  // 調査が通った回で検証する（妨害の対象は CPU 守り手と占い師からランダム）。
  for (let attempt = 0; attempt < 10; attempt++) {
    const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
    FB.setupGame();
    const s = FB.state;
    const humans = s.humanPlayerIds.map((id) => s.players[id]);
    const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
    s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; p.clumsy = false; });
    humans[0].roleKey = "apprenticeSeer";
    cpus[0].roleKey = "fakeGirl";
    cpus[1].roleKey = "guardian";
    // 受け渡しを全員分進める（最後の確認で夜入力が始まる）
    for (let i = 0; i < 2; i++) {
      elements.get("pnpRevealBtn").onclick();
      elements.get("pnpConfirmBtn").onclick();
    }
    assert.equal(s.pnpStep, "nightCover");
    assert.equal(s.phase, "night");
    // P1（占い師）の番：カバー→対象選択→決定
    elements.get("pnpRevealBtn").onclick();
    assert.equal(s.pnpStep, "nightAction");
    assert.equal(FB.pnpNightCurrentPlayer().id, humans[0].id);
    assert.equal(elements.get("pnpTurnBanner").classList.contains("hidden"), false);
    assert.match(elements.get("pnpTurnBanner").textContent, /見習い占い師/);
    s.selectedId = cpus[0].id; // インポスターを調査
    elements.get("actionBtn").onclick();
    assert.equal(s.pnpNightInputs[humans[0].id], cpus[0].id);
    // P2（村ガール）の番：能力なし画面で確認だけ
    assert.equal(s.pnpStep, "nightCover");
    elements.get("pnpRevealBtn").onclick();
    assert.equal(s.pnpStep, "nightNoAction");
    assert.match(elements.get("pnpPlayerRole").innerHTML, /能力がありません/);
    elements.get("pnpConfirmBtn").onclick();
    // 夜が解決される
    assert.equal(s.phase, "morning");
    const inv = s.lastInvestigation[humans[0].id];
    if (!inv) continue; // 占い師が妨害された回はやり直し
    assert.equal(inv.result, "インポスター");
    assert.equal(inv.targetId, cpus[0].id);
    // 結果は本人の pnpNightResults に貯まり、公開ログには出ない
    const mine = s.pnpNightResults[humans[0].id] || [];
    assert.ok(mine.some((m) => m.includes("判定: インポスター")), `本人の結果: ${mine.join(" / ")}`);
    const lines = elements.get("actionLog").children.map((c) => c.textContent);
    assert.ok(!lines.some((l) => l.includes("判定:")), `調査結果が漏れた: ${lines.join(" / ")}`);
    // 人間の調査は CPU の疑念を上げない（ソロと同じ）
    assert.equal(cpus[0].suspicion, 0);
    return;
  }
  assert.fail("10回試しても妨害されない夜を引けなかった");
});

test("パス＆プレイ フェーズ2: 夜結果は次の夜の番で本人だけに表示され、他人には見えない", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "apprenticeSeer";
  // 前夜の結果が貯まっている状態を作る（解決時の蓄積は別テストで確認）
  s.pnpNightResults[humans[0].id] = ["見習い占い師 → ルナ → 判定: インポスター"];
  s.phase = "night";
  FB.startPnpNight();
  assert.equal(s.pnpStep, "nightCover");
  // P1の番：カバー→前夜の結果が本人だけに表示される
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightResult");
  assert.match(elements.get("pnpPlayerRole").innerHTML, /判定: インポスター/);
  assert.match(elements.get("pnpRoleTitle").textContent, /前夜の結果/);
  // 結果を見た後は消費される（vm 内の配列なので長さで確認する）
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightAction");
  assert.equal(s.pnpNightResults[humans[0].id].length, 0);
  // P1の入力を済ませ、P2の番へ。P2の画面にP1の結果は出ない
  s.selectedId = cpus[0].id;
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightNoAction");
  assert.ok(!elements.get("pnpPlayerRole").innerHTML.includes("判定:"));
});

test("パス＆プレイ フェーズ2: インポスター人間の代表者が入力した襲撃先が使われる", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "fakeGirl";
  humans[1].roleKey = "mimic"; // インポスター人間2人：代表者は humans[0]
  const victim = cpus[0];
  // 受け渡しを全員分進める
  for (let i = 0; i < 2; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  // P1（代表者）の番：襲撃先を入力
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightAction");
  assert.equal(FB.pnpHumanFakeRep().id, humans[0].id);
  s.selectedId = victim.id;
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpNightInputs[humans[0].id], victim.id);
  // P2（代表者以外）の番：合意画面で襲撃先を確認する（フェーズ3で相談画面から変更）
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAgree");
  assert.match(elements.get("pnpPlayerRole").innerHTML, /合意/);
  assert.ok(elements.get("pnpPlayerRole").innerHTML.includes(victim.name), "合意画面は襲撃先を示す");
  // 合意のあと、能力（盗み見）の対象を入力する
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAbility");
  s.selectedId = cpus[1].id;
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpNightInputs[humans[1].id], cpus[1].id);
  // 夜が解決され、入力した襲撃先が倒れる
  assert.equal(s.phase, "morning");
  assert.equal(victim.alive, false);
  assert.equal(victim.deathCause, "襲撃");
  assert.equal(s.nightReport.type, "eliminated");
  assert.equal(s.nightReport.victimId, victim.id);
});

test("パス＆プレイ フェーズ3: インポスター仲間の表示に P 番号が付く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "fakeGirl";
  humans[1].roleKey = "mimic";
  // P1 の役職画面を開く（受け渡し画面）。
  elements.get("pnpRevealBtn").onclick();
  const roleHtml = elements.get("pnpPlayerRole").innerHTML;
  assert.ok(roleHtml.includes(`インポスター仲間：P2（${humans[1].name}）`), `仲間確認: ${roleHtml}`);
});

test("パス＆プレイ フェーズ3: インポスター非代表者は襲撃先に合意し、能力の対象を入力する", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "fakeGirl"; // 代表者（humanPlayerIds の先頭）
  humans[1].roleKey = "mimic"; // 非代表者：盗み見の対象を入力する
  const victim = cpus[0];
  const spyTarget = cpus[1];
  // 受け渡しを全員分進める
  for (let i = 0; i < 2; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  // P1（代表者）の番：襲撃先を入力
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightAction");
  s.selectedId = victim.id;
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpNightInputs[humans[0].id], victim.id);
  // P2（非代表者）の番：合意画面に代表者の襲撃先が出る
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAgree");
  assert.match(elements.get("pnpPlayerRole").innerHTML, /合意/);
  assert.ok(elements.get("pnpPlayerRole").innerHTML.includes(victim.name), "合意画面は襲撃先を示す");
  // 合意すると能力入力画面へ
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAbility");
  assert.match(elements.get("pnpTurnBanner").textContent, /盗み見/);
  // インポスターの仲間は能力の対象に選べない
  FB.selectTarget(humans[0].id);
  assert.equal(s.selectedId, null, "インポスターの仲間は能力の対象に選べない");
  FB.selectTarget(spyTarget.id);
  assert.equal(s.selectedId, spyTarget.id);
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpNightInputs[humans[1].id], spyTarget.id);
  // 夜が解決され、襲撃先が倒れ、盗み見の対象が記録される
  assert.equal(s.phase, "morning");
  assert.equal(victim.alive, false);
  assert.equal(victim.deathCause, "襲撃");
  assert.equal(s.nightActions[humans[1].id], spyTarget.id);
  assert.equal(s.fakeIntel[spyTarget.id], spyTarget.roleKey);
  // 盗み見の結果は本人の夜結果に貯まり、公開ログに出ない
  const mine = s.pnpNightResults[humans[1].id] || [];
  assert.ok(mine.some((m) => m.includes("正体は")), `本人の盗み見結果: ${mine.join(" / ")}`);
  const lines = elements.get("actionLog").children.map((c) => c.textContent);
  assert.ok(!lines.some((l) => l.includes("正体は")), `盗み見の結果が漏れた: ${lines.join(" / ")}`);
});

test("パス＆プレイ フェーズ3: 投票の順番入力で人間の票が集計に使われる", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "3", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  cpus[0].roleKey = "fakeGirl"; // 夜に襲撃するインポスター（全員村人だと夜1で即勝利するため）
  // 受け渡しを全員分進める（最後の確認で夜入力が始まる）
  for (let i = 0; i < 3; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  // 夜は全員能力なしで進む
  playPnpNight(FB, elements);
  assert.equal(s.phase, "morning");
  FB.morningToDiscussion();
  // 投票先：インポスターの CPU を人間全員で狙う。CPU の票も同じ相手へ向くよう
  // 疑念を上げておく（難易度 normal のブレ幅 1 より十分大きい）。
  const target = cpus[0];
  target.suspicion = 10;
  FB.discussionToVote();
  assert.equal(s.phase, "vote");
  assert.equal(s.pnpStep, "voteCover");
  assert.equal(elements.get("pnpScreen").classList.contains("hidden"), false);
  const aliveHumans = s.humanPlayerIds.filter((id) => s.players[id].alive);
  for (const humanId of aliveHumans) {
    const player = s.players[humanId];
    const cover = elements.get("pnpCoverText").innerHTML;
    assert.ok(cover.includes(player.name), "投票カバーは番の人の名前を示す");
    assert.ok(!cover.includes(target.name), "投票カバーに投票先は出ない");
    elements.get("pnpRevealBtn").onclick();
    assert.equal(s.pnpStep, "voteAction");
    assert.equal(FB.pnpVoteCurrentPlayer().id, player.id);
    assert.equal(elements.get("voteBtn").textContent, "この相手に投票する");
    assert.equal(elements.get("pnpTurnBanner").classList.contains("hidden"), false);
    assert.match(elements.get("pnpTurnBanner").textContent, /投票/);
    // 自分への投票は選べない
    s.selectedId = player.id;
    elements.get("voteBtn").onclick();
    assert.equal(s.pnpVoteInputs[player.id], undefined, "自分への投票は記録されない");
    assert.equal(s.pnpStep, "voteAction", "無効な投票では番が進まない");
    s.selectedId = target.id;
    elements.get("voteBtn").onclick();
    assert.equal(s.pnpVoteInputs[player.id], target.id);
  }
  // 全員分が終わると集計され、狙った相手が追放される
  assert.equal(target.alive, false);
  assert.equal(target.deathCause, "追放");
  assert.equal(s.phase, "end", "インポスターを追放してイノセント陣営の勝利");
});

test("tallyVotes: 政治家の票は2票分で、パス＆プレイの集計でも反映される", () => {
  const { FB } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "politician";
  cpus[0].roleKey = "fakeGirl";
  const targetA = cpus[0];
  const targetB = cpus[1];
  s.phase = "vote";
  const votes = new Map();
  FB.addVoteTo(votes, targetA.id, humans[0]); // 政治家：2票
  FB.addVoteTo(votes, targetB.id, humans[1]); // 1票
  FB.tallyVotes(votes);
  // 政治家の2票がなければ同数で追放なしになる
  assert.equal(targetA.alive, false);
  assert.equal(targetA.deathCause, "追放");
  assert.equal(targetB.alive, true);
  assert.equal(s.phase, "end", "インポスターを追放してイノセント陣営の勝利");
});

test("gameSettings: 議論タイマーの既定値と不正値の扱い", () => {
  const def = loadGame({ seedSettings: BASE_SETTINGS });
  assert.equal(def.FB.gameSettings.discussTimer, "0");
  const timed = loadGame({ seedSettings: { ...BASE_SETTINGS, discussTimer: "120" } });
  assert.equal(timed.FB.gameSettings.discussTimer, "120");
  const bad = loadGame({ seedSettings: { ...BASE_SETTINGS, discussTimer: "90" } });
  assert.equal(bad.FB.gameSettings.discussTimer, "0");
  // discussTimer キー自体がない古い設定 → 後方互換でなし
  const legacy = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp" } });
  assert.equal(legacy.FB.gameSettings.discussTimer, "0");
});

test("paintSettings: 議論タイマーの行はパス＆プレイのときだけ表示される", () => {
  const solo = loadGame({ seedSettings: BASE_SETTINGS });
  solo.FB.paintSettings();
  assert.equal(solo.elements.get("discussTimerRow").classList.contains("hidden"), true);
  const pnp = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp" } });
  pnp.FB.paintSettings();
  assert.equal(pnp.elements.get("discussTimerRow").classList.contains("hidden"), false);
});

test("morningToDiscussion: パス＆プレイでは CPU の発言数が人数に応じて減る", () => {
  const countNewTalkLines = (FB, elements, setup) => {
    FB.setupGame();
    setup();
    const s = FB.state;
    s.phase = "morning";
    const before = elements.get("dialogueLog").children.length;
    FB.morningToDiscussion();
    assert.equal(s.phase, "discussion");
    return elements.get("dialogueLog").children.length - before;
  };
  // ソロ：CPU 7人全員が発言する（従来通り）。
  const solo = loadGame({ seedSettings: BASE_SETTINGS });
  assert.equal(countNewTalkLines(solo.FB, solo.elements, () => {}), 7);
  // パス＆プレイ2人：上限4人まで（CPU 6人中4人）。
  const pnp2 = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  assert.equal(countNewTalkLines(pnp2.FB, pnp2.elements, () => assert.equal(pnp2.FB.pnpCpuTalkCap(), 4)), 4);
  // パス＆プレイ6人：上限1人まで（CPU 2人中1人）。
  const pnp6 = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "6" } });
  assert.equal(countNewTalkLines(pnp6.FB, pnp6.elements, () => assert.equal(pnp6.FB.pnpCpuTalkCap(), 1)), 1);
  // パス＆プレイ8人：CPU がいないので発言は0行。
  const pnp8 = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "8" } });
  assert.equal(countNewTalkLines(pnp8.FB, pnp8.elements, () => {}), 0);
});

test("議論タイマー: パス＆プレイの議論で残り時間が表示され、時間切れで投票を促す", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", discussTimer: "60" } });
  FB.setupGame();
  const s = FB.state;
  s.phase = "morning";
  FB.morningToDiscussion();
  assert.equal(s.phase, "discussion");
  const box = elements.get("discussTimer");
  assert.equal(box.classList.contains("hidden"), false);
  assert.match(box.textContent, /残り 1:00/);
  // 59秒進めると残り1秒になる
  for (let i = 0; i < 59; i++) FB.discussTimerTick();
  assert.match(box.textContent, /残り 0:01/);
  // 最後の1秒で時間切れになり、投票を促す（自動では進まない）
  FB.discussTimerTick();
  assert.match(box.textContent, /時間切れ/);
  const lines = elements.get("actionLog").children.map((c) => c.textContent);
  assert.ok(lines.some((l) => l.includes("議論時間")), `時間切れの合図: ${lines.join(" / ")}`);
  assert.equal(s.phase, "discussion", "時間切れでも自動で投票へは進まない");
  // 投票へ進むとタイマー表示が消える
  FB.discussionToVote();
  assert.equal(box.classList.contains("hidden"), true);
  assert.equal(s.phase, "vote");
});

test("議論タイマー: 残り30秒以下で警告色になり、時間切れで投票ボタンが目立つ", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", discussTimer: "60" } });
  FB.setupGame();
  const s = FB.state;
  s.phase = "morning";
  FB.morningToDiscussion();
  const box = elements.get("discussTimer");
  const nextBtn = elements.get("nextBtn");
  // 開始直後（残り60秒）は警告なし
  assert.equal(box.classList.contains("timer-low"), false);
  assert.equal(box.classList.contains("timer-expired"), false);
  assert.equal(nextBtn.classList.contains("vote-ready"), false);
  // 29秒進めて残り31秒：まだ警告なし
  for (let i = 0; i < 29; i++) FB.discussTimerTick();
  assert.match(box.textContent, /残り 0:31/);
  assert.equal(box.classList.contains("timer-low"), false);
  // 残り30秒で警告色が付く
  FB.discussTimerTick();
  assert.match(box.textContent, /残り 0:30/);
  assert.equal(box.classList.contains("timer-low"), true);
  assert.equal(box.classList.contains("timer-expired"), false);
  assert.equal(nextBtn.classList.contains("vote-ready"), false);
  // 時間切れで投票ボタンが目立ち、タイマーも時間切れ色になる
  for (let i = 0; i < 30; i++) FB.discussTimerTick();
  assert.match(box.textContent, /時間切れ/);
  assert.equal(box.classList.contains("timer-low"), false);
  assert.equal(box.classList.contains("timer-expired"), true);
  assert.equal(nextBtn.classList.contains("vote-ready"), true);
  assert.equal(s.phase, "discussion", "時間切れでも自動で投票へは進まない");
  // 投票へ進むと強調がすべて外れる
  FB.discussionToVote();
  assert.equal(box.classList.contains("hidden"), true);
  assert.equal(box.classList.contains("timer-expired"), false);
  assert.equal(nextBtn.classList.contains("vote-ready"), false);
});

test("議論タイマー: タイマーなし（既定）では議論中に表示されない", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  FB.setupGame();
  const s = FB.state;
  s.phase = "morning";
  FB.morningToDiscussion();
  assert.equal(elements.get("discussTimer").classList.contains("hidden"), true);
  // ソロでもタイマー設定があっても表示されない
  const solo = loadGame({ seedSettings: { ...BASE_SETTINGS, discussTimer: "60" } });
  solo.FB.setupGame();
  solo.FB.state.phase = "morning";
  solo.FB.morningToDiscussion();
  assert.equal(solo.elements.get("discussTimer").classList.contains("hidden"), true);
});

test("パス＆プレイ フェーズ4: 戦績は別キーに記録され、ソロ戦績は汚れない", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  // インポスターを全員脱落させてイノセント勝利にする
  s.players.filter((p) => FB.ROLES[p.roleKey].faction === "インポスター").forEach((p) => { p.alive = false; });
  FB.showResults("🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  assert.equal(s.winnerFaction, "イノセント");
  assert.equal(localStorage.getItem("fakeBloomStats"), null, "ソロ戦績は記録されない");
  const pnp = JSON.parse(localStorage.getItem("fakeBloomPnpStats"));
  assert.equal(pnp.games, 1);
  assert.equal(pnp.factionWins["イノセント"], 1);
  for (const h of humans) {
    const entry = pnp.byRole[h.roleKey];
    assert.ok(entry && entry.games === 1, `${h.roleKey} の戦績が記録される`);
    assert.equal(entry.wins, FB.ROLES[h.roleKey].faction === "イノセント" ? 1 : 0);
  }
  // タイトル画面のパス＆プレイ戦績パネルに表示される
  assert.match(elements.get("pnpStatsSummary").textContent, /通算 1戦/);
  assert.match(elements.get("pnpStatsSummary").textContent, /イノセント勝利 1/);
  // 2試合目は加算される（インポスター勝利で）
  FB.setupGame();
  const s2 = FB.state;
  s2.players.filter((p) => FB.ROLES[p.roleKey].faction === "イノセント").forEach((p) => { p.alive = false; });
  FB.showResults("💀 インポスター陣営の勝利…生存者数が同数以上になった。");
  const pnp2 = JSON.parse(localStorage.getItem("fakeBloomPnpStats"));
  assert.equal(pnp2.games, 2);
  assert.equal(pnp2.factionWins["イノセント"], 1);
  assert.equal(pnp2.factionWins["インポスター"], 1);
});

test("renderPnpStats: 保存されたパス＆プレイ戦績が表示される", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  localStorage.setItem("fakeBloomPnpStats", JSON.stringify({
    games: 5, factionWins: { "イノセント": 3, "インポスター": 2 },
    byRole: { villager: { games: 4, wins: 2 }, fakeGirl: { games: 1, wins: 1 } },
  }));
  FB.renderPnpStats();
  assert.match(elements.get("pnpStatsSummary").textContent, /通算 5戦/);
  assert.match(elements.get("pnpStatsSummary").textContent, /イノセント勝利 3/);
  assert.match(elements.get("pnpStatsSummary").textContent, /インポスター勝利 2/);
  const chips = elements.get("pnpStatsRoles").innerHTML;
  assert.ok(chips.includes("村ガール：4戦2勝"), `役職チップ: ${chips}`);
  assert.ok(chips.includes("フェイクガール：1戦1勝"), `役職チップ: ${chips}`);
  // 記録がない場合は「まだ記録がありません」になる
  const fresh = loadGame({ seedSettings: BASE_SETTINGS });
  assert.match(fresh.elements.get("pnpStatsSummary").textContent, /まだパス＆プレイの記録がありません/);
});

test("renderPnpStats: 改名前の陣営キー（ピュア／フェイク）で保存された戦績は新陣営名へ読み替える", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  localStorage.setItem("fakeBloomPnpStats", JSON.stringify({
    games: 5, factionWins: { "ピュア": 3, "フェイク": 2 },
    byRole: { villager: { games: 4, wins: 2 } },
  }));
  FB.renderPnpStats();
  assert.match(elements.get("pnpStatsSummary").textContent, /イノセント勝利 3/);
  assert.match(elements.get("pnpStatsSummary").textContent, /インポスター勝利 2/);
  assert.doesNotMatch(elements.get("pnpStatsSummary").textContent, /ピュア勝利|フェイク勝利/);
});

test("フルゲーム: 議論タイマー付きのパス＆プレイでも40日以内に決着する", () => {
  for (const humanCount of ["2", "6"]) {
    const { FB, elements, localStorage } = loadGame({
      seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount, bomber: "on", discussTimer: "60" },
    });
    const end = playFullGame(FB, elements);
    assert.equal(end.phase, "end", `パス＆プレイ ${humanCount}人・タイマー付きが終わらなかった`);
    assert.ok(end.day <= 40);
    assert.equal(JSON.parse(localStorage.getItem("fakeBloomPnpStats")).games, 1);
    assert.equal(localStorage.getItem("fakeBloomStats"), null);
  }
});

test("画面遷移：結果画面で見出し（resultTitle）にフォーカスが移る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  FB.showResults("🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  assert.equal(elements.get("resultTitle")._focused, true);
});

test("画面遷移：タイトル→役職画面→ゲーム画面でフォーカスが移る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  elements.get("startBtn").onclick();
  assert.equal(elements.get("roleScreenTitle")._focused, true, "役職画面の見出しへ");
  elements.get("toGameBtn").onclick();
  assert.equal(elements.get("phaseText")._focused, true, "ゲーム画面のフェーズ表示へ");
});

test("画面遷移：パス＆プレイのカバー→役職確認でボタンにフォーカスが移る", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  elements.get("startBtn").onclick();
  assert.equal(elements.get("pnpRevealBtn")._focused, true, "受け渡しカバーで表示ボタンへ");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(elements.get("pnpConfirmBtn")._focused, true, "役職確認で確認ボタンへ");
});

test("画面遷移：リトライで役職画面の見出しにフォーカスが移る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  elements.get("startBtn").onclick();
  playFullGame(FB, elements);
  assert.equal(FB.state.phase, "end");
  elements.get("roleScreenTitle")._focused = false;
  elements.get("retryBtn").onclick();
  assert.equal(elements.get("roleScreenTitle")._focused, true);
});

test("結果画面：タイトルに戻るボタンでタイトルへ戻り、戦績が更新される", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  elements.get("startBtn").onclick();
  playFullGame(FB, elements);
  assert.equal(FB.state.phase, "end");
  // 結果画面ではリトライとタイトルに戻るの両方が出る。
  assert.equal(elements.get("retryBtn").classList.contains("hidden"), false);
  assert.equal(elements.get("titleBtn").classList.contains("hidden"), false);
  // タイトルへ戻るとゲーム画面が隠れ、タイトルが出て戦績が更新される。
  elements.get("titleBtn").onclick();
  assert.equal(elements.get("titleScreen").classList.contains("hidden"), false);
  assert.equal(elements.get("gameScreen").classList.contains("hidden"), true);
  assert.equal(elements.get("titleBtn").classList.contains("hidden"), true);
  assert.equal(elements.get("retryBtn").classList.contains("hidden"), true);
  assert.equal(elements.get("startBtn")._focused, true);
  assert.match(elements.get("statsSummary").textContent, /通算 1戦/);
  assert.equal(JSON.parse(localStorage.getItem("fakeBloomStats")).games, 1);
  // タイトルから START すると新しい試合が始まり、ボタンは隠れたまま。
  elements.get("startBtn").onclick();
  assert.equal(FB.state.phase, "night");
  assert.equal(elements.get("titleBtn").classList.contains("hidden"), true);
  assert.equal(elements.get("retryBtn").classList.contains("hidden"), true);
});

test("キャラモーション第1弾：待機の呼吸と公開イベントのモーションCSSがある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  // 待機の呼吸：ステージの歩行者に歩行＋呼吸の2アニメーション
  assert.match(html, /\.stage \.walker \{[^}]*animation-name: walkAcross, stageBreathe/);
  assert.match(html, /@keyframes stageBreathe/);
  for (const name of ["motionFlinch", "motionBlast", "motionTrap", "motionRevive", "motionExile", "stageFlashRed", "winJump", "loseDroop"]) {
    assert.ok(html.includes(`@keyframes ${name}`), `${name} のキーフレームがない`);
  }
  // 動きを減らす設定では呼吸・イベント・勝敗モーションが止まる
  assert.ok(html.includes(".stage .walker, .stage .walker .wbody, .stage.flash-red,"));
  assert.ok(html.includes(".result-row.winner .avatar, .result-row.loser .avatar,"));
});

test("キャラモーション第1弾：夜の襲撃で被害者がよろめき、ステージが赤く光る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "fakeGirl";
  const victim = others[0];
  const stage = elements.get("stage");
  const before = stage.children.length;
  FB.state.selectedId = victim.id;
  FB.runNight();
  assert.equal(FB.state.nightReport.type, "eliminated");
  assert.equal(FB.state.nightReport.victimId, victim.id);
  // 個人カットイン（襲撃）を送って襲撃カットインを出す
  elements.get("cutin").onclick();
  // 被害者のゴースト歩行者が1体だけステージに出る
  assert.equal(stage.children.length, before + 1);
  assert.match(stage.children[stage.children.length - 1].className, /motion-flinch/);
  // 襲撃の赤フラッシュ
  assert.ok(stage.classList.contains("flash-red"));
});

test("キャラモーション第1弾：私的な夜行動だけではモーションが付かない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "apprenticeSeer";
  const target = others[0];
  const stage = elements.get("stage");
  FB.state.selectedId = target.id;
  FB.runNight();
  assert.equal(FB.state.nightReport.type, "none");
  // ゴーストも赤フラッシュも出ない（占いは私的な行動）
  assert.equal(stage.children.length, 0);
  assert.ok(!stage.classList.contains("flash-red"));
});

test("キャラモーション第1弾：爆弾の爆発で被害者が吹っ飛ぶ", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "villager";
  const victim = others[0];
  const s = craftNight(FB, {});
  s.bombs = [{ targetId: victim.id, explodeDay: s.day }];
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  // vm 内で作られた配列は deepEqual が通らないため要素で比べる
  assert.equal(s.bombReport.explodedVictims.length, 1);
  assert.equal(s.bombReport.explodedVictims[0], victim.id);
  FB.draw();
  const stage = elements.get("stage");
  const before = stage.children.length;
  FB.nightCutins(me, victim, null);
  // 夜行動なしのカットインを送って爆発カットインを出す
  elements.get("cutin").onclick();
  assert.equal(stage.children.length, before + 1);
  assert.match(stage.children[stage.children.length - 1].className, /motion-blast/);
});

test("キャラモーション第1弾：罠が作動すると被害者のよろめきと襲撃者の道連れが出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "trapper";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.ok(s.trapReport);
  FB.draw();
  const stage = elements.get("stage");
  const before = stage.children.length;
  FB.nightCutins(me, victim, null);
  // 個人カットイン（罠設置）を送って襲撃カットインを出す
  elements.get("cutin").onclick();
  assert.equal(stage.children.length, before + 1);
  assert.match(stage.children[stage.children.length - 1].className, /motion-flinch/);
  // 襲撃カットインを送って罠カットインを出す
  elements.get("cutin").onclick();
  assert.equal(stage.children.length, before + 2);
  assert.match(stage.children[stage.children.length - 1].className, /motion-trap/);
});

test("キャラモーション第1弾：ドクターの蘇生で助かった人がふわりと浮く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "doctor";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(s.nightReport.type, "revived");
  assert.ok(s.doctorReport);
  FB.draw();
  FB.nightCutins(me, victim, null);
  // 個人カットイン（診察）を送って蘇生カットインを出す
  elements.get("cutin").onclick();
  const stage = elements.get("stage");
  const walker = stage.querySelector(`.walker[data-player="${victim.id}"]`);
  assert.ok(walker, "蘇生した人の歩行者がステージにある");
  assert.ok(walker.classList.contains("motion-revive"));
});

test("カットイン：蘇生カットインがキューに残っている間に報告が消えても落ちない", () => {
  // 断続的な失敗の回帰テスト：シミュレーション終了後に残ったタイマーが
  // 発火し、既に置き換わった state の doctorReport（null）の victimId
  // を読んで TypeError になった。表示時コールバックはキューに入れた
  // 時点の id を値で固定するため、報告が消えても落ちない。
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "doctor";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(s.nightReport.type, "revived");
  assert.ok(s.doctorReport);
  FB.draw();
  FB.nightCutins(me, victim, null);
  // 個人カットイン（診察）は即表示され、蘇生カットインがキューに残る。
  assert.equal(FB.cutinQueueLength, 1);
  // 次の夜の解決で doctorReport / trapReport が null に置き換わった状態。
  s.doctorReport = null;
  s.trapReport = null;
  // キューに残った蘇生カットインを出す（タップで送る）。修正前はここで
  // `state.doctorReport.victimId` の読み取りで TypeError になった。
  assert.doesNotThrow(() => elements.get("cutin").onclick());
  assert.equal(elements.get("cutinTitle").textContent, "💉 蘇生した！");
  // モーションの対象はキューに入れた時点の被害者のまま。
  const stage = elements.get("stage");
  const walker = stage.querySelector(`.walker[data-player="${victim.id}"]`);
  assert.ok(walker, "蘇生した人の歩行者がステージにある");
  assert.ok(walker.classList.contains("motion-revive"));
});

test("カットイン：新しい試合を始めると前試合のカットインは残らない", async () => {
  // リトライ連打と同じ経路：キューとタイマーが残ったまま setupGame
  // すると、前試合のカットインが新しい試合の画面に出てしまう。
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "doctor";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  FB.draw();
  FB.nightCutins(me, victim, null);
  assert.equal(FB.cutinQueueLength, 1, "蘇生カットインがキューに残っている");
  // キューが残ったまま新しい試合を始める。
  FB.setupGame();
  assert.equal(FB.cutinQueueLength, 0, "キューが空になる");
  assert.ok(elements.get("cutin").classList.contains("hidden"), "カットインが隠れる");
  // 前試合のタイマーが残っていれば 1450ms 後に古いカットインが出る。
  // タイマーが消えていることを、表示間隔を超えて待って確認する。
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(elements.get("cutin").classList.contains("hidden"), "待っても古いカットインは出ない");
  assert.equal(FB.cutinQueueLength, 0);
});

test("キャラモーション第1弾：追放でフェードアウトし、結果画面で勝敗の動きが付く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "politician";
  cpus[0].roleKey = "fakeGirl";
  const targetA = cpus[0];
  const targetB = cpus[1];
  s.phase = "vote";
  const votes = new Map();
  FB.addVoteTo(votes, targetA.id, humans[0]); // 政治家：2票
  FB.addVoteTo(votes, targetB.id, humans[1]); // 1票
  const stage = elements.get("stage");
  const before = stage.children.length;
  FB.tallyVotes(votes);
  assert.equal(targetA.alive, false);
  assert.equal(targetA.deathCause, "追放");
  assert.equal(s.phase, "end", "インポスターを追放してイノセント陣営の勝利");
  // 追放された人のゴーストがフェードアウトする
  assert.equal(stage.children.length, before + 1);
  assert.match(stage.children[stage.children.length - 1].className, /motion-exile/);
  // 結果画面：勝ったイノセント陣営は winner、負けたインポスター陣営は loser
  const rows = elements.get("resultRows").innerHTML;
  assert.match(rows, /result-row [^"]*winner/);
  assert.match(rows, /result-row [^"]*loser/);
});

test("キャラモーション第2弾：自分のアクションのモーションCSSがある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const name of ["ownLungeR", "ownLungeL", "ownPeek", "ownGuard", "ownSneak", "ownSlash", "ownPlant"]) {
    assert.ok(html.includes(`@keyframes ${name}`), `${name} のキーフレームがない`);
  }
  for (const family of ["peek", "guard", "sneak", "slash", "plant"]) {
    for (const dir of ["r", "l"]) {
      assert.ok(html.includes(`.motion-own-${family}-${dir} .wbody`), `motion-own-${family}-${dir} のルールがない`);
    }
  }
  // 動きを減らす設定では .wbody のアニメーションが止まる（第1弾と同じ枠）
  assert.ok(html.includes(".stage .walker, .stage .walker .wbody, .stage.flash-red,"));
});

test("キャラモーション第2弾：ソロで占いを選ぶと自分のキャラが対象へ寄ってのぞき込む", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "apprenticeSeer";
  me.clumsy = false;
  const target = others.find((p) => p.id > me.id) || others[0];
  const stage = elements.get("stage");
  FB.state.selectedId = target.id;
  FB.runNight();
  const walker = stage.querySelector(`.walker[data-player="${me.id}"]`);
  assert.ok(walker, "自分の歩行者がステージにある");
  if (target.id > me.id) {
    assert.ok(walker.classList.contains("motion-own-peek-r"), "対象が右なので右へ寄る");
  } else {
    assert.ok(walker.classList.contains("motion-own-peek-l"), "対象が左なので左へ寄る");
  }
});

test("キャラモーション第2弾：護衛は対象が左なら左へ寄って盾を構える", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "guardian";
  const target = others.find((p) => p.id < me.id) || others[0];
  const stage = elements.get("stage");
  FB.state.selectedId = target.id;
  FB.runNight();
  const walker = stage.querySelector(`.walker[data-player="${me.id}"]`);
  assert.ok(walker, "自分の歩行者がステージにある");
  if (target.id < me.id) {
    assert.ok(walker.classList.contains("motion-own-guard-l"), "対象が左なので左へ寄る");
  } else {
    assert.ok(walker.classList.contains("motion-own-guard-r"), "対象が右なので右へ寄る");
  }
});

test("キャラモーション第2弾：妨害された夜は自分のアクションモーションが出ない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "apprenticeSeer";
  const target = others[0];
  FB.draw();
  const s = FB.state;
  s.humanBlocked = true;
  s.nightActionTypes = { [me.id]: "investigate" };
  s.nightReport = null;
  s.bombReport = { explodedVictims: [], fizzled: false };
  s.trapReport = null;
  s.doctorReport = null;
  FB.nightCutins(me, target, null);
  const stage = elements.get("stage");
  const walker = stage.querySelector(`.walker[data-player="${me.id}"]`);
  assert.ok(walker, "自分の歩行者がステージにある");
  assert.ok(!walker.classList.contains("motion-own-peek-r") && !walker.classList.contains("motion-own-peek-l"),
    "妨害された夜はのぞき込みモーションが出てはいけない");
});

test("キャラモーション第2弾：CPUの夜行動だけでは誰にも自分のアクションモーションが付かない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "villager";
  others[0].roleKey = "apprenticeSeer";
  const target = others[1];
  const stage = elements.get("stage");
  FB.state.selectedId = target.id;
  FB.runNight();
  for (let i = 0; i < 5; i++) elements.get("cutin").onclick();
  for (const p of FB.state.players.filter((x) => x.alive)) {
    const w = stage.querySelector(`.walker[data-player="${p.id}"]`);
    if (!w) continue;
    for (const family of ["peek", "guard", "sneak", "slash", "plant"]) {
      assert.ok(!w.classList.contains(`motion-own-${family}-r`) && !w.classList.contains(`motion-own-${family}-l`),
        `${p.name} に自分のアクションモーションが付いてはいけない`);
    }
  }
});

test("キャラモーション第2弾：パス＆プレイで対象を選ぶと自分の番だけモーションが付く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; p.clumsy = false; });
  humans[0].roleKey = "apprenticeSeer";
  // 受け渡しを全員分進めて夜入力へ
  for (let i = 0; i < humans.length; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightAction");
  const player = FB.pnpNightCurrentPlayer();
  assert.equal(player.id, humans[0].id);
  const target = s.players.find((p) => p.alive && p.id !== player.id);
  const stage = elements.get("stage");
  FB.selectTarget(target.id);
  const walker = stage.querySelector(`.walker[data-player="${player.id}"]`);
  assert.ok(walker, "自分の歩行者がステージにある");
  assert.ok(walker.classList.contains("motion-own-peek-r") || walker.classList.contains("motion-own-peek-l"),
    "自分の番の占いでのぞき込みモーションが付く");
  // 他の人間の歩行者には付かない
  const other = stage.querySelector(`.walker[data-player="${humans[1].id}"]`);
  assert.ok(other, "他の人間の歩行者がステージにある");
  for (const family of ["peek", "guard", "sneak", "slash", "plant"]) {
    assert.ok(!other.classList.contains(`motion-own-${family}-r`) && !other.classList.contains(`motion-own-${family}-l`),
      "他の人間の歩行者にモーションが付いてはいけない");
  }
});

test("キャラモーション第2弾：パス＆プレイの投票選択ではモーションが付かない", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; p.clumsy = false; });
  humans[0].roleKey = "apprenticeSeer";
  // 投票フェーズにして対象を選ぶ（夜のモーションが出てはいけない）
  s.phase = "vote";
  FB.draw();
  const target = s.players.find((p) => p.alive && p.id !== humans[0].id);
  const stage = elements.get("stage");
  FB.selectTarget(target.id);
  const walker = stage.querySelector(`.walker[data-player="${humans[0].id}"]`);
  assert.ok(walker, "自分の歩行者がステージにある");
  for (const family of ["peek", "guard", "sneak", "slash", "plant"]) {
    assert.ok(!walker.classList.contains(`motion-own-${family}-r`) && !walker.classList.contains(`motion-own-${family}-l`),
      "投票の選択で夜のモーションが出てはいけない");
  }
});

test("脱落アイコンのバッテン：脱落カードと結果行のアバターに ✕ が重なる", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  // ゲーム画面のカードと結果画面の行、両方に ✕ のルールがある
  // （::after の描画自体はハーネスでは見えないため静的に確認する）。
  assert.match(style, /\.card\.dead \.avatar::after, \.result-row\.dead \.avatar::after \{[^}]*content: "✕"/);
  assert.match(style, /\.card\.dead \.avatar::after, \.result-row\.dead \.avatar::after \{[^}]*color: var\(--danger\)/);
  assert.match(style, /\.card\.dead \.avatar::after, \.result-row\.dead \.avatar::after \{[^}]*z-index: 2/);
  // PC（アバター64px）では ✕ をほぼ全面の 3.4rem に
  assert.match(style, /\.card\.dead \.avatar::after, \.result-row\.dead \.avatar::after \{[^}]*font-size: 3\.4rem;/);
  // 結果画面の行アバターは 40px なので ✕ は 2.4rem に抑える
  assert.match(style, /\.result-row\.dead \.avatar::after \{ font-size: 2\.4rem; \}/);
  // スマホ（アバター40px）では ✕ を 2.4rem に
  assert.match(style, /\.card\.dead \.avatar::after, \.result-row\.dead \.avatar::after \{ font-size: 2\.4rem; \}/);
  // 脱落カードはグレー背景＋薄さを戻す。カード全体に grayscale を
  // かけると ✕ までグレーになるので、カード自体に filter が無いこと
  const deadCardRule = style.match(/\.card\.dead \{[^}]*\}/)[0];
  assert.match(deadCardRule, /background: #e2e2ea/);
  assert.match(deadCardRule, /opacity: 0\.75/);
  assert.doesNotMatch(deadCardRule, /filter:/);
  // グレースケールは顔画像だけにかける（✕ は赤のまま残る）
  assert.match(style, /\.card\.dead \.avatar-img, \.result-row\.dead \.avatar-img \{ filter: grayscale\(1\); \}/);
  // 脱落カードの名前・メタもグレー系に
  assert.match(style, /\.card\.dead \.name \{ color: #6f6f78; \}/);
  assert.match(style, /\.card\.dead \.meta \{ color: #8a8a96; \}/);
  // 結果画面の行も同じ扱い（背景グレー＋名前・役職をグレー系に）
  const deadRowRule = style.match(/\.result-row\.dead \{[^}]*\}/)[0];
  assert.match(deadRowRule, /background: #e2e2ea/);
  assert.match(deadRowRule, /opacity: 0\.75/);
  assert.match(style, /\.result-row\.dead \.result-name \{ color: #6f6f78; \}/);
  assert.match(style, /\.result-row\.dead \.result-role \{ color: #8a8a96; \}/);
  // 生存者のカードには dead クラスが付かず、脱落すると付く
  // （✕ は dead クラス経由でのみ出るので、生存者には出ない）。
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const target = s.players.find((p) => p.alive && p.id !== s.playerId);
  const card = elements.get("cards").children[target.id];
  assert.ok(!card.className.includes("dead"), "生存中のカードに dead クラスが付いてはいけない");
  target.alive = false;
  FB.draw();
  const deadCard = elements.get("cards").children[target.id];
  assert.ok(deadCard.className.includes("dead"), "脱落したカードに dead クラスが付く");
  assert.ok(deadCard.innerHTML.includes('class="avatar"'), "脱落カードにアバターがある（✕ を重ねる対象）");
  // ドクター蘇生で生き返れば dead クラスが外れて ✕ も消える
  target.alive = true;
  FB.draw();
  const revivedCard = elements.get("cards").children[target.id];
  assert.ok(!revivedCard.className.includes("dead"), "蘇生したカードから dead クラスが外れる");
});

test("役職アイコン: ROLES 全役職に仕様通りのアイコンがあり、重複・キャラ絵文字との衝突がない", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  const expected = {
    apprenticeSeer: "🔮", guardian: "🛡️", tracker: "👣", police: "🚔",
    lookout: "🔭", trapper: "🪤", doctor: "🩺", mouse: "🐭",
    politician: "🗳️", villager: "🏠", fakeGirl: "🎭", mimic: "🪞",
    bomber: "💣", baka: "🃏",
  };
  const icons = [];
  for (const [key, icon] of Object.entries(expected)) {
    assert.equal(FB.ROLES[key].icon, icon, `${key} のアイコン`);
    icons.push(icon);
  }
  assert.equal(new Set(icons).size, icons.length, "アイコンの重複なし");
  // キャラ絵文字（プレイヤーアイコン）と被らないこと。
  const charEmojis = ["🌸", "🪄", "🧁", "🎀", "💫", "🫧", "🍬", "🌙"];
  for (const icon of icons) {
    assert.ok(!charEmojis.includes(icon), `キャラ絵文字と衝突: ${icon}`);
  }
  // 役職ボード（共有モジュールの buildRoleGuideView が生成し、
  // renderRoleGuide が描く）にも同じアイコンが説明ボタンとして並んでいる。
  const tiles = FB.buildRoleGuideViewLogic();
  for (const [key, icon] of Object.entries(expected)) {
    const name = FB.ROLES[key].name;
    const tile = tiles.find(t => t.roleKey === key);
    assert.ok(tile, `ボードに ${name} のタイル`);
    assert.ok(tile.iconButtonHtml.includes(`data-role-info="${key}" aria-label="${name}の簡単な説明を見る">${icon}</button>`), `ボードに ${icon} ${name} のボタン`);
    assert.ok(tile.tileHtml.includes(`<strong>${name}</strong>`), `ボードに ${name}`);
  }
});

test("スマホ1画面レイアウト: ≤980px で右パネルは2列のまま、≤640px でカード4列・ログが詰まる", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  // ≤980px: 外側の .game-ui だけ1列に潰し、右パネルは2列のまま
  // （セリフ／行動ログの縦積みをやめる）。
  assert.match(style, /@media \(max-width: 980px\) \{[\s\S]*?\.right-panel \{ position: static; grid-template-columns: 1fr 1fr; \}/);
  assert.doesNotMatch(style, /@media \(max-width: 980px\) \{[\s\S]*?\.right-panel \{[^}]*grid-template-columns: 1fr;/);
  // ≤640px: カード4列・縦型、役職カード2列グリッド、ログ高さ 24vh/220px。
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.cards \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); gap: 8px; \}/);
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.card \{[^}]*display: block; text-align: center;/);
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.player-role-meta \{[^}]*grid-template-columns: 1fr 1fr;/);
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.player-role-meta div:nth-child\(n\+3\) \{ grid-column: 1 \/ -1; \}/);
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.log \{ height: min\(24vh, 220px\);/);
  // 名前・メタは1行省略（狭い4列でも折り返して縦を食わない）。
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.name \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.meta \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  // 生存者のメタはスマホで「？」だけ（「 ・ 生存中」を隠す）。
  assert.match(style, /@media \(max-width: 640px\) \{[\s\S]*?\.meta-state \{ display: none; \}/);
  // 吹き出しのしっぽは中央のまま（縦型カードのアバターは中央）。
  assert.doesNotMatch(style, /\.speech-bubble::after \{ left: 22px;/);
});

test("カードのメタ: 脱落は表示役職アイコン1つ、生存は「？」のみ（バカの実役職は漏れない）", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  // 生存カードは「？」＋「 ・ 生存中」（PC表示。スマホでは CSS が後者を隠す）。
  const alive = others[0];
  FB.draw();
  const aliveCard = elements.get("cards").children[alive.id];
  assert.ok(aliveCard.innerHTML.includes("？"), "生存カードは「？」");
  assert.ok(!aliveCard.innerHTML.includes("🏠"), "生存カードに役職アイコンは出ない");
  // 脱落カードは表示役職のアイコン1つ（役職名テキストなし）。
  const dead = others[1];
  dead.roleKey = "guardian";
  dead.alive = false;
  FB.draw();
  const deadCard = elements.get("cards").children[dead.id];
  assert.ok(deadCard.innerHTML.includes("🛡️"), `脱落カードは守り手アイコン: ${deadCard.innerHTML}`);
  assert.ok(!deadCard.innerHTML.includes("守り手"), "脱落カードに役職名テキストは出ない");
  assert.ok(!deadCard.innerHTML.includes("脱落済み"), "脱落カードに「脱落済み」テキストは出ない");
  assert.match(deadCard.getAttribute("aria-label"), /守り手、脱落済み/);
  // 脱落したバカは表示役職のアイコンで、🃏（実役職）は出ない。
  const baka = others[2];
  baka.roleKey = "baka";
  baka.fakeDisplayRoleKey = "apprenticeSeer";
  baka.alive = false;
  FB.draw();
  const bakaCard = elements.get("cards").children[baka.id];
  assert.ok(bakaCard.innerHTML.includes("🔮"), `バカのカードは表示役職アイコン: ${bakaCard.innerHTML}`);
  assert.ok(!bakaCard.innerHTML.includes("🃏"), "バカの実役職アイコンは出ない");
  assert.ok(!bakaCard.innerHTML.includes("バカ"));
  assert.match(bakaCard.getAttribute("aria-label"), /見習い占い師、脱落済み/);
  // 蘇生で生き返れば「？」に戻る。
  dead.alive = true;
  FB.draw();
  assert.ok(elements.get("cards").children[dead.id].innerHTML.includes("？"));
});

test("役職アイコン併記: 役職画面・役職カード・結果画面の役職名の前にアイコンが付く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = humanOf(FB);
  me.roleKey = "apprenticeSeer";
  me.clumsy = false;
  assert.ok(FB.roleHtmlFor(me).includes('data-role-info="apprenticeSeer"'), "役職画面に説明ボタン");
  assert.ok(FB.roleHtmlFor(me).includes("🔮"), "役職画面にアイコン");
  assert.ok(FB.roleHtmlFor(me).includes("見習い占い師"), "役職画面に役職名");
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardName").textContent, "見習い占い師");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes("🔮"), "役職カードにアイコン");
  // バカの役職画面・役職カードは表示役職のアイコンになる。
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "guardian";
  assert.ok(FB.roleHtmlFor(me).includes('data-role-info="guardian"'), "バカの役職画面は表示役職のボタン");
  assert.ok(FB.roleHtmlFor(me).includes("🛡️"));
  assert.ok(!FB.roleHtmlFor(me).includes("🃏"));
  assert.ok(!FB.roleHtmlFor(me).includes('data-role-info="baka"'), "バカ実役職のボタンは出ない");
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardName").textContent, "守り手");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes('data-role-info="guardian"'));
  // 結果画面は種明かしなので実役職のアイコン。
  const seer = s.players.find((p) => p.id !== me.id);
  seer.roleKey = "apprenticeSeer";
  seer.clumsy = false;
  FB.showResults("🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  const rows = elements.get("resultRows").innerHTML;
  assert.ok(rows.includes('data-role-info="baka"'), "結果画面にバカの実役職ボタン");
  assert.ok(rows.includes("🃏"), "結果画面にバカの実役職アイコン");
  assert.ok(rows.includes("バカ"), "結果画面にバカの実役職名");
  assert.ok(rows.includes('data-role-info="apprenticeSeer"'), "結果画面に占い師ボタン");
  assert.ok(rows.includes("🔮"), "結果画面に占い師アイコン");
  assert.ok(rows.includes("見習い占い師"), "結果画面に占い師の名前");
});

test("ログの折りたたみ: 見出しがトグルボタンになり、aria-controls と CSS がある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<button type="button" class="log-toggle" id="dialogueLogToggle" aria-expanded="false" aria-controls="dialogueLog">▸ セリフ<\/button>/);
  assert.match(html, /<button type="button" class="log-toggle" id="actionLogToggle" aria-expanded="false" aria-controls="actionLog">▸ 行動ログ<\/button>/);
  // aria-live は維持（折りたたみで消えていない）。
  assert.match(html, /<div id="dialogueLog" class="log" aria-live="polite">/);
  assert.match(html, /<div id="actionLog" class="log" aria-live="polite">/);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(style, /\.log-toggle \{[^}]*cursor: pointer;/);
  assert.match(style, /\.log-toggle:focus-visible \{[^}]*outline:/);
});

test("ログの折りたたみ: 既定は両方たたみ、トグルで個別に開閉でき、状態が保存される", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  // 既定（保存なし）は両方とも折りたたみ。
  assert.ok(elements.get("dialogueLog").classList.contains("hidden"), "セリフは既定でたたむ");
  assert.ok(elements.get("actionLog").classList.contains("hidden"), "行動ログは既定でたたむ");
  assert.equal(elements.get("dialogueLogToggle").getAttribute("aria-expanded"), "false");
  assert.equal(elements.get("dialogueLogToggle").textContent, "▸ セリフ");
  assert.equal(elements.get("actionLogToggle").getAttribute("aria-expanded"), "false");
  assert.equal(elements.get("actionLogToggle").textContent, "▸ 行動ログ");
  // セリフだけ開く（行動ログはたたんだまま）。
  elements.get("dialogueLogToggle").onclick();
  assert.ok(!elements.get("dialogueLog").classList.contains("hidden"), "セリフが開く");
  assert.ok(elements.get("actionLog").classList.contains("hidden"), "行動ログはたたんだまま");
  assert.equal(elements.get("dialogueLogToggle").getAttribute("aria-expanded"), "true");
  assert.equal(elements.get("dialogueLogToggle").textContent, "▾ セリフ");
  // 状態が保存される。
  assert.equal(localStorage.getItem(FB.LOG_FOLD_KEY), JSON.stringify({ dialogue: false, action: true }));
  // もう一度押すとたたみ直す。
  elements.get("dialogueLogToggle").onclick();
  assert.ok(elements.get("dialogueLog").classList.contains("hidden"));
  assert.equal(localStorage.getItem(FB.LOG_FOLD_KEY), JSON.stringify({ dialogue: true, action: true }));
  // setLogFolded でも同じ状態になる。
  FB.setLogFolded("action", false);
  assert.ok(!elements.get("actionLog").classList.contains("hidden"), "行動ログが開く");
  assert.equal(elements.get("actionLogToggle").getAttribute("aria-expanded"), "true");
});

test("ログの折りたたみ: 保存された開閉状態が次回起動時に復元される", () => {
  const { elements } = loadGame({
    seedSettings: BASE_SETTINGS,
    seedStorage: { fakeBloomLogFold: JSON.stringify({ dialogue: false, action: true }) },
  });
  assert.ok(!elements.get("dialogueLog").classList.contains("hidden"), "保存で開いていたセリフは開いたまま");
  assert.ok(elements.get("actionLog").classList.contains("hidden"), "保存でたたんでいた行動ログはたたんだまま");
  assert.equal(elements.get("dialogueLogToggle").getAttribute("aria-expanded"), "true");
  assert.equal(elements.get("dialogueLogToggle").textContent, "▾ セリフ");
});

test("ログの折りたたみ: 保存データが壊れていても両方たたんだ既定で始まる", () => {
  const broken = loadGame({ seedSettings: BASE_SETTINGS, seedStorage: { fakeBloomLogFold: "not-json{" } });
  assert.ok(broken.elements.get("dialogueLog").classList.contains("hidden"));
  assert.ok(broken.elements.get("actionLog").classList.contains("hidden"));
  // 片方だけ不正な値は、その片方だけ既定に戻る。
  const partial = loadGame({
    seedSettings: BASE_SETTINGS,
    seedStorage: { fakeBloomLogFold: JSON.stringify({ dialogue: false, action: "yes" }) },
  });
  assert.ok(!partial.elements.get("dialogueLog").classList.contains("hidden"), "正しい値は生かす");
  assert.ok(partial.elements.get("actionLog").classList.contains("hidden"), "不正な値は既定（たたむ）に戻る");
});

test("ログの折りたたみ: 新しい行が追加されても自動で開き直さない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  // ゲーム開始の行が行動ログに入っても、たたんだまま。
  assert.ok(elements.get("actionLog").children.length > 0, "行動ログに行が入る");
  assert.ok(elements.get("actionLog").classList.contains("hidden"), "追記してもたたんだまま");
  // 議論のセリフが入っても、セリフログはたたんだまま。
  let discussed = false;
  for (let i = 0; i < 15 && !discussed; i++) {
    FB.setupGame();
    const s = FB.state;
    const alive = s.players.filter((p) => p.alive);
    s.selectedId = alive.find((p) => p.id !== s.playerId).id;
    FB.runNight();
    if (FB.state.phase !== "morning") continue;
    FB.morningToDiscussion();
    discussed = true;
  }
  assert.ok(discussed, "議論まで進んだ");
  assert.ok(elements.get("dialogueLog").children.length > 0, "セリフログに行が入る");
  assert.ok(elements.get("dialogueLog").classList.contains("hidden"), "セリフも追記で開かない");
});

test("カットインのキャラアニメ：顔の CSS と種類別・系統別キーフレームがある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes('id="cutinChar"'), "カットイン帯に顔の要素がない");
  for (const name of ["cutinFlinch", "cutinBlast", "cutinFloat", "cutinHop", "cutinSway", "cutinPop",
    "cutinOwnPeek", "cutinOwnGuard", "cutinOwnSneak", "cutinOwnSlash", "cutinOwnPlant"]) {
    assert.ok(html.includes(`@keyframes ${name}`), `${name} のキーフレームがない`);
  }
  assert.match(html, /\.cutin-char \{[^}]*display: flex/);
  assert.match(html, /\.cutin-face \{[^}]*width: 96px/);
  // 種類別モーション（attack＝よろめき、bomb＝吹っ飛び、protect＝浮く、info＝跳ねる、phase＝ゆらゆら）
  for (const [kind, anim] of [["attack", "cutinFlinch"], ["bomb", "cutinBlast"], ["protect", "cutinFloat"],
    ["info", "cutinHop"], ["phase", "cutinSway"]]) {
    assert.ok(html.includes(`.cutin[data-kind="${kind}"] .cutin-face:not(.small) { animation: ${anim}`),
      `${kind} の顔モーションルールがない`);
  }
  // 自分のアクションの系統モーション（種類別より後ろ＝優先される）
  for (const family of ["peek", "guard", "sneak", "slash", "plant"]) {
    assert.ok(html.includes(`.cutin-char[data-own="${family}"] .cutin-face:not(.small)`),
      `系統 ${family} の顔モーションルールがない`);
  }
  assert.ok(html.indexOf('.cutin-char[data-own="peek"]') > html.indexOf('.cutin[data-kind="attack"]'),
    "系統モーションのルールが種類別より後ろにない（優先されない）");
  // 動きを減らす設定ではカットインの顔アニメも止まる
  assert.ok(html.includes(".cutin-band, .cutin-char,"), "reduced-motion の対象に .cutin-char がない");
  // スマホでは顔を小さくする
  assert.ok(html.includes("@media (max-width: 640px) { .cutin-face { width: 76px;"));
});

test("カットインのキャラアニメ：charId 付きで顔が出て、なしでは隠れたまま", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const me = humanOf(FB);
  // charId 0（falsy な id）でも顔が出ること
  FB.showCutin("テスト", "サブ", "info", null, { charId: 0 });
  const charBox = elements.get("cutinChar");
  assert.ok(!charBox.classList.contains("hidden"), "charId 付きなのに顔が出ていない");
  assert.ok(charBox.innerHTML.includes(FB.state.players[0].icon), "0番の顔が出ていない");
  assert.ok(charBox.innerHTML.includes('class="cutin-face"'), "顔の要素がない");
  assert.equal(charBox.dataset.own, "", "系統モーションなしのはず");
  elements.get("cutin").onclick();
  // 顔なしカットインでは隠れたまま（前の顔が残らない）
  FB.showCutin("テスト2", "", "phase");
  assert.ok(charBox.classList.contains("hidden"), "顔なしなのに顔が出ている");
  assert.equal(charBox.innerHTML, "", "顔なしなのに前の顔が残っている");
  elements.get("cutin").onclick();
  assert.ok(charBox.classList.contains("hidden"), "閉じたあとも顔が隠れたままのはず");
});

test("カットインのキャラアニメ：自分の夜アクションは自分の顔＋系統モーション＋相手の小さい顔", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "apprenticeSeer";
  me.clumsy = false;
  const target = others[0];
  FB.state.selectedId = target.id;
  FB.runNight();
  // 最初のカットインは自分の占い（個人）
  const charBox = elements.get("cutinChar");
  assert.ok(!charBox.classList.contains("hidden"), "自分のアクションの顔が出ていない");
  assert.equal(charBox.dataset.own, "peek", "占いは peek 系統のはず");
  assert.ok(charBox.innerHTML.includes(me.icon), "自分の顔が出ていない");
  assert.ok(charBox.innerHTML.includes(target.icon), "相手の顔が出ていない");
  assert.ok(charBox.innerHTML.includes('class="cutin-face small"'), "相手の顔が小さくない");
  assert.equal(elements.get("cutin").dataset.kind, "info", "占いのカットイン種別のはず");
});

test("カットインのキャラアニメ：夜の襲撃カットインに被害者の顔が出る（よろめき）", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "fakeGirl";
  const victim = others[0];
  FB.state.selectedId = victim.id;
  FB.runNight();
  assert.equal(FB.state.nightReport.type, "eliminated");
  const charBox = elements.get("cutinChar");
  // 個人カットイン（襲撃・slash 系統）を送る
  assert.equal(charBox.dataset.own, "slash", "襲撃は slash 系統のはず");
  elements.get("cutin").onclick();
  // 襲撃カットイン：被害者の顔だけ（相手の小さい顔はない）
  assert.ok(!charBox.classList.contains("hidden"), "被害者の顔が出ていない");
  assert.equal(charBox.dataset.own, "", "公開カットインに系統モーションが付いてはいけない");
  assert.ok(charBox.innerHTML.includes(victim.icon), "被害者の顔が出ていない");
  assert.ok(!charBox.innerHTML.includes("cutin-face small"), "被害者カットインに小さい顔があってはいけない");
  assert.equal(elements.get("cutin").dataset.kind, "attack");
});

test("カットインのキャラアニメ：防がれた襲撃のカットインには誰の顔も出ない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  me.roleKey = "guardian";
  const fake = others[0];
  fake.roleKey = "fakeGirl";
  const victim = others[1];
  const s = craftNight(FB, { [me.id]: victim.id, [fake.id]: victim.id });
  FB.resolveNightActions(me, victim, FB.state.players.filter((p) => p.alive));
  assert.equal(s.nightReport.type, "blocked", "守り手の護衛で襲撃が防がれるはず");
  FB.draw();
  FB.nightCutins(me, victim, null);
  const charBox = elements.get("cutinChar");
  // 個人カットイン（護衛・guard 系統）には自分の顔が出る
  assert.equal(charBox.dataset.own, "guard", "護衛は guard 系統のはず");
  elements.get("cutin").onclick();
  // 「襲撃は防がれた」カットイン：守った人・狙われた人は未発表なので顔なし
  assert.ok(charBox.classList.contains("hidden"), "防がれたカットインに顔が出てはいけない");
  assert.equal(charBox.innerHTML, "");
  assert.equal(elements.get("cutinTitle").textContent, "🛡️ 襲撃は防がれた！");
});

test("カットインのキャラアニメ：爆弾の不発カットインには誰の顔も出ない", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  resetToVillagers(FB);
  const me = humanOf(FB);
  const target = FB.state.players.find((p) => p.id !== me.id);
  const s = FB.state;
  s.humanBlocked = false;
  s.nightActionTypes = {};
  s.nightReport = null;
  s.bombReport = { explodedVictims: [], fizzled: true };
  s.trapReport = null;
  s.doctorReport = null;
  FB.nightCutins(me, target, null);
  const charBox = elements.get("cutinChar");
  // 村ガール（能力なし）の夜行動カットインは顔なし
  assert.ok(charBox.classList.contains("hidden"), "静かな夜のカットインに顔が出てはいけない");
  elements.get("cutin").onclick();
  // 「爆弾は不発」カットインも顔なし
  assert.ok(charBox.classList.contains("hidden"), "不発のカットインに顔が出てはいけない");
  assert.equal(charBox.innerHTML, "");
  assert.equal(elements.get("cutinTitle").textContent, "💣 爆弾は不発だった");
});

test("カットインのキャラアニメ：追放カットインに追放された人の顔が出る", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", bomber: "off" } });
  FB.setupGame();
  const s = FB.state;
  const humans = s.humanPlayerIds.map((id) => s.players[id]);
  const cpus = s.players.filter((p) => !s.humanPlayerIds.includes(p.id));
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  humans[0].roleKey = "politician";
  cpus[0].roleKey = "fakeGirl";
  const targetA = cpus[0];
  const targetB = cpus[1];
  s.phase = "vote";
  const votes = new Map();
  FB.addVoteTo(votes, targetA.id, humans[0]);
  FB.addVoteTo(votes, targetB.id, humans[1]);
  FB.tallyVotes(votes);
  assert.equal(targetA.alive, false);
  const charBox = elements.get("cutinChar");
  assert.ok(!charBox.classList.contains("hidden"), "追放された人の顔が出ていない");
  assert.ok(charBox.innerHTML.includes(targetA.icon), "追放された人の顔が出ていない");
  assert.ok(!charBox.innerHTML.includes(targetB.icon), "追放されなかった人の顔が出てはいけない");
  assert.equal(elements.get("cutin").dataset.kind, "phase");
});

test("カットインのキャラアニメ：マウス公開のカットインに公開された人の顔が出る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const others = resetToVillagers(FB);
  const me = humanOf(FB);
  const target = others[0];
  FB.revealMouse(me, target);
  const charBox = elements.get("cutinChar");
  assert.ok(!charBox.classList.contains("hidden"), "公開された人の顔が出ていない");
  assert.ok(charBox.innerHTML.includes(target.icon), "公開された人の顔が出ていない");
  assert.equal(elements.get("cutin").dataset.kind, "info");
  assert.equal(elements.get("cutinTitle").textContent, "🐭 役職公開");
});

test("ファビコン: head にインライン SVG のアイコンがある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  // favicon.ico への外部リクエストを出さないよう、data URI の SVG を1つだけ置く。
  const links = [...head.matchAll(/<link rel="icon"[^>]*>/g)];
  assert.equal(links.length, 1, "favicon の link が1つない");
  const href = links[0][0].match(/href="([^"]*)"/)[1];
  assert.ok(href.startsWith("data:image/svg+xml,"), "SVG の data URI ではない");
  assert.ok(href.includes("%3Csvg"), "SVG 本体がない");
  assert.ok(href.includes("🌸"), "花の絵文字がない");
  assert.ok(href.includes("%23ff6fb3"), "テーマ色（ピンク）がない");
});

test("役職アイコン拡大とFeign風UI: ボタンは大きく、ゲーム画面は町のボード風ダークテーマ", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  // アイコンボタンは従来の 1.05rem から拡大（基本 1.65rem／ボード 2rem）。
  assert.match(style, /\.role-icon-btn \{[^}]*width: 44px; height: 44px;[^}]*font-size: 1\.65rem;/);
  assert.match(style, /\.role-tile \.role-icon-btn \{[^}]*font-size: 2rem;/);
  assert.match(style, /\.card \.role-icon-btn \{[^}]*font-size: 1\.6rem;/);
  // 陣営カラーの枠（Feign のダッシュボード風）。
  assert.match(style, /\.role-icon-btn\.faction-innocent \{ border-color: var\(--innocent\); \}/);
  assert.match(style, /\.role-icon-btn\.faction-impostor \{ border-color: var\(--impostor\); \}/);
  assert.match(style, /\.role-icon-btn\.faction-neutral \{ border-color: var\(--neutral\); \}/);
  // ゲーム画面はダークな町のボード、選択中はゴールド枠、ステージに家並み。
  assert.match(style, /#gameScreen \{[^}]*linear-gradient\(180deg, #342a55/);
  assert.match(style, /#gameScreen \.card\.selected \{[^}]*outline: 3px solid var\(--gold\);/);
  assert.match(style, /#gameScreen \.stage::before \{[^}]*🏠/);
  // 役職ボードは陣営カラーのタイル一覧。
  assert.match(style, /\.role-tile\.faction-innocent \{[^}]*border-left-color: var\(--innocent\);/);
  assert.match(style, /\.role-tile\.faction-impostor \{[^}]*border-left-color: var\(--impostor\);/);
  assert.ok(html.includes("役職ボード（アイコンを押すと簡単な説明）"), "ボードの見出し");
  assert.ok(html.includes('id="roleInfoBackdrop"'), "ポップオーバーの土台がある");
});

test("役職説明ポップオーバー: showRoleInfo で短い説明が出て、閉じられる", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  // ハーネスは静的 HTML の class を再現しないため、まず閉じてから検証する
  // （実ブラウザでは markup の hidden で最初から閉じている）。
  FB.closeRoleInfo();
  assert.ok(elements.get("roleInfoBackdrop").classList.contains("hidden"), "閉じている");
  FB.showRoleInfo("guardian");
  assert.ok(!elements.get("roleInfoBackdrop").classList.contains("hidden"), "開いた");
  assert.equal(elements.get("roleInfoName").textContent, "守り手");
  assert.equal(elements.get("roleInfoDesc").textContent, FB.ROLES.guardian.shortDesc);
  assert.equal(elements.get("roleInfoFactionChip").textContent, "イノセント");
  // 未知のキーは何も起きない（開いたままの内容も変わらない）。
  FB.showRoleInfo("no-such-role");
  assert.equal(elements.get("roleInfoName").textContent, "守り手");
  FB.closeRoleInfo();
  assert.ok(elements.get("roleInfoBackdrop").classList.contains("hidden"), "閉じた");
});

test("役職説明ポップオーバー: document のキャプチャ委譲でアイコンのクリックだけ拾い、親へ伝えない", () => {
  const { FB, elements, sandbox } = loadGame({ seedSettings: BASE_SETTINGS });
  const clicks = (sandbox.document._listeners.click || []);
  assert.equal(clicks.length, 1, "委譲リスナーが1つ登録されている");
  assert.equal(clicks[0].capture, true, "キャプチャ段階で拾う");
  let stopped = false;
  const btn = { dataset: { roleInfo: "tracker" }, focus() {}, closest(sel) { return sel === "[data-role-info]" ? this : null; } };
  sandbox.document.dispatch("click", {
    target: btn,
    preventDefault() {},
    stopPropagation() { stopped = true; },
  });
  assert.ok(stopped, "親のクリック処理へ伝えない");
  assert.ok(!elements.get("roleInfoBackdrop").classList.contains("hidden"), "ポップオーバーが開く");
  assert.equal(elements.get("roleInfoName").textContent, "追跡係");
  // アイコン以外のクリックは素通りする。
  FB.closeRoleInfo();
  sandbox.document.dispatch("click", {
    target: { closest() { return null; } },
    preventDefault() { throw new Error("アイコン以外で preventDefault しない"); },
    stopPropagation() { throw new Error("アイコン以外で stopPropagation しない"); },
  });
  assert.ok(elements.get("roleInfoBackdrop").classList.contains("hidden"), "アイコン以外では開かない");
});
