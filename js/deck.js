/* ============================================================
   デッキエンジン(2枚の <audio> を束ねる係)

   🕺ノリノリRun再生で「曲と曲を途切れさせずに繋ぐ」ための土台です。
   移植元(legacy の曲接続モジュール V4.6系)のレイヤー構造に倣って
   います。

       L1 デッキA … 音を鳴らす1枚目           ← このファイルが管理
       L2 デッキB … 音を鳴らす2枚目           ← このファイルが管理
       L3 メトロノーム                          (STEP5で追加)
       L4 司令塔(Master Scheduler)            (STEP5で追加)

   ------------------------------------------------------------
   【このファイルの持ち場】

   2枚のデッキそのものの世話だけをします。

       ・どちらが主役かを覚え、交代させる(swapActiveDeck)
       ・両方に耳を付け、鳴っている方の声だけ通す(bindDeckEvent)
       ・デッキごとに「載っている曲」と「一時URL」を覚える
       ・デッキごとに正しい速さを当てる(applyPitchToDeck)
       ・使い終わった裏のデッキを片付ける(clearIdleDeck)

   **「いつ繋ぐか」「どう繋ぐか」はここでは決めません。**
   それは js/connect.js(曲接続モジュール)の仕事です。デッキは
   ターンテーブル、connect.js はそれを操るDJ、という役割分担です。

   ------------------------------------------------------------
   【ここまでの歩み】

       v167 … 2枚のデッキを用意し、主役を交代できるようにした
       v168 … 2曲同時に鳴らしても壊れないよう下ごしらえ
              (URLをデッキごとに / 片付け / エラーの受け口)
       v170 … 速さの当て方を「倍率」から「BPM」へ改めた
              (曲ごとに元テンポが違うため。deckTrackIds のコメント参照)

   画面ロック中に何曲繋がるかを数えるのはSTEP6、メインメニューも
   同じ仕組みに移すのはSTEP7です。

   ------------------------------------------------------------
   【なぜ「主役の交代」という形にしたのか】

   シークバー・停止ボタン・Media Session・自動再生など、10個の
   ファイルが audioPlayer という名前で「音を鳴らす部品」を見ています。

   もし deck.js だけが2枚を知っていて、他が1枚目だけを見ていると、
   2枚目に切り替わった瞬間に **シークバーが止まり、曲が終わっても
   次へ進まなくなります**。

   そこで audioPlayer 自体を「いま鳴っている方」に入れ替える形に
   しました。他のファイルは今までどおり audioPlayer と書くだけで、
   自動的に正しいデッキを見ることになります。

   ------------------------------------------------------------
   【メインメニューは今までと1ミリも変わりません】

   メインメニューでは主役の交代が起きず、ずっとデッキAのままです。
   下の bindDeckEvent() が足す「今鳴っている方から来たイベントか」の
   判定は、この時いつも真になるので、動きは変わりません。

   竹弘と決めた「ノリノリRunで先に試して、確認できてからメイン
   メニューを移す」という順番を守るための作りです。
============================================================ */


// ==========================================================
// 1. 今どちらが主役か
// ==========================================================
/**
 * いま音を鳴らしている方ではない、もう一枚のデッキを返します。
 *
 * 次の曲を裏で仕込む先が、いつもこちらになります。
 */
function getIdleDeck(){

    return (audioPlayer === deckAudioA) ? deckAudioB : deckAudioA;

}

/**
 * 主役のデッキを交代します。
 *
 * ⚠️ audioPlayer を書き換えてよいのは、このファイルのここだけです。
 *    他の場所で書き換えると「画面が見ているデッキ」と「音が出て
 *    いるデッキ」がずれ、原因の分かりにくい不具合になります。
 */
function swapActiveDeck(){

    audioPlayer = getIdleDeck();

    console.log(
        "デッキを交代しました :",
        (audioPlayer === deckAudioA) ? "A" : "B"
    );

}


// ==========================================================
// 2. イベントを2枚とも受け取る
// ==========================================================
/**
 * 2枚のデッキ両方に、同じ耳(イベントの受け口)を付けます。
 *
 * 【なぜ両方に付けるのか】
 * 主役が交代すると、1枚目にだけ付けた耳は何も聞こえなくなります。
 * かといって交代のたびに付け替えると、付け外しの漏れが必ず起きます。
 * **最初から両方に付けておき、鳴っていない方からの声は聞き流す**のが
 * いちばん確実です。
 *
 * @param {string}   eventName - 待ち受けるイベント名("ended" など)
 * @param {Function} handler   - 起きた時にすること
 */
function bindDeckEvent(eventName,handler){

    [deckAudioA,deckAudioB].forEach(function(deck){

        deck.addEventListener(eventName,function(event){

            /*
            いま主役ではないデッキからの知らせは聞き流します。

            繋いでいる最中は2曲が同時に鳴っているので、この関門が
            無いと「裏で鳴っている曲が終わった」という知らせを受けて
            次の曲へ飛んでしまいます。
            */
            if(event.target !== audioPlayer){ return; }

            handler(event);

        });

    });

}


// ==========================================================
// 3. デッキに曲を載せる(v168)
// ==========================================================
/*
どのデッキが今どの一時URLを使っているかを覚えておく台帳です。

【一時URLとは】
曲のファイルは、そのままでは <audio> に渡せません。
URL.createObjectURL() で「このページの中だけで通じる一時的な住所」に
変えてから渡します。使い終わったら URL.revokeObjectURL() でその住所を
返さないと、曲を切り替えるたびにメモリを取られ続けます。

【なぜ台帳が必要になったか(ここがv168の要)】

v167までは、この住所を currentObjectUrl という**たった1つの変数**で
覚えていました。デッキが1枚しか鳴らなかった頃は、それで正しかった
のです。

しかしSTEP5で2曲を同時に鳴らすと、こうなります:

    1. 曲Aが鳴っている(住所A)
    2. 次の曲Bを裏のデッキに載せる
    3. その時 currentObjectUrl(=住所A)を返してしまう
    4. **まだ鳴っている曲Aの住所が無効になり、音が壊れる**

そこで「どのデッキがどの住所を使っているか」を1枚ずつ分けて覚え、
**そのデッキに次の曲を載せる時だけ、そのデッキの古い住所を返す**
ようにしました。もう一枚の住所には指一本触れません。

【Map とは】
「鍵 → 値」の対応表を作る、JavaScript標準の入れ物です。ここでは
鍵に <audio> 要素そのものを、値にその住所(文字列)を入れています。
ふつうのオブジェクト({}) は鍵に文字列しか使えませんが、Map は
要素のような「物」もそのまま鍵にできるので、デッキごとに
「deckAudioAの住所」「deckAudioBの住所」と名前を考えて変数を
2つ用意する必要がありません。デッキが将来3枚になっても直さずに済みます。
*/
const deckObjectUrls = new Map();

/*
どのデッキに、どの曲が載っているかの台帳です(v170で追加)。

【なぜ曲まで覚える必要があるのか】

再生速度の倍率は「走りたいテンポ ÷ その曲の元のテンポ」で決まります。
**元のテンポは曲ごとに違う**ので、2枚のデッキに同じ倍率を当てては
いけません。

    マイピッチ170で走る場合
      元150の曲 … 170 ÷ 150 = 1.13倍  → 170BPMで鳴る ✅
      元180の曲 … 170 ÷ 180 = 0.94倍  → 170BPMで鳴る ✅

    もし元150の曲の倍率(1.13倍)を、元180の曲にも当てると
      180 × 1.13 = 203BPM  → まったく違う速さで鳴ってしまう ❌

⚠️ v168の applyRateToBothDecks() は、この違いを見ずに両デッキへ同じ
   倍率を当てていました。裏のデッキがまだ鳴っていなかったので実害は
   出ませんでしたが、繋ぎ始めると**後続曲だけ違う速さで鳴る**という
   致命的な不具合になります。v170で下の applyPitchToBothDecks() に
   置き換えました。
*/
const deckTrackIds = new Map();

/**
 * デッキに曲のファイルを載せます。
 *
 * そのデッキが前に使っていた一時URLは、ここで返します。
 * **もう一枚のデッキが使っている住所には手を触れません。**
 *
 * @param {HTMLAudioElement} deck    - 載せる先のデッキ
 * @param {File}             file    - 鳴らしたい曲のファイル
 * @param {string}           trackId - その曲のtrack_id(速さの計算に使います)
 */
function setDeckSource(deck,file,trackId){

    // 先に、このデッキが前に使っていた住所を返します
    releaseDeckUrl(deck);

    const url = URL.createObjectURL(file);

    // 台帳に「このデッキはこの住所を使っている」と書き込みます
    deckObjectUrls.set(deck,url);

    // どの曲を載せたかも覚えます(速さを計算し直す時に要ります)
    deckTrackIds.set(deck,trackId);

    deck.src = url;

}

/**
 * そのデッキに今どの曲が載っているかを返します。
 *
 * @param  {HTMLAudioElement} deck - 調べたいデッキ
 * @return {Object|null} libraryMap から取り出した曲のデータ
 */
function getDeckTrack(deck){

    const trackId = deckTrackIds.get(deck);

    if(!trackId){ return null; }

    return libraryMap[trackId] || null;

}

/**
 * そのデッキが使っていた一時URLを返します(メモリを解放します)。
 *
 * 使っていなければ何もしないので、いつ呼んでも安全です。
 *
 * @param {HTMLAudioElement} deck - 片付けたいデッキ
 */
function releaseDeckUrl(deck){

    // Map の get は「その鍵の値」を返します。無ければ undefined です
    const oldUrl = deckObjectUrls.get(deck);

    if(oldUrl){

        URL.revokeObjectURL(oldUrl);

        // 台帳からも消しておきます(返した住所を二重に返さないため)
        deckObjectUrls.delete(deck);

    }

}


// ==========================================================
// 3-2. 音量回路(Web Audio)(v174)
// ==========================================================
/* ------------------------------------------------------------
   【なぜ <audio>.volume をやめたのか ―― v173で起きた不具合】

   竹弘の実機報告(2026-09-02):

       「後続曲の立ち上がりのフェードインだけど、曲再生が音程が
         ヨレヨレに聞こえる時がある。ボリュームを変えているだけの
         はずなのに。たまに再生中の曲もヨレヨレする時が出た」

   犯人は音量そのものではなく、**命令の回数**でした。

       ① preservesPitch=true で速度を変えている間、ブラウザは
          WSOLA という処理で波形を伸縮し続けている(CPUを食う)
       ② それを2曲同時にやっている(助走中は接続点の15秒前から)
       ③ そこへメインスレッドから毎コマ(1秒に約120回)音量の
          変更命令が飛ぶ  ← v173までの作り
       ④ 音を作る作業が間に合わず、波形の継ぎ目がずれる
          → **音程がヨレて聞こえる**

   ------------------------------------------------------------
   【移植元は同じ壁にぶつかって、乗り越えていた】

   仕様書(V4.6.6・最終版)にその記録が残っていました。

       「16msごとの逐次処理」を廃止。
       **「先行予約スケジュール方式」**を採用。

       制御方式: L4司令塔による「事前予約ボリュームスケジューリング」
       EndTS - 20秒: L4がボリューム曲線を**ハードウェアへ書き込む**

       「13=0」の精度を、**ブラウザの負荷に左右されない**
       「ハードウェアレベルの予約」で実現する

   つまり移植元は `<audio>.volume` を触っていませんでした。
   Web Audio の GainNode(音量つまみ)に**音量の曲線を1回だけ予約**し、
   あとは音を作る側(オーディオスレッド)に任せていたのです。

       v173まで … 1秒に120回「今の音量はこれ」と言い続ける
       v174から … 1回だけ「これから5.6秒かけて0まで下げて」と予約

   ------------------------------------------------------------
   【おまけ:画面ロック中も動くようになる】

   requestAnimationFrame は画面が消えると止まりますが、GainNodeの
   予約は音を作る側で実行されるので止まりません。STEP6で心配して
   いた「ロック中にクロスフェードが動かない」も、これで解決します。

   ------------------------------------------------------------
   【回路のかたち】

       deckAudioA ──> MediaElementSource ──> GainNode ──┐
                                                         ├─> スピーカー
       deckAudioB ──> MediaElementSource ──> GainNode ──┘

   ⚠️ createMediaElementSource は、1つの <audio> につき**一度しか
      呼べません**(呼ぶと元にも戻せません)。そのため下の
      ensureDeckAudioGraph() は、最初の1回だけ回路を組み、
      2回目以降は何もせずに戻ります。
------------------------------------------------------------ */

// 音を扱う作業台。1つだけ作り、**閉じません**(理由は下の resume の項)
let deckAudioCtx = null;

// デッキ → そのデッキの音量つまみ(GainNode)
const deckGains = new Map();

/**
 * 音量回路を用意します。すでにあれば何もしません。
 *
 * ⚠️ **必ずユーザーの操作(タップ)の中から呼ぶこと。**
 *    ブラウザは、操作と関係なく音を鳴らし始めることを禁じています。
 *    操作の外で作ると眠ったまま(suspended)になり、**音が出なく
 *    なります**。
 */
function ensureDeckAudioGraph(){

    if(deckAudioCtx){ return; }

    try{

        deckAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

        [deckAudioA,deckAudioB].forEach(function(deck){

            const source = deckAudioCtx.createMediaElementSource(deck);

            const gain = deckAudioCtx.createGain();

            gain.gain.value = 1;

            /*
            源(曲)→ 音量つまみ → スピーカー、と数珠つなぎにします。
            connect が「配線する」命令です。
            */
            source.connect(gain);
            gain.connect(deckAudioCtx.destination);

            deckGains.set(deck,gain);

        });

        console.log("デッキの音量回路を作りました");

    }
    catch(error){

        /*
        作れなかった時は、今までどおり <audio>.volume で音量を
        変えます(下の各関数が自動的にそちらへ切り替わります)。

        音は普通に鳴り続けるので、竹弘が困ることはありません。
        フェードの滑らかさだけが落ちます。
        */
        console.error(
            "音量回路を作れませんでした(音量は<audio>で制御します) :",
            error.name,error.message
        );

        deckAudioCtx = null;
        deckGains.clear();

    }

}

/**
 * 眠っている音量回路を起こします。
 *
 * AudioContext は、しばらく音を出さないでいるとブラウザやOSに
 * 眠らされる(suspended)ことがあります。眠ったままだと**音が
 * 一切出ません**。曲を鳴らす前と、竹弘が画面に触れた時に起こします。
 *
 * ⚠️ close() は絶対に呼ばないこと。v157で、閉じるとスマホの
 *    オーディオ出力ごと止まり、次に音を出す時「ブッ」というノイズが
 *    出る不具合になりました(竹弘が規則性を見つけて特定)。
 */
function resumeDeckAudio(){

    if(!deckAudioCtx){ return; }

    if(deckAudioCtx.state === "suspended"){

        deckAudioCtx.resume().catch(function(error){

            console.error("音量回路を起こせませんでした :",error.name,error.message);

        });

    }

}

/**
 * デッキの音量を、その場で設定します。
 *
 * @param {HTMLAudioElement} deck   - 対象のデッキ
 * @param {number}           volume - 0(無音)〜1(最大)
 */
function setDeckVolume(deck,volume){

    const gain = deckGains.get(deck);

    // 回路が無い時は、今までどおり <audio> の音量を使います
    if(!gain){

        deck.volume = volume;

        return;

    }

    const now = deckAudioCtx.currentTime;

    /*
    先に、予約してある変化を取り消します。

    これを忘れると、進行中のフェードと今回の指定が競合して、
    音量が行ったり来たりします。
    */
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(volume,now);

}

/**
 * デッキの音量を、あらかじめ用意した曲線に沿って変えるよう予約します。
 *
 * **これがv174の心臓部です。** 1回呼ぶだけで、あとは音を作る側が
 * 正確に実行してくれます。メインスレッド(JavaScript)は解放され、
 * 竹弘が画面を触っていても、画面が消えていても、音は乱れません。
 *
 * @param {HTMLAudioElement} deck        - 対象のデッキ
 * @param {Float32Array}     curve       - 音量の道すじ(0〜1の値の並び)
 * @param {number}           durationSec - かける時間(実秒)
 */
function rampDeckVolume(deck,curve,durationSec){

    const gain = deckGains.get(deck);

    if(!gain){

        /*
        回路が無い環境では、フェードせずに終わりの音量へ飛ばします。
        AudioContext に対応していないブラウザはほぼ無いので、実際に
        ここを通ることはまず起きません。
        */
        deck.volume = curve[curve.length - 1];

        return;

    }

    const now = deckAudioCtx.currentTime;

    gain.gain.cancelScheduledValues(now);

    /*
    setValueCurveAtTime は「この道すじを、この時間で辿って」という
    予約です。曲線の形を自由に決められるので、クロスフェードの谷も
    そのまま表現できます。
    */
    gain.gain.setValueCurveAtTime(curve,now,durationSec);

}

/*
画面のどこかが触られたら、音量回路を起こします。

【なぜ「どこでも」なのか】
眠るきっかけ(バックグラウンドへ回る、OSの省電力)は、こちらから
見えません。再生ボタンの中だけで起こす作りにすると、別の操作の
後で眠ったまま曲が始まり、**無音のまま再生が進む**ことがあります。

タップのたびに1回状態を見るだけなので、負担にはなりません。
passive:true は「この処理は画面のスクロールを邪魔しません」という
ブラウザへの申告で、指の動きが滑らかになります。
*/
[ "click","touchstart" ].forEach(function(eventName){

    document.addEventListener(eventName,resumeDeckAudio,{passive:true});

});


// ==========================================================
// 4. 両デッキで共通の設定
// ==========================================================
/**
 * 1枚のデッキを、指定のテンポで鳴るように設定します(v170)。
 *
 * **倍率ではなく「鳴らしたいBPM」を渡す**のがこの関数の要です。
 * 倍率はデッキに載っている曲の元テンポから、ここで計算します。
 * そうしないと、元テンポの違う曲に他の曲の倍率を当ててしまいます
 * (deckTrackIds のコメント参照)。
 *
 * @param  {HTMLAudioElement} deck     - 設定するデッキ
 * @param  {number}           targetBpm - 鳴らしたいテンポ
 * @return {boolean} 設定できたら true(曲が載っていなければ false)
 */
function applyPitchToDeck(deck,targetBpm){

    const track = getDeckTrack(deck);

    // 何も載っていないデッキには、当てるべき速さがありません
    if(!track){ return false; }

    const base = getEffectiveBaseBpm(track);

    // 安全装置。0.5〜2.0倍からはみ出さないようにします(pitch.jsと同じ)
    const rate = Math.min(Math.max(targetBpm / base,RATE_MIN),RATE_MAX);

    /*
    preservesPitch は「速度を変えても音の高さは変えない」という指定です。
    webkitPreservesPitch も一緒に書くのは、古いブラウザがこちらの名前
    しか知らないためです(知らない方は黙って無視されます)。
    */
    deck.preservesPitch = true;
    deck.webkitPreservesPitch = true;
    deck.playbackRate = rate;

    return true;

}

/**
 * 2枚のデッキを、同じテンポで鳴るように揃えます(v170)。
 *
 * 繋ぐ時、**2枚は同じテンポで鳴っていなければなりません**。
 * 片方だけ速いと、繋ぎ目でテンポが変わってランナーが転びます。
 *
 *     竹弘:「ランナーが曲と曲の間でノッて走っていたら
 *             曲のテンポが変わり、コケてしまう」
 *
 * ⚠️ 「同じ速さ(倍率)」ではなく「同じテンポ(BPM)」で揃えます。
 *    曲ごとに元のテンポが違うので、同じ倍率では揃いません。
 *
 * @param {number} targetBpm - 2枚とも、このテンポで鳴らします
 */
function applyPitchToBothDecks(targetBpm){

    [deckAudioA,deckAudioB].forEach(function(deck){

        applyPitchToDeck(deck,targetBpm);

    });

}

/**
 * 裏のデッキを完全に片付けます。
 *
 * 曲を止める時や、モードを抜ける時に呼びます。片付けを忘れると、
 * 裏で音量0のまま鳴り続け、電池を食い続けることになります。
 */
function clearIdleDeck(){

    const idle = getIdleDeck();

    idle.pause();

    /*
    src を空にする前に removeAttribute で外しています。

    空文字を入れると、ブラウザによっては「そのページ自身」を
    音楽ファイルとして読みに行こうとし、コンソールに読み込み
    エラーが並ぶことがあるためです。
    */
    idle.removeAttribute("src");
    idle.load();

    /*
    使っていた一時URLも返します(v168)。

    src を外しただけでは住所そのものは生きたままで、そのぶんの
    メモリが解放されません。片付けるならここまでやって一組です。
    */
    releaseDeckUrl(idle);

    // どの曲が載っていたかの記録も消します(v170)
    deckTrackIds.delete(idle);

    /*
    音量を1(最大)に戻しておきます。

    繋いでいる最中に音量を0まで下げたデッキが、そのまま次の出番を
    迎えると、**次の曲が無音で始まってしまう**ためです。片付けの
    たびに元に戻しておけば、どのデッキもいつでも使える状態で待てます。

    v174から setDeckVolume() を通します。音量つまみ(GainNode)が
    音量を持つようになったため、<audio>.volume を直に書き換えても
    効かなくなったためです。
    */
    setDeckVolume(idle,1);

}
