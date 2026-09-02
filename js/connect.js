/* ============================================================
   曲接続モジュール(拍で繋ぐ司令塔)

   ノリRunの本丸です。曲と曲を **走るリズムを崩さずに** 繋ぎます。

   ------------------------------------------------------------
   【「13=0」接続とは】

   タップ補正(js/tap.js)で、1曲につき2つの位置を測ってあります。

       startTS … 採用8タップの1拍目
       endTS   … その8拍先(13タップ目)。**曲の接続点**

   繋ぐ時は、

       先行曲の13拍目(endTS)  ＝  後続曲の0拍目

   をぴたりと重ねます。0拍目は「1拍目(startTS)の1拍前」です。
   こうすると、曲が変わっても拍の間隔が1ミリも乱れません。

   ------------------------------------------------------------
   【この版(v170)でやること = STEP5の本体】

       1. 助走(プリロール) … 接続点の手前で、次の曲を裏のデッキで
                              音量0のまま走らせ始める
       2. 接続           … 接続点でデッキの主役を交代する
       3. クロスフェード … 音量を拍数ぶんの時間かけて入れ替える
       4. 完走           … 先行曲は止めず、音量0のまま最後まで鳴らす

   4が地味ですが重要です。**音が一瞬も途切れない**ので、OSから見れば
   メディア再生がずっと続いていることになります(移植元の仕様書にも
   「muted ではなく volume = 0 を使用。OSの省電力機能による再生停止を
   防ぐ」と明記されています)。画面ロック中の連続再生が、この構造なら
   自動的に解ける見込みです ―― それを実際に測るのがSTEP6です。

   ------------------------------------------------------------
   【⚠️ 時間には2種類ある。混ぜると必ず壊れる】

   このファイルでいちばん間違えやすいのがここです。

       曲内秒 … その曲のどこを鳴らしているか(audio.currentTime)
                 startTS / endTS もこちら
       実 秒 … 竹弘の腕時計で測った時間(setTimeoutで待つのはこちら)

   再生速度が1.0倍でない限り、この2つは一致しません。

       実秒 = 曲内秒 ÷ 再生速度
       曲内秒 = 実秒 × 再生速度

   例:速度1.13倍で「曲内で16.95秒ぶん」進むのにかかるのは、
      16.95 ÷ 1.13 = 15秒(実秒)。

   変数名の末尾を Sec(実秒) と TS/AtSec(曲内秒) で区別しています。

   ------------------------------------------------------------
   【将来の「脳内整理モード」(おもてなし制御)への備え】

   竹弘の要望(2026-09-02):「接続点を起点に、先行曲と後続曲の接続点を
   設定で動かせるようにしたい。曲と曲の間を開けられるように」

   移植元の仕様書にある機能で、そちらは秒で制御していますが、竹弘の
   指示で **拍数で制御** します(走るリズムを保つため)。

   そのため、このファイルの時間はすべて「拍数 × 1拍の長さ」で
   計算しています。下の CONNECT_OFFSET_BEATS と CONNECT_SILENCE_BEATS を
   0以外にすれば間が開く、という形にしてあります。**v170では0固定**で、
   設定画面から変えられるようにするのはブラッシュアップ段階です。
============================================================ */


// ==========================================================
// 1. 決めごと(定数)
// ==========================================================

/*
助走(プリロール)を始める、接続点の何秒前か(実秒)。

移植元の仕様書は「接続の15秒前から開始」。ここだけ拍ではなく秒で
持っているのは、これが**音楽的な意味を持たない準備時間**だからです。
ファイルを読み込んで鳴らし始めるための余裕であって、耳に聞こえる
長さではありません。
*/
const CONNECT_PRE_ROLL_SEC = 15;

/*
クロスフェードの長さ(拍)。

⚠️ **秒ではなく拍で持ちます。** 竹弘の指示:

    クロスフェードの秒数は拍数で近似してよい
    拍数 = Math.round(目標秒 ÷ 1拍の長さ)。BPM170なら12秒=34拍

走るリズムを崩さないため、このアプリの時間はすべて拍が単位です。
34拍は、マイピッチ170なら約12秒、150なら約13.6秒になります。
テンポが上がるほど短くなりますが、**走っている人の歩数で数えると
いつも34歩**なので、体感は変わりません。
*/
const CONNECT_CROSSFADE_BEATS = 34;

/*
接続点をずらす拍数(将来の「脳内整理モード」用)。

0 なら「13=0」のシームレス接続です。1以上にすると、その拍数ぶん
後続曲の始まりが遅れ、曲と曲の間が開きます。

**v170では0固定。** 設定画面から変えられるようにするのは、竹弘の
指示でブラッシュアップ段階に回してあります。
*/
const CONNECT_OFFSET_BEATS = 0;

/*
接続の前後を無音にする拍数(将来の「脳内整理モード」用)。

移植元の仕様書では「EndTSを中心に前後2秒ずつ(計4秒)を完全無音」。
ランナーが頭の中でリズムを整理し直すための間です。

**v170では0固定。** 上と同じ理由です。
*/
const CONNECT_SILENCE_BEATS = 0;

/*
テンポを変えた時に、助走中の曲の位置を直すかどうかの境目(実秒)。

定規をなぞっている間、テンポの変更は毎コマ起きます。そのたびに
再生位置を書き換えると重くなるので、**ズレがこの値を超えた時だけ**
直します。0.03秒はマイピッチ170で約0.09拍。耳には分かりません。
*/
const CONNECT_RESEEK_THRESHOLD_SEC = 0.03;


// ==========================================================
// 2. 今どういう状態か
// ==========================================================
/*
助走が始まってから接続が終わるまでの間だけ、中身が入ります。
繋いでいない時は null です。

    nextTrackId  … 次に鳴らす曲
    fromDeck     … 先行曲が載っているデッキ
    toDeck       … 後続曲が載っているデッキ(助走中)
    connectAtSec … 接続点(先行曲の曲内秒)。ずらす設定を足した後の値
    beat0AtSec   … 後続曲の0拍目(後続曲の曲内秒)
    timerId      … 接続の予約(setTimeoutの番号)
    startedAt    … 助走を始めた時刻(実秒。ズレの計算に使います)
*/
let connectState = null;

/*
すでに次の曲を探しに行ったかどうかの印です。

助走は timeupdate(0.25秒ごと)で見張っていますが、条件が揃った瞬間に
何度も走らないよう、1回始めたらこの旗を立てます。
*/
let isPreRolling = false;

/*
クロスフェードの「回数券の番号」です。

【なぜ番号が要るのか】

クロスフェードは requestAnimationFrame で少しずつ音量を変え続けます。
この繰り返しは、**竹弘が途中で別の曲を選んでも勝手には止まりません。**

    1. 曲Aから曲Bへクロスフェード中(Aの音量を下げ、Bを上げている)
    2. 竹弘が曲一覧で曲Cをタップ
    3. Cは、Aが載っていたデッキに載る
    4. **クロスフェードは「そのデッキの音量を下げる」続きをやる**
    5. 選んだばかりの曲Cが、勝手に小さくなっていく

そこで、始めるたびに番号を1つ進め、繰り返しの中で「自分の番号が
まだ最新か」を確かめます。新しいクロスフェードが始まったり、
取りやめられたりすると番号が変わるので、古い方は静かに退場します。
*/
let crossfadeGeneration = 0;


// ==========================================================
// 3. 繋げる相手かどうかを見分ける
// ==========================================================
/**
 * その曲が「繋げる曲」かどうかを返します。
 *
 * タップ補正で測った manualBPM / startTS / endTS が揃っていて
 * 初めて繋げます。判定は js/tap.js の hasSavedTapResult() を
 * 借りており、曲一覧の絞り込みとまったく同じ基準です。
 */
function canConnectTrack(track){

    return !!track && hasSavedTapResult(track);

}

/**
 * いま繋ごうとしてよい場面かどうかを返します。
 *
 * 竹弘と確認した「繋ぐ場面/繋がない場面」(2026-09-02):
 *
 *     🕺注入曲が終わって自動で次へ    … 繋ぐ
 *     🛌未注入曲が鳴っている           … 繋がない(接続点が無い)
 *     曲一覧をタップして曲を選んだ     … 繋がない(今すぐ聴きたい意思)
 *     ⏭ ⏮ を押した                    … 繋がない(同上)
 */
function canStartConnect(){

    // このモードでしか繋ぎません(メインメニューはSTEP7で移行します)
    if(!isNoriRunMode){ return false; }

    // すでに助走中なら、二重に始めません
    if(isPreRolling){ return false; }

    /*
    1曲リピート中は繋ぎません。

    同じ曲がループするだけなので繋ぐ相手がいません。しかもこの時は
    audio要素の loop 属性が効いていて、曲が終わってもJSは関与しません
    (v144。画面ロック対策)。その仕組みを邪魔しないためでもあります。
    */
    if(currentPlayMode === PLAY_MODE_ONE){ return false; }

    // 止まっている時に助走を始めても意味がありません
    if(audioPlayer.paused){ return false; }

    // 今鳴っている曲に接続点(endTS)が無ければ、繋ぎようがありません
    return canConnectTrack(libraryMap[currentTrackId]);

}


// ==========================================================
// 4. 時間の計算
// ==========================================================
/**
 * いまのマイピッチでの「1拍の長さ」を実秒で返します。
 *
 * ⚠️ 曲の元テンポではなく **マイピッチ** で計算します。
 *    走っている人が足で感じている拍は、いつもマイピッチだからです。
 *    曲が何であれ、1拍の長さは変わりません。
 */
function getBeatSec(){

    return 60 / noriRunMyPitch;

}

/**
 * その曲の「0拍目」の位置を、曲内秒で返します。
 *
 * 0拍目は1拍目(startTS)の1拍前です。
 *
 * ⚠️ ここでの1拍は **その曲の元テンポでの1拍** です。
 *    startTS がその曲の時間軸の上の値なので、引く長さも同じ
 *    時間軸で測らなければ辻褄が合いません。
 *    (再生速度で伸び縮みするのは、鳴らした時の実秒の方です)
 */
function getBeat0AtSec(track){

    const beatDurAtSec = 60 / track.manualBPM;

    const beat0 = track.startTS - beatDurAtSec;

    /*
    0より手前になることはまずありませんが、A地点を曲の先頭ぎりぎりで
    測った曲では起こりえます。その時は曲の頭を0拍目とみなします。
    */
    return Math.max(beat0,0);

}

/**
 * その曲を、いまのマイピッチで鳴らす時の再生速度を返します。
 */
function getTrackRate(track){

    const base = getEffectiveBaseBpm(track);

    return Math.min(Math.max(noriRunMyPitch / base,RATE_MIN),RATE_MAX);

}

/**
 * 先行曲の接続点を、曲内秒で返します。
 *
 * 「脳内整理モード」で接続点をずらす設定になっていれば、その拍数
 * ぶんだけ後ろへ動かします(v170では0なので endTS のままです)。
 */
function getConnectAtSec(track){

    if(CONNECT_OFFSET_BEATS === 0){ return track.endTS; }

    /*
    ずらす長さは「拍数 × 1拍の長さ(実秒)」で決め、それを先行曲の
    時間軸(曲内秒)へ直します。実秒 → 曲内秒 は再生速度を掛けます。
    */
    const offsetSec = CONNECT_OFFSET_BEATS * getBeatSec();

    return track.endTS + offsetSec * getTrackRate(track);

}


// ==========================================================
// 5. 助走(プリロール)
// ==========================================================
/**
 * 接続点が近づいていたら、次の曲を裏で走らせ始めます。
 *
 * 曲が鳴っている間ずっと(timeupdateのたびに)呼ばれます。
 */
function maybeStartPreRoll(){

    if(!canStartConnect()){ return; }

    const fromTrack = libraryMap[currentTrackId];

    const connectAtSec = getConnectAtSec(fromTrack);

    const fromRate = getTrackRate(fromTrack);

    /*
    接続点まで、あと何秒(実秒)かを求めます。

    残っている曲内秒を再生速度で割ると、腕時計で測った秒になります。
    */
    const remainSec = (connectAtSec - audioPlayer.currentTime) / fromRate;

    // まだ接続点がずっと先なら、何もしません
    if(remainSec > CONNECT_PRE_ROLL_SEC){ return; }

    /*
    接続点を過ぎてしまっている時も何もしません。

    曲の途中から再生した時や、シークバーで飛ばした時に起こります。
    この場合は繋がず、曲が終わってから次へ進みます(今までどおりの動き)。
    */
    if(remainSec <= 0){ return; }

    const nextTrackId = findNextTrackId(currentTrackId);

    if(!nextTrackId){ return; }

    const nextTrack = libraryMap[nextTrackId];

    // 次の曲に接続点が無ければ繋げません(通常は起きません)
    if(!canConnectTrack(nextTrack)){ return; }

    // 除外された曲は鳴らせないので繋ぎません
    if(isExcluded(nextTrack)){ return; }

    // ここから先は非同期(ファイル読み込み)なので、先に旗を立てます
    isPreRolling = true;

    startPreRoll(nextTrackId,remainSec).catch(function(error){

        console.error("助走に失敗しました :",error.name,error.message);

        cancelConnect();

    });

}

/**
 * 次の曲を、裏のデッキで音量0のまま走らせ始めます。
 *
 * @param {string} nextTrackId - 次に鳴らす曲
 * @param {number} remainSec   - 接続点まであと何秒(実秒)か
 */
async function startPreRoll(nextTrackId,remainSec){

    const nextTrack = libraryMap[nextTrackId];

    // --- 権限を確認し直します(js/player.js と同じパターン) ---
    let permission = await nextTrack.file_handle.queryPermission({mode:"read"});

    if(permission !== "granted"){
        permission = await nextTrack.file_handle.requestPermission({mode:"read"});
    }

    if(permission !== "granted"){

        console.error("助走できません(権限が無い) :",nextTrack.file_name);

        cancelConnect();

        return;

    }

    const file = await nextTrack.file_handle.getFile();

    /*
    ---- 助走を始める位置を「逆算」で決めます ----

    ⚠️ ここがこのファイルでいちばん大事な計算です。

    移植元の「接続点の15秒前から裏で鳴らす」を、そのまま
    「次の曲を頭から鳴らす」と読むと**間違い**になります。接続点に
    着いた時には、後続曲はもう0拍目を通り過ぎてしまうからです。

    正しくは **接続点の瞬間に後続曲の0拍目が来るように、開始位置を
    逆算する** ことです。

        後続曲の開始位置 = 0拍目 − 助走の長さ(実秒) × 後続曲の再生速度

    こうすると、両方のデッキが同じだけ時間を進めた結果、接続点で
    「先行曲=endTS」「後続曲=0拍目」がぴたりと揃います。
    */
    const beat0AtSec = getBeat0AtSec(nextTrack);

    const nextRate = getTrackRate(nextTrack);

    /*
    実際の助走の長さを決めます。

    後続曲の0拍目が曲の先頭に近いと、逆算した開始位置が負になって
    しまいます(曲が始まる前から鳴らすことはできません)。その時は
    **助走の方を短くします。** 曲の頭から鳴らし始めて、ちょうど
    接続点で0拍目に届く長さです。
    */
    const maxPreRollSec = beat0AtSec / nextRate;

    const preRollSec = Math.min(remainSec,maxPreRollSec);

    const startAtSec = beat0AtSec - preRollSec * nextRate;

    const toDeck = getIdleDeck();

    // 裏のデッキに次の曲を載せます(古い一時URLはここで解放されます)
    setDeckSource(toDeck,file,nextTrackId);

    /*
    再生位置を指定できるのは、曲の長さが分かってからです。

    src を差し替えた直後は duration も currentTime も使えないため、
    「読み込めた」という合図(loadedmetadata)を待ちます。

    【Promise と await について】
    addEventListener は「起きたら教えて」と頼む書き方で、待つことは
    できません。そこで Promise という「待てる約束」で包み、await で
    合図が来るまでこの行に留まります。
    { once:true } は「1回聞いたら耳を外す」という指定で、書き忘れると
    曲を繋ぐたびに耳が増え続けます。
    */
    await new Promise(function(resolve){

        toDeck.addEventListener("loadedmetadata",resolve,{once:true});

    });

    /*
    ⚠️ 待っている間に、竹弘が別の曲を選んだかもしれません。

    その場合 cancelConnect() が呼ばれて isPreRolling は下りています。
    ここで気づかずに鳴らし始めると、**選んだ覚えのない曲が裏で鳴り
    出します。** 非同期の処理では、待った後にもう一度確かめるのが鉄則です。
    */
    if(!isPreRolling){ return; }

    toDeck.currentTime = startAtSec;

    /*
    音量を0にしてから鳴らします。

    ⚠️ muted(消音)ではなく volume = 0 を使うこと。移植元の仕様書に
       理由が明記されています:「OSの省電力機能による再生停止を防ぐ」。
       消音は「鳴っていない」と見なされることがあります。
    */
    toDeck.volume = 0;

    // このデッキに載っている曲の元テンポで、速さを決めます
    applyPitchToDeck(toDeck,noriRunMyPitch);

    await toDeck.play();

    // 鳴り始めるのを待つ間にも、竹弘の操作が入ったかもしれません
    if(!isPreRolling){

        toDeck.pause();

        return;

    }

    const fromTrack = libraryMap[currentTrackId];

    connectState = {
        nextTrackId : nextTrackId,
        fromDeck    : audioPlayer,
        toDeck      : toDeck,
        connectAtSec: getConnectAtSec(fromTrack),
        beat0AtSec  : beat0AtSec,
        timerId     : null
    };

    // 接続の瞬間を予約します
    scheduleConnect();

    console.log(
        "助走を開始しました :",nextTrack.file_name,
        "/ 接続まで " + preRollSec.toFixed(2) + "秒",
        "/ 開始位置 " + startAtSec.toFixed(2) + "秒"
    );

}


// ==========================================================
// 6. 接続の予約
// ==========================================================
/**
 * 「あと何秒後に繋ぐか」を計算して、その時刻に予約します。
 *
 * 【なぜ timeupdate で見張らないのか】
 *
 * timeupdate は0.25秒ごとにしか起きません。接続点の判定に使うと
 * 最大0.25秒ずれます。マイピッチ170では**約0.7拍**のズレになり、
 * 走っている人には「つまずき」として伝わります。
 *
 * setTimeout なら数十ミリ秒の精度で起こしてもらえるので、
 * 0.1拍以下に収まります。
 */
function scheduleConnect(){

    if(!connectState){ return; }

    // 前の予約が残っていれば取り消します(二重に繋がないため)
    clearConnectTimer();

    const fromTrack = getDeckTrack(connectState.fromDeck);

    if(!fromTrack){ return; }

    const fromRate = getTrackRate(fromTrack);

    const remainSec =
        (connectState.connectAtSec - connectState.fromDeck.currentTime) / fromRate;

    // もう過ぎていれば、待たずに繋ぎます
    if(remainSec <= 0){

        doConnect();

        return;

    }

    connectState.timerId = setTimeout(doConnect,remainSec * 1000);

}

/**
 * 予約を取り消します。
 */
function clearConnectTimer(){

    if(connectState && connectState.timerId !== null){

        clearTimeout(connectState.timerId);

        connectState.timerId = null;

    }

}


// ==========================================================
// 7. 接続の瞬間
// ==========================================================
/**
 * 接続点に来ました。主役のデッキを交代し、音量を入れ替えます。
 */
function doConnect(){

    if(!connectState){ return; }

    /*
    ---- ⚠️ 状態は「いちばん先に」空にします(v171で修正) ----

    【v170で実際に起きた不具合】

    この関数は下の方で showNowPlaying() を呼びます。その先で

        showNowPlaying → updatePitchDisplay → applyTrackTempo
        → applyTempo → rescheduleConnect → scheduleConnect
        → **doConnect(2回目)**

    と一周して、自分自身がもう一度呼ばれていました。v170では状態を
    空にするのがこの関数の最後だったため、2回目の入場を止められず、
    **swapActiveDeck() が2回走って主役が先行曲に戻る**という事故に
    なっていました(竹弘の実機報告:「停止ボタンを押すと後続曲が止まり、
    先行曲が流れてしまう」「接続点以降の先行曲のピッチが急に早くなる」)。

    自分を呼び出しうる処理に触れる**前に**、通り道を閉じておきます。
    これで2回目の doConnect() は先頭の if で静かに引き返します。

    【この形を崩さないこと】
    今後この関数に処理を足す時も、**状態を空にするのは必ず先頭**です。
    後ろに移すと同じ事故が再発します。
    */
    const state = connectState;

    // 予約の取り消しは connectState を見るので、空にする前に済ませます
    clearConnectTimer();

    connectState = null;
    isPreRolling = false;

    const fromDeck    = state.fromDeck;
    const toDeck      = state.toDeck;
    const nextTrackId = state.nextTrackId;

    const nextTrack = libraryMap[nextTrackId];

    if(!nextTrack){

        cancelConnect();

        return;

    }

    /*
    ---- 主役の交代 ----

    ⚠️ 先行曲は **止めません**。音量0のまま最後まで鳴らし続けます。

    止めてしまうと音が途切れ、OSから見て「再生が終わった」ことに
    なります。画面ロック中に次が鳴らなくなる原因がこれでした
    (2026-08-23の調査)。鳴らし続けている限り、OSにとっては1本の
    長い再生が続いているだけです。
    */
    swapActiveDeck();

    // 今鳴っている曲が入れ替わりました
    currentTrackId = nextTrackId;

    /*
    助走中の曲が、何かの理由で止められていた時の保険です。

    ブラウザが裏での再生を止めることがあります(自動再生の制限など)。
    そのまま音量だけ上げても無音のままなので、ここで鳴らし直します。
    走行中に無音が続くのが、いちばん困る失敗のためです。
    */
    if(toDeck.paused){

        console.warn("助走中の曲が止まっていたため、鳴らし直します");

        toDeck.play().catch(function(error){

            console.error("接続時の再生に失敗 :",error.name,error.message);

        });

    }

    /*
    ---- 画面の作り直し ----

    ⚠️ ここは自動では繋がりません。

    シークバーや曲名は「loadedmetadata が起きた時」に更新される
    作りですが、そのイベントは**助走を始めた時点(接続点の15秒前)**に
    起きています。その時はまだ裏のデッキが主役ではないので、
    bindDeckEvent が知らせを弾いていました(js/deck.js)。

    だから交代したこの瞬間に、こちらから呼び直す必要があります。
    助走の時点で曲名を変えてしまうと、15秒も早く表示が変わって
    しまうので、**遅らせているのはわざとです。**

    シークバーは竹弘が選んだA案(接続点で次の曲のバーに切り替える)。
    「接続点は曲が切り替わる所で、とても分かりやすい」(2026-09-02)。
    */
    resetSeekBarForCurrentDeck();
    showNowPlaying(nextTrack);
    updateMediaSessionMetadata(nextTrack);

    // 再生回数を1増やします(曲一覧タップやplayTrackと同じ扱い)
    incrementPlayCount(nextTrackId);

    /*
    ---- クロスフェード ----

    長さは「拍数 × 1拍の長さ」。竹弘の指示で秒ではなく拍で決めます。
    */
    const fadeSec = CONNECT_CROSSFADE_BEATS * getBeatSec();

    startCrossfade(fromDeck,toDeck,fadeSec);

    console.log(
        "接続しました :",nextTrack.file_name,
        "/ クロスフェード " + CONNECT_CROSSFADE_BEATS + "拍 =",
        fadeSec.toFixed(2) + "秒"
    );

    /*
    ⚠️ 状態を空にする処理は、この関数の**先頭**にあります(v171)。
       ここに戻さないこと。理由は先頭のコメントに書いてあります。

    ⚠️ 裏のデッキ(いま完走中の先行曲)は片付けません。まだ鳴っている
       からです。次の助走で setDeckSource() が呼ばれた時に、その中の
       releaseDeckUrl() が古い一時URLを解放します。
    */

}


// ==========================================================
// 8. クロスフェード
// ==========================================================
/**
 * 2枚のデッキの音量を、時間をかけて入れ替えます。
 *
 * ------------------------------------------------------------
 * 【なぜ「等パワー」で変えるのか】
 *
 * 音量を単純に 1→0 と 0→1 で入れ替えると、**真ん中で音が小さく
 * 聞こえます。** 両方0.5では、耳が感じる音の力は合わせて0.5に
 * しかならないためです(音の力は音量の2乗で効きます)。
 *
 * そこで sin と cos を使います。
 *
 *     先行曲 = cos(t × 90度)
 *     後続曲 = sin(t × 90度)
 *
 * 真ん中(t=0.5)では両方 0.707 になり、2乗して足すと
 * 0.5 + 0.5 = 1.0。**始めから終わりまで音の力が一定**になります。
 * DJミキサーのクロスフェーダーが昔からこの形をしています。
 *
 * ------------------------------------------------------------
 * 【⚠️ この関数は後で作り替える前提です】
 *
 * requestAnimationFrame は「画面を描き直すたび」に呼ばれる仕組み
 * なので、**画面が消えている間は止まります。** 走行中はポケットの
 * 中で画面が消えているので、そこでどうなるかをSTEP6で実測します。
 *
 * 止まると分かったら、移植元の仕様書どおり Web Audio の
 * GainNode + 事前予約(linearRampToValueAtTime)へ移します。あちらは
 * 音を作る側のチップに「何秒後にこう変えて」と予約する方式なので、
 * 画面が消えていても正確に動きます。
 *
 * **音量を変える処理をこの関数1つに閉じ込めてあるのは、その時に
 * ここだけ差し替えれば済むようにするためです。**
 *
 * @param {HTMLAudioElement} fromDeck    - 消えていく側(先行曲)
 * @param {HTMLAudioElement} toDeck      - 現れる側(後続曲)
 * @param {number}           durationSec - かける時間(実秒)
 */
function startCrossfade(fromDeck,toDeck,durationSec){

    /*
    performance.now() は、ページを開いてからの経過ミリ秒を返します。
    Date.now() と違って時計合わせの影響を受けないので、時間の差を
    測る用途にはこちらが向いています。
    */
    const startedAt = performance.now();

    // 自分の回数券の番号を取っておきます(上のコメント参照)
    crossfadeGeneration++;

    const myGeneration = crossfadeGeneration;

    function step(){

        /*
        自分より新しいクロスフェードが始まった(または取りやめられた)
        場合は、ここで静かに退場します。続けると、竹弘が選び直した
        ばかりの曲の音量を勝手に下げてしまいます。
        */
        if(myGeneration !== crossfadeGeneration){ return; }

        const elapsedSec = (performance.now() - startedAt) / 1000;

        // 0(始め)から1(終わり)までの進み具合
        const t = Math.min(elapsedSec / durationSec,1);

        // Math.PI / 2 はラジアンで90度です
        const angle = t * Math.PI / 2;

        fromDeck.volume = Math.cos(angle);
        toDeck.volume   = Math.sin(angle);

        if(t < 1){

            requestAnimationFrame(step);

        }
        else{

            /*
            きっちり0と1で終わらせます。

            計算の誤差で 0.0001 のような値が残ると、消えたはずの曲が
            かすかに鳴り続けてしまうためです。
            */
            fromDeck.volume = 0;
            toDeck.volume   = 1;

        }

    }

    requestAnimationFrame(step);

}


// ==========================================================
// 9. 取りやめ
// ==========================================================
/**
 * 繋ぐ準備をすべて取りやめます。
 *
 * 【⚠️ 呼び忘れると事故になります】
 *
 * 予約(setTimeout)は、竹弘が別の曲を選んでも勝手には消えません。
 * 消し忘れると、**新しく選んだ曲を鳴らしている最中に、前の予約が
 * 発火して知らない曲へ切り替わります。**
 *
 * そのため「今の流れが変わる」場所すべてから呼びます。
 *
 *     ・曲を選び直した(js/player.js の playTrack)
 *     ・停止ボタンを押した(js/upper-area.js)
 *     ・モードを抜けた(js/norirun.js)
 */
function cancelConnect(){

    clearConnectTimer();

    /*
    進行中のクロスフェードも止めます。

    番号を進めるだけで、繰り返しの中の見張り(myGeneration !==
    crossfadeGeneration)が次の1コマで気づいて退場します。
    音量は、この後に呼ばれる clearIdleDeck() や、曲を載せ直す時の
    playTrack() が1に戻してくれます。
    */
    crossfadeGeneration++;

    /*
    助走中だった裏のデッキを止めて片付けます。

    clearIdleDeck() は音量も1に戻してくれるので、次にそのデッキが
    主役になる時、無音で始まる心配がありません(js/deck.js)。
    */
    if(connectState || isPreRolling){

        clearIdleDeck();

    }

    connectState = null;
    isPreRolling = false;

}

/**
 * 走行中にテンポが変わった時、予約と助走中の位置を合わせ直します。
 *
 * 【なぜ必要か】
 *
 * 速さが変われば、接続点に着く時刻も変わります。予約したままだと
 * 早すぎたり遅すぎたりする場所で繋がってしまいます。
 *
 * 後続曲の位置も同じです。速さが変わると、接続点までに進む距離が
 * 変わるので、**接続点でちょうど0拍目に来るように置き直します。**
 *
 * js/pitch.js の applyTempo() から呼ばれます。
 */
function rescheduleConnect(){

    if(!connectState){ return; }

    const toDeck = connectState.toDeck;

    const toTrack = getDeckTrack(toDeck);

    if(!toTrack){ return; }

    // まず、2枚とも新しいテンポで鳴るようにします
    applyPitchToDeck(toDeck,noriRunMyPitch);

    const fromTrack = getDeckTrack(connectState.fromDeck);

    if(!fromTrack){ return; }

    // 接続点まで、あと何秒(実秒)か
    const remainSec =
        (connectState.connectAtSec - connectState.fromDeck.currentTime)
        / getTrackRate(fromTrack);

    if(remainSec > 0){

        /*
        後続曲が「いま居るべき位置」を計算し直します。

        接続点で0拍目に来るには、そこから remainSec ぶん手前に
        いなければなりません(曲内秒に直すので再生速度を掛けます)。
        */
        const shouldBeAtSec =
            connectState.beat0AtSec - remainSec * getTrackRate(toTrack);

        const gapSec = Math.abs(toDeck.currentTime - shouldBeAtSec);

        /*
        ズレが小さいうちは動かしません。

        定規をなぞっている間、この関数は毎コマ呼ばれます。そのたびに
        再生位置を書き換えると音の処理が追いつかなくなるためです。
        */
        if(gapSec > CONNECT_RESEEK_THRESHOLD_SEC && shouldBeAtSec >= 0){

            toDeck.currentTime = shouldBeAtSec;

        }

    }

    // 予約を取り直します
    scheduleConnect();

}


// ==========================================================
// 10. 見張り役をつなぐ
// ==========================================================
/*
曲が進むたびに、接続点が近づいていないかを見ます。

⚠️ bindDeckEvent(js/deck.js)を通します。2枚のデッキ両方に耳を付け、
   **いま鳴っている方からの知らせだけ**を受け取るためです。
   繋いでいる最中は2曲が同時に鳴っているので、この選別が無いと
   裏で鳴っている曲の進み具合で助走を始めてしまいます。
*/
bindDeckEvent("timeupdate",function(){

    maybeStartPreRoll();

});
