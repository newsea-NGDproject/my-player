/*
======================================================================
 undo.js ── 曲順を一つ前に戻す(Undo)

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の右上にある ↩ ボタンの担当です。
 曲順を変える直前の状態を1つだけ覚えておき、押すと元に戻します。

 竹弘の狙い:
     「並び替え誤操作による1回戻しが重要。ソートの戻しはおまけ程度」

 つまり主な出番は、ドラッグ中に指が滑って曲順が変わってしまった時です。
 慌てて手で戻さなくても、↩ を1回押せば元通りになります。

----------------------------------------------------------------------

【1回しか戻せない作りにしている理由】

 竹弘の指示で「2つ前以上は戻せない」仕様です。戻した後はボタンが
 薄くなって押せなくなり、次に曲順を変えるまで復活しません。

 何度も行き来できる作りにもできますが、「戻す」という操作の意味が
 ぼやけます。誤操作を取り消すための機能なので、1回で完結する方が
 分かりやすいという竹弘の判断です。

----------------------------------------------------------------------

【アプリを閉じても戻せます】

 一つ前の曲順は、画面上の記憶だけでなく playlists ストアの
 previous_track_id_list にも保存します。うっかり並び替えたまま
 アプリを閉じてしまっても、次に開いた時にまだ戻せます。

----------------------------------------------------------------------

【他のファイルとの関係】

   savePreviousOrder() … 曲順を変える「直前」に呼んでもらう
                         → js/sort.js(並び替えメニュー)
                         → js/drag-sort.js(ドラッグ並び替え)
   savePlaylistOrder() … 曲順をDBへ保存する共通処理。上の2つからも使う
   loadPreviousOrder() … 起動時に前回の状態を読み戻す → js/main.js
======================================================================
*/


/*
一つ前の曲順(track_idの配列)です。

null は「戻せる状態が無い」ことを表します。起動直後や、
一度戻した後がこれにあたります。
*/
let previousOrderList = null;


// ==========================================================
// 1. 曲順を変える直前に呼ぶ
// ==========================================================
/**
 * 今の曲順を「一つ前」として覚えます。
 *
 * 並び替えを実行する **前** に呼んでください。実行した後だと、
 * すでに変わってしまった順番を覚えることになってしまいます。
 */
function savePreviousOrder(){

    /*
    slice() は配列の複製を作る命令です。

    複製せずにそのまま代入すると、previousOrderList と
    currentOrderList が「同じ1つの配列」を指した状態になり、
    並び替えた瞬間に control側も一緒に書き換わってしまいます。
    それでは戻す先が無くなってしまうため、必ず複製します。
    */
    previousOrderList = currentOrderList.slice();

    updateUndoButton();

}


// ==========================================================
// 2. 戻す
// ==========================================================
/**
 * 曲順を一つ前の状態へ戻します。↩ ボタンから呼ばれます。
 */
async function undoOrder(){

    if(!previousOrderList){ return; }

    // 覚えていた順番に入れ替えます
    currentOrderList = previousOrderList.slice();

    /*
    戻せるのは1回だけなので、ここで忘れます。
    ボタンは薄くなり、次に曲順を変えるまで押せなくなります。
    */
    previousOrderList = null;

    // 画面を作り直します
    renderList();

    await savePlaylistOrder();

    updateUndoButton();

    console.log("曲順を一つ前に戻しました");

}


// ==========================================================
// 3. DBへの保存と読み込み
// ==========================================================
/**
 * 今の曲順と、一つ前の曲順を playlists ストアへ保存します。
 *
 * 並び替えメニュー(sort.js)とドラッグ並び替え(drag-sort.js)の
 * 両方から呼ばれる共通処理です。同じ内容を2箇所に書くと、
 * 片方だけ直して食い違う事故が起きるためまとめています。
 */
async function savePlaylistOrder(){

    try{

        const playlistData = {

            playlist_id: MAIN_MENU_PLAYLIST_ID,
            playlist_name: "メイン全曲リスト",

            track_id_list: currentOrderList,

            /*
            一つ前の曲順。戻せる状態が無い時は null が入ります。
            (docs/db-schema.md 参照)
            */
            previous_track_id_list: previousOrderList,

            norirun_track_id_list: []

        };

        await idbPut(STORE_PLAYLISTS,playlistData);

    }
    catch(error){

        console.error(
            "曲順の保存に失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 起動時に、前回の「一つ前の曲順」を読み戻します。
 *
 * これがあるおかげで、うっかり並び替えたままアプリを閉じても
 * 次に開いた時にまだ戻せます。
 */
async function loadPreviousOrder(){

    try{

        const playlistData = await idbGet(STORE_PLAYLISTS,MAIN_MENU_PLAYLIST_ID);

        if(playlistData &&
           playlistData.previous_track_id_list &&
           playlistData.previous_track_id_list.length > 0){

            previousOrderList = playlistData.previous_track_id_list;

            console.log("一つ前の曲順があります(↩で戻せます)");

        }
        else{

            previousOrderList = null;

        }

    }
    catch(error){

        console.error("一つ前の曲順の読み込みに失敗 :",error.name,error.message);

        previousOrderList = null;

    }

    updateUndoButton();

}


// ==========================================================
// 4. ボタンの見た目
// ==========================================================
/**
 * 戻せる状態かどうかで、↩ ボタンの見た目を切り替えます。
 *
 * disabled は「押せなくする」HTMLの標準の仕組みです。
 * 見た目もCSS(.round-btn:disabled)で薄くしています。
 * 押せないボタンを隠さず薄く残しているのは、ボタンの位置が
 * 変わらず、竹弘が場所を覚えやすいためです。
 */
function updateUndoButton(){

    const button = document.getElementById("undo-btn");

    if(!button){ return; }

    button.disabled = !previousOrderList;

}


// ==========================================================
// 5. ボタンの結び付け
// ==========================================================

(function bindUndoButton(){

    const button = document.getElementById("undo-btn");

    if(!button){ return; }

    button.addEventListener("click",function(){
        undoOrder();
    });

    // 起動直後は戻せる状態が無いので、押せない状態にしておきます
    button.disabled = true;

})();
