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
  キャラの自動割当（入室順にルナ・ミオ・ユイ…）。

## プロトコル（JSON テキストフレーム）

クライアント → サーバー：

- `{ "type": "createRoom" }` — 部屋を作る
- `{ "type": "joinRoom", "code": "ABCD" }` — コードで参加する
- `{ "type": "reconnect", "code": "ABCD", "token": "<セッショントークン>" }` — 切断後に同じ席へ戻る

サーバー → クライアント：

- `{ "type": "roomCreated" | "roomJoined" | "reconnected", "code", "token", "playerId", "name", "icon", "players" }`
- `{ "type": "roomUpdate", "code", "players" }` — 参加・切断・再接続時に全員へ配信
- `{ "type": "error", "error": "room_not_found" | "room_full" | "bad_token" | "bad_json" | "unknown_type" | "bad_message" }`

`players` は公開情報のみ（`id` / `name` / `icon` / `connected`）。トークンは含まない。
1試合の進行（配役・夜・議論・投票・勝敗）は後の歩で追加する。

## テスト

```sh
node --test server/tests/ws.test.js server/tests/rooms.test.js server/tests/server.test.js
```

`server/tests/server.test.js` は実際に HTTP + WebSocket で接続する通しテスト
（Node 24 の組み込み WebSocket クライアントを使用）。
