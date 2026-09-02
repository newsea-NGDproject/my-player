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
クロスフェードの長さ(拍)の選び方。設定 ⚙️ →「🎚️ 曲の繋ぎ方」で
竹弘が選びます(v172)。

⚠️ **秒ではなく拍で持ちます。** 竹弘の指示:

    クロスフェードの秒数は拍数で近似してよい
    拍数 = Math.round(目標秒 ÷ 1拍の長さ)

走るリズムを崩さないため、このアプリの時間はすべて拍が単位です。
テンポが上がるほど秒数は短くなりますが、**走っている人の歩数で
数えるといつも同じ歩数**なので、体感は変わりません。

【なぜ選べるようにしたか(v172)】

v170は34拍(マイピッチ170で約12秒)でした。移植元の仕様書にある
「フェード10秒」に合わせた値です。しかし竹弘の実機テストで:

    「お互いの音がまだ結構大きい状況でクロスしている。
      先行曲と後続曲の音が大きい状況で二つが重なって、
      しかもその鳴る時間が長いと耳障りだね」

あの10秒は**無音を挟む前提**の数字で、「重ねる時間」に流用したのが
誤りでした。長さの好みは耳で確かめるしかないので、2つ用意して
聞き比べられるようにしています。
*/
const CROSSFADE_BEATS_LONG  = 16;   // ゆっくり繋ぐ(マイピッチ170で約5.6秒)
const CROSSFADE_BEATS_SHORT = 8;    // さっと繋ぐ  (マイピッチ170で約2.8秒)

// いま選ばれている長さ。設定画面で切り替え、DBにも残します
let crossfadeBeats = CROSSFADE_BEATS_LONG;

/*
接続点をはさんで無音にする長さ(拍)。**ノリRunの本命の機能です。**

    12拍 … マイピッチ170で約4.2秒(仕様書の「計4秒間」に相当)
     0拍 … 無音なし(DJのように重ねて繋ぐ)

------------------------------------------------------------
【なぜ無音が要るのか ―― 竹弘の発見(2026-09-02)】

    「同じピッチでただ接続するだけだと、イッチ、ニッ、イッチ、ニッ、
      てノッテ走っているのが、ニッ、イッチ、ニッ、イッチという曲接続
      される可能性があり、これがランナーにとってズッコケる、
      転ぶ要因となる」

「13=0」接続は**拍の間隔**を守りますが、**どちらの足で踏む拍か**まで
は揃えられません。先行曲の13拍目が小節の何拍目か、後続曲の0拍目が
何拍目かは曲ごとに違うためです。テンポは完璧に合っているのに、
表と裏が入れ替わって足が乱れる、ということが起こります。

    「無音から曲が流れ始めた時に、人間の脳内が自動的に
      イッチ、ニッ、イッチ、ニッというように脳内整理される」

無音をはさむと、脳は次に鳴り出した音を「1拍目」として捉え直します。
**DJのように繋ぐ必要はなく、むしろ繋がない方が転ばない。**
移植元の仕様書がこれを「脳内整理モード(おもてなし制御)」と呼び、
本番機能と位置づけていた理由がここにあります。

------------------------------------------------------------
【⚠️ 無音でも音は止めません】

音量を0にするだけで、両方のデッキは鳴らし続けます。pause すると
OSから見て「再生が終わった」ことになり、画面ロック中に次が鳴らなく
なるためです(仕様書にも「muted ではなく volume = 0 を使用。OSの
省電力機能による再生停止を防ぐ」と明記されています)。
**耳には無音、OSには再生中** ―― これが両立の要です。
*/
const SILENCE_BEATS_ON  = 12;
const SILENCE_BEATS_OFF = 0;

// いま選ばれている無音の長さ。設定画面で切り替え、DBにも残します
let silenceBeats = SILENCE_BEATS_OFF;

/*
クロスフェードのカーブの深さ。

【この数字が効くところ】

音量は cos と sin で入れ替えますが、その結果を「何乗するか」が
この値です。**大きいほど、入れ替わりの真ん中で両方の音が小さく
なります。**

    1.0 … 中間で両方 0.71(等パワー。DJミキサーの標準)
    2.0 … 中間で両方 0.50
    3.0 … 中間で両方 0.35  ← いまここ

竹弘の要望「もう2段階くらい音が小さくなった所でクロスしたい」に
合わせて 3.0 にしました。

【なぜDJの標準(1.0)ではいけないのか】

等パワーは「音の力を一定に保つ」ので中間でも両方はっきり聞こえます。
DJがそれで濁らないのは、**ミキサーのEQで低音を片方だけ切っている**
からです。低音が2つ重なると一発で濁るのは、DJの世界では常識です。

ノリRunは音量しか触っていないので、低音がまるごと2つ重なります。
さらにDJは調(キー)の合う曲を選んで繋ぎますが、こちらは竹弘が
好きな曲を好きな順に並べるので、調は揃いません。
**だからDJより深い谷が要る**、というのが竹弘の耳の判断でした。
*/
const CONNECT_CROSSFADE_CURVE = 3.0;

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

    nextTrackId    … 次に鳴らす曲
    fromDeck       … 先行曲が載っているデッキ
    toDeck         … 後続曲が載っているデッキ(助走中)
    connectAtSec   … 接続点(先行曲の曲内秒)。ずらす設定を足した後の値
    beat0AtSec     … 後続曲の0拍目(後続曲の曲内秒)
    timerId        … 接続の瞬間の予約(setTimeoutの番号)
    fadeOutTimerId … 先行曲フェードアウト開始の予約(無音モードのみ)

⚠️ 無音モードのフェードインだけは、ここに番号を持ちません。
   接続の瞬間(doConnect)にこの状態を空にしてから予約するためです。
   代わりに connectGeneration(回数券)で見張っています。
*/
let connectState = null;

/*
すでに次の曲を探しに行ったかどうかの印です。

助走は timeupdate(0.25秒ごと)で見張っていますが、条件が揃った瞬間に
何度も走らないよう、1回始めたらこの旗を立てます。
*/
let isPreRolling = false;

/*
接続の「回数券の番号」です。

【なぜ番号が要るのか】

無音モードでは、フェードインを setTimeout で予約します。この予約は
**竹弘が途中で別の曲を選んでも勝手には消えません。**

    1. 曲Aから曲Bへ、無音をはさんで接続中
    2. 無音の間に、竹弘が曲一覧で曲Cをタップ
    3. 予約の時刻が来て、**曲Bのフェードインが始まってしまう**

そこで、接続や取りやめのたびに番号を1つ進め、予約が目を覚ました時に
「自分の番号がまだ最新か」を確かめます。古ければ何もせず引き返します。

⚠️ 音量そのものの予約(GainNode)には、この番号は要りません。
   あちらは新しい予約を入れる時に cancelScheduledValues() で
   古い予約を消すので、取り違えが起こらないためです
   (js/deck.js の rampDeckVolume)。
*/
let connectGeneration = 0;


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

    ⚠️ muted(消音)ではなく音量0を使うこと。移植元の仕様書に理由が
       明記されています:「OSの省電力機能による再生停止を防ぐ」。
       消音は「鳴っていない」と見なされることがあります。

    v174から setDeckVolume() を通します。音量つまみ(GainNode)が
    音量を持つようになったため、<audio>.volume を直に書き換えても
    効かなくなったためです(js/deck.js の音量回路)。
    */
    setDeckVolume(toDeck,0);

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
        nextTrackId   : nextTrackId,
        fromDeck      : audioPlayer,
        toDeck        : toDeck,
        connectAtSec  : getConnectAtSec(fromTrack),
        beat0AtSec    : beat0AtSec,
        timerId       : null,
        fadeOutTimerId: null
    };

    // 接続の瞬間を予約します
    scheduleConnect();

    /*
    無音モードでは、フェードアウトは**接続点より前**から始まります。
    そのぶんの予約も、ここで入れておきます(無音なしの時は何もしません)。
    */
    scheduleFadeOut();

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
 *
 * 接続点・フェードアウト・フェードインの3つを、まとめて消します。
 * **1つでも消し忘れると、後からその時刻に発火して音量を勝手に
 * いじられます。** 増やした時はここにも必ず足すこと。
 */
function clearConnectTimer(){

    if(!connectState){ return; }

    [ "timerId","fadeOutTimerId" ].forEach(function(key){

        if(connectState[key] !== null){

            clearTimeout(connectState[key]);

            connectState[key] = null;

        }

    });

}

/**
 * 無音モードで、先行曲のフェードアウト開始を予約します(v173)。
 *
 * ------------------------------------------------------------
 * 【時間の並び(接続点をTとします)】
 *
 *     T − 無音/2 − フェード … 先行曲フェードアウト開始
 *     T − 無音/2           … 先行曲が無音に
 *     T                    … ★接続点(後続曲の0拍目・デッキ交代)
 *     T + 無音/2           … 後続曲フェードイン開始
 *     T + 無音/2 + フェード … 後続曲がフル音量
 *
 * **無音が接続点をまたぐ**のがポイントです。移植元の仕様書の
 * 「EndTS(0秒地点)を中心に、前後2秒ずつ(計4秒間)を完全無音とする」を
 * そのまま拍で表しています。
 *
 * 走っている人から見ると「曲が消える → 少し無音 → 新しい曲が始まる」
 * となり、脳が新しい曲の頭を1拍目として捉え直せます。
 */
function scheduleFadeOut(){

    if(!connectState){ return; }

    // 無音なし(クロスフェード)の時は、接続点でまとめて入れ替えます
    if(silenceBeats === 0){ return; }

    const fromTrack = getDeckTrack(connectState.fromDeck);

    if(!fromTrack){ return; }

    const beatSec = getBeatSec();

    // 接続点の何秒前にフェードアウトを始めるか
    const leadSec = (silenceBeats / 2 + crossfadeBeats) * beatSec;

    const remainSec =
        (connectState.connectAtSec - connectState.fromDeck.currentTime)
        / getTrackRate(fromTrack);

    const waitSec = remainSec - leadSec;

    /*
    もうその時刻を過ぎている場合は、待たずに始めます。

    助走が短くなった曲(0拍目が曲の先頭に近い曲)では、助走を始めた
    時点ですでにフェードアウトの開始時刻を過ぎていることがあります。
    */
    if(waitSec <= 0){

        startConnectFadeOut();

        return;

    }

    connectState.fadeOutTimerId = setTimeout(startConnectFadeOut,waitSec * 1000);

}

/**
 * 先行曲のフェードアウトを始めます(無音モードのみ)。
 */
function startConnectFadeOut(){

    if(!connectState){ return; }

    connectState.fadeOutTimerId = null;

    const fadeSec = crossfadeBeats * getBeatSec();

    startFade(connectState.fromDeck,1,0,fadeSec);

    console.log("フェードアウト開始 :",crossfadeBeats + "拍 =",fadeSec.toFixed(2) + "秒");

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
    ---- 音の入れ替え ----

    長さは「拍数 × 1拍の長さ」。竹弘の指示で秒ではなく拍で決めます。
    やり方は設定によって2通りに分かれます。
    */
    const beatSec = getBeatSec();
    const fadeSec = crossfadeBeats * beatSec;

    if(silenceBeats === 0){

        /*
        ---- ① クロスフェード(DJのように重ねて繋ぐ) ----

        先行曲を下げながら、同時に後続曲を上げます。音は途切れません。
        */
        startCrossfade(fromDeck,toDeck,fadeSec);

        console.log(
            "接続しました :",nextTrack.file_name,
            "/ クロスフェード " + crossfadeBeats + "拍 =",
            fadeSec.toFixed(2) + "秒"
        );

    }
    else{

        /*
        ---- ② 脳内整理モード(無音をはさんで繋ぐ) ----

        先行曲のフェードアウトは、この時点で**すでに終わっています**
        (scheduleFadeOut が接続点より前に始めているため)。いまは無音の
        真ん中で、これから後続曲が出てくるのを待つところです。

        竹弘の発見のとおり、ここで一度音が消えることで、走っている人の
        脳が次の曲の頭を「1拍目」として取り直せます。
        */
        const halfSilenceSec = (silenceBeats / 2) * beatSec;

        /*
        ⚠️ connectState はこの関数の先頭ですでに空にしてあるので、
           このフェードインの予約はタイマー台帳に載せられません。
           代わりに**クロスフェードの回数券(connectGeneration)**で
           見張ります。竹弘が途中で曲を選び直すと cancelConnect() が
           番号を進めるので、この予約は目を覚ました時に自分が
           古いことに気づいて、何もせず引き返します。
        */
        const myGeneration = connectGeneration;

        setTimeout(function(){

            // 取りやめられていたら、何もしません
            if(myGeneration !== connectGeneration){ return; }

            startFade(toDeck,0,1,fadeSec);

            console.log("フェードイン開始 :",crossfadeBeats + "拍");

        },halfSilenceSec * 1000);

        console.log(
            "接続しました :",nextTrack.file_name,
            "/ 無音 " + silenceBeats + "拍 =",
            (silenceBeats * beatSec).toFixed(2) + "秒",
            "/ フェード " + crossfadeBeats + "拍"
        );

    }

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
 * ただしノリRunでは、その等パワーのままだと音が大きすぎました。
 * カーブを深くして谷を作っています(CONNECT_CROSSFADE_CURVE)。
 *
 * ------------------------------------------------------------
 * 【v174で作り替えました】
 *
 * v173までは requestAnimationFrame で毎コマ音量を書き換えていました
 * が、竹弘の実機テストで**音程がヨレる**不具合が出ました。2曲同時に
 * 速度変換(WSOLA)が走っている最中に、1秒120回も命令を飛ばしていた
 * ことが原因です。
 *
 * いまは音量の道すじを**1回だけ予約**し、音を作る側に任せています。
 * 移植元の仕様書が「16msごとの逐次処理を廃止」「ボリューム曲線を
 * ハードウェアへ書き込む」と記していたのと同じやり方です。
 * 詳しい経緯は js/deck.js の音量回路のコメントにまとめました。
 *
 * おまけに、**画面が消えていても正確に動く**ようになりました
 * (requestAnimationFrame は画面が消えると止まっていた)。
 *
 * @param {HTMLAudioElement} fromDeck    - 消えていく側(先行曲)
 * @param {HTMLAudioElement} toDeck      - 現れる側(後続曲)
 * @param {number}           durationSec - かける時間(実秒)
 */
function startCrossfade(fromDeck,toDeck,durationSec){

    /*
    2本の道すじを用意して、それぞれのデッキに1回ずつ予約します。
    予約したらこの関数の仕事は終わりで、あとは音を作る側が正確に
    実行してくれます(v174。理由は js/deck.js の音量回路のコメント)。
    */
    rampDeckVolume(fromDeck,buildCurve(1,0,CONNECT_CROSSFADE_CURVE),durationSec);
    rampDeckVolume(toDeck,  buildCurve(0,1,CONNECT_CROSSFADE_CURVE),durationSec);

}

/**
 * 音量の「道すじ」を作ります(v174)。
 *
 * ------------------------------------------------------------
 * 【道すじとは】
 *
 * Web Audio の音量つまみには、「この並びのとおりに音量を動かして」と
 * 数値の列を渡せます。0.0秒でこの値、0.1秒でこの値…と、なめらかに
 * つないで実行してくれます。
 *
 * 64個も点があれば、耳には完全になめらかに聞こえます。
 * (v173まではこれを毎コマ計算して命令していました。同じ形の音量
 *  変化を、**先に全部書いて渡してしまう**のがv174の考え方です)
 *
 * ------------------------------------------------------------
 * 【power(カーブの深さ)について】
 *
 *     power = 1 … まっすぐ(直線)。無音モードの単独フェードで使う
 *     power > 1 … 入れ替わりの真ん中で両方の音が小さくなる
 *
 * クロスフェードでは、cos と sin を power 乗して谷を作ります。
 * 竹弘の「もう2段階くらい音が小さくなった所でクロスしたい」に
 * 応えている部分です(詳しくは CONNECT_CROSSFADE_CURVE のコメント)。
 *
 * @param  {number} fromVol - 始めの音量(0〜1)
 * @param  {number} toVol   - 終わりの音量(0〜1)
 * @param  {number} power   - カーブの深さ。1ならまっすぐ
 * @return {Float32Array} 音量の道すじ
 */
function buildCurve(fromVol,toVol,power){

    const STEPS = 64;

    /*
    Float32Array は「小数だけを入れる、決まった長さの箱」です。
    Web Audio が受け取れるのはこの形だけなので、ふつうの配列
    ([] で作るもの)ではなく、こちらを使います。
    */
    const curve = new Float32Array(STEPS);

    for(let i = 0; i < STEPS; i++){

        // 0(始め)から1(終わり)までの進み具合
        const t = i / (STEPS - 1);

        if(power === 1){

            // まっすぐ結ぶだけ
            curve[i] = fromVol + (toVol - fromVol) * t;

            continue;

        }

        /*
        谷のあるカーブ。Math.PI / 2 はラジアンで90度です。

        下がる側は cos(1から0へ)、上がる側は sin(0から1へ)を使い、
        その結果を power 乗して谷を深くします。
        */
        const angle = t * Math.PI / 2;

        const shape = (fromVol > toVol)
            ? Math.cos(angle)
            : Math.sin(angle);

        curve[i] = Math.pow(shape,power);

    }

    /*
    終わりの値をきっちり合わせます。

    計算の誤差で 0.0001 のような値が残ると、消えたはずの曲が
    かすかに鳴り続けてしまうためです。
    */
    curve[STEPS - 1] = toVol;

    return curve;

}

/**
 * 1枚のデッキだけを、時間をかけて上げ下げします(v173)。
 *
 * 無音をはさむ「脳内整理モード」で使います。クロスフェードが2枚を
 * 同時に動かすのに対し、こちらは片方だけです。
 *
 *     フェードアウト … startFade(先行曲, 1, 0, 秒)
 *     フェードイン   … startFade(後続曲, 0, 1, 秒)
 *
 * カーブは付けません。クロスフェードで谷を作っていたのは「2曲が
 * 重なる真ん中を薄くする」ためでしたが、こちらはそもそも重ならない
 * ので、まっすぐ上げ下げするのがいちばん自然に聞こえます。
 *
 * ⚠️ フェードアウトとフェードインは無音をはさんで時間がずれるので、
 *    互いに打ち消し合うことはありません。取りやめの時は
 *    cancelConnect() が音量の予約ごと消します。
 *
 * @param {HTMLAudioElement} deck        - 動かすデッキ
 * @param {number}           fromVol     - 始めの音量(0〜1)
 * @param {number}           toVol       - 終わりの音量(0〜1)
 * @param {number}           durationSec - かける時間(実秒)
 */
function startFade(deck,fromVol,toVol,durationSec){

    // 始めの音量に合わせてから、道すじを予約します
    setDeckVolume(deck,fromVol);

    rampDeckVolume(deck,buildCurve(fromVol,toVol,1),durationSec);

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
    まだ発火していないフェードインの予約を無効にします。

    番号を進めるだけで、予約が目を覚ました時に「自分は古い」と
    気づいて何もせず引き返します(connectGeneration のコメント参照)。
    */
    connectGeneration++;

    /*
    進行中の音量変化も、その場で止めます(v174)。

    音量つまみ(GainNode)への予約は、JavaScriptの都合とは無関係に
    音を作る側で走り続けます。**ここで消さないと、竹弘が選び直した
    ばかりの曲の音量が、予約どおりに下げられていきます。**

    setDeckVolume() は「今の音量をこれにして、予約は全部取り消す」
    という命令なので、これ1つで両方を果たせます(js/deck.js)。

    主役のデッキを1(最大)に戻すのは、繋いでいる途中で取りやめた時に
    **中途半端な音量のまま鳴り続けるのを防ぐ**ためです。
    */
    setDeckVolume(audioPlayer,1);

    /*
    助走中だった裏のデッキを止めて片付けます。

    clearIdleDeck() は音量も1に戻してくれるので、次にそのデッキが
    主役になる時、無音で始まる心配がありません(js/deck.js)。
    */
    if(connectState || isPreRolling){

        clearIdleDeck();

    }
    else{

        /*
        繋ぎ終わった後(完走中の先行曲が裏にいる)も、その音量の予約を
        消しておきます。クロスフェードの途中で取りやめた場合、裏の
        デッキにはまだ「下げていく」予約が残っているためです。
        */
        setDeckVolume(getIdleDeck(),0);

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
// 10. 繋ぎ方の設定(保存と読み込み)
// ==========================================================
/*
選んだ長さは settings ストアに残し、次にアプリを開いた時も同じ
繋ぎ方で始められるようにします(再生モードや並び順の保存と同じ考え方)。

走る前に決めた設定が、走り出す時にも残っていてほしいためです。
*/

/**
 * 曲の繋ぎ方を変えて、保存します。
 *
 * @param {number} beats   - フェードの長さ(CROSSFADE_BEATS_LONG / SHORT)
 * @param {number} silence - 無音の長さ(SILENCE_BEATS_ON / OFF)
 */
async function setConnectStyle(beats,silence){

    /*
    知らない値が入ってきた時は、安全な方へ倒します。

    設定画面のボタン以外から呼ばれることは今のところありませんが、
    保存してある値が将来の版と食い違った時に、変な繋ぎ方をして
    しまわないようにするための関門です。
    */
    if(beats !== CROSSFADE_BEATS_LONG && beats !== CROSSFADE_BEATS_SHORT){

        beats = CROSSFADE_BEATS_LONG;

    }

    if(silence !== SILENCE_BEATS_ON && silence !== SILENCE_BEATS_OFF){

        silence = SILENCE_BEATS_OFF;

    }

    crossfadeBeats = beats;
    silenceBeats   = silence;

    console.log(
        "曲の繋ぎ方を変えました :",
        "フェード " + crossfadeBeats + "拍 /",
        (silenceBeats === 0 ? "無音なし" : "無音 " + silenceBeats + "拍")
    );

    try{

        // settings ストアはキーを自分で指定する形なので、3つ目の引数に渡します
        await idbPut(STORE_SETTINGS,crossfadeBeats,"crossfade_beats");
        await idbPut(STORE_SETTINGS,silenceBeats,"connect_silence_beats");

    }
    catch(error){

        console.error("繋ぎ方の保存に失敗 :",error.name,error.message);

    }

}

/**
 * 保存してある繋ぎ方を読み込みます。
 *
 * js/main.js の起動処理から呼ばれます。
 */
async function loadCrossfadeSetting(){

    try{

        const savedBeats   = await idbGet(STORE_SETTINGS,"crossfade_beats");
        const savedSilence = await idbGet(STORE_SETTINGS,"connect_silence_beats");

        /*
        今のコードが知っている値である時だけ受け入れます。
        将来この選択肢を変えた場合に、古い値が残っていても壊れない
        ようにするためです(再生モードの読み込みと同じ守り方)。
        */
        if(savedBeats === CROSSFADE_BEATS_LONG || savedBeats === CROSSFADE_BEATS_SHORT){

            crossfadeBeats = savedBeats;

        }

        if(savedSilence === SILENCE_BEATS_ON || savedSilence === SILENCE_BEATS_OFF){

            silenceBeats = savedSilence;

        }

    }
    catch(error){

        console.error("繋ぎ方の読み込みに失敗 :",error.name,error.message);

    }

}


// ==========================================================
// 11. 見張り役をつなぐ
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
