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
==========================================================
 ドラッグ中だけ使う「覚え書き」(v115で追加)
==========================================================

竹弘の指摘:
    「ドラッグ並び替えで曲を持ってスクロールする時、
      一挙にスピードが落ちる感覚です」

【なぜ遅かったのか】

指を動かしている間、着地位置を決める処理が **1秒間に60回** 走ります。
その1回ごとに、v114まではこれだけの作業をしていました。

    ① 368行ぶんの一覧を作り直す      (querySelectorAll)
    ② 368行を全部見て除外曲を探す    (find)
    ③ 368行を全部見て候補を選び直す  (filter)
    ④ 上から順に位置を測る           (getBoundingClientRect 最大368回)

**②③はv110の除外機能で私が足したものです。** 毎回やり直す必要が
無いのに毎フレーム走らせていたので、ここは反省点でした。

そして④が一番重い作業です。getBoundingClientRect は「今この要素が
画面のどこにあるか」を測る命令ですが、**ブラウザは正確に答えるため、
その場でレイアウトを計算し直します。** これを毎フレーム数百回
呼んでいました。

【v114の軽量化と、ここが噛み合っていなかった】

v114で入れた content-visibility は「画面の外の行は計算しない」という
指定です。ところが getBoundingClientRect で位置を尋ねると、
**省略していたはずの計算をその場でやり直させてしまいます。**

通常のスクロールが速くなったのに、ドラッグ中だけ遅いまま残った
理由がこれです。竹弘が感じた落差は、気のせいではありませんでした。

【この覚え書きが何を解決するか】

①②③は、掴んでいる間ずっと同じ結果になります(ドラッグの最中に
曲が増えたり、除外されたりはしないため)。そこで **掴んだ瞬間に
1回だけ調べて、ここに覚えておきます。**

これだけで、毎フレーム736回の見直しが0回になります。
*/

// 着地先になれる行(除外曲を除いた通常の行)
let dragCandidates = [];

// 一番上にある除外曲の行(通常曲はこれより下へ置けない)
let dragFirstExcludedRow = null;

// あと何pxスクロールできるか(掴んでいる間は変わりません)
let dragScrollMax = 0;

/*
上下の光る帯です。

毎フレーム document.getElementById で探し直していたものを、
最初に1回だけ取得して使い回します。このファイルは c014.html の
末尾で読み込まれるため、ここで取得できます。
*/
const glowTopEl = document.getElementById("glow-top");
const glowBottomEl = document.getElementById("glow-bottom");

/*
今どちらの帯が光っているかを覚えておきます。

光らせ方を変える必要がない時にまで classList を触ると、そのたびに
ブラウザが見た目を計算し直します。「変わった時だけ触る」ために
今の状態を持っておきます。
*/
let glowState = "";

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

        /*
        着地先の候補を、ここで1回だけ調べて覚えます(v115)。

        必ず row に "dragging" を付けた後で呼ぶこと。掴んでいる行を
        候補から外す判定(:not(.dragging))が、このクラスを見ている
        ためです。
        */
        cacheDragTargets();

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

/**
 * 着地先の候補を1回だけ調べて覚えます(v115)。
 *
 * 掴んだ瞬間(pointerdown)に呼ばれます。
 *
 * 【除外曲より下へ着地させないための下ごしらえ】
 *
 * 除外曲そのものは list-view.js でドラッグを受け付けないので、
 * 指で持ち上げることはできません。しかしそれだけだと、
 * **普通の曲を除外曲より下へ運べてしまいます。**
 * それを許すと「除外曲は常に一番下」という約束が破れるため、
 * 着地先(placeholder=差し込みスロット)の側にも歯止めが要ります。
 *
 *   ① 着地先を探す時、除外行は候補から外す
 *   ② 通常曲の中に着地先が無い(＝一番下まで運ばれた)時は、
 *      一覧の末尾ではなく「最初の除外行の直前」へ差し込む
 *
 * v110ではこれを毎フレームやり直していましたが、掴んでいる間に
 * 結果が変わることはないので、ここで1回だけ調べます。
 * ついでに、2回に分けていた全行の見直し(find と filter)も
 * 1回のくり返しにまとめました。
 */
function cacheDragTargets(){

    const siblings = menuListEl.querySelectorAll(".music-row:not(.dragging)");

    dragCandidates = [];
    dragFirstExcludedRow = null;

    for(const sibling of siblings){

        if(sibling.classList.contains("excluded")){

            // 一番上の除外行だけ覚えておけば十分です
            if(!dragFirstExcludedRow){
                dragFirstExcludedRow = sibling;
            }

        }
        else{
            dragCandidates.push(sibling);
        }

    }

    /*
    あと何pxスクロールできるかも、ここで測っておきます。

    scrollHeight(中身全体の高さ)を読むと、ブラウザはその場で
    レイアウトを計算し直します。掴んでいる間は行数が変わらないので
    値も変わりません。毎フレーム測り直す意味がありませんでした。
    */
    dragScrollMax = menuListEl.scrollHeight - menuListEl.clientHeight;

}

function updatePlaceholderPosition(clientY){

    if(!draggingRow || !placeholder){ return; }

    /*
    ==========================================================
     着地位置を「二分探索」で探します(v115)
    ==========================================================

    【v114までのやり方と、その問題】

    上の行から順に位置を測っていき、指より下にある最初の行を
    探していました。素直な方法ですが、**一覧の下の方へ運ぶほど
    測る回数が増えます。** 369曲の一番下だと、指を1回動かすたびに
    368回も位置を測ることになっていました。

    しかも位置を測る命令(getBoundingClientRect)は、ブラウザに
    レイアウトの計算をやり直させます。v114で「画面の外は計算しない」
    ようにしたのに、この命令がその省略を打ち消してしまうため、
    通常のスクロールだけが速くなり、ドラッグ中は遅いまま残りました。

    【二分探索とは】

    辞書で単語を引く時、1ページ目からめくらずに、真ん中を開いて
    「もっと後ろだ」と見当をつけますよね。あれと同じです。

        1. 候補のちょうど真ん中の行の位置を測る
        2. 指がそれより上なら、下半分は見なくてよい
           指がそれより下なら、上半分は見なくてよい
        3. 残った半分について、また同じことをくり返す

    一度調べるたびに候補が半分に減るので、**368行でも9回ほど**で
    答えにたどり着きます。368回が9回になる、という計算です。

    【なぜこれが正しく動くのか】

    行は必ず上から下へ順番に並んでいます(位置が飛び飛びになったり
    順序が入れ替わったりしない)。この「並んでいる」性質があるから、
    半分を見ずに切り捨てられます。曲一覧はまさにこの形です。

    lo(下限)と hi(上限)で「まだ調べていない範囲」を表し、
    その範囲が無くなるまでくり返します。
    */
    let lo = 0;
    let hi = dragCandidates.length - 1;
    let nextSibling = null;

    while(lo <= hi){

        // 真ん中の位置。>> 1 は「2で割って小数を捨てる」という書き方です
        const mid = (lo + hi) >> 1;

        const box = dragCandidates[mid].getBoundingClientRect();

        if(clientY <= box.top + box.height / 2){

            /*
            指がこの行の上半分より上にある = ここが着地先になりうる。
            ただし、もっと上に条件を満たす行があるかもしれないので、
            いったん覚えておいて、上半分を探し続けます。
            */
            nextSibling = dragCandidates[mid];
            hi = mid - 1;

        }
        else{

            // 指はもっと下。この行より上は見なくてよい
            lo = mid + 1;

        }

    }

    /*
    差し込む先が今と同じなら、何もしません(v115)。

    同じ場所へ insertBefore を呼び直しても結果は変わりませんが、
    ブラウザは「一覧を書き換えた」と受け取って見た目を計算し直します。
    指を少し動かしただけで着地先が変わらないことは多いので、
    ここで止めるだけでも無駄な作業がかなり減ります。
    */
    if(nextSibling){

        if(placeholder.nextSibling !== nextSibling){
            menuListEl.insertBefore(placeholder,nextSibling);
        }

    }
    else if(dragFirstExcludedRow){

        // 通常曲の一番後ろ = 最初の除外行のすぐ手前
        if(placeholder.nextSibling !== dragFirstExcludedRow){
            menuListEl.insertBefore(placeholder,dragFirstExcludedRow);
        }

    }
    else{

        if(menuListEl.lastElementChild !== placeholder){
            menuListEl.appendChild(placeholder);
        }

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

    /*
    このエリアが「あと何pxスクロールできるか」の上限値です。

    v114までは、ここで毎回 scrollHeight(中身全体の高さ)を読んで
    いました。この関数は指が動くたびに呼ばれるので、1秒間に何十回も
    ブラウザにレイアウトの計算をやり直させていたことになります。

    掴んでいる間は行数が変わらず、値も変わらないので、掴んだ瞬間に
    測っておいたものを使います(v115)。
    */
    const scrollMax = dragScrollMax;

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

        /*
        エリアの位置だけは毎回測り直します。アドレスバーの伸縮などで
        画面内の位置が動くことがあるためです(1回だけなので軽い作業です)。

        残りスクロール量は、掴んだ時に測ったものを使い回します(v115)。
        光る帯も、毎回 getElementById で探し直すのをやめました。
        */
        const rect = menuListEl.getBoundingClientRect();
        const currentScrollMax = dragScrollMax;

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
            setGlow("top");
        }
        else if(currentClientY > rect.bottom - AUTO_SCROLL_ZONE &&
                menuListEl.scrollTop < currentScrollMax){

            const ratio = (currentClientY - (rect.bottom - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE;
            speed = Math.ceil(Math.min(ratio,1) * AUTO_SCROLL_MAX_SPEED);
            setGlow("bottom");
        }
        else{
            setGlow("");
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

/**
 * 上下の光る帯を切り替えます(v115)。
 *
 * @param {string} nextState - "top" / "bottom" / ""(消す)
 *
 * 【なぜ関数にしたのか】
 *
 * v114までは、ループの毎回いったん両方の光を消してから、必要な方を
 * 光らせ直していました。見た目は正しく動きますが、**光り方が
 * 変わらない時にも毎フレーム指示を出していた**ことになります。
 * クラスを付け外しするたび、ブラウザは見た目を計算し直します。
 *
 * そこで今どちらが光っているかを覚えておき、**変わった時だけ**
 * 触るようにしました。指を端に置き続けている間(まさに自動スクロールが
 * 走っている間)は、一度光らせたらそのまま何もしません。
 */
function setGlow(nextState){

    if(glowState === nextState){ return; }

    glowTopEl.classList.toggle("glow-active",nextState === "top");
    glowBottomEl.classList.toggle("glow-active",nextState === "bottom");

    glowState = nextState;

}

function stopAutoScrollGlow(){
    setGlow("");
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

    /*
    掴んでいる間だけ使っていた覚え書きを片付けます(v115)。

    次に掴んだ時は cacheDragTargets() が作り直すので、ここで
    空にしておいて構いません。369行ぶんの参照を抱えたままに
    しないための後始末です。
    */
    dragCandidates = [];
    dragFirstExcludedRow = null;

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
