// Monnaie officielle de chaque pays, indexée par code pays (voir countries.js).
// Quand un pays utilise la monnaie d'un autre (dollar américain en Équateur, franc suisse au
// Liechtenstein), c'est celle-là qui compte : c'est justement ce qui surprend et s'apprend.

export const CURRENCIES = {
  // ─── Europe ───
  '008': 'lek', '020': 'euro', '040': 'euro', '112': 'rouble biélorusse', '056': 'euro', '070': 'mark convertible', '100': 'euro',
  '191': 'euro', '196': 'euro', '203': 'couronne tchèque', '208': 'couronne danoise', '233': 'euro', '246': 'euro', '250': 'euro', '276': 'euro',
  '300': 'euro', '348': 'forint', '352': 'couronne islandaise', '372': 'euro', '380': 'euro', '428': 'euro', '438': 'franc suisse', '440': 'euro',
  '442': 'euro', '470': 'euro', '498': 'leu moldave', '492': 'euro', '499': 'euro', '528': 'euro', '807': 'denar', '578': 'couronne norvégienne',
  '616': 'złoty', '620': 'euro', '642': 'leu roumain', '643': 'rouble russe', '674': 'euro', '688': 'dinar serbe', '703': 'euro', '705': 'euro',
  '724': 'euro', '752': 'couronne suédoise', '756': 'franc suisse', '804': 'hryvnia', '826': 'livre sterling', '336': 'euro', kosovo: 'euro',

  // ─── Afrique ───
  '012': 'dinar algérien', '024': 'kwanza', '204': 'franc CFA', '072': 'pula', '854': 'franc CFA', '108': 'franc burundais', '132': 'escudo cap-verdien',
  '120': 'franc CFA', '140': 'franc CFA', '148': 'franc CFA', '174': 'franc comorien', '178': 'franc CFA', '180': 'franc congolais', '384': 'franc CFA',
  '262': 'franc de Djibouti', '818': 'livre égyptienne', '226': 'franc CFA', '232': 'nakfa', '748': 'lilangeni', '231': 'birr', '266': 'franc CFA',
  '270': 'dalasi', '288': 'cedi', '324': 'franc guinéen', '624': 'franc CFA', '404': 'shilling kényan', '426': 'loti', '430': 'dollar libérien',
  '434': 'dinar libyen', '450': 'ariary', '454': 'kwacha malawien', '466': 'franc CFA', '478': 'ouguiya', '480': 'roupie mauricienne',
  '504': 'dirham marocain', '508': 'metical', '516': 'dollar namibien', '562': 'franc CFA', '566': 'naira', '646': 'franc rwandais', '678': 'dobra',
  '686': 'franc CFA', '690': 'roupie seychelloise', '694': 'leone', '706': 'shilling somalien', '710': 'rand', '728': 'livre sud-soudanaise',
  '729': 'livre soudanaise', '834': 'shilling tanzanien', '768': 'franc CFA', '788': 'dinar tunisien', '800': 'shilling ougandais', '894': 'kwacha zambien',
  '716': 'ZiG (dollar or zimbabwéen)',

  // ─── Asie ───
  '004': 'afghani', '051': 'dram', '031': 'manat azerbaïdjanais', '048': 'dinar bahreïni', '050': 'taka', '064': 'ngultrum', '096': 'dollar de Brunei',
  '116': 'riel', '156': 'yuan', '268': 'lari', '356': 'roupie indienne', '360': 'roupie indonésienne', '364': 'rial iranien', '368': 'dinar irakien',
  '376': 'shekel', '392': 'yen', '400': 'dinar jordanien', '398': 'tenge', '414': 'dinar koweïtien', '417': 'som', '418': 'kip', '422': 'livre libanaise',
  '458': 'ringgit', '462': 'rufiyaa', '496': 'tugrik', '104': 'kyat', '524': 'roupie népalaise', '408': 'won nord-coréen', '512': 'rial omanais',
  '586': 'roupie pakistanaise', '275': 'shekel', '608': 'peso philippin', '634': 'riyal qatari', '682': 'riyal saoudien', '702': 'dollar de Singapour',
  '410': 'won sud-coréen', '144': 'roupie srilankaise', '760': 'livre syrienne', '158': 'dollar taïwanais', '762': 'somoni', '764': 'baht',
  '626': 'dollar américain', '792': 'livre turque', '795': 'manat turkmène', '784': 'dirham des Émirats', '860': 'sum', '704': 'dong', '887': 'rial yéménite',

  // ─── Amérique du Nord ───
  '028': 'dollar des Caraïbes orientales', '044': 'dollar bahaméen', '052': 'dollar barbadien', '084': 'dollar bélizien', '124': 'dollar canadien',
  '188': 'colón costaricien', '192': 'peso cubain', '212': 'dollar des Caraïbes orientales', '214': 'peso dominicain', '222': 'dollar américain',
  '308': 'dollar des Caraïbes orientales', '320': 'quetzal', '332': 'gourde', '340': 'lempira', '388': 'dollar jamaïcain', '484': 'peso mexicain',
  '558': 'córdoba', '591': 'balboa', '659': 'dollar des Caraïbes orientales', '662': 'dollar des Caraïbes orientales', '670': 'dollar des Caraïbes orientales',
  '780': 'dollar de Trinité-et-Tobago', '840': 'dollar américain',

  // ─── Amérique du Sud ───
  '032': 'peso argentin', '068': 'boliviano', '076': 'réal', '152': 'peso chilien', '170': 'peso colombien', '218': 'dollar américain',
  '328': 'dollar guyanien', '600': 'guarani', '604': 'sol', '740': 'dollar surinamais', '858': 'peso uruguayen', '862': 'bolívar',

  // ─── Océanie ───
  '036': 'dollar australien', '242': 'dollar fidjien', '296': 'dollar australien', '584': 'dollar américain', '583': 'dollar américain',
  '520': 'dollar australien', '554': 'dollar néo-zélandais', '585': 'dollar américain', '598': 'kina', '882': 'tala', '090': 'dollar des Salomon',
  '776': "pa'anga", '548': 'vatu',
};
