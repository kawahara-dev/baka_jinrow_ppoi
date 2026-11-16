// Fake Bloom オンライン対戦 フェーズ1 第4歩：投票・勝敗・結果開示。
// 試合の進行（夜・議論・投票）は後の歩で追加する。ここでは部屋の
// プレイヤーへ 8 席分の役職を配り、席ごとに「見てよい情報だけ」を
// 組み立てる。実役職・うっかり flag・他人の夜入力はサーバー内に留め、
// クライアントへ送る player view には絶対に含めない（設計メモ §8）。
// - バカには表示役職だけを送る。本人は自分がバカだと分からない。
// - うっかり個体の占い師も、本人を含め誰にも flag を送らない。
// - インポスター同士は仲間の名前だけを知る（役職キーは送らない）。
// - 人間のいない席は CPU 席として役職だけ配っておく（補充は第5歩）。
// 夜フェーズ：人間の夜入力（nightAction）を集め、全員分が揃うか
// タイムアウト（設計メモ §6、目安60秒）で共有モジュールの
// planNightActions／resolveNightActions で一括解決する。未入力は
// 「行動しない」扱い（＝ CPU 扱い）。夜の解決はパス＆プレイ流で
// 行う（mode "pnp"＋humanPlayerIds＋pnpNightInputs）：複数人間の
// 夜入力をそのまま扱え、インポスター人間の代表者の入力が襲撃先に
// なるのも同じ仕組みだから。mode はサーバー内部の流用であって、
// クライアントへ送るものではない。
// 投票フェーズ：人間の投票（vote）を集め、全員分が揃うかタイムアウト
// （夜と同じ目安60秒）で共有モジュールの resolveVoteTally で集計する。
// 途中経過は見せず、政治家の票は2票分（現行ルール踏襲）。未入力の
// 人間はパス＆プレイと同じく CPU と同じ疑念ベースで選ぶ。切断中の
// 人間は §7 どおり「投票しない」扱い（棄権）で試合を止めない。
// 追放したら共有モジュールの checkWinCondition で勝敗を見て、決着
// なら試合終了（結果開示）、続くなら翌日の夜へ進む。夜の解決で
// 決着したときも同じく試合終了になる（ソロの runNight と同じ）。
// 試合ロジックは共有モジュール game-logic.js の dealRoles を使う。
"use strict";

const {
  ROLES,
  PLAYER_NAMES,
  PLAYER_ICONS,
  DEFAULT_SETTINGS,
  dealRoles,
  getEffectiveRoleKey,
  getPublicRoleKey,
  formatActionLog,
  planNightActions,
  resolveNightActions,
  planDiscussionTalks,
  resolveVoteTally,
  checkWinCondition,
  cpuVotePick,
  buildHighlights,
  buildResultSummary,
  CANNED_TALKS,
  FREE_TALK_MAX_LENGTH,
} = require("../game-logic.js");

const IMPOSTOR_ROLE_KEYS = ["fakeGirl", "mimic"];
const MIN_PLAYERS_TO_START = 2;
// 夜の入力締め切り（設計メモ §6 の目安60秒）。createServer の
// options.nightTimeoutMs で上書きできる（テスト用）。
const NIGHT_TIMEOUT_MS = 60000;
// 投票の締め切り（設計メモ §6 は「全員分が揃うかタイムアウトで集計」
// とだけあり秒数はないため、夜と同じ目安60秒にする）。createServer の
// options.voteTimeoutMs で上書きできる（テスト用）。
const VOTE_TIMEOUT_MS = 60000;
// 議論の定型文と自由入力の上限は共有モジュール（game-logic.js）に置く。
// クライアントの議論パネルも同じ一覧を使う（単一の出所）。

// 役職を配り、サーバー内だけが持つ試合状態を作る。
// roomPlayers: 部屋の players（id / name / icon）。8 席に満たない分は
// CPU 席になる。settings は dealRoles 用（fakeCount / bomber）。
// random は () => [0,1) の注入可能な乱数源（既定は Math.random）。
function createGame(code, roomPlayers, settings, random) {
  const dealt = dealRoles(settings || DEFAULT_SETTINGS, random);
  const players = dealt.map((dealtRole, seat) => {
    const human = roomPlayers.find((p) => p.id === seat);
    return {
      id: seat,
      name: human ? human.name : PLAYER_NAMES[seat],
      icon: human ? human.icon : PLAYER_ICONS[seat],
      roleKey: dealtRole.roleKey,
      fakeDisplayRoleKey: dealtRole.fakeDisplayRoleKey,
      clumsy: dealtRole.clumsy,
      alive: true,
      isCpu: !human,
      // 結果画面まで公開しない役職（脱落時の公開などは後の歩で立てる）。
      publicRoleKey: null,
      // 脱落の記録（夜の解決・投票の追放が書く。結果開示で使う）。
      deathCause: null,
      deathDay: null,
      // 夜の解決（共有モジュール）が読む・書く状態。初期値はソロと同じ。
      suspicion: 0,
      lastTarget: null,
      // マウス公開の使用済み（1試合1回。議論フェーズで使う）。
      mouseUsed: false,
    };
  });
  return {
    code,
    players,
    phase: "night",
    day: 1,
    settings: settings || DEFAULT_SETTINGS,
    // 夜の解決は共有モジュールのパス＆プレイ流（mode "pnp"）で回す。
    // humanPlayerIds は人間の席、pnpNightInputs は集まった夜入力。
    mode: "pnp",
    humanPlayerIds: roomPlayers.map((p) => p.id),
    pnpNightInputs: {},
    bombs: [],
    fakeIntel: {},
    nightActions: {},
    nightActionTypes: {},
    protectedTargets: new Set(),
    loneFakeAbility: null,
    nightReport: null,
    bombReport: null,
    // 議論フェーズ：議論を終えた（投票へ進んでよい）人間の席。
    discussionDone: new Set(),
    // 投票フェーズ：人間の投票（{ 席: 対象の席 }）と、切断中で棄権扱い
    // の人間の席（§7：切断中は「投票しない」）。送り直しは上書きする。
    votes: {},
    voteAbstained: new Set(),
    // 勝敗・結果開示で使うカウンタと決着文言（夜の解決が書き込む）。
    bombKills: 0,
    revives: 0,
    guardSaves: 0,
    winText: null,
  };
}

// 開始できるかどうかの判定。開始できない理由のエラー文字列、
// 開始できる場合は null を返す。ホスト（作成者 = id 0）だけが開始できる。
function validateStart(room, playerId) {
  if (!room) return "room_not_found";
  if (room.game) return "game_already_started";
  if (playerId !== 0) return "not_host";
  if (room.players.length < MIN_PLAYERS_TO_START) return "not_enough_players";
  return null;
}

// そのプレイヤーだけが見てよい情報（player view）を組み立てる。
// サーバー内の実役職・うっかり flag・トークンは含まない。
// - me.roleKey はバカなら表示役職、占い師なら見習い占い師（clumsy 隠し）。
// - allies はインポスター同士の名前だけ（役職キーは送らない）。
// - players 一覧は生存・CPU 席・公開済み役職（開始時は全員 null）だけ。
function playerView(game, playerId) {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) return null;
  const shownRoleKey = me.roleKey === "baka" ? me.fakeDisplayRoleKey : me.roleKey;
  const shownRole = ROLES[shownRoleKey];
  const isImpostor = IMPOSTOR_ROLE_KEYS.includes(me.roleKey);
  const allies = isImpostor
    ? game.players
        .filter((p) => p.id !== me.id && IMPOSTOR_ROLE_KEYS.includes(p.roleKey))
        .map((p) => ({ id: p.id, name: p.name, icon: p.icon }))
    : [];
  return {
    code: game.code,
    phase: game.phase,
    day: game.day,
    me: {
      id: me.id,
      name: me.name,
      icon: me.icon,
      roleKey: shownRoleKey,
      roleName: shownRole.name,
      faction: shownRole.faction,
      allies,
      // マウス公開の使用済み（クライアントがボタンを隠す判断に使う）。
      mouseUsed: !!me.mouseUsed,
    },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      alive: p.alive,
      isCpu: p.isCpu,
      publicRoleKey: p.publicRoleKey,
    })),
  };
}



// その席の人間が今夜の入力をする必要があるか。共有モジュールの
// planNightActions が行動を立てる席と一致させる。
// - 実役職がインポスター（fakeGirl／mimic）：襲撃または能力の入力。
// - バカがインポスターを表示：夜行動なし（planNightActions も立てない）。
// - それ以外：表示役職に夜行動がある席（占い・護衛・追跡・ポリス・
//   見張り・罠・診察・爆弾）。能力なしの役職（村人・政治家・ネズミ等）は不要。
function needsNightInput(game, playerId) {
  const p = game.players.find((x) => x.id === playerId);
  if (!p || !p.alive || p.isCpu) return false;
  if (IMPOSTOR_ROLE_KEYS.includes(p.roleKey)) return true;
  const effective = getEffectiveRoleKey(p);
  if (IMPOSTOR_ROLE_KEYS.includes(effective)) return false;
  return !!ROLES[effective]?.nightAction;
}

// 人間の夜入力を受け付ける。成功したら null、ダメなら理由を返す。
// 対象は生存者のみ。自分を選べない役職は自分を弾く。インポスターは
// 仲間・自分を襲撃先（能力先）にできない。同じ人間が送り直したら
// 上書きする（解決までは気が変わってよい）。
function submitNightAction(game, playerId, targetId) {
  if (!game) return "no_game";
  if (game.phase !== "night") return "not_night";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  if (!needsNightInput(game, playerId)) return "no_night_action";
  const target = game.players.find((x) => x.id === targetId);
  if (!target || !target.alive) return "invalid_target";
  if (IMPOSTOR_ROLE_KEYS.includes(p.roleKey)) {
    if (targetId === playerId || IMPOSTOR_ROLE_KEYS.includes(target.roleKey)) {
      return "invalid_target";
    }
  } else {
    const action = ROLES[getEffectiveRoleKey(p)]?.nightAction;
    if (action && action.allowSelf === false && targetId === playerId) {
      return "invalid_target";
    }
  }
  game.pnpNightInputs[playerId] = targetId;
  return null;
}

// 夜入力が必要な生存中の人間全員分が揃ったか。切断中の人間も数える
// （§7：切断中は未入力扱いで、タイムアウトで解決する）。
function nightInputsComplete(game) {
  if (!game || game.phase !== "night") return false;
  return game.players.every(
    (p) => !needsNightInput(game, p.id) || game.pnpNightInputs[p.id] !== undefined
  );
}

// 夜を一括解決する。共有モジュールの planNightActions で人間の入力と
// CPU の行動を合わせ、resolveNightActions で解決する。夜に倒れた者の
// 役職は公開ログで明かされるので view の publicRoleKey にも反映する。
// 解決したら phase を "morning" にし、夜入力を空にする。夜以外や
// 二重解決では null を返す。戻り値は夜の結果（公開ログ・席ごとの
// 個人ログ・夜の報告・爆弾の報告）。
function resolveNight(game, random) {
  if (!game || game.phase !== "night") return null;
  const alive = game.players.filter((p) => p.alive);
  const difficulty = game.settings?.difficulty || "normal";
  const plan = planNightActions(game, alive, { difficulty, random });
  game.nightActions = plan.nightActions;
  game.nightActionTypes = plan.nightActionTypes;
  game.protectedTargets = plan.protectedTargets;
  game.loneFakeAbility = plan.loneFakeAbility;
  const { logs } = resolveNightActions(game, alive, { meId: -1, difficulty, random });
  for (const p of game.players) {
    if (!p.alive && p.publicRoleKey === null) p.publicRoleKey = getPublicRoleKey(p);
  }
  game.phase = "morning";
  const result = {
    publicLogs: logs.filter((l) => l.scope === "public").map((l) => l.message),
    privateLogs: Object.fromEntries(
      logs.filter((l) => l.scope === "private").map((l) => [l.actorId, l.message])
    ),
    report: game.nightReport,
    bombReport: game.bombReport,
    // 罠・蘇生の報告も公開情報として送る（どちらも公開ログに出る内容
    // だけで、クライアントはここから夜のカットインを再生する）。
    trapReport: game.trapReport,
    doctorReport: game.doctorReport,
  };
  game.pnpNightInputs = {};
  return result;
}

// その席へ送る nightResolved メッセージ。個人ログはその席の分だけ
// （他人の夜結果は含まない）。view にも他人の実役職は出ない。
function nightResolvedMessage(game, result, playerId) {
  const view = playerView(game, playerId);
  if (!view || !result) return null;
  return {
    type: "nightResolved",
    code: game.code,
    view,
    night: {
      publicLogs: result.publicLogs,
      privateLog: result.privateLogs[playerId] || null,
      report: result.report,
      bombReport: result.bombReport,
      trapReport: result.trapReport || null,
      doctorReport: result.doctorReport || null,
    },
  };
}

// 議論を開始する。phase を "morning" から "discussion" にし、
// 共有モジュールの planDiscussionTalks で CPU の発言イベントを作る
// （人間の席は発言しない。人数が多いほど CPU の発言は減る）。
// マウス公開のイベントには公開される役職（publicRoleKey）を付ける
// （マウスの公開は全員に見える公開情報）。公開する側がバカ（マウス
// 表示）のときは、ソロの revealMouse と同じくバカ以外の役職から
// ランダムに1つ選んだ捏造役職を公開する（§8：バカには表示役職だけ
// が送られるため、本当の役職は知らない。でたらめな公開になる）。
// 朝以外では null を返す。戻り値はイベントの配列：
// { type: "talk", speakerId, text } /
// { type: "mouse", speakerId, targetId, publicRoleKey }。
function startDiscussion(game, random) {
  if (!game || game.phase !== "morning") return null;
  game.phase = "discussion";
  game.discussionDone = new Set();
  const alive = game.players.filter((p) => p.alive);
  const events = planDiscussionTalks(game, alive, { random });
  const rnd = typeof random === "function" ? random : Math.random;
  return events.map((e) => {
    if (e.type === "mouse") {
      const speaker = game.players.find((p) => p.id === e.speakerId);
      const target = game.players.find((p) => p.id === e.targetId);
      let publicRoleKey = target ? getPublicRoleKey(target) : null;
      if (speaker && speaker.roleKey === "baka" && target) {
        const pool = Object.keys(ROLES).filter((k) => k !== "baka");
        publicRoleKey = pool[Math.floor(rnd() * pool.length)];
      }
      return { type: "mouse", speakerId: e.speakerId, targetId: e.targetId, publicRoleKey };
    }
    return { type: "talk", speakerId: e.speakerId, text: e.text };
  });
}

// 人間のマウス公開を受け付ける。成功したら公開イベント、ダメなら
// 理由を返す。議論フェーズ中・生存中の人間・表示役職がマウス・
// 未使用・対象は生存中の他人だけ（自分は不可）。1試合1回だけ。
// 公開する役職は対象の公開役職。ただし公開する側がバカ（マウス表示）
// のときはソロと同じくバカ以外の役職からランダムに1つ選ぶ（§8：
// バカには表示役職だけが送られるため、本当の役職は知らない）。
// ソロの revealMouse と同じく、公開された役職の陣営で対象の疑念を
// 更新する（イノセント -5／それ以外 8。CPU の投票が疑念を見るため）。
// random は () => [0,1) の注入可能な乱数源（既定は Math.random）。
function submitMouseReveal(game, playerId, targetId, random) {
  if (!game) return "no_game";
  if (game.phase !== "discussion") return "not_discussion";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  if (getEffectiveRoleKey(p) !== "mouse") return "not_mouse";
  if (p.mouseUsed) return "already_used";
  const target = game.players.find((x) => x.id === targetId);
  if (!target || !target.alive || targetId === playerId) return "invalid_target";
  const rnd = typeof random === "function" ? random : Math.random;
  let shownRoleKey = getPublicRoleKey(target);
  if (p.roleKey === "baka") {
    const pool = Object.keys(ROLES).filter((k) => k !== "baka");
    shownRoleKey = pool[Math.floor(rnd() * pool.length)];
  }
  p.mouseUsed = true;
  target.suspicion = ROLES[shownRoleKey].faction === "イノセント" ? -5 : 8;
  return { type: "mouse", speakerId: playerId, targetId, publicRoleKey: shownRoleKey };
}

// 人間のマウス公開を全員へ配信するメッセージ（公開情報だけ）。
// discussionStarted の talks に入る CPU のマウス公開と同じ形。
function mouseRevealBroadcast(game, event) {
  if (!game || !event) return null;
  return {
    type: "mouse",
    code: game.code,
    speakerId: event.speakerId,
    targetId: event.targetId,
    publicRoleKey: event.publicRoleKey,
  };
}

// 人間の議論の発言を受け付ける。成功したら { speakerId, text }、
// ダメなら理由を返す。input は { phraseId, targetId }（定型文）か
// { text }（短い自由入力）のどちらか片方だけ。
// - 定型文：CANNED_TALKS にある id だけ。{target} を含む文言は
//   生存中の他人を対象に指定する（自分・死亡・存在しない席は弾く）。
// - 自由入力：前後の空白を除いて 1〜FREE_TALK_MAX_LENGTH 文字。
function submitTalk(game, playerId, input) {
  if (!game) return "no_game";
  if (game.phase !== "discussion") return "not_discussion";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  const phraseId = input && input.phraseId;
  const text = input && input.text;
  if ((phraseId == null) === (text == null)) return "bad_talk";
  if (phraseId != null) {
    const phrase = CANNED_TALKS.find((c) => c.id === phraseId);
    if (!phrase) return "bad_talk";
    if (!phrase.needsTarget) return { speakerId: playerId, text: phrase.text };
    const target = game.players.find((x) => x.id === input.targetId);
    if (!target || !target.alive || target.id === playerId) return "invalid_target";
    return { speakerId: playerId, text: phrase.text.replaceAll("{target}", target.name) };
  }
  if (typeof text !== "string") return "bad_talk";
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > FREE_TALK_MAX_LENGTH) return "bad_talk";
  return { speakerId: playerId, text: trimmed };
}

// その席の人間が議論を終えたと記録する。成功したら null、
// ダメなら理由を返す。2回目も null（冪等）。
function markDiscussionDone(game, playerId) {
  if (!game) return "no_game";
  if (game.phase !== "discussion") return "not_discussion";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  game.discussionDone.add(playerId);
  return null;
}

// 再接続した人間の議論済み扱いを外す（戻ってきたらまた議論に参加できる）。
// 議論フェーズ以外では何もしない。投票の clearVoteAbstained と同じ形。
function clearDiscussionDone(game, playerId) {
  if (!game || game.phase !== "discussion") return;
  game.discussionDone.delete(playerId);
}

// 生存中の人間全員が議論を終えたか。切断中の人間はサーバー側で
// 切断時に discussionDone へ入れるため、ここでは数えない（§7）。
function discussionComplete(game) {
  if (!game || game.phase !== "discussion") return false;
  return game.players.every(
    (p) => !p.alive || p.isCpu || game.discussionDone.has(p.id)
  );
}

// その席へ送る discussionStarted メッセージ。CPU の発言イベントは
// 公開情報だけ（発言者・文言・マウス公開の役職）なので全席で同じ。
function discussionStartedMessage(game, events, playerId) {
  const view = playerView(game, playerId);
  if (!view || !events) return null;
  return {
    type: "discussionStarted",
    code: game.code,
    view,
    talks: events,
  };
}

// 人間の発言を全員へ配信するメッセージ（公開情報だけ）。
function talkBroadcast(game, talk) {
  const speaker = game.players.find((p) => p.id === talk.speakerId);
  if (!speaker) return null;
  return {
    type: "talk",
    code: game.code,
    speakerId: talk.speakerId,
    speakerName: speaker.name,
    text: talk.text,
  };
}

// その席へ送る discussionEnded メッセージ。view の phase は "vote"
// （投票の受け付けは次の歩で追加する）。
function discussionEndedMessage(game, playerId) {
  const view = playerView(game, playerId);
  if (!view) return null;
  return {
    type: "discussionEnded",
    code: game.code,
    view,
  };
}

// 勝敗の判定（共有モジュールの checkWinCondition）。生存者の役職と
// ボマーの爆弾による撃破数から決着文言を返す。決着していなければ null。
// 夜の解決の直後と投票の集計の直後の両方で呼ぶ（ソロと同じ2か所）。
function checkWin(game) {
  if (!game) return null;
  const aliveRoleKeys = game.players.filter((p) => p.alive).map((p) => p.roleKey);
  return checkWinCondition(aliveRoleKeys, game.bombKills);
}

// 試合を終了させる。phase を "end" にし、決着文言を残す。すでに
// 終わっている試合では null を返す。戻り値は決着文言。
function endGame(game, winText) {
  if (!game || game.phase === "end" || !winText) return null;
  game.phase = "end";
  game.winText = winText;
  return winText;
}

// 人間の投票を受け付ける。成功したら null、ダメなら理由を返す。
// 対象は生存中の他人だけ（自分への投票はパス＆プレイと同じく弾く）。
// 同じ人間が送り直したら上書きする（集計までは気が変わってよい）。
function submitVote(game, playerId, targetId) {
  if (!game) return "no_game";
  if (game.phase !== "vote") return "not_vote";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  const target = game.players.find((x) => x.id === targetId);
  if (!target || !target.alive || targetId === playerId) return "invalid_target";
  game.votes[playerId] = targetId;
  return null;
}

// 投票中に切断した人間を棄権扱いにする（§7：切断中は「投票しない」）。
// 投票フェーズ以外・CPU 席・死亡した席では何もしない。冪等。
function markVoteAbstained(game, playerId) {
  if (!game || game.phase !== "vote") return;
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu || !p.alive) return;
  game.voteAbstained.add(playerId);
}

// 再接続した人間の棄権扱いを外す（戻ってきたらまた投票できる）。
// 投票フェーズ以外では何もしない。
function clearVoteAbstained(game, playerId) {
  if (!game || game.phase !== "vote") return;
  game.voteAbstained.delete(playerId);
}

// 生存中の人間全員分の投票が揃ったか。投票済みか棄権扱い（切断中）の
// どちらかなら揃ったとみなす。未入力のまま繋がっている人間がいると
// 揃わない（タイムアウトで集計する）。
function votesComplete(game) {
  if (!game || game.phase !== "vote") return false;
  return game.players.every(
    (p) =>
      !p.alive ||
      p.isCpu ||
      game.votes[p.id] !== undefined ||
      game.voteAbstained.has(p.id)
  );
}

// 投票を一括集計する。共有モジュールの resolveVoteTally で最多票を決める。
// - 人間の票：入力があればそれを使う。未入力のまま繋がっている人間は
//   パス＆プレイと同じく CPU と同じ疑念ベース（cpuVotePick）で選ぶ。
//   切断中（棄権扱い）の人間は票を入れない（§7）。
// - CPU 席：cpuVotePick で選ぶ。政治家の票は2票分（現行ルール踏襲。
//   バカが政治家を表示していても実役職で見るため2票にはならない）。
// 同数なら追放なし。最多票が1人なら追放し、公開役職を明かす。
// 集計したら勝敗を見て、決着なら phase を "end" にし、続くなら
// 翌日（day + 1）の夜へ進む（ソロの tallyVotes と同じ遷移。疑念は
// 1ずつ下がり、投票・議論終了の記録は空になる）。
// 投票フェーズ以外や二重集計では null を返す。戻り値は集計結果
// （公開ログ・追放された席・票の内訳・決着したかどうか）。
function resolveVote(game, random) {
  if (!game || game.phase !== "vote") return null;
  const alive = game.players.filter((p) => p.alive);
  const difficulty = game.settings?.difficulty || "normal";
  const votes = new Map();
  const addVoteTo = (targetId, voter) => {
    votes.set(targetId, (votes.get(targetId) || 0) + (voter?.roleKey === "politician" ? 2 : 1));
  };
  for (const p of alive) {
    if (!p.isCpu && game.voteAbstained.has(p.id)) continue;
    let targetId;
    if (!p.isCpu && game.votes[p.id] !== undefined) {
      targetId = game.votes[p.id];
    } else {
      targetId = cpuVotePick(p, alive, difficulty, random)?.id;
    }
    if (targetId !== undefined) addVoteTo(targetId, p);
  }
  const { winnerId, max } = resolveVoteTally(votes);
  const tally = [...votes.entries()]
    .map(([id, count]) => {
      const target = game.players.find((p) => p.id === id);
      return { id, name: target ? target.name : "不明", votes: count };
    })
    .sort((a, b) => b.votes - a.votes);
  const logs = [];
  let exiledId = null;
  if (winnerId === null) {
    logs.push(formatActionLog("voteTie", { label: "投票", votes: Math.max(0, max) }));
  } else {
    const ex = game.players[winnerId];
    exiledId = ex.id;
    ex.alive = false;
    ex.deathCause = "追放";
    ex.deathDay = game.day;
    ex.publicRoleKey = getPublicRoleKey(ex);
    logs.push(formatActionLog("voteEliminated", { label: "投票", target: ex.name, votes: max }));
    logs.push(
      formatActionLog("roleReveal", {
        label: "投票",
        target: ex.name,
        role: ROLES[ex.publicRoleKey].name,
        faction: ROLES[ex.publicRoleKey].faction,
      })
    );
  }
  const winText = checkWin(game);
  if (winText) {
    endGame(game, winText);
    return { ended: true, winText, logs, exiledId, tally };
  }
  game.day += 1;
  game.phase = "night";
  game.players.forEach((p) => {
    p.suspicion = Math.max(0, p.suspicion - 1);
  });
  game.votes = {};
  game.voteAbstained = new Set();
  game.discussionDone = new Set();
  logs.push(formatActionLog("phaseNightStart", { day: game.day }));
  return { ended: false, winText: null, logs, exiledId, tally };
}

// その席へ送る voteResolved メッセージ。票の内訳と追放の公開情報だけ
// （誰が誰へ入れたかは出さない。途中経過は見せない設計のまま）。
function voteResolvedMessage(game, result, playerId) {
  const view = playerView(game, playerId);
  if (!view || !result) return null;
  const exiled = result.exiledId === null ? null : game.players.find((p) => p.id === result.exiledId);
  return {
    type: "voteResolved",
    code: game.code,
    view,
    vote: {
      logs: result.logs,
      exiledId: result.exiledId,
      exiledName: exiled ? exiled.name : null,
      exiledPublicRoleKey: exiled ? exiled.publicRoleKey : null,
      tally: result.tally,
    },
  };
}

// その席へ送る gameEnded メッセージ。試合が終わったので全員の実役職・
// 陣営・脱落の記録を開示する（共有モジュールの buildResultSummary）。
// ハイライトも buildHighlights で付ける。view の phase は "end"。
function gameEndedMessage(game, playerId) {
  const view = playerView(game, playerId);
  if (!view || !game.winText) return null;
  const summary = buildResultSummary(game.players, {
    winText: game.winText,
    mode: "pnp",
    playerId,
    humanCount: game.humanPlayerIds.length,
  });
  return {
    type: "gameEnded",
    code: game.code,
    view,
    result: {
      winText: game.winText,
      winnerFaction: summary.winnerFaction,
      sub: `オンライン対戦（人間${game.humanPlayerIds.length}人）で遊びました。`,
      highlights: buildHighlights(game.players, game),
      rows: summary.rows,
    },
  };
}

module.exports = {
  createGame,
  validateStart,
  playerView,
  needsNightInput,
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
  CANNED_TALKS,
  FREE_TALK_MAX_LENGTH,
  IMPOSTOR_ROLE_KEYS,
  MIN_PLAYERS_TO_START,
  NIGHT_TIMEOUT_MS,
  VOTE_TIMEOUT_MS,
};
