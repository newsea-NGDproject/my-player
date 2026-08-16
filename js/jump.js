/*
======================================================================
 jump.js ── 曲一覧のジャンプ(🐇ウサギボタン)

----------------------------------------------------------------------

【このファイルの役割】

 369曲もある曲一覧を、一気に移動するための操作です。

   🐇 に指を置く   … 上・右・下に行き先のボタンが開く
   指を滑らせる     … 行き先を選ぶ(選んだ先が青く光る)
   指を離す         … その場所へ飛ぶ

     ↑ 一番上へ
     → 真ん中へ
     ↓ 一番下へ

----------------------------------------------------------------------

【この操作方式は竹弘の設計です(2026-08-16、写真2枚で指示)】

    「ウサギボタンに指を置くとウサギボタンを押している間
      ウサギボタンの上と右と下に角丸ボタンを展開。
      ウサギに置いた指を離さないでTOPかMIDかENDのボタンに
      スライドして手を放す事で機能を発動する」

 一般に「ラジアルメニュー」と呼ばれる形で、ゲームのUIでよく
 使われます。走りながら使う道具として、次の点が優れています。

   ・押した場所を起点に方向で選ぶので、**画面をよく見なくても操作できる**
   ・押している間しか出ないので、普段の見出し行はすっきりしたまま
   ・指を離さずに済むので、揺れていても狙いを外しにくい
   ・**離す前なら別の方向へ滑らせて選び直せる**(誤操作を取り消せる)

 絵文字がウサギ(🐇)なのは「ジャンプ」の連想から。ボタンの形を
 **角丸の四角**にしてあるのも竹弘の指定で、丸い ⇅ や ↩ と並べた時に
 「これは押すボタンではなく、指を置いて滑らせるボタンだ」と
 見た目で区別できるようにするためです。

----------------------------------------------------------------------

【なぜ「検索」を左に付けなかったのか】

 当初は左方向に検索を足す案がありましたが、竹弘の判断で取りやめました。

    「検索は基本機能のプレイヤーを逸脱した大きなプログラムに
      なりそうなので、一旦辞めます」

 将来また作ることになったら、下の JUMP_DIRECTIONS に左方向を
 1行足すところから始められます。

----------------------------------------------------------------------

【展開したボタンを body の直下に置いている理由】

 曲一覧のカード(#list-area)には overflow:hidden が指定してあり、
 **枠からはみ出した部分は切り取られて見えなくなります。**

 竹弘の写真②を見ると、上向きのボタンは曲一覧カードを飛び出して
 画面の上半分(■停止ボタンのあたり)まで届いています。カードの中に
 置いたのでは、この見た目は作れません。

 そこで展開ボタンは <body> の直下に置き、position:fixed で画面の
 座標に直接配置しています。ウサギボタンが今どこにあるかをその場で
 測り、その上下左右に並べる形です。

 ドラッグ中の行が指についてくる仕組み(js/drag-sort.js)と同じ
 やり方で、このアプリの中で実績のある手法です。
======================================================================
*/


// ==========================================================
// 1. 行き先の定義
// ==========================================================
/*
展開するボタンを、ここにまとめています。

  action … 行き先の名前(下の jumpTo() が見ます)
  dir    … どちらへ展開するか

項目を増やしたい時(例えば左に検索を足す時)は、この配列に
1行足してHTMLにボタンを1つ置くだけで済みます。
*/
const JUMP_DIRECTIONS = [
    { action:"top", dir:"up"    },
    { action:"mid", dir:"right" },
    { action:"end", dir:"down"  }
];

/*
ウサギボタンの中心から、展開したボタンの中心までの距離(px)です。

ボタンの大きさが40pxなので、48pxにすると間に8pxの隙間ができ、
竹弘の写真②とほぼ同じ間隔になります。指で滑らせるのにちょうど
よい距離で、これより近いと隣を選びにくく、遠いと指が届きません。
*/
const JUMP_MENU_DISTANCE = 48;


// ==========================================================
// 2. 画面部品と状態
// ==========================================================

const jumpBtn = document.getElementById("jump-btn");
const jumpMenu = document.getElementById("jump-menu");

/*
展開中のボタンと、その位置をまとめて覚えておきます。

指がどのボタンの上にあるかを判定するのに使います。**展開した時に
1回だけ位置を測って覚える**ので、指を動かすたびに measure し直す
必要がありません(ドラッグ並び替えで学んだのと同じ考え方です)。
*/
let jumpOptions = [];

// 今どのボタンの上に指があるか(何も選んでいなければ null)
let jumpActiveAction = null;


// ==========================================================
// 3. メニューを開く
// ==========================================================
/**
 * ウサギボタンの周りに、行き先のボタンを展開します。
 */
function openJumpMenu(){

    /*
    ウサギボタンが今、画面のどこにあるかを測ります。

    端末の画面サイズや、曲一覧の高さによって位置が変わるため、
    決め打ちの数値ではなく毎回ここで測り直します。
    */
    const btnRect = jumpBtn.getBoundingClientRect();

    // ウサギボタンの中心
    const centerX = btnRect.left + btnRect.width / 2;
    const centerY = btnRect.top + btnRect.height / 2;

    jumpMenu.style.display = "block";

    jumpOptions = [];

    for(const item of JUMP_DIRECTIONS){

        const optionEl = jumpMenu.querySelector(
            "[data-jump='" + item.action + "']"
        );

        if(!optionEl){ continue; }

        /*
        方向に応じて、中心からどれだけずらすかを決めます。

        画面の座標は「右へ行くほどxが大きく、下へ行くほどyが大きい」
        ので、上へ出す時はyを引き、下へ出す時はyを足します。
        */
        let offsetX = 0;
        let offsetY = 0;

        if(item.dir === "up"){    offsetY = -JUMP_MENU_DISTANCE; }
        if(item.dir === "down"){  offsetY =  JUMP_MENU_DISTANCE; }
        if(item.dir === "right"){ offsetX =  JUMP_MENU_DISTANCE; }
        if(item.dir === "left"){  offsetX = -JUMP_MENU_DISTANCE; }

        /*
        ボタンの左上の座標を決めます。

        中心を合わせたいので、ボタンの幅と高さの半分だけ左上へ
        ずらしています(position:fixed は左上を指定する方式のため)。
        */
        const left = centerX + offsetX - btnRect.width / 2;
        const top  = centerY + offsetY - btnRect.height / 2;

        optionEl.style.left = left + "px";
        optionEl.style.top  = top + "px";

        optionEl.classList.remove("jump-active");

        /*
        当たり判定の四角を覚えておきます。

        指がこの範囲に入っていれば、そのボタンを選んでいることに
        なります。位置は今決めた値そのものなので、あらためて
        getBoundingClientRect を呼ぶ必要はありません。
        */
        jumpOptions.push({
            action: item.action,
            el: optionEl,
            left: left,
            top: top,
            right: left + btnRect.width,
            bottom: top + btnRect.height
        });

    }

    jumpActiveAction = null;

    jumpBtn.classList.add("jump-open");

}

/**
 * 展開したボタンを片付けます。
 */
function closeJumpMenu(){

    jumpMenu.style.display = "none";

    for(const option of jumpOptions){
        option.el.classList.remove("jump-active");
    }

    jumpOptions = [];
    jumpActiveAction = null;

    jumpBtn.classList.remove("jump-open");

}


// ==========================================================
// 4. 指がどのボタンの上にあるかを見る
// ==========================================================
/**
 * 指の位置から、今どの行き先を選んでいるかを判定して光らせます。
 */
function updateJumpSelection(clientX,clientY){

    let nextAction = null;

    for(const option of jumpOptions){

        /*
        指がこのボタンの四角の中にあるかを調べます。

        左端より右、右端より左、上端より下、下端より上 ——
        4つすべてを満たしていれば、そのボタンの上にいます。
        */
        if(clientX >= option.left && clientX <= option.right &&
           clientY >= option.top  && clientY <= option.bottom){

            nextAction = option.action;
            break;

        }

    }

    // 選んでいるものが変わっていなければ、何もしません
    if(nextAction === jumpActiveAction){ return; }

    jumpActiveAction = nextAction;

    for(const option of jumpOptions){

        option.el.classList.toggle(
            "jump-active",
            option.action === nextAction
        );

    }

    /*
    選ぶ先が変わった瞬間に、軽く震わせます。

    走りながらだと画面をじっくり見られないので、**指先で「今、隣の
    ボタンに移った」と分かる**ようにするためです。並び替えで曲を
    掴んだ時と同じ長さ(15ミリ秒)に揃えています。

    navigator.vibrate に対応していない端末では何も起きないので、
    使えるかどうかを確かめてから呼んでいます。
    */
    if(nextAction && navigator.vibrate){
        navigator.vibrate(15);
    }

}


// ==========================================================
// 5. 実際に飛ぶ
// ==========================================================
/**
 * 指定された行き先へ、曲一覧をスクロールします。
 *
 * @param {string} action - "top" / "mid" / "end"
 */
function jumpTo(action){

    /*
    あと何pxスクロールできるかを求めます。
    (中身全体の高さ - 見えている高さ = 隠れている分)
    */
    const scrollMax = menuListEl.scrollHeight - menuListEl.clientHeight;

    let target = 0;

    if(action === "top"){
        target = 0;
    }
    else if(action === "mid"){
        target = scrollMax / 2;
    }
    else if(action === "end"){
        target = scrollMax;
    }
    else{
        return;
    }

    /*
    一気に飛ばします(なめらかに動かす behavior:"smooth" は使いません)。

    369曲ぶんの距離をなめらかに流すと何秒もかかってしまい、
    「すぐそこへ行きたい」というこの機能の目的に合わないためです。
    ゆっくり見たい時は、指でスクロールすれば済みます。
    */
    menuListEl.scrollTop = target;

    console.log("曲一覧をジャンプしました :",action);

}


// ==========================================================
// 6. 指の操作を受け付ける
// ==========================================================
/*
【なぜ click ではなく pointerdown / move / up なのか】

このボタンは「押す」のではなく「指を置いて、滑らせて、離す」という
一連の動きで操作します。click は押して離すまでを1つにまとめて
しまうため、途中で指がどこへ動いたかが分かりません。

そこで3つに分けて受け取ります。

    pointerdown … 指が触れた   → メニューを開く
    pointermove … 指が動いた   → 行き先を選ぶ
    pointerup   … 指が離れた   → 選んだ先へ飛ぶ
*/

jumpBtn.addEventListener("pointerdown",function(e){

    /*
    preventDefault は「ブラウザが勝手にやることを止める」命令です。
    これが無いと、指の動きが画面のスクロールとして扱われたり、
    長押しで文字選択が始まったりします。
    */
    e.preventDefault();

    openJumpMenu();

    /*
    setPointerCapture は「この指の動きを、最後までこの要素に
    届けてほしい」とブラウザに頼む命令です。

    これが無いと、**指がウサギボタンの外(展開したボタンの上)へ
    出た瞬間に、動きの通知が届かなくなります。** 指を滑らせて選ぶ
    という操作そのものが成り立たなくなるため、必ず必要です。

    並び替えで曲を掴んで運ぶ時(js/drag-sort.js)と同じ仕組みです。
    */
    jumpBtn.setPointerCapture(e.pointerId);

    if(navigator.vibrate){ navigator.vibrate(15); }

});

jumpBtn.addEventListener("pointermove",function(e){

    // メニューが開いていない時(ただ指が通過しただけ)は何もしません
    if(jumpOptions.length === 0){ return; }

    e.preventDefault();

    updateJumpSelection(e.clientX,e.clientY);

});

jumpBtn.addEventListener("pointerup",function(e){

    if(jumpOptions.length === 0){ return; }

    jumpBtn.releasePointerCapture(e.pointerId);

    /*
    離した時に選んでいた行き先へ飛びます。

    どのボタンの上でもない場所で離した場合(ウサギボタンの上で
    離した時など)は jumpActiveAction が null なので、何も起きません。
    **これがそのまま「やっぱりやめる」の操作になります。**
    竹弘が誤って指を置いてしまっても、そのまま離せば何も起きません。
    */
    const action = jumpActiveAction;

    closeJumpMenu();

    if(action){
        jumpTo(action);
    }

});

/*
指の追跡が何かの拍子に打ち切られた時の後始末です。

電話がかかってきた時など、指を離していないのに操作が中断される
ことがあります。その時にメニューが開きっぱなしにならないよう、
念のため閉じておきます。
*/
jumpBtn.addEventListener("pointercancel",function(){

    closeJumpMenu();

});
