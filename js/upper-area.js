/*
================================================================
 upper-area.js … 上半分(操作エリア)の表示を受け持つファイル

 c014.html の上半分は、丸角カード1枚の中を縦10等分し、
 上から順に次のものを並べたレイアウトになっています。

     エリア1〜2   解析ランプ / タイトル「ノリRun」
     エリア3〜4   再生中の曲情報(♪・タイトル・再生位置・
                  アーティスト・ジャケット)
     エリア5      シークバー + ミュートボタン
     エリア6      現在のピッチ + 「元ピッチ」ボタン
     エリア7〜8   ピッチ変更の定規
     エリア9      マイピッチ設定 / 🕺ノリノリRun再生
     エリア10     🕺ノリノリプレイリスト作成 / 停止・設定

 【このファイルを新しく作った理由】

 上半分にはこれから、シーク操作・ピッチ変更・ビートマッチング
 といった機能を1つずつ足していきます。それらを player.js や
 main.js に少しずつ書き足していくと、置き場所がバラバラになり、
 c014.html が3,000行近くまで膨らんだ時と同じことになります。

 そこで「上半分の担当」を最初から独立したファイルとして
 用意しました。今後、上半分に機能を足す時はこのファイルに
 書き足していきます。

 【今このファイルにあるもの】

 竹弘の手順(まずレイアウトだけ組んで確認 → その後に機能を
 1つずつ)に従って進めています。現時点で動くのは

     ・再生中の曲情報の表示(エリア3〜4)
     ・タイトル/アーティスト名のタップで横スクロール(エリア3〜4)
     ・シークバー(エリア5)
     ・ミュートボタン(エリア5)
     ・停止/再開ボタン(エリア10)

 の5つです。ピッチ定規やその他のボタンは、まだ見た目だけで
 ここには何も書いていません。

 【読み込み順について】

 このファイルは list-view.js の後に読み込みます。下の
 showNowPlaying() が、曲一覧の行を作るのに使っている関数
 (buildTitleText / formatDuration / createJacketImage)を
 そのまま借りているためです。

 借りているのは「曲一覧と同じ見た目にする」ためではなく、
 「曲一覧と同じものを使う」ためです。同じ関数を使っていれば、
 将来どちらかの表示を直した時に、片方だけ古いまま取り残される
 ことがありません。
================================================================
*/


/**
 * 再生中の曲の情報を、上半分のエリア3〜4に表示します。
 *
 * js/player.js が曲を再生する時に呼びます。
 *
 * @param {Object} track … libraryMap から取り出した1曲分のデータ
 */
function showNowPlaying(track){

    if(!track){ return; }

    // ---- 1行目：曲のタイトル ----
    /*
    textContent は「文字としてそのまま入れる」書き込み方です。
    innerHTML と違ってHTMLとして解釈されないため、曲名に
    < や > のような記号が入っていても表示が崩れません
    (list-view.js が escapeHtml を使っているのと同じ目的を、
      こちらは textContent を使うことで果たしています)。
    */
    npTitleEl.textContent = buildTitleText(track);

    // ---- 2行目の左側：再生位置(何分何秒中の何分何秒) ----
    /*
    曲一覧の2行目は「曲の長さ」ですが、ここは竹弘の指定により
    再生位置の表示にします。

    曲を選んだ直後なので、左側(今どこを再生しているか)は0秒です。
    右側の曲の長さには、DBに保存してある値をひとまず使います。
    音の読み込みが済んだ時点で、下の loadedmetadata が
    audioが実際に測った長さへ置き換えます。
    */
    npSeekEl.textContent =
        formatSeekTime(0) + " / " + formatSeekTime(track.duration);

    // ---- 2行目の右側：アーティスト名 ----
    // 取得できていない曲は、竹弘の指示通り何も表示しません。
    npArtistEl.textContent = track.artist || "";

    // ---- ジャケット画像 ----
    /*
    前の曲の画像が残らないよう、まず中身を空にします。

    そのあと、曲一覧と同じ createJacketImage() で <img> を作り、
    クラス名だけ上半分用(.ua-jacket-img)に付け替えています。
    曲一覧のジャケットは44px角の固定サイズですが、上半分は
    エリア3〜4の高さいっぱいに広げるためです。

    こうすると、一時URLをきちんと解放する後始末(あの関数の
    onload / onerror でやっています)まで丸ごと再利用でき、
    list-view.js を1文字も書き換えずに済みます。
    */
    npJacketEl.innerHTML = "";

    if(track.cover_art){

        const jacketImg = createJacketImage(track.cover_art);
        jacketImg.className = "ua-jacket-img";

        npJacketEl.appendChild(jacketImg);

        npJacketEl.style.display = "block";

    }
    else{

        /*
        ジャケットが無い曲では、枠ごと消します(v91、竹弘の指示)。

        曲一覧と同じ扱いです。あちらもジャケットが取得できた曲に
        だけ画像を差し込む作りで、無い曲は何も置きません。

        枠が消えると、右端に空いたぶんだけタイトルと
        アーティストの表示スペースが自動で広がります
        (.text-block が flex:1 で余りを受け取るため)。
        */
        npJacketEl.style.display = "none";

    }

    // ---- ピッチ(元ピッチ / 再生ピッチ) ----
    /*
    まだ解析していない曲は、この中でBPMを解析します。

    await を付けずに呼んでいるのは、解析に数秒かかることがあるためです。
    先に曲名・アーティスト・ジャケットを出してしまい、ピッチの数字だけが
    解析の終わった時点で後から入る、という順番にしています。
    こうしないと、曲を選んでから画面に何も出ない時間ができてしまいます。
    */
    updatePitchDisplay(track);

}


/*
================================================================
 エリア6：ピッチ(BPM)の表示
================================================================
*/

/*
BPMを画面に出す形(3桁)にします。

竹弘の指定で、数字は必ず3桁です(例: 85 → 085)。padStart(3,"0") は
「3文字になるまで先頭に0を足す」という命令で、こうしておくと
85と123で桁数が変わらず、右にある文字の位置がずれません。

まだ分かっていない時は、3桁ぶんの「---」を返します。
*/
function formatPitch(bpm){

    if(!bpm || !isFinite(bpm) || bpm <= 0){
        return "---";
    }

    return String(Math.round(bpm)).padStart(3,"0");

}

/*
再生する曲のピッチを表示します。まだ解析していない曲は、ここで解析します。

【なぜ再生した曲だけ解析するのか】

BPMの解析は、曲を丸ごと波形の数値にほどいてから調べます。4分の曲で
80MBほどのメモリを使うため、369曲を一度にやるとメモリが足りません。
その曲を実際に聴く時に1曲だけ解析し、結果をDBに残す形にしています。
2回目からは保存した値をそのまま出すので待ち時間はありません
(タイトルやジャケットの解析と同じ考え方です)。
*/
async function updatePitchDisplay(track){

    /*
    すでに解析済みなら、保存してある値でそのまま再生します。

    applyTrackTempo() は js/pitch.js の関数で、前回この曲で選んだ
    テンポ(userBPM)があればその速さで、無ければ元ピッチのままで
    鳴らします。あわせて再生ピッチの数字と定規の位置も揃えます。
    */
    if(!needsBpmAnalysis(track)){
        applyTrackTempo(track);
        return;
    }

    // 解析が終わるまでは「---」のままにしておきます
    basePitchValueEl.textContent = "---";
    pitchValueEl.textContent = "---";

    await analyzeTrackBpm(track.track_id);

    /*
    解析には数秒かかることがあります。その間に竹弘が別の曲を選んで
    いた場合、ここで書き込むと「今かかっている曲」とは違う数字が
    出てしまいます。そのため、まだ同じ曲が選ばれている時だけ
    画面を更新します。

    currentTrackId は js/player.js が持っている「今どの曲を選んだか」です。
    */
    if(currentTrackId !== track.track_id){ return; }

    applyTrackTempo(track);

}


/*
================================================================
 エリア3〜4：タップで長い文字を横スクロール
================================================================
*/

/*
タイトルとアーティスト名をタップすると、枠に収まりきらずに
隠れている部分を横スクロールで見せます(v92、竹弘の指示)。
曲一覧の行をタップした時と同じ演出です。

【曲一覧との違い(ここだけ作りが違います)】

曲一覧は2行目(曲の長さ + アーティスト名)を丸ごと流しますが、
こちらは再生位置を動かしません。竹弘の指示で、再生位置は
今後シークバーと連動させる予定があるためです。

    「曲の長さだけは、今後シークともリンク予定なので
      スクロールの対象としないでください」

そこでアーティスト名だけに専用の窓(#np-artist-line)をかぶせ、
その窓を対象にしています。窓の外にある再生位置は動きません。

【triggerMarquee に何を渡すのか】

list-view.js の関数をそのまま借りています。渡すのは
流したい文字そのものではなく、外側の「窓」の要素です。
あの関数は窓の中の最初の子要素(文字の入ったspan)を掴んで
動かす作りなので、窓と中身が揃っている必要があります。

曲一覧と同じ関数を使っているため、流れる速さも戻り方も
完全に同じになります。将来どちらかを直せば、両方に効きます。

【なぜ再生は始めないのか】

曲一覧では、この演出と一緒に playTrack() も呼んで曲の再生を
始めています。こちらは「今かかっている曲」を出している場所で、
すでに再生中です。そのため文字を流すだけにしています。
*/
const npTitleLine = document.getElementById("np-title-line");
const npArtistLine = document.getElementById("np-artist-line");

npTitleLine.addEventListener("click",function(){
    triggerMarquee(npTitleLine);
});

npArtistLine.addEventListener("click",function(){
    triggerMarquee(npArtistLine);
});


/*
================================================================
 エリア5：シークバー(再生位置の表示と操作)
================================================================
*/

const seekBar = document.getElementById("seek-bar");

/*
シークバーのつまみを指でつまんでいる最中かどうかを覚えておく印です。

【なぜ必要か】

再生中は、下の timeupdate が絶え間なくバーの位置を書き換えています。
その最中に竹弘が指でつまみを動かすと、「指が動かす」と「再生が動かす」が
同時に起きて、つまみが指から逃げていくような動きになります。

そこで、つまみを触っている間だけこの印を立て、timeupdate 側に
「今は書き換えないで」と伝えるようにしました。
*/
let isSeeking = false;

/*
再生位置の秒数を「分.秒」の文字にします。

list-view.js の formatDuration() をそのまま使わないのには理由が
あります。あちらは「まだ解析していない曲」を空文字で表す作りなので、
0秒も空文字になってしまいます。再生位置は必ず0秒から始まるため、
ここでは0秒を「00.00」として扱える形にしました。

区切りが「:」ではなく「.」なのは、曲一覧の曲の長さと同じ竹弘の
指定に合わせているためです(中身は formatDuration に任せています)。
*/
function formatSeekTime(seconds){

    if(!seconds || !isFinite(seconds) || seconds <= 0){
        return "00.00";
    }

    return formatDuration(seconds);

}

/*
再生位置の文字(エリア3〜4の「00.00 / 04.00」)を書き換えます。
*/
function updateSeekText(currentSeconds){

    npSeekEl.textContent =
        formatSeekTime(currentSeconds) + " / " + formatSeekTime(audioPlayer.duration);

}

/*
曲の長さが分かった時点で、バーの目盛りをその曲に合わせます。

loadedmetadata は「曲の中身(長さなど)が読み込めた」という合図の
イベントです。src を差し替えた直後はまだ長さが分からない
(duration が NaN になる)ため、この合図を待ってから設定します。

seekBar.max に曲の長さ(秒)を入れることで、バーの左端が0秒、
右端が曲の終わりを表すようになります。
*/
audioPlayer.addEventListener("loadedmetadata",function(){

    seekBar.max = audioPlayer.duration;
    seekBar.value = 0;

    updateSeekText(0);

});

/*
再生が進むたびに、バーと文字を今の位置に合わせます。

timeupdate は再生中におよそ0.25秒ごとに起きるイベントです。
細かすぎず粗すぎない間隔なので、秒の表示を更新するのにちょうど
良く、専用のタイマーを自分で回す必要がありません。
*/
audioPlayer.addEventListener("timeupdate",function(){

    // つまみを触っている間は、指の邪魔をしないよう何もしません
    if(isSeeking){ return; }

    seekBar.value = audioPlayer.currentTime;

    updateSeekText(audioPlayer.currentTime);

});

/*
つまみを動かしている最中の処理です。

input は「値が変わるたび」に起きるイベントで、指を動かしている
間ずっと呼ばれます。ここでは音の再生位置はまだ動かさず、文字だけを
先に更新します。動かしている途中で音まで飛ばすと、音が細切れに
鳴って耳障りなためです。

「今どのあたりを指しているか」は文字で分かるので、
狙った場所で指を離せます。
*/
seekBar.addEventListener("input",function(){

    isSeeking = true;

    // Number() を通しているのは、入力部品の値が文字列で返るためです
    updateSeekText(Number(seekBar.value));

});

/*
指を離した時の処理です。

change は「操作が終わって値が確定した時」に起きるイベントです。
ここで初めて、実際の再生位置を動かします。
*/
seekBar.addEventListener("change",function(){

    audioPlayer.currentTime = Number(seekBar.value);

    isSeeking = false;

});


/*
================================================================
 エリア10：停止ボタン(■ / ▶)
================================================================
*/

/*
竹弘の判断で「一時停止」にしています。

    ■ を押す … その場で止まり、記号が ▶ に変わる
    ▶ を押す … 続きから再生され、記号が ■ に戻る

信号待ちや給水で止めても、そこから走り出せるようにするためです
(再生位置が曲の先頭に戻る「完全停止」ではありません)。
*/
const STOP_ICON_PLAYING = "■";
const STOP_ICON_PAUSED = "▶";

const stopBtn = document.getElementById("stop-btn");

stopBtn.addEventListener("click",function(){

    /*
    まだ1曲も選んでいない時は、鳴らすものがないので何もしません。
    音の入っていない状態で play() を呼ぶとエラーになるためです。
    */
    if(!audioPlayer.src){ return; }

    if(audioPlayer.paused){
        audioPlayer.play();
    }
    else{
        audioPlayer.pause();
    }

});

/*
記号(■ ⇄ ▶)の切り替えは、ボタンが押された時ではなく
「実際に再生が始まった/止まった時」に行います。

こうしておくと、曲一覧をタップして再生が始まった時のように
このボタン以外がきっかけで状態が変わった場合でも、記号が自動的に
正しくなります。押された時に書き換える作りだと、別の場所から
再生が始まった時に ▶ のまま取り残されてしまいます。

「JSは “今どうなっているか” を写すだけ」という形にしておくのが、
表示と実際の状態がズレない一番の近道です。
*/
audioPlayer.addEventListener("play",function(){
    stopBtn.textContent = STOP_ICON_PLAYING;
    stopBtn.classList.remove("paused-icon");
});

audioPlayer.addEventListener("pause",function(){
    stopBtn.textContent = STOP_ICON_PAUSED;

    /*
    ▶ の記号だけ、丸ボタンの中で左右の余白を微調整するためのクラスです
    (v126、竹弘の指摘)。■ は正方形で左右対称ですが、▶ は先端が
    尖った三角形のため、Unicode文字の送り幅どおりに中央寄せすると
    「先端側(右)の余白が広く見える」というズレが出ます。
    このクラスがある間だけ、CSS側(c014.html)で右へ少し寄せます。

    ■ とは違うCSSを当てたいので、記号の書き換えと同時にこのクラスも
    付け外しします。付け忘れを防ぐため、テキストを書き換えている
    この場所にまとめています。
    */
    stopBtn.classList.add("paused-icon");
});


/*
================================================================
 エリア5：ミュートボタン(🔈 / 🔇)
================================================================
*/

/*
ボタンに出す絵文字を、名前を付けて覚えておきます。

    🔈 … 音が出ている状態
    🔇 … 消音中(スピーカーに×が付いた絵文字)

直接 "🔇" と書いても動きますが、絵文字は見た目が似ていて
コードの中では区別しづらいため、名前を付けておくと
どちらの状態を指しているのか読み間違えずに済みます。

c014.html に書いてあるボタンの初期表示も 🔈 です。
*/
const MUTE_ICON_SOUND_ON = "🔈";
const MUTE_ICON_SOUND_OFF = "🔇";

/*
ミュートボタンの取得と、押された時の動きの登録です。

【なぜ config.js ではなくここで取得しているのか】

config.js に置いてあるのは、複数のファイルから使う部品だけです
(曲情報の表示部品は player.js の再生処理から間接的に使うため
  あちらに置いています)。このボタンは上半分の中で完結していて
他のファイルからは触らないので、担当であるこのファイルの中に
まとめておく方が、後から探しやすくなります。

【なぜ関数にせず、そのまま書いているのか】

このファイルは c014.html の一番下で読み込まれるため、
読み込まれた時点でHTMLは組み上がっています。そのため
「起動処理から呼んでもらう」必要がなく、js/player.js が
audioPlayer.onerror をそのまま書いているのと同じやり方に
揃えています。
*/
const muteBtn = document.getElementById("mute-btn");

muteBtn.addEventListener("click",function(){

    /*
    audio要素の muted は「今、消音中かどうか」を持つ真偽値です。

    ! は「反対にする」という意味なので、この1行で
    押すたびに 消音 ⇄ 消音解除 が入れ替わります。

    見た目(絵文字)を切り替えるだけでなく、実際の音も
    ここで一緒に消しています。絵文字が🔇になっているのに
    音が鳴り続けると、竹弘が実機で確認する時に
    「ボタンが効いていない」と誤解してしまうためです。
    */
    audioPlayer.muted = !audioPlayer.muted;

    if(audioPlayer.muted){
        muteBtn.innerText = MUTE_ICON_SOUND_OFF;
    }
    else{
        muteBtn.innerText = MUTE_ICON_SOUND_ON;
    }

});
