/*
================================================================
 sync.js … みんなで走る同期モード(追加1。v221で新設)

----------------------------------------------------------------------

【何をする機能か】

 一緒に走る人と**同じマイピッチ**を設定し、**曲のスタート時刻を
 決めて**同時に再生します。お互い好きな曲を聴きながら、一緒に
 同じノリで走れます。

     条件 … ノリ注入済みの曲 / 🕺ノリノリRun再生モード
     色   … 暁色(ノリノリRunの機能なので)

 竹弘が最優先と決めた機能です(2026-09-21):

     「ノリRunでしかできない機能なので、モチベーションと
       アプリの存在意義につながる為」

 📘 **仕様の全文は CLAUDE.md の「追加1」の中の「✅✅ 2026-09-22
    竹弘と詰めた仕様」が正**です。ここには作りの要点だけ書きます。

----------------------------------------------------------------------

【流れ(順を追って1つずつ表示する)】

     ① みんなで走るピッチ … 定規で決める。「決定」で灰色にロック
     ② Bluetooth遅延     … ピッに合わせて12回タップして測る
     ③ 曲開始時刻ボタン   … 10秒刻みの時刻を4つ並べる
     ④ 薄暗いロック画面   … 音量ボタン以外の操作を止める

 1機能ずつ実機で確かめる決まりに合わせて、4段に分けて作ります。

     段①(v221) … 画面の開け閉め・入った時の一時停止・①ピッチ
     段②(v222) … ②Bluetooth遅延の測定と保存
          (v223) … ターンテーブルの作り込み(モニタ・「く」の字アーム・
                    ノブ・フェーダー・サンプラー・暁色の仲間の色)と、
                    前回と大きく違う時の一言
     段③(v224) … ③時刻ボタンと、その時刻に拍を揃えたスタート ← いまここ
     段④        … ④薄暗いロック画面・イヤホン操作・時刻からの再開

----------------------------------------------------------------------

【なぜ2台がズレずに揃うのか(段③で使う考え方。先に書いておきます)】

 同じマイピッチなら、2台の歩調は永久に同じ速さです。揃える必要が
 あるのは「どの瞬間を拍にするか」だけで、それは**時計**で決めます。

     拍の格子 = 開始時刻T + 1拍の長さ × n

 ずれる原因は2つありましたが、どちらも片付いています。

   ・2台の時計のズレ … 竹弘が3台で実測して最大0.022秒(対策不要)
   ・Bluetoothの遅れ … 各スマホが**自分の遅れのぶんだけ早く音を出す**。
                         全員の耳に、時刻ちょうどに届く
                         (遠い人ほど早く家を出れば、全員が時刻どおりに
                           着く ―― 竹弘と合意した考え方)
================================================================
*/


// ==========================================================
// 1. 決まった数値
// ==========================================================

/*
定規で選べるピッチの下限と上限です。

初期設定の定規(js/setup.js の minBpm / maxBpm)と同じ 100〜250 に
しています。**みんなで決める値も、ふだんのマイピッチと同じ範囲で
選べる**ようにするためです。

⚠️ setup.js の値は、あのファイルの中に閉じ込めてあって(IIFE)
   外から読めないため、ここにも書いています。範囲を変える時は
   両方を直すこと。
*/
const SYNC_PITCH_MIN = 100;
const SYNC_PITCH_MAX = 250;

/*
定規を触った時に鳴らす「テンポの音」の予約の仕方です。

    SYNC_TEMPO_TIMER_MS      … 何ミリ秒ごとに予約の見回りをするか
    SYNC_TEMPO_LOOKAHEAD_SEC … 見回りのたびに、何秒先までの音を予約するか

【なぜ「先に予約」するのか】

setTimeout や setInterval は、スマホが忙しいと数十ミリ秒遅れることが
あります。その時刻に「今鳴らして」と命令すると、音の間隔がガタガタに
なります。

Web Audio は「◯秒後にこの音を鳴らして」と**予約**でき、予約した音は
音を作る側が正確な時刻に鳴らします。見回りが多少遅れても、少し先まで
予約してあれば音はずれません(js/metronome.js と同じ考え方)。

見回りの間隔(25ms)より十分長く先まで予約しておく(120ms)のがコツです。
*/
const SYNC_TEMPO_TIMER_MS = 25;
const SYNC_TEMPO_LOOKAHEAD_SEC = 0.12;

/*
定規に触ってから最初の音が鳴るまでの間(秒)です。

「今この瞬間」に予約すると、予約が届いた時にはもう過ぎていて、
最初の1打が欠けることがあります。ほんの少し先にしておきます。
*/
const SYNC_TEMPO_FIRST_DELAY_SEC = 0.05;

/*
---- ② Bluetooth遅延の測り方(v222) ----

竹弘の指定(2026-09-22):

    BPM100の電子メトロノーム(ピッ)に合わせて、12回タップしてもらう。
    採用タップはノリ注入と同じ(5回目から12回目)

    SYNC_LATENCY_BPM     … ピッの速さ。100なら0.6秒に1回
    SYNC_LATENCY_TAPS    … 叩いてもらう回数
    SYNC_LATENCY_WARMUP  … 最初の何回を「ならし」として捨てるか
                           (4 = 5回目から使う。ノリ注入と同じ)

【なぜ最初の4回を捨てるのか】

人は最初の数回、音を「聴いてから」叩きます(反応)。何回か続けると
次の音を「予想して」叩くようになり(同期)、タイミングが安定します。
測りたいのは走っている時の足と同じ「予想して踏む」タイミングなので、
安定する前の4回は使いません。
*/
const SYNC_LATENCY_BPM = 100;
const SYNC_LATENCY_TAPS = 12;
const SYNC_LATENCY_WARMUP = 4;

/*
枠を押してから、最初のピッが鳴るまでの間(秒)。

押した指を離して、構え直すための時間です。すぐ鳴らすと、1打目に
間に合わず慌てて叩くことになります(どうせ「ならし」の4回には
入りますが、落ち着いて始められる方が気持ちよく測れます)。
*/
const SYNC_LATENCY_LEAD_SEC = 0.6;

/*
遅延として「ありえる」と考える範囲の下限(ミリ秒)。範囲は
ここから1拍ぶん(BPM100なら600ms)、つまり -150〜450ms です。

【なぜ範囲が要るのか】

ピッは0.6秒ごとに鳴るので、「叩いたのはどのピッに対してか」は
0.6秒ごとに同じ見た目になり、区別できません。たとえば 250ms 遅れて
叩いたのと、350ms **早く**次のピッに向けて叩いたのは、同じ位置です。

そこで「遅延はだいたいこの範囲」と決めて、その中の答えを選びます。

    -150ms … 有線イヤホンで、少し早めに叩く人(人は音を予想して
              わずかに早く叩く癖があります)
     450ms … 遅いBluetoothイヤホン(一般に0.1〜0.3秒程度)にも十分な余裕
*/
const SYNC_LATENCY_WINDOW_MIN_MS = -150;

/*
叩いた8回のばらつき(標準偏差)がこれを超えたら、測り直しを勧めます。

人がメトロノームに合わせて叩くと、ふつう20〜40ms くらいはばらつきます。
8回の平均をとるので、50ms のばらつきでも平均の誤差は 50÷√8 ≒ 18ms に
収まります(接続の合格基準30msの内側)。それを超える時は、途中で
リズムを見失ったなど、測り方そのものがうまくいっていない可能性が
高いので、数字を出したうえで「もう一度」を勧めます。

⚠️ この50は理屈から決めた目安です。竹弘の実機の値を見て、必要なら直すこと。
*/
const SYNC_LATENCY_SPREAD_WARN_MS = 50;

/*
叩き終わらないまま鳴り続けるのを防ぐ、ピッの上限の回数です。

40回 = 24秒。12回叩くには十分すぎる長さで、これを超えたら
「途中で止まりました」と知らせて止めます。
*/
const SYNC_LATENCY_MAX_BEEPS = 40;

/*
続けて叩いたとみなさない間隔(ミリ秒)。

指が画面で跳ねたり、2本の指が同時に触れたりすると、1回のつもりが
2回と数えられます。BPM100(0.6秒おき)に合わせて叩くのに、0.2秒より
短い間隔で叩くことはないので、それより短いものは数えません。
*/
const SYNC_LATENCY_DEBOUNCE_MS = 200;

/*
測った遅延を保存する名前(DB の settings ストア)です。

⚠️ タップ補正の `latency` とは**別の名前**にしています(竹弘と合意、
   2026-09-22)。中身はほぼ同じ量ですが、タップ補正は完成済みの機能で、
   同じ場所を2つの機能が書き換えると、片方の都合でもう片方が変わって
   しまうためです。いずれ繋ぐかどうかは CLAUDE.md のTODOに登録済み。
   📘 docs/db-schema.md の v2.17 を参照。
*/
const SYNC_LATENCY_SETTING_KEY = "sync_latency_ms";

/*
前回の値からこれ以上離れたら「もう一度測ってみて」と勧める差(ミリ秒)。v223。

【竹弘の実測(2026-09-22)から決めた数字】

    同じBluetoothイヤホンで6回 : 432 / 247 / 257 / 283 / 288 / 263

432 だけが飛び抜けていて、ほかの5回(平均約265)との差は約167ms。
これは人が「音を聴いてから反応する」のにかかる時間(約150〜180ms)と
ほぼ同じで、**リズムに乗って叩く代わりに、ピッを聴いてから叩いた回**
だと考えられます(竹弘の言葉では「油断すると400とか出ちゃう」)。

    ふつうの測り直しのばらつき … 5回で 247〜288(幅41ms)
    反応で叩いてしまった時     … +150〜180ms 跳ねる

その間の 80ms を境目にしました。イヤホンを替えた時は本当に値が
変わるので、止めはせず、一言添えるだけにしています。
*/
const SYNC_LATENCY_PREV_WARN_MS = 80;

/*
ターンテーブルの台の幅(px)。v223。

中身は、この幅の台の上に px で置いてあります(c014.html の
「同期モード ② ターンテーブル」の【大きさの決め方】)。画面がこれより
狭い時は、fitSyncDeck() が台ごと縮めます。
⚠️ c014.html の .sync-deck-stage の width と必ず同じ値にすること。
*/
const SYNC_DECK_STAGE_WIDTH = 320;

/*
---- ③ 曲開始時刻(v224) ----

    SYNC_START_GRID_SEC   … 時刻ボタンの刻み(10秒)。2台に同じ時刻が
                            並ぶので「40秒のやつ押そう」と声を掛け合える
    SYNC_CLOCK_TIMER_MS   … 時計・ボタン・カウントダウンを書き換える間隔
*/
const SYNC_START_GRID_SEC = 10;
const SYNC_CLOCK_TIMER_MS = 200;

/*
開始の何秒前から、曲を「音量0・消音」で先に鳴らしておくか。

🎬頭出し接続と同じ考え方です。いきなり鳴らし始めると、鳴り出すまでの
時間(数十ms、端末や曲で違う)が読めません。**先に鳴らして通り道を
温めておき、その時刻には「位置を動かすだけ」にします。** 位置を動かす
だけなら、かかる時間はほぼ決まっています(下の SYNC_SEEK_LEAD_MS)。
*/
const SYNC_WARMUP_SEC = 3;

/*
狙いの位置へ動かす命令(頭出し)を、何ms早く出すか。

頭出しは命令してから終わるまでに時間がかかります。竹弘の実機で
🎬頭出し接続の待ち時間を21回測った値(v203の🐛ログ)が 10〜16ms、
平均14ms でした。その平均の分だけ早く命令して、ちょうどの時刻に
終わるようにします。
⚠️ 実際に何msで終わったかは、スタートのたびに🐛パネルへ出します。
   端末によって違えば、この値を見直します。
*/
const SYNC_SEEK_LEAD_MS = 14;

/*
⚠️ v224の途中まで、ここに SYNC_SPIN_MS(最後の40msを「時計を見張って
   待つ」)がありました。やめた理由は syncFire() の【遅れの打ち消し】。
*/

/*
止めていた曲を「続きから」鳴らすのに、繋ぐ位置まで最低何秒ほしいか。

続きの位置が繋ぐ位置(13拍目)に近すぎると、次の曲へ繋ぐ準備(助走は
15秒前から)が間に合わず、繋がらずに曲が終わってしまいます。そうなると
次の曲が拍と無関係に始まり、**同期がそこで切れます。** 足りない時は、
その曲の頭から鳴らします。
*/
const SYNC_RESUME_MARGIN_SEC = 20;

/*
スタートした後に、曲の位置が予定どおりかを測る回数と間隔です。
結果は🐛パネルに出します(実測で確かめるため)。
*/
const SYNC_MEASURE_COUNT = 10;
const SYNC_MEASURE_INTERVAL_MS = 100;
const SYNC_MEASURE_DELAY_MS = 300;

/*
開始時刻を過ぎても始まらなかった時に、諦めて知らせるまでの時間(ms)。
画面が消えてタイマーが止められた時などの保険です。
*/
const SYNC_LATE_GIVEUP_MS = 2000;


// ==========================================================
// 2. 今の状態
// ==========================================================
/*
同期モードの画面で決めたことを、ここにまとめて持ちます。

⚠️ **ここで決めたピッチは今回だけ使います**(竹弘の判断、2026-09-22)。
   DB の my_pitch(初期設定のマイピッチ)には書き込みません。
   みんなに合わせたピッチなので、自分の基準は残しておくためです。
*/
const syncState = {

    // ①で決めたピッチ(決定を押すまでは使いません)
    pitch: NORIRUN_DEFAULT_PITCH,

    // ①の「決定」が押されているか
    pitchDecided: false,

    /*
    この画面を開いた時に、曲が鳴っていたか。

    閉じる時に「鳴っていた場合だけ」続きから鳴らし直すために覚えます
    (マイピッチ設定 js/setup.js の wasPlayingBeforeMyPitch と同じ考え方)。
    もともと止まっていた曲が、閉じたとたん勝手に鳴り出さないようにします。
    */
    wasPlaying: false,

    // ---- ② Bluetooth遅延(v222) ----

    /*
    ②の枠がいまどの姿か。

        "idle"      … まだ測っていない(枠を押すと測りはじめる)
        "measuring" … ピッが鳴っていて、タップを数えている
        "done"      … 値が出ている(測った直後、または前回の値)
    */
    latencyPhase: "idle",

    // 遅延の値(ミリ秒の整数)。まだ無ければ null
    latencyMs: null,

    // 叩いた8回のばらつき(ミリ秒)。前回の値を読んだだけの時は null
    latencySpreadMs: null,

    // 今の値が「前回保存した値」か(true)、「今測った値」か(false)
    latencyFromSaved: false,

    /*
    前回保存した値(比べるための控え。v223)。まだ無ければ null。

    測り直した値がこれから大きく離れていたら、一言添えます
    (SYNC_LATENCY_PREV_WARN_MS のコメント)。
    */
    latencyPrevMs: null,

    // ②の「決定」が押されているか
    latencyDecided: false,

    // 枠の中に一時的に出す知らせ(途中で止まった時など)。無ければ空
    latencyNotice: "",

    // ---- ③ 曲開始時刻(v224) ----

    /*
    ③の準備で、開いた時と**違う曲**を載せたか。

    ✕で閉じた時は「開いた時に鳴っていた曲を続きから鳴らす」決まり
    ですが、その曲をもう載せ替えてしまっていたら、鳴らし直すと
    知らない曲が鳴り出します。その時は鳴らし直さないために覚えます。
    */
    trackChanged: false,

    // 同期スタートした後か(段④の薄暗いロック画面で使います)
    running: false,

    // ③の下に出す知らせ(準備に失敗した時など)。無ければ空
    startNotice: ""

};

// ---- ③ で使うもの(v224) ----

// 時計・ボタン・カウントダウンを書き換える見回り係。止まっている間は0
let syncClockTimerId = 0;

/*
カウントダウン中の約束ごと。カウントダウンしていない時は null。

    token          … この約束の目印(「やめる」で別の約束になったか見分ける)
    targetWallMs   … 開始時刻(時計のミリ秒。みんなの耳に届く時刻)
    plan           … どの曲を、どの位置から鳴らすか(prepareSyncPlan の答え)
    planText       … 画面に出す説明(曲名入り)
    wPerfMs        … 狙いの位置が鳴り始める瞬間(performance.now の物差し)
    warmStarted    … 音量0で先に鳴らし始めたか
*/
let syncCountdown = null;

// カウントダウン中に予約した setTimeout の受付番号(やめる時に全部取り消す)
let syncStartTimerIds = [];

// 先に鳴らす間だけ消音にするので、元の消音の状態を覚えておきます
let syncMutedBefore = false;

// 画面を消さないための「お願い」(Wake Lock)。持っていない時は null
let syncWakeLock = null;

// ---- ② の測定中だけ使うもの ----

// ピッの見回り係(setInterval の受付番号)。止まっている間は0
let syncBeepTimerId = 0;

// 最初のピッを鳴らす時刻 / 次のピッを鳴らす時刻(deckAudioCtx の時計で何秒か)
let syncBeepFirstSec = 0;
let syncBeepNextSec = 0;

// これまでに予約したピッの数(SYNC_LATENCY_MAX_BEEPS で打ち切るため)
let syncBeepCount = 0;

// ピッ専用の音量つまみ(テンポの音と分けておく理由は syncTempoGainNode と同じ)
let syncBeepGainNode = null;

// 叩いた時刻(performance.now() と同じ物差しのミリ秒)を順に並べたもの
let syncMeasureTaps = [];

/*
「音の時計」と「指の時計」の対応を覚えておく値です(v222)。
詳しくは下の sampleSyncClockOffset() のコメント。
*/
let syncClockOffsetMaxSec = -Infinity;

// テンポの音の見回り係(setInterval の受付番号)。止まっている間は0
let syncTempoTimerId = 0;

// 次にテンポの音を鳴らす時刻(deckAudioCtx の時計で何秒か)
let syncTempoNextSec = 0;

/*
テンポの音専用の音量つまみです。

曲の音量つまみ(js/deck.js)やノリノリアシストの音量つまみ
(js/metronome.js)とは別に持ちます。この画面の音を大きくしたり
小さくしたりしても、ほかの音に影響しないようにするためです。
*/
let syncTempoGainNode = null;


// ==========================================================
// 3. 画面部品
// ==========================================================

const syncPanelEl = document.getElementById("sync-panel");

const syncPitchNumberEl = document.getElementById("sync-pitch-number");
const syncPitchLabelEl = document.getElementById("sync-pitch-label");

const syncStepPitchEl = document.getElementById("sync-step-pitch");
const syncStepLatencyEl = document.getElementById("sync-step-latency");

const syncPitchDecideBtn = document.getElementById("sync-pitch-decide-btn");
const syncPitchResetBtn = document.getElementById("sync-pitch-reset-btn");
const syncPitchGuideEl = document.getElementById("sync-pitch-guide");

// ---- ② Bluetooth遅延(v222) ----

/*
ターンテーブル(竹弘の要望「DJのターンテーブル風にはしてくれないの?」)。

    #sync-latency-pad … ターンテーブル全体。ここを叩いて測ります
    #sync-pad-big     … レコードのラベル(真ん中の暁色の丸)の大きな字
    #sync-pad-small   … 同じく小さな字(「/ 12」「ms」など)
    #sync-pad-caption … ターンテーブルの下の一言
    #sync-pad-sub     … その下の小さな説明

ターンテーブルが今どの姿か(止まっている / 回っている / 値が出た)は、
data-phase という印で CSS に伝えます。回転やトーンアームの上げ下げは
すべて CSS 側で、JavaScript は印を書き換えるだけです。
*/
const syncLatencyPadEl = document.getElementById("sync-latency-pad");
const syncPadBigEl = document.getElementById("sync-pad-big");
const syncPadSmallEl = document.getElementById("sync-pad-small");
const syncPadCaptionEl = document.getElementById("sync-pad-caption");
const syncPadSubEl = document.getElementById("sync-pad-sub");

/*
レコードの周りのストロボの点(12個)。

本物のターンテーブル(Technics の SL-1200 など)の縁には、回転の速さを
確かめるための点(ストロボ)が並んでいます。それに見立てて、**叩いた
回数ぶんだけ時計回りに点を灯します**(12時の位置が1回目)。

HTMLに最初から12個並べてあり、querySelectorAll で全部まとめて取ります。
*/
const syncDotEls = document.querySelectorAll("#sync-dots .sync-dot");

/*
左上のモニタ(v223)。竹弘の指定「タップ開始後の情報をモニタに表示したい」。

    #sync-mon-status … 1行目の状態(READY / ● REC / DONE …)
    #sync-mon-big    … 2行目の大きな字(06/12、250ms)
    #sync-mon-sub    … 3行目のひとこと(WARM-UP / MEASURE / ±9ms OK …)
*/
const syncMonStatusEl = document.getElementById("sync-mon-status");
const syncMonBigEl = document.getElementById("sync-mon-big");
const syncMonSubEl = document.getElementById("sync-mon-sub");

// 左下のサンプラーの4つのパッド(叩くたびに順に光らせます。v223)
const syncSamplerPadEls = document.querySelectorAll("#sync-latency-pad .sync-sampler-pad");

const syncLatencyDecideBtn = document.getElementById("sync-latency-decide-btn");
const syncLatencyRedoBtn = document.getElementById("sync-latency-redo-btn");
const syncLatencyGuideEl = document.getElementById("sync-latency-guide");

// ③ 曲開始時刻(v224)
const syncStepStartEl = document.getElementById("sync-step-start");

const syncStartChooseEl = document.getElementById("sync-start-choose");
const syncStartCountdownEl = document.getElementById("sync-start-countdown");
const syncClockTimeEl = document.getElementById("sync-clock-time");

// 時刻ボタン(4つ)。どれも data-min-sec(最低何秒後か)を持っています
const syncTimeBtnEls = document.querySelectorAll("#sync-step-start .sync-time-btn");

const syncCountdownTargetEl = document.getElementById("sync-countdown-target");
const syncCountdownRestEl = document.getElementById("sync-countdown-rest");
const syncCountdownPlanEl = document.getElementById("sync-countdown-plan");
const syncCountdownCancelBtn = document.getElementById("sync-countdown-cancel-btn");
const syncStartGuideEl = document.getElementById("sync-start-guide");

/*
定規の部品(js/ruler.js)を、①の箱の中に組み立てます。

⚠️ **この時点ではまだ描き始めません。** 画面が隠れている間は箱の幅が
   0と測られ、定規が描けないためです。描き始めるのは画面を開いた後
   (openSyncPanel の ruler.start())です。
*/
const syncRuler = createSwipeRuler(document.getElementById("sync-ruler"),{

    min: SYNC_PITCH_MIN,
    max: SYNC_PITCH_MAX,
    value: NORIRUN_DEFAULT_PITCH,

    // 定規が動いて数字が変わるたびに、大きな数字と絵文字を書き換えます
    onChange: function(bpm){

        updateSyncPitchDisplay(bpm);

    },

    // 触り始めたら、テンポの音を鳴らし始めます(初期設定の定規と同じ)
    onTouchStart: function(){

        startSyncTempoSound();

    }

});


// ==========================================================
// 4. 画面を開く・閉じる
// ==========================================================
/**
 * 同期モードの画面を開きます(設定 ⚙️ のメニューから呼ばれます)。
 */
async function openSyncPanel(){

    if(!syncPanelEl){ return; }

    /*
    ---- ノリ注入済みの曲が足りなければ、開かずに知らせます ----

    この機能は🕺ノリノリRun再生の上で動くので、ノリノリRunに入れる
    条件(ノリ注入済みの曲が2曲以上)を満たしていないと使えません。

    ピッチを決めて、遅延を測って…と進めた最後で「使えません」と
    言われるのがいちばん困るので、**入口で先に**知らせます。
    文言は js/norirun.js の enterNoriRunMode() と揃えています
    (同じ理由で入れないのだから、同じ言い方で案内する)。
    */
    const injectedCount = countNoriInjectedTracks();

    if(injectedCount < NORIRUN_MIN_TRACKS){

        showTapToast(
            "ノリ注入した曲が" + NORIRUN_MIN_TRACKS + "曲以上必要です" +
            "(いま" + injectedCount + "曲)。" +
            "曲一覧の🛌を押してノリを注入してください"
        );

        console.log(
            "みんなで走る同期モードに入れません :",
            "ノリ注入済み " + injectedCount + "曲 /",
            "必要 " + NORIRUN_MIN_TRACKS + "曲"
        );

        return;

    }

    /*
    ---- 鳴っている曲は一時停止します(竹弘の条件(1)) ----

    すでに止まっていた場合は、そのままにします(条件(2))。

    【停止ボタンと同じ止め方をする】

    js/upper-area.js の ■ ボタンは、止めた後に cancelConnect() を
    呼んで「次の曲へ繋ぐ準備」を取りやめています。これが無いと、
    止めたのに裏で助走が続き、予約の時刻が来て**勝手に次の曲へ
    切り替わってしまいます。** 同期モードの設定には1分以上かかる
    こともあるので、ここでも必ず取りやめます。

    ⚠️ 取りやめても繋がらなくなるわけではありません。曲がまた
       鳴り出せば、接続点が近づいた時に助走がやり直されます
       (js/connect.js が timeupdate で見張っているため)。

    停止ボタンの記号(■⇄▶)はわざと触りません。マイピッチ設定や
    タップ補正と同じく、「閉じたら続きから鳴らす」一時的な停止だから
    です(旗 intentionalPause を立てなければ、記号は ■ のまま)。
    */
    syncState.wasPlaying = !audioPlayer.paused;

    if(syncState.wasPlaying){

        audioPlayer.pause();

        cancelConnect();

    }

    /*
    ---- ①は毎回、初期設定のマイピッチから始めます ----

    同期モードを開き直すたびに、前回みんなで決めた値ではなく
    **自分のいつものピッチ**から始めます。いつもの値を中心に、
    みんなの数字へ定規を寄せていく方が分かりやすいためです。
    */
    const myPitch = await loadMyPitch();

    syncState.pitch = myPitch;
    syncState.pitchDecided = false;

    syncRuler.setValue(myPitch);

    /*
    数字も先に合わせておきます。定規からの知らせ(onChange)は描き始めた
    次のコマで届くので、それを待つと一瞬だけ前回の数字が見えるためです。
    */
    updateSyncPitchDisplay(myPitch);

    /*
    ---- ② は、前回測った値があれば最初から出しておきます(v222) ----

    竹弘と決めた「値は保存して、次回はそれを使う」の部分です。
    イヤホンが同じなら遅延も同じなので、毎回12回叩かなくても
    そのまま「決定」できます。イヤホンを替えた時は「測り直す」。
    */
    stopSyncMeasure();

    const savedLatency = await loadSyncLatency();

    syncState.latencyMs = savedLatency;
    syncState.latencyPrevMs = savedLatency;
    syncState.latencySpreadMs = null;
    syncState.latencyFromSaved = (savedLatency !== null);
    syncState.latencyPhase = (savedLatency !== null) ? "done" : "idle";
    syncState.latencyDecided = false;
    syncState.latencyNotice = "";

    // ③ も毎回まっさらから(v224)
    syncState.trackChanged = false;
    syncState.running = false;
    syncState.startNotice = "";

    refreshSyncPanel();

    syncPanelEl.style.display = "flex";

    // 前に開いた時のスクロール位置が残らないよう、先頭に戻します
    const body = syncPanelEl.querySelector(".license-body");

    if(body){ body.scrollTop = 0; }

    /*
    定規を描き始めます。**必ず画面を出した後に呼ぶこと。**
    隠れている間は幅が0と測られ、定規が描けません。
    */
    syncRuler.start();

    // ③の時計とボタンの書き換えを始めます(v224。閉じる時に止めます)
    startSyncClock();

    console.log(
        "みんなで走る同期モードを開きました :",
        "マイピッチ " + myPitch + " から始めます /",
        (syncState.wasPlaying ? "鳴っていた曲を一時停止" : "曲は止まっていた") + " /",
        "前回の遅延 " + (savedLatency === null ? "なし" : savedLatency + "ms")
    );

}

/**
 * 同期モードの画面を閉じます(✕ボタン)。
 */
function closeSyncPanel(){

    if(!syncPanelEl){ return; }

    // テンポの音・ピッ・定規を止めます(裏で回り続けると電池を食います)
    stopSyncTempoSound();

    stopSyncMeasure();

    syncRuler.stop();

    /*
    ③のカウントダウン中なら取りやめ、時計も止めます(v224)。
    ✕は「やっぱりやめた」なので、スタートの予約も残しません。
    */
    cancelSyncCountdown("");

    stopSyncClock();

    syncPanelEl.style.display = "none";

    /*
    ③の準備で別の曲を載せていたら、元の曲はもう鳴らし直せません
    (syncState.trackChanged のコメント)。その時は何も鳴らさずに閉じます。
    */
    if(syncState.trackChanged){
        syncState.wasPlaying = false;
    }

    /*
    ---- 開いた時に鳴っていた曲は、続きから鳴らし直します ----

    時刻を決めてスタートせずに閉じた、つまり「やっぱりやめた」時です。
    マイピッチ設定(js/setup.js)と同じく、元の状態に戻します。

    pause() は再生位置を消さないので、play() を呼ぶだけで続きから
    鳴ります。

    【なぜ catch を付けるのか】
    play() は「鳴らせたかどうか」を後から知らせる約束(Promise)を
    返します。✕を押した直後なのでまず断られませんが、万一の時に
    赤いエラーがコンソールへ流れるだけで済むようにしておきます
    (alert は使わない方針。押されるまで JavaScript が丸ごと止まるため)。
    */
    if(syncState.wasPlaying){

        syncState.wasPlaying = false;

        const resumed = audioPlayer.play();

        if(resumed && typeof resumed.catch === "function"){

            resumed.catch(function(error){

                console.error(
                    "同期モードから戻った時の再生再開に失敗 :",
                    error.name,
                    error.message
                );

            });

        }

    }

    console.log("みんなで走る同期モードを閉じました");

}


// ==========================================================
// 5. ① みんなで走るピッチ
// ==========================================================
/**
 * 大きな数字と、その下の絵文字・呼び名を書き換えます。
 *
 * 絵文字と呼び名は、初期設定の定規と同じ判定(js/config.js の
 * getPaceStep)を使います。境目の数字を2か所に書かないためです。
 */
function updateSyncPitchDisplay(bpm){

    if(syncPitchNumberEl){ syncPitchNumberEl.textContent = bpm; }

    if(syncPitchLabelEl){

        const pace = getPaceStep(bpm);

        syncPitchLabelEl.textContent = pace.emoji + " " + pace.label;

    }

}

/**
 * 「決定」ボタン。①をロックして、次の②を表示します。
 */
function decideSyncPitch(){

    syncState.pitch = syncRuler.getValue();
    syncState.pitchDecided = true;

    // 決めたら音は止めます。次の②では別の音(ピッ)を聴くためです
    stopSyncTempoSound();

    /*
    定規が吸い付きの途中で決定された時のために、決まった値へ
    ぴたりと合わせます(数字と定規の目盛りが食い違わないように)。
    */
    syncRuler.setValue(syncState.pitch);

    refreshSyncPanel();

    console.log("同期モード ① ピッチを決定しました :",syncState.pitch);

}

/**
 * 「再設定」ボタン。①のロックを外して、もう一度選べるようにします。
 */
function resetSyncPitch(){

    syncState.pitchDecided = false;

    /*
    ②を測っている最中だったら取りやめます(v222)。

    ①を選び直す間は②を隠すので、見えないところでピッが鳴り続けて
    しまいます。値が出ていた時はその値に、まだ無ければ最初の姿に戻します。
    */
    if(syncState.latencyPhase === "measuring"){
        abortSyncMeasure("");
    }

    // ③のカウントダウン中なら取りやめます(ピッチが変わるので約束が崩れる。v224)
    cancelSyncCountdown("");

    refreshSyncPanel();

    console.log("同期モード ① ピッチを選び直します");

}

/**
 * 今の状態に合わせて、画面の見た目をまとめて書き換えます。
 *
 * 【なぜ1か所にまとめるのか】
 *
 * 「どのボタンを押せるか」「どの段を見せるか」を、ボタンを押すたびに
 * その場その場で書き換えると、**ある道筋だけ書き換え忘れる**事故が
 * 起きます(v188で「2つのパネルが同じボタンを取り合っていた」のが
 * その例)。状態(syncState)だけを変えて、見た目はこの関数が毎回
 * 状態から作り直す形にしておけば、食い違いようがありません。
 */
function refreshSyncPanel(){

    const decided = syncState.pitchDecided;

    /*
    ---- ① の見た目 ----

    決定済みなら、数字と定規を薄い灰色にして触れなくします
    (竹弘の指定「『決定』ボタン押すと薄い灰色でロック」)。
    見た目は CSS の .sync-step-locked、触れなくするのは定規の
    setLocked です。
    */
    if(syncStepPitchEl){
        syncStepPitchEl.classList.toggle("sync-step-locked",decided);
    }

    syncRuler.setLocked(decided);

    /*
    押せないボタンは**消さずに薄くします**(竹弘の好み。消すと位置が
    動いて指が迷うため)。disabled を付けると、押しても反応しなくなり、
    見た目は CSS の :disabled で薄くなります。
    */
    if(syncPitchDecideBtn){ syncPitchDecideBtn.disabled = decided; }
    if(syncPitchResetBtn){ syncPitchResetBtn.disabled = !decided; }

    /*
    薄いボタンには、**なぜ押せないのかを必ず添えます**(薄いだけだと
    壊れて見えるため。竹弘の好み)。

    ⚠️ 改行位置は <br> で決めています。日本語は空白が無いので、放って
       おくと画面の端に来た文字で切れてしまい、「押してくださ / い」の
       ようになります(竹弘の指示「文言は改行位置も検討して」)。
       ここは決まった文言だけなので innerHTML で書いて大丈夫です
       (曲名など外から来る文字を innerHTML に入れてはいけません)。
    */
    if(syncPitchGuideEl){

        syncPitchGuideEl.innerHTML = decided
            ? "変える時は「再設定」を押してください"
            : "みんなで同じ数字にしたら<br>「決定」を押してください";

    }

    /*
    ---- ② から先 ----

    順を追って表示する決まりなので、①が決まるまで②は見せません。
    「再設定」を押した時も隠します。①を決め直すまで、先へ
    進めない形を守るためです。
    */
    refreshSyncLatencyStep();

}


// ==========================================================
// 5-2. ② Bluetooth遅延(v222)
// ==========================================================
/*
【何を測っているのか】

アプリが「今ピッを鳴らす」と決めてから、それがイヤホンから耳に届き、
人が指で叩くまでの遅れです。

    アプリがピッを鳴らす ─(Bluetoothの遅れ 0.1〜0.3秒)→ 耳に届く
                                                        → 指で叩く

段③では、この遅れのぶんだけ**早く**曲を鳴らします(遠い人ほど早く家を
出る)。すると全員の耳に、開始時刻ちょうどに届きます。

【なぜ耳で合わせる微調整を使わないのか(竹弘と合意、2026-09-22)】

ピッもカチッも同じイヤホンを通って同じだけ遅れて届くので、耳で2つを
揃えると遅れが打ち消されて**0になってしまいます**。遅れを測るには
「遅れない物」と比べるしかなく、それが**指**です。

⚠️⚠️ **だから、ピッに合わせて画面を光らせてはいけません。**
   画面の光はBluetoothを通らないので遅れません。光に合わせて叩くと、
   目で合わせてしまい、遅延がほぼ0と測られます。ターンテーブルが
   動くのは「叩いた時」と「回転(ピッとは無関係の速さ)」だけです。
   画面の説明にも「画面は見ずに、耳だけで」と書いてあります。

【叩いた指も「遅れ」を含む ―― それで良い】

人は音を予想して少しだけ早く叩く癖があり、画面が指を感じるまでにも
わずかな時間がかかります。それも一緒に測られますが、**走る時の足も
同じ癖で踏む**ので、むしろ好都合です(足と同じ条件で測れている)。
*/

/**
 * ② の見た目を、今の状態に合わせて書き換えます。
 *
 * refreshSyncPanel() と同じ考え方で、状態(syncState)だけを見て
 * 毎回まるごと作り直します。
 */
function refreshSyncLatencyStep(){

    if(!syncStepLatencyEl){ return; }

    const visible = syncState.pitchDecided;

    syncStepLatencyEl.style.display = visible ? "" : "none";

    const phase = syncState.latencyPhase;
    const decided = syncState.latencyDecided;

    // 決定済みなら、ターンテーブルを薄い灰色にして触れなくします(①と同じ)
    syncStepLatencyEl.classList.toggle("sync-step-locked",decided);

    /*
    ターンテーブルの姿を CSS に伝えます。

        data-phase="idle"      … 止まっている。トーンアームは上がっている
        data-phase="measuring" … 回っている。トーンアームが盤に降りている
        data-phase="done"      … 止まって、ラベルに値が出ている
    */
    if(syncLatencyPadEl){

        syncLatencyPadEl.dataset.phase = phase;

        /*
        叩いた時の「沈み」の印は、測っている間だけのものです。
        付けたままだと、次に測りはじめた最初の1打で沈みが出ないことが
        あるので、測っていない時は外しておきます。
        */
        if(phase !== "measuring"){
            syncLatencyPadEl.classList.remove("sync-deck-hit");
        }

    }

    // ---- ラベルと説明の文字 ----

    let big = "";
    let small = "";
    let caption = "";
    let sub = "";

    if(phase === "idle"){

        big = "▶";
        small = "タップ";

        caption = "👆 レコードをタップして測りはじめる";

        /*
        途中で止まった時などの知らせがあれば、説明の代わりに出します。
        */
        sub = syncState.latencyNotice ||
              "押すと ピッ が鳴り始めます。<br>" +
              "一緒に走る時のイヤホンで測ってください";

    }
    else if(phase === "measuring"){

        big = String(syncMeasureTaps.length);
        small = "/ " + SYNC_LATENCY_TAPS;

        caption = "ピッに合わせてタップ";

        /*
        v223で1行目を「音を待たずに、リズムに乗って」に変えました。

        竹弘の実測で1回だけ 432ms(ほかは約265ms)が出ました。差の約167ms は
        人が「音を聴いてから反応する」時間とほぼ同じで、**ピッを待ってから
        叩くと、その分だけ遅く測られます**(SYNC_LATENCY_PREV_WARN_MS の
        コメント)。走る時の足はリズムを予想して踏むので、測る時も同じ
        叩き方をしてもらいます。

        「1〜4回目はならし」の案内は、左上のモニタ(WARM-UP / MEASURE)に
        移しました。
        */
        sub = "音を待たずに、リズムに乗って叩いてください<br>" +
              "画面は見ずに、耳だけで合わせましょう";

    }
    else{

        // phase === "done"
        big = String(syncState.latencyMs);
        small = "ms";

        /*
        竹弘の指定どおりの文:『あなたのBluetooth遅延の値はXXです。』
        前回の値を出している時は、それと分かる言い方にします。
        */
        caption = (syncState.latencyFromSaved ? "前回測った値は" : "あなたのBluetooth遅延の値は") +
                  "<br><b>" + syncState.latencyMs + "ms</b> です";

        if(syncState.latencyFromSaved){

            sub = "イヤホンが同じなら、<br>このまま使えます";

        }
        else if(isSyncSpreadLarge()){

            sub = "⚠️ ばらつき ±" + syncState.latencySpreadMs + "ms(大きめです)<br>" +
                  "もう一度測ると、正確になります";

        }
        else if(isSyncFarFromPrev()){

            /*
            前回の値から大きく離れた時(v223)。イヤホンを替えたのなら
            正しい変化なので、止めずに一言添えるだけにします。
            */
            sub = "⚠️ 前回(" + syncState.latencyPrevMs + "ms)と大きく違います<br>" +
                  "同じイヤホンなら、もう一度測ってみてください";

        }
        else{

            sub = "✓ ばらつき ±" + syncState.latencySpreadMs + "ms<br>" +
                  "きれいに叩けています";

        }

    }

    /*
    ⚠️ 文字はすべてこの関数の中で決めた決まり文句と数字だけなので、
       innerHTML で書いて大丈夫です(<br> と <b> を使うため)。
       曲名など外から来る文字は、ここに混ぜないこと。
    */
    if(syncPadBigEl){ syncPadBigEl.textContent = big; }
    if(syncPadSmallEl){ syncPadSmallEl.textContent = small; }
    if(syncPadCaptionEl){ syncPadCaptionEl.innerHTML = caption; }
    if(syncPadSubEl){ syncPadSubEl.innerHTML = sub; }

    refreshSyncMonitor();

    // ---- ストロボの点 ----
    /*
    叩いた数だけ、12時の位置から時計回りに灯します。
    値が出た後(done)は全部灯したままにして「測り終えた」ことを見せます
    (前回の値を読んだだけの時は、叩いていないので灯しません)。
    */
    const lit = (phase === "measuring") ? syncMeasureTaps.length
              : (phase === "done" && !syncState.latencyFromSaved) ? SYNC_LATENCY_TAPS
              : 0;

    syncDotEls.forEach(function(dot,index){
        dot.classList.toggle("sync-dot-on",index < lit);
    });

    // ---- ボタン ----
    /*
    決定 … 値が出ている時だけ押せます
    測り直す … 測っている最中(やり直し)と、値が出た後と、決定の後に押せます。
               まだ何も無い時は、押しても意味が無いので薄くします
    */
    if(syncLatencyDecideBtn){
        syncLatencyDecideBtn.disabled = decided || phase !== "done";
    }

    if(syncLatencyRedoBtn){
        syncLatencyRedoBtn.disabled = (!decided && phase === "idle");
    }

    // 薄いボタンの理由と、次にすること(①と同じ考え方)
    if(syncLatencyGuideEl){

        let guide = "";

        if(decided){
            guide = "変える時は「測り直す」を押してください";
        }
        else if(phase === "idle"){
            guide = "まずレコードをタップして<br>測ってください";
        }
        else if(phase === "measuring"){
            guide = SYNC_LATENCY_TAPS + "回叩くと、自動で止まります";
        }
        else{
            guide = "この値でよければ<br>「決定」を押してください";
        }

        syncLatencyGuideEl.innerHTML = guide;

    }

    // ---- ③ ----
    // ②が決まるまで③は見せません(①が選び直し中なら、もちろん隠します)
    if(syncStepStartEl){
        syncStepStartEl.style.display = (visible && decided) ? "" : "none";
    }

    /*
    画面の幅に合わせて台を縮めます(v223)。②が見えている時だけ測れる
    (隠れている間は幅が0と測られる)ので、ここで毎回合わせ直します。
    */
    if(visible){ fitSyncDeck(); }

    // ③ の中身(選ぶ姿 / カウントダウンの姿)も合わせます(v224)
    refreshSyncStartStep();

}

/**
 * 叩いた8回のばらつきが大きすぎるか(測り直しを勧める目安を超えたか)。
 *
 * @return {boolean}
 */
function isSyncSpreadLarge(){

    return syncState.latencySpreadMs !== null &&
           syncState.latencySpreadMs > SYNC_LATENCY_SPREAD_WARN_MS;

}

/**
 * 今測った値が、前回保存した値から大きく離れているか(v223)。
 *
 * 前回の値を出しているだけの時や、前回の値が無い時は false です。
 *
 * @return {boolean}
 */
function isSyncFarFromPrev(){

    if(syncState.latencyFromSaved){ return false; }

    if(syncState.latencyPrevMs === null || syncState.latencyMs === null){ return false; }

    return Math.abs(syncState.latencyMs - syncState.latencyPrevMs) > SYNC_LATENCY_PREV_WARN_MS;

}

/**
 * 左上のモニタの3行を、今の状態に合わせて書き換えます(v223)。
 *
 * 液晶らしく、英字と数字だけで短く出します。
 *
 * ⚠️⚠️ **「● REC」は点滅させません。** 点滅はピッと関係ない速さでも
 *    「目で追えるリズム」になりえて、目で合わせると遅延が0と測られて
 *    しまうためです(js/sync.js の「② Bluetooth遅延」の説明)。
 */
function refreshSyncMonitor(){

    const phase = syncState.latencyPhase;

    // 数字を2桁にそろえます(6 → "06")
    function twoDigits(n){
        return (n < 10 ? "0" : "") + n;
    }

    let status = "";
    let big = "";
    let sub = "";

    if(phase === "idle"){

        status = "READY";
        big = "00/" + SYNC_LATENCY_TAPS;
        sub = "TAP TO START";

    }
    else if(phase === "measuring"){

        const count = syncMeasureTaps.length;

        status = "● REC";
        big = twoDigits(count) + "/" + SYNC_LATENCY_TAPS;

        // 次に叩くのが「ならし」か「本番」か
        sub = (count < SYNC_LATENCY_WARMUP) ? "WARM-UP" : "MEASURE";

    }
    else{

        status = syncState.latencyDecided ? "SET ✓"
               : syncState.latencyFromSaved ? "MEMORY"
               : "DONE";

        big = syncState.latencyMs + "ms";

        if(syncState.latencyFromSaved){
            sub = "LAST VALUE";
        }
        else{
            const check = (isSyncSpreadLarge() || isSyncFarFromPrev()) ? " CHECK" : " OK";
            sub = "±" + syncState.latencySpreadMs + "ms" + check;
        }

    }

    if(syncMonStatusEl){ syncMonStatusEl.textContent = status; }
    if(syncMonBigEl){ syncMonBigEl.textContent = big; }
    if(syncMonSubEl){ syncMonSubEl.textContent = sub; }

}

/**
 * 画面が狭い時、ターンテーブルの台ごと縮めます(v223)。
 *
 * 台の中身は幅320pxの上に px で置いてあるので、それより狭い画面
 * (折り畳みスマホの外の画面など)ではみ出します。はみ出す時だけ、
 * 「使える幅 ÷ 320」の倍率を CSS の --deck-scale に入れて、見た目の
 * 比率を保ったまま縮めます。ふつうのスマホ(幅360px以上)では 1 の
 * ままで、何も変わりません。
 */
function fitSyncDeck(){

    if(!syncLatencyPadEl){ return; }

    const width = syncLatencyPadEl.clientWidth;

    // 隠れている間は幅0と測られるので、何もしません
    if(width <= 0){ return; }

    const scale = Math.min(1,width / SYNC_DECK_STAGE_WIDTH);

    syncLatencyPadEl.style.setProperty("--deck-scale",scale.toFixed(4));

}

/**
 * ターンテーブルが押された時の処理です。
 *
 * 止まっている時 … 測りはじめます(この1回は数えません)
 * 回っている時   … 1回叩いたとして数えます
 * 値が出ている時 … 何もしません(うっかり触って値が消えないように。
 *                   測り直す時は「測り直す」ボタン)
 *
 * @param {PointerEvent} event
 */
function handleSyncPadPress(event){

    if(syncState.latencyDecided){ return; }

    if(syncState.latencyPhase === "idle"){

        startSyncMeasure();

        return;

    }

    if(syncState.latencyPhase !== "measuring"){ return; }

    /*
    叩いた時刻は event.timeStamp を使います。

    これは「指が画面に触れたとブラウザが知った時刻」で、performance.now()
    と同じ物差し(ページを開いてからのミリ秒)です。この関数が呼ばれる
    までに多少待たされても、この値は触れた瞬間のままなので正確です。
    */
    const tappedMs = event.timeStamp;

    const last = syncMeasureTaps[syncMeasureTaps.length - 1];

    // 指が跳ねた・2本の指が触れた、といった二重の数え方を捨てます
    if(last !== undefined && tappedMs - last < SYNC_LATENCY_DEBOUNCE_MS){ return; }

    noteSyncClockOffset();

    syncMeasureTaps.push(tappedMs);

    /*
    叩いた手ごたえとして、レコードを一瞬だけ沈ませます。

    同じクラスを付け直してもアニメーションは最初からやり直されないので、
    一度外して、offsetWidth を読んで(ブラウザに「今の見た目」を確定させて)
    から付け直します。よく使われる小技です。

    ⚠️ 動くのは「叩いた時」だけです。ピッには連動させません(上の説明)。
    */
    if(syncLatencyPadEl){

        syncLatencyPadEl.classList.remove("sync-deck-hit");

        void syncLatencyPadEl.offsetWidth;

        syncLatencyPadEl.classList.add("sync-deck-hit");

    }

    /*
    サンプラーのパッドを1つ光らせます(v223)。叩くたびに
    左上 → 右上 → 左下 → 右下 → 左上… と順に回ります。
    やり直しの小技は上の「沈み」と同じです。
    */
    if(syncSamplerPadEls.length > 0){

        const pad = syncSamplerPadEls[(syncMeasureTaps.length - 1) % syncSamplerPadEls.length];

        pad.classList.remove("sync-sampler-hit");

        void pad.offsetWidth;

        pad.classList.add("sync-sampler-hit");

    }

    if(syncMeasureTaps.length >= SYNC_LATENCY_TAPS){

        finishSyncMeasure();

        return;

    }

    refreshSyncLatencyStep();

}

/**
 * 測りはじめます(ピッを鳴らし始める)。
 */
function startSyncMeasure(){

    /*
    音の出口を用意して、眠っていたら起こします。

    ⚠️ **指で触った瞬間の中で呼ぶのが要です**(テンポの音と同じ理由)。
    */
    ensureDeckAudioGraph();
    resumeDeckAudio();

    if(!deckAudioCtx){

        syncState.latencyNotice = "⚠️ 音を出す準備ができませんでした。<br>もう一度タップしてください";

        refreshSyncLatencyStep();

        return;

    }

    if(!syncBeepGainNode){

        syncBeepGainNode = deckAudioCtx.createGain();

        // 大きさはノリノリアシストの「ピッ」と同じにします
        syncBeepGainNode.gain.value = METRONOME_GAIN_BEEP;

        syncBeepGainNode.connect(deckAudioCtx.destination);

    }

    syncMeasureTaps = [];

    syncClockOffsetMaxSec = -Infinity;

    syncBeepFirstSec = deckAudioCtx.currentTime + SYNC_LATENCY_LEAD_SEC;
    syncBeepNextSec = syncBeepFirstSec;
    syncBeepCount = 0;

    syncState.latencyPhase = "measuring";
    syncState.latencyNotice = "";

    // 見回りは、テンポの音と同じ間隔・同じ先読みで行います
    syncBeepTimerId = setInterval(scheduleSyncBeeps,SYNC_TEMPO_TIMER_MS);

    scheduleSyncBeeps();

    refreshSyncLatencyStep();

    console.log("同期モード ② 遅延を測りはじめます : BPM" + SYNC_LATENCY_BPM + "のピッ");

}

/**
 * 見回りのたびに、少し先までのピッを予約します。
 */
function scheduleSyncBeeps(){

    if(!deckAudioCtx){ return; }

    // 「音の時計」と「指の時計」の対応を、見回りのたびに確かめておきます
    noteSyncClockOffset();

    /*
    叩き終わらないまま鳴り続けるのを止めます(24秒)。
    ⚠️ ここで止めると、叩いた分は捨てて最初の姿に戻ります。
    */
    if(syncBeepCount >= SYNC_LATENCY_MAX_BEEPS){

        abortSyncMeasure("途中で止まりました。<br>もう一度タップしてください");

        console.log("同期モード ② ピッが" + SYNC_LATENCY_MAX_BEEPS + "回鳴っても叩き終わらなかったので止めました");

        return;

    }

    const horizon = deckAudioCtx.currentTime + SYNC_TEMPO_LOOKAHEAD_SEC;

    const beatSec = 60 / SYNC_LATENCY_BPM;

    /*
    ⚠️ テンポの音(scheduleSyncTempo)と違い、遅れた見回りで「過ぎた拍を
       捨てて数え直す」ことはしません。ピッの時刻は最初の1打から
       「0.6秒 × n」で**必ず決まった格子**の上になければ、叩いた時刻と
       比べられなくなるためです。過ぎてしまった拍は鳴らさずに飛ばします。
    */
    while(syncBeepNextSec < horizon && syncBeepCount < SYNC_LATENCY_MAX_BEEPS){

        if(syncBeepNextSec >= deckAudioCtx.currentTime){
            playSyncBeep(syncBeepNextSec);
        }

        syncBeepNextSec += beatSec;

        syncBeepCount++;

    }

}

/**
 * 「ピッ」を1つ予約します。
 *
 * ノリ注入(タップ補正)・ノリノリアシストと同じ電子音です。高さ・長さは
 * js/tap.js の TAP_CLICK_* を借ります(同じ音であり続けるため。
 * js/metronome.js の createMetronomeBeep と同じ作り)。
 *
 * ⚠️ **🔇消音中でも鳴らします。** テンポの音(定規)は触っただけで鳴り
 *    始めるので消音を守りますが、こちらは竹弘が自分で「測る」と決めて
 *    押した音で、聞こえなければ測れないためです。
 *
 * @param {number} atCtxSec - いつ鳴らすか(deckAudioCtx の時計で何秒か)
 */
function playSyncBeep(atCtxSec){

    const osc = deckAudioCtx.createOscillator();

    osc.type = TAP_CLICK_TYPE;
    osc.frequency.setValueAtTime(TAP_CLICK_HZ,atCtxSec);

    /*
    発振器は放っておくと「ピー」と鳴り続けるので、音量をすとんと落として
    「ピッ」に切り取ります。0にはできない決まりなので0.001まで落とします。
    この音専用の音量つまみを毎回作るのは、次のピッと取り合わないためです
    (js/metronome.js の createMetronomeBeep のコメントと同じ理由)。
    */
    const gain = deckAudioCtx.createGain();

    gain.gain.setValueAtTime(1.0,atCtxSec);
    gain.gain.exponentialRampToValueAtTime(0.001,atCtxSec + TAP_CLICK_SEC);

    osc.connect(gain);
    gain.connect(syncBeepGainNode);

    osc.start(atCtxSec);
    osc.stop(atCtxSec + TAP_CLICK_SEC + 0.02);

}

/**
 * ピッの見回りを止めます(予約済みの最大0.12秒ぶんは鳴り終わります)。
 */
function stopSyncMeasure(){

    if(!syncBeepTimerId){ return; }

    clearInterval(syncBeepTimerId);

    syncBeepTimerId = 0;

}

/**
 * 測定を途中で取りやめます。
 *
 * 値が出ていた時(前回の値・前に測った値)はその値の姿に、まだ何も
 * 無ければ最初の姿に戻します。
 *
 * @param {string} notice - 枠の下に出す知らせ(空なら出さない)
 */
function abortSyncMeasure(notice){

    stopSyncMeasure();

    syncMeasureTaps = [];

    syncState.latencyPhase = (syncState.latencyMs !== null) ? "done" : "idle";

    /*
    知らせは「最初の姿」の時だけ出せます(値の姿では説明の欄を値の
    説明に使うため)。値が無い時にしか途中で止まることは無いので十分です。
    */
    syncState.latencyNotice = notice;

    refreshSyncLatencyStep();

}

/**
 * 12回叩き終わった時に、遅延を計算して値の姿にします。
 */
function finishSyncMeasure(){

    stopSyncMeasure();

    const beatMs = 60000 / SYNC_LATENCY_BPM;

    /*
    最初のピッの時刻を、「音の時計」から「指の時計」へ直します
    (sampleSyncClockOffset() のコメント参照)。
    */
    const firstBeepMs = (syncBeepFirstSec - syncClockOffsetMaxSec) * 1000;

    // 5回目から12回目の8回を使います(ならしの4回を捨てる)
    const used = syncMeasureTaps.slice(SYNC_LATENCY_WARMUP);

    const result = computeSyncLatency(used,firstBeepMs,beatMs);

    syncState.latencyMs = result.latencyMs;
    syncState.latencySpreadMs = result.spreadMs;
    syncState.latencyFromSaved = false;
    syncState.latencyPhase = "done";
    syncState.latencyNotice = "";

    refreshSyncLatencyStep();

    /*
    実機で確かめられるよう、中身を🐛パネルへ出しておきます。
    「各タップのずれ」は、使った8回それぞれが何ms遅れていたかです。
    */
    console.log(
        "同期モード ② 遅延を測りました : " + result.latencyMs + "ms",
        "/ ばらつき ±" + result.spreadMs + "ms",
        "/ まとまり " + result.concentration.toFixed(2),
        "/ 各タップのずれ [" + result.eachMs.join(", ") + "]"
    );

}

/**
 * 叩いた時刻の並びから、遅延(ミリ秒)を計算します。
 *
 * ⚠️ 画面にも音にも触らない「計算だけ」の関数にしてあります。
 *    sandbox の検証ページから、作った数字を入れて確かめられるように
 *    するためです(答えが分かっている数字で試せる)。
 *
 * 【やっていること】
 *
 * ① 叩いた時刻を、ピッの格子(0.6秒ごと)の上の位置に直す
 *
 *    「最初のピッから何ms後か」を1拍(600ms)で割った余りです。
 *    時計の針のように、600msで1周してまた0に戻ります。
 *
 * ② 8回の「平均の位置」を、時計の針の平均として求める
 *
 *    ふつうに足して割ると困ることがあります。たとえば 590ms と 10ms は
 *    時計の上ではすぐ隣(20ms違い)なのに、足して割ると 300ms という
 *    とんでもない位置になります。そこで、それぞれの位置を**時計の文字盤の
 *    上の点**だと考え、点の重心の向きを平均にします(円の平均)。
 *
 * ③ 平均を「ありえる範囲」(-150〜450ms)の中に置き直す
 *
 *    SYNC_LATENCY_WINDOW_MIN_MS のコメント参照。
 *
 * ④ 平均からの1回ずつのずれで、最終的な値とばらつきを出す
 *
 * @param  {number[]} tapsMs      - 叩いた時刻(ミリ秒。performance.now() の物差し)
 * @param  {number}   firstBeepMs - 最初のピッが鳴った時刻(同じ物差し)
 * @param  {number}   beatMs      - ピッの間隔(ミリ秒)
 * @return {{latencyMs:number, spreadMs:number, concentration:number, eachMs:number[]}}
 *         latencyMs     … 遅延(整数)
 *         spreadMs      … ばらつき(標準偏差。整数)
 *         concentration … 位置のまとまり具合(1なら完全に揃っている、0ならバラバラ)
 *         eachMs        … 1回ずつの遅れ(整数。ログ用)
 */
function computeSyncLatency(tapsMs,firstBeepMs,beatMs){

    // 余りを「必ず0以上」で求めます(JavaScript の % は負の数だと負を返すため)
    function wrapPositive(value,size){
        return ((value % size) + size) % size;
    }

    // 差を「-半周〜+半周」の範囲に直します
    function wrapHalf(value,size){
        return wrapPositive(value + size / 2,size) - size / 2;
    }

    // ① 格子の上の位置(0〜600ms)
    const phases = tapsMs.map(function(t){
        return wrapPositive(t - firstBeepMs,beatMs);
    });

    // ② 円の平均。位置を角度に直して、cos と sin の合計の向きを見ます
    let sumCos = 0;
    let sumSin = 0;

    phases.forEach(function(p){

        const angle = 2 * Math.PI * p / beatMs;

        sumCos += Math.cos(angle);
        sumSin += Math.sin(angle);

    });

    /*
    Math.atan2(y,x) は「その向きの角度」を -π〜π で返します。
    それを1拍の長さに直すと、-300〜300ms の位置になります。
    */
    let center = Math.atan2(sumSin,sumCos) / (2 * Math.PI) * beatMs;

    /*
    まとまり具合。点がすべて同じ場所なら重心は円周上(1)、
    バラバラなら真ん中(0)に近づきます。
    */
    const concentration = phases.length > 0
        ? Math.sqrt(sumCos * sumCos + sumSin * sumSin) / phases.length
        : 0;

    // ③ ありえる範囲(-150〜450ms)の中へ置き直します
    while(center < SYNC_LATENCY_WINDOW_MIN_MS){ center += beatMs; }
    while(center >= SYNC_LATENCY_WINDOW_MIN_MS + beatMs){ center -= beatMs; }

    // ④ 1回ずつ、平均からどれだけずれていたか(-300〜300ms)
    const deviations = phases.map(function(p){
        return wrapHalf(p - center,beatMs);
    });

    const meanDeviation = deviations.reduce(function(a,b){ return a + b; },0) /
                          Math.max(deviations.length,1);

    const latency = center + meanDeviation;

    const variance = deviations.reduce(function(sum,d){
        return sum + (d - meanDeviation) * (d - meanDeviation);
    },0) / Math.max(deviations.length,1);

    return {
        latencyMs: Math.round(latency),
        spreadMs: Math.round(Math.sqrt(variance)),
        concentration: concentration,
        eachMs: deviations.map(function(d){ return Math.round(center + d); })
    };

}

/**
 * 「音の時計」と「指の時計」の対応を1回測って返します。
 *
 * 【2つの時計】
 *
 *     音の時計 … deckAudioCtx.currentTime(秒)。ピッはこの時計で予約します
 *     指の時計 … performance.now() / event.timeStamp(ミリ秒)。
 *                叩いた時刻はこの時計で分かります
 *
 * 2つは別々に進むので、比べるには「音の時計の◯秒は、指の時計の何秒か」
 * という対応が要ります。その差(音の時計 − 指の時計)を返します。
 *
 * 【なぜ「一番大きい値」を使うのか(noteSyncClockOffset)】
 *
 * 音の時計は、なめらかに進むのではなく、音をまとめて作るたびに
 * **数ミリ〜数十ミリ秒ずつ飛んで**進みます(その間は止まって見える)。
 * そのため測るたびに差が少しずつ違い、「飛んだ直後」がいちばん大きく
 * なります。いちばん大きい値を選べば、毎回「飛んだ直後」という同じ
 * 条件の値がそろいます。
 *
 * ⚠️⚠️ **段③で曲を鳴らす時も、必ず同じ測り方をすること。**
 *    遅延は「この物差しで測った遅れ」なので、物差しを変えると、
 *    その差のぶんだけずれます(同じ物差しで測って、同じ物差しで使う)。
 *
 * @return {number|null} 差(秒)。音の出口がまだ無ければ null
 */
function sampleSyncClockOffset(){

    if(!deckAudioCtx){ return null; }

    // 音の時計を先に読みます(逆にすると、間に待たされた分だけ差が小さく出ます)
    const ctxSec = deckAudioCtx.currentTime;
    const perfSec = performance.now() / 1000;

    return ctxSec - perfSec;

}

/**
 * 対応を測って、これまでで一番大きい値を覚えておきます。
 */
function noteSyncClockOffset(){

    const offset = sampleSyncClockOffset();

    if(offset !== null && offset > syncClockOffsetMaxSec){

        syncClockOffsetMaxSec = offset;

    }

}

/**
 * 「決定」ボタン。②をロックして、値を保存し、③を表示します。
 */
function decideSyncLatency(){

    if(syncState.latencyMs === null){ return; }

    syncState.latencyDecided = true;

    refreshSyncLatencyStep();

    /*
    次回もこの値から始められるよう保存します(竹弘と合意)。

    前回の値をそのまま決定した時も書き直します。同じ値なので害は無く、
    「決定した値が保存されている」という形をいつも同じにしておけます。
    */
    saveSyncLatency(syncState.latencyMs);

    // 保存した値が、次に比べる「前回の値」になります(v223)
    syncState.latencyPrevMs = syncState.latencyMs;

    console.log("同期モード ② 遅延を決定しました :",syncState.latencyMs + "ms");

}

/**
 * 「測り直す」ボタン。ロックを外して、最初の姿に戻します。
 *
 * すぐにピッを鳴らさず、「レコードをタップして測りはじめる」から
 * やり直します。イヤホンをつなぎ直すなど、準備の時間が要ることが
 * あるためです。
 */
function redoSyncLatency(){

    // ③のカウントダウン中なら取りやめます(遅延が変わるので約束が崩れる。v224)
    cancelSyncCountdown("");

    stopSyncMeasure();

    syncMeasureTaps = [];

    syncState.latencyDecided = false;
    syncState.latencyPhase = "idle";
    syncState.latencyNotice = "";

    refreshSyncLatencyStep();

    console.log("同期モード ② 遅延を測り直します");

}

/**
 * 前回保存した遅延を読みます。
 *
 * @return {Promise<number|null>} 遅延(ミリ秒の整数)。無ければ null
 */
async function loadSyncLatency(){

    try{

        const saved = await idbGet(STORE_SETTINGS,SYNC_LATENCY_SETTING_KEY);

        if(typeof saved === "number" && isFinite(saved)){ return Math.round(saved); }

    }
    catch(error){

        console.error("同期モードの遅延の読み込みに失敗 :",error);

    }

    return null;

}

/**
 * 遅延を保存します。失敗しても画面は止めません(ログに残すだけ)。
 *
 * @param {number} latencyMs
 */
function saveSyncLatency(latencyMs){

    idbPut(STORE_SETTINGS,latencyMs,SYNC_LATENCY_SETTING_KEY).catch(function(error){

        console.error("同期モードの遅延の保存に失敗 :",error);

    });

}


// ==========================================================
// 5-3. ③ 曲開始時刻(v224)
// ==========================================================
/*
【何をするのか】

みんなで同じ時刻のボタンを押すと、その時刻ちょうどに、それぞれの
スマホで曲がスタートします。曲はそれぞれ好きな曲で構いません。
**揃えるのは「拍」です。**

    みんなの拍の格子 = 開始時刻T + 1拍の長さ × n

同じマイピッチなので1拍の長さは全員同じ。あとは「時刻Tに拍が来る」
ように各自が曲を始めれば、以後ずっと全員の拍が重なります
(繋ぎ方は3つとも拍の格子を崩さないので、2曲目以降も揃ったまま)。

【時計は何を使うのか】

Date.now()(スマホの時計)です。竹弘が3台で測って、ズレは最大0.022秒
でした(対策不要と合意)。ただし「ミリ秒単位でいつ動くか」を決めるのは
performance.now()(ページを開いてからの経過時間)の方が確かなので、
**時刻は Date.now() で決め、待つのは performance.now() で待ちます。**

    狙いの瞬間(performance.now の物差し)
        = いまの performance.now() + (狙いの時刻 − いまの Date.now())

【Bluetoothの遅れ ―― 遠い人ほど早く家を出る】

②で測った遅延(L)のぶん、**早く**鳴らします。

    送り出す時刻 S = 開始時刻T − L
    → イヤホンの遅れLを経て、耳に届くのはちょうどT

【曲をどう始めるか(2通り)】

    続きから … 止めていた曲(注入済み)を、止めた位置の**直後の拍**から。
               その拍を、送り出す時刻Sに鳴らします
    頭から   … 曲が無い時・止めていた曲が未注入の時は、一覧のトップの曲を。
               🎬頭出し接続と同じく、0〜1拍未満の無音のあとに曲の頭が
               来るよう、無音の長さで拍に合わせます(竹弘の案)

【どうやって「ちょうど」に始めるか ―― 🎬頭出し接続と同じ手順】

    ① 開始の3秒前から、曲を「消音・音量0」で先に鳴らしておく
       (いきなり鳴らすと、鳴り出すまでの時間が読めないため)
    ② その時刻の14ms前に、狙いの位置へ動かす(頭出し。実測で平均14msかかる)
    ③ 頭出しが終わったら、消音を戻して30msで音量を上げる
       (v202-v203で「ブチ」を消した手順そのもの)

⚠️⚠️ **拍が揃うかどうかは「その時刻に曲がどの位置にあるか」だけで
   決まります。** 音量を上げるのが数ms遅れても、拍の位置はずれません
   (聞こえ始めが一瞬遅れるだけ)。だから大事なのは②の頭出しの時刻です。

⚠️ 先に鳴らす間(①)は消音にしています。ノリノリアシストは消音中は
   鳴らない決まり(v193)なので、**開始前にバラバラのカチッが鳴る**のも
   これで防げます。
*/

/**
 * 時刻を「19:52:07」の形にします(スマホの時計の、その土地の時刻)。
 *
 * @param  {number} ms - 時計のミリ秒(Date.now() の物差し)
 * @return {string}
 */
function formatSyncClock(ms){

    const d = new Date(ms);

    // 1桁の数を「07」のように2桁にそろえます
    const pad = function(n){ return (n < 10 ? "0" : "") + n; };

    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());

}

/**
 * 「今から最低 minSec 秒後」以降で、いちばん近い10秒刻みの時刻を返します。
 *
 * Math.ceil は「切り上げ」です。10秒(10000ms)で割って切り上げてから
 * 掛け戻すと、「その時刻以上で、いちばん近い10秒刻み」になります。
 *
 *     いま 19:52:05、minSec=10 → 19:52:15 以上で最初の10秒刻み = 19:52:20
 *     (あと15秒。10秒を切った 19:52:10 には 19:52:30 に切り替わる)
 *
 * だから竹弘の指定「残り10秒になったら20秒後の時刻に切り替える」が、
 * この1行で自然に成り立ちます。
 *
 * @param  {number} nowMs  - 今の時刻(Date.now())
 * @param  {number} minSec - 最低何秒後か
 * @return {number} 開始時刻(Date.now() の物差しのミリ秒)
 */
function getSyncStartTargetMs(nowMs,minSec){

    const gridMs = SYNC_START_GRID_SEC * 1000;

    return Math.ceil((nowMs + minSec * 1000) / gridMs) * gridMs;

}

/**
 * 時計・ボタン・カウントダウンの書き換えを始めます(画面を開いた時)。
 */
function startSyncClock(){

    if(syncClockTimerId){ return; }

    syncClockTimerId = setInterval(tickSyncClock,SYNC_CLOCK_TIMER_MS);

    tickSyncClock();

}

/**
 * 書き換えを止めます(画面を閉じた時。裏で回り続けないように)。
 */
function stopSyncClock(){

    if(!syncClockTimerId){ return; }

    clearInterval(syncClockTimerId);

    syncClockTimerId = 0;

}

/**
 * 見回りのたび(0.2秒ごと)に、時計・ボタン・カウントダウンを書き換えます。
 */
function tickSyncClock(){

    const nowMs = Date.now();

    if(syncClockTimeEl){ syncClockTimeEl.textContent = formatSyncClock(nowMs); }

    refreshSyncStartButtons(nowMs);

    refreshSyncCountdown(nowMs);

}

/**
 * 4つの時刻ボタンの時刻と「あと◯秒」を書き換えます。
 *
 * ⚠️ 押された時にどの時刻を使うかは、**画面に出ていた時刻**
 *    (data-target-ms)です。押した瞬間に計算し直すと、切り替わりの
 *    境目で「見ていた時刻と違う時刻」で始まってしまうためです。
 *
 * @param {number} nowMs - 今の時刻(Date.now())
 */
function refreshSyncStartButtons(nowMs){

    syncTimeBtnEls.forEach(function(button){

        const minSec = Number(button.dataset.minSec);

        const targetMs = getSyncStartTargetMs(nowMs,minSec);

        button.dataset.targetMs = String(targetMs);

        const mainEl = button.querySelector(".sync-time-main");
        const restEl = button.querySelector(".sync-time-rest");

        if(mainEl){ mainEl.textContent = formatSyncClock(targetMs); }

        if(restEl){ restEl.textContent = "あと" + Math.ceil((targetMs - nowMs) / 1000) + "秒"; }

    });

}

/**
 * カウントダウンの「あと◯秒」を書き換えます。
 *
 * 開始時刻を過ぎても始まらない時(画面が消えてタイマーが止められた等)は、
 * 諦めて知らせます(いつまでも「あと0秒」のまま待たせないように)。
 *
 * @param {number} nowMs - 今の時刻(Date.now())
 */
function refreshSyncCountdown(nowMs){

    if(!syncCountdown){ return; }

    const restSec = Math.max(0,Math.ceil((syncCountdown.targetWallMs - nowMs) / 1000));

    if(syncCountdownRestEl){ syncCountdownRestEl.textContent = String(restSec); }

    if(nowMs > syncCountdown.targetWallMs + SYNC_LATE_GIVEUP_MS){

        console.warn("同期モード ③ 開始時刻を過ぎても始まらなかったので取りやめました");

        cancelSyncCountdown("⚠️ 時刻までに間に合いませんでした。<br>もう一度、時刻を選んでください");

    }

}

/**
 * ③ の見た目(選ぶ姿 / カウントダウンの姿)を、今の状態に合わせます。
 */
function refreshSyncStartStep(){

    const counting = (syncCountdown !== null);

    if(syncStartChooseEl){ syncStartChooseEl.style.display = counting ? "none" : ""; }
    if(syncStartCountdownEl){ syncStartCountdownEl.style.display = counting ? "" : "none"; }

    if(counting){

        if(syncCountdownTargetEl){
            syncCountdownTargetEl.textContent = formatSyncClock(syncCountdown.targetWallMs);
        }

        /*
        どの曲を、どこから鳴らすか。曲名が入るので textContent で入れます
        (曲名に < や > が入っていても、画面が壊れないように)。
        */
        if(syncCountdownPlanEl){
            syncCountdownPlanEl.textContent = syncCountdown.planText || "曲を準備しています…";
        }

        refreshSyncCountdown(Date.now());

    }

    if(syncStartGuideEl){

        syncStartGuideEl.innerHTML = counting
            ? "やめると、時刻を選び直せます"
            : (syncState.startNotice || "押した時刻に、みんなの曲が<br>一斉にスタートします");

    }

}

/**
 * 時刻ボタンが押された時の処理です。
 *
 * @param {HTMLButtonElement} button - 押されたボタン
 */
function handleSyncTimeButton(button){

    // すでにカウントダウン中なら何もしません(二重に予約しない)
    if(syncCountdown){ return; }

    // ①②が決まっていなければ、ここには来ないはずですが念のため
    if(!syncState.pitchDecided || !syncState.latencyDecided || syncState.latencyMs === null){ return; }

    const targetWallMs = Number(button.dataset.targetMs);

    if(!isFinite(targetWallMs)){ return; }

    scheduleSyncStart(targetWallMs);

}

/**
 * 開始時刻に曲がスタートするよう、準備と予約をします。
 *
 * ⚠️ **ボタンを押した瞬間(人の操作の中)に呼ぶのが要です。**
 *    画面を消さないお願い(Wake Lock)や、曲を載せる時のファイルの
 *    権限確認は、人の操作の中でないと断られることがあるためです。
 *
 * @param {number} targetWallMs - 開始時刻(Date.now() の物差し)
 */
async function scheduleSyncStart(targetWallMs){

    /*
    この約束の目印です。準備の途中で「やめる」が押されると syncCountdown が
    別物(または null)になるので、await から戻るたびに「まだ自分の約束か」を
    確かめます。確かめないと、やめたはずのスタートが後から動き出します。
    */
    const token = {};

    syncCountdown = {
        token:token,
        targetWallMs:targetWallMs,
        plan:null,
        planText:"",
        wPerfMs:0,
        warmStarted:false
    };

    syncState.startNotice = "";

    refreshSyncStartStep();

    // 画面を消さないようにお願いします(待っている間に消えると、タイマーが止められるため)
    requestSyncWakeLock();

    // 音の出口を用意して、眠っていたら起こします(人の操作の中で)
    ensureDeckAudioGraph();
    resumeDeckAudio();

    // ---- ① 🕺ノリノリRun再生に入り、みんなのピッチにします ----

    if(!isNoriRunMode){

        await enterNoriRunMode();

        if(!syncCountdown || syncCountdown.token !== token){ return; }

        if(!isNoriRunMode){

            cancelSyncCountdown("⚠️ 🕺ノリノリRun再生に入れませんでした");

            return;

        }

    }

    applySyncPitch();

    // ---- ② どの曲を、どの位置から鳴らすか ----

    const plan = await prepareSyncPlan();

    if(!syncCountdown || syncCountdown.token !== token){

        /*
        準備の間に「やめる」が押されていました。曲を音量0で載せていたら
        1に戻しておきます(でないと、次に▶を押した時に無音のまま鳴ります)。
        */
        if(plan){ setDeckVolume(audioPlayer,1); }

        return;

    }

    if(!plan){

        cancelSyncCountdown("⚠️ 曲を用意できませんでした。<br>もう一度、時刻を選んでください");

        return;

    }

    // ---- ③ いつ動くかを決めます ----

    // 送り出す時刻 = 開始時刻 − 自分の遅延(遠い人ほど早く家を出る)
    const sendWallMs = targetWallMs - syncState.latencyMs;

    // 頭から鳴らす時は、無音のぶんだけ後ろで曲の頭が来ます
    const wWallMs = sendWallMs + plan.silenceMs;

    // 時計の時刻を、performance.now() の物差しに直します(上の説明)
    const wPerfMs = performance.now() + (wWallMs - Date.now());

    syncCountdown.plan = plan;
    syncCountdown.planText = plan.text;
    syncCountdown.wPerfMs = wPerfMs;

    // 先に鳴らし始める予約(3秒前)。もう3秒を切っていたら、すぐに
    const warmDelayMs = Math.max(0,wPerfMs - SYNC_WARMUP_SEC * 1000 - performance.now());

    syncStartTimerIds.push(setTimeout(syncWarmup,warmDelayMs));

    /*
    頭出しの予約。命令を出すべき瞬間 = 狙いの瞬間の14ms前(頭出しに
    かかる時間)。setTimeout が遅れた分は、syncFire() が狙う位置を
    先へずらして打ち消します(syncFire の【遅れの打ち消し】)。
    */
    const fireDelayMs = Math.max(0,wPerfMs - SYNC_SEEK_LEAD_MS - performance.now());

    syncStartTimerIds.push(setTimeout(syncFire,fireDelayMs));

    refreshSyncStartStep();

    console.log(
        "同期モード ③ スタートを予約しました : 開始 " + formatSyncClock(targetWallMs),
        "/ 遅延 " + syncState.latencyMs + "ms ぶん早く送り出す",
        "/ " + plan.text,
        (plan.silenceMs > 0 ? "/ 頭の前の無音 " + plan.silenceMs.toFixed(0) + "ms" : ""),
        "/ ピッチ " + syncState.pitch,
        "/ あと " + ((wPerfMs - performance.now()) / 1000).toFixed(1) + "秒"
    );

}

/**
 * ①で決めたピッチを、今回だけ🕺ノリノリRunのマイピッチにします。
 *
 * ⚠️ DB には書きません(竹弘と合意「このピッチは今回だけ」)。
 *    js/norirun.js の2つの変数を、その場で書き換えるだけです。
 *
 *    noriRunMyPitch   … いま鳴らすテンポ
 *    noriRunBasePitch … 「マイピッチ」ボタンで戻る先
 *
 *    両方をみんなのピッチにしておくので、走行中にうっかり「マイピッチ」
 *    ボタンを押しても、みんなのピッチのままです。ノリノリRunを出て
 *    入り直すと、js/norirun.js がDBからいつものピッチを読み直すので、
 *    **いつものマイピッチは何も変わりません。**
 */
function applySyncPitch(){

    noriRunMyPitch = syncState.pitch;
    noriRunBasePitch = syncState.pitch;

    updateNoriRunPitchDisplay();

    applyNoriRunPitch();

}

/**
 * どの曲を、どの位置から鳴らすかを決めます。必要なら曲を載せます。
 *
 * 竹弘の条件:
 *     (1)(2) 止めていた曲 … 止めた位置の直後の拍から
 *     (3)    曲が無い時   … 一覧のトップの曲から(拍を合わせて)
 *
 * @return {Promise<Object|null>} 決めた内容。用意できなければ null
 *         trackId   … 鳴らす曲
 *         targetSec … 狙いの位置(曲の何秒目)
 *         silenceMs … 送り出す時刻から、狙いの位置が鳴るまでの無音(ms)
 *         text      … 画面に出す説明
 */
async function prepareSyncPlan(){

    const current = libraryMap[currentTrackId];

    /*
    ---- 止めていた曲を「続きから」鳴らせるか ----

    ・今のデッキに本当にその曲が載っている(getDeckTrack で確かめる)
    ・ノリ注入済み(拍の位置が分かる)で、除外されていない
    */
    if(current &&
       audioPlayer.src &&
       getDeckTrack(audioPlayer) === current &&
       hasSavedTapResult(current) &&
       !isExcluded(current)){

        const resumePlan = buildSyncResumePlan(current,audioPlayer.currentTime);

        if(resumePlan){ return resumePlan; }

        /*
        繋ぐ位置に近すぎて続きからは鳴らせない時は、同じ曲を頭から鳴らします
        (SYNC_RESUME_MARGIN_SEC のコメント)。曲はもう載っているので、
        載せ直しは要りません。
        */
        console.log("同期モード ③ 繋ぐ位置に近いので、この曲を頭から鳴らします :",current.file_name);

        return buildSyncHeadPlan(current);

    }

    // ---- 一覧のトップの曲を「頭から」 ----

    const topId = findSyncTopTrackId();

    if(!topId){ return null; }

    const loaded = await loadSyncTrackSilently(topId);

    if(!loaded){ return null; }

    syncState.trackChanged = true;

    return buildSyncHeadPlan(libraryMap[topId]);

}

/**
 * 「続きから」鳴らす時の内容を作ります。
 *
 * 止めた位置の**直後の拍**を狙いの位置にし、それを送り出す時刻に
 * 鳴らします(無音は無し)。
 *
 * 【直後の拍の求め方】
 *
 * その曲の拍は「0拍目 + 1拍の長さ × k」の位置にあります(曲の中の秒)。
 * 止めた位置から見て、それ以上で最初の拍を切り上げで求めます。
 *
 * @param  {Object} track   - 止めていた曲
 * @param  {number} pausedSec - 止めた位置(曲の何秒目)
 * @return {Object|null} 繋ぐ位置に近すぎる時は null
 */
function buildSyncResumePlan(track,pausedSec){

    // 曲の中での1拍の長さ(元テンポの1拍。再生速度で伸び縮みする前)
    const beatSongSec = 60 / getEffectiveBaseBpm(track);

    const beat0Sec = getBeat0AtSec(track);

    if(!isFinite(beatSongSec) || beatSongSec <= 0){ return null; }

    /*
    - 0.000001 は計算の誤差よけです。止めた位置がちょうど拍の上だった時、
    誤差で「次の拍」まで1拍飛ばされないようにします。
    */
    const k = Math.ceil((pausedSec - beat0Sec) / beatSongSec - 0.000001);

    const targetSec = beat0Sec + k * beatSongSec;

    // 繋ぐ位置まで、実時間で20秒以上残っているか
    const rate = getTrackRate(track);

    if(targetSec < 0 || targetSec + SYNC_RESUME_MARGIN_SEC * rate > track.endTS){ return null; }

    return {
        trackId:currentTrackId,
        targetSec:targetSec,
        silenceMs:0,
        text:"▶ 『" + buildTitleText(track) + "』を続きから(止めた位置の直後の拍から)"
    };

}

/**
 * 「頭から」鳴らす時の内容を作ります。
 *
 * 曲の頭(0秒)を狙いの位置にし、送り出す時刻から「無音」のぶんだけ
 * 後ろで鳴らします。無音の長さは、曲の拍がみんなの拍の格子に乗るよう
 * 0〜1拍未満で決めます(🎬頭出し接続と同じ考え方。竹弘の案)。
 *
 * 【無音の長さの求め方】
 *
 *     曲の中で、0秒以上の最初の拍 … gFirst(曲の秒)
 *     それが鳴るのは、曲の頭から gFirst ÷ 再生速度 秒後(実秒)
 *
 *     送り出す時刻 + 無音 + gFirst ÷ 再生速度 が、拍の格子に乗ればよい
 *     → 無音 = 「−gFirst ÷ 再生速度」を1拍で割った余り(0〜1拍未満)
 *
 * ⚠️ ちょうど1拍の無音ではありません。曲の頭が拍の上にあるとは
 *    限らないので、無音の長さで合わせます(竹弘と確認済み)。
 *
 * @param  {Object} track - 頭から鳴らす曲(もうデッキに載っている)
 * @return {Object}
 */
function buildSyncHeadPlan(track){

    const beatSongSec = 60 / getEffectiveBaseBpm(track);

    const beat0Sec = getBeat0AtSec(track);

    const rate = getTrackRate(track);

    // 0秒以上で最初の拍(曲の秒)
    const gFirstSec = beat0Sec - Math.floor(beat0Sec / beatSongSec) * beatSongSec;

    // 1拍の長さ(実秒)
    const beatRealSec = beatSongSec / rate;

    // 余りを「必ず0以上」で求めます(JavaScript の % は負の数だと負を返すため)
    const silenceSec = (((-gFirstSec / rate) % beatRealSec) + beatRealSec) % beatRealSec;

    return {
        trackId:currentTrackId,
        targetSec:0,
        silenceMs:silenceSec * 1000,
        text:"▶ 『" + buildTitleText(track) + "』を頭から"
    };

}

/**
 * 🕺ノリノリRunの一覧で、いちばん上の「鳴らせる曲」を探します。
 *
 * ノリノリRunの一覧は、並び順(currentOrderList)のうちノリ注入済みの
 * 曲だけを並べたものです(js/norirun.js の refreshNoriRunList)。
 * 除外されている(再生できない)曲は飛ばします。
 *
 * @return {string|null} 曲の track_id。無ければ null
 */
function findSyncTopTrackId(){

    for(const trackId of currentOrderList){

        const track = libraryMap[trackId];

        if(track && hasSavedTapResult(track) && !isExcluded(track)){ return trackId; }

    }

    return null;

}

/**
 * 曲を、音を出さずにデッキへ載せます(頭から鳴らす時の準備)。
 *
 * 【なぜ playTrack を借りるのか】
 *
 * 曲を載せる手順(権限の確認・ファイルの取得・デッキの交代・画面の
 * 曲名・ロック画面の曲名・再生回数…)は js/player.js の playTrack() に
 * まとまっています。**同じ手順を書き写すと、片方だけ直す事故が起きる**
 * ので、そのまま借ります。
 *
 * ただし playTrack() はすぐに鳴らし始めるので、その前に**消音**にして
 * おき、鳴った直後に止めて音量を0にします。消音なので何も聞こえません。
 * 消音は元の状態に戻します(竹弘が🔈で消音していたら、消音のまま)。
 *
 * @param  {string} trackId
 * @return {Promise<boolean>} 載せられたら true
 */
async function loadSyncTrackSilently(trackId){

    const mutedBefore = audioPlayer.muted;

    setBothDecksMuted(true);

    let loaded = false;

    try{

        loaded = await playTrack(trackId);

    }
    catch(error){

        console.error("同期モード ③ 曲を載せられませんでした :",error);

    }

    if(loaded){

        // 開始まで止めておき、音量も0にしておきます(スタートの時に上げます)
        audioPlayer.pause();

        setDeckVolume(audioPlayer,0);

    }

    setBothDecksMuted(mutedBefore);

    return loaded;

}

/**
 * 開始の3秒前:曲を「消音・音量0」で先に鳴らし始めます。
 *
 * 狙いの位置の3秒手前から鳴らしておくと、頭出し(②)の時に動かす距離が
 * 短くて済みます(頭から鳴らす時は、曲の頭から)。
 */
function syncWarmup(){

    if(!syncCountdown || !syncCountdown.plan || syncCountdown.warmStarted){ return; }

    const plan = syncCountdown.plan;

    syncCountdown.warmStarted = true;

    // 竹弘の消音の状態を覚えてから、消音にします(スタートの時に戻します)
    syncMutedBefore = audioPlayer.muted;

    setBothDecksMuted(true);

    setDeckVolume(audioPlayer,0);

    const rate = audioPlayer.playbackRate || 1;

    audioPlayer.currentTime = Math.max(0,plan.targetSec - SYNC_WARMUP_SEC * rate);

    const playing = audioPlayer.play();

    if(playing && typeof playing.catch === "function"){

        playing.catch(function(error){

            console.error("同期モード ③ 先に鳴らし始められませんでした :",error.name,error.message);

        });

    }

    console.log("同期モード ③ 開始の" + SYNC_WARMUP_SEC + "秒前 : 消音・音量0で先に鳴らし始めました");

}

/**
 * その瞬間:狙いの位置へ頭出しし、終わったら音量を上げます。
 *
 * 🎬頭出し接続の raiseHeadConnectVolume()(js/connect.js)と同じ3つの入口で
 * 待ちます(もう終わっていた / seeked が届いた / 0.1秒で時間切れ)。
 * 時間切れが無いと、万一 seeked が来なかった時に**永久に無音**になります。
 *
 * ------------------------------------------------------------
 * 【遅れの打ち消し】
 *
 * setTimeout は、スマホが忙しいと数ms〜十数ms遅れて起きます。
 * その遅れのぶん**頭出しの命令が遅れ**、そのままでは拍もそのぶん遅れます。
 *
 * そこで、遅れたぶんだけ**狙う位置を先へずらします。**
 *
 *     予定どおりなら … 狙いの位置 X へ頭出し
 *     10ms遅れたら   … X + 10ms × 再生速度 の位置へ頭出し
 *                      (本来その瞬間に鳴っているはずの位置)
 *
 * 拍が揃うかどうかは「その時刻に曲がどの位置にあるか」だけで決まるので、
 * これで遅れは丸ごと打ち消されます。聞こえ始めがそのぶん遅れるだけです。
 *
 * ⚠️ v224の途中までは、最後の40msを「時計を見張って待つ」書き方でした。
 *    その間は画面が固まるうえ、検証に使う見えないChromeでは時計が
 *    止まるため**永久に終わらない**ことが分かりました。位置をずらす方が
 *    画面を固めず、遅れがどれだけ大きくても効くので、こちらにしました。
 *
 *    ただし頭から鳴らす時は、ずらしたぶん曲の頭がわずかに欠けます
 *    (10ms遅れなら頭の10ms)。耳では分からない長さです。
 */
function syncFire(){

    if(!syncCountdown || !syncCountdown.plan){ return; }

    const countdown = syncCountdown;
    const plan = countdown.plan;
    const deck = audioPlayer;

    // 万一、先に鳴らし始めるのが間に合っていなかったら、ここで
    if(!countdown.warmStarted){ syncWarmup(); }

    const issuedAtMs = performance.now();

    // 本来の命令の瞬間(狙いの14ms前)から、どれだけ遅れたか
    const lateMs = issuedAtMs - (countdown.wPerfMs - SYNC_SEEK_LEAD_MS);

    const rate = deck.playbackRate || 1;

    /*
    遅れたぶん、狙う位置を先へずらします(上の【遅れの打ち消し】)。
    万一早く起きた(マイナス)時も同じ式で手前へずらせますが、曲の頭より
    前(0秒未満)には行けないので、0で止めます。
    */
    const seekToSec = Math.max(0,plan.targetSec + lateMs / 1000 * rate);

    deck.currentTime = seekToSec;

    let raised = false;

    const raise = function(why){

        if(raised){ return; }

        raised = true;

        deck.removeEventListener("seeked",onSeeked);

        const doneAtMs = performance.now();

        // 消音を元に戻して、30msで音量を上げます(🎬と同じ上げ方)
        setBothDecksMuted(syncMutedBefore);

        startFade(deck,0,1,CONNECT_HEAD_FADE_SEC);

        // 何かの理由で止められていた時の保険
        if(deck.paused){

            deck.play().catch(function(error){

                console.error("同期モード ③ 再生に失敗 :",error.name,error.message);

            });

        }

        console.log(
            "同期モード ③ スタートしました : 頭出しの待ち " + (doneAtMs - issuedAtMs).toFixed(0) + "ms(" + why + ")",
            "/ 命令の遅れ " + formatSyncSignedMs(lateMs) + "(位置をずらして打ち消し済み)"
        );

        finishSyncStart();

        measureSyncAlignment(deck,plan.targetSec,countdown.wPerfMs);

    };

    const onSeeked = function(){ raise("頭出し完了"); };

    if(!deck.seeking){

        raise("待ち不要");

        return;

    }

    deck.addEventListener("seeked",onSeeked);

    setTimeout(function(){ raise("時間切れ"); },CONNECT_HEAD_SEEK_WAIT_MAX_SEC * 1000);

}

/**
 * スタートした後の片付けです。同期モードの画面を閉じて、🕺ノリノリRunの
 * 画面を見せます(竹弘の指定「曲が再生開始されたら『ノリノリRun』
 * 再生画面を表示」)。
 *
 * ⚠️ closeSyncPanel() は使いません。あちらは「やっぱりやめた」時の
 *    閉じ方で、開いた時に鳴っていた曲を鳴らし直してしまうためです。
 */
function finishSyncStart(){

    syncStartTimerIds.forEach(function(id){ clearTimeout(id); });
    syncStartTimerIds = [];

    syncCountdown = null;

    releaseSyncWakeLock();

    stopSyncClock();
    stopSyncTempoSound();
    stopSyncMeasure();

    syncRuler.stop();

    if(syncPanelEl){ syncPanelEl.style.display = "none"; }

    syncState.wasPlaying = false;
    syncState.running = true;

    refreshSyncStartStep();

}

/**
 * スタート後、曲の位置が予定どおりかを10回測って🐛パネルに出します。
 *
 * 予定の位置 = 狙いの位置 + (今 − 狙いの瞬間) × 再生速度
 * ずれ(ms)  = (実際の位置 − 予定の位置) ÷ 再生速度
 *             プラス … 予定より早い / マイナス … 予定より遅い
 *
 * ⚠️ これは「このスマホの中で、予定どおりに始められたか」の確かめです。
 *    2台の拍が本当に揃っているかは、耳で確かめます(ノリノリアシストの
 *    カチッが1つに重なって聞こえるか)。
 *
 * @param {HTMLAudioElement} deck      - 鳴らし始めたデッキ
 * @param {number}           targetSec - 狙いの位置(曲の何秒目)
 * @param {number}           wPerfMs   - 狙いの瞬間(performance.now の物差し)
 */
function measureSyncAlignment(deck,targetSec,wPerfMs){

    const rate = deck.playbackRate || 1;

    const errors = [];

    const sample = function(){

        // 途中で曲が変わった・止まった時は、そこまでで打ち切ります
        if(deck !== audioPlayer || deck.paused){

            report("途中で曲が変わったか止まったため " + errors.length + "回で打ち切り");

            return;

        }

        const expectedSec = targetSec + (performance.now() - wPerfMs) / 1000 * rate;

        errors.push((deck.currentTime - expectedSec) / rate * 1000);

        if(errors.length < SYNC_MEASURE_COUNT){

            setTimeout(sample,SYNC_MEASURE_INTERVAL_MS);

        }
        else{

            report(SYNC_MEASURE_COUNT + "回");

        }

    };

    const report = function(note){

        if(errors.length === 0){ return; }

        const mean = errors.reduce(function(a,b){ return a + b; },0) / errors.length;

        console.log(
            "同期モード ③ スタート位置の実測 : 予定とのずれ 平均 " + formatSyncSignedMs(mean),
            "(最小 " + formatSyncSignedMs(Math.min.apply(null,errors)) +
            " / 最大 " + formatSyncSignedMs(Math.max.apply(null,errors)) + " / " + note + ")",
            "※プラスは予定より早い、マイナスは遅い"
        );

    };

    setTimeout(sample,SYNC_MEASURE_DELAY_MS);

}

/**
 * ミリ秒を「+12ms」「-3ms」の形にします(ログ用)。
 */
function formatSyncSignedMs(ms){

    const rounded = Math.round(ms);

    return (rounded >= 0 ? "+" : "") + rounded + "ms";

}

/**
 * カウントダウンを取りやめます(「やめる」・✕・①②の選び直し・時間切れ)。
 *
 * 先に鳴らし始めていたら止め、消音と音量を元に戻します。
 * ⚠️ 音量を1に戻し忘れると、次に▶を押した時に**無音のまま鳴ります。**
 *
 * @param {string} notice - ③の下に出す知らせ(空なら出さない)
 */
function cancelSyncCountdown(notice){

    if(!syncCountdown){ return; }

    const countdown = syncCountdown;

    syncCountdown = null;

    syncStartTimerIds.forEach(function(id){ clearTimeout(id); });
    syncStartTimerIds = [];

    if(countdown.warmStarted){

        audioPlayer.pause();

        setBothDecksMuted(syncMutedBefore);

    }

    if(countdown.plan){ setDeckVolume(audioPlayer,1); }

    releaseSyncWakeLock();

    syncState.startNotice = notice || "";

    refreshSyncStartStep();

    console.log("同期モード ③ カウントダウンを取りやめました");

}

/**
 * 画面を消さないようにお願いします(Screen Wake Lock)。
 *
 * 待っている間に画面が消えると、スマホがタイマーを止めてしまい、
 * 時刻に間に合わなくなるためです。使えないブラウザでは何もしません。
 */
async function requestSyncWakeLock(){

    try{

        if(navigator.wakeLock && !syncWakeLock){

            syncWakeLock = await navigator.wakeLock.request("screen");

        }

    }
    catch(error){

        console.warn("同期モード ③ 画面を消さないお願いができませんでした :",error.name,error.message);

    }

}

/**
 * 画面を消さないお願いを取り下げます(スタートした後・やめた時)。
 */
function releaseSyncWakeLock(){

    if(!syncWakeLock){ return; }

    const lock = syncWakeLock;

    syncWakeLock = null;

    lock.release().catch(function(){ /* すでに外れていても構いません */ });

}


// ==========================================================
// 6. テンポの音(定規を触った時のカチッ)
// ==========================================================
/*
初期設定の定規と同じく、触るとテンポの音が鳴り始めます。
定規を動かすと、音の速さもその場で変わります。

【どの音を、どこから鳴らすか】

  音     … 「カチッ」(click.wav)。初期設定の定規と同じ音源です。
            読み込みは js/metronome.js の loadMetronomeClick() に任せ、
            読み込んだ音(metronomeClickBuffer)を借ります。
            ⚠️ 同じファイルを2回読み込まないためです。

  出口   … js/deck.js が作った deckAudioCtx(曲と同じ音の出口)。
            ⚠️ **AudioContext を自分で新しく作らないこと。** v157で、
               作っては閉じることが「ブッ」というノイズの原因だったと
               判明しています。アプリ全体で1つだけ使い回す決まりです。

  頭の無音 … click.wav は先頭に約190msの無音を抱えているので、
            ノリノリアシストと同じく、そこを読み飛ばして鳴らします
            (METRONOME_CLICK_OFFSET_SEC。js/metronome.js)。
*/

/**
 * テンポの音を鳴らし始めます(定規に触った時に呼ばれます)。
 */
function startSyncTempoSound(){

    // すでに鳴っていれば何もしません(触るたびに二重に鳴らさない)
    if(syncTempoTimerId){ return; }

    // 決定済みの①では鳴らしません(定規もロックされていますが念のため)
    if(syncState.pitchDecided){ return; }

    /*
    音の出口を用意して、眠っていたら起こします。

    ⚠️ **指で触った瞬間の中で呼ぶのが要です。** ブラウザは、人の操作と
       関係なく音を鳴らし始めることを禁じています。曲をまだ1度も
       鳴らしていない時は出口そのものが無いので、ここで作ります
       (曲を鳴らす時 js/player.js が呼んでいるのと同じ2つ)。
    */
    ensureDeckAudioGraph();
    resumeDeckAudio();

    if(!deckAudioCtx){ return; }

    // カチッの音源がまだ無ければ、読み込みを始めます(読めた拍から鳴ります)
    loadMetronomeClick();

    if(!syncTempoGainNode){

        syncTempoGainNode = deckAudioCtx.createGain();

        // 大きさはノリノリアシストのカチッと同じにします
        syncTempoGainNode.gain.value = METRONOME_GAIN_CLICK;

        syncTempoGainNode.connect(deckAudioCtx.destination);

    }

    syncTempoNextSec = deckAudioCtx.currentTime + SYNC_TEMPO_FIRST_DELAY_SEC;

    syncTempoTimerId = setInterval(scheduleSyncTempo,SYNC_TEMPO_TIMER_MS);

    scheduleSyncTempo();

}

/**
 * 見回りのたびに、少し先までのテンポの音を予約します。
 */
function scheduleSyncTempo(){

    if(!deckAudioCtx){ return; }

    const horizon = deckAudioCtx.currentTime + SYNC_TEMPO_LOOKAHEAD_SEC;

    /*
    スマホが忙しくて見回りが大きく遅れた時、過ぎてしまった拍を
    まとめて鳴らすと「ダダダッ」と連打になります。過ぎた分は捨てて、
    今から数え直します。
    */
    if(syncTempoNextSec < deckAudioCtx.currentTime){

        syncTempoNextSec = deckAudioCtx.currentTime + SYNC_TEMPO_FIRST_DELAY_SEC;

    }

    while(syncTempoNextSec < horizon){

        playSyncTempoClick(syncTempoNextSec);

        /*
        次の拍までの長さは、**今この瞬間に定規が指している値**で
        決めます(吸い付きの途中の小数を含む)。初期設定の定規と同じく、
        定規を動かすと音の速さもなめらかに変わります。
        */
        const bpm = syncRuler.getCurrentBpm();

        syncTempoNextSec += 60 / Math.max(bpm,SYNC_PITCH_MIN);

    }

}

/**
 * カチッを1つ予約します。
 *
 * @param {number} atCtxSec - いつ鳴らすか(deckAudioCtx の時計で何秒か)
 */
function playSyncTempoClick(atCtxSec){

    // 音源がまだ読めていなければ、この拍は諦めます(次の拍から鳴ります)
    if(!metronomeClickBuffer){ return; }

    /*
    🔇 消音中は鳴らしません。

    竹弘の要望(2026-09-13)「スピーカーoffにしたらメトロノームも
    音量offにして欲しい」に合わせています。この音は <audio> を通らない
    ので、audioPlayer.muted を自分で見に行く必要があります
    (ノリノリアシストと同じ事情)。
    */
    if(audioPlayer.muted){ return; }

    /*
    音源は1回鳴らすたびに作り捨てます(Web Audio の決まりで、一度
    start() した音源は二度目が使えません。作る負担はごく軽いです)。

    start() の1つ目は「いつ鳴らすか」、2つ目は「音源の何秒目から
    鳴らすか」です。2つ目で頭の無音を読み飛ばしています。
    */
    const source = deckAudioCtx.createBufferSource();

    source.buffer = metronomeClickBuffer;

    source.connect(syncTempoGainNode);

    source.start(atCtxSec,METRONOME_CLICK_OFFSET_SEC);

}

/**
 * テンポの音を止めます。
 *
 * 見回り係を止めるだけです。すでに予約した音(最大0.12秒先まで)は
 * そのまま鳴り終わります。途中で切るとノイズが出るため、わざと
 * 取り消しません。
 */
function stopSyncTempoSound(){

    if(!syncTempoTimerId){ return; }

    clearInterval(syncTempoTimerId);

    syncTempoTimerId = 0;

}


// ==========================================================
// 7. ボタンの結び付け
// ==========================================================

(function bindSyncButtons(){

    const closeBtn = document.getElementById("sync-close-btn");

    if(closeBtn){
        closeBtn.addEventListener("click",function(){
            closeSyncPanel();
        });
    }

    if(syncPitchDecideBtn){
        syncPitchDecideBtn.addEventListener("click",function(){
            decideSyncPitch();
        });
    }

    if(syncPitchResetBtn){
        syncPitchResetBtn.addEventListener("click",function(){
            resetSyncPitch();
        });
    }

    /*
    ② ターンテーブル(v222)。

    ⚠️ click ではなく pointerdown で受けます。click は「指を離した時」に
       起きるので、叩いた瞬間より数十〜百ms遅れます。測りたいのは
       **指が触れた瞬間**なので、触れた時に起きる pointerdown を使います
       (タップ補正と同じ考え方)。
    */
    if(syncLatencyPadEl){
        syncLatencyPadEl.addEventListener("pointerdown",function(event){
            handleSyncPadPress(event);
        });
    }

    if(syncLatencyDecideBtn){
        syncLatencyDecideBtn.addEventListener("click",function(){
            decideSyncLatency();
        });
    }

    if(syncLatencyRedoBtn){
        syncLatencyRedoBtn.addEventListener("click",function(){
            redoSyncLatency();
        });
    }

    /*
    画面の幅が変わった時(折り畳みスマホを開いた・閉じた等)に、
    ターンテーブルの大きさを合わせ直します(v223)。
    */
    window.addEventListener("resize",function(){
        fitSyncDeck();
    });

    // ③ 時刻ボタン(4つ)と「やめる」(v224)
    syncTimeBtnEls.forEach(function(button){
        button.addEventListener("click",function(){
            handleSyncTimeButton(button);
        });
    });

    if(syncCountdownCancelBtn){
        syncCountdownCancelBtn.addEventListener("click",function(){
            cancelSyncCountdown("");
        });
    }

})();
