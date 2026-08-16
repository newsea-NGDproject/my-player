/*
======================================================================
 exclude.js ── 再生できない曲の「除外」

----------------------------------------------------------------------

【このファイルの役割】

 どうしても再生できない曲を、曲一覧から消さずに
 「グレー表示で一番下に置いておく」ための仕組みです。

   isExcluded()             … その曲が除外中かを判定する
   reportPlaybackFailure()  … 再生に失敗したことを受け取る
   confirmExclusion()       … 「了承」が押された時に除外を確定する
   clearExclusion()         … 鳴るようになった曲の除外を解除する
   moveExcludedToBottom()   … 除外曲を曲順の一番下へまとめる

----------------------------------------------------------------------

【なぜ「削除」ではなく「除外」なのか】

 竹弘の判断です。

     「曲を削除してしまうと、再生できるように対応した際に、
       曲の追加が面倒になってしまう」

 369曲の中から「昔消した曲」だけを探して入れ直すのは、現実的に
 無理な作業です。残しておけば、タップ1回で復帰できます。

----------------------------------------------------------------------

【実際に何が起きて、この機能が必要になったのか】

 竹弘のライブラリにある Over_the_Horizon.m4a が再生できませんでした。
 ファイルの中身を直接調べたところ、原因が分かりました。

     コーデック : ec-3(Dolby Digital Plus / E-AC-3)
     ビットレート : 約788kbps、3分39秒で21.5MB

 これは壊れたファイルではなく、まったく正常なDolby音源です。
 他のプレイヤーで鳴るのは、端末に内蔵されたDolbyデコーダを
 直接使っているためです。

 一方、Chromeは Dolby のコーデックを積んでいません。ライセンス料が
 必要なため、Googleが標準ビルドから外しているからです。

 つまりこれは「ノリRunの不具合」ではなく、ブラウザで音楽を扱う限り
 避けられない壁です。だからこそ、こちらで直せない曲を邪魔にならない
 場所へ片付ける仕組みが要る、というのがこの機能の出発点です。

 メッセージに「将来の対応にご期待ください」と書かないのは、この
 事情によります。有償で販売するアプリなので、果たせない約束を
 画面に出すわけにはいきません。

----------------------------------------------------------------------

【「了承」を押すまで除外しない理由】

 竹弘の指示です。走行中に画面を見ていなくても音楽を止めないため、
 メッセージは出しっぱなしにして再生は先へ進みます。そして竹弘が
 あとで画面を見て「了承」を押した時に、初めて除外が確定します。

 勝手に除外してしまうと、竹弘の知らないうちに曲が一番下へ動いて
 いることになります。「自分が承知したうえで片付ける」という順番を
 守るための作りです。

----------------------------------------------------------------------

【どのエラーを除外の対象にするか(ここが一番大事)】

 再生の失敗には種類があり、**全部を除外にすると大事故になります。**

     ✅ 対象にする … コーデック非対応・デコード失敗
                      (本当にこの端末では鳴らせない曲)

     ❌ 対象にしない … フォルダの権限切れ
                      → 権限は全曲まとめて切れるため、これを
                        除外にすると369曲が一斉にグレーになる

     ❌ 対象にしない … 自動再生のブロック(NotAllowedError)
                      → 鳴らない原因は曲ではなくブラウザの制限

     ❌ 対象にしない … ファイルが見つからない
                      → フォルダを移動しただけかもしれない

 判定は下の isCodecFailure() / isCodecMediaError() に集約してあります。
 **ここを緩めると事故に直結する**ので、種類を増やす時は慎重に。
======================================================================
*/


// ==========================================================
// 1. 除外の理由コード
// ==========================================================
/*
なぜ理由を文字で残すのかというと、将来ここが増えるからです。
今は「コーデック非対応」しかありませんが、別の原因で除外する日が
来た時、メッセージを出し分ける手がかりになります。
*/
const EXCLUDE_REASON_CODEC = "unsupported_codec";


// ==========================================================
// 2. 除外中かどうかの判定
// ==========================================================
/**
 * その曲が除外中かどうかを返します。
 *
 * 判定に使うのは excluded_at(除外した日時)です。
 * **この1つのフィールドが「除外の印」と「除外曲同士の並び順」を
 * 兼ねています。** 未設定(または0)なら、まだ除外されていない曲です。
 *
 * ノリ注入の nori_injected_at とまったく同じ考え方なので、
 * 片方を理解すればもう片方も読めます。
 */
function isExcluded(track){

    // !! は「あるかないかの2択に直す」書き方です(0やundefinedはfalseになります)
    return !!(track && track.excluded_at);

}


// ==========================================================
// 3. 再生の失敗を受け取る
// ==========================================================
/*
「了承」を待っている曲のtrack_idを、ここに溜めます。

【なぜ1曲ずつではなく配列なのか】

連続再生(v111で追加予定)では、走っている間に2曲以上が続けて
失敗することがありえます。1曲ずつ上書きすると、先に失敗した曲が
どこにも残らず消えてしまいます。

配列に溜めておけば「3曲が再生できませんでした」とまとめて出せて、
了承1回で全部片付けられます。
*/
let pendingExcludeIds = [];

/**
 * 再生に失敗した曲を受け取り、⚠️パネルを出します。
 *
 * この時点ではまだ除外しません(了承を押すまで待ちます)。
 *
 * @param {string} trackId - 失敗した曲
 */
function reportPlaybackFailure(trackId){

    const track = libraryMap[trackId];

    if(!track){ return; }

    /*
    同じ曲を二重に溜めないようにします。

    【なぜ二重になりうるのか】

    再生できない曲を選ぶと、ブラウザは2つの経路で失敗を知らせて
    きます。play() が失敗するのと、audio要素の error イベントが
    起きるのと、その両方です。どちらが先に来るかは端末次第なので、
    両方受け取ったうえで、ここで重複を弾いています。

    indexOf は「配列の中で何番目にあるか」を返し、
    無い場合は -1 を返す標準の命令です。
    */
    if(pendingExcludeIds.indexOf(trackId) !== -1){ return; }

    pendingExcludeIds.push(trackId);

    console.log("再生できませんでした(了承待ち) :",track.file_name);

    showExcludePanel();

}


// ==========================================================
// 4. ⚠️パネルの表示
// ==========================================================
/*
画面部品を取り出しておきます。

このファイルは c014.html の末尾で読み込まれるので、この時点で
HTMLは組み上がっています(config.js と同じ理由です)。
*/
const excludePanel = document.getElementById("exclude-panel");
const excludeMessageEl = document.getElementById("exclude-message");
const excludeFilesEl = document.getElementById("exclude-files");
const excludeNoteEl = document.getElementById("exclude-note");
const excludeOkBtn = document.getElementById("exclude-ok");

/**
 * 了承待ちの曲を並べて、⚠️パネルを表示します。
 */
function showExcludePanel(){

    if(pendingExcludeIds.length === 0){ return; }

    /*
    了承待ちの中に「まだ除外されていない曲」が1つでもあるかを調べます。

    some() は「配列の中に条件を満たすものが1つでもあるか」を
    true / false で返す標準の命令です。

    これを見ているのは、メッセージを2通りに出し分けるためです。

        新しく失敗した曲がある … これから一番下へ移す、という案内
        全部すでに除外済み     … 再挑戦したがやはり駄目だった、という案内

    すでに一番下にいる曲に「一番下へ移します」と出すと、竹弘が
    実機で見た時に話が噛み合わなくなってしまいます。
    */
    const hasNewOne = pendingExcludeIds.some(function(trackId){
        return !isExcluded(libraryMap[trackId]);
    });

    // ---- 1. 本文(何が起きたか) ----
    if(hasNewOne){
        excludeMessageEl.textContent =
            "このブラウザが対応していない形式のようです。";
    }
    else{
        excludeMessageEl.textContent =
            "やはり再生できませんでした。";
    }

    // ---- 2. 対象のファイル名 ----
    /*
    どの曲のことなのかが分からないと、竹弘は確かめようがありません。
    タイトルではなくファイル名を出しているのは、パソコンやスマホの
    フォルダを開いて現物を探せるようにするためです。

    map() は「配列の要素を1つずつ変換して新しい配列を作る」命令、
    join("\n") は「配列を改行で繋いで1つの文字にする」命令です。
    */
    excludeFilesEl.textContent = pendingExcludeIds.map(function(trackId){

        const track = libraryMap[trackId];

        return track ? (track.file_name || "(名称不明)") : "(名称不明)";

    }).join("\n");

    // ---- 3. これからどうなるか ----
    if(hasNewOne){
        excludeNoteEl.textContent =
            "一覧の一番下へグレー表示で移します(削除はしません)。\n" +
            "タップすればもう一度試せます。";
    }
    else{
        excludeNoteEl.textContent =
            "このまま一覧の一番下に残します(削除はしません)。";
    }

    excludePanel.style.display = "flex";

}

/*
「了承」ボタンが押された時の受付です。

パネルを閉じるだけでなく、ここで初めて除外が確定します。
*/
excludeOkBtn.addEventListener("click",function(){
    confirmExclusion();
});


// ==========================================================
// 5. 除外の確定(了承が押された時)
// ==========================================================
/**
 * 了承待ちの曲をまとめて除外し、曲一覧の一番下へ移します。
 */
async function confirmExclusion(){

    // 押した瞬間にパネルを閉じます(保存を待たせると反応が鈍く感じるため)
    excludePanel.style.display = "none";

    const targetIds = pendingExcludeIds;

    // 溜めていた分は受け取ったので、次の失敗に備えて空にします
    pendingExcludeIds = [];

    if(targetIds.length === 0){ return; }

    for(const trackId of targetIds){

        const track = libraryMap[trackId];

        if(!track){ continue; }

        // すでに除外済みの曲は、日時を上書きしません(最初に除外した順を保つため)
        if(isExcluded(track)){ continue; }

        try{

            /*
            除外した日時を記録します。これが除外の印そのものです。

            Date.now() は1970年1月1日からの経過ミリ秒を返す標準の命令で、
            ノリ注入日時(nori_injected_at)と同じものを使っています。
            数値なので、除外曲が複数あっても「先に除外した順」に
            並べられます。
            */
            track.excluded_at = Date.now();
            track.excluded_reason = EXCLUDE_REASON_CODEC;

            await idbPut(STORE_MUSIC,track);

            console.log(
                "除外しました :",
                track.file_name,
                "/ 除外日時 :",
                new Date(track.excluded_at).toLocaleString()
            );

        }
        catch(error){

            /*
            保存に失敗したら、メモリ上の値も元に戻します。

            戻さないと「画面ではグレーなのに、次に開くと元通り」という
            分かりにくい食い違いが起きます(nori.js と同じ考え方です)。
            */
            track.excluded_at = undefined;
            track.excluded_reason = undefined;

            console.error(
                "除外の保存に失敗 :",
                track.file_name,
                error.name,
                error.message
            );

        }

    }

    // 曲順を組み替えて、画面を作り直します
    await moveExcludedToBottom();

}


// ==========================================================
// 6. 除外曲を一番下へまとめる
// ==========================================================
/**
 * currentOrderList を「通常の曲 → 除外曲」の順に組み替え、保存します。
 *
 * 【並び替えメニューの最下段固定とは別に、なぜこれが要るのか】
 *
 * sort.js の最下段固定は「並び替えボタンを押した時」に効くものです。
 * 一方こちらは、除外した瞬間にその曲を下へ動かすためのもの。
 * 保存もするので、次にアプリを開いた時も一番下から始まります。
 */
async function moveExcludedToBottom(){

    /*
    filter() は「条件に合うものだけを集めた新しい配列を作る」命令です。
    通常の曲と除外曲に振り分けています。
    */
    const normalIds = currentOrderList.filter(function(trackId){
        return !isExcluded(libraryMap[trackId]);
    });

    const excludedIds = currentOrderList.filter(function(trackId){
        return isExcluded(libraryMap[trackId]);
    });

    /*
    除外曲同士は「先に除外した順」に並べます。

    後から除外した曲ほど下に来るので、一番下を見れば
    「最後に諦めた曲」が分かります。
    */
    excludedIds.sort(function(idA,idB){

        const timeA = libraryMap[idA].excluded_at || 0;
        const timeB = libraryMap[idB].excluded_at || 0;

        return timeA - timeB;

    });

    /*
    concat() は2つの配列を繋いで1つにする命令です。
    通常の曲の後ろに除外曲を付けることで、除外曲が必ず末尾になります。
    */
    currentOrderList = normalIds.concat(excludedIds);

    renderList();

    /*
    保存は js/undo.js の共通処理に任せます(並び替えメニューや
    ドラッグ並び替えと同じ入口です)。

    ここで savePreviousOrder() を呼んでいないのは意図的です。
    除外を ↩(一つ前に戻す)の対象にすると、戻した拍子に除外曲が
    一覧の途中へ復活してしまい、「常に一番下」という約束が
    破られてしまうためです。
    */
    await savePlaylistOrder();

}


// ==========================================================
// 7. 除外の解除(鳴るようになった時)
// ==========================================================
/**
 * 曲が正常に再生できた時に呼ばれ、除外されていれば解除します。
 *
 * 竹弘の仕様:
 *     「再解析し、曲が再生できるようになった時は、グレーアウトが外れ、
 *       通常曲と同じ扱いとなる」
 *
 * 【曲の位置を動かさないのはなぜか】
 *
 * 除外を解除しても、その曲は一番下にいたままにしています。
 * 「元の位置」がどこだったかを覚えていないためです。
 *
 * 実用上も困りません。グレーが外れてドラッグできるようになるので、
 * 好きな位置へ動かせますし、並び替えを一度使えば正しい場所へ収まります。
 */
async function clearExclusion(trackId){

    const track = libraryMap[trackId];

    // 除外されていない曲なら、何もすることがありません
    if(!track || !isExcluded(track)){ return; }

    try{

        track.excluded_at = undefined;
        track.excluded_reason = undefined;

        await idbPut(STORE_MUSIC,track);

        // その行だけを作り直して、グレー表示を外します
        refreshRow(trackId);

        console.log("除外を解除しました(再生できました) :",track.file_name);

    }
    catch(error){

        console.error(
            "除外解除の保存に失敗 :",
            track.file_name,
            error.name,
            error.message
        );

    }

}


// ==========================================================
// 8. 除外の対象にしてよいエラーかどうかの判定
// ==========================================================
/*
【この2つの関数が、この機能の安全装置です】

ファイル冒頭で書いたとおり、権限切れや自動再生ブロックまで除外に
してしまうと、369曲が一斉にグレーになる事故が起きます。
そこで「本当にコーデックが原因の失敗」だけを、ここで選り分けます。
*/

/**
 * play() が投げたエラーが、コーデック非対応によるものかを判定します。
 *
 * NotSupportedError … この形式は再生できない  → 除外の対象
 * NotAllowedError   … ブラウザが自動再生を止めた → 対象外
 * AbortError        … 途中で別の曲に変わった     → 対象外
 */
function isCodecFailure(error){

    return !!(error && error.name === "NotSupportedError");

}

/**
 * audio要素の error イベントが、コーデック非対応によるものかを判定します。
 *
 * audioPlayer.error.code には、原因を表す番号が入っています。
 * 番号を直接書かず、ブラウザが用意している名前で比べているのは、
 * その方が何を指しているのか読んで分かるためです。
 *
 *   MEDIA_ERR_DECODE(3)          … 読めたが、音に戻せなかった → 対象
 *   MEDIA_ERR_SRC_NOT_SUPPORTED(4) … この形式には対応していない → 対象
 *   MEDIA_ERR_ABORTED(1)         … 読み込みが中断された        → 対象外
 *   MEDIA_ERR_NETWORK(2)         … 読み込み中の通信エラー      → 対象外
 */
function isCodecMediaError(mediaError){

    if(!mediaError){ return false; }

    return (
        mediaError.code === mediaError.MEDIA_ERR_DECODE ||
        mediaError.code === mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
    );

}
