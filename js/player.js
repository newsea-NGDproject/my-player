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
 */
async function playTrack(trackId){

    try{

        const track = libraryMap[trackId];

        if(!track || !track.file_handle){
            alert("曲データが見つかりませんでした。c013で再登録してください。");
            return;
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

            return;

        }

        // --- 権限を確認し直します(c013と同じパターン) ---
        let permission = await track.file_handle.queryPermission({mode:"read"});

        if(permission !== "granted"){
            permission = await track.file_handle.requestPermission({mode:"read"});
        }

        if(permission !== "granted"){
            alert("この曲へのアクセスが許可されませんでした。");
            return;
        }

        const file = await track.file_handle.getFile();

        if(currentObjectUrl){
            URL.revokeObjectURL(currentObjectUrl);
        }

        currentObjectUrl = URL.createObjectURL(file);

        // 今どの曲を選んだかを覚えておきます(次に同じ曲がタップされた時の判定用)
        currentTrackId = trackId;

        audioPlayer.src = currentObjectUrl;
        nowPlayingEl.textContent = "再生中：" + (track.title || track.file_name);
        playerBox.style.display = "block";

        /*
        ここから下は、権限やファイル取得ではなく
        「実際に音として再生できるか」の問題です。

        権限が原因の失敗と、コーデック非対応など
        別の原因の失敗を混同しないよう、
        try/catchを分けています。
        */
        try{

            await audioPlayer.play();

            console.log("再生開始 :",track.file_name);

        }
        catch(playError){

            console.error(
                "再生失敗(play) :",
                playError.name,
                playError.message
            );

            alert(
                "この曲は再生できませんでした。\n" +
                "ファイル形式(コーデック)がこの端末で対応していない可能性があります。\n" +
                "(" + track.file_name + ")"
            );

        }

    }
    catch(error){
        console.error(
            "再生失敗(権限/ファイル取得) :",
            error.name,
            error.message
        );
        alert("再生に失敗しました。ブラウザのファイル権限が切れている可能性があります。");
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

    let reason = "不明なエラーです。";

    if(audioPlayer.error.code === audioPlayer.error.MEDIA_ERR_DECODE){
        reason = "ファイル形式(コーデック)がこの端末で対応していない可能性があります。";
    }
    else if(audioPlayer.error.code === audioPlayer.error.MEDIA_ERR_SRC_NOT_SUPPORTED){
        reason = "この形式のファイルは、このブラウザでは再生できません。";
    }

    alert("再生できませんでした。\n" + reason);

};
