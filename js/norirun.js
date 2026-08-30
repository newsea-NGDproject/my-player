/* ============================================================
   🕺ノリノリRun再生モード

   ノリRunの本題です。設定したマイピッチで複数の曲を繋ぎながら
   鳴らし続け、**曲が変わってもテンポを変えない**モード。

   【なぜこのモードが要るのか(竹弘の言葉、2026-08-30)】

       ランナーが曲と曲の間でノッて走っていたら曲のテンポが変わり、
       コケてしまう。これがないプレイヤーです。

   走っている人にとって、曲の切れ目でテンポが変わるのは
   「足を引っかけられる」のと同じです。それを起こさないのが
   このモードの存在意義です。

   ------------------------------------------------------------
   【この版(v158)でやっていること】

   **色分けだけ**です。メインメニューを青、こちらを暁色にして、
   走行中でも一目でどちらのモードか分かるようにしました。

   曲一覧の絞り込み・マイピッチ再生・曲の接続は、この後の版で
   1つずつ足していきます(竹弘と決めた実装STEP)。

       STEP1 色分け                    ← いまここ
       STEP2 入口の判定と曲一覧の絞り込み
       STEP3 画面部品(マイピッチボタン・定規の連動)
       STEP4 デッキエンジン(L1〜L4)とマイピッチ再生
       STEP5 拍で繋ぐ
       STEP6 画面ロック中に何曲繋がるかの実測
       STEP7 メインメニューも同じエンジンへ移行

   ------------------------------------------------------------
   【なぜ別ページにしないのか】

   メインメニューと画面の作りがほとんど同じ(曲一覧・上半分の
   操作エリアをそのまま使う)ためです。別ページにすると同じものを
   2つ管理することになり、片方だけ古くなる事故が必ず起きます。

   マイピッチ設定(v145)と同じ考え方で、**同じ画面を使い回し、
   見た目と中身だけを切り替えます**。ページを移動しないので、
   フォルダの権限が切れる心配もありません(c013で苦しんだ問題)。
============================================================ */


/*
今このモードにいるかどうか。

他のファイルからも「今どちらのモードか」を見たい場面が出てくる
ので(曲一覧の絞り込み、再生方法の切り替えなど)、tapState のように
閉じ込めず、素直な変数にしています。
*/
let isNoriRunMode = false;

/*
このモードに入るのに必要な、ノリ注入済みの曲数です(v163)。

【なぜ2曲なのか(竹弘の指示、2026-08-30)】

    タップ補正データ(=ノリ注入曲)がない場合、
    2曲以上のノリ注入曲を作ってねとユーザーに促し、
    機能は使えないこととする。

このモードの本質は「曲と曲を繋いでテンポを保つ」ことなので、
繋ぐ相手がいない1曲では成り立ちません。**2曲そろって初めて
意味を持つ機能**です。
*/
const NORIRUN_MIN_TRACKS = 2;

/*
マイピッチを読めなかった時に使う値です(v165)。

初期設定(js/setup.js)の定規も170から始まるので、そこに合わせて
あります。設定を一度も済ませていない人でも、とりあえず走れる速さです。
*/
const NORIRUN_DEFAULT_PITCH = 170;

/*
---- マイピッチ(このモードの主役) ----

    myPitch     … いま鳴らしているテンポ。定規を動かすとここが変わる
    basePitch   … 初期設定で決めたテンポ。「マイピッチ」ボタンで戻る先

【なぜ2つ持つのか(竹弘の指示、2026-08-30)】

    定規は…マイピッチで再生中の曲をリアルで曲速度を変更するもの
    …元マイピッチボタンを押されたら、初期設定のマイピッチに戻す。
    つまり、ランナーがピッチを上げたい。辛くて下げたい。といった
    時の対応ができるようにする。

走っている最中に「きつい」と感じたら下げ、余裕が出たら上げる。
そして「元に戻したい」と思ったらボタン一つで初期設定の値へ帰れる。
そのために「今の値」と「帰る場所」を別々に持ちます。

⚠️ **走行中に変えた値は保存しません**(竹弘の判断)。次にこの
   モードへ入る時は、また初期設定のマイピッチから始まります。
   その日の体調で上げ下げしたものが、翌日に持ち越されないためです。
*/
let noriRunMyPitch = NORIRUN_DEFAULT_PITCH;
let noriRunBasePitch = NORIRUN_DEFAULT_PITCH;


// ==========================================================
// 画面部品
// ==========================================================

const noriRunAppEl = document.getElementById("app");
const noriRunTitleEl = document.querySelector(".ua-title-row h1");

/*
タイトルの下に小さく出ている副題です(v160で追加)。

竹弘のキャプチャで、見出しを「🕺ノリノリRun再生」に変えたのに、
その下に「メインメニュー」が残ったままなのが見つかりました。
見出しだけ切り替えても、ここが残っていると食い違って見えます。
*/
const noriRunSubTitleEl = document.querySelector(".sub-title");

const noriRunToggleBtn = document.getElementById("norirun-play-btn");

/*
ピッチ欄の見出しとボタン(v165)。

メインメニューでは「元ピッチ：」、🕺ノリノリRun再生では
「マイピッチ：」に書き換えます。ボタン本体は使い回し、
押した時の行き先だけ js/pitch.js 側で切り替えています。
*/
const noriRunPitchLabelEl = document.getElementById("base-pitch-label");
const noriRunPitchBtn = document.getElementById("reset-pitch-btn");


// ==========================================================
// ノリ注入済みの曲を数える
// ==========================================================
/**
 * ノリ注入(タップ補正)が済んでいる曲の数を返します(v163)。
 *
 * 【🕺の印だけでは数えない理由】
 * タップ補正ができる前(v78-v79の頃)は、ボタンを押すと印を付ける
 * だけの仮の作りでした。その時代に🕺になった曲は、繋ぐのに必要な
 * BPMや拍の位置を持っていません。**印ではなく中身で数えます。**
 *
 * 判定は js/tap.js の hasSavedTapResult() を借りています。
 * 「補正データが揃っているか」の基準は1か所にまとめておかないと、
 * 数える場所と使う場所で食い違いが起きるためです。
 *
 * @return {number} ノリ注入済みの曲数
 */
function countNoriInjectedTracks(){

    let count = 0;

    for(const trackId of currentOrderList){

        const track = libraryMap[trackId];

        if(track && hasSavedTapResult(track)){ count++; }

    }

    return count;

}


// ==========================================================
// マイピッチの読み込み
// ==========================================================
/**
 * 初期設定で決めたマイピッチをDBから読みます(v165)。
 *
 * 保存しているのは js/setup.js(初期設定・マイピッチ設定画面)で、
 * キー名 my_pitch もそちらに合わせています。読む側と書く側で
 * 名前がずれると、設定したのに反映されない不具合になります。
 *
 * @return {number} マイピッチ(読めなければ既定値)
 */
async function loadMyPitch(){

    try{

        const saved = await idbGet(STORE_SETTINGS,"my_pitch");

        if(typeof saved === "number" && isFinite(saved) && saved > 0){

            return saved;

        }

    }
    catch(error){

        console.error("マイピッチの読み込みに失敗 :",error.name,error.message);

    }

    return NORIRUN_DEFAULT_PITCH;

}

/**
 * マイピッチを読み直して、画面と再生速度に反映します(v166で追加)。
 *
 * 【いつ呼ばれるか】
 * 🕺ノリノリRun再生の最中に「マイピッチ設定」を開いて値を変え、
 * 戻ってきた時です(js/setup.js の closeMyPitchSetting から)。
 *
 * これが無いと、設定を変えたのに表示も再生速度も古いままでした
 * (竹弘の実機報告、2026-08-30)。走る前にペースを決め直したのに
 * 反映されないと、設定した意味がありません。
 *
 * 走行中に定規で上げ下げしていた分は捨てて、新しく決めた値から
 * 始め直します。「設定し直した」以上、そちらが竹弘の意思だからです。
 */
async function reloadNoriRunPitch(){

    if(!isNoriRunMode){ return; }

    noriRunBasePitch = await loadMyPitch();
    noriRunMyPitch = noriRunBasePitch;

    updateNoriRunPitchDisplay();
    applyNoriRunPitch();

    console.log("マイピッチを読み直しました :",noriRunMyPitch);

}

/**
 * 「マイピッチ」ボタンが押された時の処理です(v165)。
 *
 * 初期設定で決めた値へ戻します。走行中に上げ下げした後、
 * 「元のペースに帰りたい」時のためのボタンです。
 */
function resetToBasePitch(){

    noriRunMyPitch = noriRunBasePitch;

    applyNoriRunPitch();

}

/**
 * いまのマイピッチを、鳴っている曲と画面に反映します(v165)。
 *
 * 【メインメニューとの違い(竹弘の注意書き)】
 *     個々の曲の速度を変更するメインメニューと違って、
 *     マイピッチの速度と連動する。
 *
 * メインメニューの定規は「その曲の速さ」を決めますが、こちらは
 * 「走るテンポそのもの」を決めます。曲が変わっても同じテンポで
 * 鳴り続けるのが、このモードの存在意義です。
 */
function applyNoriRunPitch(){

    const track = libraryMap[currentTrackId];

    /*
    曲を選んでいない時は、画面の数字だけ合わせておきます。
    再生速度は次に曲を選んだ時に applyTrackTempo() が当てます。
    */
    if(!track){

        updateNoriRunPitchDisplay();

        return;

    }

    const base = getEffectiveBaseBpm(track);

    /*
    速さの倍率は「走りたいテンポ ÷ その曲の本来のテンポ」です。
    170で走りたい曲が元々150なら 170/150 ＝ 約1.13倍で鳴らします。
    */
    applyTempo(noriRunMyPitch / base,false);

}

/**
 * 「マイピッチ」の数字を画面に出します。
 *
 * ⚠️ ここに出すのは **初期設定のマイピッチ(戻る先)** であって、
 *    いま鳴っている速さではありません。
 *
 *        再生ピッチ：175   ← 走行中に上げた、いまの速さ
 *        マイピッチ：170   ← このボタンを押すと帰る場所
 *
 *    いまの速さを出してしまうと、左の「再生ピッチ」と同じ数字が
 *    2つ並ぶだけになり、「戻す」ボタンの意味が消えてしまいます。
 */
function updateNoriRunPitchDisplay(){

    if(!isNoriRunMode){ return; }

    basePitchValueEl.textContent = formatPitch(noriRunBasePitch);

}


// ==========================================================
// モードの出入り
// ==========================================================
/**
 * 🕺ノリノリRun再生モードに入ります。
 *
 * ノリ注入済みの曲が足りない時は、入らずにお知らせだけ出します。
 */
async function enterNoriRunMode(){

    const injectedCount = countNoriInjectedTracks();

    if(injectedCount < NORIRUN_MIN_TRACKS){

        /*
        お知らせは js/tap.js の showTapToast() を借ります。

        #tap-toast はタップ補正画面の**外**に置いてあるので、
        メインメニューの上にも出せます(tap.js のHTMLコメント参照)。
        */
        showTapToast(
            "ノリ注入した曲が" + NORIRUN_MIN_TRACKS + "曲以上必要です" +
            "(いま" + injectedCount + "曲)。" +
            "曲一覧の🛌を押してノリを注入してください"
        );

        console.log(
            "🕺ノリノリRun再生に入れません :",
            "ノリ注入済み " + injectedCount + "曲 /",
            "必要 " + NORIRUN_MIN_TRACKS + "曲"
        );

        return;

    }

    /*
    初期設定のマイピッチを読み込みます(v165)。

    入るたびに読み直すのは、マイピッチ設定画面で変えた値をすぐ
    反映するためです。また、走行中に上げ下げした値は持ち越さない
    (毎回この値から始める)という竹弘の判断にも合っています。
    */
    noriRunBasePitch = await loadMyPitch();
    noriRunMyPitch = noriRunBasePitch;

    isNoriRunMode = true;

    /*
    #app に印を付けるだけで、中の色がまとめて暁色に変わります。

    CSSの --theme-color をこのクラスが上書きし、--main-blue が
    それを見に行く作りにしてあるためです(c014.html の :root の
    コメントに詳しく書いてあります)。ボタン1つ1つの色を
    JavaScriptから塗り替えて回る必要はありません。
    */
    noriRunAppEl.classList.add("norirun-mode");

    noriRunTitleEl.textContent = "🕺ノリノリRun再生";

    /*
    副題は「マイピッチで走る」に変えます。

    空にしてしまうと1行ぶん高さが減り、上半分の10等分レイアウトの
    中で見出しの位置がずれます。同じ高さのまま、このモードが何を
    するところかを一言で示す文言を置きました。
    */
    noriRunSubTitleEl.textContent = "マイピッチで繋いで走る";

    /*
    入ってきたボタン自身が、戻るボタンに変わります。

    上半分は10等分の窮屈な作りで、ボタンを1つ足すと他の段が
    潰れます(エリアの高さは画面の高さに比例するため)。
    行き先が1つしかない今の段階では、同じボタンを往復に使うのが
    いちばん収まりがよいと判断しました。
    */
    noriRunToggleBtn.textContent = "◀ メインメニューへ戻る";

    /*
    曲一覧を作り直して、ノリ注入済みの曲だけにします(v163)。

    絞り込みそのものは js/list-view.js の renderList() が
    isNoriRunMode を見て行います。ここで並び順(currentOrderList)は
    一切いじりません。**竹弘が並べた曲順は、モードを行き来しても
    そのまま保たれます**(ランダム再生で並び順を壊さないのと同じ考え方)。
    */
    refreshNoriRunList();

    /*
    ピッチまわりの表示と、鳴っている曲の速さをマイピッチに合わせます。

    ⚠️ 色を変えるより先に isNoriRunMode を立てておくこと。
       この中の関数がモードを見て動きを変えるためです。
    */
    updateNoriRunPitchLabel();
    applyNoriRunPitch();

    console.log(
        "🕺ノリノリRun再生モードに入りました :",
        "ノリ注入済み " + injectedCount + "曲 /",
        "マイピッチ " + noriRunMyPitch
    );

}

/**
 * ピッチ欄の見出しを、モードに合わせて書き換えます(v165)。
 *
 * 竹弘の指示:
 *     「元ピッチ:___」は、「マイピッチ」に変更して、大きめに表示。
 *     「マイピッチ」はボタンになっていて、
 *     変更された曲ピッチをマイピッチに戻す。
 *
 * ボタンそのもの(#reset-pitch-btn)は使い回し、**行き先だけ**を
 * 変えています。メインメニューでは「その曲の元の速さ」へ、
 * こちらでは「初期設定のマイピッチ」へ戻ります。
 */
function updateNoriRunPitchLabel(){

    if(isNoriRunMode){

        noriRunPitchLabelEl.textContent = "マイピッチ：";
        noriRunPitchBtn.classList.add("ua-pill-btn-strong");

        updateNoriRunPitchDisplay();

    }
    else{

        noriRunPitchLabelEl.textContent = "元ピッチ：";
        noriRunPitchBtn.classList.remove("ua-pill-btn-strong");

    }

}

/**
 * 曲一覧を作り直して、いまのモードに合った並びにします。
 */
function refreshNoriRunList(){

    renderList();

    /*
    ランダム再生の順番も作り直します(v166)。

    シャッフルした順番(shuffleOrder)は、モードを切り替えただけでは
    作り直されません(空になった時と一巡した時にしか作られない作り)。
    そのままだと、🔀のままノリノリRunへ入った時に、**古い全曲の
    並びから次の曲が選ばれてしまいます**。
    対象の曲が入れ替わったこの場で作り直しておきます。
    */
    buildShuffleOrder();

    /*
    先頭へ戻します。

    モードの行き来は「別の画面へ移る」操作なので、前の画面で
    スクロールしていた位置に居残ると、どこを見ているのか分からなく
    なります(並び替えの後に先頭へ戻すのと同じ理由。v101)。
    */
    menuListEl.scrollTop = 0;

}

/**
 * メインメニューへ戻ります。
 */
function exitNoriRunMode(){

    isNoriRunMode = false;

    noriRunAppEl.classList.remove("norirun-mode");

    noriRunTitleEl.textContent = "ノリRun";
    noriRunSubTitleEl.textContent = "メインメニュー";

    noriRunToggleBtn.textContent = "🕺ノリノリRun再生";

    // 曲一覧を全曲に戻します
    refreshNoriRunList();

    // 見出しを「元ピッチ：」に戻します
    updateNoriRunPitchLabel();

    /*
    鳴っている曲の速さを、その曲自身の設定へ戻します(v165)。

    マイピッチはこのモードの中だけの決め事なので、メインメニューへ
    帰ったら、その曲に覚えさせてある userBPM(無ければ元の速さ)に
    戻すのが筋です。戻さないと、走行中に上げたテンポのまま普通の
    再生が続いてしまいます。
    */
    const track = libraryMap[currentTrackId];

    if(track){ applyTrackTempo(track); }

    console.log("メインメニューへ戻りました");

}

/**
 * ボタンが押された時に、行きと帰りを振り分けます。
 */
async function toggleNoriRunMode(){

    if(isNoriRunMode){

        exitNoriRunMode();

    }
    else{

        /*
        入る時はマイピッチをDBから読むため、待ってから進みます。
        await を書かないと、読み終わる前に次の処理が走り、古い値で
        画面を作ってしまう恐れがあります。
        */
        await enterNoriRunMode();

    }

}


// ==========================================================
// ボタンをつなぐ
// ==========================================================

noriRunToggleBtn.onclick = toggleNoriRunMode;
