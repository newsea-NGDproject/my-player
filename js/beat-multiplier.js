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
                                   ⚠️ 鳴り方はまだ何も変えていない(決め方を 🐛 で先に確かめる)
       段2  ×1・×2・×4 を実際に効かせる(再生の速さ・拍の長さ・アシスト・接続・同期モード)。
            上半分の「ノリRunBPM ×2」
       段3  ×½・×¼ を効かせる(繋ぐ拍を偶数に・0拍目の位置・カチッの側)

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


// ==========================================================
// 2. 今の状態
// ==========================================================

/*
いま選ばれている設定。初めは OFF(竹弘 2026-11-15「初めの設定は OFF」)。
起動時に loadBeatMultiplierSetting() が、保存してある値に置き換えます。
*/
let beatMultiplierMode = BEAT_MULTIPLIER_MODE_OFF;


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
// 4. 設定の切り替え・保存・読み込み
// ==========================================================

/**
 * 設定を切り替えて、保存します。
 *
 * 設定画面(js/settings.js の 👣 拍倍率)のボタンから呼ばれます。
 *
 * ⚠️ 段1(v275)では、切り替えても鳴り方は変わりません(🐛 に出すだけ)。
 *    段2 から、切り替えは「次の曲から」効くようにします(倍率は曲の頭で決めて曲の間は変えないため)。
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

    console.log("拍倍率 :",describeBeatMultiplierMode(beatMultiplierMode));

    // 【開発用調査ログ】(v275)切り替えた時の、今の曲の答えを 🐛 に出します(下の 5. の節)
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
// 5. 【開発用調査ログ】(v275)曲ごとの答えを 🐛 に出す
// ==========================================================
/*
段1 の目的:鳴り方を変える前に、決め方が竹弘の曲で正しいかを 🐛 で確かめる。

🕺ノリノリRun で曲が鳴り始めたら、1曲につき1行だけ出します。いまの設定の答えを先に、
残り2つの設定ならどうなるかを [ ] の中に出すので、OFF・①・② をその場で見比べられます。

    👣 拍倍率(② 行進へ揃える)「曲名」: 元ピッチ 76 / マイピッチ 170 → ×2・1.12倍
       [OFF なら 2.00倍で止まり 152 / ① なら ×2・1.12倍]

⚠️ 本番リリース前に消してよいのは、この 5. の節と、setBeatMultiplierMode の中の
   logBeatMultiplierOnModeChange() の呼び出し1行だけ(CLAUDE.md の「本番リリース前に削除するもの」)。
   上の 3. の decideBeatMultiplier ほかは本番の処理なので消さない。
*/

/*
最後に 🐛 へ出した曲。同じ曲で何度も出さないための印です。
🕺ノリノリRun を抜けたら空にして、次に入った時にもう一度出します。
*/
let beatMultiplierLoggedTrackId = null;

/**
 * 1曲ぶんの答えを 🐛 に1行で出します。
 *
 * @param {Object} track - libraryMap の曲のデータ
 * @param {string} note  - 行の頭に添える一言(切り替えた時など。無ければ "")
 */
function logBeatMultiplierForTrack(track,note){

    const baseBpm = getEffectiveBaseBpm(track);

    // 今はプログラムが無いので、幅0(同じ値を2つ)で渡します(decideBeatMultiplier の説明)
    const pitch = noriRunMyPitch;

    const answers = {};

    [BEAT_MULTIPLIER_MODE_OFF,BEAT_MULTIPLIER_MODE_NEAR,BEAT_MULTIPLIER_MODE_MARCH].forEach(function(mode){

        answers[mode] = decideBeatMultiplier(baseBpm,pitch,pitch,mode);

    });

    // いまの設定以外の2つを、[ ] の中に並べます
    const others = [BEAT_MULTIPLIER_MODE_OFF,BEAT_MULTIPLIER_MODE_NEAR,BEAT_MULTIPLIER_MODE_MARCH]
        .filter(function(mode){ return mode !== beatMultiplierMode; })
        .map(function(mode){
            return getBeatMultiplierShortName(mode) + " なら " + describeBeatMultiplierAnswer(answers[mode]);
        });

    const title = (track.title || "(曲名なし)").slice(0,24);

    console.log(
        "👣 拍倍率(" + getBeatMultiplierLogName(beatMultiplierMode) + ")" + note +
        "「" + title + "」: 元ピッチ " + formatBeatMultiplierBpm(baseBpm) +
        " / マイピッチ " + formatBeatMultiplierBpm(pitch) +
        " → " + describeBeatMultiplierAnswer(answers[beatMultiplierMode]) +
        " [" + others.join(" / ") + "]"
    );

}

/**
 * 設定を切り替えた時に、今の曲の答えを出し直します(🕺ノリノリRun で曲が載っている時だけ)。
 */
function logBeatMultiplierOnModeChange(){

    if(!isNoriRunMode){ return; }

    const track = getDeckTrack(audioPlayer);

    if(!track){ return; }

    logBeatMultiplierForTrack(track,"【切り替えた時の今の曲】");

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
曲が鳴り始めたら出します。

timeupdate は、鳴っている曲の位置が進むたびに(1秒に4回くらい)届く知らせです。
bindDeckEvent(js/deck.js)は主役のデッキの知らせだけを渡すので、
「主役のデッキに今載っている曲」が前に出した曲と違えば、新しい曲が鳴り始めたと分かります。

【なぜ play や playing ではないのか】
繋いで交代する時、次の曲は裏で助走している間に鳴り始めています(その時はまだ主役ではないので、
知らせは関所で聞き流される)。交代した後は、もう鳴っているので play は届きません。
timeupdate なら交代の後も届き続けるので、繋いだ曲も取りこぼしません。
止まっている間は届かないので、無駄に動くこともありません。

⚠️ 読み込んだその場で bindDeckEvent を呼ぶので、js/deck.js より後に読み込むこと。
   isNoriRunMode(js/norirun.js)・noriRunMyPitch・getEffectiveBaseBpm は、関数の中から
   使うだけなので、読み込みの順番は関係ありません(曲が鳴る頃には全部読み終わっている)。
*/
bindDeckEvent("timeupdate",function(){

    if(!isNoriRunMode){

        beatMultiplierLoggedTrackId = null;
        return;

    }

    const track = getDeckTrack(audioPlayer);

    if(!track || track.track_id === beatMultiplierLoggedTrackId){ return; }

    beatMultiplierLoggedTrackId = track.track_id;

    logBeatMultiplierForTrack(track,"");

});
