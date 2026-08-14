/*
======================================================================
 sort.js ── 曲一覧の並び替え

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の見出し横にある ⇅ ボタンを押すとメニューが開き、
 5つの並び順から選べます。

   🕺 ノリ注入順     … 最近ノリを注入した曲を上に
   🆕 登録日時順     … 最近登録した曲を上に
   🔤 タイトル順     … 曲名のあいうえお順
   🎤 アーティスト順 … アーティスト名のあいうえお順
   ⏱ 曲の長さ順     … 短い曲から順に

 同じ項目をもう一度選ぶと、昇順と降順が入れ替わります。
 今どの順番で並んでいるかは、メニューの中に ▲▼ で表示されます。

----------------------------------------------------------------------

【なぜ <select> ではなく自作のメニューなのか】

 ブラウザには <select>(ピッカー)という選択用の部品がありますが、
 使うと端末ごとに見た目が変わり、記号を丸で囲んだり ▲▼ を
 添えたりといった装飾ができません。

 竹弘が時間をかけて作り込んだ画面の world観を保つため、
 HTMLとCSSで自分で組んでいます(竹弘との相談で決定)。

----------------------------------------------------------------------

【並び替えた結果はどこへ行くのか】

 並び替えると、曲順そのもの(currentOrderList)が変わり、
 playlists ストアへ保存されます。つまりドラッグで手動並び替えした
 のと同じ扱いで、次にアプリを開いた時もその順番のままです。

 選んだ並び順の種類は settings の main_sort_order に保存します。
 このキーは c012 が初期設定の時に "registered_at_desc" という
 初期値を書き込んでおり、**最初からソート機能を見込んで用意されて
 いたもの**です。今回それをようやく使うことになりました。
======================================================================
*/


// ==========================================================
// 1. 並び順の定義
// ==========================================================
/*
並び順の一覧です。メニューの中身もここから作られるので、
項目を増やしたい時はこの配列に1行足すだけで済みます。

  key          … 並び替えに使う music_library のフィールド名
  icon         … メニューに出す記号
  label        … メニューに出す名前
  defaultOrder … その項目を初めて選んだ時の向き
                 ("desc"=大きい/新しい順、"asc"=小さい/古い順)

日付系を desc(新しい順)にしているのは、「さっき入れた曲を
すぐ見つけたい」という使い方になるためです。
名前や長さは asc(あいうえお順・短い順)が自然なのでそちらにしています。
*/
const SORT_DEFINITIONS = [
    { key:"nori_injected_at", icon:"🕺", label:"ノリ注入順",     defaultOrder:"desc" },
    { key:"registered_at",    icon:"🆕", label:"登録日時順",     defaultOrder:"desc" },
    { key:"title",            icon:"🔤", label:"タイトル順",     defaultOrder:"asc"  },
    { key:"artist",           icon:"🎤", label:"アーティスト順", defaultOrder:"asc"  },
    { key:"duration",         icon:"⏱", label:"曲の長さ順",     defaultOrder:"asc"  }
];

/*
今どの並び順で表示しているかを覚えておきます。

null は「並び替えを使っていない」状態です。ドラッグで手動並び替え
した後や、まだ一度も並び替えていない時がこれにあたります。
*/
let currentSortKey = null;
let currentSortOrder = "desc";


// ==========================================================
// 2. 2曲を比べる
// ==========================================================
/**
 * 2曲を比べて、どちらが前に来るかを返します。
 *
 * 【返す値の意味(JavaScriptの並び替えの決まり)】
 *   マイナス … aが前
 *   プラス   … bが前
 *   0        … 同じ
 */
function compareTracks(trackA,trackB,key){

    if(key === "nori_injected_at"){
        return compareByNori(trackA,trackB);
    }

    if(key === "title"){

        /*
        タイトルが無い曲はファイル名で比べます(竹弘の指示)。
        表示上もそうなっているので、見えている文字の通りに並びます。
        */
        const nameA = trackA.title || trackA.file_name || "";
        const nameB = trackB.title || trackB.file_name || "";

        return compareText(nameA,nameB);

    }

    if(key === "artist"){

        const artistA = trackA.artist || "";
        const artistB = trackB.artist || "";

        /*
        アーティスト名が取れていない曲は、後ろにまとめます。
        空欄の曲が先頭に固まると、目当ての曲を探しにくいためです。
        (昇順・降順を切り替えると、この固まりも上下が入れ替わります)
        */
        if(artistA === "" && artistB !== ""){ return 1; }
        if(artistA !== "" && artistB === ""){ return -1; }

        return compareText(artistA,artistB);

    }

    if(key === "duration"){
        return (trackA.duration || 0) - (trackB.duration || 0);
    }

    if(key === "registered_at"){
        return (trackA.registered_at || 0) - (trackB.registered_at || 0);
    }

    return 0;

}

/*
文字を並べ替えます。

localeCompare は「その国の言葉のルールで文字を比べる」標準の命令です。
"ja"(日本語)を指定すると、ひらがな・カタカナ・漢字が
日本語の辞書と同じ順番になります。

単純に a < b で比べると文字コード順になってしまい、
「あ」より「ア」が先に来るなど、竹弘が期待する並びになりません。
*/
function compareText(textA,textB){
    return textA.localeCompare(textB,"ja");
}

/*
ノリ注入順で2曲を比べます。

【3つのグループに分けて考えます】

    0 … ノリ注入済みで、注入日時が分かっている曲
    1 … ノリ注入済みだが、注入日時が分からない曲
    2 … まだノリを注入していない曲(🛌)

グループが違えば、この番号の順に並びます。
同じグループなら、注入日時の新しい順で並びます。

【なぜグループ1があるのか】
注入日時を記録し始めたのは v79 からです。それ以前に🕺にした曲には
日時が入っていません。日時を 0 として扱うと「一番古い曲」として
未注入の🛌と混ざってしまうため、あいだのグループを用意しました。
「注入はされているが、いつかは分からない」という位置づけです。
*/
function compareByNori(trackA,trackB){

    const groupA = getNoriGroup(trackA);
    const groupB = getNoriGroup(trackB);

    if(groupA !== groupB){
        return groupA - groupB;
    }

    // 同じグループ内は、注入日時の新しい順
    return (trackB.nori_injected_at || 0) - (trackA.nori_injected_at || 0);

}

function getNoriGroup(track){

    if(!track.is_analyzed){ return 2; }

    if(!track.nori_injected_at){ return 1; }

    return 0;

}


// ==========================================================
// 3. 並び替えを実行する
// ==========================================================
/**
 * 指定した並び順で曲一覧を並べ替え、画面とDBに反映します。
 */
async function applySort(key){

    /*
    同じ項目をもう一度選んだ時は、昇順と降順を入れ替えます。
    違う項目を選んだ時は、その項目の既定の向きから始めます。
    */
    if(currentSortKey === key){

        currentSortOrder = (currentSortOrder === "asc") ? "desc" : "asc";

    }
    else{

        currentSortKey = key;
        currentSortOrder = getDefaultOrder(key);

    }

    /*
    並べ替えます。

    sort() は配列を並べ替える標準の命令で、「2つを比べる関数」を
    渡すと、その判定に従って全体を並べ替えてくれます。

    currentOrderList に入っているのは track_id(番号)だけなので、
    libraryMap から曲データを取り出してから比べています。
    */
    currentOrderList.sort(function(idA,idB){

        const trackA = libraryMap[idA];
        const trackB = libraryMap[idB];

        if(!trackA || !trackB){ return 0; }

        const result = compareTracks(trackA,trackB,currentSortKey);

        // 降順の時は、比べた結果の符号を逆にするだけで反転できます
        return (currentSortOrder === "asc") ? result : -result;

    });

    console.log(
        "並び替えました :",
        getSortLabel(currentSortKey),
        currentSortOrder === "asc" ? "昇順" : "降順"
    );

    // 画面を作り直します
    renderList();

    // 曲順と、選んだ並び順を保存します
    await saveSortedOrder();

    // メニューの ▲▼ を更新して閉じます
    renderSortMenu();
    closeSortMenu();

}

/**
 * 並べ替えた曲順と、選んだ並び順をDBへ保存します。
 */
async function saveSortedOrder(){

    try{

        // 曲順(ドラッグで並び替えた時と同じ形で保存します)
        const playlistData = {
            playlist_id: MAIN_MENU_PLAYLIST_ID,
            playlist_name: "メイン全曲リスト",
            track_id_list: currentOrderList,
            norirun_track_id_list: []
        };

        await idbPut(STORE_PLAYLISTS,playlistData);

        /*
        選んだ並び順の種類も保存します。
        次にアプリを開いた時、メニューの▲▼を同じ状態で出すためです。

        settings ストアはキーを自分で指定する形なので、
        idbPut の3つ目の引数にキー名を渡しています。
        */
        await idbPut(
            STORE_SETTINGS,
            currentSortKey + "_" + currentSortOrder,
            "main_sort_order"
        );

    }
    catch(error){

        console.error(
            "並び順の保存に失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 保存してある並び順の種類を読み込み、メニューの表示に反映します。
 *
 * 曲順そのものは playlists に保存済みなので、ここで並べ替え直す
 * 必要はありません。読み込むのは「どの項目に▲▼を付けるか」だけです。
 */
async function loadSortSetting(){

    try{

        const saved = await idbGet(STORE_SETTINGS,"main_sort_order");

        if(!saved || typeof saved !== "string"){ return; }

        /*
        保存されている形は "title_asc" のように
        「フィールド名 + _ + 向き」です。

        フィールド名自体に _ が含まれる(nori_injected_at など)ため、
        単純に _ で分割すると壊れます。そこで末尾の "_asc" / "_desc"
        だけを切り離しています。
        */
        let key = null;
        let order = null;

        if(saved.endsWith("_asc")){
            key = saved.slice(0,-4);
            order = "asc";
        }
        else if(saved.endsWith("_desc")){
            key = saved.slice(0,-5);
            order = "desc";
        }

        // 定義に無い項目(古い値など)なら無視します
        if(!key || !findSortDefinition(key)){ return; }

        currentSortKey = key;
        currentSortOrder = order;

        console.log("前回の並び順 :",getSortLabel(key),order === "asc" ? "昇順" : "降順");

    }
    catch(error){

        console.error("並び順の読み込みに失敗 :",error.name,error.message);

    }

}


// ==========================================================
// 4. メニューの表示
// ==========================================================
/**
 * メニューの中身を作り直します。
 *
 * 今選ばれている項目には色を付け、▲(昇順)▼(降順)を添えます。
 */
function renderSortMenu(){

    const menu = document.getElementById("sort-menu");

    if(!menu){ return; }

    menu.innerHTML = "";

    SORT_DEFINITIONS.forEach(function(definition){

        const item = document.createElement("button");
        item.type = "button";
        item.className = "sort-menu-item";

        // 今この順番で並んでいる項目には、青くする印を付けます
        const isActive = (definition.key === currentSortKey);

        if(isActive){
            item.classList.add("active");
        }

        const arrow = isActive
            ? (currentSortOrder === "asc" ? "▲" : "▼")
            : "";

        item.innerHTML =
            "<span>" + definition.icon + "</span>" +
            "<span>" + definition.label + "</span>" +
            "<span class='sort-arrow'>" + arrow + "</span>";

        item.addEventListener("click",function(){
            applySort(definition.key);
        });

        menu.appendChild(item);

    });

}

function openSortMenu(){

    const menu = document.getElementById("sort-menu");
    const button = document.getElementById("sort-btn");

    if(!menu || !button){ return; }

    renderSortMenu();

    menu.style.display = "block";
    button.classList.add("open");

}

function closeSortMenu(){

    const menu = document.getElementById("sort-menu");
    const button = document.getElementById("sort-btn");

    if(!menu || !button){ return; }

    menu.style.display = "none";
    button.classList.remove("open");

}

function isSortMenuOpen(){

    const menu = document.getElementById("sort-menu");

    return (menu && menu.style.display !== "none");

}


// ==========================================================
// 5. 小さな部品
// ==========================================================

function findSortDefinition(key){

    return SORT_DEFINITIONS.find(function(definition){
        return definition.key === key;
    });

}

function getDefaultOrder(key){

    const definition = findSortDefinition(key);

    return definition ? definition.defaultOrder : "desc";

}

function getSortLabel(key){

    const definition = findSortDefinition(key);

    return definition ? definition.label : key;

}


// ==========================================================
// 6. ボタンの結び付け
// ==========================================================

(function bindSortButton(){

    const button = document.getElementById("sort-btn");

    if(!button){ return; }

    button.addEventListener("click",function(event){

        /*
        stopPropagation は「このタップを、親の要素へ伝えない」という
        命令です。

        これが無いと、下で登録している「画面のどこかがタップされたら
        メニューを閉じる」処理にもこのタップが届いてしまい、
        開いた瞬間に閉じてしまいます。
        */
        event.stopPropagation();

        if(isSortMenuOpen()){
            closeSortMenu();
        }
        else{
            openSortMenu();
        }

    });

    /*
    メニューの外側をタップしたら閉じます。
    メニューを開いたまま曲を触れてしまうのを防ぐためです。
    */
    document.addEventListener("click",function(event){

        if(!isSortMenuOpen()){ return; }

        const menu = document.getElementById("sort-menu");

        // メニューの中を押した時は閉じません(項目を選んだ時は別途閉じます)
        if(menu && menu.contains(event.target)){ return; }

        closeSortMenu();

    });

})();
