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

     段①(v221) … 画面の開け閉め・入った時の一時停止・①ピッチ ← いまここ
     段②        … ②Bluetooth遅延の測定と保存
     段③        … ③時刻ボタンと、その時刻に拍を揃えたスタート
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
    wasPlaying: false

};

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

    console.log(
        "みんなで走る同期モードを開きました :",
        "マイピッチ " + myPitch + " から始めます /",
        (syncState.wasPlaying ? "鳴っていた曲を一時停止" : "曲は止まっていた")
    );

}

/**
 * 同期モードの画面を閉じます(✕ボタン)。
 */
function closeSyncPanel(){

    if(!syncPanelEl){ return; }

    // テンポの音と定規を止めます(裏で回り続けると電池を食います)
    stopSyncTempoSound();

    syncRuler.stop();

    syncPanelEl.style.display = "none";

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
    if(syncStepLatencyEl){
        syncStepLatencyEl.style.display = decided ? "" : "none";
    }

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

})();
