/*
======================================================================
 setup.js ── 初期設定(マイ・ピッチ設定 / Musicフォルダ登録)

----------------------------------------------------------------------

【このファイルの役割】

 起動時に1回だけ通る初期設定の処理です。

   ① マイ・ピッチ設定 … 定規をスワイプしてBPMを決める
   ② 起動設定         … Musicフォルダを登録する

 もともと c012.html の中に書かれていたものを、そのまま持ってきました。

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
    } else if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
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
