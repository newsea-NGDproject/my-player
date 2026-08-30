/*
======================================================================
 tap.js ── タップ補正(ノリ注入)

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の 🛌 ボタンを押すと開く「タップ補正画面」です。
 曲を聴きながら12回タップして、その曲の本当のテンポ(BPM)と
 拍の位置を、人の耳で測ります。

 legacy の「下準備モジュール V1.9.3」から移植しました。
 移植元: legacy/ver8.5-gemini/031-下準備モジュール/

----------------------------------------------------------------------

【なぜ自動解析(js/bpm.js)があるのに、人が測るのか】

 自動解析は便利ですが精度に限界があります。特に「1拍目がどこか」は
 機械には分かりません。ノリRunの本命であるビートマッチング
 (曲間をテンポを保って繋ぐ)には、**拍の位置がミリ秒単位で必要**です。

 そこで竹弘が耳で測った値を manualBPM / startTS / endTS として持ち、
 自動解析より優先して使います(js/pitch.js の getEffectiveBaseBpm)。

----------------------------------------------------------------------

【12回タップの決まり(竹弘の仕様)】

   ・曲を聴きながら12回タップする
   ・**最初の4回は使わない**。人は最初、曲に乗れていないため
   ・5回目〜12回目の8回(以下「採用8タップ」)から計算する
   ・12回目でロックがかかり、13回目以降は受け付けない

----------------------------------------------------------------------

【v147で測る場所は A地点 だけです】

 完成形は1曲につき2か所を測ります。

   A地点(曲の頭側)  … 1拍目の位置 = startTS
   B地点(曲の終わり側)… 13タップ目の位置 = endTS(曲の接続点)

 v147ではA地点だけを作り、操作感を実機で確かめます。
 B地点・DBへの保存・🛌→🕺の切り替えは v148 で足します。

----------------------------------------------------------------------

【★ここは特許を取る予定の中核ロジックです】

 タップ補正と曲接続(「13=0」)は、ノリRunの一番大事な部分です。
 アルゴリズムの詳細を外部に出さないこと。
======================================================================
*/


// ==========================================================
// 1. 決まり事(数字はすべてここに集める)
// ==========================================================

// 何回タップさせるか
const TAP_TOTAL_COUNT = 12;

// 最初の何回を捨てるか(曲に乗れていない分)
const TAP_DISCARD_COUNT = 4;

/*
測る場所は2つあり、この2つを順番に測ります(v150)。

    A地点 … 曲の頭側。ここで測るのが startTS(1拍目の位置)
    B地点 … 曲の終わり側。ここで測るのが endTS(13拍目=曲の接続点)

文字列にしているのは、console.log に出た時にそのまま読めるからです
(true/false だとどちらの意味か分かりません)。
*/
const TAP_PHASE_A = "A";
const TAP_PHASE_B = "B";

/*
13タップ目の拍番号です。

fitTapBeatGrid() は採用8タップの1回目を「拍番号1」として数えます。
startTS がその拍番号1で、13タップ目はそこから8拍先なので拍番号9です。

    採用8タップ    1  2  3  4  5  6  7  8      (12回目のタップが拍番号8)
    拍番号         1 ……………………………… 8  9 ← ここが13タップ目
                   ↑startTS                    ↑endTS

⚠️ 移植元V1.9.3はここに「拍番号1」をそのまま入れており、8拍ぶんの
   実装漏れがありました(2026-08-24に竹弘と発見)。この9という数字が
   仕様どおりの接続点です。
*/
const TAP_END_BEAT_NUMBER = 9;

/*
タップ補正できる曲の最短の長さ(秒)です。

【なぜ制限が要るのか】
B地点は「曲の終わりの少し手前」から測るので、短すぎる曲では
A地点とB地点が重なってしまい、測る意味がなくなります。
竹弘の判断で60秒未満は対象外としました。
*/
const TAP_MIN_DURATION_SEC = 60;

/*
測り始める位置の初期値です。

  A地点 … 曲の頭から5秒
  B地点 … 曲の終わりから25秒手前

【この数字の由来(竹弘、2026-08-24)】
    「この25秒は、結構適当で、25秒くらい経てば曲のリズムが
      安定しているだろうという感じで決めたもの」

そのため **固定にせず、画面で前後に動かせる** ようにしてあります。
演奏がなく会話のような、リズムの取りにくい部分に当たった時に
逃げられるようにするためです。
*/
const TAP_POS_A_DEFAULT_SEC = 5;
const TAP_POS_B_BEFORE_END_SEC = 25;

// 位置調整ボタン1回で動く秒数(竹弘の指定)
const TAP_POS_STEP_SEC = 5;

/*
測り直しの時、その拍の何秒前から鳴らし始めるか(v153)。

前に測った位置をもう一度聴いてもらうための助走です。いきなりその拍から
鳴らすと、耳が構える前にカチッが来てしまい、合っているかを判断できません。
3秒あれば、BPM170なら8拍ぶん聴けます。
*/
const TAP_REPLAY_LEAD_SEC = 3;

/*
測り始める位置の上限を決めるための余白(秒)です。

12回タップするには時間が要ります。曲の終わり際から始めてしまうと
叩き終わる前に曲が終わってしまうので、末尾はこれだけ残します。
(遅い曲=BPM60でも12回で約12秒。余裕を見て20秒)
*/
const TAP_TAIL_MARGIN_SEC = 20;

// メトロノームを何秒先まで予約しておくか
const TAP_METRONOME_WINDOW_SEC = 60;

/*
メトロノームの音です(竹弘の仕様⑤)。

    「爆音メトロノーム: 1500Hz(矩形波)で、派手な曲の中でも
      ハッキリ聴こえる音」

矩形波(square)は、同じ高さの音でもサイン波より倍音が多く、
音楽に埋もれにくい「カチッ」とした音になります。

※ うまくいったら、初期設定で使っている click.wav(サンプリング音)と
  聴き比べて、良い方を採用する予定です(竹弘、2026-08-24)。
*/
const TAP_CLICK_HZ = 1500;
const TAP_CLICK_TYPE = "square";
const TAP_CLICK_GAIN = 0.6;
const TAP_CLICK_SEC = 0.05;

// 曲を鳴らす音量(メトロノームが埋もれないよう控えめに)
const TAP_SONG_GAIN = 0.5;

/*
音を出し始める時と切る時に、音量を 0 ⇄ 本来の大きさへ動かす時間(秒)。

【なぜ必要か(竹弘の報告、2026-08-30)】
    「曲を再生していない時であっても、タップ補正ボタンを押すと、
      押した瞬間にノイズが『ブッ』て入る時がある」

この画面は曲の途中(5秒地点など)からいきなり鳴らします。音の波は
上下に揺れているので、**揺れの途中の値からいきなり音が始まる**と、
スピーカーの紙が瞬間的に飛ばされて「ブッ」と鳴ります。止める時も同じです。

竹弘の「時がある」もこれで説明がつきます。始めた位置がたまたま
波の底(振幅ゼロ付近)なら、段差が無いので鳴りません。

0.015秒(15ミリ秒)は耳には一瞬で、曲が遅れて始まったとは感じません。
それでいて波形を滑らかに繋ぐには十分な長さです。
*/
const TAP_FADE_SEC = 0.015;

/*
まだ何も測っていない時の、内部で持っておくBPMです(v155)。

画面には出しません(測る前は「---.--」と出します)。ここに何か入れて
おかないと、1拍の長さの計算で0割りが起きるための置き場です。
*/
const TAP_DEFAULT_BPM = 120;


// ==========================================================
// 2. 今の状態
// ==========================================================
/*
このファイルの中だけで使う覚え書きです。

【なぜ1つのオブジェクトにまとめているのか】
バラバラのグローバル変数にすると、他のファイルの名前と
ぶつかる危険があります(setup.js が IIFE で囲われているのと同じ心配)。
tapState という1つの入れ物にまとめておけば、名前の衝突は
「tapState」1つ分で済みます。
*/
const tapState = {

    trackId: null,      // 今どの曲を測っているか
    track: null,        // その曲のデータ

    audioCtx: null,     // 音を扱う作業台
    songBuffer: null,   // 曲をほどいた波形データ(約80MB)
    songSource: null,   // 今鳴らしている曲
    songGain: null,     // 曲の音量つまみ

    ctxStartTime: 0,    // 鳴らし始めた時のaudioCtxの時刻
    playOffset: 0,      // 曲の何秒目から鳴らし始めたか

    scheduledTicks: [], // 予約済みのメトロノーム(止める時に使う)

    posSec: 0,          // 測り始める位置(曲の何秒目か)

    taps: [],           // 押された時刻(曲の何秒目か)
    locked: false,      // 12回に達して受付を止めたか

    phase: TAP_PHASE_A, // 今どちらの地点を測っているか(v150)

    /*
    もうこの曲を測ったか(v155)。

    false の間、画面の数字は「---.--」のままにします。
    **これが無いと、前の曲で測った値が次の曲を開いた時に出たままになり、
    その曲を測った結果のように見えてしまいます**(竹弘の指摘、2026-08-30)。
    値そのものも開くたびに初期化しますが、「まだ測っていない」ことを
    表す旗が別にある方が、表示の判断が確実です。
    */
    measured: false,

    bpm: TAP_DEFAULT_BPM, // 割り出したBPM
    beatOriginSec: 0,   // 拍番号0の位置(秒)。ここから拍が等間隔に並ぶ

    /*
    今その地点で「狙っている拍」の番号です(v151で追加)。

    【なぜ秒ではなく拍番号で持つのか】
    微調整でBPMを変えると1拍の長さが変わるので、拍の位置も動きます。
    秒で覚えていると、耳で合わせたメトロノームの位置と、保存される
    値がズレていきます。**拍番号で持てば、BPMをいくら動かしても
    「同じ拍」を指し続けます。**

        A地点          … 1(1拍目)
        B地点(叩いた)  … 9(13タップ目)
        B地点(引き継ぎ)… 測り始め位置の拍 + 8

    実際の秒は updateTapTargetTS() が
    「beatOriginSec + 1拍の長さ × 拍番号」で計算します。
    */
    targetBeat: 1,

    startTS: 0,         // A地点で測る1拍目の位置(秒)
    endTS: 0,           // B地点で測る13拍目の位置(秒)= 曲の接続点
    latencyMs: 0,       // Bluetoothの遅延調整値

    /*
    前に測った値を読み戻して開いたか(v153)。

    🕺の曲(測定済み)を開くと、タップを飛ばして微調整画面から始まります。
    この旗が立っている間は、B地点も**保存されている13拍目**をそのまま
    確認してもらいます(A地点から計算し直すと、前回の値の確認になりません)。

    どこかで叩き直したら、その時点で前の値は用済みなので旗を下ろします。
    */
    resumedFromSaved: false,

    wasPlaying: false   // 開く前に曲が鳴っていたか(閉じる時に戻すため)

};


// ==========================================================
// 3. 画面部品
// ==========================================================

const tapScreen = document.getElementById("tap-screen");
const tapSongLabel = document.getElementById("tap-song");
const tapPhaseLabel = document.getElementById("tap-phase");
const tapBpmDisplay = document.getElementById("tap-bpm");
const tapTsDisplay = document.getElementById("tap-ts");
const tapLatDisplay = document.getElementById("tap-lat");
const tapGuide = document.getElementById("tap-guide");
const tapPosLabel = document.getElementById("tap-pos-label");
const tapPosRow = document.getElementById("tap-pos-row");
const tapZone = document.getElementById("tap-zone");
const tapCountLabel = document.getElementById("tap-count");
const tapLock = document.getElementById("tap-lock");

/*
12回叩き終わった時に出る「微調整画面へ進む」ボタンの置き場所
(v148で新設)。

v147ではこのボタンが蓋(#tap-lock)の中 ＝ タップ場所の真上に
あったため、13拍目をノリで叩くと「やり直す」を誤爆していました。
*/
const tapLockActions = document.getElementById("tap-lock-actions");

/*
「今のタップをやり直す」ボタン(v149で画面いちばん下の行へ移動)。

v148では上の #tap-lock-actions の中にありましたが、実機で画面に
収まらずスクロールが必要になったため、「やめる」と横に並べて
1行ぶん節約しました(竹弘の指示、2026-08-29)。

⚠️ 蓋・進むボタン・このボタンの3つは必ず同時に出し入れします。
   書き忘れを防ぐため、切り替えは **setTapLockUI() 経由だけ** で
   行ってください(直接 style を書かないこと)。
*/
const tapRetryLock = document.getElementById("tap-retry-lock");
const tapAdjustPanel = document.getElementById("tap-adjust");
const tapToast = document.getElementById("tap-toast");

// 確定ボタン。文言が地点によって変わるので、ここで掴んでおきます
const tapConfirmBtn = document.getElementById("tap-confirm");

/*
「タップからやり直す」ボタン(v152で画面いちばん下の行へ移動)。

微調整画面でも縦が1行足りずスクロールが出たため、「やめる」と
横に並べました(竹弘の指示、2026-08-30)。微調整パネルと必ず
一緒に出し入れするので、切り替えは setTapAdjustUI() 経由だけで
行ってください。
*/
const tapRetryAdjust = document.getElementById("tap-retry-adjust");


// ==========================================================
// 4. 入口 ── 曲一覧の 🛌 から呼ばれます
// ==========================================================
/**
 * タップ補正画面を開きます。
 *
 * @param {string} trackId - 測る曲
 */
async function openTapCorrection(trackId){

    const track = libraryMap[trackId];

    if(!track){ return; }

    /*
    短すぎる曲は対象外です(竹弘の指示)。

    「曲は止めずにメッセージ対応で、寝てる絵文字のままとしましょう」
    ということなので、再生中の曲には一切触れず、画面も切り替えません。
    お知らせを数秒出すだけで終わります。
    */
    if(!track.duration || track.duration < TAP_MIN_DURATION_SEC){

        showTapToast("曲が短すぎる為ノリ注入できません");

        console.log(
            "曲が短すぎるためタップ補正を行いません :",
            track.file_name,
            "/ 長さ",
            track.duration,
            "秒"
        );

        return;

    }

    tapState.trackId = trackId;
    tapState.track = track;

    /*
    必ずA地点から始めます(v150)。

    前回この画面をB地点の途中で閉じていると phase が "B" のまま
    残っているので、ここで戻しておかないと、開いた瞬間にいきなり
    B地点から始まってしまいます。
    */
    tapState.phase = TAP_PHASE_A;
    tapState.resumedFromSaved = false;

    /*
    測定値をまっさらに戻します(v155)。

    ここを消しておかないと、前の曲で測った値が残ったまま次の曲の画面に
    出てしまい、その曲を測った結果のように見えます(竹弘の指摘、
    2026-08-30)。機能には影響しませんが、誤解を招く表示は事故のもとです。

    ⚠️ 遅延(latencyMs)はここで消しません。イヤホンの性質であって曲の
       性質ではなく、次に測る曲へ引き継ぐのが仕様だからです
       (このすぐ下で保存済みの値を読み込んでいます)。
    */
    tapState.measured = false;
    tapState.bpm = TAP_DEFAULT_BPM;
    tapState.beatOriginSec = 0;
    tapState.targetBeat = 1;
    tapState.startTS = 0;
    tapState.endTS = 0;

    // 位置は毎回この初期値から始めます(前回位置は保存していません)
    tapState.posSec = TAP_POS_A_DEFAULT_SEC;

    // 前回この端末で合わせた遅延を引き継ぎます(2曲目以降が楽になります)
    tapState.latencyMs = await loadTapLatency();

    /*
    再生中の曲を止めます。マイピッチ設定(js/setup.js)と同じ考え方で、
    測っている間は別の曲が鳴ると邪魔になるためです。
    閉じる時に、鳴っていた場合だけ続きから再開します。

    停止ボタンの記号(■⇄▶)はわざと触りません。js/upper-area.js は
    「竹弘が自分で押した停止」の時だけ記号を変えるので、旗を立てなければ
    ■ のまま動かず、開いて閉じただけでちらつくことがありません。
    */
    tapState.wasPlaying = !audioPlayer.paused;

    if(tapState.wasPlaying){
        audioPlayer.pause();
    }

    // 画面を出してから重い読み込みを始めます(待ち時間に何が起きているか見せるため)
    showTapScreen();

    setTapGuide("曲を読み込んでいます…");

    const loaded = await loadTapSong(track);

    if(!loaded){

        setTapGuide("曲を読み込めませんでした。閉じてもう一度お試しください。");

        return;

    }

    /*
    前に測ってある曲(🕺)は、タップを飛ばして微調整画面から始めます(v153)。

    測り直しは何度でもできる約束なので、開けること自体は前から同じですが、
    毎回12回×2地点を叩き直すのは負担が大きすぎました。値があるなら
    まず聴いて確かめてもらい、ズレていた時だけ叩き直します。
    */
    const hasSaved = hasSavedTapResult(track);

    /*
    どちらの道を通ったかを必ず記録します(v154で追加)。

    【なぜログが要るのか】
    「🕺なのにタップから始まった」時、原因が2つあって画面からは
    区別がつかないためです(竹弘の実機報告、2026-08-30)。

      1. 測定データが本当に無い(v150より前に印だけ付けた曲)
      2. js/tap.js が古いまま動いている(アップロード漏れ)

    値をそのまま出しておけば、1なら undefined や 0 が並び、
    2ならこの行自体が出ません。それだけで切り分けられます。
    */
    console.log(
        "タップ補正を開きます :",
        track.file_name,
        "/ 測定済み :",(hasSaved ? "はい(微調整から)" : "いいえ(タップから)"),
        "/ manualBPM :",track.manualBPM,
        "/ startTS :",track.startTS,
        "/ endTS :",track.endTS
    );

    if(hasSaved){

        resumeTapFromSaved();

        return;

    }

    resetTapPhase();

    /*
    🕺なのに測定データが無い曲への案内です(v154で追加)。

    タップ補正ができる前(v78-v79の頃)は、ボタンを押すと印を付けるだけの
    仮の作りでした。その時代に🕺にした曲は補正データを持っていないので、
    ここへ来ます。**壊れているのではなく、測り直せば🕺のまま値が入ります。**
    黙ってタップ画面が出ると「動いていない」ように見えるため、
    理由をはっきり書いておきます。
    */
    if(track.is_analyzed){

        setTapGuide(
            "この曲は🕺になっていますが、測定データが残っていません" +
            "(タップ補正ができる前に印だけ付けた曲です)。" +
            "いまから " + TAP_TOTAL_COUNT + " 回タップして測り直してください。"
        );

    }

}


// ==========================================================
// 5. 曲を読み込む
// ==========================================================
/*
音を扱う作業台(AudioContext)を1つだけ持ち、**閉じずに使い回します**(v157)。

【なぜ閉じないのか(竹弘の観察、2026-08-30)】
    「曲停止中にタップ補正ボタンを押して、やめるボタンを押して戻った後、
      最初に音のなるボタン(再度タップ補正ボタン押すとか曲名を押して
      再生する)を押すとほぼノイズが高確率で入る」

作業台を閉じると、スマホのオーディオ出力そのものが止まります。すると
イヤホン側は「もう音が来ない」と判断してアンプを切り、次に音が来た時に
慌てて起き上がります。**その起き上がりが「ブッ」の正体**です。
曲名を押して再生した時(こちらは <audio> で、タップ補正とは別の仕組み)
にも鳴るのは、犯人が再生処理ではなく出力の入り切りだからです。

作業台を開いたままにしておけば出力が途切れないので、この復帰音自体が
起きなくなります。音を出していない間の電池の消費はごくわずかです。

【閉じないと数の上限に引っかからないか】
ブラウザには同時に作れる AudioContext の数に上限があります(Chromeで
6個程度)。**1つだけ作って使い回す**この形なら、何度タップ補正を開いても
増えないので、上限には決して届きません。むしろ開くたびに作り直していた
今までの方が、作り損ねる危険がありました。
*/
let tapAudioCtx = null;

function getTapAudioContext(){

    if(!tapAudioCtx){

        tapAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

    }

    /*
    ブラウザの判断で眠っている(suspended)ことがあるので、起こしてから
    返します。眠ったままだと音が1つも鳴りません。
    */
    if(tapAudioCtx.state === "suspended"){

        tapAudioCtx.resume().catch(function(error){

            console.error("音の作業台を起こせませんでした :",error.name,error.message);

        });

    }

    return tapAudioCtx;

}

/**
 * 曲のファイルを読み、音の波形データ(AudioBuffer)にほどきます。
 *
 * @return {boolean} 読めたら true
 *
 * 【なぜ <audio> ではなく波形データにするのか】
 *
 * タップ補正はミリ秒の精度で「何秒目を叩いたか」を知る必要があります。
 * <audio> の currentTime は数十ミリ秒ごとにしか更新されないため、
 * この用途には粗すぎます。AudioContext の時計はサンプル単位
 * (1秒を44100に刻んだ精度)なので、こちらを使います。
 *
 * 引き換えに、4分の曲でおよそ80MBのメモリを使います。
 * js/bpm.js の自動解析も同じことをしているので、実績のある方法です。
 * 閉じる時に必ず解放します。
 */
async function loadTapSong(track){

    try{

        // 権限を確認し直します(js/player.js と同じパターン)
        let permission = await track.file_handle.queryPermission({mode:"read"});

        if(permission !== "granted"){
            permission = await track.file_handle.requestPermission({mode:"read"});
        }

        if(permission !== "granted"){

            console.error("この曲へのアクセスが許可されませんでした :",track.file_name);

            return false;

        }

        const file = await track.file_handle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        tapState.audioCtx = getTapAudioContext();

        /*
        音量つまみは、ここではなく playTapSongFrom() が鳴らすたびに
        作ります(v156でこちらへ移しました。理由はあちらのコメント)。
        */

        tapState.songBuffer = await tapState.audioCtx.decodeAudioData(arrayBuffer);

        return true;

    }
    catch(error){

        console.error(
            "タップ補正の曲読み込みに失敗 :",
            track.file_name,
            error.name,
            error.message
        );

        return false;

    }

}


// ==========================================================
// 6. 測る場所へ移動して、タップ待ちに戻す
// ==========================================================
/**
 * 「12回叩き終わった状態」の見た目を、まとめて出し入れします。
 *
 * 出し入れするのは次の3つです。**必ず3つ同時**でなければならず、
 * どれか1つでも書き忘れると「蓋は開いたのにボタンが残る」ような
 * ちぐはぐな画面になります。だからここに集めました(v149)。
 *
 *   #tap-lock         … タップ場所にかぶさる蓋(13回目以降を弾く)
 *   #tap-lock-actions … 微調整画面へ進むボタン
 *   #tap-retry-lock   … 今のタップをやり直すボタン(画面いちばん下)
 *
 * @param {boolean} shown - true で「叩き終わった状態」にします
 */
function setTapLockUI(shown){

    /*
    display に入れる値がボタンごとに違うのは、並べ方が違うためです。
    蓋と進むボタンは中身を縦に積む flex、やり直すボタンは
    「やめる」と横に並ぶ普通のボタンなので block です。
    */
    tapLock.style.display        = shown ? "flex"  : "none";
    tapLockActions.style.display = shown ? "flex"  : "none";
    tapRetryLock.style.display   = shown ? "block" : "none";

}

/**
 * 微調整画面の見た目を、まとめて出し入れします(v152)。
 *
 * setTapLockUI() と同じ考え方で、必ず一緒に動く2つをここに集めています。
 *
 *   #tap-adjust       … BPMと遅延の調整パネル本体
 *   #tap-retry-adjust … タップからやり直すボタン(画面いちばん下の行)
 *
 * @param {boolean} shown - true で微調整画面にします
 */
function setTapAdjustUI(shown){

    tapAdjustPanel.style.display = shown ? "block" : "none";
    tapRetryAdjust.style.display = shown ? "block" : "none";

}

/**
 * タップをやり直せる状態に戻し、測る場所から曲を鳴らし直します。
 */
function resetTapPhase(){

    tapState.taps = [];
    tapState.locked = false;

    /*
    ここへ来たということは、これから叩き直すということです(v153)。

    前に測った値はもう使わないので、読み戻しの旗を下ろします。
    立てたままだと、A地点を叩き直したのにB地点では前回の13拍目が
    出てきて、新しく測ったBPMと噛み合わなくなります。
    */
    tapState.resumedFromSaved = false;

    /*
    これから叩き直すので、数字も「---.--」に戻します(v155)。
    前の測定結果が出たままだと、今から測る値と混ざって見えます。
    */
    tapState.measured = false;

    setTapLockUI(false);
    setTapAdjustUI(false);
    tapZone.style.display = "flex";
    tapPosRow.style.display = "flex";

    tapCountLabel.textContent = "READY";

    if(tapState.phase === TAP_PHASE_A){

        setTapGuide(
            "曲のリズムに合わせて " + TAP_TOTAL_COUNT + " 回タップしてください。" +
            "最初の " + TAP_DISCARD_COUNT + " 回は計算に使わないので、" +
            "リズムに乗るまでの助走に使って大丈夫です。"
        );

    }
    else{

        setTapGuide(
            "こんどは曲の終わり側(B地点)です。同じように " +
            TAP_TOTAL_COUNT + " 回タップしてください。" +
            "ここで測る13拍目が、次の曲へ繋ぐ接続点になります。"
        );

    }

    updateTapMonitor();
    updateTapPosLabel();

    // メトロノーム無しで、素の曲を鳴らします
    playTapSongFrom(tapState.posSec,false);

}

/**
 * その曲に、前に測った値が揃っているかを調べます(v153)。
 *
 * 3つとも揃っている時だけ「測定済み」と見なします。どれか1つでも
 * 欠けていると拍の格子を作り直せないので、その時は普通にタップから
 * 始めてもらいます。
 *
 * typeof で数値かどうかまで見ているのは、undefined や null が
 * 紛れ込んだ時に isFinite() だけでは弾けないためです
 * (isFinite(null) は null を0と見なすので true になってしまいます)。
 */
function hasSavedTapResult(track){

    return typeof track.manualBPM === "number" && isFinite(track.manualBPM) && track.manualBPM > 0
        && typeof track.startTS === "number" && isFinite(track.startTS) && track.startTS > 0
        && typeof track.endTS === "number" && isFinite(track.endTS) && track.endTS > 0;

}

/**
 * 「この秒の位置に拍がある」という状態に、拍の格子を組み直します(v153)。
 *
 * 【なぜ組み直しが要るのか】
 * 保存してあるのは秒(startTS / endTS)だけで、拍の格子そのものは
 * 残していません。一方このファイルは、拍を
 * 「beatOriginSec + 1拍の長さ × targetBeat」で扱う作りです
 * (v151。BPMを動かしても同じ拍を指し続けるため)。
 * そこで、狙う拍を1拍目と決めて、その1拍前を原点に置き直します。
 *
 *     beatOriginSec = ts − 1拍   ならば
 *     beatOriginSec + 1拍 × 1 = ts   となって元の秒に戻る
 *
 * メトロノームは原点から等間隔に鳴るので、原点がどこにあっても
 * 曲全体で正しい位置にカチッが並びます。
 *
 * @param {number} ts - そこに拍を置きたい秒
 */
function restoreTapGridAt(ts){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    tapState.targetBeat = 1;
    tapState.beatOriginSec = ts - beatDur;

}

/**
 * 前に測った値を読み戻して、A地点の微調整画面から始めます(v153)。
 *
 * 【竹弘の指示(2026-08-29)】
 *     「曲(注入済み)を押した時は、前回タップの詳細調整画面としたい。
 *       前回の設定状況を確認して、やめるか修正するか判断するように
 *       ブラッシュアップしたい」
 *
 * 12回叩き直す必要はありません。前の値でメトロノームを鳴らし、
 * 曲と合っているかを耳で確かめてもらうだけです。ズレていた時だけ
 * 「タップからやり直す」で測り直します(B地点の引き継ぎと同じ考え方)。
 */
function resumeTapFromSaved(){

    const track = tapState.track;

    tapState.resumedFromSaved = true;

    // 前に測った値があるので、最初から数字を出します(v155)
    tapState.measured = true;

    tapState.bpm = track.manualBPM;
    tapState.startTS = track.startTS;

    // B地点へ進んだ時に、保存されている13拍目をそのまま確認できるように控えます
    tapState.endTS = track.endTS;

    // A地点の1拍目に拍を置き直します
    restoreTapGridAt(track.startTS);

    /*
    その拍の少し前から鳴らします。

    測り直しになった時のために、位置は前回の測定位置ではなく
    「保存されている1拍目の手前」に合わせています。前回どこで測ったかは
    残していないので、値そのものから逆算するのが確実です。
    */
    tapState.posSec = Math.max(0,track.startTS - TAP_REPLAY_LEAD_SEC);

    updateTapPhaseLabel();

    showTapAdjustPanel(
        "前にこの曲で測った値です。メトロノームと曲が合っているか聴いて" +
        "確かめてください。直すなら「タップからやり直す」、このままで" +
        "よければ「やめる」で戻れます(値は保存済みです)。",
        tapState.posSec
    );

}

/**
 * A地点を終えて、B地点(曲の終わり側)の測定へ移ります。
 *
 * 【なぜ自動でB地点へ進むのか】
 * 1曲につきA地点とB地点の両方が揃って初めて意味を持つデータなので
 * (startTS だけあっても曲は繋げません)、A地点を確定したら
 * そのまま続けて測ってもらいます。移植元V1.9.3も同じ流れです。
 */
function startTapPhaseB(){

    tapState.phase = TAP_PHASE_B;

    /*
    前に測った値を読み戻して来た時は、保存されている13拍目を
    そのまま確認してもらいます(v153)。

    ここでA地点から計算し直してしまうと、竹弘が確かめたい
    「前回の設定状況」ではなく、今作った別の値を見せることになります。
    */
    if(tapState.resumedFromSaved){

        restoreTapGridAt(tapState.endTS);

        tapState.posSec = Math.max(0,tapState.endTS - TAP_REPLAY_LEAD_SEC);

        updateTapPhaseLabel();

        showTapAdjustPanel(
            "前にこの曲で測った接続点(13拍目)です。メトロノームと曲が" +
            "合っているか聴いて確かめてください。直すなら" +
            "「タップからやり直す」で測り直せます。",
            tapState.posSec
        );

        return;

    }

    /*
    測り始める位置を、曲の終わりから数えた場所に移します。

    Math.max で0を下回らないようにしているのは、短い曲でも
    マイナス秒から鳴らそうとして壊れないようにするためです
    (60秒の曲なら 60-25=35秒 なので通常は起きませんが、念のため)。
    */
    tapState.posSec = Math.max(
        0,
        tapState.songBuffer.duration - TAP_POS_B_BEFORE_END_SEC
    );

    updateTapPhaseLabel();

    /*
    ---- B地点は「まず聴いてもらう」ところから始めます(v151) ----

    【竹弘の指示(2026-08-30)】
        「最初に『A地点の値を引き継ぐ』かを確認し、B地点で微調整画面へ。
          ここでリスニングして、A地点のタップ補正の精度が低ければ
          B地点のノリ注入をし直すとして、少しでもユーザー負担を軽減
          するとしたい」

    【なぜ叩かずに済むのか】
    A地点で「1拍の長さ」と「拍の位置」が分かった時点で、その曲の拍は
    曲の最後まで等間隔に並んでいると分かります。つまりB地点の拍の
    位置は**計算で出せる**ので、本来もう一度叩く必要はありません。

    ただしA地点のBPMがほんの少しズレていると、そのズレは曲の終わりまで
    積み上がって大きくなります。合っているかどうかは耳でしか確かめ
    られないので、メトロノームを重ねて鳴らし、竹弘に聴いてもらいます。
    ズレていた時だけ「タップからやり直す」でB地点を叩き直します。

    ※ タップ補正そのものが、BPM自動解析やAI補正の精度が上がるまでの
      「手で測る」つなぎの仕組みです(竹弘の経緯説明、2026-08-30)。
      だからこそ、手で叩く回数は少ないほどよいという判断です。
    */
    inheritGridToPhaseB();

    showTapAdjustPanel(
        "A地点で測った値をそのまま当てています。メトロノームと曲の" +
        "リズムが合っているか聴いて確かめてください。ズレていたら" +
        "「タップからやり直す」でB地点を測り直せます。",
        tapState.posSec
    );

}

/**
 * A地点で求めた拍の格子をB地点まで伸ばし、13拍目(endTS)を計算します。
 *
 * 【やっていること】
 * A地点で引いた直線は曲の最後まで続いているので、B地点の測り始め位置を
 * 追い越した最初の拍を「1拍目」と見なし、そこから8拍先を13拍目とします。
 * B地点で実際に12回叩いた時と、まったく同じ数え方です。
 *
 *     測り始め位置 ──▶ ここを追い越した最初の拍 = 1拍目
 *                                  └─ 8拍先 ─▶ 13拍目(endTS)
 *
 * ⚠️ ここで遅延(latency)を足し直してはいけません。A地点で耳を合わせた
 *    時点で beatOriginSec ごとズラし済みなので、この格子には既に
 *    焼き込まれています。もう一度足すと二重補正になります。
 */
function inheritGridToPhaseB(){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    /*
    Math.ceil は切り上げです。「拍番号0から何拍進めば測り始め位置を
    追い越すか」を切り上げで求めると、その拍が最初の1拍になります。
    */
    const beatsFromOrigin = Math.ceil(
        (tapState.posSec - tapState.beatOriginSec) / beatDur
    );

    /*
    測り始め位置を追い越した最初の拍が「1拍目」で、その8拍先が
    13タップ目です(拍番号9 − 拍番号1 = 8拍)。
    */
    tapState.targetBeat = beatsFromOrigin + (TAP_END_BEAT_NUMBER - 1);

    updateTapTargetTS();

}

/**
 * 狙っている拍の「秒」を計算し直します(v151)。
 *
 * この一手間があるおかげで、微調整でBPMや遅延をいくら動かしても、
 * 耳で合わせたメトロノームの位置と、保存される値が必ず一致します。
 *
 *     秒 = 拍番号0の位置 + 1拍の長さ × 拍番号
 *
 * ⚠️ 逆に言うと、**startTS / endTS を直接書き換えてはいけません。**
 *    beatOriginSec・bpm・targetBeat の3つだけが本物の値で、
 *    startTS / endTS はそこから作られる「結果」です。
 */
function updateTapTargetTS(){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    const ts = tapState.beatOriginSec + beatDur * tapState.targetBeat;

    if(tapState.phase === TAP_PHASE_A){

        tapState.startTS = ts;

    }
    else{

        tapState.endTS = ts;

    }

}

/**
 * 画面右上の「今どちらを測っているか」の表示を更新します。
 */
function updateTapPhaseLabel(){

    tapPhaseLabel.textContent = (tapState.phase === TAP_PHASE_A)
        ? "A地点(曲の頭側)"
        : "B地点(曲の終わり側)";

}

/**
 * 測り始める位置を前後に動かします。
 *
 * @param {number} deltaSec - 動かす秒数(+で後ろ、-で前)
 */
function nudgeTapPosition(deltaSec){

    // まだ曲を読み込めていない間は、動かす先が分からないので何もしません
    if(!tapState.songBuffer){ return; }

    // タップを始めた後は動かせません(測り直しになるため)
    if(tapState.taps.length > 0){ return; }

    const maxSec = Math.max(0,tapState.songBuffer.duration - TAP_TAIL_MARGIN_SEC);

    let next = tapState.posSec + deltaSec;

    if(next < 0){ next = 0; }
    if(next > maxSec){ next = maxSec; }

    // 端に着いていて動かないなら、鳴らし直さずに済ませます
    if(next === tapState.posSec){ return; }

    tapState.posSec = next;

    updateTapPosLabel();

    playTapSongFrom(tapState.posSec,false);

}

function updateTapPosLabel(){

    tapPosLabel.textContent = formatTapTime(tapState.posSec) + " から";

}

/**
 * 秒数を「3:14」の形にします。
 */
function formatTapTime(sec){

    const whole = Math.floor(sec);
    const m = Math.floor(whole / 60);
    const s = whole % 60;

    return m + ":" + String(s).padStart(2,"0");

}


// ==========================================================
// 7. 曲を鳴らす / メトロノームを重ねる
// ==========================================================
/**
 * 曲を指定の秒数から鳴らします。
 *
 * @param {number} fromSec      - 曲の何秒目から鳴らすか
 * @param {boolean} withMetronome - メトロノームを重ねるか
 */
function playTapSongFrom(fromSec,withMetronome){

    if(!tapState.songBuffer){ return; }

    stopTapSound();

    /*
    AudioBufferSourceNode は「使い捨て」の部品です。一度 start() したら
    二度と使えないので、鳴らすたびに作り直します(これはWeb Audioの決まり)。
    */
    const source = tapState.audioCtx.createBufferSource();

    source.buffer = tapState.songBuffer;

    /*
    音量つまみも、鳴らすたびに新しく作ります(v156)。

    【なぜ1つを使い回さないのか】
    止める音と鳴らし始める音が、同じつまみを取り合ってしまうためです。
    止める側は「音量を0へ下げてから止めたい」、始める側は「0から
    上げたい」ので、つまみが1つだと、片方の指示がもう片方を打ち消して
    しまい、けっきょく段差(ノイズ)が残ります。

    1本ずつ専用のつまみを持たせれば、消えていく音と鳴り始める音が
    それぞれ自分の都合で上下でき、なめらかに入れ替われます。

    ※ メトロノームはこのつまみを通しません(曲だけを控えめにするため)。
    */
    const gain = tapState.audioCtx.createGain();

    source.connect(gain);
    gain.connect(tapState.audioCtx.destination);

    const now = tapState.audioCtx.currentTime;

    /*
    音量0から始めて、TAP_FADE_SEC かけて本来の大きさまで上げます。
    これが「ブッ」というノイズを消す本体です。
    */
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(TAP_SONG_GAIN,now + TAP_FADE_SEC);

    tapState.songSource = source;
    tapState.songGain = gain;
    tapState.ctxStartTime = now;
    tapState.playOffset = fromSec;

    // 第1引数は「いつ鳴らすか」、第2引数は「曲の何秒目から鳴らすか」
    source.start(0,fromSec);

    if(withMetronome){
        scheduleTapMetronome();
    }

}

/**
 * メトロノームを、拍の格子に合わせて先まで予約します。
 *
 * 【なぜ「予約」なのか】
 * setInterval で鳴らすと、画面の描き直しなど他の処理に押されて
 * 数十ミリ秒ずれます。それではタップ補正の道具になりません。
 * Web Audio は「この時刻に鳴らせ」と先に予約でき、その時刻は
 * 音のハードウェアが守ってくれるので、ずれません。
 */
function scheduleTapMetronome(){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    const offset = tapState.playOffset;

    /*
    今鳴らし始めた位置より後にある、最初の拍を求めます。

    Math.ceil は「切り上げ」です。「原点から何拍ぶん進めば
    再生位置を追い越すか」を切り上げで求め、その拍から予約を始めます。
    */
    const beatsFromOrigin = Math.ceil((offset - tapState.beatOriginSec) / beatDur);

    let t = tapState.beatOriginSec + beatsFromOrigin * beatDur;

    const until = offset + TAP_METRONOME_WINDOW_SEC;

    while(t < until){

        // 曲の時刻 t は、audioCtx の時刻でいうといつか
        scheduleTapTick(tapState.ctxStartTime + (t - offset));

        t = t + beatDur;

    }

}

/**
 * カチッという音を1つ、指定の時刻に予約します。
 */
function scheduleTapTick(atCtxTime){

    // すでに過ぎた時刻は予約できません
    if(atCtxTime <= tapState.audioCtx.currentTime){ return; }

    const osc = tapState.audioCtx.createOscillator();
    const gain = tapState.audioCtx.createGain();

    osc.type = TAP_CLICK_TYPE;
    osc.frequency.setValueAtTime(TAP_CLICK_HZ,atCtxTime);

    /*
    音量をすとんと落として「カチッ」という短い音にします。

    exponentialRampToValueAtTime は「その時刻に向けて、なめらかに
    音量を変える」命令です。0にはできない決まりなので、0.001という
    ほぼ無音の値まで落としています。
    */
    gain.gain.setValueAtTime(TAP_CLICK_GAIN,atCtxTime);
    gain.gain.exponentialRampToValueAtTime(0.001,atCtxTime + TAP_CLICK_SEC);

    osc.connect(gain);
    gain.connect(tapState.audioCtx.destination);

    osc.start(atCtxTime);
    osc.stop(atCtxTime + TAP_CLICK_SEC + 0.02);

    tapState.scheduledTicks.push(osc);

}

/**
 * 鳴っている曲と、予約済みのメトロノームを全部止めます。
 */
function stopTapSound(){

    if(tapState.songSource){

        /*
        いきなり止めると、音の波の途中でぶつ切りになって「ブッ」と鳴ります
        (鳴らし始める時と同じ理屈。v156)。ほんの一瞬で音量を0まで
        落とし、落ちきってから止めます。
        */
        const ctx = tapState.audioCtx;
        const gain = tapState.songGain;

        if(ctx && gain){

            const now = ctx.currentTime;
            const stopAt = now + TAP_FADE_SEC;

            /*
            鳴らし始めた時のフェードイン予約が残っていると、音量が
            上がり続けてしまいます。先に取り消し、今の音量を起点にして
            0へ向かわせます。
            */
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value,now);
            gain.gain.linearRampToValueAtTime(0,stopAt);

            try{ tapState.songSource.stop(stopAt); }
            catch(error){ /* すでに止まっている場合は何もしなくてよい */ }

        }
        else{

            // つまみが無い時(閉じた後など)は、そのまま止めます
            try{ tapState.songSource.stop(); }
            catch(error){ /* 同上 */ }

        }

        /*
        ここで手放しても、止まる時刻を予約済みの音は最後まで鳴り切ります
        (Web Audioが、鳴っている音を勝手に消さないでいてくれます)。
        */
        tapState.songSource = null;
        tapState.songGain = null;

    }

    /*
    予約した音は「予約しただけ」ではまだ鳴っていないので、
    1つずつ止めて取り消します。これを忘れると、画面を切り替えた後も
    カチカチ鳴り続けます(移植元がゾンビ音と呼んでいた現象)。
    */
    tapState.scheduledTicks.forEach(function(osc){
        try{ osc.stop(); }
        catch(error){ /* 同上 */ }
    });

    tapState.scheduledTicks = [];

}


// ==========================================================
// 8. タップを受け取る
// ==========================================================

tapZone.addEventListener("pointerdown",function(event){

    if(tapState.locked){ return; }
    if(!tapState.songBuffer){ return; }

    /*
    preventDefault は「ブラウザの標準の反応をしないで」という命令です。
    これが無いと、素早く連打した時に画面の拡大や文字選択が起きて
    タップが1回分取りこぼされることがあります。
    */
    event.preventDefault();

    /*
    「曲の何秒目を叩いたか」を求めます。

      audioCtx.currentTime - ctxStartTime … 鳴らし始めてから何秒たったか
      + playOffset                        … 曲の何秒目から鳴らし始めたか
    */
    const songTime =
        (tapState.audioCtx.currentTime - tapState.ctxStartTime) + tapState.playOffset;

    tapState.taps.push(songTime);

    tapCountLabel.textContent = tapState.taps.length + " / " + TAP_TOTAL_COUNT;

    if(tapState.taps.length >= TAP_TOTAL_COUNT){

        /*
        12回目でロックします(竹弘の仕様「12タップ自動ロック」)。
        13回目以降を物理的に受け付けないようにして、叩きすぎによる
        測り直しを防ぎます。
        */
        tapState.locked = true;

        // 蓋・進むボタン・やり直すボタンをまとめて出します
        setTapLockUI(true);

        stopTapSound();

    }

});


// ==========================================================
// 9. ★中核 ── タップから拍の格子を割り出す
// ==========================================================
/**
 * 採用8タップを「等間隔に並ぶ拍」に当てはめて、
 * 1拍の長さと拍の位置を割り出します。
 *
 * ------------------------------------------------------------------
 * 【なぜ単純な平均ではいけないのか】
 *
 * 移植元は「隣どうしの間隔を全部足して割る」という書き方でしたが、
 * この式は途中が打ち消し合うため、数学的には
 *
 *     (最後のタップ - 最初のタップ) ÷ 7
 *
 * と完全に同じです。**間の6タップは結果に1ミリも効いていません。**
 * つまり端の2回のどちらかをしくじると、BPMも拍の位置も丸ごと崩れます。
 *
 * 竹弘の仕様にある「②異常値ガード(叩き漏れによる突飛な数値は自動で
 * 除外)」は、移植元では実装されていませんでした。ここで実装します。
 *
 * ------------------------------------------------------------------
 * 【やっていること(絵で言うと)】
 *
 * 横を「何拍目か」、縦を「叩いた時刻」にしたグラフを思い浮かべます。
 * テンポが一定なら、8つの点はきれいに一直線に並びます。
 * そこへ「どの点からも遠くならない1本の直線」を引く ── これだけです。
 * (最小二乗法と呼ばれる、昔からある当てはめ方)
 *
 *     線の傾き        = 1拍の長さ → BPM
 *     線を左へ伸ばす  = 0拍目(曲を繋ぐ時に使う)
 *     線を右へ伸ばす  = 13タップ目(endTS。曲の接続点)
 *
 * 8つ全部が線を引っぱるので、1つ2つ暴れても残りが押さえてくれます。
 *
 * ------------------------------------------------------------------
 * 【叩き漏れ・二度押しの見分け方】
 *
 * 先に「間隔のまんなかの値(中央値)」を出します。平均と違い、
 * 中央値は変な値が1つ2つ混じっても動きません。これを1拍の目安にして、
 * 各間隔がその何倍かを見ます。
 *
 *     約2倍 … 1回叩き漏れた → 拍番号を1つ飛ばして数え直す
 *     ほぼ0 … 二度押し       → その1回だけ捨てる
 *
 * 叩き漏れた回を「捨てる」のではなく「1拍抜けた」と読み替えるので、
 * 残りのタップはすべて活かせます。
 *
 * @param  {number[]} taps - 採用するタップ時刻の配列(秒)
 * @return {{beatDur:number, origin:number}|null}
 *         beatDur … 1拍の長さ(秒)
 *         origin  … 拍番号0の位置(秒)
 *         測れなかった時は null
 */
function fitTapBeatGrid(taps){

    if(taps.length < 2){ return null; }

    // ---- 1. 隣どうしの間隔 ----
    const gaps = [];

    for(let i = 1; i < taps.length; i++){
        gaps.push(taps[i] - taps[i - 1]);
    }

    // ---- 2. 間隔のまんなかの値(中央値) ----
    /*
    slice() で複製してから並べ替えています。元の配列を並べ替えて
    しまうと、タップの順番が壊れてしまうためです。
    */
    const sorted = gaps.slice().sort(function(a,b){ return a - b; });

    const median = (sorted.length % 2 === 1)
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    /*
    まんなかの値が短すぎる時は、連打などで測定になっていません。
    1拍0.1秒 = 600BPM より速いのはあり得ないので、そこで見切ります。
    */
    if(!isFinite(median) || median < 0.1){ return null; }

    // ---- 3. 各タップに拍番号を振る ----
    /*
    採用8タップの1回目を「1拍目」とします。竹弘の仕様に合わせた
    数え方で、startTS がこの1拍目、endTS が13タップ目(=9拍目)です。
    */
    const beatNumbers = [1];
    const beatTimes = [taps[0]];

    let beat = 1;

    for(let i = 0; i < gaps.length; i++){

        // この間隔は何拍分か(四捨五入)
        const steps = Math.round(gaps[i] / median);

        if(steps <= 0){

            /*
            二度押しです。拍番号を進めず、このタップを捨てます。

            捨てても次の間隔は「捨てた点から次の点まで」で測られますが、
            捨てた点は直前の点とほぼ同じ位置なので、拍数の判定は
            変わりません。
            */
            continue;

        }

        beat = beat + steps;

        beatNumbers.push(beat);
        beatTimes.push(taps[i + 1]);

    }

    if(beatNumbers.length < 2){ return null; }

    // ---- 4. 直線を当てはめる(最小二乗法) ----
    /*
    求めたいのは、次の式の beatDur と origin です。

        叩いた時刻 = origin + beatDur × 拍番号

    高校で習う「回帰直線」と同じ計算で、合計を4つ出すだけで解けます。

        n     … 点の数
        sumN  … 拍番号の合計
        sumT  … 時刻の合計
        sumNN … 拍番号×拍番号 の合計
        sumNT … 拍番号×時刻   の合計
    */
    const n = beatNumbers.length;

    let sumN = 0;
    let sumT = 0;
    let sumNN = 0;
    let sumNT = 0;

    for(let i = 0; i < n; i++){

        sumN = sumN + beatNumbers[i];
        sumT = sumT + beatTimes[i];
        sumNN = sumNN + beatNumbers[i] * beatNumbers[i];
        sumNT = sumNT + beatNumbers[i] * beatTimes[i];

    }

    const denominator = n * sumNN - sumN * sumN;

    /*
    分母が0になるのは、全部の点が同じ拍番号だった時だけです。
    実際には起こりませんが、0で割ると計算が壊れるので保険をかけます。
    */
    if(denominator === 0){ return null; }

    const beatDur = (n * sumNT - sumN * sumT) / denominator;
    const origin = (sumT - beatDur * sumN) / n;

    if(!isFinite(beatDur) || beatDur <= 0){ return null; }

    console.log(
        "タップ解析 :",
        "採用" + n + "点 /",
        "1拍" + beatDur.toFixed(4) + "秒 /",
        "BPM " + (60 / beatDur).toFixed(2)
    );

    return { beatDur: beatDur, origin: origin };

}

/**
 * 「微調整画面へ進む」が押された時の処理です。
 */
function goToTapAdjust(){

    // 採用するのは5回目〜12回目の8回です
    const adopted = tapState.taps.slice(TAP_DISCARD_COUNT);

    const grid = fitTapBeatGrid(adopted);

    if(!grid){

        setTapGuide("うまく測れませんでした。もう一度タップしてください。");

        resetTapPhase();

        return;

    }

    tapState.bpm = 60 / grid.beatDur;
    tapState.beatOriginSec = grid.origin;

    // 測れたので、ここから画面に数字を出します(v155)
    tapState.measured = true;

    /*
    測った直線の、どの拍を狙うかを決めます(v150-v151)。

      A地点 … 1拍目(拍番号1)     → startTS
      B地点 … 13タップ目(拍番号9)→ endTS。曲の接続点

    どちらも「同じ1本の線を、どこまで伸ばすか」の違いでしかありません。
    叩いていない13タップ目の位置が分かるのは、線を引いてあるからです。
    */
    tapState.targetBeat = (tapState.phase === TAP_PHASE_A)
        ? 1
        : TAP_END_BEAT_NUMBER;

    updateTapTargetTS();

    /*
    前回この端末で合わせた遅延を、そのまま当てておきます。

    遅延はイヤホンの性質なので、曲が変わっても同じ値のはずです。
    1曲目で合わせておけば、2曲目以降は最初から合った状態で
    始められます(369曲を測ることを考えると、この差は大きい)。
    */
    applyTapLatencyShift(tapState.latencyMs);

    showTapAdjustPanel(
        "メトロノームと曲のリズムがぴったり重なるまで、下のボタンで調整してください。",
        tapState.playOffset
    );

}

/**
 * 微調整画面に切り替えて、メトロノームを重ねて鳴らします。
 *
 * ここへ来る道は2つあり、共通の後始末をこの関数にまとめています(v151)。
 *
 *   1. 12回タップし終えた時(goToTapAdjust)
 *   2. B地点でA地点の値を引き継いだ時(startTapPhaseB)
 *
 * @param {string} guideText - 画面に出す案内文(道によって変わります)
 * @param {number} fromSec   - 曲の何秒目から鳴らし直すか
 */
function showTapAdjustPanel(guideText,fromSec){

    tapZone.style.display = "none";
    tapPosRow.style.display = "none";
    setTapLockUI(false);
    setTapAdjustUI(true);

    setTapGuide(guideText);

    // 確定ボタンの文言は、今どちらの地点かで変わります
    updateTapConfirmLabel();

    updateTapMonitor();

    // ここからはメトロノームを重ねて鳴らします
    playTapSongFrom(fromSec,true);

}


// ==========================================================
// 10. 微調整
// ==========================================================
/**
 * メトロノームの速さを変えます。
 */
function adjustTapBpm(delta){

    tapState.bpm = tapState.bpm + delta;

    if(tapState.bpm < 20){ tapState.bpm = 20; }
    if(tapState.bpm > 400){ tapState.bpm = 400; }

    /*
    1拍の長さが変わったので、狙っている拍の位置も計算し直します(v151)。

    これが無いと、メトロノームだけが動いて保存される値が取り残されます。

    ズレる量は「拍番号 × 1拍の長さの変化」なので、**曲の長さとテンポに
    よって変わります**(竹弘の指摘、2026-08-30)。A地点は1拍先しか
    見ていないので無視できますが、B地点の引き継ぎは数百拍先を指すため、
    BPMを0.1動かすだけで接続点が0.1秒ほど動くこともあります。

    向きは「BPMを上げる=曲が速くなる」ので、拍の間隔が詰まって
    13拍目は手前へ動きます。
    */
    updateTapTargetTS();

    updateTapMonitor();

    playTapSongFrom(tapState.playOffset,true);

}

/**
 * Bluetoothの遅延を調整します。
 *
 * ------------------------------------------------------------------
 * 【何を直しているのか】
 *
 * Bluetoothイヤホンでは、アプリが音を出してから耳に届くまで
 * 0.2秒ほど遅れます。竹弘は「遅れて聞こえた音」に合わせて叩くので、
 * 記録される拍の位置も、その分だけ遅い値になっています。
 *
 * さらにメトロノームも同じだけ遅れて届くため、耳の中では
 * **遅延が二重に開いて**聞こえます。竹弘の言う
 * 「おれこんなタイミングで叩いてないよー」がこれです。
 *
 * このボタンで拍の位置そのものをずらし、耳で合うところまで
 * 追い込みます。合った時点の値が「その曲の本当の拍の位置」です。
 *
 * 【なぜ拍の位置に直接足し込むのか(焼き込み)】
 *
 * 再生する時は、曲もメトロノームも同じだけ遅れて耳に届くので、
 * 相対的なズレは出ません。つまり**補正が必要なのは測る時の一度だけ**で、
 * 合わせ終わった値をそのまま保存するのが正解です。
 *
 * 遅延の数値そのものも settings に残しますが、それは
 * 「次に別の曲を測る時の初期値」として使うためです。
 * ------------------------------------------------------------------
 */
function nudgeTapLatency(deltaMs){

    tapState.latencyMs = tapState.latencyMs + deltaMs;

    applyTapLatencyShift(deltaMs);

    updateTapMonitor();

    playTapSongFrom(tapState.playOffset,true);

}

/**
 * 拍の位置を、指定したミリ秒だけずらします。
 */
function applyTapLatencyShift(deltaMs){

    const deltaSec = deltaMs / 1000;

    /*
    動かすのは拍の基準(拍番号0の位置)だけです。
    ここを動かせば、メトロノームも狙っている拍も、まとめてズレます。
    */
    tapState.beatOriginSec = tapState.beatOriginSec + deltaSec;

    // 基準が動いたので、狙っている拍の秒も計算し直します(v151)
    updateTapTargetTS();

}

/**
 * 「確定」ボタンの文言を、今どちらを測っているかに合わせます。
 *
 * A地点の確定は「次(B地点)へ進む」であって作業の終わりではないので、
 * 同じ「これで確定」だと、ここで終わったと勘違いしてしまいます。
 */
function updateTapConfirmLabel(){

    tapConfirmBtn.textContent = (tapState.phase === TAP_PHASE_A)
        ? "A地点を確定 → B地点へ"
        : "これで確定(ノリ注入)";

}


// ==========================================================
// 11. 表示の更新
// ==========================================================

function updateTapMonitor(){

    /*
    まだ測っていない間は、数字を出しません(v155)。

    ここで前の曲の値を出してしまうと、その曲を測った結果のように
    見えてしまいます(竹弘の指摘、2026-08-30)。HTMLの初期表示と
    同じ「---.--」に戻すことで、「まだ測っていない」と一目で分かります。

    自動解析の値(baseBPM)を代わりに出す案もありましたが、未解析の曲には
    登録時の120が入っているだけで実際のテンポではないため、
    かえって別の誤解を生むと判断しました(のりの提案、竹弘が採用)。
    */
    const label = (tapState.phase === TAP_PHASE_A) ? "1拍目 " : "13拍目 ";

    if(!tapState.measured){

        tapBpmDisplay.textContent = "---.--";
        tapTsDisplay.textContent = label + "--.---s";

    }
    else{

        tapBpmDisplay.textContent = tapState.bpm.toFixed(2);

        /*
        出す数字は、今どちらを測っているかで変わります(v150)。
        A地点は1拍目、B地点は13拍目(曲の接続点)です。
        */
        tapTsDisplay.textContent = (tapState.phase === TAP_PHASE_A)
            ? label + tapState.startTS.toFixed(3) + "s"
            : label + tapState.endTS.toFixed(3) + "s";

    }

    /*
    遅延だけは、測る前から数字を出します。
    イヤホンの性質であって曲の性質ではなく、前に合わせた値がそのまま
    使えるためです(次に測る曲の初期値として引き継いでいます)。
    */
    tapLatDisplay.textContent = "Bluetoothの遅延 " + tapState.latencyMs + "ms";

}

function setTapGuide(text){

    tapGuide.textContent = text;

}

/**
 * 画面の下から数秒だけ出るお知らせです。
 *
 * alert を使わないのは、押されるまでJavaScriptが丸ごと止まるためです
 * (v129でこのアプリ全体から撤去した方針に合わせています)。
 */
let tapToastTimer = null;

function showTapToast(message){

    tapToast.textContent = message;
    tapToast.classList.add("tap-toast-on");

    // 続けて押された時に、前のタイマーが先に消してしまわないようにします
    if(tapToastTimer){ clearTimeout(tapToastTimer); }

    tapToastTimer = setTimeout(function(){
        tapToast.classList.remove("tap-toast-on");
    },2600);

}


// ==========================================================
// 12. 遅延の保存と読み込み(アプリ共通の設定)
// ==========================================================
/*
Bluetoothの遅延は「イヤホンの性質」であって曲の性質ではないので、
曲ごとではなく settings ストアに1つだけ持ちます(竹弘の判断)。
イヤホンを変えた時も、ここを1回直せば以後に測る曲すべてに効きます。

キー名 latency は、初期設定(js/setup.js)が最初から書き込んでいた
ものをそのまま使います。
*/

async function loadTapLatency(){

    try{

        const saved = await idbGet(STORE_SETTINGS,"latency");

        if(typeof saved === "number" && isFinite(saved)){ return saved; }

    }
    catch(error){

        console.error("遅延設定の読み込みに失敗 :",error.name,error.message);

    }

    return 0;

}

async function saveTapLatency(){

    try{

        await idbPut(STORE_SETTINGS,tapState.latencyMs,"latency");

    }
    catch(error){

        console.error("遅延設定の保存に失敗 :",error.name,error.message);

    }

}


// ==========================================================
// 13. 画面の開け閉め
// ==========================================================

function showTapScreen(){

    tapSongLabel.textContent = tapState.track.title || tapState.track.file_name;

    updateTapPhaseLabel();

    /*
    パネルの見せ方を、開いた直後の状態に戻しておきます。

    前回この画面を微調整の途中で閉じていると、その表示が残ったままに
    なります。曲の読み込みが終わるまで resetTapPhase() は動かないので、
    その数秒間だけ前回の微調整パネルが見えてしまう、という
    分かりにくい残像を防ぐための後始末です。
    */
    setTapLockUI(false);
    setTapAdjustUI(false);
    tapZone.style.display = "flex";
    tapPosRow.style.display = "flex";
    tapCountLabel.textContent = "READY";

    /*
    数字も「---.--」に戻してから画面を出します(v155)。

    ⚠️ ここを忘れると、**曲を読み込んでいる数秒のあいだ**だけ前の曲の
       値が残って見えます。この関数は重い読み込みを始める前に呼ばれ、
       数字を書き換えるのは読み込みが終わってからだからです。
       画面の部品は使い回しなので、消さない限り前回の表示が残ります。
    */
    updateTapMonitor();

    tapScreen.style.display = "block";
    document.getElementById("app").style.display = "none";

}

/**
 * タップ補正画面を閉じて、メインメニューへ戻ります。
 */
function closeTapCorrection(){

    stopTapSound();

    /*
    ---- 音の作業台(AudioContext)は閉じません(v157) ----

    以前はここで close() していましたが、それが「画面を閉じた後、
    次に音を鳴らした時にブッと鳴る」原因でした(竹弘の観察、2026-08-30)。
    閉じるとスマホのオーディオ出力ごと止まり、イヤホンがアンプを切って
    しまうため、次の音で復帰する時に鳴ってしまいます。

    詳しい理由は getTapAudioContext() のコメントに書いてあります。
    作業台は1つしか作らないので、開いたままでも増えていきません。

    ⚠️ 重い波形データ(約80MB)の方は、ここで必ず手放します。
       こちらを持ち続けるとメモリを食い潰します。
    */

    tapState.songBuffer = null;
    tapState.songGain = null;
    tapState.track = null;
    tapState.trackId = null;
    tapState.taps = [];
    tapState.locked = false;

    /*
    メインメニューへ戻します。

    showMainMenu() は曲一覧の読み込み(369曲)からやり直す起動用の
    重い処理なので呼びません。表示の切り替えだけにします
    (マイピッチ設定と同じ考え方)。
    */
    tapScreen.style.display = "none";
    document.getElementById("app").style.display = "flex";

    // 開く前に鳴っていた曲を、続きから鳴らし直します
    if(tapState.wasPlaying){

        tapState.wasPlaying = false;

        const resumed = audioPlayer.play();

        if(resumed && typeof resumed.catch === "function"){

            resumed.catch(function(error){

                console.error(
                    "タップ補正から戻った時の再生再開に失敗 :",
                    error.name,
                    error.message
                );

            });

        }

    }

}

/**
 * 測った結果を、その曲のデータとして保存します(v150で実装)。
 *
 * 保存するのは次の3つです。遅延(latency)はイヤホンの性質であって
 * 曲の性質ではないので、ここではなく settings に別途保存します。
 *
 *     manualBPM … 耳で測ったその曲のテンポ
 *     startTS   … A地点の1拍目
 *     endTS     … B地点の13拍目(曲の接続点)
 *
 * ⚠️ 遅延の補正は測定中にタイムスタンプへ焼き込み済みです。
 *    再生する時にもう一度ずらしてはいけません(二重補正になります)。
 *
 * @return {boolean} 保存できたら true
 */
async function saveTapResult(){

    const track = libraryMap[tapState.trackId];

    if(!track){ return false; }

    try{

        track.manualBPM = tapState.bpm;
        track.startTS = tapState.startTS;
        track.endTS = tapState.endTS;

        await idbPut(STORE_MUSIC,track);

        console.log(
            "タップ補正の結果を保存しました :",
            track.file_name,
            "/ BPM " + tapState.bpm.toFixed(2),
            "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
            "/ 13拍目 " + tapState.endTS.toFixed(3) + "s",
            "/ 遅延 " + tapState.latencyMs + "ms"
        );

        return true;

    }
    catch(error){

        console.error(
            "タップ補正の結果の保存に失敗 :",
            track.file_name,
            error.name,
            error.message
        );

        return false;

    }

}

/**
 * 「確定」が押された時の処理です。
 *
 * A地点なら、そのままB地点の測定へ進みます。
 * B地点まで終わっていれば、保存して🛌→🕺にし、画面を閉じます。
 */
async function confirmTapPhase(){

    // 遅延は次の曲を測る時の初期値になるので、どちらの地点でも保存します
    await saveTapLatency();

    if(tapState.phase === TAP_PHASE_A){

        console.log(
            "A地点を確定しました :",
            "BPM " + tapState.bpm.toFixed(2),
            "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
            "/ 遅延 " + tapState.latencyMs + "ms"
        );

        startTapPhaseB();

        return;

    }

    /*
    ここから下はB地点の確定 ＝ この曲のノリ注入の仕上げです。

    【順番が大事】
    値の保存に成功してから🕺の印を付けます。逆にすると、保存が
    失敗した時に「🕺なのに補正データが無い曲」ができてしまいます。
    */
    const saved = await saveTapResult();

    if(!saved){

        showTapToast("保存に失敗しました。もう一度お試しください");

        return;

    }

    /*
    閉じると tapState.trackId は空になるので、先に控えておきます。
    このあと曲一覧の行を作り直すのに使います。
    */
    const finishedTrackId = tapState.trackId;

    /*
    🛌 → 🕺 の印を付けます(js/nori.js)。

    ボタン本体は渡しません。この画面から呼ぶ時は曲一覧が隠れており、
    押されたボタンを持っていないためです。表示は下の refreshRow() で
    まとめて作り直します。
    */
    await markNoriInjected(finishedTrackId);

    showTapToast(
        "ノリを注入しました BPM " + tapState.bpm.toFixed(2) +
        " / 接続点 " + tapState.endTS.toFixed(3) + "s"
    );

    closeTapCorrection();

    /*
    曲一覧のその行だけを作り直して、🛌 を 🕺 に変えます。

    renderList() で全部作り直さないのは、369行を描き直すと重いうえ、
    スクロール位置が先頭へ飛んでしまうためです(js/list-view.js)。
    */
    refreshRow(finishedTrackId);

}


// ==========================================================
// 14. ボタンをつなぐ
// ==========================================================

document.getElementById("tap-pos-back").onclick = function(){
    nudgeTapPosition(-TAP_POS_STEP_SEC);
};

document.getElementById("tap-pos-fwd").onclick = function(){
    nudgeTapPosition(TAP_POS_STEP_SEC);
};

document.getElementById("tap-to-adjust").onclick = goToTapAdjust;
tapRetryLock.onclick = resetTapPhase;
tapRetryAdjust.onclick = resetTapPhase;
tapConfirmBtn.onclick = confirmTapPhase;
document.getElementById("tap-close").onclick = closeTapCorrection;

/*
BPMと遅延の調整ボタンは数が多いので、1つずつ書かずにまとめてつなぎます。

data-bpm / data-lat という目印をHTMLに書いておき、その値を読んで
同じ処理に渡す形です。ボタンを増やしたい時はHTMLに1行足すだけで済みます。
*/
tapAdjustPanel.querySelectorAll("[data-bpm]").forEach(function(button){

    button.onclick = function(){
        adjustTapBpm(Number(button.dataset.bpm));
    };

});

tapAdjustPanel.querySelectorAll("[data-lat]").forEach(function(button){

    button.onclick = function(){
        nudgeTapLatency(Number(button.dataset.lat));
    };

});
