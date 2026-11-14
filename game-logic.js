// Fake Bloom の共有ゲームロジック（オンライン対戦フェーズ0）。
// 試合のデータと、DOM を使わない純粋な関数だけを集めた共有モジュール。
// ブラウザでは index.html が <script src> で読み込み globalThis.FakeBloomLogic
// に載せ、将来のサーバー（フェーズ1）は require で同じものを使う。
// ルール：このファイルに画面操作・保存領域・通信・タイマーは置かない。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FakeBloomLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROLES = {
    apprenticeSeer: {
      name: "見習い占い師",
      icon: "🔮",
      faction: "イノセント",
      desc: "夜に1人の陣営を調べる。結果がズレる個体が混ざることがある（本人にも分からない）。",
      guideDesc: "夜に1人の陣営を調べる。結果がズレる個体が混ざることがある（本人にも分からない）。",
      shortDesc: "夜に1人の陣営を調べられる。",
      nightActionHint: "怪しい相手を1人選んで調査しよ。",
      resultInterpretation: "表示された陣営をそのまま参考にしてOK。",
      riskNote: "相手が『なりすまし』だと65%でイノセント判定に化けることがある。",
      nightAction: { type: "investigate", priority: 20, allowSelf: false }
    },
    guardian: {
      name: "守り手",
      icon: "🛡️",
      faction: "イノセント",
      desc: "夜に1人を守る。",
      guideDesc: "夜に1人を襲撃や爆発から守る。",
      shortDesc: "夜に1人を守って、襲撃や爆発から助けられる。",
      nightActionHint: "襲われそうな子を1人選んでガード。",
      resultInterpretation: "夜の報告で襲撃が防がれたらガード成功の可能性あり。",
      riskNote: "誰を守ったかは公開されない。読み負けると守り切れない。",
      nightAction: { type: "protect", priority: 10, allowSelf: true }
    },
    tracker: {
      name: "追跡係",
      icon: "👣",
      faction: "イノセント",
      desc: "夜に1人が誰を訪ねたか分かる。",
      guideDesc: "夜に1人が誰を訪ねたか分かる。",
      shortDesc: "夜に1人が誰の家を訪ねたか分かる。",
      nightActionHint: "行動が怪しい相手を1人選んで追跡。",
      resultInterpretation: "『誰を訪れたか』は間接情報。単体で黒確定にはしないのがコツ。",
      riskNote: "追跡先の行動理由までは分からないため、早とちり注意。",
      nightAction: { type: "track", priority: 30, allowSelf: false }
    },
    police: {
      name: "ポリス",
      icon: "🚔",
      faction: "イノセント",
      desc: "夜に1人を訪ねて、その夜の行動を封じる（FeignのPolice方式）。",
      guideDesc: "夜に1人の行動を封じる（襲撃そのものは止められない）。",
      shortDesc: "夜に1人の行動を封じられる。",
      nightActionHint: "能力を使いそうな相手を1人選んで足止め。",
      resultInterpretation: "妨害した相手はその夜、能力を使えない（調査・護衛・追跡・盗み見・爆弾など）。ただしインポスター陣営の襲撃そのものは止められない。",
      riskNote: "味方の能力者を止めると損。相手の役職読みが大事。",
      nightAction: { type: "block", priority: 5, allowSelf: false }
    },
    lookout: {
      name: "見張り役",
      icon: "🔭",
      faction: "イノセント",
      desc: "夜に1人の家を見張り、その夜に訪れた全員が分かる（FeignのLookout方式）。",
      guideDesc: "夜に1人の家を訪れた全員が分かる。",
      shortDesc: "夜に1人の家を訪れた人たちを調べられる。",
      nightActionHint: "狙われそうな子や怪しい子の家を見張ろう。",
      resultInterpretation: "訪問者の中に襲撃者や能力者が混ざっている。誰が何をしたかまでは分からない。",
      riskNote: "訪問＝黒ではない。護衛や調査の訪問も見えてしまう。",
      nightAction: { type: "lookout", priority: 35, allowSelf: true }
    },
    trapper: {
      name: "トラッパー",
      icon: "🪤",
      faction: "イノセント",
      desc: "夜に1人の家へ罠を設置。その人が襲撃されて倒れたら、襲撃者も道連れになる（FeignのTrapper方式）。",
      guideDesc: "夜に1人の家へ罠を設置。その人が襲撃で倒れたら襲撃者も道連れ。",
      shortDesc: "1人の家に罠をしかけ、襲撃者を道連れにできる。",
      nightActionHint: "襲われそうな子の家に罠を仕掛けよう。自分の家にも設置できる。",
      resultInterpretation: "罠が作動したら朝の報告で分かる。罠はその夜かぎり。",
      riskNote: "護衛と重なると襲撃自体が防がれて罠は不発。爆弾には反応しない。",
      nightAction: { type: "trap", priority: 12, allowSelf: true }
    },
    doctor: {
      name: "ドクター",
      icon: "🩺",
      faction: "イノセント",
      desc: "夜に1人を診察。その人がその夜に襲撃や爆発で倒れたら、朝までに蘇生させる。",
      guideDesc: "夜に1人を診察。その人がその夜倒れたら蘇生させる。",
      shortDesc: "選んだ人がその夜倒れたら、朝までに蘇生できる。",
      nightActionHint: "狙われそうな子を診察しておこう。自分も選べる。",
      resultInterpretation: "蘇生が起きると朝の報告で公開される（倒れた人の役職は公開されたまま）。",
      riskNote: "倒れなかった相手では何も起きない。妨害されると蘇生できない。",
      nightAction: { type: "revive", priority: 38, allowSelf: true }
    },
    mouse: {
      name: "マウス",
      icon: "🐭",
      faction: "イノセント",
      desc: "能力は昼。ゲーム中1回だけ、議論中に1人の本当の役職を全員に公開できる（FeignのMouse方式）。",
      guideDesc: "昼に1回だけ、1人の本当の役職を全員に公開できる。",
      shortDesc: "議論中に1回だけ、1人の本当の役職をみんなに公開できる。",
      nightActionHint: "夜は能力なし。昼の議論で公開ボタンのタイミングを計ろう。",
      resultInterpretation: "公開された役職は確定情報。インポスターがバレれば追放まっしぐら。",
      riskNote: "1回きり。誰を公開するかで勝敗が動く。",
      nightAction: null
    },
    politician: {
      name: "政治家",
      icon: "🗳️",
      faction: "イノセント",
      desc: "能力は投票。自分の票が常に2票分になる（FeignのPolitician方式）。",
      guideDesc: "投票の票が2票分になる。",
      shortDesc: "自分の投票が2票分になる。",
      nightActionHint: "夜は能力なし。昼は投票で決着をつける動きを考えよう。",
      resultInterpretation: "票が割れそうな場面で特に強い。",
      riskNote: "票の重さから正体を推測されることもある。",
      nightAction: null
    },
    villager: {
      name: "村ガール",
      icon: "🏠",
      faction: "イノセント",
      desc: "能力なし。議論と投票で戦う。",
      guideDesc: "能力なし。議論と投票が主軸。",
      shortDesc: "特別な能力はない。議論と投票で戦う。",
      nightActionHint: "夜は情報整理に集中。朝ログと発言の矛盾を探そう。",
      resultInterpretation: "自分の夜結果はないので、他者の報告の整合性がカギ。",
      riskNote: "強い能力はないぶん、ミスリードに流されやすい。",
      nightAction: null
    },
    fakeGirl: {
      name: "フェイクガール",
      icon: "🎭",
      faction: "インポスター",
      desc: "インポスター陣営として夜に1人を脱落させる。襲撃しない夜は、イノセント側1人の夜行動を妨害する。",
      guideDesc: "襲撃しない夜は、イノセント側1人の行動を妨害する。",
      shortDesc: "夜に仲間と1人を襲撃できる。襲撃しない夜は1人の行動を妨害できる。",
      nightActionHint: "仲間と相談した想定で、インポスター陣営として襲撃先を1人に絞る。",
      resultInterpretation: "襲撃が通れば盤面有利、守られると計画を立て直し。妨害された相手はその夜、能力を使えない。",
      riskNote: "守り手の防衛先に当たると襲撃失敗。襲撃は陣営で1回だけ。",
      nightAction: { type: "attack", priority: 40, allowSelf: false }
    },
    mimic: {
      name: "なりすまし",
      icon: "🪞",
      faction: "インポスター",
      desc: "調査でイノセントに見えることがある。襲撃しない夜は、イノセント側1人の実役職を盗み見る。得た情報は陣営の襲撃先決定に使われる。",
      guideDesc: "調査でイノセントに見えることがある。襲撃しない夜はイノセント側1人の実役職を盗み見する。",
      shortDesc: "調査でイノセントに見えることがある。襲撃しない夜は1人の役職を盗み見できる。",
      nightActionHint: "占いをいなしつつ、インポスター陣営の襲撃先相談に乗る立ち回り。",
      resultInterpretation: "調査を受けると、相手視点でイノセント結果が出る可能性がある。盗み見で占い師や守り手が割れると、優先的に狙われる。",
      riskNote: "target.roleKey === \"mimic\" のとき65%でイノセント判定に化ける。襲撃実行はインポスター陣営で1回だけ。",
      nightAction: { type: "attack", priority: 40, allowSelf: false }
    },
    bomber: {
      name: "ボマー",
      icon: "💣",
      faction: "ニュートラル",
      desc: "第三勢力。夜に1人へ爆弾を仕掛け、翌日の夜に爆発する（FeignのBomber方式）。最後の1人になるか、爆弾で2人以上を倒して生き残ると勝利。",
      guideDesc: "約半分のゲームに登場。爆弾は翌日の夜に爆発。最後の1人になるか、爆弾で2人以上倒して生き残ると勝利。",
      shortDesc: "毎晩1人に爆弾をしかけ、翌日の夜に爆発させる第三勢力。",
      nightActionHint: "毎晩だれか1人に爆弾を仕掛けよう。自分以外を全員倒せば勝ち。",
      resultInterpretation: "爆弾は護衛されている相手には効かない。占われると『ニュートラル』とバレる。",
      riskNote: "イノセント・インポスターどちらの勝利条件にも数えられない。両陣営から狙われる孤独な役職。",
      nightAction: { type: "plant", priority: 25, allowSelf: false }
    },
    baka: {
      name: "バカ",
      icon: "🃏",
      faction: "イノセント",
      desc: "本人には分からないが、別のイノセント役職として振る舞うトリッキー枠。表示された役職で夜行動できるが、その結果はすべて偽物（FeignのInsane方式）。",
      guideDesc: "本人は別のイノセント役職だと思って行動するが、結果はすべて偽物。本人も自分がバカだとは分からない。実役職は結果画面でのみ公開される。",
      shortDesc: "本人には別の役職に見えるけれど、夜の結果は全部デタラメになる。",
      nightActionHint: "表示された役職として夜行動しよう（能力なしのこともある）。ただし結果は信用できない。",
      resultInterpretation: "夜の結果はすべて偽物。占い判定はランダム、護衛は実際には守れず、追跡情報もデタラメ。実役職が分かるのは結果画面だけ。",
      riskNote: "自分の結果を根拠に推理すると論理が破綻して疑われる。周りから見ると、結果の矛盾がバカのサイン。",
      nightAction: null
    }
  };

  const PHASE_META = {
    night: { label: "夜行動", button: "夜行動を実行" },
    morning: { label: "朝の報告", button: "報告を読む" },
    discussion: { label: "昼の議論", button: "議論を終えて投票へ" },
    vote: { label: "投票", button: "投票する" },
    end: { label: "勝敗", button: "-" }
  };

  const PLAYER_NAMES = ["ルナ", "ミオ", "ユイ", "カノン", "スズ", "リリ", "ノア", "エマ"];
  const PLAYER_ICONS = ["🌸", "🪄", "🧁", "🎀", "💫", "🫧", "🍬", "🌙"];
  const ICON_SLUGS = ["luna", "mio", "yui", "kanon", "suzu", "riri", "noa", "ema"];

  // Character voice (キャラ別セリフ第1弾): each of the 8 girls speaks in her
  // own tone during discussion. Shape mirrors `templates` inside
  // morningToDiscussion: defense/pressure are tiered (low/mid/high), the
  // rest are flat arrays. A character line is used ~60% of the time when
  // one exists; the shared templates stay as the fallback.
  const CHAR_TALK = {
    "ルナ": {
      defense: {
        low: ["{target} は大丈夫だよ！いつも通りだし", "{target} を疑うのはまだ早いよ！"],
        mid: ["{target}、ちょっと気になるけど…まだ決めつけないでおこう", "{target} の様子、なんか変だったかも？"],
        high: ["{target}、絶対怪しいよ！みんな、見てたでしょ", "{target} は今日落とすべきだと思う！"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよ、安心して", "{target} に圧をかけるのはまだ早いって"],
        mid: ["{target}、昨夜のこと教えてよ！", "{target} は何か知ってそうだよね"],
        high: ["{target}、正直に言って！昨夜何してたの", "{target} を信じきれないよ…説明して！"]
      },
      tracker: ["昨夜は誰も見なかったなぁ…静かだったよ"],
      observe: ["まだ情報が少ないね。話を聞こうよ", "まずはみんなの話を聞きたいな"],
      claimFake: ["占いの結果…{target} がインポスターだったよ！", "{target}、占いで黒って出たの。信じて！"],
      claimWhite: ["{target} は白だったよ！安心してね", "占いでは {target} はイノセントだったよ"],
      claimNeutral: ["{target}、どっちでもないみたい…第三勢力かも", "{target} はニュートラル判定だったよ"],
      bomb: ["爆弾って怖いよね…ボマーを早く見つけよう！"],
      guardian: ["昨夜の襲撃、防げてよかったね！"],
      endgame: ["人数が少ないよ…一票を大事にいこう"]
    },
    "ミオ": {
      defense: {
        low: ["{target} は怪しくないの。星がそう言ってるの", "{target} のオーラは白いの"],
        mid: ["{target}、ちょっと影が見えるの…", "{target} の運命、少し曇ってるの"],
        high: ["{target} の影は真っ黒なの。間違いないの", "星の導きよ…{target} がインポスターなの"]
      },
      pressure: {
        low: ["{target} は大丈夫なの。心配ないの", "{target} を疑うのはまだ早いの"],
        mid: ["{target}、昨夜のことを話すの。月が見てるの", "{target} は何か隠してるの"],
        high: ["{target}、嘘は星にバレるの。正直に言うの", "{target} を信じられないの…"]
      },
      tracker: ["昨夜は誰の気配もなかったの。静かな夜だったの"],
      observe: ["まだ星の声が小さいの。もう少し待つの", "情報が少ないの。様子を見るの"],
      claimFake: ["占いの水晶が告げたの…{target} がインポスターなの", "私の占いでは {target} は黒なの"],
      claimWhite: ["{target} は白なの。星が微笑んでるの", "占いでは {target} はイノセントなの"],
      claimNeutral: ["{target}、どっちの陣営でもないの。不思議なの", "{target} は第三勢力の気配なの"],
      bomb: ["爆弾の気配…ボマーがいるの、気をつけるの"],
      guardian: ["昨夜の襲撃、誰かが防いだの。よかったの"],
      endgame: ["もう人数が少ないの…星に祈るしかないの"]
    },
    "ユイ": {
      defense: {
        low: ["{target} は大丈夫だよぉ。いつも通りだよぉ", "{target} を疑うのはかわいそうだよぉ"],
        mid: ["{target}、ちょっと気になるなぁ…", "{target} の様子、少し変だったかもぉ"],
        high: ["{target} は怪しいよぉ…怖いなぁ", "{target}、今日は落としたほうがいいかもぉ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよぉ", "{target} に厳しくするのはまだ早いよぉ"],
        mid: ["{target}、昨夜のこと教えてほしいなぁ", "{target} は何か知ってそうだよぉ"],
        high: ["{target}、正直に言ってほしいなぁ…", "{target} を信じきれないよぉ…"]
      },
      tracker: ["昨夜は誰も見なかったよぉ。静かだったなぁ"],
      observe: ["まだよくわからないなぁ。話を聞こうよぉ", "様子見でいいかなぁ…"],
      claimFake: ["占いの結果なんだけどぉ…{target} がインポスターだったよぉ", "{target}、占いで黒って出ちゃったよぉ"],
      claimWhite: ["{target} は白だったよぉ。よかったねぇ", "占いでは {target} はイノセントだったよぉ"],
      claimNeutral: ["{target}、どっちでもないみたいだよぉ…", "{target} は第三勢力かもぉ…"],
      bomb: ["爆弾って怖いよぉ…ボマー、早く見つけたいなぁ"],
      guardian: ["昨夜の襲撃、防げてよかったよぉ…"],
      endgame: ["人数が少ないよぉ…慎重にいこうねぇ"]
    },
    "カノン": {
      defense: {
        low: ["{target} は怪しくありませんわ。ご安心なさいませ", "{target} を疑うのは時期尚早ですわ"],
        mid: ["{target}、少々気になりますわね", "{target} の態度、少し不審ですわ"],
        high: ["{target} は非常に怪しいですわ。今日落とすべきですわ", "{target} が黒であることは明白ですわ"]
      },
      pressure: {
        low: ["{target} は大丈夫ですわ。ご心配なく", "{target} に圧をかけるのはまだ早いですわ"],
        mid: ["{target}、昨夜のことをお話しなさい", "{target} は何かご存知のようですわね"],
        high: ["{target}、正直にお答えなさい。昨夜何をしていたのかしら", "{target} を信じることはできませんわ"]
      },
      tracker: ["昨夜は誰もお見かけしませんでしたわ。静かな夜でした"],
      observe: ["まだ情報が不足していますわ。お話を伺いましょう", "まずは皆様のお話を聞くべきですわね"],
      claimFake: ["占いの結果ですわ…{target} がインポスターでしたわ", "私の占いでは {target} は黒ですわ"],
      claimWhite: ["{target} は白でしたわ。ご安心くださいませ", "占いでは {target} はイノセントでしたわ"],
      claimNeutral: ["{target}、どちらでもないようですわ。第三勢力かしら", "{target} はニュートラル判定でしたわ"],
      bomb: ["爆弾とは恐ろしいことですわ…ボマーを早く見つけませんと"],
      guardian: ["昨夜の襲撃を防げたのは大きいですわね"],
      endgame: ["人数が少なくなりましたわ…一票を慎重に使いましょう"]
    },
    "スズ": {
      defense: {
        low: ["{target} は白だ。疑う理由はない", "{target} は普通だ。様子見でいい"],
        mid: ["{target}、少し気になるな", "{target} の動きが引っかかる"],
        high: ["{target} は黒だ。今日落とす", "{target}、間違いなく怪しい"]
      },
      pressure: {
        low: ["{target} は大丈夫だ。放っておけ", "{target} はまだいい。急ぐな"],
        mid: ["{target}、昨夜のことを話せ", "{target} は何か知ってるはずだ"],
        high: ["{target}、昨夜何してた。言え", "{target} は信用できない"]
      },
      tracker: ["昨夜は誰も見てない。静かだった"],
      observe: ["情報が足りない。聞くしかない", "まだ決めるな。様子見だ"],
      claimFake: ["占いの結果。{target} はインポスターだ", "{target}、黒だ。信じろ"],
      claimWhite: ["{target} は白だ。安心しろ", "占いでは {target} はイノセントだ"],
      claimNeutral: ["{target} はどっちでもない。第三勢力だ", "{target}、ニュートラル判定だ"],
      bomb: ["爆弾か。ボマーを早く見つける"],
      guardian: ["昨夜の襲撃、防げたのは大きい"],
      endgame: ["人数が少ない。外したら終わりだ"]
    },
    "リリ": {
      defense: {
        low: ["{target} は白い雲みたいだよぉ。怪しくないよぉ", "{target} を疑うのはまだ早いかなぁ"],
        mid: ["{target}、なんだかもやもやするなぁ…", "{target} の色、ちょっと曇ってるかもぉ"],
        high: ["{target} は真っ黒な雲だよぉ…怖いなぁ", "{target}、今日落としたほうがいいかもぉ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよぉ。ふわふわしてるよぉ", "{target} に圧をかけるのはまだ早いかなぁ"],
        mid: ["{target}、昨夜のこと教えてほしいなぁ。夢で見たの？", "{target} は何か知ってそうだよぉ"],
        high: ["{target}、正直に言ってほしいなぁ…雲の上から見てるよぉ", "{target} を信じきれないかなぁ…"]
      },
      tracker: ["昨夜は誰も見なかったなぁ。夢みたいに静かだったよぉ"],
      observe: ["まだよくわからないなぁ。ふわふわしてるよぉ", "様子見がいいかなぁ…雲の流れを見ようよぉ"],
      claimFake: ["占いの結果なんだけどぉ…{target} がインポスターだったよぉ", "{target}、夢の中で黒って見えたよぉ"],
      claimWhite: ["{target} は白い雲みたいだったよぉ。よかったねぇ", "占いでは {target} はイノセントだったよぉ"],
      claimNeutral: ["{target}、どっちでもないみたいだよぉ…不思議な色だよぉ", "{target} は第三勢力かもぉ…"],
      bomb: ["爆弾って怖いなぁ…ボマー、早く見つけたいよぉ"],
      guardian: ["昨夜の襲撃、防げてよかったなぁ…ほっとしたよぉ"],
      endgame: ["人数が少ないなぁ…慎重にいこうねぇ"]
    },
    "ノア": {
      defense: {
        low: ["{target} は大丈夫だよ！信じてあげようよ", "{target} を疑うのはまだ早いじゃん！"],
        mid: ["{target}、ちょっと怪しいかも…", "{target} の様子、なんか変じゃん？"],
        high: ["{target}、絶対怪しいじゃん！今日落とそうよ", "{target} は黒だよ！みんな見てたでしょ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうじゃん。放っておこうよ", "{target} に圧をかけるのはまだ早いって"],
        mid: ["{target}、昨夜のこと教えてよ！", "{target} は何か知ってそうじゃん"],
        high: ["{target}、正直に言いなよ！昨夜何してたの", "{target} を信じきれないよ…説明してよ！"]
      },
      tracker: ["昨夜は誰も見なかったよ。静かだったな"],
      observe: ["まだ情報が少ないよ。話を聞こうよ", "まずはみんなの話を聞きたいな"],
      claimFake: ["占いの結果…{target} がインポスターだったよ！", "{target}、占いで黒って出たよ。信じて！"],
      claimWhite: ["{target} は白だったよ！安心してね", "占いでは {target} はイノセントだったよ"],
      claimNeutral: ["{target}、どっちでもないみたい…第三勢力かも", "{target} はニュートラル判定だったよ"],
      bomb: ["爆弾って怖すぎる…ボマーを早く見つけようよ！"],
      guardian: ["昨夜の襲撃、防げてよかったね！"],
      endgame: ["人数が少ないよ…一票を大事にいこう"]
    },
    "エマ": {
      defense: {
        low: ["{target} は怪しくないわ。様子を見るのがいいわね", "{target} を疑う根拠はまだ薄いわ"],
        mid: ["{target}、少し気になるわね", "{target} の行動に違和感があるわ"],
        high: ["{target} はかなり怪しいわ。今日落とすべきね", "{target} の票の動きが不自然よ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうね。急ぐ必要はないわ", "{target} に圧をかけるのはまだ早いわね"],
        mid: ["{target}、昨夜の行動を説明してちょうだい", "{target} は何か知っているはずよ"],
        high: ["{target}、昨夜何をしていたのか正直に言って", "{target} を信じきるのは難しいわね"]
      },
      tracker: ["昨夜は誰も見なかったわ。静かだったわね"],
      observe: ["まだ情報が少ないわね。話を聞きましょう", "まずは全員の話を聞くべきね"],
      claimFake: ["占いの結果よ…{target} がインポスターだったわ", "私の占いでは {target} は黒よ"],
      claimWhite: ["{target} は白だったわ。安心してちょうだい", "占いでは {target} はイノセントだったわ"],
      claimNeutral: ["{target}、どっちの陣営でもないわね。第三勢力かしら", "{target} はニュートラル判定だったわ"],
      bomb: ["爆弾か…ボマーを早く見つけないと全員危ないわ"],
      guardian: ["昨夜の襲撃を防げたのは大きいわね"],
      endgame: ["人数が少ないわ…一票が重いわね。慎重にいきましょう"]
    }
  };

  // Character-specific pool for one discussion category (tiered pools take
  // a tier). Returns null when the character has no line for it.
  function charTalkPool(name, category, tier) {
    const char = CHAR_TALK[name];
    if (!char) return null;
    const pool = char[category];
    if (Array.isArray(pool)) return pool;
    if (pool && tier) return pool[tier] || null;
    return null;
  }

  // Pick a discussion line: prefer the speaker's own voice (~60%) and fall
  // back to the shared template pool otherwise.
  // `random` is an injectable () => [0,1) source (default Math.random);
  // planDiscussionTalks passes its own so tests can seed the whole draw.
  function pickTalkLine(player, category, tier, genericPool, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const charPool = charTalkPool(player.name, category, tier);
    if (charPool && charPool.length && rnd() < 0.6) return rand(charPool, rnd);
    return rand(genericPool, rnd);
  }
  const INNOCENT_ROLE_KEYS = ["apprenticeSeer", "guardian", "tracker", "villager", "police", "lookout", "trapper", "doctor", "mouse", "politician"];
  // うっかり占い師は独立役職ではなく、見習い占い師の隠し個体。
  // 占い師のうちこの割合が「うっかり個体」になり、本人にも分からない
  // まま 45% の確率で判定がランダムに上書きされる。出現率は
  // シミュレーションで勝率を見ながら調整する（目安 30〜40%）。
  const CLUMSY_SEER_RATE = 0.35;

  function rand(arr, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    return arr[Math.floor(rnd()*arr.length)];
  }

  // Discussion templates: the generic pools morningToDiscussion falls back
  // to when a speaker has no character-specific line. {target} is filled
  // with the talked-about player's name by planDiscussionTalks.
  // defense / pressure / tracker / observe are tiered by the talked-about
  // player's suspicion (low / mid / high); the rest are flat lists.
  const DISCUSSION_TEMPLATES = {
    defense: {
      low: ["{target} は怪しくないと思うけどな","{target} は普通にしてたよ","{target} を疑う理由、まだ薄くない？","{target} は昨夜も静かだったよ"],
      mid: ["{target} は少し気になる","{target} の動き、目立たなかったのが逆に気になる","{target} は話題に上がりやすいね","{target} は様子見かな"],
      high: ["{target} はかなり怪しい","{target} が黒っぽい","{target} を今日落とすべきかも","{target} の票の動きが不自然だよ"]
    },
    pressure: {
      low: ["{target} は大丈夫そう","{target} に圧をかけるのは早いよ","{target} は様子見したい","{target} は今日じゃなくていいと思う"],
      mid: ["{target} に説明してほしい","{target} は何か知ってそう","{target} は情報出して","{target} の昨夜の動き、聞きたいな"],
      high: ["{target}、昨夜何してた？正直に言って","{target} は白じゃない気がする","{target} を信じきれない","{target}、言い訳が弱いと思う"]
    },
    tracker: {
      low: ["私、昨夜は動いてないよ。誰も見なかった","追跡では何も掴めなかった","昨夜は静かだったな"],
      mid: ["何も見なかったけど、空気は怪しい","足跡は薄かったけど気になる","手がかりは少ないまま"],
      high: ["昨夜の動きは怪しさ満点。誰か絶対動いてる","痕跡が残ってた。これは普通じゃない","昨夜、誰か確実に動いてる"]
    },
    observe: {
      low: ["まだ情報が少ないね","誰がインポスターか全然わからない","今日は様子見でいいかも","初手は慎重にいきたいね","まずは話を聞こう"],
      mid: ["そろそろ絞っていきたい","このままだとインポスターに有利だよ","票を合わせるのが大事だね","昨夜の結果がヒントになるはず"],
      high: ["もう決めないと危ない","インポスターはこの中にいる。絶対","外したら終わりが見えるよ","情報は出揃ってきた。あとは決断だけ"]
    },
    claimFake: ["占いの結果なんだけど…{target} がインポスターだったよ","私の占いでは {target} は黒。信じてほしいな","言いにくいけど、{target} がインポスター判定だった","{target}、昨夜調べたらインポスターだったんだ"],
    claimWhite: ["{target} は私の占いではイノセントだったよ","{target} は白判定。疑うなら他を見て","占いでは {target} はイノセント。ひとまず安心かな"],
    claimNeutral: ["{target}、どっちの陣営でもなさそう。ニュートラル判定だった","占いの反応が変だった。{target} は第三勢力かも","{target} はボマーの可能性。近づかないで"],
    bomb: ["爆弾とか怖すぎる…ボマーがいるってことだよね","昨夜の爆発、ボマーの仕業だ…","爆弾は次の夜に爆発するらしい。今日仕掛けられたら明日…","ボマーを早く見つけないと全員危ない"],
    guardian: ["（守れてよかった…！）","昨夜の襲撃が防げたのは大きいね","誰かが守り切ったんだね、ナイスガード"],
    endgame: ["もう人数が少ない…外したら終わりだよ","ここからは一票が重い。慎重にいこ","残り少ないし、情報は全部出して考えよ"]
  };

  // Discussion CPU talk selection (the pure part of morningToDiscussion):
  // decides which CPU players speak in the discussion and what they say.
  // Returns an ordered list of events for the browser to perform:
  //   { type: "mouse", speakerId, targetId } — reveal the target's role
  //     (the browser calls revealMouse for it)
  //   { type: "talk", speakerId, text } — a spoken line with {target}
  //     already replaced by the talked-about player's name.
  // No DOM, no logging here; the browser performs revealMouse /
  // sayDialogue per event, in order.
  // The mouse branch mirrors revealMouse's suspicion update on the target
  // (innocent shown: -5, otherwise 8) so later lines in the same
  // discussion plan against the revealed value, as the original inline
  // revealMouse call did; the browser re-applies the same update when it
  // performs the event. A baka mouse shows a random other role, as in
  // revealMouse (drawn here from the injected random).
  // state: players, mode, humanPlayerIds, playerId, nightReport,
  // lastInvestigation, bombReport. alive: the living players.
  // opts: { random } — injectable () => [0,1) (default Math.random).
  function planDiscussionTalks(state, alive, opts = {}) {
    const rnd = typeof opts.random === "function" ? opts.random : Math.random;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    // nightReport carries no targetId in practice (only type/victimId),
    // so this is undefined and the fallbacks below apply; read it the
    // same way as the original code so a future targetId is honoured.
    const target = state.players[state.nightReport?.targetId];
    const suspicionTier = (value) => {
      if (value >= 2.5) return "high";
      if (value >= 1) return "mid";
      return "low";
    };
    // In pass-and-play humans talk out loud; only CPU speak automatically.
    // The more humans, the fewer CPU lines (phase 4), so the log is not
    // flooded with CPU lines. Solo: every CPU speaks, as before.
    let cpuSpeakers = alive.filter(p => state.mode === "pnp"
      ? !(state.humanPlayerIds || []).includes(p.id)
      : p.id !== state.playerId);
    if (state.mode === "pnp") {
      const cap = Math.max(1, 6 - (state.humanPlayerIds || []).length);
      cpuSpeakers = cpuSpeakers.sort(() => rnd() - 0.5).slice(0, cap);
    }
    const events = [];
    for (const p of cpuSpeakers) {
      if (getEffectiveRoleKey(p) === "mouse" && !p.mouseUsed && rnd() < 0.45) {
        const others = alive.filter(q => q.id !== p.id);
        const tgt = others.slice().sort((a, b) => b.suspicion - a.suspicion)[0];
        if (tgt) {
          p.mouseUsed = true;
          let shownRoleKey = getPublicRoleKey(tgt);
          if (p.roleKey === "baka") {
            shownRoleKey = pick(Object.keys(ROLES).filter(k => k !== "baka"));
          }
          tgt.suspicion = ROLES[shownRoleKey].faction === "イノセント" ? -5 : 8;
          events.push({ type: "mouse", speakerId: p.id, targetId: tgt.id });
          continue;
        }
      }
      const inv = state.lastInvestigation?.[p.id];
      const invTarget = inv ? state.players[inv.targetId] : null;
      let category, lineTarget;
      if (inv && inv.result === "インポスター" && invTarget?.alive) {
        category = "claimFake"; lineTarget = invTarget;
      } else if (state.bombReport?.explodedVictims?.length && rnd() < 0.5) {
        category = "bomb";
      } else if (inv && inv.result === "ニュートラル" && invTarget?.alive && rnd() < 0.5) {
        category = "claimNeutral"; lineTarget = invTarget;
      } else if (inv && inv.result === "イノセント" && invTarget?.alive && rnd() < 0.35) {
        category = "claimWhite"; lineTarget = invTarget;
      } else if (p.roleKey === "guardian" && state.nightReport?.type === "blocked" && rnd() < 0.45) {
        category = "guardian";
      } else if (p.lastTarget != null) {
        category = "tracker"; lineTarget = state.players[p.lastTarget];
      } else if (alive.length <= 4 && rnd() < 0.4) {
        category = "endgame";
      } else {
        const others = alive.filter(q => q.id !== p.id);
        lineTarget = others[Math.floor(rnd() * others.length)];
        category = rnd() < 0.5 ? "defense" : "pressure";
        if (!lineTarget) { category = "observe"; lineTarget = target; }
        if (rnd() < 0.2) category = "observe";
      }
      let line;
      if (Array.isArray(DISCUSSION_TEMPLATES[category])) {
        line = pickTalkLine(p, category, null, DISCUSSION_TEMPLATES[category], rnd);
      } else {
        const tier = suspicionTier((lineTarget || target)?.suspicion || 0);
        line = pickTalkLine(p, category, tier, DISCUSSION_TEMPLATES[category][tier], rnd);
      }
      const nameForLine = lineTarget?.name || target?.name || "みんな";
      events.push({ type: "talk", speakerId: p.id, text: line.replaceAll("{target}", nameForLine) });
    }
    return events;
  }

  // Fisher-Yates shuffle with an injectable random source (default
  // Math.random). The browser passes nothing; tests pass a seeded
  // function for deterministic draws.
  function shuffle(arr, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Role draw (the pure part of setupGame): deal 8 roles from the
  // settings. Returns one entry per player, in player order:
  // { roleKey, fakeDisplayRoleKey, clumsy }.
  // - fakeCount "random" draws 1 Fake 35% / 2 Fakes 65% (PR #49);
  //   a lone Fake is one of fakeGirl / mimic at random.
  // - the seer is always in; the other Innocent power roles are drawn
  //   and about half of games also get the neutral Bomber.
  // - the baka always gets a random Innocent display role, and the seer
  //   is a hidden clumsy individual with CLUMSY_SEER_RATE.
  // `random` is an injectable () => [0,1) source for deterministic tests.
  function dealRoles(settings, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const fakeCount = settings.fakeCount === "random"
      ? (rnd() < 0.35 ? 1 : 2)
      : Number(settings.fakeCount);
    const fixedFakeRoles = ["fakeGirl", "mimic"];
    const fakePool = fakeCount === 1
      ? [fixedFakeRoles[Math.floor(rnd() * fixedFakeRoles.length)]]
      : [...fixedFakeRoles];
    const hasBomber = settings.bomber === "random" ? rnd() < 0.5 : settings.bomber === "on";
    const pureSlots = 8 - fakeCount - 1 - (hasBomber ? 1 : 0);
    const drawPool = shuffle(
      INNOCENT_ROLE_KEYS.filter(k => !["apprenticeSeer", "villager"].includes(k)),
      rnd
    );
    const pureRoles = ["apprenticeSeer", ...drawPool.slice(0, Math.max(0, pureSlots - 1))];
    const roleBag = shuffle([
      ...fakePool,
      ...(hasBomber ? ["bomber"] : []),
      "baka",
      ...pureRoles,
      ...Array.from({ length: 8 - fakeCount - (hasBomber ? 1 : 0) - 1 - pureRoles.length }, () => "villager")
    ], rnd);
    return roleBag.map(roleKey => ({
      roleKey,
      fakeDisplayRoleKey: roleKey === "baka"
        ? INNOCENT_ROLE_KEYS[Math.floor(rnd() * INNOCENT_ROLE_KEYS.length)]
        : null,
      clumsy: roleKey === "apprenticeSeer" ? rnd() < CLUMSY_SEER_RATE : false
    }));
  }

  // Pure vote counting (the counting part of tallyVotes): from a Map of
  // player id -> vote count, find the single top scorer. Returns
  // { winnerId, max }; winnerId is null on a tie (an empty map counts as
  // a tie with max -1, same as the old inline loop).
  function resolveVoteTally(votes) {
    let max = -1;
    let topIds = [];
    for (const [id, c] of votes.entries()) {
      if (c > max) {
        max = c;
        topIds = [id];
      } else if (c === max) topIds.push(id);
    }
    return { winnerId: topIds.length === 1 ? topIds[0] : null, max };
  }

  // Pure win check (the decision part of checkWin): from the role keys of
  // the alive players and the bomber's kill count, return the win text or
  // null when the game continues. A surviving Bomber who has taken out
  // 2+ players with bombs hijacks the win at the moment the game would
  // otherwise end.
  function checkWinCondition(aliveRoleKeys, bombKills) {
    const pure = aliveRoleKeys.filter(k => ROLES[k].faction === "イノセント").length;
    const fake = aliveRoleKeys.filter(k => ROLES[k].faction === "インポスター").length;
    const bomberAlive = aliveRoleKeys.includes("bomber");
    if (bomberAlive && pure === 0 && fake === 0) return "💣 ボマーの単独勝利！最後の1人になったよ！";
    if (bomberAlive && (bombKills || 0) >= 2 && (fake === 0 || fake >= pure)) return "💣 ボマーの勝利！爆弾で2人以上を倒し、勝利を横取りした！";
    if (fake === 0) return "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！";
    if (fake >= pure) return "💀 インポスター陣営の勝利…生存者数が同数以上になった。";
    return null;
  }

  function getEffectiveRoleKey(player) {
    if (player.roleKey === "baka") return player.fakeDisplayRoleKey || "villager";
    return player.roleKey;
  }
  // ゲーム中の公開情報で見せる役職。バカは結果画面まで表示役職の
  // まま（脱落時の公開・カード・マウスの公開・盗み見も同じ）で、
  // うっかり個体の占い師も常にただの見習い占い師として見える。
  function getPublicRoleKey(player) {
    return getEffectiveRoleKey(player);
  }

  // 行動ログの1行文面を作る純粋な整形（夜・投票・フェーズ開始で共通）。
  function formatActionLog(type, payload = {}) {
    const withLabel = (label, message) => label ? `[${label}] ${message}` : message;
    const actor = payload.actor || "不明";
    const target = payload.target || "不明";
    switch (type) {
      case "protect":
        return `${actor} → ${target} → 防衛`;
      case "investigate":
        return `${actor} → ${target} → 判定: ${payload.result || "不明"}`;
      case "disturb":
        return `${actor} → ${target} → かく乱`;
      case "track":
        return `${actor} → ${target} → 訪問先${payload.visitTarget ? payload.visitTarget : "なし"}`;
      case "attackEliminated":
        return `インポスター陣営 → ${target} → 脱落`;
      case "attackBlocked":
        return `インポスター陣営 → ${target} → 防衛成功`;
      case "voteGuide":
        return withLabel(payload.label, "投票 → 対象選択 → 実行");
      case "voteEliminated":
        return withLabel(payload.label, `投票 → ${target} → 追放(${payload.votes}票)`);
      case "voteTie":
        return withLabel(payload.label, `投票 → 同数(${payload.votes}票) → 追放なし`);
      case "roleReveal":
        return withLabel(payload.label, `${target} → 役職: ${payload.role} / 陣営: ${payload.faction}`);
      case "phaseNightStart":
        return `${payload.day}日目 → 夜 → 開始`;
      default:
        return payload.message || "";
    }
  }

  // 夜の解決（runNight の解決部分を切り出したもの）。state は試合の状態
  // オブジェクト（players・nightActions・nightActionTypes・loneFakeAbility・
  // bombs・day など）で、その場で更新する。alive は解決開始時の生存者。
  // opts: { meId, difficulty, random }
  // - meId: 自分の id。ソロでは state.playerId、パス＆プレイでは -1（番兵）。
  // - difficulty: CPU の調査の疑念の付き方に使う（"easy" / "normal" / "hard"）。
  // - random: 注入可能な乱数（既定は Math.random）。テストは seed 付きを使う。
  // ログは直接出さず、呼び出し順のまま { logs } として返す。
  // 各エントリは { scope: "public" | "private", actorId?, message } で、
  // public は全員に見える行動ログ、private はその役職者の夜結果だけ。
  // ブラウザ側は public を actionLog へ、private をソロでは actionLog へ、
  // パス＆プレイではその人の pnpNightResults へ振り分ける。
  // 戻り値の logs は、従来の actionLog / pnpNightResults への書き込み順と
  // 同じ順序になる。
  function resolveNightActions(state, alive, opts = {}) {
    const rnd = typeof opts.random === "function" ? opts.random : Math.random;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const meId = opts.meId;
    const difficulty = opts.difficulty || "normal";
    const logs = [];
    const publicLog = (message) => logs.push({ scope: "public", message });
    state.bombReport = { explodedVictims: [], fizzled: false };
    state.lastInvestigation = {};
    state.trapTargets = new Set();
    state.trapReport = null;
    state.doctorTargetId = null;
    state.doctorReport = null;
    // パス＆プレイ：個人の夜結果は公開ログに出さず、その人の
    // pnpNightResults にだけ貯める（次の夜の番で本人だけに表示する）。
    // ソロでは従来通り `me` の結果だけを公開ログに出す。
    const logFor = (actor, msg) => {
      if (actor.id === meId) logs.push({ scope: "private", actorId: actor.id, message: msg });
      else if (state.mode === "pnp" && state.humanPlayerIds.includes(actor.id)) {
        logs.push({ scope: "private", actorId: actor.id, message: msg });
      }
    };
    const actionTypeOf = (actor) => state.nightActionTypes?.[actor.id] || ROLES[getEffectiveRoleKey(actor)].nightAction?.type;
    const priorityOf = (actor) => {
      const t = actionTypeOf(actor);
      if (t === "block") return 5;
      if (t === "spy") return 15;
      return ROLES[getEffectiveRoleKey(actor)].nightAction?.priority ?? 40;
    };
    const actionOrder = Object.entries(state.nightActions)
      .map(([actorId, targetId]) => ({ actor: state.players[Number(actorId)], target: state.players[targetId] }))
      .filter(x => x.actor && x.target && x.actor.alive && x.target.alive)
      .sort((a, b) => priorityOf(a.actor) - priorityOf(b.actor));

    const blockedIds = new Set();
    // A lone fake girl's extra block applies at block priority, before
    // any other step resolves.
    if (state.loneFakeAbility?.type === "block") blockedIds.add(state.loneFakeAbility.targetId);
    let attackTargetId = null;
    let attackActorId = null;
    for (const step of actionOrder) {
      const actor = step.actor;
      const target = step.target;
      const effectiveRoleKey = getEffectiveRoleKey(actor);
      const actionType = actionTypeOf(actor);
      if (blockedIds.has(actor.id) && actionType !== "attack") {
        logFor(actor, "誰かに妨害されて、今夜は行動できなかった！");
        if (actor.id === meId) state.humanBlocked = true;
        continue;
      }
      if (actionType === "block") {
        // A baka displaying the police role blocks nobody (Insane rule).
        if (actor.roleKey !== "baka") blockedIds.add(target.id);
      } else if (actionType === "plant") {
        state.bombs.push({ targetId: target.id, explodeDay: state.day + 1 });
        logFor(actor, `爆弾設置 → ${target.name} に爆弾を仕掛けた…明日の夜に爆発する。`);
      } else if (actionType === "lookout") {
        let visitors;
        if (actor.roleKey === "baka") {
          // A baka lookout's report is fabricated, like its tracking.
          const others = alive.filter(x => x.id !== target.id && x.id !== actor.id);
          visitors = rnd() < 0.5 || !others.length ? [] : [pick(others)];
        } else {
          visitors = Object.entries(state.nightActions)
            .filter(([a, t]) => Number(a) !== actor.id && t === target.id)
            .map(([a]) => state.players[Number(a)])
            .filter(v => v && v.alive);
        }
        actor.lastTarget = visitors.length ? visitors[0].id : null;
        logFor(actor, `見張り → ${target.name} を訪れた人：${visitors.length ? visitors.map(v => v.name).join("、") : "なし"}`);
      } else if (actionType === "spy") {
        // バカの盗み見結果も表示役職（結果画面まで実役職は出さない）。
        state.fakeIntel[target.id] = getPublicRoleKey(target);
        logFor(actor, `盗み見 → ${target.name} の正体は「${ROLES[getPublicRoleKey(target)].name}」だった。`);
      } else if (actionType === "protect") {
        if (actor.roleKey !== "baka") state.protectedTargets.add(target.id);
        logFor(actor, formatActionLog("protect", { actor: ROLES[effectiveRoleKey].name, target: target.name }));
      } else if (actionType === "investigate") {
        let result = ROLES[target.roleKey].faction;
        if (actor.roleKey === "baka") {
          // Feign's Insane: a baka's investigation result is entirely fake.
          result = rnd() < 0.5 ? "イノセント" : "インポスター";
        } else {
          if (target.roleKey === "mimic" && rnd() < 0.65) result = "イノセント";
          // うっかり個体の占い師は本人も知らないまま 45% で判定がズレる。
          if (actor.clumsy && rnd() < 0.45) result = rnd() < 0.5 ? "イノセント" : "インポスター";
        }
        state.lastInvestigation[actor.id] = { targetId: target.id, result };
        logFor(actor, formatActionLog("investigate", { actor: ROLES[effectiveRoleKey].name, target: target.name, result }));
        // 人間の調査結果は本人の判断材料で、CPU の疑念には反映しない
        // （ソロで人間の調査が疑念を上げないのと同じ）。
        const isPrivateInvestigator = state.mode === "pnp" && state.humanPlayerIds.includes(actor.id);
        if (actor.id !== meId && !isPrivateInvestigator && result === "インポスター") {
          // Difficulty: CPU investigators build suspicion faster on hard,
          // and sometimes fail to follow up on easy.
          if (difficulty === "hard") target.suspicion += 1.5;
          else if (difficulty === "easy") { if (rnd() < 0.55) target.suspicion += 1; }
          else target.suspicion += 1;
        }
        if (actor.id !== meId && !isPrivateInvestigator && result === "ニュートラル") target.suspicion += 0.5;
      } else if (actionType === "track") {
        let visitTarget;
        if (actor.roleKey === "baka") {
          // A baka's tracking report is fabricated: half the time there was
          // "no visit", otherwise it names a random other player.
          const others = alive.filter(x => x.id !== target.id && x.id !== actor.id);
          visitTarget = rnd() < 0.5 || !others.length ? null : pick(others);
        } else {
          const visitId = state.nightActions[target.id];
          visitTarget = visitId !== undefined ? state.players[visitId] : null;
        }
        if (visitTarget) target.lastTarget = visitTarget.id;
        logFor(actor, formatActionLog("track", { actor: ROLES[effectiveRoleKey].name, target: target.name, visitTarget: visitTarget?.name }));
      } else if (actionType === "trap") {
        // A baka displaying the trapper sets a trap that never springs.
        if (actor.roleKey !== "baka") state.trapTargets.add(target.id);
        logFor(actor, `罠設置 → ${target.name} の家に罠を仕掛けた。`);
      } else if (actionType === "revive") {
        // The doctor registers a patient; the revive itself is applied
        // after all of tonight's deaths are known.
        if (actor.roleKey !== "baka") state.doctorTargetId = target.id;
        logFor(actor, `診察 → ${target.name} を診察した。今夜倒れたら蘇生する。`);
      } else if (actionType === "attack") {
        attackTargetId = target.id;
        attackActorId = actor.id;
      }
    }

    const targetId = attackTargetId;
    if (targetId !== null && targetId !== undefined) {
      const victim = state.players[targetId];
      if (victim && victim.alive && !state.protectedTargets.has(victim.id)) {
        victim.alive = false;
        victim.deathCause = "襲撃";
        victim.deathDay = state.day;
        state.nightReport = { type: "eliminated", victimId: victim.id };
        publicLog(formatActionLog("attackEliminated", { target: victim.name }));
        publicLog(formatActionLog("roleReveal", { label: "夜", target: victim.name, role: ROLES[getPublicRoleKey(victim)].name, faction: ROLES[getPublicRoleKey(victim)].faction }));
        // Trapper: a trap on the victim's house takes the attacker down too.
        if (state.trapTargets.has(victim.id) && attackActorId != null) {
          const attacker = state.players[attackActorId];
          if (attacker && attacker.alive) {
            attacker.alive = false;
            attacker.deathCause = "罠";
            attacker.deathDay = state.day;
            state.trapReport = { attackerId: attacker.id, victimId: victim.id };
            publicLog(`🪤 ${victim.name} の家の罠が作動！襲撃者も道連れになった！`);
            publicLog(formatActionLog("roleReveal", { label: "夜", target: attacker.name, role: ROLES[getPublicRoleKey(attacker)].name, faction: ROLES[getPublicRoleKey(attacker)].faction }));
          }
        }
      } else {
        if (victim && victim.alive && state.protectedTargets.has(victim.id)) state.guardSaves = (state.guardSaves || 0) + 1;
        state.nightReport = { type: "blocked", victimId: null };
        publicLog(formatActionLog("attackBlocked", { target: victim?.name || "不明" }));
      }
    } else {
      state.nightReport = { type: "none", victimId: null };
    }

    // A lone mimic's extra spy applies here (the intel feeds tomorrow's
    // targeting), unless the mimic was blocked tonight.
    if (state.loneFakeAbility?.type === "spy" && !blockedIds.has(state.loneFakeAbility.actorId)) {
      const spyActor = state.players[state.loneFakeAbility.actorId];
      const spyTarget = state.players[state.loneFakeAbility.targetId];
      if (spyActor && spyTarget) {
        state.fakeIntel[spyTarget.id] = getPublicRoleKey(spyTarget);
        logFor(spyActor, `盗み見 → ${spyTarget.name} の正体は「${ROLES[getPublicRoleKey(spyTarget)].name}」だった。`);
      }
    }

    // Bombs planted last night explode now, unless tonight's guardian
    // is protecting the victim.
    const exploding = state.bombs.filter(b => b.explodeDay === state.day);
    if (exploding.length) {
      state.bombs = state.bombs.filter(b => b.explodeDay > state.day);
      for (const bomb of exploding) {
        const victim = state.players[bomb.targetId];
        if (!victim || !victim.alive) continue;
        if (state.protectedTargets.has(victim.id)) {
          publicLog(`💣 ${victim.name} に仕掛けられた爆弾は、護衛のおかげで不発に終わった！`);
          state.bombReport.fizzled = true;
          continue;
        }
        victim.alive = false;
        victim.deathCause = "爆発";
        victim.deathDay = state.day;
        state.bombReport.explodedVictims.push(victim.id);
        state.bombKills = (state.bombKills || 0) + 1;
        publicLog(`💣💥 ${victim.name} が爆発に巻き込まれて倒れた…`);
        publicLog(formatActionLog("roleReveal", { label: "夜", target: victim.name, role: ROLES[getPublicRoleKey(victim)].name, faction: ROLES[getPublicRoleKey(victim)].faction }));
      }
    }

    // Doctor: revive tonight's casualty if they were the doctor's patient.
    if (state.doctorTargetId != null) {
      const patient = state.players[state.doctorTargetId];
      if (patient && !patient.alive) {
        if (state.nightReport?.type === "eliminated" && state.nightReport.victimId === patient.id) {
          patient.alive = true;
          state.nightReport = { type: "revived", victimId: patient.id };
          state.doctorReport = { victimId: patient.id, cause: "attack" };
        } else if (state.bombReport.explodedVictims.includes(patient.id)) {
          patient.alive = true;
          state.bombReport.explodedVictims = state.bombReport.explodedVictims.filter(id => id !== patient.id);
          state.bombKills = Math.max(0, (state.bombKills || 0) - 1);
          state.doctorReport = { victimId: patient.id, cause: "bomb" };
        }
        if (state.doctorReport) {
          patient.deathCause = null;
          patient.deathDay = null;
          state.revives = (state.revives || 0) + 1;
          publicLog(`💉 しかし間一髪、${patient.name} はドクターの蘇生で助かった！`);
        }
      }
    }

    cpuNightActions(state, alive, meId);
    return { logs };
  }

  // 追跡係の夜結果を CPU の疑念へ反映する（resolveNightActions の末尾）。
  // 人間の追跡結果は本人の判断材料で、CPU の疑念には反映しない
  // （ソロと同じ。パス＆プレイでも人間は対象外）。
  function cpuNightActions(state, alive, meId) {
    for (const p of alive) {
      if (state.mode === "pnp" ? state.humanPlayerIds.includes(p.id) : p.id === meId) continue;
      if (p.roleKey === "tracker" && p.lastTarget !== null) {
        const t = state.players[p.lastTarget];
        if (t) t.suspicion += 0.6;
      }
    }
  }

  // CPU の投票先：疑念が高い相手を選び、難易度でブレ幅を変える。
  // difficulty: "easy" はブレ大、"hard" はブレ小（既定 "normal"）。
  // random は注入可能な乱数（既定は Math.random）。
  function cpuVotePick(voter, alive, difficulty, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const voteJitter = difficulty === "easy" ? 3.2 : difficulty === "hard" ? 0.1 : 1;
    const candidates = alive.filter(x => x.id !== voter.id);
    candidates.sort((a, b) => (b.suspicion + rnd() * voteJitter) - (a.suspicion + rnd() * voteJitter));
    return candidates[0];
  }

  // 夜の対象選択（runNight の対象決め部分を切り出したもの）。state は
  // 試合の状態オブジェクト（players・mode・playerId・selectedId・
  // pnpNightInputs・humanPlayerIds・fakeIntel・bombs）で、alive は
  // 夜開始時の生存者。opts: { difficulty, random }
  // - difficulty: CPU の対象選択のヒューリスティクスに使う
  //   （"easy" / "normal" / "hard"）。
  // - random: 注入可能な乱数（既定は Math.random）。テストは seed 付きを使う。
  // 戻り値は { nightActions, nightActionTypes, protectedTargets, loneFakeAbility }。
  // nightActions は { actorId: targetId }、nightActionTypes は
  // { actorId: "block" | "plant" | "spy" }（ポリス・ボマー・なりすましの
  // 能力種別だけ。resolveNightActions が優先度で使う）。
  // protectedTargets は守り手が守った先（バカの護衛は入らない）。
  // loneFakeAbility は単独インポスターの追加能力
  // （{ actorId, type: "spy" | "block", targetId }）。
  // 人間の入力（ソロでは自分の選択対象、パス＆プレイでは
  // pnpNightInputs）はそのまま使い、未入力なら CPU 扱いになる。
  // 呼び出し側は戻り値を state.nightActions / state.nightActionTypes /
  // state.protectedTargets / state.loneFakeAbility へ代入する。
  // alive 全員の lastTarget を null にリセットするのもここで行う
  // （追跡・見張りの前夜の結果を消すため）。
  function planNightActions(state, alive, opts = {}) {
    const rnd = typeof opts.random === "function" ? opts.random : Math.random;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const difficulty = opts.difficulty || "normal";
    const meId = state.mode === "pnp" ? -1 : state.playerId;
    const me = state.players[meId] || { id: -1 };
    const target = state.players[state.selectedId];
    const nightActions = {};
    const nightActionTypes = {};
    const protectedTargets = new Set();
    let loneFakeAbility = null;
    for (const p of alive) p.lastTarget = null;
    const registerAction = (actorId, targetId, type = null) => {
      if (targetId === null || targetId === undefined) return;
      nightActions[actorId] = targetId;
      if (type) nightActionTypes[actorId] = type;
    };
    // 人間が入力した対象（未入力なら undefined → CPU 扱い）。
    // ソロでは従来通り `me` の選択対象を使う。
    const inputTargetOf = (p) => state.mode === "pnp" ? state.pnpNightInputs?.[p.id] : undefined;
    const targetOr = (p, cpuTarget) => {
      const t = inputTargetOf(p);
      return t !== undefined ? t : cpuTarget;
    };

    for (const p of alive) {
      const effectiveRoleKey = getEffectiveRoleKey(p);
      if (!ROLES[effectiveRoleKey].nightAction) continue;
      if (effectiveRoleKey === "guardian") {
        const guardTarget = targetOr(p, p.id === me.id ? target?.id
          : difficulty === "hard"
            ? alive.filter(x => x.id !== p.id).sort((a, b) => a.suspicion - b.suspicion)[0]?.id
            : pick(alive.filter(x => x.id !== p.id))?.id);
        if (guardTarget !== undefined) {
          registerAction(p.id, guardTarget);
          if (p.roleKey !== "baka") protectedTargets.add(guardTarget);
        }
      } else if (effectiveRoleKey === "apprenticeSeer") {
        const inspectTarget = targetOr(p, p.id === me.id ? target?.id
          : difficulty === "hard"
            ? alive.filter(x => x.id !== p.id).sort((a, b) => b.suspicion - a.suspicion)[0]?.id
            : pick(alive.filter(x => x.id !== p.id))?.id);
        registerAction(p.id, inspectTarget);
      } else if (effectiveRoleKey === "tracker") {
        const trackTarget = targetOr(p, p.id === me.id ? target?.id : pick(alive.filter(x => x.id !== p.id))?.id);
        registerAction(p.id, trackTarget);
      } else if (effectiveRoleKey === "police") {
        let policeTarget = inputTargetOf(p);
        if (policeTarget === undefined) {
          if (p.id === me.id) {
            policeTarget = target?.id;
          } else {
            const actors = alive.filter(x => x.id !== p.id && ROLES[getEffectiveRoleKey(x)].nightAction);
            policeTarget = pick(actors.length ? actors : alive.filter(x => x.id !== p.id))?.id;
          }
        }
        registerAction(p.id, policeTarget, "block");
      } else if (effectiveRoleKey === "trapper") {
        const trapTarget = targetOr(p, p.id === me.id ? target?.id : pick(alive)?.id);
        if (trapTarget !== undefined) registerAction(p.id, trapTarget);
      } else if (effectiveRoleKey === "doctor") {
        const docTarget = targetOr(p, p.id === me.id ? target?.id : pick(alive)?.id);
        if (docTarget !== undefined) registerAction(p.id, docTarget);
      } else if (effectiveRoleKey === "lookout") {
        const lookoutTarget = targetOr(p, p.id === me.id ? target?.id : pick(alive.filter(x => x.id !== p.id))?.id);
        registerAction(p.id, lookoutTarget);
      } else if (effectiveRoleKey === "bomber") {
        let plantTarget = inputTargetOf(p);
        if (plantTarget === undefined) {
          if (p.id === me.id) {
            plantTarget = target?.id;
          } else {
            const unbombed = alive.filter(x => x.id !== p.id && !state.bombs.some(b => b.targetId === x.id));
            plantTarget = pick(unbombed.length ? unbombed : alive.filter(x => x.id !== p.id))?.id;
          }
        }
        registerAction(p.id, plantTarget, "plant");
      }
    }

    const fakeSide = alive.filter(x => ["fakeGirl", "mimic"].includes(x.roleKey));
    if (fakeSide.length) {
      const victims = alive.filter(x => !fakeSide.includes(x));
      // Block targeting shared by the partner ability and the lone-fake
      // bonus action: on hard, a known seer is blocked first.
      const pickBlockTarget = () => {
        const actors = victims.filter(x => ROLES[getEffectiveRoleKey(x)].nightAction);
        if (difficulty === "hard") {
          const knownSeer = actors.filter(x => state.fakeIntel?.[x.id] === "apprenticeSeer");
          if (knownSeer.length) return pick(knownSeer)?.id;
        }
        return pick(actors.length ? actors : victims)?.id;
      };
      let fakeActor;
      let attackTarget;
      // パス＆プレイのインポスター人間の代表者（いなければ null）。
      const humanFakeRep = (() => {
        if (state.mode !== "pnp") return null;
        for (const id of state.humanPlayerIds) {
          const p = state.players[id];
          if (p?.alive && ["fakeGirl", "mimic"].includes(p.roleKey)) return p;
        }
        return null;
      })();
      if (humanFakeRep) {
        // パス＆プレイ：インポスター人間の代表者が入力した襲撃先を使う。
        // 仲間のインポスターを選んでいたらランダムな被害者に振り替える（ソロと同じ）。
        fakeActor = humanFakeRep;
        const input = state.pnpNightInputs?.[humanFakeRep.id];
        attackTarget = input !== undefined && victims.some(x => x.id === input)
          ? input
          : pick(victims)?.id;
      } else if (fakeSide.includes(me)) {
        // The human player leads the faction attack: use their selected target
        // (fall back to a random victim if they picked a fellow fake member).
        fakeActor = me;
        attackTarget = victims.some(x => x.id === target?.id)
          ? target.id
          : pick(victims)?.id;
      } else {
        fakeActor = pick(fakeSide);
        const fallbackVictims = alive.filter(x => x.id !== fakeActor.id);
        // The faction prefers victims the mimic has identified as power roles.
        const intelTargets = difficulty === "easy" ? [] : victims.filter(x => ["apprenticeSeer", "guardian", "tracker", "police", "lookout", "doctor", "trapper"].includes(state.fakeIntel?.[x.id]));
        const pool = intelTargets.length ? intelTargets : victims;
        attackTarget = pick(pool.length ? pool : fallbackVictims)?.id;
      }
      registerAction(fakeActor.id, attackTarget);

      // Feign-style: fake members who are not leading tonight's attack use
      // their role ability instead. The mimic spies on a player's real role
      // (feeding the faction's target choice), the fake girl blocks a
      // pure-side night action. In pass-and-play, a human non-representative
      // fake enters the ability target on their night turn (phase 3);
      // an invalid target (e.g. a fellow fake) falls back to the CPU choice.
      for (const f of fakeSide) {
        if (f.id === fakeActor.id || f.id === me.id) continue;
        const abilityInput = inputTargetOf(f);
        const abilityTargetIsVictim = abilityInput !== undefined && victims.some(x => x.id === abilityInput);
        if (f.roleKey === "mimic") {
          registerAction(f.id, abilityTargetIsVictim ? abilityInput : pick(victims)?.id, "spy");
        } else if (f.roleKey === "fakeGirl") {
          registerAction(f.id, abilityTargetIsVictim ? abilityInput : pickBlockTarget(), "block");
        }
      }

      // Balance: a lone fake member is heavily outnumbered, so alongside
      // the faction attack they also use their role ability, auto-targeted
      // with the same heuristics a CPU partner would use. The ability is
      // applied during resolution via state.loneFakeAbility.
      if (fakeSide.length === 1) {
        const lone = fakeSide[0];
        if (lone.roleKey === "mimic") {
          const spyPool = victims.filter(x => x.id !== attackTarget);
          const spyTarget = pick(spyPool.length ? spyPool : victims)?.id;
          if (spyTarget !== undefined) loneFakeAbility = { actorId: lone.id, type: "spy", targetId: spyTarget };
        } else if (lone.roleKey === "fakeGirl") {
          const blockTarget = pickBlockTarget();
          if (blockTarget !== undefined) loneFakeAbility = { actorId: lone.id, type: "block", targetId: blockTarget };
        }
      }
    }

    return { nightActions, nightActionTypes, protectedTargets, loneFakeAbility };
  }

  // 結果画面のハイライト生成：名場面を最大2行でまとめる。
  // players は { roleKey, name, deathCause } を持つ配列、counters は
  // { bombKills, revives, guardSaves, day }。DOM を使わない純粋関数で、
  // 蘇生・護衛の回数は state にしか残らないため counters 経由で渡す。
  function buildHighlights(players, counters) {
    const lines = [];
    const bomber = players.find(p => p.roleKey === "bomber");
    const bombKills = counters.bombKills || 0;
    const trapKills = players.filter(p => p.deathCause === "罠").length;
    if (bomber && bombKills >= 2) lines.push(`💣 ${bomber.name}の爆弾で${bombKills}人が倒れた！`);
    if (trapKills > 0) lines.push(`🪤 罠が${trapKills}回作動し、襲撃者を道連れにした`);
    if ((counters.revives || 0) > 0) lines.push(`💉 ドクターの蘇生で${counters.revives}人が助かった`);
    if ((counters.guardSaves || 0) > 0) lines.push(`🛡️ 護衛が${counters.guardSaves}回、襲撃を防いだ`);
    if (bomber && bombKills === 1) lines.push(`💣 ${bomber.name}の爆弾で1人が倒れた`);
    if (lines.length === 0) lines.push(`📅 ${counters.day}日目で決着`);
    return lines.slice(0, 2);
  }

  // 廃止済み役職の旧戦績データを表示するための名前（現行の ROLES にはない）。
  const LEGACY_ROLE_NAMES = { clumsySeer: "うっかり占い師" };
  // 2026-11-12 の陣営改名（ピュア→イノセント、フェイク→インポスター）より前に
  // 保存された戦績の陣営キーを、新しい陣営名へ読み替える（後方互換）。
  const LEGACY_FACTION_NAMES = { "ピュア": "イノセント", "フェイク": "インポスター" };
  function migrateFactionWins(factionWins) {
    const out = {};
    for (const [key, value] of Object.entries(factionWins || {})) {
      const name = LEGACY_FACTION_NAMES[key] || key;
      out[name] = (out[name] || 0) + value;
    }
    return out;
  }

  // ---- 戦績記録（ソロ／パス＆プレイ）の純粋コア ----
  // ブラウザ側の loadStats / loadPnpStats が読み込んだ戦績を受け取り、
  // 1試合分を加算した新しい戦績を返す。入力の stats は変更しない。
  // 保存・描画・二重記録防止（state.statsRecorded）はブラウザ側に残る。
  // input: { myWin, roleKey, faction, winText }。winText は「横取り」
  // （ボマーの勝利の横取り）の判定にだけ使う。
  function applySoloStats(stats, input) {
    const base = stats || {};
    const out = {
      games: (base.games || 0) + 1,
      wins: base.wins || 0,
      byRole: { ...(base.byRole || {}) },
      factionWins: { ...(base.factionWins || {}) },
      steals: base.steals || 0,
      streak: base.streak || 0,
      bestStreak: base.bestStreak || 0,
    };
    if (input.myWin) {
      out.wins += 1;
      out.factionWins[input.faction] = (out.factionWins[input.faction] || 0) + 1;
      if (input.winText && input.winText.includes("横取り")) out.steals += 1;
      out.streak += 1;
      out.bestStreak = Math.max(out.bestStreak, out.streak);
    } else {
      out.streak = 0;
    }
    const entry = { ...(out.byRole[input.roleKey] || { games: 0, wins: 0 }) };
    entry.games += 1;
    if (input.myWin) entry.wins += 1;
    out.byRole[input.roleKey] = entry;
    return out;
  }
  // input: { winnerFaction, humanRoles: [{ roleKey, faction }] }。
  // 勝った陣営と、各人間の役職ごとの戦績を加算する。
  function applyPnpStats(stats, input) {
    const base = stats || {};
    const out = {
      games: (base.games || 0) + 1,
      factionWins: { ...(base.factionWins || {}) },
      byRole: { ...(base.byRole || {}) },
    };
    if (input.winnerFaction) {
      out.factionWins[input.winnerFaction] = (out.factionWins[input.winnerFaction] || 0) + 1;
    }
    for (const h of input.humanRoles || []) {
      if (!h) continue;
      const entry = { ...(out.byRole[h.roleKey] || { games: 0, wins: 0 }) };
      entry.games += 1;
      if (h.faction === input.winnerFaction) entry.wins += 1;
      out.byRole[h.roleKey] = entry;
    }
    return out;
  }
  // ---- 戦績の表示生成（ソロ／パス＆プレイ共通） ----
  // renderStats / renderPnpStats のうち DOM を使わない純粋な部分：
  // サマリー文言と役職チップの HTML。要素への代入と実績の描画は
  // ブラウザ側に残る。input は { kind: "solo" | "pnp" }。
  function buildStatsView(stats, input) {
    const base = stats || {};
    const chips = Object.entries(base.byRole || {})
      .sort((a, b) => b[1].games - a[1].games)
      // 廃止済み役職の旧記録（clumsySeer）は当時の名前で表示する。
      // それ以外は現行の役職表から引く。どれにも無ければキーそのまま。
      .map(([key, v]) => `<span class="stats-chip">${ROLES[key]?.name || LEGACY_ROLE_NAMES[key] || key}：${v.games}戦${v.wins}勝</span>`)
      .join("");
    if (!base.games) {
      return {
        summary: input.kind === "pnp" ? "まだパス＆プレイの記録がありません" : "まだ対戦記録がありません",
        chips: "",
      };
    }
    if (input.kind === "pnp") {
      const w = base.factionWins || {};
      return {
        summary: `通算 ${base.games}戦（イノセント勝利 ${w["イノセント"] || 0}・インポスター勝利 ${w["インポスター"] || 0}・ボマー勝利 ${w["ニュートラル"] || 0}）`,
        chips,
      };
    }
    const rate = Math.round(((base.wins || 0) / base.games) * 100);
    return {
      summary: `通算 ${base.games}戦 ${base.wins || 0}勝 ${base.games - (base.wins || 0)}敗（勝率 ${rate}%）`,
      chips,
    };
  }
  // ---- 結果画面の表示データ生成 ----
  // showResults のうち DOM を使わない純粋な部分：勝敗陣営の導出・
  // 自分の勝敗・サブ文言・各プレイヤーの行データ（役職名・陣営チップ・
  // 生死・バカの表示注記・うっかり個体の注記）。行の HTML 化と顔画像の
  // 差し込み、state への代入、戦績記録はブラウザ側に残る。
  // input: { winText, mode, playerId, humanCount }。
  // mode が "pnp" のとき myWin は null（勝敗は陣営単位で見るため）。
  function buildResultSummary(players, input) {
    const winnerFaction = input.winText.includes("イノセント陣営の勝利") ? "イノセント"
      : input.winText.includes("インポスター陣営の勝利") ? "インポスター" : "ニュートラル";
    const me = players.find((p) => p.id === input.playerId);
    const myWin = input.mode === "pnp" ? null
      : (me ? ROLES[me.roleKey].faction === winnerFaction : false);
    const sub = input.mode === "pnp"
      ? `パス＆プレイ（人間${input.humanCount}人）で遊びました。`
      : me ? `あなたは「${ROLES[me.roleKey].name}」（${ROLES[me.roleKey].faction}）で ${myWin ? "勝利！" : "敗北…"}${me.clumsy ? "（実はうっかり個体でした）" : ""}`
      : "";
    const rows = players.map((p) => {
      const role = ROLES[p.roleKey];
      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        alive: !!p.alive,
        roleKey: p.roleKey,
        roleName: role.name,
        roleIcon: role.icon,
        faction: role.faction,
        chipClass: role.faction === "イノセント" ? "pure" : role.faction === "インポスター" ? "fake" : "neutral",
        displayNote: p.roleKey === "baka" && p.fakeDisplayRoleKey ? `（表示：${ROLES[p.fakeDisplayRoleKey].name}）` : "",
        clumsyNote: p.clumsy ? "（実はうっかり個体でした）" : "",
        status: p.alive ? "生存" : `${p.deathDay ?? "?"}日目に脱落${p.deathCause ? `（${p.deathCause}）` : ""}`,
        isWinner: role.faction === winnerFaction,
        isMe: input.mode !== "pnp" && p.id === input.playerId,
      };
    });
    return { winnerFaction, myWin, sub, rows };
  }
  // ---- 結果画面の行 HTML の生成 ----
  // 結果画面の1行分の HTML。行データは buildResultSummary が作るもの。
  // 顔画像は iconImgs（ICON_IMGS、slug キー）から差し込む。
  // 勝敗モーション（キャラモーション第1弾）：勝った陣営はジャンプ、
  // 負けた陣営はしょんぼり。
  function buildResultRowHtml(row, iconImgs) {
    const img = iconImgs ? iconImgs[ICON_SLUGS[row.id]] : undefined;
    return `<div class="result-row ${row.alive ? "" : "dead"} ${row.isWinner ? "winner" : "loser"}">
        <div class="avatar"><span>${row.icon}</span>${img ? `<img class="avatar-img" src="${img}" alt="${row.name}">` : ""}</div>
        <div><div class="result-name">${row.name}${row.isMe ? "（あなた）" : ""}<span class="faction-chip ${row.chipClass}">${row.faction}</span></div>
        <div class="result-role">${roleIconButtonHtml(row.roleKey)} ${row.roleName}${row.displayNote}${row.clumsyNote}</div></div>
        <div class="result-status">${row.status}</div>
      </div>`;
  }

  // 結果画面の全行の HTML。rows が空・null のときは空文字。
  function buildResultRowsView(rows, iconImgs) {
    if (!rows || !rows.length) return "";
    return rows.map((r) => buildResultRowHtml(r, iconImgs)).join("");
  }
  // ---- フェーズヒントの生成 ----
  // 役職カードとパス＆プレイの手番バナーに出す、そのフェーズでの行動の指針。
  // 夜は自分の表示役職（バカは表示役職）の nightActionHint、それ以外は
  // フェーズごとの固定文言。ヒントの決定に state は使わない。
  function getPhaseHint(phase, me) {
    if (phase === "night") {
      return ROLES[getEffectiveRoleKey(me)].nightActionHint;
    }
    if (phase === "morning") return "朝の報告を整理して、発言方針を決めよう。";
    if (phase === "vote") return "ログと投票履歴から、いちばん矛盾が大きい相手に投票しよ。";
    if (phase === "discussion") return "朝の報告と発言のズレを比較して、投票候補を絞ろう。";
    return "勝敗ログを見て、次ゲームの立ち回りメモを作ろう。";
  }
  // ---- 仲間表示と役職表示の生成 ----
  // インポスター仲間の名前列と、役職画面・受け渡し画面に出す1人分の
  // 役職表示 HTML。表示の決定に state は使わず、players・mode・
  // humanPlayerIds を引数で受け取る純粋関数。
  function getFakeAlliesText(players, player, opts) {
    if (!player || ROLES[player.roleKey].faction !== "インポスター") return "";
    const allies = (players || []).filter((p) => p.id !== player.id && ROLES[p.roleKey].faction === "インポスター");
    if (!allies.length) return "なし";
    // パス＆プレイでは仲間確認のため P 番号も付ける（誰と相談すればよいか分かるように）。
    if (opts && opts.mode === "pnp") {
      return allies.map((p) => {
        const idx = (opts.humanPlayerIds || []).indexOf(p.id);
        return idx >= 0 ? `P${idx + 1}（${p.name}）` : p.name;
      }).join("、");
    }
    return allies.map((p) => p.name).join("、");
  }

  function getAlliesLineForRole(players, player, opts) {
    if (!player || ROLES[player.roleKey].faction !== "インポスター") return "";
    return `インポスター仲間：${getFakeAlliesText(players, player, opts)}`;
  }

  // 役職アイコンのボタンの HTML。クリックするとブラウザ側が
  // data-role-info を拾って簡単な説明（shortDesc）をポップオーバーで出す。
  // 陣営カラーの枠（Feign のダッシュボード風）を付けるため faction
  // クラスも返す。未知のキーは空文字。
  function roleIconButtonHtml(roleKey, opts) {
    const r = ROLES[roleKey];
    if (!r) return "";
    const factionClass = r.faction === "イノセント" ? "faction-innocent"
      : r.faction === "インポスター" ? "faction-impostor" : "faction-neutral";
    // カード上では役職名テキストを出さない（アイコン1つのデザイン）ため、
    // 呼び出し側が aria-label を差し替えられるようにする。
    const ariaLabel = (opts && opts.ariaLabel) || `${r.name}の簡単な説明を見る`;
    return `<button type="button" class="role-icon-btn ${factionClass}" data-role-info="${roleKey}" aria-label="${ariaLabel}">${r.icon}</button>`;
  }

  // 役職説明ポップオーバーの表示データ。showRoleInfo が画面に反映する
  // 内容（アイコン・名前・陣営とチップのクラス・短い説明）を返す純粋関数。
  // 未知のキー・null は null。DOM への代入とフォーカス移動はブラウザ側。
  // 秘匿は呼び出し側が渡すキーで決まる（バカのカードは表示役職キー経由）
  // ため、ここでは渡されたキーの役職しか絶対に出さない。
  function buildRoleInfoView(roleKey) {
    const r = ROLES[roleKey];
    if (!r) return null;
    return {
      icon: r.icon,
      name: r.name,
      faction: r.faction,
      factionChipClass: `faction-chip ${r.faction === "イノセント" ? "pure" : r.faction === "インポスター" ? "fake" : "neutral"}`,
      desc: r.shortDesc || r.desc,
    };
  }

  // 役職ボード（ゲーム画面の役職一覧）の並び順。静的な HTML にあった
  // 14役職の順番そのまま。
  const ROLE_GUIDE_ORDER = ["apprenticeSeer", "guardian", "tracker", "police", "lookout", "trapper", "doctor", "mouse", "politician", "villager", "fakeGirl", "mimic", "bomber", "baka"];

  // 役職ボードの1タイル分の表示データ。アイコン・名前・陣営・陣営クラス・
  // ボード用の説明文と、タイル1個分の HTML を返す純粋関数。ボード用の
  // 説明文は ROLES の guideDesc（静的な HTML にあった文言そのまま）。
  // 並び順は ROLE_GUIDE_ORDER。タイルの HTML は旧版の静的なものと同一。
  function buildRoleGuideView() {
    return ROLE_GUIDE_ORDER.map(roleKey => {
      const r = ROLES[roleKey];
      const factionClass = r.faction === "イノセント" ? "faction-innocent"
        : r.faction === "インポスター" ? "faction-impostor" : "faction-neutral";
      const iconButtonHtml = roleIconButtonHtml(roleKey);
      return {
        roleKey,
        icon: r.icon,
        name: r.name,
        faction: r.faction,
        factionClass,
        desc: r.guideDesc,
        iconButtonHtml,
        tileHtml: `<li class="role-tile ${factionClass}">${iconButtonHtml}<div><strong>${r.name}</strong><span class="role-faction">${r.faction}</span>${r.guideDesc}</div></li>`,
      };
    });
  }

  // タイトル画面のパレード（8人の歩行者）の歩行周期。静的な HTML に
  // あった --bd の値そのまま（id 順）。ステージの歩行者とは周期の
  // 決め方が別（こちらは 8 人ぶんの値がそのまま並んでいる）。
  const PARADE_BD = ["0.34s", "0.38s", "0.31s", "0.36s", "0.33s", "0.39s", "0.32s", "0.37s"];

  // タイトル画面のパレードに並ぶ歩行者8人分の表示データ。id 順に
  // slug・名前・歩行周期と、歩行者 span 全体の HTML を返す純粋関数。
  // 各歩行者の HTML は旧版の静的なものと同一。frame-a の alt だけ
  // キャラ名で、frame-b は空。歩行スプライトの読み込みはブラウザ側
  // （hydrateWalkImages）が生成後の img を対象にする。
  function buildParadeView() {
    return ICON_SLUGS.map((slug, id) => {
      const duration = PARADE_BD[id];
      return {
        id,
        slug,
        name: PLAYER_NAMES[id],
        duration,
        html: `<span class="walker" style="--i:${id};--bd:${duration}"><span class="wshadow"></span><span class="wbody"><img class="frame-a" data-slug="${slug}" data-frame="a" alt="${PLAYER_NAMES[id]}"><img class="frame-b" data-slug="${slug}" data-frame="b" alt=""></span></span>`,
      };
    });
  }

  // 議論タイマーの警告しきい値。残りこの秒数以下で警告色になる。
  const DISCUSS_TIMER_LOW_SECONDS = 30;

  // 議論タイマーの残り秒数を「分:秒」表示にする。60 → "1:00"、90 → "1:30"。
  function formatDiscussTime(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  // 議論タイマーの表示データ。パス＆プレイの議論中で、タイマー設定が
  // あるときだけ表示する。残り30秒以下は警告色、時間切れは投票ボタンも
  // 目立たせる。時間切れでも自動では投票へ進まない（合図だけ）。
  // 返すのは表示データだけで、DOM には触らない純粋関数。secondsLeft は
  // 数値に読み替え、読めない値（null・未定義・文字列以外）は 0 秒扱い。
  function buildDiscussTimerView({ mode, phase, discussTimerSetting, secondsLeft }) {
    if (mode !== "pnp" || phase !== "discussion" || !(Number(discussTimerSetting) > 0)) {
      return { hidden: true, low: false, expired: false, voteReady: false, text: "" };
    }
    const seconds = Number(secondsLeft);
    const expired = !(seconds > 0);
    const low = !expired && seconds <= DISCUSS_TIMER_LOW_SECONDS;
    return {
      hidden: false,
      low,
      expired,
      voteReady: expired,
      text: expired
        ? "⏰ 時間切れ！「議論を終えて投票へ」を押してね"
        : `🗣️ 議論タイマー 残り ${formatDiscussTime(seconds)}`,
    };
  }

  // パス＆プレイの受け渡しカバーの表示データ。kind は "handoff"（役職確認）／
  // "night"（夜行動）／"vote"（投票）。見出しは「次は P{n}（名前）さんの番です。」
  // で共通し、後半の案内文とボタンの文言だけが場面で変わる。未知の kind は
  // 役職確認として扱う。返すのは文言だけで、DOM には触らない純粋関数。
  function buildPnpCoverView(player, { index, kind } = {}) {
    const n = Number(index);
    const num = Number.isFinite(n) ? n + 1 : 1;
    const head = `次は <strong>P${num}（${player?.name ?? ""}）</strong>さんの番です。<br>`;
    const caution = "周りの人に見られないように、端末を受け取ったら下のボタンをタップしてください。";
    if (kind === "night") {
      return { coverText: `${head}夜行動の時間です。${caution}`, revealBtnText: "タップして夜の番を始める" };
    }
    if (kind === "vote") {
      return { coverText: `${head}投票の時間です。${caution}`, revealBtnText: "タップして投票の番を始める" };
    }
    return { coverText: `${head}${caution}`, revealBtnText: "タップして役職を見る" };
  }

  // パス＆プレイの役職確認画面の表示データ。役職の HTML は roleHtmlFor で
  // 生成する（バカには表示役職だけ）。確認ボタンは最後の人だけ「ゲーム開始」。
  // player がないときは null。返すのは表示データだけで、DOM には触らない
  // 純粋関数。
  function buildPnpRoleView(player, players, { index, humanCount, mode, humanPlayerIds } = {}) {
    if (!player) return null;
    return {
      title: "あなたの役職",
      roleHtml: roleHtmlFor(player, players, { mode, humanPlayerIds }),
      confirmBtnText: Number(index) + 1 < Number(humanCount)
        ? "確認した（次の人へ）"
        : "確認した（ゲーム開始）",
    };
  }

  // パス＆プレイの前夜の結果画面の表示データ。結果は本人だけに表示し、
  // 公開ログには出さない。結果が空・配列でないときは null（呼び出し側は
  // そのまま夜行動へ進む）。返すのは表示データだけで、DOM には触らない
  // 純粋関数。
  function buildPnpNightResultView(results) {
    if (!Array.isArray(results) || !results.length) return null;
    return {
      title: "前夜の結果",
      html: results.map(r => `<div>${r}</div>`).join(""),
      confirmBtnText: "夜行動へ進む",
    };
  }

  // パス＆プレイの夜行動画面の表示データ。インポスター非代表者の合意・相談、
  // 能力なしの3通りを返す。能力ありの場合は null（呼び出し側はゲーム画面で
  // 対象を選ぶ）。repTarget がない合意分岐は従来通り「相談」側になる。
  // バカは実役職の陣営で判定するため、表示役職がインポスターでも合意・相談
  // にはならない。返すのは表示データだけで、DOM には触らない純粋関数。
  function buildPnpNightActionView(player, { rep, repTarget, isLast } = {}) {
    if (!player) return null;
    const effectiveKey = getEffectiveRoleKey(player);
    const role = ROLES[effectiveKey];
    const confirmLabel = isLast ? "確認した（夜行動を終える）" : "確認した（次の人へ）";
    if (ROLES[player.roleKey].faction === "インポスター" && rep && rep.id !== player.id) {
      if (repTarget) {
        return {
          step: "nightFakeAgree",
          title: "夜行動",
          html: `<strong>${player.name}（${role.name}）</strong><br>インポスターの仲間（${rep.name}）が今夜の襲撃先に <strong>${repTarget.name}</strong> を選びました。<br>この襲撃先で合意しますか？`,
          confirmBtnText: "合意する（能力入力へ）",
        };
      }
      return {
        step: "nightFakeConsult",
        title: "夜行動",
        html: `<strong>${player.name}（${role.name}）</strong><br>インポスターの仲間（${rep.name}）と相談してください。<br>今夜の襲撃先は ${rep.name} が決めます。`,
        confirmBtnText: "相談した（能力入力へ）",
      };
    }
    if (!role.nightAction) {
      return {
        step: "nightNoAction",
        title: "夜行動",
        html: `<strong>${player.name}（${role.name}）</strong><br>今夜は能力がありません。朝まで静かに過ごしましょう。`,
        confirmBtnText: confirmLabel,
      };
    }
    return null;
  }

  // パス＆プレイの手番バナーの文言。head はゲーム画面の factionText と
  // 同じ「P{n}（名前）の番」。kind "vote" は「投票：ヒント」、それ以外は
  // 「役職名：ヒント」。返すのは文言だけで、DOM には触らない純粋関数。
  function buildPnpTurnBannerText(player, { index, kind, roleName, hint } = {}) {
    const n = Number(index);
    const num = Number.isFinite(n) ? n + 1 : 1;
    const head = `P${num}（${player?.name ?? ""}）の番`;
    return {
      head,
      text: kind === "vote" ? `${head} — 投票：${hint}` : `${head} — ${roleName}：${hint}`,
    };
  }

  // 1人のプレイヤー向けの役職表示 HTML。ソロの役職画面とパス＆プレイの
  // 受け渡し画面で共通して使う。バカには表示役職だけを本物として見せる。
  function roleHtmlFor(player, players, opts) {
    const effectiveKey = getEffectiveRoleKey(player);
    const r = ROLES[effectiveKey];
    return `
      <strong>${player.name} の役職：${roleIconButtonHtml(effectiveKey)} ${r.name}</strong><br>
      陣営：${r.faction}<br>
      説明：${r.desc}<br>
      夜の推奨行動：${r.nightActionHint}<br>
      結果の見方：${r.resultInterpretation}<br>
      注意：${r.riskNote}<br>
      ${getAlliesLineForRole(players, player, opts)}
    `;
  }

  // ゲーム画面の役職カードに出す表示データ。表示役職（バカは表示役職）
  // の名前・陣営・フェーズヒント・注意書きと、インポスターの仲間文言。
  // players が空のときや対象がいないときは null（ブラウザ側は描画しない）。
  function buildRoleCardView(players, playerId, opts) {
    if (!players || !players.length) return null;
    const me = players[playerId];
    if (!me) return null;
    const roleKey = getEffectiveRoleKey(me);
    const role = ROLES[roleKey];
    return {
      name: `${role.icon} ${role.name}`,
      roleKey,
      roleName: role.name,
      iconButtonHtml: roleIconButtonHtml(roleKey),
      faction: role.faction,
      phaseHint: getPhaseHint(opts && opts.phase, me),
      riskNote: role.riskNote,
      alliesText: getFakeAlliesText(players, me, opts),
    };
  }

  // ゲーム画面のプレイヤーカード1枚分の表示データ。クラス・aria・
  // メタ・中身の HTML を players の順に配列で返す。DOM の生成や
  // イベントの紐付けはブラウザ側（draw）が行う。脱落カードのメタは
  // 表示役職のアイコン1つ、生存カードは「？」のみで、バカの実役職は
  // 出さない（getPublicRoleKey 経由）。顔画像は opts.iconImgs
  // （スラッグ→ data URI）から差し込み、なければ絵文字だけになる。
  // players が空のときは空配列を返す。
  function buildCardsView(players, opts) {
    if (!players || !players.length) return [];
    const selectedId = opts && opts.selectedId;
    const iconImgs = (opts && opts.iconImgs) || {};
    // playerId はソロで自分を指す id。null（パス＆プレイ等）なら
    // どのカードにも「あなた」マーカーは付かない。
    const playerId = opts && typeof opts.playerId === "number" ? opts.playerId : null;
    return players.map((p, cardIndex) => {
      // 脱落者のカードも結果画面までバカの実役職は出さない。
      const revealedRole = p.alive ? "？" : ROLES[getPublicRoleKey(p)].name;
      // 脱落カードのメタは表示役職のアイコン1つ（getPublicRoleKey 経由
      // なのでバカの実役職は漏れない）。生存カードは「？」のみ。
      // 「 ・ 生存中」は .meta-state に入れて、スマホでは CSS で隠す。
      const metaHtml = p.alive
        ? `？<span class="meta-state"> ・ 生存中</span>`
        : roleIconButtonHtml(getPublicRoleKey(p), { ariaLabel: "役職の簡単な説明を見る" });
      const img = iconImgs[ICON_SLUGS[p.id]];
      const avatarHtml = `<span>${p.icon}</span>${img ? `<img class="avatar-img" data-icon-slug="${ICON_SLUGS[p.id]}" src="${img}" alt="${p.name}" onerror="this.remove()">` : ""}`;
      // 自分のカードだけ名前の横に「あなた」バッジを付け、me クラスで
      // 金色の枠にする（脱落後も自分と分かるようバッジは残す）。
      const isMe = playerId !== null && p.id === playerId;
      const innerHtml = `
        <div class="avatar">${avatarHtml}</div>
        <div class="card-main">
          <div class="name">${p.name}${isMe ? `<span class="me-badge">あなた</span>` : ""}</div>
          <div class="meta">${metaHtml}</div>
        </div>
      `;
      return {
        id: p.id,
        isMe,
        animationDelay: `${cardIndex * 45}ms`,
        className: `card ${p.alive ? "" : "dead"} ${selectedId === p.id ? "selected" : ""} ${p.voted ? "voted" : ""}${isMe ? " me" : ""}`,
        revealedRole,
        ariaLabel: `${p.name}${isMe ? "（あなた）" : ""}、${revealedRole}、${p.alive ? "生存中" : "脱落済み"}`,
        tabIndex: p.alive ? 0 : -1,
        ariaDisabled: !p.alive,
        metaHtml,
        avatarHtml,
        innerHtml,
      };
    });
  }

  // ゲーム画面のステージに並ぶ歩行者（生存者）の表示データ。生存者だけを
  // players の順に返し、1人分は歩行者の span 全体の HTML。--bd は歩行の
  // 周期で、id を 4 で割った余りで 0.31s / 0.34s / 0.37s / 0.40s になる。
  // players が空のときは空配列を返す。
  function buildStageView(players, opts) {
    if (!players || !players.length) return [];
    // playerId はソロで自分を指す id。自分の歩行者だけ頭上に ▼ の
    // マーカー（.wme）と me クラスを付ける。null なら従来どおり。
    const playerId = opts && typeof opts.playerId === "number" ? opts.playerId : null;
    return players.filter(p => p.alive).map(p => {
      const slug = ICON_SLUGS[p.id];
      const duration = (0.31 + (p.id % 4) * 0.03).toFixed(2);
      const isMe = playerId !== null && p.id === playerId;
      return {
        id: p.id,
        slug,
        duration: `${duration}s`,
        isMe,
        html: `
        <span class="walker${isMe ? " me" : ""}" data-player="${p.id}" style="--i:${p.id};--bd:${duration}s"><span class="wshadow"></span><span class="wbody"><img class="frame-a" data-slug="${slug}" data-frame="a" alt=""><img class="frame-b" data-slug="${slug}" data-frame="b" alt=""></span>${isMe ? `<span class="wme" aria-hidden="true">▼</span>` : ""}</span>`,
      };
    });
  }

  // draw() が画面に反映する表示データ（カードとステージ歩行者を除く）。
  // 日数・フェーズ表示、役職カードの表示有無、3つのボタン、マウス公開
  // ボタン、パス＆プレイの手番バナーの文言と表示有無。DOM への代入は
  // ブラウザ側（draw）が行う。state がないときはすべて非表示の表示を返す。
  function buildDrawView(state) {
    const hidden = { hidden: true };
    if (!state) {
      return {
        dayText: "", phaseText: "", roleCardHidden: false,
        actionBtn: { text: "実行", hidden: true },
        voteBtn: { text: "投票する", hidden: true },
        nextBtn: hidden, mouseBtn: hidden, pnpBanner: hidden,
      };
    }
    const phase = state.phase;
    const meta = PHASE_META[phase] || {};
    const me = state.players ? state.players[state.playerId] : undefined;
    const mouseAvailable = state.mode !== "pnp" && phase === "discussion"
      && !!me && getEffectiveRoleKey(me) === "mouse" && !me.mouseUsed;
    const pnpInputPending = state.mode === "pnp"
      && (state.pnpNightInputPending != null || state.pnpVoteInputPending != null);
    return {
      dayText: String(state.day),
      phaseText: meta.label || "",
      roleCardHidden: state.mode === "pnp",
      actionBtn: {
        text: (state.mode === "pnp" && state.pnpNightInputPending != null)
          ? "この対象で決める" : (meta.button || "実行"),
        hidden: phase !== "night",
      },
      voteBtn: {
        text: (state.mode === "pnp" && state.pnpVoteInputPending != null)
          ? "この相手に投票する" : "投票する",
        hidden: phase !== "vote",
      },
      nextBtn: { hidden: !["morning", "discussion"].includes(phase) },
      mouseBtn: { hidden: !mouseAvailable },
      pnpBanner: { hidden: !pnpInputPending },
    };
  }

  // タイトル画面の設定（ブラウザの保存領域に残る gameSettings）。
  // 許容値の一覧と既定値。ブラウザ側の読み込み時バリデーションと
  // 同じ規則で、オンライン対戦の部屋設定でも使い回す。
  const DEFAULT_SETTINGS = { fakeCount: "random", bomber: "random", sound: "on", difficulty: "normal", bgm: "off", mode: "solo", humanCount: "2", discussTimer: "0" };
  const SETTINGS_ALLOWED = {
    fakeCount: ["random", "1", "2"],
    bomber: ["random", "on", "off"],
    sound: ["on", "off"],
    difficulty: ["easy", "normal", "hard"],
    bgm: ["on", "off"],
    mode: ["solo", "pnp"],
    humanCount: ["2", "3", "4", "5", "6", "7", "8"],
    discussTimer: ["0", "60", "120", "180"],
  };
  // 保存された設定を検証して返す純粋関数。parsed が null・非オブジェクト・
  // キー欠け・許容外の値のときはそのキーだけ既定値に戻す（後方互換）。
  // 余分なキーは無視する。入力は変更しない。
  function normalizeSettings(parsed) {
    const out = { ...DEFAULT_SETTINGS };
    if (!parsed || typeof parsed !== "object") return out;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (SETTINGS_ALLOWED[key].includes(parsed[key])) out[key] = parsed[key];
    }
    return out;
  }
  // paintSettings が画面に反映する表示データ。segments は各 .seg の
  // { key, values }（ブラウザ側は DOM から集める）。各ボタンの選択状態
  // と aria-pressed、参加人数・議論タイマーの行の表示有無を返す。
  // DOM への代入はブラウザ側（paintSettings）が行う。settings が
  // 許容外の値でも normalizeSettings で既定値に直してから判定する。
  function buildSettingsView(settings, segments) {
    const normalized = normalizeSettings(settings);
    const list = Array.isArray(segments) ? segments : [];
    return {
      segments: list.map(seg => ({
        key: seg.key,
        buttons: (Array.isArray(seg.values) ? seg.values : []).map(value => {
          const active = value === normalized[seg.key];
          return { value, active, ariaPressed: String(active) };
        }),
      })),
      humanCountHidden: normalized.mode !== "pnp",
      discussTimerHidden: normalized.mode !== "pnp",
    };
  }

  // セリフ／行動ログの折りたたみ。状態は独立キー fakeBloomLogFold に
  // 保存され、保存がなければ両方とも折りたたんだ状態で始める。
  // 定義（キー・要素 id・見出し文言）と既定値はオンライン対戦の
  // 部屋画面でも使い回すため、ここに置く。
  const LOG_FOLD_DEFAULT = { dialogue: true, action: true };
  const LOG_FOLD_DEFS = [
    { key: "dialogue", logId: "dialogueLog", toggleId: "dialogueLogToggle", label: "セリフ" },
    { key: "action", logId: "actionLog", toggleId: "actionLogToggle", label: "行動ログ" },
  ];
  // 保存された折りたたみ状態を検証して返す純粋関数。parsed が null・
  // 非オブジェクト・キー欠け・非真偽値のときはそのキーだけ既定値
  // （たたむ）に戻す（後方互換）。余分なキーは無視する。入力は変更しない。
  function normalizeLogFold(parsed) {
    const out = { ...LOG_FOLD_DEFAULT };
    if (!parsed || typeof parsed !== "object") return out;
    for (const key of Object.keys(LOG_FOLD_DEFAULT)) {
      if (typeof parsed[key] === "boolean") out[key] = parsed[key];
    }
    return out;
  }
  // applyLogFold が画面に反映する表示データ。折りたたみ中かどうか・
  // aria-expanded・トグルボタンの文言を、定義の順に返す。
  // DOM への代入はブラウザ側（applyLogFold）が行う。許容外の値は
  // normalizeLogFold で既定値に直してから判定する。
  function buildLogFoldView(logFold) {
    const normalized = normalizeLogFold(logFold);
    return LOG_FOLD_DEFS.map(def => {
      const folded = !!normalized[def.key];
      return {
        key: def.key,
        logId: def.logId,
        toggleId: def.toggleId,
        hidden: folded,
        ariaExpanded: String(!folded),
        text: `${folded ? "▸" : "▾"} ${def.label}`,
      };
    });
  }
  // 折りたたみ状態の遷移を返す純粋関数。指定したキーだけ新しい値に
  // した新しいオブジェクトを返す。未知のキー・非オブジェクトのときは
  // null（ブラウザ側はそのまま何もしない）。入力は変更しない。
  function withLogFolded(logFold, key, folded) {
    if (!logFold || typeof logFold !== "object" || !(key in LOG_FOLD_DEFAULT)) return null;
    return { ...normalizeLogFold(logFold), [key]: !!folded };
  }
  // タイトル画面の実績チップの定義。id・名前・ヒントだけのデータで、
  // 達成条件は isAchievementUnlocked が id で分岐して判定する
  // （ブラウザ側にあった ACHIEVEMENTS の test と同じ条件）。
  const ACHIEVEMENT_DEFS = [
    { id: "first-win", name: "初勝利", hint: "初めて勝つ" },
    { id: "wins10", name: "10勝クラブ", hint: "通算10勝" },
    { id: "wins30", name: "30勝クラブ", hint: "通算30勝" },
    { id: "pure-win", name: "イノセントの勝利", hint: "イノセント陣営で勝つ" },
    { id: "fake-win", name: "インポスターの勝利", hint: "インポスター陣営で勝つ" },
    { id: "bomber-win", name: "ボマーの勝利", hint: "ボマーで勝つ" },
    { id: "steal", name: "横取り屋", hint: "ボマーの横取り勝利" },
    { id: "roles5", name: "五役の達人", hint: "5種類の役職で勝利" },
    { id: "roles10", name: "十役の達人", hint: "10種類の役職で勝利" },
    { id: "streak3", name: "3連勝", hint: "3連勝する" },
    { id: "games50", name: "常連さん", hint: "通算50戦" },
  ];
  // 戦績から実績ひとつの達成可否を返す純粋関数。欠けた数値は 0、
  // 欠けた集計は空として扱うので、古い保存形式でも記録ベースの
  // 実績は遡って解除される（後方互換）。未知の id は未達成。
  function isAchievementUnlocked(id, stats) {
    const s = stats && typeof stats === "object" ? stats : {};
    const num = v => (typeof v === "number" ? v : 0);
    const factionWins = s.factionWins && typeof s.factionWins === "object" ? s.factionWins : {};
    const byRole = s.byRole && typeof s.byRole === "object" ? s.byRole : {};
    const rolesWon = Object.values(byRole)
      .filter(v => v && typeof v.wins === "number" && v.wins >= 1).length;
    switch (id) {
      case "first-win": return num(s.wins) >= 1;
      case "wins10": return num(s.wins) >= 10;
      case "wins30": return num(s.wins) >= 30;
      case "pure-win": return num(factionWins["イノセント"]) >= 1;
      case "fake-win": return num(factionWins["インポスター"]) >= 1;
      case "bomber-win": return num(factionWins["ニュートラル"]) >= 1;
      case "steal": return num(s.steals) >= 1;
      case "roles5": return rolesWon >= 5;
      case "roles10": return rolesWon >= 10;
      case "streak3": return num(s.bestStreak) >= 3;
      case "games50": return num(s.games) >= 50;
      default: return false;
    }
  }
  // 実績チップの表示データを定義順に返す純粋関数。達成済みは 🏅、
  // 未達成は 🔒。DOM への代入はブラウザ側（renderAchievements）が行う。
  function buildAchievementsView(stats) {
    return ACHIEVEMENT_DEFS.map(def => {
      const unlocked = isAchievementUnlocked(def.id, stats);
      return { id: def.id, name: def.name, hint: def.hint, unlocked, icon: unlocked ? "🏅" : "🔒" };
    });
  }
  // カットインの効果音：種類ごとの対応表。phase は専用の音、info は
  // 汎用の pop。表にない種類（win など）も pop。DOM を使わない純粋関数。
  const CUTIN_SFX = { attack: "attack", bomb: "bomb", protect: "protect", info: "pop", phase: "phase" };
  function cutinSfxFor(kind) {
    return CUTIN_SFX[kind] || "pop";
  }
  // カットイン1件分の表示データを返す純粋関数。sub がなければ ""、
  // kind がなければ "phase"、charId／targetCharId は数値だけ、
  // motion は文字列だけを採用し、それ以外は null。
  // onShow（表示時コールバック）は関数なので含まない。ブラウザ側の
  // showCutin が付け足す（表示時コールバックはキューに残って遅れて
  // 発火するため、対象 id は呼び出し側で値として固定する）。
  function buildCutinItem(title, sub, kind, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    return {
      title,
      sub: sub || "",
      kind: kind || "phase",
      charId: typeof o.charId === "number" ? o.charId : null,
      targetCharId: typeof o.targetCharId === "number" ? o.targetCharId : null,
      motion: typeof o.motion === "string" ? o.motion : null,
    };
  }
  // カットインに載せる顔の HTML を返す純粋関数。カードと同じ顔画像
  // （iconImg）＋絵文字フォールバックで、キャラの顔だけを出す
  // （役職は出さない）。player がなければ ""。iconImg がなければ
  // 絵文字だけ。small は自分の夜アクションの相手の顔（小さい表示）。
  function buildCutinFaceHtml(player, iconImg, slug, small) {
    if (!player) return "";
    return `<span class="cutin-face${small ? " small" : ""}"><span>${player.icon}</span>${iconImg ? `<img class="avatar-img" data-icon-slug="${slug}" src="${iconImg}" alt="${player.name}" onerror="this.remove()">` : ""}</span>`;
  }
  // カットイン1件分の表示データを返す純粋関数。タイトル・サブ・種類の
  // ほか、顔の HTML（自分の顔＋相手の顔（小））、系統モーション、
  // 画面振動の有無、効果音の名前をまとめる。顔の HTML は
  // buildCutinFaceHtml 経由で、キャラの顔だけを出す（役職は出さない）。
  // item なしは null。charId があっても players にいないキャラの顔は
  // 空文字になる（ブラウザ側と同じく顔あり扱いで箱だけ出す）。
  // 画面振動は bomb／attack のときだけ。DOM への代入・タイマー・
  // クリックはブラウザ側（pumpCutin）が行う。
  function buildCutinView(item, players, iconImgs, iconSlugs) {
    if (!item) return null;
    const faceHtml = (id, small) => buildCutinFaceHtml(
      players ? players[id] : undefined,
      iconImgs && iconSlugs ? iconImgs[iconSlugs[id]] : undefined,
      iconSlugs ? iconSlugs[id] : undefined, small);
    const hasChar = item.charId !== null && item.charId !== undefined;
    const charHtml = hasChar
      ? faceHtml(item.charId, false)
        + (item.targetCharId !== null && item.targetCharId !== undefined ? faceHtml(item.targetCharId, true) : "")
      : "";
    return {
      title: item.title,
      sub: item.sub,
      kind: item.kind,
      hasChar,
      charHtml,
      motion: item.motion || "",
      shake: item.kind === "bomb" || item.kind === "attack",
      sfx: cutinSfxFor(item.kind),
    };
  }
  // 吹き出しの表示時間（ミリ秒）。議論の CPU セリフとマウス公開が
  // 1件ずつ発言者のカードの上にこの時間だけ出る。DOM を使わない定数。
  const SPEECH_BUBBLE_MS = 2200;
  // 吹き出しキュー1件分の表示データを返す純粋関数。発言者なし・
  // 空の文言はキューに入れない（ブラウザ側の enqueue と同じ条件）。
  function buildSpeechBubbleItem(playerId, text) {
    if (playerId == null || !text) return null;
    return { playerId, text };
  }
  // 吹き出し要素の表示データを返す純粋関数。クラス名と文言だけ。
  // 要素の生成・代入はブラウザ側（showNextSpeechBubble）が行う。
  function buildSpeechBubbleView(item) {
    if (!item) return null;
    return { className: "speech-bubble", text: item.text };
  }
  // 次に表示する吹き出しの判断を返す純粋関数。キューが空なら none、
  // 議論フェーズ以外なら drop（残りは破棄）、それ以外は先頭を show。
  // カードの有無は DOM なのでブラウザ側で判断する。キューは変更しない。
  function pickNextSpeechBubble(queue, phase) {
    if (!queue || queue.length === 0) return { action: "none" };
    if (phase !== "discussion") return { action: "drop" };
    return { action: "show", item: queue[0] };
  }
  // 画面振動（カットインの bomb／attack 時と共通の演出）。クラス名と
  // 振動時間だけを返す純粋関数。クラスの付け外しとタイマーはブラウザ側
  // （shakeScreen）が行う。
  const SHAKE_CLASS = "shake";
  const SHAKE_MS = 500;
  function buildShakeView() {
    return { className: SHAKE_CLASS, ms: SHAKE_MS };
  }
  // 紙吹雪（勝利時の celebrate）の表示データ。色・枚数・消えるまでの
  // 時間は固定。1枚ごとの横位置・落下の遅れ・落下時間は乱数で決まる
  // ため、random を引数で受け取る（既定は Math.random）。要素の生成・
  // 追加・削除はブラウザ側（celebrate）が行う。
  const CONFETTI_COLORS = ["#ff6fb3", "#b79bff", "#ffd7ec", "#8be0b0", "#ffe08a"];
  const CONFETTI_COUNT = 26;
  const CONFETTI_PIECE_CLASS = "confetti-piece";
  const CONFETTI_REMOVE_MS = 4600;
  function buildConfettiPiece(index, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    return {
      className: CONFETTI_PIECE_CLASS,
      left: `${rnd() * 100}%`,
      background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      delay: `${rnd() * 0.5}s`,
      duration: `${2.2 + rnd() * 1.6}s`,
    };
  }
  function buildConfettiView(random) {
    const pieces = [];
    for (let i = 0; i < CONFETTI_COUNT; i++) pieces.push(buildConfettiPiece(i, random));
    return pieces;
  }
  return {
    ROLES,
    PHASE_META,
    PLAYER_NAMES,
    PLAYER_ICONS,
    ICON_SLUGS,
    CHAR_TALK,
    charTalkPool,
    pickTalkLine,
    DISCUSSION_TEMPLATES,
    planDiscussionTalks,
    INNOCENT_ROLE_KEYS,
    CLUMSY_SEER_RATE,
    rand,
    shuffle,
    dealRoles,
    resolveVoteTally,
    checkWinCondition,
    getEffectiveRoleKey,
    getPublicRoleKey,
    formatActionLog,
    resolveNightActions,
    cpuNightActions,
    cpuVotePick,
    planNightActions,
    buildHighlights,
    LEGACY_ROLE_NAMES,
    LEGACY_FACTION_NAMES,
    migrateFactionWins,
    applySoloStats,
    applyPnpStats,
    buildStatsView,
    buildResultSummary,
    buildResultRowHtml,
    buildResultRowsView,
    getPhaseHint,
    getFakeAlliesText,
    getAlliesLineForRole,
    roleHtmlFor,
    roleIconButtonHtml,
    buildRoleInfoView,
    ROLE_GUIDE_ORDER,
    buildRoleGuideView,
    PARADE_BD,
    buildParadeView,
    DISCUSS_TIMER_LOW_SECONDS,
    formatDiscussTime,
    buildDiscussTimerView,
    buildPnpCoverView,
    buildPnpRoleView,
    buildPnpNightResultView,
    buildPnpNightActionView,
    buildPnpTurnBannerText,
    buildRoleCardView,
    buildCardsView,
    buildStageView,
    buildDrawView,
    DEFAULT_SETTINGS,
    SETTINGS_ALLOWED,
    normalizeSettings,
    buildSettingsView,
    LOG_FOLD_DEFAULT,
    LOG_FOLD_DEFS,
    normalizeLogFold,
    buildLogFoldView,
    withLogFolded,
    ACHIEVEMENT_DEFS,
    isAchievementUnlocked,
    buildAchievementsView,
    CUTIN_SFX,
    cutinSfxFor,
    buildCutinItem,
    buildCutinFaceHtml,
    buildCutinView,
    SPEECH_BUBBLE_MS,
    buildSpeechBubbleItem,
    buildSpeechBubbleView,
    pickNextSpeechBubble,
    SHAKE_CLASS,
    SHAKE_MS,
    buildShakeView,
    CONFETTI_COLORS,
    CONFETTI_COUNT,
    CONFETTI_PIECE_CLASS,
    CONFETTI_REMOVE_MS,
    buildConfettiPiece,
    buildConfettiView,
  };
});
