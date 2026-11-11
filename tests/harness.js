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
    textContent: "",
    className: "",
    dataset: {},
    style: {},
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 0,
    tabIndex: -1,
    onclick: null,
    _attributes: {},
    _listeners: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    appendChild(child) { el.children.push(child); return child; },
    remove() {},
    setAttribute(name, value) { el._attributes[name] = String(value); },
    getAttribute(name) { return name in el._attributes ? el._attributes[name] : null; },
    removeAttribute(name) { delete el._attributes[name]; },
    addEventListener(type, fn) {
      if (!el._listeners[type]) el._listeners[type] = [];
      el._listeners[type].push(fn);
    },
    // テストからイベントを発火させるためのヘルパー。
    dispatch(type, event = {}) {
      for (const fn of el._listeners[type] || []) fn(event);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return el; },
    scrollIntoView() {},
  };
  // 実 DOM と同じく innerHTML = "" は子要素を消す。カードやログの
  // 再描画で children が溜まり続けるのを防ぐ。
  let _innerHTML = "";
  Object.defineProperty(el, "innerHTML", {
    get() { return _innerHTML; },
    set(v) {
      _innerHTML = String(v);
      if (_innerHTML === "") el.children.length = 0;
    },
    enumerable: true,
    configurable: true,
  });
  return el;
}

// AudioContext の最小スタブ。BGM の発音パス（oscillator / gain の生成・
 // 接続・開始・停止）が壊れていないことを、ブラウザ無しで確認するため。
// 生成したノード数とインスタンスを記録する。
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = {};
    this.createdOscillators = [];
    this.createdGains = [];
    this.resumed = false;
    FakeAudioContext.instances.push(this);
  }
  resume() { this.resumed = true; return Promise.resolve(); }
  createOscillator() {
    const osc = {
      type: "sine",
      frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() { return osc; },
      start() {}, stop() {},
    };
    this.createdOscillators.push(osc);
    return osc;
  }
  createGain() {
    const g = {
      gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() { return g; },
      disconnect() {},
    };
    this.createdGains.push(g);
    return g;
  }
  createBuffer() { return { getChannelData: () => new Float32Array(10) }; }
  createBufferSource() {
    const src = { buffer: null, connect() { return src; }, start() {}, stop() {} };
    return src;
  }
  createBiquadFilter() {
    const f = { type: "lowpass", frequency: { value: 0 }, connect() { return f; } };
    return f;
  }
}
FakeAudioContext.instances = [];

function createSandbox(seedSettings, { fakeAudio = false } = {}) {
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
  if (fakeAudio) sandbox.AudioContext = FakeAudioContext;
  return { sandbox, alerts, elements, localStorage };
}

// index.html を読み込んでゲームを実行し、内部 API とスタブを返す。
// seedSettings: タイトル画面の設定（fakeCount / bomber / sound / difficulty / bgm）。
// fakeAudio: true なら FakeAudioContext を差し込み、BGM の発音パスを検証できる。
function loadGame({ seedSettings, fakeAudio } = {}) {
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
  ROLES, PHASE_META, CHAR_TALK, charTalkPool, pickTalkLine, setupGame, runNight, resolveNightActions, doVote,
  morningToDiscussion, discussionToVote, revealMouse, checkWin,
  getEffectiveRoleKey, showResults, buildHighlights, gameSettings,
  draw, paintSettings,
  get state() { return state; },
  BGM_CHORDS, startBgm, stopBgm, isBgmPlaying,
};
`;
  const { sandbox, alerts, elements, localStorage } = createSandbox(seedSettings, { fakeAudio });
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "index.html<script>" });
  return { FB: sandbox.__FB__, alerts, elements, localStorage, sandbox, FakeAudioContext };
}

module.exports = { loadGame };
