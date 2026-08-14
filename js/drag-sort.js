/*
======================================================================
 drag-sort.js ── 並び替え(OFS: On-Demand Floating Sort)

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の並び替えボタン(右端の上下矢印)を掴んで、
 曲順をドラッグ&ドロップで入れ替える機能です。

 legacy/ver8.5-gemini の「OFSモジュール」を移植したもので、
 処理の考え方は元のOFS仕様書の通り、変えていません。

   ・並び替えボタン(.sort-handle)を掴んだ時だけ反応する
     (曲名エリアでの通常スクロールを邪魔しないため)
   ・指を離した時だけ、並び順をplaylistsストアへ保存する
     (ドラッグ中に毎回保存すると重くなるため)
   ・一覧の端に指を持っていくと自動でスクロールし、
     その間はエリアの上下端が光る

 ただし、OFSは元々 music_library の file_path をキーにしていたのに対し、
 現行スキーマ(docs/db-schema.md)は track_id が主キーのため、
 track_id 基準に置き換えています。playlistsストアの保存フィールドも
 file_path_list ではなく track_id_list(現行スキーマ通り)を使います。

----------------------------------------------------------------------

【他のファイルとの関係】

   bindDragAndDropEvents() … list-view.js が行を作るたびに呼ぶ
   draggingRow(変数)      … list-view.js の refreshRow() が参照する
                             (掴んでいる最中の行は差し替えないため)
   currentOrderList(変数) … config.js の共有状態。並び替え後に作り直す
======================================================================
*/


// ==========================================================
// 1. ドラッグ操作の状態と設定値
// ==========================================================

// ドラッグ&ドロップ操作用の状態(OFSより移植)
let draggingRow = null;
let placeholder = null;
let startOffsetY = 0;
let currentClientY = 0;
let autoScrollActive = false;

/*
自動スクロールが始まる「エリアの端からの距離(px)」です。

元のOFSは画面全体をスクロール対象にしていたので100pxでしたが、
曲一覧が画面下半分(=だいたい高さ300〜400px)のエリア内スクロールに
変わったため、100pxのままだとエリアのほぼ全域が
「自動スクロールゾーン」になってしまいます。

行の高さ(56px)とのバランスを見て、少し狭めています。
*/
const AUTO_SCROLL_ZONE = 55;

// 自動スクロールの最高速度(1フレームあたり何px動かすか)
const AUTO_SCROLL_MAX_SPEED = 18;


// ==========================================================
// 2. ドラッグ操作の受け付け
// ==========================================================

function bindDragAndDropEvents(row,handle){

    handle.addEventListener("pointerdown",function(e){

        e.preventDefault();
        draggingRow = row;
        currentClientY = e.clientY;

        const rect = row.getBoundingClientRect();
        startOffsetY = e.clientY - rect.top;

        if(!placeholder){
            placeholder = document.createElement("div");
            placeholder.className = "drag-placeholder";
        }

        row.parentNode.insertBefore(placeholder,row);

        row.style.width = rect.width + "px";
        row.style.height = rect.height + "px";
        row.style.left = rect.left + "px";
        row.style.top = rect.top + "px";
        row.classList.add("dragging");
        handle.classList.add("active-blue");

        handle.setPointerCapture(e.pointerId);

        if(navigator.vibrate){ navigator.vibrate(15); }

        // 掴んだ瞬間は自動スクロールを起動しません(端をうっかり掴んだ時の暴走防止)。

    });

    handle.addEventListener("pointermove",function(e){

        if(!draggingRow){ return; }
        e.preventDefault();

        currentClientY = e.clientY;

        draggingRow.style.top = (currentClientY - startOffsetY) + "px";

        updatePlaceholderPosition(currentClientY);

        // 指が動くたびにセンサーを起動します(端に入った時だけループが着火します)。
        startAutoScrollLoop();

    });

    handle.addEventListener("pointerup",function(e){

        if(!draggingRow){ return; }
        handle.releasePointerCapture(e.pointerId);
        clearAllDraggingStates();

    });

}

function updatePlaceholderPosition(clientY){

    if(!draggingRow || !placeholder){ return; }

    const siblings = Array.prototype.slice.call(
        menuListEl.querySelectorAll(".music-row:not(.dragging)")
    );

    const nextSibling = siblings.find(function(sibling){
        const box = sibling.getBoundingClientRect();
        return clientY <= box.top + box.height / 2;
    });

    if(nextSibling){
        menuListEl.insertBefore(placeholder,nextSibling);
    }
    else{
        menuListEl.appendChild(placeholder);
    }

}


// ==========================================================
// 3. 端に近づいた時の自動スクロール
// ==========================================================
/*
オンデマンド(指の動きに応じて)再着火する自動スクロールループです。

一度ゾーンから出るとループを終了させ、
次にゾーンへ入った時にまた新しく起動し直します。
(こうしないと「一度止まると二度と動かない」バグになります)

--------------------------------------------------------------
【固定1画面化にあたっての変更点】

元のOFSは、ページ全体がスクロールする前提で作られており、
    ・window.scrollY   (ページ全体が今どこまでスクロールしたか)
    ・window.innerHeight(画面の高さ)
    ・window.scrollBy() (ページ全体を動かす)
を使っていました。

しかし今回、曲一覧は画面下半分のエリア内だけでスクロールする
形に変わったため、判断の基準を全て
「曲一覧エリア(menuListEl)」に置き換えています。

    window.scrollY      → menuListEl.scrollTop
                          (このエリアが今どこまでスクロールしたか)
    window.innerHeight  → エリアの上端/下端の画面座標
    window.scrollBy()   → menuListEl.scrollTop += speed

なお getBoundingClientRect() は
「その要素が今、画面のどこに見えているか」を返す命令です。
エリアの位置は画面の高さによって変わる(再生エリアの表示/非表示や
アドレスバーの伸縮の影響を受ける)ため、決め打ちの数値ではなく
毎回この命令で測り直しています。
--------------------------------------------------------------
*/
function startAutoScrollLoop(){

    if(autoScrollActive){ return; }

    // 曲一覧エリアが、今画面のどの位置にあるかを測ります。
    const listRect = menuListEl.getBoundingClientRect();

    // このエリアが「あと何pxスクロールできるか」の上限値です。
    // (中身全体の高さ - 見えている高さ = 隠れている分)
    const scrollMax = menuListEl.scrollHeight - menuListEl.clientHeight;

    // 指がエリアの上端付近にあり、かつ、まだ上にスクロールできる状態か
    const isTopZone =
        (currentClientY < listRect.top + AUTO_SCROLL_ZONE &&
         menuListEl.scrollTop > 0);

    // 指がエリアの下端付近にあり、かつ、まだ下にスクロールできる状態か
    const isBottomZone =
        (currentClientY > listRect.bottom - AUTO_SCROLL_ZONE &&
         menuListEl.scrollTop < scrollMax);

    if(!isTopZone && !isBottomZone){ return; }

    autoScrollActive = true;

    function scrollLoop(){

        if(!draggingRow){ stopAutoScrollGlow(); return; }

        let speed = 0;

        // ループの毎回、エリアの位置と残りスクロール量を測り直します。
        const rect = menuListEl.getBoundingClientRect();
        const currentScrollMax = menuListEl.scrollHeight - menuListEl.clientHeight;

        const glowTop = document.getElementById("glow-top");
        const glowBottom = document.getElementById("glow-bottom");

        glowTop.classList.remove("glow-active");
        glowBottom.classList.remove("glow-active");

        if(currentClientY < rect.top + AUTO_SCROLL_ZONE &&
           menuListEl.scrollTop > 0){

            /*
            ratio は「ゾーンにどれだけ深く入り込んだか」を
            0〜1で表した割合です。端に近いほど1に近づき、速く動きます。

            Math.min(ratio,1) で1を超えないように制限しているのは、
            指が曲一覧エリアの外(画面の上半分)まで出た時に
            割合が1を超えてスクロールが暴走するのを防ぐためです。
            (エリアが画面の半分になったことで、
              指が外に出るケースが起きやすくなったため追加しました)
            */
            const ratio = (rect.top + AUTO_SCROLL_ZONE - currentClientY) / AUTO_SCROLL_ZONE;
            speed = -Math.ceil(Math.min(ratio,1) * AUTO_SCROLL_MAX_SPEED);
            glowTop.classList.add("glow-active");
        }
        else if(currentClientY > rect.bottom - AUTO_SCROLL_ZONE &&
                menuListEl.scrollTop < currentScrollMax){

            const ratio = (currentClientY - (rect.bottom - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE;
            speed = Math.ceil(Math.min(ratio,1) * AUTO_SCROLL_MAX_SPEED);
            glowBottom.classList.add("glow-active");
        }

        if(speed !== 0){
            // ページ全体ではなく、曲一覧エリアの中だけを動かします。
            menuListEl.scrollTop += speed;
            updatePlaceholderPosition(currentClientY);
            requestAnimationFrame(scrollLoop);
        }
        else{
            autoScrollActive = false;
            stopAutoScrollGlow();
        }

    }

    requestAnimationFrame(scrollLoop);

}

function stopAutoScrollGlow(){
    document.getElementById("glow-top").classList.remove("glow-active");
    document.getElementById("glow-bottom").classList.remove("glow-active");
}


// ==========================================================
// 4. 指を離した時の後始末と保存
// ==========================================================

function clearAllDraggingStates(){

    let needSave = false;

    if(draggingRow && placeholder && placeholder.parentNode){
        placeholder.parentNode.insertBefore(draggingRow,placeholder);
        needSave = true;
    }

    if(placeholder && placeholder.parentNode){
        placeholder.parentNode.removeChild(placeholder);
    }

    menuListEl.querySelectorAll(".music-row").forEach(function(row){
        row.classList.remove("dragging");
        row.style.position = "";
        row.style.width = "";
        row.style.height = "";
        row.style.left = "";
        row.style.top = "";
    });

    menuListEl.querySelectorAll(".sort-handle").forEach(function(h){
        h.classList.remove("active-blue");
    });

    draggingRow = null;
    autoScrollActive = false;
    stopAutoScrollGlow();

    if(needSave){
        saveNewOrderFromDOM();
    }

}

/*
指を離した時、実際のDOMの並び順を読み取って
playlistsストアへ保存します。

現行スキーマ(docs/db-schema.md)に合わせ、
track_id_list という配列名で保存します。
(OFSの元の実装はfile_path_listでしたが、
 track_idを主キーとする現行スキーマに合わせて変更しています)
*/
async function saveNewOrderFromDOM(){

    /*
    順番を書き換える前に、今の曲順を「一つ前」として覚えます(v85)。

    ドラッグ中に指が滑って曲順が変わってしまった時、右上の ↩ ボタンで
    元に戻せるようにするためのものです。竹弘曰く、この機能の一番の
    出番がまさにここ(並び替えの誤操作)とのこと。

    必ず currentOrderList を書き換える前に呼ぶこと。後だと、
    すでに変わってしまった順番を覚えることになってしまいます。
    */
    savePreviousOrder();

    const rows = Array.prototype.slice.call(
        menuListEl.querySelectorAll(".music-row")
    );

    currentOrderList = rows.map(function(row){
        return row.dataset.trackId;
    });

    /*
    保存は js/undo.js の共通処理に任せます(v85)。
    一つ前の曲順も一緒に保存する必要があり、並び替えメニューからの
    保存とも同じ内容になるため、1箇所にまとめてあります。
    */
    await savePlaylistOrder();

    console.log("並び順を保存しました :",currentOrderList.length,"曲");

}

/*
指が並び替えボタンの外で離れた場合や、着信などで操作が
中断された場合にも、必ず後始末が走るようにしておきます。
(これが無いと、行が浮いたまま画面に残ってしまいます)
*/
window.addEventListener("pointerup",clearAllDraggingStates);
window.addEventListener("pointercancel",clearAllDraggingStates);
