# Fake Bloom オンライン対戦サーバー（フェーズ1）

Node 標準のみ・依存パッケージなしの小さな常駐プログラム。
試合ロジックはリポジトリ直下の共有モジュール `game-logic.js` を使う。

## 起動

```sh
node server/server.js          # http://127.0.0.1:8787
FB_PORT=9000 node server/server.js
```

**試験運用は VM 内だけ。** 待ち受けは `127.0.0.1` に固定してあり、外部公開はしない。
外部公開・トンネルはフェーズ3の話。

## 構成

- `server.js` — HTTP 静的配信（リポジトリ直下の `index.html` / `game-logic.js` 等）と
  WebSocket（`/ws`）の受け口。メッセージの振り分けと部屋へのブロードキャスト。
- `ws.js` — WebSocket の最小実装（RFC 6455：ハンドシェイク、テキストフレームの送受信、
  ping/pong、close）。クライアントフレームはマスク必須。
- `rooms.js` — 部屋とセッションの管理。部屋コード（4文字）、セッショントークン、
  キャラの自動割当（入室順にルナ・ミオ・ユイ…）、部屋設定（ホストの初期設定と
  `setSettings` での同期。検証は共有モジュールの `normalizeRoomSettings`）。
- `game.js` — 配役とプレイヤー別ビュー。共有モジュール `dealRoles` で 8 席に役職を配り、
  席ごとに「見てよい情報だけ」を組み立てる。実役職・うっかり flag・トークンは
  サーバー内に留め、player view には含めない。人間のいない席は CPU 席。
  夜フェーズもここで扱う：人間の夜入力の収集と検証、共有モジュールの
  `planNightActions`／`resolveNightActions` による一括解決、席ごとの夜結果の組み立て。
  議論フェーズもここで扱う：共有モジュールの `planDiscussionTalks` による
  CPU の発言、定型文（`CANNED_TALKS`）と短い自由入力（100文字まで）の検証、
  全員の議論終了またはタイマーでの投票への遷移。投票フェーズもここで扱う：
  人間の投票の収集と検証、共有モジュールの `resolveVoteTally` による集計
  （政治家の票は2票分、未入力の人間は CPU と同じ疑念ベース、切断中は棄権）、
  追放と共有モジュールの `checkWinCondition` による勝敗、決着時の結果開示
  （`buildResultSummary`／`buildHighlights`）。夜の解決で決着したときも同じく
  試合終了になる。

## プロトコル（JSON テキストフレーム）

クライアント → サーバー：

- `{ "type": "createRoom", "settings"?: { "fakeCount": "random", "bomber": "random", "difficulty": "normal", "discussTimer": "0" } }` — 部屋を作る。`settings` があればホストの初期設定として使う（フェーズ2 第1歩。なければ部屋の既定値）
- `{ "type": "joinRoom", "code": "ABCD" }` — コードで参加する
- `{ "type": "reconnect", "code": "ABCD", "token": "<セッショントークン>" }` — 切断後に同じ席へ戻る
- `{ "type": "setSettings", "settings": { "fakeCount": "random", "bomber": "random", "difficulty": "normal", "discussTimer": "0" } }` — 部屋設定の同期（フェーズ2 第1歩）。ホストだけが、試合開始前に変えられる。値は検証して許容外は既定値に戻し、指定のないキーは今の部屋設定のままにして、部屋の全員へ設定付きの `roomUpdate` を配信する。ホスト以外は `not_host`、試合開始後は `game_already_started` のエラーになる。開始時はこの設定で配役（`fakeCount` / `bomber`）と CPU の難易度・議論タイマーが決まる
- `{ "type": "startGame" }` — 試合を開始する（作成者＝ホストだけ。2人以上必要。
  人間のいない席は CPU 席として役職を配る）
- `{ "type": "nightAction", "targetId": 2 }` — 夜の対象を選ぶ。夜フェーズ中に、
  夜行動のある生存中の人間の席だけが送れる。解決までは送り直して変更できる。
  インポスターの人間は襲撃先（代表者）または能力先（代表者以外）を選ぶ
- `{ "type": "talk", "phraseId": "agree" }` / `{ "type": "talk", "phraseId": "suspicious", "targetId": 2 }` /
  `{ "type": "talk", "text": "ちょっと待って" }` — 議論の発言。議論フェーズ中に、
  生存中の人間の席だけが送れる。定型文（`phraseId`）か短い自由入力（`text`、100文字まで）の
  どちらか片方だけ。対象を取る定型文は生存中の他人を `targetId` で指定する
- `{ "type": "mouseReveal", "targetId": 2 }` — 議論フェーズ中に、表示役職がマウスの
  人間が対象の役職を公開する。1試合1回だけ。対象は生存中の他人だけ（自分は不可）。
  公開される役職は部屋の全員へ `{ "type": "mouse", ... }` で配信される。公開する側が
  バカ（マウス表示）のときは、ソロと同じくバカ以外の役職からランダムに1つ選んだ
  捏造役職が公開される（設計メモ §8：バカには表示役職だけが送られるため、本当の
  役職は知らない）。マウスでない人間は `not_mouse`、使用済みは `already_used`、
  議論フェーズ以外は `not_discussion` のエラーになる
- `{ "type": "discussionDone" }` — 議論を終えた合図。生存中の人間全員分が揃うか、
  議論タイマー（設定の `discussTimer` 秒。既定はタイマーなし）が切れると投票へ進む。
  切断した人間は自動で議論済み扱いになる（議論中の切断だけでなく、夜の途中で
  切断したまま議論が始まる場合も、開始時点で議論済み扱いになる）。議論の開始時点で生存中の人間が
  1人もいなければ、誰も合図を送れないためすぐ投票へ進む
- `{ "type": "vote", "targetId": 2 }` — 投票先を選ぶ。投票フェーズ中に、
  生存中の人間の席だけが送れる。対象は生存中の他人だけ（自分への投票は不可）。
  集計までは送り直して変更できる。生存中の人間全員分が揃うか、開始から
  60秒のタイムアウトで集計する。未入力のまま繋がっている人間は CPU と同じ
  疑念ベースで選ばれ、切断中の人間は棄権扱い（投票しない）になる。
  投票の開始時点で生存中の人間が1人もいなければ、すぐ集計する

サーバー → クライアント：

- `{ "type": "roomCreated" | "roomJoined" | "reconnected", "code", "token", "playerId", "name", "icon", "players", "settings" }` — `settings` は部屋設定（ホストの既定値で始まり、`setSettings` で変わる）
- `{ "type": "roomUpdate", "code", "players", "settings" }` — 参加・切断・再接続・設定変更時に全員へ配信
- `{ "type": "gameStarted", "code", "view" }` — 試合開始時に席ごとに1通ずつ配信。
  `view` はその席だけの player view（自分の役職・インポスター仲間の名前・公開情報）。
  他人の実役職・うっかり flag・トークンは含まない。バカには表示役職だけが送られる
- `{ "type": "nightActionAccepted", "targetId": 2 }` — 夜入力を受け付けた合図
- `{ "type": "nightResolved", "code", "view", "night": { "publicLogs", "privateLog", "report", "bombReport", "trapReport", "doctorReport" } }` —
  夜の解決時に席ごとに1通ずつ配信。`view` は解決後の player view（`phase` は
  `"morning"`、夜に倒れた者の役職は `publicRoleKey` で公開される）。
  `publicLogs` は全員に見える行動ログ、`privateLog` はその席だけの夜結果
  （ない席は `null`）、`report` は夜の報告（`{ type: "eliminated" | "blocked" | "none" | "revived", victimId }`）、
  `bombReport` は爆弾の報告、`trapReport` は罠の報告（作動した夜だけ `{ attackerId, victimId }`、それ以外は `null`）、
  `doctorReport` は蘇生の報告（蘇生した夜だけ `{ victimId, cause }`、それ以外は `null`）。夜入力が必要な人間全員分が揃うか、開始から
  60秒のタイムアウト（未入力は「行動しない」扱い）で解決する。誰も夜入力が
  いらない配役では開始直後に解決する。夜の解決直後に議論が始まる
- `{ "type": "discussionStarted", "code", "view", "talks" }` — 議論の開始時に
  席ごとに1通ずつ配信。`view` はその席だけの player view（`phase` は
  `"discussion"`）。`talks` は CPU の発言イベントの配列で全席共通：
  `{ "type": "talk", "speakerId", "text" }`（セリフ）か
  `{ "type": "mouse", "speakerId", "targetId", "publicRoleKey" }`（マウス公開。
  公開される役職は全員に見える公開情報。公開する側がバカ（マウス表示）の
  ときは、ソロと同じく捏造役職になる）
- `{ "type": "talk", "code", "speakerId", "speakerName", "text" }` — 人間の
  議論の発言を部屋の全員へ配信する（公開情報だけ）
- `{ "type": "mouse", "code", "speakerId", "targetId", "publicRoleKey" }` — 人間の
  マウス公開を部屋の全員へ配信する（公開情報だけ。`discussionStarted` の `talks`
  に入る CPU のマウス公開と同じ形。公開する側がバカのときは捏造役職になる）
- `{ "type": "discussionDoneAccepted" }` — 議論終了の合図を受け付けた返信
- `{ "type": "discussionEnded", "code", "view" }` — 議論の終了時に席ごとに
  1通ずつ配信。`view` はその席だけの player view（`phase` は `"vote"`）。
  投票の締め切りタイマー（60秒）もここから回る
- `{ "type": "voteAccepted", "targetId": 2 }` — 投票を受け付けた合図
- `{ "type": "voteResolved", "code", "view", "vote": { "logs", "exiledId", "exiledName", "exiledPublicRoleKey", "tally" } }` —
  投票の集計時に席ごとに1通ずつ配信。`view` は集計後の player view（続くなら
  `phase` は `"night"`、`day` は翌日）。`logs` は投票結果の公開ログ（同数なら
  追放なし、最多票なら追放と役職の公開）、`tally` は対象ごとの票数の内訳
  （誰が誰へ入れたかは出さない）。集計後に翌日の夜が始まる
- `{ "type": "gameEnded", "code", "view", "result": { "winText", "winnerFaction", "sub", "highlights", "rows" } }` —
  試合の終了時に席ごとに1通ずつ配信。`view` はその席だけの player view（`phase` は
  `"end"`）。`result` は結果開示：決着文言・勝利陣営・ハイライト・全員の行
  （実役職・陣営・脱落の記録。試合終了後の開示なのでバカの実役職も含む）。
  投票の集計で決着したときと、夜の解決で決着したとき（その場合は
  `nightResolved` の view も `phase` は `"end"`）の両方で送られる
- `{ "type": "error", "error": "room_not_found" | "room_full" | "bad_token" | "bad_json" | "unknown_type" | "bad_message" | "not_in_room" | "not_host" | "not_enough_players" | "game_already_started" | "no_game" | "not_night" | "not_a_player" | "not_alive" | "no_night_action" | "invalid_target" | "not_discussion" | "bad_talk" | "not_mouse" | "already_used" | "not_vote" }`

`players` は公開情報のみ（`id` / `name` / `icon` / `connected`）。トークンは含まない。
試合中の再接続では `reconnected` に現在の player view（`view`）が付く。
議論中の再接続では議論済み扱いが外れ、戻ってきたらまた議論に参加できる。
投票中の再接続では棄権扱いが外れ、戻ってきたらまた投票できる。

## テスト

```sh
node --test server/tests/ws.test.js server/tests/rooms.test.js server/tests/game.test.js server/tests/server.test.js
```

`server/tests/server.test.js` は実際に HTTP + WebSocket で接続する通しテスト
（Node 24 の組み込み WebSocket クライアントを使用）。
