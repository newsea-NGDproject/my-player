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

 経緯 → devlog/画面とその他.md「3.」(保存の後の当て直し・再生ピッチ。v253〜v254)/
        今の流れの解析と改善の案は private/ の資料(非公開。git に入れない)
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
C地点(v268。段0-5a「🎯 精度を高める」)。A地点・B地点を測り終えた後、最後の確認画面から
入る3つ目の地点です。曲の後半(A〜B の 2/3 のあたり)で A地点からの線が合っているかを聴き、
ずれていたら合わせて、A〜B の拍の数を決め直します(decideTapWholeSongBpmWithC)。

⚠️ 最後の確認画面は「フェーズ B + finalCheck の旗」で表していますが、C地点は独立したフェーズに
   しました。C地点の微調整は B地点の聴く画面と同じ部品を使う一方で、◀▶ の役目・確定の行き先・
   数字の窓の札が違うため、旗を増やすより分かれ道が読みやすいからです。
   phase === TAP_PHASE_A で分けている所は、C を「A ではない方」として B と同じに扱います。
   C で B と違う動きが要る所は、必ず TAP_PHASE_C を名指しで分けています。
*/
const TAP_PHASE_C = "C";

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
/*
⚠️ A地点の初期位置は v184 で 5秒 → 15秒 にしました。

【なぜ15秒なのか ―― 竹弘の説明(2026-09-05)で分かったこと】

    曲の最初はリズムが遅かったり、前奏でリズムがなかったり、
    声のつぶやきだったりすることがあり、曲が曲として安定した
    リズムを刻み始めた所からリズムを採取する意味だったんだ。

つまりこのボタンは「位置をずらす」機能ではなく、**曲本来のBPMを
取得できる一番いい区間を探すための道具**でした。だからA地点は
**後ろへ**動かすのが本命で、前倒しにはほとんど意味がありません。

竹弘は実際に毎回「5秒 ▶」を2回押して15秒あたりに合わせていたので、
最初からそこに置きます。**369曲ぶんで738回のタップが減ります。**

⚠️ 60秒未満の曲は対象外(TAP_MIN_DURATION_SEC)なので、15秒が曲の
   長さを超えることはありません。
*/
const TAP_POS_A_DEFAULT_SEC = 15;

/*
A地点をこれより手前には置けません(v184)。

【なぜ下限が要るのか ―― 「助走が届かない曲」の予防】

後続曲は0拍目より手前から裏で鳴らし始めますが、A地点を曲の頭近くに
置くとその「手前」が無くなり、**その曲へは接続が成立しなくなります**
(js/connect.js の CONNECT_MIN_PRE_ROLL_SEC を参照)。

上に書いたとおり**A地点を前倒しする意味はもともと無い**ので、
下限を設けても竹弘の使い方は1ミリも狭まりません。
図解と経緯は `docs/connect-preroll-limit.html` にあります。

⚠️ **B地点には適用しません。** B地点は逆に「前へ戻す」のが本命だから
   です(竹弘:「曲の最後はリズムがなくなり、ピッチも遅くなっていく曲も
   よくある。だからA地点とは逆に5秒遡りのボタンが重要になってくる」)。
*/
const TAP_POS_A_MIN_SEC = 3;

/*
A地点とB地点を分ける境目です(v185)。曲の長さに対する割合。

    **A地点は曲の前半にしか置けない。B地点は後半にしか置けない。**

【竹弘の指摘(2026-09-05)】

    B地点を◀5秒で0秒まで戻す事はしないし、そこまで戻されるとA地点の
    13拍目を通りこしてB地点の方が先になり、1つの曲としての再生時系列が
    おかしくなってしまうので、B地点は絶対A地点を超えてはいけない

    (続けて)逆に、A地点の上限はB地点を超えない閾値お願いしたい。

`endTS < startTS`(13拍目が1拍目より前)になると、繋いだ瞬間に曲が
巻き戻ったように聞こえます。**両側から線を引けば、この破綻は
起こりようがありません。**

【なぜ「割合」で1本の線を引くのが良いのか】

A地点を測っている時、B地点はまだ決まっていません。逆にB地点を測る時、
A地点はもう確定しています。**片方からもう片方を参照できない場面がある**
ので、「曲の真ん中」という**どちらからも見える基準**に揃えました。

    A地点 …… 0% ────────── 50%
    B地点 ……            50% ────────── 100%

これなら順序が入れ替わることは原理的にありません。

【破綻を防ぐだけが目的ではない】

もう1つ見落とせない副作用があります。**endTS は接続点なので、そこから
先の曲は次の曲に譲ります**(クロスフェード中を除く)。つまりB地点を前に
戻すほど、**その曲の後半が丸ごと聴けなくなります。**

    5分の曲で endTS を2分に置くと → 後半3分は一度も聴けない

竹弘が「頭出し接続」で**曲を最後まで聴きたい**と言っていたことを思うと、
戻しすぎは狙いと逆に働きます。だからこの線は「破綻を防ぐ」と
「戻しすぎを防ぐ」の両方を担っています。

    5分の曲 … B地点は下限150秒 / 初期値275秒 → 125秒ぶん戻せる
    3分の曲 … B地点は下限 90秒 / 初期値155秒 →  65秒ぶん戻せる

終盤のリズム崩れから逃げるには十分な幅です。A地点側も、前半のうちで
「曲が安定したリズムを刻み始めた所」を探すには十分な範囲が残ります。
*/
const TAP_POS_SPLIT_RATIO = 0.5;

/*
B地点は、A地点の1拍目(startTS)から最低でもこれだけ離します(v185)。

【なぜ「曲の50%」だけでは足りないのか】

A地点を大きく後ろへ動かした曲では、50%の線がA地点より前に来ます。

    5分の曲でA地点を3分に置いた場合
      50%の線 = 150秒  ←  A地点(180秒)より前！

これだとB地点をA地点より前に置けてしまい、防ぎたかった破綻がそのまま
起きます。だから2つの条件のうち**後ろにある方**を採ります。

【なぜ30秒ではなく15秒なのか】

のりは当初30秒で提案しましたが、計算すると**短い曲で成立しません**でした。

    60秒の曲(対象となる最短) … A地点15秒 → startTS≒16秒
      B地点の初期値 = 60 − 25 = 35秒
      下限が 16+30 = 46秒 だと、**初期値より後ろ**になり置き場所が無い

15秒なら下限31秒 < 初期値35秒 で成立します。B地点で12回叩くのに要る
時間(BPM120で約6秒、BPM60でも約12秒)も十分に収まる長さです。
*/
const TAP_POS_B_MIN_GAP_SEC = 15;

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

/*
A地点〜B地点の間の拍の数を数えた時、端数がこれより小さければ
「数え違いの心配はない(安心)」とみなします(v263 で作り、v267 から保存の判断に使う)。

    429.13拍 … 端数 0.13 → 429拍で安心
    429.24拍 … 端数 0.24 → 怪しい(B地点が1/4拍ずれていそう)
    429.48拍 … 端数 0.48 → 429拍か430拍か決められない(怪しい)

(v267)0.25 → 0.2 に締めました。v263〜v266 の実機のログで、B地点を叩き直した
Three Empty Words が端数 0.24 で、前の測定と比べると B地点が約1/4拍ずれていた
ためです(B地点を引き継いだ曲は 0.00、B地点で遅延を動かした曲は 0.10〜0.17 だった)。
数字の記録は private/tap-correction.html の9章(非公開)。
*/
const TAP_WHOLE_SONG_SAFE_FRAC = 0.2;

/*
C地点(v268。段0-5a)をどこに置くかです。A地点の1拍目(startTS)から B地点の13拍目(endTS)
までを 1 とした割合で決めます(竹弘と決めた 2026-11-09)。

    TAP_C_POS_RATIO … 最初に置く所。2/3
    TAP_C_MIN_RATIO … ◀▶ で動かせる前の端。0.6
    TAP_C_MAX_RATIO … ◀▶ で動かせる後ろの端。0.8

    4分30秒の曲なら:最初は 2:52 ごろ(2番サビのあたり)・動かせるのは 2:37〜3:24(5秒ずつで約9回)

【なぜ真ん中(0.5)に置かないのか】
C地点は「A の1拍目から何拍目か」を数えて使います。真ん中に置くと、C の拍を1つ数え違えても
B までの拍の数がちょうど2つずれるだけで端数が出ないので、計算で気づけません(間違ったBPMが
✅ のまま保存される)。2/3 なら、1つの数え違いが B で端数 0.5 になって必ず ⚠️ で気づけます。
0.6〜0.8 は、この「気づける」が保てる範囲です(端に行くほど気づく力は弱くなります)。
くわしい見積もりは private/tap-correction.html の10章(非公開)。

【曲の流れから見ても】
2/3 はたいてい2番サビのあたりで、拍がはっきりしていて耳で合わせやすい所です。0.8 より後ろは
Cメロ・落ちサビ・ラップなど、テンポや乗りが変わりやすい所に入りやすいので、そこで止めます。
竹弘:「テンポが大きく揺れる曲はユーザーが判断できるので、曲の代表テンポとなる所まで
       前後±5秒変更ボタンで対処する」(2026-11-09)

⚠️ ◀▶ が動かすのは「C地点そのもの」です(B地点の ◀▶ は聴く位置だけ。竹弘と決めた 2026-11-09)。
*/
const TAP_C_POS_RATIO = 2 / 3;
const TAP_C_MIN_RATIO = 0.6;
const TAP_C_MAX_RATIO = 0.8;

/*
A・B・C で耳で合わせたテンポを「同じ」とみなす差の上限です(v270)。割合で、0.01 = 1%。
judgeTapTempoSide がこの線で「どこだけテンポが違うか」を見分けます。

【なぜ 1% なのか】
・B・C は聴ける時間が短く、耳で合わせたテンポには ±0.2〜0.3% くらいの誤差が出ます
  (BPM 90 で 0.3% 違っても、20秒で約6ms しかずれないので、耳では分かりにくい)。
  これより狭くすると、同じテンポの曲を「違う」と取り違えます
・A+B が ✅ になる曲は、A と B のテンポの差が 0.15% くらいより小さい(拍の数を同じに数えられる幅)
・MISIA アイノカタチ(イントロだけ 88、本編 90)の差は 2.3%。この形の曲は、はっきり見分けられる
⚠️ 実際の曲で試して決め直す値です(竹弘と決めた 2026-11-09。「違う」とみなす差は試験の結果を見て決める)。
*/
const TAP_TEMPO_SAME_FRAC = 0.01;


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

    /*
    【開発用調査ログ】(v263)指が画面に触れた瞬間の時刻(秒)。taps と同じ順番で並びます。

    taps は「指の知らせを受け取った処理が動いた瞬間」の音の時計で取っています。
    画面が忙しいと数ms 遅れて揺れうるので、指が触れた瞬間の時刻
    (event.timeStamp。同期モードの③が使っているもの)と、どちらがばらつきが
    小さいかを🐛で比べます(logTapTimingCompare)。⚠️ 計算には使っていません。
    */
    tapFingerSec: [],

    /*
    【開発用調査ログ】(v263)A+B の数字を🐛に出すための控え(logTapWholeSong)。
    ⚠️ 計算・保存には使っていません。

        bpmA       … A地点を確定した時のBPM
        latencyA   … A地点を確定した時の遅延(B地点で動かしたかを見るため)
        bpmBTapped … B地点を叩き直した時の、その12回から引いた線のBPM
                     (叩き直していなければ null)
    */
    wholeSongLog: { bpmA: null, latencyA: null, bpmBTapped: null },

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

    /*
    C地点で合わせた拍の位置(秒)(v268。段0-5a)。
    startTS・endTS と同じく「結果」で、beatOriginSec + 1拍 × targetBeat から作ります
    (updateTapTargetTS)。⚠️ 保存はしません。A〜B の拍の数を決め直すためだけに使います。
    */
    cTS: 0,

    latencyMs: 0,       // Bluetoothの遅延調整値

    /*
    拍の格子を半拍ずらしているか(v186)。

    【何のための旗か ―― 表打ちと裏打ち】

    曲に合わせて叩く時、拍の頭(表)ではなく拍と拍の間(裏)を叩いて
    しまうことがあります。ノリのいい曲ほど起こりやすい間違いです。

        表打ち … タン ・ タン ・ タン    ← 拍の頭を叩いている
        裏打ち … ・ タン ・ タン ・ タン  ← 半拍ずれた所を叩いている

    **裏打ちでもBPMは正しく測れます**(叩く間隔は同じなので)。
    ずれるのは startTS と endTS だけ、それも**ちょうど半拍**です。

    【裏打ちのままだと何が起こるか】

    接続そのものは壊れません(先行曲も後続曲も同じ13拍目=0拍目で
    繋ぐので、拍の間隔は保たれます)。困るのは次の3つです。

        ・どちらの足で踏む拍かが入れ替わる
        ・のりのりアシストが曲の裏で鳴る
        ・曲のキック(ドン)と足が合わない

    ⚠️ 1つ目は「無音をはさんで繋ぐ」(v173)で既に対策済みです。無音から
       入ると脳が「イチ」を取り直すため。だから半拍ずらしは
       **「転ばないため」ではなく「気持ちよく合わせるため」**の機能で、
       優先度はそう高くありません。

    【なぜ旗が要るのか】

    ずらす時は beatOriginSec(格子の原点)そのものを動かします。動かした
    後の値からは「元がどこだったか」が分かりません。もう一度押して
    元に戻せるようにするために、ずらしたかどうかを覚えておきます。
    */
    halfShifted: false,

    /*
    いま「表打ちの確認」画面にいるか(v187)。

    A地点・B地点を測り終えた最後の一歩です。**フェーズ(phase)を増やさず
    旗にしたのが要**で、こうすると `phase === TAP_PHASE_A` で分かれている
    既存の10か所を1つも書き換えずに済みます(モニターの表示・位置調整の
    範囲・案内文など)。この画面ではそれらの分岐を通らないため、
    B地点のままで支障がありません。
    */
    finalCheck: false,

    /*
    前に測った値を読み戻して開いたか(v153)。

    🕺の曲(測定済み)を開くと、タップを飛ばして微調整画面から始まります。
    この旗が立っている間は、B地点も**保存されている13拍目**をそのまま
    確認してもらいます(A地点から計算し直すと、前回の値の確認になりません)。

    どこかで叩き直したら、その時点で前の値は用済みなので旗を下ろします。
    */
    resumedFromSaved: false,

    /*
    A地点を確定した時の控え(v264)。

    最後の確認画面の「A地点の微調整へ戻る」で、A地点を確定した時と同じ状態に
    戻すために使います(竹弘の要望 2026-11-09。叩き直すほどの直しは少ないので、
    「タップからやり直す」ではなく A地点の微調整へ戻りたい)。
    中身は confirmTapPhase() の A地点の確定で入れます。まだ確定していなければ null。
    */
    phaseASnapshot: null,

    /*
    最後の確認画面で、いま使っている「曲全体のBPM」の判断(v267。保存のログに使います)。

    (v268)C地点で決め直せるようになったので、中身は次のどちらかです。
        C地点を使っていない / C地点で決めきれなかった … wholeSongAB と同じもの
        C地点で決められた                               … { ok:true, bpm, beats, byC:true }
    B地点の確定で最後の確認を開くたびに入れ直すので、それより前の画面では null か前の答えのまま(使わない)。
    */
    wholeSong: null,

    /*
    A地点 + B地点だけで決めた判断(v268。decideTapWholeSongBpm の答え)。
    C地点で決めきれなかった時は、この判断のまま保存します(竹弘と決めた 2026-11-09)。
    結果の1行(updateTapFinalResult)と、C地点に当てる線(startTapPhaseC)にも使います。
    */
    wholeSongAB: null,

    /*
    C地点の結果(v268。decideTapWholeSongBpmWithC の答え)。まだ C地点を使っていなければ null。
    B地点を確定し直した時・A地点の微調整へ戻った時・別の曲を開いた時に null へ戻します
    (C を合わせた線の元が変わるため)。
    */
    cCheck: null,

    /*
    C地点へ入る前の控え(v268)。C地点を確定して最後の確認へ戻る時に書き戻します。
        latencyMs   … C地点で動かしたタイミングは C の位置だけの直しなので、戻ったら元の値に
        halfShifted … 最後の確認で「表打ちにする」を押していたか(押した状態のまま戻すため)
    */
    beforeC: null,

    /*
    B地点の聴く画面で ◀▶ を使って、聴く位置を動かしたか(v269。速度ボタンの支点を決めるのに使う)。

        false … 速度ボタンの支点 = 接続点(B地点で決めている拍そのもの)
        true  … 速度ボタンの支点 = 聴いている所の拍(聴き始めの3秒後にいちばん近い拍)

    立てるのは nudgeTapListenPosition だけ。B地点へ入る時(startTapPhaseB)・B地点で叩き直した時
    (goToTapAdjust)・曲を開いた時に下ろします。使うのは findTapSpeedPivotBeat だけ(理由はそちらのコメント)。
    */
    bListenMoved: false,

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

// 表打ちの確認パネル(v187)。出し入れは setTapFinalUI() 経由だけで行う
const tapFinalPanel = document.getElementById("tap-final");
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

/*
「A地点の微調整へ戻る」ボタン(v264。画面いちばん下の行、最後の確認画面だけ)。
出し入れは refreshTapRetryVisible() 経由だけで行ってください(理由はそちらのコメント)。
*/
const tapBackA = document.getElementById("tap-back-a");


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

    /*
    半拍ずらしと表打ち確認の状態も、曲ごとに初期化します(v186-v187)。

    別の曲を開いたのに前の曲の判断が残っていると、いきなり
    「ずらしている」状態から始まってしまいます。
    */
    tapState.halfShifted = false;
    tapState.finalCheck = false;

    // 前の曲の A地点の控えも消します(v264。別の曲の A地点へ戻ってしまわないように)
    tapState.phaseASnapshot = null;

    // 前の曲の C地点の結果・控えも消します(v268。前の曲の C地点の位置や線を引き継がないように)
    tapState.cTS = 0;
    tapState.wholeSongAB = null;
    tapState.cCheck = null;
    tapState.beforeC = null;

    // 前の曲で B地点の聴く位置を動かした印も消します(v269。速度ボタンの支点が前の曲の続きにならないように)
    tapState.bListenMoved = false;

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

        setTapGuide("曲を読み込めませんでした。\n閉じてもう一度お試しください。");

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

        // 【開発用調査ログ】(v263)保存してある値で A〜B の拍を数えて🐛に出します(動きは変えない)
        logTapWholeSongSaved(track);

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

        /*
        (v265)2行に短くし、画面に出ていた「タップ補正」の言葉も外しました
        (完成時の呼び名は「ノリ注入」。竹弘 2026-11-07)。\n の所で改行します
        (setTapGuide のコメント参照)。
        */
        setTapGuide(
            "測定データが残っていない曲です。\n" +
            TAP_TOTAL_COUNT + "回タップして測り直してください。"
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

    refreshTapRetryVisible();

}

/**
 * 「タップからやり直す」ボタンを出すかどうかを決めます(v188)。
 *
 * 【なぜ専用の関数にしたのか ―― v187で実際に消えた】
 *
 * このボタンは**微調整画面と表打ちの確認画面のどちらでも出したい**もの
 * です。v187ではその2つの関数が**それぞれ勝手にこのボタンを触っていた**
 * ため、こういう事故が起きました。
 *
 *     setTapAdjustUI(true);   ← ここで表示した
 *     setTapFinalUI(false);   ← 直後にこれが消してしまう
 *
 * 竹弘の報告:「微調整画面の下に『やめる』ボタンと半分ずつで『タップから
 * やり直す』ボタンがあった気がするのですが、なくなってませんか?」
 * ―― そのとおりで、のりが「念のため閉じる」つもりで足した1行が原因でした。
 *
 * 順番を入れ替えれば直りますが、それでは**また同じ間違いが起きます**。
 * 「2つのうちどちらかが開いていれば出す」という判断を**1か所に集めて**、
 * 呼ぶ順番に左右されない形にしました。
 *
 * ⚠️ 新しくパネルを増やして、そこにもこのボタンを出したくなったら、
 *    **この関数に条件を1つ足すだけ**にすること。パネル側から直接
 *    tapRetryAdjust を触らないでください。
 *
 * ---- v264:最後の確認画面では「A地点の微調整へ戻る」に入れ替えました ----
 *
 * 竹弘の要望(2026-11-09):最後の確認画面の「タップからやり直す」は、
 * 押すと A地点を叩く画面まで戻っていた(しかも右上の表示は「B地点」のまま)。
 * 「叩き直すほどひどく直すことは少ない。A地点の微調整画面なら、A地点を確定して
 *   すぐ B地点の微調整へも行けて、B地点を叩き直すボタンもある」
 * → 最後の確認画面の下の段は「やめる」+「A地点の微調整へ戻る」にしました。
 *   「タップからやり直す」は微調整画面だけに出します。
 *
 * 2つのボタンの出し分けもここに集めます(v187 で同じボタンを2か所から
 * 触って消えた事故があったため。「決めるのは1か所」)。
 */
function refreshTapRetryVisible(){

    const adjustShown = tapAdjustPanel.style.display !== "none";
    const finalShown  = tapFinalPanel.style.display  !== "none";

    /*
    (v268)C地点の微調整画面では「タップからやり直す」を出しません(段0-5a。C地点で叩き直すのは
    0-5b で足す)。竹弘の見込み「タップをし直さなければならないほどの修正は多くはない」(2026-11-09)。
    下の段は「やめる」だけになり、幅いっぱいに広がります。
    */
    const retryShown = adjustShown && tapState.phase !== TAP_PHASE_C;

    tapRetryAdjust.style.display = retryShown ? "block" : "none";

    /*
    微調整パネルと確認パネルは同時には出さない約束ですが、切り替えの途中で一瞬
    両方が出ている順番があります(showTapAdjustPanel の中など)。その時は
    微調整の方を優先し、ボタンが3つ並ばないようにします。
    控え(phaseASnapshot)が無い時は、戻る先が無いので出しません。
    */
    const backShown = finalShown && !adjustShown && tapState.phaseASnapshot !== null;

    tapBackA.style.display = backShown ? "block" : "none";

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

    /*
    表打ちの確認からやり直す時は、**A地点まで戻します**(v187)。

    竹弘の指示で、この画面にも「タップからやり直す」を置いています。
    ここで押すということは、表打ちボタンで直しきれなかった＝**測定
    そのものをやり直したい**ということです。表裏はA地点の格子で決まる
    ので、A地点から測り直すのが筋になります。

    ⚠️ この関数はB地点の微調整画面からも呼ばれます。その時はフェーズを
       動かしません(B地点だけ叩き直したい場面なので)。

    (v264)最後の確認画面の「タップからやり直す」は「A地点の微調整へ戻る」に
    入れ替えた(backToTapAdjustA)ので、今はここへは来ません。万一来ても
    壊れないよう、この分かれ道は残しておきます。
    */
    if(tapState.finalCheck){

        tapState.finalCheck = false;
        tapState.phase = TAP_PHASE_A;
        tapState.posSec = TAP_POS_A_DEFAULT_SEC;

    }

    /*
    右上の「A地点 / B地点」の表示も、必ず今のフェーズに合わせます(v264)。

    v263 まで、上の分かれ道でフェーズを A に戻しても表示を書き換えておらず、
    A地点を叩く画面なのに右上が「B地点(曲の終わり側)」のままでした
    (竹弘の実機報告 2026-11-09)。フェーズを変えうる関数では、必ずこの1行を通します。
    */
    updateTapPhaseLabel();

    setTapLockUI(false);
    setTapAdjustUI(false);
    setTapFinalUI(false);
    tapZone.style.display = "flex";
    tapPosRow.style.display = "flex";

    tapCountLabel.textContent = "READY";

    if(tapState.phase === TAP_PHASE_A){

        // (v265)画面を収めるため2行に短くしました。\n の所で改行します(setTapGuide のコメント参照)
        setTapGuide(
            "曲のリズムに合わせて" + TAP_TOTAL_COUNT + "回タップ。\n" +
            "最初の" + TAP_DISCARD_COUNT + "回は助走で、計算に使いません。"
        );

    }
    else{

        setTapGuide(
            "曲の終わり側(B地点)で" + TAP_TOTAL_COUNT + "回タップ。\n" +
            "ここの13拍目が、次の曲への接続点です。"
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

    /*
    読み戻した格子を「基準」として扱います(v186)。

    保存してあるのは補正済みの秒(startTS)なので、**その値自体がもう
    正しい位置**です。旗を立てたままにすると、開いただけで「ずらして
    いる」表示になり、押すと逆に狂います。
    */
    tapState.halfShifted = false;

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

    // (v265)2行に短くしました(直す時のボタンは画面の下に見えているので、文からは外した)
    showTapAdjustPanel(
        "前にこの曲で測った値です(保存済み)。\n" +
        "合っていれば「やめる」で戻れます。",
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
    (v269)B地点は、いつも「聴く位置を動かしていない」ところから始まります(◀▶ を押したら立つ印)。
    速度ボタンの支点は、まず接続点そのものになります(findTapSpeedPivotBeat)。
    */
    tapState.bListenMoved = false;

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

        // (v265)2行に短くしました
        showTapAdjustPanel(
            "前に測った接続点(13拍目)です。\n" +
            "合っていれば「これで確定」へ。",
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

    /*
    (v265)2行に短くしました(叩き直すボタンは画面の下に見えている)
    (v269)2行目を「まずタイミングで」に変えました(竹弘と決めた 2026-11-09 の イ)。
    B地点で A の線がずれる時は、ほとんど「全部が同じだけ早い・遅い」形で、タイミングで直ります。
    速度は「だんだんずれる」時だけ(adjustTapBpm のコメント)。⚠️ 今までの文(22文字)より短くして、
    画面の高さを変えないようにしています。
    */
    showTapAdjustPanel(
        "A地点の値を、B地点に当てています。\n" +
        "ずれは、まずタイミングで合わせてください。",
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
    else if(tapState.phase === TAP_PHASE_C){

        /*
        (v268)C地点では C の拍だけを書き換えます。1拍目(startTS)と接続点(endTS)は動かしません。
        ⚠️ ここを B と同じ else に落とすと、C地点で合わせるたびに接続点が C の位置へ飛びます。
        */
        tapState.cTS = ts;

    }
    else{

        tapState.endTS = ts;

    }

}

/**
 * 画面右上の「今どちらを測っているか」の表示を更新します。
 */
function updateTapPhaseLabel(){

    /*
    (v265)頭に画面の呼び名「ノリ注入」を付けました(竹弘 2026-11-07:完成時の正式な表示名は
    「ノリ注入」)。見出しの行を増やすと画面が収まらなくなるので、この札に入れています。
    */
    /*
    (v268)C地点は「曲の後半」(A〜B の 2/3 のあたり。TAP_C_POS_RATIO のコメント)。
    10章の案の「(真ん中)」は、真ん中に置かないと決めたのでやめました。
    */
    if(tapState.phase === TAP_PHASE_A){
        tapPhaseLabel.textContent = "ノリ注入・A地点(曲の頭側)";
    }
    else if(tapState.phase === TAP_PHASE_C){
        tapPhaseLabel.textContent = "ノリ注入・C地点(曲の後半)";
    }
    else{
        tapPhaseLabel.textContent = "ノリ注入・B地点(曲の終わり側)";
    }

}

/**
 * 測り始める位置を前後に動かします。
 *
 * (v266)B地点の微調整画面(聴く画面)では、測り始める位置ではなく「聴く位置」を
 * 動かします(nudgeTapListenPosition)。同じ ◀▶ のボタンが、画面によって役目を変えます。
 *
 * @param {number} deltaSec - 動かす秒数(+で後ろ、-で前)
 */
function nudgeTapPosition(deltaSec){

    // まだ曲を読み込めていない間は、動かす先が分からないので何もしません
    if(!tapState.songBuffer){ return; }

    /*
    B地点の聴く画面では、聴く位置だけを動かします(v266)。
    ⚠️ 下の「タップを始めた後は動かせません」より先に分けること。B地点を叩き直した後の
       微調整画面では taps が12回ぶん残っているので、順番が逆だと ◀▶ が効かなくなります。
    */
    if(isTapListeningAtB()){

        nudgeTapListenPosition(deltaSec);

        return;

    }

    /*
    (v268)C地点の微調整画面では、C地点そのものを動かします(nudgeTapCPosition)。
    ⚠️ B地点と同じく、下の「タップを始めた後は動かせません」より先に分けること
       (B地点で叩き直した後は taps が12回ぶん残っているため)。
    */
    if(isTapListeningAtC()){

        nudgeTapCPosition(deltaSec);

        return;

    }

    // タップを始めた後は動かせません(測り直しになるため)
    if(tapState.taps.length > 0){ return; }

    const range = findTapPosRange();
    const minSec = range.minSec;
    const maxSec = range.maxSec;

    let next = tapState.posSec + deltaSec;

    if(next < minSec){ next = minSec; }
    if(next > maxSec){ next = maxSec; }

    // 端に着いていて動かないなら、鳴らし直さずに済ませます
    if(next === tapState.posSec){ return; }

    tapState.posSec = next;

    updateTapPosLabel();

    playTapSongFrom(tapState.posSec,false);

}

/**
 * 今のフェーズで、位置を動かしてよい範囲を返します。
 *
 * (v266)nudgeTapPosition の中にあった計算を、中身を変えずに切り出しました。
 * 測り始める位置(叩く前)と、B地点の聴く位置(nudgeTapListenPosition)の2か所で
 * 同じ範囲を使うためです(範囲の決め方を1か所にまとめる)。
 *
 * @return {{minSec:number, maxSec:number}}
 */
function findTapPosRange(){

    const durationSec = tapState.songBuffer.duration;

    // 曲の末尾は、12回叩くだけの余裕が残らないので共通で除きます
    const tailMaxSec = Math.max(0,durationSec - TAP_TAIL_MARGIN_SEC);

    // A地点とB地点を分ける線(理由は TAP_POS_SPLIT_RATIO のコメント)
    const splitSec = durationSec * TAP_POS_SPLIT_RATIO;

    let minSec;
    let maxSec;

    if(tapState.phase === TAP_PHASE_A){

        /*
        ---- A地点は「曲の前半」に限る(v185) ----

        下限(v184): 曲の頭に寄せすぎると、その曲へ繋ぐための助走が
                    確保できなくなります(TAP_POS_A_MIN_SEC 参照)。
        上限(v185): B地点を追い越さないための線。竹弘の要望
                    「A地点の上限はB地点を超えない閾値お願いしたい」。
        */
        minSec = TAP_POS_A_MIN_SEC;
        maxSec = Math.min(tailMaxSec,splitSec);

    }
    else{

        /*
        ---- B地点は「曲の後半」に限る(v185) ----

        A地点を追い越さないための線です。加えて、A地点で確定した1拍目
        (startTS)からも最低限は離します。**A地点を大きく後ろへ動かした
        曲では、真ん中の線がA地点より前に来てしまう**ためです。

            5分の曲でA地点を3分に置いた場合
              真ん中の線 = 150秒  ←  A地点(180秒)より前！

        だから2つの条件のうち**後ろにある方**を採ります。
        */
        minSec = Math.max(
            splitSec,
            tapState.startTS + TAP_POS_B_MIN_GAP_SEC
        );

        maxSec = tailMaxSec;

        /*
        ⚠️ 60秒ぎりぎりの曲でA地点を目一杯後ろへ置いた時など、下限が
           上限を追い越すことが理屈の上ではありえます。その時は
           「動かせない」だけにして、**位置が曲の末尾へ飛ぶ事故を防ぎます。**
           B地点の初期値(曲の終わり25秒前)は必ずA地点より後ろなので、
           動かせなくても時系列は壊れません。
        */
        if(minSec > maxSec){ minSec = maxSec; }

    }

    return { minSec: minSec, maxSec: maxSec };

}

/**
 * 今、B地点の微調整画面(聴く画面)にいるか(v266)。
 *
 * ◀▶ のボタンと位置の表示が「測り始める位置」と「聴く位置」のどちらを扱うかを、
 * この1か所で決めます。B地点の微調整パネルが出ていて、最後の確認ではない時です
 * (A地点の微調整・最後の確認では ◀▶ の行を出していない)。
 */
function isTapListeningAtB(){

    return tapState.phase === TAP_PHASE_B &&
           !tapState.finalCheck &&
           tapAdjustPanel.style.display !== "none";

}

/**
 * B地点の聴く画面で、聴く位置だけを5秒ずつ動かします(v266。段0-3)。
 *
 * 【竹弘の要望(2026-11-07)】
 *     「B地点で『まず聴く』。ただし、ここにもリズムがピッタリ重なっているか
 *       わかりにくい曲もあるので、曲再生位置を5秒ずつ前後できるボタンを」
 *     → 動かすのは「聴く位置だけ」(竹弘の判断)。理由:
 *       「ノリノリアシストがあるので、あくまで精度の高いBPM取得と割り切りたい。
 *         楽曲の聴ける範囲が少なくなってしまうのと、曲の途中ラップのようなものは
 *         あるけど、最後の方で元の拍に戻ってくるような曲もある為」
 *
 * 【動かすもの・動かさないもの】
 *     動かす   … tapState.playOffset(曲のどこから鳴らすか)だけ
 *     動かさない … 接続点(endTS)・狙っている拍(targetBeat)・拍の格子・
 *                  B地点の叩き始めの位置(posSec。「タップからやり直す」は元の B地点から)
 * メトロノームは拍の格子から鳴らすので、どこから聴いても同じ線のカチッが聴けます。
 * 速度・タイミングのボタンも playOffset から鳴らし直すので、動かした位置で続けて合わせられます。
 *
 * 【範囲】B地点の測り始める位置と同じ(findTapPosRange)。曲の真ん中〜終わりの20秒前。
 *    ⚠️ 🕺の曲の確かめでは、最初の聴く位置(13拍目の3秒前)が範囲の外(終わりに近い側)に
 *       あることがあります。その時に「▶」で前へ引き戻されないよう、押した向きにしか動かしません。
 *
 * @param {number} deltaSec - 動かす秒数(+で後ろ、-で前)
 */
function nudgeTapListenPosition(deltaSec){

    const range = findTapPosRange();
    const current = tapState.playOffset;

    let next = current + deltaSec;

    // 範囲の端で止めます。ただし、押した向きと逆へは動かしません(上の ⚠️)
    if(deltaSec > 0 && next > range.maxSec){ next = Math.max(current,range.maxSec); }
    if(deltaSec < 0 && next < range.minSec){ next = Math.min(current,range.minSec); }

    // 端に着いていて動かないなら、鳴らし直さずに済ませます
    if(next === current){ return; }

    // 鳴らし直すと playOffset が next になります(playTapSongFrom の中で書き換わる)
    playTapSongFrom(next,true);

    /*
    (v269)聴く位置を動かしたので、ここからの速度ボタンの支点は「聴いている所の拍」になります
    (findTapSpeedPivotBeat)。移った先で速度を押しても、聴いているカチッが動かないようにするためです。
    */
    tapState.bListenMoved = true;

    updateTapPosLabel();

    console.log(
        "B地点の聴く位置を動かしました :",
        formatTapTime(next) + " から",
        "(接続点の13拍目 " + tapState.endTS.toFixed(3) + "s は動かしません)"
    );

}

/**
 * 今、C地点の微調整画面にいるか(v268。段0-5a)。
 *
 * isTapListeningAtB と同じ考え方で、◀▶ のボタンと位置の表示の役目をここで決めます。
 * C地点はフェーズそのものが C なので、微調整パネルが出ているかだけを見ます。
 */
function isTapListeningAtC(){

    return tapState.phase === TAP_PHASE_C &&
           tapAdjustPanel.style.display !== "none";

}

/**
 * C地点を置いてよい範囲を返します(v268。段0-5a)。
 *
 * A地点の1拍目(startTS)〜 B地点の13拍目(endTS)の 60%〜80%(理由は TAP_C_POS_RATIO のコメント)。
 * 返すのは「C地点の位置」の範囲です。聴き始める位置は、その TAP_REPLAY_LEAD_SEC(3秒)前になります。
 *
 * @return {{minSec:number, maxSec:number}}
 */
function findTapCRange(){

    const lengthSec = tapState.endTS - tapState.startTS;

    return {
        minSec: tapState.startTS + lengthSec * TAP_C_MIN_RATIO,
        maxSec: tapState.startTS + lengthSec * TAP_C_MAX_RATIO
    };

}

/**
 * C地点を、指定した位置にいちばん近い拍に置きます(v268。段0-5a)。
 *
 * 狙う拍の番号(targetBeat)を「その位置にいちばん近い拍」にして、C の拍の秒(cTS)を
 * 計算し直します。拍番号で持つのは A地点・B地点と同じ理由です(速度を動かしても同じ拍を指し続ける。
 * targetBeat のコメント)。
 *
 * 拍番号は A地点の格子のまま数えます(拍番号0 = 1拍目の1拍前、拍番号1 = 1拍目)。
 * だから「1拍目から C まで何拍か」は targetBeat − 1 で、数えなくても決まっています
 * (confirmTapCPhase がこの数を使う)。
 *
 * @param {number} placeSec - C地点を置きたい位置(秒)
 */
function placeTapCAt(placeSec){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    // Math.round は四捨五入。その位置にいちばん近い拍の番号になります
    tapState.targetBeat = Math.round((placeSec - tapState.beatOriginSec) / beatDur);

    updateTapTargetTS();

}

/**
 * C地点の微調整画面で、C地点そのものを5秒ずつ動かします(v268。段0-5a)。
 *
 * 【竹弘と決めたこと(2026-11-09)】
 *     ・◀▶ は C地点そのものを動かす(B地点の ◀▶ は聴く位置だけ。nudgeTapListenPosition)
 *     ・範囲は A〜B の 60%〜80%(findTapCRange)
 *     ・テンポが揺れる曲は、竹弘が ◀▶ で「曲の代表テンポとなる所」へ C を動かして対処する
 *
 * 【動かすもの・動かさないもの】
 *     動かす   … C地点の位置(聴く位置 + 3秒)と、そこにいちばん近い拍(targetBeat → cTS)
 *     動かさない … 当てている線(拍の格子・BPM)・1拍目(startTS)・接続点(endTS)
 * 線はそのままなので、どこへ動かしても「A地点から引いた同じ線」のカチッが聴けます。
 * 前の場所で速度を合わせていたら、その合わせた線のまま次の場所を聴けます。
 *
 * 聴く位置(playOffset)は、いつも「C地点の3秒前」(TAP_REPLAY_LEAD_SEC)です。
 * だから今の C地点の位置は playOffset + 3秒 で分かり、別に覚えておく必要がありません。
 *
 * ⚠️ 範囲の端では止めます。ただし押した向きと逆へは動かしません(B地点の ◀▶ と同じ。
 *    2回目に 🎯 を押した時、前の C地点が範囲の端ちょうどにあることがあるため)。
 *
 * @param {number} deltaSec - 動かす秒数(+で後ろ、-で前)
 */
function nudgeTapCPosition(deltaSec){

    const range = findTapCRange();
    const current = tapState.playOffset + TAP_REPLAY_LEAD_SEC;

    let next = current + deltaSec;

    if(deltaSec > 0 && next > range.maxSec){ next = Math.max(current,range.maxSec); }
    if(deltaSec < 0 && next < range.minSec){ next = Math.min(current,range.minSec); }

    /*
    端に着いていて動かないなら、鳴らし直さずに済ませます。
    「=== で比べない」のは、playOffset + 3秒 の足し算で 0.000000000001秒ほどの誤差が出て、
    同じ位置なのに「違う」と判断されることがあるためです(小数の計算の決まり)。
    */
    if(Math.abs(next - current) < 0.001){ return; }

    placeTapCAt(next);

    updateTapMonitor();

    playTapSongFrom(Math.max(0,next - TAP_REPLAY_LEAD_SEC),true);

    updateTapPosLabel();

    console.log(
        "C地点を動かしました :",
        formatTapTime(next) + "(C の拍 " + tapState.cTS.toFixed(3) + "s・" +
        "A〜B の " + Math.round((tapState.cTS - tapState.startTS) / (tapState.endTS - tapState.startTS) * 100) + "%)",
        "/ 1拍目 " + tapState.startTS.toFixed(3) + "s と接続点 " + tapState.endTS.toFixed(3) + "s は動かしません"
    );

}

function updateTapPosLabel(){

    /*
    (v266)B地点の聴く画面では「聴く位置」(playOffset)を、それ以外(叩く前)では
    「測り始める位置」(posSec)を出します。どちらかは isTapListeningAtB() が決めます。
    (v268)C地点の微調整画面でも「聴く位置」を出します(C地点の3秒前)。
    */
    const sec = (isTapListeningAtB() || isTapListeningAtC()) ? tapState.playOffset : tapState.posSec;

    tapPosLabel.textContent = formatTapTime(sec) + " から";

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

    /*
    【開発用調査ログ】(v263)指が触れた瞬間の時刻も控えます(tapFingerSec のコメント参照)。

    1回目のタップで空にしてから足すのは、taps と必ず同じ順番・同じ数に
    揃えるためです(taps を空に戻す所が2か所あり、そちらに手を入れずに済む)。
    event.timeStamp はミリ秒なので、秒に直します。
    */
    if(tapState.taps.length === 1){ tapState.tapFingerSec = []; }

    tapState.tapFingerSec.push(event.timeStamp / 1000);

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
 * A地点の1拍目(startTS)から B地点の13拍目(endTS)までに何拍あるかを数え、
 * 曲全体の長さから BPM を出します(v263。段0-1)。
 *
 * ------------------------------------------------------------------
 * 【考え方】
 *
 * startTS と endTS は、どちらも耳で合わせた「本物の拍の位置」です。
 * その間にある拍の数は**必ず整数**なので、目安のBPMで数えて、
 * いちばん近い整数に丸めれば拍の数が決まります。あとは
 *
 *     曲全体のBPM = 60 × 拍の数 ÷ A〜Bの秒数
 *
 * の割り算1回です。8回ぶん(数秒)ではなく A〜B(数分)の長さで決まるので、
 * 1本の線(startTS から拍の数だけ進むと、ちょうど endTS)にそろいます。
 * (見積もりと課題は private/tap-correction.html の4章・5章。非公開)
 *
 * ------------------------------------------------------------------
 * 【端数(frac)を必ず見る】
 *
 *     429.13拍 … 端数 +0.13 → 429拍で安心
 *     429.48拍 … 端数 +0.48 → 429拍か430拍か決められない
 *
 * 0.5 に近い時は、目安のBPMが粗くて数え違えそうか、B地点だけ裏で
 * 叩いた(半拍ずれた)かのどちらかです。安心の線は TAP_WHOLE_SONG_SAFE_FRAC。
 *
 * (v267)保存の判断に使い始めました(decideTapWholeSongBpm)。🐛のログ
 * (logTapWholeSong など。本番前に消す)も、引き続きこの関数で数えています。
 *
 * @param  {number} startTS  - A地点の1拍目(秒)
 * @param  {number} endTS    - B地点の13拍目(秒)
 * @param  {number} guideBpm - 拍の数を数える時の目安のBPM
 * @return {{lengthSec:number, beatsRaw:number, beats:number, frac:number,
 *           bpm:number, safe:boolean}|null}
 *         lengthSec … A〜Bの秒数
 *         beatsRaw  … 目安のBPMで数えた拍の数(小数のまま)
 *         beats     … いちばん近い整数 = 拍の数
 *         frac      … 端数(beatsRaw − beats。−0.5〜+0.5)
 *         bpm       … 曲全体のBPM
 *         safe      … 端数が安心の線より小さいか
 *         数えられない時は null
 */
function findTapWholeSongGrid(startTS,endTS,guideBpm){

    const lengthSec = endTS - startTS;

    // B地点がA地点より前にある・値が無い、などの時は数えられません
    if(!isFinite(lengthSec) || lengthSec <= 0){ return null; }
    if(!isFinite(guideBpm) || guideBpm <= 0){ return null; }

    const beatsRaw = lengthSec * guideBpm / 60;

    // Math.round は四捨五入です(429.13 → 429、429.62 → 430)
    const beats = Math.round(beatsRaw);

    if(beats < 1){ return null; }

    const frac = beatsRaw - beats;

    return {
        lengthSec: lengthSec,
        beatsRaw: beatsRaw,
        beats: beats,
        frac: frac,
        bpm: 60 * beats / lengthSec,
        safe: Math.abs(frac) <= TAP_WHOLE_SONG_SAFE_FRAC
    };

}

/**
 * 曲全体のBPMを使ってよいかを決めます(v267。段0-4)。画面にも保存にも触らない「判断だけ」の関数です。
 *
 * ------------------------------------------------------------------
 * 【決まり(竹弘と決めた 2026-11-09)】
 *
 *   ① A〜B の拍の数を「A地点で耳合わせしたBPM」(A地点を確定した時の控え phaseASnapshot)で数える
 *   ② 「B地点で最後に合わせていたBPM」(今の tapState.bpm)でも数える
 *   ③ 2つが同じ拍の数で、どちらも端数が TAP_WHOLE_SONG_SAFE_FRAC(0.2拍)以内 → 使ってよい(ok)
 *   ④ それ以外 → 拍の数に自信が無い(ok = false。最後の確認で ⚠️ と 🎯 の案内を出す)
 *
 * 【④ の時に保存する BPM(v269 で変えた。竹弘と決めた 2026-11-09 の ウ')】
 * v268 までは「②のBPM(B地点で最後に合わせていたBPM)」を保存していました。v268 までの B地点は
 * 速度で線を回して合わせる作りだったので、この値は「1拍目と接続点を結ぶ線」とほぼ同じでした。
 * v269 で B地点の速度ボタンが「間隔」を変える役になった(adjustTapBpm)ので、②は B地点の場所の
 * テンポになり、1拍目から伸ばしても接続点を通らなくなります(ノリノリアシストが接続点で跳ぶ)。
 * → ④ の時も、①(A のテンポ)で数えた拍の数で **1拍目と接続点を結ぶ線**(gridA.bpm)を保存します。
 *    ③ の時とまったく同じ計算で、違いは「その拍の数に自信があるか」だけです。
 *    今まで B をタイミングで合わせた時・B を叩き直した時に起きていた「接続点で跳ぶ」も無くなります。
 *    ①で数えられない時(値が壊れていた時。ふつうは起きない)だけ、②のBPM のままにします。
 * ⚠️ 拍の数が1つ違っていても、1拍目と接続点ではアシストが拍に乗ります。曲の真ん中で最大半拍ずれうるので、
 *    ④ の曲は 🎯 C地点で拍の数を決めてもらいます(v268 の案内のまま)。
 *
 * 【なぜ「叩いた12回のBPM」で数えないのか】
 * 竹弘が12回叩いたBPMは、耳で合わせた後より速めに出ることが多い(v263〜v266 の実機で
 * 12回のうち9回が +0.25〜2.9%)。B地点を叩き直した4曲では、叩いた12回のBPMで数えると
 * 4曲とも A と1〜3拍食い違った。耳で合わせた後の値なら、4曲のうち3曲で揃った。
 *
 * 【なぜ A を基準にするのか】
 * A地点の微調整では、メトロノームを60秒聴きながら合わせられます。B地点は曲の終わり近くで
 * 聴ける時間が短く、BPM を追い込みきれません(B地点を叩き直した曲で外れやすかった)。
 *
 * ⚠️ ok の時に使うのは「拍の数 ÷ A〜Bの長さ」の BPM です。1拍目(startTS)と
 *    接続点(endTS)はどちらも動かさず、その間を1本の線でつなぎます。
 *    だから、アシストの拍が接続点で跳ぶことがなくなります(⑲ の録音の 58ms の件)。
 *
 * @return {{ok:boolean, bpm:number, beats:number|null, bpmA:number, bpmNow:number,
 *           gridA:object|null, gridNow:object|null}}
 *         ok     … 曲全体のBPMを使ってよいか(拍の数に自信があるか)
 *         bpm    … 保存するBPM。(v269)ok でもそうでなくても、Aのテンポで数えた「1拍目と接続点を結ぶ線」。
 *                   数えられない時だけ今のBPMのまま
 *         beats  … A〜B の拍の数(ok の時だけ)
 *         bpmA / bpmNow / gridA / gridNow … 判断に使った値(🐛のログと試験のため)
 */
function decideTapWholeSongBpm(){

    const bpmNow = tapState.bpm;

    // A地点の控えが無い時(ふつうは起きない)は、今のBPMで両方を数えます
    const bpmA = (tapState.phaseASnapshot && tapState.phaseASnapshot.bpm > 0)
        ? tapState.phaseASnapshot.bpm
        : bpmNow;

    const gridA = findTapWholeSongGrid(tapState.startTS,tapState.endTS,bpmA);
    const gridNow = findTapWholeSongGrid(tapState.startTS,tapState.endTS,bpmNow);

    const ok = !!gridA && !!gridNow &&
               gridA.beats === gridNow.beats &&
               gridA.safe && gridNow.safe;

    return {
        ok: ok,

        // (v269)④ でも結ぶ線を保存します(上のコメント「④ の時に保存する BPM」)
        bpm: gridA ? gridA.bpm : bpmNow,

        beats: ok ? gridA.beats : null,
        bpmA: bpmA,
        bpmNow: bpmNow,
        gridA: gridA,
        gridNow: gridNow
    };

}

/**
 * C地点で合わせた拍を使って、A〜B の拍の数を決め直します(v268。段0-5a)。
 * 画面にも保存にも触らない「判断だけ」の関数です(decideTapWholeSongBpm と同じ形)。
 *
 * ------------------------------------------------------------------
 * 【考え方】
 *
 * C の拍(cTS)は、竹弘が耳で合わせた「本物の拍の位置」です。しかも 1拍目から何拍目か(nC)は、
 * A地点の格子の拍番号のまま数えているので、数えなくても決まっています(placeTapCAt のコメント)。
 *
 *   ① 1拍目〜C の BPM  … nC 拍 ÷ 1拍目〜C の長さ。8回ぶん(数秒)ではなく数分の長さで決まる
 *   ② ①の BPM で A〜B の拍の数を数える(findTapWholeSongGrid。端数の線は TAP_WHOLE_SONG_SAFE_FRAC)
 *   ③ 端数が線の内側なら ok。曲全体のBPM = 拍の数 ÷ A〜B の長さ(v267 と同じ割り算)
 *
 * 【端数が出る時(ok にならない時)】
 *   ・C の拍を1つ数え違えた(C を 2/3 に置いてあるので、必ず端数が出て気づける。TAP_C_POS_RATIO)
 *   ・曲の途中でテンポが揺れていて、1拍目〜C と C〜B で速さが違う
 * どちらの時も C は使わず、C を入れる前の判断(wholeSongAB)のまま保存します(竹弘と決めた 2026-11-09)。
 *
 * ⚠️ ok の時、C の拍は必ず「1拍目と接続点を結ぶ線」の端数の線の内側に乗っています
 *    (ずれは C の位置の割合 × 端数なので、端数より小さい)。だから「C が線から外れていないか」を
 *    別に確かめる必要はありません(10章の案の④は、この判断に含まれていた)。
 *
 * @param  {number} startTS - A地点の1拍目(秒)
 * @param  {number} endTS   - B地点の13拍目(秒)
 * @param  {number} cTS     - C地点で合わせた拍(秒)
 * @param  {number} nC      - 1拍目から C まで何拍か(targetBeat − 1)
 * @return {{ok:boolean, bpm:number|null, beats:number|null, bpmAC:number|null,
 *           grid:object|null, cSec:number, nC:number, ratio:number|null}}
 *         ok    … C で A〜B の拍の数を決められたか
 *         bpm   … 曲全体のBPM(ok の時だけ)
 *         beats … A〜B の拍の数(ok の時だけ)
 *         bpmAC … 1拍目〜C の BPM(次に 🎯 を押した時、この線から始める)
 *         grid / cSec / nC / ratio … 判断に使った値(ログと試験のため。ratio は C が A〜B の何割の所か)
 */
function decideTapWholeSongBpmWithC(startTS,endTS,cTS,nC){

    const lengthAC = cTS - startTS;
    const lengthAB = endTS - startTS;

    const result = {
        ok: false,
        bpm: null,
        beats: null,
        bpmAC: null,
        grid: null,
        cSec: cTS,
        nC: nC,
        ratio: (isFinite(lengthAB) && lengthAB > 0) ? lengthAC / lengthAB : null
    };

    /*
    C が 1拍目より後ろ・接続点より前にあり、1拍以上離れている時だけ数えます。
    (◀▶ の範囲は 60%〜80% なので、ふつうは必ず満たします。値が壊れていた時の保険)
    */
    if(!isFinite(lengthAC) || !isFinite(lengthAB) || lengthAB <= 0){ return result; }
    if(lengthAC <= 0 || lengthAC >= lengthAB){ return result; }
    if(!isFinite(nC) || nC < 1){ return result; }

    const bpmAC = 60 * nC / lengthAC;

    const grid = findTapWholeSongGrid(startTS,endTS,bpmAC);

    result.bpmAC = bpmAC;
    result.grid = grid;

    if(grid && grid.safe){

        result.ok = true;
        result.bpm = grid.bpm;
        result.beats = grid.beats;

    }

    return result;

}

/**
 * A・B・C で耳で合わせたテンポを比べて、「曲のどこだけテンポが違うか」を見分けます(v270)。
 * 画面にも保存にも触らない「判断だけ」の関数です。
 *
 * ------------------------------------------------------------------
 * 【竹弘の案(2026-11-09)】
 *     「A地点≠B地点の時、C地点を測定 C=AなのかC=Bなのかで、本編を判定というのはどうだろうか」
 *     → MISIA アイノカタチ(イントロだけ 88、本編 90)で、A地点をイントロに置いていたのが外れの原因だった。
 *       C が B と同じなら「A の辺りだけ違う」= A地点を後ろ(本編)へずらせば測れる。
 *
 * 【見分け方】それぞれのテンポの差が TAP_TEMPO_SAME_FRAC(1%)より小さければ「同じ」。
 *
 *     "none"  … 3つとも同じ。テンポは1つ(C で拍の数を決める。v268 のまま)
 *     "a"     … A だけ違う(B と C は同じ)。イントロだけテンポが違う曲など → A地点を後ろへ
 *     "b"     … B だけ違う(A と C は同じ)。最後だけゆっくりになる曲など → B地点を前へ
 *     "c"     … C だけ違う(A と B は同じ)。C が間奏・ラップなどに当たった → C地点を別の場所へ
 *     "drift" … それ以外(少しずつ変わる・3つとも違う)。1つのテンポでは合わない曲
 *
 *     例(MISIA):A 88.0・B 90.0・C 90.0 → A と B・A と C が 2.3% 違い、B と C は同じ → "a"
 *
 * 【使っているテンポ】
 *     A … A地点で耳合わせしたBPM(60秒聴いて合わせられる)
 *     B … B地点で最後に合わせていたBPM。v269 から B の速度ボタンは「B の辺りの間隔」を変えるので、
 *         だんだんずれる曲で速度を合わせると、B の辺りのテンポになる(触らなければ A と同じ)
 *     C … C地点で最後に合わせていたBPM(B と同じ。触らなければ当てた線のまま)
 * ⚠️ 速度を触らなかった所は「当てた線のテンポで合っていた」とみなします。だんだんずれていたら速度で
 *    合わせてもらう前提です(案内「ずれは、まずタイミングで合わせてください。」の後、速度は間隔のずれに使う)。
 * ⚠️ 拍の位置で比べる案(のりから足した1つ目。テンポが同じでも途中で拍がずれる「ため」のある曲向け)は、
 *    まず🐛に数字を出すだけにしています(logTapCPositions)。実際の曲で使えるか確かめてから判断に入れる。
 * ------------------------------------------------------------------
 *
 * @param  {number} tempoA - A地点で耳合わせしたBPM
 * @param  {number} tempoB - B地点で最後に合わせていたBPM
 * @param  {number} tempoC - C地点で最後に合わせていたBPM
 * @return {{side:string, diffAC:number|null, diffBC:number|null, diffAB:number|null}}
 *         side   … "none" / "a" / "b" / "c" / "drift"(上の表)。値がおかしい時は "none"(今まで通り)
 *         diffAC / diffBC / diffAB … テンポの差の割合(0.023 = 2.3%。ログと試験のため)
 */
function judgeTapTempoSide(tempoA,tempoB,tempoC){

    const result = { side: "none", diffAC: null, diffBC: null, diffAB: null };

    // どれかが数でない・0 以下の時は見分けません(今まで通り)。!(x > 0) は NaN や undefined も弾く書き方です
    if(!(tempoA > 0) || !(tempoB > 0) || !(tempoC > 0)){ return result; }

    // Math.abs は「符号を取った大きさ」。速くても遅くても、差の大きさだけを見ます
    result.diffAC = Math.abs(tempoC / tempoA - 1);
    result.diffBC = Math.abs(tempoC / tempoB - 1);
    result.diffAB = Math.abs(tempoB / tempoA - 1);

    const sameAC = result.diffAC < TAP_TEMPO_SAME_FRAC;
    const sameBC = result.diffBC < TAP_TEMPO_SAME_FRAC;
    const sameAB = result.diffAB < TAP_TEMPO_SAME_FRAC;

    if(sameAC && sameBC && sameAB){
        result.side = "none";
    }
    else if(!sameAC && sameBC && !sameAB){
        result.side = "a";
    }
    else if(sameAC && !sameBC && !sameAB){
        result.side = "b";
    }
    else if(!sameAC && !sameBC && sameAB){
        result.side = "c";
    }
    else{
        /*
        残りは「少しずつ変わる」形です。例:A 88.0・C 88.8・B 89.6 は、隣どうしは 1% より近いのに
        A と B は 1.8% 違う。どこか1か所だけが違うのではないので、測り直す場所を案内できません。
        */
        result.side = "drift";
    }

    return result;

}

/**
 * judgeTapTempoSide の答えを、ログ用の短い文にします(v270)。
 *
 * @param  {{side:string, diffAC:number|null, diffBC:number|null, diffAB:number|null}} judged
 * @return {string}
 */
function describeTapTempoSide(judged){

    const names = {
        none: "そろっている",
        a: "A地点の辺りだけ違う",
        b: "B地点の辺りだけ違う",
        c: "C地点の辺りだけ違う",
        drift: "少しずつ変わる"
    };

    const pct = function(value){ return value === null ? "?" : (value * 100).toFixed(1) + "%"; };

    return (names[judged.side] || judged.side) +
           "(差 A-C " + pct(judged.diffAC) + "・B-C " + pct(judged.diffBC) + "・A-B " + pct(judged.diffAB) + ")";

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
    【開発用調査ログ】(v263)叩いた時刻の2つの取り方を比べて🐛に出します。
    B地点で叩き直した時は、その線のBPMも控えておきます(A+B のログで使う)。
    どちらも記録するだけで、上で決めた bpm・beatOriginSec には触りません。
    */
    logTapTimingCompare(grid);

    if(tapState.phase === TAP_PHASE_B){
        tapState.wholeSongLog.bpmBTapped = 60 / grid.beatDur;
    }

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

    /*
    (v269)叩き直した後は、叩き始めた所から聴き直すので、「聴く位置を動かした」印は下ろします
    (速度ボタンの支点は、決めている拍そのもの。findTapSpeedPivotBeat)。
    */
    tapState.bListenMoved = false;

    /*
    叩き直したら、半拍ずらしは解除します(v186)。

    いま引いた線は**新しく叩いた12回から作った格子**なので、前の格子に
    かけていた補正を引きずる意味がありません。引きずると「ずらしたつもり
    がないのにずれている」という分かりにくい状態になります。
    */
    tapState.halfShifted = false;

    updateTapTargetTS();

    /*
    前回この端末で合わせた遅延を、そのまま当てておきます。

    遅延はイヤホンの性質なので、曲が変わっても同じ値のはずです。
    1曲目で合わせておけば、2曲目以降は最初から合った状態で
    始められます(369曲を測ることを考えると、この差は大きい)。
    */
    applyTapLatencyShift(tapState.latencyMs);

    // (v265)\n の所で改行します(setTapGuide のコメント参照)
    showTapAdjustPanel(
        "メトロノームと曲のリズムが\n" +
        "ぴったり重なるまで調整してください。",
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

    /*
    (v266)◀▶ の行は、B地点の微調整画面だけに出します(聴く位置を動かすため。
    nudgeTapListenPosition)。A地点の微調整では今まで通り隠します。
    位置の数字は、下で鳴らし始めた後に updateTapPosLabel() で書きます。
    (v268)C地点の微調整画面にも出します(C地点そのものを動かす。nudgeTapCPosition)。
    */
    const posRowShown = tapState.phase === TAP_PHASE_B || tapState.phase === TAP_PHASE_C;

    tapPosRow.style.display = posRowShown ? "flex" : "none";

    setTapLockUI(false);
    setTapAdjustUI(true);

    /*
    表打ちの確認画面から戻ってくる道はありませんが、念のため閉じます
    (v187)。同じ場所に2つのパネルが重なって出るのを防ぐためです。
    */
    setTapFinalUI(false);

    setTapGuide(guideText);

    // 確定ボタンの文言は、今どちらの地点かで変わります
    updateTapConfirmLabel();

    updateTapMonitor();

    // ここからはメトロノームを重ねて鳴らします
    playTapSongFrom(fromSec,true);

    /*
    (v266)B地点では ◀▶ の行に「聴く位置」(今鳴らし始めた位置)を出します。
    A地点では行が隠れているので、書いても見えません(害はない)。
    */
    updateTapPosLabel();

}


// ==========================================================
// 10. 微調整
// ==========================================================
/**
 * メトロノームの速さを変えます。
 *
 * ------------------------------------------------------------------
 * 【速度ボタンは「支点」を留めたまま、拍の間隔を伸び縮みさせる(v269)】
 *
 * カチッの位置は「拍番号0 の位置 + 1拍の長さ × 拍番号」です(updateTapTargetTS)。
 * 1拍の長さだけを変えると、動かないのは拍番号0 の所だけで、そこから遠い拍ほど大きく動きます。
 * この「動かない所」を**支点**と呼びます。
 *
 * v268 までは、支点が拍番号0 のままでした。B地点(A を引き継いだ時)と C地点では、拍番号0 が
 * 数百拍前の A地点にあるので、速度を押すと、聴いている所のカチッが間隔はほぼそのまま
 * **位置ごと**動いていました(BPM 90 で +0.1 押すと、接続点が約0.2秒。
 * 竹弘「メトロノームのタイミングを合わせた後、速度を変えるとタイミングがずれる感じがする」2026-11-09)。
 *
 * v269 からは、1拍の長さを変える時に拍番号0 の位置も一緒にずらして、支点の拍の秒を変えません。
 *
 *     支点の拍の秒    = 拍番号0 + 古い1拍の長さ × 支点の拍番号      … これを変えない
 *     新しい拍番号0   = 支点の拍の秒 − 新しい1拍の長さ × 支点の拍番号
 *                     = 拍番号0 + 支点の拍番号 × (古い1拍の長さ − 新しい1拍の長さ)
 *
 * 支点は findTapSpeedPivotBeat が決めます(ふだんは、その画面で決めている拍そのもの)。
 * こうすると、どの画面でも
 *
 *     タイミング … 位置(全部のカチッが同じだけ動く。applyTapLatencyShift)
 *     速度       … 間隔(支点を中心に伸び縮み。決めている拍は動かない)
 *
 * にそろいます(竹弘と決めた 2026-11-09。図解は private/tap-pivot-meeting.html。非公開)。
 *
 * 【なぜ v269 で変えてよかったのか】
 * v151 で「A の線を B まで伸ばし、ずれていたら速度で線を回して B に当てる」作りにしたのは、
 * 回した線の傾きが、そのまま曲全体の BPM になるからでした。v267 からは、曲全体の BPM を
 * 「1拍目〜接続点の拍の数 ÷ 長さ」で計算しているので(decideTapWholeSongBpm)、B で線を回す必要が
 * なくなりました。B地点で A の線が「全部同じだけ早い・遅い」のはタイミングで直し、
 * 速度は「だんだんずれる」時(テンポそのものが違う曲。MISIA の B地点など)に使います。
 * ------------------------------------------------------------------
 *
 * @param {number} delta - BPM をいくつ変えるか(画面のボタンの data-bpm。±0.01・±0.1)
 */
function adjustTapBpm(delta){

    const oldBeatDur = 60 / tapState.bpm;

    // 支点は、変える前の格子で決めます(聴いている所の拍を探すのに、今の1拍の長さを使うため)
    const pivotBeat = findTapSpeedPivotBeat(oldBeatDur);

    // ログで「決めている拍が動いたか」を見せるため、変える前の秒を控えます
    const targetBeforeSec = findTapTargetInfo().sec;

    tapState.bpm = tapState.bpm + delta;

    if(tapState.bpm < 20){ tapState.bpm = 20; }
    if(tapState.bpm > 400){ tapState.bpm = 400; }

    const newBeatDur = 60 / tapState.bpm;

    /*
    (v269)支点の拍の秒を変えないように、拍番号0 の位置をずらします(上のコメントの式)。

    「支点の拍番号 × (古い1拍の長さ − 新しい1拍の長さ)」は、何もしなければ支点の拍が
    動いてしまう量です。その分だけ拍番号0 を動かして打ち消します。

    ⚠️ 値が壊れている時(1拍の長さが数でない等)は、ずらさずに v268 までと同じ動きにします
       (isFinite は「ふつうの数か」を確かめる関数。0 で割った無限大や NaN を弾きます)。
    */
    if(isFinite(oldBeatDur) && isFinite(newBeatDur) && isFinite(pivotBeat)){

        tapState.beatOriginSec = tapState.beatOriginSec + pivotBeat * (oldBeatDur - newBeatDur);

    }

    /*
    1拍の長さが変わったので、狙っている拍の位置も計算し直します(v151)。
    これが無いと、メトロノームだけが動いて保存される値が取り残されます。

    (v269)支点 = 狙っている拍の時は、計算し直しても同じ秒になります(動かない)。
    B地点で ◀▶ を使って聴く位置を動かしていた時だけ、支点は聴いている所なので、接続点は
    「支点からの拍の数 × 1拍の長さの変化」だけ動きます(20秒前を聴いていたら、BPM 90 の +0.1 で約0.02秒)。
    向きは「BPMを上げる = 間隔が詰まる」ので、支点より後ろの拍は手前へ、支点より前の拍は後ろへ動きます。
    */
    updateTapTargetTS();

    updateTapMonitor();

    playTapSongFrom(tapState.playOffset,true);

    const target = findTapTargetInfo();
    const pivotSec = tapState.beatOriginSec + newBeatDur * pivotBeat;

    console.log(
        "速度を変えました :",
        (delta > 0 ? "+" : "") + delta.toFixed(2) + " → BPM " + tapState.bpm.toFixed(2),
        "/ 支点 " + (pivotBeat === tapState.targetBeat ? target.name : "聴いている所の拍") + " " + pivotSec.toFixed(3) + "s",
        "/ " + target.name + " " + targetBeforeSec.toFixed(3) + "s → " + target.sec.toFixed(3) + "s"
    );

}

/**
 * 速度ボタンの支点にする拍の番号を返します(v269)。
 *
 * ------------------------------------------------------------------
 * 【決まり(竹弘と決めた 2026-11-09。private/tap-pivot-meeting.html の ア')】
 *
 *     ふだん … その画面で決めている拍そのもの(targetBeat)
 *              A地点 = 1拍目 / B地点 = 接続点 / C地点 = C の拍
 *     B地点で ◀▶ を使って聴く位置を動かした時だけ
 *            … 聴き始めの3秒後(TAP_REPLAY_LEAD_SEC)にいちばん近い拍
 *
 * 【なぜ「決めている拍そのもの」なのか】
 * 支点にした拍は、速度を押しても1msも動きません。1拍目・接続点・C の拍は、耳で合わせて保存する
 * (C は判断に使う)値そのものなので、速度を押すたびに動くと、合わせた位置が崩れます
 * (v268 までは、B地点で 0.01 押すたびに接続点が約0.02秒動いていた)。
 * ⚠️ 最初の案の「いつも聴き始めの3秒後」はやめました。A地点で叩いた後(叩き始めた所から聴く)・
 *    B地点の引き継ぎ(曲の終わりの25秒前から聴く)・B地点の叩き直しは、聴き始めが決めている拍の
 *    数秒前なので、決めている拍の数拍手前が支点になってしまうためです。
 *
 * 【なぜ ◀▶ の時だけ聴いている所なのか】
 * B地点の ◀▶ は、接続点の辺りが聴き取りにくい曲で、聴き取りやすい所へ移って確かめるための
 * ボタンです(竹弘 2026-11-07)。移った先で速度を押した時にカチッが動くと、v268 までと同じ
 * 「速度を変えるとタイミングがずれる」になります。代わりに、離れた接続点は少しだけ動くので、
 * 合わせたら接続点の近くへ戻って確かめてもらいます。
 * C地点の ◀▶ は C地点そのものを動かし、聴き始めはいつも C の3秒前なので、ふだんの決まりのままで
 * 「聴いている所 = 支点」になっています。
 * ------------------------------------------------------------------
 *
 * @param  {number} beatDur - 今(押す前)の1拍の長さ(秒)
 * @return {number} 支点にする拍の番号(拍番号0 から数えた番号。targetBeat と同じ数え方)
 */
function findTapSpeedPivotBeat(beatDur){

    if(tapState.phase === TAP_PHASE_B && !tapState.finalCheck && tapState.bListenMoved &&
       isFinite(beatDur) && beatDur > 0){

        // Math.round は四捨五入。聴き始めの3秒後にいちばん近い拍の番号です
        return Math.round(
            (tapState.playOffset + TAP_REPLAY_LEAD_SEC - tapState.beatOriginSec) / beatDur
        );

    }

    return tapState.targetBeat;

}

/**
 * 今の画面で決めている拍の、呼び名と秒を返します(v269。速度ボタンのログに使います)。
 *
 * どの値を見るかは updateTapTargetTS と同じ分け方です(A地点 → startTS / C地点 → cTS / それ以外 → endTS)。
 *
 * @return {{name:string, sec:number}}
 */
function findTapTargetInfo(){

    if(tapState.phase === TAP_PHASE_A){ return { name: "1拍目", sec: tapState.startTS }; }
    if(tapState.phase === TAP_PHASE_C){ return { name: "C の拍", sec: tapState.cTS }; }

    return { name: "接続点", sec: tapState.endTS };

}

/**
 * 表打ちの確認画面を出します(v187)。A地点・B地点を測り終えた後の最後の一歩。
 *
 * 【何をする画面か ―― 竹弘の方針(2026-09-06)】
 *
 *     のり注入では『表打ち』『裏打ち』どちらでも自由に打ってもらい、
 *     ここでは、リズムに合わせてタップしてもらう事を重要視したい
 *
 * 叩いている最中に「今は表か裏か」と考えさせると、リズムに乗れません。
 * **叩く時は自由に、判断は最後に1回だけ。** ここがその1回です。
 *
 * ⚠️ 鳴らすのは **A地点のあたり**です。竹弘の説明どおり、A地点は
 *    「曲が安定したリズムを刻み始めた所」なので表裏が判別しやすい。
 *    B地点(終盤)はリズムが崩れがちで、確認には向きません。
 *    竹弘の言葉:「Bは、endTSが取得できれば十分です」。
 */
function startTapFinalCheck(){

    tapState.finalCheck = true;
    tapState.halfShifted = false;

    /*
    ---- 曲全体のBPMにするかを決めます(v267。段0-4)----

    A地点の1拍目と B地点の13拍目の間の拍の数を数え、決まりを満たせば
    「拍の数 ÷ A〜Bの長さ」のBPMに入れ替えます(決まりは decideTapWholeSongBpm のコメント)。
    この画面のメトロノームも、数字の窓も、確定保存で保存する値も、ここからはこのBPMです。

    ⚠️ ここで tapState.bpm を書き換えるので、下の beatDur の計算より先にやること。
    ⚠️ 1拍目(startTS)と接続点(endTS)は動かしません。BPM だけを、2つを結ぶ線の傾きにします。
    ⚠️ 「A地点の微調整へ戻る」(backToTapAdjustA)は A地点の控えから BPM を戻すので、
       ここで書き換えても、戻れば A地点の値に戻ります。
    */
    const whole = decideTapWholeSongBpm();

    /*
    (v268)A+B だけの判断を控え、C地点の結果は消します。B地点を確定し直した = C を合わせた
    線の元(1拍目・接続点)が変わったので、前の C の結果はもう使えないためです。
    */
    tapState.wholeSongAB = whole;
    tapState.cCheck = null;
    tapState.wholeSong = whole;

    /*
    (v269)⚠️ の時も入れ替えます。whole.bpm は ✅ でも ⚠️ でも「Aのテンポで数えた1拍目と接続点を結ぶ線」
    (数えられない時だけ今のBPMのまま)。理由は decideTapWholeSongBpm のコメント「④ の時に保存する BPM」。
    v268 までは ✅ の時だけ入れ替えていました。
    */
    tapState.bpm = whole.bpm;

    console.log(
        "曲全体のBPM :",
        whole.ok
            ? "✅ " + whole.bpm.toFixed(4) + "(A〜B " + whole.beats + "拍)で保存します"
            : (whole.gridA
                ? "⚠️ 拍の数を決めきれません。1拍目と接続点を結ぶ線 " + whole.bpm.toFixed(4) +
                  "(Aのテンポで数えた " + whole.gridA.beats + "拍)で保存します"
                : "⚠️ 拍の数を数えられないので、今の " + whole.bpmNow.toFixed(2) + " で保存します"),
        "/ Aの " + whole.bpmA.toFixed(2) + " で " + (whole.gridA ? whole.gridA.beatsRaw.toFixed(2) + "拍" : "数えられない"),
        "/ Bの " + whole.bpmNow.toFixed(2) + " で " + (whole.gridNow ? whole.gridNow.beatsRaw.toFixed(2) + "拍" : "数えられない")
    );

    showTapFinalCheck();

}

/**
 * 最後の確認画面を出し、A地点のあたりを鳴らします(v268 で startTapFinalCheck から切り出し)。
 *
 * 最後の確認へ来る道が2つになったので、画面を出す所だけを1つにまとめました。
 *
 *     1. B地点を確定した時(startTapFinalCheck)… A+B で判断してから
 *     2. C地点を確定した時(confirmTapCPhase)  … C を入れて判断し直してから
 *
 * どちらも、呼ぶ前に tapState.bpm を「保存するBPM」にしておくこと(下の格子をそのBPMで置き直すため)。
 * ⚠️ 表打ちの旗(halfShifted)には触りません。B地点から来た時は startTapFinalCheck が下ろし、
 *    C地点から来た時は confirmTapCPhase が C へ入る前の状態に戻します。
 */
function showTapFinalCheck(){

    const beatDur = 60 / tapState.bpm;

    /*
    メトロノームを **A地点の格子** で鳴らし直します。

    beatOriginSec は直前までB地点の格子を指しています。この画面では
    A地点付近を聴いてもらうので、A地点の1拍目(startTS)の1拍前を原点に
    置き直します(restoreTapGridAt と同じ考え方)。

    ⚠️ ここで restoreTapGridAt() を呼ばないのは、あちらが halfShifted を
       false に戻す作りだからです。表打ちの旗は呼ぶ側が決めます(この関数の頭の ⚠️)。
       (v268)C地点から戻った時に「表打ちにする」を押した状態を消さないためにも、直に書いています。
       表打ちにしていた時は startTS も半拍ずらした後の値なので、この格子も表の拍に乗ります。
    */
    if(isFinite(beatDur) && beatDur > 0){

        tapState.beatOriginSec = tapState.startTS - beatDur;

    }

    // 1拍目の少し手前から鳴らして、拍が来るのを構えて聴けるようにします
    tapState.posSec = Math.max(0,tapState.startTS - TAP_REPLAY_LEAD_SEC);

    tapZone.style.display = "none";
    tapPosRow.style.display = "none";

    setTapLockUI(false);
    setTapAdjustUI(false);
    setTapFinalUI(true);

    // (v265)2行に短くしました
    setTapGuide(
        "最後の確認です。拍と重なって聞こえますか。\n" +
        "裏で鳴っていたら「表打ちにする」を。"
    );

    updateTapFinalLabel();

    // (v267)曲全体のBPMにしたかどうかを、この画面の1行に出します
    updateTapFinalResult();

    updateTapMonitor();

    // メトロノームを重ねて鳴らします
    playTapSongFrom(tapState.posSec,true);

}

/**
 * 表打ち／裏打ちを入れ替えます。もう一度押すと元に戻ります(v187)。
 *
 * 【なぜ startTS と endTS を直に動かすのか】
 *
 * 微調整画面までは「beatOriginSec・bpm・targetBeat の3つが本物」という
 * 作りで、秒は毎回そこから計算していました(v151)。しかしこの画面では
 * **A地点とB地点という別々の格子から出た2つの値**を、同時に半拍ずらす
 * 必要があります。targetBeat は片方ぶんしか指せないので、ここでは
 * 確定済みの秒を直に動かすのが正しい形になります。
 *
 *     startTS … A地点の格子から出た値
 *     endTS   … B地点の格子から出た値
 *
 * ⚠️ beatOriginSec も同じだけ動かします。そうしないと**メトロノームだけ
 *    元の位置で鳴り続け**、耳で確かめられません。
 *
 * ⚠️ BPMは1ミリも変えません。裏打ちで叩いても**間隔は正しい**ので、
 *    直すのは位置だけです。
 *
 * ⚠️ (v268)「表打ちにする」を押した後に 🎯 C地点で BPM が変わると、「元に戻す」で戻す半拍は
 *    押した時の半拍とわずかに違います(BPM が 0.5% 変われば 1ms ほど)。耳にも接続にも効かない
 *    小ささなので、押した時の量は覚えていません。
 */
function toggleTapFinalHalfBeat(){

    const beatDur = 60 / tapState.bpm;

    if(!isFinite(beatDur) || beatDur <= 0){ return; }

    /*
    ずらす向きは「後ろへ半拍」。戻す時は逆に動かします。

    前後どちらへずらしても同じ格子になりますが(半拍ずれた位置は1つしか
    ないため)、**後ろへ動かす方が安全**です。前へずらすと startTS が
    0秒より手前に出る曲があり、その場合に接続の計算が狂います。
    */
    const shiftSec = tapState.halfShifted ? -beatDur * 0.5 : beatDur * 0.5;

    tapState.startTS       += shiftSec;
    tapState.endTS         += shiftSec;
    tapState.beatOriginSec += shiftSec;

    tapState.halfShifted = !tapState.halfShifted;

    console.log(
        "拍の位置を半拍ずらしました :",
        tapState.halfShifted ? "ずらした" : "元へ戻した",
        "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
        "/ 13拍目 " + tapState.endTS.toFixed(3) + "s"
    );

    updateTapFinalLabel();

    updateTapMonitor();

    // メトロノームを鳴らし直して、耳で確かめられるようにします
    playTapSongFrom(tapState.posSec,true);

}

/**
 * 「表打ちにする」ボタンの文字を、今の状態に合わせます(v187)。
 *
 * 押した後に文字が変わらないと、**効いたのかどうかが分かりません。**
 */
function updateTapFinalLabel(){

    const button = document.getElementById("tap-final-half");

    if(!button){ return; }

    button.textContent = tapState.halfShifted
        ? "⇄ 元に戻す"
        : "⇄ 表打ちにする";

    // 色でも分かるようにします(文字だけだと見落とすため)
    button.classList.toggle("tap-half-on",tapState.halfShifted);

}

/**
 * 最後の確認画面の結果の1行を書き、「🎯 精度を高める(C地点)」を光らせるかを決めます
 * (v267。段0-4 / v268。段0-5a で4つの形に)。
 *
 *   ① C の前・決められた         ✅ 曲全体のBPM 83.48(A〜B 269拍)
 *   ② C の前・決められない       ⚠️ 拍の数を決めきれません。
 *                                   🎯 C地点で精度をあげよう。          ← 🎯 が光る
 *   ③ C を合わせて、決められた   ✅ 曲全体のBPM 83.48(A〜B 269拍)
 *                                   🎯 C地点(2:52)で確かめました
 *   ④ C を合わせても決められない 💪 手ごわい曲だね。場所を変えてみよう。
 *                                   このままなら、C は使わずに保存するね。 ← 🎯 が光る
 *
 *   (v270)A・B・C のテンポが食い違った時(judgeTapTempoSide。C で拍の数が合っても C は使わない)
 *   ⑤ A だけ違う                 💡 A地点の辺りだけ、テンポが違うみたい。
 *                                   A地点を後ろへずらして、測り直そう。
 *   ⑥ B だけ違う                 💡 B地点の辺りだけ、テンポが違うみたい。
 *                                   B地点を前へずらして、測り直そう。
 *   ⑦ A+B は ✅・C だけ違う      ✅ 曲全体のBPM 83.48(A〜B 269拍)
 *                                   💡 C地点の辺りだけ、テンポが違うみたい。   ← 緑のまま(A+B で保存)
 *   ⑦' A+B も ⚠️・C だけ違う     💡 C地点の辺りだけ、テンポが違うみたい。
 *                                   🎯 C地点を、別の場所で合わせよう。          ← 🎯 が光る
 *   ⑧ 少しずつ変わる              💪 テンポが少しずつ変わる曲みたい。
 *                                   このままなら、C は使わずに保存するね。
 *   ⑤ ⑥ ⑧ は C地点をやり直しても直らないので、🎯 は光らせません。
 *   ⑤ ⑥ の測り直しは、今あるボタンで進みます(ボタンは足さない。竹弘「欲しいと思ったボタンを追加するのが
 *   シンプルな操作性」2026-11-09):
 *       A地点 … 「A地点の微調整へ戻る」→「タップからやり直す」→ ▶ で後ろへ → 12回
 *       B地点 … 「A地点の微調整へ戻る」→ A地点を確定 → B地点で「タップからやり直す」→ ◀ で前へ → 12回
 *
 * 【竹弘と決めたこと(2026-11-09)】
 *   ・🎯 を光らせるのは ⚠️ の曲だけ(長い曲というだけでは光らせない)
 *   ・② は「C地点を合わせてください」ではなく、やさしい「C地点で精度をあげよう。」に
 *   ・④ は難しい曲の時なので、やさしい励ましの文に
 *   ・保存する値:① ③ は曲全体のBPM / ② は今までどおり / ④ は C を入れる前の判断のまま
 *     (元が①なら曲全体のBPM、②なら今までどおり)。値を決めるのは confirmTapCPhase
 *     (v269)② の「今までどおり」は「Aのテンポで数えた1拍目と接続点を結ぶ線」に変えた
 *     (decideTapWholeSongBpm のコメント「④ の時に保存する BPM」。竹弘と決めた 2026-11-09 の ウ')
 *
 * 判断は startTapFinalCheck() が tapState.wholeSongAB に、confirmTapCPhase() が tapState.cCheck に
 * 入れておきます。色は CSS の .is-ok(緑)/ .is-ng(黄)、🎯 の光は .is-lit で付けます。
 * \n の所で改行します(white-space:pre-line)。
 * ⚠️ どの形も2行まで(画面を1画面に収めるため。sandbox/measure-tap-layout.html で幅 360px を確かめた)。
 */
function updateTapFinalResult(){

    const el = document.getElementById("tap-final-result");
    const cButton = document.getElementById("tap-final-c");

    if(!el){ return; }

    const ab = tapState.wholeSongAB;
    const c = tapState.cCheck;

    if(!ab){

        el.textContent = "";
        el.classList.remove("is-ok","is-ng");

        if(cButton){ cButton.classList.remove("is-lit"); }

        return;

    }

    let text;
    let good;

    /*
    (v270)🎯 を光らせるか。今までは「決めきれていない時(② ④)」でしたが、A地点・B地点を測り直してほしい時
    (下の ⑤ ⑥)と、テンポが少しずつ変わる曲(⑧)は、C地点をやり直しても直らないので光らせません。
    */
    let lit = false;

    // (v270)A・B・C のテンポを比べた答え(confirmTapCPhase が入れる。C を使う前・v269 までの答えには無い)
    const side = (c && c.tempoSide) ? c.tempoSide.side : "none";

    if(c === null){

        // ① / ② まだ C地点を使っていない
        good = ab.ok;
        lit = !ab.ok;

        text = ab.ok
            ? "✅ 曲全体のBPM " + ab.bpm.toFixed(2) + "(A〜B " + ab.beats + "拍)"
            : "⚠️ 拍の数を決めきれません。\n🎯 C地点で精度をあげよう。";

    }
    else if(c.ok && side === "none"){

        // ③ C地点で決められた(テンポも3つそろっている)
        good = true;

        text = "✅ 曲全体のBPM " + c.bpm.toFixed(2) + "(A〜B " + c.beats + "拍)\n" +
               "🎯 C地点(" + formatTapTime(c.cSec) + ")で確かめました";

    }
    else if(ab.ok && side !== "none"){

        /*
        ⑦(v270)A+B で決められている曲で、C だけテンポが違った。A と B がそろっているので、
        C が間奏・ラップなどに当たったと見ます。保存は A+B の曲全体のBPM のままでよいので、緑のまま。
        (A+B が ✅ なら A と B のテンポの差は 0.15% くらいより小さいので、"a" "b" にはまずならない)
        */
        good = true;

        text = "✅ 曲全体のBPM " + ab.bpm.toFixed(2) + "(A〜B " + ab.beats + "拍)\n" +
               "💡 C地点の辺りだけ、テンポが違うみたい。";

    }
    else if(side === "a"){

        // ⑤(v270)A だけ違う(MISIA アイノカタチの形)。A地点がイントロなどにあった → 本編へずらす
        good = false;

        text = "💡 A地点の辺りだけ、テンポが違うみたい。\n" +
               "A地点を後ろへずらして、測り直そう。";

    }
    else if(side === "b"){

        // ⑥(v270)B だけ違う。最後だけゆっくりになる曲など → B地点を前へ
        good = false;

        text = "💡 B地点の辺りだけ、テンポが違うみたい。\n" +
               "B地点を前へずらして、測り直そう。";

    }
    else if(side === "c"){

        // ⑦'(v270)C だけ違う(A+B は決めきれていない)。C が間奏などに当たった → C地点を別の場所へ
        good = false;
        lit = true;

        text = "💡 C地点の辺りだけ、テンポが違うみたい。\n" +
               "🎯 C地点を、別の場所で合わせよう。";

    }
    else if(side === "drift"){

        // ⑧(v270)少しずつ変わる・3つとも違う。1つのテンポでは合わないので、測り直す場所を案内できない
        good = false;

        text = "💪 テンポが少しずつ変わる曲みたい。\n" +
               "このままなら、C は使わずに保存するね。";

    }
    else{

        // ④ C地点でも決められなかった(テンポはそろっているのに、拍の数が決まらない手ごわい曲)
        good = false;
        lit = true;

        text = "💪 手ごわい曲だね。場所を変えてみよう。\n" +
               "このままなら、C は使わずに保存するね。";

    }

    el.textContent = text;

    el.classList.toggle("is-ok",good);
    el.classList.toggle("is-ng",!good);

    // 🎯 を光らせるのは ② ④ ⑦'(C地点をやり直すと良くなる時)だけ(上の lit のコメント)
    if(cButton){ cButton.classList.toggle("is-lit",lit); }

}

/**
 * 表打ち確認の画面(#tap-final)を出し入れします(v187)。
 *
 * ⚠️ 「タップからやり直す」ボタンは**ここでは直接触りません**(v188)。
 *    このパネルと微調整パネルの両方で出したいボタンなので、判断は
 *    refreshTapRetryVisible() に集めてあります(そちらのコメント参照)。
 *
 * ⚠️ 「やめる」は常に出ているので、こちらも触りません。竹弘の指示
 *    「『やめる』ボタンと『タップからやり直す』は最後の『裏打ち』確認
 *    でも設置しておいてくださいね」は、この2つで満たしています。
 */
function setTapFinalUI(shown){

    tapFinalPanel.style.display = shown ? "block" : "none";

    refreshTapRetryVisible();

}

/**
 * 最後の確認画面から、A地点の微調整画面へ戻ります(v264)。
 *
 * 【竹弘の要望(2026-11-09)】
 *     「最後の画面の『タップからやり直す』は、A地点の微調整画面に戻るように
 *       したい。タップ補正をやり直すほどひどく補正が必要になるケースは少ない。
 *       A地点の微調整画面なら『A地点を確定→B地点へ』ですぐB地点の微調整にも
 *       行けて、B地点のタップ補正のボタンもある」
 *     「やみくもにボタンを増やすのもどうか。欲しいと思ったボタンを追加するのが
 *       シンプルな操作性」(→「戻る」を全部の画面に付ける案はやめ、このボタンだけ)
 *
 * 【何に戻すか】
 * A地点を確定した時の控え(phaseASnapshot)を、そのまま書き戻します。
 * B地点で変えたこと(BPM・遅延・叩き直し)と、この画面の「表打ちにする」は
 * 取り消しになります。A地点を確定し直せば、B地点はもう一度そこから始まります。
 *
 * ⚠️ startTS / endTS を直接書き戻しているのは、控えた時の値がそのまま正しい
 *    (updateTapTargetTS で作られた結果を控えてある)ためです。拍の格子
 *    (beatOriginSec・bpm・targetBeat)も一緒に戻すので、食い違いません。
 */
function backToTapAdjustA(){

    const snap = tapState.phaseASnapshot;

    // A地点を確定していない(戻る先が無い)時は何もしません。ボタンも出していません
    if(!snap){ return; }

    tapState.phase = TAP_PHASE_A;
    tapState.finalCheck = false;
    tapState.halfShifted = false;
    tapState.measured = true;

    tapState.bpm = snap.bpm;
    tapState.beatOriginSec = snap.beatOriginSec;
    tapState.targetBeat = 1;
    tapState.startTS = snap.startTS;
    tapState.endTS = snap.endTS;
    tapState.latencyMs = snap.latencyMs;
    tapState.posSec = snap.posSec;
    tapState.resumedFromSaved = snap.resumedFromSaved;

    /*
    (v268)C地点の結果も取り消します。A地点を確定し直すと、C を合わせた線の元(1拍目)が
    変わるためです。もう一度 B地点を確定すれば、最後の確認で C地点も使えます。
    */
    tapState.cCheck = null;
    tapState.beforeC = null;

    updateTapPhaseLabel();

    console.log(
        "A地点の微調整へ戻りました :",
        "BPM " + tapState.bpm.toFixed(2),
        "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
        "/ 遅延 " + tapState.latencyMs + "ms"
    );

    /*
    画面の切り替えと、メトロノームを重ねて鳴らすのは showTapAdjustPanel に任せます
    (確認パネルを閉じる・確定ボタンの文言を「A地点を確定 → B地点へ」にする・
    下の段を「やめる」+「タップからやり直す」にする、まで中でやってくれます)。
    鳴らす位置は、A地点の微調整で聴いていた位置です。
    */
    // (v265)2行に短くしました
    showTapAdjustPanel(
        "A地点を確定した時の値に戻しました。\n" +
        "直したら「A地点を確定 → B地点へ」。",
        snap.fromSec
    );

}

/**
 * 最後の確認画面の「🎯 精度を高める(C地点)」から、C地点の微調整画面へ入ります(v268。段0-5a)。
 *
 * 【竹弘の要望(2026-11-07・11-09)】
 *     「『精度を高める』ボタンも用意し、C地点のタップもできるようにしたい」
 *     「C地点も、C地点の微調整画面にジャンプしたい。必要であれば、C地点でタップし直せばいい。
 *       おそらく、タップをし直さなければならないほどの修正は多くはないと思う」
 *     → 0-5a は「聴く・合わせる・確定」だけ。C地点で叩き直すのは 0-5b。
 *
 * 【当てる線】1拍目(startTS)から引いた線を、曲の後半(C地点)まで伸ばして聴いてもらいます。
 *     A+B で決められた曲(✅) … 1拍目と接続点を結ぶ線(曲全体のBPM)
 *     決められなかった曲(⚠️)  … A地点で耳合わせしたBPM の線(A地点を信じる。decideTapWholeSongBpm のコメント)
 *     2回目からの 🎯           … 前に C地点で合わせた線(1拍目〜C の BPM)。合わせた続きから始められる
 *
 * 【C地点の位置】最初は A〜B の 2/3、2回目からは前に置いた所(竹弘が ◀▶ で代表のテンポの所へ
 *     動かしていたら、その続きから)。どちらも 60%〜80% の内側に収めます(findTapCRange)。
 *     聴き始めるのは、その3秒前(TAP_REPLAY_LEAD_SEC)。
 *
 * 【動かすもの・動かさないもの】
 *     C地点で動かすのは、線(BPM・拍の格子)と C の拍(cTS)だけ。1拍目と接続点は動かしません。
 *     タイミングを動かした分は C の位置だけの直しで、最後の確認へ戻る時に元の値へ戻します(beforeC)。
 *     (v269)速度ボタンの支点は C の拍そのもの(findTapSpeedPivotBeat)。速度は C の辺りの拍の間隔だけを変え、
 *     C の拍の位置は動かしません。C の拍を動かすのはタイミングと ◀▶ です。
 *     ⚠️ C の辺りで速度を変えた後に ◀▶ で C を動かすと、placeTapCAt は「変えた後の間隔」で拍を数え直します。
 *        数えるのは前の C から数拍〜十数拍だけなので、その場所の間隔で数えるほうが確かです。
 */
function startTapPhaseC(){

    // 最後の確認画面にいて、A+B の判断がある時だけ入れます(ボタンもそこにしか無い)
    if(!tapState.finalCheck || !tapState.wholeSongAB){ return; }

    const lengthSec = tapState.endTS - tapState.startTS;

    if(!isFinite(lengthSec) || lengthSec <= 0){

        showTapToast("1拍目と接続点の値がおかしいため、C地点を使えません");

        return;

    }

    const ab = tapState.wholeSongAB;
    const last = tapState.cCheck;

    // ---- 当てる線の BPM(上のコメント「当てる線」)----
    let lineBpm;

    if(last && last.bpmAC > 0){
        lineBpm = last.bpmAC;
    }
    else if(ab.ok){
        lineBpm = ab.bpm;
    }
    else{
        lineBpm = ab.bpmA;
    }

    // C地点を確定して戻る時に書き戻すものを控えます(beforeC のコメント)
    tapState.beforeC = {
        latencyMs: tapState.latencyMs,
        halfShifted: tapState.halfShifted
    };

    tapState.phase = TAP_PHASE_C;

    /*
    最後の確認の旗は下ろします。立てたままだと、確定ボタン(confirmTapPhase)や
    B地点の聴く画面の判断(isTapListeningAtB)が「最後の確認の中」と取り違えます。
    戻る時は confirmTapCPhase が立て直します。
    */
    tapState.finalCheck = false;

    /*
    線を 1拍目に置き直します。拍番号1 = 1拍目(startTS)・拍番号0 = その1拍前(restoreTapGridAt と同じ形)。
    ⚠️ 表打ちにしていた時は、startTS も半拍ずらした後の値なので、線も表の拍に乗ります。
    */
    tapState.bpm = lineBpm;
    tapState.beatOriginSec = tapState.startTS - 60 / lineBpm;

    // ---- C地点の位置(上のコメント「C地点の位置」)----
    const range = findTapCRange();

    let placeSec = (last && isFinite(last.placeSec))
        ? last.placeSec
        : tapState.startTS + lengthSec * TAP_C_POS_RATIO;

    if(placeSec < range.minSec){ placeSec = range.minSec; }
    if(placeSec > range.maxSec){ placeSec = range.maxSec; }

    placeTapCAt(placeSec);

    updateTapPhaseLabel();

    console.log(
        "C地点へ入ります :",
        "線 BPM " + lineBpm.toFixed(4) +
        (last ? "(前に C地点で合わせた線)" : (ab.ok ? "(1拍目と接続点を結ぶ線)" : "(A地点で耳合わせしたBPM)")),
        "/ C の拍 " + tapState.cTS.toFixed(3) + "s(" + formatTapTime(placeSec) + "・A〜B の " +
        Math.round((tapState.cTS - tapState.startTS) / lengthSec * 100) + "%)",
        "/ 1拍目から " + (tapState.targetBeat - 1) + "拍"
    );

    /*
    画面の切り替えとメトロノームは showTapAdjustPanel に任せます(B地点の聴く画面と同じ部品)。
    (v269)案内の2行目は B地点と同じ「まずタイミングで」(startTapPhaseB のコメント)。
    */
    showTapAdjustPanel(
        "A地点からの線を、C地点に当てています。\n" +
        "ずれは、まずタイミングで合わせてください。",
        Math.max(0,placeSec - TAP_REPLAY_LEAD_SEC)
    );

}

/**
 * 「C地点を確定 → 最後の確認へ」が押された時の処理です(v268。段0-5a)。
 *
 * C地点で合わせた拍を使って A〜B の拍の数を決め直し(decideTapWholeSongBpmWithC)、
 * 最後の確認画面へ戻ります。⚠️ ここでは保存しません(保存は最後の確認の「確定保存」)。
 *
 * 【保存する値(竹弘と決めた 2026-11-09)】
 *     C で決められた(③)   … C で決めた曲全体のBPM
 *     C で決められない(④) … C を入れる前の判断のまま(A+B で決められていれば曲全体のBPM、
 *                             決められていなければ今までどおり。(v269)「今までどおり」は
 *                             Aのテンポで数えた1拍目と接続点を結ぶ線)
 * どちらの時も、1拍目(startTS)と接続点(endTS)は動かしません。
 *
 * 【(v270)A・B・C のテンポも比べる】
 * C で拍の数が決められても、A・B・C で耳で合わせたテンポが食い違っていたら(judgeTapTempoSide が "none" 以外)、
 * C は使いません(④ と同じ保存)。1つのテンポでは曲全体に合わない曲で、拍の数がたまたま合っただけの
 * ことがあるためです(MISIA のように A地点がイントロにあると、C の拍の数そのものが当てにならない)。
 * 見分けた答えは c.tempoSide に入れ、結果の1行(updateTapFinalResult)が「どこを測り直せばよいか」を案内します。
 * C を使ったかどうかは c.useC(結果の1行と保存のログが見る)。
 */
function confirmTapCPhase(){

    const ab = tapState.wholeSongAB;

    /*
    (v270)C地点で最後に合わせていたテンポを、書き換える前に控えます(下で tapState.bpm を保存するBPMに入れ替えるため)。
    v269 から C の速度ボタンは C の辺りの間隔を変えるので、だんだんずれる曲で合わせると C の辺りのテンポになります。
    */
    const tempoC = tapState.bpm;

    // 拍番号1 が 1拍目なので、1拍目から C までの拍の数は targetBeat − 1(placeTapCAt のコメント)
    const c = decideTapWholeSongBpmWithC(
        tapState.startTS,
        tapState.endTS,
        tapState.cTS,
        tapState.targetBeat - 1
    );

    /*
    竹弘が置いた C地点の位置も控えます(次に 🎯 を押した時、ここから始めるため)。
    聴く位置はいつも C地点の3秒前なので、playOffset + 3秒 が置いた位置です(nudgeTapCPosition)。
    */
    c.placeSec = tapState.playOffset + TAP_REPLAY_LEAD_SEC;

    /*
    (v270)A・B・C のテンポを比べます(上のコメント「A・B・C のテンポも比べる」)。
    A は A地点で耳合わせしたBPM、B は B地点で最後に合わせていたBPM(どちらも A+B の判断に控えてある)。
    */
    c.tempoC = tempoC;
    c.tempoSide = judgeTapTempoSide(ab.bpmA,ab.bpmNow,tempoC);

    // C を使うのは、拍の数が決められて(c.ok)、しかもテンポが3つそろっている時だけ
    c.useC = c.ok && c.tempoSide.side === "none";

    tapState.cCheck = c;

    // 使う判断と、保存する BPM(上のコメント)
    tapState.wholeSong = c.useC
        ? { ok: true, bpm: c.bpm, beats: c.beats, byC: true }
        : ab;

    /*
    ⚠️ ab.bpm は「A+B で決められたら曲全体のBPM・決められなければ(v269)Aのテンポで数えた
       1拍目と接続点を結ぶ線」(decideTapWholeSongBpm のコメント「④ の時に保存する BPM」)
    */
    tapState.bpm = c.useC ? c.bpm : ab.bpm;

    /*
    C地点で動かしたタイミングは C の位置だけの直しなので、元の値に戻します。
    表打ちの旗も、C地点へ入る前の状態に戻します(押していたら「元に戻す」と出るように)。
    */
    if(tapState.beforeC){

        tapState.latencyMs = tapState.beforeC.latencyMs;
        tapState.halfShifted = tapState.beforeC.halfShifted;

        tapState.beforeC = null;

    }

    // 最後の確認画面は「フェーズ B + finalCheck の旗」です(TAP_PHASE_C のコメント)
    tapState.phase = TAP_PHASE_B;
    tapState.finalCheck = true;

    updateTapPhaseLabel();

    console.log(
        "C地点を確定しました :",
        "C の拍 " + c.cSec.toFixed(3) + "s(A〜B の " + (c.ratio === null ? "?" : Math.round(c.ratio * 100)) + "%)",
        "/ 1拍目から " + c.nC + "拍",
        /*
        ⚠️ 端数の + / − は、ここで直に付けます。formatTapSigned は「15. 開発用調査ログ」の節にあり、
           本番前に節ごと消す決まりなので、本番の処理からは呼びません。
        */
        c.bpmAC === null
            ? "/ 数えられません"
            : "/ 1拍目〜C の BPM " + c.bpmAC.toFixed(4) + " で数えると A〜B " +
              (c.grid
                  ? c.grid.beatsRaw.toFixed(2) + "拍(端数 " + (c.grid.frac >= 0 ? "+" : "") + c.grid.frac.toFixed(2) + ")"
                  : "数えられない"),
        c.useC
            ? "→ ✅ " + c.beats + "拍・曲全体のBPM " + c.bpm.toFixed(4) + " で保存します"
            : "→ " + (c.ok ? "拍の数は合ったが、テンポが食い違うので" : "⚠️ 決めきれないので") + " C は使いません(" +
              (ab.ok ? "A+B の曲全体のBPM " : "1拍目と接続点を結ぶ線 ") + ab.bpm.toFixed(2) + " で保存します)",
        "/ A+B だけだと " + (ab.ok ? ab.beats + "拍" : "決めきれない"),
        // (v270)A・B・C のテンポ(judgeTapTempoSide)
        "/ テンポ A " + Number(ab.bpmA).toFixed(2) + "・B " + Number(ab.bpmNow).toFixed(2) + "・C " + Number(tempoC).toFixed(2) +
        " → " + describeTapTempoSide(c.tempoSide)
    );

    // 【開発用調査ログ】(v270)C の拍が A の線・B の線のどちらに乗っているか(拍の位置で比べる案の下調べ)
    logTapCPositions(c,ab);

    showTapFinalCheck();

}

/**
 * Bluetoothの遅延を調整します。
 *
 * (v265)画面では「メトロノームのタイミング」と呼んでいます(見出し・数字の窓の札)。
 * ボタンは −50 −10 −1 +1 +10 +50 の6つ(±50ms を足した。竹弘「ずれの数値が大きいので便利」)。
 * どのボタンも data-lat の数を deltaMs としてここへ渡すだけで、処理は今までと同じです。
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

    /*
    (v268)C地点の確定は「最後の確認へ戻る」であって保存ではないので、行き先を書きます
    (A地点の「→ B地点へ」と同じ考え方)。
    */
    if(tapState.phase === TAP_PHASE_A){
        tapConfirmBtn.textContent = "A地点を確定 → B地点へ";
    }
    else if(tapState.phase === TAP_PHASE_C){
        tapConfirmBtn.textContent = "C地点を確定 → 最後の確認へ";
    }
    else{
        tapConfirmBtn.textContent = "これで確定(ノリ注入)";
    }

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
    /*
    出す数字は、今どちらを測っているかで変わります(v150)。
    A地点は1拍目、B地点は13拍目(曲の接続点)です。
    (v268)C地点では、C地点で合わせている拍の位置(cTS)を出します。
    */
    let label = "13拍目 ";
    let ts = tapState.endTS;

    if(tapState.phase === TAP_PHASE_A){
        label = "1拍目 ";
        ts = tapState.startTS;
    }
    else if(tapState.phase === TAP_PHASE_C){
        label = "C地点 ";
        ts = tapState.cTS;
    }

    if(!tapState.measured){

        tapBpmDisplay.textContent = "---.--";
        tapTsDisplay.textContent = label + "--.---s";

    }
    else{

        tapBpmDisplay.textContent = tapState.bpm.toFixed(2);

        tapTsDisplay.textContent = label + ts.toFixed(3) + "s";

    }

    /*
    遅延だけは、測る前から数字を出します。
    イヤホンの性質であって曲の性質ではなく、前に合わせた値がそのまま
    使えるためです(次に測る曲の初期値として引き継いでいます)。

    (v265)札の文字を「Bluetoothの遅延」から「タイミング」に変えました。微調整画面の見出し
    「メトロノームのタイミングを曲に合わせて下さい」と同じ言葉にそろえるためです
    (イヤホンの遅れだけでなく、叩き遅れの直しにも使っている。竹弘 2026-11-07)。
    */
    tapLatDisplay.textContent = "タイミング " + tapState.latencyMs + "ms";

}

/**
 * 画面の案内文を書き換えます。
 *
 * (v265)案内文は2行までにし、意味の切れ目に \n(改行)を入れて書きます。
 * c014.html の #tap-guide に white-space:pre-line を付けてあるので、\n の所で改行されます
 * (textContent に入れた \n は、ふつうは空白1つとして扱われて改行になりません)。
 *
 * ⚠️ 1行は全角22文字まで。幅 360px の画面で1行に収まる長さです。長いと行の途中で折れ、
 *    3行になって画面からはみ出します(sandbox/measure-tap-layout.html で測れる)。
 */
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

---- 保存するのは「12回叩いて合わせた A地点の確定」の時だけ(v264。竹弘が選んだ案「エ」)----

この値は次に測る曲の始まりの値になります。v263 までは A地点・B地点の確定の
たびに保存していましたが、v263 の実機ログで、値が曲ごとに大きく揺れていました
(−30 → −80 → −151 → +50 → +110 → −40ms)。中身は3つあります。

    ① イヤホンの遅れ       … どの曲でも同じ → 次の曲へ引き継ぐと便利
    ② その曲を叩いた時の癖 … 叩き遅れなど。A地点で合わせる時に入る
    ③ B地点で動かした分    … 正体は BPM のずれの直し(A地点から遠いほど大きい)。
                              次の曲には関係ない

そこで、③ が入る B地点の確定と、叩いていない 🕺の曲の確かめ(resumedFromSaved。
保存してある1拍目をそのまま使うので、表示の数字は当てていない)では保存しません。
くわしい比べっこは docs/nori-timing.html(案ア〜オ)。

⚠️ どの値から始めても、最後に耳で合わせて確定するので、保存される拍の位置は正しい。
   変わるのは「最初にどれだけずれて聞こえるか」と「押す回数」だけです。
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

    ⚠️ v187で「表打ちの確認」パネルが増えたので、こちらも一緒に
       閉じます。**パネルを増やした時は、ここに足すのを忘れないこと。**
    */
    setTapLockUI(false);
    setTapAdjustUI(false);
    setTapFinalUI(false);
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

    /*
    次に開いた時に、いちばん上から見えるようにします(v189)。

    #tap-screen は overflow-y:auto なので、下の方までスクロールした状態で
    閉じると、その位置を覚えたまま次に開きます。
    */
    tapScreen.scrollTop = 0;

    document.getElementById("app").style.display = "flex";

    // ⚠️ 隠していた間に高さの計算がずれるので、必ず直します(下の関数を参照)
    refreshAppHeight();

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
 * (v267)manualBPM は、最後の確認で決めた「曲全体のBPM」(1拍目と13拍目を結ぶ線の傾き)に
 * なることがあります(startTapFinalCheck → decideTapWholeSongBpm)。この関数は
 * tapState.bpm をそのまま保存するだけで、どちらの値かは見ていません。
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

        /*
        ---- メインメニューの再生ピッチ(userBPM)を消します(v254) ----

        userBPM は「メインメニューでこの曲を何BPMで鳴らすか」を、竹弘が
        定規で選んだ値です。再生の速さは userBPM ÷ 元ピッチ で決まります
        (js/pitch.js の applyTrackTempo)。

        【v253 の実機テストで分かった穴(竹弘 2026-10-25)】
        前に 156.60 と測ってあった曲を 78.20 に測り直すと、userBPM は 157 の
        ままだったので、157 ÷ 78.20 ≒ 2倍(上限)の速さで鳴り出しました。
        元ピッチの物差しが変わったのに、古い物差しで決めた数字だけが残った
        ためです(v252 までも、次にその曲を選んだ時に同じことが起きていた)。

            竹弘:「変わった時の再生ピッチって意味がないから、これも新規で
                   曲を読み込んだ時と同じ処理で、元ピッチに書き換えないと」

        → 新しく読み込んだ曲と同じ「無し」(null。js/scanner.js の初期値)に
          戻します。次に鳴らす時は元ピッチ(等速)からです。

        ⚠️ 測り直しでBPMがほとんど変わらなかった時も消します(竹弘の言う
           「新規で曲を読み込んだ時と同じ」。ノリ注入をやり直した曲は、
           元ピッチから始まる、と覚えておけば迷わないため)。
        ⚠️ 🕺ノリノリRun再生は userBPM を使わない(いつもマイピッチ)ので、
           走る速さには影響しません。
        */
        const oldUserBpm = track.userBPM;
        track.userBPM = null;

        await idbPut(STORE_MUSIC,track);

        console.log(
            "タップ補正の結果を保存しました :",
            track.file_name,
            "/ BPM " + tapState.bpm.toFixed(2) +
            // (v267)曲全体のBPMで保存したか(最後の確認で決めた判断)。(v268)C地点で決めたかも出します
            ((tapState.wholeSong && tapState.wholeSong.ok)
                ? "(曲全体 " + tapState.wholeSong.beats + "拍" + (tapState.wholeSong.byC ? "・C地点で確かめ" : "") + ")"
                : "(今までどおり)"),
            "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
            "/ 13拍目 " + tapState.endTS.toFixed(3) + "s",
            "/ 遅延 " + tapState.latencyMs + "ms",
            "/ 再生ピッチ " + (oldUserBpm ? oldUserBpm + " → 元ピッチに戻しました" : "無し(元ピッチのまま)")
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

    /*
    (v268)C地点の確定は、最後の確認へ戻るだけです(保存しない)。
    ⚠️ 下の A・B の分かれ道より先に分けること。C は「A ではない方」なので、
       ここで分けないと B地点の確定(→ 最後の確認を開き直す)の道へ落ちて、C の結果が消えます。
    */
    if(tapState.phase === TAP_PHASE_C){

        confirmTapCPhase();

        return;

    }

    if(tapState.phase === TAP_PHASE_A){

        /*
        ---- 遅延の値は、12回叩いて合わせた A地点の確定の時だけ保存します(v264。案「エ」)----

        次に測る曲の始まりの値になります。v263 までは A地点・B地点のどちらの確定でも
        保存していましたが、B地点で動かした分(正体は BPM のずれの直し)まで次の曲へ
        持ち越していました。くわしくは「12. 遅延の保存と読み込み」の頭のコメント。

        resumedFromSaved が立っている = 🕺の曲を開いて、叩かずに確かめている時です。
        その時の表示の数字は拍に当てていない(保存してある1拍目をそのまま使っている)
        ので、引き継ぎには入れません(竹弘 OK 2026-11-09)。
        */
        if(!tapState.resumedFromSaved){
            await saveTapLatency();
        }

        console.log(
            "A地点を確定しました :",
            "BPM " + tapState.bpm.toFixed(2),
            "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
            "/ 遅延 " + tapState.latencyMs + "ms",
            tapState.resumedFromSaved ? "(確かめなので、次の曲へは引き継ぎません)" : "(次の曲へ引き継ぎます)"
        );

        /*
        ---- 最後の確認から「A地点の微調整へ戻る」ための控え(v264)----

        B地点へ進むと、拍の格子・遅延・測る位置などが B地点のものに書き換わります。
        戻った時に「A地点を確定した時」とまったく同じ状態を出せるよう、ここで控えます。
        戻す処理は backToTapAdjustA()。

        ⚠️ endTS も控えます。🕺の曲の確かめ(resumedFromSaved)では、B地点で
           「保存してある13拍目」を聴いてもらうため、endTS がその値を運んでいます。
           控えずに戻ると、B地点で動かした後の値を「保存してある値」として出してしまいます。
        */
        tapState.phaseASnapshot = {
            bpm: tapState.bpm,
            beatOriginSec: tapState.beatOriginSec,
            startTS: tapState.startTS,
            endTS: tapState.endTS,
            latencyMs: tapState.latencyMs,
            posSec: tapState.posSec,
            fromSec: tapState.playOffset,
            resumedFromSaved: tapState.resumedFromSaved
        };

        /*
        【開発用調査ログ】(v263)A地点の値を控えます(B地点の確定で A+B のログに出す)。
        これから B地点なので、前に叩き直した B のBPMは消しておきます。
        */
        tapState.wholeSongLog = {
            bpmA: tapState.bpm,
            latencyA: tapState.latencyMs,
            bpmBTapped: null
        };

        startTapPhaseB();

        return;

    }

    /*
    B地点の確定 → **保存の前に「表打ちの確認」を挟みます**(v187)。

    竹弘の方針で、叩いている最中は表裏を気にせずリズムに乗ってもらい、
    判断は最後に1回だけにしました(startTapFinalCheck のコメント参照)。

    ⚠️ この画面を通るまで保存はしません。**確定保存を押して初めて**
       DBに書き込み、🕺の印を付けます。
    */
    if(!tapState.finalCheck){

        console.log(
            "B地点を確定しました :",
            "BPM " + tapState.bpm.toFixed(2),
            "/ 13拍目 " + tapState.endTS.toFixed(3) + "s"
        );

        // 【開発用調査ログ】(v263)A〜B の拍の数と曲全体のBPMを🐛に出します(保存する値は変えない)
        logTapWholeSong();

        startTapFinalCheck();

        return;

    }

    /*
    ここから下は表打ち確認の確定 ＝ この曲のノリ注入の仕上げです。

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

    /*
    ---- 測った曲が今の曲なら、新しいBPMを当て直します(v253) ----

    【v252までの穴】
    保存した後に作り直していたのは、曲一覧のその行(🛌→🕺)だけでした。
    上半分の「元ピッチ」の数字と、いま鳴っている曲の速さ(playbackRate)を
    決める applyTrackTempo()(js/pitch.js)は、**曲を鳴らし始めた時にしか**
    呼ばれません(js/upper-area.js の updatePitchDisplay)。そのため、
    今かかっている曲を測ると、選び直すまで古いBPMのままでした
    (竹弘の要望 2026-10-25「タップ補正後すぐに反映して欲しい」)。

    ⚠️ 見た目だけの話ではありませんでした。🕺ノリノリRun再生では

        曲の速さ       … 古いBPMで決めた倍率のまま(マイピッチ ÷ 古いBPM)
        接続・アシスト … 新しいBPMで計算する
                         (getTrackRate も getEffectiveBaseBpm も、保存した
                          manualBPM をその場で読むため)

    と食い違い、走るテンポもカチッも少しずつずれていきます。

    【なぜ閉じた後で呼ぶのか】
    閉じる前は #app が隠れていて、定規の大きさが測れないためです
    (closeTapCorrection が refreshAppHeight を呼んでいるのと同じ理由)。
    閉じる処理の中の play() は、音を出すのを予約するだけで、実際に
    鳴り出すのはこの処理が終わった後です。同じ流れの中で当て直すので、
    古い速さで鳴るとしても鳴り出しのごく一瞬だけです。

    ⚠️ 測った曲が今の曲でない時は何もしません。その曲は次に鳴らす時に
       updatePitchDisplay から新しいBPMが当たります。
    ⚠️ applyTrackTempo はマイピッチを書き換えません(中で keepMyPitch を
       立てて applyTempo を呼ぶため。v171)。走るテンポはそのままです。
    ⚠️ (v254)メインメニューでは、saveTapResult が userBPM を消しているので、
       ここで当て直すと元ピッチ(等速)で鳴ります。消さないと、古い元ピッチで
       決めた再生ピッチのまま倍率だけ変わり、2倍で鳴ることがありました。
    */
    if(finishedTrackId === currentTrackId){

        applyTrackTempo(libraryMap[finishedTrackId]);

    }

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

// 最後の確認画面の「A地点の微調整へ戻る」(v264)
tapBackA.onclick = backToTapAdjustA;

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

/*
表打ちの確認画面の2つのボタン(v187)。

「表打ちにする」は上の2つと違って**押すたびに向きが入れ替わる**ので、
data-* に値を持たせず、1つのボタンとして扱っています。

「確定保存」は confirmTapPhase をそのまま呼びます。同じ関数が
「A地点の確定」「B地点の確定」「表打ち確認の確定」の3役をこなし、
今どこにいるかで進み先を選びます(関数の中の分岐を参照)。
*/
const tapFinalHalfBtn = document.getElementById("tap-final-half");

if(tapFinalHalfBtn){

    tapFinalHalfBtn.onclick = function(){
        toggleTapFinalHalfBeat();
    };

}

/*
最後の確認画面の「🎯 精度を高める(C地点)」(v268。段0-5a)。押すと C地点の微調整画面へ入ります。
C地点の確定は、ふつうの確定ボタン(tap-confirm → confirmTapPhase)が受け持ちます。
*/
const tapFinalCBtn = document.getElementById("tap-final-c");

if(tapFinalCBtn){

    tapFinalCBtn.onclick = startTapPhaseC;

}


// ==========================================================
// 15. 【開発用調査ログ】(v263)A+B の数字と、叩いた時刻の取り方を🐛に出す
// ==========================================================
/*
段0(タップ補正の改善)の1歩目です。**動きは何も変えません。**
ここにある関数は🐛に数字を出すだけで、保存する値・画面・音には触りません。

    logTapWholeSong      … B地点を確定した時の A〜B の拍の数・曲全体のBPM
    logTapWholeSongSaved … 🕺の曲を開いた時、保存してある値で同じ数字
    logTapTimingCompare  … 叩いた時刻の2つの取り方の、ばらつきの比べっこ
    logTapCPositions     … (v270)C の拍が A の線・B の線のどちらに乗っているか(拍の位置で比べる案の下調べ)

【なぜ全部 try/catch で包んでいるのか】
ログを出す途中でエラーが起きると、呼んだ側(確定ボタン・微調整画面へ進む・
🕺の曲を開く)の続きが動かなくなり、ノリ注入そのものが止まってしまいます。
ログのせいで本番の流れが止まることがないよう、ここで受け止めます
(js/media-session.js の logMediaSessionAction が、ログの係が無くても
エラーにならない形にしてあるのと同じ心配。v237)。

⚠️ 本番リリース前に、この節ごと消してよい(CLAUDE.md「本番リリース前に削除するもの」)。
   ただし findTapWholeSongGrid と TAP_WHOLE_SONG_SAFE_FRAC は段0-4 で本番に使う予定なので、
   この節には置いていません(9. の節と 1. の節)。
*/

/**
 * B地点を確定した時に、A〜B の拍の数と曲全体のBPMを🐛に出します。
 *
 * 出すもの:
 *   ・どの道を通ったか(Aの線を引き継いだ / B地点を叩き直した / 前の値の確かめ)
 *   ・今のBPMで数えた拍の数と端数・曲全体のBPM・今との差
 *   ・今の線のままだと、アシストの拍(1拍目 + BPM で引いた格子)が接続点でどれだけずれるか
 *     (⑲ の録音で接続の瞬間にカチッが 58ms 跳んだのが、この量)
 *   ・AのBPM・叩き直したBのBPMで数えた時の拍の数(目安のBPMによって数え違えるかを見る)
 *   ・B地点で遅延を動かしたか(動かすと、A と B の間の長さが変わるため)
 */
function logTapWholeSong(){

    try{

        const log = tapState.wholeSongLog;

        let way = "Aの線を引き継いだ";

        if(tapState.resumedFromSaved){
            way = "前の値の確かめ(叩いていない)";
        }
        else if(log.bpmBTapped !== null){
            way = "B地点を叩き直した";
        }

        const head = "【開発用調査ログ】(v263)A+B(B地点を確定) : " + way;

        const now = findTapWholeSongGrid(tapState.startTS,tapState.endTS,tapState.bpm);

        if(!now){

            console.log(
                head,
                "/ 数えられません(1拍目 " + tapState.startTS + "s / 13拍目 " + tapState.endTS + "s)"
            );

            return;

        }

        const parts = [
            head,
            "A〜B " + now.lengthSec.toFixed(2) + "秒",
            describeTapWholeSong("今のBPM",tapState.bpm,now)
        ];

        if(log.bpmA !== null){

            const a = findTapWholeSongGrid(tapState.startTS,tapState.endTS,log.bpmA);

            if(a){ parts.push(describeTapCount("AのBPM",log.bpmA,a)); }

        }

        if(log.bpmBTapped !== null){

            const b = findTapWholeSongGrid(tapState.startTS,tapState.endTS,log.bpmBTapped);

            if(b){ parts.push(describeTapCount("叩き直したBのBPM",log.bpmBTapped,b)); }

        }

        if(log.latencyA !== null && log.latencyA !== tapState.latencyMs){

            parts.push(
                "B地点で遅延を " + formatTapSigned(tapState.latencyMs - log.latencyA,0) +
                "ms 動かした(" + log.latencyA + " → " + tapState.latencyMs + "ms)"
            );

        }

        console.log(parts.join(" / "));

    }
    catch(error){

        console.warn("A+B のログを出せませんでした :",error.name,error.message);

    }

}

/**
 * 🕺の曲を開いた時に、保存してある値で A〜B の拍の数を🐛に出します。
 *
 * 叩き直さなくても、今まで注入した曲の様子(端数が 0.5 に近い曲 = B地点だけ
 * 裏で叩いた疑いのある曲、アシストが接続点で跳ぶ量)が分かります。
 *
 * @param {object} track - 開いた曲のデータ(manualBPM / startTS / endTS が揃っている)
 */
function logTapWholeSongSaved(track){

    try{

        const head = "【開発用調査ログ】(v263)A+B(保存してある値) : " + track.file_name;

        const saved = findTapWholeSongGrid(track.startTS,track.endTS,track.manualBPM);

        if(!saved){

            console.log(
                head,
                "/ 数えられません(1拍目 " + track.startTS + "s / 13拍目 " + track.endTS + "s)"
            );

            return;

        }

        console.log(
            head +
            " / A〜B " + saved.lengthSec.toFixed(2) + "秒" +
            " / " + describeTapWholeSong("保存のBPM",track.manualBPM,saved)
        );

    }
    catch(error){

        console.warn("A+B(保存してある値)のログを出せませんでした :",error.name,error.message);

    }

}

/**
 * 「◯◯ 128.36 で数えると 429.13拍 → 429拍(端数 +0.13・安心)」の文を作ります。
 */
function describeTapCount(label,bpm,grid){

    return label + " " + bpm.toFixed(2) + " で数えると " +
        grid.beatsRaw.toFixed(2) + "拍 → " + grid.beats + "拍" +
        "(端数 " + formatTapSigned(grid.frac,2) + "・" +
        (grid.safe ? "安心" : "怪しい") + ")";

}

/**
 * describeTapCount に、曲全体のBPM・今との差・アシストの跳びを足した文を作ります。
 *
 * アシストの跳びは「端数 × 1拍の長さ」です。今のBPMで1拍目から格子を引くと、
 * 接続点(13拍目)のいちばん近い拍は、接続点から端数ぶんだけ離れています。
 * + は「接続点の方が、格子の拍より後ろ」。
 */
function describeTapWholeSong(label,bpm,grid){

    const diffPercent = (grid.bpm - bpm) / bpm * 100;

    const jumpMs = grid.frac * (60 / bpm) * 1000;

    return describeTapCount(label,bpm,grid) +
        " / 曲全体のBPM " + grid.bpm.toFixed(4) +
        "(" + label + "との差 " + formatTapSigned(diffPercent,3) + "%)" +
        " / " + label + "の格子のままだと、アシストの拍が接続点で " +
        formatTapSigned(jumpMs,0) + "ms ずれる";

}

/**
 * 叩いた時刻の2つの取り方で、ばらつきを比べて🐛に出します。
 *
 *     音の時計 … 今の取り方(taps)。指の知らせの処理が動いた瞬間の audioCtx.currentTime
 *     指の時刻 … 指が画面に触れた瞬間(tapFingerSec)。event.timeStamp
 *
 * どちらも、採用する8回に1本の線を引いて、線からどれだけ外れているか
 * (二乗平均。小さいほど揃っている)を出します。拍番号は、本番で引いた線
 * (grid)にいちばん近い拍を両方に同じく振ります。二度押しは1回目だけ使います
 * (fitTapBeatGrid と同じ扱い)。
 *
 * ⚠️ 2つの時計は0の位置が違いますが、線を引けばその差は消えるので、
 *    比べるのは「線からの外れ」とBPMだけにしています。
 *
 * @param {{beatDur:number, origin:number}} grid - fitTapBeatGrid が引いた線
 */
function logTapTimingCompare(grid){

    try{

        const songSec = tapState.taps.slice(TAP_DISCARD_COUNT);
        const fingerSec = tapState.tapFingerSec.slice(TAP_DISCARD_COUNT);

        if(songSec.length !== fingerSec.length || songSec.length < 3){

            console.log(
                "【開発用調査ログ】(v263)叩いた時刻の比べっこはできません :",
                "音の時計 " + songSec.length + "回 / 指の時刻 " + fingerSec.length + "回"
            );

            return;

        }

        const beats = [];
        const songUse = [];
        const fingerUse = [];

        for(let i = 0; i < songSec.length; i++){

            const beat = Math.round((songSec[i] - grid.origin) / grid.beatDur);

            // 二度押し(前と同じ拍)は捨てます
            if(beats.length > 0 && beat === beats[beats.length - 1]){ continue; }

            beats.push(beat);
            songUse.push(songSec[i]);
            fingerUse.push(fingerSec[i]);

        }

        const song = measureTapSpreadMs(beats,songUse);
        const finger = measureTapSpreadMs(beats,fingerUse);

        if(!song || !finger){ return; }

        console.log(
            "【開発用調査ログ】(v263)叩いた時刻のばらつき(" +
            (tapState.phase === TAP_PHASE_A ? "A地点" : "B地点") + "・" + beats.length + "点。" +
            "線からの外れの二乗平均) : 音の時計 " + song.spreadMs.toFixed(1) + "ms" +
            "(BPM " + song.bpm.toFixed(2) + ") / 指の時刻 " + finger.spreadMs.toFixed(1) + "ms" +
            "(BPM " + finger.bpm.toFixed(2) + ")"
        );

    }
    catch(error){

        console.warn("叩いた時刻の比べっこのログを出せませんでした :",error.name,error.message);

    }

}

/**
 * 拍番号と時刻の組に1本の線を引き、線からの外れ(二乗平均・ミリ秒)とBPMを返します。
 * 線の引き方は fitTapBeatGrid の「4. 直線を当てはめる」と同じ最小二乗法です。
 *
 * @param  {number[]} beats - 拍番号
 * @param  {number[]} times - 叩いた時刻(秒)
 * @return {{spreadMs:number, bpm:number}|null}
 */
function measureTapSpreadMs(beats,times){

    const n = beats.length;

    if(n < 3){ return null; }

    let sumN = 0;
    let sumT = 0;
    let sumNN = 0;
    let sumNT = 0;

    for(let i = 0; i < n; i++){

        sumN = sumN + beats[i];
        sumT = sumT + times[i];
        sumNN = sumNN + beats[i] * beats[i];
        sumNT = sumNT + beats[i] * times[i];

    }

    const denominator = n * sumNN - sumN * sumN;

    if(denominator === 0){ return null; }

    const beatDur = (n * sumNT - sumN * sumT) / denominator;
    const origin = (sumT - beatDur * sumN) / n;

    if(!isFinite(beatDur) || beatDur <= 0){ return null; }

    let sumSquare = 0;

    for(let i = 0; i < n; i++){

        const miss = times[i] - (origin + beatDur * beats[i]);

        sumSquare = sumSquare + miss * miss;

    }

    return {
        spreadMs: Math.sqrt(sumSquare / n) * 1000,
        bpm: 60 / beatDur
    };

}

/**
 * 数に + / - を付けて、決まった桁数の文字にします(0 は + を付けます)。
 */
function formatTapSigned(value,digits){

    return (value >= 0 ? "+" : "") + value.toFixed(digits);

}

/**
 * 【開発用調査ログ】(v270)C地点を確定した時、C の拍が「A の線」「B の線」のどちらに乗っているかを🐛に出します。
 * **判断には使っていません**(拍の位置で比べる案の下調べ。竹弘 OK 2026-11-09 の「のりから足した1つ目」)。
 *
 * 【何を見たいのか】
 * テンポは3つとも同じなのに、曲の途中で一瞬止まる所(ため・ブレイク)があって、その前と後ろで拍の位置が
 * ずれている曲は、テンポを比べても見分けられません(judgeTapTempoSide は "none" になる)。拍の位置なら見分けられるはず:
 *
 *     A の線 … 1拍目から A のテンポで C まで伸ばした格子。C の拍がこれに乗れば「A〜C の間にずれは無い」
 *     B の線 … 接続点から B のテンポで C まで戻した格子。C の拍がこれに乗れば「C〜B の間にずれは無い」
 *
 * 乗っているか = 数えた拍の数の端数が小さいか(TAP_WHOLE_SONG_SAFE_FRAC と同じ 0.2拍で見る)。
 * ⚠️ 線を数百拍伸ばすので、耳で合わせたテンポの誤差(0.1% で 100拍先 0.1拍)も端数に入ります。
 *    実際の曲でどれくらいの端数になるかを見てから、判断に入れるかを決めます。
 *
 * @param {object} c  - decideTapWholeSongBpmWithC の答え(cSec を使う)
 * @param {object} ab - decideTapWholeSongBpm の答え(bpmA・bpmNow を使う)
 */
function logTapCPositions(c,ab){

    try{

        const lineA = (c.cSec - tapState.startTS) * ab.bpmA / 60;
        const lineB = (tapState.endTS - c.cSec) * ab.bpmNow / 60;

        // Math.round は四捨五入。端数 = 数えた拍の数 − いちばん近い整数
        const fracA = lineA - Math.round(lineA);
        const fracB = lineB - Math.round(lineB);

        const onA = Math.abs(fracA) <= TAP_WHOLE_SONG_SAFE_FRAC;
        const onB = Math.abs(fracB) <= TAP_WHOLE_SONG_SAFE_FRAC;

        console.log(
            "【開発用調査ログ】(v270)C の拍の位置 :",
            "A の線(" + Number(ab.bpmA).toFixed(2) + ")で 1拍目から " + lineA.toFixed(2) + "拍(端数 " + formatTapSigned(fracA,2) + ")",
            "/ B の線(" + Number(ab.bpmNow).toFixed(2) + ")で接続点まで " + lineB.toFixed(2) + "拍(端数 " + formatTapSigned(fracB,2) + ")",
            "→ " + (onA && onB ? "両方に乗る" : (onA ? "A の線に乗る(C〜B の間でずれる?)" :
                    (onB ? "B の線に乗る(A〜C の間でずれる?)" : "どちらにも乗らない")))
        );

    }
    catch(error){
        console.error("【開発用調査ログ】(v270)C の拍の位置を出せませんでした :",error);
    }

}

const tapFinalSaveBtn = document.getElementById("tap-final-save");

if(tapFinalSaveBtn){

    tapFinalSaveBtn.onclick = confirmTapPhase;

}
