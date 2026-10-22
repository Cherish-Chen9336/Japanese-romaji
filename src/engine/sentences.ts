import type { PracticeText, TextItem } from './types'

/**
 * Connected Japanese, a sentence at a time.
 *
 * The other banks are words. Words are what a typing trainer needs to cover
 * the syllabary, but they are not what Japanese looks like: nothing in them
 * teaches that は is said わ when it marks the topic, or that a sentence ends
 * in です rather than stopping. These do.
 *
 * Three rules hold every entry together, and the invariants in
 * `prompt.test.ts` enforce all three:
 *
 * - **Spaces mark display words, so the three strings line up.** The kana, the
 *   reading and the romaji split into the same number of pieces, and the Nth
 *   piece of each is the same word. That is what puts furigana over the right
 *   characters.
 * - **A space never falls inside a typing unit.** 行って is one word, never
 *   `いっ て` — that spells itself `ixtsu te` and records two moras where
 *   there is one.
 * - **A particle is its own word.** は read わ has to stand alone, or the ruby
 *   would print わ above は instead of leaving it as written.
 *
 * `reading` is what you type, not what a dictionary prints: topic は is written
 * わ and direction へ is written え, following `こんにちは` in `wordBank`. を
 * keeps its own spelling, because it is typed `wo`.
 *
 * Every reading here was written by hand and then checked against kuromoji's
 * IPADIC readings; all 35 agreed. The one that did not was 十分 in "駅まで歩
 * いて十分かかります", which the dictionary read じゅうぶん ("enough") rather
 * than じゅっぷん ("ten minutes"). The sentence now says 十五分, because a
 * learner meeting a word with two readings learns nothing from being handed
 * one of them without being told.
 *
 * Each sentence is also a `PracticeText` with an id of its own, so it can be
 * chosen from the library and practised on its own rather than only shuffled
 * into a passage. The ids are slugs of the romaji rather than positions: a
 * stored run that names `kyou` still names the same sentence after the list is
 * reordered, which `sentence-1` would not.
 *
 * The first three texts are **short passages** — four sentences that belong
 * together, with a title. They exist because a request for "articles" is a
 * request for something to read, and a list of unrelated one-liners is not
 * that however many of them there are. They are deliberately short: long
 * documents need a position to return to, a way to deal consecutive chunks and
 * a run that spans them, none of which exists yet.
 *
 * Their sentences are in `sentenceBank` like any other, so random practice
 * still draws on them. Order is only honoured when a passage is chosen, since
 * `dealPassage` shuffles everything it is given.
 */
export const sentenceTexts: PracticeText[] = [
  {
    id: 'asa-no-sanpo',
    title: 'A morning walk',
    source: 'sentences',
    items: [
      { kana: '毎朝 六時 に 起きます', reading: 'まいあさ ろくじ に おきます', romaji: 'maiasa rokuji ni okimasu' },
      { kana: '犬 と 近く の 公園 を 歩きます', reading: 'いぬ と ちかく の こうえん を あるきます', romaji: 'inu to chikaku no kouen wo arukimasu' },
      { kana: '空気 が 冷たくて 気持ち が いい です', reading: 'くうき が つめたくて きもち が いい です', romaji: 'kuuki ga tsumetakute kimochi ga ii desu' },
      { kana: '家 に 帰って から 朝ごはん を 作ります', reading: 'いえ に かえって から あさごはん を つくります', romaji: 'ie ni kaette kara asagohan wo tsukurimasu' },
    ],
  },
  {
    id: 'hajimete-no-kyouto',
    title: 'First time in Kyoto',
    source: 'sentences',
    items: [
      { kana: '先月 はじめて 京都 へ 行きました', reading: 'せんげつ はじめて きょうと え いきました', romaji: 'sengetsu hajimete kyouto e ikimashita' },
      { kana: '古い お寺 が たくさん あって 驚きました', reading: 'ふるい おてら が たくさん あって おどろきました', romaji: 'furui otera ga takusan atte odorokimashita' },
      { kana: '店 で 抹茶 の アイス を 食べました', reading: 'みせ で まっちゃ の アイス を たべました', romaji: 'mise de matcha no aisu wo tabemashita' },
      { kana: 'また 秋 に 行きたい です', reading: 'また あき に いきたい です', romaji: 'mata aki ni ikitai desu' },
    ],
  },
  {
    id: 'ame-no-nichiyoubi',
    title: 'A rainy Sunday',
    source: 'sentences',
    items: [
      { kana: '日曜日 は 朝 から 雨 でした', reading: 'にちようび わ あさ から あめ でした', romaji: 'nichiyoubi wa asa kara ame deshita' },
      { kana: 'どこ に も 行かないで 家 に いました', reading: 'どこ に も いかないで いえ に いました', romaji: 'doko ni mo ikanaide ie ni imashita' },
      { kana: '音楽 を 聞きながら 本 を 読みました', reading: 'おんがく を ききながら ほん を よみました', romaji: 'ongaku wo kikinagara hon wo yomimashita' },
      { kana: 'とても 静かな 日 でした', reading: 'とても しずかな ひ でした', romaji: 'totemo shizukana hi deshita' },
    ],
  },
  {
    id: 'kyou',
    source: 'sentences',
    items: [{ kana: '今日 は とても いい 天気 です', reading: 'きょう わ とても いい てんき です', romaji: 'kyou wa totemo ii tenki desu' }],
  },
  {
    id: 'maiasa',
    source: 'sentences',
    items: [{ kana: '毎朝 コーヒー を 飲みます', reading: 'まいあさ コーヒー を のみます', romaji: 'maiasa koohii wo nomimasu' }],
  },
  {
    id: 'eki',
    source: 'sentences',
    items: [{ kana: '駅 まで 歩いて 十五分 かかります', reading: 'えき まで あるいて じゅうごふん かかります', romaji: 'eki made aruite juugofun kakarimasu' }],
  },
  {
    id: 'imouto',
    source: 'sentences',
    items: [{ kana: '妹 は 犬 が 大好き です', reading: 'いもうと わ いぬ が だいすき です', romaji: 'imouto wa inu ga daisuki desu' }],
  },
  {
    id: 'shuumatsu',
    source: 'sentences',
    items: [{ kana: '週末 に 友達 と 映画 を 見ました', reading: 'しゅうまつ に ともだち と えいが を みました', romaji: 'shuumatsu ni tomodachi to eiga wo mimashita' }],
  },
  {
    id: 'kono',
    source: 'sentences',
    items: [{ kana: 'この 店 の パン は おいしい です', reading: 'この みせ の パン わ おいしい です', romaji: 'kono mise no pan wa oishii desu' }],
  },
  {
    id: 'densha',
    source: 'sentences',
    items: [{ kana: '電車 が 少し 遅れて います', reading: 'でんしゃ が すこし おくれて います', romaji: 'densha ga sukoshi okurete imasu' }],
  },
  {
    id: 'natsuyasumi',
    source: 'sentences',
    items: [{ kana: '夏休み に 海 へ 行きたい です', reading: 'なつやすみ に うみ え いきたい です', romaji: 'natsuyasumi ni umi e ikitai desu' }],
  },
  {
    id: 'haha',
    source: 'sentences',
    items: [{ kana: '母 は 料理 が 上手 です', reading: 'はは わ りょうり が じょうず です', romaji: 'haha wa ryouri ga jouzu desu' }],
  },
  {
    id: 'atarashii',
    source: 'sentences',
    items: [{ kana: '新しい 仕事 に 慣れて きました', reading: 'あたらしい しごと に なれて きました', romaji: 'atarashii shigoto ni narete kimashita' }],
  },
  {
    id: 'kinou',
    source: 'sentences',
    items: [{ kana: '昨日 は 雨 が 降って いました', reading: 'きのう わ あめ が ふって いました', romaji: 'kinou wa ame ga futte imashita' }],
  },
  {
    id: 'kouen',
    source: 'sentences',
    items: [{ kana: '公園 で 子供 たち が 遊んで います', reading: 'こうえん で こども たち が あそんで います', romaji: 'kouen de kodomo tachi ga asonde imasu' }],
  },
  {
    id: 'asagohan',
    source: 'sentences',
    items: [{ kana: '朝ごはん に 卵 を 食べました', reading: 'あさごはん に たまご を たべました', romaji: 'asagohan ni tamago wo tabemashita' }],
  },
  {
    id: 'nihongo',
    source: 'sentences',
    items: [{ kana: '日本語 の 勉強 を 続けて います', reading: 'にほんご の べんきょう を つづけて います', romaji: 'nihongo no benkyou wo tsuzukete imasu' }],
  },
  {
    id: 'kippu',
    source: 'sentences',
    items: [{ kana: '切符 を 買って から 電車 に 乗ります', reading: 'きっぷ を かって から でんしゃ に のります', romaji: 'kippu wo katte kara densha ni norimasu' }],
  },
  {
    id: 'heya',
    source: 'sentences',
    items: [{ kana: '部屋 の 窓 を 開けて ください', reading: 'へや の まど を あけて ください', romaji: 'heya no mado wo akete kudasai' }],
  },
  {
    id: 'raishuu',
    source: 'sentences',
    items: [{ kana: '来週 の 金曜日 に 会いましょう', reading: 'らいしゅう の きんようび に あいましょう', romaji: 'raishuu no kinyoubi ni aimashou' }],
  },
  {
    id: 'shashin',
    source: 'sentences',
    items: [{ kana: '写真 を 撮って も いい です か', reading: 'しゃしん を とって も いい です か', romaji: 'shashin wo totte mo ii desu ka' }],
  },
  {
    id: 'nimotsu',
    source: 'sentences',
    items: [{ kana: '荷物 が 重い ので 手伝って ください', reading: 'にもつ が おもい ので てつだって ください', romaji: 'nimotsu ga omoi node tetsudatte kudasai' }],
  },
  {
    id: 'atatakai',
    source: 'sentences',
    items: [{ kana: '温かい お茶 を 一杯 ください', reading: 'あたたかい おちゃ を いっぱい ください', romaji: 'atatakai ocha wo ippai kudasai' }],
  },
  {
    id: 'chichi',
    source: 'sentences',
    items: [{ kana: '父 は 毎日 新聞 を 読みます', reading: 'ちち わ まいにち しんぶん を よみます', romaji: 'chichi wa mainichi shinbun wo yomimasu' }],
  },
  {
    id: 'kyoushitsu',
    source: 'sentences',
    items: [{ kana: '教室 に は 誰 も いません でした', reading: 'きょうしつ に わ だれ も いません でした', romaji: 'kyoushitsu ni wa dare mo imasen deshita' }],
  },
  {
    id: 'chikaku',
    source: 'sentences',
    items: [{ kana: '近く に 安い 八百屋 が あります', reading: 'ちかく に やすい やおや が あります', romaji: 'chikaku ni yasui yaoya ga arimasu' }],
  },
  {
    id: 'ryokou',
    source: 'sentences',
    items: [{ kana: '旅行 の 計画 を 立てて います', reading: 'りょこう の けいかく を たてて います', romaji: 'ryokou no keikaku wo tatete imasu' }],
  },
  {
    id: 'samui',
    source: 'sentences',
    items: [{ kana: '寒い ので 窓 を 閉めました', reading: 'さむい ので まど を しめました', romaji: 'samui node mado wo shimemashita' }],
  },
  {
    id: 'toshokan',
    source: 'sentences',
    items: [{ kana: '図書館 で 本 を 三冊 借りました', reading: 'としょかん で ほん を さんさつ かりました', romaji: 'toshokan de hon wo sansatsu karimashita' }],
  },
  {
    id: 'kanojo',
    source: 'sentences',
    items: [{ kana: '彼女 は 歌 が とても 上手 です', reading: 'かのじょ わ うた が とても じょうず です', romaji: 'kanojo wa uta ga totemo jouzu desu' }],
  },
  {
    id: 'isoide',
    source: 'sentences',
    items: [{ kana: '急いで 準備 を して ください', reading: 'いそいで じゅんび を して ください', romaji: 'isoide junbi wo shite kudasai' }],
  },
  {
    id: 'gyuunyuu',
    source: 'sentences',
    items: [{ kana: '牛乳 と 果物 を 買って きました', reading: 'ぎゅうにゅう と くだもの を かって きました', romaji: 'gyuunyuu to kudamono wo katte kimashita' }],
  },
  {
    id: 'konban',
    source: 'sentences',
    items: [{ kana: '今晩 は 家 で ゆっくり 休みます', reading: 'こんばん わ いえ で ゆっくり やすみます', romaji: 'konban wa ie de yukkuri yasumimasu' }],
  },
  {
    id: 'maiasa-inu',
    source: 'sentences',
    items: [{ kana: '毎朝 犬 と 散歩 に 行きます', reading: 'まいあさ いぬ と さんぽ に いきます', romaji: 'maiasa inu to sanpo ni ikimasu' }],
  },
  {
    id: 'enpitsu',
    source: 'sentences',
    items: [{ kana: '鉛筆 で 名前 を 書いて ください', reading: 'えんぴつ で なまえ を かいて ください', romaji: 'enpitsu de namae wo kaite kudasai' }],
  },
  {
    id: 'tenpura',
    source: 'sentences',
    items: [{ kana: '天ぷら と お寿司 を 注文 しました', reading: 'てんぷら と おすし を ちゅうもん しました', romaji: 'tenpura to osushi wo chuumon shimashita' }],
  },
  {
    id: 'yakusoku',
    source: 'sentences',
    items: [{ kana: '約束 の 時間 に 間に合いました', reading: 'やくそく の じかん に まにあいました', romaji: 'yakusoku no jikan ni maniaimashita' }],
  },
  {
    id: 'yuubinkyoku',
    source: 'sentences',
    items: [{ kana: '郵便局 は 銀行 の 隣 に あります', reading: 'ゆうびんきょく わ ぎんこう の となり に あります', romaji: 'yuubinkyoku wa ginkou no tonari ni arimasu' }],
  },
]

/** The same sentences as a flat pool, for a run that deals at random. */
export const sentenceBank: TextItem[] = sentenceTexts.flatMap((text) => text.items)
