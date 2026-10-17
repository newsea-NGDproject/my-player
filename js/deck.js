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

/*
「いま音量0で助走中のデッキ」を覚えておく名簿です(v176)。

【なぜこれが要るのか ―― 聞こえない音のために、CPUを使っていた】

再生速度を変えても音の高さを変えない仕組み(preservesPitch)は、
**WSOLA**という方法で動いています。ざっくり言うと、音を数十ミリ秒の
カケラに切り、「今鳴らし終えたカケラと一番よく似た形の波」を毎回
探してから貼り合わせる、という処理です。

    この「一番似た場所を探す」が、力ずくの総当たり計算です。
    数百通りの位置を試して、そのたびに数百回の掛け算をする。
    それを数十ミリ秒ごとに、音が鳴っている間ずっと、左右2つ分。

つまり preservesPitch = true にしている間、ブラウザは**ずっと重い
計算を回し続けています。**

ところが助走中(接続点の15秒前から)、裏のデッキは**音量0で誰にも
聞こえていません。** 聞こえない音のために、この重い計算を全力で
回していたことになります。しかも先行曲のぶんと合わせて2曲同時。

    竹弘の実機報告(2026-09-02):
    「後続曲の立ち上がりのフェードインだけど、曲再生が音程が
      ヨレヨレに聞こえる時がある。たまに再生中の曲もヨレヨレする」

WSOLAは計算が間に合わないと、探索を打ち切って似ていない場所で
貼ります。すると波の周期が乱れ、それが「音程のヨレ」として
聞こえます。**2曲同時のWSOLAが、その負荷の正体でした。**

【なぜ音程が狂わないのか】

助走中は preservesPitch を切る(false)ので、その間の裏デッキは
昔のテープの早送りのように音程がずれています。しかし**音量0なので
誰にも聞こえません。** 接続点=音が聞こえ始める瞬間に true へ戻すので、
耳に届く時にはもう正しい音程になっています。

⚠️ preservesPitch は「音の作り方」だけを変えるもので、**時間の進み方
   (playbackRate)には影響しません。** だから助走の逆算 ―― 接続点で
   ちょうど0拍目に着くという設計 ―― は1ミリも狂いません。ここが
   この対策を安全に使える理由です。

【なぜ旗(名簿)という形にしたのか ―― ここが実装の要】

「助走を始める時に false にする」だけでは**元に戻ってしまいます。**
走りながら定規でテンポを変えると、

    pitch.js の applyTempo() → connect.js の rescheduleConnect()
    → applyPitchToDeck()  ← ここで preservesPitch を上書き

という道を通るためです。速さを変えるたびに true へ戻され、いつの間にか
2曲ともWSOLAが回っている状態に逆戻りします。

そこで**状態を名簿で持ち、applyPitchToDeck() が毎回それを見て決める**
形にしました。こうすれば、どこから何度呼ばれても答えは同じになります。
*/
const deckSilentPreRoll = new Set();

/**
 * そのデッキが「音量0で助走中」かどうかを設定します(v176)。
 *
 * 上の deckSilentPreRoll のコメントに、何のための仕組みかを
 * 詳しく書いてあります。
 *
 * @param {HTMLAudioElement} deck - 対象のデッキ
 * @param {boolean}          on   - true=助走中(音程維持を切る) / false=解除
 */
function setDeckSilentPreRoll(deck,on){

    if(on){

        deckSilentPreRoll.add(deck);

    }
    else{

        deckSilentPreRoll.delete(deck);

    }

    /*
    名簿を書き換えるだけでなく、その場で <audio> にも反映します。

    名簿だけ直して applyPitchToDeck() が次に呼ばれるのを待つ作りだと、
    **呼ばれないまま音が聞こえ始める**場面で音程が狂ったままになります。
    旗を下ろした瞬間に必ず正しくなる、という形にしておきます。
    */
    deck.preservesPitch = !on;
    deck.webkitPreservesPitch = !on;

}

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

    /*
    ---- ⚠️ 安全網:「音量0」の旗を、必ず下ろしてから載せる(v200) ----

    このデッキが前に何をしていたかに関わらず、**新しい曲を載せる=
    新しい出番が来た**ということです。旗が立ったまま鳴り始めると、
    音程維持が切れた状態(preservesPitch=false)で鳴るので、
    **その曲の声が甲高くなったり低くなったりします。**

    v199までは、旗を立てるのが「助走を始める時」だけだったので、
    接続点で必ず下りていました。v200で「接続後に完走していく先行曲」
    にも立てるようにしたため、**旗が立ったまま次の出番を迎えるデッキ**
    が生まれます。竹弘が曲一覧をタップした時がまさにそれです。

    この関数は、曲をデッキに載せる**3つの入口すべて**が通ります。

        js/connect.js  助走を始める時(この直後に旗を立て直します)
        js/connect.js  頭出し接続で後続曲を用意する時
        js/player.js   竹弘が曲をタップして再生する時

    だから**ここ1か所で塞げば、どの道から来ても安全**です。
    呼ぶ側それぞれに書くと、必ずどこかで書き忘れます。
    */
    setDeckSilentPreRoll(deck,false);

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
                                                         ├─> 全体の音量つまみ ──> スピーカー
       deckAudioB ──> MediaElementSource ──> GainNode ──┘          ↑
                         ノリノリアシスト(js/metronome.js)の音量つまみ ─┘

   「全体の音量つまみ」(deckMasterGain)は v239 で足しました。同期モードで
   「音だけ消す」時に、曲とカチッをまとめて 0 にするためです(下の 3-4)。
   ⚠️ 同期モードのピッ・カチッ・出口を休ませない信号(js/sync.js)は、
      このつまみを通さず、スピーカーへ直接つないだままです。

   ⚠️ createMediaElementSource は、1つの <audio> につき**一度しか
      呼べません**(呼ぶと元にも戻せません)。そのため下の
      ensureDeckAudioGraph() は、最初の1回だけ回路を組み、
      2回目以降は何もせずに戻ります。
------------------------------------------------------------ */

// 音を扱う作業台。1つだけ作り、**閉じません**(理由は下の resume の項)
let deckAudioCtx = null;

// デッキ → そのデッキの音量つまみ(GainNode)
const deckGains = new Map();

// 全体の音量つまみ(v239)。2枚のデッキとノリノリアシストの音が、ここを通ってスピーカーへ出ます
let deckMasterGain = null;

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

        /*
        全体の音量つまみ(v239)を、デッキの回路より先に作ります。
        デッキの音量つまみは、スピーカーではなくここへつなぎます。
        */
        deckMasterGain = deckAudioCtx.createGain();
        deckMasterGain.gain.value = 1;
        deckMasterGain.connect(deckAudioCtx.destination);

        [deckAudioA,deckAudioB].forEach(function(deck){

            const source = deckAudioCtx.createMediaElementSource(deck);

            const gain = deckAudioCtx.createGain();

            gain.gain.value = 1;

            /*
            源(曲)→ 音量つまみ → 全体の音量つまみ → スピーカー、と
            数珠つなぎにします。connect が「配線する」命令です。
            (v238まではスピーカーへ直接つないでいました)
            */
            source.connect(gain);
            gain.connect(deckMasterGain);

            /*
            ⚠️ <audio> 側の音量を1に戻します(v175で追加した命綱)。

            音は「<audio>.volume × GainNodeの値」という掛け算で決まり
            ます。回路ができる前に <audio>.volume が0にされていると、
            **GainNodeをいくら上げても 0 × 1 = 0 で無音のまま**です。

            v174でまさにこの事故が起きました(竹弘の実機報告:
            「デッキBの再生に失敗。シークだけ動いて音がなりません」)。
            回路ができる前の音量調整が <audio>.volume に書き込まれ、
            回路ができた後は誰もそれを1に戻さなかったためです。

            ここで1に揃えておけば、以後の音量は下の setDeckVolume /
            rampDeckVolume が GainNode だけで受け持ちます。
            */
            deck.volume = 1;

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
        deckMasterGain = null;

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

    /*
    【v238】「止めたので出口を休ませる」予約が残っていたら、取り消します
    (下の 3-3 の sleepDeckAudioSoon)。止めてから0.5秒以内に鳴らし直した時、
    鳴り始めた後に休まされてしまわないためです。
    */
    cancelDeckAudioSleep();

    if(!deckAudioCtx){ return; }

    if(deckAudioCtx.state === "suspended"){

        /*
        【v238】すでに起こしている途中なら、二重には起こしません。
        resume() は少し時間がかかり(実測で約0.3秒)、その間 state は
        "suspended" のままです。
        */
        if(deckAudioWakePending){ return; }

        /*
        【開発用調査ログ】(v238)このアプリが自分で休ませていた時だけ、
        「何秒休んでいたか」「起きるまで何msかかったか」を🐛パネルに出します。
        performance.now() は「ページを開いてから何ミリ秒か」を返します。
        */
        const sleptAtMs = deckAudioSleptAtMs;
        const wakeStartMs = performance.now();

        deckAudioSleptAtMs = null;
        deckAudioWakePending = true;

        deckAudioCtx.resume().then(function(){

            deckAudioWakePending = false;

            if(sleptAtMs !== null){

                console.log(
                    "音の出口を起こしました : 休んでいた " +
                    ((wakeStartMs - sleptAtMs) / 1000).toFixed(1) + "秒" +
                    " / 起きるまで " + Math.round(performance.now() - wakeStartMs) + "ms"
                );

            }

        }).catch(function(error){

            deckAudioWakePending = false;

            console.error("音量回路を起こせませんでした :",error.name,error.message);

        });

    }

}


// ==========================================================
// 3-3. 竹弘が止めた時は、音の出口を休ませる(v238)
// ==========================================================
/* ------------------------------------------------------------
   【何が起きていたか(竹弘の報告、2026-10-17)】

       「イヤホンタッチで一時停止した後、1回目のタッチでは一時停止
         解除にならない。必ずもう一度タッチで解除になる。ネイティブ
         アプリでは、そんなことはない」(イヤホンは Victor HA-A6T)

   v237 のログ(js/media-session.js の logMediaSessionAction)と実機の
   テストで、仕組みが分かりました。

       ① ノリRunは一時停止しても、音の出口(上の deckAudioCtx)を開けた
          まま、聞こえない無音を流し続けていた
       ② Bluetooth の音の流れが止まらないので、イヤホンは「まだ鳴って
          いる」と思い、1回目のタッチを ⏸ として送る
       ③ Android 版の Chrome は、止まっている時に届いた ⏸ をページへ渡す
          前に捨てる(Chromium の MediaNotificationController の onPause)
       ④ 2回目のタッチで、やっと ▶ が送られる

   その証拠に、⏸ の後1分待つと1回で再開できました。Chrome は30〜40秒
   無音が続くと、自分で出口を休ませるためです(同期モードの確認A で
   分かったこと)。ネイティブアプリは止めると出口を閉じるので、
   イヤホンにも「止まった」と伝わります。

   ------------------------------------------------------------
   【直し方:竹弘が止めたら、こちらから出口を休ませる】

       止めた(イヤホン・通知・ロック画面の ⏸ / ■)
         → 0.5秒後に出口を休ませる(AudioContext の suspend)
       鳴らし直す(▶ / ■ / 曲のタップ …)
         → 鳴らす前に起こす(上の resumeDeckAudio)

   ⚠️ 代わりに、再開の鳴り出しが毎回 約0.3秒遅れます(出口を起こす時の
      引っかかり)。今までも1分以上止めた後はそうなっていました。曲は
      止めた所から続くだけで、拍はずれません。

   ⚠️ close() は使いません(上の resumeDeckAudio のコメント。v157 の
      「ブッ」というノイズ)。suspend は「一時停止」で、閉じはしません。

   ------------------------------------------------------------
   【なぜ0.5秒待ってから休ませるのか】

   ノリノリアシストは、止めた知らせ('pause')を受けてから、予約済みの
   カチッを取り消します(js/metronome.js)。この知らせは少し遅れて届く
   ので、止めた瞬間に出口を休ませると、取り消す前のカチッが出口の中に
   残り、**再開した瞬間に鳴ってしまう**おそれがあります。カチッは長くても
   0.3秒なので、0.5秒待てば片付いています。

   ------------------------------------------------------------
   【休ませない時】

       ・待っている0.5秒の間に、また鳴り始めた(2枚のデッキのどちらか)
       ・同期モードの画面を開いていて、出口を休ませない信号が流れている
         (js/sync.js の v232。②③のピッ・カチッと、スタートの精度のため)

   ------------------------------------------------------------
   【鳴らし直す入口で起こし忘れても、音は出るようにしてある】

   曲を鳴らす入口はいくつもあります(▶・■・曲のタップ・マイピッチ設定や
   のり注入を閉じた時の続き …)。1つでも起こし忘れると、**曲が進んでいる
   のに音が出ない**という、走行中にいちばん困る失敗になります。

   そこで下の「保険」が、曲が鳴り始めた知らせ('play')のたびに出口を
   確かめ、休んでいたら起こします。主な入口(▶・■・曲のタップ)では
   鳴らす前に起こしているので、保険が働くのは起こし忘れた時だけです
   (その時は🐛パネルに知らせを出すので、入口を直せます)。
   ------------------------------------------------------------ */

// 止めてから出口を休ませるまでの待ち(秒)。理由は上の【なぜ0.5秒…】
const DECK_AUDIO_SLEEP_DELAY_SEC = 0.5;

// 休ませる予約(setTimeout の番号)。null = 予約なし
let deckAudioSleepTimerId = null;

/*
このファイルが自分で出口を休ませた時刻(performance.now のミリ秒)。
null = 休ませていない。使い道は2つです。

    ・画面に触れた時に起こさない判断(下の resumeDeckAudioOnTouch)… 本番の処理
    ・起こした時に「何秒休んでいたか」を🐛パネルに出す … 【開発用調査ログ】(v238)

⚠️ ログを消す時も、この変数は消さないこと(触っただけで出口が起きて、
   イヤホンの1回目のタッチがまた効かなくなる)。
*/
let deckAudioSleptAtMs = null;

// 出口を起こしている途中か(resume() の答えを待っている間 true。上の resumeDeckAudio)
let deckAudioWakePending = false;

/**
 * 竹弘が曲を止めた後に呼びます。少し待ってから、音の出口を休ませます(v238)。
 *
 *     呼ぶ所 … イヤホン・通知・ロック画面の ⏸(js/media-session.js)
 *              ■ボタン(js/upper-area.js)
 *
 * ⚠️ 呼ぶ側は、audioPlayer.pause() の**後で**呼ぶこと(止めてから休ませる)。
 */
function sleepDeckAudioSoon(){

    if(!deckAudioCtx){ return; }

    // 前の予約が残っていたら置き換えます(2回押された時など)
    cancelDeckAudioSleep();

    deckAudioSleepTimerId = setTimeout(function(){

        deckAudioSleepTimerId = null;

        // 待っている間に、どちらかのデッキがまた鳴り始めていたら休ませません
        if(!deckAudioA.paused || !deckAudioB.paused){ return; }

        // 同期モードが出口を起こしておきたい間は、休ませません
        if(isDeckAudioWantedAwake()){ return; }

        // すでに休んでいる(ブラウザが休ませた)なら、何もしません
        if(deckAudioCtx.state !== "running"){ return; }

        deckAudioCtx.suspend().then(function(){

            /*
            ⚠️ suspend は少し時間がかかります。休ませている途中で、竹弘が
               もう鳴らし直していたら、すぐ起こし直します。

            play() を呼ぶと paused はその場で false になるので、ここで
            確かめれば間に合います。起こし直さないと、**曲は進むのに音が
            出ない**ことになります。
            */
            if(!deckAudioA.paused || !deckAudioB.paused){

                console.warn("音の出口を休ませている間に鳴り始めたので、すぐ起こし直します");

                resumeDeckAudio();

                return;

            }

            deckAudioSleptAtMs = performance.now();

            // 【開発用調査ログ】(v238)
            console.log("音の出口を休ませました(竹弘が止めたため。イヤホンの1回目のタッチで再開できるように)");

        }).catch(function(error){

            console.error("音の出口を休ませられませんでした :",error.name,error.message);

        });

    },DECK_AUDIO_SLEEP_DELAY_SEC * 1000);

}

/**
 * 「出口を休ませる」予約を取り消します(v238)。予約が無ければ何もしません。
 */
function cancelDeckAudioSleep(){

    if(deckAudioSleepTimerId === null){ return; }

    clearTimeout(deckAudioSleepTimerId);

    deckAudioSleepTimerId = null;

}

/**
 * ほかの係が「出口を起こしておきたい」と言っているかを返します(v238)。
 *
 * いまは同期モードだけです。画面を開いている間、js/sync.js が聞こえない
 * 小さな信号(syncKeepAwakeNode)を流して出口を休ませないようにしています
 * (v232)。その間に休ませると、その工夫が台無しになります。
 *
 * ⚠️ typeof で確かめるのは、js/sync.js が無い時(将来消した時など)にも
 *    エラーにならないようにするためです。typeof は、まだ無い名前でも
 *    エラーにならず "undefined" を返します。
 *
 * @return {boolean} true = 休ませない
 */
function isDeckAudioWantedAwake(){

    return (typeof syncKeepAwakeNode !== "undefined") && syncKeepAwakeNode !== null;

}

/*
【保険】曲が鳴り始めた時に、出口が休んでいたら起こします(v238)。

上の【鳴らし直す入口で起こし忘れても…】の仕組みです。主な入口では鳴らす
前に起こしているので、ここが働くのは起こし忘れた入口があった時だけです。
その時は🐛パネルに知らせを出します(どの入口かを探す手がかり)。

⚠️ deckAudioA / deckAudioB / audioPlayer は js/config.js で作られていて、
   このファイルより先に読み込まれるので、ここで耳を付けて大丈夫です。
*/
bindDeckEvent("play",function(){

    // 休ませる予約が残っていたら取り消します(鳴り始めたので)
    cancelDeckAudioSleep();

    // ⚠️ 入口で起こしている途中(deckAudioWakePending)なら、起こし忘れではありません
    if(deckAudioCtx && deckAudioCtx.state === "suspended" && !deckAudioWakePending){

        console.warn("曲が鳴り始めたのに音の出口が休んでいたので、起こしました(起こし忘れの入口があります)");

        resumeDeckAudio();

    }

});

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

    /*
    ⚠️ <audio> 側は必ず1に固定します(v175)。

    音量を持つのは GainNode ただ1つ、と決めておかないと、
    「<audio>.volume × GainNode」の掛け算のどちらかに0が残って
    無音になる事故が起きます(v174で実際に起きました。詳しくは
    ensureDeckAudioGraph のコメント)。
    */
    deck.volume = 1;

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

    // <audio> 側は必ず1に固定(理由は setDeckVolume のコメント)
    deck.volume = 1;

    const now = deckAudioCtx.currentTime;

    gain.gain.cancelScheduledValues(now);

    /*
    setValueCurveAtTime は「この道すじを、この時間で辿って」という
    予約です。曲線の形を自由に決められるので、クロスフェードの谷も
    そのまま表現できます。
    */
    gain.gain.setValueCurveAtTime(curve,now,durationSec);

}

// ==========================================================
// 3-4. 全体の音量つまみ(v239)
// ==========================================================
/*
曲(2枚のデッキ)とノリノリアシストの音を、まとめて上げ下げするつまみです。
いまの使い道は、同期モードの「音だけ消す」(js/sync.js の 5-5)だけです。

    消す … つまみを 0 に(曲もアシストも裏で進み続ける)
    戻す … つまみを 1 に(戻した瞬間から、みんなと拍が揃ったまま聞こえる)

【なぜ <audio> の消音(muted)を使わないのか】

鳴っている曲の消音を戻すと、曲の位置が約60ms先へ跳びました(同期モードの
確認C、2026-10-12)。みんなと拍を揃えている最中に跳ぶと、その人だけずれます。
音量つまみなら、曲の進み方には一切触りません。

⚠️ クロスフェードの音量の動きは、各デッキの音量つまみ(setDeckVolume /
   rampDeckVolume)のままです。全体のつまみはその後ろで掛け算されるだけ
   なので、繋いでいる途中に消しても戻しても、フェードの形は崩れません。
⚠️ v240 で 🔈ボタンもこのつまみに乗せ替える予定です。その時は「🔈 と
   音だけ消す」の両方を見て値を決める形にすること(片方が戻した時に、
   もう片方で消しているのに鳴り出さないように)。
*/

// 消す・戻す時に、音量を変えきるまでの時間(秒)。一瞬で変えると「プツッ」と鳴るため
const DECK_MASTER_FADE_SEC = 0.03;

/**
 * 全体の音量つまみがあるかを返します(v239)。
 *
 * 音の回路を作れなかった古いブラウザでは無いので、その時「音だけ消す」は
 * 使えません(呼ぶ側は今までどおり本当に止めます)。
 *
 * @return {boolean}
 */
function hasDeckMaster(){

    return deckMasterGain !== null;

}

/**
 * 曲やアシストの音を、どこへつなげばよいかを返します(v239)。
 *
 * 全体の音量つまみがあればそこ、無ければスピーカー(destination)です。
 * js/metronome.js のアシストの音量つまみが使います。
 *
 * @return {AudioNode|null}
 */
function getDeckOutput(){

    if(deckMasterGain){ return deckMasterGain; }

    return deckAudioCtx ? deckAudioCtx.destination : null;

}

/**
 * 全体の音量を変えます(v239)。DECK_MASTER_FADE_SEC 秒かけて変えます。
 *
 * @param {number} volume - 0(消す)〜1(いつもの大きさ)
 */
function setDeckMasterVolume(volume){

    if(!deckMasterGain || !deckAudioCtx){ return; }

    const gainParam = deckMasterGain.gain;
    const now = deckAudioCtx.currentTime;

    /*
    予約してある変化を取り消し、今の値から始めて、まっすぐ目当ての値へ
    近づけます(linearRampToValueAtTime)。途中で何度押されても、その時の
    値から滑らかに向きを変えます。
    */
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(gainParam.value,now);
    gainParam.linearRampToValueAtTime(volume,now + DECK_MASTER_FADE_SEC);

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

【v238】このアプリが自分で休ませた出口は、触っただけでは起こしません
(下の resumeDeckAudioOnTouch)。理由は2つあります。

    ① ■ で止めると、同じタップの click がここにも届きます(■ の処理の
       後で、画面全体へ伝わってくる)。起こすと、■ が入れたばかりの
       「休ませる予約」まで取り消してしまいます
    ② イヤホンで止めた後に画面へ触れただけで出口が開くと、イヤホンが
       また「鳴っている」と思い、1回目のタッチが効かなくなります

その代わり、曲を鳴らす入口(▶・■・曲のタップ …)と、曲が鳴り始めた時の
保険(上の 3-3)が必ず起こします。ブラウザやOSが休ませた時は、今までどおり
触ったら起こします。
*/
[ "click","touchstart" ].forEach(function(eventName){

    document.addEventListener(eventName,resumeDeckAudioOnTouch,{passive:true});

});

/**
 * 画面に触れた時に、音の出口を起こします(v238 で上の受け口から分けた)。
 *
 * このアプリが自分で休ませている時(休ませる予約を入れた後も含む)は
 * 何もしません。理由は上のコメントの①②です。
 */
function resumeDeckAudioOnTouch(){

    if(deckAudioSleepTimerId !== null || deckAudioSleptAtMs !== null){ return; }

    resumeDeckAudio();

}


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

    ⚠️ v176から、無条件に true にはしません。

    音量0で助走中のデッキだけは false(音程維持を切る)にします。
    聞こえない音のためにWSOLAという重い計算を回し続けると、その負荷が
    「音程のヨレ」になって**聞こえている方の曲**に出るためです。
    詳しい理由は、このファイルの deckSilentPreRoll のコメントにあります。

    ここで名簿を見る形にしているのが要です。この関数は走行中に
    テンポを変えるたびに呼ばれるので、**呼ばれるたびに名簿から
    答えを出し直せば、設定が勝手に元へ戻ることがありません。**
    */
    const preserve = !deckSilentPreRoll.has(deck);

    deck.preservesPitch = preserve;
    deck.webkitPreservesPitch = preserve;
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
 * 消音(ミュート)を、2枚のデッキ両方に当てます(v193)。
 *
 * ------------------------------------------------------------
 * 【なぜ「両方」でないといけないのか】
 *
 * 🔈ボタンは今まで `audioPlayer.muted` だけを切り替えていました。
 * `audioPlayer` は「いま鳴っている方」を指す変数なので、
 * **押した瞬間は正しく消えます。**
 *
 * ところが🕺ノリノリRun再生では、曲が繋がるたびにデッキが交代します。
 * 交代した先のデッキは消音されていないので、
 *
 *     消音にする → 曲が繋がる → **次の曲から音が戻ってしまう**
 *
 * という状態でした(v193で気づいた、v167からの穴)。走行中に消音した
 * つもりが、1曲後に急に鳴り出すことになります。
 *
 * 最初から2枚とも消音しておけば、どちらが主役になっても消えたままです。
 * これは bindDeckEvent()(耳を最初から両方に付ける)とまったく同じ考え方で、
 * **交代のたびに付け替えると、付け替え漏れが必ず起きる**ためです。
 *
 * ⚠️ `muted` は audio要素そのものが持つ性質で、曲(src)を差し替えても
 *    そのまま残ります。だから「今 載せておく」必要はありません。
 *
 * @param {boolean} muted - true=消音する / false=消音をやめる
 */
function setBothDecksMuted(muted){

    [deckAudioA,deckAudioB].forEach(function(deck){

        deck.muted = muted;

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
    「音量0で助走中」の旗も下ろします(v176)。

    片付けたデッキは、次に主役として使われます。旗が立ったままだと
    音程維持が切れた状態(preservesPitch=false)で鳴り始め、**次の曲の
    声が甲高くなったり低くなったりします。** 片付けの時に必ず下ろす
    ことで、どのデッキもいつでも正しい状態で待てるようにします。

    setDeckSilentPreRoll() は名簿と <audio> の両方を戻すので、
    これ1つで元の状態に復帰します。
    */
    setDeckSilentPreRoll(idle,false);

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
