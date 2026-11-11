// Fake Bloom のゲームロジックを Node の vm で動かすためのテストハーネス。
// index.html の <script> を読み、IIFE の外枠だけ外して DOM スタブ付きの
// vm コンテキストで実行する。jsdom 等の外部依存は不要。
// 実行後に globalThis.__FB__ へゲーム内部（setupGame / runNight /
// checkWin / state など）を公開するので、テスト側から直接操作できる。
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeElement(id) {
  const el = {
    id: id || "",
    innerHTML: "",
    textContent: "",
    className: "",
    dataset: {},
    style: {},
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 0,
    onclick: null,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    appendChild(child) { el.children.push(child); return child; },
    remove() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return el; },
    scrollIntoView() {},
  };
  return el;
}

function createSandbox(seedSettings) {
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };
  // gameSettings はスクリプト読み込み時に localStorage から読まれるため、
  // テストしたい設定はここで先に仕込んでおく。
  if (seedSettings) {
    localStorage.setItem("fakeBloomSettings", JSON.stringify(seedSettings));
  }
  const sandbox = {
    console,
    Math,
    JSON,
    // カットイン等の遅延タイマーはテスト終了を妨げないよう unref する。
    setTimeout: (fn, ms, ...args) => {
      const t = setTimeout(fn, ms, ...args);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout,
    alert: (msg) => alerts.push(String(msg)),
    // アイコン・歩行画像の fetch は失敗扱いにし、ゲーム側の catch に任せる。
    fetch: async () => ({ ok: false, text: async () => "" }),
    localStorage,
    document: {
      body: makeElement("body"),
      getElementById: getEl,
      createElement: () => makeElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, alerts, elements, localStorage };
}

// index.html を読み込んでゲームを実行し、内部 API とスタブを返す。
// seedSettings: タイトル画面の設定（fakeCount / bomber / sound / difficulty）。
function loadGame({ seedSettings } = {}) {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("index.html に <script> が見つかりません");
  let src = m[1];
  // IIFE の外枠だけ外す。残りの本体と、後ろに追加する公開コードが
  // 同じスコープを共有するのがポイント。
  src = src.replace(/^\s*\(\(\) => \{\s*\n?/, "");
  src = src.replace(/\}\)\(\);\s*$/, "");
  src += `
;globalThis.__FB__ = {
  ROLES, PHASE_META, setupGame, runNight, resolveNightActions, doVote,
  morningToDiscussion, discussionToVote, revealMouse, checkWin,
  getEffectiveRoleKey, showResults, gameSettings,
  get state() { return state; },
};
`;
  const { sandbox, alerts, elements, localStorage } = createSandbox(seedSettings);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "index.html<script>" });
  return { FB: sandbox.__FB__, alerts, elements, localStorage, sandbox };
}

module.exports = { loadGame };
