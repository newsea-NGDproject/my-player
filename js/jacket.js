/* ==========================================================
   js/jacket.js

   再生中のジャケット写真を、タップで大きく表示する画面です。

   竹弘の要望(2026-09-13、棚③の11番):
       「再生中のアルバムをタップで特大表示(画像がある時だけ)」

   ------------------------------------------------------------
   【この版(v204)でやること / やらないこと】

       やる     … タップで大きく見る
       やらない … ジャケ写の差し替え(カメラで撮る)
                  画像が無い曲に薄いカメラアイコンを出す

   差し替えとカメラアイコンは竹弘の指示で「次のブラッシュアップ」に
   回しました(CLAUDE.md の未実装リストに登録済み)。この画面の
   **アーティスト名の下**に、その時ボタンを2つ置く予定です。

   ------------------------------------------------------------
   【今の形(v257。①-1 特大表示のジャケ)】

   置き場所 … 置き方 A(竹弘の指定 2026-10-25)。ジャケは上半分の角丸
              カードの中いっぱい。曲名・アーティスト・ボタンは、その下の
              曲一覧の操作パネルと1段目の欄まで(「1. 大きさと置き場所」)
   画質     … 開いた瞬間は DB の絵を出し、静かな時に曲のファイルから
              元のジャケを読み直して、ふわっと鮮明な絵に入れ替える
              (「3-1. 元のファイルから読み直す」)
   注意書き … 上書きの確認などの赤い文字は、曲名・アーティストの2行の
              場所に出す(その間だけ2行を隠す)

   原寸を DB に保存しないのは竹弘の判断(2026-08-08。1曲500KB〜1MBで、
   数百曲だと DB が数百MBに膨れる)。だから鮮明な絵は「開いている間だけ」
   持ち、閉じたらすぐ手放します。

   経緯 → devlog/ジャケ写.md
   ========================================================== */


// ==========================================================
// 1. 大きさと置き場所の決め方(v257 で作り直した。置き方 A)
// ==========================================================
/*
竹弘の指定(2026-10-25。置き方 A):

    ジャケ                       … 上半分の角丸カード(#upper-area)の中いっぱい
    曲名・アーティスト・ボタン   … その下の、曲一覧の操作パネル(🔁⇅⏮■⏭🐇↩)と
                                   曲一覧の1段目の欄まで。2段目から下には被せない
    グレーの幕・縁取り・影       … 今のまま(竹弘「グレー画面上で浮いた感じの表現も
                                   気に入っているのでそのままに」)

    竹弘:「決して、今のメニューレイアウトを変えたいという内容ではありません」
    → 動かすのは特大表示だけ。上半分と曲一覧の作りには触りません。

【2段目から下に被せない理由(竹弘)】

 1段目に今の曲が居れば、その名前は特大表示に出ている。2曲目以降は 🎵 を押すと
 2段目に来る(js/list-follow.js の「上から2段目」)。だから1段目までは隠してよい。

【決め方 ―― layoutJacketBig() が、開くたびに本物の画面を測ります】

    ① ジャケの一辺 = 上半分のカードの短い辺 − 内側の余白(JACKET_BIG_INSET_PX)× 2
       カードの真ん中に置く
    ② 曲名からボタンまでの高さを測り、ボタンの下端が「曲一覧の1段目の下端」を
       越えるなら、越えないところまでジャケを小さくする(真ん中に置いたまま)

 ⚠️ 足し算で決め打ちしません。文字の行の高さは、書体や端末で数pxずつ変わるためです
    (足し算の見積もりが実測と6pxずれたことがある。devlog/ジャケ写.md)。
 ⚠️ ジャケの大きさを変えると、DB の絵を「何点で出すか」も変わります。鮮明さは
    「3-1. 元のファイルから読み直す」が受け持つので、ここでは気にしなくてよい。
 ⚠️ 置き場所を変えたら sandbox/measure-jacket-layout.html で測り直すこと。
    あのページは、この下の layoutJacketBig() をこのファイルから取り出して、
    本物の c014.html の画面の上でそのまま動かします。
*/

/*
ジャケの外側と、上半分のカードの外側の間(px)です。

カードの角丸(18px)はジャケの角丸(10px)より大きいので、ぴったり重ねると
ジャケの角が、カードの丸い角から少しはみ出して見えます。4px 内側に入れると、
角までカードの中に収まります(計算では 2.4px 以上で収まる。少し余裕を持たせた)。
*/
const JACKET_BIG_INSET_PX = 4;

/*
ジャケの縁取りの太さ(px)。c014.html の #jacket-big の border と同じ数字です。

鮮明な絵を「何点でほどくか」を決める時に、縁取りの内側の大きさを出すために使います
(「3-1.」の startJacketReload)。⚠️ CSS の border を変えたら、ここも一緒に変えること。
*/
const JACKET_BIG_BORDER_PX = 3;

/*
曲一覧の1行の高さが測れなかった時(一覧が空・検索で隠れている時など)に使う値です。
c014.html の .music-row の height と同じ数字です。
*/
const JACKET_BIG_ROW_FALLBACK_PX = 56;

/*
それでも小さくしすぎない下限です。画面の低い端末で、ジャケットが
豆粒になって何が写っているか分からなくなるのを防ぎます。
*/
const JACKET_BIG_MIN_SIZE_PX = 120;

/*
ボタンとボタンの間隔(px)です。

⚠️ **CSSではなくここで決めます(v213)。** ボタンの幅を
   「(ジャケット幅 − 間隔×2) ÷ 3」で計算するので、**間隔の数字を
   CSSとJSの2か所に書くと、片方を直した時にボタンがはみ出します。**
   ここで決めた値を、CSS変数として渡します。
*/
const JACKET_BUTTON_GAP_PX = 8;

/*
⚠️⚠️ **ボタン(正方形)の一辺の上限です(v214)。**

竹弘の指定(2026-09-21):

    「今縦長長方形のボタンを正方形にしてもらえないか。ジャケットの
      正方形に対して、見栄えが悪い為。ボタンを正方形にすることで
      高さを削減し、その分だけでいいので警告メッセージがギリギリ
      なので上にずらして欲しい」

【なぜ上限が要るのか ―― 実測で分かったこと】

「ジャケット幅 ÷ 3」で決めた幅は、竹弘の端末で **64px**、
高さは **52px** でした(`sandbox/measure-jacket-layout.html` で実測)。
つまり実際は**横長**です。

    そのまま正方形にすると 64×64 → **高さが12px増える**
    → 警告メッセージがさらに下がり、**逆効果**

そこで一辺に上限を設け、**高さが増えないところで正方形にします。**

    竹弘の端末   幅64 → 48×48   高さ 52 → 48(4px 節約)
    小さい画面   幅41 → 41×41   高さ 51 → 41(10px 節約)

⚠️ **48px は、指で押せる大きさの目安としてもちょうど下限**です
   (これより小さくすると押し間違いが増えます)。走りながら操作する
   アプリなので、ここは削りすぎないこと。

⚠️ (v257)置き方 A では、ボタンの高さが増えるとそのぶん「1段目まで」に
   収めるためにジャケが小さくなります。上限を上げる時は測り直すこと。
*/
const JACKET_BUTTON_MAX_PX = 48;


// ==========================================================
// 2. 画面の部品
// ==========================================================
const jacketPanelEl      = document.getElementById("jacket-panel");
const jacketPanelInnerEl = document.getElementById("jacket-panel-inner");
const jacketBigEl        = document.getElementById("jacket-big");
const jacketBigTitleEl   = document.getElementById("jacket-big-title");
const jacketBigArtistEl  = document.getElementById("jacket-big-artist");

/*
曲名とアーティストの2行を包む箱です(v257)。赤い注意書きは、この箱の
真ん中に重ねて出します(showJacketWarning)。
*/
const jacketBigNamesEl   = document.getElementById("jacket-big-names");

// ---- 差し替え機能の部品(v207で追加、v208で3ボタン化) ----
const jacketBtnOriginalEl = document.getElementById("jacket-btn-original");
const jacketBtnMyFileEl   = document.getElementById("jacket-btn-myfile");
const jacketBtnCameraEl   = document.getElementById("jacket-btn-camera");

// 撮った / 選んだ直後の確認ボタン(v208)
const jacketBigButtonsEl     = document.getElementById("jacket-big-buttons");
const jacketConfirmButtonsEl = document.getElementById("jacket-confirm-buttons");
const jacketBtnAcceptEl      = document.getElementById("jacket-btn-accept");
const jacketBtnRetryEl       = document.getElementById("jacket-btn-retry");
const jacketBtnCancelEl      = document.getElementById("jacket-btn-cancel");

// アートワークの選び直しと、上書きの確認(v210)
const jacketArtworkButtonsEl   = document.getElementById("jacket-artwork-buttons");
const jacketOverwriteButtonsEl = document.getElementById("jacket-overwrite-buttons");
const jacketBtnOverwriteEl     = document.getElementById("jacket-btn-overwrite");
const jacketBtnOverwriteCancelEl = document.getElementById("jacket-btn-overwrite-cancel");
const jacketWarningEl          = document.getElementById("jacket-warning");

// アプリ内カメラ(v212)
const jacketCameraButtonsEl    = document.getElementById("jacket-camera-buttons");
const jacketBtnShootEl         = document.getElementById("jacket-btn-shoot");
const jacketBtnCameraCancelEl  = document.getElementById("jacket-btn-camera-cancel");

// 見えないファイル選択(v208で2つに分けた)
const jacketMyFileInputEl = document.getElementById("jacket-myfile-input");
/*
⚠️ v213で「標準のカメラアプリ用の入力」を廃止しました。
   📷 はアプリ内カメラ(生映像)になり、使えない時も標準アプリへは
   切り替えません(竹弘の指定)。カメラが使えない端末では
   📁 マイファイルから、カメラアプリで撮った写真を選べます。
*/

/*
⚠️⚠️ **今どの曲を開いているかを、ここで覚えておきます(v207)。**

【なぜ currentTrackId を使ってはいけないのか】

『📷 差し替え』を押すとカメラアプリに切り替わり、竹弘が写真を
撮って戻ってくるまでに**何秒もかかります。** その間もノリRunは
鳴り続けているので、**曲が次に繋がっていることがあります。**

そこで currentTrackId を見て保存すると、**撮った写真が「今鳴って
いる別の曲」に付いてしまいます。** 画面には最初に開いた曲の名前が
出ているのに、中身は違う曲に書かれる ―― いちばん気づきにくい
種類の事故です。

だから「パネルを開いた時の曲」をここに控えておき、保存はその曲に
対して行います。
*/
let jacketViewTrackId = null;

/*
⚠️ **まだ保存していない画像を、ここで預かります(v208)。**

撮った(選んだ)直後は、すぐDBへ書かずに**この変数に置いたまま
ジャケット枠に映します。** 竹弘が ✓ を押して初めて保存します。

【なぜ即保存しないのか】

竹弘の当初案は「📷 を押したら『ジャケ写に設定する』『カメラで
撮影する』の2択」でした。その「設定する」という一手間が欲しい
感覚は正しく、**撮った瞬間に上書きされるのは怖い**からです。
ただ、それは押す前ではなく**撮った後**に置く方が自然で、
しかも「今ジャケットが何に設定されているか」に左右されません。

⚠️ 中身は**すでに480pxへ縮小済み**です。確認の段階で原寸を
   抱えておくと、大きな写真でメモリを無駄に使うためです。
*/
let jacketPendingBlob = null;

/*
その画像をどこから持ってきたか("camera" か "myfile")。
確認ボタンの真ん中を「📷 撮り直す」にするか「📁 選び直す」に
するかを決めるためだけに使います。
*/
let jacketPendingSource = "";

/*
⚠️ **この画面が今どのボタンの行を出しているか(v210)。**

    "normal"    🖼️ 📁 📷              ふつう
    "confirm"   ✓/⚠️ 📷 ✕            撮った / 選んだ直後
    "artwork"   [元][自作] ✕          アートワークの選び直し
    "overwrite" 🗑️ ✕ + 赤い注意書き   上書きの最終確認

【なぜ状態を変数で持つのか】

v207では「旗を持たない(データだけで決める)」方針を書きましたが、
あれは**どの画像を見せるか**という"データ"の話です。
こちらは**画面がどの段階にいるか**という別の話で、データからは
決められません(「アートワークの選び直しを開いているか」は、
どこにも書かれていないため)。

⚠️ **代わりに、出す行を決める場所を refreshJacketButtons() の
   1か所だけにしてあります。** あちこちで display を触ると、
   「2つの行が同時に出る」という事故が必ず起きます。
*/
let jacketUiState = "normal";

/*
⚠️ **動いているカメラ(v212)。**

getUserMedia() が返す「映像の流れ」です。**使い終わったら必ず
止めます**(stopLiveCamera)。止め忘れると、画面を閉じても
カメラのランプが点いたままになり、電池を食い続けます。

⚠️ ノリRunは走りながら使うアプリなので、**電池の食い逃げは
   特に困ります。** 止める場所は4つあります:
   撮った時 / ✕ / 画面を閉じた時 / 画面を開き直した時(念のため)。
*/
let jacketCameraStream = null;

/*
⚠️ **今カメラを使いたいかどうか(v212)。**

カメラの許可を聞いている間に竹弘が ✕ を押すことがあります。
その後で許可が下りると、**誰も見ていないのにカメラが動き出します。**
この旗を見て、いらなくなっていたらすぐ止めます。
*/
let jacketCameraWanted = false;

/*
上半分のエリアです。大きさの上限を決めるために、実際の高さを
測るのに使います。

⚠️ js/config.js には上半分そのものを指す変数が無かったので、
   ここで取っています。**#upper-area は検索モードで縮むことが
   あります**(v140)が、その時は曲一覧が上に来ているので
   ジャケットは押せません。だから測る時はいつも通常の高さです。
*/
const jacketUpperAreaEl = document.getElementById("upper-area");

/*
曲一覧の窓枠です(v257)。特大表示の文字とボタンを「1段目の欄まで」に
収めるために、1段目がどこにあるかを測るのに使います(layoutJacketBig)。

⚠️ 名前は jacket で始めています。js/config.js などに同じ名前の const が
   あると、読み込んだ瞬間にエラーになり、このファイルが丸ごと動かなくなるためです。
*/
const jacketListViewportEl = document.getElementById("list-viewport");

/*
⚠️ **元のファイルからの読み直し(v257)の控えです。**

    jacketReload     … 今進んでいる読み直し(1つだけ)。無ければ null。
                        閉じる・開き直すと null か別物になり、進んでいた方は
                        次の一息で「もう要らない」と気づいて自分で止まります
    jacketHdCanvas   … 読み直して作った鮮明な絵(<canvas>)。開いている間だけ持つ
    jacketHdRenderer … その絵の描き手(bitmaprenderer)。手放す時に絵を空にするため
    jacketHdTrackId  … その絵がどの曲のものか

⚠️ 鮮明な絵は数MBあります(1000点 × 1000点 × 4バイト)。閉じたら必ず
   releaseJacketReload() で手放すこと(原寸を持たない竹弘の方針。冒頭の説明)。
*/
let jacketReload     = null;
let jacketHdCanvas   = null;
let jacketHdRenderer = null;
let jacketHdTrackId  = null;


// ==========================================================
// 3. 開く / 閉じる
// ==========================================================
/**
 * 再生中のジャケットを大きく表示します。
 *
 * ⚠️ **v207から、画像が無い曲でも開きます。**
 *    v206までは「画像が無ければ何もしない」でしたが、それだと
 *    **ジャケットが無い曲こそ差し替えられない**という逆さまなことに
 *    なります(竹弘の狙いは「画像がない曲や、お気に入りの曲について、
 *    写真を撮ってジャケを作れる楽しさ」)。
 *    無い曲は、代わりに薄いカメラアイコンを大きく出します。
 */
function openJacketView(){

    if(!jacketPanelEl || !currentTrackId){ return; }

    const track = libraryMap[currentTrackId];

    if(!track){ return; }

    /*
    ⚠️ 開いた時点の曲を控えます。以降この画面での保存は、
       **この曲**に対して行います(上の jacketViewTrackId の解説)。
    */
    jacketViewTrackId = currentTrackId;

    /*
    ⚠️ 前に開いた時の鮮明な絵・読み直しが残っていたら、先に手放します(v257)。
       ふつうは閉じる時に手放していますが、手放す場所が1つでも抜けると
       数MBの絵を抱えたままになるので、開く時にも確かめます(カメラと同じ考え方)。
    */
    releaseJacketReload();

    /*
    ⚠️ 前回の「確認中」を必ず持ち越さないようにします(v208)。
       撮ったまま閉じて別の曲で開くと、前の写真が映ったままに
       なってしまいます。
    */
    clearJacketPending();

    /*
    ⚠️ カメラが動いたままだったら止めます(v212の念のため)。
       ふつうは閉じる時に止まっていますが、止める場所が1つでも
       抜けるとカメラが点いたままになるので、開く時にも確認します。
    */
    stopLiveCamera();

    // ---- 中身(画像 / カメラアイコン)を入れます ----
    renderJacketBig(track);

    // ---- 曲名とアーティスト ----
    // buildTitleText() も js/list-view.js から借ります
    // (タイトルが空の曲ではファイル名を出してくれます)
    jacketBigTitleEl.textContent  = buildTitleText(track);
    jacketBigArtistEl.textContent = track.artist || "";

    // ---- ボタンの押せる / 押せないを決めます ----
    refreshJacketButtons(track);

    /*
    ---- 大きさと置き場所(置き方 A。v257)----

    ⚠️ **画面に出してから測ります。** display:none のままだと、曲名やボタンの
       高さが0として返り、測れないためです。出してから大きさを決めるまでは
       同じ処理の中で続けて行うので、途中の姿が竹弘の目に映ることはありません
       (ブラウザは、処理が一区切りつくまで画面を描き直さない)。
    */
    jacketPanelEl.style.display = "flex";

    const layout = layoutJacketBig();

    // ---- 元のファイルから、鮮明な絵を読み直します(v257。時間をかけてよい)----
    startJacketReload(track,layout.size);

}


/**
 * 特大表示の大きさと置き場所を決めます(置き方 A。v257)。
 *
 * 考え方は「1. 大きさと置き場所の決め方」。開いた直後(画面に出した後)に呼びます。
 *
 * ⚠️ この関数は sandbox/measure-jacket-layout.html が、このファイルから
 *    文字として取り出して、そのまま動かします(本物の計算を測るため)。
 *    中で使ってよいのは、このファイルの const(JACKET_ で始まる定数と
 *    jacket で始まる部品)と applyJacketBigSize / findJacketBigLimitBottom だけです。
 *    ほかのファイルの名前を足す時は、あのページにも用意すること。
 *
 * @return {Object} { size:ジャケの一辺, buttonSize:ボタンの一辺,
 *                    spare:ボタンの下端から1段目の下端までの余り(px)}
 */
function layoutJacketBig(){

    const upperRect = jacketUpperAreaEl.getBoundingClientRect();

    // ① 上半分のカードの短い辺いっぱい(内側に余白をとる)
    let size = Math.floor(
        Math.min(upperRect.width,upperRect.height) - JACKET_BIG_INSET_PX * 2
    );

    // 小さくなりすぎない下限(何が写っているか分からなくなるため)
    size = Math.max(size,JACKET_BIG_MIN_SIZE_PX);

    let buttonSize = applyJacketBigSize(size,upperRect);

    /*
    ② 曲名からボタンまでの高さを、本物で測ります。

    ジャケの下端から「ふつうのボタンの行」の下端までです。開いた直後は
    いつもふつうの状態(🖼️ 📁 📷)なので、この行が出ています。
    ⚠️ ほかの行(確認中・上書きの確認など)もボタンの大きさは同じなので、
       行が入れ替わっても高さは変わりません(c014.html の aspect-ratio)。
    */
    const infoHeight =
        jacketBigButtonsEl.getBoundingClientRect().bottom -
        jacketBigEl.getBoundingClientRect().bottom;

    const limitBottom = findJacketBigLimitBottom();

    const centerY = upperRect.top + upperRect.height / 2;

    /*
    ジャケをカードの真ん中に置いたまま、ボタンの下端がちょうど1段目の下端に
    来る一辺です。

        ボタンの下端 = 真ん中 + 一辺 ÷ 2 + 下の高さ ≦ 1段目の下端
        → 一辺 ≦ (1段目の下端 − 下の高さ − 真ん中)× 2
    */
    const fitSize = Math.floor((limitBottom - infoHeight - centerY) * 2);

    if(fitSize < size){

        size = Math.max(fitSize,JACKET_BIG_MIN_SIZE_PX);

        /*
        ⚠️ ジャケが160pxより小さくなると、ボタンも小さくなります
           ((一辺 − 間隔×2)÷ 3)。その時は下の高さも減るので、
           はみ出すことはありません(余る方へずれる)。
        */
        buttonSize = applyJacketBigSize(size,upperRect);

    }

    const spare = limitBottom - jacketBigButtonsEl.getBoundingClientRect().bottom;

    return { size:size, buttonSize:buttonSize, spare:spare };

}


/**
 * ジャケの一辺を当てはめます(ジャケの枠・ボタンの行・ボタンの大きさ・置き場所)。
 *
 * layoutJacketBig() が、決めた一辺で呼びます。
 *
 * @param  {number}  size      … ジャケの一辺(px。縁取りを含む外側の大きさ)
 * @param  {DOMRect} upperRect … 上半分のカードの位置と大きさ
 * @return {number}  ボタンの一辺(px)
 */
function applyJacketBigSize(size,upperRect){

    /*
    ⚠️ c014.html の #jacket-big は box-sizing:border-box です(v257)。
       ここで入れる一辺は「縁取りを含む外側の大きさ」になり、カードの中に
       収まるかの計算とそのまま合います。
    */
    jacketBigEl.style.width  = size + "px";
    jacketBigEl.style.height = size + "px";

    /*
    ---- 置き場所 ----

    ジャケをカードの真ん中に置きます。#jacket-panel-inner の上の余白で、
    ジャケの上端の高さを決めます(下の曲名・ボタンは、その続きに並ぶ)。

    ⚠️ 左右は、パネルの「真ん中寄せ」(c014.html の #jacket-panel の
       align-items:center)にまかせています。上半分のカードも画面の真ん中に
       あるので(#app の margin:0 auto)、そのまま揃います。
    */
    const top = upperRect.top + (upperRect.height - size) / 2;

    jacketPanelInnerEl.style.marginTop = Math.round(top) + "px";

    /*
    ⚠️⚠️ **ボタン行にも同じ幅を入れます(v209で追加)。**

    竹弘の実機報告(v208):
        「ジャケ幅ではなく、曲名もしくはアーティスト名、ファイル名で
          幅が決まっている。ボタン3つは、ジャケ幅に合わせて欲しい」

    CSSの width:100% は「親の幅」ですが、その親
    (#jacket-panel-inner)は**中でいちばん広い部品に合わせて広がる**
    ので、長い曲名があると親ごと広がり、ボタンもそれに付き合って
    いました。

    → ここでジャケットと**まったく同じ数字**を渡します。
      上で計算した size をそのまま使うので、**2か所で別々に
      計算することはありません**(片方だけ直す事故が起きない)。

    ⚠️ 曲名・アーティスト名の幅は今のままでOK(竹弘の指定)。
       揃えるのはボタンだけです。
    */
    const buttonRows = [
        jacketBigButtonsEl,
        jacketConfirmButtonsEl,
        jacketArtworkButtonsEl,
        jacketOverwriteButtonsEl,
        jacketCameraButtonsEl
    ];

    for(const row of buttonRows){
        if(row){ row.style.width = size + "px"; }
    }

    /*
    ⚠️⚠️ **ボタン1つの幅を「3つ並ぶ時の大きさ」で固定します(v213)。**

    竹弘の指定(2026-09-21):

        「ボタンが3個から2個の画面に遷移した時、ボタンが大きくなって、
          次の画面に遷移した際にボタンのサイズの統一感がなく
          あまり見栄えがよくありません。ジャケット幅で最大ボタン数の
          3ボタンをボタンの最大サイズとして、2ボタンのサイズを
          3ボタンのサイズに合わせてもらえますか」

    【v212までなぜ大きくなっていたか】

    ボタンは flex:1 1 0 で「余りを等分」していました。3つなら1/3ずつ、
    **2つなら1/2ずつ**になるので、行が切り替わるたびに大きさが
    変わっていました。

    → **幅を px で決めて、数を変えても大きさが変わらない**ようにします。

        ボタン1つの幅 = (ジャケット幅 − 間隔×2) ÷ 3

    そして行は中央寄せにするので、2つの時は**画面の芯をはさんで
    左右対称**に並びます(竹弘:「いづれ、設定にて、左利きの人用に
    画面の左右反転も考えたいので、なるべく画面中央を芯に左右に
    均等に配置したい思いあり」)。

    ⚠️ 計算した値はCSS変数として渡します。**同じ数字をCSSにも
       書くと、片方だけ直した時にはみ出します。**
    */
    /*
    ⚠️ 上限(JACKET_BUTTON_MAX_PX)で頭を押さえます(v214)。
       ボタンは**正方形**なので、幅をそのまま使うと高さも同じだけ
       増えてしまい、1段目に収めるためにジャケが小さくなるためです。
    */
    const buttonSize = Math.min(
        Math.floor((size - JACKET_BUTTON_GAP_PX * 2) / 3),
        JACKET_BUTTON_MAX_PX
    );

    jacketPanelEl.style.setProperty(
        "--jacket-btn-size",
        buttonSize + "px"
    );

    jacketPanelEl.style.setProperty(
        "--jacket-btn-gap",
        JACKET_BUTTON_GAP_PX + "px"
    );

    return buttonSize;

}


/**
 * 特大表示の文字とボタンを、どこまで下に置いてよいかを返します(v257)。
 *
 * 竹弘の指定「曲一覧の1段目の欄まで」= 曲一覧の窓枠の上端 + 1行の高さ です。
 *
 * ⚠️ 1段目に今どの曲の行が来ているか(スクロールの位置)とは関係なく、
 *    「1段目の欄」の場所で決めます。行がスクロールの途中で半分見えていても、
 *    欄の場所は変わらないためです。
 *
 * @return {number} 画面の上からの位置(px)
 */
function findJacketBigLimitBottom(){

    if(!jacketListViewportEl){ return window.innerHeight; }

    const viewportRect = jacketListViewportEl.getBoundingClientRect();

    /*
    1行の高さは、本物の行で測ります(c014.html の .music-row)。
    行が無い時・検索で隠れている時(高さ0)は、同じ数字の控えを使います。
    */
    const firstRow  = jacketListViewportEl.querySelector(".music-row");
    const rowHeight = (firstRow && firstRow.offsetHeight > 0)
        ? firstRow.offsetHeight
        : JACKET_BIG_ROW_FALLBACK_PX;

    return viewportRect.top + rowHeight;

}


/**
 * 特大表示の中身(ジャケット画像、または薄いカメラ)を描きます。
 *
 * 開いた時と、差し替えた直後の両方から呼ばれます。
 *
 * @param {Object} track … 表示する曲
 */
function renderJacketBig(track){

    /*
    ⚠️ 毎回作り直します。使い回すと、曲が変わった時や差し替えた時に
       前の画像が残ります。
    */
    jacketBigEl.innerHTML = "";

    /*
    ⚠️ カメラ用の見た目(黒い背景)を必ず外します(v212)。
       残っていると、写真を出しているのに枠が黒いままになります。
    */
    jacketBigEl.classList.remove("jacket-big-live");

    /*
    ---- どの画像を映すか ----

    ① まだ保存していない画像を預かっていれば、**それを優先**します
       (撮った直後の確認中。竹弘が ✓ を押すまでDBには入りません)
    ② それが無ければ getTrackCover()(js/list-view.js)に任せます
       (差し替えがあればそちら、無ければ元のジャケット)
    */
    const cover = jacketPendingBlob || getTrackCover(track);

    if(cover){

        /*
        createJacketImage()(js/list-view.js)を借ります。中で一時URLの
        後始末(onload / onerror で revokeObjectURL)までやってくれるので、
        こちらで覚えておく必要がありません。
        */
        const img = createJacketImage(cover);
        img.className = "jacket-big-img";

        jacketBigEl.appendChild(img);

        jacketBigEl.classList.remove("jacket-big-empty");

        /*
        ⚠️ 読み直した鮮明な絵がすでにあれば、すぐ上に重ねます(v257)。
           確認中・アートワークの選び直しから戻った時などに、ここを通るたびに
           またぼやけた絵へ戻ってしまわないためです。ここではふわっとさせません
           (一度鮮明になった絵なので、パッと戻る方が自然)。
        */
        if(shouldShowJacketHd(track)){ attachJacketHd(false); }

        return;

    }

    /*
    ---- まだジャケットが無い曲 ----

    大きなカメラアイコンを薄く置いて、「ここに作れる」ことを
    見せます。⚠️ 枠(縁取り)はテーマカラーのまま薄くしません
    (竹弘の「海色と暁色の縁取りは踏襲して欲しい」)。
    */
    const mark = document.createElement("span");
    mark.className = "jacket-big-empty-mark";
    mark.textContent = "📷";

    jacketBigEl.appendChild(mark);

    jacketBigEl.classList.add("jacket-big-empty");

}


/**
 * ボタンの見せ方を決めます(v208で3ボタン＋確認行に作り替え)。
 *
 * 画面には**2つの状態**があります。
 *
 *     ふつうの状態   🖼️ 📁 📷        … これから選ぶ
 *     確認中の状態   ✓ 📷/📁 ✕      … 撮った直後。保存する前
 *
 * どちらを出すかは jacketPendingBlob(預かり中の画像)があるかで
 * 決まります。**旗を別に持たない**のがこのアプリの流儀です
 * (旗とデータが食い違うと直しようがなくなるため)。
 *
 * ふつうの状態での「押せる / 押せない」:
 *
 *     曲の状態              🖼️ オリジナル        📁 📷
 *     ------------------   -----------------   -----
 *     元あり・差し替えなし   押せない(今それ)     押せる
 *     元あり・差し替えあり   押せる(元に戻る)     押せる
 *     元なし                押せない(戻る先が無い) 押せる
 *
 * ⚠️ 📁 と 📷 はいつでも押せます。何度やり直しても、元のジャケット
 *    (cover_art)には一切触れません。
 *
 * @param {Object} track … 表示中の曲
 */
function refreshJacketButtons(track){

    if(!jacketBigButtonsEl || !jacketConfirmButtonsEl){ return; }

    /*
    ---- 出す行を1つだけ決めます ----

    ⚠️ **display を触るのはこの4行だけ**にしてあります。
       他の場所から個別に触ると「2つの行が同時に出る」事故が
       必ず起きます。
    */
    setRowVisible(jacketBigButtonsEl,      jacketUiState === "normal");
    setRowVisible(jacketConfirmButtonsEl,  jacketUiState === "confirm");
    setRowVisible(jacketArtworkButtonsEl,  jacketUiState === "artwork");
    setRowVisible(jacketOverwriteButtonsEl,jacketUiState === "overwrite");
    setRowVisible(jacketCameraButtonsEl,   jacketUiState === "camera");

    const hasOriginal = !!(track && track.cover_art);
    const hasCustom   = !!(track && track.cover_art_custom);

    // ---- 撮った / 選んだ直後 ----
    if(jacketUiState === "confirm"){

        /*
        真ん中のボタンは「もう一度やる」です。どこから来たかで
        絵文字と説明を変えます(カメラから来たのに📁が出ると
        「別の物を選ばされる」ように見えるため)。
        */
        if(jacketBtnRetryEl){

            const fromCamera = (jacketPendingSource === "camera");

            jacketBtnRetryEl.textContent = fromCamera ? "📷" : "📁";
            jacketBtnRetryEl.title       = fromCamera ? "撮り直す" : "選び直す";

        }

        /*
        ⚠️ **すでに自作ジャケットがある時は ✓ ではなく ⚠️ にします**
           (v210、竹弘の指定)。自作の置き場所は1つしかないので、
           決定すると**前に作ったものが消えます。**

           押す前から「これは上書きだ」と分かるようにしておき、
           ⚠️ を押した時に最終確認("overwrite"の行)へ進みます。
        */
        if(jacketBtnAcceptEl){

            jacketBtnAcceptEl.textContent = hasCustom ? "⚠️" : "✓";

            jacketBtnAcceptEl.title = hasCustom
                ? "今の自作ジャケットに上書きする"
                : "この写真をジャケットにする";

        }

        hideJacketWarning();

        return;

    }

    // ---- 上書きの最終確認 ----
    if(jacketUiState === "overwrite"){

        /*
        ⚠️ **1行に収まる長さにしてあります(v213、竹弘が短くした文)。**
           v257 から曲名・アーティストの場所に重ねて出すので、場所は動きませんが、
           折り返さない(nowrap)ので、長すぎると画面の左右からはみ出します。
           文を足す時は、小さい画面でも1行に収まるか必ず確かめること
           (sandbox/measure-jacket-layout.html が幅を測ります)。
        */
        showJacketWarning("自作ジャケットを削除し、上書き差替えしますか?");

        return;

    }

    hideJacketWarning();

    // ---- カメラで撮っている最中 ----
    if(jacketUiState === "camera"){

        // 出すものは openLiveCamera() 側が用意するので、ここでは何もしません
        return;

    }

    // ---- アートワークの選び直し ----
    if(jacketUiState === "artwork"){

        renderArtworkChoices(track);

        return;

    }

    // ---- ふつうの状態 ----
    if(!jacketBtnOriginalEl){ return; }

    /*
    ⚠️ 🖼️ が押せるのは **選べる絵が2つある時だけ**(v210)。

       v209までは「元に戻せる時だけ」でしたが、v210で役割が
       「オリジナルに戻す」から「**どちらを使うか選ぶ**」に
       変わりました。1つしか無ければ選びようがないので押せません。

    見た目は c014.html の :disabled のCSS(背景は不透明のまま、
    縁を灰色に、絵文字だけ薄く)が担当します。
    */
    jacketBtnOriginalEl.disabled = !(hasOriginal && hasCustom);

}


/**
 * ボタンの行を出す / 隠すだけの小さな部品です。
 *
 * flex で並べているので、出す時は "flex" に戻す必要があります
 * ("block" にすると横並びが崩れます)。
 */
function setRowVisible(rowEl,visible){

    if(!rowEl){ return; }

    rowEl.style.display = visible ? "flex" : "none";

}

/**
 * 赤い注意書きを出します。
 *
 * ⚠️⚠️ **出す場所は、曲名・アーティストの2行の場所です(v257)。**
 *
 *    竹弘の答え(2026-10-25):上書きの最終確認の赤い文字が2段目に被るなら避けたい
 *    → 確かめている間だけ、曲名・アーティストの2行の場所に出す(のりの案に竹弘が OK)。
 *    置き方 A で文字とボタンを「1段目まで」に収めるため、ボタンの下に
 *    注意書きのための1行(v213〜v256)を空けておく余裕が無くなったためです。
 *
 *    出している間は、2行に .jacket-names-warning を付けて**隠します**
 *    (visibility:hidden。場所はそのまま残る)。注意書きはその真ん中に重ねて
 *    出すので、**出す / 隠すで、ジャケもボタンも1pxも動きません**
 *    (竹弘の指定「表示位置を固定としたい」2026-09-21 は今も守る)。
 *
 *    ⚠️ カメラが使えなかった理由(abortLiveCamera)も、同じ場所に出ます。
 *       ボタンを押してふつうの状態に戻ると(refreshJacketButtons)、消えて
 *       曲名が戻ります。
 */
function showJacketWarning(text){

    if(!jacketWarningEl){ return; }

    jacketWarningEl.textContent = text;

    if(jacketBigNamesEl){
        jacketBigNamesEl.classList.toggle("jacket-names-warning",text !== "");
    }

}

/** 赤い注意書きを消して、曲名・アーティストの2行を戻します。 */
function hideJacketWarning(){

    if(!jacketWarningEl){ return; }

    jacketWarningEl.textContent = "";

    if(jacketBigNamesEl){
        jacketBigNamesEl.classList.remove("jacket-names-warning");
    }

}


/**
 * アートワークの選び直しの中身(最大2つ)を作ります(v210)。
 *
 * 竹弘の指定:
 *     「ノリRunDBにある最大2つジャケ写(オリジナルとそれ以外)の
 *       ボタンを表示してもらい、ボタンのサイズの中で、ジャケ写を表示」
 *
 * ⚠️ 今選ばれている方には .jacket-artwork-on を付けて、内側に
 *    テーマ色の線を出します(枠を太くすると中の画像がガタつくため)。
 *
 * @param {Object} track … 表示中の曲
 */
function renderArtworkChoices(track){

    if(!jacketArtworkButtonsEl){ return; }

    jacketArtworkButtonsEl.innerHTML = "";

    if(!track){ return; }

    // 今どちらが使われているか(getTrackCover と同じ判断)
    const usingOriginal = (track.cover_art_use === "original" && track.cover_art);

    /*
    候補は最大2つです。持っていない方は並べません
    (押せないボタンを置いても選びようがないため)。
    */
    const choices = [
        {blob:track.cover_art,        use:"original", label:"元のジャケット"},
        {blob:track.cover_art_custom, use:"custom",   label:"自分で作ったジャケット"}
    ];

    for(const choice of choices){

        if(!choice.blob){ continue; }

        const button = document.createElement("button");
        button.type  = "button";
        button.title = choice.label;

        /*
        createJacketImage()(js/list-view.js)を借ります。一時URLの
        後始末まで面倒を見てくれるので、こちらで覚える必要がありません。
        */
        const img = createJacketImage(choice.blob);
        img.className = "jacket-artwork-thumb";

        button.appendChild(img);

        // 今使われている方に印を付けます
        const isOn = (choice.use === "original") ? usingOriginal : !usingOriginal;

        if(isOn){ button.classList.add("jacket-artwork-on"); }

        /*
        ⚠️ ここでも stopPropagation が要ります(パネルは
           「どこを押しても閉じる」作りのため)。
        */
        button.addEventListener("click",function(event){
            event.stopPropagation();
            chooseArtwork(choice.use);
        });

        jacketArtworkButtonsEl.appendChild(button);

    }

    /*
    最後に「やめる」を置きます。開いたけれど変えたくない、という
    時に閉じられないと困るためです。
    */
    const closeButton = document.createElement("button");
    closeButton.type        = "button";
    closeButton.title       = "やめる";
    closeButton.textContent = "✕";

    closeButton.addEventListener("click",function(event){
        event.stopPropagation();
        jacketUiState = "normal";
        refreshJacketButtons(getJacketViewTrack());
    });

    jacketArtworkButtonsEl.appendChild(closeButton);

}


/**
 * 預かり中の画像を捨てます(確認をやめる / 画面を開き直す時)。
 */
function clearJacketPending(){

    jacketPendingBlob   = null;
    jacketPendingSource = "";

    /*
    ⚠️ 画面の段階も「ふつう」へ戻します(v210)。預かりを捨てたのに
       確認の行が出たままだと、押しても何も起きないボタンが
       画面に残ります。
    */
    jacketUiState = "normal";

}

/**
 * 大きい表示を閉じます。
 */
function closeJacketView(){

    if(!jacketPanelEl){ return; }

    jacketPanelEl.style.display = "none";

    /*
    ⚠️⚠️ **カメラを必ず止めます(v212)。** ここを忘れると、画面を
       閉じてもカメラのランプが点いたままになり、電池を食い続けます。
       走りながら使うアプリなので、電池の食い逃げは特に困ります。
    */
    stopLiveCamera();

    /*
    ⚠️⚠️ **読み直しを止め、鮮明な絵をすぐ手放します(v257)。**
       数MBある絵なので、閉じた後まで抱えないこと(竹弘の「閉じたらすぐ手放す」)。
       途中まで進んでいた読み直しも、次の一息で自分で止まります。
    */
    releaseJacketReload();

    /*
    画像を捨てておきます。

    閉じている間ずっと持っている必要がないのと、次に開いた時は
    必ず作り直すためです。
    */
    jacketBigEl.innerHTML = "";
    jacketBigEl.classList.remove("jacket-big-empty");

    // 注意書きが出たまま閉じても、次に開いた時に曲名が隠れていないように
    hideJacketWarning();

    /*
    ⚠️ 「どの曲を開いていたか」も忘れます(v207)。

       残したままにすると、閉じた後にカメラから戻ってきた時などに
       **見ていない曲へ書き込んでしまう**恐れがあります。
       保存する側(handleJacketFileChosen)も、この値が無ければ
       何もしないようにしてあります。
    */
    jacketViewTrackId = null;

}


// ==========================================================
// 3-1. 元のファイルから読み直す(v257)
// ==========================================================
/*
竹弘の答え(2026-10-25):

    開いた時だけ、曲のファイルから元のジャケを読み直す(「大賛成」)。
    曲の再生を最優先。最初はぼやけた絵でよく、時間をかけて鮮明になってよい
    (「負担を全く掛けないくらい」)。

【流れ】

    ① 開いた瞬間は DB の絵(getTrackCover)をそのまま出す ← 待たせない
    ② 静かな時だけ、少しずつ進める(findJacketReloadWait が「静かか」を見る)

         読む     … ファイルを開いてタグを読み、絵を取り出す
         調べる   … 絵の大きさ(点の数)だけを調べる
         ほどく   … 画面に出す大きさまで縮めながらほどく(createImageBitmap)

       1つ終わるごとに一息つき(JACKET_RELOAD_STEP_GAP_MS)、その時に
       静かでなくなっていたら、静かになるまで待つ
    ③ ふわっと入れ替える(c014.html の .jacket-big-hd)
    ④ 閉じたらすぐ手放す(releaseJacketReload)

【読み直すのは、元のジャケを出している時だけ】

 どの絵を出すかを決めるのは getTrackCover()(js/list-view.js)の1か所だけです
 (CLAUDE.md「決めるのは1か所」)。ここでは判断を書き直さず、
 「getTrackCover が返したのが cover_art(元のジャケ)か」だけを見ます
 (shouldShowJacketHd)。自作ジャケを出している時は読み直しません
 (自作の大きい絵は ①-2 で DB に持たせる予定)。
 ⚠️ 開いた後に 🖼️ で元のジャケへ切り替えた時は、読み直しません(開いた時だけ。
    閉じて開き直せば読み直します)。

【引き伸ばさない】

 ほどく大きさ = 画面に出す点の数(縁取りの内側 × devicePixelRatio)。ただし
 元の絵の点の数より大きくはしません(元の絵が持っていない細かさは出てこない)。
 元の絵が、今出している DB の絵より大きくない時は、入れ替えても変わらないので
 何もしません。

【なぜ createImageBitmap なのか】

 Chrome は、ファイル(Blob)から絵をほどく(デコードする)仕事を、画面と
 JavaScript を動かす係(メインスレッド)とは別の係で行います。1400×1400 の
 大きい絵でも、接続のタイマーやノリノリアシストの見張りを止めません。
 resize を付けると、ほどいたその場で画面の大きさまで縮めるので、大きい絵を
 抱え続けることもありません(js/metadata.js の shrinkImageBlob は、いったん
 原寸でほどいてから縮める作り。DB に入れる時は1曲ずつなのでそれでよい)。

 ⚠️ タグを読む jsmediatags と、絵を取り出す extractPictureBlob だけは
    メインスレッドで動きます(大きい絵だと数十ms)。だから「静かな時だけ」に
    しています。jsmediatags は、ファイルの中からタグのある所を探して読みます
    (曲の音のデータは読み飛ばす)。
*/

/*
一息つく長さ(ms)。読む・調べる・ほどく の間に、この時間だけほかの仕事
(接続のタイマー・アシストの見張り・画面の描き直し)に順番を譲ります。
*/
const JACKET_RELOAD_STEP_GAP_MS = 60;

/*
静かでない時に、もう一度確かめるまでの間(ms)。
接続の準備や同期スタートは数秒〜数十秒続くので、細かく見ても意味がありません。
*/
const JACKET_RELOAD_RETRY_MS = 1000;


/**
 * 読み直しを始めます(openJacketView が、画面に出した後に呼びます)。
 *
 * ⚠️ ここでは待ちません。読み直しは裏で進み、終わったら絵が入れ替わります。
 *    開く処理を待たせると「押したのに開かない」になるためです。
 *
 * @param {Object} track … 開いた曲
 * @param {number} size  … ジャケの一辺(px。layoutJacketBig が決めた値)
 */
function startJacketReload(track,size){

    if(!track || !track.cover_art || !track.file_handle){ return; }

    if(getTrackCover(track) !== track.cover_art){

        // 【開発用調査ログ】(v257)読み直さなかった理由を、実機で確かめるため
        console.log("特大表示のジャケは読み直しません : 自作ジャケを出しています");

        return;

    }

    const job = {
        trackId   : track.track_id,
        fileName  : track.file_name,
        size      : size,
        startedMs : performance.now(),
        waitMs    : 0,
        waitWhy   : ""
    };

    jacketReload = job;

    runJacketReload(job,track).catch(function(error){

        /*
        失敗しても、DB の絵がそのまま出ているだけです(竹弘が困ることは無い)。
        理由だけ🐛に残します。
        */
        console.error(
            "特大表示のジャケの読み直しに失敗 :",
            job.fileName,
            error && error.name,
            error && error.message
        );

        if(jacketReload === job){ jacketReload = null; }

    });

}

/**
 * 読み直しの本体です。読む → 調べる → ほどく → 入れ替える を、一息ずつ進めます。
 *
 * どの一息でも、閉じた・開き直した(job が jacketReload でなくなった)と
 * 分かったら、そこで黙って止まります。
 *
 * @param {Object} job   … この読み直しの控え(startJacketReload が作る)
 * @param {Object} track … 開いた曲
 */
async function runJacketReload(job,track){

    // ---- 読む ----
    if(!await waitJacketReloadTurn(job)){ return; }

    /*
    ⚠️ 許可は「確かめる」だけで、聞き直しません(requestPermission は使わない)。
       聞き直すと確認の画面が出ることがあり、走っている最中に出ると困るためです。
       今鳴っている曲のファイルなので、ふつうは許可されています。
    */
    const permission = await track.file_handle.queryPermission({mode:"read"});

    if(permission !== "granted"){

        finishJacketReload(job,"ファイルを読む許可がありません");

        return;

    }

    let stepMs = performance.now();

    const file = await track.file_handle.getFile();

    const tags = await readTagsFromFile(file);

    const blob = extractPictureBlob(tags);

    job.readMs = performance.now() - stepMs;

    if(!blob){

        finishJacketReload(job,"ファイルにジャケが入っていません");

        return;

    }

    // ---- 調べる ----
    if(!await waitJacketReloadTurn(job)){ return; }

    const natural = await probeJacketImageSize(blob);

    if(!natural || !natural.width || !natural.height){

        finishJacketReload(job,"ジャケの大きさを調べられませんでした");

        return;

    }

    /*
    ほどく大きさを決めます(冒頭の【引き伸ばさない】)。

    ⚠️ 元の絵が正方形でない時は、真ん中の正方形を切り出します
       (DB に入れる時の shrinkImageBlob と同じ。見え方が揃う)。
    */
    const side   = Math.min(natural.width,natural.height);
    const inner  = job.size - JACKET_BIG_BORDER_PX * 2;
    const target = Math.min(side,Math.round(inner * (window.devicePixelRatio || 1)));

    job.natural = natural;
    job.target  = target;

    const shownSide = getJacketBigShownSide();

    if(target <= shownSide){

        finishJacketReload(job,
            "元の絵(" + natural.width + "×" + natural.height + ")は、今の絵(" +
            shownSide + "点)より細かくないので入れ替えません");

        return;

    }

    // ---- ほどく ----
    if(!await waitJacketReloadTurn(job)){ return; }

    stepMs = performance.now();

    const bitmap = await createImageBitmap(
        blob,
        Math.floor((natural.width  - side) / 2),
        Math.floor((natural.height - side) / 2),
        side,
        side,
        { resizeWidth:target, resizeHeight:target, resizeQuality:"high" }
    );

    job.decodeMs = performance.now() - stepMs;

    // ---- 入れ替える ----
    if(!await waitJacketReloadTurn(job)){

        // 閉じた後にほどき終わった絵は、すぐ手放します
        bitmap.close();

        return;

    }

    makeJacketHd(job,bitmap,target);

    /*
    今の枠に出してよい時だけ、ふわっと重ねます。撮った直後の確認中などで
    出せない時は、控えたまま待ち、ふつうの状態に戻って枠を描き直した時
    (renderJacketBig)に重なります。
    */
    if(shouldShowJacketHd(getJacketViewTrack())){ attachJacketHd(true); }

    finishJacketReload(job,"");

}

/**
 * 一息ついてから、静かになるまで待ちます。
 *
 * @param  {Object} job … この読み直しの控え
 * @return {Promise<boolean>} 続けてよければ true。閉じた・開き直した時は false
 */
async function waitJacketReloadTurn(job){

    await waitJacketMs(JACKET_RELOAD_STEP_GAP_MS);

    for(;;){

        // 閉じた・開き直した → この読み直しはもう要らない
        if(job !== jacketReload){ return false; }

        const why = findJacketReloadWait();

        if(why === ""){ return true; }

        if(job.waitWhy !== why){

            job.waitWhy = why;

            // 【開発用調査ログ】(v257)読み直しが曲の再生を避けて待ったかを、実機で確かめるため
            console.log("特大表示のジャケの読み直しを待ちます : " + why);

        }

        const waitStartMs = performance.now();

        await waitJacketMs(JACKET_RELOAD_RETRY_MS);

        job.waitMs += performance.now() - waitStartMs;

    }

}

/**
 * 今、読み直しを進めてよいか(曲の再生を邪魔しない時か)を確かめます。
 *
 * 進めない時:
 *
 *     ・次の曲へ繋ぐ準備の途中(助走・🎬の待ち。js/connect.js の
 *       connectState / isPreRolling)
 *     ・2枚のデッキが両方鳴っている(助走・曲の重なり。繋いだ後の先行曲も)
 *     ・同期スタートの前後(js/sync.js の syncCountdown = 時刻ボタンから
 *       スタートまで / isSyncWarmingUp() = 先に鳴らしている最中・
 *       スタート直後・再開の合わせ直し)
 *
 * ⚠️ ほかのファイルの名前は typeof で確かめてから使います(js/sync.js の
 *    raiseSyncResume と同じ書き方)。そのファイルが無い所でも止まらないためです。
 *
 * @return {string} 待つ理由(🐛に出すため文字で返す)。進めてよい時は ""
 */
function findJacketReloadWait(){

    if((typeof connectState !== "undefined" && connectState !== null) ||
       (typeof isPreRolling !== "undefined" && isPreRolling === true)){

        return "次の曲へ繋ぐ準備の途中";

    }

    if(!deckAudioA.paused && !deckAudioB.paused){

        return "2つの曲が重なっている";

    }

    if(typeof syncCountdown !== "undefined" && syncCountdown !== null){

        return "同期スタートの前";

    }

    if(typeof isSyncWarmingUp === "function" && isSyncWarmingUp()){

        return "同期スタート・再開の合わせ直しの最中";

    }

    return "";

}

/**
 * 決まった時間だけ待ちます(await で待てる setTimeout)。
 */
function waitJacketMs(ms){

    return new Promise(function(resolve){ setTimeout(resolve,ms); });

}

/**
 * 絵の大きさ(点の数)だけを調べます。
 *
 * <img> に読ませて naturalWidth / naturalHeight を見ます。Chrome は、画面に
 * 出していない <img> の絵を、描く時まで本当にはほどかない(大きさだけ先に
 * 分かる)ので、軽く済みます。
 *
 * @param  {Blob} blob … 絵
 * @return {Promise<{width:number,height:number}|null>} 読めなければ null
 */
function probeJacketImageSize(blob){

    return new Promise(function(resolve){

        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = function(){
            URL.revokeObjectURL(url);
            resolve({ width:img.naturalWidth, height:img.naturalHeight });
        };

        img.onerror = function(){
            URL.revokeObjectURL(url);
            resolve(null);
        };

        img.src = url;

    });

}

/**
 * 今、特大表示に出している DB の絵の点の数(一辺)を返します。
 * まだ読み込めていない時は 0(その時は、元の絵の方が細かいとみなす)。
 */
function getJacketBigShownSide(){

    const img = jacketBigEl.querySelector("img.jacket-big-img");

    if(!img || !img.complete){ return 0; }

    return Math.min(img.naturalWidth,img.naturalHeight);

}

/**
 * ほどいた絵から、鮮明な絵(<canvas>)を作って控えます。
 *
 * ⚠️ bitmaprenderer は、絵を写さずに canvas へ「渡す」だけの描き手です
 *    (写すぶんの時間もメモリもかからない)。使えない古いブラウザでは、
 *    ふつうの描き手(2d)で写してから、ほどいた絵を手放します。
 *
 * @param {Object}      job    … この読み直しの控え
 * @param {ImageBitmap} bitmap … ほどいた絵(target × target)
 * @param {number}      target … 絵の一辺(点)
 */
function makeJacketHd(job,bitmap,target){

    const canvas = document.createElement("canvas");
    canvas.width  = target;
    canvas.height = target;
    canvas.className = "jacket-big-hd";

    const renderer = canvas.getContext("bitmaprenderer");

    if(renderer){

        renderer.transferFromImageBitmap(bitmap);

    }
    else{

        canvas.getContext("2d").drawImage(bitmap,0,0);

        bitmap.close();

    }

    jacketHdCanvas   = canvas;
    jacketHdRenderer = renderer;
    jacketHdTrackId  = job.trackId;

}

/**
 * 鮮明な絵を、今の枠の中に出してよいかを返します。
 *
 * ⚠️ 判断は getTrackCover() にまかせます(冒頭の【読み直すのは…】)。
 *    撮った直後の確認中(預かり中の写真を出している)・カメラの最中は出しません。
 *
 * @param {Object} track … 枠に出している曲
 */
function shouldShowJacketHd(track){

    return !!(
        jacketHdCanvas &&
        track &&
        jacketHdTrackId === track.track_id &&
        !jacketPendingBlob &&
        jacketUiState !== "camera" &&
        getTrackCover(track) === track.cover_art
    );

}

/**
 * 鮮明な絵を、枠の中(DB の絵の上)に重ねます。
 *
 * @param {boolean} fade … true ならふわっと(読み直しが終わった時)、
 *                         false ならすぐ(描き直しで戻す時)
 */
function attachJacketHd(fade){

    if(!jacketHdCanvas){ return; }

    jacketHdCanvas.classList.remove("jacket-big-hd-on");

    jacketBigEl.appendChild(jacketHdCanvas);

    if(fade){

        /*
        いったん「透明」のまま描かせてから、見える印を付けます。
        offsetWidth を読むと、ブラウザはその場で見た目を計算するので、
        その後に印を付けると「透明 → 見える」の移り変わり(transition)が起きます。
        読まずに印を付けると、最初から見えている扱いになり、ふわっとしません。
        */
        void jacketHdCanvas.offsetWidth;

    }

    jacketHdCanvas.classList.add("jacket-big-hd-on");

}

/**
 * 読み直しを終えます(入れ替えた時も、やめた時も)。🐛に1行残します。
 *
 * @param {Object} job … この読み直しの控え
 * @param {string} why … やめた理由。入れ替えた時は ""
 */
function finishJacketReload(job,why){

    if(jacketReload === job){ jacketReload = null; }

    const sec = function(ms){ return ((ms || 0) / 1000).toFixed(2); };

    // 【開発用調査ログ】(v257)読み直しにかかった時間と、走行中にヨレないかを実機で確かめるため
    if(why !== ""){

        console.log("特大表示のジャケは読み直しません : " + why + "(" + job.fileName + ")");

        return;

    }

    console.log(
        "特大表示のジャケを読み直しました : " + job.fileName +
        " / 元の絵 " + job.natural.width + "×" + job.natural.height +
        " → " + job.target + "点で表示" +
        " / " + sec(performance.now() - job.startedMs) + "秒" +
        "(待った " + sec(job.waitMs) +
        "・読む " + sec(job.readMs) +
        "・ほどく " + sec(job.decodeMs) + ")"
    );

}

/**
 * 読み直しを止め、鮮明な絵を手放します(閉じる時・開き直す時)。
 *
 * ⚠️ 進んでいる読み直しは、ここでは止めに行きません。jacketReload を空にすると、
 *    次の一息(waitJacketReloadTurn)で自分で気づいて止まります。
 */
function releaseJacketReload(){

    jacketReload = null;

    if(jacketHdCanvas){

        /*
        絵のメモリをすぐ返します。
            bitmaprenderer … 空の絵を渡す(transferFromImageBitmap(null))
            2d             … 大きさを0にする(中の絵が捨てられる)
        */
        if(jacketHdRenderer){ jacketHdRenderer.transferFromImageBitmap(null); }

        jacketHdCanvas.width  = 0;
        jacketHdCanvas.height = 0;

        jacketHdCanvas.remove();

    }

    jacketHdCanvas   = null;
    jacketHdRenderer = null;
    jacketHdTrackId  = null;

}


// ==========================================================
// 3-2. ジャケットの差し替え(v207)
// ==========================================================
/**
 * この画面が対象にしている曲を返します。
 *
 * ⚠️ currentTrackId ではなく jacketViewTrackId を見ます
 *    (理由はファイル上部の解説)。
 */
function getJacketViewTrack(){

    if(!jacketViewTrackId){ return null; }

    return libraryMap[jacketViewTrackId] || null;

}

/**
 * 差し替え / 元に戻す のあと、ジャケットを出している場所を全部
 * 描き直します。
 *
 * ⚠️ **ジャケットを映している場所は4つあります。**
 *    1つでも忘れると、そこだけ古い絵が残ります。
 *
 *        ① 特大表示(この画面そのもの)
 *        ② 曲一覧の行
 *        ③ 上半分の再生中表示
 *        ④ ロック画面(Media Session)
 *
 * ⚠️ ③と④は「今鳴っている曲」を映す場所なので、**差し替えた曲が
 *    今鳴っている時だけ**描き直します。裏で別の曲を編集していた
 *    場合に、鳴っている曲の表示を書き換えてしまわないためです。
 *
 * @param {Object} track … 差し替えた曲
 */
function refreshCoverEverywhere(track){

    // ① 特大表示
    renderJacketBig(track);
    refreshJacketButtons(track);

    // ② 曲一覧の行(js/list-view.js)
    refreshRow(track.track_id);

    // ③④ 今鳴っている曲だった時だけ
    if(track.track_id === currentTrackId){

        // 上半分のジャケットだけを描き直します(js/upper-area.js)
        refreshNowPlayingJacket(track);

        // ロック画面(js/media-session.js)
        updateMediaSessionMetadata(track);

    }

}

/**
 * 『📁 マイファイル』が押された時の処理です。
 *
 * 見えないファイル選択(#jacket-myfile-input)を代わりに押します。
 * capture が付いていないので、Androidの選択画面から写真フォルダを
 * たどって選べます。
 */
function startJacketFromMyFile(event){

    /*
    ⚠️ **この押下をパネルへ伝えません。**
       パネルは「どこを押しても閉じる」作りなので、これを書かないと
       ボタンを押した瞬間に画面が閉じます。
    */
    event.stopPropagation();

    jacketPendingSource = "myfile";

    if(jacketMyFileInputEl){ jacketMyFileInputEl.click(); }

}

/**
 * 『📷 カメラ』が押された時の処理です(v212でアプリ内カメラに)。
 *
 * 竹弘の希望:
 *     「ジャケ写の表示範囲の所に外カメラの撮影中映像をリアルで表示し
 *       (解像度はジャケ画像と同じ)、ジャケットをキャプチャしたい」
 *
 * ⚠️ v208〜v211はスマホ標準のカメラアプリを呼んでいました。
 *    取り込んだ後の流れ(確認 → ✓ で保存)は同じものを使うので、
 *    **差し替えたのはこの関数と、下のカメラ一式だけ**です。
 */
function startJacketFromCamera(event){

    event.stopPropagation();

    jacketPendingSource = "camera";

    openLiveCamera();

}


// ==========================================================
// 3-3. アプリ内カメラ(v212)
// ==========================================================
/**
 * ジャケット枠に、外カメラの映像を流し始めます。
 *
 * ⚠️⚠️ **必ず逃げ道を用意してあります。** カメラが使えない場合
 *    (許可されなかった / カメラが無い / 安全な接続でない)は、
 *    **スマホ標準のカメラアプリに切り替えます。**
 *    走っている最中に「押しても何も起きない」が一番困るためです
 *    (v203で学んだ「待つ処理には必ず時間切れを用意する」と同じ考え方)。
 */
async function openLiveCamera(){

    const track = getJacketViewTrack();

    if(!track){ return; }

    jacketCameraWanted = true;
    jacketUiState      = "camera";

    // 先に画面を切り替えて、「押したのに無反応」を無くします
    showLiveMessage("カメラを準備しています…");
    refreshJacketButtons(track);

    /*
    navigator.mediaDevices は、**安全な接続(https)でないと存在しません。**
    GitHub Pages は https なので本番では使えますが、手元のファイルを
    直接開いた時などに落ちないよう確かめておきます。
    */
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){

        console.log("この環境ではアプリ内カメラを使えません");

        abortLiveCamera("この端末ではカメラを使えません");

        return;

    }

    try{

        /*
        ---- カメラを借ります ----

        facingMode:"environment" は**外カメラ**(画面と反対側)です。
        ジャケットは目の前のものを撮るので外カメラが自然です。

        ⚠️ **ideal にしています。** exact にすると、外カメラが無い端末で
           エラーになって何も映りません。ideal なら「できれば外、
           無ければ内」と譲ってくれます。

        ⚠️⚠️ **audio:false を必ず書きます。** 書かないつもりでも、
           マイクを一緒に借りてしまうと**音楽の再生が止まる恐れ**が
           あります。ノリRunは走行中に鳴り続けることが最優先なので、
           映像だけを借ります。
        */
        const stream = await navigator.mediaDevices.getUserMedia({
            video:{ facingMode:{ ideal:"environment" } },
            audio:false
        });

        /*
        ⚠️ 許可を待っている間に ✕ が押されているかもしれません。
           その場合は**すぐ返します**(誰も見ていないのにカメラが
           動き続けるのを防ぐため)。
        */
        if(!jacketCameraWanted){

            stopStreamTracks(stream);
            return;

        }

        jacketCameraStream = stream;

        showLiveVideo(stream);

    }
    catch(error){

        console.log("アプリ内カメラを開けませんでした :",error.name);

        /*
        ⚠️ **断られた理由で言葉を変えます。**

            NotAllowedError … 竹弘が「許可しない」を選んだ
                              (または以前に拒否したまま覚えられている)
            それ以外        … カメラが無い / 他のアプリが使っている等

        「許可されていません」と出しておけば、Chromeの設定で
        許可を出し直せばよい、と気づけます。
        */
        const denied = (error && error.name === "NotAllowedError");

        abortLiveCamera(
            denied
                ? "カメラの使用が許可されていません"
                : "カメラを使えませんでした"
        );

    }

}

/**
 * アプリ内カメラが使えない時に、元の画面へ戻します(v213で変更)。
 *
 * ⚠️ **v212はスマホ標準のカメラアプリに切り替えていました。**
 *    竹弘の指定(2026-09-21):
 *
 *        「カメラの許可を拒否したら標準のカメラアプリに切り替わるの
 *          ではなく、次の画面に進まない。元の画面に戻るにしたい」
 *
 *    勝手に別のアプリが立ち上がると「何が起きたのか分からない」と
 *    なるためです。拒否したなら、何も起きずに戻るのが素直です。
 *
 * ⚠️ **ただし「押しても無反応」にはしません。** 注意書きの行
 *    (いつも場所を空けてある)に理由を出します。無言で戻ると、
 *    壊れたのか拒否されたのか分かりません。
 *
 * ⚠️ カメラが使えなくても**📁 マイファイルは使えます。** 標準の
 *    カメラアプリで撮った写真を、そこから選べば同じことができます。
 *
 * @param {String} reasonText … 注意書きに出す理由(空なら出さない)
 */
function abortLiveCamera(reasonText){

    stopLiveCamera();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    renderJacketBig(track);
    refreshJacketButtons(track);

    /*
    ⚠️ **refreshJacketButtons の後に出します。** あの関数は
       ふつうの状態に戻る時に注意書きを消すので、先に出すと
       すぐ消されてしまいます。
    */
    if(reasonText){ showJacketWarning(reasonText); }

}

/**
 * ジャケット枠に文字だけを出します(準備中の案内など)。
 */
function showLiveMessage(text){

    if(!jacketBigEl){ return; }

    jacketBigEl.innerHTML = "";

    jacketBigEl.classList.remove("jacket-big-empty");
    jacketBigEl.classList.add("jacket-big-live");

    const message = document.createElement("div");
    message.className   = "jacket-live-message";
    message.textContent = text;

    jacketBigEl.appendChild(message);

}

/**
 * ジャケット枠に、カメラの映像を流します。
 */
function showLiveVideo(stream){

    if(!jacketBigEl){ return; }

    jacketBigEl.innerHTML = "";

    jacketBigEl.classList.remove("jacket-big-empty");
    jacketBigEl.classList.add("jacket-big-live");

    const video = document.createElement("video");
    video.className = "jacket-live-video";

    /*
    ⚠️ **playsInline は必須です。** これが無いと、Androidや
       iPhoneで映像が**画面いっぱいに乗っ取られ**、ジャケット枠の
       中に収まりません。

    ⚠️ muted も付けます。音は借りていない(audio:false)ので
       鳴るものはありませんが、付けておかないと自動再生が
       ブラウザに止められることがあります。
    */
    video.playsInline = true;
    video.muted       = true;
    video.autoplay    = true;

    video.srcObject = stream;

    jacketBigEl.appendChild(video);

    /*
    play() は約束(Promise)を返し、失敗することがあります。
    ここで落としてもカメラが止まらず残るだけなので、握りつぶさずに
    記録だけしておきます。
    */
    const playPromise = video.play();

    if(playPromise && typeof playPromise.catch === "function"){

        playPromise.catch(function(error){
            console.log("カメラ映像の再生に失敗 :",error.name);
        });

    }

}

/**
 * 映像の流れを止めます(カメラのランプを消すための後始末)。
 */
function stopStreamTracks(stream){

    if(!stream || typeof stream.getTracks !== "function"){ return; }

    for(const track of stream.getTracks()){
        track.stop();
    }

}

/**
 * アプリ内カメラを完全に止めます。
 *
 * ⚠️ **呼ぶ場所は5つ**:撮った時 / ✕ / 画面を閉じた時 /
 *    画面を開き直した時(念のため)/ 標準カメラへ逃がす時。
 *    どれか1つでも抜けると、カメラが点いたままになります。
 */
function stopLiveCamera(){

    jacketCameraWanted = false;

    if(jacketCameraStream){

        stopStreamTracks(jacketCameraStream);
        jacketCameraStream = null;

    }

}

/**
 * 『✕』(カメラ中)が押された時の処理です。
 */
function cancelLiveCamera(event){

    event.stopPropagation();

    stopLiveCamera();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    renderJacketBig(track);
    refreshJacketButtons(track);

}

/**
 * 『📸』が押された時の処理です。今映っている瞬間を切り取ります。
 *
 * ⚠️⚠️ **切り取る大きさと画質は、他の取り込みとまったく同じ定数**
 *    (COVER_ART_SIZE / COVER_ART_QUALITY)を使います。竹弘の指定
 *    「1曲あたりのファイルサイズが大きくならないように、取込時に
 *      解像度を今のジャケ写サイズに解像度変更は絶対して欲しい」。
 *
 * ⚠️ shrinkImageBlob()(js/metadata.js)を通していないのは、あちらが
 *    **ファイル(Blob)を受け取る**作りで、映像のひとコマは渡せない
 *    ためです。**やっていること(中央を正方形に切り取って縮小)は
 *    同じ**で、数字も同じ定数を見ています。いったんJPEGにしてから
 *    もう一度縮めると、二重に画質が落ちるので直接描いています。
 */
function shootFromLiveCamera(event){

    event.stopPropagation();

    const track = getJacketViewTrack();
    const video = jacketBigEl ? jacketBigEl.querySelector("video") : null;

    if(!track || !video){ return; }

    /*
    videoWidth は「映像の本当の大きさ」です。カメラが動き出す前は
    0 なので、その時は何もしません(0で切り取ると真っ黒になります)。
    */
    if(!video.videoWidth || !video.videoHeight){

        console.log("まだカメラの映像が来ていません");
        return;

    }

    try{

        const canvas = document.createElement("canvas");
        canvas.width  = COVER_ART_SIZE;
        canvas.height = COVER_ART_SIZE;

        const context = canvas.getContext("2d");

        /*
        ---- 中央を正方形に切り取ります ----

        画面では object-fit:cover で「中央の正方形」だけが見えて
        いるので、**同じ場所を切り出せば見たまま**が保存されます。
        */
        const side = Math.min(video.videoWidth,video.videoHeight);
        const sourceX = (video.videoWidth  - side) / 2;
        const sourceY = (video.videoHeight - side) / 2;

        context.drawImage(
            video,
            sourceX,sourceY,side,side,
            0,0,COVER_ART_SIZE,COVER_ART_SIZE
        );

        // 撮ったのでカメラは止めます(ランプを消す)
        stopLiveCamera();

        canvas.toBlob(function(blob){

            if(!blob){
                console.error("撮影に失敗しました");
                cancelLiveCamera({stopPropagation:function(){}});
                return;
            }

            // ---- ここから先は 📁 と同じ流れです ----
            jacketPendingBlob   = blob;
            jacketPendingSource = "camera";
            jacketUiState       = "confirm";

            renderJacketBig(track);
            refreshJacketButtons(track);

            console.log(
                "カメラで撮りました :",
                track.file_name,
                Math.round(blob.size / 1024) + "KB",
                "(まだ保存していません)"
            );

        },"image/jpeg",COVER_ART_QUALITY);

    }
    catch(error){

        console.error("撮影に失敗 :",error.name,error.message);

        cancelLiveCamera({stopPropagation:function(){}});

    }

}

/**
 * 『もう一度』(確認中の真ん中のボタン)が押された時の処理です。
 *
 * 来た道と同じ方へ戻します。
 */
function retryJacketSource(event){

    event.stopPropagation();

    if(jacketPendingSource === "camera"){

        /*
        ⚠️ v212から、カメラは**アプリ内の生映像**に戻します
           (標準のカメラアプリではありません)。撮り直しのたびに
           別の撮り方になると、竹弘が戸惑うためです。
        */
        openLiveCamera();

        return;

    }

    if(jacketMyFileInputEl){ jacketMyFileInputEl.click(); }

}

/**
 * 『✕ やめる』が押された時の処理です。
 *
 * 預かっていた画像を捨てて、元の表示に戻します。
 * **DBには何も書いていない**ので、捨てるだけで元通りです。
 */
function cancelJacketPending(event){

    event.stopPropagation();

    clearJacketPending();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    if(!track){ return; }

    renderJacketBig(track);
    refreshJacketButtons(track);

}

/**
 * 確認中の ✓ / ⚠️ が押された時の入口です(v210)。
 *
 * すでに自作ジャケットがある(＝上書きになる)なら、**もう一段だけ**
 * 確認をはさみます。無ければそのまま保存します。
 *
 * ⚠️ ブラウザ標準の confirm() は使いません。押されるまでJavaScriptが
 *    止まり、走行中だと曲の接続やノリノリアシストの予約まで
 *    巻き添えで止まるためです(js/queue.js の解説、v110の判断)。
 */
function acceptJacketPending(event){

    event.stopPropagation();

    const track = getJacketViewTrack();

    if(!track || !jacketPendingBlob){ return; }

    if(track.cover_art_custom){

        // 上書きになるので、赤い注意書きを出して1回だけ確認します
        jacketUiState = "overwrite";

        refreshJacketButtons(track);

        return;

    }

    applyJacketPending();

}

/**
 * 上書き確認の『✕ やめる』です。撮った写真は捨てずに、
 * 1つ前(確認中)へ戻します。
 */
function cancelJacketOverwrite(event){

    event.stopPropagation();

    jacketUiState = "confirm";

    refreshJacketButtons(getJacketViewTrack());

}

/**
 * 上書き確認の『🗑️ 上書きする』です。
 */
function confirmJacketOverwrite(event){

    event.stopPropagation();

    applyJacketPending();

}

/**
 * 写真が選ばれた(または撮られた)時の処理です。
 *
 * ⚠️ **ここではまだDBに書きません。** 480pxに縮小して預かり、
 *    ジャケット枠に映して竹弘に見てもらいます。保存するのは
 *    ✓ が押された時(applyJacketPending)です。
 */
async function handleJacketFileChosen(event){

    const file = event.target.files && event.target.files[0];

    /*
    ⚠️ **選んだ内容を必ず空に戻します。**
       同じ写真をもう一度選んだ時、値が残っていると「変わっていない」
       と判断されて change が起きず、**2回目から反応しなくなります。**
    */
    event.target.value = "";

    if(!file){ return; }

    const track = getJacketViewTrack();

    if(!track){
        console.error("ジャケット取り込み中止 : 対象の曲が分かりません");
        return;
    }

    try{

        /*
        ---- 480px角のJPEGに縮小します ----

        shrinkImageBlob() は js/metadata.js の関数で、**埋め込み
        ジャケットを取り込む時とまったく同じもの**です。中央を正方形に
        切り取ってから縮小するので、4:3のスマホ写真でも歪みません。

        ⚠️ **同じ関数・同じ定数を通すことに意味があります。**
           竹弘の指定「1曲あたりのファイルサイズが大きくならないように、
           取込時に解像度を今のジャケ写サイズに解像度変更は絶対して
           取り込んで欲しい」に対して、ここに別の数字を書くと、将来
           COVER_ART_SIZE を変えた時に**ここだけ古いサイズのまま**
           残ります。

        スマホの写真は4000×3000(1200万画素)ほどありますが、
        480px角にすると約1/26になり、他のジャケットと同じ
        数十KBに収まります。

        ⚠️ **縮小は「確認の前」にやります。** 後回しにすると、
           確認している間ずっと1200万画素を抱えることになります。
        */
        const blob = await shrinkImageBlob(
            file,
            COVER_ART_SIZE,
            COVER_ART_QUALITY
        );

        if(!blob){
            console.error("ジャケット取り込み中止 : 画像を読めませんでした");
            return;
        }

        // ---- まだ保存せず、預かって映します ----
        jacketPendingBlob = blob;

        jacketUiState = "confirm";

        renderJacketBig(track);
        refreshJacketButtons(track);

        console.log(
            "ジャケット候補を取り込みました :",
            track.file_name,
            Math.round(blob.size / 1024) + "KB",
            "(まだ保存していません)"
        );

    }
    catch(error){

        console.error(
            "ジャケット取り込み失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 預かっていた画像を、はじめてDBへ保存します。
 *
 * ⚠️ ボタンから直接は呼びません。必ず acceptJacketPending()
 *    (上書きになるかを見る係)か、上書き確認の 🗑️ から呼ばれます。
 */
async function applyJacketPending(){

    const track = getJacketViewTrack();

    if(!track || !jacketPendingBlob){ return; }

    const blob = jacketPendingBlob;

    try{

        /*
        ⚠️⚠️ **cover_art(元のジャケット)には一切触りません。**
           竹弘の指定「もともとあるジャケ写は上書きしない」。
           差し替えは cover_art_custom という別の場所に入れるので、
           何度撮り直しても元の絵は無傷で残ります。

        ⚠️ 一方 cover_art_custom は**1つしか持ちません。** だから
           ここへ来る前に上書き確認をはさんでいます(v210)。
        */
        track.cover_art_custom = blob;

        /*
        ⚠️ 作ったばかりの絵を見せないと意味がないので、旗も
           「自作を使う」に倒します(v210)。元のジャケットを見ている
           最中に撮った場合でも、撮った直後はそれが出ます。
        */
        track.cover_art_use = "custom";

        await idbPut(STORE_MUSIC,track);

        // 保存できたので、預かりは終わりです
        clearJacketPending();

        jacketUiState = "normal";

        refreshCoverEverywhere(track);

        console.log(
            "ジャケットを差し替えました :",
            track.file_name,
            Math.round(blob.size / 1024) + "KB"
        );

    }
    catch(error){

        console.error(
            "ジャケットの保存に失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 🖼️ 『アートワーク』が押された時の処理です(v210で役割を変更)。
 *
 * ⚠️ **v209までは「オリジナルに戻す(＝自作を削除する)」でした。**
 *    竹弘の指摘「オリジナルに戻すとカメラ写真を破棄してしまう」を
 *    受けて、**消さずに選び直す**形に変えました。
 *
 * ここでは選び直しの行を開くだけで、DBには何も書きません。
 */
function openArtworkChoices(event){

    // ⚠️ パネルが閉じないように
    event.stopPropagation();

    jacketUiState = "artwork";

    refreshJacketButtons(getJacketViewTrack());

}

/**
 * アートワークの候補が選ばれた時の処理です(v210)。
 *
 * ⚠️⚠️ **どちらの画像も消しません。** 「どちらを使うか」の旗
 *    (cover_art_use)を書き換えるだけです。だから何度でも
 *    行ったり来たりできます ―― これが竹弘の求めていた
 *    「オリジナルに戻した後、さらに前回の設定に簡単に戻せる」です。
 *
 * @param {String} use … "original" か "custom"
 */
async function chooseArtwork(use){

    const track = getJacketViewTrack();

    if(!track){ return; }

    try{

        track.cover_art_use = use;

        await idbPut(STORE_MUSIC,track);

        jacketUiState = "normal";

        refreshCoverEverywhere(track);

        console.log(
            "ジャケットを切り替えました :",
            track.file_name,
            use === "original" ? "元のジャケット" : "自分で作ったジャケット"
        );

    }
    catch(error){

        console.error(
            "ジャケットの切り替えに失敗 :",
            error.name,
            error.message
        );

    }

}


// ==========================================================
// 4. 受け口
// ==========================================================
/*
⚠️ **上半分の枠(#np-jacket)に、ここで直接タップを付けます。**

js/upper-area.js は曲が変わるたびに枠の**中身**(innerHTML)を
入れ替えますが、**枠そのものは作り直しません。** だから起動時に
1回付けるだけで、どの曲でも効きます。

こうすることで、**完成している js/upper-area.js を1文字も
書き換えずに済みます**(デグレ防止のいちばん確実な形)。
*/
if(npJacketEl){

    npJacketEl.addEventListener("click",openJacketView);

}

/*
竹弘の指定:「どこをタップしても閉じる」。

パネル全体で受けているので、画像の上でも余白でも閉じます。

⚠️⚠️ **この作りのせいで、パネルの中に「押せるもの」を足す時は
   必ず stopPropagation() が要ります**(押下がここまで上がってきて
   画面が閉じてしまうため)。v207で足したボタン2つは、それぞれの
   処理の先頭で止めてあります。**次に何か足す人も忘れないこと。**
*/
if(jacketPanelEl){

    jacketPanelEl.addEventListener("click",closeJacketView);

}

/*
ジャケット差し替えの受け口(v207で新設、v208で3ボタン＋確認に)。

⚠️ **どのボタンの処理も先頭で stopPropagation() を呼んでいます。**
   1つでも忘れると、そのボタンを押した瞬間に画面が閉じます。
*/
if(jacketBtnOriginalEl){
    jacketBtnOriginalEl.addEventListener("click",openArtworkChoices);
}

if(jacketBtnMyFileEl){
    jacketBtnMyFileEl.addEventListener("click",startJacketFromMyFile);
}

if(jacketBtnCameraEl){
    jacketBtnCameraEl.addEventListener("click",startJacketFromCamera);
}

// ---- 確認中の3つ ----
if(jacketBtnAcceptEl){
    jacketBtnAcceptEl.addEventListener("click",acceptJacketPending);
}

if(jacketBtnRetryEl){
    jacketBtnRetryEl.addEventListener("click",retryJacketSource);
}

if(jacketBtnCancelEl){
    jacketBtnCancelEl.addEventListener("click",cancelJacketPending);
}

// ---- アプリ内カメラ(v212) ----
if(jacketBtnShootEl){
    jacketBtnShootEl.addEventListener("click",shootFromLiveCamera);
}

if(jacketBtnCameraCancelEl){
    jacketBtnCameraCancelEl.addEventListener("click",cancelLiveCamera);
}

// ---- 上書きの確認(v210) ----
if(jacketBtnOverwriteEl){
    jacketBtnOverwriteEl.addEventListener("click",confirmJacketOverwrite);
}

if(jacketBtnOverwriteCancelEl){
    jacketBtnOverwriteCancelEl.addEventListener("click",cancelJacketOverwrite);
}

/*
⚠️ アートワークの選び直しのボタンは**その都度作る**ので、
   受け口は renderArtworkChoices() の中で付けています
   (どの画像を持っているかが曲ごとに違うため)。
*/

/*
見えないファイル選択の受け口。

"change" は「選んだ内容が変わった」時に起きる合図です。
カメラで撮った直後も、写真フォルダから選んだ直後も、ここへ来ます。
**2つとも同じ処理**へ繋ぎます(受け取った後にやることは同じで、
違うのは「どこから来たか」だけ。それは jacketPendingSource が
覚えています)。

⚠️ カメラを使っている間、ノリRunは裏に回ります。**音は鳴り続けます**
   (2デッキ構造で音が途切れないため)が、戻ってくるまでに曲が次へ
   繋がっていることがあります。だから保存先は currentTrackId ではなく
   jacketViewTrackId です(ファイル上部の解説)。
*/
if(jacketMyFileInputEl){
    jacketMyFileInputEl.addEventListener("change",handleJacketFileChosen);
}

/*
⚠️ v213で、カメラ用のファイル入力への受け口は無くなりました
   (📷 はアプリ内カメラで完結するため)。
*/
