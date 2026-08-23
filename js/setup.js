/*
======================================================================
 setup.js ── 初期設定(マイ・ピッチ設定 / Musicフォルダ登録)

----------------------------------------------------------------------

【このファイルの役割】

 起動時に1回だけ通る初期設定の処理です。

   ① マイ・ピッチ設定 … 定規をスワイプしてBPMを決める
   ② 起動設定         … Musicフォルダを登録する

 もともと c012.html の中に書かれていたものを、そのまま持ってきました。

 【v145で追加】①のマイ・ピッチ設定は、メインメニュー上半分エリア9の
 「マイピッチ設定」ボタンからも開けるようになりました。**同じ画面を
 使い回し**、開き方によって文言2か所と「設定」ボタンの行き先だけを
 差し替えます。担当は下の方にある openMyPitchSetting() 一式です。

----------------------------------------------------------------------

【なぜメインメニューと同じページにまとめたのか(v77)】

 ブラウザは、ユーザーが選んだフォルダへのアクセス権限を
 「原則そのページを開いている間だけ」有効にします。
 別のページへ移動した瞬間に、せっかく取った許可が消えることがあります。

 実際、初期設定でMusicフォルダを選んだ直後にメインメニューへ移動したら、
 着いた時には権限が切れている現象が実機で起きました
 (ログに「Musicフォルダの権限がありません : prompt」)。

 そこで竹弘の発案により、初期設定とメインメニューを同じ1枚のページに
 まとめ、「画面を切り替えるだけでページは移動しない」作りにしました。
 移動しなければ、取った許可は失われません。

----------------------------------------------------------------------

【全体を (function(){ ... })() で囲んでいる理由】

 この書き方は IIFE(即時実行関数)と呼ばれ、「この中で作った変数や
 関数を、外から見えないようにする」ためのものです。

 c014の他のJSファイルは、変数を全員で共有する昔ながらの書き方を
 しています。そこへ c012 のコードをそのまま持ち込むと、
 同じ名前がぶつかって動かなくなる恐れがありました。実際、
 openNoriRunDB という同じ名前の関数が db.js にもあります
 (しかも中身が少し違う)。

 IIFEで囲めば、中の名前は一切外に漏れないので、名前がぶつかる心配が
 ありません。おかげで c012 のコードを書き換えずにそのまま運べました。

 外から呼びたいものだけ、最後に window.○○ の形で公開しています。

----------------------------------------------------------------------

【c012から変えた点(全部で5つだけ)】

 ① openNoriRunDB() を削除し、db.js のものを使うようにした。
    db.js 側に「DBの棚を作る処理」を移してあります。

 ② 画面が完成したあとの location.href("c014.html"へ移動) を
    showMainMenu() の呼び出しに変えた。これが今回の目的そのもので、
    ページを移動せず画面だけ切り替えます。

 ③ 初期設定画面を表示する処理を足した。以前はc012を開けば
    そのまま見えていましたが、今は同じページにメインメニューも
    同居しているため、どちらを見せるか指定する必要があります。

 ④ 定規の描画ループを止める仕組みを足した(stopRuler)。
    以前はページ移動で自然に止まりましたが、同じページに留まる
    ようになったため、止めないと裏で回り続けてしまいます。

 ⑤ 音を止める処理を足した(同じくstopRuler)。理由は④と同じです。

 それ以外の計算・描画・デザインは1文字も変えていません。
======================================================================
*/

(function(){

/**
 * ノリRun Ver.9 - STEP 1-A Final Source
 * (C) 2026 Takehiro & つよぽん
 */

const state = {
    bpm: 170,
    targetBpm: 170,
    minBpm: 100,
    maxBpm: 250,
    unitW: 20,
    isDragging: false,
    lastX: 0,
    audioCtx: null,
    clickBuffer: null,
    nextTickTime: 0,
    isPlaying: false
};

// 起動設定画面のモード
// first : 初回
// again : 2回目以降
let folderSetupMode = "first";

/*
【v77で追加】定規の絵を描き続けてよいかどうかの札です。

render() は requestAnimationFrame で自分自身を呼び続ける作りなので、
放っておくと永久に回り続けます。以前は初期設定が終わると別ページへ
移動していたため自然に止まりましたが、同じページに留まるように
なったので、自分で止める必要が出てきました。

止めないと、メインメニューで曲を並び替えている裏で、見えていない
定規の絵を描き続けることになり、動作が重くなります。
*/
let rulerActive = false;

const canvas = document.getElementById('ruler-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const numDisp = document.getElementById('pitch-number');
const labelDisp = document.getElementById('pitch-label');

// --- 1. Audioエンジン (click.wav連動) ---
async function setupAudio() {
    if (state.audioCtx) return;
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        const res = await fetch('click.wav');
        const buf = await res.arrayBuffer();
        state.clickBuffer = await state.audioCtx.decodeAudioData(buf);
    } catch (e) { console.error("click.wavが見つかりません"); }
}

function scheduler() {
    if (!state.isPlaying) return;
    while (state.nextTickTime < state.audioCtx.currentTime + 0.1) {
        playClick(state.nextTickTime);
        state.nextTickTime += 60.0 / state.bpm;
    }
    requestAnimationFrame(scheduler);
}

function playClick(time) {
    if (!state.clickBuffer) return;
    const s = state.audioCtx.createBufferSource();
    s.buffer = state.clickBuffer;
    s.connect(state.audioCtx.destination);
    s.start(time);
}

// --- 2. ヌルヌル描画ロジック ---
function render() {

    // 【v77で追加】止める札が出ていたら、ここで描画ループを終える
    if (!rulerActive) return;

    if (!state.isDragging) {
        state.bpm += (state.targetBpm - state.bpm) * 0.25; // 吸い付き補完
    } else {
        state.bpm = state.targetBpm;
    }

    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#3a3a3c';
    ctx.lineWidth = 1;
    ctx.font = 'bold 20px sans-serif';//目盛り数字サイズ
    ctx.textAlign = 'center';

    const start = Math.floor(state.bpm - (centerX / state.unitW)) - 1;
    const end = Math.ceil(state.bpm + (centerX / state.unitW)) + 1;

    for (let i = start; i <= end; i++) {
        if (i < state.minBpm || i > state.maxBpm) continue;
        const x = centerX + (i - state.bpm) * state.unitW;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        if (i % 10 === 0) {
            ctx.lineWidth = 2;
            ctx.lineTo(x, 45);
            ctx.fillStyle = '#1c1c1e';
            ctx.fillText(i, x, 65);
        } else if (i % 5 === 0) {
            ctx.lineWidth = 1.5;
            ctx.lineTo(x, 30);
        } else {
            ctx.lineWidth = 1;
            ctx.lineTo(x, 15);
        }
        ctx.stroke();
    }

    updateLabel();
    requestAnimationFrame(render);
}

function updateLabel() {
    const b = Math.round(state.bpm);
    numDisp.innerText = b;
    if (b <= 120) labelDisp.innerText = "🚶‍♂️ ウォーキング";
    else if (b <= 135) labelDisp.innerText = "🥁 行進";
    else if (b <= 200) labelDisp.innerText = "🏃‍♂️ マラソン";
    else labelDisp.innerText = "🏎️ 全力ダッシュ！";
}

// --- 3. 操作制御 ---
function handleStart(x) {
    if (!state.audioCtx) {
        setupAudio().then(() => {
            state.isPlaying = true;
            state.nextTickTime = state.audioCtx.currentTime;
            scheduler();
        });
    } else {

        /*
        【v145で修正】2回目以降に開いた時、メトロノームを鳴らし直します。

        【何が起きていたか】
        画面を閉じる時に呼ぶ stopRuler() は state.isPlaying を false に
        します。scheduler() は先頭で「isPlaying が false なら return」と
        しており、しかも requestAnimationFrame で自分自身を呼び続ける
        作りなので、**一度 false になるとカチカチを鳴らすループそのものが
        止まって、二度と復活しません。**

        以前はここが suspend の解除(resume)しかしていませんでした。
        初期設定は起動時に1回通るだけで、閉じた後に戻ってくることが
        無かったため、これで足りていたのです。

        v145でメインメニューから何度でも開けるようになったため、
        「音の出口(audioCtx)を開け直す」だけでなく「鳴らす係
        (scheduler)を動かし直す」必要が出てきました。

        2つの if を分けているのは、前からある resume の動きを
        変えないためです。上の if だけなら以前とまったく同じ動作で、
        下の if は「ループが止まっている時だけ」動きます。
        */

        if (state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }

        if (!state.isPlaying) {
            state.isPlaying = true;
            state.nextTickTime = state.audioCtx.currentTime;
            scheduler();
        }

    }
    state.isDragging = true;
    state.lastX = x;
}

function handleMove(x) {
    if (!state.isDragging) return;
    const deltaX = x - state.lastX;
    state.targetBpm -= deltaX / state.unitW;
    if (state.targetBpm < state.minBpm) state.targetBpm = state.minBpm;
    if (state.targetBpm > state.maxBpm) state.targetBpm = state.maxBpm;
    state.lastX = x;
}

function handleEnd() {
    state.isDragging = false;
    state.targetBpm = Math.round(state.targetBpm);
}

canvas.addEventListener('touchstart', e => { e.preventDefault(); handleStart(e.touches[0].clientX); }, {passive: false});
window.addEventListener('touchmove', e => { handleMove(e.touches[0].clientX); }, {passive: false});
window.addEventListener('touchend', handleEnd);

canvas.addEventListener('mousedown', e => handleStart(e.clientX));
window.addEventListener('mousemove', e => handleMove(e.clientX));
window.addEventListener('mouseup', handleEnd);

/*
【v77で追加】
定規の描画と音を止めます。

初期設定を終えてメインメニューへ移る時に呼びます。
以前はページを移動していたので何もしなくても止まりましたが、
同じページに留まるようになったため、明示的に止める必要があります。

audioCtx は close() ではなく suspend() にしています。
close() すると二度と使えなくなりますが、suspend() なら
「一時停止」なので、将来メニューの「設定」からマイ・ピッチを
変更する画面を作った時にそのまま使い回せます。
*/
function stopRuler() {

    rulerActive = false;
    state.isPlaying = false;

    if (state.audioCtx && state.audioCtx.state === 'running') {
        state.audioCtx.suspend();
    }

}

/*
【v77で追加】
初期設定画面を表示し、メインメニューを隠します。

同じページに2つの画面が同居しているため、どちらを見せるかを
ここで切り替えます。
*/
function showSetupWrapper() {

    document.getElementById("setup-screen").style.display = "block";
    document.getElementById("app").style.display = "none";

}

// --- 4. 保存 & 完了フラグ ---
async function saveAndNext() {

    state.isPlaying = false;

    try {

        const db = await openNoriRunDB();

        const tx = db.transaction("settings", "readwrite");
        const store = tx.objectStore("settings");

        store.put(Math.round(state.bpm), "my_pitch");
        store.put(true, "init_completed");
        store.put(0.8, "volume");
        store.put(0, "latency");
        store.put("registered_at_desc", "main_sort_order");
        store.put("", "current_playlist_id");

        tx.oncomplete = function () {

            db.close();

            showFolderSetupScreen();

        };

        tx.onerror = function () {

            db.close();

            alert("初期設定の保存に失敗しました。");

        };

    } catch (error) {

        alert(error);

    }

}

document.getElementById('save-btn').onclick = saveAndNext;
document.getElementById("folder-btn").onclick = handleFolderSetupButton;


// ==========================================================
// マイピッチ設定(メインメニューから開く / v145)
// ==========================================================
/*
上半分エリア9の「マイピッチ設定」ボタンから、この初期設定画面を
もう一度開くための処理です。

【なぜ新しい画面を作らないのか(竹弘の指示)】

    「これは、既存の初期設定画面と機能は同じもの。
      このノリRunが、他のプレイヤーとはちょっと違うプレイヤーだと
      いうことを感じ取ってもらうため、わざと初期設定に入れたもの
      なので、機能や使用用途は同じなのです。
      文言が合わない所だけ変更して使いまわしでok」

同じ画面を2つ作ると、片方だけ直して食い違う事故が必ず起きます。
1つの画面を使い回し、**開き方によって変わるのは文言2か所と
「設定」ボタンの行き先だけ**にしています。

    見出し     「ノリRun 初期設定」 → 「マイピッチ設定」
    注意書き   「(※メニュー画面から後で変更できます)」 → 消す
               (メニューから開いたのだから、案内する必要がない)
    設定ボタン saveAndNext(初期設定の続きへ) → saveMyPitchOnly(戻る)

【なぜ saveAndNext を書き換えずに onclick を差し替えるのか】

saveAndNext は起動時の初期設定という、すでに完成して動いている
流れの一部です。そこに「今どっちのモードか」を判定する分岐を足すと、
初期設定そのものを壊す危険があります。

ボタンの行き先(onclick)を丸ごと入れ替える方式なら、saveAndNext は
1文字も触らずに済みます。初期設定の流れは今までと完全に同じです。
*/

/*
【v146】マイピッチ設定を開いた時に、曲が鳴っていたかどうかの覚え書きです。

竹弘の指示(2026-08-23):
    「マイピッチ設定を開いた時は、もし曲を流していたら、曲は一時停止
      して欲しい。ランナーが走る為の自分のピッチを決める大事な所だから。
      裏で曲が流れていると、集中して自分の走りたいピッチを設定しにくい。
      戻ったら続きの再生として欲しい」

「戻ったら続きから」を実現するには、**開いた時に鳴っていたのかどうか**を
覚えておく必要があります。もともと止まっていた場合に戻り際で勝手に
鳴り出すと、竹弘が意図していない再生になってしまうためです。

停止には audioPlayer.pause() を使います。currentTime(何秒目か)は
そのまま残るので、play() を呼べば続きから鳴ります。
*/
let wasPlayingBeforeMyPitch = false;

/**
 * マイピッチ設定画面を開きます(メインメニューのボタンから呼ばれます)。
 *
 * 先に「今保存されているマイピッチ」を読み込んでから画面を出します。
 *
 * 【なぜ読み込みが要るのか】
 * この state.bpm は初期値が170です。2回目以降の起動ではルートBを通り、
 * 初期設定画面を通らないので、170のままになっています。読み込まずに
 * 画面を出すと、**竹弘が以前185に設定していても定規は170を指し、
 * そのまま「設定」を押すと170で上書きしてしまいます。**
 */
async function openMyPitchSetting() {

    try {

        const db = await openNoriRunDB();

        const tx = db.transaction("settings", "readonly");
        const getRequest = tx.objectStore("settings").get("my_pitch");

        getRequest.onsuccess = function () {

            const saved = getRequest.result;

            /*
            保存されている値が「数字で、定規の範囲(100〜250)に収まって
            いる」時だけ受け入れます。DBが空だったり、将来範囲を変えた
            後に古い値が残っていた場合でも、定規が壊れないようにする
            ための用心です(再生モードの復元と同じ考え方)。
            */
            if (typeof saved === "number" &&
                saved >= state.minBpm &&
                saved <= state.maxBpm) {

                state.bpm = saved;
                state.targetBpm = saved;

            }

            db.close();

            showMyPitchScreen();

        };

        getRequest.onerror = function () {

            db.close();

            // 読めなくても画面は開きます(今の値のまま調整できます)
            console.error("マイピッチの読み込みに失敗しました");

            showMyPitchScreen();

        };

    } catch (error) {

        console.error("マイピッチの読み込みに失敗 :", error.name, error.message);

        showMyPitchScreen();

    }

}

/**
 * 画面をマイピッチ設定の見た目にして表示します。
 */
function showMyPitchScreen() {

    /*
    ---- 曲が鳴っていたら一時停止する(v146) ----

    自分の走るピッチを決める大事な画面なので、裏で音楽が流れたまま
    だとメトロノームに集中できません(竹弘の指示)。

    paused は「止まっている時に true」になる標準の値です。
    もともと止まっていた場合は false のままにしておき、戻り際に
    勝手に鳴り出さないようにします。

    【停止ボタンの記号(■ ⇄ ▶)をわざと触っていない理由】
    js/upper-area.js は「竹弘が自分で押した停止」の時だけ記号を
    ▶ に変えます(v135の intentionalPause)。ここはすぐ戻して
    続きを鳴らす一時的な停止なので、その旗は立てません。おかげで
    記号は ■ のまま動かず、開いて閉じただけでボタンがちらつく
    ことがありません。
    */
    wasPlayingBeforeMyPitch = !audioPlayer.paused;

    if (wasPlayingBeforeMyPitch) {
        audioPlayer.pause();
    }

    // ---- 文言をメニューから開いた時のものに差し替える ----
    document.getElementById("init-screen-title").textContent = "マイピッチ設定";
    document.getElementById("init-later-note").style.display = "none";

    // ---- 「設定」ボタンの行き先を差し替える ----
    document.getElementById("save-btn").onclick = saveMyPitchOnly;

    // ---- 画面を切り替える ----
    showSetupWrapper();

    /*
    display に空文字("")を入れると、HTMLに直接書かれた指定が外れて
    CSSファイル側の指定(#init-screen は display:flex)に戻ります。
    "flex" と直接書かないのは、CSSを直した時にここも直す必要が
    出るのを避けるためです。

    初期設定を通った直後にこのボタンを押した場合、#init-screen は
    showFolderSetupScreen() によって "none" にされたままなので、
    ここで戻さないと画面が真っ白になります。
    */
    document.getElementById("init-screen").style.display = "";
    document.getElementById("folder-setup-screen").style.display = "none";

    /*
    定規を描き始めます。**必ず画面を表示した後に測ること。**
    表示していない要素は幅を測れず、canvasの大きさが0になります
    (startRouteA と同じ順番・同じ理由です)。
    */
    const container = document.getElementById("ruler-container");

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    rulerActive = true;

    render();

}

/**
 * マイピッチだけを保存して、メインメニューへ戻ります。
 *
 * 【saveAndNext との違い】
 * saveAndNext は初期設定用なので、my_pitch と一緒に volume や
 * main_sort_order など「最初の1回だけ書き込む初期値」もまとめて
 * 保存します。こちらでそれをやると、**竹弘が選んだ並び順などが
 * 設定を開くたびに初期値へ戻ってしまいます。**
 *
 * 再設定で書き換えてよいのは my_pitch ただ1つです。
 */
async function saveMyPitchOnly() {

    state.isPlaying = false;

    try {

        const db = await openNoriRunDB();

        const tx = db.transaction("settings", "readwrite");

        tx.objectStore("settings").put(Math.round(state.bpm), "my_pitch");

        tx.oncomplete = function () {

            db.close();

            console.log("マイピッチを保存しました :", Math.round(state.bpm));

            closeMyPitchSetting();

        };

        tx.onerror = function () {

            db.close();

            /*
            alert は使いません(v129以降のこのアプリの方針)。
            押されるまでJavaScriptが丸ごと止まるためです。
            保存に失敗しても画面は閉じて、メインメニューへ戻します。
            */
            console.error("マイピッチの保存に失敗しました");

            closeMyPitchSetting();

        };

    } catch (error) {

        console.error("マイピッチの保存に失敗 :", error.name, error.message);

        closeMyPitchSetting();

    }

}

/**
 * マイピッチ設定画面を閉じて、メインメニューへ戻します。
 */
function closeMyPitchSetting() {

    // 定規の描画とメトロノームを止めます(裏で回り続けると重くなります)
    stopRuler();

    /*
    文言と「設定」ボタンの行き先を、初期設定用に戻しておきます。

    この画面はアプリ内で1つしかない共有の部品なので、**借りたら
    元の状態に戻す**のが決まりです。戻し忘れると、dbclr.htmlで
    DBを消して初期設定をやり直した時に、見出しが「マイピッチ設定」の
    ままになります。
    */
    document.getElementById("init-screen-title").textContent = "ノリRun 初期設定";
    document.getElementById("init-later-note").style.display = "";
    document.getElementById("save-btn").onclick = saveAndNext;

    /*
    メインメニューへ戻します。

    【なぜ showMainMenu() を呼ばないのか】
    showMainMenu() は曲一覧の読み込み(369曲)からやり直す、起動用の
    重い処理です。ここで呼ぶと戻るたびに一覧が作り直され、スクロール
    位置も戻ってしまいます。設定を変えただけで曲一覧に用は無いので、
    画面の表示を切り替えるだけにします。

    "flex" で戻すのは、#app が上下2分割のflexレイアウトだからです。
    "block" にすると分割が崩れます。
    */
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";

    /*
    ---- 止めておいた曲を、続きから鳴らし直す(v146) ----

    画面を先に戻してから鳴らしています。曲一覧が見えている状態で
    音が戻る方が、竹弘から見て「戻ってきた」と分かりやすいためです。

    audioPlayer.pause() は再生位置(currentTime)を消さないので、
    play() を呼ぶだけで続きから鳴ります。1曲リピート中の loop 属性も
    そのまま保たれます。

    【なぜ catch を付けているのか】
    play() は「鳴らせたかどうか」を後から知らせる約束(Promise)を
    返します。ここは「設定」ボタンを押してから保存を待った後なので、
    ブラウザから見ると「ユーザーが今まさに押した」瞬間ではありません。
    画面が点いていて直前に操作しているので、まず弾かれることは
    ありませんが、万一断られた時に赤いエラーがコンソールへ流れる
    だけで済むようにしておきます(alert は使わない方針。押されるまで
    JavaScriptが丸ごと止まるため)。
    */
    if (wasPlayingBeforeMyPitch) {

        wasPlayingBeforeMyPitch = false;

        const resumed = audioPlayer.play();

        if (resumed && typeof resumed.catch === "function") {

            resumed.catch(function (error) {

                console.error(
                    "マイピッチ設定から戻った時の再生再開に失敗 :",
                    error.name,
                    error.message
                );

            });

        }

    }

}

/*
上半分エリア9の「マイピッチ設定」ボタンに繋ぎます。

この画面の開け閉めに関わるものを1か所にまとめておきたいので、
ボタンの割り当てもこのファイルに置いています(このファイルの名前
どおり「マイ・ピッチ設定」はもともと setup.js の担当です)。
*/
document.getElementById("mypitch-btn").onclick = openMyPitchSetting;

/*
  ルートA
    初回起動用
    init_completed が未設定または false
    初期設定を行う

  ルートB
    2回目以降用
    init_completed が true
    初期設定を飛ばして次画面へ進む
*/

async function init() {

    try {

        const db = await openNoriRunDB();

        const tx = db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");

        const getRequest = store.get("init_completed");

        getRequest.onsuccess = function () {

            const initCompleted = getRequest.result;

            if (initCompleted === true) {

                startRouteB();

            } else {

                startRouteA();

            }

            db.close();

        };

        getRequest.onerror = function () {

            db.close();

            alert("初期設定状態の確認に失敗しました。");

        };

    } catch (error) {

        alert(error);

    }

}

// --- ルートA：初回起動。初期設定画面を表示する ---
function startRouteA() {

    // 【v77で追加】初期設定画面を先に見せる。
    // 表示していない要素は幅を測れず、canvasの大きさが0になるため、
    // 必ずこの順番で行う。
    showSetupWrapper();

    const container = document.getElementById("ruler-container");

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // 【v77で追加】描いてよい札を立ててから描画を始める
    rulerActive = true;

    render();
}

// --------------------------------------------------
// 起動設定画面を表示する
//
// mode:
//   "first" = 初回のMusicフォルダ登録
//   "again" = 2回目以降の前回フォルダ再許可
// --------------------------------------------------
function showFolderSetupScreen(mode) {

    // 【v77で追加】初期設定画面を見せ、定規の描画と音を止める
    showSetupWrapper();
    stopRuler();

    folderSetupMode = mode || "first";

    document.getElementById("init-screen").style.display = "none";
    document.getElementById("folder-setup-screen").style.display = "flex";

    const title = document.getElementById("folder-setup-title");
    const message = document.getElementById("folder-setup-message");
    const button = document.getElementById("folder-btn");
    const box = document.querySelector("#folder-setup-screen .kaisetu-box");

    if (mode === "again") {

        box.style.display = "none";

        button.innerText = "前回設定を登録します";
        button.style.background = "#007aff";
        button.style.boxShadow = "0 6px 20px rgba(0,122,255,0.4)";
        button.style.marginTop = "250px";

    } else {

        box.style.display = "block";

        title.innerText = "🎵 Musicフォルダの設定🎵";

        message.innerHTML =
            "① ノリRunで再生する<strong>「音楽フォルダ」</strong>を登録します。<br>" +
            "フォルダへのアクセスを<strong>「許可」</strong>してください。<br><br>" +
            "② あなたの端末内にあるノリRun曲データベースサイトに、<br>" +
            "<strong>「曲情報」</strong>を<strong>「アップロード」</strong>します。<br><br>" +
            "（🛡️曲情報は端末内に保存され、外部へ送信されません。）";

        button.innerText = "Musicフォルダを登録する";
        button.style.background = "#ff9500";
        button.style.boxShadow = "0 6px 20px rgba(255,149,0,0.4)";
        button.style.marginTop = "30px";

    }
}
// --------------------------------------------------
// 保存済みのMusicフォルダ情報を取得する
// folder_roots ストアから root_music を読む
// --------------------------------------------------
async function getMusicFolderRoot() {

    const db = await openNoriRunDB();

    return new Promise(function (resolve, reject) {

        const tx = db.transaction("folder_roots", "readonly");
        const store = tx.objectStore("folder_roots");

        const request = store.get("root_music");

        request.onsuccess = function () {
            db.close();
            resolve(request.result);
        };

        request.onerror = function () {
            db.close();
            reject("Musicフォルダ情報の確認に失敗しました。");
        };

    });

}

// --------------------------------------------------
// 起動設定ボタンが押された時の入口
//
// 初回起動なら
//   Musicフォルダを新しく選択する。
//
// 2回目以降なら
//   前回登録したMusicフォルダの
//   アクセス許可だけを取り直す。
//
// どちらを実行するかは
// folderSetupMode で判断する。
// --------------------------------------------------
async function handleFolderSetupButton() {

    if (folderSetupMode === "again") {

        await requestSavedMusicFolderPermissionAndNext();

    } else {

        await registerMusicFolderAndNext();

    }

}
// --------------------------------------------------
// 前回登録したMusicフォルダの
// アクセス権限を取り直す
//
// Android Chromeでは
// requestPermission() は
// ユーザーがボタンを押した時しか実行できない。
//
// 許可されたら
// メインメニューを表示する。
//
// v77より、ページを移動せず同じページ内で画面を
// 切り替えるようになった。移動しないことで、
// せっかく取った許可が失われないようにしている。
// --------------------------------------------------
async function requestSavedMusicFolderPermissionAndNext() {

    const rootData = await getMusicFolderRoot();

    const dirHandle = rootData.root_folder_handle;

    let permission =
        await dirHandle.queryPermission({ mode: "read" });

    if (permission !== "granted") {

        permission =
            await dirHandle.requestPermission({ mode: "read" });

    }

    if (permission === "granted") {

        showMainMenu();

    }

}

// --------------------------------------------------
// 初回起動用
//
// Musicフォルダをユーザーに選んでもらう。
//
// 選択したフォルダの情報を
// folder_roots に保存する。
//
// 保存が終わったら
// メインメニューを表示する。
// --------------------------------------------------
async function registerMusicFolderAndNext() {

    try {

        if (!window.showDirectoryPicker) {
            alert("このブラウザはフォルダ選択に対応していません。");
            return;
        }

        const dirHandle = await window.showDirectoryPicker({
            mode: "read"
        });

        const db = await openNoriRunDB();

        const tx = db.transaction("folder_roots", "readwrite");
        const store = tx.objectStore("folder_roots");

        store.put({
            folder_roots_id: "root_music",
            root_name: dirHandle.name,
            root_folder_handle: dirHandle
        });

        tx.oncomplete = function () {
            db.close();
            showMainMenu();
        };

        tx.onerror = function () {
            db.close();
            alert("Musicフォルダの保存に失敗しました。");
        };

    } catch (error) {
        alert("Musicフォルダの登録をキャンセルしました。");
    }
}

// --------------------------------------------------
// ルートB（2回目以降）
//
// ① Musicフォルダが登録されているか確認
//
// ② 権限状態を確認
//
// granted
//   → メインメニューを表示
//
// prompt
//   → 起動設定画面を表示
//
// requestPermission() は
// ボタンを押した時だけ実行する。
// --------------------------------------------------
async function startRouteB() {

    try {

        const rootData = await getMusicFolderRoot();

        // Musicフォルダがまだ登録されていない場合
        // 初回用の起動設定画面を表示する
        if (!rootData || !rootData.root_folder_handle) {
            showFolderSetupScreen("first");
            return;
        }

        const dirHandle = rootData.root_folder_handle;

        // 保存済みフォルダの現在の権限状態を確認する
        const permission = await dirHandle.queryPermission({ mode: "read" });

        // 権限が残っている場合は、そのままメインメニューへ進む
        if (permission === "granted") {
            showMainMenu();
            return;
        }

        // 権限が切れている場合
        // ここでは requestPermission() は呼ばない
        // ユーザー操作が必要なので、2回目以降用の起動設定画面を表示する
        showFolderSetupScreen("again");

    } catch (error) {

        alert(error);

    }

}

/*
======================================================================
 外から呼べるように公開する

 IIFEで囲っているため、中の関数は通常どこからも見えません。
 main.js から起動できるよう、入口だけを window に登録します。

   initSetupFlow  … 初期設定が必要か判断して、画面を出し分ける
   stopSetupRuler … 定規の描画と音を止める(念のための保険)
======================================================================
*/
window.initSetupFlow = init;
window.stopSetupRuler = stopRuler;

})();
