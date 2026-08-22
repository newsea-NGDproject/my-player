/*
======================================================================
 player.js ── 曲の再生

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の再生ボタン(▶️)を押した時に、その曲を再生します。

   playTrack()         … 指定した曲を再生する
   audioPlayer.onerror … 再生中にエラーが起きた時の受け止め

 なお、ここでの再生は「普通の速さで鳴らすだけ」です。
 本命であるビートマッチング(設定BPMに合わせた再生・曲間の接続)は
 まだ未実装で、今後このファイルの隣に別のJSファイルとして
 追加していく予定です。

----------------------------------------------------------------------

【なぜ毎回ファイルの権限を確認し直すのか】

 track.file_handle は、c013でMusicフォルダをスキャンした時に
 取得した「ファイルへの取っ手(FileSystemFileHandle)」です。

 この取っ手はIndexedDBに保存できますが、ページを開き直すと
 JavaScriptの実行状態がリセットされるため、
 「前に許可をもらったこと」がそのまま引き継がれるとは限りません。

 c013でもこれが原因の不具合に苦しんだので、ファイルを開く前には
 必ず queryPermission → (必要なら)requestPermission の順で
 確認し直す作りに統一しています。
 metadata.js の解析処理も全く同じパターンです。
======================================================================
*/


// 再生中の一時URL(曲を切り替える時に解放するため覚えておきます)
let currentObjectUrl = null;

/*
今どの曲を選んで再生しているかを覚えておく変数です(v80で追加)。

【なぜ必要になったか】

曲情報エリアは1行目(タイトル)と2行目(曲長+アーティスト)に
分かれていて、どちらをタップしても再生できます。
しかし同じ曲の別の行を続けてタップすると、そのたびに曲が
頭から流れ直してしまっていました。

竹弘の要望:
    「同曲の為、曲の再生し直しをしないように変更をお願いしたい。
      曲を最初から流したい時は、一旦ストップボタンで止めて、
      再度曲をタップする方式に変更したい」

そこで「今鳴っている曲」を覚えておき、同じ曲がまたタップされた
時は何もしないようにしました。長いタイトルを読むために何度
タップしても、曲は途切れません。
*/
let currentTrackId = null;


/**
 * 指定したtrack_idの曲を再生します。
 *
 * track.file_handle は c013のスキャン時にMusicフォルダから
 * 取得したFileSystemFileHandleです。
 *
 * c013の権限バグと同じ理由(ページ遷移でJSの実行コンテキストが
 * リセットされるため)で、ここでも必ず権限を確認し直してから
 * ファイルを読み込みます。
 *
 * ------------------------------------------------------------------
 * 【戻り値について(v112で追加)】
 *
 *   true  … 音が鳴り始めた
 *   false … 鳴らせなかった(形式非対応・権限切れ・曲データが無い)
 *
 * 連続再生(js/queue.js)が「この曲は駄目だったから次へ進もう」と
 * 判断するために使います。
 *
 * 曲一覧をタップした時の呼び出し(js/list-view.js)は、戻り値を
 * 受け取らずに無視しています。**呼び出す側が使わない戻り値を足しても
 * 何も壊れない**ので、既存のコードは1文字も変えずに済みました。
 * ------------------------------------------------------------------
 */
async function playTrack(trackId){

    // 【開発用調査ログ】原因判明後に削除(CLAUDE.md参照)
    logDebugEvent("playTrack開始 :" + trackId);

    try{

        const track = libraryMap[trackId];

        if(!track || !track.file_handle){

            /*
            alert をやめて console.error だけにしました(v129)。
            理由は下の catch ブロックのコメントにまとめています。
            */
            console.error("曲データが見つかりませんでした(c013で再登録が必要) :",trackId);

            return false;

        }

        /*
        すでに同じ曲が鳴っている場合は、何もせずに戻ります(v80)。

        【判定の考え方】
        「同じ曲」であることに加えて「今まさに鳴っている」ことも
        確かめています。audioPlayer.paused は、止まっている時に
        true になる標準の値です。

        この2つを両方見ているのは、竹弘の要望どおり
        「一旦ストップボタンで止めてから、もう一度曲をタップすれば
          最初から流れる」を成り立たせるためです。
        止めた後は paused が true になるので、この関門を素通りして
        頭から再生されます。

        曲が最後まで流れ切った時も paused は true になるため、
        もう一度タップすればちゃんと頭から鳴り直します。

        なお、この判定より前で止めているのは重い処理(権限の確認や
        ファイルの読み込み)の手前だからです。無駄な処理をせずに済みます。
        */
        if(currentTrackId === trackId && !audioPlayer.paused){

            console.log("すでに再生中です(そのまま続けます) :",track.file_name);

            // 鳴っていることに変わりはないので、成功として返します
            return true;

        }

        // --- 権限を確認し直します(c013と同じパターン) ---
        // 【開発用調査ログ】ここから
        logDebugEvent("queryPermission呼び出し前");
        let permission = await track.file_handle.queryPermission({mode:"read"});
        logDebugEvent("queryPermission結果 :" + permission);

        if(permission !== "granted"){
            logDebugEvent("requestPermission呼び出し前(ユーザー操作が無い状態で呼ぶと失敗しやすい箇所)");
            permission = await track.file_handle.requestPermission({mode:"read"});
            logDebugEvent("requestPermission結果 :" + permission);
        }
        // 【開発用調査ログ】ここまで

        if(permission !== "granted"){

            console.error("この曲へのアクセスが許可されませんでした :",track.file_name);

            return false;

        }

        // 【開発用調査ログ】
        logDebugEvent("getFile呼び出し前");
        const file = await track.file_handle.getFile();
        logDebugEvent("getFile完了");

        if(currentObjectUrl){
            URL.revokeObjectURL(currentObjectUrl);
        }

        currentObjectUrl = URL.createObjectURL(file);

        // 今どの曲を選んだかを覚えておきます(次に同じ曲がタップされた時の判定用)
        currentTrackId = trackId;

        audioPlayer.src = currentObjectUrl;

        /*
        上半分(エリア3〜4)に、今かけている曲の情報を表示します。

        v87まではここで #player-box という丸角カードを表示して
        いましたが、v88で上半分を10分割レイアウトに作り替えた際、
        曲情報の表示は js/upper-area.js の担当になりました。
        */
        showNowPlaying(track);

        /*
        ロック画面・バックグラウンド再生の連携用に、今の曲情報を
        Media Sessionへ登録します(v128)。詳細はjs/media-session.js。
        */
        updateMediaSessionMetadata(track);

        /*
        ここから下は、権限やファイル取得ではなく
        「実際に音として再生できるか」の問題です。

        権限が原因の失敗と、コーデック非対応など
        別の原因の失敗を混同しないよう、
        try/catchを分けています。
        */
        try{

            // 【開発用調査ログ】
            logDebugEvent("audioPlayer.play()呼び出し前 :" + track.file_name);
            await audioPlayer.play();
            logDebugEvent("audioPlayer.play()成功 :" + track.file_name);

            console.log("再生開始 :",track.file_name);

            /*
            無事に鳴った曲が、以前に除外されていたものなら解除します(v110)。

            竹弘の仕様「再生できるようになった時は、グレーアウトが外れ、
            通常曲と同じ扱いとなる」を実現している箇所です。

            除外されていない曲では、clearExclusion() の中で何もせずに
            戻るので、毎回呼んでも無駄にはなりません。
            */
            clearExclusion(trackId);

            return true;

        }
        catch(playError){

            // 【開発用調査ログ】
            logDebugEvent("audioPlayer.play()失敗 :" + playError.name + " / " + playError.message);

            console.error(
                "再生失敗(play) :",
                playError.name,
                playError.message
            );

            /*
            コーデックが原因の失敗だけを、除外の対象にします(v110)。

            【ここで種類を選り分ける理由】

            play() の失敗には、自動再生がブラウザに止められた場合
            (NotAllowedError)なども含まれます。それを除外にすると、
            曲は何も悪くないのにグレーになってしまいます。

            判定は js/exclude.js の isCodecFailure() に任せています。
            安全装置を1箇所にまとめておくためです。

            なお alert ではなく専用パネルやconsole.errorに変えたのは、
            alert が「押されるまでJavaScriptを丸ごと止める」ためです。
            連続再生(v111)で次の曲へ進めなくなってしまいます。
            */
            if(isCodecFailure(playError)){

                reportPlaybackFailure(trackId);

            }
            else{

                /*
                コーデック以外の原因での再生失敗です(v129、alertをやめました)。

                竹弘の報告(2026-08-22): 画面ロック中に1曲リピート・連続再生が
                何度か完全に止まる不具合があり、突き止めた原因がこれでした。
                alert は「押されるまでJavaScriptを丸ごと止める」命令ですが、
                画面ロック中は誰もOKを押せません。押されるまでページ全体が
                **永遠に固まる**ため、それ以降は1曲も再生されなくなります。

                console.errorだけにすれば、この関数はfalseを返して
                すぐ戻り、queue.js のwhileループが次の曲へ進めます
                (この if/else の上にある isCodecFailure の側は、v110の
                 時点ですでに同じ理由でalertをやめていました。今回はまだ
                 alertが残っていたこちら側を揃えた形です)。
                */
                console.error(
                    "この曲は再生できませんでした(コーデック以外の原因) :",
                    track.file_name
                );

            }

            return false;

        }

    }
    catch(error){

        // 【開発用調査ログ】
        logDebugEvent("playTrack外側catch :" + error.name + " / " + error.message);

        // alertをやめた理由は上のplay()失敗時のコメントと同じです(v129)
        console.error(
            "再生失敗(権限/ファイル取得) :",
            error.name,
            error.message
        );

        return false;
    }

}

/*
============================================================
audio要素自体がエラーを起こした時の処理

play()の時点ではエラーにならなくても、
実際にファイルを読み込んで再生しようとした段階で
コーデック非対応と分かることがあります。

その場合はこちらのonerrorイベントで検知します。
============================================================
*/
audioPlayer.onerror = function(){

    if(!audioPlayer.error){ return; }

    console.error(
        "audio要素エラー :",
        audioPlayer.error.code,
        audioPlayer.error.message
    );

    /*
    コーデックが原因なら、除外のしくみへ渡します(v110)。

    【なぜ play() の失敗と両方で受けているのか】

    再生できない曲を選んだ時、ブラウザは2つの経路で失敗を知らせて
    きます。play() が失敗するのと、このイベントが起きるのと、その
    両方です。どちらが先に来るかは端末やファイルによって変わるため、
    両方で受け止めています。

    二重にパネルが出ることはありません。exclude.js の
    reportPlaybackFailure() が、同じ曲を2回は受け付けないためです。

    currentTrackId は、このファイルが持っている「今どの曲を選んだか」
    です。エラーイベント自体は曲を教えてくれないので、こちらで
    覚えている値を使います。
    */
    if(isCodecMediaError(audioPlayer.error) && currentTrackId){

        reportPlaybackFailure(currentTrackId);

        return;

    }

    /*
    コーデック以外の原因(読み込みの中断など)は除外しませんが、
    alert も使いません(v129)。理由は playTrack() 側の同種の
    修正コメントを参照してください。ここで止めてしまうと、
    次の曲へ進むはずの処理(queue.js)まで一緒に固まってしまいます。
    */
    console.error("再生できませんでした(コーデック以外のaudio要素エラー) :",currentTrackId);

};
