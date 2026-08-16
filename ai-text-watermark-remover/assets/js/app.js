/* ==========================================================================
   AI Text Watermark Remover — application logic
   --------------------------------------------------------------------------
   Pipeline:
     1. Tokenize the text and split it into segments (sentence-ish units).
     2. Score every token against a hash-based "green list", reproducing the
        z-test used in text-watermarking research (Kirchenbauer et al. style).
        Without the generator's private key this is a proxy detector, so the
        output is an estimate of watermark pressure, not a vendor verdict.
     3. Rank segments, then pick 3-5 of the strongest as the load-bearing spans.
     4. Rewrite selected content words with part-of-speech matched synonyms
        from the free Datamuse API, preferring substitutions that flip tokens
        out of the green list. Offline dictionary used as a fallback.
   ========================================================================== */

(function () {
  'use strict';

  /* ====================== small helpers ====================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* Normal CDF via Abramowitz-Stegun erf approximation. */
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
  }

  /* FNV-1a 32-bit — deterministic, fast, no dependencies. */
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* ====================== watermark model ====================== */
  const GAMMA = 0.5; // fraction of the vocabulary on the green list

  /* A token is "green" when the hash of (previous token, token) falls in the
     first GAMMA share of the keyspace — the standard green/red partition. */
  function isGreen(prevToken, token) {
    return (hash32(prevToken + '' + token) % 10000) < GAMMA * 10000;
  }

  function zScore(green, total) {
    if (!total) return 0;
    return (green - GAMMA * total) / Math.sqrt(total * GAMMA * (1 - GAMMA));
  }

  /* ====================== tokenizing & segmenting ====================== */
  const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

  function tokenize(text) {
    const out = [];
    let m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text)) !== null) {
      out.push({ raw: m[0], lc: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'inc', 'ltd', 'co',
    'etc', 'vs', 'fig', 'no', 'vol', 'approx', 'eg', 'ie', 'al', 'dept', 'est', 'min', 'max']);

  function endsAbbreviation(text, dotIndex) {
    let i = dotIndex - 1;
    let word = '';
    while (i >= 0 && /[A-Za-z]/.test(text[i])) { word = text[i] + word; i--; }
    if (!word) return false;
    if (word.length === 1) return true;                 // initials: "J. Smith"
    return ABBREV.has(word.toLowerCase());
  }

  /* Split into sentence-like segments, preserving exact offsets. */
  function splitSegments(text) {
    const parts = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '.' || ch === '!' || ch === '?') {
        if (ch === '.' && endsAbbreviation(text, i)) continue;
        if (/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) continue; // decimals
        let j = i + 1;
        while (j < text.length && /["'”’)\]]/.test(text[j])) j++;
        while (j < text.length && /[.!?]/.test(text[j])) j++;
        if (j >= text.length || /\s/.test(text[j])) {
          while (j < text.length && /[ \t]/.test(text[j])) j++;
          if (text[j] === '\n') { while (j < text.length && /\s/.test(text[j])) j++; }
          parts.push({ start: start, end: j });
          start = j;
          i = j - 1;
        }
      } else if (ch === '\n') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        parts.push({ start: start, end: j });
        start = j;
        i = j - 1;
      }
    }
    if (start < text.length) parts.push({ start: start, end: text.length });
    return parts.filter((p) => text.slice(p.start, p.end).trim().length > 0);
  }

  /* Very long segments get chopped into readable windows so the highlighted
     spans stay surgical instead of swallowing whole paragraphs. */
  function refineSegments(text, segments, tokens) {
    const MAX_WORDS = 34;
    const out = [];
    segments.forEach((seg) => {
      const inside = tokens.filter((t) => t.start >= seg.start && t.end <= seg.end);
      if (inside.length <= MAX_WORDS) { out.push(seg); return; }
      const chunks = Math.ceil(inside.length / 24);
      const per = Math.ceil(inside.length / chunks);
      let cursor = seg.start;
      for (let c = 0; c < chunks; c++) {
        const slice = inside.slice(c * per, (c + 1) * per);
        if (!slice.length) break;
        const last = slice[slice.length - 1];
        const end = c === chunks - 1 ? seg.end : Math.min(seg.end, last.end + 1);
        out.push({ start: cursor, end: end });
        cursor = end;
      }
    });
    return out;
  }

  /* ====================== lexical resources ====================== */
  const STOPWORDS = new Set(('a about above after again against all also am an and any are as at be because been ' +
    'before being below between both but by can cannot could did do does doing down during each few for from ' +
    'further had has have having he her here hers herself him himself his how i if in into is it its itself just ' +
    'me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she ' +
    'should so some such than that the their theirs them themselves then there these they this those through to ' +
    'too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'yourself yourselves been being does did done get got goes went may might must shall since upon within without ' +
    'however therefore thus hence moreover furthermore whether among across per via onto').split(' '));

  /* Multi-word terms whose parts must never be swapped independently —
     "artificial intelligence" must not become "near word". */
  const PROTECTED_TERMS = ('artificial intelligence|machine learning|deep learning|neural network|' +
    'neural networks|large language model|language model|language models|natural language|data science|' +
    'data scientist|training data|climate change|social media|mental health|public health|health care|' +
    'healthcare system|customer service|customer experience|supply chain|search engine|user experience|' +
    'user interface|operating system|open source|real estate|human resources|human rights|civil rights|' +
    'private sector|public sector|third party|best practice|best practices|case study|case studies|' +
    'quality assurance|project management|risk management|decision making|problem solving|' +
    'critical thinking|higher education|primary school|world war|united states|united kingdom|' +
    'european union|gross domestic product|greenhouse gas|renewable energy|fossil fuel|fossil fuels|' +
    'blood pressure|heart disease|side effects|clinical trial|clinical trials|peer review|' +
    'peer reviewed|literature review|research question|control group|standard deviation|' +
    'cloud computing|cyber security|information technology|software development|source code|' +
    'target audience|content marketing|search engine optimization|return on investment|' +
    'artificial neural|computer vision|augmented reality|virtual reality|internet of things|' +
    'quantum computing|block chain|smart phone|self driving|electric vehicle|electric vehicles|' +
    /* fixed expressions — swapping a word inside one always reads wrong */
    'as a result|as a consequence|in addition|for example|for instance|in fact|on the other hand|' +
    'at the same time|in other words|in conclusion|as well as|in order to|a wide range|wide range of|' +
    'play a role|plays a role|played a role|take place|takes place|took place|make sure|in terms of|' +
    'a number of|the number of|in particular|at least|at most|rather than|such as|so that|point of view|' +
    'state of the art|long term|short term|real time|on average|in practice|in theory|in contrast|' +
    'by contrast|decision maker|decision makers|decision making|problem solving|critical thinking|' +
    'due to the fact|as a whole|in general|for the most part|on the contrary|in summary|at scale|' +
    'at large|in depth|by design|in place|in line with|on track|up to date|so far|as such').split('|');

  /* Words that carry domain meaning and rarely survive substitution intact. */
  const NEVER_REPLACE = new Set(('data|model|models|algorithm|algorithms|software|hardware|internet|' +
    'website|email|online|digital|computer|computers|technology|technologies|intelligence|learning|' +
    'network|networks|research|study|studies|analysis|percent|percentage|million|billion|thousand|' +
    'government|company|companies|business|businesses|customer|customers|student|students|patient|' +
    'organization|organizations|organisation|organisations|institution|institutions|agency|agencies|' +
    'patients|doctor|teacher|market|markets|price|prices|energy|water|climate|carbon|covid|virus|' +
    'vaccine|brain|cancer|gene|genes|protein|cell|cells|code|user|users|team|teams|project|projects|' +
    'report|reports|budget|revenue|profit|profits|contract|policy|policies|legal|court|human|humans|' +
    'people|person|child|children|women|woman|men|country|countries|city|cities|world|global|social|' +
    'economic|political|scientific|medical|financial|environmental|' +
    /* words that flip part of speech too easily to be swapped safely */
    'complete|change|focus|measure|result|results|standard|support|view|views|likely|present|limit|limits|' +
    'link|links|need|needs|demand|claim|comment|concern|concerns|place|point|points|value|values|share|' +
    'cover|cause|causes|capture|balance|level|levels|matter|design|display|offer|practice|progress|' +
    'review|target|function|functions|interest|experience|impact|impacts|benefit|benefits|challenge|' +
    'question|questions|reason|reasons|risk|risks|role|roles|source|sources|structure|process|position|' +
    'order|record|records|form|forms|work|works|use|uses|help|aim|aims|state|states|effect|effects|' +
    'increase|decrease|shift|control|test|tests|plan|plans|move|lead|leads|face|faces|show|shows').split('|'));

  /* Curated entries whose synonyms only hold for one reading of the word.
     They are used only when the context confirms that reading. */
  const CURATED_POS = {
    approach: 'n', issue: 'n', estimate: 'n', gain: 'n', trend: 'n', practice: 'n',
    handle: 'v', highlight: 'v', address: 'v', conduct: 'v', monitor: 'v', range: 'n'
  };

  /* Curated, sense-safe substitutions — the primary source. Every pair here is
     one I can vouch for in ordinary prose; the open API is only a fallback. */
  const OFFLINE_SYNONYMS = {
    /* --- adjectives --- */
    abundant: ['plentiful'], accurate: ['precise', 'exact'], additional: ['extra', 'further'],
    adequate: ['sufficient'], advanced: ['sophisticated'], appropriate: ['suitable', 'fitting'],
    available: ['obtainable', 'accessible'], basic: ['fundamental'], beneficial: ['advantageous'],
    brief: ['short', 'concise'], broad: ['wide', 'extensive'], capable: ['able'],
    central: ['principal', 'core'], certain: ['sure'], clear: ['evident', 'obvious'],
    comfortable: ['cosy'], common: ['frequent', 'widespread'], complex: ['complicated', 'intricate'], comprehensive: ['thorough', 'exhaustive'],
    considerable: ['substantial', 'sizeable'], consistent: ['steady', 'uniform'],
    constant: ['continual', 'steady'], convenient: ['handy'], correct: ['right', 'accurate'],
    critical: ['crucial', 'vital'], crucial: ['critical', 'vital'], current: ['present', 'existing'],
    dangerous: ['hazardous', 'perilous'], detailed: ['thorough'], difficult: ['hard', 'demanding'],
    distinct: ['separate', 'discrete'], diverse: ['varied', 'assorted'], dramatic: ['striking'],
    early: ['initial'], effective: ['efficient', 'potent'], efficient: ['effective'],
    enormous: ['immense', 'vast'], entire: ['whole', 'complete'], essential: ['vital', 'necessary'],
    everyday: ['routine', 'ordinary'], excellent: ['outstanding', 'superb'], expensive: ['costly'],
    extensive: ['broad', 'wide'], familiar: ['known'], famous: ['renowned', 'celebrated'],
    fast: ['rapid', 'quick'], final: ['last', 'concluding'], flexible: ['adaptable'],
    frequent: ['common', 'recurrent'], fundamental: ['basic', 'underlying'], future: ['forthcoming'],
    general: ['broad', 'overall'], gradual: ['steady', 'incremental'], harmful: ['damaging', 'detrimental'],
    huge: ['enormous', 'immense'], ideal: ['perfect', 'optimal'], immediate: ['instant', 'prompt'],
    important: ['significant', 'notable'], impressive: ['remarkable', 'striking'],
    inevitable: ['unavoidable'], initial: ['first', 'opening'], innovative: ['inventive', 'original'],
    interesting: ['engaging', 'compelling'], internal: ['inner'], key: ['pivotal'],
    large: ['big', 'sizeable'], leading: ['foremost', 'prominent'], limited: ['restricted', 'narrow'], main: ['principal', 'chief'], major: ['principal', 'chief'],
    massive: ['enormous', 'huge'], meaningful: ['significant'], minor: ['slight', 'lesser'],
    modern: ['contemporary', 'current'], multiple: ['several', 'numerous'], narrow: ['limited'],
    necessary: ['required', 'needed'], negative: ['adverse', 'unfavourable'], normal: ['ordinary', 'typical'],
    notable: ['noteworthy', 'remarkable'], noticeable: ['perceptible', 'discernible'],
    numerous: ['many', 'countless'], obvious: ['evident', 'apparent'], optimal: ['ideal', 'best'],
    ordinary: ['everyday', 'commonplace'], original: ['initial'], overall: ['general', 'aggregate'],
    particular: ['specific', 'certain'], perfect: ['flawless', 'ideal'], permanent: ['lasting', 'enduring'],
    popular: ['widespread', 'favoured'], positive: ['favourable', 'constructive'],
    possible: ['feasible', 'conceivable'], potential: ['possible', 'prospective'],
    powerful: ['strong', 'potent'], practical: ['pragmatic', 'workable'], precise: ['exact', 'accurate'],
    previous: ['prior', 'earlier'], primary: ['main', 'chief'], proper: ['appropriate', 'correct'],
    rapid: ['swift', 'quick'], rare: ['uncommon', 'scarce'], recent: ['latest'],
    relevant: ['pertinent', 'applicable'], reliable: ['dependable', 'trustworthy'],
    remarkable: ['striking', 'notable'], robust: ['sturdy', 'resilient'], secure: ['safe'],
    serious: ['grave', 'severe'], severe: ['harsh', 'grave'], significant: ['notable', 'considerable'],
    similar: ['comparable', 'alike'], simple: ['straightforward', 'plain'], single: ['sole', 'lone'],
    slight: ['minor', 'marginal'], slow: ['sluggish', 'gradual'], small: ['modest', 'compact'],
    sophisticated: ['advanced', 'refined'], specific: ['particular', 'precise'], stable: ['steady'],
    strong: ['powerful', 'sturdy'], substantial: ['considerable', 'sizeable'],
    successful: ['thriving'], sudden: ['abrupt'], sufficient: ['adequate', 'ample'],
    suitable: ['appropriate', 'fitting'], superior: ['better'], surprising: ['unexpected', 'startling'],
    thorough: ['exhaustive', 'meticulous'], tiny: ['minute', 'minuscule'], traditional: ['conventional', 'customary'],
    typical: ['usual', 'standard'], ultimate: ['final', 'eventual'], unique: ['distinctive', 'singular'],
    unusual: ['uncommon', 'atypical'], urgent: ['pressing'], useful: ['helpful', 'valuable'],
    valuable: ['worthwhile', 'precious'], variable: ['changeable'], various: ['diverse', 'assorted'],
    vast: ['immense', 'enormous'], visible: ['apparent', 'discernible'], vital: ['crucial', 'essential'],
    weak: ['feeble', 'frail'], whole: ['entire', 'complete'], wide: ['broad', 'extensive'],
    widespread: ['prevalent', 'pervasive'], willing: ['prepared'], worldwide: ['global'],

    /* --- verbs --- */
    accomplish: ['achieve', 'attain'], achieve: ['attain', 'accomplish'], acquire: ['obtain', 'gain'],
    adapt: ['adjust'], address: ['tackle'], adjust: ['modify', 'adapt'], affect: ['influence'],
    allow: ['permit', 'enable'], analyse: ['examine', 'scrutinise'], appear: ['seem'],
    apply: ['employ'], assess: ['evaluate', 'appraise'], assist: ['help', 'aid'],
    assume: ['presume', 'suppose'], avoid: ['evade', 'sidestep'],
    begin: ['start', 'commence'], boost: ['increase', 'raise'], build: ['construct', 'assemble'],
    calculate: ['compute'], choose: ['select', 'pick'], combine: ['merge', 'blend'],
    compare: ['contrast'], conduct: ['undertake'],
    consider: ['regard', 'weigh'], consist: ['comprise'], contain: ['hold', 'include'],
    continue: ['persist', 'proceed'], contribute: ['add'], convert: ['transform'],
    decide: ['determine', 'resolve'], decrease: ['reduce', 'lessen'],
    define: ['specify'], deliver: ['provide', 'supply'], demonstrate: ['show', 'illustrate'],
    depend: ['rely', 'hinge'], describe: ['depict', 'outline'], determine: ['establish', 'ascertain'], develop: ['evolve', 'advance'], discover: ['find', 'uncover'],
    discuss: ['examine', 'debate'], eliminate: ['remove', 'eradicate'],
    emerge: ['arise', 'surface'], employ: ['use', 'utilise'], enable: ['allow', 'permit'],
    encounter: ['meet', 'face'], encourage: ['promote', 'foster'], enhance: ['improve', 'strengthen'],
    ensure: ['guarantee', 'safeguard'], establish: ['found', 'institute'], estimate: ['gauge', 'reckon'],
    evaluate: ['assess', 'appraise'], examine: ['inspect', 'scrutinise'], exceed: ['surpass', 'outstrip'],
    exist: ['occur'], expand: ['broaden', 'widen'], expect: ['anticipate'],
    explain: ['clarify', 'elucidate'], explore: ['investigate', 'examine'], extend: ['prolong', 'stretch'],
    facilitate: ['ease', 'smooth'], follow: ['pursue'],
    gain: ['acquire', 'obtain'], gather: ['collect', 'assemble'], generate: ['produce', 'create'],
    grow: ['expand', 'increase'], handle: ['manage', 'oversee'], help: ['assist', 'aid'],
    highlight: ['underscore', 'emphasise'], identify: ['pinpoint', 'recognise'], illustrate: ['demonstrate', 'depict'],
    implement: ['execute', 'deploy'], imply: ['suggest', 'indicate'], improve: ['enhance', 'refine'],
    include: ['comprise', 'incorporate'], indicate: ['signal', 'suggest'],
    inform: ['notify', 'apprise'], integrate: ['incorporate', 'merge'],
    interpret: ['construe', 'read'], investigate: ['examine', 'probe'], involve: ['entail', 'require'],
    maintain: ['preserve', 'sustain'], manage: ['handle', 'oversee'],
    mention: ['note', 'cite'], monitor: ['track', 'observe'],
    notice: ['observe', 'perceive'], observe: ['note', 'watch'], obtain: ['acquire', 'secure'],
    occur: ['happen', 'arise'], operate: ['function', 'run'],
    outline: ['sketch', 'summarise'], overcome: ['surmount'], perform: ['execute', 'undertake'],
    predict: ['forecast', 'anticipate'], prepare: ['ready', 'arrange'], prevent: ['avert', 'forestall'], produce: ['create', 'yield'], promote: ['encourage', 'foster'],
    protect: ['safeguard', 'shield'], prove: ['establish'], provide: ['supply', 'offer'],
    receive: ['obtain', 'get'], recognise: ['identify', 'discern'], recognize: ['identify', 'discern'],
    recommend: ['advise', 'suggest'], reduce: ['lower', 'diminish'], reflect: ['mirror'],
    reinforce: ['strengthen', 'bolster'], remain: ['stay', 'persist'], remove: ['eliminate', 'strip'],
    replace: ['substitute', 'supplant'], represent: ['depict', 'embody'], require: ['need', 'demand'],
    resolve: ['settle', 'rectify'], respond: ['reply', 'react'], restrict: ['limit', 'curb'],
    retain: ['keep', 'preserve'], reveal: ['disclose', 'expose'],
    select: ['choose', 'pick'], serve: ['cater'],
    solve: ['resolve'],
    specify: ['stipulate', 'define'], strengthen: ['bolster', 'reinforce'], suggest: ['propose', 'recommend'],
    supply: ['provide', 'furnish'], sustain: ['maintain', 'uphold'],
    tackle: ['address', 'confront'], transform: ['reshape', 'convert'], understand: ['grasp', 'comprehend'],
    utilise: ['use', 'employ'], utilize: ['use', 'employ'], vary: ['differ', 'fluctuate'],
    verify: ['confirm', 'corroborate'], /* --- nouns --- */
    ability: ['capacity', 'aptitude'], advantage: ['benefit', 'upside'], amount: ['quantity', 'volume'],
    approach: ['method', 'strategy'], area: ['region', 'zone'], aspect: ['facet', 'dimension'],
    attention: ['notice'], barrier: ['obstacle', 'hurdle'], basis: ['foundation', 'grounding'], capacity: ['capability'], category: ['class', 'grouping'], characteristic: ['trait', 'attribute'], choice: ['option', 'selection'],
    circumstance: ['situation'], collaboration: ['cooperation', 'partnership'],
    combination: ['blend', 'mixture'], component: ['element', 'part'],
    concept: ['notion', 'idea'], conclusion: ['finding'],
    condition: ['state'], consequence: ['outcome', 'upshot'], consideration: ['factor'],
    constraint: ['limitation', 'restriction'], contribution: ['input'], creation: ['formation'],
    criteria: ['standards', 'benchmarks'], danger: ['peril', 'hazard'], decision: ['ruling', 'verdict'],
    description: ['account', 'depiction'], development: ['progress', 'advancement'], difference: ['distinction', 'contrast'],
    difficulty: ['hardship', 'obstacle'], discussion: ['debate', 'dialogue'],
    effect: ['impact', 'influence'], effort: ['endeavour', 'exertion'], element: ['component', 'ingredient'],
    emphasis: ['stress'], environment: ['setting', 'surroundings'], evidence: ['proof', 'corroboration'],
    example: ['instance', 'case'], expert: ['specialist', 'authority'],
    explanation: ['account', 'rationale'], factor: ['element', 'consideration'], failure: ['collapse', 'breakdown'],
    feature: ['characteristic', 'trait'], field: ['discipline', 'domain'], framework: ['structure'], goal: ['objective', 'aim'],
    growth: ['expansion'], guidance: ['direction', 'counsel'], idea: ['notion', 'concept'],
    implication: ['consequence', 'ramification'], importance: ['significance'],
    improvement: ['enhancement', 'refinement'], individual: ['person'],
    industry: ['sector'], information: ['details'],
    insight: ['understanding', 'perception'], instance: ['example', 'case'], interpretation: ['reading', 'construal'], issue: ['problem', 'matter'], journey: ['voyage'],
    knowledge: ['understanding', 'expertise'], landscape: ['terrain'], limitation: ['constraint', 'shortcoming'], location: ['site', 'spot'],
    manner: ['fashion', 'way'], method: ['technique', 'procedure'], moment: ['instant'], nature: ['character'],
    objective: ['goal', 'aim'], obstacle: ['barrier', 'hurdle'],
    opinion: ['view', 'stance'], opportunity: ['chance', 'opening'], option: ['choice', 'alternative'],
    outcome: ['result', 'upshot'], pattern: ['trend', 'regularity'], performance: ['execution'],
    period: ['span', 'stretch'], perspective: ['viewpoint', 'standpoint'], phase: ['stage'],
    portion: ['share', 'segment'],
    possibility: ['prospect', 'likelihood'], presence: ['existence'], principle: ['tenet', 'precept'], priority: ['precedence'],
    problem: ['issue', 'difficulty'], procedure: ['process', 'protocol'], property: ['attribute'], proportion: ['share', 'ratio'],
    proposal: ['plan', 'suggestion'], purpose: ['aim', 'objective'], quality: ['standard', 'calibre'],
    quantity: ['amount', 'volume'], range: ['spectrum', 'array'],
    reduction: ['decrease', 'decline'], region: ['area', 'district'],
    relationship: ['connection', 'rapport'], requirement: ['prerequisite', 'necessity'],
    resource: ['asset'], response: ['reply', 'reaction'], responsibility: ['duty', 'obligation'],
    scale: ['magnitude'], scope: ['remit', 'breadth'], sector: ['industry'],
    selection: ['choice'], series: ['sequence', 'succession'], setting: ['environment', 'context'],
    side: ['facet'], situation: ['circumstance', 'scenario'],
    solution: ['remedy', 'fix'], stage: ['phase', 'step'],
    strategy: ['plan', 'approach'], strength: ['asset'],
    success: ['achievement', 'triumph'],
    system: ['framework', 'arrangement'], task: ['assignment', 'chore'], technique: ['method', 'procedure'], tendency: ['inclination', 'propensity'],
    threat: ['danger', 'menace'], tool: ['instrument', 'implement'], topic: ['subject', 'theme'],
    transformation: ['overhaul'], trend: ['tendency', 'movement'], type: ['kind', 'variety'],
    understanding: ['grasp', 'comprehension'], variety: ['range', 'assortment'],
    way: ['manner', 'route'],

    /* --- adverbs & connectives --- */
    accurately: ['precisely'], actually: ['genuinely'], clearly: ['plainly', 'evidently'],
    commonly: ['frequently', 'routinely'], completely: ['entirely', 'wholly'], constantly: ['continually'],
    considerably: ['substantially', 'markedly'], directly: ['straight'], easily: ['readily'],
    effectively: ['efficiently'], entirely: ['wholly', 'completely'], especially: ['particularly', 'notably'],
    essentially: ['fundamentally'], eventually: ['ultimately', 'finally'], exactly: ['precisely'],
    extremely: ['exceedingly', 'highly'], frequently: ['often', 'regularly'], generally: ['broadly', 'typically'],
    gradually: ['steadily', 'incrementally'], greatly: ['considerably', 'markedly'], immediately: ['instantly', 'promptly'],
    increasingly: ['progressively'], initially: ['originally'], largely: ['mainly', 'chiefly'],
    mainly: ['chiefly', 'principally'], notably: ['particularly'],
    obviously: ['plainly', 'evidently'], often: ['frequently', 'regularly'], particularly: ['especially', 'notably'],
    perhaps: ['maybe', 'possibly'], previously: ['formerly', 'earlier'], primarily: ['chiefly', 'mainly'],
    quickly: ['rapidly', 'swiftly'], rapidly: ['quickly', 'swiftly'], rarely: ['seldom'],
    recently: ['lately'], regularly: ['routinely', 'consistently'], significantly: ['markedly', 'substantially'],
    similarly: ['likewise'], simply: ['merely'], slightly: ['marginally'],
    slowly: ['gradually'], specifically: ['precisely'], strongly: ['firmly'],
    substantially: ['considerably', 'markedly'], successfully: ['effectively'], typically: ['usually', 'ordinarily'],
    ultimately: ['eventually', 'finally'], usually: ['typically', 'ordinarily'], widely: ['extensively', 'broadly'],

    /* --- merged entries (one substitute valid for every part of speech) --- */
    attempt: ['endeavour'], increase: ['rise'], influence: ['sway'], shift: ['move']
  };

  /* ====================== morphology ====================== */
  function pluralize(w) {
    if (/(ch|sh|s|x|z)$/i.test(w)) return w + 'es';
    if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function toEd(w) {
    if (/e$/i.test(w)) return w + 'd';
    if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ied';
    if (/[aeiou][bdgklmnprt]$/i.test(w) && w.length <= 5) return w + w.slice(-1) + 'ed';
    return w + 'ed';
  }
  function toIng(w) {
    if (/[^aeiou]e$/i.test(w)) return w.slice(0, -1) + 'ing';
    if (/[aeiou][bdgklmnprt]$/i.test(w) && w.length <= 5) return w + w.slice(-1) + 'ing';
    return w + 'ing';
  }

  /* Candidate lemmas for an inflected form, plus the matching re-inflector. */
  function lemmaGuesses(word) {
    const w = word.toLowerCase();
    const out = [];
    if (/[^aeiou]ies$/.test(w)) out.push({ lemma: w.slice(0, -3) + 'y', inflect: pluralize, kind: 'plural' });
    if (/(ch|sh|s|x|z)es$/.test(w)) out.push({ lemma: w.slice(0, -2), inflect: pluralize, kind: 'plural' });
    if (/[^s]s$/.test(w) && !/ss$/.test(w)) out.push({ lemma: w.slice(0, -1), inflect: pluralize, kind: 'plural' });
    if (/ing$/.test(w) && w.length > 5) {
      const stem = w.slice(0, -3);
      out.push({ lemma: stem, inflect: toIng, kind: 'ing' });
      out.push({ lemma: stem + 'e', inflect: toIng, kind: 'ing' });
      if (/(.)\1$/.test(stem)) out.push({ lemma: stem.slice(0, -1), inflect: toIng, kind: 'ing' });
    }
    if (/ed$/.test(w) && w.length > 4) {
      const stem = w.slice(0, -2);
      out.push({ lemma: stem, inflect: toEd, kind: 'ed' });
      out.push({ lemma: w.slice(0, -1), inflect: toEd, kind: 'ed' });
      if (/(.)\1$/.test(stem)) out.push({ lemma: stem.slice(0, -1), inflect: toEd, kind: 'ed' });
      if (/ied$/.test(w)) out.push({ lemma: w.slice(0, -3) + 'y', inflect: toEd, kind: 'ed' });
    }
    return out;
  }

  /* "a" vs "an" follows the sound, not the letter: a user, an hour. */
  function articleFor(word) {
    const w = word.toLowerCase();
    if (/^(uni|use|user|usual|usur|utili|euro|eula|ubiq|one|once)/.test(w)) return 'a';
    if (/^(hour|honest|honou?r|heir)/.test(w)) return 'an';
    return /^[aeiou]/.test(w) ? 'an' : 'a';
  }

  function matchCase(source, target) {
    if (/^[A-Z][a-z']*$/.test(source)) return target.charAt(0).toUpperCase() + target.slice(1);
    if (/^[A-Z]+$/.test(source) && source.length > 1) return target.toUpperCase();
    return target;
  }

  /* ====================== Datamuse client ====================== */
  const API = 'https://api.datamuse.com/words';
  const REQUEST_TIMEOUT = 6000;
  const FAILURE_LIMIT = 2; // circuit breaker: stop retrying a dead endpoint
  const cache = new Map();
  let apiHealthy = true;
  let netFailures = 0;
  let apiDown = false;

  function fetchJson(url) {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    if (apiDown) return Promise.resolve([]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    return fetch(url, { signal: controller.signal, mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((data) => { cache.set(url, data); return data; })
      .catch(() => {
        apiHealthy = false;
        netFailures++;
        if (netFailures >= FAILURE_LIMIT) apiDown = true; // fall back to the built-in dictionary
        return [];
      })
      .finally(() => clearTimeout(timer));
  }

  function parseEntry(entry) {
    const tags = entry.tags || [];
    let freq = 0;
    const pos = [];
    tags.forEach((t) => {
      if (t.indexOf('f:') === 0) freq = parseFloat(t.slice(2)) || 0;
      else if (['n', 'v', 'adj', 'adv', 'u'].indexOf(t.toLowerCase()) !== -1) pos.push(t.toLowerCase());
    });
    return { word: entry.word, score: entry.score || 0, freq: freq, pos: pos };
  }

  function lookupWord(word) {
    return fetchJson(API + '?sp=' + encodeURIComponent(word) + '&md=fp&max=1')
      .then((rows) => {
        if (!rows.length) return null;
        const e = parseEntry(rows[0]);
        return e.word.toLowerCase() === word.toLowerCase() ? e : null;
      });
  }

  function synonymsOf(word) {
    return fetchJson(API + '?rel_syn=' + encodeURIComponent(word) + '&md=fp&max=14')
      .then((rows) => rows.map(parseEntry));
  }

  /* An inflected form is accepted only if the dictionary knows it well enough
     (frequency gate) — this is what keeps "runned" and "maked" out. */
  function isRealWord(word) {
    return lookupWord(word).then((e) => !!e && e.freq >= 0.8);
  }

  /* ====================== synonym resolution ====================== */
  const MIN_FREQ = 2.0;    // occurrences per million — filters archaic words
  const MAX_GROWTH = 2.2;  // synonym may not be wildly longer than the original
  const FREQ_FLOOR = 0.15; // candidate may not be far rarer than the original…
  const FREQ_CEIL = 12;    // …nor far more generic than it
  const TOP_RANK = 3;      // only the dominant sense of the synset
  const SCORE_RATIO = 0.5;

  /* Context-based part-of-speech resolution, used when the dictionary lists a
     word under more than one part of speech. Returning null means "ambiguous",
     and an ambiguous word is left alone rather than guessed at. */
  const DETERMINERS = new Set('a an the this that these those its their his her our your my any each every some no another'.split(' '));
  const COPULAS = new Set('is are was were be been being become becomes became seem seems seemed appear appears remain remains'.split(' '));
  const DEGREE = new Set('very more most less least quite rather extremely highly fairly so too increasingly particularly especially remarkably relatively somewhat truly equally'.split(' '));
  const VERB_MARKERS = new Set('to will would can could should must may might shall not also they we you it he she who which that often never always then still now'.split(' '));

  function contextPos(word, prev, next) {
    const w = word.toLowerCase();
    if (/ly$/.test(w) && w.length > 5) return 'adv';
    if (prev && COPULAS.has(prev)) return /(ing|ed)$/.test(w) ? 'v' : 'adj';
    if (prev && DEGREE.has(prev)) return 'adj';
    if (prev === 'to' || (prev && VERB_MARKERS.has(prev))) return 'v';
    if (prev && DETERMINERS.has(prev)) return next && !STOPWORDS.has(next) ? 'adj' : 'n';
    return null;
  }

  function resolvePos(tags, word, prev, next) {
    const usable = tags.filter((t) => ['n', 'v', 'adj', 'adv'].indexOf(t) !== -1);
    if (usable.length === 1) return usable[0];
    const guess = contextPos(word, prev, next);
    if (guess && (!usable.length || usable.indexOf(guess) !== -1)) return guess;
    return null;
  }

  function acceptable(original, candidate) {
    const c = candidate.toLowerCase();
    const o = original.toLowerCase();
    if (!/^[a-z]+$/.test(c)) return false;
    if (c === o) return false;
    if (c.length < 3) return false;
    if (c.length > o.length * MAX_GROWTH + 4) return false;
    if (STOPWORDS.has(c)) return false;
    if (c.indexOf(o) === 0 || o.indexOf(c) === 0) return false; // same stem
    return true;
  }

  /* A candidate must be unambiguous and of exactly the resolved part of speech.
     This is what stops "evidence" (noun) becoming the verb "demonstrate". */
  function posMatches(candidate, pos) {
    const usable = candidate.pos.filter((t) => ['n', 'v', 'adj', 'adv'].indexOf(t) !== -1);
    return usable.length === 1 && usable[0] === pos;
  }

  function withinRegister(candidate, originFreq) {
    if (candidate.freq < MIN_FREQ) return false;
    if (!originFreq) return true;
    const ratio = candidate.freq / originFreq;
    return ratio >= FREQ_FLOOR && ratio <= FREQ_CEIL;
  }

  function offlineCandidates(word) {
    const lc = word.toLowerCase();
    if (OFFLINE_SYNONYMS[lc]) {
      return OFFLINE_SYNONYMS[lc].map((w) => ({ word: w, score: 1000, freq: 50, pos: [] }));
    }
    const guesses = lemmaGuesses(lc).filter((g) => g.kind === 'plural');
    for (let i = 0; i < guesses.length; i++) {
      const g = guesses[i];
      if (OFFLINE_SYNONYMS[g.lemma]) {
        return OFFLINE_SYNONYMS[g.lemma]
          .filter((w) => w.indexOf(' ') === -1)
          .map((w) => ({ word: g.inflect(w), score: 1000, freq: 50, pos: [] }));
      }
    }
    return [];
  }

  /* Keep only the dominant sense of a synset, then apply the register and
     part-of-speech gates. Everything that survives is safe to substitute. */
  /* A candidate must carry the same inflection as the word it replaces, or
     "refining their predictions" turns into "refinement their predictions". */
  function inflectionMatches(word, candidate) {
    const w = word.toLowerCase();
    const c = candidate.toLowerCase();
    if (/ing$/.test(w)) return /ing$/.test(c);
    if (/ed$/.test(w)) return /ed$/.test(c);
    if (/[^s]s$/.test(w) && !/ss$/.test(w)) return /s$/.test(c);
    return !/ing$/.test(c);
  }

  function gate(rows, word, pos, originFreq) {
    const usable = rows.filter((c) => c.word.indexOf(' ') === -1 && /^[a-z]+$/.test(c.word))
      .filter((c) => inflectionMatches(word, c.word));
    if (!usable.length) return [];
    const top = usable[0].score || 1;
    return usable
      .slice(0, TOP_RANK)
      .filter((c) => (c.score || 0) >= SCORE_RATIO * top)
      .filter((c) => posMatches(c, pos))
      .filter((c) => withinRegister(c, originFreq))
      .filter((c) => acceptable(word, c.word));
  }

  /* Returns clean, inflection-matched candidates for one word.
     The curated dictionary always wins; the open API only fills its gaps. */
  function candidatesFor(word, prev, next, useApi) {
    const required = CURATED_POS[word.toLowerCase()];
    if (required && contextPos(word, prev, next) !== required) {
      return Promise.resolve({ list: [], source: 'built-in' }); // wrong reading here
    }
    const curated = offlineCandidates(word).filter((c) => acceptable(word, c.word));
    if (curated.length) return Promise.resolve({ list: curated, source: 'built-in' });
    if (!useApi) return Promise.resolve({ list: [], source: 'built-in' });

    return lookupWord(word).then((self) => {
      const pos = resolvePos(self ? self.pos : [], word, prev, next);
      if (!pos) return { list: [], source: 'Datamuse' }; // ambiguous — leave it alone
      const originFreq = self ? self.freq : 0;

      return synonymsOf(word).then((direct) => {
        const clean = gate(direct, word, pos, originFreq);
        if (clean.length) return { list: clean, source: 'Datamuse' };

        /* Direct lookup fails for inflected forms: lemmatize, fetch synonyms of
           the lemma, re-inflect, then verify the result is a real word. */
        const guesses = lemmaGuesses(word).slice(0, 3);
        const tryGuess = (idx) => {
          if (idx >= guesses.length) return Promise.resolve({ list: [], source: 'Datamuse' });
          const g = guesses[idx];
          return lookupWord(g.lemma).then((lemmaEntry) => {
            if (!lemmaEntry) return tryGuess(idx + 1);
            return synonymsOf(g.lemma).then((rows) => {
              const pool = gate(rows, g.lemma, pos, lemmaEntry.freq);
              if (!pool.length) return tryGuess(idx + 1);
              return Promise.all(pool.map((c) => {
                const inflected = g.inflect(c.word);
                if (inflected === c.word) return null;
                return isRealWord(inflected).then((ok) =>
                  ok && acceptable(word, inflected)
                    ? { word: inflected, score: c.score, freq: c.freq, pos: c.pos }
                    : null);
              })).then((res) => {
                const good = res.filter(Boolean);
                return good.length ? { list: good, source: 'Datamuse' } : tryGuess(idx + 1);
              });
            });
          });
        };
        return tryGuess(0);
      });
    });
  }

  /* Simple concurrency pool so we stay polite to the free API. */
  function pool(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;
    function next() {
      const i = index++;
      if (i >= items.length) return Promise.resolve();
      return Promise.resolve(worker(items[i], i)).then((r) => { results[i] = r; return next(); });
    }
    const runners = [];
    for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
    return Promise.all(runners).then(() => results);
  }

  /* ====================== analysis ====================== */
  function isContentWord(tok) {
    const w = tok.raw;
    if (w.length < 4) return false;
    if (STOPWORDS.has(tok.lc)) return false;
    if (NEVER_REPLACE.has(tok.lc)) return false;   // domain terms
    if (tok.locked) return false;                  // inside a protected phrase
    if (tok.sentenceInitial) return false;         // never touch the opening word
    if (/[’']/.test(w)) return false;
    if (/^[A-Z]+$/.test(w)) return false;          // acronyms
    if (/^[A-Z]/.test(w)) return false;            // proper nouns / capitalised terms
    return true;
  }

  /* Mark every token that falls inside a protected multi-word term. */
  function lockProtectedTerms(text, tokens) {
    const lower = text.toLowerCase();
    PROTECTED_TERMS.forEach((term) => {
      let from = 0;
      let at;
      while ((at = lower.indexOf(term, from)) !== -1) {
        const end = at + term.length;
        const beforeOk = at === 0 || !/[a-z]/.test(lower[at - 1]);
        const afterOk = end >= lower.length || !/[a-z]/.test(lower[end]);
        if (beforeOk && afterOk) {
          tokens.forEach((t) => { if (t.start >= at && t.end <= end) t.locked = true; });
        }
        from = at + 1;
      }
    });
  }

  /* `forcedIdx` re-scores an already-chosen set of segment positions instead of
     picking new ones. Replacements never add or remove segments, so positions
     stay aligned — which is what makes the before/after comparison meaningful. */
  function analyze(text, forcedIdx) {
    const tokens = tokenize(text);
    if (tokens.length < 25) return null;

    let prev = '<|start|>';
    tokens.forEach((t) => { t.green = isGreen(prev, t.lc); prev = t.lc; });
    lockProtectedTerms(text, tokens);

    let segments = splitSegments(text);
    segments = refineSegments(text, segments, tokens);

    let cursor = 0;
    segments.forEach((seg) => {
      const list = [];
      while (cursor < tokens.length && tokens[cursor].start < seg.start) cursor++;
      let i = cursor;
      while (i < tokens.length && tokens[i].end <= seg.end) { list.push(tokens[i]); i++; }
      seg.tokens = list;
      seg.total = list.length;
      seg.green = list.filter((t) => t.green).length;
      seg.surplus = seg.green - GAMMA * seg.total;
      seg.z = zScore(seg.green, seg.total);
      seg.confidence = normCdf(seg.z);
      if (list.length) list[0].sentenceInitial = true;
      seg.eligible = list.filter(isContentWord);
      seg.density = seg.total ? seg.eligible.length / seg.total : 0;
      const raw = text.slice(seg.start, seg.end);
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const trail = raw.length - raw.replace(/\s+$/, '').length;
      seg.markStart = seg.start + lead;
      seg.markEnd = seg.end - trail;
      seg.text = raw.trim();
      seg.score = 0.62 * seg.confidence + 0.38 * Math.min(1, seg.density * 1.8);
    });

    segments.forEach((s, i) => { s.index = i; });

    let picked;
    if (forcedIdx && forcedIdx.length) {
      picked = forcedIdx.map((i) => segments[i]).filter(Boolean);
    } else {
      const usable = segments.filter((s) => s.total >= 6 && s.eligible.length >= 2);
      const ranked = (usable.length >= 3 ? usable : segments.filter((s) => s.total >= 4))
        .slice()
        .sort((a, b) => b.score - a.score);

      /* Randomised selection of 3-5 spans, weighted toward the top of the ranking. */
      const wanted = clamp(3 + Math.floor(Math.random() * 3), 3, 5);
      const count = Math.min(wanted, ranked.length);
      const shortlist = ranked.slice(0, Math.min(ranked.length, count + 4));
      picked = [];
      while (picked.length < count && shortlist.length) {
        const weights = shortlist.map((s) => Math.pow(s.score, 4));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let idx = 0;
        for (; idx < weights.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
        idx = Math.min(idx, shortlist.length - 1);
        picked.push(shortlist.splice(idx, 1)[0]);
      }
    }
    picked.sort((a, b) => a.start - b.start);

    /* Document-level statistics. */
    const totalTokens = tokens.length;
    const totalGreen = tokens.filter((t) => t.green).length;
    const zDoc = zScore(totalGreen, totalTokens);

    const positive = segments.reduce((a, s) => a + Math.max(0, s.surplus), 0);
    const selectedSurplus = picked.reduce((a, s) => a + Math.max(0, s.surplus), 0);
    const concentration = positive > 0 ? selectedSurplus / positive : 0;

    const lengths = segments.map((s) => s.total).filter((n) => n > 0);
    const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
    const variance = lengths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (lengths.length || 1);
    const cv = mean ? Math.sqrt(variance) / mean : 1;
    const uniformity = clamp(1 - cv / 0.8, 0, 1);

    const sample = tokens.slice(0, 500).map((t) => t.lc);
    const ttr = new Set(sample).size / (sample.length || 1);
    const lexUniformity = clamp((0.78 - ttr) / 0.42, 0, 1);

    /* Mean rather than max: one stubborn segment should not mask the effect of
       breaking all the others, and the same formula runs before and after. */
    const pAvg = picked.length
      ? picked.reduce((acc, s) => acc + s.confidence, 0) / picked.length
      : 0.5;
    const index = clamp(Math.round(100 * (
      0.42 * pAvg +
      0.18 * normCdf(zDoc) +
      0.16 * uniformity +
      0.10 * lexUniformity +
      0.14 * concentration
    )), 5, 99);

    picked.forEach((s, i) => {
      s.rank = i + 1;
      s.share = positive > 0 ? Math.max(0, s.surplus) / positive : 0;
    });

    return {
      text: text,
      tokens: tokens,
      segments: segments,
      selected: picked,
      selectedIdx: picked.map((s) => s.index),
      index: index,
      segmentWeight: pAvg,
      zDoc: zDoc,
      greenRate: totalTokens ? totalGreen / totalTokens : 0,
      totalTokens: totalTokens,
      concentration: concentration
    };
  }

  /* ====================== DOM refs ====================== */
  const el = {
    input: $('#inputText'), counter: $('#counter'), status: $('#status'),
    analyzeBtn: $('#analyzeBtn'), removeBtn: $('#removeBtn'), clearBtn: $('#clearBtn'),
    sampleBtn: $('#sampleBtn'), uploadBtn: $('#uploadBtn'), fileInput: $('#fileInput'),
    dropZone: $('#dropZone'), results: $('#results'), preview: $('#preview'),
    segmentList: $('#segmentList'), gaugeArc: $('#gaugeArc'), confidenceValue: $('#confidenceValue'),
    verdictChip: $('#verdictChip'), statGreen: $('#statGreen'), statZ: $('#statZ'),
    statTokens: $('#statTokens'), statSegments: $('#statSegments'), statHits: $('#statHits'),
    statConcentration: $('#statConcentration'), outputPanel: $('#outputPanel'), output: $('#output'),
    deltaBefore: $('#deltaBefore'), deltaAfter: $('#deltaAfter'), deltaCount: $('#deltaCount'),
    changeList: $('#changeList'), changeCount: $('#changeCount'), copyBtn: $('#copyBtn'),
    downloadBtn: $('#downloadBtn'), reanalyzeBtn: $('#reanalyzeBtn'), useApi: $('#useApi'),
    engineSelect: $('#engineSelect'), engineNote: $('#engineNote'), engineBadge: $('#engineBadge'),
    keyRow: $('#keyRow'), keyInput: $('#apiKey'), keySave: $('#keySave'),
    runPanel: $('#runPanel'), runSummary: $('#runSummary'), runEngine: $('#runEngine'), runCalls: $('#runCalls')
  };

  let current = null;
  let cleanText = '';

  /* ====================== detection engine ====================== */
  /* The built-in estimate, expressed as a probability so it satisfies the
     same interface as a real detection API. */
  function localProbability(text) {
    const tokens = tokenize(text);
    if (tokens.length < 4) return 0.5;
    let prev = '<|start|>';
    let green = 0;
    tokens.forEach((t) => {
      if (isGreen(prev, t.lc)) green++;
      prev = t.lc;
    });
    return normCdf(zScore(green, tokens.length));
  }

  const detector = window.ATWR_Detector.create(localProbability);

  /* ====================== rendering ====================== */
  const CIRC = 2 * Math.PI * 52;

  function setStatus(msg, kind) {
    if (!el.status) return;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
    el.status.innerHTML = kind === 'busy' ? '<span class="spinner"></span>' + escapeHtml(msg) : escapeHtml(msg);
  }

  let gaugeTimer = null;
  function renderGauge(value) {
    if (gaugeTimer) { clearInterval(gaugeTimer); gaugeTimer = null; }
    el.confidenceValue.textContent = '0';
    el.gaugeArc.style.strokeDasharray = CIRC.toFixed(1);
    el.gaugeArc.style.strokeDashoffset = CIRC.toFixed(1);
    const color = value >= 75 ? '#f43f5e' : value >= 50 ? '#fbbf24' : '#34d399';
    el.gaugeArc.style.stroke = color;
    requestAnimationFrame(() => {
      el.gaugeArc.style.strokeDashoffset = (CIRC * (1 - value / 100)).toFixed(1);
    });
    let shown = 0;
    const step = Math.max(1, Math.round(value / 28));
    gaugeTimer = setInterval(() => {
      shown = Math.min(value, shown + step);
      el.confidenceValue.textContent = shown;
      if (shown >= value) { clearInterval(gaugeTimer); gaugeTimer = null; }
    }, 26);

    el.verdictChip.textContent = value >= 75 ? 'High pressure' : value >= 50 ? 'Moderate' : 'Low';
    el.verdictChip.className = 'chip ' + (value >= 75 ? 'high' : value >= 50 ? 'mid' : 'low');
  }

  function renderStats(a) {
    el.statGreen.textContent = (a.greenRate * 100).toFixed(1) + '%';
    el.statZ.textContent = a.zDoc.toFixed(2);
    el.statTokens.textContent = a.totalTokens.toLocaleString();
    el.statSegments.textContent = a.segments.length.toLocaleString();
    el.statHits.textContent = a.selected.length;
    el.statConcentration.textContent = Math.round(a.concentration * 100) + '%';
  }

  function renderSegments(a) {
    const max = Math.max.apply(null, a.selected.map((s) => s.score));
    el.segmentList.innerHTML = a.selected.map((seg) => {
      const impact = Math.round((seg.score / (max || 1)) * 100);
      const preview = seg.text.length > 220 ? seg.text.slice(0, 217) + '…' : seg.text;
      return '<li class="segment-item">' +
        '<div class="segment-head">' +
        '<span class="segment-index">' + seg.rank + '</span>' +
        '<span class="segment-title">Segment ' + seg.rank + ' · ' + seg.total + ' tokens</span>' +
        '<span class="segment-metrics">' +
        '<span class="metric">watermark weight <strong>' + (seg.confidence * 100).toFixed(1) + '%</strong></span>' +
        '<span class="metric">z <strong>' + seg.z.toFixed(2) + '</strong></span>' +
        '<span class="metric">signal share <strong>' + Math.round(seg.share * 100) + '%</strong></span>' +
        '</span></div>' +
        '<p class="segment-text">“' + escapeHtml(preview) + '”</p>' +
        '<div class="impact-bar"><span class="impact-fill" data-w="' + impact + '"></span></div>' +
        '</li>';
    }).join('');
    requestAnimationFrame(() => {
      $$('.impact-fill', el.segmentList).forEach((bar) => { bar.style.width = bar.dataset.w + '%'; });
    });
  }

  function renderPreview(a) {
    let html = '';
    let cursor = 0;
    a.selected.forEach((seg) => {
      if (seg.markStart < cursor) return;
      html += escapeHtml(a.text.slice(cursor, seg.markStart));
      html += '<mark class="wm" data-rank="' + seg.rank + '">' +
        escapeHtml(a.text.slice(seg.markStart, seg.markEnd)) + '</mark>';
      cursor = seg.markEnd;
    });
    html += escapeHtml(a.text.slice(cursor));
    el.preview.innerHTML = html;
  }

  function updateCounter() {
    const text = el.input.value;
    const words = (text.match(/\S+/g) || []).length;
    el.counter.textContent = words.toLocaleString() + ' words · ' + text.length.toLocaleString() + ' characters';
  }

  /* ====================== actions ====================== */
  function runAnalysis() {
    const text = el.input.value;
    if (!text.trim()) { setStatus('Paste some text first, or load the sample.', 'error'); return; }
    const result = analyze(text);
    if (!result) { setStatus('Add a bit more text — at least 25 words are needed for a reliable statistic.', 'error'); return; }
    if (!result.selected.length) { setStatus('Could not isolate segments in this text. Try a longer passage.', 'error'); return; }

    current = result;
    cleanText = '';
    el.results.hidden = false;
    el.outputPanel.hidden = true;
    if (el.runPanel) el.runPanel.hidden = true;
    el.removeBtn.disabled = false;
    renderGauge(result.index);
    renderStats(result);
    renderSegments(result);
    renderPreview(result);
    setStatus('Analysis complete — ' + result.selected.length + ' high-impact segments isolated out of ' +
      result.segments.length + ' scanned. Break them to collapse the signal.', 'ok');
    el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* With the official engine selected, the verdict and the ranking come
       from the API rather than from our estimate. */
    if (selectedEngine() === 'official') refineWithDetector(result);
  }

  function selectedEngine() {
    return el.engineSelect ? el.engineSelect.value : 'local';
  }

  function refineWithDetector(result) {
    detector.resetRun();
    setStatus('Sending the document and its segments to the detection API…', 'busy');

    detector.use('official').then((active) => {
      if (active.id !== 'official') {
        setStatus('Official detector unavailable — ' + detector.official.unavailableReason +
          ' Showing the built-in estimate.', 'error');
        return;
      }

      const texts = [result.text].concat(result.segments.map((s) => s.text));
      return detector.score(texts).then((scores) => {
        if (result !== current) return; // superseded by a newer analysis

        const doc = scores[0];
        result.detected = doc;
        renderGauge(Math.round(doc.score * 100));
        el.verdictChip.textContent = doc.watermarked ? 'Watermark detected' : 'No watermark detected';
        el.verdictChip.className = 'chip ' + (doc.watermarked ? 'high' : 'low');

        result.segments.forEach((seg, i) => {
          const r = scores[i + 1];
          if (!r) return;
          seg.detected = r;
          seg.confidence = r.score;
          seg.score = 0.75 * r.score + 0.25 * Math.min(1, seg.density * 1.8);
        });

        /* Re-rank on the API's verdicts. */
        const ranked = result.segments
          .filter((s) => s.total >= 6 && s.eligible.length >= 2)
          .sort((a, b) => b.confidence - a.confidence);
        const count = Math.min(window.ATWR_CONFIG.optimizer.maxSegments, Math.max(
          window.ATWR_CONFIG.optimizer.minSegments,
          ranked.filter((s) => s.detected && s.detected.watermarked).length
        ), ranked.length);
        const picked = ranked.slice(0, count).sort((a, b) => a.start - b.start);
        picked.forEach((s, i) => { s.rank = i + 1; });
        result.selected = picked;
        result.selectedIdx = picked.map((s) => s.index);

        renderSegments(result);
        renderPreview(result);
        setStatus('Detection API: ' + (doc.watermarked ? 'watermark detected' : 'no watermark detected') +
          ' (' + Math.round(doc.score * 100) + '%) · ' + picked.length + ' segments targeted · ' +
          detector.stats.calls + ' calls.', 'ok');
      });
    }).catch((err) => {
      setStatus('Detection API error: ' + (err && err.message ? err.message : 'unknown') +
        ' Showing the built-in estimate.', 'error');
    });
  }

  /* ====================== rewrite candidate generation ====================== */

  /* Resolve, for one segment, which words can be swapped and what for.
     Offsets are relative to the segment string, not the document. */
  function resolveSegmentSlots(segText, useApi) {
    const tokens = tokenize(segText);
    if (tokens.length) tokens[0].sentenceInitial = true;
    lockProtectedTerms(segText, tokens);

    let prev = '<|start|>';
    tokens.forEach((t) => { t.green = isGreen(prev, t.lc); prev = t.lc; });

    const eligible = tokens.filter(isContentWord)
      .sort((x, y) => (y.green - x.green) || (y.raw.length - x.raw.length))
      .slice(0, 10);

    return pool(eligible, 5, (tok) => {
      const idx = tokens.indexOf(tok);
      const before = idx > 0 ? tokens[idx - 1].lc : null;
      const after = idx < tokens.length - 1 ? tokens[idx + 1].lc : null;
      const prevForHash = before === null ? '<|start|>' : before;

      return candidatesFor(tok.raw, before, after, useApi).then((res) => {
        if (!res.list.length) return null;
        const greenBefore = (tok.green ? 1 : 0) + (after && isGreen(tok.lc, after) ? 1 : 0);

        const ranked = res.list.slice(0, 8).map((c) => {
          const lc = c.word.toLowerCase();
          const greenAfter = (isGreen(prevForHash, lc) ? 1 : 0) + (after && isGreen(lc, after) ? 1 : 0);
          return {
            word: c.word,
            rank: (greenBefore - greenAfter) * 4 +
              Math.min(1.5, Math.log10(1 + c.freq) / 2) +
              Math.min(1, c.score / 60000)
          };
        }).filter((c) => c.rank >= 0).sort((a, b) => b.rank - a.rank);

        return ranked.length ? { tok: tok, index: idx, ranked: ranked, source: res.source } : null;
      });
    }).then((slots) => ({ tokens: tokens, slots: slots.filter(Boolean) }));
  }

  /* Turn a set of chosen substitutions into a rewritten segment. */
  function buildVariant(segText, tokens, chosen) {
    const edits = chosen.map((c) => ({
      offset: c.slot.tok.start,
      length: c.slot.tok.raw.length,
      from: c.slot.tok.raw,
      to: matchCase(c.slot.tok.raw, c.candidate.word),
      source: c.slot.source
    }));

    /* Fix the article in front of anything we changed. */
    chosen.forEach((c) => {
      const i = c.slot.index;
      if (i <= 0) return;
      const article = tokens[i - 1];
      if (article.lc !== 'a' && article.lc !== 'an') return;
      const want = articleFor(matchCase(c.slot.tok.raw, c.candidate.word));
      if (want === article.lc) return;
      edits.push({
        offset: article.start, length: article.raw.length, from: article.raw,
        to: matchCase(article.raw, want), source: 'grammar'
      });
    });

    edits.sort((a, b) => a.offset - b.offset);
    let text = '';
    let cursor = 0;
    edits.forEach((e) => {
      if (e.offset < cursor) return;
      text += segText.slice(cursor, e.offset) + e.to;
      cursor = e.offset + e.length;
    });
    text += segText.slice(cursor);

    return { text: text, changes: edits };
  }

  /* Several genuinely different rewrites of one segment, so the detector has
     something to choose between. Later rounds are allowed to change more. */
  function makeSegmentVariants(seg, round) {
    const useApi = el.useApi.checked;
    const wanted = window.ATWR_CONFIG.optimizer.variantsPerSegment;

    return resolveSegmentSlots(seg.original, useApi).then((res) => {
      const slots = res.slots;
      if (!slots.length) return [];

      const depth = Math.min(slots.length, 1 + round); // 2 words, then 3, then 4
      const variants = [];

      const pick = (list) => buildVariant(seg.original, res.tokens, list);

      /* A — the strongest candidates for the strongest slots. */
      variants.push(pick(slots.slice(0, depth).map((s) => ({ slot: s, candidate: s.ranked[0] }))));

      /* B — a different set of words, same strength. */
      if (slots.length > depth) {
        variants.push(pick(slots.slice(1, depth + 1).map((s) => ({ slot: s, candidate: s.ranked[0] }))));
      }

      /* C — same words, second-choice synonyms. */
      const alternates = slots.slice(0, depth)
        .filter((s) => s.ranked.length > 1)
        .map((s) => ({ slot: s, candidate: s.ranked[1] }));
      if (alternates.length) variants.push(pick(alternates));

      return variants.filter((v) => v && v.changes.length && v.text !== seg.original).slice(0, wanted);
    });
  }

  /* ====================== rewrite (detector-driven) ====================== */
  function rewrite() {
    if (!current) return;

    el.removeBtn.disabled = true;
    el.analyzeBtn.disabled = true;
    apiHealthy = true;
    netFailures = 0;
    apiDown = false;
    detector.resetRun();

    const segments = current.segments.map((s) => ({
      start: s.markStart,
      end: s.markEnd,
      text: current.text.slice(s.markStart, s.markEnd)
    }));

    setStatus('Starting…', 'busy');

    window.ATWR_Optimizer.run({
      text: current.text,
      segments: segments,
      targetIndexes: current.selected.map((s) => s.index),
      detector: detector,
      generateVariants: makeSegmentVariants,
      onProgress: (p) => {
        const calls = p.calls ? ' · ' + p.calls + ' detector call' + (p.calls === 1 ? '' : 's') : '';
        setStatus(p.message + calls, p.phase === 'done' ? 'ok' : 'busy');
      }
    }).then(renderRewriteResult).catch((err) => {
      el.removeBtn.disabled = false;
      el.analyzeBtn.disabled = false;
      setStatus('Rewriting failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  function renderRewriteResult(result) {
    cleanText = result.text;

    /* Map each segment-relative edit onto its position in the finished text
       so the diff can be highlighted. */
    const edited = result.targets
      .filter((t) => t.current !== t.original)
      .sort((a, b) => a.start - b.start);

    const marks = [];
    let drift = 0;
    edited.forEach((t) => {
      const newStart = t.start + drift;
      (t.changes || []).forEach((c) => {
        marks.push({ start: newStart + c.offset, end: newStart + c.offset + c.to.length, from: c.from });
      });
      drift += t.current.length - t.original.length;
    });
    marks.sort((a, b) => a.start - b.start);

    let html = '';
    let cursor = 0;
    marks.forEach((m) => {
      if (m.start < cursor) return;
      html += escapeHtml(result.text.slice(cursor, m.start)) +
        '<ins title="was: ' + escapeHtml(m.from) + '">' +
        escapeHtml(result.text.slice(m.start, m.end)) + '</ins>';
      cursor = m.end;
    });
    html += escapeHtml(result.text.slice(cursor));
    el.output.innerHTML = html;
    el.outputPanel.hidden = false;

    const before = result.documentBefore ? Math.round(result.documentBefore.score * 100) : 0;
    const after = result.documentAfter ? Math.round(result.documentAfter.score * 100) : before;
    const wordChanges = result.changes.filter((c) => c.source !== 'grammar').length;

    el.deltaBefore.textContent = before + '%';
    el.deltaAfter.textContent = after + '%';
    el.deltaCount.textContent = wordChanges;
    el.changeCount.textContent = result.changes.length;
    el.changeList.innerHTML = result.changes.map((ch) =>
      '<li><span class="from">' + escapeHtml(ch.from) + '</span><span aria-hidden="true">→</span>' +
      '<span class="to">' + escapeHtml(ch.to) + '</span>' +
      '<span class="src">segment ' + (ch.segment ? ch.segment.index + 1 : '?') + ' · ' + ch.source + '</span></li>'
    ).join('') || '<li>No safe substitution was found for this text.</li>';

    renderRunSummary(result);

    el.removeBtn.disabled = false;
    el.analyzeBtn.disabled = false;

    if (!wordChanges) {
      setStatus('No safe synonym was found for the marked segments. Try another passage, or switch the online dictionary on.', 'error');
    } else if (result.degraded) {
      setStatus('Detection API unavailable (' + result.degraded + ') — scored with the built-in estimate instead. ' +
        wordChanges + ' words replaced.', 'error');
    } else {
      setStatus('Done. ' + wordChanges + ' words replaced across ' + edited.length +
        ' segments · watermark score ' + before + '% → ' + after + '%' +
        (result.calls ? ' · ' + result.calls + ' detector calls' : '') + '.', 'ok');
    }
    el.outputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Per-segment record of what was tried and what was kept. */
  function renderRunSummary(result) {
    if (!el.runSummary) return;
    const rows = result.targets.map((t) => {
      const attempts = (t.history || []).map((h) =>
        '<span class="metric">round ' + h.round + ': ' + h.tried + ' tried, ' +
        Math.round(h.from * 100) + '% → ' + Math.round(h.to * 100) + '%' +
        (h.kept ? ' <strong>kept</strong>' : ' discarded') + '</span>').join('');
      return '<li class="segment-item">' +
        '<div class="segment-head">' +
        '<span class="segment-index">' + (t.index + 1) + '</span>' +
        '<span class="segment-title">' + Math.round(t.baseline * 100) + '% → ' +
        Math.round(t.score * 100) + '%</span>' +
        '<span class="segment-metrics">' + (attempts || '<span class="metric">no rewrite found</span>') + '</span>' +
        '</div></li>';
    }).join('');
    el.runSummary.innerHTML = rows;
    if (el.runPanel) el.runPanel.hidden = false;
    if (el.runEngine) {
      el.runEngine.textContent = result.engine === 'official'
        ? 'Official detection API'
        : 'Built-in statistical estimate';
    }
    if (el.runCalls) el.runCalls.textContent = result.calls + (result.cached ? ' (' + result.cached + ' cached)' : '');
  }

  /* ====================== wiring ====================== */
  const SAMPLE = 'Artificial intelligence has fundamentally transformed the way modern organizations approach ' +
    'their daily operations. By leveraging advanced machine learning algorithms, companies are now able to ' +
    'process enormous volumes of information in a fraction of the time that traditional methods required. ' +
    'This significant shift has created numerous opportunities for businesses seeking to improve efficiency ' +
    'and reduce operational costs.\n\n' +
    'One of the most important benefits of this technology is its remarkable ability to identify patterns that ' +
    'human analysts would typically overlook. These systems continuously learn from new data, refining their ' +
    'predictions and delivering increasingly accurate results over time. As a consequence, decision makers can ' +
    'rely on evidence rather than intuition when they evaluate complex strategic options.\n\n' +
    'However, it is essential to recognize that these powerful tools also introduce considerable challenges. ' +
    'Questions surrounding privacy, fairness and accountability remain difficult to answer, and organizations ' +
    'must develop robust governance frameworks before deploying such solutions at scale. A careful, measured ' +
    'approach will ultimately produce far better outcomes than rapid, unstructured adoption.';

  function readFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setStatus('That file is larger than 2 MB. Please use a smaller text file.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      el.input.value = String(reader.result || '');
      updateCounter();
      setStatus('Loaded “' + file.name + '”. Ready to analyze.', 'ok');
    };
    reader.onerror = () => setStatus('Could not read that file.', 'error');
    reader.readAsText(file);
  }

  /* Copy marked with data-copy-draft / data-copy-live flips wholesale when
     the official detector goes live, so nothing has to be rewritten by hand
     — and nothing claims a verification that is not happening yet. */
  function applyFeatureCopy() {
    const live = window.ATWR_CONFIG.features.officialDetector;
    $$('[data-copy-draft]').forEach((node) => {
      const text = live ? node.getAttribute('data-copy-live') : node.getAttribute('data-copy-draft');
      if (text !== null) node.textContent = text;
    });
    $$('[data-show-when]').forEach((node) => {
      node.hidden = (node.getAttribute('data-show-when') === 'live') !== live;
    });
  }

  function updateEngineUi() {
    const cfg = window.ATWR_CONFIG;
    const official = selectedEngine() === 'official';

    if (el.keyRow) {
      el.keyRow.hidden = !(official && cfg.detector.mode === 'direct' && cfg.features.allowDirectKeyInBrowser);
    }
    if (el.engineNote) {
      el.engineNote.textContent = !official
        ? 'Scores are computed in your browser with the green-list z-test. Free, instant, and an estimate.'
        : cfg.features.officialDetector
          ? 'Every verdict below comes from the detection API. Segment scanning and rewrite scoring both use it.'
          : 'Not available yet. The integration is built and tested — it activates the moment the API is live.';
    }
    if (el.engineBadge) {
      el.engineBadge.textContent = official ? 'API' : 'Local';
      el.engineBadge.className = 'chip ' + (official ? 'mid' : 'low');
    }
  }

  function init() {
    if (!el.input) return;

    el.input.addEventListener('input', updateCounter);
    el.analyzeBtn.addEventListener('click', runAnalysis);
    el.removeBtn.addEventListener('click', rewrite);

    el.clearBtn.addEventListener('click', () => {
      el.input.value = '';
      updateCounter();
      el.results.hidden = true;
      el.removeBtn.disabled = true;
      current = null;
      setStatus('');
      el.input.focus();
    });

    el.sampleBtn.addEventListener('click', () => {
      el.input.value = SAMPLE;
      updateCounter();
      setStatus('Sample text loaded. Hit “Analyze watermark”.', 'ok');
    });

    el.uploadBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', (e) => readFile(e.target.files && e.target.files[0]));

    ['dragenter', 'dragover'].forEach((evt) => el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault(); el.dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((evt) => el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && el.dropZone.contains(e.relatedTarget)) return;
      el.dropZone.classList.remove('dragging');
    }));
    el.dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      readFile(file);
    });

    el.copyBtn.addEventListener('click', () => {
      const done = () => {
        const old = el.copyBtn.textContent;
        el.copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { el.copyBtn.textContent = old; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cleanText).then(done, () => setStatus('Copy failed — select the text manually.', 'error'));
      } else {
        const ta = document.createElement('textarea');
        ta.value = cleanText;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (err) { setStatus('Copy failed.', 'error'); }
        document.body.removeChild(ta);
      }
    });

    el.downloadBtn.addEventListener('click', () => {
      const blob = new Blob([cleanText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clean-text.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    el.reanalyzeBtn.addEventListener('click', () => {
      if (!cleanText) return;
      el.input.value = cleanText;
      updateCounter();
      runAnalysis();
    });

    if (el.engineSelect) {
      const cfg = window.ATWR_CONFIG;
      const officialOption = el.engineSelect.querySelector('option[value="official"]');
      if (officialOption && !cfg.features.officialDetector) {
        officialOption.disabled = true;
        officialOption.textContent = 'Official detection API — not yet available';
      }
      el.engineSelect.addEventListener('change', updateEngineUi);
    }

    if (el.keySave && el.keyInput) {
      el.keyInput.value = window.ATWR_Detector.keyStore.get();
      el.keySave.addEventListener('click', () => {
        window.ATWR_Detector.keyStore.set(el.keyInput.value.trim());
        setStatus(el.keyInput.value.trim() ? 'API key saved in this browser only.' : 'API key cleared.', 'ok');
      });
    }

    updateEngineUi();
    updateCounter();
  }

  /* ---------- chrome: theme, nav, misc ---------- */
  function chrome() {
    const header = $('#siteHeader');
    if (header) {
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const toggle = $('#themeToggle');
    const stored = (function () { try { return localStorage.getItem('atwr-theme'); } catch (e) { return null; } })();
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const initial = stored || (prefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', initial);
    if (toggle) {
      toggle.addEventListener('click', () => {
        const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', nextTheme);
        try { localStorage.setItem('atwr-theme', nextTheme); } catch (e) { /* private mode */ }
      });
    }

    const burger = $('#hamburger');
    const nav = $('#nav');
    if (burger && nav) {
      burger.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        burger.setAttribute('aria-expanded', String(open));
      });
      nav.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
      });
    }

    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    applyFeatureCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { chrome(); init(); });
  } else { chrome(); init(); }
})();
