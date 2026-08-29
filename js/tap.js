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

    bpm: 120,           // 割り出したBPM
    beatOriginSec: 0,   // 拍番号0の位置(秒)。ここから拍が等間隔に並ぶ
    startTS: 0,         // 1拍目の位置(秒)
    latencyMs: 0,       // Bluetoothの遅延調整値

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

    resetTapPhase();

}


// ==========================================================
// 5. 曲を読み込む
// ==========================================================
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

        tapState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        /*
        曲の音量つまみを1つ作り、ここを通してから音を出します。
        メトロノームはこのつまみを通さないので、曲だけを小さくできます。
        */
        tapState.songGain = tapState.audioCtx.createGain();
        tapState.songGain.gain.value = TAP_SONG_GAIN;
        tapState.songGain.connect(tapState.audioCtx.destination);

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
 * タップをやり直せる状態に戻し、測る場所から曲を鳴らし直します。
 */
function resetTapPhase(){

    tapState.taps = [];
    tapState.locked = false;

    setTapLockUI(false);
    tapAdjustPanel.style.display = "none";
    tapZone.style.display = "flex";
    tapPosRow.style.display = "flex";

    tapCountLabel.textContent = "READY";

    setTapGuide(
        "曲のリズムに合わせて " + TAP_TOTAL_COUNT + " 回タップしてください。" +
        "最初の " + TAP_DISCARD_COUNT + " 回は計算に使わないので、" +
        "リズムに乗るまでの助走に使って大丈夫です。"
    );

    updateTapMonitor();
    updateTapPosLabel();

    // メトロノーム無しで、素の曲を鳴らします
    playTapSongFrom(tapState.posSec,false);

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
    source.connect(tapState.songGain);

    tapState.songSource = source;
    tapState.ctxStartTime = tapState.audioCtx.currentTime;
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

        try{ tapState.songSource.stop(); }
        catch(error){ /* すでに止まっている場合は何もしなくてよい */ }

        tapState.songSource = null;

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

    // 1拍目の位置。線を拍番号1のところまで伸ばした値です
    tapState.startTS = grid.origin + grid.beatDur;

    /*
    前回この端末で合わせた遅延を、そのまま当てておきます。

    遅延はイヤホンの性質なので、曲が変わっても同じ値のはずです。
    1曲目で合わせておけば、2曲目以降は最初から合った状態で
    始められます(369曲を測ることを考えると、この差は大きい)。
    */
    applyTapLatencyShift(tapState.latencyMs);

    tapZone.style.display = "none";
    tapPosRow.style.display = "none";
    setTapLockUI(false);
    tapAdjustPanel.style.display = "block";

    setTapGuide(
        "メトロノームと曲のリズムがぴったり重なるまで、下のボタンで調整してください。"
    );

    updateTapMonitor();

    // ここからはメトロノームを重ねて鳴らします
    playTapSongFrom(tapState.playOffset,true);

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

    tapState.beatOriginSec = tapState.beatOriginSec + deltaSec;
    tapState.startTS = tapState.startTS + deltaSec;

}


// ==========================================================
// 11. 表示の更新
// ==========================================================

function updateTapMonitor(){

    tapBpmDisplay.textContent = tapState.bpm.toFixed(2);
    tapTsDisplay.textContent = "1拍目 " + tapState.startTS.toFixed(3) + "s";
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
    tapPhaseLabel.textContent = "A地点(曲の頭側)";

    /*
    パネルの見せ方を、開いた直後の状態に戻しておきます。

    前回この画面を微調整の途中で閉じていると、その表示が残ったままに
    なります。曲の読み込みが終わるまで resetTapPhase() は動かないので、
    その数秒間だけ前回の微調整パネルが見えてしまう、という
    分かりにくい残像を防ぐための後始末です。
    */
    setTapLockUI(false);
    tapAdjustPanel.style.display = "none";
    tapZone.style.display = "flex";
    tapPosRow.style.display = "flex";
    tapCountLabel.textContent = "READY";

    tapScreen.style.display = "block";
    document.getElementById("app").style.display = "none";

}

/**
 * タップ補正画面を閉じて、メインメニューへ戻ります。
 */
function closeTapCorrection(){

    stopTapSound();

    /*
    AudioContext は作りっぱなしにするとブラウザに数を数えられ、
    いくつも開くと新しく作れなくなります。必ず閉じます。
    波形データ(約80MB)も、参照を捨ててメモリを解放します。
    */
    if(tapState.audioCtx){

        try{ tapState.audioCtx.close(); }
        catch(error){ /* すでに閉じている場合は何もしなくてよい */ }

        tapState.audioCtx = null;

    }

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
 * 「これで確定」が押された時の処理です。
 *
 * ⚠️ v147ではまだ曲のデータ(manualBPM / startTS)を保存しません。
 *    B地点の測定と一緒に v148 で保存します。ここで保存してしまうと、
 *    B地点が未測定の中途半端なデータが残ってしまうためです。
 *    遅延だけは「次の曲を測る時の初期値」なので先に保存します。
 */
async function confirmTapPhase(){

    await saveTapLatency();

    console.log(
        "A地点を確定しました :",
        "BPM " + tapState.bpm.toFixed(2),
        "/ 1拍目 " + tapState.startTS.toFixed(3) + "s",
        "/ 遅延 " + tapState.latencyMs + "ms",
        "(v147のためDBへの保存はまだ行いません)"
    );

    showTapToast(
        "A地点を測りました BPM " + tapState.bpm.toFixed(2) +
        " / 1拍目 " + tapState.startTS.toFixed(3) + "s"
    );

    closeTapCorrection();

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
document.getElementById("tap-retry-adjust").onclick = resetTapPhase;
document.getElementById("tap-confirm").onclick = confirmTapPhase;
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
