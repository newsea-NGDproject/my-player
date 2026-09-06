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
助走として、最低でもこれだけは確保する秒数です(v184)。

【なぜ必要か ―― 「助走が届かない曲」の問題】

後続曲は0拍目より**手前**から鳴らし始めますが、0拍目が曲の頭に近い曲
では手前に遡れません(曲が始まる前には行けないため)。v183は「遡れる
限界より先には助走を始めない」作りなので、限界が0秒に近い曲では
**助走がいつまでも始まらず、その曲へは繋がらないまま曲が終わります。**
しかも警告すら出ないので、静かに接続だけが失われます。

図解と経緯は `docs/connect-preroll-limit.html` にまとめてあります。

【3秒という数字について】

竹弘の判断:「A地点の遡りはあまり重要ではないので、安全策の3秒でいいよ」。

ファイルの読み込み(権限確認・getFile・loadedmetadata)にかかる時間を
吸収できる長さです。竹弘のハイエンド機での実測は43〜80msでしたが、
**ミドルクラス機ではもっとかかる**ので、余裕を持たせています。
*/
const CONNECT_MIN_PRE_ROLL_SEC = 3;

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
======================================================================
 繋ぎ方の「種類」(v190)
======================================================================

上の crossfadeBeats / silenceBeats は、どちらも **13拍目=0拍目で繋ぐ**
という同じやり方の中の調整でした。v190で、**やり方そのものが違う**
繋ぎ方が加わったので、種類を持つようにします。

    "beat" … 13拍目=0拍目で繋ぐ(これまでの4つ)
             先行曲の途中(13拍目)で次の曲へ渡す。曲の後半は聴けない

    "head" … 頭出し接続(v190で追加)
             **先行曲を最後まで聴いて、無音をはさみ、次の曲を頭から**

【竹弘の構想(2026-09-05)】

    13拍目=0拍目をアンカーとして、そこから逆算することで、
    先行曲を最後まで聞いて、4秒くらい無音があって、その後曲の
    最初から聴ける。（略）でも曲が進むとアンカーによってガッチリ
    合うという繋ぐ選択肢の完成だ。

【何が「完成」なのか】

    🎧 重ねて繋ぐ … 途切れない。ノンストップで走りたい時
    🧘 無音をはさむ … 脳を整理して足を取り直したい時
    🎬 頭出し接続 … **曲を曲として楽しみたい時**

3つ目は「音楽プレイヤーとしての自然さ」を取り戻す選択肢です。
ノリRunが**走る道具であると同時に音楽プレイヤーでもある**という
位置づけに合います。
*/
const CONNECT_STYLE_BEAT = "beat";
const CONNECT_STYLE_HEAD = "head";

let connectStyle = CONNECT_STYLE_BEAT;

/*
頭出し接続で、先行曲が終わってから次の曲が鳴り出すまでの目安(秒)。

⚠️ **この秒数はあくまで目安です。** 実際の長さは、後続曲の0拍目が
   拍の格子にぴたり乗るように前後します(最大で1拍ぶん＝マイピッチ170
   なら0.35秒)。竹弘の「4秒くらい」という言い方どおりの動きです。

**4秒ちょうどより拍を優先する**のがこの機能の要です。逆にすると、
走るリズムを守るというノリRunの目的そのものが崩れます。
*/
const CONNECT_HEAD_GAP_SEC = 4;

/*
頭出し接続で、曲の終わりの何秒前から準備を始めるか。

後続曲のファイルを読み込んで、鳴らせる状態にしておくための時間です。
無音をはさんでから鳴らすので、**読み込みだけ先に済ませて待機**します。
*/
const CONNECT_HEAD_LEAD_SEC = 20;

/*
頭出し接続で、曲の終わりの何秒手前で先行曲を止めるか。

【⚠️ なぜ「ちょうど」ではいけないのか ―― ended との競合】

曲が自然に最後まで再生されると `ended` が起きて、js/queue.js の
「曲が終わりました。次の曲へ進みます」が動き出します。**予約してある
頭出し接続と取り合いになり、次の曲へ二重に進んでしまいます。**

止める予約は setTimeout で入れており、混んでいる時は数十ミリ秒
遅れることがあります。ちょうどの時刻を狙うと、その遅れのぶんだけ
曲が終わりきってしまう可能性が残ります。

そこで**わずかに手前**で止めます。0.2秒は曲の末尾(たいていは余韻か
フェードアウトの終わり)なので、耳では違いが分かりません。

⚠️ この余裕を0にしないこと。「最後まできっちり」を狙うと、
   **たまに次の曲へ飛ぶ**という再現しにくい不具合になります。
*/
const CONNECT_HEAD_STOP_MARGIN_SEC = 0.2;

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
 * 後続曲を「どの拍に合わせて繋ぐか」を、曲内秒で返します(v184)。
 *
 * ふつうは0拍目です。**助走が足りない曲のときだけ、拍の単位で後ろへ
 * ずらします。**
 *
 * 【なぜ拍の単位でずらすのか ―― ここが要】
 *
 * 秒でずらすと、繋いだ瞬間に足のリズムが崩れます。拍の単位でずらせば
 * **拍の格子はまったく同じまま**なので、ランナーの足は乱れません。
 * 変わるのは「後続曲の頭が数拍ぶん飛ぶ」という聴こえ方だけです。
 *
 *     0拍目  1拍  2拍  3拍  4拍  …   ← 格子は動かない
 *       ┊    ┊   ┊   ┊   ┊
 *       ✗                ●            ← ここに合わせて繋ぐ(例:3拍目)
 *     遡れない         ここなら手前に3秒とれる
 *
 * 【これは保険で、ふだんは発動しない】
 *
 * 竹弘の実機ログでの遡れる限界は 7.07〜30.19秒でした。3秒を下回るのは
 * **A地点を曲の頭ぎりぎりに置いた曲だけ**です。さらに v184 でA地点に
 * 下限を設けたので、これから注入する曲では起きません。
 * **すでに注入済みの曲を救うための道**として用意しています。
 *
 * @param  {Object} track - 後続曲
 * @return {number} 繋ぐ拍の位置(曲内秒)
 */
function getConnectAnchorSec(track){

    const beat0AtSec = getBeat0AtSec(track);

    const rate = getTrackRate(track);

    // 0拍目に合わせた場合、手前に何秒とれるか(実秒)
    const maxPreRollSec = beat0AtSec / rate;

    // 足りているなら、今までどおり0拍目で繋ぎます
    if(maxPreRollSec >= CONNECT_MIN_PRE_ROLL_SEC){ return beat0AtSec; }

    /*
    足りない分を、拍いくつぶんで埋められるかを求めます。

    ⚠️ 2つの時間軸を行き来する点に注意してください。足りない量は
       「腕時計で何秒」ですが、拍の長さは「曲の中で何秒」なので、
       再生速度を掛けて曲の時間軸へ直してから割ります。
    */
    const beatDurSongSec = 60 / getEffectiveBaseBpm(track);

    if(!isFinite(beatDurSongSec) || beatDurSongSec <= 0){ return beat0AtSec; }

    const shortRealSec = CONNECT_MIN_PRE_ROLL_SEC - maxPreRollSec;

    const shortSongSec = shortRealSec * rate;

    // Math.ceil(切り上げ)なので、足りないまま終わることはありません
    const beats = Math.ceil(shortSongSec / beatDurSongSec);

    const anchorSec = beat0AtSec + beats * beatDurSongSec;

    console.log(
        "繋ぐ拍をずらしました :",track.file_name,
        "/ 0拍目では手前に " + maxPreRollSec.toFixed(2) + "秒しかとれないため",
        "/ " + beats + "拍うしろへ",
        "/ 曲の頭 " + anchorSec.toFixed(2) + "秒地点で接続"
    );

    return anchorSec;

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

    /*
    頭出し接続を選んでいる時は、まったく別の道を通ります(v190)。

    ⚠️ **ここから下(13拍目=0拍目で繋ぐ道)には一切手を入れていません。**
       接続はノリRunの心臓部なので、新しい繋ぎ方は「別の道を1本足す」
       形にして、既存の4つの動きが変わらないようにしています。
    */
    if(connectStyle === CONNECT_STYLE_HEAD){

        maybeStartHeadConnect();

        return;

    }

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

    /*
    ================================================================
    ⚠️⚠️ 助走を「始めてよい時刻」まで待ちます(v183)
    ================================================================

    【v182まで残っていた、接続がズレる本当の原因】

    後続曲は「接続点でちょうど0拍目に来る」ように、0拍目から助走の
    ぶんだけ**手前**から鳴らし始めます。ところが0拍目が曲の頭に近い
    曲では、15秒も手前に遡れません(曲が始まる前になってしまう)。

    そこで startPreRoll() では**助走の方を短くして**、曲の頭から
    鳴らすようにしていました。ここまでは正しい判断です。

    **間違っていたのは「いつ鳴らし始めるか」でした。**
    助走を短くしたのに、鳴らし始めるのは「今すぐ」のままだったため:

        接続点まで      11.94秒
        遡れる限界       8.95秒  ← この曲は8.95秒ぶんしか助走できない
                ↓
        曲の頭から今すぐ鳴らし始める
                ↓
        8.95秒後に0拍目を通過。でも接続点まではまだ2.99秒ある
                ↓
        接続点が来た時、後続曲は0拍目を **2.99秒(6.97拍)も過ぎている**

    竹弘の実機ログ(2026-09-05)がこれを正確に写していました:

        助走の位置 : 狙い 0.000秒 / 実際 0.000秒 / ズレ 0ms
        ★接続の瞬間 : 先行曲 2ms / 後続曲 2990ms / 拍のズレ -2987ms

    **開始位置が 0.00秒 ＝ 限界に張り付いた印**です。ズレ 2.99秒は
    「11.94 − 8.95」とぴったり一致しました。

    【なぜ「同じ曲でうまく行く時と行かない時」があったのか】

    同じ後続曲(NewJeans ETA.m4a)でも:

        接続まで10.85秒 → 限界より短い → 制限がかからない → ズレ 0.01拍 ✅
        接続まで11.94秒 → 限界を超えた → 制限がかかる    → ズレ 6.97拍 ❌

    **接続点までの残りが「その曲の限界」をまたぐかどうか**で結果が
    変わっていました。走行中にマイピッチを変えると再生速度が変わり、
    限界の秒数も動くので、余計に再現しませんでした。

    → **限界より先には、そもそも助走を始めない。** そうすれば
       0拍目を通り過ぎる余分が生まれません。

    ⚠️ この計算に必要なのは startTS と元テンポだけで、**音声ファイルを
       読む必要はありません**(DBの情報だけで分かる)。だから読み込みの
       前に判断できます。
    */
    const nextRate = getTrackRate(nextTrack);

    /*
    ⚠️ getBeat0AtSec ではなく getConnectAnchorSec を使います(v184)。

    助走が足りない曲では繋ぐ拍を後ろへずらすので、遡れる限界も
    そのぶん伸びます。**下の startPreRoll() と同じ関数を使うこと。**
    片方だけ0拍目のままにすると、「始めてよい」と判断した時刻と
    実際に置く位置が食い違い、また接続がズレます。
    */
    const maxPreRollSec = getConnectAnchorSec(nextTrack) / nextRate;

    /*
    「今から始めてよい」時刻。15秒と、その曲の限界の**短い方**です。

    ⚠️ 限界いっぱいで始めると、ファイルの読み込み時間ぶんだけ
       出遅れます(v182で入れた補正が、そのぶん助走を削ります)。
       それでも 0拍目より手前から鳴り始めることに変わりはないので、
       拍はズレません。読み込みが間に合わない極端な場合だけ、
       startPreRoll() の中で「繋がない」と判断します。
    */
    const startWhenSec = Math.min(CONNECT_PRE_ROLL_SEC,maxPreRollSec);

    if(remainSec > startWhenSec){ return; }

    // ここから先は非同期(ファイル読み込み)なので、先に旗を立てます
    isPreRolling = true;

    startPreRoll(nextTrackId,remainSec).catch(function(error){

        console.error("助走に失敗しました :",error.name,error.message);

        cancelConnect();

    });

}

/**
 * 曲が入れ替わった直後の後始末をまとめて行います(v190で切り出し)。
 *
 * ⚠️ ここは自動では繋がりません。シークバーや曲名は
 *    「loadedmetadata が起きた時」に更新される作りですが、そのイベントは
 *    **後続曲を読み込んだ時点**(まだ裏のデッキだった頃)に起きていて、
 *    bindDeckEvent が「主役じゃない」と弾いているためです(js/deck.js)。
 *
 * だから交代したこの瞬間に、こちらから呼び直します。
 *
 * @param {Object} nextTrack - 新しく主役になった曲
 */
function refreshAfterConnect(nextTrack){

    resetSeekBarForCurrentDeck();
    showNowPlaying(nextTrack);
    updateMediaSessionMetadata(nextTrack);

    // 再生回数を1増やします(曲一覧タップやplayTrackと同じ扱い)
    incrementPlayCount(nextTrack.track_id);

}


// ==========================================================
// 5-2. 頭出し接続(v190)
// ==========================================================
/*
先行曲を最後まで聴いて、無音をはさみ、次の曲を頭から鳴らす繋ぎ方です。

【13拍目=0拍目で繋ぐ道との違い】

    これまで … 先行曲の13拍目で次へ渡す。後続曲は0拍目から鳴る
                (＝後続曲の頭は飛ぶ / 先行曲の後半は聴けない)

    頭出し   … 先行曲を最後まで鳴らす。無音。後続曲は**0秒から**鳴る
                (＝どちらの曲も丸ごと聴ける)

【それでも拍が合う理由 ―― アンカー】

拍の格子は先行曲の13拍目(endTS)から、ずっと同じ間隔で続いています。
後続曲の0拍目がその格子にぴたり乗るように、**無音の長さを前後させて**
辻褄を合わせます。ずれるのは最大1拍ぶんなので「4秒くらい」に収まります。

    先行曲 ━━━━━━━━━━┫(曲の最後)
            …13拍目…      ←無音→
    後続曲                      ━━━━━━━━━━
                                頭      ▲0拍目 ここで格子に乗る
    拍の格子 ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊  ┊

【⚠️ 無音でも音は止めません(v191)】

耳には無音ですが、**後続曲が音量0で鳴り続けています。** 他の繋ぎ方と
同じ考え方です(SILENCE_BEATS_ON のコメント参照)。

    竹弘の懸念:「『この繋ぎ方だけ、音が完全に途切れます』これは避けたい」

v190では無音が明けてから後続曲を play() していました。しかしそれでは
**v144以前の「曲が終わってから次を鳴らし直す」構造への逆戻り**で、
画面を消したまま走ると数曲で無言になります。Androidが止めるのは
「**音が途切れた後に** JSが play() を呼ぶ」ことだからです。

→ 先行曲が鳴っているうちに play() を済ませ、音量0で待たせておいて、
   **無音明けには位置を頭へ戻すだけ**にしました。位置と音量の変更には
   あの制限がかからないので、両立します。

竹弘の提案(L5レイヤーで無音を鳴らして再生継続に見せる)と狙いは同じ
ですが、**後続曲自身にその役をさせる**のでレイヤーが増えません。
*/

/**
 * 曲の終わりが近づいていたら、頭出し接続の準備を始めます。
 */
function maybeStartHeadConnect(){

    const fromTrack = libraryMap[currentTrackId];

    if(!fromTrack){ return; }

    /*
    曲の終わりまで、あと何秒(実秒)か。

    ⚠️ 曲の長さは <audio> が実際に測った値を使います。DBの値
       (track.duration)は登録時のもので、わずかにずれることがあるためです。
       接続の基準になる数字なので、実測を優先します。
    */
    const durationSec = audioPlayer.duration;

    if(!isFinite(durationSec) || durationSec <= 0){ return; }

    const fromRate = getTrackRate(fromTrack);

    const remainToEndSec = (durationSec - audioPlayer.currentTime) / fromRate;

    // まだ曲の終わりが遠ければ、何もしません
    if(remainToEndSec > CONNECT_HEAD_LEAD_SEC){ return; }

    // 曲が終わってしまっていたら、繋がずに今までどおりの動きに任せます
    if(remainToEndSec <= 0){ return; }

    const nextTrackId = findNextTrackId(currentTrackId);

    if(!nextTrackId){ return; }

    const nextTrack = libraryMap[nextTrackId];

    if(!canConnectTrack(nextTrack)){ return; }

    if(isExcluded(nextTrack)){ return; }

    // ここから先は非同期(ファイル読み込み)なので、先に旗を立てます
    isPreRolling = true;

    startHeadConnect(nextTrackId).catch(function(error){

        console.error("頭出し接続の準備に失敗 :",error.name,error.message);

        cancelConnect();

    });

}

/**
 * 後続曲を読み込んで待機させ、鳴らし始める時刻を予約します。
 *
 * @param {string} nextTrackId - 次に鳴らす曲
 */
async function startHeadConnect(nextTrackId){

    const nextTrack = libraryMap[nextTrackId];

    // --- 権限を確認し直します(js/player.js と同じパターン) ---
    let permission = await nextTrack.file_handle.queryPermission({mode:"read"});

    if(permission !== "granted"){
        permission = await nextTrack.file_handle.requestPermission({mode:"read"});
    }

    if(permission !== "granted"){

        console.error("頭出し接続できません(権限が無い) :",nextTrack.file_name);

        cancelConnect();

        return;

    }

    const file = await nextTrack.file_handle.getFile();

    const toDeck = getIdleDeck();

    setDeckSource(toDeck,file,nextTrackId);

    await new Promise(function(resolve){

        toDeck.addEventListener("loadedmetadata",resolve,{once:true});

    });

    // 待っている間に竹弘の操作が入ったかもしれません
    if(!isPreRolling){ return; }

    /*
    ---- ここから時刻の逆算 ----

    ⚠️ **読み込みを待った「今」を基準に計算します。** 待つ前の値を使うと、
       読み込みにかかった時間ぶんだけ全部がずれます(v182で直したのと
       まったく同じ落とし穴です)。
    */
    const fromTrack = libraryMap[currentTrackId];

    if(!fromTrack){ cancelConnect(); return; }

    const durationSec = audioPlayer.duration;
    const fromRate    = getTrackRate(fromTrack);
    const toRate      = getTrackRate(nextTrack);

    if(!isFinite(durationSec) || durationSec <= 0){ cancelConnect(); return; }

    // 先行曲が終わるまで、あと何秒か
    const remainToEndSec = (durationSec - audioPlayer.currentTime) / fromRate;

    if(remainToEndSec <= 0){

        console.warn("頭出し接続が間に合いませんでした :",nextTrack.file_name);

        cancelConnect();

        return;

    }

    /*
    拍の格子の基準点(アンカー)まで、あと何秒か。

    先行曲の13拍目(endTS)です。**もう通り過ぎていれば負の数**になり
    ますが、それで構いません。格子は前にも後ろにも無限に続いていて、
    下の計算は「基準点から何拍ぶん離れているか」しか見ないためです。
    */
    const anchorSec = getConnectAtSec(fromTrack);

    const remainToAnchorSec = (anchorSec - audioPlayer.currentTime) / fromRate;

    // 拍の間隔(実秒)。マイピッチそのもの
    const beatSec = getBeatSec();

    if(!isFinite(beatSec) || beatSec <= 0){ cancelConnect(); return; }

    /*
    後続曲を「頭から」鳴らした時、0拍目が来るまでの長さ。

    曲の中の距離(beat0AtSec)を再生速度で割って、実際の秒に直します。
    */
    const beat0AtSec = getBeat0AtSec(nextTrack);

    const beat0DelaySec = beat0AtSec / toRate;

    /*
    ---- 0拍目を、格子のどの点に乗せるかを決めます ----

    まず「こうなってほしい」時刻を出し、それに**いちばん近い格子の点**を
    選びます。Math.round なので、前後どちらへでも最大半拍しか動きません。
    */
    const wishBeat0Sec =
        remainToEndSec + CONNECT_HEAD_GAP_SEC + beat0DelaySec;

    let beatIndex = Math.round((wishBeat0Sec - remainToAnchorSec) / beatSec);

    let beat0Sec = remainToAnchorSec + beatIndex * beatSec;

    let startDelaySec = beat0Sec - beat0DelaySec;

    /*
    ⚠️ 後続曲が先行曲より先に鳴り出さないようにします。

    格子に合わせた結果、開始が手前へ寄りすぎることがあります。その時は
    **1拍ずつ後ろへずらして**、先行曲が終わった後に来るまで送ります。
    拍の単位でずらすので、格子からは外れません。

    上限を付けているのは、計算がおかしくなった時に無限に回らないための
    安全装置です(通常は1〜2回で収まります)。
    */
    let guard = 0;

    while(startDelaySec < remainToEndSec && guard < 64){

        beatIndex++;

        beat0Sec = remainToAnchorSec + beatIndex * beatSec;

        startDelaySec = beat0Sec - beat0DelaySec;

        guard++;

    }

    /*
    ================================================================
    ⚠️⚠️ 後続曲は「今すぐ」音量0で鳴らし始めます(v191)
    ================================================================

    【なぜ無音明けまで待たないのか ―― 音を途切れさせないため】

    v190では無音が明けてから play() を呼んでいました。しかしそれは
    **v144以前の「曲が終わってから次を鳴らし直す」構造への逆戻り**です。

    Androidが止めるのは「**音が途切れた後に** JSが play() を呼ぶ」こと
    でした(2026-08-23の調査)。画面を消したまま走ると、数曲で無言に
    なります。既存の助走(プリロール)が成立しているのも、**音が途切れる
    前に呼んでいる**からです。

    → 先行曲が鳴っているうちに play() を済ませ、**音量0のまま待たせます。**

        ① いま(先行曲が鳴っている)  … play() する。音量0
        ② 先行曲が終わる            … 後続曲が音量0で鳴っている
                                       ＝ OSから見て再生は途切れていない
        ③ 無音明け                  … currentTime を0に戻して音量1

    **currentTime の変更と音量の変更には、あの制限がかかりません。**
    だから「曲の頭から聴かせる」と「音を途切れさせない」が両立します。

    竹弘の提案(L5レイヤーで無音を鳴らして再生継続に見せる)と狙いは
    同じですが、**後続曲自身にその役をさせる**ので、新しいレイヤーも
    タイマーも増えません。

    ⚠️ 待っている間、後続曲は音量0のまま曲を進みます(先行曲の残り＋無音の
       ぶん)。③で頭へ戻すので、耳に届くのは必ず0秒からです。60秒未満の
       曲は対象外なので、待っている間に曲が終わることはありません。
    */
    toDeck.currentTime = 0;

    setDeckVolume(toDeck,0);

    applyPitchToDeck(toDeck,noriRunMyPitch);

    await toDeck.play();

    // 鳴り始めるのを待つ間にも、竹弘の操作が入ったかもしれません
    if(!isPreRolling){

        toDeck.pause();

        return;

    }

    /*
    ---- 予約を入れます ----

    ① 先行曲を止める … 曲の終わり
    ② 後続曲を鳴らす … 無音をはさんだ後

    connectState に控えるのは、竹弘が途中で別の曲を選んだ時に
    cancelConnect() から取り消せるようにするためです。
    */
    connectState = {
        nextTrackId   : nextTrackId,
        fromDeck      : audioPlayer,
        toDeck        : toDeck,
        connectAtSec  : durationSec,
        beat0AtSec    : 0,
        timerId       : null,
        fadeOutTimerId: null,
        headStyle     : true
    };

    /*
    先行曲を止める予約。**曲が終わりきる少し手前**を狙います
    (理由は CONNECT_HEAD_STOP_MARGIN_SEC のコメント)。
    */
    const stopDelaySec = Math.max(
        0,
        remainToEndSec - CONNECT_HEAD_STOP_MARGIN_SEC
    );

    connectState.fadeOutTimerId = setTimeout(function(){

        stopHeadFromDeck();

    },stopDelaySec * 1000);

    connectState.timerId = setTimeout(function(){

        doHeadConnect();

    },startDelaySec * 1000);

    const silenceSec = startDelaySec - remainToEndSec;

    console.log(
        "頭出し接続を予約しました :",nextTrack.file_name,
        "/ 曲の終わりまで " + remainToEndSec.toFixed(2) + "秒",
        "/ 無音 " + silenceSec.toFixed(2) + "秒",
        "/ 0拍目まで " + beat0Sec.toFixed(2) + "秒",
        "(格子の " + beatIndex + " 拍目に合わせました)"
    );

}

/**
 * 先行曲を、曲の終わりで止めます(v190)。
 *
 * ⚠️ **ended を待たずに、こちらから止める**のが要です。曲が自然に
 *    終わると ended が起きて、js/queue.js の「次の曲へ」が動き出し、
 *    予約した頭出し接続と取り合いになります。ほんのわずか手前で
 *    止めることで、**あちらのファイルに一切手を入れずに**済ませています。
 */
function stopHeadFromDeck(){

    if(!connectState || !connectState.headStyle){ return; }

    const fromDeck = connectState.fromDeck;

    connectState.fadeOutTimerId = null;

    if(!fromDeck || fromDeck.paused){ return; }

    fromDeck.pause();

    console.log("先行曲を最後まで鳴らし終えました(ここから無音)");

}

/**
 * 無音が明けたら、後続曲を頭から鳴らします(v190)。
 */
function doHeadConnect(){

    if(!connectState || !connectState.headStyle){ return; }

    /*
    ⚠️ 状態は「いちばん先に」空にします。理由は doConnect() の冒頭に
       書いてあるものと同じで、この先で呼ぶ showNowPlaying() が
       巡り巡ってここへ戻ってくる道があるためです。
    */
    const state = connectState;

    clearConnectTimer();

    connectState = null;
    isPreRolling = false;

    const fromDeck    = state.fromDeck;
    const toDeck      = state.toDeck;
    const nextTrackId = state.nextTrackId;

    const nextTrack = libraryMap[nextTrackId];

    if(!nextTrack){ cancelConnect(); return; }

    // 先行曲がまだ鳴っていたら(予約が遅れた場合)、ここで確実に止めます
    if(!fromDeck.paused){ fromDeck.pause(); }

    /*
    ---- 曲の頭へ戻します(v191) ----

    後続曲は先行曲が鳴っているうちから、音量0で鳴り続けていました
    (そうしないと無音の間に音が途切れ、画面を消したまま走った時に
    止まってしまうため)。**耳に届く前に頭へ戻すことで、竹弘の
    「曲の最初から聴ける」を実現します。**

    ⚠️ ここで play() を呼ばないのが要です。**すでに鳴っている**ので
       呼ぶ必要がなく、呼べば逆にAndroidの制限に触れます。位置を
       動かすだけなら、その制限はかかりません。
    */
    toDeck.currentTime = 0;

    swapActiveDeck();

    currentTrackId = nextTrackId;

    // 音量を上げます。この繋ぎ方はクロスフェードしません
    setDeckVolume(toDeck,1);

    /*
    何かの理由で止められていた時の保険です(ブラウザが裏での再生を
    止めることがあります)。ふだんはここを通りません。
    */
    if(toDeck.paused){

        console.warn("後続曲が止まっていたため、鳴らし直します");

        toDeck.play().catch(function(error){

            console.error("頭出し接続の再生に失敗 :",error.name,error.message);

        });

    }

    /*
    画面の作り直し。13拍目=0拍目で繋ぐ道と同じ3つを呼びます
    (シークバー・曲名・Media Session)。自動では繋がりません。
    */
    refreshAfterConnect(nextTrack);

    console.log("頭出し接続しました :",nextTrack.file_name);

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
    /*
    ⚠️ 変数名は beat0AtSec のままですが、v184からは**必ずしも0拍目とは
       限りません。** 助走が足りない曲では、getConnectAnchorSec() が
       拍の単位で後ろへずらした位置を返します(拍の格子は同じなので、
       ランナーの足は乱れません)。

       名前を変えなかったのは、この値が connectState 経由で
       doConnect() のログや rescheduleConnect() の位置計算まで
       流れており、**まとめて改名すると触る範囲が広がる**ためです。
       意味は「後続曲が接続点で居るべき位置」で一貫しています。
    */
    const beat0AtSec = getConnectAnchorSec(nextTrack);

    const nextRate = getTrackRate(nextTrack);

    /*
    実際の助走の長さを決めます。

    後続曲の0拍目が曲の先頭に近いと、逆算した開始位置が負になって
    しまいます(曲が始まる前から鳴らすことはできません)。その時は
    **助走の方を短くします。** 曲の頭から鳴らし始めて、ちょうど
    接続点で0拍目に届く長さです。
    */
    const maxPreRollSec = beat0AtSec / nextRate;

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

    /*
    ================================================================
    ⚠️⚠️ 助走の開始位置は、**待ち終わったここで**計算します(v182)
    ================================================================

    【v181まであった、接続がズレる原因】

    この関数に入ってから、ここへ来るまでに**3回も待って**います。

        await queryPermission()   … 権限の確認
        await getFile()           … ファイルの取り出し
        await loadedmetadata      … 音声の読み込み

    端末やファイルの大きさによって、この待ち時間は**数十ミリ秒から
    数百ミリ秒**まで変わります。そして**待っている間も、先行曲は
    進み続けています。**

    v181までは、この関数を**呼ぶ前**に測った remainSec で開始位置を
    決めていました。つまり:

        呼ばれた時   「接続点まで、あと15.0秒」 ← この前提で位置を決めた
        待ち終わった時「接続点まで、あと14.8秒」 ← 実際はこう

    後続曲を「15秒ぶん手前」に置いてしまうので、接続点が来た時には
    **まだ0拍目に0.2秒ぶん届いていない**ことになります。
    マイピッチ170なら1拍が0.353秒なので、**0.57拍のズレ**です。

    【これが竹弘の報告した2つのパターンを両方説明します】

      パターン1「各曲はメトロノームと合うのに、接続で合わない」
        → メトロノームは**その曲の実際の再生位置**から拍を計算するので、
          どちらの曲も単独では必ず合います。合わなくなるのは
          「後続曲がいるべき位置にいない」接続の瞬間だけ

      パターン2「同じ曲でも、うまく行く時とズレる時がある」
        → **読み込み時間は毎回違います**(OSのキャッシュに載っているか、
          その瞬間に端末がどれだけ忙しいか)。だからズレ幅も毎回変わる。
          **再現しないこと自体が、この原因を指していました**

    → **待ち終わった「今」の残り時間で計算し直せば、待ち時間が
       どれだけかかっても吸収されます。**

    ⚠️ 今後この関数に await を足す時は、**必ずこの計算より前に置くこと。**
       後ろに足すと、その待ち時間ぶんが再びズレになります。
    */
    const fromTrack = libraryMap[currentTrackId];

    if(!fromTrack){ cancelConnect(); return; }

    const connectAtSec = getConnectAtSec(fromTrack);

    const freshRemainSec =
        (connectAtSec - audioPlayer.currentTime) / getTrackRate(fromTrack);

    /*
    読み込みに手間取って、接続点を過ぎてしまった時は繋ぎません。

    無理に繋ぐと、0拍目を通り過ぎた位置から後続曲が鳴り始め、
    **拍が合わないまま曲が変わります。** それなら繋がずに、
    曲が終わってから次へ進む方が安全です(今までどおりの動き)。
    */
    if(freshRemainSec <= 0){

        console.warn("助走が間に合わなかったため、繋ぎません :",nextTrack.file_name);

        cancelConnect();

        return;

    }

    const preRollSec = Math.min(freshRemainSec,maxPreRollSec);

    const startAtSec = beat0AtSec - preRollSec * nextRate;

    toDeck.currentTime = startAtSec;

    /*
    【開発用調査ログ】狙った位置と、実際に置かれた位置のズレ(v182)

    <audio> の currentTime は、**指定した位置ぴったりには止まりません。**
    MP3やAACは音を小さな塊(フレーム)にまとめて保存しており、その
    区切りの位置にしか飛べないためです(MP3で約26ミリ秒、AACで約23
    ミリ秒の粒)。

    上の待ち時間を直した後も接続がズレるなら、**次に疑うのはここ**です。
    数値が見えていないと当てずっぽうになるので、記録に残します。

    ⚠️ 原因が判明したら、この console.log は消してよい(CLAUDE.mdの
       「本番リリース前に削除するもの」の考え方)。
    */
    console.log(
        "助走の位置 : 狙い " + startAtSec.toFixed(3) + "秒" +
        " / 実際 " + toDeck.currentTime.toFixed(3) + "秒" +
        " / ズレ " + ((toDeck.currentTime - startAtSec) * 1000).toFixed(0) + "ms" +
        " / 読み込み待ちの補正 " + ((remainSec - freshRemainSec) * 1000).toFixed(0) + "ms" +
        /*
        v183で追加。**残り時間が限界を超えていたら、そこが赤信号**です。

        竹弘のログで「開始位置 0.00秒」が失敗の印だったので、その原因に
        あたる2つの数字を並べて出します。maybeStartPreRoll() が正しく
        待てていれば、残りは必ず限界以下になっているはずです。
        */
        " / 残り " + freshRemainSec.toFixed(2) + "秒" +
        " / 遡れる限界 " + maxPreRollSec.toFixed(2) + "秒" +
        (freshRemainSec > maxPreRollSec ? " ★限界超え" : "")
    );

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

    /*
    「音量0で助走中」の旗を立てます(v176)。

    これを立てると、このデッキは音程維持(preservesPitch)を切った状態
    で鳴ります。音程維持はWSOLAという重い計算で成り立っており、
    **音量0で誰にも聞こえていない15秒間、その計算を回し続けるのは
    まるごと無駄**だからです。その負荷が、聞こえている側の曲の
    「音程のヨレ」になって出ていました(竹弘の実機報告)。

    ⚠️ 順番が大事です。**必ず applyPitchToDeck() より前に立てます。**
       applyPitchToDeck() はこの旗を見て preservesPitch を決めるので、
       後から立てると、この場では音程維持が入ったままになります。

    詳しい仕組みは js/deck.js の deckSilentPreRoll のコメントに
    書いてあります。
    */
    setDeckSilentPreRoll(toDeck,true);

    // このデッキに載っている曲の元テンポで、速さを決めます
    applyPitchToDeck(toDeck,noriRunMyPitch);

    await toDeck.play();

    // 鳴り始めるのを待つ間にも、竹弘の操作が入ったかもしれません
    if(!isPreRolling){

        toDeck.pause();

        return;

    }

    /*
    ⚠️ connectAtSec は、上で位置を計算した時と**同じ値**を使います(v182)。

    ここでもう一度 getConnectAtSec() を呼ぶこともできますが、その間に
    マイピッチが変わっていると**位置の計算に使った接続点と、予約に使う
    接続点が食い違います。** 一度決めた値を使い回すのが安全です。
    */
    connectState = {
        nextTrackId   : nextTrackId,
        fromDeck      : audioPlayer,
        toDeck        : toDeck,
        connectAtSec  : connectAtSec,
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
    【開発用調査ログ】接続の瞬間に、本当に拍が揃っているか(v182)

    ここがノリRunの心臓部です。この瞬間、2つの曲は

        先行曲 … ちょうど接続点(endTS)にいるはず
        後続曲 … ちょうど0拍目(beat0)にいるはず

    でなければなりません。**耳で「少しズレた」と感じた時、それが
    何ミリ秒なのかを数字で見られるようにします。**

    ズレを「拍」でも出しているのは、竹弘が判断しやすいためです。
    0.5拍なら裏返っている(表と裏が入れ替わった)、0.1拍なら
    わずかなズレ、という読み方ができます。

    ⚠️ 原因が判明したら、この console.log は消してよい。
    */
    const fromTrackNow = getDeckTrack(fromDeck);

    if(fromTrackNow && nextTrack){

        // 変数名を logBeatSec としているのは、下の方にある beatSec と
        // 見分けやすくするためです(別のブロックなので衝突はしません)
        const logBeatSec = getBeatSec();

        const fromGapSec = fromDeck.currentTime - state.connectAtSec;
        const toGapSec   = toDeck.currentTime - state.beat0AtSec;

        /*
        曲内秒のズレを、実際の時間(実秒)に直してから拍に換算します。
        曲は再生速度で伸び縮みしているので、曲内秒のままでは
        「耳に聞こえるズレ」になりません。
        */
        const fromGapRealSec = fromGapSec / getTrackRate(fromTrackNow);
        const toGapRealSec   = toGapSec / getTrackRate(nextTrack);

        const totalGapSec = fromGapRealSec - toGapRealSec;

        console.log(
            "★接続の瞬間 : 先行曲 " + (fromGapRealSec * 1000).toFixed(0) + "ms" +
            " / 後続曲 " + (toGapRealSec * 1000).toFixed(0) + "ms" +
            " / 拍のズレ " + (totalGapSec * 1000).toFixed(0) + "ms" +
            " (" + (totalGapSec / logBeatSec).toFixed(2) + "拍)"
        );

    }

    /*
    ---- 音程維持を戻す(v176) ----

    助走の間、後続曲は音程維持(preservesPitch)を切った状態で鳴って
    いました。音量0で聞こえていない音のために、WSOLAという重い計算を
    回すのが無駄だったためです(js/deck.js の deckSilentPreRoll 参照)。

    **ここが、その後続曲が初めて耳に届く瞬間です。** この行より後に
    クロスフェードが始まり、音量が0から上がっていきます。だから
    ここで戻せば、聞こえる時にはもう正しい音程になっています。

    ⚠️ この位置(クロスフェードより前)から動かさないこと。後ろへ
       ずらすと、音が出始めてから音程が切り替わることになり、
       **繋ぎ目で音程がガクッと動いて聞こえます。**

    ⚠️ 逆に、ここより前へ大きく戻すのも意味がありません。無駄な
       WSOLAを回す時間が、そのぶん延びるだけです。
    */
    setDeckSilentPreRoll(toDeck,false);

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

    ⚠️ v190で refreshAfterConnect() に切り出しました。頭出し接続でも
       まったく同じ後始末が要るためで、**2か所に書くと片方だけ直す
       事故が起きます**(findWrapAroundTrackId を切り出した時と同じ理由)。
    */
    refreshAfterConnect(nextTrack);

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
async function setConnectStyle(beats,silence,style){

    /*
    繋ぎ方の種類を先に決めます(v190)。

    ⚠️ 引数を省いて呼ばれたら、これまでどおり「13拍目=0拍目で繋ぐ」に
       します。**既存の呼び出しを1つも書き換えずに済ませる**ためです。
    */
    connectStyle = (style === CONNECT_STYLE_HEAD)
        ? CONNECT_STYLE_HEAD
        : CONNECT_STYLE_BEAT;

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
        connectStyle === CONNECT_STYLE_HEAD
            ? "頭出し接続(曲を最後まで聴いて、無音、次の曲を頭から)"
            : "フェード " + crossfadeBeats + "拍 / " +
              (silenceBeats === 0 ? "無音なし" : "無音 " + silenceBeats + "拍")
    );

    /*
    ⚠️ 繋ぎ方を変えたら、進行中の予約は取り消します(v190)。

    やり方そのものが変わるので、前のやり方で入れた予約が残っていると
    **半分だけ古い繋ぎ方**という妙な状態になります。走りながら設定を
    変えた時に、次の1回だけおかしくなるのを防ぎます。
    */
    cancelConnect();

    try{

        // settings ストアはキーを自分で指定する形なので、3つ目の引数に渡します
        await idbPut(STORE_SETTINGS,crossfadeBeats,"crossfade_beats");
        await idbPut(STORE_SETTINGS,silenceBeats,"connect_silence_beats");
        await idbPut(STORE_SETTINGS,connectStyle,"connect_style");

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

        const savedStyle = await idbGet(STORE_SETTINGS,"connect_style");

        // 今のコードが知っている種類の時だけ受け入れます(v190)
        if(savedStyle === CONNECT_STYLE_HEAD || savedStyle === CONNECT_STYLE_BEAT){

            connectStyle = savedStyle;

        }

    }
    catch(error){

        console.error("繋ぎ方の種類の読み込みに失敗 :",error.name,error.message);

    }

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
