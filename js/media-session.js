/*
======================================================================
 media-session.js ── ロック画面・バックグラウンド再生の連携

----------------------------------------------------------------------

【このファイルを作った理由(竹弘の報告、2026-08-22)】

 「スマホの電源ボタンを1回押して画面ロック(時計やカレンダーが
 出る節電状態)にすると、曲が2曲ほど鳴った後に止まる」

 このアプリはブラウザで動くWebアプリ(PWA)です。ネイティブの音楽
 アプリと違い、ブラウザは「今このタブは本当に音楽を再生し続けたい
 アプリなのか」をOS(Android)へ自分で伝える必要があります。それを
 伝える標準の仕組みが Media Session API です。

 これを何も使っていないと、Androidは画面ロック中のタブを「もう
 使われていない」とみなし、電池を守るためにJavaScriptの動きを
 止めてしまうことがあります。これが「2曲目までは鳴るが、その先の
 “次の曲へ進む”判断(js/queue.js)が動けなくなって止まる」という
 症状の正体だと考えられます。

----------------------------------------------------------------------

【画面ロック中も音を止めない、が目的(Wake Lockとの違い)】

 竹弘の狙いは「画面を触らない=節電のために画面を消す」ことであって、
 「画面を点けっぱなしにする」ことではありません。そのため、画面を
 強制的に点灯させ続ける Wake Lock API はここでは使いません。
 画面は消えたままでよく、その状態でもOSに「音楽再生アプリとして
 現在進行中です」と伝え続けるのがこの機能の役目です。

 副産物として、ロック画面や通知欄・イヤホンのボタンから再生/一時
 停止・前後の曲送りができるようにもなります(未着手だった
 「ロック画面/イヤホン操作」の下地です)。

----------------------------------------------------------------------

【対応していないブラウザでは何もしない】

 Media Session API はAndroidのChromeでは使えますが、対応していない
 ブラウザも存在します。"mediaSession" in navigator で対応状況を
 確かめ、対応していなければ何もせず終わります(このアプリの他の
 機能には影響しません)。
======================================================================
*/


// このAPIに対応していないブラウザでは、以下は何もしません
const mediaSessionSupported = ("mediaSession" in navigator);


// ==========================================================
// 1. 曲情報(タイトル・アーティスト・ジャケット)を伝える
// ==========================================================

// 前の曲のジャケット用に作った一時URLを覚えておきます(後始末のため)
let mediaSessionArtworkUrl = null;

/**
 * 今再生している曲の情報を、Media Sessionに登録します。
 *
 * js/player.js の playTrack() が、曲を鳴らし始めるたびに呼びます。
 *
 * @param {Object} track … libraryMap から取り出した1曲分のデータ
 */
function updateMediaSessionMetadata(track){

    if(!mediaSessionSupported){ return; }
    if(!track){ return; }

    /*
    前の曲で作ったジャケット用の一時URLを解放します。

    player.js の currentObjectUrl(曲そのものの再生用URL)と
    同じ考え方です。解放し忘れると、曲を切り替えるたびに
    ブラウザがメモリを確保し続けてしまいます。
    */
    if(mediaSessionArtworkUrl){
        URL.revokeObjectURL(mediaSessionArtworkUrl);
        mediaSessionArtworkUrl = null;
    }

    const artwork = [];

    if(track.cover_art){

        mediaSessionArtworkUrl = URL.createObjectURL(track.cover_art);

        /*
        cover_art は docs/db-schema.md の通り、常に96×96pxへ
        縮小済みのJPEGです。sizesにその実際の値を書いておきます。
        */
        artwork.push({
            src: mediaSessionArtworkUrl,
            sizes: "96x96",
            type: "image/jpeg"
        });

    }

    /*
    buildTitleText() は js/list-view.js にある「タイトルが無ければ
    ファイル名を使う」関数です。曲一覧・上半分(showNowPlaying)と
    同じ表示ルールを、ロック画面の表示にもそのまま使います。
    */
    navigator.mediaSession.metadata = new MediaMetadata({
        title: buildTitleText(track),
        artist: track.artist || "",
        artwork: artwork
    });

}


// ==========================================================
// 2. 再生/一時停止の状態を伝える
// ==========================================================
/*
audioの play/pause は、js/upper-area.js が停止ボタン(■/▶)の
記号を切り替えるのに使っているのと同じ標準イベントです。

「JSは今どうなっているかを写すだけ」というこのアプリの方針どおり、
ここでも実際の再生状態をそのままMedia Sessionへ伝えるだけにします。
*/
if(mediaSessionSupported){

    audioPlayer.addEventListener("play",function(){
        navigator.mediaSession.playbackState = "playing";
    });

    audioPlayer.addEventListener("pause",function(){
        navigator.mediaSession.playbackState = "paused";
    });

}


// ==========================================================
// 3. ロック画面・イヤホンからの操作を受け付ける
// ==========================================================
/*
setActionHandler は「ロック画面のこのボタンが押されたら、この関数を
呼んでください」とOSへ伝える命令です。

再生/一時停止は既存の停止ボタン(js/upper-area.js)と同じ操作を、
前後の曲送りは既存の⏮⏭ボタン(js/queue.js の skipTrack)と
同じ操作を呼ぶだけにしています。ボタンを増やすたびに操作の中身を
別々に書かず、すでにある入口を再利用することで、両方の操作方法で
挙動が食い違うことを防いでいます。

イヤホンのボタンがどの操作に化けるかは端末とイヤホンの組み合わせ
次第なので、実機での確認が必要です(竹弘への申し送り事項)。
*/
if(mediaSessionSupported){

    navigator.mediaSession.setActionHandler("play",function(){
        audioPlayer.play();
    });

    navigator.mediaSession.setActionHandler("pause",function(){

        /*
        意図した停止であることを js/upper-area.js の停止ボタン記号
        表示(v135)へ伝えます。ロック画面からの一時停止も、竹弘が
        自分で選んだ操作なので「意図した停止」として扱います。
        */
        intentionalPause = true;

        audioPlayer.pause();

    });

    navigator.mediaSession.setActionHandler("previoustrack",function(){
        skipTrack(-1);
    });

    navigator.mediaSession.setActionHandler("nexttrack",function(){
        skipTrack(1);
    });

}
