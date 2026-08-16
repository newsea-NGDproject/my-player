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
==========================================================
 着地位置を「算数」で出すための決まり(v116)
==========================================================

【なぜこうしたのか】

v115では、着地位置を探す時にブラウザへ「この行は今どこ?」と
尋ねていました(getBoundingClientRect)。尋ねる回数を368回から
9回まで減らしたのに、体感がほとんど変わりませんでした。

理由は、**この命令は1回呼ぶだけで369行すべての位置計算が走る**
ことにあります。368回でも9回でも、最初の1回で全体の計算が
発生してしまうため、回数を減らしても削れていなかったのです。

つまり **0回にしない限り解決しません。**

【0回にできる理由】

曲一覧は、全部の行がまったく同じ高さでできています。

    行の高さ  56px  (.music-row の height)
    行の間隔   8px  (.music-list の gap)
    ----------------------
    1行あたり  64px

同じ間隔で並んでいるなら、**尋ねなくても算数で分かります。**

    (指の位置 - 一覧の上端 + スクロール量) ÷ 64 = 何番目

割り算1回で答えが出ます。ブラウザへの問い合わせは0回、
つまりレイアウトの計算そのものが発生しません。

【★ 将来ここを触る人へ(最重要)】

**この計算は「全行が64px間隔で並んでいる」ことだけを頼りにして
います。** c014.html の

    .music-row      の height:56px
    .music-list     の gap:8px
    .drag-placeholder の height:56px

このどれか1つでも変えたら、**下の ROW_HEIGHT / ROW_GAP も必ず
一緒に変えてください。** 忘れると、掴んだ曲が1行ずれた場所に
着地するようになります。

竹弘とは「この3つの値は今後崩さない」と約束済みです(2026-08-16)。

【端末が変わっても大丈夫な理由】

CSSの px は画面の粒(ドット)ではなく「端末に依存しない単位」です。
画面が細かい端末でも粗い端末でも、56px は 56px。JavaScriptが受け取る
指の座標も同じ単位なので、どの端末でも同じ計算で合います。

画面の大きい端末では「一度に見える行数」が増えるだけで、1行の
高さは変わりません。一覧の上端の位置も実測するので、表示エリアの
高さや位置が端末ごとに違っても自動的に合います。
*/
const ROW_HEIGHT = 56;
const ROW_GAP = 8;

// 1行が占める縦の長さ(行そのもの + 下の隙間)
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;

/*
行の「上半分か下半分か」を分ける境目です。

指が行の上半分にあればその行の前へ、下半分にあれば後ろへ着地
させます(v115までの判定と同じ考え方を、算数に置き換えたものです)。
*/
const ROW_HALF = ROW_HEIGHT / 2;

/*
一覧の上端と下端が、画面のどこにあるか(掴んだ時に1回だけ測ります)。

上端は着地位置の計算に、上端と下端の両方は「指が端に近づいたら
自動スクロールを始める」判定に使います。
*/
let dragListTop = 0;
let dragListBottom = 0;

/*
差し込みスロット(placeholder)が今どこにいるかを、番号で覚えます。

DOMを調べ直さずに「動かす必要があるか」を判断するためのものです。
番号が変わらなければ、insertBefore を呼びません。
*/
let placeholderIndex = 0;

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

/*
==========================================================
 指を一覧の外まで出した時の「追い加速」(v117)
==========================================================

竹弘の指摘:
    「ドラック曲が元位置から離れれば離れるほどスピードが上がる仕様だが、
      そのスピード設定がスクロール速度に限界を設けていないか」

**設けていました。** v116まではこう書いてありました。

    Math.min(ratio, 1) * AUTO_SCROLL_MAX_SPEED

ratio は「自動スクロールのゾーンにどれだけ深く入り込んだか」を
0〜1で表した割合です。ratio が 1 になるのは指が一覧の端に届いた時で、
**そこから先へ指を出しても、min(ratio,1) で1に抑えられるため
まったく速くなりませんでした。**

    18px × 60コマ = 1秒に1,080px = 1秒に約17行

369曲を端から端まで動かすのに22秒かかる計算です。処理の重さ以前に、
単純に頭打ちで止められていたことになります。

【なぜ1に抑えてあったのか(元の意図)】

曲一覧が画面の半分になった時、指が一覧の外(画面の上半分)まで
簡単に出てしまうようになり、割合が際限なく大きくなって
スクロールが暴走したためです。歯止め自体は必要でした。

【v117でどう変えたか】

歯止めは残したまま、**上限を1倍から3倍へ引き上げます。**

    一覧の中で端に近づく      … 今まで通り、最大18px(目で追える速さ)
    一覧の外へ指を出す        … そこからさらに加速し、最大54px

54px × 60コマ = 1秒に3,240px = 1秒に約50行。369曲を7秒ほどで
走破できます。「もっと早くスクロールしたい時は指を外へ出す」という、
指の位置で速さを選べる操作になりました。

まだ物足りなければ、この数字を上げてください(4なら72px、5なら90px)。
*/
const AUTO_SCROLL_TURBO_RATIO = 3;

/*
==========================================================
 速く流れている間は、入れ替え表示を省く(v117)
==========================================================

竹弘の提案:
    「おそらく人間の目では、入れ替え表示はスクロールが早くて確認
      できないので不要だと思う。スクロールスピードが遅くなってきたら
      (=人間の目で入れ替え表示している事がわかるスピード)
      また入れ替え表示を行う作りとすることはできないか」

**この読みは正しく、しかも一番効く場所でした。**

ドラッグ中に残っている重い作業は、もう「差し込みスロット(点線の枠)を
一覧の中で動かすこと」だけです。スロットを動かすと一覧の並びが
変わるので、ブラウザは行の位置を計算し直して描き直します。

ところが1秒に50行も流れている場面では、**その描き直しは人の目に
届きません。** 見えないもののために、一番重い作業をしていたわけです。

そこで、この速さを超えている間は **「どこに入るか」の計算だけを続け、
枠を動かす作業を省きます。** 速度が落ちたら、覚えておいた位置へ
すぐに枠を戻すので、目で確かめられる場面では今まで通り見えます。

18 という値は、一覧の中での最高速度(AUTO_SCROLL_MAX_SPEED)と
同じです。つまり **「指を一覧の外へ出して加速している間だけ省く」**
ことになり、竹弘が挙げた「曲一覧範囲を超えた場合」という区切りと
自然に一致します。
*/
const FAST_SCROLL_SKIP_SPEED = 18;

/*
今フレームのスクロール速度(px)。上のしきい値と比べるために持ちます。
指で普通に動かしているだけの時は0です。
*/
let currentScrollSpeed = 0;

/*
入れ替え表示を省いている間、本来スロットがあるべき位置を覚えておきます。

-1 は「省いているものは無い」という印です。速度が落ちた時や指を
離した時に、ここに残っている位置を画面へ反映します。
*/
let pendingPlaceholderIndex = -1;


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

    dragCandidates = [];
    dragFirstExcludedRow = null;
    placeholderIndex = 0;

    /*
    一覧に並んでいるものを、上から順に1回だけ見ていきます。

    placeholder(差し込みスロット)にたどり着いたら印を立て、
    それより前にあった通常曲の数を placeholderIndex とします。
    これが「スロットは今、上から何番目にいるか」になります。

    掴んで浮いている行(draggingRow)は position:fixed で一覧の
    流れから外れているので、数に入れません。
    */
    let seenPlaceholder = false;

    for(const child of menuListEl.children){

        if(child === placeholder){
            seenPlaceholder = true;
            continue;
        }

        if(child === draggingRow){ continue; }

        if(!child.classList.contains("music-row")){ continue; }

        if(child.classList.contains("excluded")){

            // 一番上の除外行だけ覚えておけば十分です
            if(!dragFirstExcludedRow){
                dragFirstExcludedRow = child;
            }

        }
        else{

            if(!seenPlaceholder){ placeholderIndex++; }

            dragCandidates.push(child);

        }

    }

    /*
    一覧の上端が画面のどこにあるかを、ここで1回だけ測ります(v116)。

    【ドラッグ中に測り直さなくてよい理由】

    普通のWebページは、スクロールするとアドレスバーが隠れて表示位置が
    ずれます。しかしノリRunは固定1画面で、ページ全体はスクロールしません
    (動くのは曲一覧の中だけ)。そのためアドレスバーは出たままで、
    一覧の上端が掴んでいる最中にずれることがありません。

    あと何pxスクロールできるかも同じく1回だけです。scrollHeight を読むと
    ブラウザはレイアウトを計算し直しますが、掴んでいる間は行数が変わらない
    ので値も変わりません。
    */
    const listRect = menuListEl.getBoundingClientRect();

    dragListTop = listRect.top;
    dragListBottom = listRect.bottom;

    dragScrollMax = menuListEl.scrollHeight - menuListEl.clientHeight;

}

function updatePlaceholderPosition(clientY){

    if(!draggingRow || !placeholder){ return; }

    /*
    ==========================================================
     着地位置を「算数」で出します(v116)
    ==========================================================

    ブラウザへの問い合わせは **0回** です。詳しい理由はファイル上部の
    ROW_STRIDE の解説を読んでください。要点だけ書くと、
    「この行はどこ?」と1回でも尋ねると369行ぶんの計算が走ってしまう
    ため、尋ねること自体をやめました。

    【① 指が一覧の先頭から何px下にいるか】

        指の画面上の位置 - 一覧の上端 = 見えている範囲での位置
        + スクロール量                 = 一覧の先頭から数えた位置

    スクロールで隠れている上の部分も足すのがポイントです。
    */
    const offsetY = clientY - dragListTop + menuListEl.scrollTop;

    /*
    【② 何番目に差し込むかを求める】

    v115までは「指が行の上半分にあれば、その行の前に入れる」という
    判定をしていました。同じ結果を割り算で出します。

    行は64pxごとに並び、各行の境目(上半分と下半分の境)は
    先頭から 28px, 92px, 156px … と64px刻みで並びます。
    そこで28pxを引いてから64で割り、切り上げれば番号が出ます。

        指が  0〜28px  → 0番目(先頭)に入る
        指が 29〜92px  → 1番目に入る
        指が 93〜156px → 2番目に入る

    Math.ceil は「小数を切り上げる」命令です。
    */
    const rawIndex = Math.ceil((offsetY - ROW_HALF) / ROW_STRIDE);

    /*
    【③ 差し込みスロット自身のぶんを差し引く】

    ここが少しだけややこしい部分です。

    ②で出した番号は「今の見た目の並び」での位置ですが、その並びには
    **差し込みスロット(点線の枠)自身も1行分の場所を取って混ざって
    います。** スロットより下を指している時は、その1行分だけ番号が
    ずれるので引き算で戻します。

    dragCandidates(通常の曲だけの並び)での番号に揃えるための補正です。
    */
    let targetIndex = (rawIndex > placeholderIndex) ? rawIndex - 1 : rawIndex;

    // 一覧の外を指していても、端で止まるようにします
    if(targetIndex < 0){ targetIndex = 0; }
    if(targetIndex > dragCandidates.length){ targetIndex = dragCandidates.length; }

    /*
    【④ 動かす必要が無ければ、DOMには一切触れない】

    指を少し動かしただけでは着地先は変わりません。それでも
    insertBefore を呼ぶと、ブラウザは「一覧を書き換えた」と受け取って
    見た目を計算し直します。番号が同じなら、ここで引き返します。
    */
    if(targetIndex === placeholderIndex){

        // 画面と一致しているので、省いていたものは何も残っていません
        pendingPlaceholderIndex = -1;

        return;

    }

    /*
    【⑤ 速く流れている間は、枠を動かす作業を省く】(v117)

    ここまでの計算(割り算1回)はごく軽い作業です。重いのはこの先の
    「差し込みスロットを一覧の中で動かす」処理で、動かすたびに
    ブラウザが行の位置を計算し直して描き直します。

    1秒に50行も流れている場面では、その描き直しは人の目に届きません。
    そこで速く流れている間は、**どこに入るかを覚えておくだけにして、
    実際に動かすのは後回しにします。**

    速度が落ちれば下の movePlaceholderTo() がすぐ呼ばれ、指を離した時も
    flushPendingPlaceholder() が必ず反映するので、**着地する場所は
    省いても省かなくても同じです。** 変わるのは「途中の動きが見えるか
    どうか」だけです。
    */
    if(Math.abs(currentScrollSpeed) >= FAST_SCROLL_SKIP_SPEED){

        pendingPlaceholderIndex = targetIndex;

        return;

    }

    movePlaceholderTo(targetIndex);

}

/**
 * 差し込みスロット(点線の枠)を、指定の位置へ実際に動かします。
 *
 * 【除外曲より下へ着地させない仕組み】(v110の約束)
 *
 * 除外曲そのものはドラッグを受け付けないので指では持てませんが、
 * それだけだと **普通の曲を除外曲より下へ運べてしまいます。**
 * 通常曲の最後まで来た時は、一覧の末尾ではなく「最初の除外行の
 * すぐ手前」へ差し込むことで、除外曲を必ず一番下に保ちます。
 */
function movePlaceholderTo(targetIndex){

    if(targetIndex === placeholderIndex){
        pendingPlaceholderIndex = -1;
        return;
    }

    if(targetIndex < dragCandidates.length){
        menuListEl.insertBefore(placeholder,dragCandidates[targetIndex]);
    }
    else if(dragFirstExcludedRow){
        menuListEl.insertBefore(placeholder,dragFirstExcludedRow);
    }
    else{
        menuListEl.appendChild(placeholder);
    }

    // スロットの居場所を更新します(次回の④の判定に使います)
    placeholderIndex = targetIndex;

    pendingPlaceholderIndex = -1;

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

    /*
    曲一覧エリアの位置は、掴んだ時に測ったものを使います(v116)。

    この関数は指が動くたびに呼ばれます。ここで毎回位置を測ると、
    そのたびにブラウザが369行ぶんのレイアウトを計算し直すため、
    着地位置の計算を算数に変えた意味が無くなってしまいます。
    */
    const listRect = { top: dragListTop, bottom: dragListBottom };

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
        エリアの位置も残りスクロール量も、掴んだ時に測ったものを
        使い回します(v116)。

        このループは1秒間に60回走ります。v115まではここで毎回
        getBoundingClientRect を呼んでいたため、**指を端に置いて
        自動スクロールさせている間ずっと、毎フレーム369行ぶんの
        レイアウト計算が走っていました。** ドラッグ中だけ重かった
        本当の原因はここです。

        ノリRunは固定1画面でページ全体がスクロールしないため、
        掴んでいる最中に一覧の位置がずれることはありません。
        */
        const rect = { top: dragListTop, bottom: dragListBottom };
        const currentScrollMax = dragScrollMax;

        if(currentClientY < rect.top + AUTO_SCROLL_ZONE &&
           menuListEl.scrollTop > 0){

            /*
            ratio は「ゾーンにどれだけ深く入り込んだか」を表す割合です。
            端に近いほど大きくなり、速く動きます。

              ratio = 1 … 指が一覧の端にちょうど届いた状態
              ratio > 1 … 指が一覧の外(画面の上半分)まで出た状態

            v116まではここを Math.min(ratio,1) として1倍で頭打ちに
            していました。指が外へ出ても速くならなかったのはこのためです
            (元々は、割合が際限なく大きくなってスクロールが暴走するのを
              防ぐための歯止めでした)。

            v117では歯止めを残したまま上限を3倍へ引き上げ、指を外へ
            出すほど速くなるようにしています(詳しくは
            AUTO_SCROLL_TURBO_RATIO の解説を参照)。
            */
            const ratio = (rect.top + AUTO_SCROLL_ZONE - currentClientY) / AUTO_SCROLL_ZONE;
            speed = -Math.ceil(Math.min(ratio,AUTO_SCROLL_TURBO_RATIO) * AUTO_SCROLL_MAX_SPEED);
            setGlow("top");
        }
        else if(currentClientY > rect.bottom - AUTO_SCROLL_ZONE &&
                menuListEl.scrollTop < currentScrollMax){

            const ratio = (currentClientY - (rect.bottom - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE;
            speed = Math.ceil(Math.min(ratio,AUTO_SCROLL_TURBO_RATIO) * AUTO_SCROLL_MAX_SPEED);
            setGlow("bottom");
        }
        else{
            setGlow("");
        }

        /*
        今フレームの速さを控えておきます(v117)。

        この直後に呼ばれる updatePlaceholderPosition() が、この値を見て
        「今は速すぎるから、枠を動かす作業は省こう」と判断します。
        */
        currentScrollSpeed = speed;

        if(speed !== 0){
            // ページ全体ではなく、曲一覧エリアの中だけを動かします。
            menuListEl.scrollTop += speed;
            updatePlaceholderPosition(currentClientY);
            requestAnimationFrame(scrollLoop);
        }
        else{

            autoScrollActive = false;
            currentScrollSpeed = 0;
            stopAutoScrollGlow();

            /*
            自動スクロールが止まった時点で、省いていた入れ替え表示を
            画面へ反映します(v117)。

            ここで反映しないと、指を止めたまま動かさない間、枠が
            古い位置に残って見えてしまいます(指が動けば
            updatePlaceholderPosition が呼ばれて直りますが、
            動かさなければ呼ばれないためです)。
            */
            flushPendingPlaceholder();

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

/**
 * 速すぎて省いていた入れ替え表示を、画面へ反映します(v117)。
 *
 * 呼ばれるのは次の2か所です。
 *
 *   ・自動スクロールが止まった時(指を端から戻した / 一覧の端に着いた)
 *   ・指を離した時(clearAllDraggingStates)
 *
 * **特に2つ目が大事です。** 指を離した瞬間の枠の位置が、そのまま
 * 曲の着地先になります。ここで反映を忘れると、省いている間に
 * 通り過ぎたぶんが失われ、**狙った場所と違うところへ曲が入って
 * しまいます。**
 */
function flushPendingPlaceholder(){

    if(pendingPlaceholderIndex < 0){ return; }

    movePlaceholderTo(pendingPlaceholderIndex);

}


// ==========================================================
// 4. 指を離した時の後始末と保存
// ==========================================================

function clearAllDraggingStates(){

    /*
    まず、省いていた入れ替え表示を画面へ反映します(v117)。

    **必ずこの位置(下の処理より前)で呼ぶこと。** この後の処理は
    「差し込みスロットのある場所へ曲を着地させ、その並びを保存する」
    というものなので、スロットが本来の位置に無いまま進むと、
    狙った場所と違うところへ曲が入り、そのまま保存されてしまいます。
    */
    flushPendingPlaceholder();

    currentScrollSpeed = 0;

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
    pendingPlaceholderIndex = -1;

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
