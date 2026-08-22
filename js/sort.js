/*
======================================================================
 sort.js ── 曲一覧の並び替え

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の見出し横にある ⇅ ボタンを押すとメニューが開き、
 6つの並び順から選べます。

   🕺 ノリ注入順     … 最近ノリを注入した曲を上に
   ⭐ お気に入り順   … 最近お気に入りにした曲を上に
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
    { key:"favorited_at",     icon:"⭐", label:"お気に入り順",   defaultOrder:"desc" },
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

    if(key === "favorited_at"){

        /*
        お気に入りにしていない曲は favorited_at が未設定(undefined)なので
        0として扱われます。お気に入りにした日時は必ずそれより大きい数に
        なるため、compareByNori のような特別な分岐は不要です
        (この機能は最初からON/OFFの印を favorited_at 1つに統一しているため、
         「印はあるのに日時が無い」という食い違いが起こり得ません)。
        */
        return (trackA.favorited_at || 0) - (trackB.favorited_at || 0);

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

【v82で変更した理由】

v81では localeCompare だけで比べていましたが、実機で確認したところ

    記号 → アルファベット → ひらがな → 漢字

の順になっていました。竹弘が普段使っている音楽プレイヤーは
日本語が先に来るため、この並びは感覚に合いませんでした。

そこで、まず「文字の種類」でグループ分けし、その中で
localeCompare を使う二段構えにしています。

    ひらがな・カタカナ → 漢字 → 英数字 → 記号

【なぜ「漢字の読み」で並べないのか】

竹弘の本来の希望は、他のプレイヤーと同じく
「漢字も読み方(ふりがな)でひらがなと混ぜて並べる」ことでした。
たとえば『明日への鼓動』を「あ」の位置に置く、という並びです。

ただし、漢字の読み方はコンピュータには分かりません。
文字そのものには読みの情報が入っていないためです。
実現するには次のどちらかが必要になります。

  ① 日本語の辞書ライブラリを読み込む(数MB。ランニング中に使う
     オフライン前提のアプリには重すぎる)
  ② 音楽ファイルのタグに入っている「並べ替え用のふりがな」を使う
     (iTunes等で管理した曲には入っていることがある。竹弘の曲に
      入っているかは要調査。将来の改善候補)

今回は竹弘の指示どおり、確実に動く文字種グループ方式にしています。
*/
function compareText(textA,textB){

    /*
    比べる前に、半角と全角の表記を揃えます(v83で追加。理由は
    normalizeForSort の解説を参照)。
    */
    const normalizedA = normalizeForSort(textA);
    const normalizedB = normalizeForSort(textB);

    const groupA = getTextGroup(normalizedA);
    const groupB = getTextGroup(normalizedB);

    // 文字の種類が違えば、その順番で決まります
    if(groupA !== groupB){
        return groupA - groupB;
    }

    /*
    同じ種類どうしは localeCompare で比べます。
    「その国の言葉のルールで文字を比べる」標準の命令で、
    "ja"(日本語)を指定するとひらがな・カタカナが
    日本語の辞書と同じ順番になります。
    */
    return normalizedA.localeCompare(normalizedB,"ja");

}

/*
比べるための文字列に整えます。

【なぜ必要になったか(v83)】

v82の実機テストで、半角カタカナ(ｱｲｳ)の曲が記号として一番下に
並んでしまいました。半角カタカナは、全角カタカナ(アイウ)とは
まったく別の文字として扱われているためです。

竹弘の要望は「半角のカタカナも通常のカタカナ扱いにしてほしい」。

【normalize("NFKC") とは】

文字の表記ゆれを揃えてくれる、JavaScript標準の命令です。
"NFKC" を指定すると、見た目が違うだけで意味が同じ文字を
代表的な形へ寄せてくれます。

    ｱｲｳ  → アイウ   (半角カタカナ → 全角カタカナ)
    ｶﾞ    → ガ       (濁点も正しく1文字にまとまる)
    Ａ０ → A0       (全角の英数字 → 半角)
    Ⅰ    → I        (ローマ数字 → アルファベット)

これを比べる前にかけておくことで、半角で書かれていようと全角で
書かれていようと、同じ場所に並ぶようになります。

なお、変換した文字は「並び順を決めるため」だけに使い、画面に表示
する文字は元のままです。曲名の見た目は変わりません。
*/
function normalizeForSort(text){

    if(!text){ return ""; }

    return text.normalize("NFKC");

}

/*
文字列の1文字目を見て、どの種類かを番号で返します。
番号が小さいほど先に並びます。

    0 … ひらがな・カタカナ
    1 … 漢字
    2 … 英数字
    3 … 記号など、上のどれでもないもの

【正規表現の /[...]/ と \uXXXX について】

/[A-Z]/.test(文字) は「その文字が A〜Z の範囲に入っているか」を
調べる書き方です。

日本語の文字も、種類ごとに決まった番号(文字コード)の範囲に
並んでいます。ただし「ぁ」や「ヶ」のような文字を範囲指定に
直接書くと、ファイルの保存方法によっては壊れる恐れがあるため、
\uXXXX という「文字コードで書く形」を使っています。
見た目は読みにくいですが、どんな環境でも確実に動きます。

    ぀-ゟ … ひらがな
    ゠-ヿ … カタカナ(長音符「ー」もこの範囲)
    一-鿿 … 漢字
    々        … 々(「人々」などの繰り返し記号)
    ０-９ … 全角の数字(０〜９)
    Ａ-Ｚ … 全角の大文字(Ａ〜Ｚ)
    ａ-ｚ … 全角の小文字(ａ〜ｚ)

全角の文字まで見ているのは、日本語の曲名では半角と全角が
混ざって入っていることが珍しくないためです。
*/
function getTextGroup(text){

    // 空文字は一番後ろに置きます
    if(!text){ return 3; }

    const firstChar = text.charAt(0);

    /*
    ひらがな・カタカナ。

    範囲を2つに分けているのは、あいだにある「・」(中点)を
    外すためです。中点は文字コードの並び上カタカナの仲間に
    入っていますが、実際は記号なので、竹弘の希望どおり
    記号のグループ(一番後ろ)へ回します。

        ぀〜ヺ … ひらがな と カタカナ
        (・は ここで除外)
        ー〜ヿ … 長音符「ー」と、ヽヾヿ

    ｦ〜ﾟ の範囲は半角カタカナです。上の normalizeForSort で全角へ
    変換済みなので通常はここに来ませんが、変換が効かなかった場合の
    保険として入れています。
    (ｦ より前の ｡｢｣､･ は記号なので、あえて含めていません)
    */
    if(/[぀-ヺー-ヿｦ-ﾟ]/.test(firstChar)){ return 0; }

    // 漢字(々を含む)
    if(/[一-鿿々]/.test(firstChar)){ return 1; }

    /*
    英数字。

    数字をアルファベットと同じ組にしているのは、この組の中では
    localeCompare が数字を先に並べてくれるためです。結果として
    「1、2、A、B」の順になり、一般的な音楽プレイヤーと同じ感覚で
    並びます。
    */
    if(/[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/.test(firstChar)){ return 2; }

    // 上のどれでもない(記号など)
    return 3;

}

/*
ノリ注入順で2曲を比べます。

まず「ノリ注入済み(🕺)か、まだか(🛌)」で分け、
注入済みの中では注入日時で並べます。

【この関数は「昇順(▲)」の並びを返します(v84で修正)】

ここが分かりにくいところなので、順を追って説明します。

この関数を呼んでいる applySort() は、降順(▼)の時に
「返ってきた答えの符号をひっくり返す」という作りになっています。
5つの並び順すべてを同じやり方で扱うためです。

    昇順(▲) … この関数の答えをそのまま使う
    降順(▼) … この関数の答えを逆にする

そのため、この関数は必ず**昇順の並び**を返さなければなりません。
「小さい・古い・まだのもの」が先に来る形です。

    昇順(▲) … まだの曲(🛌) → 注入済み(古い順)
    降順(▼) … 注入済み(新しい順) → まだの曲(🛌)   ← 初回はこちら

ノリ注入順は初回に降順(▼)で並ぶよう設定してあるので、
メニューから選んだ瞬間は必ず

    さっき仕込んだ曲 → 前に仕込んだ曲 → まだの曲

の並びになります。走る前に最後の仕上げをした曲がすぐ見つかる、
という竹弘の狙いどおりの動きです。

【v84で何を直したか】
以前はこの関数が「注入済みが先」という降順の並びを返していました。
そこへ applySort が降順として符号をひっくり返すため、初回に選ぶと
まだの曲(🛌)が上に来てしまっていました。
*/
function compareByNori(trackA,trackB){

    /*
    まだの曲を 0、注入済みを 1 とします。
    昇順では小さい方が先に来るので、まだの曲(🛌)が先になります。
    これを applySort が降順でひっくり返し、注入済みが上に来ます。
    */
    const injectedA = trackA.is_analyzed ? 1 : 0;
    const injectedB = trackB.is_analyzed ? 1 : 0;

    if(injectedA !== injectedB){
        return injectedA - injectedB;
    }

    // どちらも同じ状態なら、注入日時の古い順(昇順)
    return (trackA.nori_injected_at || 0) - (trackB.nori_injected_at || 0);

}


// ==========================================================
// 3. 並び替えを実行する
// ==========================================================
/**
 * 指定した並び順で曲一覧を並べ替え、画面とDBに反映します。
 */
async function applySort(key){

    /*
    並べ替える前に、今の曲順を「一つ前」として覚えておきます(v85)。
    間違った並び順を選んでしまっても、↩ ボタンで戻せるようにするためです。

    必ず並べ替えの前に呼ぶこと。後だと、すでに変わってしまった順番を
    覚えることになり、戻す意味が無くなります。
    */
    savePreviousOrder();

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

        /*
        ★ 除外曲は、どの並び順を選んでも必ず一番下(v110)

        竹弘の指示:
            「あらゆるソート機能を使用しても、一旦除外設定した曲は、
              曲一覧の一番下に配置されるようにしたい」

        【なぜ、この判定を下の符号反転より「手前」に置くのか】

        ここが、この機能で一番間違えやすい箇所です。

        このファイルの比較関数(compareTracks)には
        「必ず昇順の並びを返す」という決まりがあり、降順にしたい時は
        下の行で結果の符号をひっくり返して実現しています。

        もし除外の判定を compareTracks の中や符号反転の後ろに書くと、
        **降順を選んだ瞬間に除外曲が一番上へ飛んでいきます。**
        「一番下」も一緒にひっくり返ってしまうからです。
        (v84で直した不具合と、まったく同じ仕組みの罠です)

        そこで、除外かどうかで先に決着をつけ、その結果は反転させずに
        そのまま返しています。こうしておけば、昇順でも降順でも、
        どの項目で並べても、除外曲は必ず下に沈みます。

        【returnしている値の意味】

        除外を1、通常を0として引き算しています。

            通常(0) - 除外(1) = -1 → 通常が前(＝除外は後ろ)
            除外(1) - 通常(0) =  1 → 除外が後ろ

        両方が同じ種類の時は0になるので、その時だけ下の
        通常の比較へ進みます(除外曲同士も、ちゃんと選んだ
        並び順で整列します)。
        */
        const excludedA = isExcluded(trackA) ? 1 : 0;
        const excludedB = isExcluded(trackB) ? 1 : 0;

        if(excludedA !== excludedB){
            return excludedA - excludedB;
        }

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

    /*
    曲一覧を一番上まで戻します(v101、竹弘の要望)。

        「ソートしたユーザーが見たいのは、ソート結果通りに曲一覧が
          配置されたかだから、一覧のトップに行きたい」

    並び替えは「結果を確かめる」ための操作なので、押した後は一番上から
    見られる方が自然です。v100までは一覧の途中でソートするとその位置に
    留まったままで、結果を見るのに毎回上までスクロールする必要がありました。

    scrollTop は「一番上から何px下にずれているか」を表す値で、
    0 を入れると一番上に戻ります。

    動かす相手が #list-viewport ではなく menuListEl(#menu-list)なのは、
    実際にスクロールしているのがこちらだからです(.music-list が
    height:100% で親を埋め、その中で overflow-y:auto が効いています)。
    drag-sort.js が並び替え中の自動スクロールで menuListEl.scrollTop を
    使っているのと同じ相手です。

    renderList() の後に置いているのは、一覧を作り直してから位置を
    戻すためです。逆にすると、作り直した時に位置が元へ戻ってしまいます。
    */
    menuListEl.scrollTop = 0;

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

        /*
        曲順の保存は js/undo.js の共通処理に任せます(v85)。
        一つ前の曲順も一緒に保存する必要があり、ドラッグ並び替えとも
        同じ内容になるため、1箇所にまとめてあります。
        */
        await savePlaylistOrder();

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

        /*
        1文字目の記号には sort-icon というクラスを付けます(v86)。
        記号だけを大きく表示するためのものです(CSSは c014.html)。

        あわせて data-key に並び順の種類を入れています(v87)。
        絵文字は種類ごとに「文字の枠に対する絵の大きさ」が違い、
        ⏱ だけ小さく見えたため、CSS側でその記号だけ大きさを
        調整できるようにするためのものです。
        */
        item.innerHTML =
            "<span class='sort-icon' data-key='" + definition.key + "'>" + definition.icon + "</span>" +
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

    /*
    メニューの位置を、ボタンの位置に合わせて決めます(v86)。

    【なぜJSで位置を決めるのか】
    メニューは position:fixed(画面が基準)にしてあります。曲一覧
    エリアの中に置くと、はみ出した分が隠れる設定のせいで下の項目が
    切れてしまうためです。画面基準にした代わりに、「ボタンのすぐ下」
    という位置は自分で計算する必要があります。

    getBoundingClientRect() は「その要素が今、画面のどこに見えて
    いるか」を返す命令です。ドラッグ並び替えの自動スクロールでも
    同じものを使っています。
    */

    /*
    高さを測るために、いったん表示します。
    visibility:hidden は「場所は取るが見えない」状態で、
    display:none(場所も取らない)と違って大きさを測れます。
    測ってから位置を決めるので、一瞬ちらつくこともありません。
    */
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const buttonRect = button.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;

    // 基本はボタンのすぐ下
    let top = buttonRect.bottom + 6;

    /*
    画面の下からはみ出してしまう場合は、ボタンの上側に開きます。
    (曲一覧エリアが狭い端末や、横向きにした時のための保険)
    */
    if(top + menuHeight > window.innerHeight - 8){
        top = buttonRect.top - menuHeight - 6;
    }

    // 上にも収まらないほど画面が狭い場合は、画面内に押し込みます
    if(top < 8){
        top = 8;
    }

    menu.style.top = top + "px";
    menu.style.left = buttonRect.left + "px";

    menu.style.visibility = "visible";

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
