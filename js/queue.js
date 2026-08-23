/*
======================================================================
 queue.js ── 連続再生(次にどの曲を鳴らすかを決める)

----------------------------------------------------------------------

【このファイルの役割】

 曲が最後まで流れ終わった時に、自動で次の曲を鳴らします。
 「次は何を鳴らすか」の判断を、まとめてここが受け持ちます。

   findNextTrackId()   … 次に鳴らすべき曲を探す(自動再生用)
   playNextTrack()     … 次の曲を鳴らす(駄目ならさらに次へ)
   skipTrack()         … ⏭ ⏮ が押された時に隣の曲を鳴らす
   buildShuffleOrder() … ランダム再生用の順番を作る
   loadPlayModeSetting() … 前回選んだ再生モードを復元する

----------------------------------------------------------------------

【なぜ player.js とファイルを分けたのか】

 役割がはっきり2つに分かれるためです。

   player.js … 渡された1曲を「鳴らす」係(権限確認・ファイル読み込み)
   queue.js  … 「次は何を鳴らすか」を決める係

 竹弘がこの後に予定している **曲送り/曲戻し** も「次は何を鳴らすか」の
 話なので、ここに入ります。機能が増えても player.js は太りません。

----------------------------------------------------------------------

【竹弘が決めた仕様(2026-08-16)】

   ・曲が終わったら、次の曲を自動で再生する(基本機能)
   ・再生できない曲に出会ったら、⚠️パネルは出すが **止まらずに
     飛ばして次の曲へ進む**
   ・すでに除外済みの曲は、最初から素通りする
   ・再生モードは4つ。ボタン1つを押すたびに切り替わる

 最後の狙いが大事です。一度「了承」を押した曲は、二度と走行中の
 邪魔をしません。

----------------------------------------------------------------------

【走行中に音楽が止まらないことを最優先にしている】

 このアプリはマラソン中に使います。ポケットやアームバンドに入れた
 まま走るので、何かあっても竹弘はすぐ画面を見られません。

 だから「困ったら止める」ではなく「困っても先へ進む」を基本に
 しています。v110で alert(押されるまでJavaScriptが止まる)を
 やめて自作パネルにしたのも、この方針のためです。
======================================================================
*/


// ==========================================================
// 1. 再生モード(v113)
// ==========================================================
/*
曲一覧の見出しにある丸ボタンを押すたびに、次の順で切り替わります。

    🔁(薄いグレー) … OFF      一覧の最後まで来たら止まる
    🔁(青)         … 全曲ループ 最後まで来たら先頭へ戻る
    🔂(青)         … 1曲リピート 今の曲だけを繰り返す
    🔀(青)         … ランダム   順番をシャッフルして流す

【なぜ OFF を入れたのか(竹弘の判断)】

OFFが無いと必ずどれかが有効になり、**放っておくと音楽が永遠に
鳴り続けます。** 走り終わった後に自然に終わってほしいので、
「最後まで来たら止まる」状態を残しました。

【なぜ文字列で持つのか】

0,1,2,3 のような数値でも作れますが、後からコードを読んだ時に
「2ってどれだっけ」と分からなくなります。"one" と書いてあれば
1曲リピートだと読んで分かるので、間違いが起きにくくなります。
*/
const PLAY_MODE_OFF = "off";
const PLAY_MODE_ALL = "all";
const PLAY_MODE_ONE = "one";
const PLAY_MODE_SHUFFLE = "shuffle";

/*
ボタンを押した時に切り替わる順番です。

配列にしておくと、切り替えの処理が「今の位置の次を取るだけ」で
済みます。順番を変えたくなった時も、この並びを入れ替えるだけです。
*/
const PLAY_MODE_SEQUENCE = [
    PLAY_MODE_OFF,
    PLAY_MODE_ALL,
    PLAY_MODE_ONE,
    PLAY_MODE_SHUFFLE
];

/*
モードごとにボタンへ出す記号です。

OFFと全曲ループが同じ 🔁 なのは意図的で、**色の濃さで区別します**
(OFFは薄いグレー、全曲ループは青)。記号まで変えてしまうと、
走りながら見た時に「何の記号だったか」を思い出す手間が増えるためです。
*/
const PLAY_MODE_ICONS = {
    off: "🔁",
    all: "🔁",
    one: "🔂",
    shuffle: "🔀"
};

// 今どのモードかを覚えておきます(初期値はOFF=今までと同じ動き)
let currentPlayMode = PLAY_MODE_OFF;


// ==========================================================
// 2. 続けて失敗した時の歯止め
// ==========================================================
/*
何曲まで続けて飛ばすかの上限です。

【なぜ上限が要るのか】

「失敗したら次へ」をそのまま繰り返すと、**もし全曲が鳴らせない
状態(フォルダの権限が切れた等)になった時に、369曲を一気に
駆け抜けてしまいます。** 一瞬で最後まで到達し、⚠️パネルには
大量の曲が積み上がることになります。

そこで、続けて10曲失敗したらそこで手を止めます。10曲も連続で
駄目なら、それは個々の曲の問題ではなく、もっと大きな原因
(権限切れなど)が起きていると考えられるためです。

「続けて」なので、間に1曲でも鳴れば数え直しになります。
*/
const MAX_CONSECUTIVE_SKIP = 10;


// ==========================================================
// 3. ランダム再生用の順番
// ==========================================================
/*
シャッフルした曲順(track_idの配列)です。

【画面の曲一覧は並び替えません】

ランダム再生でも、画面に見えている曲の並びは変わりません。
別の配列をここに用意し、**再生する順番だけ**を入れ替えています。

もし currentOrderList そのものをシャッフルしてしまうと、竹弘が
時間をかけて並べた曲順が、ランダムを押した瞬間に消えてしまいます。
「聴く順番」と「並べた順番」は別物として扱います。
*/
let shuffleOrder = [];

/**
 * 曲順をシャッフルして、ランダム再生用の順番を作ります。
 *
 * 除外された曲(グレー表示)は最初から入れません。
 */
function buildShuffleOrder(){

    // まず、鳴らせる曲だけを集めます
    shuffleOrder = currentOrderList.filter(function(trackId){
        return !isExcluded(libraryMap[trackId]);
    });

    /*
    【フィッシャー・イェーツのシャッフル】

    トランプを切るのと同じことを配列でやる、昔からある確実な方法です。

      1. 一番後ろの札に注目する
      2. まだ触っていない札の中から1枚を無作為に選ぶ
      3. その2枚を入れ替える
      4. 注目する場所を1つ前にずらして、1に戻る

    後ろから順に「この位置に来る札」を確定させていくので、
    全部の並び方が同じ確率で出てきます。

    Math.random() は 0以上1未満の小数を返す標準の命令です。
    (i + 1) を掛けて Math.floor() で小数を切り捨てると、
    0 から i までの整数が1つ得られます。

    ※「配列を適当に混ぜる」だけなら sort() で乱数を返す書き方も
      ありますが、あれは並びに偏りが出ることが知られています。
      曲順は毎回きれいに混ざってほしいので、こちらを使います。
    */
    for(let i = shuffleOrder.length - 1; i > 0; i--){

        const j = Math.floor(Math.random() * (i + 1));

        const temp = shuffleOrder[i];
        shuffleOrder[i] = shuffleOrder[j];
        shuffleOrder[j] = temp;

    }

    console.log("ランダム再生の順番を作りました :",shuffleOrder.length,"曲");

}


// ==========================================================
// 4. 次に鳴らす曲を探す
// ==========================================================
/**
 * 指定した曲の「次」に鳴らすべき曲を返します。
 *
 * 除外された曲(グレー表示)は飛ばします。
 *
 * @param  {string} fromTrackId - どの曲の次を探すか
 * @return {string|null} 次の曲のtrack_id。もう無ければ null
 */
function findNextTrackId(fromTrackId){

    // ---- 1曲リピート ----
    /*
    同じ曲を返します。ただし実際の鳴らし直しは playNextTrack() が
    もっと軽い方法で行うので、ここへ来ることはほとんどありません
    (曲送りボタンを作った時のために、筋を通してあります)。
    */
    if(currentPlayMode === PLAY_MODE_ONE){
        return fromTrackId;
    }

    // ---- ランダム ----
    if(currentPlayMode === PLAY_MODE_SHUFFLE){
        return findNextInShuffle(fromTrackId);
    }

    // ---- OFF / 全曲ループ ----
    /*
    今の曲が、曲順(currentOrderList)の何番目にいるかを調べます。

    indexOf は「配列の中で何番目にあるか」を返す標準の命令で、
    見つからない時は -1 を返します。

    -1 だった場合、下の for文は i=0 から始まります。つまり
    「今の曲が一覧に見当たらない時は、先頭から探し直す」という
    動きになります(並び替えの直後などに起こりえます)。
    */
    const currentIndex = currentOrderList.indexOf(fromTrackId);

    /*
    今の曲の1つ後ろから、順番に見ていきます。

    除外された曲は飛ばすので、「次」は必ずしも隣とは限りません。
    鳴らせる見込みのある曲が見つかった時点で、それを返します。
    */
    for(let i = currentIndex + 1; i < currentOrderList.length; i++){

        const trackId = currentOrderList[i];

        if(!isExcluded(libraryMap[trackId])){
            return trackId;
        }

    }

    /*
    最後まで見ても見つからなかった場合の分かれ道です。

      全曲ループ … 先頭に戻って、最初の鳴らせる曲を返す
      OFF        … null を返して、そこで再生を終える
    */
    if(currentPlayMode === PLAY_MODE_ALL){

        for(let i = 0; i < currentOrderList.length; i++){

            const trackId = currentOrderList[i];

            if(!isExcluded(libraryMap[trackId])){

                console.log("一覧の最後まで来たので先頭に戻ります");

                return trackId;

            }

        }

    }

    return null;

}

/**
 * ランダム再生で、次に鳴らす曲を探します。
 */
function findNextInShuffle(fromTrackId){

    // まだ順番を作っていなければ、ここで作ります
    if(shuffleOrder.length === 0){
        buildShuffleOrder();
    }

    const currentIndex = shuffleOrder.indexOf(fromTrackId);

    for(let i = currentIndex + 1; i < shuffleOrder.length; i++){

        const trackId = shuffleOrder[i];

        // 順番を作った後で除外された曲があるかもしれないので、ここでも確認します
        if(libraryMap[trackId] && !isExcluded(libraryMap[trackId])){
            return trackId;
        }

    }

    /*
    ひと通り流し終わったら、**順番を作り直してまた続けます。**

    ランダム再生の途中で止まってしまうと、走っている最中に無音に
    なってしまうためです。切り直したトランプで、もう一周する形。

    作り直した順番の先頭が「今まで鳴っていた曲」だと、同じ曲が
    2回続いてしまいます。それを避けるため、違う曲が見つかるまで
    先へ進んでから返しています。
    */
    buildShuffleOrder();

    for(const trackId of shuffleOrder){

        if(trackId !== fromTrackId){
            return trackId;
        }

    }

    return null;

}


// ==========================================================
// 5. 次の曲を鳴らす
// ==========================================================
/**
 * 次の曲を鳴らします。鳴らなければ、さらにその次へ進みます。
 */
async function playNextTrack(){

    // 【開発用調査ログ】原因判明後に削除(CLAUDE.md参照)
    logDebugEvent("playNextTrack開始 (mode=" + currentPlayMode + ")");

    /*
    ---- 1曲リピートは、もうここには来ません(v144) ----

    以前はここに「1曲リピート専用の軽い再生」の分岐がありました。
    v144で、1曲リピートは audio要素の loop 属性(js/player.js の
    playTrack()が設定)に置き換えたため、リピート中は ended
    イベントそのものが発火しなくなり、この playNextTrack() が
    呼ばれること自体が無くなりました。

    経緯(画面ロック中の再生調査、2026-08-23)は player.js の
    audioPlayer.loop を設定している箇所のコメントを参照してください。
    */

    let nextTrackId = findNextTrackId(currentTrackId);

    // 続けて何曲失敗したかの数え役
    let failCount = 0;

    /*
    while は「条件を満たす間くり返す」書き方です。
    次の曲が見つかる限り、鳴るまで試し続けます。

    【なぜ「自分自身をもう一度呼ぶ(再帰)」にしなかったか】

    失敗するたびに playNextTrack() を呼び直す書き方もできますが、
    369曲すべてが鳴らない場合に呼び出しが369段も積み重なります。
    while なら何曲あっても積み上がらないので、こちらにしました。
    */
    while(nextTrackId){

        /*
        playTrack() は「鳴り始めたかどうか」を返します(v112で追加)。

        await を付けているのは、鳴るか鳴らないかの結果が出るまで
        待つ必要があるためです。待たずに次へ進むと、前の曲の結果が
        出ないうちに次の曲を鳴らし始めてしまいます。
        */
        const started = await playTrack(nextTrackId);

        // 鳴った。ここで役目は終わりです
        if(started){ return; }

        failCount++;

        if(failCount >= MAX_CONSECUTIVE_SKIP){

            console.warn(
                "続けて" + MAX_CONSECUTIVE_SKIP + "曲再生できなかったため、" +
                "自動再生を止めました。フォルダの権限が切れている可能性があります。"
            );

            return;

        }

        console.log("再生できないため次の曲へ進みます :",nextTrackId);

        /*
        失敗した曲の「次」を探し直します。

        currentTrackId ではなく nextTrackId を渡しているのが要点です。
        失敗した時点で currentTrackId はもう書き換わっていることが
        あり、それを基準にすると同じ曲を何度も試しかねないためです。
        */
        nextTrackId = findNextTrackId(nextTrackId);

    }

    console.log("最後の曲まで再生しました(自動再生を終了します)");

}


// ==========================================================
// 6. 曲送り / 曲戻し(v119)
// ==========================================================
/*
曲一覧の見出しにある ⏭ ⏮ を押した時の処理です。

【自動再生の「次の曲」と、なぜ別の関数なのか】

上の findNextTrackId() は曲が終わった時に呼ばれるもので、1曲リピート
なら同じ曲を返します。しかし **⏭ を押したのに同じ曲が鳴り直したら、
竹弘は「壊れている」と感じます。**

ボタンを押すのは「今の曲はもういい、隣へ行きたい」という
はっきりした意思表示です。そのため1曲リピート中でも、こちらは
必ず隣の曲へ進みます(一般的な音楽プレイヤーと同じ振る舞いです)。

竹弘の指示で、⏮ は **いつでも前の曲へ** 戻ります(「3秒以上聴いて
いたら今の曲の頭出し」という作りにはしていません。押した時に何が
起きるかが毎回同じ方が、走りながらでも迷わないためです)。
*/

/**
 * 今の曲の1つ隣を探します。
 *
 * @param  {number} step - +1 なら次の曲、-1 なら前の曲
 * @return {string|null} 見つかった曲のtrack_id
 */
function findNeighborTrackId(step){

    /*
    ランダム再生の時は、シャッフルした順番の中で隣を探します。
    そうしないと「⏭ で進んだ曲」と「自動で流れる曲」が食い違います。
    */
    const list = (currentPlayMode === PLAY_MODE_SHUFFLE)
        ? shuffleOrder
        : currentOrderList;

    if(list.length === 0){ return null; }

    const currentIndex = list.indexOf(currentTrackId);

    // 今の曲が見当たらない時は、先頭の鳴らせる曲を返します
    if(currentIndex === -1){

        for(const trackId of list){
            if(!isExcluded(libraryMap[trackId])){ return trackId; }
        }

        return null;

    }

    /*
    隣へ1つずつ動きながら、鳴らせる曲を探します。
    除外された曲は飛ばすので、隣が必ず「1つ先」とは限りません。
    */
    for(let i = currentIndex + step; i >= 0 && i < list.length; i += step){

        const trackId = list[i];

        if(libraryMap[trackId] && !isExcluded(libraryMap[trackId])){
            return trackId;
        }

    }

    /*
    端に着いた時の扱いです。

    全曲ループとランダムの時は、反対の端へ回り込みます(一覧の
    最後で ⏭ を押したら先頭へ、先頭で ⏮ を押したら最後へ)。
    OFFと1曲リピートの時は、端で止まります。
    */
    if(currentPlayMode === PLAY_MODE_ALL || currentPlayMode === PLAY_MODE_SHUFFLE){

        const wrapStart = (step > 0) ? 0 : list.length - 1;

        for(let i = wrapStart; i >= 0 && i < list.length; i += step){

            const trackId = list[i];

            if(libraryMap[trackId] && !isExcluded(libraryMap[trackId])){
                return trackId;
            }

        }

    }

    return null;

}

/**
 * ⏭ / ⏮ が押された時に、隣の曲を鳴らします。
 */
async function skipTrack(step){

    // まだ1曲も選んでいない時は、鳴らすものがないので何もしません
    if(!currentTrackId){ return; }

    const trackId = findNeighborTrackId(step);

    if(!trackId){

        console.log("これ以上、進める曲がありません");

        return;

    }

    /*
    鳴らせなかった場合の追いかけはしません。

    ここは竹弘が自分で押したボタンなので、⚠️パネルが出た時点で
    「この曲は駄目だった」と分かります。勝手に次々と飛ばしていくと、
    どこまで進んだのか分からなくなってしまいます
    (自動再生の時に飛ばし続けるのは、画面を見ていないためです)。
    */
    await playTrack(trackId);

}

const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

prevBtn.addEventListener("click",function(){
    skipTrack(-1);
});

nextBtn.addEventListener("click",function(){
    skipTrack(1);
});


// ==========================================================
// 7. 曲が終わったら次へ
// ==========================================================
/*
ended は「曲が最後まで流れ終わった」時に起きる、audio要素の
標準のイベントです。

【停止ボタンで止めた時に、次の曲が鳴り出さない理由】

止めた時に起きるのは pause であって ended ではありません。
そのためこの処理は動かず、信号待ちや給水で止めても
勝手に曲が進んでしまうことはありません。

【なぜ自分でタイマーを回さないのか】

「残り時間を測って、0になったら次へ」と自作することもできますが、
再生速度を変える機能(ピッチ定規)があるため、残り時間の計算が
複雑になります。ended はブラウザが実際の再生を見て教えてくれる
合図なので、速度を変えても正しいタイミングで届きます。
*/
audioPlayer.addEventListener("ended",function(){

    console.log("曲が終わりました。次の曲へ進みます");

    playNextTrack();

});


// ==========================================================
// 8. 再生モードのボタン(v113)
// ==========================================================

const playModeBtn = document.getElementById("play-mode-btn");

/*
ボタンが押されたら、次のモードへ切り替えます。
*/
playModeBtn.addEventListener("click",function(){

    /*
    今のモードが並びの何番目かを調べ、その次へ進みます。

    % は「割った余り」を求める記号です。最後(3番目)まで来た時に
    (3 + 1) % 4 = 0 となって先頭に戻るので、if文を書かずに
    ぐるりと一周させられます。
    */
    const currentIndex = PLAY_MODE_SEQUENCE.indexOf(currentPlayMode);
    const nextIndex = (currentIndex + 1) % PLAY_MODE_SEQUENCE.length;

    currentPlayMode = PLAY_MODE_SEQUENCE[nextIndex];

    /*
    ランダムに切り替わった時点で、順番を作り直します。

    走るたびに違う並びで聴けるようにするためです。前回の順番が
    残っていると、アプリを開くたびに同じ流れになってしまいます。
    */
    if(currentPlayMode === PLAY_MODE_SHUFFLE){
        buildShuffleOrder();
    }

    /*
    audio要素の loop 属性も、その場で切り替えます(v144)。

    js/player.js の playTrack() でも設定していますが、あちらは
    「次の曲を鳴らし始める瞬間」にしか効きません。今まさに鳴っている
    曲の途中でモードを切り替えた場合(例: 連続再生中に1曲リピートへ
    切り替える)にも即座に反映されるよう、ここでも設定します。
    */
    audioPlayer.loop = (currentPlayMode === PLAY_MODE_ONE);

    updatePlayModeButton();

    savePlayModeSetting();

    console.log("再生モードを変更しました :",currentPlayMode);

});

/**
 * ボタンの記号と色を、今のモードに合わせます。
 */
function updatePlayModeButton(){

    playModeBtn.textContent = PLAY_MODE_ICONS[currentPlayMode];

    /*
    OFFの時だけ薄いグレー、それ以外は青くします。

    classList.toggle は「第2引数がtrueなら付ける、falseなら外す」
    という命令です。付ける/外すをif文で書き分けなくて済みます。
    */
    playModeBtn.classList.toggle(
        "play-mode-off",
        currentPlayMode === PLAY_MODE_OFF
    );

    playModeBtn.classList.toggle(
        "play-mode-active",
        currentPlayMode !== PLAY_MODE_OFF
    );

}


// ==========================================================
// 9. 再生モードの保存と復元
// ==========================================================
/*
選んだモードは settings ストアに残し、次にアプリを開いた時も
同じモードで始められるようにします(並び順の保存と同じ考え方)。

走る前に決めた設定が、走り出す時にも残っていてほしいためです。
*/

async function savePlayModeSetting(){

    try{

        // settings ストアはキーを自分で指定する形なので、3つ目の引数に渡します
        await idbPut(STORE_SETTINGS,currentPlayMode,"play_mode");

    }
    catch(error){

        console.error(
            "再生モードの保存に失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 保存してある再生モードを読み込み、ボタンに反映します。
 *
 * js/main.js の起動処理から、曲順を読み込んだ後に呼ばれます。
 */
async function loadPlayModeSetting(){

    try{

        const saved = await idbGet(STORE_SETTINGS,"play_mode");

        /*
        保存されている値が、今のコードで使える4つのどれかである時だけ
        受け入れます。将来モードの名前を変えた場合に、古い値が残って
        いても壊れないようにするためです。
        */
        if(saved && PLAY_MODE_SEQUENCE.indexOf(saved) !== -1){
            currentPlayMode = saved;
        }

        // ランダムで終了していた場合は、ここで順番を作り直します
        if(currentPlayMode === PLAY_MODE_SHUFFLE){
            buildShuffleOrder();
        }

    }
    catch(error){

        console.error(
            "再生モードの読み込みに失敗 :",
            error.name,
            error.message
        );

    }

    // 読み込めなかった時もボタンの見た目は整えます(初期値のOFF表示になります)
    updatePlayModeButton();

}
