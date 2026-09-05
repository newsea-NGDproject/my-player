/*
================================================================
 metronome.js … 拍を刻むメトロノーム(L3)

 🕺ノリノリRun再生の間、曲の拍に合わせて「カチッ」と鳴らします。

 【何のための機能か】

 竹弘の言葉:「接続検証の為に欲しい機能。完成品に残すかは
 使ってみてでいい」。

 曲と曲を「13拍目=0拍目」で繋いだ時、**本当に拍が繋がっているか**
 は耳で聴いても分かりにくいものです。そこで拍を音で刻んでおけば、

     繋ぎ目でカチッがズレなかった → 接続が正しい ✅
     繋ぎ目でカチッがズレた       → どこかが狂っている ❌

 と、一瞬で判定できます。ノリRunの心臓部を確かめる物差しです。

 【⚠️ なぜ🕺ノリノリRun再生でしか鳴らさないのか】

 竹弘の指示(2026-09-05):

     こちらは、曲のつなぎ方と同じようにノリノリRun再生のみの
     機能でお願いします。理由はノリ注入がないメインメニュー再生では
     メトロノームが合うはずがない為。

 メインメニューの曲は、拍の位置(startTS)を測っていません。拍が
 どこにあるか分からない曲で刻んでも、まったく無関係な位置で鳴る
 だけです。**合うはずのないものを鳴らさない**、が正解です。

 【L3という呼び名について】

 移植元の仕様書は、この機能を「L3(レイヤー3)」と呼んでいます。

     L1 デッキA(先行曲)   … 自律して鳴る
     L2 デッキB(後続曲)   … 自律して鳴る
     L3 メトロノーム       … 自律して鳴る(別室の審判)
     L4 司令塔             … 全レイヤーへ予約票を配る

 「別室の審判」という位置づけが要点です。曲がどうなろうと、
 **メトロノームは自分の時計だけを見て正確に刻む。** だから
 曲がズレた時に、それを見つけられます。

 ================================================================
 【このファイルが他のファイルを汚さない作りにした理由】

 再生の開始・停止・曲の切り替えは js/player.js や js/queue.js が
 やっています。ふつうに作るなら、そこに「メトロノームを始めろ」と
 いう呼び出しを足すことになります。

 しかしそれは、**完成して動いている再生処理に手を入れる**という
 ことです(CLAUDE.mdのデグレード防止ルール)。

 そこでこのファイルは、**自分から再生の様子を見に行きます。**

     ・bindDeckEvent("play"/"pause") で、鳴り始め/止まりを知る
     ・見張りの中で isNoriRunMode と currentTrackId を毎回見る

 こうすると player.js も queue.js も norirun.js も1文字も変えずに
 済み、この機能を丸ごと消す時も**このファイルを消すだけ**で戻せます。
 ================================================================
*/


// ==========================================================
// 1. 調整できる数値
// ==========================================================
/*
何秒先まで拍を予約しておくかです。

【なぜ「予約」なのか ―― setInterval で鳴らしてはいけない】

setInterval(「0.35秒ごとに鳴らせ」)という作りにすると、画面の
描き直しや他の処理に押されて、実際には数十ミリ秒ずれて鳴ります。
人間の耳はリズムのズレに敏感なので、これでは審判になりません。

Web Audio には「**この時刻ちょうどに鳴らせ**」と先に予約する仕組み
(start(when))があります。予約した時刻は音を作るハードウェアが
守ってくれるので、JavaScriptが多少もたついてもズレません。

    見張りは 0.5秒ごとに起きる  ← 多少遅れても平気
    その時「2秒先まで」の拍を予約しておく
    → 見張りが1秒遅れても、まだ1秒ぶんの予約が残っている

タップ補正(js/tap.js)のメトロノームも同じ考え方で作ってあります。
*/
const METRONOME_LOOKAHEAD_SEC = 2.0;

// 見張りが起きる間隔(ミリ秒)。上の予約窓より十分に短くします
const METRONOME_TIMER_MS = 500;

/*
メトロノームの音量です。

曲と同時に鳴るので、埋もれず、うるさすぎない値にしています。
1.0にすると曲より目立ちすぎ、拍を確かめるどころか曲が聴けません。
*/
const METRONOME_GAIN = 0.6;

/*
1回の見張りで予約する拍の数の上限です。

計算がおかしくなった時(元テンポが0など)に、拍を無限に予約し続けて
アプリが固まるのを防ぐ安全装置です。マイピッチ340・予約窓2秒でも
12拍ほどなので、64もあれば普通は絶対に届きません。
*/
const METRONOME_MAX_BEATS_PER_TICK = 64;

/*
「再生位置が飛んだ」と判断する幅(秒)です(v180)。

シークバーで位置をずらした時に、古い拍と新しい拍が重なって鳴るのを
防ぐために使います(詳しくは metronomeLastSongSec のコメント)。

0.5秒にしているのは、**ふつうの誤差では絶対に届かず、意味のある
シークなら必ず超える**ところに線を引くためです。静かに再生している
間の食い違いはふつう数十ミリ秒しかありません。
*/
const METRONOME_SEEK_GAP_SEC = 0.5;

/*
音色の名前です(v178)。

竹弘の要望(2026-09-05):
「音色をマイピッチ設定で使っている音色か、のり注入で使っている
  波形音か選択式にしてもらう事は可能かな」

  "click" … click.wav。初期設定の定規(js/setup.js)で鳴っている音
  "beep"  … 1500Hzの矩形波。ノリ注入(js/tap.js)で鳴っている電子音

⚠️ "beep" の音の作り方(高さ・長さ・音量)は、**js/tap.js の
   TAP_CLICK_* をそのまま借ります。** 自前で同じ数値を書き写すと、
   タップ補正側の音を調整した時に、こちらだけ古い音のまま残って
   「同じ音のはずなのに違う」という食い違いが起きるためです。
*/
const METRONOME_SOUND_CLICK = "click";
const METRONOME_SOUND_BEEP  = "beep";

/*
click.wav の先頭を、何秒ぶん読み飛ばすか(v179)。

【⚠️ 竹弘の実機報告から見つかった、かなり厄介な落とし穴】

    「『カチッ』と『ピッ』の鳴ってるタイミングが合っていない」

原因は**音源ファイルそのもの**でした。click.wav の中身を調べると:

    0〜189ms  … 振幅 168〜440(最大32767に対して1%ちょっと)＝ほぼ無音
    190ms〜   … 振幅 32768(最大)  ← ここでやっと「カチッ」が始まる

つまり **click.wav は先頭に約190ミリ秒の無音を抱えています。**
「この時刻に鳴らせ」と予約すると、再生自体はその時刻に始まるものの、
**耳に届くのは190ms後**になります。マイピッチ170なら1拍が353msなので、
**半拍以上ずれて聞こえていた**わけです。

一方「ピッ」はその場で合成する音なので、立ち上がりは一瞬。予約した
時刻ぴったりに鳴ります。だから2つを聞き比べるとズレていました。

【なぜ190msなのか】
190msまでの微弱な値は録音時のノイズで、耳には聞こえません。
本体が立ち上がるのは193.9ms地点なので、190msから鳴らせば残る無音は
4ms足らず ―― 人間には知覚できない差です。手前から始めることで、
立ち上がりを削ってしまう危険も避けています。

⚠️ **音源ファイルを編集して直す道は選びませんでした。** click.wav は
   初期設定の定規(js/setup.js)でも使っており、ファイルを切り詰めると
   そちらの鳴り方まで変わってしまうためです(完成した機能は触らない)。
   読み飛ばす方式なら、影響はこのファイルの中だけで収まります。

【ついでに分かった大事なこと】
ノリ注入(js/tap.js)のメトロノームは矩形波なので、この190msの遅れは
**一切入っていません**。竹弘が耳で合わせて入れた startTS / endTS は
正しい値です。
*/
const METRONOME_CLICK_OFFSET_SEC = 0.190;


// ==========================================================
// 2. 状態
// ==========================================================

// 竹弘が設定画面で選んだON/OFF。初期値はOFF(ふだん走る時は鳴らさない)
let metronomeEnabled = false;

/*
選んでいる音色(v178)。初期値は click.wav の方です。

マイピッチ設定の定規で聞き慣れている音なので、初めて鳴らした時に
「何の音か分からない」とならないためです。
*/
let metronomeSound = METRONOME_SOUND_CLICK;

/*
最後に拍を予約した時のマイピッチです(v178)。

竹弘の要望「このマイピッチに合わせて鳴るように」を、**走りながら
変えた時にもすぐ効かせる**ために持っています。

【なぜ必要か】
拍は2秒先まで先に予約してあります。走行中にマイピッチを変えても、
予約済みのぶんは**古い歩数のまま鳴り続けます。** 2秒とはいえ、
足を合わせている最中にズレた音が鳴るのは走りを乱します。

→ マイピッチが変わったことに気づいたら、予約を取り消して
   新しい歩数で入れ直します。

⚠️ この形にしたのは、**js/pitch.js に手を入れないため**でもあります
   (向こうから「変わったよ」と教えてもらう作りにすると、完成して
   動いている定規の処理を触ることになります)。
*/
let metronomeLastPitch = null;

/*
click.wav を音として使える形にしたものです。

読み込み(fetch)と変換(decodeAudioData)には少し時間がかかるので、
一度だけ用意して使い回します。鳴らすたびに読み直すと間に合いません。
*/
let metronomeClickBuffer = null;

// 読み込み中に何度も取りに行かないための札
let metronomeLoading = false;

// 音量つまみ。ここを通してから音を出します
let metronomeGainNode = null;

// 見張りの番号(止める時に使います)
let metronomeTimerId = null;

/*
予約済みの音の一覧です。

止める時(OFFにした・曲を変えた)に、**まだ鳴っていない予約を
取り消す**ために持っています。持っていないと、OFFにしたのに
2秒間カチカチ鳴り続けることになります。

⚠️ v180から、音そのものではなく **{ node, atCtxSec } という組**で
   持ちます。「いつ鳴る予定か」を一緒に覚えておくためです。

【なぜ必要になったか ―― 竹弘の実機報告】

    「繋ぎ目で音が変になる時がある」

v179までは、取り消す時に一覧の**全部**を stop() していました。
ところが stop() は「今すぐ止めろ」という命令なので、**ちょうど
鳴っている最中の音まで途中でぶった切ります。**

    ♪♪♪♪|      ← 波形の途中で断ち切られる = 「プツッ」

音の波は途中で切ると、そこに段差ができてノイズになります(v156で
タップ補正のノイズを直した時と同じ理屈)。曲の繋ぎ目はまさに
「取り消しが起きる瞬間」なので、そこで鳴っていた拍が切られて
いました。

→ 予定時刻を覚えておけば、**まだ鳴っていないものだけ**を取り消し、
   鳴っている音は最後まで鳴らしきれます。
*/
let metronomeScheduled = [];

/*
前回の見張りで見た再生位置です(v180)。

**シークバーで再生位置を飛ばしたこと**を見つけるために持っています。

【なぜ必要か ―― 竹弘の実機報告】

    「シークバーで再生位置をずらした時に、新たな拍の鳴り始めと
      古い拍のが2拍くらい被ってなっているような事象が発生する」

拍は2秒先まで予約してあります。シークしても曲もマイピッチも
変わらないため、v179までは**古い位置の予約を取り消す機会が
どこにもありませんでした。**

    前へ飛ばした → 古い予約が残ったまま、新しい拍も鳴る = 二重
    後ろへ飛ばした → 「前回どこまで予約したか」の記録が先に進んだ
                     ままなので、**飛んだ先とは無関係な遠い未来**の
                     拍を予約してしまい、しばらく鳴らなくなる

⚠️ 曲が変わった時と違い、シークは currentTrackId も noriRunMyPitch も
   変えません。**何も変わっていないように見えて、位置だけが飛ぶ**の
   がこの問題の厄介なところでした。
*/
let metronomeLastSongSec = null;
let metronomeLastCtxSec = null;

/*
「どの曲の、何番目の拍まで予約したか」の記録です。

同じ拍を二度予約すると、カチッが二重に鳴って濁ります。前回どこまで
予約したかを覚えておき、その続きから予約します。

trackId も一緒に持つのは、**曲が変わったら拍の数え方が最初から
やり直しになる**ためです(曲ごとに0拍目の位置が違う)。
*/
let metronomeTrackId = null;
let metronomeLastBeatIndex = null;


// ==========================================================
// 3. 音の準備
// ==========================================================
/**
 * click.wav を読み込んで、鳴らせる形に変換します。
 *
 * 初期設定の定規(js/setup.js)で使っているものと同じ音源です。
 * ⚠️ CDNから読まず、リポジトリに同梱したものを使います
 *    (走っている最中=電波の悪い所で使うアプリのため)。
 */
async function loadMetronomeClick(){

    // すでに用意できている / 今まさに読み込み中なら、何もしません
    if(metronomeClickBuffer || metronomeLoading){ return; }

    /*
    音を変換するには AudioContext が要ります。deck.js が作ったものを
    borrow します。

    ⚠️ **自分で新しく作らないこと。** v157で、AudioContextを作っては
       閉じることが「ブッ」というノイズの原因だったと判明しています。
       アプリ全体で1つだけ作り、閉じずに使い回すのが決まりです。
    */
    if(!deckAudioCtx){ return; }

    metronomeLoading = true;

    try{

        const response = await fetch("click.wav");

        const arrayBuffer = await response.arrayBuffer();

        /*
        decodeAudioData は、ファイルの中身(圧縮された数値の並び)を
        「そのまま鳴らせる波形」に開く処理です。開いた状態で持って
        おくことで、鳴らす瞬間に計算が要らなくなります。
        */
        metronomeClickBuffer = await deckAudioCtx.decodeAudioData(arrayBuffer);

        console.log("メトロノームの音を読み込みました");

    }
    catch(error){

        console.error("click.wavの読み込みに失敗 :",error.name,error.message);

    }

    metronomeLoading = false;

}

/**
 * メトロノーム専用の音量つまみを用意します。
 *
 * 曲の音量つまみとは別に持ちます。曲がクロスフェードで小さくなって
 * いる間も、メトロノームは同じ大きさで鳴り続けてほしいためです
 * (審判が曲に合わせて声を小さくしたら審判になりません)。
 */
function ensureMetronomeGain(){

    if(metronomeGainNode || !deckAudioCtx){ return; }

    metronomeGainNode = deckAudioCtx.createGain();

    metronomeGainNode.gain.value = METRONOME_GAIN;

    metronomeGainNode.connect(deckAudioCtx.destination);

}


// ==========================================================
// 4. 拍を予約する
// ==========================================================
/**
 * いま鳴らしてよい状態かどうかを返します。
 *
 * ここに条件を1か所へまとめているので、「鳴るはずなのに鳴らない」
 * 時は、この関数だけを見れば理由が分かります。
 */
function canRingMetronome(){

    // 設定でOFFなら鳴らしません
    if(!metronomeEnabled){ return false; }

    // 🕺ノリノリRun再生の時だけです(竹弘の指示。冒頭のコメント参照)
    if(!isNoriRunMode){ return false; }

    // 音を出す回路そのものが無ければ鳴らせません
    if(!deckAudioCtx){ return false; }

    /*
    「カチッ」の時だけ、音源(click.wav)の読み込み待ちがあります。

    「ピッ」は録音ではなくその場で合成する音なので、読み込みを
    待つ必要がありません(v178)。ここを音色で分けずに書くと、
    click.wav が読めない環境で「ピッ」まで鳴らなくなります。
    */
    if(metronomeSound === METRONOME_SOUND_CLICK && !metronomeClickBuffer){

        return false;

    }

    // 曲が止まっていたら刻む必要がありません
    if(audioPlayer.paused){ return false; }

    const track = libraryMap[currentTrackId];

    if(!track){ return false; }

    /*
    ノリ注入(タップ補正)がまだの曲では鳴らしません。

    startTS(1拍目の位置)と manualBPM(測ったテンポ)が無いと、拍が
    どこにあるか分かりません。当てずっぽうで鳴らすと、曲と無関係な
    位置でカチカチ鳴って**かえって走りを乱します。**

    🕺ノリノリRun再生の曲一覧には注入済みしか並びませんが、
    メインメニューから未注入の曲を持ち込んだ直後だけ、この状態に
    なりえます(js/connect.js が「繋がない」と判断するのと同じ場面)。
    */
    if(!track.startTS || !track.manualBPM){ return false; }

    return true;

}

/**
 * これから先の拍を、まとめて予約します。
 *
 * 見張り(setInterval)から繰り返し呼ばれます。
 */
function scheduleMetronomeBeats(){

    /*
    🕺ノリノリRun再生から出ていたら、見張りごと自分を片付けます。

    メインメニューに戻った後もこの見張りが回り続けるのは無駄です。
    **モードを抜ける処理(js/norirun.js)に手を入れずに済ませる**ため、
    見張り自身が気づいて終わる形にしています。

    次に🕺へ入って曲が鳴れば、bindDeckEvent("play") が
    refreshMetronome() を呼ぶので、また動き出します。
    */
    if(!isNoriRunMode){

        stopMetronomeTimer();

        return;

    }

    if(!canRingMetronome()){

        /*
        鳴らせない状態になったら、予約済みの音も取り消します。

        OFFにした・曲を止めた瞬間に、まだ2秒ぶんの予約が残っている
        ためです。取り消さないと、止めたのにカチカチ鳴り続けます。

        ⚠️ ここでは見張りは止めません。**曲が止まっているだけなら、
           再開した時にすぐ刻み直したい**からです。上のモード判定
           だけが「もう出番が無い」と言える条件です。
        */
        clearScheduledClicks();

        return;

    }

    const track = libraryMap[currentTrackId];

    /*
    ---- 拍の位置を、その曲の時間軸で求めます ----

    ⚠️ ここが一番間違えやすい所です。**2つの時間軸があります。**

        曲内秒 … 曲のファイルの中での位置(音楽プレイヤーの表示)
        実秒   … 腕時計で測った時間

    再生速度が1.2倍なら、曲内秒は実秒の1.2倍の速さで進みます。
    拍の位置は「曲の中のどこか」なので曲内秒で求め、鳴らす時刻は
    「腕時計で何秒後か」なので実秒に直す、という往復が要ります。
    */

    // 0拍目の位置(曲内秒)。1拍目(startTS)の1拍前です
    const beat0Sec = getBeat0AtSec(track);

    // その曲の元テンポでの1拍の長さ(曲内秒)
    const beatDurSongSec = 60 / getEffectiveBaseBpm(track);

    // いまのマイピッチで鳴らす時の再生速度(倍率)
    const rate = getTrackRate(track);

    // おかしな値なら、何もしないで戻ります(0で割る事故を防ぎます)
    if(!isFinite(beatDurSongSec) || beatDurSongSec <= 0){ return; }
    if(!isFinite(rate) || rate <= 0){ return; }

    const nowSongSec = audioPlayer.currentTime;
    const nowCtxSec  = deckAudioCtx.currentTime;

    /*
    曲が変わったら、拍の数え直しです。

    曲ごとに0拍目の位置が違うので、前の曲の「何番目まで予約した」は
    そのまま使えません。接続で曲が入れ替わった時もここを通ります。
    */
    if(metronomeTrackId !== currentTrackId){

        metronomeTrackId = currentTrackId;

        /*
        ⚠️ 拍の番号を捨てるだけでなく、**予約済みの音も取り消します**
           (v179。竹弘の要望「曲ごとに、のり注入情報からメトロノームの
           鳴りだしをリセットして欲しい」)。

        【v178に残っていた穴】
        拍は2秒先まで予約してあります。曲が入れ替わった時に取り消さ
        ないと、**前の曲の拍が最大2秒ぶん鳴り続けてから**、新しい曲の
        拍に切り替わります。前後の曲でノリ注入の精度が違うと、
        繋ぎ目でその2つが混ざって聞こえ、「どちらがズレているのか」が
        判別できなくなります。

        取り消せば、接続の瞬間から**新しい曲のノリ注入情報だけ**で
        刻み直します。これで竹弘の狙いどおり、繋ぎ目のズレが
        「後続曲の注入がズレている」という形ではっきり出ます。

        clearScheduledClicks() は metronomeLastBeatIndex も空にするので、
        この下の計算は新しい曲の0拍目から始まります。
        */
        clearScheduledClicks();

    }

    /*
    走りながらマイピッチを変えたら、予約を入れ直します(v178)。

    竹弘の要望「このマイピッチに合わせて鳴るように」。予約済みの
    2秒ぶんは古い歩数のまま鳴るので、そのままでは足を合わせている
    最中にズレた音が鳴ります。

    clearScheduledClicks() は予約を取り消したうえで
    metronomeLastBeatIndex も空にするので、この下の計算が
    **新しいマイピッチで最初から**やり直されます。

    ⚠️ 曲の切り替え判定より後に置くこと。曲が変わった時は
       どのみち数え直しになるので、順番を逆にすると
       「変わっていないのに取り消す」無駄が生じます。
    */
    if(metronomeLastPitch !== null && metronomeLastPitch !== noriRunMyPitch){

        clearScheduledClicks();

    }

    metronomeLastPitch = noriRunMyPitch;

    /*
    再生位置が飛んでいたら、予約を入れ直します(v180)。

    竹弘の実機報告:「シークバーで再生位置をずらした時に、新たな拍の
    鳴り始めと古い拍のが2拍くらい被ってなっている」

    【どうやって見つけるか】
    ふつうに再生されているなら、前回この見張りが起きてからの経過時間
    だけ曲は進んでいるはずです。

        あるべき今の位置 = 前回の位置 + 経過した実時間 × 再生速度

    この予想と実際が大きく食い違っていたら、**誰かが再生位置を
    飛ばした**ということです。

    ⚠️ シークは曲もマイピッチも変えないため、上の2つの判定では
       まったく引っかかりません。**何も変わっていないように見えて、
       位置だけが飛ぶ**のがこの問題の厄介なところでした。

    ⚠️ 0.5秒という幅は「ふつうの誤差では絶対に届かず、意味のある
       シークなら必ず超える」ところに置いています。再生中の誤差は
       ふつう数十ミリ秒で、見張りの間隔(0.5秒)ぶんの進み方も
       計算に入っているので、静かに再生している限り引っかかりません。
    */
    if(metronomeLastSongSec !== null && metronomeLastCtxSec !== null){

        const elapsedSec  = nowCtxSec - metronomeLastCtxSec;
        const expectedSec = metronomeLastSongSec + elapsedSec * rate;

        if(Math.abs(nowSongSec - expectedSec) > METRONOME_SEEK_GAP_SEC){

            console.log("のりのりアシスト : 再生位置が飛んだので拍を取り直します");

            clearScheduledClicks();

        }

    }

    metronomeLastSongSec = nowSongSec;
    metronomeLastCtxSec  = nowCtxSec;

    /*
    どこまで予約するか(曲内秒)。

    予約窓は「腕時計で2秒先まで」なので、曲内秒に直すには再生速度を
    掛けます(速く鳴らしているほど、2秒で曲は先まで進むため)。
    */
    const untilSongSec = nowSongSec + METRONOME_LOOKAHEAD_SEC * rate;

    /*
    いまの位置より後にある、最初の拍の番号を求めます。

    Math.ceil は切り上げです。「0拍目から何拍ぶん進めば今の位置を
    追い越すか」を切り上げると、次に来る拍の番号になります。
    */
    let beatIndex = Math.ceil((nowSongSec - beat0Sec) / beatDurSongSec);

    /*
    前回の続きから予約します。

    これが無いと、見張りが起きるたびに同じ拍をもう一度予約し、
    カチッが重なって濁ります。
    */
    if(metronomeLastBeatIndex !== null && metronomeLastBeatIndex >= beatIndex){

        beatIndex = metronomeLastBeatIndex + 1;

    }

    let count = 0;

    while(count < METRONOME_MAX_BEATS_PER_TICK){

        // この拍は、曲内秒でいうとどこか
        const beatSongSec = beat0Sec + beatIndex * beatDurSongSec;

        // 予約窓の先まで来たら終わりです
        if(beatSongSec > untilSongSec){ break; }

        /*
        曲内秒を、AudioContextの時刻(実秒)に直します。

            今から何秒後か = (拍の位置 − 今の位置) ÷ 再生速度
            鳴らす時刻     = 今の時刻 + 上の秒数
        */
        const atCtxSec = nowCtxSec + (beatSongSec - nowSongSec) / rate;

        scheduleMetronomeClick(atCtxSec);

        metronomeLastBeatIndex = beatIndex;

        beatIndex++;
        count++;

    }

}

/**
 * カチッという音を1つ、指定の時刻に予約します。
 *
 * @param {number} atCtxSec - AudioContextの時計で、いつ鳴らすか
 */
function scheduleMetronomeClick(atCtxSec){

    // すでに過ぎた時刻は予約できません
    if(atCtxSec <= deckAudioCtx.currentTime){ return; }

    ensureMetronomeGain();

    if(!metronomeGainNode){ return; }

    /*
    音を鳴らす部品は、**1回鳴らすたびに作り捨て**ます。

    Web Audio の決まりで、一度 start() した音源は二度目が使えません
    (使い捨ての花火のようなものです)。作る負担はごく軽いので、
    これが正しい使い方です。

    音色によって、作る部品の種類が変わります(v178):

        "click" … createBufferSource … 録音された音(click.wav)を鳴らす
        "beep"  … createOscillator   … その場で電子音を合成して鳴らす

    どちらも「予約して鳴らし、鳴り終わったら捨てる」点は同じなので、
    下の後片付けは共通で使えます。
    */
    const source = (metronomeSound === METRONOME_SOUND_BEEP)
        ? createMetronomeBeep(atCtxSec)
        : createMetronomeClick(atCtxSec);

    if(!source){ return; }

    /*
    取り消せるように控えておきます。

    「いつ鳴る予定か(atCtxSec)」を一緒に持つのが要です。取り消す時に
    **もう鳴り始めているかどうか**を見分けられないと、鳴っている音を
    途中で切ってノイズを出してしまいます(v180)。
    */
    const entry = { node: source, atCtxSec: atCtxSec };

    metronomeScheduled.push(entry);

    /*
    鳴り終わったら、控えから自分を外します。

    外さないと、走っている間ずっと一覧が伸び続けます(1時間で
    1万個以上)。鳴り終わった音は取り消す必要がないので、
    その場で片付けます。
    */
    source.onended = function(){

        const index = metronomeScheduled.indexOf(entry);

        if(index >= 0){ metronomeScheduled.splice(index,1); }

    };

}

/**
 * 「カチッ」(click.wav)を1つ予約します。
 *
 * マイピッチ設定の定規(js/setup.js)で鳴っているのと同じ音源です。
 *
 * @param  {number} atCtxSec - いつ鳴らすか
 * @return {AudioNode|null} 予約した音(取り消しに使います)
 */
function createMetronomeClick(atCtxSec){

    // 音源がまだ読めていなければ、この拍は諦めます
    if(!metronomeClickBuffer){ return null; }

    const source = deckAudioCtx.createBufferSource();

    source.buffer = metronomeClickBuffer;

    source.connect(metronomeGainNode);

    /*
    start() の第2引数は「**音源の何秒目から**鳴らすか」です(v179)。

    click.wav は先頭に約190msの無音を抱えているので、そこを読み
    飛ばして「カチッ」の本体から鳴らします。これを入れないと、
    予約した時刻より190ms遅れて聞こえます(詳しくは
    METRONOME_CLICK_OFFSET_SEC のコメント)。

    第1引数が「いつ鳴らすか(壁の時計)」、第2引数が「音源のどこから
    鳴らすか(曲でいう再生位置)」―― **意味の違う2つの時間**を
    並べて渡している点に注意してください。
    */
    source.start(atCtxSec,METRONOME_CLICK_OFFSET_SEC);

    return source;

}

/**
 * 「ピッ」(1500Hzの矩形波)を1つ予約します。
 *
 * ノリ注入(js/tap.js)で鳴っているのと同じ電子音です。竹弘の実機
 * テストで「派手な曲でも埋もれない」と確認済みの音でもあります。
 *
 * ⚠️ 高さ・長さ・音量は js/tap.js の TAP_CLICK_* を借ります
 *    (同じ音であり続けるため。理由は冒頭の定数のコメント参照)。
 *
 * @param  {number} atCtxSec - いつ鳴らすか
 * @return {AudioNode|null} 予約した音(取り消しに使います)
 */
function createMetronomeBeep(atCtxSec){

    /*
    オシレーターは「決まった高さの音を作り続ける発振器」です。
    録音を鳴らすのではなく、その場で波形を合成します。
    矩形波(square)は角のある硬い音で、曲に埋もれにくい音色です。
    */
    const osc = deckAudioCtx.createOscillator();

    osc.type = TAP_CLICK_TYPE;
    osc.frequency.setValueAtTime(TAP_CLICK_HZ,atCtxSec);

    /*
    発振器は放っておくと「ピー」と鳴り続けます。**音量をすとんと
    落として「ピッ」という短い音に切り取る**のがここの役割です。

    exponentialRampToValueAtTime は「その時刻に向けて、なめらかに
    音量を変える」命令です。0にはできない決まりがあるので、
    0.001というほぼ無音の値まで落としています
    (js/tap.js のメトロノームと同じ作り方)。

    ⚠️ この音専用の音量つまみを、鳴らすたびに作っています。
       共通の metronomeGainNode に直接つなぐと、**次の拍の
       「音量を上げる」と、今の拍の「音量を下げる」が同じつまみを
       取り合って**音が途切れたり伸びたりします(v156でタップ補正の
       ノイズを直した時と同じ理屈)。
    */
    const gain = deckAudioCtx.createGain();

    gain.gain.setValueAtTime(TAP_CLICK_GAIN,atCtxSec);
    gain.gain.exponentialRampToValueAtTime(0.001,atCtxSec + TAP_CLICK_SEC);

    osc.connect(gain);
    gain.connect(metronomeGainNode);

    osc.start(atCtxSec);

    /*
    止める時刻も一緒に予約します。

    これが無いと発振器が動き続け、走っている間ずっと数が増えます。
    少し余裕(2倍)を持たせているのは、音量が落ちきる前に切ると
    「プツッ」という切り口の音が出るためです。
    */
    osc.stop(atCtxSec + TAP_CLICK_SEC * 2);

    return osc;

}

/**
 * まだ鳴っていない予約を、すべて取り消します。
 */
function clearScheduledClicks(){

    const now = deckAudioCtx ? deckAudioCtx.currentTime : 0;

    /*
    ⚠️ **まだ鳴り始めていない予約だけ**を取り消します(v180)。

    stop() は「今すぐ止めろ」という命令なので、鳴っている最中の音に
    使うと**波形を途中でぶった切って「プツッ」というノイズ**を出します
    (竹弘の実機報告「繋ぎ目で音が変になる時がある」の原因)。

    予定時刻がまだ先のものは、まだ音が出ていないので安全に取り消せます。
    すでに鳴り始めているものは触らず、**最後まで鳴らしきらせます。**
    カチッもピッも0.05〜0.3秒の短い音なので、放っておいてもすぐ
    終わり、次の拍と混ざる心配はありません。

    filter は「条件に合うものだけを残した新しい一覧を作る」書き方です。
    ここでは「取り消さなかったもの(＝まだ鳴っている音)」だけを残します。
    */
    metronomeScheduled = metronomeScheduled.filter(function(entry){

        // まだ鳴っていない → 取り消して、一覧からも外す
        if(entry.atCtxSec > now){

            /*
            try で囲むのは、ちょうど鳴り終わった直後の音に stop() を
            呼ぶとエラーになることがあるためです。止めたいだけなので、
            エラーは黙って捨てて構いません。
            */
            try{ entry.node.stop(); }
            catch(error){ /* もう終わっていた音。何もしません */ }

            return false;

        }

        // 鳴っている最中 → そのまま鳴らしきる(一覧に残す)
        return true;

    });

    // 次に鳴らす時は、拍を数え直します
    metronomeLastBeatIndex = null;

}


// ==========================================================
// 5. 見張りの開始と停止
// ==========================================================
/**
 * 拍の予約を続ける見張りを始めます。
 */
function startMetronomeTimer(){

    if(metronomeTimerId !== null){ return; }

    // 待たずに1回目を予約します(0.5秒待つと最初の拍を逃すため)
    scheduleMetronomeBeats();

    metronomeTimerId = setInterval(scheduleMetronomeBeats,METRONOME_TIMER_MS);

}

/**
 * 見張りを止めて、予約も取り消します。
 */
function stopMetronomeTimer(){

    if(metronomeTimerId !== null){

        clearInterval(metronomeTimerId);

        metronomeTimerId = null;

    }

    clearScheduledClicks();

}

/**
 * いまの状況に合わせて、見張りを動かすか止めるかを決めます。
 *
 * 設定を変えた時・再生が始まった時・止まった時に呼びます。
 */
function refreshMetronome(){

    /*
    ⚠️ ここでは metronomeEnabled と isNoriRunMode だけを見ます。

    「曲が鳴っているか」まで見て止めてしまうと、曲の切り替わりの
    一瞬(前の曲が止まって次が始まるまで)に見張りが落ちます。
    細かい可否の判断は canRingMetronome() が毎回やるので、ここでは
    大きく構えておく方が安定します。
    */
    if(metronomeEnabled && isNoriRunMode){

        // 音がまだ無ければ、ここで用意を始めます
        loadMetronomeClick();

        startMetronomeTimer();

    }
    else{

        stopMetronomeTimer();

    }

}


// ==========================================================
// 6. 設定の切り替えと保存
// ==========================================================
/**
 * メトロノームのON/OFFを切り替えて、保存します。
 *
 * 設定画面(js/settings.js)のボタンから呼ばれます。
 *
 * @param {boolean} on - true=鳴らす / false=鳴らさない
 */
async function setMetronomeEnabled(on){

    metronomeEnabled = (on === true);

    console.log("メトロノーム :",metronomeEnabled ? "ON" : "OFF");

    /*
    設定を切り替えた瞬間に効かせます。

    ONにしたら即座に刻み始め、OFFにしたら予約ごと取り消します
    (走りながら切り替えた時、次の曲まで変わらないのでは困るため)。
    */
    refreshMetronome();

    try{

        // settings ストアはキーを自分で指定する形です(繋ぎ方の保存と同じ)
        await idbPut(STORE_SETTINGS,metronomeEnabled,"metronome_enabled");

    }
    catch(error){

        console.error("メトロノーム設定の保存に失敗 :",error.name,error.message);

    }

}

/**
 * 音色を切り替えて、保存します(v178)。
 *
 * 設定画面(js/settings.js)のボタンから呼ばれます。
 *
 * @param {string} sound - METRONOME_SOUND_CLICK / METRONOME_SOUND_BEEP
 */
async function setMetronomeSound(sound){

    /*
    知らない値が来たら、安全な方(カチッ)に倒します。

    保存してある値が将来の版と食い違った時に、音が出なくなるのを
    防ぐための関門です(繋ぎ方の設定と同じ守り方)。
    */
    if(sound !== METRONOME_SOUND_CLICK && sound !== METRONOME_SOUND_BEEP){

        sound = METRONOME_SOUND_CLICK;

    }

    metronomeSound = sound;

    console.log("のりのりアシストの音色 :",metronomeSound);

    /*
    予約済みの拍を取り消します。

    2秒先まで予約してあるので、取り消さないと**切り替えた後も
    2秒間は前の音色で鳴り続けます。** 竹弘が聞き比べる時に、
    押した音色がすぐ鳴らないと比べようがありません。
    */
    clearScheduledClicks();

    // カチッに切り替えたなら、音源が要ります(まだ無ければここで読みます)
    if(metronomeSound === METRONOME_SOUND_CLICK){

        loadMetronomeClick();

    }

    try{

        await idbPut(STORE_SETTINGS,metronomeSound,"metronome_sound");

    }
    catch(error){

        console.error("音色の保存に失敗 :",error.name,error.message);

    }

}

/**
 * 保存してあるON/OFFと音色を読み込みます。
 *
 * js/main.js の起動処理から呼ばれます。
 */
async function loadMetronomeSetting(){

    try{

        const savedSound = await idbGet(STORE_SETTINGS,"metronome_sound");

        // 今のコードが知っている音色の時だけ受け入れます
        if(savedSound === METRONOME_SOUND_CLICK || savedSound === METRONOME_SOUND_BEEP){

            metronomeSound = savedSound;

        }

    }
    catch(error){

        console.error("音色の読み込みに失敗 :",error.name,error.message);

    }

    try{

        const saved = await idbGet(STORE_SETTINGS,"metronome_enabled");

        /*
        true/false が入っている時だけ受け入れます。

        まだ一度も設定していない時は undefined が返るので、その時は
        初期値(OFF)のままにします。ふだん走る時に、いきなり
        カチカチ鳴り出さないようにするためです。
        */
        if(saved === true || saved === false){

            metronomeEnabled = saved;

        }

    }
    catch(error){

        console.error("メトロノーム設定の読み込みに失敗 :",error.name,error.message);

    }

}


// ==========================================================
// 7. 再生の様子を見張る
// ==========================================================
/*
⚠️ bindDeckEvent(js/deck.js)を通します。

デッキは2枚あり、繋いでいる最中は2曲が同時に鳴っています。
bindDeckEvent は「いま主役のデッキからの知らせ」だけを通すので、
裏で鳴っている曲の pause に反応してメトロノームが止まる、といった
事故を防げます。

【なぜ play/pause なのか】
曲が鳴り始めた時・止まった時が、メトロノームを動かす/止める
きっかけそのものだからです。曲の切り替えや接続は、見張りの中で
currentTrackId を毎回見ているので、ここで知る必要はありません。
*/
bindDeckEvent("play",function(){

    refreshMetronome();

});

bindDeckEvent("pause",function(){

    /*
    ⚠️ 見張りは止めず、予約だけ取り消します。

    一時停止から再開した時に、また play が来るので見張りは
    生き続けていて構いません。ただし予約済みのカチッは、止めた後も
    2秒ぶん鳴ってしまうので、ここで取り消します。
    */
    clearScheduledClicks();

    /*
    位置の記録も忘れます(v180)。

    止まっている間、曲は進みませんが**壁の時計は進みます。** 記録を
    残したまま再開すると、その差を「再生位置が飛んだ」と読み違えて
    しまいます。空にしておけば、再開した時に新しく測り直します。
    */
    metronomeLastSongSec = null;
    metronomeLastCtxSec  = null;

});

/*
🕺ノリノリRun再生から出た時は、見張り自身が自分を片付けます
(scheduleMetronomeBeats の中を参照)。

【なぜ「常に動く見張り」を置かなかったか】

モードの切り替えは js/norirun.js がやっていますが、**あちらには
1文字も手を入れない**方針です(冒頭のコメント参照)。そこで最初は
「5秒ごとにモードを確認するタイマー」を別に置こうとしました。

しかしそれでは、**メトロノームを使っていない人の端末でも、
アプリが開いている間ずっとタイマーが回り続けます。** v176で
「聞こえない音のためにCPUを使うのをやめる」という掃除をした
ばかりなのに、その裏で新しい常時処理を増やしては本末転倒です。

→ すでに動いている見張りの中で確かめれば、追加のタイマーは
   要りません。**必要な時にだけ動くものが、いちばん軽い。**
*/
