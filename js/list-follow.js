/*
======================================================================
 list-follow.js ── 曲一覧を「今の曲」へ動かす係(v255)

----------------------------------------------------------------------

【このファイルの役割】

 何曲も聴いていると、今鳴っている曲が曲一覧のどこにいるのか
 分からなくなります(竹弘の要望 2026-10-25)。そこで3つの場面で、
 今の曲の行を見える所へ動かします。

   ① 曲が変わった時(手で選んだ・⏭・接続で次の曲へ)
        followPlayingRow()      … js/list-view.js の markPlayingRow() が呼ぶ
        → 一覧を10秒触っていなければ、今の曲を上から2段目へ。
          もう見えていれば動かさない

   ② 🐇ジャンプの右上「🎵 今の曲へ」
        jumpToPlayingRow()      … js/jump.js の jumpTo("now") が呼ぶ
        → いつでも、今の曲を上から2段目へ(一気に)

   ③ ノリRun ⇔ ノリノリRun の切り替え
        showPlayingRowInList()  … js/norirun.js の refreshNoriRunList() が呼ぶ
        → 今の曲が新しい一覧にあれば2段目へ。無ければ今までどおり先頭

 再生中の行の色(枠の色。v185)は今までどおり js/list-view.js が付けます。
 竹弘:「とても気に入ってます」。このファイルは「動かす」ことだけをします。

----------------------------------------------------------------------

【なぜ「上から2段目」なのか】

 1段目に置くと、1つ前の曲が見えません。2段目なら「さっきの曲 → 今の曲 →
 次の曲」が並んで見え、流れの中のどこにいるかが分かります。
 ⚠️ ①(ジャケの特大表示)を作り直す時、竹弘はこの「2段目」を前提に
    「特大表示の文字は1段目まで被ってよい」と決めた(2026-10-25)。
    ここを変える時は、特大表示の置き場所も一緒に見直すこと。

----------------------------------------------------------------------

【なぜ「10秒触っていなければ」なのか】

 竹弘が一覧をスクロールして曲を探している最中に、曲が変わったからと
 勝手に動かされたら困ります。ふつうの音楽プレイヤーと同じく、
 **触っていない時だけ**付いていきます。

 「触った」に数えるもの:一覧を指で触る(スクロール・行のボタン・並び替えの
 つまみ)/ 並び替えのメニュー / 🐇で飛んだ時。
 ⚠️ ⏮ ⏭ は数えません(見出しの段にあって一覧の中ではない)。⏭ で次へ
    進んだ時こそ、一覧が付いてきてほしいからです。

----------------------------------------------------------------------

【⚠️ 音を最優先にする(のりの判断 2026-10-25)】

 一覧を動かすと、画面の描き直しが起きます。🕺ノリノリRunでは、曲が
 変わる瞬間 = **接続で2曲が重なっている最中**です(js/connect.js の
 refreshAfterConnect が showNowPlaying を呼ぶ)。そこに描き直しを重ねると、
 弱い端末(XPERIA)で音がヨレるもとになりえます(CLAUDE.md の見張り項目
 「クロスフェード中のヨレ」)。そこで:

   ・曲が変わってから2秒待つ(鳴り出しの大事な瞬間を避ける)
   ・裏のデッキが鳴っている間(接続の重なり)と、同期スタートの準備中は、
     終わるまで待つ(1秒ごとに見直す。30秒たっても終わらなければやめる)

 メインメニュー(デッキ1枚)では裏のデッキは鳴らないので、2秒後に動きます。

----------------------------------------------------------------------

【読み込み順】

 js/search.js の後・js/norirun.js の前に読み込みます。ただし、ほかの
 ファイルの関数を使うのは**関数の中からだけ**です(読み込んだその場で
 使うのは、config.js の menuListEl と HTML の部品だけ)。
 ⚠️ 名前はすべて list / listFollow で始めています。search.js の appEl の
    ような短い名前を const で作ると、名前がぶつかって読み込んだ瞬間に
    エラーになり、このファイルが丸ごと動かなくなるためです。

 経緯 → devlog/画面とその他.md(v255)
======================================================================
*/


// ==========================================================
// 1. 決めごと
// ==========================================================

// 一覧を最後に触ってから、これだけたっていれば付いていきます(竹弘の指定)
const LIST_FOLLOW_IDLE_MS = 10000;

// 曲が変わってから、動かし始めるまで待つ時間(鳴り出しの瞬間を避ける)
const LIST_FOLLOW_DELAY_MS = 2000;

// 接続の重なりなどで待つ時、何ミリ秒ごとに見直すか
const LIST_FOLLOW_RETRY_MS = 1000;

// 待つのはここまで。これを過ぎても終わらなければ、その曲では動かしません
const LIST_FOLLOW_WAIT_LIMIT_MS = 30000;

/*
なめらかに動かすのは、近い時だけにします(見えている高さの2つ分まで)。

遠い所(ランダム再生で何十曲も先へ飛んだ時など)までなめらかに流すと、
何百行も描きながら流れていくので重く、時間もかかります。🐇の
「一番上へ」などが一気に飛ぶ(js/jump.js)のと同じ考え方です。
*/
const LIST_FOLLOW_SMOOTH_SCREENS = 2;


// ==========================================================
// 2. 状態
// ==========================================================

/*
一覧を最後に触った時刻です(Date.now() のミリ秒)。

⚠️ performance.now() ではなく Date.now() を使います。画面を消して深く
   眠ると performance.now() が止まる端末があり(CLAUDE.md「Chrome・Android
   の決まり」8)、「10秒たったか」を数え損なうためです。Date.now() は電波で
   数秒合わせ直されることがありますが、10秒の目安には影響しません。

最初は「ずっと昔に触った」扱い(-Infinity)なので、起動して最初の曲から
付いていきます。
*/
let listTouchedAtMs = -Infinity;

// 曲が変わった後、動かすのを待っている曲(待っていなければ null)
let listFollowTrackId = null;

// 待ち始めた時刻(Date.now)。LIST_FOLLOW_WAIT_LIMIT_MS を数えるのに使います
let listFollowSinceMs = 0;

// 待っているタイマー(setTimeout の番号。待っていなければ 0)
let listFollowTimerId = 0;


// ==========================================================
// 3. 「触った」を覚える
// ==========================================================

/**
 * 一覧を触ったことを覚えます。
 *
 * js/jump.js(🐇で飛んだ時)からも呼ばれます。
 */
function noteListTouched(){

    listTouchedAtMs = Date.now();

}

/*
一覧に指が触れた瞬間を受け取ります。

【capture:true にしている理由】
並び替えのつまみ(js/drag-sort.js)などは、指の知らせを自分のところで
止める(stopPropagation)ことがあります。ふつうの受け取り方だと、止められた
知らせはここまで届きません。capture は「行に届く**前に**、外側の一覧が先に
受け取る」指定なので、中で止められても確実に数えられます。

【passive:true にしている理由】
「この受け口はスクロールを止めない」とブラウザに約束する指定です。
約束しておくと、ブラウザは受け口の終わりを待たずにスクロールを始められる
ので、一覧の動きが重くなりません(ここでは時刻を覚えるだけなので約束できる)。
*/
menuListEl.addEventListener("pointerdown",noteListTouched,{capture:true,passive:true});

// パソコンのマウスホイールで動かした時も「触った」に数えます
menuListEl.addEventListener("wheel",noteListTouched,{capture:true,passive:true});

/*
並び替えのメニュー(⇅ を押すと開く)も数えます。並び替えると一覧は先頭へ
戻る(js/sort.js)ので、その直後に曲が変わって動かされると、並べた結果を
見ている途中で飛ばされてしまうためです。
*/
const listFollowSortMenuEl = document.getElementById("sort-menu");

if(listFollowSortMenuEl){

    listFollowSortMenuEl.addEventListener("pointerdown",noteListTouched,{capture:true,passive:true});

}


// ==========================================================
// 4. 行を探す・見えているか調べる・動かす
// ==========================================================

/**
 * その曲の行を探します。
 *
 * ⚠️ track_id を querySelector の文字に埋め込まず、全行を見て探します
 *    (js/list-view.js の refreshRow と同じ理由。記号が入っていても壊れない)。
 *
 * @return {Element|null} 行。一覧に無い時は null
 */
function findListRowForTrack(trackId){

    if(!trackId){ return null; }

    const rows = menuListEl.querySelectorAll(".music-row");

    for(const row of rows){

        if(row.dataset.trackId === trackId){ return row; }

    }

    return null;

}

/**
 * 検索で隠れている行かどうか(js/search.js が .search-hidden を付けます)。
 */
function isListRowHidden(row){

    return row.classList.contains("search-hidden");

}

/**
 * 行が、一覧の見えている所に**全部**入っているかを調べます。
 *
 * 【offsetTop で調べる理由】
 * 曲一覧(.music-list)は position:relative なので、行の offsetTop は
 * 「一覧の中身のいちばん上から何px下か」になり、スクロールしても変わりません。
 * スクロール量(scrollTop)と比べるだけで済み、画面の座標を測り直す
 * (getBoundingClientRect)より軽く、測り違いもありません。
 */
function isListRowFullyVisible(row){

    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;

    const viewTop = menuListEl.scrollTop;
    const viewBottom = viewTop + menuListEl.clientHeight;

    // 0.5px は、小数の丸めで「1px足りない」と判定されないための遊びです
    return top >= viewTop - 0.5 && bottom <= viewBottom + 0.5;

}

/**
 * 行が「上から2段目」に来るように一覧を動かします。
 *
 * 1つ前の行(検索で隠れている行は飛ばす)が1段目にぴったり来る位置
 * = その行の offsetTop までスクロールします。一覧のいちばん上と同じ
 * 並び方になるので、見た目が揃います。1つ前の行が無い(先頭の曲)なら
 * いちばん上へ。
 *
 * @param {Element} row       … 動かしたい行
 * @param {boolean} smoothOk  … 近ければなめらかに動かしてよいか
 *                              (🐇・モードの切り替えは false = いつも一気に)
 * @return {string} "なめらかに" か "一気に"(ログに出すため)
 */
function scrollListRowToSecond(row,smoothOk){

    let prev = row.previousElementSibling;

    while(prev && (!prev.classList.contains("music-row") || isListRowHidden(prev))){

        prev = prev.previousElementSibling;

    }

    const scrollMax = Math.max(menuListEl.scrollHeight - menuListEl.clientHeight,0);

    // 一番下の方の曲は、それ以上スクロールできないので一番下で止まります
    const target = Math.min(prev ? prev.offsetTop : 0,scrollMax);

    const distance = Math.abs(target - menuListEl.scrollTop);

    if(smoothOk && distance <= menuListEl.clientHeight * LIST_FOLLOW_SMOOTH_SCREENS){

        /*
        behavior:"smooth" は、ブラウザに「なめらかに流して」と頼む指定です。
        流している途中で竹弘が指で触れば、ブラウザが自分で止めます。
        */
        menuListEl.scrollTo({top:target,behavior:"smooth"});

        return "なめらかに";

    }

    menuListEl.scrollTop = target;

    return "一気に";

}


// ==========================================================
// 5. ① 曲が変わった時に付いていく
// ==========================================================

/**
 * 曲が変わった時に呼ばれます(js/list-view.js の markPlayingRow)。
 *
 * すぐには動かさず、2秒待ってから下の tryFollowPlayingRow() で確かめます
 * (上の【⚠️ 音を最優先にする】)。続けて曲が変わったら、前の待ちは捨てて
 * 新しい曲で待ち直します。
 */
function followPlayingRow(trackId){

    if(listFollowTimerId){ clearTimeout(listFollowTimerId); }

    listFollowTrackId = trackId;
    listFollowSinceMs = Date.now();

    listFollowTimerId = setTimeout(tryFollowPlayingRow,LIST_FOLLOW_DELAY_MS);

}

/**
 * 今、音の大事な場面の最中か(一覧を動かすのを待つべきか)を返します。
 *
 *   裏のデッキが鳴っている … 接続で2曲が重なっている(または助走中)
 *   同期スタートの準備中   … みんなで走る同期モードの、鳴らし始める直前
 *
 * ⚠️ どちらの関数も、無い時(読み込みに失敗した時など)は「待たない」扱いに
 *    します(typeof で確かめてから使う)。ここでエラーになると、曲一覧の
 *    印の付け替え(markPlayingRow)まで止まってしまうためです。
 */
function isListFollowWaitingForSound(){

    if(typeof getIdleDeck === "function"){

        const idleDeck = getIdleDeck();

        if(idleDeck && !idleDeck.paused){ return true; }

    }

    if(typeof isSyncWarmingUp === "function" && isSyncWarmingUp()){ return true; }

    return false;

}

/**
 * 今は一覧を動かしてはいけない場面かを返します(待たずに、やめる)。
 *
 *   検索モードの間       … 竹弘が探している最中(js/search.js)
 *   並び替えで掴んでいる … 動かすと掴んだ行と指がずれる(js/drag-sort.js)
 *   🐇のメニューを開いている / 並び替えのメニューを開いている
 *   一覧が隠れている     … ノリ注入やマイピッチ設定の間(#app ごと隠れる)
 */
function isListFollowBlocked(){

    const appBox = document.getElementById("app");

    if(appBox && appBox.classList.contains("search-mode")){ return true; }

    if(typeof draggingRow !== "undefined" && draggingRow){ return true; }

    if(typeof jumpOptions !== "undefined" && jumpOptions.length > 0){ return true; }

    if(listFollowSortMenuEl && listFollowSortMenuEl.style.display !== "none"){ return true; }

    if(menuListEl.clientHeight === 0){ return true; }

    return false;

}

/**
 * 待ちが明けた時に、本当に動かすかを決めて動かします。
 */
function tryFollowPlayingRow(){

    listFollowTimerId = 0;

    const trackId = listFollowTrackId;

    // 待っている間に別の曲へ変わっていたら、何もしません(その曲の待ちが動きます)
    if(!trackId || trackId !== currentTrackId){ return; }

    // 音の大事な場面の最中なら、終わるまで待ちます(待つのは30秒まで)
    if(isListFollowWaitingForSound()){

        if(Date.now() - listFollowSinceMs < LIST_FOLLOW_WAIT_LIMIT_MS){

            listFollowTimerId = setTimeout(tryFollowPlayingRow,LIST_FOLLOW_RETRY_MS);

        }

        return;

    }

    listFollowTrackId = null;

    // 一覧を触ってから10秒たっていなければ、竹弘が見ている所をそのままにします
    if(Date.now() - listTouchedAtMs < LIST_FOLLOW_IDLE_MS){ return; }

    if(isListFollowBlocked()){ return; }

    const row = findListRowForTrack(trackId);

    /*
    一覧に無い曲(🕺ノリノリRunにメインメニューの未注入の曲を持ち込んだ時など)・
    検索で隠れている曲は動かしません。
    */
    if(!row || isListRowHidden(row)){ return; }

    // もう全部見えているなら、動かしません(竹弘の指定)
    if(isListRowFullyVisible(row)){ return; }

    const how = scrollListRowToSecond(row,true);

    /*
    動かした時だけ1行出します。「曲が変わってから何秒待ったか」が分かるので、
    接続の重なりが終わるまで待てているか(2秒より長くなる)を🐛で確かめられます。
    */
    console.log(
        "曲一覧を今の曲へ動かしました : 曲が変わってから " +
        ((Date.now() - listFollowSinceMs) / 1000).toFixed(1) + "秒後 / " + how
    );

}


// ==========================================================
// 6. ② 🐇の「🎵 今の曲へ」
// ==========================================================

/**
 * 今の曲の行を、上から2段目へ一気に動かします(js/jump.js の jumpTo("now"))。
 *
 * 見えていても2段目へ揃えます(自分で押したので、いつも同じ所に来る方が
 * 分かりやすい)。一覧に無い時は、お知らせを出すだけです。
 *
 * お知らせは js/tap.js の showTapToast() を借ります(js/norirun.js と同じ)。
 */
function jumpToPlayingRow(){

    noteListTouched();

    const row = findListRowForTrack(currentTrackId);

    let message = "";

    if(!currentTrackId){ message = "まだ曲を選んでいません"; }
    else if(!row){ message = "今の曲はこの一覧にありません"; }
    else if(isListRowHidden(row)){ message = "今の曲は検索で隠れています"; }

    if(message){

        if(typeof showTapToast === "function"){ showTapToast(message); }

        console.log("曲一覧をジャンプしました : 今の曲へ(" + message + ")");

        return;

    }

    scrollListRowToSecond(row,false);

    console.log("曲一覧をジャンプしました : 今の曲へ");

}


// ==========================================================
// 7. ③ ノリRun ⇔ ノリノリRun の切り替え
// ==========================================================

/**
 * 一覧を作り直した直後に、今の曲の行を上から2段目へ一気に動かします。
 *
 * js/norirun.js の refreshNoriRunList() が呼びます。
 *
 * @return {boolean} 動かせたら true。今の曲が新しい一覧に無ければ false
 *                   (その時は呼んだ側が、今までどおり先頭へ戻します。v101)
 */
function showPlayingRowInList(){

    const row = findListRowForTrack(currentTrackId);

    if(!row || isListRowHidden(row)){ return false; }

    scrollListRowToSecond(row,false);

    return true;

}
