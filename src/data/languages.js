// Langues officielles (ou nationales de fait) par pays, indexées par code pays (voir countries.js).
// Ordre : la plus parlée d'abord. Sources : constitutions et usages officiels ; volontairement
// limité aux langues principales (l'Afrique du Sud en a 12, on en garde 4).

export const LANGUAGES = {
  // ─── Europe ───
  '008': ['albanais'], '020': ['catalan'], '040': ['allemand'], '112': ['biélorusse', 'russe'], '056': ['néerlandais', 'français', 'allemand'],
  '070': ['bosnien', 'croate', 'serbe'], '100': ['bulgare'], '191': ['croate'], '196': ['grec', 'turc'], '203': ['tchèque'], '208': ['danois'],
  '233': ['estonien'], '246': ['finnois', 'suédois'], '250': ['français'], '276': ['allemand'], '300': ['grec'], '348': ['hongrois'],
  '352': ['islandais'], '372': ['anglais', 'irlandais'], '380': ['italien'], '428': ['letton'], '438': ['allemand'], '440': ['lituanien'],
  '442': ['luxembourgeois', 'français', 'allemand'], '470': ['maltais', 'anglais'], '498': ['roumain'], '492': ['français'], '499': ['monténégrin'],
  '528': ['néerlandais'], '807': ['macédonien', 'albanais'], '578': ['norvégien'], '616': ['polonais'], '620': ['portugais'], '642': ['roumain'],
  '643': ['russe'], '674': ['italien'], '688': ['serbe'], '703': ['slovaque'], '705': ['slovène'], '724': ['espagnol'], '752': ['suédois'],
  '756': ['allemand', 'français', 'italien', 'romanche'], '804': ['ukrainien'], '826': ['anglais'], '336': ['italien', 'latin'], kosovo: ['albanais', 'serbe'],

  // ─── Afrique ───
  '012': ['arabe', 'tamazight'], '024': ['portugais'], '204': ['français'], '072': ['anglais', 'tswana'], '854': ['français'],
  '108': ['kirundi', 'français', 'anglais'], '132': ['portugais'], '120': ['français', 'anglais'], '140': ['sango', 'français'], '148': ['arabe', 'français'],
  '174': ['comorien', 'arabe', 'français'], '178': ['français'], '180': ['français'], '384': ['français'], '262': ['arabe', 'français'], '818': ['arabe'],
  '226': ['espagnol', 'français', 'portugais'], '232': ['tigrigna', 'arabe', 'anglais'], '748': ['swati', 'anglais'], '231': ['amharique'], '266': ['français'],
  '270': ['anglais'], '288': ['anglais'], '324': ['français'], '624': ['portugais'], '404': ['swahili', 'anglais'], '426': ['sotho', 'anglais'], '430': ['anglais'],
  '434': ['arabe'], '450': ['malgache', 'français'], '454': ['anglais', 'chichewa'], '466': ['bambara', 'français'], '478': ['arabe'], '480': ['anglais', 'français'],
  '504': ['arabe', 'tamazight'], '508': ['portugais'], '516': ['anglais'], '562': ['français'], '566': ['anglais'], '646': ['kinyarwanda', 'français', 'anglais', 'swahili'],
  '678': ['portugais'], '686': ['français'], '690': ['créole seychellois', 'français', 'anglais'], '694': ['anglais'], '706': ['somali', 'arabe'],
  '710': ['zoulou', 'xhosa', 'afrikaans', 'anglais'], '728': ['anglais'], '729': ['arabe', 'anglais'], '834': ['swahili', 'anglais'], '768': ['français'],
  '788': ['arabe'], '800': ['anglais', 'swahili'], '894': ['anglais'], '716': ['anglais', 'shona', 'ndébélé'],

  // ─── Asie ───
  '004': ['pachto', 'dari'], '051': ['arménien'], '031': ['azéri'], '048': ['arabe'], '050': ['bengali'], '064': ['dzongkha'], '096': ['malais'],
  '116': ['khmer'], '156': ['chinois (mandarin)'], '268': ['géorgien'], '356': ['hindi', 'anglais'], '360': ['indonésien'], '364': ['persan'],
  '368': ['arabe', 'kurde'], '376': ['hébreu'], '392': ['japonais'], '400': ['arabe'], '398': ['kazakh', 'russe'], '414': ['arabe'], '417': ['kirghize', 'russe'],
  '418': ['lao'], '422': ['arabe'], '458': ['malais'], '462': ['divehi'], '496': ['mongol'], '104': ['birman'], '524': ['népalais'], '408': ['coréen'],
  '512': ['arabe'], '586': ['ourdou', 'anglais'], '275': ['arabe'], '608': ['filipino', 'anglais'], '634': ['arabe'], '682': ['arabe'],
  '702': ['anglais', 'malais', 'chinois (mandarin)', 'tamoul'], '410': ['coréen'], '144': ['cingalais', 'tamoul'], '760': ['arabe'], '158': ['chinois (mandarin)'],
  '762': ['tadjik'], '764': ['thaï'], '626': ['tétoum', 'portugais'], '792': ['turc'], '795': ['turkmène'], '784': ['arabe'], '860': ['ouzbek'],
  '704': ['vietnamien'], '887': ['arabe'],

  // ─── Amérique du Nord ───
  '028': ['anglais'], '044': ['anglais'], '052': ['anglais'], '084': ['anglais'], '124': ['anglais', 'français'], '188': ['espagnol'], '192': ['espagnol'],
  '212': ['anglais'], '214': ['espagnol'], '222': ['espagnol'], '308': ['anglais'], '320': ['espagnol'], '332': ['créole haïtien', 'français'], '340': ['espagnol'],
  '388': ['anglais'], '484': ['espagnol'], '558': ['espagnol'], '591': ['espagnol'], '659': ['anglais'], '662': ['anglais'], '670': ['anglais'], '780': ['anglais'],
  '840': ['anglais'],

  // ─── Amérique du Sud ───
  '032': ['espagnol'], '068': ['espagnol', 'quechua', 'aymara'], '076': ['portugais'], '152': ['espagnol'], '170': ['espagnol'], '218': ['espagnol'],
  '328': ['anglais'], '600': ['espagnol', 'guarani'], '604': ['espagnol', 'quechua', 'aymara'], '740': ['néerlandais'], '858': ['espagnol'], '862': ['espagnol'],

  // ─── Océanie ───
  '036': ['anglais'], '242': ['anglais', 'fidjien', 'hindi des Fidji'], '296': ['gilbertin', 'anglais'], '584': ['marshallais', 'anglais'], '583': ['anglais'],
  '520': ['nauruan', 'anglais'], '554': ['anglais', 'maori'], '585': ['palauan', 'anglais'], '598': ['tok pisin', 'anglais', 'hiri motu'], '882': ['samoan', 'anglais'],
  '090': ['anglais'], '776': ['tongien', 'anglais'], '548': ['bichelamar', 'français', 'anglais'],
};

// « le swahili », « l’arabe » : toutes les langues sont masculines en français.
export function withArticle(language) {
  return /^[aeiouyéèêh]/i.test(language) ? `l’${language}` : `le ${language}`;
}

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
