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
   【⚠️ 画質について ―― この版の本当の目的】

   DBに入っているジャケットは **96px角** です(js/metadata.js の
   COVER_MAX_SIZE)。曲一覧の44px角と上半分の表示には十分ですが、
   大きく映すと引き伸ばすことになります。

   原寸を保存していないのは「1曲500KB〜1MBで、数百曲だとDBが
   数百MBに膨れる」という竹弘の判断(2026-08-08)によるものです。

   **この版は、その96pxをそのまま拡大して「実際どのくらい粗いか」を
   竹弘の目で確かめるためのものです。** 粗くて気になるようなら、
   次のどちらかを足します:

       (b) 開く時だけ元ファイルから読み直す … 最高画質。開くのに
           一瞬待つ。⚠️ 走行中だと音がヨレる恐れ
       (c) 保存サイズを上げる(96→320px等) … 369曲の取り直しと
           DBの増加が要る

   ⚠️ **先に(c)をやってから「やっぱり今のままで十分だった」となると、
      369曲ぶんの時間とDB容量が無駄になります。** だから先に見ます。
   ========================================================== */


// ==========================================================
// 1. 大きさの決め方
// ==========================================================
/*
今のジャケットの何倍に拡大するか(竹弘の指定、2026-09-20)。

    「サイズは、上半分で再生中表示しているジャケサイズの4倍で
      見てみたい」

⚠️ **一辺を4倍**にします(面積ではありません)。上半分のジャケットは
   エリア3〜4の2マスぶんの正方形で、端末によって実際の大きさが
   変わります。だから**決め打ちのピクセル数ではなく、その場で
   測って4倍**にします(getBoundingClientRect)。
*/
const JACKET_BIG_SCALE = 4;

/*
上半分の高さに対する、いちばん大きくできる割合です。

竹弘の指定は「表示エリアは上半分のエリア内」。4倍がそのまま
上半分に収まらない端末(画面の低い機種など)では、はみ出さない
ようにここで頭を押さえます。

0.72(72%)にしているのは、**残りを曲名とアーティストの2行に
使う**ためです。
*/
const JACKET_BIG_MAX_UPPER_RATIO = 0.72;

/*
画面の幅に対する上限です。

縦に長い端末では「上半分の72%」がそのまま横幅を超えることが
あります。正方形なので、**縦と横の両方で頭を押さえないと**
左右がはみ出します。
*/
const JACKET_BIG_MAX_WIDTH_RATIO = 0.86;


// ==========================================================
// 2. 画面の部品
// ==========================================================
const jacketPanelEl      = document.getElementById("jacket-panel");
const jacketBigEl        = document.getElementById("jacket-big");
const jacketBigTitleEl   = document.getElementById("jacket-big-title");
const jacketBigArtistEl  = document.getElementById("jacket-big-artist");

/*
上半分のエリアです。大きさの上限を決めるために、実際の高さを
測るのに使います。

⚠️ js/config.js には上半分そのものを指す変数が無かったので、
   ここで取っています。**#upper-area は検索モードで縮むことが
   あります**(v140)が、その時は曲一覧が上に来ているので
   ジャケットは押せません。だから測る時はいつも通常の高さです。
*/
const jacketUpperAreaEl = document.getElementById("upper-area");


// ==========================================================
// 3. 開く / 閉じる
// ==========================================================
/**
 * 再生中のジャケットを大きく表示します。
 *
 * ⚠️ 画像が無い曲では、そもそも上半分の枠が display:none なので
 *    タップできません(v91の作り)。ここへは来ませんが、
 *    念のため中でも確かめています。
 */
function openJacketView(){

    if(!jacketPanelEl || !currentTrackId){ return; }

    const track = libraryMap[currentTrackId];

    // 画像が無ければ、何もしません
    if(!track || !track.cover_art){ return; }

    /*
    ---- 大きさを決めます ----

    今の枠を測って4倍にし、上半分の高さと画面の幅で頭を押さえます。

    ⚠️ **測るのは height です(width ではありません)。**
       この枠は align-self:stretch で「親の高さいっぱいの正方形」に
       なる作りなので(c014.html の .ua-jacket)、**高さが本物の
       大きさ**です。幅は中身によって変わることがあります。
    */
    const nowRect = npJacketEl.getBoundingClientRect();

    let size = nowRect.height * JACKET_BIG_SCALE;

    if(jacketUpperAreaEl){

        const upperRect = jacketUpperAreaEl.getBoundingClientRect();

        size = Math.min(size,upperRect.height * JACKET_BIG_MAX_UPPER_RATIO);

    }

    size = Math.min(size,window.innerWidth * JACKET_BIG_MAX_WIDTH_RATIO);

    jacketBigEl.style.width  = size + "px";
    jacketBigEl.style.height = size + "px";

    /*
    ---- 画像を作ります ----

    createJacketImage()(js/list-view.js)を借ります。中で一時URLの
    後始末(onload / onerror で revokeObjectURL)までやってくれるので、
    こちらで覚えておく必要がありません。

    ⚠️ 毎回作り直します。使い回すと、曲が変わった時に前の画像が
       残ります。
    */
    jacketBigEl.innerHTML = "";

    const img = createJacketImage(track.cover_art);
    img.className = "jacket-big-img";

    jacketBigEl.appendChild(img);

    // ---- 曲名とアーティスト ----
    // buildTitleText() も js/list-view.js から借ります
    // (タイトルが空の曲ではファイル名を出してくれます)
    jacketBigTitleEl.textContent  = buildTitleText(track);
    jacketBigArtistEl.textContent = track.artist || "";

    jacketPanelEl.style.display = "flex";

}

/**
 * 大きい表示を閉じます。
 */
function closeJacketView(){

    if(!jacketPanelEl){ return; }

    jacketPanelEl.style.display = "none";

    /*
    画像を捨てておきます。

    閉じている間ずっと持っている必要がないのと、次に開いた時は
    必ず作り直すためです。
    */
    jacketBigEl.innerHTML = "";

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
*/
if(jacketPanelEl){

    jacketPanelEl.addEventListener("click",closeJacketView);

}
