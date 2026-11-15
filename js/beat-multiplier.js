/* ============================================================
   拍倍率(⑬)… 1拍に何歩で走るか

   竹弘の言葉(2026-11-14):
       「これを実装しないと、選曲によっては、ランナーがノリRunできない」
       「ノリノリRun再生は、ユーザーのマイピッチの範囲、基本どの曲でも
         100～250BPM再生できなくてはならない」

   ------------------------------------------------------------
   【何が困っていたか】

   ノリノリRun は、曲の速さを「マイピッチ ÷ 元ピッチ」で決めています。
   ただし速さには 0.5〜2.0倍の安全装置があります(js/pitch.js の RATE_MIN / RATE_MAX。
   これ以上は音が崩れるため)。

       元ピッチ 76 の曲を、マイピッチ 170 で鳴らすには 2.24倍が要る
       → 2.0倍で止まるので、152 までしか上がらない(繋いだ時に走るテンポが変わる)

   【拍倍率とは】

   曲を速めるかわりに、足を着く拍を変えます。遅い曲は「1拍に2歩」(×2)、
   速い曲は「2拍に1歩」(×½)。曲の拍に足が乗っていることは変わらないので、
   ノリは崩れません。倍率は2倍刻み(×¼・×½・×1・×2・×4)。

       元ピッチ 76 ×2 = 152(拍倍率をかけた曲の拍)× 1.12倍 = 170(走るテンポ)

   【設定は3つ】(⚙️ →「👣 拍倍率」。2026-11-14 竹弘と決めた)

       OFF                       今までどおり(速さだけで合わせる)。比べる時の見比べ役。初めはこれ
       ① なるべく1倍の近く        再生の速さが 0.8〜1.6倍に入る倍率を選ぶ
       ② いったん行進の範囲へ揃える 曲の拍を行進の上限 135 以下(68〜135)へ揃えてから速める。
                                   2.0倍を超える時・0.8倍を下回る時だけ倍率を変える(安全装置)。
                                   マラソン以上(136〜)では、いつも 1.0〜2.0倍 = 原曲より遅くしない(疾走感。竹弘の案)

   OFF を残すのは、竹弘が「実装前との比較をしたい」ため。うまくいったら、
   OFF を残すか消すかを竹弘が決めます。

   ------------------------------------------------------------
   【作る順番】(1段 = 1版。竹弘の GO の後に次の段)

       段1(v275・このファイルを新設)⚙️ の画面・設定の保存・倍率を決める関数・🐛 のログ。
                                   鳴り方は変えなかった(決め方を 🐛 で先に確かめた。実機 OK)
       段2(v276)×1・×2・×4 を実際に効かせる(再生の速さ・拍の長さ・アシスト・接続・同期モード)。
                  上半分の「ノリRunBPM ×2」(実機 OK)
       段3(v277)×½・×¼ も効かせる(0拍目の位置・接続点を偶数の拍に・ずらす拍・カチッの側)

   【倍率が入った所】(どれもこのファイルの関数を通す。式を書き写さない)

       再生の速さ       js/connect.js の getTrackRate・js/deck.js の applyPitchToDeck・
                        js/pitch.js(🕺 の時の定規・表示)・js/norirun.js の applyNoriRunPitch
                        → getPlaybackBaseBpm / getDeckBeatMultiplier
       走る1拍の長さ     js/metronome.js(カチッの間隔)・js/sync.js(頭から鳴らす時の無音・直後の拍)
                        → getRunnerBeatSongSec
       曲の拍と足の拍が  js/connect.js の getBeat0AtSec(0拍目)・getConnectAtSec(接続点)・
       両方そろう間隔    getConnectAnchorSec(助走が足りない時にずらす拍)
       (段3・v277)      → getTrackBeatStride / getBeatStrideBackBeats
                        ×1・×2・×4 では曲の拍がいつも走る拍の上に乗るので、この3つは段2 までと同じ値。
                        ×½・×¼ は曲の拍の2つ・4つに1つしか走る拍に乗らないので、0拍目を「走る拍1つ前」に、
                        接続点を「1拍目から偶数(×¼ は4の倍数)の拍」にそろえる。カチッ・同期モード・🎬 は
                        0拍目と接続点をこの関数から取るので、自動で1拍目と同じ側にそろう

   ⚠️ 決めるのは1か所(decideBeatMultiplier)。ジャケの getTrackCover と同じ考え方で、
      倍率を使う所(段2・段3)は全部この関数を通すこと。各所が同じ式を書くと、
      1か所直し忘れた時にそこだけずれる。
   ⚠️ メインメニューの再生(交代しない1デッキ)は触らない(STEP7 の見比べ役)。
      ノリ注入(js/tap.js)も触らない(測るのは曲の本当の拍のまま。倍率は鳴らす時だけかける)。

   経緯と作戦会議の資料 → private/beat-multiplier-meeting.html(非公開)
   ============================================================ */


// ==========================================================
// 1. 決まった数値
// ==========================================================

/*
設定の値。DB の settings ストアに "beat_multiplier_mode" という名前で、この文字のまま保存します
(docs/db-schema.md)。⚠️ 保存されるので、文字を変えると前の設定が読めなくなります。
*/
const BEAT_MULTIPLIER_MODE_OFF   = "off";
const BEAT_MULTIPLIER_MODE_NEAR  = "near";
const BEAT_MULTIPLIER_MODE_MARCH = "march";

/*
① なるべく1倍の近く の「速さの幅」。0.8〜1.6倍(竹弘が選んだ 2026-11-14)。

⚠️ 上の端は、必ず下の端のちょうど2倍にすること。
   倍率は2倍刻みなので、幅が「ちょうど2倍」あれば、どの曲・どのマイピッチでも
   必ず1つだけ倍率が見つかります(2倍より狭いと、どの倍率も入らない曲が出る)。
*/
const BEAT_MULTIPLIER_NEAR_RATE_MIN = 0.8;
const BEAT_MULTIPLIER_NEAR_RATE_MAX = 1.6;

/*
② いったん行進の範囲へ揃える の数値。

    行進の上限 … 135(js/config.js の PACE_STEPS の「行進」の maxBpm と同じ値)
    遅くする下限 … 0.8倍(これより遅く鳴らすなら、倍率を1つ下げる)

② の「速さの幅」は、マイピッチで動きます(下の getBeatMultiplierBand):

    幅の下の端 = マイピッチ ÷ 135 を、0.8〜1.0 の間に収めた値
    幅の上の端 = 下の端の2倍

    マイピッチ 100 → 0.80〜1.60倍(ウォーキングでは ① と同じ)
    マイピッチ 130 → 0.96〜1.93倍(行進の間に、幅が上へずれていく)
    マイピッチ 136〜 → 1.00〜2.00倍(マラソンから上は、原曲より遅くしない)

⚠️ 幅の上の端が 2.0倍 = 安全装置の上の端と同じなので、② で鳴らしている曲は、
   走りながら定規でマイピッチを上げる余地が少ない(元ピッチ 90 の曲をマイピッチ 170 で
   鳴らすと 1.89倍。180 まで上げると 2.0倍で止まる)。倍率は曲の頭で決めて曲の間は
   変えないので、その曲の間は安全装置で止まり、次の曲で選び直します。
*/
const BEAT_MULTIPLIER_MARCH_MAX_BPM   = 135;
const BEAT_MULTIPLIER_MARCH_RATE_FLOOR = 0.8;
const BEAT_MULTIPLIER_MARCH_RATE_TOP   = 1.0;

/*
選べる倍率と、比べる順番。

×4・×¼ も使う(竹弘 2026-11-15。① で元ピッチ 59 の曲をマイピッチ 200 で鳴らすと ×4 になる)。

並び順は「同じくらい良い時に、どちらを選ぶか」の順番です(下の isBetterBeatMultiplier)。
×1(原曲の拍のまま)をいちばん先にし、2倍刻みで外へ向かいます。
今(幅が0の時)は、帯に入る倍率がいつも1つだけなので、この順番は効きません。
*/
const BEAT_MULTIPLIER_CHOICES = [1,2,0.5,4,0.25];

/*
「その曲が鳴る間のマイピッチの幅」を、何か所で確かめるか。

幅が0の時(今はいつも)は1か所だけ。幅がある時(将来のマイピッチのプログラム)は、
低い方から高い方までを等しく分けて確かめます。33か所なら、10分で 130 → 170 の坂の
中の4分の曲(16の幅)を、0.5 ずつ確かめることになります。足し算と割り算だけなので軽い処理です。
*/
const BEAT_MULTIPLIER_SAMPLES = 33;

/*
小数の計算の誤差よけ。

コンピュータの小数は、136 ÷ 85 が 1.6 ぴったりにならず 1.6000000000000001 になる、という
小さな誤差が出ます。境目(1.6倍ちょうど など)で答えがぶれないように、このぶんだけ余裕を持たせます。
*/
const BEAT_MULTIPLIER_EPSILON = 1e-9;

/*
(段2・v276 には「×½・×¼ を使うか」のスイッチ BEAT_MULTIPLIER_USE_SLOWER = false があり、
 ×½・×¼ が選ばれても ×1 で鳴らしていた。段3・v277 で、繋ぐ拍をそろえる直し
 〔下の getTrackBeatStride・getBeatStrideBackBeats〕と一緒に外した)
*/


// ==========================================================
// 2. 今の状態
// ==========================================================

/*
いま選ばれている設定。初めは OFF(竹弘 2026-11-15「初めの設定は OFF」)。
起動時に loadBeatMultiplierSetting() が、保存してある値に置き換えます。
*/
let beatMultiplierMode = BEAT_MULTIPLIER_MODE_OFF;

/*
デッキごとに「この曲はこの倍率で鳴らす」と決めた答えの控え(段2・v276)。

    デッキ → { trackId, baseBpm, session, answer, multiplier }

倍率は曲の頭で決めて、曲の間は変えません(竹弘 2026-11-15)。走りながら定規を動かすと
マイピッチが変わりますが、毎回決め直すと、倍率の境目をまたいだ瞬間に曲の速さが半分や
2倍へ跳んでしまいます。だから一度決めたら、その曲がデッキに載っている間はこの控えを使います。

【いつ決めるか】
曲をデッキに載せた後、最初に「この曲の倍率は?」と聞かれた時(getDeckBeatMultiplier)。
載せる入口は js/deck.js の setDeckSource の1か所で、そこで控えを捨てます(forgetDeckBeatMultiplier)。

    竹弘が曲をタップ          → 載せた直後に速さを当てる時に決まる
    次の曲へ繋ぐ(助走)       → 助走を始める時に決まる(= 作戦会議の「曲の頭」)

【決め直す時】控えは次の時に使わなくなり、次に聞かれた時に決め直します。
    ・別の曲を載せた(上の setDeckSource)
    ・🕺 に入り直した・同期モードをスタートした(startBeatMultiplierSession。マイピッチが変わるため)
    ・その曲の元ピッチが変わった(ノリ注入をやり直した)

⚠️ 設定(OFF / ① / ②)を切り替えても、今の曲の控えはそのまま。次の曲から効きます。

session は「🕺 に入った回の番号」です。入り直すたびに1つ増やし、古い回の控えを使わないようにします。
*/
const deckBeatMultiplierMemos = new Map();
let beatMultiplierSession = 0;


// ==========================================================
// 3. 倍率を決める(⚠️ 決めるのはここ1か所)
// ==========================================================

/**
 * その曲を、いくつの倍率・何倍の速さで鳴らすかを決めます。
 *
 * ⚠️⚠️ 【なぜマイピッチを1つではなく「幅」で受け取るのか】(竹弘と決めた 2026-11-15)
 *
 *    **将来の「マイピッチのプログラム」のためです。** 竹弘の構想:走る時間に合わせて
 *    マイピッチを折れ線グラフでプログラムし(最初の30分は 130、慣れたら 170、ラストスパートは 200 …)、
 *    点と点の間は滑らかに変える。すると、1曲が鳴っている間にもマイピッチが少しずつ動きます。
 *
 *    倍率は曲の頭で決めて、曲の間は変えません(曲の途中で倍率を変えると、曲の速さが
 *    その瞬間に半分や2倍へ跳ぶため。竹弘 2026-11-15 OK)。そのため、
 *    **曲の頭のマイピッチだけで決めると、曲の途中で安全装置に当たる**ことがあります:
 *
 *        元ピッチ 76 の曲が鳴る間に、マイピッチが 138 → 154 へ上がる(② の場合)
 *          頭の 138 だけで決める   → ×1:1.82倍 → 2.03倍(終わりの方で 2.0倍に当たり、走るテンポが合わない)
 *          幅 138〜154 で決める    → ×2:0.91倍 → 1.01倍(最後まで合う)
 *
 *    → だから最初から「その曲が鳴る間の、いちばん低い〜いちばん高いマイピッチ」を受け取る形にした。
 *    **今(プログラムが無い間)は、同じ値を2つ渡します。** その時の答えは、作戦会議で決めた
 *    ① ② の決め方とまったく同じになります(幅が0なので、帯に入る倍率がちょうど1つ見つかる)。
 *
 *    竹弘の希望「なんの為に準備したか忘れないように、後でわかるようにしといてね」で、ここに書いた。
 *    → CLAUDE.md「未実装の約束事」の「マイピッチのプログラム」・private/beat-multiplier-meeting.html の9章
 *
 * 【決め方】
 *
 *    1. 選べる倍率(×1・×2・×½・×4・×¼)それぞれで、幅の低い方・高い方の速さを計算する
 *    2. 幅の間ずっと安全装置(0.5〜2.0倍)の内側にいられる倍率だけを候補にする
 *    3. 候補のうち、選び方の帯(① 0.8〜1.6倍 / ② 行進へ揃える)にいちばん長く入るものを選ぶ
 *    4. 候補が1つも無い時(1曲の間にマイピッチが2倍以上変わる時だけ起きる)は、
 *       安全装置からのはみ出しがいちばん小さい倍率にする。その部分は今と同じく安全装置で止まる
 *       (将来のプログラムでは、グラフの坂に上限を付けて、こうならないようにする)
 *
 *    安全装置の幅は4倍(0.5〜2.0)、倍率は2倍刻み。だから幅が2倍以内なら、2. の候補は必ず見つかる。
 *
 * ⚠️ この関数は「計算するだけ」です。画面・DB・デッキには何も触りません
 *    (同じ値を渡せば、いつも同じ答え)。段1(v275)では 🐛 のログからだけ呼んでいます。
 *
 * @param  {number} baseBpm   - その曲の元ピッチ(js/pitch.js の getEffectiveBaseBpm)
 * @param  {number} pitchLow  - その曲が鳴る間の、いちばん低いマイピッチ(今は noriRunMyPitch)
 * @param  {number} pitchHigh - その曲が鳴る間の、いちばん高いマイピッチ(今は pitchLow と同じ値)
 * @param  {string} mode      - BEAT_MULTIPLIER_MODE_OFF / _NEAR / _MARCH
 * @return {{mode:string, multiplier:number, baseBpm:number, pitchLow:number, pitchHigh:number,
 *           rateLow:number, rateHigh:number, clamped:boolean}}
 *           multiplier … 倍率(2 なら「1拍に2歩」、0.5 なら「2拍に1歩」)
 *           rateLow / rateHigh … 幅の低い方・高い方での再生の速さ(安全装置の内側に収めた値)
 *           clamped … 安全装置で止まる所がある(= その間は、走るテンポが合わない)
 */
function decideBeatMultiplier(baseBpm,pitchLow,pitchHigh,mode){

    /*
    入口の守り。元ピッチが分からない曲は、js/pitch.js の getEffectiveBaseBpm と同じく
    BPM_FALLBACK(120)として扱います。0 で割ると答えが無限大になって壊れるためです。
    */
    if(!(baseBpm > 0)){ baseBpm = BPM_FALLBACK; }

    // 高い方だけ渡し忘れた時は、幅0として扱います
    if(!(pitchHigh > 0)){ pitchHigh = pitchLow; }

    // 低い方と高い方が逆に渡された時は、入れ替えます
    if(pitchHigh < pitchLow){

        const swap = pitchLow;
        pitchLow = pitchHigh;
        pitchHigh = swap;

    }

    /*
    OFF(今までどおり)。倍率は使わず、速さだけで合わせます。
    js/connect.js の getTrackRate と同じ計算(マイピッチ ÷ 元ピッチ を安全装置で止める)です。
    */
    if(mode !== BEAT_MULTIPLIER_MODE_NEAR && mode !== BEAT_MULTIPLIER_MODE_MARCH){

        return makeBeatMultiplierResult(
            BEAT_MULTIPLIER_MODE_OFF,1,baseBpm,pitchLow,pitchHigh
        );

    }

    // 幅の中の、確かめるマイピッチを並べます(幅が0なら1つだけ)
    const pitches = listBeatMultiplierPitches(pitchLow,pitchHigh);

    let best = null;

    BEAT_MULTIPLIER_CHOICES.forEach(function(multiplier){

        /*
        「拍倍率をかけた曲の拍」= 元ピッチ × 倍率。
        元ピッチ 76 を ×2 で走るなら、足から見た曲の拍は 152 です。
        再生の速さは「マイピッチ ÷ この値」になります。
        */
        const songBeatBpm = baseBpm * multiplier;

        const rateLow  = pitchLow  / songBeatBpm;
        const rateHigh = pitchHigh / songBeatBpm;

        // 幅の間ずっと、安全装置(0.5〜2.0倍)の内側にいられるか
        const isSafe =
            rateLow  >= RATE_MIN - BEAT_MULTIPLIER_EPSILON &&
            rateHigh <= RATE_MAX + BEAT_MULTIPLIER_EPSILON;

        // 選び方の帯に、幅のどれだけが入るか(0〜1。幅が0なら 0 か 1)
        let inBandCount = 0;

        pitches.forEach(function(pitch){

            const band = getBeatMultiplierBand(pitch,mode);

            if(isBeatMultiplierRateInBand(pitch / songBeatBpm,band)){
                inBandCount++;
            }

        });

        /*
        安全装置からどれだけはみ出すか(候補が1つも無い時の選び方に使う)。

        Math.log2 は「2 の何乗か」を返す命令です。2.08倍なら log2(2.08 ÷ 2.0) = 0.06 のように、
        はみ出しを「倍率の段の何段ぶんか」で比べます。速すぎる側と遅すぎる側を同じ物差しで比べられます。
        */
        const overflow =
            Math.max(0,Math.log2(rateHigh / RATE_MAX)) +
            Math.max(0,Math.log2(RATE_MIN / rateLow));

        const candidate = {
            multiplier: multiplier,
            isSafe: isSafe,
            inBandShare: inBandCount / pitches.length,
            overflow: overflow
        };

        if(isBetterBeatMultiplier(candidate,best)){
            best = candidate;
        }

    });

    return makeBeatMultiplierResult(mode,best.multiplier,baseBpm,pitchLow,pitchHigh);

}

/**
 * 2つの候補のうち、a の方が良いかを返します(decideBeatMultiplier の 2.〜4.)。
 *
 * 同じくらい良い時は false(= 先に見た方を残す)。BEAT_MULTIPLIER_CHOICES の並び順が
 * そのまま「同じなら、どちらを選ぶか」の順番になります。
 */
function isBetterBeatMultiplier(a,b){

    if(!b){ return true; }

    // 安全装置の内側に収まる方を、何よりも先に選びます
    if(a.isSafe !== b.isSafe){ return a.isSafe; }

    // どちらも収まらない時は、はみ出しが小さい方
    if(!a.isSafe){ return a.overflow < b.overflow - BEAT_MULTIPLIER_EPSILON; }

    // どちらも収まる時は、選び方の帯に長く入る方
    return a.inBandShare > b.inBandShare + BEAT_MULTIPLIER_EPSILON;

}

/**
 * そのマイピッチの時の「選び方の帯」(この速さの間で鳴らしたい、という幅)を返します。
 *
 * ① はいつも 0.8〜1.6倍。② はマイピッチで動きます(上の 1. の BEAT_MULTIPLIER_MARCH_… の説明)。
 *
 * @return {{low:number, high:number}} low 以上・high 未満
 */
function getBeatMultiplierBand(pitch,mode){

    if(mode === BEAT_MULTIPLIER_MODE_MARCH){

        /*
        Math.min / Math.max を重ねるのは「この範囲に収める」書き方です。
        マイピッチ ÷ 135 を、0.8 より小さければ 0.8 に、1.0 より大きければ 1.0 にします。
        */
        const low = Math.min(
            BEAT_MULTIPLIER_MARCH_RATE_TOP,
            Math.max(BEAT_MULTIPLIER_MARCH_RATE_FLOOR,pitch / BEAT_MULTIPLIER_MARCH_MAX_BPM)
        );

        return { low: low, high: low * 2 };

    }

    return { low: BEAT_MULTIPLIER_NEAR_RATE_MIN, high: BEAT_MULTIPLIER_NEAR_RATE_MAX };

}

/**
 * 速さが帯に入っているかを返します。
 *
 * 下の端ちょうどは「入る」、上の端ちょうどは「入らない」(倍率を1つ上げる側)。
 * こうすると境目でも、帯に入る倍率がちょうど1つに決まります(例:1.6倍ちょうどは ×2 の 0.8倍の方)。
 */
function isBeatMultiplierRateInBand(rate,band){

    return rate >= band.low - BEAT_MULTIPLIER_EPSILON &&
           rate <  band.high - BEAT_MULTIPLIER_EPSILON;

}

/**
 * 幅の中で確かめるマイピッチを、低い方から順に並べて返します。
 *
 * 幅が0(低い方 = 高い方)なら1つだけ。今はいつもこちらです。
 */
function listBeatMultiplierPitches(pitchLow,pitchHigh){

    if(pitchHigh - pitchLow < BEAT_MULTIPLIER_EPSILON){ return [pitchLow]; }

    const pitches = [];

    for(let i = 0; i < BEAT_MULTIPLIER_SAMPLES; i++){

        pitches.push(pitchLow + (pitchHigh - pitchLow) * i / (BEAT_MULTIPLIER_SAMPLES - 1));

    }

    return pitches;

}

/**
 * 決めた倍率から、返す答えをまとめます(安全装置で止まるかどうかも、ここで調べます)。
 */
function makeBeatMultiplierResult(mode,multiplier,baseBpm,pitchLow,pitchHigh){

    const songBeatBpm = baseBpm * multiplier;

    const rawLow  = pitchLow  / songBeatBpm;
    const rawHigh = pitchHigh / songBeatBpm;

    return {
        mode: mode,
        multiplier: multiplier,
        baseBpm: baseBpm,
        pitchLow: pitchLow,
        pitchHigh: pitchHigh,
        rateLow:  clampBeatMultiplierRate(rawLow),
        rateHigh: clampBeatMultiplierRate(rawHigh),
        clamped:
            rawLow  < RATE_MIN - BEAT_MULTIPLIER_EPSILON ||
            rawHigh > RATE_MAX + BEAT_MULTIPLIER_EPSILON
    };

}

// 速さを安全装置(0.5〜2.0倍)の内側に収めます
function clampBeatMultiplierRate(rate){

    return Math.min(Math.max(rate,RATE_MIN),RATE_MAX);

}

/**
 * 倍率を画面やログに出す形の文字にします(2 → "×2"、0.5 → "×½")。
 */
function formatBeatMultiplier(multiplier){

    if(multiplier === 0.5){ return "×½"; }
    if(multiplier === 0.25){ return "×¼"; }

    return "×" + multiplier;

}


// ==========================================================
// 3-2. 鳴らす時に使う倍率(デッキごとの控え。段2・v276)
// ==========================================================
/*
ほかのファイルが使うのは、この節の6つだけです。式を書き写さず、必ずここを通すこと。

    getDeckBeatMultiplier(deck)  … そのデッキの曲の倍率(js/deck.js の applyPitchToDeck)
    getTrackBeatMultiplier(track) … その曲の倍率(デッキが分からない所から)
    getPlaybackBaseBpm(track)    … 速さの計算に使う「元ピッチ × 倍率」(接続・定規・上半分)
    getRunnerBeatSongSec(track)  … 走る1拍が、曲の中で何秒か(カチッ・同期モード)
    getTrackBeatStride(track)    … (v277)曲の拍と足の拍が両方そろう間隔(曲の拍いくつ。0拍目・ずらす拍)
    getBeatStrideBackBeats(track) … (v277)接続点を曲の拍いくつ手前へ動かすか(×½・×¼ の時だけ)

⚠️ どれも、🕺ノリノリRun の外(メインメニュー)では倍率 1 = 今までと同じ値を返します。
   メインメニューの再生は STEP7 の見比べ役なので、拍倍率を一切効かせません。
*/

/**
 * そのデッキに載っている曲の倍率を返します(無ければ、ここで決めて控えます)。
 *
 * @param  {HTMLAudioElement} deck
 * @return {number} 倍率(0.25・0.5・1・2・4)
 */
function getDeckBeatMultiplier(deck){

    const memo = getDeckBeatMultiplierMemo(deck);

    return memo ? memo.multiplier : 1;

}

/**
 * そのデッキの控えを返します(まだ無い・古い時は、ここで決めて控えます)。
 *
 * 🕺 の外・曲が載っていない時は null(倍率 1 として扱う)。
 */
function getDeckBeatMultiplierMemo(deck){

    if(!isNoriRunMode){ return null; }

    const track = getDeckTrack(deck);

    if(!track){ return null; }

    const baseBpm = getEffectiveBaseBpm(track);

    const memo = deckBeatMultiplierMemos.get(deck);

    // 同じ曲・同じ元ピッチ・同じ回の控えがあれば、それを使います(曲の間は変えない)
    if(memo &&
       memo.trackId === track.track_id &&
       memo.baseBpm === baseBpm &&
       memo.session === beatMultiplierSession){

        return memo;

    }

    return decideDeckBeatMultiplier(deck,track,baseBpm);

}

/**
 * そのデッキの曲の倍率を、今のマイピッチと設定で決めて控えます(= 曲の頭)。
 */
function decideDeckBeatMultiplier(deck,track,baseBpm){

    /*
    1曲ループ接続(同じ曲を、もう1枚のデッキで続けて鳴らす)の時は、鳴っている方の倍率を
    そのまま引き継ぎます。同じ曲の続きなので、途中で定規を動かしていても倍率は変えません
    (変えると、繋いだ瞬間に曲の速さが半分や2倍へ跳ぶ)。
    */
    const otherDeck = (deck === deckAudioA) ? deckAudioB : deckAudioA;
    const otherMemo = deckBeatMultiplierMemos.get(otherDeck);

    if(otherMemo &&
       !otherDeck.paused &&
       otherMemo.trackId === track.track_id &&
       otherMemo.baseBpm === baseBpm &&
       otherMemo.session === beatMultiplierSession){

        const copied = Object.assign({},otherMemo);

        deckBeatMultiplierMemos.set(deck,copied);

        // 【開発用調査ログ】(v276)
        console.log(
            "👣 拍倍率 : 1曲ループなので、鳴っている方の倍率を引き継ぎます(" +
            formatBeatMultiplier(copied.multiplier) + ")"
        );

        return copied;

    }

    // 今はプログラムが無いので、幅0(同じ値を2つ)で渡します(decideBeatMultiplier の説明)
    const answer = decideBeatMultiplier(baseBpm,noriRunMyPitch,noriRunMyPitch,beatMultiplierMode);

    /*
    (v277)×½・×¼ もそのまま使います(段2 では ×1 に置き換えていた)。
    控えの multiplier と answer.multiplier は、今はいつも同じ値です。2つ持っているのは、
    段2 の名残と、将来「決めた答えと、実際に鳴らす倍率」を分けたくなった時のためです。
    */
    const memo = {
        trackId: track.track_id,
        baseBpm: baseBpm,
        session: beatMultiplierSession,
        answer: answer,
        multiplier: answer.multiplier
    };

    deckBeatMultiplierMemos.set(deck,memo);

    // 【開発用調査ログ】(v276)決めた時に1行(下の 5. の節)
    logBeatMultiplierDecision(deck,track,memo);

    return memo;

}

/**
 * その曲の倍率を返します(デッキではなく曲で聞かれる所から。js/connect.js の getTrackRate など)。
 *
 * 【どの控えを使うか】
 *     主役のデッキに載っている曲  → 主役の控え
 *     もう1枚に載っていて、鳴っている曲(助走中・🎬 の待ち・繋いだ後の先行曲)→ その控え
 *     どちらでもない曲(助走を始めるか確かめている次の曲)→ その場で決めた答え(控えない)
 *
 * ⚠️ もう1枚のデッキが止まっている時(前に鳴っていた曲が残っているだけ)は、その控えを使いません。
 *    古いマイピッチで決めた倍率が、次に同じ曲を鳴らす時に混ざらないようにするためです。
 *    その曲を本当に載せた時(setDeckSource)に控えを捨てて、決め直します。
 */
function getTrackBeatMultiplier(track){

    if(!isNoriRunMode || !track){ return 1; }

    /*
    同じ曲かどうかは track_id で比べます(曲のデータの入れ物そのもので比べると、
    ノリ注入をやり直して入れ物が作り直された時に、同じ曲なのに「違う」となるため)。
    */
    if(isSameBeatMultiplierTrack(getDeckTrack(audioPlayer),track)){

        return getDeckBeatMultiplier(audioPlayer);

    }

    const otherDeck = (audioPlayer === deckAudioA) ? deckAudioB : deckAudioA;

    if(isSameBeatMultiplierTrack(getDeckTrack(otherDeck),track) && !otherDeck.paused){

        return getDeckBeatMultiplier(otherDeck);

    }

    // まだどのデッキにも載っていない曲。控えずに、今のマイピッチと設定で答えます
    const baseBpm = getEffectiveBaseBpm(track);

    const answer = decideBeatMultiplier(baseBpm,noriRunMyPitch,noriRunMyPitch,beatMultiplierMode);

    return answer.multiplier;

}

// 2つの曲のデータが同じ曲か(どちらかが無ければ false)
function isSameBeatMultiplierTrack(trackA,trackB){

    return !!trackA && !!trackB && trackA.track_id === trackB.track_id;

}

/**
 * 速さの計算に使う「元ピッチ × 倍率」を返します。
 *
 * 元ピッチ 76 の曲を ×2 で走るなら 152。再生の速さは「マイピッチ ÷ この値」になります
 * (170 ÷ 152 = 1.12倍)。🕺 の外では、元ピッチそのまま(倍率 1)。
 */
function getPlaybackBaseBpm(track){

    return getEffectiveBaseBpm(track) * getTrackBeatMultiplier(track);

}

/**
 * 走る1拍が、曲の中で何秒かを返します(曲の秒。再生の速さで伸び縮みする前)。
 *
 * ×1 なら曲の1拍(60 ÷ 元ピッチ)、×2 なら曲の半拍、×4 なら曲の¼拍。
 * ノリノリアシストのカチッはこの間隔で鳴ります(×2 なら曲の1拍に2回)。
 */
function getRunnerBeatSongSec(track){

    return 60 / getPlaybackBaseBpm(track);

}

/**
 * 「曲の拍」と「足の拍(走る拍)」が両方そろう間隔が、曲の拍いくつぶんかを返します(段3・v277)。
 *
 *     ×1・×2・×4 → 1   曲の拍はいつも走る拍の上に乗る(×2 なら走る拍の2つに1つが曲の拍)
 *     ×½         → 2   走る拍は曲の拍の2つに1つ(2拍に1歩)
 *     ×¼         → 4   走る拍は曲の拍の4つに1つ
 *
 * 【何に使うか】js/connect.js の3つの関数が、これで「曲の拍いくつで動くか」を決めます。
 *
 *     getBeat0AtSec       … 0拍目 = 1拍目(startTS)から、この数だけ曲の拍を戻った所
 *     getConnectAtSec     … 接続点 = 1拍目から、この数の倍数だけ曲の拍を進んだ所(下の getBeatStrideBackBeats)
 *     getConnectAnchorSec … 助走が足りない時に、この数の単位でずらす
 *
 * どれも「1拍目(A地点。竹弘がノリ注入で決めた拍)と同じ側の拍に足を着く」ための決まりです
 * (作戦会議の資料の6章)。ここを 1 にしたまま ×½ で鳴らすと、0拍目と接続点が足の拍の
 * 裏(曲の拍1つぶん = 半歩)に来て、繋いだ瞬間にカチッと足が半拍ずれます(タタン)。
 *
 * ⚠️ ×1・×2・×4 は 1 を返すので、3つの関数は段2 までとまったく同じ値になります。
 *
 * @param  {Object} track
 * @return {number} 1・2・4
 */
function getTrackBeatStride(track){

    const multiplier = getTrackBeatMultiplier(track);

    if(!(multiplier < 1)){ return 1; }

    // ×½ → 2、×¼ → 4。小数の誤差で 1.9999… にならないよう、丸めてから返します
    return Math.round(1 / multiplier);

}

/**
 * 先行曲の接続点(13拍目 = endTS)を、曲の拍いくつ手前へ動かすかを返します(段3・v277)。
 *
 * 【なぜ動かすのか】
 * ×½ は2拍に1歩なので、1拍目(startTS)から接続点(endTS)までの拍の数が**奇数**だと、
 * 接続点が足の拍の裏(半歩ずれた所)に来ます。そこで後続曲の0拍目と重ねると、
 * 繋いだ瞬間に足のリズムが半拍ずれます(タタン)。
 *
 *     1拍目から 149拍(奇数)の曲を ×½ で鳴らす
 *       → 接続点を曲の拍1つ手前(148拍 = 偶数)へ。足の拍の上で繋がる
 *     ×¼ なら4の倍数へ(149拍 → 1つ手前の 148拍、150拍 → 2つ手前の 148拍)
 *
 * 手前へ動かすのは、後ろへ動かすと接続の後の重ね(クロスフェード)の分の曲が足りなくなることが
 * あるためです(資料の6章「その時は接続点を1拍手前にする」)。
 *
 * 【拍の数の数え方】A〜B の長さ ÷ 曲の1拍 を、いちばん近い整数に丸めます。段0(v267〜)で保存した曲は
 * 「曲全体の BPM」なので割り切れます(🐛 の「149.00拍 → 149拍(端数 +0.00・安心)」)。
 * それより前に保存した曲で端数が出ても、丸めた数で偶数・奇数を決めれば、足の拍の側はそろいます。
 *
 * ⚠️ ×1・×2・×4 はいつも 0(接続点は endTS のまま。段2 までと同じ)。
 *
 * @param  {Object} track - 先行曲(manualBPM / startTS / endTS がある曲)
 * @return {number} 手前へ動かす曲の拍の数(0〜3)
 */
function getBeatStrideBackBeats(track){

    const stride = getTrackBeatStride(track);

    if(stride === 1){ return 0; }

    const beatCount = countTrackConnectBeats(track);

    if(!isFinite(beatCount)){ return 0; }

    /*
    「% stride」は割り算の余りです(149 % 2 = 1)。余りの分だけ手前へ動かせば、ちょうど割り切れる数になります。
    ( + stride) % stride は、万一拍の数がマイナスでも余りを 0〜stride−1 に収めるための書き方です。
    */
    return ((beatCount % stride) + stride) % stride;

}

/**
 * 1拍目(startTS)から接続点(endTS)までが、曲の拍いくつかを返します(いちばん近い整数。v277)。
 * 数えられない曲(BPM や位置が無い)は NaN。
 */
function countTrackConnectBeats(track){

    const songBeatSec = 60 / track.manualBPM;

    if(!isFinite(songBeatSec) || songBeatSec <= 0){ return NaN; }

    return Math.round((track.endTS - track.startTS) / songBeatSec);

}

/**
 * 🕺 に入った時・同期モードをスタートした時に呼びます。今までの控えを全部使わなくします。
 *
 * どちらもマイピッチが変わる(入るたびに初期設定の値を読み直す / みんなのピッチにする)ので、
 * 今鳴っている曲の倍率も、新しいマイピッチで決め直します。
 */
function startBeatMultiplierSession(){

    beatMultiplierSession++;

    deckBeatMultiplierMemos.clear();

}

/**
 * そのデッキの控えを捨てます。js/deck.js の setDeckSource(曲を載せる入口)から呼ばれます。
 */
function forgetDeckBeatMultiplier(deck){

    deckBeatMultiplierMemos.delete(deck);

}

/**
 * 上半分の左の表示(「再生ピッチ」⇔「ノリRunBPM」と「×2」)を、主役の曲に合わせて直します。
 *
 * js/pitch.js の applyTempo(速さを変えるたびに通る)から呼ばれます。
 *
 *     🕺 で、今の曲を ① か ② で決めた時   ノリRunBPM 170 ×2(×1 の時は「×2」を出さない)
 *     それ以外(OFF・メインメニュー)        再生ピッチ 170(今までどおり)
 *
 * 数字は、どちらも走るテンポ(= マイピッチ)です(竹弘 2026-11-15「走るテンポで行こう」)。
 * ⚠️ 設定を切り替えても、今の曲は決めた時の設定のまま表示します(次の曲から効くのと同じ)。
 */
function refreshBeatMultiplierDisplay(){

    const labelEl = document.getElementById("pitch-label-text");
    const badgeEl = document.getElementById("pitch-multiplier");

    if(!labelEl || !badgeEl){ return; }

    const memo = getDeckBeatMultiplierMemo(audioPlayer);

    const isNoriRunBpm = !!memo && memo.answer.mode !== BEAT_MULTIPLIER_MODE_OFF;

    labelEl.textContent = isNoriRunBpm ? "ノリRunBPM" : "再生ピッチ";

    badgeEl.textContent = (isNoriRunBpm && memo.multiplier !== 1)
        ? formatBeatMultiplier(memo.multiplier)
        : "";

    /*
    「ノリRunBPM」の間は、「：」と数字の後ろの小さな「BPM」を消します(見出しにもう BPM があり、
    幅 360px の画面では、そのままだと右のマイピッチボタンに重なって見出しが2行に折り返すため。
    くわしい測った値は c014.html の .ua-pitch-now--norirun-bpm の CSS)。

    closest は「自分から親へたどって、最初に条件に合う要素」を返す命令です。
    */
    const nowEl = labelEl.closest(".ua-pitch-now");

    if(nowEl){ nowEl.classList.toggle("ua-pitch-now--norirun-bpm",isNoriRunBpm); }

}


// ==========================================================
// 4. 設定の切り替え・保存・読み込み
// ==========================================================

/**
 * 設定を切り替えて、保存します。
 *
 * 設定画面(js/settings.js の 👣 拍倍率)のボタンから呼ばれます。
 *
 * ⚠️ 切り替えは「次の曲から」効きます(段2・v276〜)。倍率は曲の頭で決めて曲の間は変えないので、
 *    今鳴っている曲は、決めた時の設定のまま鳴り続けます(上の deckBeatMultiplierMemos)。
 *
 * @param {string} mode - BEAT_MULTIPLIER_MODE_OFF / _NEAR / _MARCH
 */
async function setBeatMultiplierMode(mode){

    /*
    知らない値が来たら、安全な方(OFF = 今までどおり)に倒します。
    保存してある値が将来の版と食い違った時に、鳴り方がおかしくならないようにするための関門です
    (ノリノリアシストの音色の setMetronomeSound と同じ守り方)。
    */
    if(!isKnownBeatMultiplierMode(mode)){

        mode = BEAT_MULTIPLIER_MODE_OFF;

    }

    beatMultiplierMode = mode;

    console.log("拍倍率 :",describeBeatMultiplierMode(beatMultiplierMode),"(次の曲から効きます)");

    // 【開発用調査ログ】(v276)今の曲がどの倍率のままかを 🐛 に出します(下の 5. の節)
    logBeatMultiplierOnModeChange();

    try{

        await idbPut(STORE_SETTINGS,beatMultiplierMode,"beat_multiplier_mode");

    }
    catch(error){

        console.error("拍倍率の設定の保存に失敗 :",error.name,error.message);

    }

}

/**
 * 保存してある設定を読み込みます。
 *
 * js/main.js の起動処理から呼ばれます(🎚️ 曲の繋ぎ方・🏃 ノリノリアシストの読み込みの隣)。
 */
async function loadBeatMultiplierSetting(){

    try{

        const saved = await idbGet(STORE_SETTINGS,"beat_multiplier_mode");

        /*
        今のコードが知っている値の時だけ受け入れます。
        まだ一度も設定していない時は undefined が返るので、初期値(OFF)のままにします。
        */
        if(isKnownBeatMultiplierMode(saved)){

            beatMultiplierMode = saved;

        }

    }
    catch(error){

        console.error("拍倍率の設定の読み込みに失敗 :",error.name,error.message);

    }

}

function isKnownBeatMultiplierMode(mode){

    return mode === BEAT_MULTIPLIER_MODE_OFF ||
           mode === BEAT_MULTIPLIER_MODE_NEAR ||
           mode === BEAT_MULTIPLIER_MODE_MARCH;

}

// 設定の呼び名(ログ用)。画面の文字は c014.html の #beat-multiplier-panel にあります
function describeBeatMultiplierMode(mode){

    if(mode === BEAT_MULTIPLIER_MODE_NEAR){ return "① なるべく1倍の近く"; }
    if(mode === BEAT_MULTIPLIER_MODE_MARCH){ return "② いったん行進の範囲へ揃える"; }

    return "OFF(今までどおり)";

}


// ==========================================================
// 5. 【開発用調査ログ】(v275〜)倍率を決めた時に 🐛 へ出す
// ==========================================================
/*
段1(v275)で、決め方が竹弘の曲で正しいことを確かめた(実機 OK)。段2(v276)からは、
**倍率を決めた瞬間**(曲をデッキに載せた後、最初に聞かれた時)に1行出します。
次の曲なら、助走を始める時に出ます。決めた設定の答えを先に、残り2つの設定ならどうなるかを
[ ] の中に出すので、OFF・①・② をその場で見比べられます。

    👣 拍倍率 デッキA(② 行進へ揃える)「曲名」: 元ピッチ 76 / マイピッチ 170 → ×2・1.12倍
       [OFF なら 2.00倍で止まり 152 / ① なら ×2・1.12倍]

⚠️ 本番リリース前に消してよいのは、この 5. の節と、次の3か所の呼び出しだけ
   (CLAUDE.md の「本番リリース前に削除するもの」):
       setBeatMultiplierMode の logBeatMultiplierOnModeChange() の1行
       decideDeckBeatMultiplier の logBeatMultiplierDecision(…) の1行と、1曲ループの console.log
   上の 3.・3-2. の関数は本番の処理なので消さない。
*/

/**
 * 倍率を決めた時に、1行で 🐛 に出します。
 *
 * @param {HTMLAudioElement} deck - 決めたデッキ
 * @param {Object}           track
 * @param {Object}           memo  - decideDeckBeatMultiplier が作った控え
 */
function logBeatMultiplierDecision(deck,track,memo){

    const answer = memo.answer;
    const pitch = answer.pitchLow;

    // 残り2つの設定ならどうなるか(同じ元ピッチ・同じマイピッチで計算し直す)
    const others = [BEAT_MULTIPLIER_MODE_OFF,BEAT_MULTIPLIER_MODE_NEAR,BEAT_MULTIPLIER_MODE_MARCH]
        .filter(function(mode){ return mode !== answer.mode; })
        .map(function(mode){
            const other = decideBeatMultiplier(answer.baseBpm,pitch,pitch,mode);
            return getBeatMultiplierShortName(mode) + " なら " + describeBeatMultiplierAnswer(other);
        });

    let chosen = describeBeatMultiplierAnswer(answer);

    /*
    (v277)×½・×¼ の時は、接続点を動かしたかも書き添えます。
    「1拍目から 149拍 → 1拍手前へ」なら、繋ぐ瞬間が足の拍の上へ動いた印です。
    */
    if(memo.multiplier < 1){

        chosen += "(" + describeBeatStrideConnect(track) + ")";

    }

    const title = (track.title || "(曲名なし)").slice(0,24);

    console.log(
        "👣 拍倍率 デッキ" + ((deck === deckAudioA) ? "A" : "B") +
        "(" + getBeatMultiplierLogName(answer.mode) + ")" +
        "「" + title + "」: 元ピッチ " + formatBeatMultiplierBpm(answer.baseBpm) +
        " / マイピッチ " + formatBeatMultiplierBpm(pitch) +
        " → " + chosen +
        " [" + others.join(" / ") + "]"
    );

}

/**
 * 設定を切り替えた時に、今の曲はどの倍率のまま鳴るかを出します(🕺 で曲が載っている時だけ)。
 */
function logBeatMultiplierOnModeChange(){

    if(!isNoriRunMode){ return; }

    const memo = deckBeatMultiplierMemos.get(audioPlayer);
    const track = getDeckTrack(audioPlayer);

    if(!memo || !track){ return; }

    console.log(
        "👣 拍倍率 : 今の曲「" + (track.title || "(曲名なし)").slice(0,24) + "」は " +
        formatBeatMultiplier(memo.multiplier) + "(" + getBeatMultiplierLogName(memo.answer.mode) +
        " で決めた)のまま。" + getBeatMultiplierLogName(beatMultiplierMode) + " は次の曲から"
    );

}

/**
 * 答えを「×2・1.12倍」の形の文字にします。
 *
 * 安全装置で止まる時は「2.00倍で止まり 152」のように、実際に走るテンポも添えます
 * (元ピッチ × 倍率 × 止まった速さ)。OFF は倍率を使わないので「×1・」を付けません。
 */
function describeBeatMultiplierAnswer(answer){

    const head = (answer.mode === BEAT_MULTIPLIER_MODE_OFF)
        ? ""
        : formatBeatMultiplier(answer.multiplier) + "・";

    let text = head + answer.rateLow.toFixed(2) + "倍";

    if(answer.clamped){

        const runningBpm = answer.baseBpm * answer.multiplier * answer.rateLow;

        text += "で止まり " + formatBeatMultiplierBpm(runningBpm);

    }

    return text;

}

/**
 * ×½・×¼ の曲の接続点を、どう扱ったかの文字にします(v277)。
 *
 *     接続点 : 1拍目から 149拍 → 曲の拍1つ手前(148拍)で繋ぐ
 *     接続点 : 1拍目から 148拍 = 2の倍数なのでそのまま
 */
function describeBeatStrideConnect(track){

    const beatCount = countTrackConnectBeats(track);

    if(!isFinite(beatCount)){ return "接続点 : 拍の数を数えられません"; }

    const stride = getTrackBeatStride(track);
    const backBeats = getBeatStrideBackBeats(track);

    if(backBeats === 0){

        return "接続点 : 1拍目から " + beatCount + "拍 = " + stride + "の倍数なのでそのまま";

    }

    return "接続点 : 1拍目から " + beatCount + "拍 → 曲の拍" + backBeats + "つ手前(" +
           (beatCount - backBeats) + "拍)で繋ぐ";

}

// 行の頭に出す、設定の短い名前
function getBeatMultiplierLogName(mode){

    if(mode === BEAT_MULTIPLIER_MODE_NEAR){ return "① 1倍の近く"; }
    if(mode === BEAT_MULTIPLIER_MODE_MARCH){ return "② 行進へ揃える"; }

    return "OFF";

}

// [ ] の中に出す、設定のいちばん短い名前
function getBeatMultiplierShortName(mode){

    if(mode === BEAT_MULTIPLIER_MODE_NEAR){ return "①"; }
    if(mode === BEAT_MULTIPLIER_MODE_MARCH){ return "②"; }

    return "OFF";

}

/*
BPM を出す形。ノリ注入した元ピッチは 89.97 のような小数のこともあるので、
整数ならそのまま、小数なら小数第1位まで出します。
*/
function formatBeatMultiplierBpm(bpm){

    const rounded = Math.round(bpm * 10) / 10;

    return (rounded === Math.round(rounded)) ? String(Math.round(rounded)) : rounded.toFixed(1);

}

/*
(v275 では、主役のデッキの timeupdate を見張って「曲が変わったら1行」を出していた。
 v276 からは倍率を決めた瞬間に出すので、見張りは外した)

⚠️ このファイルは、読み込んだその場では何も呼びません(関数と値を用意するだけ)。
   ほかのファイルの名前(isNoriRunMode・noriRunMyPitch・getEffectiveBaseBpm・getDeckTrack など)は
   関数の中から使うだけなので、読み込みの順番は関係ありません(曲が鳴る頃には全部読み終わっている)。
*/
